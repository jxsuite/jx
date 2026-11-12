/**
 * The address a live preview origin runs one component or one layout at, on its own.
 *
 * A page has a route and these do not, so the address is a contract rather than something either
 * side may derive: Studio writes it and a backend that declares `previewSite` answers it
 * (`server.md` §3.4, `studio.md` §10.1). Both read it from here so they cannot disagree.
 *
 * A component's test values travel IN the address, as a `props` query parameter holding a JSON
 * object, so a reload, a live-reload and a retarget all render the same thing with no store kept
 * alive behind them. What an address may make a backend do is the backend's to bound; what this
 * module bounds is its length.
 *
 * @module
 * @docs extending/embedding/platform-adapter
 */

import type { JsonValue } from "./types";

/** What a harness address starts with; the document's project path follows. */
export const HARNESS_ROUTE = "/__jx_live__/harness/";

/**
 * The longest query a harness address carries, in characters as sent.
 *
 * Test values are typed into one small field each, so this is generous, and it sits well under the
 * request line a server will read at all: past that the answer would be a bare 431 with nothing to
 * say why.
 */
export const HARNESS_QUERY_MAX = 8192;

/** A harness address, and whether its test values had to be left out of it. */
export interface HarnessAddress {
  /** The origin-relative address: path, then the `props` query when there is one. */
  path: string;
  /** True when there were test values and their encoded form passed {@link HARNESS_QUERY_MAX}. */
  dropped: boolean;
}

/**
 * The harness address for one document.
 *
 * Each path segment is encoded on its own, so a file name holding `?` or `#` stays part of the path
 * instead of starting a query or a fragment. Values too large for an address are left out rather
 * than truncated: half a JSON object is not a smaller set of values, and the document still runs
 * with its defaults.
 *
 * @param documentPath The document's project path, e.g. `components/user-card.json`.
 * @param props The test values to carry, when the document is a component that has any.
 */
export function harnessAddress(
  documentPath: string,
  props?: Readonly<Record<string, JsonValue>> | null,
): HarnessAddress {
  const route = `${HARNESS_ROUTE}${documentPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  if (!props || Object.keys(props).length === 0) {
    return { dropped: false, path: route };
  }
  const query = `?props=${encodeURIComponent(JSON.stringify(props))}`;
  return query.length > HARNESS_QUERY_MAX
    ? { dropped: true, path: route }
    : { dropped: false, path: `${route}${query}` };
}
