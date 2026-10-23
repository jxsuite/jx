/**
 * Tests for src/browse/library-preview.ts — the LRU and the visibility gate.
 *
 * The predecessor's preview map was unbounded and eager, so a 300-page project built 300 live
 * runtime subtrees on one paint and never released one. Both halves of that are asserted here: the
 * cap holds, and an evicted subtree leaves the DOM.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { identities } from "@jxsuite/test-support/inspect-dom";
import { setFormats } from "../src/format/format-host";
import type { StudioFormat } from "../src/format/format-host";
import type { ComponentEntry } from "../src/files/components";
import type { JsonValue } from "@jxsuite/schema/types";

/** Swapped per test — the module export itself is frozen once mocked. */
let componentPreview: () => Promise<HTMLElement> = () => {
  const el = document.createElement("div");
  el.className = "component-preview";
  return Promise.resolve(el);
};

/** The props each instance preview was given, newest last. */
const previewProps: ReadonlyMap<string, JsonValue>[] = [];

void mock.module("../src/panels/component-preview.js", () => ({
  defineComponent: () => Promise.resolve(true),
  renderComponentPreview: (
    _comp: ComponentEntry,
    props: ReadonlyMap<string, JsonValue> = new Map(),
  ) => {
    previewProps.push(props);
    return componentPreview();
  },
}));

/** What the example sources answer, swapped per test (`component-examples.ts` has its own suite). */
let exampleProps = new Map<string, JsonValue>();

void mock.module("../src/browse/component-examples.js", () => ({
  componentExampleProps: () => exampleProps,
}));

const {
  PREVIEW_CACHE_LIMIT,
  createPreviewCache,
  createPreviewObserver,
  previewFor,
  renderDocPreview,
} = await import("../src/browse/library-preview");
const { componentRegistry } = await import("../src/files/components");

function element(id: string) {
  const el = document.createElement("div");
  el.dataset.id = id;
  return el;
}

beforeEach(() => {
  installMockPlatform({}, { "pages/index.json": '{"tagName":"section","children":[]}' });
  resetStudioState({ projectConfig: null, projectDirs: [] });
  componentRegistry.length = 0;
  previewProps.length = 0;
  exampleProps = new Map<string, JsonValue>();
  componentPreview = () => {
    const el = document.createElement("div");
    el.className = "component-preview";
    return Promise.resolve(el);
  };
});

describe("createPreviewCache", () => {
  test("evicts the least-recently-used entry once it is over the limit", () => {
    const cache = createPreviewCache(2);
    cache.set("a", element("a"));
    cache.set("b", element("b"));
    cache.set("c", element("c"));
    expect(cache.size()).toBe(2);
    expect(cache.keys()).toEqual(["b", "c"]);
    expect(cache.has("a")).toBe(false);
  });

  test("a read is a use — the oldest key moves", () => {
    const cache = createPreviewCache(2);
    cache.set("a", element("a"));
    cache.set("b", element("b"));
    cache.get("a");
    cache.set("c", element("c"));
    expect(cache.keys()).toEqual(["a", "c"]);
  });

  test("an evicted subtree leaves the DOM, or the cap would not bound anything", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const cache = createPreviewCache(1);
    const first = element("a");
    host.append(first);
    cache.set("a", first);
    cache.set("b", element("b"));
    expect(first.isConnected).toBe(false);
    host.remove();
  });

  test("re-setting a key replaces rather than duplicating", () => {
    const cache = createPreviewCache(4);
    cache.set("a", element("a1"));
    cache.set("a", element("a2"));
    expect(cache.size()).toBe(1);
    expect(cache.get("a")?.dataset.id).toBe("a2");
  });

  test("clear detaches everything it was holding", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const cache = createPreviewCache();
    const el = element("a");
    host.append(el);
    cache.set("a", el);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(el.isConnected).toBe(false);
    host.remove();
  });

  test("a miss is undefined, not a thrown key error", () => {
    expect(createPreviewCache().get("nope")).toBeUndefined();
  });

  test("the default limit is the committed cap", () => {
    expect(PREVIEW_CACHE_LIMIT).toBe(150);
    const cache = createPreviewCache();
    for (let i = 0; i < PREVIEW_CACHE_LIMIT + 10; i++) {
      cache.set(`k${i}`, element(`k${i}`));
    }
    expect(cache.size()).toBe(PREVIEW_CACHE_LIMIT);
  });
});

const MARKDOWN: StudioFormat = {
  capabilities: {
    parse: { identifier: "parse", timing: ["server"] },
    serialize: { identifier: "serialize", timing: ["server"] },
  },
  documentKinds: ["content", "page"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "Markdown",
  remote: false,
  studio: {},
};

describe("renderDocPreview", () => {
  test("a formatted document goes through the format's parser, not JSON.parse", async () => {
    setFormats([MARKDOWN]);
    const actions: string[] = [];
    installMockPlatform(
      {
        formatAction: (payload) => {
          actions.push(payload.action);
          return Promise.resolve({ children: [], tagName: "article" });
        },
      },
      { "content/post.md": "# Hi" },
    );
    try {
      const rendered = await renderDocPreview("content/post.md");
      // The Markdown body is never valid JSON, so reaching a render at all proves the parser ran.
      expect(actions).toContain("parse");
      expect(rendered).not.toBeNull();
    } finally {
      setFormats([]);
    }
  });

  test("renders a JSON document to a detached element", async () => {
    const rendered = await renderDocPreview("pages/index.json");
    expect(rendered).not.toBeNull();
    expect(rendered!.tagName.toLowerCase()).toBe("section");
  });

  /* The Library is where most versions are learned and the screen with the most images, so its
     previews must use them exactly as the canvas does. */
  test("a repo-space preview requests the media a listing vouched for by version", async () => {
    const { beginListing, noteListing, resetAssetVersions } =
      await import("../src/files/asset-versions");
    // The host's file base is resolved against the page, so the page needs a real URL.
    /* SAFETY: the harness registers happy-dom's GlobalRegistrator, which copies the window's members
       onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
    const { happyDOM } = globalThis as typeof globalThis & {
      happyDOM?: { setURL: (u: string) => void };
    };
    happyDOM?.setURL("https://h.example/");
    installMockPlatform(
      { assetSpace: "repo", documentBaseUrl: "https://h.example/raw/" },
      {
        "pages/index.json": JSON.stringify({
          children: [
            { attributes: { src: "/hero.png" }, tagName: "img" },
            { attributes: { src: "/plain.png" }, tagName: "img" },
          ],
          tagName: "section",
        }),
      },
    );
    resetAssetVersions();
    noteListing(
      [{ name: "hero.png", path: "public/hero.png", type: "file", version: "abc" }],
      beginListing(),
    );
    try {
      const rendered = await renderDocPreview("pages/index.json");
      const srcs = [...rendered!.querySelectorAll("img")].map((img) => img.getAttribute("src"));
      expect(srcs).toEqual([
        "https://h.example/raw/public/hero.png?v=abc",
        "https://h.example/raw/public/plain.png",
      ]);
    } finally {
      resetAssetVersions();
    }
  });

  /* A desktop server gates its dev proxy on the token the canvas URL carries, and a page's `$src`
     is relative to the page. Previews used the shell's URL for both, so every class on a previewed
     page was refused (403) and resolved against `/__studio__/` besides. */
  test("a page's $src class resolves against the page, with the canvas's dev-proxy token", async () => {
    const { setResolveToken } = await import("@jxsuite/runtime");
    /* SAFETY: as above — happy-dom's GlobalRegistrator puts `happyDOM` on globalThis. */
    const { happyDOM } = globalThis as typeof globalThis & {
      happyDOM?: { setURL: (u: string) => void };
    };
    happyDOM?.setURL("http://127.0.0.1:4000/__studio__/index.html");
    installMockPlatform(
      { canvasUrl: "/__studio__/canvas.html?rpcToken=tok" },
      {
        "pages/kb/index.json": JSON.stringify({
          state: { entry: { $prototype: "Entry", $src: "../../lib/Entry.class.json" } },
          tagName: "section",
        }),
      },
    );
    resetStudioState({ projectConfig: null, projectDirs: [], projectRoot: "/abs/site" });
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (resource: RequestInfo | URL, init?: RequestInit) => {
        const url = String(resource);
        requests.push({ init, url });
        return Promise.resolve(
          url.includes("/__jx_resolve__")
            ? Response.json({ ok: true })
            : new Response("missing", { status: 404 }),
        );
      },
      { preconnect: realFetch.preconnect },
    );
    try {
      expect(await renderDocPreview("pages/kb/index.json")).not.toBeNull();
      expect(requests.map((r) => r.url)).toEqual([
        "http://127.0.0.1:4000//abs/site/lib/Entry.class.json",
        "/__jx_resolve__?token=tok",
      ]);
      expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({
        $base: "http://127.0.0.1:4000//abs/site/pages/kb/index.json",
        $src: "../../lib/Entry.class.json",
      });
    } finally {
      globalThis.fetch = realFetch;
      setResolveToken(null);
    }
  });

  test("a file that cannot be parsed is null, not a Problem", async () => {
    installMockPlatform({}, { "pages/broken.json": "{ not json" });
    expect(await renderDocPreview("pages/broken.json")).toBeNull();
  });

  test("a file that cannot be read is null too", async () => {
    installMockPlatform({ readFile: () => Promise.reject(new Error("gone")) });
    expect(await renderDocPreview("pages/index.json")).toBeNull();
  });
});

describe("previewFor", () => {
  test("caches, so a second ask does no work", async () => {
    const cache = createPreviewCache();
    const first = await previewFor("pages/index.json", cache);
    const second = await previewFor("pages/index.json", cache);
    expect(first).toBe(second!);
    expect(cache.size()).toBe(1);
  });

  test("a registered component previews through the component renderer", async () => {
    componentRegistry.push({
      path: "components/button.json",
      source: "npm",
      tagName: "x-btn",
    });
    const rendered = await previewFor("components/button.json", createPreviewCache());
    expect(rendered?.className).toBe("component-preview");
  });

  test("an unrenderable file caches nothing, so a later fix is picked up", async () => {
    installMockPlatform({}, { "pages/broken.json": "{ not json" });
    const cache = createPreviewCache();
    expect(await previewFor("pages/broken.json", cache)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test("a renderer that throws is absorbed rather than breaking the paint", async () => {
    componentRegistry.push({
      path: "components/bad.json",
      source: "npm",
      tagName: "x-bad",
    });
    componentPreview = () => {
      throw new Error("boom");
    };
    expect(await previewFor("components/bad.json", createPreviewCache())).toBeUndefined();
  });

  test("a project component that cannot render bare gets no preview, not an uncaught error", async () => {
    // The museum's card formats a date that defaults to "": a RangeError, as the standard says.
    const card = {
      children: [{ tagName: "p", textContent: "${state.opens}" }],
      state: {
        date: "",
        opens: {
          $expression: {
            operator: "call",
            target: { $ref: "window#/Intl/formatDate" },
            value: [{ $ref: "#/state/date" }, "en", { day: "numeric" }],
          },
        },
      },
      tagName: "mu-card",
    };
    installMockPlatform(
      {},
      {
        "components/fine.json": JSON.stringify({
          ...card,
          state: { ...card.state, date: "2026-06-20" },
        }),
        "components/mu-card.json": JSON.stringify(card),
        "components/not-an-object.json": "[]",
      },
    );
    componentRegistry.push(
      { path: "components/mu-card.json", source: "project", tagName: "mu-card" },
      { path: "components/fine.json", source: "project", tagName: "mu-fine" },
    );
    let instances = 0;
    componentPreview = () => {
      instances += 1;
      return Promise.resolve(document.createElement("mu-fine"));
    };
    componentRegistry.push({
      path: "components/not-an-object.json",
      source: "project",
      tagName: "mu-array",
    });
    const cache = createPreviewCache();
    expect(await previewFor("components/not-an-object.json", cache)).toBeUndefined();
    expect(await previewFor("components/mu-card.json", cache)).toBeUndefined();
    // No instance was made for the card that cannot render, so nothing throws where none can catch.
    expect(instances).toBe(0);
    const fine = await previewFor("components/fine.json", cache);
    expect(fine?.tagName).toBe("MU-FINE");
    expect(instances).toBe(1);
  });

  /** A card whose render needs a real date, as the museum's does. */
  const DATED = {
    children: [{ tagName: "p", textContent: "${state.opens}" }],
    state: {
      date: "",
      opens: {
        $expression: {
          operator: "call",
          target: { $ref: "window#/Intl/formatDate" },
          value: [{ $ref: "#/state/date" }, "en", { day: "numeric" }],
        },
      },
    },
    tagName: "mu-dated",
  };

  test("a component that renders with its sample props is drawn with them", async () => {
    installMockPlatform({}, { "components/dated.json": JSON.stringify(DATED) });
    componentRegistry.push({
      path: "components/dated.json",
      source: "project",
      tagName: "mu-dated",
    });
    exampleProps = new Map<string, JsonValue>([["date", "2026-06-20"]]);
    expect(await previewFor("components/dated.json", createPreviewCache())).toBeDefined();
    expect([...(previewProps.at(-1) ?? [])]).toEqual([["date", "2026-06-20"]]);
  });

  test("a project component whose file is gone has no preview", async () => {
    componentRegistry.push({ path: "components/gone.json", source: "project", tagName: "mu-gone" });
    expect(await previewFor("components/gone.json", createPreviewCache())).toBeUndefined();
  });
});

/** The fields of an intersection record the preview gate reads. */
type IntersectionRecords = Pick<IntersectionObserverEntry, "isIntersecting" | "target">[];

/** The members of an IntersectionObserver instance the preview gate calls. */
interface ObserverDouble {
  disconnect: () => void;
  observe: (target: Element) => void;
  unobserve: (target: Element) => void;
}

/**
 * Install a stand-in IntersectionObserver whose instances delegate to `double`, handing each
 * constructed instance's callback to `capture` so a test can fire records at will.
 */
function installObserver(
  double: ObserverDouble,
  capture: (callback: (records: IntersectionRecords) => void) => void = () => {},
): void {
  class FakeIntersectionObserver implements ObserverDouble {
    disconnect = double.disconnect;
    observe = double.observe;
    unobserve = double.unobserve;
    constructor(callback: (records: IntersectionRecords) => void) {
      capture(callback);
    }
  }
  /* SAFETY: createPreviewObserver constructs it with `new`, a records callback and an options bag
     the stand-in ignores, calls only `observe`, `unobserve` and `disconnect` on the instance, and
     reads only `isIntersecting` and `target` off each record the callback receives. */
  globalThis.IntersectionObserver = FakeIntersectionObserver as typeof IntersectionObserver;
}

describe("createPreviewObserver", () => {
  const original = globalThis.IntersectionObserver;

  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  test("with no IntersectionObserver, every observed card is reported at once", () => {
    // @ts-expect-error -- deliberately removing the global to exercise the degraded path
    globalThis.IntersectionObserver = undefined;
    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    const el = element("a");
    observer.observe(el);
    // Nothing was ever watched on this path, so the sweep has nothing to find.
    expect(observer.releaseDetached()).toBe(0);
    observer.destroy();
    expect(identities(seen)).toEqual(identities([el]));
  });

  test("reports a card once, on entry, and stops watching it", () => {
    const observed: Element[] = [];
    const unobserved: Element[] = [];
    let fire: (records: IntersectionRecords) => void = () => {};
    let disconnected = false;
    installObserver(
      {
        disconnect: () => {
          disconnected = true;
        },
        observe: (target) => observed.push(target),
        unobserve: (target) => unobserved.push(target),
      },
      (cb) => {
        fire = cb;
      },
    );

    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    const visible = element("in");
    const offscreen = element("out");
    observer.observe(visible);
    observer.observe(offscreen);
    fire([
      { isIntersecting: true, target: visible },
      { isIntersecting: false, target: offscreen },
    ]);
    expect(identities(seen)).toEqual(identities([visible]));
    expect(identities(unobserved)).toEqual(identities([visible]));
    // Both cards are detached fixtures, so a sweep would take everything still watched. It takes
    // Exactly one: the reported card was already released, and the other was NOT.
    expect(observer.releaseDetached()).toBe(1);
    expect(identities(unobserved)).toEqual(identities([visible, offscreen]));
    observer.destroy();
    expect(disconnected).toBe(true);
    expect(observed.length).toBe(2);
  });

  test("observing the same card twice watches it once — a repaint per scroll frame is not two", () => {
    const observed: Element[] = [];
    installObserver({
      disconnect: () => {},
      observe: (target) => observed.push(target),
      unobserve: () => {},
    });

    const observer = createPreviewObserver(() => {});
    const card = element("a");
    observer.observe(card);
    observer.observe(card);
    observer.observe(card);
    expect(identities(observed)).toEqual(identities([card]));
  });

  /**
   * The leak this API exists for.
   *
   * A card scrolled past before it ever intersected is never reported, so the intersect callback —
   * the only release path there used to be — never runs for it. Left alone the browser walks it on
   * every scroll frame forever, and the retained set grows with how far the reader went.
   */
  test("releaseDetached drops exactly the cards that left the document, and keeps the rest", () => {
    const unobserved: Element[] = [];
    installObserver({
      disconnect: () => {},
      observe: () => {},
      unobserve: (target) => unobserved.push(target),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const observer = createPreviewObserver(() => {});
    const onscreen = element("in-window");
    const scrolledPast = element("gone");
    host.append(onscreen, scrolledPast);
    observer.observe(onscreen);
    observer.observe(scrolledPast);

    // What a repaint does to a card the window has moved off.
    scrolledPast.remove();

    expect(observer.releaseDetached()).toBe(1);
    expect(identities(unobserved)).toEqual(identities([scrolledPast]));
    // Idempotent: the pane calls it after every commit, and most commits detach nothing.
    expect(observer.releaseDetached()).toBe(0);
    expect(identities(unobserved)).toEqual(identities([scrolledPast]));

    // The card still in the window was kept — proven by taking it out and sweeping again.
    onscreen.remove();
    expect(observer.releaseDetached()).toBe(1);
    expect(identities(unobserved)).toEqual(identities([scrolledPast, onscreen]));

    observer.destroy();
    host.remove();
  });
});
