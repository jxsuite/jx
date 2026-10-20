/**
 * What the Content workspace's Pages list says about each page beyond its file: the template it is
 * drawn in, the collection a dynamic page expands over, and whether it is marked a draft
 * (`specs/studio.md` §22.5, the Content-Pages board: Title, URL, Template, Status, Edited).
 *
 * The scan behind the Content home knows each page's FILE; its `$layout`, `$paths` and `draft` are
 * inside it. So this reads each page once, through the same parse the editor uses, and keeps the
 * answer until a file event drops it ({@link invalidatePageSummaries}, wired beside the
 * template-page index in `studio.ts`). The read never rejects: a page that cannot be read states
 * nothing, and is listed by its route alone.
 *
 * @docs studio/projects/browse
 */

import { isNonNullObject } from "@jxsuite/schema/guards";
import { getPlatform, hasPlatform } from "../platform";
import { pageFactsOf } from "./collection-pages";
import { DRAFT_FIELD } from "./draft-state";
import type { FormatFrontmatter } from "../format/format-host";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** One page, as the Pages list states it. */
export interface PageSummary {
  path: string;
  /** Its `$layout`: a path, `false` (no layout), or `undefined` (the project's default). */
  layout: string | false | undefined;
  /** The collection its `$paths` expands over, or `null` for a page of its own. */
  contentType: string | null;
  /** Whether the page carries `draft: true`, the one draft marker a page can have. */
  draft: boolean;
}

/** What a page that could not be read states: nothing. */
function unread(path: string): PageSummary {
  return { contentType: null, draft: false, layout: undefined, path };
}

/** The summary a parsed page states. Exported so the rule is assertable without a platform. */
export function pageSummaryOf(
  path: string,
  document: JxMutableNode | null,
  frontmatter: FormatFrontmatter | null,
): PageSummary {
  const { contentType, layout } = pageFactsOf(document, frontmatter);
  const draft = frontmatter?.[DRAFT_FIELD] === true || document?.[DRAFT_FIELD] === true;
  return { contentType, draft, layout, path };
}

/** Read one page. */
async function readSummary(path: string): Promise<PageSummary> {
  try {
    const source = await getPlatform().readFile(path);
    if (path.endsWith(".json")) {
      const parsed: unknown = JSON.parse(source);
      /* SAFETY: a `.json` file under `pages/` is a page document by the project layout; one that is
         not an object states nothing, which is the branch below. */
      return isNonNullObject(parsed) && !Array.isArray(parsed)
        ? pageSummaryOf(path, parsed as JxMutableNode, null)
        : unread(path);
    }
    const { parseSourceForPath } = await import("../files/file-ops");
    const parsed = await parseSourceForPath(path, source);
    /* SAFETY: a format class's parser returns its file as a Jx element tree (the format contract);
       only `$layout`, `$paths` and `draft` are read off it. */
    return pageSummaryOf(path, parsed.document as JxMutableNode, parsed.frontmatter);
  } catch {
    return unread(path);
  }
}

// ─── The cache ───────────────────────────────────────────────────────────────

/** At most this many pages are read for one list; the rest are listed by route alone. */
export const PAGE_READ_LIMIT = 300;

let _cache: { key: string; pages: Map<string, PageSummary> } | null = null;
let _loading: { key: string; read: Promise<void> } | null = null;
let _epoch = 0;
const _listeners = new Set<() => void>();

/**
 * The pages' summaries as they stand, keyed by path: the map, or `null` while they are being read
 * (which starts the read; listeners are told when it lands).
 *
 * @param paths The page files, in the order the list draws them.
 */
export function peekPageSummaries(
  paths: readonly string[],
): ReadonlyMap<string, PageSummary> | null {
  const key = paths.join("\n");
  if (_cache?.key === key) {
    return _cache.pages;
  }
  if (!hasPlatform()) {
    return new Map(paths.map((path) => [path, unread(path)]));
  }
  if (_loading?.key !== key) {
    const epoch = _epoch;
    const read = Promise.all(paths.slice(0, PAGE_READ_LIMIT).map((path) => readSummary(path))).then(
      (summaries) => {
        if (epoch !== _epoch || _loading?.read !== read) {
          return;
        }
        _loading = null;
        _cache = { key, pages: new Map(summaries.map((summary) => [summary.path, summary])) };
        for (const listener of _listeners) {
          listener();
        }
      },
    );
    _loading = { key, read };
  }
  return null;
}

/** Forget every summary. The next list re-reads its pages. */
export function invalidatePageSummaries(): void {
  _epoch += 1;
  _cache = null;
  _loading = null;
}

/** Be told when a read lands. Returns the function that stops it. */
export function onPageSummariesRead(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
