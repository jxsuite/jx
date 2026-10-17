/**
 * Which page each collection's entries are published at — read from the pages, never stored.
 *
 * `project.json` records no URL pattern and no template for a collection. The route lives in the
 * template PAGE: a dynamic file under `pages/` whose `$paths.contentType` names the collection
 * (`pages/blog/[slug].json`, `$paths: { contentType: "posts", param: "slug" }`), and the layout an
 * entry is drawn in is that page's `$layout`. A second record of either in `project.json` would be
 * free to disagree with the router, so the Content workspace's header line ("Each post has a page
 * at `/blog/:slug` using Post") and the canvas's entry wrapping (`canvas/canvas-live-render.ts`)
 * both read this index (`specs/studio.md` §22.5).
 *
 * One read per invalidation: a walk of `pages/`, then a parse of each dynamic page, cached until a
 * file event drops it ({@link invalidateCollectionPages}, wired beside the Site panel's index in
 * `studio.ts`). The read never rejects; a page that cannot be read or parsed is a page with no
 * collection.
 *
 * @docs studio/projects/browse
 */

import { isString } from "@jxsuite/schema/guards";
import { fileToRoute, isRoutedPageFile } from "@jxsuite/site/routes";
import { getPlatform, hasPlatform } from "../platform";
import { projectState } from "../store";
import { pagePathsDef } from "../page-params";
import type { FormatFrontmatter } from "../format/format-host";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { DirEntry } from "../types";

/** What a page under `pages/` says about collections and layouts. */
export interface PageFacts {
  /** The collection its `$paths` expands over, or `null` for a page of its own. */
  contentType: string | null;
  /** The route parameter an entry fills (`slug`), when `$paths` names one. */
  param: string | null;
  /** Its `$layout`: a path, `false` (no layout), or `undefined` (the project's default). */
  layout: string | false | undefined;
}

/** A collection's template page. */
export interface CollectionPage {
  /** The page file, project-relative (`pages/blog/[slug].json`). */
  path: string;
  /** Its URL pattern (`/blog/:slug`). */
  pattern: string;
  /** The parameter an entry's id fills, or `null` when the page names none. */
  param: string | null;
  /** The page's `$layout`, as {@link PageFacts.layout}. */
  layout: string | false | undefined;
}

/** The facts a page document states, from its parsed tree and (for a format page) frontmatter. */
export function pageFactsOf(
  document: JxMutableNode | null,
  frontmatter: FormatFrontmatter | null,
): PageFacts {
  const paths = pagePathsDef({ document, frontmatter });
  let contentType: string | null = null;
  let param: string | null = null;
  if (paths && !Array.isArray(paths) && "contentType" in paths) {
    const type = paths.contentType;
    contentType = isString(type) && type !== "" ? type : null;
    const named = "param" in paths ? paths.param : undefined;
    param = isString(named) && named !== "" ? named : null;
  }
  const own = document?.$layout ?? frontmatter?.$layout;
  const layout = isString(own) || own === false ? own : undefined;
  return { contentType, layout, param };
}

/**
 * Read one page's facts from disk. A file that cannot be read or parsed states none.
 *
 * @param path - Project-relative page path.
 */
export async function readPageFacts(path: string): Promise<PageFacts> {
  const none: PageFacts = { contentType: null, layout: undefined, param: null };
  try {
    const source = await getPlatform().readFile(path);
    if (path.endsWith(".json")) {
      /* SAFETY: a `.json` file under `pages/` is a page document by the project layout; a file
         that does not parse throws into the catch below, which is "no facts". */
      return pageFactsOf(JSON.parse(source) as JxMutableNode, null);
    }
    const { parseSourceForPath } = await import("../files/file-ops");
    const parsed = await parseSourceForPath(path, source);
    /* SAFETY: a format class's parser returns its file as a Jx element tree (the format
       contract); `pageFactsOf` reads `$paths` and `$layout` off it and nothing else. */
    return pageFactsOf(parsed.document as JxMutableNode, parsed.frontmatter);
  } catch {
    return none;
  }
}

// ─── The index ───────────────────────────────────────────────────────────────

let _index: Map<string, CollectionPage> | null = null;
let _loading: Promise<Map<string, CollectionPage>> | null = null;
/** Bumped by every invalidation, so a read that started before one cannot land after it. */
let _epoch = 0;
/** Told when a read lands, so a surface showing a stale answer can repaint. */
const _listeners = new Set<() => void>();

/** Every file under `pages/`, recursively. An unreadable directory contributes nothing. */
async function listPages(dir: string, out: string[]): Promise<void> {
  let entries: DirEntry[];
  try {
    entries = await getPlatform().listDirectory(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.type === "directory") {
        await listPages(entry.path, out);
      } else {
        out.push(entry.path);
      }
    }),
  );
}

/** One walk of `pages/`, then the facts of every dynamic page in it. */
async function readIndex(): Promise<Map<string, CollectionPage>> {
  const files: string[] = [];
  await listPages("pages", files);
  /* Only routed pages: an underscore-prefixed file or folder is private to its directory and
     publishes nothing, and it would otherwise win the path-order tie below (`_` sorts first). */
  const dynamic = files.filter((path) => path.includes("[") && isRoutedPageFile(path)).toSorted();
  const facts = await Promise.all(
    dynamic.map(async (path) => [path, await readPageFacts(path)] as const),
  );
  const index = new Map<string, CollectionPage>();
  for (const [path, fact] of facts) {
    // The first page in path order wins, so two pages over one collection answer deterministically.
    if (fact.contentType && !index.has(fact.contentType)) {
      index.set(fact.contentType, {
        layout: fact.layout,
        param: fact.param,
        path,
        pattern: fileToRoute(path).urlPattern,
      });
    }
  }
  return index;
}

/**
 * The index, read once per invalidation.
 *
 * With no platform or no project there is nothing to read, and the answer is an empty map rather
 * than a rejection.
 */
export function collectionPages(): Promise<Map<string, CollectionPage>> {
  if (_index) {
    return Promise.resolve(_index);
  }
  if (!hasPlatform() || !projectState) {
    return Promise.resolve(new Map());
  }
  if (!_loading) {
    const epoch = _epoch;
    _loading = readIndex().then((index) => {
      if (epoch === _epoch) {
        _index = index;
        _loading = null;
        for (const listener of _listeners) {
          listener();
        }
      }
      return index;
    });
  }
  return _loading;
}

/**
 * A collection's template page as the index stands: the page, `null` when the collection has none,
 * or `undefined` while the index has not been read yet (which starts the read).
 */
export function peekCollectionPage(name: string): CollectionPage | null | undefined {
  if (!_index) {
    void collectionPages();
    return undefined;
  }
  return _index.get(name) ?? null;
}

/** A collection's template page, reading the index if it has to. */
export async function collectionPage(name: string): Promise<CollectionPage | null> {
  const index = await collectionPages();
  return index.get(name) ?? null;
}

/** Forget the index. The next read walks `pages/` again. */
export function invalidateCollectionPages(): void {
  _epoch += 1;
  _index = null;
  _loading = null;
}

/** Be told when a read of the index lands. Returns the function that stops it. */
export function onCollectionPagesRead(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * The URL one entry opens at, from its collection's page pattern: `/blog/:slug` with the entry's id
 * (its file stem) for the parameter. `null` when the collection has no page.
 */
export function entryUrl(page: CollectionPage | null, entryPath: string): string | null {
  if (!page) {
    return null;
  }
  const base = entryPath.split("/").pop() ?? entryPath;
  const dot = base.lastIndexOf(".");
  const id = dot > 0 ? base.slice(0, dot) : base;
  if (page.param) {
    return page.pattern.replace(`:${page.param}`, id);
  }
  return page.pattern.replace(/:[A-Za-z_]\w*/, id);
}

/**
 * The layout an entry is drawn in (§22.5): its own `$layout`, else its collection's template page's
 * `$layout`, else the project's `defaults.layout`. `null` when none applies, or when the first of
 * them to speak says `false`.
 */
export function entryLayoutPath(
  own: string | false | undefined,
  page: CollectionPage | null,
): string | null {
  if (own === false) {
    return null;
  }
  if (isString(own) && own !== "") {
    return own;
  }
  if (page?.layout === false) {
    return null;
  }
  if (isString(page?.layout) && page.layout !== "") {
    return page.layout;
  }
  return projectState?.projectConfig?.defaults?.layout ?? null;
}

/** Forget everything — tests, and a project switch. */
export function resetCollectionPages(): void {
  invalidateCollectionPages();
  _listeners.clear();
}
