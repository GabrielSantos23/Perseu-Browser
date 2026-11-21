// The bar on top of the page area (window.html?window=<id>&kind=topbar, flecha_frame_view.cc):
// back, forward and reload, and the site in the middle, in the page's colour.
import './noPageMenu';
import './flechaApi';
import { cmd, on } from './client';
import { ICONS, type IconName } from './ui/icons';
import { TOP_BAR_HEIGHT, fullBarHeight, topBarColors } from './lib/topBar';
import type { ExtensionsView, PinnedNode, UiState } from '../shared/types';

const api = window.flecha;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

for (const el of document.querySelectorAll<HTMLElement>('i[data-icon]')) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[el.dataset.icon as IconName]);
  svg.append(path);
  el.replaceWith(svg);
}

let state: UiState | undefined;
const activeTab = () => {
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  return space?.activeTabId ? state?.tabs[space.activeTabId] : undefined;
};

function siteName(url: string) {
  try {
    const u = new URL(url);
    return ['http:', 'https:', 'chrome:'].includes(u.protocol) ? u.host.replace(/^www\./, '') : u.protocol.replace(/:$/, '');
  } catch {
    return url;
  }
}

function tip(el: HTMLElement, label: string, shortcut?: string) {
  const keys = shortcut && state?.shortcuts[shortcut];
  el.title = keys ? `${label}  ${keys}` : label;
}

function render(s: UiState) {
  state = s;
  const { bg, fg } = topBarColors(s.siteColor);
  document.documentElement.style.setProperty('--site-bg', bg);
  document.documentElement.style.setProperty('--site-fg', fg);
  // The Space's grain lives on the sidebar; the bar is chrome too, so it gets the same layer.
  if (s.spaceGrain && s.spaceGrain.texture !== 'none' && s.spaceGrain.strength > 0) {
    document.documentElement.dataset.spaceTexture = s.spaceGrain.texture;
    document.documentElement.style.setProperty('--zen-grain-strength', String(s.spaceGrain.strength));
  } else {
    delete document.documentElement.dataset.spaceTexture;
    document.documentElement.style.removeProperty('--zen-grain-strength');
  }

  // With the address in the sidebar, so are back, forward and reload.
  $('nav').hidden = !!s.addressInSidebar;
  // With the address in the sidebar the bar is only the room for the window buttons.
  $('bar').toggleAttribute('data-bare', !!s.addressInSidebar);
  $('bookmarks-bar').hidden = !s.bookmarksBar;
  faviconTemplate = s.faviconUrl;
  $<HTMLButtonElement>('back').disabled = !s.nav.canGoBack;
  $<HTMLButtonElement>('forward').disabled = !s.nav.canGoForward;
  tip($('back'), 'Back', 'back');
  tip($('forward'), 'Forward', 'forward');
  const loading = s.nav.loading;
  $('reload').toggleAttribute('data-loading', loading);
  $('site').toggleAttribute('data-loading', loading);
  $('reload').querySelector('path')!.setAttribute('d', ICONS[loading ? 'close' : 'reload']);
  $('reload').setAttribute('aria-label', loading ? 'Stop' : 'Reload');
  tip($('reload'), loading ? 'Stop' : 'Reload', loading ? undefined : 'reload');
  tip($('copy'), 'Copy link', 'copyLink');
  tip($('app-menu'), 'Browser menu');
  tip($('site'), 'Edit the address', 'openLocation');
  tip($('site-controls'), 'Site controls');
  // Only when the page isn't at its normal size; clicking puts it back.
  $('zoom').hidden = s.nav.zoom === 100;
  $('zoom').textContent = `${s.nav.zoom}%`;
  tip($('zoom'), 'Reset zoom', 'actualSize');

  const tab = activeTab();
  const blank = !tab || tab.url === 'about:blank';
  $('site-group').hidden = blank;
  // The home's titlebar is the sky: the strip draws the night sky itself, so the
  // clouds run to the window's top; the bar becomes glass over it.
  $('bar').toggleAttribute('data-sky', blank);
  if (blank) {
    renderHomeSky();
    return;
  }
  $('home-sky').hidden = true;
  const img = $('site').querySelector('img')!;
  const icon = s.faviconUrl ? s.faviconUrl.replace('%s', encodeURIComponent(tab.url)) : tab.favicon;
  if (icon && img.getAttribute('src') !== icon) img.src = icon;
  $('site').querySelector('.name')!.textContent = siteName(tab.url);
}

api.onState((s) => {
  render(s);
  renderExtensions();
  renderBookmarks();
});

// While the bar is thin (the edge strip along the page's top, or sliding in or out) it draws
// nothing and is no drag ground: the browser leaves the page its own card behind it
// (flecha_frame_host.h TopBarIsThin). The window's frame page says when (flechaApi.ts).
const barWindow = new URLSearchParams(location.search).get('window');
// Start whole: a bar that first appears at the thin edge strip gets a resize, which hides it.
// Starting from its own height could keep it hidden after it has grown (an incognito page
// loads its state later, so it missed the frame's "not thin" word and stayed blank).
let barThin = false;
// Whole from the top row's height up: the browser gives the bar its real room (off the top gap)
// once the animated height passes TOP_BAR_HEIGHT, and before that a drawn bar would cover the
// gap above the page. Drawing at the whole height only — the old rule — kept the bar invisible
// through the whole slide when the bookmarks row makes it taller, and it then popped in whole.
// From TOP_BAR_HEIGHT on, the bar paints as soon as its geometry is right and the row grows in
// with the slide (the page loads later than a resize otherwise misses the word, too).
const applyThin = () => document.documentElement.toggleAttribute('data-thin', barThin || Math.round(innerHeight) < TOP_BAR_HEIGHT);
applyThin();
addEventListener('resize', applyThin);
new BroadcastChannel('perseu-topbar').onmessage = (e: MessageEvent<{ window: string; thin: boolean }>) => {
  if (e.data.window !== barWindow) return;
  barThin = e.data.thin;
  applyThin();
};

// ---- pinned extensions: a toolbar's buttons, beside the browser menu ----------------------

let extensions: ExtensionsView | undefined;
const windowParam = new URLSearchParams(location.search).get('window');
/** A rect of this bar in window coordinates: the bar sits past the docked sidebar (or the gap) and kFlechaGap down. */
const inWindow = (box: DOMRect) => ({
  x: Math.round((state?.sidebarMode === 'docked' ? 230 : 8) + box.left),
  y: Math.round(8 + box.top),
  width: Math.round(box.width),
  height: Math.round(box.height),
});

function extensionButton(extension: ExtensionsView['items'][number]) {
  const letter = () => Object.assign(document.createElement('span'), { className: 'letter', textContent: extension.name[0]?.toUpperCase() ?? '•' });
  const button = document.createElement('button');
  button.className = 'icon-button extension';
  button.title = extension.name;
  button.setAttribute('aria-label', extension.name);
  if (extension.icon) {
    const image = Object.assign(document.createElement('img'), { src: extension.icon, alt: '', draggable: false });
    image.onerror = () => image.replaceWith(letter());
    button.append(image);
  } else button.append(letter());
  // Its popup hangs under the button, as from Chromium's toolbar.
  button.onclick = () => {
    const at = inWindow(button.getBoundingClientRect());
    void chrome.flechaPrivate?.openExtensionAction(extension.id, at, Number(windowParam)).catch(() => cmd('flash')(`${extension.name} isn’t available on this page`));
  };
  // The menu is drawn by the window's frame page, under the button, as the "⋮" menu is.
  button.oncontextmenu = (e) => {
    e.preventDefault();
    const at = inWindow(button.getBoundingClientRect());
    cmd('openAppMenu')(windowParam, { right: at.x + at.width, top: at.y + at.height + 4 }, 'extensionMenu', extension.id);
  };
  return button;
}

/** The ones pinned everywhere or in this Space; none in incognito, where extensions don't run. */
function renderExtensions() {
  const here = state?.spaces.find((s) => s.id === state!.activeSpaceId)?.pinnedExtensions ?? [];
  const pinned = extensions && !chrome.extension?.inIncognitoContext ? extensions.items.filter((e) => e.pinned || here.includes(e.id)) : [];
  $('extensions').hidden = !pinned.length;
  $('extensions').replaceChildren(...pinned.map(extensionButton));
}

api.onExtensions((view) => {
  extensions = view;
  renderExtensions();
});
systemDark.addEventListener('change', () => state && render(state));

// ---- the bookmarks bar: the active Space's favorites, as the row under the top bar ----------

let faviconTemplate: string | undefined;
let bookmarksKey = '';

/** The `_favicon` endpoint's template (faviconUrl), with the bookmark's URL in it. */
const bookmarkIcon = (url: string) => (faviconTemplate ? faviconTemplate.replace('%s', encodeURIComponent(url)) : undefined);

function iconSvg(name: IconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** A menu of the bookmarks bar: the bar is too short to draw one, so the window's frame page
    does (windowUi.ts), as it does the "⋮" menu's. The bar's page starts past the sidebar, so
    its coordinates are moved into the window's — the menu opens at the pointer or under its
    button, not wherever the raw bar-local numbers land. */
const winX = (x: number) => (state?.sidebarMode === 'docked' ? 230 : 8) + x;
const winY = (y: number) => 8 + y;
function bookmarkMenuAt(menu: 'bookmarksMenu' | 'bookmarksItemMenu' | 'bookmarksBarMenu', id: string, right: number, top: number, manage = false) {
  cmd('openAppMenu')(windowParam, { right: Math.round(right), top: Math.round(top) }, menu, id, manage);
}

/** Drops on the bar: a folder reorders before `beforeFolderId` (or to the end), a bar item moves
    into `intoFolderId`, before `beforeTabId`, or to the end — same page, so a plain HTML5 drag
    does it. */
const BAR_ITEM_TYPE = 'application/x-flecha-bar-item';
const BAR_FOLDER_TYPE = 'application/x-flecha-folder';
function barDrop(el: HTMLElement, target: { beforeFolderId?: string; intoFolderId?: string; beforeTabId?: string }) {
  el.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types;
    if (!types?.includes(BAR_FOLDER_TYPE) && !types?.includes(BAR_ITEM_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    el.classList.add('folder-drag-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('folder-drag-over'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('folder-drag-over');
    const folderId = e.dataTransfer?.getData(BAR_FOLDER_TYPE);
    const tabId = e.dataTransfer?.getData(BAR_ITEM_TYPE);
    if (!folderId && !tabId) return;
    e.preventDefault();
    e.stopPropagation();
    if (folderId) cmd('moveFolder')(folderId, { spaceId: state!.activeSpaceId, beforeId: target.beforeFolderId ?? target.beforeTabId });
    else if (target.intoFolderId) cmd('moveTab')(tabId, { zone: 'favorites', folderId: target.intoFolderId });
    else cmd('moveTab')(tabId, { zone: 'favorites', ...(target.beforeTabId ? { beforeTabId: target.beforeTabId } : {}) });
  });
}

function favoriteButton(node: PinnedNode) {
  const button = document.createElement('button');
  button.className = 'bookmark';
  if (node.kind === 'folder') {
    button.dataset.folderId = node.id;
    button.title = node.name;
    button.draggable = true;
    button.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData(BAR_FOLDER_TYPE, node.id);
      e.dataTransfer!.effectAllowed = 'move';
    });
    barDrop(button, { beforeFolderId: node.id, intoFolderId: node.id });
    button.append(iconSvg('folder'));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = node.name;
    button.append(name);
    // A click opens the folder's favorites; a right-click also carries its editing functions,
    // under the button for a click, at the pointer for a right-click. A double-click renames it
    // in place, as the sidebar's folders do. Draggable: dropped on another folder it reorders
    // before it, on the row's ground to the end; a dropped bar item moves inside it.
    let lastClick = 0;
    button.onclick = () => {
      const now = Date.now();
      const double = now - lastClick < 300;
      lastClick = now;
      if (double) return;
      const box = button.getBoundingClientRect();
      bookmarkMenuAt('bookmarksMenu', node.id, winX(box.left), winY(box.bottom + 4), false);
    };
    button.ondblclick = () => startFolderRename(node.id);
    button.oncontextmenu = (e) => {
      e.preventDefault();
      bookmarkMenuAt('bookmarksMenu', node.id, winX(e.clientX), winY(e.clientY), true);
    };
    barDrop(button, { beforeFolderId: node.id, intoFolderId: node.id });
    return button;
  }
  const tab = state?.tabs[node.tabId];
  const url = tab?.url ?? '';
  button.title = tab?.title || url;
  button.dataset.tabId = node.tabId;
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  const icon = url && bookmarkIcon(url);
  if (icon) img.src = icon;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = tab?.title || url;
  button.append(img, name);
  // Draggable: dropped on a folder it moves inside it, on another item before it, on the row's
  // ground to the end.
  button.draggable = true;
  button.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData(BAR_ITEM_TYPE, node.tabId);
    e.dataTransfer!.effectAllowed = 'move';
  });
  barDrop(button, { beforeTabId: node.tabId });
  // Like the sidebar's tiles: a click wakes the favorite, a middle-click opens it alongside.
  button.onclick = () => url && cmd('activate')(node.tabId);
  button.onauxclick = (e) => {
    if (e.button === 1 && url) cmd('newTab')(url);
  };
  button.oncontextmenu = (e) => {
    e.preventDefault();
    bookmarkMenuAt('bookmarksItemMenu', node.tabId, winX(e.clientX), winY(e.clientY));
  };
  return button;
}

function renderBookmarks() {
  const bar = $('bookmarks-bar');
  if (bar.hidden) return;
  // The state arrives on every tab change; only rebuild the row when its content changed,
  // or the icons reset themselves mid-paint and the row flickers.
  const space = state?.spaces.find((sp) => sp.id === state!.activeSpaceId);
  const nodes = space?.favorites ?? [];
  const tabsKey = nodes.flatMap((n) => (n.kind === 'tab' ? [state?.tabs[n.tabId]?.title, state?.tabs[n.tabId]?.url] : [n.name]));
  const key = JSON.stringify([faviconTemplate, state?.activeSpaceId, nodes, tabsKey]);
  if (key === bookmarksKey) return;
  bookmarksKey = key;
  if (!nodes.length) {
    const empty = document.createElement('span');
    empty.className = 'bookmarks-empty';
    empty.textContent = 'No favorites yet';
    bar.replaceChildren(empty);
    return;
  }
  bar.replaceChildren(...nodes.map(favoriteButton));
}

// The bar's own ground: add the page you're on, or start a folder, as Zen's bookmarks bar does.
// Its drop ground takes a folder or a favorite dragged past every other one, to the end of the row.
barDrop($('bookmarks-bar'), {});
$('bookmarks-bar').oncontextmenu = (e) => {
  if ((e.target as HTMLElement).closest('.bookmark')) return;
  e.preventDefault();
  bookmarkMenuAt('bookmarksBarMenu', '', winX(e.clientX), winY(e.clientY));
};

// A folder renames in place: a double-click on its button, a "Rename Folder…" from its menu, or
// the folder a "New Folder" just made — all land here.
function startFolderRename(folderId: string) {
  const button = document.querySelector<HTMLElement>(`#bookmarks-bar [data-folder-id="${CSS.escape(folderId)}"]`);
  const name = button?.querySelector<HTMLElement>('.name');
  if (!button || !name) return;
  const original = name.textContent ?? '';
  const input = document.createElement('input');
  input.className = 'bookmark-rename';
  input.value = original;
  name.replaceWith(input);
  input.focus();
  input.select();
  const done = (save: boolean) => {
    const value = input.value.trim();
    input.replaceWith(Object.assign(document.createElement('span'), { className: 'name', textContent: value || original }));
    if (save && value && value !== original) cmd('renameFavoriteFolder')(folderId, value);
  };
  input.onblur = () => done(true);
  input.onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') input.blur();
    else if (e.key === 'Escape') {
      input.value = original;
      input.blur();
    }
  };
}
on('rename-favorite-folder', startFolderRename);

/** The night sky in the strip, sized and placed so it continues the page's own sky below. The
    window's last known height paints it on this very frame — the async answer only corrects it —
    or the bar came back as a plain colour first, with the sky popping in late. */
let lastWindowHeight: number | undefined;
function renderHomeSky() {
  const sky = $('home-sky');
  const full = fullBarHeight(state?.bookmarksBar);
  const pageW = document.documentElement.clientWidth;
  const paint = (height: number) => {
    // The page area's own geometry (flecha_frame_host.h): gaps of 8 around it, the bar's whole
    // room above it. Its width is this strip's width.
    const pageH = height - 8 - full - 8;
    if (pageW <= 0 || pageH <= 0) return false;
    const sw = Math.max(pageW, 1.545 * pageH);
    sky.style.setProperty('--sw', `${Math.round(sw)}px`);
    // The image's top edge, from the strip's top (the strip sits at window y 8, the page below the bar).
    sky.style.setProperty('--img-top', `${Math.round(full + 0.6 * pageH - 0.3883 * sw)}px`);
    sky.hidden = false;
    return true;
  };
  if (lastWindowHeight !== undefined) paint(lastWindowHeight);
  void chrome.flechaPrivate?.getWindowSize?.().then(({ width, height }) => {
    lastWindowHeight = height;
    if (!paint(height)) sky.hidden = true;
  });
}
window.addEventListener('resize', () => {
  if (!$('home-sky').hidden) renderHomeSky();
});

// Confirmations show here, next to the button that asked for them, whatever the sidebar's state.
let toastTimer: number | undefined;
api.onFlash((message) => {
  const toast = $('toast');
  const group = $('site-group');
  toast.textContent = message;
  toast.hidden = false;
  toast.style.left = `${group.hidden ? $('bar').clientWidth / 2 : group.getBoundingClientRect().right + 8}px`;
  const copied = message === 'Link copied';
  $('copy').querySelector('path')!.setAttribute('d', ICONS[copied ? 'check' : 'link']);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    $('copy').querySelector('path')!.setAttribute('d', ICONS.link);
  }, 1600);
});

// Retractable when the address lives in the sidebar, or with the retractTopBar setting (edge
// strip: ui/app.ts, flechaApi.ts).
let pointerInBar = false;
document.documentElement.addEventListener('mouseenter', (e) => {
  pointerInBar = true;
  // The entry's own coordinates: moves over the bar's drag band are never heard, so without
  // this the leave's through-top check would judge from a stale pointer.
  pointerY = e.clientY;
  if (state?.addressInSidebar || state?.retractTopBar) cmd('setTopBarPeek')(true);
});
// Not when the pointer leaves through the top: the thin strip reaches the window's top but the whole
// bar starts kFlechaGap below it, so a pointer up there would open the bar, find itself above it,
// close it, be under the strip again and open it, on and on. Leaving down (the page) or sideways closes it.
// Judged by where the pointer was last seen in the bar: a leave into another view (the page) carries
// no dependable coordinates of its own.
// Neither while one of the bar's menus is up (an overlay the frame page draws past the bar) nor
// while a folder is being renamed in place: both would close under the sliding bar.
let pointerY = Infinity;
let frameOverlay = false;
on('frame', (f: { overlay?: boolean }) => {
  const was = frameOverlay;
  frameOverlay = !!f.overlay;
  // The menu just closed with the pointer no longer on the bar (it was over the menu): close too.
  if (was && !frameOverlay && !pointerInBar && (state?.addressInSidebar || state?.retractTopBar)) cmd('setTopBarPeek')(false);
});
document.documentElement.addEventListener('mousemove', (e) => (pointerY = e.clientY));
document.documentElement.addEventListener('mouseleave', () => {
  const throughTop = pointerY < 8; // kFlechaGap: the gap above the whole bar
  pointerY = Infinity;
  pointerInBar = false;
  if (
    (state?.addressInSidebar || state?.retractTopBar) &&
    !throughTop &&
    !frameOverlay &&
    !document.querySelector('.bookmark-rename')
  )
    cmd('setTopBarPeek')(false);
});

$('app-menu').onclick = () => {
  const box = $('app-menu').getBoundingClientRect();
  const left = (state?.sidebarMode === 'docked' ? 230 : 8) + box.left;
  cmd('openAppMenu')(new URLSearchParams(location.search).get('window'), { right: left + box.width, top: 8 + box.bottom + 4 });
};
$('back').onclick = () => api.back();
$('forward').onclick = () => api.forward();
$('reload').onclick = () => {
  if (Date.now() - reloadHeldAt < 400) return;
  if (state?.nav.loading) api.stop();
  else api.reload();
};
// Pressed and held (or right-clicked), Reload offers a hard reload and emptying the cache, as in Chrome.
let reloadHold: number | undefined;
let reloadHeldAt = 0;
function openReloadMenu() {
  reloadHeldAt = Date.now();
  const box = $('reload').getBoundingClientRect();
  const left = (state?.sidebarMode === 'docked' ? 230 : 8) + box.left;
  cmd('openAppMenu')(new URLSearchParams(location.search).get('window'), { right: left + 220, top: 8 + box.bottom + 4 }, 'reloadMenu');
}
$('reload').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  clearTimeout(reloadHold);
  reloadHold = window.setTimeout(openReloadMenu, 450);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) $('reload').addEventListener(type, () => clearTimeout(reloadHold));
$('reload').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openReloadMenu();
});
$('copy').onclick = () => cmd('copyActiveLink')();
$('zoom').onclick = () => cmd('zoom')(0);
// The window page has the command bar; it opens over the window.
$('site').onclick = () => cmd('openPalette')('navigate');
// The window page draws the panel too, under this button: in window coordinates, the bar sits
// past the docked sidebar (or the gap) and kFlechaGap down.
$('site-controls').onclick = () => {
  const box = $('site-controls').getBoundingClientRect();
  const left = (state?.sidebarMode === 'docked' ? 230 : 8) + box.left;
  cmd('openSitePanel')({ left, top: 8 + box.top, width: box.width, height: box.height });
};
