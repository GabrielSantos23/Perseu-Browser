// Writes dist/bangs.json, DuckDuckGo's bangs as { tag: site name }, for the command bar's site chip.
// The list is kept in chromium/shell/.cache for a few days. Without a network and a cache it comes
// out empty: bangs still work, without the chip.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const cache = path.join(path.dirname(fileURLToPath(import.meta.url)), '.cache', 'bang.json');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function list() {
  const stat = fs.statSync(cache, { throwIfNoEntry: false });
  if (stat && Date.now() - stat.mtimeMs < MAX_AGE_MS) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  try {
    const res = await fetch('https://duckduckgo.com/bang.js', { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bangs = await res.json();
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(bangs));
    return bangs;
  } catch (err) {
    console.warn(`bangs: couldn't download the list (${err.message})`);
    return stat ? JSON.parse(fs.readFileSync(cache, 'utf8')) : [];
  }
}

export async function buildBangs(out) {
  const names = Object.fromEntries((await list()).map((b) => [b.t.toLowerCase(), b.s]));
  // A fresh checkout (CI) has no dist yet: esbuild makes it later.
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'bangs.json'), JSON.stringify(names));
}
