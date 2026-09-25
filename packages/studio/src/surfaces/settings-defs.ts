/// <reference lib="dom" />
/**
 * The Data Shapes surface: Project Settings › Data Shapes, as a Jx document over the kit.
 *
 * The adapter owns the MOUNT and the scope; `settings/defs-editor.ts` owns the decisions — what a
 * shape is, what a field may be renamed to, and what reaches `project.json`. The split is the one
 * `surfaces/settings-contexts.ts` draws: a reactive record of exactly what the document renders,
 * and a handle whose `update` writes a fresh projection into it. Nothing repaints; the row whose
 * type changed is the row that changes, and the field the reader is typing in keeps its caret.
 *
 * **Every list here is keyed by its name on disk, not by its position.** A rename is a key move and
 * a delete is a key removal, so the row a reader is editing survives every other row changing
 * around it — which is the whole of what the lit version's wholesale rebuild could not do.
 *
 * **Re-entrancy is the section's, not the host's.** A settings section is handed a container by
 * `panels/settings-pane.ts`, which may hand it the SAME container again (a nav click, an extension
 * registering, a command selecting an entry) and may in between give that container to a different
 * section, whose `litRender` replaces everything in it. So the handle can say whether what it
 * mounted is still there ({@link DefsSurfaceHandle.attached}), which is what lets the section
 * re-use one mount for the ordinary case and rebuild only when it has actually been evicted.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import defsDoc from "./settings-defs.json";

import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-defs", defsDoc as unknown as JxDocument);

/** One row of a picker: a field type, a format, or a reference target. */
export interface DefsChoice {
  value: string;
  label: string;
}

/** One data shape in the left column. */
export interface DefsShapeView {
  name: string;
  selected: boolean;
}

/**
 * One child of an `object` field. It carries its parent, because a nested `$map` has no other way
 * to name the field it is inside: `$map/item` is the child by the time the row is drawn.
 */
export interface NestedFieldView {
  parent: string;
  /** The property name on disk. The row's identity, and its `data-nested`. */
  key: string;
  /** What the name field holds, which is the key until the reader types something else. */
  name: string;
  type: string;
  format: string;
  /** Only `string` and `array` carry a format, so only they draw the picker. */
  hasFormat: boolean;
  required: boolean;
}

/** One field of the selected shape. */
export interface DefsFieldView {
  /** The property name on disk. The row's identity, and its `data-field`. */
  key: string;
  /** The name in words, as the row's caption. */
  label: string;
  name: string;
  type: string;
  format: string;
  hasFormat: boolean;
  required: boolean;
  /**
   * What the card draws under its row, as a `$switch` discriminant: a reference target, an object's
   * children, or nothing. `"reference"` means BOTH that the field is one and that there is
   * something to point at — a picker over an empty list is a control with no answers in it.
   */
  extra: "none" | "reference" | "nested";
  /** The content type this reference points at, without its `#/content/` prefix. */
  refTarget: string;
  children: NestedFieldView[];
  /** The nested add row's unsubmitted name, kept so an outside redraw does not take it away. */
  draftName: string;
  draftType: string;
}

/** Everything the document draws, as one value. */
export interface DefsView {
  shapes: DefsShapeView[];
  /** Whether the left column is offering the new-shape button or the form. */
  newState: "closed" | "open";
  newName: string;
  /** Whether the right column is editing a shape or saying that none is chosen. */
  editorState: "empty" | "editing";
  selected: string;
  fields: DefsFieldView[];
  typeOptions: DefsChoice[];
  formatOptions: DefsChoice[];
  /** The content types a reference field can point at. */
  targets: DefsChoice[];
  addState: "closed" | "open";
  addName: string;
  addType: string;
  addFormat: string;
  addRequired: boolean;
  addHasFormat: boolean;
}

/** What the reader can do here. Every one of them is a write the section decides and makes. */
export interface DefsActions {
  select: (name: string) => void;
  openNew: () => void;
  editNew: (value: string) => void;
  createNew: () => void;
  cancelNew: () => void;
  removeShape: () => void;
  renameField: (key: string, value: string) => void;
  setType: (key: string, value: string) => void;
  setFormat: (key: string, value: string) => void;
  setTarget: (key: string, value: string) => void;
  setRequired: (key: string, required: boolean) => void;
  removeField: (key: string) => void;
  renameNested: (parent: string, key: string, value: string) => void;
  setNestedType: (parent: string, key: string, value: string) => void;
  setNestedFormat: (parent: string, key: string, value: string) => void;
  setNestedRequired: (parent: string, key: string, required: boolean) => void;
  removeNested: (parent: string, key: string) => void;
  editDraftName: (parent: string, value: string) => void;
  editDraftType: (parent: string, value: string) => void;
  addNested: (parent: string) => void;
  openAdd: () => void;
  editAddName: (value: string) => void;
  editAddType: (value: string) => void;
  editAddFormat: (value: string) => void;
  editAddRequired: (required: boolean) => void;
  confirmAdd: () => void;
  cancelAdd: () => void;
}

export interface DefsSurfaceHandle {
  /** The container the document was mounted into. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host — see this module's header. */
  attached: () => boolean;
  update: (view: DefsView) => void;
  dispose: () => void;
}

interface DefsScope extends Record<string, unknown>, DefsView, DefsActions {}

/** The view a freshly mounted surface starts on: no shapes, and nothing chosen. */
function emptyView(): DefsView {
  return {
    addFormat: "",
    addHasFormat: true,
    addName: "",
    addRequired: false,
    addState: "closed",
    addType: "string",
    editorState: "empty",
    fields: [],
    formatOptions: [],
    newName: "",
    newState: "closed",
    selected: "",
    shapes: [],
    targets: [],
    typeOptions: [],
  };
}

/**
 * Mount the Data Shapes document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The settings pane's section body
 * @param {DefsActions} actions - What each control does
 * @returns {DefsSurfaceHandle}
 */
export function mountDefsSurface(host: HTMLElement, actions: DefsActions): DefsSurfaceHandle {
  host.textContent = "";
  const scope = reactive<DefsScope>({ ...emptyView(), ...actions }) as DefsScope;

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("settings-defs", scope, host).then((surface) => {
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
         a second synchronous render tear down the mount it is waiting for and start another. */
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    host,
    ready,
    update(view) {
      scope.addFormat = view.addFormat;
      scope.addHasFormat = view.addHasFormat;
      scope.addName = view.addName;
      scope.addRequired = view.addRequired;
      scope.addState = view.addState;
      scope.addType = view.addType;
      scope.editorState = view.editorState;
      scope.fields = view.fields;
      scope.formatOptions = view.formatOptions;
      scope.newName = view.newName;
      scope.newState = view.newState;
      scope.selected = view.selected;
      scope.shapes = view.shapes;
      scope.targets = view.targets;
      scope.typeOptions = view.typeOptions;
    },
  };
}
