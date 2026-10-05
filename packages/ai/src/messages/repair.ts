/**
 * Repair.ts — every tool call followed by its reply, as a provider requires.
 *
 * A provider accepts a request that repeats a tool call only when the call's reply comes directly
 * after the message that made it. Several ordinary things break that: a saved session restored from
 * the middle of a pair, history trimmed for the token budget, a turn stopped between two calls, and
 * transcripts written before one window ran one turn, where a reply could land after a later
 * message. `repairToolPairs` puts every pair back together (specs/ai.md §3.4).
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type { ChatMessage, ToolCallBlock, ToolResultBlock } from "./types.ts";

/** What a seal says for a call that was cut off: its arguments never finished streaming. */
export const SEAL_CUT_OFF =
  "This tool call was never completed — the response was cut off before it finished.";

/** What a seal says for any other call with no reply. */
export const SEAL_RELOADED =
  "This tool call was never completed — the session was reloaded or the history was trimmed.";

/** A seal's content: the failed result a Jx tool would have serialized, keys in this order. */
function sealContent(sentence: string): string {
  return JSON.stringify({ success: false, error: sentence });
}

const CUT_OFF_CONTENT = sealContent(SEAL_CUT_OFF);
const RELOADED_CONTENT = sealContent(SEAL_RELOADED);

/** What {@link repairToolPairs} did, and the transcript it did it to. */
export interface RepairReport {
  /** The repaired transcript. Every message the repair did not create is the input's own object. */
  readonly messages: ChatMessage[];
  /** The id of each call given a seal, in transcript order. */
  readonly sealed: string[];
  /** The id of each `tool` message removed, in transcript order. */
  readonly dropped: string[];
  /** The id of each `tool` message put back after the request it answers, in transcript order. */
  readonly moved: string[];
}

/**
 * Whether a `tool` message's content is a seal rather than a reply: exactly one of the two contents
 * {@link repairToolPairs} writes.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isSealContent(content: string): boolean {
  return content === CUT_OFF_CONTENT || content === RELOADED_CONTENT;
}

/**
 * Whether a call's arguments were cut off mid-stream: there are some, and they do not parse. An
 * empty string is a call with no arguments, not one that was cut off.
 */
function isCutOff(call: ToolCallBlock): boolean {
  if (call.argumentsText === "") {
    return false;
  }
  try {
    JSON.parse(call.argumentsText);
    return false;
  } catch {
    return true;
  }
}

/**
 * A message's calls, one per id, in the order they were made. A call with no id cannot be answered,
 * so nothing seals it either; a call id made twice in one message is answered by one reply.
 */
function callsOf(message: ChatMessage): ToolCallBlock[] {
  const calls = new Map<string, ToolCallBlock>();
  for (const block of message.blocks) {
    if (block.type === "tool_call" && block.id !== "" && !calls.has(block.id)) {
      calls.set(block.id, block);
    }
  }
  return [...calls.values()];
}

/** The call id a `tool` message answers: its first result's, or the empty id when it has none. */
function answers(message: ChatMessage): string {
  const result = message.blocks.find(
    (block): block is ToolResultBlock => block.type === "tool_result",
  );
  return result?.callId ?? "";
}

/**
 * The seal for a call nothing answered: the `n`th of its message's unanswered calls, stamped with
 * that message's time, under an id no message in `used` has (which it then joins).
 */
function seal(call: ToolCallBlock, n: number, timestamp: number, used: Set<string>): ChatMessage {
  const base = `sealed_${call.id}_${n}`;
  let id = base;
  for (let k = 1; used.has(id); k++) {
    id = `${base}_${k}`;
  }
  used.add(id);
  return {
    id,
    role: "tool",
    blocks: [
      {
        type: "tool_result",
        callId: call.id,
        isError: true,
        content: isCutOff(call) ? CUT_OFF_CONTENT : RELOADED_CONTENT,
      },
    ],
    timestamp,
  };
}

/**
 * Put every tool call and its reply back together, so a provider accepts the transcript.
 *
 * Pairing is per request, never by call id across the transcript, because a provider may number its
 * calls afresh every round (`call_0` in round one and again in round two):
 *
 * 1. A `tool` message answers the call id of its first result. Its owner is the closest earlier
 *    assistant message that made a call with that id and has no reply for it yet. A reply with no
 *    owner (no earlier call, no call id, or a second reply to a call already answered) is dropped.
 * 2. Every other message keeps its order. Directly after each assistant message that made calls come a
 *    seal for each of its calls nothing answered, in call order, and then the replies it owns, in
 *    their original order. A reply that was not already in the run of `tool` messages directly
 *    after its owner is reported as moved.
 * 3. A seal is a `tool` message carrying a failed result. It says the call was cut off when its
 *    arguments do not parse ({@link SEAL_CUT_OFF}), and otherwise that the session was reloaded or
 *    the history trimmed ({@link SEAL_RELOADED}). It is stamped with the requesting message's
 *    timestamp and named `sealed_<call id>_<n>`, `n` being the call's place among that message's
 *    unanswered calls, with `_<k>` appended when that id is taken.
 *
 * Pure and deterministic, and idempotent: repairing a repaired transcript reports nothing and
 * returns the same messages.
 *
 * @param {readonly ChatMessage[]} messages
 * @returns {RepairReport}
 */
export function repairToolPairs(messages: readonly ChatMessage[]): RepairReport {
  /* Per call id, the indices of the assistant messages that made it, oldest first; per such message,
     its calls, the call ids answered so far and the indices of the replies it owns. */
  const requesters = new Map<string, number[]>();
  const calls = new Map<number, ToolCallBlock[]>();
  const answered = new Map<number, Set<string>>();
  const owned = new Map<number, number[]>();
  const dropped: string[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === "assistant") {
      const made = callsOf(message);
      if (made.length > 0) {
        calls.set(index, made);
        answered.set(index, new Set());
        owned.set(index, []);
        for (const call of made) {
          requesters.set(call.id, [...(requesters.get(call.id) ?? []), index]);
        }
      }
    } else if (message.role === "tool") {
      const callId = answers(message);
      const owner = requesters.get(callId)?.findLast((at) => !answered.get(at)!.has(callId));
      if (owner === undefined) {
        dropped.push(message.id);
      } else {
        answered.get(owner)!.add(callId);
        owned.get(owner)!.push(index);
      }
    }
  }

  const used = new Set(messages.map((message) => message.id));
  const repaired: ChatMessage[] = [];
  const sealed: string[] = [];
  const moved: string[] = [];

  for (const [index, message] of messages.entries()) {
    if (message.role === "tool") {
      continue;
    }
    repaired.push(message);
    const made = calls.get(index);
    if (!made) {
      continue;
    }
    const replied = answered.get(index)!;
    const unanswered = made.filter((call) => !replied.has(call.id));
    for (const [n, call] of unanswered.entries()) {
      repaired.push(seal(call, n, message.timestamp, used));
      sealed.push(call.id);
    }
    // The run of `tool` messages directly after the request, in the input: a reply there stayed.
    let runEnd = index + 1;
    while (runEnd < messages.length && messages[runEnd]!.role === "tool") {
      runEnd += 1;
    }
    for (const at of owned.get(index)!) {
      const reply = messages[at]!;
      repaired.push(reply);
      if (at >= runEnd) {
        moved.push(reply.id);
      }
    }
  }

  return { messages: repaired, sealed, dropped, moved };
}
