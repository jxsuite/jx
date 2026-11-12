/**
 * What the Data panel says about the canvas (studio.md §5.6): the control that sets a plain entry's
 * value for the canvas, the mark a set value leaves on its row with the way back, and the standing
 * of an entry the canvas has no answer for.
 *
 * `canvas.setStateValue` is doubled by a record that writes the same tab state the real one does
 * (`canvas-view-commands.test.ts` tests the real one), so what is asserted here is what the panel
 * ASKS for and what it then draws.
 */
import {
  clearSignalPanels,
  commitText,
  control,
  docState,
  drawSignals,
  entryRow,
  fieldProps,
  marked,
  nativeInput,
  nativeSelect,
  openEntry,
  pick,
  settle,
  summaryText,
  summaryTone,
} from "./signals-panel-fixture";
import { installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { activeTab } from "../src/workspace/workspace";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext } from "../src/commands/context";
import type { CommandArgValues } from "../src/commands/command-args";
import type { MountedSignals } from "./signals-panel-fixture";

/** Every `canvas.setStateValue` the panel ran, in order. */
let ran: CommandArgValues[] = [];
/** The panel standing, so the doubled command can repaint it as the app's render effect does. */
let standing: MountedSignals | null = null;

beforeEach(() => {
  resetStudioState();
  installMockPlatform();
  clearSignalPanels();
  ran = [];
  standing = null;
  const registry = createCommandRegistry({ getContext: emptyContext });
  registry.register({
    category: "View",
    id: "canvas.setStateValue",
    level: "document",
    menus: ["palette"],
    run: (_ctx, args: CommandArgValues) => {
      ran.push(args);
      const tab = activeTab.value;
      const key = String(args["key"]);
      if (!tab) {
        return;
      }
      const { [key]: _old, ...rest } = tab.session.ui.stateValues;
      tab.session.ui.stateValues =
        args["value"] === null || args["value"] === undefined
          ? rest
          : { ...rest, [key]: args["value"] };
      standing?.repaint();
    },
    title: "Set State Value on Canvas",
  });
  setActiveRegistry(registry);
});

afterEach(() => {
  setActiveRegistry(null);
});

const STATE = {
  count: 3,
  double: "${state.count * 2}",
  mode: { default: "list", enum: ["list", "grid"], type: "string" },
  open: false,
  posts: { $prototype: "Request", url: "/api/posts" },
};

/** Draw the panel over {@link STATE} and keep it for the doubled command's repaint. */
async function draw(): Promise<MountedSignals> {
  standing = await drawSignals(structuredClone(STATE));
  return standing;
}

/** The button on a row that puts the document's own value back, or null when the row has none. */
function clearButton(panel: HTMLElement, name: string): HTMLElement | null {
  return entryRow(panel, name).querySelector<HTMLElement>('[part="clear-value"]');
}

describe("the control that sets a value for the canvas", () => {
  test("is offered on every plain entry, and on nothing whose value is decided elsewhere", async () => {
    const { panel } = await draw();
    for (const name of ["count", "mode", "open"]) {
      expect(fieldProps(await openEntry(panel, name))).toContain("canvasValue");
    }
    for (const name of ["double", "posts"]) {
      expect(fieldProps(await openEntry(panel, name))).not.toContain("canvasValue");
    }
  });

  test("a boolean and an entry with options are pickers that rest on the document's own value", async () => {
    const { panel } = await draw();
    const open = nativeSelect(control(await openEntry(panel, "open"), "canvasValue", "select"));
    expect([...open.options].map((option) => [option.value, option.textContent])).toEqual([
      ["", "The document's: false"],
      ["true", "true"],
      ["false", "false"],
    ]);
    expect(open.value).toBe("");
    const mode = nativeSelect(control(await openEntry(panel, "mode"), "canvasValue", "select"));
    expect([...mode.options].map((option) => option.value)).toEqual(["", "list", "grid"]);
  });

  test("picking a value runs the command, marks the row, and writes nothing to the document", async () => {
    const { panel } = await draw();
    const before = JSON.stringify(docState());
    await pick(control(await openEntry(panel, "open"), "canvasValue", "select"), "true");
    expect(ran).toEqual([{ key: "open", value: true }]);
    await settle();
    // The row says what the canvas is drawing, at rest, and holds the way back.
    expect(summaryText(panel, "open")).toBe("= true");
    expect(summaryTone(panel, "open")).toBe("override");
    expect(marked(entryRow(panel, "open"), "overridden")).toBe(true);
    expect(clearButton(panel, "open")).not.toBeNull();
    // No other row carries either.
    expect(marked(entryRow(panel, "count"), "overridden")).toBe(false);
    expect(clearButton(panel, "count")).toBeNull();
    expect(JSON.stringify(docState())).toBe(before);
    expect(activeTab.value?.doc.dirty).toBe(false);
  });

  test("text is read as the entry's own kind of value, and emptied text clears it", async () => {
    const { panel } = await draw();
    const field = () =>
      control(panel.querySelector('[part="editor"][data-signal="count"]')!, "canvasValue", "text");
    await openEntry(panel, "count");
    expect(nativeInput(field()).placeholder).toBe("The document's: 3");
    await commitText(field(), "12");
    expect(ran).toEqual([{ key: "count", value: 12 }]);
    expect(summaryText(panel, "count")).toBe("= 12");
    await commitText(field(), "");
    expect(ran.at(-1)).toEqual({ key: "count", value: null });
    expect(summaryTone(panel, "count")).not.toBe("override");
    expect(clearButton(panel, "count")).toBeNull();
  });

  test("picking the document's own value again clears it: a value that changes nothing is not set", async () => {
    const { panel } = await draw();
    const select = async () => control(await openEntry(panel, "open"), "canvasValue", "select");
    await pick(await select(), "true");
    await settle();
    expect(marked(entryRow(panel, "open"), "overridden")).toBe(true);
    // `open` is false in the document, so "false" is the document's own value under another label.
    await pick(
      control(panel.querySelector('[part="editor"][data-signal="open"]')!, "canvasValue", "select"),
      "false",
    );
    await settle();
    expect(ran).toEqual([
      { key: "open", value: true },
      { key: "open", value: null },
    ]);
    expect(marked(entryRow(panel, "open"), "overridden")).toBe(false);
    expect(summaryTone(panel, "open")).not.toBe("override");
    expect(clearButton(panel, "open")).toBeNull();
  });

  test("text that is the document's own value clears it too", async () => {
    const { panel } = await draw();
    const field = () =>
      control(panel.querySelector('[part="editor"][data-signal="count"]')!, "canvasValue", "text");
    await openEntry(panel, "count");
    await commitText(field(), "12");
    await commitText(field(), "3");
    expect(ran).toEqual([
      { key: "count", value: 12 },
      { key: "count", value: null },
    ]);
    expect(marked(entryRow(panel, "count"), "overridden")).toBe(false);
  });

  test("the row's summary names the set value in its tooltip, where an elided one is read whole", async () => {
    const mounted = await draw();
    activeTab.value!.session.ui.stateValues = { mode: "a rather long value for a narrow row" };
    mounted.repaint();
    await settle();
    const summary = entryRow(mounted.panel, "mode").querySelector('[part="summary"]');
    expect(summary?.getAttribute("title")).toBe(
      "Set for the canvas: a rather long value for a narrow row. The document is unchanged.",
    );
    // An empty text is a value, and is drawn as one.
    activeTab.value!.session.ui.stateValues = { mode: "" };
    mounted.repaint();
    await settle();
    expect(summaryText(mounted.panel, "mode")).toBe('= ""');
    expect(summary?.getAttribute("title")).toBe(
      "Set for the canvas: an empty text. The document is unchanged.",
    );
  });

  test("the row's button, pressed from the keyboard, leaves focus on the row it was in", async () => {
    const mounted = await draw();
    const { panel } = mounted;
    activeTab.value!.session.ui.stateValues = { mode: "grid" };
    mounted.repaint();
    await settle();
    const button = clearButton(panel, "mode")!;
    const inner = button.querySelector<HTMLElement>("button") ?? button;
    inner.focus();
    expect(button.contains(document.activeElement)).toBe(true);
    inner.click();
    await settle();
    // The button is gone with the value it cleared, and the keyboard is still in the Data panel.
    expect(clearButton(panel, "mode")).toBeNull();
    expect(document.activeElement).toBe(
      entryRow(panel, "mode").querySelector('[part="disclosure"]'),
    );
  });

  test("the row's button pressed with the pointer elsewhere moves no focus", async () => {
    const mounted = await draw();
    const { panel } = mounted;
    activeTab.value!.session.ui.stateValues = { mode: "grid" };
    mounted.repaint();
    await settle();
    const elsewhere = entryRow(panel, "count").querySelector<HTMLElement>('[part="disclosure"]')!;
    elsewhere.focus();
    clearButton(panel, "mode")!.click();
    await settle();
    expect(document.activeElement).toBe(elsewhere);
  });

  test("the row's button clears the value with the editor closed", async () => {
    const mounted = await draw();
    const { panel } = mounted;
    activeTab.value!.session.ui.stateValues = { mode: "grid" };
    mounted.repaint();
    await settle();
    expect(summaryText(panel, "mode")).toBe("= grid");
    const button = clearButton(panel, "mode");
    expect(button?.getAttribute("label") ?? button?.textContent).toContain(
      "Use the document's value of mode",
    );
    button?.click();
    await settle();
    expect(ran).toEqual([{ key: "mode", value: null }]);
    expect(clearButton(panel, "mode")).toBeNull();
  });

  test("a value left behind by an entry that is no longer plain marks nothing", async () => {
    const mounted = await draw();
    activeTab.value!.session.ui.stateValues = { double: 9, posts: [] };
    mounted.repaint();
    await settle();
    expect(marked(entryRow(mounted.panel, "double"), "overridden")).toBe(false);
    expect(marked(entryRow(mounted.panel, "posts"), "overridden")).toBe(false);
  });
});

describe("an entry the canvas has no answer for", () => {
  /** Draw with the frame's report in place, as a `bindingStatus` message leaves it. */
  async function drawWith(
    entries: NonNullable<
      NonNullable<typeof activeTab.value>["session"]["canvas"]["bindings"]
    >["entries"],
  ): Promise<MountedSignals> {
    const mounted = await draw();
    const tab = activeTab.value!;
    tab.session.canvas.scope = { count: 3, posts: null };
    tab.session.canvas.bindings = { bindings: [], entries };
    mounted.repaint();
    await settle();
    return mounted;
  }

  test("says it is not run here, in place of a null that reads as a value", async () => {
    const { panel } = await drawWith({ posts: { status: "not-run" } });
    // Two words, because the slot beside a name fits two: the phrase is the tooltip and the editor's.
    expect(summaryText(panel, "posts")).toBe("Not run");
    expect(summaryTone(panel, "posts")).toBe("not-run");
    expect(entryRow(panel, "posts").querySelector('[part="summary"]')?.getAttribute("title")).toBe(
      "The canvas does not run this entry. It runs on the live page.",
    );
    const editor = await openEntry(panel, "posts");
    expect(editor.querySelector('[data-prop="canvasNotRun"] [part="note"]')?.textContent).toBe(
      "Runs on the live page. The canvas does not run this entry.",
    );
  });

  test("says it is loading while its answer is out", async () => {
    const { panel } = await drawWith({ posts: { status: "pending" } });
    expect(summaryText(panel, "posts")).toBe("Loading");
    expect(summaryTone(panel, "posts")).toBe("pending");
  });

  test("says it failed, with the reason on the row and in the editor", async () => {
    const { panel } = await drawWith({ posts: { error: "Not Found", status: "failed" } });
    expect(summaryText(panel, "posts")).toBe("Failed");
    expect(summaryTone(panel, "posts")).toBe("failed");
    expect(entryRow(panel, "posts").querySelector('[part="summary"]')?.getAttribute("title")).toBe(
      "Not Found",
    );
    const editor = await openEntry(panel, "posts");
    expect(fieldProps(editor)).toContain("canvasFailure");
    expect(editor.querySelector('[data-prop="canvasFailure"] [part="note"]')?.textContent).toBe(
      "Could not load: Not Found. Refresh asks again.",
    );
  });

  test("a resolved entry, and one the frame did not report on, read as before", async () => {
    const { panel } = await drawWith({ posts: { status: "resolved" } });
    expect(summaryTone(panel, "posts")).toBe("pending");
    expect(summaryTone(panel, "count")).toBe("value");
    expect(fieldProps(await openEntry(panel, "posts"))).not.toContain("canvasFailure");
  });
});
