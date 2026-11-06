/**
 * Content queries — the frontmatter filters a content type can carry: `where` (what exists) and
 * `hold` (what authors can see and production cannot, site-architecture.md §7.6).
 *
 * Both are **data, never code**. A `project.json` is read by Studio, by the dev server and by CI,
 * so a filter that needed `eval` or a function would make every one of those a place that executes
 * the project's text. The grammar is a small JSON query and it is closed: an unknown operator is a
 * build error naming the key, never a silent no-match.
 *
 * It lives here, and not in the parser that loads entries, because Studio answers the same rules
 * for its badges and its lists, and a core package may not import an extension (specs/extensions.md
 * §3). Pure logic with no `node:` imports.
 *
 * @module @jxsuite/schema/content-query
 * @license MIT
 * @docs framework/site/content-collections
 */

import { isBoolean, isNumber, isString } from "./guards.ts";
import type { ContentFieldValue, ContentLoaderEntry, JsonValue } from "../types.ts";

/** An entry's frontmatter as a filter reads it: field name → value, absent when it is not set. */
type FieldData = ContentLoaderEntry["data"];

/** A field value, or an operand, in the form a filter compares; `undefined` is a missing field. */
type FieldValue = ContentFieldValue | undefined;

/** Whether an entry's frontmatter passes a compiled `where`. */
export interface WherePredicate {
  (data: FieldData): boolean;
  /**
   * The first field whose condition `data` fails, for a message that says why an entry was left
   * out.
   */
  why: (data: FieldData) => string | undefined;
}

/** One rule of a content type's `hold`: what it is called, and the frontmatter that matches it. */
export interface HoldRule {
  /** The words every surface shows for an entry this rule holds. */
  label: string;
  /** A query with the grammar of `where`. */
  when: Record<string, JsonValue>;
}

/** The label of the first `hold` rule an entry's frontmatter matches, or undefined for none. */
export type HoldPredicate = (data: FieldData) => string | undefined;

/** What a caller may pin. */
export interface QueryOptions {
  /** What `{ "$now": true }` reads, asked each time so a long-lived host stays current. */
  now?: (() => Date) | undefined;
}

/** What compiling a query carries down to each condition. */
interface QueryContext {
  /** The query's name in a message: `where`, or `hold[1].when`. */
  name: string;
  now: () => Date;
  /** What a value that is not a date answers: whichever way keeps the entry from publishing. */
  onBadDate: boolean;
}

/** The query operators. Closed on purpose: see the module comment. */
const OPERATORS = new Set(["$eq", "$ne", "$in", "$nin", "$exists", "$gt", "$gte", "$lt", "$lte"]);

function isPlainObject(value: FieldValue | FieldData | JsonValue): value is FieldData {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

/** A frontmatter value in the form a filter compares: YAML dates become RFC 3339 text. */
function comparable(value: FieldValue): FieldValue {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return undefined;
    }
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.replace(/\.\d{3}Z$/, "Z");
  }
  return value;
}

function deepEqual(a: FieldValue, b: FieldValue): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => deepEqual(comparable(item), comparable(b[i])))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && deepEqual(comparable(a[key]), comparable(b[key])))
    );
  }
  return false;
}

/**
 * Equality, with one convenience that earns its keep: a scalar matches an array field that CONTAINS
 * it, so `{"tags": "frappe"}` selects every entry tagged frappe without a second operator. An array
 * or object operand compares as a whole value.
 */
function sameValue(actual: FieldValue, expected: JsonValue | undefined): boolean {
  const a = comparable(actual);
  if (Array.isArray(expected) || isPlainObject(expected)) {
    return deepEqual(a, expected);
  }
  if (Array.isArray(a)) {
    return a.some((item) => comparable(item) === expected);
  }
  return a === expected;
}

/** Read a frontmatter field: a literal key first, then a dotted path into nested data. */
export function readField(data: FieldData, key: string): FieldValue {
  // Own properties only: `constructor` and `toString` are not frontmatter, whatever `in` says.
  if (Object.hasOwn(data, key)) {
    return data[key];
  }
  if (!key.includes(".")) {
    return undefined;
  }
  return readPath(data, key.split("."));
}

/** Follow a dotted path's parts through nested objects, own properties only like {@link readField}. */
function readPath(holder: FieldValue | FieldData, [part, ...rest]: readonly string[]): FieldValue {
  if (part === undefined || !isPlainObject(holder) || !Object.hasOwn(holder, part)) {
    return undefined;
  }
  const value = holder[part];
  return rest.length === 0 ? value : readPath(value, rest);
}

/** Order two comparable values; undefined when they are not the same kind of thing. */
function order(actual: FieldValue, operand: string | number): number | undefined {
  const a = comparable(actual);
  if (isNumber(a) && isNumber(operand)) {
    return a - operand;
  }
  if (isString(a) && isString(operand)) {
    return a < operand ? -1 : a > operand ? 1 : 0;
  }
  return undefined;
}

type FieldTest = (actual: FieldValue) => boolean;

/**
 * The operand that reads the clock: `{ "$now": true }`. An object, so no string can be mistaken for
 * it.
 */
function isNowOperand(operand: JsonValue | undefined): boolean {
  return isPlainObject(operand) && operand.$now === true && Object.keys(operand).length === 1;
}

/**
 * A frontmatter value as a moment, or undefined when it is not one. `Date.parse` is what decides,
 * so ECMAScript answers the time zone: a date alone is UTC, a date-time with no offset is local.
 */
function timeOf(value: ContentFieldValue): number | undefined {
  const time =
    value instanceof Date ? value.getTime() : isString(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? undefined : time;
}

function operatorTest(
  where: string,
  op: string,
  operand: JsonValue | undefined,
  ctx: QueryContext,
): FieldTest {
  switch (op) {
    case "$eq": {
      return (actual) => sameValue(actual, operand);
    }
    case "$ne": {
      return (actual) => !sameValue(actual, operand);
    }
    case "$in":
    case "$nin": {
      if (!Array.isArray(operand)) {
        throw new TypeError(`${where}.${op}: expected an array, got ${JSON.stringify(operand)}`);
      }
      const hit: FieldTest = (actual) => operand.some((candidate) => sameValue(actual, candidate));
      return op === "$in" ? hit : (actual) => !hit(actual);
    }
    case "$exists": {
      if (!isBoolean(operand)) {
        throw new TypeError(
          `${where}.$exists: expected true or false, got ${JSON.stringify(operand)}`,
        );
      }
      // An empty YAML key is null, and "set to nothing" is not a value an author means by "exists".
      return (actual) => (actual !== undefined && actual !== null) === operand;
    }
    default: {
      const test = (diff: number) =>
        op === "$gt" ? diff > 0 : op === "$gte" ? diff >= 0 : op === "$lt" ? diff < 0 : diff <= 0;
      if (isNowOperand(operand)) {
        return (actual) => {
          if (actual === undefined || actual === null) {
            return false;
          }
          const time = timeOf(actual);
          return time === undefined ? ctx.onBadDate : test(time - ctx.now().getTime());
        };
      }
      if (!isString(operand) && !isNumber(operand)) {
        throw new TypeError(
          `${where}.${op}: expected a string or number, got ${JSON.stringify(operand)}`,
        );
      }
      return (actual) => {
        const diff = order(actual, operand);
        return diff !== undefined && test(diff);
      };
    }
  }
}

/** A condition object is an operator set when every key is `$`-prefixed. */
function operatorKeys(condition: FieldData): string[] | null {
  const keys = Object.keys(condition);
  const dollars = keys.filter((key) => key.startsWith("$"));
  if (dollars.length === 0) {
    return null;
  }
  return dollars.length === keys.length ? keys : [];
}

function compileCondition(key: string, condition: JsonValue, ctx: QueryContext): FieldTest {
  const where = `${ctx.name}.${key}`;
  if (!isPlainObject(condition)) {
    return (actual) => sameValue(actual, condition);
  }
  const ops = operatorKeys(condition);
  if (ops === null) {
    // A plain object with no operators is a literal value to compare whole.
    return (actual) => deepEqual(comparable(actual), condition);
  }
  if (ops.length === 0) {
    throw new TypeError(`${where}: cannot mix $operators with plain keys in one condition`);
  }
  const tests = ops.map((op) => {
    if (!OPERATORS.has(op)) {
      throw new TypeError(`${where}: unknown operator "${op}" (use ${[...OPERATORS].join(", ")})`);
    }
    return operatorTest(where, op, condition[op], ctx);
  });
  return (actual) => tests.every((test) => test(actual));
}

/** Compile a query's fields, each with its condition, against `ctx`. */
function compileFields(query: FieldData, ctx: QueryContext) {
  return Object.entries(query).map(([key, condition]) => {
    if (key.startsWith("$")) {
      throw new TypeError(
        `${ctx.name}.${key}: top-level operators are not supported, conditions on different fields already combine with AND`,
      );
    }
    /* SAFETY: a query is authored JSON read from `project.json`, so each condition is a JSON value;
       a frontmatter `Date` can only be on the data side of a comparison. */
    return { key, test: compileCondition(key, condition as JsonValue, ctx) };
  });
}

/** The answer of a rule that matched nothing. */
const nothing = (): undefined => {};

/** When a query reads `{ "$now": true }`, unless a caller pins it. */
const realClock = (): Date => new Date();

/**
 * Compile a `where` filter into a predicate over an entry's frontmatter.
 *
 * Every key is a frontmatter field (a dotted path reaches into nested data), keys combine with AND,
 * and a value is either a literal to equal or an operator object (`$eq`, `$ne`, `$in`, `$nin`,
 * `$exists`, `$gt`, `$gte`, `$lt`, `$lte`; several in one object combine with AND too). There is no
 * OR and no evaluation of text: a project that needs "either" splits it into two content types, or
 * into two rules of a `hold`.
 *
 * @param {JsonValue} [where]
 * @param {QueryOptions} [options]
 * @returns {WherePredicate}
 */
export function compileWhere(where?: JsonValue, options: QueryOptions = {}): WherePredicate {
  if (where === undefined) {
    return Object.assign(() => true, { why: nothing });
  }
  if (!isPlainObject(where)) {
    throw new TypeError(`"where" must be an object mapping frontmatter fields to conditions`);
  }
  // A date that cannot be read leaves the entry out: `where` keeps what passes.
  const ctx = { name: "where", now: options.now ?? realClock, onBadDate: false };
  const tests = compileFields(where, ctx);
  return Object.assign(
    (data: FieldData) => tests.every(({ key, test }) => test(readField(data, key))),
    {
      why: (data: FieldData) => tests.find(({ key, test }) => !test(readField(data, key)))?.key,
    },
  );
}

/**
 * Compile a content type's `hold` rules into what names why an entry is held (site-architecture.md
 * §7.6). Any rule matching holds the entry, and the first match is the reason, so a list is the
 * "or" `where` refuses and needs no operator of its own.
 *
 * The polarity is the reason this is not a `filter`: ECMAScript's `Array.prototype.filter` keeps
 * what its predicate answers true for, and a rule here withholds it. It is also why a missing field
 * behaves, in one list: `{ "$gt": { "$now": true } }` does not match a missing date, and `$nin`
 * does match a missing review.
 *
 * @param {JsonValue} [hold] - The type's `hold` value
 * @param {QueryOptions} [options]
 * @returns {HoldPredicate} The label of the first rule that matches, or undefined
 */
export function compileHold(hold?: JsonValue, options: QueryOptions = {}): HoldPredicate {
  if (hold === undefined) {
    return nothing;
  }
  if (!Array.isArray(hold)) {
    throw new TypeError(`"hold" must be an array of { "label", "when" } rules`);
  }
  const now = options.now ?? realClock;
  const rules = hold.map((rule, index) => {
    const at = `hold[${index}]`;
    if (!isPlainObject(rule) || !isString(rule.label) || rule.label.trim() === "") {
      throw new TypeError(`${at}: expected a non-empty "label"`);
    }
    if (!isPlainObject(rule.when) || Object.keys(rule.when).length === 0) {
      // An empty `when` matches every entry, which would quietly empty the type from production.
      throw new TypeError(`${at}: expected "when" to name at least one frontmatter field`);
    }
    // A date that cannot be read holds the entry: a typo must not publish it early.
    const ctx = { name: `${at}.when`, now, onBadDate: true };
    return { label: rule.label, tests: compileFields(rule.when, ctx) };
  });
  return (data) =>
    rules.find(({ tests }) => tests.every(({ key, test }) => test(readField(data, key))))?.label;
}
