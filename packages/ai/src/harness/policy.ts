/**
 * Policy.ts — the numbers and words a turn is bounded and reported by.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import type { TurnPolicy } from "./types.ts";

/** Average characters per token: the estimate every budget used before providers reported counts. */
const CHARS_PER_TOKEN = 4;

/**
 * The defaults: five rounds of work, twenty-five rounds in all, and the texts the agent loop has
 * always used (specs/ai.md §3.2, §3.4).
 *
 * Five bounds AUTONOMOUS work. A round that ends by blocking on a person is the opposite of runaway
 * (it cannot advance without them), so a round whose calls were all interactive does not spend that
 * budget. Twenty-five is the backstop that keeps a turn provably finite anyway.
 */
export const DEFAULT_TURN_POLICY: TurnPolicy = {
  maxWorkRounds: 5,
  maxRounds: 25,
  estimateTokens: (text) => Math.ceil(text.length / CHARS_PER_TOKEN),
  capText: ({ maxWorkRounds, applied, errors }) => {
    const unique = [...new Set(errors)];
    const appliedPart =
      applied.length > 0
        ? `\n\nChanges applied so far:\n${applied.map((s) => `- ${s}`).join("\n")}`
        : "";
    const errorPart =
      unique.length > 0 ? `\n\nErrors encountered:\n${unique.map((e) => `- ${e}`).join("\n")}` : "";
    return (
      `I ran out of tool-call rounds (${maxWorkRounds}) before finishing.${appliedPart}${errorPart}` +
      `\n\nYou can continue by sending another message, or try a more specific request.`
    );
  },
  emptyText: "The model sent back an empty reply.",
};
