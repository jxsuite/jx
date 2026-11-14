/**
 * Policy.ts — the numbers and words a turn is bounded and reported by.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { proceedAlways } from "../tools.ts";
import type { TurnPolicy } from "./types.ts";

/** Average characters per token: the estimate every budget used before providers reported counts. */
export const CHARS_PER_TOKEN = 4;

/**
 * The defaults: thirty rounds of work, sixty rounds in all, three identical rounds, and the texts a
 * turn ends on (specs/ai.md §3.2, §3.4, §3.8).
 *
 * Thirty bounds AUTONOMOUS work. It was five, which a turn spent finding its way around a project
 * before it had changed or answered anything. A round that ends by blocking on a person is the
 * opposite of runaway (it cannot advance without them), so a round whose calls were all interactive
 * does not spend that budget. Sixty is the backstop that keeps a turn provably finite anyway, and a
 * model going round in circles is stopped long before either, by its repeating itself.
 */
export const DEFAULT_TURN_POLICY: TurnPolicy = {
  maxWorkRounds: 30,
  maxRounds: 60,
  maxIdenticalRounds: 3,
  parallelReadOnly: false,
  estimateTokens: (text) => Math.ceil(text.length / CHARS_PER_TOKEN),
  closingText: (reason) =>
    `${
      reason === "repeating"
        ? "Your last tool calls keep returning the same results, so they will not help."
        : "This turn has used its whole tool budget."
    } No further tool call will run. This note is from the system, not the author. Reply to the ` +
    `author now in plain text: answer as much as you can from what you already found, say what ` +
    `you changed, and say what is left. They can ask you to continue in their next message.`,
  capText: ({ maxWorkRounds, reason, applied, errors }) => {
    const unique = [...new Set(errors)];
    const appliedPart =
      applied.length > 0
        ? `\n\nChanges applied so far:\n${applied.map((s) => `- ${s}`).join("\n")}`
        : "";
    const errorPart =
      unique.length > 0 ? `\n\nErrors encountered:\n${unique.map((e) => `- ${e}`).join("\n")}` : "";
    const why =
      reason === "repeating"
        ? "I stopped because my tool calls kept returning the same results."
        : `I ran out of tool-call rounds (${maxWorkRounds}) before finishing.`;
    return (
      `${why}${appliedPart}${errorPart}` +
      `\n\nYou can continue by sending another message, or try a more specific request.`
    );
  },
  emptyText: "The model sent back an empty reply.",
  approval: proceedAlways,
  suspendOn: [],
};
