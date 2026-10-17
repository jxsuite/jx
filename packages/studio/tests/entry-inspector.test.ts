/**
 * The Inspector's Entry tab (`src/content/entry-inspector.ts` over
 * `src/surfaces/entry-inspector.*`, specs/studio.md §6, §22.5): a collection entry's status,
 * fields, page URL and file, while the entry is written on the canvas beside it.
 *
 * The entries are opened the way Studio opens them — the real Markdown format, a real tab — so the
 * fields the form draws are the frontmatter the file holds, and a commit lands in it.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { MARKDOWN_FORMAT, mockFormatAction, seedMarkdownFormat } from "./format-fixture";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";
import { openFileInTab } from "../src/files/files";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { argsSchema, stringProperty } from "../src/commands/command-args";
import { invalidateCollectionPages, collectionPages } from "../src/content/collection-pages";
import {
  ENTRY_INSPECTOR_REGION,
  entryInspectorView,
  isEntryTab,
  renderEntryInspector,
  unmountEntryInspector,
} from "../src/content/entry-inspector";
import { renderPageTab, bindPageHost } from "../src/panels/head-panel";
import type { Tab } from "../src/tabs/tab";

const POSTS_SCHEMA = {
  properties: {
    draft: { default: false, type: "boolean" },
    title: { type: "string" },
  },
  required: ["title"],
  type: "object",
};

const runs: unknown[] = [];
const registry = createCommandRegistry({ getContext: emptyContext });
registry.register({
  args: argsSchema({ entry: stringProperty("entry"), section: stringProperty("section") }, []),
  category: "Project",
  id: "settings.open",
  level: "project",
  run: (_ctx, args) => {
    runs.push(args);
  },
  title: "Project Settings",
});
setActiveRegistry(registry);

function project(files: Record<string, string>, withPage = true): void {
  installMockPlatform(
    {
      formatAction: mockFormatAction,
      listDirectory: (path: string) =>
        Promise.resolve(
          withPage && path === "pages"
            ? [{ name: "[slug].json", path: "pages/[slug].json", type: "file" as const }]
            : [],
        ),
      listFormats: async () => [MARKDOWN_FORMAT],
    },
    {
      "pages/[slug].json": JSON.stringify({
        $paths: { contentType: "posts", param: "slug" },
        tagName: "article",
      }),
      ...files,
    },
  );
  seedMarkdownFormat();
  resetStudioState({
    isSiteProject: true,
    projectConfig: {
      content: {
        authors: { format: "json", source: "./content/authors" },
        posts: { format: "Markdown", schema: POSTS_SCHEMA, source: "./content/posts" },
      },
    },
    projectRoot: "/demo",
  });
  invalidateCollectionPages();
}

async function openPost(frontmatter = "title: Hello\n"): Promise<Tab> {
  closeAllTabs();
  const path = "content/posts/spring-planting.md";
  project({ [path]: `---\n${frontmatter}---\n\n# Hello\n` });
  await openFileInTab(path);
  return workspace.tabs.get(path)!;
}

let host: HTMLElement;

async function mount(tab: Tab): Promise<void> {
  renderEntryInspector(host, tab);
  await flush(8);
}

function part(name: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="${name}"]`);
}

beforeEach(() => {
  runs.length = 0;
  unmountEntryInspector();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  unmountEntryInspector();
  closeAllTabs();
});

describe("isEntryTab", () => {
  test("an entry of a directory-backed collection is an entry; a page is not", async () => {
    const tab = await openPost();
    expect(isEntryTab(tab)).toBe(true);
    expect(isEntryTab(null)).toBe(false);
    const page = openTab({ document: { tagName: "div" }, documentPath: "pages/a.json", id: "a" });
    expect(isEntryTab(page)).toBe(false);
  });
});

describe("the view", () => {
  test("states the entry's kind, status, URL and file", async () => {
    const tab = await openPost();
    await collectionPages();
    expect(entryInspectorView(tab)).toMatchObject({
      draft: false,
      draftAxis: "shown",
      fieldsState: "form",
      kind: "Post",
      path: "content/posts/spring-planting.md",
      region: ENTRY_INSPECTOR_REGION,
      status: "Published",
      storage: ". Fields are its frontmatter, and the body is its Markdown.",
      url: "/spring-planting",
      urlState: "shown",
    });
  });

  test("says when the URL is still being read, and when the collection has no page", async () => {
    const tab = await openPost();
    expect(entryInspectorView(tab).urlState).toBe("loading");
    project({}, false);
    await collectionPages();
    expect(entryInspectorView(tab).urlState).toBe("none");
  });

  test("a JSON entry of a collection with no fields says so", () => {
    project({});
    const tab = openTab({
      document: { name: "Ada" },
      documentPath: "content/authors/ada.json",
      id: "content/authors/ada.json",
    });
    const view = entryInspectorView(tab);
    expect([view.fieldsState, view.draftAxis, view.status, view.kind, view.storage]).toEqual([
      "none",
      "hidden",
      "",
      "Author",
      ". Its fields are the file itself.",
    ]);
  });
});

describe("the mounted tab", () => {
  test("draws the fields form, which commits into the entry's frontmatter", async () => {
    const tab = await openPost();
    await mount(tab);
    expect(part("entry")!.dataset.jxRegion).toBe(ENTRY_INSPECTOR_REGION);
    const input = host.querySelector<HTMLInputElement>(
      '[data-prop="title"] [part="text"] [part="input"]',
    )!;
    expect(input.value).toBe("Hello");
    input.value = "Spring planting";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // A text field commits once the typing pauses, as it does in every schema form.
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
    expect(tab.doc.content.frontmatter.title).toBe("Spring planting");
  });

  test("the draft switch writes the flag and the status follows", async () => {
    const tab = await openPost();
    await mount(tab);
    const input = host.querySelector<HTMLInputElement>('[part="draft"] [part="input"]')!;
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(8);
    expect(tab.doc.content.frontmatter.draft).toBe(true);
    expect(part("status")!.textContent).toBe("Draft");
  });

  test("Edit opens Project Settings on the collection's fields", async () => {
    const tab = await openPost();
    await mount(tab);
    part("edit-fields")!.click();
    await flush(2);
    expect(runs).toEqual([{ entry: "posts", section: "content" }]);
  });

  test("a second draw for the same tab updates in place; another tab remounts", async () => {
    const tab = await openPost();
    await mount(tab);
    const root = part("entry");
    renderEntryInspector(host, tab);
    await flush(4);
    expect(part("entry")).toBe(root);
    const other = openTab({
      document: { name: "Ada" },
      documentPath: "content/authors/ada.json",
      id: "content/authors/ada.json",
    });
    renderEntryInspector(host, other);
    await flush(8);
    expect(part("fields")).toBeNull();
    expect(host.textContent).toContain("declares no fields");
    part("edit-fields")!.click();
    await flush(2);
    expect(runs).toEqual([{ entry: "authors", section: "content" }]);
  });

  test("unmounting by another host leaves this one; by its own host takes it down", async () => {
    const tab = await openPost();
    await mount(tab);
    unmountEntryInspector(document.createElement("div"));
    expect(part("entry")).not.toBeNull();
    unmountEntryInspector(host);
    expect(part("entry")).toBeNull();
  });
});

describe("the Page tab hosts it for an entry", () => {
  test("an entry draws the Entry tab; a page draws the page settings", async () => {
    const tab = await openPost();
    bindPageHost(host);
    await flush(8);
    expect(part("entry")).not.toBeNull();
    closeAllTabs();
    renderPageTab();
    await flush(4);
    expect(part("entry")).toBeNull();
    expect(tab.documentPath).toBe("content/posts/spring-planting.md");
    bindPageHost(null);
  });
});
