/**
 * The Space colour field, shared by the sidebar's Space editor and the welcome tour: hue across, from light
 * pastel at the top to nearly black at the bottom, and a last column of greys from white to black.
 */
const GREYS_FROM = 0.93;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const fieldColor = (x: number, y: number) => {
  if (x >= GREYS_FROM) return hslHex(0, 0, 1 - y);
  return hslHex((x / GREYS_FROM) * 360, 0.72, 0.93 - y * 0.85);
};

export const fieldPoint = (hex: string) => {
  const [hue, s, l] = hexHsl(hex);
  if (s < 0.08) return { x: (1 + GREYS_FROM) / 2, y: clamp01(1 - l) };
  return { x: (hue / 360) * GREYS_FROM, y: clamp01((0.93 - l) / 0.85) };
};

/**
 * Sends at most one value every `ms`, and the last one on flush. A change to a Space is saved, sent to every
 * page and repaints the window, so a drag over the field sends a few a second instead of one a frame.
 */
export function throttled<T>(send: (value: T) => void, ms = 120) {
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

/** The colour a new gradient stop starts at: a third of the way round the hue circle, at the same lightness. */
export function nextStop(last: string) {
  const [hue, , l] = hexHsl(last);
  return hslHex((hue + 120) % 360, 0.72, Math.min(0.93, Math.max(0.27, l)));
}

export function hslHex(hue: number, s: number, l: number) {
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function hexHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hue * 60 + 360) % 360, s, l];
}

/** Draws the field once, pixel by pixel, from the same formula the dots use. */
export function paintField(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = fieldColor(x / (width - 1), y / (height - 1));
      const i = (y * width + x) * 4;
      image.data.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], i);
    }
  }
  ctx.putImageData(image, 0, 0);
}
