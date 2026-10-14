/// <reference lib="dom" />
/**
 * Parent-side live expression preview (`spec.md` §19.9).
 *
 * Evaluates an expression node against the canvas iframe's last dataScope snapshot
 * (tab.session.canvas.scope) on a structuredClone, so mutating operators are safe — they mutate the
 * clone, never the live canvas. The engine's trace hook reports every sub-node's value keyed by its
 * path within the tree; values are formatted to display strings at report time so later mutations
 * of the clone cannot retroactively change a badge.
 */

import { evaluateExpression, isMutating } from "@jxsuite/runtime/expression";
import { isNonNullObject } from "@jxsuite/schema/guards";
import { toRaw } from "../reactivity";
// Imported for local use AND re-exported below so existing consumers keep their import site.
// oxlint-disable-next-line unicorn/prefer-export-from
import { formatPreviewValue } from "../utils/preview-format";
import type { PreviewValue } from "../utils/preview-format";

import type { JxScope } from "@jxsuite/runtime/types";
import type { JxExpressionNode, JxExpressionOperand } from "@jxsuite/schema/types";

export interface ExpressionPreview {
  /** Path-keyed display values: "" is the root node, "value/target" a nested operand, etc. */
  values: Map<string, string>;
  /** Evaluation error message, if the expression threw. */
  error: string | null;
  /** Whether the root operator mutates its target (badge renders as an effect, not a value). */
  mutating: boolean;
}

// The formatter is shared with the in-iframe live evaluator: it lives in utils/preview-format.ts
// (dependency-light, safe for the iframe bundle) and is re-exported here so existing consumers
// Keep their import site.
export { formatPreviewValue };

/**
 * Evaluate `node` against a scope snapshot for display. Returns null when no snapshot is available
 * (canvas not yet rendered) — the editor renders no badges rather than wrong ones.
 */
export function previewExpression(
  node: JxExpressionOperand | undefined,
  scope?: JxScope | null,
): ExpressionPreview | null {
  if (!scope || !isNonNullObject(node) || !("operator" in node)) {
    return null;
  }

  let state: JxScope;
  try {
    // Callers hand over tab.session.canvas.scope, which the reactive session tree wraps in a
    // Proxy — structuredClone rejects proxies, so unwrap to the raw snapshot first.
    state = structuredClone(toRaw(scope));
  } catch {
    // Snapshot values are JSON-safe by construction (serialize-scope), but stay defensive.
    return null;
  }

  const values = new Map<string, string>();
  /* SAFETY: an operand object carrying `operator` is the expression-node member of the operand
     union (the plain-object member is an options bag, which has no operator), and a node whose
     other members are malformed throws inside `evaluateExpression`, which this preview reports
     as its `error` rather than trusting. */
  const expr = node as JxExpressionNode;
  let errorMessage: string | null = null;
  try {
    void evaluateExpression(expr, state, null, undefined, {
      report: (path, value) => {
        /* SAFETY: the trace reports raw runtime values, and PreviewValue names every category a JS
           value falls in (primitive, bigint, symbol, function, array, record); formatting relies on
           nothing beyond what JSON.stringify and String() accept for any value. */
        values.set(path.join("/"), formatPreviewValue(value as PreviewValue));
      },
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  return { error: errorMessage, mutating: isMutating(expr.operator), values };
}
