/**
 * Coverage-gap tests for the editor helpers:
 *
 * - Inline-edit-apply: unchanged rich-children commits, split with rich/empty after-content, split
 *   with rich before-content, slash-swap onto tags without seed text, slash-insert with rich
 *   pending content.
 * - Convert-to-repeater: Enter-key confirm in the new-definition field, and the guard for documents
 *   whose selection parent has no children array.
 * - Context-menu: text/html clipboard content that converts to nothing (text/plain fallback) and
 *   pasting onto a dangling selection.
 */
import { flush, resetStudioState, resetWorkspaceWithTab, topDialog } from "./harness";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { notifyModule } from "./notify-mock";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxContentResult, SlashCommand } from "../src/editor/inline-edit";
import type { Tab } from "../src/tabs/tab";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** The element children of `node`; the fixtures here hold no text children at the top level. */
function elementChildren(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !children.every((child) => isNodeObject(child))) {
    throw new Error("expected an array of element children");
  }
  return children;
}

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (url: string) => ({ toString: () => url }) },
  editor: { setModelMarkers: mock(() => {}) },
  languages: { registerCompletionItemProvider: mock(() => {}) },
}));
void mock.module("../src/services/notify.js", () => notifyModule(() => {}));

const { applyInlineCommit, applyInlineInsert, applyInlineSplit } =
  await import("../src/editor/inline-edit-apply");
const { convertToRepeater } = await import("../src/editor/convert-to-repeater");
const { dismissContextMenu, pasteNode, showContextMenu } =
  await import("../src/editor/context-menu");
const { initLayers } = await import("../src/ui/layers");
const { activeTab, workspace } = await import("../src/workspace/workspace");

globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
};

// ─── Inline-edit apply ───────────────────────────────────────────────────────

describe("inline-edit apply gaps", () => {
  let tab: Tab;
  const RICH: (JxMutableNode | string)[] = ["a ", { tagName: "strong", textContent: "b" }];
  const kids = () => elementChildren(tab.doc.document);

  beforeEach(() => {
    resetStudioState();
    tab = resetWorkspaceWithTab({
      children: [{ children: structuredClone(RICH), tagName: "p" }],
      tagName: "div",
    });
  });

  test("committing identical rich children is a no-op", () => {
    applyInlineCommit(tab, ["children", 0], structuredClone(RICH), null);
    expect(tab.doc.dirty).toBe(false);
    expect(kids()[0]!.children).toEqual(RICH);
  });

  test("split keeps rich before-content and carries rich after-content into the new <p>", () => {
    const newPath = applyInlineSplit(
      tab,
      ["children", 0],
      { children: ["Hel"] },
      { children: ["lo ", { tagName: "em", textContent: "x" }] },
    );
    expect(newPath).toEqual(["children", 1]);
    expect(kids()[0]!.children).toEqual(["Hel"]);
    expect(kids()[0]!.textContent).toBeUndefined();
    expect(kids()[1]).toEqual({
      children: ["lo ", { tagName: "em", textContent: "x" }],
      tagName: "p",
    });
  });

  test("split with empty after-content seeds a blank paragraph", () => {
    applyInlineSplit(tab, ["children", 0], { textContent: "Left" }, {});
    expect(kids()[0]!.textContent).toBe("Left");
    expect(kids()[1]).toEqual({ tagName: "p", textContent: "" });
  });

  test("slash-swap onto a tag without seed text clears textContent", () => {
    tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "" }],
      tagName: "div",
    });
    const cmd: SlashCommand = { description: "", label: "Paragraph", tag: "p" };
    const path = applyInlineInsert(tab, ["children", 0], cmd, { textContent: "" });
    expect(path).toEqual(["children", 0]);
    expect(kids()[0]!.tagName).toBe("p");
    expect(kids()[0]!.textContent).toBeUndefined();
  });

  test("slash-insert commits rich pending children before inserting the new element", () => {
    const cmd: SlashCommand = { description: "", label: "Heading 2", tag: "h2" };
    const pending: JxContentResult = {
      children: ["kept ", { tagName: "strong", textContent: "rich" }],
    };
    const path = applyInlineInsert(tab, ["children", 0], cmd, pending);
    expect(path).toEqual(["children", 1]);
    expect(kids()[0]!.children).toEqual(pending.children);
    expect(kids()[1]!.tagName).toBe("h2");
  });
});

// ─── Convert to repeater ─────────────────────────────────────────────────────

describe("convert-to-repeater gaps", () => {
  function setupLayers() {
    document.body.innerHTML = "";
    for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
      const layer = document.createElement("div");
      layer.id = id;
      document.body.append(layer);
    }
    initLayers();
  }

  beforeEach(() => {
    setupLayers();
    resetStudioState();
  });

  test("Enter in the new-definition field confirms the dialog", async () => {
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "li", textContent: "Item" }],
      state: {},
      tagName: "ul",
    });
    tab.session.selection = [["children", 0]];

    const done = convertToRepeater();
    /* Three turns: the kit element registers, then the runtime renders its template. */
    await flush(3);
    const field = document.querySelector<HTMLInputElement>(
      '#layer-dialog [part="new-name"] [part="input"]',
    );
    expect(field).not.toBeNull();
    field!.value = "viaEnter";
    field!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    field!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await done;

    const doc = tab.doc.document;
    expect(doc.state?.viaEnter).toEqual({ default: [], type: "array" });
    const child = elementChildren(doc)[0]!;
    expect(child.$prototype).toBe("Array");
    expect(child.items).toEqual({ $ref: "#/state/viaEnter" });
  });

  test("a selection whose parent has no children array leaves the doc untouched", async () => {
    const tab = resetWorkspaceWithTab({
      meta: { x: { tagName: "span", textContent: "loose" } },
      state: { rows: { default: [], type: "array" } },
      tagName: "div",
    });
    tab.session.selection = [["meta", "x"]];

    const done = convertToRepeater();
    await flush();
    const dialog = topDialog()!;
    expect(dialog).not.toBeNull();
    dialog.dispatchEvent(new Event("confirm"));
    await done;

    expect(tab.doc.document.meta).toEqual({
      x: { tagName: "span", textContent: "loose" },
    });
  });
});

// ─── Context-menu clipboard ──────────────────────────────────────────────────

describe("context-menu clipboard gaps", () => {
  /** The members of a `ClipboardItem` that a paste reads. */
  type FakeReadItem = Pick<ClipboardItem, "getType" | "types">;
  let readResult: FakeReadItem[] | null = null;

  function fakeItem(parts: Record<string, string>): FakeReadItem {
    return {
      getType: (t: string) => Promise.resolve(new Blob([parts[t]!], { type: t })),
      types: Object.keys(parts),
    };
  }

  const originalClipboardDesc = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      read: () =>
        readResult
          ? Promise.resolve(readResult)
          : Promise.reject(new Error("clipboard read denied")),
    },
  });

  afterAll(() => {
    if (originalClipboardDesc) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDesc);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  beforeEach(() => {
    readResult = null;
    workspace.clipboard = null;
    resetStudioState();
    resetWorkspaceWithTab({
      children: [
        { tagName: "p", textContent: "A" },
        { tagName: "p", textContent: "B" },
      ],
      tagName: "div",
    });
  });

  function doc(): JxMutableNode {
    return activeTab.value!.doc.document;
  }

  test("text/html that converts to nothing falls through to text/plain", async () => {
    readResult = [fakeItem({ "text/html": "", "text/plain": "plain fallback" })];
    activeTab.value!.session.selection = [["children", 0]];
    await pasteNode();
    const children = elementChildren(doc());
    expect(children).toHaveLength(3);
    expect(children[1]).toMatchObject({ tagName: "p", textContent: "plain fallback" });
  });

  test("pasting onto a dangling selection is a no-op", async () => {
    readResult = [fakeItem({ "text/plain": "orphan" })];
    activeTab.value!.session.selection = [["children", 9]];
    await pasteNode();
    expect(doc().children).toHaveLength(2);
  });
});

// ─── Context-menu conversion actions ─────────────────────────────────────────

describe("context-menu conversion actions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
      const layer = document.createElement("div");
      layer.id = id;
      document.body.append(layer);
    }
    initLayers();
    resetStudioState();
    resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "A" }],
      state: { rows: { default: [], type: "array" } },
      tagName: "div",
    });
  });

  function clickItem(label: string) {
    const item = [...document.querySelectorAll("#layer-popover jx-menu-item")].find(
      (el) => el.querySelector('[part="label"]')?.textContent.trim() === label,
    );
    if (!(item instanceof HTMLElement)) {
      throw new TypeError(`no menu item labelled "${label}"`);
    }
    item.click();
  }

  /** Right-click the first child and wait for the menu surface to mount. */
  async function openMenu(): Promise<void> {
    const e = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    });
    showContextMenu(e, ["children", 0]);
    await flush();
  }

  test("Repeat... opens the repeater dialog (cancel leaves the doc untouched)", async () => {
    await openMenu();
    clickItem("Repeat...");
    await flush();
    const dialog = topDialog()!;
    expect(dialog).not.toBeNull();
    dialog!.dispatchEvent(new Event("cancel"));
    await flush();
    const child = elementChildren(activeTab.value!.doc.document)[0]!;
    expect(child.tagName).toBe("p");
    dismissContextMenu();
  });

  test("Convert to Component opens the name prompt (cancel leaves the doc untouched)", async () => {
    await openMenu();
    clickItem("Convert to Component");
    await flush();
    const dialog = topDialog()!;
    expect(dialog).not.toBeNull();
    dialog!.dispatchEvent(new Event("cancel"));
    await flush();
    const child = elementChildren(activeTab.value!.doc.document)[0]!;
    expect(child.tagName).toBe("p");
    dismissContextMenu();
  });
});
