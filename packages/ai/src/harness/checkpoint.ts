/**
 * Checkpoint.ts — what a suspended turn may be resumed against (specs/ai.md §3.12).
 *
 * A checkpoint holds a turn's own messages and the calls it had not run. Continuing it under other
 * tools, another policy or another system prompt would run those calls in a turn the model never
 * planned them for, so a checkpoint records a digest of each, and a resume that does not match is
 * refused rather than guessed at.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { digest } from "../messages/digest.ts";
import { joinSystem } from "./model.ts";
import { DEFAULT_TURN_POLICY } from "./policy.ts";
import type { TurnCheckpoint, TurnInput, TurnPolicy } from "./types.ts";

/**
 * A policy's identity: its numbers, its switches, and the words it would say. Its functions cannot
 * be compared, so each is asked for what it says in every case it distinguishes; the approval
 * policy is a decision the host makes afresh on resume, and is not part of it.
 *
 * @param {TurnPolicy} policy
 * @returns {string}
 */
export function policyDigest(policy: TurnPolicy): string {
  return digest({
    closing: [policy.closingText("budget"), policy.closingText("repeating")],
    emptyText: policy.emptyText,
    maxIdenticalRounds: policy.maxIdenticalRounds,
    maxRounds: policy.maxRounds,
    maxWorkRounds: policy.maxWorkRounds,
    parallelReadOnly: policy.parallelReadOnly,
    suspendOn: policy.suspendOn,
  });
}

/** The three digests a checkpoint records of the turn it was taken in. */
export interface TurnDigests {
  readonly catalogDigest: string;
  readonly policyDigest: string;
  readonly systemDigest: string;
}

/**
 * The digests of the tools, the policy and the system prompt a turn input describes. The tools are
 * digested as the model is told about them: a tool whose name, description or schema changed is a
 * different tool to a call planned against the old one.
 *
 * @param {TurnInput} input
 * @returns {TurnDigests}
 */
export function turnDigests(input: TurnInput): TurnDigests {
  return {
    catalogDigest: digest(input.tools.listForLLM()),
    policyDigest: policyDigest({ ...DEFAULT_TURN_POLICY, ...input.policy }),
    systemDigest: digest(joinSystem(input.system)),
  };
}

/**
 * Whether a checkpoint may be resumed by `input`: the same tools, policy and system prompt, and the
 * same model when the input names one. A refusal says which of them changed.
 *
 * @param {TurnCheckpoint} checkpoint
 * @param {TurnInput} input - The input the resume would run with
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function checkResume(
  checkpoint: TurnCheckpoint,
  input: TurnInput,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const now = turnDigests(input);
  if (checkpoint.catalogDigest !== now.catalogDigest) {
    return { ok: false, reason: "the tools on offer changed since it was suspended" };
  }
  if (checkpoint.policyDigest !== now.policyDigest) {
    return { ok: false, reason: "the turn policy changed since it was suspended" };
  }
  if (checkpoint.systemDigest !== now.systemDigest) {
    return { ok: false, reason: "the system prompt changed since it was suspended" };
  }
  const model = input.modelInfo;
  if (
    model &&
    (model.family !== checkpoint.model.family || model.model !== checkpoint.model.model)
  ) {
    return { ok: false, reason: "the model changed since it was suspended" };
  }
  return { ok: true };
}
