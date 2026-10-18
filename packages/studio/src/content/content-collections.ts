/**
 * The collections the Content workspace lists: a built-in **Pages** collection, then every
 * collection `project.json` declares, in declaration order (`specs/studio.md` §9.1.2, §22.5).
 *
 * One answer to "which collection is this file in", and it is `content/collection-match.ts`'s. A
 * routed file under `pages/` is a page; any other file is in the collection `collectionForFile`
 * names, or in none. The Library this replaces had a third matcher (`contentTypeFor`, a source
 * prefix test) and folder categories beside it, and the two disagreed about the same entry; both
 * are gone, and nothing here guesses from a folder name.
 *
 * Pure over the open project's configuration: no DOM, no platform, so the commands that name a
 * collection can build their `enum` in a bare Bun process.
 *
 * @docs studio/projects/browse
 */

import { isRoutedPageFile } from "@jxsuite/site/routes";
import { projectState } from "../store";
import { MEDIA_EXTENSIONS, extensionOf } from "../files/media-types";
import { collectionForFile } from "./collection-match";
import type { ContentSectionEntry } from "../types";
import type { ContentTypeSchema } from "@jxsuite/schema/types";

/**
 * Collection names whose singular is the word itself. The suffix rules below would make `news` a
 * `new`, `series` a `sery` and `species` a `specy`, and the result is visible copy ("New new").
 */
const INVARIANT_NOUNS = new Set(["data", "media", "metadata", "news", "series", "species"]);

/** A collection's item, said in the singular: `recipes` → `recipe`, `stories` → `story`. */
export function itemNoun(collection: string): string {
  if (INVARIANT_NOUNS.has(collection.toLowerCase())) {
    return collection;
  }
  if (/[^aeiou]ies$/.test(collection)) {
    return `${collection.slice(0, -3)}y`;
  }
  // `classes` → `class`, `boxes` → `box`, `matches` → `match`: the plural added `es`.
  if (/(?:ss|x|ch|sh|z)es$/.test(collection)) {
    return collection.slice(0, -2);
  }
  // `status`, `campus`, `analysis`, `glass` are already singular.
  if (/(?:us|is|ss)$/.test(collection)) {
    return collection;
  }
  if (collection.endsWith("s")) {
    return collection.slice(0, -1);
  }
  return collection;
}

/** A word with its first letter in capitals: `posts` → `Posts`. */
export function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * A template or page file's display name, from its file name: `./layouts/post.json` → `Post`,
 * `./layouts/blog-post.json` → `Blog Post`. The one spelling every surface that names a template
 * uses, so the header line, the writing banner and the layout picker never disagree.
 */
export function templateDisplayName(path: string): string {
  const base = path.replaceAll("\\", "/").split("/").pop() ?? path;
  return base
    .replace(/\.[^.]+$/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\b\w/g, (c: string) => c.toUpperCase());
}

/** The key of the built-in collection every site has: the routed files under `pages/`. */
export const PAGES_COLLECTION = "pages";

/** One collection, as the Content workspace names it. */
export interface ContentCollection {
  /** `pages`, or the collection's name in `project.json`. The value every command names. */
  key: string;
  /** What the heading says: "Pages", or the collection's name capitalised. */
  title: string;
  /** One of its items, in the singular and lower case: "page", "post", "story". */
  item: string;
  /** `pages` for the built-in collection, `collection` for a declared one. */
  kind: "pages" | "collection";
  /** True for a collection whose `source` is one file (a CSV catalogue): its entries are rows. */
  fileBacked: boolean;
}

/** The declared collections, name → entry, in declaration order. */
function contentSection(): Record<string, ContentSectionEntry> {
  /* SAFETY: `content` is the parser extension's section, collection name → entry object; this
     module reads only the optional `source`, and only to ask whether it names one file. */
  return (projectState?.projectConfig?.content ?? {}) as Record<string, ContentSectionEntry>;
}

/** Whether a `source` names a single file rather than a directory. */
function namesFile(source: string | undefined): boolean {
  return source !== undefined && /\.[\da-z]+$/i.test(source.replace(/\/+$/, ""));
}

/** The built-in Pages collection. */
const PAGES: ContentCollection = {
  fileBacked: false,
  item: "page",
  key: PAGES_COLLECTION,
  kind: "pages",
  title: "Pages",
};

/** Every collection the Content workspace lists: Pages first, then the declared ones. */
export function contentCollections(): ContentCollection[] {
  const declared = Object.entries(contentSection()).map(([name, def]): ContentCollection => ({
    fileBacked: namesFile(def.source),
    item: itemNoun(name),
    key: name,
    kind: "collection",
    title: capitalise(name),
  }));
  return [PAGES, ...declared];
}

/** Every collection key, for a command's `enum`: `pages` first, then the declared names. */
export function contentCollectionKeys(): string[] {
  return contentCollections().map((collection) => collection.key);
}

/**
 * The project-relative file a file-backed collection's entries are rows of (`./content/p.csv` →
 * `content/p.csv`), or `null` for a collection whose source is a directory, or none at all.
 */
export function collectionSourceFile(key: string): string | null {
  const source = contentSection()[key]?.source;
  return source !== undefined && namesFile(source) ? source.replace(/^\.\//, "") : null;
}

/** The schema a collection declares, file-backed or not, or `null` for none. */
export function declaredCollectionSchema(key: string): ContentTypeSchema | null {
  return contentSection()[key]?.schema ?? null;
}

/** The collection with this key, or `null` when the project declares none by that name. */
export function contentCollection(key: string): ContentCollection | null {
  return contentCollections().find((collection) => collection.key === key) ?? null;
}

/**
 * The collection a file is in, or `null`.
 *
 * Media files are in none: an image beside an entry is the entry's asset, which the Media workspace
 * lists. A file under `pages/` is a page; any other is `collectionForFile`'s answer.
 */
export function collectionKeyOfPath(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (MEDIA_EXTENSIONS.has(extensionOf(normalized))) {
    return null;
  }
  if (normalized.startsWith("pages/")) {
    // An underscore-prefixed file or folder is a page directory's private part, not a route.
    return isRoutedPageFile(normalized) ? PAGES_COLLECTION : null;
  }
  return collectionForFile(normalized)?.name ?? null;
}

/**
 * Whether an entry is written on the canvas rather than in the form editor.
 *
 * An entry with a body (a Markdown file, or any format with prose) is written on the canvas inside
 * its template's layout (§22.5). A JSON entry IS its fields, with no body to write, and a
 * file-backed collection's entries are rows: both keep the form-only `entry` editor.
 */
export function writesEntryOnCanvas(path: string | null | undefined): boolean {
  if (!path) {
    return false;
  }
  const match = collectionForFile(path);
  if (!match || match.fileBacked) {
    return false;
  }
  const ext = extensionOf(path);
  return ext !== ".json" && ext !== ".csv";
}

/** Which of the Content workspace's three derived caches a batch of file events can make wrong. */
export interface ContentCacheDrops {
  /** The scan the collections are filtered from: only the file SET, so adds, removes and renames. */
  scan: boolean;
  /** The pages that say where each collection is published: any write under `pages/`. */
  pages: boolean;
  /** The titles and statuses the Collections panel lists: any write to a collection's entry. */
  entries: boolean;
}

/**
 * Which Content caches a file-event batch drops.
 *
 * A plain content `change` cannot change which files exist, so it leaves the scan alone; that is
 * every save, Studio's own echoes included, and dropping the scan on each one blanked the
 * Collections panel and re-walked the project after every keystroke-and-save. It can still change a
 * template page's `$paths` (the index) and an entry's title or status (the summaries), so those are
 * dropped by path.
 *
 * @param paths The project-relative paths the batch touched, or `undefined` after a gap, when any
 *   path may have changed.
 * @param structural Whether the batch added, removed or renamed anything.
 */
export function contentCacheDrops(
  paths: readonly string[] | undefined,
  structural: boolean,
): ContentCacheDrops {
  if (paths === undefined || structural) {
    return { entries: true, pages: true, scan: true };
  }
  const normalized = paths.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, ""));
  return {
    entries: normalized.some((path) => {
      const key = collectionKeyOfPath(path);
      return key !== null && key !== PAGES_COLLECTION;
    }),
    pages: normalized.some((path) => path.startsWith("pages/")),
    scan: false,
  };
}
