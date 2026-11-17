/** The bar on top of the page area (window.html?kind=topbar): its height, and its colours. */
export const TOP_BAR_HEIGHT = 34;
/** The retracted bar's hover strip; the browser puts no window buttons in a bar thinner than them. */
export const TOP_EDGE_HEIGHT = 6;

/** The page's colour, or the home's sky (#1a1d25, the new tab's base) before the page says one. */
export function topBarColors(siteColor: string | undefined) {
  const bg = siteColor ?? '#1a1d25';
  return { bg, fg: isDark(bg) ? '#f5f5f7' : '#1d1d1f' };
}

/** Relative luminance of #rrggbb, by WCAG's formula; 1 for anything else. */
export function luminance(hex: string) {
  const c = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!c) return 1;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDark = (hex: string) => luminance(hex) < 0.4;
