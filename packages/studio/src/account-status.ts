/**
 * Account onboarding status — a synchronous render cache over the optional
 * `platform.getAccountStatus` PAL member (cloud GitHub-App installations). Hydrated once at boot
 * (studio.ts) like the project-list cache; the welcome screen reads it synchronously to prompt
 * "install the GitHub App" when the user has no repository access yet.
 */
import { getPlatform, hasPlatform } from "./platform";
import type { AccountStatus, AccountSubscription } from "./types";

let cache: AccountStatus | null = null;

/** Refresh the cache from the platform; null when unsupported, failing, or unknown. */
export async function hydrateAccountStatus(): Promise<void> {
  if (!hasPlatform() || typeof getPlatform().getAccountStatus !== "function") {
    cache = null;
    return;
  }
  try {
    cache = (await getPlatform().getAccountStatus?.()) ?? null;
  } catch {
    // Onboarding prompts are progressive enhancement; unknown status never nags.
    cache = null;
  }
}

/** Synchronous snapshot for render paths (never awaits); null = unknown. */
export function getAccountStatus(): AccountStatus | null {
  return cache;
}

/** True when the account verifiably has no repository access yet and we know where to fix it. */
export function needsAppInstall(): boolean {
  return cache !== null && cache.installations.length === 0 && Boolean(cache.appInstallUrl);
}

/** Where the user can widen the App's repository access, for the repo picker's access footer. */
export interface RepoAccessLinks {
  /** One entry per installation that reports its settings page, in the platform's order. */
  manage: { account: string; url: string }[];
  /** Install the App on an account that has none yet (also covers "another organization"). */
  installUrl?: string;
}

/**
 * Links that let the user grant the App access to more repositories: each installation's own
 * settings page plus the install URL for accounts it has not reached yet. Null when the status is
 * unknown (platform without `getAccountStatus`, or a failed hydrate) or when nothing is linkable —
 * callers render no access affordance rather than a dead link.
 */
export function getRepoAccessLinks(): RepoAccessLinks | null {
  if (cache === null) {
    return null;
  }
  const manage = cache.installations.flatMap((entry) =>
    entry.manageUrl
      ? [{ account: entry.account ?? `Installation ${entry.id}`, url: entry.manageUrl }]
      : [],
  );
  if (manage.length === 0 && !cache.appInstallUrl) {
    return null;
  }
  return { manage, ...(cache.appInstallUrl ? { installUrl: cache.appInstallUrl } : {}) };
}

/**
 * The plan the platform sells and where this user stands on it; null when it sells none, or when
 * the standing is unknown — which is the same answer to every surface: say nothing about a plan.
 */
export function getSubscription(): AccountSubscription | null {
  return cache?.subscription ?? null;
}

/** How far ahead a trial's end is worth a word on the Start pane. */
const TRIAL_REMINDER_DAYS = 7;

/** What the Start pane's plan notice says and offers; null when it has nothing to say. */
export interface PlanNotice {
  /** The plan, as the section's title. */
  title: string;
  /** One sentence. */
  text: string;
  /** The button: start the plan, manage the one held, or none for an announcement. */
  action: "upgrade" | "manage" | null;
  /** The button's words. */
  actionLabel: string;
}

/**
 * The Start pane's plan notice — present only when there is something the user should act on or the
 * platform asked to have said. A user in good standing on a plan sees nothing at all, and so does
 * everyone on a platform that sells none.
 *
 * Three cases, in priority order: the platform's own announcement; a required plan the user does
 * not hold; a trial ending within {@link TRIAL_REMINDER_DAYS} with no payment method to continue
 * on.
 */
export function planNotice(now: number = Date.now()): PlanNotice | null {
  const plan = getSubscription();
  if (!plan) {
    return null;
  }
  const upgradeLabel = plan.trialAvailable ? "Start free trial" : "Subscribe";
  const needsPlan = plan.required && !plan.entitled;
  if (plan.notice) {
    return {
      action: needsPlan ? "upgrade" : null,
      actionLabel: needsPlan ? upgradeLabel : "",
      text: plan.notice,
      title: plan.planName,
    };
  }
  if (needsPlan) {
    const days = plan.trialDays ? `${plan.trialDays}-day ` : "";
    return {
      action: "upgrade",
      actionLabel: upgradeLabel,
      text: plan.trialAvailable
        ? `Opening and saving projects here needs ${plan.planName}. Start with a ${days}free trial.`
        : `Opening and saving projects here needs ${plan.planName}.`,
      title: plan.planName,
    };
  }
  if (plan.state === "trialing" && plan.trialEndsAt && plan.hasPaymentMethod === false) {
    const ends = Date.parse(plan.trialEndsAt);
    if (Number.isFinite(ends) && ends - now <= TRIAL_REMINDER_DAYS * 86_400_000) {
      return {
        action: plan.manageUrl ? "manage" : null,
        actionLabel: plan.manageUrl ? "Add payment method" : "",
        text: `Your trial ends on ${new Date(ends).toLocaleDateString()}. Add a payment method to keep your plan.`,
        title: plan.planName,
      };
    }
  }
  return null;
}

/** Reset seam for tests. */
export function resetAccountStatus(): void {
  cache = null;
}
