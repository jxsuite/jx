/// <reference lib="dom" />
/**
 * The Repeat… dialog as a mounted document.
 *
 * `editor/convert-to-repeater.ts` is the flow — it works out which state definitions hold arrays
 * (including the plugin ones whose schema says so), keeps the answer the reader is assembling,
 * refuses a name it cannot mint and writes the repeater into the document — and this is the surface
 * it draws into: the reactive scope the document reads, the two things it branches on, and the
 * mount that lives in the dialog layer until the flow takes it down.
 *
 * **The flow states names; the surface derives the rows.** `sources` and `functions` are lists of
 * state-definition names, and the two rows that are NOT definitions are this module's: the `Create
 * new…` sentinel that reveals the name field, and the `None` row that clears an optional function.
 * Both are affordances of the picker rather than facts about the document, so a flow that grew a
 * third source of names would still not have to know about either.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` and `surfaces/add-repo.ts` rather than reimplemented.
 *
 * @docs studio/design/repeaters
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { selectValue } from "@jxsuite/ui/behaviors/textfield";
import { whenReady } from "./dialog";
import convertRepeaterDoc from "./convert-repeater.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("convert-repeater", convertRepeaterDoc as unknown as JxDocument);

/**
 * The items-source row that is not a definition: pick it and the dialog asks for a name instead.
 *
 * Exported because the flow has to recognise it — it is the one source whose confirmation mints
 * something — but it is minted HERE, so there is one spelling of it rather than two.
 */
export const CREATE_NEW_SOURCE = "__new__";

/** One row of either picker. */
export interface ConvertRepeaterOption {
  value: string;
  label: string;
}

/** What the flow knows. Every one of these may change while the dialog is up. */
export interface ConvertRepeaterView {
  /** State definitions that hold an array, in the order they were found. */
  sources: string[];
  /** The chosen source: a definition's name, or {@link CREATE_NEW_SOURCE}. */
  source: string;
  /** State definitions that are functions, offered as the filter and the sort. */
  functions: string[];
  /** The chosen filter, or `""` for none. */
  filter: string;
  /** The chosen sort, or `""` for none. */
  sort: string;
  /** What the reader has typed for a definition that does not exist yet. */
  newName: string;
  /** The refusal under the name field, or `""` when there is nothing to say. */
  error: string;
}

export interface ConvertRepeaterSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before the reader has touched anything: the flow's own view. */
  view: ConvertRepeaterView;
  /** A source row was picked. */
  onPickSource: (value: string) => void;
  /** The reader typed a name for the definition to be created. */
  onName: (value: string) => void;
  onPickFilter: (value: string) => void;
  onPickSort: (value: string) => void;
  /** Create Repeater, or Enter in the name field. The flow decides whether that closes anything. */
  onConfirm: () => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface ConvertRepeaterSurfaceHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: ConvertRepeaterView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on, and the rows it maps. Derived, never handed in. */
interface ConvertRepeaterFlags {
  /** The source picker's rows: every array definition, then `Create new…`. */
  sourceOptions: ConvertRepeaterOption[];
  /** The filter and sort pickers' rows: `None`, then every function definition. */
  functionOptions: ConvertRepeaterOption[];
  /** The chosen source is the sentinel, so the name field is drawn. */
  creating: boolean;
  /** There is at least one function to offer, so the two optional rows are drawn. */
  hasFunctions: boolean;
  /** The name is refused, which the row and the field both draw. */
  invalid: boolean;
}

interface ConvertRepeaterScope
  extends Record<string, unknown>, ConvertRepeaterView, ConvertRepeaterFlags {
  pickSource: (value: string) => void;
  setName: (value: string) => void;
  pickFilter: (value: string) => void;
  pickSort: (value: string) => void;
  confirm: () => void;
  closed: () => void;
}

/** The view plus the rows and flags the document renders from. */
function derive(view: ConvertRepeaterView): ConvertRepeaterView & ConvertRepeaterFlags {
  return {
    ...view,
    creating: view.source === CREATE_NEW_SOURCE,
    functionOptions: [
      { label: "None", value: "" },
      ...view.functions.map((name) => ({ label: name, value: name })),
    ],
    hasFunctions: view.functions.length > 0,
    invalid: view.error !== "",
    sourceOptions: [
      ...view.sources.map((name) => ({ label: name, value: name })),
      { label: "Create new…", value: CREATE_NEW_SOURCE },
    ],
  };
}

/** Open the dialog. The handle's `ready` resolves once it is showing. */
export function openConvertRepeaterSurface(
  options: ConvertRepeaterSurfaceOptions,
): ConvertRepeaterSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", "convert-repeater"));
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive({
    ...derive(options.view),
    closed: finish,
    confirm: () => {
      options.onConfirm();
    },
    pickFilter: (value: string) => {
      scope.filter = value;
      options.onPickFilter(value);
    },
    pickSort: (value: string) => {
      scope.sort = value;
      options.onPickSort(value);
    },
    pickSource: (value: string) => {
      scope.source = value;
      options.onPickSource(value);
    },
    setName: (value: string) => {
      /* What the control holds, first and unconditionally. A binding only writes when the scope
         CHANGES, so a surface that refused a value without announcing the raw one would leave the
         field showing text the scope does not have (§9.3). The refusal here is a sentence UNDER the
         field rather than a rewrite of it, but the echo is what keeps that true of the next one. */
      scope.newName = value;
      options.onName(value);
    },
  }) as ConvertRepeaterScope;

  let mounted: SurfaceHandle | null = null;

  /**
   * Put the caret in the name field.
   *
   * Called when the field is first drawn and whenever the picker reveals it, because a field that
   * appears in answer to a pick is the thing the reader is about to type into. `selectValue` is the
   * kit's own behaviour: a focus move is the one thing a surface may reach into its document for
   * (`ui.md` §2 rule 5), and this is the whole of what the lit version's `ref` callback did.
   */
  const focusName = (): void => {
    setTimeout(() => {
      const field = mounted?.root;
      if (closed || !(field instanceof HTMLElement)) {
        return;
      }
      const control = field.querySelector<HTMLElement>('jx-textfield[part="new-name"]');
      if (control) {
        selectValue(control, "all");
      }
    }, 0);
  };

  const ready = mountSurface("convert-repeater", scope, slot).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    showModal(element);
    if (scope.creating) {
      focusName();
    }
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the dialog down and
         leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      const next = derive(view);
      const revealed = next.creating && !scope.creating;
      /* A live region announces a CHANGE, and the reactive write is skipped when the value is
         equal, so refusing the SAME thing twice — pressing Create Repeater again on a blank name,
         which is the ordinary way to meet a refusal — wrote nothing and said nothing. Cleared
         first, on its own turn, so the second refusal is a change like the first. `announce.ts`
         states the same rule for Studio's own regions, and `surfaces/dialog.ts` for the prompt. */
      const repeated = next.error !== "" && next.error === scope.error;
      Object.assign(scope, repeated ? { ...next, error: "" } : next);
      if (repeated) {
        const again = next.error;
        queueMicrotask(() => {
          scope.error = again;
        });
      }
      if (revealed) {
        focusName();
      }
    },
  };
}
