/**
 * Keeps an installed Perseu current: a signed feed names the newest version, the native side
 * downloads and hash-checks it, and Settings offers the restart. Status lives in storage.
 */
import { broadcast, handle } from '../hub';
import { incognito } from '../incognito';
import { readFeed } from '../lib/updateFeed';

export const UPDATE_ALARM = 'check-update';
const FEED = 'https://github.com/GabrielSantos23/Perseu-Browser/releases/latest/download/perseu-update.json';
// The private half stays with whoever publishes (chromium/scripts/publish-windows-update.mjs);
// a copy of the signing key lives at C:/uc/perseu-update-signing-key.pem.
const PUBLIC_KEY = 'hdWHFAKCT+GSzx7nVog/y1hE/8w8oXVdr7qfJHUEThU=';

const setStatus = (state: string, version?: string) => chrome.storage.local.set({ updateStatus: { state, version } });

export async function checkForUpdate() {
  if (incognito) return;
  const updateStatus = (await chrome.storage.local.get('updateStatus')).updateStatus as { version?: string } | undefined;
  try {
    await setStatus('checking');
    const res = await fetch(FEED, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Update feed: ${res.status}`);
    const update = await readFeed(await res.json(), PUBLIC_KEY);
    // The running shell's version: a feed whose engine matches this build's
    // but whose shell is newer (shellVersion) still counts as an update.
    const status = await chrome.flechaPrivate.prepareUpdate({ ...update, runningShellVersion: chrome.runtime.getManifest().version });
    await setStatus(status === 'busy' ? 'checking' : status, update.version);
    if (status === 'ready' && updateStatus?.version !== update.version) broadcast('flash', `Perseu ${update.shellVersion ?? update.version} is ready. Restart from Settings.`);
  } catch (err) {
    console.warn('Perseu update check failed', err);
    await setStatus('failed');
  }
}

async function installUpdate() {
  const updateStatus = (await chrome.storage.local.get('updateStatus')).updateStatus as { version?: string } | undefined;
  await setStatus('installing', updateStatus?.version);
  const status = await chrome.flechaPrivate.installUpdate().catch(() => 'failed');
  if (status !== 'restarting') await setStatus('failed');
}

export function registerUpdates() {
  handle({ 'update:check': checkForUpdate, 'update:install': installUpdate });
  if (!incognito) void chrome.alarms.get(UPDATE_ALARM).then((alarm) => void (alarm ?? chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: 1, periodInMinutes: 360 })));
}
