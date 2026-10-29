/// <reference lib="dom" />
/**
 * The Media workspace's library, as a mounted document.
 *
 * This is the adapter. `media/media-library.ts` is the flow: which files a filter keeps, in what
 * order, what each count may claim, which tile is selected, where an arrow lands and what Replace,
 * Delete and an upload write. It hands this module one projection, and this module hands the
 * document a scope and reports the nodes the flow needs to hold.
 *
 * **Four islands, all through `onNodeCreated`.** The flow needs four nodes the document creates:
 * each tile (watched for viewport entry, so a thumbnail is requested only when it is looked at, and
 * focused when the keyboard moves the selection onto it), the grid (measured, so ArrowDown lands on
 * the tile drawn under the current one), and the two file inputs (opened by `media.upload` and
 * `media.replace`). Each is announced as it is created, which is the one seam for a node a document
 * made (`studio-ui-guidelines.md` §9.4); a node found by selector once would be detached DOM the
 * moment a `$switch` moved.
 *
 * **The host is cleared in the pane and not in the dialog.** The pane's stage is handed to the mode
 * that owns it whole, and emptying it is what stops two libraries stacking when a re-render lands
 * before the first mount settled. The dialog's slot is this document's alone already.
 *
 * @docs studio/projects/media
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import mediaLibraryDoc from "./media-library.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";
import type { MediaUsageRow } from "./media-pane";

registerSurface("media-library", mediaLibraryDoc);

/** One filter in the left column. */
export interface MediaFilterRow {
  key: string;
  label: string;
  /** The count, already a string; `""` while it is not known (Unused before its sweep). */
  count: string;
  pressed: "true" | "false";
}

/** One tile in the grid. */
export interface MediaTileRow {
  /** The row's identity across a filter or a sort: the file's path on disk. */
  key: string;
  file: string;
  name: string;
  /** "1200 × 800 · 84 KB", or the file's kind when nothing about it is measured yet. */
  caption: string;
  selected: "true" | "false";
  /** The roving tab stop: `"0"` on exactly one tile, `"-1"` on every other. */
  tabindex: "0" | "-1";
  /** `pending` until the tile has scrolled into view, then `image`; a file with no picture: `glyph`. */
  thumbState: "image" | "pending" | "glyph";
  thumbSrc: string;
  glyph: string;
}

/** Everything the document draws, as one value. */
export interface MediaLibraryView {
  region: string;
  mode: "manage" | "pick";
  dropActive: "true" | "false";
  filters: MediaFilterRow[];
  title: string;
  titleId: string;
  query: string;
  sort: string;
  sortOptions: { label: string; value: string }[];
  uploadAccept: string;
  /** Where an upload lands, said before the files are chosen: "Upload into public/media/". */
  uploadHint: string;
  gridState: "loading" | "counting" | "empty" | "nomatch" | "listed";
  countingLabel: string;
  emptyTitle: string;
  emptyDetail: string;
  tiles: MediaTileRow[];
  detailState: "none" | "shown";
  detailHint: string;
  selectedFile: string;
  detailName: string;
  detailFacts: string;
  detailRef: string;
  /**
   * The viewer's stage for the file (`media/media-pane.ts`), minus the ones a side pane cannot
   * hold.
   */
  previewKind: "image" | "video" | "audio" | "font" | "glyph";
  previewSrc: string;
  previewGlyph: string;
  /** A font's scoped `@font-face`, the declaration naming its family, and the pangram; else `""`. */
  previewFontFace: string;
  previewSpecimenFamily: string;
  previewSpecimen: string;
  /** The Replace input's `accept`: the selected file's own format only. */
  replaceAccept: string;
  usageState: "hidden" | "shown";
  usageHeadline: string;
  usageFiles: MediaUsageRow[];
}

/** What a control asks the flow to do. */
export interface MediaLibraryActions {
  setFilter: (key: string) => void;
  setQuery: (value: string) => void;
  setSort: (value: string) => void;
  upload: (input: HTMLInputElement) => void;
  dragOver: () => void;
  dragOut: () => void;
  drop: (files: FileList | null) => void;
  select: (file: string) => void;
  /** A tile received focus: selection follows it, so the first Enter acts on the tile in the ring. */
  focusTile: (file: string) => void;
  /** A double-click: open the file in its viewer, or in pick mode, use it. */
  activate: (file: string) => void;
  /** Enter on the grid: the same, for the selected file. */
  activateSelected: () => void;
  /** A right-click on a tile in manage mode: select it and open its actions at the pointer. */
  contextMenu: (file: string, x: number, y: number) => void;
  key: (key: string, ctrl: boolean) => void;
  measure: (file: string, width: number, height: number) => void;
  copyRef: () => void;
  openDocument: (path: string) => void;
  replace: (input: HTMLInputElement) => void;
  remove: () => void;
  openViewer: () => void;
  reset: () => void;
  /** A tile node was created for `file`. */
  tileHost: (element: HTMLElement, file: string) => void;
  /** The grid node was created. */
  gridHost: (element: HTMLElement) => void;
  /** A file input was created: the toolbar's Upload (`upload`) or the detail's Replace. */
  inputHost: (element: HTMLInputElement, role: "upload" | "replace") => void;
}

export interface MediaLibrarySurfaceHandle {
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host (a mount still in flight counts). */
  attached: () => boolean;
  update: (view: MediaLibraryView) => void;
  dispose: () => void;
}

/** The scope the document reads. */
interface MediaLibraryScope
  extends MediaLibraryView, Omit<MediaLibraryActions, "tileHost" | "gridHost" | "inputHost"> {
  hasUsageFiles: boolean;
}

/** An empty view: what a scope holds before the first projection. */
export function emptyMediaLibraryView(): MediaLibraryView {
  return {
    countingLabel: "",
    detailFacts: "",
    detailHint: "",
    detailName: "",
    detailRef: "",
    detailState: "none",
    dropActive: "false",
    emptyDetail: "",
    emptyTitle: "",
    filters: [],
    gridState: "loading",
    mode: "manage",
    previewFontFace: "",
    previewGlyph: "",
    previewKind: "glyph",
    previewSpecimen: "",
    previewSpecimenFamily: "",
    previewSrc: "",
    query: "",
    region: "",
    replaceAccept: "",
    selectedFile: "",
    sort: "",
    sortOptions: [],
    tiles: [],
    title: "",
    titleId: "",
    uploadAccept: "",
    uploadHint: "",
    usageFiles: [],
    usageHeadline: "",
    usageState: "hidden",
  };
}

function project(scope: MediaLibraryScope, view: MediaLibraryView): void {
  Object.assign(scope, view);
  scope.hasUsageFiles = view.usageFiles.length > 0;
}

/** The `part` a definition declares, or `""`. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The file a mapped tile stands for, read off its `$map` item. */
function mappedFile(state: JxScope | undefined): string | null {
  const map = state?.["$map"];
  const item = isNonNullObject(map) && "item" in map ? map.item : undefined;
  return isNonNullObject(item) && "file" in item && isString(item.file) ? item.file : null;
}

/**
 * Mount the library into `host`.
 *
 * @param {HTMLElement} host - The pane's stage, or the pick dialog's slot
 * @param {MediaLibraryView} view - What to draw right now
 * @param {MediaLibraryActions} actions - What each control does
 * @param {{ clear: boolean }} options - Whether the host is a stage to be emptied first
 * @returns {MediaLibrarySurfaceHandle}
 */
export function mountMediaLibrarySurface(
  host: HTMLElement,
  view: MediaLibraryView,
  actions: MediaLibraryActions,
  options: { clear: boolean },
): MediaLibrarySurfaceHandle {
  if (options.clear) {
    host.replaceChildren();
  }
  const { tileHost, gridHost, inputHost, ...controls } = actions;
  const scope = reactive<MediaLibraryScope>({
    ...emptyMediaLibraryView(),
    ...controls,
    hasUsageFiles: false,
  });
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("media-library", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      // `disposed` first: nodes are still created while a mount that was taken down runs out.
      if (disposed || !(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "tile") {
        const file = mappedFile(state);
        if (file !== null) {
          tileHost(element, file);
        }
      } else if (part === "grid") {
        gridHost(element);
      } else if (element instanceof HTMLInputElement && part === "upload-input") {
        inputHost(element, "upload");
      } else if (element instanceof HTMLInputElement && part === "replace-input") {
        inputHost(element, "replace");
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    /* SAFETY: `media-library.json`'s root definition is a `div` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
