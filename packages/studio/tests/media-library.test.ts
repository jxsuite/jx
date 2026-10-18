/**
 * The Media workspace's library — `src/media/media-library.ts` over `surfaces/media-library.json`,
 * in both modes (studio.md §22.6, §9.3).
 *
 * Driven the way a reader drives it: the filters, search and sort are the document's own controls,
 * tiles are clicked, double-clicked and walked with arrow keys, files are dropped on the surface
 * and chosen in its file inputs, and the delete confirmation is answered in the dialog layer. The
 * platform is the harness's in-memory one with a directory tree and a reference index, so what is
 * asserted is what reached the backend: the upload path, the replaced path, the deleted path.
 */
import {
  dragEvent,
  flush,
  installMockPlatform,
  key,
  resetWorkspaceWithTab,
  mountOverlayLayers,
  pointer,
  resetStudioState,
  stubRect,
  surfaceOf,
  testFile,
  topDialog,
} from "./harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import * as files from "../src/files/files";
import { initLayers, layerHost } from "../src/ui/layers";
import { closeAllTabs, workspace } from "../src/workspace/workspace";
import { toasts } from "../src/services/notify";
import { isRegionId, regionIdOf } from "../src/ui/regions";
import { invalidateMediaCache } from "../src/ui/media-picker";
import { setMediaChangedHandler } from "../src/files/media-upload";
import { invalidateUsages } from "../src/services/references";
import { openWorkspaceHome } from "../src/workspace/workspace-home";
import {
  applyMediaBrowse,
  closeMediaPickDialog,
  deleteMediaFile,
  detachMediaLibrary,
  mediaLibraryMounted,
  openMediaPickDialog,
  renderMediaLibrary,
  requestMediaReplace,
  requestMediaUpload,
  resetMediaLibrary,
  selectedEntry,
} from "../src/media/media-library";
import type { DirEntry, ReferencesResult } from "../src/types";
import type { MockPlatformState } from "./harness";

// ─── The project ─────────────────────────────────────────────────────────────

const TREE = {
  content: [{ name: "blog", path: "content/blog", type: "directory" }],
  "content/blog": [{ name: "images", path: "content/blog/images", type: "directory" }],
  "content/blog/images": [
    {
      modified: "2026-03-01T00:00:00Z",
      name: "cover.png",
      path: "content/blog/images/cover.png",
      size: 2048,
      type: "file",
    },
  ],
  public: [
    {
      modified: "2026-01-01T00:00:00Z",
      name: "hero.jpg",
      path: "public/hero.jpg",
      size: 900_000,
      type: "file",
    },
    { name: "media", path: "public/media", type: "directory" },
  ],
  "public/media": [
    {
      modified: "2026-05-01T00:00:00Z",
      name: "clip.mp4",
      path: "public/media/clip.mp4",
      size: 5_000_000,
      type: "file",
    },
    {
      modified: "2026-02-01T00:00:00Z",
      name: "song.mp3",
      path: "public/media/song.mp3",
      size: 3000,
      type: "file",
    },
    {
      modified: "2026-04-01T00:00:00Z",
      name: "menu.pdf",
      path: "public/media/menu.pdf",
      size: 1000,
      type: "file",
    },
    { name: "Inter.woff2", path: "public/media/Inter.woff2", size: 40_000, type: "file" },
  ],
} satisfies Record<string, DirEntry[]>;

/** A directory tree, as the mock platform lists it. */
function treeOf(entries: Record<string, DirEntry[]>): Map<string, DirEntry[]> {
  return new Map(Object.entries(entries));
}

/** One document that references a file, as the reference index answers it. */
function using(path: string, count: number): ReferencesResult["files"][number] {
  return { count, path, refs: [] };
}

/** Which documents reference each file. A path absent here is referenced by nothing. */
let usages = new Map<string, ReferencesResult["files"]>();
let failing = new Set<string>();
let tree = treeOf(TREE);
let state: MockPlatformState;

function install(withReferences = true): void {
  ({ state } = installMockPlatform({
    // The backend really has an upload afterwards, so the re-read listing can show it selected.
    uploadFile: async (path: string, body: string | Blob | ArrayBuffer) => {
      state.calls.push(["uploadFile", path, body]);
      const dir = path.slice(0, path.lastIndexOf("/"));
      const name = path.slice(path.lastIndexOf("/") + 1);
      const listed = tree.get(dir) ?? [];
      if (!listed.some((entry) => entry.path === path)) {
        tree.set(dir, [...listed, { name, path, type: "file" }]);
      }
      return { path };
    },
    deleteFile: async (path: string) => {
      state.calls.push(["deleted", path]);
    },
    ...(withReferences && {
      findReferences: async (query: { path?: string }) => {
        const path = query.path ?? "";
        if (failing.has(path)) {
          throw new Error("index unavailable");
        }
        const found = usages.get(path) ?? [];
        return {
          errors: [],
          files: found,
          filesReferencing: found.length,
          path,
          refsTotal: found.reduce((sum, file) => sum + file.count, 0),
          tagName: null,
        };
      },
    }),
    listDirectory: async (dir: string) => {
      const entries = tree.get(dir);
      if (!entries) {
        throw new Error(`ENOENT: ${dir}`);
      }
      return entries;
    },
  }));
}

// ─── Reaching the surface ────────────────────────────────────────────────────

let stage: HTMLElement;

function root(): HTMLElement {
  const el = stage.querySelector<HTMLElement>('[part="media-library"]');
  if (!el) {
    throw new Error("the media library is not mounted");
  }
  return el;
}

function part<T extends HTMLElement = HTMLElement>(name: string, within: ParentNode = stage): T {
  const el = within.querySelector<T>(`[part="${name}"]`);
  if (!el) {
    throw new Error(`no ${name} part`);
  }
  return el;
}

function tiles(within: ParentNode = stage): HTMLElement[] {
  return [...within.querySelectorAll<HTMLElement>('[part="tile"]')];
}

function tileFiles(within: ParentNode = stage): (string | undefined)[] {
  return tiles(within).map((tile) => tile.dataset.file);
}

function tileOf(file: string, within: ParentNode = stage): HTMLElement {
  const found = tiles(within).find((el) => el.dataset.file === file);
  if (!found) {
    throw new Error(`no tile for ${file}`);
  }
  return found;
}

function filterButton(key_: string, within: ParentNode = stage): HTMLElement {
  return part(`filter"][data-filter="${key_}`, within);
}

/** Each filter as `key count`, in column order. */
function filterRows(within: ParentNode = stage): string[] {
  return [...within.querySelectorAll<HTMLElement>('[part="filter"]')].map((el) =>
    `${el.dataset.filter} ${part("filter-count", el).textContent.trim()}`.trim(),
  );
}

/** The glyph a `jx-icon` draws: the prop the document wrote, which the element may not reflect. */
function iconName(el: Element): string | null {
  if ("name" in el && isString(el.name)) {
    return el.name;
  }
  return el.getAttribute("name");
}

/** The pick dialog's own heading, as the reader sees it. */
function headline(dialog: Element): string {
  return dialog.querySelector('[part="headline"]')?.textContent.trim() ?? "";
}

/** The pick dialog's primary button. */
function useButton(dialog: Element): HTMLButtonElement {
  const button = dialog.querySelector<HTMLButtonElement>('[part="confirm"] button');
  if (!button) {
    throw new Error("the dialog has no primary button");
  }
  return button;
}

/** The file the grid shows selected, or null. */
function selectedFile(within: ParentNode = stage): string | null {
  return (
    within.querySelector<HTMLElement>('[part="tile"][aria-selected="true"]')?.dataset.file ?? null
  );
}

/** The filter the column shows pressed. */
function pressedFilter(within: ParentNode = stage): string | undefined {
  return within.querySelector<HTMLElement>('[part="filter"][aria-pressed="true"]')?.dataset.filter;
}

function text(name: string, within: ParentNode = stage): string {
  return part(name, within).textContent.trim();
}

/** Answer a file input the way the platform does when the reader picks. */
function choose(input: HTMLInputElement, chosen: File[]): void {
  // A browser's `input.files` is LIVE: clearing the value empties the very list a handler read, so
  // The double does the same, or a handler that resets before copying would pass here and upload
  // Nothing in Chrome.
  const live = [...chosen];
  Object.defineProperty(input, "files", { configurable: true, get: () => live });
  Object.defineProperty(input, "value", {
    configurable: true,
    get: () => (live.length > 0 ? live[0]!.name : ""),
    set: (next: string) => {
      if (next === "") {
        live.length = 0;
      }
    },
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mountHome(): Promise<void> {
  const tab = openWorkspaceHome("media");
  renderMediaLibrary(surfaceOf(stage), tab);
  await settle();
}

async function settle(turns = 6): Promise<void> {
  await flush(turns);
}

/** Happy-dom's IntersectionObserver never reports; without one, every tile counts as in view. */
const realObserver = globalThis.IntersectionObserver;

/** The slice of an `IntersectionObserver` constructor the preview observer uses. */
type ObserverConstructor = new (
  callback: (entries: { isIntersecting: boolean; target: Element }[]) => void,
) => { observe: (el: Element) => void; unobserve: (el: Element) => void; disconnect: () => void };

function setObserver(value: ObserverConstructor | typeof IntersectionObserver | undefined): void {
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value });
}

beforeEach(() => {
  setObserver(undefined);
  mountOverlayLayers();
  initLayers();
  resetStudioState({ isSiteProject: true, projectConfig: { name: "Demo" } });
  closeAllTabs();
  resetMediaLibrary();
  usages = new Map([["public/hero.jpg", [using("pages/index.json", 2)]]]);
  failing = new Set();
  tree = treeOf(TREE);
  install();
  invalidateMediaCache();
  invalidateUsages();
  setMediaChangedHandler(() => invalidateMediaCache());
  stage = document.createElement("div");
  document.body.append(stage);
});

afterEach(async () => {
  setObserver(realObserver);
  resetMediaLibrary();
  setMediaChangedHandler(null);
  closeAllTabs();
  await flush();
  stage.remove();
});

// ─── The library ─────────────────────────────────────────────────────────────

describe("what the library lists", () => {
  test("every file under public/ and every collection's images/, newest first", async () => {
    await mountHome();
    expect(root().dataset.jxRegion).toBe("pane.primary/media-library");
    expect(root().dataset.mode).toBe("manage");
    expect(text("title")).toBe("All media");
    expect(tileFiles()).toEqual([
      "public/media/clip.mp4",
      "public/media/menu.pdf",
      "content/blog/images/cover.png",
      "public/media/song.mp3",
      "public/hero.jpg",
      // No modified time: after every file that has one.
      "public/media/Inter.woff2",
    ]);
    // The Upload label names the destination before anything is chosen.
    expect(part("upload").getAttribute("title")).toBe("Upload into public/media/");
  });

  test("the filters count each kind, and Unused has no number until it has been asked", async () => {
    await mountHome();
    expect(filterRows()).toEqual([
      "all 6",
      "image 2",
      "video 1",
      "audio 1",
      "document 1",
      "font 1",
      "unused",
    ]);
    expect(filterButton("all").getAttribute("aria-pressed")).toBe("true");
  });

  test("a host with no reference index draws no Unused filter at all", async () => {
    install(false);
    invalidateMediaCache();
    await mountHome();
    expect(filterRows().at(-1)).toBe("font 1");
  });

  test("a filter narrows the grid and names it", async () => {
    await mountHome();
    pointer(filterButton("image"), "click");
    await settle();
    expect(text("title")).toBe("Images");
    expect(tileFiles()).toEqual(["content/blog/images/cover.png", "public/hero.jpg"]);
    expect(filterButton("image").getAttribute("aria-pressed")).toBe("true");
  });

  test("the search narrows by name, and a search that matches nothing says so with a way back", async () => {
    await mountHome();
    const input = part<HTMLInputElement>("input", part("search"));
    input.value = "song";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(tileFiles()).toEqual(["public/media/song.mp3"]);

    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(tiles()).toHaveLength(0);
    expect(text("empty-title")).toBe("No matches for “zzz”");
    pointer(part("reset"), "click");
    await settle();
    expect(tiles()).toHaveLength(6);
  });

  test("an empty filter says what it is empty of", async () => {
    tree = treeOf({ public: [{ name: "a.png", path: "public/a.png", type: "file" }] });
    invalidateMediaCache();
    await mountHome();
    pointer(filterButton("video"), "click");
    await settle();
    expect(text("empty-title")).toBe("No video");
    expect(text("empty-detail")).toBe("1 file in the project, none of them video.");
  });

  test("the sort reorders by name and by size", async () => {
    await mountHome();
    const select = part<HTMLSelectElement>("control", part("sort"));
    select.value = "name";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(tileFiles()).toEqual([
      "public/media/clip.mp4",
      "content/blog/images/cover.png",
      "public/hero.jpg",
      "public/media/Inter.woff2",
      "public/media/menu.pdf",
      "public/media/song.mp3",
    ]);
    select.value = "size";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(tileFiles()[0]).toBe("public/media/clip.mp4");
    expect(tileFiles().at(-1)).toBe("public/media/menu.pdf");
  });

  test("an empty project says so and offers Upload", async () => {
    tree = new Map();
    invalidateMediaCache();
    await mountHome();
    expect(text("empty-title")).toBe("No media yet");
    expect(stage.querySelector('[part="empty-upload"] input[type="file"]')).not.toBeNull();
  });

  test("tiles say what they are: a picture, a caption from the listing, a glyph otherwise", async () => {
    await mountHome();
    const hero = tileOf("public/hero.jpg");
    expect(part("thumb-img", hero).getAttribute("src")).toBe("/hero.jpg");
    expect(text("tile-caption", hero)).toBe("879 KB");
    const clip = tileOf("public/media/clip.mp4");
    expect(clip.querySelector('[part="thumb-img"]')).toBeNull();
    expect(iconName(part("thumb-glyph", clip))).toBe("play");
    // Nothing measured about a font: its kind, not an empty line.
    expect(text("tile-caption", tileOf("public/media/Inter.woff2"))).toBe("39 KB");
  });

  test("a thumbnail is asked for only once its tile is in view", async () => {
    const watched: Element[] = [];
    let report: (entries: { isIntersecting: boolean; target: Element }[]) => void = () => {};
    setObserver(
      class StubObserver {
        readonly watched = watched;
        constructor(callback: typeof report) {
          report = callback;
        }
        observe(el: Element): void {
          this.watched.push(el);
        }
        unobserve(el: Element): void {
          this.watched.splice(this.watched.indexOf(el), 1);
        }
        disconnect(): void {
          this.watched.length = 0;
        }
      },
    );
    await mountHome();
    const hero = tileOf("public/hero.jpg");
    expect(hero.querySelector('[part="thumb-img"]')).toBeNull();
    expect(hero.querySelector('[part="thumb-pending"]')).not.toBeNull();
    expect(watched).toContain(hero);
    report([{ isIntersecting: true, target: hero }]);
    await settle();
    expect(part("thumb-img", tileOf("public/hero.jpg")).getAttribute("src")).toBe("/hero.jpg");
  });

  test("tiles a filter drops are given back to the observer, not watched for the mount's life", async () => {
    const watched = new Set<Element>();
    setObserver(
      class StubObserver {
        readonly watched = watched;
        observe(el: Element): void {
          this.watched.add(el);
        }
        unobserve(el: Element): void {
          this.watched.delete(el);
        }
        disconnect(): void {
          this.watched.clear();
        }
      },
    );
    await mountHome();
    expect(watched.size).toBe(6);
    pointer(filterButton("video"), "click");
    await settle();
    // Only the tile still drawn is watched; the five the filter dropped were released.
    expect([...watched]).toEqual([tileOf("public/media/clip.mp4")]);
  });

  test("a loaded thumbnail's size becomes its caption", async () => {
    await mountHome();
    const img = part<HTMLImageElement>("thumb-img", tileOf("public/hero.jpg"));
    Object.defineProperty(img, "naturalWidth", { value: 1600 });
    Object.defineProperty(img, "naturalHeight", { value: 900 });
    img.dispatchEvent(new Event("load"));
    await settle();
    expect(text("tile-caption", tileOf("public/hero.jpg"))).toBe("1600 × 900 · 879 KB");
  });

  test("a listing change repaints the library with what is there now", async () => {
    await mountHome();
    tree = treeOf({
      ...TREE,
      public: [...TREE.public, { name: "new.png", path: "public/new.png", type: "file" }],
    });
    invalidateMediaCache();
    await settle();
    expect(tileFiles()).toContain("public/new.png");
  });
});

// ─── Selection and the detail pane ──────────────────────────────────────────

describe("the detail pane", () => {
  test("says what to do before anything is selected", async () => {
    await mountHome();
    expect(text("detail-hint")).toBe("Select a file to see its details.");
    // The first tile is the grid's one tab stop until something is selected.
    expect(tiles()[0]?.getAttribute("tabindex")).toBe("0");
    expect(tiles()[1]?.getAttribute("tabindex")).toBe("-1");
  });

  test("a selected file shows its preview, facts, site URL and the documents that use it", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    expect(tileOf("public/hero.jpg").getAttribute("aria-selected")).toBe("true");
    expect(tileOf("public/hero.jpg").getAttribute("tabindex")).toBe("0");
    expect(text("detail-name")).toBe("hero.jpg");
    expect(text("facts")).toBe("image · 879 KB · modified 2026-01-01");
    expect(text("url-value")).toBe("/hero.jpg");
    expect(part("preview-img").getAttribute("src")).toBe("/hero.jpg");
    expect(text("usage-headline")).toBe("Used on 1 page");
    expect(text("usage-link")).toBe("pages/index.json");
    expect(text("usage-count")).toBe("2");
  });

  test("a usage link opens the document that uses the file", async () => {
    const opened = spyOn(files, "openFileInTab").mockImplementation(async () => {});
    try {
      await mountHome();
      pointer(tileOf("public/hero.jpg"), "click");
      await settle();
      pointer(part("usage-link"), "click");
      await settle();
      expect(opened).toHaveBeenCalledWith("pages/index.json");
    } finally {
      opened.mockRestore();
    }
  });

  test("a video previews in a player, a font as the viewer's specimen", async () => {
    await mountHome();
    pointer(tileOf("public/media/clip.mp4"), "click");
    await settle();
    expect(part("preview-video").getAttribute("src")).toBe("/media/clip.mp4");
    pointer(tileOf("public/media/song.mp3"), "click");
    await settle();
    expect(part("preview-audio").getAttribute("src")).toBe("/media/song.mp3");
    pointer(tileOf("public/media/Inter.woff2"), "click");
    await settle();
    // Set in its own face, scoped to a family generated from the path, as the viewer sets it.
    const specimen = part("preview-specimen");
    expect(specimen.getAttribute("style")).toBe(
      '--jx-specimen-family: "jx-specimen-public-media-Inter-woff2"',
    );
    expect(specimen.querySelector("style")?.textContent).toContain('url("/media/Inter.woff2")');
    // A PDF's embed wants the viewer's whole pane: here it is its glyph.
    pointer(tileOf("public/media/menu.pdf"), "click");
    await settle();
    expect(iconName(part("preview-glyph"))).toBe("file-text");
  });

  test("a collection's image is described at its published URL", async () => {
    resetStudioState({
      isSiteProject: true,
      projectConfig: { content: { blog: { source: "./content/blog" } }, name: "Demo" },
    });
    await mountHome();
    pointer(tileOf("content/blog/images/cover.png"), "click");
    await settle();
    expect(text("url-value")).toBe("/content/blog/images/cover.png");
  });

  test("Copy writes the site URL to the clipboard", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (copied: string) => {
          written.push(copied);
        },
      },
    });
    await mountHome();
    pointer(tileOf("public/media/menu.pdf"), "click");
    await settle();
    pointer(part("copy"), "click");
    expect(written).toEqual(["/media/menu.pdf"]);
  });

  test("the preview's own load measures the picture", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    const img = part<HTMLImageElement>("preview-img");
    Object.defineProperty(img, "naturalWidth", { value: 1200 });
    Object.defineProperty(img, "naturalHeight", { value: 800 });
    img.dispatchEvent(new Event("load"));
    await settle();
    expect(text("facts")).toBe("image · 1200 × 800 · 879 KB · modified 2026-01-01");
  });

  test("a host with no reference index draws no usage at all, rather than a zero", async () => {
    install(false);
    invalidateMediaCache();
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    expect(stage.querySelector('[part="usage"]')).toBeNull();
  });
});

describe("the keyboard", () => {
  test("arrows move the selection and the focus, a row at a time by the grid's own columns", async () => {
    await mountHome();
    stubRect(part("grid"), { height: 400, width: 300 });
    const grid = part("grid");
    // Nothing selected: the first move lands on the first tile.
    key(grid, "ArrowRight");
    await settle();
    expect(selectedFile()).toBe("public/media/clip.mp4");
    key(grid, "ArrowRight");
    await settle();
    expect(selectedFile()).toBe("public/media/menu.pdf");
    expect(document.activeElement).toBe(tileOf("public/media/menu.pdf"));
    // 300px holds two 132px columns and a 12px gap: Down is two tiles on.
    key(grid, "ArrowDown");
    await settle();
    expect(selectedFile()).toBe("public/media/song.mp3");
    key(grid, "End", { ctrlKey: true });
    await settle();
    expect(selectedFile()).toBe("public/media/Inter.woff2");
    // A key the grid does not handle moves nothing.
    key(grid, "x");
    await settle();
    expect(selectedFile()).toBe("public/media/Inter.woff2");
  });

  test("a Tab onto the grid selects the tile it lands on, so the first Enter acts on it", async () => {
    await mountHome();
    const first = tiles()[0]!;
    expect(first.getAttribute("tabindex")).toBe("0");
    first.focus();
    await settle();
    expect(selectedFile()).toBe("public/media/clip.mp4");
    key(part("grid"), "Enter");
    await settle();
    expect(workspace.tabs.get("public/media/clip.mp4")?.session.ui.canvasMode).toBe("media");
  });

  test("Enter opens the selected file's viewer, as a double-click does", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    key(part("grid"), "Enter");
    await settle();
    expect(workspace.tabs.get("public/hero.jpg")?.session.ui.canvasMode).toBe("media");

    tileOf("public/media/clip.mp4").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await settle();
    expect(workspace.tabs.has("public/media/clip.mp4")).toBe(true);
  });

  test("Open in viewer opens the selected file's viewer tab", async () => {
    await mountHome();
    pointer(tileOf("public/media/menu.pdf"), "click");
    await settle();
    pointer(part("open-viewer"), "click");
    expect(workspace.tabs.has("public/media/menu.pdf")).toBe(true);
  });
});

// ─── Upload, Replace, Delete ─────────────────────────────────────────────────

describe("uploads", () => {
  test("the Upload input sends the files to public/media/ and selects the first", async () => {
    await mountHome();
    const input = part<HTMLInputElement>("upload-input", part("upload"));
    choose(input, [testFile("logo.png")]);
    await settle();
    expect(state.calls).toContainEqual(["uploadFile", "public/media/logo.png", expect.anything()]);
    expect(input.value).toBe("");
    expect(selectedFile()).toBe("public/media/logo.png");
  });

  test("a file dropped anywhere on the library uploads, and the affordance is a state", async () => {
    await mountHome();
    dragEvent(root(), "dragover", [testFile("drop.png")]);
    await settle();
    expect(root().dataset.drop).toBe("true");
    dragEvent(root(), "dragleave");
    await settle();
    expect(root().dataset.drop).toBe("false");
    dragEvent(root(), "dragover", [testFile("drop.png")]);
    dragEvent(root(), "drop", [testFile("drop.png")]);
    await settle();
    expect(root().dataset.drop).toBe("false");
    expect(state.calls).toContainEqual(["uploadFile", "public/media/drop.png", expect.anything()]);
  });

  test("an upload into a filter it does not belong to shows it anyway", async () => {
    await mountHome();
    pointer(filterButton("video"), "click");
    await settle();
    choose(part<HTMLInputElement>("upload-input", part("upload")), [testFile("logo.png")]);
    await settle();
    expect(pressedFilter()).toBe("all");
  });

  test("a file kind the library lists is shown once it lands; one it never lists is not uploaded", async () => {
    await mountHome();
    dragEvent(root(), "drop", [testFile("clip.mov"), testFile("notes.txt")]);
    await settle(10);
    const uploads = state.calls.filter(([name]) => name === "uploadFile").map(([, path]) => path);
    expect(uploads).toEqual(["public/media/clip.mov"]);
    expect(tileFiles()).toContain("public/media/clip.mov");
    expect(selectedFile()).toBe("public/media/clip.mov");
    expect(toasts.map((toast) => toast.message)).toContain("Skipped notes.txt");
  });

  test("an empty project's first upload leaves media.upload opening the toolbar's picker", async () => {
    // An empty public/media/, so the first upload is in the listing the re-read walks.
    tree = treeOf({
      public: [{ name: "media", path: "public/media", type: "directory" }],
      "public/media": [],
    });
    invalidateMediaCache();
    await mountHome();
    const emptyInput = part<HTMLInputElement>("upload-input", part("empty-upload"));
    choose(emptyInput, [testFile("first.png")]);
    await settle(10);
    expect(tiles()).toHaveLength(1);
    expect(emptyInput.isConnected).toBe(false);
    const shown: HTMLInputElement[] = [];
    const picker = spyOn(HTMLInputElement.prototype, "showPicker").mockImplementation(
      function recordShown(this: HTMLInputElement) {
        shown.push(this);
      },
    );
    try {
      requestMediaUpload();
      expect(shown).toEqual([part<HTMLInputElement>("upload-input", part("upload"))]);
    } finally {
      picker.mockRestore();
    }
  });

  test("a drop or a picker with nothing in it uploads nothing", async () => {
    await mountHome();
    dragEvent(root(), "drop");
    choose(part<HTMLInputElement>("upload-input", part("upload")), []);
    await settle();
    expect(state.calls.filter(([name]) => name === "uploadFile")).toEqual([]);
  });
});

describe("Replace", () => {
  test("writes the chosen file over the selected file's own path", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    const input = part<HTMLInputElement>("replace-input");
    // The chooser offers the replaced file's own format, and only that.
    expect(input.getAttribute("accept")).toBe(".jpg,.jpeg");
    choose(input, [testFile("brand-new.jpeg")]);
    await settle();
    expect(state.calls).toContainEqual(["uploadFile", "public/hero.jpg", expect.anything()]);
    expect(input.value).toBe("");
    // Still selected: the path did not change, so neither did what the reader is looking at.
    expect(selectedFile()).toBe("public/hero.jpg");
  });

  test("a file of another format is refused, and nothing is written", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    choose(part<HTMLInputElement>("replace-input"), [testFile("logo.png")]);
    await settle();
    expect(state.calls.filter(([name]) => name === "uploadFile")).toEqual([]);
  });

  test("leaves every other tile's facts standing, whenever the re-read lands", async () => {
    // A handler that re-walks over several turns, as the shell's does (it awaits the file tree).
    setMediaChangedHandler(async () => {
      invalidateMediaCache();
      await flush(3);
    });
    await mountHome();
    expect(text("tile-caption", tileOf("public/media/clip.mp4"))).toBe("4.8 MB");
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    choose(part<HTMLInputElement>("replace-input"), [testFile("hero.jpg")]);
    await settle(12);
    expect(text("tile-caption", tileOf("public/media/clip.mp4"))).toBe("4.8 MB");
    // And the Newest sort still has every file's date to sort by.
    expect(tileFiles()[0]).toBe("public/media/clip.mp4");
  });

  test("a picker dismissed without a file replaces nothing", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    choose(part<HTMLInputElement>("replace-input"), []);
    await settle();
    expect(state.calls.filter(([name]) => name === "uploadFile")).toEqual([]);
  });
});

describe("Delete", () => {
  test("asks first, stating the usage, and deletes only on Delete", async () => {
    await mountHome();
    pointer(tileOf("public/hero.jpg"), "click");
    await settle();
    pointer(part("delete"), "click");
    await settle(12);
    const dialog = topDialog();
    expect(dialog).not.toBeNull();
    dialog!.dispatchEvent(new Event("cancel"));
    await settle();
    expect(state.calls.some(([name]) => name === "deleted")).toBe(false);

    pointer(part("delete"), "click");
    await settle(12);
    topDialog()!.dispatchEvent(new Event("confirm"));
    await settle();
    expect(state.calls).toContainEqual(["deleted", "public/hero.jpg"]);
    expect(selectedFile()).toBeNull();
  });

  test("a delete closes the file's viewer tab, which holds nothing to lose", async () => {
    await mountHome();
    pointer(tileOf("public/media/menu.pdf"), "click");
    await settle();
    pointer(part("open-viewer"), "click");
    expect(workspace.tabs.has("public/media/menu.pdf")).toBe(true);
    const pending = deleteMediaFile("public/media/menu.pdf");
    await settle();
    topDialog()!.dispatchEvent(new Event("confirm"));
    expect(await pending).toBe(true);
    expect(workspace.tabs.has("public/media/menu.pdf")).toBe(false);
  });

  test("a backend that refuses the delete is reported and nothing moves", async () => {
    installMockPlatform({
      deleteFile: () => Promise.reject(new Error("read-only")),
      listDirectory: async (dir: string) => tree.get(dir) ?? [],
    });
    const pending = deleteMediaFile("public/hero.jpg");
    await settle();
    topDialog()!.dispatchEvent(new Event("confirm"));
    expect(await pending).toBe(false);
  });
});

// ─── Unused ──────────────────────────────────────────────────────────────────

describe("Unused", () => {
  test("is counted when it is asked for, and lists only files nothing references", async () => {
    usages = new Map([
      ["content/blog/images/cover.png", [using("content/blog/post.md", 1)]],
      ["public/hero.jpg", [using("pages/index.json", 1)]],
    ]);
    // A failed question is unknown, never unused.
    failing = new Set(["public/media/song.mp3"]);
    await mountHome();
    pointer(filterButton("unused"), "click");
    await settle(12);
    expect(filterRows().at(-1)).toBe("unused 3");
    expect(tileFiles()).toEqual([
      "public/media/clip.mp4",
      "public/media/menu.pdf",
      "public/media/Inter.woff2",
    ]);
  });

  test("is asked again when a document starts or stops using a file", async () => {
    usages = new Map([["public/hero.jpg", [using("pages/index.json", 1)]]]);
    await mountHome();
    pointer(filterButton("unused"), "click");
    await settle(12);
    expect(tileFiles()).toContain("public/media/clip.mp4");
    expect(filterRows().at(-1)).toBe("unused 5");
    // A page saved with the video in it: the fs-event path drops the usage answers.
    usages.set("public/media/clip.mp4", [using("pages/about.json", 1)]);
    usages.delete("public/hero.jpg");
    invalidateUsages();
    await settle(14);
    const after = tileFiles();
    expect(after).not.toContain("public/media/clip.mp4");
    expect(after).toContain("public/hero.jpg");
    expect(filterRows().at(-1)).toBe("unused 5");
  });

  test("an image picker's sweep does not stand in for the home's", async () => {
    usages = new Map();
    openMediaPickDialog({ images: true, onPick: () => {} });
    await settle(8);
    const dialogEl = layerHost("dialog").querySelector<HTMLElement>(
      'jx-dialog[part="media-pick"]',
    )!;
    pointer(filterButton("unused", dialogEl), "click");
    await settle(14);
    expect(filterRows(dialogEl).at(-1)).toBe("unused 2");
    /* The home mounted beside it reads the same answer, and it covers every kind, not only the two
       images the picker could see. */
    await mountHome();
    expect(filterRows().at(-1)).toBe("unused 6");
  });

  test("everything in use says so", async () => {
    tree = treeOf({ public: [{ name: "a.png", path: "public/a.png", type: "file" }] });
    usages = new Map([["public/a.png", [using("pages/index.json", 1)]]]);
    invalidateMediaCache();
    await mountHome();
    pointer(filterButton("unused"), "click");
    await settle(10);
    expect(text("empty-title")).toBe("No unused media");
  });

  /**
   * Hold the sweep's FIRST question until `release()`, and pass every later one straight through,
   * so a test ends with nothing left in flight for the next one to inherit (the usage cache keeps
   * an in-flight question across invalidations by design).
   */
  async function holdFirstQuestion(): Promise<{ asked: string[]; release: () => void }> {
    install();
    const { getPlatform } = await import("../src/platform");
    const original = getPlatform().findReferences!;
    const asked: string[] = [];
    let release: () => void = () => {};
    globalThis.__jxPlatform = {
      ...globalThis.__jxPlatform!,
      findReferences: (query) => {
        asked.push(query.path ?? "");
        if (asked.length > 1) {
          return original(query);
        }
        return new Promise((resolve) => {
          release = () => resolve(original(query));
        });
      },
    };
    invalidateMediaCache();
    return {
      asked,
      release: () => {
        release();
      },
    };
  }

  test("draws a counting line while the sweep runs", async () => {
    const { release } = await holdFirstQuestion();
    await mountHome();
    pointer(filterButton("unused"), "click");
    await settle();
    expect(text("empty")).toMatch(/^Counting references… 0 of 6$/);
    release();
    await settle(14);
  });

  test("stops asking when the reader leaves the filter, and starts again when it returns", async () => {
    const { asked, release } = await holdFirstQuestion();
    await mountHome();
    pointer(filterButton("unused"), "click");
    await settle();
    expect(asked).toHaveLength(1);
    pointer(filterButton("all"), "click");
    release();
    await settle(8);
    // The answer in flight landed, and no second question followed it.
    expect(asked).toHaveLength(1);
    expect(filterRows().at(-1)).toBe("unused");
    pointer(filterButton("unused"), "click");
    await settle(20);
    // The first answer is the cache's; the other five are asked now.
    expect(asked).toHaveLength(6);
    expect(filterRows().at(-1)).toBe("unused 5");
  });
});

// ─── Commands' entry points ──────────────────────────────────────────────────

describe("what the commands ask of the library", () => {
  test("applyMediaBrowse sets the filter and search, and a selection shows the file whatever was filtered", async () => {
    await mountHome();
    applyMediaBrowse({ filter: "font", query: "Int" });
    await settle();
    expect(tileFiles()).toEqual(["public/media/Inter.woff2"]);
    applyMediaBrowse({ select: "public/hero.jpg" });
    await settle();
    expect(pressedFilter()).toBe("all");
    expect(part<HTMLInputElement>("input", part("search")).value).toBe("");
    expect(selectedFile()).toBe("public/hero.jpg");
    expect(text("detail-name")).toBe("hero.jpg");
  });

  test("requestMediaUpload opens the mounted Upload picker, or the one the next mount draws", async () => {
    const shown: HTMLInputElement[] = [];
    const picker = spyOn(HTMLInputElement.prototype, "showPicker").mockImplementation(
      function recordShown(this: HTMLInputElement) {
        shown.push(this);
      },
    );
    try {
      requestMediaUpload();
      await mountHome();
      expect(shown).toHaveLength(1);
      expect(shown[0]?.getAttribute("part")).toBe("upload-input");
      requestMediaUpload();
      expect(shown).toHaveLength(2);
    } finally {
      picker.mockRestore();
    }
  });

  test("a picker the platform refuses to open leaves its control focused", async () => {
    const picker = spyOn(HTMLInputElement.prototype, "showPicker").mockImplementation(() => {
      throw new DOMException("no activation", "NotAllowedError");
    });
    try {
      await mountHome();
      requestMediaUpload();
      expect(document.activeElement?.getAttribute("part")).toBe("upload-input");
    } finally {
      picker.mockRestore();
    }
  });

  test("requestMediaReplace selects the file and opens its Replace picker", async () => {
    const shown: (string | null)[] = [];
    const picker = spyOn(HTMLInputElement.prototype, "showPicker").mockImplementation(
      function recordPart(this: HTMLInputElement) {
        shown.push(this.getAttribute("part"));
      },
    );
    try {
      await mountHome();
      requestMediaReplace("public/hero.jpg");
      await settle();
      expect(selectedFile()).toBe("public/hero.jpg");
      expect(shown).toEqual(["replace-input"]);
      // Asked again while the input already stands: opened at once.
      requestMediaReplace("public/hero.jpg");
      expect(shown).toEqual(["replace-input", "replace-input"]);
    } finally {
      picker.mockRestore();
    }
  });
});

describe("the pane's lifecycle", () => {
  test("a library already standing is not rebuilt; detaching takes it down", async () => {
    const tab = openWorkspaceHome("media");
    const surface = surfaceOf(stage);
    renderMediaLibrary(surface, tab);
    await settle();
    const first = root();
    expect(mediaLibraryMounted("primary", tab)).toBe(true);
    renderMediaLibrary(surface, tab);
    await settle();
    expect(root()).toBe(first);
    detachMediaLibrary("primary");
    detachMediaLibrary("primary");
    expect(mediaLibraryMounted("primary", tab)).toBe(false);
  });

  test("a library disposed before its mount lands leaves nothing in the stage", async () => {
    const tab = openWorkspaceHome("media");
    renderMediaLibrary(surfaceOf(stage), tab);
    detachMediaLibrary("primary");
    await settle();
    expect(stage.querySelector('[part="media-library"]')).toBeNull();
  });
});

// ─── Pick mode ───────────────────────────────────────────────────────────────

describe("pick mode", () => {
  function dialog(): HTMLElement {
    const el = layerHost("dialog").querySelector<HTMLElement>('jx-dialog[part="media-pick"]');
    if (!el) {
      throw new Error("the pick dialog is not open");
    }
    return el;
  }

  test("the same library in a dialog, images only, answering Cancel or Use <file>", async () => {
    const picked: string[] = [];
    openMediaPickDialog({ images: true, onPick: (ref) => picked.push(ref) });
    await settle(8);
    const body = dialog();
    expect(headline(body)).toBe("Choose an image");
    expect(useButton(body).disabled).toBe(true);
    expect(part("media-library", body).dataset.mode).toBe("pick");
    expect(filterRows(body)).toEqual(["image 2", "unused"]);
    expect(text("filter-label", body)).toBe("All images");
    expect(tileFiles(body)).toEqual(["content/blog/images/cover.png", "public/hero.jpg"]);
    // No Replace or Delete here: the dialog's footer is the answer.
    expect(body.querySelector('[part="delete"]')).toBeNull();
    expect(part("upload-input", body).getAttribute("accept")).toBe("image/*");
    expect(text("detail-hint", body)).toBe("Choose a file to use it.");

    pointer(tileOf("public/hero.jpg", body), "click");
    await settle();
    expect(useButton(body).textContent.trim()).toBe("Use hero.jpg");
    expect(useButton(body).disabled).toBe(false);
    body.dispatchEvent(new Event("confirm"));
    await settle();
    expect(picked).toEqual(["/hero.jpg"]);
    expect(layerHost("dialog").querySelector('jx-dialog[part="media-pick"]')).toBeNull();
  });

  test("a double-click uses the file at once", async () => {
    const picked: string[] = [];
    openMediaPickDialog({ images: false, onPick: (ref) => picked.push(ref) });
    await settle(8);
    expect(headline(dialog())).toBe("Choose media");
    tileOf("public/media/menu.pdf", dialog()).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
    await settle();
    expect(picked).toEqual(["/media/menu.pdf"]);
  });

  test("Enter on the grid uses the selected file", async () => {
    const picked: string[] = [];
    openMediaPickDialog({ images: false, onPick: (ref) => picked.push(ref) });
    await settle(8);
    pointer(tileOf("public/media/song.mp3", dialog()), "click");
    await settle();
    key(part("grid", dialog()), "Enter");
    await settle();
    expect(picked).toEqual(["/media/song.mp3"]);
  });

  test("Cancel closes it and commits nothing; a confirm with nothing chosen does nothing", async () => {
    const picked: string[] = [];
    openMediaPickDialog({ images: false, onPick: (ref) => picked.push(ref) });
    await settle(8);
    dialog().dispatchEvent(new Event("confirm"));
    await settle();
    expect(picked).toEqual([]);
    dialog().dispatchEvent(new Event("cancel"));
    await settle();
    expect(layerHost("dialog").querySelector('jx-dialog[part="media-pick"]')).toBeNull();
    expect(picked).toEqual([]);
  });

  test("its library carries a region under the dialog's own, never a bare id", async () => {
    openMediaPickDialog({ images: false, onPick: () => {} });
    await settle(8);
    const library = part("media-library", dialog());
    expect(library.dataset.jxRegion).toBe("overlay.dialog:media-picker/library");
    expect(isRegionId(library.dataset.jxRegion ?? "")).toBe(true);
    const [firstTile] = tiles(dialog());
    expect(regionIdOf(firstTile ?? null)).toBe("overlay.dialog:media-picker/library");
  });

  test("opened from a collection entry's field, it uploads where that entry's media lives", async () => {
    resetWorkspaceWithTab(undefined, { documentPath: "content/blog/post.md", id: "entry" });
    openMediaPickDialog({ images: true, onPick: () => {} });
    await settle(8);
    expect(part("upload", dialog()).getAttribute("title")).toBe("Upload into content/blog/images/");
    choose(part<HTMLInputElement>("upload-input", dialog()), [testFile("inline.png")]);
    await settle();
    expect(state.calls).toContainEqual([
      "uploadFile",
      "content/blog/images/inline.png",
      expect.anything(),
    ]);
  });

  test("a non-image dropped on an image picker is skipped, and said so", async () => {
    openMediaPickDialog({ images: true, onPick: () => {} });
    await settle(8);
    dragEvent(part("media-library", dialog()), "drop", [testFile("menu-2.pdf")]);
    await settle();
    expect(state.calls.filter(([name]) => name === "uploadFile")).toEqual([]);
    expect(toasts.map((toast) => toast.message)).toContain("Skipped menu-2.pdf");
  });

  test("an upload in the picker selects what arrived, so Use can use it", async () => {
    openMediaPickDialog({ images: true, onPick: () => {} });
    await settle(8);
    choose(part<HTMLInputElement>("upload-input", dialog()), [testFile("new.png")]);
    await settle();
    expect(state.calls).toContainEqual(["uploadFile", "public/media/new.png", expect.anything()]);
    expect(useButton(dialog()).textContent.trim()).toBe("Use image");
  });

  test("opening a second picker replaces the first, and closing twice is harmless", async () => {
    openMediaPickDialog({ images: false, onPick: () => {} });
    openMediaPickDialog({ images: true, onPick: () => {} });
    await settle(8);
    expect(layerHost("dialog").querySelectorAll('jx-dialog[part="media-pick"]')).toHaveLength(1);
    closeMediaPickDialog();
    closeMediaPickDialog();
    await settle();
    expect(layerHost("dialog").querySelector('jx-dialog[part="media-pick"]')).toBeNull();
  });

  test("selectedEntry refuses a file an image picker does not offer", () => {
    expect(
      selectedEntry({
        choice: { filter: "all", query: "", selected: "public/media/clip.mp4", sort: "newest" },
        images: true,
      }),
    ).toBeNull();
  });
});
