/**
 * Ask.ts — an author for the loop tests that put questions: one interaction store, and its pending
 * question projected to the shape the agent-trace goldens recorded it in before the store existed.
 *
 * A test drives `runAgentLoop` with `interactions: askStore` and answers through these functions; a
 * document-assistant test passes the assistant's own store (`assistant.interactions`).
 */
import { createInteractionStore } from "../../src/services/harness/interaction-store";
import type { InteractionStore } from "../../src/services/harness/interaction-store";

/** The question a turn is waiting on, as the goldens record it. */
export interface PendingAskView {
  id: string;
  question: string;
  options: string[];
  context: string;
}

/** The store the loop tests' turns wait on. */
export const askStore = createInteractionStore();

/**
 * The pending question in `store`, or null.
 *
 * @param {InteractionStore} [store]
 * @returns {PendingAskView | null}
 */
export function pendingAsk(store: InteractionStore = askStore): PendingAskView | null {
  const { pending } = store;
  if (pending?.request.kind !== "question") {
    return null;
  }
  const { context, options, question } = pending.request;
  return { context, id: pending.callId, options: [...options], question };
}

/** Answer the pending question in `store`; false when none is pending. */
export function answerAsk(text: string, store: InteractionStore = askStore): boolean {
  return store.answer(text);
}

/** Decline the pending question in `store` ("you decide"); false when none is pending. */
export function skipAsk(store: InteractionStore = askStore): boolean {
  return store.skip();
}

/** Settle whatever `store` holds as unanswered, as a Stop does. */
export function resetAsk(store: InteractionStore = askStore): void {
  store.reset();
}
