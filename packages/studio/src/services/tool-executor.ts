/**
 * Tool-executor.js — Agentic loop driver for the document AI assistant
 *
 * Streams a chat round, executes any tool calls the model makes (via a ToolRegistry backed by
 * `transactDoc()`), feeds the results back as `tool` messages, and re-streams — up to a capped
 * number of rounds (specs/ai.md §3.2 to §3.4).
 *
 * Two §7.4 honesty rules live here rather than in the panel, because they are properties of the RUN
 * and a panel can only render what the run recorded:
 *
 * - **A partial success is not a failure.** Running out of rounds called `setError`, which paints
 *   the turn red and — in `chat-state.ts` — DELETES the streaming message, so a turn that applied
 *   four edits and then hit the cap reported as an error that had also erased its own account of
 *   the four edits. The cap is now an ordinary assistant message whenever anything was applied, and
 *   an error only when nothing was. **Applied means it wrote**: a call counts when it succeeded with
 *   a summary AND the write ledger grew by an `ok` write while it ran, not merely when it returned a
 *   summary, because a read returns a summary too, and a turn that only looked around was reported
 *   as having changed things.
 * - **A turn that drew nothing says so.** A model that answered with neither text nor a tool call
 *   left the author's message sitting there with no reply at all. That turn ends on an error row,
 *   with Retry, instead.
 * - **A batch belongs to the tab it edits.** `beginBatch(getTab())` ran once, against whichever tab
 *   happened to be active when the loop started. A turn that then moved to a second document closed
 *   its batch against the FIRST tab, so the second document's edits got neither a history snapshot
 *   nor a collab publish. The loop re-anchors the batch whenever the active tab changes under it.
 *
 * @license MIT
 */

import type { createChatState } from "@jxsuite/ai/chat-state";
import type { StreamingClient } from "@jxsuite/ai/streaming-client";
import { createSessionFacts, createToolContext, linkCallSignal } from "@jxsuite/ai/tools";
import type { Actor, SessionFacts, ToolRegistry } from "@jxsuite/ai/tools";

import type { Tab } from "../tabs/tab";
import type { ImportProgressEvent } from "../types";
import { batchTab, beginBatch, endBatch } from "../tabs/transact";
import { ensureProxyProbe, resetModelCache } from "./ai-models";
import { estimatePromptTokens } from "./context-manager";
import { fileTurn, openTurnLedger, turnAnchor } from "./ai-writes";
import { recordImportProgress } from "./import-run";

const MAX_ROUNDS = 5;

/** What a turn that drew nothing says: the model answered with neither text nor a tool call. */
export const EMPTY_TURN_TEXT = "The model sent back an empty reply.";

/**
 * Hard ceiling on rounds of every kind, so the loop terminates whatever the model does.
 *
 * {@link MAX_ROUNDS} bounds AUTONOMOUS work, and a round that ends by blocking on a person is the
 * opposite of runaway — it cannot advance without them, which is the property the cap was ever a
 * proxy for. So an interactive round does not spend that budget. This one is the backstop that
 * keeps `runAgentLoop` provably terminating anyway; a human answering ten questions will have
 * stopped it long before.
 */
const MAX_TOTAL_ROUNDS = 25;

interface RunAgentLoopOptions {
  chatState: ReturnType<typeof createChatState>;
  streamingClient: StreamingClient;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
  signal?: AbortSignal;
  getTab?: () => Tab | null;
  /** The conversation's facts, which every call's context carries; a fresh set when omitted. */
  session?: SessionFacts;
}

/**
 * Run one user turn through the agent loop: stream the model's response, execute any tool calls,
 * and repeat until the model stops calling tools or the round cap is hit.
 */
export async function runAgentLoop({
  chatState,
  streamingClient,
  toolRegistry,
  systemPrompt,
  signal,
  getTab,
  session = createSessionFacts(),
}: RunAgentLoopOptions): Promise<void> {
  const allErrors: string[] = [];
  const appliedSummaries: string[] = [];

  /* The ledger is filed under the turn's last DRAWN assistant message (see services/ai-writes), so
     the scan starts at the message this turn answers. */
  const turnUserId = chatState.messages.findLast((m) => m.role === "user")?.id;
  /* What every call's context carries (specs/ai.md §3.7): this turn's ledger, the conversation's
     facts, and who the calls act as. The signal and the call id are the call's own, below. */
  const ledger = openTurnLedger(`turn:${chatState.messages.length}`);
  const actor: Actor = {
    id: `assistant:${session.sessionId ?? "local"}:${ledger.turnId}`,
    kind: "assistant",
    model: chatState.model,
    sessionId: session.sessionId,
    turnId: ledger.turnId,
  };

  // Batch all tool-call mutations into a single undo step, anchored on the tab being edited.
  if (getTab) {
    beginBatch(getTab());
  }

  /**
   * Close the batch and re-open it when the tools have moved to a different document.
   *
   * Runs after every tool execution rather than only inside `open_document`, because a tool is not
   * the only thing that can change the active tab: project adoption replaces every tab in the
   * workspace, and the user is free to click another tab while the model is still streaming.
   */
  const reanchorBatch = () => {
    if (!getTab) {
      return;
    }
    const current = getTab();
    if (current !== batchTab()) {
      endBatch();
      beginBatch(current);
    }
  };

  try {
    /* Rounds that DID something, which is what MAX_ROUNDS bounds — see MAX_TOTAL_ROUNDS. */
    let workRounds = 0;
    for (let round = 1; round <= MAX_TOTAL_ROUNDS && workRounds < MAX_ROUNDS; round++) {
      const messages = chatState.toMessagesArray();
      const tools = toolRegistry.listForLLM();

      const toolCalls = new Map<string, { name: string; arguments: string }>();
      let stopReason = "stop";
      let streamError = null;
      let streamErrorCode: string | undefined;

      for await (const event of streamingClient.streamChat(
        messages,
        tools,
        systemPrompt,
        signal as AbortSignal,
      )) {
        switch (event.type) {
          case "delta": {
            chatState.appendDelta(event.content);
            break;
          }
          case "reasoning": {
            /* Kept on the turn, not shown as answer text — the next round has to replay it (see
               chat-state's toMessagesArray). */
            chatState.appendReasoning(event.content);
            break;
          }
          case "tool_call_start": {
            chatState.appendToolCallStart(event.id, event.name);
            toolCalls.set(event.id, { name: event.name, arguments: "" });
            break;
          }
          case "tool_call_delta": {
            chatState.appendToolCallDelta(event.id, event.args);
            const tc = toolCalls.get(event.id);
            if (tc) {
              tc.arguments += event.args;
            }
            break;
          }
          case "tool_call_end": {
            chatState.appendToolCallEnd(event.id);
            break;
          }
          case "usage": {
            /* The provider's own count replaces the four-characters-per-token estimate. The prompt
               it covered is recorded with it, because the next send rebuilds the prompt. */
            chatState.recordUsage(event, { systemTokens: estimatePromptTokens(systemPrompt) });
            break;
          }
          case "done": {
            ({ stopReason } = event);
            break;
          }
          case "error": {
            streamError = event.message;
            streamErrorCode = event.code;
            break;
          }
          default: {
            break;
          }
        }
      }

      if (streamError) {
        /* A lapsed hosted grant is the one stream error that makes the app's OWN reading wrong.
           The probe settles once at boot, so without this every gate keeps offering an assistant
           that cannot answer, and the send that just failed is the only evidence anyone has. Drop
           the reading and re-probe, so the next paint carries the Reconnect CTA instead. */
        if (streamErrorCode === "cf_reconnect_required") {
          resetModelCache();
          ensureProxyProbe();
        }
        /* `setError` alone, never after `finishStream`: it removes the round's partial message,
           and only while that message is still the streaming one. Finishing first let go of it, so
           the partial (a tool call cut off mid-arguments, as often as not) stayed in the
           transcript and went out on the next send. */
        chatState.setError(streamError);
        return;
      }

      /* A turn that has drawn nothing by the end of a round with no calls ends here, as an error
         the author can see and retry, rather than as silence under their message. `setError`
         before `finishStream`, so it removes the empty reply. A stopped round is not empty: the
         author ended it. */
      const stopped = stopReason === "cancelled" || signal?.aborted === true;
      if (toolCalls.size === 0 && !stopped && turnAnchor(chatState.messages, turnUserId) === null) {
        chatState.setError(EMPTY_TURN_TEXT);
        return;
      }

      chatState.finishStream(stopReason);

      /* The calls the model streamed decide whether tools run, not the finish reason the provider
         reported beside them. Some OpenAI-compatible backends (Workers AI among them) end a
         tool-calling turn with `finish_reason: "stop"`, and gating on `tool_calls` dropped those
         calls unrun — the turn ended looking finished, and the next send sealed them as failures.
         A call cut off by `length` still runs: its arguments fail to parse, and the model reads
         that as a tool error it can correct.

         Cancellation is the exception, and it is not a finish reason at all: it is the author
         pressing Stop. A stopped round runs nothing it streamed, including calls whose arguments
         were already complete, because Stop is the one control that must not be outrun. */
      if (toolCalls.size === 0 || stopReason === "cancelled" || signal?.aborted) {
        return;
      }

      let didWork = false;
      for (const [id, call] of toolCalls) {
        /* A Stop that lands between calls (while `ask_user` waits, or during a long import) stops
           the calls after it too. They stay unanswered, and the send path seals them. */
        if (signal?.aborted) {
          return;
        }
        let result;
        // The ledger's length before the call, so the call can be judged by what it recorded.
        const writesBefore = ledger.writes.length;
        /* The call's own signal: it aborts with the turn, so a tool waiting on a person or a crawl
           learns of a Stop, and it is unlinked once the call settles, so a Stop later in the turn
           reaches nothing that has already finished. */
        const link = signal ? linkCallSignal(signal) : null;
        const ctx = createToolContext({
          actor,
          callId: id,
          ledger,
          progress: (event) => {
            recordImportProgress(id, event as unknown as ImportProgressEvent);
          },
          session,
          ...(link ? { signal: link.signal } : {}),
        });
        try {
          result = await toolRegistry.execute(call.name, parseToolArguments(call.arguments), ctx);
        } catch (error) {
          result = {
            success: false,
            error: `Failed to parse arguments: ${(error as Error).message}`,
          };
        } finally {
          link?.release();
        }
        /* The transcript was replaced while the call ran: another chat was opened from Chat
           History, which stops the turn. The reply belongs to a request that is no longer there,
           so writing it would land a stray `tool` message in the other conversation, and could
           overwrite a restored record's result where a provider reuses call ids. */
        if (turnUserId !== undefined && !chatState.messages.some((m) => m.id === turnUserId)) {
          return;
        }
        // A call that suspends the turn on a person does not spend its work budget.
        if (toolRegistry.getDefinition(call.name)?.interactive !== true) {
          didWork = true;
        }
        reanchorBatch();
        if (!result.success && result.error) {
          allErrors.push(result.error);
        }
        const wrote = ledger.writes.slice(writesBefore).some((write) => write.ok);
        if (result.success && result.summary && wrote) {
          appliedSummaries.push(result.summary);
        }
        chatState.appendToolResult(id, result);
        chatState.pushToolResultMessage(id, JSON.stringify(result));
      }

      if (didWork) {
        workRounds += 1;
      }
      /* A Stop that landed during the round's last call. Nothing is left to stop in this round, so
         without this the loop opened the next one: a placeholder pushed after the author stopped,
         and a request streamed on the aborted signal. */
      if (signal?.aborted) {
        return;
      }
      if (workRounds < MAX_ROUNDS && round < MAX_TOTAL_ROUNDS) {
        chatState.beginAssistantTurn();
      }
    }

    /*
     * The round cap. Surface the actual errors so the user knows what went wrong, not just a
     * generic "I couldn't do it" — and, when anything was applied, say it as the ASSISTANT rather
     * than as a failure (§7.4). A partial success is not a failure.
     */
    const uniqueErrors = [...new Set(allErrors)];
    const applied =
      appliedSummaries.length > 0
        ? `\n\nChanges applied so far:\n${appliedSummaries.map((s) => `- ${s}`).join("\n")}`
        : "";
    const errors =
      uniqueErrors.length > 0
        ? `\n\nErrors encountered:\n${uniqueErrors.map((e) => `- ${e}`).join("\n")}`
        : "";
    const tail =
      `I ran out of tool-call rounds (${MAX_ROUNDS}) before finishing.${applied}${errors}` +
      `\n\nYou can continue by sending another message, or try a more specific request.`;
    if (appliedSummaries.length > 0) {
      chatState.beginAssistantTurn();
      chatState.appendDelta(tail);
      chatState.finishStream("length");
      return;
    }
    chatState.setError(tail);
  } finally {
    endBatch();
    fileTurn(turnAnchor(chatState.messages, turnUserId) ?? "", ledger.writes);
  }
}

/**
 * A call's arguments as the object a tool takes.
 *
 * An empty string is no arguments. JSON that parses to something other than an object (`null`, an
 * array, a number) is refused here with its own sentence, rather than reaching the registry, where
 * a validator reading a property of `null` threw a message about the validator. The prefix is the
 * one a JSON syntax error already carries, so the model reads both as one kind of mistake.
 *
 * @param {string} text - The call's accumulated argument text
 * @returns {object}
 * @throws {SyntaxError | TypeError} Caught by the loop and returned to the model as a tool error
 */
function parseToolArguments(text: string): object {
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const type = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
    throw new TypeError(`arguments must be a JSON object, got ${type}`);
  }
  return parsed;
}
