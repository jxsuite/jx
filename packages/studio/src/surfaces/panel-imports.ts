/// <reference lib="dom" />
/**
 * The Packages panel, as a mounted document.
 *
 * `panels/imports-panel.ts` is the flow — it decides what a specifier means, which elements a
 * document already imports, what `bun` is asked to do and what a removal confirms — and this is the
 * surface it draws into: the reactive scope the document reads, the flags it discriminates on, and
 * the mount that stays put while the Navigator is repainted around it.
 *
 * **The flow tells the surface what a row says, never what it means.** A component row arrives as a
 * label, a tick and an `id` the flow minted; the surface never learns that the label is a tag name
 * or that the id is a package and an element joined. That matters more here than in the settings
 * sections, because the two arrays are NESTED: inside the per-element map `$map/item` is the
 * element, so a row genuinely cannot reach the package it is under, and an id it can hand straight
 * back is the whole answer.
 *
 * **Every draft field is an ECHO.** The lit template held the add form in `ref()` handles and read
 * the DOM at submit time, so clearing a field was a DOM write and always landed. A document binding
 * only writes when the SCOPE moves, so the flow states what each control now holds before it
 * decides anything: without that, emptying the name field after a successful add would be a write
 * of `""` over a scope that still said `""` — no change, no binding, and the added name left
 * sitting in the field. The component picker is the same story with a shorter fuse: it resets to
 * its own empty row after every pick, so picking the same component twice in a row is exactly the
 * case a binding that never moved would drop.
 *
 * **Keyed by host, not by module.** `afterRender` runs on every Navigator repaint, so the common
 * case is an UPDATE of a standing surface rather than a mount; a module-level handle would also be
 * wrong the moment a second dock draws this panel.
 *
 * @docs studio/projects/dependencies
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import importsDoc from "./panel-imports.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("panel-imports", importsDoc as unknown as JxDocument);

/** One imported module: the name a document refers to it by, and the path it is loaded from. */
export interface ModuleRow {
  name: string;
  path: string;
}

/** One component import, as the document-level list draws it. */
export interface RefRow {
  /** The `$ref` exactly as it is written in `$elements`. */
  ref: string;
}

/** One element of one npm package, with the tick beside it. */
export interface ComponentRow {
  /**
   * The flow's own handle on this element, returned verbatim when the box is toggled. Opaque here:
   * a nested row cannot see its package, so it carries whatever the flow needs to find it again.
   */
  id: string;
  /** What the row says — `<x-button>`, angle brackets and all. */
  label: string;
  enabled: boolean;
}

/** One npm package section. */
export interface PackageRow {
  name: string;
  /** Whether this section offers to uninstall the package. Only the project owns its packages. */
  canRemove: boolean;
  components: ComponentRow[];
}

/** One row of the component picker: a project component this document has not imported yet. */
export interface PickerOption {
  value: string;
  label: string;
}

/** What the panel shows — the flow's projection of the project and the open document. */
export interface ImportsView {
  /**
   * Which of the two moods the panel is in. `"site"` is `project.json` — imported modules and the
   * npm verbs; `"document"` is a page, layout or component — its `$ref` imports and the picker.
   */
  mode: "site" | "document";
  modules: ModuleRow[];
  refs: RefRow[];
  packages: PackageRow[];
  /** The two halves of the add-an-import draft, kept so a repaint cannot take them away. */
  addName: string;
  addPath: string;
  /** The package name being typed into Add Dependency. */
  addPackageValue: string;
  /** What the component picker currently shows. `""` is its own empty row, never a component. */
  pickerValue: string;
  /** The components this document could still import. Empty when there are none to offer. */
  pickerOptions: PickerOption[];
  /**
   * The sentence drawn where the `$ref` list would be. The flow chooses it: "pick one below" and
   * "this project has none yet" are two different absences, and only the flow knows which it is
   * looking at.
   */
  refEmptyMessage: string;
}

/** Everything the reader can do here. Each one is a decision the flow makes. */
export interface ImportsActions {
  /** State what the import-name field now holds, before anything is decided about it. */
  editName: (value: string) => void;
  /** State what the import-path field now holds. */
  editPath: (value: string) => void;
  /** Add the typed name/path pair to the project's imports. */
  addModule: () => void;
  removeModule: (name: string) => void;
  /** State what the Add Dependency field now holds. */
  editPackage: (value: string) => void;
  /** Install the typed package. */
  addPackage: () => void;
  removePackage: (name: string) => void;
  /** Turn one element of one package on or off for whatever this panel is about. */
  toggleComponent: (id: string, checked: boolean) => void;
  /** A pick from the component picker — including the empty row, which is a pick of nothing. */
  pick: (value: string) => void;
  removeRef: (ref: string) => void;
}

/** What the document discriminates on. Derived here, so the flow never has to spell it. */
interface ImportsFlags {
  moduleCount: number;
  refCount: number;
  /** Which body the module list draws: its teaching sentence, or the rows. */
  moduleState: "empty" | "listed";
  refState: "empty" | "listed";
  /** Whether there is anything left to pick, which is the whole of the picker's existence. */
  hasOptions: boolean;
}

interface ImportsScope extends Record<string, unknown>, ImportsView, ImportsActions, ImportsFlags {}

interface Mounted {
  scope: ImportsScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
}

const mounts = new WeakMap<HTMLElement, Mounted>();

/**
 * The picker's own empty row.
 *
 * A `<select>` always holds one of its options, so "nothing chosen yet" has to BE an option or the
 * control lies about what it holds — and the row is what the closed control reads as, which is why
 * it is worded as the invitation rather than as a blank.
 */
const PICK_NOTHING: PickerOption = { label: "Add component…", value: "" };

/** The view plus the flags the document switches on. */
function derive(view: ImportsView): ImportsView & ImportsFlags {
  return {
    ...view,
    hasOptions: view.pickerOptions.length > 0,
    moduleCount: view.modules.length,
    moduleState: view.modules.length === 0 ? "empty" : "listed",
    pickerOptions: [PICK_NOTHING, ...view.pickerOptions],
    refCount: view.refs.length,
    refState: view.refs.length === 0 ? "empty" : "listed",
  };
}

/**
 * Draw the panel into `host`, or bring the one already there up to date.
 *
 * A mount whose root has left the document is remade; one still standing is only assigned to. That
 * is what keeps the Navigator's repaint — which runs on every document edit, and calls this every
 * time — from rebuilding the list under the reader and taking the caret out of the field they are
 * typing into.
 *
 * @param {HTMLElement} host The panel's content area.
 * @param {ImportsView} view What to show.
 * @param {ImportsActions} actions What the reader may do — read once, when the surface is mounted.
 */
export function renderImportsSurface(
  host: HTMLElement,
  view: ImportsView,
  actions: ImportsActions,
): void {
  const existing = mounts.get(host);
  if (existing && (existing.handle === null || existing.handle.root.isConnected)) {
    Object.assign(existing.scope, derive(view));
    return;
  }
  existing?.handle?.dispose();
  host.textContent = "";
  const scope = reactive({ ...derive(view), ...actions }) as ImportsScope;
  const record: Mounted = { handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a redraw arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. And nothing is called on the element either, so the mount is all
     there is to wait for: the DOCUMENT is what this surface renders, and the kit elements inside it
     settle their own templates one `connectedCallback` later without anybody here asking them to.
     What a panel adds over a settings section is that its host can also be emptied by the DOCK —
     lit clears the content area when another panel draws into it — and that needs no arbitration
     either: the root goes with it, so the next `afterRender` sees a disconnected handle and remakes
     the surface through the branch above. */
  void mountSurface("panel-imports", scope, host).then((handle) => {
    record.handle = handle;
  });
}
