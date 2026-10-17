/**
 * Component metadata, derived from a parsed component document.
 *
 * Discovery — "what components does this project have, and what props do they take" — is a pure
 * function of the document. It reads `tagName`, `state` and any `<slot>` in the tree; it executes
 * nothing. That distinction is what lets a backend with a no-project-JS posture discover JSON
 * components safely, which Jx Cloud could not do while this logic lived inside two Bun servers.
 *
 * It lives here because THREE backends need the same answer and two of them had already written it
 * twice: `packages/server/src/studio-api.ts` (the dev server's `/__studio/components`) and
 * `packages/desktop/src/project-session.ts`. A third copy in the cloud adapter would have made
 * "which entries in `state` count as props" a question with three answers.
 *
 * @license MIT
 */

import { isJsonObject, isNonNullObject, isNumber, isString } from "./guards";
import type { JsonObject, JsonValue } from "../types";

/** One `<slot>` found in a component's tree. */
export interface ComponentSlotDef {
  /** The slot's name; `""` for the unnamed slot. */
  name: string;
  /** Fallback children rendered when nothing is slotted in. */
  fallback?: JsonValue[];
}

/** One editable prop, derived from a `state` entry. */
export interface ComponentPropDef {
  name: string;
  type?: unknown;
  /** Absent for a full-form entry that declares no `default`. */
  default?: JsonValue | undefined;
  format?: unknown;
}

/** What discovery reports for one component document. */
export interface ComponentMetaOut {
  tagName: string;
  $id: string | null;
  path: string;
  props: ComponentPropDef[];
  slots?: ComponentSlotDef[];
  hasElements: boolean;
  /**
   * The custom-element tags its own tree renders, sorted; absent when there are none. A component
   * written against the project's other components by bare `tagName` declares no `$elements`, so
   * this is how a live renderer learns what one instance pulls in without fetching the definition.
   */
  uses?: string[];
}

/**
 * Collect slot definitions from a parsed component tree.
 *
 * Whitespace-only names count as unnamed (`""`), and only static `children` arrays are walked — a
 * slot produced by a `$map` or a `$switch` has no fixed identity to report.
 *
 * @param {JsonValue | undefined} node - A node of the component document.
 * @param {ComponentSlotDef[]} [out] - Accumulator, for the recursive walk.
 * @returns {ComponentSlotDef[]}
 */
export function collectSlotDefs(
  node: JsonValue | undefined,
  out: ComponentSlotDef[] = [],
): ComponentSlotDef[] {
  if (!isJsonObject(node)) {
    return out;
  }
  const { children } = node;
  if (node.tagName === "slot") {
    const attrs = node.attributes;
    const rawName = isJsonObject(attrs) ? attrs.name : undefined;
    const slot: ComponentSlotDef = { name: isString(rawName) ? rawName.trim() : "" };
    if (Array.isArray(children) && children.length > 0) {
      slot.fallback = children;
    }
    out.push(slot);
  }
  if (Array.isArray(children)) {
    for (const c of children) {
      collectSlotDefs(c, out);
    }
  }
  return out;
}

/**
 * Every custom-element tag (a `tagName` with a hyphen) in a document tree, its root excluded.
 *
 * Walks every place a node can sit — `children`, a repeater's `map`, a `$switch`'s `cases` — since
 * an instance rendered through any of them still needs its definition registered.
 *
 * @param {JsonValue | undefined} node - The document, or a node of it.
 * @param {Set<string>} [out] - Accumulator, for the recursive walk.
 * @returns {Set<string>}
 */
export function collectUsedTags(node: JsonValue | undefined, out = new Set<string>()): Set<string> {
  if (!isJsonObject(node)) {
    return out;
  }
  const visit = (child: JsonValue | undefined) => {
    if (isJsonObject(child)) {
      if (isString(child.tagName) && child.tagName.includes("-")) {
        out.add(child.tagName);
      }
      collectUsedTags(child, out);
    }
  };
  const { cases, children, map } = node;
  const nodes = [...(Array.isArray(children) ? children : [children]), map];
  if (isJsonObject(cases)) {
    nodes.push(...Object.values(cases));
  }
  for (const child of nodes) {
    visit(child);
  }
  return out;
}

/** What `typeof` names a shorthand `state` entry's value: the only type a shorthand has on offer. */
function shorthandTypeName(value: string | number | boolean): "string" | "number" | "boolean" {
  if (isString(value)) {
    return "string";
  }
  return isNumber(value) ? "number" : "boolean";
}

/**
 * The editable prop a `state` entry offers, or null when it is not one.
 *
 * The shorthand form (`"title": "Hello"`) always is. The full form is one only when it is plain
 * data: a computed value, a handler or a prototype entry is machinery the author does not type
 * into, and offering it as a prop would put a text box in front of a function.
 *
 * @param {string} name - The `state` key.
 * @param {JsonValue} def - The `state` entry.
 * @returns {ComponentPropDef | null}
 */
function propFrom(name: string, def: JsonValue): ComponentPropDef | null {
  if (def == null) {
    return null;
  }
  if (!isNonNullObject(def)) {
    // Shorthand: the value IS the default, and its runtime type is the only type on offer.
    return { default: def, name, type: shorthandTypeName(def) };
  }
  // An array entry declares nothing, so it reads as a full-form entry with every field absent.
  const fields: JsonObject = isJsonObject(def) ? def : {};
  if (fields.$prototype || fields.$handler || fields.$compute) {
    return null;
  }
  return {
    default: fields.default,
    format: fields.format,
    name,
    type: fields.type,
  };
}

/**
 * Metadata for one component document, or null when the document is not a component.
 *
 * A component is a document whose `tagName` is a valid custom-element name — it must contain a
 * hyphen. That single test is what keeps a page or a data file from being reported as a component
 * when a whole project tree is scanned.
 *
 * @param {JsonValue | undefined} doc - The parsed document.
 * @param {string} path - Project-relative path, reported verbatim.
 * @returns {ComponentMetaOut | null}
 */
export function componentMetaFrom(
  doc: JsonValue | undefined,
  path: string,
): ComponentMetaOut | null {
  if (!isJsonObject(doc)) {
    return null;
  }
  const { tagName } = doc;
  if (!isString(tagName) || !tagName.includes("-")) {
    return null;
  }
  const slots = collectSlotDefs(doc);
  /*
   * `state` is read the way `Object.entries` reads whatever is there: a malformed array or string
   * yields its members, and a scalar or a missing entry yields nothing.
   */
  const declared = doc.state;
  const state =
    isJsonObject(declared) || Array.isArray(declared) || isString(declared)
      ? Object.entries(declared)
      : [];
  // Everything before `tagName`, so `slots` lands where it always has in the serialized order.
  const meta: Omit<ComponentMetaOut, "tagName"> = {
    $id: isString(doc.$id) && doc.$id ? doc.$id : null,
    hasElements: Array.isArray(doc.$elements) && doc.$elements.length > 0,
    path,
    props: state.flatMap(([name, def]) => {
      const prop = propFrom(name, def);
      return prop === null ? [] : [prop];
    }),
  };
  if (slots.length > 0) {
    meta.slots = slots;
  }
  const uses = [...collectUsedTags(doc)].filter((tag) => tag !== tagName).toSorted();
  if (uses.length > 0) {
    meta.uses = uses;
  }
  return { ...meta, tagName };
}
