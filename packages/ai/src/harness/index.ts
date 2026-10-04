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

export { LaneBusyError, createTurnLock } from "./lock.ts";
export { fromStreamingClient, joinSystem } from "./model.ts";
export { DEFAULT_TURN_POLICY } from "./policy.ts";
export { runTurn } from "./run.ts";

export type {
  HarnessEvent,
  ModelFn,
  ModelRequest,
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
