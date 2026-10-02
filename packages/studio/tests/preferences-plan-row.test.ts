/**
 * Preferences › Accounts: the hosted plan's row (desktop.md §10.4).
 *
 * It exists only where the platform sells a plan — on every other platform a row would advertise a
 * product that does not exist — and its sentence names the next move for each standing. Its verbs
 * are the two the platform can serve, each shown only when it would do something.
 *
 * The upgrade flow is doubled: it opens a dialog, and what this row owes it is a call.
 */
import "./with-dom.js";
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { AccountSubscription } from "../src/types";

let upgradeAsks = 0;
let sellsPlan = true;
void mock.module("../src/account/upgrade-flow", () => ({
  canUpgrade: () => sellsPlan,
  promptUpgrade: async () => {
    upgradeAsks += 1;
    return false;
  },
}));

const { hydrateAccountStatus, resetAccountStatus } = await import("../src/account-status");
const { listAccounts } = await import("../src/settings/preferences-accounts");

const PLAN: AccountSubscription = {
  entitled: false,
  planName: "Jx Studio Cloud",
  required: true,
  state: "none",
  trialAvailable: true,
  trialDays: 30,
};

const manage = mock(async () => {});

async function withPlan(plan: Partial<AccountSubscription> | null): Promise<void> {
  installMockPlatform({
    getAccountStatus: async () => ({
      installations: [],
      ...(plan ? { subscription: { ...PLAN, ...plan } as AccountSubscription } : {}),
    }),
    manageSubscription: manage,
  });
  await hydrateAccountStatus();
}

function row() {
  return listAccounts().find((account) => account.id === "plan");
}

beforeEach(() => {
  resetAccountStatus();
  upgradeAsks = 0;
  sellsPlan = true;
  manage.mockClear();
});

describe("the plan row", () => {
  test("is absent on a platform that sells nothing", async () => {
    await withPlan(null);
    expect(listAccounts().map((account) => account.id)).toEqual(["github", "ai", "cloudflare"]);
  });

  test("a plan not started offers its trial, and starting it asks the flow", async () => {
    await withPlan({ priceLabel: "$5/month" });
    const plan = row();
    expect(plan?.label).toBe("Jx Studio Cloud");
    expect(plan?.connected).toBe(false);
    expect(plan?.detail).toBe("Not started. A 30-day free trial is available. $5/month.");
    expect(plan?.actions?.map((action) => action.label)).toEqual(["Start free trial"]);
    await plan?.actions?.[0]?.run();
    expect(upgradeAsks).toBe(1);
    // Revoking a plan is not a thing this app does; it is ended where it is managed.
    plan?.revoke();
  });

  test("each standing gets the sentence that names its next move", async () => {
    const cases: [Partial<AccountSubscription>, string][] = [
      [{ trialAvailable: false }, "Not subscribed."],
      [{ trialDays: undefined as never }, "Not started. A free trial is available."],
      [{ required: false }, "Not needed on this deployment."],
      [{ entitled: true, state: "trialing" }, "Free trial."],
      [
        { entitled: true, hasPaymentMethod: false, state: "trialing", trialEndsAt: "2026-11-01" },
        `Free trial until ${new Date("2026-11-01").toLocaleDateString()}. Add a payment method to keep it.`,
      ],
      [{ entitled: true, state: "active" }, "Active."],
      [
        { entitled: true, renewsAt: "2026-12-01", state: "active" },
        `Active, renews ${new Date("2026-12-01").toLocaleDateString()}.`,
      ],
      [
        { endsAt: "2026-12-01", entitled: true, state: "active" },
        `Active until ${new Date("2026-12-01").toLocaleDateString()}; it will not renew.`,
      ],
      [
        { entitled: true, state: "grace" },
        "The last payment failed. Update the payment method to keep the plan.",
      ],
      [{ state: "ended" }, "Ended. Subscribe again to open and save projects here."],
      [{ required: false, state: "ended" }, "Ended."],
    ];
    for (const [plan, detail] of cases) {
      await withPlan(plan);
      expect(row()?.detail).toBe(detail);
    }
  });

  test("a held plan with somewhere to manage it offers Manage, and nothing to start", async () => {
    await withPlan({ entitled: true, manageUrl: "https://studio.test/portal", state: "active" });
    expect(row()?.connected).toBe(true);
    expect(row()?.actions?.map((action) => action.id)).toEqual(["manage"]);
    await row()?.actions?.[0]?.run();
    expect(manage).toHaveBeenCalledTimes(1);
  });

  test("an ended plan offers both: start again, or manage the old one", async () => {
    await withPlan({
      manageUrl: "https://studio.test/portal",
      state: "ended",
      trialAvailable: false,
    });
    expect(row()?.actions?.map((action) => action.label)).toEqual(["Subscribe", "Manage"]);
  });

  test("a platform that cannot sell from here offers no start", async () => {
    sellsPlan = false;
    await withPlan({});
    expect(row()?.actions).toEqual([]);
  });
});
