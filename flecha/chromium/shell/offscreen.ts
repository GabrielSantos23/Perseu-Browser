/**
 * The shell's offscreen document (nowPlaying.ts): records a few seconds of a tab's sound and
 * asks AudD (api.audd.io) what song it is. The tab keeps playing through the capture.
 */
const SECONDS = 7;
export type SongAnswer = { title: string; artist?: string; artwork?: string } | null;

async function record(streamId: string): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  } as MediaStreamConstraints);
  // Capturing mutes the tab; play it back so it still sounds.
  const audio = new AudioContext();
  audio.createMediaStreamSource(stream).connect(audio.destination);
  try {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
    recorder.stop();
    await stopped;
    return new Blob(chunks, { type: 'audio/webm' });
  } finally {
    for (const track of stream.getTracks()) track.stop();
    void audio.close();
  }
}

async function askAudD(clip: Blob, token?: string): Promise<SongAnswer> {
  const body = new FormData();
  body.append('file', clip, 'clip.webm');
  body.append('return', 'spotify');
  // Without a token AudD answers a few requests a day; with one, the plan's.
  if (token) body.append('api_token', token);
  const res = await fetch('https://api.audd.io/', { method: 'POST', body });
  if (!res.ok) throw new Error(`AudD answered ${res.status}`);
  const data = await res.json();
  if (data.status !== 'success') throw new Error(`AudD: ${data.error?.error_message ?? 'error'}`);
  const r = data.result;
  if (!r?.title) return null;
  return { title: String(r.title), artist: r.artist ? String(r.artist) : undefined, artwork: r.spotify?.album?.images?.[0]?.url };
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.perseu !== 'identify-song' || sender.id !== chrome.runtime.id) return;
  record(String(message.streamId)).then((clip) => askAudD(clip, message.token ? String(message.token) : undefined)).then(reply, (err) => {
    console.error('Perseu: song recognition failed', err);
    reply(null);
  });
  return true;
});
