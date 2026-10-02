/**
 * The cloud adapter's half of backend-directed access (desktop.md §10.4): reading an
 * `action-required` refusal without losing its members, raising it on the channel, naming the bound
 * project to the routes outside the session base, mapping `/me`'s rows and notices, and running an
 * offered action's window.
 */
import "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createCloudPlatform } from "../src/platforms/cloud";
import { onActionRequired, resetActionReports } from "../src/account/action-required";
import { platformErrorInfo } from "../src/platform-errors";
import type { ActionRequiredReport } from "../src/account/action-required";

const PROJECT = { owner: "acme", repo: "site", branch: "main" };
const BASE = "/api/v1/p/acme/site/main/studio";
const JOIN = {
  href: "https://studio.example.test/join?returnTo=%2Fedit",
  id: "join",
  label: "Join",
};

const realFetch = globalThis.fetch;
const realOpen = window.open;
const realAssign = location.assign;
const realWindowSetTimeout = window.setTimeout;
const realWindowClearTimeout = window.clearTimeout;
const realSetTimeout = globalThis.setTimeout;

const REFUSAL = {
  actions: [JOIN, { id: "", label: "No id" }, "junk"],
  detail: "Editing acme/site needs a team membership.",
  heading: "Join the team",
  retry: "reload",
  status: 403,
  type: "https://jxsuite.com/problems/action-required",
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

/** Let the adapter's pending promise callbacks run. */
async function settle(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => {
      realSetTimeout(resolve, 0);
    });
  }
}

/** A clock the test steps by hand: each `step()` runs the oldest timer still armed. */
function manualTimers(): { step: () => void; armed: () => number } {
  const pending = new Map<number, () => void>();
  let next = 1;
  (window as { setTimeout: unknown }).setTimeout = (fn: () => void) => {
    const id = next;
    next += 1;
    pending.set(id, fn);
    return id;
  };
  (window as { clearTimeout: unknown }).clearTimeout = (id: number) => {
    pending.delete(id);
  };
  return {
    armed: () => pending.size,
    step: () => {
      const first = pending.entries().next();
      if (first.done) {
        throw new Error("no timer is armed");
      }
      const [id, fn] = first.value;
      pending.delete(id);
      fn();
    },
  };
}

/** A relay from the action's window, as the platform's landing page posts it. */
function relay(data: unknown, origin = location.origin): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin }));
}

let reports: ActionRequiredReport[] = [];

beforeEach(() => {
  reports = [];
  onActionRequired((report) => reports.push(report));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  (window as { open: unknown }).open = realOpen;
  (location as { assign: unknown }).assign = realAssign;
  (window as { setTimeout: unknown }).setTimeout = realWindowSetTimeout;
  (window as { clearTimeout: unknown }).clearTimeout = realWindowClearTimeout;
  resetActionReports();
});

describe("an action-required refusal on the session", () => {
  test("a refused activate throws the refusal with every member, and reports it", async () => {
    mockFetch([["/activate", { body: REFUSAL, status: 403 }]]);
    const p = createCloudPlatform(PROJECT);
    const refused = await p.activate().then(
      () => null,
      (error: unknown) => error,
    );
    expect((refused as Error).message).toBe(REFUSAL.detail);
    expect(platformErrorInfo(refused)).toEqual({
      actions: [JOIN],
      code: "action-required",
      heading: "Join the team",
      retry: "reload",
    });
    expect((refused as { status?: number }).status).toBe(403);
    expect(reports).toEqual([
      { actions: [JOIN], detail: REFUSAL.detail, heading: "Join the team", retry: "reload" },
    ]);
  });

  test("a refused activate with no body still throws, with the fallback sentence", async () => {
    mockFetch([["/activate", { body: "<html>", status: 500 }]]);
    const p = createCloudPlatform(PROJECT);
    expect(p.activate()).rejects.toThrow("Failed to open the project session");
  });

  test("the legacy code is a refusal too, and its loose members are not trusted", async () => {
    mockFetch([
      [
        "/git/commit",
        {
          body: { actions: [JOIN], code: "action_required", heading: "", retry: "later" },
          status: 403,
        },
      ],
    ]);
    const p = createCloudPlatform(PROJECT);
    const refused = await p.gitCommit("msg").catch((error: unknown) => error);
    expect(platformErrorInfo(refused)).toEqual({ actions: [JOIN], code: "action-required" });
    await settle();
    expect(reports).toEqual([{ actions: [JOIN] }]);
  });

  test("a refusal that offers nothing, any other 403, and a 403 that is not JSON report nothing", async () => {
    mockFetch([
      ["/git/commit", { body: { ...REFUSAL, actions: [] }, status: 403 }],
      ["/git/push", { body: "Forbidden", status: 403 }],
      ["/files?dir=", { body: { code: "read_only", error: "Read only" }, status: 403 }],
      ["/project-info", { body: null, status: 403 }],
    ]);
    const p = createCloudPlatform(PROJECT);
    expect(p.gitCommit("msg")).rejects.toThrow(REFUSAL.detail);
    expect(p.gitPush()).rejects.toThrow("Push failed");
    expect(p.listDirectory("pages")).rejects.toThrow("Read only");
    expect(p.openProject()).rejects.toThrow();
    await settle();
    expect(reports).toEqual([]);
  });

  test("other failures report nothing", async () => {
    mockFetch([["/git/commit", { body: { error: "Conflict" }, status: 409 }]]);
    const p = createCloudPlatform(PROJECT);
    expect(p.gitCommit("msg")).rejects.toThrow("Conflict");
    await settle();
    expect(reports).toEqual([]);
  });

  test("a refused request still goes to the session base", async () => {
    const calls = mockFetch([["/activate", { body: REFUSAL, status: 403 }]]);
    await createCloudPlatform(PROJECT)
      .activate()
      .catch(() => {});
    expect(calls[0]?.url).toBe(`${BASE}/activate`);
  });
});

describe("refusals outside the session", () => {
  test("createProject and importProject keep the refusal's members", async () => {
    mockFetch([
      ["/api/v1/projects/import", { body: REFUSAL, status: 403 }],
      ["/api/v1/projects", { body: REFUSAL, status: 403 }],
    ]);
    const p = createCloudPlatform(null);
    const created = await p
      .createProject({
        destination: { kind: "repo", owner: "acme", private: true, repo: "new-site" },
        directory: "new-site",
        name: "New site",
      })
      .catch((error: unknown) => error);
    expect(platformErrorInfo(created).actions).toEqual([JOIN]);
    const imported = await p
      .importProject?.({ name: "site", owner: "acme" })
      .catch((error: unknown) => error);
    expect(platformErrorInfo(imported)).toMatchObject({ actions: [JOIN], code: "action-required" });
  });

  test("cfApi names the bound project in a header and throws a refusal as itself", async () => {
    const calls = mockFetch([["/api/v1/cf/proxy", { body: REFUSAL, status: 403 }]]);
    const p = createCloudPlatform(PROJECT);
    const refused = await p.cfApi?.("/accounts").catch((error: unknown) => error);
    expect((refused as Error).message).toBe(REFUSAL.detail);
    expect(platformErrorInfo(refused).code).toBe("action-required");
    expect(calls[0]?.init?.headers).toEqual({ "X-Jx-Project": "acme/site" });
  });

  test("a Cloudflare 403 is still Cloudflare's, and a body that is not JSON still fails", async () => {
    mockFetch([
      [
        "/api/v1/cf/proxy/accounts",
        { body: { errors: [{ message: "Authentication error" }], success: false }, status: 403 },
      ],
      ["/api/v1/cf/proxy/zones", { body: "Forbidden", status: 403 }],
    ]);
    const p = createCloudPlatform(PROJECT);
    const cloudflare = await p.cfApi?.("/accounts").catch((error: unknown) => error);
    expect(platformErrorInfo(cloudflare).code).not.toBe("action-required");
    expect(p.cfApi?.("/zones")).rejects.toThrow();
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

describe("the platform's rows and notices in /me", () => {
  test("each one is mapped in the platform's words, and a malformed one is dropped", async () => {
    mockFetch([
      [
        "/api/v1/me",
        {
          body: {
            entries: [
              { actions: [JOIN], connected: true, detail: "Member.", id: "team", label: "Team" },
              { connected: "yes", detail: "Loose.", id: "loose", label: "Loose" },
              { detail: "No id.", label: "Nameless" },
              null,
            ],
            installations: [],
            notices: [
              {
                actions: [JOIN],
                display: "banner",
                id: "n1",
                level: "warning",
                message: "Membership ends soon.",
                title: "Team",
              },
              { display: "popup", id: "n2", level: "loud", message: "Hi.", title: "Hello" },
              { id: "n3", title: "No message" },
              null,
            ],
          },
        },
      ],
    ]);
    const status = await createCloudPlatform(null).getAccountStatus?.();
    expect(status?.entries).toEqual([
      { actions: [JOIN], connected: true, detail: "Member.", id: "team", label: "Team" },
      { detail: "Loose.", id: "loose", label: "Loose" },
    ]);
    expect(status?.notices).toEqual([
      {
        actions: [JOIN],
        display: "banner",
        id: "n1",
        level: "warning",
        message: "Membership ends soon.",
        title: "Team",
      },
      { id: "n2", message: "Hi.", title: "Hello" },
    ]);
  });

  test("a platform that sends none, or sends something else, has none", async () => {
    for (const body of [{ installations: [] }, { entries: {}, installations: [], notices: "x" }]) {
      mockFetch([["/api/v1/me", { body }]]);
      const status = await createCloudPlatform(null).getAccountStatus?.();
      expect(status).not.toHaveProperty("entries");
      expect(status).not.toHaveProperty("notices");
    }
  });
});

describe("performAction", () => {
  test("opens the action's page synchronously, inside the click that asked", () => {
    const open = mock((_url: string, _target?: string) => null);
    (window as { open: unknown }).open = open;
    (location as { assign: unknown }).assign = () => {};
    void createCloudPlatform(PROJECT).performAction?.(JOIN);
    // Called before any await: the click that asked is still on the stack.
    expect(open.mock.calls[0]?.[0]).toBe(JOIN.href);
    expect(open.mock.calls[0]?.[1]).toBe("jx-action");
  });

  test("an action with no page is not one this platform performs", async () => {
    const open = mock(() => null);
    (window as { open: unknown }).open = open;
    expect(await createCloudPlatform(null).performAction?.({ id: "x", label: "X" })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  test("a blocked window navigates the page instead", async () => {
    const assigned: string[] = [];
    (location as { assign: unknown }).assign = (url: string) => {
      assigned.push(url);
    };
    (window as { open: unknown }).open = mock(() => null);
    expect(await createCloudPlatform(null).performAction?.(JOIN)).toEqual({ status: "redirect" });
    expect(assigned).toEqual([JOIN.href]);
  });

  test("the window's own relay settles it, and nothing else does", async () => {
    manualTimers();
    const popup = { close: mock(() => {}), closed: false, focus: mock(() => {}) };
    (window as { open: unknown }).open = mock(() => popup);
    const p = createCloudPlatform(null);
    const pending = p.performAction?.(JOIN);
    // A second caller joins the running flow and raises its window rather than opening another.
    const joined = p.performAction?.(JOIN);
    expect(popup.focus).toHaveBeenCalled();
    relay({ source: "other", status: "done" });
    relay({ source: "jx-action", status: "done" }, "https://elsewhere.test");
    relay(null);
    relay({ source: "jx-action", status: "pending" });
    relay({ source: "jx-action", status: "done" });
    expect(await pending).toEqual({ status: "done" });
    expect(await joined).toEqual({ status: "done" });
    expect(popup.close).toHaveBeenCalled();
  });

  test("a window that refuses focus is still joined", async () => {
    manualTimers();
    const popup = {
      close: () => {},
      closed: false,
      focus: () => {
        throw new Error("cross-origin");
      },
    };
    (window as { open: unknown }).open = mock(() => popup);
    const p = createCloudPlatform(null);
    const pending = p.performAction?.(JOIN);
    const joined = p.performAction?.(JOIN);
    relay({ source: "jx-action", status: "canceled" });
    expect(await pending).toEqual({ status: "canceled" });
    expect(await joined).toEqual({ status: "canceled" });
  });

  test("a relayed error rejects, with the platform's reason or a plain one", async () => {
    manualTimers();
    (window as { open: unknown }).open = mock(() => ({ close: () => {}, closed: false }));
    const p = createCloudPlatform(null);
    const failed = p.performAction?.(JOIN);
    relay({ reason: "Request denied", source: "jx-action", status: "error" });
    expect(failed).rejects.toThrow("Request denied");
    await settle();
    const generic = p.performAction?.(JOIN);
    relay({ source: "jx-action", status: "error" });
    expect(generic).rejects.toThrow("The action could not be completed");
  });

  test("a window closed without saying is unknown, after a grace for a late relay", async () => {
    const clock = manualTimers();
    const popup = { close: mock(() => {}), closed: false };
    (window as { open: unknown }).open = mock(() => popup);
    const pending = createCloudPlatform(null).performAction?.(JOIN);
    clock.step(); // Still open: the watch re-arms.
    expect(clock.armed()).toBe(1);
    popup.closed = true;
    clock.step(); // Closed: the grace timer is armed.
    clock.step(); // The grace runs out.
    expect(await pending).toEqual({ status: "unknown" });
    // Already closed: nothing to close.
    expect(popup.close).not.toHaveBeenCalled();
  });

  test("a relay that lands in the grace period wins over the closed window", async () => {
    const clock = manualTimers();
    const popup = { close: () => {}, closed: true };
    (window as { open: unknown }).open = mock(() => popup);
    const pending = createCloudPlatform(null).performAction?.(JOIN);
    clock.step(); // Closed: the grace timer is armed.
    relay({ source: "jx-action", status: "done" });
    expect(await pending).toEqual({ status: "done" });
    expect(clock.armed()).toBe(0);
  });

  test("the deadline settles unknown and closes the window", async () => {
    const clock = manualTimers();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      const popup = { close: mock(() => {}), closed: false };
      (window as { open: unknown }).open = mock(() => popup);
      const pending = createCloudPlatform(null).performAction?.(JOIN);
      now += 16 * 60_000;
      clock.step();
      expect(await pending).toEqual({ status: "unknown" });
      expect(popup.close).toHaveBeenCalled();
    } finally {
      Date.now = realNow;
    }
  });
});

describe("the AI route", () => {
  test("names the bound project, and the hub names none", () => {
    expect(createCloudPlatform(PROJECT).aiChatUrl()).toBe("/api/v1/ai/chat?project=acme%2Fsite");
    expect(createCloudPlatform(null).aiChatUrl()).toBe("/api/v1/ai/chat");
  });
});

/** Run `body` with a global missing, as it is outside a browser, and put it back after. */
async function withoutGlobal(name: string, body: () => Promise<void> | void): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
  try {
    await body();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

describe("outside a browser", () => {
  /* An action runs where a click can open a window, and nowhere else: without a window there is
     nothing to open, and without a location there is nothing to navigate. */
  test("performing an action does nothing", async () => {
    const p = createCloudPlatform(PROJECT);
    await withoutGlobal("window", async () => {
      expect(await p.performAction?.(JOIN)).toBeNull();
    });
    await withoutGlobal("location", async () => {
      expect(await p.performAction?.(JOIN)).toBeNull();
    });
  });
});
