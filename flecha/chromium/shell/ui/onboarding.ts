import type { FlechaApi, UiState } from '../../shared/types';
import { browserDetail, importSummary } from './browserImport.js';

/**
 * The first-run tour, told through the myth of Perseus. The window itself is small and has no
 * buttons meanwhile (setWelcomeWindow); it grows into the browser when the tour ends.
 * Your first Space is set up for real as you go. It comes back from Settings → Welcome tour.
 */

type H = (tag: string, props?: Record<string, unknown>, ...children: Array<Node | string | null | undefined>) => HTMLElement;
type DetectedBrowser = Awaited<ReturnType<FlechaApi['detectBrowsers']>>[number];

const STEPS = ['intro', 'goal', 'space', 'import', 'try', 'done'] as const;
type Step = (typeof STEPS)[number];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** Public-domain and CC0 works; see docs/README.md for their sources. */
const ART: Record<Step, { file: string; sculpture?: boolean; focus?: string; caption: string }> = {
  intro: { file: 'art-perseus.webp', caption: 'Edward Burne-Jones, study of Perseus in armour' },
  goal: { file: 'art-cellini.webp', sculpture: true, caption: 'Benvenuto Cellini, Perseus with the Head of Medusa' },
  space: { file: 'art-perseus-medusa.webp', focus: '62% 50%', caption: 'Perseus and Medusa' },
  import: { file: 'art-atlas.webp', caption: 'Edward Burne-Jones, Atlas Turned to Stone' },
  try: { file: 'art-vase.webp', sculpture: true, caption: 'Terracotta pelike, The Met' },
  done: { file: 'art-baleful.webp', caption: 'Edward Burne-Jones, The Baleful Head' },
};

/** Starting points for the first Space; the next step fine-tunes it. */
const PRESETS = [
  { id: 'work', name: 'Work', emoji: '💼', color: '#c9e3f5', text: 'Mail, docs and meetings', image: 'art-atlas.webp', focus: '50% 30%', tabs: ['Inbox', 'Q4 planning', 'Standup notes'] },
  { id: 'personal', name: 'Personal', emoji: '🏠', color: '#f7dcc0', text: 'Videos and shopping', image: 'art-baleful.webp', focus: '50% 22%', tabs: ['YouTube', 'Trip ideas', 'Recipes'] },
  { id: 'study', name: 'Study', emoji: '📚', color: '#d3ecd5', text: 'Classes and research', image: 'art-athena.webp', focus: '50% 38%', tabs: ['Lecture notes', 'Wikipedia', 'Flashcards'] },
  { id: 'project', name: 'Side project', emoji: '🚀', color: '#e8d6f3', text: 'What you build after hours', image: 'art-perseus.webp', focus: '50% 18%', tabs: ['GitHub', 'Figma', 'localhost:5173'] },
] as const;

const EMOJIS = ['🏠', '💼', '🚀', '🧪', '🛠️', '🎨', '📚', '🧠', '🎮', '🌱', '☕️', '⚡️'];
const COLORS = ['#cdd9f7', '#c9e3f5', '#cfe8ec', '#d3ecd5', '#f5e7c4', '#f7dcc0', '#f4cfdc', '#e8d6f3'];

/** Shortcuts to try in the tour, in order. */
const CHALLENGES: Array<{ id: string; label: string; done: string }> = [
  { id: 'newTab', label: 'Open the command bar', done: 'Tabs, history and actions in one box' },
  { id: 'toggleSidebar', label: 'Hide the sidebar', done: 'Move to the left edge to bring it back' },
  { id: 'splitNew', label: 'Split the view', done: 'Or drag any tab onto the page' },
];

export function setupOnboarding(api: FlechaApi, h: H) {
  const root = document.getElementById('onboarding')!;
  const isWindow = 'frame' in document.documentElement.dataset;
  let step: Step = 'intro';
  let state: UiState | undefined;
  let preset: (typeof PRESETS)[number] | undefined;
  let browsers: DetectedBrowser[] | undefined;
  const imported = new Map<string, string>();
  /** Imports that came over without their cookies, since the browser said no. */
  const refused = new Set<string>();
  const importing = new Set<string>();
  const tried = new Set<string>();
  let drawn = '';
  /** The step the last draw showed; its entrance animation only plays when the step changes. */
  let shownStep: Step | undefined;
  // Unknown until the first render: a window that started small must hear "false" too.
  let welcome: boolean | undefined;

  const space = () => state?.spaces.find((s) => s.id === state!.activeSpaceId);
  const keys = (id: string) => state?.shortcuts[id] || '';

  const art = h('img', { class: 'tour-art', alt: '', draggable: 'false' }) as HTMLImageElement;
  const caption = h('p', { class: 'tour-caption' });
  const numeral = h('span', { class: 'tour-count' });
  const stepBody = h('div', { class: 'tour-body' });
  const footer = h('footer', { class: 'tour-buttons' });
  const skip = h('button', { class: 'tour-skip' }, 'Skip tour');
  const live = h('p', { class: 'tour-live', 'aria-live': 'polite' });

  const go = (next: Step) => {
    step = next;
    draw();
  };
  const next = () => go(STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)]);
  const back = () => go(STEPS[Math.max(STEPS.indexOf(step) - 1, 0)]);
  const finish = () => {
    root.classList.add('leaving');
    setTimeout(() => {
      root.classList.remove('leaving');
      api.finishOnboarding();
    }, 380);
  };
  skip.onclick = finish;

  type Look = { palette?: boolean; hidden?: boolean; split?: boolean };
  let lastLook: Look = {};
  const lookClass = (look: Look) => `tour-pv${look.palette ? ' palette' : ''}${look.hidden ? ' no-sidebar' : ''}${look.split ? ' split' : ''}`;

  /** A small Perseu showing what the current answer changes. */
  function preview(tabs: readonly string[], look: Look = {}) {
    const sp = space();
    // Built in the previous look, then changed, so the change animates.
    const el = h(
      'div',
      { class: lookClass(lastLook), 'aria-hidden': 'true', style: `--pv-tint:${sp?.color ?? COLORS[0]}` },
      h('div', { class: 'pv-side' }, h('p', { class: 'pv-space' }, h('span', {}, sp?.emoji ?? ''), h('span', {}, sp?.name || 'Space')), ...tabs.map((title, i) => h('p', { class: `pv-tab${i ? '' : ' on'}` }, title))),
      h('div', { class: 'pv-page' }, h('i'), h('i', { class: 'pv-second' })),
      h('div', { class: 'pv-palette' }, 'Search or open a page'),
    );
    requestAnimationFrame(() => (el.className = lookClass(look)));
    lastLook = look;
    return el;
  }

  const previewTabs = () => preset?.tabs ?? ['Your tabs', 'Stay in', 'This Space'];

  function heading(title: string, lead: string) {
    return h('header', { class: 'tour-head' }, h('h1', {}, title), h('p', { class: 'tour-lead' }, lead));
  }

  function introStep() {
    return h('div', { class: 'tour-step tour-intro' }, h('h1', {}, 'Perseu'), h('p', { class: 'tour-lead' }, 'Every tab in its place.'));
  }

  function goalStep() {
    return h(
      'div',
      { class: 'tour-step' },
      heading('What is your first Space for?', 'Each Space keeps its own tabs.'),
      h(
        'div',
        { class: 'tour-options', role: 'radiogroup', 'aria-label': 'First Space' },
        ...PRESETS.map((p) =>
          h(
            'button',
            {
              class: `tour-option${preset?.id === p.id ? ' on' : ''}`,
              role: 'radio',
              'aria-checked': String(preset?.id === p.id),
              onclick: () => {
                preset = p;
                const sp = space();
                if (sp) api.updateSpace(sp.id, { name: p.name, emoji: p.emoji, color: p.color });
                draw();
              },
            },
            h('img', { class: 'tour-option-art', src: p.image, alt: '', draggable: 'false', style: `object-position:${p.focus}` }),
            h('span', { class: 'tour-option-text' }, h('strong', {}, p.name), h('small', {}, p.text)),
          ),
        ),
      ),
      preview(previewTabs()),
    );
  }

  function spaceStep() {
    const sp = space();
    if (!sp) return h('div');
    const name = h('input', { class: 'tour-input', value: sp.name, maxlength: '40', spellcheck: 'false', placeholder: 'Work, Personal, Side project…', 'aria-label': 'Space name' }) as HTMLInputElement;
    name.addEventListener('input', () => name.value.trim() && api.updateSpace(sp.id, { name: name.value }));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && next());
    const theme = state?.theme ?? 'system';
    return h(
      'div',
      { class: 'tour-step' },
      heading('Name it, then pick its look', 'Its colour tints the sidebar.'),
      name,
      h(
        'div',
        { class: 'tour-emojis', role: 'radiogroup', 'aria-label': 'Space icon' },
        ...EMOJIS.map((emoji) =>
          h('button', { class: `tour-emoji${sp.emoji === emoji ? ' on' : ''}`, role: 'radio', 'aria-checked': String(sp.emoji === emoji), onclick: () => api.updateSpace(sp.id, { emoji }) }, emoji),
        ),
      ),
      h(
        'div',
        { class: 'tour-swatches', role: 'radiogroup', 'aria-label': 'Space colour' },
        ...COLORS.map((color, i) =>
          h('button', {
            class: `tour-swatch${sp.color === color ? ' on' : ''}`,
            role: 'radio',
            'aria-checked': String(sp.color === color),
            'aria-label': `Colour ${i + 1}`,
            style: `--swatch:${color}`,
            onclick: () => api.updateSpace(sp.id, { color }),
          }),
        ),
      ),
      h(
        'div',
        { class: 'tour-segmented', role: 'radiogroup', 'aria-label': 'Theme' },
        ...(['system', 'light', 'dark'] as const).map((t) =>
          h('button', { class: theme === t ? 'on' : '', role: 'radio', 'aria-checked': String(theme === t), onclick: () => api.setPreferences({ theme: t }) }, t === 'system' ? 'Match Windows' : t === 'light' ? 'Light' : 'Dark'),
        ),
      ),
      preview(previewTabs()),
    );
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
      imported.set(b.id, 'Couldn’t import this one');
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
    const list = !browsers
      ? h('p', { class: 'tour-note' }, 'Looking for your browsers…')
      : !browsers.length
        ? h('p', { class: 'tour-note' }, 'No other browsers found. You can import later from Settings.')
        : h(
            'div',
            { class: 'tour-rows' },
            ...browsers.map((b) => {
              const done = imported.get(b.id);
              const busy = importing.has(b.id);
              return h(
                'div',
                { class: `tour-row${done ? ' done' : ''}` },
                h('span', { class: 'tour-row-text' }, h('strong', {}, b.name), h('small', {}, done ?? browserDetail(b))),
                done && !refused.has(b.id)
                  ? h('span', { class: 'tour-done' }, 'Imported')
                  : h('button', { class: 'tour-ghost', disabled: busy, 'aria-label': `Import from ${b.name}`, onclick: () => runImport(b) }, busy ? 'Importing…' : refused.has(b.id) ? 'Try again' : 'Import'),
              );
            }),
          );
    return h('div', { class: 'tour-step' }, heading('Bring your stuff over', 'Bookmarks become pinned tabs. Passwords stay where they are.'), list);
  }

  function tryStep() {
    const current = CHALLENGES.find((c) => !tried.has(c.id));
    return h(
      'div',
      { class: 'tour-step' },
      heading('Try the shortcuts', 'Press the real keys. Change any of them in Settings.'),
      h(
        'div',
        { class: 'tour-rows' },
        ...CHALLENGES.map((c) => {
          const done = tried.has(c.id);
          return h(
            'button',
            { class: `tour-row tour-challenge${done ? ' done' : ''}${c === current ? ' current' : ''}`, onclick: () => toggleTried(c.id) },
            h('kbd', { class: 'tour-key' }, keys(c.id) || '—'),
            h('span', { class: 'tour-row-text' }, h('strong', {}, c.label), h('small', {}, done ? c.done : c === current ? 'Press the keys now' : 'Next up')),
            done ? h('span', { class: 'tour-done' }, 'Done') : null,
          );
        }),
      ),
      preview(previewTabs(), { palette: tried.has('newTab'), hidden: tried.has('toggleSidebar'), split: tried.has('splitNew') }),
    );
  }

  function doneStep() {
    const d = state?.defaultBrowser;
    return h(
      'div',
      { class: 'tour-step' },
      heading(d?.isDefault ? 'You’re all set' : 'Make Perseu your default?', d?.isDefault ? 'Links from other apps open in Perseu.' : 'Then links from Discord, Outlook and other apps open here.'),
      d?.isDefault ? h('p', { class: 'tour-note' }, 'Perseu is your default browser') : d?.canSet ? h('button', { class: 'tour-ghost big', onclick: () => api.makeDefaultBrowser() }, 'Make Perseu the default browser') : null,
    );
  }

  function primaryLabel() {
    if (step === 'done') return 'Start browsing';
    if (step === 'intro') return 'Begin';
    const unfinished = (step === 'goal' && !preset) || (step === 'import' && !imported.size) || (step === 'try' && tried.size < CHALLENGES.length);
    // Name where the button goes.
    return unfinished ? 'Skip this step' : { goal: 'Name your Space', space: 'Import your data', import: 'Try the shortcuts', try: 'Finish up' }[step];
  }

  function draw() {
    const body = { intro: introStep, goal: goalStep, space: spaceStep, import: importStep, try: tryStep, done: doneStep }[step]();
    const changed = shownStep !== step;
    body.classList.toggle('enter', changed);
    shownStep = step;
    const index = STEPS.indexOf(step);
    const focused = document.activeElement as HTMLElement | null;
    const keepCaret = focused?.classList.contains('tour-input') ? (focused as HTMLInputElement).selectionStart : null;
    if (!root.firstChild) {
      root.append(
        h(
          'div',
          { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Perseu' },
          h('section', { class: 'tour-stage' }, art, caption),
          h('section', { class: 'tour-left' }, h('div', { class: 'tour-top' }, numeral, skip), stepBody, footer, live),
        ),
      );
    }
    const work = ART[step];
    if (!art.src.endsWith(work.file)) art.src = work.file;
    art.classList.toggle('sculpture', !!work.sculpture);
    art.style.objectPosition = work.focus ?? '';
    caption.textContent = work.caption;
    root.dataset.step = step;
    applyTheme();
    numeral.textContent = ROMAN[index];
    numeral.setAttribute('aria-label', `Step ${index + 1} of ${STEPS.length}`);
    skip.hidden = step === 'done';
    stepBody.replaceChildren(body);
    footer.replaceChildren(
      index ? h('button', { class: 'tour-back', onclick: back }, 'Back') : h('span'),
      h('button', { class: 'tour-primary', onclick: step === 'done' ? finish : next }, primaryLabel()),
    );
    if (changed) live.textContent = `Step ${index + 1} of ${STEPS.length}: ${body.querySelector('h1')?.textContent ?? ''}`;
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

  function tourKey(command: string) {
    if (root.hidden) return;
    if (step === 'try' && CHALLENGES.some((c) => c.id === command)) toggleTried(command);
  }

  function toggleTried(command: string) {
    if (!tried.delete(command)) tried.add(command);
    draw();
  }

  api.onTourKey(tourKey);
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    // Enter on a focused control does that control's job; elsewhere it moves on.
    if (target.tagName === 'INPUT' || (target.tagName === 'BUTTON' && root.contains(target))) return;
    e.preventDefault();
    root.querySelector<HTMLButtonElement>('.tour-primary')?.click();
  });

  return function render(s: UiState) {
    state = s;
    const show = !s.onboarded;
    if (show && root.hidden) {
      step = 'intro';
      tried.clear();
    }
    root.hidden = !show;
    if (isWindow && welcome !== show) {
      welcome = show;
      void chrome.flechaPrivate?.setWelcomeWindow?.(show);
    }
    if (!show) return;
    // Only what the steps show; other updates (pages loading) would restart the animations.
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId);
    const key = JSON.stringify([s.theme, sp?.emoji, sp?.color, sp?.name, s.defaultBrowser, s.shortcuts]);
    if (key !== drawn || !root.firstChild) draw();
    drawn = key;
  };
}
