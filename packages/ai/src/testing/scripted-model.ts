/**
 * A scripted model: each round answers with the next list of frames.
 *
 * @module @jxsuite/ai/testing
 */

import type { ModelFn, ModelRequest } from "../harness/types.ts";
import type { WireEvent } from "../streaming-client.ts";

/** A model function that also remembers what it was asked. */
export type ScriptedModel = ModelFn & {
  /** Every request so far, in order. */
  readonly requests: ModelRequest[];
};

/**
 * A model function that answers its n-th call with `rounds[n]`, and a call past the last with a
 * bare `done`. It counts across turns, so a turn that suspends and a turn that resumes it can share
 * one, as the model behind both would be one.
 *
 * @param {readonly (readonly WireEvent[])[]} rounds - The frames of each round, in order
 * @returns {ScriptedModel}
 */
export function scriptedModel(rounds: readonly (readonly WireEvent[])[]): ScriptedModel {
  const requests: ModelRequest[] = [];
  const model: ModelFn = async function* model(request) {
    const frames = rounds[requests.length];
    requests.push(request);
    yield* frames ?? [{ stopReason: "stop", type: "done" }];
  };
  return Object.assign(model, { requests });
}
