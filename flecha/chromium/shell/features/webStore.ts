/**
 * Content script on the Chrome Web Store: it only offers installs to Google Chrome, so its greyed
 * out button gets an enabled twin that opens the extension's .crx; Chromium then asks to install it
 * (extension_management.cc allows that from this site).
 */
const extensionId = () => /\/detail\/(?:[^/]+\/)?([a-p]{32})/.exec(location.pathname)?.[1];

function install() {
  const id = extensionId();
  const version = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1];
  if (id && version) location.href = `https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3&prodversion=${version}.0&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

/** The "Switch to Chrome" banner: the row around its button. */
function hideChromeBanner() {
  const link = [...document.querySelectorAll('button:not(:disabled)')].find((b) => /Google Chrome/.test(b.textContent ?? ''));
  if (!link) return;
  let row = link as HTMLElement;
  while (row.parentElement && row.parentElement.getBoundingClientRect().height <= 64) row = row.parentElement;
  row.style.display = 'none';
}

/** Google's "Switch to Chrome?" card, in the page header. */
function hideChromePopup() {
  for (const dialog of document.querySelectorAll<HTMLElement>('header [role="dialog"]')) {
    if (dialog.querySelector('aside') && /Chrome/.test(dialog.textContent ?? '')) dialog.style.display = 'none';
  }
}

/** The button says whether this extension is already in Perseu. */
let shownFor: string | undefined;
async function showInstalled(button: HTMLButtonElement, id: string) {
  const installed = await chrome.runtime.sendMessage({ perseu: 'extension-installed', id }).catch(() => false);
  if (id !== extensionId()) return;
  button.disabled = !!installed;
  const text = textNode(button);
  if (text) text.nodeValue = installed ? 'Added to Perseu' : 'Add to Perseu';
}

const textNode = (button: HTMLElement) => document.createTreeWalker(button, NodeFilter.SHOW_TEXT, (n) => (n.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)).nextNode();

function offerInstall() {
  hideChromeBanner();
  hideChromePopup();
  const id = extensionId();
  const existing = document.getElementById('perseu-install') as HTMLButtonElement | null;
  if (existing && id && shownFor !== id) {
    shownFor = id;
    void showInstalled(existing, id);
  }
  if (!id || existing) return;
  const original = [...document.querySelectorAll<HTMLButtonElement>('button:disabled')].find((b) => /Chrome/.test(b.textContent ?? ''));
  if (!original) return;
  const button = original.cloneNode(true) as HTMLButtonElement;
  button.id = 'perseu-install';
  button.disabled = false;
  for (const attribute of ['jsaction', 'jscontroller', 'jsname']) button.removeAttribute(attribute);
  shownFor = id;
  void showInstalled(button, id);
  button.addEventListener('click', install);
  original.style.display = 'none';
  original.after(button);
}

// The store is a single page app: the button comes and goes without a page load.
new MutationObserver(offerInstall).observe(document.documentElement, { childList: true, subtree: true });
offerInstall();

// Installed from this page: the prompt was accepted.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.perseu !== 'extension-added') return;
  shownFor = undefined;
  offerInstall();
});
