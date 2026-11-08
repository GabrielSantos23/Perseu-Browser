/**
 * The colour painted at the top of the page, as #rrggbb; a theme-color can differ from it
 * (YouTube's does). Runs inside pages, through executeScript too, so it uses nothing from outside.
 */
export function colorAtTopOfPage() {
  for (let el = document.elementFromPoint(innerWidth / 2, 0); el; el = el.parentElement) {
    const m = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(getComputedStyle(el).backgroundColor);
    if (m && (m[4] === undefined || Number(m[4]) >= 0.9)) return `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')}`;
  }
  return undefined;
}
