/**
 * An entry written on the canvas, inside its template's layout (studio.md §22.5).
 *
 * `resolveCanvasDocument` resolves a collection entry the way it resolves a page: the layout is the
 * entry's own `$layout`, else its collection's template page's `$layout`, else `defaults.layout`;
 * the layout's nodes are marked as the layout's, and the entry's own tree is the editable region.
 * What this file proves is the part that makes writing possible: a render path inside the entry's
 * body maps back to a path in the ENTRY's document, and every layout node is classified as layout
 * chrome, which the canvas locks.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { entryLayout, resolveCanvasDocument } from "../src/canvas/canvas-live-render";
import { classifyRenderNode } from "../src/canvas/path-mapping";
import { invalidateLayoutCache } from "../src/site-context";
import { invalidateCollectionPages } from "../src/content/collection-pages";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { getNodeAtPath } from "../src/store";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxMutableNode, JxPath } from "@jxsuite/schema/types";
import type { PathMapCtx } from "../src/canvas/path-mapping";

/* SAFETY: harness imports with-dom first, whose GlobalRegistrator copies happy-dom's window members
   onto globalThis, `happyDOM` among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

const BASE = {
  children: [
    { tagName: "header", textContent: "Site header" },
    { children: [{ tagName: "slot" }], tagName: "main" },
    { tagName: "footer", textContent: "Site footer" },
  ],
  tagName: "div",
};
const POST = {
  children: [
    { tagName: "nav", textContent: "Post nav" },
    { children: [{ tagName: "slot" }], tagName: "article" },
  ],
  tagName: "div",
};

/** A Markdown entry's body as the canvas edits it: the entry's own element tree. */
function entryBody(): JxMutableNode {
  return {
    children: [
      { tagName: "h1", textContent: "Spring planting" },
      { tagName: "p", textContent: "The cold frame is full again." },
    ],
    tagName: "div",
  };
}

const CONTENT = { posts: { format: "markdown", source: "./content/posts" } };

function setup(files: Record<string, string>, defaults?: { layout: string }) {
  installMockPlatform(
    {
      listDirectory: (path: string) =>
        Promise.resolve(
          path === "pages"
            ? [{ name: "blog", path: "pages/blog", type: "directory" as const }]
            : path === "pages/blog"
              ? [{ name: "[slug].json", path: "pages/blog/[slug].json", type: "file" as const }]
              : [],
        ),
    },
    files,
  );
  resetStudioState({
    isSiteProject: true,
    projectConfig: defaults ? { content: CONTENT, defaults } : { content: CONTENT },
  });
}

/** Open the entry the way an author does: its own file, in its writing editor. */
function openEntryTab(doc: JxMutableNode = entryBody(), frontmatter: Record<string, string> = {}) {
  closeAllTabs();
  const tab = openTab({
    document: doc,
    documentPath: "content/posts/spring-planting.md",
    frontmatter,
    id: "content/posts/spring-planting.md",
  });
  tab.session.ui.canvasMode = "edit";
  return tab;
}

/** The render node at a path inside a resolved document. */
function renderNodeAt(root: JxMutableNode, path: JxPath): JxMutableNode {
  const node = getNodeAtPath(root, path);
  if (!isNodeObject(node)) {
    throw new TypeError(`no element at ${path.join("/")}`);
  }
  return node;
}

beforeEach(() => {
  invalidateLayoutCache();
  invalidateCollectionPages();
});

afterEach(() => {
  closeAllTabs();
});

describe("the layout an entry is drawn in", () => {
  test("is its collection's template page's layout when the entry names none", async () => {
    setup({
      "layouts/post.json": JSON.stringify(POST),
      "pages/blog/[slug].json": JSON.stringify({
        $layout: "./layouts/post.json",
        $paths: { contentType: "posts", param: "slug" },
        tagName: "article",
      }),
    });
    const tab = openEntryTab();
    expect(await entryLayout(tab.doc.document, tab, tab.documentPath)).toBe("./layouts/post.json");
  });

  test("is the entry's own $layout first, from its frontmatter", async () => {
    setup({ "layouts/base.json": JSON.stringify(BASE) }, { layout: "./layouts/base.json" });
    const tab = openEntryTab(entryBody(), { $layout: "./layouts/special.json" });
    expect(await entryLayout(tab.doc.document, tab, tab.documentPath)).toBe(
      "./layouts/special.json",
    );
  });

  test("falls back to the project default, and to none when there is none", async () => {
    setup({}, { layout: "./layouts/base.json" });
    const tab = openEntryTab();
    expect(await entryLayout(tab.doc.document, tab, tab.documentPath)).toBe("./layouts/base.json");
    setup({});
    invalidateCollectionPages();
    expect(await entryLayout(tab.doc.document, tab, tab.documentPath)).toBeNull();
  });

  test("a file in no collection has no template page to ask", async () => {
    setup({}, { layout: "./layouts/base.json" });
    const tab = openEntryTab();
    expect(await entryLayout(tab.doc.document, tab, "notes/readme.md")).toBe("./layouts/base.json");
  });
});

describe("writing an entry inside its layout", () => {
  async function resolved() {
    setup({ "layouts/base.json": JSON.stringify(BASE) }, { layout: "./layouts/base.json" });
    const tab = openEntryTab();
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    const ctx: PathMapCtx = {
      arrayPaths: new Set(result.mapperCtx.arrayPaths),
      canvasMode: result.mapperCtx.canvasMode,
      layoutWrapped: result.mapperCtx.layoutWrapped,
      pageContentOffset: result.mapperCtx.pageContentOffset,
      pageContentPrefix: result.mapperCtx.pageContentPrefix,
    };
    return { ctx, result, tab };
  }

  test("the entry is wrapped, and the entry's body is the editable region", async () => {
    const { result } = await resolved();
    expect(result.mapperCtx.layoutWrapped).toBe(true);
    expect(result.mapperCtx.pageContentPrefix).toEqual(["children", 1, "children"]);
    expect(result.mapperCtx.pageContentOffset).toBe(0);
    const main = renderNodeAt(result.renderDoc, ["children", 1]);
    expect(main.tagName).toBe("main");
  });

  test("an edit inside the body lands on the ENTRY's own document", async () => {
    const { ctx, result, tab } = await resolved();
    const renderPath: JxPath = ["children", 1, "children", 1];
    const rendered = renderNodeAt(result.renderDoc, renderPath);
    expect(rendered.textContent).toBe("The cold frame is full again.");
    const mapped = classifyRenderNode(renderPath, rendered, ctx);
    expect(mapped).toEqual({ kind: "path", path: ["children", 1] });
    // The mapped path addresses the entry's paragraph, so a mutation through it edits the entry.
    const target = getNodeAtPath(tab.doc.document, ["children", 1]);
    expect(target?.textContent).toBe("The cold frame is full again.");
  });

  test("every layout node is the layout's, and the chrome around the body is locked", async () => {
    const { ctx, result } = await resolved();
    const header = renderNodeAt(result.renderDoc, ["children", 0]);
    expect(classifyRenderNode(["children", 0], header, ctx)).toEqual({
      chrome: true,
      kind: "layout",
      layoutFile: "layouts/base.json",
      layoutPath: ["children", 0],
    });
    const footer = renderNodeAt(result.renderDoc, ["children", 2]);
    expect(classifyRenderNode(["children", 2], footer, ctx)).toMatchObject({
      chrome: true,
      kind: "layout",
    });
    // The box the body sits in wraps it, so it is the layout's but not locked over the body.
    const main = renderNodeAt(result.renderDoc, ["children", 1]);
    expect(classifyRenderNode(["children", 1], main, ctx)).toMatchObject({
      chrome: false,
      kind: "layout",
    });
  });

  test("the show-layout toggle off draws the entry alone, as it does a page", async () => {
    setup({ "layouts/base.json": JSON.stringify(BASE) }, { layout: "./layouts/base.json" });
    const tab = openEntryTab();
    tab.session.ui.showLayout = false;
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.mapperCtx.layoutWrapped).toBe(false);
  });

  test("a JSON entry is not written on the canvas, so it is never wrapped", async () => {
    setup({ "layouts/base.json": JSON.stringify(BASE) }, { layout: "./layouts/base.json" });
    closeAllTabs();
    const tab = openTab({
      document: { tagName: "div" },
      documentPath: "content/posts/data.json",
      id: "content/posts/data.json",
    });
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.mapperCtx.layoutWrapped).toBe(false);
  });

  test("outside a site project an entry path is an ordinary document", async () => {
    setup({ "layouts/base.json": JSON.stringify(BASE) }, { layout: "./layouts/base.json" });
    resetStudioState({
      isSiteProject: false,
      projectConfig: { content: CONTENT, defaults: { layout: "./layouts/base.json" } },
    });
    const tab = openEntryTab();
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.mapperCtx.layoutWrapped).toBe(false);
  });
});
