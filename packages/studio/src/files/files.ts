/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * File tree management — project loading, file CRUD, and the flow behind the Navigator's Files
 * panel.
 *
 * **The body is a Jx document** (`surfaces/files-panel.json`, mounted by
 * `surfaces/files-panel.ts`), so this module draws no markup: it projects. What stays here is
 * everything that is a DECISION — which directories are listed, which entries `.gitignore` masks,
 * how the flat row model is built and where the window falls on it, what a click and a key MEAN,
 * what the per-row menu offers, and what each verb does to the filesystem. The surface reads
 * values.
 *
 * Every name the user supplies (new file, rename) is collected with the prompt dialog from
 * ui/layers.ts — never a native browser prompt (studio-ui-guidelines.md §8.7).
 *
 * **The tree is a flat list of rows, and the DOM holds a window onto it** ({@link FileRow},
 * `ui/virtual-window.ts`). It used to recurse a template per directory level, which is why it drew
 * every expanded row of every expanded directory — a `node_modules` expanded by accident is tens of
 * thousands of icon custom elements, built synchronously, on every repaint. A recursion has no row
 * list to window, so the recursion moved into {@link collectFileRows}, which produces the rows in
 * display order and nothing else; the projection is then a window over that array.
 *
 * Flattening costs the `role="group"` wrappers, and pays for them with `aria-level` +
 * `aria-posinset` / `aria-setsize` on every row — the same shape the Outline has always had, and
 * the only shape that stays TRUE when the tree draws eleven rows out of ten thousand.
 *
 * **Four facts about a row are ONE scope field each**, not fields of the row: the selected path,
 * the dragged path, the drop target and the roving tab stop. The document compares each against
 * `$map.item.path`, so moving the selection or dragging a file re-evaluates one attribute per drawn
 * row instead of rebuilding the list — which is what lets a drag-over highlight cost nothing, and
 * what stops a window sliding out from under the drag sources pragmatic-dnd is holding.
 *
 * @docs studio/interface
 */

import { nothing } from "lit-html";
import { errorMessage } from "@jxsuite/schema/parse";
import { localeLabel, localeOfPath, resolveI18n } from "@jxsuite/schema/locale";
import { showPromptDialog } from "../ui/layers";
import { projectState, requireProjectState, setProjectState } from "../store";
import { getPlatform } from "../platform";
import { disarmPreviewOverlay } from "../preview/preview-overlay";
import { notify } from "../services/notify";
import { loadComponentRegistry } from "./components";
import { ensureDependenciesInstalled } from "../packages/ensure-deps";
import { maybePromptJxsuiteUpdate } from "../packages/jxsuite-update";
import { autoSyncProjectOnOpen } from "../packages/pull-package-sync";
import { markLocalMutation } from "./fs-events";
import { ensureIgnoreLayers, isIgnoredEntry, resetIgnoreCache } from "./gitignore";
import { SETTINGS } from "../services/settings/definitions";
import { readStoredSetting, setSetting } from "../services/settings/kernel";
import { registerPanel } from "../panels/panel-registry";
import { isImage, uploadAccept, uploadAssets } from "./media-upload";
import { isCollabPath } from "../collab/collab-state";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  activateTab,
  moveTabToPane,
  openTab,
  paneOfTab,
  receivingPane,
  renameTab,
  replaceAllTabs,
  setWorkspaceProject,
  workspace,
} from "../workspace/workspace";
import { openCsvGridTab, openPagesGrid } from "../grid/grid-open";
import { isViewableMedia, openMediaTab } from "../media/media-open";
import { activeRegistry } from "../commands/active-registry";
import { collectionOfPath } from "../content/entry-model";
import { confirmFileDelete, parseSourceForPath, renamePromptMessage } from "./file-ops";
import { invalidateUsages } from "../services/references";
import {
  documentExtensions,
  formatByExtension,
  formatForPath,
  loadFormats,
  noFormatError,
  refreshExtensionUi,
  refreshFormats,
} from "../format/format-host";
import { convertTargets, creationFormats, knownDocumentExtensions } from "../format/format-choices";
import { collectionForDirectory } from "../content/collection-match";
import { markSessionRestored, persistedSession, resetProjectShell, setActivityTab } from "../shell";
import { restoreSession } from "../workspace/session";
import { cleanupGitPanel } from "../panels/git-panel";
import { addRecentProject, trackRecentFile } from "../recent-projects";
import { listWindow, revealListRow, watchListWindow } from "../ui/virtual-window";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import type { ChoiceOption } from "../ui/layers";
import { emptyFilesPanelValues, mountFilesPanelSurface } from "../surfaces/files-panel";
import { openMenu } from "../surfaces/menu";
import type {
  FileRowView,
  FilesPanelActions,
  FilesPanelSurfaceHandle,
  FilesPanelValues,
} from "../surfaces/files-panel";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";
import type { DirEntry, RenameResult } from "../types";
import type { ListWindowWatch } from "../ui/virtual-window";

// ─── File management ──────────────────────────────────────────────────────────

export async function loadDirectory(dirPath: string) {
  if (!projectState) {
    return;
  }
  try {
    const platform = getPlatform();
    /* The `.gitignore` chain is fetched WITH the listing, not after it: `collectFileRows` reads the
       ignore rules synchronously while it builds rows, and a repaint that beat the rules would draw
       a `node_modules` and then take it away again. Concurrent, because neither needs the other. */
    const [entries] = await Promise.all([
      platform.listDirectory(dirPath),
      ensureIgnoreLayers(dirPath),
    ]);
    projectState.dirs.set(dirPath, entries);
  } catch {
    projectState.dirs.set(dirPath, []);
  }
}

/**
 * Whether the tree currently draws the files `.gitignore` masks.
 *
 * Read through the kernel on every render rather than cached in a module variable: the setting
 * roams, so another window can change it, and this one repaints on `onSettingsChanged`.
 */
export function showIgnoredFiles(): boolean {
  return readStoredSetting(SETTINGS.showIgnoredFiles) === "true";
}

/** Set whether the tree draws the files `.gitignore` masks. */
export function setShowIgnoredFiles(show: boolean): void {
  setSetting(SETTINGS.showIgnoredFiles, show ? "true" : "");
}

/** Probe the dev server for a root project and populate projectState. */
export async function loadProject() {
  try {
    const platform = getPlatform();
    const result = await platform.probeRootProject();
    if (!result) {
      return;
    }
    const { meta, info } = result;

    refreshFormats();
    void loadFormats();
    refreshExtensionUi(platform);
    resetIgnoreCache();

    setProjectState({
      dirs: new Map(),
      expanded: new Set(),
      isSiteProject: info.isSiteProject,
      name: info.isSiteProject ? info.projectConfig?.name || meta.name : meta.name,
      projectConfig: (info.isSiteProject ? info.projectConfig : null) || null,
      projectDirs: info.directories || [],
      projectRoot: ".",
      root: meta.root,
      searchQuery: "",
      selectedPath: null,
    });
    // Only a site project counts as an open project for the workspace (a bare monorepo root keeps
    // The assistant in bootstrap mode).
    if (info.isSiteProject) {
      setWorkspaceProject(meta.root || ".", info.projectConfig || null);
    }

    if (info.isSiteProject) {
      addRecentProject(requireProjectState().name, meta.root);
      await autoSyncProjectOnOpen();
      if (await ensureDependenciesInstalled()) {
        // The registry above was fetched from a project with no `node_modules`, and `loadFormats`
        // Memoises — so without this the picker, the convert targets and every parse in the session
        // Are answered by the empty registry a fresh clone had.
        refreshFormats();
        await loadFormats();
        refreshExtensionUi(platform);
      }
      await loadDirectory(".");
      await loadComponentRegistry();
      await openLastSessionOrHome();
      void maybePromptJxsuiteUpdate(meta.root);
    }
    // If not a site project (monorepo) — show welcome prompt, don't load tree
  } catch {
    // Not on dev server — project features disabled
  }
}

// ─── Open Project (PAL-based) ─────────────────────────────────────────────

/**
 * Open a project via the platform adapter, into THIS window.
 *
 * Reports whether a project was actually opened: a cancelled picker and a failed open both leave
 * the window on the project it already had, and the caller announces the outcome — "Opening the
 * project…" over a dialog the user just dismissed is a report of something that did not happen.
 *
 * @param {{ renderLeftPanel: () => void }} ctx
 * @returns {Promise<boolean>} Whether the window changed project.
 */
export async function openProject({
  renderLeftPanel,
}: {
  renderLeftPanel: () => void;
}): Promise<boolean> {
  try {
    const platform = getPlatform();
    const result = await platform.openProject();
    if (!result) {
      return false;
    } // User cancelled

    const { config, handle } = result;

    replaceAllTabs({
      document: { children: [], tagName: "div" },
      id: "initial",
    });

    /* A different project means a different preview origin, and the published map is keyed by
       project-relative path — so carrying it across would let one project's `pages/index.json`
       stand in as the answer for another's. */
    disarmPreviewOverlay();
    refreshFormats();
    void loadFormats();
    refreshExtensionUi(platform);
    resetIgnoreCache();

    setProjectState({
      .../** @type {ProjectState} */ projectState,
      dirs: new Map(),
      expanded: new Set(),
      isSiteProject: true,
      name: config.name || handle.name,
      projectConfig: config,
      projectRoot: handle.root,
      searchQuery: "",
      selectedPath: null,
    });
    setWorkspaceProject(handle.root, config);

    await autoSyncProjectOnOpen();
    if (await ensureDependenciesInstalled()) {
      // See the note in `probeRootProject`: the registry was fetched before the install ran.
      refreshFormats();
      await loadFormats();
      refreshExtensionUi(platform);
    }
    await loadDirectory(".");
    await loadComponentRegistry();

    // Auto-expand key directories and populate projectDirs for Browse view
    const conventionalDirs = new Set([
      "pages",
      "layouts",
      "components",
      "content",
      "data",
      "public",
      "styles",
    ]);
    const entries = requireProjectState().dirs.get(".") || [];
    const foundDirs = [];
    for (const e of entries) {
      if (e.type === "directory" && conventionalDirs.has(e.name)) {
        foundDirs.push(e.name);
        requireProjectState().expanded.add(e.path || e.name);
        await loadDirectory(e.path || e.name);
      }
    }
    requireProjectState().projectDirs = foundDirs;

    // Source control, the stylebook selection and the settings tab describe the project being
    // Left behind. The poll timer goes with them; the panel re-arms it on its next render.
    cleanupGitPanel();
    resetProjectShell();
    setActivityTab("files");
    addRecentProject(requireProjectState().name, requireProjectState().projectRoot);
    renderLeftPanel();
    // The project's name is permanent state in the status bar's PROJECT field now.

    await openLastSessionOrHome();
    void maybePromptJxsuiteUpdate(requireProjectState().projectRoot);
    return true;
  } catch (error) {
    notify.error("Could not open the project.", {
      detail: errorMessage(error),
      source: "Open Project",
    });
    return false;
  }
}

/**
 * Give a freshly created project a git repository, so its first irreversible action is recoverable.
 *
 * Runs on the create/import path only, immediately after the backend has written the project — the
 * scaffold is not a repository and nothing else in Studio says so, while Delete and Rename are one
 * confirm click away. `activate` binds the backend to the new root first, because `gitInit` takes
 * no argument and would otherwise run against whichever project the window was serving.
 *
 * Never re-initialises, and never runs on repository-backed platforms (`createDestination: "repo"`
 * — a cloud project _is_ a GitHub repository, and its `gitInit` is a no-op by design).
 *
 * @param {string} root Absolute root of the project just created.
 * @returns {Promise<boolean>} Whether a repository was initialised.
 */
export async function initProjectRepo(root: string): Promise<boolean> {
  const platform = getPlatform();
  if (platform.createDestination !== "path") {
    return false;
  }
  try {
    await platform.activate(root);
    const status = await platform.gitStatus();
    if (status.isRepo) {
      return false;
    }
    await platform.gitInit();
    notify.success("Initialized a git repository for this project.");
    return true;
  } catch (error) {
    // Version control is a safety net, not a precondition — a project that was written stays
    // Written. Say so rather than failing the create the user just completed.
    notify.warn("Could not initialize a git repository — the project itself was written.", {
      detail: errorMessage(error),
      source: "Source Control",
    });
    return false;
  }
}

/**
 * The project's home page path (`pages/index.<page-ext>` or `pages/index.json`), or null if none.
 * Lists `pages/` once and matches by name — a directory read returns 200 with `[]` for a missing
 * dir, so this never provokes the console 404s a blind per-candidate read would.
 */
export async function findHomePage(): Promise<string | null> {
  await loadFormats();
  const exts = [...documentExtensions("page"), ".json"];
  let entries: DirEntry[];
  try {
    entries = await getPlatform().listDirectory("pages");
  } catch {
    return null;
  }
  const files = new Set(entries.filter((e) => e.type === "file").map((e) => e.name));
  for (const ext of exts) {
    if (files.has(`index${ext}`)) {
      return `pages/index${ext}`;
    }
  }
  return null;
}

export async function openHomePage() {
  const home = await findHomePage();
  if (home) {
    await openFileInTab(home);
  }
}

/**
 * Reopen the documents this project was last left with, or its home page if there are none.
 *
 * Plan §4.4, and P3's "Newly possible": **the session survives a relaunch.** Every one of the three
 * ways into a project — the `?project=` bootstrap, the PAL picker and a recent-project open — ended
 * at `openHomePage()`, so nine open documents, a split and the mode you were in were lost each
 * time. The per-project record's own interface said "session state grows into this shape".
 *
 * ONE function for all three, because the three used to be three calls to `openHomePage` and this
 * is exactly the kind of behaviour that lands on two of them.
 *
 * A path that no longer resolves is skipped, and a session that restores NOTHING falls through to
 * the home page rather than leaving an empty window: files move, and a stale record must not cost
 * you the one page a project can always show.
 *
 * @returns Whether a SESSION was restored — `false` means the home page was opened instead.
 */
export async function openLastSessionOrHome(): Promise<boolean> {
  // `workspace.projectRoot`, and NOT a root passed in: that is the key `persistProjectShell` writes
  // Under, and the three callers each know the project by a slightly different name — `meta.root`,
  // `projectState.projectRoot`, the recent-list entry. One reader of one field cannot disagree with
  // The writer; three callers passing three spellings silently restore nothing.
  const session = persistedSession(workspace.projectRoot);
  // Read first, THEN allow writes: the persist effect fires the moment `workspace.projectRoot` is
  // Set, and an empty workspace captured at that instant would overwrite the very record this line
  // Reads. See `markSessionRestored`.
  markSessionRestored(workspace.projectRoot);
  if (session) {
    const opened = await restoreSession(session, {
      ensureSecondPane: () => {
        receivingPane();
      },
      openFile: (path, paneId) => openFileInTab(path, { focus: false, paneId }),
    });
    if (opened > 0) {
      return true;
    }
  }
  await openHomePage();
  // Whether a SESSION was restored, which is not the same as whether anything opened: the
  // `?project=` boot needs to know if it should still run its own inline open, and a home page is
  // Not an answer to that question.
  return false;
}

// ─── Row icons ────────────────────────────────────────────────────────────────

/**
 * The kit glyph one row draws, by NAME rather than by tag.
 *
 * It used to be a map of six `sp-icon-*` templates built once at module load, which is a
 * `TemplateResult` per icon whether or not the tree was ever opened. A name is a string the
 * document hands `jx-icon`, and the manifest is what resolves it — so a row costs nothing until it
 * is drawn, and `scripts/check-icons.ts` checks the key against the same manifest the rail's does.
 */
function fileIconName(name: string, type: string, expanded: boolean): string {
  if (type === "directory") {
    return expanded ? "folder-open" : "folder";
  }
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "css":
    case "js":
    case "json":
    case "ts": {
      return "file-code";
    }
    case "md": {
      return "file-text";
    }
    default: {
      // Every image extension the media layer knows about, so an uploaded .avif/.ico gets the
      // Same icon as a .png instead of falling through to the generic document glyph.
      return ext !== undefined && isImage(ext) ? "image" : "file";
    }
  }
}

/**
 * The Navigator no longer draws this panel with lit.
 *
 * The record below returns `nothing` and mounts `surfaces/files-panel.json` in `afterRender`, so
 * this is a stub: it survives only because `NavigatorPanelDeps` still declares the injection and
 * `studio.ts` still passes it. Both go in the change that deletes this.
 *
 * @deprecated The panel is `surfaces/files-panel.json`; call {@link mountFilesPanel}.
 */
export function renderFilesTemplate(): typeof nothing {
  return nothing;
}

/**
 * Drag-and-drop is registered against the row elements the DOCUMENT creates, as they are created.
 *
 * The pass this replaced ran on a `requestAnimationFrame` after every repaint, found the tree and
 * its rows by class, and re-registered every one of them — which is exactly the acquisition
 * `studio-ui-guidelines.md` §9.4 objects to, and which a WINDOWED list makes wrong rather than
 * merely wasteful: the rows are re-used for different files as the window slides, so a pass that
 * arrives one frame late hands a file's drag source to whichever file is standing in its place.
 * {@link mountFilesPanel} adopts each row through `onNodeCreated` instead.
 *
 * @deprecated Registration is `onNodeCreated`; this exists for the deps entry alone.
 */
export function registerFileTreeDnD(_ctx: { renderLeftPanel: () => void }): void {
  // Intentionally nothing: see the note above.
}

// ─── The row model, and the window onto it ───────────────────────────────────

/**
 * One row the Files tree would draw, in display order.
 *
 * An expanded directory contributes its children immediately after its own row, so an index into
 * this array is what "the row below this one" MEANS for the keyboard — and it goes on meaning it
 * whether or not the row below happens to be painted.
 */
interface FileRow {
  /**
   * The `$map` key the document reconciles by.
   *
   * Keyed, where the recursive form was positional: a windowed list re-uses its DOM nodes for
   * DIFFERENT rows as the window slides, so positional reuse would leave the keyboard focused on an
   * element that has since become another file. The prefix is what keeps a directory's own row and
   * the "Loading…" row underneath it apart — they name the same path.
   */
  key: string;
  path: string;
  name: string;
  type: string;
  depth: number;
  expanded: boolean;
  /** A placeholder for a directory whose listing has not arrived yet. Not a `treeitem`. */
  loading: boolean;
  /** 1-based position among this row's siblings (`aria-posinset`). */
  posInSet: number;
  /** How many siblings the row has, itself included (`aria-setsize`). */
  setSize: number;
  /**
   * The declared locale whose directory this row sits under, or absent.
   *
   * A chip, not a filter term: the tree's search still matches `entry.name` alone, because a query
   * that silently also matched a language would make "why is this file here" unanswerable from what
   * is on screen.
   */
  locale?: string | undefined;
}

/**
 * The declared height of one row — the `--jx-control-h` the document gives `[part="row"]`.
 *
 * The first paint of a session windows by this constant, because nothing has been laid out yet to
 * measure; {@link fileRowHeight} measures a real row from then on and believes the measurement.
 */
export const FILE_ROW_HEIGHT = 24;

/** The rows the tree last built, in display order. */
let _fileRows: FileRow[] = [];
/** The tree element, adopted through the document's `onNodeCreated` so it is never re-found. */
let _fileList: HTMLElement | null = null;
/**
 * Every DRAWN row's element, by path.
 *
 * Held rather than queried, which is the §9.4 rule and, for a windowed list, the only correct
 * answer: the nodes are re-used for different files as the window slides, so a selector run a frame
 * later resolves to whichever file is standing there now. Entries whose element has left the
 * document are swept on the next projection.
 */
const _fileRowEls = new Map<string, HTMLElement>();
/** The scroll watch that repaints the tree as its scroller moves. */
let _fileWatch: ListWindowWatch | null = null;
/** The Navigator repaint, captured per render so the scroll watch never holds a stale one. */
let _filesRerender: (() => void) | null = null;
/** A keyboard jump that had to scroll first, spent by the repaint it provoked. */
let _pendingFocusPath: string | null = null;

/**
 * The height one row actually has; the declared constant until a row has been laid out.
 *
 * Measured off a row this module already holds. The DECLARED height is what lets the FIRST render
 * window anything at all, before any row exists; the MEASUREMENT is what stops that constant
 * becoming a lie the day the density setting changes it, a user zooms, or a locale's font raises
 * the line box.
 */
function fileRowHeight(): number {
  for (const el of _fileRowEls.values()) {
    if (el.isConnected && el.offsetHeight > 0) {
      return el.offsetHeight;
    }
  }
  return FILE_ROW_HEIGHT;
}

/** Forget the rows the window has taken away, and release what was registered against them. */
function sweepRowElements(): void {
  for (const [path, el] of _fileRowEls) {
    if (!el.isConnected) {
      _fileRowEls.delete(path);
      releaseRowDnD(el);
    }
  }
}

/** The rendered row for a path, or null when the window does not currently hold it. */
function fileRowElement(path: string): HTMLElement | null {
  const el = _fileRowEls.get(path);
  return el?.isConnected === true ? el : null;
}

/** The model row for a path, or undefined. A "Loading…" row is keyed apart and never matches. */
function fileRowAt(path: string): FileRow | undefined {
  return _fileRows.find((row) => !row.loading && row.path === path);
}

/**
 * Append one directory's rows, and every expanded child directory's rows after their own row.
 *
 * The listing side effect stays exactly where the recursive template had it: a directory nobody has
 * listed yet is fetched, and a placeholder holds its place until the repaint arrives.
 */
function collectFileRows(
  dirPath: string,
  depth: number,
  rows: FileRow[],
  i18n: ResolvedI18n | null,
): void {
  const entries = requireProjectState().dirs.get(dirPath);
  if (!entries) {
    void loadDirectory(dirPath).then(() => repaintFiles());
    rows.push({
      depth,
      expanded: false,
      key: `loading:${dirPath}`,
      loading: true,
      name: "Loading…",
      path: dirPath,
      posInSet: 1,
      setSize: 1,
      type: "file",
    });
    return;
  }

  const sorted = [...entries].toSorted((a, b) => {
    if (a.type === "directory" && b.type !== "directory") {
      return -1;
    }
    if (a.type !== "directory" && b.type === "directory") {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });

  /* Ignored entries are dropped HERE and not at the listing, so `projectState.dirs` goes on
     mirroring the filesystem for everything else that reads it and the toggle is a repaint. An
     ignored directory contributes no row, so nothing ever recurses into one — which is also git's
     rule that a parent's exclusion cannot be undone from inside it. */
  const visible = showIgnoredFiles()
    ? sorted
    : sorted.filter((e) => !isIgnoredEntry(dirPath, e.path, e.type === "directory"));

  const query = requireProjectState().searchQuery.toLowerCase();
  const filtered = query
    ? visible.filter((e) => e.type === "directory" || e.name.toLowerCase().includes(query))
    : visible;

  for (const [index, entry] of filtered.entries()) {
    const isDir = entry.type === "directory";
    const isExpanded = isDir && requireProjectState().expanded.has(entry.path);
    rows.push({
      depth,
      expanded: isExpanded,
      key: entry.path,
      loading: false,
      name: entry.name,
      path: entry.path,
      locale: localeOfPath(entry.path, i18n) ?? undefined,
      posInSet: index + 1,
      setSize: filtered.length,
      type: entry.type,
    });
    if (isExpanded) {
      collectFileRows(entry.path, depth + 1, rows, i18n);
    }
  }
}

/** The model index of `path`, or -1. A "Loading…" row is keyed apart and never matches. */
function fileIndexOfPath(path: string | undefined): number {
  return path === undefined ? -1 : _fileRows.findIndex((row) => !row.loading && row.path === path);
}

/** The next focusable row from `index`, walking by `step`; -1 at the ends. */
function fileStep(index: number, step: 1 | -1): number {
  for (let i = index + step; i >= 0 && i < _fileRows.length; i += step) {
    if (!_fileRows[i]!.loading) {
      return i;
    }
  }
  return -1;
}

/**
 * Repaint the tree because its window changed.
 *
 * Deferred to a microtask so a scroll arriving mid-commit cannot re-enter the projection producing
 * the rows, and skipped during a drag: a window that slid under pragmatic-dnd would hand its
 * registrations to a different set of rows halfway through the gesture. `_dragPath` is what says a
 * drag is in flight — a state this module holds, where it used to be a class on a node it then had
 * to go and look for.
 */
function fileWindowChanged(): void {
  if (_fileList?.isConnected !== true || _dragPath !== "") {
    return;
  }
  queueMicrotask(repaintFiles);
}

/**
 * Adopt the tree: keep it watching whatever scrolls it, and hand the keyboard the row a jump asked
 * for once that row exists.
 *
 * Called after every projection rather than once at mount, and that is not belt-and-braces. The
 * tree element is created ONE time — the document re-uses it for the life of the panel — and at
 * that instant it holds no rows, so it does not yet overflow and `watchListWindow` correctly
 * resolves no scroller at all. The first paint draws every row, because nothing can be measured
 * before it exists; the watch's opening measurement is what asks for the second, windowed pass.
 * Idempotent by construction — `watchListWindow` hands back the same watch for the same element and
 * scroller — so calling it again costs a comparison.
 */
function adoptFileTree(): void {
  const tree = _fileList;
  if (tree === null) {
    return;
  }
  _fileWatch = watchListWindow(_fileWatch, tree, {
    count: () => _fileRows.length,
    onChange: fileWindowChanged,
    rowHeight: fileRowHeight,
  });
  takePendingFocus();
}

/**
 * Move the keyboard to the row a jump asked for, once that row is on screen.
 *
 * One shot, whichever of the two callers gets there first: a row that was already drawn is focused
 * when the projection settles, and a row the scroller had to reveal is focused the moment its
 * element announces itself. A focus request that outlived its own repaint is stale, and moving the
 * keyboard later is worse than never having moved it.
 */
function takePendingFocus(): void {
  const wanted = _pendingFocusPath;
  if (wanted === null) {
    return;
  }
  const el = fileRowElement(wanted);
  if (el) {
    _pendingFocusPath = null;
    el.focus();
  }
}

// ─── What the document draws ─────────────────────────────────────────────────

/** One model row, as the document reads it: every field a string, and nothing left to decide. */
function fileRowView(row: FileRow): FileRowView {
  const level = String(row.depth + 1);
  if (row.loading) {
    return {
      ariaExpanded: "",
      depth: String(row.depth),
      icon: "",
      key: row.key,
      kind: "loading",
      level,
      locale: "",
      localeState: "hidden",
      name: row.name,
      path: row.path,
      posInSet: "",
      setSize: "",
      twisty: "none",
      type: row.type,
    };
  }
  const isDir = row.type === "directory";
  return {
    ariaExpanded: isDir ? String(row.expanded) : "",
    depth: String(row.depth),
    icon: fileIconName(row.path, row.type, row.expanded),
    key: row.key,
    kind: "item",
    level,
    locale: row.locale === undefined ? "" : localeLabel(row.locale),
    localeState: row.locale === undefined ? "hidden" : "shown",
    name: row.name,
    path: row.path,
    posInSet: String(row.posInSet),
    setSize: String(row.setSize),
    twisty: isDir ? (row.expanded ? "expanded" : "collapsed") : "none",
    type: row.type,
  };
}

/**
 * Everything the Files document draws right now.
 *
 * Three shapes, discriminated by one word, because "there is no project", "this is a monorepo root
 * that has not been pointed at a site" and "here is a tree" are three different things to say and
 * the first two have different offers. The rows are the WINDOW, and the scroll of everything either
 * side of it is reserved by the two spacers — so the array this hands over is a dozen rows whether
 * the project holds twelve files or ten thousand.
 */
function filesPanelValues(): FilesPanelValues {
  sweepRowElements();
  if (!projectState) {
    _fileRows = [];
    const values: FilesPanelValues = { ...emptyFilesPanelValues(), view: "none" };
    _lastValues = values;
    return values;
  }
  if (!projectState.isSiteProject && projectState.projectRoot === ".") {
    _fileRows = [];
    const values: FilesPanelValues = { ...emptyFilesPanelValues(), view: "welcome" };
    _lastValues = values;
    return values;
  }

  const state = requireProjectState();
  _fileRows = [];
  // Resolved once for the whole tree, not once per row: this runs on EVERY repaint of the
  // Navigator, and `resolveI18n` canonicalizes every declared tag through `Intl.Locale`.
  const { i18n } = resolveI18n(state.projectConfig ?? {});
  collectFileRows(".", 0, _fileRows, i18n);
  // Windowed against the element the document holds, which is the only one that exists while this
  // Is being built. There is none before the first mount, and `listWindow` then answers "all of
  // Them".
  const range = listWindow(_fileList, { count: _fileRows.length, rowHeight: fileRowHeight() });
  // The roving tab stop is decided from the MODEL — the first DRAWN row of a windowed tree is
  // Usually not the first row of the tree — and then clamped INTO the window, because a tab stop
  // That is not in the document is not a tab stop: a tree whose selected row has scrolled away
  // Would otherwise have no tabbable row at all, and Tab would skip the whole panel.
  const wanted = Math.max(0, fileIndexOfPath(state.selectedPath ?? undefined));
  const tabStop = Math.min(Math.max(wanted, range.start), Math.max(range.start, range.end - 1));
  const tabStopRow = _fileRows[tabStop];
  const showingIgnored = showIgnoredFiles();

  const values: FilesPanelValues = {
    dragPath: _dragPath,
    dropPath: _dropPath,
    headerState: state.isSiteProject ? "shown" : "hidden",
    ignoredIcon: showingIgnored ? "eye" : "eye-slash",
    ignoredLabel: showingIgnored ? "Hide ignored files" : "Show ignored files",
    ignoredSelected: showingIgnored,
    padBottom: `height:${range.padBottom}px`,
    padTop: `height:${range.padTop}px`,
    projectName: state.projectConfig?.name || state.name,
    query: state.searchQuery,
    rootDrop: _rootDrop,
    rows: _fileRows.slice(range.start, range.end).map((row) => fileRowView(row)),
    selectedPath: state.selectedPath ?? "",
    tabStopPath: tabStopRow && !tabStopRow.loading ? tabStopRow.path : "",
    view: "tree",
  };
  _lastValues = values;
  return values;
}

/**
 * Say only what a DRAG changed, without rebuilding the row model.
 *
 * `onDrag` fires per pointer move. Re-projecting from scratch would re-walk every listed directory,
 * re-resolve the locales and re-slice the window on each of them, so the three fields a drag
 * actually moves are written over the last projection instead — and because the document compares
 * each of them against `$map.item.path`, what reaches the DOM is one attribute per drawn row.
 */
function syncFilesDragState(): void {
  if (!_standingFiles || !_lastValues) {
    return;
  }
  _lastValues = {
    ..._lastValues,
    dragPath: _dragPath,
    dropPath: _dropPath,
    rootDrop: _rootDrop,
  };
  _standingFiles.handle.update(_lastValues);
}

/** Repaint the Navigator, which is what brings a new projection to the mounted document. */
function repaintFiles(): void {
  _filesRerender?.();
}

// ─── The panel's own verbs ───────────────────────────────────────────────────

/** Re-read every listed directory, and the `.gitignore` rules with them. */
async function refreshFileTree(): Promise<void> {
  const state = requireProjectState();
  state.dirs.clear();
  /* The rules go with the listings. Refresh is what an author reaches for after editing a
     `.gitignore` by hand, and a tree that came back still hiding by the old rules would read as
     the button not having worked. */
  resetIgnoreCache();
  await loadDirectory(".");
  for (const dir of state.expanded) {
    await loadDirectory(dir);
  }
  repaintFiles();
}

/**
 * What a click or Enter on a row MEANS.
 *
 * One verb for both kinds of row, decided here rather than in the document: a directory opens, a
 * file opens in a tab, and a row whose model has since gone does nothing at all.
 */
function activateFileRow(path: string): void {
  const row = fileRowAt(path);
  if (!row) {
    return;
  }
  if (row.type === "directory") {
    void toggleTreeDirectory(path).then(() => repaintFiles());
    return;
  }
  void openFileInTab(path);
}

/** Move the keyboard `step` rows through the MODEL from the row it is on. */
function moveFileFocus(path: string, step: number): void {
  focusFileRow(fileStep(fileIndexOfPath(path), step >= 0 ? 1 : -1));
}

/** → : open a COLLAPSED directory, and nothing else. */
function expandFileRow(path: string): void {
  const state = requireProjectState();
  if (fileRowAt(path)?.type !== "directory" || state.expanded.has(path)) {
    return;
  }
  // The expansion repaints THROUGH the panel. It used to synthesise a click on the focused row to
  // Get a repaint, which ran that row's own toggle a second time and only did the right thing
  // Because the handler's captured `isExpanded` was already stale.
  void toggleTreeDirectory(path).then(() => repaintFiles());
}

/** ← : close an EXPANDED directory, and nothing else. */
function collapseFileRow(path: string): void {
  const state = requireProjectState();
  if (fileRowAt(path)?.type !== "directory" || !state.expanded.has(path)) {
    return;
  }
  state.expanded.delete(path);
  // It used to leave the repaint to "the caller who sets up keyboard", and there was no such
  // Caller: ← changed the state and left the children on screen until something else happened to
  // Redraw the panel.
  repaintFiles();
}

/** Move the keyboard to the model row at `index`, bringing it into the window if it is outside. */
function focusFileRow(index: number): void {
  const row = _fileRows[index];
  if (!row) {
    return;
  }
  const el = fileRowElement(row.path);
  if (el) {
    el.focus();
    return;
  }
  if (revealListRow(_fileList, index, fileRowHeight())) {
    _pendingFocusPath = row.path;
    repaintFiles();
  }
}

/** Expand or collapse one directory, listing it the first time it is opened. */
async function toggleTreeDirectory(path: string): Promise<void> {
  const state = requireProjectState();
  if (state.expanded.has(path)) {
    state.expanded.delete(path);
    return;
  }
  state.expanded.add(path);
  if (!state.dirs.has(path)) {
    await loadDirectory(path);
  }
}

// ─── Drag and drop: the island the document draws a home for ─────────────────

/**
 * What is registered against each drawn row, so it can be released when the row leaves the window.
 *
 * Keyed by the ELEMENT rather than by the path: a windowed list re-uses nodes, and the question
 * this map answers is "has this node's registration already been taken back", which is about the
 * node.
 */
const _rowDnd = new Map<HTMLElement, () => void>();
/** What is registered against the tree itself: the project root's two drop targets, and the monitor. */
let _treeDnd: { element: HTMLElement; cleanup: () => void } | null = null;
/** The row being dragged, the row a drag is over, and whether the background is. */
let _dragPath = "";
let _dropPath = "";
let _rootDrop = "";

/** Whether a drag carries OS files (as opposed to a pragmatic in-app drag). */
export function isFileDrag(e: DragEvent): boolean {
  return [...(e.dataTransfer?.types ?? [])].includes("Files");
}

/**
 * Attach external-file drop handling to one element. Pragmatic-dnd only sees pragmatic sources, so
 * an OS file drag needs the native listeners; `dir` is where a drop lands (the row itself for a
 * directory, its parent for a file, `.` for the tree background).
 *
 * The affordance is reported rather than drawn: `setActive` writes the state the document renders
 * from, where this used to add and remove a class. That is the same correction the Library made — a
 * highlight a handler adds is a highlight another handler has to remember to take away, and a drag
 * that left the window never fired the handler that would have.
 */
function registerFileDropTarget(
  element: HTMLElement,
  dir: string,
  setActive: (active: boolean) => void,
): () => void {
  const onDragOver = (e: DragEvent) => {
    if (!isFileDrag(e)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setActive(true);
  };
  const onDragLeave = () => setActive(false);
  const onDrop = (e: DragEvent) => {
    setActive(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    void uploadFilesToDir(files, dir, repaintFiles);
  };
  element.addEventListener("dragover", onDragOver);
  element.addEventListener("dragleave", onDragLeave);
  element.addEventListener("drop", onDrop);
  return () => {
    element.removeEventListener("dragover", onDragOver);
    element.removeEventListener("dragleave", onDragLeave);
    element.removeEventListener("drop", onDrop);
  };
}

/** Say which row a drag is over — or that it is over none — and let the document redraw one row. */
function setDropPath(path: string): void {
  if (_dropPath === path) {
    return;
  }
  _dropPath = path;
  syncFilesDragState();
}

/** Say whether a drag is over the tree background, which is the project root. */
function setRootDrop(active: boolean): void {
  const next = active ? "true" : "";
  if (_rootDrop === next) {
    return;
  }
  _rootDrop = next;
  syncFilesDragState();
}

/**
 * Upload files into `dir` and reveal them: expand the target directory so the new entries are
 * visible. The listing refresh itself runs in the shared post-upload handler.
 */
export async function uploadFilesToDir(
  files: FileList | File[],
  dir: string,
  renderLeftPanel: () => void,
): Promise<void> {
  const uploaded = await uploadAssets([...files], { dir });
  if (uploaded.length === 0) {
    return;
  }
  if (dir !== ".") {
    requireProjectState().expanded.add(dir);
  }
  renderLeftPanel();
}

/**
 * Open the OS file picker and upload the choice into `dir` (the tree's "Upload Files…" item). The
 * input is created per invocation and discarded after — the tree is re-rendered often.
 */
export function pickAndUploadTo(dir: string, renderLeftPanel: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = uploadAccept();
  input.addEventListener("change", () => {
    if (input.files?.length) {
      void uploadFilesToDir(input.files, dir, renderLeftPanel);
    }
  });
  input.click();
}

/**
 * Adopt one row element the document has just created: remember it, make it a drag source, and give
 * it the two drop behaviours its KIND earns.
 *
 * Every row is a source and an external-file target; only a directory is an in-app target, because
 * a file has no inside to move something into. The registration happens as the node is created,
 * which is the one moment at which "this element is that path" is certainly true.
 */
function adoptFileRow(element: HTMLElement, path: string, type: string): void {
  releaseRowDnD(element);
  _fileRowEls.set(path, element);

  const cleanups = [
    draggable({
      element,
      getInitialData() {
        return { entryType: type, path, type: "file-tree" };
      },
      onDragStart() {
        _dragPath = path;
        syncFilesDragState();
      },
      onDrop() {
        _dragPath = "";
        setDropPath("");
        syncFilesDragState();
      },
    }),
    // Files dropped from the OS land in the row's own directory; a file row targets its parent so
    // Dropping next to a sibling puts the upload beside it.
    registerFileDropTarget(element, type === "directory" ? path : parentDir(path), (active) => {
      setDropPath(active ? path : "");
    }),
  ];

  if (type === "directory") {
    cleanups.push(
      dropTargetForElements({
        canDrop({ source }) {
          if (source.data.type !== "file-tree") {
            return false;
          }
          const srcPath = source.data.path as string;
          if (srcPath === path) {
            return false;
          }
          if (srcPath.startsWith(`${path}/`)) {
            return false;
          }
          const srcParent = parentDir(srcPath);
          if (srcParent === path) {
            return false;
          }
          return true;
        },
        element,
        getData() {
          return { targetDir: path, type: "file-tree-target" };
        },
        onDrag() {
          setDropPath(path);
        },
        onDragEnter() {
          setDropPath(path);
        },
        onDragLeave() {
          setDropPath("");
        },
        onDrop() {
          setDropPath("");
        },
      }),
    );
  }

  _rowDnd.set(element, combine(...cleanups));
  takePendingFocus();
}

/** Take back everything registered against one row element. */
function releaseRowDnD(element: HTMLElement): void {
  const cleanup = _rowDnd.get(element);
  if (cleanup) {
    cleanup();
    _rowDnd.delete(element);
  }
}

/**
 * Adopt the tree element: the window's scroller, the project root's drop target, and the monitor
 * that turns a completed drag into a move.
 *
 * Registered once, against the element the document created. The pass this replaced ran on every
 * repaint and re-registered every row from scratch, which is what made a drag mid-scroll drop its
 * own sources.
 */
function adoptFileTreeElement(element: HTMLElement): void {
  if (_treeDnd?.element === element) {
    return;
  }
  releaseFileTreeDnD();
  _fileList = element;

  const rootCleanup = dropTargetForElements({
    canDrop({ source }) {
      if (source.data.type !== "file-tree") {
        return false;
      }
      const srcPath = source.data.path as string;
      return parentDir(srcPath) !== ".";
    },
    element,
    getData() {
      return { targetDir: ".", type: "file-tree-target" };
    },
    onDragEnter() {
      setRootDrop(true);
    },
    onDragLeave() {
      setRootDrop(false);
    },
    onDrop() {
      setRootDrop(false);
    },
  });

  const monitorCleanup = monitorForElements({
    onDrop({ source, location }) {
      const [target] = location.current.dropTargets;
      if (!target) {
        return;
      }
      if (source.data.type !== "file-tree") {
        return;
      }
      if (target.data.type !== "file-tree-target") {
        return;
      }

      const srcPath = source.data.path as string;
      const targetDirPath = target.data.targetDir as string;
      const fileName = srcPath.split("/").pop();
      const newPath = targetDirPath === "." ? fileName : `${targetDirPath}/${fileName}`;

      if (newPath === srcPath) {
        return;
      }

      void moveFileEntry(srcPath, newPath!, repaintFiles);
    },
  });

  _treeDnd = {
    cleanup: combine(
      rootCleanup,
      monitorCleanup,
      // The tree background is the project root's drop target for OS files. Row handlers
      // StopPropagation, so a drop on a row never also fires here.
      registerFileDropTarget(element, ".", setRootDrop),
    ),
    element,
  };
  adoptFileTree();
}

/** Take back the tree's own registrations and its scroll watch. */
function releaseFileTreeDnD(): void {
  _treeDnd?.cleanup();
  _treeDnd = null;
  for (const cleanup of _rowDnd.values()) {
    cleanup();
  }
  _rowDnd.clear();
  _fileWatch?.window.destroy();
  _fileWatch = null;
  _fileList = null;
  _dragPath = "";
  _dropPath = "";
  _rootDrop = "";
}

/**
 * Move a file/directory and update all affected state.
 *
 * @param {string} oldPath
 * @param {string} newPath
 * @param {() => void} renderLeftPanel
 */
async function moveFileEntry(oldPath: string, newPath: string, renderLeftPanel: () => void) {
  const platform = getPlatform();
  markLocalMutation(oldPath, newPath);
  try {
    const report = await platform.renameFile(oldPath, newPath);
    // The refactor pass just rewrote references project-wide, and `markLocalMutation` suppresses
    // The watcher echo that would otherwise say so — hence the explicit drop, as in `renameFile`.
    // Without it a drag-move leaves every usage count in the session answering about the old path.
    invalidateUsages();

    // Update open tabs referencing the moved path
    for (const [id] of workspace.tabs.entries()) {
      if (id === oldPath) {
        renameTab(oldPath, newPath, newPath);
      } else if (id.startsWith(`${oldPath}/`)) {
        const newTabPath = newPath + id.slice(oldPath.length);
        renameTab(id, newTabPath, newTabPath);
      }
    }

    // Refresh affected directories
    const oldParent = parentDir(oldPath);
    const newParent = parentDir(newPath);
    await loadDirectory(oldParent);
    if (newParent !== oldParent) {
      await loadDirectory(newParent);
    }

    // Auto-expand target directory
    if (newParent !== ".") {
      requireProjectState().expanded.add(newParent);
    }

    reloadRewrittenTabs(report, newPath);
    renderLeftPanel();
    notifyMoveOutcome(`Moved to ${newPath}`, report, newPath);
  } catch (error) {
    notify.error(`Could not move ${oldPath}.`, {
      detail: errorMessage(error),
      path: oldPath,
      source: "Files",
    });
  }
}

/** @param {string} path @returns {string} */
function parentDir(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "." : normalized.slice(0, lastSlash);
}

// ─── Context menu ─────────────────────────────────────────────────────────────

let _fileMenu: MenuHandle | null = null;

function dismissFileContextMenu(): void {
  _fileMenu?.close();
  _fileMenu = null;
}

/**
 * A file row addresses ONE thing, and this is everything it can say about it — keyed by the
 * ARGUMENT NAME that asks for it.
 *
 * `menus: ["context/file"]` names a placement, and a placement nothing renders is the same defect
 * as a command nothing registers, one layer down: `content.openEntry` declared this menu and the
 * tree drew a hand-built list beside it, so the row simply never existed. Rendering the placement
 * is the fix, and it needs the one thing the element menu does not — an argument.
 * `content.openEntry` wants a `path`, `collection.editInGrid` wants a `name`, and only the row
 * knows either.
 *
 * A fact is stated ONLY when it is true of this row, and that is what decides whether a command
 * appears at all: `styles/main.css` is an entry of no collection, so it states no `path`, so "Open
 * Entry Form" is not offered on it. A command whose required arguments this row cannot answer is
 * skipped — never rendered into a refusal the author cannot act on.
 */
function fileRowFacts(entry: { path: string; type: string }): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  if (entry.type === "directory") {
    // The collection's own SOURCE ROOT, not any directory beneath it: "Edit Collection in Grid"
    // Opens the whole collection, so offering it on `content/posts/2026` would be a row whose label
    // Says one thing and whose action does another.
    const collection = collectionForDirectory(entry.path);
    if (collection?.isSourceRoot === true && !collection.fileBacked) {
      facts.name = collection.name;
    }
    return facts;
  }
  if (collectionOfPath(entry.path)) {
    facts.path = entry.path;
  }
  /*
   * `source`, and deliberately not `path`.
   *
   * The bag is keyed by ARGUMENT NAME, and `path` already means one specific thing here — "an entry
   * of a collection" — which is what keeps "Open Entry Form" off `styles/main.css`. A convert
   * command reusing that key would state it for every convertible file and put the entry form on
   * all of them. A different question gets a different name.
   */
  if (convertTargets(entry.path).length > 0) {
    facts.source = entry.path;
  }
  return facts;
}

/** One of the tree's OWN verbs, as the kit menu reads a row. */
function treeMenuRow(
  id: string,
  title: string,
  run: () => void,
  extra: Partial<MenuRowProjection> = {},
): MenuRowProjection {
  return { destructive: false, disabled: false, dividerAbove: false, id, run, title, ...extra };
}

/**
 * The declared `context/file` commands this row can offer.
 *
 * Everything a row prints comes off the record — its title, its position (`forPlacement` sorts by
 * `group`), whether it is enabled and the sentence saying why not. Nothing here names a command, so
 * a new `context/file` record appears in the tree with no edit to this file.
 */
function placedFileRows(entry: { path: string; type: string }): MenuRowProjection[] {
  const registry = activeRegistry();
  if (!registry) {
    return [];
  }
  const facts = fileRowFacts(entry);
  const rows: MenuRowProjection[] = [];
  for (const command of registry.forPlacement("context/file")) {
    const schema = command.args as
      | { properties?: Record<string, unknown>; required?: readonly string[] }
      | undefined;
    if (!(schema?.required ?? []).every((key) => key in facts)) {
      continue;
    }
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(schema?.properties ?? {})) {
      if (key in facts) {
        args[key] = facts[key];
      }
    }
    const reason = registry.disabledReason(command.id);
    rows.push(
      reason === undefined
        ? treeMenuRow(command.id, command.title, () => {
            void registry.run(command.id, args);
          })
        : {
            destructive: false,
            disabled: true,
            dividerAbove: false,
            id: command.id,
            // A disabled row says what it needs, the same sentence the palette and the agent
            // Print — `requires`, off the record, never re-worded here.
            requires: reason,
            title: command.title,
          },
    );
  }
  return rows;
}

/**
 * Everything one row can be asked to do, in the order it is offered.
 *
 * The declared rows sit between what the TREE does to a file (open it, create in it, upload to it)
 * and what it does to the file's existence (rename, delete) — and the boundary between the last two
 * groups is the `dividerAbove` on Rename, which is what the `"—"` sentinel row used to stand for.
 */
function fileMenuRows(entry: { name: string; path: string; type: string }): MenuRowProjection[] {
  const isDir = entry.type === "directory";
  const rows: MenuRowProjection[] = [];
  if (isDir) {
    rows.push(
      treeMenuRow("files.newFile", "New File\u2026", () => {
        void createNewFile(entry.path, repaintFiles);
      }),
      treeMenuRow("files.upload", "Upload Files\u2026", () => {
        pickAndUploadTo(entry.path, repaintFiles);
      }),
    );
    if (entry.path === "pages" || entry.path.endsWith("/pages")) {
      // The one hand-built row left: no command declares "open the pages grid". `grid-open.ts`'s
      // `collection.editInGrid` has no pages sibling, so there is nothing here to render yet.
      rows.push(
        treeMenuRow("files.pagesGrid", "Edit Pages in Grid", () => {
          openPagesGrid();
        }),
      );
    }
  } else {
    rows.push(
      treeMenuRow("files.open", "Open", () => {
        void openFileInTab(entry.path);
      }),
    );
  }
  rows.push(
    ...placedFileRows(entry),
    treeMenuRow(
      "files.rename",
      "Rename\u2026",
      () => {
        void renameFile(entry, repaintFiles);
      },
      { dividerAbove: true },
    ),
    treeMenuRow(
      "files.delete",
      "Delete",
      () => {
        void deleteFile(entry, repaintFiles);
      },
      { destructive: true },
    ),
  );
  return rows;
}

/**
 * Open the file menu at the pointer.
 *
 * The KIT menu, not a popover of this module's own: `openMenu()` owns the panel, the roving focus,
 * the typeahead, the light dismissal and Escape, and it is the answer this shell already settled on
 * (§8.4). What went with the `sp-popover` it replaces is the hand-written clamp — a `ref` that
 * measured the panel a frame after it opened and moved it back inside the viewport — because the
 * kit does that for every menu instead of this one doing it for itself.
 */
function showFileContextMenu(path: string, x: number, y: number): void {
  const row = fileRowAt(path);
  if (!row) {
    return;
  }
  dismissFileContextMenu();
  const opener = fileRowElement(path);
  _fileMenu = openMenu({
    label: "File actions",
    onClosed: (handle) => {
      if (_fileMenu === handle) {
        _fileMenu = null;
      }
    },
    opener,
    origin: { x, y },
    region: "files",
    rows: fileMenuRows({ name: row.name, path: row.path, type: row.type }),
  });
}

// ─── File CRUD ────────────────────────────────────────────────────────────────

/** The default body for a path no format claims — a document, since that is what Jx authors. */
const BLANK_DOCUMENT = JSON.stringify(
  { children: [{ children: [], tagName: "p" }], tagName: "div" },
  null,
  2,
);

/**
 * The picker row meaning "I will type the whole name myself".
 *
 * It is what keeps the format picker from being a cage. `New File…` is the only generic
 * file-creation affordance in Studio and both backends create intermediate directories on write, so
 * without this row `styles/main.css`, `public/robots.txt`, `.gitignore` and a `credits.txt` beside
 * a collection's images all become uncreatable — and the picker would have taken away more than it
 * gave. The picker stays the authority on the extension; this is one of its answers.
 */
export const OTHER_FORMAT = "__other__";

/** How the extension of a new file is settled. */
export type FormatChoice =
  /** Picker over every creatable format, plus Other…. The field is a NAME, taken verbatim. */
  | { kind: "choose"; defaultExt?: string; docKind?: "page" | "component" | "content" }
  /**
   * Picker holding ONE format, plus Other… — the collection's own extension. The field is a NAME.
   * `because` is the sentence a refusal quotes when Other… would smuggle a foreign document in.
   */
  | { kind: "locked"; ext: string; because: string }
  /** No picker. The field is a DISPLAY NAME, slugified, and `ext` is appended. */
  | { kind: "fixed"; ext: string };

/**
 * One creation, named.
 *
 * `dir` is required and has no default. That is the whole point of the type: the Library used to
 * derive its destination from whichever CATEGORY filter happened to be active — and "All" derived
 * nothing, so a new page landed wherever the writer's fallback pointed. A creation flow that cannot
 * say where the file is going has no business asking for its name.
 */
export interface NewFileRequest {
  /** Destination directory, project-relative. `"."` is the project root. */
  dir: string;
  /** Dialog title — "New File", "New Page", "New Post". Defaults to "New File". */
  title?: string;
  /** Pre-filled value. In picker modes it is a STEM; the picker supplies the extension. */
  suggestedName?: string;
  /**
   * How the extension is settled. Absent means the field asks for a whole file name and takes it
   * verbatim with no picker at all — which is what a caller that already knows the name wants
   * (`i18n.createTranslation` composes `about.json` from the file it is translating).
   */
  format?: FormatChoice;
  /**
   * Body to write. A function is called with the extension the reader settled on and the composed
   * file name, which is the only way a caller can seed a body whose FORMAT — or whose own tag name
   * — it does not know until the dialog resolves. Defaults to the resolved format's
   * `newFileTemplate`.
   */
  content?:
    | string
    | ((ext: string, fileName: string) => string | undefined | Promise<string | undefined>);
  /** Who is creating, for the Problem's `source` line. Defaults to "Files". */
  source?: string;
}

/** A display name, reduced to a file stem. Lowercase by design: this is a slug. */
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^a-z\d-]/g, "");
}

/** The extension of a file name, including the dot, or `""`. */
function extensionOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** The two picker modes — the ones where the field asks for a NAME and the picker owns the suffix. */
type PickerChoice = Extract<FormatChoice, { kind: "choose" } | { kind: "locked" }>;

/** The picker's rows for a request, with the Other… sentinel set apart by a divider. */
function formatRowsFor(choice: PickerChoice): ChoiceOption[] {
  const rows =
    choice.kind === "locked"
      ? [
          {
            ext: choice.ext,
            label: `${formatByExtension(choice.ext)?.name ?? choice.ext} (${choice.ext})`,
          },
        ]
      : creationFormats(choice.docKind);
  return [
    ...rows.map((row) => ({ label: row.label, value: row.ext })),
    { dividerBefore: true, label: "Other…", value: OTHER_FORMAT },
  ];
}

/**
 * Which row starts selected: the caller's stated default, else the extension its prefill already
 * carries when that is a row, else the first row. A `locked` choice has one format row, so it
 * always lands there.
 */
function initialPickFor(choice: PickerChoice, rows: ChoiceOption[], suggested: string): string {
  const stated = choice.kind === "choose" ? choice.defaultExt : choice.ext;
  if (stated !== undefined && rows.some((row) => row.value === stated)) {
    return stated;
  }
  const fromPrefill = extensionOfName(suggested);
  if (fromPrefill !== "" && rows.some((row) => row.value === fromPrefill)) {
    return fromPrefill;
  }
  return rows[0]?.value ?? OTHER_FORMAT;
}

/**
 * Create one file, from the one flow the Files tree, the Library and the content collections use.
 *
 * Three behaviours the callers used to disagree about, settled here:
 *
 * - **The extension is CHOSEN, not typed.** The project's format registry is what the picker is built
 *   from, so a project that installs a markdown extension offers markdown here with no edit to this
 *   file — and one that installs nothing offers `JSON` and `Other…`, which is the truth. `Other…`
 *   restores the verbatim field for everything that is not a Jx document.
 * - **A name that is already taken is refused in the FIELD**, not discovered afterwards. Both
 *   predecessors called `writeFile` straight onto the composed path, so creating `about.md` in a
 *   directory that had one silently replaced it — with no undo, because the file was never open.
 *   The destination is listed once before the prompt so `validate` can say so while it can still be
 *   fixed. The comparison is case-INSENSITIVE, because APFS and NTFS are and the write clobbers.
 * - **A failure is a Problem carrying the path**, not a toast that scrolls away, since the thing the
 *   author must do next is about that path.
 *
 * @returns The created path, or `null` when the author cancelled or the write failed.
 */
export async function createFileIn(request: NewFileRequest): Promise<string | null> {
  const { dir, format: choice, source = "Files" } = request;
  await loadFormats();

  // One listing, before the field opens: the names it must refuse are known while typing.
  let taken = new Set<string>();
  try {
    const listing = await getPlatform().listDirectory(dir);
    taken = new Set(listing.map((entry) => entry.name.toLowerCase()));
  } catch {
    // A directory that cannot be listed is usually one that does not exist yet — the write below
    // Is the authority on whether that is a problem, and it reports with the real reason.
  }

  const picker = choice !== undefined && choice.kind !== "fixed" ? choice : null;
  const rows = picker === null ? null : formatRowsFor(picker);
  const initialPick =
    picker === null || rows === null
      ? ""
      : initialPickFor(picker, rows, request.suggestedName ?? "");

  /**
   * The file name a field value and a pick compose to — three modes, not two.
   *
   * The verbatim STEM mode is not a convenience. The slugifier lowercases and strips everything
   * outside `[a-z0-9-]`, which turns `[slug]` into `slug` — and eight shipped starters carry
   * `pages/[slug].json`, `[sku].json`, `[...slug].json`. A picker that slugified would make a
   * dynamic route uncreatable and would say nothing about it.
   */
  const fileNameFor = (input: string, picked: string) => {
    const trimmed = input.trim();
    if (choice === undefined || picked === OTHER_FORMAT) {
      return trimmed;
    }
    if (choice.kind === "fixed") {
      const slug = slugify(trimmed);
      return slug === "" ? "" : `${slug}${choice.ext}`;
    }
    return trimmed.toLowerCase().endsWith(picked.toLowerCase()) ? trimmed : `${trimmed}${picked}`;
  };

  const known = knownDocumentExtensions();

  const validate = (value: string, picked: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return choice?.kind === "fixed" ? "Enter a name." : "Enter a file name.";
    }
    if (choice?.kind === "fixed" && slugify(trimmed) === "") {
      return "Enter at least one letter or number.";
    }
    const normalized = trimmed.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.endsWith("/")) {
      return "Enter a name, not a path that starts or ends with a slash.";
    }
    if (normalized.split("/").includes("..")) {
      return "A name cannot step outside the destination folder.";
    }
    // A slash is the tree's ONLY way to make a directory — both backends create them on write — so
    // It is allowed exactly where the field is a whole file name, and refused where it is a name.
    if (normalized.includes("/") && choice !== undefined && picked !== OTHER_FORMAT) {
      return `Pick Other… to create a file in a subfolder of ${dir === "." ? "the project root" : dir}.`;
    }
    /* A name whose extension MATCHES the pick is fine and is composed once, never doubled;
       refusing every trailing extension would reject this dialog's own `untitled.json` default.
       A name ending in an extension no format claims is a stem that happens to have a dot. */
    const typedExt = extensionOfName(normalized);
    if (
      picked !== "" &&
      picked !== OTHER_FORMAT &&
      typedExt !== "" &&
      typedExt.toLowerCase() !== picked.toLowerCase() &&
      known.has(typedExt.toLowerCase())
    ) {
      const label = rows?.find((row) => row.value === picked)?.label ?? picked;
      return `You picked ${label}; this name ends in ${typedExt}.`;
    }
    if (choice?.kind === "locked" && picked === OTHER_FORMAT) {
      const foreign = typedExt !== "" && typedExt.toLowerCase() !== choice.ext.toLowerCase();
      if (foreign && known.has(typedExt.toLowerCase())) {
        return choice.because;
      }
    }
    /* No emptiness check here: every way `fileNameFor` can answer "" is already refused above — a
       blank field by the first rule, a display name that slugifies to nothing by the second. */
    const candidate = fileNameFor(value, picked);
    return taken.has(candidate.toLowerCase()) ? `${candidate} already exists in ${dir}/.` : "";
  };

  let picked = initialPick;
  const entered = await showPromptDialog(request.title ?? "New File", {
    ...(rows === null
      ? {}
      : {
          choice: {
            initial: initialPick,
            label: "Format",
            onChange: (next: string) => {
              picked = next;
            },
            options: () => rows,
          },
        }),
    confirmLabel: "Create",
    message: dir === "." ? "Creating in the project root." : `Creating in ${dir}/`,
    ...(request.suggestedName === undefined ? {} : { placeholder: request.suggestedName }),
    // With a picker there is no extension in the field to preserve, so the whole name is the stem.
    select: rows === null ? "stem" : "all",
    validate,
    value: request.suggestedName ?? "untitled.json",
  });
  if (!entered) {
    return null;
  }

  const fileName = fileNameFor(entered, picked);
  const path = dir === "." ? fileName : `${dir}/${fileName}`;
  markLocalMutation(path);
  const format = formatForPath(fileName);
  const suppliedBody =
    typeof request.content === "function"
      ? await request.content(extensionOfName(fileName), fileName)
      : request.content;
  /*
   * What a new file starts as, in precedence order.
   *
   * The `.json` split is the one thing the picker changed. A `.json` the reader CHOSE from the
   * format picker is a Jx document and gets one; a `data.json` typed through Other… is not, and
   * gets `{}` — which is at least openable, where the `""` a non-document extension gets would be a
   * file that reports "no format" the moment it is clicked.
   */
  const chosenAsDocument = choice !== undefined && picked !== OTHER_FORMAT;
  const content =
    suppliedBody ??
    format?.studio?.newFileTemplate ??
    (format
      ? ""
      : fileName.toLowerCase().endsWith(".json")
        ? chosenAsDocument
          ? BLANK_DOCUMENT
          : "{}\n"
        : "");
  try {
    await getPlatform().writeFile(path, content);
    await loadDirectory(dir);
    notify.success(`Created ${path}`);
    return path;
  } catch (error) {
    notify.error(`Could not create ${path}.`, {
      detail: errorMessage(error),
      path,
      source,
    });
    return null;
  }
}

/**
 * The tree's New File, which asks the destination what it is before it asks the reader for a name.
 *
 * Four answers, and the difference between them is what feature 3 is:
 *
 * - A **content collection's own source root** routes to `content/entry-commands.ts`'s `createEntry`,
 *   which supplies the collection's extension AND a body seeded from its schema, then opens the
 *   entry form. Reimplementing any of that here would be a second seeder drifting from the one the
 *   Library and the palette already use;
 * - A **subdirectory** of a collection, or a collection with no `schema`, is CONSTRAINED but not
 *   rerouted. Discovery is recursive so a document there really is an entry, but co-located media
 *   lives there too (`site-architecture.md` §6.5) and `createEntry` writes to ONE directory — so
 *   rerouting would silently relocate the file, and seeding a schema-less collection would seed
 *   nothing anyway;
 * - A collection whose declared `format` names a class the project has not registered gets the FULL
 *   picker and a Problem naming that class. Locking to a guessed extension would be a stated lie
 *   plus an enforced refusal, which is worse than not constraining at all;
 * - Anywhere else opens the full picker.
 *
 * The context-menu label does NOT change for a collection folder. The tree's own verbs are what the
 * TREE does, and the dialog itself names the destination.
 */
async function createNewFile(dirPath: string, renderLeftPanel: () => void) {
  await loadFormats();
  const collection = collectionForDirectory(dirPath);

  if (collection?.unresolvedFormat != null) {
    notify.error(`New files in ${dirPath}/ cannot be constrained to the collection's format.`, {
      detail:
        `The "${collection.name}" content type declares format "${collection.unresolvedFormat}", ` +
        "which no installed extension provides. Install the extension that supplies it, or correct " +
        "the name in Project Settings › Content Types.",
      path: dirPath,
      source: "Files",
    });
  }

  const constrained = collection?.ext != null && collection.unresolvedFormat === null;
  const seedable = constrained && collection.isSourceRoot && collection.def.schema !== undefined;

  let created: string | null;
  if (seedable) {
    const { createEntry } = await import("../content/entry-commands");
    created = await createEntry(collection.name, { dir: dirPath });
  } else {
    created = await createFileIn({
      dir: dirPath,
      format:
        constrained && collection.ext !== null
          ? {
              because:
                `${collection.name} entries are ${collection.ext} files, so a document of another ` +
                "format here would not be one.",
              ext: collection.ext,
              kind: "locked",
            }
          : { defaultExt: ".json", kind: "choose" },
      suggestedName: "untitled",
    });
  }
  if (created !== null) {
    renderLeftPanel();
  }
}

/**
 * The rename dialog, carrying what moves with the file.
 *
 * `renamePromptMessage` is awaited before the field opens, so the count is on screen when the name
 * is typed rather than after it is confirmed — the refactor pass is about to rewrite every one of
 * those references, and silently doing that much work was the previous behaviour.
 *
 * @param {string} currentName @param {string} path @returns {Promise<string | null>}
 */
async function showRenameFileDialog(currentName: string, path: string): Promise<string | null> {
  const message = await renamePromptMessage(path);
  return showPromptDialog("Rename", {
    confirmLabel: "Rename",
    ...(message === undefined ? {} : { message }),
    select: "stem",
    validate: (v) => (v.trim() ? "" : "Enter a file name."),
    value: currentName,
  });
}

/** Build the status-bar message for a rename, summarising any reference/tag rewrites. */
function renameStatus(newName: string, report: RenameResult): string {
  const refs = report.references;
  const tagNote = report.tag ? `; tag → <${report.tag.to}> (${report.tag.refsUpdated})` : "";
  if (refs && refs.refsUpdated > 0) {
    return `Renamed to ${newName}; updated ${refs.refsUpdated} reference(s) in ${refs.filesChanged} file(s)${tagNote}`;
  }
  if (tagNote) {
    return `Renamed to ${newName}${tagNote}`;
  }
  return `Renamed to ${newName}`;
}

/**
 * Report a move whose refactor pass could not finish, instead of reporting a plain success.
 *
 * The dialog above a rename states, in a modal the user has to accept, that N references "will be
 * updated automatically. Nothing else changes." The engine keeps that promise for every document it
 * can write, and it can write more than it round-trips: a `.csv` collection has a parser and
 * deliberately no serializer, but declares the narrower `rewrite` capability, so a reference in one
 * is repaired cell by cell. What is left over is a document that fails to parse, and a tag rename
 * inside a format with no serializer. In those `applyRename` names the file rather than dropping
 * it, and this is the half that makes the naming reach a person. Silence here is what turns a
 * stated promise into a false one.
 *
 * A drag-move makes no promise at all — it has no dialog — which is exactly why it needs this more,
 * not less. A format CONVERSION makes the strongest promise of the three, and shares this for that
 * reason: it is a rename whose dialog also states what the file is becoming.
 *
 * @param {string} headline — what happened, as the success case would have put it.
 * @param {RenameResult} report
 * @param {string} path — the moved file, so Problems can click through.
 */
export function notifyMoveOutcome(headline: string, report: RenameResult, path: string): void {
  const stuck = report.errors ?? [];
  if (stuck.length === 0) {
    notify.success(headline);
    return;
  }
  const files = stuck.length === 1 ? "1 file" : `${stuck.length} files`;
  notify.warn(`${headline} — references in ${files} could not be updated`, {
    detail: stuck.map((e) => `${e.path}: ${e.error}`).join("\n"),
    path,
    source: "Files",
  });
}

/** Reload any open tabs whose references the refactor rewrote (so the editor shows new paths). */
function reloadRewrittenTabs(report: RenameResult, skipPath: string): void {
  for (const f of report.references?.files ?? []) {
    if (f.path !== skipPath && workspace.tabs.has(f.path)) {
      void reloadFileInTab(f.path);
    }
  }
}

/** The directory holding a path, project-relative. `"."` for a file at the project root. */
export function parentDirOf(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : ".";
}

/**
 * Everything the app has to catch up on once a file has MOVED — shared by the rename and by the
 * format conversion, which is a rename with the bytes rewritten on the way.
 *
 * It is one function because the two must not drift: the refactor pass has just rewritten
 * references project-wide, `markLocalMutation` has suppressed the watcher echo that would otherwise
 * say so, and every consequence of that has to be replayed by hand. A converter that forgot
 * `invalidateUsages` would leave the next delete dialog quoting a count from before the move.
 *
 * The tab is NOT reopened here. A rename keeps its document and only re-keys the tab; a conversion
 * has to rebuild it, because the format changed. That difference belongs to the callers.
 *
 * @param from - The path before the move.
 * @param to - The path after it.
 * @param report - What the backend's refactor pass rewrote.
 */
export async function settleRename(from: string, to: string, report: RenameResult): Promise<void> {
  invalidateUsages();
  const fromDir = parentDirOf(from);
  const toDir = parentDirOf(to);
  await loadDirectory(fromDir);
  if (toDir !== fromDir) {
    await loadDirectory(toDir);
  }
  if (requireProjectState().selectedPath === from) {
    requireProjectState().selectedPath = to;
  }
  reloadRewrittenTabs(report, to);
}

async function renameFile(
  entry: { name: string; path: string; type: string },
  renderLeftPanel: () => void,
) {
  const newName = await showRenameFileDialog(entry.name, entry.path);
  if (!newName || newName === entry.name) {
    return;
  }
  const parentDirPath = parentDirOf(entry.path);
  const newPath = parentDirPath === "." ? newName : `${parentDirPath}/${newName}`;
  markLocalMutation(entry.path, newPath);
  try {
    const platform = getPlatform();
    const report = await platform.renameFile(entry.path, newPath);
    if (workspace.tabs.has(entry.path)) {
      renameTab(entry.path, newPath, newPath);
    }
    await settleRename(entry.path, newPath, report);
    renderLeftPanel();
    notifyMoveOutcome(renameStatus(newName, report), report, newPath);
  } catch (error) {
    notify.error(`Could not rename ${entry.name}.`, {
      detail: errorMessage(error),
      path: entry.path,
      source: "Files",
    });
  }
}

async function deleteFile(
  entry: { name: string; path: string; type: string },
  renderLeftPanel: () => void,
) {
  const confirmed = await confirmFileDelete(entry);
  if (!confirmed) {
    return;
  }
  try {
    const platform = getPlatform();
    markLocalMutation(entry.path);
    await platform.deleteFile(entry.path);
    invalidateUsages();
    const delPath = entry.path.replaceAll("\\", "/");
    const parentDirPath = delPath.includes("/") ? delPath.slice(0, delPath.lastIndexOf("/")) : ".";
    await loadDirectory(parentDirPath);
    if (requireProjectState().selectedPath === entry.path) {
      requireProjectState().selectedPath = null;
    }
    renderLeftPanel();
    notify.success(`Deleted ${entry.name}`);
  } catch (error) {
    notify.error(`Could not delete ${entry.name}.`, {
      detail: errorMessage(error),
      path: entry.path,
      source: "Files",
    });
  }
}

/**
 * What an open can say beyond the path. Every field defaults to today's answer.
 *
 * Deliberately one inline-typed `opts` object rather than a `paneId` parameter:
 * `scripts/check-pane-singletons.ts` rule 4 charges any function whose parameters NAME a pane for
 * reading the focus, one hop in — and {@link openFileInTab} legitimately falls back to the focused
 * pane when nobody names one. {@link openFileInPane} is the named sibling for readers who want the
 * pane in the signature; it is pane-scoped and reads no focus of its own.
 */
export interface OpenFileOpts {
  /** Which pane. Defaults to the focused one. */
  paneId?: string;
  /** Open as a disposable preview tab (§4.3) — browsing rather than committing. */
  preview?: boolean;
  /** False leaves the keyboard where it is. Defaults to true. */
  focus?: boolean;
}

/**
 * Bring an ALREADY-OPEN tab to where the caller asked for it.
 *
 * Three cases, and the third is the one a following pane depends on:
 *
 * | the tab is…                                      | behaviour                                      |
 * | ------------------------------------------------ | ---------------------------------------------- |
 * | in the requested pane (or no pane was requested) | activate it there, honouring `focus`           |
 * | elsewhere, and **not** its pane's active tab     | move it — one tab is one document in one strip |
 * | elsewhere, and **is** its pane's active tab      | **nothing.** You are already looking at it     |
 *
 * The third exists because moving it would oscillate: a derivation that re-resolves to the document
 * the author is editing would yank it out of their pane and into the assistant one, and the follow
 * would then re-resolve against whatever landed in its place.
 */
function revealOpenTab(tabId: string, opts: OpenFileOpts): void {
  const wanted = opts.paneId;
  const holder = paneOfTab(tabId);
  if (wanted !== undefined && holder && holder.id !== wanted) {
    if (holder.activeTabId === tabId) {
      return;
    }
    moveTabToPane(tabId, wanted);
  }
  activateTab(tabId, { focus: opts.focus !== false });
}

/**
 * Open a file from the tree into a tab. Activates the existing tab if it is already open.
 *
 * @param {string} path
 * @param {OpenFileOpts} [opts]
 */
export async function openFileInTab(path: string, opts: OpenFileOpts = {}) {
  const follows = opts.focus !== false;
  for (const [id, tab] of workspace.tabs.entries()) {
    if (tab.documentPath === path) {
      revealOpenTab(id, opts);
      // The tree's cursor answers "where is the author", so a side-open that deliberately left the
      // Keyboard behind must not move it.
      if (follows) {
        requireProjectState().selectedPath = path;
      }
      return;
    }
  }

  /*
   * Media opens in the viewer, and the branch has to be HERE.
   *
   * Everything below reads the file as text: a PNG went through `platform.readFile`, matched no
   * format class and no `.json`, and threw — so clicking an image in the tree produced "No format
   * class imported for … — add one to project.json imports", which is not advice about a PNG. The
   * Library's tiles and the file context menu's Open route through this same function, so they were
   * all the same dead end, and `workspace/session.ts` restores tabs by calling it again — which is
   * why a branch anywhere else would send a restored media tab straight back down the error path.
   */
  if (isViewableMedia(path)) {
    openMediaTab(path);
    if (follows) {
      requireProjectState().selectedPath = path;
    }
    trackRecentFile({
      name: path.split("/").pop() || path,
      path,
      root: requireProjectState().projectRoot,
    });
    return;
  }

  // CSV files open in the grid editor (source mode remains as the raw-text alternate).
  if (path.toLowerCase().endsWith(".csv")) {
    try {
      await openCsvGridTab(path);
      requireProjectState().selectedPath = path;
      trackRecentFile({
        name: path.split("/").pop() || path,
        path,
        root: requireProjectState().projectRoot,
      });
    } catch (error) {
      notify.error(`Could not open ${path}.`, {
        detail: errorMessage(error),
        path,
        source: "Open File",
      });
    }
    return;
  }

  const platform = getPlatform();
  try {
    const content = await platform.readFile(path);
    if (!content) {
      /*
       * An empty file still has to answer for itself.
       *
       * Returning silently was defensible while every file the tree could create was a seeded
       * document. The format picker's "Other…" row makes an empty `main.css` or `.gitignore` an
       * ordinary thing to create, and clicking one and having NOTHING happen — no tab, no error, no
       * toast — reads as a broken tree rather than as a file Studio has no editor for. An empty
       * file the studio CAN open (a `.json`, or one a format claims) is still nothing to report.
       */
      await loadFormats();
      if (!formatForPath(path) && !path.toLowerCase().endsWith(".json")) {
        throw noFormatError(path);
      }
      return;
    }

    await loadFormats();
    let document: Record<string, unknown>;
    let frontmatter: Record<string, unknown> | undefined;
    const format = formatForPath(path);
    if (format) {
      const result = await parseSourceForPath(path, content);
      ({ document } = result);
      ({ frontmatter } = result);
    } else if (path.endsWith(".json")) {
      document = JSON.parse(content) as Record<string, unknown>;
    } else {
      throw noFormatError(path);
    }

    const id = path;
    openTab({
      id,
      documentPath: path,
      document,
      ...(frontmatter != null && { frontmatter }),
      sourceFormat: format?.name ?? null,
      ...(opts.paneId !== undefined && { paneId: opts.paneId }),
      ...(opts.preview === true && { preview: true }),
      ...(opts.focus === false && { focus: false }),
    });
    if (follows) {
      requireProjectState().selectedPath = path;
    }
    trackRecentFile({
      name: path.split("/").pop() || path,
      path,
      root: requireProjectState().projectRoot,
    });
  } catch (error) {
    notify.error(`Could not open ${path}.`, {
      detail: errorMessage(error),
      path,
      source: "Open File",
    });
  }
}

/**
 * Open a file into a NAMED pane, browsing rather than committing, leaving the keyboard behind.
 *
 * The same body as {@link openFileInTab} with the three options a side-open always wants, given a
 * signature that says which pane in the first parameter. It is what "open it beside this" means
 * everywhere it is asked for — drilling into a component, following a layout, `pane.compareWith`.
 *
 * @param {string} paneId
 * @param {string} path
 */
export async function openFileInPane(paneId: string, path: string): Promise<void> {
  await openFileInTab(path, { focus: false, paneId, preview: true });
}

/**
 * Reload an already-open tab from disk without changing the active tab. Used to refresh after AI
 * assistant writes to a file.
 *
 * @param {string} path
 */
/** Reload an open tab from disk when an external change arrives — but only if it is not dirty. */
export function reloadCleanTab(path: string): void {
  // Co-edited docs never reload from disk: the shared Y.Doc is ahead of the provider's write-back
  // (Which is what produced this event), and genuine external changes arrive as a collab reset.
  if (isCollabPath(path)) {
    return;
  }
  for (const [, tab] of workspace.tabs.entries()) {
    if (tab.documentPath === path && !tab.doc.dirty) {
      void reloadFileInTab(path);
      return;
    }
  }
}

export async function reloadFileInTab(path: string) {
  for (const [, tab] of workspace.tabs.entries()) {
    if (tab.documentPath === path) {
      const platform = getPlatform();
      try {
        const content = await platform.readFile(path);
        if (!content) {
          return;
        }
        await loadFormats();
        if (formatForPath(path)) {
          const { document, frontmatter } = await parseSourceForPath(path, content);
          tab.doc.document = document;
          tab.doc.content.frontmatter = frontmatter;
        } else if (path.endsWith(".json")) {
          tab.doc.document = JSON.parse(content) as JxMutableNode;
        }
        tab.doc.dirty = false;
      } catch (error) {
        // A file that changed on disk and cannot be re-read leaves the open tab showing the OLD
        // Document with no indication that it is stale — the most expensive silence in this file.
        notify.error(`Could not reload ${path} after it changed on disk.`, {
          detail: errorMessage(error),
          key: `reload:${path}`,
          path,
          source: "Files",
        });
      }
      return;
    }
  }
}

/**
 * Contribute the Files panel.
 *
 * `level: "project"` because it WRITES project files — create, rename, delete, move. It reads the
 * focused document only to highlight a row, and principle 3 files a surface by what it writes.
 */
export function registerFilesPanel(): void {
  registerPanel({
    id: "files",
    title: "Files",
    level: "project",
    dock: "navigator",
    icon: "folder",
    // The body is a document, so lit draws nothing and the mount happens against the painted DOM.
    // `afterRender` runs on every repaint; {@link mountFilesPanel} is idempotent.
    render: () => nothing,
    afterRender: (ctx, host) => {
      mountFilesPanel(host, ctx.rerender);
    },
  });
}

// ─── The mount ───────────────────────────────────────────────────────────────

/** Everything a control on the surface can ask for, defined once. */
const FILE_ACTIONS: FilesPanelActions = {
  activate: activateFileRow,
  collapseRow: collapseFileRow,
  contextMenu: showFileContextMenu,
  expandRow: expandFileRow,
  moveFocus: moveFileFocus,
  newFile: () => {
    void createNewFile(".", repaintFiles);
  },
  openProject: () => {
    /* The DECLARED command, run through the registry — never a second opener of this surface's own
       (§12.5). It is the one the ⌘O chord, the palette and the status bar's PROJECT field already
       run, and it is the only one that knows about the picker modal and the "new window" target. */
    void activeRegistry()?.run("project.open");
  },
  refresh: () => {
    void refreshFileTree();
  },
  rowHost: adoptFileRow,
  search: (value) => {
    requireProjectState().searchQuery = value;
    repaintFiles();
  },
  toggleIgnored: () => {
    /* A repaint and nothing else: the ignored entries were never dropped from `projectState.dirs`,
       only from the rows built out of it. */
    setShowIgnoredFiles(!showIgnoredFiles());
    repaintFiles();
  },
  treeHost: adoptFileTreeElement,
};

/** The mounted document, and the node it was mounted into. */
let _standingFiles: { handle: FilesPanelSurfaceHandle; host: HTMLElement } | null = null;
/** The last projection, so a drag can move three fields without rebuilding the row model. */
let _lastValues: FilesPanelValues | null = null;

/**
 * Draw the panel — mounting the document the first time, and re-projecting into it every time
 * after.
 *
 * The document goes into `.panel-content`, not into the `.panel-body` this is handed, for the
 * reason `panels/git-panel.ts` states: only one of them is the node lit renders this panel's body
 * into, and appending to the other would leave the panel drawn under whatever the Navigator paints
 * next.
 *
 * The repaint stays the NAVIGATOR'S. Source Control owns an `effect()` because its inputs are the
 * reactive `shell.git` record; the tree's inputs are a `Map` of directory listings, a `Set` of
 * expanded paths and a roaming setting, none of which is reactive — so `ctx.rerender` is what this
 * surface has always been redrawn by, and it stays that way rather than growing a second scheduler
 * that could disagree with it.
 *
 * @param host - The painted `.panel-body`
 * @param rerender - The Navigator's repaint
 */
export function mountFilesPanel(host: HTMLElement, rerender: () => void): void {
  const container = host.querySelector<HTMLElement>(".panel-content") ?? host;
  // Captured per paint, so the scroll watch and every awaited flow repaint through the CURRENT
  // Navigator scheduler rather than through a closure from an earlier one.
  _filesRerender = rerender;
  if (_standingFiles && (_standingFiles.host !== container || !_standingFiles.handle.connected())) {
    unmountFilesPanel();
  }
  const values = filesPanelValues();
  if (_standingFiles) {
    _standingFiles.handle.update(values);
  } else {
    const handle = mountFilesPanelSurface(container, values, FILE_ACTIONS);
    _standingFiles = { handle, host: container };
    /* The FIRST paint is the one nothing else follows, and the tree element it announces through
       `onNodeCreated` is still detached — the document is appended when its mount resolves. A watch
       armed against a detached element resolves no scroller, so the window would answer "all of
       them" for the life of the panel. This is where the tree is finally in the document. */
    void handle.ready.then(adoptFileTree);
  }
  /* One microtask later, because the projection above has only just been written: the rows reach
     the DOM as the scope's effects run, and a watch armed before they exist measures a tree that
     does not overflow yet. */
  queueMicrotask(adoptFileTree);
}

/**
 * Take the panel down: the document, the drag registrations, the scroll watch and the row handles.
 *
 * Exported because a project close has to reach it — the tree it is showing belongs to the project
 * being left behind, exactly as `cleanupGitPanel` is for the working tree.
 */
export function unmountFilesPanel(): void {
  dismissFileContextMenu();
  _standingFiles?.handle.dispose();
  _standingFiles = null;
  _lastValues = null;
  releaseFileTreeDnD();
  _fileRowEls.clear();
  _fileRows = [];
  _pendingFocusPath = null;
}
