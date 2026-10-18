/**
 * The Collections panel (`src/panels/collections-panel.ts` over
 * `src/surfaces/collections-panel.{json,ts}`, specs/studio.md §22.5): the Content workspace's
 * Navigator. It lists Pages and every collection with its count and its saved grid views, and while
 * an entry is being written it lists that collection's entries instead.
 *
 * Everything is addressed by `part` and `data-*`, because the panel is a document. The commands a
 * row runs are stand-in records in the active registry, the witness for "this row runs that verb",
 * and the two lazily imported openers are doubled (AGENTS.md).
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NavigatorPanelDeps } from "../src/panels/panel-registry";
import type { DirEntry } from "../src/types";

const opened: string[] = [];
void mock.module("../src/content/entry-open", () => ({
  openEntry: (path: string) => {
    opened.push(path);
    return Promise.resolve(null);
  },
}));
const grids: string[] = [];
const realGridOpen = await import("../src/grid/grid-open");
void mock.module("../src/grid/grid-open", () => ({
  ...realGridOpen,
  openCollectionGrid: (name: string) => {
    grids.push(`collection:${name}`);
  },
  openPagesGrid: () => {
    grids.push("pages");
  },
}));
/* A Markdown entry's fields come through the format pipeline; the double is its parse. */
void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: (_path: string, source: string) =>
    Promise.resolve({ document: { tagName: "div" }, frontmatter: JSON.parse(source) }),
}));

const { registerRenderer, setProjectState } = await import("../src/store");
const { getPanel, resetPanels } = await import("../src/panels/panel-registry");
const { closeAllTabs, openTab } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { argsSchema, stringProperty } = await import("../src/commands/command-args");
const { saveViewAs } = await import("../src/grid/grid-layout");
const { resetContentView, setContentCollection, setLibraryLocale, invalidateLibrary } =
  await import("../src/browse/library-pane");
const { invalidateEntrySummaries } = await import("../src/content/entry-summaries");
const {
  collectionGridId,
  collectionsPanelValues,
  newEntryLocale,
  registerCollectionsPanel,
  resetCollectionsPanel,
  writingCollection,
} = await import("../src/panels/collections-panel");

const runs: { id: string; args: unknown }[] = [];
const registry = createCommandRegistry({ getContext: emptyContext });
for (const id of ["content.showCollection", "file.new", "grid.applyView"]) {
  registry.register({
    args: argsSchema(
      {
        collection: stringProperty("collection"),
        kind: stringProperty("kind"),
        name: stringProperty("name"),
      },
      [],
    ),
    category: "Project",
    id,
    level: "project",
    run: (_ctx, args) => {
      runs.push({ args, id });
    },
    title: id,
  });
}
setActiveRegistry(registry);

function file(name: string, path: string): DirEntry {
  return { name, path, type: "file" };
}

const TREE = {
  content: [file("a.md", "content/a.md"), file("b.md", "content/b.md")],
  pages: [file("index.json", "pages/index.json")],
} satisfies Record<string, DirEntry[]>;

const FILES = {
  "content/a.md": JSON.stringify({ cover: "/media/a.png", title: "Hello world" }),
  "content/b.md": JSON.stringify({ draft: true, title: "Winter prep" }),
};

/* SAFETY: the panel's afterRender reads neither `deps` nor `doc`, so an empty object stands in. */
const NO_DEPS = {} as NavigatorPanelDeps;

let host: HTMLElement;

function project(tree: Record<string, DirEntry[]> = TREE): void {
  installMockPlatform(
    {
      listDirectory: (path: string) =>
        Promise.resolve(Object.entries(tree).find(([dir]) => dir === path)?.[1] ?? []),
    },
    FILES,
  );
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: true,
    name: "Blog",
    projectConfig: {
      content: {
        posts: {
          format: "markdown",
          schema: { properties: { draft: { type: "boolean" }, title: { type: "string" } } },
          source: "./content",
        },
      },
    },
    projectDirs: ["pages", "content"],
    projectRoot: ".",
    searchQuery: "",
    selectedPath: null,
  });
}

/** Paint the panel the way the Navigator does, and repaint whenever the flow asks it to. */
async function paint(): Promise<void> {
  const record = getPanel("collections")!;
  const draw = () => {
    record.afterRender!({ deps: NO_DEPS, doc: null, rerender: draw }, host);
  };
  registerRenderer("leftPanel", draw);
  draw();
  await flush(10);
}

const parts = (name: string): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(`[part="${name}"]`),
];
const texts = (name: string): string[] => parts(name).map((el) => el.textContent.trim());

beforeEach(() => {
  runs.length = 0;
  opened.length = 0;
  grids.length = 0;
  localStorage.clear();
  resetStudioState();
  resetPanels();
  resetCollectionsPanel();
  resetContentView();
  invalidateLibrary();
  invalidateEntrySummaries();
  closeAllTabs();
  document.body.innerHTML = '<div id="host"><div class="panel-content"></div></div>';
  host = document.querySelector<HTMLElement>(".panel-content")!;
  registerCollectionsPanel();
  project();
});

describe("the record", () => {
  test("is a project-level Navigator panel with no rail button", () => {
    const record = getPanel("collections")!;
    expect([record.level, record.dock, record.rail, record.title]).toEqual([
      "project",
      "navigator",
      false,
      "Collections",
    ]);
  });
});

describe("the collection list", () => {
  test("lists Pages, then each collection, each with its count once the scan lands", async () => {
    await paint();
    await flush(10);
    expect(texts("row-label")).toEqual(["Pages", "Posts"]);
    expect(texts("row-count")).toEqual(["1", "2"]);
  });

  test("marks the collection the Content home is showing", async () => {
    setContentCollection("posts");
    openTab({
      capabilities: { modes: ["content-home"] },
      document: { tagName: "div" },
      documentPath: null,
      id: "workspace://content",
    });
    await paint();
    const selected = parts("collection-row").map((row) => row.dataset.selected);
    expect(selected).toEqual(["false", "true"]);
  });

  test("marks the collection whose grid is showing", () => {
    openTab({
      capabilities: { modes: ["grid"] },
      document: { tagName: "div" },
      documentPath: null,
      id: collectionGridId("pages"),
    });
    const values = collectionsPanelValues();
    expect(values.collections.map((row) => row.selected)).toEqual(["true", "false"]);
  });

  test("a file-backed collection's file lists the collections, with that one marked", async () => {
    const store = await import("../src/store");
    const config = store.projectState!.projectConfig!;
    config.content = {
      posts: { format: "markdown", source: "./content" },
      pricing: { format: "Csv", source: "./content/pricing.csv" },
    };
    const tab = openTab({
      capabilities: { modes: ["grid", "source"] },
      document: { tagName: "div" },
      documentPath: "content/pricing.csv",
      id: "content/pricing.csv",
    });
    // Its grid lists its records, so the panel is no entry list over them.
    expect(writingCollection(tab)).toBeNull();
    const values = collectionsPanelValues();
    expect(values.body).toBe("list");
    expect(values.collections.map((row) => [row.key, row.selected])).toEqual([
      ["pages", "false"],
      ["posts", "false"],
      ["pricing", "true"],
    ]);
  });

  test("a row runs content.showCollection, and New collection runs Add new", async () => {
    await paint();
    parts("collection-row")[1]!.click();
    parts("new-collection")[0]!.click();
    await flush();
    expect(runs).toEqual([
      { args: { collection: "posts" }, id: "content.showCollection" },
      { args: { kind: "collection" }, id: "file.new" },
    ]);
  });

  test("a collection's saved grid views sit beneath it, and one opens its grid on that view", async () => {
    saveViewAs(collectionGridId("posts"), "Drafts");
    saveViewAs(collectionGridId("pages"), "By route");
    await paint();
    expect(texts("view-row")).toEqual(["By route", "Drafts"]);
    // A button keeps its role: the list item is the wrapper around it.
    for (const row of parts("view-row")) {
      expect(row.getAttribute("role")).toBeNull();
      expect(row.parentElement?.getAttribute("role")).toBe("listitem");
    }
    parts("view-row")[1]!.click();
    parts("view-row")[0]!.click();
    await flush(4);
    expect(grids).toEqual(["collection:posts", "pages"]);
  });

  test("a saved view of the grid already showing is applied through grid.applyView", async () => {
    saveViewAs(collectionGridId("posts"), "Drafts");
    openTab({
      capabilities: { modes: ["grid"] },
      document: { tagName: "div" },
      documentPath: null,
      id: collectionGridId("posts"),
    });
    await paint();
    parts("view-row")[0]!.click();
    await flush(4);
    expect(runs).toEqual([{ args: { name: "Drafts" }, id: "grid.applyView" }]);
    expect(grids).toEqual([]);
  });

  test("with no project it asks for one", async () => {
    setProjectState(null);
    await paint();
    expect(parts("no-project")).toHaveLength(1);
  });
});

describe("while an entry is being written", () => {
  function writeEntry(path = "content/a.md") {
    return openTab({
      document: { tagName: "div" },
      documentPath: path,
      id: path,
    });
  }

  test("only an entry of a declared collection switches the panel", () => {
    const answers = [
      writingCollection(null),
      writingCollection(writeEntry()),
      writingCollection(writeEntry("pages/index.json")),
    ];
    expect(answers).toEqual([null, "posts", null]);
  });

  test("lists the collection's entries with their titles and statuses, under a back row", async () => {
    writeEntry();
    await paint();
    await flush(10);
    await paint();
    expect(texts("back")[0]).toContain("Posts");
    expect(texts("entry-title")).toEqual(["Hello world", "Winter prep"]);
    expect(texts("entry-status")).toEqual(["Published", "Draft"]);
    expect(parts("entry-row").map((row) => row.dataset.selected)).toEqual(["true", "false"]);
    expect(parts("entry-row").map((row) => row.getAttribute("role"))).toEqual([null, null]);
    expect(parts("entry-row").map((row) => row.parentElement?.getAttribute("role"))).toEqual([
      "listitem",
      "listitem",
    ]);
    expect(parts("entry-thumb")).toHaveLength(1);
    expect(texts("new-entry")[0]).toContain("New post");
  });

  test("says it is reading before the entries land, and says so when there are none", async () => {
    writeEntry();
    const loading = collectionsPanelValues();
    expect(loading.entriesState).toBe("loading");
    project({ ...TREE, content: [] });
    invalidateLibrary();
    await paint();
    await flush(10);
    expect(collectionsPanelValues().entriesState).toBe("empty");
  });

  test("an entry opens where it is written; back and New run their commands", async () => {
    writeEntry();
    await paint();
    await flush(10);
    await paint();
    parts("entry-row")[1]!.click();
    parts("back")[0]!.click();
    parts("new-entry")[0]!.click();
    await flush();
    expect(opened).toEqual(["content/b.md"]);
    expect(runs).toEqual([
      { args: { collection: "posts" }, id: "content.showCollection" },
      { args: { collection: "posts", kind: "entry" }, id: "file.new" },
    ]);
  });

  test("a new entry starts in the language being written, else the one the view shows", () => {
    resetStudioState({
      projectConfig: {
        content: { ex: { schema: {}, source: "./content/ex/{locale}/" } },
        i18n: { defaultLocale: "en", locales: ["en", "fr-CA", "ar"] },
      },
    });
    // Nothing says a language: the dialog starts on the site's default.
    expect(newEntryLocale("ex")).toEqual({});
    setLibraryLocale("fr-CA", "ex");
    expect(newEntryLocale("ex")).toEqual({ locale: "fr-CA" });
    // The entry being written outranks the view's filter.
    writeEntry("content/ex/ar/clay.md");
    expect(newEntryLocale("ex")).toEqual({ locale: "ar" });
  });

  test("a page is Design's, so a page tab lists the collections", () => {
    writeEntry("pages/index.json");
    expect(collectionsPanelValues().body).toBe("list");
  });
});

describe("mounting", () => {
  test("a second paint into the same box updates the standing document", async () => {
    await paint();
    const first = host.firstElementChild;
    await paint();
    expect(host.firstElementChild).toBe(first);
  });

  test("a new box remounts, and a reset takes the panel down", async () => {
    await paint();
    const other = document.createElement("div");
    document.body.append(other);
    getPanel("collections")!.afterRender!({ deps: NO_DEPS, doc: null, rerender: () => {} }, other);
    await flush(4);
    expect(other.querySelector('[part="collections"]')).not.toBeNull();
    resetCollectionsPanel();
    expect(other.querySelector('[part="collections"]')).toBeNull();
  });
});

describe("the surface handle", () => {
  test("disposed before its mount settles, it leaves nothing behind and reports itself gone", async () => {
    const { emptyCollectionsPanelValues, mountCollectionsPanelSurface } =
      await import("../src/surfaces/collections-panel");
    const box = document.createElement("div");
    document.body.append(box);
    const noop = () => {};
    const handle = mountCollectionsPanelSurface(box, emptyCollectionsPanelValues(), {
      applyView: noop,
      back: noop,
      newCollection: noop,
      newEntry: noop,
      openEntry: noop,
      showCollection: noop,
    });
    expect(handle.connected()).toBe(true);
    handle.dispose();
    await handle.ready;
    await flush(4);
    expect([handle.connected(), box.querySelector('[part="collections"]')]).toEqual([false, null]);
  });
});
