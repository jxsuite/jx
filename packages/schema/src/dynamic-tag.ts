/**
 * The structured dynamic tag: the small, closed shape of template expression an editor can show as
 * a named chip and edit through fields, instead of as code (`studio.md` §6.9).
 *
 * A template string (`spec.md` §8.4) holds JavaScript in each `${…}`. Most bindings a site carries
 * are far simpler than JavaScript: a value read from a path, perhaps passed through a named
 * formula, perhaps with a fallback. This module reads exactly that shape and nothing else:
 *
 * ```text
 * tag     := "!"{0,2} source ( ws op ws source )* ( ws op ws literal )?
 * source  := pipe | "(" ws tag ws ")"
 * op      := "??" | "||"
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
 *   evaluates, with the meaning JavaScript gives it: `!` binds the first source, and each operator
 *   applies to the result of everything before it. One tag uses one operator, since JavaScript
 *   refuses `??` beside `||` unless one of them is parenthesised, and a parenthesised tag is how
 *   the two are combined: `(item.image ?? '') || '/x.jpg'`. JSON is a subset of JavaScript
 *   expressions, and a single-quoted string is admitted only with the escapes JSON also has (plus
 *   `\'`), so a literal's value is the same in both. The one JSON value refused is an object with a
 *   `__proto__` key, which JavaScript reads as the object's prototype and not as a key.
 * - **Reading never guesses.** Anything outside the grammar (a lambda, a ternary, arithmetic, a
 *   parenthesised argument of a formula, a literal before the last place of a chain, `??` beside
 *   `||` with no parentheses, a call on anything but `state.<name>`, a path step after a call) is
 *   `null`, which a caller shows as a custom expression and keeps verbatim.
 * - **Reading never normalises.** {@link printDynamicTag} of a parsed tag is the input byte for byte
 *   when the input is canonical, and a literal is always printed as it was written (`raw`), so `''`
 *   stays `''` and `{"dateStyle":"long"}` keeps its spacing when another part of the tag is
 *   edited.
 *
 * **White space.** The canonical form has none around the tag, exactly one space on each side of an
 * operator, `, ` between arguments, and none inside the parentheses of a call or of a parenthesised
 * tag. The parser also accepts white space in those four places (and only those: none inside a
 * path, after `!`, or before the `(` of a call), and the printer writes the canonical form. So a
 * tag whose spacing is not canonical parses, and printing it would respace it. That is why a writer
 * must keep the source of a tag it did not edit: {@link templateSegments} hands every tag back with
 * its verbatim `source`, and a tag is printed only when the user changed it.
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

/** When the next value of a tag is read: the one before it is nullish (`??`) or falsy (`||`). */
export type DynamicTagOperator = "??" | "||";

/** A tag in parentheses, standing where a pipe may: `(item.image ?? '')`. */
export interface DynamicTagGroup {
  readonly type: "group";
  readonly tag: DynamicTag;
}

/** One value a tag reads: a pipe, or a whole tag in parentheses. */
export type DynamicTagSource = DynamicTagPipe | DynamicTagGroup;

/** A source read when every source before it gave nothing. */
export interface DynamicTagAlternative {
  readonly operator: DynamicTagOperator;
  readonly source: DynamicTagSource;
}

/** The value a tag yields when every source is nullish (`??`) or falsy (`||`). */
export interface DynamicTagFallback {
  readonly operator: DynamicTagOperator;
  readonly value: DynamicTagLiteral;
}

/**
 * One structured tag. Every operator of one tag is the same one (the grammar reads no other), so a
 * writer that needs the other puts what it has in parentheses and applies it to that.
 */
export interface DynamicTag {
  /** How many `!` precede the first source: `!x` is "is empty", `!!x` is "is set". */
  readonly negations: 0 | 1 | 2;
  /** The first source, which for most tags is the only one. */
  readonly pipe: DynamicTagSource;
  /** The sources read after it, in order, each when those before it gave nothing. */
  readonly alternatives?: readonly DynamicTagAlternative[];
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

/** The operator at the cursor, which it then passes; `null` for none. */
function readOperator(cursor: Cursor): DynamicTagOperator | null {
  if (eat(cursor, "??")) {
    return "??";
  }
  return eat(cursor, "||") ? "||" : null;
}

/** A pipe, or a tag in parentheses. */
function readSource(cursor: Cursor): DynamicTagSource | null {
  if (!eat(cursor, "(")) {
    return readPipe(cursor);
  }
  take(cursor, SPACE);
  const tag = readTag(cursor);
  take(cursor, SPACE);
  return tag !== null && eat(cursor, ")") ? { tag, type: "group" } : null;
}

/** What follows the first source: further sources, then at most one literal, under one operator. */
interface Tail {
  alternatives: DynamicTagAlternative[];
  fallback?: DynamicTagFallback;
}

/**
 * The tail of a tag, leaving the cursor after its last operand; `null` when it is malformed. A
 * source and a literal never start alike (a source opens with `(` or a root word, a literal with a
 * quote, a bracket, a digit, a minus or a JSON keyword), so which one follows an operator is read
 * off the text and not guessed.
 */
function readTail(cursor: Cursor): Tail | null {
  const tail: Tail = { alternatives: [] };
  let used: DynamicTagOperator | null = null;
  for (;;) {
    const before = cursor.at;
    take(cursor, SPACE);
    const operator = readOperator(cursor);
    if (operator === null) {
      cursor.at = before;
      return tail;
    }
    // JavaScript refuses `??` beside `||` without parentheses, so a tag holds one or the other.
    if (used !== null && operator !== used) {
      return null;
    }
    used = operator;
    take(cursor, SPACE);
    const operand = cursor.at;
    const source = readSource(cursor);
    if (source === null) {
      cursor.at = operand;
      const value = readLiteral(cursor);
      if (value === null) {
        return null;
      }
      // A literal ends the tag: nothing is read after a value that is always there.
      tail.fallback = { operator, value };
      return tail;
    }
    tail.alternatives.push({ operator, source });
  }
}

/** A tag at the cursor, which is left after its last character. */
function readTag(cursor: Cursor): DynamicTag | null {
  let negations: DynamicTag["negations"] = 0;
  if (eat(cursor, "!")) {
    negations = eat(cursor, "!") ? 2 : 1;
  }
  const pipe = readSource(cursor);
  const tail = pipe === null ? null : readTail(cursor);
  if (pipe === null || tail === null) {
    return null;
  }
  return {
    negations,
    pipe,
    ...(tail.alternatives.length > 0 && { alternatives: tail.alternatives }),
    ...(tail.fallback && { fallback: tail.fallback }),
  };
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
  const tag = readTag(cursor);
  take(cursor, SPACE);
  return cursor.at === expr.length ? tag : null;
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
  const alternatives = (tag.alternatives ?? [])
    .map(({ operator, source }) => ` ${operator} ${printSource(source)}`)
    .join("");
  const fallback = tag.fallback ? ` ${tag.fallback.operator} ${tag.fallback.value.raw}` : "";
  return "!".repeat(tag.negations) + printSource(tag.pipe) + alternatives + fallback;
}

function printSource(source: DynamicTagSource): string {
  return source.type === "group" ? `(${printDynamicTag(source.tag)})` : printPipe(source);
}

// ─── Sources ─────────────────────────────────────────────────────────────────

/** The sources of a tag as written, in order: the first, then each alternative's. */
function sourcesOf(tag: DynamicTag): DynamicTagSource[] {
  return [tag.pipe, ...(tag.alternatives ?? []).map((alternative) => alternative.source)];
}

/**
 * Every pipe a tag reads, in the order it reads them, with the pipes of a parenthesised tag in the
 * place the parentheses stand. `(a ?? '') || b` reads `a`, then `b`. Never empty.
 */
export function dynamicTagPipes(tag: DynamicTag): DynamicTagPipe[] {
  return sourcesOf(tag).flatMap((source) =>
    source.type === "group" ? dynamicTagPipes(source.tag) : [source],
  );
}

/** Where {@link mapDynamicTagPipes} stands: how many pipes it has passed. */
interface PipeCount {
  at: number;
}

function mapSource(
  source: DynamicTagSource,
  change: (pipe: DynamicTagPipe, index: number) => DynamicTagPipe,
  count: PipeCount,
): DynamicTagSource {
  if (source.type === "group") {
    return { tag: mapTag(source.tag, change, count), type: "group" };
  }
  const index = count.at;
  count.at += 1;
  return change(source, index);
}

function mapTag(
  tag: DynamicTag,
  change: (pipe: DynamicTagPipe, index: number) => DynamicTagPipe,
  count: PipeCount,
): DynamicTag {
  const pipe = mapSource(tag.pipe, change, count);
  const alternatives = tag.alternatives?.map((alternative) => ({
    ...alternative,
    source: mapSource(alternative.source, change, count),
  }));
  return { ...tag, pipe, ...(alternatives && { alternatives }) };
}

/**
 * `tag` with each of its pipes replaced by what `change` answers for it, in the order and under the
 * indices of {@link dynamicTagPipes}. Parentheses, operators, `!` and the fallback are kept.
 */
export function mapDynamicTagPipes(
  tag: DynamicTag,
  change: (pipe: DynamicTagPipe, index: number) => DynamicTagPipe,
): DynamicTag {
  return mapTag(tag, change, { at: 0 });
}

// ─── Describing ──────────────────────────────────────────────────────────────

/** The first pipe a tag reads: the one its name, its kind and its format are those of. */
export function dynamicTagPipe(tag: DynamicTag): DynamicTagPipe {
  return tag.pipe.type === "group" ? dynamicTagPipe(tag.pipe.tag) : tag.pipe;
}

/** The path a pipe reads: the pipe with every formula call peeled off. */
export function dynamicPipePath(pipe: DynamicTagPipe): DynamicTagPath {
  let inner = pipe;
  while (inner.type === "call") {
    inner = inner.input;
  }
  return inner;
}

/** The path a tag reads first: its first pipe with every formula call peeled off. */
export function dynamicTagPath(tag: DynamicTag): DynamicTagPath {
  return dynamicPipePath(dynamicTagPipe(tag));
}

/**
 * `field` for a tag that prints a value as stored, `format` for one that runs it through a formula.
 * A tag that reads several values is of the kind its first one is.
 */
export function dynamicTagKind(tag: DynamicTag): "field" | "format" {
  return dynamicTagPipe(tag).type === "call" ? "format" : "field";
}

/** A row and a page are named for what they are, since their root words say little to an author. */
const ROOT_LABELS: Readonly<Record<DynamicTagRoot, string>> = {
  $map: "Item",
  $page: "Page",
  $site: "Site",
  index: "Row number",
  item: "Item",
  state: "State",
};

/**
 * Step names that say where a value is kept, not what it is: `entry.data.title` is the title, and
 * `entry.data` is the entry.
 */
const CONTAINER_NAMES = new Set(["data"]);

/** The name a step contributes to a label, or `null` for a numeric index or a container word. */
export function dynamicTagStepName(step: DynamicTagStep): string | null {
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
 * Step names that say how a value is held and not what it is: an image's `src`, a link's `url`, a
 * field's `value`. A path ending in one is named for the step before it, so
 * `item.data.featuredImage.src` is "Featured image" and not "Src".
 */
const GENERIC_NAMES = new Set(["src", "url", "value"]);

/** Whether a step name is one of the generic keys a tag is not named for when it can be helped. */
export function isGenericStepName(name: string): boolean {
  return GENERIC_NAMES.has(name);
}

/**
 * A short human name for a tag: its last meaningful path segment as words. `$map.item.data.date` is
 * "Date", `state.entry.data` is "Entry", and a path with nothing to name (`$map`, `state[0]`) is
 * named for its root. A last segment that is a generic key ({@link isGenericStepName}) gives way to
 * the nearest segment before it that names something, and names the tag only when there is none
 * (`state.url` is "Url", `$map.item.src` is "Src"). A tag that reads several values is named for
 * the first. A caller that knows the content schema's own title for the field prefers that; this is
 * the answer when there is none.
 */
export function dynamicTagLabel(tag: DynamicTag): string {
  const path = dynamicTagPath(tag);
  let generic = "";
  for (const [index, step] of [...path.steps.entries()].toReversed()) {
    // The row word after `$map` is the row and not a field of it: it names nothing a key gives way to.
    if (generic !== "" && path.root === "$map" && index === 0) {
      break;
    }
    const name = dynamicTagStepName(step);
    const label = name === null ? "" : humanizeIdentifier(name);
    if (label !== "" && name !== null && !isGenericStepName(name)) {
      return label;
    }
    generic ||= label;
  }
  return generic === "" ? ROOT_LABELS[path.root] : generic;
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
