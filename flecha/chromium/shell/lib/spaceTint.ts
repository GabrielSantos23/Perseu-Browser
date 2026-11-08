import { SPACE_COLORS } from '../ui/spaceChoices';

/** A Space's colour when none was picked: darker than the page in dark mode, lighter in light mode. */
export const DEFAULT_SPACE_COLOR = 'default';

/**
 * The colour a Space paints the window. The offered pastels become a deep tint of the same hue in
 * dark mode; a colour picked by hand is shown exactly as picked, black and white included.
 */
export function spaceTint(color: string, dark: boolean) {
  if (color === DEFAULT_SPACE_COLOR) return dark ? '#101012' : '#f1f1f3';
  if (!dark || !SPACE_COLORS.includes(color)) return color;
  const base = [17, 24, 36];
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const mixed = rgb.map((c, i) => Math.round(c * 0.16 + base[i] * 0.84));
  return '#' + mixed.map((c) => c.toString(16).padStart(2, '0')).join('');
}
