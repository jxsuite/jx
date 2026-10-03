/// <reference lib="dom" />
/**
 * Action-flow.ts — what Studio does when the backend refuses something and offers what to do.
 *
 * A backend answers an action it will not allow yet with `action-required` (desktop.md §10.4): its
 * own heading, its own sentence, the actions it offers and what to do once one is done. Studio does
 * not know why — a role, a policy, a plan, a quota — and does not need to. This module shows the
 * refusal in one dialog, runs the chosen action through `platform.performAction`, and follows the
 * backend's `retry` hint. `surfaces/dialog.ts` draws each phase; every word about the refusal
 * itself is the backend's, and the few this module supplies ("Not now", "Waiting…") are about the
 * dialog.
 *
 * **One dialog at a time.** A refused project open is a burst — `activate`, `project-info`, a
 * directory listing — and every one of them reports. Callers that ask while a dialog is up join
 * it.
 *
 * **Declining is remembered for the page.** The reports that arrive by themselves
 * ({@link wireActionReports}) stop offering once the user has said "Not now", because a session
 * whose every request is refused would otherwise reopen the dialog on each one. An action the user
 * takes on purpose — a commit, a New Project — still asks, because that is a new question.
 *
 * @docs studio/interface/welcome-screen
 */

import { hydrateAccountStatus, takeToastNotices } from "../account-status";
import { getPlatform, hasPlatform } from "../platform";
import { platformErrorInfo } from "../platform-errors";
import { notify } from "../services/notify";
import { resetModelCache } from "../services/ai-models";
import { openDialogSurface } from "../surfaces/dialog";
import { layerHost } from "../ui/layers";
import { onActionRequired } from "./action-required";
import type { ActionRequiredReport } from "./action-required";
import type { ActionOutcome, OfferedAction, RetryHint } from "../types";

/** A refusal to offer: what the backend offered, in its own words. */
export interface ActionPrompt {
  actions: OfferedAction[];
  heading?: string | undefined;
  detail?: string | undefined;
  retry?: RetryHint | undefined;
}

/** Whether this platform can perform an offered action at all. */
export function canPerformActions(): boolean {
  return hasPlatform() && typeof getPlatform().performAction === "function";
}

/** The action a surface leads with — the one marked primary, else the first — and one other. */
export function leadingActions(
  actions: readonly OfferedAction[],
): { lead: OfferedAction; other?: OfferedAction } | null {
  const lead = actions.find((action) => action.primary) ?? actions[0];
  if (!lead) {
    return null;
  }
  const other = actions.find((action) => action !== lead);
  return other ? { lead, other } : { lead };
}

/** The dialog currently up, joined by every caller that asks while it is. */
let running: Promise<boolean> | null = null;

/** Set once the user declines; silences the reports that arrive on their own until reload. */
let declined = false;

/**
 * Offer a refusal's actions, and resolve whether one of them is now done.
 *
 * Resolves false at once on a platform that cannot perform actions, or for a refusal that offers
 * nothing, and when the user declines or closes the dialog. Never rejects: an action that failed is
 * drawn in the dialog, which stays up so the user can try again or give up.
 */
export function promptAction(prompt: ActionPrompt): Promise<boolean> {
  const leading = leadingActions(prompt.actions);
  if (!canPerformActions() || !leading) {
    return Promise.resolve(false);
  }
  running ??= offer(prompt, leading).finally(() => {
    running = null;
  });
  return running;
}

/**
 * A caught error, offered when it is an `action-required` refusal with something to offer. Resolves
 * whether the caller should now try again: false for any other error (nothing was offered) and for
 * an offer declined.
 */
export async function actIfRequired(error: unknown): Promise<boolean> {
  const info = platformErrorInfo(error);
  if (info.code !== "action-required" || !info.actions?.length) {
    return false;
  }
  return promptAction({
    actions: info.actions,
    detail: error instanceof Error ? error.message : undefined,
    heading: info.heading,
    retry: info.retry,
  });
}

/**
 * Everything a done action may have changed, re-read: the account rows and Start-pane notices read
 * the status cache, and the assistant's gate reads the models probe. Then whatever the platform now
 * wants announced is announced — in its words, not Studio's.
 */
async function settleDone(): Promise<void> {
  resetModelCache();
  await hydrateAccountStatus();
  showToastNotices();
}

/** Run one dialog to its end. */
function offer(
  prompt: ActionPrompt,
  leading: { lead: OfferedAction; other?: OfferedAction },
): Promise<boolean> {
  const message = prompt.detail ?? "This needs one more step first.";
  return new Promise<boolean>((resolve) => {
    let phase: "offer" | "waiting" | "done" = "offer";
    const finish = (done: boolean) => {
      if (phase === "done") {
        return;
      }
      phase = "done";
      handle.close();
      resolve(done);
    };
    const offerAgain = (sentence: string) => {
      phase = "offer";
      handle.update({
        cancelLabel: "Not now",
        confirmLabel: leading.lead.label,
        message: sentence,
        secondaryLabel: leading.other?.label ?? "",
      });
    };

    const begin = (action: OfferedAction) => {
      if (phase !== "offer") {
        return;
      }
      phase = "waiting";
      /* Called straight from the click, with nothing awaited first: `performAction` opens its
         window synchronously, and only code still inside the click may. */
      let flow: Promise<ActionOutcome | null>;
      try {
        flow = getPlatform().performAction!(action);
      } catch (error) {
        offerAgain(error instanceof Error ? error.message : String(error));
        return;
      }
      handle.update({
        cancelLabel: "Cancel",
        confirmLabel: "Waiting…",
        message: "Finish in the window that opened. This closes by itself once it is done.",
        secondaryLabel: "",
      });
      void flow.then(
        async (outcome) => {
          /* A done action is re-read even when the dialog is already gone — the user may have
             dismissed the waiting dialog and finished in the window anyway, and the account must
             not go on saying otherwise. */
          if (outcome?.status === "done") {
            await settleDone();
            finish(true);
            return;
          }
          if (phase !== "waiting" || !outcome || outcome.status === "redirect") {
            // Dismissed meanwhile, or the page is navigating to the action: nothing to draw.
            return;
          }
          // Closed without saying: the account may have changed anyway, so re-read it, and offer again.
          void hydrateAccountStatus();
          offerAgain(message);
        },
        (error: unknown) => {
          if (phase === "waiting") {
            offerAgain(error instanceof Error ? error.message : String(error));
          }
        },
      );
    };

    const { lead, other } = leading;
    const handle = openDialogSurface({
      cancelLabel: "Not now",
      confirmLabel: lead.label,
      headline: prompt.heading ?? "One more step",
      layer: layerHost("dialog"),
      message,
      onCancel: () => {
        declined = true;
        finish(false);
      },
      onClosed: () => {
        finish(false);
      },
      onConfirm: () => {
        begin(lead);
      },
      region: "account/action",
      ...(other
        ? {
            onSecondary: () => {
              begin(other);
            },
            secondaryLabel: other.label,
          }
        : {}),
    });
  });
}

/** Follow a done refusal's retry hint: reload a session it broke, or ask for the action again. */
function afterDone(retry: RetryHint | undefined): void {
  if (retry === "reload") {
    location.reload();
  } else if (retry === "repeat") {
    notify.info("Done. Run that again now.", { key: "account.action.retry", source: "Account" });
  }
}

/**
 * Offer the actions of every refusal the platform adapter reports by itself — the refusals no
 * caller asked to handle. Returns the unsubscribe. Called once, at boot.
 */
export function wireActionReports(): () => void {
  return onActionRequired((report: ActionRequiredReport) => {
    if (declined || running) {
      return;
    }
    void promptAction(report).then((done) => {
      if (done) {
        afterDone(report.retry);
      }
    });
  });
}

/**
 * Run an action offered outside a refusal — on a Start-pane notice or an account row. Resolves
 * whether it is done; either way the account status is re-read, because an action is how it
 * changes. Synchronous up to `performAction`, which opens its window from inside the click.
 */
export async function runOfferedAction(action: OfferedAction): Promise<boolean> {
  if (!canPerformActions()) {
    return false;
  }
  const pending = getPlatform().performAction!(action);
  let outcome: ActionOutcome | null;
  try {
    outcome = await pending;
  } catch (error) {
    // A toast, not a Problems entry: it answers the click, and nothing is left standing to fix.
    notify.error(error instanceof Error ? error.message : String(error), {
      key: "account.action",
      source: "Account",
      tier: "toast",
    });
    return false;
  }
  if (outcome?.status === "done") {
    await settleDone();
    return true;
  }
  if (outcome?.status !== "redirect") {
    await hydrateAccountStatus();
  }
  return false;
}

/**
 * Show the platform's one-time notices — how an action that left the page ended, or anything else
 * it wants said once. Called at boot after the account status is read, and after every done
 * action.
 */
export function showToastNotices(): void {
  for (const notice of takeToastNotices()) {
    const options = { key: `account.notice.${notice.id}`, source: "Account" };
    if (notice.level === "warning") {
      notify.warn(notice.message, options);
    } else {
      notify.info(notice.message, options);
    }
  }
}

/** Forget the dialog and the decline — tests only. */
export function resetActionFlow(): void {
  running = null;
  declined = false;
}
