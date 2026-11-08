/**
 * Content script: tells the background when the page's colour changes, for the top bar. A site's
 * dark mode toggle changes a class or attribute on <html> or <body>.
 * shortcut: a toggle that only swaps a stylesheet isn't seen until the next tab switch; watch <head> if one turns up.
 */
import { colorAtTopOfPage } from '../lib/pageColor';

let last: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function report() {
  const color = colorAtTopOfPage();
  if (!color || color === last) return;
  last = color;
  chrome.runtime.sendMessage({ perseu: 'page-color', color }).catch(() => undefined);
}
// Long enough for the page's own colour transition to finish.
const reportSoon = () => {
  clearTimeout(timer);
  timer = setTimeout(report, 350);
};

const observer = new MutationObserver(reportSoon);
for (const el of [document.documentElement, document.body]) if (el) observer.observe(el, { attributes: true });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportSoon);
report();
