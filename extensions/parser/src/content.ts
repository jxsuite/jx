/**
 * Content.js — ContentCollection and ContentEntry class implementations
 *
 * Provides the $implementation sidecar for ContentCollection.class.json and
 * ContentEntry.class.json. Also exports the pure query functions (evaluateFilterRule,
 * queryContentType, findEntry) used by both the classes and the server endpoint.
 */

import { isJsonObject, isNonNullObject, isRef, isString } from "@jxsuite/schema/guards";
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
  value?: ContentFieldValue | undefined;
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

/** The route and resolved state of the page a class is resolving for. */
interface DocumentContext {
  route?: {
    _pathParams?: Record<string, string>;
    /** The concrete URL of the page being built (`/kb/frappe/bench-operations`). */
    urlPattern?: string;
    /** The language this route serves, when the project declares any (§13.4). */
    locale?: string | null;
  };
  /** The page's state, its earlier class entries already replaced by what they resolved to. */
  state?: JsonObject;
}

interface CollectionConfig {
  /** One content type, or several whose entries are queried as one list. */
  contentType?: string | string[];
  filter?: FilterRule[] | JsonObject | null;
  sort?: SortRule | SortRule[] | null;
  limit?: number | null;
  _project?: ContentProjectContext;
  _document?: DocumentContext;
}

interface EntryConfig {
  contentType?: string;
  /** An entry id, or a `{ $ref: "#/$params/<name>" }` binding to one of the route's path params. */
  id?: JsonValue;
  field?: string;
  _project?: ContentProjectContext;
  _document?: DocumentContext;
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
 * The value a rule's `field` names on an entry (site-architecture.md §6.4).
 *
 * `id` is the entry's id, and a key of the entry's data is that field, a dotted one included. Any
 * other name with a dot is a path through the data: `terms.category.slug` reads `slug` in each item
 * of `terms.category`. A path that crosses an array collects what it finds in every item, so its
 * value is the list of those values (flattened one level, so a list of lists reads as one list),
 * and `contains` then asks whether any item holds the value. A path that finds nothing is
 * `undefined`.
 *
 * @param {ContentLoaderEntry} entry
 * @param {string} field
 * @returns {ContentFieldValue | undefined}
 */
export function fieldValue(
  entry: ContentLoaderEntry,
  field: string,
): ContentFieldValue | undefined {
  if (field === "id") {
    return entry.id;
  }
  if (!field.includes(".") || Object.hasOwn(entry.data, field)) {
    return entry.data[field];
  }
  /* SAFETY: an entry's data is a record of content values, absent keys aside, and only present
     keys are read from it below. */
  let found: ContentFieldValue[] = [entry.data as Record<string, ContentFieldValue>];
  let crossed = false;
  for (const key of field.split(".")) {
    const next: ContentFieldValue[] = [];
    for (const value of found) {
      const items = Array.isArray(value) ? value : [value];
      crossed ||= Array.isArray(value);
      for (const item of items) {
        if (isNonNullObject(item) && !Array.isArray(item) && Object.hasOwn(item, key)) {
          /* SAFETY: an own key of a content value object is itself a content value. */
          next.push((item as Record<string, ContentFieldValue>)[key] as ContentFieldValue);
        }
      }
    }
    found = next;
  }
  if (!crossed) {
    return found[0];
  }
  return found.flatMap((value) => (Array.isArray(value) ? value : [value]));
}

/**
 * A rule's value with a reference to the page resolved (site-architecture.md §6.4):
 * `#/$params/<name>` is the route's parameter, and `#/state/<pointer>` a JSON Pointer into the
 * page's state as it has resolved so far (an entry declared earlier in `state`). Anything else is
 * the value as written; a reference that finds nothing is `undefined`.
 *
 * @param {ContentFieldValue | undefined} value
 * @param {DocumentContext | undefined} document
 * @returns {ContentFieldValue | undefined}
 */
export function resolveRuleValue(
  value: ContentFieldValue | undefined,
  document: DocumentContext | undefined,
): ContentFieldValue | undefined {
  if (!isRef(value)) {
    return value;
  }
  const ref = value.$ref;
  if (ref.startsWith("#/$params/")) {
    return document?.route?._pathParams?.[ref.slice("#/$params/".length)];
  }
  if (!ref.startsWith("#/state/")) {
    return value;
  }
  let current: JsonValue | undefined = document?.state;
  for (const token of ref.slice("#/state/".length).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(key)) {
      current = current[Number(key)];
    } else if (isJsonObject(current) && Object.hasOwn(current, key)) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * The rules a `filter` declares: explicit rules as written, or the `{ field: value }` shorthand as
 * one `==` rule per key.
 */
function filterRules(filter: FilterRule[] | JsonObject): FilterRule[] {
  if (Array.isArray(filter)) {
    return filter;
  }
  return Object.entries(filter).map(([field, value]) => ({ field, op: "==", value }));
}

/**
 * Evaluate a single filter rule against an entry.
 *
 * @param {FilterRule} rule
 * @param {ContentLoaderEntry} entry
 * @returns {boolean}
 */
export function evaluateFilterRule(rule: FilterRule, entry: ContentLoaderEntry) {
  const actual = fieldValue(entry, rule.field);
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
      // A field with no value contains nothing, so an entry without tags is kept by "not contains".
      if (actual == null) {
        return true;
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
    const rules = isNonNullObject(query.filter) ? filterRules(query.filter) : [];
    result = result.filter((entry) => rules.every((rule) => evaluateFilterRule(rule, entry)));
  }

  // Sort
  if (query.sort) {
    const sortRules = Array.isArray(query.sort) ? query.sort : [query.sort];
    result.sort((a, b) => {
      for (const { field, order = "asc" } of sortRules) {
        const aVal = fieldValue(a, field) ?? "";
        const bVal = fieldValue(b, field) ?? "";
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
    const { contentType, filter, sort, limit, _project, _document } = this.config;
    /* Several types are one list: each type's entries in turn, then filtered, sorted and cut
       together, so a sort interleaves them. A type that does not exist adds nothing. */
    const entries: ContentLoaderEntry[] = [];
    for (const type of Array.isArray(contentType) ? contentType : [contentType ?? ""]) {
      entries.push(...((await entriesOf(_project?.content, type)) ?? []));
    }
    if (entries.length === 0) {
      return [];
    }
    const query: ContentQuery = {};
    if (isNonNullObject(filter)) {
      query.filter = filterRules(filter).map((rule) => ({
        field: rule.field,
        op: rule.op,
        value: resolveRuleValue(rule.value, _document),
      }));
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
