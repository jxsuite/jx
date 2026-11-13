/**
 * The canvas pane's verbs — `canvas.setMode` / `setZoom` / `setEditZoom`, `selection.set`, and
 * `insert.data`.
 *
 * `canvas.setMode` is a setter, never a toggle: a toggle cannot say which state it ends in, so a
 * screenshot taken through one photographs whichever way the default pointed. The tests that matter
 * here are therefore the IDEMPOTENCE ones and the refusals — an unsupported mode, Diff by name, and
 * a zoom outside the range the controls silently clamp.
 */
import { resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { makeContext } from "../src/commands/context";
import { checkPlacements } from "../src/commands/levels";
import {
  activeTab,
  closeAllTabs,
  focusPane,
  openTab,
  PRIMARY_PANE,
  SECONDARY_PANE,
  splitRight,
  workspace,
} from "../src/workspace/workspace";
import type { CommandArgValues } from "../src/commands/command-args";
import type { CommandContext } from "../src/commands/context";
import type { Tab } from "../src/tabs/tab";
import type { CommandRegistry } from "../src/commands/registry";
import type { JxPath } from "../src/state";
import { surfaceForPane } from "../src/canvas/surface-registry";

// ─── Seams (all must precede the modules under test) ─────────────────────────

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  editor: { create: () => ({}), createModel: () => ({}), setModelMarkers: () => {} },
}));
void mock.module("../src/canvas/canvas-live-render.js", () => ({
  initCanvasLiveRender: () => {},
  resolveCanvasDocument: () => Promise.resolve(null),
}));
/** What `insert.data` posted to the canvas bridge, and the caret path the host reports. */
const formatIntents: { command: string; token?: string }[] = [];
let caretPath: (string | number)[] | null = null;
void mock.module("../src/canvas/iframe-host.js", () => ({
  requestTemplateEval: () => Promise.resolve(null),
  flushCanvasEdits: () => Promise.resolve(),
  commitActiveEditSession: () => {},
  /* Three exports this file never calls, stubbed because a PARTIAL mock of a module the graph
     reaches is a load error rather than a missing stub at call time. canvas-render now draws the
     Library, whose creation flow is `files/files.ts`, which pulls `packages/ensure-deps` →
     `services/automation` → `services/idle` — and those two modules read `canvasIdleBlockers`,
     `canvasPointAt` and `revealCanvasPath` off the iframe host. */
  canvasIdleBlockers: () => [],
  canvasPointAt: () => Promise.resolve(null),
  revealCanvasPath: () => Promise.resolve(null),
  getEditBarAnchorRect: () => null,
  getEditSnapshot: () => ({
    editing: caretPath !== null,
    snapshot: caretPath && { path: caretPath },
  }),
  mountIframeCanvas: () => Promise.resolve(),
  postApplyFormat: (intent: { command: string; token?: string }) => {
    formatIntents.push(intent);
  },
  // `insert.openSlashMenu`'s poster. Recorded the same way, so the record's run is observable —
  // And stubbed at all because a PARTIAL mock of a module the graph reaches is a load error.
  postOpenSlash: () => {
    formatIntents.push({ command: "openSlash" });
  },
  postRedefineElementToLiveHosts: () => 0,
  postStyleUpdateToStylebookHosts: () => {},
  postSiteStyleToLiveHosts: () => 0,
  requestCanvasEval: () => Promise.resolve(null),
  /* The non-lazy way out of `liveHosts`: `panels/pane-grid.ts` calls it as a cell is
     disposed, so it is on the import graph of anything that mounts the shell. */
  releaseCanvasHosts: () => 0,
  setToolbarRefresh: () => {},
}));
void mock.module("../src/surfaces/welcome.js", () => ({
  initWelcome: () => {},
  renderWelcome: () => {},
}));
void mock.module("../src/panels/editors.js", () => ({
  registerFunctionCompletions: () => {},
  renderFunctionEditor: () => {},
}));
void mock.module("../src/panels/formula-workspace.js", () => ({
  closeFormulaWorkspace: () => {},
  formulaRoot: () => null,
  /* The Logic openers go through this: it sets the target AND reveals the tab. */
  openLogicTarget: () => {},
  renderFormulaWorkspace: () => {},
  /* The State panel's `formula.openWorkspace` reveals the dock tab instead of repainting. */
  revealLogicPanel: () => {},
}));
void mock.module("../src/surfaces/statusbar.js", () => ({
  mountStatusbar: () => {},
  renderStatusbar: () => {},
  unmountStatusbar: () => {},
}));
void mock.module("../src/panels/overlays.js", () => ({
  mount: () => {},
  render: () => {},
  unmount: () => {},
}));
void mock.module("../src/panels/stylebook-panel.js", () => ({
  renderStylebookMode: () => {},
  selectStylebookTag: () => {},
}));
void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: () => null,
  serializeDocument: () => "",
  /* Two more the Library's context menu reads. canvas-render draws the Library now, so this
     partial mock has to cover what that path imports — see the iframe-host note above. */
  confirmFileDelete: () => Promise.resolve(false),
  renamePromptMessage: () => Promise.resolve(""),
  /* And one the TAB STRIP reads: its close offers to save first (the three-way dialog of
     studio-ui-guidelines.md §8.7). */
  saveFile: () => Promise.resolve(true),
}));

const {
  CANVAS_MODES,
  canvasViewCommands,
  EDIT_ZOOM_MAX,
  EDIT_ZOOM_MIN,
  PAN_ZOOM_MAX,
  PAN_ZOOM_MIN,
  getFit,
  hasDeclaredFit,
  registerCanvasViewCommands,
  resetFits,
} = await import("../src/canvas/canvas-utils");
const { registerSelectionSetCommand, selectionCommands } =
  await import("../src/canvas/canvas-render");
const { EDIT_WIDTH_MIN, editWidthOfPane, resetEditWidths } =
  await import("../src/canvas/edit-width");

// ─── Context ──────────────────────────────────────────────────────────────────

let canvasMode = "design";
/* Takes the TAB the command resolved, and writes into that one. The double used to take only a
   mode and resolve `activeTab.value` itself, which is precisely the conflation the injected
   `setCanvasMode` no longer permits: a double that finds its own target cannot tell "the right
   document changed" from "some document changed". */
const setCanvasMode = mock((tab: Tab | null, mode: string) => {
  canvasMode = mode;
  if (tab) {
    tab.session.ui.canvasMode = mode;
  }
});
/** Which pane each rendering-context verb repainted — the fact the side bar depends on. */
const renderedPanes: string[] = [];
/** Which pane each rendering-context verb opened or closed the resolving popover for. */
const resolvingOpened: [string, boolean][] = [];
const openedPopovers: [string, JxPath | null][] = [];
const openedDialogs: [string, JxPath | null][] = [];
const deps = {
  getCanvasMode: () => canvasMode,
  renderPane: (paneId: string) => renderedPanes.push(paneId),
  setCanvasMode,
  setOpenPopover: (tab: Tab, path: JxPath | null) => openedPopovers.push([tab.id, path]),
  setOpenDialog: (tab: Tab, path: JxPath | null) => openedDialogs.push([tab.id, path]),
  setResolvingOpen: (paneId: string, open: boolean) => resolvingOpened.push([paneId, open]),
};

let ctx: CommandContext = makeContext();
let registry: CommandRegistry;

const DOC = {
  children: [{ children: [{ tagName: "span" }], tagName: "p", textContent: "Hi" }],
  tagName: "div",
};

function openWith(modes: string[]) {
  closeAllTabs();
  return openTab({
    capabilities: { modes },
    document: structuredClone(DOC),
    documentPath: "pages/index.json",
    id: "t1",
  });
}

beforeEach(() => {
  canvasMode = "design";
  setCanvasMode.mockClear();
  resetFits();
  resetEditWidths();
  renderedPanes.length = 0;
  openedPopovers.length = 0;
  openedDialogs.length = 0;
  surfaceForPane("primary").panzoomWrap = null;
  ctx = makeContext({ document: { open: true } });
  registry = createCommandRegistry({ getContext: () => ctx });
  registerCanvasViewCommands(registry, deps);
  registerSelectionSetCommand(registry);
  openWith(["edit", "design", "source"]);
});

describe("the records themselves", () => {
  test("satisfy the level × placement matrix", () => {
    expect(checkPlacements([...canvasViewCommands(deps), ...selectionCommands()])).toEqual([]);
  });

  test("are all idempotent setters", () => {
    const ids = registry.list().map((c) => c.id);
    expect(ids).toEqual([
      "canvas.setMode",
      "canvas.setZoom",
      "canvas.setFit",
      // The status bar's Fit page choice, which may magnify where `canvas.setFit "page"` never does.
      "canvas.fitPage",
      "canvas.setEditZoom",
      // The addressable form of the Edit column's resize handles. It is a SETTER over a width in
      // Px, so it names the state it ends in the way its neighbours do; the drag itself bypasses
      // The registry for the reason `requestEditZoom` bypasses `canvas.setEditZoom` — a repaint
      // Per pointermove would rebuild the iframe and break the handle's own pointer capture.
      "canvas.setEditWidth",
      // The rendering context's three axes (§6.2). The Context popover wrote
      // `session.ui` through `updateUi` directly, so none of the three was a command — not in the
      // Palette, not scriptable, not bindable. Setters, not cycles: a chord carries no argument, so
      // The `⌘⌥↑`/`⌘⌥⇧S` cycles §6.2 names need `next`/`prev` records of their own.
      "canvas.setBreakpoint",
      "canvas.setColorScheme",
      // What a text chip draws: its binding's value, or its name (§6.9).
      "canvas.setBindingDisplay",
      // A repeater's rows (§4.5): which one is addressable, and how many are drawn.
      "canvas.setActiveRow",
      "canvas.setRepeaterRows",
      // The case of a `$switch` drawn in place of the one it selects, and the tag whose popover is
      // Open (§4.5, §6.9): both name the state they end in, so a shot can open either.
      "canvas.setSwitchCase",
      "canvas.setTagPopover",
      // The language axis. Its id keeps the `i18n.` namespace and its definition site is here,
      // Because the three rendering-context closures a per-pane verb needs — the tab, the pane
      // Argument and the repaint — are local to this module. `insert.data` is the precedent.
      "i18n.switchLocale",
      "canvas.setLayoutVisible",
      // The one element STATE the canvas simulates. A setter for the same reason as its neighbours,
      // And with a sharper edge: `scripts/check-shot-contract.ts` rejects any `/\.toggle[A-Z]/` id
      // Outright and `services/automation.ts` throws on one, so a `togglePopover` could never be
      // Driven from a documentation screenshot — which is exactly the shot this record exists for.
      "canvas.setPopoverOpen",
      // The dialog twin, for the same reasons.
      "canvas.setDialogOpen",
      // The route params and component test props live in a popover now, and a transient surface
      // Opens by command rather than by clicking — otherwise the shot that types a test
      // Value would need a CSS selector to reach it.
      "canvas.setResolvingOpen",
      // The values themselves are verbs too. They wrote `session.ui` inline while every control in
      // The popover beside them ran a command — the defect `runContextCommand`'s docstring names.
      // A state value drawn in place of the document's own (§4.5) is also a component's test value.
      "canvas.setStateValue",
      "canvas.setRouteParam",
      "selection.set",
      "selection.setPaths",
      "insert.data",
      // The slash menu's named door. Not a setter and not a toggle — it OPENS a transient surface,
      // Which is the same shape as `canvas.setResolvingOpen` above and the same reason: a menu a
      // Shot can only reach by typing is a menu no script, chord or assistant can reach at all.
      "insert.openSlashMenu",
    ]);
    expect(ids.some((id) => /\.toggle[A-Z]/.test(id))).toBe(false);
  });

  test("canvas.setMode's enum is the mode set, Diff left out, and there is no Preview", () => {
    const modeEnum = registry.get("canvas.setMode")?.args?.properties?.mode?.enum;
    expect(modeEnum).toEqual(CANVAS_MODES.filter((mode) => mode !== "git-diff"));
    expect(modeEnum).not.toContain("preview");
    // Implicit (studio.md §3): the stage draws it, nothing asks for it by name.
    expect(modeEnum).not.toContain("git-diff");
  });
});

describe("the rendering-context verbs repaint the pane they WROTE", () => {
  /*
   * They wrote a named pane's tab and then called `renderOnly("canvas")`, which resolves the
   * FOCUSED pane. The side bar addresses the side pane, so its size switcher changed one stage and
   * repainted the other — leaving the stage it had changed showing the old width.
   */
  /** A document with a breakpoint, in the focused pane. */
  const withMedia = () => {
    const tab = openWith(["edit", "design"]);
    tab.doc.document.$media = { md: "(min-width: 768px)" };
    return tab;
  };

  /**
   * …and moved to the SIDE pane, with the keyboard left in the primary.
   *
   * `splitRight()` moves the active tab, so this is the arrangement the bug needed: the pane being
   * addressed is not the pane with the focus.
   */
  const sideHoldsIt = () => {
    withMedia();
    splitRight();
    focusPane(PRIMARY_PANE);
  };

  test("the named pane, when one is named", () => {
    sideHoldsIt();
    void registry.run("canvas.setBreakpoint", { media: "md", pane: SECONDARY_PANE });
    expect(renderedPanes).toEqual([SECONDARY_PANE]);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  });

  test("the focused pane, when none is", () => {
    withMedia();
    void registry.run("canvas.setColorScheme", { scheme: "dark" });
    expect(renderedPanes).toEqual([workspace.activePaneId]);
  });

  test("…and all three do it", () => {
    sideHoldsIt();
    void registry.run("canvas.setBreakpoint", { media: null, pane: SECONDARY_PANE });
    void registry.run("canvas.setColorScheme", { pane: SECONDARY_PANE, scheme: "light" });
    void registry.run("canvas.setLayoutVisible", { pane: SECONDARY_PANE, visible: false });
    expect(renderedPanes).toEqual([SECONDARY_PANE, SECONDARY_PANE, SECONDARY_PANE]);
  });
});

describe("canvas.setBindingDisplay", () => {
  test("sets the tab's display, and saying it twice changes nothing: a setter, not a toggle", () => {
    const tab = activeTab.value!;
    expect(tab.session.ui.bindingDisplay).toBe("values");
    void registry.run("canvas.setBindingDisplay", { display: "names" });
    expect(tab.session.ui.bindingDisplay).toBe("names");
    void registry.run("canvas.setBindingDisplay", { display: "names" });
    expect(tab.session.ui.bindingDisplay).toBe("names");
    void registry.run("canvas.setBindingDisplay", { display: "values" });
    expect(tab.session.ui.bindingDisplay).toBe("values");
    // One attribute in the frame, posted by the stage that draws the tab: nothing is repainted.
    expect(renderedPanes).toEqual([]);
  });

  test("names the pane whose tab it means", () => {
    // The document moves to the side pane and the keyboard stays in the primary.
    const tab = activeTab.value!;
    splitRight();
    focusPane(PRIMARY_PANE);
    void registry.run("canvas.setBindingDisplay", { display: "names", pane: SECONDARY_PANE });
    expect(tab.session.ui.bindingDisplay).toBe("names");
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  });

  test("refuses a display that is not one of the two", () => {
    expect(() => registry.run("canvas.setBindingDisplay", { display: "labels" })).toThrow();
    expect(activeTab.value?.session.ui.bindingDisplay).toBe("values");
  });
});

describe("canvas.setActiveRow", () => {
  const LIST = ["children", 0];
  const KEY = JSON.stringify(LIST);

  /** Give the open document a repeater as its first child. */
  function withRepeater(): void {
    activeTab.value!.doc.document.children = [
      { $prototype: "Array", items: ["a", "b", "c"], map: { tagName: "li" } },
      { tagName: "p" },
    ];
  }

  test("sets the repeater's row on the tab, and saying it twice changes nothing", () => {
    withRepeater();
    const tab = activeTab.value!;
    expect(tab.session.ui.activeRows).toEqual({});
    void registry.run("canvas.setActiveRow", { path: LIST, row: 2 });
    expect(tab.session.ui.activeRows).toEqual({ [KEY]: 2 });
    // The same state by the same name: no new record, so nothing downstream is told again.
    const held = tab.session.ui.activeRows;
    void registry.run("canvas.setActiveRow", { path: LIST, row: 2 });
    expect(tab.session.ui.activeRows).toBe(held);
    void registry.run("canvas.setActiveRow", { path: LIST, row: 0 });
    expect(tab.session.ui.activeRows).toEqual({ [KEY]: 0 });
    // The frame renames attributes: the pane is not rendered again, and the document is untouched.
    expect(renderedPanes).toEqual([]);
    expect(tab.doc.dirty).toBeFalsy();
  });

  test("a second repeater's row is added to the map, and the first's is kept", () => {
    activeTab.value!.doc.document.children = [
      { $prototype: "Array", items: ["a", "b", "c"], map: { tagName: "li" } },
      { $prototype: "Array", items: ["a", "b", "c"], map: { tagName: "li" } },
    ];
    const tab = activeTab.value!;
    void registry.run("canvas.setActiveRow", { path: ["children", 0], row: 2 });
    void registry.run("canvas.setActiveRow", { path: ["children", 1], row: 1 });
    expect(tab.session.ui.activeRows).toEqual({ '["children",0]': 2, '["children",1]': 1 });
  });

  test("refuses a path that names no repeater, and a row that is no index", () => {
    withRepeater();
    const tab = activeTab.value!;
    expect(() => registry.run("canvas.setActiveRow", { path: ["children", 1], row: 0 })).toThrow(
      /names no repeater/u,
    );
    expect(() => registry.run("canvas.setActiveRow", { path: ["children", 9], row: 0 })).toThrow(
      /names no repeater/u,
    );
    expect(() => registry.run("canvas.setActiveRow", { path: LIST, row: -1 })).toThrow();
    expect(() => registry.run("canvas.setActiveRow", { path: LIST, row: 1.5 })).toThrow();
    expect(() => registry.run("canvas.setActiveRow", { path: LIST })).toThrow();
    expect(tab.session.ui.activeRows).toEqual({});
  });

  test("names the pane whose tab it means", () => {
    withRepeater();
    const tab = activeTab.value!;
    splitRight();
    focusPane(PRIMARY_PANE);
    void registry.run("canvas.setActiveRow", { pane: SECONDARY_PANE, path: LIST, row: 1 });
    expect(tab.session.ui.activeRows).toEqual({ [KEY]: 1 });
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  });
});

describe("canvas.setRepeaterRows", () => {
  test("sets the cap and repaints the pane, once: the cap decides which nodes exist", () => {
    const tab = activeTab.value!;
    expect(tab.session.ui.repeaterRows).toBe(24);
    void registry.run("canvas.setRepeaterRows", { rows: 60 });
    expect(tab.session.ui.repeaterRows).toBe(60);
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // Saying it again is not a second render.
    void registry.run("canvas.setRepeaterRows", { rows: 60 });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
  });

  test("refuses a cap that is not a whole number of rows in range", () => {
    const run = (rows: number | string) => () => registry.run("canvas.setRepeaterRows", { rows });
    for (const rows of [0, -4, 2.5, 1001, "many"]) {
      expect(run(rows)).toThrow();
    }
    expect(activeTab.value?.session.ui.repeaterRows).toBe(24);
    expect(renderedPanes).toEqual([]);
  });
});

describe("canvas.setStateValue", () => {
  /** A document with one entry of every kind the command has to tell apart. */
  function withState(): Tab {
    closeAllTabs();
    return openTab({
      document: {
        state: {
          double: "${state.count * 2}",
          load: { $prototype: "Request", url: "/api" },
          menu: { default: false, type: "boolean" },
          count: 1,
          total: { $export: "sum", $src: "./sum.js", timing: "server" },
        },
        tagName: "div",
      },
      documentPath: "/project/components/menu.json",
      id: "state-tab",
    });
  }

  test("sets a value for the canvas and repaints the pane, once, without touching the document", () => {
    const tab = withState();
    const before = JSON.stringify(tab.doc.document);
    void registry.run("canvas.setStateValue", { key: "menu", value: true });
    expect(tab.session.ui.stateValues).toEqual({ menu: true });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // Saying it again is not a second render: the verb names the state it ends in.
    void registry.run("canvas.setStateValue", { key: "menu", value: true });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // View state only: the document is as it was, clean, with nothing to undo.
    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(tab.doc.dirty).toBe(false);
    expect(tab.history.index).toBe(0);
  });

  test("takes any JSON, and null clears the one key", () => {
    const tab = withState();
    void registry.run("canvas.setStateValue", { key: "count", value: { nested: [1, 2] } });
    void registry.run("canvas.setStateValue", { key: "menu", value: true });
    expect(tab.session.ui.stateValues).toEqual({ count: { nested: [1, 2] }, menu: true });
    renderedPanes.length = 0;
    void registry.run("canvas.setStateValue", { key: "count", value: null });
    expect(tab.session.ui.stateValues).toEqual({ menu: true });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // Clearing what is not set renders nothing.
    void registry.run("canvas.setStateValue", { key: "count", value: null });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
  });

  test("refuses a key that is not a plain value, naming the ones that are", () => {
    const tab = withState();
    const setting = (key: string) => () => registry.run("canvas.setStateValue", { key, value: 1 });
    for (const key of ["double", "load", "total", "missing"]) {
      expect(setting(key)).toThrow(
        `command "canvas.setStateValue" argument "key": "${key}" is not a plain state value of ` +
          "this document. Its plain values: menu, count",
      );
    }
    expect(tab.session.ui.stateValues).toEqual({});
    expect(renderedPanes).toEqual([]);
  });

  test("clears a value whose entry is gone, where setting one would be refused", () => {
    const tab = withState();
    tab.session.ui.stateValues = { gone: 1 };
    void registry.run("canvas.setStateValue", { key: "gone", value: null });
    expect(tab.session.ui.stateValues).toEqual({});
  });

  test("needs both arguments, and names the pane whose tab it means", () => {
    const tab = withState();
    expect(() => registry.run("canvas.setStateValue", { key: "menu" })).toThrow();
    expect(() => registry.run("canvas.setStateValue", { value: true })).toThrow();
    splitRight();
    focusPane(PRIMARY_PANE);
    void registry.run("canvas.setStateValue", { key: "menu", pane: SECONDARY_PANE, value: true });
    expect(tab.session.ui.stateValues).toEqual({ menu: true });
    expect(renderedPanes).toEqual([SECONDARY_PANE]);
  });
});

describe("canvas.setSwitchCase", () => {
  const SWITCH: JxPath = ["children", 0];

  /** A document whose first child is a two-case `$switch`. */
  function withSwitch(): Tab {
    closeAllTabs();
    return openTab({
      document: {
        children: [
          {
            $switch: { $ref: "#/state/tab" },
            cases: { one: { tagName: "p" }, two: { tagName: "p" } },
            tagName: "div",
          },
          { tagName: "p", textContent: "Not a switch" },
        ],
        state: { tab: "one" },
        tagName: "main",
      },
      documentPath: "/project/components/tabs.json",
      id: "switch-tab",
    });
  }

  test("draws the named case, once, and writes nothing to the document", () => {
    const tab = withSwitch();
    const before = JSON.stringify(tab.doc.document);
    void registry.run("canvas.setSwitchCase", { case: "two", path: SWITCH });
    expect(tab.session.ui.switchCases).toEqual({ [JSON.stringify(SWITCH)]: "two" });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // Saying it again is not a second render.
    void registry.run("canvas.setSwitchCase", { case: "two", path: SWITCH });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(tab.doc.dirty).toBe(false);
    expect(tab.history.index).toBe(0);
  });

  test("null draws the switch's own case again, and clearing nothing renders nothing", () => {
    const tab = withSwitch();
    void registry.run("canvas.setSwitchCase", { case: "two", path: SWITCH });
    renderedPanes.length = 0;
    void registry.run("canvas.setSwitchCase", { case: null, path: SWITCH });
    expect(tab.session.ui.switchCases).toEqual({});
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    void registry.run("canvas.setSwitchCase", { case: null, path: SWITCH });
    expect(renderedPanes).toEqual([PRIMARY_PANE]);
    // A choice left behind by a switch since deleted can still be cleared.
    tab.session.ui.switchCases = { [JSON.stringify(["children", 9])]: "x" };
    void registry.run("canvas.setSwitchCase", { case: null, path: ["children", 9] });
    expect(tab.session.ui.switchCases).toEqual({});
  });

  test("refuses a path that is no switch and a case the switch does not have", () => {
    const tab = withSwitch();
    expect(() =>
      registry.run("canvas.setSwitchCase", { case: "one", path: ["children", 1] }),
    ).toThrow('command "canvas.setSwitchCase" argument "path": names no $switch in this document');
    expect(() => registry.run("canvas.setSwitchCase", { case: "three", path: SWITCH })).toThrow(
      'command "canvas.setSwitchCase" argument "case": "three" is not a case of this switch. ' +
        "Its cases: one, two",
    );
    expect(tab.session.ui.switchCases).toEqual({});
    expect(renderedPanes).toEqual([]);
  });
});

describe("canvas.setTagPopover", () => {
  /** A document with a bound heading and a bound image. */
  function withTags(): Tab {
    closeAllTabs();
    return openTab({
      document: {
        children: [
          { tagName: "h1", textContent: "${state.title} by ${state.author ?? ''}" },
          { attributes: { src: "${state.cover}" }, tagName: "img" },
          { tagName: "p", textContent: "Plain" },
        ],
        state: { author: "A", cover: "/c.png", title: "T" },
        tagName: "main",
      },
      documentPath: "/project/pages/post.json",
      id: "tag-tab",
    });
  }

  test("opens the tag it names, and null closes it, with the document untouched", () => {
    const tab = withTags();
    const before = JSON.stringify(tab.doc.document);
    const tag = { index: 1, path: ["children", 0], slot: ["textContent"] };
    void registry.run("canvas.setTagPopover", { tag });
    expect(tab.session.ui.tagPopover).toEqual(tag);
    // The same tag again is the same state: the object the tab holds is not replaced.
    const held = tab.session.ui.tagPopover;
    void registry.run("canvas.setTagPopover", { tag });
    expect(tab.session.ui.tagPopover).toBe(held);
    void registry.run("canvas.setTagPopover", { tag: null });
    expect(tab.session.ui.tagPopover).toBeNull();
    void registry.run("canvas.setTagPopover", { tag: null });
    expect(tab.session.ui.tagPopover).toBeNull();
    expect(JSON.stringify(tab.doc.document)).toBe(before);
    expect(tab.doc.dirty).toBe(false);
    expect(tab.history.index).toBe(0);
    // Opening and closing a popover is no render.
    expect(renderedPanes).toEqual([]);
  });

  test("the index defaults to the first tag, and another tag replaces the open one", () => {
    const tab = withTags();
    void registry.run("canvas.setTagPopover", {
      tag: { path: ["children", 1], slot: ["attributes", "src"] },
    });
    expect(tab.session.ui.tagPopover).toEqual({
      index: 0,
      path: ["children", 1],
      slot: ["attributes", "src"],
    });
    void registry.run("canvas.setTagPopover", {
      tag: { index: 0, path: ["children", 0], slot: ["textContent"] },
    });
    expect(tab.session.ui.tagPopover?.path).toEqual(["children", 0]);
  });

  test("refuses a place the node holds no tag, naming the tags it does hold", () => {
    const tab = withTags();
    expect(() =>
      registry.run("canvas.setTagPopover", {
        tag: { index: 2, path: ["children", 0], slot: ["textContent"] },
      }),
    ).toThrow(
      'command "canvas.setTagPopover" argument "tag": the node holds no tag there. ' +
        'Its tags: ["textContent"]#0, ["textContent"]#1',
    );
    expect(() =>
      registry.run("canvas.setTagPopover", {
        tag: { index: 0, path: ["children", 2], slot: ["textContent"] },
      }),
    ).toThrow("Its tags: none");
    expect(tab.session.ui.tagPopover).toBeNull();
  });

  test("refuses an argument that is not an address", () => {
    withTags();
    const opening = (tag: CommandArgValues[string]) => () =>
      registry.run("canvas.setTagPopover", { tag });
    const refusal =
      'command "canvas.setTagPopover" argument "tag": expected { path, slot, index } or null';
    expect(opening({ path: "children", slot: ["src"] })).toThrow(refusal);
    expect(opening({ path: [], slot: [{}] })).toThrow(refusal);
    expect(opening({ index: 1.5, path: [], slot: [] })).toThrow(refusal);
    expect(opening({ path: [] })).toThrow(refusal);
    expect(() => registry.run("canvas.setTagPopover", {})).toThrow();
  });
});

describe("canvas.setMode", () => {
  test("sets the mode of the active tab", () => {
    void registry.run("canvas.setMode", { mode: "edit" });
    expect(setCanvasMode.mock.calls[0]?.[0]).toBe(activeTab.value);
    expect(setCanvasMode.mock.calls[0]?.[1]).toBe("edit");
  });

  test("refuses the retired preview mode by name", () => {
    expect(() => registry.run("canvas.setMode", { mode: "preview" })).toThrow();
    expect(setCanvasMode).not.toHaveBeenCalled();
  });

  test("refuses a mode the open document does not declare", () => {
    openWith(["grid", "source"]);
    expect(() => registry.run("canvas.setMode", { mode: "design" })).toThrow(
      'command "canvas.setMode" argument "mode": "design" is not a mode this document ' +
        "supports — it declares: grid, source",
    );
  });

  /* Diff is implicit (studio.md §3): a comparison is entered by choosing a changed file or a
     version in Publish. Even a document that declares the mode cannot be put into it by name. */
  test("refuses git-diff by name, even over a document that declares it", () => {
    openWith(["edit", "design", "git-diff"]);
    expect(() => registry.run("canvas.setMode", { mode: "git-diff" })).toThrow(
      '"git-diff" is not declared',
    );
    expect(setCanvasMode).not.toHaveBeenCalled();
  });

  test("refuses an undeclared mode string", () => {
    expect(() => registry.run("canvas.setMode", { mode: "zen" })).toThrow('"zen" is not declared');
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    expect(() => registry.run("canvas.setMode", { mode: "edit" })).toThrow(
      "needs an open document; no tab is active",
    );
  });

  /*
   * The DOCUMENT is the only thing that can refuse a mode.
   *
   * This used to refuse a second one: the side pane was capped to Code, Diff, Config, Entry, Grid
   * and Library, so `canvas.setMode { mode: "design" }` threw a sentence telling you to unsplit
   * first. The cap existed because a second live Canvas host was unaffordable, and it is gone —
   * `panels/pane-grid.ts` draws a stage per pane and `canvas/surface-registry.ts` gives each its
   * own panels, mode, pan and render generation. A Canvas in the side pane is the object the
   * primary has always had.
   */
  test("a Canvas mode goes through in the side pane — the cap that refused it is lifted", () => {
    openWith(["edit", "design", "source"]);
    splitRight();
    expect(workspace.activePaneId).toBe(SECONDARY_PANE);
    void registry.run("canvas.setMode", { mode: "design" });
    expect(setCanvasMode).toHaveBeenCalledWith(activeTab.value, "design");
    void registry.run("canvas.setMode", { mode: "source" });
    expect(setCanvasMode).toHaveBeenCalledWith(activeTab.value, "source");
  });
});

describe("canvas.setZoom", () => {
  test("writes the pan-zoom on the active tab", () => {
    void registry.run("canvas.setZoom", { zoom: 0.6 });
    expect(activeTab.value?.session.ui.zoom).toBe(0.6);
  });

  test("REJECTS out of range rather than clamping to the maximum", () => {
    expect(() => registry.run("canvas.setZoom", { zoom: PAN_ZOOM_MAX + 1 })).toThrow(
      "outside the supported range",
    );
    expect(() => registry.run("canvas.setZoom", { zoom: PAN_ZOOM_MIN / 2 })).toThrow(
      "outside the supported range",
    );
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    expect(() => registry.run("canvas.setZoom", { zoom: 1 })).toThrow("needs an open document");
  });
});

describe("canvas.setFit", () => {
  test("declares each named fit on the active document", () => {
    for (const fit of ["width", "page", "none"] as const) {
      void registry.run("canvas.setFit", { fit });
      expect(getFit()).toBe(fit);
    }
    expect(hasDeclaredFit()).toBe(true);
  });

  test('a number is a fit — "the author chose 84%" is the fit 0.84', () => {
    void registry.run("canvas.setFit", { fit: 0.84 });
    expect(getFit()).toBe(0.84);
  });

  test("REJECTS a word that is not a fit and a scale outside the range", () => {
    // The runner maps `open.fit` straight onto this record, so a typo in a manifest has to fail the
    // Shot rather than silently leave the document at whatever the last one framed it as.
    expect(() => registry.run("canvas.setFit", { fit: "fill" })).toThrow('argument "fit"');
    expect(() => registry.run("canvas.setFit", { fit: PAN_ZOOM_MAX + 1 })).toThrow(
      'argument "fit"',
    );
    expect(() => registry.run("canvas.setFit", { fit: null })).toThrow('argument "fit"');
    expect(hasDeclaredFit()).toBe(false);
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    expect(() => registry.run("canvas.setFit", { fit: "page" })).toThrow("needs an open document");
  });
});

describe("canvas.fitPage", () => {
  test("declares the page fit and is placed in the status bar's zoom field and the palette", () => {
    void registry.run("canvas.setFit", { fit: "width" });
    expect(getFit()).toBe("width");
    void registry.run("canvas.fitPage");
    expect(getFit()).toBe("page");
    const record = registry.get("canvas.fitPage");
    expect(record?.menus).toEqual(["statusbar/zoom", "palette"]);
    expect(record?.level).toBe("document");
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    expect(() => registry.run("canvas.fitPage")).toThrow("needs an open document");
  });
});

describe("canvas.setEditWidth", () => {
  /** A desktop-first document, so the bands below read the way a starter's do. */
  const withWidths = () => {
    const tab = openWith(["edit", "design"]);
    tab.doc.document.$media = {
      "--": "1200px",
      "--md": "(max-width: 768px)",
    };
    return tab;
  };

  test("records the width, derives the breakpoint, and repaints the pane it wrote", () => {
    canvasMode = "edit";
    const tab = withWidths();
    renderedPanes.length = 0;
    void registry.run("canvas.setEditWidth", { width: 700 });
    expect(editWidthOfPane(workspace.activePaneId, tab)).toBe(700);
    expect(tab.session.ui.activeMedia).toBe("--md");
    expect(renderedPanes).toEqual([workspace.activePaneId]);
  });

  test("null gives the column back to the chosen breakpoint", () => {
    canvasMode = "edit";
    const tab = withWidths();
    void registry.run("canvas.setEditWidth", { width: 700 });
    expect(editWidthOfPane(workspace.activePaneId, tab)).toBe(700);
    void registry.run("canvas.setEditWidth", { width: null });
    expect(editWidthOfPane(workspace.activePaneId, tab)).toBeNull();
  });

  test("addresses the pane it is given, not the focused one", () => {
    canvasMode = "edit";
    withWidths();
    splitRight();
    focusPane(PRIMARY_PANE);
    renderedPanes.length = 0;
    void registry.run("canvas.setEditWidth", { pane: SECONDARY_PANE, width: 700 });
    expect(renderedPanes).toEqual([SECONDARY_PANE]);
    expect(workspace.activePaneId).toBe(PRIMARY_PANE);
  });

  test("is disabled outside edit mode, with a reason", () => {
    canvasMode = "design";
    expect(registry.isEnabled("canvas.setEditWidth")).toBe(false);
    expect(registry.disabledReason("canvas.setEditWidth")).toBe("a document in edit mode");
  });

  test("refuses a width below the floor", () => {
    canvasMode = "edit";
    withWidths();
    expect(() => registry.run("canvas.setEditWidth", { width: EDIT_WIDTH_MIN - 1 })).toThrow(
      "outside the supported range",
    );
  });

  test("refuses when no tab is open", () => {
    canvasMode = "edit";
    closeAllTabs();
    expect(() => registry.run("canvas.setEditWidth", { width: 700 })).toThrow(
      "needs an open document",
    );
  });
});

describe("canvas.setEditZoom", () => {
  test("writes the content zoom when the pane is in edit mode", () => {
    canvasMode = "edit";
    void registry.run("canvas.setEditZoom", { zoom: 1.5 });
    expect(activeTab.value?.session.ui.editZoom).toBe(1.5);
  });

  test("is disabled outside edit mode, with a reason", () => {
    canvasMode = "design";
    expect(registry.isEnabled("canvas.setEditZoom")).toBe(false);
    expect(registry.disabledReason("canvas.setEditZoom")).toBe("a document in edit mode");
  });

  test("rejects a zoom outside the edit range", () => {
    canvasMode = "edit";
    expect(() => registry.run("canvas.setEditZoom", { zoom: EDIT_ZOOM_MAX + 1 })).toThrow(
      "outside the supported range",
    );
    expect(() => registry.run("canvas.setEditZoom", { zoom: EDIT_ZOOM_MIN - 0.01 })).toThrow(
      "outside the supported range",
    );
  });

  test("refuses when no tab is open", () => {
    canvasMode = "edit";
    closeAllTabs();
    expect(() => registry.run("canvas.setEditZoom", { zoom: 1 })).toThrow("needs an open document");
  });
});

/*
 * `insert.data` — the manifest's `element.insertData`, which had no record and was reached by
 * clicking the block action bar's Insert-data button and then a row in the menu it opens. §13.5
 * refuses that shape outright ("the ITEM is the command"), so the record takes the token.
 */
describe("insert.data", () => {
  const BOUND_DOC = {
    children: [
      {
        $prototype: "Array",
        items: { $ref: "#/state/posts" },
        map: { children: [{ tagName: "h3", textContent: "Post title" }], tagName: "article" },
      },
    ],
    state: { posts: { $prototype: "ContentCollection", contentType: "posts" } },
    tagName: "div",
  };

  function openBound() {
    closeAllTabs();
    return openTab({
      capabilities: { modes: ["edit", "design"] },
      document: structuredClone(BOUND_DOC),
      documentPath: "pages/blog.json",
      id: "bound",
    });
  }

  beforeEach(() => {
    formatIntents.length = 0;
    caretPath = null;
    // `inCanvas`, not just `active`: the record is gated on the CANVAS's caret, because a caret in
    // A parent-realm text field (the Inspector's href box) is not somewhere a token can land.
    ctx = makeContext({ caret: { active: true, inCanvas: true }, document: { open: true } });
    openBound();
  });

  test("insert.openSlashMenu asks the frame to open the menu, and refuses without a caret", () => {
    /* The record the "/" gesture never had. The gesture itself was recognised at the BLOCK while
       the editing host is the container, so it fired for nobody — and the shot of the menu spent a
       release quarantined saying the controller "does not respond to a synthetic keydown", when in
       truth nothing responded to a real one. The gesture is fixed at the host; this is the door
       that lets the palette, a rebound chord and the manifest reach the same menu by name. */
    const record = registry.get("insert.openSlashMenu");
    expect(record?.level).toBe("selection");
    expect(record?.keyScope).toBe("caret");
    expect(record?.requires).toBe("a live text caret in the canvas");
    expect(registry.isVisible("insert.openSlashMenu")).toBe(true);
    void registry.run("insert.openSlashMenu");
    expect(formatIntents).toEqual([{ command: "openSlash" }]);

    // A caret in a parent-realm text field is not a caret in the page: `caret.active` is true for
    // Both, and `inCanvas` is the one this record reads.
    ctx = makeContext({ caret: { active: true }, document: { open: true } });
    expect(registry.isVisible("insert.openSlashMenu")).toBe(false);
  });

  test("is hidden without a live caret — a token has nowhere to land", () => {
    ctx = makeContext({ document: { open: true } });
    expect(registry.isVisible("insert.data")).toBe(false);
    expect(registry.get("insert.data")?.requires).toBe("a live text caret in the canvas");
  });

  test("posts the insertData intent for a state token the document defines", () => {
    void registry.run("insert.data", { token: "state.posts" });
    expect(formatIntents).toEqual([{ command: "insertData", token: "state.posts" }]);
  });

  test("accepts a nested walk under a defined state entry", () => {
    void registry.run("insert.data", { token: "state.posts.length" });
    expect(formatIntents).toHaveLength(1);
  });

  test("refuses a state entry the document does not define, listing what it does", () => {
    expect(() => registry.run("insert.data", { token: "state.authors" })).toThrow(
      'command "insert.data" argument "token": "state.authors" names no state entry — this ' +
        "document defines: posts",
    );
    expect(formatIntents).toEqual([]);
  });

  test('a bare "state" names no entry either', () => {
    expect(() => registry.run("insert.data", { token: "state" })).toThrow("names no state entry");
  });

  test("accepts item/index when the caret sits inside a repeater template", () => {
    caretPath = ["children", 0, "map", "children", 0];
    void registry.run("insert.data", { token: "item.data.title" });
    void registry.run("insert.data", { token: "index" });
    expect(formatIntents.map((i) => i.token)).toEqual(["item.data.title", "index"]);
  });

  test("falls back to the element selection when no caret snapshot is reported", () => {
    activeTab.value!.session.selection = [["children", 0, "map", "children", 0]];
    void registry.run("insert.data", { token: "item" });
    expect(formatIntents).toHaveLength(1);
  });

  test("refuses a repeater-scope token outside a repeater template", () => {
    expect(() => registry.run("insert.data", { token: "item.data.title" })).toThrow(
      "is a repeater-scope token, and the caret is not inside a repeater template",
    );
  });

  test("refuses a token that binds to nothing the vocabulary has", () => {
    expect(() => registry.run("insert.data", { token: "window.location" })).toThrow(
      'is not an insertable token — a token reads "state.<name>", "item", "item.<field>" or ' +
        '"index"',
    );
  });

  test("refuses an empty token rather than inserting an empty placeholder", () => {
    expect(() => registry.run("insert.data", { token: "" })).toThrow("expected a non-empty string");
  });

  test("refuses when no document is open", () => {
    closeAllTabs();
    expect(() => registry.run("insert.data", { token: "state.posts" })).toThrow(
      "needs an open document",
    );
  });
});

describe("selection.set", () => {
  test("selects a node the document holds", () => {
    void registry.run("selection.set", { path: ["children", 0] });
    expect(activeTab.value?.session.selection).toEqual([["children", 0]]);
  });

  test("the empty path is the document root, not an absence", () => {
    void registry.run("selection.set", { path: [] });
    expect(activeTab.value?.session.selection).toEqual([[]]);
  });

  test("null clears the selection", () => {
    void registry.run("selection.set", { path: ["children", 0] });
    void registry.run("selection.set", { path: null });
    expect(activeTab.value?.session.selection).toEqual([]);
  });

  test("refuses a path that addresses nothing, naming the document", () => {
    expect(() => registry.run("selection.set", { path: ["children", 9] })).toThrow(
      'command "selection.set" argument "path": [children, 9] addresses no node in ' +
        "pages/index.json",
    );
    expect(activeTab.value?.session.selection).toEqual([]);
  });

  test("refuses a path that is not an array", () => {
    // `path` is `oneOf: [path, null]`, and `registry.run` coerces against it before `run`: a string
    // Fits neither branch, so the refusal lists both shapes rather than pathArg's alone.
    expect(() => registry.run("selection.set", { path: "children/0" })).toThrow(
      'command "selection.set" argument "path": expected a document path or null, got "children/0"',
    );
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    ctx = makeContext({ document: { open: true } });
    expect(() => registry.run("selection.set", { path: [] })).toThrow("needs an open document");
  });

  test("is hidden with no document", () => {
    ctx = makeContext();
    expect(registry.isVisible("selection.set")).toBe(false);
  });

  test("a tab whose documentPath is null still names itself in the refusal", () => {
    closeAllTabs();
    openTab({ document: structuredClone(DOC), documentPath: null, id: "virtual" });
    expect(() => registry.run("selection.set", { path: ["nope"] })).toThrow("the open document");
  });
});

describe("selection.setPaths", () => {
  test("selects several nodes, last one primary and first one anchor", () => {
    void registry.run("selection.setPaths", {
      paths: [
        ["children", 0],
        ["children", 0, "children", 0],
      ],
    });
    expect(activeTab.value?.session.selection).toEqual([
      ["children", 0],
      ["children", 0, "children", 0],
    ]);
  });

  test("one path in is exactly what selection.set would have done", () => {
    void registry.run("selection.setPaths", { paths: [["children", 0]] });
    const many = activeTab.value?.session.selection;
    void registry.run("selection.set", { path: ["children", 0] });
    expect(many).toEqual(activeTab.value!.session.selection);
  });

  test("[] selects nothing — the same state selection.set { path: null } reaches", () => {
    void registry.run("selection.set", { path: ["children", 0] });
    void registry.run("selection.setPaths", { paths: [] });
    expect(activeTab.value?.session.selection).toEqual([]);
  });

  test("is idempotent: the same list twice lands on the same selection", () => {
    const args = {
      paths: [
        ["children", 0],
        ["children", 0, "children", 0],
      ],
    };
    void registry.run("selection.setPaths", args);
    const first = JSON.stringify(activeTab.value?.session.selection);
    void registry.run("selection.setPaths", args);
    expect(JSON.stringify(activeTab.value?.session.selection)).toBe(first);
  });

  test("a repeated path is deduplicated, keeping the first occurrence", () => {
    void registry.run("selection.setPaths", {
      paths: [
        ["children", 0],
        ["children", 0, "children", 0],
        ["children", 0],
      ],
    });
    expect(activeTab.value?.session.selection).toEqual([
      ["children", 0],
      ["children", 0, "children", 0],
    ]);
  });

  test("refuses a path that addresses nothing, naming it and the document", () => {
    expect(() =>
      registry.run("selection.setPaths", {
        paths: [
          ["children", 0],
          ["children", 9],
        ],
      }),
    ).toThrow(
      'command "selection.setPaths" argument "paths": [children, 9] addresses no node in ' +
        "pages/index.json",
    );
  });

  test("refuses a bare path passed where a LIST of paths belongs", () => {
    expect(() => registry.run("selection.setPaths", { paths: ["children", 0] })).toThrow(
      "entry 0 is not a document path",
    );
  });

  test("refuses anything that is not an array at all", () => {
    expect(() => registry.run("selection.setPaths", { paths: "children/0" })).toThrow(
      "expected an array of document paths",
    );
  });

  test("refuses when no tab is open", () => {
    closeAllTabs();
    ctx = makeContext({ document: { open: true } });
    expect(() => registry.run("selection.setPaths", { paths: [] })).toThrow(
      "needs an open document",
    );
  });

  test("is hidden with no document", () => {
    ctx = makeContext();
    expect(registry.isVisible("selection.setPaths")).toBe(false);
  });
});

describe("the harness tab shape is what these verbs expect", () => {
  test("resetWorkspaceWithTab yields a selectable root", () => {
    resetWorkspaceWithTab();
    void registry.run("selection.set", { path: [] });
    expect(activeTab.value?.session.selection).toEqual([[]]);
  });
});

describe("the pan-zoom family agrees with itself", () => {
  /*
   * Found by driving Studio against a real site: with a Library pane focused, `canvas.setZoom` and
   * `canvas.setFit` SUCCEEDED — writing a zoom onto a surface that was not showing — in the same
   * state where `canvas.zoomIn`, `canvas.zoomOut` and `canvas.zoomReset` refused with "requires an
   * open document". Five verbs over one surface, two rules, and the two that disagreed were the
   * ones that WRITE.
   *
   * The rule is the mode, not merely the document: the status bar's zoom field is drawn for
   * exactly design / stylebook / git-diff (and Edit's own content zoom), and these records ask the
   * same question.
   */
  const PANZOOM = ["design", "stylebook", "git-diff"];
  const OFF_SURFACE = ["edit", "source", "grid"];

  beforeEach(() => {
    resetWorkspaceWithTab();
    registry = createCommandRegistry({ getContext: () => ctx });
    registry.registerAll(canvasViewCommands(deps));
    ctx = makeContext({ document: { open: true } });
  });

  test("both are available on every pan-zoom mode", () => {
    for (const mode of PANZOOM) {
      canvasMode = mode;
      expect([mode, registry.isEnabled("canvas.setZoom")]).toEqual([mode, true]);
      expect([mode, registry.isEnabled("canvas.setFit")]).toEqual([mode, true]);
      expect([mode, registry.isEnabled("canvas.fitPage")]).toEqual([mode, true]);
    }
  });

  test("and refused on every mode that has no pan-zoom surface", () => {
    for (const mode of OFF_SURFACE) {
      canvasMode = mode;
      expect([mode, registry.isEnabled("canvas.setZoom")]).toEqual([mode, false]);
      expect([mode, registry.isEnabled("canvas.setFit")]).toEqual([mode, false]);
      expect([mode, registry.isEnabled("canvas.fitPage")]).toEqual([mode, false]);
    }
  });

  test("the refusal sentence names the gate, rather than the one it used to have", () => {
    canvasMode = "edit";
    // `canvas.setFit` said "an open document" while refusing for the MODE — a sentence that sends
    // The reader to open a document they already have open.
    expect(registry.disabledReason("canvas.setFit")).toBe("a document on the pan-zoom surface");
    expect(registry.disabledReason("canvas.setZoom")).toBe("a document on the pan-zoom surface");
  });
});

describe("canvas.setPopoverOpen", () => {
  /** Give the active tab a document with one popover and select something inside it. */
  function withPopover(selection: (string | number)[][] = []) {
    const tab = activeTab.value!;
    tab.doc.document = {
      children: [
        { tagName: "button" },
        {
          attributes: { id: "menu", popover: "auto" },
          children: [{ tagName: "a" }],
          tagName: "nav",
        },
      ],
      tagName: "div",
    };
    tab.session.selection = selection;
    return tab;
  }

  test("with no argument it opens the popover the selection is in", () => {
    const tab = withPopover([["children", 1, "children", 0]]);
    void registry.run("canvas.setPopoverOpen", {});
    expect(openedPopovers).toEqual([[tab.id, ["children", 1]]]);
  });

  test("an explicit path opens that one", () => {
    const tab = withPopover();
    void registry.run("canvas.setPopoverOpen", { path: ["children", 1] });
    expect(openedPopovers).toEqual([[tab.id, ["children", 1]]]);
  });

  test("open:false with no path closes whatever is open — one record covers both", () => {
    const tab = withPopover();
    void registry.run("canvas.setPopoverOpen", { open: false });
    expect(openedPopovers).toEqual([[tab.id, null]]);
  });

  test("running it twice ends in the same state — the point of a setter over a toggle", () => {
    const tab = withPopover();
    void registry.run("canvas.setPopoverOpen", { path: ["children", 1] });
    void registry.run("canvas.setPopoverOpen", { path: ["children", 1] });
    expect(openedPopovers).toEqual([
      [tab.id, ["children", 1]],
      [tab.id, ["children", 1]],
    ]);
  });

  test("it REFUSES a path that is not a popover rather than opening nothing", () => {
    withPopover();
    expect(() => registry.run("canvas.setPopoverOpen", { path: ["children", 0] })).toThrow(
      RangeError,
    );
    expect(openedPopovers).toEqual([]);
  });

  test("and refuses when neither an argument nor the selection names one", () => {
    withPopover([["children", 0]]);
    expect(() => registry.run("canvas.setPopoverOpen", {})).toThrow(RangeError);
  });
});

describe("canvas.setDialogOpen", () => {
  /** Give the active tab a document with one dialog and select something inside it. */
  function withDialog(selection: (string | number)[][] = []) {
    const tab = activeTab.value!;
    tab.doc.document = {
      children: [
        { attributes: { command: "show-modal", commandfor: "d" }, tagName: "button" },
        { attributes: { id: "d" }, children: [{ tagName: "p" }], tagName: "dialog" },
      ],
      tagName: "div",
    };
    tab.session.selection = selection;
    return tab;
  }

  test("with no argument it opens the dialog the selection is in", () => {
    const tab = withDialog([["children", 1, "children", 0]]);
    void registry.run("canvas.setDialogOpen", {});
    expect(openedDialogs).toEqual([[tab.id, ["children", 1]]]);
  });

  test("an explicit path opens that one, and open:false with no path closes whatever is open", () => {
    const tab = withDialog();
    void registry.run("canvas.setDialogOpen", { path: ["children", 1] });
    void registry.run("canvas.setDialogOpen", { open: false });
    expect(openedDialogs).toEqual([
      [tab.id, ["children", 1]],
      [tab.id, null],
    ]);
  });

  test("it REFUSES a path that is not a dialog, and a selection outside every dialog", () => {
    withDialog([["children", 0]]);
    expect(() => registry.run("canvas.setDialogOpen", { path: ["children", 0] })).toThrow(
      RangeError,
    );
    expect(() => registry.run("canvas.setDialogOpen", {})).toThrow(RangeError);
    expect(openedDialogs).toEqual([]);
  });

  test("it is enabled only while the document holds a dialog", () => {
    const tab = activeTab.value!;
    tab.doc.document = { children: [], tagName: "div" };
    expect(registry.isEnabled("canvas.setDialogOpen")).toBe(false);
    withDialog();
    expect(registry.isEnabled("canvas.setDialogOpen")).toBe(true);
  });
});
