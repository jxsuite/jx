/**
 * Content.js — ContentCollection and ContentEntry class implementations
 *
 * Provides the $implementation sidecar for ContentCollection.class.json and
 * ContentEntry.class.json. Also exports the pure query functions (evaluateFilterRule,
 * queryContentType, findEntry) used by both the classes and the server endpoint.
 */

import { localeUrlPrefix, resolveI18n } from "@jxsuite/schema/locale";
import type { ProjectConfig } from "@jxsuite/schema/types";
import { parseComparable } from "./dates.ts";
import type { ContentLoaderEntry } from "./types.ts";

interface CollectionConfig {
  contentType?: string;
  filter?: unknown;
  sort?: unknown;
  limit?: number;
  _project?: {
    /** The loaded `content` section (Content.projectData result) under its section key. */
    content?: Map<string, ContentLoaderEntry[]>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

interface EntryConfig {
  contentType?: string;
  id?: unknown;
  field?: string;
  _project?: {
    /** The loaded `content` section (Content.projectData result) under its section key. */
    content?: Map<string, ContentLoaderEntry[]>;
    /** The project config, for the i18n routing rules a locale prefix comes from. */
    config?: ProjectConfig | null;
    [k: string]: unknown;
  };
  _document?: {
    route?: {
      _pathParams?: Record<string, string>;
      /** The concrete URL of the page being built (`/kb/frappe/bench-operations`). */
      urlPattern?: string;
      /** The language this route serves, when the project declares any (§13.4). */
      locale?: string | null;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ─── Query Functions ────────────────────────────────────────────────────────

/**
 * Evaluate a single filter rule against an entry.
 *
 * @param {{ field: string; op: string; value?: unknown }} rule
 * @param {ContentLoaderEntry} entry
 * @returns {boolean}
 */
export function evaluateFilterRule(
  rule: { field: string; op: string; value?: unknown },
  entry: ContentLoaderEntry,
) {
  const actual = rule.field === "id" ? entry.id : entry.data[rule.field];
  switch (rule.op) {
    case "==": {
      return actual === rule.value;
    }
    case "!=": {
      return actual !== rule.value;
    }
    case "empty": {
      return actual == null || actual === "" || (Array.isArray(actual) && actual.length === 0);
    }
    case "not empty": {
      return actual != null && actual !== "" && !(Array.isArray(actual) && actual.length === 0);
    }
    case "contains": {
      if (Array.isArray(actual)) {
        return actual.includes(rule.value);
      }
      return typeof actual === "string" && actual.includes(String(rule.value ?? ""));
    }
    case "not contains": {
      if (Array.isArray(actual)) {
        return !actual.includes(rule.value);
      }
      return typeof actual === "string" && !actual.includes(String(rule.value ?? ""));
    }
    /*
     * `Number()` on both sides made every date comparison false, since NaN compares false against
     * everything. `parseComparable` keeps two normalized dates in string space, where RFC 3339
     * compares chronologically.
     */
    case ">": {
      const [a, b] = parseComparable(actual, rule.value);
      return a > b;
    }
    case "<": {
      const [a, b] = parseComparable(actual, rule.value);
      return a < b;
    }
    case ">=": {
      const [a, b] = parseComparable(actual, rule.value);
      return a >= b;
    }
    case "<=": {
      const [a, b] = parseComparable(actual, rule.value);
      return a <= b;
    }
    default: {
      return true;
    }
  }
}

/**
 * Query a loaded content type with filter, sort, and limit.
 *
 * @param {ContentLoaderEntry[]} entries - Full content type entries
 * @param {{
 *   filter?: Record<string, unknown> | Array<{ field: string; op: string; value?: unknown }>;
 *   sort?: { field: string; order?: string } | Array<{ field: string; order?: string }>;
 *   limit?: number;
 * }} [query]
 * @returns {ContentLoaderEntry[]} Filtered, sorted, limited entries
 */
export function queryContentType(
  entries: ContentLoaderEntry[],
  query: {
    filter?: Record<string, unknown> | { field: string; op: string; value?: unknown }[];
    sort?: { field: string; order?: string } | { field: string; order?: string }[];
    limit?: number;
  } = {},
) {
  let result = [...entries];

  // Filter
  if (query.filter) {
    let rules: { field: string; op: string; value?: unknown }[];
    if (Array.isArray(query.filter)) {
      rules = query.filter;
    } else if (typeof query.filter === "object") {
      rules = Object.entries(query.filter).map(([field, value]) => ({
        field,
        op: "==",
        value,
      }));
    } else {
      rules = [];
    }
    result = result.filter((entry) => rules.every((rule) => evaluateFilterRule(rule, entry)));
  }

  // Sort
  if (query.sort) {
    const sortRules = Array.isArray(query.sort) ? query.sort : [query.sort];
    result.sort((a, b) => {
      for (const { field, order = "asc" } of sortRules) {
        const aVal = field === "id" ? a.id : ((a.data[field] ?? "") as string | number);
        const bVal = field === "id" ? b.id : ((b.data[field] ?? "") as string | number);
        if (aVal < bVal) {
          return order === "asc" ? -1 : 1;
        }
        if (aVal > bVal) {
          return order === "asc" ? 1 : -1;
        }
      }
      return 0;
    });
  }

  // Limit
  if (query.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }

  return result;
}

/**
 * Find a single entry by ID in a content type.
 *
 * @param {ContentLoaderEntry[]} entries - Full content type entries
 * @param {string} id - Entry ID to find
 * @returns {ContentLoaderEntry | null} The matching entry or null
 */
export function findEntry(entries: ContentLoaderEntry[], id: string) {
  return entries.find((e) => e.id === id) ?? null;
}

// ─── Class Implementations ──────────────────────────────────────────────────

export class ContentCollection {
  config: CollectionConfig;
  /** @param {CollectionConfig} config */
  constructor(config: CollectionConfig) {
    this.config = config;
  }

  resolve() {
    const { contentType, filter, sort, limit, _project } = this.config;
    const entries = _project?.content?.get(contentType ?? "");
    if (!entries) {
      return [];
    }
    return queryContentType(entries, {
      ...(filter != null && {
        filter: filter as
          | Record<string, unknown>
          | { field: string; op: string; value?: unknown }[],
      }),
      ...(sort != null && {
        sort: sort as { field: string; order?: string } | { field: string; order?: string }[],
      }),
      ...(limit != null && { limit }),
    });
  }
}

export class ContentEntry {
  config: EntryConfig;
  /** @param {EntryConfig} config */
  constructor(config: EntryConfig) {
    this.config = config;
  }

  /**
   * The route the page being built is at, without its locale prefix or trailing slash: the key an
   * entry of a content type with a `route` is found by when the page names no id.
   */
  #pageRoute(): string | undefined {
    const { _project, _document } = this.config;
    let path = _document?.route?.urlPattern;
    if (typeof path !== "string") {
      return undefined;
    }
    const { i18n } = resolveI18n(_project?.config ?? {});
    const prefix = localeUrlPrefix(_document?.route?.locale, i18n);
    if (prefix !== "" && (path === prefix || path.startsWith(`${prefix}/`))) {
      path = path.slice(prefix.length);
    }
    return path.replace(/\/+$/, "") || "/";
  }

  resolve() {
    const { contentType, id, field, _project, _document } = this.config;
    const entries = _project?.content?.get(contentType ?? "");
    if (!entries) {
      return null;
    }

    /*
     * Scoped to the route's language, exactly as `resolvePaths` scopes an expansion and for the
     * same reason: two translations of one entry share an id (site-architecture.md §13.3), so an
     * unscoped lookup answers with whichever language was loaded first. Under `/fr-ca/…` that is
     * the English copy, rendered on a page whose `<html lang>` and every `hreflang` say French —
     * a defect no error reports and every reader of the other language sees.
     *
     * Applied only when the entries actually carry a locale: an unlocalized collection is not in
     * one language, and filtering it by the route's would empty it.
     */
    const wanted = _document?.route?.locale;
    const localized = entries.some((e: ContentLoaderEntry) => e._meta?.locale !== undefined);
    const scoped =
      localized && typeof wanted === "string"
        ? entries.filter((e: ContentLoaderEntry) => e._meta?.locale === wanted)
        : entries;

    /*
     * A page that names no `id` is bound to the entry its URL belongs to. That is how a content
     * type with a `route` is consumed: `$paths` generated this page FROM that entry's route, so
     * the route is the join, and neither the page nor the template repeats a parameter name.
     */
    if (id === undefined && field === undefined) {
      const route = this.#pageRoute();
      return route === undefined
        ? null
        : (scoped.find((e: ContentLoaderEntry) => e._meta?.route === route) ?? null);
    }

    let resolvedId = id;
    if (
      resolvedId &&
      typeof resolvedId === "object" &&
      (resolvedId as { $ref?: string }).$ref?.startsWith("#/$params/")
    ) {
      const paramName = (resolvedId as { $ref: string }).$ref.replace("#/$params/", "");
      resolvedId = _document?.route?._pathParams?.[paramName];
    }
    if (!resolvedId) {
      return null;
    }

    if (field && field !== "id") {
      return scoped.find((e: ContentLoaderEntry) => e.data[field] === resolvedId) ?? null;
    }
    return findEntry(scoped, resolvedId as string);
  }
}
