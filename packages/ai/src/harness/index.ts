/**
 * `@jxsuite/ai/harness`: the turn engine (specs/ai.md §3.8).
 *
 * `runTurn` takes a conversation, a model function and a tool registry, and runs one user turn to
 * its end: it streams each round, runs the calls the model made, feeds their results back, and
 * stops when the model stops calling tools or the work budget runs out. Everything it does is an
 * event a host can apply to its own transcript, and how the turn ended is a `TurnOutcome`.
 *
 * Worker-safe: it imports `./tools` and `./messages` and nothing host-bound
 * (`tests/worker-safety.test.ts`, `tsconfig.worker.json`).
 *
 * @module @jxsuite/ai/harness
 * @docs extending/embedding/assistant-harness
 */

export { checkResume, policyDigest, turnDigests } from "./checkpoint.ts";
export { COMPACTION_REQUEST, DEFAULT_COMPACTION, summarizeForCompaction } from "./compaction.ts";
export type { CompactionPolicy } from "./compaction.ts";
export type { TurnDigests } from "./checkpoint.ts";
export { LaneBusyError, createTurnLock } from "./lock.ts";
export { fromStreamingClient, joinSystem } from "./model.ts";
export { CHARS_PER_TOKEN, DEFAULT_TURN_POLICY } from "./policy.ts";
export { assistantActorId, runTurn } from "./run.ts";

export type {
  HarnessEvent,
  InteractionStrategy,
  ModelFn,
  ModelRequest,
  SuspendReason,
  TurnCheckpoint,
  TurnError,
  TurnHooks,
  TurnInput,
  TurnLock,
  TurnOutcome,
  TurnOutcomeKind,
  TurnPolicy,
  TurnRun,
  Usage,
} from "./types.ts";
