/**
 * `jx-color-area`'s behaviour sidecar: the pointer maths, the second axis's arrow keys, and the one
 * place the family's event contract is written from.
 *
 * WHY THERE ARE TWO NATIVE RANGES INSIDE A SQUARE. A saturation/brightness field is a `slider` in
 * two dimensions, and ARIA has no such role: the APG's answer, and the platform's, is TWO sliders.
 * So the element is two real `<input type="range">`s — one per axis — and everything a slider owes
 * a reader comes from them rather than from an authored imitation: `role="slider"`, the focus, the
 * tab stops, `aria-valuemin`/`max`/`now` derived from the control's own `min`, `max` and `value`,
 * the announcement when the value moves, form-control disabled semantics, and the along-axis arrow
 * keys with their Home, End, PageUp and PageDown. They are transparent and `pointer-events: none`
 * rather than `display: none`, because a control the platform has hidden is a control the
 * accessibility tree does not have.
 *
 * WHAT IS LEFT FOR THIS FILE IS EXACTLY WHAT A SLIDER CANNOT KNOW.
 *
 * 1. **The other axis.** A range knows one dimension, so ArrowUp on the saturation control is the
 *    platform stepping SATURATION — which, to a reader looking at one square with one thumb in it,
 *    is the thumb moving sideways when they pressed up. The cross-axis keys are cancelled here and
 *    applied to the axis the reader meant. The along-axis keys are NOT touched: those are the
 *    platform's, they already clamp and snap, and two implementations of one key is two answers.
 * 2. **Ten steps.** `Shift`+Arrow is the kit's coarse step, as it is on `jx-number-field`, and the
 *    platform has no such gesture on a range.
 * 3. **The pointer.** A square has no native drag, so pointerdown, move and up are read against the
 *    track's own box. WCAG 2.5.7 is met by the ranges rather than by the drag: every value the
 *    pointer can reach is reachable with the arrow keys, and a single click with no movement sets
 *    the value outright, so no dragging motion is REQUIRED for any of it.
 *
 * THE ELEMENT IS THE SINGLE SOURCE OF EVENTS, and this is the one place in the kit where a native
 * control's own `input` and `change` are stopped. `jx-number-field` lets them bubble because its
 * control's value IS its value; here the two controls hold half a coordinate each, so a host that
 * heard them would read `e.target.value` as `"64"` and have no way to know which axis it was. Every
 * path — a key, a drag, a click — therefore dispatches `input` and `change` FROM THE HOST, whose
 * own `hue`, `saturation` and `brightness` props are the whole answer. One `e.target`, one
 * reading.
 *
 * @docs extending/ui-kit
 */

import { snapToStep } from "../color.ts";

/** The tag this sidecar belongs to. */
const HOST = "jx-color-area";

/** The reactive scope a `jx-color-area` document hands its handlers. */
export interface ColorAreaState {
  /** The hue the square is drawn under, 0-360. Read, never written here. */
  hue: number;
  /** The horizontal axis, 0-100. */
  saturation: number;
  /** The vertical axis, 0-100, measured upward from the bottom edge. */
  brightness: number;
  /** The grid both axes move on. */
  step: number;
  /** Whether the element refuses to move. */
  disabled: boolean;
  [key: string]: unknown;
}

/** Which state key each axis writes. `x` is saturation and `y` is brightness. */
const AXIS_KEY = { x: "saturation", y: "brightness" } as const;

/** The axis a key belongs to when nothing cancels it. */
const KEY_AXIS: Readonly<Record<string, "x" | "y">> = {
  ArrowDown: "y",
  ArrowLeft: "x",
  ArrowRight: "x",
  ArrowUp: "y",
};

/** Which way each arrow moves its axis. Up and Right increase; the square's y is measured upward. */
const KEY_SIGN: Readonly<Record<string, number>> = {
  ArrowDown: -1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

/** The hosts with a pointer down on them. Off to the side, because a drag is not element state. */
const dragging = new WeakSet<HTMLElement>();

/** The `jx-color-area` an event is being handled on. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === HOST ? target : null;
}

/** The element's own gradient box, which is what a pointer coordinate is measured against. */
function trackOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[part="track"]');
}

/** The axis a node is, read off its own `part`; null for anything that is neither range. */
function axisOf(node: EventTarget | null): "x" | "y" | null {
  if (!(node instanceof Element)) {
    return null;
  }
  const part = node.getAttribute("part");
  return part === "x" || part === "y" ? part : null;
}

/** The step, never zero: a zero step would snap every coordinate onto the minimum. */
function stepOf(state: ColorAreaState): number {
  const step = Number(state.step);
  return Number.isFinite(step) && step > 0 ? step : 1;
}

/**
 * Say the value moved, from the HOST, in the platform's own names.
 *
 * @param host The element.
 * @param names Which of `input` and `change` to dispatch, in order.
 */
function announce(host: HTMLElement, ...names: string[]): void {
  for (const name of names) {
    host.dispatchEvent(new Event(name, { bubbles: true }));
  }
}

/**
 * Write one axis, snapped to the grid and held inside 0-100.
 *
 * @param state The element's reactive scope.
 * @param axis Which axis.
 * @param value The value before snapping.
 * @returns Whether the write moved anything, so a no-op key dispatches nothing.
 */
function writeAxis(state: ColorAreaState, axis: "x" | "y", value: number): boolean {
  const key = AXIS_KEY[axis];
  const next = snapToStep(value, stepOf(state), 0, 100);
  if (state[key] === next) {
    return false;
  }
  state[key] = next;
  return true;
}

/**
 * The inner range's `input`: mirror the axis it holds, and re-say it from the host.
 *
 * The native event is stopped here. See the file's header: two controls holding half a coordinate
 * each cannot both be `e.target` for one value.
 *
 * @param state The element's reactive scope.
 * @param event The range's own input event.
 */
export function onAreaAxisInput(state: ColorAreaState, event: Event): void {
  const host = hostOf(event);
  const axis = axisOf(event.target);
  if (!host || !axis) {
    return;
  }
  event.stopPropagation();
  writeAxis(state, axis, Number((event.target as HTMLInputElement).value));
  announce(host, "input");
}

/**
 * The inner range's `change`: the same stop, and the commit re-said from the host.
 *
 * @param state The element's reactive scope.
 * @param event The range's own change event.
 */
export function onAreaAxisChange(state: ColorAreaState, event: Event): void {
  const host = hostOf(event);
  const axis = axisOf(event.target);
  if (!host || !axis) {
    return;
  }
  event.stopPropagation();
  writeAxis(state, axis, Number((event.target as HTMLInputElement).value));
  announce(host, "change");
}

/**
 * The two keyboard jobs a range cannot do for itself: the OTHER axis, and ten steps.
 *
 * An along-axis arrow with no Shift returns untouched, so the platform's own step, clamp and
 * announcement run exactly as they would on any range. Everything this does handle is cancelled, so
 * the two never both act on one press.
 *
 * @param state The element's reactive scope.
 * @param event The keydown, from either range.
 */
export function onAreaKeydown(state: ColorAreaState, event: KeyboardEvent): void {
  const host = hostOf(event);
  const focused = axisOf(event.target);
  if (!host || !focused || state.disabled === true) {
    return;
  }
  const axis = KEY_AXIS[event.key];
  if (!axis) {
    return;
  }
  if (axis === focused && !event.shiftKey) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const delta = stepOf(state) * (event.shiftKey ? 10 : 1) * (KEY_SIGN[event.key] ?? 0);
  if (writeAxis(state, axis, Number(state[AXIS_KEY[axis]]) + delta)) {
    /* Both names: a keystroke on a slider is a move AND a commit, which is what the platform's own
       arrow does on the axis it owns. A key that changed nothing says nothing. */
    announce(host, "input", "change");
  }
}

/**
 * Read a pointer coordinate into both axes.
 *
 * @param state The element's reactive scope.
 * @param host The element.
 * @param event The pointer event.
 * @returns Whether anything moved.
 */
function fromPointer(state: ColorAreaState, host: HTMLElement, event: PointerEvent): boolean {
  const track = trackOf(host);
  if (!track) {
    return false;
  }
  const box = track.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) {
    /* An unlaid-out box would put every coordinate at the origin, which is a colour the reader did
       not ask for. Saying nothing is the right answer to a question with no geometry in it. */
    return false;
  }
  const x = writeAxis(state, "x", ((event.clientX - box.left) / box.width) * 100);
  const y = writeAxis(state, "y", (1 - (event.clientY - box.top) / box.height) * 100);
  return x || y;
}

/**
 * A pointer went down on the square: take the value, take the capture, and put the caret on the
 * horizontal range so the keyboard carries on from where the pointer stopped.
 *
 * @param state The element's reactive scope.
 * @param event The pointer event.
 */
export function onAreaPointerDown(state: ColorAreaState, event: PointerEvent): void {
  const host = hostOf(event);
  if (!host || state.disabled === true) {
    return;
  }
  event.preventDefault();
  dragging.add(host);
  const track = trackOf(host);
  if (track && typeof track.setPointerCapture === "function") {
    /* Capture on the TRACK, so a drag that leaves the square keeps arriving here rather than
       stopping wherever the pointer crossed the edge. */
    track.setPointerCapture(event.pointerId);
  }
  host.querySelector<HTMLElement>('[part="x"]')?.focus();
  if (fromPointer(state, host, event)) {
    announce(host, "input");
  }
}

/**
 * The drag itself. Nothing happens without a pointer down first, so a hover moves no colour.
 *
 * @param state The element's reactive scope.
 * @param event The pointer event.
 */
export function onAreaPointerMove(state: ColorAreaState, event: PointerEvent): void {
  const host = hostOf(event);
  if (!host || !dragging.has(host)) {
    return;
  }
  if (fromPointer(state, host, event)) {
    announce(host, "input");
  }
}

/**
 * The pointer came up, or the gesture was taken away: the value is committed once.
 *
 * `change` is dispatched even when the last move changed nothing, because the commit is about the
 * gesture ending rather than about the final pixel — a click that lands exactly on the current
 * value is still the reader choosing it. Nothing is read out of the scope: every value the gesture
 * produced was written on the way here.
 *
 * @param _state The element's reactive scope, unread.
 * @param event The pointer event.
 */
export function onAreaPointerUp(_state: ColorAreaState, event: PointerEvent): void {
  const host = hostOf(event);
  if (!host || !dragging.delete(host)) {
    return;
  }
  const track = trackOf(host);
  if (
    track &&
    typeof track.releasePointerCapture === "function" &&
    track.hasPointerCapture?.(event.pointerId)
  ) {
    track.releasePointerCapture(event.pointerId);
  }
  announce(host, "change");
}
