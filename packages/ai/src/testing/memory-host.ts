/**
 * An in-memory harness host: a document the portable tree tools read and write, and a place to keep
 * checkpoints, with nothing behind either but this process.
 *
 * It exists so a test can run a whole turn (or the same turn two ways, inline and suspended) and
 * compare the documents they leave, with no Studio and no disk (specs/ai.md §3.9, §3.12).
 *
 * @module @jxsuite/ai/testing
 */

import { applyDocOpsWithInverse } from "@jxsuite/schema/doc-ops";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { TurnCheckpoint } from "../harness/types.ts";
import type { DocumentHost, DocumentRef, WriteReporter } from "../jx-tools/types.ts";

/** What {@link createMemoryHarnessHost} hands back. */
export interface MemoryHarnessHost {
  /** The host the tree tools are built over (`docToolEntries(host.documents, …)`). */
  readonly documents: DocumentHost;
  /** A reporter that brackets each write with nothing, and answers the producer's own summary. */
  readonly reporter: WriteReporter<null>;
  /** The document as it stands now. */
  readonly document: () => JxMutableNode;
  /** Checkpoints by turn id, for a test that stores one and resumes it. */
  readonly checkpoints: Map<string, TurnCheckpoint>;
}

/**
 * A host holding one document in memory. It cannot undo, so an edit its producer refuses is not
 * applied, and one it accepts is applied to the live document at once.
 *
 * @param {JxMutableNode} initial - The document to start from; it is copied, never written
 * @returns {MemoryHarnessHost}
 */
export function createMemoryHarnessHost(initial: JxMutableNode): MemoryHarnessHost {
  const live = structuredClone(initial);
  const ref: DocumentRef = { id: "memory", path: null };
  const documents: DocumentHost = {
    edit(_ref, produce) {
      const edit = produce(live);
      if (!edit.ok) {
        return { applied: false, message: edit.error, reason: "refused" };
      }
      applyDocOpsWithInverse(live, edit.ops);
      return { applied: true, changed: edit.ops.length > 0 };
    },
    resolve: () => ref,
    snapshot: () => live,
    undoable: "none",
  };
  const reporter: WriteReporter<null> = {
    after: (_ref, _before, summary) => Promise.resolve({ success: true, summary }),
    before: () => Promise.resolve(null),
  };
  return { checkpoints: new Map(), document: () => structuredClone(live), documents, reporter };
}
