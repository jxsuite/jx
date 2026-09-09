/**
 * Tests for src/editor/convert-to-component.ts — extract selection into a reusable component.
 *
 * The naming dialog is `showPromptDialog`, which is a document over the kit
 * (`surfaces/dialog.json`) rather than a wrapper this module renders: there is no `sp-textfield` to
 * find any more and no `sp-help-text`, so the field is addressed as `jx-textfield`'s own
 * `[part="input"]` and the refusal as its `[part="error"]`. What this file asserts is unchanged,
 * because what this module owns is unchanged: the default name, what makes a name usable, whether
 * the document took the reference, and what is written to disk once it has.
 */
import {
  flush,
  installMockPlatform,
  resetStudioState,
  resetWorkspaceWithTab,
  topDialog,
} from "./harness";
import type { MockPlatformState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { convertToComponent } from "../src/editor/convert-to-component";
import { componentRegistry } from "../src/files/components";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import { initLayers } from "../src/ui/layers";
import { activeTab } from "../src/workspace/workspace";
import { setTransactGate } from "../src/tabs/transact";
import type { Tab } from "../src/tabs/tab";

// ─── Environment ──────────────────────────────────────────────────────────────

globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  setTimeout(() => cb(0), 0);
  return 0;
}) as typeof requestAnimationFrame;

// ExtractComponentDef must clone the selected node even though it is a @vue/reactivity proxy
// (structuredClone rejects proxies with DataCloneError; src uses jsonClone). No stubs here —
// These tests exercise the real clone path against reactive tab state.

let tab: Tab;
let platformState: MockPlatformState;

function freshDoc() {
  return {
    children: [
      {
        $id: "Hero-Block",
        children: [{ tagName: "h1", textContent: "Title" }],
        tagName: "section",
      },
      { tagName: "p", textContent: "after" },
    ],
    tagName: "div",
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  for (const id of ["layer-popover", "layer-modal", "layer-dialog"]) {
    const layer = document.createElement("div");
    layer.id = id;
    document.body.append(layer);
  }
  initLayers();
  resetStudioState();
  ({ state: platformState } = installMockPlatform());
  componentRegistry.length = 0;
  tab = resetWorkspaceWithTab(freshDoc());
});

/** The dialog itself, which is the prompt surface's root. */
function dialog(): HTMLElement | null {
  return topDialog();
}

/** The field's native input: what a reader types into, and what the element listens to. */
function nameInput(): HTMLInputElement | null {
  return dialog()?.querySelector<HTMLInputElement>('jx-textfield [part="input"]') ?? null;
}

function setName(value: string) {
  const input = nameInput()!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function confirmDialog() {
  dialog()!.dispatchEvent(new Event("confirm"));
}

/** The refusal under the field, which is `jx-textfield`'s own error line. */
function errorText(): string {
  return dialog()?.querySelector('jx-textfield [part="error"]')?.textContent?.trim() ?? "";
}

/**
 * Start a conversion and wait for the dialog to be up.
 *
 * The pending conversion comes back WRAPPED: an async helper that returned the promise itself would
 * have the caller's `await` adopt it, and every test would hang on the answer it has not given
 * yet.
 */
async function startDialog(): Promise<{ done: Promise<void> }> {
  const done = convertToComponent();
  await flush(3);
  return { done };
}

// ─── Early returns ────────────────────────────────────────────────────────────

describe("guards", () => {
  test("no selection → resolves without showing a dialog", async () => {
    tab.session.selection = [];
    await convertToComponent();
    expect(dialog()).toBeNull();
  });

  test("root selection → no dialog", async () => {
    tab.session.selection = [[]];
    await convertToComponent();
    expect(dialog()).toBeNull();
  });

  test("node without tagName → no dialog", async () => {
    (tab.doc.document.children as unknown[])[0] = { textContent: "bare" };
    tab.session.selection = [["children", 0]];
    await convertToComponent();
    expect(dialog()).toBeNull();
  });
});

// ─── The dialog is Studio's one prompt ────────────────────────────────────────

describe("the surface", () => {
  test("is the kit's prompt, headline and sentence and all — nothing here draws a box", async () => {
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    expect(dialog()?.tagName.toLowerCase()).toBe("jx-dialog");
    expect(dialog()?.querySelector('[part="headline"]')?.textContent).toBe("Convert to Component");
    expect(dialog()?.querySelector('[part="message"]')?.textContent).toContain(
      "hyphenated tag name",
    );
    expect(document.querySelector("#layer-dialog sp-dialog-wrapper")).toBeNull();
    expect(document.querySelector("#layer-dialog sp-underlay")).toBeNull();
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });
});

// ─── Default name derivation ──────────────────────────────────────────────────

describe("default name", () => {
  test("hyphenated $id becomes the default name", async () => {
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    expect(nameInput()?.value).toBe("hero-block");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("plain tag gets a jx- prefix", async () => {
    tab.session.selection = [["children", 1]];
    const { done } = await startDialog();
    expect(nameInput()?.value).toBe("jx-p");
    dialog()!.dispatchEvent(new Event("close"));
    await done;
  });

  test("hyphenated tag is used directly", async () => {
    (tab.doc.document.children as unknown[])[1] = { tagName: "fancy-card" };
    tab.session.selection = [["children", 1]];
    const { done } = await startDialog();
    expect(nameInput()?.value).toBe("fancy-card");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });
});

// ─── Conversion flow ──────────────────────────────────────────────────────────

describe("conversion", () => {
  test("confirm replaces the node, adds the $ref, and writes the component file", async () => {
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();

    setName("hero-block");
    confirmDialog();
    await done;

    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.children as unknown[])[0]).toEqual({ tagName: "hero-block" });
    expect(doc.$elements).toEqual([{ $ref: "../components/hero-block.json" }]);

    const write = platformState.calls.find((c) => c[0] === "writeFile");
    expect(write).toBeDefined();
    expect(write![1]).toBe("components/hero-block.json");
    const written = JSON.parse(write![2] as string);
    expect(written.tagName).toBe("hero-block");
    expect(written.$id).toBeUndefined();
    expect(written.children).toEqual([{ tagName: "h1", textContent: "Title" }]);
    // Registry refresh was requested
    expect(platformState.calls.some((c) => c[0] === "discoverComponents")).toBe(true);
  });

  test("converting a second time does not duplicate the $ref", async () => {
    const doc = tab.doc.document as Record<string, unknown>;
    doc.$elements = [{ $ref: "../components/hero-block.json" }];
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    setName("hero-block");
    confirmDialog();
    await done;
    expect(doc.$elements).toEqual([{ $ref: "../components/hero-block.json" }]);
  });

  test("cancel leaves the document untouched", async () => {
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;

    const doc = tab.doc.document as Record<string, unknown>;
    expect(((doc.children as unknown[])[0] as Record<string, unknown>).tagName).toBe("section");
    expect(doc.$elements).toBeUndefined();
    expect(platformState.calls.some((c) => c[0] === "writeFile")).toBe(false);
  });

  test("a slot defect is filed as a Problem, not shouted once and lost", async () => {
    // The component IS written and usable, so this is not an error — but two default slots is a
    // Thing to FIX, so it persists in Problems until somebody does, rather than expiring as a toast.
    resetNotifications();
    tab.doc.document = {
      children: [
        {
          $id: "Hero-Block",
          children: [{ tagName: "slot" }, { tagName: "slot" }],
          tagName: "section",
        },
      ],
      tagName: "div",
    } as never;
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    setName("slotty-block");
    confirmDialog();
    await done;

    expect(toasts.some((n) => n.message === "Converted to <slotty-block>")).toBe(true);
    const problem = problems.find((n) => n.message.includes("slotty-block"));
    expect(problem?.severity).toBe("warn");
    expect(problem?.message).toContain("slot problem");
    expect(problem?.source).toBe("Components");
    expect(problem?.path).toBe("components/slotty-block.json");
  });

  test("a failing write is caught and still leaves the document converted", async () => {
    installMockPlatform({
      writeFile: async () => {
        throw new Error("disk full");
      },
    });
    tab.session.selection = [["children", 0]];
    const { done } = await startDialog();
    setName("hero-block");
    confirmDialog();
    await done; // Resolves despite the write error
    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.children as unknown[])[0]).toEqual({ tagName: "hero-block" });
  });
});

// ─── Name validation ──────────────────────────────────────────────────────────

describe("name validation", () => {
  async function start() {
    tab.session.selection = [["children", 0]];
    return startDialog();
  }

  test("missing hyphen shows an error and keeps the dialog open", async () => {
    const { done } = await start();
    setName("plainname");
    confirmDialog();
    await flush();
    expect(dialog()).not.toBeNull();
    expect(errorText()).toContain("hyphen");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("invalid characters show the naming-rule error", async () => {
    const { done } = await start();
    setName("my--comp");
    confirmDialog();
    await flush();
    expect(dialog()).not.toBeNull();
    expect(errorText()).toContain("Lowercase");
    // `invalid` is what says aria-invalid on the control and draws it in the danger colour.
    expect(nameInput()?.getAttribute("aria-invalid")).toBe("true");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("existing component name is rejected", async () => {
    componentRegistry.push({ tagName: "taken-name" } as never);
    const { done } = await start();
    setName("taken-name");
    confirmDialog();
    await flush();
    expect(dialog()).not.toBeNull();
    expect(errorText()).toContain("already exists");
    dialog()!.dispatchEvent(new Event("cancel"));
    await done;
  });

  test("live input feedback clears once the name becomes valid", async () => {
    const { done } = await start();
    setName("bad");
    await flush();
    expect(errorText()).toContain("hyphen");
    setName("good-name");
    await flush();
    expect(errorText()).toBe("");
    confirmDialog();
    await done;
    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.children as unknown[])[0]).toEqual({ tagName: "good-name" });
  });

  test("Enter in the field confirms", async () => {
    const { done } = await start();
    setName("enter-name");
    nameInput()!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await done;
    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.children as unknown[])[0]).toEqual({ tagName: "enter-name" });
  });

  test("uppercase input is normalized to lowercase", async () => {
    const { done } = await start();
    setName("  My-Widget ");
    confirmDialog();
    await done;
    const doc = tab.doc.document as Record<string, unknown>;
    expect((doc.children as unknown[])[0]).toEqual({ tagName: "my-widget" });
    expect(activeTab.value!.doc.dirty).toBe(true);
  });
});

/**
 * A DISK WRITE THAT ASSUMED THE DOCUMENT HAD TAKEN THE REFERENCE.
 *
 * `transact` consults the collab gate, which pauses structural editing for the whole room while
 * source is canonical, and returned nothing to say so. The extraction carried on: the component
 * file was written, the registry reloaded, and "Converted to <name>" appeared — over a document
 * that still held the original markup. An orphan file, and an author told the opposite.
 */
describe("a refused conversion", () => {
  test("writes no file and claims no success", async () => {
    resetNotifications();
    tab.session.selection = [["children", 0]];
    const before = JSON.stringify(tab.doc.document);
    const { done } = await startDialog();
    setName("frozen-widget");
    setTransactGate(() => "source-canonical");
    try {
      confirmDialog();
      await done;
    } finally {
      setTransactGate(null);
    }

    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(platformState.files.has("components/frozen-widget.json")).toBe(false);
    // The gate raises its own keyed toast; this path adds no claim of its own beside it.
    expect(toasts.some((t) => t.message.startsWith("Converted to"))).toBe(false);
    expect(problems).toHaveLength(0);
  });
});
