/*
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 *
 * Adapted from Zephium (https://github.com/zephium-browser/Zephium), frame/src/shared/sky
 * (dither.ts, place.ts, picture.ts) and frame/src/features/onboarding/lib/formation.ts.
 * The sky pictures in tour/sky-*.avif and the intro sound in tour/intro.m4a come from the same place,
 * under the same licence.
 */

/** The welcome tour's sky: a photo printed as an ordered halftone on a 2D canvas, and the name drawn out of its dots. No WebGL: it shows at once on any machine. */

export type Scene = 'day' | 'night';
type Rgb = readonly [number, number, number];
type Box = { x: number; y: number; w: number; h: number };
type Picture = { data: Uint8Array; width: number; height: number };
type Quiet = { x: number; y: number; rx: number; ry: number };

/** How a scene is printed: dots keep the picture's colour, their light screened between steps that rise by `ratio`, from `paper` up. `hold` quiets the sky behind the type toward `still`. */
const INKS: Record<Scene, { paper: Rgb; ratio: number; hold: number; still: Rgb }> = {
  day: { paper: [244, 239, 228], ratio: 1.12, hold: 0.45, still: [104, 168, 238] },
  night: { paper: [15, 26, 44], ratio: 1.28, hold: 0, still: [15, 26, 44] },
};

/** Both pictures are one place at two hours, framed alike; the horizon is a share of the height. */
const PICTURE = { width: 1586, height: 992, horizon: 0.72 };

const BAYER = (() => {
  let matrix = [[0]];
  while (matrix.length < 8) {
    const n = matrix.length;
    const next = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = matrix[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    matrix = next;
  }
  return Float32Array.from(matrix.flat(), (v) => (v + 0.5) / 64);
})();

const lightOf = (r: number, g: number, b: number) => Math.max(1 / 255, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);

/** The picture laid over the page: across all of it, its horizon on the page's. */
function placeSky(width: number, horizon: number): Box {
  const scale = Math.max(width / PICTURE.width, horizon / (PICTURE.horizon * PICTURE.height));
  const w = PICTURE.width * scale;
  const h = PICTURE.height * scale;
  return { x: (width - w) / 2, y: horizon - PICTURE.horizon * h, w, h };
}

const pictures = new Map<Scene, Promise<Picture>>();
function loadPicture(scene: Scene): Promise<Picture> {
  let picture = pictures.get(scene);
  if (picture) return picture;
  picture = (async () => {
    const image = new Image();
    image.src = `tour/sky-${scene}.avif`;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    const canvas = Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, width, height).data;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0, p = 0; p < data.length; i += 4, p += 3) {
      data[p] = rgba[i];
      data[p + 1] = rgba[i + 1];
      data[p + 2] = rgba[i + 2];
    }
    return { data, width, height };
  })();
  picture.catch(() => pictures.delete(scene));
  pictures.set(scene, picture);
  return picture;
}

/**
 * Prints the sky for a page `width`×`height` into `canvas`: one canvas pixel a dot, scaled up without smoothing.
 * Below `horizon` (page pixels) the sky thins into the paper; `quiet` is where the type stands.
 */
export async function printSky(canvas: HTMLCanvasElement, scene: Scene, width: number, height: number, horizon: number, quiet: Quiet | null) {
  const picture = await loadPicture(scene);
  const density = window.devicePixelRatio || 1;
  const dot = Math.max(2, Math.round(1.5 * density));
  const columns = Math.ceil((width * density) / dot);
  const rows = Math.ceil((height * density) / dot);
  const sky = placeSky(width, horizon);
  const out = new ImageData(columns, rows);
  const { data, width: pw, height: ph } = picture;
  const { paper, ratio, hold, still } = INKS[scene];
  const held = quiet && hold > 0 ? quiet : null;
  const floor = lightOf(paper[0], paper[1], paper[2]);
  const rise = Math.log(ratio);
  const step = dot / density;
  const toX = pw / sky.w;
  const toY = ph / sky.h;
  const horizonRow = horizon / step;
  const fade = Math.max(1, rows - horizonRow);
  const rgb = [0, 0, 0];
  for (let row = 0; row < rows; row++) {
    const y = ((row + 0.5) * step - sky.y) * toY - 0.5;
    const y0 = Math.min(ph - 1, Math.max(0, Math.floor(y)));
    const y1 = Math.min(ph - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, y - y0));
    const below = Math.min(1, Math.max(0, (row - horizonRow) / fade) * 1.15);
    const dy = held ? ((row + 0.5) * step - held.y) / held.ry : 0;
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) * step - sky.x) * toX - 0.5;
      const x0 = Math.min(pw - 1, Math.max(0, Math.floor(x)));
      const x1 = Math.min(pw - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, x - x0));
      let give = 0;
      if (held) {
        const dx = ((column + 0.5) * step - held.x) / held.rx;
        const near = 1 - dx * dx - dy * dy;
        if (near > 0) give = hold * near * near * (3 - 2 * near);
      }
      for (let c = 0; c < 3; c++) {
        const top = data[(y0 * pw + x0) * 3 + c] * (1 - fx) + data[(y0 * pw + x1) * 3 + c] * fx;
        const bottom = data[(y1 * pw + x0) * 3 + c] * (1 - fx) + data[(y1 * pw + x1) * 3 + c] * fx;
        let value = top * (1 - fy) + bottom * fy;
        value += (still[c] - value) * give;
        rgb[c] = value + (paper[c] - value) * below;
      }
      const light = lightOf(rgb[0], rgb[1], rgb[2]);
      const level = Math.log(light / floor) / rise;
      const base = Math.floor(level);
      const threshold = BAYER[((row & 7) << 3) | (column & 7)];
      const scale = (Math.exp((base + (level - base > threshold ? 1 : 0)) * rise) * floor) / light;
      const at = (row * columns + column) * 4;
      out.data[at] = rgb[0] * scale;
      out.data[at + 1] = rgb[1] * scale;
      out.data[at + 2] = rgb[2] * scale;
      out.data[at + 3] = 255;
    }
  }
  canvas.width = columns;
  canvas.height = rows;
  canvas.style.width = `${(columns * dot) / density}px`;
  canvas.style.height = `${(rows * dot) / density}px`;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
}

// ---- the name, drawn out of the sky's dots ----------------------------------------------------

/** The pitch between the name's dots, in page pixels, and how far a whole cell's dot reaches. */
const PITCH = 3.4;
const REACH = 0.58;
/** The last dot lands by then; the name stands as dots a moment, then gives way to the solid one. */
const GATHER = 2500;
const HOLD = 220;
const DISSOLVE = 700;

type Dot = { sx: number; sy: number; tx: number; ty: number; r: number; delay: number; span: number; sway: number; phase: number };

/**
 * Dots rise from below the name, drift up and settle on a halftone of the letters (`letters` paints them
 * into a `box.w`×`box.h` context), then give way to the solid name. Runs once; returns a stop.
 */
export function formName(
  canvas: HTMLCanvasElement,
  options: { stage: { width: number; height: number }; box: Box; letters: (context: CanvasRenderingContext2D) => void; color: string; onformed: () => void; ondone: () => void },
): () => void {
  const { stage, box } = options;
  const density = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(stage.width * density);
  canvas.height = Math.round(stage.height * density);
  const context = canvas.getContext('2d');
  if (!context) {
    options.onformed();
    options.ondone();
    return () => undefined;
  }
  context.setTransform(density, 0, 0, density, 0, 0);
  const floor = Math.min(stage.height, box.y + box.h + 60);
  const dots: Dot[] = halftone(box, options.letters).map(([tx, ty, r]) => {
    const along = (tx - box.x) / box.w;
    return {
      sx: tx + (Math.random() - 0.5) * box.w * 0.5,
      sy: floor + Math.random() * (stage.height - floor + 40),
      tx,
      ty,
      r,
      // A wave from the middle of the name outwards, loosened by chance.
      delay: GATHER * (Math.abs(along - 0.5) * 0.2 + Math.random() * 0.16),
      span: GATHER * (0.5 + Math.random() * 0.14),
      sway: 14 + Math.random() * 40,
      phase: Math.random() * Math.PI * 2,
    };
  });
  const landed = dots.reduce((end, dot) => Math.max(end, dot.delay + dot.span), 0);
  const [r, g, b] = rgbOf(options.color);
  const shades = [0.25, 0.5, 0.75, 1];
  let started = 0;
  let formedAt = 0;
  let frame = 0;
  let stopped = false;

  function step(now: number) {
    if (stopped) return;
    if (!started) started = now;
    const age = now - started;
    const fade = formedAt ? Math.max(0, 1 - (now - formedAt) / DISSOLVE) : 1;
    const paths = shades.map(() => new Path2D());
    for (const dot of dots) {
      const t = Math.min(1, Math.max(0, (age - dot.delay) / dot.span));
      if (t <= 0) continue;
      const e = t * t * t * (t * (t * 6 - 15) + 10);
      const x = dot.sx + (dot.tx - dot.sx) * e + Math.sin(dot.phase + t * 4.2) * dot.sway * (1 - e);
      const y = dot.sy + (dot.ty - dot.sy) * e;
      const radius = (0.55 + (dot.r - 0.55) * e * e) * (formedAt ? 0.6 + 0.4 * fade : 1);
      // Faint while it travels, whole once it lands.
      const shade = Math.min(1, t * 3) * (0.45 + 0.55 * e) * fade;
      if (shade <= 0.02 || radius <= 0.1) continue;
      const path = paths[Math.min(shades.length - 1, Math.floor(shade * shades.length))];
      path.moveTo(x + radius, y);
      path.arc(x, y, radius, 0, Math.PI * 2);
    }
    context!.clearRect(0, 0, stage.width, stage.height);
    paths.forEach((path, i) => {
      context!.fillStyle = `rgba(${r},${g},${b},${shades[i]})`;
      context!.fill(path);
    });
    if (!formedAt && age >= landed + HOLD) {
      formedAt = now;
      options.onformed();
    }
    if (formedAt && fade <= 0) {
      stop();
      options.ondone();
      return;
    }
    frame = requestAnimationFrame(step);
  }

  function stop() {
    stopped = true;
    cancelAnimationFrame(frame);
    // An empty canvas gives its window-sized buffer back now.
    canvas.width = 0;
    canvas.height = 0;
  }

  frame = requestAnimationFrame(step);
  return stop;
}

/** The letters as a halftone: a dot at the centre of every cell they touch, as large as the share they cover. */
function halftone(box: Box, letters: (context: CanvasRenderingContext2D) => void): Array<[number, number, number]> {
  const fine = 4;
  const off = Object.assign(document.createElement('canvas'), { width: Math.ceil(box.w * fine), height: Math.ceil(box.h * fine) });
  const context = off.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.scale(fine, fine);
  letters(context);
  const data = context.getImageData(0, 0, off.width, off.height).data;
  const dots: Array<[number, number, number]> = [];
  const cell = PITCH * fine;
  for (let top = 0; top < off.height; top += cell)
    for (let left = 0; left < off.width; left += cell) {
      let covered = 0;
      let count = 0;
      for (let y = Math.floor(top); y < Math.min(off.height, top + cell); y += 2)
        for (let x = Math.floor(left); x < Math.min(off.width, left + cell); x += 2) {
          covered += data[(y * off.width + x) * 4 + 3];
          count++;
        }
      const share = covered / (count * 255);
      if (share < 0.08) continue;
      dots.push([box.x + (left + cell / 2) / fine, box.y + (top + cell / 2) / fine, PITCH * REACH * Math.sqrt(share)]);
    }
  return dots;
}

function rgbOf(color: string): [number, number, number] {
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) return [255, 255, 255];
  probe.fillStyle = color;
  const value = probe.fillStyle;
  if (value.startsWith('#') && value.length === 7) return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
  const parts = value.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
  return [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255];
}
