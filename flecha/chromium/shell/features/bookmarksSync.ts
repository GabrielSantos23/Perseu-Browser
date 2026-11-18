/**
 * The Spaces, mirrored into Chromium's bookmarks: a "Perseu Spaces" folder under Other
 * bookmarks, one folder per Space holding its Favorites and its pinned tree. This is what
 * closes the gap with chrome://bookmarks (Menu → Bookmarks) and anything that reads
 * Chromium's bookmarks, like bookmark-based features and other profiles' importers.
 *
 * The mirror is one way, Store → bookmarks: it is Perseu's copy, so manual edits inside
 * "Perseu Spaces" are rewritten on the next sync. Everything outside that folder —
 * the bookmark bar, other bookmarks — is never touched.
 */
import type { PinnedNode, Space } from '../../shared/types';
import type { Store } from '../../shared/store';
import { incognito } from '../incognito';

const ROOT_TITLE = 'Perseu Spaces';
const FAVORITES_TITLE = 'Favorites';
const DEBOUNCE = 3000;

/** What one bookmark-tree slot should hold. */
interface Wanted {
  title: string;
  url?: string;
  children?: Wanted[];
}

let timer: ReturnType<typeof setTimeout> | undefined;
let syncing = false;

/** Rewrites the mirror a moment after every Store change; bookmarks calls are slow. */
export function watchBookmarks(store: Store) {
  if (incognito) return;
  void sync(store);
  store.onChange(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void sync(store);
    }, DEBOUNCE);
  });
}

async function sync(store: Store) {
  if (syncing || incognito) return;
  syncing = true;
  try {
    const [tree] = await chrome.bookmarks.getTree();
    // Chromium's bookmark roots: 0 is the virtual root, its children are the bar and Other bookmarks.
    const other = tree.children?.find((node) => !node.url && node.children?.length);
    if (!other) return;
    const spaces: Space[] = store.state.spaces;

    const otherChildren = other.children ?? [];
    let root = otherChildren.find((node) => !node.url && node.title === ROOT_TITLE);
    if (!spaces.length) {
      // No Spaces: the mirror holds nothing, so it goes away entirely.
      if (root) await chrome.bookmarks.removeTree(root.id);
      return;
    }
    root ??= await chrome.bookmarks.create({ parentId: other.id, title: ROOT_TITLE });

    const wanted: Wanted[] = spaces.map((space) => ({
      title: spaceFolderTitle(space),
      children: [
        ...(space.favorites.length ? [{ title: FAVORITES_TITLE, children: pinnedWanted(space.favorites.map((id: string) => ({ kind: 'tab', tabId: id }) as PinnedNode), store) }] : []),
        ...pinnedWanted(space.pinned, store),
      ],
    }));

    // The prefix stays untouched, so renames and reorders only rebuild what moved.
    await reconcile(root, wanted);
  } catch (err) {
    // A refused bookmark write must never take the background down.
    console.warn('Flecha shell: bookmarks mirror failed', err);
  } finally {
    syncing = false;
  }
}

const spaceFolderTitle = (space: Space) => `${space.emoji ?? ''} ${space.name}`.trim() || 'Space';

function pinnedWanted(nodes: PinnedNode[], store: Store): Wanted[] {
  const out: Wanted[] = [];
  for (const node of nodes) {
    if (node.kind === 'tab') {
      const tab = store.state.tabs[node.tabId];
      if (tab) out.push({ title: tab.title || tab.url, url: tab.url });
    } else {
      out.push({ title: node.name, children: pinnedWanted(node.children, store) });
    }
  }
  return out;
}

const same = (w: Wanted, node: chrome.bookmarks.BookmarkTreeNode) => node.title === w.title && (w.url ? node.url === w.url : !node.url);

/** Brings `parent`'s children in line with `wanted`, in order, keeping what already matches. */
async function reconcile(parent: chrome.bookmarks.BookmarkTreeNode, wanted: Wanted[]) {
  const have = (await chrome.bookmarks.getChildren(parent.id)) ?? [];
  let i = 0;
  while (i < wanted.length && i < have.length && same(wanted[i], have[i])) {
    if (wanted[i].children) await reconcile(have[i], wanted[i].children!);
    i++;
  }
  for (let j = have.length - 1; j >= i; j--) await chrome.bookmarks.removeTree(have[j].id);
  for (let j = i; j < wanted.length; j++) await createWanted(parent.id, wanted[j]);
}

async function createWanted(parentId: string, w: Wanted) {
  if (w.children) {
    const folder = await chrome.bookmarks.create({ parentId, title: w.title });
    for (const child of w.children) await createWanted(folder.id, child);
  } else {
    await chrome.bookmarks.create({ parentId, title: w.title, url: w.url });
  }
}
