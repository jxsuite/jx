/**
 * Repeater scope resolution — enumerate the local `item` / `index` / field tokens available when
 * the author inline-edits text INSIDE a repeater (`$prototype: "Array"`) on the design canvas.
 *
 * There is no live `$map` in edit mode: `prepareForEditMode` renders a mapped array as a
 * `repeater-perimeter` wrapping one glyph-ified template instance, so `renderMappedArrayInto`
 * (which sets `child.$map`) never runs. Instead we resolve field names PARENT-SIDE from the
 * repeater's binding + the project's content-type / state schema, keyed off the selected element's
 * document path (which carries a real `"map"` segment — see canvas/path-mapping.ts
 * `classifyRenderNode`).
 *
 * Pure and DOM-free: deps limited to `@jxsuite/schema` guards/types + {@link getNodeAtPath}.
 */

import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import {
  isJsonObject,
  isMappedArray,
  isNonNullObject,
  isRef,
  isString,
} from "@jxsuite/schema/guards";

import type { JxPath } from "../state";
import type {
  JxMappedArray,
  JxMutableNode,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";

/** Cap on how many inferred/declared fields we enumerate (mirrors merge-tags BREADTH_CAP breadth). */
const FIELD_CAP = 50;

/**
 * Find the repeater (`$prototype: "Array"`) that encloses the node at `path`. The stamper rewrites
 * an edit-mode perimeter render path back to `[...P, "map", …]` where `P` is the repeater's own doc
 * path, so an element inside a repeater carries a real-doc path containing a `"map"` segment. We
 * take the LAST `"map"` (innermost repeater wins for nesting) and resolve the node at the prefix
 * before it.
 *
 * @param doc - The tab's document root (`tab.doc.document`).
 * @param path - The selected element's document path.
 * @returns The enclosing `JxMappedArray` node, or `null` when the path is not inside a repeater.
 */
export function findEnclosingRepeater(
  doc: JxMutableNode,
  path: JxPath | null | undefined,
): JxMappedArray | null {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }
  const mapIdx = path.lastIndexOf("map");
  if (mapIdx <= 0) {
    return null;
  }
  const node = getNodeAtPath(doc, path.slice(0, mapIdx));
  return isMappedArray(node) ? node : null;
}

/** Strip a `#/state/<name>` JSON-Pointer ref to its bare state name (null when it is not one). */
function refToStateName(binding: JxMappedArray["items"]): string | null {
  if (!isRef(binding)) {
    return null;
  }
  const { $ref: target } = binding;
  return target.startsWith("#/state/") ? target.slice("#/state/".length) : null;
}

/** Cap + $-filter a field-name list to a stable, author-facing subset. */
function safeFields(names: string[]): string[] {
  return names.filter((k) => !k.startsWith("$")).slice(0, FIELD_CAP);
}

/**
 * Resolve the local scope tokens for text edited inside `arrayNode`. Always leads with `item` and
 * `index`; appends field tokens resolved from the repeater's binding:
 *
 * - **Content collection** — `items` refs a `{ contentType }` state def. Item shape is `{ id, data: {
 *   …fields }, body }`, so fields come from `projectConfig.content[contentType].schema.properties`
 *   and emit as `item.data.<f>` (the `.data.` nesting is LOAD-BEARING — runtime templates use
 *   `${item.data.title}`), plus `item.id` / `item.body`.
 * - **State array** — `items` refs a state def that is an array of objects. Fields come from a
 *   declared `items.properties`, else are inferred from a sample `default[0]`. Emitted FLAT
 *   (`item.<f>`, no `.data.`).
 * - **Inline array** — `items` is a literal array; fields inferred from `items[0]` object keys.
 * - **Fallback** — anything unresolvable yields exactly `["item", "index"]`.
 *
 * @param arrayNode - The repeater node from {@link findEnclosingRepeater}.
 * @param state - The document's `state` definitions (`tab.doc.document.state`).
 * @param projectConfig - Parsed `project.json` (`projectState?.projectConfig`).
 * @returns Token strings, e.g. `["item", "index", "item.id", "item.body", "item.data.title"]`.
 */
export function resolveRepeaterItemFields(
  arrayNode: JxMappedArray,
  state: Readonly<Record<string, JxStateDefinition>> | null | undefined,
  projectConfig: ProjectConfig | null | undefined,
): string[] {
  const base = ["item", "index"];
  const { items } = arrayNode;
  const defs = state ?? {};

  const stateName = refToStateName(items);
  if (stateName) {
    const def = defs[stateName];
    if (isJsonObject(def)) {
      // (a) Content collection — `{ contentType: "<name>" }`. Import-aliased `$prototype` still
      // Matches because we detect on the `contentType` string, not the prototype name.
      if (isString(def.contentType)) {
        /* The `content` section is contributed by an extension and absorbed by the project
           config's index signature, so each level is checked before it is read. */
        const content = projectConfig?.content;
        const ct = isJsonObject(content) ? content[def.contentType] : undefined;
        const ctSchema = isJsonObject(ct) ? ct.schema : undefined;
        const props = isJsonObject(ctSchema) ? ctSchema.properties : undefined;
        const out = [...base, "item.id", "item.body"];
        if (isNonNullObject(props)) {
          for (const f of safeFields(Object.keys(props))) {
            out.push(`item.data.${f}`);
          }
        }
        return out;
      }

      // (b) State array — declared object item-schema, or inferred from a sample default[0].
      const itemsSchema = def.items;
      const declared = isJsonObject(itemsSchema) ? itemsSchema.properties : undefined;
      if (isNonNullObject(declared)) {
        return [...base, ...safeFields(Object.keys(declared)).map((f) => `item.${f}`)];
      }
      const defaults = def.default;
      const sample = Array.isArray(defaults) ? defaults[0] : undefined;
      if (isJsonObject(sample)) {
        return [...base, ...safeFields(Object.keys(sample)).map((f) => `item.${f}`)];
      }
    }
    return base;
  }

  // (c) Inline literal array — infer fields from the first object element.
  if (Array.isArray(items)) {
    const [first] = items;
    if (isJsonObject(first)) {
      return [...base, ...safeFields(Object.keys(first)).map((f) => `item.${f}`)];
    }
  }

  // (d) Fallback — unresolvable binding, primitive/empty items, or missing schema.
  return base;
}
