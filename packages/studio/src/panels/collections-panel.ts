/// <reference lib="dom" />
/**
 * The Collections panel — the Content workspace's Navigator panel (`specs/studio.md` §22.5).
 *
 * Two lists, chosen by what the focused pane shows:
 *
 * - **The collections.** The built-in Pages and every collection `project.json` declares, in
 *   declaration order, each with its entry count (from the Content home's scan,
 *   `browse/library-pane.ts`) and its saved grid views beneath it (`grid/grid-layout.ts`), and **+
 *   New collection** at the foot. Choosing one shows it in the Content home
 *   (`content.showCollection`); choosing a saved view opens the collection's grid on it.
 * - **One collection's entries**, while an entry of it is the focused document: thumbnail, title and
 *   status (`content/entry-summaries.ts`), under **‹ <Collection>** to go back, with **+ New
 *   <item>** at the foot. Choosing one opens it where it is written (`content/entry-open.ts`).
 *
 * The markup is `surfaces/collections-panel.json`; this module is the flow. It is registered with
 * no rail button: Content has no rail, and the workspace's frame opens the Navigator on it
 * (`shell.ts`'s `WORKSPACE_PRESETS`).
 *
 * @docs studio/projects/browse
 */

import { nothing } from "lit-html";
import { projectState, renderOnly } from "../store";
import { activeTab } from "../workspace/workspace";
import { runActiveReported } from "../commands/run-reported";
import {
  PAGES_COLLECTION,
  collectionKeyOfPath,
  contentCollection,
  contentCollections,
} from "../content/content-collections";
import {
  collectionCounts,
  collectionEntryPaths,
  collectionView,
  shownCollectionKey,
} from "../browse/library-pane";
import { localeOfPath, resolveI18n } from "@jxsuite/schema/locale";
import { onEntrySummariesRead, peekEntrySummaries } from "../content/entry-summaries";
import { openEntry } from "../content/entry-open";
import { workspaceHomeTabId } from "../workspace/workspace-ids";
import { makeGridTabId, parseGridTabId } from "../grid/grid-source";
import { applySavedView, listSavedViews } from "../grid/grid-layout";
import {
  emptyCollectionsPanelValues,
  mountCollectionsPanelSurface,
} from "../surfaces/collections-panel";
import { registerPanel } from "./panel-registry";
import type {
  CollectionEntryRow,
  CollectionRow,
  CollectionsPanelActions,
  CollectionsPanelSurfaceHandle,
  CollectionsPanelValues,
} from "../surfaces/collections-panel";
import type { Tab } from "../tabs/tab";

/** The `source` every command run from here reports under. */
const SOURCE = "Collections";

/** The grid tab id a collection's saved views are stored under. */
export function collectionGridId(key: string): string {
  return key === PAGES_COLLECTION
    ? makeGridTabId({ kind: "pages" })
    : makeGridTabId({ kind: "collection", name: key });
}

/**
 * The declared collection an entry tab is writing, or `null`: the focused document is a file a
 * declared collection owns. Pages are Design's, so a page tab lists the collections. A file-backed
 * collection's file is no entry either: its grid lists its records, so the panel lists the
 * collections with that one selected.
 */
export function writingCollection(tab: Tab | null): string | null {
  const key = collectionKeyOfPath(tab?.documentPath);
  return key !== null && key !== PAGES_COLLECTION && !contentCollection(key)?.fileBacked
    ? key
    : null;
}

/** The file-backed collection whose file a tab holds, or `null`. */
function fileCollectionOf(tab: Tab): string | null {
  const key = collectionKeyOfPath(tab.documentPath);
  return key !== null && contentCollection(key)?.fileBacked === true ? key : null;
}

/** The collection the focused pane is showing, for the list's selected row, or `null`. */
function shownKey(tab: Tab | null): string | null {
  if (!tab) {
    return null;
  }
  if (tab.id === workspaceHomeTabId("content")) {
    return shownCollectionKey();
  }
  const grid = parseGridTabId(tab.id);
  if (grid?.kind === "pages") {
    return PAGES_COLLECTION;
  }
  return grid?.kind === "collection" ? grid.name : fileCollectionOf(tab);
}

/** The collection list. */
function collectionRows(tab: Tab | null): CollectionRow[] {
  const counts = collectionCounts();
  const selected = shownKey(tab);
  return contentCollections().map((collection) => {
    const count = counts?.get(collection.key);
    return {
      count: counts === null ? "" : String(count ?? 0),
      key: collection.key,
      selected: collection.key === selected ? "true" : "false",
      title: collection.title,
      views: listSavedViews(collectionGridId(collection.key)).map((view) => ({
        key: `${collection.key}\n${view.name}`,
        name: view.name,
      })),
    };
  });
}

/** Everything the panel draws right now. */
export function collectionsPanelValues(): CollectionsPanelValues {
  const values = emptyCollectionsPanelValues();
  if (!projectState) {
    return values;
  }
  const tab = activeTab.value;
  const writing = writingCollection(tab);
  if (writing === null) {
    return { ...values, body: "list", collections: collectionRows(tab) };
  }
  const collection = contentCollection(writing);
  const counts = collectionCounts();
  const paths = collectionEntryPaths(writing);
  const summaries = counts === null ? null : peekEntrySummaries(writing, paths);
  const entries: CollectionEntryRow[] = (summaries ?? []).map((entry) => ({
    art: entry.thumb === "" ? "glyph" : "image",
    path: entry.path,
    selected: entry.path === tab?.documentPath ? "true" : "false",
    status: entry.status,
    thumb: entry.thumb,
    title: entry.title,
  }));
  return {
    ...values,
    backTitle: collection?.title ?? writing,
    backCount: counts === null ? "" : String(paths.length),
    body: "entries",
    entries,
    entriesState: summaries === null ? "loading" : entries.length === 0 ? "empty" : "listed",
    newLabel: `New ${collection?.item ?? "entry"}`,
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Open a collection's grid on a saved view.
 *
 * The view is written onto the grid's working layout first, so a grid opened now loads it. A grid
 * already on screen has loaded its layout, so it is told through `grid.applyView`, the command the
 * grid's own picker runs.
 */
async function applyCollectionView(key: string, name: string): Promise<void> {
  const gridId = collectionGridId(key);
  const showing = activeTab.value?.id === gridId;
  applySavedView(gridId, name);
  if (showing) {
    await runActiveReported("grid.applyView", { name }, SOURCE);
    return;
  }
  const { openCollectionGrid, openPagesGrid } = await import("../grid/grid-open");
  if (key === PAGES_COLLECTION) {
    openPagesGrid();
  } else {
    openCollectionGrid(key);
  }
}

const ACTIONS: CollectionsPanelActions = {
  applyView: (key, name) => {
    const [collection = ""] = key.split("\n");
    void applyCollectionView(collection, name);
  },
  back: () => {
    const writing = writingCollection(activeTab.value);
    if (writing !== null) {
      void runActiveReported("content.showCollection", { collection: writing }, SOURCE);
    }
  },
  newCollection: () => {
    void runActiveReported("file.new", { kind: "collection" }, SOURCE);
  },
  newEntry: () => {
    const writing = writingCollection(activeTab.value);
    void runActiveReported(
      "file.new",
      writing === null
        ? { kind: "entry" }
        : { collection: writing, kind: "entry", ...newEntryLocale(writing) },
      SOURCE,
    );
  },
  openEntry: (path) => {
    void openEntry(path);
  },
  showCollection: (key) => {
    void runActiveReported("content.showCollection", { collection: key }, SOURCE);
  },
};

/**
 * The language a new entry starts in from the entries list: the one the entry being written is in,
 * else the one the collection's view is filtered to. Nothing when neither says, which leaves the
 * dialog on the site's default.
 */
export function newEntryLocale(collection: string): { locale?: string } {
  const { i18n } = resolveI18n(projectState?.projectConfig ?? {});
  const path = activeTab.value?.documentPath ?? null;
  const own = path === null ? null : localeOfPath(path, i18n);
  const locale = own ?? collectionView(collection).locale;
  return locale === "" ? {} : { locale };
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface StandingPanel {
  host: HTMLElement;
  handle: CollectionsPanelSurfaceHandle;
}

let _standing: StandingPanel | null = null;
let _unlisten: (() => void) | null = null;

/** Repaint the Navigator, which repaints this panel when it is the one showing. */
function repaint(): void {
  renderOnly("leftPanel");
}

/** Mount the surface into `host`, or bring the one already there up to date. */
function mountInto(host: HTMLElement): void {
  _unlisten ??= onEntrySummariesRead(repaint);
  if (_standing && (_standing.host !== host || !_standing.handle.connected())) {
    _standing.handle.dispose();
    _standing = null;
  }
  if (_standing) {
    _standing.handle.update(collectionsPanelValues());
    return;
  }
  _standing = {
    handle: mountCollectionsPanelSurface(host, collectionsPanelValues(), ACTIONS),
    host,
  };
}

/**
 * The Navigator's content area inside a panel body, where a mounted document goes (the reason is
 * `panels/elements-panel.ts`'s: the body is lit's part, and its child is the box a panel owns).
 */
function contentArea(body: HTMLElement): HTMLElement {
  return body.querySelector<HTMLElement>(".panel-content") ?? body;
}

/**
 * Contribute the Collections panel: project level (it lists the project's collections), no rail
 * button (Content has no rail), the Content workspace's Navigator.
 */
export function registerCollectionsPanel(): void {
  registerPanel({
    id: "collections",
    title: "Collections",
    level: "project",
    dock: "navigator",
    icon: "stack",
    rail: false,
    render: () => nothing,
    afterRender: (_ctx, host) => {
      mountInto(contentArea(host));
    },
  });
}

/** Forget the mounted panel — tests, and a project switch. */
export function resetCollectionsPanel(): void {
  _standing?.handle.dispose();
  _standing = null;
  _unlisten?.();
  _unlisten = null;
}
