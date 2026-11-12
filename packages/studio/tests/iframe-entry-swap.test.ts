import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { documentStyleText, resetDocumentStyles } from "@jxsuite/runtime";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { flush } from "./harness";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import { isEditing, startEditing, stopEditing } from "../src/editor/inline-edit";
import { SITE_STYLE_ID } from "@jxsuite/site/site-style";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";

/*
 * A full render REPLACES a picture, and the frame keeps the old one whole until the new one is
 * ready to stand in for it (§4.1). It used to release the old render's scopes and rules first and
 * only then start the asynchronous build, so the page stood unstyled for as long as that took.
 * Every message posted here is plain JSON: the channel may clone at post time.
 */

type RenderMsg = Extract<ParentToIframe, { kind: "render" }>;

function renderMsg(gen: number, doc: JxMutableNode): RenderMsg {
  return {
    colorScheme: null,
    doc,
    docBase: "http://localhost:3000/",
    gen,
    kind: "render",
    mapperCtx: {
      canvasMode: "design",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    },
    mode: "design",
    shadowDoc: doc,
    siteStyle: null,
  };
}

/** A one-element page whose root carries a rule, so both its handle and its rule are observable. */
function styledDoc(tagName: string, color: string, text: string): JxMutableNode {
  return { children: [{ children: [text], tagName: "p" }], style: { color }, tagName };
}

const GEN1_COLOR = "rgb(1, 1, 1)";
const GEN2_COLOR = "rgb(2, 2, 2)";

/** The container's root element; throws rather than handing a test null. */
function rootOf(container: HTMLElement): HTMLElement {
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("expected a rendered root in the canvas container");
  }
  return root;
}

/** The kinds the frame posted, in order. */
function kinds(acks: IframeToParent[]): string[] {
  return acks.map((m) => m.kind);
}

/** A `fetch` that answers through `answer`, with the global's own `preconnect` beside it. */
function fetchDouble(answer: (input: RequestInfo | URL) => Promise<Response>): typeof fetch {
  return Object.assign(answer, { preconnect: fetch.preconnect });
}

/**
 * Hold a component document's fetch open. `registerElements` awaits it inside the asynchronous half
 * of a render, so a document naming `name` stays pending until `release()`.
 */
function holdComponent(name: string) {
  const realFetch = globalThis.fetch;
  let open: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  globalThis.fetch = fetchDouble(async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes(name)) {
      return new Response("", { status: 404 });
    }
    await gate;
    return Response.json({ children: [{ children: ["held"], tagName: "span" }], tagName: name });
  });
  return {
    release: () => open?.(),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

let teardown: (() => void) | undefined;
let restoreFetch: (() => void) | undefined;
afterEach(() => {
  if (isEditing()) {
    stopEditing();
  }
  teardown?.();
  teardown = undefined;
  restoreFetch?.();
  restoreFetch = undefined;
  document.body.innerHTML = "";
});

/** A frame that has drawn `doc` at generation 1, with the acks it posted from then on. */
async function bootRendered(doc: JxMutableNode) {
  // Adopted rules live on the document and outlive the per-test body reset.
  resetDocumentStyles();
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const acks: IframeToParent[] = [];
  pair.parent.onMessage((m) => acks.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  teardown = startCanvasIframe({ channel: pair.iframe, container });
  pair.parent.post(renderMsg(1, doc));
  pair.flush();
  await flush();
  pair.flush();
  acks.length = 0;
  return { acks, container, pair };
}

describe("a full render swaps pictures, never strips one", () => {
  test("a second full render keeps the previous picture until the new tree is attached", async () => {
    const { container, pair } = await bootRendered(styledDoc("section", GEN1_COLOR, "one"));
    const oldRoot = rootOf(container);
    const handleId = oldRoot.dataset.jx;
    expect(handleId).toBeTruthy();
    expect(documentStyleText()).toContain(GEN1_COLOR);

    pair.parent.post(renderMsg(2, styledDoc("article", GEN2_COLOR, "two")));
    pair.flush(); // Delivered, and deliberately not awaited: the new tree is still being built.

    expect(container.firstElementChild).toBe(oldRoot);
    expect(oldRoot.dataset.jx).toBe(handleId);
    expect(documentStyleText()).toContain(GEN1_COLOR);

    await flush();

    const newRoot = rootOf(container);
    expect(newRoot).not.toBe(oldRoot);
    expect(newRoot.tagName).toBe("ARTICLE");
    expect(newRoot.dataset.jx).toBeTruthy();
    const css = documentStyleText();
    expect(css).toContain(GEN2_COLOR);
    expect(css).not.toContain(GEN1_COLOR);
  });

  test("release and swap share one synchronous step", async () => {
    const { container, pair } = await bootRendered(styledDoc("section", GEN1_COLOR, "one"));
    const oldRoot = rootOf(container);

    /* What an observer between tasks can see of the old root while it is still the picture. A
       paint is exactly such an observer, and no test DOM has one, so this samples at every
       microtask and macrotask boundary the test can reach instead. */
    const whileAttached: { handle: boolean; rule: boolean }[] = [];
    const sample = () => {
      if (container.firstElementChild === oldRoot) {
        whileAttached.push({
          handle: oldRoot.dataset.jx !== undefined,
          rule: documentStyleText().includes(GEN1_COLOR),
        });
      }
    };

    const swaps: { attached: Node | string; leaving: Element | null }[] = [];
    const swapped = () => swaps.length > 0;
    const original = container.replaceChildren.bind(container);
    container.replaceChildren = (...nodes: (Node | string)[]) => {
      swaps.push({ attached: nodes[0] ?? "", leaving: container.firstElementChild });
      original(...nodes);
    };

    try {
      pair.parent.post(renderMsg(2, styledDoc("article", GEN2_COLOR, "two")));
      pair.flush();
      for (let turn = 0; turn < 20 && !swapped(); turn++) {
        for (let tick = 0; tick < 20 && !swapped(); tick++) {
          sample();
          // oxlint-disable-next-line no-await-in-loop -- the sampling IS the sequence of ticks
          await Promise.resolve();
        }
        // oxlint-disable-next-line no-await-in-loop -- one macrotask per turn, in order
        await flush(1);
      }
    } finally {
      container.replaceChildren = original;
    }

    // One swap, and it is the old root leaving for the new one.
    expect(swaps).toHaveLength(1);
    expect(swaps[0]?.leaving).toBe(oldRoot);
    const newRoot = rootOf(container);
    expect(swaps[0]?.attached).toBe(newRoot);
    expect(newRoot.tagName).toBe("ARTICLE");
    // Every look at the old root while it was on screen found it whole.
    expect(whileAttached.length).toBeGreaterThan(0);
    expect(whileAttached.filter((seen) => !seen.handle || !seen.rule)).toEqual([]);
    // And the release did happen, in the step that detached it.
    expect(oldRoot.dataset.jx).toBeUndefined();
    expect(documentStyleText()).not.toContain(GEN1_COLOR);
  });

  test("a superseded render never touches the DOM", async () => {
    const { acks, container, pair } = await bootRendered({ children: ["zero"], tagName: "div" });
    const held = holdComponent("swap-superseded-el");
    restoreFetch = held.restore;

    // Generation 2 waits on its component; generation 3 has nothing to wait on.
    pair.parent.post(
      renderMsg(2, {
        $elements: [{ $ref: "./swap-superseded-el.json" }],
        children: [{ children: ["slow"], tagName: "p" }],
        tagName: "article",
      }),
    );
    pair.flush();
    await flush();
    pair.parent.post(renderMsg(3, styledDoc("section", GEN2_COLOR, "fast")));
    pair.flush();
    await flush();
    const liveRoot = rootOf(container);
    expect(liveRoot.tagName).toBe("SECTION");

    held.release();
    await flush(4);
    pair.flush();

    expect(container.firstElementChild).toBe(liveRoot);
    expect(container.querySelector("article")).toBeNull();
    expect(liveRoot.dataset.jx).toBeTruthy();
    expect(documentStyleText()).toContain(GEN2_COLOR);
    expect(acks.filter((m) => m.kind === "renderComplete")).toEqual([
      { gen: 3, kind: "renderComplete" },
    ]);
    expect(kinds(acks)).not.toContain("renderError");

    // The live generation is still the one patches are applied against.
    acks.length = 0;
    pair.parent.post({
      forwardOps: [{ key: "textContent", op: "set-key", path: ["children", 0], value: "patched" }],
      gen: 3,
      kind: "patch",
    });
    pair.flush();
    pair.flush();
    expect(liveRoot.querySelector("p")?.textContent).toBe("patched");
    expect(acks).toEqual([{ gen: 3, kind: "patchComplete" }]);
  });

  /** The site-style sheet's text, as the frame last wrote it. */
  const siteCss = () => document.querySelector(`#${SITE_STYLE_ID}`)?.textContent ?? "";

  /** A render of a page that waits on `name`, carrying `brand` as the site's `--brand`. */
  const heldRender = (gen: number, name: string, brand: string): RenderMsg => ({
    ...renderMsg(gen, {
      $elements: [{ $ref: `./${name}.json` }],
      children: [{ children: ["next"], tagName: "p" }],
      tagName: "article",
    }),
    siteStyle: { "--brand": brand },
  });

  test("a site-style update that arrives while a render builds outlives its commit", async () => {
    const { container, pair } = await bootRendered({ children: ["zero"], tagName: "div" });
    const held = holdComponent("swap-site-style-el");
    restoreFetch = held.restore;

    pair.parent.post(heldRender(2, "swap-site-style-el", "red"));
    pair.flush();
    await flush();
    // The token edit lands on the standing tree at once, as it always did.
    pair.parent.post({ kind: "siteStyleUpdate", media: {}, siteStyle: { "--brand": "blue" } });
    pair.flush();
    expect(siteCss()).toContain("blue");

    held.release();
    await flush(4);

    // The commit wrote its own, older style; the update is written back over it in the same step.
    expect(rootOf(container).tagName).toBe("ARTICLE");
    const committed = siteCss();
    expect(committed).toContain("blue");
    expect(committed).not.toContain("red");
  });

  test("a render posted after a site-style update carries the newer style, and wins", async () => {
    const { container, pair } = await bootRendered({ children: ["zero"], tagName: "div" });
    const held = holdComponent("swap-site-style-later-el");
    restoreFetch = held.restore;

    pair.parent.post({ kind: "siteStyleUpdate", media: {}, siteStyle: { "--brand": "blue" } });
    pair.parent.post(heldRender(2, "swap-site-style-later-el", "green"));
    pair.flush();
    await flush();
    held.release();
    await flush(4);

    expect(rootOf(container).tagName).toBe("ARTICLE");
    const committed = siteCss();
    expect(committed).toContain("green");
    expect(committed).not.toContain("blue");
  });

  test("a render that fails leaves the previous picture whole and patchable", async () => {
    const { acks, container, pair } = await bootRendered(styledDoc("section", GEN1_COLOR, "one"));
    const oldRoot = rootOf(container);
    const handleId = oldRoot.dataset.jx;

    // A Function entry declaring both `body` and `$src` is refused while the scope is built.
    pair.parent.post(
      renderMsg(2, {
        children: ["never drawn"],
        state: { broken: { $prototype: "Function", $src: "./broken.js", body: "return 1" } },
        tagName: "article",
      }),
    );
    pair.flush();
    await flush();
    pair.flush();

    expect(acks.filter((m) => m.kind === "renderError").map((m) => m.gen)).toEqual([2]);
    expect(kinds(acks)).not.toContain("renderComplete");
    expect(container.firstElementChild).toBe(oldRoot);
    expect(oldRoot.dataset.jx).toBe(handleId);
    expect(documentStyleText()).toContain(GEN1_COLOR);

    // Generation 1 is still what is drawn, so a patch at generation 1 still lands.
    acks.length = 0;
    pair.parent.post({
      forwardOps: [{ key: "textContent", op: "set-key", path: ["children", 0], value: "patched" }],
      gen: 1,
      kind: "patch",
    });
    pair.flush();
    pair.flush();
    expect(oldRoot.querySelector("p")?.textContent).toBe("patched");
    expect(acks).toEqual([{ gen: 1, kind: "patchComplete" }]);
  });

  test("a full render does not leak a component's internal rules", async () => {
    const INTERNAL_COLOR = "rgb(7, 7, 7)";
    const doc = (): JxMutableNode => ({
      $elements: [
        {
          children: [{ children: ["inside"], style: { color: INTERNAL_COLOR }, tagName: "span" }],
          tagName: "swap-leak-card",
        },
      ],
      children: [{ tagName: "swap-leak-card" }],
      tagName: "div",
    });
    const { acks, container, pair } = await bootRendered(doc());
    await flush(); // The instance draws its internals from its own connection callback.
    expect(container.querySelector("swap-leak-card span")?.textContent).toBe("inside");
    const afterFirst = documentStyleText();
    expect(afterFirst).toContain(INTERNAL_COLOR);

    pair.parent.post(renderMsg(2, doc()));
    pair.flush();
    await flush();
    await flush();
    pair.flush();

    expect(kinds(acks)).toContain("renderComplete");
    expect(container.querySelector("swap-leak-card span")?.textContent).toBe("inside");
    expect(documentStyleText()).toBe(afterFirst);

    /* Equal text is not enough on its own: rules are shared by reference count, so an instance
       nobody released holds its rule without changing a character of the sheet. A page that no
       longer draws the component is where that reference shows. */
    pair.parent.post(renderMsg(3, { children: ["plain"], tagName: "div" }));
    pair.flush();
    await flush();
    expect(container.querySelector("swap-leak-card")).toBeNull();
    expect(documentStyleText()).not.toContain(INTERNAL_COLOR);
  });

  test("a caret opened while a render is pending is committed before the swap", async () => {
    const { acks, container, pair } = await bootRendered({
      children: [{ children: ["Hi"], tagName: "p" }],
      tagName: "div",
    });
    const held = holdComponent("swap-caret-el");
    restoreFetch = held.restore;

    pair.parent.post(
      renderMsg(2, {
        $elements: [{ $ref: "./swap-caret-el.json" }],
        children: [{ children: ["Hi"], tagName: "p" }],
        tagName: "div",
      }),
    );
    pair.flush();
    await flush();

    // The old tree is still live, so the author can still put a caret in it and type.
    const oldBlock = container.querySelector("p");
    if (!oldBlock) {
      throw new Error("expected the previous render's paragraph to still be drawn");
    }
    startEditing(oldBlock, ["children", 0], {
      onCommit: (path, children, textContent) => {
        pair.iframe.post({ children, kind: "editCommit", path, textContent });
      },
      onEnd: () => {
        pair.iframe.post({ kind: "editEnd" });
      },
      onInsert: () => {},
      onSplit: () => {},
    });
    oldBlock.textContent = "typed";
    expect(isEditing()).toBe(true);

    held.release();
    await flush(4);
    pair.flush();

    expect(isEditing()).toBe(false);
    expect(container.querySelector("p")).not.toBe(oldBlock);
    const order = kinds(acks);
    const commitAt = order.indexOf("editCommit");
    expect(commitAt).toBeGreaterThanOrEqual(0);
    // FIFO: the commit reaches the parent before the ack that says the DOM under it is gone.
    expect(order.indexOf("renderComplete")).toBeGreaterThan(commitAt);
    expect(acks[commitAt]).toMatchObject({ path: ["children", 0], textContent: "typed" });
  });
});
