/**
 * Compaction.ts — what a host does with a conversation that has outgrown its model (specs/ai.md
 * §2.2, §3.8).
 *
 * A conversation is trimmed between turns, never inside one. There are two ways to trim, and which
 * a family gets follows from what it can bear:
 *
 * - **Keep the tail.** Drop the oldest messages and leave a note saying so. It costs nothing and asks
 *   nothing of the provider, and it is what an OpenAI-compatible provider has always been sent.
 * - **Summarize.** Ask the model for a summary of everything before the new message, and send that in
 *   its place. It costs a request, and it keeps what the conversation decided instead of what
 *   happened to be said last. It also suits a provider that binds its thinking to the request: the
 *   whole prefix is replaced at once, so nothing that follows is bound to a history that was cut in
 *   the middle.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import type { ChatMessage, ProviderFamily } from "../messages/types.ts";
import type { ModelFn, ModelRequest } from "./types.ts";

/** How a conversation that is too long is made to fit. */
export interface CompactionPolicy {
  /** `off` never trims, `keep-tail` drops the oldest messages, `summarize` replaces them. */
  readonly mode: "off" | "keep-tail" | "summarize";
  /** The share of the model's context window past which a conversation is compacted. */
  readonly thresholdRatio: number;
  /** How many of the latest messages `keep-tail` always keeps. `summarize` keeps the new turn. */
  readonly keepRecent: number;
}

/**
 * What each family is compacted with when a host has no reason to choose otherwise: the tail for an
 * OpenAI-compatible provider, as it has always been, and a summary for Claude.
 */
export const DEFAULT_COMPACTION: Readonly<Record<ProviderFamily, CompactionPolicy>> = {
  anthropic: { keepRecent: 20, mode: "summarize", thresholdRatio: 0.8 },
  "openai-compat": { keepRecent: 20, mode: "keep-tail", thresholdRatio: 0.8 },
};

/** What the model is asked for. Written as an instruction from the system, not from the author. */
export const COMPACTION_REQUEST =
  "This note is from the system, not the author. The conversation above has grown too long to " +
  "send in full, so it is about to be replaced by a summary that you write now. Reply with that " +
  "summary and nothing else, in plain text, and call no tool. Say what the author asked for and " +
  "what they decided, what you changed and in which files or documents, anything you learned " +
  "about the project that later work depends on, and what is still to do. Be specific: name " +
  "paths, components and values. Leave out greetings and anything already superseded.";

/**
 * Ask the model to summarize a conversation, and answer what it wrote.
 *
 * `request` is the conversation to summarize, with the system prompt and the tools it was held
 * under: the tools stay listed, because a provider may refuse a history that holds tool calls with
 * no listing beside it, and any call the model makes anyway is ignored. An empty answer means there
 * is no summary to use (the provider failed, the request was stopped, or the model wrote nothing),
 * and the caller compacts some other way.
 *
 * @param {ModelFn} model
 * @param {ModelRequest} request - The conversation to summarize
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
 */
export async function summarizeForCompaction(
  model: ModelFn,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<string> {
  const ask: ChatMessage = {
    blocks: [{ text: COMPACTION_REQUEST, type: "text" }],
    id: "compaction_request",
    meta: { kind: "compaction", origin: "harness" },
    role: "user",
    timestamp: 0,
  };
  let summary = "";
  for await (const frame of model({ ...request, messages: [...request.messages, ask] }, signal)) {
    if (frame.type === "delta") {
      summary += frame.content;
    } else if (
      frame.type === "error" ||
      (frame.type === "done" && frame.stopReason === "cancelled")
    ) {
      return "";
    }
  }
  return summary.trim();
}
