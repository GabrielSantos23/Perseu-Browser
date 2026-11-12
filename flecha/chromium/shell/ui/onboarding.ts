import type { FlechaApi, SearchEngineId, UiState } from '../../shared/types';
import { browserDetail, importSummary } from './browserImport.js';
import { fieldColor, fieldPoint, nextStop, paintField, throttled } from './colorField.js';
import { SPACE_COLORS } from './spaceChoices.js';
import { spaceTint } from '../lib/spaceTint';
import { isDark } from '../lib/topBar';
import { formName, printSky } from './sky.js';

/**
 * The first-run tour, in perseu.dev's paint: it opens on a printed sky where the name gathers, then six steps beside a
 * small Perseu that shows each answer. The window is small and has no buttons meanwhile
 * (setWelcomeWindow); it grows into the browser when the tour ends. Every answer is real as you
 * go (imports, favorites, the Space, the theme). It comes back from Settings → Welcome tour.
 */

type H = (tag: string, props?: Record<string, unknown>, ...children: Array<Node | string | null | undefined>) => HTMLElement;
type DetectedBrowser = Awaited<ReturnType<FlechaApi['detectBrowsers']>>[number];

const STEPS = ['welcome', 'import', 'apps', 'command', 'space', 'look', 'ready'] as const;
type Step = (typeof STEPS)[number];
/** Where the small Perseu sits on each step; a class on the tour, so moving it animates. */
const MOCK: Record<Step, string> = { welcome: 'gone', import: 'left', apps: 'right', command: 'gone', space: 'left', look: 'low', ready: 'center' };

/** Sites people keep open all day. Each shows its own icon once the site gives it (wantSiteIcons); a monogram in its colour until then. */
const APPS = [
  { name: 'Gmail', url: 'https://mail.google.com/', color: '#ea4335', mark: 'M' },
  { name: 'Calendar', url: 'https://calendar.google.com/', color: '#1a73e8', mark: '31' },
  { name: 'Slack', url: 'https://app.slack.com/', color: '#4a154b', mark: 'S' },
  { name: 'Notion', url: 'https://www.notion.so/', color: '#191919', mark: 'N' },
  { name: 'Linear', url: 'https://linear.app/', color: '#5e6ad2', mark: 'L' },
  { name: 'GitHub', url: 'https://github.com/', color: '#24292f', mark: 'G' },
  { name: 'Figma', url: 'https://www.figma.com/', color: '#a259ff', mark: 'F' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10a37f', mark: 'C' },
  { name: 'Claude', url: 'https://claude.ai/', color: '#d97757', mark: 'C' },
  { name: 'YouTube', url: 'https://www.youtube.com/', color: '#ff0033', mark: '▶' },
  { name: 'Spotify', url: 'https://open.spotify.com/', color: '#1db954', mark: 'S' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#25d366', mark: 'W' },
] as const;

/** Black icons, turned light on a dark tile. */
const INK_ICONS = new Set(['GitHub']);
/** Icons taken from each browser's own .exe (tour/browsers); the others get a monogram. */
const BROWSER_ICONS = new Set(['chrome', 'edge', 'brave', 'firefox', 'helium', 'zen']);
const BROWSER_COLORS: Record<string, string> = {
  chrome: '#4285f4', edge: '#0f7bd8', brave: '#fb542b', firefox: '#ff7139', opera: '#ff1b2d', vivaldi: '#ef3939', arc: '#3d5afe', zen: '#f76f53', helium: '#3b5bdb',
};

const ENGINES: Array<{ id: SearchEngineId; name: string }> = [
  { id: 'google', name: 'Google' },
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'bing', name: 'Bing' },
  { id: 'brave', name: 'Brave' },
  { id: 'kagi', name: 'Kagi' },
  { id: 'ecosia', name: 'Ecosia' },
];

const EMOJIS = ['🏠', '💼', '🚀', '🧪', '🛠️', '🎨', '📚', '🧠', '🎮', '🌱', '☕️', '⚡️'];
// The pastels, then the neutrals the field has no room for: white, graphite and black.
const COLORS = [...SPACE_COLORS.slice(0, 8), '#ffffff', '#2b2d31', '#000000'];
/** The sample tabs in the small Perseu. */
const MOCK_TABS = ['Perseu · Fear no gaze', 'GitHub · Pull requests', 'Weekly training plan', 'Package tracking'];

/** What the command bar demo types, and what it finds. */
const DEMO_QUERY = 'git';
const DEMO_ROWS = [
  { mark: 'G', color: '#24292f', title: 'GitHub · Pull requests', hint: 'Switch to tab' },
  { mark: 'G', color: '#24292f', title: 'github.com/notifications', hint: 'History' },
  { mark: '★', color: '#b5532f', title: 'git cheat sheet', hint: 'Bookmark' },
  { mark: '⌕', color: '#1f4e79', title: `Search the web for “${DEMO_QUERY}”`, hint: '' },
];

const FEATURES = ['Ads and trackers blocked', 'Your Chrome extensions', 'Split view', 'Picture in Picture'];

export function setupOnboarding(api: FlechaApi, h: H) {
  const root = document.getElementById('onboarding')!;
  const isWindow = 'frame' in document.documentElement.dataset;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let step: Step = 'welcome';
  let state: UiState | undefined;
  let browsers: DetectedBrowser[] | undefined;
  let chosenBrowser: string | undefined;
  const imported = new Map<string, string>();
  /** Imports that came over without their cookies, since the browser said no. */
  const refused = new Set<string>();
  const importing = new Set<string>();
  const apps = new Set<string>();
  let triedCommandBar = false;
  let drawn = '';
  let shownStep: Step | undefined;
  // Unknown until the first render: a window that started small must hear "false" too.
  let welcome: boolean | undefined;
  let stopName: (() => void) | undefined;
  /** The name has gathered once; coming back shows it whole. */
  let named = false;
  let demoTimer: ReturnType<typeof setTimeout> | undefined;
  let askedIcons = false;

  const space = () => state?.spaces.find((s) => s.id === state!.activeSpaceId);
  const keysFor = (id: string) => (state?.shortcuts[id] || '').split('+').filter(Boolean);
  const index = () => STEPS.indexOf(step);

  // ---- the frame, built once -------------------------------------------------------------------

  const sky = h('canvas', { class: 'tour-sky', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const air = h('canvas', { class: 'tour-air', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const solid = h('canvas', { class: 'tour-solid', 'aria-hidden': 'true' }) as HTMLCanvasElement;
  const begin = h('button', { class: 'tour-begin', onclick: () => go('import') }, 'Begin', h('span', { class: 'tour-begin-key', 'aria-hidden': 'true' }, '↵'));
  const welcomeText = h(
    'div',
    { class: 'tour-welcome' },
    h('p', {}, 'Fear no gaze. A minute of setup and every tab finds its place.'),
    begin,
  );
  const hero = h(
    'section',
    { class: 'tour-hero', 'aria-labelledby': 'tour-hero-title' },
    sky,
    solid,
    air,
    h('h1', { class: 'visually-hidden', id: 'tour-hero-title' }, 'Perseu'),
    welcomeText,
  );

  const skip = h('button', { class: 'tour-skip label', onclick: () => finish() }, 'Skip setup');
  const page = h('div', { class: 'tour-page' });
  const back = h('button', { class: 'tour-back label', onclick: () => go(STEPS[Math.max(index() - 1, 0)], -1) }, 'Back');
  const dashes = h('div', { class: 'tour-dashes', 'aria-hidden': 'true' }, ...STEPS.slice(1).map(() => h('i')));
  const primary = h('button', { class: 'btn tour-primary' });
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
  let dragging = false;
  const mock = buildMock();
  const picker = buildPicker();
  const steps = h(
    'section',
    { class: 'tour-steps' },
    h('div', { class: 'tour-top' }, skip),
    page,
    mock.el,
    h('footer', { class: 'tour-footer' }, back, dashes, primary),
    live,
  );

  // ---- moving between steps --------------------------------------------------------------------

  function go(next: Step, direction = 1) {
    if (next === step) return;
    const leaving = step;
    if (leaving === 'apps' && apps.size) api.pinSites(APPS.filter((a) => apps.has(a.name)).map((a) => ({ url: a.url, title: a.name })));
    step = next;
    draw(direction, leaving);
  }

  function finish() {
    if (step === 'apps' && apps.size) api.pinSites(APPS.filter((a) => apps.has(a.name)).map((a) => ({ url: a.url, title: a.name })));
    root.classList.add('leaving');
    setTimeout(() => {
      root.classList.remove('leaving');
      stopWelcome();
      api.finishOnboarding();
    }, 420);
  }

  /** The name, as the canvases draw it: the site's poster type, centred a little above the middle. */
  const NAME = 'PERSEU';
  const nameFont = (size: number) => `900 ${size}px "Mona Sans Variable", "Segoe UI", sans-serif`;
  const letterSpacing = '0.08em';

  /** Prints the sky, then gathers the name out of its dots; the words and Begin follow. */
  let printedFor = '';
  async function startWelcome() {
    const { width, height } = hero.getBoundingClientRect();
    // The window is still the browser's sidebar until setWelcomeWindow lands; the observer below calls again at the welcome size.
    if (width < 600 || height < 400 || printedFor === `${width}x${height}`) return;
    printedFor = `${width}x${height}`;
    stopName?.();
    const size = Math.round(Math.min(width * 0.13, 112));
    await document.fonts.load(nameFont(size)).catch(() => undefined);
    const measure = document.createElement('canvas').getContext('2d')!;
    Object.assign(measure, { font: nameFont(size), fontStretch: 'condensed', letterSpacing });
    const m = measure.measureText(NAME);
    const ascent = m.actualBoundingBoxAscent;
    const box = { x: (width - m.width) / 2, y: height * 0.4 - ascent, w: m.width, h: ascent + m.actualBoundingBoxDescent };
    const letters = (context: CanvasRenderingContext2D) => {
      Object.assign(context, { font: nameFont(size), fontStretch: 'condensed', letterSpacing, fillStyle: '#000' });
      context.fillText(NAME, 0, ascent);
    };
    welcomeText.style.top = `${box.y + box.h + 30}px`;
    const scene = root.dataset.theme === 'dark' ? 'night' : 'day';
    const quiet = { x: width / 2, y: box.y + box.h + 40, rx: width * 0.34, ry: height * 0.24 };
    await printSky(sky, scene, width, height, height * 0.82, quiet).catch((err) => console.warn('Perseu: the sky did not print', err));
    if (step !== 'welcome' || root.hidden) return;
    hero.dataset.sky = '';
    const ink = getComputedStyle(hero).getPropertyValue('--sky-ink').trim() || '#fff';
    // The solid name, drawn once in the same place the dots land.
    const density = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(solid, { width: Math.round(width * density), height: Math.round(height * density) });
    const context = solid.getContext('2d')!;
    context.setTransform(density, 0, 0, density, box.x * density, box.y * density);
    letters(context);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = ink;
    context.fillRect(-box.x, -box.y, width, height);
    if (!named) playIntro();
    if (named || reducedMotion.matches) {
      hero.dataset.phase = 'still';
      return;
    }
    hero.dataset.phase = 'forming';
    stopName = formName(air, {
      stage: { width, height },
      box,
      letters,
      color: ink,
      onformed: () => ((hero.dataset.phase = 'formed'), (named = true)),
      ondone: () => (hero.dataset.phase = 'still'),
    });
  }

  new ResizeObserver(() => step === 'welcome' && !root.hidden && void startWelcome()).observe(hero);

  /** Zephium's intro (tour/intro.m4a), once, as the name gathers. A browser that refuses to autoplay just stays quiet. */
  let introPlayed = false;
  function playIntro() {
    if (introPlayed) return;
    introPlayed = true;
    new Audio('tour/intro.m4a').play().catch(() => undefined);
  }

  function stopWelcome() {
    stopName?.();
    stopName = undefined;
    printedFor = '';
    delete hero.dataset.phase;
    delete hero.dataset.sky;
  }

  // ---- the small Perseu ------------------------------------------------------------------------

  const appIcon = (a: (typeof APPS)[number]) => state?.faviconUrls?.[new URL(a.url).host];
  const appMark = (a: (typeof APPS)[number], cls: string) => {
    const src = appIcon(a);
    return src ? h('img', { class: `${cls}${INK_ICONS.has(a.name) ? ' ink' : ''}`, src, alt: '', draggable: 'false' }) : h('span', { class: `${cls} mono`, style: `--app:${a.color}` }, a.mark);
  };

  function buildMock() {
    const favs = h('div', { class: 'mk-favs' });
    const spaceName = h('b', { class: 'mk-space-name' });
    const spaceEmoji = h('span', { class: 'mk-space-emoji' });
    const el = h(
      'div',
      { class: 'tour-mock', 'aria-hidden': 'true' },
      h(
        'div',
        { class: 'mk-side' },
        h('div', { class: 'mk-bar' }, h('i', { class: 'mk-ico panel' }), h('i', { class: 'mk-ico glass' })),
        favs,
        h('p', { class: 'mk-space' }, spaceEmoji, spaceName),
        h('p', { class: 'mk-tab pinned' }, h('i'), 'Notes', h('i', { class: 'mk-lock' })),
        h('div', { class: 'mk-rule' }, h('span'), h('small', {}, 'Archive')),
        h('p', { class: 'mk-tab on' }, h('img', { src: 'logo.png', alt: '' }), 'New Tab'),
        ...MOCK_TABS.map((t, i) => h('p', { class: 'mk-tab', style: `--i:${i}` }, h('i'), t)),
        h('p', { class: 'mk-tab new' }, h('span', {}, '+'), 'New tab'),
        h('div', { class: 'mk-foot' }, h('i'), h('i'), h('span', { class: 'mk-spaces' }, h('i', { class: 'on' }), h('i')), h('i')),
      ),
      h(
        'div',
        { class: 'mk-page' },
        h('img', { class: 'mk-logo', src: 'logo.png', alt: '', draggable: 'false' }),
        h('div', { class: 'mk-search' }, h('span', {}, 'Search or type a URL'), h('small', {}, '+ Add tabs or files')),
      ),
    );
    // Not '' (no apps): the empty slots are drawn on the first update.
    let shownFavs: string | undefined;
    return {
      el,
      update() {
        const sp = space();
        const dark = root.dataset.theme === 'dark';
        const tints = (sp?.colors?.length ? sp.colors : [sp?.color ?? 'default']).map((c) => spaceTint(c, dark));
        el.style.setProperty('--mk-tint', tints[0]);
        el.style.setProperty('--mk-gradient', tints.length > 1 ? `linear-gradient(180deg, ${tints.join(', ')})` : 'none');
        el.dataset.ink = isDark(tints[0]) ? 'light' : 'dark';
        spaceEmoji.textContent = sp?.emoji ?? '';
        spaceName.textContent = sp?.name || 'Space';
        const chosen = APPS.filter((a) => apps.has(a.name));
        const key = chosen.map((a) => a.name + (appIcon(a) ? '+' : '')).join();
        if (key === shownFavs) return;
        const before = new Set((shownFavs ?? '').split(',').map((n) => n.replace('+', '')));
        shownFavs = key;
        const shown = chosen.slice(0, chosen.length > 8 ? 7 : 8);
        favs.replaceChildren(
          ...shown.map((a) => h('span', { class: `mk-fav${before.has(a.name) ? '' : ' new'}` }, appMark(a, 'mk-fav-icon'))),
          ...(chosen.length > 8 ? [h('span', { class: 'mk-fav more' }, `+${chosen.length - 7}`)] : []),
          // Empty slots so the row keeps its shape before anything is picked.
          ...Array.from({ length: Math.max(0, 4 - shown.length) }, () => h('span', { class: 'mk-fav ghost' })),
        );
      },
    };
  }

  // ---- the Space colours: the sidebar's field, up to three dots for a gradient ----------------

  const colorsOf = () => {
    const sp = space();
    if (!sp) return [];
    return sp.colors?.length ? sp.colors : [sp.color === 'default' ? spaceTint('default', false) : sp.color];
  };

  function buildPicker() {
    let index = 0;
    const setStop = (color: string) => {
      const sp = space();
      if (!sp) return;
      const colors = [...colorsOf()];
      colors[Math.min(index, colors.length - 1)] = color;
      api.updateSpace(sp.id, { colors });
    };
    const dragSend = throttled(setStop);
    const remove = (i: number) => {
      const sp = space();
      const colors = colorsOf();
      if (!sp || colors.length < 2) return;
      index = Math.max(0, i - 1);
      api.updateSpace(sp.id, { colors: colors.filter((_, j) => j !== i) });
    };
    const canvas = h('canvas', { class: 'tour-field-canvas', width: '320', height: '88' }) as HTMLCanvasElement;
    paintField(canvas);
    const dots = h('div', { class: 'tour-field-dots' });
    const field = h('div', { class: 'tour-field', title: 'Drag a dot to change its colour' }, canvas, dots);
    const presets = h(
      'div',
      { class: 'tour-swatches', role: 'group', 'aria-label': 'Suggested colours' },
      ...COLORS.map((color, i) => h('button', { 'aria-label': `Suggested colour ${i + 1}`, style: `--swatch:${color}`, onclick: () => setStop(color) })),
    );
    const chips = h('div', { class: 'tour-chips', role: 'radiogroup', 'aria-label': 'Gradient colours' });
    const add = h(
      'button',
      {
        class: 'tour-chip-add',
        'aria-label': 'Add a colour',
        title: 'Add a colour (up to 3)',
        onclick: () => {
          const sp = space();
          const colors = colorsOf();
          if (!sp || colors.length >= 3) return;
          index = colors.length;
          api.updateSpace(sp.id, { colors: [...colors, nextStop(colors[colors.length - 1])] });
        },
      },
      '+',
    );
    // Pressing the field moves the selected dot there: the dot follows the pointer at once, the Space a few times a second.
    field.addEventListener('pointerdown', (e) => {
      const dot = (e.target as Element).closest<HTMLElement>('.tour-dot');
      if (dot) index = Number(dot.dataset.index);
      const box = canvas.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const x = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
        const y = Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height));
        const color = fieldColor(x, y);
        const shown = dots.querySelector<HTMLElement>('.tour-dot.on');
        if (shown) Object.assign(shown.style, { left: `${x * 100}%`, top: `${y * 100}%` }), shown.style.setProperty('--dot', color);
        dragSend.push(color);
      };
      dragging = true;
      field.setPointerCapture(e.pointerId);
      move(e);
      field.addEventListener('pointermove', move);
      const end = () => {
        field.removeEventListener('pointermove', move);
        dragSend.flush();
        dragging = false;
        draw();
      };
      field.addEventListener('pointerup', end, { once: true });
      field.addEventListener('pointercancel', end, { once: true });
    });
    const el = h(
      'div',
      { class: 'tour-picker' },
      presets,
      field,
      h('div', { class: 'tour-picker-row' }, chips, add, h('p', { class: 'tour-note' }, 'Up to three colours, fading top to bottom.')),
    );
    return {
      el,
      update() {
        const colors = colorsOf();
        index = Math.min(index, colors.length - 1);
        [...presets.children].forEach((b, i) => b.classList.toggle('on', COLORS[i] === colors[index]));
        dots.replaceChildren(
          ...colors.map((color, i) => {
            const { x, y } = fieldPoint(color);
            return h('span', { class: `tour-dot${i === index ? ' on' : ''}`, 'data-index': String(i), style: `--dot:${color};left:${x * 100}%;top:${y * 100}%` });
          }),
        );
        if (dragging) return;
        chips.replaceChildren(
          ...colors.map((color, i) =>
            h(
              'button',
              {
                class: 'tour-chip',
                role: 'radio',
                'aria-checked': String(i === index),
                'aria-label': `Colour ${i + 1}: ${color}${colors.length > 1 ? ', Delete removes it' : ''}`,
                style: `--swatch:${color}`,
                onclick: () => ((index = i), draw()),
                onkeydown: (e: KeyboardEvent) => (e.key === 'Delete' || e.key === 'Backspace') && remove(i),
              },
              colors.length > 1 && i === index ? h('span', { class: 'tour-chip-x', title: 'Remove this colour', onclick: (e: Event) => (e.stopPropagation(), remove(i)) }, '×') : null,
            ),
          ),
        );
        add.hidden = colors.length >= 3;
      },
    };
  }

  // ---- the steps -------------------------------------------------------------------------------

  function heading(title: string, lead: string) {
    return h(
      'header',
      { class: 'tour-head' },
      h('h1', { class: 'poster', tabindex: '-1' }, h('span', { class: 'line' }, h('span', {}, title))),
      h('p', { class: 'tour-lead' }, lead),
    );
  }

  function tile(props: { label: string; mark: Node; on: boolean; i: number; onclick: () => void; aria?: string }) {
    return h(
      'button',
      { class: `tour-tile${props.on ? ' on' : ''}`, 'aria-pressed': String(props.on), 'aria-label': props.aria ?? props.label, style: `--i:${props.i}`, onclick: props.onclick },
      h('span', { class: 'tour-tile-mark', 'aria-hidden': 'true' }, props.mark),
      h('span', { class: 'tour-tile-name' }, props.label),
    );
  }

  function browserMark(b: DetectedBrowser) {
    const id = b.id.split('-')[0];
    if (BROWSER_ICONS.has(id)) return h('img', { class: 'tour-icon', src: `tour/browsers/${id}.png`, alt: '', draggable: 'false' });
    const color = BROWSER_COLORS[id] ?? BROWSER_COLORS[b.name.toLowerCase().split(' ')[0]] ?? '#464d5c';
    return h('span', { class: 'tour-icon mono', style: `--app:${color}` }, b.name[0]);
  }

  async function runImport(b: DetectedBrowser) {
    importing.add(b.id);
    draw();
    try {
      const r = await (refused.has(b.id) ? api.importBrowserCookies(b.id) : api.importBrowser(b.id));
      imported.set(b.id, importSummary(r));
      if (r.cookiesRefused) refused.add(b.id);
      else refused.delete(b.id);
    } catch {
      imported.set(b.id, 'Couldn’t import this one. Try again from Settings.');
    }
    importing.delete(b.id);
    draw();
  }

  function importStep() {
    if (!browsers) {
      api.detectBrowsers().then(
        (found) => ((browsers = found), step === 'import' && draw()),
        () => ((browsers = []), step === 'import' && draw()),
      );
    }
    const chosen = browsers?.find((b) => b.id === chosenBrowser);
    const list = !browsers
      ? h('p', { class: 'tour-note' }, 'Looking for your browsers…')
      : !browsers.length
        ? h('p', { class: 'tour-note' }, 'No other browsers found. You can import later from Settings.')
        : h(
            'div',
            { class: 'tour-tiles browsers', role: 'group', 'aria-label': 'Import from' },
            ...browsers.map((b, i) =>
              tile({
                label: b.name,
                mark: browserMark(b),
                on: chosenBrowser === b.id,
                i,
                aria: `${b.name}: ${imported.get(b.id) ?? browserDetail(b)}`,
                onclick: () => ((chosenBrowser = chosenBrowser === b.id ? undefined : b.id), draw()),
              }),
            ),
          );
    const done = chosen && imported.get(chosen.id);
    const busy = chosen && importing.has(chosen.id);
    const action = chosen
      ? h(
          'div',
          { class: 'tour-import-row' },
          h('p', { class: 'tour-note' }, done ?? browserDetail(chosen)),
          done && !refused.has(chosen.id)
            ? h('span', { class: 'tour-done label' }, 'Imported')
            : h('button', { class: 'btn small', disabled: busy, onclick: () => runImport(chosen) }, busy ? 'Importing…' : refused.has(chosen.id) ? 'Try again' : `Import from ${chosen.name}`),
        )
      : null;
    const engine = state?.searchEngine ?? 'google';
    return h(
      'div',
      { class: 'tour-step import' },
      heading('Bring your web with you.', 'Bookmarks and history from the browser you’re leaving, and the search engine you already know.'),
      h(
        'div',
        { class: 'tour-col' },
        h('p', { class: 'label tour-label' }, 'Import from'),
        list,
        action,
        h('p', { class: 'label tour-label' }, 'Search with'),
        h(
          'div',
          { class: 'tour-segments', role: 'radiogroup', 'aria-label': 'Search engine' },
          ...ENGINES.map((e) =>
            h('button', { class: engine === e.id ? 'on' : '', role: 'radio', 'aria-checked': String(engine === e.id), onclick: () => api.setPreferences({ searchEngine: e.id }) }, e.name),
          ),
        ),
      ),
    );
  }

  function appsStep() {
    return h(
      'div',
      { class: 'tour-step apps' },
      heading('Keep what you use every day.', 'They wait as icons at the top of your sidebar, and only load when you open them.'),
      h(
        'div',
        { class: 'tour-tiles apps', role: 'group', 'aria-label': 'Apps to keep' },
        ...APPS.map((a, i) =>
          tile({
            label: a.name,
            mark: appMark(a, 'tour-icon'),
            on: apps.has(a.name),
            i,
            onclick: () => {
              if (!apps.delete(a.name)) apps.add(a.name);
              draw();
            },
          }),
        ),
      ),
    );
  }

  function keycaps(id: string, fallback: string[]) {
    const keys = keysFor(id);
    return h('span', { class: 'tour-keys' }, ...(keys.length ? keys : fallback).map((k) => h('kbd', {}, k)));
  }

  function commandStep() {
    const typed = h('span', { class: 'cmd-typed' });
    const rows = h('div', { class: 'cmd-rows' });
    const bar = h(
      'div',
      { class: 'cmd-bar', 'aria-hidden': 'true' },
      h('div', { class: 'cmd-input' }, h('span', { class: 'cmd-glass' }, '⌕'), typed, h('span', { class: 'cmd-caret' })),
      rows,
    );
    playDemo(typed, rows);
    return h(
      'div',
      { class: 'tour-step command' },
      heading('Always a shortcut away.', 'One box for your tabs, history, bookmarks and the web. Type a few letters and press Enter.'),
      bar,
      h(
        'div',
        { class: 'cmd-keys' },
        h('div', { class: `cmd-key${triedCommandBar ? ' tried' : ''}` }, keycaps('newTab', ['Ctrl', 'T']), h('p', { class: 'tour-note' }, triedCommandBar ? 'That’s the one. Try it on any page.' : 'Try it now: the command bar')),
        h('div', { class: 'cmd-key' }, keycaps('openLocation', ['Ctrl', 'L']), h('p', { class: 'tour-note' }, 'Edit the address of the page you’re on')),
      ),
    );
  }

  /** Types the query, shows what it finds, holds, and starts again; the real bar does this live. */
  function playDemo(typed: HTMLElement, rows: HTMLElement) {
    clearTimeout(demoTimer);
    const showRows = (n: number) =>
      rows.replaceChildren(
        ...DEMO_ROWS.slice(0, n).map((r, i) =>
          h(
            'div',
            { class: `cmd-row${i ? '' : ' on'}`, style: `--i:${i}` },
            h('span', { class: 'cmd-mark', style: `--app:${r.color}` }, r.mark),
            h('span', { class: 'cmd-title' }, h('b', {}, r.title.slice(0, DEMO_QUERY.length)), r.title.slice(DEMO_QUERY.length)),
            r.hint ? h('span', { class: 'cmd-hint label' }, r.hint) : null,
          ),
        ),
      );
    if (reducedMotion.matches) {
      typed.textContent = DEMO_QUERY;
      return showRows(DEMO_ROWS.length);
    }
    let i = 0;
    const tick = () => {
      if (step !== 'command') return;
      if (i <= DEMO_QUERY.length) {
        typed.textContent = DEMO_QUERY.slice(0, i);
        showRows(i === 0 ? 0 : Math.min(DEMO_ROWS.length, i + 1));
        i++;
        demoTimer = setTimeout(tick, i === 1 ? 900 : 260);
      } else {
        i = 0;
        demoTimer = setTimeout(tick, 2600);
      }
    };
    tick();
  }

  function spaceStep() {
    const sp = space();
    if (!sp) return h('div');
    const name = h('input', { class: 'tour-input', value: sp.name, maxlength: '40', spellcheck: 'false', placeholder: 'Work, Personal, Side project…', 'aria-label': 'Space name' }) as HTMLInputElement;
    name.addEventListener('input', () => name.value.trim() && api.updateSpace(sp.id, { name: name.value }));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && go('look'));
    return h(
      'div',
      { class: 'tour-step space' },
      heading('Give your tabs a Space.', 'A Space keeps its own tabs. Start with one, and add Work or Study later.'),
      h(
        'div',
        { class: 'tour-col' },
        h('label', { class: 'label tour-label' }, 'Name'),
        name,
        h('p', { class: 'label tour-label' }, 'Icon'),
        h(
          'div',
          { class: 'tour-emojis', role: 'radiogroup', 'aria-label': 'Space icon' },
          ...EMOJIS.map((emoji) => h('button', { class: sp.emoji === emoji ? 'on' : '', role: 'radio', 'aria-checked': String(sp.emoji === emoji), onclick: () => api.updateSpace(sp.id, { emoji }) }, emoji)),
        ),
        h('p', { class: 'label tour-label' }, 'Colour'),
        (picker.update(), picker.el),
      ),
    );
  }

  function lookStep() {
    const theme = state?.theme ?? 'system';
    const cards = [
      { id: 'system', title: 'Match Windows', text: 'Light by day, dark at night, as Windows switches.' },
      { id: 'light', title: 'Light', text: 'Paper and ink, always.' },
      { id: 'dark', title: 'Dark', text: 'The night sky, always.' },
    ] as const;
    return h(
      'div',
      { class: 'tour-step look' },
      heading('Pick how Perseu looks.', 'Change it any time in Settings.'),
      h(
        'div',
        { class: 'tour-cards', role: 'radiogroup', 'aria-label': 'Appearance' },
        ...cards.map((c, i) =>
          h(
            'button',
            { class: `tour-card${theme === c.id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(theme === c.id), style: `--i:${i}`, onclick: () => api.setPreferences({ theme: c.id }) },
            h('span', { class: `tour-swatch-art ${c.id}`, 'aria-hidden': 'true' }),
            h('strong', {}, c.title),
            h('small', {}, c.text),
          ),
        ),
      ),
    );
  }

  function readyStep() {
    const d = state?.defaultBrowser;
    return h(
      'div',
      { class: 'tour-step ready' },
      heading('Ready when you are.', ''),
      h('ul', { class: 'tour-features' }, ...FEATURES.map((f, i) => h('li', { style: `--i:${i}` }, f))),
      d && !d.isDefault && d.canSet ? h('button', { class: 'tour-link', onclick: () => api.makeDefaultBrowser() }, 'Make Perseu your default browser') : null,
    );
  }

  function primaryLabel() {
    if (step === 'ready') return 'Start browsing';
    if (step === 'look') return 'Continue';
    const empty = (step === 'import' && !imported.size) || (step === 'apps' && !apps.size);
    return empty ? 'Skip' : 'Continue';
  }

  // ---- drawing ---------------------------------------------------------------------------------

  function draw(direction = 1, leaving?: Step) {
    if (!root.firstChild) root.append(h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Perseu' }, hero, steps));
    const changed = shownStep !== step;
    shownStep = step;
    root.dataset.step = step;
    root.dataset.mock = MOCK[step];
    applyTheme();
    mock.update();
    if (step === 'welcome') {
      if (changed) void startWelcome();
      if (changed && leaving) begin.focus();
      return;
    }
    if (leaving === 'welcome') setTimeout(stopWelcome, 900);
    const body = { import: importStep, apps: appsStep, command: commandStep, space: spaceStep, look: lookStep, ready: readyStep }[step]();
    const focused = document.activeElement as HTMLElement | null;
    const keepCaret = focused?.classList.contains('tour-input') ? (focused as HTMLInputElement).selectionStart : null;
    if (changed) {
      body.classList.add('enter');
      body.style.setProperty('--from', direction > 0 ? '28px' : '-28px');
    }
    page.replaceChildren(body);
    [...dashes.children].forEach((d, i) => d.classList.toggle('on', i === index() - 1));
    back.hidden = false;
    skip.hidden = step === 'ready';
    primary.replaceChildren(primaryLabel(), h('span', { class: 'btn-meta', 'aria-hidden': 'true' }, '↵'));
    primary.classList.toggle('sun-btn', step === 'ready');
    primary.onclick = step === 'ready' ? finish : () => go(STEPS[index() + 1]);
    if (changed) {
      live.textContent = `Step ${index()} of ${STEPS.length - 1}: ${body.querySelector('h1')?.textContent ?? ''}`;
      body.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
    // Redrawing replaces the name field; keep typing where you were.
    if (keepCaret !== null) {
      const input = root.querySelector<HTMLInputElement>('.tour-input');
      input?.focus();
      input?.setSelectionRange(keepCaret, keepCaret);
    }
  }

  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    const theme = state?.theme ?? 'system';
    root.dataset.theme = theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : theme;
  }
  systemDark.addEventListener('change', applyTheme);

  api.onTourKey((command) => {
    if (root.hidden || step !== 'command' || command !== 'newTab' || triedCommandBar) return;
    triedCommandBar = true;
    draw();
  });
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    // Enter on a focused control does that control's job; elsewhere it moves on.
    if (target.tagName === 'INPUT' || (target.tagName === 'BUTTON' && root.contains(target))) return;
    e.preventDefault();
    (step === 'welcome' ? begin : primary).click();
  });

  return function render(s: UiState) {
    state = s;
    const show = !s.onboarded;
    if (show && root.hidden) {
      step = 'welcome';
      shownStep = undefined;
      triedCommandBar = false;
    }
    root.hidden = !show;
    if (isWindow && welcome !== show) {
      welcome = show;
      void chrome.flechaPrivate?.setWelcomeWindow?.(show);
    }
    if (!show) {
      clearTimeout(demoTimer);
      return stopWelcome();
    }
    if (!askedIcons) {
      askedIcons = true;
      api.wantSiteIcons(APPS.map((a) => new URL(a.url).host));
    }
    if (dragging) {
      mock.update();
      return picker.update();
    }
    // Only what the steps show; other updates (pages loading) would restart the animations.
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId);
    const icons = APPS.filter((a) => appIcon(a)).length;
    const key = JSON.stringify([s.theme, s.searchEngine, sp?.emoji, sp?.color, sp?.colors, sp?.name, s.defaultBrowser, s.shortcuts, icons]);
    if (key !== drawn || !root.firstChild) draw();
    drawn = key;
  };
}
