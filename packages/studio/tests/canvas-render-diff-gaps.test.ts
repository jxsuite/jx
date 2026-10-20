/**
 * Canvas render — the NON-IFRAME editor dispatches and the guards around them.
 *
 * The Content home and Entry are the modes whose panel owns its own reactivity: the render hands
 * the stage over once and every later repaint of the same tab must stop at the fast path instead of
 * rebuilding the pane. Both halves are asserted here — the hand-over (stage styling, the surface
 * and tab the panel was drawn for, and the `return` that keeps the design artboards off the stage)
 * and the fast path (a second repaint that draws nothing).
 *
 * Plus the one interactive affordance a stale COMPANION offers — Pin, which ends the follow — and
 * the two early returns in `canvas/surface-registry.ts`.
 *
 * The panel modules are mocked exactly as `canvas-render-gaps.test.ts` mocks the grid panel: a spy
 * that records the surface and tab it was handed, and a mounted-set the render path can then
 * observe. The real panels are unit-tested in `library-pane.test.ts` and `entry-editor.test.ts`;
 * what is under test here is the dispatch. Project Settings is not a canvas mode any more: it is a
 * dialog (§17.1), and a tab that names the retired `settings` mode is drawn as any unknown mode
 * is.
 */
import {
  flush,
  pointer,
  registerPrimaryStage,
  resetStudioState,
  resetWorkspaceWithTab,
} from "./harness";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { initShellRefs } from "../src/store";
import {
  PRIMARY_PANE,
  SECONDARY_PANE,
  activeTab,
  closeAllTabs,
  openTab,
  paneById,
  workspace,
} from "../src/workspace/workspace";
import {
  allCanvasSurfaces,
  registerCanvasSurface,
  setSurfaceTeardown,
  stageContaining,
  surfaceForPane,
  unregisterCanvasSurface,
} from "../src/canvas/surface-registry";
import { setFormats } from "../src/format/format-host";
import type { CanvasSurface } from "../src/canvas/surface-registry";
import type { Tab } from "../src/tabs/tab";
import type { JsonSchema } from "../src/ui/schema-form";

// ─── Controllable mock behavior ───────────────────────────────────────────────

void mock.module("monaco-editor/editor", () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  editor: {
    create: () => null,
    createModel: () => null,
    setModelMarkers: () => {},
  },
}));

void mock.module("../src/canvas/canvas-live-render.js", () => ({
  initCanvasLiveRender: () => {},
  resolveCanvasDocument: () => Promise.resolve(null),
}));

void mock.module("../src/canvas/iframe-host.js", () => ({
  adoptCanvasPreviewMode: () => {},
  commitActiveEditSession: () => {},
  /* Stubbed although this file never calls them: a PARTIAL mock of a module the graph reaches is a
     load error rather than a missing stub at call time. */
  canvasIdleBlockers: () => [],
  canvasPointAt: () => Promise.resolve(null),
  revealCanvasPath: () => Promise.resolve(null),
  getEditBarAnchorRect: () => null,
  getEditSnapshot: () => ({ editing: false, snapshot: null }),
  mountIframeCanvas: () => Promise.resolve(),
  postApplyFormat: () => {},
  postOpenSlash: () => {},
  postRedefineElementToLiveHosts: () => 0,
  postStyleUpdateToStylebookHosts: () => 0,
  postSiteStyleToLiveHosts: () => 0,
  releaseCanvasHosts: () => 0,
  requestCanvasEval: () => Promise.resolve(null),
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
  openLogicTarget: () => {},
  renderFormulaWorkspace: () => {},
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
}));

void mock.module("../src/files/file-ops.js", () => ({
  parseSourceForPath: async () => ({ document: { tagName: "div" }, frontmatter: {} }),
  serializeDocument: async () => "{}",
  confirmFileDelete: () => Promise.resolve(false),
  renamePromptMessage: () => Promise.resolve(""),
  saveFile: () => Promise.resolve(true),
}));

void mock.module("../src/grid/grid-panel.js", () => ({
  detachGridPanel: () => {},
  gridPanelMounted: () => false,
  renderGridMode: () => {},
}));

/**
 * A stand-in panel module: it marks itself mounted for the pane it drew into, stamps a marker into
 * that pane's stage, and forgets the pane when detached — the same three facts the real Content
 * home and Entry panes expose to the render path. A test can therefore count markers to see whether
 * a repaint rebuilt the pane.
 */
function panelDouble(marker: string) {
  const mounted = new Map<string, Tab | null>();
  const render = mock((surface: CanvasSurface, tab: Tab | null = null) => {
    mounted.set(surface.paneId, tab);
    const el = document.createElement("div");
    el.className = marker;
    surface.wrap.append(el);
  });
  const detach = mock((paneId: string) => {
    mounted.delete(paneId);
  });
  return { detach, mounted, render };
}

/* The Content home is drawn by `workspace/workspace-home.ts`, which routes the Content home TAB to
   `browse/library-pane.ts`; this double stands in for that module. */
const library = panelDouble("library-marker");
void mock.module("../src/browse/library-pane.js", () => ({
  detachLibraryPane: library.detach,
  invalidateLibrary: () => {},
  libraryPaneMounted: (paneId: string, tab: Tab) => library.mounted.get(paneId) === tab,
  refreshLibrary: () => Promise.resolve(),
  renderLibraryMode: library.render,
  resetContentView: () => {},
  setLibraryLayout: () => {},
  setLibrarySearch: () => {},
}));

const entry = panelDouble("entry-marker");
void mock.module("../src/content/entry-editor.js", () => ({
  ENTRY_MODE: "entry",
  absentRequiredErrors: () => ({}),
  detachEntryPane: entry.detach,
  formContext: () => ({}),
  entryDraftPill: () => null,
  entryPaneMounted: (paneId: string, tab: Tab) => entry.mounted.get(paneId) === tab,
  fieldLabels: () => ({}),
  openEntryEditor: () => Promise.resolve(null),
  renderEntryMode: entry.render,
  setEntryDraft: () => {},
  titleFirst: (schema: JsonSchema) => schema,
}));

const { initCanvasRender, renderCanvas } = await import("../src/canvas/canvas-render");
const { createCommandRegistry } = await import("../src/commands/registry");
const { makeContext } = await import("../src/commands/context");
const { setActiveRegistry } = await import("../src/commands/active-registry");
const { derivationCommands, noopDerivationDeps } = await import("../src/workspace/pane-derive");

// ─── Test context ─────────────────────────────────────────────────────────────

/** The focused pane's stage. Panels belong to a pane's surface, and the array identity is stable. */
const canvasPanels = surfaceForPane(PRIMARY_PANE).panels;

/** The render composes the effective mode from the PANE's own tab (`canvasModeOfPane`). */
function setMode(mode: string) {
  const tab = activeTab.value;
  if (tab) {
    tab.session.ui.canvasMode = mode;
  }
}

/** Put the Content home's own tab in the pane, in its mode. */
function showContentHome() {
  closeAllTabs();
  openTab({
    capabilities: { modes: ["content-home"] },
    document: { children: [], tagName: "div" },
    documentPath: null,
    id: "workspace://content",
  });
  setMode("content-home");
}

function stage(): HTMLElement {
  return surfaceForPane(PRIMARY_PANE).wrap;
}

function setupShell() {
  document.body.innerHTML = "";
  for (const id of ["activity-bar", "left-panel", "right-panel", "toolbar"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  initShellRefs();
  registerPrimaryStage();
}

beforeEach(() => {
  setupShell();
  resetStudioState({ isSiteProject: true });
  closeAllTabs();
  setFormats([]);
  for (const double of [library, entry]) {
    double.render.mockClear();
    double.detach.mockClear();
    double.mounted.clear();
  }
  canvasPanels.length = 0;
  const surface = surfaceForPane(PRIMARY_PANE);
  surface.prevCanvasMode = null;
  surface.panzoomWrap = null;
  surface.monacoEditor = null;
  surface.centerObserver = null;
  surface.renderGeneration = 0;
  initCanvasRender({
    gitDiffState: null,
    openFileFromTree: () => {},
    setCanvasMode: (_tab: Tab | null, mode: string) => setMode(mode),
    setGitDiffState: () => {},
  });
  resetWorkspaceWithTab();
});

afterEach(() => {
  closeAllTabs();
});

// ─── The non-iframe editor modes ──────────────────────────────────────────────

describe("the modes whose panel owns its own reactivity", () => {
  test("the retired settings mode hands the stage to no editor of its own", async () => {
    setMode("settings");
    renderCanvas();
    await flush();

    // Nothing claims it: no panel double ran, and the stage was not styled for a full-bleed editor.
    expect(library.render).not.toHaveBeenCalled();
    expect(entry.render).not.toHaveBeenCalled();
    expect(stage().style.display).not.toBe("block");
  });

  test("the Content home's tab hands the stage to the Content home, and draws nothing else", async () => {
    showContentHome();
    renderCanvas();
    await flush();

    expect(library.render).toHaveBeenCalledTimes(1);
    const [drawnOn, tab] = library.render.mock.calls[0]!;
    expect(drawnOn).toBe(surfaceForPane(PRIMARY_PANE));
    expect(tab).toBe(activeTab.value!);
    // A home fills the stage by its own style block, so nothing is written onto the stage.
    expect(stage().style.padding).toBe("");
    expect(stage().querySelector('[part="panzoom"]')).toBeNull();
    expect(canvasPanels).toHaveLength(0);
  });

  test("the retired manage mode is no editor any more: it draws as an unknown mode does", async () => {
    setMode("manage");
    renderCanvas();
    await flush();
    expect(stage().querySelector(".library-marker")).toBeNull();
    expect(library.render).not.toHaveBeenCalled();
  });

  test("entry hands the stage to the entry form, for THIS pane's tab, and draws nothing else", async () => {
    setMode("entry");
    renderCanvas();
    await flush();

    expect(entry.render).toHaveBeenCalledTimes(1);
    const [drawnOn, tab] = entry.render.mock.calls[0]!;
    expect(drawnOn).toBe(surfaceForPane(PRIMARY_PANE));
    expect(tab).toBe(activeTab.value!);
    expect(stage().style.padding).toBe("0px");
    expect(stage().style.display).toBe("block");
    expect(stage().querySelector('[part="panzoom"]')).toBeNull();
    expect(canvasPanels).toHaveLength(0);
  });

  /* A workspace home is the real module, not a double: the Publish workspace is a standing document
     that follows its own records, so the hand-over, the stop and the fast path are all one mount. */
  test("a workspace home takes the stage, stops there, and a same-tab repaint rebuilds nothing", async () => {
    setMode("publish-home");
    renderCanvas();
    await flush(4);

    // The home fills the stage by its own style block, so nothing is written onto the stage.
    expect(stage().style.padding).toBe("");
    expect(stage().style.display).toBe("");
    expect(stage().querySelector('[part="panzoom"]')).toBeNull();
    const home = stage().querySelector('[part="publish"]');
    expect(home).not.toBeNull();

    renderCanvas();
    await flush(4);
    expect(stage().querySelector('[part="publish"]')).toBe(home);

    // Leaving the mode takes the home down with the rest of the stage.
    setMode("entry");
    renderCanvas();
    await flush(4);
    expect(stage().querySelector('[part="publish"]')).toBeNull();
    expect(entry.render).toHaveBeenCalledTimes(1);
  });

  /* THE FAST PATHS. Each panel runs its own effect scope over the document, so a same-tab repaint
     while it is mounted must draw nothing at all — a second `render*Mode` would tear the live pane
     down and rebuild it under whatever the author was doing in it. */
  test("a same-tab repaint while the Content home is mounted rebuilds nothing", async () => {
    showContentHome();
    renderCanvas();
    await flush();
    expect(stage().querySelectorAll(".library-marker")).toHaveLength(1);

    renderCanvas();
    await flush();

    expect(library.render).toHaveBeenCalledTimes(1);
    expect(stage().querySelectorAll(".library-marker")).toHaveLength(1);
  });

  test("a same-tab repaint while the entry form is mounted rebuilds nothing", async () => {
    setMode("entry");
    renderCanvas();
    await flush();
    expect(stage().querySelectorAll(".entry-marker")).toHaveLength(1);

    renderCanvas();
    await flush();

    expect(entry.render).toHaveBeenCalledTimes(1);
    expect(stage().querySelectorAll(".entry-marker")).toHaveLength(1);
  });

  /* THE CONTROL for both fast paths: the mounted panel belongs to the TAB it was drawn for. Open
     another document in the pane and the fast path is not the answer — the pane is rebuilt. */
  test("the fast path is per TAB — another document rebuilds the entry form", async () => {
    setMode("entry");
    renderCanvas();
    await flush();

    resetWorkspaceWithTab(
      { children: [], tagName: "div" },
      {
        documentPath: "/project/other.json",
        id: "other-tab",
      },
    );
    setMode("entry");
    renderCanvas();
    await flush();

    expect(entry.render).toHaveBeenCalledTimes(2);
    expect(entry.render.mock.calls[1]![1]).toBe(activeTab.value!);
  });

  /* THE OTHER CONTROL, and the one the fast paths owe: `!modeChanged`.
     A panel module answers "am I mounted" out of a set keyed by pane and tab, and that answer
     outlives the DOM — re-registering the pane's stage (its grid cell was rebuilt) drops
     `prevCanvasMode` through `releaseMountedPanels` and hands the surface a host that has never
     been drawn into, while the module goes on naming this pane and this tab. `modeChanged` is
     exactly "the structure on this stage is not mine", so the fast path must NOT be the answer:
     without it the render returns on the module's word and the new host stays empty, with nothing
     but a reload to get the pane back. */
  test("a re-registered stage rebuilds the Content home, though the module still calls it mounted", async () => {
    showContentHome();
    renderCanvas();
    await flush();
    expect(library.render).toHaveBeenCalledTimes(1);

    const rebuilt = document.createElement("div");
    document.body.append(rebuilt);
    registerCanvasSurface(PRIMARY_PANE, rebuilt);
    // The module's answer did not change — it is the STAGE that changed hands.
    expect(library.mounted.get(PRIMARY_PANE)).toBe(activeTab.value!);
    expect(surfaceForPane(PRIMARY_PANE).prevCanvasMode).toBeNull();

    renderCanvas();
    await flush();

    // Drawn again, into the host that is actually on screen.
    expect(library.render).toHaveBeenCalledTimes(2);
    expect(library.render.mock.calls[1]![0]).toBe(surfaceForPane(PRIMARY_PANE));
    expect(rebuilt.querySelectorAll(".library-marker")).toHaveLength(1);
  });

  test("a re-registered stage rebuilds the entry form, though the module still calls it mounted", async () => {
    setMode("entry");
    renderCanvas();
    await flush();
    expect(entry.render).toHaveBeenCalledTimes(1);

    const rebuilt = document.createElement("div");
    document.body.append(rebuilt);
    registerCanvasSurface(PRIMARY_PANE, rebuilt);
    expect(entry.mounted.get(PRIMARY_PANE)).toBe(activeTab.value!);
    expect(surfaceForPane(PRIMARY_PANE).prevCanvasMode).toBeNull();

    renderCanvas();
    await flush();

    expect(entry.render).toHaveBeenCalledTimes(2);
    expect(entry.render.mock.calls[1]![0]).toBe(surfaceForPane(PRIMARY_PANE));
    expect(rebuilt.querySelectorAll(".entry-marker")).toHaveLength(1);
  });
});

// ─── A stale companion's way back ─────────────────────────────────────────────

describe("the notice a stale companion draws", () => {
  /* The sentence alone is only half of it: the strip still draws a chip for the file this pane is
     holding, and nothing on screen says how to get it back. The Pin button is the other half, and
     it has to be the COMMAND — a button that names `pane.pin` and then does something else of its
     own is a second implementation of §18.4's exit. */
  test("Pin ends the follow and leaves the held document standing", async () => {
    const page = resetWorkspaceWithTab();
    setMode("design");
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true } }),
    });
    registry.registerAll(derivationCommands(noopDerivationDeps()));
    setActiveRegistry(registry);
    const wrap = document.createElement("div");
    document.body.append(wrap);
    workspace.panes.push({
      activeTabId: page.id,
      derived: {
        kind: "companion",
        preset: "layout",
        reason: "This page has no layout.",
        resolved: page.documentPath,
        sourcePaneId: PRIMARY_PANE,
        status: "unavailable",
      },
      id: SECONDARY_PANE,
      tabOrder: [page.id],
    });
    registerCanvasSurface(SECONDARY_PANE, wrap);
    try {
      renderCanvas(SECONDARY_PANE);
      await flush();

      const button = wrap.querySelector('[part="empty-action"]')!;
      expect(button.textContent.trim()).toBe("Keep This Document");
      expect(paneById(SECONDARY_PANE)?.derived).not.toBeNull();

      pointer(button, "click");
      await flush();

      // The button IS the command: the derivation is dropped and the tab it was holding stays.
      expect(paneById(SECONDARY_PANE)?.derived ?? null).toBeNull();
      expect(paneById(SECONDARY_PANE)?.tabOrder).toContain(page.id);
      expect(page.preview).toBe(false);
    } finally {
      setActiveRegistry(null);
      const index = workspace.panes.findIndex((pane) => pane.id === SECONDARY_PANE);
      if (index !== -1) {
        workspace.panes.splice(index, 1);
      }
      unregisterCanvasSurface(SECONDARY_PANE);
      wrap.remove();
    }
  });
});

// ─── The surface registry's two early returns ─────────────────────────────────

/* LAST in the file on purpose: the teardown injection is a single module-level slot, and the
   disposal test has to own it to see what a dispose does and does not release. */
describe("the surface registry's guards", () => {
  test("a null node is answered without asking a single stage", () => {
    const primary = stage();
    const contains = spyOn(primary, "contains");

    expect(stageContaining(null)).toBeNull();
    // "Which stage is this in" is not a question about a node that does not exist — no stage is
    // Consulted at all. (`Node.contains(null)` is false, so the answer alone cannot say this.)
    expect(contains).not.toHaveBeenCalled();

    // The control: a node that IS inside a stage resolves to that stage.
    const inner = document.createElement("span");
    primary.append(inner);
    expect(stageContaining(inner)?.paneId).toBe(PRIMARY_PANE);
    expect(contains).toHaveBeenCalledTimes(1);
    contains.mockRestore();
  });

  test("disposing a pane that was never registered releases nothing", async () => {
    const released: CanvasSurface[] = [];
    setSurfaceTeardown((surface) => {
      released.push(surface);
    });
    try {
      const before = allCanvasSurfaces().map((surface) => surface.paneId);

      const { disposePaneSurface } = await import("../src/canvas/surface-registry");
      disposePaneSurface("never-registered");

      expect(released).toHaveLength(0);
      expect(allCanvasSurfaces().map((surface) => surface.paneId)).toEqual(before);

      // The control: a pane that IS registered has its editors released, its artboard scopes
      // Stopped and its record forgotten.
      const ghost = registerCanvasSurface("ghost", document.createElement("div"));
      const stop = mock(() => {});
      ghost.panels.push({
        _width: null,
        canvas: document.createElement("div"),
        element: document.createElement("div"),
        mediaName: "",
        ready: true,
        renderScope: { run: (fn) => fn(), stop },
        scrollContainer: document.createElement("div"),
        viewport: document.createElement("div"),
      });
      disposePaneSurface("ghost");

      expect(released).toHaveLength(1);
      expect(released[0]).toBe(ghost);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(allCanvasSurfaces().map((surface) => surface.paneId)).not.toContain("ghost");
    } finally {
      setSurfaceTeardown(null);
    }
  });
});
