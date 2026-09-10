/**
 * The media picker's two surfaces, and the flow that decides what they say.
 *
 * Both are documents now, so the assertions address `part` names rather than class names — a
 * document emits no class, and `[part="browse"]` is the handle `ui/regions.ts` derives
 * `inspector/field:<prop>/browse` from. Three contracts changed hands with the conversion and are
 * re-authored here rather than deleted:
 *
 * - **Dismissal is the platform's.** The panel is a `jx-popover`, so Escape, light dismissal and the
 *   top layer are the popover's own contract; the lit version bound two document listeners and
 *   armed one of them a frame late. What is asserted is that the panel declares `popover="auto"`
 *   and that a platform close tears the slot down and tells the flow.
 * - **The viewport clamp is the kit's.** The lit version measured its own box twice and wrote
 *   `left`/`top` back. The panel is placed by the anchor's box now and `jx-popover` clamps it, so
 *   what is asserted is the placement handed over, and that nothing writes inline geometry.
 * - **A repaint is an update, not a re-render.** `renderMediaPicker` returned a template every caller
 *   re-rendered; `mountMediaPicker` mounts once and moves the scope, so the same host called twice
 *   holds ONE field.
 */
import {
  flush,
  installMockPlatform,
  mountOverlayLayers,
  resetWorkspaceWithTab,
  pointer,
  resetStudioState,
  setValue,
  stubRect,
  testFile,
} from "./harness";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as storeActual from "../src/store";
import type { DirEntry } from "../src/types";

// Make debounced style commits synchronous so input handlers fire without real 400ms timers.
void mock.module("../src/store", () => ({
  ...storeActual,
  debouncedStyleCommit:
    <A extends unknown[]>(_prop: string, _ms: number, fn: (...args: A) => void) =>
    (...args: A) =>
      fn(...args),
}));

const { invalidateMediaCache, mountMediaPicker, unmountMediaPicker, uploadAndAssign } =
  await import("../src/ui/media-picker");
const { openMediaBrowserSurface } = await import("../src/surfaces/media-browser");
const { initLayers, layerHost } = await import("../src/ui/layers");

// ─── Deterministic requestAnimationFrame ─────────────────────────────────────

const realRaf = globalThis.requestAnimationFrame;
let rafQueue: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  rafQueue.push(cb);
  return rafQueue.length;
}) as typeof requestAnimationFrame;

function runRaf() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) {
    cb(0);
  }
}

afterAll(() => {
  globalThis.requestAnimationFrame = realRaf;
});

// ─── Platform with a directory tree (media-picker reads entry.type) ─────────

interface Entry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

const defaultTree: Record<string, Entry[]> = {
  public: [
    { name: "logo.png", path: "public/logo.png", type: "file" },
    { name: "clip.mp4", path: "public/clip.mp4", type: "file" },
    { name: "notes.txt", path: "public/notes.txt", type: "file" },
    { name: "README", path: "public/README", type: "file" },
    { name: ".hidden", path: "public/.hidden", type: "file" },
    { name: "img", path: "public/img", type: "directory" },
    { name: "missing", path: "public/missing", type: "directory" },
  ],
  "public/img": [{ name: "photo.JPG", path: "public/img/photo.JPG", type: "file" }],
};

function installTree(tree: Record<string, Entry[]>, canvasUrl?: string) {
  installMockPlatform({
    ...(canvasUrl != null && { canvasUrl }),
    listDirectory: async (dir: string) => {
      const entries = tree[dir];
      if (!entries) {
        throw new Error(`ENOENT: ${dir}`);
      }
      return entries as unknown as DirEntry[];
    },
  });
}

// ─── Reaching the two surfaces ───────────────────────────────────────────────

/** The open browser panel, which owns its own slot inside the popover layer. */
function panel(): HTMLElement | null {
  return layerHost("popover").querySelector<HTMLElement>('jx-popover[part="media-browser"]');
}

function rows(): HTMLElement[] {
  return [...(panel()?.querySelectorAll<HTMLElement>('[part="row"]') ?? [])];
}

function rowPaths(): (string | undefined)[] {
  return rows().map((row) => row.dataset.path);
}

/** Each row's caption, or `undefined` where the file's size is unknown. */
function captions(): (string | undefined)[] {
  return rows().map((row) => row.querySelector('[part="row-caption"]')?.textContent?.trim());
}

function emptyLine(): string | null {
  return panel()?.querySelector('[part="empty"]')?.textContent?.trim() ?? null;
}

function moreLine(): string | null {
  return panel()?.querySelector('[part="more"]')?.textContent?.trim() ?? null;
}

function filterInput(): HTMLInputElement {
  return panel()!.querySelector<HTMLInputElement>('[part="filter"] [part="input"]')!;
}

/** Close the panel the way the platform does — the one event `openPopoverSurface` listens for. */
function closeFromPlatform() {
  const open = panel();
  if (open) {
    (open as HTMLElement & { hidePopover: () => void }).hidePopover();
  }
}

/** The Browse control — the handle `ui/regions.ts` derives its region from. */
function browseButton(host: HTMLElement): HTMLElement {
  return host.querySelector('[part="browse"]') as HTMLElement;
}

/** The Upload control, which opens the OS file picker. */
function uploadButton(host: HTMLElement): HTMLElement {
  return host.querySelector('[part="upload"]') as HTMLElement;
}

function fieldInput(host: HTMLElement): HTMLInputElement {
  return host.querySelector<HTMLInputElement>('[part="value"] [part="input"]')!;
}

function thumb(host: HTMLElement): HTMLElement | null {
  return host.querySelector('[part="thumb"]');
}

/** The hosts a test mounted, torn down between tests so no document outlives its file. */
let hosts: HTMLElement[] = [];

/**
 * Mount a field and let the listing land. The first mount kicks off the async cache load; a second
 * call updates the same document, which is what a repaint does.
 */
async function mountField(value: string, onCommit: (v: string) => void = () => {}) {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  mountMediaPicker(host, "src", value, onCommit);
  await flush();
  mountMediaPicker(host, "src", value, onCommit);
  await flush();
  return host;
}

/** Mount a field, press Browse, and let the panel mount. */
async function openBrowser(onCommit: (v: string) => void = () => {}) {
  const host = await mountField("", onCommit);
  pointer(browseButton(host), "click");
  await flush();
  return host;
}

beforeAll(() => {
  mountOverlayLayers();
  initLayers();
});

beforeEach(() => {
  resetStudioState();
  invalidateMediaCache();
  installTree(defaultTree);
});

afterEach(async () => {
  closeFromPlatform();
  for (const host of hosts) {
    unmountMediaPicker(host);
    host.remove();
  }
  hosts = [];
  await flush();
  rafQueue = [];
});

// ─── Cache collection ────────────────────────────────────────────────────────

describe("media cache collection", () => {
  test("recurses directories, filters by media extension, strips public/ prefix", async () => {
    await openBrowser();
    expect(rowPaths()).toEqual(["/logo.png", "/clip.mp4", "/img/photo.JPG"]);
  });

  test("image entries get a thumbnail, non-images do not", async () => {
    await openBrowser();
    // No cross-origin loopback registered => the thumbnail src falls back to the relative path.
    expect(rows()[0]?.querySelector("img")?.getAttribute("src")).toBe("/logo.png");
    expect(rows()[1]?.querySelector("img")).toBeNull();
  });

  test("row thumbnail src is loopback-absolute when a cross-origin canvasUrl is registered", async () => {
    invalidateMediaCache();
    installTree(defaultTree, "http://127.0.0.1:54321/__studio__/canvas.html");
    await openBrowser();
    expect(rows()[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "http://127.0.0.1:54321/logo.png",
    );
  });

  test("invalidateMediaCache forces reload; an unreadable root yields an empty browser", async () => {
    await mountField("");
    invalidateMediaCache();
    installTree({});
    const host = await mountField("");
    // Both buttons still render — a project with no media yet is exactly when Upload matters, and
    // The panel states the emptiness rather than the field hiding its own affordances.
    expect(browseButton(host)).not.toBeNull();
    expect(uploadButton(host)).not.toBeNull();
    pointer(browseButton(host), "click");
    await flush();
    expect(rows()).toHaveLength(0);
    expect(emptyLine()).toBe("No matches");
  });
});

// ─── The field ───────────────────────────────────────────────────────────────

describe("the media field", () => {
  test("shows a thumbnail for image values only", async () => {
    const withImage = await mountField("/logo.png");
    // No cross-origin loopback registered => the thumb src falls back to the relative path.
    expect(thumb(withImage)?.getAttribute("src")).toBe("/logo.png");

    const withVideo = await mountField("/clip.mp4");
    expect(thumb(withVideo)).toBeNull();

    const empty = await mountField("");
    expect(thumb(empty)).toBeNull();
  });

  test("thumb src is loopback-absolute when a cross-origin canvasUrl is registered", async () => {
    invalidateMediaCache();
    installTree(defaultTree, "http://127.0.0.1:54321/__studio__/canvas.html");
    const withImage = await mountField("/logo.png");
    expect(thumb(withImage)?.getAttribute("src")).toBe("http://127.0.0.1:54321/logo.png");
  });

  test("the field takes the edited prop as its accessible name", async () => {
    const host = await mountField("/logo.png");
    expect(fieldInput(host).getAttribute("aria-label")).toBe("src");
  });

  test("typing into the field commits the value", async () => {
    const seen: string[] = [];
    const host = await mountField("/logo.png", (v) => seen.push(v));
    setValue(fieldInput(host), "/other.png");
    expect(seen).toEqual(["/other.png"]);
  });

  test("focusing the field re-triggers the (already loaded) cache load", async () => {
    const host = await mountField("");
    fieldInput(host).dispatchEvent(new Event("focus", { bubbles: true }));
    await flush();
    // Cache still intact — the browser still lists media.
    pointer(browseButton(host), "click");
    await flush();
    expect(rows()).toHaveLength(3);
  });

  test("a repaint updates the mounted field rather than mounting a second one", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    mountMediaPicker(host, "src", "/logo.png", () => {});
    await flush();
    mountMediaPicker(host, "poster", "/clip.mp4", () => {});
    await flush();
    expect(host.querySelectorAll('[part="media-field"]')).toHaveLength(1);
    expect(fieldInput(host).getAttribute("aria-label")).toBe("poster");
    expect(fieldInput(host).value).toBe("/clip.mp4");
    // The value moved with the repaint, so the thumbnail went with it.
    expect(thumb(host)).toBeNull();
  });

  test("a repaint re-points the commit callback at the row standing now", async () => {
    const first: string[] = [];
    const second: string[] = [];
    const host = await mountField("/logo.png", (v) => first.push(v));
    mountMediaPicker(host, "src", "/logo.png", (v) => second.push(v));
    await flush();
    setValue(fieldInput(host), "/other.png");
    expect(first).toEqual([]);
    expect(second).toEqual(["/other.png"]);
  });

  test("unmounting empties the host, and a mount disposed before it lands leaves nothing", async () => {
    const host = await mountField("/logo.png");
    unmountMediaPicker(host);
    expect(host.querySelector('[part="media-field"]')).toBeNull();
    // Idempotent: a host with no field is not an error.
    unmountMediaPicker(host);

    const early = document.createElement("div");
    document.body.append(early);
    hosts.push(early);
    mountMediaPicker(early, "src", "", () => {});
    unmountMediaPicker(early);
    await flush();
    expect(early.querySelector('[part="media-field"]')).toBeNull();
  });
});

// ─── The browser ─────────────────────────────────────────────────────────────

describe("the media browser", () => {
  test("selecting a row commits the value and dismisses", async () => {
    const seen: string[] = [];
    await openBrowser((v) => seen.push(v));
    pointer(rows()[2]!, "click");
    await flush();
    expect(seen).toEqual(["/img/photo.JPG"]);
    expect(panel()).toBeNull();
  });

  test("the filter narrows the list; no matches states the emptiness", async () => {
    await openBrowser();
    setValue(filterInput(), "PHOTO");
    await flush();
    expect(rowPaths()).toEqual(["/img/photo.JPG"]);

    setValue(filterInput(), "zzz");
    await flush();
    expect(rows()).toHaveLength(0);
    expect(emptyLine()).toBe("No matches");
  });

  test("dismissal is the platform's: the panel is an auto popover in its own slot", async () => {
    const host = await openBrowser();
    expect(panel()?.getAttribute("popover")).toBe("auto");
    // The invoker is the control that opened it, so a second press toggles rather than reopens.
    expect(browseButton(host)).not.toBeNull();
    closeFromPlatform();
    await flush();
    // The slot goes with the panel: nothing is left in the layer to shadow the next one.
    expect(panel()).toBeNull();
    expect(layerHost("popover").querySelector('[data-jx-region="overlay.menu:media-picker"]')).toBe(
      null,
    );
  });

  test("a pick after a platform dismissal commits nothing", async () => {
    const seen: string[] = [];
    await openBrowser((v) => seen.push(v));
    const row = rows()[0]!;
    closeFromPlatform();
    await flush();
    pointer(row, "click");
    expect(seen).toEqual([]);
  });

  test("opening a second browser replaces the first", async () => {
    const host = await openBrowser();
    pointer(browseButton(host), "click");
    await flush();
    expect(layerHost("popover").querySelectorAll('jx-popover[part="media-browser"]')).toHaveLength(
      1,
    );
  });

  test("the panel is placed at the anchor's box and writes no inline geometry", async () => {
    const host = await mountField("");
    const button = browseButton(host);
    stubRect(button, { height: 20, left: 120, top: 300, width: 24 });
    pointer(button, "click");
    await flush();
    const open = panel()!;
    // `jx-popover` takes x/y as props and clamps them itself; nothing here measures the panel.
    expect(open.style.left).toBe("");
    expect(open.style.top).toBe("");
    const vars = open.getAttribute("style") ?? "";
    expect(vars).toContain("120px");
    expect(vars).toContain("324px");
  });

  test("the filter takes the caret when the panel opens", async () => {
    await openBrowser();
    expect(document.activeElement).toBe(filterInput());
  });

  test("a panel closed before it mounts focuses nothing and leaves no slot", async () => {
    const handle = openMediaBrowserSurface(
      {
        emptyLabel: "No matches",
        filter: "",
        moreLabel: "",
        moreState: "hidden",
        rows: [],
        rowsState: "empty",
        x: 0,
        y: 0,
      },
      { measure: () => {}, pick: () => {}, setFilter: () => {} },
      null,
    );
    handle.close();
    await flush();
    expect(handle.isOpen()).toBe(false);
    expect(panel()).toBeNull();
  });

  test("more than 50 entries are listed to the cap and the rest are counted", async () => {
    invalidateMediaCache();
    const many: Entry[] = [];
    for (let i = 0; i < 60; i++) {
      many.push({ name: `pic-${i}.png`, path: `public/pic-${i}.png`, type: "file" });
    }
    installTree({ public: many });
    await openBrowser();
    expect(rows()).toHaveLength(50);
    expect(moreLine()).toBe("…10 more");
  });
});

// ─── Upload ──────────────────────────────────────────────────────────────────

describe("media picker upload", () => {
  test("the Upload button opens a multi-file picker restricted to media types", async () => {
    const host = await mountField("");
    let created: HTMLInputElement | null = null;
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag);
      if (tag === "input") {
        created = el as HTMLInputElement;
        // The real click() would open an OS dialog; nothing to do in happy-dom.
        (el as HTMLInputElement).click = () => {};
      }
      return el;
    }) as typeof document.createElement;

    try {
      pointer(uploadButton(host), "click");
    } finally {
      document.createElement = realCreate;
    }

    expect(created).not.toBeNull();
    expect(created!.type).toBe("file");
    expect(created!.multiple).toBe(true);
    expect(created!.accept).toContain("image/*");
  });

  test("choosing files in that picker uploads them and assigns the first", async () => {
    installMockPlatform();
    const commits: string[] = [];
    const host = await mountField("", (v) => commits.push(v));
    let created: HTMLInputElement | null = null;
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag);
      if (tag === "input") {
        created = el as HTMLInputElement;
        (el as HTMLInputElement).click = () => {};
      }
      return el;
    }) as typeof document.createElement;
    try {
      pointer(uploadButton(host), "click");
    } finally {
      document.createElement = realCreate;
    }
    // Happy-dom's `files` is read-only, and the OS is what would have written it.
    Object.defineProperty(created!, "files", {
      configurable: true,
      value: [testFile("hero.png")],
    });
    created!.dispatchEvent(new Event("change"));
    await flush();
    expect(commits).toEqual(["/hero.png"]);
  });

  test("a picker dismissed without choosing anything commits nothing", async () => {
    installMockPlatform();
    const commits: string[] = [];
    const host = await mountField("", (v) => commits.push(v));
    let created: HTMLInputElement | null = null;
    const realCreate = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const el = realCreate(tag);
      if (tag === "input") {
        created = el as HTMLInputElement;
        (el as HTMLInputElement).click = () => {};
      }
      return el;
    }) as typeof document.createElement;
    try {
      pointer(uploadButton(host), "click");
    } finally {
      document.createElement = realCreate;
    }
    created!.dispatchEvent(new Event("change"));
    await flush();
    expect(commits).toEqual([]);
  });

  test("uploadAndAssign commits the first upload's ref", async () => {
    const { state } = installMockPlatform();
    const commits: string[] = [];

    await uploadAndAssign([testFile("hero.png"), testFile("second.png")], (v) => commits.push(v));

    // Both files land, but only the first fills the single-valued field.
    expect(state.calls.filter((c) => c[0] === "uploadFile")).toHaveLength(2);
    expect(commits).toEqual(["/hero.png"]);
  });

  test("uploadAndAssign commits nothing when every upload failed", async () => {
    installMockPlatform({ uploadFile: () => Promise.reject(new Error("nope")) });
    const commits: string[] = [];

    await uploadAndAssign([testFile("hero.png")], (v) => commits.push(v));

    expect(commits).toEqual([]);
  });
});

// ─── Content-relative thumbnails ─────────────────────────────────────────────

describe("media field thumbnail for a content entry", () => {
  test("a content-relative value previews at its mounted URL, not against index.html", async () => {
    resetStudioState({ projectConfig: { content: { posts: { source: "./content/posts/" } } } });
    resetWorkspaceWithTab(undefined, { documentPath: "content/posts/hello.md" });

    const host = await mountField("./images/hero.png");

    // Without the mapping this would be "./images/hero.png", which the parent document resolves to
    // /packages/studio/images/hero.png and 404s.
    expect(thumb(host)?.getAttribute("src")).toBe("/content/posts/images/hero.png");
    // The FIELD still shows what the author wrote — the mapping is preview-only.
    expect(fieldInput(host).value).toBe("./images/hero.png");
  });

  test("a page document leaves the value alone", async () => {
    resetStudioState({ projectConfig: { content: { posts: { source: "./content/posts/" } } } });
    resetWorkspaceWithTab(undefined, { documentPath: "pages/index.json" });

    const host = await mountField("/logo.png");

    expect(thumb(host)?.getAttribute("src")).toBe("/logo.png");
  });
});

// ─── Metadata captions ───────────────────────────────────────────────────────

/**
 * The browse list says how big each file is, and it costs nothing extra to say: the size rides in
 * on the listing that enumerated the row, and the dimensions come off the thumbnail that was going
 * to load anyway. Both are captions — a file whose size is unknown gets no caption at all rather
 * than a zero.
 */
describe("browse list metadata", () => {
  const sizedTree: Record<string, Entry[]> = {
    public: [
      { name: "logo.png", path: "public/logo.png", size: 86_016, type: "file" },
      { name: "clip.mp4", path: "public/clip.mp4", type: "file" },
    ],
  };

  /** Fire `load` on a rendered thumbnail with the intrinsic size a real decode would report. */
  function loadThumb(img: HTMLImageElement, width: number, height: number) {
    Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
    Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
    img.dispatchEvent(new Event("load"));
  }

  function firstThumb(): HTMLImageElement {
    return panel()!.querySelector('[part="row-thumb"]') as HTMLImageElement;
  }

  beforeEach(() => {
    invalidateMediaCache();
    installTree(sizedTree);
  });

  test("the listing's size becomes the row's caption", async () => {
    await openBrowser();
    // The video's size was absent from the listing, so it gets no caption rather than "0 B".
    expect(captions()).toEqual(["84 KB", undefined]);
  });

  test("a loaded thumbnail adds its dimensions on the next frame", async () => {
    await openBrowser();
    loadThumb(firstThumb(), 1200, 800);
    // Nothing repaints synchronously — the measurement is coalesced into one frame.
    expect(captions()).toEqual(["84 KB", undefined]);
    runRaf();
    await flush();
    expect(captions()).toEqual(["1200 × 800 · 84 KB", undefined]);
  });

  test("re-firing load from cache does not schedule a second repaint", async () => {
    await openBrowser();
    loadThumb(firstThumb(), 1200, 800);
    runRaf();
    await flush();
    const afterFirst = rafQueue.length;
    loadThumb(firstThumb(), 1200, 800);
    expect(rafQueue).toHaveLength(afterFirst);
  });

  test("a broken thumbnail reports 0 and is not written down as a measurement", async () => {
    await openBrowser();
    loadThumb(firstThumb(), 0, 0);
    runRaf();
    await flush();
    expect(captions()).toEqual(["84 KB", undefined]);
  });

  test("a measurement landing after the panel closed repaints nothing", async () => {
    await openBrowser();
    const img = firstThumb();
    loadThumb(img, 1200, 800);
    closeFromPlatform();
    await flush();
    runRaf();
    expect(panel()).toBeNull();
  });

  test("invalidating the cache drops the sizes with the listing", async () => {
    await openBrowser();
    expect(captions()).toEqual(["84 KB", undefined]);
    closeFromPlatform();
    await flush();
    invalidateMediaCache();
    installTree({ public: [{ name: "logo.png", path: "public/logo.png", type: "file" }] });
    await openBrowser();
    expect(captions()).toEqual([undefined]);
  });
});
