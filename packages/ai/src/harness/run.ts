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
 * - **A turn that stops working still answers** (§3.2, §3.8). Running out of work rounds, or making
 *   the same calls with the same results, opens one closing round whose calls do not run, so the
 *   model says what it found and did. Without a reply, a turn that applied something ends on the
 *   harness's message saying what; only one that applied nothing ends as a failure. Applied means
 *   it wrote: a call counts when it succeeded with a summary and recorded at least one `ok` write.
 * - **A turn that drew nothing says so** (§3.2), as an `empty` outcome, rather than ending silent.
 * - **Stop is checked between calls and after the round** (§2), so a Stop that lands mid-call stops
 *   the calls after it, and one that lands during the last call opens no further round.
 * - **The history is repaired before it is sent** (§3.4). Every tool call is put back beside its
 *   reply, and a call with none is sealed, so a history a restore, a trim or a Stop broke does not
 *   get the turn's first request refused.
 * - **A turn that cannot go on stops where it can be picked up** (§3.12). With the `suspend` strategy
 *   a call that needs a person, and with `suspendOn` a provider error worth waiting out, ends the
 *   turn `suspended` with a checkpoint; `resume` continues it from there, running no call twice.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { nextMessageId } from "../message-id.ts";
import { isEmptyAssistant } from "../messages/convert.ts";
import { fromOpenAITools } from "../messages/openai.ts";
import { repairToolPairs } from "../messages/repair.ts";
import type { Block, ChatMessage } from "../messages/types.ts";
import {
  createLedger,
  createSessionFacts,
  createToolContext,
  invokeTool,
  linkCallSignal,
  toolError,
} from "../tools.ts";
import type {
  Actor,
  InteractionRequest,
  InteractionResponse,
  ToolCall,
  ToolContext,
  ToolResult,
} from "../tools.ts";
import { checkResume, turnDigests } from "./checkpoint.ts";
import { LaneBusyError } from "./lock.ts";
import { joinSystem } from "./model.ts";
import { DEFAULT_TURN_POLICY } from "./policy.ts";
import type {
  HarnessEvent,
  CapReason,
  SuspendReason,
  TurnCheckpoint,
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

/** What a call came to: its result, or the request it must wait on a person for. */
type CallSettlement = ToolResult | { readonly suspend: InteractionRequest };

/** True when a call did not finish, because the turn must suspend on what it asks. */
function isSuspension(settlement: CallSettlement): settlement is {
  readonly suspend: InteractionRequest;
} {
  return "suspend" in settlement;
}

/**
 * Why a provider error a host chose to suspend on stopped the turn: a rate limit when its code says
 * so, and otherwise a credential the host can renew.
 */
function suspendReasonFor(code: string): SuspendReason {
  return /rate|limit|429/i.test(code) ? "rate_limit" : "credentials";
}

/** The id of the last assistant message that drew something, or null. */
function lastDrawn(messages: readonly ChatMessage[]): string | null {
  return (
    messages.findLast((message) => message.role === "assistant" && !isEmptyAssistant(message))
      ?.id ?? null
  );
}

/** True when a member name of a usage frame is one of the counts {@link Usage} names. */
function isUsageField(key: string): key is keyof Usage {
  return (
    key === "inputTokens" ||
    key === "outputTokens" ||
    key === "cachedInputTokens" ||
    key === "reasoningTokens"
  );
}

/** True when a count a backend's usage frame carries is a number, which the frame does not prove. */
function isCount(value: unknown): value is number {
  return typeof value === "number";
}

/** Two usage counts summed field by field; a field either one reports is reported. */
function addUsage(total: Usage | null, next: Usage): Usage {
  if (total === null) {
    return { ...next };
  }
  const sum: Usage = { ...total };
  for (const [key, value] of Object.entries(next)) {
    if (isUsageField(key) && isCount(value)) {
      sum[key] = (sum[key] ?? 0) + value;
    }
  }
  return sum;
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
      // `push` and `close` change what this loop reads from outside it, so it exits from within.
      for (;;) {
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
 * The id a turn's {@link Actor} carries: `assistant:<sessionId|local>:<turnId>`. A host that keys
 * anything on the actor before the turn starts (Studio's batch lane, specs/ai.md §3.3) builds it
 * here, so the key it opens cannot drift from the one each call's context will name.
 */
export function assistantActorId(sessionId: string | null, turnId: string): string {
  return `assistant:${sessionId ?? "local"}:${turnId}`;
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
  const resumed = input.resume?.checkpoint;
  const resumeAnswer = input.resume?.response;
  // A resumed turn is the turn it was: its messages, its actor and its ledger entries keep one id.
  const turnId = input.turnId ?? resumed?.turnId ?? newId();
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
  /* Read through a call: the signal aborts from outside, between awaits, which narrowing on
     `signal.aborted` cannot see. */
  const aborted = (): boolean => signal.aborted;
  const settle = () => {
    unlink();
    release();
  };

  const policy = { ...DEFAULT_TURN_POLICY, ...input.policy };
  const session = input.session ?? createSessionFacts();
  const ledger = input.ledger ?? createLedger();
  const sessionId = input.sessionId === undefined ? session.sessionId : input.sessionId;
  const actorId = assistantActorId(sessionId, turnId);
  const actor: Actor = input.modelInfo
    ? { id: actorId, kind: "assistant", model: input.modelInfo.model, sessionId, turnId }
    : { id: actorId, kind: "assistant", sessionId, turnId };

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
    /* SAFETY: EventBody is HarnessEvent with exactly `v`, `seq` and `turnId` omitted, member by
       member, and this adds those three back, so the result is the member `body` came from. */
    const event = { v: 1, seq, turnId, ...body } as HarnessEvent;
    seq += 1;
    input.onEvent?.(event);
    queue.push(event);
  };

  /* Every call beside its reply before anything reads the history (specs/ai.md §3.4): a provider
     refuses a request that repeats a call without its reply, and a history can arrive broken (a
     restore, a trim, a turn stopped between calls). */
  const repair = repairToolPairs(input.history);
  const history = repair.messages;
  /* Whether the turn has drawn anything before its first round: an assistant message after the
     message it answers (or anywhere, when there is none) with text or a call. */
  const answered = history.findLastIndex((message) => message.role === "user");
  const drawnBefore = history
    .slice(answered + 1)
    .some((message) => message.role === "assistant" && !isEmptyAssistant(message));

  const interactions = input.interactions ?? { mode: "none" };

  /**
   * Invoke one call to its result. A call that needs a person is put to the host's strategy and
   * invoked again with the answer, so no tool body ever awaits a person (specs/ai.md §3.11).
   */
  async function invoke(
    call: ToolCall,
    ctx: ToolContext,
    callSignal: AbortSignal,
    answer?: InteractionResponse,
  ): Promise<CallSettlement> {
    /* An answer in hand is the one a suspended turn was resumed with: the person has already been
       asked, so the call goes straight to it (§3.12). */
    if (answer) {
      emit({ type: "interaction_settled", callId: call.callId, response: answer });
    }
    let outcome = await invokeTool(
      input.tools,
      call,
      ctx,
      answer ? { approval: policy.approval, response: answer } : { approval: policy.approval },
    );
    while (outcome.status === "needs_input") {
      if (interactions.mode === "none") {
        return toolError(`${call.name} needs a person, and none is available here.`);
      }
      const { request } = outcome;
      emit({ type: "interaction_request", callId: call.callId, request });
      if (interactions.mode === "suspend") {
        return { suspend: request };
      }
      const response = await interactions.resolve(request, {
        callId: call.callId,
        signal: callSignal,
      });
      emit({ type: "interaction_settled", callId: call.callId, response });
      outcome = await invokeTool(input.tools, call, ctx, { approval: policy.approval, response });
    }
    return outcome.result;
  }

  async function loop(): Promise<TurnOutcome> {
    const appended: ChatMessage[] = resumed ? [...resumed.appended] : [];
    const applied: string[] = resumed ? [...resumed.applied] : [];
    const errors: string[] = resumed ? [...resumed.errors] : [];
    // What the turn wrote before it was suspended; this run's ledger holds only what it writes now.
    const priorWrites = resumed ? resumed.writes : [];
    let anchor: string | null = lastDrawn(appended);
    let rounds = resumed ? resumed.round : 0;
    let workRounds = resumed ? resumed.workRounds : 0;
    let lastUsage: Usage | null = null;
    let totalUsage: Usage | null = null;
    /* How many rounds made exactly these calls and got exactly these results. Nothing the model
       could learn from a further one differs, so the count is what "stuck" means here. */
    const roundsSeen = new Map<string, number>();
    let repeating = false;

    const finish = (
      kind: TurnOutcomeKind,
      extra: Pick<TurnOutcome, "cap" | "checkpoint" | "error" | "removedMessageId"> = {},
    ): TurnOutcome => {
      const outcome: TurnOutcome = {
        kind,
        turnId,
        anchorMessageId: anchor,
        rounds,
        workRounds,
        writes: [...priorWrites, ...ledger.writes],
        usage: { last: lastUsage, total: totalUsage },
        appended,
        ...extra,
      };
      // Released before the last event, so a host that starts its next turn on it is not refused.
      settle();
      emit({ type: "turn_end", outcome });
      return outcome;
    };

    /* How a turn that stopped working ends when the model gave no closing reply. A turn that applied
       something still says what (§3.2); one that applied nothing has nothing to report but that. */
    const capped = (reason: CapReason): TurnOutcome => {
      const text = policy.capText({
        maxWorkRounds: policy.maxWorkRounds,
        reason,
        applied,
        errors,
      });
      if (applied.length === 0) {
        return finish("cap_failed", { error: { message: text } });
      }
      const capId = newId();
      appended.push({
        id: capId,
        role: "assistant",
        blocks: [{ type: "text", text }],
        timestamp: now(),
        meta: { origin: "harness", kind: "round_cap" },
      });
      anchor = capId;
      return finish("cap_partial", { cap: { messageId: capId, text } });
    };

    /* End the turn where it can be picked up (§3.12): the checkpoint is everything a later run needs
       to continue, reported as its own event first so a host can store it before the turn ends. */
    const suspend = (
      reason: SuspendReason,
      at: Pick<TurnCheckpoint, "awaiting" | "pending">,
      extra: Pick<TurnOutcome, "error" | "removedMessageId"> = {},
    ): TurnOutcome => {
      const checkpoint: TurnCheckpoint = {
        v: 1,
        turnId,
        sessionId,
        createdAt: now(),
        model: input.modelInfo ?? { family: "openai-compat", model: "" },
        ...turnDigests(input),
        round: rounds,
        workRounds,
        appended: [...appended],
        ...at,
        writes: [...priorWrites, ...ledger.writes],
        applied: [...applied],
        errors: [...errors],
        reason,
      };
      emit({ type: "checkpoint", checkpoint });
      return finish("suspended", { checkpoint, ...extra });
    };

    /** How many calls from the front of `calls` run together: at least the first. */
    const parallelRunLength = (calls: readonly ToolCall[]): number => {
      if (!policy.parallelReadOnly) {
        return 1;
      }
      const end = calls.findIndex((call) => {
        const definition = input.tools.getDefinition(call.name);
        return (
          definition?.annotations?.readOnlyHint !== true ||
          definition.interactive === true ||
          definition.interaction !== undefined
        );
      });
      if (end === -1) {
        return calls.length;
      }
      return Math.max(end, 1);
    };

    /**
     * Run a round's calls from `start` to the end, in stream order, and report each result. With
     * `parallelReadOnly`, a run of neighbouring read-only calls runs at once, because none of them
     * can change what another reads; their results are still reported in order, so the transcript
     * and the wire see what a serial turn would. A question or a write is never in such a run, so
     * it still sees everything before it.
     *
     * Answers how the turn ended, when it ended here (stopped, or suspended on a call that needs a
     * person), and otherwise whether any of the calls was work. `answer` is the person's reply to
     * the first call, for a turn resumed on it; `seen` collects what the round's repeat guard
     * compares.
     */
    const runCalls = async (
      messageId: string,
      roundCalls: readonly ToolCall[],
      start: number,
      seen: string[],
      answer?: InteractionResponse,
    ): Promise<TurnOutcome | { readonly didWork: boolean }> => {
      let didWork = false;
      let next = start;
      while (next < roundCalls.length) {
        if (aborted()) {
          return finish("cancelled");
        }
        const first = next;
        const batch = roundCalls.slice(first, first + parallelRunLength(roundCalls.slice(first)));
        next = first + batch.length;
        let writesSeen = ledger.writes.length;
        const settlements = await Promise.all(
          batch.map(async (call, index) => {
            const { callId } = call;
            emit({
              type: "tool_start",
              callId,
              name: call.name,
              interactive: input.tools.getDefinition(call.name)?.interactive === true,
            });
            /* The call's own signal: it aborts with the turn, and is unlinked once the call
               settles, so a Stop later in the turn reaches nothing that already finished. */
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
            try {
              return await invoke(
                call,
                ctx,
                link.signal,
                first === start && index === 0 ? answer : undefined,
              );
            } finally {
              link.release();
            }
          }),
        );
        for (const [index, call] of batch.entries()) {
          const { callId } = call;
          const result = settlements[index]!;
          /* The call needs a person and the host is not waiting on one here: the turn stops with
             this call first in line. Any call after it in the batch is read-only (that is what put
             it in one), so running it again on resume repeats nothing. */
          if (isSuspension(result)) {
            return suspend(result.suspend.kind === "approval" ? "permission" : "interaction", {
              awaiting: { callId, request: result.suspend },
              pending: { messageId, calls: [...roundCalls], next: first + index },
            });
          }
          input.hooks?.afterTool?.({ callId, name: call.name, result });
          // A call that suspends the turn on a person does not spend its work budget.
          if (input.tools.getDefinition(call.name)?.interactive !== true) {
            didWork = true;
          }
          if (!result.success && result.error) {
            errors.push(result.error);
          }
          const recorded = ledger.writes.slice(writesSeen);
          writesSeen = ledger.writes.length;
          if (result.success && result.summary && recorded.some((write) => write.ok)) {
            applied.push(result.summary);
          }
          for (const write of recorded) {
            emit({ type: "write", callId, write });
          }
          const content = JSON.stringify(result);
          seen.push(call.name, call.argumentsText, content);
          const toolMessageId = newId();
          appended.push({
            id: toolMessageId,
            role: "tool",
            blocks: [
              {
                type: "tool_result",
                callId,
                isError: result.success === false,
                content,
              },
            ],
            timestamp: now(),
          });
          emit({ type: "tool_result", callId, messageId, toolMessageId, result });
        }
      }
      return { didWork };
    };

    emit(resumed ? { type: "turn_start", resumed: true } : { type: "turn_start" });
    const { sealed, dropped, moved } = repair;
    if (sealed.length + dropped.length + moved.length > 0) {
      emit({ type: "transcript_repaired", sealed, dropped, moved });
    }

    /* A resumed turn first finishes the round it stopped in (§3.12): the call it was waiting on
       gets the person's answer, the calls after it run, and none before it runs again. */
    if (resumed) {
      const check = checkResume(resumed, input);
      if (!check.ok) {
        return finish("error", {
          error: {
            code: "resume_refused",
            message: `This turn cannot be resumed: ${check.reason}.`,
          },
        });
      }
      if (aborted()) {
        return finish("cancelled");
      }
      const { pending } = resumed;
      if (pending) {
        const ran = await runCalls(
          pending.messageId,
          pending.calls,
          pending.next,
          [],
          (resumed.awaiting && resumeAnswer) || undefined,
        );
        if ("kind" in ran) {
          return ran;
        }
        if (ran.didWork) {
          workRounds += 1;
        }
        if (aborted()) {
          return finish("cancelled");
        }
      }
    }
    /* The turn ends from inside this loop: on a round with no calls, or on the closing round, which
       the bounds below reach whatever the model does. */
    for (let round = rounds + 1; ; round++) {
      rounds = round;
      let closing: CapReason | null = null;
      if (repeating) {
        closing = "repeating";
      } else if (round > policy.maxRounds || workRounds >= policy.maxWorkRounds) {
        closing = "budget";
      }
      const messageId =
        round === 1 && input.firstMessageId !== undefined && !resumed
          ? input.firstMessageId
          : newId();
      emit(
        closing
          ? { type: "round_start", round, workRounds, messageId, closing }
          : { type: "round_start", round, workRounds, messageId },
      );

      /* A closing round still lists the tools. Taking them away would refuse the request on a
         provider that wants a listing beside any call in the history, and would throw away the
         prompt cache for its last request; a call the model makes anyway is simply not run. */
      const tools = fromOpenAITools(input.tools.listForLLM());
      const note: ChatMessage | null = closing
        ? {
            id: newId(),
            role: "user",
            blocks: [{ type: "text", text: policy.closingText(closing) }],
            timestamp: now(),
            meta: { origin: "harness", kind: "round_cap" },
          }
        : null;
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
        note
          ? {
              system: input.system,
              messages: [...history, ...appended, note],
              tools,
              closing: note,
            }
          : { system: input.system, messages: [...history, ...appended], tools },
        signal,
      )) {
        /* A closing round's calls will not run, so they are not drawn either: a call on screen, or
           in the transcript, with no reply is a question this turn has already decided to leave. */
        if (
          closing &&
          (frame.type === "tool_call_start" ||
            frame.type === "tool_call_delta" ||
            frame.type === "tool_call_end")
        ) {
          continue;
        }
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
        const error: TurnError = errorCode
          ? { message: errorMessage, code: errorCode }
          : { message: errorMessage };
        input.hooks?.onStreamError?.(error);
        emit({ type: "round_end", messageId, stopReason, truncated, dropped: true, error });
        /* An error the host said is worth waiting out (§3.12): the turn stops before this round,
           so a resume asks the model again once the provider will answer. */
        if (errorCode && !closing && !aborted() && policy.suspendOn.includes(errorCode)) {
          rounds = round - 1;
          return suspend(
            suspendReasonFor(errorCode),
            { awaiting: null, pending: null },
            { error, removedMessageId: messageId },
          );
        }
        // The closing round was a courtesy: losing it is not what the turn failed of.
        return closing && !aborted()
          ? capped(closing)
          : finish("error", { error, removedMessageId: messageId });
      }

      /* A turn that has drawn nothing by the end of a round with no calls ends here. A stopped
         round is not empty: the author ended it. */
      const stopped = stopReason === "cancelled" || aborted();
      const drawn = text !== "" || records.length > 0;
      if (closing && !stopped && text.trim() === "") {
        emit({ type: "round_end", messageId, stopReason, truncated, dropped: true });
        return capped(closing);
      }
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
        const drawnMessage: ChatMessage = {
          id: messageId,
          role: "assistant",
          blocks,
          timestamp: now(),
        };
        appended.push(
          truncated ? { ...drawnMessage, meta: { incomplete: "truncated" } } : drawnMessage,
        );
        anchor = messageId;
      }
      if (stopped) {
        return finish("cancelled");
      }
      if (closing) {
        return finish("cap_partial");
      }
      if (calls.size === 0) {
        return finish("complete");
      }

      const seen: string[] = [];
      const ran = await runCalls(
        messageId,
        Array.from(calls, ([callId, call]): ToolCall => ({
          callId,
          name: call.name,
          argumentsText: call.argumentsText,
        })),
        0,
        seen,
      );
      if ("kind" in ran) {
        return ran;
      }
      const { didWork } = ran;

      if (didWork) {
        workRounds += 1;
        const fingerprint = JSON.stringify(seen);
        const count = (roundsSeen.get(fingerprint) ?? 0) + 1;
        roundsSeen.set(fingerprint, count);
        repeating = count >= policy.maxIdenticalRounds;
      }
      // A Stop that landed during the round's last call opens no further round.
      if (aborted()) {
        return finish("cancelled");
      }
    }
  }

  const outcome = loop().finally(settle);
  void (async () => {
    try {
      await outcome;
      queue.close();
    } catch (error) {
      queue.close({ error });
    }
  })();

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
