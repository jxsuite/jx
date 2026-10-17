/// <reference lib="dom" />
/**
 * The Content home: one collection, browsed, in the Content workspace's home tab (`specs/studio.md`
 * §9.1.2, §22.5).
 *
 * The Library this replaces answered "where is everything" with one tab of every project file in
 * folder categories. That question has better answers now (pages, templates and components in the
 * Site panel, media in the Media workspace), and what was left is the Library's real job: browsing
 * and writing a COLLECTION. The home shows one at a time, the built-in **Pages** or a collection
 * the project declares, chosen in the Collections panel (`panels/collections-panel.ts`) or by
 * `content.showCollection`.
 *
 * The MARKUP is `surfaces/library-pane.json`, a Jx document over the kit; this module is the
 * projection and the decisions. Five things it is careful about:
 *
 * 1. **It never says "No files found" for two different reasons.** A scan that could not read a
 *    directory is INCOMPLETE, not empty; it raises a Problem carrying the directory and a Retry
 *    (`content.refresh`), and the surface says so. A filter that matched nothing says which filter.
 *    The four states are one word on the scope, so no two of them can be true at once.
 * 2. **The rendered item count is proportional to the viewport, not to the project.** See
 *    `../ui/virtual-window.ts` and `library-preview.ts`; the acceptance case is 300 pages.
 * 3. **Every collection keeps its own view.** Its view switch, search and language are its own
 *    ({@link contentView}`.views`), so Pages in Table and Posts in Cards is a state the home can be
 *    in, and coming back to a collection finds it as it was left.
 * 4. **Where a collection is published is read from the pages.** The header line ("Each post has a
 *    page at `/blog/:slug` using Post") is derived from the page whose `$paths.contentType` names
 *    the collection (`content/collection-pages.ts`), never stored beside it.
 * 5. **Creation is somebody else's flow.** **New <item>** runs `file.new` (Add new, §9.1.1) on the
 *    collection's kind, and **Add one** writes the collection's page exactly as Add new's own-page
 *    option does (`create/add-new-flow.ts` `addCollectionPage`).
 *
 * @docs studio/projects/browse
 */

import { effect, effectScope, reactive } from "../reactivity";
import { errorMessage } from "@jxsuite/schema/parse";
import { localeLabel } from "@jxsuite/schema/locale";
import { notify } from "../services/notify";
import { beginActivity } from "../panels/activity-panel";
import { showPromptDialog } from "../ui/layers";
import type { PromptDialogOptions } from "../ui/layers";
import { openMenu } from "../surfaces/menu";
import { getPlatform } from "../platform";
import { projectState, renderOnly } from "../store";
import { invalidateUsages } from "../services/references";
import { confirmFileDelete, renamePromptMessage } from "../files/file-ops";
import { openFileInTab } from "../files/files";
import { runActiveReported } from "../commands/run-reported";
import {
  PAGES_COLLECTION,
  contentCollection,
  templateDisplayName,
} from "../content/content-collections";
import { onCollectionPagesRead, peekCollectionPage } from "../content/collection-pages";
import { onEntrySummariesRead, peekEntrySummaries } from "../content/entry-summaries";
import { openEntry } from "../content/entry-open";
import {
  LIBRARY_LAYOUTS,
  LIBRARY_LAYOUT_LABELS,
  PREVIEW_LAYOUTS,
  filterLibrary,
  libraryLocales,
} from "./library-model";
import { createLibrarySource, libraryColumns } from "./library-source";
import { createPreviewCache, createPreviewObserver, previewFor } from "./library-preview";
import { computeWindow } from "../ui/virtual-window";
import { paneRegion } from "../ui/regions";
import {
  LAYOUT_METRICS,
  boardView,
  calendarView,
  columnsAt,
  entryFactsFrom,
  libraryRow,
} from "./library-layouts";
import { mountLibrarySurface } from "../surfaces/library-pane";
import type { ActivityHandle } from "../panels/activity-panel";
import type { ContentCollection } from "../content/content-collections";
import type { CollectionPage } from "../content/collection-pages";
import type { EffectScope } from "@vue/reactivity";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";
import type { LibraryFile, LibraryLayout } from "./library-model";
import type { EntryFacts, EntryFactsOf } from "./library-layouts";
import type { LibrarySource } from "./library-source";
import type {
  LibraryChip,
  LibraryPageLine,
  LibrarySurfaceHandle,
  LibraryView,
  LibraryViewKind,
} from "../surfaces/library-pane";
import type { WindowRange } from "../ui/virtual-window";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";

// ─── View state ──────────────────────────────────────────────────────────────

/** One collection's own view: how it is arranged, what it is filtered to. */
export interface CollectionViewState {
  layout: LibraryLayout;
  query: string;
  /**
   * The language facet: a canonical tag, or "" for every language.
   *
   * A tag rather than a label, because two locales can display the same autonym and only the tag
   * matches what {@link LibraryFile.locale} carries.
   */
  locale: string;
}

export interface ContentViewState {
  /** The collection the home shows: `pages`, or a declared collection's name. */
  collection: string;
  /** Each collection's own view, created the first time it is shown. */
  views: Record<string, CollectionViewState>;
  /** Bumped to force a repaint from a non-reactive source (a scroll, a finished scan). */
  revision: number;
  /** A scan is running. Distinct from "scanned and empty", which is what the old view conflated. */
  loading: boolean;
}

/** The view a collection starts in: Table, the shape both Content mockups open on. */
const DEFAULT_LAYOUT: LibraryLayout = "table";

/**
 * The Content home's state, reactive and module-scoped.
 *
 * Module-scoped rather than per-tab because there is one Content home per window, and because the
 * commands that write it must be able to do so whether or not the home is mounted:
 * `content.setLayout` run from the palette sets the view the home opens into. Per COLLECTION
 * inside, so one collection's view never leaks into another's.
 */
export const contentView: ContentViewState = reactive({
  collection: PAGES_COLLECTION,
  loading: false,
  revision: 0,
  views: {},
});

/** The view state of a collection, created on first read. */
export function collectionView(key: string = shownCollectionKey()): CollectionViewState {
  const existing = contentView.views[key];
  if (existing) {
    return existing;
  }
  const created: CollectionViewState = { layout: DEFAULT_LAYOUT, locale: "", query: "" };
  contentView.views[key] = created;
  // Read back through the reactive record, so a later write to the returned object is tracked.
  return contentView.views[key] ?? created;
}

/** The collection the home shows, falling back to Pages when its name has gone from the project. */
export function shownCollection(): ContentCollection {
  return (
    contentCollection(contentView.collection) ?? {
      fileBacked: false,
      item: "page",
      key: PAGES_COLLECTION,
      kind: "pages",
      title: "Pages",
    }
  );
}

/**
 * The key of the collection the home actually shows.
 *
 * `contentView.collection` is what was last ASKED for, and it can outlive its collection (a rename
 * or a removal in Settings › Content types). Every default that means "the shown collection" reads
 * this instead, so the view switch, search, language picker and preview tending all act on the
 * collection on screen rather than on a stale key.
 */
export function shownCollectionKey(): string {
  return shownCollection().key;
}

/** The window's scan source. Built lazily; discarded by {@link invalidateLibrary}. */
let source: LibrarySource | null = null;

/**
 * Whether a scan has been STARTED for the current source.
 *
 * Distinct from `source.scanned()`, which only answers whether one SUCCEEDED. The pane's render
 * effect kicks the first scan off, so without this a scan that failed would be retried on the very
 * repaint its own failure caused — an infinite loop, and the reason a Retry has to be a command the
 * reader presses rather than something the surface does on its own behalf.
 */
let scanAttempted = false;

/** The source, creating it on first use. */
export function librarySource(): LibrarySource {
  source ??= createLibrarySource();
  return source;
}

/** Repaint whatever is mounted, the Collections panel's counts included. */
function bump() {
  contentView.revision += 1;
}

/** Show a collection in the home. The home itself is opened by `content.showCollection`. */
export function setContentCollection(key: string): void {
  contentView.collection = key;
  collectionView(key);
  bump();
  renderOnly("leftPanel");
}

export function setLibraryLayout(layout: LibraryLayout, key: string = shownCollectionKey()): void {
  collectionView(key).layout = layout;
  bump();
}

export function setLibrarySearch(query: string, key: string = shownCollectionKey()): void {
  collectionView(key).query = query;
  bump();
}

/** Show one language, or `""` for all of them. A setter, so "" is a value and not an absence. */
export function setLibraryLocale(locale: string, key: string = shownCollectionKey()): void {
  collectionView(key).locale = locale;
  bump();
}

/**
 * Drop the scan and the rendered previews.
 *
 * Called by every surface that changes the project's file set — an upload, a creation, a rename, a
 * delete — so the home is never showing a file that is gone.
 *
 * The SLOT table survives, and that is the difference between this and a teardown: clearing the
 * cache detaches every rendered preview from the box it was in, and those boxes are still on
 * screen. The document reconciles a row whose path survived in place, so nothing re-announces the
 * box; the settle pass below is what fills it again.
 */
export function invalidateLibrary(): void {
  source = null;
  scanAttempted = false;
  for (const panel of _active.values()) {
    panel.cache.clear();
  }
  bump();
}

/**
 * How many files each collection holds, from the scan as it stands. Starts the scan when none has
 * been attempted, so the Collections panel can ask before the home has ever been shown; the panel
 * repaints when it lands.
 *
 * @returns Collection key → count, or `null` while no scan has finished.
 */
export function collectionCounts(): Map<string, number> | null {
  const current = librarySource();
  if (!scanAttempted && !contentView.loading) {
    void loadLibrary();
  }
  if (!current.scanned()) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const file of current.files()) {
    if (file.collection !== null) {
      counts.set(file.collection, (counts.get(file.collection) ?? 0) + 1);
    }
  }
  return counts;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

/** A scan slower than this earns an Activity row; a fast one must not litter the dock. */
export const SCAN_ACTIVITY_DELAY_MS = 600;

/** Deduplication key for the scan Problem, so a failing watcher is one row and not sixty. */
const SCAN_PROBLEM_KEY = "content.scan";

/** The `source` every Problem and toast this module files carries. */
const SOURCE = "Content";

/** The scan's Activity row, filled in only once the scan outlasts {@link SCAN_ACTIVITY_DELAY_MS}. */
interface SlowScanActivity {
  handle: ActivityHandle | null;
}

/**
 * Run the scan and report it honestly.
 *
 * No Cancel: `platform.listDirectory` has no abort, so a Cancel button here could only stop the
 * WAITING, not the work — and a button that does not do what it says is the failure the Activity
 * contract exists to end. The row is informational, and it only appears when the scan is slow
 * enough that its absence would look like a hang.
 */
async function loadLibrary(): Promise<void> {
  const current = librarySource();
  scanAttempted = true;
  contentView.loading = true;
  bump();

  const slow: SlowScanActivity = { handle: null };
  const timer = setTimeout(() => {
    slow.handle = beginActivity({
      source: SOURCE,
      status: "Reading the project's directories…",
      title: "Scan project files",
    });
  }, SCAN_ACTIVITY_DELAY_MS);

  try {
    await current.rows();
    const failures = current.failures();
    if (failures.length > 0) {
      const detail = failures.map((f) => `${f.dir} — ${f.error}`).join("\n");
      const summary = `Could not read ${failures.length} project ${
        failures.length === 1 ? "directory" : "directories"
      } — this list is incomplete.`;
      // A Problem, not a toast: the list on screen is wrong until this is fixed, and the fix is a
      // Command the row can run.
      notify.error(summary, {
        action: "content.refresh",
        detail,
        key: SCAN_PROBLEM_KEY,
        path: failures[0]!.dir,
        source: SOURCE,
        tier: "problem",
      });
      slow.handle?.setStatus(summary);
    }
    slow.handle?.done(`${current.files().length} file(s)`);
  } catch (error) {
    // `scanLibrary` does not reject, so reaching here means the platform itself is gone.
    const message = "Could not scan the project's files.";
    if (slow.handle) {
      slow.handle.fail(message);
    } else {
      notify.error(message, {
        action: "content.refresh",
        detail: errorMessage(error),
        key: SCAN_PROBLEM_KEY,
        source: SOURCE,
        tier: "problem",
      });
    }
  } finally {
    clearTimeout(timer);
    contentView.loading = false;
    bump();
    // The Collections panel draws the counts this scan just produced.
    renderOnly("leftPanel");
  }
}

/** Re-scan from scratch — the Retry behind the Problem. */
export async function refreshLibrary(): Promise<void> {
  source = null;
  scanAttempted = false;
  for (const panel of _active.values()) {
    panel.cache.clear();
  }
  await loadLibrary();
}

// ─── The mounted pane ────────────────────────────────────────────────────────

interface ActiveLibraryPane {
  /** The pane whose stage this home is drawn on. The map key, held on the record too. */
  paneId: string;
  tabId: string;
  scope: EffectScope;
  wrap: HTMLElement;
  surface: LibrarySurfaceHandle;
  cache: ReturnType<typeof createPreviewCache>;
  observer: ReturnType<typeof createPreviewObserver>;
  /** The scroller, once the document has rendered it. Announced through `onNodeCreated`. */
  scroller: HTMLElement | null;
  /** Slot elements awaiting a preview, keyed by the element itself. */
  pending: WeakMap<Element, string>;
  /** The live preview slot for each path, so a resolved render finds it. */
  slots: Map<string, HTMLElement>;
  /**
   * Paths whose preview is being built right now.
   *
   * Without this a repaint mid-load asks for the same document again: the settle pass runs over
   * every slot on screen, so a slot whose first read has not resolved would be asked a second time,
   * and a scroll through a long list would read each document several times over.
   */
  pendingPaths: Set<string>;
  /** The coalesced post-repaint pass; see {@link scheduleSettle}. */
  settleTimer: ReturnType<typeof setTimeout> | null;
  /** Stops listening for the collection-pages index. */
  unlisten: () => void;
}

/**
 * The home mounted in each pane, keyed by pane id.
 *
 * ONE instance per pane, not per window: pane B mounting the home must not destroy pane A's
 * `IntersectionObserver`, preview cache and effect scope while pane A's DOM is still on screen.
 */
const _active = new Map<string, ActiveLibraryPane>();

/** The home mounted in a pane, or null. */
function activeIn(paneId: string): ActiveLibraryPane | null {
  return _active.get(paneId) ?? null;
}

/** Whether the home is live in this pane for this tab — the canvas-render fast-path guard. */
export function libraryPaneMounted(paneId: string, tab: Tab): boolean {
  const panel = activeIn(paneId);
  return (
    panel !== null && panel.tabId === tab.id && panel.wrap.isConnected && panel.surface.attached()
  );
}

/** Tear one pane's home down (mode change, tab switch, project close). Idempotent. */
export function detachLibraryPane(paneId: string): void {
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  if (panel.settleTimer !== null) {
    clearTimeout(panel.settleTimer);
    panel.settleTimer = null;
  }
  panel.unlisten();
  panel.observer.destroy();
  panel.cache.clear();
  panel.slots.clear();
  panel.pendingPaths.clear();
  panel.scope.stop();
  panel.surface.dispose();
  _active.delete(paneId);
}

// ─── Geometry ────────────────────────────────────────────────────────────────

/** The window for the current layout, or the whole list for a layout that does not window. */
function windowFor(
  panel: ActiveLibraryPane | null,
  layout: LibraryLayout,
  count: number,
): WindowRange {
  const metric = LAYOUT_METRICS[layout];
  const scroller = panel?.scroller ?? null;
  if (!metric.windowed || !scroller) {
    return { end: count, padBottom: 0, padTop: 0, start: 0, totalRows: count };
  }
  return computeWindow({
    columns: columnsAt(layout, scroller.clientWidth),
    count,
    rowHeight: metric.rowHeight,
    scrollTop: scroller.scrollTop,
    viewportHeight: scroller.clientHeight,
  });
}

// ─── Previews ────────────────────────────────────────────────────────────────

/** Build a preview and attach it to whichever slot is currently showing that path. */
async function fillPreview(panel: ActiveLibraryPane, path: string) {
  // Only ever entered once per path at a time: both callers refuse a path already in flight.
  panel.pendingPaths.add(path);
  try {
    const rendered = await previewFor(path, panel.cache);
    if (!rendered || activeIn(panel.paneId) !== panel) {
      return;
    }
    const slot = panel.slots.get(path);
    if (slot?.isConnected && !slot.firstElementChild) {
      slot.append(rendered);
    }
  } finally {
    panel.pendingPaths.delete(path);
  }
}

/** Fill a slot from the cache, or watch it — whichever the cache and the in-flight set allow. */
function tendSlot(panel: ActiveLibraryPane, slot: HTMLElement, path: string): void {
  // Read the cache BEFORE the "already filled" shortcut, because the read is what marks the entry
  // As recently used. Skipping it let a preview that was on screen — and therefore never touched —
  // Drift to the tail of the LRU, get evicted, get detached, and be re-rendered on the next
  // Repaint: the 300-page measurement showed 560 reads for 300 documents until this line moved.
  const cached = panel.cache.get(path);
  if (slot.firstElementChild) {
    return;
  }
  if (cached) {
    slot.append(cached);
    return;
  }
  if (panel.pendingPaths.has(path)) {
    return;
  }
  panel.pending.set(slot, path);
  panel.observer.observe(slot);
}

/**
 * What the document announced: a preview box, created and still detached.
 *
 * The one seam a live preview can arrive through — the document renders the box and nothing inside
 * it (specs/studio-ui-guidelines.md §9.4, "an island attaches through `onNodeCreated`").
 */
function previewSlot(panel: ActiveLibraryPane, slot: HTMLElement, path: string): void {
  panel.slots.set(path, slot);
  tendSlot(panel, slot, path);
}

/**
 * The pass that runs once the document has reconciled, coalesced onto a task of its own.
 *
 * A document repaint is not a moment this module is present at: writing the projection returns
 * immediately and the runtime's keyed arrays reconcile a microtask later. Two things happen then:
 * observations of cards that left the window are released (an observation of a detached node can
 * never fire again, and it pins the card's subtree), and every visible slot is tended, which keeps
 * it at the head of the LRU and refills a box an eviction emptied.
 */
function scheduleSettle(panel: ActiveLibraryPane): void {
  if (panel.settleTimer !== null) {
    return;
  }
  panel.settleTimer = setTimeout(() => {
    panel.settleTimer = null;
    if (activeIn(panel.paneId) !== panel) {
      return;
    }
    panel.observer.releaseDetached();
    const previews = PREVIEW_LAYOUTS.has(collectionView().layout);
    for (const [path, slot] of panel.slots) {
      if (!slot.isConnected) {
        panel.slots.delete(path);
        continue;
      }
      if (previews) {
        tendSlot(panel, slot, path);
      }
    }
  }, 0);
}

// ─── Opening ─────────────────────────────────────────────────────────────────

/**
 * Open a row: a page in Design, an entry where it is written (`content/entry-open.ts`).
 *
 * The same answer whichever collection drew the row, because the file says what it is: a page is
 * Design's, and activating it enters Design (§22.1).
 */
export function openLibraryFile(file: Pick<LibraryFile, "path" | "collection">): void {
  if (file.collection === null || file.collection === PAGES_COLLECTION) {
    void openFileInTab(file.path);
  } else {
    void openEntry(file.path);
  }
}

// ─── Context menu ────────────────────────────────────────────────────────────

/**
 * The per-file menu the home has up, if any.
 *
 * One handle, because only one can be open: the kit's menu is a popover on the platform's own top
 * layer, and opening a second while the first is up is how two of them end up light-dismissing each
 * other.
 */
let _menu: MenuHandle | null = null;

function closeLibraryMenu(): void {
  _menu?.close();
  _menu = null;
}

/** The scanned file at a path, or null when the scan has moved on since the row was drawn. */
function fileAt(path: string): LibraryFile | null {
  return (
    librarySource()
      .files()
      .find((file) => file.path === path) ?? null
  );
}

/** The per-file menu, opened at the pointer. Region `content`. */
function showLibraryContextMenu(path: string, x: number, y: number): void {
  const file = fileAt(path);
  if (!file) {
    return;
  }
  closeLibraryMenu();
  const row = (
    id: string,
    title: string,
    run: () => void,
    extra: Partial<MenuRowProjection> = {},
  ): MenuRowProjection => ({
    destructive: false,
    disabled: false,
    dividerAbove: false,
    id,
    run,
    title,
    ...extra,
  });
  _menu = openMenu({
    label: "File actions",
    onClosed: (handle) => {
      if (_menu === handle) {
        _menu = null;
      }
    },
    origin: { x, y },
    region: "content",
    rows: [
      row("open", "Open", () => {
        openLibraryFile(file);
      }),
      row(
        "rename",
        "Rename…",
        () => {
          void renameLibraryFile(file);
        },
        { dividerAbove: true },
      ),
      row("duplicate", "Duplicate", () => {
        void duplicateLibraryFile(file);
      }),
      row(
        "delete",
        "Delete",
        () => {
          void deleteLibraryFile(file);
        },
        { destructive: true, dividerAbove: true },
      ),
    ],
  });
}

/**
 * The rename dialog — the same copy, from the same helper, as the Files panel's.
 *
 * A rename here rewrites references exactly as one in the sidebar does, and two dialogs that
 * disagreed about that is the divergence the shared helper exists to prevent.
 */
async function renameLibraryFile(file: LibraryFile) {
  const message = await renamePromptMessage(file.path);
  const prompt: PromptDialogOptions = {
    confirmLabel: "Rename",
    select: "stem",
    validate: (value) => (value.trim() ? "" : "Enter a file name."),
    value: file.name,
  };
  if (message !== undefined) {
    prompt.message = message;
  }
  const newName = await showPromptDialog("Rename", prompt);
  if (!newName || newName === file.name) {
    return;
  }
  const normalized = file.path.replaceAll("\\", "/");
  const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ".";
  const newPath = parent === "." ? newName : `${parent}/${newName}`;
  try {
    await getPlatform().renameFile(file.path, newPath);
    invalidateUsages();
    invalidateLibrary();
    await loadLibrary();
    notify.success(`Renamed to ${newName}`);
  } catch (error) {
    notify.error(`Could not rename ${file.name}.`, {
      detail: errorMessage(error),
      path: file.path,
      source: SOURCE,
    });
  }
}

async function duplicateLibraryFile(file: LibraryFile) {
  const normalized = file.path.replaceAll("\\", "/");
  const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ".";
  const stem = file.name.replace(/(\.[^.]+)$/, "");
  const copyName = `${stem}-copy${file.ext || ""}`;
  const copyPath = parent === "." ? copyName : `${parent}/${copyName}`;
  try {
    const platform = getPlatform();
    const content = await platform.readFile(file.path);
    await platform.writeFile(copyPath, content);
    invalidateLibrary();
    await loadLibrary();
    notify.success(`Duplicated as ${copyName}`);
  } catch (error) {
    notify.error(`Could not duplicate ${file.name}.`, {
      detail: errorMessage(error),
      path: file.path,
      source: SOURCE,
    });
  }
}

async function deleteLibraryFile(file: LibraryFile) {
  const confirmed = await confirmFileDelete(file);
  if (!confirmed) {
    return;
  }
  try {
    await getPlatform().deleteFile(file.path);
    invalidateUsages();
    invalidateLibrary();
    await loadLibrary();
    notify.success(`Deleted ${file.name}`);
  } catch (error) {
    notify.error(`Could not delete ${file.name}.`, {
      detail: errorMessage(error),
      path: file.path,
      source: SOURCE,
    });
  }
}

// ─── The collection's page ───────────────────────────────────────────────────

/** The template a collection's page is drawn in, as the header line names it. */
function templateClause(page: CollectionPage, defaultLayout: string | null): string {
  if (page.layout === false) {
    return "with no template";
  }
  const layout = page.layout ?? defaultLayout;
  return layout ? `using ${templateDisplayName(layout)}` : "with no template";
}

/**
 * The header line: where a collection's entries are published (§22.5).
 *
 * Pages have no line (a page is its own page), a collection whose index has not been read says
 * nothing yet, and a collection with no page says so with the way to add one.
 */
export function pageLineFor(
  collection: ContentCollection,
  page: CollectionPage | null | undefined,
  defaultLayout: string | null,
): LibraryPageLine {
  const hidden: LibraryPageLine = {
    designLabel: "",
    pattern: "",
    state: "hidden",
    template: "",
    text: "",
  };
  if (collection.kind === "pages" || collection.fileBacked) {
    return hidden;
  }
  if (page === undefined) {
    return { ...hidden, state: "loading", text: "Finding where these entries are published…" };
  }
  if (page === null) {
    return { ...hidden, state: "none", text: "Entries have no page of their own" };
  }
  return {
    designLabel: `Design the ${collection.item} page`,
    pattern: page.pattern,
    state: "page",
    template: templateClause(page, defaultLayout),
    text: `Each ${collection.item} has a page at`,
  };
}

/** Open the collection's page in Design: activating it enters Design (§22.1). */
function designCollectionPage(name: string): void {
  const page = peekCollectionPage(name);
  if (page) {
    void openFileInTab(page.path);
  }
}

/** Write the collection's page, as Add new's own-page option does, then show the new line. */
async function addCollectionPageFor(name: string): Promise<void> {
  const { addCollectionPage } = await import("../create/add-new-flow");
  await addCollectionPage(name);
}

// ─── The projection ──────────────────────────────────────────────────────────

/** A toolbar chip, marked when it is the one in force. */
function chip(key: string, label: string, active: boolean): LibraryChip {
  return { checked: active ? "true" : "false", key, label };
}

/** The sentence a filter that matched nothing prints, naming both facets rather than one. */
function noMatchMessage(collection: ContentCollection, view: CollectionViewState): string {
  const where = view.locale === "" ? "" : ` in ${localeLabel(view.locale)}`;
  const term = view.query.trim();
  return `No ${collection.kind === "pages" ? "pages" : collection.title.toLowerCase()} match${
    term ? ` “${term}”` : ""
  }${where}.`;
}

/** Which of the eight things the body draws right now. */
function viewKind(
  current: LibrarySource,
  layout: LibraryLayout,
  matched: number,
  total: number,
): LibraryViewKind {
  if (matched > 0) {
    return layout;
  }
  if (contentView.loading || !current.scanned()) {
    return "loading";
  }
  if (current.failures().length > 0) {
    return "incomplete";
  }
  return total === 0 ? "empty" : "nomatch";
}

/**
 * A collection's entry files, in scan order. The ONE list both the Content home and the Collections
 * panel read entry summaries for: the summary cache keeps one list per collection, so two
 * differently-ordered lists would each evict the other's read.
 */
export function collectionEntryPaths(key: string): string[] {
  return librarySource()
    .files()
    .filter((file) => file.collection === key)
    .map((file) => file.path);
}

/**
 * What each entry of a declared collection says about itself (title, status, date), read once
 * through the Collections panel's summaries. Pages and a file-backed collection (whose entries are
 * rows of one file) answer nothing, and so does every entry until the read lands.
 */
function entryFactsFor(collection: ContentCollection): EntryFactsOf {
  if (collection.kind !== "collection" || collection.fileBacked || !librarySource().scanned()) {
    return entryFactsFrom(new Map());
  }
  const summaries = peekEntrySummaries(collection.key, collectionEntryPaths(collection.key));
  const byPath = new Map<string, EntryFacts>(
    (summaries ?? []).map((entry) => [
      entry.path,
      { date: entry.date, status: entry.status, title: entry.title },
    ]),
  );
  return entryFactsFrom(byPath);
}

/** Everything the home draws in a pane, as one value. */
function homeView(panel: ActiveLibraryPane | null, paneId: string): LibraryView {
  const current = librarySource();
  const collection = shownCollection();
  const view = collectionView(collection.key);
  const { layout } = view;
  const all = filterLibrary(current.files(), { collection: collection.key, query: "" });
  const files = filterLibrary(current.files(), {
    collection: collection.key,
    locale: view.locale,
    query: view.query,
  });
  const total = all.length;
  const kind = viewKind(current, layout, files.length, total);
  const range = windowFor(panel, layout, files.length);
  const slice = files.slice(range.start, range.end);
  const failures = current.failures();
  const locales = libraryLocales(all);
  const factsOf = entryFactsFor(collection);
  const facts = all.map((file) => factsOf(file));
  const columns = libraryColumns(collection.key, {
    date: facts.some((entry) => (entry?.date ?? "") !== ""),
    status: facts.some((entry) => (entry?.status ?? "") !== ""),
  });
  const live = kind === "cards";
  const calendar =
    kind === "calendar" ? calendarView(files, factsOf) : { groups: [], truncated: "" };
  const pages = collection.kind === "pages";
  const plural = pages ? "pages" : collection.title.toLowerCase();

  return {
    bannerState: failures.length > 0 ? "shown" : "hidden",
    bannerText:
      failures.length === 0
        ? ""
        : `This list is incomplete — ${failures.length} ${
            failures.length === 1 ? "directory" : "directories"
          } could not be read (${failures[0]!.dir}${failures.length > 1 ? ", …" : ""}).`,
    columns: kind === "table" ? columns.map((c) => ({ field: c.field, title: c.title })) : [],
    emptyDetail:
      kind === "incomplete"
        ? `${failures.length} ${
            failures.length === 1 ? "directory" : "directories"
          } could not be read, so this is not the same as an empty collection.`
        : kind === "nomatch"
          ? `${total} ${total === 1 ? collection.item : plural} in all.`
          : kind === "empty"
            ? `New ${collection.item} adds the first one.`
            : "",
    emptyMessage:
      kind === "nomatch"
        ? noMatchMessage(collection, view)
        : kind === "empty"
          ? `No ${plural} yet.`
          : "",
    fieldsState: collection.kind === "collection" ? "shown" : "hidden",
    groups: kind === "board" ? boardView(files, factsOf) : calendar.groups,
    layouts: LIBRARY_LAYOUTS.map((name) =>
      chip(name, LIBRARY_LAYOUT_LABELS[name], layout === name),
    ),
    localeOptions: [
      { label: "All languages", value: "all" },
      ...locales.map((tag) => ({ label: localeLabel(tag), value: tag })),
    ],
    /* The facet's options come from ALL of the collection's files, never from the filtered ones: a
       picker whose choices collapse to the choice just made cannot be used to make another. One
       locale — or none — means every file already agrees. */
    localeState: locales.length < 2 ? "hidden" : "shown",
    localeValue: view.locale === "" ? "all" : view.locale,
    newLabel: `New ${collection.item}`,
    pad: `padding-top:${range.padTop}px;padding-bottom:${range.padBottom}px`,
    padBottom: `height:${range.padBottom}px`,
    padTop: `height:${range.padTop}px`,
    page: pageLineFor(
      collection,
      pages ? null : peekCollectionPage(collection.key),
      defaultLayoutPath(),
    ),
    query: view.query,
    region: paneRegion(paneId, "content"),
    rows:
      kind === "cards" || kind === "table"
        ? slice.map((file) =>
            libraryRow(file, kind === "table" ? columns : [], live, factsOf(file)),
          )
        : [],
    searchLabel: `Search ${plural}`,
    subtitle: pages ? "Every URL on your site." : "",
    title: collection.title,
    truncated: calendar.truncated,
    truncatedState: calendar.truncated === "" ? "hidden" : "shown",
    view: kind,
  };
}

/** The project's default layout, which a page with no `$layout` of its own is drawn in. */
function defaultLayoutPath(): string | null {
  // Read at call time: `projectState` is replaced wholesale on a project switch.
  return projectState?.projectConfig?.defaults?.layout ?? null;
}

// ─── Mount ───────────────────────────────────────────────────────────────────

/**
 * Draw the Content home into the pane. Re-entrant: a same-tab call while it is live is a no-op,
 * because the pane owns its own reactivity from here (the grid/settings/stylebook pattern).
 */
export function renderLibraryMode(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap: canvasWrap } = surface;
  if (libraryPaneMounted(paneId, tab)) {
    return;
  }
  detachLibraryPane(paneId);

  let panel: ActiveLibraryPane | null = null;
  const observer = createPreviewObserver((element) => {
    const live = panel;
    if (!live) {
      return;
    }
    const path = live.pending.get(element);
    if (path !== undefined) {
      live.pending.delete(element);
      void fillPreview(live, path);
    }
  });

  const draw = () => {
    if (panel !== null && activeIn(paneId) === panel) {
      panel.surface.update(homeView(panel, paneId));
      scheduleSettle(panel);
    }
  };

  const mounted = mountLibrarySurface(canvasWrap, homeView(null, paneId), {
    addPage: () => {
      void addCollectionPageFor(shownCollection().key);
    },
    contextMenu: (path, x, y) => showLibraryContextMenu(path, x, y),
    designPage: () => {
      designCollectionPage(shownCollection().key);
    },
    openFields: () => {
      void runActiveReported(
        "settings.open",
        { entry: shownCollection().key, section: "content" },
        SOURCE,
      );
    },
    openGrid: () => {
      void runActiveReported("collection.editInGrid", { name: shownCollection().key }, SOURCE);
    },
    openFile: (path) => {
      openLibraryFile(fileAt(path) ?? { collection: shownCollectionKey(), path });
    },
    openNew: () => {
      const collection = shownCollection();
      void runActiveReported(
        "file.new",
        collection.kind === "pages"
          ? { kind: "page" }
          : { collection: collection.key, kind: "entry" },
        SOURCE,
      );
    },
    previewSlot: (element, path) => {
      if (panel) {
        previewSlot(panel, element, path);
      }
    },
    reset: () => {
      setLibrarySearch("");
      setLibraryLocale("");
    },
    retry: () => {
      void refreshLibrary();
    },
    scrolled: () => bump(),
    scroller: (element) => {
      if (panel) {
        panel.scroller = element;
      }
    },
    search: (value) => setLibrarySearch(value),
    /* SAFETY: the surface's view buttons pass `$map.item.key`, and the `layouts` state they map is
       built from LIBRARY_LAYOUTS in the projection above, so every key is a LibraryLayout. */
    setLayout: (key) => setLibraryLayout(key as LibraryLayout),
    setLocale: (value) => setLibraryLocale(value === "all" ? "" : value),
  });

  const scope = effectScope();
  panel = {
    cache: createPreviewCache(),
    observer,
    paneId,
    pending: new WeakMap(),
    pendingPaths: new Set(),
    scope,
    scroller: null,
    settleTimer: null,
    slots: new Map(),
    surface: mounted,
    tabId: tab.id,
    unlisten: (() => {
      // The collection's page and its entries' titles are both read after the first paint.
      const stopPages = onCollectionPagesRead(() => bump());
      const stopEntries = onEntrySummariesRead(() => bump());
      return () => {
        stopPages();
        stopEntries();
      };
    })(),
    wrap: canvasWrap,
  };
  _active.set(paneId, panel);

  scope.run(() => {
    effect(() => {
      if (activeIn(paneId) !== panel) {
        return;
      }
      // Everything the pane draws from.
      void contentView.revision;
      void contentView.collection;
      void contentView.loading;
      const view = collectionView(shownCollectionKey());
      void view.layout;
      void view.query;
      void view.locale;

      draw();

      if (!scanAttempted && !contentView.loading) {
        void loadLibrary();
      }
    });
  });
}

/** Forget every collection's view and the scan — tests, and a project switch. */
export function resetContentView(): void {
  contentView.collection = PAGES_COLLECTION;
  contentView.views = {};
  contentView.loading = false;
  source = null;
  scanAttempted = false;
  bump();
}
