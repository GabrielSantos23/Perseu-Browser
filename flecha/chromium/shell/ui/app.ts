import { devSuggestions } from './devCommands.js';
import { ICONS, type IconName } from './icons.js';
import { setupOnboarding } from './onboarding.js';
import { spaceTint, DEFAULT_SPACE_COLOR } from '../lib/spaceTint';
import { isDark, luminance } from '../lib/topBar';
import { SPACE_COLORS, SPACE_EMOJIS } from './spaceChoices.js';
import { fieldColor, fieldPoint, nextStop, paintField, throttled } from './colorField.js';
import type { DownloadInfo, DropTarget, ExtensionsView, FlechaApi, HistoryEntry, NowPlaying, PaletteMode, PeekState, PinnedNode, Space, TabInfo, UiState } from '../../shared/types';

declare global {
  interface Window {
    flecha: FlechaApi;
  }
}

const api = window.flecha;
/** Where this page is shown: the Electron window (unset), or the Chromium build's side panel or new tab page. */
const surface = document.documentElement.dataset.surface as 'panel' | 'newtab' | undefined;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const DRAG_TYPE = 'application/x-flecha-tab';

let state: UiState | undefined;

// ---- tiny DOM helper --------------------------------------------------------

type Props = Record<string, unknown> & { class?: string };
function h(tag: string, props: Props = {}, ...children: Array<Node | string | null | undefined>) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    // Native tooltips look out of place; `title` feeds Flecha's own tooltip instead.
    else if (key === 'title') el.dataset.tip = String(value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child != null) el.append(child);
  return el;
}

function svg(path: string) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 16 16');
  el.innerHTML = `<path d="${path}"/>`;
  return el;
}

function icon(name: IconName) {
  return svg(ICONS[name]);
}

// Static markup marks icons as <i data-icon="name">; swap them for the shared SVGs.
for (const el of document.querySelectorAll<HTMLElement>('i[data-icon]')) el.replaceWith(icon(el.dataset.icon as IconName));

function host(url: string) {
  try {
    // Flecha's own pages (Boosts, in the Chromium build) are named, not shown as an extension id.
    if (url.startsWith(location.origin + '/') && location.protocol === 'chrome-extension:') return 'Perseu';
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A stable colour per site, so placeholder icons are told apart at a glance. */
function hueFor(text: string) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

function favicon(tab: TabInfo) {
  // A blank tab shows the home screen, so it carries Perseu's mark (logo.png).
  if (tab.url === 'about:blank') return h('span', { class: 'favicon perseu-mark' });
  const site = host(tab.url);
  const letter = () =>
    h('span', { class: 'favicon letter', style: `--hue: ${hueFor(site)}` }, (site.replace(/^[^a-z0-9]+/i, '')[0] ?? '•').toUpperCase());
  let hostname = '';
  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    // Not a web page.
  }
  // The page's own icon once it has loaded, else the icon Flecha fetched for the site.
  const cached = state?.faviconUrl ? state.faviconUrl.replace('%s', encodeURIComponent(tab.url)) : `favicon://${hostname}`;
  const own = tab.favicon && !blockedIcons.has(tab.favicon) ? tab.favicon : undefined;
  const src = own || (tab.favicon || state?.faviconHosts.includes(hostname) ? cached : state?.faviconUrls?.[hostname]);
  if (!src) return letter();
  // Decorative: the row or tile around it carries the name.
  const img = h('img', { class: 'favicon', src, draggable: 'false', alt: '' }) as HTMLImageElement;
  img.onerror = () => {
    if (own && img.getAttribute('src') === own) {
      blockedIcons.add(own);
      img.src = cached;
    } else img.replaceWith(letter());
  };
  return img;
}

/** Icons a site won't serve to other origins (WhatsApp's CORP header); Chromium's own copy stands in. */
const blockedIcons = new Set<string>();

// The bar above the page (topbar.ts) needs the frame patch (flecha_frame_view.cc).
let lastStripSpace: string | undefined;
const HAS_TOP_BAR = typeof chrome !== 'undefined' && typeof chrome.flechaPrivate?.setFrame === 'function';
document.documentElement.dataset.os = /Mac/.test(navigator.platform) ? 'mac' : 'other';

/** A favorite's tile takes on its icon's main colour, as Arc does; cached per icon. */
const iconTints = new Map<string, string | null>();
function tintFromIcon(tile: HTMLElement, img: HTMLElement) {
  if (!(img instanceof HTMLImageElement)) return;
  const apply = (tint: string | null | undefined) => tint && tile.style.setProperty('--fav-tint', tint);
  if (iconTints.has(img.src)) return void apply(iconTints.get(img.src));
  img.addEventListener(
    'load',
    () => {
      let tint: string | null = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 16, 16);
        const px = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
          // Only opaque, coloured pixels: white, black and grey say nothing about the site.
          if (px[i + 3] < 200 || Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) < 40) continue;
          r += px[i];
          g += px[i + 1];
          b += px[i + 2];
          n++;
        }
        if (n >= 8) tint = `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
      } catch {
        // An icon from another origin can't be read; the tile keeps the plain style.
      }
      iconTints.set(img.src, tint);
      apply(tint);
    },
    { once: true },
  );
}

// ---- rendering ----------------------------------------------------------------

function render(s: UiState) {
  state = s;
  const space = s.spaces.find((sp) => sp.id === s.activeSpaceId) ?? s.spaces[0];
  const active = space.activeTabId ? s.tabs[space.activeTabId] : undefined;
  document.documentElement.style.setProperty('--space-color', s.tint);
  // A gradient Space fades top to bottom, as the window's frame around the page does.
  if (s.tints && s.tints.length > 1) document.documentElement.style.setProperty('--space-gradient', `linear-gradient(to bottom, ${s.tints.join(', ')})`);
  else document.documentElement.style.removeProperty('--space-gradient');
  // The sidebar's text follows its own colour, which can be any colour, not the theme.
  $('sidebar').dataset.ink = isDark(s.tint) ? 'light' : 'dark';
  $('sidebar').toggleAttribute('data-bright', luminance(s.tint) > 0.85);

  ($('btn-back') as HTMLButtonElement).disabled = !s.nav.canGoBack;
  ($('btn-forward') as HTMLButtonElement).disabled = !s.nav.canGoForward;
  $('btn-reload').querySelector('path')?.setAttribute('d', ICONS[s.nav.loading ? 'close' : 'reload']);

  document.body.dataset.sidebar = s.sidebarMode;
  // shortcut: the bar above the page needs a frame patch that isn't built yet, so the address stays in the sidebar until then.
  document.body.dataset.address = s.addressInSidebar || !HAS_TOP_BAR ? 'sidebar' : 'top';
  if (s.sidebarMode !== 'floating') $('sidebar').classList.remove('peek-leaving');
  // Shortcuts can be changed in Settings; key caps and tooltips show the current ones.
  for (const el of document.querySelectorAll<HTMLElement>('[data-shortcut]')) {
    const keys = s.shortcuts[el.dataset.shortcut!] ?? '';
    if (el.tagName === 'KBD') {
      el.textContent = keys;
      el.hidden = !keys;
    } else if (keys) el.dataset.kbd = keys;
    else delete el.dataset.kbd;
  }
  const toggle = $('btn-sidebar');
  toggle.dataset.tip = s.sidebarMode === 'floating' ? 'Keep sidebar open' : 'Hide sidebar';
  renderUrlbar(s, active);
  // In the Chromium build the sidebar and the new tab page are separate pages: the sidebar
  // never draws the empty state, the new tab page always does.
  renderEmptyState(s, space, surface === 'newtab' || (!active && surface !== 'panel'));

  $('favorites').replaceChildren(
    ...space.favorites
      .map((id) => s.tabs[id])
      .filter(Boolean)
      .map((tab) => {
        const active = tab.id === space.activeTabId;
        const img = favicon(tab);
        const el = h('button', { class: `fav${active ? ' active' : ''}`, 'aria-label': tabTitle(tab), 'aria-current': active ? 'page' : undefined }, img, audioBadge(tab));
        tintFromIcon(el, img);
        wireTab(el, tab, { zone: 'favorites', beforeTabId: tab.id });
        return el;
      }),
  );

  if (!$('fav-card').hidden) showFavCard();
  renderLocalServers(s);
  renderAgent(s);

  const title = $('space-title');
  if (title.contentEditable !== 'true') title.textContent = space.name;
  $('space-emoji').textContent = space.emoji ?? '';
  $('space-emoji').hidden = !space.emoji;
  title.dataset.spaceId = space.id;
  $('space-isolated').hidden = !space.isolated;

  // Re-rendering would throw away a tab or folder name being typed in place.
  if (!document.querySelector('#scroll [contenteditable="true"]')) {
    $('pinned').replaceChildren(...space.pinned.map((node) => renderNode(node, space, undefined)));
    $('today').replaceChildren(...todayRows(s, space));
  }

  const spacesStrip = $('spaces');
  const spacesScroll = spacesStrip.scrollLeft;
  spacesStrip.replaceChildren(
    ...s.spaces.map((sp) =>
      h(
        'button',
        {
          class: `space-dot${sp.id === space.id ? ' active' : ''}`,
          dataset: { tip: sp.name },
          'aria-label': sp.name,
          'aria-current': sp.id === space.id ? 'true' : undefined,
          onclick: () => api.switchSpace(sp.id),
          oncontextmenu: (e: Event) => {
            e.preventDefault();
            api.spaceMenu(sp.id);
          },
        },
        sp.emoji ? h('span', { class: 'space-emoji' }, sp.emoji) : h('span', { class: 'space-initial' }, sp.name[0]?.toUpperCase() ?? '•'),
      ),
    ),
  );

  // Rebuilding resets the scroll; only a change of Space moves it, to show the active one.
  spacesStrip.scrollLeft = spacesScroll;
  if (space.id !== lastStripSpace) spacesStrip.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (lastStripSpace && space.id !== lastStripSpace) slideSpace(s.spaces.findIndex((sp) => sp.id === space.id) > s.spaces.findIndex((sp) => sp.id === lastStripSpace) ? 1 : -1);
  lastStripSpace = space.id;

  if (!palette.hidden) updatePalette();
  if (!archivePanel.hidden) renderArchive();
  renderExtensions();
  if (!spaceEditor.hidden) renderSpaceEditor();
  if (!sitePanel.hidden) renderSitePanel();
}

/** A new Space's tabs slide in from the side of its dot in the strip (1: from the right). */
function slideSpace(direction: 1 | -1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.querySelector('.sidebar-main')?.animate(
    [
      { transform: `translateX(${direction * 36}px)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ],
    { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

/** The home screen of an empty Space (and of a new tab): the input, nothing else. */
function renderEmptyState(s: UiState, space: Space, show: boolean) {
  const empty = $('empty-state');
  const wasHidden = empty.hidden;
  empty.hidden = !show;
  if (!show) return;
  $('empty-title').textContent = `New tab in ${space.name}`;
  // Typing can start straight away, as in a new tab's address bar.
  if (wasHidden) requestAnimationFrame(() => $('home-input').focus());
}

/** Host, a padlock or code icon for the kind of connection, and the environment badge. */
function renderUrlbar(s: UiState, active: TabInfo | undefined) {
  const url = active && active.url !== 'about:blank' ? active.url : undefined;
  let kind: IconName = 'search';
  if (url) kind = isDevUrl(url) ? 'code' : url.startsWith('https:') ? 'lock' : url.startsWith('http:') ? 'unlocked' : 'globe';
  $('urlbar-icon').replaceChildren(icon(kind));
  $('urlbar-icon').className = url?.startsWith('http:') && !isDevUrl(url) ? 'insecure' : '';
  $('urlbar-text').textContent = url ? host(url) : 'Search or enter URL';
  $('urlbar').classList.toggle('empty', !url);
  $('urlbar-env').replaceChildren(
    ...(s.environment ? [h('span', { class: `env-badge ${s.environment.tone}`, title: `${s.environment.name} · Ctrl+Alt+E to switch` }, s.environment.label)] : []),
  );
}

/** Shows when a coding agent is connected and what it is doing right now. */
function renderAgent(s: UiState) {
  const status = $('agent-status');
  status.hidden = !s.agent?.connected;
  status.classList.toggle('busy', !!s.agent?.busy);
  $('agent-status-text').textContent = s.agent?.busy ? `Agent is ${s.agent.action}` : 'Agent connected';
}

/** Dev servers on this machine; clicking one goes to its tab, or opens one. */
function renderLocalServers(s: UiState) {
  $('local-servers').hidden = !s.localServers.length;
  $('local-server-list').replaceChildren(
    ...s.localServers.map((server) => {
      const open = Object.values(s.tabs).find((t) => originOf(t.url) === originOf(server.url));
      return h(
        'button',
        {
          class: `row local-server${open ? ' open' : ''}`,
          title: server.url,
          onclick: () => (open ? api.activate(open.id) : api.newTab(server.url)),
        },
        h('span', { class: 'live-dot' }),
        h('span', { class: 'title' }, server.name),
        h('span', { class: 'port' }, `:${server.port}`),
      );
    }),
  );
}

function originOf(url: string) {
  try {
    // localhost and 127.0.0.1 are the same server.
    return new URL(url).origin.replace('127.0.0.1', 'localhost');
  } catch {
    return url;
  }
}

async function folderMenu(folderId: string, name: HTMLElement, current: string, hasTabs: boolean) {
  const picked = await api.popupMenu?.([
    { id: 'rename', label: 'Rename' },
    { separator: true },
    ...(hasTabs ? [{ id: 'keep', label: 'Delete Folder, Keep Tabs' }, { id: 'all', label: 'Delete Folder and Tabs' }] : [{ id: 'keep', label: 'Delete Folder' }]),
  ]);
  if (picked === 'keep' || picked === 'all') return api.deleteFolder(folderId, picked === 'keep');
  if (picked !== 'rename') return;
  // The keys go to the name being edited, so this page takes the focus back from the menu.
  if (HAS_TOP_BAR) await chrome.flechaPrivate.focus('frame');
  editInline(name, current, (value) => api.renameFolder(folderId, value));
}

function renderNode(node: PinnedNode, space: Space, folderId: string | undefined): HTMLElement {
  if (node.kind === 'tab') {
    const tab = state!.tabs[node.tabId];
    return tab ? withChildren(tabRow(tab, space, { zone: 'pinned', folderId, beforeTabId: tab.id }), tab, space) : h('span');
  }
  // A name that starts with an emoji shows it in place of the folder icon, as in Arc.
  const emoji = /^\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*\s*/u.exec(node.name)?.[0];
  const label = emoji ? node.name.slice(emoji.length) : node.name;
  const count = tabCount(node.children);
  const name = h('span', { class: 'title folder-name' }, label);
  const header = h(
    'button',
    {
      class: 'row',
      onclick: () => api.toggleFolder(node.id),
      ondblclick: (e: Event) => {
        e.stopPropagation();
        editInline(name, node.name, (value) => api.renameFolder(node.id, value));
      },
      oncontextmenu: (e: Event) => {
        e.preventDefault();
        void folderMenu(node.id, name, node.name, node.children.length > 0);
      },
    },
    emoji ? h('span', { class: 'row-icon folder-emoji' }, emoji.trim()) : h('span', { class: 'row-icon folder-icon' }, icon(node.open ? 'folderOpen' : 'folder')),
    name,
    h('span', { class: 'chevron' }, icon('chevron')),
    !node.open && count ? h('span', { class: 'folder-count' }, `(${count} ${count === 1 ? 'page' : 'pages'})`) : null,
  );
  header.setAttribute('aria-expanded', String(node.open));
  acceptDrops(header, { zone: 'pinned', folderId: node.id });
  return h(
    'div',
    { class: `folder${node.open ? ' open' : ''}` },
    header,
    h('div', { class: 'folder-children' }, ...node.children.map((child) => renderNode(child, space, node.id))),
  );
}

/** Today's tabs, with the two halves of a split drawn together as one row, as in Arc. */
function tabCount(nodes: PinnedNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === 'tab' ? 1 : tabCount(node.children)), 0);
}

/** Today tabs opened from `parent` (and still in this Space), drawn indented under it. */
function childTabs(parent: TabInfo, space: Space) {
  return space.today.map((id) => state!.tabs[id]).filter((t): t is TabInfo => !!t && t.parentId === parent.id && t.id !== parent.id);
}

/** A tab row followed by the tabs opened from it, as a tree. */
function withChildren(row: HTMLElement, tab: TabInfo, space: Space, seen = new Set<string>()): HTMLElement {
  seen.add(tab.id);
  const kids = childTabs(tab, space).filter((kid) => !seen.has(kid.id) && !space.split?.includes(kid.id));
  if (!kids.length) return row;
  return h(
    'div',
    { class: 'tab-node' },
    row,
    h('div', { class: 'tab-children' }, ...kids.map((kid) => withChildren(tabRow(kid, space, { zone: 'today', beforeTabId: kid.id }), kid, space, seen))),
  );
}

/** Whether a Today tab is drawn under the tab it came from rather than at the top level. */
function isNested(tab: TabInfo, space: Space) {
  if (!tab.parentId || tab.parentId === tab.id || space.split?.includes(tab.id)) return false;
  return space.today.includes(tab.parentId) || pinnedHas(space.pinned, tab.parentId);
}

function pinnedHas(nodes: PinnedNode[], tabId: string): boolean {
  return nodes.some((n) => (n.kind === 'tab' ? n.tabId === tabId : pinnedHas(n.children, tabId)));
}

function todayRows(s: UiState, space: Space): HTMLElement[] {
  const pair = space.split && space.split.every((id) => space.today.includes(id) && s.tabs[id]) ? space.split : undefined;
  const rows: HTMLElement[] = [];
  let pairDrawn = false;
  for (const id of space.today) {
    const tab = s.tabs[id];
    if (!tab || isNested(tab, space)) continue;
    // The row sits where whichever half comes first in the list is; the other half is skipped.
    if (pair && pair.includes(id)) {
      if (pairDrawn) continue;
      pairDrawn = true;
      const [left, right] = pair.map((pid) => s.tabs[pid]);
      const showing = !!space.activeTabId && pair.includes(space.activeTabId);
      rows.push(
        h(
          'div',
          { class: `split-row${showing ? ' showing' : ''}`, title: space.splitMode === 'responsive' ? 'Responsive view' : 'Split view' },
          tabRow(left, space, { zone: 'today', beforeTabId: left.id }),
          tabRow(right, space, { zone: 'today', beforeTabId: right.id }),
        ),
      );
      continue;
    }
    rows.push(withChildren(tabRow(tab, space, { zone: 'today', beforeTabId: tab.id }), tab, space));
  }
  return rows;
}

/** Sound from a pinned tab or favorite, on its icon; a click mutes it. */
function audioBadge(tab: TabInfo) {
  if (!tab.audible && !tab.muted) return null;
  const label = tab.muted ? 'Unmute' : 'Mute';
  return h(
    'span',
    {
      class: 'audio-badge',
      title: label,
      'aria-label': label,
      onclick: (e: Event) => {
        e.stopPropagation();
        api.toggleMute(tab.id);
      },
    },
    icon(tab.muted ? 'muted' : 'volume'),
  );
}

function tabRow(tab: TabInfo, space: Space, target: DropTarget) {
  const close = h(
    'span',
    {
      class: 'close',
      title: target.zone === 'today' ? 'Close tab' : 'Unload tab',
      onclick: (e: Event) => {
        e.stopPropagation();
        api.close(tab.id);
      },
    },
    icon('close'),
  );
  const inSplit = !!space.split?.includes(tab.id) && !!space.activeTabId && space.split.includes(space.activeTabId);
  const row = h(
    'button',
    {
      class: `row${tab.id === space.activeTabId ? ' active' : ''}${inSplit ? ' in-split' : ''}${tab.loading ? ' loading' : ''}${
        state?.agent?.busy && state.agent.tabId === tab.id ? ' agent-driving' : ''
      }`,
      'aria-current': tab.id === space.activeTabId ? 'page' : undefined,
    },
    target.zone === 'pinned' ? h('span', { class: 'icon-stack' }, favicon(tab), audioBadge(tab)) : favicon(tab),
    h('span', { class: 'title' }, tabTitle(tab)),
    target.zone !== 'pinned' && (tab.audible || tab.muted)
      ? h(
          'span',
          {
            class: `audio-mark${tab.muted ? ' muted' : ''}`,
            title: tab.muted ? 'Unmute' : 'Mute',
            onclick: (e: Event) => {
              e.stopPropagation();
              api.toggleMute(tab.id);
            },
          },
          icon(tab.muted ? 'muted' : 'volume'),
        )
      : null,
    errorBadge(tab),
    isBoosted(tab.url) ? h('span', { class: 'boost-mark', title: 'Boosted: your script or styles for this site run here' }, icon('zap')) : null,
    tab.device === 'mobile'
      ? h('span', { class: 'device-badge', title: 'Phone-sized mirror' }, icon('phone'))
      : h('span', { class: 'split-badge', title: 'In split view' }, icon('columns')),
    target.zone === 'pinned' ? h('span', { class: 'pin-mark', 'aria-label': 'Pinned' }, icon('lock')) : null,
    // Where the close button is, while the page loads; hovering brings the button back.
    // The delay keeps the spin in phase when the sidebar redraws the row.
    tab.loading ? h('span', { class: 'spin', role: 'img', 'aria-label': 'Loading', style: `--spin-phase: -${Date.now() % 800}ms` }) : null,
    close,
  );
  wireTab(row, tab, target);
  return row;
}

/** Red count of console errors, only on pages you're developing (local URLs). */
function errorBadge(tab: TabInfo) {
  const count = state?.consoleErrors[tab.id];
  if (!count || !isDevUrl(tab.url)) return null;
  return h(
    'span',
    {
      class: 'error-badge',
      title: `${count} console error${count === 1 ? '' : 's'} · click to open the Console`,
      onclick: (e: Event) => {
        e.stopPropagation();
        api.showConsole(tab.id);
      },
    },
    count > 99 ? '99+' : String(count),
  );
}

function isBoosted(url: string) {
  try {
    const { hostname } = new URL(url);
    return !!state?.boostedHosts.some((h) => h !== 'all' && (hostname === h || hostname.endsWith(`.${h}`)));
  } catch {
    return false;
  }
}

function isDevUrl(url: string) {
  try {
    const { hostname } = new URL(url);
    return /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|local|test)$/.test(hostname);
  } catch {
    return false;
  }
}

function tabTitle(tab: TabInfo) {
  return tab.customTitle || tab.title || host(tab.url);
}

/** Inline rename of a tab row, started from the tab's context menu. */
function renameTab(tabId: string) {
  const row = document.querySelector<HTMLElement>(`.row[data-tab-id="${CSS.escape(tabId)}"] .title`);
  const tab = state?.tabs[tabId];
  if (!row || !tab) return;
  editInline(row, tabTitle(tab), (title) => api.renameTab(tabId, title));
}

function wireTab(el: HTMLElement, tab: TabInfo, target: DropTarget) {
  el.dataset.tabId = tab.id;
  el.classList.toggle('asleep', !state?.liveTabs.includes(tab.id));
  el.draggable = true;
  el.addEventListener('click', () => api.activate(tab.id));
  el.addEventListener('auxclick', (e) => e.button === 1 && api.close(tab.id));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    api.tabMenu(tab.id);
  });
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer!.setData(DRAG_TYPE, tab.id);
    e.dataTransfer!.effectAllowed = 'move';
    $('favorites').classList.add('show-empty');
    showSplitDrop(tab.id);
  });
  el.addEventListener('dragend', () => {
    $('favorites').classList.remove('show-empty');
    hideSplitDrop();
  });
  acceptDrops(el, target, 'drop-before');
}

function acceptDrops(el: HTMLElement, target: DropTarget, hoverClass = 'drag-over') {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add(hoverClass);
  });
  el.addEventListener('dragleave', () => el.classList.remove(hoverClass));
  el.addEventListener('drop', (e) => {
    el.classList.remove(hoverClass);
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    api.moveTab(id, target);
  });
}

function editInline(el: HTMLElement, current: string, commit: (value: string) => void) {
  el.contentEditable = 'true';
  el.textContent = current;
  el.focus();
  document.getSelection()?.selectAllChildren(el);
  const finish = (save: boolean) => {
    el.removeEventListener('keydown', onKey);
    el.removeEventListener('blur', onBlur);
    el.contentEditable = 'false';
    const value = el.textContent?.trim() ?? '';
    if (save && value && value !== current) commit(value);
    else if (state) render(state);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault(), finish(true);
    if (e.key === 'Escape') finish(false);
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey);
  el.addEventListener('blur', onBlur);
}

// ---- site panel (the sliders button in the address bar) ------------------------------

const sitePanel = $('site-panel');
// Directly in the page: the sidebar it opens from may be collapsed, and it hangs from the top bar too.
document.body.append(sitePanel);
/** The button the panel hangs from: the sidebar's sliders, or the title bar's. */
let siteAnchor: HTMLElement | undefined;

function activeTab() {
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  return space?.activeTabId ? state?.tabs[space.activeTabId] : undefined;
}

function toggleSitePanel(open = sitePanel.hidden, anchor: HTMLElement = siteAnchor ?? $('btn-site')) {
  const wasOpen = !sitePanel.hidden;
  sitePanel.hidden = !open || !activeTab();
  siteAnchor?.setAttribute('aria-expanded', 'false');
  // Out in the title bar the panel is beyond the sidebar strip, so the frame covers the window.
  const outside = (el: HTMLElement) => framedWindow && el.getBoundingClientRect().left >= $('sidebar').getBoundingClientRect().right;
  if (sitePanel.hidden) {
    if (wasOpen && siteAnchor && outside(siteAnchor)) api.setOverlay?.('site-panel', false);
    siteAnchor = undefined;
    return;
  }
  spaceEditor.hidden = true;
  downloadsPanel.hidden = true;
  archivePanel.hidden = true;
  if (siteAnchor !== anchor && outside(anchor)) api.setOverlay?.('site-panel', true);
  siteAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  renderSitePanel();
  placeSitePanel(anchor);
}

/** Centred under the button, kept inside the window; the arrow points at the button. */
function placeSitePanel(anchor: HTMLElement) {
  const box = anchor.getBoundingClientRect();
  const width = sitePanel.offsetWidth;
  const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), innerWidth - width - 8);
  sitePanel.style.left = `${Math.round(left)}px`;
  sitePanel.style.top = `${Math.round(box.bottom + 10)}px`;
  sitePanel.style.setProperty('--arrow-x', `${Math.round(box.left + box.width / 2 - left)}px`);
}

// Opened from the top bar, the frame only grows over the window after the panel is up.
window.addEventListener('resize', () => !sitePanel.hidden && siteAnchor && placeSitePanel(siteAnchor));

/** The page's origin, or '' for pages that aren't on the web (new tab, settings). */
function siteOrigin(url: string) {
  return /^https?:\/\//.test(url) ? new URL(url).origin : '';
}

function renderSitePanel() {
  const tab = activeTab();
  if (!tab || !state) return toggleSitePanel(false);
  const origin = siteOrigin(tab.url);
  const secure = tab.url.startsWith('https:');
  const local = isDevUrl(tab.url);
  const chip = $('site-security');
  chip.hidden = !origin;
  chip.className = `site-chip${!secure && !local ? ' insecure' : ''}`;
  chip.replaceChildren(icon(secure || local ? 'lock' : 'unlocked'), h('span', {}, local ? 'Local' : secure ? 'Secure' : 'Not Secure'));
  $<HTMLButtonElement>('site-share').disabled = !origin;
  // Zoom only shows once the page is zoomed, as in Arc; Ctrl + and Ctrl − still work.
  $('site-zoom').hidden = state.nav.zoom === 100;
  $('zoom-reset').textContent = `${state.nav.zoom}%`;
  const pip = $('site-autopip');
  if (!origin || !api.getAutoPip) pip.hidden = true;
  else
    void api.getAutoPip(tab.url).then((allowed) => {
      pip.hidden = allowed === undefined;
      $<HTMLInputElement>('site-autopip-toggle').checked = !!allowed;
    });
}

// ---- extensions ---------------------------------------------------------------

const EXTENSION_DRAG = 'application/x-flecha-extension';
const WEB_STORE = 'https://chromewebstore.google.com/';
const pageHasExtensions = 'frame' in document.documentElement.dataset && !('incognito' in document.documentElement.dataset);
let extensions: ExtensionsView = { items: [], collapsed: false };

/** Opens beside the sidebar, level with the button, as a toolbar button's popup hangs under it. */
function openExtension(button: HTMLElement, id: string, name: string) {
  const row = button.getBoundingClientRect();
  // From the site panel it takes the panel's place, wherever that was opened.
  const panel = sitePanel.contains(button) ? sitePanel.getBoundingClientRect() : undefined;
  const anchor = panel
    ? { x: Math.round(panel.left), y: Math.round(panel.top), width: 1, height: 1 }
    : { x: Math.round($('sidebar').getBoundingClientRect().right) + 6, y: Math.round(row.top), width: 1, height: Math.round(row.height) };
  toggleSitePanel(false);
  api.openExtension(id, name, anchor);
}

function extensionButton(extension: ExtensionsView['items'][number]): HTMLElement {
  const letter = () => h('span', { class: 'favicon letter', style: `--hue: ${hueFor(extension.name)}` }, extension.name[0]?.toUpperCase() ?? '•');
  const image = extension.icon ? (h('img', { src: extension.icon, draggable: 'false', alt: '' }) as HTMLImageElement) : letter();
  if (image instanceof HTMLImageElement) image.onerror = () => image.replaceWith(letter());
  const button: HTMLElement = h(
    'button',
    {
      class: 'extension',
      title: extension.name,
      'aria-label': extension.name,
      draggable: 'true',
      dataset: { extension: extension.id },
      onclick: () => openExtension(button, extension.id, extension.name),
      oncontextmenu: (e: Event) => {
        e.preventDefault();
        toggleSitePanel(false);
        api.extensionMenu(extension.id);
      },
      ondragstart: (e: DragEvent) => e.dataTransfer?.setData(EXTENSION_DRAG, extension.id),
      ondragover: (e: DragEvent) => {
        if (e.dataTransfer?.types.includes(EXTENSION_DRAG)) e.preventDefault();
      },
      ondrop: (e: DragEvent) => {
        const dragged = e.dataTransfer?.getData(EXTENSION_DRAG);
        if (!dragged || dragged === extension.id) return;
        e.preventDefault();
        const box = button.getBoundingClientRect();
        const after = e.clientX > box.left + box.width / 2;
        const before = after ? (button.nextElementSibling as HTMLElement | null)?.dataset.extension : extension.id;
        api.moveExtension(dragged, before);
      },
    },
    image,
  );
  return button;
}

/** Extensions live in the site panel, as in Arc: the ones pinned (everywhere or in this Space) first. */
function renderExtensions() {
  $('site-extensions').hidden = !pageHasExtensions;
  const here = state?.spaces.find((sp) => sp.id === state!.activeSpaceId)?.pinnedExtensions ?? [];
  const pinned = (extension: ExtensionsView['items'][number]) => extension.pinned || here.includes(extension.id);
  const inSidebar = pageHasExtensions ? extensions.items.filter(pinned) : [];
  $('pinned-extensions').replaceChildren(...inSidebar.map(extensionButton));
  $('pinned-extensions').hidden = !inSidebar.length;
  $('site-extension-list').replaceChildren(
    ...[...extensions.items.filter(pinned), ...extensions.items.filter((extension) => !pinned(extension))].map(extensionButton),
    h('button', { class: 'extension', title: 'Add extensions', 'aria-label': 'Add extensions', onclick: () => (toggleSitePanel(false), api.newTab(WEB_STORE)) }, icon('plus')),
  );
}

api.onExtensions((view) => {
  extensions = view;
  renderExtensions();
  if (!spaceEditor.hidden) renderSpaceEditor();
});
renderExtensions();
// Any button marked data-opens="site-panel" (the sidebar's, the title bar's) opens the panel under itself.
document.addEventListener('click', (e) => {
  const button = (e.target as Element).closest<HTMLElement>('[data-opens="site-panel"]');
  if (button) toggleSitePanel(sitePanel.hidden || siteAnchor !== button, button);
});
// The top bar's site controls: the panel hangs from a stand-in at the button's place here.
api.onOpenSitePanel?.((rect) => {
  let stand = document.getElementById('top-bar-anchor');
  if (!stand) {
    stand = document.createElement('span');
    stand.id = 'top-bar-anchor';
    stand.setAttribute('aria-hidden', 'true');
    stand.style.cssText = 'position: fixed; pointer-events: none;';
    document.body.append(stand);
  }
  Object.assign(stand.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  toggleSitePanel(sitePanel.hidden || siteAnchor !== stand, stand);
});
$('btn-copy-link').onclick = () => {
  const tab = activeTab();
  if (tab) api.copyText(tab.url);
};
$('site-share').onclick = async () => {
  const tab = activeTab();
  toggleSitePanel(false);
  if (!tab) return;
  // Windows' share sheet; copying is the fallback where there is none.
  if (!navigator.share) return api.copyText(tab.url);
  await navigator.share({ url: tab.url, title: tab.title }).catch((err: DOMException) => err.name !== 'AbortError' && api.copyText(tab.url));
};
$('site-autopip-toggle').addEventListener('change', (e) => {
  const tab = activeTab();
  if (tab) api.setAutoPip?.(tab.url, (e.target as HTMLInputElement).checked);
});
$('site-more').onclick = async () => {
  const tab = activeTab();
  const origin = tab ? siteOrigin(tab.url) : '';
  if (!origin || !api.popupMenu) return;
  const picked = await api.popupMenu([
    { id: 'shot', label: 'Take Screenshot' },
    { id: 'boost', label: 'Boost This Site' },
    { separator: true },
    { id: 'cache', label: 'Clear Cache' },
    { id: 'cookies', label: 'Clear Cookies' },
    { separator: true },
    { id: 'manage', label: 'Manage Extensions' },
    { id: 'add', label: 'Add Extension' },
    { separator: true },
    { id: 'settings', label: 'All Site Settings' },
  ]);
  if (!picked) return;
  toggleSitePanel(false);
  if (picked === 'shot') api.capturePage();
  else if (picked === 'boost') api.editBoost('script');
  else if (picked === 'cache') api.clearSiteCache?.(origin);
  else if (picked === 'cookies') api.clearSiteCookies?.(origin);
  else if (picked === 'manage') api.newTab('chrome://extensions/');
  else if (picked === 'add') api.newTab(WEB_STORE);
  else if (picked === 'settings') api.newTab(`chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`);
};
$('zoom-in').onclick = () => api.zoom(1);
$('zoom-out').onclick = () => api.zoom(-1);
$('zoom-reset').onclick = () => api.zoom(0);
document.addEventListener('mousedown', (e) => {
  const target = e.target as Element;
  if (!sitePanel.hidden && !sitePanel.contains(target) && !target.closest?.('[data-opens="site-panel"], .shell-menu-layer')) toggleSitePanel(false);
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && !sitePanel.hidden && toggleSitePanel(false));
// Scrolling sideways over the sidebar (a trackpad swipe, a mouse's thumb wheel) changes
// Space, one per gesture: the scroll adds up to a step, then waits for the gesture to end.
const SPACE_SWIPE_STEP = 60;
let swipe = 0;
let swipeDone = false;
let swipeEnd: number | undefined;
$('sidebar').addEventListener(
  'wheel',
  (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || !state) return;
    e.preventDefault();
    clearTimeout(swipeEnd);
    swipeEnd = window.setTimeout(() => {
      swipe = 0;
      swipeDone = false;
    }, 250);
    if (swipeDone) return;
    swipe += e.deltaX;
    if (Math.abs(swipe) < SPACE_SWIPE_STEP) return;
    swipeDone = true;
    const spaces = state.spaces;
    const i = spaces.findIndex((sp) => sp.id === state!.activeSpaceId);
    const next = spaces[i + (swipe > 0 ? 1 : -1)];
    if (next) api.switchSpace(next.id);
  },
  { passive: false },
);

// A click on the page takes the focus from the sidebar's page: that closes the panel too.
// From the top bar the frame page never had focus to lose; a click on it closes the panel instead.
window.addEventListener('blur', () => !sitePanel.hidden && siteAnchor?.id !== 'top-bar-anchor' && toggleSitePanel(false));

// Confirmations ("Link copied") pop up at the top left for a moment.
let flashTimer: number | undefined;
api.onFlash((message) => {
  if (framedWindow) return; // The top bar shows it.
  const toast = $('toast');
  $('toast-text').textContent = message;
  toast.hidden = false;
  // Restart the entrance animation when a second confirmation replaces the first.
  toast.classList.remove('leaving');
  toast.style.animation = 'none';
  void toast.offsetWidth;
  toast.style.animation = '';
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    toast.classList.add('leaving');
    flashTimer = window.setTimeout(() => (toast.hidden = true), 200);
  }, 1600);
});

// ---- Space editor -------------------------------------------------------------------

const spaceEditor = $('space-editor');
const spaceName = $<HTMLInputElement>('space-name');
let editingSpace: string | undefined;

/** With the browser's frame, the menu opens beside the sidebar, over the page, as in Arc. */
const framedWindow = 'frame' in document.documentElement.dataset;

function openSpaceEditor(spaceId: string) {
  editingSpace = spaceId;
  keepPeek();
  downloadsPanel.hidden = true;
  archivePanel.hidden = true;
  toggleSitePanel(false);
  // The frame page is only as wide as the sidebar; it covers the window while the menu is up.
  if (framedWindow) api.setOverlay?.('space-menu', true);
  const header = $('space-header');
  spaceEditor.style.top = `${Math.max(8, Math.round(header.getBoundingClientRect().top) - 10)}px`;
  header.classList.add('open');
  header.setAttribute('aria-expanded', 'true');
  spaceEditor.hidden = false;
  $('space-emojis').hidden = true;
  renderSpaceEditor();
  spaceName.focus();
  spaceName.select();
}

function closeSpaceEditor() {
  if (spaceEditor.hidden) return;
  editingSpace = undefined;
  spaceEditor.hidden = true;
  const header = $('space-header');
  header.classList.remove('open');
  header.setAttribute('aria-expanded', 'false');
  if (framedWindow) api.setOverlay?.('space-menu', false);
}

// ---- Space colours: presets, a field with up to three dots (a gradient), and the exact hex ----

/** Which of the Space's colours the presets, the field and the hex field change. */
let colorIndex = 0;
const colorField = $<HTMLCanvasElement>('space-color-field');
const colorHex = $<HTMLInputElement>('space-color-hex');

paintField(colorField);

const spaceColorsOf = (space: Space) => (space.colors?.length ? space.colors : [space.color === DEFAULT_SPACE_COLOR ? spaceTint(DEFAULT_SPACE_COLOR, false) : space.color]);

function setSpaceColor(color: string) {
  const space = state?.spaces.find((s) => s.id === editingSpace);
  if (!space) return;
  const colors = [...spaceColorsOf(space)];
  colors[Math.min(colorIndex, colors.length - 1)] = color;
  api.updateSpace(space.id, { colors });
}

const presetSwatches = SPACE_COLORS.map(
  (color) =>
    h('button', {
      class: 'swatch',
      style: `--swatch: ${color}`,
      title: color,
      onclick: () => setSpaceColor(color),
    }) as HTMLElement,
);
$('space-colors').replaceChildren(...presetSwatches);
$('space-color-reset').onclick = () => {
  colorIndex = 0;
  if (editingSpace) api.updateSpace(editingSpace, { color: DEFAULT_SPACE_COLOR });
};
$('space-color-add').onclick = () => {
  const space = state?.spaces.find((s) => s.id === editingSpace);
  if (!space) return;
  const colors = spaceColorsOf(space);
  if (colors.length >= 3) return;
  colorIndex = colors.length;
  api.updateSpace(space.id, { colors: [...colors, nextStop(colors[colors.length - 1])] });
};

// Dragging a dot (or pressing the field) changes the selected colour: the dot follows the pointer at once, the Space a few times a second.
const dragSend = throttled(setSpaceColor);
colorField.parentElement!.addEventListener('pointerdown', (e) => {
  const space = state?.spaces.find((s) => s.id === editingSpace);
  if (!space) return;
  const dot = (e.target as Element).closest<HTMLElement>('.color-dot');
  if (dot) colorIndex = Number(dot.dataset.index);
  const box = colorField.getBoundingClientRect();
  const move = (ev: PointerEvent) => {
    const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
    const color = fieldColor(x, y);
    const shown = document.querySelector<HTMLElement>('#space-color-dots .color-dot.selected');
    if (shown) Object.assign(shown.style, { left: `${x * 100}%`, top: `${y * 100}%` }), shown.style.setProperty('--dot', color);
    dragSend.push(color);
  };
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);
  move(e);
  target.addEventListener('pointermove', move);
  const end = () => {
    target.removeEventListener('pointermove', move);
    dragSend.flush();
  };
  target.addEventListener('pointerup', end, { once: true });
  target.addEventListener('pointercancel', end, { once: true });
});
colorHex.addEventListener('input', () => {
  const value = colorHex.value.trim().replace(/^#?/, '#').toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) setSpaceColor(value);
});
colorHex.addEventListener('keydown', (e) => e.key === 'Enter' && colorHex.blur());

function renderSpaceColors(space: Space) {
  const isDefault = space.color === DEFAULT_SPACE_COLOR;
  const colors = spaceColorsOf(space);
  colorIndex = Math.min(colorIndex, colors.length - 1);
  const current = colors[colorIndex];
  presetSwatches.forEach((swatch, i) => swatch.classList.toggle('selected', !isDefault && SPACE_COLORS[i] === current));
  $('space-color-dots').replaceChildren(
    ...colors.map((color, i) => {
      const { x, y } = fieldPoint(color);
      return h('span', { class: `color-dot${i === colorIndex ? ' selected' : ''}`, dataset: { index: String(i) }, style: `--dot: ${color}; left: ${x * 100}%; top: ${y * 100}%` });
    }),
  );
  $('space-color-chips').replaceChildren(
    ...colors.map((color, i) =>
      h(
        'button',
        {
          class: 'color-chip',
          role: 'radio',
          'aria-checked': String(i === colorIndex),
          'aria-label': `Colour ${i + 1}: ${color}`,
          style: `--swatch: ${color}`,
          'aria-keyshortcuts': colors.length > 1 ? 'Delete' : undefined,
          onclick: () => {
            colorIndex = i;
            renderSpaceColors(space);
          },
          // The keyboard's way to the remove mark.
          onkeydown: (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && colors.length > 1) {
              colorIndex = Math.max(0, i - 1);
              api.updateSpace(space.id, { colors: colors.filter((_, j) => j !== i) });
            }
          },
        },
        colors.length > 1
          ? h(
              'span',
              {
                class: 'remove',
                'aria-label': 'Remove this colour',
                title: 'Remove this colour',
                onclick: (e: Event) => {
                  e.stopPropagation();
                  colorIndex = Math.max(0, i - 1);
                  api.updateSpace(space.id, { colors: colors.filter((_, j) => j !== i) });
                },
              },
              icon('close'),
            )
          : null,
      ),
    ),
  );
  $('space-color-add').hidden = colors.length >= 3;
  if (document.activeElement !== colorHex) colorHex.value = current.slice(1);
  $<HTMLButtonElement>('space-color-reset').disabled = isDefault;
}

function renderSpaceEditor() {
  const space = state?.spaces.find((s) => s.id === editingSpace);
  if (!space) return closeSpaceEditor();
  if (document.activeElement !== spaceName) spaceName.value = space.name;
  $('space-icon').replaceChildren(space.emoji ? h('span', {}, space.emoji) : icon('space'));
  $('space-emojis').replaceChildren(
    h('button', { class: `emoji${space.emoji ? '' : ' selected'}`, title: 'No icon', onclick: () => api.updateSpace(space.id, { emoji: '' }) }, icon('close')),
    ...SPACE_EMOJIS.map((emoji) =>
      h('button', { class: `emoji${space.emoji === emoji ? ' selected' : ''}`, onclick: () => api.updateSpace(space.id, { emoji }) }, emoji),
    ),
  );
  renderSpaceColors(space);
  $<HTMLSelectElement>('space-profile').value = space.isolated ? 'separate' : 'shared';
  // Every installed extension; the ones pinned everywhere show as pinned and stay so here.
  const pinnedHere = space.pinnedExtensions ?? [];
  $('space-extensions-hint').textContent = extensions.items.length ? 'Pin extensions to this Space:' : 'No extensions installed yet.';
  $('space-extensions').replaceChildren(
    ...extensions.items.map((extension) => {
      const everywhere = extension.pinned;
      const on = everywhere || pinnedHere.includes(extension.id);
      const letter = () => h('span', { class: 'favicon letter', style: `--hue: ${hueFor(extension.name)}` }, extension.name[0]?.toUpperCase() ?? '•');
      const image = extension.icon ? (h('img', { src: extension.icon, draggable: 'false', alt: '' }) as HTMLImageElement) : letter();
      if (image instanceof HTMLImageElement) image.onerror = () => image.replaceWith(letter());
      return h(
        'button',
        {
          class: `sm-extension${on ? ' on' : ''}`,
          'aria-pressed': String(on),
          'aria-label': extension.name,
          title: everywhere ? `${extension.name} · pinned in every Space` : extension.name,
          disabled: everywhere,
          onclick: () =>
            api.updateSpace(space.id, {
              pinnedExtensions: on ? pinnedHere.filter((id) => id !== extension.id) : [...pinnedHere, extension.id],
            }),
        },
        image,
      );
    }),
  );
  $<HTMLButtonElement>('space-delete').disabled = state!.spaces.length < 2;
}

spaceName.addEventListener('input', () => editingSpace && spaceName.value.trim() && api.updateSpace(editingSpace, { name: spaceName.value }));
spaceName.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === 'Escape') && closeSpaceEditor());
$('space-profile').addEventListener('change', (e) => {
  if (editingSpace) api.setSpaceIsolated(editingSpace, (e.target as HTMLSelectElement).value === 'separate');
});
$('space-icon').onclick = () => {
  const grid = $('space-emojis');
  grid.hidden = !grid.hidden;
  $('space-icon').setAttribute('aria-expanded', String(!grid.hidden));
};
$('space-manage-extensions').onclick = () => {
  closeSpaceEditor();
  api.newTab('chrome://extensions/');
};
$('space-delete').onclick = () => {
  if (!editingSpace) return;
  api.deleteSpace(editingSpace);
  closeSpaceEditor();
};
document.addEventListener('mousedown', (e) => {
  const target = e.target as Node;
  if (!spaceEditor.hidden && !spaceEditor.contains(target) && !$('space-header').contains(target)) closeSpaceEditor();
});
document.addEventListener('keydown', (e) => e.key === 'Escape' && !spaceEditor.hidden && closeSpaceEditor());

// ---- command bar ----------------------------------------------------------------

interface PaletteItem {
  group: PaletteGroup;
  /** An icon name, a tab (its favicon) or a URL (that site's icon). */
  icon: IconName | TabInfo | string;
  label: string;
  sub: string;
  /** A keyboard shortcut for the same command, shown on the right. */
  hint?: string;
  run: () => void;
  /** Shown under the results while this item is selected, e.g. a decoded JWT. */
  detail?: string;
  /** A bang's site: the row reads like a sentence, ending in this chip. */
  bang?: { tag: string; name: string; active?: boolean };
}

const palette = $('palette');
const paletteInput = $<HTMLInputElement>('palette-input');
const paletteList = $('palette-results');
let paletteMode: PaletteMode = 'new-tab';
let paletteItems: PaletteItem[] = [];
// Opened with nothing to list (no tabs): just the field, until there is something to show.
let paletteBare = false;
let selected = 0;
/** DuckDuckGo's bangs as { tag: site name } (build-bangs.mjs), once the first `!` was typed. */
let bangNames: Record<string, string> = {};
let bangsLoading: Promise<void> | undefined;
/** The bang turned into a chip by Space: what's typed then searches that site. */
let paletteBang: { tag: string; name: string } | undefined;
const PALETTE_PLACEHOLDER = paletteInput.placeholder;

function loadBangs() {
  bangsLoading ??= fetch('bangs.json')
    .then((res) => res.json())
    .then((names) => {
      bangNames = names;
      if (!palette.hidden) updatePalette();
    })
    .catch((err) => console.error('Perseu: no bang list', err));
}

/** The bang that is all of the text so far (`!gh`), if DuckDuckGo knows it. */
function typedBang(input = paletteInput) {
  const tag = /^!([\w.-]+)$/.exec(input.value)?.[1].toLowerCase();
  return tag && Object.hasOwn(bangNames, tag) ? { tag, name: bangNames[tag] } : undefined;
}

function setPaletteBang(bang: typeof paletteBang, text: string) {
  paletteBang = bang;
  paletteInput.value = text;
  paletteInput.focus();
  paletteChanged();
}

function looksLikeUrl(q: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(q) || (!/\s/.test(q) && /\.[a-z]{2,}(:\d+)?(\/|$)/i.test(q)) || /^localhost(:\d+)?/.test(q);
}

function openPalette(mode: PaletteMode) {
  paletteMode = mode;
  palette.hidden = false;
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  const active = space?.activeTabId ? state?.tabs[space.activeTabId] : undefined;
  paletteInput.value = mode === 'navigate' && active ? active.url : '';
  paletteInput.focus();
  paletteInput.select();
  selected = 0;
  historyResults = [];
  paletteBang = undefined;
  paletteBare = true;
  updatePalette();
  refreshHistory();
}

function closePalette() {
  if (palette.hidden) return;
  palette.hidden = true;
  api.closePalette();
}

type PaletteGroup = '' | 'Developer' | 'Actions' | 'Frequently visited' | 'Suggestions' | 'Tabs' | 'History' | 'Archive';

/** Commands the bar can run, found by typing any word of their label or keywords. */
const ACTIONS: Array<{ label: string; keywords: string; icon: IconName; shortcut?: string; run: () => void }> = [
  { label: 'New Space', keywords: 'space create add', icon: 'space', shortcut: 'newSpace', run: () => api.newSpace() },
  { label: 'Edit Space', keywords: 'space rename emoji colour color icon', icon: 'space', run: () => state && openSpaceEditor(state.activeSpaceId) },
  { label: 'New Mini Window', keywords: 'flechinha little mini small window quick lookup', icon: 'miniWindow', shortcut: 'newFlechinha', run: () => api.newFlechinha() },
  { label: 'Settings', keywords: 'preferences settings config options', icon: 'settings', shortcut: 'settings', run: () => api.openSettings() },
  { label: 'Responsive View', keywords: 'mobile phone responsive device split', icon: 'phone', shortcut: 'responsive', run: () => api.toggleResponsive() },
  { label: 'Toggle Sidebar', keywords: 'sidebar hide show', icon: 'sidebar', shortcut: 'toggleSidebar', run: () => api.toggleSidebar() },
  { label: 'Clear Today Tabs', keywords: 'clear archive today close', icon: 'archive', shortcut: 'clearToday', run: () => api.clearToday() },
  { label: 'Show Downloads', keywords: 'downloads files', icon: 'download', run: () => (downloadsPanel.hidden = false) },
  { label: 'Show Archived Tabs', keywords: 'archive archived closed tabs old', icon: 'archive', run: () => ((archivePanel.hidden = false), renderArchive()) },
  {
    label: 'Import from another browser',
    keywords: 'import migrate bookmarks history arc dia chrome safari firefox brave edge vivaldi opera',
    icon: 'import',
    run: () => api.openSettings('import'),
  },
  {
    label: 'Import a Perseu Backup',
    keywords: 'import migrate electron flecha spaces tabs',
    icon: 'import',
    run: () => api.importMenu(),
  },
  { label: 'Open Boosts', keywords: 'boosts folder scripts css', icon: 'zap', run: () => api.openBoostsFolder() },
];

const FREQUENT_VISITS = 5;

function matchingActions(q: string) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || q.length < 2) return [];
  return ACTIONS.filter((a) => {
    const haystack = `${a.label} ${a.keywords}`.toLowerCase().split(/\s+/);
    return words.every((w) => haystack.some((h) => h.startsWith(w)));
  });
}

function itemIcon(source: IconName | TabInfo | string) {
  if (typeof source === 'object') return favicon(source);
  if (source in ICONS) return icon(source as IconName);
  // A URL: show its site's icon, as if it were a tab.
  return favicon({ id: '', url: source, title: '', lastActive: 0 });
}

function updatePalette() {
  if (!state) return;
  const q = paletteInput.value.trim();
  const lower = q.toLowerCase();
  const matches = (title: string, url: string) => !lower || title.toLowerCase().includes(lower) || url.toLowerCase().includes(lower);
  const items: PaletteItem[] = [];
  const open = { navigate: api.navigate, 'new-tab': api.newTab, split: api.splitNew }[paletteMode];
  const activeId = state.spaces.find((s) => s.id === state!.activeSpaceId)?.activeTabId;
  const activeUrl = activeId ? state.tabs[activeId]?.url : undefined;

  $('palette-mode').textContent = { navigate: 'Current Tab', split: 'Split View', 'new-tab': '' }[paletteMode];

  if (q) {
    const isUrl = looksLikeUrl(q);
    const searchItem: PaletteItem = {
      group: '',
      icon: isUrl ? 'globe' : 'search',
      label: q,
      sub: isUrl ? 'Open' : `Search ${state.searchEngineName}`,
      run: () => open(q),
    };
    const bang = typedBang();
    if (bang) Object.assign(searchItem, { sub: 'DuckDuckGo search', bang });

    // `env` lists the current page on the project's other environments.
    if (/^env\b/i.test(q) && state.environment) {
      for (const target of state.environment.switches) {
        items.push({ group: 'Developer', icon: 'code', label: `Switch to ${target.label}`, sub: host(target.url), run: () => api.navigate(target.url) });
      }
    }
    // `boost` edits this site's boost files.
    if (/^boost/i.test(q) && activeUrl) {
      const site = host(activeUrl);
      items.push({ group: 'Developer', icon: 'zap', label: `Edit boost script for ${site}`, sub: 'TypeScript', run: () => api.editBoost('script') });
      items.push({ group: 'Developer', icon: 'zap', label: `Edit boost styles for ${site}`, sub: 'CSS, live', run: () => api.editBoost('styles') });
    }
    for (const dev of devSuggestions(q, activeUrl)) {
      items.push({
        group: 'Developer',
        icon: dev.url ? dev.url : 'code',
        label: dev.label,
        sub: dev.sub,
        detail: dev.copy,
        run: () => (dev.url ? open(dev.url) : api.copyText(dev.copy ?? '', 'Copied')),
      });
    }
    for (const action of matchingActions(q).slice(0, 4)) {
      items.push({ group: 'Actions', icon: action.icon, label: action.label, sub: '', hint: action.shortcut && state.shortcuts[action.shortcut], run: action.run });
    }
    // A matching shortcut or action is what was meant (`gh 12`, `settings`); otherwise searching is.
    if (items.length && !isUrl) items.push(searchItem);
    else items.unshift(searchItem);
    // Sites you go to often, when what you type starts their address or title: above the search suggestions.
    // Visits add up by site (Chromium counts each address apart); the site's most visited page stands for it.
    const startsWith = (e: HistoryEntry) => host(e.url).startsWith(lower) || e.title.toLowerCase().startsWith(lower);
    const bySite = new Map<string, { entry: HistoryEntry; visits: number }>();
    for (const e of historyResults) {
      const site = bySite.get(host(e.url));
      if (!site) bySite.set(host(e.url), { entry: e, visits: e.visits });
      else {
        site.visits += e.visits;
        if (e.visits > site.entry.visits) site.entry = e;
      }
    }
    const frequent = [...bySite.values()].filter((s) => s.visits >= FREQUENT_VISITS && startsWith(s.entry)).sort((a, b) => b.visits - a.visits);
    for (const { entry } of frequent.slice(0, 3)) {
      items.push({ group: 'Frequently visited', icon: entry.url, label: entry.title || entry.url, sub: host(entry.url), run: () => open(entry.url) });
    }
    if (!isUrl && suggestionsFor && lower.startsWith(suggestionsFor.toLowerCase())) {
      for (const text of paletteSuggestions.filter((s) => s.toLowerCase() !== lower)) items.push({ group: 'Suggestions', icon: 'search', label: text, sub: '', run: () => open(text) });
    }
  }

  // Only this Space's tabs: picking one from another Space would switch Space.
  const thisSpace = state.spaces.find((s) => s.id === state!.activeSpaceId);
  const pinnedIds = (nodes: PinnedNode[]): string[] => nodes.flatMap((n) => (n.kind === 'tab' ? [n.tabId] : pinnedIds(n.children)));
  const pinnedHere = new Set([...(thisSpace?.favorites ?? []), ...pinnedIds(thisSpace?.pinned ?? [])]);
  const spaceTabs = new Set([...(thisSpace?.today ?? []), ...pinnedHere]);
  const matchingTabs = Object.values(state.tabs)
    .filter((t) => spaceTabs.has(t.id))
    .filter((t) => matches(t.title, t.url) && !(paletteMode === 'split' && t.id === activeId))
    .sort((a, b) => b.lastActive - a.lastActive);
  // Pinned tabs get their own room: untouched ones would never make the recent cut.
  const tabLimit = q ? 6 : 8;
  const openTabs = [...matchingTabs.filter((t) => !pinnedHere.has(t.id)).slice(0, tabLimit), ...matchingTabs.filter((t) => pinnedHere.has(t.id)).slice(0, tabLimit)].sort((a, b) => b.lastActive - a.lastActive);
  for (const tab of openTabs) {
    items.push({
      group: 'Tabs',
      icon: tab,
      label: tabTitle(tab),
      sub: host(tab.url),
      run: paletteMode === 'split' ? () => api.splitWith(tab.id) : () => api.activate(tab.id),
    });
  }

  if (q) {
    const seen = new Set([...openTabs.map((t) => t.url), ...items.filter((i) => i.group === 'Frequently visited').map((i) => i.icon as string)]);
    for (const entry of historyResults.filter((e) => !seen.has(e.url)).slice(0, 6)) {
      seen.add(entry.url);
      items.push({ group: 'History', icon: entry.url, label: entry.title || entry.url, sub: host(entry.url), run: () => open(entry.url) });
    }
    const reopen = paletteMode === 'split' ? api.splitNew : api.newTab;
    for (const item of archivedTabs().filter((a) => !seen.has(a.url) && matches(a.title, a.url)).slice(0, 5)) {
      seen.add(item.url);
      items.push({ group: 'Archive', icon: item.url, label: item.title || item.url, sub: host(item.url), run: () => reopen(item.url) });
    }
  }

  $('palette-bang').hidden = !paletteBang;
  $('palette-bang').textContent = paletteBang?.name ?? '';
  paletteInput.placeholder = paletteBang ? '' : PALETTE_PLACEHOLDER;
  paletteInput.setAttribute('aria-label', paletteBang ? `Search ${paletteBang.name}` : PALETTE_PLACEHOLDER);
  if (paletteBang) {
    const { tag, name } = paletteBang;
    // Only this search: tabs and history don't belong to the site that was picked.
    items.splice(0, items.length, { group: '', icon: 'search', label: q || `!${tag}`, sub: q ? `${name} search` : 'DuckDuckGo search', bang: { tag, name, active: true }, run: () => open(`!${tag} ${q}`) });
  }
  paletteItems = items;
  if (items.length) paletteBare = false;
  palette.classList.toggle('bare', paletteBare);
  selected = Math.min(selected, Math.max(items.length - 1, 0));
  const rows: HTMLElement[] = [];
  let group: PaletteGroup | undefined;
  items.forEach((item, i) => {
    if (item.group !== group) {
      group = item.group;
      if (group) rows.push(h('li', { class: 'group-label' }, group));
    }
    rows.push(
      h(
        'li',
        {
          class: `item${i === selected ? ' selected' : ''}${item.bang ? ' bang' : ''}`,
          dataset: { index: String(i) },
          onmousemove: () => {
            if (selected !== i) (selected = i), updatePalette();
          },
          onmousedown: (e: Event) => {
            e.preventDefault();
            runItem(i);
          },
        },
        h('span', { class: 'item-icon' }, itemIcon(item.icon)),
        h('span', { class: 'label' }, item.label),
        item.sub ? h('span', { class: 'sub' }, item.sub) : null,
        item.bang
          ? h(
              'span',
              {
                class: `palette-chip${item.bang.active ? ' active' : ''}`,
                onmousedown: (e: Event) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!item.bang!.active) setPaletteBang({ tag: item.bang!.tag, name: item.bang!.name }, '');
                },
              },
              icon('search'),
              item.bang.name,
            )
          : null,
        item.hint ? h('kbd', {}, item.hint) : null,
        h('kbd', { class: 'enter' }, '↵'),
      ),
    );
  });
  paletteList.replaceChildren(...rows);
  paletteList.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
  const detail = $('palette-detail');
  detail.hidden = !items[selected]?.detail;
  detail.textContent = items[selected]?.detail ?? '';
}

function runItem(i: number) {
  const item = paletteItems[i];
  if (!item) return;
  item.run();
  closePalette();
}

// History lives in the main process; results arrive asynchronously and are dropped if stale.
// A background that was restarting drops the request; asking again wakes it.
const suggestionsOf = (q: string) => api.searchSuggestions(q).catch(() => api.searchSuggestions(q)).catch(() => [] as string[]);
let historyResults: HistoryEntry[] = [];
let paletteSuggestions: string[] = [];
let suggestionsFor = '';
let paletteSuggestTimer: number | undefined;
function refreshHistory() {
  const q = paletteInput.value.trim();
  clearTimeout(paletteSuggestTimer);
  if (!q) {
    historyResults = [];
    return;
  }
  if (!q.startsWith('!') && !looksLikeUrl(q)) {
    paletteSuggestTimer = window.setTimeout(async () => {
      const results = await suggestionsOf(q);
      if (paletteInput.value.trim() !== q || palette.hidden) return;
      paletteSuggestions = results;
      suggestionsFor = q;
      updatePalette();
    }, 120);
  }
  api.searchHistory(q).then((results) => {
    if (paletteInput.value.trim() !== q || palette.hidden) return;
    historyResults = results;
    updatePalette();
  });
}

function paletteChanged() {
  if (paletteInput.value.startsWith('!')) loadBangs();
  selected = 0;
  updatePalette();
  refreshHistory();
}
paletteInput.addEventListener('input', paletteChanged);
paletteInput.addEventListener('keydown', (e) => {
  const bang = e.key === ' ' && !paletteBang && paletteInput.selectionStart === paletteInput.value.length ? typedBang() : undefined;
  if (bang) {
    e.preventDefault();
    setPaletteBang(bang, '');
  } else if (e.key === 'Backspace' && paletteBang && !paletteInput.value) {
    e.preventDefault();
    setPaletteBang(undefined, `!${paletteBang.tag}`);
  } else if (e.key === 'Escape') closePalette();
  else if (e.key === 'Enter') runItem(selected);
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = paletteItems.length;
    if (n) selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
    updatePalette();
  } else return;
});
palette.addEventListener('mousedown', (e) => {
  if (e.target === palette) closePalette();
});
paletteInput.addEventListener('blur', () => setTimeout(() => document.activeElement !== paletteInput && closePalette(), 0));

// ---- peek -------------------------------------------------------------------------

const peek = $('peek');
const peekRail = peek.querySelector<HTMLElement>('.peek-rail')!;
let peekUrl = '';

function renderPeek(p: PeekState | null) {
  peek.hidden = !p;
  if (!p) return;
  peekUrl = p.url;
  peekRail.style.left = `${p.bounds.x + p.bounds.width + 12}px`;
  peekRail.style.top = `${p.bounds.y + 8}px`;
}

peek.addEventListener('mousedown', (e) => {
  if (e.target === peek) api.closePeek();
});
$('peek-open').onclick = () => api.promotePeek();
$('peek-copy').onclick = () => api.copyText(peekUrl, 'Link copied');
$('peek-close').onclick = () => api.closePeek();

// ---- downloads --------------------------------------------------------------------

const downloadsPanel = $('downloads-panel');
const archivePanel = $('archive-panel');
// What was closed by hand is only for Reopen Closed Tab.
const archivedTabs = () => (state?.archive ?? []).filter((a) => !a.closed);
const timeAgo = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });

function archivedWhen(closedAt: number) {
  const minutes = Math.round((closedAt - Date.now()) / 60_000);
  if (minutes > -60) return timeAgo.format(minutes, 'minute');
  if (minutes > -1440) return timeAgo.format(Math.round(minutes / 60), 'hour');
  return timeAgo.format(Math.round(minutes / 1440), 'day');
}

function renderArchive() {
  const items = archivedTabs();
  $('archive-list').replaceChildren(
    ...(items.length
      ? items.map((item) =>
          h(
            'li',
            {},
            h(
              'button',
              { class: 'archived', title: item.url, onclick: () => ((archivePanel.hidden = true), api.openArchived(item.url, item.closedAt)) },
              itemIcon(item.url),
              h('span', { class: 'archived-text' }, h('span', { class: 'name' }, item.title || item.url), h('span', { class: 'when' }, `${host(item.url)} · ${archivedWhen(item.closedAt)}`)),
            ),
          ),
        )
      : [h('li', { class: 'archive-empty' }, 'Tabs you archive show up here. Click one to reopen it.')]),
  );
}


function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) (value /= 1024), unit++;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function downloadStatus(d: DownloadInfo) {
  if (d.state === 'completed') return formatBytes(d.received);
  if (d.state === 'cancelled') return 'Cancelled';
  if (d.state === 'interrupted') return 'Failed';
  return d.total ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received);
}

/** Brings the hidden sidebar out, sends a file to the downloads button, and lets the sidebar go again. */
async function announceDownload() {
  const button = $('btn-downloads');
  const fly = $('download-fly');
  if (surface === 'newtab') return;
  const wasHidden = document.body.dataset.sidebar !== 'docked';
  if (wasHidden) {
    keepPeek();
    api.setSidebarPeek(true);
    for (let i = 0; i < 20 && document.body.dataset.sidebar !== 'floating'; i++) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 220));
  }
  const side = $('sidebar').getBoundingClientRect();
  const to = button.getBoundingClientRect();
  const end = { x: to.left + to.width / 2 - 18, y: to.top + to.height / 2 - 18 };
  const start = { x: side.right - 56, y: side.top + side.height * 0.35 };
  const at = (x: number, y: number, scale: number) => `translate(${x}px, ${y}px) scale(${scale})`;
  fly.hidden = false;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await fly.animate(
      [
        { transform: at(start.x, start.y, 0.7), opacity: 0 },
        { transform: at(start.x, start.y - 12, 1), opacity: 1, offset: 0.18 },
        { transform: at((start.x + end.x) / 2, start.y + (end.y - start.y) * 0.45, 0.95), opacity: 1, offset: 0.55 },
        { transform: at(end.x, end.y, 0.4), opacity: 0.2 },
      ],
      { duration: 760, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
    ).finished;
  }
  fly.hidden = true;
  button.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 240, easing: 'ease-out' });
  if (wasHidden) window.setTimeout(() => leavePeek(), 1200);
}

function renderDownloads(items: DownloadInfo[], started?: DownloadInfo) {
  const running = items.filter((d) => d.state === 'progressing');
  const active = running.length;
  const badge = $('downloads-badge');
  // One download is the ring; the number only says when there's more than one.
  badge.hidden = active < 2;
  badge.textContent = String(active);
  const button = $('btn-downloads');
  const sized = running.filter((d) => d.total > 0);
  button.classList.toggle('downloading', active > 0);
  button.classList.toggle('indeterminate', active > 0 && sized.length < active);
  const progress = sized.length ? (sized.reduce((n, d) => n + d.received, 0) / sized.reduce((n, d) => n + d.total, 0)) * 100 : 0;
  button.style.setProperty('--progress', progress.toFixed(1));
  if (started) void announceDownload();

  $('downloads-list').replaceChildren(
    ...items.map((d) => {
      const progress = d.state === 'progressing' && d.total ? d.received / d.total : d.state === 'completed' ? 1 : 0;
      return h(
        'li',
        {
          class: `download ${d.state}`,
          title: d.state === 'completed' ? 'Open' : d.url,
          onclick: () => api.openDownload(d.id),
        },
        h('span', { class: 'name' }, d.filename),
        h('span', { class: 'status' }, downloadStatus(d)),
        d.state === 'progressing'
          ? h('span', { class: 'bar' }, h('span', { class: 'fill', style: `width: ${Math.round(progress * 100)}%` }))
          : null,
        h(
          'button',
          {
            class: 'icon-button',
            title: d.state === 'progressing' ? 'Cancel' : 'Show in folder',
            onclick: (e: Event) => {
              e.stopPropagation();
              if (d.state === 'progressing') api.cancelDownload(d.id);
              else api.revealDownload(d.id);
            },
          },
          d.state === 'progressing' ? icon('close') : icon('folder'),
        ),
      );
    }),
  );
  if (!items.length) $('downloads-list').append(h('li', { class: 'empty' }, 'No downloads yet'));
}

$('btn-downloads').onclick = () => (downloadsPanel.hidden = !downloadsPanel.hidden);
$('btn-settings').onclick = () => api.openSettings();
$('btn-archive').onclick = () => {
  archivePanel.hidden = !archivePanel.hidden;
  downloadsPanel.hidden = true;
  if (!archivePanel.hidden) renderArchive();
};
$('btn-clear-downloads').onclick = () => api.clearDownloads();
document.addEventListener('mousedown', (e) => {
  const target = e.target as Node;
  if (!downloadsPanel.hidden && !downloadsPanel.contains(target) && !$('btn-downloads').contains(target)) {
    downloadsPanel.hidden = true;
  }
  if (!archivePanel.hidden && !archivePanel.contains(target) && !$('btn-archive').contains(target)) archivePanel.hidden = true;
});

// ---- drop a tab on the page to split ---------------------------------------------------

const splitDrop = $('split-drop');

/** Drop zones over the page while a tab is dragged, unless it's the tab already on screen. */
function showSplitDrop(tabId: string) {
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  if (!space?.activeTabId || space.activeTabId === tabId || (space.split?.includes(tabId) && space.split.includes(space.activeTabId))) return;
  // Where the page is, beside the sidebar: over a floating one, drops would never reach its tabs.
  const sidebarSide = document.body.dataset.sidebar;
  const left = sidebarSide === 'docked' ? $('sidebar').offsetWidth : sidebarSide === 'floating' ? $('sidebar').offsetLeft + $('sidebar').offsetWidth + 8 : 8;
  Object.assign(splitDrop.style, { left: `${left}px`, top: '8px', right: '8px', bottom: '8px' });
  splitDrop.hidden = false;
  api.setTabDragging(true);
}

function hideSplitDrop() {
  if (splitDrop.hidden) return;
  splitDrop.hidden = true;
  for (const half of splitDrop.children) half.classList.remove('over');
  api.setTabDragging(false);
}

for (const half of splitDrop.querySelectorAll<HTMLElement>('.drop-half')) {
  half.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    half.classList.add('over');
  });
  half.addEventListener('dragleave', () => half.classList.remove('over'));
  half.addEventListener('drop', (e) => {
    const id = e.dataTransfer?.getData(DRAG_TYPE);
    e.preventDefault();
    splitDrop.hidden = true;
    for (const h of splitDrop.children) h.classList.remove('over');
    if (id) api.dropToSplit(id, half.dataset.side as 'left' | 'right');
    else api.setTabDragging(false);
  });
}

// ---- hidden sidebar: reveal at the edge, hide again when the mouse leaves -------------

// The edge strip stays under the pointer while the floating sidebar is out (it covers the gap
// between the window's edge and the card, styles.css), so the card sliding in under a pointer
// resting at the edge never reads as leaving it: the sidebar shows once, and goes only after
// the pointer has left both the edge and the card for a moment, sliding out to the left.
let peekCloseTimer: number | undefined;
const peekSidebar = $('sidebar');
const peekEdge = $('edge');
const inPeek = (el: EventTarget | null) => el instanceof Node && (peekSidebar.contains(el) || peekEdge.contains(el));
function keepPeek() {
  clearTimeout(peekCloseTimer);
  peekSidebar.classList.remove('peek-leaving');
}
function leavePeek(e?: MouseEvent) {
  if (document.body.dataset.sidebar !== 'floating' || inPeek(e?.relatedTarget ?? null)) return;
  clearTimeout(peekCloseTimer);
  const leaveWhenIdle = () => {
    // Stay open while something inside it is being used (a menu counts: Edit Space is in one).
    if (!palette.hidden || !spaceEditor.hidden || !downloadsPanel.hidden || !archivePanel.hidden || document.querySelector('.shell-menu-layer')) {
      peekCloseTimer = window.setTimeout(leaveWhenIdle, 300);
      return;
    }
    if (!peekSidebar.matches(':hover')) peekSidebar.classList.add('peek-leaving');
  };
  peekCloseTimer = window.setTimeout(leaveWhenIdle, 300);
}
$('top-edge').addEventListener('mouseenter', () => api.setTopBarPeek(true));
$('top-edge').addEventListener('mouseleave', () => api.setTopBarPeek(false));
// A wheel moves the row of Spaces sideways when they don't all fit.
$('spaces').addEventListener('wheel', (e) => ($('spaces').scrollLeft += e.deltaY || e.deltaX), { passive: true });
peekEdge.addEventListener('mouseenter', () => {
  keepPeek();
  api.setSidebarPeek(true);
});
peekSidebar.addEventListener('mouseenter', keepPeek);
peekEdge.addEventListener('mouseleave', leavePeek);
peekSidebar.addEventListener('mouseleave', leavePeek);
// Hidden once it has slid out.
peekSidebar.addEventListener('animationend', (e) => {
  if (e.target === peekSidebar && peekSidebar.classList.contains('peek-leaving')) api.setSidebarPeek(false);
});

// ---- tooltips ---------------------------------------------------------------------

const tooltip = $('tooltip');
let tipTimer: number | undefined;
let tipTarget: HTMLElement | undefined;

function showTip(target: HTMLElement) {
  $('tooltip-text').textContent = target.dataset.tip ?? '';
  const kbd = $('tooltip-kbd');
  kbd.textContent = target.dataset.kbd ?? '';
  kbd.hidden = !target.dataset.kbd;
  tooltip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tooltip.getBoundingClientRect();
  if (target.dataset.tipSide === 'left') {
    tooltip.style.left = `${r.left - t.width - 6}px`;
    tooltip.style.top = `${r.top + r.height / 2 - t.height / 2}px`;
    return;
  }
  if (target.dataset.tipSide === 'right') {
    tooltip.style.left = `${r.right + 6}px`;
    tooltip.style.top = `${r.top + r.height / 2 - t.height / 2}px`;
    return;
  }
  const below = r.bottom + 6 + t.height < window.innerHeight - 8;
  const left = Math.min(Math.max(r.left + r.width / 2 - t.width / 2, 6), window.innerWidth - t.width - 6);
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${below ? r.bottom + 6 : r.top - t.height - 6}px`;
}

let tipHiddenAt = 0;

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = undefined;
  if (!tooltip.hidden) tipHiddenAt = Date.now();
  tooltip.hidden = true;
}

document.addEventListener('pointerover', (e) => {
  const target = (e.target as Element).closest<HTMLElement>('[data-tip]');
  if (target === tipTarget) return;
  hideTip();
  if (!target || !target.dataset.tip) return;
  tipTarget = target;
  // Once one tooltip is showing, moving to the next button shows its tooltip right away.
  tipTimer = window.setTimeout(() => showTip(target), Date.now() - tipHiddenAt < 400 ? 0 : 550);
});
document.addEventListener('pointerdown', hideTip, true);
document.addEventListener('scroll', hideTip, true);
window.addEventListener('blur', hideTip);

// ---- favorite card ----------------------------------------------------------------

const favCard = $('fav-card');
const favorites = $('favorites');
let favCardTab: string | undefined;
let favCardShow: number | undefined;
let favCardLeave: number | undefined;
let favCardHiddenAt = 0;
// A pressed tile redraws under the pointer; its card must not come back until the pointer moves on.
let favCardPressed: string | undefined;
// Its own "More options" menu is open: the pointer leaving for the menu doesn't close the card.
let favCardHeld = false;

function showFavCard() {
  const tab = favCardTab ? state?.tabs[favCardTab] : undefined;
  const tile = favCardTab ? favorites.querySelector(`[data-tab-id="${CSS.escape(favCardTab)}"]`) : null;
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  if (!tab || !tile || !space) return hideFavCard();
  $('fav-card-title').textContent = tabTitle(tab);
  $('fav-card-host').textContent = host(tab.url);
  $<HTMLButtonElement>('fav-card-home').disabled = !tab.homeUrl || tab.homeUrl === tab.url;
  $<HTMLButtonElement>('fav-card-split').disabled = !space.activeTabId || space.activeTabId === tab.id;
  favCard.hidden = false;
  const side = $('sidebar').getBoundingClientRect();
  const r = tile.getBoundingClientRect();
  const height = favCard.offsetHeight;
  favCard.style.left = `${Math.max(8, Math.min(r.left - side.left, side.width - favCard.offsetWidth - 8))}px`;
  favCard.style.top = `${r.bottom + 4 + height < side.bottom - 8 ? r.bottom - side.top + 4 : r.top - side.top - height - 4}px`;
}

function hideFavCard() {
  if (favCardHeld) return;
  clearTimeout(favCardShow);
  clearTimeout(favCardLeave);
  favCardTab = undefined;
  if (!favCard.hidden) favCardHiddenAt = Date.now();
  favCard.hidden = true;
}

function leaveFavCard() {
  clearTimeout(favCardLeave);
  favCardLeave = window.setTimeout(hideFavCard, 160);
}

function openFavCard(id: string, delay: number) {
  clearTimeout(favCardLeave);
  if (id === favCardTab) return;
  clearTimeout(favCardShow);
  favCardTab = id;
  favCardShow = window.setTimeout(showFavCard, !favCard.hidden || Date.now() - favCardHiddenAt < 400 ? 0 : delay);
}

favorites.addEventListener('pointerover', (e) => {
  const id = (e.target as Element).closest<HTMLElement>('.fav')?.dataset.tabId;
  if (!id) return void clearTimeout(favCardLeave);
  if (id === favCardPressed) return;
  favCardPressed = undefined;
  openFavCard(id, 550);
});
favorites.addEventListener('pointerout', (e) => {
  const to = e.relatedTarget as Node | null;
  if (to && (favorites.contains(to) || favCard.contains(to))) return;
  favCardPressed = undefined;
  leaveFavCard();
});
favorites.addEventListener('pointerdown', (e) => {
  favCardPressed = (e.target as Element).closest<HTMLElement>('.fav')?.dataset.tabId;
  hideFavCard();
});
favorites.addEventListener('focusin', (e) => {
  const tile = (e.target as Element).closest<HTMLElement>('.fav');
  if (tile?.matches(':focus-visible')) openFavCard(tile.dataset.tabId!, 0);
});
favorites.addEventListener('focusout', leaveFavCard);
favCard.addEventListener('pointerenter', () => clearTimeout(favCardLeave));
favCard.addEventListener('pointerleave', leaveFavCard);
window.addEventListener('blur', hideFavCard);
document.addEventListener('keydown', (e) => e.key === 'Escape' && hideFavCard());

const favCardAction = (id: string, run: (tabId: string) => void) => {
  $(id).onclick = () => {
    const tabId = favCardTab;
    hideFavCard();
    if (tabId) run(tabId);
  };
};
favCardAction('fav-card-home', (id) => api.goHome(id));
favCardAction('fav-card-split', (id) => api.splitWith(id));
$('fav-card-more').onclick = async () => {
  if (!favCardTab) return;
  favCardHeld = true;
  try {
    await api.tabMenu(favCardTab);
  } finally {
    favCardHeld = false;
    leaveFavCard();
  }
};

// ---- tab card: a tab row's title, address and quick actions on hover --------------

const tabCard = $('tab-card');
let tabCardTab: string | undefined;
let tabCardShow: number | undefined;
let tabCardLeave: number | undefined;
let tabCardHiddenAt = 0;
let tabCardPressed: string | undefined;
let tabCardOverlay = false;
const tabRowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('#sidebar .row[data-tab-id]') : null);

function showTabCard() {
  const tab = tabCardTab ? state?.tabs[tabCardTab] : undefined;
  const row = tabCardTab ? document.querySelector<HTMLElement>(`#sidebar .row[data-tab-id="${CSS.escape(tabCardTab)}"]`) : null;
  const space = state?.spaces.find((s) => s.id === state!.activeSpaceId);
  if (!tab || !row || !space || row.querySelector('[contenteditable], input')) return hideTabCard();
  $('tab-card-title').textContent = tabTitle(tab);
  $('tab-card-host').textContent = host(tab.url);
  $('tab-card-pin').querySelector('span')!.textContent = space.today.includes(tab.id) ? 'Pin' : 'Unpin';
  $<HTMLButtonElement>('tab-card-split').disabled = !space.activeTabId || space.activeTabId === tab.id;
  // The frame grows over the page first, or the card would be cut at the sidebar's edge.
  if (framedWindow && !tabCardOverlay) {
    tabCardOverlay = true;
    api.setOverlay?.('tab-card', true);
  }
  tabCard.hidden = false;
  const r = row.getBoundingClientRect();
  const height = tabCard.offsetHeight;
  if (framedWindow) {
    tabCard.style.top = `${Math.max(8, Math.min(r.top - 4, innerHeight - height - 8))}px`;
  } else {
    const side = $('sidebar').getBoundingClientRect();
    tabCard.style.left = `${Math.max(8, (side.width - tabCard.offsetWidth) / 2)}px`;
    tabCard.style.top = `${r.bottom + 4 + height < side.bottom - 8 ? r.bottom - side.top + 4 : r.top - side.top - height - 4}px`;
  }
}

function hideTabCard() {
  clearTimeout(tabCardShow);
  clearTimeout(tabCardLeave);
  tabCardTab = undefined;
  if (!tabCard.hidden) tabCardHiddenAt = Date.now();
  tabCard.hidden = true;
  if (tabCardOverlay) {
    tabCardOverlay = false;
    api.setOverlay?.('tab-card', false);
  }
}

function openTabCard(id: string, delay: number) {
  clearTimeout(tabCardLeave);
  if (id === tabCardTab) return;
  clearTimeout(tabCardShow);
  tabCardTab = id;
  tabCardShow = window.setTimeout(showTabCard, !tabCard.hidden || Date.now() - tabCardHiddenAt < 400 ? 0 : delay);
}

function leaveTabCard() {
  clearTimeout(tabCardLeave);
  tabCardLeave = window.setTimeout(hideTabCard, 160);
}

const sidebarEl = $('sidebar');
sidebarEl.addEventListener('pointerover', (e) => {
  const id = tabRowOf(e.target)?.dataset.tabId;
  if (!id || id === tabCardPressed) return;
  tabCardPressed = undefined;
  openTabCard(id, 700);
});
sidebarEl.addEventListener('pointerout', (e) => {
  if (!tabRowOf(e.target)) return;
  const to = e.relatedTarget as Node | null;
  if (to && (tabRowOf(to) || tabCard.contains(to))) return;
  tabCardPressed = undefined;
  leaveTabCard();
});
sidebarEl.addEventListener('pointerdown', (e) => {
  if (tabCard.contains(e.target as Node)) return;
  tabCardPressed = tabRowOf(e.target)?.dataset.tabId;
  hideTabCard();
});
sidebarEl.addEventListener('focusin', (e) => {
  const row = tabRowOf(e.target);
  if (row?.matches(':focus-visible')) openTabCard(row.dataset.tabId!, 0);
});
sidebarEl.addEventListener('focusout', (e) => {
  if (!tabCard.contains(e.relatedTarget as Node)) leaveTabCard();
});
sidebarEl.addEventListener('contextmenu', hideTabCard);
sidebarEl.addEventListener('dragstart', hideTabCard);
tabCard.addEventListener('pointerenter', () => clearTimeout(tabCardLeave));
tabCard.addEventListener('pointerleave', leaveTabCard);
window.addEventListener('blur', hideTabCard);
document.addEventListener('keydown', (e) => e.key === 'Escape' && hideTabCard());

const tabCardAction = (id: string, run: (tabId: string) => void) => {
  $(id).onclick = () => {
    const tabId = tabCardTab;
    hideTabCard();
    if (tabId) run(tabId);
  };
};
tabCardAction('tab-card-pin', (id) => api.togglePin(id));
tabCardAction('tab-card-fav', (id) => api.toggleFavorite(id));
tabCardAction('tab-card-split', (id) => api.splitWith(id));

// ---- wiring ---------------------------------------------------------------------

$('btn-sidebar').onclick = () => api.toggleSidebar();
$('btn-back').onclick = () => api.back();
$('btn-forward').onclick = () => api.forward();
$('btn-reload').onclick = () => {
  if (Date.now() - reloadHeldAt < 400) return;
  if (state?.nav.loading) api.stop();
  else api.reload();
};
// Pressed and held (or right-clicked), Reload offers a hard reload and emptying the cache, as in Chrome.
let reloadHold: number | undefined;
let reloadHeldAt = 0;
const reloadMenu = () => {
  reloadHeldAt = Date.now();
  const box = $('btn-reload').getBoundingClientRect();
  api.reloadMenu({ right: box.left + 220, top: box.bottom + 4 });
};
$('btn-reload').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  clearTimeout(reloadHold);
  reloadHold = window.setTimeout(reloadMenu, 450);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) $('btn-reload').addEventListener(type, () => clearTimeout(reloadHold));
$('btn-reload').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  reloadMenu();
});
$('urlbar').onclick = () => api.openPalette('navigate');
$('btn-newtab').onclick = () => api.openPalette('new-tab');
$('btn-search').onclick = () => api.openPalette('new-tab');
$('btn-clear').onclick = () => api.clearToday();
$('btn-newspace').onclick = () => api.newSpace();
// Searches, or opens the address, in this tab (a new tab's page) or a new one (an empty Space).
const homeInput = $<HTMLInputElement>('home-input');
const homeList = $('home-suggestions');
let homeBang: { tag: string; name: string } | undefined;
let homeHits: Array<{ url: string; title: string; search?: boolean }> = [];
let homeSuggestTimer: number | undefined;
let homeSelected = -1;

function renderHome() {
  $<HTMLButtonElement>('home-go').disabled = !homeInput.value.trim() && !homeBang;
  $('home-bang').hidden = !homeBang;
  $('home-bang').textContent = homeBang?.name ?? '';
  homeInput.placeholder = homeBang ? '' : 'Search or type a URL';
  const bang = !homeBang ? typedBang(homeInput) : undefined;
  const row = (selected: boolean, onpick: () => void, ...content: unknown[]) =>
    h('li', { class: selected ? 'selected' : '', onmousedown: (e: Event) => (e.preventDefault(), onpick()) }, ...(content as HTMLElement[]));
  const acceptHomeBang = () => bang && setHomeBang(bang, '');
  homeList.replaceChildren(
    ...(bang
      ? [row(false, acceptHomeBang, itemIcon('search'), h('span', { class: 'name' }, homeInput.value), h('span', { class: 'host' }, 'DuckDuckGo search'), h('span', { class: 'palette-chip' }, icon('search'), bang.name))]
      : homeHits.map((hit, i) => row(i === homeSelected, () => openFromHome(hit.url), itemIcon(hit.search ? 'search' : hit.url), h('span', { class: 'name' }, hit.title || hit.url), hit.search ? null : h('span', { class: 'host' }, host(hit.url))))),
  );
  homeList.hidden = !homeList.children.length;
}

function setHomeBang(bang: typeof homeBang, text: string) {
  homeBang = bang;
  homeInput.value = text;
  homeInput.focus();
  homeChanged();
}

function homeChanged() {
  const q = homeInput.value.trim();
  if (q.startsWith('!')) loadBangs();
  // The last list stays up while the next one is on its way.
  if (!q || q.startsWith('!') || homeBang) homeHits = [];
  homeSelected = -1;
  renderHome();
  clearTimeout(homeSuggestTimer);
  if (!q || q.startsWith('!') || homeBang) return;
  homeSuggestTimer = window.setTimeout(async () => {
    // One source failing leaves the other's results.
    const [history, suggestions] = await Promise.all([api.searchHistory(q).catch(() => []), looksLikeUrl(q) ? [] : suggestionsOf(q)]);
    if (homeInput.value.trim() !== q || homeBang) return;
    const visited = history.sort((a, b) => b.visits - a.visits).slice(0, 3);
    homeHits = [...visited, ...suggestions.map((text) => ({ url: text, title: text, search: true }))];
    renderHome();
  }, 120);
}

function openFromHome(text: string) {
  api.newTab(text);
  homeBang = undefined;
  homeInput.value = '';
  homeChanged();
}

homeInput.addEventListener('input', homeChanged);
homeInput.addEventListener('blur', () => (homeList.hidden = true));
homeInput.addEventListener('keydown', (e) => {
  const bang = e.key === ' ' && !homeBang && homeInput.selectionStart === homeInput.value.length ? typedBang(homeInput) : undefined;
  if (bang) {
    e.preventDefault();
    setHomeBang(bang, '');
  } else if (e.key === 'Backspace' && homeBang && !homeInput.value) {
    e.preventDefault();
    setHomeBang(undefined, `!${homeBang.tag}`);
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && homeHits.length) {
    e.preventDefault();
    const n = homeHits.length;
    homeSelected = e.key === 'ArrowDown' ? (homeSelected + 1) % n : (homeSelected <= 0 ? n : homeSelected) - 1;
    renderHome();
  } else if (e.key === 'Escape') {
    homeHits = [];
    renderHome();
  }
});
$('home-composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = homeInput.value.trim();
  if (homeSelected >= 0) openFromHome(homeHits[homeSelected].url);
  else if (homeBang) openFromHome(`!${homeBang.tag} ${text}`);
  else if (text) openFromHome(text);
});
// What isn't there yet says so, and does nothing.
for (const el of document.querySelectorAll<HTMLElement>('.composer [aria-disabled="true"]')) el.addEventListener('click', (e) => e.preventDefault());
// A click on the Space's name opens its menu (Arc's Space settings); a second click closes it.
$('space-header').onclick = () => (spaceEditor.hidden ? state && openSpaceEditor(state.activeSpaceId) : closeSpaceEditor());
$('space-header').onkeydown = (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), $('space-header').click());
$('space-header').oncontextmenu = (e) => {
  e.preventDefault();
  if (state) api.spaceMenu(state.activeSpaceId);
};
// As in Arc, right-clicking the sidebar's empty background (between and below the tabs, the
// toolbar's gaps) opens the current Space's menu. Rows, buttons, fields and popovers aren't
// background: they have their own menu, the native edit menu, or none.
$('sidebar').addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented || !state) return;
  if ((e.target as Element).closest('button, a, input, textarea, select, label, [contenteditable], .row, .popover, #urlbar-wrap, #agent-status')) return;
  e.preventDefault();
  api.spaceMenu(state.activeSpaceId);
});

acceptDrops($('favorites'), { zone: 'favorites' });
acceptDrops($('pinned'), { zone: 'pinned' });
acceptDrops($('today'), { zone: 'today' });
acceptDrops($('btn-newtab'), { zone: 'today' });

// ---- now playing ------------------------------------------------------------------

const nowPlayingCard = $('now-playing');
let nowPlaying: NowPlaying | null = null;

function renderNowPlaying() {
  const song = nowPlaying;
  const tab = song && state?.tabs[song.tabId];
  nowPlayingCard.hidden = !tab;
  if (!song || !tab) return void nowPlayingCard.replaceChildren();
  nowPlayingCard.dataset.status = song.status;

  const busy = song.status === 'identifying';
  const title =
    song.status === 'found' && song.title
      ? song.title
      : ({ identifying: 'Finding song…', nomatch: 'Song not found' } as Record<string, string>)[song.status] ?? tabTitle(tab);
  const sub = song.status === 'found' ? song.artist ?? host(tab.url) : song.status === 'nomatch' ? tabTitle(tab) : host(tab.url);
  const art = song.status === 'found' && song.artwork ? (h('img', { src: song.artwork, alt: '', draggable: 'false' }) as HTMLImageElement) : favicon(tab);
  if (art instanceof HTMLImageElement && song.artwork) art.onerror = () => art.replaceWith(favicon(tab));
  const control = (label: string, name: IconName, action: 'play' | 'pause' | 'next' | 'previous') =>
    h('button', { class: 'icon-button', 'aria-label': label, title: label, onclick: () => api.mediaControl?.(song.tabId, action) }, icon(name));

  nowPlayingCard.replaceChildren(
    h(
      'div',
      { class: 'np-head' },
      // The art is the way back to the tab; a cover gets the site's icon in its corner, so the source stays visible.
      h(
        'button',
        { class: `np-art${song.status === 'found' && song.artwork ? ' cover' : ''}`, 'aria-label': `Go to ${tabTitle(tab)}`, title: 'Go to tab', onclick: () => api.activate(song.tabId) },
        art,
        song.status === 'found' && song.artwork ? h('span', { class: 'np-source' }, favicon(tab)) : null,
      ),
      h(
        'div',
        { class: 'np-meta', 'aria-live': 'polite' },
        h('p', { class: 'np-title' }, busy ? h('span', { class: 'np-eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')) : null, h('span', { class: 'np-clip' }, title)),
        h(
          'p',
          { class: 'np-sub' },
          // Recognised names are a guess from the audio; say so.
          song.status === 'found' && song.source === 'recognized' ? h('span', { class: 'np-badge', title: 'Identified from the audio' }, icon('music')) : null,
          h('span', { class: 'np-clip' }, sub),
        ),
      ),
      h('button', { class: 'icon-button np-close', 'aria-label': 'Hide', title: 'Hide', onclick: () => api.dismissNowPlaying?.() }, icon('close')),
    ),
    h(
      'div',
      { class: 'np-controls' },
      control('Previous track', 'previous', 'previous'),
      song.playing ? control('Pause', 'pause', 'pause') : control('Play', 'play', 'play'),
      control('Next track', 'next', 'next'),
      h('span', { class: 'spacer' }),
      song.status === 'audio' || song.status === 'nomatch'
        ? h('button', { class: 'np-chip', 'aria-label': song.status === 'nomatch' ? 'Try identifying the song again' : 'Identify the song', title: 'Find the song’s name', onclick: () => api.identifySong?.(song.tabId) }, icon('music'), song.status === 'nomatch' ? 'Try again' : 'Identify')
        : null,
    ),
  );
}

api.onNowPlaying?.((song) => {
  nowPlaying = song;
  renderNowPlaying();
});

const renderOnboarding = setupOnboarding(api, h);
// The window page stays blank until it knows whether the tour or the browser shows (styles.css); not forever if the background never answers.
const shown = () => (document.documentElement.dataset.state = '');
setTimeout(shown, 3000);
api.onState((s) => {
  render(s);
  renderOnboarding(s);
  shown();
  renderNowPlaying();
});
api.onPalette(openPalette);
api.onEditSpace(openSpaceEditor);
api.onRenameTab(renameTab);
api.onPeek(renderPeek);
api.onDownloads(renderDownloads);
api.ready();
