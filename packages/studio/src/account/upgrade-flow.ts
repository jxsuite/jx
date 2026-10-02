/// <reference lib="dom" />
/**
 * Upgrade-flow.ts — what Studio does when a hosted platform says a plan would lift a refusal.
 *
 * A platform that sells a plan answers the actions the plan covers with `subscription-required`
 * (desktop.md §10.4). This module turns that answer into an offer: one dialog, in the platform's
 * own words, whose confirm runs `platform.startUpgrade` and whose outcome Studio then acts on. It
 * owns the state machine — offer, then waiting on the checkout window, then done or failed — and
 * `surfaces/dialog.ts` draws each phase; nothing here knows what sits behind the platform's URL.
 *
 * **One dialog at a time.** A refused project open is a burst — `activate`, `project-info`, a
 * directory listing — and every one of them reports. Callers that ask while a dialog is up join
 * it.
 *
 * **Declining is remembered for the page.** The reports that arrive by themselves
 * ({@link wireUpgradeReports}) stop offering once the user has said "Not now", because a session
 * whose every request is refused would otherwise reopen the dialog on each one. An action the user
 * takes on purpose — a commit, a New Project — still asks, because that is a new question.
 *
 * @docs studio/interface/preferences
 */

import { getAccountStatus, hydrateAccountStatus } from "../account-status";
import { getPlatform, hasPlatform } from "../platform";
import { platformErrorInfo } from "../platform-errors";
import { notify } from "../services/notify";
import { resetModelCache } from "../services/ai-models";
import { openDialogSurface } from "../surfaces/dialog";
import { layerHost } from "../ui/layers";
import { onUpgradeRequired } from "./upgrade-required";
import type { UpgradeRequiredReport } from "./upgrade-required";
import type { UpgradeOutcome } from "../types";

/** What an offer says, all of it optional: absent members fall back to the platform's plan. */
export interface UpgradePrompt {
  /** The refusal's own sentence. */
  detail?: string | undefined;
  /** The refusal's upgrade link, so the platform can return the user to what they were doing. */
  upgradeUrl?: string | undefined;
  /** Whether starting the plan would begin with a free trial. */
  trialAvailable?: boolean | undefined;
}

/** Whether this platform can sell a plan from inside Studio at all. */
export function canUpgrade(): boolean {
  return hasPlatform() && typeof getPlatform().startUpgrade === "function";
}

/** The dialog currently up, joined by every caller that asks while it is. */
let running: Promise<boolean> | null = null;

/** Set once the user declines; silences the reports that arrive on their own until reload. */
let declined = false;

/**
 * Offer the plan, and resolve whether the user now has it.
 *
 * Resolves false at once on a platform that sells nothing, and when the user declines or closes the
 * dialog. Never rejects: a checkout that failed is drawn in the dialog, which stays up so the user
 * can try again or give up.
 */
export function promptUpgrade(prompt: UpgradePrompt = {}): Promise<boolean> {
  if (!canUpgrade()) {
    return Promise.resolve(false);
  }
  running ??= offer(prompt).finally(() => {
    running = null;
  });
  return running;
}

/**
 * A caught error, offered as an upgrade when it is a plan refusal. Resolves whether the caller
 * should now try again: false for any other error (nothing was offered) and for an offer declined.
 */
export async function upgradeIfRequired(error: unknown): Promise<boolean> {
  const info = platformErrorInfo(error);
  if (info.code !== "subscription-required") {
    return false;
  }
  return promptUpgrade({
    detail: error instanceof Error ? error.message : undefined,
    upgradeUrl: info.upgradeUrl,
    trialAvailable: info.trialAvailable,
  });
}

/** The sentence after the refusal: what starting the plan costs, in the platform's numbers. */
function offerSentence(trial: boolean): string {
  const plan = getAccountStatus()?.subscription;
  if (trial) {
    const days = plan?.trialDays;
    const then = plan?.priceLabel ? `, then ${plan.priceLabel}` : "";
    return days ? `Start a ${days}-day free trial${then}.` : `Start a free trial${then}.`;
  }
  return plan?.priceLabel
    ? `Subscribe for ${plan.priceLabel} to continue.`
    : "Subscribe to continue.";
}

/** Run one dialog to its end. */
function offer(prompt: UpgradePrompt): Promise<boolean> {
  const plan = getAccountStatus()?.subscription;
  const planName = plan?.planName ?? "A subscription";
  const trial = prompt.trialAvailable ?? plan?.trialAvailable ?? false;
  const lede = prompt.detail ?? `This needs ${plan ? plan.planName : "a subscription"}.`;
  const offerMessage = `${lede} ${offerSentence(trial)}`;
  const confirmLabel = trial ? "Start free trial" : "Subscribe";

  return new Promise<boolean>((resolve) => {
    let phase: "offer" | "waiting" | "done" = "offer";
    const finish = (subscribed: boolean) => {
      if (phase === "done") {
        return;
      }
      phase = "done";
      handle.close();
      resolve(subscribed);
    };
    const failed = (sentence: string) => {
      phase = "offer";
      handle.update({ cancelLabel: "Not now", confirmLabel: "Try again", message: sentence });
    };

    const begin = () => {
      if (phase !== "offer") {
        return;
      }
      phase = "waiting";
      /* Called straight from the click, with nothing awaited first: `startUpgrade` opens its window
         synchronously, and only code still inside the click may. */
      let flow: Promise<UpgradeOutcome | null>;
      try {
        flow = getPlatform().startUpgrade!(
          prompt.upgradeUrl ? { upgradeUrl: prompt.upgradeUrl } : {},
        );
      } catch (error) {
        failed(error instanceof Error ? error.message : String(error));
        return;
      }
      handle.update({
        cancelLabel: "Cancel",
        confirmLabel: "Waiting…",
        message:
          "Finish in the window that opened. This closes by itself once your plan is active.",
      });
      void flow.then(
        async (outcome) => {
          /* A plan that started is re-read even when the dialog is already gone — the user may
             have dismissed the waiting dialog and finished the checkout anyway, and the account row
             must not go on saying they have no plan. */
          if (outcome?.status === "subscribed") {
            await settleSubscribed();
            finish(true);
            return;
          }
          if (phase !== "waiting" || !outcome || outcome.status === "redirect") {
            // Dismissed meanwhile, or the page is navigating to the checkout: nothing to draw.
            return;
          }
          failed(
            outcome.status === "timeout"
              ? "The checkout window did not finish. Nothing was charged; try again when you are ready."
              : offerMessage,
          );
        },
        (error: unknown) => {
          if (phase === "waiting") {
            failed(error instanceof Error ? error.message : String(error));
          }
        },
      );
    };

    const handle = openDialogSurface({
      cancelLabel: "Not now",
      confirmLabel,
      headline: planName,
      layer: layerHost("dialog"),
      message: offerMessage,
      onCancel: () => {
        declined = true;
        finish(false);
      },
      onClosed: () => {
        finish(false);
      },
      onConfirm: begin,
      region: "account/upgrade",
    });
  });
}

/**
 * Everything a fresh plan changes, re-read: the account row and welcome notice read the status
 * cache, and the assistant's gate reads the models probe, which answered "subscription required"
 * until now.
 */
async function settleSubscribed(): Promise<void> {
  resetModelCache();
  await hydrateAccountStatus();
  const plan = getAccountStatus()?.subscription;
  notify.success(
    plan?.state === "trialing" && plan.trialEndsAt
      ? `Your ${plan.planName} trial is active until ${new Date(plan.trialEndsAt).toLocaleDateString()}.`
      : `${plan?.planName ?? "Your subscription"} is active.`,
    { key: "account.upgrade", source: "Account" },
  );
}

/**
 * What to do once a report's dialog ends: a project that never loaded is reloaded, because the
 * session the refusal interrupted cannot be resumed half-open; anything else is the user's to run
 * again, and saying so is the whole answer.
 */
function afterReport(report: UpgradeRequiredReport, subscribed: boolean): void {
  if (!subscribed) {
    return;
  }
  if (report.kind === "open") {
    location.reload();
    return;
  }
  notify.info("Run that again now that your plan is active.", {
    key: "account.upgrade.retry",
    source: "Account",
  });
}

/**
 * Offer the plan whenever the platform adapter reports a refusal by itself — the refusals no caller
 * asked to handle. Returns the unsubscribe. Called once, at boot.
 */
export function wireUpgradeReports(): () => void {
  return onUpgradeRequired((report) => {
    if (declined || running) {
      return;
    }
    void promptUpgrade(report).then((subscribed) => {
      afterReport(report, subscribed);
    });
  });
}

/**
 * Announce how a full-page checkout round trip ended — the one ending `startUpgrade` could not
 * report, because the page it ran in navigated away. Called once, at boot, after the account status
 * has been read.
 */
export function consumeUpgradeReturn(): void {
  if (!hasPlatform()) {
    return;
  }
  const status = getPlatform().takeUpgradeReturn?.() ?? null;
  if (status === "success" || status === "pending") {
    const plan = getAccountStatus()?.subscription;
    notify.success(
      status === "success"
        ? `${plan?.planName ?? "Your subscription"} is active.`
        : "Your payment went through. Your plan activates within a minute.",
      { key: "account.upgrade", source: "Account" },
    );
  } else if (status === "error") {
    notify.error("The checkout could not be completed. Nothing was charged.", {
      key: "account.upgrade",
      source: "Account",
    });
  }
}

/**
 * The plan notice's button (Start pane, `account-status.ts`'s `planNotice`): start the plan, or
 * open where the one held is managed. Resolves once the account status reflects the outcome, so the
 * caller can repaint.
 */
export async function runPlanAction(action: "upgrade" | "manage" | null): Promise<void> {
  if (action === "manage") {
    await getPlatform().manageSubscription?.();
    return;
  }
  if (action === "upgrade") {
    await promptUpgrade();
  }
}

/** Forget the dialog and the decline — tests only. */
export function resetUpgradeFlow(): void {
  running = null;
  declined = false;
}
