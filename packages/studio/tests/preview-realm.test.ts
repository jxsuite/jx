/**
 * The preview realm (`src/preview-realm/`, `project-state.md` §11.2, `studio.md` §9.1.2): one realm
 * draws every out-of-canvas preview from documents the shell hands it by message, answers each with
 * a snapshot, and is replaced when a definition its registry already holds changes.
 *
 * The realm's own code runs in this window over a cloning channel (`preview-realm-double.ts`):
 * happy-dom cannot load `canvas.html` into a frame, and what is under test is the protocol, not the
 * frame around it. The frame itself is asserted as the shell makes it.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { setResolveToken } from "@jxsuite/runtime";
import {
  bootPreviewRealm,
  isPreviewRealmSearch,
  settleTree,
  snapshotOf,
  startPreviewRealm,
  trackDefinitions,
} from "../src/preview-realm/frame";
import type { PreviewRealmWindow } from "../src/preview-realm/frame";
import { PREVIEW_REALM_CLASS, createPreviewRealmHost, frameRealm } from "../src/preview-realm/host";
import type { RealmAnswer, RealmTransport } from "../src/preview-realm/host";
import {
  framePreviewRealm,
  onPreviewRealmReplaced,
  previewComponentsChanged,
  previewDefinitionsChanged,
  previewRealm,
  previewRealmGeneration,
  previewRealmIdleBlockers,
  realmDocId,
  setPreviewRealmFactory,
  storedText,
} from "../src/preview-realm/client";
import { cardSnapshot, readDefinition, rendersWith } from "../src/preview-realm/ask";
import { contentStore } from "../src/project-state/store";
import { loadStylebookSpecimens } from "../src/style/stylebook-specimens";
import { setProjectState } from "../src/store";
import { inProcessRealm, linkedChannels, quickSettle } from "./preview-realm-double";
import type { InProcessRealm } from "./preview-realm-double";
import type {
  FromRealm,
  RealmDocument,
  RealmRequest,
  ToRealm,
} from "../src/preview-realm/protocol";
import type { CanvasEnvelope } from "../src/canvas/iframe-channel";
import type { JxDocument } from "@jxsuite/schema/types";
import { contentHash } from "@jxsuite/protocol/project-state";
import { assetContextFor } from "../src/canvas/asset-refs";

/* SAFETY: the harness registers happy-dom's GlobalRegistrator, which copies the window's members
   onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
happyDOM.setURL("http://localhost:3000/packages/studio/index.html");

/** A document as the shell hands it over, under a base this window can resolve. */
function target(document_: JxDocument, path = "components/x.json"): RealmDocument {
  return { base: `http://localhost/${path}`, docId: path, document: document_, path };
}

/** The markup a snapshot holds, parsed into a detached element to be read. */
function drawn(answer: RealmAnswer): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = answer.kind === "rendered" ? answer.snapshot.html : "";
  return holder;
}

/** A host over in-process realms, and every realm it made. */
function host(timeoutMs?: number) {
  const made: InProcessRealm[] = [];
  return { host: createPreviewRealmHost(inProcessRealm({ made }), timeoutMs), made };
}

let unique = 0;
/** A custom element name no other test in this file has defined. */
function tagName(stem: string): string {
  unique += 1;
  return `x-${stem}-${unique}`;
}

beforeEach(() => {
  installMockPlatform({}, {});
  resetStudioState({ projectConfig: null, projectDirs: [] });
});

afterEach(() => {
  setPreviewRealmFactory(inProcessRealm());
  contentStore.reset();
});

describe("the realm draws what the shell hands it", () => {
  test("a document, as a snapshot of its markup and the runtime's rules", async () => {
    const { host: realm } = host();
    const answer = await realm.ask({
      assets: null,
      kind: "document",
      target: target(
        {
          children: [{ style: { color: "red" }, tagName: "h1", textContent: "Hello" }],
          tagName: "section",
        },
        "pages/index.json",
      ),
    });
    expect(answer.kind).toBe("rendered");
    expect(drawn(answer).querySelector("section > h1")?.textContent).toBe("Hello");
    // The rules the runtime wrote for it come along, in one sheet of the shell's.
    const sheet = answer.kind === "rendered" ? answer.snapshot.sheet : null;
    expect([...(sheet?.cssRules ?? [])].some((rule) => rule.cssText.includes("red"))).toBe(true);
    // The drawn tree was let go: nothing stays in the realm's document.
    expect(document.body.querySelector("section")).toBeNull();
  });

  test("a document's media resolve as the host serves them", async () => {
    const { host: realm } = host();
    const answer = await realm.ask({
      assets: assetContextFor("pages/index.json", {
        fileBaseUrl: "https://h.example/raw/",
        space: "repo",
      }),
      kind: "document",
      target: target(
        { children: [{ attributes: { src: "/hero.png" }, tagName: "img" }], tagName: "section" },
        "pages/index.json",
      ),
    });
    expect(drawn(answer).querySelector("img")?.getAttribute("src")).toBe(
      "https://h.example/raw/public/hero.png",
    );
  });

  test("a document's components are defined from their own URLs before it is drawn", async () => {
    const tag = tagName("named");
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = Object.assign(
      (resource: RequestInfo | URL) => {
        fetched.push(String(resource));
        return Promise.resolve(Response.json({ children: ["Named"], tagName: tag }));
      },
      { preconnect: realFetch.preconnect },
    );
    try {
      const { host: realm } = host();
      const answer = await realm.ask({
        assets: null,
        kind: "document",
        target: target(
          {
            $elements: [{ $ref: "../components/named.json" }, "some-package"],
            children: [{ tagName: tag }],
            tagName: "main",
          },
          "pages/index.json",
        ),
      });
      expect(fetched).toEqual(["http://localhost/components/named.json"]);
      expect(drawn(answer).querySelector(tag)?.textContent).toBe("Named");
      expect(realm.tags().has(tag)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("two requests defining one composed component at once both draw it", async () => {
    const tag = tagName("composed");
    const child = tagName("part");
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async () => {
        // Slow enough that both requests are past the registry's check before either defines.
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        return Response.json({ children: ["Part"], tagName: child });
      },
      { preconnect: realFetch.preconnect },
    );
    try {
      const { host: realm } = host();
      const definition: JxDocument = {
        $elements: [{ $ref: "./part.json" }],
        children: [{ tagName: child }],
        tagName: tag,
      };
      const ask = () =>
        realm.ask({ attributes: {}, kind: "instance", props: {}, target: target(definition) });
      const answers = await Promise.all([ask(), ask()]);
      expect(answers.map((answer) => answer.kind)).toEqual(["rendered", "rendered"]);
      expect(drawn(answers[1]!).querySelector(tag)?.textContent).toBe("Part");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a definition that fails to define does not stop the ones after it", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(() => Promise.resolve(new Response("gone", { status: 404 })), {
      preconnect: realFetch.preconnect,
    });
    try {
      const { host: realm } = host();
      const broken = realm.ask({
        attributes: {},
        kind: "instance",
        props: {},
        target: target({ $elements: [{ $ref: "./gone.json" }], tagName: tagName("broken") }),
      });
      const fine = realm.ask({
        attributes: {},
        kind: "instance",
        props: {},
        target: target({ children: ["Fine"], tagName: tagName("fine") }),
      });
      const answers = await Promise.all([broken, fine]);
      expect(answers.map((answer) => answer.kind)).toEqual(["failed", "rendered"]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a document's draw is stopped once read, so the next answer carries none of its rules", async () => {
    const { host: realm } = host();
    const page = (color: string) =>
      realm.ask({
        assets: null,
        kind: "document",
        target: target({ style: { color }, tagName: "article" }, "pages/index.json"),
      });
    await page("rgb(1, 2, 3)");
    const second = await page("rgb(4, 5, 6)");
    const rules = [...((second.kind === "rendered" && second.snapshot.sheet?.cssRules) || [])];
    expect(rules.some((rule) => rule.cssText.includes("rgb(4, 5, 6)"))).toBe(true);
    expect(rules.some((rule) => rule.cssText.includes("rgb(1, 2, 3)"))).toBe(false);
  });

  test("an instance of a project component, with its attribute defaults and sample props", async () => {
    const tag = tagName("card");
    const { host: realm } = host();
    const answer = await realm.ask({
      attributes: { variant: "primary" },
      kind: "instance",
      props: { title: "Sample" },
      target: target({
        children: [{ tagName: "h2", textContent: "${state.title}" }],
        state: { title: "" },
        tagName: tag,
      }),
    });
    const instance = drawn(answer).querySelector(tag);
    expect(instance?.getAttribute("variant")).toBe("primary");
    expect(instance?.querySelector("h2")?.textContent).toBe("Sample");
    // Defined in the realm's registry, and the shell learns the realm holds it.
    expect(realm.tags().has(tag)).toBe(true);
  });

  test("an image the instance draws with no source shows the preview placeholder", async () => {
    const tag = tagName("pictured");
    const { host: realm } = host();
    const answer = await realm.ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ children: [{ attributes: { src: "" }, tagName: "img" }], tagName: tag }),
    });
    const img = drawn(answer).querySelector("img");
    expect(img?.getAttribute("src")?.startsWith("data:image/svg+xml,")).toBe(true);
    expect(img?.dataset.jxImagePlaceholder).toBe("");
  });

  test("a definition that does not render with its props is answered failed, and never defined", async () => {
    const tag = tagName("dated");
    const { host: realm } = host();
    const answer = await realm.ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({
        state: {
          opens: {
            $expression: {
              operator: "call",
              target: { $ref: "window#/Intl/formatDate" },
              value: ["", "en", { day: "numeric" }],
            },
          },
        },
        tagName: tag,
        textContent: "${state.opens}",
      }),
    });
    expect(answer.kind).toBe("failed");
    expect(customElements.get(tag)).toBeUndefined();
  });

  test("a document that defines no custom element is no component instance", async () => {
    const { host: realm } = host();
    const answer = await realm.ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ tagName: "div" }, "components/plain.json"),
    });
    expect(answer).toEqual({
      kind: "failed",
      message: "components/plain.json defines no custom element",
    });
  });

  test("a component that renders into a shadow root keeps its rules inside it", async () => {
    const tag = tagName("shadowed");
    const { host: realm } = host();
    const answer = await realm.ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({
        $shadow: "open",
        children: [{ style: { color: "teal" }, tagName: "p", textContent: "Inside" }],
        tagName: tag,
      }),
    });
    const html = answer.kind === "rendered" ? answer.snapshot.html : "";
    expect(html).toContain('<template shadowrootmode="open"');
    expect(html).toMatch(/<style>[^<]*teal[^<]*<\/style>/u);
    expect(html).toContain("Inside");
  });

  test("a package's element the realm defines is drawn, one it does not is a box naming it", async () => {
    const defined = tagName("pkg");
    customElements.define(defined, class extends HTMLElement {});
    const { host: realm } = host();
    const shown = await realm.ask({ attributes: { size: "lg" }, kind: "package", tag: defined });
    expect(drawn(shown).querySelector(defined)?.getAttribute("size")).toBe("lg");
    const missing = await realm.ask({ attributes: {}, kind: "package", tag: "x-not-here" });
    const box = drawn(missing).querySelector(".jx-preview-fallback");
    expect(box?.textContent).toBe("<x-not-here>");
  });

  test("a trial answers whether a definition renders, with the reason it does not", async () => {
    const { host: realm } = host();
    const renders = await realm.ask({
      kind: "trial",
      props: {},
      target: target({ tagName: tagName("ok") }),
    });
    expect(renders).toEqual({ kind: "trialed" });
    const thrown = await realm.ask({
      kind: "trial",
      props: {},
      target: target({ attributes: { "1 bad": "x" }, tagName: tagName("bad") }),
    });
    expect(thrown.kind).toBe("failed");
  });
});

describe("snapshots", () => {
  test("a shadow root is serialized as declarative shadow DOM, with its own rules inside it", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const host_ = document.createElement("div");
    const root = host_.attachShadow({ mode: "open" });
    root.innerHTML =
      '<p>Inside</p><img src="pic.png"><img src="data:image/png;base64,AA=="><img src="">';
    const link = document.createElement("link");
    link.setAttribute("href", "site.css");
    container.append(host_, link);
    const snapshot = snapshotOf(container);
    expect(snapshot.html).toContain('<template shadowrootmode="open"');
    expect(snapshot.html).toContain("<p>Inside</p>");
    // Relative URLs are made absolute against the realm's own base; data and empty ones are kept.
    const base = document.baseURI;
    if (URL.canParse("pic.png", base)) {
      expect(snapshot.html).toContain(`src="${new URL("pic.png", base).href}"`);
      expect(snapshot.html).toContain(`href="${new URL("site.css", base).href}"`);
    }
    expect(snapshot.html).toContain('src="data:image/png;base64,AA=="');
    expect(snapshot.html).toContain('src=""');
    container.remove();
  });

  test("settleTree waits for a tree to stop changing, in light DOM and in its shadow roots", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const shadowHost = document.createElement("div");
    const shadow = shadowHost.attachShadow({ mode: "open" });
    root.append(shadowHost);
    let writes = 0;
    const timer = setInterval(() => {
      writes += 1;
      shadow.append(document.createElement("span"));
      if (writes === 3) {
        clearInterval(timer);
      }
    }, 5);
    await settleTree(root);
    expect(writes).toBe(3);
    expect(shadow.childElementCount).toBe(3);
    root.remove();
  });

  test("settleTree watches the root's own shadow root too", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const shadow = root.attachShadow({ mode: "open" });
    setTimeout(() => {
      shadow.append(document.createElement("b"));
    }, 5);
    await settleTree(root);
    expect(shadow.childElementCount).toBe(1);
    root.remove();
  });

  test("settleTree reads a tree that never stops changing once its time is up", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const timer = setInterval(() => {
      root.append(document.createElement("span"));
    }, 2);
    const started = Date.now();
    try {
      await settleTree(root, 60);
    } finally {
      clearInterval(timer);
    }
    expect(Date.now() - started).toBeLessThan(1000);
    root.remove();
  });

  test("the definitions a registry receives are tracked once per registry", () => {
    const tags = trackDefinitions(customElements);
    expect(trackDefinitions(customElements)).toBe(tags);
    const tag = tagName("tracked");
    customElements.define(tag, class extends HTMLElement {});
    expect(tags.has(tag)).toBe(true);
    // Defined for real, not only recorded.
    expect(customElements.get(tag)).toBeDefined();
  });
});

describe("the host", () => {
  test("waits for the realm to say it is ready before it asks, and numbers each request", async () => {
    const { realm, sent, shell } = linkedChannels();
    const transport: RealmTransport = { channel: shell, dispose: () => {} };
    const realm_ = createPreviewRealmHost(() => transport);
    const answered = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-a" }) });
    await Promise.resolve();
    expect(sent).toHaveLength(0);
    expect(realm_.inFlight()).toBe(1);
    realm.post({ kind: "ready" });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(sent.map((message) => message.id)).toEqual([1]);
    // An answer to nothing it asked is ignored; the tags still count.
    realm.post({ id: 99, kind: "trialed", tags: ["x-late"] });
    realm.post({ id: 1, kind: "trialed", tags: ["x-a"] });
    expect(await answered).toEqual({ kind: "trialed" });
    expect([...realm_.tags()]).toEqual(["x-late", "x-a"]);
    expect(realm_.inFlight()).toBe(0);
  });

  test("a realm that never starts is let go when its first request times out", async () => {
    const made: string[] = [];
    const realm_ = createPreviewRealmHost(() => {
      const { shell } = linkedChannels();
      made.push("realm");
      return { channel: shell, dispose: () => made.push("disposed") };
    }, 5);
    expect(await realm_.ask({ attributes: {}, kind: "package", tag: "x-a" })).toEqual({
      kind: "failed",
      lost: true,
      message: "the preview realm did not answer",
    });
    expect(made).toEqual(["realm", "disposed"]);
    // Made and let go; the next request makes another realm.
    expect(realm_.generation()).toBe(2);
    void realm_.ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(realm_.generation()).toBe(3);
  });

  test("a started realm that is slow to answer keeps going after a request times out", async () => {
    const { realm, shell } = linkedChannels();
    let disposed = false;
    const realm_ = createPreviewRealmHost(
      () => ({ channel: shell, dispose: () => (disposed = true) }),
      20,
    );
    realm.post({ kind: "ready" });
    const late = await realm_.ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(late.kind).toBe("failed");
    expect(disposed).toBe(false);
    expect(realm_.generation()).toBe(1);
  });

  test("is replaced when a definition it holds changes, and only then", async () => {
    const { host: realm, made } = host();
    const tag = tagName("held");
    await realm.ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ children: ["Held"], tagName: tag }),
    });
    expect(realm.definitionsChanged(["x-somebody-else"])).toBe(false);
    expect(made[0]?.disposed).toBe(false);
    expect(realm.definitionsChanged([tag])).toBe(true);
    expect(made[0]?.disposed).toBe(true);
    // A replaced realm holds nothing, and the next request makes a new one.
    expect(realm.tags().size).toBe(0);
    expect(realm.definitionsChanged([tag])).toBe(false);
    expect(realm.generation()).toBe(2);
    await realm.ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(made).toHaveLength(2);
    expect(realm.generation()).toBe(3);
  });

  test("a request in flight when the realm is replaced is answered failed", async () => {
    const { realm, shell } = linkedChannels();
    const realm_ = createPreviewRealmHost(() => ({ channel: shell, dispose: () => {} }));
    realm.post({ kind: "ready" });
    const pending = realm_.ask({ attributes: {}, kind: "package", tag: "x-a" });
    realm_.replace();
    expect(await pending).toEqual({
      kind: "failed",
      lost: true,
      message: "the preview realm was replaced",
    });
    // Replacing nothing is nothing.
    realm_.replace();
    expect(realm_.inFlight()).toBe(0);
  });

  test("a definition that changes while a request is in flight replaces the realm once a reply shows it", async () => {
    const { realm, shell } = linkedChannels();
    let disposed = 0;
    let replaced = 0;
    const realm_ = createPreviewRealmHost(
      () => ({ channel: shell, dispose: () => (disposed += 1) }),
      undefined,
      () => (replaced += 1),
    );
    realm.post({ kind: "ready" });
    const first = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-a" }) });
    const second = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-b" }) });
    // Nothing names x-a yet, so nothing can be replaced now; the change is remembered.
    expect(realm_.definitionsChanged(["x-a"])).toBe(false);
    expect(disposed).toBe(0);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    realm.post({ id: 2, kind: "trialed", tags: ["x-b"] });
    expect(await second).toEqual({ kind: "trialed" });
    // The realm defined x-a from the old definition while drawing the first request.
    realm.post({ id: 1, kind: "trialed", tags: ["x-a", "x-b"] });
    expect(await first).toEqual({
      kind: "failed",
      lost: true,
      message: "the preview realm was replaced",
    });
    expect(disposed).toBe(1);
    expect(replaced).toBe(1);
    expect(realm_.generation()).toBe(2);
  });

  test("a change no reply confirms is forgotten once the requests in flight have answered", async () => {
    const { realm, shell } = linkedChannels();
    let disposed = 0;
    const realm_ = createPreviewRealmHost(
      () => ({ channel: shell, dispose: () => (disposed += 1) }),
      20,
    );
    // A doubted change the reply does not name is settled with it.
    void realm_.ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(realm_.definitionsChanged(["x-zero"])).toBe(false);
    realm.post({ kind: "ready" });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    realm.post({ id: 1, kind: "rendered", snapshot: { css: "", html: "" }, tags: [] });
    expect(realm_.definitionsChanged(["x-zero"])).toBe(false);
    const answered = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-a" }) });
    const timedOut = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-c" }) });
    expect(realm_.definitionsChanged(["x-a", "x-c"])).toBe(false);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    realm.post({ id: 2, kind: "trialed", tags: [] });
    expect(await answered).toEqual({ kind: "trialed" });
    // The other is let go by its timeout: the realm started, so it stays, and the doubt is settled.
    expect(await timedOut).toEqual({
      kind: "failed",
      lost: true,
      message: "the preview realm did not answer",
    });
    const later = realm_.ask({ kind: "trial", props: {}, target: target({ tagName: "x-c" }) });
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    realm.post({ id: 4, kind: "trialed", tags: ["x-a", "x-c", "x-zero"] });
    expect(await later).toEqual({ kind: "trialed" });
    expect(disposed).toBe(0);
  });

  test("keeps one sheet per realm, rewritten as its rules grow, and keeps it on a rule it cannot read", async () => {
    const { realm, shell } = linkedChannels();
    const realm_ = createPreviewRealmHost(() => ({ channel: shell, dispose: () => {} }));
    realm.post({ kind: "ready" });
    const answer = async (id: number, css: string) => {
      const pending = realm_.ask({ attributes: {}, kind: "package", tag: "x-a" });
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      realm.post({ id, kind: "rendered", snapshot: { css, html: "" }, tags: [] });
      const got = await pending;
      return got.kind === "rendered" ? got.snapshot.sheet : null;
    };
    const first = await answer(1, "p { color: red; }");
    const second = await answer(2, "p { color: red; } a { color: blue; }");
    expect(second).toBe(first);
    expect(first?.cssRules).toHaveLength(2);
    const sheet = first!;
    const replaceSync = spyOn(sheet, "replaceSync").mockImplementation(() => {
      throw new Error("unparseable");
    });
    try {
      expect(await answer(3, "@@@")).toBe(sheet);
      expect(sheet.cssRules).toHaveLength(2);
    } finally {
      replaceSync.mockRestore();
    }
  });
});

describe("the frame", () => {
  test("is canvas.html asking for the realm, carrying its token and the shell's origin", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const transport = frameRealm({ canvasUrl: "/__studio__/canvas.html?rpcToken=tok", parent });
    const frame = parent.querySelector("iframe");
    expect(frame?.className).toBe(PREVIEW_REALM_CLASS);
    expect(frame?.getAttribute("aria-hidden")).toBe("true");
    expect(frame?.tabIndex).toBe(-1);
    const src = new URL(frame!.getAttribute("src")!, location.href);
    expect(frame!.getAttribute("src")!.startsWith("/__studio__/canvas.html?")).toBe(true);
    expect(src.searchParams.get("realm")).toBe("preview");
    expect(src.searchParams.get("rpcToken")).toBe("tok");
    expect(src.searchParams.get("token")).toMatch(/^[\da-f-]{36}$/u);
    expect(src.searchParams.get("parentOrigin")).toBe("http://localhost:3000");
    // Posting reaches the frame's window, read lazily; disposing takes the frame away.
    expect(() => {
      transport.channel.post({ attributes: {}, id: 1, kind: "package", tag: "x-a" });
    }).not.toThrow();
    transport.dispose();
    expect(parent.querySelector("iframe")).toBeNull();
    parent.remove();
  });

  test("a canvas served from another origin is addressed absolutely", () => {
    const parent = document.createElement("div");
    const transport = frameRealm({ canvasUrl: "https://canvas.example/canvas.html", parent });
    expect(parent.querySelector("iframe")?.getAttribute("src")).toMatch(
      /^https:\/\/canvas\.example\/canvas\.html\?realm=preview&token=/u,
    );
    transport.dispose();
  });

  test("boots from its URL: the dev-proxy token, the channel to the shell, and ready", () => {
    const posted: CanvasEnvelope<FromRealm>[] = [];
    const listeners: ((event: MessageEvent) => void)[] = [];
    const win: PreviewRealmWindow = {
      addEventListener: (_type, listener) => listeners.push(listener),
      customElements,
      document,
      location: { search: "?realm=preview&token=tok&parentOrigin=http://localhost&rpcToken=rpc" },
      parent: {
        postMessage: (message) => posted.push(message),
      },
      removeEventListener: (_type, listener) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    const stop = bootPreviewRealm(win);
    try {
      expect(posted).toEqual([{ "jx:canvas": "tok", payload: { kind: "ready" } }]);
      expect(listeners).toHaveLength(1);
    } finally {
      stop();
      setResolveToken(null);
    }
    expect(listeners).toHaveLength(0);
  });

  test("a frame with no parent origin accepts its token alone", () => {
    const posted: unknown[] = [];
    const win: PreviewRealmWindow = {
      addEventListener: () => {},
      customElements,
      document,
      location: { search: "?realm=preview" },
      parent: { postMessage: (message, origin) => posted.push([message, origin]) },
      removeEventListener: () => {},
    };
    bootPreviewRealm(win)();
    expect(posted).toEqual([[{ "jx:canvas": "", payload: { kind: "ready" } }, "*"]]);
  });

  test("only ?realm=preview is the realm", () => {
    expect(isPreviewRealmSearch("?realm=preview&token=t")).toBe(true);
    expect(isPreviewRealmSearch("?token=t")).toBe(false);
    expect(isPreviewRealmSearch("?realm=canvas")).toBe(false);
  });
});

describe("the window's realm", () => {
  test("is made once, and replaced when another project opens", async () => {
    const made: InProcessRealm[] = [];
    setPreviewRealmFactory(inProcessRealm({ made }));
    expect(previewRealmGeneration()).toBe(0);
    const first = previewRealm();
    expect(previewRealm()).toBe(first);
    await first.ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(previewRealmGeneration()).toBe(1);
    let replaced = 0;
    const stop = onPreviewRealmReplaced(() => {
      replaced += 1;
    });
    resetStudioState({ projectConfig: null, projectDirs: [], projectRoot: "/elsewhere" });
    expect(previewRealm()).toBe(first);
    expect(made[0]?.disposed).toBe(true);
    expect(replaced).toBe(1);
    stop();
    setProjectState(null);
    expect(previewRealm()).toBe(first);
    expect(replaced).toBe(1);
  });

  test("a realm that defines nothing is not replaced when the component set moves", async () => {
    const { realm, shell } = linkedChannels();
    let disposed = false;
    expect(previewDefinitionsChanged(["x-a"])).toBe(false);
    setPreviewRealmFactory(() => ({ channel: shell, dispose: () => (disposed = true) }));
    expect(previewComponentsChanged()).toBe(false);
    realm.onMessage((request) => {
      realm.post({ id: request.id, kind: "trialed", tags: [] });
    });
    realm.post({ kind: "ready" });
    await previewRealm().ask({ kind: "trial", props: {}, target: target({ tagName: "x-a" }) });
    expect(previewComponentsChanged()).toBe(false);
    expect(disposed).toBe(false);
  });

  test("is told when definitions change, and when the set of components does", async () => {
    const made: InProcessRealm[] = [];
    setPreviewRealmFactory(inProcessRealm({ made }));
    expect(previewDefinitionsChanged(["x-a"])).toBe(false);
    const tag = tagName("told");
    await previewRealm().ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ children: ["Told"], tagName: tag }),
    });
    expect(previewDefinitionsChanged([tag])).toBe(true);
    await previewRealm().ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ children: ["Again"], tagName: tagName("again") }),
    });
    expect(previewComponentsChanged()).toBe(true);
    expect(made.map((realm) => realm.disposed)).toEqual([true, true]);
  });

  test("is the frame Studio boots with, beside the canvas the platform names", () => {
    installMockPlatform({ canvasUrl: "/__studio__/canvas.html?rpcToken=tok" }, {});
    const transport = framePreviewRealm();
    const frame = document.body.querySelector<HTMLIFrameElement>(`.${PREVIEW_REALM_CLASS}`);
    expect(
      frame?.getAttribute("src")?.startsWith("/__studio__/canvas.html?rpcToken=tok&realm=preview"),
    ).toBe(true);
    transport.dispose();
    // A platform that names no canvas gets the one beside the bundle.
    installMockPlatform({ canvasUrl: "" }, {});
    const fallback = framePreviewRealm();
    expect(document.body.querySelector(`.${PREVIEW_REALM_CLASS}`)?.getAttribute("src")).toContain(
      "canvas.html?realm=preview",
    );
    fallback.dispose();
  });

  test("with no realm installed, every request fails saying so, as the realm's failure", async () => {
    setPreviewRealmFactory(null);
    expect(await previewRealm().ask({ attributes: {}, kind: "package", tag: "x-a" })).toEqual({
      kind: "failed",
      lost: true,
      message: "no preview realm is installed",
    });
    // A trial the realm could not answer is no answer about the definition.
    const asked = await rendersWith({ tagName: "x-a" }, "components/a.json", new Map()).then(
      () => "answered",
      String,
    );
    expect(asked).toBe("Error: no preview realm is installed");
  });

  test("counts what it has not answered for the idle probe", async () => {
    const { realm, shell } = linkedChannels();
    setPreviewRealmFactory(() => ({ channel: shell, dispose: () => {} }));
    expect(previewRealmIdleBlockers()).toEqual([]);
    realm.post({ kind: "ready" });
    void previewRealm().ask({ attributes: {}, kind: "package", tag: "x-a" });
    expect(previewRealmIdleBlockers()).toEqual(["preview realm: 1 request(s) in flight"]);
  });
});

describe("documents from the content store", () => {
  /** Index one document in the store, as a host snapshot would. */
  async function indexed(path: string, text: string) {
    const hash = await contentHash(text);
    contentStore.applySnapshot({
      components: [],
      files: [{ docId: "doc-1", hash, indexed: true, isDir: false, kind: "component", path }],
      formats: "f",
      readiness: "ready",
    });
    return hash;
  }

  test("a document the store indexes is asked by its DocId, any other by its path", async () => {
    expect(realmDocId("components/x.json")).toBe("components/x.json");
    await indexed("components/x.json", "{}");
    expect(realmDocId("components/x.json")).toBe("doc-1");
  });

  test("the store's bytes are read before the platform's, and a read fills the store", async () => {
    let reads = 0;
    const text = '{"tagName":"x-stored"}';
    installMockPlatform(
      {
        readFile: () => {
          reads += 1;
          return Promise.resolve(text);
        },
      },
      {},
    );
    // Not indexed: read, and not held.
    expect(await storedText("components/x.json")).toBe(text);
    expect(contentStore.contentsAt("components/x.json")).toBeUndefined();
    const hash = await indexed("components/x.json", text);
    expect(await storedText("components/x.json")).toBe(text);
    expect(contentStore.contents("doc-1", hash)).toBe(text);
    expect(reads).toBe(2);
    // Held now, so the next ask reads nothing.
    expect(await storedText("components/x.json")).toBe(text);
    expect(reads).toBe(2);
  });

  test("while Studio's own write has not echoed, the written bytes are read, not the store's", async () => {
    const old = '{"tagName":"x-old"}';
    contentStore.put("components/x.json", await indexed("components/x.json", old), old);
    installMockPlatform({ readFile: () => Promise.resolve('{"tagName":"x-new"}') }, {});
    expect(await storedText("components/x.json")).toBe('{"tagName":"x-old"}');
    await contentStore.noteOwnWrite("components/x.json", '{"tagName":"x-new"}');
    expect(await storedText("components/x.json")).toBe('{"tagName":"x-new"}');
  });

  test("bytes this window cannot hash are read and not held", async () => {
    await indexed("components/x.json", "old");
    installMockPlatform({ readFile: () => Promise.resolve("new") }, {});
    const digest = spyOn(crypto.subtle, "digest").mockImplementation(() =>
      Promise.reject(new Error("insecure context")),
    );
    try {
      expect(await storedText("components/x.json")).toBe("new");
    } finally {
      digest.mockRestore();
    }
  });

  test("a package element Studio's own kit defines is drawn by it, without asking the realm", async () => {
    // The in-process realm shares this window's registry: a tag it defined is one Studio defines.
    const tag = tagName("kit");
    await previewRealm().ask({
      attributes: {},
      kind: "instance",
      props: {},
      target: target({ tagName: tag }),
    });
    const made: InProcessRealm[] = [];
    setPreviewRealmFactory(inProcessRealm({ made }));
    const shown = await cardSnapshot({
      props: [{ default: "'primary'", name: "variant" }],
      source: "npm",
      tagName: tag,
    });
    expect(shown?.html).toBe(`<${tag} variant="primary"></${tag}>`);
    expect(made).toHaveLength(0);
  });

  test("a card whose realm went away before it answered asks again rather than showing a box", async () => {
    setPreviewRealmFactory(null);
    expect(await cardSnapshot({ source: "npm", tagName: "x-away" })).toBeNull();
  });

  test("the realm made after a replacement is handed the changed definition", async () => {
    const made: InProcessRealm[] = [];
    setPreviewRealmFactory(inProcessRealm({ made }));
    const tag = tagName("changed");
    const ask = (text: string) =>
      previewRealm().ask({
        attributes: {},
        kind: "instance",
        props: {},
        target: target({ children: [text], tagName: tag }),
      });
    await ask("Before");
    expect(previewDefinitionsChanged([tag])).toBe(true);
    await ask("After");
    expect(made).toHaveLength(2);
    const [handed] = made[1]?.sent ?? [];
    expect(handed?.kind === "instance" && handed.target.document.children).toEqual(["After"]);
  });

  test("a definition that renders says so", async () => {
    expect(await rendersWith({ tagName: tagName("fine") }, "components/fine.json", new Map())).toBe(
      true,
    );
  });

  test("a component's preview and its definition come from the store", async () => {
    installMockPlatform({}, { "components/arr.json": "[1]" });
    expect(await readDefinition("components/arr.json")).toBeNull();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // A definition that cannot be read is the box naming its tag, and why is said once.
      const gone = await cardSnapshot({
        path: "components/gone.json",
        source: "project",
        tagName: "x-gone",
      });
      expect(gone?.html).toContain("&lt;x-gone&gt;");
      expect(String(warn.mock.calls[0]?.[0])).toContain("its definition could not be read");
    } finally {
      warn.mockRestore();
    }
    const shown = await cardSnapshot({ source: "npm", tagName: "x-shown" });
    expect(shown?.html).toContain("jx-preview-fallback");
  });
});

describe("a question the realm could not answer", () => {
  test("is not remembered as Project Styles' answer, and is asked again", async () => {
    const tag = tagName("sampled");
    installMockPlatform(
      {},
      {
        "components/ok.json": JSON.stringify({
          children: [{ tagName: "p", textContent: "${state.title}" }],
          state: { title: { default: "", examples: ["Hi"], type: "string" } },
          tagName: tag,
        }),
      },
    );
    const silent = linkedChannels();
    let first = true;
    const realms = inProcessRealm();
    setPreviewRealmFactory(() => {
      if (!first) {
        return realms();
      }
      first = false;
      queueMicrotask(() => {
        silent.realm.post({ kind: "ready" });
      });
      return { channel: silent.shell, dispose: () => {} };
    });
    const registry = [{ path: "components/ok.json", source: "project" as const, tagName: tag }];
    const loading = loadStylebookSpecimens(registry);
    while (silent.sent.length === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
    // The user saves a component the realm holds: it is replaced mid-trial.
    previewRealm().replace();
    const replaced = await loading;
    expect(replaced.get(tag)).toEqual({ kind: "bare" });
    const asked = await loadStylebookSpecimens(registry);
    expect(asked.get(tag)).toEqual({
      kind: "props",
      props: { title: "Hi" },
    });
  });
});

/** Every request kind is plain data that survives the clone `postMessage` makes. */
test("every request kind crosses the channel intact", async () => {
  const { realm, sent, shell } = linkedChannels();
  const received: ToRealm[] = [];
  realm.onMessage((message) => received.push(message));
  const requests: RealmRequest[] = [
    { assets: null, kind: "document", target: target({ tagName: "main" }) },
    {
      attributes: { a: "1" },
      kind: "instance",
      props: { b: [1] },
      target: target({ tagName: "x-i" }),
    },
    { attributes: {}, kind: "package", tag: "x-p" },
    { kind: "trial", props: {}, target: target({ tagName: "x-t" }) },
  ];
  for (const [index, request] of requests.entries()) {
    /* SAFETY: each request is one member of `RealmRequest` and gains only its id, which makes it the
       same member of `ToRealm`; spreading a union member keeps its `kind`. */
    shell.post({ ...request, id: index } as ToRealm);
  }
  await Promise.resolve();
  expect(received).toEqual(sent);
  expect(received.map((message) => message.kind)).toEqual([
    "document",
    "instance",
    "package",
    "trial",
  ]);
  // The realm's own quick settle is what the double uses.
  await quickSettle(document.body);
  expect(startPreviewRealm).toBeDefined();
});
