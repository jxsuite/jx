/// <reference lib="dom" />
/**
 * Add new as a mounted document.
 *
 * `create/add-new-flow.ts` is the flow — it holds the kind, the name and the options, reads the
 * project into a `CreationContext`, lists the directories the result would write into, asks
 * `deriveCreation` what that is and `creationProblem` whether it may, and performs the write — and
 * this is the surface it draws into: the reactive scope the document reads, the few flags it
 * branches on, and the mount that lives in the dialog layer until the flow takes it down.
 *
 * **The flow states facts; the surface derives the flags.** Whether the name field is drawn,
 * whether the field is refused and whether the primary button can answer are each one comparison
 * over the view, so they are made here rather than handed in beside the facts they restate.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open. `whenReady` is shared with `surfaces/dialog.ts` rather than
 * reimplemented.
 *
 * @docs studio/projects/pages-layouts-components
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close, showModal } from "@jxsuite/ui/behaviors/dialog";
import { selectValue } from "@jxsuite/ui/behaviors/textfield";
import { whenReady } from "./dialog";
import addNewDoc from "./add-new.json";
import type { CreationKind } from "../create/add-new";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("add-new", addNewDoc);

/** One kind in the left-hand list. */
export interface AddNewKindRow {
  id: CreationKind;
  label: string;
  hint: string;
  icon: string;
  /** `"true"` for the chosen kind: the row is one radio of a radiogroup. */
  checked: "true" | "false";
}

/** One card in a Start from / Wrap it in radiogroup. */
export interface AddNewChoiceRow {
  value: string;
  label: string;
  /** The muted second line: "header + footer", "mostly writing", "2 elements". */
  note: string;
  checked: "true" | "false";
  /** A choice that cannot be made now stays in the group, disabled, with `reason` as its tip. */
  disabled: boolean;
  reason: string;
}

/** One field preset chip. */
export interface AddNewPresetRow {
  id: string;
  label: string;
  selected: boolean;
  icon: string;
}

/** What the flow knows. Every one of these may change while the dialog is up. */
export interface AddNewView {
  kind: CreationKind;
  kinds: AddNewKindRow[];
  /** The chosen kind's label, which names the detail region. */
  kindLabel: string;
  /** The sentence that introduces the chosen kind. */
  kindHint: string;
  /** Where the dialog can be opened from, said once at the foot of the list. */
  chordNote: string;
  nameLabel: string;
  name: string;
  placeholder: string;
  /** The refusal under the name field; `""` until the reader has typed, and when there is none. */
  error: string;
  /** The derived result: "Saved as pages/pricing.json · opens at /pricing". */
  saved: string;
  /** The primary button's words. */
  cta: string;
  /** Whether the primary button can answer now. */
  canConfirm: boolean;

  // ── page ──────────────────────────────────────────────────────────────────
  route: string;
  editingUrl: boolean;
  url: string;
  startChoices: AddNewChoiceRow[];

  // ── collection ────────────────────────────────────────────────────────────
  itemNoun: string;
  presets: AddNewPresetRow[];
  ownPage: boolean;
  pattern: string;
  templateOptions: SurfaceOption[];
  pageTemplate: string;

  // ── template ──────────────────────────────────────────────────────────────
  wrapChoices: AddNewChoiceRow[];

  // ── component ─────────────────────────────────────────────────────────────
  componentChoices: AddNewChoiceRow[];
  copying: boolean;
  copyOptions: SurfaceOption[];
  copyOf: string;

  // ── entry ─────────────────────────────────────────────────────────────────
  collectionOptions: SurfaceOption[];
  collection: string;

  // ── media ─────────────────────────────────────────────────────────────────
  dropActive: "true" | "false";
  uploadAccept: string;
  fileSummary: string;
}

/** What the document can tell the flow. */
export interface AddNewActions {
  pickKind: (kind: CreationKind) => void;
  setName: (value: string) => void;
  /** The primary button, or Enter in a field. The flow decides whether that creates anything. */
  confirm: () => void;
  toggleUrl: () => void;
  setUrl: (value: string) => void;
  pickStart: (value: string) => void;
  togglePreset: (id: string) => void;
  setOwnPage: (checked: boolean) => void;
  pickPageTemplate: (value: string) => void;
  pickWrap: (value: string) => void;
  pickComponentStart: (value: string) => void;
  pickCopy: (value: string) => void;
  pickCollection: (value: string) => void;
  /**
   * The file picker settled. The ELEMENT rather than its list, because a file input that is not
   * cleared refuses the same file twice, and the input is this document's own control.
   */
  choose: (input: HTMLInputElement) => void;
  drop: (files: FileList | null) => void;
  dragOver: () => void;
  dragOut: () => void;
  /** The dialog closed, for any reason the platform owns as well as the flow's own `close`. */
  closed: () => void;
}

export interface AddNewSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  view: AddNewView;
  actions: AddNewActions;
}

export interface AddNewSurfaceHandle {
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: AddNewView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document branches on. Derived, never handed in. */
interface AddNewFlags {
  /** Every kind but Media has a name. */
  named: boolean;
  invalid: boolean;
  blocked: boolean;
}

type AddNewScope = AddNewView &
  AddNewFlags &
  Omit<AddNewActions, "setName" | "closed"> & {
    setName: (value: string) => void;
    closed: () => void;
  };

/** The view plus the flags the document renders from. */
function derive(view: AddNewView): AddNewView & AddNewFlags {
  return {
    ...view,
    blocked: !view.canConfirm,
    invalid: view.error !== "",
    named: view.kind !== "media",
  };
}

/** Open the dialog. The handle's `ready` resolves once it is showing. */
export function openAddNewSurface(options: AddNewSurfaceOptions): AddNewSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "add-new"));
  options.layer.append(slot);

  let closed = false;
  /** Say it is over, once: the platform's own `close` and `close()` may each be first. */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.actions.closed();
  };
  const isClosed = (): boolean => closed;

  const { actions } = options;
  const scope: AddNewScope = reactive<AddNewScope>({
    ...derive(options.view),
    choose: actions.choose,
    closed: finish,
    confirm: actions.confirm,
    dragOut: actions.dragOut,
    dragOver: actions.dragOver,
    drop: actions.drop,
    pickCollection: actions.pickCollection,
    pickComponentStart: actions.pickComponentStart,
    pickCopy: actions.pickCopy,
    pickKind: actions.pickKind,
    pickPageTemplate: actions.pickPageTemplate,
    pickStart: actions.pickStart,
    pickWrap: actions.pickWrap,
    setName: (value: string) => {
      /* What the control holds, first and unconditionally. A binding only writes when the scope
         CHANGES, so a surface that did not echo the raw value would leave the field showing text
         the scope does not have (`studio-ui-guidelines.md` §9.3). */
      scope.name = value;
      actions.setName(value);
    },
    setOwnPage: actions.setOwnPage,
    setUrl: (value: string) => {
      scope.url = value;
      actions.setUrl(value);
    },
    toggleUrl: actions.toggleUrl,
    togglePreset: actions.togglePreset,
  });

  let mounted: SurfaceHandle | null = null;

  /**
   * Put the caret in the name field, selected.
   *
   * On open only: the name is the only thing the dialog requires, so it is where the reader is
   * about to type. A focus move is the one thing a surface may reach into its document for (`ui.md`
   * §2 rule 5).
   */
  const focusName = (): void => {
    setTimeout(() => {
      const root = mounted?.root;
      if (closed || !(root instanceof HTMLElement)) {
        return;
      }
      const control = root.querySelector<HTMLElement>('jx-textfield[part="name"]');
      if (control) {
        selectValue(control, "all");
      }
    }, 0);
  };

  const ready = mountSurface("add-new", scope, slot).then(async (surface) => {
    mounted = surface;
    /* SAFETY: `add-new.json`'s root definition is a `jx-dialog` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    const element = surface.root as HTMLElement;
    if (isClosed()) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (isClosed()) {
      return element;
    }
    showModal(element);
    if (scope.named) {
      focusName();
    }
    return element;
  });

  return {
    close() {
      /* Idempotent line by line rather than guarded on `closed`: the platform's own `close` runs
         `finish()` first, and a guard would leave this slot behind in the layer. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        close(element);
      }
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      /* Never a focus move here. A kind switch from the keyboard is an arrow key inside the kinds
         radiogroup, and pulling the caret into the name field would end the walk after one step;
         the name keeps its value across kinds and Tab reaches it next. */
      Object.assign(scope, derive(view));
    },
  };
}
