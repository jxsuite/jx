/**
 * The Document Header card — the three deleted gates (collection, canvas mode, document mode), the
 * ONE reserved-key policy (`title` has a named row and never doubles as a generic property), the
 * Route line, the Raw-head disclosure, the door to Search appearance, the commit paths, and
 * reactive re-render.
 *
 * The SEO block left: it is a modal now (`tests/seo-modal.test.ts`), reachable from this card and
 * from the Page panel. What stays here is the BUTTON — that the card offers the door at all.
 *
 * The card has no host of its own: `#frontmatter-panel` is deleted and the STAGE hands one over.
 * These tests play the stage's part with `attachDocumentHeaderHost`; `canvas-render.test.ts` covers
 * where the stage actually puts it.
 *
 * **The card is a Jx document now** (`src/surfaces/doc-header.json`), so four things about this
 * file are deliberate rather than incidental:
 *
 * - Every assertion addresses a `part`, a `role` or a `data-prop`. There is no `sp-textfield`,
 *   `.doc-header-route` or `.set-dot` left to find, and a document may emit no class at all.
 * - The host is IN the document and every paint is awaited. A kit element renders in
 *   `connectedCallback`, so a detached host gets `<jx-textfield>` tags with nothing inside them and
 *   every assertion reads `null` — a failure that looks like a missing element rather than a
 *   missing connection.
 * - An edit is made on the NATIVE control inside the kit element (`[part="input"]` for a field,
 *   `[part="control"]` for a select or a checkbox), because that is what a reader's edit is: the
 *   element hears its own control's event and lets it bubble on. Writing the host's `value`
 *   property would move the element without ever telling the control.
 * - The media picker is DOUBLED. Its two behaviours reach the card through a lazy `import()`, so
 *   without a double there is nothing to assert against — and two real dynamic imports of one
 *   module can race Bun's coverage recorder into dropping the file.
 */
import {
  flush,
  installMockPlatform,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initShellRefs, registerRenderer } from "../src/store";
import {
  activateTab,
  activeTab,
  closeAllTabs,
  openTab,
  paneById,
  splitRight,
} from "../src/workspace/workspace";
import { mutateUpdateFrontmatter, transactDoc } from "../src/tabs/transact";
import { collectFmFields } from "../src/panels/frontmatter-fields";
import {
  RESERVED_FM_KEYS,
  invalidateLayoutHeadCache,
  invalidateLayoutPickerCache,
} from "../src/panels/head-panel";
import { invalidateReferenceEntries } from "../src/ui/form-controls";
import { invalidateLayoutCache } from "../src/site-context";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";

/** Every browse and upload the card asked the media picker for, in order. */
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

/**
 * The collection reader behind a `#/content/<type>` field, doubled.
 *
 * `ui/form-controls.ts` reaches it through a lazy `import()` — so, as with the media picker, a
 * double is both the witness and the thing that keeps two real dynamic imports of one module from
 * overlapping.
 */
let entryIds: string[] = ["ada", "grace"];
let listError = "";
void mock.module("../src/grid/sources/content-source", () => ({
  listCollectionEntryIds: async (name: string) => {
    if (listError) {
      throw new Error(listError);
    }
    return name === "authors" ? entryIds : [];
  },
}));

const { attachDocumentHeaderHost, hasDocumentHeader, mount, render, unmount } =
  await import("../src/panels/frontmatter-panel");

/**
 * The node the card paints into, remembered by whoever handed it over — which in this file is the
 * test, standing in for the stage.
 *
 * The module used to answer this itself. It no longer does, and it should not: the getter existed
 * for lit's order-independent detach report, and a document states its placements instead. What the
 * card is FOR is observable in the DOM, so that is what the assertions below read.
 */
let attached: HTMLElement | null = null;

/** Hand the card a host (or take it away), the way the stage does. */
function attach(el: HTMLElement | null): void {
  attached = el;
  attachDocumentHeaderHost("primary", el);
}

function host(): HTMLElement {
  if (!attached) {
    throw new Error("no Document Header host is attached");
  }
  return attached;
}

/** The card's root, or `null` when the document has no header to draw. */
function card(): HTMLElement | null {
  return host().querySelector('[part="card"]');
}

function part(name: string): HTMLElement | null {
  return host().querySelector(`[part="${name}"]`);
}

const FM_SCHEMA = {
  properties: {
    category: { enum: ["news", "guide"] },
    date: { format: "date", type: "string" },
    draft: { type: "boolean" },
    tags: { type: "array" },
    title: { type: "string" },
  },
  required: ["title"],
};

/**
 * Stand up the shell and play the stage's part.
 *
 * `withPanelHost: false` is the real state of every canvas mode that draws no document header — the
 * card must simply have nowhere to paint, and saying so must not throw.
 */
function setShell(withPanelHost = true) {
  document.body.innerHTML = `<div id="app">
    <div id="toolbar"></div>
    <div id="activity-bar"></div><div id="left-panel"></div>
    <div class="pane-stage" data-jx-region="pane.primary">
      <div part="edit-canvas"><div part="edit-column">
        <div part="doc-header" data-placement="in-column"></div>
      </div></div>
    </div>
    <div id="right-panel"></div>
    <div id="statusbar"></div>
  </div>`;
  initShellRefs();
  registerPrimaryStage();
  attach(withPanelHost ? document.querySelector<HTMLElement>('[part="doc-header"]') : null);
}

function setupContentTab(
  frontmatter: Record<string, unknown>,
  opts: { withSchema?: boolean; documentPath?: string; id?: string; isSite?: boolean } = {},
) {
  resetStudioState({
    isSiteProject: opts.isSite ?? false,
    projectConfig:
      opts.withSchema === false
        ? {}
        : { content: { posts: { format: "json", schema: FM_SCHEMA, source: "./posts" } } },
  });
  const tab = resetWorkspaceWithTab(undefined, {
    documentPath: opts.documentPath ?? "posts/hello.json",
    id: opts.id ?? "fm-tab",
  }) as any;
  tab.doc.mode = "content";
  tab.doc.content.frontmatter = frontmatter;
  return tab;
}

/** One row of the card, by the name a reader and the inspector call it. */
function row(prop: string): HTMLElement {
  const el = host().querySelector(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`row not found: ${prop}`);
  }
  return el as HTMLElement;
}

/** The kit element a row draws. */
function widget(prop: string): HTMLElement {
  const el = row(prop).querySelector('[part="widget"]');
  if (!el) {
    throw new Error(`row ${prop} draws no widget`);
  }
  return el as HTMLElement;
}

/** The native control inside a kit element — what a reader actually types into or picks from. */
function control(prop: string): HTMLInputElement {
  const el = widget(prop).querySelector<HTMLInputElement>('[part="input"], [part="control"]');
  if (!el) {
    throw new Error(`no native control inside the ${prop} widget`);
  }
  return el;
}

/** Type and commit, the way a reader does: the write and the event are both on the control. */
function setAndFire(prop: string, value: string, type = "change"): void {
  const el = control(prop);
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

/** Press a row's clear dot. */
function clearRow(prop: string): void {
  const chip = row(prop).querySelector<HTMLElement>('[part="chip"]');
  if (!chip) {
    throw new Error(`row ${prop} has no clear chip`);
  }
  chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The labels the card prints beside its rows, in order. */
function rowNames(): string[] {
  return [...host().querySelectorAll('[part="row-name"]')].map((el) => el.textContent!.trim());
}

beforeEach(() => {
  mediaCalls.length = 0;
  entryIds = ["ada", "grace"];
  listError = "";
  browseAnchor = null;
  browseCommit = null;
  uploadCommit = null;
  setShell();
  installMockPlatform();
  // The layouts listing settles asynchronously and repaints through `renderOnly("frontmatterPanel")`,
  // So the renderer is registered for EVERY test rather than inside the one that first needed it: a
  // Suite where `--test-name-pattern` changes the result is a suite that is asserting test order.
  registerRenderer("frontmatterPanel", () => render());
  invalidateLayoutCache();
  invalidateLayoutHeadCache();
  invalidateReferenceEntries();
});

afterEach(() => {
  unmount();
  closeAllTabs();
  setActiveRegistry(null);
});

async function mountAndFlush() {
  mount();
  render();
  await flush(8);
}

describe("the three deleted gates", () => {
  test("appears for a document that matches NO content collection", async () => {
    setupContentTab({ title: "Hello" }, { withSchema: false });
    await mountAndFlush();
    expect(host().hidden).toBe(false);
    expect(control("title").value).toBe("Hello");
  });

  test("appears in every canvas mode — it is part of the document, not a view of it", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    // The card takes no canvas mode at all; there is no predicate left to fail.
    expect(host().hidden).toBe(false);
    expect(mount.length).toBe(0);
  });

  test("appears for a component-mode document that carries head material", async () => {
    const tab = setupContentTab({}, { withSchema: false });
    tab.doc.mode = "component";
    tab.doc.document.title = "A JSON page";
    await mountAndFlush();
    expect(host().hidden).toBe(false);
    expect(control("title").value).toBe("A JSON page");
  });

  test("hidden only when the document genuinely has no header", async () => {
    setupContentTab({}, { withSchema: false });
    await mountAndFlush();
    expect(host().hidden).toBe(true);
    expect(card()).toBeNull();
  });

  test("hidden with no active tab; a stage that hosts nothing is a no-op", async () => {
    resetStudioState({ projectConfig: {} });
    closeAllTabs();
    await mountAndFlush();
    expect(host().hidden).toBe(true);
    unmount();

    setShell(false);
    mount();
    expect(document.querySelector('[part="doc-header"] [part="card"]')).toBeNull();
    render(); // Must not throw with no host bound
  });
});

describe("the stage owns the host", () => {
  test("attaching a new host moves the card onto it and repaints there", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    expect(card()).toBeTruthy();

    const first = host();
    const second = document.createElement("div");
    second.setAttribute("part", "doc-header");
    second.dataset.placement = "pinned";
    document.querySelector(".pane-stage")!.append(second);
    attach(second);
    await flush(8);

    // The card MOVED: one node holds it and the other does not. Read off the DOM rather than off a
    // Getter, because where the card is drawing is the fact anybody downstream depends on.
    expect(second.querySelector('[part="card"]')).toBeTruthy();
    expect(first.querySelector('[part="card"]')).toBeNull();
  });

  test("re-attaching the SAME host is inert — the canvas re-renders far more often than it moves", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    const el = host();
    attach(el);
    await flush(8);
    expect(el.querySelectorAll('[part="card"]').length).toBe(1);
  });

  test("a card taken down while its mount is still in flight takes the mount with it", async () => {
    setupContentTab({ title: "Hello" });
    const el = host();
    mount();
    render(); // Starts the mount; `mountSurface` waits for the kit before it renders anything.
    unmount(); // …and the stage gives the slot up before that lands.
    await flush(8);
    // The document that settled afterwards disposes itself rather than landing in a host nobody
    // Owns any more — a record with no handle yet IS the standing one, so there is no second mount
    // To arbitrate against, only a mount with nowhere to be.
    expect(el.querySelector('[part="card"]')).toBeNull();
  });

  test("the card stamps its own region, so no shell host has to name it", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    expect(card()!.dataset.jxRegion).toBe("pane.primary/frontmatter");
  });

  /*
   * `.doc-header-host.pinned .doc-header` reached from the stage's host INTO the card to take the
   * box's border and radius off the Design placement, and a document's scoped style block cannot
   * answer an ancestor. The placement arrives as an attribute the card keys on itself.
   */
  test("the stage's placement reaches the card as an attribute it can style on", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    expect(card()!.dataset.placement).toBe("in-column");

    const pinned = document.createElement("div");
    pinned.setAttribute("part", "doc-header");
    pinned.dataset.placement = "pinned";
    document.querySelector(".pane-stage")!.append(pinned);
    attach(pinned);
    await flush(8);
    expect(card()!.dataset.placement).toBe("pinned");
  });
});

describe("hasDocumentHeader", () => {
  test("frontmatter, a title or a $head entry each qualify; nothing does not", () => {
    const tab = setupContentTab({}, { withSchema: false });
    expect(hasDocumentHeader(tab)).toBe(false);
    tab.doc.document.$head = [{ attributes: { content: "x", name: "author" }, tagName: "meta" }];
    expect(hasDocumentHeader(tab)).toBe(true);
    delete tab.doc.document.$head;
    tab.doc.content.frontmatter = { draft: true };
    expect(hasDocumentHeader(tab)).toBe(true);
  });

  /*
   * The predicate takes a tab, inspects THAT tab's frontmatter, title and `$head` — and then fell
   * through to a zero-argument `isPageDocument()` for the "a page always has one" rule. So its last
   * line answered about a different document from its first three, and both directions were visible
   * the moment a second pane existed.
   */
  function twoDocuments() {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    closeAllTabs();
    const page = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/about.json",
      id: "hdr-page",
    });
    const component = openTab({
      document: { children: [], tagName: "x-card" },
      documentPath: "components/Card.json",
      id: "hdr-component",
    });
    return { component, page };
  }

  test("a PAGE keeps its header while a component is focused", () => {
    const { component, page } = twoDocuments();
    activateTab(component.id);
    expect(activeTab.value?.documentPath).toBe("components/Card.json");
    // The page has no frontmatter, no title and no $head — the page rule is the only thing that
    // Can give it a header, and it used to be asked about the OTHER document.
    expect(hasDocumentHeader(page)).toBe(true);
  });

  test("a bare COMPONENT does not gain one because a page is focused", () => {
    const { component, page } = twoDocuments();
    activateTab(page.id);
    expect(hasDocumentHeader(component)).toBe(false);
  });
});

describe("the Layout picker belongs to the card's own document", () => {
  /*
   * The picker used to be gated on a zero-argument `isPageDocument()`, so the control appeared and
   * vanished in the pane you were editing according to the document in the other one — while the
   * `$layout` it writes is this document's.
   */
  async function pageInPrimaryComponentFocused() {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    installMockPlatform({}, { "layouts/base.json": JSON.stringify({ tagName: "div" }) });
    invalidateLayoutPickerCache();
    closeAllTabs();
    const page = resetWorkspaceWithTab({ children: [], tagName: "div", title: "About" } as never, {
      documentPath: "pages/about.json",
      id: "layout-page",
    });
    openTab({
      document: { children: [], tagName: "x-card", title: "Card" },
      documentPath: "components/Card.json",
      id: "layout-component",
    });
    // The component goes to the SIDE pane and takes the focus with it; the card under test is the
    // Primary's, still drawing the page.
    expect(splitRight()?.id).toBe("secondary");
    expect(paneById("primary")!.activeTabId).toBe(page.id);
    expect(activeTab.value?.documentPath).toBe("components/Card.json");
    await mountAndFlush();
    // The layouts listing settles asynchronously and repaints through `renderOnly`.
    await flush(8);
    return page as any;
  }

  test("a PAGE's card shows the Layout row while a component is focused elsewhere", async () => {
    const page = await pageInPrimaryComponentFocused();
    console.log(
      `[frontmatter] focus=${activeTab.value?.documentPath} card-for=${page.documentPath} ` +
        `layout rows=${host().querySelectorAll('[data-prop="layout"]').length}`,
    );
    expect(host().querySelectorAll('[data-prop="layout"]').length).toBe(1);
    // Default, None, and the one layout the mock platform lists.
    expect([...control("layout").querySelectorAll("option")].map((o) => o.value)).toEqual([
      "__default__",
      "__none__",
      "./layouts/base.json",
    ]);
  });

  test("choosing a layout writes $layout onto the card's own document", async () => {
    const page = await pageInPrimaryComponentFocused();
    setAndFire("layout", "./layouts/base.json");
    await flush(4);
    expect(page.doc.document.$layout).toBe("./layouts/base.json");
  });

  test("Default names the project's own layout, and choosing it removes the key", async () => {
    resetStudioState({
      isSiteProject: true,
      projectConfig: { defaults: { layout: "./layouts/blog-post.json" } },
    });
    installMockPlatform({}, { "layouts/blog-post.json": JSON.stringify({ tagName: "div" }) });
    invalidateLayoutPickerCache();
    closeAllTabs();
    const page = resetWorkspaceWithTab(
      {
        $layout: "./layouts/blog-post.json",
        children: [],
        tagName: "div",
        title: "About",
      } as never,
      { documentPath: "pages/about.json", id: "layout-default" },
    ) as any;
    await mountAndFlush();
    await flush(8);
    const labels = [...control("layout").querySelectorAll("option")].map((o) => o.textContent);
    expect(labels[0]).toBe("Default (Blog Post)");
    setAndFire("layout", "__default__");
    await flush(4);
    expect("$layout" in page.doc.document).toBe(false);
  });

  test("None is a value, and the clear dot is what removes the key", async () => {
    const page = await pageInPrimaryComponentFocused();
    setAndFire("layout", "__none__");
    await flush(4);
    expect(page.doc.document.$layout).toBe(false);
    clearRow("layout");
    await flush(4);
    expect("$layout" in page.doc.document).toBe(false);
  });
});

/*
 * Every control on the card commits into the document the card is SHOWING.
 *
 * The JSON branch was fixed when the panes landed, and the comment beside it said so. The fix
 * reached that branch only: a markdown page takes the CONTENT branch, where `applyContentMutation`
 * resolved `activeTab.value` one call deeper, and every schema-driven field went through a renderer
 * that did the same at each of its seven widgets. So on a content document the card in one pane
 * retitled — and re-categorised, and re-dated — whichever document had the keyboard, while going on
 * displaying the values it had not changed.
 */
describe("the CONTENT branch commits into the card's own document too", () => {
  /** The card is drawn for a content tab in the PRIMARY pane; the focus is in the side pane. */
  async function contentCardWithFocusElsewhere() {
    const shown = setupContentTab({ category: "news", title: "LEFT" }, { id: "fm-left" }) as any;
    shown.doc.mode = "content";
    const other = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "posts/other.json",
      id: "fm-right",
    }) as any;
    other.doc.mode = "content";
    other.doc.content.frontmatter = { category: "news", title: "RIGHT" };
    expect(splitRight()?.id).toBe("secondary");
    expect(paneById("primary")!.activeTabId).toBe(shown.id);
    expect(activeTab.value?.id).toBe(other.id);
    await mountAndFlush();
    return { other, shown };
  }

  test("the Title field retitles the card's document, not the focused one", async () => {
    const { other, shown } = await contentCardWithFocusElsewhere();
    setAndFire("title", "EDITED");
    await flush(4);

    console.log(
      `[frontmatter] focus=${activeTab.value?.id} · left.title=${JSON.stringify(shown.doc.content.frontmatter.title)} ` +
        `right.title=${JSON.stringify(other.doc.content.frontmatter.title)}`,
    );
    expect(shown.doc.content.frontmatter.title).toBe("EDITED");
    expect(other.doc.content.frontmatter.title).toBe("RIGHT");
  });

  test("Clear title clears the card's document, not the focused one", async () => {
    const { other, shown } = await contentCardWithFocusElsewhere();
    clearRow("title");
    await flush(4);

    expect(shown.doc.content.frontmatter.title).toBeUndefined();
    expect(other.doc.content.frontmatter.title).toBe("RIGHT");
  });

  test("a schema frontmatter field commits into the card's document, not the focused one", async () => {
    const { other, shown } = await contentCardWithFocusElsewhere();
    // `category` is a schema `enum` — one of the seven widgets that resolved the focus for itself.
    setAndFire("category", "guide");
    await flush(4);

    console.log(
      `[frontmatter] schema field · left.category=${JSON.stringify(shown.doc.content.frontmatter.category)} ` +
        `right.category=${JSON.stringify(other.doc.content.frontmatter.category)}`,
    );
    expect(shown.doc.content.frontmatter.category).toBe("guide");
    expect(other.doc.content.frontmatter.category).toBe("news");
  });
});

describe("one reserved-key policy", () => {
  test("title renders ONCE, as the card's named row, not also as a generic property", async () => {
    setupContentTab({ title: "My Post" });
    await mountAndFlush();
    expect(host().querySelectorAll('[data-prop="title"]').length).toBe(1);
    // The named row has no required-marker suffix: it is the card's own control, not a schema field.
    expect(row("title").querySelector('[part="row-name"]')?.textContent).toBe("Title");
  });

  test("the policy is head-panel's, imported rather than restated", () => {
    expect([...RESERVED_FM_KEYS]).toEqual(["title"]);
    const tab = setupContentTab({ $paths: ["x"], title: "T" });
    const { fields, hasSchema, requiredFields } = collectFmFields(
      tab,
      { content: { posts: { format: "json", schema: FM_SCHEMA, source: "./posts" } } } as any,
      RESERVED_FM_KEYS,
    );
    expect(hasSchema).toBe(true);
    const names = fields.map((f) => f.field);
    expect(names).not.toContain("title");
    expect(names).not.toContain("$paths");
    expect(requiredFields.has("title")).toBe(true);
  });

  test("schema fields render typed widgets; extra keys render as inferred fields", async () => {
    setupContentTab({ extra: "loose", tags: ["a", "b"] });
    await mountAndFlush();
    expect(widget("draft").tagName.toLowerCase()).toBe("jx-checkbox");
    expect(widget("category").tagName.toLowerCase()).toBe("jx-select");
    expect(control("tags").value).toBe("a, b");
    expect(control("date").getAttribute("placeholder")).toBe("YYYY-MM-DD");
    expect(control("extra").value).toBe("loose");
    expect(rowNames()).toEqual(["Title", "Category", "Date", "Draft", "Tags", "Extra"]);
  });

  test("a required field says so beside its label, and only there", async () => {
    resetStudioState({
      projectConfig: {
        content: {
          posts: {
            format: "json",
            schema: { properties: { author: { type: "string" } }, required: ["author"] },
            source: "./posts",
          },
        },
      },
    });
    const tab = resetWorkspaceWithTab(undefined, {
      documentPath: "posts/hello.json",
      id: "fm-required",
    }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = { author: "ada" };
    await mountAndFlush();
    expect(rowNames()).toEqual(["Title", "Author *"]);
    // The marker is on the visible label only: the control's accessible name is the words, and an
    // Asterisk inside a name is read out as a word.
    expect(control("author").getAttribute("aria-label")).toBe("Author *");
  });

  test("every control names itself, so the visible label is not announced twice", async () => {
    setupContentTab({ extra: "loose" });
    await mountAndFlush();
    expect(row("extra").querySelector('[part="row-name"]')?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(control("extra").getAttribute("aria-label")).toBe("Extra");
  });
});

describe("route and disclosures", () => {
  test("a page states its route; a non-page states none", async () => {
    setupContentTab({ title: "Home" }, { documentPath: "pages/index.md", isSite: true });
    await mountAndFlush();
    expect(part("route")?.textContent).toBe("/");

    setupContentTab({ title: "Post" }, { documentPath: "posts/hello.json" });
    render();
    await flush(8);
    expect(part("route")).toBeNull();
  });

  test("Raw head tags is the card's ONE disclosure now, closed by default", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    // Was ["SEO", "Raw head tags"]. The SEO block grew previews, a resolved-field list and eight
    // Form rows inside a card whose job is the four fields you fill in while writing, so it left.
    const disclosures = [...host().querySelectorAll('[part="raw"]')];
    expect(disclosures.length).toBe(1);
    expect(part("raw")!.querySelector('[part="label"]')?.textContent?.trim()).toBe("Raw head tags");
    for (const d of host().querySelectorAll("details")) {
      expect((d as HTMLDetailsElement).open).toBe(false);
    }
  });

  test("the card offers the door to Search appearance, and it runs the command", async () => {
    const ran: string[] = [];
    const registry = createCommandRegistry({ getContext: () => emptyContext() });
    registry.register({
      category: "Document",
      id: "document.openSeo",
      level: "document",
      run: () => {
        ran.push("document.openSeo");
      },
      title: "Search Appearance",
    });
    setActiveRegistry(registry);
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    const button = part("seo-button")!;
    expect(button.textContent?.trim()).toContain("Search appearance…");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // The command, not a local open() — so the palette and the Page panel reach the same modal.
    expect(ran).toEqual(["document.openSeo"]);
  });

  test("with no registry the door renders and clicking it is inert", async () => {
    setActiveRegistry(null);
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    part("seo-button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  test("Raw head tags lists what no structured control owns, and says so when empty", async () => {
    const tab = setupContentTab({ title: "Hello" });
    await mountAndFlush();
    expect(part("raw-empty")).toBeTruthy();

    tab.doc.content.frontmatter = {
      $head: [{ attributes: { content: "me", name: "author" }, tagName: "meta" }],
      title: "Hello",
    };
    render();
    await flush(8);
    const items = [...host().querySelectorAll('[part="raw-key"]')];
    expect(items.map((i) => i.textContent)).toEqual(['<meta name="author">']);
  });
});

describe("commits and reactivity", () => {
  test("the Title row commits to frontmatter and marks the tab dirty", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    expect(tab.doc.dirty).toBe(false);
    setAndFire("title", "New");
    await flush(4);
    expect(tab.doc.content.frontmatter.title).toBe("New");
    expect(tab.doc.dirty).toBe(true);
  });

  test("typing commits after a pause without waiting for blur", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    setAndFire("title", "Live", "input");
    expect(tab.doc.content.frontmatter.title).toBe("Old");
    await new Promise((r) => {
      setTimeout(r, 400);
    });
    expect(tab.doc.content.frontmatter.title).toBe("Live");
  });

  test("checkbox commit sets a boolean; clear dot deletes the key", async () => {
    // `title` keeps the document's header alive across the clear: a document whose frontmatter is
    // Emptied has no header at all, and the card is taken down rather than left showing one row.
    const tab = setupContentTab({ draft: true, title: "Keep" });
    await mountAndFlush();
    clearRow("draft");
    await flush(4);
    expect("draft" in tab.doc.content.frontmatter).toBe(false);

    const box = control("draft");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(4);
    expect(tab.doc.content.frontmatter.draft).toBe(true);
  });

  test("an array field commits a comma list, and an empty one deletes the key", async () => {
    const tab = setupContentTab({ tags: ["a", "b"], title: "T" });
    await mountAndFlush();
    expect(control("tags").value).toBe("a, b");
    setAndFire("tags", " x , y ,, z ");
    await flush(4);
    expect(tab.doc.content.frontmatter.tags).toEqual(["x", "y", "z"]);
    setAndFire("tags", "");
    await flush(4);
    expect("tags" in tab.doc.content.frontmatter).toBe(false);
  });

  test("a number field commits a number, and an empty one deletes the key", async () => {
    resetStudioState({
      projectConfig: {
        content: {
          posts: {
            format: "json",
            schema: { properties: { weight: { type: "number" } } },
            source: "./posts",
          },
        },
      },
    });
    const tab = resetWorkspaceWithTab(undefined, {
      documentPath: "posts/hello.json",
      id: "fm-number",
    }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = { title: "T", weight: 3 };
    await mountAndFlush();
    expect(widget("weight").tagName.toLowerCase()).toBe("jx-number-field");
    expect(control("weight").value).toBe("3");
    setAndFire("weight", "7");
    await flush(4);
    expect(tab.doc.content.frontmatter.weight).toBe(7);
    // Empty means EMPTY: a numeric read of a removed value would write 0 into the document.
    setAndFire("weight", "  ");
    await flush(4);
    expect("weight" in tab.doc.content.frontmatter).toBe(false);
  });

  test("a commit that overtakes a pending keystroke wins, and the keystroke never lands", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    setAndFire("title", "half-typed", "input");
    setAndFire("title", "Committed");
    await new Promise((r) => {
      setTimeout(r, 400);
    });
    expect(tab.doc.content.frontmatter.title).toBe("Committed");
  });

  test("a keystroke still waiting when the card goes away is cancelled, not committed", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    setAndFire("title", "never", "input");
    unmount();
    await new Promise((r) => {
      setTimeout(r, 400);
    });
    expect(tab.doc.content.frontmatter.title).toBe("Old");
  });

  test("external frontmatter change re-renders the card reactively", async () => {
    const tab = setupContentTab({ subtitle: "Before" });
    await mountAndFlush();
    transactDoc(tab, (t: any) => mutateUpdateFrontmatter(t, "subtitle", "After"));
    await flush(8);
    expect(control("subtitle").value).toBe("After");
  });

  test("a repaint is an assignment, so the card is never rebuilt under the reader", async () => {
    const tab = setupContentTab({ subtitle: "Before" });
    await mountAndFlush();
    const before = card();
    const field = widget("subtitle");
    transactDoc(tab, (t: any) => mutateUpdateFrontmatter(t, "subtitle", "After"));
    await flush(8);
    // The whole reason `panels/panel-scheduler.ts` is not here: the node the reader is typing into
    // Survives the repaint, so there is no window a focus guard would have to withhold.
    expect(card()).toBe(before);
    expect(widget("subtitle")).toBe(field);
  });

  test("unmount stops reactive re-rendering and releases the stage's host", async () => {
    const tab = setupContentTab({ subtitle: "Before" });
    await mountAndFlush();
    // Held across the unmount on purpose: the stage's own node stays where it put it, and what
    // Leaves is the DOCUMENT — a mounted surface owns its effects, so taking the card down has to
    // Take its nodes with it or the runtime goes on binding into a tree nobody can see.
    const painted = host();
    expect(painted.querySelector('[part="card"]')).toBeTruthy();
    unmount();
    expect(painted.querySelector('[part="card"]')).toBeNull();
    transactDoc(tab, (t: any) => mutateUpdateFrontmatter(t, "subtitle", "After"));
    await flush(8);
    expect(painted.querySelector('[part="card"]')).toBeNull();
  });
});

/*
 * A media field is a text box the reader can also fill from the project. The BROWSER is
 * `ui/media-picker.ts`'s and renders into the popover layer rather than into the field, so the card
 * draws its own control and calls the owner for the part that is not markup — which is what keeps
 * a lit template out of a document without losing the affordance.
 */
describe("media fields", () => {
  function mediaProject(format: string) {
    resetStudioState({
      projectConfig: {
        content: {
          posts: {
            format: "json",
            schema: { properties: { hero: { format, type: "string" } } },
            source: "./posts",
          },
        },
      },
    });
    const tab = resetWorkspaceWithTab(undefined, {
      documentPath: "posts/hello.json",
      id: "fm-media",
    }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = { hero: "/hero.jpg" };
    return tab;
  }

  test("a media row draws a field, a thumbnail and the two project affordances", async () => {
    mediaProject("image");
    await mountAndFlush();
    expect(row("hero").querySelector('[part="media"]')).toBeTruthy();
    expect(row("hero").querySelector<HTMLImageElement>('[part="thumb"]')).toBeTruthy();
    expect(row("hero").querySelector('[part="upload"]')).toBeTruthy();
    expect(row("hero").querySelector('[part="browse"]')).toBeTruthy();
    expect(control("hero").value).toBe("/hero.jpg");
  });

  /* `"uri-reference"` is the spelling the SPEC uses and the one the content loader keys its asset
     rewrite on, so a schema written against the documentation declared its media field that way —
     and got a plain text box here, while the very same declaration got a media picker in the
     properties panel. One predicate now decides, so a media field is one everywhere. */
  test("a uri-reference field is a media field too, not a text box", async () => {
    mediaProject("uri-reference");
    await mountAndFlush();
    expect(row("hero").querySelector('[part="media"]')).toBeTruthy();
  });

  test("Browse opens the picker's popover under the button and assigns what it returns", async () => {
    const tab = mediaProject("image");
    await mountAndFlush();
    const button = row("hero").querySelector<HTMLElement>('[part="browse"]')!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    expect(mediaCalls).toEqual(["browse"]);
    // Anchored on the button the reader pressed, so two panes each open under their own card.
    expect(browseAnchor).toBe(button);
    browseCommit!("/picked.png");
    await flush(4);
    expect(tab.doc.content.frontmatter.hero).toBe("/picked.png");
  });

  test("Upload assigns the file it uploaded", async () => {
    const tab = mediaProject("image");
    await mountAndFlush();
    row("hero")
      .querySelector<HTMLElement>('[part="upload"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush(4);
    expect(mediaCalls).toEqual(["upload"]);
    uploadCommit!("/uploaded.png");
    await flush(4);
    expect(tab.doc.content.frontmatter.hero).toBe("/uploaded.png");
  });
});

/*
 * A relationship to another collection is a PICKER, not a text box. Before the branch existed, a
 * `$ref` field fell through to the plain textfield at the bottom of the field renderer, so the
 * author typed an entry id from memory with no way to see what ids exist and no sign when the one
 * they typed was wrong. The card draws its own control now — a document cannot interpolate the
 * registered control's lit template — over the same read, the same cache and the same invalidation
 * the entry editor and the settings forms use.
 */
describe("reference fields", () => {
  function referenceProject(frontmatter: Record<string, unknown>) {
    resetStudioState({
      projectConfig: {
        content: {
          authors: { format: "json", source: "./authors" },
          posts: {
            format: "json",
            schema: { properties: { author: { $ref: "#/content/authors" } } },
            source: "./posts",
          },
        },
      },
    });
    const tab = resetWorkspaceWithTab(undefined, {
      documentPath: "posts/hello.json",
      id: "fm-ref",
    }) as any;
    tab.doc.mode = "content";
    tab.doc.content.frontmatter = frontmatter;
    return tab;
  }

  async function settled(frontmatter: Record<string, unknown>) {
    const tab = referenceProject(frontmatter);
    await mountAndFlush();
    await flush(8);
    return tab;
  }

  function options(): string[] {
    return [...control("author").querySelectorAll("option")].map(
      (o) => (o as HTMLOptionElement).value,
    );
  }

  test("offers the collection's entries and commits the one that is chosen", async () => {
    const tab = await settled({ author: "ada", title: "T" });
    expect(widget("author").tagName.toLowerCase()).toBe("jx-select");
    expect(options()).toEqual(["", "ada", "grace"]);
    setAndFire("author", "grace");
    await flush(4);
    expect(tab.doc.content.frontmatter.author).toBe("grace");
  });

  test("a dangling reference is KEPT and marked, never silently blanked", async () => {
    await settled({ author: "turing", title: "T" });
    expect(options()).toEqual(["", "turing", "ada", "grace"]);
    const marked = [...control("author").querySelectorAll("option")].find(
      (o) => (o as HTMLOptionElement).value === "turing",
    );
    expect(marked?.textContent).toContain("not found");
  });

  test("an empty collection says so rather than offering an empty dropdown", async () => {
    entryIds = [];
    await settled({ author: "", title: "T" });
    expect(row("author").querySelector('[part="note"]')?.textContent).toBe(
      "No authors entries yet.",
    );
  });

  test("a listing that failed leaves the value editable and says why", async () => {
    listError = "no such directory";
    const tab = await settled({ author: "ada", title: "T" });
    // Swapping a failed read for an empty dropdown would present "no entries" and "could not find
    // Out" as the same screen.
    expect(widget("author").tagName.toLowerCase()).toBe("jx-textfield");
    expect(row("author").querySelector('[part="note"]')?.textContent).toContain(
      "Could not list authors entries",
    );
    setAndFire("author", "grace");
    await flush(4);
    expect(tab.doc.content.frontmatter.author).toBe("grace");
  });
});

describe("the other commit path and the disclosure state", () => {
  test("a non-content document commits straight onto the document root", async () => {
    const tab = setupContentTab({}, { withSchema: false });
    tab.doc.mode = "component";
    tab.doc.document.title = "Old";
    await mountAndFlush();
    setAndFire("title", "New");
    await flush(4);
    expect(tab.doc.document.title).toBe("New");
    expect("title" in tab.doc.content.frontmatter).toBe(false);
  });

  test("an empty Title deletes the key rather than storing a blank one", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    setAndFire("title", "   ");
    await flush(4);
    expect(tab.doc.content.frontmatter.title).toBeUndefined();
  });

  test("the Title clear dot deletes the key", async () => {
    const tab = setupContentTab({ title: "Old" });
    await mountAndFlush();
    clearRow("title");
    await flush(4);
    expect(tab.doc.content.frontmatter.title).toBeUndefined();
  });

  test("a disclosure remembers that it was opened, per tab", async () => {
    setupContentTab({ title: "Hello" }, { id: "fm-a" });
    await mountAndFlush();
    const details = () => host().querySelector("details") as HTMLDetailsElement;
    details().open = true;
    details().dispatchEvent(new Event("toggle", { bubbles: true }));
    render();
    await flush(8);
    expect(details().open).toBe(true);

    details().open = false;
    details().dispatchEvent(new Event("toggle", { bubbles: true }));
    render();
    await flush(8);
    expect(details().open).toBe(false);
  });

  test("a render after the host has gone is a no-op, not a throw", async () => {
    setupContentTab({ title: "Hello" });
    await mountAndFlush();
    setShell(false); // The stage redrew without a header slot; the host is now null
    render();
    await flush(8);
  });
});
