import { spaceTint } from '../lib/spaceTint';
import type { IconName } from './icons.js';
import type { FlechaApi, UiState } from '../../shared/types';
import { browserDetail, importSummary } from './browserImport.js';

/**
 * The first-run tour, full window: the questions on the left; on the right the hands artwork,
 * tinted with your Space's colour, under a card that previews what each answer changes.
 * Your first Space is set up for real as you go. It comes back from Help → Welcome to Flecha.
 */

type H = (tag: string, props?: Record<string, unknown>, ...children: Array<Node | string | null | undefined>) => HTMLElement;
type DetectedBrowser = Awaited<ReturnType<FlechaApi['detectBrowsers']>>[number];

const STEPS = ['goal', 'space', 'import', 'try', 'done'] as const;
type Step = (typeof STEPS)[number];
const STEP_NAMES: Record<Step, string> = { goal: 'Your Space', space: 'Name and colour', import: 'Import', try: 'Shortcuts', done: 'Default browser' };

/** Starting points for the first Space; the next step fine-tunes it. */
const PRESETS = [
  { id: 'work', name: 'Work', emoji: '💼', color: '#c9e3f5', text: 'Mail, docs and meetings.', tabs: ['Inbox · Outlook', 'Q4 planning · Docs', 'Standup notes'] },
  { id: 'personal', name: 'Personal', emoji: '🏠', color: '#f7dcc0', text: 'Videos, shopping and reading.', tabs: ['YouTube', 'Weekend trip ideas', 'Recipes'] },
  { id: 'study', name: 'Study', emoji: '📚', color: '#d3ecd5', text: 'Classes, notes and research.', tabs: ['Lecture 4 · Notes', 'Wikipedia', 'Flashcards'] },
  { id: 'project', name: 'Side project', emoji: '🚀', color: '#e8d6f3', text: 'What you build after hours.', tabs: ['GitHub', 'Figma', 'localhost:5173'] },
] as const;

const EMOJIS = ['🏠', '💼', '🚀', '🧪', '🛠️', '🎨', '📚', '🧠', '🎮', '🌱', '☕️', '⚡️'];
const COLORS = ['#cdd9f7', '#c9e3f5', '#cfe8ec', '#d3ecd5', '#f5e7c4', '#f7dcc0', '#f4cfdc', '#e8d6f3'];
const TAB_HUES = ['#3aa6d9', '#e4572e', '#1f9d5b'];

/** Shortcuts to try in the tour, in order. */
const CHALLENGES: Array<{ id: string; label: string; done: string }> = [
  { id: 'newTab', label: 'Open the command bar', done: 'Tabs, history and actions in one box.' },
  { id: 'toggleSidebar', label: 'Hide the sidebar', done: 'Move to the left edge to bring it back.' },
  { id: 'splitNew', label: 'Split the view', done: 'Or drag any tab onto the page.' },
];

/** Where Flecha looks for each browser's app icon, by the name the importer reports. */
const APP_NAMES: Record<string, string> = {
  Chrome: 'Google Chrome',
  'Google Chrome': 'Google Chrome',
  Brave: 'Brave Browser',
  Edge: 'Microsoft Edge',
  'Microsoft Edge': 'Microsoft Edge',
  Firefox: 'Firefox',
  Arc: 'Arc',
  Vivaldi: 'Vivaldi',
  Opera: 'Opera',
  Chromium: 'Chromium',
};

export function setupOnboarding(api: FlechaApi, h: H, icon: (name: IconName) => SVGElement) {
  const root = document.getElementById('onboarding')!;
  let step: Step = 'goal';
  let state: UiState | undefined;
  let preset: (typeof PRESETS)[number] | undefined;
  let browsers: DetectedBrowser[] | undefined;
  const appIcons = new Map<string, string | undefined>();
  const imported = new Map<string, string>();
  /** Imports that came over without their cookies, since the browser said no. */
  const refused = new Set<string>();
  const importing = new Set<string>();
  const tried = new Set<string>();
  let drawn = '';
  /** The step the last draw showed; its entrance animation only plays when the step changes. */
  let shownStep: Step | undefined;

  const space = () => state?.spaces.find((s) => s.id === state!.activeSpaceId);
  const keys = (id: string) => state?.shortcuts[id] || '';

  // ---- frame, built once so the artwork and progress bar animate on -----------------

  const progressLabel = h('span', { class: 'tour-count' });
  const progress = h('i');
  const left = h('section', { class: 'tour-left' });
  const stepBody = h('div', { class: 'tour-body' });
  const footer = h('footer', { class: 'tour-buttons' });
  const card = h('div', { class: 'tour-card', 'aria-hidden': 'true' });
  const art = h('img', { class: 'tour-art', src: 'tour-art.png', alt: '', draggable: 'false' });
  const live = h('p', { class: 'tour-live', 'aria-live': 'polite' });

  // ---- steps ---------------------------------------------------------------------

  const go = (next: Step) => {
    step = next;
    card.classList.remove('palette', 'no-sidebar', 'split');
    if (next === 'try') for (const id of tried) play(id);
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

  function heading(kicker: string, title: string, lead: string) {
    return h('header', { class: 'tour-head' }, h('p', { class: 'tour-kicker' }, kicker), h('h1', {}, title), h('p', { class: 'tour-lead' }, lead));
  }

  function goalStep() {
    return h(
      'div',
      { class: 'tour-step' },
      heading('Welcome to Perseu', 'What is your first Space for?', 'Each Space keeps its own tabs. Add more later.'),
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
            h('span', { class: 'tour-option-icon', style: `--swatch:${p.color}` }, p.emoji),
            h('strong', {}, p.name),
            h('small', {}, p.text),
          ),
        ),
      ),
    );
  }

  function spaceStep() {
    const sp = space();
    if (!sp) return h('div');
    const name = h('input', { class: 'tour-input', value: sp.name, maxlength: '40', spellcheck: 'false', placeholder: 'Work, Personal, Side project…' }) as HTMLInputElement;
    name.addEventListener('input', () => name.value.trim() && api.updateSpace(sp.id, { name: name.value }));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && next());
    const theme = state?.theme ?? 'system';
    return h(
      'div',
      { class: 'tour-step' },
      heading('Make it yours', 'Name it and pick its look', 'Its colour tints the sidebar.'),
      h('label', { class: 'tour-field' }, h('span', { class: 'tour-label' }, 'Name'), name),
      h('p', { class: 'tour-label' }, 'Icon'),
      h(
        'div',
        { class: 'tour-emojis', role: 'radiogroup', 'aria-label': 'Icon' },
        ...EMOJIS.map((emoji) =>
          h('button', { class: `tour-emoji${sp.emoji === emoji ? ' on' : ''}`, role: 'radio', 'aria-checked': String(sp.emoji === emoji), onclick: () => api.updateSpace(sp.id, { emoji }) }, emoji),
        ),
      ),
      h('p', { class: 'tour-label' }, 'Colour'),
      h(
        'div',
        { class: 'tour-swatches', role: 'radiogroup', 'aria-label': 'Colour' },
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
      h('p', { class: 'tour-label' }, 'Theme'),
      h(
        'div',
        { class: 'tour-segmented', role: 'radiogroup', 'aria-label': 'Theme' },
        ...(['system', 'light', 'dark'] as const).map((t) =>
          h('button', { class: theme === t ? 'on' : '', role: 'radio', 'aria-checked': String(theme === t), onclick: () => api.setPreferences({ theme: t }) }, t === 'system' ? 'Match Windows' : t === 'light' ? 'Light' : 'Dark'),
        ),
      ),
    );
  }

  function browserIcon(b: DetectedBrowser) {
    const appName = APP_NAMES[b.name] ?? b.name;
    if (!appIcons.has(appName)) {
      appIcons.set(appName, undefined);
      api.appIcon(appName).then((url) => {
        appIcons.set(appName, url);
        if (step === 'import') draw();
      });
    }
    const url = appIcons.get(appName);
    return url ? h('img', { class: 'tour-app-icon', src: url, alt: '' }) : h('span', { class: 'tour-app-icon letter' }, b.name[0]);
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
      ? h('div', { class: 'tour-note' }, h('span', { class: 'tour-spinner' }), 'Looking for your browsers…')
      : !browsers.length
        ? h('div', { class: 'tour-note' }, 'No other browsers found on this computer. You can import later from Settings.')
        : h(
            'div',
            { class: 'tour-rows' },
            ...browsers.map((b) => {
              const done = imported.get(b.id);
              const busy = importing.has(b.id);
              return h(
                'div',
                { class: `tour-row${done ? ' done' : ''}` },
                browserIcon(b),
                h('span', { class: 'tour-row-text' }, h('strong', {}, b.name), h('small', {}, done ?? browserDetail(b))),
                done && !refused.has(b.id)
                  ? h('span', { class: 'tour-done', role: 'img', 'aria-label': 'Imported' }, icon('check'))
                  : h('button', { class: 'tour-ghost', disabled: busy, 'aria-label': `Import from ${b.name}`, onclick: () => runImport(b) }, busy ? 'Importing…' : refused.has(b.id) ? 'Try again' : 'Import'),
              );
            }),
          );
    return h(
      'div',
      { class: 'tour-step' },
      heading('Move in', 'Bring your stuff over', 'Bookmarks become pinned tabs. Passwords stay where they are.'),
      list,
    );
  }

  function tryStep() {
    const current = CHALLENGES.find((c) => !tried.has(c.id));
    return h(
      'div',
      { class: 'tour-step' },
      heading('Shortcuts', 'Try them for real', 'Press the keys and watch the preview. Change any shortcut in Settings.'),
      h(
        'div',
        { class: 'tour-rows' },
        ...CHALLENGES.map((c) => {
          const done = tried.has(c.id);
          return h(
            'button',
            { class: `tour-row tour-challenge${done ? ' done' : ''}${c === current ? ' current' : ''}`, onclick: () => tourKey(c.id) },
            h('kbd', { class: 'tour-key' }, keys(c.id) || '—'),
            h('span', { class: 'tour-row-text' }, h('strong', {}, c.label), h('small', {}, done ? c.done : c === current ? 'Press the keys now' : 'Next up')),
            done ? h('span', { class: 'tour-done', role: 'img', 'aria-label': 'Done' }, icon('check')) : null,
          );
        }),
      ),
    );
  }

  function toggleRow(name: IconName, title: string, text: string, on: boolean, change: (on: boolean) => void) {
    const input = h('input', { type: 'checkbox', class: 'switch' }) as HTMLInputElement;
    input.checked = on;
    input.onchange = () => change(input.checked);
    return h('label', { class: `tour-row${on ? ' on' : ''}` }, h('span', { class: 'tour-row-icon' }, icon(name)), h('span', { class: 'tour-row-text' }, h('strong', {}, title), h('small', {}, text)), input);
  }

  function doneStep() {
    const d = state?.defaultBrowser;
    return h(
      'div',
      { class: 'tour-step' },
      heading('Last thing', d?.isDefault ? 'You’re all set' : 'Make Perseu your default?', d?.isDefault ? 'Links from Discord, Outlook and your terminal open in Perseu.' : 'Then links from Discord, Outlook and your terminal open here instead of in another browser.'),
      d?.isDefault
        ? h('div', { class: 'tour-note ok' }, h('span', { class: 'tour-done' }, icon('check')), 'Perseu is your default browser')
        : d?.canSet
          ? h('button', { class: 'tour-ghost big', onclick: () => api.makeDefaultBrowser() }, icon('link'), 'Make Perseu the default browser')
          : null,
    );
  }

  function primaryLabel() {
    if (step === 'done') return 'Start browsing';
    const skip = (step === 'goal' && !preset) || (step === 'import' && !imported.size) || (step === 'try' && tried.size < CHALLENGES.length);
    // Name where the button goes, not just "Continue".
    return `${skip ? 'Skip to' : 'Next:'} ${STEP_NAMES[STEPS[STEPS.indexOf(step) + 1]].toLowerCase()}`;
  }

  // ---- the preview card ---------------------------------------------------------

  let typingTimer: number | undefined;
  /** Plays what a shortcut does in the card. */
  function play(command: string) {
    if (command === 'newTab' || command === 'openLocation') {
      card.classList.add('palette');
      const text = 'github.com/flecha';
      let i = 0;
      clearInterval(typingTimer);
      typingTimer = window.setInterval(() => {
        const typed = card.querySelector('.pv-typed');
        if (typed) typed.textContent = text.slice(0, ++i);
        else i = text.length;
        if (i >= text.length) {
          clearInterval(typingTimer);
          setTimeout(() => card.classList.remove('palette'), 900);
        }
      }, 55);
    } else if (command === 'toggleSidebar') {
      card.classList.toggle('no-sidebar');
    } else if (command === 'splitNew') {
      card.classList.add('split');
    }
  }

  function note(glyph: IconName | { emoji: string }, title: string, text: string) {
    return h(
      'div',
      { class: 'pv-note' },
      h('p', { class: 'pv-note-title' }, h('span', { class: 'pv-note-icon' }, typeof glyph === 'string' ? icon(glyph) : glyph.emoji), h('span', { class: 'pv-clip' }, title)),
      h('p', { class: 'pv-note-text' }, text),
    );
  }

  function notes() {
    const sp = space();
    const commandKeys = keys('newTab') || 'Ctrl+T';
    switch (step) {
      case 'goal':
        return preset
          ? [note({ emoji: preset.emoji }, `${preset.name} Space`, 'Its own tabs, pins and colour.')]
          : [note('space', 'One Space to start', 'Pick what it’s for on the left.')];
      case 'space':
        return [
          note(sp?.emoji ? { emoji: sp.emoji } : 'space', sp?.name || 'Your Space', 'Its colour tints the sidebar.'),
          note('palette', state?.theme === 'dark' ? 'Dark theme' : state?.theme === 'light' ? 'Light theme' : 'Matches Windows', 'Light or dark, as you chose.'),
        ];
      case 'import': {
        const done = [...imported.entries()].map(([id, summary]) => note('import', browsers?.find((b) => b.id === id)?.name ?? 'Imported', summary));
        return done.length ? done.slice(0, 2) : [note('import', 'Nothing imported yet', 'You can also import later from Settings.')];
      }
      case 'try': {
        const done = CHALLENGES.filter((c) => tried.has(c.id)).map((c) => note('keyboard', c.label, c.done));
        return done.length ? done.slice(-2) : [note('keyboard', `Press ${commandKeys}`, 'The preview reacts to the real keys.')];
      }
      case 'done':
        return [
          state?.defaultBrowser.isDefault ? note('link', 'Default browser', 'Links from other apps open here.') : note('link', 'Links from other apps', 'Still open in your old browser.'),
          note('search', `${commandKeys} for anything`, 'Tabs, history and actions in one box.'),
        ];
    }
  }

  function drawCard() {
    const sp = space();
    const tabs = preset?.tabs ?? ['New Tab', 'Search results', 'Saved for later'];
    const importedFrom = [...imported.keys()].map((id) => browsers?.find((b) => b.id === id)?.name).find(Boolean);
    card.replaceChildren(
      h('p', { class: 'pv-label' }, 'Your sidebar'),
      h(
        'div',
        { class: 'pv-grid' },
        h(
          'div',
          { class: 'pv-side' },
          h('p', { class: 'pv-space' }, h('span', { class: 'pv-emoji' }, sp?.emoji || '•'), h('span', { class: 'pv-clip' }, sp?.name || 'Space')),
          importedFrom ? h('p', { class: 'pv-tab' }, h('span', { class: 'pv-folder' }, icon('folder')), h('span', { class: 'pv-clip' }, 'Bookmarks')) : null,
          ...tabs.map((title, i) => h('p', { class: `pv-tab${i === 0 ? ' on' : ''}` }, h('i', { style: `background:${TAB_HUES[i % TAB_HUES.length]}` }), h('span', { class: 'pv-clip' }, title))),
        ),
        h('div', { class: 'pv-notes' }, ...notes()),
      ),
      h('div', { class: 'pv-palette' }, icon('search'), h('span', { class: 'pv-typed' }), h('i', { class: 'pv-caret' })),
    );
  }

  // ---- draw ----------------------------------------------------------------------

  function draw() {
    const body = { goal: goalStep, space: spaceStep, import: importStep, try: tryStep, done: doneStep }[step]();
    const changed = shownStep !== step;
    body.classList.toggle('enter', changed);
    shownStep = step;
    const index = STEPS.indexOf(step);
    const focused = document.activeElement as HTMLElement | null;
    const keepCaret = focused?.classList.contains('tour-input') ? (focused as HTMLInputElement).selectionStart : null;
    if (!root.firstChild) {
      left.append(
        h(
          'div',
          { class: 'tour-top' },
          h('div', { class: 'tour-progress-wrap' }, progressLabel, h('div', { class: 'tour-progress' }, progress)),
          h('button', { class: 'tour-skip', onclick: finish }, 'Skip tour'),
        ),
        stepBody,
        footer,
        live,
      );
      root.append(h('div', { class: 'tour', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to Perseu' }, left, h('section', { class: 'tour-stage' }, art, h('div', { class: 'tour-tint' }), card)));
    }
    progressLabel.textContent = `${index + 1} of ${STEPS.length} · ${STEP_NAMES[step]}`;
    progress.style.width = `${((index + 1) / STEPS.length) * 100}%`;
    root.querySelector<HTMLElement>('.tour-skip')!.hidden = step === 'done';
    root.style.setProperty('--tour-tint', spaceTint(space()?.color ?? COLORS[0], false));
    stepBody.replaceChildren(body);
    footer.replaceChildren(
      index ? h('button', { class: 'tour-back', onclick: back }, icon('arrowLeft'), 'Back') : h('span'),
      h('button', { class: 'tour-primary', onclick: step === 'done' ? finish : next }, primaryLabel()),
    );
    drawCard();
    if (changed) live.textContent = `Step ${index + 1} of ${STEPS.length}: ${body.querySelector('h1')?.textContent ?? ''}`;
    // Redrawing replaces the name field; keep typing where you were.
    if (keepCaret !== null) {
      const input = root.querySelector<HTMLInputElement>('.tour-input');
      input?.focus();
      input?.setSelectionRange(keepCaret, keepCaret);
    }
  }

  function tourKey(command: string) {
    if (root.hidden) return;
    play(command);
    const challenge = CHALLENGES.find((c) => c.id === command);
    if (step === 'try' && challenge) {
      tried.add(command);
      draw();
    }
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
      step = 'goal';
      tried.clear();
    }
    root.hidden = !show;
    if (!show) return;
    // Only what the steps show; other updates (pages loading) would restart the animations.
    const sp = s.spaces.find((x) => x.id === s.activeSpaceId);
    const key = JSON.stringify([s.theme, sp?.emoji, sp?.color, sp?.name, s.adBlock, s.defaultBrowser, s.shortcuts]);
    if (key !== drawn || !root.firstChild) draw();
    drawn = key;
  };
}
