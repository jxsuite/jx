/**
 * Which case of a `$switch` the canvas draws (`canvas.setSwitchCase`, studio.md §4.5).
 *
 * A `$switch` draws the case its discriminant selects, and on the editing canvas no handler runs to
 * change what that is: a tabs component is only ever seen on its first tab, a state machine only in
 * its first state. A case chosen for the canvas is the answer, and it is view state like a state
 * value set for the canvas (`state-values.ts`): the tab keeps `{ path: case }`, and the render
 * document is built with that switch reading a value of the tab's own in place of its discriminant.
 * Nothing is written to the document, so nothing is saved, undone or replicated.
 *
 * It is done by rebuilding and not by a message to the frame because which case is drawn decides
 * which nodes exist, as the row cap does: the frame draws the case at its own `cases` path, where
 * it is selected and edited as it is stored.
 *
 * @docs studio/interface/canvas
 */

import { isJsonObject, isRef } from "@jxsuite/schema/guards";

import type { JxDocumentValue, JxMutableNode, JxStateDefinition } from "@jxsuite/schema/types";
import type { JxPath } from "../state";

/** The cases chosen for a tab, by the switch's document path as `JSON.stringify` writes it. */
export type SwitchCases = Readonly<Record<string, string>>;

/** What a chosen case is read from: a state key no document can declare by accident. */
const CASE_KEY = "$__case:";

/** The names of a `$switch` node's cases, in the order it writes them; none for any other node. */
export function switchCaseNames(node: JxDocumentValue | undefined): string[] {
  if (!isJsonObject(node) || !("$switch" in node) || !isJsonObject(node["cases"])) {
    return [];
  }
  return Object.keys(node["cases"]);
}

/** `node` with the value at `path` replaced by `put`'s answer, sharing everything off the path. */
function rebuiltAt(
  node: JxDocumentValue | undefined,
  path: JxPath,
  put: (held: JxDocumentValue | undefined) => JxDocumentValue | undefined,
): JxDocumentValue | undefined {
  const [head, ...rest] = path;
  if (head === undefined) {
    return put(node);
  }
  if (Array.isArray(node)) {
    const index = Number(head);
    const next = rebuiltAt(node[index], rest, put);
    return next === node[index] ? node : node.with(index, next ?? null);
  }
  if (!isJsonObject(node)) {
    return node;
  }
  /* SAFETY: a document object's members are document values. */
  const held = (node as Record<string, JxDocumentValue | undefined>)[String(head)];
  const next = rebuiltAt(held, rest, put);
  return next === held ? node : { ...node, [String(head)]: next };
}

/** What {@link withSwitchCases} answers: the document to prepare, and the state its switches read. */
export interface SwitchedDocument {
  doc: JxMutableNode;
  /** The entries to add to the render document's state, empty when no case applies. */
  state: Record<string, JxStateDefinition>;
}

/**
 * `doc` with each chosen case in its switch's place, or `doc` itself when none applies. A rebuild,
 * never a write: only the nodes on the way to a switch are copied.
 *
 * A choice is applied only where it still names something: the node at its path is a `$switch`
 * whose discriminant is a `{ "$ref" }` (the one form the runtime reads) and which has that case. A
 * path that moved under an edit, a case renamed or deleted, leave the choice naming nothing, and
 * the switch draws its live case again.
 */
export function withSwitchCases(doc: JxMutableNode, chosen: SwitchCases): SwitchedDocument {
  const state: Record<string, JxStateDefinition> = {};
  let out: JxDocumentValue | undefined = doc;
  for (const [index, [key, name]] of Object.entries(chosen).entries()) {
    let path: JxPath;
    try {
      // SAFETY: only `canvas.setSwitchCase` writes these keys, as JSON of a document path.
      path = JSON.parse(key) as JxPath;
    } catch {
      continue;
    }
    const stateKey = `${CASE_KEY}${index}`;
    out = rebuiltAt(out, path, (held) => {
      if (!isJsonObject(held) || !isRef(held["$switch"]) || !switchCaseNames(held).includes(name)) {
        return held;
      }
      state[stateKey] = { default: name };
      return { ...held, $switch: { $ref: `#/state/${stateKey}` } };
    });
  }
  /* SAFETY: `rebuiltAt` answers an object for an object, and `doc` is one. */
  return { doc: out as JxMutableNode, state };
}
