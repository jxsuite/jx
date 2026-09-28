/**
 * The `document.openToSide { file }` record — the non-drag equivalent of dragging a file row onto
 * the other pane's strip (SC 2.5.7), and the file-tree counterpart of `⌘\` / `splitRight`.
 *
 * Mirrors `document-open-command.test.ts`: same shape, same refusal wording, same "bad args never
 * reach the opener" discipline — but the subject is a PANE rather than a tab, so what changes is
 * what a run asserts about `workspace.panes` and `workspace.activePaneId`.
 */
import { resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { setActiveRegistry } from "../src/commands/active-registry";
import { checkPlacements } from "../src/commands/levels";
import { setPaneDerivation } from "../src/workspace/pane-derive";
import {
  PRIMARY_PANE,
  SECONDARY_PANE,
  closeAllTabs,
  focusPane,
  openTab,
  paneById,
  splitRight,
  tabCommands,
  workspace,
} from "../src/workspace/workspace";
import type { CommandContext } from "../src/commands/context";

/** The record under test, with an `openFile` the test controls. */
function build(openFile: (path: string, opts?: { paneId?: string }) => void | Promise<void>) {
  const commands = tabCommands({ openFile, openFileInPane: () => {} });
  const record = commands.find((c) => c.id === "document.openToSide")!;
  return { commands, record };
}

/** Open a tab the way `openFileInTab({ paneId })` would land one, into the pane it is asked for. */
function land(path: string, paneId?: string) {
  return openTab({
    document: { children: [], tagName: "div" },
    documentPath: path,
    id: path,
    ...(paneId !== undefined && { paneId }),
  });
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
  test("is project-level, offered on context/file and the palette, gated on an open project", () => {
    const { commands, record } = build(() => {});
    expect(checkPlacements(commands)).toEqual([]);
    expect(record.level).toBe("project");
    expect(record.menus).toEqual(["context/file", "palette"]);
    expect(record.group).toBe("1_file");
    expect(record.requires).toBe("an open project");
    expect(record.when!(makeContext())).toBe(false);
    expect(record.when!(ctx)).toBe(true);
    /* Chrome carries no `aiTool`: the first deletion rule of studio-ui-guidelines.md §12.4. And
       opening a tab is not a state the undo stack owns. */
    expect(record.aiTool).toBeUndefined();
    expect(record.undo).toBe("none");
  });

  test("a file argument the schema refuses never reaches openFile", () => {
    const opened: string[] = [];
    const { commands } = build((path) => {
      opened.push(path);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);
    expect(() => registry.run("document.openToSide", {})).toThrow('command "document.openToSide"');
    expect(() => registry.run("document.openToSide", { file: 7 })).toThrow('argument "file"');
    expect(opened).toEqual([]);
  });
});

describe("run", () => {
  test("opens beside the focused pane, and the keyboard FOLLOWS it there", async () => {
    land("pages/current.json");
    const { commands } = build((path, opts) => {
      land(path, opts?.paneId);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);

    await registry.run("document.openToSide", { file: "pages/about.json" });

    expect(workspace.panes.map((pane) => pane.tabOrder)).toEqual([
      ["pages/current.json"],
      ["pages/about.json"],
    ]);
    // "Open to the Side" is a gesture, not a read: the pane it opens into takes the keyboard.
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    expect(workspace.activeTabId).toBe("pages/about.json");
  });

  test("a refusal collapses the SECONDARY pane it minted, over a refusal", async () => {
    land("pages/current.json");
    const { commands } = build(() => {
      // Reports the failure as `openFileInTab` does — as a Problem, not a throw — and lands nothing.
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);

    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; the await is load-bearing.
    await expect(
      registry.run("document.openToSide", { file: "pages/missing.json" }),
    ).rejects.toThrow(
      'command "document.openToSide" argument "file": "pages/missing.json" could not be opened — ' +
        "it does not exist, or no editor claims its format. Problems has the reason.",
    );
    // The pane this run minted holds nothing, so it did not survive the refusal.
    expect(workspace.panes).toHaveLength(1);
    expect(workspace.panes[0]!.id).toBe(PRIMARY_PANE);
  });

  test("a refusal never closes the PRIMARY, even when it is the empty pane the open targeted", async () => {
    // `splitRight` from the primary moves its only tab into a NEW secondary and follows it there —
    // The primary is left standing empty, by design (`detachTab`'s "welcome screen beside the
    // Document you split" exemption). Asking to open to the side from HERE makes the primary the
    // Target — `receivingPane` answers the pane BESIDE the focused one, which is now the primary.
    land("pages/current.json");
    splitRight();
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual([]);
    const before = paneById(SECONDARY_PANE)!.tabOrder;

    const { commands } = build(() => {});
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);

    // oxlint-disable-next-line typescript/await-thenable -- Bun types the matcher `void`; the await is load-bearing.
    await expect(
      registry.run("document.openToSide", { file: "pages/missing.json" }),
    ).rejects.toThrow("could not be opened");

    /* `closePane`'s own contract reads `PRIMARY_PANE` as "collapse the OTHER pane" — never the
       primary itself, which can never leave the grid. An unguarded `closePane(target.id)` here
       would have read `target.id === PRIMARY_PANE` as that same instruction and closed the
       SECONDARY the author was looking at, discarding the document they had just split out, over a
       refusal about a completely different pane. Both panes survive untouched. */
    expect(workspace.panes).toHaveLength(2);
    expect(paneById(PRIMARY_PANE)!.tabOrder).toEqual([]);
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(before);
  });

  test("opening into a lens releases the derivation before the document lands", async () => {
    land("pages/current.json");
    splitRight();
    // Splitting moved the only tab into the secondary; put it back so `paneIsEmpty` is watching the
    // Derivation, not a tab, once the lens is published.
    workspace.panes[0]!.tabOrder = ["pages/current.json"];
    workspace.panes[0]!.activeTabId = "pages/current.json";
    workspace.panes[1]!.tabOrder = [];
    workspace.panes[1]!.activeTabId = null;
    // Focus back on the primary, so `receivingPane(activePane().id)` answers the SECONDARY — the
    // Lens — rather than the primary beside a focused secondary.
    focusPane(PRIMARY_PANE);
    setPaneDerivation(SECONDARY_PANE, {
      diff: null,
      kind: "lens",
      media: null,
      mode: "source",
      preset: "code",
      reason: "",
      sourcePaneId: PRIMARY_PANE,
      status: "ready",
      zoom: 1,
    });

    const { commands } = build((path, opts) => {
      land(path, opts?.paneId);
    });
    const registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(commands);

    await registry.run("document.openToSide", { file: "pages/about.json" });

    expect(paneById(SECONDARY_PANE)!.derived).toBeNull();
    expect(paneById(SECONDARY_PANE)!.tabOrder).toEqual(["pages/about.json"]);
  });
});
