/**
 * Interaction-store.ts — where a turn waits on the author (specs/ai.md §3.4 and §3.11).
 *
 * A call that needs a person (`ask_user`'s question) never runs a tool body that awaits them: the
 * invoker answers `needs_input`, the turn engine hands the request to this store's inline strategy,
 * and the turn waits on the promise it returns. The panel reads `pending` to draw the question in
 * its chip and the composer, and settles it with `answer`, `skip` or, on Stop, `cancel`. The answer
 * goes back to the invoker, which gives it to the tool's `settle`, so it travels as the tool result
 * and never as a user message.
 *
 * Exactly one interaction can be pending, because a turn runs its calls one at a time and a window
 * runs one turn.
 *
 * @license MIT
 */

import type { InteractionStrategy } from "@jxsuite/ai/harness";
import type { InteractionRequest, InteractionResponse } from "@jxsuite/ai/tools";
import { reactive } from "../../reactivity";

/** What a turn is waiting on. `callId` is the call's id, so the chip and the request agree. */
export interface PendingInteraction {
  readonly callId: string;
  readonly request: InteractionRequest;
}

/** The author's side of a turn that is waiting on them. */
export interface InteractionStore {
  /** What the turn is waiting on, or null. Reactive: read it inside an `effect()`. */
  readonly pending: PendingInteraction | null;
  /** The strategy a turn resolves its interactions through. */
  readonly strategy: InteractionStrategy;
  /**
   * Answer what is pending with the author's own words. A question takes them as its answer. An
   * approval reads them as its three choices (`APPROVAL_CHOICES`), or as a plain yes, and takes
   * anything else as a no: a call the author did not clearly allow does not run. False when nothing
   * is pending.
   */
  readonly answer: (text: string) => boolean;
  /** Decline to answer ("you decide"), which settles as a success. False when nothing is pending. */
  readonly skip: () => boolean;
  /** Settle the pending interaction as unanswered, as a stopped turn does. */
  readonly cancel: () => void;
  /** Drop the pending interaction, settling its turn as unanswered. */
  readonly reset: () => void;
}

/** The three answers an approval card offers, in the order it draws them. */
export const APPROVAL_CHOICES = {
  allow: "Allow",
  always: "Allow for this chat",
  decline: "Decline",
} as const;

/** What an author may type instead of pressing Allow. */
const AFFIRMATIVE = new Set(["allow", "approve", "ok", "okay", "y", "yes"]);

/** What the host may hook. */
export interface InteractionStoreOptions {
  /**
   * Called when the author allows a tool for the rest of the chat, before the turn hears the
   * answer, so the next call of that tool is not put to them again.
   */
  readonly onTrust?: (tool: string) => void;
  /**
   * Called once a request is pending, before the turn waits on it. A host saves the conversation
   * here: a turn waiting on a person may wait for as long as they like, and a reload in the
   * meantime must still find the question to restore as open.
   */
  readonly onPending?: () => void;
}

const SKIPPED: InteractionResponse = { answer: null, kind: "question", skipped: true };

/** The answer a stopped turn gives: a question unanswered and not skipped, an approval refused. */
function unanswered(request: InteractionRequest): InteractionResponse {
  return request.kind === "question"
    ? { answer: null, kind: "question", skipped: false }
    : { approved: false, kind: "approval" };
}

/**
 * A store with nothing pending.
 *
 * @param {InteractionStoreOptions} [options]
 * @returns {InteractionStore}
 */
export function createInteractionStore({
  onPending,
  onTrust,
}: InteractionStoreOptions = {}): InteractionStore {
  const state = reactive<{ pending: PendingInteraction | null }>({ pending: null });
  /** The settler for the pending request, kept out of the reactive object (it is not render data). */
  let settle: ((response: InteractionResponse) => void) | null = null;
  /** Torn down with the request, so a stopped turn leaves no listener on a dead signal. */
  let detachAbort: (() => void) | null = null;

  /** Clear the pending request and settle its turn with `response`; false when none is pending. */
  function finish(response: (request: InteractionRequest) => InteractionResponse): boolean {
    const resolve = settle;
    const { pending } = state;
    if (!resolve || !pending) {
      return false;
    }
    state.pending = null;
    settle = null;
    detachAbort?.();
    detachAbort = null;
    resolve(response(pending.request));
    return true;
  }

  function cancel(): void {
    finish(unanswered);
  }

  return {
    get pending() {
      return state.pending;
    },
    strategy: {
      mode: "inline",
      resolve: (request, { callId, signal }) =>
        new Promise<InteractionResponse>((resolve) => {
          if (signal.aborted) {
            resolve(unanswered(request));
            return;
          }
          state.pending = { callId, request };
          settle = resolve;
          signal.addEventListener("abort", cancel, { once: true });
          detachAbort = () => signal.removeEventListener("abort", cancel);
          onPending?.();
        }),
    },
    answer: (text) =>
      finish((request) => {
        if (request.kind === "question") {
          return { answer: text, kind: "question", skipped: false };
        }
        const said = text.trim().toLowerCase();
        const always = said === APPROVAL_CHOICES.always.toLowerCase();
        if (always) {
          onTrust?.(request.tool);
        }
        return { approved: always || AFFIRMATIVE.has(said), kind: "approval" };
      }),
    // "You decide" is a question's answer; nobody can decide an approval but the author.
    skip: () => finish((request) => (request.kind === "question" ? SKIPPED : unanswered(request))),
    cancel,
    reset: cancel,
  };
}
