/**
 * The shell's offscreen document (nowPlaying.ts): listens to a tab and asks Shazam what song it
 * is, the way the Shazam extension does: the tab's sound is kept as it plays, and at 3, 6, 9
 * and 12 seconds the signature of everything heard so far (lib/shazamSignature.ts) goes to
 * Shazam's tag service; the first answer with a song ends it. The tab keeps playing through it.
 */
import { SignatureGenerator, toShazamSamples } from './lib/shazamSignature';

export type SongAnswer = { title: string; artist?: string; artwork?: string } | null;

const CHECKS_MS = [3000, 6000, 9000, 12000];

async function askShazam(signature: Uint8Array, ms: number): Promise<SongAnswer> {
  const id = () => crypto.randomUUID().toUpperCase();
  const lang = navigator.language.split('-')[0] || 'en';
  const url = `https://amp.shazam.com/discovery/v5/${lang}/US/web/-/tag/${id()}/${id()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`;
  let binary = '';
  for (const b of signature) binary += String.fromCharCode(b);
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      signature: { uri: `data:audio/vnd.shazam.sig;base64,${btoa(binary)}`, samplems: Math.round(ms) },
      timestamp: Date.now(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (!res.ok) throw new Error(`Shazam answered ${res.status}`);
  const track = (await res.json())?.track;
  if (!track?.title) return null;
  return { title: String(track.title), artist: track.subtitle ? String(track.subtitle) : undefined, artwork: track.images?.coverarthq || track.images?.coverart || undefined };
}

async function identify(streamId: string): Promise<SongAnswer> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  } as MediaStreamConstraints);
  const audio = new AudioContext();
  const source = audio.createMediaStreamSource(stream);
  // Capturing mutes the tab; play it back so it still sounds.
  source.connect(audio.destination);
  const chunks: Float32Array[] = [];
  // shortcut: ScriptProcessorNode is deprecated but needs no worklet file; move to an AudioWorklet if Chromium drops it.
  const tap = audio.createScriptProcessor(4096, 2, 1);
  tap.onaudioprocess = (e) => {
    const input = e.inputBuffer;
    const mono = new Float32Array(input.length);
    for (let c = 0; c < input.numberOfChannels; c++) {
      const data = input.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / input.numberOfChannels;
    }
    chunks.push(mono);
  };
  source.connect(tap);
  // The tap's output is silence; it only runs while connected to the destination.
  tap.connect(audio.destination);

  // Each check feeds the generator only what arrived since the last one.
  const generator = new SignatureGenerator();
  let heard = 0;
  const started = performance.now();
  try {
    for (const at of CHECKS_MS) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, at - (performance.now() - started))));
      const fresh = chunks.splice(0);
      const joined = new Float32Array(fresh.reduce((n, c) => n + c.length, 0));
      fresh.reduce((offset, c) => (joined.set(c, offset), offset + c.length), 0);
      heard += joined.length;
      generator.feed(toShazamSamples(joined, audio.sampleRate));
      if (!heard) continue;
      const answer = await askShazam(generator.encode(), (heard / audio.sampleRate) * 1000);
      if (answer) return answer;
    }
    return null;
  } finally {
    tap.disconnect();
    source.disconnect();
    for (const track of stream.getTracks()) track.stop();
    void audio.close();
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.perseu !== 'identify-song' || sender.id !== chrome.runtime.id) return;
  identify(String(message.streamId)).then(reply, (err) => {
    console.error('Perseu: song recognition failed', err);
    reply(null);
  });
  return true;
});
