/**
 * The Account verb (desktop.md §10.4): one record, offered only where `capability.upgrade` holds,
 * that takes a user who holds the plan to where it is managed and offers it to everyone else.
 *
 * The upgrade flow is doubled — it opens a dialog — and the double is the witness the run reached
 * it.
 */
import "./with-dom.js";
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeContext } from "../src/commands/context";

let offers = 0;
void mock.module("../src/account/upgrade-flow", () => ({
  promptUpgrade: async () => {
    offers += 1;
    return false;
  },
}));

const { accountCommands, openPlan } = await import("../src/account/account-commands");
const { hydrateAccountStatus, resetAccountStatus } = await import("../src/account-status");

const manage = mock(async () => {});

async function standing(subscription: Record<string, unknown> | null): Promise<void> {
  installMockPlatform({
    getAccountStatus: async () => ({
      installations: [],
      ...(subscription ? { subscription: subscription as never } : {}),
    }),
    manageSubscription: manage,
  });
  await hydrateAccountStatus();
}

beforeEach(() => {
  offers = 0;
  manage.mockClear();
  resetAccountStatus();
});

describe("account.plan", () => {
  test("is a palette-only application verb, offered only where a plan is sold", () => {
    const [plan] = accountCommands();
    expect(plan).toMatchObject({
      category: "Account",
      id: "account.plan",
      level: "application",
      menus: ["palette"],
    });
    expect(plan?.when?.(makeContext())).toBe(false);
    expect(plan?.when?.(makeContext({ capability: { upgrade: true } }))).toBe(true);
  });

  test("a user who holds the plan goes to where it is managed", async () => {
    await standing({
      entitled: true,
      manageUrl: "https://studio.test/portal",
      planName: "Plan",
      required: true,
      state: "active",
      trialAvailable: false,
    });
    void accountCommands()[0]?.run(makeContext(), undefined as never);
    expect(manage).toHaveBeenCalledTimes(1);
    expect(offers).toBe(0);
  });

  test("everyone else — no plan, no standing known, nowhere to manage it — is offered the plan", async () => {
    await standing({ entitled: false, planName: "Plan", required: true, state: "none" });
    openPlan();
    await standing(null);
    openPlan();
    await standing({ entitled: true, planName: "Plan", required: true, state: "active" });
    openPlan();
    expect(offers).toBe(3);
    expect(manage).not.toHaveBeenCalled();
  });
});
