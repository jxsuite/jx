/**
 * The host half of the asset-version sync: the map reaches each frame BEFORE anything the frame
 * would resolve media in — its first render, every later render, every patch — and again whenever
 * the versions move.
 *
 * Ordering is the whole contract. A frame that drew a node against an older map could put a
 * forgotten version (bytes that have since changed) into an `<img src>`, and a host that caches a
 * versioned URL immutably would then serve the old bytes for good. The channel is FIFO, so "posted
 * before the render" is "known before the render".
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { flush, registerPrimaryStage, resetWorkspaceWithTab } from "./harness";
import type { FakeIframeChannel } from "./harness";
import { surfaceForPane } from "../src/canvas/surface-registry";
import {
  beginListing,
  forgetVersions,
  noteListing,
  resetAssetVersions,
} from "../src/files/asset-versions";
import type { postMessageChannel } from "../src/canvas/iframe-channel";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";
import type { CanvasPanel } from "../src/types";

/* SAFETY: `./with-dom.js` registers happy-dom's GlobalRegistrator, which copies the window's
   members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

/** What the host hands the channel factory: its target window, origins and token. */
type ChannelOptions = Parameters<typeof postMessageChannel<ParentToIframe, IframeToParent>>[0];

const channels: FakeIframeChannel[] = [];

void mock.module("../src/canvas/iframe-channel", () => ({
  postMessageChannel: (opts: ChannelOptions) => {
    let handler: ((m: IframeToParent) => void) | null = null;
    const rec: FakeIframeChannel = { deliver: (m) => handler?.(m), posts: [] };
    channels.push(rec);
    return {
      dispose: () => {},
      onMessage: (h: (m: IframeToParent) => void) => {
        handler = h;
        return () => {};
      },
      post: (m: ParentToIframe) => rec.posts.push(m),
      target: opts.target,
    };
  },
}));

void mock.module("../src/canvas/canvas-live-render", () => ({
  resolveCanvasDocument: () =>
    Promise.resolve({
      docBase: "http://localhost:3000/doc.json",
      mapperCtx: {
        arrayPaths: [],
        canvasMode: "design",
        layoutWrapped: false,
        pageContentOffset: null,
        pageContentPrefix: null,
      },
      renderDoc: { children: ["hi"], tagName: "div" },
      siteStyle: null,
    }),
}));

void mock.module("../src/panels/stylebook-panel", () => ({
  renderComponentPreview: async () => document.createElement("div"),
}));

const { mountIframeCanvas, postPatchToHosts, publishAssetVersions } =
  await import("../src/canvas/iframe-host");
const { initShellRefs } = await import("../src/store");

/** The kinds a channel received that matter here, in order. */
function kinds(channel: FakeIframeChannel): string[] {
  return channel.posts
    .map((post) => post.kind)
    .filter((kind) => kind === "assetVersions" || kind === "render" || kind === "patch");
}

/** The `assetVersions` payloads a channel received, oldest first. */
function versionPosts(channel: FakeIframeChannel): Readonly<Record<string, string>>[] {
  return channel.posts.flatMap((post) => (post.kind === "assetVersions" ? [post.versions] : []));
}

/**
 * The artboard record a finished live render leaves on the stage, every DOM slot filled by the one
 * canvas element. The host only finds a panel by its `canvas` (`panelHostingCanvas`), so that is
 * the field these tests depend on; the rest makes the record a whole `CanvasPanel`.
 */
function readyPanel(canvasEl: HTMLElement): CanvasPanel {
  return {
    _width: null,
    canvas: canvasEl,
    element: canvasEl,
    mediaName: "base",
    ready: true,
    renderScope: null,
    scrollContainer: canvasEl,
    viewport: canvasEl,
  };
}

/** The canvas element the last mount appended to `<body>`; throws rather than handing a test null. */
function lastCanvas(): HTMLElement {
  const canvasEl = document.body.lastElementChild;
  if (!(canvasEl instanceof HTMLElement)) {
    throw new TypeError("expected a mounted canvas element at the end of <body>");
  }
  return canvasEl;
}

function learn(path: string, version: string): void {
  noteListing([{ name: path, path, type: "file", version }], beginListing());
}

/** Mount one host for `tabId` on the primary stage; the frame has not said `ready` yet. */
async function mountQueued(tabId: string, gen = 1): Promise<FakeIframeChannel> {
  const canvasEl = document.createElement("div");
  document.body.append(canvasEl);
  const surface = surfaceForPane("primary");
  surface.renderGeneration = gen;
  surface.panels.push(readyPanel(canvasEl));
  await mountIframeCanvas(gen, { tagName: "div" }, canvasEl, null, tabId);
  return channels.at(-1)!;
}

beforeEach(() => {
  channels.length = 0;
  document.body.innerHTML = "";
  initShellRefs();
  registerPrimaryStage();
  surfaceForPane("primary").panels.length = 0;
  resetAssetVersions();
});

describe("asset versions reach the frame", () => {
  test("on ready, ahead of the render that was queued while the frame booted", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t1" });
    learn("public/hero.png", "abc");
    const channel = await mountQueued(tab.id);
    expect(kinds(channel)).toEqual([]);
    channel.deliver({ kind: "ready" });
    expect(kinds(channel)).toEqual(["assetVersions", "render"]);
    expect(versionPosts(channel)).toEqual([{ "public/hero.png": "abc" }]);
  });

  test("a host that has no versions to send sends nothing at all", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t2" });
    const channel = await mountQueued(tab.id);
    channel.deliver({ kind: "ready" });
    expect(kinds(channel)).toEqual(["render"]);
    // And a later render with the map still empty sends nothing either.
    publishAssetVersions();
    expect(versionPosts(channel)).toEqual([]);
  });

  /* A project switch reuses a ready frame (same pane, same canvas mode) and resets the map. An
     empty map reset to empty must keep its identity, or the next render pays a message for nothing
     on exactly the hosts that never version anything. */
  test("emptying an already-empty map sends nothing to a ready frame", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t2b" });
    const canvasEl = document.createElement("div");
    document.body.append(canvasEl);
    const surface = surfaceForPane("primary");
    surface.renderGeneration = 1;
    surface.panels.push(readyPanel(canvasEl));
    await mountIframeCanvas(1, { tagName: "div" }, canvasEl, null, tab.id);
    const channel = channels.at(-1)!;
    channel.deliver({ kind: "ready" });
    channel.deliver({ gen: 1, kind: "renderComplete" });

    resetAssetVersions();
    expect(postPatchToHosts([], tab.id)).toBe(1);
    await mountIframeCanvas(2, { tagName: "div" }, canvasEl, null, tab.id);
    await flush();
    expect(versionPosts(channel)).toEqual([]);
  });

  test("a version change is reposted, coalesced, without waiting for a render", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t3" });
    const channel = await mountQueued(tab.id);
    channel.deliver({ kind: "ready" });
    learn("public/a.png", "1");
    learn("public/b.png", "2");
    await flush();
    // Two listings, one message: the watcher waits a microtask for company.
    expect(versionPosts(channel)).toEqual([{ "public/a.png": "1", "public/b.png": "2" }]);
    // Nothing moved, so nothing is reposted.
    publishAssetVersions();
    expect(versionPosts(channel)).toHaveLength(1);
  });

  test("a render or patch posted right after a forget carries the newer map first", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t4" });
    learn("public/hero.png", "old");
    const channel = await mountQueued(tab.id);
    channel.deliver({ kind: "ready" });
    channel.deliver({ gen: 1, kind: "renderComplete" });
    channel.posts.length = 0;

    // The forget lands and a patch goes out in the same tick — before the coalesced repost.
    forgetVersions(["public/hero.png"]);
    expect(postPatchToHosts([], tab.id)).toBe(1);
    expect(kinds(channel)).toEqual(["assetVersions", "patch"]);
    expect(versionPosts(channel)).toEqual([{}]);

    // Same for a full render.
    channel.posts.length = 0;
    learn("public/hero.png", "new");
    await mountIframeCanvas(2, { tagName: "div" }, lastCanvas(), null, tab.id);
    expect(kinds(channel)).toEqual(["assetVersions", "render"]);
    expect(versionPosts(channel)).toEqual([{ "public/hero.png": "new" }]);
    // The coalesced repost finds the frame already current.
    await flush();
    expect(versionPosts(channel)).toHaveLength(1);
  });

  test("a frame that says ready again has rebooted, and is sent the map again", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t5" });
    learn("public/hero.png", "abc");
    const channel = await mountQueued(tab.id);
    channel.deliver({ kind: "ready" });
    channel.deliver({ kind: "ready" });
    expect(versionPosts(channel)).toEqual([
      { "public/hero.png": "abc" },
      { "public/hero.png": "abc" },
    ]);
  });

  test("a frame that was removed from the page is dropped, not posted to", async () => {
    const tab = resetWorkspaceWithTab({ tagName: "div" }, { id: "t6" });
    const channel = await mountQueued(tab.id);
    channel.deliver({ kind: "ready" });
    document.body.innerHTML = "";
    learn("public/hero.png", "abc");
    publishAssetVersions();
    expect(versionPosts(channel)).toEqual([]);
  });
});
