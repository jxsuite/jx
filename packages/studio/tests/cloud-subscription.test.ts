/**
 * The cloud adapter's half of a hosted plan (desktop.md §10.4): reading a `subscription-required`
 * refusal without losing its members, raising it on the upgrade channel with what the request was
 * doing, naming the bound project to the routes outside the session base, mapping `/me`'s plan
 * block onto the neutral `AccountSubscription`, and running the checkout window.
 */
import "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCloudPlatform } from "../src/platforms/cloud";
import { onUpgradeRequired, resetUpgradeReports } from "../src/account/upgrade-required";
import { platformErrorInfo } from "../src/platform-errors";
import type { UpgradeRequiredReport } from "../src/account/upgrade-required";

const { happyDOM } = globalThis as unknown as { happyDOM: { setURL: (u: string) => void } };

const PROJECT = { owner: "acme", repo: "site", branch: "main" };
const BASE = "/api/v1/p/acme/site/main/studio";
const UPGRADE_URL = "https://studio.example.test/api/v1/billing/checkout?returnTo=%2Fedit";

const realFetch = globalThis.fetch;
const realOpen = window.open;
const realAssign = location.assign;
const realWindowSetTimeout = window.setTimeout;
const realSetTimeout = globalThis.setTimeout;

const REFUSAL = {
  detail: "Opening acme/site in the cloud editor needs Jx Studio Cloud.",
  status: 402,
  trialAvailable: true,
  type: "https://jxsuite.com/problems/subscription-required",
  upgradeUrl: UPGRADE_URL,
};

interface Route {
  status?: number;
  body: unknown;
}

/** Route fetches by URL substring (first match wins); unmatched calls get an empty 200. */
function mockFetch(
  routes: [string, Route | (() => Route)][],
): { url: string; init?: RequestInit }[] {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) });
    for (const [needle, route] of routes) {
      if (url.includes(needle)) {
        const answer = typeof route === "function" ? route() : route;
        const body =
          typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body ?? null);
        return Promise.resolve(new Response(body, { status: answer.status ?? 200 }));
      }
    }
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return calls;
}

/** Wait for something the adapter does asynchronously, on the real clock. */
async function until(done: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (done()) {
      return;
    }
    await new Promise((resolve) => {
      realSetTimeout(resolve, 0);
    });
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Make the poll's two-second wait a zero-length one, so a test runs every turn of it. */
function fastTimers(): void {
  (window as { setTimeout: unknown }).setTimeout = ((fn: () => void) =>
    realSetTimeout(fn, 0)) as unknown as typeof window.setTimeout;
}

let reports: UpgradeRequiredReport[] = [];

beforeEach(() => {
  reports = [];
  onUpgradeRequired((report) => reports.push(report));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (window as { open: unknown }).open = realOpen;
  (location as { assign: unknown }).assign = realAssign;
  (window as { setTimeout: unknown }).setTimeout = realWindowSetTimeout;
  resetUpgradeReports();
});

describe("a plan refusal on the session", () => {
  test("a refused activate throws the refusal with every member, and reports an open", async () => {
    mockFetch([["/activate", { body: REFUSAL, status: 402 }]]);
    const p = createCloudPlatform(PROJECT);
    const refused = await p.activate().then(
      () => null,
      (error: unknown) => error,
    );
    expect((refused as Error).message).toBe(REFUSAL.detail);
    expect(platformErrorInfo(refused)).toEqual({
      code: "subscription-required",
      trialAvailable: true,
      upgradeUrl: UPGRADE_URL,
    });
    expect((refused as { status?: number }).status).toBe(402);
    expect(reports).toEqual([
      { detail: REFUSAL.detail, kind: "open", trialAvailable: true, upgradeUrl: UPGRADE_URL },
    ]);
  });

  test("a refused activate with no body still throws, with the fallback sentence", async () => {
    mockFetch([["/activate", { body: "<html>", status: 500 }]]);
    const p = createCloudPlatform(PROJECT);
    expect(p.activate()).rejects.toThrow("Failed to open the project session");
  });

  test("a refused commit reports a save; any other route reports other", async () => {
    mockFetch([
      ["/git/commit", { body: REFUSAL, status: 402 }],
      ["/files?dir=", { body: { detail: "Listing needs a plan" }, status: 402 }],
      ["/project-info", { body: REFUSAL, status: 402 }],
    ]);
    const p = createCloudPlatform(PROJECT);
    expect(p.gitCommit("msg")).rejects.toThrow(REFUSAL.detail);
    await until(() => reports.length === 1, "the commit report");
    expect(reports[0]?.kind).toBe("save");

    expect(p.listDirectory("pages")).rejects.toThrow("Listing needs a plan");
    await until(() => reports.length === 2, "the listing report");
    expect(reports[1]).toEqual({ detail: "Listing needs a plan", kind: "other" });

    expect(p.openProject()).rejects.toThrow(REFUSAL.detail);
    await until(() => reports.length === 3, "the project-info report");
    expect(reports[2]?.kind).toBe("open");
  });

  test("a 402 whose body is not JSON still reports — the status is the report", async () => {
    mockFetch([["/git/push", { body: "Payment required", status: 402 }]]);
    const p = createCloudPlatform(PROJECT);
    expect(p.gitPush()).rejects.toThrow("Push failed");
    await until(() => reports.length === 1, "the push report");
    expect(reports[0]).toEqual({ kind: "save" });
  });

  test("other failures report nothing", async () => {
    mockFetch([["/git/commit", { body: { error: "Conflict" }, status: 409 }]]);
    const p = createCloudPlatform(PROJECT);
    expect(p.gitCommit("msg")).rejects.toThrow("Conflict");
    await new Promise((resolve) => {
      realSetTimeout(resolve, 0);
    });
    expect(reports).toEqual([]);
  });
});

describe("plan refusals outside the session", () => {
  test("createProject and importProject keep the refusal's members", async () => {
    mockFetch([
      ["/api/v1/projects/import", { body: REFUSAL, status: 402 }],
      ["/api/v1/projects", { body: REFUSAL, status: 402 }],
    ]);
    const p = createCloudPlatform(null);
    const created = await p
      .createProject({
        destination: { kind: "repo", owner: "acme", private: true, repo: "new-site" },
        directory: "new-site",
        name: "New site",
      })
      .catch((error: unknown) => error);
    expect(platformErrorInfo(created).upgradeUrl).toBe(UPGRADE_URL);
    const imported = await p
      .importProject?.({ name: "site", owner: "acme" })
      .catch((error: unknown) => error);
    expect(platformErrorInfo(imported)).toMatchObject({
      code: "subscription-required",
      upgradeUrl: UPGRADE_URL,
    });
  });

  test("cfApi names the bound project in a header and throws a refusal as itself", async () => {
    const calls = mockFetch([["/api/v1/cf/proxy", { body: REFUSAL, status: 402 }]]);
    const p = createCloudPlatform(PROJECT);
    const refused = await p.cfApi?.("/accounts").catch((error: unknown) => error);
    expect((refused as Error).message).toBe(REFUSAL.detail);
    expect(platformErrorInfo(refused).code).toBe("subscription-required");
    expect(calls[0]?.init?.headers).toEqual({ "X-Jx-Project": "acme/site" });
  });

  test("cfApi in the hub sends no project header, and a body keeps its content type", async () => {
    const calls = mockFetch([["/api/v1/cf/proxy", { body: { result: { ok: 1 }, success: true } }]]);
    const p = createCloudPlatform(null);
    expect(await p.cfApi?.("/accounts")).toEqual({ ok: 1 });
    expect(calls[0]?.init?.headers).toBeUndefined();
    await p.cfApi?.("/accounts/a/pages/projects", { body: { name: "x" }, method: "POST" });
    expect(calls[1]?.init?.headers).toEqual({ "Content-Type": "application/json" });
  });

  test("cfConnect names the bound project to the broker", async () => {
    mockFetch([]);
    const assigned: string[] = [];
    (location as { assign: unknown }).assign = (url: string) => {
      assigned.push(url);
    };
    (window as { open: unknown }).open = mock(() => null);
    const p = createCloudPlatform(PROJECT);
    expect(await p.cfConnect?.()).toEqual({ status: "redirect" });
    expect(assigned).toEqual(["/api/v1/cf/connect?project=acme%2Fsite"]);
  });
});

describe("the plan in /me", () => {
  const ME = {
    appInstallUrl: "https://github.com/apps/jx/installations/new",
    billing: {
      enforced: true,
      manageUrl: "https://studio.example.test/api/v1/billing/portal",
      notice: "",
      plan: { name: "Jx Studio Cloud", priceLabel: "$5/month", trialDays: 30 },
      upgradeUrl: UPGRADE_URL,
    },
    installations: [],
    subscription: {
      entitled: true,
      hasPaymentMethod: false,
      renewsAt: null,
      state: "trialing",
      trialAvailable: false,
      trialEndsAt: "2026-11-01T00:00:00Z",
    },
  };

  test("maps the platform's plan block onto the neutral subscription", async () => {
    mockFetch([["/api/v1/me", { body: ME }]]);
    const status = await createCloudPlatform(null).getAccountStatus?.();
    expect(status?.subscription).toEqual({
      entitled: true,
      hasPaymentMethod: false,
      manageUrl: "https://studio.example.test/api/v1/billing/portal",
      planName: "Jx Studio Cloud",
      priceLabel: "$5/month",
      required: true,
      state: "trialing",
      trialAvailable: false,
      trialDays: 30,
      trialEndsAt: "2026-11-01T00:00:00Z",
      upgradeUrl: UPGRADE_URL,
    });
  });

  test("a platform that sells nothing, or cannot say where the user stands, has no plan", async () => {
    const answers = [
      { installations: [] },
      { ...ME, subscription: null },
      { ...ME, billing: { ...ME.billing, plan: { name: "" } } },
    ];
    for (const body of answers) {
      mockFetch([["/api/v1/me", { body }]]);
      const status = await createCloudPlatform(null).getAccountStatus?.();
      expect(status).not.toHaveProperty("subscription");
    }
  });

  test("a state it does not know reads as none, and loose members are not trusted", async () => {
    mockFetch([
      [
        "/api/v1/me",
        {
          body: {
            billing: { enforced: "yes", plan: { name: "Plan", trialDays: "30" } },
            subscription: { entitled: 1, state: "paused", trialAvailable: "true" },
          },
        },
      ],
    ]);
    const status = await createCloudPlatform(null).getAccountStatus?.();
    expect(status?.subscription).toEqual({
      entitled: false,
      planName: "Plan",
      required: false,
      state: "none",
      trialAvailable: false,
    });
  });
});

describe("startUpgrade", () => {
  test("opens the checkout synchronously, at the refusal's link when it carried one", () => {
    mockFetch([]);
    const open = mock((_url: string, _target?: string) => null);
    (window as { open: unknown }).open = open;
    (location as { assign: unknown }).assign = () => {};
    const p = createCloudPlatform(PROJECT);
    void p.startUpgrade?.({ upgradeUrl: UPGRADE_URL });
    // Called before any await: the click that asked is still on the stack.
    expect(open.mock.calls[0]?.[0]).toBe(UPGRADE_URL);
    void p.startUpgrade?.();
    expect(open.mock.calls[1]?.[0]).toStartWith("/api/v1/billing/checkout?returnTo=");
  });

  test("a blocked popup navigates the page instead", async () => {
    mockFetch([]);
    const assigned: string[] = [];
    (location as { assign: unknown }).assign = (url: string) => {
      assigned.push(url);
    };
    (window as { open: unknown }).open = mock(() => null);
    const p = createCloudPlatform(null);
    expect(await p.startUpgrade?.({ upgradeUrl: UPGRADE_URL })).toEqual({ status: "redirect" });
    expect(assigned).toEqual([UPGRADE_URL]);
  });

  test("the window's success relay settles once the platform reports the plan", async () => {
    let entitled = false;
    mockFetch([
      [
        "/api/v1/me",
        () => ({
          body: {
            billing: { enforced: true, plan: { name: "Plan" } },
            subscription: { entitled, state: entitled ? "trialing" : "none" },
          },
        }),
      ],
    ]);
    const popup = { close: mock(() => {}), closed: false, focus: mock(() => {}) };
    (window as { open: unknown }).open = mock(() => popup);
    const p = createCloudPlatform(null);
    const pending = p.startUpgrade?.();
    // A second caller joins the running flow and raises its window rather than opening another.
    const joined = p.startUpgrade?.();
    expect(popup.focus).toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent("message", { data: { source: "other" }, origin: location.origin }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "jx-billing", status: "success" },
        origin: "https://elsewhere.test",
      }),
    );
    entitled = true;
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "jx-billing", status: "success" },
        origin: location.origin,
      }),
    );
    expect(await pending).toEqual({ status: "subscribed" });
    expect(await joined).toEqual({ status: "subscribed" });
    expect(popup.close).toHaveBeenCalled();
  });

  test("a relayed cancellation settles canceled, and a relayed error rejects", async () => {
    mockFetch([]);
    const popup = { close: mock(() => {}), closed: false };
    (window as { open: unknown }).open = mock(() => popup);
    const p = createCloudPlatform(null);
    const canceled = p.startUpgrade?.();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "jx-billing", status: "canceled" },
        origin: location.origin,
      }),
    );
    expect(await canceled).toEqual({ status: "canceled" });

    const failed = p.startUpgrade?.();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "jx-billing", status: "error", reason: "Card declined" },
        origin: location.origin,
      }),
    );
    expect(failed).rejects.toThrow("Card declined");
    const generic = p.startUpgrade?.();
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "jx-billing", status: "error" },
        origin: location.origin,
      }),
    );
    expect(generic).rejects.toThrow("The checkout could not be completed");
  });

  test("the poll settles subscribed on its own, with no relay at all", async () => {
    let asks = 0;
    mockFetch([
      [
        "/api/v1/me",
        () => {
          asks += 1;
          return asks < 2
            ? { body: {}, status: 500 }
            : {
                body: {
                  billing: { plan: { name: "Plan" } },
                  subscription: { entitled: true, state: "active" },
                },
              };
        },
      ],
    ]);
    fastTimers();
    (window as { open: unknown }).open = mock(() => ({ close: () => {}, closed: false }));
    expect(await createCloudPlatform(null).startUpgrade?.()).toEqual({ status: "subscribed" });
  });

  test("a closed window is a cancellation unless the plan landed anyway", async () => {
    let entitledOnFinalRead = false;
    let asks = 0;
    mockFetch([
      [
        "/api/v1/me",
        () => {
          asks += 1;
          const entitled = asks > 1 && entitledOnFinalRead;
          return {
            body: {
              billing: { plan: { name: "Plan" } },
              subscription: { entitled, state: "none" },
            },
          };
        },
      ],
    ]);
    fastTimers();
    (window as { open: unknown }).open = mock(() => ({ close: () => {}, closed: true }));
    const p = createCloudPlatform(null);
    expect(await p.startUpgrade?.()).toEqual({ status: "canceled" });
    asks = 0;
    entitledOnFinalRead = true;
    expect(await p.startUpgrade?.()).toEqual({ status: "subscribed" });
  });

  test("the deadline settles timeout", async () => {
    mockFetch([]);
    fastTimers();
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => clock;
    try {
      (window as { open: unknown }).open = mock(() => ({ close: () => {}, closed: false }));
      const pending = createCloudPlatform(null).startUpgrade?.();
      clock += 16 * 60_000;
      expect(await pending).toEqual({ status: "timeout" });
    } finally {
      Date.now = realNow;
    }
  });
});

describe("manageSubscription and the full-page return", () => {
  test("opens the management page in a tab of its own, or navigates when blocked", async () => {
    const open = mock((_url: string, _target?: string) => ({}));
    (window as { open: unknown }).open = open;
    const p = createCloudPlatform(PROJECT);
    await p.manageSubscription?.();
    expect(open.mock.calls[0]?.[0]).toStartWith("/api/v1/billing/portal?returnTo=");
    expect(open.mock.calls[0]?.[1]).toBe("jx-billing-manage");

    const assigned: string[] = [];
    (location as { assign: unknown }).assign = (url: string) => {
      assigned.push(url);
    };
    (window as { open: unknown }).open = mock(() => null);
    await p.manageSubscription?.();
    expect(assigned[0]).toStartWith("/api/v1/billing/portal?returnTo=");
  });

  test("takeUpgradeReturn reads ?billing= once, strips it, and ignores anything else", () => {
    const p = createCloudPlatform(PROJECT);
    const realReplace = history.replaceState.bind(history);
    const replaced: string[] = [];
    history.replaceState = ((_state: unknown, _title: string, url?: string | URL | null) => {
      replaced.push(String(url));
    }) as typeof history.replaceState;
    try {
      for (const status of ["success", "canceled", "pending", "error"] as const) {
        happyDOM.setURL(`http://localhost:3000/edit/acme/site@main?tab=1&billing=${status}#x`);
        expect(p.takeUpgradeReturn?.()).toBe(status);
      }
      // Stripped, and nothing else about the address moved.
      expect(replaced).toEqual(Array.from({ length: 4 }, () => "/edit/acme/site@main?tab=1#x"));
      happyDOM.setURL("http://localhost:3000/edit/acme/site@main?billing=maybe");
      expect(p.takeUpgradeReturn?.()).toBeNull();
      happyDOM.setURL("http://localhost:3000/edit/acme/site@main");
      expect(p.takeUpgradeReturn?.()).toBeNull();
      expect(replaced).toHaveLength(4);
    } finally {
      history.replaceState = realReplace;
      happyDOM.setURL("http://localhost:3000/");
    }
  });
});

describe("the AI route", () => {
  test("names the bound project, and the hub names none", () => {
    expect(createCloudPlatform(PROJECT).aiChatUrl()).toBe("/api/v1/ai/chat?project=acme%2Fsite");
    expect(createCloudPlatform(null).aiChatUrl()).toBe("/api/v1/ai/chat");
  });
});

describe("session base", () => {
  test("a refused request still goes to the session base", async () => {
    const calls = mockFetch([["/activate", { body: REFUSAL, status: 402 }]]);
    await createCloudPlatform(PROJECT)
      .activate()
      .catch(() => {});
    expect(calls[0]?.url).toBe(`${BASE}/activate`);
  });
});
