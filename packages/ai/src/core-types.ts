/**
 * Core-types.ts — the shapes a tool call carries, shared by every Jx harness host.
 *
 * Type-only. `./tools` re-exports all of it; the constructors live there (`createLedger`,
 * `createSessionFacts`, `createToolContext`, `linkCallSignal`).
 *
 * A tool used to reach what it needed from its host through module-level slots: the turn's signal
 * and the call's id from Studio's `ai-turn-signal.ts`, the write ledger from `ai-writes.ts`, the
 * one-import guard from a flag in `ai-import-tools.ts`. That tied every tool to one Studio window
 * running one turn. A {@link ToolContext} carries those facts with the call instead, so the same
 * tool can run in a page, a Worker or an MCP server (specs/ai.md §3.7).
 *
 * @license MIT
 * @module @jxsuite/ai/tools
 */

/** A value that survives a JSON round trip unchanged. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** What a tool call answers. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  summary?: string;
}

/** One change the assistant made, as recorded by the tool that made it. */
export interface AiWrite {
  /** Project-relative path, or the document path for an in-editor mutation. */
  path: string;
  /** The tool that did it: the command title the chip renders. */
  tool: string;
  /**
   * True when the change went to disk with no transaction behind it.
   *
   * This is the undo caveat, as a fact rather than a sentence: a `disk` write is NOT reachable by
   * undo, by the tab's history, or by "Restore to here".
   */
  disk: boolean;
  /** False when the tool reported a failure: a listed attempt that changed nothing. */
  ok: boolean;
  /** Why it failed, when it did. */
  error?: string;
}

/** Where a turn's tools record their changes. One per turn; the host files it when the turn ends. */
export interface WriteLedger {
  record: (write: AiWrite) => void;
  /** Every write recorded so far, oldest first. */
  readonly writes: readonly AiWrite[];
}

/** Who a tool call acts for. */
export interface Actor {
  readonly kind: "assistant";
  /** `assistant:<sessionId|local>:<turnId>`: the key history entries and lanes use. */
  readonly id: string;
  readonly turnId: string;
  readonly sessionId: string | null;
  readonly model?: string;
}

/**
 * Per-session JSON facts: what a tool must remember across turns (an import already ran). The host
 * decides how long they last; Studio keeps them until New Chat.
 */
export interface SessionFacts {
  readonly sessionId: string | null;
  get: (key: string) => JsonValue | undefined;
  set: (key: string, value: JsonValue) => void;
}

/** Per-call facts. Host services a tool needs are bound when the tool is built, not passed here. */
export interface ToolContext {
  /**
   * A per-CALL child of the turn's signal: aborts with the turn, and is unlinked when the call
   * settles.
   */
  readonly signal: AbortSignal;
  /**
   * The provider's id for this call. Equals the chip's id, the question's id and the import run's
   * key.
   */
  readonly callId: string;
  readonly actor: Actor;
  readonly ledger: WriteLedger;
  readonly session: SessionFacts;
  /** Report progress on a long call (an import's log lines). A no-op when nothing observes it. */
  progress: (event: JsonValue) => void;
}
