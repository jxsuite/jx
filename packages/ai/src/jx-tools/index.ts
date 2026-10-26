/**
 * `@jxsuite/ai/jx-tools`: the assistant's document tools, portable to any host (specs/ai.md §3.9).
 *
 * Each tree tool is a pure producer of `@jxsuite/schema/doc-ops` ops, and a {@link DocumentHost}
 * applies them in its own transaction: Studio's tab history, a file on disk, a room's document.
 * Worker-safe: the module graph is this directory, `../tools.ts` and two `@jxsuite/schema` leaves.
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 * @docs extending/embedding/assistant-harness
 */

export { coerceIndex } from "@jxsuite/schema/doc-ops";
export { DOC_TOOLS } from "./doc-tools.ts";
export { docToolEntries, FROZEN_SENTENCE } from "./entries.ts";
export type {
  DocEdit,
  DocTool,
  DocToolName,
  DocumentHost,
  DocumentRef,
  EditMeta,
  EditReceipt,
  SelectionEffect,
  Undoability,
  WriteReporter,
} from "./types.ts";
