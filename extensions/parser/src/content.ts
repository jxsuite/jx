/**
 * Content.js — ContentCollection and ContentEntry class implementations
 *
 * Provides the $implementation sidecar for ContentCollection.class.json and
 * ContentEntry.class.json. Also exports the pure query functions (evaluateFilterRule,
 * queryContentType, findEntry) used by both the classes and the server endpoint.
 */

import { isNonNullObject, isRef, isString } from "@jxsuite/schema/guards";
import { localeUrlPrefix, resolveI18n } from "@jxsuite/schema/locale";
import type {
  ContentFieldValue,
  JsonObject,
  JsonValue,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { entriesOf } from "./content-data.ts";
import type { ContentSectionData } from "./content-data.ts";
import { parseComparable } from "./dates.ts";
import type { ContentLoaderEntry } from "./types.ts";

/** One filter rule, as `ContentCollection.class.json` declares an item of its `filter` parameter. */
export interface FilterRule {
  field: string;
  op: string;
  value?: ContentFieldValue;
}

/** One sort key, as `ContentCollection.class.json` declares an item of its `sort` parameter. */
export interface SortRule {
  field: string;
  order?: string;
}

/** What {@link queryContentType} narrows a content type by. */
export interface ContentQuery {
  /** Explicit rules, or the `{ field: value }` shorthand that means `==` on every key. */
  filter?: FilterRule[] | JsonObject;
  sort?: SortRule | SortRule[];
  limit?: number;
}

/**
 * The loaded project the runtime hands a content class: the `content` section (the
 * Content.projectData result) under its section key, and the project config.
 */
interface ContentProjectContext {
  content?: ContentSectionData;
  /** The project config, for the i18n routing rules a locale prefix comes from. */
  config?: ProjectConfig | null;
}

interface CollectionConfig {
  contentType?: string;
  filter?: FilterRule[] | JsonObject | null;
  sort?: SortRule | SortRule[] | null;
  limit?: number | null;
  _project?: ContentProjectContext;
}

interface EntryConfig {
  contentType?: string;
  /** An entry id, or a `{ $ref: "#/$params/<name>" }` binding to one of the route's path params. */
  id?: JsonValue;
  field?: string;
  _project?: ContentProjectContext;
  _document?: {
    route?: {
      _pathParams?: Record<string, string>;
      /** The concrete URL of the page being built (`/kb/frappe/bench-operations`). */
      urlPattern?: string;
      /** The language this route serves, when the project declares any (§13.4). */
      locale?: string | null;
    };
  };
}

// ─── Query Functions ────────────────────────────────────────────────────────

/** `Array.prototype.includes`, with a rule that names no value looking for `undefined`. */
function includesValue(
  items: readonly (ContentFieldValue | undefined)[],
  value: ContentFieldValue | undefined,
): boolean {
  return items.includes(value);
}

/**
 * Evaluate a single filter rule against an entry.
 *
 * @param {FilterRule} rule
 * @param {ContentLoaderEntry} entry
 * @returns {boolean}
 */
export function evaluateFilterRule(rule: FilterRule, entry: ContentLoaderEntry) {
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
        return includesValue(actual, rule.value);
      }
      return isString(actual) && actual.includes(String(rule.value ?? ""));
    }
    case "not contains": {
      if (Array.isArray(actual)) {
        return !includesValue(actual, rule.value);
      }
      return isString(actual) && !actual.includes(String(rule.value ?? ""));
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
 * @param {ContentQuery} [query]
 * @returns {ContentLoaderEntry[]} Filtered, sorted, limited entries
 */
export function queryContentType(entries: ContentLoaderEntry[], query: ContentQuery = {}) {
  let result = [...entries];

  // Filter
  if (query.filter) {
    let rules: FilterRule[];
    if (Array.isArray(query.filter)) {
      rules = query.filter;
    } else if (isNonNullObject(query.filter)) {
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
        const aVal = field === "id" ? a.id : (a.data[field] ?? "");
        const bVal = field === "id" ? b.id : (b.data[field] ?? "");
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
  /**
   * Reads `_project.content` through `load` and `materialize`, so a host that loads sections on
   * demand may hand it the section as it is, rather than completing it first (specs/extensions.md
   * §8). A class without this flag gets the whole section, as it always has.
   */
  static projectOnDemand = true;

  config: CollectionConfig;
  /** @param {CollectionConfig} config */
  constructor(config: CollectionConfig) {
    this.config = config;
  }

  async resolve() {
    const { contentType, filter, sort, limit, _project } = this.config;
    const entries = await entriesOf(_project?.content, contentType ?? "");
    if (!entries) {
      return [];
    }
    const query: ContentQuery = {};
    if (filter != null) {
      query.filter = filter;
    }
    if (sort != null) {
      query.sort = sort;
    }
    if (limit != null) {
      query.limit = limit;
    }
    const result = queryContentType(entries, query);
    // Only what is returned needs a body; the query above read frontmatter alone.
    await _project?.content?.materialize?.(result);
    return result;
  }
}

export class ContentEntry {
  /** As {@link ContentCollection.projectOnDemand}: reads the section through `load`. */
  static projectOnDemand = true;

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
    if (!isString(path)) {
      return undefined;
    }
    const { i18n } = resolveI18n(_project?.config ?? {});
    const prefix = localeUrlPrefix(_document?.route?.locale, i18n);
    if (prefix !== "" && (path === prefix || path.startsWith(`${prefix}/`))) {
      path = path.slice(prefix.length);
    }
    return path.replace(/\/+$/, "") || "/";
  }

  async resolve() {
    const found = await this.#find();
    await this.config._project?.content?.materialize?.([found]);
    return found;
  }

  /** The entry this one names, found by frontmatter, route and id alone (its body may be pending). */
  async #find(): Promise<ContentLoaderEntry | null> {
    const { contentType, id, field, _project, _document } = this.config;
    const entries = await entriesOf(_project?.content, contentType ?? "");
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
      localized && isString(wanted)
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
    if (isRef(resolvedId) && resolvedId.$ref.startsWith("#/$params/")) {
      const paramName = resolvedId.$ref.replace("#/$params/", "");
      resolvedId = _document?.route?._pathParams?.[paramName];
    }
    if (!resolvedId) {
      return null;
    }

    if (field && field !== "id") {
      return scoped.find((e: ContentLoaderEntry) => e.data[field] === resolvedId) ?? null;
    }
    // Entry ids are strings, so an id of any other type matches no entry.
    return isString(resolvedId) ? findEntry(scoped, resolvedId) : null;
  }
}
