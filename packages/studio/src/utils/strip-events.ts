/**
 * Strip `on*` event-handler bindings from a Jx document tree (returns a shallow-rebuilt copy). Used
 * to neutralize handlers before edit/design rendering so the canvas never wires live behavior, and
 * to drop `timing: "server"` state entries the canvas can't run.
 *
 * Lives in its own dependency-light module (it pulls only the pure `@jxsuite/schema/guards`
 * predicate) so the slim canvas-iframe subtree renderer can import it without dragging in the
 * editor's reactive `store.ts`; `store.ts` re-exports it for the legacy in-realm patcher.
 */

import {
  isEventBinding,
  isJsonObject,
  isNodeObject,
  isNonNullObject,
} from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/**
 * A node object as a document walker rebuilds it. Every key holds a document value, including the
 * keys {@link JxMutableNode} names, because a walker copies whatever the source document holds;
 * `undefined` is a key an editor cleared.
 */
export type RebuiltNode = Record<string, JxDocumentValue | undefined>;

/**
 * Whether a walker descends into `value`: any object, arrays included. A document is JSON, so every
 * own value of such an object is itself a document value.
 *
 * @param value A value read out of a document.
 */
export function isDocumentContainer(
  value: JxDocumentValue | undefined,
): value is JxDocumentValue[] | Readonly<RebuiltNode> {
  return isNonNullObject(value);
}

/**
 * Strip all `on*` event-handler properties (and server-timed state) from a document tree. Arrays
 * are stripped member by member, and primitives and a cleared (`undefined`) key return unchanged,
 * so the walk can recurse through any document value.
 */
export function stripEventHandlers(node: JxMutableNode): JxMutableNode;
export function stripEventHandlers(node: JxDocumentValue): JxDocumentValue;
export function stripEventHandlers(node: JxDocumentValue | undefined): JxDocumentValue | undefined;
export function stripEventHandlers(node: JxDocumentValue | undefined): JxDocumentValue | undefined {
  if (Array.isArray(node)) {
    // Arrays of nodes round-trip element-wise; the array itself is not a node.
    return node.map((n) => stripEventHandlers(n));
  }
  if (!isNodeObject(node)) {
    return node;
  }
  const out: RebuiltNode = {};
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("on") && isEventBinding(v)) {
      continue;
    }
    if (k === "children") {
      out.children = Array.isArray(v) ? v.map((c) => stripEventHandlers(c)) : stripEventHandlers(v);
    } else if (k === "cases" && isDocumentContainer(v)) {
      const cases: RebuiltNode = {};
      for (const [ck, cv] of Object.entries(v)) {
        cases[ck] = stripEventHandlers(cv);
      }
      out.cases = cases;
    } else if (k === "state" && isDocumentContainer(v)) {
      const state: RebuiltNode = {};
      for (const [sk, sv] of Object.entries(v)) {
        if (isJsonObject(sv) && sv.timing === "server") {
          continue;
        }
        state[sk] = sv;
      }
      out.state = state;
    } else {
      out[k] = v;
    }
  }
  return out;
}
