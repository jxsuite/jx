/**
 * Tests for src/browse/library-pane.ts — the Library editor kind.
 *
 * The two claims this file exists to hold to account:
 *
 * 1. **"No files found" is never printed for two different reasons.** A scan that could not read a
 *    directory raises a Problem carrying a Retry command and says the list is INCOMPLETE; a filter
 *    that matched nothing says which filter; a project with no files says that; and none of them is
 *    the sentence shown while the scan is still running.
 * 2. **An upload has a destination the author chose.** With a category that names one it is printed on
 *    the control before the drop; with "All" it is asked for, and cancelling asks nobody's
 *    permission to guess.
 *
 * Everything is addressed by `part`, because the pane is a document (`surfaces/library-pane.json`):
 * there is no `.library-card`, `.library-body` or `.library-empty` to find any more. A reader's
 * choice on the language facet is made on the NATIVE `<select>` inside `jx-select` and their typing
 * on the `<input>` inside `jx-textfield`, because writing the host's property would move a control
 * no reader can move. The per-file menu and the New menu are the `menu` surface, so they are read
 * out of `#layer-popover` and their rows are addressed by command id rather than by their label.
 */
import {
  answerPromptDialog,
  dragEvent,
  flush,
  installMockPlatform,
  resetStudioState,
  surfaceOf,
  testFile,
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
const uploads: { dir: string | undefined; count: number }[] = [];
let deleteAnswer = true;

void mock.module("../src/files/files.js", () => ({
  loadDirectory: () => Promise.resolve(),
  openFileInTab: (path: string) => {
    opened.push(path);
    return Promise.resolve();
  },
}));
void mock.module("../src/files/media-upload.js", () => ({
  MEDIA_EXTENSIONS: new Set([".png", ".jpg", ".svg"]),
  uploadAccept: () => "image/*",
  extensionOf: (name: string) => {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot).toLowerCase();
  },
  isImage: (ext: string) => ext === ".png",
  uploadAssets: (files: File[], opts: { dir?: string }) => {
    uploads.push({ count: files.length, dir: opts.dir });
    return Promise.resolve(files.map((f) => ({ path: `${opts.dir ?? "?"}/${f.name}` })));
  },
}));
void mock.module("../src/files/file-ops.js", () => ({
  confirmFileDelete: () => Promise.resolve(deleteAnswer),
  parseSourceForPath: () => Promise.resolve({ document: { children: [], tagName: "div" } }),
  renamePromptMessage: () => Promise.resolve("Used on 2 pages."),
}));
void mock.module("../src/services/references.js", () => ({
  invalidateUsages: () => {},
}));

const {
  detachLibraryPane,
  invalidateLibrary,
  libraryNewRequest,
  libraryPaneMounted,
  librarySource,
  libraryView,
  refreshLibrary,
  renderLibraryMode,
  SCAN_ACTIVITY_DELAY_MS,
  resolveUploadDir,
  setLibraryCategory,
  setLibraryLayout,
  setLibraryLocale,
  setLibrarySearch,
} = await import("../src/browse/library-pane");
const { openTab, closeAllTabs } = await import("../src/workspace/workspace");
const { createCommandRegistry } = await import("../src/commands/registry");
const { emptyContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { argsSchema, stringProperty } = await import("../src/commands/command-args");

/**
 * What `file.new` was asked for. The Library's **New** runs the command rather than a flow of its
 * own, so the witness is a stand-in record in the active registry: the real one opens Add new,
 * which `add-new.test.ts` covers.
 */
const fileNewRuns: unknown[] = [];
const registry = createCommandRegistry({ getContext: emptyContext });
registry.register({
  args: argsSchema({ collection: stringProperty("collection"), kind: stringProperty("kind") }, []),
  category: "File",
  id: "file.new",
  level: "project",
  run: (_ctx, args) => {
    fileNewRuns.push(args);
  },
  title: "Add New…",
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

/**
 * A stand-in clock, typed as the global it replaces.
 *
 * The Library arms its timers only as `setTimeout(callback, delay)`: the scan's Activity delay and
 * the settle pass.
 */
function stubSetTimeout(
  stand: (callback: () => void, ms?: number) => ReturnType<typeof setTimeout>,
): typeof setTimeout {
  /* SAFETY: the stand-in implements the one call shape the pane uses, a callback and a delay. It
     lacks only Node's `__promisify__` member and the extra-arguments overload, and nothing under
     test reaches either while the stub is installed. */
  return stand as typeof setTimeout;
}

/* No IntersectionObserver: happy-dom's never fires, so a lazily-mounted preview would simply never
   load and nothing here could assert on it. Its absence takes `createPreviewObserver`'s documented
   degraded path, where every card in the window asks for its preview at once. */
// @ts-expect-error -- removing the global is the point
globalThis.IntersectionObserver = undefined;

// ─── Fixtures ────────────────────────────────────────────────────────────────

function file(name: string, path: string): DirEntry {
  return { name, path, type: "file" };
}

/**
 * The one content collection the fixture project declares.
 *
 * It carries a real `schema`, because the seeding this file asserts on is derived from it: `draft`
 * has a default, `title` is required with none, and `summary` is optional with neither — one of
 * each of `seedEntry`'s three cases.
 */
const POSTS = {
  format: "json",
  schema: {
    properties: {
      draft: { default: false, type: "boolean" },
      summary: { type: "string" },
      title: { type: "string" },
    },
    required: ["title"],
    type: "object",
  },
  source: "./content/",
};

const TREE = {
  content: [file("2024-01-02-hello.md", "content/2024-01-02-hello.md")],
  layouts: [file("main.json", "layouts/main.json")],
  pages: [file("index.json", "pages/index.json"), file("about.json", "pages/about.json")],
  public: [file("logo.png", "public/logo.png")],
} satisfies Record<string, DirEntry[]>;

/* A detached placeholder until the first mount, so the teardown's `remove()` before it is a no-op
   rather than a guard on a value that is never absent. */
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

function setup(tree: Record<string, DirEntry[]> = TREE, dirs = Object.keys(TREE)) {
  installMockPlatform(
    {
      listDirectory: (path: string) => {
        const entries = listingIn(tree, path);
        return entries ? Promise.resolve(entries) : Promise.reject(new Error(`HTTP 500: ${path}`));
      },
    },
    { "pages/index.json": '{"tagName":"div","children":[]}' },
  );
  resetStudioState({
    projectConfig: { content: { posts: POSTS } },
    projectDirs: dirs,
    projectRoot: "",
  });
}

async function mount(): Promise<HTMLElement> {
  // A live pane holds the tab id, so a second mount in the same test would be answered by the
  // Re-entrancy guard and leave the new host empty.
  detachLibraryPane("primary");
  host.remove();
  closeAllTabs();
  const tab = openTab({
    capabilities: { modes: ["manage"] },
    document: { children: [], tagName: "div" },
    documentPath: null,
    id: "grid://library",
  });
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

/** The pane's scroller, which is also its drop zone. */
function body(): HTMLElement {
  return part("body")!;
}

/** The rows of whichever menu the Library has up, addressed by command id. */
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

/** The real `<input type="file">` the Upload label wraps. */
function uploadInput(): HTMLInputElement {
  const input = part("upload-input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("the pane drew no upload input");
  }
  return input;
}

/** The native control inside a kit element — what a reader actually drives. */
function control<T extends HTMLElement>(name: string, tag: string): T {
  return part(name)!.querySelector<T>(tag)!;
}

beforeEach(() => {
  fileNewRuns.length = 0;
  opened.length = 0;
  uploads.length = 0;
  deleteAnswer = true;
  resetNotifications();
  resetActivities();
  detachLibraryPane("primary");
  invalidateLibrary();
  setLibraryCategory("all");
  setLibraryLayout("cards");
  setLibraryLocale("");
  setLibrarySearch("");
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
   * The nine states, in one place, twice — and this is what holds the two spellings together.
   *
   * A `$switch` renders NOTHING for a key it has no case for, silently: adding a tenth kind to the
   * union and forgetting the case would empty the pane for whatever produces it, which is precisely
   * the "No files found" failure mode this design exists to end, one level up.
   */
  const KINDS: LibraryViewKind[] = [
    "loading",
    "incomplete",
    "empty",
    "nomatch",
    "cards",
    "media",
    "table",
    "calendar",
    "board",
  ];

  test("the document draws a case for every view the projection can name", () => {
    expect(slotCases("view-slot").toSorted()).toEqual([...KINDS].toSorted());
  });

  test("every layout the model declares is one of them", () => {
    for (const layout of LIBRARY_LAYOUTS) {
      expect(KINDS).toContain(layout);
    }
  });
});

// ─── Mounting ────────────────────────────────────────────────────────────────

describe("mounting", () => {
  test("draws the Library and reports itself mounted for that tab", async () => {
    await mount();
    expect(host.querySelector('[data-jx-region="pane.primary/library"]')).not.toBeNull();
    expect(host.querySelector('[data-jx-region="pane.primary/library/dropZone"]')).not.toBeNull();
    const tab = openTab({
      capabilities: { modes: ["manage"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "grid://library",
    });
    expect(libraryPaneMounted("primary", tab)).toBe(true);
  });

  test("a second mount for the same tab is a no-op — the pane owns its own reactivity", async () => {
    const tab = openTab({
      capabilities: { modes: ["manage"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "grid://library",
    });
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
    const tab = openTab({
      capabilities: { modes: ["manage"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "grid://library",
    });
    expect(libraryPaneMounted("primary", tab)).toBe(false);
  });

  test("a pane torn down before its mount settles leaves no document behind", async () => {
    // `resetCanvasView` detaches every pane unconditionally, so a tab switch during the mount is
    // Ordinary rather than exotic — and the mount is asynchronous, because the kit has to be
    // Defined before a document can render.
    const tab = openTab({
      capabilities: { modes: ["manage"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "grid://library",
    });
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
    // The settle pass is the ONE timer a synchronous state change arms once the mount and the scan
    // Have both landed: `scheduleSettle` coalesces, and the scan's own timer went with the scan.
    // Hold its callback rather than letting it run, because the pass is written for the task AFTER
    // The repaint — and by then the pane can be somebody else's.
    const held: (() => void)[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = stubSetTimeout((fn, ms) => {
      held.push(fn);
      return realSetTimeout(() => {}, ms);
    });
    try {
      setLibraryCategory("pages");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(held.length).toBe(1);
    // A tab switch: another tab's Library takes the pane, on a fresh stage.
    const stale = host;
    const successor = openTab({
      capabilities: { modes: ["manage"] },
      document: { children: [], tagName: "div" },
      documentPath: null,
      id: "grid://library-successor",
    });
    host = document.createElement("div");
    document.body.append(host);
    renderLibraryMode(surfaceOf(host), successor);
    await flush();
    await flush();
    const before = reads.length;
    // The pass the first pane scheduled now runs. Teardown emptied that pane's record and the stage
    // Is the successor's, so there is nothing for it to tend: it must neither throw, read a document
    // For a card that is gone, nor touch the successor's islands.
    const { revision } = libraryView;
    expect(() => held[0]!()).not.toThrow();
    await flush();
    expect(reads.length).toBe(before);
    expect(libraryView.revision).toBe(revision);
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
    // Repaint immediately: the settle pass runs over every slot on screen, so a slot whose first
    // Read is still in flight is offered a second time unless `pendingPaths` refuses it.
    setLibrarySearch("");
    setLibraryCategory("all");
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
    expect(parts("card").length).toBe(5);
    expect(part("doc-preview")?.firstElementChild ?? null).toBeNull();
  });

  test("scans once and lists the project's files", async () => {
    await mount();
    expect(librarySource().files().length).toBe(5);
    expect(parts("card").length).toBe(5);
  });

  test("a card's preview is an island the document renders empty and the host fills", async () => {
    await mount();
    await flush();
    // `pages/index.json` is the one file the mock platform has bytes for; the rest fail to read and
    // Keep the empty box, which is the same shape a card in an unscanned project has.
    const slot = host.querySelector<HTMLElement>(
      '[part="doc-preview"][data-path="pages/index.json"]',
    );
    expect(slot).not.toBeNull();
    expect(slot!.childElementCount).toBe(1);
  });
});

// ─── Honest states ───────────────────────────────────────────────────────────

describe("the four states the old view called “No files found”", () => {
  test("a project with no files says exactly that", async () => {
    setup({ pages: [] }, ["pages"]);
    await mount();
    expect(text()).toContain("This project has no files yet");
  });

  test("a filter that matched nothing names the filter, and offers to clear it", async () => {
    await mount();
    setLibrarySearch("zzz");
    await flush();
    const shown = text();
    expect(shown).toContain("No files match");
    expect(shown).toContain("zzz");
    expect(shown).toContain("5 file(s) in the project");
    part("reset")!.click();
    await flush();
    expect(libraryView.query).toBe("");
    expect(libraryView.category).toBe("all");
  });

  test("a category with no matches names the category too", async () => {
    setup({ pages: [file("a.json", "pages/a.json")] }, ["pages"]);
    await mount();
    setLibraryCategory("media");
    await flush();
    expect(text()).toContain("in Media");
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
    // Everything failed, so both Retries are drawn: the banner's above the body and the empty
    // State's inside it. Either re-scans.
    parts("retry")[0]!.click();
    await flush();
    await flush();
    expect(parts("card").length).toBe(5);
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
    expect(problem.action).toBe("library.refresh");
    expect(problem.path).toBe("broken");
    expect(problem.detail).toContain("HTTP 500");
    expect(problem.source).toBe("Library");
  });

  test("a scan that failed entirely does not claim the project is empty", async () => {
    setup({}, ["pages", "public"]);
    await mount();
    const shown = text();
    expect(shown).toContain("the scan did not finish");
    expect(shown).not.toContain("no files yet");
  });

  test("the failure banner's Retry re-scans", async () => {
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

  /**
   * A project that declares three locales and has files under two directories — plus
   * `pages/index.json`, which under `prefix-except-default` is the DEFAULT locale's copy and is why
   * `en` is an option the picker can offer.
   */
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

  /* The part is on the `jx-select`; the `<select>` inside it is what a reader drives. */
  function picker(): HTMLSelectElement | null {
    return part("locale")?.querySelector("select") ?? null;
  }

  test("draws a picker of the locales PRESENT, labelled in each language's own words", async () => {
    setupI18n();
    await mount();
    const options = [...picker()!.options].map((el) => [el.value, el.textContent.trim()]);
    /*
     * `en` has no directory of its own and is still an option, because under
     * `prefix-except-default` the unprefixed `pages/index.json` IS its copy — and a language filter
     * that could offer French and German but never English cannot answer the question it is most
     * often asked. Declaration order, so the default comes first.
     */
    expect(options).toEqual([
      ["all", "All languages"],
      ["en", "English"],
      ["fr", "français"],
      ["de", "Deutsch"],
    ]);
  });

  test("draws no picker at all where there is nothing to choose between", async () => {
    /*
     * One language present. `fr` and `de` are not declared, so those directories are ordinary path
     * segments and everything under `pages/` is served as the only language there is — which is
     * exactly what the build does with them, and a filter with one option is not a filter.
     */
    setupI18n(["en"]);
    await mount();
    expect(picker()).toBeNull();
    setup();
    await mount();
    expect(picker()).toBeNull();
  });

  test("its options come from every scanned file, not from the filtered ones", async () => {
    setupI18n();
    await mount();
    setLibraryLocale("fr");
    await flush();
    // A picker whose choices collapsed to the choice just made could not be used to make another.
    expect([...picker()!.options]).toHaveLength(4);
  });

  test("choosing a language filters to it, and All puts every file back", async () => {
    setupI18n();
    await mount();
    const select = picker()!;
    select.value = "fr";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    const filtered = text();
    expect(filtered).toContain("about.json");
    expect(filtered).not.toContain("main.json");
    picker()!.value = "all";
    picker()!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(libraryView.locale).toBe("");
    expect(text()).toContain("main.json");
  });

  test("the locale is in the render effect's dependency list, not merely in the setter's bump", async () => {
    setupI18n();
    await mount();
    // Written DIRECTLY, so `bump()` never touches `revision`: the repaint below can only come from
    // The effect having read `libraryView.locale`. A field missing from that hand-written list is a
    // Filter the pane applies on the paint that happens to follow it and never again.
    libraryView.locale = "de";
    await flush();
    const shown = text();
    expect(shown).not.toContain("about.json");
    expect(shown).toContain("index.json");
  });

  test("a filter that matched nothing names the LANGUAGE too, and Clear filters clears it", async () => {
    setupI18n();
    await mount();
    setLibraryCategory("layouts");
    setLibraryLocale("fr");
    await flush();
    expect(text()).toContain("in Layouts and français");
    part("reset")!.click();
    await flush();
    expect(libraryView.locale).toBe("");
    expect(libraryView.category).toBe("all");
  });
});

// ─── Layouts ─────────────────────────────────────────────────────────────────

describe("layouts", () => {
  test("switching layout repaints from the SAME scan — no second read", async () => {
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
    for (const layout of ["table", "media", "calendar", "board"] as const) {
      setLibraryLayout(layout);
      await flush();
    }
    expect(reads).toBe(after);
    expect(part("board")).not.toBeNull();
  });

  test("each layout draws its own structure", async () => {
    await mount();
    setLibraryLayout("table");
    await flush();
    expect(part("table-head")).not.toBeNull();
    setLibraryLayout("calendar");
    await flush();
    expect(part("calendar")).not.toBeNull();
    setLibraryLayout("media");
    await flush();
    expect(host.querySelector('[part="grid"][data-layout="media"]')).not.toBeNull();
  });

  test("a Media tile is an asset thumbnail, never a live document render", async () => {
    await mount();
    setLibraryLayout("media");
    await flush();
    expect(parts("tile").length).toBe(5);
    expect(part("doc-preview")).toBeNull();
  });

  test("a thumbnail that will not load draws the placeholder, not a broken image", async () => {
    await mount();
    setLibraryLayout("media");
    await flush();
    const thumb = host.querySelector<HTMLImageElement>('img[part="thumb"]')!;
    thumb.dispatchEvent(new Event("error"));
    expect(thumb.getAttribute("src")).toStartWith("data:image/svg+xml");
  });

  test("the category buttons run the same state change the command does", async () => {
    await mount();
    host.querySelector<HTMLElement>('[part="category"][data-category="pages"]')!.click();
    await flush();
    expect(libraryView.category).toBe("pages");
    expect(parts("card").length).toBe(2);
  });

  test("the layout switcher runs the same state change the command does", async () => {
    await mount();
    host.querySelector<HTMLElement>('[part="layout"][data-layout="board"]')!.click();
    await flush();
    expect(libraryView.layout).toBe("board");
    expect(part("board")).not.toBeNull();
  });

  test("New opens Add new through file.new, on the kind the active category names", async () => {
    await mount();
    part("new")!.click();
    await flush();
    setLibraryCategory("layouts");
    await flush();
    part("new")!.click();
    await flush();
    // A dialog opener, not a menu: nothing lands in the popover layer.
    expect(menuIds()).toEqual([]);
    expect(fileNewRuns).toEqual([{ kind: "page" }, { kind: "template" }]);
    expect(part("new")!.querySelector('[part="control"]')!.getAttribute("aria-haspopup")).toBe(
      "dialog",
    );
  });

  test("scrolling the body repaints — the window is recomputed, not the scan", async () => {
    await mount();
    const before = libraryView.revision;
    body().dispatchEvent(new Event("scroll"));
    expect(libraryView.revision).toBeGreaterThan(before);
  });

  test("the search field filters", async () => {
    await mount();
    const input = control<HTMLInputElement>("search", "input");
    input.value = "logo";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(parts("card").length).toBe(1);
  });
});

// ─── Uploads ─────────────────────────────────────────────────────────────────

describe("the upload destination", () => {
  test("a category that names a folder uploads there, and says so before the drop", async () => {
    setLibraryCategory("media");
    await mount();
    expect(part("upload")!.getAttribute("title")).toBe("Upload into public/");
    expect(await resolveUploadDir()).toBe("public");
  });

  test("All has no folder of its own, so it ASKS rather than guessing", async () => {
    setLibraryCategory("all");
    await mount();
    expect(part("upload")!.getAttribute("title")).toBe("Upload — asks for a folder");
    const pending = resolveUploadDir();
    await flush();
    await answerPromptDialog("assets/media/");
    expect(await pending).toBe("assets/media");
  });

  test("cancelling the destination prompt uploads nothing at all", async () => {
    setLibraryCategory("all");
    await mount();
    const pending = resolveUploadDir();
    await flush();
    await answerPromptDialog(null);
    expect(await pending).toBeNull();
    expect(uploads).toEqual([]);
  });

  test("a drop on the body uploads into the named destination and re-scans", async () => {
    setLibraryCategory("media");
    await mount();
    dragEvent(body(), "dragover");
    await flush();
    expect(body().dataset.drop).toBe("true");
    dragEvent(body(), "drop", [testFile("shot.png")]);
    await flush();
    expect(body().dataset.drop).toBe("false");
    expect(uploads).toEqual([{ count: 1, dir: "public" }]);
  });

  test("dragging away clears the drop affordance", async () => {
    await mount();
    dragEvent(body(), "dragover");
    await flush();
    expect(body().dataset.drop).toBe("true");
    dragEvent(body(), "dragleave");
    await flush();
    expect(body().dataset.drop).toBe("false");
  });

  test("a drop carrying no files does nothing", async () => {
    await mount();
    dragEvent(body(), "drop");
    await flush();
    expect(uploads).toEqual([]);
  });
});

// ─── The upload control ──────────────────────────────────────────────────────

describe("the Upload control", () => {
  test("is the picker itself, and a chosen file uploads to the named folder", async () => {
    setLibraryCategory("media");
    await mount();
    // A LABEL around a real `<input type="file">`, so the click that opens the picker is the
    // Platform's rather than a `querySelector` and a synthetic `.click()`.
    const input = uploadInput();
    expect(input.type).toBe("file");
    expect(part("upload")!.contains(input)).toBe(true);

    Object.defineProperty(input, "files", { configurable: true, value: [testFile("a.png")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(uploads).toEqual([{ count: 1, dir: "public" }]);
    // Cleared, or the same file cannot be chosen twice in a row.
    expect(input.value).toBe("");
  });

  test("a picker dismissed with no file uploads nothing", async () => {
    await mount();
    const input = uploadInput();
    Object.defineProperty(input, "files", { configurable: true, value: [] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(uploads).toEqual([]);
  });
});

// ─── Creation ────────────────────────────────────────────────────────────────

describe("creation", () => {
  test("each category asks Add new for the kind it shows", () => {
    expect(libraryNewRequest("all")).toEqual({ kind: "page" });
    expect(libraryNewRequest("pages")).toEqual({ kind: "page" });
    expect(libraryNewRequest("layouts")).toEqual({ kind: "template" });
    expect(libraryNewRequest("components")).toEqual({ kind: "component" });
    expect(libraryNewRequest("media")).toEqual({ kind: "media" });
    expect(libraryNewRequest("content")).toEqual({ collection: "posts", kind: "entry" });
  });

  test("Content with no collection an entry can go in asks for a collection instead", () => {
    // A collection whose source names a FILE has rows, not entry files, so it is no place for one.
    resetStudioState({
      projectConfig: { content: { catalogue: { source: "./content/catalog.csv" } } },
      projectDirs: ["pages"],
    });
    expect(libraryNewRequest("content")).toEqual({ kind: "collection" });
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

    // The row appears on a timer, so the clock is what is faked — not the platform.
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
      // No Cancel: `listDirectory` cannot be aborted, and a button that cannot do what it says is
      // Exactly the failure the Activity contract exists to end.
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
    // A scan that is slow AND then fails: the row is up before the failure arrives, so the failure
    // Has to land ON it rather than beside it.
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
      // The row failed, so the caller does NOT also notify: `fail()` raises the Problem itself.
      expect(problems.at(-1)!.message).toContain("Could not scan");
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  test("a scan that blows up in a way the scanner did not model is still a Problem", async () => {
    // `scanLibrary` never rejects, so the pane's outer catch only fires when the scan itself is
    // Unrunnable — a corrupt project record here, a dead platform in the field. It must not take
    // The pane down with it.
    resetStudioState({
      projectConfig: null,
      projectDirs: dirsMappedBy(() => {
        throw new TypeError("projectDirs.map is not a function");
      }),
    });
    await mount();
    const problem = problems.at(-1)!;
    expect(problem.message).toBe("Could not scan the project's files.");
    expect(problem.action).toBe("library.refresh");
    expect(problem.tier).toBe("problem");
  });
});

// ─── Context menu ────────────────────────────────────────────────────────────

describe("the per-file context menu", () => {
  async function openContextMenu(): Promise<void> {
    await mount();
    parts("card")[0]!.dispatchEvent(
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
      readFile: () => Promise.resolve("# Hello"),
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
    expect(written).toEqual(["content/2024-01-02-hello-copy.md"]);
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
    expect(problem.source).toBe("Library");
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
});
