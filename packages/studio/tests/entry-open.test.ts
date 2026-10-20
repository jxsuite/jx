/**
 * Tests for src/content/entry-open.ts — every door into an entry opens it where it is written: on
 * the canvas in its writing editor, or in the form when it has no body (studio.md §22.5).
 */
import { resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";

const opened: string[] = [];
const forms: string[] = [];

/* The two openers this module chooses between are doubled: the real file opener reads the
   platform and the format registry, and the real form opener is `entry-editor.test.ts`'s. The
   double opens a tab the way the real one does, so the mode switch can be asserted on it. */
void mock.module("../src/files/files.js", () => ({
  openFileInTab: async (path: string) => {
    opened.push(path);
    const { openTab, workspace } = await import("../src/workspace/workspace");
    if (path.startsWith("missing/") || workspace.tabs.has(path)) {
      return;
    }
    openTab({
      capabilities: { modes: ["edit", "design", "preview", "source"] },
      document: { children: [], tagName: "div" },
      documentPath: path,
      id: path,
    });
  },
}));
void mock.module("../src/content/entry-editor.js", () => ({
  openEntryEditor: (path: string) => {
    forms.push(path);
    return Promise.resolve(null);
  },
}));

const { WRITING_MODE, openEntry } = await import("../src/content/entry-open");
const { activeTab, closeAllTabs, workspace } = await import("../src/workspace/workspace");

beforeEach(() => {
  opened.length = 0;
  forms.length = 0;
  closeAllTabs();
  resetStudioState({
    projectConfig: {
      content: {
        authors: { format: "json", source: "./content/authors" },
        posts: { format: "markdown", source: "./content/posts" },
        products: { format: "csv", source: "./content/catalog.csv" },
      },
    },
  });
});

describe("openEntry", () => {
  test("an entry with a body opens on the canvas in its writing editor, focused", async () => {
    const tab = await openEntry("content/posts/hello.md");
    expect(opened).toEqual(["content/posts/hello.md"]);
    expect(forms).toEqual([]);
    expect(tab?.session.ui.canvasMode).toBe(WRITING_MODE);
    expect(activeTab.value?.id).toBe("content/posts/hello.md");
  });

  test("a tab showing the entry's form is switched back to writing, and out of Preview", async () => {
    await openEntry("content/posts/hello.md");
    const tab = workspace.tabs.get("content/posts/hello.md")!;
    tab.session.ui.canvasMode = "entry";
    tab.session.ui.preview = true;
    await openEntry("content/posts/hello.md");
    expect(tab.session.ui.canvasMode).toBe("edit");
    expect(tab.session.ui.preview).toBe(false);
  });

  test("a tab already writing on the canvas keeps its view", async () => {
    await openEntry("content/posts/hello.md");
    const tab = workspace.tabs.get("content/posts/hello.md")!;
    tab.session.ui.canvasMode = "design";
    await openEntry("content/posts/hello.md");
    expect(tab.session.ui.canvasMode).toBe("design");
  });

  test("a JSON entry IS its fields, so it opens in the form", async () => {
    await openEntry("content/authors/ada.json");
    expect(forms).toEqual(["content/authors/ada.json"]);
    expect(opened).toEqual([]);
  });

  test("a catalogue row's file and a file in no collection open as the file opener opens them", async () => {
    await openEntry("content/catalog.csv");
    const page = await openEntry("pages/index.json");
    expect(opened).toEqual(["content/catalog.csv", "pages/index.json"]);
    expect(forms).toEqual([]);
    expect(page?.documentPath).toBe("pages/index.json");
  });

  test("an entry whose file could not be opened answers null", async () => {
    resetStudioState({
      projectConfig: { content: { posts: { format: "markdown", source: "./missing" } } },
    });
    expect(await openEntry("missing/hello.md")).toBeNull();
  });
});
