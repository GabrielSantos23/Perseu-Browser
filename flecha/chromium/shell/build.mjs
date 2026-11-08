// Builds the shell extension into chromium/shell/dist. `node build.mjs --watch` rebuilds on
// save; reload the extension (or the sidebar) to see the change. No Chromium build involved.
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { featureEntries, copyFeatureStatic } from './build-features.mjs';
import { buildBangs } from './build-bangs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const out = path.join(here, 'dist');
const ui = path.join(here, 'ui');

function copyStatic() {
  fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
  // Lets the shell load in an older stock browser (e.g. Helium on Chromium 157) while prototyping its UI.
  if (process.env.FLECHA_MIN_CHROME) manifest.minimum_chrome_version = process.env.FLECHA_MIN_CHROME;
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const f of fs.readdirSync(ui)) if (f.endsWith(".css") || f.endsWith(".png")) fs.copyFileSync(path.join(ui, f), path.join(out, f));
  fs.copyFileSync(
    path.join(root, 'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
    path.join(out, 'fonts/jetbrains-mono.woff2'),
  );
  // The sidebar page (ui/index.html), pointed at the shell's bundle, once per surface.
  const html = fs
    .readFileSync(path.join(ui, 'index.html'), 'utf8')
    .replace('src="app.js"', 'src="sidebar.js"')
    .replace('<link rel="stylesheet" href="onboarding.css" />', '$&\n    <link rel="stylesheet" href="shell.css" />');
  const pages = { window: 'window.html', panel: 'sidebar.html', newtab: 'newtab.html' };
  for (const [surface, page] of Object.entries(pages)) {
    let pageHtml = html.replace('<html>', `<html data-surface="${surface}">`);
    if (surface === 'window') pageHtml = pageHtml.replace('<title>', '<script src="kind.js"></script>\n    <title>');
    fs.writeFileSync(path.join(out, page), pageHtml);
  }
  fs.copyFileSync(path.join(here, 'shell.css'), path.join(out, 'shell.css'));
  // A Flechinha's frame page is window.html?kind=flechinha, and the top bar's ?kind=topbar;
  // this sends them on to their pages before the sidebar's code runs.
  fs.writeFileSync(
    path.join(out, 'kind.js'),
    "{ const kind = new URLSearchParams(location.search).get('kind'); if (kind === 'flechinha' || kind === 'topbar') location.replace(kind + '.html' + location.search); }\n",
  );
  fs.writeFileSync(path.join(out, 'flechinha.html'), fs.readFileSync(path.join(ui, 'flechinha.html'), 'utf8'));
  fs.copyFileSync(path.join(ui, 'topbar.html'), path.join(out, 'topbar.html'));
  fs.copyFileSync(path.join(here, 'offscreen.html'), path.join(out, 'offscreen.html'));

  for (const f of ['settings.html', 'settings-shell.css']) fs.copyFileSync(path.join(here, f), path.join(out, f));
  copyFeatureStatic(out);
}

const options = {
  entryPoints: { background: path.join(here, 'background.ts'), sidebar: path.join(here, 'sidebar.ts'), settings: path.join(here, 'settings.ts'), flechinha: path.join(here, 'flechinha.ts'), topbar: path.join(here, 'topbar.ts'), offscreen: path.join(here, 'offscreen.ts'), ...featureEntries },
  bundle: true,
  format: 'esm',
  target: 'chrome140',
  outdir: out,
  logLevel: 'warning',
  plugins: [{ name: 'static', setup: (b) => b.onEnd(copyStatic) }],
};

await buildBangs(out);

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('shell: watching');
} else {
  await build(options);
}
