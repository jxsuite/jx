/// <reference lib="dom" />
/**
 * The overlay layers — the only sanctioned way to open a popover, modal, dialog or toast in Studio.
 *
 * Everything renders into one of the four fixed hosts declared in index.html (#layer-popover,
 * #layer-modal, #layer-dialog, #layer-toast), bound once at boot by initLayers(). Native browser
 * dialogs (`prompt`, `confirm`, `alert`) are not permitted anywhere in Studio — use
 * `showPromptDialog`, `showConfirmDialog`, or `showSaveDiscardDialog`. See studio-ui-guidelines.md
 * §8.7.
 *
 * The toast host is the fourth layer (plan §3.2 ④, §7.1). It is a rendering of
 * `services/notify.ts`'s `toasts` array and owns exactly two things that array does not: the timer
 * that retires a resting toast, and the transition account {@link overlayIdleBlockers} publishes.
 */
import { render as litRender, nothing } from "lit-html";
import { overlayRegion, REGION_ATTR } from "./regions";
import { openDialogSurface } from "../surfaces/dialog";
import { mountSurface, registerSurface } from "./surface";
import toastsDoc from "../surfaces/toasts.json";
import { dismiss, toasts } from "../services/notify";
import { activeRegistry } from "../commands/active-registry";
import { effect, effectScope, reactive } from "../reactivity";
import type { DialogChoiceOption, DialogSurfaceOptions } from "../surfaces/dialog";
import type { Notification, Severity } from "../services/notify";
import type { EffectScope } from "@vue/reactivity";
import type { SurfaceHandle } from "./surface";
import type { JxDocument } from "@jxsuite/schema/types";
import type { TemplateResult } from "lit-html";

/** The four fixed layer hosts, by name. Also the `kind` half of every overlay region id. */
export type LayerKind = "popover" | "modal" | "dialog" | "toast";

let _popoverLayer: HTMLElement;
let _modalLayer: HTMLElement;
let _dialogLayer: HTMLElement;
let _toastLayer: HTMLElement;

/**
 * The host a layer kind renders into, falling back to `<body>` before `initLayers()` has run.
 *
 * Exported for the surfaces that mount THEMSELVES into a layer rather than handing this module a
 * template — `surfaces/about.ts` is the first — so a converted surface asks for its layer by name
 * instead of reaching for `#layer-dialog` and re-deriving the fallback.
 */
export function layerHost(kind: LayerKind): HTMLElement {
  const host =
    kind === "popover"
      ? _popoverLayer
      : kind === "modal"
        ? _modalLayer
        : kind === "toast"
          ? _toastLayer
          : _dialogLayer;
  return host || document.body;
}

export function initLayers() {
  _popoverLayer = document.querySelector("#layer-popover") as HTMLElement;
  _modalLayer = document.querySelector("#layer-modal") as HTMLElement;
  _dialogLayer = document.querySelector("#layer-dialog") as HTMLElement;
  _toastLayer = document.querySelector("#layer-toast") as HTMLElement;
  mountToastHost();
}

/** Anything in the modal/dialog layers that paints a viewport-wide underlay over the app. */
const UNDERLAID = "jx-dialog[data-open], sp-dialog-wrapper[open], sp-underlay[open]";

/**
 * Whether a surface with an underlay is up — a dialog from {@link showDialog}, or an
 * {@link openModal} body that renders its own `sp-underlay`.
 *
 * Read by the app-level keyboard handlers, which must stand down while one is: an underlay swallows
 * every pointer event across the viewport, so leaving shortcuts live means <kbd>Delete</kbd>,
 * <kbd>Enter</kbd>, ⌘S and ⌘W keep hitting the document BEHIND a surface the author cannot even
 * click on. Derived from the live DOM rather than a registration counter, so the rule is simply
 * "whatever blocks the mouse blocks the keyboard" — no bookkeeping for a new modal to forget.
 */
export function isModalOpen(): boolean {
  return Boolean(_dialogLayer?.querySelector(UNDERLAID) || _modalLayer?.querySelector(UNDERLAID));
}

/** Focusable candidates in an overlay body, in the order a keyboard user would reach them. */
const BODY_FOCUSABLE =
  'a[href], input, textarea, select, button, sp-textfield, sp-button, sp-action-button, sp-picker, sp-checkbox, sp-menu-item, [tabindex]:not([tabindex="-1"])';

/** The body's focusables that can actually take the caret right now. */
function focusablesIn(slot: HTMLElement): HTMLElement[] {
  return [...slot.querySelectorAll<HTMLElement>(BODY_FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Hand the keyboard to a freshly opened overlay.
 *
 * `sp-dialog-wrapper` only throws focus into itself when an `<sp-overlay>` drives it. Opened
 * directly through its `open` attribute — Studio's pattern, because this layer stack owns stacking
 * rather than Spectrum's overlay system — NOTHING does, so focus stays on whatever sits behind the
 * underlay: the surface is unreachable by keyboard, <kbd>Escape</kbd> never reaches it, and
 * keystrokes keep landing in the app the underlay is blocking.
 *
 * Prefers the first focusable in the BODY (a bespoke form's opening field), else the wrapper's own
 * cancel button — DialogWrapper renders cancel → secondary → confirm, so the first shadow button is
 * the least destructive landing spot — else the slot itself, which carries `tabindex="-1"` so a
 * body made only of static content (a progress spinner) still receives <kbd>Escape</kbd>. A body
 * that already claimed focus ({@link showPromptDialog}'s field) is left alone.
 */
function focusOverlay(slot: HTMLElement): void {
  // Deferred a frame: the wrapper's buttons live in a shadow root Spectrum renders asynchronously.
  requestAnimationFrame(() => {
    if (!slot.isConnected || slot.contains(document.activeElement)) {
      return;
    }
    const wrapper = slot.querySelector("sp-dialog-wrapper");
    const target =
      focusablesIn(slot)[0] ?? wrapper?.shadowRoot?.querySelector<HTMLElement>("sp-button") ?? slot;
    target.focus();
  });
}

/**
 * Keep <kbd>Tab</kbd> inside the overlay: cycle through the body's focusables, wrapping at both
 * ends. With no focusable body at all the caret stays on the slot — tabbing out of a surface the
 * mouse cannot leave either would strand the keyboard behind the underlay.
 */
function trapTab(slot: HTMLElement, e: KeyboardEvent): void {
  e.preventDefault();
  const items = focusablesIn(slot);
  if (items.length === 0) {
    return;
  }
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey
    ? items[at <= 0 ? items.length - 1 : at - 1]
    : items[at === -1 || at === items.length - 1 ? 0 : at + 1];
  next?.focus();
}

/** How an overlay slot behaves once it is up. */
interface OverlaySlotOptions {
  /** Layer host the slot is appended to. */
  layer: HTMLElement;
  /** Which layer this is, for the slot's region id. */
  kind: LayerKind;
  /**
   * Optional instance name, making the slot `overlay.<instance>:<id>` instead of the bare
   * `overlay.<instance>`. A surface that can be open alongside another one of its kind wants this.
   */
  regionId?: string | undefined;
  /** Handle <kbd>Escape</kbd> pressed inside the slot; the callback owns `preventDefault`. */
  onEscape?: (e: KeyboardEvent, slot: HTMLElement) => void;
  /** Cycle <kbd>Tab</kbd> within the slot instead of letting it walk into the app behind. */
  trapFocus?: boolean;
}

/**
 * Open a slot in a layer with the full overlay keyboard contract: focus in on open, focus back to
 * the opener on close, centralised <kbd>Escape</kbd>, and (optionally) a Tab trap.
 *
 * Both {@link showDialog} and {@link openModal} are thin wrappers over this — one contract, one
 * implementation, so no surface can ship without the machinery.
 */
function openOverlaySlot(opts: OverlaySlotOptions): { slot: HTMLElement; release: () => void } {
  const slot = document.createElement("div");
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion(opts.kind, opts.regionId));
  // Focusable as a last resort, so a body with no controls still owns the keyboard (focusOverlay).
  slot.tabIndex = -1;
  // The slot is a zero-height wrapper around fixed-position bodies, so its own focus ring would
  // Paint as a stray line across the top of the layer.
  slot.style.outline = "none";
  opts.layer.append(slot);
  // Whoever held focus before the overlay took it, so it can be handed back (a dialog opened from a
  // Toolbar button returns the caret to that button, not to <body>).
  const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      opts.onEscape?.(e, slot);
      return;
    }
    if (e.key === "Tab" && opts.trapFocus) {
      trapTab(slot, e);
    }
  };
  slot.addEventListener("keydown", onKeydown);
  return {
    release() {
      slot.removeEventListener("keydown", onKeydown);
      litRender(nothing, slot);
      slot.remove();
      if (restoreTo?.isConnected) {
        restoreTo.focus();
      }
    },
    slot,
  };
}

/**
 * Show an ephemeral dialog. Returns a Promise that resolves when the dialog is dismissed.
 *
 * Takes the keyboard on open ({@link focusOverlay}) and hands it back to the previously focused
 * element on close. <kbd>Escape</kbd> dismisses by firing the wrapper's `close` event, so each
 * helper's own `@close` binding decides what "dismissed" resolves to; a bespoke body with no
 * `sp-dialog-wrapper` owns its own keys.
 *
 * @template T
 * @param {(done: (value: T) => void) => import("lit-html").TemplateResult} templateFn
 * @returns {Promise<T>}
 */
export function showDialog<T>(
  templateFn: (done: (value: T) => void) => TemplateResult,
  opts: { region?: string; label?: string } = {},
): Promise<T> {
  return new Promise((resolve) => {
    const { release, slot } = openOverlaySlot({
      kind: "dialog",
      // `layerHost`, not the raw binding: it is the one that falls back to `<body>`, and reading
      // The binding directly threw before `initLayers()` had run — which is any test that stands up
      // A shell without the four layer hosts, and the boot window before layers are bound.
      layer: layerHost("dialog"),
      regionId: opts.region,
      onEscape(e, host) {
        const wrapper = host.querySelector("sp-dialog-wrapper");
        if (!wrapper) {
          return;
        }
        // Stop it ALSO reaching the app behind (which clears the canvas selection on Escape).
        e.preventDefault();
        e.stopPropagation();
        wrapper.dispatchEvent(new Event("close", { bubbles: true }));
      },
      // No Tab trap: the wrapper's action buttons live in a shadow root a light-DOM cycle cannot
      // Enumerate, so trapping here would strand the caret on the body and never reach Cancel.
    });
    /*
     * The slot IS the dialog, so it says so.
     *
     * `aria-modal` is also the answer to the comment above: it tells assistive technology that
     * everything outside this element is inert, which constrains a screen reader's virtual cursor —
     * the thing a Tab trap cannot reach anyway, since the virtual cursor does not use Tab. So the
     * caret still escapes into the shadow-root buttons, as it must, and a reader is no longer free
     * to wander the page behind a modal that is covering it.
     */
    slot.setAttribute("role", "dialog");
    slot.setAttribute("aria-modal", "true");
    let resolved = false;
    const done = (value: T) => {
      if (resolved) {
        return;
      }
      resolved = true;
      release();
      resolve(value);
    };
    litRender(templateFn(done), slot);
    /*
     * The name, after render, because the usual source of one is the wrapper's own `headline` —
     * which does not exist until the template has run. An explicit `label` wins; a dialog with
     * neither is nameless, which is a defect in the caller rather than something to invent here.
     */
    const headline =
      opts.label ?? slot.querySelector("sp-dialog-wrapper")?.getAttribute("headline") ?? null;
    if (headline !== null && headline !== "") {
      slot.setAttribute("aria-label", headline);
    }
    focusOverlay(slot);
  });
}

/**
 * Show a confirm/cancel dialog. Returns true if confirmed, false otherwise.
 *
 * @param {string} headline
 * @param {string | import("lit-html").TemplateResult} message
 * @param {{ confirmLabel?: string; cancelLabel?: string; destructive?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
export function showConfirmDialog(
  headline: string,
  message: string | TemplateResult,
  opts: {
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  } = {},
): Promise<boolean> {
  const { confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      handle.close();
      resolve(value);
    };
    const handle = openDialogSurface({
      cancelLabel,
      confirmLabel,
      destructive,
      headline,
      layer: layerHost("dialog"),
      ...messageOptions(message),
      onCancel: () => done(false),
      onClosed: () => done(false),
      onConfirm: () => done(true),
    });
  });
}

/**
 * Show a three-way Save / Discard / Cancel dialog. Resolves "save", "discard", or "cancel"
 * (dismiss/close counts as cancel).
 *
 * @param {string} headline
 * @param {string | import("lit-html").TemplateResult} message
 * @param {{ saveLabel?: string; discardLabel?: string; cancelLabel?: string }} [opts]
 * @returns {Promise<"save" | "discard" | "cancel">}
 */
export function showSaveDiscardDialog(
  headline: string,
  message: string | TemplateResult,
  opts: {
    saveLabel?: string;
    discardLabel?: string;
    cancelLabel?: string;
  } = {},
): Promise<"save" | "discard" | "cancel"> {
  const { saveLabel = "Save", discardLabel = "Discard", cancelLabel = "Cancel" } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: "save" | "discard" | "cancel") => {
      if (settled) {
        return;
      }
      settled = true;
      handle.close();
      resolve(value);
    };
    const handle = openDialogSurface({
      cancelLabel,
      confirmLabel: saveLabel,
      headline,
      layer: layerHost("dialog"),
      ...messageOptions(message),
      onCancel: () => done("cancel"),
      onClosed: () => done("cancel"),
      onConfirm: () => done("save"),
      onSecondary: () => done("discard"),
      secondaryLabel: discardLabel,
    });
  });
}

/**
 * A message as the surface takes it: a sentence, or a lit template rendered into the document's
 * island once the element is ready — the island rule of studio-ui-guidelines §9.4.
 */
function messageOptions(
  message: string | TemplateResult,
): Pick<DialogSurfaceOptions, "message" | "island"> {
  if (typeof message === "string") {
    return { message };
  }
  return {
    island: (host) => {
      litRender(message, host);
    },
  };
}

/**
 * A picker rendered above the field, whose selection the dialog OWNS.
 *
 * Owned, not merely displayed: the choice reaches `validate` as its second argument, and picking a
 * row re-runs it. That is the whole reason this lives here rather than being smuggled in through
 * `message` — `check` and `rerender` are private to {@link showPromptDialog}, so a caller-built
 * control could change the selection but could never make the field's refusal catch up with it. The
 * New File dialog's format picker is exactly that case: switching from Markdown to JSON changes
 * whether the typed name is already taken, with no keystroke to notice.
 */
/** One option of a prompt's choice, as a caller lists them. */
export interface ChoiceOption {
  value: string;
  label: string;
  /**
   * Set a sentinel row apart from the ones before it. Kept for callers; `jx-select` draws a
   * delimiter for a GROUP, which carries a heading, and this is a bare rule between two rows of one
   * list — so nothing draws it yet and `files.ts`'s "Other…" row reads as an ordinary row.
   */
  dividerBefore?: boolean;
}

export interface PromptChoice {
  /** Label above the picker. */
  label: string;
  /**
   * The rows, re-read on EVERY render rather than captured once. A snapshot taken when the options
   * object is built freezes a list the project can still be loading — the same defect
   * `content/entry-commands.ts`'s `derivedEnumProperty` exists to prevent one layer up.
   */
  options: () => readonly ChoiceOption[];
  /** Which row starts selected. */
  initial: string;
  /** Told what was picked, for a caller keeping its own derived state. */
  onChange?: (next: string) => void;
}

/** Options accepted by {@link showPromptDialog}. */
export interface PromptDialogOptions {
  /** Label on the confirming button. */
  confirmLabel?: string;
  /** Label on the dismissing button. */
  cancelLabel?: string;
  /** Explanatory copy rendered above the text field. */
  message?: string | TemplateResult;
  /** Placeholder shown while the field is empty. Read on every render, so it may follow the choice. */
  placeholder?: string | (() => string);
  /** How much of the pre-filled value to select once the field takes focus. */
  select?: "all" | "stem" | "none";
  /**
   * Validate the raw field value. Return an empty string when valid, or a message to show as
   * negative help text (which also blocks confirmation). Defaults to "must not be blank".
   *
   * `chosen` is the {@link PromptChoice} selection, or `""` when the dialog offers no choice.
   */
  validate?: (value: string, chosen: string) => string;
  /** Pre-filled value. */
  value?: string;
  /** A picker above the field whose selection this dialog owns. */
  choice?: PromptChoice;
}

/**
 * Show a single-field text-entry dialog — the Spectrum replacement for `window.prompt()`.
 *
 * Resolves the trimmed value, or `null` when cancelled/dismissed. Confirming with an invalid value
 * keeps the dialog open and surfaces the validation message as negative help text.
 *
 * @param {string} headline
 * @param {PromptDialogOptions} [opts]
 * @returns {Promise<string | null>}
 */
export function showPromptDialog(
  headline: string,
  opts: PromptDialogOptions = {},
): Promise<string | null> {
  const {
    cancelLabel = "Cancel",
    choice,
    confirmLabel = "OK",
    message,
    placeholder = "",
    select = "all",
    validate,
    value: initialValue = "",
  } = opts;

  const check = (candidate: string) =>
    validate ? validate(candidate, chosen) : candidate.trim() ? "" : "Enter a value.";

  let value = initialValue;
  let chosen = choice?.initial ?? "";
  let error = "";
  /*
   * Whether the reader has typed yet.
   *
   * A dialog opens with a valid prefill and NO error, and picking a format must not be the thing
   * that first paints one under a field nobody has touched — "untitled" is not yet a mistake. So a
   * pick refreshes an error that is already showing and never mints the first one; the confirm
   * still refuses, because `confirm()` runs `check` unconditionally.
   */
  let touched = false;
  const placeholderNow = () => (typeof placeholder === "function" ? placeholder() : placeholder);
  const optionsNow = (): DialogChoiceOption[] =>
    choice ? choice.options().map((option) => ({ label: option.label, value: option.value })) : [];

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      handle.close();
      resolve(result);
    };
    const showError = (next: string) => {
      error = next;
      handle.update({ error, invalid: error !== "" });
    };
    const handle = openDialogSurface({
      cancelLabel,
      confirmLabel,
      headline,
      layer: layerHost("dialog"),
      ...(message === undefined ? {} : messageOptions(message)),
      ...(choice ? { choice: { chosen, label: choice.label, options: optionsNow() } } : {}),
      field: { placeholder: placeholderNow(), select, value },
      onCancel: () => done(null),
      onClosed: () => done(null),
      onConfirm: () => {
        const refused = check(value);
        if (refused) {
          showError(refused);
          return;
        }
        done(value.trim());
      },
      onInput: (next) => {
        touched = true;
        value = next;
        const candidate = check(value);
        // Only a CHANGED verdict repaints the message; a keystroke inside a valid value is silent.
        if (candidate !== error) {
          showError(candidate);
        }
      },
      /*
       * A pick refreshes UNCONDITIONALLY: it can change the placeholder, the selected option, and
       * — for the New File dialog — whether the composed filename is already taken, all with the
       * error text unchanged.
       */
      onPick: (next) => {
        chosen = next;
        choice?.onChange?.(next);
        const candidate = check(value);
        error = touched || error ? candidate : "";
        handle.update({
          chosen,
          error,
          invalid: error !== "",
          options: optionsNow(),
          placeholder: placeholderNow(),
        });
      },
    });
  });
}

/** Options accepted by {@link openModal}. */
export interface ModalOptions {
  /**
   * Accessible name for the modal, applied as `aria-label` on the wrapper. Required: it is the only
   * name assistive tech gets, and a per-modal opt-in would be forgotten.
   */
  label: string;
  /**
   * Whether <kbd>Escape</kbd> dismisses. `false` for modals that must not vanish mid-flight (a
   * running operation, a step that has to be confirmed).
   */
  dismissible?: boolean;
  /**
   * What <kbd>Escape</kbd> runs. Defaults to the handle's own `close()`; pass the call site's close
   * function when it keeps bookkeeping of its own (a module-level handle to clear).
   */
  onDismiss?: () => void;
  /**
   * Instance name for this modal's region — `overlay.dialog:settings`.
   *
   * Optional because one modal at a time is the norm and `overlay.dialog` addresses it. A modal
   * that can be open beside another, or that a command needs to move focus back into by name,
   * declares one.
   */
  region?: string;
}

/**
 * Open a persistent modal. Returns a handle with update() and close() methods.
 *
 * The wrapper — not the body — owns the modal contract, so no surface can ship without it: the slot
 * is the `role="dialog"` element, carries `aria-modal` and the caller's label, takes the keyboard
 * on open, cycles <kbd>Tab</kbd> within itself, dismisses on <kbd>Escape</kbd>, and hands focus
 * back to the opener on close. Bodies render content only.
 *
 * @param {import("lit-html").TemplateResult} template
 * @param {ModalOptions} opts
 */
export function openModal(template: TemplateResult, opts: ModalOptions) {
  const { release, slot } = openOverlaySlot({
    kind: "modal",
    layer: layerHost("modal"),
    onEscape(e) {
      if (opts.dismissible === false) {
        return;
      }
      // Stop it ALSO reaching the app behind (which clears the canvas selection on Escape).
      e.preventDefault();
      e.stopPropagation();
      (opts.onDismiss ?? handle.close)();
    },
    regionId: opts.region,
    trapFocus: true,
  });
  slot.setAttribute("role", "dialog");
  slot.setAttribute("aria-modal", "true");
  slot.setAttribute("aria-label", opts.label);

  const handle = {
    close() {
      release();
    },
    host: slot,
    /** @param {import("lit-html").TemplateResult} tpl */
    update(tpl: TemplateResult) {
      litRender(tpl, slot);
    },
  };
  litRender(template, slot);
  focusOverlay(slot);
  return handle;
}

/**
 * Render a popover into a layer.
 *
 * @param {import("lit-html").TemplateResult} template
 * @param {{
 *   dismissOnOutsideClick?: boolean;
 *   onDismiss?: () => void;
 *   layer?: LayerKind;
 *   region?: string;
 * }} [opts]
 */
export function renderPopover(
  template: TemplateResult,
  opts: {
    dismissOnOutsideClick?: boolean;
    onDismiss?: () => void;
    layer?: LayerKind;
    /** Instance name for this popover's region — `overlay.menu:blockbar`. */
    region?: string;
  } = {},
) {
  const kind = opts.layer ?? "popover";
  const slot = document.createElement("div");
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion(kind, opts.region));
  layerHost(kind).append(slot);
  litRender(template, slot);

  let outsideClickHandler: ((e: MouseEvent) => void) | null = null;
  if (opts.dismissOnOutsideClick !== false) {
    outsideClickHandler = (e: MouseEvent) => {
      if (!slot.contains(e.target as Node)) {
        handle.dismiss();
        opts.onDismiss?.();
      }
    };
    requestAnimationFrame(() => {
      if (outsideClickHandler) {
        document.addEventListener("mousedown", outsideClickHandler, true);
      }
    });
  }

  const handle = {
    dismiss() {
      if (outsideClickHandler) {
        document.removeEventListener("mousedown", outsideClickHandler, true);
        /* Disarm the PENDING arming too, not just the armed listener. The `addEventListener` above
           is deferred a frame so the click that opened this popover cannot immediately close it —
           so a popover dismissed within that frame (open the same menu twice in one frame, which a
           double-click does) would otherwise be armed AFTER its own death: a document-wide capture
           listener on a detached slot, never removed, that answers the next mousedown by calling
           its owner's `onDismiss`. Owners null their handle field there, so the corpse's callback
           cleared the pointer to the LIVE popover and stranded it on screen, un-dismissable. The
           `if` in the rAF was always written for this; nothing had ever nulled the variable. */
        outsideClickHandler = null;
      }
      litRender(nothing, slot);
      slot.remove();
    },
    host: slot,
    /** @param {import("lit-html").TemplateResult} tpl */
    update(tpl: TemplateResult) {
      litRender(tpl, slot);
    },
  };
  return handle;
}

const _namedSlots = new Map<string, HTMLElement>();

/**
 * Get or create a named slot in a layer. Useful for persistent popovers like the zoom indicator.
 *
 * The `${layer}:${id}` key this already builds IS the slot's region: it is stamped as
 * `overlay.<instance>:<id>`, so naming a slot names its region and every persistent overlay becomes
 * addressable for free. That also settles a latent ambiguity — two open popovers used to be
 * indistinguishable to anything matching on `sp-popover[open]`, and each now answers to its own
 * id.
 *
 * @param {LayerKind} layer
 * @param {string} id
 * @returns {HTMLElement}
 */
/**
 * The layer a transient popover must use to appear ABOVE the surface that opened it.
 *
 * The four layer hosts are sibling stacking contexts (`index.html`): popover 1000, modal 2000,
 * dialog 3000, toast 4000. So a popover anchored to a control INSIDE a modal — the media picker's
 * Browse button in Search appearance, say — renders into a layer that paints entirely beneath the
 * modal body, and the author clicks Browse and sees nothing happen. Putting it in the modal's own
 * layer makes it a later sibling of the modal body instead, which is exactly the relationship it
 * should have: above the surface that opened it, below any dialog.
 *
 * @param {Element | null} anchor The control the popover is anchored to.
 * @returns {LayerKind}
 */
export function popoverLayerFor(anchor: Element | null): LayerKind {
  if (anchor?.closest("#layer-dialog")) {
    return "dialog";
  }
  return anchor?.closest("#layer-modal") ? "modal" : "popover";
}

export function getLayerSlot(layer: LayerKind, id: string) {
  const key = `${layer}:${id}`;
  let slot = _namedSlots.get(key);
  if (slot && slot.parentElement) {
    return slot;
  }

  slot = document.createElement("div");
  slot.style.pointerEvents = "auto";
  slot.setAttribute(REGION_ATTR, overlayRegion(layer, id));
  layerHost(layer).append(slot);
  _namedSlots.set(key, slot);
  return slot;
}

/**
 * Clear a named layer slot (remove from DOM and map).
 *
 * @param {LayerKind} layer
 * @param {string} id
 */
export function clearLayerSlot(layer: LayerKind, id: string) {
  const key = `${layer}:${id}`;
  const slot = _namedSlots.get(key);
  if (slot) {
    litRender(nothing, slot);
    slot.remove();
    _namedSlots.delete(key);
  }
}

// ─── The toast host — the fourth layer ───────────────────────────────────────

/**
 * How long a toast is settling into place, in ms.
 *
 * Published to {@link overlayIdleBlockers} rather than kept private, because "the shell has stopped
 * moving" is a question `services/idle.ts` answers on behalf of the screenshot runner and the
 * verify skill, and a toast sliding in is exactly the half-painted frame a capture must not catch.
 */
export const TOAST_ENTER_MS = 180;

/** The severity glyphs. One character each: the toast's job is a line of text, not an illustration. */
const TOAST_ICON: Readonly<Record<Severity, string>> = {
  error: "✕",
  info: "ℹ",
  success: "✓",
  warn: "!",
};

let _toastScope: EffectScope | null = null;
/** Toast id → its retirement timer, so a re-render never schedules a second one. */
const _toastTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Toast id → when it started settling in. Cleared by its own timer. */
const _toastEntering = new Set<string>();

/**
 * Whether the reader has asked for less movement.
 *
 * Read per call rather than cached: §13.3 clause 6 says the app must HONOUR this rather than have
 * the runner inject a freeze stylesheet, which means the answer has to be able to change.
 */
function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * **One of the three listed exceptions to §13.3 clause 6** — behaviour that differs under
 * `?automation=1` beyond installing the hook, pinning the clock and selecting a profile. The other
 * Two are both refusals to touch the project on disk: `packages/ensure-deps.ts` declines to run
 * `bun install`, and `packages/jxsuite-update.ts` declines to prompt for a dependency update. This
 * One is the only exception that changes what a picture SHOWS rather than what it avoids doing.
 *
 * A toast is the single surface in the app whose lifetime is a TIMER rather than a state. Every
 * other surface a shot can photograph is there because the app is in a state, and it stays there
 * until a command changes it; a toast retires itself between the step that raised it and the frame
 * that captures it, so a shot of one is a race the manifest has no way to express. Holding it open
 * is the smaller lie: the picture then shows a toast that a human reader would also have seen, for
 * as long as they cared to look, instead of showing the toast that happened to still be there.
 *
 * The gate is re-derived from `location.search` rather than imported from `services/automation.ts`
 * deliberately: §13.3 requires the scripting surface to be absent from the desktop and cloud
 * bundles (`check-bundle-budget.ts`'s next assertion), and importing it from a module every layer
 * pulls in would ship it everywhere. One line of duplication, on purpose.
 */
export function toastsAreHeld(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get("automation") === "1";
  } catch {
    // Intentionally ignored: no location (a bare test realm) means no automation.
    return false;
  }
}

/**
 * What is still moving in the overlay layers, as `services/idle.ts` phrases it.
 *
 * Empty when every toast has settled — a RESTING toast is not a blocker, which is the property that
 * lets {@link toastsAreHeld} hold one open forever without `probeIdle()` waiting forever with it.
 */
export function overlayIdleBlockers(): readonly string[] {
  return [..._toastEntering].map((id) => `overlay: toast ${id} settling in`);
}

/** Take a toast away, cancelling any timer it still owns. */
function retireToast(id: string): void {
  const timer = _toastTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    _toastTimers.delete(id);
  }
  _toastEntering.delete(id);
  dismiss(id);
}

/**
 * Give a newly-arrived toast its timers: the settle window the idle account reads, and (unless
 * held) the rest period after which it retires itself.
 */
function scheduleToast(record: Notification): void {
  if (_toastTimers.has(record.id) || _toastEntering.has(record.id)) {
    return;
  }
  const settle = reducedMotion() ? 0 : TOAST_ENTER_MS;
  if (settle > 0) {
    _toastEntering.add(record.id);
    setTimeout(() => _toastEntering.delete(record.id), settle);
  }
  const rest = record.timeoutMs ?? 0;
  if (rest <= 0 || toastsAreHeld()) {
    return;
  }
  _toastTimers.set(
    record.id,
    setTimeout(() => retireToast(record.id), rest),
  );
}

/** One toast, as `surfaces/toasts.json` draws it. */
export interface ToastProjection {
  id: string;
  severity: Severity;
  icon: string;
  message: string;
  hasAction: boolean;
  /** The recovery command's title, so the button says what it does rather than "Retry". */
  actionLabel: string;
  actionDisabled: boolean;
  /** The command's tooltip: its title, or its title with the reason it is off. */
  actionTitle: string;
}

interface ToastScope extends Record<string, unknown> {
  toasts: ToastProjection[];
  runAction: (id: string) => void;
  dismissToast: (id: string) => void;
}

registerSurface("toasts", toastsDoc as unknown as JxDocument);

let _toastState: ToastScope | null = null;
let _toastMount: Promise<SurfaceHandle> | null = null;
let _toastHandle: SurfaceHandle | null = null;

/** The toast surface's scope: the projected rows, and the two things a row can ask the host to do. */
function toastScope(): ToastScope {
  _toastState ??= reactive<ToastScope>({
    dismissToast: (id) => {
      retireToast(id);
    },
    runAction: (id) => {
      const record = toasts.find((candidate) => candidate.id === id);
      const registry = activeRegistry();
      if (!record?.action || !registry) {
        return;
      }
      retireToast(id);
      void registry.run(record.action, record.actionArgs);
    },
    toasts: [],
  }) as ToastScope;
  return _toastState;
}

/**
 * Project one record: the recovery button is a COMMAND, so its label, its gate and its reason all
 * come off the record — an unregistered or hidden command renders no button, which is what lets a
 * call site name a capability that lands next phase without shipping a dead control meanwhile.
 */
function projectToast(record: Notification): ToastProjection {
  const registry = record.action === undefined ? null : activeRegistry();
  const id = record.action;
  // `get` before `isVisible`: an id the registry has never seen is a button that never was, not
  // A question it can answer.
  const known = registry && id !== undefined ? registry.get(id) : undefined;
  const command = known && id !== undefined && registry!.isVisible(id) ? known : null;
  const reason = command && id !== undefined ? registry!.disabledReason(id) : undefined;
  return {
    actionDisabled: reason !== undefined,
    actionLabel: command?.title ?? "",
    actionTitle:
      command === null || command === undefined
        ? ""
        : reason === undefined
          ? command.title
          : `${command.title} — requires ${reason}`,
    hasAction: command !== null && command !== undefined,
    icon: TOAST_ICON[record.severity],
    id: record.id,
    message: record.message,
    severity: record.severity,
  };
}

/**
 * Mount the toast host: the surface into the toast layer, and one effect that keeps its rows and
 * the records' timers in step with `notify()`'s list.
 */
export function mountToastHost(): void {
  unmountToastHost();
  if (!_toastLayer) {
    return;
  }
  _toastScope = effectScope();
  _toastScope.run(() => {
    effect(() => {
      void toasts.length;
      void activeRegistry();
      for (const record of toasts) {
        scheduleToast(record);
      }
      toastScope().toasts = toasts.map((record) => projectToast(record));
    });
  });
  _toastMount = mountSurface("toasts", toastScope(), _toastLayer);
  void _toastMount.then((handle) => {
    _toastHandle = handle;
  });
}

export function unmountToastHost(): void {
  _toastScope?.stop();
  _toastScope = null;
  for (const timer of _toastTimers.values()) {
    clearTimeout(timer);
  }
  _toastTimers.clear();
  _toastEntering.clear();
  const pending = _toastMount;
  _toastMount = null;
  if (_toastHandle) {
    _toastHandle.dispose();
    _toastHandle = null;
  } else if (pending) {
    void pending.then((handle) => handle.dispose());
  }
  _toastState = null;
}
