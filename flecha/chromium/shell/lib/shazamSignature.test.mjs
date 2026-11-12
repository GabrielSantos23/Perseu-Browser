// node --experimental-strip-types chromium/shell/lib/shazamSignature.test.mjs
// Checks the signature's framing (magic, sizes, CRC) and that a tone gives peaks in its band.
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { SignatureGenerator, toShazamSamples } from './shazamSignature.ts';

const rate = 48000;
const tone = new Float32Array(rate * 4);
// Short notes, 440 Hz then 1000 Hz, with silence between: peaks only count where they stand out in time.
for (let i = 0; i < tone.length; i++) {
  const t = i % (rate / 2);
  const env = t < rate / 10 ? Math.sin((Math.PI * t) / (rate / 10)) : 0;
  tone[i] = 0.4 * env * Math.sin((2 * Math.PI * (Math.floor(i / (rate / 2)) % 2 ? 1000 : 440) * i) / rate);
}

const gen = new SignatureGenerator();
const samples = toShazamSamples(tone, rate);
assert.equal(samples.length, 16000 * 4);
gen.feed(samples.subarray(0, 1000));
gen.feed(samples.subarray(1000));
const sig = gen.encode();
const v = new DataView(sig.buffer);
assert.equal(v.getUint32(0, true), 0xcafe2580);
assert.equal(v.getUint32(12, true), 0x94119c00);
assert.equal(v.getUint32(8, true), sig.length - 48);
assert.equal(v.getUint32(40, true), 16000 * 4 + 3840);
assert.equal(v.getUint32(4, true), zlib.crc32(sig.subarray(8)));
const bands = [];
for (let at = 56; at < sig.length; ) {
  const len = v.getUint32(at + 4, true);
  bands.push(v.getUint32(at, true) - 0x60030040);
  at += 8 + len + ((4 - (len % 4)) % 4);
}
// 440 Hz is in 250–520, 1000 Hz in 520–1450.
assert.ok(bands.includes(0) && bands.includes(1), `bands ${bands}`);
console.log('shazamSignature ok', sig.length, 'bytes');
