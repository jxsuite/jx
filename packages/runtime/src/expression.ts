/// <reference lib="dom" />
/**
 * Jx Declarative Expression Engine (spec §19)
 *
 * Shared module used by both runtime (evaluateExpression) and compiler (compileExpression).
 *
 * @module expression
 */

import {
  DEFAULT_FORMAT_LOCALE,
  DEFAULT_TIME_ZONE,
  INTL_HELPER_PATHS,
  INTL_LOCALE_PARAM,
} from "@jxsuite/schema/intl";
import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type {
  CemParameter,
  JxExpressionNode,
  JxExpressionOperand,
  JxRef,
} from "@jxsuite/schema/types";
import type { JxScope, JxScopeValue } from "./types.ts";
import { readPath, refAccessor, refSegments } from "./pointer.ts";

/** The published names of the schema's expression types, kept for existing importers. */
export type {
  JxExpressionNode as ExpressionNode,
  JxExpressionOperand as ExpressionOperand,
} from "@jxsuite/schema/types";

/** The `$map` iteration context object stored in scope during mapped rendering. */
interface ScopeMapCtx {
  item?: JxScopeValue;
  index?: number;
  [key: string]: JxScopeValue;
}

/** View the scope's `$map` iteration context, if present. */
function scopeMap(state: JxScope): ScopeMapCtx | undefined {
  const map = state.$map;
  /* SAFETY: the guard proved a non-null object, and the runtime binds `$map` only to the
     `{ item, index }` record a mapped row renders under; every member is read as a scope
     member. */
  return isNonNullObject(map) ? (map as ScopeMapCtx) : undefined;
}

/**
 * Spec §19.2 shape detection: an operand object carrying `operator` is a nested node, never a
 * literal.
 */
function isNodeOperand(operand: JxExpressionOperand): operand is JxExpressionNode {
  return isNonNullObject(operand) && !Array.isArray(operand) && "operator" in operand;
}

/** Spec §19.2 shape detection: an operand object carrying `$ref` is a pointer, never a literal. */
function isRefOperand(operand: JxExpressionOperand): operand is JxRef {
  return isNonNullObject(operand) && !Array.isArray(operand) && "$ref" in operand;
}

/**
 * A scope callable, a blessed global or a standard-library method as a formula invokes it: the
 * resolved arguments go in untyped, as they do in the compiled `fn(...args)`, and whatever the
 * callee returns comes back.
 */
type FormulaCallable = (...args: JxScopeValue[]) => JxScopeValue;

/** Named-formula arguments bound for one `call` body, read through `$args/<name>` refs. */
type FormulaArgs = Record<string, JxScopeValue>;

/** A named-formula def met in scope unlowered: its body, and its parameters as written. */
interface RawFormulaDef {
  $expression: JxExpressionNode;
  parameters?: readonly (string | CemParameter | null)[];
}

interface CompileOpts {
  statePrefix?: string;
  eventParam?: string;
  /**
   * Parameter-name order per named-formula state key, used by `call` sites to map positional
   * argument lists onto the emitted formula functions' named-args object.
   */
  formulaParams?: Record<string, string[]>;
}

const MUTATING_OPS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
]);
const UNARY_OPS = new Set(["!", "-"]);
const BINARY_OPS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
  "??",
]);
const ASSIGNMENT_OPS = new Set(["=", "+=", "-=", "*=", "/="]);
const ARRAY_METHOD_OPS = new Set(["push", "pop", "shift", "unshift", "splice"]);
const AGGREGATE_OPS = new Set(["reduce", "map", "filter"]);
const CONDITIONAL_OPS = new Set(["?:", "switch"]);

/**
 * Pure standard-library method operators (spec §19.4d): genuine `String.prototype` /
 * `Array.prototype` / `Number.prototype` methods that never mutate their receiver — the ES2023
 * change-by-copy family stands in where mutation would otherwise occur (`toSorted`, not `sort`).
 * Receiver in `target`; `value` carries the argument (bare scalar) or argument list (array), the
 * splice precedent. No token is invented.
 */
export const PURE_METHOD_OPS = new Set([
  // Array.prototype (and the String.prototype homonyms: includes/indexOf/slice/at/concat)
  "includes",
  "indexOf",
  "lastIndexOf",
  "join",
  "slice",
  "concat",
  "at",
  "flat",
  "toSorted",
  "toReversed",
  "toSpliced",
  "with",
  // String.prototype
  "toUpperCase",
  "toLowerCase",
  "trim",
  "trimStart",
  "trimEnd",
  "split",
  "startsWith",
  "endsWith",
  "padStart",
  "padEnd",
  "replaceAll",
  "repeat",
  "charAt",
  "normalize",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
  // Number.prototype
  "toFixed",
  "toPrecision",
  "toLocaleString",
]);

export const BLESSED_OPERATORS = new Set([
  ...MUTATING_OPS,
  ...UNARY_OPS,
  ...BINARY_OPS,
  ...AGGREGATE_OPS,
  ...CONDITIONAL_OPS,
  ...PURE_METHOD_OPS,
  "call",
]);

/**
 * Pure globals a `call` node may target through the `window#/` scheme (spec §19.4c). Every entry is
 * a genuine ECMAScript or WHATWG standard-library function with no side effects; anything off this
 * list is a compile-time error, keeping formula purity decidable.
 */
export const BLESSED_GLOBALS = new Set([
  // Global functions
  "isNaN",
  "isFinite",
  "parseFloat",
  "parseInt",
  "encodeURIComponent",
  "decodeURIComponent",
  "structuredClone",
  // Math
  "Math/abs",
  "Math/ceil",
  "Math/floor",
  "Math/round",
  "Math/trunc",
  "Math/sign",
  "Math/sqrt",
  "Math/cbrt",
  "Math/pow",
  "Math/exp",
  "Math/log",
  "Math/log2",
  "Math/log10",
  "Math/min",
  "Math/max",
  "Math/hypot",
  // Number
  "Number/isInteger",
  "Number/isFinite",
  "Number/isNaN",
  "Number/parseFloat",
  "Number/parseInt",
  // JSON
  "JSON/parse",
  "JSON/stringify",
  // Object
  "Object/keys",
  "Object/values",
  "Object/entries",
  "Object/fromEntries",
  // Array
  "Array/from",
  "Array/isArray",
  "Array/of",
  // String
  "String/fromCharCode",
  "String/fromCodePoint",
  // Intl helpers come from @jxsuite/schema/intl — see BLESSED_HELPERS. One list, so the runtime,
  // The compiler and the JSON-Schema description cannot drift apart.
  ...INTL_HELPER_PATHS,
]);

/** What a synthetic helper returns: a formatted string, a comparison or a list of segments. */
type BlessedHelperResult = string | number | string[] | undefined;

/**
 * One synthetic helper. Each declares the arguments its Intl constructor expects; the table holds
 * them as `(...args: never[])`, the parameter list every function is assignable to, so helpers of
 * different arities share one map.
 */
type BlessedHelper = (...args: never[]) => BlessedHelperResult;

/**
 * Synthetic blessed helpers (spec §19.4c): pure functions that have no direct `window` global
 * because the underlying standard-library API is a constructor. The interpreter dispatches to
 * these; the compiler emits the equivalent inline construct-then-format expression.
 */
const BLESSED_HELPERS = new Map<string, BlessedHelper>([
  [
    "Intl/compare",
    (a: string, b: string, locale?: string, options?: Intl.CollatorOptions) =>
      new Intl.Collator(locale ?? DEFAULT_FORMAT_LOCALE, options).compare(a, b),
  ],
  [
    "Intl/displayName",
    (
      code: string,
      type?: Intl.DisplayNamesType,
      locale?: string,
      options?: Intl.DisplayNamesOptions,
    ) =>
      new Intl.DisplayNames(locale ?? DEFAULT_FORMAT_LOCALE, {
        ...options,
        type: type ?? "language",
      }).of(code),
  ],
  [
    "Intl/formatDate",
    (value: string | number | Date, locale?: string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale ?? DEFAULT_FORMAT_LOCALE, {
        timeZone: DEFAULT_TIME_ZONE,
        ...options,
      }).format(new Date(value)),
  ],
  [
    "Intl/formatList",
    (values: string[], locale?: string, options?: Intl.ListFormatOptions) =>
      new Intl.ListFormat(locale ?? DEFAULT_FORMAT_LOCALE, options).format(values),
  ],
  [
    "Intl/formatNumber",
    (value: number, locale?: string, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale ?? DEFAULT_FORMAT_LOCALE, options).format(value),
  ],
  [
    "Intl/formatRelativeTime",
    (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      locale?: string,
      options?: Intl.RelativeTimeFormatOptions,
    ) => new Intl.RelativeTimeFormat(locale ?? DEFAULT_FORMAT_LOCALE, options).format(value, unit),
  ],
  [
    "Intl/plural",
    (value: number, locale?: string, options?: Intl.PluralRulesOptions) =>
      new Intl.PluralRules(locale ?? DEFAULT_FORMAT_LOCALE, options).select(value),
  ],
  /* Returns the segments as plain strings, because a formula's value has to be JSON — the
     Segmenter's own iterator of {segment, index, isWordLike} records is not. */
  [
    "Intl/segment",
    (value: string, granularity?: "grapheme" | "sentence" | "word", locale?: string) =>
      [
        ...new Intl.Segmenter(locale ?? DEFAULT_FORMAT_LOCALE, {
          granularity: granularity ?? "grapheme",
        }).segment(value),
      ].map((part) => part.segment),
  ],
]);

/**
 * Fill in a helper's omitted `locale` argument from the page's own locale.
 *
 * A page under `/fr/` that formats a date without naming a locale means French: the route said so,
 * `<html lang>` says so, and `hreflang` tells every crawler so. Requiring the author to repeat it
 * at every call site is how a translated page ends up with English dates and English number
 * grouping on it — a defect that is invisible to the person who built the site in their own
 * language, and obvious to every reader of the other one.
 *
 * Determinism is untouched, which is the property `DEFAULT_FORMAT_LOCALE` exists to protect:
 * `$page.locale` is a function of the route and the document (site-architecture.md §13.4), not of
 * the machine the build runs on. A scope with no `$page` — a component's own state, the runtime
 * used standalone — keeps the fixed default.
 *
 * @param {string} path - Helper callee path, e.g. `Intl/formatNumber`
 * @param {JxScopeValue[]} args - Resolved arguments, in declaration order
 * @param {JxScope} state
 * @returns {JxScopeValue[]}
 */
function withPageLocale(path: string, args: JxScopeValue[], state: JxScope): JxScopeValue[] {
  const index = INTL_LOCALE_PARAM[path];
  if (index === undefined || index < 0 || args[index] != null) {
    return args;
  }
  const locale = readPath(state.$page, "locale");
  if (!isString(locale) || locale === "") {
    return args;
  }
  const filled = [...args];
  filled[index] = locale;
  return filled;
}

/** Whether a `window#/…` callee ref is on the blessed pure-globals list. */
export function isBlessedGlobal(ref: string): boolean {
  return ref.startsWith("window#/") && BLESSED_GLOBALS.has(ref.slice("window#/".length));
}

/**
 * @param {string} op
 * @returns {boolean}
 */
export function isMutating(op: string) {
  return MUTATING_OPS.has(op);
}

// ─── Runtime Evaluation ──────────────────────────────────────────────────────

interface IterCtx {
  acc?: JxScopeValue;
  item?: JxScopeValue;
  index?: number;
  /** Named-formula arguments bound for the current `call` body ($args/<name> refs). */
  args?: FormulaArgs;
  /** Call-nesting depth; capped at MAX_CALL_DEPTH to bound recursive formulas. */
  callDepth?: number;
}

/** Recursion bound for `call` chains (formula → formula), mirroring MAX_REPORT_DEPTH. */
export const MAX_CALL_DEPTH = 64;

/**
 * Editor-mode evaluation trace (spec §19.9). When passed, every node and operand reports its
 * evaluated value keyed by its path within the expression tree, and the branch-selecting operators
 * (`?:`, `switch` — plus the eager `&&`/`||`/`??`) yield values for ALL branches so a visual editor
 * can badge every node. Absent (production), evaluation is untouched.
 */
export interface ExpressionTrace {
  report: (path: (string | number)[], value: JxScopeValue) => void;
  /** Current node path — internal; leave unset at the call boundary. */
  path?: (string | number)[];
  /** Recursion depth — internal; reporting stops beyond MAX_REPORT_DEPTH. */
  depth?: number;
}

/** Reporting recursion bound: branch-forcing removes natural exit conditions, so cap the walk. */
export const MAX_REPORT_DEPTH = 64;

/** Derive the trace for a child operand at path segment(s) `seg`; undefined once capped. */
function subTrace(
  trace: ExpressionTrace | undefined,
  seg: string | number | (string | number)[],
): ExpressionTrace | undefined {
  if (!trace) {
    return undefined;
  }
  const depth = (trace.depth ?? 0) + 1;
  if (depth > MAX_REPORT_DEPTH) {
    return undefined;
  }
  return {
    depth,
    path: [...(trace.path ?? []), ...(Array.isArray(seg) ? seg : [seg])],
    report: trace.report,
  };
}

/** Resolve an operand to its runtime value. */
function resolveOperand(
  operand: JxExpressionOperand | undefined,
  state: JxScope,
  event: Event | null,
  iterCtx?: IterCtx,
  trace?: ExpressionTrace,
): JxScopeValue {
  if (operand === null || operand === undefined) {
    return operand;
  }

  // Nested expression node
  if (isNodeOperand(operand)) {
    return evaluateExpression(operand, state, event, iterCtx, trace);
  }

  // $ref pointer
  if (isRefOperand(operand)) {
    const resolved = resolveExprRef(operand.$ref, state, event, iterCtx);
    trace?.report(trace.path ?? [], resolved);
    return resolved;
  }

  // Array of operands (e.g., splice args)
  if (Array.isArray(operand)) {
    return resolveOperands(operand, state, event, iterCtx, trace);
  }

  // Literal
  trace?.report(trace.path ?? [], operand);
  return operand;
}

/** Resolve each operand of a list, tracing member `i` at segment `i` beneath `trace`. */
function resolveOperands(
  operands: readonly JxExpressionOperand[],
  state: JxScope,
  event: Event | null,
  iterCtx: IterCtx | undefined,
  trace: ExpressionTrace | undefined,
): JxScopeValue[] {
  return operands.map((o, i) => resolveOperand(o, state, event, iterCtx, subTrace(trace, i)));
}

/**
 * The receiver a `call` binds: the value the pointer's parent path names. `#/state/x` and
 * `parent#/x` are owned by the scope itself; `$map/item/fn` by the item; a pointer with no parent
 * segment (`$map/item`, `$args/x`) has no owner.
 */
function calleeOwner(
  ref: string,
  state: JxScope,
  event: Event | null,
  iterCtx?: IterCtx,
): JxScopeValue {
  const parentRef = (prefix: string): JxScopeValue => {
    const rest = ref.slice(prefix.length);
    if (!rest.includes("/")) {
      return state;
    }
    return resolveExprRef(ref.slice(0, ref.lastIndexOf("/")), state, event, iterCtx);
  };
  if (ref.startsWith("#/state/")) {
    return parentRef("#/state/");
  }
  if (ref.startsWith("parent#/")) {
    return parentRef("parent#/");
  }
  if (ref.startsWith("$map/") || ref.startsWith("$args/")) {
    return ref.split("/").length > 2
      ? resolveExprRef(ref.slice(0, ref.lastIndexOf("/")), state, event, iterCtx)
      : undefined;
  }
  return undefined;
}

/** Resolve a $ref string within expression context. */
function resolveExprRef(ref: string, state: JxScope, event: Event | null, iterCtx?: IterCtx) {
  if (ref === "$reduce/acc") {
    return iterCtx?.acc;
  }
  if (ref.startsWith("$reduce/")) {
    return iterCtx?.acc;
  }
  if (ref.startsWith("$args/")) {
    const parts = ref.slice("$args/".length).split("/");
    const base = iterCtx?.args?.[parts[0]!];
    return parts.length > 1 ? readPath(base, parts.slice(1).join("/")) : base;
  }
  if (ref.startsWith("event#/")) {
    const path = ref.slice("event#/".length);
    return readPath(event, path);
  }
  if (ref.startsWith("$map/")) {
    const parts = ref.split("/");
    const [, key] = parts;
    let base;
    const map = scopeMap(state);
    if (key === "item") {
      base = iterCtx?.item ?? map?.item ?? state["$map/item"];
    } else if (key === "index") {
      base = iterCtx?.index ?? map?.index ?? state["$map/index"];
    } else {
      base = map?.[key!] ?? state[`$map/${key}`];
    }
    return parts.length > 2 ? readPath(base, parts.slice(2).join("/")) : base;
  }
  if (ref.startsWith("#/state/")) {
    // One call, not a hand-split leading token: slicing at the first `/` skipped unescaping it, so
    // `#/state/a~1b/c` looked for a member called `a~1b` rather than `a/b`.
    return readPath(state, ref.slice("#/state/".length));
  }
  if (ref.startsWith("parent#/")) {
    /*
     * A prop name may be a path into the prop. This read the whole path as one key and returned
     * undefined for `parent#/user/name`, while the lowerer above compiled it to a walk.
     */
    return readPath(state, ref.slice("parent#/".length));
  }
  if (ref.startsWith("window#/")) {
    return readPath(globalThis.window, ref.slice("window#/".length));
  }
  if (ref.startsWith("document#/")) {
    return readPath(globalThis.document, ref.slice("document#/".length));
  }
  return readPath(state, ref) ?? null;
}

/** Where an assignment writes: the member `key` of the object `obj`. */
interface WritableLocation {
  obj: JxScope;
  key: string;
}

/** Resolve a $ref to a writable location — returns { obj, key } for assignment. */
function resolveWritableRef(
  ref: string,
  state: JxScope,
  _event: Event | null,
  iterCtx?: IterCtx,
): WritableLocation {
  if (ref.startsWith("$map/")) {
    const parts = ref.split("/");
    const [, key] = parts;
    let base;
    const map = scopeMap(state);
    if (key === "item") {
      base = iterCtx?.item ?? map?.item ?? state["$map/item"];
    } else if (key === "index") {
      base = iterCtx?.index ?? map?.index ?? state["$map/index"];
    } else {
      base = map?.[key!] ?? state[`$map/${key}`];
    }
    if (parts.length > 2) {
      const pathParts = parts.slice(2);
      const lastKey = pathParts.pop();
      const obj = pathParts.length > 0 ? readPath(base, pathParts.join("/")) : base;
      /* SAFETY: `parts.length > 2`, so `pathParts` held at least one segment and `pop()` returned a
         string. A `$map/…` write names a member of an object in the item (spec §19.2 resolves it
         like any `$ref`); a non-object here fails at the assignment as the compiled `_item.a = v`
         does. */
      return { key: lastKey as string, obj: obj as JxScope };
    }
    return {
      key: key === "item" ? "$map/item" : "$map/index",
      obj: scopeMap(state) ?? state,
    };
  }
  if (ref.startsWith("#/state/")) {
    const sub = ref.slice("#/state/".length);
    const slash = sub.indexOf("/");
    if (slash === -1) {
      return { key: sub, obj: state };
    }
    /*
     * The same tokenizer the read path uses. It used to split on `/` alone while the read split on
     * `/[./]/`, so a write to `#/state/a/b.c` created a key `"b.c"` that the matching read — which
     * walked `b` then `c` — could never see. The write simply vanished.
     */
    const parts = refSegments(sub);
    const lastKey = parts.pop();
    let obj = state;
    for (const p of parts) {
      /* SAFETY: a writable pointer's leading segments name the objects that hold its target (spec
         §19.3). The runtime does not validate that, so a missing or primitive segment fails at the
         next member access or at the write, as the compiled `s.a.b = v` does. */
      obj = obj[p] as JxScope;
    }
    // SAFETY: `sub` contains a `/`, so `refSegments` returned at least two segments and `pop()` a string.
    return { key: lastKey as string, obj };
  }
  return { key: ref, obj: state };
}

/** Evaluate an expression node at runtime. */
export function evaluateExpression(
  node: JxExpressionNode,
  state: JxScope,
  event: Event | null,
  iterCtx?: IterCtx,
  trace?: ExpressionTrace,
): JxScopeValue {
  const result = evaluateNode(node, state, event, iterCtx, trace);
  trace?.report(trace.path ?? [], result);
  return result;
}

/**
 * Apply one of the binary operators that convert their own operands: the arithmetic ones (ECMA-262
 * §13.15.3 ApplyStringOrNumericBinaryOperator) and the relational ones (§7.2.13 IsLessThan). The
 * interpreter hands them the resolved values unconverted, exactly as the compiled `(left op right)`
 * does, so `+` still concatenates when either side is a string; `number` is what lets TypeScript
 * accept the operators, not a conversion.
 *
 * @param {string} operator - One of `+ - * / %` or `< <= > >=`
 * @param {number} left
 * @param {number} right
 * @returns {number | boolean}
 */
function applyCoercingOperator(operator: string, left: number, right: number): number | boolean {
  switch (operator) {
    case "+": {
      return left + right;
    }
    case "-": {
      return left - right;
    }
    case "*": {
      return left * right;
    }
    case "/": {
      return left / right;
    }
    case "%": {
      return left % right;
    }
    case "<": {
      return left < right;
    }
    case "<=": {
      return left <= right;
    }
    case ">": {
      return left > right;
    }
    default: {
      // `>=`: the binary operator set leaves nothing else that reaches here.
      return left >= right;
    }
  }
}

function evaluateNode(
  node: JxExpressionNode,
  state: JxScope,
  event: Event | null,
  iterCtx?: IterCtx,
  trace?: ExpressionTrace,
): JxScopeValue {
  const { operator, target, value, initial } = node;

  if (!BLESSED_OPERATORS.has(operator)) {
    throw new Error(`$expression: unknown operator "${operator}"`);
  }

  // ─── Unary ───
  if (UNARY_OPS.has(operator) && !("value" in node)) {
    const operand = resolveOperand(target, state, event, iterCtx, subTrace(trace, "target"));
    if (operator === "!") {
      return !operand;
    }
    if (operator === "-") {
      // SAFETY: unary minus applies ToNumeric itself (ECMA-262 §13.5.4); `number` only lets TypeScript accept the operator.
      return -(operand as number);
    }
  }

  // ─── Call (spec §19.4c) ───
  if (operator === "call") {
    const calleeRef = isRefOperand(target) ? target.$ref : undefined;
    if (!isString(calleeRef)) {
      throw new TypeError("$expression: call target must be a $ref pointer");
    }
    const callDepth = (iterCtx?.callDepth ?? 0) + 1;
    if (callDepth > MAX_CALL_DEPTH) {
      throw new Error(`$expression: call depth exceeded (${MAX_CALL_DEPTH})`);
    }
    const argValues = Array.isArray(value)
      ? value.map((o, i) => resolveOperand(o, state, event, iterCtx, subTrace(trace, ["value", i])))
      : [];

    // Blessed pure global via the window#/ scheme (Math.max, JSON.parse, …).
    if (calleeRef.startsWith("window#/")) {
      if (!isBlessedGlobal(calleeRef)) {
        throw new Error(`$expression: "${calleeRef}" is not a blessed pure global`);
      }
      const globalPath = calleeRef.slice("window#/".length);
      const helper = BLESSED_HELPERS.get(globalPath);
      if (helper) {
        /* SAFETY: formula arguments carry no runtime types; each helper hands them to an Intl
           constructor that coerces or throws itself, exactly as the inline call
           `compileHelperCall` emits does. The parameter types document that contract. */
        return (helper as (...args: JxScopeValue[]) => BlessedHelperResult)(
          ...withPageLocale(globalPath, argValues, state),
        );
      }
      /* SAFETY: `isBlessedGlobal` admitted `globalPath`, and every BLESSED_GLOBALS entry without a
         synthetic helper names a standard-library function on `window` (Math.max, JSON.parse, …). */
      const fn = readPath(globalThis.window, globalPath) as FormulaCallable;
      const lastSlash = globalPath.lastIndexOf("/");
      const thisArg =
        lastSlash === -1
          ? globalThis.window
          : readPath(globalThis.window, globalPath.slice(0, lastSlash));
      return fn.apply(thisArg, argValues);
    }

    const callee = resolveExprRef(calleeRef, state, event, iterCtx);
    // A scope callable (buildScope lowers parameterized formula entries to functions). The receiver
    // Is the object that owns the pointer's last segment — what the compiled lowering binds when it
    // Emits `s.commands.run(...)` — so a host method handed in through the scope keeps its `this`.
    if (isFunction(callee)) {
      // SAFETY: the guard proved `callee` callable; a scope callable takes the resolved arguments untyped, as the compiled call does.
      return (callee as FormulaCallable).apply(
        calleeOwner(calleeRef, state, event, iterCtx),
        argValues,
      );
    }
    // A raw named-formula def (standalone evaluation, e.g. editor preview).
    if (isNonNullObject(callee) && "$expression" in callee) {
      /* SAFETY: a scope member carrying `$expression` is a named-formula def (spec §19.4c), left
         unlowered only when the document is evaluated standalone. Its parameters are read as the
         document wrote them, so a malformed `null` entry stays possible and is skipped below. */
      const def = callee as RawFormulaDef;
      const args: FormulaArgs = {};
      for (const [i, p] of (def.parameters ?? []).entries()) {
        const name = isString(p) ? p : (p?.name ?? "");
        if (!name) {
          continue;
        }
        args[name] =
          argValues[i] === undefined && isNonNullObject(p) && "default" in p
            ? p.default
            : argValues[i];
      }
      // The callee body's node paths are its own tree, not the call site's — no trace inside.
      return evaluateExpression(def.$expression, state, event, { args, callDepth });
    }
    throw new TypeError(`$expression: call target "${calleeRef}" is not callable`);
  }

  // ─── Conditional (pure) ───
  if (CONDITIONAL_OPS.has(operator)) {
    if (operator === "?:") {
      const test = resolveOperand(target, state, event, iterCtx, subTrace(trace, "target"));
      if (trace) {
        // Editor mode: evaluate both branches so each carries a live value.
        const consequent = resolveOperand(value, state, event, iterCtx, subTrace(trace, "value"));
        const alternate = resolveOperand(
          initial,
          state,
          event,
          iterCtx,
          subTrace(trace, "initial"),
        );
        return test ? consequent : alternate;
      }
      return test
        ? resolveOperand(value, state, event, iterCtx)
        : resolveOperand(initial, state, event, iterCtx);
    }
    // Switch — value-keyed selection; discriminant matched against case keys by string form.
    const discriminant = resolveOperand(target, state, event, iterCtx, subTrace(trace, "target"));
    const key = String(discriminant);
    const cases = node.cases ?? {};
    const matched = Object.hasOwn(cases, key);
    if (trace) {
      let result: JxScopeValue;
      for (const [k, caseOperand] of Object.entries(cases)) {
        const v = resolveOperand(caseOperand, state, event, iterCtx, subTrace(trace, ["cases", k]));
        if (k === key) {
          result = v;
        }
      }
      const fallback = resolveOperand(
        node.default,
        state,
        event,
        iterCtx,
        subTrace(trace, "default"),
      );
      return matched ? result : fallback;
    }
    return matched
      ? resolveOperand(cases[key], state, event, iterCtx)
      : resolveOperand(node.default, state, event, iterCtx);
  }

  // ─── Binary (pure) ───
  if (BINARY_OPS.has(operator)) {
    const left = resolveOperand(target, state, event, iterCtx, subTrace(trace, "target"));
    const right = resolveOperand(value, state, event, iterCtx, subTrace(trace, "value"));
    switch (operator) {
      case "===": {
        return left === right;
      }
      case "!==": {
        return left !== right;
      }
      case "&&": {
        return left && right;
      }
      case "||": {
        return left || right;
      }
      case "??": {
        return left ?? right;
      }
      default: {
        // SAFETY: the remaining binary operators coerce their own operands (see applyCoercingOperator).
        return applyCoercingOperator(operator, left as number, right as number);
      }
    }
  }

  // ─── Assignment ───
  if (ASSIGNMENT_OPS.has(operator)) {
    const rhs = resolveOperand(value, state, event, iterCtx, subTrace(trace, "value"));
    // SAFETY: an assignment's target is a writable `$ref` (spec §19.3); the schema admits nothing else there.
    const { obj, key } = resolveWritableRef((target as JxRef).$ref, state, event, iterCtx);
    /* SAFETY: a compound `a op= b` is `a = a op b`, and `op` converts its own operands (see
       applyCoercingOperator); plain `=` stores `rhs` untouched and never reads `obj[key]`. */
    obj[key] =
      operator === "="
        ? rhs
        : applyCoercingOperator(operator.slice(0, -1), obj[key] as number, rhs as number);
    return;
  }

  // ─── Array methods ───
  if (ARRAY_METHOD_OPS.has(operator)) {
    /* SAFETY: an array-mutation operator's receiver is an array (spec §19.3); a non-array fails at
       the method call exactly as the compiled `receiver.push(v)` does. */
    const arr = resolveOperand(
      target,
      state,
      event,
      iterCtx,
      subTrace(trace, "target"),
    ) as JxScopeValue[];
    switch (operator) {
      case "push": {
        return arr.push(resolveOperand(value, state, event, iterCtx, subTrace(trace, "value")));
      }
      case "unshift": {
        return arr.unshift(resolveOperand(value, state, event, iterCtx, subTrace(trace, "value")));
      }
      case "pop": {
        return arr.pop();
      }
      case "shift": {
        return arr.shift();
      }
      case "splice": {
        /* SAFETY: splice's `value` is its argument list `[start, deleteCount, ...items]` (spec
           §19.3); splice converts `start` and `deleteCount` itself (ToIntegerOrInfinity), as the
           compiled `receiver.splice(...)` does. */
        const args = resolveOperand(value, state, event, iterCtx, subTrace(trace, "value")) as [
          start: number,
          deleteCount: number,
          ...items: JxScopeValue[],
        ];
        return arr.splice(...args);
      }
      default: {
        break;
      }
    }
  }

  // ─── Pure standard-library methods (spec §19.4d) ───
  if (PURE_METHOD_OPS.has(operator)) {
    const receiver = resolveOperand(target, state, event, iterCtx, subTrace(trace, "target"));
    const args =
      value === undefined
        ? []
        : Array.isArray(value)
          ? resolveOperands(value, state, event, iterCtx, subTrace(trace, "value"))
          : [resolveOperand(value, state, event, iterCtx, subTrace(trace, "value"))];
    const method = readPath(receiver, operator);
    if (!isFunction(method)) {
      // Null-safe, like path reads: a missing receiver or method yields undefined, not a throw.
      return undefined;
    }
    // SAFETY: the guard proved `method` callable; a standard-library method coerces its own arguments.
    return (method as FormulaCallable).apply(receiver, args);
  }

  // ─── Aggregates (pure) ───
  if (AGGREGATE_OPS.has(operator)) {
    /* SAFETY: an aggregate's source is an array (spec §19.4a); a non-array fails at the iteration
       exactly as the compiled `source.map(...)` does. */
    const arr = resolveOperand(
      target,
      state,
      event,
      iterCtx,
      subTrace(trace, "target"),
    ) as JxScopeValue[];
    /* SAFETY: an aggregate's `value` is its per-item expression node (spec §19.4a), the only shape
       the schema admits there; anything else fails evaluateExpression's operator check. */
    const perItem = value as JxExpressionNode;
    // Trace only the first iteration's per-item expression — one sample badge per node,
    // Not one report per array element.
    if (operator === "reduce") {
      let acc = resolveOperand(initial, state, event, iterCtx, subTrace(trace, "initial"));
      for (const [index, item] of arr.entries()) {
        acc = evaluateExpression(
          perItem,
          state,
          event,
          { acc, index, item },
          index === 0 ? subTrace(trace, "value") : undefined,
        );
      }
      return acc;
    }
    if (operator === "map") {
      return arr.map((item, index) =>
        evaluateExpression(
          perItem,
          state,
          event,
          { ...iterCtx, index, item },
          index === 0 ? subTrace(trace, "value") : undefined,
        ),
      );
    }
    if (operator === "filter") {
      return arr.filter((item, index) =>
        evaluateExpression(
          perItem,
          state,
          event,
          { ...iterCtx, index, item },
          index === 0 ? subTrace(trace, "value") : undefined,
        ),
      );
    }
  }

  return undefined;
}

// ─── Compiler: Expression → JS Source ────────────────────────────────────────

/** Compile an operand to a JS source string. */
function compileOperand(operand: JxExpressionOperand | undefined, opts: CompileOpts): string {
  if (operand === null) {
    return "null";
  }
  if (operand === undefined) {
    return "undefined";
  }

  // Nested expression node
  if (isNodeOperand(operand)) {
    return compileExpression(operand, opts);
  }

  // $ref pointer
  if (isRefOperand(operand)) {
    return compileRef(operand.$ref, opts);
  }

  // Array of operands
  if (Array.isArray(operand)) {
    return operand.map((o) => compileOperand(o, opts)).join(", ");
  }

  // Literal
  return JSON.stringify(operand);
}

/**
 * The module-scope function name a named formula compiles to. Shared by call-site emission here and
 * the declaration emission in the compiler targets.
 *
 * @param {string} key
 * @returns {string}
 */
export function formulaFnName(key: string) {
  return `_fx_${key.replaceAll(/[^A-Za-z0-9_$]/g, "_")}`;
}

/**
 * Compile a $ref to its JS equivalent.
 *
 * @param {string} ref
 * @param {CompileOpts} opts
 * @returns {string}
 */
function compileRef(ref: string, opts: CompileOpts) {
  const s = opts.statePrefix ?? "state";
  const e = opts.eventParam ?? "event";

  if (ref === "$reduce/acc") {
    return "_acc";
  }
  if (ref.startsWith("$reduce/")) {
    return "_acc";
  }
  if (ref.startsWith("$args/")) {
    return refAccessor("_args", ref.slice("$args/".length));
  }

  if (ref.startsWith("event#/")) {
    return refAccessor(e, ref.slice("event#/".length));
  }

  if (ref.startsWith("$map/")) {
    const parts = ref.split("/");
    const [, key] = parts;
    if (key === "item") {
      return parts.length > 2 ? refAccessor("_item", parts.slice(2).join("/")) : "_item";
    }
    if (key === "index") {
      return "_index";
    }
    return `_${key}`;
  }

  if (ref.startsWith("#/state/")) {
    return refAccessor(s, ref.slice("#/state/".length));
  }

  if (ref.startsWith("parent#/")) {
    return refAccessor(s, ref.slice("parent#/".length));
  }
  if (ref.startsWith("window#/")) {
    return refAccessor("window", ref.slice("window#/".length));
  }
  if (ref.startsWith("document#/")) {
    return refAccessor("document", ref.slice("document#/".length));
  }

  /*
   * An unrecognized scheme is still a path under state. Pasting it raw emitted `s.a/b`, which is
   * not a parse error but a division against an undeclared identifier.
   */
  return refAccessor(s, ref);
}

/** Compile a writable $ref target to its JS equivalent (for LHS of assignment). */
function compileTarget(target: JxExpressionOperand, opts: CompileOpts): string {
  if (isRefOperand(target)) {
    return compileRef(target.$ref, opts);
  }
  return compileOperand(target, opts);
}

/**
 * Compile an expression node to a JS source string. Returns a statement for mutating ops, a value
 * expression for pure ops.
 *
 * @param {JxExpressionNode} node
 * @param {CompileOpts} [opts]
 * @returns {string}
 */
/**
 * Emit the inline JS for a synthetic blessed helper (see BLESSED_HELPERS), or null for ordinary
 * globals that compile to a plain `window.<path>` call.
 *
 * @param {string} path - The `window#/`-stripped callee path (e.g. "Intl/formatNumber")
 * @param {string[]} args - Already-compiled argument expressions
 * @param {CompileOpts} opts
 * @returns {string | null}
 */
function compileHelperCall(path: string, args: string[], opts: CompileOpts): string | null {
  const a = (i: number) => args[i] ?? "undefined";
  /*
   * The same defaults the interpreter applies, inlined — see @jxsuite/schema/intl. The page's own
   * locale comes first and the fixed one behind it, so an island formats in the language of the
   * page it is on. `?.` and not `.`: a component's state has no `$page`, and neither does the
   * runtime evaluated standalone.
   */
  const L = `(${opts.statePrefix ?? "state"}?.$page?.locale ?? ${JSON.stringify(DEFAULT_FORMAT_LOCALE)})`;
  const Z = JSON.stringify(DEFAULT_TIME_ZONE);
  switch (path) {
    case "Intl/formatNumber": {
      return `new Intl.NumberFormat(${a(1)} ?? ${L}, ${a(2)}).format(${a(0)})`;
    }
    case "Intl/formatDate": {
      return (
        `new Intl.DateTimeFormat(${a(1)} ?? ${L}, ` +
        `{timeZone: ${Z}, ...${a(2)}}).format(new Date(${a(0)}))`
      );
    }
    case "Intl/formatRelativeTime": {
      return `new Intl.RelativeTimeFormat(${a(2)} ?? ${L}, ${a(3)}).format(${a(0)}, ${a(1)})`;
    }
    case "Intl/formatList": {
      return `new Intl.ListFormat(${a(1)} ?? ${L}, ${a(2)}).format(${a(0)})`;
    }
    case "Intl/plural": {
      return `new Intl.PluralRules(${a(1)} ?? ${L}, ${a(2)}).select(${a(0)})`;
    }
    case "Intl/compare": {
      return `new Intl.Collator(${a(2)} ?? ${L}, ${a(3)}).compare(${a(0)}, ${a(1)})`;
    }
    case "Intl/displayName": {
      return (
        `new Intl.DisplayNames(${a(2)} ?? ${L}, ` +
        `{...${a(3)}, type: ${a(1)} ?? 'language'}).of(${a(0)})`
      );
    }
    case "Intl/segment": {
      return (
        `[...new Intl.Segmenter(${a(2)} ?? ${L}, {granularity: ${a(1)} ?? 'grapheme'})` +
        `.segment(${a(0)})].map((p) => p.segment)`
      );
    }
    default: {
      return null;
    }
  }
}

export function compileExpression(node: JxExpressionNode, opts: CompileOpts = {}): string {
  const { operator, target, value, initial } = node;

  // ─── Unary ───
  if (UNARY_OPS.has(operator) && !("value" in node)) {
    const operand: string = compileOperand(target, opts);
    if (operator === "!") {
      return `!(${operand})`;
    }
    if (operator === "-") {
      return `-(${operand})`;
    }
  }

  // ─── Call (spec §19.4c) ───
  if (operator === "call") {
    const calleeRef = (isRefOperand(target) ? target.$ref : undefined) ?? "";
    const args = Array.isArray(value) ? value.map((o) => compileOperand(o, opts)) : [];
    if (calleeRef.startsWith("window#/")) {
      if (!isBlessedGlobal(calleeRef)) {
        throw new Error(`$expression: "${calleeRef}" is not a blessed pure global`);
      }
      const helperJs = compileHelperCall(calleeRef.slice("window#/".length), args, opts);
      if (helperJs) {
        return helperJs;
      }
      return `window.${calleeRef.slice("window#/".length).replaceAll("/", ".")}(${args.join(", ")})`;
    }
    if (calleeRef.startsWith("#/state/")) {
      const key = calleeRef.slice("#/state/".length);
      const params = opts.formulaParams?.[key];
      if (params) {
        const named = params
          .map((p, i) => `${JSON.stringify(p)}: ${args[i] ?? "undefined"}`)
          .join(", ");
        return `${formulaFnName(key)}(${opts.statePrefix ?? "state"}, { ${named} })`;
      }
    }
    // Fallback: the scope member itself is callable.
    return `${compileRef(calleeRef, opts)}(${args.join(", ")})`;
  }

  // ─── Conditional (pure) ───
  if (CONDITIONAL_OPS.has(operator)) {
    if (operator === "?:") {
      const test: string = compileOperand(target, opts);
      const consequent: string = compileOperand(value, opts);
      const alternate: string = compileOperand(initial, opts);
      return `(${test} ? ${consequent} : ${alternate})`;
    }
    // Switch — bind the discriminant's string form once, then chain strict-equality tests.
    const discriminant: string = compileOperand(target, opts);
    const chain = Object.entries(node.cases ?? {})
      .map(([k, v]) => `_d === ${JSON.stringify(k)} ? ${compileOperand(v, opts)} : `)
      .join("");
    const fallback = "default" in node ? compileOperand(node.default, opts) : "undefined";
    return `((_d) => ${chain}${fallback})(String(${discriminant}))`;
  }

  // ─── Binary (pure) ───
  if (BINARY_OPS.has(operator)) {
    const left: string = compileOperand(target, opts);
    const right: string = compileOperand(value, opts);
    return `(${left} ${operator} ${right})`;
  }

  // ─── Assignment ───
  if (ASSIGNMENT_OPS.has(operator)) {
    const lhs: string = compileTarget(target, opts);
    const rhs: string = compileOperand(value, opts);
    return `${lhs} ${operator} ${rhs}`;
  }

  // ─── Array methods ───
  if (ARRAY_METHOD_OPS.has(operator)) {
    const arr: string = compileTarget(target, opts);
    switch (operator) {
      case "push": {
        return `${arr}.push(${compileOperand(value, opts)})`;
      }
      case "unshift": {
        return `${arr}.unshift(${compileOperand(value, opts)})`;
      }
      case "pop": {
        return `${arr}.pop()`;
      }
      case "shift": {
        return `${arr}.shift()`;
      }
      case "splice": {
        const args: string = Array.isArray(value)
          ? value.map((o) => compileOperand(o, opts)).join(", ")
          : compileOperand(value, opts);
        return `${arr}.splice(${args})`;
      }
      default: {
        break;
      }
    }
  }

  // ─── Pure standard-library methods (spec §19.4d) ───
  if (PURE_METHOD_OPS.has(operator)) {
    const receiver: string = compileOperand(target, opts);
    const args: string =
      value === undefined
        ? ""
        : Array.isArray(value)
          ? value.map((o) => compileOperand(o, opts)).join(", ")
          : compileOperand(value, opts);
    // ?.method?.() matches the interpreter: missing receiver or method yields undefined.
    return `(${receiver})?.${operator}?.(${args})`;
  }

  // ─── Aggregates (pure) ───
  if (AGGREGATE_OPS.has(operator)) {
    const arr: string = compileOperand(target, opts);
    // SAFETY: an aggregate's `value` is its per-item expression node (spec §19.4a), the only shape the schema admits there.
    const itemExpr: string = compileExpression(value as JxExpressionNode, opts);
    if (operator === "reduce") {
      const seed: string = compileOperand(initial, opts);
      return `${arr}.reduce((_acc, _item, _index) => ${itemExpr}, ${seed})`;
    }
    if (operator === "map") {
      return `${arr}.map((_item, _index) => ${itemExpr})`;
    }
    if (operator === "filter") {
      return `${arr}.filter((_item, _index) => ${itemExpr})`;
    }
  }

  return "undefined";
}

// ─── Statement-Engine Surface (spec §20) ─────────────────────────────────────

/**
 * Evaluate a bare operand (pointer, literal, or nested node) outside a node position — used by
 * statement execution (spec §20) for `if` tests and `$switch` discriminants.
 */
export function evaluateOperand(
  operand: JxExpressionOperand | undefined,
  state: JxScope,
  event: Event | null,
  iterCtx?: IterCtx,
): JxScopeValue {
  return resolveOperand(operand, state, event, iterCtx);
}

/** Compile a bare operand to JS source — the statement compiler's counterpart to evaluateOperand. */
export function compileOperandSource(
  operand: JxExpressionOperand | undefined,
  opts: CompileOpts = {},
): string {
  return compileOperand(operand, opts);
}

export type { CompileOpts, IterCtx };
