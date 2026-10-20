/// <reference lib="dom" />
/**
 * The Content home surface: one collection, browsed, as a Jx document over the kit (studio.md
 * §22.5).
 *
 * This is the adapter. `browse/library-pane.ts` keeps the home — the scan, the collection and its
 * filter, the window, the header line, the per-file menu — and hands this module one projection: a
 * word saying which of eight things to draw, the toolbar's chips already marked, and rows whose
 * every field is already a string. The document renders that and decides nothing.
 *
 * **Eight cases, one discriminant.** `$switch` over a value is the only conditional a document has,
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
 * over by emptying it. So the mount empties it too, which is what stops two homes stacking when a
 * repaint lands before the first mount has settled.
 *
 * @docs studio/projects/browse
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { placeholderBrokenImages } from "../utils/edit-display";
import libraryDoc from "./library-pane.json";
import type { JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("library-pane", libraryDoc);

/**
 * Which of eight things the body draws.
 *
 * The first four are the states the Manage view called "No files found" — a scan still running, a
 * scan that could not finish, a collection with nothing in it, and a filter that matched none of it
 * — and the last four are the views. One word, so no two of them can be true at once.
 */
export type LibraryViewKind =
  | "loading"
  | "incomplete"
  | "empty"
  | "nomatch"
  | "cards"
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
   * honest answer for a file nothing here can draw.
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
  /** The group's identity across repaints — the date, or the folder. */
  id: string;
  title: string;
  /** Board's honest total for the folder, already a string. Empty for a Calendar day. */
  count: string;
  /** What this group left out, or the undated section's count. */
  note: string;
  noteState: "hidden" | "shown";
  /** `"true"` for the Calendar's undated section, which is set apart rather than parked on today. */
  undated: "true" | "false";
  files: LibraryRow[];
}

/** A toolbar chip: a view, and whether it is the one in force. */
export interface LibraryChip {
  key: string;
  label: string;
  checked: "true" | "false";
}

/**
 * The header line: where a collection's entries are published (§22.5).
 *
 * `page` reads "Each post has a page at `/blog/:slug` using Post" with **Design the post page**;
 * `none` reads "Entries have no page of their own" with **Add one**; `loading` is the sentence
 * shown while the pages are being read; `hidden` draws nothing (Pages, a file-backed collection).
 */
export interface LibraryPageLine {
  state: "hidden" | "loading" | "page" | "none";
  /** The sentence before the pattern, or the whole sentence for `loading` and `none`. */
  text: string;
  /** The URL pattern, drawn as code. */
  pattern: string;
  /** "using Post", or "with no template". */
  template: string;
  /** The button that opens the page in Design. */
  designLabel: string;
}

/** Everything the document draws, as one value. */
export interface LibraryView {
  /** The region id stamped on the root, so the screenshot pipeline can address the home. */
  region: string;
  view: LibraryViewKind;
  /** The collection's title: "Pages", "Posts". */
  title: string;
  /** The line under the title, or "" for none. */
  subtitle: string;
  /** The search field's label: "Search posts". */
  searchLabel: string;
  /** The create button's label: "New post". */
  newLabel: string;
  /** Whether **New <item>** is drawn: a file-backed collection (one CSV) gains rows in its file. */
  newState: "hidden" | "shown";
  /**
   * Whether **Fields** and **Edit in grid** are drawn: a declared collection has fields and a grid
   * of its own, Pages does not.
   */
  fieldsState: "hidden" | "shown";
  page: LibraryPageLine;
  layouts: LibraryChip[];
  /**
   * Whether the language facet is drawn at all.
   *
   * One locale — or none — means every file already agrees, and a permanently-selected chip is
   * chrome that says nothing.
   */
  localeState: "hidden" | "shown";
  localeOptions: SurfaceOption[];
  localeValue: string;
  /** The Filter: drawn when something groups the entries (their status, or the Board's field). */
  filterState: "hidden" | "shown";
  filterOptions: SurfaceOption[];
  filterValue: string;
  query: string;
  bannerState: "hidden" | "shown";
  bannerText: string;
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

/** What a control can ask the home to do. Every one of them is a decision the pane owns. */
export interface LibraryActions {
  setLayout: (key: string) => void;
  setLocale: (value: string) => void;
  setFilter: (value: string) => void;
  search: (value: string) => void;
  openFile: (path: string) => void;
  /** Right-click on a row, at the pointer. */
  contextMenu: (path: string, x: number, y: number) => void;
  /** **New <item>** opens Add new on the collection's kind. */
  openNew: () => void;
  /** **Fields** opens Project Settings › Content types on this collection. */
  openFields: () => void;
  /** **Edit in grid** opens the collection's grid (`collection.editInGrid`). */
  openGrid: () => void;
  /** **Design the <item> page** opens the collection's page in Design. */
  designPage: () => void;
  /** **Add one** writes the collection's page. */
  addPage: () => void;
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
interface LibraryScope extends LibraryView, LibraryActions {}

/** Write a projection into the scope. */
function project(scope: LibraryScope, view: LibraryView): void {
  scope.region = view.region;
  scope.view = view.view;
  scope.title = view.title;
  scope.subtitle = view.subtitle;
  scope.searchLabel = view.searchLabel;
  scope.newLabel = view.newLabel;
  scope.newState = view.newState;
  scope.fieldsState = view.fieldsState;
  scope.page = view.page;
  scope.layouts = view.layouts;
  scope.filterState = view.filterState;
  scope.filterOptions = view.filterOptions;
  scope.filterValue = view.filterValue;
  scope.localeState = view.localeState;
  scope.localeOptions = view.localeOptions;
  scope.localeValue = view.localeValue;
  scope.query = view.query;
  scope.bannerState = view.bannerState;
  scope.bannerText = view.bannerText;
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
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The path of the mapped row a node was rendered inside, or "" when it was not in one. */
function rowPath(state: JxScope | undefined): string {
  const map = state?.["$map"];
  const item = isJsonObject(map) ? map["item"] : undefined;
  const path = isJsonObject(item) ? item["path"] : undefined;
  return isString(path) ? path : "";
}

/**
 * Mount the Content home document into `host`, wired to `actions`.
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
  // A file that will not load, or a preview image with nothing to bind, draws a placeholder rather
  // Than the browser's broken-image glyph.
  const listening = new AbortController();
  placeholderBrokenImages(host, listening.signal);
  const scope: LibraryScope = reactive<LibraryScope>({
    addPage: actions.addPage,
    bannerState: "hidden",
    bannerText: "",
    columns: [],
    contextMenu: actions.contextMenu,
    designPage: actions.designPage,
    emptyDetail: "",
    emptyMessage: "",
    fieldsState: "hidden",
    groups: [],
    layouts: [],
    filterOptions: [],
    filterState: "hidden",
    filterValue: "",
    localeOptions: [],
    localeState: "hidden",
    localeValue: "",
    newLabel: "",
    newState: "hidden",
    openFields: actions.openFields,
    openGrid: actions.openGrid,
    openFile: actions.openFile,
    openNew: actions.openNew,
    pad: "",
    padBottom: "",
    padTop: "",
    previewSlot: actions.previewSlot,
    query: "",
    region: "",
    reset: actions.reset,
    retry: actions.retry,
    page: { designLabel: "", pattern: "", state: "hidden", template: "", text: "" },
    rows: [],
    scrolled: actions.scrolled,
    scroller: actions.scroller,
    search: actions.search,
    searchLabel: "",
    setLayout: actions.setLayout,
    setFilter: actions.setFilter,
    setLocale: actions.setLocale,
    subtitle: "",
    title: "",
    truncated: "",
    truncatedState: "hidden",
    view: "loading",
  });
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the two islands
     announce themselves through `onNodeCreated` as they are created, which is one `connectedCallback`
     EARLIER than awaiting the element would be (studio-ui-guidelines.md §1.1, "await the
     element"). */
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
    /* SAFETY: `library-pane.json`'s root definition is a `div` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    const root = surface.root as HTMLElement;
    if (disposed) {
      surface.dispose();
      return root;
    }
    mounted = surface;
    return root;
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
      listening.abort();
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
