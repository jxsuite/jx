/**
 * The action flow (desktop.md §10.4): one dialog in the backend's words, whose buttons run
 * `performAction` from inside the click, and whose outcome Studio acts on — a done action re-reads
 * the account and shows what the platform says about it, the refusal's retry hint is followed, and
 * a decline silences the reports that arrive on their own until the page reloads.
 */
import { flush, installMockPlatform, mountOverlayLayers } from "./harness";
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { hydrateAccountStatus, resetAccountStatus } from "../src/account-status";
import {
  actIfRequired,
  canPerformActions,
  leadingActions,
  promptAction,
  resetActionFlow,
  runOfferedAction,
  showToastNotices,
  wireActionReports,
} from "../src/account/action-flow";
import { reportActionRequired, resetActionReports } from "../src/account/action-required";
import { resetNotifications, toasts } from "../src/services/notify";
import { initLayers } from "../src/ui/layers";
import type { AccountNotice, ActionOutcome, OfferedAction, StudioPlatform } from "../src/types";

const JOIN: OfferedAction = {
  href: "https://example.test/join",
  id: "join",
  label: "Join",
  primary: true,
};
const ASK: OfferedAction = { href: "https://example.test/ask", id: "ask", label: "Ask an admin" };

const realReload = location.reload;

beforeAll(() => {
  mountOverlayLayers(document.body);
  initLayers();
});

beforeEach(() => {
  resetActionFlow();
  resetActionReports();
  resetAccountStatus();
  resetNotifications();
});

afterEach(() => {
  (location as { reload: unknown }).reload = realReload;
  for (const dialog of document.querySelectorAll("#layer-dialog > *")) {
    dialog.remove();
  }
});

/** The action dialog, once it is up. */
function actionDialog(): HTMLElement | null {
  return document.querySelector("#layer-dialog jx-dialog");
}

function message(): string {
  return actionDialog()?.querySelector('[part="message"]')?.textContent ?? "";
}

/**
 * Install a platform that performs actions: each one answers the next outcome given (default
 * `done`), and once one is done the account status carries the notice it is given.
 */
async function actingPlatform(
  overrides: Partial<StudioPlatform> = {},
  doneNotice?: AccountNotice,
): Promise<{ platform: StudioPlatform }> {
  let notices: AccountNotice[] = [];
  const installed = installMockPlatform({
    getAccountStatus: async () => ({ installations: [], notices }),
    performAction: mock(async () => {
      if (doneNotice) {
        notices = [doneNotice];
      }
      return { status: "done" } as ActionOutcome;
    }),
    ...overrides,
  });
  await hydrateAccountStatus();
  return { platform: installed.platform };
}

describe("leadingActions", () => {
  test("leads with the primary action, else the first, and keeps one other", () => {
    expect(leadingActions([])).toBeNull();
    expect(leadingActions([ASK])).toEqual({ lead: ASK });
    expect(leadingActions([ASK, JOIN])).toEqual({ lead: JOIN, other: ASK });
    const third = { id: "x", label: "X" };
    expect(leadingActions([ASK, third])).toEqual({ lead: ASK, other: third });
  });
});

describe("the offer", () => {
  test("a platform that performs nothing is never offered anything", async () => {
    installMockPlatform();
    expect(canPerformActions()).toBe(false);
    expect(await promptAction({ actions: [JOIN] })).toBe(false);
    expect(actionDialog()).toBeNull();
  });

  test("a refusal that offers nothing is no offer", async () => {
    await actingPlatform();
    expect(canPerformActions()).toBe(true);
    expect(await promptAction({ actions: [] })).toBe(false);
    expect(actionDialog()).toBeNull();
  });

  test("speaks the backend's words, and performs the lead action on confirm", async () => {
    const { platform } = await actingPlatform(
      {},
      { display: "toast", id: "joined", message: "Welcome aboard.", title: "Joined" },
    );
    const result = promptAction({
      actions: [ASK, JOIN],
      detail: "Editing acme/site needs a membership.",
      heading: "Join the team",
    });
    await flush();
    expect(actionDialog()?.getAttribute("headline")).toBe("Join the team");
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Join");
    expect(actionDialog()?.getAttribute("secondary-label")).toBe("Ask an admin");
    expect(message()).toBe("Editing acme/site needs a membership.");

    actionDialog()?.dispatchEvent(new Event("confirm"));
    expect(platform.performAction).toHaveBeenCalledWith(JOIN);
    expect(await result).toBe(true);
    // The account was re-read, and the platform's one-time notice announced in its own words.
    expect(toasts.at(-1)?.message).toBe("Welcome aboard.");
    expect(actionDialog()).toBeNull();
  });

  test("the secondary button performs the other action", async () => {
    const { platform } = await actingPlatform();
    const result = promptAction({ actions: [JOIN, ASK] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("secondary"));
    expect(platform.performAction).toHaveBeenCalledWith(ASK);
    expect(await result).toBe(true);
  });

  test("with no heading or detail it still offers, in the plainest words", async () => {
    await actingPlatform();
    const result = promptAction({ actions: [ASK] });
    await flush();
    expect(actionDialog()?.getAttribute("headline")).toBe("One more step");
    expect(actionDialog()?.hasAttribute("secondary-label")).toBe(false);
    expect(message()).toBe("This needs one more step first.");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("callers asking while a dialog is up join it", async () => {
    await actingPlatform();
    const first = promptAction({ actions: [JOIN] });
    const second = promptAction({ actions: [ASK], detail: "ignored" });
    await flush();
    expect(document.querySelectorAll("#layer-dialog jx-dialog")).toHaveLength(1);
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await first).toBe(false);
    expect(await second).toBe(false);
  });
});

describe("the action's endings", () => {
  test("waiting says so, hides the other action, and a second press does nothing", async () => {
    let finish: (outcome: ActionOutcome) => void = () => {};
    const { platform } = await actingPlatform({
      performAction: mock(
        () =>
          new Promise<ActionOutcome>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const result = promptAction({ actions: [JOIN, ASK] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush();
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Waiting…");
    expect(actionDialog()?.hasAttribute("secondary-label")).toBe(false);
    expect(message()).toContain("Finish in the window that opened");
    actionDialog()?.dispatchEvent(new Event("confirm"));
    actionDialog()?.dispatchEvent(new Event("secondary"));
    expect(platform.performAction).toHaveBeenCalledTimes(1);
    finish({ status: "done" });
    expect(await result).toBe(true);
  });

  test("a window closed without saying puts the offer back, and re-reads the account", async () => {
    const outcomes: ActionOutcome[] = [{ status: "unknown" }, { status: "canceled" }];
    const getAccountStatus = mock(async () => ({ installations: [] }));
    await actingPlatform({
      getAccountStatus,
      performAction: async () => outcomes.shift() ?? { status: "canceled" },
    });
    const result = promptAction({ actions: [JOIN, ASK], detail: "Saving needs a membership." });
    await flush();
    const reads = getAccountStatus.mock.calls.length;
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Join");
    expect(actionDialog()?.getAttribute("secondary-label")).toBe("Ask an admin");
    expect(message()).toBe("Saving needs a membership.");
    expect(getAccountStatus.mock.calls.length).toBe(reads + 1);
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Join");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("an action that failed is drawn in the dialog, which stays up", async () => {
    await actingPlatform({
      performAction: async () => {
        throw new Error("Request denied");
      },
    });
    const result = promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(message()).toBe("Request denied");
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Join");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a failure that is not an Error is still a failure the user sees", async () => {
    await actingPlatform({
      // oxlint-disable-next-line prefer-promise-reject-errors -- a platform may reject with anything
      performAction: () => Promise.reject("denied"),
    });
    const result = promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(message()).toBe("denied");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a platform that throws before opening anything is a failure, not a hang", async () => {
    await actingPlatform({
      performAction: (() => {
        // oxlint-disable-next-line no-throw-literal
        throw "no window";
      }) as never,
    });
    const result = promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush();
    expect(message()).toBe("no window");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a thrown Error before opening anything says its message", async () => {
    await actingPlatform({
      performAction: (() => {
        throw new Error("Popups are off");
      }) as never,
    });
    const result = promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush();
    expect(message()).toBe("Popups are off");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
  });

  test("a redirect leaves the dialog alone — the page is on its way out", async () => {
    await actingPlatform({ performAction: async () => ({ status: "redirect" }) });
    void promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Waiting…");
  });

  test("a platform that answers nothing leaves the dialog waiting", async () => {
    await actingPlatform({ performAction: async () => null });
    void promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(4);
    expect(actionDialog()?.getAttribute("confirm-label")).toBe("Waiting…");
  });

  test("an action done after the waiting dialog was dismissed is still read and announced", async () => {
    let finish: (outcome: ActionOutcome) => void = () => {};
    let notices: AccountNotice[] = [];
    installMockPlatform({
      getAccountStatus: async () => ({ installations: [], notices }),
      performAction: () =>
        new Promise<ActionOutcome>((resolve) => {
          finish = resolve;
        }),
    });
    const result = promptAction({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await result).toBe(false);
    notices = [{ display: "toast", id: "late", message: "You joined.", title: "Joined" }];
    finish({ status: "done" });
    await flush(6);
    expect(toasts.at(-1)?.message).toBe("You joined.");
  });

  test("an outcome that lands after the dialog was dismissed draws nothing", async () => {
    let fail: (error: Error) => void = () => {};
    let finish: (outcome: ActionOutcome) => void = () => {};
    const pending: Promise<ActionOutcome>[] = [
      new Promise<ActionOutcome>((resolve) => {
        finish = resolve;
      }),
      new Promise<ActionOutcome>((_resolve, reject) => {
        fail = reject;
      }),
    ];
    await actingPlatform({ performAction: () => pending.shift()! });
    for (const settle of [() => finish({ status: "unknown" }), () => fail(new Error("late"))]) {
      const result = promptAction({ actions: [JOIN] });
      await flush();
      actionDialog()?.dispatchEvent(new Event("confirm"));
      actionDialog()?.dispatchEvent(new Event("cancel"));
      expect(await result).toBe(false);
      settle();
      await flush(4);
      expect(actionDialog()).toBeNull();
      resetActionFlow();
    }
  });
});

describe("refusals nobody caught", () => {
  test("a refusal that says reload is offered once, and reloads once its action is done", async () => {
    await actingPlatform();
    const reload = mock(() => {});
    (location as { reload: unknown }).reload = reload;
    const stop = wireActionReports();
    reportActionRequired({
      actions: [JOIN],
      detail: "Opening needs a membership.",
      retry: "reload",
    });
    // A burst of refusals is one dialog.
    reportActionRequired({ actions: [JOIN] });
    await flush();
    expect(document.querySelectorAll("#layer-dialog jx-dialog")).toHaveLength(1);
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(6);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  test("a refusal that says repeat tells the user to run it again; none says nothing", async () => {
    await actingPlatform();
    const stop = wireActionReports();
    reportActionRequired({ actions: [JOIN], retry: "repeat" });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(6);
    expect(toasts.map((toast) => toast.message)).toContain("Done. Run that again now.");

    const before = toasts.length;
    reportActionRequired({ actions: [JOIN], retry: "none" });
    await flush();
    actionDialog()?.dispatchEvent(new Event("confirm"));
    await flush(6);
    expect(toasts).toHaveLength(before);
    stop();
  });

  test("declining silences the reports that arrive on their own, but not a deliberate ask", async () => {
    await actingPlatform();
    const stop = wireActionReports();
    reportActionRequired({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("cancel"));
    await flush();
    reportActionRequired({ actions: [JOIN] });
    await flush();
    expect(actionDialog()).toBeNull();
    const asked = promptAction({ actions: [JOIN] });
    await flush();
    expect(actionDialog()).not.toBeNull();
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await asked).toBe(false);
    stop();
  });

  test("a dialog closed without a decline does not silence the next report", async () => {
    await actingPlatform();
    const stop = wireActionReports();
    reportActionRequired({ actions: [JOIN] });
    await flush();
    actionDialog()?.dispatchEvent(new Event("close"));
    await flush();
    reportActionRequired({ actions: [JOIN] });
    await flush();
    expect(actionDialog()).not.toBeNull();
    actionDialog()?.dispatchEvent(new Event("cancel"));
    stop();
  });
});

describe("actIfRequired", () => {
  test("any other error is not an offer", async () => {
    await actingPlatform();
    expect(await actIfRequired(new Error("Conflict"))).toBe(false);
    expect(await actIfRequired("nope")).toBe(false);
    expect(await actIfRequired({ code: "action_required", actions: [] })).toBe(false);
    expect(actionDialog()).toBeNull();
  });

  test("a refusal is offered with its own members, and says whether to try again", async () => {
    const { platform } = await actingPlatform();
    const refusal = Object.assign(new Error("Creating needs a membership."), {
      actions: [JOIN],
      code: "action_required",
      heading: "Join first",
      retry: "repeat",
    });
    const retry = actIfRequired(refusal);
    await flush();
    expect(message()).toBe("Creating needs a membership.");
    expect(actionDialog()?.getAttribute("headline")).toBe("Join first");
    actionDialog()?.dispatchEvent(new Event("confirm"));
    expect(await retry).toBe(true);
    expect(platform.performAction).toHaveBeenCalledWith(JOIN);
  });

  test("a refusal thrown as a bare object is still offered, in the plainest words", async () => {
    await actingPlatform();
    const retry = actIfRequired({ actions: [JOIN], code: "action_required" });
    await flush();
    expect(message()).toBe("This needs one more step first.");
    actionDialog()?.dispatchEvent(new Event("cancel"));
    expect(await retry).toBe(false);
  });
});

describe("runOfferedAction", () => {
  test("a platform that performs nothing does nothing", async () => {
    installMockPlatform();
    expect(await runOfferedAction(JOIN)).toBe(false);
  });

  test("a done action re-reads the account and announces what the platform says", async () => {
    const { platform } = await actingPlatform(
      {},
      { display: "toast", id: "ok", level: "warning", message: "Membership pending.", title: "T" },
    );
    expect(await runOfferedAction(ASK)).toBe(true);
    expect(platform.performAction).toHaveBeenCalledWith(ASK);
    expect(toasts.at(-1)?.message).toBe("Membership pending.");
  });

  test("any other ending re-reads the account, except a page on its way out", async () => {
    const outcomes: (ActionOutcome | null)[] = [
      { status: "canceled" },
      null,
      { status: "redirect" },
    ];
    const getAccountStatus = mock(async () => ({ installations: [] }));
    installMockPlatform({ getAccountStatus, performAction: async () => outcomes.shift() ?? null });
    expect(await runOfferedAction(JOIN)).toBe(false);
    expect(await runOfferedAction(JOIN)).toBe(false);
    expect(getAccountStatus).toHaveBeenCalledTimes(2);
    expect(await runOfferedAction(JOIN)).toBe(false);
    expect(getAccountStatus).toHaveBeenCalledTimes(2);
  });

  test("a failed action is reported as an error, in whatever form it came", async () => {
    const failures: unknown[] = [new Error("Denied"), "refused"];
    installMockPlatform({ performAction: () => Promise.reject(failures.shift()) });
    expect(await runOfferedAction(JOIN)).toBe(false);
    expect(toasts.at(-1)?.message).toBe("Denied");
    expect(await runOfferedAction(JOIN)).toBe(false);
    expect(toasts.at(-1)?.message).toBe("refused");
  });
});

describe("showToastNotices", () => {
  test("each one-time notice is shown once, at its level; banners are not toasts", async () => {
    installMockPlatform({
      getAccountStatus: async () => ({
        installations: [],
        notices: [
          { display: "toast", id: "a", message: "Info line.", title: "A" },
          { display: "toast", id: "b", level: "warning", message: "Warning line.", title: "B" },
          { id: "c", message: "Banner line.", title: "C" },
        ],
      }),
    });
    await hydrateAccountStatus();
    showToastNotices();
    expect(toasts.map((toast) => [toast.severity, toast.message])).toEqual([
      ["info", "Info line."],
      ["warn", "Warning line."],
    ]);
    await hydrateAccountStatus();
    showToastNotices();
    expect(toasts).toHaveLength(2);
  });
});
