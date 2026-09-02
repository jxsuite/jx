/// <reference lib="dom" />
/**
 * The dialog surface: Studio's confirm, save-or-discard and prompt dialogs as ONE document over the
 * kit's `jx-dialog`, mounted into the dialog layer and opened modally.
 *
 * This is the adapter. `ui/layers.ts` keeps the three flows' signatures and their state machines —
 * which answer resolves what, when a prompt's value is refused — and hands this module a
 * projection: the labels, a sentence, a choice's options with the chosen one marked, a field's
 * value with its refusal. The document renders that; the platform's `<dialog>` owns modality, focus
 * restoration, Escape and `closedby`; and nothing here binds a document listener or traps Tab,
 * because a modal dialog makes the rest of the page inert by itself.
 *
 * A message that is a lit template (three callers still pass one) is rendered by the caller into
 * the document's `[part="island"]` through {@link DialogSurfaceOptions.island}, which is the island
 * rule of studio-ui-guidelines §9.4: the decision stays with the host, the markup around it is the
 * document's.
 *
 * @docs studio/interface
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { selectValue } from "@jxsuite/ui/behaviors/textfield";
import dialogDoc from "./dialog.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("dialog", dialogDoc as unknown as JxDocument);

/** One option of a prompt's choice, with the chosen one marked. */
export interface DialogChoiceOption {
  value: string;
  label: string;
  selected: boolean;
}

/** What a flow hands the surface. Everything is a projection; the flow keeps the state machine. */
export interface DialogSurfaceOptions {
  /** The dialog layer host, handed in so this module never reaches back into `layers.ts`. */
  layer: HTMLElement;
  headline: string;
  confirmLabel: string;
  secondaryLabel?: string;
  cancelLabel: string;
  destructive?: boolean;
  size?: "sm" | "md" | "lg";
  /** A sentence under the headline. */
  message?: string;
  /** Render a richer body into the document's island, once the element is ready. */
  island?: (host: HTMLElement) => void;
  /** A native select above the field. */
  choice?: { label: string; options: DialogChoiceOption[] };
  /** The prompt's field. */
  field?: { value: string; placeholder: string; select: "all" | "stem" | "none" };
  region?: string;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
  /** The dialog closed for any reason, the platform's `close` included. */
  onClosed: () => void;
  onInput?: (value: string) => void;
  onPick?: (value: string) => void;
}

/** What a flow may change while the dialog is up. */
export interface DialogSurfacePatch {
  value?: string;
  placeholder?: string;
  invalid?: boolean;
  error?: string;
  options?: DialogChoiceOption[];
}

export interface DialogSurfaceHandle {
  /** The slot in the dialog layer that carries the region. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  update: (patch: DialogSurfacePatch) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

interface DialogScope extends Record<string, unknown> {
  headline: string;
  confirmLabel: string;
  secondaryLabel: string;
  cancelLabel: string;
  destructive: boolean;
  size: string;
  message: string;
  hasMessage: boolean;
  hasChoice: boolean;
  choiceLabel: string;
  options: DialogChoiceOption[];
  hasField: boolean;
  /**
   * The chosen option's value, so the select's own value follows a patch as well as its options'
   * marks.
   */
  chosen: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  error: string;
  confirm: () => void;
  secondary: () => void;
  cancel: () => void;
  closed: () => void;
  input: (value: string) => void;
  pick: (value: string) => void;
}

/** Wait for the element's `jx-ready`, or return at once when it has already rendered. */
export function whenReady(element: HTMLElement): Promise<HTMLElement> {
  if (element.querySelector('[part="dialog"]')) {
    return Promise.resolve(element);
  }
  return new Promise((resolve) => {
    element.addEventListener("jx-ready", () => resolve(element), { once: true });
  });
}

/**
 * Open one dialog. The returned handle's `ready` resolves once the dialog is showing; `close` takes
 * it down. Every answer arrives through the options' callbacks, and the flow that owns the state
 * machine decides which of them closes the dialog.
 */
export function openDialogSurface(options: DialogSurfaceOptions): DialogSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it to the app when nothing is
     up, and every slot in it turns them back on for its own content. `pointer-events` INHERITS,
     and the top layer changes paint order rather than inheritance, so a modal `<dialog>` in a slot
     that skipped this is painted above everything and hit-tests to nothing: the reader sees the
     dialog, and the mouse goes straight through it to the page behind. The keyboard still works,
     which is what makes it easy to miss — and a synthetic `.click()` bypasses hit-testing, which
     is what makes it easy to miss in a test too. */
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion("dialog", options.region));
  options.layer.append(slot);

  const chosenOf = (choices: DialogChoiceOption[]) =>
    choices.find((choice) => choice.selected)?.value ?? "";
  const scope = reactive<DialogScope>({
    cancel: () => {
      options.onCancel();
    },
    cancelLabel: options.cancelLabel,
    choiceLabel: options.choice?.label ?? "",
    chosen: chosenOf(options.choice?.options ?? []),
    closed: () => {
      options.onClosed();
    },
    confirm: () => {
      options.onConfirm();
    },
    confirmLabel: options.confirmLabel,
    destructive: options.destructive === true,
    error: "",
    hasChoice: options.choice !== undefined,
    hasField: options.field !== undefined,
    hasMessage: options.message !== undefined && options.message !== "",
    headline: options.headline,
    input: (value) => {
      scope.value = value;
      options.onInput?.(value);
    },
    invalid: false,
    message: options.message ?? "",
    options: options.choice?.options ?? [],
    pick: (value) => {
      options.onPick?.(value);
    },
    placeholder: options.field?.placeholder ?? "",
    secondary: () => {
      options.onSecondary?.();
    },
    secondaryLabel: options.secondaryLabel ?? "",
    size: options.size ?? "sm",
    value: options.field?.value ?? "",
  }) as DialogScope;

  let handle: SurfaceHandle | null = null;
  let closed = false;
  /* Closing while the element is still rendering must not leave `ready` waiting on a `jx-ready`
     a disposed element will never send, so the wait races against the close. */
  let abort: () => void = () => {};
  const aborted = new Promise<void>((resolve) => {
    abort = resolve;
  });
  const mounted = mountSurface("dialog", scope, slot);
  const ready = mounted.then(async (surface) => {
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    handle = surface;
    await Promise.race([whenReady(element), aborted]);
    if (closed) {
      return element;
    }
    options.island?.(element.querySelector<HTMLElement>('[part="island"]') ?? element);
    showModal(element);
    if (options.field) {
      const field = element.querySelector<HTMLElement>("jx-textfield");
      if (field) {
        // After the platform's own focusing, which lands on the first focusable control.
        setTimeout(() => {
          if (!closed) {
            selectValue(field, options.field?.select ?? "all");
          }
        }, 0);
      }
    }
    return element;
  });

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      abort();
      const element = handle?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it was; then the document goes.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does.
      handle?.dispose();
      handle = null;
      slot.remove();
    },
    host: slot,
    ready,
    update(patch) {
      if (patch.value !== undefined) {
        scope.value = patch.value;
      }
      if (patch.placeholder !== undefined) {
        scope.placeholder = patch.placeholder;
      }
      if (patch.invalid !== undefined) {
        scope.invalid = patch.invalid;
      }
      if (patch.error !== undefined) {
        /* A live region announces a CHANGE, and the reactive write is skipped when the value is
           equal, so refusing the same value twice — pressing confirm again on a blank field, which
           is the ordinary way to meet a refusal — wrote nothing and said nothing. Cleared first, on
           its own turn, so the second refusal is a change like the first. `announce.ts` states the
           same rule for Studio's own regions. */
        if (patch.error !== "" && patch.error === scope.error) {
          scope.error = "";
          const repeated = patch.error;
          queueMicrotask(() => {
            scope.error = repeated;
          });
        } else {
          scope.error = patch.error;
        }
      }
      if (patch.options !== undefined) {
        scope.options = patch.options;
        // After the keyed rows reconcile (a microtask), so the option the value names exists.
        const chosen = chosenOf(patch.options);
        queueMicrotask(() => {
          scope.chosen = chosen;
        });
      }
    },
  };
}
