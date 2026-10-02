/**
 * Tests for src/account-status.ts — the synchronous render cache over the optional
 * `platform.getAccountStatus` PAL member, and src/platform-errors.ts — structured platform-error
 * recovery (the needs_installation_access install link).
 */
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  getAccountStatus,
  getRepoAccessLinks,
  getSubscription,
  hydrateAccountStatus,
  needsAppInstall,
  planNotice,
  resetAccountStatus,
} from "../src/account-status";
import { installUrlOf, platformErrorInfo } from "../src/platform-errors";

const INSTALL_URL = "https://github.com/apps/jx-suite/installations/new";

beforeEach(() => {
  resetAccountStatus();
});

describe("account-status cache", () => {
  test("hydrates from the platform and reports needsAppInstall on empty coverage", async () => {
    installMockPlatform({
      getAccountStatus: () => Promise.resolve({ appInstallUrl: INSTALL_URL, installations: [] }),
    });
    expect(getAccountStatus()).toBeNull();
    expect(needsAppInstall()).toBe(false);
    await hydrateAccountStatus();
    expect(getAccountStatus()?.appInstallUrl).toBe(INSTALL_URL);
    expect(needsAppInstall()).toBe(true);
  });

  test("an existing installation means no prompt", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [{ account: "octocat", id: 7 }],
        }),
    });
    await hydrateAccountStatus();
    expect(needsAppInstall()).toBe(false);
  });

  test("no install URL means no prompt even with zero installations", async () => {
    installMockPlatform({ getAccountStatus: () => Promise.resolve({ installations: [] }) });
    await hydrateAccountStatus();
    expect(needsAppInstall()).toBe(false);
  });

  test("unsupported platforms and failures resolve to unknown (null, never nags)", async () => {
    installMockPlatform();
    await hydrateAccountStatus();
    expect(getAccountStatus()).toBeNull();

    installMockPlatform({ getAccountStatus: () => Promise.reject(new Error("offline")) });
    await hydrateAccountStatus();
    expect(getAccountStatus()).toBeNull();
    expect(needsAppInstall()).toBe(false);
  });
});

describe("getRepoAccessLinks", () => {
  test("one manage link per installation that reports one, plus the install URL", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          appInstallUrl: INSTALL_URL,
          installations: [
            { account: "octocat", id: 7, manageUrl: "https://github.com/settings/installations/7" },
            // No manageUrl: not linkable, so it contributes nothing.
            { account: "acme", id: 8 },
            {
              account: null,
              id: 9,
              manageUrl: "https://github.com/organizations/globex/settings/installations/9",
            },
          ],
        }),
    });
    await hydrateAccountStatus();
    expect(getRepoAccessLinks()).toEqual({
      manage: [
        { account: "octocat", url: "https://github.com/settings/installations/7" },
        {
          account: "Installation 9",
          url: "https://github.com/organizations/globex/settings/installations/9",
        },
      ],
      installUrl: INSTALL_URL,
    });
  });

  test("the install URL alone still offers a way to widen access", async () => {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({ appInstallUrl: INSTALL_URL, installations: [{ account: "a", id: 1 }] }),
    });
    await hydrateAccountStatus();
    expect(getRepoAccessLinks()).toEqual({ manage: [], installUrl: INSTALL_URL });
  });

  test("unknown status, or nothing linkable, means no affordance at all", async () => {
    installMockPlatform();
    await hydrateAccountStatus();
    expect(getRepoAccessLinks()).toBeNull();

    installMockPlatform({
      getAccountStatus: () => Promise.resolve({ installations: [{ account: "a", id: 1 }] }),
    });
    await hydrateAccountStatus();
    expect(getRepoAccessLinks()).toBeNull();
  });
});

describe("platform-errors", () => {
  test("recovers structured fields from an augmented Error", () => {
    const error = Object.assign(new Error("blocked"), {
      code: "needs_installation_access",
      installUrl: INSTALL_URL,
    });
    // The underscored legacy code and the hyphenated problem-type slug are one code; normalizing
    // Is what lets a migrated and an unmigrated backend reach the same branch below.
    expect(platformErrorInfo(error)).toEqual({
      code: "needs-installation-access",
      installUrl: INSTALL_URL,
    });
    expect(installUrlOf(error)).toBe(INSTALL_URL);
  });

  test("plain errors and non-errors carry nothing", () => {
    expect(platformErrorInfo(new Error("boom"))).toEqual({});
    expect(platformErrorInfo("boom")).toEqual({});
    expect(platformErrorInfo(null)).toEqual({});
    expect(installUrlOf(new Error("boom"))).toBeNull();
    // A different structured code is not the install case.
    const otherCode = Object.assign(new Error("x"), { code: "other", installUrl: "u" });
    expect(installUrlOf(otherCode)).toBeNull();
  });
});

describe("the hosted plan", () => {
  const PLAN = {
    entitled: false,
    planName: "Jx Studio Cloud",
    required: true,
    state: "none" as const,
    trialAvailable: true,
    trialDays: 30,
  };

  async function withPlan(subscription?: Record<string, unknown>): Promise<void> {
    installMockPlatform({
      getAccountStatus: () =>
        Promise.resolve({
          installations: [],
          ...(subscription ? { subscription: subscription as never } : {}),
        }),
    });
    await hydrateAccountStatus();
  }

  test("a platform that sells nothing has no plan and no notice", async () => {
    await withPlan();
    expect(getSubscription()).toBeNull();
    expect(planNotice()).toBeNull();
    resetAccountStatus();
    expect(getSubscription()).toBeNull();
  });

  test("a required plan the user does not hold is offered, with its trial when there is one", async () => {
    await withPlan(PLAN);
    expect(getSubscription()?.planName).toBe("Jx Studio Cloud");
    expect(planNotice()).toEqual({
      action: "upgrade",
      actionLabel: "Start free trial",
      text: "Opening and saving projects here needs Jx Studio Cloud. Start with a 30-day free trial.",
      title: "Jx Studio Cloud",
    });
    await withPlan({ ...PLAN, trialAvailable: false });
    expect(planNotice()).toMatchObject({
      actionLabel: "Subscribe",
      text: "Opening and saving projects here needs Jx Studio Cloud.",
    });
    await withPlan({ ...PLAN, trialDays: undefined });
    expect(planNotice()?.text).toEndWith("Start with a free trial.");
  });

  test("the platform's announcement wins, and offers the plan only to someone who needs it", async () => {
    await withPlan({ ...PLAN, notice: "Plans start on 1 November." });
    expect(planNotice()).toEqual({
      action: "upgrade",
      actionLabel: "Start free trial",
      text: "Plans start on 1 November.",
      title: "Jx Studio Cloud",
    });
    await withPlan({
      ...PLAN,
      entitled: true,
      notice: "Plans start on 1 November.",
      state: "active",
    });
    expect(planNotice()).toMatchObject({ action: null, actionLabel: "" });
  });

  test("a trial about to end with nothing to continue on is a reminder; otherwise nothing", async () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    const trial = {
      ...PLAN,
      entitled: true,
      hasPaymentMethod: false,
      manageUrl: "https://studio.test/portal",
      state: "trialing",
      trialEndsAt: "2026-11-01T00:00:00Z",
    };
    await withPlan(trial);
    expect(planNotice(now)).toMatchObject({ action: "manage", actionLabel: "Add payment method" });
    expect(planNotice(now)?.text).toStartWith("Your trial ends on ");
    // Weeks away, a card on file, or no date to count down to: nothing to say.
    expect(planNotice(Date.parse("2026-10-01T00:00:00Z"))).toBeNull();
    await withPlan({ ...trial, hasPaymentMethod: true });
    expect(planNotice(now)).toBeNull();
    await withPlan({ ...trial, trialEndsAt: "soon" });
    expect(planNotice(now)).toBeNull();
    // A reminder with nowhere to manage the plan says so without a button.
    await withPlan({ ...trial, manageUrl: undefined });
    expect(planNotice(now)).toMatchObject({ action: null, actionLabel: "" });
  });

  test("a user in good standing, or on a plan this deployment does not require, sees nothing", async () => {
    await withPlan({ ...PLAN, entitled: true, state: "active" });
    expect(planNotice()).toBeNull();
    await withPlan({ ...PLAN, required: false });
    expect(planNotice()).toBeNull();
  });
});
