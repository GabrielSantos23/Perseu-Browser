/**
 * The sidebar's song card (ui/app.ts renderNowPlaying): what a tab is playing.
 * First the page's own media session (YouTube, Spotify, SoundCloud say the title and artist),
 * through chrome.flechaPrivate.getMedia; its buttons go to mediaAction. When the page names
 * nothing, the tab's sound goes to Shazam (offscreen.ts), on a click on Identify.
 */
import type { Store } from '../shared/store';
import type { NowPlaying } from '../shared/types';
import type { Message } from './protocol';
import { broadcast, handle, onConnect } from './hub';

export interface NowPlayingContext {
  store: Store;
  chromeIdFor(tabId: string): number | undefined;
  flechaIdFor(chromeId: number): string | undefined;
}

import type { SongAnswer } from './offscreen';

type MediaAction = 'play' | 'pause' | 'next' | 'previous';

const TICK_MS = 2000;

/**
 * Sites whose media session names the song. Elsewhere it names the post or the video (X sends
 * the tweet and its author, YouTube the video's title), so the card offers to identify instead.
 */
const MUSIC_HOSTS = /(^|\.)(music\.youtube\.com|open\.spotify\.com|soundcloud\.com|music\.apple\.com|deezer\.com|tidal\.com|bandcamp\.com|music\.amazon\.[a-z.]+)$/;
const namesSongs = (url: string | undefined) => {
  try {
    return MUSIC_HOSTS.test(new URL(url ?? '').hostname);
  } catch {
    return false;
  }
};

export function registerNowPlaying(ctx: NowPlayingContext) {
  const { store } = ctx;
  let song: NowPlaying | null = null;
  /** What was playing when the card was closed (keyFor): it comes back for anything else. */
  let dismissed: string | undefined;
  /** What Shazam said, by tab and page, so the same page isn't sent twice. */
  const recognized = new Map<string, SongAnswer>();
  let identifying: string | undefined;

  /** What was sent to Shazam is by tab, page and what is playing: X keeps one address for a whole feed of videos. */
  const media = new Map<string, string>();
  const keyFor = (tabId: string) => `${tabId} ${store.state.tabs[tabId]?.url ?? ''} ${media.get(tabId) ?? ''}`;

  function send(next: NowPlaying | null) {
    if (JSON.stringify(next) === JSON.stringify(song)) return;
    song = next;
    broadcast('now-playing', song);
  }
  onConnect((port) => port.postMessage({ type: 'event', name: 'now-playing', args: [song] } satisfies Message));

  /**
   * The tab the card is about: a tab making sound (the one shown, else the active one, else any),
   * and only with none of those the paused player it showed, so that it keeps its Play button.
   */
  async function pickTab(): Promise<{ tabId?: string; audible: string[] }> {
    // Chromium's own audible flags: the Store's may be stale after the shell reloads.
    const audible = (await chrome.tabs.query({ audible: true }))
      .map((t) => (t.id === undefined ? undefined : ctx.flechaIdFor(t.id)))
      .filter((id): id is string => !!id && !!store.state.tabs[id]);
    const active = store.activeTab?.id;
    if (song && audible.includes(song.tabId)) return { tabId: song.tabId, audible };
    if (audible.length) return { tabId: audible.includes(active ?? '') ? active : audible[0], audible };
    return { tabId: song && store.state.tabs[song.tabId] ? song.tabId : undefined, audible };
  }

  async function tick() {
    const picked = await pickTab();
    const tabId = picked.tabId;
    if (!tabId) return send(null);
    const chromeId = ctx.chromeIdFor(tabId);
    if (chromeId === undefined) return send(null);
    const info = await chrome.flechaPrivate?.getMedia?.(chromeId).catch(() => undefined);
    media.set(tabId, info ? `${info.title} ${info.artist}` : '');
    const audible = picked.audible.includes(tabId);
    if (dismissed === keyFor(tabId)) return send(null);
    dismissed = undefined;
    // A paused player keeps its card (with Play); a tab that went quiet without one loses it.
    if (!info && !audible) return send(null);
    const playing = info ? info.playing : audible;
    const progress = info && info.duration > 0 ? { current: info.position, duration: info.duration } : undefined;
    const skip = info ? { canNext: info.canNext, canPrevious: info.canPrevious } : {};
    if (info?.title && namesSongs(store.state.tabs[tabId]?.url)) return send({ tabId, status: 'found', source: 'page', title: info.title, artist: info.artist || undefined, playing, ...skip, ...(progress ? { progress } : {}) });

    const key = keyFor(tabId);
    if (identifying === key) return send({ tabId, status: 'identifying', playing });
    if (recognized.has(key)) {
      const hit = recognized.get(key);
      return send(hit ? { tabId, status: 'found', source: 'recognized', ...hit, playing, ...skip, ...(progress ? { progress } : {}) } : { tabId, status: 'nomatch', playing, ...skip, ...(progress ? { progress } : {}) });
    }
    send({ tabId, status: 'audio', playing, ...skip, ...(progress ? { progress } : {}) });
  }

  async function identify(tabId: string) {
    const chromeId = ctx.chromeIdFor(tabId);
    const key = keyFor(tabId);
    if (chromeId === undefined || identifying) return;
    identifying = key;
    send({ tabId, status: 'identifying', playing: true });
    try {
      recognized.set(key, await recognize(chromeId));
    } catch (err) {
      console.error('Perseu: identifying the song failed', err);
      recognized.set(key, null);
    } finally {
      identifying = undefined;
      void loop();
    }
  }

  async function recognize(chromeId: number): Promise<SongAnswer> {
    // Allowed without a click for the shell (tab_capture_api.cc).
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: chromeId });
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: 'Records a few seconds of a tab that plays music, to name the song.',
      });
    }
    return chrome.runtime.sendMessage({ perseu: 'identify-song', streamId });
  }

  handle({
    identifySong: (tabId: unknown) => {
      recognized.delete(keyFor(String(tabId)));
      void identify(String(tabId));
    },
    mediaControl: async (tabId: unknown, action: unknown) => {
      const chromeId = ctx.chromeIdFor(String(tabId));
      if (chromeId === undefined) return;
      // The card's volume button: muting the tab, so the pill keeps its speaker.
      if (action === 'mute' || action === 'unmute') {
        await chrome.tabs.update(chromeId, { muted: action === 'mute' }).catch(() => undefined);
        setTimeout(() => void loop(), 300);
        return;
      }
      if (!['play', 'pause', 'next', 'previous'].includes(String(action))) return;
      await chrome.flechaPrivate.mediaAction(chromeId, action as MediaAction).catch(() => undefined);
      setTimeout(() => void loop(), 300);
    },
    togglePip: (tabId: unknown) => {
      const chromeId = ctx.chromeIdFor(String(tabId));
      if (chromeId === undefined) return;
      // The page's own video, in and out of the system's picture-in-picture; the
      // biggest video wins, when the page has more than one.
      void chrome.scripting
        .executeScript({
          target: { tabId: chromeId },
          func: () => {
            const videos = [...document.querySelectorAll('video')].filter((v) => !v.disablePictureInPicture);
            const video = videos.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
            if (document.pictureInPictureElement) void document.exitPictureInPicture();
            else void video?.requestPictureInPicture()?.catch(() => undefined);
          },
        })
        .catch(() => undefined);
    },
    seekMedia: (tabId: unknown, seconds: unknown) => {
      const chromeId = ctx.chromeIdFor(String(tabId));
      const at = Number(seconds);
      if (chromeId === undefined || !Number.isFinite(at)) return;
      // The page's own video is what actually jumps; the session's SeekTo
      // covers the pages that play without a <video> of their own.
      void chrome.scripting
        .executeScript({
          target: { tabId: chromeId },
          func: (at: number) => {
            const videos = [...document.querySelectorAll('video')].filter((v) => !v.disablePictureInPicture);
            const video = videos.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0];
            if (video) video.currentTime = at;
          },
          args: [at],
        })
        .catch(() => undefined);
      void chrome.flechaPrivate?.seekMedia?.(chromeId, at).catch(() => undefined);
    },
    dismissNowPlaying: () => {
      if (!song) return;
      // A recognised song: forget it, so the card says what is playing again and
      // Identify is on the table at once (no waiting for the song to change).
      if (song.status === 'found' && song.source === 'recognized') recognized.delete(keyFor(song.tabId));
      // A song the page itself named: hold the card until what plays changes.
      else if (song.status === 'found' && song.source === 'page') dismissed = keyFor(song.tabId);
      send(null);
      void loop();
    },
  });

  // Polls only while something plays or the card shows: an idle browser asked Chromium every 2 s.
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function loop() {
    clearTimeout(timer);
    timer = undefined;
    await tick().catch(() => undefined);
    const sounding = (await chrome.tabs.query({ audible: true }).catch(() => [])).length > 0;
    if (song || sounding) timer ??= setTimeout(() => void loop(), TICK_MS);
  }
  chrome.tabs.onUpdated.addListener((_id, change) => {
    if ('audible' in change && !timer) void loop();
  });
  void loop();
}
