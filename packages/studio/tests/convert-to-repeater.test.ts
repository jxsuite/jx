/**
 * Tests for the Repeat… flow — `src/editor/convert-to-repeater.ts` and
 * `src/surfaces/convert-repeater.json`.
 *
 * Everything is addressed by `part` and by the native controls inside the kit elements, because the
 * dialog is a document: there is no `sp-picker[label="Items source"]` to find any more, and no
 * `sp-help-text` either. The box, the backdrop, Escape and the two buttons all belong to
 * `jx-dialog`; a pick is written into the `<select>` the reader would have moved, which is the only
 * spelling that tells the surface anything.
 *
 * Monaco (pulled in transitively via code-services) is mocked.
 */
import {
  flush,
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Tab } from "../src/tabs/tab";

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (url: string) => ({ toString: () => url }) },
  editor: { setModelMarkers: mock(() => {}) },
  languages: { registerCompletionItemProvider: mock(() => {}) },
}));

const { convertToRepeater } = await import("../src/editor/convert-to-repeater");
const { openConvertRepeaterSurface } = await import("../src/surfaces/convert-repeater");
const { initLayers } = await import("../src/ui/layers");
const { pluginSchemaCache } = await import("../src/services/code-services");

// ─── Environment ──────────────────────────────────────────────────────────────

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
}) as typeof requestAnimationFrame;

let tab: Tab;

function makeDoc(state: Record<string, unknown> | undefined) {
  return {
    children: [{ tagName: "li", textContent: "Item" }],
    ...(state !== undefined && { state }),
    tagName: "ul",
  };
}

function setup(state: Record<string, unknown> | undefined) {
  document.body.innerHTML = "";
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    const layer = document.createElement("div");
    layer.id = id;
    document.body.append(layer);
  }
  initLayers();
  resetStudioState();
  installMockPlatform();
  pluginSchemaCache.clear();
  tab = resetWorkspaceWithTab(makeDoc(state) as never);
  tab.session.selection = [["children", 0]];
}

beforeEach(() => {
  setup({ rows: { default: [], type: "array" } });
});

/** The dialog itself, which is the surface's root. */
function dialog(): HTMLElement | null {
  return topDialog();
}

function part<T extends Element = HTMLElement>(name: string): T | null {
  return dialog()?.querySelector<T>(`[part="${name}"]`) ?? null;
}

/** A picker's own `<select>`: what the reader moves, and what the element listens to. */
function control(name: string): HTMLSelectElement | null {
  return dialog()?.querySelector<HTMLSelectElement>(`[part="${name}"] select`) ?? null;
}

/** The rows a picker offers, as `[value, label]`. */
function options(name: string): [string, string][] {
  return [...(dialog()?.querySelectorAll<HTMLOptionElement>(`[part="${name}"] option`) ?? [])]
    .filter((el) => el.getAttribute("part") !== "unlisted")
    .map((el) => [el.value, el.textContent?.trim() ?? ""]);
}

async function pick(name: string, value: string) {
  const select = control(name)!;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

/** The name field's native input, which is the node a reader types into. */
function nameInput(): HTMLInputElement | null {
  return dialog()?.querySelector<HTMLInputElement>('[part="new-name"] [part="input"]') ?? null;
}

async function setNewName(value: string) {
  const input = nameInput()!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

function confirmDialog() {
  dialog()!.dispatchEvent(new Event("confirm"));
}

/** The refusal under the name field, which is `jx-textfield`'s own error line. */
function errorText(): string {
  return dialog()?.querySelector('[part="new-name"] [part="error"]')?.textContent?.trim() ?? "";
}

function child0() {
  return (tab.doc.document.children as Record<string, unknown>[])[0];
}

/**
 * Open the dialog and wait for the kit element to render its own template.
 *
 * The pending conversion comes back WRAPPED, deliberately: an async helper that returned the
 * promise itself would have the caller's `await` adopt it, so every test would hang on the answer
 * it has not given yet.
 */
async function open(): Promise<{ done: Promise<void> }> {
  const done = convertToRepeater();
  await flush(3);
  return { done };
}

// ─── Guards ───────────────────────────────────────────────────────────────────

describe("guards", () => {
  test("no selection → no dialog", async () => {
    tab.session.selection = [];
    await convertToRepeater();
    expect(dialog()).toBeNull();
  });

  test("missing node → no dialog", async () => {
    tab.session.selection = [["children", 9]];
    await convertToRepeater();
    expect(dialog()).toBeNull();
  });
});

// ─── The dialog is the kit's ──────────────────────────────────────────────────

describe("the surface", () => {
  test("is a jx-dialog with the kit's headline, and paints no box of its own", async () => {
    const { done } = await open();
    expect(dialog()?.tagName.toLowerCase()).toBe("jx-dialog");
    expect(dialog()?.getAttribute("part")).toBe("convert-repeater");
    expect(part("headline")?.textContent).toBe("Repeat…");
    expect(document.querySelector("#layer-dialog sp-dialog-wrapper")).toBeNull();
    expect(document.querySelector("#layer-dialog sp-underlay")).toBeNull();
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("the slot carries the dialog layer's region id", async () => {
    const { done } = await open();
    const slot = document.querySelector<HTMLElement>("#layer-dialog [data-jx-region]");
    expect(slot?.dataset.jxRegion).toBe("overlay.dialog:convert-repeater");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
    expect(document.querySelector("#layer-dialog [data-jx-region]")).toBeNull();
  });

  test("the source picker offers every array def and the create-new row last", async () => {
    setup({ extra: { default: [1, 2] }, rows: { default: [], type: "array" } });
    const { done } = await open();
    expect(options("source")).toEqual([
      ["extra", "extra"],
      ["rows", "rows"],
      ["__new__", "Create new…"],
    ]);
    // No functions in this document, so neither optional row is drawn at all.
    expect(part("filter")).toBeNull();
    expect(part("sort")).toBeNull();
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });
});

// ─── Existing array source ────────────────────────────────────────────────────

describe("existing array defs", () => {
  test("confirm replaces the element in place with an Array repeater (no wrapper div)", async () => {
    const { done } = await open();
    expect(dialog()).not.toBeNull();
    confirmDialog();
    await done;

    // The selected element becomes the array node directly — no throwaway <div> wrapper.
    const repeater = child0()!;
    expect(repeater.tagName).toBeUndefined();
    expect(repeater.$prototype).toBe("Array");
    expect(repeater.items).toEqual({ $ref: "#/state/rows" });
    expect((repeater.map as Record<string, unknown>).tagName).toBe("li");
    expect(repeater.filter).toBeUndefined();
    expect(repeater.sort).toBeUndefined();
    expect(tab.doc.dirty).toBe(true);
  });

  test("cancel makes no changes", async () => {
    const { done } = await open();
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
    expect(child0()).toEqual({ tagName: "li", textContent: "Item" });
    expect(tab.doc.dirty).toBe(false);
    // The platform's own close takes the slot with it.
    expect(dialog()).toBeNull();
  });

  test("the platform's close resolves the same as cancel", async () => {
    const { done } = await open();
    dialog()!.dispatchEvent(new Event("close"));
    await done;
    expect(child0()).toEqual({ tagName: "li", textContent: "Item" });
  });

  test("defs with array defaults are offered as sources", async () => {
    setup({ extra: { default: [1, 2] }, rows: { default: [], type: "array" } });
    const { done } = await open();
    await pick("source", "extra");
    confirmDialog();
    await done;
    expect((child0() as Record<string, unknown>).items).toEqual({
      $ref: "#/state/extra",
    });
  });

  test("function defs enable filter and sort pickers, and None clears one again", async () => {
    setup({
      byDate: { $prototype: "Function", arguments: "a, b", body: "return 0" },
      rows: { default: [], type: "array" },
    });
    const { done } = await open();
    expect(options("filter")).toEqual([
      ["", "None"],
      ["byDate", "byDate"],
    ]);
    await pick("filter", "byDate");
    await pick("sort", "byDate");
    await pick("sort", "");
    confirmDialog();
    await done;

    const repeater = child0() as Record<string, unknown>;
    expect(repeater.filter).toEqual({ $ref: "#/state/byDate" });
    expect(repeater.sort).toBeUndefined();
  });

  test("plugin defs whose schema returns an array become sources", async () => {
    setup({ feed: { $prototype: "Fetch", $src: "./feed.js" } });
    installMockPlatform({
      fetchPluginSchema: async () => ({ returns: { type: "array" } }),
    } as never);
    pluginSchemaCache.clear();
    const { done } = await open();
    confirmDialog();
    await done;
    expect((child0() as Record<string, unknown>).items).toEqual({
      $ref: "#/state/feed",
    });
  });

  test("plugin defs without an array schema are skipped", async () => {
    setup({ thing: { $prototype: "Fetch", $src: "./thing.js" } });
    const { done } = await open();
    // No array defs → the dialog opens on the create-new row, so the name field is drawn.
    expect(nameInput()).not.toBeNull();
    expect(options("source")).toEqual([["__new__", "Create new…"]]);
    dialog()!.dispatchEvent(new Event("close"));
    await done;
  });
});

// ─── Create-new definition ────────────────────────────────────────────────────

describe("create new definition", () => {
  beforeEach(() => {
    setup({ taken: { default: "x" } });
  });

  test("empty name shows an error and keeps the dialog open", async () => {
    const { done } = await open();
    confirmDialog();
    await flush();
    expect(dialog()).not.toBeNull();
    expect(errorText()).toContain("Enter a name");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("refusing the same thing twice says it again", async () => {
    /* A live region announces a CHANGE, so a second refusal carrying the same sentence would be a
       reactive write the runtime skips — and a reader who pressed the button again would be told
       nothing at all. The surface clears the line first, on its own turn. */
    const { done } = await open();
    confirmDialog();
    await flush();
    expect(errorText()).toContain("Enter a name");
    confirmDialog();
    // Mid-bounce: the line is empty, which is what makes the re-write a change.
    expect(errorText()).toBe("");
    await flush();
    expect(errorText()).toContain("Enter a name");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("existing def name is rejected", async () => {
    const { done } = await open();
    await setNewName("taken");
    confirmDialog();
    await flush();
    expect(errorText()).toContain("already exists");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("invalid identifier is rejected, and the row says so too", async () => {
    const { done } = await open();
    await setNewName("1bad name");
    confirmDialog();
    await flush();
    expect(errorText()).toContain("Invalid identifier");
    // `invalid` is what draws the field and its label in the danger colour and says aria-invalid.
    expect(nameInput()?.getAttribute("aria-invalid")).toBe("true");
    expect(part("new-row")?.dataset.invalid).toBe("");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("a keystroke retires the refusal it is answering", async () => {
    const { done } = await open();
    confirmDialog();
    await flush();
    expect(errorText()).toContain("Enter a name");
    await setNewName("m");
    expect(errorText()).toBe("");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("valid name creates the state def and binds the repeater to it", async () => {
    const { done } = await open();
    await setNewName("myList");
    confirmDialog();
    await done;

    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.state as Record<string, unknown>).myList).toEqual({
      default: [],
      type: "array",
    });
    expect((child0() as Record<string, unknown>).items).toEqual({
      $ref: "#/state/myList",
    });
  });

  test("Enter in the name field confirms", async () => {
    const { done } = await open();
    await setNewName("byKey");
    nameInput()!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await done;
    expect((child0() as Record<string, unknown>).items).toEqual({
      $ref: "#/state/byKey",
    });
  });

  test("switching the source picker to create-new reveals the name field", async () => {
    setup({ rows: { default: [], type: "array" } });
    const { done } = await open();
    expect(nameInput()).toBeNull();
    await pick("source", "__new__");
    expect(nameInput()).not.toBeNull();
    await setNewName("fresh");
    confirmDialog();
    await done;
    expect((child0() as Record<string, unknown>).items).toEqual({
      $ref: "#/state/fresh",
    });
  });

  test("document without state gets one created", async () => {
    setup(undefined);
    const { done } = await open();
    await setNewName("brandNew");
    confirmDialog();
    await done;
    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.state as Record<string, unknown>).brandNew).toEqual({
      default: [],
      type: "array",
    });
  });

  test("a new definition keeps the optional filter and sort beside it", async () => {
    setup({
      byDate: { $prototype: "Function", arguments: "a, b", body: "return 0" },
    });
    const { done } = await open();
    await pick("filter", "byDate");
    await setNewName("fresh");
    confirmDialog();
    await done;
    const repeater = child0() as Record<string, unknown>;
    expect(repeater.items).toEqual({ $ref: "#/state/fresh" });
    expect(repeater.filter).toEqual({ $ref: "#/state/byDate" });
  });
});

// ─── The mount ────────────────────────────────────────────────────────────────

describe("the mount", () => {
  /** The surface with every answer stubbed, so the mount itself is what is under test. */
  function openBare(onClosed: () => void) {
    return openConvertRepeaterSurface({
      layer: document.querySelector("#layer-dialog") as HTMLElement,
      onClosed,
      onConfirm: () => {},
      onName: () => {},
      onPickFilter: () => {},
      onPickSort: () => {},
      onPickSource: () => {},
      view: {
        error: "",
        filter: "",
        functions: [],
        newName: "",
        sort: "",
        source: "__new__",
        sources: [],
      },
    });
  }

  test("closing before the mount lands leaves nothing in the layer", async () => {
    /* `mountSurface` is a promise, so a caller can answer before the document exists — a command
       invoked twice, or a flow that gives up. The slot is removed on the spot and the mount is
       disposed when it arrives, rather than a dialog appearing after the thing that wanted it. */
    let closes = 0;
    const handle = openBare(() => {
      closes += 1;
    });
    handle.close();
    await handle.ready;
    await flush(3);
    expect(document.querySelector("#layer-dialog")?.children.length).toBe(0);
    expect(dialog()).toBeNull();
    // Said once: `close()` on a dialog that never showed raises no platform `close` to say it again.
    expect(closes).toBe(1);
  });

  test("a dismissal in the same turn as a reveal does not chase a field that is gone", async () => {
    /* Picking `Create new…` schedules the caret into the field it reveals. Dismissing before that
       lands used to be a focus move into a disposed document; the move now finds no mount and
       stops, which is why it reads `mounted` rather than closing over the element. */
    const { done } = await open();
    const select = control("source")!;
    select.value = "__new__";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
    await flush(2);
    expect(dialog()).toBeNull();
  });
});
