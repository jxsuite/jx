/**
 * Types.ts — the turn engine's contract: what a host hands `runTurn`, and what it hears back.
 *
 * Type-only. `@jxsuite/ai/harness` re-exports all of it; the engine lives in `run.ts`.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import type { AiWrite, SessionFacts, ToolRegistry, ToolResult, WriteLedger } from "../tools.ts";
import type {
  ChatMessage,
  JsonValue,
  ProviderFamily,
  SystemBlock,
  ToolSpec,
} from "../messages/types.ts";
import type { StreamEvent, StreamUsageEvent } from "../streaming-client.ts";

/** What one round asks the model. */
export interface ModelRequest {
  /** Fixed for the whole turn. */
  readonly system: readonly SystemBlock[];
  /** The conversation so far, this turn's own messages included. */
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
}

/** Streams one round's answer. Called exactly once per round. */
export type ModelFn = (request: ModelRequest, signal: AbortSignal) => AsyncIterable<StreamEvent>;

/** A provider's token count for one request. */
export type Usage = Omit<StreamUsageEvent, "type">;

/** Why a turn failed. */
export interface TurnError {
  readonly message: string;
  readonly code?: string;
}

/**
 * How a turn ended.
 *
 * - `complete`: the model stopped calling tools after drawing something.
 * - `cap_partial`: the work budget ran out after something was applied; the turn ends on a message
 *   saying what.
 * - `cap_failed`: the work budget ran out with nothing applied.
 * - `error`: the provider sent an error frame.
 * - `cancelled`: the turn was stopped.
 * - `empty`: the model answered with neither text nor a tool call, and nothing earlier in the turn
 *   was drawn either.
 */
export type TurnOutcomeKind =
  | "complete"
  | "cap_partial"
  | "cap_failed"
  | "error"
  | "cancelled"
  | "empty";

/** The numbers and words a turn is bounded and reported by. */
export interface TurnPolicy {
  /** Rounds that did work: a round whose calls were all interactive does not count. */
  readonly maxWorkRounds: number;
  /** Rounds of every kind, so a turn ends whatever the model does. */
  readonly maxRounds: number;
  /** A token estimate for a text, reported beside each usage count for the system prompt. */
  readonly estimateTokens: (text: string) => number;
  /** What a turn that ran out of work rounds says. */
  readonly capText: (cap: {
    readonly maxWorkRounds: number;
    readonly applied: readonly string[];
    readonly errors: readonly string[];
  }) => string;
  /** What a turn that drew nothing says. */
  readonly emptyText: string;
}

/** What a host can do between the engine's steps. */
export interface TurnHooks {
  /** After a call has settled, before its result is reported. */
  afterTool?: (call: {
    readonly callId: string;
    readonly name: string;
    readonly result: ToolResult;
  }) => void;
  /** When a round ends on the provider's error frame, before `round_end` reports it. */
  onStreamError?: (error: TurnError) => void;
}

/** One turn at a time per lane: acquiring a held lock answers null. */
export interface TurnLock {
  /** The release function, or null when another turn holds the lock. */
  acquire: (turnId: string) => (() => void) | null;
  /** The turn holding the lock, or null. */
  readonly active: string | null;
}

/** Everything one turn runs with. */
export interface TurnInput {
  /**
   * The conversation before this turn's reply: it ends with the message the turn answers. The turn
   * repairs its tool-call pairing before the first request (`transcript_repaired`).
   */
  readonly history: readonly ChatMessage[];
  /** Fixed for the turn. */
  readonly system: readonly SystemBlock[];
  readonly model: ModelFn;
  /** Who answers: named in each call's actor. */
  readonly modelInfo?: { readonly family: ProviderFamily; readonly model: string };
  readonly tools: ToolRegistry;
  /** Stops the turn when it aborts, with its reason. */
  readonly signal?: AbortSignal;
  /** Defaults to a fresh message id. */
  readonly turnId?: string;
  /** Defaults to the session facts' own id. */
  readonly sessionId?: string | null;
  /** The id of round one's message, for a host that has already put a placeholder on screen. */
  readonly firstMessageId?: string;
  /** Mints the ids of the messages the turn adds. Defaults to chat-state's scheme and counter. */
  readonly newId?: () => string;
  /** The clock messages are stamped with. Defaults to `Date.now`. */
  readonly now?: () => number;
  readonly policy?: Partial<TurnPolicy>;
  readonly hooks?: TurnHooks;
  /** What the conversation's tools remember across turns. Defaults to a fresh set. */
  readonly session?: SessionFacts;
  /** Where the turn's tools record their writes. Defaults to a fresh ledger. */
  readonly ledger?: WriteLedger;
  /** Held for the whole turn; a turn started on a held lock throws `LaneBusyError`. */
  readonly lock?: TurnLock;
  /**
   * Called with every event, synchronously and in order, before the engine takes its next step. A
   * host that keeps its own transcript applies each event here.
   */
  readonly onEvent?: (event: HarnessEvent) => void;
}

/** A turn in flight. Iterate it for its events, or await `outcome`. */
export interface TurnRun extends AsyncIterable<HarnessEvent> {
  readonly turnId: string;
  /** The turn's own signal: armed before `runTurn` returns, aborted by `cancel` or `input.signal`. */
  readonly signal: AbortSignal;
  cancel: (reason?: "user" | "superseded" | "shutdown") => void;
  /**
   * Rejects when something the host supplied throws (the model function, the registry's listing, a
   * hook, `onEvent`); a provider failure is an `error` outcome.
   */
  readonly outcome: Promise<TurnOutcome>;
}

/** Every event carries the version, its place in the turn, and the turn. */
interface EventBase {
  readonly v: 1;
  /** Strictly increasing from 0 within a turn. */
  readonly seq: number;
  readonly turnId: string;
}

/** What a turn reports as it runs, in the order it happens. */
export type HarnessEvent = EventBase &
  (
    | { readonly type: "turn_start" }
    | {
        /**
         * The history broke a tool call's pairing with its reply, and the turn repaired it before
         * its first request (`repairToolPairs`, specs/ai.md §3.4). Heard right after `turn_start`,
         * and only when the repair changed something. Each list is in transcript order: the calls
         * given a seal, and the ids of the `tool` messages dropped and moved.
         */
        readonly type: "transcript_repaired";
        readonly sealed: readonly string[];
        readonly dropped: readonly string[];
        readonly moved: readonly string[];
      }
    | {
        readonly type: "round_start";
        readonly round: number;
        readonly workRounds: number;
        readonly messageId: string;
      }
    | { readonly type: "text"; readonly messageId: string; readonly text: string }
    | { readonly type: "reasoning"; readonly messageId: string; readonly text: string }
    | {
        readonly type: "tool_call_start";
        readonly messageId: string;
        readonly callId: string;
        readonly name: string;
      }
    | {
        readonly type: "tool_call_delta";
        readonly messageId: string;
        readonly callId: string;
        readonly args: string;
      }
    | { readonly type: "tool_call_end"; readonly messageId: string; readonly callId: string }
    | {
        readonly type: "usage";
        readonly messageId: string;
        /** The provider's count exactly as the stream reported it. */
        readonly frame: StreamUsageEvent;
        /** The system prompt's estimate, so a later budget can add what it grew by since. */
        readonly systemTokens: number;
      }
    | {
        readonly type: "round_end";
        readonly messageId: string;
        readonly stopReason: string;
        /** The stream ended with no `done` frame. */
        readonly truncated: boolean;
        /** The round's message is gone: it failed, or the turn drew nothing. */
        readonly dropped: boolean;
        readonly error?: TurnError;
      }
    | {
        readonly type: "tool_start";
        readonly callId: string;
        readonly name: string;
        readonly interactive: boolean;
      }
    | { readonly type: "tool_progress"; readonly callId: string; readonly progress: JsonValue }
    | { readonly type: "write"; readonly callId: string; readonly write: AiWrite }
    | {
        readonly type: "tool_result";
        readonly callId: string;
        /** The assistant message that made the call. */
        readonly messageId: string;
        /** The `tool` message the result was appended as. */
        readonly toolMessageId: string;
        readonly result: ToolResult;
      }
    | { readonly type: "turn_end"; readonly outcome: TurnOutcome }
  );

/** How a turn ended, and what it left behind. */
export interface TurnOutcome {
  readonly kind: TurnOutcomeKind;
  readonly turnId: string;
  /** The last assistant message of the turn that was drawn, the cap message included. */
  readonly anchorMessageId: string | null;
  readonly rounds: number;
  readonly workRounds: number;
  readonly writes: readonly AiWrite[];
  readonly usage: { readonly last: Usage | null; readonly total: Usage | null };
  /** Every message the turn added, in its final form. */
  readonly appended: readonly ChatMessage[];
  /** For `cap_partial`: the message the turn ended on. */
  readonly cap?: { readonly messageId: string; readonly text: string };
  /** For `error` and `empty`: the round message that was dropped. */
  readonly removedMessageId?: string;
  /** For `error`, `empty` and `cap_failed`. */
  readonly error?: TurnError;
}
