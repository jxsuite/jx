/**
 * Content-data — how a reader gets entries out of the `content` section's loaded data.
 *
 * The section's data is a map of type name to entries, which the content loader's `ContentStore`
 * may fill on demand (specs/extensions.md §8). This module is the reading side alone, with no Node
 * imports, because `ContentCollection` and `ContentEntry` (content.ts) are bundled on their own and
 * must not pull the loader in with them.
 *
 * @module @jxsuite/parser/content-data
 * @docs extending/extensions/project-sections
 */

import type { ContentLoaderEntry } from "./types.ts";

/**
 * The `content` section's loaded data as a reader sees it: a map of type name to entries. `load`
 * and `materialize` are optional so a plain map (one a host or a test built) reads the same way.
 */
export interface ContentSectionData extends ReadonlyMap<string, ContentLoaderEntry[]> {
  /** One type's entries, loading the type first if it has not been. */
  load?: (name: string) => Promise<ContentLoaderEntry[] | undefined>;
  /** Give these entries (and the entries they relate to) their bodies before they are returned. */
  materialize?: (entries: readonly (ContentLoaderEntry | null | undefined)[]) => Promise<void>;
  /** Load every type and every body, so a synchronous `get` sees the whole section. */
  complete?: () => Promise<void>;
}

/**
 * One type's entries from a section's data, loading the type first when the data loads lazily.
 *
 * @param {ContentSectionData | undefined} data - The section's loaded data
 * @param {string} name - Content type name
 * @returns {Promise<ContentLoaderEntry[] | undefined>} The entries, or undefined for no such type
 */
export async function entriesOf(
  data: ContentSectionData | undefined,
  name: string,
): Promise<ContentLoaderEntry[] | undefined> {
  return (await data?.load?.(name)) ?? data?.get(name);
}
