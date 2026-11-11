/**
 * A document's own script, as the canvas resolves it (`spec.md` §23.2).
 *
 * The canvas draws a page inside its layout, and an entry inside its collection's page, as one
 * document. Each of them may carry a script, and `$src: "#client"` does not say whose. So
 * `resolveCanvasDocument` addresses every document before it merges it into another, and hands the
 * client texts back beside the merged document, with no `$script` left in it.
 */
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveCanvasDocument } from "../src/canvas/canvas-live-render";
import { documentBase } from "../src/canvas/canvas-origin";
import { resetSavedScripts } from "../src/canvas/canvas-scripts";
import { invalidateLayoutCache } from "../src/site-context";
import { invalidateCollectionPages } from "../src/content/collection-pages";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import { projectState } from "../src/store";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { StudioPlatform } from "../src/types";

/* SAFETY: harness imports with-dom first, whose GlobalRegistrator copies happy-dom's window members
   onto globalThis, `happyDOM` among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (url: string) => void };
};
happyDOM.setURL("http://localhost:3000/");

const PAGE_SCRIPT = "export const greet = () => 'from the page';";
const LAYOUT_SCRIPT = "export const year = () => 2026;";

const LAYOUT = {
  $script: { client: LAYOUT_SCRIPT },
  children: [
    { tagName: "header", textContent: "${state.year()}" },
    { children: [{ tagName: "slot" }], tagName: "main" },
  ],
  state: { year: { $export: "year", $prototype: "Function", $src: "#client" } },
  tagName: "div",
};

function page(client = PAGE_SCRIPT): JxMutableNode {
  return {
    $layout: "./layouts/base.json",
    $script: { client },
    children: [{ tagName: "p", textContent: "${state.greet()}" }],
    state: { greet: { $export: "greet", $prototype: "Function", $src: "#client" } },
    tagName: "div",
  };
}

/** The specifier the canvas gives the client script of the document at a project path. */
function clientOf(path: string): string {
  return `jx-script:${new URL(path, documentBase(projectState?.projectRoot)).href}#client`;
}

function siteWith(files: Record<string, string>, platform: Partial<StudioPlatform> = {}) {
  resetStudioState({ isSiteProject: true, projectConfig: {} });
  installMockPlatform(platform, files);
}

beforeEach(() => {
  resetStudioState();
  installMockPlatform();
  invalidateLayoutCache();
  invalidateCollectionPages();
  resetSavedScripts();
});

afterEach(() => {
  closeAllTabs();
});

describe("a page drawn inside its layout", () => {
  test("names the page's module and the layout's, and carries neither `$script`", async () => {
    siteWith({ "layouts/base.json": JSON.stringify(LAYOUT) });
    const tab = resetWorkspaceWithTab(page(), { documentPath: "pages/home.json" });

    const result = await resolveCanvasDocument(tab.doc.document, tab);

    expect(result.mapperCtx.layoutWrapped).toBe(true);
    expect(result.renderDoc.$script).toBeUndefined();
    expect(result.renderDoc.state).toMatchObject({
      greet: { $export: "greet", $prototype: "Function", $src: clientOf("pages/home.json") },
      year: { $export: "year", $prototype: "Function", $src: clientOf("layouts/base.json") },
    });
    expect(result.scripts).toEqual({
      [clientOf("layouts/base.json")]: LAYOUT_SCRIPT,
      [clientOf("pages/home.json")]: PAGE_SCRIPT,
    });
    // The editor's document is not the canvas's to change.
    expect(tab.doc.document.$script).toEqual({ client: PAGE_SCRIPT });
    expect(tab.doc.document.state).toEqual({
      greet: { $export: "greet", $prototype: "Function", $src: "#client" },
    });
  });

  test("Preview draws the same two modules", async () => {
    siteWith({ "layouts/base.json": JSON.stringify(LAYOUT) });
    const tab = resetWorkspaceWithTab(page(), { documentPath: "pages/home.json" });
    tab.session.ui.canvasMode = "preview";

    const result = await resolveCanvasDocument(tab.doc.document, tab);

    expect(result.mapperCtx.canvasMode).toBe("preview");
    expect(result.renderDoc.$script).toBeUndefined();
    expect(result.scripts).toEqual({
      [clientOf("layouts/base.json")]: LAYOUT_SCRIPT,
      [clientOf("pages/home.json")]: PAGE_SCRIPT,
    });
  });

  test("a document with no script sends none", async () => {
    siteWith({});
    const tab = resetWorkspaceWithTab(
      { children: ["hi"], tagName: "div" },
      { documentPath: "pages/plain.json" },
    );
    const result = await resolveCanvasDocument(tab.doc.document, tab);
    expect(result.scripts).toEqual({});
  });
});

describe("a script reaches the canvas when its document is saved", () => {
  test("a tab with unsaved edits is drawn with the script its file has", async () => {
    siteWith({});
    const tab = resetWorkspaceWithTab(page(), { documentPath: "pages/home.json" });
    tab.doc.document.$layout = false;
    await resolveCanvasDocument(tab.doc.document, tab);

    tab.doc.document.$script = { client: "export const greet = () => 'half ty" };
    tab.doc.dirty = true;
    const typing = await resolveCanvasDocument(tab.doc.document, tab);
    expect(typing.scripts).toEqual({ [clientOf("pages/home.json")]: PAGE_SCRIPT });

    // Saved: the tab is clean, so what it holds is what the file says.
    tab.doc.document.$script = { client: "export const greet = () => 'typed';" };
    tab.doc.dirty = false;
    const saved = await resolveCanvasDocument(tab.doc.document, tab);
    expect(saved.scripts).toEqual({
      [clientOf("pages/home.json")]: "export const greet = () => 'typed';",
    });
  });
});

describe("an entry drawn inside its collection's page", () => {
  test("the page's script is the page's, and the entry draws with it", async () => {
    resetStudioState({
      isSiteProject: true,
      projectConfig: { content: { posts: { format: "markdown", source: "./content/posts" } } },
    });
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
      {
        "pages/blog/[slug].json": JSON.stringify({
          $layout: false,
          $paths: { contentType: "posts", param: "slug" },
          $script: { client: PAGE_SCRIPT },
          children: [
            { tagName: "h1", textContent: "${state.greet()}" },
            { children: "${state.entry.$children ?? []}", tagName: "section" },
          ],
          state: {
            entry: {
              $prototype: "ContentEntry",
              contentType: "posts",
              id: { $ref: "#/$params/slug" },
            },
            greet: { $export: "greet", $prototype: "Function", $src: "#client" },
          },
          tagName: "article",
        }),
      },
    );
    closeAllTabs();
    const tab = openTab({
      document: { children: [{ tagName: "p", textContent: "Body" }], tagName: "div" },
      documentPath: "content/posts/spring-planting.md",
      frontmatter: { title: "Spring planting" },
      id: "content/posts/spring-planting.md",
    });
    tab.session.ui.canvasMode = "edit";

    const result = await resolveCanvasDocument(tab.doc.document, tab);

    expect(result.renderDoc.$script).toBeUndefined();
    expect(result.renderDoc.state).toMatchObject({
      greet: { $export: "greet", $prototype: "Function", $src: clientOf("pages/blog/[slug].json") },
    });
    expect(result.scripts).toEqual({ [clientOf("pages/blog/[slug].json")]: PAGE_SCRIPT });
  });
});
