// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { JsonValue } from "@jxsuite/schema/types";
import type { streamImport } from "@jxsuite/studio/import-client";
import type { StudioPlatform } from "@jxsuite/studio/types";
import type { StudioRPC } from "../src/rpc-schema";
import { KIT_TAGS } from "@jxsuite/ui/documents";
import { LOOPBACK } from "./_constants";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

// ─── Mock electrobun/view ───────────────────────────────────────────────────

/* What a relaying PAL method answers when its RPC is typed with a reply (others are `Promise<void>`
   but still relay at runtime). Each keeps its own method's return type; the tables below only await
   it and compare it with the stub's echo, so this is what those return types have in common. */
type RelayedReply = object | string | boolean | null;

interface Call {
  method: string;
  args: unknown[];
}

const calls: Call[] = [];
/* A test's stand-in for one backend request. Every reply crosses the RPC JSON-serialized, so a
   stand-in answers with JSON (or throws, as a failed request does). */
const impls = new Map<string, (...args: unknown[]) => JsonValue>();

const requestProxy = new Proxy<Record<string, (...args: unknown[]) => Promise<JsonValue>>>(
  {},
  {
    get(_target, prop: string) {
      return (...args: unknown[]) => {
        calls.push({ args, method: prop });
        const impl = impls.get(prop);
        if (impl) {
          return (async () => impl(...args))();
        }
        return Promise.resolve({ method: prop, ok: true });
      };
    },
  },
);

const rpcObject = { request: requestProxy };

type WebviewMessages = StudioRPC["webview"]["messages"];

/** The config the platform hands `Electroview.defineRPC`: one handler per webview message. */
interface CapturedRpcConfig {
  handlers: {
    messages: { [K in keyof WebviewMessages]: (payload: WebviewMessages[K]) => void };
    requests: Record<string, never>;
  };
  maxRequestTime: number;
}

let capturedRpcConfig: CapturedRpcConfig | null = null;
let electroviewCtorArgs: { rpc: typeof rpcObject } | null = null;

void mock.module("electrobun/view", () => ({
  Electroview: class {
    static defineRPC(config: CapturedRpcConfig) {
      capturedRpcConfig = config;
      return rpcObject;
    }
    constructor(opts: { rpc: typeof rpcObject }) {
      electroviewCtorArgs = opts;
    }
  },
}));

function callsFor(method: string): Call[] {
  return calls.filter((c) => c.method === method);
}

function lastCall(method: string): Call | undefined {
  return callsFor(method).at(-1);
}

async function flush(ms = 25): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// The NDJSON stream client is exercised by studio's import-client tests; here only the plumbing
// (endpoint lookup, directory resolution, callback threading) matters.
const streamImportCalls: Parameters<typeof streamImport>[] = [];
void mock.module("@jxsuite/studio/import-client", () => ({
  streamImport: (...args: Parameters<typeof streamImport>) => {
    streamImportCalls.push(args);
    return Promise.resolve({ config: { name: "Imported" }, root: "/imported" });
  },
}));

// ─── Import module under test (after mocks + DOM) ──────────────────────────

const { createDesktopPlatform } = await import("../src/platform");
const { getPreviewNavigateHandler } = await import("@jxsuite/studio/preview-navigate");

// Stub the original fetch BEFORE the platform wraps it, so passthrough is observable.
const passthroughFetch = spyOn(window, "fetch").mockImplementation(
  Object.assign(async () => new Response("passthrough-body", { status: 299 }), {
    preconnect: () => {},
  }),
);

const platform = createDesktopPlatform();
// The asset observer rewrites relative panel srcs to the loopback origin; set it BEFORE the
// Synchronous mutation batch below so the observer sees the canvas origin as active.
platform.canvasUrl = `${LOOPBACK}/__studio__/canvas.html`;

// ─── Asset-resolution fixture (single synchronous mutation batch) ───────────
// The happy-dom MutationObserver delivers exactly one batch per observer, so
// All DOM mutations that should be observed must happen synchronously right
// After createDesktopPlatform() starts observing.

const imgRelative = document.createElement("img");
imgRelative.setAttribute("src", "./assets/pic.png");
const imgHttp = document.createElement("img");
imgHttp.setAttribute("src", "http://example.com/pic.png");
const imgData = document.createElement("img");
imgData.setAttribute("src", "data:image/png;base64,AA==");
const imgViews = document.createElement("img");
imgViews.setAttribute("src", "views://studio/pic.png");
const video = document.createElement("video");
video.setAttribute("poster", "media/poster.jpg");
const wrap = document.createElement("div");
const innerImg = document.createElement("img");
innerImg.setAttribute("src", "deep/inner.png");
wrap.append(innerImg);
// A styled child nested in an added subtree exercises the querySelectorAll("[style]") branch.
const styleWrap = document.createElement("div");
const styleChild = document.createElement("div");
styleChild.setAttribute("style", "background-image: url('deep/backdrop.png')");
styleWrap.append(styleChild);
const bgDiv = document.createElement("div");
bgDiv.setAttribute("style", "background-image: url('./bg/tile.png')");
const bgHttpDiv = document.createElement("div");
bgHttpDiv.setAttribute("style", "background-image: url('http://example.com/bg.png')");
const styleLateDiv = document.createElement("div");
const bgNoneDiv = document.createElement("div");
bgNoneDiv.setAttribute("style", "background-image: none");
const plainStyleDiv = document.createElement("div");
plainStyleDiv.setAttribute("style", "color: red");

document.body.append(
  bgNoneDiv,
  plainStyleDiv,
  imgRelative,
  imgHttp,
  imgData,
  imgViews,
  video,
  wrap,
  styleWrap,
  bgDiv,
  bgHttpDiv,
  styleLateDiv,
  "plain text node",
);

// Attribute mutations in the same batch exercise the "attributes" observer branch.
styleLateDiv.setAttribute("style", "background-image: url(late/style.png)");
imgHttp.setAttribute("src", "http://example.com/pic2.png");
imgRelative.setAttribute("alt", "ignored attribute");

// ─── RPC wiring ─────────────────────────────────────────────────────────────

describe("RPC setup", () => {
  test("defines RPC with message handlers and constructs Electroview", () => {
    expect(capturedRpcConfig).not.toBeNull();
    expect(capturedRpcConfig!.maxRequestTime).toBe(300_000);
    expect(capturedRpcConfig!.handlers.messages.fileChanged).toBeInstanceOf(Function);
    expect(capturedRpcConfig!.handlers.messages.updateReady).toBeInstanceOf(Function);
    expect(capturedRpcConfig!.handlers.requests).toEqual({});
    expect(electroviewCtorArgs).toEqual({ rpc: rpcObject });
  });

  /**
   * One process, N windows — but each has its own webview and its own settings kernel, so a change
   * made in one only reaches the others through this message.
   */
  test("settingsChanged reaches the kernel's subscriber until it unsubscribes", () => {
    const handler = capturedRpcConfig!.handlers.messages.settingsChanged;
    const seen: Record<string, string>[] = [];
    const unsubscribe = platform.subscribeSettings!((settings) => seen.push(settings));

    handler({ settings: { "jx.ai.model": "o3" } });
    expect(seen).toEqual([{ "jx.ai.model": "o3" }]);

    unsubscribe();
    handler({ settings: { "jx.ai.model": "gpt-4o" } });
    expect(seen).toHaveLength(1);
  });

  test("a settingsChanged with no subscriber is not an error", () => {
    const handler = capturedRpcConfig!.handlers.messages.settingsChanged;
    expect(() => handler({ settings: { a: "1" } })).not.toThrow();
  });

  /**
   * The studio sidebar's live-sync subscriber. `fileChanged` (above) is a single-path notice for
   * canvas asset resolution; `onFileEvents` is the batch of filesystem changes the sidebar redraws
   * from, and it is a different wire message with its own subscriber seam.
   */
  test("onFileEvents reaches the sidebar's live-sync subscriber until it unsubscribes", () => {
    const handler = capturedRpcConfig!.handlers.messages.onFileEvents;
    const seen: { type: string; path: string; isDir: boolean }[][] = [];
    const unsubscribe = platform.subscribeFileEvents!((events) => seen.push(events));

    handler({ events: [{ isDir: false, path: "pages/index.json", type: "change" }] });
    expect(seen).toEqual([[{ isDir: false, path: "pages/index.json", type: "change" }]]);

    unsubscribe();
    handler({ events: [{ isDir: false, path: "pages/other.json", type: "change" }] });
    expect(seen).toHaveLength(1);
  });

  test("an onFileEvents message with no subscriber is not an error", () => {
    const handler = capturedRpcConfig!.handlers.messages.onFileEvents;
    expect(() => handler({ events: [] })).not.toThrow();
  });

  test("fileChanged message handler runs without error", () => {
    const handler = capturedRpcConfig!.handlers.messages.fileChanged;
    expect(() => handler({ path: "some/file.json" })).not.toThrow();
  });

  /**
   * Raise one update notice and hand back the wrapper it appended.
   *
   * The newest, not the first: a test that leaves its own notice up would otherwise hand the next
   * one somebody else's DOM, and every assertion below would still pass while measuring the wrong
   * toast.
   */
  function raiseUpdateToast(version: string): HTMLElement {
    capturedRpcConfig!.handlers.messages.updateReady({ version });
    const raised = [...document.body.querySelectorAll(".update-toast-container")].at(-1);
    expect(raised).toBeInstanceOf(HTMLElement);
    if (!(raised instanceof HTMLElement)) {
      throw new Error(`updateReady ${version} raised no toast container`);
    }
    return raised;
  }

  test("updateReady raises a kit toast whose recovery control triggers applyUpdate", () => {
    const container = raiseUpdateToast("9.9.9");
    expect(container.textContent).toContain("9.9.9");

    const host = container.querySelector("jx-toast-host");
    expect(host).not.toBeNull();
    const toast = host!.querySelector("jx-toast");
    expect(toast).not.toBeNull();
    expect(toast!.hasAttribute("open")).toBe(true);
    expect(toast!.getAttribute("variant")).toBe("info");

    /* The recovery control is reachable by the slot the toast projects it through, which is the
       whole of what a consumer promises the element: `jx-toast` draws its own dismiss button and
       hosts exactly one control in `action`. This assertion stood as `querySelector("sp-button")`
       and is re-authored rather than dropped — it is the same contract, addressed the kit's way. */
    const before = callsFor("updaterApplyUpdate").length;
    const action = toast!.querySelector('[slot="action"]');
    expect(action).not.toBeNull();
    expect(action!.textContent).toContain("Restart to update");
    action!.dispatchEvent(new Event("click", { bubbles: true }));
    expect(callsFor("updaterApplyUpdate").length).toBe(before + 1);
    container.remove();
  });

  /**
   * An update nobody has answered is not an outcome that may retire itself, and `F8` belongs to
   * Studio's own stack — two hosts in one document would each answer the press with their own first
   * control and the reader would land wherever the last listener ran.
   */
  test("the notice is sticky and leaves the stack's hotkey to Studio", () => {
    const container = raiseUpdateToast("1.2.3");
    const host = container.querySelector("jx-toast-host")!;
    expect(host.getAttribute("hotkey")).toBe("");
    expect(host.getAttribute("live")).toBe("polite");
    expect(container.querySelector("jx-toast")!.getAttribute("timeout")).toBe("0");
    container.remove();
  });

  /**
   * `close` is dispatched only when the element itself decided (ui.md §5.2), so the wrapper can
   * follow it without ever answering a removal this code performed. Without this the body collects
   * one dead wrapper per update message for the rest of the session.
   */
  test("the wrapper leaves with the toast it held", () => {
    const container = raiseUpdateToast("4.5.6");
    expect(container.isConnected).toBe(true);
    container
      .querySelector("jx-toast")!
      .dispatchEvent(new CustomEvent("close", { bubbles: true, detail: { reason: "dismissed" } }));
    expect(container.isConnected).toBe(false);
  });

  /**
   * The tag names, held to the kit that defines them.
   *
   * This webview never registers an element of its own: `<sp-toast>` worked because the studio
   * bundle happened to register Spectrum, and nothing in this package declared that or would have
   * gone red when it stopped being true — which is how this call site became the last Spectrum
   * consumer in the repository. The `@jxsuite/ui` devDependency exists so this assertion can read
   * the kit's own list rather than a copy of it. It buys no CI routing that was missing: a kit
   * change already reached this suite through `@jxsuite/studio`, which depends on the kit — the run
   * was there all along and simply had nothing to say about the tag names.
   */
  test("every custom element the notice writes is one the kit defines", () => {
    const container = raiseUpdateToast("7.8.9");
    const tags = new Set(
      [...container.querySelectorAll("*")].flatMap((element) => {
        const tag = element.tagName.toLowerCase();
        return tag.includes("-") ? [tag] : [];
      }),
    );
    expect(tags.size).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(KIT_TAGS).toContain(tag);
    }
    container.remove();
  });
});

// ─── Fetch interception ─────────────────────────────────────────────────────

describe("fetch interception", () => {
  test("routes /__jx_resolve__ through rpc.request.jxResolve", async () => {
    impls.set("jxResolve", () => ({
      body: JSON.stringify({ resolved: true }),
      status: 201,
    }));
    const res = await window.fetch("/__jx_resolve__", {
      body: JSON.stringify({ a: 1 }),
      method: "POST",
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ resolved: true });
    expect(lastCall("jxResolve")!.args[0]).toEqual({ body: '{"a":1}' });
    impls.delete("jxResolve");
  });

  test("routes /__jx_server__ through rpc.request.jxServerFunction", async () => {
    impls.set("jxServerFunction", () => ({
      body: JSON.stringify({ value: 42 }),
      status: 200,
    }));
    const res = await window.fetch(new URL("http://localhost/__jx_server__"), {
      body: JSON.stringify({ fn: "x" }),
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: 42 });
    expect(lastCall("jxServerFunction")!.args[0]).toEqual({ body: '{"fn":"x"}' });
    impls.delete("jxServerFunction");
  });

  test("defaults body to {} when no init body and accepts Request input", async () => {
    impls.set("jxResolve", () => ({ body: "null", status: 200 }));
    const req = new Request("http://localhost/__jx_resolve__", { method: "POST" });
    const res = await window.fetch(req);
    expect(res.status).toBe(200);
    expect(lastCall("jxResolve")!.args[0]).toEqual({ body: "{}" });
    impls.delete("jxResolve");
  });

  test("returns 500 JSON error when the RPC handler throws", async () => {
    impls.set("jxServerFunction", () => {
      throw new Error("boom");
    });
    const res = await window.fetch("/__jx_server__", { body: "{}", method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Error: boom" });
    impls.delete("jxServerFunction");
  });
});

// ─── Class resolution (resolveClass PAL method) ─────────────────────────────

describe("resolveClass", () => {
  test("calls rpc.request.jxResolve directly and parses the JSON body", async () => {
    impls.set("jxResolve", () => ({
      body: JSON.stringify([{ data: { sku: "a" }, id: "A" }]),
      status: 200,
    }));
    const result = await platform.resolveClass!({ $src: "x", contentType: "product" });
    expect(result).toEqual([{ data: { sku: "a" }, id: "A" }]);
    expect(lastCall("jxResolve")!.args[0]).toEqual({
      body: '{"$src":"x","contentType":"product"}',
    });
    impls.delete("jxResolve");
  });

  test("throws on an error status", async () => {
    impls.set("jxResolve", () => ({ body: "nope", status: 500 }));
    expect(platform.resolveClass!({ $src: "x" })).rejects.toThrow("Class resolution failed: 500");
    impls.delete("jxResolve");
  });

  test("does NOT intercept views:// URLs — they pass through to the original fetch", async () => {
    // Loopback-only: the canvas doc + assets are served natively over http by the per-window loopback
    // Server, so there is no views:// read-shim. A views:// URL falls through to the original fetch.
    const res = await window.fetch("views://studio/data/foo.json");
    expect(res.status).toBe(299);
    expect(await res.text()).toBe("passthrough-body");
    expect(callsFor("readFile")).toHaveLength(0);
  });

  test("passes other URLs to the original fetch", async () => {
    const res = await window.fetch("http://example.com/page");
    expect(res.status).toBe(299);
    expect(await res.text()).toBe("passthrough-body");
    expect(passthroughFetch).toHaveBeenCalled();
  });
});

// ─── Platform method delegation ─────────────────────────────────────────────

describe("platform methods", () => {
  // The asset-observer fixture (module scope) set platform.canvasUrl to LOOPBACK; restore it after
  // Tests that mutate it so the later asset-resolution describe's observer still sees the origin.
  afterEach(() => {
    platform.canvasUrl = `${LOOPBACK}/__studio__/canvas.html`;
  });

  test("identity and activate", async () => {
    expect(platform.id).toBe("desktop");
    expect(platform.projectRoot).toBe("");
    // The desktop backend scaffolds onto disk, so the New Project modal renders a Location field
    // (with Browse…) rather than the cloud's owner/repository picker.
    expect(platform.createDestination).toBe("path");
    await platform.activate();
  });
  /**
   * THIS ASSERTION IS THE IDENTITY GUARANTEE.
   *
   * `assetSpace` absent means `"site"`, and `"site"` is exactly what shipped: the desktop loopback
   * IS the published site URL space (`serveProjectFile` in `@jxsuite/server`), so `/hero.jpg`
   * already resolves and Studio must not touch it. A value here — any value — would put the canvas
   * on a resolution path this host has never needed.
   */
  test("declares NO assetSpace: the loopback already serves the site URL space", () => {
    // Through the INTERFACE: the factory returns an INFERRED type (see `platform.ts`), so a
    // Property it deliberately does not set is not on that type at all. The assertion is about
    // What a host MAY declare, and this one declaring nothing.
    const pal: StudioPlatform = platform;
    expect(pal.assetSpace).toBeUndefined();
  });

  test("activate stores the loopback canvasUrl returned by getCanvasUrl", async () => {
    impls.set("getCanvasUrl", () => ({
      canvasUrl: "http://127.0.0.1:51234/__studio__/canvas.html",
    }));
    await platform.activate();
    expect(platform.canvasUrl).toBe("http://127.0.0.1:51234/__studio__/canvas.html");
    // A null canvasUrl clears it back to undefined.
    impls.set("getCanvasUrl", () => ({ canvasUrl: null }));
    await platform.activate();
    expect(platform.canvasUrl).toBeUndefined();
    impls.delete("getCanvasUrl");
  });

  test("activate leaves canvasUrl unset when the getCanvasUrl RPC throws", async () => {
    impls.set("getCanvasUrl", () => {
      throw new Error("rpc down");
    });
    platform.canvasUrl = undefined;
    await platform.activate();
    expect(platform.canvasUrl).toBeUndefined();
    impls.delete("getCanvasUrl");
  });

  test("openProject delegates with no arguments and relays the backend's answer", async () => {
    const opened = {
      config: { name: "Opened" },
      handle: { name: "Opened", projectConfig: { name: "Opened" }, root: "/opened" },
    };
    impls.set("openProject", () => opened);
    try {
      const result = await platform.openProject();
      expect(result).toEqual(opened);
      expect(lastCall("openProject")!.args).toEqual([]);
    } finally {
      impls.delete("openProject");
    }
  });

  /* The image editor's read path. The adapter's job is the base64 boundary: the backend cannot send
     bytes over a JSON-serialized RPC, so it sends a string and this is where it becomes a JPEG
     again. `/9j/4AAQ` is a real JPEG's first bytes, so a mangled decode is visible as a wrong
     marker rather than as a length that happens to match. */
  test("readFileBytes decodes the base64 the backend answers", async () => {
    impls.set("readFileBytes", () => ({ data: "/9j/4AAQ" }));
    const buffer = await platform.readFileBytes!("public/hero.jpg");
    expect([...new Uint8Array(buffer)]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(lastCall("readFileBytes")!.args[0]).toEqual({ path: "public/hero.jpg" });
    impls.delete("readFileBytes");
  });

  test("probeRootProject reads project.json when present", async () => {
    impls.set("getProjectRoot", () => ({ root: "/proj" }));
    impls.set("readFile", () => JSON.stringify({ name: "My Site" }));
    const probe = await platform.probeRootProject();
    expect(probe).not.toBeNull();
    expect(probe!.info.isSiteProject).toBe(true);
    expect(probe!.info.projectConfig).toEqual({ name: "My Site" });
    expect(probe!.meta).toEqual({ name: "My Site", root: "/proj" });
    expect(lastCall("readFile")!.args[0]).toEqual({ path: "project.json" });
    impls.delete("readFile");
    impls.delete("getProjectRoot");
  });

  test("probeRootProject falls back to 'project' name when config has none", async () => {
    impls.set("getProjectRoot", () => ({ root: "/proj" }));
    impls.set("readFile", () => "{}");
    const probe = await platform.probeRootProject();
    expect(probe).not.toBeNull();
    expect(probe!.info.isSiteProject).toBe(true);
    expect(probe!.meta.name).toBe("project");
    impls.delete("readFile");
    impls.delete("getProjectRoot");
  });

  test("probeRootProject reports non-site project on read failure", async () => {
    impls.set("getProjectRoot", () => ({ root: "/proj" }));
    impls.set("readFile", () => {
      throw new Error("missing");
    });
    const probe = await platform.probeRootProject();
    expect(probe).not.toBeNull();
    expect(probe!.info.isSiteProject).toBe(false);
    expect(probe!.info.projectConfig).toBeNull();
    expect(probe!.meta).toEqual({ name: "project", root: "." });
    impls.delete("readFile");
    impls.delete("getProjectRoot");
  });

  test("probeRootProject returns null when the window has no project (welcome window)", async () => {
    impls.set("getProjectRoot", () => ({ root: null }));
    const readsBefore = callsFor("readFile").length;
    const probe = await platform.probeRootProject();
    // Null tells the studio to show the welcome screen; project.json is never read.
    expect(probe).toBeNull();
    expect(callsFor("readFile").length).toBe(readsBefore);
    impls.delete("getProjectRoot");
  });

  test("probeRootProject returns null when getProjectRoot fails", async () => {
    impls.set("getProjectRoot", () => {
      throw new Error("rpc down");
    });
    const probe = await platform.probeRootProject();
    expect(probe).toBeNull();
    impls.delete("getProjectRoot");
  });

  /* One PAL method that relays its backend reply: its label, the call (typed against the method's
     own signature), the RPC it rides, and the payload it sends (undefined: no argument at all). */
  type Delegation = [
    method: string,
    invoke: () => Promise<RelayedReply> | Promise<void>,
    rpcMethod: string,
    payload: JsonValue | undefined,
  ];

  const delegations: Delegation[] = [
    [
      "resolveSiteContext",
      () => platform.resolveSiteContext("pages/a.json"),
      "resolveSiteContext",
      { filePath: "pages/a.json" },
    ],
    ["listDirectory", () => platform.listDirectory("src"), "listDirectory", { dir: "src" }],
    ["readFile", () => platform.readFile("a.json"), "readFile", { path: "a.json" }],
    [
      "writeFile",
      () => platform.writeFile("a.json", "body"),
      "writeFile",
      { content: "body", path: "a.json" },
    ],
    [
      "uploadFile",
      () => platform.uploadFile("img.png", "ZGF0YQ=="),
      "uploadFile",
      { data: "ZGF0YQ==", path: "img.png" },
    ],
    ["deleteFile", () => platform.deleteFile("a.json"), "deleteFile", { path: "a.json" }],
    [
      "renameFile",
      () => platform.renameFile("old.json", "new.json"),
      "renameFile",
      { from: "old.json", to: "new.json" },
    ],
    // The usage query rides the same RPC as the rename it warns about.
    [
      "findReferences",
      () => platform.findReferences({ path: "components/card.json", tagName: "my-card" }),
      "findReferences",
      { path: "components/card.json", tagName: "my-card" },
    ],
    [
      "createDirectory",
      () => platform.createDirectory("newdir"),
      "createDirectory",
      { path: "newdir" },
    ],
    [
      "codeService",
      () => platform.codeService("lint", { code: "x" }),
      "codeService",
      {
        action: "lint",
        payload: { code: "x" },
      },
    ],
    ["locateFile", () => platform.locateFile("button.json"), "locateFile", { name: "button.json" }],
    ["searchFiles", () => platform.searchFiles("query"), "searchFiles", { query: "query" }],
    // Quick Access widens the search with the format registry's document extensions.
    [
      "searchFiles",
      () => platform.searchFiles("query", [".md", ".mdx"]),
      "searchFiles",
      { extensions: [".md", ".mdx"], query: "query" },
    ],
    ["listFormats", () => platform.listFormats(), "listFormats", undefined],
    ["listExtensions", () => platform.listExtensions(), "listExtensions", undefined],
    [
      "listExtensionCatalog",
      () => platform.listExtensionCatalog(),
      "listExtensionCatalog",
      undefined,
    ],
    ["fetchProjectSchemas", () => platform.fetchProjectSchemas(), "fetchProjectSchemas", undefined],
    [
      "formatAction",
      () => platform.formatAction({ action: "parse", format: "md" }),
      "formatAction",
      {
        action: "parse",
        format: "md",
      },
    ],
    ["addPackage", () => platform.addPackage("lodash"), "addPackage", { name: "lodash" }],
    ["removePackage", () => platform.removePackage("lodash"), "removePackage", { name: "lodash" }],
    ["listPackages", () => platform.listPackages(), "listPackages", undefined],
    ["installDependencies", () => platform.installDependencies(), "installDependencies", undefined],
    [
      "dependenciesNeedInstall",
      () => platform.dependenciesNeedInstall(),
      "dependenciesNeedInstall",
      undefined,
    ],
    ["packageVersions", () => platform.packageVersions(), "packageVersions", undefined],
    [
      "setPackageVersions",
      () => platform.setPackageVersions([{ name: "x", version: "^1" }]),
      "setPackageVersions",
      { updates: [{ name: "x", version: "^1" }] },
    ],
    ["gitStatus", () => platform.gitStatus(), "gitStatus", undefined],
    ["gitBranches", () => platform.gitBranches(), "gitBranches", undefined],
    ["gitStage", () => platform.gitStage(["a.json"]), "gitStage", { files: ["a.json"] }],
    ["gitUnstage", () => platform.gitUnstage(["a.json"]), "gitUnstage", { files: ["a.json"] }],
    ["gitCommit", () => platform.gitCommit("feat: x"), "gitCommit", { message: "feat: x" }],
    ["gitPull", () => platform.gitPull(), "gitPull", undefined],
    ["gitFetch", () => platform.gitFetch(), "gitFetch", undefined],
    ["gitCheckout", () => platform.gitCheckout("dev"), "gitCheckout", { branch: "dev" }],
    [
      "gitCreateBranch",
      () => platform.gitCreateBranch("feature"),
      "gitCreateBranch",
      { name: "feature" },
    ],
    ["gitDiscard", () => platform.gitDiscard(["a.json"]), "gitDiscard", { files: ["a.json"] }],
    [
      "gitShow",
      () => platform.gitShow({ path: "a.json", ref: "HEAD~1" }),
      "gitShow",
      {
        path: "a.json",
        ref: "HEAD~1",
      },
    ],
    [
      "createProject",
      () =>
        platform.createProject({
          destination: { kind: "path", parent: "/tmp" },
          directory: "p",
          name: "p",
        }),
      "createProject",
      {
        destination: { kind: "path", parent: "/tmp" },
        directory: "p",
        name: "p",
      },
    ],
    ["listStarters", () => platform.listStarters(), "listStarters", undefined],
    ["aiChatUrl", () => platform.aiChatUrl(), "aiChatUrl", undefined],
    [
      "setWindowProject",
      () => platform.setWindowProject("/proj/x"),
      "setWindowProject",
      { root: "/proj/x" },
    ],
    // Both of these ANSWER now. `openProjectInNewWindow` reports whether it built a window or
    // Raised one that already had the project, and `pickProject` is the picker whose whole value
    // Is its return: the chosen project, with this window left bound to its own.
    [
      "openProjectInNewWindow",
      () => platform.openProjectInNewWindow("/proj/y"),
      "openProjectInNewWindow",
      { root: "/proj/y" },
    ],
    ["pickProject", () => platform.pickProject(), "pickProject", undefined],
    ["getProjectRoot", () => platform.getProjectRoot(), "getProjectRoot", undefined],
    ["getRecentProjects", () => platform.getRecentProjects(), "getRecentProjects", undefined],
    ["getSettings", () => platform.getSettings(), "getSettings", undefined],
    /* A patch, and it ANSWERS with the resulting store — so the caller learns what actually landed
       after composing with any concurrent writer. */
    [
      "patchSettings",
      () => platform.patchSettings({ remove: ["jx.ai.model"], set: { "jx.ai.openaiKey": "sk-x" } }),
      "patchSettings",
      { patch: { remove: ["jx.ai.model"], set: { "jx.ai.openaiKey": "sk-x" } } },
    ],
    // Data surface + secrets (desktop twins of /__studio/data/* + /__studio/secrets)
    ["dataConnections", () => platform.dataConnections(), "dataConnections", undefined],
    [
      "dataConnectionTest",
      () => platform.dataConnectionTest("main"),
      "dataConnectionTest",
      { connection: "main" },
    ],
    [
      "dataPush",
      () => platform.dataPush({ connection: "main", dryRun: true }),
      "dataPush",
      { connection: "main", dryRun: true },
    ],
    ["dataPush", () => platform.dataPush(), "dataPush", {}],
    [
      "dataRows",
      () => platform.dataRows({ limit: 50, table: "posts" }),
      "dataRows",
      { limit: 50, table: "posts" },
    ],
    [
      "dataInsertRow",
      () => platform.dataInsertRow({ table: "posts", values: { title: "t" } }),
      "dataInsertRow",
      { table: "posts", values: { title: "t" } },
    ],
    [
      "dataUpdateRow",
      () => platform.dataUpdateRow({ pk: "r1", set: { title: "u" }, table: "posts" }),
      "dataUpdateRow",
      { pk: "r1", set: { title: "u" }, table: "posts" },
    ],
    [
      "dataDeleteRow",
      () => platform.dataDeleteRow({ pk: "r1", table: "posts" }),
      "dataDeleteRow",
      { pk: "r1", table: "posts" },
    ],
    [
      "setSecrets",
      () => platform.setSecrets({ set: { MAIN_URL: "v" } }),
      "setSecrets",
      { set: { MAIN_URL: "v" } },
    ],
    // `Build Site` compiles through this and opens the origin the reply names.
    ["buildSite", () => platform.buildSite(), "buildSite", undefined],
    /* `View: Open in Browser` reaches this one, and the route travels WITH the call: the backend
       needs it to point an already-open tab somewhere, not just to name an origin. */
    [
      "previewSite",
      () => platform.previewSite({ route: "/blog/hello/" }),
      "previewSite",
      { route: "/blog/hello/" },
    ],
  ];

  for (const [method, invoke, rpcMethod, expectedPayload] of delegations) {
    test(`${method} delegates to rpc.request.${rpcMethod}`, async () => {
      const result = await invoke();
      const call = lastCall(rpcMethod);
      expect(call).toBeDefined();
      if (expectedPayload === undefined) {
        expect(call!.args).toEqual([]);
      } else {
        expect(call!.args[0]).toEqual(expectedPayload);
      }
      expect(result).toEqual({ method: rpcMethod, ok: true });
    });
  }

  /* The full PAL union accepts a `repo` destination too (the cloud backends), but this build
     scaffolds onto disk — `createDestination: "path"` above is what actually stops Studio sending
     one; this is the backend's own refusal if that ever got past it. */
  test("createProject refuses a repo destination — this app scaffolds to disk only", async () => {
    await expect(
      platform.createProject({
        destination: { kind: "repo", owner: "acme", private: false, repo: "site" },
        directory: "p",
        name: "p",
      }),
    ).rejects.toThrow("The desktop app creates projects on disk; repo destinations are cloud-only");
  });

  // The RPC transport JSON-serializes params, so a File/Blob would arrive as `{}`. The platform
  // Base64-encodes binary before the call; a string (already base64) passes through untouched.
  /* The path the backend REPORTS, not the one asked for. A store that de-duplicates by content
     hash, appends a suffix, or normalizes a name writes somewhere else, and the reference Studio
     puts in the document has to name what is really there. The RPC used to answer `void`. */
  test("uploadFile reports where the bytes landed", async () => {
    impls.set("uploadFile", () => ({ path: "public/sha256-deadbeef.png", size: 2 }));
    try {
      const result = await platform.uploadFile("img.png", new File(["hi"], "img.png"));
      expect(result).toEqual({ path: "public/sha256-deadbeef.png", size: 2 });
    } finally {
      impls.delete("uploadFile");
    }
  });

  test("uploadFile base64-encodes a File before the RPC", async () => {
    await platform.uploadFile("img.png", new File(["hi"], "img.png"));
    expect(lastCall("uploadFile")!.args[0]).toEqual({ data: "aGk=", path: "img.png" });
  });

  test("uploadFile base64-encodes a Blob before the RPC", async () => {
    await platform.uploadFile("img.png", new Blob(["hi"]));
    expect(lastCall("uploadFile")!.args[0]).toEqual({ data: "aGk=", path: "img.png" });
  });

  test("uploadFile base64-encodes a raw ArrayBuffer before the RPC", async () => {
    await platform.uploadFile("img.png", new Uint8Array([104, 105]).buffer);
    expect(lastCall("uploadFile")!.args[0]).toEqual({ data: "aGk=", path: "img.png" });
  });

  /** A PAL method that awaits its RPC and answers nothing, whatever the backend replied. */
  type VoidDelegation = [
    method: string,
    invoke: () => Promise<void>,
    rpcMethod: string,
    payload: JsonValue | undefined,
  ];

  const voidDelegations: VoidDelegation[] = [
    ["gitInit", () => platform.gitInit(), "gitInit", undefined],
    [
      "gitAddRemote",
      () => platform.gitAddRemote("origin", "git@host:repo.git"),
      "gitAddRemote",
      {
        name: "origin",
        url: "git@host:repo.git",
      },
    ],
    ["newWindow", () => platform.newWindow(), "newWindow", undefined],
    [
      "saveRecentProjects",
      () => platform.saveRecentProjects([{ name: "x", root: "/x", timestamp: 1 }]),
      "saveRecentProjects",
      { projects: [{ name: "x", root: "/x", timestamp: 1 }] },
    ],
    /* The bytes a save WOULD write, so the preview shows the canvas rather than the disk. Two
       positional arguments on the PAL, one object on the wire. */
    [
      "setPreviewOverlay",
      () => platform.setPreviewOverlay("pages/index.json", '{"tagName":"main"}'),
      "setPreviewOverlay",
      { contents: '{"tagName":"main"}', path: "pages/index.json" },
    ],
    [
      "clearPreviewOverlay",
      () => platform.clearPreviewOverlay("pages/index.json"),
      "clearPreviewOverlay",
      {
        path: "pages/index.json",
      },
    ],
  ];

  for (const [method, invoke, rpcMethod, expectedPayload] of voidDelegations) {
    test(`${method} awaits rpc.request.${rpcMethod} and returns undefined`, async () => {
      const result = await invoke();
      const call = lastCall(rpcMethod);
      expect(call).toBeDefined();
      if (expectedPayload === undefined) {
        expect(call!.args).toEqual([]);
      } else {
        expect(call!.args[0]).toEqual(expectedPayload);
      }
      expect(result).toBeUndefined();
    });
  }

  /* `clearPreviewOverlay()` with no path means EVERY document, and the wire has to say that as an
     empty object rather than `{ path: undefined }` — which a JSON round trip would turn into the
     same thing but which the backend reads as a positional argument either way. The distinction is
     what separates "drop this document" from "drop all of them". */
  test("clearPreviewOverlay with no path asks for the whole project", async () => {
    await platform.clearPreviewOverlay!();
    expect(lastCall("clearPreviewOverlay")!.args[0]).toEqual({});
  });

  test("discoverComponents includes dir only when provided", async () => {
    await platform.discoverComponents("components");
    expect(lastCall("discoverComponents")!.args[0]).toEqual({ dir: "components" });
    await platform.discoverComponents();
    expect(lastCall("discoverComponents")!.args[0]).toEqual({});
  });

  test("listSecrets unwraps the names-only response", async () => {
    impls.set("listSecrets", () => ({ names: ["MAIN_URL", "OTHER"] }));
    try {
      const names = await platform.listSecrets();
      expect(names).toEqual(["MAIN_URL", "OTHER"]);
      expect(lastCall("listSecrets")!.args).toEqual([]);
    } finally {
      impls.delete("listSecrets");
    }
  });

  test("fetchPluginSchema conditionally spreads prototype and base", async () => {
    await platform.fetchPluginSchema("pkg/mod.js", "Widget", "/base");
    expect(lastCall("fetchPluginSchema")!.args[0]).toEqual({
      base: "/base",
      prototype: "Widget",
      src: "pkg/mod.js",
    });
    await platform.fetchPluginSchema("pkg/mod.js");
    expect(lastCall("fetchPluginSchema")!.args[0]).toEqual({ src: "pkg/mod.js" });
  });

  test("gitLog includes limit only when provided", async () => {
    await platform.gitLog(7);
    expect(lastCall("gitLog")!.args[0]).toEqual({ limit: 7 });
    await platform.gitLog();
    expect(lastCall("gitLog")!.args[0]).toEqual({});
  });

  test("gitPush defaults opts to empty object", async () => {
    await platform.gitPush({ setUpstream: true });
    expect(lastCall("gitPush")!.args[0]).toEqual({ setUpstream: true });
    await platform.gitPush();
    expect(lastCall("gitPush")!.args[0]).toEqual({});
  });

  test("gitDiff includes path only when provided", async () => {
    await platform.gitDiff("a.json");
    expect(lastCall("gitDiff")!.args[0]).toEqual({ path: "a.json" });
    await platform.gitDiff();
    expect(lastCall("gitDiff")!.args[0]).toEqual({});
  });

  test("updater methods delegate", async () => {
    const mapping: [invoke: () => Promise<RelayedReply> | Promise<void>, rpcMethod: string][] = [
      [() => platform.updater.applyUpdate(), "updaterApplyUpdate"],
      [() => platform.updater.checkForUpdate(), "updaterCheckForUpdate"],
      [() => platform.updater.downloadUpdate(), "updaterDownloadUpdate"],
      [() => platform.updater.getLocalInfo(), "updaterGetLocalInfo"],
      [() => platform.updater.getStatus(), "updaterGetStatus"],
    ];
    for (const [invoke, rpcMethod] of mapping) {
      const before = callsFor(rpcMethod).length;
      await invoke();
      expect(callsFor(rpcMethod).length).toBe(before + 1);
    }
  });

  test("windowControls delegate and setFrame maps positional args", async () => {
    await platform.windowControls.close();
    expect(lastCall("windowClose")).toBeDefined();
    await platform.windowControls.getFrame();
    expect(lastCall("windowGetFrame")).toBeDefined();
    await platform.windowControls.maximize();
    expect(lastCall("windowMaximize")).toBeDefined();
    await platform.windowControls.minimize();
    expect(lastCall("windowMinimize")).toBeDefined();
    await platform.windowControls.setFrame(10, 20, 300, 400);
    expect(lastCall("windowSetFrame")!.args[0]).toEqual({
      height: 400,
      width: 300,
      x: 10,
      y: 20,
    });
  });
});

// ─── MutationObserver asset resolution ──────────────────────────────────────
// All mutations happened in the single module-scope batch above; tests only
// Assert on the settled DOM state.

describe("asset resolution via MutationObserver", () => {
  test("rewrites a relative img src to the loopback origin (no data: fetch)", async () => {
    await flush();
    expect(imgRelative.getAttribute("src")).toBe(`${LOOPBACK}/assets/pic.png`);
  });

  test("leaves absolute, data and views urls untouched", async () => {
    await flush();
    expect(imgHttp.getAttribute("src")).toBe("http://example.com/pic2.png");
    expect(imgData.getAttribute("src")).toBe("data:image/png;base64,AA==");
    expect(imgViews.getAttribute("src")).toBe("views://studio/pic.png");
  });

  test("resolves video poster attribute", async () => {
    await flush();
    expect(video.getAttribute("poster")).toBe(`${LOOPBACK}/media/poster.jpg`);
  });

  test("resolves nested children of an added subtree", async () => {
    await flush();
    expect(innerImg.getAttribute("src")).toBe(`${LOOPBACK}/deep/inner.png`);
  });

  test("resolves background images on styled children of an added subtree", async () => {
    await flush();
    expect(styleChild.style.backgroundImage).toContain(`${LOOPBACK}/deep/backdrop.png`);
  });

  test("rewrites style background-image url to the loopback origin", async () => {
    await flush();
    expect(bgDiv.style.backgroundImage).toContain(`${LOOPBACK}/bg/tile.png`);
  });

  test("ignores http, none and absent background images", async () => {
    await flush();
    expect(bgHttpDiv.style.backgroundImage).toContain("example.com/bg.png");
    expect(bgNoneDiv.style.backgroundImage).toBe("none");
    expect(plainStyleDiv.style.color).toBe("red");
  });

  test("reacts to style attribute mutations", async () => {
    await flush();
    expect(styleLateDiv.style.backgroundImage).toContain(`${LOOPBACK}/late/style.png`);
  });
});

// ─── activate() initial sweep ────────────────────────────────────────────────
// Imgs mounted before activate() resolves carry relative srcs; activate() runs a
// Synchronous sweep AFTER canvasUrl is set (then drains the observer's queue) so
// They are rewritten promptly rather than waiting for the next mutation.

describe("activate() initial asset sweep", () => {
  // Restore the module-scope loopback for any later assertions that depend on it.
  afterEach(() => {
    platform.canvasUrl = `${LOOPBACK}/__studio__/canvas.html`;
    impls.delete("getCanvasUrl");
  });

  test("rewrites a pre-mounted relative img to the loopback origin during activate()", async () => {
    // Clear the origin BEFORE mounting so the observer (if it fires on append) no-ops the img —
    // Proving the rewrite below is the work of activate()'s synchronous sweep, not the observer.
    platform.canvasUrl = undefined;
    const preImg = document.createElement("img");
    preImg.setAttribute("src", "/images/pre.png");
    document.body.append(preImg);

    impls.set("getCanvasUrl", () => ({ canvasUrl: `${LOOPBACK}/__studio__/canvas.html` }));
    await platform.activate();
    // No further flush(): the sweep ran synchronously inside activate() after canvasUrl resolved.
    expect(preImg.getAttribute("src")).toBe(`${LOOPBACK}/images/pre.png`);
    preImg.remove();
  });

  test("does not throw and leaves relative imgs and background-images untouched when canvasUrl is null", async () => {
    platform.canvasUrl = undefined;
    const preImg = document.createElement("img");
    preImg.setAttribute("src", "/images/none.png");
    document.body.append(preImg);
    // A styled element mounted before activate() resolves: resolveBackgroundImage runs during the
    // Same synchronous sweep, and with no origin yet it must leave the url() alone too.
    const preBg = document.createElement("div");
    preBg.style.backgroundImage = "url(/images/none-bg.png)";
    document.body.append(preBg);

    impls.set("getCanvasUrl", () => ({ canvasUrl: null }));
    const result = await platform.activate();
    expect(result).toBeUndefined();
    // LoopbackOrigin() is null => the sweep is skipped and the relative src stays put.
    expect(preImg.getAttribute("src")).toBe("/images/none.png");
    expect(preBg.style.backgroundImage).toContain("none-bg.png");
    expect(preBg.style.backgroundImage).not.toContain(LOOPBACK);
    preImg.remove();
    preBg.remove();
  });

  /* A malformed canvasUrl (a corrupt RPC reply, not merely an absent one) makes `new URL()` throw
     inside loopbackOrigin's own try/catch — a distinct path from the "not resolved yet" null case
     above, which never calls `new URL()` at all. */
  test("a malformed canvasUrl also leaves relative imgs untouched, rather than throwing", async () => {
    platform.canvasUrl = undefined;
    const preImg = document.createElement("img");
    preImg.setAttribute("src", "/images/malformed.png");
    document.body.append(preImg);

    impls.set("getCanvasUrl", () => ({ canvasUrl: "http://[not-a-valid-host" }));
    const result = await platform.activate();
    expect(result).toBeUndefined();
    expect(preImg.getAttribute("src")).toBe("/images/malformed.png");
    preImg.remove();
  });

  test("a sweep failure is caught and does not break activate()", async () => {
    platform.canvasUrl = undefined;
    impls.set("getCanvasUrl", () => ({ canvasUrl: `${LOOPBACK}/__studio__/canvas.html` }));
    // Force resolveAllAssets to throw by making the tree walk blow up; the catch must swallow it.
    const sweep = spyOn(document.documentElement, "querySelectorAll").mockImplementation(() => {
      throw new Error("sweep boom");
    });
    try {
      const result = await platform.activate();
      expect(result).toBeUndefined();
    } finally {
      sweep.mockRestore();
    }
  });
});

// ─── Preview links ───────────────────────────────────────────────────────────

/*
 * A link followed in Preview exists to see the real page behave like the real thing, so it leaves
 * the editor entirely. The failure mode this covers is quiet: `openExternal` ANSWERS when the OS
 * has no opener — `{ ok: false }` — so a handler that only caught rejections dropped the click.
 */
describe("preview link navigation", () => {
  test("hands the url to the OS", async () => {
    const before = callsFor("openExternal").length;
    impls.set("openExternal", () => ({ ok: true }));
    getPreviewNavigateHandler()!("https://example.com/blog/");
    await until(() => callsFor("openExternal").length > before);
    expect(callsFor("openExternal").at(-1)!.args).toEqual([{ url: "https://example.com/blog/" }]);
  });

  test("falls back to a new tab when the OS REFUSES rather than throws", async () => {
    impls.set("openExternal", () => ({ ok: false }));
    const opened = trackWindowOpen();
    try {
      getPreviewNavigateHandler()!("https://example.com/refused/");
      await until(() => opened.urls.length > 0);
      expect(opened.urls).toEqual(["https://example.com/refused/"]);
    } finally {
      opened.restore();
    }
  });

  test("falls back to a new tab when the request rejects", async () => {
    impls.set("openExternal", () => {
      throw new Error("rpc down");
    });
    const opened = trackWindowOpen();
    try {
      getPreviewNavigateHandler()!("https://example.com/thrown/");
      await until(() => opened.urls.length > 0);
      expect(opened.urls).toEqual(["https://example.com/thrown/"]);
    } finally {
      opened.restore();
    }
  });
});

/** Capture `window.open` calls without letting happy-dom navigate anything. */
function trackWindowOpen() {
  const urls: string[] = [];
  const open = spyOn(window, "open").mockImplementation((url?: string | URL) => {
    urls.push(String(url));
    return null;
  });
  return {
    restore: () => {
      open.mockRestore();
    },
    urls,
  };
}

/** Wait for a condition a pending promise will make true. */
async function until(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

describe("getAppInfo", () => {
  /* The composition moved to the Bun side (updater.ts `composeAppInfo`, covered in
     updater.test.ts), so what is left to check here is that the webview asks for it as ONE request
     and passes the answer through untouched — the property that lets the chromium launcher, which
     has no updater, answer the same About screen. */
  test("passes the launcher's composed answer through", async () => {
    impls.set("appInfo", () => ({
      channel: "stable",
      hash: "abc",
      updateStatus: "Up to date",
      version: "1.2.3",
    }));
    const info = await platform.getAppInfo!();
    expect(info).toEqual({
      channel: "stable",
      hash: "abc",
      updateStatus: "Up to date",
      version: "1.2.3",
    });
  });

  test("a launcher with no update feed omits the status rather than inventing one", async () => {
    impls.set("appInfo", () => ({ channel: "system", hash: "unknown", version: "1.4.1" }));
    const info = await platform.getAppInfo!();
    expect(info.updateStatus).toBeUndefined();
    expect(info.channel).toBe("system");
  });
});

// ─── AI-guided site import ───────────────────────────────────────────────────

describe("importSite / pickDirectory", () => {
  test("pickDirectory returns the natively picked path", async () => {
    impls.set("pickDirectory", () => ({ path: "/picked/parent" }));
    await expect(platform.pickDirectory!()).resolves.toBe("/picked/parent");
  });

  test("a relative directory is rejected instead of being resolved under a picked parent", async () => {
    // The modal resolves the destination before calling (Location field + slug), so a bare slug
    // Means a caller skipped it — the bridge refuses rather than quietly opening a folder dialog.
    streamImportCalls.length = 0;
    const picksBefore = callsFor("pickDirectory").length;
    impls.set("pickDirectory", () => ({ path: "/picked/parent" }));
    impls.set("importSiteUrl", () => "http://127.0.0.1:9/__studio/import-site?token=T");
    await expect(
      platform.importSite!(
        {
          aiComponents: false,
          depth: 1,
          directory: "my-slug",
          maxPages: 5,
          name: "X",
          url: "https://x.example",
        },
        () => {},
      ),
    ).rejects.toThrow("A destination folder is required.");
    expect(callsFor("pickDirectory")).toHaveLength(picksBefore);
    expect(streamImportCalls).toHaveLength(0);
  });

  test("an absolute directory is streamed to the RPC endpoint without a dialog", async () => {
    streamImportCalls.length = 0;
    impls.set("pickDirectory", () => {
      throw new Error("dialog must not open");
    });
    impls.set("importSiteUrl", () => "http://127.0.0.1:9/__studio/import-site?token=T");
    const onProgress = () => {};
    const result = await platform.importSite!(
      {
        aiComponents: false,
        depth: 0,
        directory: "/abs/dest",
        maxPages: 1,
        name: "X",
        url: "https://x.example",
      },
      onProgress,
    );
    expect(result).toEqual({ config: { name: "Imported" }, root: "/imported" });
    const [endpoint, opts, cb] = streamImportCalls[0]!;
    expect(endpoint).toBe("http://127.0.0.1:9/__studio/import-site?token=T");
    expect(opts.directory).toBe("/abs/dest");
    expect(cb).toBe(onProgress);
  });

  test("a windows drive-letter destination counts as absolute", async () => {
    streamImportCalls.length = 0;
    impls.set("importSiteUrl", () => "http://127.0.0.1:9/__studio/import-site?token=T");
    await platform.importSite!(
      {
        aiComponents: false,
        depth: 0,
        directory: String.raw`C:\Sites\dest`,
        maxPages: 1,
        name: "X",
        url: "https://x.example",
      },
      () => {},
    );
    expect(streamImportCalls[0]![1].directory).toBe(String.raw`C:\Sites\dest`);
  });

  test("rejects an empty destination directory", async () => {
    streamImportCalls.length = 0;
    await expect(
      platform.importSite!(
        {
          aiComponents: false,
          depth: 0,
          directory: "",
          maxPages: 1,
          name: "X",
          url: "https://x.example",
        },
        () => {},
      ),
    ).rejects.toThrow("A destination folder is required.");
    expect(streamImportCalls).toHaveLength(0);
  });
});
