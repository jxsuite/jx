/**
 * Run.ts — the turn engine: one user turn, round by round, until the model stops calling tools.
 *
 * This is the agent loop Studio ran inline (specs/ai.md §3.2 to §3.4, §3.8), moved behind an
 * interface any host can run: a Studio window, a Worker, or a headless test. It owns the rules a
 * turn is held to and reports everything it does as events; a host that keeps its own transcript
 * applies them as they arrive.
 *
 * - **The calls decide whether tools run, not the finish reason** (§2). A round whose stream carried
 *   tool calls executes them whatever finish the provider reported. Cancellation is the exception:
 *   a round that ends `cancelled`, or whose signal is aborted, runs nothing it streamed.
 * - **A partial success is not a failure** (§3.2). Running out of work rounds after applying
 *   something ends on an ordinary message saying what was applied; only a turn that applied nothing
 *   ends as a failure. Applied means it wrote: a call counts when it succeeded with a summary and
 *   recorded at least one `ok` write.
 * - **A turn that drew nothing says so** (§3.2), as an `empty` outcome, rather than ending silent.
 * - **Stop is checked between calls and after the round** (§2), so a Stop that lands mid-call stops
 *   the calls after it, and one that lands during the last call opens no further round.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { nextMessageId } from "../message-id.ts";
import { isEmptyAssistant } from "../messages/convert.ts";
import { fromOpenAITools } from "../messages/openai.ts";
import type { Block, ChatMessage } from "../messages/types.ts";
import {
  createLedger,
  createSessionFacts,
  createToolContext,
  invokeTool,
  linkCallSignal,
} from "../tools.ts";
import type { Actor } from "../tools.ts";
import { LaneBusyError } from "./lock.ts";
import { joinSystem } from "./model.ts";
import { DEFAULT_TURN_POLICY } from "./policy.ts";
import type {
  HarnessEvent,
  TurnError,
  TurnInput,
  TurnOutcome,
  TurnOutcomeKind,
  TurnRun,
  Usage,
} from "./types.ts";

/** An event as the engine writes it, before the envelope is added. */
type EventBody = HarnessEvent extends infer E
  ? E extends HarnessEvent
    ? Omit<E, "v" | "seq" | "turnId">
    : never
  : never;

/** Two usage counts summed field by field; a field either one reports is reported. */
function addUsage(total: Usage | null, next: Usage): Usage {
  if (total === null) {
    return { ...next };
  }
  const sum: Record<string, number> = { ...total };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === "number") {
      sum[key] = (sum[key] ?? 0) + value;
    }
  }
  return sum as unknown as Usage;
}

/**
 * The events of a turn, in order, to every reader: buffered for the turn's life, so a reader that
 * starts late still sees the turn from its start, and two readers each see all of it.
 */
function createEventQueue() {
  const events: HarnessEvent[] = [];
  let closed = false;
  let failure: { error: unknown } | null = null;
  const waiting = new Set<() => void>();
  const notify = () => {
    const resumes = [...waiting];
    waiting.clear();
    for (const resume of resumes) {
      resume();
    }
  };
  const nextPush = () =>
    new Promise<void>((resume) => {
      waiting.add(resume);
    });
  return {
    push(event: HarnessEvent) {
      events.push(event);
      notify();
    },
    close(error?: { error: unknown }) {
      closed = true;
      failure = error ?? null;
      notify();
    },
    async *read(): AsyncGenerator<HarnessEvent> {
      let index = 0;
      while (true) {
        if (index < events.length) {
          yield events[index]!;
          index += 1;
        } else if (closed) {
          if (failure) {
            throw failure.error;
          }
          return;
        } else {
          await nextPush();
        }
      }
    },
  };
}

/**
 * Start one turn. It begins at once and runs to its end whether or not anyone reads its events;
 * `onEvent` hears each one synchronously, in order, before the engine takes its next step.
 *
 * @param {TurnInput} input
 * @returns {TurnRun}
 * @throws {LaneBusyError} Synchronously, when `input.lock` is held by another turn
 */
export function runTurn(input: TurnInput): TurnRun {
  const newId = input.newId ?? nextMessageId;
  const now = input.now ?? Date.now;
  const turnId = input.turnId ?? newId();
  const release = input.lock ? input.lock.acquire(turnId) : () => {};
  if (release === null) {
    throw new LaneBusyError(input.lock?.active ?? "");
  }

  /* The turn's own signal, armed before this function returns: `cancel` aborts it, and so does the
     host's signal, with the host's reason. */
  const controller = new AbortController();
  let unlink = () => {};
  const outer = input.signal;
  if (outer?.aborted) {
    controller.abort(outer.reason);
  } else if (outer) {
    const onAbort = () => {
      controller.abort(outer.reason);
    };
    outer.addEventListener("abort", onAbort, { once: true });
    unlink = () => {
      outer.removeEventListener("abort", onAbort);
    };
  }
  const { signal } = controller;
  const settle = () => {
    unlink();
    release();
  };

  const policy = { ...DEFAULT_TURN_POLICY, ...input.policy };
  const session = input.session ?? createSessionFacts();
  const ledger = input.ledger ?? createLedger();
  const sessionId = input.sessionId === undefined ? session.sessionId : input.sessionId;
  const actor: Actor = {
    id: `assistant:${sessionId ?? "local"}:${turnId}`,
    kind: "assistant",
    ...(input.modelInfo ? { model: input.modelInfo.model } : {}),
    sessionId,
    turnId,
  };

  const queue = createEventQueue();
  let seq = 0;
  let ended = false;
  /* Nothing follows `turn_end`: a tool that reports progress after its turn has ended (a call that
     outlives its signal) is not heard. */
  const emit = (body: EventBody) => {
    if (ended) {
      return;
    }
    ended = body.type === "turn_end";
    const event = { v: 1, seq, turnId, ...body } as HarnessEvent;
    seq += 1;
    input.onEvent?.(event);
    queue.push(event);
  };

  const { history } = input;
  /* Whether the turn has drawn anything before its first round: an assistant message after the
     message it answers (or anywhere, when there is none) with text or a call. */
  const answered = history.findLastIndex((message) => message.role === "user");
  const drawnBefore = history
    .slice(answered + 1)
    .some((message) => message.role === "assistant" && !isEmptyAssistant(message));

  async function loop(): Promise<TurnOutcome> {
    const appended: ChatMessage[] = [];
    const applied: string[] = [];
    const errors: string[] = [];
    let anchor: string | null = null;
    let rounds = 0;
    let workRounds = 0;
    let lastUsage: Usage | null = null;
    let totalUsage: Usage | null = null;

    const finish = (
      kind: TurnOutcomeKind,
      extra: Pick<TurnOutcome, "cap" | "error" | "removedMessageId"> = {},
    ): TurnOutcome => {
      const outcome: TurnOutcome = {
        kind,
        turnId,
        anchorMessageId: anchor,
        rounds,
        workRounds,
        writes: [...ledger.writes],
        usage: { last: lastUsage, total: totalUsage },
        appended,
        ...extra,
      };
      // Released before the last event, so a host that starts its next turn on it is not refused.
      settle();
      emit({ type: "turn_end", outcome });
      return outcome;
    };

    emit({ type: "turn_start" });
    for (let round = 1; round <= policy.maxRounds && workRounds < policy.maxWorkRounds; round++) {
      rounds = round;
      const messageId =
        round === 1 && input.firstMessageId !== undefined ? input.firstMessageId : newId();
      emit({ type: "round_start", round, workRounds, messageId });

      const tools = fromOpenAITools(input.tools.listForLLM());
      let text = "";
      let reasoning: string | undefined;
      /* The message records each call as it starts, the way a transcript shows it; execution keys
         them by id, so a call id streamed twice runs once, with the arguments of its last start. */
      const records: { id: string; name: string; argumentsText: string }[] = [];
      const calls = new Map<string, { name: string; argumentsText: string }>();
      let stopReason = "stop";
      let sawDone = false;
      let errorMessage = "";
      let errorCode: string | undefined;

      for await (const frame of input.model(
        { system: input.system, messages: [...history, ...appended], tools },
        signal,
      )) {
        switch (frame.type) {
          case "delta": {
            text += frame.content;
            emit({ type: "text", messageId, text: frame.content });
            break;
          }
          case "reasoning": {
            reasoning = (reasoning ?? "") + frame.content;
            emit({ type: "reasoning", messageId, text: frame.content });
            break;
          }
          case "tool_call_start": {
            records.push({ id: frame.id, name: frame.name, argumentsText: "" });
            calls.set(frame.id, { name: frame.name, argumentsText: "" });
            emit({ type: "tool_call_start", messageId, callId: frame.id, name: frame.name });
            break;
          }
          case "tool_call_delta": {
            const record = records.find((r) => r.id === frame.id);
            if (record) {
              record.argumentsText += frame.args;
            }
            const call = calls.get(frame.id);
            if (call) {
              call.argumentsText += frame.args;
            }
            emit({ type: "tool_call_delta", messageId, callId: frame.id, args: frame.args });
            break;
          }
          case "tool_call_end": {
            emit({ type: "tool_call_end", messageId, callId: frame.id });
            break;
          }
          case "usage": {
            const { type: _type, ...usage } = frame;
            lastUsage = usage;
            totalUsage = addUsage(totalUsage, usage);
            emit({
              type: "usage",
              messageId,
              frame,
              systemTokens: policy.estimateTokens(joinSystem(input.system)),
            });
            break;
          }
          case "done": {
            ({ stopReason } = frame);
            sawDone = true;
            break;
          }
          case "error": {
            errorMessage = frame.message;
            errorCode = frame.code;
            break;
          }
          default: {
            break;
          }
        }
      }

      const truncated = !sawDone;
      if (errorMessage) {
        const error: TurnError = {
          message: errorMessage,
          ...(errorCode ? { code: errorCode } : {}),
        };
        input.hooks?.onStreamError?.(error);
        emit({ type: "round_end", messageId, stopReason, truncated, dropped: true, error });
        return finish("error", { error, removedMessageId: messageId });
      }

      /* A turn that has drawn nothing by the end of a round with no calls ends here. A stopped
         round is not empty: the author ended it. */
      const stopped = stopReason === "cancelled" || signal.aborted;
      const drawn = text !== "" || records.length > 0;
      if (calls.size === 0 && !stopped && !drawnBefore && anchor === null && !drawn) {
        emit({ type: "round_end", messageId, stopReason, truncated, dropped: true });
        return finish("empty", {
          error: { message: policy.emptyText },
          removedMessageId: messageId,
        });
      }

      emit({ type: "round_end", messageId, stopReason, truncated, dropped: false });
      if (drawn) {
        const blocks: Block[] = [];
        if (reasoning !== undefined) {
          blocks.push({ type: "reasoning", text: reasoning });
        }
        if (text) {
          blocks.push({ type: "text", text });
        }
        for (const record of records) {
          blocks.push({ type: "tool_call", ...record });
        }
        appended.push({
          id: messageId,
          role: "assistant",
          blocks,
          timestamp: now(),
          ...(truncated ? { meta: { incomplete: "truncated" as const } } : {}),
        });
        anchor = messageId;
      }
      if (calls.size === 0 || stopped) {
        return finish(stopped ? "cancelled" : "complete");
      }

      let didWork = false;
      for (const [callId, call] of calls) {
        if (signal.aborted) {
          return finish("cancelled");
        }
        emit({
          type: "tool_start",
          callId,
          name: call.name,
          interactive: input.tools.getDefinition(call.name)?.interactive === true,
        });
        const before = ledger.writes.length;
        /* The call's own signal: it aborts with the turn, and is unlinked once the call settles, so
           a Stop later in the turn reaches nothing that already finished. */
        const link = linkCallSignal(signal);
        const ctx = createToolContext({
          actor,
          callId,
          ledger,
          progress: (progress) => {
            emit({ type: "tool_progress", callId, progress });
          },
          session,
          signal: link.signal,
        });
        let result;
        try {
          ({ result } = await invokeTool(
            input.tools,
            { callId, name: call.name, argumentsText: call.argumentsText },
            ctx,
          ));
        } finally {
          link.release();
        }
        input.hooks?.afterTool?.({ callId, name: call.name, result });
        // A call that suspends the turn on a person does not spend its work budget.
        if (input.tools.getDefinition(call.name)?.interactive !== true) {
          didWork = true;
        }
        if (!result.success && result.error) {
          errors.push(result.error);
        }
        const recorded = ledger.writes.slice(before);
        if (result.success && result.summary && recorded.some((write) => write.ok)) {
          applied.push(result.summary);
        }
        for (const write of recorded) {
          emit({ type: "write", callId, write });
        }
        const toolMessageId = newId();
        appended.push({
          id: toolMessageId,
          role: "tool",
          blocks: [
            {
              type: "tool_result",
              callId,
              isError: result.success === false,
              content: JSON.stringify(result),
            },
          ],
          timestamp: now(),
        });
        emit({ type: "tool_result", callId, messageId, toolMessageId, result });
      }

      if (didWork) {
        workRounds += 1;
      }
      // A Stop that landed during the round's last call opens no further round.
      if (signal.aborted) {
        return finish("cancelled");
      }
    }

    const capText = policy.capText({ maxWorkRounds: policy.maxWorkRounds, applied, errors });
    if (applied.length > 0) {
      const capId = newId();
      appended.push({
        id: capId,
        role: "assistant",
        blocks: [{ type: "text", text: capText }],
        timestamp: now(),
        meta: { origin: "harness", kind: "round_cap" },
      });
      anchor = capId;
      return finish("cap_partial", { cap: { messageId: capId, text: capText } });
    }
    return finish("cap_failed", { error: { message: capText } });
  }

  const outcome = loop().finally(settle);
  outcome.then(
    () => {
      queue.close();
    },
    (error: unknown) => {
      queue.close({ error });
    },
  );

  return {
    turnId,
    signal,
    cancel(reason = "user") {
      controller.abort(reason);
    },
    outcome,
    [Symbol.asyncIterator]: () => queue.read(),
  };
}
