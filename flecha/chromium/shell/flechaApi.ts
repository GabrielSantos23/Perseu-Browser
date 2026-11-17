/**
 * window.flecha for the Chromium build: the same API the Electron preload gives the sidebar,
 * over the shell's port. Imported before the sidebar code so it is there when that runs.
 */
import type { FlechaApi, PaletteMode, UiState } from '../shared/types';
import { spaceTint } from './lib/spaceTint';
import { themeFrameColors, themeGradient, themeInk, themeTint } from './lib/zenTheme';
import { resolveInput } from './lib/url';
import { TOP_BAR_HEIGHT, TOP_EDGE_HEIGHT, topBarColors } from './lib/topBar';
import { cmd, invoke, on } from './client';
import { confirmDeleteSpace, copy, localMenu, setupWindowUi, showMenu } from './windowUi';
import { incognito } from './incognito';

const surface = document.documentElement.dataset.surface;
const systemDark = matchMedia('(prefers-color-scheme: dark)');
/** Flecha's own browser draws the window frame from window.html; stock Chromium has the side panel. */
const framed = typeof chrome.flechaPrivate?.setFrame === 'function';
if (framed) document.documentElement.dataset.frame = '';
// An incognito window's pages: one Space of tabs, always dark (shell.css, incognito.ts).
if (incognito) document.documentElement.dataset.incognito = '';

/**
 * The background sends the Space's light colour; dark mode darkens it here. Pages follow
 * Chromium's appearance (the system's), not Flecha's theme setting, until a native patch
 * applies that setting to Chromium; the tint follows the same thing so text stays readable.
 */
const stateListeners: Array<(state: UiState) => void> = [];
let lastState: UiState | undefined;
/**
 * The painted theme, cached: the layered gradient is a ~34 KB string to build, and the state
 * arrives on every tab change, so only a new theme, scheme or window height rebuilds it.
 */
let themeCache: { key: string; value: Pick<UiState, 'tint' | 'spaceGradient' | 'spaceInk' | 'spaceGrain'> } | undefined;
function themePresentation(theme: NonNullable<UiState['spaceTheme']>, dark: boolean) {
  const key = JSON.stringify([theme, dark, window.innerHeight]);
  if (themeCache?.key === key) return themeCache.value;
  const value = {
    tint: themeTint(theme, dark),
    spaceGradient: themeGradient(theme, dark, 230, window.innerHeight),
    spaceInk: themeInk(theme, dark),
    spaceGrain: { texture: theme.textureType ?? 'none', strength: theme.texture ?? 0 },
  };
  themeCache = { key, value };
  return value;
}

function emitState(state: UiState) {
  lastState = state;
  const dark = systemDark.matches;
  let shown: UiState = { ...state, tint: spaceTint(state.tint, dark), tints: state.tints?.map((c) => spaceTint(c, dark)), faviconUrls: siteIcons };
  // A Zen theme paints its own gradient, ink and grain; they replace the Space's plain colours.
  if (state.spaceTheme) {
    shown = { ...shown, ...themePresentation(state.spaceTheme, dark), tints: undefined };
  }
  for (const cb of stateListeners) cb(shown);
  applyFrame();
}
on('state', emitState);

/** Icons the background fetched from the sites themselves, by host; they arrive once each. */
const siteIcons: Record<string, string> = {};
on('site-icons', (icons: Record<string, string>) => {
  Object.assign(siteIcons, icons);
  if (lastState) emitState(lastState);
});

// The frame page lays its window out: the background says how, this page adds the colour.
let frameState: { sidebar: chrome.flechaPrivate.SidebarMode; overlay: boolean; topBarPeek?: boolean } | undefined;
// Overlays this page asked for. The frame has to grow in the same turn as the request: waiting for
// the background's echo leaves it sidebar-width for a few frames, and clicks on a popover that
// reaches past it (the Space menu) land on the page instead.
const localOverlays = new Set<string>();
const windowId = surface === 'window' && framed ? chrome.flechaPrivate.getWindowId() : undefined;
// Until the background lays the window out, this page covers all of it in the plain window colour (styles.css),
// so neither a blank sidebar nor Chromium's own new tab page shows while the shell starts.
void windowId?.then((id) => chrome.flechaPrivate.setFrame({ sidebar: 'docked', overlay: true, background: systemDark.matches ? '#101012' : '#f1f1f3', topBar: 0 }, id)).catch(() => undefined);
let laidOut = false;
// Never left covered if the background is slow to answer.
setTimeout(() => !laidOut && void windowId?.then((id) => chrome.flechaPrivate.setFrame({ sidebar: 'docked', overlay: false, background: systemDark.matches ? '#101012' : '#f1f1f3', topBar: TOP_BAR_HEIGHT }, id)), 4000);
// The bar's height as last sent, and its slide between the edge strip and the whole bar.
let barShown: number | undefined;
let barSlide: { from: number; to: number; start: number } | undefined;
const BAR_SLIDE_MS = 180;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function applyFrame() {
  if (!windowId || !lastState) return;
  // Before the background's first layout arrives, a local overlay still needs a frame to grow.
  const layout = frameState ?? {
    sidebar: lastState.sidebarMode as chrome.flechaPrivate.SidebarMode,
    overlay: false,
    topBarPeek: false,
  };
  laidOut = true;
  // With the address in the sidebar the bar stays away until the pointer asks for it: an edge
  // strip along the page's top (TOP_EDGE_HEIGHT; the browser puts no window buttons in a bar
  // thinner than them) is what the pointer reaches, and the bar then slides back in.
  const target = lastState.addressInSidebar && !layout.topBarPeek ? TOP_EDGE_HEIGHT : TOP_BAR_HEIGHT;
  if (barShown === undefined || reduceMotion.matches) {
    barShown = target;
    barSlide = undefined;
  } else if (target !== (barSlide?.to ?? barShown)) {
    barSlide = { from: barShown, to: target, start: performance.now() };
    requestAnimationFrame(stepBar);
    // Frames stop while the window is covered or minimized; the bar still gets where it's going.
    const slide = barSlide;
    setTimeout(() => barSlide === slide && stepBar(slide.start + BAR_SLIDE_MS), BAR_SLIDE_MS + 120);
  }
  sendFrame();
}

function stepBar(now: number) {
  if (!barSlide) return;
  const t = Math.min(1, (now - barSlide.start) / BAR_SLIDE_MS);
  barShown = Math.round(barSlide.from + (barSlide.to - barSlide.from) * (1 - (1 - t) ** 3));
  if (t < 1) requestAnimationFrame(stepBar);
  else barSlide = undefined;
  sendFrame();
}

// The bar (topbar.ts) can't tell from its height alone whether it's thin; this page says so.
const barChannel = windowId ? new BroadcastChannel('perseu-topbar') : undefined;
let barWasThin: boolean | undefined;

function sendFrame() {
  if (!windowId || !lastState) return;
  const layout = frameState ?? {
    sidebar: lastState.sidebarMode as chrome.flechaPrivate.SidebarMode,
    overlay: false,
    topBarPeek: false,
  };
  const state = lastState;
  const thin = (barShown ?? TOP_BAR_HEIGHT) < TOP_BAR_HEIGHT;
  if (thin !== barWasThin) {
    barWasThin = thin;
    barChannel?.postMessage({ window: new URLSearchParams(location.search).get('window'), thin });
  }
  const dark = systemDark.matches;
  const background = state.spaceTheme ? themeTint(state.spaceTheme, dark) : spaceTint(state.tint, dark);
  // A gradient Space: the window fades between its colours, top to bottom, as the sidebar does.
  const gradient = state.spaceTheme
    ? themeFrameColors(state.spaceTheme, dark)
    : state.tints && state.tints.length > 1
      ? state.tints.map((c) => spaceTint(c, dark))
      : undefined;
  // The top bar (topbar.ts), in the page's colour; the window buttons take its text colour. The
  // browser paints the card behind the bar in that colour too, which is all the bare bar (the
  // address in the sidebar) shows: there from the first frame, as the bar's own paint isn't.
  const { bg: topBarBackground, fg: topBarForeground } = topBarColors(lastState.siteColor);
  const { topBarPeek: _peek, ...rest } = layout;
  const base = {
    ...rest,
    // A local request is already on, even if the background's frame hasn't arrived yet.
    overlay: rest.overlay || localOverlays.size > 0,
    background,
    topBar: barShown ?? TOP_BAR_HEIGHT,
    topBarForeground,
    topBarBackground,
  };
  // The frame around the page gets the Space's texture too (a Zen theme's grain);
  // without a theme the browser keeps its own fine grain. The raw state's theme,
  // not the UI's derived spaceGrain: sendFrame sees lastState, not the shown one.
  const grain = state.spaceTheme
    ? { texture: state.spaceTheme.textureType ?? 'none', textureStrength: state.spaceTheme.texture ?? 0 }
    : undefined;
  const plain = grain ? { ...base, ...grain } : base;
  void windowId.then(async (id) => {
    try {
      await chrome.flechaPrivate.setFrame(gradient ? { ...plain, gradient } : plain, id);
    } catch {
      // A browser from before this field rejects the whole frame for it; the frame matters more.
      await chrome.flechaPrivate.setFrame(base, id).catch(() => undefined);
    }
  });
}
on('frame', (state) => {
  frameState = state;
  applyFrame();
});

const paletteListeners: Array<(mode: PaletteMode) => void> = [];
const renameListeners: Array<(tabId: string) => void> = [];
setupWindowUi({ rename: (tabId) => renameListeners.forEach((cb) => cb(tabId)), state: () => lastState });
systemDark.addEventListener('change', () => lastState && emitState(lastState));
// The Zen gradient depends on the sidebar's height, so it is rebuilt when the window resizes.
addEventListener('resize', () => lastState?.spaceTheme && emitState(lastState));

/** The home screen's input. In a window of its own it goes to that window's page, not the main one. */
async function navigateFromHome(input: string) {
  const me = await chrome.tabs.getCurrent();
  const own = me?.id !== undefined && (await chrome.flechaPrivate?.getFlechinhas?.())?.includes(me.windowId);
  if (own) void chrome.tabs.update(me!.id!, { url: resolveInput(input, lastState?.searchEngine) });
  else cmd('navigate')(input);
}

const api: FlechaApi = {
  onState: (cb) => void stateListeners.push(cb),
  // The command bar lives in the sidebar; new tab pages have their own search.
  onPalette: (cb) => {
    if (surface !== 'panel' && surface !== 'window') return;
    paletteListeners.push(cb);
    on('palette', cb);
  },
  onEditSpace: (cb) => on('edit-space', cb),
  onRenameTab: (cb) => {
    renameListeners.push(cb);
    on('rename-tab', cb);
  },
  onPeek: (cb) => on('peek', cb),
  onDownloads: (cb) => on('downloads', cb),
  onTourKey: (cb) => on('tour-key', cb),
  onFlash: (cb) => on('flash', cb),
  ready: cmd('ready'),
  searchHistory: (query) => invoke('searchHistory', query),
  searchSuggestions: (query) => invoke('searchSuggestions', query),
  topSites: () => invoke('topSites'),
  // Extensions can't read other apps' icons; the onboarding falls back to the name.
  appIcon: async () => undefined,
  detectBrowsers: () => invoke('detectBrowsers'),
  importBrowser: (id) => invoke('importBrowser', id),
  importBrowserCookies: (id) => invoke('importBrowserCookies', id),
  // On the new tab page, what you type opens in this tab.
  newTab: surface === 'newtab' ? (input) => void navigateFromHome(String(input)) : cmd('newTab'),
  navigate: cmd('navigate'),
  activate: cmd('activate'),
  close: cmd('close'),
  back: cmd('back'),
  forward: cmd('forward'),
  reload: cmd('reload'),
  stop: cmd('stop'),
  switchSpace: cmd('switchSpace'),
  newSpace: cmd('newSpace'),
  updateSpace: cmd('updateSpace'),
  setOverlay: (name, on) => {
    if (on) localOverlays.add(String(name));
    else localOverlays.delete(String(name));
    cmd('setOverlay')(name, on);
    applyFrame();
  },
  onOpenSitePanel: (cb) => on('site-panel', cb),
  // The song card (nowPlaying.ts).
  onNowPlaying: (cb) => on('now-playing', cb),
  identifySong: cmd('identifySong'),
  mediaControl: cmd('mediaControl'),
  togglePip: cmd('togglePip'),
  seekMedia: cmd('seekMedia'),
  dismissNowPlaying: cmd('dismissNowPlaying'),
  setSpaceIsolated: cmd('setSpaceIsolated'),
  // Electron asks first, in a message box; the page asks in its own dialog.
  deleteSpace: (id) => void confirmDeleteSpace(id),
  // Electron pops native menus; the page draws them, from items the background builds.
  tabMenu: (id) => showMenu('tabMenu', id),
  spaceMenu: (id) => void showMenu('spaceMenu', id),
  sidebarMenu: () => void showMenu('sidebarMenu', ''),
  toggleFolder: cmd('toggleFolder'),
  renameFolder: cmd('renameFolder'),
  deleteFolder: cmd('deleteFolder'),
  setTopBarPeek: cmd('setTopBarPeek'),
  moveTab: cmd('moveTab'),
  clearToday: cmd('clearToday'),
  // Brings over Flecha's own Electron state (~/Library/Application Support/Flecha/flecha-state.json).
  importMenu: async () => {
    // Flecha's native host reads it straight from disk; the file picker is for when it isn't installed.
    const json = await invoke<string | undefined>('nativeHost:flechaState').catch(() => undefined);
    if (json) {
      if (confirm('Replace your Spaces and tabs with those of Flecha (Electron)?')) cmd('importFlechaState')(json);
      return;
    }
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) cmd('importFlechaState')(await file.text());
    };
    input.click();
  },
  // The frame grows over the page first, as in Electron; the side panel just opens it.
  openPalette: surface === 'window' ? cmd('openPalette') : (mode) => paletteListeners.forEach((cb) => cb(mode)),
  closePalette: surface === 'window' ? cmd('closePalette') : () => undefined,
  toggleSidebar: cmd('toggleSidebar'),
  setSidebarPeek: cmd('setSidebarPeek'),
  // The page can write the clipboard itself; the background has no document to do it from.
  copyText: (text, message) => void copy(String(text), typeof message === 'string' ? message : 'Link copied'),
  renameTab: cmd('renameTab'),
  toggleMute: cmd('toggleMute'),
  openArchived: cmd('openArchived'),
  capturePage: cmd('capturePage'),
  clearSiteData: cmd('clearSiteData'),
  clearSiteCache: cmd('clearSiteCache'),
  clearSiteCookies: cmd('clearSiteCookies'),
  getAutoPip: (url) => chrome.flechaPrivate?.getAutoPip?.(url).catch(() => undefined) ?? Promise.resolve(undefined),
  setAutoPip: (url, allowed) => void chrome.flechaPrivate?.setAutoPip?.(url, allowed).catch(() => undefined),
  popupMenu: (items) => localMenu(items),
  setSitePermission: cmd('setSitePermission'),
  zoom: cmd('zoom'),
  openDevTools: cmd('openDevTools'),
  openSettings: cmd('openSettings'),
  toggleResponsive: cmd('toggleResponsive'),
  showConsole: cmd('showConsole'),
  editBoost: cmd('editBoost'),
  openBoostsFolder: cmd('openBoostsFolder'),
  splitWith: cmd('splitWith'),
  togglePin: cmd('togglePin'),
  toggleFavorite: cmd('toggleFavorite'),
  goHome: cmd('goHome'),
  setTabDragging: cmd('setTabDragging'),
  dropToSplit: cmd('dropToSplit'),
  splitNew: cmd('splitNew'),
  closePeek: cmd('closePeek'),
  // Chromium opens a download only in answer to a click, which a message to the background loses.
  openDownload: (id) => {
    if (typeof chrome.downloads?.open !== 'function') return cmd('openDownload')(id);
    void chrome.downloads.search({ id: Number(id) }).then(([item]) => {
      if (item?.state === 'complete') return chrome.downloads.open(item.id);
    });
  },
  revealDownload: cmd('revealDownload'),
  cancelDownload: cmd('cancelDownload'),
  clearDownloads: cmd('clearDownloads'),
  promotePeek: cmd('promotePeek'),
  finishOnboarding: cmd('finishOnboarding'),
  pinSites: cmd('pinSites'),
  wantSiteIcons: cmd('wantSiteIcons'),
  setPreferences: cmd('setPreferences'),
  makeDefaultBrowser: cmd('makeDefaultBrowser'),
  newFlechinha: cmd('newFlechinha'),
  onExtensions: (cb) => on('extensions', cb),
  openExtension: async (id, name, anchor) => {
    if (!windowId) return;
    await chrome.flechaPrivate.openExtensionAction(id, anchor, await windowId).catch(() => cmd('flash')(`${name} isn’t available on this page`));
  },
  extensionMenu: (id) => showMenu('extensionMenu', id),
  reloadMenu: (at) => void showMenu('reloadMenu', '', at),
  moveExtension: cmd('moveExtension'),
  setExtensionsCollapsed: cmd('setExtensionsCollapsed'),
};

window.flecha = api;
