/**
 * The Navigator's Page panel — `src/panels/head-panel.ts`, the flow, and
 * `src/surfaces/panel-page.json`, the document it mounts — plus the merged-`$head` preview model
 * that has no surface at all.
 *
 * **Everything visual is addressed by `part`, `role` or `data-prop`**, because the panel is a
 * document: there is no `sp-textfield`, `sp-picker`, `.imports-section` or `.set-dot` left to find,
 * and a document may emit no class at all. A section carries the `data-section` it is about and a
 * row the `data-prop` a reader and `ui/regions.ts`'s `field:<prop>` grammar call it, so a query
 * says which thing it is acting on rather than counting siblings.
 *
 * **Every paint is awaited.** `mountSurface` is asynchronous and each kit element settles its own
 * template one `connectedCallback` after that, so the `render(); assert;` these tests used to do
 * would now assert against an empty container. The host is also ATTACHED, because a kit element
 * renders on connect and a detached one gets `<jx-textfield>` tags with nothing inside them.
 *
 * **An edit is made on the NATIVE control inside the kit element** (`[part="input"]` for a field,
 * `[part="control"]` for a select or a checkbox), because that is what a reader's edit is: the
 * element hears its own control's event and lets it bubble on. Writing the host's `value` property
 * would move the element without ever telling the control.
 *
 * **The media picker is DOUBLED.** Its two behaviours reach the panel through a lazy `import()`, so
 * without a double there is nothing to assert against — and two real dynamic imports of one module
 * can race Bun's coverage recorder into dropping the file.
 */
import {
  flush,
  installMockPlatform,
  pointer,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { nothing } from "lit-html";
import { getPanel, resetPanels } from "../src/panels/panel-registry";
import { closeAllTabs } from "../src/workspace/workspace";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { activeRegistry, setActiveRegistry } from "../src/commands/active-registry";

import type { HeadLayers, SeoPreview } from "../src/panels/head-panel";
import type { Tab } from "../src/tabs/tab";
import type { JxHeadEntry, JxMutableNode } from "@jxsuite/schema/types";

/** Every browse and upload the panel asked the media picker for, in order. */
const mediaCalls: string[] = [];
let browseAnchor: HTMLElement | null = null;
let browseCommit: ((val: string) => void) | null = null;
let uploadCommit: ((val: string) => void) | null = null;
void mock.module("../src/ui/media-picker.js", () => ({
  invalidateMediaCache: () => {},
  pickAndUpload: (onCommit: (val: string) => void) => {
    mediaCalls.push("upload");
    uploadCommit = onCommit;
  },
  showMediaPickerPopover: (anchor: HTMLElement, onCommit: (val: string) => void) => {
    mediaCalls.push("browse");
    browseAnchor = anchor;
    browseCommit = onCommit;
  },
  uploadAndAssign: () => Promise.resolve(null),
}));

const {
  BUILD_FALLBACK_TITLE,
  buildSeoPreview,
  invalidateLayoutHeadCache,
  invalidateLayoutPickerCache,
  layoutDisplayName,
  layoutHeadEntries,
  registerPagePanel,
  renderPagePanel,
  resolveMetaField,
  resolveSeoUrl,
  resolveTitleField,
  seoField,
  seoPreviewFor,
  visibleLength,
} = await import("../src/panels/head-panel");
const { invalidateLayoutCache } = await import("../src/site-context");

// ─── Local helpers ────────────────────────────────────────────────────────────

/**
 * Collect scheduled timers instead of running them, and honour cancellation.
 *
 * The one way to drive the debounce, and the reason there is no "fire every callback on the spot"
 * variant beside it: that shape has to stub `clearTimeout` to a no-op, so a test written with it
 * cannot tell a cancelled debounce from one that ran — which is exactly the distinction the
 * pending-edit guard exists for — and the timer it failed to cancel stays on the REAL queue, to
 * fire `LIVE_PREVIEW` later into whichever document the panel holds by then. This one records,
 * cancels for real, and lets the test fire whatever survived.
 */
function withCapturedTimers<T>(fn: (runPending: () => void) => T): T {
  const origSet = globalThis.setTimeout;
  const origClear = globalThis.clearTimeout;
  const pending = new Map<number, () => void>();
  let next = 1;
  (globalThis as any).setTimeout = (cb: () => void) => {
    next += 1;
    pending.set(next, cb);
    return next;
  };
  (globalThis as any).clearTimeout = (id: number) => {
    pending.delete(id);
  };
  try {
    return fn(() => {
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) {
        cb();
      }
    });
  } finally {
    globalThis.setTimeout = origSet;
    globalThis.clearTimeout = origClear;
  }
}

interface Drawn {
  host: HTMLElement;
  doc: JxMutableNode;
  mutations: number;
  leftPanelRenders: number;
}

/**
 * Draw the panel into a fresh, attached host and let the document mount.
 *
 * A fresh host is also a fresh draft — the panel drops a half-typed tag when its content area is
 * replaced — so each call starts with an empty add form without reaching into module state.
 */
async function draw(doc: Record<string, unknown>): Promise<Drawn> {
  const host = document.createElement("div");
  document.body.append(host);
  const result: Drawn = {
    doc: doc as unknown as JxMutableNode,
    host,
    leftPanelRenders: 0,
    mutations: 0,
  };
  renderPagePanel(host, {
    applyMutation: (fn) => {
      result.mutations += 1;
      fn(result.doc);
    },
    document: result.doc,
    renderLeftPanel: () => {
      result.leftPanelRenders += 1;
    },
  });
  await flush(4);
  return result;
}

/** One band of the panel, by the name it is addressed under. */
function section(host: HTMLElement, key: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="section"][data-section="${key}"]`);
}

/** A band's heading. */
function heading(host: HTMLElement, key: string): string {
  return section(host, key)?.querySelector('[part="title"]')?.textContent ?? "";
}

/** One row, by the name a reader and the inspector call it. */
function row(scope: ParentNode, prop: string): HTMLElement {
  const el = scope.querySelector(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`row not found: ${prop}`);
  }
  return el as HTMLElement;
}

/** The kit element a row draws. */
function widget(scope: ParentNode, prop: string): HTMLElement {
  const el = row(scope, prop).querySelector('[part="widget"]');
  if (!el) {
    throw new Error(`row ${prop} draws no widget`);
  }
  return el as HTMLElement;
}

/** The native control inside a kit element — what a reader actually types into or picks from. */
function control(scope: ParentNode, prop: string): HTMLInputElement {
  const el = widget(scope, prop).querySelector<HTMLInputElement>(
    '[part="input"], [part="control"]',
  );
  if (!el) {
    throw new Error(`no native control inside the ${prop} widget`);
  }
  return el;
}

/** Type and commit, the way a reader does: the write and the event are both on the control. */
function setAndFire(scope: ParentNode, prop: string, value: string, type = "change"): void {
  const el = control(scope, prop);
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Press a row's clear dot. */
function clearRow(scope: ParentNode, prop: string): void {
  const chip = row(scope, prop).querySelector<HTMLElement>('[part="chip"]');
  if (!chip) {
    throw new Error(`row ${prop} has no clear chip`);
  }
  pointer(chip, "click");
}

/** Whether a row draws its clear dot at all — §4.2's "set on this document". */
function hasChip(scope: ParentNode, prop: string): boolean {
  return row(scope, prop).querySelector('[part="chip"]') !== null;
}

/** The labels a picker offers, in the order they are offered. */
function options(scope: ParentNode, prop: string): string[] {
  return [...widget(scope, prop).querySelectorAll('option[part="option"] [part="text"]')].map(
    (t) => t.textContent?.trim() ?? "",
  );
}

function metaContent(doc: any, attr: string, keyName: string): string | undefined {
  return (doc.$head ?? []).find(
    (e: any) => e?.tagName === "meta" && e?.attributes?.[attr] === keyName,
  )?.attributes?.content;
}

beforeEach(() => {
  mediaCalls.length = 0;
  browseAnchor = null;
  browseCommit = null;
  uploadCommit = null;
  for (const stale of document.querySelectorAll("body > div:not([id])")) {
    stale.remove();
  }
  installMockPlatform();
  resetStudioState();
  closeAllTabs();
  invalidateLayoutPickerCache();
});

// ─── Page section ─────────────────────────────────────────────────────────────

describe("page section", () => {
  test("renders title with a set dot when present; the dot deletes doc.title", async () => {
    const drawn = await draw({ tagName: "div", title: "Hello" });
    const page = section(drawn.host, "page")!;
    expect(row(page, "title").querySelector('[part="row-name"]')?.textContent).toBe("Title");
    clearRow(page, "title");
    expect((drawn.doc as any).title).toBeUndefined();
  });

  test("committing a title sets doc.title; whitespace-only deletes it", async () => {
    const drawn = await draw({ tagName: "div" });
    const page = section(drawn.host, "page")!;
    expect(hasChip(page, "title")).toBe(false);
    setAndFire(page, "title", "My Page");
    expect((drawn.doc as any).title).toBe("My Page");
    setAndFire(page, "title", "   ");
    expect((drawn.doc as any).title).toBeUndefined();
  });

  test("description meta upserts: add, replace in place, then remove", async () => {
    const drawn = await draw({ tagName: "div" });
    const page = section(drawn.host, "page")!;
    setAndFire(page, "description", "First");
    expect(metaContent(drawn.doc, "name", "description")).toBe("First");
    expect((drawn.doc as any).$head.length).toBe(1);
    setAndFire(page, "description", "Second");
    expect(metaContent(drawn.doc, "name", "description")).toBe("Second");
    expect((drawn.doc as any).$head.length).toBe(1); // Replaced, not appended
    setAndFire(page, "description", "");
    expect(metaContent(drawn.doc, "name", "description")).toBeUndefined();
    expect((drawn.doc as any).$head.length).toBe(0);
  });

  test("viewport field gets the canonical placeholder", async () => {
    const drawn = await draw({ tagName: "div" });
    expect(control(section(drawn.host, "page")!, "viewport").getAttribute("placeholder")).toBe(
      "width=device-width, initial-scale=1",
    );
  });

  test("icon row draws the media control; the dot removes the link entry", async () => {
    const head: JxHeadEntry[] = [
      { attributes: { href: "/favicon.ico", rel: "icon" }, tagName: "link" },
    ];
    const drawn = await draw({ $head: head, tagName: "div" });
    const page = section(drawn.host, "page")!;
    expect(row(page, "icon").querySelector('[part="media"]')).not.toBeNull();
    clearRow(page, "icon");
    expect((drawn.doc as any).$head.length).toBe(0);
  });

  test("the icon field upserts the link entry (add, then replace in place)", async () => {
    const drawn = await draw({ tagName: "div" });
    const page = section(drawn.host, "page")!;
    setAndFire(page, "icon", "/icon.svg");
    expect((drawn.doc as any).$head[0].attributes.href).toBe("/icon.svg");
    setAndFire(page, "icon", "/icon2.svg");
    expect((drawn.doc as any).$head.filter((e: any) => e?.attributes?.rel === "icon").length).toBe(
      1,
    );
    expect((drawn.doc as any).$head[0].attributes.href).toBe("/icon2.svg");
  });

  test("typing into a field commits once, after the live-preview pause", async () => {
    /* Captured rather than immediate timers, because `withImmediateTimers` stubs `clearTimeout` to
       a no-op: the first keystroke's timer then survived the second, on the REAL queue, and fired
       `LIVE_PREVIEW` later into whatever document the panel held by then — which is a stray
       `description: half` in a test several hundred milliseconds down the file, appearing only when
       the suite ran slowly enough. Cancelling for real is also the stronger assertion: a survivor
       here would overwrite "whole" with "half" rather than escaping into another test. */
    const drawn = await draw({ tagName: "div" });
    const page = section(drawn.host, "page")!;
    withCapturedTimers((runPending) => {
      // Un-flushed: the reader is still typing, so nothing has been written.
      setAndFire(page, "description", "half", "input");
      expect(metaContent(drawn.doc, "name", "description")).toBeUndefined();
      setAndFire(page, "description", "whole", "input");
      runPending();
    });
    expect(metaContent(drawn.doc, "name", "description")).toBe("whole");
  });

  test("a half-typed edit is dropped when the panel changes document, not landed on the next one", async () => {
    /* The debounce belongs to the DOCUMENT it was typed into. The panel keeps its host across a tab
       switch, so cancelling only on a new host let a queued commit outlive its subject and write,
       `LIVE_PREVIEW` later, into whatever was open by then. */
    const first = await draw({ tagName: "div" });
    const next = { tagName: "section" } as unknown as JxMutableNode;

    withCapturedTimers((runPending) => {
      setAndFire(section(first.host, "page")!, "description", "half", "input");
      renderPagePanel(first.host, {
        applyMutation: (fn) => {
          fn(next);
        },
        document: next,
        renderLeftPanel: () => {},
      });
      runPending();
    });

    expect(metaContent(next, "name", "description")).toBeUndefined();
    expect(metaContent(first.doc, "name", "description")).toBeUndefined();
  });
});

// ─── The media picker's two behaviours ───────────────────────────────────────

describe("media rows reach the shared picker rather than drawing one", () => {
  test("Browse opens the popover under the button and commits what it returns", async () => {
    const drawn = await draw({ tagName: "div" });
    const page = section(drawn.host, "page")!;
    const browse = row(page, "icon").querySelector<HTMLElement>('[part="browse"]')!;
    pointer(browse, "click");
    await flush(2);
    expect(mediaCalls).toEqual(["browse"]);
    expect(browseAnchor).toBe(browse);
    browseCommit!("/from-browser.png");
    expect((drawn.doc as any).$head[0].attributes.href).toBe("/from-browser.png");
  });

  test("Upload opens the OS picker and assigns what comes back", async () => {
    const drawn = await draw({ tagName: "div" });
    const og = section(drawn.host, "opengraph")!;
    pointer(row(og, "og:image").querySelector<HTMLElement>('[part="upload"]')!, "click");
    await flush(2);
    expect(mediaCalls).toEqual(["upload"]);
    uploadCommit!("/uploaded.png");
    expect(metaContent(drawn.doc, "property", "og:image")).toBe("/uploaded.png");
  });

  test("an image value draws a thumbnail; a non-image draws none", async () => {
    const withImage = await draw({
      $head: [{ attributes: { content: "/card.png", property: "og:image" }, tagName: "meta" }],
      tagName: "div",
    });
    expect(
      row(section(withImage.host, "opengraph")!, "og:image").querySelector('[part="thumb"]'),
    ).not.toBeNull();

    const withText = await draw({
      $head: [{ attributes: { content: "not-an-image", property: "og:image" }, tagName: "meta" }],
      tagName: "div",
    });
    expect(
      row(section(withText.host, "opengraph")!, "og:image").querySelector('[part="thumb"]'),
    ).toBeNull();
  });
});

// ─── OpenGraph section ────────────────────────────────────────────────────────

describe("opengraph section", () => {
  test("og:description is a multiline field; og:image draws the media control", async () => {
    const drawn = await draw({ tagName: "div" });
    const og = section(drawn.host, "opengraph")!;
    // "Multiline" is a fact about the control a reader types into, not about an attribute.
    expect(control(og, "og:description").tagName.toLowerCase()).toBe("textarea");
    expect(row(og, "og:image").querySelector('[part="media"]')).not.toBeNull();
  });

  test("og:image commits a meta entry and its dot clears it", async () => {
    const head: JxHeadEntry[] = [
      { attributes: { content: "/old.png", property: "og:image" }, tagName: "meta" },
    ];
    const drawn = await draw({ $head: head, tagName: "div" });
    const og = section(drawn.host, "opengraph")!;
    setAndFire(og, "og:image", "/new.png");
    expect(metaContent(drawn.doc, "property", "og:image")).toBe("/new.png");
    clearRow(og, "og:image");
    expect(metaContent(drawn.doc, "property", "og:image")).toBeUndefined();
  });

  test("og:title shows the existing value, commits trimmed updates, and its dot clears", async () => {
    const head: JxHeadEntry[] = [
      { attributes: { content: "Old", property: "og:title" }, tagName: "meta" },
    ];
    const drawn = await draw({ $head: head, tagName: "div" });
    const og = section(drawn.host, "opengraph")!;
    expect(control(og, "og:title").value).toBe("Old");
    setAndFire(og, "og:title", "  New OG  ");
    expect(metaContent(drawn.doc, "property", "og:title")).toBe("New OG");
    clearRow(og, "og:title");
    expect(metaContent(drawn.doc, "property", "og:title")).toBeUndefined();
  });
});

// ─── The door to Search appearance ───────────────────────────────────────────

describe("the door to Search appearance", () => {
  test("the button runs the shared command rather than opening the modal itself", async () => {
    const ran: string[] = [];
    const registry = createCommandRegistry({ getContext: emptyContext });
    registry.register({
      category: "Document",
      id: "document.openSeo",
      level: "document",
      run: () => {
        ran.push("document.openSeo");
      },
      title: "Search Appearance",
      undo: "none",
    });
    setActiveRegistry(registry);
    try {
      const drawn = await draw({ tagName: "div" });
      const button = section(drawn.host, "page")!.querySelector<HTMLElement>(
        '[part="seo-button"]',
      )!;
      expect(button.textContent?.trim()).toBe("Search appearance…");
      pointer(button, "click");
      expect(ran).toEqual(["document.openSeo"]);
      // Ran THROUGH the registry, which is still the active one: the button opened nothing itself.
      expect(activeRegistry()).toBe(registry);
      // One door per surface and only one of them: OpenGraph does not offer a second.
      expect(drawn.host.querySelectorAll('[part="seo-button"]')).toHaveLength(1);
    } finally {
      setActiveRegistry(null);
    }
  });
});

// ─── Custom entries ───────────────────────────────────────────────────────────

describe("custom $head entries", () => {
  const managed: JxHeadEntry[] = [
    { attributes: { content: "d", name: "description" }, tagName: "meta" },
    { attributes: { content: "t", property: "og:title" }, tagName: "meta" },
    { attributes: { href: "/f.ico", rel: "icon" }, tagName: "link" },
  ];
  const fonts: JxHeadEntry[] = [
    {
      attributes: {
        href: "https://fonts.googleapis.com/css2?family=Inter&display=swap",
        rel: "stylesheet",
      },
      tagName: "link",
    },
    { attributes: { href: "https://fonts.googleapis.com", rel: "preconnect" }, tagName: "link" },
    {
      attributes: { crossorigin: "", href: "https://fonts.gstatic.com", rel: "preconnect" },
      tagName: "link",
    },
  ];
  const custom: JxHeadEntry[] = [
    { attributes: { charset: "utf8" }, tagName: "meta" },
    { attributes: { src: "/app.js" }, tagName: "script" },
    { attributes: { href: "/c", rel: "canonical" }, tagName: "link" },
    { attributes: { content: "Jx", name: "generator" }, tagName: "meta" },
    { attributes: { content: "x", property: "og:custom" }, tagName: "meta" },
    { tagName: "style", textContent: ".a{color:red}" } as JxHeadEntry,
  ];

  /** The custom-tag rows, as the pair of strings each one prints. */
  function tags(host: HTMLElement): { name: string; value: string }[] {
    return [...section(host, "custom")!.querySelectorAll('[part="tag-row"]')].map((r) => ({
      name: r.querySelector('[part="tag-name"]')?.textContent ?? "",
      value: r.querySelector('[part="tag-value"]')?.textContent ?? "",
    }));
  }

  test("filters managed and font entries and labels each custom entry", async () => {
    const drawn = await draw({ $head: [...managed, ...fonts, ...custom], tagName: "div" });
    expect(section(drawn.host, "custom")!.querySelector('[part="count"]')?.textContent).toBe("6");
    expect(tags(drawn.host)).toEqual([
      { name: '<meta charset="utf8">', value: "" },
      { name: '<script src="/app.js">', value: "/app.js" },
      { name: '<link rel="canonical">', value: "/c" },
      { name: '<meta name="generator">', value: "Jx" },
      { name: '<meta property="og:custom">', value: "x" },
      { name: "<style>", value: ".a{color:red}" },
    ]);
  });

  test("an entry without a tagName is labelled unknown", async () => {
    const drawn = await draw({
      $head: [{ textContent: "?" } as unknown as JxHeadEntry],
      tagName: "div",
    });
    expect(tags(drawn.host)[0]?.name).toBe("unknown");
  });

  test("says what custom tags are for when there are none", async () => {
    const drawn = await draw({ $head: [...managed], tagName: "div" });
    const band = section(drawn.host, "custom")!;
    expect(band.querySelector('[part="empty"]')?.textContent).toContain(
      "Custom tags add your own meta, link and script elements",
    );
    expect(band.querySelector('[part="count"]')?.textContent).toBe("0");
  });

  test("Remove splices the entry it names and re-renders the left panel", async () => {
    const drawn = await draw({ $head: [...custom], tagName: "div" });
    const first = section(drawn.host, "custom")!.querySelector('[part="tag-row"]')!;
    // The button says which tag it takes away, so a screen reader is not left counting rows.
    expect(
      first.querySelector('[part="remove"] [part="control"]')?.getAttribute("aria-label"),
    ).toBe('Remove <meta charset="utf8">');
    pointer(first.querySelector('[part="remove"]')!, "click");
    expect((drawn.doc as any).$head.length).toBe(5);
    expect((drawn.doc as any).$head.some((e: any) => e?.attributes?.charset === "utf8")).toBe(
      false,
    );
    expect(drawn.leftPanelRenders).toBe(1);
  });
});

// ─── Add custom tag form ──────────────────────────────────────────────────────

describe("add custom tag form", () => {
  /** One field of the add form, by the half of the entry it holds. */
  function draft(host: HTMLElement, name: string): HTMLInputElement {
    return host.querySelector(
      `[part="add"] [data-field="${name}"] [part="input"], [part="add"] [data-field="${name}"] [part="control"]`,
    ) as HTMLInputElement;
  }

  function type(host: HTMLElement, name: string, value: string): void {
    const el = draft(host, name);
    el.value = value;
    el.dispatchEvent(new Event(name === "tag" ? "change" : "input", { bubbles: true }));
  }

  test("adds a meta entry by default and clears the typed fields", async () => {
    const drawn = await draw({ tagName: "div" });
    type(drawn.host, "attr", "author");
    type(drawn.host, "value", "Jane");
    await flush(2);
    pointer(drawn.host.querySelector('[part="add-button"]')!, "click");
    expect((drawn.doc as any).$head).toEqual([
      { attributes: { content: "Jane", name: "author" }, tagName: "meta" },
    ]);
    await flush(2);
    expect(draft(drawn.host, "attr").value).toBe("");
    expect(draft(drawn.host, "value").value).toBe("");
    expect(drawn.leftPanelRenders).toBe(1);
  });

  test("adds link and script entries with the right attribute mapping", async () => {
    const drawn = await draw({ tagName: "div" });
    const add = () => pointer(drawn.host.querySelector('[part="add-button"]')!, "click");

    type(drawn.host, "tag", "link");
    type(drawn.host, "attr", "preload");
    type(drawn.host, "value", "/x.css");
    await flush(2);
    add();
    expect((drawn.doc as any).$head.at(-1)).toEqual({
      attributes: { href: "/x.css", rel: "preload" },
      tagName: "link",
    });

    await flush(2);
    type(drawn.host, "tag", "script");
    type(drawn.host, "attr", "src");
    type(drawn.host, "value", "/x.js");
    await flush(2);
    add();
    expect((drawn.doc as any).$head.at(-1)).toEqual({
      attributes: { src: "/x.js" },
      tagName: "script",
    });
  });

  test("Enter in either field adds the entry", async () => {
    const drawn = await draw({ tagName: "div" });
    type(drawn.host, "attr", "robots");
    type(drawn.host, "value", "noindex");
    await flush(2);
    draft(drawn.host, "value").dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect((drawn.doc as any).$head).toEqual([
      { attributes: { content: "noindex", name: "robots" }, tagName: "meta" },
    ]);
  });

  test("does nothing when the attribute or the value is missing", async () => {
    const drawn = await draw({ tagName: "div" });
    type(drawn.host, "attr", "only-attr");
    type(drawn.host, "value", "  ");
    await flush(2);
    pointer(drawn.host.querySelector('[part="add-button"]')!, "click");
    expect((drawn.doc as any).$head).toBeUndefined();
    expect(drawn.mutations).toBe(0);
  });
});

// ─── Layout section ───────────────────────────────────────────────────────────

function layoutDirEntries() {
  return [
    { name: "main-layout.json", path: "layouts/main-layout.json", type: "file" },
    { name: "blog.json", path: "layouts/blog.json", type: "file" },
    { name: "partials", path: "layouts/partials", type: "directory" },
    { name: "notes.txt", path: "layouts/notes.txt", type: "file" },
  ] as any[];
}

function setupSitePage(documentPath = "pages/about.json") {
  const counters = { layoutLists: 0 };
  installMockPlatform({
    listDirectory: async (dir: string) => {
      if (dir === "layouts") {
        counters.layoutLists += 1;
        return layoutDirEntries() as any;
      }
      return [];
    },
  } as any);
  resetStudioState({
    isSiteProject: true,
    projectConfig: { defaults: { layout: "./layouts/main-layout.json" } },
  });
  resetWorkspaceWithTab(undefined, { documentPath });
  return counters;
}

describe("layout section", () => {
  test("absent for non-site projects and non-page paths", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    resetWorkspaceWithTab(undefined, { documentPath: "components/x.json" });
    let drawn = await draw({ tagName: "div" });
    expect(section(drawn.host, "layout")).toBeNull();

    resetStudioState({ isSiteProject: false, projectConfig: {} });
    resetWorkspaceWithTab(undefined, { documentPath: "pages/x.json" });
    drawn = await draw({ tagName: "div" });
    expect(section(drawn.host, "layout")).toBeNull();
  });

  test("first paint kicks off the layout listing; the next one shows the picker", async () => {
    const counters = setupSitePage();
    const first = await draw({ tagName: "div" });
    expect(section(first.host, "layout")).toBeNull(); // Still loading
    await flush();
    expect(counters.layoutLists).toBe(1);

    const second = await draw({ tagName: "div" });
    const layout = section(second.host, "layout")!;
    expect(options(layout, "layout")).toEqual([
      "Default (Main Layout)",
      "None",
      "Main Layout",
      "Blog",
    ]); // Only .json files, prettified
    expect(control(layout, "layout").value).toBe("__default__");
  });

  test("works with ./pages/ prefixed paths and reflects explicit and false layouts", async () => {
    setupSitePage("./pages/about.json");
    await draw({ tagName: "div" });
    await flush();

    let drawn = await draw({ $layout: "./layouts/blog.json", tagName: "div" });
    expect(control(section(drawn.host, "layout")!, "layout").value).toBe("./layouts/blog.json");

    drawn = await draw({ $layout: false, tagName: "div" });
    expect(control(section(drawn.host, "layout")!, "layout").value).toBe("__none__");
  });

  test("picking writes $layout as a path, as false, or deletes it", async () => {
    setupSitePage();
    await draw({ tagName: "div" });
    await flush();
    const drawn = await draw({ tagName: "div" });
    const layout = section(drawn.host, "layout")!;

    setAndFire(layout, "layout", "./layouts/blog.json");
    expect((drawn.doc as any).$layout).toBe("./layouts/blog.json");
    setAndFire(layout, "layout", "__none__");
    expect((drawn.doc as any).$layout).toBe(false);
    setAndFire(layout, "layout", "__default__");
    expect("$layout" in (drawn.doc as any)).toBe(false);
  });

  test("the clear dot removes an explicit $layout", async () => {
    setupSitePage();
    await draw({ tagName: "div" });
    await flush();
    const drawn = await draw({ $layout: "./layouts/blog.json", tagName: "div" });
    clearRow(section(drawn.host, "layout")!, "layout");
    expect((drawn.doc as any).$layout).toBeUndefined();
  });

  test("a listing failure falls back to an empty layout list", async () => {
    installMockPlatform({
      listDirectory: async () => {
        throw new Error("boom");
      },
    } as any);
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    resetWorkspaceWithTab(undefined, { documentPath: "pages/p.json" });
    await draw({ tagName: "div" });
    await flush();
    const drawn = await draw({ tagName: "div" });
    // No default label without config.
    expect(options(section(drawn.host, "layout")!, "layout")).toEqual(["Default", "None"]);
  });

  test("invalidateLayoutPickerCache forces a reload on the next paint", async () => {
    const counters = setupSitePage();
    await draw({ tagName: "div" });
    await flush();
    invalidateLayoutPickerCache();
    const drawn = await draw({ tagName: "div" });
    expect(section(drawn.host, "layout")).toBeNull(); // Loading again
    await flush();
    expect(counters.layoutLists).toBe(2);
  });
});

// ─── Frontmatter section ──────────────────────────────────────────────────────

const FM_SCHEMA = {
  properties: {
    category: { enum: ["news", "guide"] },
    date: { format: "date", type: "string" },
    description: { type: "string" },
    draft: { type: "boolean" },
    hero: { format: "image", type: "string" },
    tags: { type: "array" },
    title: { type: "string" },
    weight: { type: "number" },
  },
  required: ["description"],
};

function setupContentTab(
  frontmatter: Record<string, unknown>,
  withSchema = true,
  documentPath = "posts/hello.json",
) {
  installMockPlatform();
  resetStudioState({
    projectConfig: withSchema
      ? { content: { posts: { format: "json", schema: FM_SCHEMA, source: "./posts" } } }
      : {},
  });
  closeAllTabs();
  const tab = resetWorkspaceWithTab(undefined, { documentPath });
  (tab as any).doc.mode = "content";
  (tab as any).doc.content.frontmatter = frontmatter;
  return tab as any;
}

describe("frontmatter section", () => {
  test("hidden in component mode even when frontmatter exists", async () => {
    const tab = setupContentTab({ description: "x" });
    tab.doc.mode = "component";
    const drawn = await draw({ tagName: "div" });
    expect(section(drawn.host, "frontmatter")).toBeNull();
  });

  test("schema-driven fields draw type-specific controls and the required marker", async () => {
    setupContentTab({ draft: true, extra: "loose", tags: ["a", "b"], title: "skip me" });
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    expect(heading(drawn.host, "frontmatter")).toBe("Frontmatter (posts)");
    expect(fm.querySelector('[data-prop="title"]')).toBeNull(); // Reserved by the Title row
    expect(widget(fm, "draft").tagName.toLowerCase()).toBe("jx-checkbox");
    expect(control(fm, "tags").value).toBe("a, b");
    expect(widget(fm, "category").tagName.toLowerCase()).toBe("jx-select");
    expect(options(fm, "category")).toEqual(["—", "news", "guide"]);
    expect(row(fm, "hero").querySelector('[part="media"]')).not.toBeNull();
    expect(widget(fm, "weight").tagName.toLowerCase()).toBe("jx-number-field");
    expect(control(fm, "date").getAttribute("placeholder")).toBe("YYYY-MM-DD");
    expect(row(fm, "description").querySelector('[part="row-name"]')?.textContent).toBe(
      "Description *",
    );
    // A loose frontmatter key not in the schema still draws as a string field.
    expect(control(fm, "extra").value).toBe("loose");
  });

  test("matches the content type when the document path uses Windows backslashes", async () => {
    // The desktop platform on Windows hands the studio backslash paths.
    // Format-driven controls (e.g. the image picker) must still resolve from the schema.
    setupContentTab({ hero: "x.png" }, true, String.raw`posts\hello.json`);
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    expect(heading(drawn.host, "frontmatter")).toBe("Frontmatter (posts)");
    expect(row(fm, "hero").querySelector('[part="media"]')).not.toBeNull();
  });

  test("the checkbox toggles boolean frontmatter; unchecking deletes the field", async () => {
    const tab = setupContentTab({});
    const drawn = await draw({ tagName: "div" });
    const box = control(section(drawn.host, "frontmatter")!, "draft");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(tab.doc.content.frontmatter.draft).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect("draft" in tab.doc.content.frontmatter).toBe(false);
  });

  test("an array field parses comma-separated input and clears on empty", async () => {
    const tab = setupContentTab({});
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    setAndFire(fm, "tags", "x, y ,, z");
    expect(tab.doc.content.frontmatter.tags).toEqual(["x", "y", "z"]);
    setAndFire(fm, "tags", "");
    expect("tags" in tab.doc.content.frontmatter).toBe(false);
  });

  test("an enum picker sets and clears the field", async () => {
    const tab = setupContentTab({ category: "news" });
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    setAndFire(fm, "category", "guide");
    expect(tab.doc.content.frontmatter.category).toBe("guide");
    setAndFire(fm, "category", "");
    expect("category" in tab.doc.content.frontmatter).toBe(false);
  });

  test("a number field commits numbers and deletes on empty or NaN", async () => {
    const tab = setupContentTab({ weight: 1 });
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    setAndFire(fm, "weight", "42");
    expect(tab.doc.content.frontmatter.weight).toBe(42);
    setAndFire(fm, "weight", "");
    expect("weight" in tab.doc.content.frontmatter).toBe(false);
    setAndFire(fm, "weight", "abc");
    expect("weight" in tab.doc.content.frontmatter).toBe(false);
  });

  test("a string field commits text; the clear dot deletes the value", async () => {
    const tab = setupContentTab({ description: "old" });
    const drawn = await draw({ tagName: "div" });
    setAndFire(section(drawn.host, "frontmatter")!, "description", "fresh");
    expect(tab.doc.content.frontmatter.description).toBe("fresh");

    // Repaint to get a dot bound to the new value, then clear it.
    const second = await draw({ tagName: "div" });
    clearRow(section(second.host, "frontmatter")!, "description");
    expect("description" in tab.doc.content.frontmatter).toBe(false);
  });

  test("without a schema, fields are inferred from the frontmatter values", async () => {
    setupContentTab(
      { $hidden: "skip", published: false, publishDate: "2026-01-01", title: "skip" },
      false,
    );
    const drawn = await draw({ tagName: "div" });
    const fm = section(drawn.host, "frontmatter")!;
    expect(heading(drawn.host, "frontmatter")).toBe("Frontmatter");
    expect(widget(fm, "published").tagName.toLowerCase()).toBe("jx-checkbox");
    expect(row(fm, "publishDate").querySelector('[part="row-name"]')?.textContent).toBe(
      "Publish Date",
    );
    expect(fm.querySelector('[data-prop="$hidden"]')).toBeNull();
    expect(fm.querySelector('[data-prop="title"]')).toBeNull();
  });

  test("the section is omitted entirely with no schema and no displayable fields", async () => {
    setupContentTab({ $internal: "x", title: "only reserved" }, false);
    const drawn = await draw({ tagName: "div" });
    expect(section(drawn.host, "frontmatter")).toBeNull();
  });
});

// ─── The panel record, and which document it is drawn for ────────────────────

/*
 * These four moved here from `tests/left-panel.test.ts`, where they read the arguments the
 * Navigator handed a lit renderer. The renderer is gone, so what they assert is asserted through
 * the record itself: `afterRender` mounts the document, and the contract is which document it draws
 * and where a commit lands. `left-panel.test.ts` goes on covering the Navigator's own routing.
 */
describe("the Page panel record", () => {
  /**
   * Run the registered panel's `afterRender` against a body the Navigator would have drawn.
   *
   * The record is what is under test, so it is asked for by id rather than called directly: the
   * mount seam a panel gets is `.panel-content` inside the body, and a record that returned markup
   * instead would leave that node empty.
   */
  async function paint(tab: Tab): Promise<HTMLElement> {
    resetPanels();
    registerPagePanel();
    const record = getPanel("page")!;
    const body = document.createElement("div");
    body.innerHTML = '<div class="panel-content"></div>';
    document.body.append(body);
    // `render` draws nothing: the document is mounted in `afterRender` and lit owns the body.
    expect(record.render({ deps: {} as never, doc: null, rerender: () => {} })).toBe(nothing);
    record.afterRender!(
      {
        deps: {} as never,
        doc: {
          canvas: null,
          content: tab.doc.content,
          document: tab.doc.document,
          documentPath: tab.documentPath,
          mode: tab.doc.mode,
          selection: [],
          ui: tab.session.ui,
        },
        rerender: () => {},
      },
      body,
    );
    await flush(4);
    return body;
  }

  test("a JSON document is drawn from its root node and transacts mutations directly", async () => {
    resetStudioState();
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "pages/a.json" }) as Tab;
    const body = await paint(tab);
    const page = body.querySelector<HTMLElement>('[data-section="page"]')!;
    setAndFire(page, "title", "Page title");
    expect(tab.doc.document.title).toBe("Page title");
    expect(tab.doc.dirty).toBe(true);
  });

  test("a content document is drawn from its frontmatter title and $head", async () => {
    resetStudioState();
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "posts/a.md" }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = {
      $head: [{ attributes: { content: "d", name: "description" }, tagName: "meta" }],
      title: "FM Title",
    };
    const body = await paint(tab as Tab);
    const page = body.querySelector<HTMLElement>('[data-section="page"]')!;
    expect(control(page, "title").value).toBe("FM Title");
    expect(control(page, "description").value).toBe("d");
  });

  test("a content document's title and $head are committed into its frontmatter", async () => {
    resetStudioState();
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "posts/b.md" }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = { title: "Old" };
    const body = await paint(tab as Tab);
    const page = body.querySelector<HTMLElement>('[data-section="page"]')!;
    setAndFire(page, "title", "New");
    expect(tab.doc.content.frontmatter.title).toBe("New");
    setAndFire(page, "description", "Fresh");
    expect(tab.doc.content.frontmatter.$head).toEqual([
      { attributes: { content: "Fresh", name: "description" }, tagName: "meta" },
    ]);
    expect(tab.doc.dirty).toBe(true);
  });

  test("emptying the last $head entry clears the frontmatter key rather than leaving []", async () => {
    resetStudioState();
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "posts/c.md" }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = {
      $head: [{ attributes: { content: "x", name: "description" }, tagName: "meta" }],
      title: "Same",
    };
    const body = await paint(tab as Tab);
    const page = body.querySelector<HTMLElement>('[data-section="page"]')!;
    setAndFire(page, "description", "");
    expect(tab.doc.content.frontmatter.$head).toBeUndefined();
    expect(tab.doc.content.frontmatter.title).toBe("Same");
  });
});

// ─── The merged `$head`, as a preview model ───────────────────────────────────

/**
 * The half of the SEO block that has no DOM: resolving what actually reaches the browser out of
 * site → layout → page, and naming the layer it came from.
 *
 * These assertions are the contract with `packages/compiler/src/site/head-merger.ts`. Studio does
 * not depend on `@jxsuite/compiler`, so nothing mechanical keeps the two in step — this is what
 * fails if the merger's precedence, its `<title>` handling or its canonical rule ever changes.
 */

const meta = (attr: "name" | "property", key: string, content: string): JxHeadEntry => ({
  attributes: { [attr]: key, content },
  tagName: "meta",
});

function layers(over: Partial<HeadLayers> = {}): HeadLayers {
  return { layout: [], layoutName: null, page: [], site: [], ...over };
}

function warningIds(preview: SeoPreview): string[] {
  return preview.warnings.map((w) => w.id);
}

describe("resolveMetaField — later layer wins, and says which one spoke", () => {
  test("the page's own entry is `set here`, with no donor to name", () => {
    const field = resolveMetaField(
      layers({
        page: [meta("name", "description", "the page")],
        site: [meta("name", "description", "the site")],
      }),
      "name",
      "description",
    );
    expect(field).toEqual({ donor: null, source: "page", value: "the page" });
  });

  test("a layout entry is inherited from the layout, by name", () => {
    const field = resolveMetaField(
      layers({ layout: [meta("name", "description", "from base")], layoutName: "Base" }),
      "name",
      "description",
    );
    expect(field).toEqual({ donor: "Base", source: "layout", value: "from base" });
  });

  test("an unnamed layout still names itself as something", () => {
    const field = resolveMetaField(
      layers({ layout: [meta("name", "description", "x")] }),
      "name",
      "description",
    );
    expect(field.donor).toBe("the layout");
  });

  test("a site entry is inherited from Site head", () => {
    const field = resolveMetaField(
      layers({ site: [meta("property", "og:image", "/card.png")] }),
      "property",
      "og:image",
    );
    expect(field).toEqual({ donor: "Site head", source: "site", value: "/card.png" });
  });

  test("nothing anywhere resolves to `none`, not to an empty page value", () => {
    expect(resolveMetaField(layers(), "name", "description").source).toBe("none");
  });

  test("the LAST entry in a layer wins — the merger folds a layer into a keyed map in order", () => {
    const field = resolveMetaField(
      layers({
        page: [meta("name", "description", "first"), meta("name", "description", "second")],
      }),
      "name",
      "description",
    );
    expect(field.value).toBe("second");
  });

  test("an empty page entry SHADOWS the site's, because the merged map is keyed", () => {
    const field = resolveMetaField(
      layers({
        page: [meta("name", "description", "")],
        site: [meta("name", "description", "the site")],
      }),
      "name",
      "description",
    );
    expect(field).toEqual({ donor: null, source: "page", value: "" });
  });
});

describe("resolveTitleField — page title, then the site name, then the build", () => {
  test("the page's title wins and is trimmed", () => {
    expect(resolveTitleField("  Hello  ", "Acme")).toEqual({
      donor: null,
      source: "page",
      value: "Hello",
    });
  });

  test("a blank page title falls through to the site name", () => {
    expect(resolveTitleField("   ", "Acme")).toEqual({
      donor: "Site name",
      source: "site",
      value: "Acme",
    });
  });

  test("with neither, the build supplies one and is named as the donor", () => {
    expect(resolveTitleField("")).toEqual({
      donor: "the build",
      source: "build",
      value: BUILD_FALLBACK_TITLE,
    });
    expect(resolveTitleField("", "   ")).toEqual({
      donor: "the build",
      source: "build",
      value: BUILD_FALLBACK_TITLE,
    });
  });
});

describe("resolveSeoUrl — the canonical the build would emit, or the honest absence", () => {
  test("a site URL and a route produce a breadcrumb, a host and an href", () => {
    expect(resolveSeoUrl("/blog/hello", "https://example.com")).toEqual({
      crumb: "example.com › blog › hello",
      host: "example.com",
      href: "https://example.com/blog/hello",
    });
  });

  test("the site root is just the host", () => {
    expect(resolveSeoUrl("/", "https://example.com").crumb).toBe("example.com");
  });

  test("no site URL means no canonical — the build emits none either", () => {
    expect(resolveSeoUrl("/blog/hello")).toEqual({
      crumb: "/blog/hello",
      host: "",
      href: null,
    });
  });

  test("a document with no route (not a page) has no canonical", () => {
    expect(resolveSeoUrl(null, "https://example.com")).toEqual({
      crumb: "/",
      host: "",
      href: null,
    });
  });

  test("a malformed site URL degrades to the route instead of throwing", () => {
    expect(resolveSeoUrl("/about", "not a url")).toEqual({
      crumb: "/about",
      host: "",
      href: null,
    });
  });
});

describe("buildSeoPreview — the six fields, in render order, with their budgets", () => {
  test("every previewed key is present, once, with the limit that applies to it", () => {
    const preview = buildSeoPreview(layers(), { pageTitle: "T", route: "/" });
    expect(preview.fields.map((f) => f.key)).toEqual([
      "title",
      "description",
      "og:title",
      "og:description",
      "og:image",
      "og:type",
    ]);
    expect(preview.fields.map((f) => f.limit)).toEqual([60, 160, 60, 200, null, null]);
  });

  test("seoField looks a key up, and invents an unsupplied one rather than throwing", () => {
    const preview = buildSeoPreview(layers(), { pageTitle: "T", route: "/" });
    expect(seoField(preview, "title").value).toBe("T");
    expect(seoField(preview, "twitter:card")).toEqual({
      donor: null,
      key: "twitter:card",
      label: "twitter:card",
      limit: null,
      source: "none",
      value: "",
    });
  });
});

describe("seoWarnings — named consequences, never a total", () => {
  const full = () =>
    layers({
      page: [
        meta("name", "description", "A real description."),
        meta("property", "og:title", "Card title"),
        meta("property", "og:description", "Card summary."),
        meta("property", "og:image", "/card.png"),
      ],
    });

  test("a fully-described page with a site URL raises nothing at all", () => {
    const preview = buildSeoPreview(full(), {
      pageTitle: "Hello",
      route: "/hello",
      siteUrl: "https://example.com",
    });
    expect(preview.warnings).toEqual([]);
  });

  test("a page that INHERITS its description is never told it has none", () => {
    const inherited = buildSeoPreview(
      layers({
        page: [
          meta("property", "og:title", "t"),
          meta("property", "og:description", "d"),
          meta("property", "og:image", "/i.png"),
        ],
        site: [meta("name", "description", "the site's own description")],
      }),
      { pageTitle: "Hello", route: "/hello", siteUrl: "https://example.com" },
    );
    expect(warningIds(inherited)).toEqual([]);
    expect(seoField(inherited, "description").source).toBe("site");
  });

  test("each absent field raises its own named warning, and they do not merge", () => {
    const preview = buildSeoPreview(layers(), { pageTitle: "Hello", route: "/hello" });
    expect(warningIds(preview)).toEqual([
      "description-missing",
      "og-title-missing",
      "og-description-missing",
      "og-image-missing",
      "site-url-missing",
    ]);
    expect(preview.warnings.map((w) => w.field)).toEqual([
      "description",
      "og:title",
      "og:description",
      "og:image",
      "url",
    ]);
  });

  test("no title anywhere names the string the build ships instead", () => {
    const preview = buildSeoPreview(full(), {
      pageTitle: "",
      route: "/hello",
      siteUrl: "https://example.com",
    });
    expect(warningIds(preview)).toEqual(["title-missing"]);
    expect(preview.warnings[0]!.message).toContain(BUILD_FALLBACK_TITLE);
  });

  test("a title inherited from the site name is NOT a missing title", () => {
    const preview = buildSeoPreview(full(), {
      pageTitle: "",
      route: "/hello",
      siteName: "Acme",
      siteUrl: "https://example.com",
    });
    expect(warningIds(preview)).toEqual([]);
    expect(seoField(preview, "title")).toMatchObject({ donor: "Site name", source: "site" });
  });

  test("over-budget fields are counted, not scored", () => {
    const long = layers({
      page: [
        meta("name", "description", "d".repeat(161)),
        meta("property", "og:title", "t"),
        meta("property", "og:description", "s"),
        meta("property", "og:image", "/i.png"),
      ],
    });
    const preview = buildSeoPreview(long, {
      pageTitle: "T".repeat(61),
      route: "/hello",
      siteUrl: "https://example.com",
    });
    expect(warningIds(preview)).toEqual(["title-long", "description-long"]);
    expect(preview.warnings[0]!.message).toBe("Title is 61 characters; headlines are cut near 60.");
    expect(preview.warnings[1]!.message).toBe(
      "Description is 161 characters; summaries are cut near 160.",
    );
    // Nothing sums them. The report IS the list.
    expect(Object.keys(preview)).toEqual(["fields", "url", "warnings"]);
  });

  test("an og:description over budget says `summaries`, matching its shape not its label", () => {
    const longSummary = "s".repeat(201);
    const page = [
      meta("name", "description", "d"),
      meta("property", "og:title", "t"),
      meta("property", "og:description", longSummary),
      meta("property", "og:image", "/i.png"),
    ];
    const preview = buildSeoPreview(layers({ page }), {
      pageTitle: "T",
      route: "/h",
      siteUrl: "https://example.com",
    });
    expect(preview.warnings[0]!.message).toBe(
      "Social description is 201 characters; summaries are cut near 200.",
    );
  });

  test("a <title> in any layer is reported as discarded — the merger overwrites it", () => {
    for (const layer of ["site", "layout", "page"] as const) {
      const preview = buildSeoPreview(
        layers({ ...full(), [layer]: [...full().page, { tagName: "title", textContent: "x" }] }),
        { pageTitle: "Hello", route: "/hello", siteUrl: "https://example.com" },
      );
      expect(warningIds(preview)).toContain("head-title-ignored");
    }
  });
});

// ─── The layout layer ─────────────────────────────────────────────────────────

describe("layoutHeadEntries — the one layer that lives in a file", () => {
  const LAYOUT = JSON.stringify({
    $head: [{ attributes: { content: "from the layout", name: "description" }, tagName: "div" }],
    tagName: "div",
  });

  function seedLayout(body = LAYOUT) {
    installMockPlatform({}, { "layouts/main-layout.json": body });
    resetStudioState({
      isSiteProject: true,
      projectConfig: { defaults: { layout: "./layouts/main-layout.json" } },
    });
    return resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" }) as Tab;
  }

  beforeEach(() => {
    invalidateLayoutCache();
    invalidateLayoutHeadCache();
  });

  test("a non-page document never reads a layout at all", () => {
    resetStudioState({ isSiteProject: false, projectConfig: {} });
    const tab = resetWorkspaceWithTab(undefined, {
      documentPath: "components/card.json",
    }) as Tab;
    expect(layoutHeadEntries(tab)).toEqual({ entries: [], name: null });
  });

  test("the first call is empty and schedules the read; the second has the entries", async () => {
    const tab = seedLayout();
    expect(layoutHeadEntries(tab)).toEqual({ entries: [], name: "Main Layout" });
    await flush();
    const resolved = layoutHeadEntries(tab);
    expect(resolved.name).toBe("Main Layout");
    expect(resolved.entries).toHaveLength(1);
  });

  test("an unreadable layout caches as empty rather than re-reading on every render", async () => {
    installMockPlatform();
    resetStudioState({
      isSiteProject: true,
      projectConfig: { defaults: { layout: "./layouts/gone.json" } },
    });
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" }) as Tab;
    layoutHeadEntries(tab);
    await flush();
    expect(layoutHeadEntries(tab).entries).toEqual([]);
  });

  test("invalidateLayoutPickerCache drops the head too — one event, one answer", async () => {
    const tab = seedLayout();
    layoutHeadEntries(tab);
    await flush();
    expect(layoutHeadEntries(tab).entries).toHaveLength(1);
    invalidateLayoutPickerCache();
    expect(layoutHeadEntries(tab).entries).toEqual([]);
  });

  test("a second layout asked for mid-flight owns the cache; the first is discarded", async () => {
    const tab = seedLayout();
    layoutHeadEntries(tab, "./layouts/main-layout.json");
    layoutHeadEntries(tab, "./layouts/other.json");
    await flush();
    // The superseded read must not have written "Main Layout"'s entries under "Other".
    expect(layoutHeadEntries(tab, "./layouts/other.json").entries).toEqual([]);
  });

  test("layoutDisplayName reads a path the way a person names the layout", () => {
    expect(layoutDisplayName("./layouts/blog_post.json")).toBe("Blog Post");
    expect(layoutDisplayName("layouts/nested/marketing-page.json")).toBe("Nested Marketing Page");
  });

  test("seoPreviewFor reads the open document, its layout, and the project config", async () => {
    installMockPlatform(
      {},
      {
        "layouts/main-layout.json": JSON.stringify({
          $head: [
            { attributes: { content: "layout summary", name: "description" }, tagName: "meta" },
          ],
          tagName: "div",
        }),
      },
    );
    resetStudioState({
      isSiteProject: true,
      projectConfig: {
        $head: [
          { attributes: { content: "/site-card.png", property: "og:image" }, tagName: "meta" },
        ],
        defaults: { layout: "./layouts/main-layout.json" },
        name: "Acme",
        url: "https://acme.test",
      },
    });
    const tab = resetWorkspaceWithTab(undefined, { documentPath: "pages/about.json" }) as Tab;
    seoPreviewFor(tab, { tagName: "div" });
    await flush();

    const preview = seoPreviewFor(tab, { tagName: "div", title: "About" });
    expect(preview.url.href).toBe("https://acme.test/about");
    expect(seoField(preview, "title")).toMatchObject({ source: "page", value: "About" });
    expect(seoField(preview, "description")).toMatchObject({
      donor: "Main Layout",
      source: "layout",
      value: "layout summary",
    });
    expect(seoField(preview, "og:image")).toMatchObject({
      donor: "Site head",
      source: "site",
      value: "/site-card.png",
    });
  });
});

// ─── Counting what a reader sees ─────────────────────────────────────────────

describe("visibleLength", () => {
  test("counts graphemes, not UTF-16 code units", () => {
    /*
     * `String.length` is not a count of anything a person can see: an emoji is 2 code units, a flag
     * is 4, and a multi-person emoji with a zero-width joiner is more. A budget counter reporting
     * those numbers is wrong by exactly that margin.
     */
    expect(visibleLength("hello")).toBe(5);
    expect(visibleLength("🚀")).toBe(1);
    expect("🚀".length).toBe(2);
    expect(visibleLength("🇬🇧")).toBe(1);
    expect(visibleLength("👩‍🚀")).toBe(1);
    expect(visibleLength("café")).toBe(4);
    // A decomposed é is two code points and one grapheme.
    expect(visibleLength("café")).toBe(4);
    expect(visibleLength("")).toBe(0);
  });

  test("the over-limit warning counts the same way the badge does", () => {
    const long = "🚀".repeat(40);
    // 80 code units, 40 graphemes: the old counter called this over a 60-character title budget.
    expect(long.length).toBe(80);
    expect(visibleLength(long)).toBe(40);
  });
});
