/// <reference lib="dom" />
/**
 * The dialog surface: Studio's confirm, save-or-discard and prompt dialogs as ONE document over the
 * kit's `jx-dialog`, mounted into the dialog layer and opened modally.
 *
 * This is the adapter. `ui/layers.ts` keeps the three flows' signatures and their state machines —
 * which answer resolves what, when a prompt's value is refused — and hands this module a
 * projection: the labels, a sentence, a choice's options and which of them is chosen, a field's
 * value with its refusal. The document renders that; the platform's `<dialog>` owns modality, focus
 * restoration, Escape and `closedby`; and nothing here binds a document listener or traps Tab,
 * because a modal dialog makes the rest of the page inert by itself.
 *
 * The choice is the kit's `jx-select`, which is a native `<select>` under `appearance:
 * base-select`. Nothing here marks a row as selected: the element takes the chosen VALUE and its
 * sidecar keeps the control on it, which is the one spelling that survives a real pick.
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

/**
 * One option of a prompt's choice.
 *
 * There is no `selected` here, and its absence is the contract rather than an omission: `jx-select`
 * is a native `<select>`, and the reader's first pick sets an option's dirtiness flag, after which
 * the `selected` content attribute stops moving selectedness (`ui.md` §5.1). A projection that
 * marked a row would be right until the first pick and wrong after it. The chosen row is named by
 * `chosen`, once, beside the list.
 */
export interface DialogChoiceOption {
  value: string;
  label: string;
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
  /** A `jx-select` above the field, and which of its rows is chosen. */
  choice?: { label: string; options: DialogChoiceOption[]; chosen: string };
  /** The prompt's field. */
  field?: {
    value: string;
    placeholder: string;
    select: "all" | "stem" | "none";
    /** A paste box rather than a line. Enter then means a newline, not confirm. */
    multiline?: boolean;
    /** How many lines a multiline field opens at. */
    rows?: string;
    /** Monospaced, for a format whose columns line up. */
    mono?: boolean;
  };
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
  /**
   * The buttons' text, which a multi-phase dialog moves through.
   *
   * A push is a confirm whose answer changes as it runs — Cancel then Apply then Close — and the
   * alternative to patching them is closing one dialog and opening another between phases, which
   * takes the reader's focus with it every time.
   */
  confirmLabel?: string;
  cancelLabel?: string;
  /** The sentence under the headline. Cleared by the empty string. */
  message?: string;
  value?: string;
  placeholder?: string;
  invalid?: boolean;
  error?: string;
  options?: DialogChoiceOption[];
  chosen?: string;
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
  multiline: boolean;
  rows: string;
  mono: boolean;
  /** `hasField && !multiline` — whether Enter confirms. A word, because a document switches. */
  singleLine: string;
  /** The chosen row's value, which is the only thing that decides what the select shows. */
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

/**
 * Wait for the element's OWN `jx-ready`, or return at once when it has already rendered.
 *
 * The target check is load-bearing rather than defensive: `jx-ready` BUBBLES, and four kit elements
 * announce themselves with it — `jx-tabs`, `jx-menu`, `jx-popover` and `jx-action-group`. A dialog
 * whose body contains any of them was therefore told it was ready by a descendant, one microtask
 * before its own template existed, and everything the caller does with that answer — stamping the
 * screenshot region on `dialog[part="dialog"]`, calling `showModal()` — found no `<dialog>` and
 * silently did nothing: the body was all there, correctly styled, and never shown. The wizard in
 * `surfaces/new-project.json` is the first document to put a tab strip inside a dialog, which is
 * why this only surfaced now.
 */
export function whenReady(element: HTMLElement): Promise<HTMLElement> {
  if (element.querySelector('[part="dialog"]')) {
    return Promise.resolve(element);
  }
  return new Promise((resolve) => {
    element.addEventListener("jx-ready", function ready(event: Event) {
      if (event.target !== element && !element.querySelector('[part="dialog"]')) {
        return;
      }
      element.removeEventListener("jx-ready", ready);
      resolve(element);
    });
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

  const scope = reactive<DialogScope>({
    cancel: () => {
      options.onCancel();
    },
    cancelLabel: options.cancelLabel,
    choiceLabel: options.choice?.label ?? "",
    chosen: options.choice?.chosen ?? "",
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
    mono: options.field?.mono === true,
    multiline: options.field?.multiline === true,
    rows: options.field?.rows ?? "3",
    singleLine: options.field !== undefined && options.field.multiline !== true ? "true" : "false",
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
      if (patch.confirmLabel !== undefined) {
        scope.confirmLabel = patch.confirmLabel;
      }
      if (patch.cancelLabel !== undefined) {
        scope.cancelLabel = patch.cancelLabel;
      }
      if (patch.message !== undefined) {
        scope.message = patch.message;
        scope.hasMessage = patch.message !== "";
      }
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
      }
      if (patch.chosen !== undefined) {
        /* Written straight through, in any order relative to the list. It used to be deferred a
           microtask so the option the value names would exist by the time it landed — the ordering
           trap of a bare `value` binding on a `<select>`. `jx-select` owns that now: its sidecar
           re-asserts selectedness whenever the option list changes, and stands in a row for a value
           no option holds, so neither this module nor its caller sequences the two. */
        scope.chosen = patch.chosen;
      }
    },
  };
}
