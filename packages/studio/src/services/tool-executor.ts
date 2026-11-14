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
 * - **The batch belongs to the assistant** (§3.3). The turn opens a batch lane owned by its actor,
 *   and every write the turn's tools make joins it, one segment per document written: each document
 *   gets one history step and one collab publish, whichever tab is active, and a person's edit
 *   during the turn closes the segment on that document rather than being folded into it.
 * - **The ledger is filed under the last message the turn drew** (§3.2), in this module's `finally`,
 *   so the transcript draws the turn's changed-files summary under it.
 *
 * @license MIT
 */

import type { InteractionStore } from "./harness/interaction-store";
import type { createChatState } from "@jxsuite/ai/chat-state";
import { DEFAULT_TURN_POLICY, assistantActorId, runTurn } from "@jxsuite/ai/harness";
import type { TurnInput, TurnPolicy, TurnRun } from "@jxsuite/ai/harness";
import {
  toChatMessages,
  toOpenAIMessages,
  toOpenAITools,
  toWireMessages,
} from "@jxsuite/ai/messages";
import type { StreamingClient } from "@jxsuite/ai/streaming-client";
import { createSessionFacts } from "@jxsuite/ai/tools";
import type { SessionFacts, ToolRegistry } from "@jxsuite/ai/tools";

import type { Tab } from "../tabs/tab";
import { openBatchLane } from "../tabs/transact";
import { splitSystemPrompt } from "./ai-system-prompt";
import { estimatePromptTokens, shedToolResults } from "./context-manager";
import { fileTurn, openTurnLedger, turnAnchor } from "./ai-writes";
import { applyHarnessEvent } from "./harness/chat-reducer";
import { studioTurnHooks } from "./harness/turn-hooks";

/** What a turn that drew nothing says: the model answered with neither text nor a tool call. */
export const EMPTY_TURN_TEXT = DEFAULT_TURN_POLICY.emptyText;

/** {@link TurnInput} while this module assembles it: read-only to `runTurn`, not to its builder. */
type TurnInputDraft = { -readonly [K in keyof TurnInput]: TurnInput[K] };

interface RunAgentLoopOptions {
  chatState: ReturnType<typeof createChatState>;
  streamingClient: StreamingClient;
  toolRegistry: ToolRegistry;
  systemPrompt: string;
  signal?: AbortSignal;
  getTab?: () => Tab | null;
  /** The conversation's facts, which every call's context carries; a fresh set when omitted. */
  session?: SessionFacts;
  /** Where a call that needs the author waits on them. Without one, such a call is refused. */
  interactions?: InteractionStore;
  /** Overrides on Studio's policy, for a run with bounds of its own. */
  policy?: Partial<TurnPolicy>;
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
  interactions,
  policy,
}: RunAgentLoopOptions): Promise<void> {
  /* The ledger is filed under the turn's last DRAWN assistant message (see services/ai-writes), so
     the scan starts at the message this turn answers. */
  const turnUserId = chatState.messages.findLast((m) => m.role === "user")?.id;
  const ledger = openTurnLedger(`turn:${chatState.messages.length}`);

  /* One undo step per document the turn writes. A loop with no `getTab` has no document of its own
     (the evals), so it gets no lane and each tool is its own entry. The owner's id is the one each
     call's context will carry, so a tool's write joins the lane by naming `ctx.actor`. */
  const lane = getTab
    ? openBatchLane({
        id: assistantActorId(session.sessionId, ledger.turnId),
        kind: "assistant",
        turnId: ledger.turnId,
      })
    : null;

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
    const input: TurnInputDraft = {
      history,
      system: splitSystemPrompt(systemPrompt),
      /* Projected from the chat store, the transcript of record. The streaming client is read on
         every round, and the turn's own signal is the host's, so a request is the one it was. */
      model: (request) => {
        /* A long turn must not outgrow the window between two sends: the trim only runs at a send. */
        shedToolResults(chatState, systemPrompt);
        /* SAFETY: the one production caller, `document-assistant.ts`, always passes its turn
           controller's signal; only tests that drive the loop directly omit it, and their stream
           doubles record the absent signal rather than reading it — which the agent-trace
           goldens (`signal: "none"`) pin. */
        const turnSignal = signal as AbortSignal;
        /* A client built for wire version 2 takes the conversation in no provider's words
           (specs/ai.md §2.7): the same transcript, projected by the backend instead of here. */
        if (streamingClient.streamTurn) {
          const conversation = toWireMessages(toChatMessages(chatState.messages));
          return streamingClient.streamTurn(
            {
              messages: request.closing
                ? [...conversation, ...toWireMessages([request.closing])]
                : conversation,
              system: splitSystemPrompt(systemPrompt),
              tools: [...request.tools],
            },
            turnSignal,
          );
        }
        const messages = chatState.toMessagesArray();
        return streamingClient.streamChat(
          /* A closing round's note is on no transcript, so it joins here, for this request only. */
          request.closing ? [...messages, ...toOpenAIMessages([request.closing])] : messages,
          toOpenAITools(request.tools),
          systemPrompt,
          turnSignal,
        );
      },
      modelInfo: { family: "openai-compat", model: chatState.model },
      tools: toolRegistry,
      turnId: ledger.turnId,
      policy: { estimateTokens: estimatePromptTokens, parallelReadOnly: true, ...policy },
      hooks: studioTurnHooks({
        superseded: () =>
          turnUserId !== undefined && !chatState.messages.some((m) => m.id === turnUserId),
        onSuperseded: () => {
          superseded = true;
          run?.cancel("superseded");
        },
      }),
      session,
      ledger,
      onEvent: (event) => {
        if (!superseded) {
          applyHarnessEvent(chatState, event);
        }
      },
    };
    if (signal) {
      input.signal = signal;
    }
    if (interactions) {
      input.interactions = interactions.strategy;
    }
    if (placeholder) {
      input.firstMessageId = placeholder.id;
    }
    run = runTurn(input);
    await run.outcome;
  } finally {
    const batches = lane?.close() ?? [];
    fileTurn(turnAnchor(chatState.messages, turnUserId) ?? "", ledger.writes, batches);
  }
}
