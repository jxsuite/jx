import { describe, expect, mock, test } from "bun:test";

// Index.ts is now a thin app-level bootstrap: it wires shared services (AI server, updater, menu)
// And opens the initial window via the window-manager. Per-window RPC + window controls live in
// Window-manager.ts (see window-manager.test.ts).

// ─── Mock electrobun/main (default export: events) ───────────────────────────

const eventHandlers = new Map<string, (e: { data: { url: string } }) => void>();
void mock.module("electrobun/main", () => ({
  default: {
    events: {
      on: (name: string, handler: (e: { data: { url: string } }) => void) => {
        eventHandlers.set(name, handler);
      },
    },
  },
}));

// ─── Mock local modules ──────────────────────────────────────────────────────

const openProjectWindow = mock((_root: string | null) => ({}) as unknown);
const setAiChatUrl = mock((_url: string) => {});
const setImportServiceUrl = mock((_url: string) => {});
const broadcastSettingsChanged = mock((_settings: Record<string, string>) => {});
const broadcastUpdateReady = mock((_version: string) => {});
const parseProjectDirFromUrl = mock((url: string) =>
  url.includes("project.json") ? "/parsed/dir" : null,
);
void mock.module("../src/window-manager", () => ({
  broadcastSettingsChanged,
  broadcastUpdateReady,
  openProjectWindow,
  parseProjectDirFromUrl,
  setAiChatUrl,
  setImportServiceUrl,
}));

const installApplicationMenu = mock(() => {});
void mock.module("../src/menu", () => ({ installApplicationMenu }));

const setFileDialog = mock((_fn: unknown) => {});
void mock.module("../src/project-session", () => ({
  setDirectoryDialog: mock(() => {}),
  setFileDialog,
}));

let notifyWebview: ((version: string) => void) | null = null;
const startBackgroundChecks = mock(() => {});
const setNotifyWebview = mock((fn: (version: string) => void) => {
  notifyWebview = fn;
});
void mock.module("../src/updater", () => ({ setNotifyWebview, startBackgroundChecks }));

const openFileDialogSentinel = mock(async () => null);
const initUtils = mock(async () => {});
const openDirectoryDialogSentinel = mock(async () => null);
void mock.module("../src/utils", () => ({
  init: initUtils,
  openDirectoryDialog: openDirectoryDialogSentinel,
  openFileDialog: openFileDialogSentinel,
}));

const handleAiApi = mock(async (_req: Request, url: URL) => {
  if (url.pathname === "/__studio/ai/hit") {
    return new Response("ai-ok", { status: 200 });
  }
  return null;
});
void mock.module("@jxsuite/server/ai-api", () => ({ handleAiApi }));

const handleImportApi = mock(
  async (_req: Request, _url: URL, _opts: unknown): Promise<Response | null> =>
    new Response("import-ok", { status: 200 }),
);
void mock.module("@jxsuite/server/import-api", () => ({ handleImportApi }));

// ─── Stub Bun.serve, then import the module under test ───────────────────────

const realServe = Bun.serve;
let serveOpts: { fetch: (req: Request) => Promise<Response>; port: number } | null = null;
// @ts-expect-error replacing Bun.serve with a capture stub for import-time boot
Bun.serve = (opts: { fetch: (req: Request) => Promise<Response>; port: number }) => {
  serveOpts = opts;
  return { port: 43_210, stop: () => {} };
};

const mod = await import("../src/index");
// The boot sequence runs in an exported async function (`ready`) instead of a top-level await, so
// Await it before asserting on its effects and before restoring the real Bun.serve.
await mod.ready;

Bun.serve = realServe;

const expectedBoot = process.argv[2] || process.env.JSONSX_PROJECT_ROOT || null;

// ─── Boot sequence ────────────────────────────────────────────────────────────

describe("boot sequence", () => {
  test("initializes utils and wires the file dialog", () => {
    expect(initUtils).toHaveBeenCalledTimes(1);
    expect(setFileDialog).toHaveBeenCalledWith(openFileDialogSentinel);
  });

  test("starts the AI server on an ephemeral port and publishes its url", () => {
    expect(serveOpts).not.toBeNull();
    expect(serveOpts!.port).toBe(0);
    expect(typeof serveOpts!.fetch).toBe("function");
    expect(setAiChatUrl.mock.calls[0]?.[0]).toStartWith(
      "http://127.0.0.1:43210/__studio/ai/chat?token=",
    );
  });

  test("installs the application menu", () => {
    expect(installApplicationMenu).toHaveBeenCalledTimes(1);
  });

  test("starts background update checks and broadcasts updates to all windows", () => {
    expect(startBackgroundChecks).toHaveBeenCalledTimes(1);
    expect(notifyWebview).not.toBeNull();
    notifyWebview!("3.1.4");
    expect(broadcastUpdateReady).toHaveBeenCalledWith("3.1.4");
  });

  test("opens the initial window from argv/env (null → welcome)", () => {
    expect(openProjectWindow).toHaveBeenCalledTimes(1);
    expect(openProjectWindow.mock.calls[0]?.[0]).toBe(expectedBoot as never);
  });
});

// ─── AI HTTP server fetch handler (token-gated) ─────────────────────────────

describe("AI server fetch handler", () => {
  const chatUrl = () => new URL(setAiChatUrl.mock.calls[0]?.[0] as string);
  const tokened = (path: string) => {
    const url = new URL(path, chatUrl());
    url.search = chatUrl().search;
    return url.href;
  };

  test("delegates tokened AI routes to handleAiApi with the request URL", async () => {
    const res = await serveOpts!.fetch(new Request(tokened("/__studio/ai/hit")));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ai-ok");
    const [, url] = handleAiApi.mock.calls.at(-1)!;
    expect((url as URL).pathname).toBe("/__studio/ai/hit");
  });

  /* The route forwards to a provider on the user's own key; without the token any local process
     could spend it. The handler must not even be consulted. */
  test("rejects AI requests without the token, before handleAiApi runs", async () => {
    const before = handleAiApi.mock.calls.length;
    const res = await serveOpts!.fetch(new Request("http://127.0.0.1:43210/__studio/ai/chat"));
    expect(res.status).toBe(403);
    expect(handleAiApi.mock.calls.length).toBe(before);
  });

  test("rejects AI requests carrying a wrong token", async () => {
    const before = handleAiApi.mock.calls.length;
    const res = await serveOpts!.fetch(
      new Request("http://127.0.0.1:43210/__studio/ai/chat?token=not-the-token"),
    );
    expect(res.status).toBe(403);
    expect(handleAiApi.mock.calls.length).toBe(before);
  });

  /* A DNS-rebound page names the attacker's host; the token is not the only line. */
  test("rejects a non-loopback Host even with the token", async () => {
    const before = handleAiApi.mock.calls.length;
    const res = await serveOpts!.fetch(
      new Request(tokened("/__studio/ai/chat"), { headers: { host: "evil.example:43210" } }),
    );
    expect(res.status).toBe(403);
    expect(handleAiApi.mock.calls.length).toBe(before);
  });

  test("the AI and import routes share one per-process token", () => {
    const importToken = new URL(setImportServiceUrl.mock.calls[0]?.[0] as string).searchParams.get(
      "token",
    );
    expect(chatUrl().searchParams.get("token")).toBe(importToken);
  });

  test("returns 404 when handleAiApi does not handle a tokened route", async () => {
    const res = await serveOpts!.fetch(new Request(tokened("/__studio/ai/nope")));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });

  test("returns 404 for routes outside both prefixes", async () => {
    const res = await serveOpts!.fetch(new Request("http://127.0.0.1:43210/nope"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});

// ─── Import route (token-gated) ─────────────────────────────────────────────

describe("import-site route", () => {
  const publishedUrl = () => setImportServiceUrl.mock.calls[0]?.[0] as string;

  test("publishes the tokened endpoint on the shared server", () => {
    expect(publishedUrl()).toStartWith("http://127.0.0.1:43210/__studio/import-site?token=");
  });

  test("rejects requests without the token", async () => {
    const res = await serveOpts!.fetch(
      new Request("http://127.0.0.1:43210/__studio/import-site", { method: "POST" }),
    );
    expect(res.status).toBe(403);
    expect(handleImportApi).not.toHaveBeenCalled();
  });

  test("delegates tokened requests to handleImportApi with an absolute-dir guard", async () => {
    const res = await serveOpts!.fetch(new Request(publishedUrl(), { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("import-ok");
    const opts = handleImportApi.mock.calls.at(-1)?.[2] as {
      resolveDest: (dir: string) => string;
    };
    expect(opts.resolveDest("/abs/dir")).toBe("/abs/dir");
    expect(() => opts.resolveDest("relative/dir")).toThrow("absolute");
  });

  /* A tokened request under /__studio/import-site that handleImportApi does not itself handle (a
     sub-route it declines) falls through to the shared 404, rather than the fetch handler assuming
     every request inside the prefix is answered. */
  test("falls through to 404 when handleImportApi does not handle the request", async () => {
    handleImportApi.mockImplementationOnce(async () => null);
    const res = await serveOpts!.fetch(new Request(publishedUrl(), { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not Found");
  });
});

// ─── open-url file association ──────────────────────────────────────────────

describe("open-url event", () => {
  const handler = () => eventHandlers.get("open-url")!;

  test("registers an open-url listener", () => {
    expect(eventHandlers.has("open-url")).toBe(true);
  });

  test("opens a window for the parsed project directory", () => {
    const before = openProjectWindow.mock.calls.length;
    handler()({ data: { url: "file:///home/me/proj/project.json" } });
    expect(parseProjectDirFromUrl).toHaveBeenCalledWith("file:///home/me/proj/project.json");
    expect(openProjectWindow.mock.calls.length).toBe(before + 1);
    expect(openProjectWindow.mock.calls.at(-1)?.[0]).toBe("/parsed/dir");
  });

  test("ignores urls that do not parse to a project directory", () => {
    const before = openProjectWindow.mock.calls.length;
    handler()({ data: { url: "file:///home/me/proj/readme.md" } });
    expect(openProjectWindow.mock.calls.length).toBe(before);
  });
});
