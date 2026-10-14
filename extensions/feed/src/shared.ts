/**
 * The feed model: config normalization, and turning a loaded content entry into a feed item.
 *
 * Pure. Neither serializer touches the project shape or the filesystem — they take items and return
 * text, which is what makes both testable with a literal array.
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { ContentFieldValue, ContentLoaderEntry, JsonValue } from "@jxsuite/schema/types";

/** What a project may declare under one key of the `feed` section. */
export interface FeedConfig {
  collection: string;
  basePath: string;
  title?: string;
  description?: string;
  formats?: ("atom" | "json")[];
  output?: string;
  pageSize?: number;
  archive?: boolean;
  author?: { name?: string; uri?: string; email?: string };
  dateField?: string;
  updatedField?: string;
  contentMode?: "full" | "summary";
  language?: string;
}

export interface NormalizedFeed extends Required<Omit<FeedConfig, "author" | "language">> {
  author: { name?: string; uri?: string; email?: string } | null;
  language: string | null;
}

/** The normalized `feed` section: each declared feed key mapped to its defaults-filled config. */
export type NormalizedFeedConfig = Record<string, NormalizedFeed>;

const DEFAULTS = {
  archive: false,
  contentMode: "summary",
  dateField: "date",
  description: "",
  formats: ["atom", "json"],
  output: "/feed",
  pageSize: 20,
  title: "",
  updatedField: "updated",
} as const;

export function normalizeFeedConfig(section: JsonValue | undefined, siteLanguage?: string) {
  const out: NormalizedFeedConfig = {};
  if (!section || !isNonNullObject(section)) {
    return out;
  }
  for (const [key, raw] of Object.entries(section)) {
    if (!raw || !isNonNullObject(raw)) {
      continue;
    }
    /*
     * SAFETY: `raw` is a non-null JSON object (checked above), and the member types below are the
     * contract of schemas/project.fragment.schema.json, which `jx validate` and the editor enforce.
     * `collection` and `basePath` are read as optional because this normalizer fills defaults for
     * them rather than rejecting their absence; it never re-validates member types.
     */
    const cfg = raw as Partial<FeedConfig>;
    out[key] = {
      archive: cfg.archive ?? DEFAULTS.archive,
      author: cfg.author ?? null,
      basePath: normalizeBasePath(cfg.basePath ?? "/"),
      collection: cfg.collection ?? key,
      contentMode: cfg.contentMode ?? DEFAULTS.contentMode,
      dateField: cfg.dateField ?? DEFAULTS.dateField,
      description: cfg.description ?? DEFAULTS.description,
      formats: cfg.formats ?? [...DEFAULTS.formats],
      language: cfg.language ?? siteLanguage ?? null,
      output: cfg.output ?? DEFAULTS.output,
      pageSize: cfg.pageSize ?? DEFAULTS.pageSize,
      title: cfg.title ?? DEFAULTS.title,
      updatedField: cfg.updatedField ?? DEFAULTS.updatedField,
    };
  }
  return out;
}

function normalizeBasePath(p: string): string {
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.endsWith("/") ? withSlash : `${withSlash}/`;
}

/** One entry, reduced to what both serializers need. */
export interface FeedItem {
  id: string;
  url: string;
  title: string;
  /** RFC 3339, or null when the entry carries no readable date. */
  published: string | null;
  updated: string | null;
  summary: string;
  contentHtml: string | null;
  authorName: string | null;
}

/** Absolute URL for an entry, matching how the route table spells it. */
export function entryUrl(
  siteUrl: string,
  basePath: string,
  id: string,
  trailingSlash: string,
): string {
  const path = trailingSlash === "never" ? `${basePath}${id}` : `${basePath}${id}/`;
  return new URL(path, siteUrl).href;
}

/** RFC 3339 or nothing. A feed date that is not a real timestamp is worse than an absent one. */
function readDate(value: ContentFieldValue | undefined): string | null {
  if (!isString(value) || value === "") {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : null;
}

export function entryToItem(
  entry: ContentLoaderEntry,
  feed: NormalizedFeed,
  siteUrl: string,
  trailingSlash: string,
): FeedItem {
  const { _meta: meta, data } = entry;
  /*
   * An entry of a content type with a `route` already knows its URL: the loader stamped it at
   * `_meta.url`, from the same template the pages and the links were generated from. Only an entry
   * with no route is placed by the feed's own `basePath` + id, which is the older, flat rule.
   */
  const metaUrl = meta?.url;
  const url =
    metaUrl !== undefined && metaUrl.startsWith("/")
      ? new URL(metaUrl, siteUrl).href
      : entryUrl(siteUrl, feed.basePath, entry.id, trailingSlash);
  const published = readDate(data[feed.dateField]) ?? readDate(meta?.mtime);
  const { author, description, title } = data;
  // A frontmatter author is either a bare name or an object carrying one (`{ name, uri }`).
  const entryAuthorName = isString(author)
    ? author
    : isNonNullObject(author) && "name" in author && isString(author.name)
      ? author.name
      : undefined;

  return {
    authorName: entryAuthorName ?? feed.author?.name ?? null,
    contentHtml: feed.contentMode === "full" ? String(entry.body ?? "") : null,
    id: url,
    published,
    summary: isString(description) ? description : (meta?.excerpt ?? ""),
    title: isString(title) ? title : entry.id,
    updated: readDate(data[feed.updatedField]) ?? published,
    url,
  };
}

/**
 * Newest first, and undated entries last.
 *
 * The dates arrive already normalized to UTC by the parser's coercion pass, which is what makes a
 * plain string comparison chronological rather than accidental.
 */
export function sortItems(items: FeedItem[]): FeedItem[] {
  return [...items].toSorted((a, b) => {
    if (a.published === b.published) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    if (a.published === null) {
      return 1;
    }
    if (b.published === null) {
      return -1;
    }
    return a.published < b.published ? 1 : -1;
  });
}

/** The feed-level `<updated>`: the newest item, never the build time. */
export function feedUpdated(items: readonly FeedItem[]): string | null {
  let newest: string | null = null;
  for (const item of items) {
    const stamp = item.updated ?? item.published;
    if (stamp !== null && (newest === null || stamp > newest)) {
      newest = stamp;
    }
  }
  return newest;
}

/** A feed split for RFC 5005: the subscription page and its archives, oldest archive first. */
export interface FeedPages {
  current: FeedItem[];
  archives: FeedItem[][];
}

/**
 * Split into the subscription page and its archives (RFC 5005 §2).
 *
 * The subscription document carries the newest page; archives are indexed oldest-first, so a reader
 * walking `prev-archive` moves backwards through time.
 *
 * **Chunked from the oldest end, and that is the point.** RFC 5005 §2 says an archive document
 * SHOULD NOT change once published. Chunking from the newest end would reshuffle every boundary
 * each time an entry is added; counting from the oldest means archive 1 keeps its contents forever
 * and only the newest archive — the one still filling — ever changes.
 */
export function paginate(items: readonly FeedItem[], pageSize: number): FeedPages {
  if (items.length <= pageSize) {
    return { archives: [], current: [...items] };
  }
  const current = items.slice(0, pageSize);
  const oldestFirst = items.slice(pageSize).toReversed();
  const archives: FeedItem[][] = [];
  for (let i = 0; i < oldestFirst.length; i += pageSize) {
    // Oldest-first across pages; newest-first within a page, like every other feed document.
    archives.push(oldestFirst.slice(i, i + pageSize).toReversed());
  }
  return { archives, current };
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** `/feed` + `.xml`, and `/feed/archive/2.xml` for an archive page. */
export function feedPath(output: string, ext: string, archiveIndex?: number): string {
  const base = output.startsWith("/") ? output : `/${output}`;
  return archiveIndex === undefined
    ? `${base}.${ext}`
    : `${base}/archive/${archiveIndex + 1}.${ext}`;
}
