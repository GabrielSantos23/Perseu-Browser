/**
 * Zen's workspace gradient theme, ported from zen-browser/desktop
 * (src/zen/spaces/ZenGradientGenerator.mjs), MPL-2.0.
 *
 * A Space theme is a list of up to three colour dots picked on Zen's wheel, plus a set of custom
 * colours, an opacity and a grain. This module turns that into the painted colours the browser
 * shows: the layered CSS gradient for the sidebar, the three colours the native frame fades
 * between, and the ink the chrome's text takes.
 */
import type { SpaceTheme, ThemeColor } from '../../shared/types';

const kMinLayerAlpha = 0.2;
const kMaxLayerAlpha = 0.88;
const kMinWindowAlpha = 0.35;
const kMaxWindowAlpha = 1;
const kGradientStops = 12;
const kGradientChroma = 0;
const kGradientHueEase = 0;
const kBaseGradientStart = 0;
const kBaseGradientEnd = 0.75;
const kOverlayStart = 0;
const kOverlayEnd = 1;
const kOverlayMaxAlpha = 0.9;
const kOverlayStrips = 64;
const kOverlayAngle = 180;
const kOverlayReferenceAspect = 16 / 10;
const kCustomGradientAngle = -30;
const kTextOpacity = 0.9;
const kTextTint = 0.12;

export const TEXTURES = ['none', 'grain', 'sand', 'denim', 'tweed'] as const;
export type Texture = (typeof TEXTURES)[number];
export const DEFAULT_TEXTURE: Texture = 'grain';
/** Zen's default grain strength: 10/16 of the grain layer. */
export const DEFAULT_TEXTURE_STRENGTH = 10 / 16;
export const MAX_DOTS = 3;
export const EXPLICIT_LIGHTNESS_TYPE = 'explicit-lightness';
export const EXPLICIT_BLACKWHITE_TYPE = 'explicit-black-white';

const isMac = /Mac/.test(navigator.platform);
export const MIN_OPACITY = isMac ? 0.3 : 0.25;
export const MAX_OPACITY = 0.8;

/** Zen's colour harmonies: the angles its other dots take from the primary one. */
export const COLOR_HARMONIES = [
  { type: 'complementary', angles: [180] },
  { type: 'singleAnalogous', angles: [310] },
  { type: 'splitComplementary', angles: [150, 210] },
  { type: 'analogous', angles: [50, 310] },
  { type: 'triadic', angles: [120, 240] },
  { type: 'floating', angles: [] },
] as const;

export type Harmony = (typeof COLOR_HARMONIES)[number]['type'];

// ---- colour maths (Zen's, unchanged) -----------------------------------------

const toLinear = (c: number) => {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4);
};
const toGamma = (c: number) => {
  const a = Math.abs(c);
  return Math.sign(c) * (a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055);
};
const srgbToLinear = (channel: number) => toLinear(channel / 255);
const linearToSrgb = (c: number) => Math.min(255, Math.max(0, toGamma(c) * 255));

export function rgbToOklab(color: Rgb): Rgb {
  const [r, g, b] = color;
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToRgb(color: Rgb): Rgb {
  const [labL, labA, labB] = color;
  const l = (labL + 0.3963377774 * labA + 0.2158037573 * labB) ** 3;
  const m = (labL - 0.1055613458 * labA - 0.0638541728 * labB) ** 3;
  const s = (labL - 0.0894841775 * labA - 1.291485548 * labB) ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export type Rgb = [number, number, number];

export function hslToRgb(h: number, s: number, l: number): Rgb {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsl(r: number, g: number, b: number): Rgb {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h: number;
  if (d === 0) h = 0;
  else if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  const l = (min + max) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h * 60, s, l];
}

function hsbToRgb(hue: number, saturation: number, brightness: number): Rgb {
  const c = brightness * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = brightness - c;
  const sector = Math.floor((((hue % 360) + 360) % 360) / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255)) as Rgb;
}

export function luminance([r, g, b]: Rgb): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

const contrastRatio = (a: Rgb, b: Rgb) => {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

function blendColors(a: Rgb, b: Rgb, percentage: number): Rgb {
  const p = percentage / 100;
  return [0, 1, 2].map((i) => Math.round(a[i] * p + b[i] * (1 - p))) as Rgb;
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

/** Parses the custom colours the picker's colour input adds (#rrggbb, #rrggbbaa or rgb[a]()). */
export function parseColor(c: string | Rgb): Rgb {
  if (Array.isArray(c)) return c;
  const value = String(c).trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    const digits = hex[1];
    const full =
      digits.length <= 4
        ? digits
            .slice(0, 3)
            .split('')
            .map((d) => d + d)
            .join('')
        : digits.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0].map((v) => clamp(v, 0, 255)) as Rgb;
  }
  return [0, 0, 0];
}

export const rgbHex = ([r, g, b]: Rgb) =>
  '#' + [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');

export const rgbTriple = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** A dot's colour as CSS, keeping a custom colour's alpha. */
export function themeColorCss(color: ThemeColor): string {
  return typeof color.c === 'string' ? color.c : rgbTriple(color.c);
}

// ---- gradients ---------------------------------------------------------------

class GradientEngine {
  readonly colors: ThemeColor[];
  readonly underlay: Rgb;
  readonly layerAlpha: number;
  readonly windowAlpha: number;

  constructor(theme: SpaceTheme, readonly dark: boolean) {
    this.colors = (theme.gradientColors ?? []).filter((c) => c && (Array.isArray(c.c) || typeof c.c === 'string'));
    const range = MAX_OPACITY - MIN_OPACITY;
    const intensity = range ? clamp(((theme.opacity ?? 0.5) - MIN_OPACITY) / range) : 1;
    this.layerAlpha = kMinLayerAlpha + (kMaxLayerAlpha - kMinLayerAlpha) * intensity ** 2;
    this.windowAlpha = kMinWindowAlpha + (kMaxWindowAlpha - kMinWindowAlpha) * intensity ** 2;
    this.underlay = dark ? [19, 19, 19] : [255, 255, 255];
  }

  composite(rgb: Rgb, alpha = this.layerAlpha): Rgb {
    return rgb.map((channel, i) => Math.round(channel * alpha + this.underlay[i] * (1 - alpha))) as Rgb;
  }

  #compositeExact(rgb: Rgb, alpha: number): Rgb {
    return rgb.map((channel, i) => channel * alpha + this.underlay[i] * (1 - alpha)) as Rgb;
  }

  #paint(rgb: Rgb): Rgb {
    return this.#compositeExact(rgb, this.layerAlpha);
  }

  #colorStop(rgb: Rgb, alphaScale = 1): string {
    const [r, g, b] = this.composite(rgb);
    return alphaScale === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alphaScale})`;
  }

  #paintedStop(rgb: Rgb, alpha: number): string {
    // Legacy comma rgba() takes integers; a fractional channel made Chromium reject the whole
    // background-image declaration, leaving only the fallback background-color.
    const [r, g, b] = rgb.map((v) => Math.round(v));
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`;
  }

  mixInLinear(a: Rgb, b: Rgb, t: number): Rgb {
    return a.map((v, i) => linearToSrgb(srgbToLinear(v) + (srgbToLinear(b[i]) - srgbToLinear(v)) * t)) as Rgb;
  }

  /** Zen's mix: OKLab, with hues crossing a custom overlay's colour when there is one. */
  mixBase(a: Rgb, b: Rgb, t: number, via: Rgb | null = null): Rgb {
    const lab1 = rgbToOklab(a);
    const lab2 = rgbToOklab(b);
    const plain = lab1.map((v, i) => v + (lab2[i] - v) * t);
    const c1 = Math.hypot(lab1[1], lab1[2]);
    const c2 = Math.hypot(lab2[1], lab2[2]);
    const h1 = Math.atan2(lab1[2], lab1[1]);
    const h2 = Math.atan2(lab2[2], lab2[1]);
    const wrap = (angle: number) => {
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      return angle;
    };
    let dh = wrap(h2 - h1);
    const labVia = via && rgbToOklab(via);
    if (labVia && Math.hypot(labVia[1], labVia[2]) > 1e-4) {
      const toVia = wrap(Math.atan2(labVia[2], labVia[1]) - h1);
      const onShortArc = dh >= 0 ? toVia >= 0 && toVia <= dh : toVia <= 0 && toVia >= dh;
      if (!onShortArc) dh -= Math.sign(dh || 1) * 2 * Math.PI;
    }
    const smooth = t * t * (3 - 2 * t);
    const eased = t + (smooth - t) * kGradientHueEase;
    const hue = c1 < 1e-4 ? h2 : c2 < 1e-4 ? h1 : h1 + dh * eased;
    const chroma = c1 + (c2 - c1) * t;
    const vivid = [plain[0], chroma * Math.cos(hue), chroma * Math.sin(hue)];
    return oklabToRgb(plain.map((v, i) => v + (vivid[i] - v) * kGradientChroma) as Rgb);
  }

  #baseMixAt(u: number, v: number): number {
    const tan = 1 / kOverlayReferenceAspect;
    const dx = Math.min(1, 1 / tan);
    const dy = Math.min(1, tan);
    const ax = 0.5 - dx / 2;
    const ay = 0.5 - dy / 2;
    const t = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy));
    return clamp((t - kBaseGradientStart) / (kBaseGradientEnd - kBaseGradientStart));
  }

  #solveOverlayStop(base: Rgb, overlay: Rgb, t: number): [Rgb, number] {
    const under = this.#paint(base);
    const target = this.#paint(this.mixInLinear(base, overlay, t * kOverlayMaxAlpha));
    let alpha = t * kOverlayMaxAlpha;
    for (let channel = 0; channel < 3; channel++) {
      const u = under[channel];
      const v = target[channel];
      if (v < u && u > 0) alpha = Math.max(alpha, (u - v) / u);
      else if (v > u && u < 255) alpha = Math.max(alpha, (v - u) / (255 - u));
    }
    alpha = Math.min(1, alpha);
    const color = target.map((v, channel) => Math.min(255, Math.max(0, (v - under[channel] * (1 - alpha)) / alpha))) as Rgb;
    return [color, alpha];
  }

  #overlayLayers(rgbs: Rgb[], width: number): string[] {
    const layers: string[] = [];
    const strip = Math.ceil(width / kOverlayStrips);
    for (let i = 0; i < kOverlayStrips; i++) {
      const u = (i + 0.5) / kOverlayStrips;
      const stops = [`transparent ${kOverlayStart * 100}%`];
      for (let j = 1; j < kGradientStops; j++) {
        const t = j / (kGradientStops - 1);
        const v = kOverlayStart + t * (kOverlayEnd - kOverlayStart);
        const base = this.mixBase(rgbs[0], rgbs[1], this.#baseMixAt(u, v), rgbs[2]);
        const [color, alpha] = this.#solveOverlayStop(base, rgbs[2], t);
        stops.push(`${this.#paintedStop(color, alpha)} ${(v * 100).toFixed(1)}%`);
      }
      layers.push(`linear-gradient(${kOverlayAngle}deg, ${stops.join(', ')}) ${i * strip}px 0 / ${strip}px 100% no-repeat`);
    }
    return layers;
  }

  /** The CSS background-image for a w×h surface, drawn exactly as Zen's browser background. */
  getGradient(width: number, height: number, forToolbar = false): string {
    const themed = this.colors;
    if (themed.length === 0) {
      const solid = this.dark ? '#131313' : '#e9e9e9';
      // A sidebar background-image layer cannot be a bare colour: paint a flat gradient.
      return forToolbar ? solid : `linear-gradient(${solid}, ${solid})`;
    }
    if (themed.length === 1) {
      const solid = themed[0].isCustom ? themeColorCss(themed[0]) : this.#colorStop(parseColor(themed[0].c));
      // Same here: one colour is still a gradient layer, not a colour value.
      return forToolbar ? solid : `linear-gradient(${solid}, ${solid})`;
    }
    if (themed.some((c) => c.isCustom)) {
      const stops = themed.map((color, index) => {
        const position = (index / (themed.length - 1)) * 100;
        const value = color.isCustom ? themeColorCss(color) : this.#colorStop(parseColor(color.c));
        return `${value} ${position}%`;
      });
      return `linear-gradient(${kCustomGradientAngle}deg, ${stops.join(', ')})`;
    }
    const ordered = [...themed].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    const rgbs = ordered.map((color) => parseColor(color.c));
    // Zen's geometry, from the --zen-gradient-* custom properties in zen-browser-ui.css.
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const phi = Math.atan2(h, w);
    const tan = Math.tan(phi);
    const dx = Math.min(w, w / tan);
    const dy = Math.min(h, h * tan);
    const slope = Math.atan2(dy, dx);
    const angle = 90 + (slope * 180) / Math.PI;
    const sin = Math.sin(slope);
    const cos = Math.cos(slope);
    const x0 = (w - dx) / 2;
    const y0 = (h - dy) / 2;
    const start = x0 * cos + y0 * sin;
    const span = dx * cos + dy * sin;
    const baseStops: string[] = [];
    for (let i = 0; i < kGradientStops; i++) {
      const position = i / (kGradientStops - 1);
      const color = this.#colorStop(
        this.mixBase(rgbs[0], rgbs[1], clamp((position - kBaseGradientStart) / (kBaseGradientEnd - kBaseGradientStart)), rgbs[2]),
      );
      baseStops.push(`${color} ${(start + position * span).toFixed(1)}px`);
    }
    const layers = [`linear-gradient(${angle.toFixed(2)}deg, ${baseStops.join(', ')}) 0 0 / 100% 100% no-repeat`];
    if (rgbs.length > 2) layers.unshift(...this.#overlayLayers(rgbs, w));
    return layers.join(', ');
  }

  /** The painted colour a fraction of the way down the gradient, for surfaces that take one colour. */
  sample(t: number): Rgb {
    const themed = this.colors;
    if (themed.length === 0) return this.dark ? [19, 19, 19] : [233, 233, 233];
    if (themed.length === 1) {
      const rgb = parseColor(themed[0].c);
      return themed[0].isCustom ? rgb : this.composite(rgb);
    }
    if (themed.some((c) => c.isCustom)) {
      const t2 = clamp(t) * (themed.length - 1);
      const i = Math.min(themed.length - 2, Math.floor(t2));
      const rgb = this.mixInLinear(parseColor(themed[i].c), parseColor(themed[i + 1].c), t2 - i);
      return this.composite(rgb);
    }
    const ordered = [...themed].sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
    const rgbs = ordered.map((color) => parseColor(color.c));
    const p = clamp(t);
    if (rgbs.length === 2) {
      return this.composite(this.mixBase(rgbs[0], rgbs[1], clamp((p - kBaseGradientStart) / (kBaseGradientEnd - kBaseGradientStart))));
    }
    const base = this.mixBase(rgbs[0], rgbs[1], this.#baseMixAt(0.5, p), rgbs[2]);
    const [color, alpha] = this.#solveOverlayStop(base, rgbs[2], p);
    const painted = this.#paint(base);
    // At the very top the overlay is fully transparent; solving its colour divides by zero,
    // which used to make the first frame colour #NaNNaNNaN and the whole native frame fail.
    if (alpha <= 0) return painted;
    return [0, 1, 2].map((i) => painted[i] * (1 - alpha) + color[i] * alpha) as Rgb;
  }
}

function engineFor(theme: SpaceTheme, dark: boolean) {
  return new GradientEngine(theme, dark);
}

/** The sidebar's background layers for a theme. */
export function themeGradient(theme: SpaceTheme, dark: boolean, width: number, height: number, forToolbar = false): string {
  return engineFor(theme, dark).getGradient(width, height, forToolbar);
}

/** The colour the theme's primary dot paints, after Zen's opacity and dark/light underlay. */
export function themeTint(theme: SpaceTheme, dark: boolean): string {
  const engine = engineFor(theme, dark);
  const colors = engine.colors;
  const primary = colors.find((c) => c.isPrimary) ?? (colors.length ? colors[Math.floor(colors.length / 2)] : undefined);
  if (!primary) return dark ? '#101012' : '#f1f1f3';
  const raw = parseColor(primary.c);
  // Zen paints a custom colour exactly as picked; a wheel colour goes through the layer alpha.
  return rgbHex(primary.isCustom ? raw : engine.composite(raw));
}

/** The three colours the native window frame fades between (it takes at most three). */
export function themeFrameColors(theme: SpaceTheme, dark: boolean): [string, string, string] {
  const engine = engineFor(theme, dark);
  if (engine.colors.length === 0) {
    const fallback = dark ? '#101012' : '#f1f1f3';
    return [fallback, fallback, fallback];
  }
  return [rgbHex(engine.sample(0)), rgbHex(engine.sample(0.5)), rgbHex(engine.sample(1))];
}

/** Light or dark chrome text over the theme, as Zen's shouldBeDarkMode decides it. */
export function themeInk(theme: SpaceTheme, dark: boolean): 'light' | 'dark' {
  const engine = engineFor(theme, dark);
  const colors = engine.colors;
  const primary = colors.find((c) => c.isPrimary) ?? (colors.length ? colors[Math.floor(colors.length / 2)] : undefined);
  if (!primary) return dark ? 'light' : 'dark';
  const raw = parseColor(primary.c);
  const accent = primary.isCustom ? raw : engine.composite(raw);
  const titles = {
    light: blendColors(accent, [0, 0, 0], kTextTint * 100),
    dark: blendColors(accent, [255, 255, 255], kTextTint * 100),
  };
  const darkText = blendColors(titles.dark, accent, kTextOpacity * 100);
  const lightText = blendColors(titles.light, accent, kTextOpacity * 100);
  const useDarkMode = contrastRatio(accent, darkText) > contrastRatio(accent, lightText);
  return useDarkMode ? 'light' : 'dark';
}

// ---- the picker's geometry ----------------------------------------------------

/** A dot's start on the wheel: its hue is the angle, its saturation the distance from the centre. */
export function calculateInitialPosition(rgb: Rgb): { x: number; y: number } {
  const [hue, saturation] = rgbToHsl(...rgb);
  const angle = (hue / 360) * 2 * Math.PI;
  const normalizedSaturation = saturation;
  return {
    x: clamp(0.5 + 0.5 * normalizedSaturation * Math.cos(angle)),
    y: clamp(0.5 + 0.5 * normalizedSaturation * Math.sin(angle)),
  };
}

/**
 * The colour under a dot, as Zen reads it from the wheel: hue is the angle, distance is lightness
 * (for the explicit-lightness wheel) or the grey ramp. `rect` is the picker's box.
 */
export function colorFromPosition(
  x: number,
  y: number,
  rect: { left: number; top: number; width: number; height: number },
  type: string | undefined,
  currentLightness: number,
): { rgb: Rgb; lightness: number } {
  const padding = 30;
  const dotHalfSize = 29;
  const px = x + dotHalfSize;
  const py = y + dotHalfSize;
  const width = rect.width + padding * 2;
  const height = rect.height + padding * 2;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = (width - padding) / 2;
  const distance = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2) - 0.2;
  let angle = Math.atan2(py - centerY, px - centerX);
  angle = (angle * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const normalizedDistance = 1 - Math.min(distance / radius, 1);
  const hue = (angle / 360) * 360;
  let saturation = normalizedDistance * 100;
  let lightness = currentLightness;
  if (type !== EXPLICIT_LIGHTNESS_TYPE) {
    saturation = 90 + (1 - normalizedDistance) * 10;
    lightness = Math.round((1 - normalizedDistance) * 100);
  }
  if (type === EXPLICIT_BLACKWHITE_TYPE) {
    saturation = 0;
    lightness = Math.round((1 - normalizedDistance) * 100);
  }
  let rgb: Rgb;
  if (type === EXPLICIT_LIGHTNESS_TYPE) {
    rgb = hsbToRgb(hue, normalizedDistance, lightness / 100);
  } else {
    rgb = hslToRgb(hue / 360, saturation / 100, lightness / 100);
  }
  // Whole channels, as the store keeps them: a float would make every echo look like a
  // new theme and reload the picker (which aborts a drag on its first move).
  return { rgb: rgb.map((v) => Math.round(clamp(v, 0, 255))) as Rgb, lightness };
}

/** A theme made from a Space's older two or three colours, so they open in the picker. */
export function themeFromColors(colors: string[]): SpaceTheme {
  const list = colors.length ? colors : ['#cdd9f7'];
  return {
    type: 'gradient',
    gradientColors: list.slice(0, 3).map((hex, index) => {
      const rgb = parseColor(hex);
      const [, , l] = rgbToHsl(...rgb);
      return {
        c: rgb,
        isPrimary: index === 0,
        algorithm: 'floating',
        lightness: Math.round(l * 100),
        position: calculateInitialPosition(rgb),
        type: EXPLICIT_LIGHTNESS_TYPE,
      };
    }),
    opacity: 0.5,
    texture: 0,
    textureType: 'none',
  };
}

/** A theme with a single dot at the centre, for Reset. */
export function defaultTheme(dark: boolean): SpaceTheme {
  const rgb: Rgb = dark ? [32, 32, 34] : [241, 241, 243];
  const [, , l] = rgbToHsl(...rgb);
  return {
    type: 'gradient',
    gradientColors: [
      {
        c: rgb,
        isPrimary: true,
        algorithm: 'floating',
        lightness: Math.round(l * 100),
        position: { x: 0.5, y: 0.5 },
        type: EXPLICIT_LIGHTNESS_TYPE,
      },
    ],
    opacity: 0.5,
    texture: 0,
    textureType: 'none',
  };
}
