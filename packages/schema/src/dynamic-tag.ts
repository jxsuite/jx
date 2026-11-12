/**
 * The structured dynamic tag: the small, closed shape of template expression an editor can show as
 * a named chip and edit through fields, instead of as code (`studio.md` §6.9).
 *
 * A template string (`spec.md` §8.4) holds JavaScript in each `${…}`. Most bindings a site carries
 * are far simpler than JavaScript: a value read from a path, perhaps passed through a named
 * formula, perhaps with a fallback. This module reads exactly that shape and nothing else:
 *
 * ```text
 * tag     := "!"{0,2} pipe ( ws ("??" | "||") ws literal )?
 * pipe    := "state." ident "(" ws pipe ( ws "," ws literal )* ws ")" | path
 * path    := root ( "." ident | "?." ident | "[" key "]" | "?.[" key "]" )*
 * root    := "state" | "item" | "index" | "$map" | "$page" | "$site"
 * key     := string | number
 * literal := a JSON value | a single-quoted string
 * ident   := [A-Za-z_$] [A-Za-z0-9_$]*
 * ws      := white space, optional
 * ```
 *
 * It takes the text INSIDE one `${…}`. Three rules hold it together:
 *
 * - **A strict subset of JavaScript.** Every tag is an expression the template engine already
 *   evaluates, with the meaning JavaScript gives it: `!` binds the pipe, and the fallback applies
 *   to the result. JSON is a subset of JavaScript expressions, and a single-quoted string is
 *   admitted only with the escapes JSON also has (plus `\'`), so a literal's value is the same in
 *   both. The one JSON value refused is an object with a `__proto__` key, which JavaScript reads as
 *   the object's prototype and not as a key.
 * - **Reading never guesses.** Anything outside the grammar (a lambda, a ternary, arithmetic, a
 *   parenthesised operand, a chain of two fallbacks, a call on anything but `state.<name>`, a path
 *   step after a call) is `null`, which a caller shows as a custom expression and keeps verbatim.
 * - **Reading never normalises.** {@link printDynamicTag} of a parsed tag is the input byte for byte
 *   when the input is canonical, and a literal is always printed as it was written (`raw`), so `''`
 *   stays `''` and `{"dateStyle":"long"}` keeps its spacing when another part of the tag is
 *   edited.
 *
 * **White space.** The canonical form has none around the tag, exactly one space on each side of a
 * fallback operator, `, ` between arguments, and none inside the parentheses. The parser also
 * accepts white space in those four places (and only those: none inside a path, after `!`, or
 * before `(`), and the printer writes the canonical form. So a tag whose spacing is not canonical
 * parses, and printing it would respace it. That is why a writer must keep the source of a tag it
 * did not edit: {@link templateSegments} hands every tag back with its verbatim `source`, and a tag
 * is printed only when the user changed it.
 *
 * Browser-safe: no DOM, no Node.
 *
 * @docs framework/concepts/expressions
 */

import { isJsonObject, isNumber, isString, templateExpressions } from "./guards.ts";

import type { JsonValue } from "../types.ts";

/** What a path may start from: page state, the row of a repeater, and the injected context. */
export type DynamicTagRoot = "state" | "item" | "index" | "$map" | "$page" | "$site";

/** Every {@link DynamicTagRoot}, in the order the grammar lists them. */
export const DYNAMIC_TAG_ROOTS: readonly DynamicTagRoot[] = [
  "state",
  "item",
  "index",
  "$map",
  "$page",
  "$site",
];

/**
 * A literal: its value, and the text it was written as. `raw` is what prints, so build one with
 * {@link dynamicTagLiteral} rather than by hand, or the two can disagree.
 */
export interface DynamicTagLiteral {
  readonly value: JsonValue;
  readonly raw: string;
}

/** One step of a path: `.name`, `?.name`, `[key]` or `?.[key]`. */
export type DynamicTagStep =
  | { readonly type: "member"; readonly name: string; readonly optional: boolean }
  | { readonly type: "index"; readonly key: DynamicTagLiteral; readonly optional: boolean };

/** A value read from a root through zero or more steps. */
export interface DynamicTagPath {
  readonly type: "path";
  readonly root: DynamicTagRoot;
  readonly steps: readonly DynamicTagStep[];
}

/** A named formula applied to a pipe: `state.<name>(input, ...args)`. */
export interface DynamicTagCall {
  readonly type: "call";
  readonly name: string;
  readonly input: DynamicTagPipe;
  readonly args: readonly DynamicTagLiteral[];
}

export type DynamicTagPipe = DynamicTagPath | DynamicTagCall;

/** The value a tag yields when its pipe is nullish (`??`) or falsy (`||`). */
export interface DynamicTagFallback {
  readonly operator: "??" | "||";
  readonly value: DynamicTagLiteral;
}

/** One structured tag. */
export interface DynamicTag {
  /** How many `!` precede the pipe: `!x` is "is empty", `!!x` is "is set". */
  readonly negations: 0 | 1 | 2;
  readonly pipe: DynamicTagPipe;
  readonly fallback?: DynamicTagFallback;
}

/** A literal for a value an editor produced, written the way `JSON.stringify` writes it. */
export function dynamicTagLiteral(value: JsonValue): DynamicTagLiteral {
  return { raw: JSON.stringify(value), value };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Where the reader stands in the expression. */
interface Cursor {
  readonly text: string;
  at: number;
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const KEYWORD = /(?:true|false|null)(?![\w$])/y;
const SPACE = /\s*/y;
/** The escapes a single-quoted string may use: JSON's own, and the quote itself. */
const SINGLE_QUOTED_ESCAPES = String.raw`'"\/bfnrtu`;

/** The text a sticky pattern matches at the cursor, which it then passes; `null` for no match. */
function take(cursor: Cursor, pattern: RegExp): string | null {
  pattern.lastIndex = cursor.at;
  const found = pattern.exec(cursor.text);
  if (found === null) {
    return null;
  }
  cursor.at += found[0].length;
  return found[0];
}

/** Pass `token` when it is next, and say whether it was. */
function eat(cursor: Cursor, token: string): boolean {
  if (!cursor.text.startsWith(token, cursor.at)) {
    return false;
  }
  cursor.at += token.length;
  return true;
}

/**
 * Whether a parsed JSON value is one a tag may not carry, at any depth:
 *
 * - An object with a `__proto__` key. It is the one place JSON and a JavaScript object literal part
 *   ways: JSON makes it an ordinary own key, and the literal sets the object's prototype with it
 *   (ECMA-262 Annex B.3.1) and is a SyntaxError when it is written twice.
 * - A number too large to hold (`1e999`), which both languages read as `Infinity`, a value JSON
 *   cannot write back.
 */
function leavesJson(value: JsonValue): boolean {
  if (isNumber(value)) {
    return !Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => leavesJson(item));
  }
  if (!isJsonObject(value)) {
    return false;
  }
  return Object.hasOwn(value, "__proto__") || Object.values(value).some((item) => leavesJson(item));
}

/**
 * `JSON.parse`, with `undefined` for text that is not JSON, and for JSON a tag may not carry
 * ({@link leavesJson}).
 */
function jsonOrUndefined(text: string): JsonValue | undefined {
  try {
    /* SAFETY: `JSON.parse` returns only what JSON can spell, which is `JsonValue`. */
    const value = JSON.parse(text) as JsonValue;
    return leavesJson(value) ? undefined : value;
  } catch {
    return undefined;
  }
}

/** One past the quote that closes the string opening at `start`, or -1 when nothing closes it. */
function stringEnd(text: string, start: number): number {
  const quote = text.charAt(start);
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (char === "\\") {
      at += 1;
    } else if (char === quote) {
      return at + 1;
    }
  }
  return -1;
}

/**
 * One past the bracket that closes the array or object opening at `start`, or -1. Only finds the
 * extent: whether the text is JSON is `JSON.parse`'s verdict.
 */
function compositeEnd(text: string, start: number): number {
  let depth = 0;
  let at = start;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '"') {
      const end = stringEnd(text, at);
      if (end === -1) {
        return -1;
      }
      at = end;
    } else {
      if (char === "[" || char === "{") {
        depth += 1;
      } else if (char === "]" || char === "}") {
        depth -= 1;
        if (depth === 0) {
          return at + 1;
        }
      }
      at += 1;
    }
  }
  return -1;
}

/**
 * The value of a single-quoted string, or `undefined` when it uses an escape JSON has no spelling
 * for (`\x41`, `\0`, a line continuation), which keeps the literal's value identical in both
 * languages.
 */
function singleQuotedValue(raw: string): JsonValue | undefined {
  const body = raw.slice(1, -1);
  let json = "";
  for (let at = 0; at < body.length; at += 1) {
    const char = body.charAt(at);
    if (char === "\\") {
      const escaped = body.charAt(at + 1);
      if (!SINGLE_QUOTED_ESCAPES.includes(escaped)) {
        return undefined;
      }
      json += escaped === "'" ? "'" : `\\${escaped}`;
      at += 1;
    } else {
      json += char === '"' ? String.raw`\"` : char;
    }
  }
  return jsonOrUndefined(`"${json}"`);
}

/** Where the literal starting at `start` ends, by its first character; -1 when it does not. */
function literalEnd(cursor: Cursor): number {
  const start = cursor.at;
  const first = cursor.text.charAt(start);
  if (first === '"' || first === "'") {
    return stringEnd(cursor.text, start);
  }
  if (first === "[" || first === "{") {
    return compositeEnd(cursor.text, start);
  }
  const scalar = take(cursor, NUMBER) ?? take(cursor, KEYWORD);
  cursor.at = start;
  return scalar === null ? -1 : start + scalar.length;
}

function readLiteral(cursor: Cursor): DynamicTagLiteral | null {
  const end = literalEnd(cursor);
  if (end === -1) {
    return null;
  }
  const raw = cursor.text.slice(cursor.at, end);
  const value = raw.startsWith("'") ? singleQuotedValue(raw) : jsonOrUndefined(raw);
  if (value === undefined) {
    return null;
  }
  cursor.at = end;
  return { raw, value };
}

/** The `[key]` after an opening bracket already passed: a string or a number, then `]`. */
function readIndex(cursor: Cursor, optional: boolean): DynamicTagStep | null {
  const key = readLiteral(cursor);
  if (key === null || !(isString(key.value) || isNumber(key.value))) {
    return null;
  }
  return eat(cursor, "]") ? { key, optional, type: "index" } : null;
}

/** The step at the cursor; `undefined` when the path ends here, `null` when it is malformed. */
function readStep(cursor: Cursor): DynamicTagStep | null | undefined {
  const optional = eat(cursor, "?.");
  if (eat(cursor, "[")) {
    return readIndex(cursor, optional);
  }
  if (!optional && !eat(cursor, ".")) {
    return undefined;
  }
  const name = take(cursor, IDENT);
  return name === null ? null : { name, optional, type: "member" };
}

function readPath(cursor: Cursor): DynamicTagPath | null {
  const name = take(cursor, IDENT);
  const root = DYNAMIC_TAG_ROOTS.find((candidate) => candidate === name);
  if (root === undefined) {
    return null;
  }
  const steps: DynamicTagStep[] = [];
  for (;;) {
    const step = readStep(cursor);
    if (step === null) {
      return null;
    }
    if (step === undefined) {
      return { root, steps, type: "path" };
    }
    steps.push(step);
  }
}

/** The rest of a call whose `state.<name>(` is already passed. */
function readCall(cursor: Cursor, name: string): DynamicTagCall | null {
  take(cursor, SPACE);
  const input = readPipe(cursor);
  if (input === null) {
    return null;
  }
  const args: DynamicTagLiteral[] = [];
  for (;;) {
    take(cursor, SPACE);
    if (eat(cursor, ")")) {
      return { args, input, name, type: "call" };
    }
    if (!eat(cursor, ",")) {
      return null;
    }
    take(cursor, SPACE);
    const arg = readLiteral(cursor);
    if (arg === null) {
      return null;
    }
    args.push(arg);
  }
}

function readPipe(cursor: Cursor): DynamicTagPipe | null {
  const start = cursor.at;
  if (eat(cursor, "state.")) {
    const name = take(cursor, IDENT);
    if (name !== null && eat(cursor, "(")) {
      return readCall(cursor, name);
    }
    cursor.at = start;
  }
  return readPath(cursor);
}

function readFallback(cursor: Cursor): DynamicTagFallback | null {
  let operator: DynamicTagFallback["operator"] | null = null;
  if (eat(cursor, "??")) {
    operator = "??";
  } else if (eat(cursor, "||")) {
    operator = "||";
  }
  if (operator === null) {
    return null;
  }
  take(cursor, SPACE);
  const value = readLiteral(cursor);
  return value === null ? null : { operator, value };
}

/**
 * Read the expression inside one `${…}` as a structured tag, or `null` when it is anything else.
 *
 * `null` is not an error: it says the expression is custom code, to be shown as such and stored as
 * it stands. See the module comment for the grammar and for how white space is treated.
 *
 * @param expr The text between the braces, without them.
 */
export function parseDynamicTag(expr: string): DynamicTag | null {
  const cursor: Cursor = { at: 0, text: expr };
  take(cursor, SPACE);
  let negations: DynamicTag["negations"] = 0;
  if (eat(cursor, "!")) {
    negations = eat(cursor, "!") ? 2 : 1;
  }
  const pipe = readPipe(cursor);
  if (pipe === null) {
    return null;
  }
  take(cursor, SPACE);
  if (cursor.at === expr.length) {
    return { negations, pipe };
  }
  const fallback = readFallback(cursor);
  take(cursor, SPACE);
  if (fallback === null || cursor.at !== expr.length) {
    return null;
  }
  return { fallback, negations, pipe };
}

// ─── Writing ─────────────────────────────────────────────────────────────────

function printStep(step: DynamicTagStep): string {
  const optional = step.optional ? "?." : "";
  if (step.type === "index") {
    return `${optional}[${step.key.raw}]`;
  }
  return `${optional || "."}${step.name}`;
}

function printPipe(pipe: DynamicTagPipe): string {
  if (pipe.type === "path") {
    return pipe.root + pipe.steps.map((step) => printStep(step)).join("");
  }
  const args = [printPipe(pipe.input), ...pipe.args.map((arg) => arg.raw)];
  return `state.${pipe.name}(${args.join(", ")})`;
}

/**
 * Write a tag as the expression that goes inside `${…}`, in the canonical form: for a tag read from
 * canonical text and not changed, the text it was read from.
 */
export function printDynamicTag(tag: DynamicTag): string {
  const fallback = tag.fallback ? ` ${tag.fallback.operator} ${tag.fallback.value.raw}` : "";
  return "!".repeat(tag.negations) + printPipe(tag.pipe) + fallback;
}

// ─── Describing ──────────────────────────────────────────────────────────────

/** The path a tag reads: its pipe with every formula call peeled off. */
export function dynamicTagPath(tag: DynamicTag): DynamicTagPath {
  let { pipe } = tag;
  while (pipe.type === "call") {
    pipe = pipe.input;
  }
  return pipe;
}

/** `field` for a tag that prints a value as stored, `format` for one that runs it through a formula. */
export function dynamicTagKind(tag: DynamicTag): "field" | "format" {
  return tag.pipe.type === "call" ? "format" : "field";
}

/** A row and a page are named for what they are, since their root words say little to an author. */
const ROOT_LABELS: Readonly<Record<DynamicTagRoot, string>> = {
  $map: "Item",
  $page: "Page",
  $site: "Site",
  index: "Index",
  item: "Item",
  state: "State",
};

/**
 * Step names that say where a value is kept, not what it is: `entry.data.title` is the title, and
 * `entry.data` is the entry.
 */
const CONTAINER_NAMES = new Set(["data"]);

/** The name a step contributes to a label, or `null` for a numeric index or a container word. */
function stepName(step: DynamicTagStep): string | null {
  const name = step.type === "member" ? step.name : step.key.value;
  if (!isString(name) || CONTAINER_NAMES.has(name)) {
    return null;
  }
  return name;
}

/**
 * A name as words: `featuredImage`, `featured_image`, `featured-image` and `$featuredImage` are all
 * "Featured image". A run of capitals is kept as written (`seoURL` is "Seo URL").
 */
export function humanizeIdentifier(name: string): string {
  const words = name
    .replaceAll(/([a-z\d])([A-Z])/g, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z\d]+/)
    .filter((word) => word !== "")
    .map((word) => (/^[A-Z\d]{2,}$/.test(word) ? word : word.toLowerCase()));
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A short human name for a tag: its last meaningful path segment as words. `$map.item.data.date` is
 * "Date", `state.entry.data` is "Entry", and a path with nothing to name (`$map`, `state[0]`) is
 * named for its root. A caller that knows the content schema's own title for the field prefers
 * that; this is the answer when there is none.
 */
export function dynamicTagLabel(tag: DynamicTag): string {
  const path = dynamicTagPath(tag);
  for (const step of path.steps.toReversed()) {
    const name = stepName(step);
    const label = name === null ? "" : humanizeIdentifier(name);
    if (label !== "") {
      return label;
    }
  }
  return ROOT_LABELS[path.root];
}

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * One run of a template string. `start` and `end` are offsets into the template, and the runs of a
 * template cover it exactly: joining each `text` or `source` in order gives the template back.
 *
 * - `literal`: text between expressions, as written (a `\${` escape is still two characters).
 * - `tag`: a `${…}` whose expression is a structured tag. `source` is the whole `${…}` verbatim.
 * - `custom`: a `${…}` holding any other expression.
 */
export type TemplateSegment =
  | {
      readonly type: "literal";
      readonly start: number;
      readonly end: number;
      readonly text: string;
    }
  | {
      readonly type: "tag";
      readonly start: number;
      readonly end: number;
      readonly source: string;
      readonly expr: string;
      readonly tag: DynamicTag;
    }
  | {
      readonly type: "custom";
      readonly start: number;
      readonly end: number;
      readonly source: string;
      readonly expr: string;
    };

/**
 * A template string as literal text, structured tags and custom expressions, in order. Where each
 * `${…}` ends is {@link templateExpressions}' answer, so this agrees with the engine that evaluates
 * the template. An empty template has no segments.
 *
 * @param template The template string, without the backticks of a literal.
 */
export function templateSegments(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  let at = 0;
  const literalUpTo = (end: number): void => {
    if (end > at) {
      segments.push({ end, start: at, text: template.slice(at, end), type: "literal" });
    }
  };
  for (const { start, end, expr } of templateExpressions(template)) {
    literalUpTo(start);
    const source = template.slice(start, end);
    const tag = parseDynamicTag(expr);
    segments.push(
      tag === null
        ? { end, expr, source, start, type: "custom" }
        : { end, expr, source, start, tag, type: "tag" },
    );
    at = end;
  }
  literalUpTo(template.length);
  return segments;
}
