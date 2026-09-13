/**
 * Grid canvas panel — the FLOW behind the grid surface, drawn on a pane's stage when a tab's
 * canvasMode is "grid".
 *
 * `canvas-render` calls renderGridMode() on entry and detachGridPanel() in its mode-change
 * teardown. The frame is `surfaces/grid-panel.json`, mounted once per entry; a panel-local effect
 * tracks the controller's reactive state and re-PROJECTS it, so the Save badge, row count and
 * loading/error surfaces stay live without renderCanvas involvement. The Tabulator view is created
 * once per tab entry, after the controller has loaded columns and the document has made the host
 * node, and destroyed on detach — all grid data survives in the controller/buffer, so a rebuild on
 * re-entry is cheap.
 *
 * **The markup left.** Everything this module used to render — the toolbar, the saved-view panel,
 * find-and-replace, the "no grid source" sentence — is a document now (`surfaces/grid-panel.json`,
 * `surfaces/grid-views.json`, `surfaces/grid-replace.json`), and what is here decides rather than
 * draws. Two things that used to need saying out loud stopped needing it:
 *
 * - **The engine's host node cannot be destroyed by a toolbar tick.** The lit shell wrapped that div
 *   in `guard([source.id])` because a re-render of the surrounding template would otherwise
 *   re-commit it and silently take Tabulator with it. A document reconciles in place, so the
 *   guarantee is the rendering model's rather than a directive somebody has to remember.
 * - **The panel state that is not reactive still needs a bump.** `localStorage` is not reactive and
 *   neither is the engine, so a column drag saved from `grid-view.ts`, a view saved from the
 *   palette, and the host node arriving all reach the surface through
 *   {@link ActiveGridPanel.bump}.
 *
 * **The panel owns the view state** (plan §12 P7.2). Saved views persist through `grid-layout.ts` —
 * one store, the grid id as its key, so "per collection" needs no code — and this module is what
 * drives them onto the four surfaces they touch: the engine (column order, width and visibility,
 * applied by a REBUILD, which is cheap because the data never leaves the controller), the
 * controller (sort and grouping, which are row order and belong to the data), and the surface's own
 * filter box. Applying a view is therefore one function with one order of operations, not five
 * controls that each half-remember what the others did.
 */
import { effect, effectScope, reactive } from "../reactivity";
import { showConfirmDialog, showPromptDialog } from "../ui/layers";
import { notify } from "../services/notify";
import { rectOf } from "../utils/geometry";
import { activeTab, workspace } from "../workspace/workspace";
import { createGridController, getGridController } from "./grid-controller";
import { createCsvFileSource } from "./sources/csv-file-source";
import { createGridView } from "./grid-view";
import { parseGridTabId } from "./grid-source";
import { mountGridPanelSurface } from "../surfaces/grid-panel";
import { openGridViewsSurface } from "../surfaces/grid-views";
import { openGridReplaceSurface } from "../surfaces/grid-replace";
import {
  activeViewModified,
  activeViewName,
  applySavedView,
  deleteSavedView,
  listSavedViews,
  loadGridLayout,
  resetGridLayout,
  saveGridLayout,
  saveViewAs,
} from "./grid-layout";
import { argsSchema, stringArg, stringProperty } from "../commands/command-args";
import type { EffectScope } from "@vue/reactivity";
import type { GridController } from "./grid-controller";
import type { GridLayout, GridSortSpec } from "./grid-layout";
import type { GridView } from "./grid-view";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type {
  GridPanelActions,
  GridPanelSurfaceHandle,
  GridPanelView,
} from "../surfaces/grid-panel";
import type { GridViewsSurfaceHandle, GridViewsView } from "../surfaces/grid-views";
import type { GridReplaceSurfaceHandle } from "../surfaces/grid-replace";

interface ActiveGridPanel {
  /** The pane whose stage this grid is drawn on. */
  paneId: string;
  tabId: string;
  scope: EffectScope;
  view: GridView | null;
  wrap: HTMLElement;
  /** The mounted frame, or null while the mount is still in flight. */
  surface: GridPanelSurfaceHandle | null;
  /** The saved-view panel while it is open. */
  views: GridViewsSurfaceHandle | null;
  /** Where that panel was opened, so a re-projection cannot move it back to the origin. */
  viewsAt: { x: number; y: number };
  /** Find & replace while it is open. */
  replace: GridReplaceSurfaceHandle | null;
  /**
   * Rebuild the engine over the same controller.
   *
   * Column order, width and visibility are read by `createGridView` from the saved layout, so this
   * is how a view change reaches them. Nothing is re-fetched: rows, edits, undo history and the
   * dirty flag all live in the controller, and the engine is a rendering of them.
   */
  remount: () => void;
  /** Apply a whole layout — sort, grouping, columns, filter — in one order of operations. */
  applyLayout: (layout: GridLayout | null) => void;
  /** Re-project. `localStorage` is not reactive, so a view edit has to say so. */
  bump: () => void;
}

/**
 * The grid mounted in each pane, keyed by pane id.
 *
 * A module-level `let active` described a shell with one stage. With two, pane B mounting a grid
 * destroyed pane A's Tabulator view and effect scope out from under it — and `resetCanvasView`
 * calls `detachGridPanel` on every pane that empties, so a second grid was never required.
 */
const _active = new Map<string, ActiveGridPanel>();

/**
 * The "no grid source" frame in each pane, which has no panel record to hang off.
 *
 * It is still a mounted document, so something has to be able to dispose it — `mountSurface`
 * registers every mount so a saved kit edit can find it again, and a frame nobody disposes stays in
 * that registry after its stage has been emptied.
 */
const _missing = new Map<string, GridPanelSurfaceHandle>();

/** The grid mounted in a pane, or null. */
function activeIn(paneId: string): ActiveGridPanel | null {
  return _active.get(paneId) ?? null;
}

/** Destroy one pane's grid view/effects (canvas-render teardown + tab switches). */
export function detachGridPanel(paneId: string) {
  _missing.get(paneId)?.dispose();
  _missing.delete(paneId);
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  panel.views?.close();
  panel.replace?.close();
  panel.view?.destroy();
  panel.scope.stop();
  panel.surface?.dispose();
  _active.delete(paneId);
}

/** Whether the grid panel is live in this pane for this tab (canvas-render fast-path guard). */
export function gridPanelMounted(paneId: string, tab: Tab): boolean {
  const panel = activeIn(paneId);
  return panel !== null && panel.tabId === tab.id && panel.wrap.isConnected;
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * The View button's label: the applied view's name, with a dot when the layout has since drifted.
 *
 * "View" alone when nothing is applied — the grid still remembers its columns, and claiming a name
 * for a layout the author never named would make Save-as look like a no-op.
 */
function viewButtonLabel(gridId: string): string {
  const name = activeViewName(gridId);
  if (!name) {
    return "View";
  }
  return activeViewModified(gridId) ? `${name} •` : name;
}

/** "Grouped by Status · 3 groups" — the grouping is invisible in the rows, so the toolbar says it. */
function groupNote(controller: GridController): string {
  const field = controller.state.grouping;
  if (!field) {
    return "";
  }
  const title = controller.state.columns.find((column) => column.field === field)?.title ?? field;
  const count = controller.groups().length;
  return `Grouped by ${title} · ${count} group${count === 1 ? "" : "s"}`;
}

/** The page the reader is on, as "51–100". Only remote-paged sources have one. */
function pageRange(controller: GridController): string {
  const { state } = controller;
  const limit = state.query.limit ?? 50;
  const offset = state.query.offset ?? 0;
  const from = state.total === 0 ? 0 : offset + 1;
  return `${from}–${Math.min(offset + limit, state.total)}`;
}

/** Everything the frame draws right now, read from the controller, the buffer and the layout. */
function projectPanel(controller: GridController): GridPanelView {
  const { state } = controller;
  const gridId = controller.source.id;
  const dirty = controller.buffer.dirtyCount();
  const sourceRef = parseGridTabId(gridId);
  const limit = state.query.limit ?? 50;
  const offset = state.query.offset ?? 0;
  const note = groupNote(controller);
  return {
    canDelete: controller.source.capabilities.delete === true,
    canInsert: controller.source.capabilities.insert === true,
    countLabel: `${state.total} row${state.total === 1 ? "" : "s"}`,
    countState: state.loading ? "loading" : state.error ? "error" : "total",
    error: state.error ?? "",
    filter: loadGridLayout(gridId)?.filter ?? "",
    groupNote: note,
    groupState: note === "" ? "hidden" : "shown",
    lossyState:
      sourceRef?.kind === "collection" || sourceRef?.kind === "pages" ? "shown" : "hidden",
    nextDisabled: offset + limit >= state.total || state.loading,
    pageRange: pageRange(controller),
    pagerState: controller.source.capabilities.remotePaging ? "shown" : "hidden",
    prevDisabled: offset === 0 || state.loading,
    refreshDisabled: state.loading || state.saving,
    saveDisabled: dirty === 0 || state.saving,
    saveLabel: dirty > 0 ? `Save (${dirty})` : "Save",
    view: "grid",
    viewLabel: viewButtonLabel(gridId),
  };
}

// ─── Saved views ──────────────────────────────────────────────────────────────

/** What the View panel shows: the saved views, and the four facets one of them is made of. */
function projectViews(controller: GridController, at: { x: number; y: number }): GridViewsView {
  const gridId = controller.source.id;
  const layout = loadGridLayout(gridId) ?? {};
  const saved = listSavedViews(gridId);
  const activeName = activeViewName(gridId);
  const hidden = new Set(layout.hidden);
  const sort = layout.sort ?? null;
  const { columns } = controller.state;
  const fields = columns.map((column) => ({ label: column.title, value: column.field }));
  return {
    columns: columns.map((column) => ({
      field: column.field,
      title: column.title,
      visible: !hidden.has(column.field),
    })),
    dirOptions: [
      { label: "Ascending", value: "asc" },
      { label: "Descending", value: "desc" },
    ],
    fieldOptions: [{ label: "Source order", value: "" }, ...fields],
    groupField: controller.state.grouping ?? "",
    groupOptions: [{ label: "Ungrouped", value: "" }, ...fields],
    saveLabel: activeName ? "Save as…" : "Save view…",
    sortDir: sort?.dir ?? "asc",
    sortDirDisabled: sort === null,
    sortField: sort?.field ?? "",
    views: saved.map((view) => ({
      active: view.name === activeName ? "true" : "false",
      current: view.name === activeName ? "true" : "false",
      deleteLabel: `Delete the saved view ${view.name}`,
      key: view.name,
      name: view.name,
    })),
    viewsState: saved.length === 0 ? "empty" : "listed",
    x: at.x,
    y: at.y,
  };
}

/**
 * The View panel: saved views, then the four facets one of them is made of.
 *
 * One control rather than four, because the chrome budget is a cap on named things in the toolbar
 * (plan §2, principle 9) and these four are only ever adjusted together. Each edit writes the
 * working layout and applies immediately — there is no Apply button, so there is no state in which
 * the panel shows something the grid is not already doing.
 */
function openViewPopover(
  controller: GridController,
  panel: ActiveGridPanel,
  anchor: HTMLElement,
): void {
  /* A second press on the button TOGGLES. The platform does not light-dismiss a popover from its
     own invoker — that is what passing the anchor as the popover's source buys — so without this
     the button stacks a second panel into the same layer slot, and the first one's `toggle` tears
     down the slot the second was just mounted into. */
  if (panel.views?.isOpen()) {
    panel.views.close();
    panel.views = null;
    return;
  }
  const rect = rectOf(anchor);
  const at = { x: Math.max(4, rect.left), y: rect.bottom + 4 };
  panel.viewsAt = at;
  const gridId = controller.source.id;
  const close = () => {
    panel.views?.close();
    panel.views = null;
  };

  /** Persist one facet, put it on screen, and refresh both the panel and the toolbar. */
  const change = (patch: GridLayout, apply: () => void) => {
    saveGridLayout(gridId, patch);
    apply();
    panel.bump();
  };

  const setSort = (spec: GridSortSpec | null) =>
    change({ sort: spec }, () => {
      void controller.setSort(spec);
    });

  panel.views = openGridViewsSurface(
    projectViews(controller, at),
    {
      applyView: (name) => {
        panel.applyLayout(applySavedView(gridId, name));
        close();
      },
      deleteView: (name) => {
        void confirmDeleteView(gridId, name, panel);
      },
      dismissed: () => {
        panel.views = null;
      },
      reset: () => {
        resetGridLayout(gridId);
        panel.applyLayout(null);
        close();
      },
      saveView: () => {
        void promptSaveView(controller, panel);
      },
      setGroup: (field) => {
        change({ groupBy: field || null }, () => controller.setGrouping(field || null));
      },
      setSortDir: (dir) => {
        const sort = loadGridLayout(gridId)?.sort ?? null;
        if (sort) {
          setSort({ dir: dir === "desc" ? "desc" : "asc", field: sort.field });
        }
      },
      setSortField: (field) => {
        const sort = loadGridLayout(gridId)?.sort ?? null;
        setSort(field === "" ? null : { dir: sort?.dir ?? "asc", field });
      },
      toggleColumn: (field, visible) => {
        const hidden = new Set(loadGridLayout(gridId)?.hidden);
        if (visible) {
          hidden.delete(field);
        } else {
          hidden.add(field);
        }
        change({ hidden: [...hidden] }, () => panel.remount());
      },
    },
    anchor,
  );

  /* The button's label is derived from storage, and storage is ALSO written by the engine — a
     column drag or resize goes straight to `saveGridLayout` from `grid-view.ts`. Refreshing the
     toolbar as the control opens is what stops the drift dot lagging a resize by one interaction,
     and it is what puts the freshly-read projection into the panel that just opened. */
  panel.bump();
}

/** Ask before forgetting a named view, and re-project when one is actually gone. */
async function confirmDeleteView(
  gridId: string,
  name: string,
  panel: ActiveGridPanel,
): Promise<void> {
  const confirmed = await showConfirmDialog(
    "Delete View",
    `Delete the saved view "${name}"? The grid keeps its current layout.`,
    { confirmLabel: "Delete", destructive: true },
  );
  if (confirmed && deleteSavedView(gridId, name)) {
    panel.bump();
  }
}

/**
 * Name the current layout.
 *
 * An existing name overwrites that view — the author who types it means "update this one", and a
 * confirmation for replacing something they can re-save in two clicks is chrome for its own sake. A
 * blank name is refused in the field, so the dialog never returns one.
 */
async function promptSaveView(
  controller: GridController,
  panel: ActiveGridPanel,
): Promise<string | null> {
  const gridId = controller.source.id;
  const name = await showPromptDialog("Save Grid View", {
    confirmLabel: "Save View",
    message: `Columns, sort, grouping and filter, saved for ${controller.source.label}.`,
    placeholder: "Recent drafts",
    validate: (candidate) => (candidate.trim() === "" ? "Name the view." : ""),
    value: activeViewName(gridId) ?? "",
  });
  if (name === null) {
    return null;
  }
  const saved = saveViewAs(gridId, name);
  if (!saved) {
    // Storage is off (privacy mode): the layout still works, it just cannot be remembered.
    notify.warn("Views cannot be saved — this browser has local storage disabled.", {
      key: "grid.saveView",
      source: "Data",
    });
    return null;
  }
  panel.bump();
  return saved.name;
}

/** Find & replace panel — buffers all replacements as one undo group. */
function openReplacePopover(
  controller: GridController,
  panel: ActiveGridPanel,
  anchor: HTMLElement,
): void {
  if (panel.replace?.isOpen()) {
    panel.replace.close();
    panel.replace = null;
    return;
  }
  const rect = rectOf(anchor);
  panel.replace = openGridReplaceSurface(
    { x: Math.max(4, rect.left), y: rect.bottom + 4 },
    {
      dismissed: () => {
        panel.replace = null;
      },
      replaceAll: (find, replace) => {
        const changed = controller.replaceAll(find, replace);
        if (changed === 0) {
          notify.info("No matches.", { key: "grid.replaceAll" });
          return;
        }
        notify.success(`Replaced in ${changed} cell${changed === 1 ? "" : "s"} — save to apply.`, {
          action: "file.save",
          key: "grid.replaceAll",
        });
        panel.replace?.close();
        panel.replace = null;
      },
    },
    anchor,
  );
}

/**
 * Render the grid surface for a tab onto a pane's stage. Re-entrant: same-tab calls while the panel
 * is live are no-ops (the panel's own effect keeps it fresh).
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderGridMode(surface: CanvasSurface, tab: Tab) {
  const { paneId, wrap: canvasWrap } = surface;
  if (gridPanelMounted(paneId, tab)) {
    return;
  }
  detachGridPanel(paneId);

  let controller = getGridController(tab);
  // CSV file tabs can reach grid mode through any open path (deep link, quick search, recents) —
  // Provision their controller lazily so every path works, not just openCsvGridTab.
  if (!controller && tab.documentPath?.toLowerCase().endsWith(".csv")) {
    controller = createGridController(tab, createCsvFileSource(tab.documentPath));
    void controller.load();
  }
  if (!controller) {
    _missing.set(paneId, mountGridPanelSurface(canvasWrap, missingView(), missingActions()));
    return;
  }

  const scope = effectScope();
  /* `localStorage` is not reactive and neither is the engine, so the surface needs something that
     is: a saved-view edit, or the host node arriving, bumps this and the panel's one effect
     re-projects like any other change. */
  const local = reactive({ views: 0 });
  const engine = controller;
  let hostEl: HTMLElement | null = null;

  const panel: ActiveGridPanel = {
    applyLayout(layout) {
      void engine.setSort(layout?.sort ?? null);
      engine.setGrouping(layout?.groupBy ?? null);
      panel.remount();
      panel.view?.setSearch(layout?.filter ?? "");
      panel.bump();
    },
    bump() {
      local.views += 1;
    },
    paneId,
    remount() {
      panel.view?.destroy();
      panel.view = hostEl ? createGridView(hostEl, engine) : null;
    },
    replace: null,
    scope,
    surface: null,
    tabId: tab.id,
    view: null,
    views: null,
    viewsAt: { x: 0, y: 0 },
    wrap: canvasWrap,
  };
  _active.set(paneId, panel);

  panel.surface = mountGridPanelSurface(canvasWrap, projectPanel(engine), {
    addRow: () => engine.addRow(),
    deleteRows: () => engine.deleteRows(panel.view?.getSelectedRowKeys() ?? []),
    fillDown: () => panel.view?.fillDown(),
    gridHost: (element) => {
      hostEl = element;
    },
    nextPage: () => {
      const limit = engine.state.query.limit ?? 50;
      void engine.setQuery({
        ...engine.state.query,
        limit,
        offset: (engine.state.query.offset ?? 0) + limit,
      });
    },
    openReplace: (element) => {
      openReplacePopover(engine, panel, element);
    },
    openViews: (element) => {
      openViewPopover(engine, panel, element);
    },
    prevPage: () => {
      const limit = engine.state.query.limit ?? 50;
      void engine.setQuery({
        ...engine.state.query,
        limit,
        offset: Math.max(0, (engine.state.query.offset ?? 0) - limit),
      });
    },
    refresh: () => {
      void engine.refresh();
    },
    save: () => {
      void engine.save();
    },
    setFilter: (term) => {
      // The filter is part of the view, so it persists with the rest of it rather than
      // Evaporating on a tab switch and taking a saved view's meaning with it.
      saveGridLayout(engine.source.id, { filter: term });
      panel.view?.setSearch(term);
    },
  });
  /* The host node is announced during the mount, one reconcile step before it is in the page. The
     engine is built from the EFFECT rather than from there, so it is never handed a detached node —
     `ready` is the document saying the frame has landed. */
  void panel.surface.ready.then(() => {
    if (activeIn(paneId) === panel) {
      panel.bump();
    }
  });

  // The stored sort, grouping and filter are applied ONCE, when the engine first exists. Re-running
  // Them on every render would fight the author: every ad-hoc header sort would be undone by the
  // Next repaint, which is the behaviour a saved view is supposed to replace, not impose.
  let restored = false;

  scope.run(() => {
    effect(() => {
      if (activeIn(paneId) !== panel) {
        return;
      }
      // Track everything the toolbar shows.
      void engine.state.loading;
      void engine.state.saving;
      void engine.state.error;
      void engine.state.total;
      void engine.state.query.offset;
      void engine.state.grouping;
      void engine.buffer.dirtyCount();
      void local.views;

      panel.surface?.update(projectPanel(engine));
      panel.views?.update(projectViews(engine, panel.viewsAt));

      // Create the engine once the columns exist and the host div is in the DOM.
      if (!panel.view && !engine.state.loading && engine.state.columns.length > 0 && hostEl) {
        panel.view = createGridView(hostEl, engine);
        if (!restored) {
          restored = true;
          const layout = loadGridLayout(engine.source.id);
          void engine.setSort(layout?.sort ?? null);
          engine.setGrouping(layout?.groupBy ?? null);
          panel.view.setSearch(layout?.filter ?? "");
        }
      }
    });
  });
}

/** The frame a tab with no grid source draws: one sentence, and no controls to press. */
function missingView(): GridPanelView {
  return {
    canDelete: false,
    canInsert: false,
    countLabel: "",
    countState: "total",
    error: "",
    filter: "",
    groupNote: "",
    groupState: "hidden",
    lossyState: "hidden",
    nextDisabled: true,
    pageRange: "",
    pagerState: "hidden",
    prevDisabled: true,
    refreshDisabled: true,
    saveDisabled: true,
    saveLabel: "Save",
    view: "missing",
    viewLabel: "View",
  };
}

/** No control is drawn in the missing state, so none of these can be reached. */
function missingActions(): GridPanelActions {
  const nothing = () => {};
  return {
    addRow: nothing,
    deleteRows: nothing,
    fillDown: nothing,
    gridHost: nothing,
    nextPage: nothing,
    openReplace: nothing,
    openViews: nothing,
    prevPage: nothing,
    refresh: nothing,
    save: nothing,
    setFilter: nothing,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * The live grid surface, or null.
 *
 * Both halves are required: a controller says the active tab HAS a grid, and a mounted panel says
 * the grid is what is on screen. A view command that ran against a grid tab currently showing its
 * Monaco source mode would remount an engine into a host that is not there.
 */
function activeGridSurface(): { controller: GridController; panel: ActiveGridPanel } | null {
  const controller = getGridController(activeTab.value);
  const active = activeIn(workspace.activePaneId);
  if (!controller || !active || active.tabId !== controller.tab.id) {
    return null;
  }
  return { controller, panel: active };
}

/** The saved-view verbs. Every one of them is also a control in the View panel. */
function requireSurface(commandId: string) {
  const surface = activeGridSurface();
  if (!surface) {
    throw new Error(`command "${commandId}" needs a grid on screen`);
  }
  return surface;
}

/**
 * Saved views, as commands.
 *
 * A view is named, so it is addressable, so it belongs in the palette, on the `__jxAutomation`
 * surface and in front of the assistant — not only behind a panel the author has to find. The
 * refusals name what the grid actually holds, in the idiom of `collection.editInGrid`: an unknown
 * view lists the views that exist rather than doing nothing.
 *
 * @returns {AnyCommand[]}
 */
export function gridViewCommands(): AnyCommand[] {
  const viewNameArg = (commandId: string, args: unknown): { gridId: string; name: string } => {
    const { controller } = requireSurface(commandId);
    const gridId = controller.source.id;
    const name = stringArg(commandId, args as Record<string, unknown>, "name");
    const known = listSavedViews(gridId).map((view) => view.name);
    if (!known.includes(name)) {
      throw new RangeError(
        `command "${commandId}" argument "name": "${name}" is not a saved view of ` +
          `${controller.source.label} — it has: ${known.length > 0 ? known.join(", ") : "none"}`,
      );
    }
    return { gridId, name };
  };

  return [
    {
      category: "View",
      id: "grid.saveView",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "a grid on screen",
      when: (ctx) => ctx.project.open,
      enablement: () => activeGridSurface() !== null,
      aiTool: {
        description:
          "Save the open grid's columns, sort, grouping and filter as a named view. Prompts for the name.",
        name: "save_grid_view",
      },
      run: async () => {
        const { controller, panel } = requireSurface("grid.saveView");
        await promptSaveView(controller, panel);
      },
      title: "Save Grid View…",
    },
    {
      args: argsSchema({ name: stringProperty("The saved view's name.") }),
      category: "View",
      id: "grid.applyView",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "a grid on screen",
      when: (ctx) => ctx.project.open,
      enablement: () => activeGridSurface() !== null,
      aiTool: {
        description: "Apply a saved view to the open grid by name.",
        name: "apply_grid_view",
      },
      run: (_ctx, args) => {
        const { gridId, name } = viewNameArg("grid.applyView", args);
        const { panel } = requireSurface("grid.applyView");
        panel.applyLayout(applySavedView(gridId, name));
      },
      title: "Apply Grid View",
    },
    {
      args: argsSchema({ name: stringProperty("The saved view's name.") }),
      category: "View",
      id: "grid.deleteView",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "a grid on screen",
      destructive: true,
      when: (ctx) => ctx.project.open,
      enablement: () => activeGridSurface() !== null,
      run: (_ctx, args) => {
        const { gridId, name } = viewNameArg("grid.deleteView", args);
        deleteSavedView(gridId, name);
        requireSurface("grid.deleteView").panel.bump();
      },
      title: "Delete Grid View",
    },
    {
      category: "View",
      id: "grid.resetView",
      level: "document",
      menus: ["palette"],
      group: "5_data",
      requires: "a grid on screen",
      when: (ctx) => ctx.project.open,
      enablement: () => activeGridSurface() !== null,
      run: () => {
        const { controller, panel } = requireSurface("grid.resetView");
        resetGridLayout(controller.source.id);
        panel.applyLayout(null);
      },
      title: "Reset Grid View",
    },
  ];
}

/**
 * Register the saved-view commands.
 *
 * @param {CommandRegistry} registry
 */
export function registerGridViewCommands(registry: CommandRegistry): void {
  registry.registerAll(gridViewCommands());
}
