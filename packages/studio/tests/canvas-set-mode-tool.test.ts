/**
 * `canvas.setMode`'s projection, `set_canvas_mode` (issue 334, item 4).
 *
 * The record was deleted from the projection under §12.4's first rule (chrome), which left the
 * model with no way back to the canvas once a document sat in Code view — the tree tools are gated
 * on `editor.kind`, and the mode is what `editor.kind` is derived from. So the rule's premise did
 * not hold: the verb's effect is not only what the person is looking at. `run` acts on the active
 * tab, and the report names the mode and whether the tree tools reach it, from `after.editor.kind`
 * — the same read the gate makes, so the two cannot disagree.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { createCommandToolRegistry } from "../src/services/ai-command-tools";
import { closeAllTabs, openTab } from "../src/workspace/workspace";
import type { CommandContext } from "../src/commands/context";
import type { CommandRegistry } from "../src/commands/registry";

const { canvasViewCommands } = await import("../src/canvas/canvas-utils");

/** The base modes each verb wrote, in order — the `setCanvasMode` seam. */
const modesSet: string[] = [];
const deps = {
  getCanvasMode: () => "design",
  renderPane: () => {},
  setCanvasMode: (_tab: unknown, mode: string) => {
    modesSet.push(mode);
  },
  setOpenPopover: () => {},
  setOpenDialog: () => {},
  setResolvingOpen: () => {},
};

let ctx: CommandContext;
let registry: CommandRegistry;

function openDoc(modes: string[] = ["edit", "design", "preview", "source"]) {
  closeAllTabs();
  return openTab({
    capabilities: { modes },
    document: { children: [{ tagName: "p", textContent: "Hi" }], tagName: "div" },
    documentPath: "pages/index.json",
    id: "t1",
  });
}

beforeEach(() => {
  resetStudioState();
  modesSet.length = 0;
  ctx = makeContext({ document: { open: true }, editor: { kind: "canvas" } });
  registry = createCommandRegistry({ getContext: () => ctx });
  registry.registerAll(canvasViewCommands(deps));
  openDoc();
});

afterEach(() => {
  setActiveRegistry(null);
  closeAllTabs();
});

describe("the projection", () => {
  test("canvas.setMode projects set_canvas_mode, document-level, with the record's own enum", () => {
    const record = registry.get("canvas.setMode")!;
    expect(record.aiTool?.name).toBe("set_canvas_mode");
    expect(record.level).toBe("document");
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });
    const definition = tools.getDefinition("set_canvas_mode")!;
    expect(Object.is(definition.parameters, record.args)).toBe(true);
    // The description steers the model to the two modes the tree tools work in.
    expect(definition.description).toContain("return a document to edit or design");
    // A view change, not a write: nothing about undo.
    expect(definition.description).not.toContain("Undo");
  });

  test("the report names the mode and that the tree tools reach it, from editor.kind", () => {
    const { report } = registry.get("canvas.setMode")!.aiTool!;
    const facts = (after: CommandContext, mode: string) =>
      ({ after, args: { mode }, before: ctx }) as never;
    expect(report(facts(ctx, "design"))).toBe(
      "The active document is in design mode; the document tools address its element tree.",
    );
    // Preview composes over a canvas base, so the tree is still the canvas's.
    expect(report(facts(ctx, "preview"))).toBe(
      "The active document is in preview mode; the document tools address its element tree.",
    );
    const code = makeContext({ ...ctx, editor: { kind: "code" } } as CommandContext);
    expect(report(facts(code, "source"))).toBe(
      "The active document is in source mode; the tree-editing tools are unavailable until it " +
        "returns to edit or design.",
    );
  });
});

describe("through the bridge", () => {
  test("a mode the document supports is set on the active tab and reported", async () => {
    const tab = openDoc();
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    expect(await tools.execute("set_canvas_mode", { mode: "edit" })).toEqual({
      success: true,
      summary: "The active document is in edit mode; the document tools address its element tree.",
    });
    expect(modesSet).toEqual(["edit"]);
    expect(tab.session.ui.preview).toBe(false);
  });

  test("a mode the document does not declare is refused with the record's own sentence", async () => {
    const tab = openDoc(["edit", "design"]);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => tab, validate: async () => [] });
    const result = await tools.execute("set_canvas_mode", { mode: "grid" });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'command "canvas.setMode" argument "mode": "grid" is not a mode this document supports — ' +
        "it declares: edit, design",
    );
    expect(modesSet).toEqual([]);
  });

  test("a value outside the enum is the schema's refusal, before run", async () => {
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });
    const result = await tools.execute("set_canvas_mode", { mode: "wysiwyg" });
    expect(result.success).toBe(false);
    expect(result.error).toContain('command "canvas.setMode" argument "mode": "wysiwyg"');
    expect(modesSet).toEqual([]);
  });

  test("it is not advertised without a document, and is with one", () => {
    ctx = makeContext();
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });
    expect(tools.list().map((t) => t.name)).not.toContain("set_canvas_mode");
    ctx = makeContext({ document: { open: true }, editor: { kind: "code" } });
    // A document in Code view is exactly the state the verb exists for.
    expect(tools.list().map((t) => t.name)).toContain("set_canvas_mode");
  });
});
