/**
 * `jx-toast-host`'s behaviour sidecar: the stack's clock policy, and the one gesture that puts the
 * keyboard into a toast.
 *
 * **A toast must not steal focus, and its recovery control must still be reachable before it
 * expires.** Those two sentences are in tension, and this module is where the tension is resolved
 * rather than picked. Three things do it together, and none of them is enough alone.
 *
 * 1. **The stack is read where it stands.** Nothing here moves focus when a toast arrives; the element
 *    appears beside the reader's work and the reader's caret does not move.
 * 2. **Attention suspends every clock in the stack, not only the one under it.** Pointer or focus
 *    anywhere in the host pauses every toast in it, so an older toast cannot vanish out from under
 *    a reader who is answering a newer one — which would move the very control they were reaching
 *    for. `toast.ts` holds the clocks; this module tells them when.
 * 3. **A key press is the door in.** `hotkey` (`F8` by default, and the same key Radix and Sonner's
 *    stacks settled on) moves focus to the first control in the stack and REMEMBERS where it came
 *    from; Escape puts it back, and so does a toast closing under the reader's hand. That is the
 *    reader asking for the toast rather than the toast taking the reader, which is the distinction
 *    "must not steal focus" is actually about. `hotkey=""` turns it off for a host whose
 *    application already owns a key for it — Studio's command registry, say.
 *
 * The reader reaches the stack in one press, and the moment they do, nothing in it is on a clock.
 *
 * **The one document listener is registered here and released at unmount**, which is the opposite
 * of `select.ts`'s decision and for the opposite reason: that observer watches the element's own
 * subtree and dies with it, while this one is on the document and would outlive a removed host — a
 * dead stack answering a key press, holding the element it can no longer show. A re-parented host
 * loses its hotkey (the runtime initialises an element once, so nothing re-binds it); a host that
 * leaks one steals a key from the whole page, and of the two that is the worse.
 *
 * @docs extending/ui-kit
 */

import { TOAST_PAUSE, TOAST_RESUME, staysInside } from "./toast.ts";

/** The tag this sidecar belongs to. */
const HOST = "jx-toast-host";

/** What a reader can put the keyboard on, before the stack's own state is consulted. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The reactive scope a `jx-toast-host` document hands its handlers. */
export interface ToastHostState {
  /** The key that moves focus into the stack. Empty turns the gesture off. */
  hotkey: string;
  /** `polite`, `assertive` or `off`. */
  live: string;
  [key: string]: unknown;
}

/** Where focus was when the reader entered the stack, so it can be given back. */
const origins = new WeakMap<HTMLElement, HTMLElement>();

/** Each mounted host's document listener, so unmounting can take it off again. */
const listeners = new WeakMap<object, () => void>();

/** The `jx-toast-host` a listener bound at the host's root belongs to. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget ?? event.target;
  return target instanceof Element ? target.closest<HTMLElement>(HOST) : null;
}

/**
 * The controls a reader can reach in this stack, in DOM order.
 *
 * DOM order and nothing else: the stack is drawn in the order it is written, never reversed, so the
 * order a reader hears, the order they tab through and the order they see are one order. A closed
 * toast contributes nothing, because a control inside a `display: none` toast is a stop on the way
 * to nowhere.
 *
 * @param host The `jx-toast-host` element.
 * @returns The focusable controls of every open toast in it.
 */
export function focusablesIn(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (control) => control.closest<HTMLElement>("jx-toast")?.dataset["open"] !== undefined,
  );
}

/** Whether the keyboard is currently somewhere inside the stack. */
function holdsFocus(host: HTMLElement): boolean {
  const active = host.ownerDocument.activeElement;
  return active instanceof Node && host.contains(active);
}

/**
 * Put the keyboard on the first control in the stack, remembering where it came from.
 *
 * The host door as well as the hotkey's: an application with its own command for "go to
 * notifications" calls this and gets the same round trip, Escape included.
 *
 * @param host The `jx-toast-host` element.
 * @returns True when there was something to focus.
 */
export function focusStack(host: HTMLElement): boolean {
  const [first] = focusablesIn(host);
  if (!first) {
    return false;
  }
  const active = host.ownerDocument.activeElement;
  if (active instanceof HTMLElement && !host.contains(active)) {
    origins.set(host, active);
  }
  first.focus();
  return true;
}

/**
 * Give the keyboard back to whatever the reader left to come here.
 *
 * When there is nothing to give it back to — the stack was never entered by the hotkey, or the
 * element that had focus has since left the document — the caret is only let go of, never moved
 * somewhere of this module's choosing. Focus lands on the document, which is where the platform
 * puts it when an element holding it is hidden, and the reader's next Tab starts from the top
 * rather than from a toast that is no longer there.
 *
 * @param host The `jx-toast-host` element.
 * @returns True when focus was returned to a remembered element.
 */
export function returnFocus(host: HTMLElement): boolean {
  const origin = origins.get(host);
  origins.delete(host);
  if (origin?.isConnected === true) {
    origin.focus();
    return true;
  }
  const active = host.ownerDocument.activeElement;
  if (active instanceof HTMLElement && host.contains(active)) {
    active.blur();
  }
  return false;
}

/** Say the same thing to every toast in the stack. */
function tell(host: HTMLElement, name: string): void {
  for (const toast of host.querySelectorAll("jx-toast")) {
    toast.dispatchEvent(new Event(name));
  }
}

/**
 * The reader's attention arrived: suspend every clock in the stack.
 *
 * `pointerover` rather than `pointerenter`, because the host is `pointer-events: none` — the toasts
 * are what the pointer can land on, and only a bubbling event carries the news up to the stack that
 * owns them.
 *
 * @param state The host's reactive state.
 * @param event The `pointerover` or `focusin`.
 */
export function onStackHold(_state: ToastHostState, event: Event): void {
  const host = hostOf(event);
  if (host) {
    tell(host, TOAST_PAUSE);
  }
}

/**
 * The reader's attention left: let the clocks run again.
 *
 * A move between two toasts of one stack is not a departure, which is what {@link staysInside}
 * settles — without it, crossing the stack with the pointer would restart every clock in it once
 * per toast.
 *
 * @param state The host's reactive state.
 * @param event The `pointerout` or `focusout`.
 */
export function onStackRelease(_state: ToastHostState, event: Event): void {
  const host = hostOf(event);
  if (host && !staysInside(event)) {
    tell(host, TOAST_RESUME);
  }
}

/**
 * A toast closed. If it took the reader's focus with it, hand focus back.
 *
 * Only when the caret was inside the toast that closed, or has already fallen to the document:
 * closing an older toast while the reader is answering a newer one must not move them at all.
 *
 * @param state The host's reactive state.
 * @param event The `close` bubbling up from a toast.
 */
export function onStackClose(_state: ToastHostState, event: Event): void {
  const host = hostOf(event);
  if (!host) {
    return;
  }
  const active = host.ownerDocument.activeElement;
  const closed = event.target;
  const lost = active === null || active === host.ownerDocument.body;
  const inClosed = closed instanceof Node && active instanceof Node && closed.contains(active);
  if (lost || inClosed) {
    returnFocus(host);
  }
}

/**
 * Register the stack's key: the one that brings the keyboard here, and the one that takes it back.
 *
 * It is on the document rather than on the host, and it has to be: a key that only worked once
 * focus was already in the stack would answer the question it exists to answer with itself. A press
 * carrying a modifier is left alone, so a host may claim `F8` without taking `Ctrl+F8` from the
 * browser or the reader's own assistive software.
 *
 * @param state The host's reactive state.
 * @param host The element itself.
 */
export function onHostMount(state: ToastHostState, host: HTMLElement): void {
  const root = host.getRootNode() as Document | ShadowRoot;
  const onKeydown = (event: Event): void => {
    const press = event as KeyboardEvent;
    if (press.altKey || press.ctrlKey || press.metaKey) {
      return;
    }
    const wanted = typeof state.hotkey === "string" ? state.hotkey : "";
    if (wanted !== "" && press.key === wanted) {
      if (focusStack(host)) {
        press.preventDefault();
      }
      return;
    }
    if (press.key === "Escape" && holdsFocus(host)) {
      returnFocus(host);
      press.preventDefault();
    }
  };
  root.addEventListener("keydown", onKeydown);
  listeners.set(state, () => root.removeEventListener("keydown", onKeydown));
}

/**
 * Take the key back when the stack leaves the document.
 *
 * @param state The host's reactive state.
 */
export function onHostUnmount(state: ToastHostState): void {
  listeners.get(state)?.();
  listeners.delete(state);
}
