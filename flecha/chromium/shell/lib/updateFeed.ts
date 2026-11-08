export interface BrowserUpdate {
  version: string;
  url: string;
  sha256: string;
}

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** The update a feed announces. Throws unless its Ed25519 signature matches `publicKey`. */
export async function readFeed(feed: { signed: string; signature: string }, publicKey: string): Promise<BrowserUpdate> {
  const key = await crypto.subtle.importKey('raw', bytes(publicKey), 'Ed25519', false, ['verify']);
  const valid = await crypto.subtle.verify('Ed25519', key, bytes(feed.signature), new TextEncoder().encode(feed.signed));
  if (!valid) throw new Error('Bad update signature');
  return JSON.parse(feed.signed);
}
