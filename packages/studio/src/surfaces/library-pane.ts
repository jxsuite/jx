/// <reference lib="dom" />
/**
 * The Library surface: the pane that BROWSES a project's files, as a Jx document over the kit.
 *
 * This is the adapter. `browse/library-pane.ts` keeps the Library — the scan, the filter, the
 * window, the creation and upload flows, the per-file menu — and hands this module one projection:
 * a word saying which of nine things to draw, the toolbar's chips already marked, and rows whose
 * every field is already a string. The document renders that and decides nothing.
 *
 * **Nine cases, one discriminant.** `$switch` over a value is the only conditional a document has,
 * and "is the scan running, did it finish, did the project have anything in it, did the filter keep
 * any of it, and which layout is on" is five questions. The pane answers them once and the surface
 * reads a word — which is also what keeps the four honest empty states from collapsing back into
 * the one sentence the Manage view printed for all of them.
 *
 * **Two islands, both through `onNodeCreated`.** A card's live preview is a real runtime render of
 * the file, mounted when the card comes into view and evicted by an LRU, so the document renders
 * the box and the host fills it; and the window is computed from the scroller's measured box, so
 * the host needs the element the document rendered. Neither is a thing a document can express, and
 * `onNodeCreated` is the one seam for both (specs/studio-ui-guidelines.md §9.4).
 *
 * **The container is CLEARED, because this is a pane and not a panel.** A panel is handed
 * `.panel-content`, a node lit renders `nothing` into, whose comment markers must survive; the
 * canvas stage is handed to whichever mode owns it whole, and `canvas/canvas-render.ts` hands it
 * over by emptying it. So the mount empties it too, which is what stops two Libraries stacking when
 * a repaint lands before the first mount has settled.
 *
 * @docs studio/projects/browse
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import libraryDoc from "./library-pane.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("library-pane", libraryDoc as unknown as JxDocument);

/**
 * Which of nine things the body draws.
 *
 * The first four are the states the Manage view called "No files found" — a scan still running, a
 * scan that could not finish, a project with no files at all, and a filter that matched none of
 * them — and the last five are the layouts. One word, so no two of them can be true at once.
 */
export type LibraryViewKind =
  | "loading"
  | "incomplete"
  | "empty"
  | "nomatch"
  | "cards"
  | "media"
  | "table"
  | "calendar"
  | "board";

/** What a card, tile, table row or list item draws for one file. Every field already a string. */
export interface LibraryRow {
  /** The file's project-relative path: the row's key, its tooltip, and what a click opens. */
  path: string;
  /** The file's own name — the visible label. */
  name: string;
  /** The card's second line: the file's type. */
  meta: string;
  /**
   * Which of three things stands in the art box.
   *
   * `image` is the file itself, `doc` is the live-preview island the host fills, and `glyph` is the
   * honest answer for a file nothing here can draw. Media tiles never say `doc`: a tile is a
   * thumbnail of an asset, and a live document render inside one is the cost the Media layout
   * exists to avoid.
   */
  art: "image" | "doc" | "glyph";
  /** The URL an `image` loads. Empty for the other two. */
  src: string;
  /** The table's cells for this row, in the source's own column order. */
  cells: LibraryCell[];
}

/** One table cell: which column it is in, and what it says. */
export interface LibraryCell {
  field: string;
  text: string;
}

/** One Table column, from the grid source rather than a second hand-written list. */
export interface LibraryColumn {
  field: string;
  title: string;
}

/**
 * One Calendar day or one Board column.
 *
 * Both grouped layouts CAP what they draw and say what they left out, so a group carries its own
 * note; only Board prints a count, and only the Calendar's undated section is dimmed.
 */
export interface LibraryGroup {
  /** The group's identity across repaints — the date, or the category name. */
  id: string;
  title: string;
  /** Board's honest total for the category, already a string. Empty for a Calendar day. */
  count: string;
  /** What this group left out, or the undated section's count. */
  note: string;
  noteState: "hidden" | "shown";
  /** `"true"` for the Calendar's undated section, which is set apart rather than parked on today. */
  undated: "true" | "false";
  files: LibraryRow[];
}

/** A toolbar chip: a category or a layout, and whether it is the one in force. */
export interface LibraryChip {
  key: string;
  label: string;
  checked: "true" | "false";
}

/** One row of the language facet. */
export interface LibraryOption {
  value: string;
  label: string;
}

/** Everything the document draws, as one value. */
export interface LibraryView {
  /** The region id stamped on the root, so the screenshot pipeline can address the Library. */
  region: string;
  /** The region id on the scroller, which is also the drop zone. */
  dropRegion: string;
  view: LibraryViewKind;
  categories: LibraryChip[];
  layouts: LibraryChip[];
  /**
   * Whether the language facet is drawn at all.
   *
   * One locale — or none — means every file already agrees, and a permanently-selected chip is
   * chrome that says nothing.
   */
  localeState: "hidden" | "shown";
  localeOptions: LibraryOption[];
  localeValue: string;
  query: string;
  /** Where an upload lands, as the label's tooltip says it — before the files are chosen. */
  uploadHint: string;
  /** The picker's `accept`, from the media registry. */
  uploadAccept: string;
  bannerState: "hidden" | "shown";
  bannerText: string;
  /** `"true"` while a drag is over the body. A state the host holds, not a class a handler adds. */
  dropActive: "true" | "false";
  /** The `nomatch` sentence, naming the filters that produced it. */
  emptyMessage: string;
  /** The second line of `incomplete` and `nomatch`. */
  emptyDetail: string;
  /** The windowed grid's spacer padding, as an inline declaration. */
  pad: string;
  /** The Table's two spacers, as inline declarations. */
  padTop: string;
  padBottom: string;
  rows: LibraryRow[];
  columns: LibraryColumn[];
  groups: LibraryGroup[];
  truncated: string;
  truncatedState: "hidden" | "shown";
}

/** What a control can ask the Library to do. Every one of them is a decision the pane owns. */
export interface LibraryActions {
  setCategory: (key: string) => void;
  setLayout: (key: string) => void;
  setLocale: (value: string) => void;
  search: (value: string) => void;
  openFile: (path: string) => void;
  /** Right-click on a row, at the pointer. */
  contextMenu: (path: string, x: number, y: number) => void;
  /** The New menu opens under its own button. */
  openNewMenu: (opener: HTMLElement) => void;
  /**
   * A file picker settled.
   *
   * The ELEMENT rather than its list, because a file input that is not cleared refuses the same
   * file twice — and the picker is the surface's own control, so the host is the one that clears
   * it.
   */
  upload: (input: HTMLInputElement) => void;
  dragOver: () => void;
  dragOut: () => void;
  drop: (files: FileList | null) => void;
  scrolled: () => void;
  retry: () => void;
  reset: () => void;
  /**
   * A card's preview box exists, detached and empty. The host decides whether to fill it now, watch
   * it for visibility, or leave it: nothing here knows what a preview costs.
   */
  previewSlot: (element: HTMLElement, path: string) => void;
  /** The scroller exists. The host measures it — it is the only source of the window's geometry. */
  scroller: (element: HTMLElement) => void;
}

export interface LibrarySurfaceHandle {
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host. */
  attached: () => boolean;
  update: (view: LibraryView) => void;
  dispose: () => void;
}

/** The scope the document reads: {@link LibraryView} plus the actions its controls call. */
interface LibraryScope extends Record<string, unknown>, LibraryView, LibraryActions {}

/** Write a projection into the scope. */
function project(scope: LibraryScope, view: LibraryView): void {
  scope.region = view.region;
  scope.dropRegion = view.dropRegion;
  scope.view = view.view;
  scope.categories = view.categories;
  scope.layouts = view.layouts;
  scope.localeState = view.localeState;
  scope.localeOptions = view.localeOptions;
  scope.localeValue = view.localeValue;
  scope.query = view.query;
  scope.uploadHint = view.uploadHint;
  scope.uploadAccept = view.uploadAccept;
  scope.bannerState = view.bannerState;
  scope.bannerText = view.bannerText;
  scope.dropActive = view.dropActive;
  scope.emptyMessage = view.emptyMessage;
  scope.emptyDetail = view.emptyDetail;
  scope.pad = view.pad;
  scope.padTop = view.padTop;
  scope.padBottom = view.padBottom;
  scope.rows = view.rows;
  scope.columns = view.columns;
  scope.groups = view.groups;
  scope.truncated = view.truncated;
  scope.truncatedState = view.truncatedState;
}

/** The `part` a node's definition carries, or "" for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The path of the mapped row a node was rendered inside, or "" when it was not in one. */
function rowPath(state: JxScope | undefined): string {
  const map = state?.["$map"] as { item?: { path?: unknown } } | undefined;
  const path = map?.item?.path;
  return typeof path === "string" ? path : "";
}

/**
 * Mount the Library document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {LibraryView} view - What to draw right now
 * @param {LibraryActions} actions - What each control does
 * @returns {LibrarySurfaceHandle}
 */
export function mountLibrarySurface(
  host: HTMLElement,
  view: LibraryView,
  actions: LibraryActions,
): LibrarySurfaceHandle {
  host.replaceChildren();
  const scope = reactive<LibraryScope>({
    bannerState: "hidden",
    bannerText: "",
    categories: [],
    columns: [],
    contextMenu: actions.contextMenu,
    dragOut: actions.dragOut,
    dragOver: actions.dragOver,
    drop: actions.drop,
    dropActive: "false",
    dropRegion: "",
    emptyDetail: "",
    emptyMessage: "",
    groups: [],
    layouts: [],
    localeOptions: [],
    localeState: "hidden",
    localeValue: "",
    openFile: actions.openFile,
    openNewMenu: actions.openNewMenu,
    pad: "",
    padBottom: "",
    padTop: "",
    previewSlot: actions.previewSlot,
    query: "",
    region: "",
    reset: actions.reset,
    retry: actions.retry,
    rows: [],
    scrolled: actions.scrolled,
    scroller: actions.scroller,
    search: actions.search,
    setCategory: actions.setCategory,
    setLayout: actions.setLayout,
    setLocale: actions.setLocale,
    truncated: "",
    truncatedState: "hidden",
    upload: actions.upload,
    uploadAccept: "",
    uploadHint: "",
    view: "loading",
  }) as LibraryScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the two islands
     announce themselves through `onNodeCreated` as they are created, which is one `connectedCallback`
     EARLIER than awaiting the element would be (§1.1, "await the element"). */
  const ready = mountSurface("library-pane", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      const part = partOf(def);
      if (part === "" || !(element instanceof HTMLElement)) {
        return;
      }
      if (part === "body") {
        actions.scroller(element);
        return;
      }
      if (part === "doc-preview") {
        const path = rowPath(state);
        if (path) {
          actions.previewSlot(element, path);
        }
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      /* A mount still in flight has nothing in the host yet, and answering "no" to that would make
         the next canvas repaint tear down the mount it is waiting for and start another. */
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
