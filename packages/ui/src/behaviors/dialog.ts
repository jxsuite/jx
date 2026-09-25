/**
 * `jx-dialog`'s behaviour sidecar: the one place the element calls the platform's own `showModal()`
 * and `close()`, and the handlers that mirror the platform's events back onto the element's state
 * and out to the host.
 *
 * Nothing here traps focus, listens on the document or decides what Escape means. A modal
 * `<dialog>` makes the rest of the page inert, restores focus when it closes, and answers Escape
 * and light dismissal through `closedby`; the sidecar's job is only to say so in the element's own
 * vocabulary — `open` on the state, `confirm`, `secondary`, `cancel` and `close` on the host.
 *
 * @docs extending/ui-kit
 */

export interface DialogState {
  open: boolean;
  dismissible: boolean;
}

/** The `jx-dialog` an event belongs to. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof Element ? target.closest<HTMLElement>("jx-dialog") : null;
}

/** The element's own native dialog. */
function innerOf(host: HTMLElement): HTMLDialogElement | null {
  return host.querySelector<HTMLDialogElement>('dialog[part="dialog"]');
}

function emit(host: HTMLElement | null, name: string): void {
  host?.dispatchEvent(new CustomEvent(name, { bubbles: true }));
}

/**
 * A `toggle` event, dispatched by hand where the platform does not fire one for dialogs.
 *
 * Chrome fires `beforetoggle`/`toggle` on a dialog since 2024; the test DOM does not, and the
 * element's `open` state is read from that event. Dispatched only when the platform's own is not
 * coming, so a browser never sees two.
 */
function syntheticToggle(dialog: HTMLDialogElement, newState: "open" | "closed"): void {
  if (typeof ToggleEvent !== "undefined") {
    return;
  }
  const event = new Event("toggle", { bubbles: false });
  Object.assign(event, { newState, oldState: newState === "open" ? "closed" : "open" });
  dialog.dispatchEvent(event);
}

/**
 * Open the dialog modally. The host's door in: Studio's dialog surface calls it once the element is
 * ready, and a `--show` invoker command reaches it through {@link onCommand}.
 *
 * @param host The `jx-dialog` element.
 */
export function showModal(host: HTMLElement): void {
  const dialog = innerOf(host);
  if (!dialog || dialog.open) {
    return;
  }
  dialog.showModal();
  syntheticToggle(dialog, "open");
}

/**
 * Close the dialog, with an optional return value the platform records on the native element.
 *
 * @param host The `jx-dialog` element.
 * @param returnValue What closed it, for `dialog.returnValue`.
 */
export function close(host: HTMLElement, returnValue?: string): void {
  const dialog = innerOf(host);
  if (!dialog?.open) {
    return;
  }
  dialog.close(returnValue);
  syntheticToggle(dialog, "closed");
}

/** The platform's `toggle` on the inner dialog: the one source of truth for `open`. */
export function onToggle(state: DialogState, event: Event): void {
  state.open = (event as { newState?: string }).newState === "open";
}

/**
 * The platform's `cancel` on the inner dialog — Escape, or a light dismissal `closedby` allows. The
 * platform closes the dialog itself after this; the element only says so.
 */
export function onNativeCancel(state: DialogState, event: Event): void {
  state.open = false;
  emit(hostOf(event), "cancel");
}

/** The platform's `close` on the inner dialog, whatever closed it. */
export function onNativeClose(state: DialogState, event: Event): void {
  state.open = false;
  emit(hostOf(event), "close");
}

/**
 * An invoker command aimed at the host: `--show` opens the dialog modally, `--close` closes it.
 *
 * Custom commands are the only ones the platform delivers to an element that is not itself a
 * `<dialog>`, which the host of an inner one is not; so `<button command="--show"
 * commandfor="my-dialog">` is how a page opens a `jx-dialog` with no script.
 */
export function onCommand(_state: DialogState, event: Event): void {
  const host = hostOf(event);
  const command = (event as { command?: string }).command ?? "";
  if (!host) {
    return;
  }
  if (command === "--show") {
    showModal(host);
  } else if (command === "--close") {
    close(host);
  }
}

/** The confirm button. The host decides whether the dialog closes: a refused value keeps it open. */
export function onConfirm(_state: DialogState, event: Event): void {
  emit(hostOf(event), "confirm");
}

/** The secondary button, the dialog's third answer (Save · Discard · Cancel). */
export function onSecondary(_state: DialogState, event: Event): void {
  emit(hostOf(event), "secondary");
}

/** The cancel button: says so, then closes, so the platform's `close` follows. */
export function onCancelClick(_state: DialogState, event: Event): void {
  const host = hostOf(event);
  emit(host, "cancel");
  if (host) {
    close(host, "cancel");
  }
}
