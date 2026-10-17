/**
 * Which workspace a tab belongs to — `src/workspace/tab-workspace.ts`.
 *
 * The rule is a pure function of the tab (what it is, and which editor it is in) and the project's
 * collections, so every case builds a tab and reads the answer. The strip filter and the two "which
 * tab was this workspace last in" reads are the same rule applied to a pane.
 */
import { resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { setFormats } from "../src/format/format-host";
import { MARKDOWN_FORMAT } from "./format-fixture";
import { shell } from "../src/shell";
import { activateTab, closeAllTabs, splitRight, workspace } from "../src/workspace/workspace";
import {
  isTabInWorkspace,
  lastTabOfWorkspace,
  paneTabOfWorkspace,
  workspaceOfTab,
  workspaceTabOrder,
  writesOnCanvas,
} from "../src/workspace/tab-workspace";
import { workspaceHomeTabId } from "../src/workspace/workspace-ids";
import { makeGridTabId } from "../src/grid/grid-source";
import { openStubTab, openVirtualTab } from "./workspace-fixture";
import type { StubTabOptions } from "./workspace-fixture";
import type { WorkspaceId } from "../src/workspace/workspace-ids";

/** Open a tab over `path` (or a virtual id) in the focused pane, in `mode` when one is given. */
const tab = openStubTab;

/** The workspace a freshly opened tab belongs to. */
function workspaceOfNew(id: string, opts: StubTabOptions = {}): WorkspaceId {
  return workspaceOfTab(openStubTab(id, opts));
}

/** The workspace a freshly opened VIRTUAL tab (no document path) in `mode` belongs to. */
function workspaceOfVirtual(id: string, mode: string): WorkspaceId {
  return workspaceOfTab(openVirtualTab(id, mode));
}

beforeEach(() => {
  setFormats([MARKDOWN_FORMAT]);
  resetStudioState({
    projectConfig: {
      content: {
        catalogue: { format: "Markdown", source: "./content/catalogue.csv" },
        posts: { format: "Markdown", schema: { properties: {} }, source: "./content/posts/" },
      },
    },
  });
  closeAllTabs();
  shell.workspace = "design";
});

describe("workspaceOfTab", () => {
  test("pages, templates, components and every other file are Design's", () => {
    for (const path of ["pages/index.json", "layouts/base.json", "components/card.json", "x.css"]) {
      expect(workspaceOfTab(tab(path))).toBe("design");
    }
  });

  test("a file a content collection owns is Content's, whichever editor it is in", () => {
    expect(workspaceOfNew("content/posts/hello.md")).toBe("content");
    expect(workspaceOfNew("content/posts/2026/deep.md", { mode: "edit" })).toBe("content");
  });

  test("a file-backed collection's catalogue is not an entry, so it stays in Design", () => {
    expect(workspaceOfNew("content/catalogue.csv")).toBe("design");
  });

  test("the Content home, the page grid and a collection grid are Content's; a data grid is Design's", () => {
    const pages = makeGridTabId({ kind: "pages" });
    const posts = makeGridTabId({ kind: "collection", name: "posts" });
    const users = makeGridTabId({ connection: "db", kind: "data", table: "users" });
    expect(workspaceOfVirtual(workspaceHomeTabId("content"), "content-home")).toBe("content");
    expect(workspaceOfVirtual(pages, "grid")).toBe("content");
    expect(workspaceOfVirtual(posts, "grid")).toBe("content");
    expect(workspaceOfVirtual(users, "grid")).toBe("design");
  });

  test("an entry's form editor is Content's", () => {
    expect(workspaceOfNew("data/thing.json", { mode: "entry" })).toBe("content");
  });

  test("a media viewer is Media's, and the media home is too", () => {
    expect(workspaceOfNew("public/logo.png", { mode: "media" })).toBe("media");
    expect(workspaceOfVirtual(workspaceHomeTabId("media"), "media-home")).toBe("media");
  });

  test("a comparison is Publish's, and the publish home is too", () => {
    expect(workspaceOfNew("pages/about.json", { mode: "git-diff" })).toBe("publish");
    expect(workspaceOfVirtual(workspaceHomeTabId("publish"), "publish-home")).toBe("publish");
  });

  test("project.json is Styles' in both its editors", () => {
    // Project Settings is a dialog over every workspace (§17.1), so no editor of this tab is Design's.
    const config = tab("project.json", { mode: "stylebook" });
    expect(workspaceOfTab(config)).toBe("styles");
    config.session.ui.canvasMode = "source";
    expect(workspaceOfTab(config)).toBe("styles");
  });
});

describe("writesOnCanvas", () => {
  test("is a document in an editing canvas mode, and nothing else", () => {
    expect(writesOnCanvas(tab("content/posts/a.md", { mode: "edit" }))).toBe(true);
    expect(writesOnCanvas(tab("pages/b.json", { mode: "design" }))).toBe(true);
    expect(writesOnCanvas(tab("content/posts/c.md", { mode: "entry" }))).toBe(false);
    expect(writesOnCanvas(tab("pages/d.json", { mode: "source" }))).toBe(false);
    const content = workspaceHomeTabId("content");
    expect(writesOnCanvas(openVirtualTab(content, "content-home"))).toBe(false);
    const home = workspaceHomeTabId("media");
    expect(writesOnCanvas(openVirtualTab(home, "edit"))).toBe(false);
    const grid = makeGridTabId({ kind: "collection", name: "posts" });
    expect(writesOnCanvas(tab(grid, { mode: "edit" }))).toBe(false);
  });
});

describe("the strip filter", () => {
  test("a pane draws only the tabs of the workspace on screen, in strip order", () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    tab("pages/b.json");
    const [pane] = workspace.panes;
    expect(workspaceTabOrder(pane!)).toEqual(["pages/a.json", "pages/b.json"]);
    shell.workspace = "content";
    expect(workspaceTabOrder(pane!)).toEqual(["content/posts/one.md"]);
    expect(workspaceTabOrder(pane!, "media")).toEqual([]);
    // Nothing is removed from the pane: the hidden tabs keep their slots.
    expect(pane!.tabOrder).toEqual(["pages/a.json", "content/posts/one.md", "pages/b.json"]);
  });

  test("isTabInWorkspace is false for an id no tab carries", () => {
    expect(isTabInWorkspace("nope")).toBe(false);
    tab("pages/a.json");
    expect(isTabInWorkspace("pages/a.json")).toBe(true);
    expect(isTabInWorkspace("pages/a.json", "content")).toBe(false);
  });
});

describe("the tab a workspace was last in", () => {
  test("is the most recently used of its tabs, in any pane", () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    tab("pages/b.json");
    activateTab("pages/a.json");
    expect(lastTabOfWorkspace("design")).toBe("pages/a.json");
    expect(lastTabOfWorkspace("content")).toBe("content/posts/one.md");
    expect(lastTabOfWorkspace("media")).toBeNull();
  });

  test("falls back to strip order for a tab that was opened without being used", () => {
    tab("pages/a.json");
    workspace.mruOrder = [];
    expect(lastTabOfWorkspace("design")).toBe("pages/a.json");
  });

  test("per pane: the pane's active tab when it is the workspace's, else its most recent one", () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    tab("pages/b.json");
    const [pane] = workspace.panes;
    expect(paneTabOfWorkspace(pane!, "design")).toBe("pages/b.json");
    expect(paneTabOfWorkspace(pane!, "content")).toBe("content/posts/one.md");
    expect(paneTabOfWorkspace(pane!, "styles")).toBeNull();
    workspace.mruOrder = [];
    expect(paneTabOfWorkspace(pane!, "content")).toBe("content/posts/one.md");
  });

  test("a side pane answers for its own tabs only", () => {
    tab("pages/a.json");
    tab("content/posts/one.md");
    const side = splitRight("content/posts/one.md")!;
    expect(paneTabOfWorkspace(side, "content")).toBe("content/posts/one.md");
    expect(paneTabOfWorkspace(side, "design")).toBeNull();
  });
});
