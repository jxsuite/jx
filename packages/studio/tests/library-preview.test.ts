/**
 * Tests for src/browse/library-preview.ts — the LRU, the visibility gate, and the requests a
 * preview makes of the preview realm (`project-state.md` §11.2).
 *
 * The predecessor's preview map was unbounded and eager, so a 300-page project built 300 live
 * runtime subtrees on one paint and never released one. Both halves of that are asserted here: the
 * cap holds, and an evicted snapshot leaves the cards that showed it. The previews themselves are
 * drawn by the realm's own code running in this window (`preview-realm-double.ts`, installed by the
 * harness).
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { identities } from "@jxsuite/test-support/inspect-dom";
import { setFormats } from "../src/format/format-host";
import type { StudioFormat } from "../src/format/format-host";
import type { JsonValue } from "@jxsuite/schema/types";
import type { PreviewSnapshot } from "../src/preview-realm/host";
import type { InProcessRealm } from "./preview-realm-double";

/** What the example sources answer, swapped per test (`component-examples.ts` has its own suite). */
let exampleProps = new Map<string, JsonValue>();

void mock.module("../src/browse/component-examples.js", () => ({
  componentExampleProps: () => exampleProps,
}));

const {
  PREVIEW_CACHE_LIMIT,
  createPreviewCache,
  createPreviewObserver,
  evictPreview,
  invalidatePreviews,
  onPreviewsInvalidated,
  previewEpoch,
  previewComponentSetMoved,
  previewDefinitionsMoved,
  previewFor,
  renderDocPreview,
} = await import("../src/browse/library-preview");
const { rendersWith } = await import("../src/preview-realm/ask");
const { mountPreview, shownPreview } = await import("../src/browse/preview-root");
const { setPreviewRealmFactory } = await import("../src/preview-realm/client");
const { inProcessRealm } = await import("./preview-realm-double");
const { componentRegistry } = await import("../src/files/components");
const { setProjectState } = await import("../src/store");

/** A snapshot whose markup names it. */
function element(id: string): PreviewSnapshot {
  return { html: `<div data-id="${id}"></div>`, sheet: null };
}

/** A card element, as a surface draws one for the observer to watch. */
function cardEl(id: string): HTMLElement {
  const el = document.createElement("div");
  el.dataset.id = id;
  return el;
}

/** The markup a snapshot holds, parsed into a detached element to be read. */
function drawn(snapshot: PreviewSnapshot | null | undefined): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = snapshot?.html ?? "";
  return holder;
}

/** An island showing `snapshot`, in the document. */
function shownIn(snapshot: PreviewSnapshot): HTMLElement {
  const island = document.createElement("div");
  document.body.append(island);
  mountPreview(island, snapshot);
  return island;
}

beforeEach(() => {
  installMockPlatform({}, { "pages/index.json": '{"tagName":"section","children":[]}' });
  resetStudioState({ projectConfig: null, projectDirs: [] });
  componentRegistry.length = 0;
  exampleProps = new Map<string, JsonValue>();
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

  test("an evicted snapshot leaves the cards that showed it, so they ask again", () => {
    const cache = createPreviewCache(1);
    const first = element("a");
    const island = shownIn(first);
    cache.set("a", first);
    cache.set("b", element("b"));
    expect(shownPreview(island)).toBeNull();
    expect(island.shadowRoot?.childElementCount).toBe(0);
    island.remove();
  });

  test("re-setting a key replaces rather than duplicating", () => {
    const cache = createPreviewCache(4);
    cache.set("a", element("a1"));
    cache.set("a", element("a2"));
    expect(cache.size()).toBe(1);
    expect(drawn(cache.get("a")).querySelector<HTMLElement>("[data-id]")?.dataset.id).toBe("a2");
  });

  test("clear takes everything it was holding out of the cards that showed it", () => {
    const cache = createPreviewCache();
    const snapshot = element("a");
    const island = shownIn(snapshot);
    // A card that went on to show something else keeps it.
    const moved = shownIn(snapshot);
    const other = element("other");
    mountPreview(moved, other);
    cache.set("a", snapshot);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(shownPreview(island)).toBeNull();
    expect(shownPreview(moved)).toBe(other);
    island.remove();
    moved.remove();
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

  test("renders a JSON document in the realm, and answers its snapshot", async () => {
    const rendered = await renderDocPreview("pages/index.json");
    expect(rendered).not.toBeNull();
    expect(drawn(rendered).firstElementChild?.localName).toBe("section");
  });

  /* A card draws in the shell document, which already holds the URL, so bytes written in place need
     the key here as well as on the canvas, or the card keeps the old picture until a reload. */
  test("a preview requests a file Studio just wrote through its repaint key", async () => {
    const { noteLocalWrite, resetAssetVersions } = await import("../src/files/asset-versions");
    installMockPlatform(
      {},
      {
        "pages/index.json": JSON.stringify({
          children: [{ attributes: { src: "/hero.png" }, tagName: "img" }],
          tagName: "section",
        }),
      },
    );
    resetAssetVersions();
    /* SAFETY: the harness registers happy-dom's GlobalRegistrator, which copies the window's members
       onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
    const { happyDOM } = globalThis as typeof globalThis & {
      happyDOM?: { setURL: (u: string) => void };
    };
    happyDOM?.setURL("http://127.0.0.1:4000/__studio__/canvas.html");
    const key = noteLocalWrite("public/hero.png")!;
    try {
      const rendered = await renderDocPreview("pages/index.json");
      // Absolute against the realm's own address, so the shell loads what the realm named.
      expect(drawn(rendered).querySelector("img")?.getAttribute("src")).toBe(
        `http://127.0.0.1:4000/hero.png?r=${key}`,
      );
    } finally {
      resetAssetVersions();
    }
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
      const srcs = [...drawn(rendered).querySelectorAll("img")].map((img) =>
        img.getAttribute("src"),
      );
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
     page was refused (403) and resolved against `/__studio__/` besides. The realm takes the token
     off its own URL as it boots (`bootPreviewRealm`); this in-process realm is handed it. */
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
    setResolveToken("tok");
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

  test("a package's component the realm does not define draws a box naming its tag", async () => {
    componentRegistry.push({
      path: "components/button.json",
      props: [{ default: "'primary'", name: "variant" }],
      source: "npm",
      tagName: "x-btn",
    });
    const rendered = await previewFor("components/button.json", createPreviewCache());
    const box = drawn(rendered).querySelector(".jx-preview-fallback");
    expect(box?.textContent).toBe("<x-btn>");
  });

  test("a package's component the realm defines is drawn with its attribute defaults", async () => {
    customElements.define("x-pkg-defined", class extends HTMLElement {});
    componentRegistry.push({
      path: "node_modules/pkg/x.js",
      props: [
        { default: "'primary'", name: "variant" },
        { default: "false", name: "off" },
        { default: "''", name: "empty" },
        { name: "plain" },
      ],
      source: "npm",
      tagName: "x-pkg-defined",
    });
    const rendered = await previewFor("node_modules/pkg/x.js", createPreviewCache());
    const instance = drawn(rendered).querySelector("x-pkg-defined");
    expect(instance?.getAttribute("variant")).toBe("primary");
    expect(instance?.getAttributeNames()).toEqual(["variant"]);
  });

  test("an unrenderable file caches nothing, so a later fix is picked up", async () => {
    installMockPlatform({}, { "pages/broken.json": "{ not json" });
    const cache = createPreviewCache();
    expect(await previewFor("pages/broken.json", cache)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  test("a realm that cannot be made is absorbed rather than breaking the paint", async () => {
    componentRegistry.push({
      path: "components/bad.json",
      source: "npm",
      tagName: "x-bad",
    });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    setPreviewRealmFactory(() => {
      throw new Error("boom");
    });
    try {
      expect(await previewFor("components/bad.json", createPreviewCache())).toBeUndefined();
    } finally {
      setPreviewRealmFactory(inProcessRealm());
      warn.mockRestore();
    }
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
      { path: "components/not-an-object.json", source: "project", tagName: "mu-array" },
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cache = createPreviewCache();
      expect(await previewFor("components/not-an-object.json", cache)).toBeUndefined();
      expect(await previewFor("components/mu-card.json", cache)).toBeUndefined();
      // No instance was made for the card that cannot render: its tag was never even defined.
      expect(customElements.get("mu-card")).toBeUndefined();
      const fine = await previewFor("components/fine.json", cache);
      // The definition names its own tag, which is the element the realm draws.
      expect(drawn(fine).querySelector("mu-card p")?.textContent).toBe("20");
    } finally {
      warn.mockRestore();
    }
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
    const rendered = await previewFor("components/dated.json", createPreviewCache());
    expect(drawn(rendered).querySelector("mu-dated p")?.textContent).toBe("20");
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
    const el = cardEl("a");
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
    const visible = cardEl("in");
    const offscreen = cardEl("out");
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
    const card = cardEl("a");
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
    const onscreen = cardEl("in-window");
    const scrolledPast = cardEl("gone");
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

  test("a failed card on screen waits to LEAVE view before an entry is a retry", () => {
    let fire: (records: IntersectionRecords) => void = () => {};
    const observed: Element[] = [];
    installObserver(
      { disconnect: () => {}, observe: (target) => observed.push(target), unobserve: () => {} },
      (cb) => {
        fire = cb;
      },
    );
    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    const card = cardEl("failed");
    observer.observeAgain(card);
    // Idempotent, as `observe` is.
    observer.observeAgain(card);
    expect(identities(observed)).toEqual(identities([card]));
    // The initial record of a card still on screen is not an entry.
    fire([{ isIntersecting: true, target: card }]);
    expect(seen.length).toBe(0);
    // It leaves, then comes back: that is the retry.
    fire([{ isIntersecting: false, target: card }]);
    expect(seen.length).toBe(0);
    fire([{ isIntersecting: true, target: card }]);
    expect(identities(seen)).toEqual(identities([card]));
    observer.destroy();
  });

  test("a failed card that is released and observed afresh is reported on its first entry", () => {
    let fire: (records: IntersectionRecords) => void = () => {};
    installObserver({ disconnect: () => {}, observe: () => {}, unobserve: () => {} }, (cb) => {
      fire = cb;
    });
    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    const card = cardEl("released");
    observer.observeAgain(card);
    expect(observer.releaseDetached()).toBe(1);
    observer.observe(card);
    fire([{ isIntersecting: true, target: card }]);
    expect(identities(seen)).toEqual(identities([card]));
    observer.destroy();
  });

  test("observing a card parked by observeAgain asks for it now, without waiting for it to leave", () => {
    let fire: (records: IntersectionRecords) => void = () => {};
    const observed: Element[] = [];
    const unobserved: Element[] = [];
    installObserver(
      {
        disconnect: () => {},
        observe: (target) => observed.push(target),
        unobserve: (target) => unobserved.push(target),
      },
      (cb) => {
        fire = cb;
      },
    );
    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    const card = cardEl("parked");
    observer.observeAgain(card);
    // Still on screen: the initial record is skipped, and the card is waiting to leave.
    fire([{ isIntersecting: true, target: card }]);
    expect(seen.length).toBe(0);
    // The inputs moved: the pane asks for the card again. It is let go and observed afresh, so the
    // Browser delivers a new initial record, and that record counts.
    observer.observe(card);
    expect(identities(unobserved)).toEqual(identities([card]));
    expect(identities(observed)).toEqual(identities([card, card]));
    fire([{ isIntersecting: true, target: card }]);
    expect(identities(seen)).toEqual(identities([card]));
    observer.destroy();
  });

  test("with no IntersectionObserver, observeAgain reports nothing (no entry to wait for)", () => {
    // @ts-expect-error -- deliberately removing the global to exercise the degraded path
    globalThis.IntersectionObserver = undefined;
    const seen: Element[] = [];
    const observer = createPreviewObserver((el) => seen.push(el));
    observer.observeAgain(cardEl("a"));
    expect(seen.length).toBe(0);
    observer.destroy();
  });
});

describe("retrying a failed preview", () => {
  test("the epoch moves on an invalidation, a registry change and a project switch", () => {
    const start = previewEpoch();
    expect(previewEpoch()).toBe(start);
    invalidatePreviews();
    const invalidated = previewEpoch();
    expect(invalidated).not.toBe(start);
    componentRegistry.push({ path: "components/new.json", source: "project", tagName: "x-new" });
    const registered = previewEpoch();
    expect(registered).not.toBe(invalidated);
    resetStudioState({ projectConfig: null, projectDirs: [] });
    expect(previewEpoch()).not.toBe(registered);
  });

  test("with no project open the epoch is still a key, and opening one moves it", () => {
    resetStudioState({ projectConfig: null, projectDirs: [] });
    const open = previewEpoch();
    setProjectState(null);
    const closed = previewEpoch();
    expect(closed).not.toBe(open);
    expect(previewEpoch()).toBe(closed);
  });

  test("an invalidation tells every listener until it stops listening", () => {
    let told = 0;
    const stop = onPreviewsInvalidated(() => {
      told += 1;
    });
    invalidatePreviews();
    stop();
    invalidatePreviews();
    expect(told).toBe(1);
  });

  test("a realm that went away is not reported as the file's failure", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    setPreviewRealmFactory(() => {
      throw new Error("the preview realm was replaced");
    });
    try {
      componentRegistry.push({ path: "components/quiet.json", source: "npm", tagName: "x-quiet" });
      const cache = createPreviewCache();
      expect(await previewFor("components/quiet.json", cache)).toBeUndefined();
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((line) => line.includes("components/quiet.json"))).toEqual([]);
    } finally {
      setPreviewRealmFactory(inProcessRealm());
      warn.mockRestore();
    }
  });

  test("a preview that throws on the way is reported and absorbed rather than breaking the paint", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const find = spyOn(componentRegistry, "find").mockImplementation(() => {
      throw new Error("registry unreadable");
    });
    try {
      expect(await previewFor("components/odd.json", createPreviewCache())).toBeUndefined();
      expect(warn.mock.calls.map((call) => String(call[0]))).toContain(
        "Jx Studio: no preview for components/odd.json: registry unreadable",
      );
    } finally {
      find.mockRestore();
      warn.mockRestore();
    }
  });

  test("a component that fails is reported once on the console, not once per paint", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    installMockPlatform({}, {});
    try {
      componentRegistry.push({
        path: "components/loud.json",
        source: "project",
        tagName: "x-loud",
      });
      const cache = createPreviewCache();
      const first = await previewFor("components/loud.json", cache);
      const second = await previewFor("components/loud.json", cache);
      expect([first, second]).toEqual([undefined, undefined]);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines.filter((line) => line.includes("components/loud.json"))).toEqual([
        "Jx Studio: no preview for components/loud.json: its definition could not be read",
      ]);
    } finally {
      setPreviewRealmFactory(inProcessRealm());
      warn.mockRestore();
    }
  });

  test("a failed preview is not cached, so the next ask renders it once it can", async () => {
    componentRegistry.push({ path: "components/late.json", source: "project", tagName: "x-late" });
    installMockPlatform({}, {});
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cache = createPreviewCache();
      expect(await previewFor("components/late.json", cache)).toBeUndefined();
      installMockPlatform(
        {},
        { "components/late.json": '{"tagName":"x-late","children":["Late"]}' },
      );
      const rendered = await previewFor("components/late.json", cache);
      expect(drawn(rendered).querySelector("x-late")?.textContent).toBe("Late");
      expect(cache.has("components/late.json")).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("rendersWith reports a render that throws outright, rather than letting it escape", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const definition = { attributes: { "1 bad": "x" }, tagName: "mu-throws" };
      expect(await rendersWith(definition, "components/throws.json", new Map())).toBe(false);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some((line) => line.startsWith("Jx Studio: no preview for components/throws.json:")),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  test("rendersWith says why a definition did not render", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const definition = {
        state: {
          opens: {
            $expression: {
              operator: "call",
              target: { $ref: "window#/Intl/formatDate" },
              value: ["", "en", { day: "numeric" }],
            },
          },
        },
        tagName: "mu-why",
        textContent: "${state.opens}",
      };
      expect(await rendersWith(definition, "components/why.json", new Map())).toBe(false);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(
        lines.some((line) => line.startsWith("Jx Studio: no preview for components/why.json:")),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("a changed definition reaches the preview realm", () => {
  test("a realm holding a changed tag is replaced, and failed previews are asked again", async () => {
    const made: InProcessRealm[] = [];
    setPreviewRealmFactory(inProcessRealm({ made }));
    let told = 0;
    const stop = onPreviewsInvalidated(() => {
      told += 1;
    });
    try {
      installMockPlatform(
        {},
        { "components/moved.json": '{"tagName":"x-moved","children":["M"]}' },
      );
      componentRegistry.push({
        path: "components/moved.json",
        source: "project",
        tagName: "x-moved",
      });
      expect(await previewFor("components/moved.json", createPreviewCache())).toBeDefined();
      previewDefinitionsMoved(["x-other"]);
      expect(told).toBe(0);
      previewDefinitionsMoved(["x-moved"]);
      expect(told).toBe(1);
      expect(made[0]?.disposed).toBe(true);
      // A realm that holds nothing yet is not replaced by a component set that moved.
      previewComponentSetMoved();
      expect(told).toBe(1);
      expect(await previewFor("components/moved.json", createPreviewCache())).toBeDefined();
      previewComponentSetMoved();
      expect(told).toBe(2);
      expect(made[1]?.disposed).toBe(true);
    } finally {
      stop();
      setPreviewRealmFactory(inProcessRealm());
    }
  });
});

describe("evictPreview", () => {
  test("a cache whose panel was torn down and collected is skipped, and a live one still evicts", async () => {
    const live = createPreviewCache();
    const shown = element("live");
    const island = shownIn(shown);
    live.set("components/gone.json", shown);
    // Panels that were torn down: nothing holds their caches any more.
    (() => {
      for (let index = 0; index < 4; index += 1) {
        createPreviewCache().set("components/gone.json", element(`dropped-${index}`));
      }
    })();
    // A WeakRef keeps its target for the rest of the job that made it, so collect on a later one.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    Bun.gc(true);
    expect(() => {
      evictPreview("components/gone.json");
    }).not.toThrow();
    expect(live.has("components/gone.json")).toBe(false);
    expect(shownPreview(island)).toBeNull();
    island.remove();
  });
});
