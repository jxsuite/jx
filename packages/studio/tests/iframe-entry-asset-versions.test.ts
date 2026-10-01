/**
 * The frame half of the asset-version sync: the map the host posts is folded into every render's
 * asset context, and a map that arrives between renders reaches the nodes a patch draws.
 *
 * Without the second half a patch would resolve through the resolver the LAST render installed,
 * closed over the map that render had — so a version forgotten since (the bytes changed) could
 * still be written into a freshly patched `<img src>`.
 */
import "./with-dom.js";
import { afterEach, describe, expect, test } from "bun:test";
import { BUILD_LANES } from "@jxsuite/schema/asset-paths";
import { setCanvasAssetResolver } from "@jxsuite/runtime";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { flush } from "./harness";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import type { AssetContext } from "../src/canvas/asset-resolve";
import type { IframeToParent, ParentToIframe } from "../src/canvas/iframe-protocol";

const BASE = "https://studio.example.com/p/o/r/main/raw/";

const REPO: AssetContext = {
  documentDir: "pages",
  fileBaseUrl: BASE,
  lanes: BUILD_LANES,
  mounts: [],
  space: "repo",
};

function renderMsg(gen: number, doc: unknown, assets: AssetContext | null): ParentToIframe {
  return {
    assets,
    colorScheme: null,
    doc,
    docBase: "http://localhost:3000/",
    gen,
    kind: "render",
    mapperCtx: {
      arrayPaths: [],
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

/** A fresh document per render: a patch folds its ops into the shadow doc it was rendered from. */
function imgDoc() {
  return { children: [{ attributes: { src: "/hero.png" }, tagName: "img" }], tagName: "div" };
}

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
  setCanvasAssetResolver(null);
  document.body.innerHTML = "";
});

async function boot() {
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const fromIframe: IframeToParent[] = [];
  pair.parent.onMessage((m) => fromIframe.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  teardown = startCanvasIframe({ channel: pair.iframe, container });
  pair.flush();
  const deliver = async (msg: ParentToIframe) => {
    pair.parent.post(msg);
    pair.flush();
    await flush();
    pair.flush();
  };
  const src = () => container.querySelector("img")?.getAttribute("src");
  return { container, deliver, fromIframe, src };
}

describe("assetVersions in the frame", () => {
  test("a map that arrives before the render versions the render's media", async () => {
    const { deliver, src } = await boot();
    await deliver({ kind: "assetVersions", versions: { "public/hero.png": "abc" } });
    await deliver(renderMsg(1, imgDoc(), REPO));
    expect(src()).toBe(`${BASE}public/hero.png?v=abc`);
  });

  test("with no map, media resolves unversioned, exactly as before versions existed", async () => {
    const { deliver, src } = await boot();
    await deliver(renderMsg(1, imgDoc(), REPO));
    expect(src()).toBe(`${BASE}public/hero.png`);
  });

  test("a later map reaches the next node a patch draws, without a render", async () => {
    const { deliver, fromIframe, src } = await boot();
    await deliver({ kind: "assetVersions", versions: { "public/hero.png": "old" } });
    await deliver(renderMsg(1, imgDoc(), REPO));
    expect(src()).toBe(`${BASE}public/hero.png?v=old`);

    // The version is forgotten (the file changed) and the author re-points the image.
    await deliver({ kind: "assetVersions", versions: { "public/logo.png": "new" } });
    await deliver({
      forwardOps: [
        { key: "attributes", op: "set-key", path: ["children", 0], value: { src: "/logo.png" } },
      ],
      gen: 1,
      kind: "patch",
    });
    expect(fromIframe.some((m) => m.kind === "patchComplete")).toBe(true);
    expect(src()).toBe(`${BASE}public/logo.png?v=new`);
  });

  /*
   * The map arrives between renders, so it only ever reaches the page through a node a later patch
   * draws — which is what these two observe. An assertion on the already-drawn `<img>` could not:
   * the handler never touches existing DOM.
   */
  test("a map with no live asset context installs no resolver", async () => {
    const { deliver, src } = await boot();
    await deliver(renderMsg(1, imgDoc(), null));
    /* A sentinel the handler would have to replace to install anything: if it survives the
       message, the next node a patch draws goes through it. */
    setCanvasAssetResolver((value) => `sentinel:${value}`);
    await deliver({ kind: "assetVersions", versions: { "public/logo.png": "abc" } });
    await deliver({
      forwardOps: [
        { key: "attributes", op: "set-key", path: ["children", 0], value: { src: "/logo.png" } },
      ],
      gen: 1,
      kind: "patch",
    });
    expect(src()).toBe("sentinel:/logo.png");
  });

  test("a repo context from an earlier render does not leak into a context-free one", async () => {
    const { deliver, src } = await boot();
    await deliver(renderMsg(1, imgDoc(), REPO));
    expect(src()).toBe(`${BASE}public/hero.png`);
    // Site space now: the frame's origin answers site URLs, so nothing may be rewritten.
    await deliver(renderMsg(2, imgDoc(), null));
    await deliver({ kind: "assetVersions", versions: { "public/logo.png": "abc" } });
    await deliver({
      forwardOps: [
        { key: "attributes", op: "set-key", path: ["children", 0], value: { src: "/logo.png" } },
      ],
      gen: 2,
      kind: "patch",
    });
    expect(src()).toBe("/logo.png");
  });

  /* The map is a structured clone, so a path named after an `Object.prototype` member would read
     the prototype's member as its version unless the lookup is own-keys only. */
  test("a ref named after an Object.prototype member gets no version", async () => {
    const { container, deliver } = await boot();
    await deliver({ kind: "assetVersions", versions: { "public/hero.png": "abc" } });
    const doc = {
      children: [
        { attributes: { src: "constructor" }, tagName: "img" },
        { attributes: { src: "./toString" }, tagName: "img" },
      ],
      tagName: "div",
    };
    // A root-level document, so each ref's project path IS the bare member name.
    await deliver(renderMsg(1, doc, { ...REPO, documentDir: "" }));
    const srcs = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual([`${BASE}constructor`, `${BASE}toString`]);
  });

  test("a rebooted frame starts with no map", async () => {
    const first = await boot();
    await first.deliver({ kind: "assetVersions", versions: { "public/hero.png": "abc" } });
    teardown?.();
    const second = await boot();
    await second.deliver(renderMsg(1, imgDoc(), REPO));
    expect(second.src()).toBe(`${BASE}public/hero.png`);
  });
});
