/**
 * The Image editor — `src/media/image-editor.ts` and its surface, `src/surfaces/image-editor.ts`.
 *
 * Every fixture opens the file the way Studio opens it (`openFileInTab`) and draws the pane through
 * the same entry the canvas dispatches to. The host's two pixel primitives are faked on
 * `globalThis` (happy-dom has neither), so a save runs the real bake and the real Replace path.
 *
 * The case that pins the design is two panes over one tab: the recipe is the TAB's, so both panes
 * show one pending crop and `saveImage(tab)` has one subject. A per-pane recipe would let them
 * diverge, and that test would fail.
 */
import {
  flush,
  installMockPlatform,
  key,
  resetStudioState,
  setValue,
  stubRect,
  surfaceOf,
} from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { effect, effectScope } from "../src/reactivity";
import {
  closeAllTabs,
  promoteDirtyPreviewTabs,
  tabHoldsEditBesideDocument,
  workspace,
} from "../src/workspace/workspace";
import { openFileInTab, reloadCleanTab } from "../src/files/files";
import { saveFile } from "../src/files/file-ops";
import { collabState } from "../src/collab/collab-state";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import { resetAnnouncer } from "../src/services/announce";
import { localRevisionOf, resetAssetVersions } from "../src/files/asset-versions";
import { shouldWarnOnClose } from "../src/panels/tab-strip";
import { editorKindForMode, EDITOR_KIND_LABELS } from "../src/commands/context";
import { createLiveContext } from "../src/commands/live-context";
import { canRedo, canUndo, redo, undo } from "../src/tabs/transact";
import { workspaceOfTab } from "../src/workspace/tab-workspace";
import { viewsReplacedBy } from "../src/workspace/workspace-switch";
import {
  BUILD_DEFAULT_WIDTHS,
  IMAGE_MODE,
  detachImageEditor,
  imageEditorAllowsReplace,
  imageEditorDirty,
  imageEditorMounted,
  imageFileChanged,
  renderImageMode,
  saveImage,
} from "../src/media/image-editor";
import { canEditImage, openImageEditor } from "../src/media/media-open";
import { mountImageEditorSurface } from "../src/surfaces/image-editor";
import type { ImageEditorActions, ImageEditorView } from "../src/surfaces/image-editor";
import { MEDIA_MODE } from "../src/media/media-pane";
import type { Tab } from "../src/tabs/tab";
import { getPlatform } from "../src/platform";
import type { StudioPlatform } from "../src/types";
import type { PeerPresence } from "../src/collab/collab-state";
import type { BakeContext, BakeSurface } from "../src/media/image-bake";
import {
  FakeContext,
  ascii,
  chunk,
  defineCreateBitmap,
  defineOffscreen,
  jpeg,
  png,
} from "./image-fixtures";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A PNG whose header says 400 × 300, which is all the editor reads before a decode. */
const PNG = png(400, 300, chunk("IDAT", [1, 2, 3]), chunk("IEND"));
const APNG = png(400, 300, chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]));

let disk: Map<string, Uint8Array>;
/** How many times the editor has asked for a file's raw bytes. */
let readCount = 0;

function seed(overrides: Partial<StudioPlatform> = {}): void {
  resetStudioState({
    isSiteProject: true,
    name: "Demo",
    projectConfig: { name: "Demo" },
    projectRoot: "/demo",
  });
  disk = new Map([
    ["public/hero.png", PNG],
    ["public/anim.png", APNG],
  ]);
  installMockPlatform(
    {
      readFileBytes: async (path: string) => {
        readCount += 1;
        const bytes = disk.get(path);
        if (!bytes) {
          throw new Error(`no such file: ${path}`);
        }
        return Uint8Array.from(bytes).buffer;
      },
      uploadFile: async (path: string, data: string | ArrayBuffer | Blob) => {
        disk.set(path, new Uint8Array(await new Blob([data]).arrayBuffer()));
        return { path };
      },
      ...overrides,
    },
    { "public/hero.png": "png", "public/anim.png": "png", "pages/index.json": "{}" },
  );
}

/** What the fake host was asked to decode, newest last, and how many bakes ran. */
let decoded: Uint8Array[];
let bakes: number;
let encodeAs: string | null;
const saved = {
  createImageBitmap: globalThis.createImageBitmap,
  OffscreenCanvas: globalThis.OffscreenCanvas,
};

function installFakeHost(): void {
  decoded = [];
  bakes = 0;
  encodeAs = null;
  const createBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    decoded.push(new Uint8Array(await blob.arrayBuffer()));
    const bitmap: ImageBitmap = { close: () => {}, height: 300, width: 400 };
    return bitmap;
  };
  class FakeCanvas implements BakeSurface {
    readonly context = new FakeContext();
    getContext(): BakeContext {
      return this.context;
    }
    convertToBlob(options?: ImageEncodeOptions): Promise<Blob> {
      bakes += 1;
      this.context.calls.push(["encode", bakes]);
      // Each bake's bytes are distinct, so a later decode can say which write it read.
      const type = encodeAs ?? options?.type ?? "";
      return Promise.resolve(new Blob([new Uint8Array(200).fill(bakes)], { type }));
    }
  }
  defineCreateBitmap(createBitmap);
  defineOffscreen(FakeCanvas);
}

/** Open `path`, put its tab in the Image editor, and draw it into a fresh host in `paneId`. */
async function open(path = "public/hero.png", paneId = "primary") {
  await openFileInTab(path);
  const tab = workspace.tabs.get(path)!;
  tab.session.ui.canvasMode = IMAGE_MODE;
  const host = draw(tab, paneId);
  await flush(6);
  // Happy-dom decodes nothing, so the picture's load is reported, at the size the fixture's header says.
  if (host.querySelector('[part="image"]')) {
    decode(host);
    await flush(2);
  }
  return { host, tab };
}

/** Report the picture as decoded at this size, which is what no gesture is taken before. */
function decode(host: ParentNode, width = 400, height = 300): void {
  const img = image(host);
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  img.dispatchEvent(new Event("load"));
}

function draw(tab: Tab, paneId: string): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  renderImageMode(surfaceOf(host, paneId), tab);
  return host;
}

function part(host: ParentNode, name: string): HTMLElement {
  const el = host.querySelector(`[part="${name}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new TypeError(`no [part="${name}"]`);
  }
  return el;
}

function image(host: ParentNode): HTMLImageElement {
  const el = part(host, "image");
  if (!(el instanceof HTMLImageElement)) {
    throw new TypeError("the image part is not an <img>");
  }
  return el;
}

function handle(host: ParentNode, id: string): HTMLElement {
  const el = host.querySelector(`[part="handle"][data-handle="${id}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new TypeError(`no handle ${id}`);
  }
  return el;
}

/** The value a number field shows, read off its inner control. */
function field(host: ParentNode, name: string): HTMLInputElement {
  const input = part(host, name).querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError(`no input in ${name}`);
  }
  return input;
}

function cropVars(host: HTMLElement): string[] {
  const root = part(host, "editor");
  return ["--jx-crop-x", "--jx-crop-y", "--jx-crop-w", "--jx-crop-h"].map((name) =>
    root.style.getPropertyValue(name),
  );
}

function pointerAt(el: Element, type: string, clientX: number, clientY: number): void {
  el.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, pointerId: 7 }),
  );
}

/** Whether a kit button can act: `jx-button` draws the native control, which carries `disabled`. */
function disabled(host: ParentNode, name: string): boolean {
  const control = host.querySelector(`[part="${name}"] [part="control"]`);
  if (!(control instanceof HTMLButtonElement)) {
    throw new TypeError(`no control in ${name}`);
  }
  return control.disabled;
}

/** Whether a message reached the reader, as a toast or as a Problem. */
function said(message: string): boolean {
  return [...toasts, ...problems].some((note) => note.message === message);
}

async function press(host: ParentNode, name: string): Promise<void> {
  part(host, name).click();
  await flush(4);
}

beforeEach(() => {
  seed();
  installFakeHost();
});

afterEach(() => {
  detachImageEditor("primary");
  detachImageEditor("side");
  closeAllTabs();
  resetNotifications();
  resetAnnouncer();
  resetAssetVersions();
  document.body.replaceChildren();
  defineCreateBitmap(saved.createImageBitmap);
  defineOffscreen(saved.OffscreenCanvas);
});

// ─── The mode ────────────────────────────────────────────────────────────────

describe("the mode", () => {
  test("is its own editor kind, labelled Image, never the canvas", () => {
    expect(editorKindForMode(IMAGE_MODE)).toBe("image");
    expect(EDITOR_KIND_LABELS.image).toBe("Image");
  });

  test("entering draws the picture through a blob URL with the overwrite sentence in view", async () => {
    const { host } = await open();
    const img = image(host);
    expect(img.getAttribute("src")).toStartWith("blob:");
    expect(part(host, "warning").textContent).toBe(
      "Save overwrites public/hero.png and keeps no backup. Source control is how to get the original back.",
    );
    expect(part(host, "facts").textContent).toBe(
      "Output 400 × 300 · crop 400 × 300 · source 400 × 300",
    );
    // PNG is lossless: no quality field is drawn for it.
    expect(host.querySelector('[part="quality"]')).toBeNull();
    expect(part(host, "editor").dataset.jxRegion).toBe("pane.primary/image");
  });

  test("a JPEG draws its quality field", async () => {
    disk.set("public/photo.jpg", Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 10, 0, 20]));
    const { host } = await open("public/photo.jpg");
    expect(field(host, "quality").value).toBe("90");
  });

  test("leaving releases the mount; the next render of the same tab mounts again", async () => {
    const { host, tab } = await open();
    expect(imageEditorMounted("primary", tab)).toBe(true);
    detachImageEditor("primary");
    detachImageEditor("primary");
    expect(imageEditorMounted("primary", tab)).toBe(false);
    renderImageMode(surfaceOf(host, "primary"), tab);
    renderImageMode(surfaceOf(host, "primary"), tab);
    await flush(6);
    expect(imageEditorMounted("primary", tab)).toBe(true);
    expect(host.querySelectorAll('[part="editor"]')).toHaveLength(1);
  });

  test("a pane torn down before its surface arrives mounts nothing", async () => {
    await openFileInTab("public/hero.png");
    const tab = workspace.tabs.get("public/hero.png")!;
    const host = draw(tab, "primary");
    detachImageEditor("primary");
    await flush(6);
    expect(host.querySelector('[part="editor"]')).toBeNull();
  });

  test("an animated PNG is refused by its bytes, with the reason", async () => {
    const { host } = await open("public/anim.png");
    expect(part(host, "refused").textContent).toContain("animated");
  });

  test("bytes that refuse the editor withdraw the mode, and a tab in it goes back and says why", async () => {
    // A still PNG keeps it...
    await openFileInTab("public/hero.png");
    await flush(4);
    expect(workspace.tabs.get("public/hero.png")!.capabilities.modes).toEqual([
      MEDIA_MODE,
      IMAGE_MODE,
    ]);
    // ...an animated one is offered until its bytes are read...
    const tab = openImageEditor("public/anim.png")!;
    expect(tab.session.ui.canvasMode).toBe(IMAGE_MODE);
    // The withdrawal has to notify, or the Editor control goes on offering what the file refuses.
    let drawnModes: string[] = [];
    const scope = effectScope();
    scope.run(() => {
      effect(() => {
        drawnModes = [...tab.capabilities.modes];
      });
    });
    expect(drawnModes).toEqual([MEDIA_MODE, IMAGE_MODE]);
    await flush(4);
    expect(drawnModes).toEqual([MEDIA_MODE]);
    scope.stop();
    // ...and then is not, and the tab that was in the mode says why rather than vanishing from it.
    expect(tab.capabilities.modes).toEqual([MEDIA_MODE]);
    expect(tab.session.ui.canvasMode).toBe(MEDIA_MODE);
    expect(said("This PNG is animated, and a bake would keep only its first frame.")).toBe(true);
  });

  test("a tab closed while its bytes are read has nothing to withdraw from", async () => {
    const tab = openImageEditor("public/anim.png")!;
    closeAllTabs();
    await flush(4);
    expect(tab.capabilities.modes).toEqual([MEDIA_MODE, IMAGE_MODE]);
    expect(said("This PNG is animated, and a bake would keep only its first frame.")).toBe(false);
  });

  test("a file that cannot be read decides nothing: the mode stays and the editor reports it", async () => {
    seed({ readFileBytes: () => Promise.reject(new Error("offline")) });
    await openFileInTab("public/hero.png");
    await flush(4);
    expect(workspace.tabs.get("public/hero.png")!.capabilities.modes).toContain(IMAGE_MODE);
  });

  test("a file that cannot be read says so", async () => {
    seed({ readFileBytes: () => Promise.reject(new Error("gone")) });
    const { host } = await open();
    expect(part(host, "refused").textContent).toBe("Could not read public/hero.png: gone");
  });

  test("a host that cannot read raw bytes is refused inside the mode too", async () => {
    delete getPlatform().readFileBytes;
    const { host, tab } = await open();
    expect(tab.capabilities.modes).toEqual([MEDIA_MODE]);
    expect(part(host, "refused").textContent).toContain("cannot hand Studio a file's raw bytes");
  });

  test("the decoded size replaces the header's guess once the picture loads", async () => {
    const { host } = await open();
    decode(host, 300, 400);
    await flush(4);
    expect(part(host, "facts").textContent).toBe(
      "Output 300 × 400 · crop 300 × 400 · source 300 × 400",
    );
  });
});

// ─── Per tab, not per pane ───────────────────────────────────────────────────

describe("two panes over one tab", () => {
  test("share one recipe and one dirty flag", async () => {
    const { host: left, tab } = await open();
    const right = draw(tab, "side");
    await flush(6);
    // Nothing to write yet, so the button that writes cannot act.
    expect(disabled(left, "save")).toBe(true);
    await press(left, "rotate-right");
    expect(imageEditorDirty(tab)).toBe(true);
    // The other pane repaints from the same record: the turn is on screen in both.
    for (const host of [left, right]) {
      expect(part(host, "editor").style.getPropertyValue("--jx-image-transform")).toContain(
        "rotate(90deg)",
      );
      expect(disabled(host, "save")).toBe(false);
    }
  });

  test("detaching one pane keeps the recipe; the last one releases the bytes, not the edit", async () => {
    const { host: left, tab } = await open();
    draw(tab, "side");
    await flush(6);
    await press(left, "flip-h");
    detachImageEditor("side");
    expect(imageEditorDirty(tab)).toBe(true);
    expect(part(left, "image").getAttribute("src")).toStartWith("blob:");
    detachImageEditor("primary");
    // The bytes are gone with the last pane; the edit is the tab's unsaved work and stays.
    expect(imageEditorDirty(tab)).toBe(true);
    expect(shouldWarnOnClose(tab)).toBe(true);
    // A save from no pane at all reads the bytes again and writes.
    expect(await saveImage(tab)).toBe(true);
    expect(decoded.at(-1)).toEqual(PNG);
  });
});

// ─── Gestures ────────────────────────────────────────────────────────────────

describe("gestures", () => {
  test("the toolbar turns, flips, undoes and redoes, as whole-record steps", async () => {
    const { host, tab } = await open();
    await press(host, "rotate-left");
    expect(part(host, "editor").style.getPropertyValue("--jx-image-transform")).toContain(
      "rotate(270deg)",
    );
    expect(part(host, "editor").style.getPropertyValue("--jx-image-w")).toBe("133.3333%");
    await press(host, "flip-v");
    await press(host, "undo");
    await press(host, "undo");
    expect(imageEditorDirty(tab)).toBe(false);
    await press(host, "redo");
    expect(imageEditorDirty(tab)).toBe(true);
    await press(host, "reset");
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("width, Fit for web and the tone fields write the recipe", async () => {
    const { host } = await open();
    setValue(field(host, "width"), "200");
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 200 × 150");
    setValue(field(host, "width"), "");
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 400 × 300");
    // No declared widths: the build's own defaults, and 320 is the largest below 400.
    expect(BUILD_DEFAULT_WIDTHS).toContain(320);
    expect(part(host, "fit").textContent).toStartWith("Fit for web (320 px)");
    await press(host, "fit");
    expect(part(host, "facts").textContent).toStartWith("Output 320 × 240");
    setValue(field(host, "brightness"), "120");
    setValue(field(host, "saturation"), "0");
    await flush(4);
    expect(part(host, "editor").style.getPropertyValue("--jx-image-filter")).toBe(
      "brightness(120%) saturate(0%)",
    );
  });

  test("Fit for web cannot act once the output is already that width", async () => {
    const { host } = await open();
    expect(disabled(host, "fit")).toBe(false);
    await press(host, "fit");
    expect(part(host, "facts").textContent).toStartWith("Output 320");
    expect(disabled(host, "fit")).toBe(true);
  });

  test("Fit for web reads the project's own images.widths, and is withheld with none below", async () => {
    seed();
    const { projectState } = await import("../src/store");
    projectState!.projectConfig = { images: { widths: [100, 640] }, name: "Demo" };
    const { host } = await open();
    expect(part(host, "fit").textContent).toStartWith("Fit for web (100 px)");
    projectState!.projectConfig = { images: { widths: [800] }, name: "Demo" };
    setValue(field(host, "width"), "399");
    await flush(4);
    expect(part(host, "fit").textContent).toBe("Fit for web");
    expect(disabled(host, "fit")).toBe(true);
  });

  test("a handle drag converts screen pixels into the image's frame, as ONE undo step", async () => {
    const { host } = await open();
    // Drawn at half size: one screen pixel is two image pixels.
    stubRect(part(host, "frame"), { height: 150, width: 200 });
    const se = handle(host, "se");
    se.setPointerCapture = () => {};
    pointerAt(se, "pointerdown", 100, 100);
    pointerAt(se, "pointermove", 90, 95);
    pointerAt(se, "pointermove", 80, 90);
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 360 × 280");
    // A move from another pointer, and a release from another, are not this drag's.
    se.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 0, pointerId: 9 }));
    se.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9 }));
    pointerAt(se, "pointerup", 80, 90);
    pointerAt(se, "pointerup", 80, 90);
    await flush(4);
    expect(cropVars(host)).toEqual(["0%", "0%", "90%", "93.3333%"]);
    await press(host, "undo");
    expect(cropVars(host)).toEqual(["0%", "0%", "100%", "100%"]);
  });

  test("dragging inside the crop moves it, keeping its size, as ONE undo step", async () => {
    const { host, tab } = await open();
    stubRect(part(host, "frame"), { height: 150, width: 200 });
    // Nothing to move yet: a crop of the whole image, and the cursor says so.
    expect(part(host, "editor").style.getPropertyValue("--jx-crop-cursor")).toBe("default");
    const se = handle(host, "se");
    se.setPointerCapture = () => {};
    pointerAt(se, "pointerdown", 100, 100);
    pointerAt(se, "pointermove", 50, 50);
    pointerAt(se, "pointerup", 50, 50);
    await flush(4);
    expect(part(host, "editor").style.getPropertyValue("--jx-crop-cursor")).toBe("move");
    const area = handle(host, "move");
    area.setPointerCapture = () => {};
    pointerAt(area, "pointerdown", 20, 20);
    pointerAt(area, "pointermove", 30, 30);
    pointerAt(area, "pointerup", 30, 30);
    await flush(4);
    // Half-size frame: ten screen pixels are twenty image pixels. Same crop, shifted.
    expect(part(host, "facts").textContent).toStartWith("Output 300 × 200");
    expect(cropVars(host)).toEqual(["5%", "6.6667%", "75%", "66.6667%"]);
    await press(host, "undo");
    expect(cropVars(host)).toEqual(["0%", "0%", "75%", "66.6667%"]);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("the area is a control of its own: named, in the group, moved from the keyboard", async () => {
    const { host } = await open();
    const area = handle(host, "move");
    expect(area.getAttribute("aria-label")).toBe("Crop area");
    expect(area.getAttribute("tabindex")).toBe("-1");
    key(handle(host, "nw"), "ArrowDown", { shiftKey: true });
    await flush(2);
    key(area, "ArrowUp");
    await flush(4);
    expect(document.querySelector("#jx-live-polite")?.textContent).toBe(
      "Crop area: crop 400 × 290 at 0, 9",
    );
  });

  test("the ratio picker holds the crop, and offers Free and Original first", async () => {
    const { host, tab } = await open();
    const select = part(host, "aspect").querySelector("select");
    if (!(select instanceof HTMLSelectElement)) {
      throw new TypeError("no native select in the ratio picker");
    }
    expect([...select.options].slice(0, 3).map((o) => o.value)).toEqual([
      "free",
      "original",
      "1:1",
    ]);
    const choose = (value: string) => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    choose("16:9");
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 400 × 225");
    expect(imageEditorDirty(tab)).toBe(true);
    // A word the picker does not offer changes nothing.
    choose("nonsense");
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 400 × 225");
    await press(host, "undo");
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("a drag with no drawn frame, or on an unknown handle, does nothing", async () => {
    const { host, tab } = await open();
    const n = handle(host, "n");
    pointerAt(n, "pointerdown", 0, 0);
    pointerAt(n, "pointermove", 0, 50);
    pointerAt(n, "pointerup", 0, 50);
    await flush(4);
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("a pointer cancel ends the drag like a release: later moves do not reach the crop", async () => {
    const { host } = await open();
    stubRect(part(host, "frame"), { height: 300, width: 400 });
    const w = handle(host, "w");
    w.setPointerCapture = () => {};
    pointerAt(w, "pointerdown", 0, 0);
    pointerAt(w, "pointermove", 40, 0);
    pointerAt(w, "pointercancel", 40, 0);
    pointerAt(w, "pointermove", 90, 0);
    await flush(4);
    expect(part(host, "facts").textContent).toStartWith("Output 360 × 300");
  });
});

// ─── Keyboard ────────────────────────────────────────────────────────────────

describe("the crop handles from the keyboard", () => {
  test("are one tab stop, and an arrow nudge is announced", async () => {
    const { host } = await open();
    const stops = [...host.querySelectorAll('[part="handle"]')].filter(
      (el) => el.getAttribute("tabindex") === "0",
    );
    expect(stops).toHaveLength(1);
    const nw = handle(host, "nw");
    expect(stops[0]).toBe(nw);
    expect(nw.getAttribute("aria-label")).toBe("Top left corner");
    key(nw, "ArrowRight", { shiftKey: true });
    key(nw, "ArrowDown");
    await flush(4);
    expect(document.querySelector("#jx-live-polite")?.textContent).toBe(
      "Top left corner: crop 390 × 299 at 10, 1",
    );
  });

  test("Home and End move the one stop around the handles, and focus follows", async () => {
    const { host } = await open();
    // From the last handle, End wraps to the crop area, and on to the first handle.
    key(handle(host, "nw"), "End");
    await flush(4);
    expect(document.activeElement).toBe(handle(host, "move"));
    key(handle(host, "move"), "End");
    await flush(4);
    expect(handle(host, "n").getAttribute("tabindex")).toBe("0");
    expect(handle(host, "nw").getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(handle(host, "n"));
    key(handle(host, "n"), "Home");
    key(handle(host, "move"), "Home");
    key(handle(host, "nw"), "Home");
    await flush(4);
    expect(handle(host, "w").getAttribute("tabindex")).toBe("0");
    expect(document.querySelector("#jx-live-polite")?.textContent).toBe("Left edge");
  });

  test("focusing a handle by pointer makes it the stop", async () => {
    const { host } = await open();
    handle(host, "se").focus();
    handle(host, "se").dispatchEvent(new FocusEvent("focus"));
    await flush(4);
    expect(handle(host, "se").getAttribute("tabindex")).toBe("0");
  });
});

// ─── The one write door ──────────────────────────────────────────────────────

describe("saving", () => {
  test("writes through Replace, names the size, and re-reads what it wrote before resetting", async () => {
    const { host, tab } = await open();
    await press(host, "rotate-right");
    await press(host, "save");
    await flush(6);
    expect(bakes).toBe(1);
    expect(decoded[0]).toEqual(PNG);
    expect(disk.get("public/hero.png")?.[0]).toBe(1);
    // The canvas encoder cannot write a palette, so a re-encode can grow, and the toast says so.
    expect(said("Replaced hero.png: 300 × 400, 200 B (was 60 B, so the file grew)")).toBe(true);
    expect(imageEditorDirty(tab)).toBe(false);
    // The repaint key: every URL for the path changes, on a host that vouches no version.
    expect(localRevisionOf("public/hero.png")).toBeString();
    expect(part(host, "facts").textContent).toBe(
      "Output 300 × 400 · crop 300 × 400 · source 300 × 400",
    );

    // A second edit and save bakes the FIRST write's bytes, not the original.
    await press(host, "flip-h");
    expect(await saveImage(tab)).toBe(true);
    expect(decoded[1]?.[0]).toBe(1);
    expect(disk.get("public/hero.png")?.[0]).toBe(2);
  });

  test("a result smaller than the file it replaces does not say it grew", async () => {
    disk.set("public/hero.png", Uint8Array.from([...PNG, ...new Uint8Array(300)]));
    const { host, tab } = await open();
    await press(host, "flip-v");
    expect(await saveImage(tab)).toBe(true);
    expect(said("Replaced hero.png: 400 × 300, 200 B (was 360 B)")).toBe(true);
  });

  test("an edit that changes nothing writes nothing and says so", async () => {
    const { tab } = await open();
    expect(await saveImage(tab)).toBe(true);
    expect(bakes).toBe(0);
    expect(said("hero.png has no changes, so nothing was written.")).toBe(true);
  });

  test("a failed verification writes nothing and keeps the edit", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    encodeAs = "image/jpeg";
    expect(await saveImage(tab)).toBe(false);
    expect(disk.get("public/hero.png")).toEqual(PNG);
    expect(said("Could not save hero.png.")).toBe(true);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("a write that landed elsewhere leaves the recipe and the source untouched", async () => {
    seed({ uploadFile: () => Promise.resolve({ path: "public/hero-1.png" }) });
    const { host, tab } = await open();
    const src = part(host, "image").getAttribute("src");
    await press(host, "flip-h");
    expect(await saveImage(tab)).toBe(false);
    expect(imageEditorDirty(tab)).toBe(true);
    expect(part(host, "image").getAttribute("src")).toBe(src);
  });

  test("a save already in flight is not started twice", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    const first = saveImage(tab);
    expect(await saveImage(tab)).toBe(false);
    expect(await first).toBe(true);
    expect(bakes).toBe(1);
  });

  test("a tab that never opened the editor has nothing to save", async () => {
    await openFileInTab("public/hero.png");
    expect(await saveImage(workspace.tabs.get("public/hero.png")!)).toBe(true);
    expect(bakes).toBe(0);
  });

  test("a save with no decoded size yet has nothing to write", async () => {
    disk.set("public/odd.webp", Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]));
    const { tab } = await open("public/odd.webp");
    expect(imageEditorDirty(tab)).toBe(false);
    expect(await saveImage(tab)).toBe(true);
    expect(bakes).toBe(0);
  });
});

describe("a save that cannot write says so, and is not called a success", () => {
  test("a read that fails with an edit pending reports it and returns false", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    detachImageEditor("primary");
    disk.delete("public/hero.png");
    // False is what stops the close prompt's Save from closing the tab on top of nothing.
    expect(await saveFile(tab)).toBe(false);
    expect(said("Could not save hero.png.")).toBe(true);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("a read that failed earlier is tried again rather than remembered", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    detachImageEditor("primary");
    const bytes = disk.get("public/hero.png")!;
    disk.delete("public/hero.png");
    expect(await saveImage(tab)).toBe(false);
    disk.set("public/hero.png", bytes);
    expect(await saveImage(tab)).toBe(true);
    expect(bakes).toBe(1);
  });

  test("a mount during the save's read does not make the save lose its bytes", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    detachImageEditor("primary");
    const saving = saveImage(tab);
    draw(tab, "primary");
    expect(await saving).toBe(true);
    expect(bakes).toBe(1);
  });

  test("a mount whose read overtakes the save's: the save reads again rather than giving up", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    detachImageEditor("primary");
    const bytes = disk.get("public/hero.png")!;
    // The save's read finishes while the mount's, which is newer and so drops it, is still running.
    const answers: (() => void)[] = [];
    const read = (): Promise<ArrayBuffer> =>
      new Promise((resolve) => {
        answers.push(() => resolve(Uint8Array.from(bytes).buffer));
      });
    getPlatform().readFileBytes = read;
    const saving = saveImage(tab);
    await flush(1);
    draw(tab, "primary");
    await flush(1);
    expect(answers).toHaveLength(2);
    answers[0]!();
    await flush(2);
    // The dropped read left no bytes, so the save has asked a third time.
    expect(answers).toHaveLength(3);
    answers[1]!();
    answers[2]!();
    expect(await saving).toBe(true);
    expect(bakes).toBe(1);
  });

  test("a bake the host rejects is reported, not an unhandled rejection", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    defineCreateBitmap(() => Promise.reject(new Error("corrupt")));
    expect(await saveImage(tab)).toBe(false);
    expect(said("Could not save hero.png.")).toBe(true);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("a body that does not decode refuses the editor; a stale URL's error does not", async () => {
    const { host } = await open();
    const img = image(host);
    Object.defineProperty(img, "src", { configurable: true, value: "blob:stale" });
    img.dispatchEvent(new Event("error"));
    await flush(4);
    expect(host.querySelector('[part="refused"]')).toBeNull();
    Object.defineProperty(img, "src", {
      configurable: true,
      value: img.getAttribute("src"),
    });
    img.dispatchEvent(new Event("error"));
    await flush(4);
    expect(part(host, "refused").textContent).toContain("could not be decoded");
  });
});

describe("what happens around a save in flight", () => {
  /** Hold the decode, so a test can act while the bake is waiting. */
  function holdBake(): () => void {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    defineCreateBitmap(async () => {
      await held;
      const bitmap: ImageBitmap = { close: () => {}, height: 300, width: 400 };
      return bitmap;
    });
    return release;
  }

  test("a tab closed while it runs writes nothing: the answer that closed it stands", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    const release = holdBake();
    const saving = saveImage(tab);
    await flush(2);
    closeAllTabs();
    release();
    expect(await saving).toBe(false);
    expect(disk.get("public/hero.png")).toEqual(PNG);
  });

  test("a rename while it runs writes nothing to the old name, and keeps the edit", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    const release = holdBake();
    const saving = saveImage(tab);
    await flush(2);
    tab.documentPath = "public/renamed.png";
    release();
    expect(await saving).toBe(false);
    expect(disk.get("public/hero.png")).toEqual(PNG);
    expect(said("Could not save hero.png.")).toBe(true);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("a drag still moving becomes part of the edit, and ends with the save", async () => {
    const { host, tab } = await open();
    stubRect(part(host, "frame"), { height: 300, width: 400 });
    const se = handle(host, "se");
    se.setPointerCapture = () => {};
    pointerAt(se, "pointerdown", 400, 300);
    pointerAt(se, "pointermove", 300, 200);
    expect(await saveImage(tab)).toBe(true);
    await flush(4);
    expect(part(host, "facts").textContent).toBe(
      "Output 300 × 200 · crop 300 × 200 · source 300 × 200",
    );
    // The pointer is still down, and it no longer means anything.
    pointerAt(se, "pointermove", 100, 100);
    pointerAt(se, "pointerup", 100, 100);
    await flush(4);
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("a save leaves the frame standing, so a keyboard user keeps their place", async () => {
    const { host, tab } = await open();
    const nw = handle(host, "nw");
    key(nw, "ArrowRight");
    expect(await saveImage(tab)).toBe(true);
    await flush(4);
    expect(handle(host, "nw")).toBe(nw);
  });

  test("a number still being typed is committed first, and keeps the focus", async () => {
    const { host, tab } = await open();
    const input = field(host, "brightness");
    input.focus();
    // A real input fires change on blur; happy-dom does not, so the blur stands in for it.
    input.addEventListener("blur", () => {
      input.value = "150";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saving = saveImage(tab);
    await flush(2);
    // A browser takes focus from an input as it is disabled, so a save must not disable one.
    expect(input.disabled).toBe(false);
    expect(await saving).toBe(true);
    expect(bakes).toBe(1);
    expect(document.activeElement).toBe(input);
  });

  test("text in a field is unsaved work, so the chord is not refused over it", async () => {
    const { host, tab } = await open();
    const input = field(host, "contrast");
    expect(imageEditorDirty(tab)).toBe(false);
    input.value = "120";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush(2);
    expect(imageEditorDirty(tab)).toBe(true);
    // Typed back to what it said: committing it leaves nothing pending.
    input.value = "100";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush(2);
    expect(imageEditorDirty(tab)).toBe(false);
    // And it goes with the pane that held the field.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(imageEditorDirty(tab)).toBe(true);
    detachImageEditor("primary");
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("text the blur does not commit does not leave the tab dirty after a save", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    const input = field(host, "contrast");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(await saveImage(tab)).toBe(true);
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("a save with no pane showing the tab does not keep the bytes", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    detachImageEditor("primary");
    expect(await saveImage(tab)).toBe(true);
    const reads = readCount;
    draw(tab, "primary");
    await flush(6);
    expect(readCount).toBe(reads + 1);
  });

  test("a pane torn down mid-drag abandons the gesture, which never ended", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    stubRect(part(host, "frame"), { height: 300, width: 400 });
    const se = handle(host, "se");
    se.setPointerCapture = () => {};
    pointerAt(se, "pointerdown", 400, 300);
    pointerAt(se, "pointermove", 300, 200);
    detachImageEditor("primary");
    const again = draw(tab, "primary");
    await flush(6);
    expect(part(again, "facts").textContent).toStartWith("Output 400 × 300");
  });
});

describe("before the picture has decoded", () => {
  test("no gesture is taken, because the header's size is only a guess", async () => {
    await openFileInTab("public/hero.png");
    const tab = workspace.tabs.get("public/hero.png")!;
    const host = draw(tab, "primary");
    await flush(6);
    key(handle(host, "nw"), "ArrowRight");
    await press(host, "flip-h");
    expect(imageEditorDirty(tab)).toBe(false);
    expect(part(host, "facts").textContent).toBe("");
    expect(field(host, "width").disabled).toBe(true);
    // The stored size is 400 × 300; the decode says otherwise, as an orientation tag would.
    decode(host, 300, 400);
    await flush(4);
    key(handle(host, "nw"), "ArrowRight");
    await flush(4);
    expect(part(host, "facts").textContent).toBe(
      "Output 299 × 400 · crop 299 × 400 · source 300 × 400",
    );
  });
});

describe("new bytes from elsewhere", () => {
  const OTHER = png(100, 80, chunk("IDAT", [9]), chunk("IEND"));

  test("Replace waits for a pending edit, and says what to do", async () => {
    const { host } = await open();
    await press(host, "flip-h");
    expect(imageEditorAllowsReplace("public/hero.png")).toBe(false);
    expect(
      said("hero.png has an unsaved edit. Save or discard it before replacing the file."),
    ).toBe(true);
  });

  test("a clean editor, or no editor at all, lets Replace go ahead", async () => {
    expect(imageEditorAllowsReplace("public/hero.png")).toBe(true);
    await open();
    expect(imageEditorAllowsReplace("public/hero.png")).toBe(true);
  });

  test("a clean editor reads them, so its next edit is of what is on disk", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    await press(host, "undo");
    disk.set("public/hero.png", OTHER);
    imageFileChanged("public/hero.png");
    await flush(6);
    decode(host, 100, 80);
    await flush(4);
    expect(part(host, "facts").textContent).toBe(
      "Output 100 × 80 · crop 100 × 80 · source 100 × 80",
    );
    // The steps behind the present were made against the old picture.
    expect(canRedo(tab)).toBe(false);
    await press(host, "flip-v");
    expect(await saveImage(tab)).toBe(true);
    expect(decoded.at(-1)).toEqual(OTHER);
  });

  test("an editor no pane is showing reads them when it is next needed", async () => {
    const { tab } = await open();
    detachImageEditor("primary");
    const reads = readCount;
    imageFileChanged("public/hero.png");
    expect(readCount).toBe(reads);
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("the file-event stream's reload reaches a clean editor", async () => {
    const { host } = await open();
    disk.set("public/hero.png", OTHER);
    reloadCleanTab("public/hero.png");
    await flush(6);
    decode(host, 100, 80);
    await flush(4);
    expect(part(host, "facts").textContent).toBe(
      "Output 100 × 80 · crop 100 × 80 · source 100 × 80",
    );
  });

  test("a pending edit is left alone, and a path with no editor is nothing to do", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    const reads = readCount;
    imageFileChanged("public/hero.png");
    imageFileChanged("public/none.png");
    expect(readCount).toBe(reads);
    expect(imageEditorDirty(tab)).toBe(true);
  });

  test("a crop the new bytes no longer contain is refused rather than written blank", async () => {
    const { host, tab } = await open();
    const se = handle(host, "nw");
    key(se, "ArrowRight", { shiftKey: true });
    await flush(2);
    detachImageEditor("primary");
    // Another program, under a pending edit: not detected, and the bake is what stands in the way.
    disk.set("public/hero.png", OTHER);
    defineCreateBitmap(() => {
      const bitmap: ImageBitmap = { close: () => {}, height: 80, width: 100 };
      return Promise.resolve(bitmap);
    });
    expect(await saveImage(tab)).toBe(false);
    expect(said("Could not save hero.png.")).toBe(true);
    expect(disk.get("public/hero.png")).toEqual(OTHER);
  });
});

describe("a number field shows what a save would use", () => {
  test("clearing Quality or a tone leaves it alone, and the field goes back", async () => {
    disk.set("public/photo.jpg", jpeg(400, 300));
    const { host, tab } = await open("public/photo.jpg");
    for (const name of ["quality", "brightness"]) {
      const input = field(host, name);
      const before = input.value;
      setValue(input, "");
      await flush(4);
      expect(field(host, name).value).toBe(before);
    }
    expect(imageEditorDirty(tab)).toBe(false);
  });

  test("a value refused or clamped is corrected, even when the recipe did not move", async () => {
    const { host } = await open();
    setValue(field(host, "width"), "9000");
    await flush(4);
    expect(field(host, "width").value).toBe("400");
    setValue(field(host, "brightness"), "500");
    await flush(4);
    expect(field(host, "brightness").value).toBe("200");
    // The same again: the recipe is already at the clamp, so no binding would fire on its own.
    setValue(field(host, "brightness"), "500");
    await flush(4);
    expect(field(host, "brightness").value).toBe("200");
  });
});

describe("the read-only refusal", () => {
  function readOnly(tab: Tab): void {
    const state = collabState(tab);
    state.active = true;
    state.readOnly = true;
  }

  test("is reached through all three callers, and writes nothing", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    readOnly(tab);
    // 1. The editor's own control.
    await press(host, "save");
    // 2. The chord, through saveFile.
    expect(await saveFile(tab)).toBe(false);
    // 3. The door itself, as the close prompt reaches it.
    expect(await saveImage(tab)).toBe(false);
    expect(bakes).toBe(0);
    expect(disk.get("public/hero.png")).toEqual(PNG);
    expect(shouldWarnOnClose(tab)).toBe(true);
  });

  test("withholds the editor from a collaborator who cannot write the path's own tab", async () => {
    await openFileInTab("public/hero.png");
    const tab = workspace.tabs.get("public/hero.png")!;
    readOnly(tab);
    expect(openImageEditor("public/hero.png")).toBeNull();
    expect(tab.session.ui.canvasMode).not.toBe(IMAGE_MODE);
    expect(canEditImage("public/hero.png")).toBe(false);
  });

  test("the button that writes is disabled once the tab is read-only", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    expect(disabled(host, "save")).toBe(false);
    readOnly(tab);
    await flush(4);
    expect(disabled(host, "save")).toBe(true);
  });
});

describe("the save chord and the close prompt", () => {
  test("⌘S in the editor delegates to the image door; in the viewer it still refuses", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    expect(await saveFile(tab)).toBe(true);
    expect(bakes).toBe(1);
    tab.session.ui.canvasMode = MEDIA_MODE;
    expect(await saveFile(tab)).toBe(false);
    expect(
      said("public/hero.png is a media file, so there is no document for Save to write."),
    ).toBe(true);
  });

  test("a pending edit left behind in the viewer is still what ⌘S writes", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    tab.session.ui.canvasMode = MEDIA_MODE;
    expect(await saveFile(tab)).toBe(true);
    expect(bakes).toBe(1);
  });

  test("an image edit is a reason to ask on close, with or without peers", async () => {
    const { host, tab } = await open();
    expect(shouldWarnOnClose(tab)).toBe(false);
    await press(host, "flip-h");
    expect(shouldWarnOnClose(tab)).toBe(true);
    const state = collabState(tab);
    state.active = true;
    const peer: PeerPresence = {
      clientId: 2,
      state: {
        focusedPath: "public/hero.png",
        structuralSelection: null,
        user: { color: "#123456", login: "ada" },
      },
    };
    state.peers = [peer];
    // A recipe was never published: no peer focused on the path holds a copy of it.
    expect(shouldWarnOnClose(tab)).toBe(true);
  });
});

describe("the tab it belongs to", () => {
  test("a pending edit is what makes the Save chord enabled: `file.save` is gated on dirty", async () => {
    const { host } = await open();
    const context = createLiveContext({
      aiConfigured: () => false,
      canvasMode: () => IMAGE_MODE,
      isCaretActive: () => false,
      isModalOpen: () => false,
      platform: () => null,
    });
    expect(context().document.dirty).toBe(false);
    expect(context().editor.kind).toBe("image");
    await press(host, "flip-h");
    expect(context().document.dirty).toBe(true);
  });

  test("stays in the Media workspace, whichever of its two modes it is in", async () => {
    // A mode this did not know would read as a page, and entering the editor would leave Media.
    const { tab } = await open();
    expect(workspaceOfTab(tab)).toBe("media");
    tab.session.ui.canvasMode = MEDIA_MODE;
    expect(workspaceOfTab(tab)).toBe("media");
  });

  test("⌘Z reaches the recipe: the tab's history is its edit, not its stub document", async () => {
    const { host, tab } = await open();
    expect(canUndo(tab)).toBe(false);
    await press(host, "flip-h");
    expect(canUndo(tab)).toBe(true);
    undo(tab);
    expect(imageEditorDirty(tab)).toBe(false);
    expect(canRedo(tab)).toBe(true);
    redo(tab);
    expect(imageEditorDirty(tab)).toBe(true);
    await flush(4);
    expect(disabled(host, "undo")).toBe(false);
  });

  test("undo and redo each wait for a save in flight rather than racing the write", async () => {
    const { host, tab } = await open();
    await press(host, "flip-h");
    await press(host, "flip-v");
    await press(host, "undo");
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    defineCreateBitmap(async () => {
      await held;
      const bitmap: ImageBitmap = { close: () => {}, height: 300, width: 400 };
      return bitmap;
    });
    const saving = saveImage(tab);
    await flush(2);
    expect(canUndo(tab)).toBe(false);
    expect(canRedo(tab)).toBe(false);
    const shown = () => part(host, "editor").style.getPropertyValue("--jx-image-transform");
    const during = shown();
    undo(tab);
    await flush(2);
    expect(shown()).toBe(during);
    redo(tab);
    await flush(2);
    expect(shown()).toBe(during);
    release();
    expect(await saving).toBe(true);
  });

  test("a preview tab with a pending edit stops being replaceable", async () => {
    const { host, tab } = await open();
    tab.preview = true;
    promoteDirtyPreviewTabs();
    expect(tab.preview).toBe(true);
    await press(host, "flip-h");
    expect(tabHoldsEditBesideDocument(tab)).toBe(true);
    promoteDirtyPreviewTabs();
    expect(tab.preview).toBe(false);
  });

  test("a viewer with a pending edit is not replaced by opening another picture", async () => {
    const { host, tab } = await open();
    await openFileInTab("public/anim.png");
    expect(viewsReplacedBy("primary", "public/anim.png", "media")).toContain(tab.id);
    await press(host, "flip-h");
    expect(viewsReplacedBy("primary", "public/anim.png", "media")).not.toContain(tab.id);
  });
});

describe("openImageEditor", () => {
  test("opens the file's tab in the Image editor", async () => {
    const tab = openImageEditor("public/hero.png");
    expect(tab?.session.ui.canvasMode).toBe(IMAGE_MODE);
    expect(workspace.tabs.get("public/hero.png")).toBeTruthy();
  });

  test("a tab whose bytes already withdrew the mode stays in its viewer and says why again", async () => {
    await openFileInTab("public/anim.png");
    await flush(4);
    const tab = workspace.tabs.get("public/anim.png")!;
    expect(tab.capabilities.modes).toEqual([MEDIA_MODE]);
    expect(canEditImage("public/anim.png")).toBe(false);
    expect(openImageEditor("public/anim.png")).toBeNull();
    expect(tab.session.ui.canvasMode).toBe(MEDIA_MODE);
    expect(said("This PNG is animated, and a bake would keep only its first frame.")).toBe(true);
  });

  test("the list's question: what the path says, and what its open tab has since learned", async () => {
    expect(canEditImage("public/hero.png")).toBe(true);
    expect(canEditImage("public/spin.gif")).toBe(false);
    await openFileInTab("public/hero.png");
    await flush(4);
    expect(canEditImage("public/hero.png")).toBe(true);
  });

  test("refuses a file the editor cannot write, with the reason", () => {
    expect(openImageEditor("public/anim.gif")).toBeNull();
    expect(said("anim.gif cannot be edited here.")).toBe(true);
  });
});

describe("the surface adapter", () => {
  test("a mount disposed before it renders is disposed when it lands, and reports detached", async () => {
    const view: ImageEditorView = {
      alt: "",
      aspect: "free",
      aspectOptions: [{ label: "Free", value: "free" }],
      brightness: "100",
      busy: true,
      cannotFit: true,
      cannotRedo: true,
      cannotSave: true,
      cannotUndo: true,
      clean: true,
      contrast: "100",
      cropH: "100%",
      cropW: "100%",
      cropX: "0%",
      cropY: "0%",
      facts: "",
      filter: "none",
      fitHint: "",
      fitLabel: "Fit for web",
      handleHelpId: "help",
      handles: [{ id: "n", label: "Top edge", tabindex: "0" }],
      imageHeight: "100%",
      imageTransform: "none",
      imageWidth: "100%",
      maxOutputWidth: "1",
      maxWidth: "1px",
      message: "",
      moveCursor: "default",
      name: "x.png",
      quality: "hidden",
      qualityValue: "90",
      ratio: "1",
      region: "",
      saturation: "100",
      saving: false,
      src: "",
      undecoded: false,
      status: "ready",
      warning: "",
      width: "1",
    };
    const noop = () => {};
    const actions: ImageEditorActions = {
      cycleHandle: noop,
      fieldEdited: noop,
      fitForWeb: noop,
      flip: noop,
      handleDown: noop,
      handleFocused: noop,
      handleMove: noop,
      handleUp: noop,
      imageFailed: noop,
      imageLoaded: noop,
      nudge: noop,
      redo: noop,
      reset: noop,
      rotate: noop,
      save: noop,
      setAspect: noop,
      setValue: noop,
      setWidth: noop,
      undo: noop,
    };
    const target = document.createElement("div");
    document.body.append(target);
    const surface = mountImageEditorSurface(target, view, actions);
    expect(surface.attached()).toBe(true);
    surface.dispose();
    expect(surface.attached()).toBe(false);
    await surface.ready;
    expect(target.querySelector('[part="editor"]')).toBeNull();
    // Nothing captured, so neither island answers.
    expect(surface.frameRect()).toBeNull();
    surface.focusHandle("n");
    expect(document.activeElement).toBe(document.body);
    // A field map emptied by the dispose gives the sync nothing to write to, and no throw.
    surface.syncFields(view);
  });
});
