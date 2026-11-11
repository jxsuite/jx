/**
 * The bridge between the two ways a component says a prop takes one of a closed set of values.
 *
 * A Jx component's state entry declares JSON Schema `enum` (spec.md §5.3); a Custom Elements
 * Manifest declares a union of literals in the member's `type.text`. Studio reads either into one
 * list of choices for the Component Settings select (studio.md §6.1), and the CEM export writes the
 * first as the second, so a component published from Jx carries its choices to any manifest
 * reader.
 *
 * @license MIT
 * @docs studio/design/components
 */

import { isBoolean, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

/** A value a closed set of choices may hold: what a select can offer and give back unchanged. */
export type PropChoice = string | number | boolean;

/** Whether every member of a JSON Schema `enum` is a value a select can offer. */
function isChoiceList(values: readonly JsonValue[]): values is PropChoice[] {
  return values.every((v) => isString(v) || isNumber(v) || isBoolean(v));
}

/** A literal union member, spelled `'a'`, `"a"`, a number or `true`/`false`. */
const LITERAL = String.raw`'[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false`;
const LITERAL_UNION = new RegExp(String.raw`^(?:${LITERAL})(?:\s*\|\s*(?:${LITERAL}))+$`);

/** One member of a literal union, as the value it names. */
function literalValue(member: string): PropChoice {
  if (member.startsWith("'") || member.startsWith('"')) {
    return member.slice(1, -1);
  }
  if (member === "true" || member === "false") {
    return member === "true";
  }
  return Number(member);
}

/**
 * Parse a CEM `type.text` string into a structured descriptor.
 *
 * A union of literals (`'left' | 'center'`, `"sm" | "lg"`, `1 | 2`) is the Custom Elements
 * Manifest's spelling of a closed set, the same set JSON Schema spells `enum`, so it parses to a
 * combobox whose options are the members as the values they name.
 *
 * @param {string | undefined | null} typeText
 * @returns {{ kind: "combobox"; options: PropChoice[] }
 *   | { kind: "boolean" }
 *   | { kind: "number" }
 *   | { kind: "text" }}
 */
export function parseCemType(
  typeText: string | undefined | null,
):
  | { kind: "combobox"; options: PropChoice[] }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "text" } {
  if (!typeText) {
    return { kind: "text" };
  }
  const t = typeText
    .trim()
    .replaceAll(/\s*\|\s*undefined\b/g, "")
    .trim();
  if (t === "boolean") {
    return { kind: "boolean" };
  }
  if (t === "number") {
    return { kind: "number" };
  }
  if (LITERAL_UNION.test(t)) {
    const options = [...t.matchAll(new RegExp(LITERAL, "g"))].map((m) => literalValue(m[0]));
    return { kind: "combobox", options };
  }
  return { kind: "text" };
}

/**
 * The closed set of values a component prop admits, or null when it takes any value.
 *
 * Two sources say the same thing: a Jx component's state entry declares JSON Schema `enum`, which
 * discovery carries as `prop.enum`, and an npm package's manifest declares a literal union in its
 * attribute's `type.text`. The entry's own `enum` wins when a prop carries both.
 *
 * @param {{ enum?: unknown; type?: unknown }} prop - A discovered prop.
 * @returns {PropChoice[] | null}
 */
export function propChoices(prop: { enum?: unknown; type?: unknown }): PropChoice[] | null {
  if (Array.isArray(prop.enum)) {
    /* SAFETY: discovery reads `enum` out of a parsed JSON document, so every member is JSON. */
    const values = prop.enum as JsonValue[];
    return values.length > 0 && isChoiceList(values) ? values : null;
  }
  const parsed = parseCemType(isString(prop.type) ? prop.type : null);
  return parsed.kind === "combobox" ? parsed.options : null;
}
