/** Turns what the browser process read from other browsers (Windows has no native host) into an import. */
import type { BrowserImportData } from '../../shared/importApply';
import { MAX_BOOKMARKS, chromiumBookmarks, cleanEntry, firefoxBookmarks, folder, newTidy, type FirefoxBookmark } from '../../shared/importParse';
import type { ImportNode } from '../../shared/importApply';
import type { HistoryEntry } from '../../shared/types';

interface RawProfile {
  name: string;
  chromium?: string[];
  firefox?: FirefoxBookmark[];
  history?: HistoryEntry[];
}

export const canReadBrowsersHere = () => navigator.platform.startsWith('Win') && typeof chrome.flechaPrivate?.readImportBrowser === 'function';

export function importData(raw: { name?: string; profiles: RawProfile[] }, id: string): BrowserImportData {
  const name = raw.name ?? id;
  const tidy = newTidy();
  const warnings: string[] = [];
  const perProfile: Array<{ name: string; nodes: ImportNode[] }> = [];
  for (const profile of raw.profiles) {
    try {
      const nodes = tidy.run(profile.firefox ? firefoxBookmarks(profile.firefox) : chromiumBookmarks(profile.chromium ?? []));
      if (nodes.length) perProfile.push({ name: profile.name, nodes });
    } catch {
      warnings.push(`Couldn’t read bookmarks from ${name} (${profile.name}).`);
    }
  }
  if (tidy.skipped) warnings.push(`Only the first ${MAX_BOOKMARKS} bookmarks were imported; ${tidy.skipped} more were left behind.`);
  return {
    name,
    bookmarks: perProfile.length > 1 ? perProfile.map((p) => folder(p.name, p.nodes)) : perProfile[0]?.nodes,
    bookmarkCount: tidy.count,
    history: raw.profiles.flatMap((p) => (p.history ?? []).map(cleanEntry)),
    cookies: [],
    warnings,
  };
}
