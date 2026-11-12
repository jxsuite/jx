/**
 * A state value set for the canvas (`canvas.setStateValue`, studio.md §4.5).
 *
 * The editing canvas runs no handler, so a component whose button sets `open` to `true` is only
 * ever seen closed there. A value set for the canvas is the answer: the tab keeps `{ key: value }`,
 * and the render document is built with that value in the entry's place. Nothing is written to the
 * document, so nothing is saved, undone or replicated; it is view state, like the active row.
 *
 * Only a **plain** entry can be set: one that holds a value and nothing that computes or fetches
 * it. A computed entry, an expression, a function and a data source each have their value decided
 * by something else, and setting one would be drawing a page the document cannot produce.
 *
 * @docs studio/logic/data
 */

import { hasSchemaKeywords } from "@jxsuite/runtime";
import { isBoolean, isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";

/** The state entries of a document, as a walker reads them. */
type StateEntries = Readonly<Record<string, JxStateDefinition | undefined>>;

/**
 * Whether a state entry holds a plain value: a literal (a string with no `${…}`, a number, a
 * boolean, `null`, an array, an object of data) or a declared one (`{ type, default }`). The same
 * shapes the runtime reads as a value and not as something to compute (spec.md §5.3).
 */
export function isPlainStateEntry(def: JxStateDefinition | undefined): boolean {
  if (def === undefined) {
    return false;
  }
  if (isString(def)) {
    return !def.includes("${");
  }
  if (!isJsonObject(def)) {
    // A number, a boolean, null or an array.
    return true;
  }
  return !(
    "$prototype" in def ||
    "$expression" in def ||
    "$compute" in def ||
    "$handler" in def ||
    "$src" in def ||
    def.timing === "server"
  );
}

/** The value a plain entry holds in the document: its `default`, or the literal itself. */
export function documentStateValue(def: JxStateDefinition | undefined): JsonValue | undefined {
  if (def === undefined || !isJsonObject(def)) {
    /* SAFETY: a state entry that is not an object is a JSON literal (a string, a number, a boolean,
       null or an array), or absent. */
    return def as JsonValue | undefined;
  }
  if ("default" in def) {
    return def.default;
  }
  // A declaration with no `default` (`{ "type": "string" }`) holds no value of its own.
  return hasSchemaKeywords(def) ? undefined : def;
}

/**
 * `renderDoc` with each set value in its entry's place, or `renderDoc` itself when none applies. A
 * rebuild, never a write: the render document shares its `state` with the tab's own document.
 *
 * Only a key `source` (the tab's own document) declares as a plain entry is applied, so a value
 * left behind by an entry that was since deleted, or turned into a request, does nothing. The value
 * goes in as the entry's `default`, whatever shape the entry had: a bare literal would be read
 * again by the runtime's shape rules, and a string holding `${` would become a template.
 */
export function withStateValues(
  renderDoc: JxMutableNode,
  source: StateEntries | undefined,
  values: Readonly<Record<string, JsonValue | undefined>>,
): JxMutableNode {
  const applied = Object.keys(values).filter((key) => isPlainStateEntry(source?.[key]));
  if (applied.length === 0) {
    return renderDoc;
  }
  const state = { ...renderDoc.state };
  for (const key of applied) {
    const def = source?.[key];
    const value = values[key];
    if (value === undefined) {
      continue;
    }
    // A declared entry keeps what it declares (its `type` decides how an attribute is read).
    const declared = isJsonObject(def) && ("default" in def || hasSchemaKeywords(def)) ? def : {};
    state[key] = { ...declared, default: value };
  }
  return { ...renderDoc, state };
}

/** How the Data panel offers a value for one entry: a closed set to pick from, or free text. */
export interface StateValueControl {
  /** The values to pick from, as text, or null for a text field. */
  choices: string[] | null;
  /** The entry's own value, as the same text. */
  documentText: string;
}

/** `value` as the text a control shows it as: a string as itself, anything else as JSON. */
export function stateValueText(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "";
  }
  return isString(value) ? value : JSON.stringify(value);
}

/** The control for one plain entry: `true`/`false` for a boolean, its `enum`, or text. */
export function stateValueControl(def: JxStateDefinition | undefined): StateValueControl {
  const current = documentStateValue(def);
  const documentText = stateValueText(current);
  if (isJsonObject(def) && Array.isArray(def.enum) && def.enum.length > 0) {
    return { choices: def.enum.map((member) => stateValueText(member)), documentText };
  }
  const declared = isJsonObject(def) ? def.type : undefined;
  if (declared === "boolean" || isBoolean(current)) {
    return { choices: ["true", "false"], documentText };
  }
  return { choices: null, documentText };
}

/**
 * The value a control's text stands for, read as the entry's own kind of value: a number for a
 * numeric entry, a boolean for a boolean one, JSON for a list or a record, and otherwise the text.
 * Text that does not parse as its entry's kind is kept as text, so nothing typed is dropped.
 */
export function parseStateValue(text: string, def: JxStateDefinition | undefined): JsonValue {
  const current = documentStateValue(def);
  const declared = isJsonObject(def) && isString(def.type) ? def.type : null;
  const kind =
    declared ??
    (isNumber(current)
      ? "number"
      : isBoolean(current)
        ? "boolean"
        : current !== null && current !== undefined && !isString(current)
          ? "object"
          : "string");
  if (kind === "boolean") {
    return text === "true";
  }
  if (kind === "number" || kind === "integer") {
    const parsed = Number(text);
    if (text.trim() === "" || Number.isNaN(parsed)) {
      return text;
    }
    return kind === "integer" ? Math.trunc(parsed) : parsed;
  }
  if (kind === "array" || kind === "object") {
    try {
      // SAFETY: whatever `JSON.parse` returns without throwing is a JSON value.
      return JSON.parse(text) as JsonValue;
    } catch {
      return text;
    }
  }
  return text;
}
