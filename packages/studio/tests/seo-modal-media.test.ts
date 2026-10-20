/**
 * Search appearance — the media row's two controls, and the edges around a commit.
 *
 * A file of its own because the project's media listing is cached for the life of the module, and
 * the states worth asserting are the ones either side of that cache: an empty project, the answer
 * it keeps, and the invalidation an upload forces. The order of the first three tests IS the
 * behaviour, which is why they are not independent and are not reset between.
 *
 * The rest are the windows a commit can land in and must not act on: a modal that has already
 * closed, and a keystroke that had not been written yet when it did.
 */
import {
  flush,
  installMockPlatform,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { close } from "@jxsuite/ui/behaviors/popover";
import { initShellRefs, registerRenderer } from "../src/store";
import { clearLayerSlot, initLayers } from "../src/ui/layers";
import { activeTab, closeAllTabs } from "../src/workspace/workspace";
import { invalidateLayoutHeadCache } from "../src/panels/head-panel";
import { invalidateLayoutCache } from "../src/site-context";
import { mountsOf } from "../src/services/surface-registry";
import { closeSeoModal, openSeoModal } from "../src/panels/seo-modal";
import { invalidateMediaCache } from "../src/ui/media-picker";
import { setMediaChangedHandler } from "../src/files/media-upload";
import type { MockPlatformState } from "./harness";

/** The surface's root, or null when it is not up. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#layer-dialog jx-dialog[part="seo"]');
}

function host(): HTMLElement {
  const el = dialog();
  if (!el) {
    throw new Error("the Search appearance surface is not open");
  }
  return el;
}

function row(prop: string): HTMLElement {
  const el = host().querySelector<HTMLElement>(`[data-prop="${prop}"]`);
  if (!el) {
    throw new Error(`row not found: ${prop}`);
  }
  return el;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The media picker's compact browser, which Browse opens over the modal. */
function browser(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#layer-popover jx-popover[part="media-browser"]');
}

/** The site URL each row of the open browser would commit. */
function browserPaths(): (string | undefined)[] {
  return [...(browser()?.querySelectorAll<HTMLElement>('[part="row"]') ?? [])].map(
    (el) => el.dataset.path,
  );
}

function browserEmptyLine(): string | undefined {
  return browser()?.querySelector('[part="empty"]')?.textContent.trim();
}

/** How many times the project tree has been walked. */
function scans(): number {
  return state.calls.filter(([name]) => name === "listDirectory").length;
}

// A frame is the next macrotask here; the handle is the timer's numeric id, as a browser's is.
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number =>
  Number(setTimeout(() => cb(0), 0));

let state: MockPlatformState;

function setShell() {
  document.body.innerHTML = `<div id="app">
    <div id="toolbar"></div>
    <div class="pane-stage" data-jx-region="pane.primary"></div>
    <div id="statusbar"></div>
  </div>
  <div id="layer-popover"></div><div id="layer-modal"></div>
  <div id="layer-dialog"></div><div id="layer-toast"></div>`;
  initShellRefs();
  initLayers();
  registerPrimaryStage();
}

/** A markdown-realm page, which is the realm both media controls commit through. */
function setupTab() {
  resetStudioState({ isSiteProject: false, projectConfig: {} });
  const tab = resetWorkspaceWithTab(undefined, {
    documentPath: "posts/hello.json",
    id: "seo-media-tab",
  });
  tab.doc.mode = "content";
  tab.doc.content.frontmatter = { title: "Hello" };
  return tab;
}

async function openOver(): Promise<void> {
  openSeoModal(activeTab.value!);
  await flush(6);
}

beforeEach(() => {
  setShell();
  clearLayerSlot("popover", "media-picker");
  ({ state } = installMockPlatform({
    uploadFile: async (path: string) => {
      // The backend really has it afterwards, so a re-scan can find what the upload put there.
      state.files.set(path, "png-bytes");
      return { path };
    },
  }));
  registerRenderer("seoModal", () => {});
  // What the app's bootstrap injects: an upload drops the media listing every chooser reads.
  setMediaChangedHandler(() => invalidateMediaCache());
  invalidateLayoutCache();
  invalidateLayoutHeadCache();
});

afterEach(async () => {
  /* Hide, THEN clear. A menu left standing keeps a `toggle` listener whose `finish()` clears the
     slot BY REGION — so one dismissed late, by the next test rebuilding the shell, takes that
     test's own menu down with it. In the app Browse is pressed from a modal that closes with it,
     so this is a fixture's state rather than a defect's. */
  const open = browser();
  if (open) {
    close(open);
  }
  await flush(2);
  clearLayerSlot("popover", "media-picker");
  setMediaChangedHandler(null);
  closeSeoModal();
  closeAllTabs();
});

/**
 * Press Upload on a row and return the `<input type="file">` it made.
 *
 * The input is created per click and never put in the document — a node the surface owns outside
 * its own document is exactly what a surface may not have — so it is caught on the way out rather
 * than found afterwards.
 */
function pressUpload(prop: string): HTMLInputElement {
  const created = spyOn(document, "createElement");
  let inputs: HTMLInputElement[];
  try {
    click(row(prop).querySelector('[part="upload"]')!);
  } finally {
    // Read before restoring: a restore resets the spy's record along with the method.
    inputs = created.mock.results.flatMap((result) =>
      result.type === "return" && result.value instanceof HTMLInputElement ? [result.value] : [],
    );
    created.mockRestore();
  }
  const input = inputs.at(-1);
  if (!input) {
    throw new Error(`Upload on "${prop}" opened no file input`);
  }
  return input;
}

/** Answer the picker with `files`, the way the platform does when the reader is done with it. */
function answerPicker(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new Event("change"));
}

describe("Browse, and the listing it keeps", () => {
  test("Browse opens the media picker's own browser, which says the project has no images", async () => {
    /* Not a list of the dialog's own: the field's browser, a top-layer popover that paints over the
       modal, so the dialog and every image field answer from one listing (studio.md §9.3). */
    setupTab();
    await openOver();
    click(row("og:image").querySelector('[part="browse"]')!);
    await flush(8);

    expect(browser()).not.toBeNull();
    expect(browserPaths()).toEqual([]);
    expect(browserEmptyLine()).toBe("No images in this project yet");
    // The row that opens the full-size picker, narrowed to images because the field holds one.
    expect(browser()?.querySelector('[part="browse-all"]')?.textContent.trim()).toBe(
      "Browse all images…",
    );
    expect(scans()).toBeGreaterThan(0);
  });

  test("a second Browse answers from the listing it already has", async () => {
    /* The scan walks `public/` and every collection's images in full, so it is done once and
       remembered. Only a change to the media (an upload) invalidates it. */
    setupTab();
    state.files.set("public/hero.png", "png-bytes");
    await openOver();
    const before = scans();
    click(row("og:image").querySelector('[part="browse"]')!);
    await flush(8);

    expect(scans()).toBe(before);
    // Still the previous test's answer, because the tree was never walked again.
    expect(browserEmptyLine()).toBe("No images in this project yet");
  });

  test("a pick commits the file's site URL into the row", async () => {
    const tab = setupTab();
    invalidateMediaCache();
    state.files.set("public/media/hero.png", "png-bytes");
    await openOver();
    click(row("og:image").querySelector('[part="browse"]')!);
    await flush(8);
    expect(browserPaths()).toEqual(["/media/hero.png"]);
    click(browser()!.querySelector('[part="row"]')!);
    await flush(6);
    expect(tab.doc.content.frontmatter["$head"]).toEqual([
      { attributes: { content: "/media/hero.png", property: "og:image" }, tagName: "meta" },
    ]);
  });
});

describe("Upload", () => {
  test("commits the uploaded file's ref into the row, and forgets the cached listing", async () => {
    const tab = setupTab();
    await openOver();

    const input = pressUpload("og:image");
    expect(input.type).toBe("file");
    // Several at once, filtered to what the project treats as media.
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain("image/*");

    answerPicker(input, [new File(["png-bytes"], "card.png", { type: "image/png" })]);
    await flush(8);

    // The first file of the batch lands in the row that asked for it, as the ref production serves.
    expect(tab.doc.content.frontmatter["$head"]).toEqual([
      { attributes: { content: "/media/card.png", property: "og:image" }, tagName: "meta" },
    ]);

    // And the listing is forgotten: the tree it was derived from has just changed.
    const before = scans();
    click(row("og:image").querySelector('[part="browse"]')!);
    await flush(8);
    expect(scans()).toBeGreaterThan(before);
    expect(browserPaths()).toEqual(["/media/card.png"]);
  });

  test("an upload that lands after the modal closed writes nothing", async () => {
    /* The picker is the operating system's, so the reader can close the modal while it is open —
       and the commit would then be written into a document nothing is looking at. */
    const tab = setupTab();
    await openOver();

    const input = pressUpload("og:image");
    closeSeoModal();
    answerPicker(input, [new File(["png-bytes"], "late.png", { type: "image/png" })]);
    await flush(8);

    expect(dialog()).toBeNull();
    expect(tab.doc.content.frontmatter["$head"]).toBeUndefined();
  });

  test("a change event with no file at all does nothing", async () => {
    // Cancelling the OS picker fires `change` with an empty list on some platforms.
    const tab = setupTab();
    await openOver();

    answerPicker(pressUpload("icon"), []);
    await flush(6);
    expect(tab.doc.content.frontmatter["$head"]).toBeUndefined();
  });
});

describe("what a close cancels", () => {
  test("a keystroke that had not been written yet is forgotten", async () => {
    /* Every commit is a document mutation and the previews repaint from it, so a keystroke waits
       300ms before it is written. A close in that window has to cancel the timer: the document the
       write names is one the reader has already stopped looking at. */
    const tab = setupTab();
    await openOver();
    const field = row("description").querySelector<HTMLInputElement>('[part="input"]')!;
    field.value = "half a sentence";
    field.dispatchEvent(new Event("input", { bubbles: true }));

    closeSeoModal();
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    expect(tab.doc.content.frontmatter["$head"]).toBeUndefined();
  });

  test("closing before the mount lands leaves nothing behind", async () => {
    /* Synchronous, so the document has not mounted: `close()` finds no element, and the branch that
       has to clean up is the one inside the mount's own `then`. */
    setupTab();
    openSeoModal(activeTab.value!);
    closeSeoModal();
    await flush(6);

    expect(dialog()).toBeNull();
    expect(document.querySelector("#layer-dialog")!.childElementCount).toBe(0);
    // Disposed rather than orphaned: a mount left registered keeps a live scope and a detached DOM.
    expect(mountsOf("seo")).toHaveLength(0);
  });
});
