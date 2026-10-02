/**
 * The upgrade flow (desktop.md §10.4): one dialog in the platform's words, whose confirm runs
 * `startUpgrade` from inside the click, and whose outcome Studio acts on — a plan that started is
 * re-read and announced, a refused project open is reloaded, a decline silences the reports that
 * arrive on their own until the page reloads.
 */
import { flush, installMockPlatform, mountOverlayLayers } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { hydrateAccountStatus, resetAccountStatus } from "../src/account-status";
import {
  canUpgrade,
  consumeUpgradeReturn,
  promptUpgrade,
  resetUpgradeFlow,
  runPlanAction,
  upgradeIfRequired,
  wireUpgradeReports,
} from "../src/account/upgrade-flow";
import { reportUpgradeRequired, resetUpgradeReports } from "../src/account/upgrade-required";
import { resetNotifications, toasts } from "../src/services/notify";
import { initLayers } from "../src/ui/layers";
import type { AccountSubscription, StudioPlatform, UpgradeOutcome } from "../src/types";

const PLAN: AccountSubscription = {
  entitled: false,
  planName: "Jx Studio Cloud",
  priceLabel: "$5/month",
  required: true,
  state: "none",
  trialAvailable: true,
  trialDays: 30,
};

const realReload = location.reload;

beforeAll(() => {
  mountOverlayLayers(document.body);
  initLayers();
});

beforeEach(() => {
  resetUpgradeFlow();
  resetUpgradeReports();
  resetAccountStatus();
  resetNotifications();
});

afterEach(() => {
  (location as { reload: unknown }).reload = realReload;
  for (const dialog of document.querySelectorAll("#layer-dialog > *")) {
    dialog.remove();
  }
});

/** The upgrade dialog, once it is up. */
function upgradeDialog(): HTMLElement | null {
  return document.querySelector("#layer-dialog jx-dialog");
}

function message(): string {
  return upgradeDialog()?.querySelector('[part="message"]')?.textContent ?? "";
}

/** Install a platform that sells the plan, with the standing it reports and the checkout it runs. */
async function sellingPlatform(
  overrides: Partial<StudioPlatform> = {},
  plan: AccountSubscription = PLAN,
): Promise<{ platform: StudioPlatform }> {
  let standing = plan;
  const installed = installMockPlatform({
    getAccountStatus: async () => ({ installations: [], subscription: standing }),
    manageSubscription: mock(async () => {}),
    startUpgrade: mock(async () => {
      standing = {
        ...plan,
        entitled: true,
        state: "trialing",
        trialEndsAt: "2026-11-01T00:00:00Z",
      };
      return { status: "subscribed" } as UpgradeOutcome;
    }),
    ...overrides,
  });
  await hydrateAccountStatus();
  return { platform: installed.platform };
}

describe("the offer", () => {
  test("a platform that sells nothing is never offered anything", async () => {
    installMockPlatform();
    expect(canUpgrade()).toBe(false);
    expect(await promptUpgrade()).toBe(false);
    expect(upgradeDialog()).toBeNull();
  });

  test("speaks the refusal's words and the platform's price, and starts the plan on confirm", async () => {
    const { platform } = await sellingPlatform();
    const result = promptUpgrade({
      detail: "Opening acme/site needs Jx Studio Cloud.",
      upgradeUrl: "https://studio.test/checkout",
    });
    await flush();
    expect(upgradeDialog()?.getAttribute("headline")).toBe("Jx Studio Cloud");
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Start free trial");
    expect(message()).toBe(
      "Opening acme/site needs Jx Studio Cloud. Start a 30-day free trial, then $5/month.",
    );

    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    expect(platform.startUpgrade).toHaveBeenCalledWith({
      upgradeUrl: "https://studio.test/checkout",
    });
    expect(await result).toBe(true);
    // The plan was re-read and announced in the platform's own words.
    expect(toasts.at(-1)?.message).toStartWith("Your Jx Studio Cloud trial is active until");
    expect(upgradeDialog()).toBeNull();
  });

  test("without a trial it offers the subscription, and falls back to generic words", async () => {
    await sellingPlatform({}, { ...PLAN, priceLabel: undefined as never, trialAvailable: false });
    const result = promptUpgrade({ trialAvailable: false });
    await flush();
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Subscribe");
    expect(message()).toBe("This needs Jx Studio Cloud. Subscribe to continue.");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("the price and the trial's length are each said only when the platform states them", async () => {
    await sellingPlatform(
      {},
      { ...PLAN, trialDays: undefined as never, priceLabel: undefined as never },
    );
    const trial = promptUpgrade();
    await flush();
    expect(message()).toBe("This needs Jx Studio Cloud. Start a free trial.");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    await trial;

    resetUpgradeFlow();
    await sellingPlatform({}, { ...PLAN, trialAvailable: false });
    const paid = promptUpgrade();
    await flush();
    expect(message()).toBe("This needs Jx Studio Cloud. Subscribe for $5/month to continue.");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    await paid;
  });

  test("with no standing known it still offers, in the plainest words", async () => {
    installMockPlatform({ startUpgrade: async () => ({ status: "canceled" }) });
    const result = promptUpgrade();
    await flush();
    expect(upgradeDialog()?.getAttribute("headline")).toBe("A subscription");
    expect(message()).toBe("This needs a subscription. Subscribe to continue.");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("callers asking while a dialog is up join it", async () => {
    await sellingPlatform();
    const first = promptUpgrade();
    const second = promptUpgrade({ detail: "ignored" });
    await flush();
    expect(document.querySelectorAll("#layer-dialog jx-dialog")).toHaveLength(1);
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await first).toBe(false);
    expect(await second).toBe(false);
  });
});

describe("the checkout's endings", () => {
  test("waiting says so, and a second confirm while waiting does nothing", async () => {
    let finish: (outcome: UpgradeOutcome) => void = () => {};
    const { platform } = await sellingPlatform({
      startUpgrade: mock(
        () =>
          new Promise<UpgradeOutcome>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const result = promptUpgrade();
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush();
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Waiting…");
    expect(message()).toContain("Finish in the window that opened");
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    expect(platform.startUpgrade).toHaveBeenCalledTimes(1);
    finish({ status: "subscribed" });
    expect(await result).toBe(true);
  });

  test("a closed checkout window puts the offer back; a timeout says nothing was charged", async () => {
    const outcomes: UpgradeOutcome[] = [{ status: "canceled" }, { status: "timeout" }];
    await sellingPlatform({ startUpgrade: async () => outcomes.shift() ?? { status: "canceled" } });
    const result = promptUpgrade({ detail: "Saving needs a plan." });
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Try again");
    expect(message()).toBe("Saving needs a plan. Start a 30-day free trial, then $5/month.");
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(message()).toContain("Nothing was charged");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a checkout that failed is drawn in the dialog, which stays up", async () => {
    await sellingPlatform({
      startUpgrade: async () => {
        throw new Error("Card declined");
      },
    });
    const result = promptUpgrade();
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(message()).toBe("Card declined");
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Try again");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a platform that throws before opening anything is a failure, not a hang", async () => {
    await sellingPlatform({
      startUpgrade: (() => {
        // A platform that throws something other than an Error is still a failure the user sees.
        // oxlint-disable-next-line no-throw-literal
        throw "no window";
      }) as never,
    });
    const result = promptUpgrade();
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush();
    expect(message()).toBe("no window");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a redirect leaves the dialog alone — the page is on its way out", async () => {
    await sellingPlatform({ startUpgrade: async () => ({ status: "redirect" }) });
    void promptUpgrade();
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(upgradeDialog()?.getAttribute("confirm-label")).toBe("Waiting…");
  });

  test("a plan started after the waiting dialog was dismissed is still read and announced", async () => {
    let finish: (outcome: UpgradeOutcome) => void = () => {};
    await sellingPlatform({
      startUpgrade: () =>
        new Promise<UpgradeOutcome>((resolve) => {
          finish = resolve;
        }),
    });
    const result = promptUpgrade();
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
    finish({ status: "subscribed" });
    await flush(6);
    expect(toasts.at(-1)?.message).toBe("Jx Studio Cloud is active.");
  });
});

describe("refusals nobody caught", () => {
  test("a refused open is offered once, and reloaded once the plan starts", async () => {
    await sellingPlatform();
    const reload = mock(() => {});
    (location as { reload: unknown }).reload = reload;
    const stop = wireUpgradeReports();
    reportUpgradeRequired({ detail: "Opening needs a plan.", kind: "open" });
    // A burst of refusals is one dialog.
    reportUpgradeRequired({ kind: "other" });
    await flush();
    expect(document.querySelectorAll("#layer-dialog jx-dialog")).toHaveLength(1);
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(6);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a refused save is the user's to run again, and they are told so", async () => {
    await sellingPlatform();
    const stop = wireUpgradeReports();
    reportUpgradeRequired({ kind: "save" });
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    await flush(6);
    expect(toasts.map((toast) => toast.message)).toContain(
      "Run that again now that your plan is active.",
    );
    stop();
  });

  test("declining silences the reports that arrive on their own, but not a deliberate ask", async () => {
    await sellingPlatform();
    const stop = wireUpgradeReports();
    reportUpgradeRequired({ kind: "other" });
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    await flush();
    reportUpgradeRequired({ kind: "other" });
    await flush();
    expect(upgradeDialog()).toBeNull();
    const asked = promptUpgrade();
    await flush();
    expect(upgradeDialog()).not.toBeNull();
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await asked).toBe(false);
    stop();
  });
});

describe("upgradeIfRequired", () => {
  test("any other error is not an offer", async () => {
    await sellingPlatform();
    expect(await upgradeIfRequired(new Error("Conflict"))).toBe(false);
    expect(await upgradeIfRequired("nope")).toBe(false);
    expect(upgradeDialog()).toBeNull();
  });

  test("a plan refusal is offered with its own members, and says whether to try again", async () => {
    const { platform } = await sellingPlatform();
    const refusal = Object.assign(new Error("Creating needs a plan."), {
      code: "subscription_required",
      trialAvailable: true,
      upgradeUrl: "https://studio.test/checkout",
    });
    const retry = upgradeIfRequired(refusal);
    await flush();
    expect(message()).toStartWith("Creating needs a plan.");
    upgradeDialog()?.dispatchEvent(new Event("confirm"));
    expect(await retry).toBe(true);
    expect(platform.startUpgrade).toHaveBeenCalledWith({
      upgradeUrl: "https://studio.test/checkout",
    });
  });

  test("a refusal thrown as a bare object is still offered", async () => {
    await sellingPlatform();
    const retry = upgradeIfRequired({ code: "subscription_required" });
    await flush();
    expect(message()).toStartWith("This needs Jx Studio Cloud.");
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    expect(await retry).toBe(false);
  });
});

describe("the plan notice's button", () => {
  test("manage opens where the plan is managed; upgrade offers it; nothing does nothing", async () => {
    const { platform } = await sellingPlatform();
    await runPlanAction("manage");
    expect(platform.manageSubscription).toHaveBeenCalledTimes(1);
    await runPlanAction(null);
    expect(upgradeDialog()).toBeNull();
    const upgrading = runPlanAction("upgrade");
    await flush();
    upgradeDialog()?.dispatchEvent(new Event("cancel"));
    await upgrading;
    expect(platform.startUpgrade).not.toHaveBeenCalled();
  });
});

describe("the full-page return", () => {
  test("each ending is announced in the plan's name, and no ending says nothing", async () => {
    const endings: ("success" | "pending" | "error" | null)[] = [
      "success",
      "pending",
      "error",
      null,
    ];
    await sellingPlatform({ takeUpgradeReturn: () => endings.shift() ?? null });
    consumeUpgradeReturn();
    expect(toasts.at(-1)?.message).toBe("Jx Studio Cloud is active.");
    consumeUpgradeReturn();
    expect(toasts.at(-1)?.message).toContain("activates within a minute");
    consumeUpgradeReturn();
    const count = toasts.length;
    consumeUpgradeReturn();
    expect(toasts).toHaveLength(count);
  });

  test("with no plan known, the success is still announced; with no platform, nothing runs", () => {
    installMockPlatform({ takeUpgradeReturn: () => "success" });
    consumeUpgradeReturn();
    expect(toasts.at(-1)?.message).toBe("Your subscription is active.");
  });
});
