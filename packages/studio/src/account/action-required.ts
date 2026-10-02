/**
 * Action-required.ts — the channel a platform adapter raises an `action-required` refusal on.
 *
 * A backend refuses the session's own requests with `action-required` (HTTP 403, desktop.md §10.4),
 * and those requests are made deep inside an adapter by callers that have no business knowing about
 * access rules: a file read, a directory listing, the boot-time `activate`. Each of them still
 * throws its ordinary error, and this is the side channel that says, once, "and here is what the
 * user can do about it" — to the one listener that can offer it (`action-flow.ts`).
 *
 * No DOM and no imports beyond types, so an adapter can raise on it from anywhere without pulling
 * the dialog layer into its module graph.
 *
 * **A report raised before anyone listens is kept.** The boot-time `activate` runs as the studio
 * module evaluates, and its refusal can land before the flow has subscribed; dropping it would be
 * exactly the silent failure this channel exists to prevent. Only the latest one is kept — they all
 * say the same thing.
 */

import type { OfferedAction, RetryHint } from "@jxsuite/protocol";

/** One refusal, in the backend's words. */
export interface ActionRequiredReport {
  /** What the backend offers. A report is raised only when it offers something. */
  actions: OfferedAction[];
  /** The refusal's heading. */
  heading?: string;
  /** The refusal's `detail`. */
  detail?: string;
  /** What to do once an action is done. */
  retry?: RetryHint;
}

type Listener = (report: ActionRequiredReport) => void;

const listeners = new Set<Listener>();

/** The latest report raised while nobody was listening; delivered to the first subscriber. */
let pending: ActionRequiredReport | null = null;

/** Raise a refusal. Every listener hears it; with none yet, the first one to subscribe will. */
export function reportActionRequired(report: ActionRequiredReport): void {
  if (listeners.size === 0) {
    pending = report;
    return;
  }
  for (const listener of listeners) {
    listener(report);
  }
}

/** Hear every refusal from now on, and the one raised before this call, if any. */
export function onActionRequired(listener: Listener): () => void {
  listeners.add(listener);
  const missed = pending;
  pending = null;
  if (missed) {
    listener(missed);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Drop every listener and any kept report — tests only. */
export function resetActionReports(): void {
  listeners.clear();
  pending = null;
}
