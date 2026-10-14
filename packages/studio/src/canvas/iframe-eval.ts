/**
 * In-iframe live expression evaluation (M6) — answers the parent's `evalExpr` requests against the
 * LIVE resolved scope of the current render (buildScope's `$defs`), so previews see real repeater
 * items, real `window#/` globals, and uncapped data values instead of the parent's serialized
 * snapshot.
 *
 * Safety: every expression evaluates against a fresh plain-data clone of the scope (a per-key JSON
 * round-trip, the serialize-scope idiom — it reads through the runtime's reactive proxies), so
 * mutating operators write into the clone and never touch the live canvas. Named-formula callables
 * (pure `$expression` entries with parameters) are kept BY REFERENCE so `call` nodes work; every
 * other function (side-effecting handlers, server fns) is dropped so a preview can never run one.
 */

import { evaluateExpression } from "@jxsuite/runtime/expression";
import { resolveRef } from "@jxsuite/runtime";
import { isFunction, isJsonObject, isNonNullObject, isRef } from "@jxsuite/schema/guards";
import { formatPreviewValue } from "../utils/preview-format";
import type { PreviewValue } from "../utils/preview-format";

import type { JxScope } from "@jxsuite/runtime/types";
import type {
  JsonValue,
  JxDocumentValue,
  JxExpressionNode,
  JxMutableNode,
  JxStateDefinition,
} from "@jxsuite/schema/types";
import type { EvalExprResult } from "./iframe-protocol";

/**
 * Whether the raw (document) state entry is a pure named-formula (`$expression` + parameters).
 *
 * Looser than `isNamedFormulaDef`: an empty `parameters` array, or an `$expression` that is not an
 * object, still qualifies.
 */
function isNamedFormulaEntry(
  entry: JxStateDefinition | undefined,
): entry is JxStateDefinition & { parameters: JxDocumentValue[] } {
  return isJsonObject(entry) && "$expression" in entry && Array.isArray(entry["parameters"]);
}

/** A structured clone of `value`, or null when it holds something uncloneable (a function, a node). */
function cloneOrNull<T>(value: T): T | null {
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

/**
 * Clone the live `$defs` scope into a plain object safe to evaluate (and mutate) against. Data
 * values are JSON round-tripped per key (reads through reactive proxies, unwraps top-level refs);
 * functions survive only when their raw state entry is a pure named formula — anything else
 * callable (event handlers, structured-body functions, server fns) is dropped so a stray `call`
 * can't run a side effect against the live canvas.
 */
export function cloneLiveScope(
  defs: JxScope,
  rawState: Record<string, JxStateDefinition> | null,
): JxScope {
  const out: JxScope = {};
  for (const key of Object.keys(defs)) {
    try {
      // Reading through the reactive proxy auto-unwraps a top-level ref/computed — and can throw (a
      // Computed getter that throws), which maps the key to null instead of aborting the clone.
      const value = defs[key];
      if (isFunction(value)) {
        if (isNamedFormulaEntry(rawState?.[key])) {
          out[key] = value; // A pure formula callable — safe (and needed) for `call` nodes.
        }
        continue;
      }
      /* SAFETY: A widening. `JSON.stringify` answers undefined for undefined, a symbol or a function,
         which lib.d.ts's `string` return type leaves out. */
      const json = JSON.stringify(value) as string | undefined;
      // SAFETY: `json` is JSON.stringify's own output above, so it parses back to JSON data.
      out[key] = json === undefined ? null : (JSON.parse(json) as JsonValue);
    } catch {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Bind repeater `$map` contexts for a node at `contextPath`: walk the shadow doc along the path
 * and, at every repeater crossing (a `$prototype: "Array"` node entered through its `map`
 * template), resolve the repeater's `items` against the scope built so far and layer the FIRST
 * item's `$map` context (item + index 0) over it — the same shape `renderMappedArrayInto` gives
 * rendered items, so `$map/item` / `$map/index` refs preview against real data. Nested repeaters
 * chain naturally (an inner `items` ref may read the outer `$map/item`).
 */
export function bindRepeaterContext(
  scope: JxScope,
  shadowDoc: JxMutableNode | null,
  contextPath: (string | number)[] | null,
): JxScope {
  if (!contextPath || contextPath.length === 0) {
    return scope;
  }
  let node: JxDocumentValue | undefined = shadowDoc;
  let bound = scope;
  for (const seg of contextPath) {
    if (!isNonNullObject(node)) {
      break;
    }
    /* SAFETY: The shadow doc is JSON, so every non-null object on the walk is a document object or
       array, and indexing either by a path segment yields another document value or undefined. */
    const rec = node as Record<string, JxDocumentValue | undefined>;
    if (rec["$prototype"] === "Array" && seg === "map") {
      // Entering the repeater's template — bind the first item's context before descending.
      const itemsDef = rec["items"];
      const items = isRef(itemsDef) ? resolveRef(itemsDef.$ref, bound) : itemsDef;
      if (Array.isArray(items) && items.length > 0) {
        const [first] = items;
        // Items resolved from the shadow doc (a literal array) must not be mutable through the
        // Preview scope — clone; scope-resolved items are already clone data, so this is free.
        const item = cloneOrNull(first);
        /* SAFETY: `Object.create(bound)` is an empty object whose prototype is the scope built so far,
           so it is a scope that reads every outer key through and owns only the three set below. */
        const child = Object.create(bound) as JxScope;
        child["$map"] = { index: 0, item };
        child["$map/item"] = item;
        child["$map/index"] = 0;
        bound = child;
      }
    }
    node = rec[seg];
  }
  return bound;
}

/**
 * Evaluate each requested expression against a fresh clone of the live scope (with the repeater
 * context for `contextPath` bound), reporting every sub-node's value through the engine's trace
 * hook as pre-formatted display strings. Exceptions are guarded per expression into `error`.
 */
export function evaluateLiveExprs(
  exprs: { id: string; node: unknown }[],
  defs: JxScope,
  shadowDoc: JxMutableNode | null,
  contextPath: (string | number)[] | null,
): EvalExprResult[] {
  const rawState = shadowDoc?.state ?? null;
  return exprs.map(({ id, node }) => {
    const values = new Map<string, string>();
    // A fresh scope per expression: a mutating operator writes into this clone only, and can never
    // Leak into the next expression's evaluation (or the live canvas).
    let scope: JxScope;
    try {
      scope = bindRepeaterContext(cloneLiveScope(defs, rawState), shadowDoc, contextPath);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), id, values: [] };
    }
    try {
      if (!isNonNullObject(node) || !("operator" in node)) {
        throw new Error("not an expression node");
      }
      /* SAFETY: `operator` is the key every expression node carries, and `evaluateExpression`
         validates the operator itself, throwing on an unknown one into the catch below. */
      void evaluateExpression(node as JxExpressionNode, scope, null, undefined, {
        report: (path, value) => {
          /* SAFETY: the trace reports raw runtime values, and PreviewValue names every category a JS
             value falls in (primitive, bigint, symbol, function, array, record); formatting relies on
             nothing beyond what JSON.stringify and String() accept for any value. */
          values.set(path.join("/"), formatPreviewValue(value as PreviewValue));
        },
      });
      return { id, values: [...values.entries()] };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        id,
        values: [...values.entries()],
      };
    }
  });
}
