/**
 * Chat-reducer.ts — a turn's events, applied to Studio's chat store.
 *
 * The chat store is Studio's transcript of record: the panel renders it and the session store saves
 * it. The turn engine (`@jxsuite/ai/harness`) reports what a turn does as events, and this is the
 * one place they become chat-store calls, in the order the agent loop always made them (specs/ai.md
 * §3.8): the recorded agent traces hold the two to the same sequence, call for call.
 *
 * @license MIT
 */

import type { createChatState } from "@jxsuite/ai/chat-state";
import type { HarnessEvent, TurnOutcome } from "@jxsuite/ai/harness";
import type { ImportProgressEvent } from "../../types";
import { recordImportProgress } from "../import-run";

type ChatStore = ReturnType<typeof createChatState>;

/** How a turn's end reads in the transcript: the cap message, an error row, or nothing more. */
function applyOutcome(chat: ChatStore, outcome: TurnOutcome): void {
  switch (outcome.kind) {
    case "cap_partial": {
      // A partial success is said as the assistant, not as a failure (specs/ai.md §3.2).
      chat.beginAssistantTurn();
      chat.appendDelta(outcome.cap?.text ?? "");
      chat.finishStream("length");
      break;
    }
    case "cap_failed":
    case "empty":
    case "error": {
      /* `setError` alone, never after `finishStream`: it removes the round's partial message, and
         only while that message is still the streaming one. */
      chat.setError(outcome.error?.message ?? "");
      break;
    }
    default: {
      break;
    }
  }
}

/**
 * Apply one turn event to the chat store.
 *
 * Round one answers into the placeholder `sendMessage` already pushed, so only a later round opens
 * a message. A round that failed, or a turn that drew nothing, is never finished: its error row
 * removes the partial. `turn_start`, `tool_start` and `write` change nothing here; the ledger
 * records writes itself.
 *
 * @param {ChatStore} chat
 * @param {HarnessEvent} event
 */
export function applyHarnessEvent(chat: ChatStore, event: HarnessEvent): void {
  switch (event.type) {
    case "round_start": {
      if (event.round > 1) {
        chat.beginAssistantTurn();
      }
      break;
    }
    case "text": {
      chat.appendDelta(event.text);
      break;
    }
    case "reasoning": {
      /* Kept on the turn, not shown as answer text: the next round has to replay it
         (specs/ai.md §2.2). */
      chat.appendReasoning(event.text);
      break;
    }
    case "tool_call_start": {
      chat.appendToolCallStart(event.callId, event.name);
      break;
    }
    case "tool_call_delta": {
      chat.appendToolCallDelta(event.callId, event.args);
      break;
    }
    case "tool_call_end": {
      chat.appendToolCallEnd(event.callId);
      break;
    }
    case "usage": {
      /* The provider's own count replaces the four-characters-per-token estimate; the prompt it
         covered is recorded with it, because the next send rebuilds the prompt. */
      chat.recordUsage(event.frame, { systemTokens: event.systemTokens });
      break;
    }
    case "round_end": {
      if (!event.dropped) {
        chat.finishStream(event.stopReason);
      }
      break;
    }
    case "tool_progress": {
      recordImportProgress(event.callId, event.progress as unknown as ImportProgressEvent);
      break;
    }
    case "tool_result": {
      chat.appendToolResult(event.callId, event.result);
      chat.pushToolResultMessage(event.callId, JSON.stringify(event.result));
      break;
    }
    case "turn_end": {
      applyOutcome(chat, event.outcome);
      break;
    }
    default: {
      break;
    }
  }
}
