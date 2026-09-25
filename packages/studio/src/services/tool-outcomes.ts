/**
 * Tool-outcomes.ts — where a persisted tool call's outcome lives, and how a restore finds it.
 *
 * A tool call's outcome is recorded twice while a turn runs: as the `result` on its
 * `ToolCallRecord`, which the chip renders, and as the `tool` message that answers it, which the
 * provider reads. The second is the one that must survive, because it is the one the wire carries,
 * and it is the one that always did: the first was never populated for a finished call (the loop
 * closes the stream before its tools run), so every persisted `result` was `null`: every restored
 * chip rendered as still pending, and an answered question as one still open (specs/ai.md §3.4).
 *
 * So the tool message is the single source. A save strips `result` from every record, which keeps
 * the payload free of a second, disagreeing copy; a restore backfills each record from the reply
 * that answers it. A question nothing answered keeps no result, which is what makes it render
 * inert rather than as one still waiting; an ordinary call nothing answered never completed, and
 * says so.
 *
 * **A seal is not an answer.** When a question was left open, the send path seals its request with
 * a synthesized failure so the wire stays well-formed (`pruneOrphanToolMessages`). For an ordinary
 * call that failure IS the outcome to show: it never completed. For a question it is the absence of
 * an answer, so a restore leaves it without a result, and the chip draws the inert "still open when
 * the session was reloaded" card rather than a failure.
 *
 * @docs studio/ai/chat
 * @license MIT
 */

import type { ToolResult } from "@jxsuite/ai/tools";
import type { PersistedMessage } from "./ai-session-store";
import { UNANSWERED_TOOL_RESULT } from "./context-manager";

/** The tool that suspends a turn on the author (services/ai-ask.ts). */
const ASK_TOOL = "ask_user";

/** The outcome of an ordinary call that never ran to completion — the seal's own words. */
const NEVER_COMPLETED = JSON.parse(UNANSWERED_TOOL_RESULT) as ToolResult;

/** A tool-call record as persisted: `id` and `name` are what pairing and the chip read. */
interface PersistedToolCall {
  id?: unknown;
  name?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

/**
 * The messages as they should be persisted: every tool-call record without its `result`.
 *
 * Copies, never mutates — the live chat's records are the ones the panel is rendering.
 *
 * @param {readonly PersistedMessage[]} messages
 * @returns {PersistedMessage[]}
 */
export function stripToolResults(messages: readonly PersistedMessage[]): PersistedMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.toolCalls)) {
      return message;
    }
    return {
      ...message,
      toolCalls: message.toolCalls.map((call) => {
        if (!call || typeof call !== "object") {
          return call;
        }
        const { result: _result, ...rest } = call as PersistedToolCall;
        return rest;
      }),
    };
  });
}

/** A tool message's content as a `ToolResult`, or null when it is not one. */
function parseToolResult(content: unknown): ToolResult | null {
  if (typeof content !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed &&
      typeof parsed === "object" &&
      typeof (parsed as ToolResult).success === "boolean"
      ? (parsed as ToolResult)
      : null;
  } catch {
    return null;
  }
}

/**
 * The messages as they should be restored: every tool-call record carrying the result of the tool
 * message that answered it.
 *
 * **Pairing is per request, not by id across the transcript.** A provider may number its calls
 * afresh each round (`call_0` in round one and again in round two), so the reply to a call is
 * looked for only among the `tool` messages directly after the assistant message that made it — the
 * one position the wire allows a reply in. A record that already carries a result (a payload
 * written before results were stripped) keeps it only when no reply is found.
 *
 * @param {readonly PersistedMessage[]} messages
 * @returns {PersistedMessage[]}
 */
export function backfillToolResults(messages: readonly PersistedMessage[]): PersistedMessage[] {
  return messages.map((message, index) => {
    if (message.role !== "assistant" || !Array.isArray(message.toolCalls)) {
      return message;
    }
    const replies = new Map<string, ToolResult>();
    const sealed = new Set<string>();
    for (let next = index + 1; next < messages.length; next++) {
      const reply = messages[next]!;
      if (reply.role !== "tool") {
        break;
      }
      const result = parseToolResult(reply.content);
      if (typeof reply.toolCallId === "string" && result && !replies.has(reply.toolCallId)) {
        replies.set(reply.toolCallId, result);
        if (reply.content === UNANSWERED_TOOL_RESULT) {
          sealed.add(reply.toolCallId);
        }
      }
    }
    return {
      ...message,
      toolCalls: message.toolCalls.map((call) => {
        if (!call || typeof call !== "object") {
          return call;
        }
        const record = call as PersistedToolCall;
        const id = typeof record.id === "string" ? record.id : undefined;
        const answered = id === undefined ? undefined : replies.get(id);
        if (record.name === ASK_TOOL) {
          /* A question's only outcomes are an answer or none: a seal is not an answer, and a
             question nothing answered stays open, which the chip draws as inert. */
          const reply = answered && id !== undefined && !sealed.has(id) ? answered : undefined;
          return { ...record, result: reply ?? record.result ?? null };
        }
        /* Nothing is in flight after a restore, so an ordinary call nothing answered (a round Stop
           ended before its tools ran) never completed: the outcome the next send's seal will say. */
        return { ...record, result: answered ?? record.result ?? NEVER_COMPLETED };
      }),
    };
  });
}
