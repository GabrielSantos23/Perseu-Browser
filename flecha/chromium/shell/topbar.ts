// The bar on top of the page area (window.html?window=<id>&kind=topbar, flecha_frame_view.cc):
// back, forward and reload, and the site in the middle, in the page's colour.
import './noPageMenu';
import './flechaApi';
import { cmd } from './client';
import { ICONS, type IconName } from './ui/icons';
import { topBarColors } from './lib/topBar';
import type { ExtensionsView, UiState } from '../shared/types';

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
  // Kept hidden until its size is known, so a mis-placed sky never flashes.
  $('home-sky').hidden = true;
  $('bar').toggleAttribute('data-sky', blank);
  if (blank) {
    renderHomeSky();
    return;
  }
  const img = $('site').querySelector('img')!;
  const icon = s.faviconUrl ? s.faviconUrl.replace('%s', encodeURIComponent(tab.url)) : tab.favicon;
  if (icon && img.getAttribute('src') !== icon) img.src = icon;
  $('site').querySelector('.name')!.textContent = siteName(tab.url);
}

api.onState((s) => {
  render(s);
  renderExtensions();
});

// While the bar is thin (the edge strip along the page's top, or sliding in or out) it draws
// nothing and is no drag ground: the browser leaves the page its own card behind it
// (flecha_frame_host.h TopBarIsThin). The window's frame page says when (flechaApi.ts).
const barWindow = new URLSearchParams(location.search).get('window');
let barThin = innerHeight < 34;
// The word can come a frame before the browser has resized the bar: drawn whole while still the
// thin bar's height, it would cover the gap above for that frame. Whole only at the whole height.
const applyThin = () => document.documentElement.toggleAttribute('data-thin', barThin || innerHeight > 34);
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

/** The night sky in the strip, sized and placed so it continues the page's own sky below. */
function renderHomeSky() {
  const sky = $('home-sky');
  chrome.flechaPrivate?.getWindowSize?.().then(({ width, height }) => {
    // The page area's own geometry (flecha_frame_host.h): gaps of 8 around it,
    // the bar's room of 34 above it. Its width is this strip's width.
    const pageW = document.documentElement.clientWidth;
    const pageH = height - 42 - 8;
    if (pageW <= 0 || pageH <= 0) return;
    const sw = Math.max(pageW, 1.545 * pageH);
    sky.style.setProperty('--sw', `${Math.round(sw)}px`);
    // The image's top edge, from the strip's top (the strip sits at window
    // y 8, the page at window y 42).
    sky.style.setProperty('--img-top', `${Math.round(34 + 0.6 * pageH - 0.3883 * sw)}px`);
    sky.hidden = false;
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

// Retractable when the address lives in the sidebar (edge strip: ui/app.ts).
document.documentElement.addEventListener('mouseenter', () => state?.addressInSidebar && cmd('setTopBarPeek')(true));
// Not when the pointer leaves through the top: the thin strip reaches the window's top but the whole
// bar starts kFlechaGap below it, so a pointer up there would open the bar, find itself above it,
// close it, be under the strip again and open it, on and on. Leaving down (the page) or sideways closes it.
// Judged by where the pointer was last seen in the bar: a leave into another view (the page) carries
// no dependable coordinates of its own.
let pointerY = Infinity;
document.documentElement.addEventListener('mousemove', (e) => (pointerY = e.clientY));
document.documentElement.addEventListener('mouseleave', () => {
  const throughTop = pointerY < 8; // kFlechaGap: the gap above the whole bar
  pointerY = Infinity;
  if (state?.addressInSidebar && !throughTop) cmd('setTopBarPeek')(false);
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
