/**
 * Pure scaffolding helpers — zero node imports so Studio can run them in the browser (the publish
 * flow writes wrangler.jsonc through the PAL) and cloud platforms can seed repos through the Git
 * Data API. generate.ts wraps these with filesystem I/O.
 */

const CF_ADAPTERS = new Set(["cloudflare-pages", "cloudflare-workers"]);

/** A JSON primitive. */
export type JsonPrimitive = string | number | boolean | null;
/** Any value `JSON.parse` can produce, and `JSON.stringify` can write back unchanged. */
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
/** A JSON object: wrangler.jsonc, project.json and connector binding fragments are all one. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** The result of patching a wrangler.jsonc: the new text, and whether it was rewritten at all. */
export interface WranglerPatch {
  content: string;
  patched: boolean;
}

/** A fragment array entry keyed by its `binding` name (`{ binding: "DB", database_id }`). */
interface BindingEntry extends JsonObject {
  binding: string;
}

/** Parse JSON text. Throws the `SyntaxError` `JSON.parse` raises for text that is not JSON. */
export function parseJson(text: string): JsonValue {
  // SAFETY: JSON.parse without a reviver can only build objects, arrays, strings, finite numbers,
  // Booleans and null out of JSON text, which is exactly the JsonValue union.
  return JSON.parse(text) as JsonValue;
}

/** True for a JSON object; false for arrays, primitives, null and a missing value. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBindingEntry(value: JsonValue): value is BindingEntry {
  return isJsonObject(value) && typeof value.binding === "string";
}

/**
 * Parse a wrangler.jsonc that can be patched: undefined when it is comment-bearing JSONC (which
 * `JSON.parse` rejects) or its top level is not an object, so callers leave the file alone.
 */
function parseWranglerObject(text: string): JsonObject | undefined {
  try {
    const parsed = parseJson(text);
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** True when the adapter deploys through wrangler (needs a wrangler.jsonc). */
export function adapterNeedsWrangler(adapter: string | undefined): boolean {
  return Boolean(adapter && CF_ADAPTERS.has(adapter));
}

/**
 * A fresh wrangler.jsonc for the adapter. `name` becomes the Cloudflare project name — when the
 * project has a `build.deploy` block, pass its projectName so the config and the connected Pages
 * project agree.
 */
export function buildWranglerJsonc({ slug, adapter }: { slug: string; adapter: string }): string {
  const compatibilityDate = new Date().toISOString().slice(0, 10);

  // Nodejs_compat: server functions routinely pull in Node-flavored npm packages
  const config =
    adapter === "cloudflare-workers"
      ? {
          assets: { binding: "ASSETS", directory: "./dist" },
          compatibility_date: compatibilityDate,
          compatibility_flags: ["nodejs_compat"],
          main: "./dist/worker.js",
          name: slug,
        }
      : {
          compatibility_date: compatibilityDate,
          compatibility_flags: ["nodejs_compat"],
          name: slug,
          pages_build_output_dir: "./dist",
        };

  return `${JSON.stringify(config, null, "\t")}\n`;
}

/**
 * Deep-merge connector binding fragments into a wrangler.jsonc (plan Part 4a; consumed by `jx db
 * push`). Fragments are the `bindings` connector-capability results — e.g. `{ d1_databases: [{
 * binding, database_id }] }` or `{ hyperdrive: [{ binding, id }] }`.
 *
 * Merge rules: objects merge recursively; arrays whose elements carry a `binding` key are keyed by
 * it (same-binding entries merge, new ones append — user-added keys on an entry survive); other
 * values only land when the user has not set them (user keys are preserved). Unparseable
 * (comment-bearing) JSONC is returned unchanged with `patched: false` rather than risking data
 * loss.
 *
 * @param {string | null} existing - Current wrangler.jsonc content, or null when absent
 * @param {JsonObject[]} fragments - Binding fragments, applied in order
 * @returns {WranglerPatch}
 */
export function applyBindingFragments(
  existing: string | null,
  fragments: JsonObject[],
): WranglerPatch {
  if (fragments.length === 0) {
    return { content: existing ?? "", patched: false };
  }
  let config: JsonObject = {};
  if (existing) {
    const parsed = parseWranglerObject(existing);
    if (parsed === undefined) {
      // Comment-bearing JSONC (or a non-object top level) — leave the user's file alone.
      return { content: existing, patched: false };
    }
    config = parsed;
  }
  for (const fragment of fragments) {
    mergeBindingValue(config, fragment);
  }
  return { content: `${JSON.stringify(config, null, "\t")}\n`, patched: true };
}

/** Recursively merge one fragment object into the target, per the applyBindingFragments rules. */
function mergeBindingValue(target: JsonObject, fragment: JsonObject) {
  for (const [key, incoming] of Object.entries(fragment)) {
    /* A key the target lacks reads as undefined. Spelled out rather than left to
       noUncheckedIndexedAccess, which the inferred program this file is linted in does not set
       (packages/create/tsconfig.json does not include it). */
    const current = key in target ? target[key] : undefined;
    if (Array.isArray(incoming)) {
      target[key] = mergeBindingArrays(Array.isArray(current) ? current : [], incoming);
      continue;
    }
    if (isJsonObject(incoming)) {
      if (isJsonObject(current)) {
        mergeBindingValue(current, incoming);
      } else if (current === undefined) {
        target[key] = structuredClone(incoming);
      }
      continue;
    }
    if (current === undefined) {
      target[key] = incoming;
    }
  }
}

/** Merge fragment array entries into an existing array, keyed by each entry's `binding`. */
function mergeBindingArrays(current: JsonValue[], incoming: JsonValue[]): JsonValue[] {
  const merged = [...current];
  for (const entry of incoming) {
    if (!isBindingEntry(entry)) {
      // Non-binding-keyed values: append when missing (dedupe by deep equality).
      const exists = merged.some((m) => JSON.stringify(m) === JSON.stringify(entry));
      if (!exists) {
        merged.push(structuredClone(entry));
      }
      continue;
    }
    const index = merged.findIndex((m) => isJsonObject(m) && m.binding === entry.binding);
    // Undefined when no entry matched (index -1), so a miss appends.
    const match = merged[index];
    if (isJsonObject(match)) {
      // Fragment values win for connector-owned keys; user-added extra keys survive.
      merged[index] = { ...match, ...entry };
    } else {
      merged.push(structuredClone(entry));
    }
  }
  return merged;
}

/**
 * Patch an existing wrangler.jsonc for an adapter change (or a Pages project rename), touching only
 * the adapter-shape keys and preserving everything else the user added. Regenerates from scratch
 * when the input is missing or unparseable (wrangler.jsonc supports comments, which JSON.parse does
 * not — a commented config falls back to regeneration rather than data loss... it is returned
 * unchanged with `patched: false` so callers can warn).
 */
export function updateWranglerConfig(
  existing: string | null,
  { slug, adapter }: { slug: string; adapter: string },
): WranglerPatch {
  if (!existing) {
    return { content: buildWranglerJsonc({ adapter, slug }), patched: true };
  }
  const config = parseWranglerObject(existing);
  if (config === undefined) {
    // Comment-bearing JSONC (or a non-object top level) — leave the user's file alone.
    return { content: existing, patched: false };
  }
  config["name"] = slug;
  if (adapter === "cloudflare-workers") {
    delete config["pages_build_output_dir"];
    config["main"] = "./dist/worker.js";
    config["assets"] = { binding: "ASSETS", directory: "./dist" };
  } else {
    delete config["main"];
    delete config["assets"];
    config["pages_build_output_dir"] = "./dist";
  }
  return { content: `${JSON.stringify(config, null, "\t")}\n`, patched: true };
}
