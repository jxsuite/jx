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

/**
 * Anything in the modal/dialog layers that paints a viewport-wide underlay over the app.
 *
 * The two Spectrum halves are kept deliberately even though nothing in this package renders one any
 * more: the selector is a question about the LIVE DOM ("whatever blocks the mouse"), so it costs
 * nothing to keep answering it for an element an extension or a not-yet-converted surface could
 * still put in a layer, and dropping them would be a silent narrowing of a safety rule.
 */
const UNDERLAID = "jx-dialog[data-open], sp-dialog-wrapper[open], sp-underlay[open]";

/**
 * Whether a surface with an underlay is up — a dialog from {@link showConfirmDialog} and its two
 * siblings, or a `jx-dialog` surface mounted into the modal layer (`surfaces/progress-modal.ts`,
 * `surfaces/publish.ts`).
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

/*
 * `showDialog` was here, with `openOverlaySlot`, `focusOverlay`, `focusablesIn` and
 * `BODY_FOCUSABLE` under it — and all five are GONE together.
 *
 * It was the last bespoke-body path: a caller handed it a lit template, usually an
 * `sp-dialog-wrapper` it had written itself, and this module wrapped the machinery a hand-written
 * dialog needs around it — a slot with a region id, `role="dialog"` and `aria-modal`, an accessible
 * name scraped off the wrapper's `headline` after the render, a deferred focus move into the body
 * or the wrapper's shadow-root buttons, an Escape that had to be translated into the wrapper's own
 * `close` event, and a focus restore on the way out. Every line of that existed because the body
 * was arbitrary markup rather than a dialog element.
 *
 * `surfaces/dialog.json` is a `jx-dialog`, and the platform's `<dialog>` owns modality, the
 * backdrop, Escape, the initial focus and the focus restore. So the machinery is not reimplemented
 * anywhere — it is not needed. The last caller, `editor/shortcuts.ts`'s "where should this project
 * open" question, was a three-way confirm all along and calls `openDialogSurface` directly
 * (studio-ui-guidelines.md §12.5); `showConfirmDialog`, `showSaveDiscardDialog` and
 * `showPromptDialog` below are the three named questions, and they go through the same document.
 *
 * A body that is genuinely richer than a sentence is an ISLAND, not a new dialog: `message` accepts
 * a lit template and `messageOptions` renders it into the document's `[part="island"]` (§9.4).
 */

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
  /**
   * Make the field a paste box: several lines, Enter inserts one rather than confirming.
   *
   * This is still `showPromptDialog` and not a second dialog. A redirects import is one value the
   * author pastes and one answer they give, which is exactly what this flow is; what it needed was
   * a field tall enough to read the value back in, and that is a property of the field.
   */
  multiline?: boolean;
  /** How many lines a multiline field opens at. */
  rows?: string;
  /** Monospaced, for a format whose columns line up in the file it was copied from. */
  mono?: boolean;
  /** The dialog's width — a paste box wants more than a name does. */
  size?: "sm" | "md" | "lg";
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
    mono = false,
    multiline = false,
    placeholder = "",
    rows = "3",
    select = "all",
    size,
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
      field: { mono, multiline, placeholder: placeholderNow(), rows, select, value },
      ...(size === undefined ? {} : { size }),
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
