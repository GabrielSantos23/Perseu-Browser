// Fetches the extensions that come with Perseu into chromium/extensions/dist/<name>, the
// folder the browser loads with --flecha-extensions-dir (component_loader.cc). Each gets
// a fixed manifest key, so its id, and with it its settings, stay the same across updates.
//   node chromium/extensions/fetch.mjs
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');

const EXTENSIONS = [
  {
    // GPL-3.0: Perseu's source release must carry uBlock Origin's (github.com/gorhill/uBlock).
    name: 'ublock-origin',
    url: 'https://github.com/gorhill/uBlock/releases/download/1.75.4/uBlock0_1.75.4.chromium.zip',
    sha256: '26ad8697a7b19e1ef5f4c0750165dd585cbc7707c72dbc3f3a0bdbcd712f3576',
    // Gives the id hondaflceahejakmcphhbjmjlacadinj.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu+QOo73WBjg3DviYLfXWg4PS2giGVjTTZ2KSECy9/cWF8uJbJmSoQlvz+zkJ1vCgaAA4VtH/mrj29GzCe2fZNWr4Orf+FBN6q76GVwBDOlzWIyXAkD8kJtwu5DpZSzNZxpRcPQm5nx39tDrWaLIGDdDefHvS5e+klkg9KGuBRIiH+2eebOd+Awc0MDayv4xuiBVEa5KCpKCZHNi4E/JRhOKW/HUsF/PlTy3wH1rd2bTCaZtSCVtE/tovPfGwGcED8/5HTNHgcnTiXi80tZ8FRGhtTw7vzoOfJt+7Xknw6tunT/t+BsaeS8EKhF+EzGi1XwsZUyY+foOnz6gOF03BsQIDAQAB',
    id: 'hondaflceahejakmcphhbjmjlacadinj',
  },
];

/** The extension id Chromium derives from a manifest key. */
function idForKey(key) {
  const hex = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('');
}

for (const ext of EXTENSIONS) {
  if (idForKey(ext.key) !== ext.id) throw new Error(`${ext.name}: the key doesn't give ${ext.id}`);
  const res = await fetch(ext.url);
  if (!res.ok) throw new Error(`${ext.name}: ${res.status} for ${ext.url}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  if (ext.sha256 && sha !== ext.sha256) throw new Error(`${ext.name}: sha256 ${sha}, expected ${ext.sha256}`);
  if (!ext.sha256) console.log(`${ext.name}: pin sha256 '${sha}' in fetch.mjs`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${ext.name}-`));
  const file = path.join(tmp, 'ext.zip');
  fs.writeFileSync(file, zip);
  // bsdtar ships with Windows 10+ and macOS and reads zip files (Git Bash's GNU tar doesn't).
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', file, '-C', tmp]);
  const manifestPath = fs.readdirSync(tmp, { recursive: true }).map(String).find((f) => path.basename(f) === 'manifest.json');
  if (!manifestPath) throw new Error(`${ext.name}: no manifest.json in the zip`);
  const root = path.join(tmp, path.dirname(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  manifest.key = ext.key;
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const dest = path.join(out, ext.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.cpSync(root, dest, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ext.name} ${manifest.version} (manifest v${manifest.manifest_version}) → ${dest}`);
}
