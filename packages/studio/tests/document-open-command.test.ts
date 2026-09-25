/**
 * The `document.open { path }` record and its projection, `open_document` (issue 334, item 1).
 *
 * `open_document` used to be a hand-registered tool with no command twin: it called the injected
 * `openFileInTab`, read `getTab()` afterwards and called whatever it found a success — so a path
 * that did not exist left the PREVIOUS document active and reported "Switched to". Now the record
 * owns the open, refuses by throwing when no tab landed, and its report names the document that IS
 * active and whether the tree tools reach it, from the same `editor.kind` the gate reads.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { checkPlacements } from "../src/commands/levels";
import { createCommandToolRegistry } from "../src/services/ai-command-tools";
import { fileTurn } from "../src/services/ai-writes";
import { recordingContext } from "./harness/recording-context";
import { closeAllTabs, openTab, tabCommands, workspace } from "../src/workspace/workspace";
import type { AnyCommand } from "../src/commands/registry";
import type { CommandContext } from "../src/commands/context";

/** The record under test, with an `openFile` the test controls. */
function build(openFile: (path: string) => void | Promise<void>) {
  const commands = tabCommands({ openFile, openFileInPane: () => {} });
  const record = commands.find((c) => c.id === "document.open")!;
  return { commands, record };
}

/** Open a tab the way `openFileInTab` would land one: id and documentPath both the path. */
function land(path: string) {
  return openTab({ document: { children: [], tagName: "div" }, documentPath: path, id: path });
}

let ctx: CommandContext;

beforeEach(() => {
  resetStudioState({ projectRoot: "/proj" });
  closeAllTabs();
  ctx = makeContext({ editor: { kind: "canvas" }, project: { open: true } });
});

afterEach(() => {
  setActiveRegistry(null);
  closeAllTabs();
});

describe("the record", () => {
  test("is project-level, palette-placed, gated on an open project, and projects open_document", () => {
    const { commands, record } = build(() => {});
    expect(checkPlacements(commands)).toEqual([]);
    expect(record.level).toBe("project");
    expect(record.menus).toEqual(["palette"]);
    expect(record.requires).toBe("an open project");
    expect(record.when!(makeContext())).toBe(false);
    expect(record.when!(ctx)).toBe(true);
    expect(record.aiTool?.name).toBe("open_document");
    // A navigation: no undo scope, so the ledger files nothing for it.
    expect(record.undo).toBeUndefined();
  });

  test("run hands the path to openFile and resolves once a tab holds it", async () => {
    const opened: string[] = [];
    const { commands } = build((path) => {
      opened.push(path);
      land(path);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);
    await registry.run("document.open", { path: "pages/about.json" });
    expect(opened).toEqual(["pages/about.json"]);
    expect(workspace.activeTabId).toBe("pages/about.json");
  });

  test("run refuses by throwing when no tab landed — the file the tree would only toast about", async () => {
    // `openFileInTab` reports a missing file as a Problem and returns normally; the record has to
    // Look for the tab itself, or a missing file is a success over the previous document.
    land("pages/index.json");
    const { commands } = build(() => {});
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);
    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; it returns a real Promise and the await is load-bearing.
    await expect(registry.run("document.open", { path: "pages/missing.json" })).rejects.toThrow(
      'command "document.open" argument "path": "pages/missing.json" could not be opened — it ' +
        "does not exist, or no editor claims its format. Problems has the reason.",
    );
    // And the previous document is still the active one, untouched.
    expect(workspace.activeTabId).toBe("pages/index.json");
  });

  test("a path the schema refuses never reaches openFile", () => {
    const opened: string[] = [];
    const { commands } = build((path) => {
      opened.push(path);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);
    expect(() => registry.run("document.open", {})).toThrow('command "document.open"');
    expect(() => registry.run("document.open", { path: 7 })).toThrow('argument "path"');
    expect(opened).toEqual([]);
  });
});

describe("the report", () => {
  const facts = (after: CommandContext, path: string) =>
    ({ after, args: { path }, before: makeContext() }) as never;

  test("names the active document and that the tree tools reach it on the canvas", () => {
    const { record } = build(() => {});
    land("pages/about.json");
    expect(record.aiTool!.report(facts(ctx, "pages/about.json"))).toBe(
      '"pages/about.json" is the active document, on the canvas; the document tools now operate ' +
        "on it.",
    );
  });

  test("names the editor a non-tree document opened in, with the same words the shell uses", () => {
    const { record } = build(() => {});
    land("data/rows.csv");
    const grid = makeContext({ ...ctx, editor: { kind: "grid" } } as CommandContext);
    expect(record.aiTool!.report(facts(grid, "data/rows.csv"))).toBe(
      '"data/rows.csv" is the active document, in the Grid editor, which is not an element tree ' +
        "the document tools can edit.",
    );
  });

  test("says which document IS active when the opened one is not — and none, when none is", () => {
    const { record } = build(() => {});
    land("pages/index.json");
    expect(record.aiTool!.report(facts(ctx, "pages/about.json"))).toBe(
      'Opened "pages/about.json", but the active document is "pages/index.json".',
    );
    closeAllTabs();
    expect(record.aiTool!.report(facts(ctx, "pages/about.json"))).toBe(
      'Opened "pages/about.json", but the active document is none.',
    );
  });
});

describe("through the bridge", () => {
  test("open_document is advertised with a project and no document, and its result is the report", async () => {
    const { commands } = build((path) => {
      land(path);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands as AnyCommand[]);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });

    const definition = tools.getDefinition("open_document")!;
    expect(tools.list().map((t) => t.name)).toContain("open_document");
    expect(definition.parameters.required).toEqual(["path"]);
    // A navigation says nothing about undo.
    expect(definition.description).not.toContain("Undo");

    const tCall = recordingContext();
    expect(await tools.execute("open_document", { path: "pages/about.json" }, tCall)).toEqual({
      success: true,
      summary:
        '"pages/about.json" is the active document, on the canvas; the document tools now ' +
        "operate on it.",
    });
    // No ledger entry: nothing was written.
    expect(fileTurn("t", tCall.ledger.writes)).toEqual([]);
  });

  test("the refusal for a file that did not open reaches the model verbatim", async () => {
    const { commands } = build(() => {});
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands as AnyCommand[]);
    setActiveRegistry(registry);
    const tools = createCommandToolRegistry({ getTab: () => null, validate: async () => [] });
    const result = await tools.execute("open_document", { path: "pages/missing.json" });
    expect(result.success).toBe(false);
    expect(result.error).toContain('"pages/missing.json" could not be opened');
  });
});
