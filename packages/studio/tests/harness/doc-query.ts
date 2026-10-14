/**
 * Doc-query.js — tiny read helpers for writing outcome assertions against a final Jx document.
 *
 * Outcome assertions (the rubric's Completeness axis) check _what the document became_, independent
 * of which tools the model used to get there.
 *
 * See docs/extending/contributing/ai-evals.md.
 */

import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";

/**
 * A node as the model may have written it. The document is whatever came back from the run, so
 * every member is optional and read defensively; only the ones these helpers walk are named.
 */
interface WrittenNode {
  children?: unknown;
  text?: unknown;
  textContent?: unknown;
}

/** Whether a value is a node at all: any non-null object, the test `typeof n === "object"` made. */
function isWrittenNode(value: unknown): value is WrittenNode {
  return isNonNullObject(value);
}

/** Depth-first list of every node in the document (root included). */
export function allNodes(doc: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!isWrittenNode(n)) {
      return;
    }
    out.push(n);
    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        walk(c);
      }
    }
  };
  walk(doc);
  return out;
}

/** Concatenated visible text — text nodes, textContent, and string children. */
export function textOf(doc: any): string {
  const parts: any[] = [];
  const walk = (n: any) => {
    if (isString(n)) {
      parts.push(n);
      return;
    }
    if (!isWrittenNode(n)) {
      return;
    }
    if (n.text) {
      parts.push(n.text);
    }
    if (n.textContent) {
      parts.push(n.textContent);
    }
    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        walk(c);
      }
    }
  };
  walk(doc);
  return parts.join(" ");
}

/**
 * True if any node has a style property satisfying `pred` (a predicate or a substring).
 *
 * @param prop - CamelCase style key, e.g. "fontSize"
 */
export function anyStyle(
  doc: any,
  prop: string,
  pred: ((value: string) => boolean) | string,
): boolean {
  const test = isFunction(pred)
    ? pred
    : (v: string) => String(v).toLowerCase().includes(pred.toLowerCase());
  return allNodes(doc).some(
    (n) => n.style && n.style[prop] !== undefined && test(String(n.style[prop])),
  );
}

/** True if any node matches `pred`. */
export function anyNode(doc: any, pred: (node: any) => boolean): boolean {
  return allNodes(doc).some((node) => pred(node));
}
