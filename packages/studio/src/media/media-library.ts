/// <reference lib="dom" />
/**
 * The Media workspace's library: the project's media, filtered, searched, sorted and acted on.
 *
 * One flow, two modes (studio.md §22.6). In **manage** mode it is the Media home tab: filters on
 * the left, a grid of tiles in the middle, and the selected file's detail on the right, with
 * **Replace**, **Open in viewer** and **Delete**. In **pick** mode it is the full-size media picker
 * (§9.3), the same surface inside a `jx-dialog` whose footer answers Cancel or Use <file>; the
 * compact popover's **Browse all media…** opens it (`ui/media-picker.ts`).
 *
 * **What it lists is `ui/media-picker.ts`'s listing**, `public/**` and every collection's
 * `images/**`, so the workspace, the pickers and the Site panel cannot disagree about what exists.
 * Metadata comes from the listing (`files/media-meta.ts`), and usage from the reference index
 * (`files/media-usage.ts`), asked about the selected file when it is selected and about every file
 * only when the reader asks for **Unused**.
 *
 * **Unused is asked for, never assumed.** The sweep starts the first time the filter is chosen,
 * runs one query at a time, and the count stays blank until the last answer is in. A file whose
 * query failed is never counted as unused, and a host with no reference index draws no Unused
 * filter at all: a confident zero is the one answer a delete must never be prompted by.
 *
 * **Uploads with no context land in `public/media/`** (`DEFAULT_MEDIA_DIR`): the Media home has no
 * document, so it always does. The pick dialog answers a field of the active document, so it
 * uploads where that document's own uploads go (`uploadDirFor`: a collection entry keeps its media
 * in `content/<c>/images/`). Either way the destination is named on the Upload label before the
 * drop, only files the listing will show are uploaded, and the first upload is selected at once, so
 * the detail pane describes it the moment the re-read listing has it. **Replace** is the one
 * overwrite (`replaceAsset`), offered only files of the replaced one's own type; **Delete** goes
 * through the same confirmation as every delete, which states the usage line
 * (`files/file-ops.ts`).
 *
 * **This module is the flow; `surfaces/media-library.json` is the markup.** Every decision is made
 * here and handed to the document as strings and discriminants.
 *
 * @docs studio/projects/media
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { getPlatform } from "../platform";
import { notify } from "../services/notify";
import { invalidateUsages, onUsagesInvalidated, usagesSupported } from "../services/references";
import { overlayRegion, paneRegion } from "../ui/regions";
import { layerHost } from "../ui/layers";
import { rectOf } from "../utils/geometry";
import { activeTab, closeTab, workspace } from "../workspace/workspace";
import { createPreviewObserver } from "../browse/library-preview";
import {
  DEFAULT_MEDIA_DIR,
  announceMediaChanged,
  replaceAccept,
  replaceAsset,
  uploadAccept,
  uploadAssets,
  uploadDirFor,
} from "../files/media-upload";
import {
  loadMediaMeta,
  mediaMetaSummary,
  peekMediaMeta,
  recordImageSize,
} from "../files/media-meta";
import { dirName, previewFileSrc } from "../files/media-paths";
import { forgetVersions } from "../files/asset-versions";
import { loadMediaUsages, peekMediaUsages } from "../files/media-usage";
import { onProjectMediaChange, projectMediaFiles } from "../ui/media-picker";
import { openMediaTab } from "./media-open";
import { factsLine, mediaStageFor, specimenOf, usageOf } from "./media-pane";
import {
  MEDIA_FILTERS,
  MEDIA_SORTS,
  filterCounts,
  gridColumns,
  gridStep,
  isMediaFilterKey,
  isMediaSortKey,
  mediaFilterLabel,
  visibleMedia,
} from "./media-library-model";
import { mountMediaLibrarySurface } from "../surfaces/media-library";
import { MEDIA_PICK_SLOT, openMediaPickDialogSurface } from "../surfaces/media-pick-dialog";
import type { LibraryMediaFile, MediaFilterKey, MediaSortKey } from "./media-library-model";
import type { MediaFileKind } from "../files/media-upload";
import type { ProjectMediaFile } from "../ui/media-picker";
import type {
  MediaLibrarySurfaceHandle,
  MediaLibraryView,
  MediaTileRow,
} from "../surfaces/media-library";
import type { MediaPickDialogHandle } from "../surfaces/media-pick-dialog";
import type { PreviewObserver } from "../browse/library-preview";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type * as FileOpsModule from "../files/file-ops";
import type * as FilesModule from "../files/files";

/** The canvas mode the Media home tab draws under (`workspace/workspace-ids.ts`). */
export const MEDIA_HOME_MODE = "media-home";

/** The kit glyph a file with no picture of its own is drawn with. */
const KIND_GLYPH: Readonly<Record<MediaFileKind, string>> = {
  audio: "play",
  document: "file-text",
  font: "text-aa",
  image: "image",
  video: "play",
};

/** The word a tile says about a file nothing has been measured about yet. */
const KIND_WORD: Readonly<Record<MediaFileKind, string>> = {
  audio: "Audio",
  document: "Document",
  font: "Font",
  image: "Image",
  video: "Video",
};

// ─── What the reader chose ───────────────────────────────────────────────────

/** A library's own choices: the filter, the search, the sort and the selection. */
interface LibraryChoice {
  filter: MediaFilterKey;
  query: string;
  sort: MediaSortKey;
  selected: string | null;
}

/**
 * The Media home's choices, shared by every pane that shows it and written by `media.browse`, so a
 * command can say "show me the unused images" without knowing which pane will draw the answer.
 */
const homeChoice: LibraryChoice = { filter: "all", query: "", sort: "newest", selected: null };

/** A file the commands asked to open the picker for, once the input that opens it exists. */
interface PendingPicker {
  role: "upload" | "replace";
  /** For a replace: the file it replaces, which must be the selection when the input appears. */
  file: string | null;
}

let _pendingPicker: PendingPicker | null = null;

// ─── Unused ──────────────────────────────────────────────────────────────────

/** The files nobody references, once every file's question has settled; `null` before. */
let _unused: Set<string> | null = null;
/** How far the sweep has got, for the line the grid shows while it runs. */
let _sweepDone = 0;
let _sweepTotal = 0;
let _sweepRunning = false;
/** Bumped when the listing moves, so a sweep over the old listing cannot land. */
let _sweepEpoch = 0;

/** Forget the sweep: the listing it was over has changed. */
function resetUnused(): void {
  _unused = null;
  _sweepRunning = false;
  _sweepDone = 0;
  _sweepTotal = 0;
  _sweepEpoch += 1;
}

/**
 * Ask the usage index about every file, one at a time, and settle {@link _unused}.
 *
 * One query in flight at a time, because each is a sweep of every document in the project, and a
 * library of two hundred images is not two hundred concurrent sweeps the backend should be handed.
 */
async function sweepUnused(files: readonly ProjectMediaFile[]): Promise<void> {
  if (_sweepRunning || _unused !== null || !usagesSupported()) {
    return;
  }
  const epoch = _sweepEpoch;
  _sweepRunning = true;
  _sweepDone = 0;
  _sweepTotal = files.length;
  const unused = new Set<string>();
  for (const file of files) {
    const state = await loadMediaUsages(file.file);
    if (epoch !== _sweepEpoch) {
      return;
    }
    if (state.status === "ready" && state.result.files.length === 0) {
      unused.add(file.file);
    }
    _sweepDone += 1;
    redrawAll();
  }
  _unused = unused;
  _sweepRunning = false;
  redrawAll();
}

// ─── Mounts ──────────────────────────────────────────────────────────────────

interface LibraryMount {
  mode: "manage" | "pick";
  /** Pick mode for a field that holds a picture: only images are offered. */
  images: boolean;
  choice: LibraryChoice;
  /** The pane id, or `null` for the pick dialog. */
  paneId: string | null;
  region: string;
  handle: MediaLibrarySurfaceHandle | null;
  dropActive: boolean;
  /** Tiles that have scrolled into view, whose thumbnails may load. */
  visible: Set<string>;
  tiles: Map<string, HTMLElement>;
  grid: HTMLElement | null;
  /**
   * Every file input the document has created for each role, pruned of the ones it has dropped.
   * Upload has two placements (the toolbar's and the empty state's), and the empty state's is gone
   * the moment the first file lands: a single slot would keep pointing at it.
   */
  inputs: { upload: Set<HTMLInputElement>; replace: Set<HTMLInputElement> };
  /** Where this mount's uploads land: `public/media/` at home, the field's document's in a pick. */
  uploadDir: string;
  /** A pending sweep of nodes the document dropped (detached tiles, old inputs). */
  sweepTimer: ReturnType<typeof setTimeout> | null;
  observer: PreviewObserver;
  /** Pick mode: what a use commits. */
  onPick: ((file: ProjectMediaFile) => void) | null;
  /** Pick mode: tell the dialog the selection moved, so its footer can say what Use will use. */
  onSelect: (() => void) | null;
  disposed: boolean;
}

/** Every live library, so a listing, a sweep or a measurement can repaint them all. */
const _mounts = new Set<LibraryMount>();

/** The library mounted in each pane, keyed by pane id, as `media/media-pane.ts` keys its viewers. */
const _panes = new Map<string, { tabId: string; wrap: HTMLElement; mount: LibraryMount }>();

let _unsubscribe: (() => void) | null = null;

/**
 * Listen while any library is mounted, and stop when the last one goes: to the listing, and to the
 * usage index. Either moving invalidates the Unused set. A document saved with a new `<img src>`
 * moves only the second, so listening to the listing alone left a referenced file under Unused, the
 * one list a reader deletes from.
 */
function listen(): void {
  if (_unsubscribe !== null) {
    return;
  }
  const forget = (): void => {
    resetUnused();
    redrawAll();
  };
  const stopListing = onProjectMediaChange(forget);
  const stopUsages = onUsagesInvalidated(forget);
  _unsubscribe = () => {
    stopListing();
    stopUsages();
  };
}

function unlistenIfIdle(): void {
  if (_mounts.size === 0 && _unsubscribe) {
    _unsubscribe();
    _unsubscribe = null;
  }
}

function redraw(mount: LibraryMount): void {
  if (!mount.disposed) {
    mount.handle?.update(libraryView(mount));
    scheduleSweep(mount);
  }
}

/**
 * Once a repaint has settled, give back what the document dropped: tiles a filter, a search or a
 * sort removed (the preview observer still watches every one that never scrolled into view, the
 * leak `browse/library-preview.ts` documents), and inputs a `$switch` took away.
 */
function scheduleSweep(mount: LibraryMount): void {
  // A disposed mount has nothing left to give back, and `disposeMount` clears a pending sweep.
  if (mount.sweepTimer !== null || mount.disposed) {
    return;
  }
  mount.sweepTimer = setTimeout(() => {
    mount.sweepTimer = null;
    mount.observer.releaseDetached();
    for (const [file, tile] of mount.tiles) {
      if (!tile.isConnected) {
        mount.tiles.delete(file);
      }
    }
    for (const inputs of [mount.inputs.upload, mount.inputs.replace]) {
      for (const input of inputs) {
        if (!input.isConnected) {
          inputs.delete(input);
        }
      }
    }
  }, 0);
}

/** The first of a role's inputs still in the document, or `null`. */
function connectedInput(inputs: ReadonlySet<HTMLInputElement>): HTMLInputElement | null {
  return [...inputs].find((input) => input.isConnected) ?? null;
}

function redrawAll(): void {
  for (const mount of _mounts) {
    redraw(mount);
  }
}

function disposeMount(mount: LibraryMount): void {
  mount.disposed = true;
  if (mount.sweepTimer !== null) {
    clearTimeout(mount.sweepTimer);
    mount.sweepTimer = null;
  }
  mount.inputs.upload.clear();
  mount.inputs.replace.clear();
  mount.observer.destroy();
  mount.handle?.dispose();
  mount.handle = null;
  mount.tiles.clear();
  _mounts.delete(mount);
  unlistenIfIdle();
}

// ─── The projection ──────────────────────────────────────────────────────────

/** The listing a mount offers, as read, and as the model reads it. */
interface LibraryListing {
  /** `null` while the listing is still being read. */
  listed: readonly ProjectMediaFile[] | null;
  files: LibraryMediaFile[];
}

/** The listing as the model reads it, narrowed to images for an image picker. */
function libraryFiles(mount: LibraryMount): LibraryListing {
  const listing = projectMediaFiles();
  const listed =
    listing === null ? null : mount.images ? listing.filter((f) => f.isImage) : listing;
  const files = (listed ?? []).map((file) => {
    const meta = peekMediaMeta(file.file);
    return {
      bytes: meta?.bytes ?? null,
      file: file.file,
      kind: file.kind,
      modified: meta?.modified ?? null,
      name: file.name,
    };
  });
  return { files, listed };
}

/** The filters a mount offers: an image picker has only images to filter. */
function offeredFilters(mount: LibraryMount): typeof MEDIA_FILTERS {
  return MEDIA_FILTERS.filter(
    (filter) =>
      (filter.key !== "unused" || usagesSupported()) &&
      (!mount.images || filter.key === "image" || filter.key === "unused"),
  );
}

/** The selected file, when it is one the listing still has. */
export function selectedEntry(mount: {
  choice: LibraryChoice;
  images: boolean;
}): ProjectMediaFile | null {
  const { selected } = mount.choice;
  if (selected === null) {
    return null;
  }
  const entry = projectMediaFiles()?.find((file) => file.file === selected) ?? null;
  return entry && (!mount.images || entry.isImage) ? entry : null;
}

/** What the grid says in place of tiles. */
interface EmptyTexts {
  emptyTitle: string;
  emptyDetail: string;
}

function emptyTexts(mount: LibraryMount, total: number): EmptyTexts {
  if (total === 0) {
    return {
      emptyDetail: `Upload files or drop them anywhere here. They are saved under ${mount.uploadDir}/, and anything already under public/ or a collection's images/ folder is listed here too.`,
      emptyTitle: mount.images ? "No images yet" : "No media yet",
    };
  }
  const { filter, query } = mount.choice;
  if (query.trim() !== "") {
    return {
      emptyDetail: `Nothing in ${mediaFilterLabel(filter)} matches it.`,
      emptyTitle: `No matches for “${query.trim()}”`,
    };
  }
  if (filter === "unused") {
    return {
      emptyDetail: "Every file is referenced by at least one document.",
      emptyTitle: "No unused media",
    };
  }
  return {
    emptyDetail: `${total} ${total === 1 ? "file" : "files"} in the project, none of them ${mediaFilterLabel(filter).toLowerCase()}.`,
    emptyTitle: `No ${mediaFilterLabel(filter).toLowerCase()}`,
  };
}

/** Everything the document draws for one mount. */
function libraryView(mount: LibraryMount): MediaLibraryView {
  const { choice } = mount;
  const { files, listed } = libraryFiles(mount);
  const counts = filterCounts(files, _unused);
  const filters = offeredFilters(mount);
  // A filter the mount does not offer (a stored "video" in an image picker) reads as its first.
  if (!filters.some((f) => f.key === choice.filter)) {
    choice.filter = filters[0]?.key ?? "all";
  }
  const visible = visibleMedia(files, {
    filter: choice.filter,
    query: choice.query,
    sort: choice.sort,
    unused: _unused,
  });
  /* The sweep is over the WHOLE listing, never this mount's: its answer is shared by every mount,
     and an image picker's narrowed list would leave the Media home's Unused without its videos. */
  const listing = projectMediaFiles();
  if (choice.filter === "unused" && listing !== null) {
    void sweepUnused(listing);
  }

  let gridState: MediaLibraryView["gridState"] = "listed";
  if (listed === null) {
    gridState = "loading";
  } else if (choice.filter === "unused" && _unused === null) {
    gridState = "counting";
  } else if (files.length === 0 || visible.length === 0) {
    gridState = files.length === 0 ? "empty" : "nomatch";
  }

  const entry = selectedEntry(mount);
  const stop = visible.some((file) => file.file === choice.selected)
    ? choice.selected
    : (visible[0]?.file ?? null);
  const tiles: MediaTileRow[] = visible.map((file) => {
    const isImage = file.kind === "image";
    return {
      caption: mediaMetaSummary(peekMediaMeta(file.file)) || KIND_WORD[file.kind],
      file: file.file,
      glyph: KIND_GLYPH[file.kind],
      key: file.file,
      name: file.name,
      selected: file.file === choice.selected ? "true" : "false",
      tabindex: file.file === stop ? "0" : "-1",
      thumbSrc: isImage && mount.visible.has(file.file) ? previewFileSrc(file.file) : "",
      thumbState: isImage ? (mount.visible.has(file.file) ? "image" : "pending") : "glyph",
    };
  });

  const title =
    mount.images && choice.filter === "image" ? "Images" : mediaFilterLabel(choice.filter);
  return {
    countingLabel:
      _sweepTotal > 0
        ? `Counting references… ${_sweepDone} of ${_sweepTotal}`
        : "Counting references…",
    dropActive: mount.dropActive ? "true" : "false",
    filters: filters.map((filter) => {
      const count = counts[filter.key];
      return {
        count: count === null ? "" : String(count),
        key: filter.key,
        label: mount.images && filter.key === "image" ? "All images" : filter.label,
        pressed: filter.key === choice.filter ? "true" : "false",
      };
    }),
    gridState,
    mode: mount.mode,
    query: choice.query,
    region: mount.region,
    sort: choice.sort,
    sortOptions: MEDIA_SORTS.map((sort) => ({ label: sort.label, value: sort.key })),
    tiles,
    title,
    titleId: `media-library-title-${mount.region.replaceAll(/[^\w-]/g, "-")}`,
    uploadAccept: mount.images ? "image/*" : uploadAccept(),
    uploadHint: `Upload into ${mount.uploadDir}/`,
    ...emptyTexts(mount, files.length),
    ...detailView(mount, entry),
  };
}

/** The detail pane for the selected file, or the hint that stands in for one. */
function detailView(
  mount: LibraryMount,
  entry: ProjectMediaFile | null,
): Pick<
  MediaLibraryView,
  | "detailState"
  | "detailHint"
  | "selectedFile"
  | "detailName"
  | "detailFacts"
  | "detailRef"
  | "previewKind"
  | "previewSrc"
  | "previewGlyph"
  | "previewFontFace"
  | "previewSpecimen"
  | "previewSpecimenFamily"
  | "replaceAccept"
  | "usageState"
  | "usageHeadline"
  | "usageFiles"
> {
  if (entry === null) {
    return {
      detailFacts: "",
      detailHint:
        mount.mode === "pick" ? "Choose a file to use it." : "Select a file to see its details.",
      detailName: "",
      detailRef: "",
      detailState: "none",
      previewFontFace: "",
      previewGlyph: "",
      previewKind: "glyph",
      previewSpecimen: "",
      previewSpecimenFamily: "",
      previewSrc: "",
      replaceAccept: "",
      selectedFile: "",
      usageFiles: [],
      usageHeadline: "",
      usageState: "hidden",
    };
  }
  const meta = peekMediaMeta(entry.file);
  const usage = peekMediaUsages(entry.file);
  /* Asked on the first paint that finds them missing: both loaders cache and de-duplicate in
     flight, and both repaint when they land. */
  if (meta === null) {
    void loadMediaMeta(entry.file).then(redrawAll);
  }
  if (usage === null || usage.status === "pending") {
    void loadMediaUsages(entry.file).then(redrawAll);
  }
  /* The viewer's own decision about which element shows a file (`media/media-pane.ts`), so the two
     cannot drift: a font is set as a specimen in both. A PDF's embed wants the viewer's full pane,
     so the detail pane draws its glyph and Open in viewer shows it. */
  const stage = mediaStageFor(entry.file);
  const previewKind =
    stage === "image" || stage === "video" || stage === "audio" || stage === "font"
      ? stage
      : "glyph";
  const specimen =
    previewKind === "font"
      ? specimenOf(entry.file)
      : { fontFace: "", specimen: "", specimenFamily: "" };
  return {
    detailFacts: factsLine(entry.file, meta),
    detailHint: "",
    detailName: entry.name,
    detailRef: entry.ref,
    detailState: "shown",
    previewFontFace: specimen.fontFace,
    previewGlyph: KIND_GLYPH[entry.kind],
    previewKind,
    previewSpecimen: specimen.specimen,
    previewSpecimenFamily: specimen.specimenFamily,
    previewSrc: previewKind === "glyph" ? "" : previewFileSrc(entry.file),
    replaceAccept: replaceAccept(entry.file),
    selectedFile: entry.file,
    ...usageOf(usage),
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** `files/files.ts`, for a usage link. Dynamic, for the reason `media/media-pane.ts` gives. */
let _files: Promise<typeof FilesModule> | null = null;
/** `files/file-ops.ts`, for the delete confirmation: it reaches the canvas and the collab layer. */
let _fileOps: Promise<typeof FileOpsModule> | null = null;

function filesModule(): Promise<typeof FilesModule> {
  _files ??= import("../files/files");
  return _files;
}

function fileOpsModule(): Promise<typeof FileOpsModule> {
  _fileOps ??= import("../files/file-ops");
  return _fileOps;
}

/**
 * Open the picker an input stands for, with HTML's `showPicker()`.
 *
 * It throws without transient user activation (a command run from a script rather than a key or a
 * click) and where a host has not implemented it; either way the control is focused instead, so
 * Enter opens it.
 */
function openPicker(input: HTMLInputElement): void {
  try {
    input.showPicker();
  } catch {
    input.focus();
  }
}

/** Select `file` in a mount, and say so to a pick dialog's footer. */
function select(mount: LibraryMount, file: string | null): void {
  mount.choice.selected = file;
  redraw(mount);
  mount.onSelect?.();
}

async function uploadInto(mount: LibraryMount, files: FileList | File[]): Promise<void> {
  /* Only files this library will list (a drop ignores `accept`): an image picker takes pictures, and
     the home takes what `MEDIA_EXTENSIONS` names, so what is selected next is always on screen. */
  const uploaded = await uploadAssets([...files], {
    dir: mount.uploadDir,
    only: mount.images ? "image" : "media",
  });
  const [first] = uploaded;
  if (!first) {
    return;
  }
  /* The listing is being re-read (the upload core announced the change), so the new file may not be
     in it yet: select it now, and the detail pane describes it the moment the listing lands. */
  if (mount.choice.filter !== "all" && mount.choice.filter !== first.kind) {
    mount.choice.filter = mount.images ? "image" : "all";
  }
  mount.choice.query = "";
  select(mount, first.path);
}

/**
 * Delete a media file, after the confirmation every delete goes through (studio.md §9.1.1): its
 * usage line is stated before the button can be pressed.
 *
 * @returns Whether it was deleted.
 */
export async function deleteMediaFile(path: string): Promise<boolean> {
  const name = path.split("/").pop() ?? path;
  const { confirmFileDelete } = await fileOpsModule();
  if (!(await confirmFileDelete({ name, path }))) {
    return false;
  }
  try {
    const { markLocalMutation } = await import("../files/fs-events");
    markLocalMutation(path);
    await getPlatform().deleteFile(path);
  } catch (error) {
    notify.error(`Could not delete ${name}.`, {
      detail: errorMessage(error),
      path,
      source: "Media",
    });
    return false;
  }
  forgetVersions([path]);
  invalidateUsages();
  // A viewer tab over a file that is gone would show a broken image; it holds no edits to lose.
  if (workspace.tabs.has(path)) {
    closeTab(path);
  }
  for (const mount of _mounts) {
    if (mount.choice.selected === path) {
      mount.choice.selected = null;
    }
  }
  if (homeChoice.selected === path) {
    homeChoice.selected = null;
  }
  await announceMediaChanged(dirName(path));
  notify.success(`Deleted ${name}`);
  return true;
}

function actionsFor(mount: LibraryMount) {
  return {
    activate: (file: string) => {
      select(mount, file);
      activate(mount, file);
    },
    activateSelected: () => {
      const { selected } = mount.choice;
      if (selected !== null) {
        activate(mount, selected);
      }
    },
    copyRef: () => {
      const entry = selectedEntry(mount);
      // `navigator.clipboard` is [SecureContext]: a plain-http host has none, whatever lib.dom says.
      if (entry && "clipboard" in navigator) {
        void navigator.clipboard.writeText(entry.ref);
      }
    },
    dragOut: () => {
      if (mount.dropActive) {
        mount.dropActive = false;
        redraw(mount);
      }
    },
    dragOver: () => {
      if (!mount.dropActive) {
        mount.dropActive = true;
        redraw(mount);
      }
    },
    drop: (files: FileList | null) => {
      mount.dropActive = false;
      redraw(mount);
      if (files?.length) {
        void uploadInto(mount, files);
      }
    },
    focusTile: (file: string) => {
      /* Selection follows focus (the listbox pattern): a Tab onto the grid lands on the roving stop
         AND selects it, so the first Enter opens (or, in a pick, uses) the tile the ring is on. */
      if (mount.choice.selected !== file) {
        select(mount, file);
      }
    },
    gridHost: (element: HTMLElement) => {
      mount.grid = element;
    },
    inputHost: (element: HTMLInputElement, role: "upload" | "replace") => {
      mount.inputs[role].add(element);
      scheduleSweep(mount);
      const pending = _pendingPicker;
      if (
        mount.mode === "manage" &&
        pending?.role === role &&
        (role === "upload" || pending.file === mount.choice.selected)
      ) {
        _pendingPicker = null;
        openPicker(element);
      }
    },
    key: (key: string, ctrl: boolean) => moveSelection(mount, key, ctrl),
    measure: (file: string, width: number, height: number) => {
      if (recordImageSize(file, width, height)) {
        redrawAll();
      }
    },
    openDocument: (path: string) => {
      void filesModule().then(({ openFileInTab }) => openFileInTab(path));
    },
    openViewer: () => {
      const { selected } = mount.choice;
      if (selected !== null) {
        openMediaTab(selected);
      }
    },
    remove: () => {
      const { selected } = mount.choice;
      if (selected !== null) {
        void deleteMediaFile(selected);
      }
    },
    replace: (input: HTMLInputElement) => {
      const [chosen] = input.files ?? [];
      // Cleared first: a file input that keeps its value refuses the same file twice.
      input.value = "";
      const { selected } = mount.choice;
      if (chosen && selected !== null) {
        /* No metadata invalidation here: `replaceAsset` announces the change, whose handler drops
           the listing AND its metadata and re-reads them in that order. A second drop after it
           lands would wipe the fresh facts of every other tile, and nothing would re-seed them. */
        void replaceAsset(selected, chosen).then(redrawAll);
      }
    },
    reset: () => {
      mount.choice.filter = mount.images ? "image" : "all";
      mount.choice.query = "";
      redraw(mount);
    },
    select: (file: string) => select(mount, file),
    setFilter: (key: string) => {
      if (isMediaFilterKey(key)) {
        mount.choice.filter = key;
        redraw(mount);
      }
    },
    setQuery: (value: string) => {
      mount.choice.query = value;
      redraw(mount);
    },
    setSort: (value: string) => {
      if (isMediaSortKey(value)) {
        mount.choice.sort = value;
        redraw(mount);
      }
    },
    tileHost: (element: HTMLElement, file: string) => {
      mount.tiles.set(file, element);
      tileFiles.set(element, file);
      mount.observer.observe(element);
    },
    upload: (input: HTMLInputElement) => {
      const chosen = input.files;
      input.value = "";
      if (chosen?.length) {
        void uploadInto(mount, chosen);
      }
    },
  };
}

/** Enter or a double-click: open the viewer, or in pick mode, use the file. */
function activate(mount: LibraryMount, file: string): void {
  if (mount.mode === "pick") {
    const entry = selectedEntry(mount);
    if (entry) {
      mount.onPick?.(entry);
    }
    return;
  }
  openMediaTab(file);
}

/** An arrow, Home or End on the grid: move the selection and the focus with it. */
function moveSelection(mount: LibraryMount, key: string, ctrl: boolean): void {
  const { files } = libraryFiles(mount);
  const visible = visibleMedia(files, {
    filter: mount.choice.filter,
    query: mount.choice.query,
    sort: mount.choice.sort,
    unused: _unused,
  });
  const index = visible.findIndex((file) => file.file === mount.choice.selected);
  const columns = mount.grid ? gridColumns(rectOf(mount.grid).width) : 1;
  const next =
    index === -1
      ? visible.length > 0
        ? 0
        : null
      : gridStep(index, key, columns, visible.length, ctrl);
  const target = next === null ? undefined : visible[next];
  if (!target) {
    return;
  }
  select(mount, target.file);
  /* A focus move is the one thing a flow may reach into its document for; the tile is the one the
     surface announced, not a node found by selector. */
  mount.tiles.get(target.file)?.focus();
}

/** The file each tile node stands for, as the surface announced it. */
const tileFiles = new WeakMap<Element, string>();

/** Build a mount and wire its observer. */
function createMount(
  mode: "manage" | "pick",
  choice: LibraryChoice,
  region: string,
  paneId: string | null,
  images: boolean,
  uploadDir: string,
): LibraryMount {
  const mount: LibraryMount = {
    choice,
    disposed: false,
    dropActive: false,
    grid: null,
    handle: null,
    images,
    inputs: { replace: new Set(), upload: new Set() },
    mode,
    observer: createPreviewObserver((element) => {
      /* The file the surface announced with the node, not an attribute read back off it: the
         observer may report a node before the runtime has written its attributes. */
      const file = tileFiles.get(element);
      if (file !== undefined && !mount.visible.has(file)) {
        mount.visible.add(file);
        scheduleRedraw(mount);
      }
    }),
    onPick: null,
    onSelect: null,
    paneId,
    region,
    sweepTimer: null,
    tiles: new Map(),
    uploadDir,
    visible: new Set(),
  };
  return mount;
}

/** Tiles enter view in bursts (a scroll, the first paint); one repaint per burst is enough. */
const _scheduled = new Set<LibraryMount>();

function scheduleRedraw(mount: LibraryMount): void {
  if (_scheduled.has(mount)) {
    return;
  }
  _scheduled.add(mount);
  queueMicrotask(() => {
    _scheduled.delete(mount);
    redraw(mount);
  });
}

// ─── The Media home ──────────────────────────────────────────────────────────

/** Whether this tab's library is already mounted in this pane and still in the document. */
export function mediaLibraryMounted(paneId: string, tab: Tab): boolean {
  const pane = _panes.get(paneId);
  return (
    pane !== undefined &&
    pane.tabId === tab.id &&
    pane.wrap.isConnected &&
    pane.mount.handle !== null &&
    pane.mount.handle.attached()
  );
}

/** Tear one pane's library down (mode change, tab switch, project close). Idempotent. */
export function detachMediaLibrary(paneId: string): void {
  const pane = _panes.get(paneId);
  if (!pane) {
    return;
  }
  disposeMount(pane.mount);
  _panes.delete(paneId);
}

/**
 * Draw the Media home into a pane's stage.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderMediaLibrary(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap } = surface;
  if (mediaLibraryMounted(paneId, tab)) {
    return;
  }
  detachMediaLibrary(paneId);
  const mount = createMount(
    "manage",
    homeChoice,
    paneRegion(paneId, "media-library"),
    paneId,
    false,
    // The home has no document, so its uploads take the default.
    DEFAULT_MEDIA_DIR,
  );
  _mounts.add(mount);
  listen();
  mount.handle = mountMediaLibrarySurface(wrap, libraryView(mount), actionsFor(mount), {
    clear: true,
  });
  _panes.set(paneId, { mount, tabId: tab.id, wrap });
}

/** A request for the Media home: what `media.browse` passes. */
export interface MediaBrowseRequest {
  filter?: MediaFilterKey;
  query?: string;
  /** A file to select: its project path. */
  select?: string;
}

/**
 * Apply a request to the Media home's choices and repaint every pane showing it. The caller opens
 * the home tab (`media/media-commands.ts`); this module does not know where homes come from.
 */
export function applyMediaBrowse(request: MediaBrowseRequest): void {
  if (request.filter !== undefined) {
    homeChoice.filter = request.filter;
  }
  if (request.query !== undefined) {
    homeChoice.query = request.query;
  }
  if (request.select !== undefined) {
    homeChoice.selected = request.select;
    // Shown whatever filter was in force: a file asked for by name must be on screen.
    if (homeChoice.filter !== "all") {
      homeChoice.filter = "all";
    }
    homeChoice.query = "";
  }
  redrawAll();
}

/**
 * Open the Upload picker of the Media home: now, when a home is mounted, or as soon as its input is
 * created. The caller has opened the home.
 */
export function requestMediaUpload(): void {
  /* The first input still in the document, across panes: the empty state's own Upload is dropped
     when the first file lands, and the toolbar's is the one that stays. */
  const input =
    [..._panes.values()]
      .map((pane) => connectedInput(pane.mount.inputs.upload))
      .find((found) => found !== null) ?? null;
  if (input) {
    openPicker(input);
    return;
  }
  _pendingPicker = { file: null, role: "upload" };
}

/**
 * Select `path` in the Media home and open its Replace picker, now or once the detail pane draws
 * it. The caller has opened the home.
 */
export function requestMediaReplace(path: string): void {
  applyMediaBrowse({ select: path });
  let input: HTMLInputElement | null = null;
  for (const pane of _panes.values()) {
    if (pane.mount.choice.selected === path) {
      input ??= connectedInput(pane.mount.inputs.replace);
    }
  }
  if (input) {
    openPicker(input);
    return;
  }
  _pendingPicker = { file: path, role: "replace" };
}

// ─── Pick mode ───────────────────────────────────────────────────────────────

export interface MediaPickRequest {
  /** Only images, for a field that holds a picture. */
  images: boolean;
  /** What a use commits: the file's site URL. */
  onPick: (ref: string) => void;
}

/** The open pick dialog, or `null`. One at a time: it answers one field. */
let _pick: { dialog: MediaPickDialogHandle; mount: LibraryMount } | null = null;

/** What the dialog's footer says for the selection standing now. */
function pickDialogView(mount: LibraryMount) {
  const entry = selectedEntry(mount);
  return {
    blocked: entry === null,
    confirmLabel: entry ? `Use ${entry.name}` : mount.images ? "Use image" : "Use file",
    headline: mount.images ? "Choose an image" : "Choose media",
  };
}

/** Close the pick dialog, if one is open. Idempotent. */
export function closeMediaPickDialog(): void {
  const open = _pick;
  _pick = null;
  if (open) {
    disposeMount(open.mount);
    open.dialog.close();
  }
}

/**
 * Open the full-size picker: the library in pick mode, in a `jx-dialog` in the dialog layer. A
 * double-click on a tile, Enter on the grid, or **Use <file>** commits the selection.
 */
export function openMediaPickDialog(request: MediaPickRequest): void {
  closeMediaPickDialog();
  const choice: LibraryChoice = {
    filter: request.images ? "image" : "all",
    query: "",
    selected: null,
    sort: "newest",
  };
  /* A region under the dialog slot's own (`overlay.dialog:media-picker`), so a node inside the
     library still resolves to a grammar-valid id rather than shadowing the slot's with a bare one. */
  const mount = createMount(
    "pick",
    choice,
    `${overlayRegion("dialog", MEDIA_PICK_SLOT)}/library`,
    null,
    request.images,
    /* A pick answers a field of the active document (the dialog belongs to no pane), so it lands
       where that document's other uploads do, exactly as the field's own Upload does. */
    uploadDirFor(activeTab.value?.documentPath ?? null),
  );
  const use = (entry: ProjectMediaFile): void => {
    closeMediaPickDialog();
    request.onPick(entry.ref);
  };
  mount.onPick = use;
  _mounts.add(mount);
  listen();
  const dialog = openMediaPickDialogSurface({
    body: (host) => {
      mount.handle = mountMediaLibrarySurface(host, libraryView(mount), actionsFor(mount), {
        clear: false,
      });
    },
    /* Escape, the backdrop or Cancel: the platform closed the dialog, so take its slot and the
       library down with it. `close()` is idempotent, so the flow's own close running first is fine. */
    closed: () => {
      if (_pick?.mount === mount) {
        closeMediaPickDialog();
      } else {
        disposeMount(mount);
      }
    },
    confirm: () => {
      const entry = selectedEntry(mount);
      if (entry) {
        use(entry);
      }
    },
    layer: layerHost("dialog"),
    view: pickDialogView(mount),
  });
  mount.onSelect = () => dialog.update(pickDialogView(mount));
  _pick = { dialog, mount };
}

/** Forget every choice and mount: a project switch, or a test. */
export function resetMediaLibrary(): void {
  closeMediaPickDialog();
  for (const paneId of _panes.keys()) {
    detachMediaLibrary(paneId);
  }
  homeChoice.filter = "all";
  homeChoice.query = "";
  homeChoice.selected = null;
  homeChoice.sort = "newest";
  _pendingPicker = null;
  resetUnused();
}
