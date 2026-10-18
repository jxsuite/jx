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

import { isNumber, isString } from "@jxsuite/schema/guards";
import { fileToRoute, isRoutedPageFile } from "@jxsuite/site/routes";
import {
  canonicalizeLocale,
  localeOfPath,
  resolveI18n,
  servedLocaleOfPath,
} from "@jxsuite/schema/locale";
import { getPlatform, hasPlatform } from "../platform";
import { projectState } from "../store";
import { pagePathsDef } from "../page-params";
import type { FormatFrontmatter } from "../format/format-host";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import type { EntryFields } from "./entry-fields";
import type { DirEntry } from "../types";

/** What a page under `pages/` says about collections and layouts. */
export interface PageFacts {
  /** The collection its `$paths` expands over, or `null` for a page of its own. */
  contentType: string | null;
  /** The route parameter an entry fills (`slug`), when `$paths` names one. */
  param: string | null;
  /** The entry field that fills it (`sku`), when `$paths` names one other than `id`. */
  field: string | null;
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
  /** The entry field the parameter is read from, as {@link PageFacts.field}. */
  field: string | null;
  /** The page's `$layout`, as {@link PageFacts.layout}. */
  layout: string | false | undefined;
  /**
   * The language the page is served in (`pages/ar/exhibitions/[slug].json` → `ar`), or `null` in a
   * project without `i18n` and for a page outside every locale tree.
   */
  locale: string | null;
}

/** The facts a page document states, from its parsed tree and (for a format page) frontmatter. */
export function pageFactsOf(
  document: JxMutableNode | null,
  frontmatter: FormatFrontmatter | null,
): PageFacts {
  const paths = pagePathsDef({ document, frontmatter });
  let contentType: string | null = null;
  let param: string | null = null;
  let field: string | null = null;
  if (paths && !Array.isArray(paths) && "contentType" in paths) {
    const type = paths.contentType;
    contentType = isString(type) && type !== "" ? type : null;
    const named = "param" in paths ? paths.param : undefined;
    param = isString(named) && named !== "" ? named : null;
    const from = "field" in paths ? paths.field : undefined;
    field = isString(from) && from !== "" && from !== "id" ? from : null;
  }
  const own = document?.$layout ?? frontmatter?.$layout;
  const layout = isString(own) || own === false ? own : undefined;
  return { contentType, field, layout, param };
}

/**
 * Read one page's facts from disk. A file that cannot be read or parsed states none.
 *
 * @param path - Project-relative page path.
 */
export async function readPageFacts(path: string): Promise<PageFacts> {
  const none: PageFacts = { contentType: null, field: null, layout: undefined, param: null };
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

/** Every template page of each collection, in path order. A multilingual site has one per language. */
type CollectionPageIndex = Map<string, CollectionPage[]>;

let _index: CollectionPageIndex | null = null;
let _loading: Promise<CollectionPageIndex> | null = null;
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
async function readIndex(): Promise<CollectionPageIndex> {
  const files: string[] = [];
  await listPages("pages", files);
  /* Only routed pages: an underscore-prefixed file or folder is private to its directory and
     publishes nothing, and it would otherwise win the path-order tie below (`_` sorts first). */
  const dynamic = files.filter((path) => path.includes("[") && isRoutedPageFile(path)).toSorted();
  const facts = await Promise.all(
    dynamic.map(async (path) => [path, await readPageFacts(path)] as const),
  );
  const { i18n } = resolveI18n(projectState?.projectConfig ?? {});
  const index: CollectionPageIndex = new Map();
  for (const [path, fact] of facts) {
    if (fact.contentType) {
      const page: CollectionPage = {
        field: fact.field,
        layout: fact.layout,
        locale: servedLocaleOfPath(path, i18n),
        param: fact.param,
        path,
        pattern: fileToRoute(path).urlPattern,
      };
      index.set(fact.contentType, [...(index.get(fact.contentType) ?? []), page]);
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
export function collectionPages(): Promise<CollectionPageIndex> {
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
 * The one of a collection's template pages that serves `locale`.
 *
 * A multilingual site gives a collection one template page per language
 * (`pages/exhibitions/[slug].json`, `pages/ar/exhibitions/[slug].json`, …), and "the" page is the
 * one in the language asked about: an Arabic entry is drawn in the Arabic page's layout, and the
 * header for the English view names the English URL. With no language asked, or none of the pages
 * in it, the answer is the site's default language's page, then a page outside every locale tree,
 * then the first in path order, so two pages over one collection still answer deterministically.
 */
export function pageForLocale(
  pages: readonly CollectionPage[] | undefined,
  locale: string | null | undefined,
): CollectionPage | null {
  if (!pages || pages.length === 0) {
    return null;
  }
  const wanted = canonicalizeLocale(locale);
  const fallback = resolveI18n(projectState?.projectConfig ?? {}).i18n?.defaultLocale ?? null;
  return (
    (wanted === null ? undefined : pages.find((page) => page.locale === wanted)) ??
    (fallback === null ? undefined : pages.find((page) => page.locale === fallback)) ??
    pages.find((page) => page.locale === null) ??
    pages[0]!
  );
}

/** The language a collection entry is written in, read from its path (`content/x/ar/a.md` → `ar`). */
export function entryLocale(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  return localeOfPath(path, resolveI18n(projectState?.projectConfig ?? {}).i18n);
}

/**
 * A collection's template page as the index stands: the page, `null` when the collection has none,
 * or `undefined` while the index has not been read yet (which starts the read).
 *
 * @param locale - The language asked about, as {@link pageForLocale} reads it.
 */
export function peekCollectionPage(
  name: string,
  locale?: string | null,
): CollectionPage | null | undefined {
  if (!_index) {
    void collectionPages();
    return undefined;
  }
  return pageForLocale(_index.get(name), locale);
}

/** A collection's template page for a language, reading the index if it has to. */
export async function collectionPage(
  name: string,
  locale?: string | null,
): Promise<CollectionPage | null> {
  const index = await collectionPages();
  return pageForLocale(index.get(name), locale);
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

/** A field value as a route segment: text or a number, else nothing. */
function segmentOf(value: JxDocumentValue | undefined): string | null {
  if (isString(value) && value !== "") {
    return value;
  }
  return isNumber(value) && Number.isFinite(value) ? String(value) : null;
}

/**
 * The URL one entry opens at, from its collection's page pattern, filled as the build fills it
 * (`Content.resolvePaths`): the page's `$paths.field` read from the entry's fields when it names
 * one (`/products/:sku` with the entry's `sku`), else the entry's id (a JSON entry's `id` field,
 * else its file stem). `null` when the collection has no page.
 *
 * @param fields - The entry's fields (frontmatter, or a JSON entry's root), when the caller has
 *   them.
 */
export function entryUrl(
  page: CollectionPage | null,
  entryPath: string,
  fields?: Readonly<EntryFields> | null,
): string | null {
  if (!page) {
    return null;
  }
  const base = entryPath.split("/").pop() ?? entryPath;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const own = page.field === null ? null : segmentOf(fields?.[page.field]);
  // Only a JSON entry's own `id` names it (the loader's `jsonEntry`); a Markdown entry is its file.
  const named = entryPath.endsWith(".json") ? segmentOf(fields?.id) : null;
  const id = own ?? named ?? stem;
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
