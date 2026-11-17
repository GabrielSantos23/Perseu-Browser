/**
 * The Space theme picker, as in Zen's workspaces (zen-browser/desktop, MPL-2.0): a hue/lightness
 * wheel of up to three dots with colour harmonies, pages of preset colours, a custom colour list,
 * the opacity wave and the grain knob. Ported to Flecha's Space editor.
 */
import type { Space, SpaceTheme, ThemeColor } from '../../shared/types';
import {
  COLOR_HARMONIES,
  DEFAULT_TEXTURE,
  DEFAULT_TEXTURE_STRENGTH,
  EXPLICIT_BLACKWHITE_TYPE,
  EXPLICIT_LIGHTNESS_TYPE,
  MAX_DOTS,
  MAX_OPACITY,
  MIN_OPACITY,
  TEXTURES,
  calculateInitialPosition,
  colorFromPosition,
  parseColor,
  themeColorCss,
  themeFromColors,
  type Harmony,
  type Rgb,
} from '../lib/zenTheme.js';

const $ = <T extends HTMLElement = HTMLElement>(tag: string, cls?: string) => {
  const el = document.createElement(tag) as T;
  if (cls) el.className = cls;
  return el;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const icon = (inner: string, viewBox = '0 0 18 18') => {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.innerHTML = inner;
  return el;
};

const ICONS = {
  auto: '<path d="M3.025 5.623a.501.501 0 0 0 .95 0l.421-1.263 1.263-.421a.5.5 0 0 0 0-.948L4.396 2.57l-.421-1.263c-.137-.408-.812-.408-.949 0L2.605 2.57l-1.263.421a.5.5 0 0 0 0 .948l1.263.421zm13.5 3.18L11.99 7.01l-1.793-4.535c-.227-.572-1.168-.572-1.395 0L7.009 7.01 2.474 8.803a.75.75 0 0 0 0 1.394l4.535 1.793 1.793 4.535a.75.75 0 0 0 1.394 0l1.793-4.535 4.535-1.793a.751.751 0 0 0 .001-1.394"/>',
  light:
    '<path d="M 256,118 A 22,22 0 0 1 234,96 V 48 a 22,22 0 0 1 44,0 v 48 a 22,22 0 0 1 -22,22 z m 0,368 a 22,22 0 0 1 -22,-22 v -48 a 22,22 0 0 1 44,0 v 48 a 22,22 0 0 1 -22,22 z M 369.14,164.86 a 22,22 0 0 1 -15.56,-37.55 l 33.94,-33.94 a 22,22 0 0 1 31.11,31.11 l -33.94,33.94 a 21.93,21.93 0 0 1 -15.55,6.44 z M 108.92,425.08 A 22,22 0 0 1 93.37,387.52 l 33.94,-33.94 a 22,22 0 1 1 31.11,31.11 l -33.94,33.94 a 21.94,21.94 0 0 1 -15.56,6.45 z M 464,278 h -48 a 22,22 0 0 1 0,-44 h 48 a 22,22 0 0 1 0,44 z M 96,278 H 48 a 22,22 0 0 1 0,-44 h 48 a 22,22 0 0 1 0,44 z m 307.08,147.08 a 21.94,21.94 0 0 1 -15.56,-6.45 l -33.94,-33.94 a 22,22 0 0 1 31.11,-31.11 l 33.94,33.94 a 22,22 0 0 1 -15.55,37.56 z M 142.86,164.86 a 21.89,21.89 0 0 1 -15.55,-6.44 L 93.37,124.48 a 22,22 0 0 1 31.11,-31.11 l 33.94,33.94 a 22,22 0 0 1 -15.56,37.55 z M 256,358 A 102,102 0 1 1 358,256 102.12,102.12 0 0 1 256,358 Z"/>',
  dark: '<path d="M16.705 10.223a.75.75 0 0 0-.838-.037A5.5 5.5 0 0 1 13 11a5.506 5.506 0 0 1-5.5-5.5c0-1.146.354-2.247 1.023-3.186a.75.75 0 0 0-.749-1.173A8 8 0 0 0 1.25 9c0 4.411 3.589 8 8 8a7.995 7.995 0 0 0 7.735-5.986.75.75 0 0 0-.28-.79"/>',
  add: '<path d="M9 2.5a.75.75 0 0 1 .75.75v5h5a.75.75 0 0 1 0 1.5h-5v5a.75.75 0 0 1-1.5 0v-5h-5a.75.75 0 0 1 0-1.5h5v-5A.75.75 0 0 1 9 2.5"/>',
  remove: '<path d="M14.75 8.25a.75.75 0 0 1 0 1.5H3.25a.75.75 0 0 1 0-1.5z"/>',
  algorithm:
    '<path d="M4.75 10a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8.5-1.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M9 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6m0 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3"/>',
  close: '<path d="M4.28 3.22a.75.75 0 0 0-1.06 1.06L7.94 9l-4.72 4.72a.75.75 0 1 0 1.06 1.06L9 10.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L10.06 9l4.72-4.72a.75.75 0 0 0-1.06-1.06L9 7.94z"/>',
  chevron: '<path d="M10.28 3.47a.75.75 0 0 0-1.06 0L4.47 8.22a1.1 1.1 0 0 0 0 1.56l4.75 4.75a.75.75 0 1 0 1.06-1.06L5.81 9 10.28 4.53a.75.75 0 0 0 0-1.06" transform="rotate(180 9 9)"/>',
};

interface Preset {
  style: string;
  position: [number, number];
  numDots: number;
  algo: Harmony;
  lightness?: number;
  type?: string;
}

/** Zen's seven pages of preset swatches (theme-picker.inc), positions as fractions of its 364px panel. */
const PRESET_PAGES: Preset[][] = [
  [
    { style: '--swatch: rgb(242, 234, 228)', position: [0.9066, 0.6813], numDots: 1, algo: 'floating', lightness: 95 },
    { style: '--swatch: rgb(242, 155, 187)', position: [0.7747, 0.3489], numDots: 1, algo: 'floating', lightness: 95 },
    { style: '--swatch: rgb(166, 114, 157)', position: [0.7005, 0.206], numDots: 1, algo: 'floating', lightness: 65 },
    { style: '--swatch: rgb(242, 94, 107)', position: [0.6703, 0.4533], numDots: 1, algo: 'floating', lightness: 95 },
    { style: '--swatch: rgb(255, 133, 88)', position: [0.6429, 0.522], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(248, 213, 88)', position: [0.5962, 0.6044], numDots: 1, algo: 'floating', lightness: 97 },
    { style: '--swatch: rgb(52, 232, 149)', position: [0.3709, 0.5247], numDots: 1, algo: 'floating', lightness: 91 },
    { style: '--swatch: rgb(108, 186, 217)', position: [0.2308, 0.3984], numDots: 1, algo: 'floating', lightness: 85 },
    { style: '--swatch: rgb(102, 103, 137)', position: [0.272, 0.1484], numDots: 1, algo: 'floating', lightness: 54 },
  ],
  [
    { style: '--c1: rgb(242, 234, 228); --c2: rgb(238, 242, 228); --c3: rgb(242, 228, 234)', position: [0.9066, 0.6813], numDots: 3, algo: 'analogous', lightness: 95 },
    { style: '--c1: rgb(242, 155, 187); --c2: rgb(242, 196, 155); --c3: rgb(224, 155, 242)', position: [0.7747, 0.3489], numDots: 3, algo: 'analogous', lightness: 95 },
    { style: '--c1: rgb(166, 114, 157); --c2: rgb(166, 114, 114); --c3: rgb(132, 114, 166)', position: [0.7005, 0.206], numDots: 3, algo: 'analogous', lightness: 65 },
    { style: '--c1: rgb(242, 94, 107); --c2: rgb(242, 204, 94); --c3: rgb(242, 94, 230)', position: [0.6703, 0.4533], numDots: 3, algo: 'analogous', lightness: 95 },
    { style: '--c1: rgb(255, 133, 88); --c2: rgb(238, 255, 88); --c3: rgb(255, 88, 182)', position: [0.6429, 0.522], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(248, 213, 88); --c2: rgb(150, 248, 88); --c3: rgb(248, 88, 96)', position: [0.5962, 0.6044], numDots: 3, algo: 'analogous', lightness: 97 },
    { style: '--c1: rgb(52, 232, 149); --c2: rgb(52, 165, 232); --c3: rgb(105, 232, 52)', position: [0.3709, 0.5247], numDots: 3, algo: 'analogous', lightness: 91 },
    { style: '--c1: rgb(108, 186, 217); --c2: rgb(121, 108, 217); --c3: rgb(108, 217, 157)', position: [0.2308, 0.3984], numDots: 3, algo: 'analogous', lightness: 85 },
    { style: '--c1: rgb(102, 103, 137); --c2: rgb(130, 102, 137); --c3: rgb(102, 132, 137)', position: [0.272, 0.1484], numDots: 3, algo: 'analogous', lightness: 54 },
  ],
  [
    { style: '--swatch: rgb(254, 251, 250)', position: [0.9588, 0.6016], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(255, 233, 243)', position: [0.8874, 0.2582], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(241, 209, 236)', position: [0.7527, 0.1291], numDots: 1, algo: 'floating', lightness: 95 },
    { style: '--swatch: rgb(255, 203, 209)', position: [0.8764, 0.4231], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(255, 224, 211)', position: [0.8764, 0.6016], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(255, 249, 229)', position: [0.7912, 0.8022], numDots: 1, algo: 'floating', lightness: 100 },
    { style: '--swatch: rgb(222, 253, 235)', position: [0.1044, 0.728], numDots: 1, algo: 'floating', lightness: 99 },
    { style: '--swatch: rgb(220, 243, 252)', position: [0.0467, 0.3434], numDots: 1, algo: 'floating', lightness: 99 },
    { style: '--swatch: rgb(197, 198, 229)', position: [0.2418, 0.0989], numDots: 1, algo: 'floating', lightness: 90 },
  ],
  [
    { style: '--c1: rgb(254, 251, 250); --c2: rgb(254, 254, 250); --c3: rgb(254, 250, 252)', position: [0.9588, 0.6016], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(255, 233, 243); --c2: rgb(255, 241, 233); --c3: rgb(249, 233, 255)', position: [0.8874, 0.2582], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(241, 209, 236); --c2: rgb(241, 209, 209); --c3: rgb(219, 209, 241)', position: [0.7527, 0.1291], numDots: 3, algo: 'analogous', lightness: 95 },
    { style: '--c1: rgb(255, 203, 209); --c2: rgb(255, 240, 203); --c3: rgb(255, 203, 252)', position: [0.8764, 0.4231], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(255, 224, 211); --c2: rgb(249, 255, 211); --c3: rgb(255, 211, 235)', position: [0.8764, 0.6016], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(255, 249, 229); --c2: rgb(239, 255, 229); --c3: rgb(255, 229, 231)', position: [0.7912, 0.8022], numDots: 3, algo: 'analogous', lightness: 100 },
    { style: '--c1: rgb(222, 253, 235); --c2: rgb(222, 245, 253); --c3: rgb(235, 253, 222)', position: [0.1044, 0.728], numDots: 3, algo: 'analogous', lightness: 99 },
    { style: '--c1: rgb(220, 243, 252); --c2: rgb(224, 220, 252); --c3: rgb(220, 252, 234)', position: [0.0467, 0.3434], numDots: 3, algo: 'analogous', lightness: 99 },
    { style: '--c1: rgb(197, 198, 229); --c2: rgb(223, 197, 229); --c3: rgb(197, 225, 229)', position: [0.2418, 0.0989], numDots: 3, algo: 'analogous', lightness: 90 },
  ],
  [
    { style: '--swatch: rgb(78, 58, 90)', position: [0.5165, 0.1456], numDots: 1, algo: 'floating', lightness: 35 },
    { style: '--swatch: rgb(105, 53, 88)', position: [0.6703, 0.3049], numDots: 1, algo: 'floating', lightness: 41 },
    { style: '--swatch: rgb(143, 64, 66)', position: [0.7005, 0.467], numDots: 1, algo: 'floating', lightness: 56 },
    { style: '--swatch: rgb(177, 109, 64)', position: [0.6401, 0.5467], numDots: 1, algo: 'floating', lightness: 69 },
    { style: '--swatch: rgb(215, 179, 93)', position: [0.6374, 0.6209], numDots: 1, algo: 'floating', lightness: 84 },
    { style: '--swatch: rgb(205, 204, 164)', position: [0.6868, 0.8214], numDots: 1, algo: 'floating', lightness: 80 },
    { style: '--swatch: rgb(122, 169, 130)', position: [0.2335, 0.7555], numDots: 1, algo: 'floating', lightness: 66 },
    { style: '--swatch: rgb(34, 97, 73)', position: [0.3077, 0.5412], numDots: 1, algo: 'floating', lightness: 38 },
    { style: '--swatch: rgb(38, 69, 107)', position: [0.3214, 0.3736], numDots: 1, algo: 'floating', lightness: 42 },
  ],
  [
    { style: '--c1: rgb(78, 58, 90); --c2: rgb(90, 58, 75); --c3: rgb(58, 65, 90)', position: [0.5165, 0.1456], numDots: 3, algo: 'analogous', lightness: 35 },
    { style: '--c1: rgb(105, 53, 88); --c2: rgb(105, 61, 53); --c3: rgb(79, 53, 105)', position: [0.6703, 0.3049], numDots: 3, algo: 'analogous', lightness: 41 },
    { style: '--c1: rgb(143, 64, 66); --c2: rgb(143, 128, 64); --c3: rgb(143, 64, 132)', position: [0.7005, 0.467], numDots: 3, algo: 'analogous', lightness: 56 },
    { style: '--c1: rgb(177, 109, 64); --c2: rgb(151, 177, 64); --c3: rgb(177, 64, 113)', position: [0.6401, 0.5467], numDots: 3, algo: 'analogous', lightness: 69 },
    { style: '--c1: rgb(215, 179, 93); --c2: rgb(149, 215, 93); --c3: rgb(215, 93, 109)', position: [0.6374, 0.6209], numDots: 3, algo: 'analogous', lightness: 84 },
    { style: '--c1: rgb(205, 204, 164); --c2: rgb(172, 205, 164); --c3: rgb(205, 170, 164)', position: [0.6868, 0.8214], numDots: 3, algo: 'analogous', lightness: 80 },
    { style: '--c1: rgb(122, 169, 130); --c2: rgb(122, 169, 169); --c3: rgb(153, 169, 122)', position: [0.2335, 0.7555], numDots: 3, algo: 'analogous', lightness: 66 },
    { style: '--c1: rgb(34, 97, 73); --c2: rgb(34, 68, 97); --c3: rgb(47, 97, 34)', position: [0.3077, 0.5412], numDots: 3, algo: 'analogous', lightness: 38 },
    { style: '--c1: rgb(38, 69, 107); --c2: rgb(64, 38, 107); --c3: rgb(38, 107, 87)', position: [0.3214, 0.3736], numDots: 3, algo: 'analogous', lightness: 42 },
  ],
  [
    { style: '--swatch: rgb(224, 224, 224)', position: [0.9341, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(224, 224, 224)', position: [0.9272, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(192, 192, 192)', position: [0.8654, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(160, 160, 160)', position: [0.8036, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(128, 128, 128)', position: [0.7418, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(96, 96, 96)', position: [0.6799, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(64, 64, 64)', position: [0.6181, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(32, 32, 32)', position: [0.5563, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
    { style: '--swatch: rgb(0, 0, 0)', position: [0.4945, 0.4945], numDots: 1, algo: 'floating', type: EXPLICIT_BLACKWHITE_TYPE },
  ],
];

/** The exact colour a preset swatch stands for: its first swatch var. */
const presetColor = (preset: Preset): Rgb => {
  const match = /--(?:swatch|c1):\s*rgb\(([^)]+)\)/.exec(preset.style);
  if (!match) return [128, 128, 128];
  return match[1].split(',').map((v) => parseFloat(v.trim())) as Rgb;
};

interface Dot {
  id: number;
  el: HTMLElement;
  position: { x: number; y: number };
  type: string;
  lightness: number;
  rgb: Rgb;
}

interface PickerOptions {
  onChange(theme: SpaceTheme): void;
  onScheme(scheme: 'auto' | 'light' | 'dark'): void;
}

const WAVE_LINE = 'M 51.373 27.395 L 367.037 27.395';
const WAVE_SINE =
  'M 51.373 27.395 C 60.14 -8.503 68.906 -8.503 77.671 27.395 C 86.438 63.293 95.205 63.293 103.971 27.395 C 112.738 -8.503 121.504 -8.503 130.271 27.395 C 139.037 63.293 147.803 63.293 156.57 27.395 C 165.335 -8.503 174.101 -8.503 182.868 27.395 C 191.634 63.293 200.4 63.293 209.167 27.395 C 217.933 -8.503 226.7 -8.503 235.467 27.395 C 244.233 63.293 252.999 63.293 261.765 27.395 C 270.531 -8.503 279.297 -8.503 288.064 27.395 C 296.83 63.293 305.596 63.293 314.363 27.395 C 323.13 -8.503 331.896 -8.503 340.662 27.395 M 314.438 27.395 C 323.204 -8.503 331.97 -8.503 340.737 27.395 C 349.503 63.293 358.27 63.293 367.037 27.395';

const wavePoints = (() => {
  const points: Array<{ type: 'M' | 'C' | 'L'; x: number; y: number; x1?: number; y1?: number; x2?: number; y2?: number }> = [];
  for (const match of WAVE_SINE.match(/[MCL]\s*[\d\s.\-,]+/g) ?? []) {
    const type = match.charAt(0) as 'M' | 'C' | 'L';
    const coords = match.slice(1).trim().split(/[\s,]+/).map(Number);
    if (type === 'M' || type === 'L') points.push({ type, x: coords[0], y: coords[1] });
    else {
      for (let i = 0; i + 5 < coords.length; i += 6) {
        points.push({ type, x1: coords[i], y1: coords[i + 1], x2: coords[i + 2], y2: coords[i + 3], x: coords[i + 4], y: coords[i + 5] });
      }
    }
  }
  return points;
})();

const wavePath = (progress: number) => {
  if (!wavePoints.length) return progress < 0.5 ? WAVE_LINE : WAVE_SINE;
  if (progress <= 0.001) return WAVE_LINE;
  if (progress >= 0.999) return WAVE_SINE;
  const referenceY = 27.3;
  let out = '';
  for (const p of wavePoints) {
    if (p.type === 'M') out += `M ${p.x} ${referenceY + (p.y - referenceY) * progress} `;
    else if (p.type === 'C')
      out += `C ${p.x1} ${referenceY + (p.y1! - referenceY) * progress} ${p.x2} ${referenceY + (p.y2! - referenceY) * progress} ${p.x} ${referenceY + (p.y - referenceY) * progress} `;
    else out += `L ${p.x} ${p.y} `;
  }
  return out.trim();
};

/** Saves at most one change every `ms`, and the last one on flush. */
function throttled<T>(send: (value: T) => void, ms = 120) {
  let last = 0;
  let timer = 0;
  let pending: { value: T } | undefined;
  const fire = () => {
    timer = 0;
    if (!pending) return;
    const { value } = pending;
    pending = undefined;
    last = performance.now();
    send(value);
  };
  return {
    push(value: T) {
      pending = { value };
      timer ||= window.setTimeout(fire, Math.max(0, last + ms - performance.now()));
    },
    flush() {
      clearTimeout(timer);
      fire();
    },
  };
}

export class ThemePicker {
  private readonly options: PickerOptions;
  private readonly gradient: HTMLElement;
  private readonly dotsLayer: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly opacity: HTMLInputElement;
  private readonly opacityWave: SVGPathElement;
  private waveStops: SVGStopElement[] = [];
  private readonly texture: HTMLElement;
  private readonly textureFace: HTMLElement;
  private readonly textureHandler: HTMLElement;
  private readonly customInput: HTMLInputElement;
  private readonly customOpacity: HTMLInputElement;
  private readonly customList: HTMLElement;
  private schemeButtons: Record<'auto' | 'light' | 'dark', HTMLButtonElement>;

  private dots: Dot[] = [];
  private customColors: string[] = [];
  private theme: SpaceTheme | undefined;
  private signature = '';
  /** Themes this picker produced, newest last. Their echoes must never overwrite a newer drag. */
  private readonly emitted = new Set<string>();
  private useAlgo: Harmony = 'floating';
  private currentLightness = 50;
  private currentOpacity = 0.5;
  private currentTexture = 0;
  private currentTextureType = DEFAULT_TEXTURE;
  private colorPage = 0;
  private dragging = false;
  private draggedDot: Dot | undefined;
  private recentlyDragged = false;
  private textureMoved = false;
  private readonly save = throttled<SpaceTheme>((theme) => this.options.onChange(theme));

  constructor(
    mount: HTMLElement,
    options: PickerOptions,
  ) {
    this.options = options;
    mount.classList.add('zen-theme-picker');
    mount.replaceChildren();

    // The wheel: a dotted panel, with the scheme, the actions and the dots on it.
    this.gradient = $('div', 'zen-theme-picker-gradient');
    this.dotsLayer = $('div', 'zen-theme-picker-dots');
    this.hint = $('span', 'zen-theme-picker-hint');
    this.hint.textContent = 'Click to add a color';
    this.actions = $('div', 'zen-theme-picker-actions');

    const schemes = $('div', 'zen-theme-picker-scheme');
    this.schemeButtons = {
      auto: this.iconButton('auto', 'Automatic', () => options.onScheme('auto')),
      light: this.iconButton('light', 'Light', () => options.onScheme('light')),
      dark: this.iconButton('dark', 'Dark', () => options.onScheme('dark')),
    };
    schemes.append(this.schemeButtons.auto, this.schemeButtons.light, this.schemeButtons.dark);

    this.actions.append(
      this.iconButton('add', 'Add a colour', () => this.addDot()),
      this.iconButton('remove', 'Remove the last colour', () => this.removeLastDot()),
      this.iconButton('algorithm', 'Change the colour harmony', () => this.toggleAlgorithm()),
    );
    this.gradient.append(schemes, this.hint, this.dotsLayer, this.actions);

    // Preset pages, paged left and right.
    const pagesWrap = $('div', 'zen-theme-picker-pages-wrap');
    this.prev = $<HTMLButtonElement>('button', 'zen-theme-picker-page zen-theme-picker-page-prev');
    this.prev.append(icon(ICONS.chevron));
    this.next = $<HTMLButtonElement>('button', 'zen-theme-picker-page zen-theme-picker-page-next');
    this.next.append(icon(ICONS.chevron));
    this.pages = $('div', 'zen-theme-picker-pages');
    for (const page of PRESET_PAGES) {
      const row = $('div', 'zen-theme-picker-page-row');
      for (const preset of page) {
        const swatch = $<HTMLButtonElement>('button', 'zen-theme-picker-preset');
        const parts = preset.style.split(';');
        for (const part of parts) {
          const [name, value] = part.split(':');
          if (!name || !value) continue;
          swatch.style.setProperty(name.trim(), value.trim());
        }
        if (preset.numDots === 1) swatch.classList.add('single');
        swatch.dataset.preset = '';
        swatch.setAttribute('aria-label', 'Use this colour');
        swatch.addEventListener('click', () => this.applyPreset(preset));
        row.append(swatch);
      }
      this.pages.append(row);
    }
    this.prev.disabled = true;
    this.prev.addEventListener('click', () => this.turnPage(-1));
    this.next.addEventListener('click', () => this.turnPage(1));
    this.pages.addEventListener('wheel', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    pagesWrap.append(this.prev, this.pages, this.next);

    // The opacity wave and the grain knob.
    const controls = $('div', 'zen-theme-picker-controls');
    const opacityWrap = $('div', 'zen-theme-picker-opacity');
    const wave = document.createElementNS(SVG_NS, 'svg');
    wave.setAttribute('viewBox', '0 -7.605 455 70');
    wave.setAttribute('preserveAspectRatio', 'xMinYMid meet');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke', 'url(#zen-theme-picker-wave)');
    path.setAttribute('stroke-width', '8');
    path.setAttribute('d', WAVE_LINE);
    const defs = document.createElementNS(SVG_NS, 'defs');
    const grad = document.createElementNS(SVG_NS, 'linearGradient');
    grad.id = 'zen-theme-picker-wave';
    grad.setAttribute('x1', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%');
    grad.setAttribute('y2', '0%');
    for (const color of [
      'light-dark(rgb(90, 90, 90), rgb(161, 161, 161))',
      'light-dark(rgb(90, 90, 90), rgb(161, 161, 161))',
      'light-dark(rgba(77, 77, 77, 0.5), rgba(161, 161, 161, 0.5))',
    ]) {
      const stop = document.createElementNS(SVG_NS, 'stop');
      stop.setAttribute('stop-color', color);
      grad.append(stop);
      this.waveStops.push(stop);
    }
    defs.append(grad);
    wave.append(path, defs);
    this.opacityWave = path;
    this.opacity = $<HTMLInputElement>('input', 'zen-theme-picker-range');
    this.opacity.type = 'range';
    this.opacity.min = String(MIN_OPACITY);
    this.opacity.max = String(MAX_OPACITY);
    this.opacity.step = '0.001';
    this.opacity.value = String(this.currentOpacity);
    this.opacity.setAttribute('aria-label', 'Theme intensity');
    this.opacity.addEventListener('input', () => {
      this.currentOpacity = parseFloat(this.opacity.value);
      this.drawWave();
      this.emit();
    });
    opacityWrap.append(wave, this.opacity);

    this.texture = $('div', 'zen-theme-picker-texture');
    this.texture.setAttribute('role', 'slider');
    this.texture.setAttribute('aria-label', 'Grain');
    this.texture.tabIndex = 0;
    for (let i = 0; i < 16; i++) {
      const dot = $('span', 'zen-theme-picker-texture-dot');
      const position = (i / 16) * Math.PI * 2 + 36;
      dot.style.left = `${Math.cos(position) * 50 + 50}%`;
      dot.style.top = `${Math.sin(position) * 50 + 50}%`;
      this.texture.append(dot);
    }
    this.textureFace = $('div', 'zen-theme-picker-texture-face');
    this.textureHandler = $('div', 'zen-theme-picker-texture-handler');
    this.texture.append(this.textureFace, this.textureHandler);
    this.texture.addEventListener('click', (event) => {
      if (event.target === this.textureHandler || this.textureMoved) {
        this.textureMoved = false;
        return;
      }
      this.cycleTexture(1);
    });
    this.texture.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.cycleTexture(Math.sign(event.deltaY) || 1);
      },
      { passive: false },
    );
    this.texture.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') this.cycleTexture(1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') this.cycleTexture(-1);
    });
    this.textureHandler.addEventListener('pointerdown', (event) => this.startTextureDrag(event));
    controls.append(opacityWrap, this.texture);
    this.updateTexture();

    // A custom colour, with its own opacity, and the colours added so far.
    const custom = $('div', 'zen-theme-picker-custom');
    const label = $('label', 'zen-theme-picker-custom-label');
    label.textContent = 'Custom colour';
    const row = $('div', 'zen-theme-picker-custom-row');
    this.customInput = $<HTMLInputElement>('input', 'zen-theme-picker-color-input');
    this.customInput.type = 'color';
    this.customInput.value = '#cdd9f7';
    this.customOpacity = $<HTMLInputElement>('input', 'zen-theme-picker-opacity-input');
    this.customOpacity.type = 'number';
    this.customOpacity.min = '0';
    this.customOpacity.max = '1';
    this.customOpacity.step = '0.01';
    this.customOpacity.value = '1';
    this.customOpacity.setAttribute('aria-label', 'Custom colour opacity');
    const addCustom = $<HTMLButtonElement>('button', 'zen-theme-picker-custom-add');
    addCustom.append(icon(ICONS.add));
    addCustom.setAttribute('aria-label', 'Add the custom colour');
    addCustom.addEventListener('click', () => this.addCustomColor());
    row.append(this.customInput, this.customOpacity, addCustom);
    this.customList = $('div', 'zen-theme-picker-custom-list');
    custom.append(label, row, this.customList);

    mount.append(this.gradient, pagesWrap, controls, custom);

    this.gradient.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.gradient.addEventListener('click', (event) => this.onClick(event));
    this.gradient.addEventListener('contextmenu', (event) => {
      const dot = this.dotFromTarget(event.target);
      if (!dot) return;
      event.preventDefault();
      this.removeDot(dot);
    });
  }

  private iconButton(name: keyof typeof ICONS, title: string, onclick: () => void) {
    const button = $<HTMLButtonElement>('button', 'zen-theme-picker-button');
    button.append(icon(ICONS[name], name === 'light' ? '0 0 512 512' : '0 0 18 18'));
    button.dataset.tip = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onclick);
    return button;
  }

  // ---- loading and saving -----------------------------------------------------

  /** Shows a Space's theme. Loading the same theme again (after this picker saved it) is a no-op. */
  setSpace(space: Space | undefined, scheme: 'system' | 'light' | 'dark' = 'system') {
    this.setScheme(scheme);
    if (!space) return;
    const theme = space.theme ?? themeFromColors(space.colors?.length ? space.colors : [space.color === 'default' ? '#cdd9f7' : space.color]);
    const signature = JSON.stringify(theme);
    if (signature === this.signature || this.emitted.has(signature)) return;
    // While a dot is under the pointer, the state only holds an older save. Loading it would
    // replace the dot and drop the drag.
    if (this.dragging) return;
    this.signature = signature;
    this.theme = theme;
    this.load(theme);
  }

  /** Marks the picker's theme as saved under this signature, so the echoed state doesn't reload it. */
  private emit() {
    const theme = this.currentTheme();
    this.theme = theme;
    this.signature = JSON.stringify(theme);
    this.emitted.add(this.signature);
    if (this.emitted.size > 128) this.emitted.delete(this.emitted.values().next().value!);
    this.save.push(theme);
  }

  private currentTheme(): SpaceTheme {
    const gradientColors: ThemeColor[] = this.dots.map((dot) => ({
      c: dot.rgb,
      isPrimary: dot.id === 0,
      algorithm: this.useAlgo,
      lightness: dot.lightness,
      position: { x: dot.position.x, y: dot.position.y },
      type: dot.type,
    }));
    for (const color of this.customColors) gradientColors.push({ c: color, isCustom: true });
    return {
      type: 'gradient',
      gradientColors,
      opacity: this.currentOpacity,
      texture: this.currentTexture,
      textureType: this.currentTextureType,
    };
  }

  private load(theme: SpaceTheme) {
    for (const dot of this.dots) dot.el.remove();
    this.dots = [];
    this.customList.replaceChildren();
    this.customColors = [];
    this.currentOpacity = theme.opacity ?? 0.5;
    this.currentTexture = theme.texture ?? 0;
    this.currentTextureType = (theme.textureType as typeof DEFAULT_TEXTURE) ?? DEFAULT_TEXTURE;
    this.currentLightness = theme.gradientColors[0]?.lightness ?? 50;
    this.useAlgo = (theme.gradientColors[0]?.algorithm as Harmony) || 'floating';
    this.opacity.value = String(this.currentOpacity);
    this.drawWave();
    this.updateTexture();
    for (const color of theme.gradientColors) {
      if (color.isCustom) this.addCustomColorRow(typeof color.c === 'string' ? color.c : themeColorCss(color));
    }
    // The primary dot is spawned first, so it owns id 0; the others follow in their stored order.
    const wheel = theme.gradientColors.filter((color) => !color.isCustom);
    for (const color of [...wheel.filter((c) => c.isPrimary), ...wheel.filter((c) => !c.isPrimary)]) {
      const initial = color.position ?? calculateInitialPosition(parseColor(color.c));
      this.spawnDot(
        { x: initial.x, y: initial.y },
        color.type ?? EXPLICIT_LIGHTNESS_TYPE,
        parseColor(color.c),
        Boolean(color.isPrimary),
        color.lightness ?? this.currentLightness,
      );
    }
    this.updateHint();
  }

  private setScheme(scheme: 'system' | 'light' | 'dark') {
    for (const key of ['auto', 'light', 'dark'] as const) {
      this.schemeButtons[key].classList.toggle('selected', (scheme === 'system' && key === 'auto') || scheme === key);
    }
  }

  // ---- the wheel --------------------------------------------------------------

  private panelSize() {
    const rect = this.gradient.getBoundingClientRect();
    return { rect, w: rect.width, h: rect.height };
  }

  private spawnDot(
    position: { x: number; y: number },
    type: string,
    rgb?: Rgb,
    primary = false,
    lightness = this.currentLightness,
  ) {
    const { rect } = this.panelSize();
    const isPrimary = primary || this.dots.length === 0;
    if (isPrimary) {
      const existing = this.dots.find((d) => d.id === 0);
      if (existing) {
        existing.id = this.dots.length;
        existing.el.classList.remove('primary');
        existing.el.dataset.index = String(existing.id);
      }
    }
    const dot: Dot = {
      id: isPrimary ? 0 : this.dots.length,
      el: $('div', 'zen-theme-picker-dot'),
      position: { x: position.x, y: position.y },
      type,
      lightness,
      rgb: rgb ?? this.wheelColor(position, type, rect).rgb,
    };
    dot.el.style.setProperty('--zen-theme-picker-dot-color', themeColorCss({ c: dot.rgb }));
    if (dot.id === 0) dot.el.classList.add('primary');
    dot.el.dataset.index = String(this.dots.length);
    dot.el.dataset.position = JSON.stringify(dot.position);
    dot.el.dataset.type = type;
    this.placeDot(dot);
    this.dotsLayer.append(dot.el);
    this.dots.push(dot);
    this.updateHint();
  }

  private placeDot(dot: Dot) {
    dot.el.style.left = `${dot.position.x * 100}%`;
    dot.el.style.top = `${dot.position.y * 100}%`;
  }

  private dotFromTarget(target: EventTarget | null): Dot | undefined {
    const el = (target as Element | null)?.closest?.('.zen-theme-picker-dot');
    return el ? this.dots.find((d) => d.el === el) : undefined;
  }

  private wheelColor(position: { x: number; y: number }, type: string, rect: DOMRect) {
    return colorFromPosition(position.x * rect.width, position.y * rect.height, rect, type, this.currentLightness);
  }

  private recolorDots() {
    const { rect } = this.panelSize();
    for (const dot of this.dots) {
      const { rgb, lightness } = this.wheelColor(dot.position, dot.type, rect);
      dot.rgb = rgb;
      dot.lightness = lightness;
      dot.el.style.setProperty('--zen-theme-picker-dot-color', themeColorCss({ c: rgb }));
    }
  }

  private updateHint() {
    this.hint.hidden = this.dots.length > 0;
    const add = this.actions.children[0] as HTMLButtonElement;
    const remove = this.actions.children[1] as HTMLButtonElement;
    const algo = this.actions.children[2] as HTMLButtonElement;
    add.disabled = this.dots.length >= MAX_DOTS;
    remove.disabled = this.dots.length === 0;
    algo.disabled = this.dots.length < 2;
  }

  private addDot() {
    if (this.dots.length >= MAX_DOTS) return;
    const positions = this.calculateCompliments('add');
    if (positions.length) {
      this.handleColorPositions(positions);
      this.emit();
    }
  }

  private removeLastDot() {
    const dot = [...this.dots].sort((a, b) => a.id - b.id).pop();
    if (!dot) return;
    dot.el.remove();
    this.dots = this.dots.filter((d) => d !== dot);
    this.normaliseIds();
    this.handleColorPositions(this.calculateCompliments('remove'));
    this.emit();
  }

  private removeDot(dot: Dot) {
    dot.el.remove();
    this.dots = this.dots.filter((d) => d !== dot);
    this.normaliseIds();
    this.handleColorPositions(this.calculateCompliments('remove'));
    this.emit();
  }

  private normaliseIds() {
    this.dots
      .sort((a, b) => a.id - b.id)
      .forEach((dot, index) => {
        dot.id = index;
        dot.el.dataset.index = String(index);
        dot.el.classList.toggle('primary', index === 0);
      });
  }

  private toggleAlgorithm() {
    const applicable = COLOR_HARMONIES.filter((harmony) => harmony.angles.length + 1 === this.dots.length);
    if (!applicable.length) return;
    const index = applicable.findIndex((harmony) => harmony.type === this.useAlgo);
    this.useAlgo = applicable[(index + 1) % applicable.length].type;
    this.handleColorPositions(this.calculateCompliments('update', this.useAlgo));
    this.emit();
  }

  /** Zen's calculateCompliments: place the other dots on their harmony angles from the primary one. */
  private calculateCompliments(action: 'add' | 'remove' | 'update', useHarmony: Harmony = this.useAlgo) {
    if (!this.dots.length) return [];
    const harmonies = COLOR_HARMONIES as unknown as Array<{ type: Harmony; angles: readonly number[] }>;
    const numDots = this.dots.length + (action === 'add' ? 1 : action === 'remove' ? -1 : 0);
    const harmonyFor = () => {
      const selected = harmonies.find((harmony) => harmony.type === useHarmony);
      if (selected) {
        if (action === 'remove') {
          if (this.dots.length) return harmonies.find((h) => h.angles.length === selected.angles.length - 1);
          return harmonies.find((h) => h.type === 'floating');
        }
        if (action === 'add') return harmonies.find((h) => h.angles.length === selected.angles.length + 1);
        if (action === 'update') return selected;
      }
      if (action === 'remove') {
        let harmony = harmonies.find((h) => h.angles.length === numDots);
        if (harmony?.type === 'analogous' && numDots === 1) harmony = harmonies.find((h) => h.type === 'singleAnalogous');
        return harmony;
      }
      if (action === 'add' || action === 'update') return harmonies.find((h) => h.angles.length + 1 === numDots);
      return undefined;
    };
    const harmony = harmonyFor();
    if (!harmony) return this.dots.map((d) => ({ id: d.id, position: d.position, type: d.type }));
    this.useAlgo = harmony.type;

    const primary = this.dots.find((dot) => dot.id === 0);
    if (!primary) return [];
    const center = { x: 0.5, y: 0.5 };
    const angleOf = (position: { x: number; y: number }) => ((Math.atan2(position.y - center.y, position.x - center.x) * 180) / Math.PI + 360) % 360;
    const baseAngle = angleOf(primary.position);
    const distance = Math.min(0.5, Math.hypot(primary.position.x - center.x, primary.position.y - center.y));
    const updated: Array<{ id: number; position: { x: number; y: number }; type: string }> = [
      { id: 0, position: primary.position, type: primary.type },
    ];
    harmony.angles.forEach((offset, index) => {
      const radians = ((baseAngle + offset) % 360) * (Math.PI / 180);
      updated.push({
        id: index + 1,
        position: { x: center.x + distance * Math.cos(radians), y: center.y + distance * Math.sin(radians) },
        type: primary.type,
      });
    });
    return updated;
  }

  private handleColorPositions(positions: Array<{ id: number; position: { x: number; y: number }; type: string }>) {
    for (const entry of positions) {
      const existing = this.dots.find((dot) => dot.id === entry.id);
      if (existing) {
        existing.position = entry.position;
        existing.type = entry.type;
        this.placeDot(existing);
        existing.el.dataset.position = JSON.stringify(entry.position);
        existing.el.dataset.type = entry.type;
      } else {
        this.spawnDot(entry.position, entry.type);
      }
    }
    this.recolorDots();
    this.updateHint();
  }

  // ---- pointer handling -------------------------------------------------------

  private onPointerDown(event: PointerEvent) {
    if (event.button === 2) return;
    const dot = this.dotFromTarget(event.target);
    if (!dot) return;
    event.preventDefault();
    if (dot.id !== 0) this.makePrimary(dot);
    this.dragging = true;
    this.draggedDot = dot;
    dot.el.classList.add('dragging');
    const move = (ev: PointerEvent) => this.dragTo(ev);
    const end = () => {
      this.dragging = false;
      dot.el.classList.remove('dragging');
      this.draggedDot = undefined;
      this.recentlyDragged = true;
      setTimeout(() => (this.recentlyDragged = false), 100);
      this.save.flush();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  private dragTo(event: PointerEvent) {
    if (!this.dragging || !this.draggedDot) return;
    event.preventDefault();
    const { rect } = this.panelSize();
    const padding = 0;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = (rect.width - padding) / 2;
    let x = event.clientX;
    let y = event.clientY;
    const distance = Math.hypot(x - centerX, y - centerY);
    if (distance > radius) {
      const angle = Math.atan2(y - centerY, x - centerX);
      x = centerX + Math.cos(angle) * radius;
      y = centerY + Math.sin(angle) * radius;
    }
    this.draggedDot.position = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
    this.placeDot(this.draggedDot);
    this.handleColorPositions(this.calculateCompliments('update', this.useAlgo));
    this.emit();
  }

  /** Makes a dot the primary one; the harmony re-lays the others around it (Zen's click-on-dot). */
  private makePrimary(dot: Dot) {
    const primary = this.dots.find((d) => d.id === 0);
    if (primary) primary.id = dot.id;
    dot.id = 0;
    for (const d of this.dots) d.el.classList.toggle('primary', d.id === 0);
    this.handleColorPositions(this.calculateCompliments('update', this.useAlgo));
  }

  private onClick(event: MouseEvent) {
    if (this.recentlyDragged) return;
    if ((event.target as Element).closest('.zen-theme-picker-scheme, .zen-theme-picker-actions')) return;
    // A dot was clicked (or dragged): the pointer handler already made it the primary one.
    if (this.dotFromTarget(event.target)) {
      this.emit();
      return;
    }
    const { rect } = this.panelSize();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = (rect.width - 0) / 2;
    let x = event.clientX;
    let y = event.clientY;
    const distance = Math.hypot(x - centerX, y - centerY);
    if (distance > radius) {
      const angle = Math.atan2(y - centerY, x - centerX);
      x = centerX + Math.cos(angle) * radius;
      y = centerY + Math.sin(angle) * radius;
    }
    const position = { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
    const primary = this.dots.find((dot) => dot.id === 0);
    if (!primary) {
      this.spawnDot(position, EXPLICIT_LIGHTNESS_TYPE);
      this.recolorDots();
      this.updateHint();
      this.emit();
      return;
    }
    primary.position = position;
    this.placeDot(primary);
    this.handleColorPositions(this.calculateCompliments('update', this.useAlgo));
    this.emit();
  }

  // ---- presets ----------------------------------------------------------------

  private turnPage(step: number) {
    this.colorPage = Math.max(0, Math.min(PRESET_PAGES.length - 1, this.colorPage + step));
    this.pages.scrollLeft = (this.colorPage * this.pages.scrollWidth) / PRESET_PAGES.length;
    this.prev.disabled = this.colorPage === 0;
    this.next.disabled = this.colorPage === PRESET_PAGES.length - 1;
  }

  private applyPreset(preset: Preset) {
    const color = presetColor(preset);
    while (this.dots.length > preset.numDots) {
      const dot = this.dots.pop();
      dot?.el.remove();
    }
    this.useAlgo = preset.algo;
    if (preset.lightness !== undefined) this.currentLightness = preset.lightness;
    const type = preset.type ?? EXPLICIT_LIGHTNESS_TYPE;
    const primary = this.dots.find((dot) => dot.id === 0);
    const position = { x: preset.position[0], y: preset.position[1] };
    if (primary) {
      primary.position = position;
      primary.type = type;
      primary.lightness = this.currentLightness;
      this.placeDot(primary);
    } else {
      this.spawnDot(position, type, color, true, this.currentLightness);
    }
    this.normaliseIds();
    this.handleColorPositions(this.calculateCompliments('update', preset.algo));
    // The preset's exact swatch wins over the wheel's reading of its position (as in Zen).
    const first = this.dots.find((dot) => dot.id === 0);
    if (first) {
      first.rgb = color;
      first.el.style.setProperty('--zen-theme-picker-dot-color', themeColorCss({ c: color }));
    }
    this.emit();
  }

  // ---- custom colours ---------------------------------------------------------

  private addCustomColor() {
    let color = this.customInput.value;
    if (!color) return;
    const opacity = parseFloat(this.customOpacity.value || '1');
    if (opacity < 1 && /^#[0-9a-f]{6}$/i.test(color)) {
      color += Math.round(opacity * 255).toString(16).padStart(2, '0');
    }
    this.customInput.value = '#cdd9f7';
    this.customOpacity.value = '1';
    this.customColors.push(color);
    this.addCustomColorRow(color);
    this.emit();
  }

  private addCustomColorRow(color: string) {
    const row = $('div', 'zen-theme-picker-custom-item');
    const swatch = $('span', 'zen-theme-picker-dot custom');
    swatch.style.setProperty('--zen-theme-picker-dot-color', color);
    const label = $('span', 'zen-theme-picker-custom-item-label');
    label.textContent = color;
    const remove = $<HTMLButtonElement>('button', 'zen-theme-picker-custom-item-remove');
    remove.append(icon(ICONS.close));
    remove.setAttribute('aria-label', `Remove ${color}`);
    remove.addEventListener('click', () => {
      this.customColors = this.customColors.filter((c) => c !== color);
      row.remove();
      this.emit();
    });
    row.append(swatch, label, remove);
    this.customList.append(row);
  }

  // ---- opacity and grain ------------------------------------------------------

  private drawWave() {
    const range = MAX_OPACITY - MIN_OPACITY;
    // Zen shows the full wave for the default theme, whatever its stored opacity is.
    const intensity = !this.dots.length
      ? 1
      : range
        ? Math.min(1, Math.max(0, (this.currentOpacity - MIN_OPACITY) / range))
        : 1;
    this.opacityWave.setAttribute('d', wavePath(intensity));
    // The wave is painted up to the intensity, then fades out (Zen's three-stop gradient).
    if (this.waveStops.length === 3) {
      this.waveStops[0].setAttribute('offset', '0%');
      this.waveStops[1].setAttribute('offset', `${intensity * 100}%`);
      this.waveStops[2].setAttribute('offset', `${intensity * 100}%`);
    }
    // Zen's thumb grows and narrows with the intensity.
    this.opacity.style.setProperty('--zen-thumb-height', `${40 + intensity * 15}px`);
    this.opacity.style.setProperty('--zen-thumb-width', `${10 + intensity * 15}px`);
  }

  private updateTexture() {
    if (!TEXTURES.includes(this.currentTextureType as (typeof TEXTURES)[number])) this.currentTextureType = DEFAULT_TEXTURE;
    this.texture.dataset.texture = this.currentTextureType;
    const strength = this.currentTexture;
    this.textureFace.style.opacity = String(strength);
    const angle = strength * 360 - 90;
    const width = this.texture.getBoundingClientRect().width || 80;
    const top = Math.sin((angle * Math.PI) / 180) * (width / 2) - 6;
    const left = Math.cos((angle * Math.PI) / 180) * (width / 2) - 3;
    this.textureHandler.style.top = `${width / 2 + top}px`;
    this.textureHandler.style.left = `${width / 2 + left}px`;
    this.textureHandler.style.transform = `rotate(${angle + 90}deg)`;
    this.textureHandler.style.setProperty('--zen-grainy-background-opacity', String(strength));
    const dots = this.texture.querySelectorAll('.zen-theme-picker-texture-dot');
    let i = 4;
    for (const dot of dots) {
      dot.classList.toggle('active', i / 16 <= strength);
      i++;
      if (i === 16) i = 0;
    }
    this.texture.setAttribute('aria-valuenow', String(Math.round(strength * 16)));
    this.texture.classList.toggle('no-texture', this.currentTextureType === 'none');
  }


  private cycleTexture(step: number) {
    const index = TEXTURES.indexOf(this.currentTextureType as (typeof TEXTURES)[number]);
    this.currentTextureType = TEXTURES[(index + step + TEXTURES.length) % TEXTURES.length];
    if (this.currentTextureType === 'none') this.currentTexture = 0;
    else if (!this.currentTexture) this.currentTexture = DEFAULT_TEXTURE_STRENGTH;
    this.updateTexture();
    this.emit();
  }

  private startTextureDrag(event: PointerEvent) {
    event.preventDefault();
    this.textureMoved = false;
    const move = (ev: PointerEvent) => {
      this.textureMoved = true;
      ev.preventDefault();
      const rect = this.texture.getBoundingClientRect();
      let rotation = (Math.atan2(ev.clientY - rect.top - rect.height / 2, ev.clientX - rect.left - rect.width / 2) * 180) / Math.PI + 90;
      if (rotation < 0) rotation += 360;
      let texture = rotation / 360;
      texture = Math.round(texture * 16) / 16;
      if (texture === 1) texture = 0;
      if (texture > 0 && this.currentTextureType === 'none') this.currentTextureType = DEFAULT_TEXTURE;
      if (texture !== this.currentTexture) {
        this.currentTexture = texture;
        this.updateTexture();
        this.emit();
      }
    };
    const end = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      document.removeEventListener('pointercancel', end);
      this.save.flush();
      setTimeout(() => (this.textureMoved = false), 0);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  /** Called when the Space editor closes: makes sure the last drag is saved. */
  flush() {
    this.save.flush();
  }
}
