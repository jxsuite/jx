/// <reference lib="dom" />
/**
 * The `schema-builder` form control as a mounted document.
 *
 * `ui/form-controls.ts` is the flow — it holds the ephemeral state (which add form is open, what
 * each object's add row has been typed into, which control has parted from the value), decides what
 * a field may be renamed to, and turns every gesture into one commit of the whole schema object —
 * and this is the surface it draws into. Nothing here reads a schema: the scope is a list of
 * already-classified rows.
 *
 * **The host belongs to the caller here, unlike every other leaf in this batch.** A registered
 * control is drawn into the empty `[part="control-host"]` that `surfaces/schema-form.json` already
 * announces for its field (`ui/schema-form.ts`'s `paintControl`), so there is a container to mount
 * into and no need for a `display: contents` wrapper of our own. That host is the whole reason this
 * conversion was possible: a document CLEARS the host it is given, and the form's own document
 * gives this one a node nothing else writes to.
 *
 * **The row vocabulary is `surfaces/settings-defs.ts`'s, imported rather than restated.** Project
 * Settings › Data Shapes edits the project's `$defs` and this edits a content type's `schema`, and
 * they are the same object drawn with the same six controls per row — so the two documents are the
 * same card inside a different shell, and the views are one set of types. A second declaration of
 * {@link DefsFieldView} would be the point at which the two cards start to drift, one field at a
 * time, with nothing failing.
 *
 * @docs studio/data/tables
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import builderDoc from "./schema-builder.json";

import type { SurfaceHandle, SurfaceOption } from "../ui/surface";
import type { DefsFieldView } from "./settings-defs";

registerSurface("schema-builder", builderDoc);

/** Everything the document draws, as one value. */
export interface SchemaBuilderView {
  fields: DefsFieldView[];
  typeOptions: SurfaceOption[];
  formatOptions: SurfaceOption[];
  /** The content types a reference field can point at. Empty draws no target picker. */
  targets: SurfaceOption[];
  /** Whether the foot of the list is offering the add button or the add form. */
  addState: "closed" | "open";
  addName: string;
  addType: string;
  addFormat: string;
  addRequired: boolean;
  addHasFormat: boolean;
}

/** What the reader can do here. Every one of them is a write the flow decides and makes. */
export interface SchemaBuilderActions {
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

export interface SchemaBuilderSurfaceHandle {
  /** The container the document was mounted into — the form's own control host. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  update: (view: SchemaBuilderView) => void;
  dispose: () => void;
}

interface BuilderScope extends SchemaBuilderView, SchemaBuilderActions {}

/** The view a freshly mounted surface starts on: no fields, and no add form. */
function emptyView(): SchemaBuilderView {
  return {
    addFormat: "",
    addHasFormat: true,
    addName: "",
    addRequired: false,
    addState: "closed",
    addType: "string",
    fields: [],
    formatOptions: [],
    targets: [],
    typeOptions: [],
  };
}

/**
 * Mount the schema-builder document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The form's `[part="control-host"]` for this field
 * @param {SchemaBuilderActions} actions - What each control does
 * @returns {SchemaBuilderSurfaceHandle}
 */
export function mountSchemaBuilderSurface(
  host: HTMLElement,
  actions: SchemaBuilderActions,
): SchemaBuilderSurfaceHandle {
  host.textContent = "";
  const scope: BuilderScope = reactive<BuilderScope>({ ...emptyView(), ...actions });

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = true;
  let disposed = false;

  const mount = (): Promise<HTMLElement> =>
    mountSurface("schema-builder", scope, host).then((mounted) => {
      /* SAFETY: `schema-builder.json`'s root definition carries `tagName: "div"`, so the runtime
         mounts an HTMLElement; a `Text` root only comes from a document whose root is a bare
         string. */
      const root = mounted.root as HTMLElement;
      mounting = false;
      if (disposed) {
        mounted.dispose();
        return root;
      }
      handle = mounted;
      return root;
    });

  const ready = mount();

  return {
    dispose() {
      disposed = true;
      handle?.dispose();
      handle = null;
      host.textContent = "";
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
      scope.fields = view.fields;
      scope.formatOptions = view.formatOptions;
      scope.targets = view.targets;
      scope.typeOptions = view.typeOptions;
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the form around it
         would empty the field the reader is typing in. The remount below answers the one case
         assignment cannot — a host the document has been taken out of — and it cannot fire while a
         mount is in flight, because a record with no handle yet IS the standing one. */
      if (disposed || mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      mounting = true;
      host.textContent = "";
      void mount();
    },
  };
}
