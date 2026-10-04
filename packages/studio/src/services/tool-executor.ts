/**
 * Tool-executor.js — the agent loop, as Studio runs it.
 *
 * The loop itself is the turn engine in `@jxsuite/ai/harness` (specs/ai.md §3.8): it streams each
 * round, runs the calls the model made, feeds their results back, and decides how the turn ends.
 * What stays here is Studio's side of a turn, which no other host shares:
 *
 * - **The chat store is the transcript of record.** The engine's events are applied to it as they
 *   happen (`services/harness/chat-reducer.ts`), and each round's request is projected from it, as
 *   it always was, so the provider sees the conversation the panel shows, with whatever the send
 *   path trimmed or sealed before the turn began.
 * - **A batch belongs to the tab it edits** (§3.3). The undo batch opens on the active tab and is
 *   re-anchored after every call whose tools moved to another document, so a turn that edits two
 *   documents gives each its own history step and collab publish.
 * - **The ledger is filed under the last message the turn drew** (§3.2), in this module's `finally`,
 *   so the transcript draws the turn's changed-files summary under it.
 *
 * @license MIT
 */

import type { createChatState } from "@jxsuite/ai/chat-state";
import { DEFAULT_TURN_POLICY, runTurn } from "@jxsuite/ai/harness";
import type { TurnRun } from "@jxsuite/ai/harness";
import { toChatMessages, toOpenAITools } from "@jxsuite/ai/messages";
import type { StreamingClient } from "@jxsuite/ai/streaming-client";
import { createSessionFacts } from "@jxsuite/ai/tools";
import type { SessionFacts, ToolRegistry } from "@jxsuite/ai/tools";

import type { Tab } from "../tabs/tab";
import { batchTab, beginBatch, endBatch } from "../tabs/transact";
import { estimatePromptTokens } from "./context-manager";
import { fileTurn, openTurnLedger, turnAnchor } from "./ai-writes";
import { applyHarnessEvent } from "./harness/chat-reducer";
import { studioTurnHooks } from "./harness/turn-hooks";

/** What a turn that drew nothing says: the model answered with neither text nor a tool call. */
export const EMPTY_TURN_TEXT = DEFAULT_TURN_POLICY.emptyText;

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
  /* The ledger is filed under the turn's last DRAWN assistant message (see services/ai-writes), so
     the scan starts at the message this turn answers. */
  const turnUserId = chatState.messages.findLast((m) => m.role === "user")?.id;
  const ledger = openTurnLedger(`turn:${chatState.messages.length}`);

  // Batch all tool-call mutations into a single undo step, anchored on the tab being edited.
  if (getTab) {
    beginBatch(getTab());
  }
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

  /* The placeholder `sendMessage` pushed is round one's message, so the turn answers into it; the
     conversation the turn continues is everything before it. */
  const last = chatState.messages.at(-1);
  const placeholder =
    chatState.status === "streaming" && last?.role === "assistant" ? last : undefined;
  const history = toChatMessages(
    placeholder ? chatState.messages.slice(0, -1) : chatState.messages,
  );

  /* Once another chat has replaced the one this turn answers, nothing more of the turn is written
     into the transcript: its events belong to a conversation that is no longer on screen. */
  let superseded = false;
  let run: TurnRun | undefined;
  try {
    run = runTurn({
      history,
      system: [{ text: systemPrompt }],
      /* Projected from the chat store, the transcript of record. The streaming client is read on
         every round, and the turn's own signal is the host's, so a request is the one it was. */
      model: (request) =>
        streamingClient.streamChat(
          chatState.toMessagesArray(),
          toOpenAITools(request.tools),
          systemPrompt,
          signal as AbortSignal,
        ),
      modelInfo: { family: "openai-compat", model: chatState.model },
      tools: toolRegistry,
      ...(signal ? { signal } : {}),
      turnId: ledger.turnId,
      ...(placeholder ? { firstMessageId: placeholder.id } : {}),
      policy: { estimateTokens: estimatePromptTokens },
      hooks: studioTurnHooks({
        superseded: () =>
          turnUserId !== undefined && !chatState.messages.some((m) => m.id === turnUserId),
        onSuperseded: () => {
          superseded = true;
          run?.cancel("superseded");
        },
        reanchor: reanchorBatch,
      }),
      session,
      ledger,
      onEvent: (event) => {
        if (!superseded) {
          applyHarnessEvent(chatState, event);
        }
      },
    });
    await run.outcome;
  } finally {
    endBatch();
    fileTurn(turnAnchor(chatState.messages, turnUserId) ?? "", ledger.writes);
  }
}
