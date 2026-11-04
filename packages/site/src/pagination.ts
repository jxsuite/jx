/**
 * Paging a list into numbered routes (site-architecture.md §4.3).
 *
 * A page whose `$paths` is a `paginate` source is built once per `pageSize` items of a list in its
 * own `state`, each page with the list replaced by its slice and with `$page.pagination` beside it.
 * The arithmetic lives here, with no platform imports, so the build and any host that renders a
 * paged route (Studio's canvas) count pages, cut slices and spell pager URLs the same way.
 *
 * @docs framework/site/routing
 */

import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxPathsDef } from "@jxsuite/schema/types";

/** A `$paths` that pages a list: which state entry, how many items to a page, and over what. */
export interface PagedSource {
  /** The key of the paged entry in the page's own `state`. */
  key: string;
  pageSize: number;
  /**
   * The `$paths` source of the route's other parameter, when the list is paged once per value of it
   * (a paged archive per tag). Absent when the page number is the route's only parameter.
   */
  each?: JsonObject | JsonValue[];
}

/** One page of a paged list, as a numbered pager renders it. */
export interface PageLink {
  number: number;
  url: string;
  current: boolean;
}

/** `$page.pagination`: where this page sits in its list. */
export interface PagePagination {
  /** This page's number, from 1. */
  number: number;
  pageCount: number;
  pageSize: number;
  /** Items in the whole list, every page together. */
  itemCount: number;
  first: string;
  prev: string | null;
  next: string | null;
  last: string;
  pages: PageLink[];
}

const STATE_POINTER = /^#\/state\/([^/]+)$/;

/**
 * An RFC 6901 reference token as the key it names: `~1` is `/` and `~0` is `~`, in that order, so
 * `~01` stays `~1`.
 */
function unescapeToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * The paged source a `$paths` declares, or null when it declares another shape.
 *
 * @param {JxPathsDef | JsonValue | undefined} paths - A page's `$paths`
 * @returns {PagedSource | null}
 * @throws {TypeError} When `paginate` is present but the source is malformed; the message names the
 *   fault
 */
export function pagedSource(paths: JxPathsDef | JsonValue | undefined): PagedSource | null {
  if (!isJsonObject(paths) || !("paginate" in paths)) {
    return null;
  }
  const { each, pageSize, paginate } = paths;
  const ref = isJsonObject(paginate) ? paginate.$ref : undefined;
  const key = isString(ref) ? STATE_POINTER.exec(ref)?.[1] : undefined;
  if (key === undefined) {
    throw new TypeError('$paths.paginate must be { "$ref": "#/state/<key>" }');
  }
  if (!isNumber(pageSize) || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new TypeError("$paths.pageSize must be a positive integer");
  }
  const source: PagedSource = { key: unescapeToken(key), pageSize };
  if (each !== undefined) {
    if (!isJsonObject(each) && !Array.isArray(each)) {
      throw new TypeError("$paths.each must be a $paths source");
    }
    if (isJsonObject(each) && "paginate" in each) {
      throw new TypeError("$paths.each cannot itself be paged");
    }
    source.each = each;
  }
  return source;
}

/**
 * How many pages a list of `itemCount` items fills: at least one, so an empty list still has its
 * listing page.
 */
export function pageCount(itemCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(itemCount / pageSize));
}

/** The items of page `page` (from 1), and nothing past the end of the list. */
export function pageSlice<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * The URL of page `page` of a route whose page number is its only remaining parameter.
 *
 * A catch-all may be empty, so its first page is the list's own URL (`/blog/*` gives `/blog`, then
 * `/blog/2`); a named parameter is always one segment, so every page is numbered (`/blog/:page`
 * gives `/blog/1`).
 *
 * @param {string} urlPattern - The route's pattern, every parameter but the page one substituted
 * @param {number} page
 * @returns {string}
 */
export function pageUrl(urlPattern: string, page: number): string {
  if (urlPattern.endsWith("*")) {
    if (page === 1) {
      const root = urlPattern.slice(0, -1).replace(/\/$/, "");
      return root === "" ? "/" : root;
    }
    return `${urlPattern.slice(0, -1)}${page}`;
  }
  return urlPattern.replace(/:[^/]+/, String(page));
}

/**
 * `$page.pagination` for page `page` of a list of `itemCount` items.
 *
 * @param {string} urlPattern - As {@link pageUrl} takes it
 * @param {number} page
 * @param {number} pageSize
 * @param {number} itemCount
 * @returns {PagePagination}
 */
export function pagination(
  urlPattern: string,
  page: number,
  pageSize: number,
  itemCount: number,
): PagePagination {
  const count = pageCount(itemCount, pageSize);
  const pages: PageLink[] = [];
  for (let number = 1; number <= count; number++) {
    pages.push({ current: number === page, number, url: pageUrl(urlPattern, number) });
  }
  return {
    first: pageUrl(urlPattern, 1),
    itemCount,
    last: pageUrl(urlPattern, count),
    next: page < count ? pageUrl(urlPattern, page + 1) : null,
    number: page,
    pageCount: count,
    pageSize,
    pages,
    prev: page > 1 ? pageUrl(urlPattern, page - 1) : null,
  };
}
