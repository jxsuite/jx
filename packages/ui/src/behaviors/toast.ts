/**
 * `jx-toast`'s behaviour sidecar: the timer that retires a toast, the holds that suspend it, and
 * the one function that closes a toast and says why.
 *
 * A toast is the only element in the kit whose lifetime is a CLOCK rather than a state, and every
 * decision here follows from that.
 *
 * **The timer is suspended, never merely restarted.** While the pointer rests on a toast, while
 * focus is inside it, and while the stack it belongs to is being read, its clock does not run — and
 * it resumes with the time that was LEFT rather than from the top. That is WCAG 2.2.1's "pause" as
 * an author can honour it without a dialog, and it is what makes the element's other promise true:
 * a recovery control the reader has reached cannot expire under their hand, because reaching it is
 * itself what stopped the clock. A hold is a NAMED reason — `pointer`, `focus`, `stack` — held in a
 * set rather than a boolean, because the three overlap: a pointer leaving a toast the reader has
 * tabbed into must not restart a clock the focus is still holding.
 *
 * **Nothing here calls `focus()`.** A toast is a status message: it appears beside the reader's
 * work and never takes the keyboard from it. Moving focus INTO a stack is the reader's own gesture
 * and lives in `toast-host.ts`, behind a key they press.
 *
 * **A toast the host closes is silent.** `close` is dispatched only when the element itself decided
 * — the clock ran out, the dismiss button was pressed, the recovery control was used — so a host
 * writing `open = false` hears nothing back about a thing it just did.
 *
 * @docs extending/ui-kit
 */

/** The tag this sidecar belongs to. */
const HOST = "jx-toast";

/** Why a toast closed, as the `close` event's `detail.reason`. */
export type ToastCloseReason = "timeout" | "dismissed" | "action";

/** The event a `jx-toast-host` dispatches at each toast to suspend its clock. */
export const TOAST_PAUSE = "jx-toast-pause";

/** The event a `jx-toast-host` dispatches at each toast to let its clock run again. */
export const TOAST_RESUME = "jx-toast-resume";

/** The reactive scope a `jx-toast` document hands its handlers. */
export interface ToastState {
  /** Whether the toast is showing. The host writes it; the clock reads it. */
  open: boolean;
  /** How long the toast rests before retiring itself, in ms. `0` never retires. */
  timeout: number;
  /** `info`, `positive`, `negative` or `warning`. */
  variant: string;
  [key: string]: unknown;
}

/** One toast's clock: what is left of it, when this run started, and what is holding it. */
interface Clock {
  timer: ReturnType<typeof setTimeout> | null;
  /** Milliseconds still to run. Recomputed every time the clock is suspended. */
  remaining: number;
  /** When the current run began, for the subtraction that suspending does. */
  startedAt: number;
  /** The reasons the clock is suspended. Empty means it may run. */
  holds: Set<string>;
}

/** Which hold an event asks for. Three channels, because they overlap and must not cancel. */
const HOLD_REASON: Readonly<Record<string, string>> = {
  focusin: "focus",
  focusout: "focus",
  [TOAST_PAUSE]: "stack",
  [TOAST_RESUME]: "stack",
  pointerenter: "pointer",
  pointerleave: "pointer",
  pointerout: "pointer",
  pointerover: "pointer",
};

/** Each scope's clock. */
const clocks = new WeakMap<object, Clock>();

/** The element each scope belongs to, learned at mount. */
const hosts = new WeakMap<object, HTMLElement>();

/** This scope's clock, minted on first sight. */
function clockOf(state: object): Clock {
  const found = clocks.get(state);
  if (found) {
    return found;
  }
  const fresh: Clock = { holds: new Set(), remaining: 0, startedAt: 0, timer: null };
  clocks.set(state, fresh);
  return fresh;
}

/** The `jx-toast` a listener bound anywhere inside the element belongs to. */
function ownerOf(event: Event): HTMLElement | null {
  const target = event.currentTarget ?? event.target;
  return target instanceof Element ? target.closest<HTMLElement>(HOST) : null;
}

/**
 * Whether a leaving event is really leaving.
 *
 * `focusout` fires when focus moves from a toast's recovery control to its dismiss button, and
 * `pointerout` fires crossing between two toasts in one stack — both of them a departure only if
 * you do not ask where the pointer or the focus WENT. Without this, a reader tabbing along a
 * toast's own controls restarts the clock they are standing on at every step.
 *
 * @param event A `focusout` or `pointerout`, whose `relatedTarget` says where it went.
 * @returns True when the destination is still inside the element the listener is bound to.
 */
export function staysInside(event: Event): boolean {
  const to = (event as { relatedTarget?: unknown }).relatedTarget;
  const from = event.currentTarget;
  return to instanceof Node && from instanceof Node && from.contains(to);
}

/** Stop the clock's timer without touching what is left of it. */
function park(clock: Clock): void {
  if (clock.timer !== null) {
    clearTimeout(clock.timer);
    clock.timer = null;
  }
}

/** Run the clock for whatever is left, unless it is held, closed or sticky. */
function schedule(state: ToastState): void {
  const clock = clockOf(state);
  park(clock);
  if (state.open !== true || clock.holds.size > 0 || clock.remaining <= 0) {
    return;
  }
  clock.startedAt = Date.now();
  clock.timer = setTimeout(() => {
    clock.timer = null;
    const host = hosts.get(state);
    if (host) {
      closeToast(host, "timeout");
    }
  }, clock.remaining);
}

/**
 * Close a toast and say why.
 *
 * The host door as well as the element's own: a host that retires a toast from its own code closes
 * it through here, and the `close` its listeners hear is the same event the dismiss button raises.
 * Closing a closed toast says nothing, so a dismiss that races the clock is one event rather than
 * two.
 *
 * @param host The `jx-toast` element.
 * @param reason Why it closed.
 */
export function closeToast(host: HTMLElement, reason: ToastCloseReason): void {
  const el = host as HTMLElement & { open?: boolean };
  if (el.open !== true) {
    return;
  }
  el.open = false;
  host.dispatchEvent(new CustomEvent("close", { bubbles: true, detail: { reason } }));
}

/**
 * Learn the element, start the clock, and follow `open` for the rest of the toast's life.
 *
 * `data-open` is what moves when anything writes `open` — the attribute, the property, or the
 * element's own retirement — so one observer on it is the whole subscription. The same idiom
 * `jx-color-field` uses for `data-value`, and for the same reason: a sidecar cannot watch reactive
 * state, but it can watch the attribute that state writes.
 *
 * @param state The toast's reactive state.
 * @param host The element itself.
 */
export function onToastMount(state: ToastState, host: HTMLElement): void {
  hosts.set(state, host);
  const clock = clockOf(state);
  clock.remaining = Number(state.timeout) || 0;
  schedule(state);
  const observer = new MutationObserver(() => {
    if (state.open === true) {
      clock.remaining = Number(state.timeout) || 0;
      schedule(state);
      return;
    }
    park(clock);
  });
  observer.observe(host, { attributeFilter: ["data-open"], attributes: true });
}

/**
 * Stop the clock when the toast leaves the document.
 *
 * The element initialises ONCE — `connectedCallback` returns early on an element it has already
 * built — so a re-parented toast comes back with its observer intact and its clock stopped, which
 * is to say sticky. That is the safe direction and it is chosen rather than tolerated: a sticky
 * toast still carries its dismiss button, whereas a timer that survived removal would retire a
 * toast the host had already taken away and put back, dispatching `close` for a toast the reader
 * never saw expire.
 *
 * @param state The toast's reactive state.
 */
export function onToastUnmount(state: ToastState): void {
  park(clockOf(state));
}

/**
 * Suspend the clock: the pointer arrived, focus arrived, or the stack asked.
 *
 * @param state The toast's reactive state.
 * @param event The `pointerenter`, `focusin` or `jx-toast-pause` that asked.
 */
export function onToastHold(state: ToastState, event: Event): void {
  const clock = clockOf(state);
  const reason = HOLD_REASON[event.type] ?? event.type;
  if (clock.timer !== null) {
    clock.remaining = Math.max(1, clock.remaining - (Date.now() - clock.startedAt));
  }
  clock.holds.add(reason);
  park(clock);
}

/**
 * Let the clock run again, if nothing else is holding it.
 *
 * @param state The toast's reactive state.
 * @param event The `pointerleave`, `focusout` or `jx-toast-resume` that released it.
 */
export function onToastRelease(state: ToastState, event: Event): void {
  if (staysInside(event)) {
    return;
  }
  clockOf(state).holds.delete(HOLD_REASON[event.type] ?? event.type);
  schedule(state);
}

/**
 * The dismiss button.
 *
 * @param state The toast's reactive state.
 * @param event The button's click.
 */
export function onToastDismiss(_state: ToastState, event: Event): void {
  const host = ownerOf(event);
  if (host) {
    closeToast(host, "dismissed");
  }
}

/**
 * A click on the recovery control the consumer slotted in.
 *
 * The click is NOT stopped: the control is the event's target, so its own handler has already run,
 * and a host listening above the toast is entitled to hear it. What the element adds is the
 * retirement — an answer that has been given is not still being asked, and a toast that stayed
 * after its one recovery control was used would be a second thing to dismiss.
 *
 * @param state The toast's reactive state.
 * @param event The click, from inside the `action` slot.
 */
export function onToastAction(_state: ToastState, event: Event): void {
  const host = ownerOf(event);
  if (host) {
    closeToast(host, "action");
  }
}
