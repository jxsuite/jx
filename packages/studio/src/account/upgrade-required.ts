/**
 * Upgrade-required.ts — the channel a platform adapter raises a plan refusal on.
 *
 * A hosted platform refuses the session's own requests with `subscription-required` (HTTP 402,
 * desktop.md §10.4), and those requests are made deep inside an adapter by callers that have no
 * business knowing about plans: a file read, a directory listing, the boot-time `activate`. Each of
 * them still throws its ordinary error, and this is the side channel that says, once, "and the fix
 * is an upgrade" — to the one listener that can offer one (`upgrade-flow.ts`).
 *
 * No DOM and no imports, so an adapter can raise on it from anywhere without pulling the dialog
 * layer into its module graph.
 *
 * **A report raised before anyone listens is kept.** The boot-time `activate` runs as the studio
 * module evaluates, and its refusal can land before the flow has subscribed; dropping it would be
 * exactly the silent failure this channel exists to prevent. Only the latest one is kept — they all
 * say the same thing.
 */

/** One plan refusal, in the backend's words. */
export interface UpgradeRequiredReport {
  /**
   * What the refused request was doing. `open` is the project failing to load at all, which is the
   * case a successful upgrade answers by reloading; `save` is a write to the repository the user
   * will want to run again; `other` is everything else the session asks for.
   */
  kind: "open" | "save" | "other";
  /** The refusal's `detail`, when it sent one. */
  detail?: string;
  /** The refusal's `upgradeUrl`, when it sent one. */
  upgradeUrl?: string;
  /** The refusal's `trialAvailable`, when it sent one. */
  trialAvailable?: boolean;
}

type Listener = (report: UpgradeRequiredReport) => void;

const listeners = new Set<Listener>();

/** The latest report raised while nobody was listening; delivered to the first subscriber. */
let pending: UpgradeRequiredReport | null = null;

/** Raise a plan refusal. Every listener hears it; with none yet, the first one to subscribe will. */
export function reportUpgradeRequired(report: UpgradeRequiredReport): void {
  if (listeners.size === 0) {
    pending = report;
    return;
  }
  for (const listener of listeners) {
    listener(report);
  }
}

/** Hear every plan refusal from now on, and the one raised before this call, if any. */
export function onUpgradeRequired(listener: Listener): () => void {
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
export function resetUpgradeReports(): void {
  listeners.clear();
  pending = null;
}
