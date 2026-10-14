/// <reference lib="dom" />
/**
 * Dynamic route-param helpers for the tab-bar's $params picker.
 *
 * A page like `pages/products/[sku].json` declares its candidate values in a `$paths` block
 * (site-architecture.md §4.3). At build time the compiler expands those into concrete routes
 * (`resolvePathEntries` in `@jxsuite/compiler`); in the studio the same shapes are resolved live so
 * the author can pick one value to render. The chosen values are substituted into the canvas render
 * document (`substitutePreviewParams`), which mirrors what the compiler's context injection
 * produces for the matching built page.
 */

import { documentUrlPattern } from "@jxsuite/site/routes";
import { getPlatform } from "./platform";
import { loadExtensions } from "./format/format-host";
import { isJsonObject, isRef, isString } from "@jxsuite/schema/guards";
import type {
  JsonObject,
  JsonValue,
  JxDocumentValue,
  JxMutableNode,
  JxPathsDef,
  JxStateDefinition,
} from "@jxsuite/schema/types";

/** Param name → candidate values, in `$paths` declaration order. */
export type ParamValues = Record<string, string[]>;

/** One entry of a resolved ContentCollection, as `/__jx_resolve__` serializes it to JSON. */
interface ResolvedContentEntry {
  id?: JsonValue;
  data?: JsonObject;
}

/**
 * Route derivation is `@jxsuite/site/routes`, re-exported so this module stays the studio's one
 * import for everything `$params`.
 *
 * These two used to be written out here, under a docblock admitting they mirrored the compiler's
 * `fileToRoute`. A mirror is a copy that nothing checks, and a route is the worst place to keep
 * one: a disagreement is a page that renders on the canvas and 404s in a browser. The studio cannot
 * import `@jxsuite/compiler` (its graph carries `sharp` and `esbuild`, and this bundles for a
 * browser), so the rules moved down to the package both CAN import.
 */
export { documentUrlPattern, dynamicRouteParams } from "@jxsuite/site/routes";

/**
 * The `$paths` declaration of an open document. JSON pages carry it on the document root;
 * format-class pages (markdown) keep it in the frontmatter.
 *
 * @param {{
 *   document?: JxMutableNode | null;
 *   frontmatter?: Record<string, JxDocumentValue | undefined> | null;
 * }} doc
 * @returns {JxPathsDef | null}
 */
export function pagePathsDef(doc: {
  document?: JxMutableNode | null;
  frontmatter?: Record<string, JxDocumentValue | undefined> | null;
}) {
  const fromDoc = doc.document?.$paths;
  /* SAFETY: frontmatter `$paths` is the format-page form of the root `$paths` block
     (site-architecture.md §4.3). Its only consumer, loadParamValues, re-checks every JxPathsDef
     shape (array, contentType, values, $ref) before reading it and turns any other value into an
     empty result, so an off-shape block degrades to "no candidates" rather than a crash. */
  const fromFrontmatter = doc.frontmatter?.$paths as JxPathsDef | undefined;
  return fromDoc ?? fromFrontmatter ?? null;
}

const valueCache = new Map<string, Promise<ParamValues>>();

/** Drop all cached enumerations (e.g. after content files change). */
export function invalidateParamValues() {
  valueCache.clear();
}

/**
 * Enumerate candidate values for each param declared by a `$paths` block. Results are cached per
 * (documentPath, $paths) pair; failures are not cached so a transient backend error retries on the
 * next call.
 *
 * @param {string | null | undefined} documentPath - Cache key component
 * @param {JxPathsDef | null} pathsDef
 * @returns {Promise<ParamValues>}
 */
export function loadParamValues(
  documentPath: string | null | undefined,
  pathsDef: JxPathsDef | null,
) {
  if (!pathsDef) {
    return Promise.resolve<ParamValues>({});
  }
  const key = `${documentPath ?? ""}::${JSON.stringify(pathsDef)}`;
  let pending = valueCache.get(key);
  if (!pending) {
    pending = resolveParamValues(pathsDef).catch((error): ParamValues => {
      valueCache.delete(key);
      console.warn("page-params: failed to enumerate $paths values:", error);
      return {};
    });
    valueCache.set(key, pending);
  }
  return pending;
}

/**
 * Resolve one `$paths` shape to values, mirroring the compiler's `resolvePathEntries`.
 *
 * @param {JxPathsDef} pathsDef
 * @returns {Promise<ParamValues>}
 */
async function resolveParamValues(pathsDef: JxPathsDef): Promise<ParamValues> {
  // Legacy: array of param objects — group values per param key
  if (Array.isArray(pathsDef)) {
    const out: ParamValues = {};
    for (const entry of pathsDef) {
      for (const [param, value] of Object.entries(entry)) {
        pushValue(out, param, value);
      }
    }
    return out;
  }

  // Content type-based: { contentType: "blog", param: "slug", field: "id" } — an open extension
  // Discriminator member on JxPathsDef, so narrow to string. Resolved through the backend's
  // ContentCollection pipeline (the same one the canvas's ContentEntry uses), so every offered
  // Value is guaranteed to resolve in preview.
  if ("contentType" in pathsDef && isString(pathsDef.contentType) && pathsDef.contentType) {
    const param = pathsDef.param ?? "slug";
    const field = pathsDef.field ?? "id";
    const resolved = await resolveContentCollection(pathsDef.contentType);
    const out = { [param]: [] } satisfies ParamValues;
    if (!Array.isArray(resolved)) {
      return out;
    }
    /* SAFETY: a resolved ContentCollection is its entries array, each `{ id, data }` (the parser's
       ContentLoaderEntry after the JSON hop). Off-shape entries stay harmless: a primitive reads as
       having no id and is skipped, and a null throws on `.id`, which loadParamValues catches and
       degrades to an empty result. */
    const entries = resolved as ResolvedContentEntry[];
    for (const entry of entries) {
      pushValue(out, param, field === "id" ? entry.id : (entry.data?.[field] ?? entry.id));
    }
    return out;
  }

  // Explicit values: { values: ["en", "fr"], param: "lang" }
  if ("values" in pathsDef && Array.isArray(pathsDef.values)) {
    const param = pathsDef.param ?? "value";
    const out = { [param]: [] } satisfies ParamValues;
    for (const value of pathsDef.values) {
      pushValue(out, param, value);
    }
    return out;
  }

  // Data file ref: { "$ref": "./data/products.json", param: "id", field: "sku" } — `$ref` also
  // Reaches here as an open discriminator key, so narrow to a non-empty string.
  if ("$ref" in pathsDef && isString(pathsDef.$ref) && pathsDef.$ref) {
    const param = pathsDef.param ?? "id";
    const field = pathsDef.field ?? "id";
    const content = await getPlatform().readFile(pathsDef.$ref.replace(/^\.\//, ""));
    // SAFETY: JSON.parse only ever produces JSON values.
    const data = JSON.parse(content) as JsonValue;
    const out = { [param]: [] } satisfies ParamValues;
    if (!Array.isArray(data)) {
      return out;
    }
    for (const item of data) {
      pushValue(out, param, isJsonObject(item) ? (item[field] ?? item.id ?? item) : item);
    }
    return out;
  }

  return {};
}

/**
 * The `$src` of the ContentCollection class from the enabled extensions payload — whichever
 * extension's manifest declares a class named `ContentCollection` (its backend-resolved descriptor
 * path feeds `/__jx_resolve__` directly). Platforms without an extensions payload fall back to the
 * historical parser-package specifier.
 *
 * @returns {Promise<string>}
 */
async function contentCollectionSrc(): Promise<string> {
  const extensions = await loadExtensions();
  for (const ext of extensions) {
    const cls = ext.classes?.find((c) => c.name === "ContentCollection");
    if (cls) {
      return cls.path;
    }
  }
  return "@jxsuite/parser/ContentCollection.class.json";
}

/**
 * Resolve a ContentCollection for a content type via the PAL, falling back to a plain dev-proxy
 * fetch on platforms that predate `resolveClass`.
 *
 * @param {string} contentType
 * @returns {Promise<JsonValue>}
 */
async function resolveContentCollection(contentType: string): Promise<JsonValue> {
  const body = {
    $prototype: "ContentCollection",
    $src: await contentCollectionSrc(),
    contentType,
  };
  const platform = getPlatform();
  if (platform.resolveClass) {
    /* SAFETY: resolveClass hands back the backend's parsed `/__jx_resolve__` response, and that
       endpoint answers with a JSON body, so the value is a JSON value. */
    return platform.resolveClass(body) as Promise<JsonValue>;
  }
  return fetch("/__jx_resolve__", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  }).then((res): Promise<JsonValue> => {
    if (!res.ok) {
      throw new Error(`Class resolution failed: ${res.status}`);
    }
    return res.json();
  });
}

/**
 * @param {ParamValues} out
 * @param {string} param
 * @param {JsonValue | undefined} value
 */
function pushValue(out: ParamValues, param: string, value: JsonValue | undefined) {
  if (value === null || value === undefined || value === "") {
    return;
  }
  const str = String(value);
  out[param] ??= [];
  const list = out[param];
  if (!list.includes(str)) {
    list.push(str);
  }
}

/**
 * Substitute chosen param values into a canvas render document:
 *
 * - Every `{ "$ref": "#/$params/<name>" }` value with a chosen `<name>` becomes the literal string
 *   (the exact dereference `ContentEntry.resolve()` performs against `route._pathParams`), and
 * - `state.$page` is injected mirroring the compiler's `injectContext`, so `${state.$page.params.x}`
 *   template expressions render.
 *
 * Pure: returns a rebuilt tree. The design/edit render doc shares node references with the tab's
 * source document (stripEventHandlers/prepareForEditMode shallow-rebuild), so in-place mutation
 * here would corrupt the document being edited and saved.
 *
 * @param {JxMutableNode} renderDoc
 * @param {Record<string, string>} params
 * @param {string | null | undefined} documentPath
 * @returns {JxMutableNode}
 */
export function substitutePreviewParams(
  renderDoc: JxMutableNode,
  params: Record<string, string>,
  documentPath: string | null | undefined,
): JxMutableNode {
  if (Object.keys(params).length === 0) {
    return renderDoc;
  }
  /* SAFETY: a render document is a JSON tree (it reaches the canvas iframe by structured clone and
     is serialized back to disk), so its root is a JSON object; substituteObjectRefs rebuilds it key
     for key, replacing only `$params` ref values with strings, so the copy keeps the node's shape. */
  const doc = substituteObjectRefs(renderDoc as JsonObject, params) as JxMutableNode;
  doc.state ??= {};
  doc.state.$page = {
    params: { ...params },
    title: isString(doc.title) ? doc.title : "",
    url: documentUrlPattern(documentPath),
  };
  return doc;
}

/**
 * State keys whose entries are class prototypes ($prototype + $src) referencing a route param.
 * These are the entries `substitutePreviewParams` rewrites, and the ones `resolveParamBoundState`
 * bakes.
 *
 * @param {Record<string, JxStateDefinition> | null | undefined} state - The ORIGINAL document state
 *   (with `$ref`s intact — substitution removes the marker)
 * @returns {string[]}
 */
export function paramBoundStateKeys(state: Record<string, JxStateDefinition> | null | undefined) {
  if (!state) {
    return [];
  }
  return Object.keys(state).filter((key) => {
    const entry = state[key];
    return (
      isJsonObject(entry) &&
      isString(entry.$prototype) &&
      isString(entry.$src) &&
      JSON.stringify(entry).includes('"#/$params/')
    );
  });
}

/**
 * Resolve substituted class-prototype state entries through the backend and bake the values into
 * `renderDoc.state` — compiler parity: the built site resolves ContentEntry/ContentCollection
 * BEFORE templates run. Without baking, the iframe runtime resolves these entries asynchronously
 * (null on the first render pass), so preview templates like `${state.product.data.title}`
 * dereference null and abort the whole render.
 *
 * Failures leave the entry in place (the runtime's own async resolution remains the fallback).
 *
 * @param {JxMutableNode} renderDoc - The substituted render doc (mutated in place — it is the fresh
 *   rebuild from substitutePreviewParams, never the source doc)
 * @param {string[]} keys - From paramBoundStateKeys(originalDoc.state)
 * @param {string | undefined} docBase - Document base URL for relative-$src rebasing
 */
export async function resolveParamBoundState(
  renderDoc: JxMutableNode,
  keys: string[],
  docBase?: string,
) {
  if (keys.length === 0) {
    return;
  }
  const platform = getPlatform();
  const { resolveClass } = platform;
  if (!resolveClass) {
    return;
  }
  const { state } = renderDoc;
  if (!state) {
    return;
  }
  await Promise.all(
    keys.map(async (key) => {
      /* Keys come from paramBoundStateKeys, which only selects plain-object entries; substitution
         keeps such an entry an object unless the whole entry was a param ref (then a string). */
      const entry = state[key];
      if (!isJsonObject(entry)) {
        return;
      }
      const body = { ...entry };
      if (docBase) {
        body.$base = docBase;
      }
      try {
        /* SAFETY: the backend answers with the class's resolved JSON value (no `$prototype`), which
           the runtime reads as a naked-value state entry, so it is a JxStateDefinition. */
        state[key] = (await resolveClass.call(platform, body)) as JxStateDefinition;
      } catch (error) {
        console.warn(`page-params: failed to resolve state.${key} for preview:`, error);
      }
    }),
  );
}

/**
 * @param {JsonValue} node
 * @param {Record<string, string>} params
 * @returns {JsonValue} — a rebuilt copy with matched param refs replaced by literals
 */
function substituteParamRefs(node: JsonValue, params: Record<string, string>): JsonValue {
  const replaced = paramRefValue(node, params);
  if (replaced !== null) {
    return replaced;
  }
  if (Array.isArray(node)) {
    return node.map((item) => substituteParamRefs(item, params));
  }
  return isJsonObject(node) ? substituteObjectRefs(node, params) : node;
}

/**
 * @param {JsonObject} node
 * @param {Record<string, string>} params
 * @returns {JsonObject} — a rebuilt copy of every member, param refs replaced by literals
 */
function substituteObjectRefs(node: JsonObject, params: Record<string, string>): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = substituteParamRefs(value, params);
  }
  return out;
}

/**
 * The chosen literal for a `{ "$ref": "#/$params/<name>" }` value, or null when the value is not a
 * param ref (or no value was chosen for it).
 *
 * @param {JsonValue} value
 * @param {Record<string, string>} params
 * @returns {string | null}
 */
function paramRefValue(value: JsonValue, params: Record<string, string>) {
  if (!isRef(value) || !value.$ref.startsWith("#/$params/")) {
    return null;
  }
  return params[value.$ref.slice("#/$params/".length)] ?? null;
}
