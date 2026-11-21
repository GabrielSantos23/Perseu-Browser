/**
 * What the Electron spike drew natively over the sidebar and an extension page draws itself:
 * the tab and Space context menus, the "Delete Space?" question, and clipboard writes the
 * background asks for. The background builds menus as data (protocol.ts MenuRun); this page
 * shows them with settingsUi's in-page menu.
 *
 * In Flecha's own browser the frame page is only as wide as the sidebar, so while a menu or
 * a question is up it covers the whole window (an "overlay", like the command bar): clicks
 * on the page dismiss the menu, and the dialog has room.
 */
import type { UiState } from '../shared/types';
import { cmd, invoke, on } from './client';
import { fullBarHeight, topBarColors } from './lib/topBar';
import type { MenuRun } from './protocol';
import { askDialog, popupMenu, setMenuPoint, type MenuEntry } from './settingsUi';

const framed = typeof chrome.flechaPrivate?.setFrame === 'function';
const surface = document.documentElement.dataset.surface;
const windowId = framed && surface === 'window' ? chrome.flechaPrivate.getWindowId() : undefined;

let overlaid = false;
on('frame', (state: { overlay: boolean }) => (overlaid = state.overlay));

/** Resolves on the next resize (the frame growing), or after `ms` if none comes. */
const resized = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      removeEventListener('resize', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    addEventListener('resize', done);
  });

let overlaySeq = 0;
/** Covers the window with the frame while `fn` runs. */
async function overWindow<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  if (!windowId) return fn();
  // Each its own name: a menu opened over another closes that one, whose release of a shared
  // 'menu' would shrink the frame under the new menu.
  const name = `${kind}-${++overlaySeq}`;
  const grow = !overlaid;
  cmd('setOverlay')(name, true);
  if (grow) await resized(300);
  try {
    return await fn();
  } finally {
    cmd('setOverlay')(name, false);
  }
}

export interface WindowUiHooks {
  /** Starts the sidebar's inline rename of a tab. */
  rename(tabId: string): void;
  state(): UiState | undefined;
}

let hooks: WindowUiHooks | undefined;
export function setupWindowUi(h: WindowUiHooks) {
  hooks = h;
}

/** Asks for the background's menu `name` about `id`, shows it at the pointer and runs the pick.
    `extra` goes to the menu builder as a second argument (the bookmarks menus take a "manage"
    flag: a folder's contents on a click, its editing functions on a right-click). */
export async function showMenu(
  name: 'tabMenu' | 'spaceMenu' | 'sidebarMenu' | 'extensionMenu' | 'appMenu' | 'reloadMenu' | 'bookmarksMenu' | 'bookmarksItemMenu' | 'bookmarksBarMenu',
  id: string,
  at?: { right: number; top: number },
  extra?: unknown,
) {
  const items = await invoke<MenuEntry<MenuRun>[] | undefined>(name, id, extra);
  if (!items?.length) return;
  const picked = await overWindow('menu', () => popupMenu(items, at));
  if (picked) await runMenuItem(picked.run);
}

// The top bar's "⋮" (and its pinned extensions' menus): the bar is too short to draw them, so
// this window's frame page does.
on('app-menu', async (window: string | null, at: { right: number; top: number }, menu: 'appMenu' | 'reloadMenu' | 'extensionMenu' | 'bookmarksMenu' | 'bookmarksItemMenu' | 'bookmarksBarMenu' = 'appMenu', id = '', manage = false) => {
  if (!windowId || window !== new URLSearchParams(location.search).get('window')) return;
  // The arrow keys go to the menu, not to the top bar that was clicked.
  await chrome.flechaPrivate.focus('frame', await windowId);
  await showMenu(menu, id, at, manage);
});

// A right-click on the sidebar's drag ground: the browser takes it from the window's caption
// menu and asks for the Space's menu, as a right-click on the sidebar's background gives.
if (windowId) {
  chrome.flechaPrivate.onFrameContextMenu?.addListener(async (window, x, y) => {
    const space = hooks?.state()?.activeSpaceId;
    if (window !== (await windowId) || !space) return;
    setMenuPoint(x, y);
    // The arrow keys go to the menu, as for the top bar's "⋮".
    await chrome.flechaPrivate.focus('frame', window);
    await showMenu('sidebarMenu', '');
  });
}

/** A menu the frame page builds itself (the site panel's "…"); resolves with the picked id. */
export async function localMenu(items: Array<{ id: string; label: string } | { separator: true }>) {
  const entries: MenuEntry<string>[] = items.map((item) => ('separator' in item ? item : { label: item.label, run: item.id }));
  return (await overWindow('menu', () => popupMenu(entries)))?.run;
}

async function runMenuItem(run: MenuRun) {
  // The bookmarks-bar folder functions: the menu that asked lives on this page with the
  // keyboard focus, so the field opens here — the bar's own input would open unfocused.
  if ('cmd' in run && run.cmd === 'renameFavoriteFolder' && run.args.length <= 1) {
    await renameBarFolder(String(run.args[0] ?? ''));
    return;
  }
  if ('cmd' in run && run.cmd === 'newFavoriteFolder' && run.args.length <= 1) {
    await renameBarFolder(undefined, typeof run.args[0] === 'string' && run.args[0] ? run.args[0] : undefined);
    return;
  }
  if ('cmd' in run) cmd(run.cmd)(...run.args);
  else if ('browser' in run) await chrome.flechaPrivate.runBrowserCommand(run.browser, windowId && (await windowId)).catch((err) => console.error('Perseu menu', err));
  else if ('copy' in run) await copy(run.copy, run.message);
  else if ('rename' in run) {
    // The keys go to the sidebar's rename field, so the frame page takes keyboard focus.
    if (windowId) await chrome.flechaPrivate.focus('frame', await windowId);
    hooks?.rename(run.rename);
  }
  else if ('deleteSpace' in run) await confirmDeleteSpace(run.deleteSpace);
  else if ('clearSpaceData' in run) await confirmClearSpaceData(run.clearSpaceData);
  else if ('uninstallExtension' in run) await chrome.management.uninstall(run.uninstallExtension, { showConfirmDialog: true }).catch(() => undefined);
}

/** Renames — or, without a folder id, creates — a bookmarks-bar folder: a field laid over the
    bar's own place, in the bar's colours, on this page — which holds the keyboard focus the
    bar's own input would lack. */
async function renameBarFolder(folderId?: string, parentId?: string) {
  const current = folderId ? await invoke<string>('favoriteFolderName', folderId).catch(() => '') : '';
  const state = hooks?.state();
  const left = state?.sidebarMode === 'docked' ? 230 : 8;
  const { bg, fg } = topBarColors(state?.siteColor);
  await overWindow('rename', async () => {
    const box = Object.assign(document.createElement('div'), { className: 'bar-rename' });
    Object.assign(box.style, {
      left: `${left}px`,
      top: '8px',
      right: '8px',
      height: `${fullBarHeight(state?.bookmarksBar)}px`,
      background: bg,
      color: fg,
    });
    const input = Object.assign(document.createElement('input'), { value: current, spellcheck: false });
    box.append(input);
    document.body.append(box);
    input.focus();
    input.select();
    let closed = false;
    const done = (save: boolean) => {
      if (closed) return;
      closed = true;
      const value = input.value.trim();
      box.remove();
      if (!save || !value || value === (folderId ? current : '')) return;
      if (folderId) cmd('renameFavoriteFolder')(folderId, value);
      else cmd('newFavoriteFolder')(parentId, value);
    };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = current;
        input.blur();
      }
    });
    await new Promise<void>((resolve) => input.addEventListener('blur', () => resolve(), { once: true }));
  });
}

/** Electron's "Sign out of everything in “Space”?" message box, in the page. */
async function confirmClearSpaceData(spaceId: string) {
  const space = hooks?.state()?.spaces.find((s) => s.id === spaceId);
  if (!space?.isolated) return;
  const response = await overWindow('dialog', () =>
    askDialog({
      message: `Sign out of everything in “${space.name}”?`,
      detail: 'Clears cookies, storage and cache for this Space only.',
      buttons: ['Clear', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    }),
  );
  if (response === 0) cmd('clearSpaceData')(spaceId);
}

/** Electron's "Delete “Space”?" message box, in the page. */
export async function confirmDeleteSpace(spaceId: string) {
  const state = hooks?.state();
  const space = state?.spaces.find((s) => s.id === spaceId);
  if (!space || state!.spaces.length < 2) return;
  const response = await overWindow('dialog', () =>
    askDialog({
      message: `Delete “${space.name}”?`,
      detail: 'Its pinned and today tabs are closed. This can’t be undone.',
      buttons: ['Delete Space', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    }),
  );
  if (response === 0) cmd('deleteSpace')(spaceId);
}

/**
 * Writes the clipboard. A keyboard shortcut leaves the page focused, not this one, and the
 * clipboard only takes writes from the focused document, so the frame borrows focus for it.
 */
async function writeClipboard(item: string | Blob) {
  const write = () =>
    typeof item === 'string' ? navigator.clipboard.writeText(item) : navigator.clipboard.write([new ClipboardItem({ [item.type]: item })]);
  if (document.hasFocus() || !windowId) return write();
  const id = await windowId;
  await chrome.flechaPrivate.focus('frame', id);
  try {
    await write();
  } finally {
    await chrome.flechaPrivate.focus('page', id);
  }
}

/** A data: URL as a Blob, without fetch (the page's CSP keeps connect-src to 'self'). */
function pngBlob(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'image/png' });
}

export async function copy(text: string, message: string) {
  try {
    await writeClipboard(text);
    cmd('flash')(message);
  } catch (err) {
    console.error('Flecha shell: copying failed', err);
  }
}

// The background's clipboard requests (copy link, screenshot from a shortcut) go to the frame
// page of the window they're for; stock Chromium's side panel takes them otherwise.
if (surface === 'window' || (surface === 'panel' && !framed)) {
  on('clipboard', async (target: number | undefined, data: { text?: string; png?: string; message: string }) => {
    if (windowId && target !== undefined && target !== (await windowId)) return;
    try {
      if (data.png) await writeClipboard(pngBlob(data.png));
      else if (data.text !== undefined) await writeClipboard(data.text);
      cmd('flash')(data.message);
    } catch (err) {
      console.error('Flecha shell: copying failed', err);
    }
  });
}
