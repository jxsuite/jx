/**
 * Tests for src/browse/library-pane.ts — the Content home: one collection, browsed (studio.md
 * §9.1.2, §22.5).
 *
 * The claims this file holds to account:
 *
 * 1. **A file is in one collection or in none.** Pages are the routed files under `pages/`; an entry
 *    is in the collection `collection-match.ts` names; a template, a component or a media file is
 *    in none, and the home never lists one.
 * 2. **"No files found" is never printed for two different reasons.** A scan that could not read a
 *    directory raises a Problem carrying a Retry command and says the list is INCOMPLETE; a filter
 *    that matched nothing says which filter; an empty collection says that; and none of them is the
 *    sentence shown while the scan is still running.
 * 3. **Each collection keeps its own view**, and where its entries are published is read from the page
 *    whose `$paths.contentType` names it.
 *
 * Everything is addressed by `part`, because the pane is a document (`surfaces/library-pane.json`).
 * A reader's choice on the language facet is made on the NATIVE `<select>` inside `jx-select` and
 * their typing on the `<input>` inside `jx-textfield`. The per-file menu is the `menu` surface, so
 * it is read out of `#layer-popover` and its rows are addressed by id rather than by label.
 */
import {
  answerPromptDialog,
  flush,
  installMockPlatform,
  resetStudioState,
  surfaceOf,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { initLayers } from "../src/ui/layers";
import { problems, resetNotifications } from "../src/services/notify";
import libraryDoc from "../src/surfaces/library-pane.json";
import { LIBRARY_LAYOUTS } from "../src/browse/library-model";
import { activities, resetActivities } from "../src/panels/activity-panel";
import type { DirEntry } from "../src/types";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import type { LibraryViewKind } from "../src/surfaces/library-pane";

// ─── Seams ───────────────────────────────────────────────────────────────────

const opened: string[] = [];
const pagesAdded: string[] = [];
let deleteAnswer = true;

void mock.module("../src/files/files.js", () => ({
  loadDirectory: () => Promise.resolve(),
  openFileInTab: (path: string) => {
    opened.push(path);
    return Promise.resolve();
  },
}));
void mock.module("../src/files/media-upload.js", () => ({
  DEFAULT_MEDIA_DIR: "public/media",
  MEDIA_EXTENSIONS: new Set([".png", ".jpg", ".svg"]),
  extensionOf: (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot).toLowerCase();
  },
  isImage: (ext: string) => ext === ".png",
  uploadAccept: () => "image/*",
}));
void mock.module("../src/files/file-ops.js", () => ({
  confirmFileDelete: () => Promise.resolve(deleteAnswer),
  parseSourceForPath: () => Promise.resolve({ document: { children: [], tagName: "div" } }),
  renamePromptMessage: () => Promise.resolve("Used on 2 pages."),
}));
void mock.module("../src/services/references.js", () => ({
  invalidateUsages: () => {},
}));
/* The witness for **Add one**: the real flow writes the page through Add new's derivation, which
   `add-new.test.ts` covers; this file asserts the home asks for it, for the collection shown. */
void mock.module("../src/create/add-new-flow.js", () => ({
  addCollectionPage: (name: string) => {
    pagesAdded.push(name);
    return Promise.resolve(`pages/${name}/[slug].json`);
  },
}));

const {
  collectionCounts,
  collectionView,
  contentView,
  detachLibraryPane,
  invalidateLibrary,
  libraryPaneMounted,
  librarySource,
  openLibraryFile,
  pageLineFor,
  refreshLibrary,
  renderLibraryMode,
  resetContentView,
  SCAN_ACTIVITY_DELAY_MS,
  setContentCollection,
  setLibraryLayout,
  setLibraryLocale,
  setLibrarySearch,
  shownCollection,
} = await import("../src/browse/library-pane");
const { invalidateCollectionPages } = await import("../src/content/collection-pages");
const { templateDisplayName } = await import("../src/content/content-collections");
const { invalidateEntrySummaries } = await import("../src/content/entry-summaries");
const { invalidatePageSummaries } = await import("../src/content/page-summaries");
const store = await import("../src/store");
const { openTab, closeAllTabs } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { argsSchema, stringProperty } = await import("../src/commands/command-args");

/**
 * What the home's buttons ran. **New** runs `file.new` and **Fields** runs `settings.open`, rather
 * than flows of their own, so the witnesses are stand-in records in the active registry.
 */
const runs: { id: string; args: unknown }[] = [];
const registry = createCommandRegistry({ getContext: emptyContext });
registry.register({
  args: argsSchema(
    {
      collection: stringProperty("collection"),
      kind: stringProperty("kind"),
      locale: stringProperty("locale"),
    },
    [],
  ),
  category: "File",
  id: "file.new",
  level: "project",
  run: (_ctx, args) => {
    runs.push({ args, id: "file.new" });
  },
  title: "Add New…",
});
registry.register({
  args: argsSchema({ entry: stringProperty("entry"), section: stringProperty("section") }, []),
  category: "Project",
  id: "settings.open",
  level: "project",
  run: (_ctx, args) => {
    runs.push({ args, id: "settings.open" });
  },
  title: "Project Settings",
});
registry.register({
  args: argsSchema({ name: stringProperty("name") }),
  category: "Project",
  id: "collection.editInGrid",
  level: "project",
  run: (_ctx, args) => {
    runs.push({ args, id: "collection.editInGrid" });
  },
  title: "Edit Collection in Grid",
});
setActiveRegistry(registry);

// ─── Environment ─────────────────────────────────────────────────────────────

for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
  if (!document.querySelector(`#${id}`)) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
}
initLayers();

globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

/** A stand-in clock, typed as the global it replaces. */
function stubSetTimeout(
  stand: (callback: () => void, ms?: number) => ReturnType<typeof setTimeout>,
): typeof setTimeout {
  /* SAFETY: the stand-in implements the one call shape the pane uses, a callback and a delay. */
  return stand as typeof setTimeout;
}

/* No IntersectionObserver: happy-dom's never fires, so a lazily-mounted preview would simply never
   load. Its absence takes `createPreviewObserver`'s degraded path, where every card in the window
   asks for its preview at once. */
// @ts-expect-error -- removing the global is the point
globalThis.IntersectionObserver = undefined;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function file(name: string, path: string): DirEntry {
  return { name, path, type: "file" };
}

/** The one content collection the fixture project declares. */
const POSTS = {
  format: "Markdown",
  schema: {
    properties: {
      draft: { default: false, type: "boolean" },
      title: { type: "string" },
    },
    required: ["title"],
    type: "object",
  },
  source: "./content/",
};

/**
 * Two pages, one entry, a template and an image: Pages lists the two, Posts lists the one, and the
 * template and the image are in no collection at all.
 */
const TREE = {
  content: [file("2024-01-02-hello.md", "content/2024-01-02-hello.md")],
  layouts: [file("main.json", "layouts/main.json")],
  pages: [file("index.json", "pages/index.json"), file("about.json", "pages/about.json")],
  public: [file("logo.png", "public/logo.png")],
} satisfies Record<string, DirEntry[]>;

/* A detached placeholder until the first mount, so the teardown's `remove()` before it is a no-op. */
let host: HTMLElement = document.createElement("div");

/** The listing a fixture tree holds for a directory, or `undefined` for one it does not hold. */
function listingIn(tree: Record<string, DirEntry[]>, path: string): DirEntry[] | undefined {
  return tree[path];
}

/**
 * A real, empty directory list whose `map` is replaced. `map` is the one member `scanLibrary` reads
 * off `projectDirs`, so this is how a suite makes the scan itself fail rather than one listing.
 */
function dirsMappedBy(map: () => Promise<never>[]): string[] {
  const dirs: string[] = [];
  return Object.assign(dirs, { map });
}

/** The one file the default platform has bytes for. */
const INDEX_ONLY = {
  "pages/index.json": '{"tagName":"div","children":[]}',
} satisfies Record<string, string>;

function setup(
  tree: Record<string, DirEntry[]> = TREE,
  dirs = Object.keys(TREE),
  files: Record<string, string> = INDEX_ONLY,
) {
  installMockPlatform(
    {
      listDirectory: (path: string) => {
        const entries = listingIn(tree, path);
        return entries ? Promise.resolve(entries) : Promise.reject(new Error(`HTTP 500: ${path}`));
      },
    },
    files,
  );
  resetStudioState({
    projectConfig: { content: { posts: POSTS } },
    projectDirs: dirs,
    projectRoot: "",
  });
}

/** The Content home's tab: the workspace home id, in the home's canvas mode. */
function homeTab() {
  return openTab({
    capabilities: { modes: ["content-home"] },
    document: { children: [], tagName: "div" },
    documentPath: null,
    id: "workspace://content",
  });
}

async function mount(): Promise<HTMLElement> {
  // A live pane holds the tab id, so a second mount in the same test would be answered by the
  // Re-entrancy guard and leave the new host empty.
  detachLibraryPane("primary");
  host.remove();
  closeAllTabs();
  const tab = homeTab();
  host = document.createElement("div");
  document.body.append(host);
  renderLibraryMode(surfaceOf(host), tab);
  await flush();
  await flush();
  return host;
}

function text(): string {
  return host.textContent;
}

/** Everything drawn under a part, in DOM order. */
function parts(name: string): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(`[part="${name}"]`)];
}

/** The one element under a part, or null. */
function part(name: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[part="${name}"]`);
}

/** The pane's scroller. */
function body(): HTMLElement {
  return part("body")!;
}

/** The rows of whichever menu the home has up, addressed by id. */
function menuIds(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>("#layer-popover jx-menu-item[data-command-id]"),
  ].map((el) => el.dataset.commandId!);
}

/** One menu row, by the id it runs. */
function menuRow(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    `#layer-popover jx-menu-item[data-command-id="${id}"]`,
  );
  if (!found) {
    throw new Error(`no menu row: ${id} (have: ${menuIds().join(", ")})`);
  }
  return found;
}

/** The native control inside a kit element — what a reader actually drives. */
function control<T extends HTMLElement>(name: string, tag: string): T {
  return part(name)!.querySelector<T>(tag)!;
}

beforeEach(() => {
  runs.length = 0;
  opened.length = 0;
  pagesAdded.length = 0;
  deleteAnswer = true;
  resetNotifications();
  resetActivities();
  detachLibraryPane("primary");
  resetContentView();
  invalidateCollectionPages();
  invalidateEntrySummaries();
  // Cards, because most of what is asserted here is a card per file.
  setLibraryLayout("cards", "pages");
  setLibraryLayout("cards", "posts");
  setup();
});

afterEach(() => {
  detachLibraryPane("primary");
  host.remove();
});

// ─── The document and the projection ─────────────────────────────────────────

describe("the one discriminant", () => {
  /** Every `part` and `$switch` in the document, walked once. */
  function slotCases(slot: string): string[] {
    const seen: string[] = [];
    const walk = (node: JsonValue): void => {
      if (Array.isArray(node)) {
        for (const child of node) {
          walk(child);
        }
        return;
      }
      if (!isJsonObject(node)) {
        return;
      }
      const { attributes, cases } = node;
      if (isJsonObject(attributes) && attributes.part === slot && isJsonObject(cases)) {
        seen.push(...Object.keys(cases));
      }
      for (const value of Object.values(node)) {
        walk(value);
      }
    };
    walk(libraryDoc);
    return seen;
  }

  /**
   * The eight states, in one place, twice — and this is what holds the two spellings together. A
   * `$switch` renders NOTHING for a key it has no case for, silently.
   */
  const KINDS: LibraryViewKind[] = [
    "loading",
    "incomplete",
    "empty",
    "nomatch",
    "cards",
    "table",
    "calendar",
    "board",
  ];

  test("the document draws a case for every view the projection can name", () => {
    expect(slotCases("view-slot").toSorted()).toEqual([...KINDS].toSorted());
  });

  test("every layout the model declares is one of them, and Media is no longer one", () => {
    for (const layout of LIBRARY_LAYOUTS) {
      expect(KINDS).toContain(layout);
    }
    expect(LIBRARY_LAYOUTS).not.toContain("media");
  });

  test("the header line has a case for each state but hidden, which draws nothing", () => {
    expect(slotCases("page-slot").toSorted()).toEqual(["loading", "none", "page"]);
  });
});

// ─── Mounting ────────────────────────────────────────────────────────────────

describe("mounting", () => {
  test("draws the home and reports itself mounted for that tab", async () => {
    await mount();
    expect(host.querySelector('[data-jx-region="pane.primary/content"]')).not.toBeNull();
    expect(libraryPaneMounted("primary", homeTab())).toBe(true);
  });

  test("a second mount for the same tab is a no-op — the pane owns its own reactivity", async () => {
    const tab = homeTab();
    host = document.createElement("div");
    document.body.append(host);
    renderLibraryMode(surfaceOf(host), tab);
    await flush();
    const first = part("library");
    renderLibraryMode(surfaceOf(host), tab);
    await flush();
    expect(part("library")).toBe(first!);
  });

  test("detaching is idempotent", async () => {
    await mount();
    detachLibraryPane("primary");
    detachLibraryPane("primary");
    expect(libraryPaneMounted("primary", homeTab())).toBe(false);
  });

  test("a pane torn down before its mount settles leaves no document behind", async () => {
    const tab = homeTab();
    host = document.createElement("div");
    document.body.append(host);
    renderLibraryMode(surfaceOf(host), tab);
    detachLibraryPane("primary");
    await flush();
    await flush();
    expect(part("library")).toBeNull();
    expect(libraryPaneMounted("primary", tab)).toBe(false);
  });

  test("a settle pass that outlives its pane runs against nothing, least of all its successor", async () => {
    const reads: string[] = [];
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: (path: string) => {
        reads.push(path);
        return Promise.resolve('{"tagName":"div","children":[]}');
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await mount();
    await flush();
    const held: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = stubSetTimeout((fn, ms) => {
      held.push(fn);
      return realSetTimeout(() => {}, ms);
    });
    try {
      setLibrarySearch("index");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(held.length).toBe(1);
    const stale = host;
    const successor = openTab({
      capabilities: { modes: ["content-home"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "workspace://content-successor",
    });
    host = document.createElement("div");
    document.body.append(host);
    renderLibraryMode(surfaceOf(host), successor);
    await flush();
    await flush();
    const before = reads.length;
    const { revision } = contentView;
    expect(() => held[0]!()).not.toThrow();
    await flush();
    expect(reads.length).toBe(before);
    expect(contentView.revision).toBe(revision);
    expect(libraryPaneMounted("primary", successor)).toBe(true);
    const slot = host.querySelector<HTMLElement>(
      '[part="doc-preview"][data-path="pages/index.json"]',
    );
    expect(slot?.childElementCount).toBe(1);
    stale.remove();
  });

  test("a repaint while previews are still loading does not ask for them twice", async () => {
    const reads: string[] = [];
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: (path: string) => {
        reads.push(path);
        return Promise.resolve('{"tagName":"div","children":[]}');
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await mount();
    const first = reads.length;
    expect(first).toBeGreaterThan(0);
    setLibrarySearch("");
    await flush();
    expect(reads.length).toBe(first);
  });

  test("a document that cannot be rendered leaves its card without a preview, not broken", async () => {
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: () => Promise.reject(new Error("EIO")),
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await mount();
    await flush();
    expect(parts("card").length).toBe(2);
    expect(part("doc-preview")?.firstElementChild ?? null).toBeNull();
  });

  test("scans the project once and lists only the shown collection's files", async () => {
    await mount();
    expect(librarySource().files().length).toBe(5);
    // Pages are in the order the router matches them, the Site panel's order: Home first.
    expect(parts("card").map((card) => card.dataset.path)).toEqual([
      "pages/index.json",
      "pages/about.json",
    ]);
  });

  test("a card's preview is an island the document renders empty and the host fills", async () => {
    await mount();
    await flush();
    const slot = host.querySelector<HTMLElement>(
      '[part="doc-preview"][data-path="pages/index.json"]',
    );
    expect(slot).not.toBeNull();
    expect(slot!.childElementCount).toBe(1);
  });
});

// ─── Collections ─────────────────────────────────────────────────────────────

describe("collections", () => {
  test("Pages is the built-in collection the home opens on, titled for what it lists", async () => {
    await mount();
    expect(shownCollection().key).toBe("pages");
    expect(part("title")!.textContent).toBe("Pages");
    expect(part("subtitle")!.textContent).toBe("Every URL on your site.");
    expect(part("new")!.textContent).toContain("New page");
  });

  test("showing a collection lists its entries, and never a template, a component or an image", async () => {
    await mount();
    setContentCollection("posts");
    await flush();
    expect(part("title")!.textContent).toBe("Posts");
    expect(parts("card").map((card) => card.dataset.path)).toEqual(["content/2024-01-02-hello.md"]);
    const shown = text();
    expect(shown).not.toContain("main.json");
    expect(shown).not.toContain("logo.png");
  });

  test("the counts are per collection, from the one scan", async () => {
    await mount();
    expect(collectionCounts()).toEqual(
      new Map([
        ["pages", 2],
        ["posts", 1],
      ]),
    );
  });

  test("counts before any scan start one and answer null until it lands", async () => {
    expect(collectionCounts()).toBeNull();
    await flush();
    await flush();
    expect(collectionCounts()?.get("pages")).toBe(2);
  });

  /* A window restored into Content asks for its rows before the project's directories have loaded.
     The walk of none was cached as "this project has no pages" until a reload; the next ask that
     finds the list grown drops it instead. */
  test("a scan of a list the project has since outgrown is dropped on the next ask", async () => {
    setup(TREE, []);
    await mount();
    expect(collectionCounts()?.get("pages")).toBeUndefined();
    store.projectState!.projectDirs = Object.keys(TREE);
    expect(collectionCounts()).toBeNull();
    await flush();
    await flush();
    expect(collectionCounts()?.get("pages")).toBe(2);
  });

  test("each collection keeps its own view, search and language", async () => {
    await mount();
    setLibraryLayout("board");
    setLibrarySearch("about");
    setContentCollection("posts");
    await flush();
    expect(collectionView().layout).toBe("cards");
    expect(collectionView().query).toBe("");
    expect(part("board")).toBeNull();
    setContentCollection("pages");
    await flush();
    expect(collectionView("pages")).toEqual({ layout: "board", locale: "", query: "about" });
    expect(part("board")).not.toBeNull();
  });

  test("a collection the project no longer declares falls back to Pages", async () => {
    contentView.collection = "gone";
    expect(shownCollection().key).toBe("pages");
  });

  test("a stale collection key never receives the view, search or language writes", async () => {
    await mount();
    contentView.collection = "gone";
    setLibraryLayout("board");
    setLibrarySearch("about");
    await flush();
    expect(part("board")).not.toBeNull();
    setLibraryLocale("fr");
    expect(contentView.views["gone"]).toBeUndefined();
    expect(collectionView("pages")).toEqual({ layout: "board", locale: "fr", query: "about" });
    expect(collectionView()).toBe(collectionView("pages"));
  });

  test("a collection shows no subtitle, and Fields; Pages has no Fields", async () => {
    await mount();
    expect(part("fields")).toBeNull();
    setContentCollection("posts");
    await flush();
    expect(part("subtitle")!.textContent).toBe("");
    part("fields")!.click();
    await flush();
    expect(runs).toEqual([{ args: { entry: "posts", section: "content" }, id: "settings.open" }]);
  });

  test("a collection's Table names each entry by its title and status, the file after", async () => {
    setup(
      { content: [file("hello.json", "content/hello.json"), file("b.json", "content/b.json")] },
      ["content"],
      {
        "content/b.json": JSON.stringify({ title: "Winter prep" }),
        "content/hello.json": JSON.stringify({ draft: true, title: "Hello world" }),
      },
    );
    await mount();
    setContentCollection("posts");
    setLibraryLayout("table");
    await flush();
    await flush();
    await flush();
    const head = parts("cell").filter((cell) => cell.getAttribute("role") === "columnheader");
    expect(head.map((cell) => cell.textContent.trim())).toEqual([
      "Title",
      "Status",
      "Locale",
      "Modified",
      "Path",
    ]);
    const rows = parts("table-row").map((row) => row.textContent);
    expect(rows.some((row) => row.includes("Hello world") && row.includes("Draft"))).toBe(true);
    expect(rows.some((row) => row.includes("Winter prep") && row.includes("Published"))).toBe(true);
  });

  test("a collection offers Edit in grid, which opens its grid; Pages does not", async () => {
    await mount();
    expect(part("edit-grid")).toBeNull();
    setContentCollection("posts");
    await flush();
    part("edit-grid")!.click();
    await flush();
    expect(runs).toEqual([{ args: { name: "posts" }, id: "collection.editInGrid" }]);
  });

  test("New is named for the collection's item and asks Add new for its kind", async () => {
    await mount();
    expect(part("new")!.textContent).toContain("New page");
    part("new")!.click();
    await flush();
    setContentCollection("posts");
    await flush();
    expect(part("new")!.textContent).toContain("New post");
    part("new")!.click();
    await flush();
    // The language the view is filtered to is the one the new entry is written in.
    setLibraryLocale("fr", "posts");
    await flush();
    part("new")!.click();
    await flush();
    expect(runs.map((run) => run.args)).toEqual([
      { kind: "page" },
      { collection: "posts", kind: "entry" },
      { collection: "posts", kind: "entry", locale: "fr" },
    ]);
  });

  test("a click on a page opens it; a click on an entry opens it where it is written", async () => {
    await mount();
    host.querySelector<HTMLElement>('[part="card"][data-path="pages/about.json"]')!.click();
    setContentCollection("posts");
    await flush();
    parts("card")[0]!.click();
    await flush();
    await flush();
    expect(opened).toEqual(["pages/about.json", "content/2024-01-02-hello.md"]);
  });

  test("a card or a row opens on Enter and Space, so the keyboard reaches every entry", async () => {
    await mount();
    const card = host.querySelector<HTMLElement>('[part="card"][data-path="pages/about.json"]')!;
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("role")).toBe("button");
    card.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await flush();
    // Any other key is the reader's, and opens nothing.
    card.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    setLibraryLayout("table");
    await flush();
    const row = host.querySelector<HTMLElement>('[part="table-row"]')!;
    expect(row.getAttribute("tabindex")).toBe("0");
    row.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    await flush();
    await flush();
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe("pages/about.json");
  });

  test("the view switch is named View, not Layout, which in Jx means a template", async () => {
    await mount();
    // The group names itself to assistive technology from its `label`.
    const group = part("layouts")!;
    /* SAFETY: `$props` writes `label` as a property of the kit element; that is the one member read. */
    expect((group as HTMLElement & { label?: string }).label).toBe("View");
  });

  test("a CSV collection is its records: counted, tabled with their fields, opened in the file", async () => {
    const csv = "content/pricing/prices.csv";
    installMockPlatform(
      {
        listDirectory: (path: string) =>
          path === "content"
            ? Promise.resolve([{ name: "pricing", path: "content/pricing", type: "directory" }])
            : path === "content/pricing"
              ? Promise.resolve([file("prices.csv", csv)])
              : Promise.resolve([]),
      },
      { [csv]: "Title,sku\nTilt Trailer,tilt\nMini Trencher,trencher\n" },
    );
    resetStudioState({
      projectConfig: {
        content: {
          pricing: {
            format: "Csv",
            schema: { properties: { Title: { type: "string" }, sku: { type: "string" } } },
            source: "./content/pricing/prices.csv",
          },
        },
      },
      projectDirs: ["content"],
      projectRoot: "",
    });
    invalidateLibrary();
    setLibraryLayout("table", "pricing");
    setContentCollection("pricing");
    await mount();
    expect(collectionCounts()?.get("pricing")).toBe(2);
    const rows = parts("table-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Tilt Trailer"),
      expect.stringContaining("Mini Trencher"),
    ]);
    expect(rows[0]!.textContent).toContain("tilt");
    expect(rows[0]!.textContent).toContain(csv);
    // Entries are rows of the file: no New, and the header line is drawn as for any collection.
    expect(part("new")).toBeNull();
    expect(text()).toContain("Entries have no page of their own");
    rows[1]!.click();
    await flush();
    // A record opens its file, and right-clicking one offers no file verbs that would hit the file.
    rows[1]!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    await flush();
    expect(menuIds()).toEqual([]);
    // Edit in grid opens the file's own grid: `collection.editInGrid` grids folders.
    part("edit-grid")!.click();
    await flush();
    expect(opened).toEqual([csv, csv]);
    expect(runs).toEqual([]);
  });

  test("openLibraryFile routes a file in no collection to the ordinary opener", async () => {
    openLibraryFile({ collection: null, path: "layouts/main.json" });
    await flush();
    expect(opened).toEqual(["layouts/main.json"]);
  });
});

// ─── Where a collection is published ─────────────────────────────────────────

describe("the header line", () => {
  test("Pages has none", async () => {
    await mount();
    expect(part("page-line")).toBeNull();
  });

  test("a collection with no page says so, and Add one writes it", async () => {
    await mount();
    setContentCollection("posts");
    await flush();
    await flush();
    await flush();
    expect(part("page-line")!.dataset.state).toBe("none");
    expect(text()).toContain("Entries have no page of their own");
    part("add-page")!.click();
    await flush();
    await flush();
    expect(pagesAdded).toEqual(["posts"]);
  });

  test("a collection with a page names its URL and template, and opens it in Design", async () => {
    const tree = {
      ...TREE,
      pages: [
        ...TREE.pages,
        { name: "blog", path: "pages/blog", type: "directory" },
      ] satisfies DirEntry[],
      "pages/blog": [file("[slug].json", "pages/blog/[slug].json")],
    };
    setup(tree, Object.keys(TREE), {
      "pages/blog/[slug].json": JSON.stringify({
        $layout: "./layouts/post.json",
        $paths: { contentType: "posts", param: "slug" },
        tagName: "article",
      }),
      "pages/index.json": '{"tagName":"div","children":[]}',
    });
    await mount();
    setContentCollection("posts");
    await flush();
    await flush();
    await flush();
    const line = part("page-line")!;
    expect(line.dataset.state).toBe("page");
    expect(line.textContent).toContain("Each post has a page at");
    expect(part("page-pattern")!.textContent).toBe("/blog/:slug");
    expect(part("page-template")!.textContent).toBe("using Post");
    expect(part("design-page")!.textContent).toContain("Design the post page");
    part("design-page")!.click();
    await flush();
    expect(opened).toEqual(["pages/blog/[slug].json"]);
  });

  test("pageLineFor states each case in words", () => {
    const pages = {
      fileBacked: false,
      item: "page",
      key: "pages",
      kind: "pages" as const,
      title: "Pages",
    };
    const posts = {
      fileBacked: false,
      item: "post",
      key: "posts",
      kind: "collection" as const,
      title: "Posts",
    };
    const csv = { ...posts, fileBacked: true };
    expect(pageLineFor(pages, null, null).state).toBe("hidden");
    // A CSV collection's records can have pages too (`$paths` expands over them), so it has the line.
    expect(pageLineFor(csv, null, null).state).toBe("none");
    expect(pageLineFor(posts, undefined, null).state).toBe("loading");
    const page = {
      field: null,
      layout: undefined,
      param: "slug",
      path: "pages/[slug].json",
      pattern: "/:slug",
      locale: null,
    };
    expect(pageLineFor(posts, page, "./layouts/base.json").template).toBe("using Base");
    expect(pageLineFor(posts, page, null).template).toBe("with no template");
    expect(pageLineFor(posts, { ...page, layout: false }, "./layouts/base.json").template).toBe(
      "with no template",
    );
    expect(templateDisplayName("./layouts/post.json")).toBe("Post");
  });
});

// ─── Honest states ───────────────────────────────────────────────────────────

describe("the four states the old view called “No files found”", () => {
  test("an empty collection says exactly that, and how to add the first one", async () => {
    setup({ pages: [] }, ["pages"]);
    await mount();
    const shown = text();
    expect(shown).toContain("No pages yet.");
    expect(shown).toContain("New page adds the first one.");
  });

  test("a filter that matched nothing names the filter, and offers to clear it", async () => {
    await mount();
    setLibrarySearch("zzz");
    await flush();
    const shown = text();
    expect(shown).toContain("No pages match");
    expect(shown).toContain("zzz");
    expect(shown).toContain("2 pages in all.");
    part("reset")!.click();
    await flush();
    expect(collectionView().query).toBe("");
  });

  test("a scan that could not read a directory says INCOMPLETE, not empty", async () => {
    setup(TREE, [...Object.keys(TREE), "broken"]);
    await mount();
    const shown = text();
    expect(shown).toContain("This list is incomplete");
    expect(shown).toContain("broken");
  });

  test("the banner's Retry re-scans without the reader leaving the pane", async () => {
    let attempt = 0;
    installMockPlatform({
      listDirectory: (path: string) => {
        attempt += 1;
        return attempt <= 4
          ? Promise.reject(new Error("HTTP 500"))
          : Promise.resolve(listingIn(TREE, path) ?? []);
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await mount();
    parts("retry")[0]!.click();
    await flush();
    await flush();
    expect(parts("card").length).toBe(2);
  });

  test("a partly-failed scan offers Retry in the banner above the list it did get", async () => {
    let broken = true;
    installMockPlatform({
      listDirectory: (path: string) => {
        if (path === "broken") {
          return broken ? Promise.reject(new Error("HTTP 500")) : Promise.resolve([]);
        }
        return Promise.resolve(listingIn(TREE, path) ?? []);
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: [...Object.keys(TREE), "broken"] });
    await mount();
    const banner = part("banner")!;
    broken = false;
    banner.querySelector<HTMLElement>('[part="retry"]')!.click();
    await flush();
    await flush();
    expect(part("banner")).toBeNull();
  });

  test("and raises a Problem carrying the retry command and the directory", async () => {
    setup(TREE, [...Object.keys(TREE), "broken"]);
    await mount();
    const problem = problems.at(-1)!;
    expect(problem.severity).toBe("error");
    expect(problem.action).toBe("content.refresh");
    expect(problem.path).toBe("broken");
    expect(problem.detail).toContain("HTTP 500");
    expect(problem.source).toBe("Content");
  });

  test("a scan that failed entirely does not claim the collection is empty", async () => {
    setup({}, ["pages", "public"]);
    await mount();
    const shown = text();
    expect(shown).toContain("the scan did not finish");
    expect(shown).not.toContain("No pages yet");
  });

  test("the failure's Retry re-scans", async () => {
    let attempt = 0;
    installMockPlatform({
      listDirectory: (path: string) => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error("HTTP 500"));
        }
        return Promise.resolve(listingIn(TREE, path) ?? []);
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: ["pages"] });
    await mount();
    expect(text()).toContain("did not finish");
    await refreshLibrary();
    await flush();
    expect(parts("card").length).toBe(2);
  });
});

// ─── The language facet ──────────────────────────────────────────────────────

describe("the language facet", () => {
  const I18N_TREE = {
    layouts: [file("main.json", "layouts/main.json")],
    pages: [
      { name: "fr", path: "pages/fr", type: "directory" },
      { name: "de", path: "pages/de", type: "directory" },
      file("index.json", "pages/index.json"),
    ],
    "pages/de": [file("index.json", "pages/de/index.json")],
    "pages/fr": [file("about.json", "pages/fr/about.json")],
  } satisfies Record<string, DirEntry[]>;

  function setupI18n(locales: string[] = ["en", "fr", "de"]) {
    installMockPlatform({
      listDirectory: (path: string) => {
        const entries = listingIn(I18N_TREE, path);
        return entries ? Promise.resolve(entries) : Promise.reject(new Error(`HTTP 500: ${path}`));
      },
    });
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales } },
      projectDirs: ["pages", "layouts"],
      projectRoot: "",
    });
  }

  function picker(): HTMLSelectElement | null {
    return part("locale")?.querySelector("select") ?? null;
  }

  test("draws a picker of the locales PRESENT, labelled in each language's own words", async () => {
    setupI18n();
    await mount();
    const options = [...picker()!.options].map((el) => [el.value, el.textContent.trim()]);
    expect(options).toEqual([
      ["all", "All languages"],
      ["en", "English"],
      ["fr", "français"],
      ["de", "Deutsch"],
    ]);
  });

  test("draws no picker at all where there is nothing to choose between", async () => {
    setupI18n(["en"]);
    await mount();
    expect(picker()).toBeNull();
    setup();
    await mount();
    expect(picker()).toBeNull();
  });

  test("its options come from every file of the collection, not from the filtered ones", async () => {
    setupI18n();
    await mount();
    setLibraryLocale("fr");
    await flush();
    expect([...picker()!.options]).toHaveLength(4);
  });

  test("choosing a language filters to it, and All puts every file back", async () => {
    setupI18n();
    await mount();
    const select = picker()!;
    select.value = "fr";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(parts("card").map((card) => card.dataset.path)).toEqual(["pages/fr/about.json"]);
    picker()!.value = "all";
    picker()!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(collectionView().locale).toBe("");
    expect(parts("card")).toHaveLength(3);
  });

  test("the locale is in the render effect's dependency list, not merely in the setter's bump", async () => {
    setupI18n();
    await mount();
    collectionView().locale = "de";
    await flush();
    expect(parts("card").map((card) => card.dataset.path)).toEqual(["pages/de/index.json"]);
  });

  test("a filter that matched nothing names the LANGUAGE too, and Clear filters clears it", async () => {
    setupI18n();
    await mount();
    setLibrarySearch("zzz");
    setLibraryLocale("fr");
    await flush();
    expect(text()).toContain("in français");
    part("reset")!.click();
    await flush();
    expect(collectionView().locale).toBe("");
    expect(collectionView().query).toBe("");
  });
});

// ─── Views ───────────────────────────────────────────────────────────────────

describe("views", () => {
  test("switching view repaints from the SAME scan — no second read", async () => {
    let reads = 0;
    installMockPlatform({
      listDirectory: (path: string) => {
        reads += 1;
        return Promise.resolve(listingIn(TREE, path) ?? []);
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await mount();
    const after = reads;
    for (const layout of ["table", "calendar", "board"] as const) {
      setLibraryLayout(layout);
      await flush();
    }
    expect(reads).toBe(after);
    expect(part("board")).not.toBeNull();
  });

  test("each view draws its own structure; Table carries a page's URL", async () => {
    await mount();
    setLibraryLayout("table");
    await flush();
    expect(part("table-head")!.textContent).toContain("URL");
    expect(
      host.querySelector('[part="table-row"] [part="cell"][data-field="url"]')?.textContent,
    ).toBe("/");
    setLibraryLayout("calendar");
    await flush();
    expect(part("calendar")).not.toBeNull();
  });

  /* The Content-Pages board: Title, URL, Template, Status, Edited, in route order. Two pages are
     both `index.json` in a real site, so a file name is not a title. */
  test("the Pages Table names each page as the Site panel does, with its template", async () => {
    invalidatePageSummaries();
    setup(TREE, Object.keys(TREE), {
      "pages/about.json": '{"$layout":"./layouts/main.json","draft":true,"tagName":"div"}',
      "pages/index.json": '{"tagName":"div"}',
    });
    await mount();
    setLibraryLayout("table");
    await flush();
    await flush();
    await flush();
    const rows = parts("table-row").map((row) =>
      [...row.querySelectorAll('[part="cell"]')].map((cell) => cell.textContent),
    );
    expect(part("table-head")!.textContent).toBe("TitleURLTemplateStatusEdited");
    expect(part("table")!.getAttribute("aria-label")).toBe("Pages");
    expect(rows.map((cells) => cells.slice(0, 4))).toEqual([
      ["Home", "/", "None", "Published"],
      ["About", "/about", "Main", "Draft"],
    ]);
  });

  test("Calendar and Board name pages by route and read no page", async () => {
    invalidatePageSummaries();
    const reads: string[] = [];
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: (path: string) => {
        reads.push(path);
        return Promise.resolve('{"tagName":"div"}');
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    setLibraryLayout("board");
    await mount();
    await flush();
    setLibraryLayout("calendar");
    await flush();
    expect(text()).toContain("Home");
    expect(reads).toEqual([]);
  });

  test("an entry's Table has no URL column of its own", async () => {
    await mount();
    setContentCollection("posts");
    setLibraryLayout("table");
    await flush();
    expect(part("table-head")!.textContent).not.toContain("URL");
  });

  test("Board groups a collection by folder", async () => {
    setup(
      {
        ...TREE,
        pages: [...TREE.pages, { name: "blog", path: "pages/blog", type: "directory" }],
        "pages/blog": [file("a.json", "pages/blog/a.json")],
      },
      Object.keys(TREE),
    );
    await mount();
    setLibraryLayout("board");
    await flush();
    expect(parts("column-title").map((title) => title.firstElementChild?.textContent)).toEqual([
      "pages",
      "pages/blog",
    ]);
  });

  test("the view switcher runs the same state change the command does", async () => {
    await mount();
    host.querySelector<HTMLElement>('[part="layout"][data-layout="board"]')!.click();
    await flush();
    expect(collectionView().layout).toBe("board");
    expect(part("board")).not.toBeNull();
  });

  test("scrolling the body repaints — the window is recomputed, not the scan", async () => {
    await mount();
    const before = contentView.revision;
    body().dispatchEvent(new Event("scroll"));
    expect(contentView.revision).toBeGreaterThan(before);
  });

  test("the search field filters", async () => {
    await mount();
    const input = control<HTMLInputElement>("search", "input");
    input.value = "about";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(parts("card").length).toBe(1);
  });
});

// ─── The scan, as an operation ───────────────────────────────────────────────

describe("a slow scan", () => {
  test("earns an Activity row rather than a silent wait, and closes it when it lands", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installMockPlatform({
      listDirectory: async (path: string) => {
        await gate;
        return listingIn(TREE, path) ?? [];
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: ["pages"] });
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = stubSetTimeout((fn, ms) =>
      realSetTimeout(fn, ms === SCAN_ACTIVITY_DELAY_MS ? 0 : ms),
    );
    try {
      await mount();
      await flush();
      const row = activities.at(-1)!;
      expect(row.title).toBe("Scan project files");
      expect(row.state).toBe("running");
      expect(row.cancellable).toBe(false);
      release!();
      await flush();
      await flush();
      expect(activities.at(-1)!.state).toBe("done");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("a slow scan that then fails FAILS its row rather than leaving it running", async () => {
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = stubSetTimeout((fn, ms) =>
      realSetTimeout(fn, ms === SCAN_ACTIVITY_DELAY_MS ? 0 : ms),
    );
    resetStudioState({
      projectConfig: null,
      projectDirs: dirsMappedBy(() => [
        new Promise<never>((_resolve, reject) => {
          realSetTimeout(() => reject(new Error("the dev server went away")), 5);
        }),
      ]),
    });
    try {
      await mount();
      await flush();
      await flush();
      expect(activities.at(-1)!.state).toBe("failed");
      expect(problems.at(-1)!.message).toContain("Could not scan");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("a scan that blows up in a way the scanner did not model is still a Problem", async () => {
    resetStudioState({
      projectConfig: null,
      projectDirs: dirsMappedBy(() => {
        throw new TypeError("projectDirs.map is not a function");
      }),
    });
    await mount();
    const problem = problems.at(-1)!;
    expect(problem.message).toBe("Could not scan the project's files.");
    expect(problem.action).toBe("content.refresh");
    expect(problem.tier).toBe("problem");
  });
});

// ─── Context menu ────────────────────────────────────────────────────────────

describe("the per-file context menu", () => {
  async function openContextMenu(index = 0): Promise<void> {
    await mount();
    parts("card")[index]!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await flush();
  }

  test("offers the file's verbs, with Delete set apart", async () => {
    await openContextMenu();
    expect(menuIds()).toEqual(["open", "rename", "duplicate", "delete"]);
  });

  test("opens the file", async () => {
    await openContextMenu();
    menuRow("open").click();
    await flush();
    expect(opened.length).toBe(1);
  });

  test("renames through the shared dialog, which states what moves with the file", async () => {
    await openContextMenu();
    menuRow("rename").click();
    await flush();
    const dialog = document.querySelector("#layer-dialog")!;
    expect(dialog.textContent).toContain("Used on 2 pages.");
    await answerPromptDialog("renamed.json");
    await flush();
    expect(librarySource().files().length).toBeGreaterThan(0);
  });

  test("a cancelled rename changes nothing", async () => {
    await openContextMenu();
    menuRow("rename").click();
    await flush();
    await answerPromptDialog(null);
    await flush();
    expect(problems.length).toBe(0);
  });

  test("duplicates beside the original, with a -copy suffix", async () => {
    const written: string[] = [];
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: () => Promise.resolve("{}"),
      writeFile: (path: string) => {
        written.push(path);
        return Promise.resolve();
      },
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await openContextMenu();
    menuRow("duplicate").click();
    await flush();
    await flush();
    expect(written).toEqual(["pages/index-copy.json"]);
    expect(problems.length).toBe(0);
  });

  test("a refused delete deletes nothing", async () => {
    deleteAnswer = false;
    await openContextMenu();
    menuRow("delete").click();
    await flush();
    expect(librarySource().files().length).toBe(5);
  });

  test("a confirmed delete removes the file and re-scans", async () => {
    const removed: string[] = [];
    installMockPlatform({
      deleteFile: (path: string) => {
        removed.push(path);
        return Promise.resolve();
      },
      listDirectory: (path: string) =>
        Promise.resolve(
          (listingIn(TREE, path) ?? []).filter((entry) => !removed.includes(entry.path)),
        ),
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await openContextMenu();
    menuRow("delete").click();
    await flush();
    await flush();
    expect(removed.length).toBe(1);
    expect(librarySource().files().length).toBe(4);
  });

  test("a failing delete is reported against the path, not swallowed", async () => {
    installMockPlatform({
      deleteFile: () => Promise.reject(new Error("EACCES")),
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await openContextMenu();
    menuRow("delete").click();
    await flush();
    await flush();
    const problem = problems.at(-1)!;
    expect(problem.message).toContain("Could not delete");
    expect(problem.source).toBe("Content");
  });

  test("a second right-click replaces the menu rather than stacking one on it", async () => {
    await openContextMenu();
    expect(document.querySelectorAll("#layer-popover jx-menu").length).toBe(1);
    parts("card")[1]!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await flush();
    expect(document.querySelectorAll("#layer-popover jx-menu").length).toBe(1);
    menuRow("open").click();
    await flush();
    expect(opened).toEqual([parts("card")[1]!.dataset.path!]);
  });

  test("a row whose file the scan has since dropped opens no menu at all", async () => {
    await mount();
    const card = parts("card")[0]!;
    const gone = card.dataset.path!;
    installMockPlatform({
      listDirectory: (dir: string) =>
        Promise.resolve((listingIn(TREE, dir) ?? []).filter((entry) => entry.path !== gone)),
    });
    await refreshLibrary();
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    expect(menuIds()).toEqual([]);
  });

  test("a failing rename and a failing duplicate report the same way", async () => {
    installMockPlatform({
      listDirectory: (path: string) => Promise.resolve(listingIn(TREE, path) ?? []),
      readFile: () => Promise.reject(new Error("EIO")),
      renameFile: () => Promise.reject(new Error("EPERM")),
    });
    resetStudioState({ projectConfig: null, projectDirs: Object.keys(TREE) });
    await openContextMenu();
    menuRow("rename").click();
    await flush();
    await answerPromptDialog("other.json");
    await flush();
    expect(problems.at(-1)!.message).toContain("Could not rename");

    await openContextMenu();
    menuRow("duplicate").click();
    await flush();
    await flush();
    expect(problems.at(-1)!.message).toContain("Could not duplicate");
  });

  test("invalidating drops the scan; the next paint scans again", async () => {
    await mount();
    invalidateLibrary();
    await flush();
    await flush();
    expect(librarySource().scanned()).toBe(true);
  });
});
