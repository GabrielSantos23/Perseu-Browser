/** Parsers for other browsers' bookmarks and history. No Node here: the shell runs them too. */
import type { HistoryEntry } from './types';
import type { ImportNode } from './importApply';

/** Bookmarks past this many are left behind: no sidebar can usefully hold more. */
export const MAX_BOOKMARKS = 2000;
/** Folders nested deeper than this are flattened into their parent. */
const MAX_DEPTH = 8;

export interface FirefoxBookmark {
  id: number;
  parent: number;
  /** 1 bookmark, 2 folder, 3 separator. */
  type: number;
  title: string | null;
  guid: string;
  url: string | null;
}

/** The bookmarks bar becomes the top level; "Other" and "Mobile" bookmarks get folders of their own. */
export function chromiumBookmarks(documents: string[]): ImportNode[] {
  const bar: ImportNode[] = [];
  const other: ImportNode[] = [];
  const mobile: ImportNode[] = [];
  for (const json of documents) {
    const roots = JSON.parse(json)?.roots ?? {};
    bar.push(...chromiumChildren(roots.bookmark_bar));
    other.push(...chromiumChildren(roots.other));
    mobile.push(...chromiumChildren(roots.synced));
  }
  return [...bar, folder('Other Bookmarks', other), folder('Mobile Bookmarks', mobile)];
}

export function chromiumChildren(node: any): ImportNode[] {
  return Array.isArray(node?.children) ? node.children.flatMap(chromiumNode) : [];
}

export function chromiumNode(node: any): ImportNode[] {
  if (node?.type === 'url' && typeof node.url === 'string') return [{ kind: 'tab', url: node.url, title: String(node.name || node.url) }];
  if (node?.type === 'folder') return [folder(String(node.name || 'Untitled folder'), chromiumChildren(node))];
  return [];
}

/** The toolbar becomes the top level; the menu, unsorted and mobile roots get folders. Tags are skipped. */
export function firefoxBookmarks(rows: FirefoxBookmark[]): ImportNode[] {
  const children = new Map<number, FirefoxBookmark[]>();
  for (const row of rows) {
    const list = children.get(row.parent) ?? [];
    list.push(row);
    children.set(row.parent, list);
  }
  const nodes = (parent: number): ImportNode[] =>
    (children.get(parent) ?? []).flatMap((row): ImportNode[] => {
      if (row.type === 1 && row.url) return [{ kind: 'tab', url: row.url, title: row.title || row.url }];
      if (row.type === 2) return [folder(row.title || 'Untitled folder', nodes(row.id))];
      return [];
    });
  const root = (guid: string) => {
    const row = rows.find((r) => r.guid === guid);
    return row ? nodes(row.id) : [];
  };
  return [
    ...root('toolbar_____'),
    folder('Bookmarks Menu', root('menu________')),
    folder('Other Bookmarks', root('unfiled_____')),
    folder('Mobile Bookmarks', root('mobile______')),
  ];
}

/**
 * Keeps web bookmarks only, each URL once, drops empty folders and stops at
 * MAX_BOOKMARKS. Shared across a browser's profiles so the cap covers them all.
 */
export function newTidy() {
  const seen = new Set<string>();
  const tidy = {
    skipped: 0,
    get count() {
      return seen.size;
    },
    run(nodes: ImportNode[], depth = 0): ImportNode[] {
      return nodes.flatMap((n): ImportNode[] => {
        if (n.kind === 'tab') {
          if (!/^https?:/i.test(n.url) || seen.has(n.url)) return [];
          if (seen.size >= MAX_BOOKMARKS) {
            tidy.skipped++;
            return [];
          }
          seen.add(n.url);
          return [n];
        }
        if (depth >= MAX_DEPTH) return tidy.run(n.children, depth);
        const children = tidy.run(n.children, depth + 1);
        return children.length ? [{ ...n, children }] : [];
      });
    },
  };
  return tidy;
}

export function folder(name: string, children: ImportNode[]): ImportNode {
  return { kind: 'folder', name, children };
}

/** Databases hand back nulls and odd types; History only wants plain values. */
export function cleanEntry(row: HistoryEntry): HistoryEntry {
  const url = String(row.url ?? '');
  return { url, title: String(row.title || url), visits: Number(row.visits) || 1, lastVisit: Number(row.lastVisit) };
}
