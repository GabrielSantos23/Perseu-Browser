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

/** The background can restart under a page that stays open; the next message connects again. */
function connect() {
  const opened = chrome.runtime.connect({ name: 'flecha' });
  opened.onMessage.addListener(receive);
  opened.onDisconnect.addListener(() => {
    port = undefined;
    for (const call of pending.values()) call.reject(new Error('The background restarted'));
    pending.clear();
  });
  return opened;
}

let port: chrome.runtime.Port | undefined = connect();
const send = (message: Message) => (port ??= connect()).postMessage(message);
setInterval(() => send({ type: 'ping' }), 20_000);

export const cmd =
  (name: string) =>
  (...args: unknown[]) =>
    send({ type: 'cmd', name, args });

export function invoke<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    send({ type: 'invoke', id, name, args });
  });
}

export function on(name: string, fn: (...args: any[]) => void) {
  listeners.set(name, [...(listeners.get(name) ?? []), fn]);
}
