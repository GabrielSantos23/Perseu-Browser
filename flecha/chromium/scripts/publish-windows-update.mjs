#!/usr/bin/env node
// Signs the feed Perseu's updater reads, and with --publish uploads it and the installer.
// chrome/VERSION must be higher than the installed build's: Perseu ignores anything else.
//   PERSEU_UPDATE_KEY=C:/uc/perseu-update-signing-key.pem node chromium/scripts/publish-windows-update.mjs <mini_installer.exe> <version> [--publish]
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, createReadStream, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repo = process.env.PERSEU_RELEASE_REPO ?? 'GabrielSantos23/Perseu-Browser';
const [installer, version, flag] = process.argv.slice(2);
if (!installer || !/^\d+\.\d+\.\d+\.\d+$/.test(version ?? '') || !process.env.PERSEU_UPDATE_KEY) {
  console.error('usage: PERSEU_UPDATE_KEY=<key.pem> publish-windows-update.mjs <mini_installer.exe> <a.b.c.d> [--publish]');
  process.exit(1);
}

const hash = createHash('sha256');
for await (const chunk of createReadStream(installer)) hash.update(chunk);

const name = `perseu-${version}-installer.exe`;
const signed = JSON.stringify({ version, url: `https://github.com/${repo}/releases/download/v${version}/${name}`, sha256: hash.digest('hex') });
const key = createPrivateKey(readFileSync(process.env.PERSEU_UPDATE_KEY));
const signature = sign(null, Buffer.from(signed), key).toString('base64');

const out = mkdtempSync(join(tmpdir(), 'perseu-update-'));
const feed = join(out, 'perseu-update.json');
writeFileSync(feed, JSON.stringify({ signed, signature }));
console.log(feed, signed);

if (flag === '--publish') {
  const asset = join(out, name);
  copyFileSync(installer, asset);
  execFileSync('gh', ['release', 'create', `v${version}`, asset, feed, '--repo', repo, '--title', `Perseu ${version}`, '--notes', `Perseu ${version}`, '--latest'], { stdio: 'inherit' });
}
