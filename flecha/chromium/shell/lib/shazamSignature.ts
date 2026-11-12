/**
 * Shazam's audio signature, the input its recognition service takes (the format the Shazam
 * extension's sigx.wasm produces, also described by the open-source SongRec and shazamio).
 * 16 kHz mono 16-bit samples go in 128 at a time; every 128 samples a 2048-point FFT under a
 * Hann window; peaks that stand out in time and frequency are kept by frequency band, and the
 * signature is those peaks, binary-encoded with a CRC32'd header.
 *
 *   const sig = new SignatureGenerator();
 *   sig.feed(samples);          // Int16Array at 16 kHz, any length, as many times as needed
 *   sig.encode();               // Uint8Array, the signature of everything fed so far
 */

const WINDOW = 2048;
const BINS = WINDOW / 2 + 1;
const HISTORY = 256;
const SAMPLE_RATE = 16000;

// numpy.hanning(2050)[1:-1].
const HANN = Float64Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (WINDOW + 1)));

interface Peak {
  pass: number;
  magnitude: number;
  bin: number;
}

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

const magnitudeOf = (power: number) => Math.log(Math.max(1 / 64, power)) * 1477.3 + 6144;

export class SignatureGenerator {
  private samples = new Int16Array(WINDOW);
  private samplePos = 0;
  private ffts = Array.from({ length: HISTORY }, () => new Float64Array(BINS));
  private spread = Array.from({ length: HISTORY }, () => new Float64Array(BINS));
  private fftPos = 0;
  private spreadPos = 0;
  private spreadDone = 0;
  private pending = new Int16Array(0);
  private sampleCount = 0;
  private bands: Peak[][] = [[], [], [], []];
  private re = new Float64Array(WINDOW);
  private im = new Float64Array(WINDOW);

  feed(input: Int16Array) {
    this.sampleCount += input.length;
    const all = new Int16Array(this.pending.length + input.length);
    all.set(this.pending);
    all.set(input, this.pending.length);
    let at = 0;
    for (; at + 128 <= all.length; at += 128) {
      this.doFft(all.subarray(at, at + 128));
      this.spreadPeaks();
      if (this.spreadDone >= 46) this.findPeaks();
    }
    this.pending = all.slice(at);
  }

  private doFft(chunk: Int16Array) {
    this.samples.set(chunk, this.samplePos);
    this.samplePos = (this.samplePos + chunk.length) % WINDOW;
    for (let i = 0; i < WINDOW; i++) {
      this.re[i] = this.samples[(this.samplePos + i) % WINDOW] * HANN[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);
    const out = this.ffts[this.fftPos];
    for (let i = 0; i < BINS; i++) out[i] = Math.max((this.re[i] ** 2 + this.im[i] ** 2) / (1 << 17), 1e-10);
    this.fftPos = (this.fftPos + 1) % HISTORY;
  }

  private spreadPeaks() {
    const last = this.ffts[(this.fftPos - 1 + HISTORY) % HISTORY];
    const out = this.spread[this.spreadPos];
    out.set(last);
    for (let i = 0; i < BINS; i++) {
      // Across frequency (in place, as the reference does), then back in time.
      if (i < BINS - 2) out[i] = Math.max(out[i], out[i + 1], out[i + 2]);
      let max = out[i];
      for (const back of [-1, -3, -6]) {
        const former = this.spread[(this.spreadPos + back + HISTORY) % HISTORY];
        max = former[i] = Math.max(former[i], max);
      }
    }
    this.spreadPos = (this.spreadPos + 1) % HISTORY;
    this.spreadDone++;
  }

  private findPeaks() {
    const at = (ring: Float64Array[], pos: number, offset: number) => ring[(((pos + offset) % HISTORY) + HISTORY) % HISTORY];
    const f46 = at(this.ffts, this.fftPos, -46);
    const s49 = at(this.spread, this.spreadPos, -49);
    for (let bin = 10; bin < 1015; bin++) {
      const value = f46[bin];
      if (value < 1 / 64 || value < s49[bin - 1]) continue;
      let around = 0;
      for (const offset of [-10, -7, -4, -3, 1, 2, 5, 8]) around = Math.max(around, s49[bin + offset]);
      if (value <= around) continue;
      for (const offset of [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]) around = Math.max(around, at(this.spread, this.spreadPos, offset)[bin - 1]);
      if (value <= around) continue;

      const magnitude = magnitudeOf(value);
      const before = magnitudeOf(f46[bin - 1]);
      const after = magnitudeOf(f46[bin + 1]);
      const variation1 = magnitude * 2 - before - after;
      if (variation1 <= 0) continue;
      const correctedBin = bin * 64 + ((after - before) * 32) / variation1;
      const hz = correctedBin * (SAMPLE_RATE / 2 / 1024 / 64);
      const band = hz < 250 ? -1 : hz < 520 ? 0 : hz < 1450 ? 1 : hz < 3500 ? 2 : hz <= 5500 ? 3 : -1;
      if (band < 0) continue;
      this.bands[band].push({ pass: this.spreadDone - 46, magnitude: Math.trunc(magnitude), bin: Math.trunc(correctedBin) });
    }
  }

  encode(): Uint8Array {
    const parts: number[] = [];
    const u32 = (out: number[], v: number) => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
    this.bands.forEach((peaks, band) => {
      if (!peaks.length) return;
      const body: number[] = [];
      let pass = 0;
      for (const peak of peaks) {
        if (peak.pass - pass >= 255) {
          body.push(0xff);
          u32(body, peak.pass);
          pass = peak.pass;
        }
        body.push(peak.pass - pass, peak.magnitude & 255, (peak.magnitude >> 8) & 255, peak.bin & 255, (peak.bin >> 8) & 255);
        pass = peak.pass;
      }
      u32(parts, 0x60030040 + band);
      u32(parts, body.length);
      parts.push(...body);
      while (parts.length % 4) parts.push(0);
    });

    const out = new Uint8Array(48 + 8 + parts.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0xcafe2580, true);
    view.setUint32(8, parts.length + 8, true);
    view.setUint32(12, 0x94119c00, true);
    view.setUint32(28, 3 << 27, true); // 16 kHz
    view.setUint32(40, Math.trunc(this.sampleCount + SAMPLE_RATE * 0.24), true);
    view.setUint32(44, (15 << 19) + 0x40000, true);
    view.setUint32(48, 0x40000000, true);
    view.setUint32(52, parts.length + 8, true);
    out.set(parts, 56);
    view.setUint32(4, crc32(out.subarray(8)), true);
    return out;
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Float samples at any rate (a tab's audio) to the 16 kHz 16-bit mono the signature takes. */
export function toShazamSamples(input: Float32Array, rate: number): Int16Array {
  const out = new Int16Array(Math.floor((input.length * SAMPLE_RATE) / rate));
  const step = rate / SAMPLE_RATE;
  for (let i = 0; i < out.length; i++) {
    // Averaging the samples each output one covers keeps what's above 8 kHz from folding back.
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j] ?? 0;
    out[i] = Math.max(-32768, Math.min(32767, Math.round((sum / (to - from)) * 32767)));
  }
  return out;
}
