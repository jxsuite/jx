/**
 * The contracts of the portable document tools (specs/ai.md §3.9): what a producer answers, and
 * what a host provides to run one.
 *
 * @module @jxsuite/ai/jx-tools
 * @license MIT
 */

import type { JxDocOp } from "@jxsuite/schema/doc-ops";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import type { Actor, JSONSchema, ToolArguments, ToolContext, ToolResult } from "../tools.ts";

/** How an edit carries the host's selection across it. */
export type SelectionEffect =
  /** The selection is untouched. */
  | { readonly kind: "keep" }
  /** Every selected path at or under one of `under` is dropped: what it named was replaced. */
  | { readonly kind: "prune"; readonly under: readonly JxPath[] }
  /** A selection whose primary path is `from` moves to `to`, the moved node's post-edit path. */
  | { readonly kind: "follow"; readonly from: JxPath; readonly to: JxPath };

/** What a producer answers: the ops that make the edit, or why it refuses. */
export type DocEdit =
  | {
      readonly ok: true;
      readonly ops: readonly JxDocOp[];
      /** The sentence the model reads on success, naming where the edit landed. */
      readonly summary: string;
      readonly selection: SelectionEffect;
    }
  | { readonly ok: false; readonly error: string };

/** The tree tools a producer exists for. */
export type DocToolName =
  | "set_property"
  | "set_style"
  | "set_text"
  | "add_child"
  | "move_node"
  | "add_state"
  | "update_state";

/** A tree tool as data: what the model is told, and the pure function that plans its edit. */
export interface DocTool {
  readonly name: DocToolName;
  readonly description: string;
  readonly parameters: JSONSchema;
  /**
   * Pure: reads `doc`, never writes it, and answers the ops the edit is. A refusal is an answer,
   * not a throw, so a host can run it once to check and again inside its transaction.
   */
  readonly edit: (doc: Readonly<JxMutableNode>, args: ToolArguments) => DocEdit;
}

/** A document a host has resolved for one call. Compared by identity within that call. */
export interface DocumentRef {
  readonly id: string;
  /** Its project-relative path, or null for one never saved. */
  readonly path: string | null;
}

/** Who is editing, for the host's history and attribution. */
export interface EditMeta {
  readonly actor: Actor;
  readonly callId: string;
  readonly tool: string;
}

/** What a host's edit did. */
export type EditReceipt =
  | { readonly applied: true; readonly changed: boolean }
  | {
      readonly applied: false;
      /**
       * `frozen`: the document refuses structural edits for now (a collaborator holds its source).
       * `refused`: the producer refused against the document as it stood at commit. `invalid`: a
       * host that cannot undo refused an edit that would leave the document invalid. `not-open`:
       * the document is no longer the host's.
       */
      readonly reason: "frozen" | "refused" | "invalid" | "not-open";
      readonly message: string;
    };

/**
 * Whether a host can take an edit back. A host that can (`document`) commits and then reports what
 * the edit broke; one that cannot (`none`) must validate before it commits.
 */
export type Undoability = "document" | "none";

/** Where the tree tools read and write a document. */
export interface DocumentHost {
  readonly undoable: Undoability;
  /** The document this call addresses, or the sentence refusing the call when there is none. */
  readonly resolve: (ctx: ToolContext) => DocumentRef | string;
  /** The document as it stands: plain data, never a reactive proxy. */
  readonly snapshot: (ref: DocumentRef) => Readonly<JxMutableNode>;
  /**
   * Read the document, call `produce`, and apply its ops synchronously, with no await between them,
   * so nothing can change the document between the plan and the write. A returned promise may
   * settle later, for persistence only.
   */
  readonly edit: (
    ref: DocumentRef,
    produce: (doc: Readonly<JxMutableNode>) => DocEdit,
    meta: EditMeta,
  ) => EditReceipt | Promise<EditReceipt>;
}

/**
 * What brackets a write: the document's standing before it (`Before`, whatever the host's verdict
 * compares), and the verdict after it.
 */
export interface WriteReporter<Before> {
  readonly before: (ref: DocumentRef) => Promise<Before>;
  readonly after: (ref: DocumentRef, before: Before, summary: string) => Promise<ToolResult>;
}
