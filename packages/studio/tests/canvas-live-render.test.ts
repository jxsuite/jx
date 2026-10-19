/**
 * Canvas live render — parent-side document resolution (`resolveCanvasDocument`) for the iframe
 * canvas host: page/layout wrapping with slot distribution, mapped-array path collection in edit
 * mode, content-mode component auto-discovery, and site-style passthrough. The realm-specific
 * render (buildScope/renderNode, $head/site-style DOM injection) now happens inside the iframe and
 * is unit-tested via tests/iframe-entry.test.ts — the legacy in-realm `renderCanvasLive` (and its
 * `makePathMapper`/`layoutElements`/`activeLayoutPath` bookkeeping) was removed with the legacy
 * canvas.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveCanvasDocument } from "../src/canvas/canvas-live-render";
import { invalidateLayoutCache } from "../src/site-context";
import { setExtensions } from "../src/format/format-host";
import { invalidateRepeaterSources } from "../src/canvas/repeater-sources";
import { loadComponentRegistry } from "../src/files/components";
import { activateTab, activeTab, closeAllTabs, openTab } from "../src/workspace/workspace";

import { isNodeObject, isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";

// Happy-dom defaults to about:blank (origin "null"), which breaks docBase-relative URL math.
/* SAFETY: harness imports with-dom first, whose GlobalRegistrator.register() copies happy-dom's
   window members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

interface ResolveOpts {
  documentPath?: string;
  mode?: string;
  /** The tab's own base canvas mode. It used to be an injected `getCanvasMode()` — see `resolve`. */
  canvasMode?: string;
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  resetStudioState();
  installMockPlatform();
  invalidateLayoutCache();
});

afterEach(async () => {
  closeAllTabs();
  // Reset the shared component registry (loadComponentRegistry reassigns it from the platform).
  installMockPlatform();
  await loadComponentRegistry();
});

/**
 * The element node at `index` of a resolved `children` or `$elements` slot. Throws when the slot is
 * a whole-slot repeater or the entry is text or a bare ref, which no case here resolves to.
 */
function nodeAt(slot: JxMutableNode["children"] | JxMutableNode["$elements"], index: number) {
  const entry = Array.isArray(slot) ? slot[index] : undefined;
  if (!isNodeObject(entry)) {
    throw new TypeError(`expected an element node at index ${index}`);
  }
  return entry;
}

const LAYOUT = {
  $elements: [{ tagName: "x-layout-marker" }],
  children: [
    { tagName: "header", textContent: "HDR" },
    { children: [{ tagName: "slot" }], tagName: "main" },
  ],
  tagName: "div",
};

// ─── resolveCanvasDocument (parent-side resolution for the iframe host) ─────────

describe("resolveCanvasDocument", () => {
  /*
   * The mode is set on the TAB, because that is where it lives. It used to be a module-level
   * `canvasMode` handed to `initCanvasLiveRender`, which is the test-shaped shadow of the defect:
   * the resolver asked one global question instead of asking the tab it was resolving.
   */
  async function resolve(docDef: JxMutableNode, opts: ResolveOpts = {}) {
    const tab = resetWorkspaceWithTab(docDef, {
      documentPath: opts.documentPath ?? "doc.json",
    });
    if (opts.mode) {
      tab.doc.mode = opts.mode;
    }
    // Design unless the case says otherwise: these cases were written against an injected
    // `getCanvasMode()` that answered "design", and the mode is a tab field now.
    tab.session.ui.canvasMode = opts.canvasMode ?? "design";
    return resolveCanvasDocument(tab.doc.document, tab);
  }

  test("resolves a simple page-less doc into renderDoc + docBase + mapperCtx", async () => {
    const result = await resolve({
      children: [{ children: ["hi"], tagName: "p" }],
      tagName: "div",
    });
    expect(result.renderDoc.tagName).toBe("div");
    expect(result.docBase).toContain("doc.json");
    expect(result.mapperCtx).toMatchObject({
      arrayPaths: [],
      canvasMode: "design",
      layoutWrapped: false,
      pageContentPrefix: null,
    });
    expect(result.siteStyle).toBeNull();
  });

  test("returns the project's site style", async () => {
    resetStudioState({ projectConfig: { style: { "--brand": "#0f0", color: "red" } } });
    const result = await resolve({ children: [], tagName: "div" });
    expect(result.siteStyle).toEqual({ "--brand": "#0f0", color: "red" });
  });

  test("collects mapped-array document paths in edit mode", async () => {
    const result = await resolve(
      {
        children: [{ $prototype: "Array", map: { tagName: "li" } }],
        tagName: "div",
      },
      { canvasMode: "edit" },
    );
    expect(result.mapperCtx.canvasMode).toBe("edit");
    expect(result.mapperCtx.arrayPaths).toContain("children/0");
  });

  test("wraps page documents in their layout", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    installMockPlatform({}, { "layouts/base.json": JSON.stringify(LAYOUT) });
    const result = await resolve(
      {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Page content" }],
        tagName: "div",
      },
      { documentPath: "pages/home.json" },
    );
    expect(result.mapperCtx.layoutWrapped).toBe(true);
    expect(result.mapperCtx.pageContentPrefix).not.toBeNull();
  });

  test("marks every layout node with the FILE and its own path inside that file", async () => {
    // A bare `true` here is what made layout chrome unaddressable: the canvas could tell you had
    // Clicked something it could not edit, but not what, nor where to go and edit it.
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    installMockPlatform({}, { "layouts/base.json": JSON.stringify(LAYOUT) });
    const result = await resolve(
      {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Page content" }],
        tagName: "div",
      },
      { documentPath: "pages/home.json" },
    );
    const root = result.renderDoc;
    // The `./` prefix is stripped, so the marker's file is a path navigateToComponent can open.
    expect(root.$__layout).toEqual({ file: "layouts/base.json", path: [] });
    const header = nodeAt(root.children, 0);
    expect(header.tagName).toBe("header");
    expect(header.$__layout).toEqual({ file: "layouts/base.json", path: ["children", 0] });
    // …down through $elements too (component refs the layout brings with it).
    expect(nodeAt(root.$elements, 0).$__layout).toEqual({
      file: "layouts/base.json",
      path: ["$elements", 0],
    });
    // The page's own node is NOT marked — that is the whole distinction.
    const main = nodeAt(root.children, 1);
    expect(nodeAt(main.children, 0).$__layout).toBeUndefined();
  });

  test("skips layout wrapping when the tab's showLayout toggle is off", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    installMockPlatform({}, { "layouts/base.json": JSON.stringify(LAYOUT) });
    const tab = resetWorkspaceWithTab(
      {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Page content" }],
        tagName: "div",
      },
      { documentPath: "pages/home.json" },
    );
    tab.session.ui.showLayout = false;
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.mapperCtx.layoutWrapped).toBe(false);
    expect(result.mapperCtx.pageContentPrefix).toBeNull();
    const { children } = result.renderDoc;
    if (!Array.isArray(children)) {
      throw new TypeError("expected the unwrapped page's children array");
    }
    expect(children.some((c) => !isString(c) && c.tagName === "header")).toBe(false);
  });

  test("effective preview mode keeps the raw doc (no edit-display tokens)", async () => {
    const result = await resolve(
      {
        children: [{ tagName: "p", textContent: "${state.x}" }],
        tagName: "div",
      },
      { canvasMode: "preview" },
    );
    expect(result.mapperCtx.canvasMode).toBe("preview");
    const p = nodeAt(result.renderDoc.children, 0);
    // Preview passes the raw template through; design/edit would rewrite it to a display token.
    expect(p.textContent).toBe("${state.x}");
    expect(result.mapperCtx.arrayPaths).toEqual([]);
  });

  test("substitutes chosen preview params into renderDoc, leaving the source doc intact", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    const tab = resetWorkspaceWithTab(
      {
        children: [],
        state: {
          product: { $prototype: "ContentEntry", id: { $ref: "#/$params/sku" } },
        },
        tagName: "div",
      },
      { documentPath: "pages/products/[sku].json" },
    );
    tab.session.ui.previewParams = { sku: "mini-trencher" };
    const result = await resolveCanvasDocument(tab.doc.document, tab);

    const { state } = result.renderDoc;
    expect(state?.product).toHaveProperty("id", "mini-trencher");
    expect(state?.$page).toEqual({
      params: { sku: "mini-trencher" },
      title: "",
      url: "/products/:sku",
    });
    // The tab's source document keeps its $ref (it is what gets edited and saved).
    expect(tab.doc.document.state?.product).toHaveProperty("id", { $ref: "#/$params/sku" });
  });

  test("substitution composes with layout wrapping", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    installMockPlatform({}, { "layouts/base.json": JSON.stringify(LAYOUT) });
    const tab = resetWorkspaceWithTab(
      {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Body" }],
        state: { entry: { id: { $ref: "#/$params/slug" } } },
        tagName: "div",
      },
      { documentPath: "pages/docs/[slug].json" },
    );
    tab.session.ui.previewParams = { slug: "intro" };
    const result = await resolveCanvasDocument(tab.doc.document, tab);

    expect(result.mapperCtx.layoutWrapped).toBe(true);
    expect(result.renderDoc.state?.entry).toHaveProperty("id", "intro");
  });

  test("seeds component test props into renderDoc.state, leaving the source doc intact (M6)", async () => {
    const tab = resetWorkspaceWithTab(
      {
        children: [{ tagName: "h3", textContent: "${state.title}" }],
        state: {
          count: { default: 3, type: "number" },
          greet: { $prototype: "Function", body: "" },
          title: "Hello",
        },
        tagName: "x-card",
      },
      { documentPath: "components/x-card.json" },
    );
    tab.session.ui.previewProps = { count: 7, greet: "never", title: "Test drive" };
    const result = await resolveCanvasDocument(tab.doc.document, tab);

    const { state } = result.renderDoc;
    // Literal entries take the value; signal defs seed through `default` (what buildScope reads);
    // Behavioral entries are never overridden.
    expect(state?.title).toBe("Test drive");
    expect(state?.count).toEqual({ default: 7, type: "number" });
    expect(state?.greet).toEqual({ $prototype: "Function", body: "" });
    // The tab's source document keeps its authored defaults (it is what gets edited and saved).
    const srcState = tab.doc.document.state;
    expect(srcState?.title).toBe("Hello");
    expect(srcState?.count).toEqual({ default: 3, type: "number" });
  });

  test("test props never touch a page document (previewParams territory)", async () => {
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    const tab = resetWorkspaceWithTab(
      { children: [], state: { title: "Hello" }, tagName: "div" },
      { documentPath: "pages/home.json" },
    );
    tab.session.ui.previewProps = { title: "nope" };
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.renderDoc.state?.title).toBe("Hello");
  });

  test("auto-discovers project components in content mode and adds them to $elements", async () => {
    installMockPlatform({
      discoverComponents: async () => [
        { path: "components/x-card-live.json", source: "jx", tagName: "x-card-live" },
      ],
    });
    await loadComponentRegistry();
    const result = await resolve(
      { children: [{ tagName: "x-card-live" }], tagName: "div" },
      { documentPath: "content/home.md", mode: "content" },
    );
    const refs = (result.renderDoc.$elements ?? []).map((e) => (isString(e) ? undefined : e.$ref));
    expect(refs.some((r) => r?.includes("components/x-card-live.json"))).toBe(true);
  });

  test("auto-discovers project components in a layout opened directly (no content mode)", async () => {
    installMockPlatform({
      discoverComponents: async () => [
        { path: "components/x-card-live.json", source: "jx", tagName: "x-card-live" },
      ],
    });
    await loadComponentRegistry();
    // A layout opened on its own is not a page (no layoutWrapped) and a plain .json file never
    // Sets content mode, yet its custom-element tags must still be registered for the canvas.
    const result = await resolve(
      { children: [{ tagName: "x-card-live" }], tagName: "div" },
      { documentPath: "layouts/base.json" },
    );
    const refs = (result.renderDoc.$elements ?? []).map((e) => (isString(e) ? undefined : e.$ref));
    expect(refs.some((r) => r?.includes("components/x-card-live.json"))).toBe(true);
  });

  test("auto-discovery reaches a component used only as a list's row or a $switch case", async () => {
    installMockPlatform({
      discoverComponents: async () => [
        { path: "components/x-row.json", source: "jx", tagName: "x-row" },
        { path: "components/x-case.json", source: "jx", tagName: "x-case" },
        { path: "components/x-legacy.json", source: "jx", tagName: "x-legacy" },
      ],
    });
    await loadComponentRegistry();
    const result = await resolve(
      {
        children: [
          { $prototype: "Array", items: [1], map: { tagName: "x-row" } },
          { $switch: "a", cases: { a: { tagName: "x-case" } }, tagName: "div" },
          {
            children: { $prototype: "Array", items: [1], map: { tagName: "x-legacy" } },
            tagName: "ul",
          },
        ],
        tagName: "div",
      },
      // Preview keeps every repeater as written, which is where the walk used to stop.
      { canvasMode: "preview", documentPath: "layouts/base.json" },
    );
    const refs = (result.renderDoc.$elements ?? []).map((e) => (isString(e) ? undefined : e.$ref));
    for (const tag of ["x-row", "x-case", "x-legacy"]) {
      expect(refs.some((r) => r?.includes(`components/${tag}.json`))).toBe(true);
    }
  });

  test("a page is drawn with the $site and $page the build injects", async () => {
    resetStudioState({
      isSiteProject: true,
      projectConfig: {
        i18n: { defaultLocale: "en", locales: ["en", "ar"], routing: "prefix-except-default" },
        name: "Atrium",
      },
    });
    const result = await resolve(
      { children: [], state: { own: 1 }, tagName: "main", title: "Visit" },
      { canvasMode: "preview", documentPath: "pages/ar/visit.json" },
    );
    expect(result.renderDoc.state?.$page).toMatchObject({
      locale: "ar",
      title: "Visit",
      url: "/ar/visit",
    });
    expect(result.renderDoc.state?.$site).toMatchObject({ name: "Atrium" });
    expect(result.renderDoc.state?.own).toBe(1);
  });

  test("Edit resolves the collection a repeater reads, and every mode an extension class", async () => {
    const asked: string[] = [];
    installMockPlatform({
      resolveClass: async (body) => {
        asked.push(String(body.$src));
        return body.$prototype === "ContentEntry" ? { id: "nav" } : [{ t: "first" }];
      },
    });
    setExtensions([
      {
        classes: [{ name: "ContentEntry", path: "/ext/ContentEntry.class.json" }],
        contributions: [],
        name: "@jxsuite/parser",
        specifier: "@jxsuite/parser",
      },
    ]);
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    invalidateRepeaterSources();
    const page: JxMutableNode = {
      children: [{ $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: "li" } }],
      state: {
        nav: { $prototype: "ContentEntry", id: "nav" },
        rows: { $prototype: "ContentCollection", $src: "@x/C.class.json", contentType: "rows" },
      },
      tagName: "main",
    };
    const edit = await resolve(page, { canvasMode: "edit", documentPath: "pages/index.json" });
    expect(edit.renderDoc.state?.rows).toEqual([{ t: "first" }]);
    expect(edit.renderDoc.state?.nav).toEqual({ id: "nav" });
    expect(edit.renderDoc.imports?.ContentEntry).toBe("/ext/ContentEntry.class.json");
    invalidateRepeaterSources();
    asked.length = 0;
    const preview = await resolve(page, {
      canvasMode: "preview",
      documentPath: "pages/index.json",
    });
    // Preview resolves its own lists as the page does; the extension class is resolved first.
    expect(asked).toEqual(["/ext/ContentEntry.class.json"]);
    expect(preview.renderDoc.state?.nav).toEqual({ id: "nav" });
  });

  test("registers the components a component uses, transitively", async () => {
    /* A card renders a panel, which renders an icon: none of the three declares `$elements`, and
       only the card appears in the page. Its panel used to stay an empty, unregistered tag. */
    installMockPlatform({
      discoverComponents: async () => [
        { path: "components/x-card.json", source: "jx", tagName: "x-card", uses: ["x-panel"] },
        { path: "components/x-panel.json", source: "jx", tagName: "x-panel", uses: ["x-icon"] },
        { path: "components/x-icon.json", source: "jx", tagName: "x-icon" },
        { path: "components/x-unused.json", source: "jx", tagName: "x-unused" },
      ],
    });
    await loadComponentRegistry();
    const result = await resolve(
      { children: [{ tagName: "x-card" }], tagName: "div" },
      { documentPath: "content/home.md", mode: "content" },
    );
    const refs = (result.renderDoc.$elements ?? []).map((e) => (isString(e) ? "" : String(e.$ref)));
    for (const tag of ["x-card", "x-panel", "x-icon"]) {
      expect(refs.some((r) => r.endsWith(`components/${tag}.json`))).toBe(true);
    }
    expect(refs.some((r) => r.includes("x-unused"))).toBe(false);
  });

  test("injects $site and $page into a page, without touching the source document's state", async () => {
    // A layout binding `${state.$page.url}` threw on the canvas, and in Preview that blanked it.
    resetStudioState({
      isSiteProject: true,
      projectConfig: { name: "Avunu", state: { tagLabels: { ai: "AI" } }, url: "https://x.test" },
    });
    const doc: JxMutableNode = { children: [], state: { own: 1 }, tagName: "div", title: "About" };
    const result = await resolve(doc, { documentPath: "pages/about/index.md" });
    const state = result.renderDoc.state ?? {};
    expect(state.$page).toMatchObject({ title: "About", url: "/about" });
    expect(state.$site).toMatchObject({ name: "Avunu", url: "https://x.test" });
    expect(state.tagLabels).toEqual({ ai: "AI" });
    expect(state.own).toBe(1);
    expect(Object.keys(activeTab.value!.doc.document.state ?? {})).toEqual(["own"]);
  });
});

// ─── The render is OF a tab, not of "the active tab" ──────────────────────────

describe("the resolution belongs to the tab it was given", () => {
  /*
   * `resolveCanvasDocument` opened with `const tab = activeTab.value` and took its mode from an
   * injected `getCanvasMode()` — the focused pane's, one layer down — while its caller had already
   * resolved the right tab with `tabOfPane(surface.paneId)` and threaded that tab's id all the way
   * down to it. So the moment two panes were drawn, the pane that did not have focus was resolved
   * against the pane that did, in six values at once.
   *
   * The mode is the one with teeth: `mountIframeCanvas` ends with `setHostPreview(state,
   * message.mode === "preview")`, so an Edit pane beside a Preview pane got a preview FRAME — no
   * overlay, and no editing message honoured from it.
   */
  async function twoTabs() {
    closeAllTabs();
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    const focused = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/index.json",
      id: "focused-page",
    });
    const side = openTab({
      document: { children: [], state: { title: "Card" }, tagName: "x-card" },
      documentPath: "components/x-card.json",
      id: "side-component",
    });
    // `openTab` leaves the newest focused; put the keyboard back on the page, which is the
    // Arrangement that used to hand the component the page's answers.
    activateTab(focused.id);
    expect(activeTab.value?.id).toBe("focused-page");
    return { focused, side };
  }

  test("docBase, isPage and canvasMode all come from the tab, not from the focus", async () => {
    const { focused, side } = await twoTabs();
    focused.session.ui.canvasMode = "design";
    focused.session.ui.preview = true;
    side.session.ui.canvasMode = "edit";
    side.session.ui.previewProps = { title: "Test drive" };

    const result = await resolveCanvasDocument(side.doc.document, side);

    console.log(
      `[canvas-live-render] focus=${activeTab.value?.documentPath} (preview) ` +
        `resolved-for=${side.documentPath} (edit) → docBase=${result.docBase} ` +
        `mode=${result.mapperCtx.canvasMode}`,
    );
    expect(result.docBase).toContain("components/x-card.json");
    expect(result.docBase).not.toContain("pages/index.json");
    // Edit, not the focused pane's "preview" — this is the value `setHostPreview` reads.
    expect(result.mapperCtx.canvasMode).toBe("edit");
    // And the component's own test props were seeded, which only happens on the `!isPage` path.
    expect(result.renderDoc.state?.title).toBe("Test drive");
  });

  test("the reverse: the focused pane in Edit does not make a previewed pane editable", async () => {
    const { focused, side } = await twoTabs();
    focused.session.ui.canvasMode = "edit";
    side.session.ui.canvasMode = "design";
    side.session.ui.preview = true;

    const result = await resolveCanvasDocument(side.doc.document, side);
    expect(result.mapperCtx.canvasMode).toBe("preview");
  });

  test("showLayout is the side tab's toggle, not the focused tab's", async () => {
    installMockPlatform({}, { "layouts/base.json": JSON.stringify(LAYOUT) });
    closeAllTabs();
    resetStudioState({ isSiteProject: true, projectConfig: {} });
    const focused = openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/index.json",
      id: "focused-page",
    });
    const side = openTab({
      document: {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Body" }],
        tagName: "div",
      },
      documentPath: "pages/about.json",
      id: "side-page",
    });
    side.session.ui.showLayout = false;
    focused.session.ui.showLayout = true;
    activateTab(focused.id);

    const result = await resolveCanvasDocument(side.doc.document, side);
    expect(result.mapperCtx.layoutWrapped).toBe(false);
  });
});
