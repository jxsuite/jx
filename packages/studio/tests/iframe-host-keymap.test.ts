/**
 * The host half of the keymap sync: the chord table reaches every live frame, and reaches it again
 * whenever the author rebinds a key.
 *
 * The frame cannot see the registry, so it holds a COPY — and a copy with no invalidation is a
 * second authority that drifts. That is what the three hand-written lists in
 * `canvas/iframe-keys.ts` were, and what made rebinding ⌘B in Preferences leave the canvas bound to
 * the old chord for ever. These cases pin the two moments the copy is refreshed: a frame becoming
 * ready, and a keymap change.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { registerPrimaryStage, resetWorkspaceWithTab } from "./harness";
import type { FakeIframeChannel } from "./harness";
import { surfaceForPane } from "../src/canvas/surface-registry";
import type { postMessageChannel } from "../src/canvas/iframe-channel";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";
import type { CanvasPanel } from "../src/types";

/* SAFETY: `./with-dom.js`, imported first, registers happy-dom's GlobalRegistrator, which copies the
   window's members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

const channels: FakeIframeChannel[] = [];

void mock.module("../src/canvas/iframe-channel", () => ({
  postMessageChannel: (
    opts: Parameters<typeof postMessageChannel<ParentToIframe, IframeToParent>>[0],
  ) => {
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

const { mountIframeCanvas, publishKeymap, setKeymapSource } =
  await import("../src/canvas/iframe-host");
const { initShellRefs } = await import("../src/store");

/** Every `keymap` message a channel received, newest last. */
function keymapPosts(channel: FakeIframeChannel): Extract<ParentToIframe, { kind: "keymap" }>[] {
  return channel.posts.filter(
    (post): post is Extract<ParentToIframe, { kind: "keymap" }> => post.kind === "keymap",
  );
}

/** An artboard record carrying only the members a test names. */
function artboard(fields: Pick<CanvasPanel, "canvas"> & Partial<CanvasPanel>): CanvasPanel {
  /* SAFETY: this suite never renders a stage. The host reaches an artboard here only through
     `panelHostingCanvas`, which matches on `canvas` and hands back the owning surface whose
     `renderGeneration` gates the render; `ready` is carried for parity with a mounted artboard. The
     bound DOM members (`element`, `viewport`, `scrollContainer`), `_width` and `renderScope` are read
     by the stage render and teardown, neither of which runs in this suite. */
  return fields as CanvasPanel;
}

/** Mount one host and take it to `ready`, which is when the table is due. */
async function mountReady(): Promise<FakeIframeChannel> {
  const canvasEl = document.createElement("div");
  document.body.append(canvasEl);
  const surface = surfaceForPane("primary");
  surface.renderGeneration = 1;
  surface.panels.push(artboard({ canvas: canvasEl, ready: true }));
  await mountIframeCanvas(1, { tagName: "div" }, canvasEl);
  const channel = channels.at(-1)!;
  channel.deliver({ kind: "ready" });
  return channel;
}

beforeEach(() => {
  channels.length = 0;
  document.body.innerHTML = "";
  initShellRefs();
  registerPrimaryStage();
  resetWorkspaceWithTab({ tagName: "div" });
});

describe("setKeymapSource", () => {
  /* This case must stay FIRST. The source is module state with no public reset, and every later
     case installs one, so only before them is the host in the state Studio boots in: no source. */
  test("publishing with no source posts nothing rather than an empty table", async () => {
    // An empty table means "forward nothing", so publishing one by accident would make the canvas
    // Keyboard go silent — worse than not publishing at all.
    const channel = await mountReady();
    publishKeymap();
    expect(keymapPosts(channel)).toEqual([]);
  });

  test("a frame is handed the table the moment it says it is ready", async () => {
    setKeymapSource(() => ({ chords: [{ chord: "mod+s", scope: "global" }], mac: false }));
    const channel = await mountReady();
    expect(keymapPosts(channel)).toEqual([
      { chords: [{ chord: "mod+s", scope: "global" }], kind: "keymap", mac: false },
    ]);
  });

  test("the table is READ on every publish, never captured", async () => {
    // The whole point of a source rather than a value: the registry is the one authority, and the
    // Host asks it again rather than holding what it was told once.
    let chords: { chord: string; scope: "caret" | "canvas" | "global" }[] = [
      { chord: "mod+s", scope: "global" },
    ];
    setKeymapSource(() => ({ chords, mac: false }));
    const channel = await mountReady();
    chords = [{ chord: "mod+b", scope: "caret" as const }];
    publishKeymap();
    expect(keymapPosts(channel).at(-1)).toEqual({
      chords: [{ chord: "mod+b", scope: "caret" }],
      kind: "keymap",
      mac: false,
    });
  });

  test("a keymap change reposts to every live frame — this is what rebinding needs", async () => {
    let notify = (): void => {};
    setKeymapSource(
      () => ({ chords: [{ chord: "mod+b", scope: "caret" }], mac: true }),
      (listener) => {
        notify = listener;
        return () => {};
      },
    );
    const channel = await mountReady();
    const before = keymapPosts(channel).length;
    notify();
    expect(keymapPosts(channel).length).toBe(before + 1);
  });
});
