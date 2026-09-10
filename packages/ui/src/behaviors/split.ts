/**
 * `jx-split`'s behaviour sidecar: the pointer maths, the keyboard, and the collapse toggle.
 *
 * The element is one `role="separator"` box between two things, and the platform gives a
 * role-carrying custom element none of what a window splitter owes a reader — so all of it is
 * here.
 *
 * **The value is a FRACTION of the box the splitter divides, and that is the whole design.** A
 * splitter has no size of its own to report; what it reports is where it sits, and the only honest
 * unit for that is the leading side's share of the track. Everything else follows: `gap` is a pixel
 * floor converted into that unit at gesture time, a drag is a pointer delta over the measured track
 * length, and the same stored number survives a window resize because it never meant pixels. A host
 * that wants pixels is resizing a PANEL rather than moving a split, which is a different element
 * and, in Studio, still `ui/panel-resize.ts`.
 *
 * **The track is measured, not declared.** {@link trackOf} walks up to the first ancestor that
 * generates a box with a length along the dragged axis, skipping `display: contents` wrappers —
 * which is not a nicety: Studio's pane grid puts the splitter inside two of them precisely so it
 * lands as a grid item between the two cells, and the box it actually divides is the grid two
 * levels up. Measuring at `pointerdown` rather than taking a prop is what keeps the bounds honest
 * across a window resize with no listener anywhere: a prop computed from a width is stale the
 * moment the width changes, and a splitter whose floor is stale lets a pane go below its minimum.
 *
 * **An unlaid-out track answers nothing rather than answering at its origin**, the same rule
 * `color-area.ts` states: with no geometry there is no fraction, so a drag is refused outright. The
 * KEYBOARD is not refused — {@link boundsOf} falls back to the declared `min`/`max` — because a
 * step is arithmetic on a number the element already has, and a splitter that could not be moved by
 * a reader who cannot see it would fail SC 2.1.1 on a technicality of layout timing.
 *
 * **Enter and a double click are one gesture with two doors, and they are what clears SC 2.5.7.**
 * The success criterion asks for a single-pointer alternative to dragging, which the arrow keys do
 * not supply (those answer 2.1.1). A double click that collapses the split and restores it is that
 * alternative; Enter is the same move from the keyboard. `collapse` says where "collapsed" is —
 * `min` by default, because that is what collapsing means for most splitters, and any position a
 * host names for one whose two sides are both real panes.
 *
 * @docs extending/ui-kit
 */

/** The tag this sidecar belongs to. */
const HOST = "jx-split";

/** Below this, two fractions are the same position. */
const EPSILON = 1e-6;

/** The reactive scope a `jx-split` document hands its handlers. */
export interface SplitState {
  /** Where the splitter sits: the leading side's share of the track, 0-1. */
  value: number;
  /** The smallest share the leading side may have. */
  min: number;
  /** The largest. */
  max: number;
  /** The smallest EITHER side may be, in pixels of the measured track. */
  gap: number;
  /** What one arrow key moves the value by. */
  step: number;
  /** What `Shift`+Arrow moves it by. */
  largeStep: number;
  /** `horizontal` or `vertical` — the separator's own orientation. */
  orientation: string;
  /** Whether the element refuses to move. */
  disabled: boolean;
  /** The value Enter and a double click move to, and back from. */
  collapse: number;
  /** Whether a pointer gesture is live. Written here, styled by the element. */
  dragging: boolean;
  /** The position the toggle returns to; negative until a collapse has recorded one. */
  restore: number;
  [key: string]: unknown;
}

/** One live gesture: where it started, and the bounds it was measured against. */
interface Drag {
  /** The pointer coordinate at `pointerdown`, along the dragged axis. */
  origin: number;
  /** The value at `pointerdown`. */
  start: number;
  /** The track's length along that axis, measured once. */
  length: number;
  lo: number;
  hi: number;
}

/**
 * The gestures in flight, by element.
 *
 * A `WeakMap` rather than a module `Set` of ids: the key IS the element, so a splitter whose row
 * the runtime drops mid-gesture takes its record with it rather than leaving one behind for a
 * future element at the same address.
 */
const drags = new WeakMap<HTMLElement, Drag>();

/** The `jx-split` an event is being handled on. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === HOST ? target : null;
}

/** Say the value moved, from the HOST, in the platform's own names. */
function announce(host: HTMLElement, ...names: string[]): void {
  for (const name of names) {
    host.dispatchEvent(new Event(name, { bubbles: true, composed: true }));
  }
}

/** A number, or the fallback when the scope holds something that is not one. */
function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** A POSITIVE number, or the fallback. A step of zero is a key that does nothing. */
function positiveOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Whether the separator is dragged along x.
 *
 * Only `"horizontal"` turns it, the same one-value vocabulary `jx-divider` states: an unknown value
 * falls back to the base case rather than to nothing.
 */
function isVertical(state: SplitState): boolean {
  return String(state.orientation) !== "horizontal";
}

/** The pointer coordinate along the dragged axis. */
function coordOf(vertical: boolean, event: { clientX: number; clientY: number }): number {
  return vertical ? event.clientX : event.clientY;
}

/**
 * The length of the box the splitter divides, along the dragged axis.
 *
 * Two ancestors are skipped, and each for its own reason. One that computes `display: contents`
 * generates no box at all, so whatever a browser reports for it describes its children rather than
 * the track. One that measures zero is either unlaid-out or a wrapper of the same shape that this
 * realm cannot see through — walking past it costs a frame's work once per gesture and is the only
 * thing that makes the pane grid's two nested `display: contents` rows measurable at all.
 *
 * @param host The element.
 * @param vertical Whether the drag is along x.
 * @returns The length in pixels, or 0 when nothing above the splitter has one.
 */
function trackOf(host: HTMLElement, vertical: boolean): number {
  for (let node = host.parentElement; node; node = node.parentElement) {
    if (globalThis.getComputedStyle(node).display === "contents") {
      continue;
    }
    const box = node.getBoundingClientRect();
    const length = vertical ? box.width : box.height;
    if (length > 0) {
      return length;
    }
  }
  return 0;
}

/**
 * The range the value may take right now: the declared bounds, narrowed by the pixel gap.
 *
 * The two are an INTERSECTION rather than a choice, because they answer different questions —
 * `min`/`max` is the host's policy about the split and `gap` is the smallest a side can usefully be
 * — and a splitter has to respect both. The gap is converted here, against the track measured this
 * instant, which is why neither prop has to be recomputed by anybody when the window resizes.
 *
 * **A track too narrow for two gaps has no legal position, and the answer is the middle of the
 * crossed bounds** rather than one end of them. With a symmetric gap that is the even split, which
 * is the only position that treats the two sides alike when neither can have its minimum.
 *
 * @param state The element's reactive scope.
 * @param host The element.
 */
function boundsOf(
  state: SplitState,
  host: HTMLElement,
): { lo: number; hi: number; length: number } {
  const length = trackOf(host, isVertical(state));
  const min = finiteOr(state.min, 0);
  const max = finiteOr(state.max, 1);
  const gap = length > 0 ? Math.max(0, finiteOr(state.gap, 0)) / length : 0;
  let lo = Math.max(min, gap);
  let hi = Math.min(max, 1 - gap);
  if (lo > hi) {
    const mid = (lo + hi) / 2;
    lo = mid;
    hi = mid;
  }
  return { hi, length, lo };
}

/**
 * Move the splitter, bounded. Answers whether anything actually moved.
 *
 * @param state The element's reactive scope.
 * @param next Where it is being asked to go.
 * @param lo The low bound.
 * @param hi The high one.
 */
function writeValue(state: SplitState, next: number, lo: number, hi: number): boolean {
  const bounded = Math.min(hi, Math.max(lo, next));
  if (!Number.isFinite(bounded) || bounded === Number(state.value)) {
    return false;
  }
  state.value = bounded;
  return true;
}

/**
 * Where the collapse toggle goes next, recording where it came from.
 *
 * Sitting at the collapsed position means the next press restores; anywhere else means the next
 * press collapses and remembers. **A splitter that was BORN collapsed still opens**: with nothing
 * remembered — or with a memory that is the collapsed position itself — the toggle goes to the
 * middle of the legal range, which is a defined, reachable, uncollapsed place. Without that clause
 * the first press on a splitter whose stored position happens to equal `collapse` would be a
 * control that visibly does nothing, and the reader has no way to tell that from a broken one.
 *
 * @param state The element's reactive scope.
 * @param lo The low bound.
 * @param hi The high one.
 */
function toggleTarget(state: SplitState, lo: number, hi: number): number {
  const collapse = Math.min(hi, Math.max(lo, finiteOr(state.collapse, lo)));
  const value = Number(state.value);
  if (Math.abs(value - collapse) > EPSILON) {
    state.restore = value;
    return collapse;
  }
  const restore = finiteOr(state.restore, -1);
  return restore >= 0 && Math.abs(restore - collapse) > EPSILON ? restore : (lo + hi) / 2;
}

/**
 * Which way an arrow key moves the value, or 0 for a key on the axis this splitter does not have.
 *
 * The CROSS-axis arrows are left alone rather than cancelled: a splitter is one tab stop inside
 * somebody's application, and swallowing ArrowUp on a column splitter would take a scroll away from
 * the reader for nothing.
 *
 * @param vertical Whether the drag is along x.
 * @param key The event's key.
 */
function signFor(vertical: boolean, key: string): number {
  if (vertical) {
    return key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  }
  return key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
}

/**
 * A pointer went down on the splitter: measure once, capture, and take the focus.
 *
 * The value does NOT jump to the pointer. A splitter is the thing under the cursor already, so
 * there is nothing to jump to, and a relative drag is what lets a reader nudge a split by three
 * pixels without the first frame throwing it somewhere else.
 *
 * `preventDefault` is what stops the drag selecting the text on either side of the splitter, and it
 * is why the focus is taken explicitly on the line after: a cancelled `pointerdown` never focuses,
 * and a splitter the reader has just used must be the thing the arrow keys move next.
 *
 * @param state The element's reactive scope.
 * @param event The pointer event.
 */
export function onSplitPointerDown(state: SplitState, event: PointerEvent): void {
  const host = hostOf(event);
  /* `button` through {@link finiteOr}, so a secondary button is refused and a synthetic event that
     carries no button at all is still a primary press — happy-dom builds one of each. */
  if (!host || state.disabled === true || finiteOr(event.button, 0) !== 0) {
    return;
  }
  const { hi, length, lo } = boundsOf(state, host);
  if (length <= 0) {
    return;
  }
  event.preventDefault();
  host.focus();
  drags.set(host, {
    hi,
    length,
    lo,
    origin: coordOf(isVertical(state), event),
    start: Number(state.value),
  });
  if (typeof host.setPointerCapture === "function") {
    /* Capture on the HOST, which is also the element the listener is on: a drag that runs off the
       end of the splitter keeps arriving here instead of stopping at whatever it crossed. */
    host.setPointerCapture(event.pointerId);
  }
  state.dragging = true;
}

/**
 * The drag itself. Nothing moves without a press first, so a hover across the splitter moves no
 * split.
 *
 * The bounds and the track length are the ones measured at `pointerdown` rather than re-read here:
 * a gesture is one continuous act, and a floor that moved under it — the window resized mid-drag —
 * would make the same pointer distance mean two different things.
 *
 * @param state The element's reactive scope.
 * @param event The pointer event.
 */
export function onSplitPointerMove(state: SplitState, event: PointerEvent): void {
  const host = hostOf(event);
  const drag = host ? drags.get(host) : undefined;
  if (!host || !drag) {
    return;
  }
  const moved = coordOf(isVertical(state), event) - drag.origin;
  if (writeValue(state, drag.start + moved / drag.length, drag.lo, drag.hi)) {
    announce(host, "input");
  }
}

/**
 * Every way a gesture can END, not just the happy one.
 *
 * Bound to `pointerup`, `pointercancel` and `lostpointercapture` alike. `pointerup` alone left a
 * capture lost any other way — the system taking the pointer, a touch gesture being stolen, the
 * element's subtree being replaced under it — with the record still in the map and the element
 * still drawn as though a hand were on it, and no further event able to clear either.
 *
 * The record is deleted FIRST, which is what makes releasing the capture safe: the release itself
 * fires `lostpointercapture`, and the second pass through here finds nothing to end.
 *
 * `change` is dispatched even when the last move changed nothing, because the commit is about the
 * gesture ending rather than about the final pixel.
 *
 * @param state The element's reactive scope.
 * @param event The pointer event.
 */
export function onSplitPointerUp(state: SplitState, event: PointerEvent): void {
  const host = hostOf(event);
  if (!host || !drags.delete(host)) {
    return;
  }
  state.dragging = false;
  if (
    typeof host.releasePointerCapture === "function" &&
    host.hasPointerCapture?.(event.pointerId)
  ) {
    host.releasePointerCapture(event.pointerId);
  }
  announce(host, "change");
}

/**
 * The splitter keyboard: the arrows of its own axis, Home and End, and Enter for the toggle.
 *
 * A keystroke is a move AND a commit, which is what the platform's own arrow does on a range: a
 * host that persists on `change` persists once per key rather than never.
 *
 * Every key this element does not own reaches the host untouched — the same obligation `jx-tree`
 * carries — so Tab still leaves, and an application chord pressed with the caret on a splitter
 * still runs.
 *
 * @param state The element's reactive scope.
 * @param event The keydown.
 */
export function onSplitKeydown(state: SplitState, event: KeyboardEvent): void {
  const host = hostOf(event);
  if (!host || state.disabled === true) {
    return;
  }
  const { hi, lo } = boundsOf(state, host);
  let next: number;
  if (event.key === "Home") {
    next = lo;
  } else if (event.key === "End") {
    next = hi;
  } else if (event.key === "Enter") {
    next = toggleTarget(state, lo, hi);
  } else {
    const sign = signFor(isVertical(state), event.key);
    if (sign === 0) {
      return;
    }
    const step = event.shiftKey ? positiveOr(state.largeStep, 0.1) : positiveOr(state.step, 0.02);
    next = Number(state.value) + sign * step;
  }
  event.preventDefault();
  if (writeValue(state, next, lo, hi)) {
    announce(host, "input", "change");
  }
}

/**
 * A double click collapses the split, and the next one restores it.
 *
 * This is the SC 2.5.7 door rather than a convenience. It is deliberately the same function Enter
 * runs, so the pointer alternative cannot drift from the keyboard one.
 *
 * @param state The element's reactive scope.
 * @param event The double click.
 */
export function onSplitDoubleClick(state: SplitState, event: MouseEvent): void {
  const host = hostOf(event);
  if (!host || state.disabled === true) {
    return;
  }
  const { hi, lo } = boundsOf(state, host);
  if (writeValue(state, toggleTarget(state, lo, hi), lo, hi)) {
    announce(host, "input", "change");
  }
}
