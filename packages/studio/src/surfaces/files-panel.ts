/// <reference lib="dom" />
/**
 * The Navigator's Files tree, as a mounted document.
 *
 * `files/files.ts` is the flow — what a directory listing is, which entries `.gitignore` masks, how
 * the flat row model is built, where the window falls, what a click and a key MEAN, what the
 * context menu offers and what each verb does to the filesystem — and this is the surface it draws
 * into: the reactive scope the document reads, the discriminant it switches on, and the mount that
 * stays put while the Navigator repaints around it.
 *
 * **The keyboard is the kit's now.** `jx-tree` owns the ARIA tree contract — the roving caret, the
 * arrows, `Home`/`End`, the two that open and close a directory, typeahead — and this adapter
 * carries the five events it answers with. What a row VIEW no longer says is the whole point: no
 * role, no `aria-level`, no set counts, no `tabindex`. `panel-outline.ts` was the second copy of
 * every one of those, and there was nothing keeping the two in agreement.
 *
 * **Four facts are scope fields rather than row fields, and that is the whole reason a drag no
 * longer rebuilds the list.** The current path, the selected path, the dragged path and the drop
 * target are each one value the document compares against `$map.item.path`, so changing any of them
 * re-evaluates one attribute per DRAWN row and leaves every node — and the caret — where it was.
 * The predecessor recomputed `classMap` for the whole tree on each of the four, which is what made
 * a drag-over highlight cost a repaint of the panel the drag was happening in.
 *
 * **The container is not cleared**, which is the one line where a panel differs from a settings
 * section. A section is handed the pane's whole content area and starts by emptying it; a panel
 * body is a node lit renders into, and its comment markers are how lit finds its own content again.
 * So the document is APPENDED, and {@link FilesPanelSurfaceHandle.connected} is how the flow finds
 * out that the Navigator has since painted another panel over the top of it.
 *
 * **Two islands, both through `onNodeCreated`.** The tree element is the window's scroller and the
 * project root's drop target; each row is a pragmatic-drag-and-drop source, and a directory row is
 * also a target. Neither is a thing a document can express, and neither may be re-found by selector
 * afterwards — a windowed list re-uses its nodes for different rows as it scrolls, so a query would
 * hand a registration to whichever file happens to be standing there now
 * (specs/studio-ui-guidelines.md §9.4).
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import filesPanelDoc from "./files-panel.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("files-panel", filesPanelDoc as unknown as JxDocument);

/**
 * One row the tree draws, with every field already a string.
 *
 * A row states what it IS and never what is currently true OF it: whether it is selected, being
 * dragged, under a drop or holding the caret are the four scope fields above, so this array only
 * changes when the model or the window does.
 */
export interface FileRowView {
  /** The reconcile key. A directory's own row and its "Loading…" placeholder name the same path. */
  key: string;
  /** The row's `value`: what every event it provokes reports, and what `currentPath` matches. */
  path: string;
  name: string;
  /** `directory` or `file` — what the drag island asks the row about. */
  type: string;
  /** Which of the two row shapes to draw: a `jx-tree-item`, or the placeholder that is not one. */
  kind: "item" | "loading";
  /** The `--depth` custom property the PLACEHOLDER's indent is computed from. */
  depth: string;
  /** `level`: the depth, one-based. The element writes `aria-level` and the indent from it. */
  level: string;
  posInSet: string;
  setSize: string;
  /** `"true"` / `"false"` for a directory; `""` for a file, which is a leaf and gets no twisty. */
  ariaExpanded: string;
  /** The kit icon name for the row's own glyph. */
  icon: string;
  localeState: "hidden" | "shown";
  /** The declared locale's name in its own language. */
  locale: string;
}

/** Everything the document draws, as one value. */
export interface FilesPanelValues {
  /** Which of three things the panel is: no project, a monorepo root, or a tree. */
  view: "none" | "welcome" | "tree";
  headerState: "hidden" | "shown";
  projectName: string;
  query: string;
  /** "Show ignored files" / "Hide ignored files" — the button's name AND its tooltip. */
  ignoredLabel: string;
  ignoredIcon: string;
  ignoredSelected: boolean;
  /** The two spacers, in pixels, reserving the scroll of the rows the window left out. */
  padTop: number;
  padBottom: number;
  rows: FileRowView[];
  /** The row the tree's cursor is on, or `""`. */
  selectedPath: string;
  /** The row the reader is dragging, or `""`. */
  dragPath: string;
  /** The row a drag is currently over, or `""`. */
  dropPath: string;
  /** `"true"` while a drag is over the tree background, which is the project root. */
  rootDrop: string;
  /**
   * The row the caret is on.
   *
   * A row the window did not draw is allowed here, which is the difference from the tab stop this
   * replaced: `jx-tree` falls back to the first DRAWN row for the tab stop and leaves `current`
   * alone, so a caret that has scrolled away is remembered rather than clamped.
   */
  currentPath: string;
}

/** What a control can ask the tree to do. Every one of them is a decision the flow owns. */
export interface FilesPanelActions {
  /** The welcome state's one verb — the declared `project.open` command. */
  openProject: () => void;
  newFile: () => void;
  refresh: () => void;
  toggleIgnored: () => void;
  search: (value: string) => void;
  /** A click, Enter or a double click on a row: expand that directory, or open that file. */
  activate: (path: string) => void;
  /** Right-click on a row, at the pointer. */
  contextMenu: (path: string, x: number, y: number) => void;
  /** The reader meant that row. Single-select, so every intent the element resolves is a replace. */
  select: (path: string) => void;
  /** A directory should be put into `expanded` — the twisty, `ArrowRight` or `ArrowLeft`. */
  expand: (path: string, expanded: boolean) => void;
  /**
   * The caret has to reach a row the window did not draw.
   *
   * The element knows only that the pad on that side is not zero; which row `key` means, and how
   * far to scroll to bring it into view, is a question about the MODEL and so is answered here.
   */
  move: (from: string, key: string) => void;
  /**
   * The tree element exists. The flow measures it — it is the only source of the window's geometry
   * — and hangs the project root's drop target off it.
   */
  treeHost: (element: HTMLElement) => void;
  /** One row element exists: a drag source, an external-file drop target, and a focus target. */
  rowHost: (element: HTMLElement, path: string, type: string) => void;
}

export interface FilesPanelSurfaceHandle {
  /**
   * Settles once the document is in the container, or at once if it was disposed first.
   *
   * The window needs it. A document is APPENDED when its mount resolves, so the tree element
   * announced through `onNodeCreated` is still detached — and a scroll watch armed against a
   * detached element resolves no scroller at all and is never armed again, because the first mount
   * is the one paint nothing else follows. The flow re-measures on this.
   */
  ready: Promise<void>;
  /** Bring the mounted document up to date with a whole projection. */
  update: (values: FilesPanelValues) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/** The scope the document reads: the projection, plus everything a control can ask for. */
interface FilesPanelScope extends Record<string, unknown>, FilesPanelValues, FilesPanelActions {}

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: FilesPanelScope, values: FilesPanelValues): void {
  scope.view = values.view;
  scope.headerState = values.headerState;
  scope.projectName = values.projectName;
  scope.query = values.query;
  scope.ignoredLabel = values.ignoredLabel;
  scope.ignoredIcon = values.ignoredIcon;
  scope.ignoredSelected = values.ignoredSelected;
  scope.padTop = values.padTop;
  scope.padBottom = values.padBottom;
  scope.rows = values.rows;
  scope.selectedPath = values.selectedPath;
  scope.dragPath = values.dragPath;
  scope.dropPath = values.dropPath;
  scope.rootDrop = values.rootDrop;
  scope.currentPath = values.currentPath;
}

/** The scope's starting shape, before the first projection lands on it. */
export function emptyFilesPanelValues(): FilesPanelValues {
  return {
    currentPath: "",
    dragPath: "",
    dropPath: "",
    headerState: "hidden",
    ignoredIcon: "eye-slash",
    ignoredLabel: "Show ignored files",
    ignoredSelected: false,
    padBottom: 0,
    padTop: 0,
    projectName: "",
    query: "",
    rootDrop: "",
    rows: [],
    selectedPath: "",
    view: "none",
  };
}

/** The `part` a node's definition carries, or `""` for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/** The mapped row a node was rendered inside, or null when it was not in one. */
function mappedRow(state: JxScope | undefined): FileRowView | null {
  const map = state?.["$map"] as { item?: unknown } | undefined;
  const item = map?.item as FileRowView | undefined;
  return typeof item?.path === "string" ? item : null;
}

/**
 * Mount the Files document into `container`, which is the `.panel-content` the Navigator painted.
 *
 * Nothing is called on the elements, so the mount is all this has to wait for: the two islands
 * announce themselves through `onNodeCreated` as their nodes are created, which is one
 * `connectedCallback` EARLIER than awaiting the element would be (guidelines §1.1).
 */
export function mountFilesPanelSurface(
  container: HTMLElement,
  values: FilesPanelValues,
  actions: FilesPanelActions,
): FilesPanelSurfaceHandle {
  const scope = reactive<FilesPanelScope>({
    ...emptyFilesPanelValues(),
    ...actions,
  }) as FilesPanelScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("files-panel", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      /* `disposed` FIRST, and it is not defensive. The mount is asynchronous and its nodes are
         created while it runs, so a panel taken down inside the same turn — the Navigator painting
         a second panel over this one — still walks this callback for every row. Without the guard
         the flow adopts rows of a document that is about to be thrown away, and the registrations
         it makes outlive it: `unmountFilesPanel` already ran, so nothing is left to take them
         back. */
      if (disposed || !(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "tree") {
        actions.treeHost(element);
        return;
      }
      /* `"row"` is the `jx-tree-item`, and the placeholder is `"loading-row"` — which is how the
         two are told apart now that they are different elements. A placeholder is not a drag source
         and not a drop target: there is no file there yet, and a registration against a node that
         is about to be replaced by the real listing would be one the flow could never take back. */
      if (part !== "row") {
        return;
      }
      const row = mappedRow(state);
      if (row) {
        actions.rowHost(element, row.path, row.type);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight there is nothing in the container to ask about, so the
       answer is simply whether this handle is still wanted — answering no would start a second
       mount racing the first. Once mounted, the question is whether the root is still where it was
       put: a Navigator that painted another panel cleared this document out from under it. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => {
      project(scope, next);
    },
  };
}
