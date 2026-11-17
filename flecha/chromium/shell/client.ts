/**
 * The page side of the shell's messaging: what a Flecha page uses in place of Electron's
 * ipcRenderer. cmd() fires a command, invoke() awaits a reply, on() listens for events.
 */
import type { Message } from './protocol';

const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const listeners = new Map<string, Array<(...args: any[]) => void>>();
let nextId = 1;

function receive(message: Message) {
  if (message.type === 'result') {
    const call = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) call?.reject(new Error(message.error));
    else call?.resolve(message.value);
  } else if (message.type === 'event') {
    for (const fn of listeners.get(message.name) ?? []) fn(...message.args);
  }
}

/** The calls waiting on a port that's gone will never be answered: they fail, so nothing waits forever. */
function dropPort() {
  port = undefined;
  for (const call of pending.values()) call.reject(new Error('The background restarted'));
  pending.clear();
}

/** The background can restart under a page that stays open; the next message connects again. */
function connect() {
  const opened = chrome.runtime.connect({ name: 'flecha' });
  opened.onMessage.addListener(receive);
  // Only for the current port: a stale one reporting late mustn't drop its replacement.
  opened.onDisconnect.addListener(() => opened === port && dropPort());
  return opened;
}

let port: chrome.runtime.Port | undefined = connect();
// When Chromium stops the background, the port can die without onDisconnect ever firing; every
// message after that threw and was lost, and the whole UI stopped answering. A send that finds
// the port dead connects again (which wakes the background) and goes out on the new one.
function send(message: Message) {
  try {
    (port ??= connect()).postMessage(message);
  } catch {
    dropPort();
    port = connect();
    port.postMessage(message);
  }
}
setInterval(() => send({ type: 'ping' }), 20_000);

export const cmd =
  (name: string) =>
  (...args: unknown[]) =>
    send({ type: 'cmd', name, args });

export function invoke<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // Sent first: a send that reconnects fails the calls left on the dead port, not this one.
    // The reply can't come back before the next turn, so it still finds its entry.
    send({ type: 'invoke', id, name, args });
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
  });
}

export function on(name: string, fn: (...args: any[]) => void) {
  listeners.set(name, [...(listeners.get(name) ?? []), fn]);
}
