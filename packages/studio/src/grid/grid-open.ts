/**
 * Grid tab openers — create (or activate) the tab + controller pair for a grid surface.
 *
 * CSV files open as REAL file tabs (id = path) whose default canvas mode is "grid" with a Monaco
 * "source" alternate; collection/pages/connector grids (later phases) open as virtual tabs with
 * `grid://` ids. All openers dedupe by tab id.
 */
import { activateTab, openTab, workspace } from "../workspace/workspace";
import { formatForPath, loadFormats } from "../format/format-host";
import { layerHost } from "../ui/layers";
import { openDialogSurface } from "../surfaces/dialog";
import { mountGridOpenSurface } from "../surfaces/grid-open";
import { dataSurfaceAvailable, fetchConnections } from "../services/data-service";
import { createGridController } from "./grid-controller";
import { createCsvFileSource } from "./sources/csv-file-source";
import {
  collectionDirs,
  createCollectionSource,
  createPagesSource,
} from "./sources/content-source";
import { createConnectorSource } from "./sources/connector-source";
import { makeGridTabId, parseGridTabId } from "./grid-source";
import { libraryTabId } from "../browse/library-source";
import { argsSchema, optionalStringArg, stringArg, stringProperty } from "../commands/command-args";
import type { GridSource } from "./grid-source";
import type { GridOpenSurfaceHandle, GridSourceGroup } from "../surfaces/grid-open";
import type { Tab } from "../tabs/tab";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

/** Placeholder document for grid tabs — the grid never reads it; save routes to the controller. */
const GRID_STUB_DOCUMENT = { children: [], tagName: "div" };

/** Open (or activate) a `.csv` file as a grid tab. */
export async function openCsvGridTab(path: string): Promise<Tab> {
  const existing = workspace.tabs.get(path);
  if (existing) {
    activateTab(path);
    return existing;
  }

  // Best effort: the format name labels the tab's source mode; the grid works without it.
  try {
    await loadFormats();
  } catch {
    // Format registry unavailable (e.g. no dev server) — grid mode still works.
  }

  const source = createCsvFileSource(path);
  const tab = openTab({
    capabilities: { modes: ["grid", "source"] },
    document: structuredClone(GRID_STUB_DOCUMENT),
    documentPath: path,
    id: path,
    sourceFormat: formatForPath(path)?.name ?? null,
  });
  const controller = createGridController(tab, source);
  void controller.load();
  return tab;
}

/**
 * Open a virtual grid tab for a source (collections now; more kinds later). Callers dedupe by the
 * same `makeGridTabId` id before constructing the source.
 */
function openVirtualGridTab(source: GridSource): Tab {
  const tab = openTab({
    capabilities: { modes: ["grid"] },
    document: structuredClone(GRID_STUB_DOCUMENT),
    documentPath: null,
    id: source.id,
  });
  const controller = createGridController(tab, source);
  void controller.load();
  return tab;
}

/** Open (or activate) the grid tab for a content collection. */
export function openCollectionGrid(typeName: string): Tab {
  const id = makeGridTabId({ kind: "collection", name: typeName });
  const existing = workspace.tabs.get(id);
  if (existing) {
    activateTab(id);
    return existing;
  }
  return openVirtualGridTab(createCollectionSource(typeName));
}

/**
 * Open (or activate) the Library.
 *
 * A real tab, in the primary pane, with `manage` as its only mode — `commands/context.ts` maps that
 * to the `library` editor kind, so the status bar and the pane context bar can name what is on
 * screen. It is opened here rather than in `browse/` because this is the module that knows how a
 * virtual tab is made; the pane itself resolves its own source and its own view state.
 *
 * Idempotent by construction, which is what lets a shot say "the Library is open" without caring
 * whether an earlier step opened it.
 */
export function openLibraryTab(): Tab {
  const id = libraryTabId();
  const existing = workspace.tabs.get(id);
  if (existing) {
    activateTab(id);
    return existing;
  }
  return openTab({
    capabilities: { modes: ["manage"] },
    document: structuredClone(GRID_STUB_DOCUMENT),
    documentPath: null,
    id,
  });
}

/** Open (or activate) the pages metadata grid. */
export function openPagesGrid(): Tab {
  const id = makeGridTabId({ kind: "pages" });
  const existing = workspace.tabs.get(id);
  if (existing) {
    activateTab(id);
    return existing;
  }
  return openVirtualGridTab(createPagesSource());
}

/** Open (or activate) the grid tab for a connector table. */
export function openConnectorGrid(connection: string | undefined, table: string): Tab {
  const id = makeGridTabId({ connection: connection ?? "default", kind: "data", table });
  const existing = workspace.tabs.get(id);
  if (existing) {
    activateTab(id);
    return existing;
  }
  return openVirtualGridTab(createConnectorSource(connection, table));
}

/**
 * Open the source a row names.
 *
 * The row's id IS the grid tab id it opens, which is what makes each row addressable — a shot or a
 * test names `[data-source="grid://collection/posts"]` rather than the label somebody typed — and
 * saves this module a second encoding to keep in step with `makeGridTabId`.
 */
function openGridSource(id: string): void {
  const ref = parseGridTabId(id);
  if (ref?.kind === "pages") {
    openPagesGrid();
  } else if (ref?.kind === "collection") {
    openCollectionGrid(ref.name);
  } else if (ref?.kind === "data") {
    openConnectorGrid(ref.connection, ref.table);
  }
}

/** Every grid-able source a project has, grouped by where it comes from. */
function sourceGroups(
  collections: readonly { name: string }[],
  connections: readonly { name: string; tables: string[] }[],
): GridSourceGroup[] {
  return [
    {
      emptyMessage: "",
      key: "project",
      rows: [
        { id: makeGridTabId({ kind: "pages" }), label: "Pages" },
        ...collections.map(({ name }) => ({
          id: makeGridTabId({ kind: "collection", name }),
          label: `Collection: ${name}`,
        })),
      ],
      state: "listed",
      title: "Project",
    },
    ...connections.map((conn) => ({
      emptyMessage: "No tables — push a schema first.",
      key: `data:${conn.name}`,
      rows: conn.tables.map((table) => ({
        id: makeGridTabId({ connection: conn.name, kind: "data", table }),
        label: table,
      })),
      state: (conn.tables.length === 0 ? "empty" : "listed") as "empty" | "listed",
      title: `Data · ${conn.name}`,
    })),
  ];
}

/**
 * Source picker — one dialog listing every grid-able source: pages, content collections, and (when
 * the platform serves the data surface) each connection's tables.
 *
 * The dialog is `ui/layers.ts`'s, and the list inside it is `surfaces/grid-open.json`. Nothing here
 * draws a headline or a cancel button: a second answer to "what is a dialog" is a defect
 * (specs/studio-ui-guidelines.md §12.5), and what this surface genuinely owns is the grouping.
 */
export async function openGridSourcePicker(): Promise<void> {
  const collections = collectionDirs();
  let connections: { name: string; tables: string[] }[] = [];
  if (dataSurfaceAvailable()) {
    const response = await fetchConnections().catch(() => null);
    connections = response?.connections ?? [];
  }

  let list: GridOpenSurfaceHandle | null = null;
  const handle = openDialogSurface({
    cancelLabel: "Cancel",
    confirmLabel: "",
    headline: "Open Grid",
    island: (host) => {
      list = mountGridOpenSurface(host, sourceGroups(collections, connections), (id) => {
        handle.close();
        openGridSource(id);
      });
    },
    layer: layerHost("dialog"),
    onCancel: () => handle.close(),
    onClosed: () => {
      list?.dispose();
      list = null;
    },
    onConfirm: () => {},
    region: "grid/open",
  });
  /* Deliberately not awaited. `handle.ready` settles when the dialog has been SHOWN, and the only
     caller is a button press that has nothing to do afterwards; awaiting it would make this
     function's promise depend on a platform event rather than on the fetch it actually performs. */
  void handle.ready;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * The grid openers, as commands.
 *
 * `collection.editInGrid` used to be a press on the file tree's context-menu row, matched by the
 * item's rendered label ("Edit Collection in Grid") through an XPath — so the shot that used it
 * also had to open the menu first, and renaming the row broke both steps. Naming the COLLECTION
 * instead of the control is what plan §13's R1 asks for: the menu row and the command are the same
 * action, and only one of them is addressable.
 *
 * Both refuse a source the project does not declare. `data.openGrid` is additionally gated on the
 * platform serving the data routes (`capability.dataRows`), so on a build without them the command
 * is visible-but-disabled with a reason rather than opening a tab that can never load.
 *
 * @returns {AnyCommand[]}
 */
export function gridCommands(): AnyCommand[] {
  return [
    {
      args: argsSchema({
        name: stringProperty("The content collection's name, as project.json declares it."),
      }),
      category: "Project",
      id: "collection.editInGrid",
      level: "project",
      menus: ["context/file", "palette"],
      group: "5_data",
      requires: "a project that declares content collections",
      when: (ctx) => ctx.project.open,
      aiTool: {
        description: "Open a content collection's entries as an editable grid in a new tab.",
        name: "open_collection_grid",
      },
      run: (_commandCtx, args) => {
        const name = stringArg("collection.editInGrid", args, "name");
        const declared = collectionDirs().map((c) => c.name);
        if (!declared.includes(name)) {
          throw new RangeError(
            `command "collection.editInGrid" argument "name": "${name}" is not a content ` +
              `collection this project declares — it declares: ` +
              `${declared.length > 0 ? declared.join(", ") : "none"}`,
          );
        }
        openCollectionGrid(name);
      },
      title: "Edit Collection in Grid",
    },
    {
      args: {
        additionalProperties: false,
        properties: {
          connection: stringProperty(
            'The connection name from project.json. Defaults to "default".',
          ),
          table: stringProperty("The table to open."),
        },
        required: ["table"],
        type: "object",
      },
      category: "Project",
      id: "data.openGrid",
      level: "project",
      menus: ["palette"],
      group: "5_data",
      requires: "a platform that serves the data routes",
      when: (ctx) => ctx.project.open,
      enablement: (ctx) => ctx.capability.dataRows,
      aiTool: {
        description: "Open a connector table as an editable grid in a new tab.",
        name: "open_data_grid",
      },
      run: (_commandCtx, args) => {
        const table = stringArg("data.openGrid", args, "table");
        openConnectorGrid(optionalStringArg("data.openGrid", args, "connection"), table);
      },
      title: "Open Data Grid",
    },
  ];
}

/**
 * Register the grid openers.
 *
 * @param {CommandRegistry} registry
 */
export function registerGridCommands(registry: CommandRegistry): void {
  registry.registerAll(gridCommands());
}
