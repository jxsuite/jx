/**
 * Table-shared — pure helpers behind the table state classes and their `lower` capability.
 *
 * Everything here is browser-safe string building: /_jx/data URL construction with
 * template-placeholder preservation, `#/$params/` id resolution, and the JS-source emission used by
 * lowered action bodies.
 *
 * Cache-busting convention (`_v`): lowered TableQuery Requests append `_v=${(state._v || 0)}` to
 * their URL, and lowered write actions end with `state._v = (state._v || 0) + 1`. The compiled
 * Request effect re-runs whenever a template-referenced signal changes, so bumping `_v` after a
 * successful write refetches every query on the page — read-after-write without any bespoke runtime
 * machinery.
 */

import { isJsonObject, isNumber, isRef, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/** A `${...}` template span (Jx binding syntax preserved through lowering). */
const TEMPLATE_SPAN = /(\$\{[^}]*\})/;

/**
 * Percent-encode a query value while leaving `${...}` template spans intact, so the runtime's
 * template evaluation still sees them after lowering.
 *
 * @param {string} value
 * @returns {string}
 */
export function encodeQueryValue(value: string): string {
  return value
    .split(TEMPLATE_SPAN)
    .map((part) => (TEMPLATE_SPAN.test(part) ? part : encodeURIComponent(part)))
    .join("");
}

/** The wire-facing query options a TableQuery/TableEntry def may carry. */
export interface TableQueryDef {
  table?: string;
  /** The content filter grammar: a rule array or an equality-object shorthand. */
  filter?: JsonValue;
  /** One `{ field, order }` sort rule or a list of them. */
  sort?: JsonValue;
  limit?: number;
  offset?: number;
  include?: string | string[];
}

/**
 * Build a /_jx/data URL for a query def, preserving template placeholders.
 *
 * @param {TableQueryDef} def
 * @param {{ id?: string; versionParam?: boolean }} [options] - `id` appends a row path segment;
 *   `versionParam` appends the `_v` cache-busting template (lowered Requests only)
 * @returns {string}
 */
export function buildDataUrl(
  def: TableQueryDef,
  options: { id?: string; versionParam?: boolean } = {},
): string {
  const table = def.table ?? "";
  const parts: string[] = [];
  if (def.filter !== undefined && def.filter !== null) {
    parts.push(`filter=${encodeQueryValue(JSON.stringify(def.filter))}`);
  }
  if (def.sort !== undefined && def.sort !== null) {
    parts.push(`sort=${encodeQueryValue(JSON.stringify(def.sort))}`);
  }
  if (isNumber(def.limit)) {
    parts.push(`limit=${def.limit}`);
  }
  if (isNumber(def.offset)) {
    parts.push(`offset=${def.offset}`);
  }
  const include = Array.isArray(def.include) ? def.include.join(",") : def.include;
  if (include) {
    parts.push(`include=${encodeQueryValue(include)}`);
  }
  if (options.versionParam) {
    // Read-after-write: writes bump state._v, re-running the compiled Request effect.
    parts.push("_v=${(state._v || 0)}");
  }
  const path = options.id === undefined ? `/_jx/data/${table}` : `/_jx/data/${table}/${options.id}`;
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}

/**
 * Resolve an id value: `#/$params/<name>` refs read route params, everything else passes through as
 * a string (template placeholders included).
 *
 * @param {JsonValue | undefined} id - The def's id value
 * @param {Record<string, string> | undefined} pathParams - Route params when known
 * @returns {string | undefined}
 */
export function resolveIdValue(
  id: JsonValue | undefined,
  pathParams: Record<string, string> | undefined,
): string | undefined {
  if (id === null || id === undefined) {
    return undefined;
  }
  if (isRef(id) && id.$ref.startsWith("#/$params/")) {
    const param = id.$ref.slice("#/$params/".length);
    return pathParams?.[param];
  }
  if (Array.isArray(id) || isJsonObject(id)) {
    return undefined;
  }
  return String(id);
}

/**
 * Emit the JS source for a literal value inside a lowered Function body. Strings carrying `${...}`
 * become template literals (evaluated against state at runtime); everything else is inlined JSON.
 *
 * @param {JsonValue | undefined} value
 * @returns {string}
 */
export function jsValueSource(value: JsonValue | undefined): string {
  if (isString(value) && value.includes("${")) {
    const escaped = value.replaceAll("\\", String.raw`\\`).replaceAll("`", "\\`");
    return `\`${escaped}\``;
  }
  // JSON.stringify(undefined) yields undefined rather than a string; an absent value inlines null.
  return value === undefined ? "null" : JSON.stringify(value);
}

/** Emit the JS source of an object literal whose values go through {@link jsValueSource}. */
export function jsObjectSource(values: JsonObject | undefined): string {
  if (!values || Object.keys(values).length === 0) {
    return "{}";
  }
  const entries = Object.entries(values).map(
    ([key, value]) => `${JSON.stringify(key)}: ${jsValueSource(value)}`,
  );
  return `{ ${entries.join(", ")} }`;
}
