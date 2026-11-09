// The bar on top of the page area (window.html?window=<id>&kind=topbar, flecha_frame_view.cc):
// back, forward and reload, and the site in the middle, in the page's colour.
import './noPageMenu';
import './flechaApi';
import { cmd } from './client';
import { ICONS, type IconName } from './ui/icons';
import { topBarColors } from './lib/topBar';
import type { UiState } from '../shared/types';

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
  const { bg, fg } = topBarColors(s.siteColor, systemDark.matches);
  document.documentElement.style.setProperty('--site-bg', bg);
  document.documentElement.style.setProperty('--site-fg', fg);

  // With the address in the sidebar, so are back, forward and reload.
  $('nav').hidden = !!s.addressInSidebar;
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
  if (blank) return;
  const img = $('site').querySelector('img')!;
  const icon = s.faviconUrl ? s.faviconUrl.replace('%s', encodeURIComponent(tab.url)) : tab.favicon;
  if (icon && img.getAttribute('src') !== icon) img.src = icon;
  $('site').querySelector('.name')!.textContent = siteName(tab.url);
}

api.onState(render);
systemDark.addEventListener('change', () => state && render(state));

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
document.documentElement.addEventListener('mouseleave', () => state?.addressInSidebar && cmd('setTopBarPeek')(false));

$('app-menu').onclick = () => {
  const box = $('app-menu').getBoundingClientRect();
  const left = (state?.sidebarMode === 'docked' ? 260 : 8) + box.left;
  cmd('openAppMenu')(new URLSearchParams(location.search).get('window'), { right: left + box.width, top: 8 + box.bottom + 4 });
};
$('back').onclick = () => api.back();
$('forward').onclick = () => api.forward();
$('reload').onclick = () => (state?.nav.loading ? api.stop() : api.reload());
$('copy').onclick = () => cmd('copyActiveLink')();
$('zoom').onclick = () => cmd('zoom')(0);
// The window page has the command bar; it opens over the window.
$('site').onclick = () => cmd('openPalette')('navigate');
// The window page draws the panel too, under this button: in window coordinates, the bar sits
// past the docked sidebar (or the gap) and kFlechaGap down.
$('site-controls').onclick = () => {
  const box = $('site-controls').getBoundingClientRect();
  const left = (state?.sidebarMode === 'docked' ? 260 : 8) + box.left;
  cmd('openSitePanel')({ left, top: 8 + box.top, width: box.width, height: box.height });
};
