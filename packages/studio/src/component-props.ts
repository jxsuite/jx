/**
 * Component props — the previewParams mirror for component docs. A non-instantiated component
 * definition renders on the canvas with its state defaults; "test values" let the author pick
 * per-prop values, which are state values set for the canvas (`canvas.setStateValue`,
 * `canvas/state-values.ts`), so templates, dataScope snapshots and live expression previews all see
 * real data, and Open in Browser carries them to the harness.
 *
 * Pure and DOM-free: {@link componentPropEntries} derives the editable prop rows from the doc's
 * state (the same plain-data entries the CEM export publishes as fields).
 */

import type { JsonValue } from "./types";
import type { JsonPrimitive, JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";
import { isNonNullObject, isPrivateStateKey, isString } from "@jxsuite/schema/guards";

/** One editable prop row: the state key and its current default value (undefined = none). */
export interface ComponentPropEntry {
  name: string;
  value: JsonValue | undefined;
}

/** Whether the doc is a component definition (a custom-element root) rather than a page. */
export function isComponentDoc(doc: JxMutableNode | null | undefined): boolean {
  const tagName = doc?.tagName;
  return isString(tagName) && tagName.includes("-");
}

/** The object shapes a state entry can take: every `JxStateDefinition` but a primitive or array. */
type StateEntryObject = Exclude<JxStateDefinition, JsonPrimitive | JsonValue[]>;

/** Whether a state entry is one of its object shapes — a signal, a typed def, a naked object. */
function isStateEntryObject(def: JxStateDefinition | undefined): def is StateEntryObject {
  return isNonNullObject(def) && !Array.isArray(def);
}

/**
 * Classify a state entry as a prop (plain data the CEM export publishes as a field): naked
 * literals/arrays/objects and expanded/typed signal defs — never expressions, computeds, functions,
 * templates, or $prototype data sources (overriding those would clobber behavior, the boundPropKey
 * rule).
 */
function propKind(def: JxStateDefinition | undefined): "literal" | "signal" | null {
  if (def === undefined) {
    return null;
  }
  if (isStateEntryObject(def)) {
    if (def.$expression || def.$compute || def.$prototype || def.$handler) {
      return null;
    }
    // An expanded signal ({default}) or a typed prop def ({type}/schema keywords) seeds through
    // Its `default`; any other plain object is a Shape-1 naked value.
    return "default" in def || "type" in def ? "signal" : "literal";
  }
  // Null, numbers, booleans and arrays are naked literals. Template strings render computed values.
  return isString(def) && def.includes("${") ? null : "literal";
}

/**
 * The component's editable prop entries, derived from the doc's state — non-private plain-data
 * entries with their current default values (the CEM-export "field" subset).
 */
export function componentPropEntries(doc: JxMutableNode | null | undefined): ComponentPropEntry[] {
  const state: Record<string, JxStateDefinition> = doc?.state ?? {};
  const out: ComponentPropEntry[] = [];
  for (const [name, def] of Object.entries(state)) {
    if (isPrivateStateKey(name)) {
      continue; // Private entries are not props (spec.md §5.6).
    }
    const kind = propKind(def);
    if (!kind) {
      continue;
    }
    /* SAFETY: `propKind` refused every behavioral shape (expressions, computeds, `$prototype`
       sources, handlers, template strings), so what is left is the document's plain data: a
       literal entry IS the JSON value, and a signal entry is an object whose `default` is one. */
    const value = kind === "signal" ? (def as { default?: JsonValue }).default : (def as JsonValue);
    out.push({ name, value });
  }
  return out;
}
