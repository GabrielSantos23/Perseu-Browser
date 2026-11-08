// Run: node --experimental-strip-types chromium/scripts/update-feed.test.mjs
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFeed } from '../shell/lib/updateFeed.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const signed = JSON.stringify({ version: '157.0.8103.39', url: 'https://github.com/a/b.exe', sha256: 'ab' });
const signature = sign(null, Buffer.from(signed), privateKey).toString('base64');

assert.equal((await readFeed({ signed, signature }, pub)).version, '157.0.8103.39');
await assert.rejects(readFeed({ signed: signed.replace('.39', '.40'), signature }, pub), /Bad update signature/);

const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
await assert.rejects(readFeed({ signed, signature }, other), /Bad update signature/);
console.log('ok');
