/**
 * `jx-color-slider`'s behaviour sidecar: ten steps, and the family's one event contract.
 *
 * The element is ONE native `<input type="range">` drawn over a gradient, so almost nothing is left
 * for this file. The platform owns the thumb, the drag, the along-axis arrows with their clamping
 * and snapping, Home, End, PageUp, PageDown, the focus ring, `:disabled`, and every word of
 * `role="slider"` with its `aria-valuemin`, `aria-valuemax` and `aria-valuenow`. Those are not
 * re-implemented here, and an arrow key with no `Shift` on it returns from {@link onSliderKeydown}
 * untouched so that stays true.
 *
 * TWO THINGS ARE THE KIT'S.
 *
 * `Shift`+Arrow moves ten steps, which is the same coarse gesture `jx-number-field` adds and which
 * the platform has on no range. It is arithmetic through `snapToStep` rather than `stepUp`: a
 * range's value is already on its own grid — the platform sanitizes it there — so the two agree
 * here, and the arithmetic is the one that also runs where `stepUp` is not implemented.
 *
 * The inner control's own `input` and `change` are STOPPED and re-dispatched from the host, which
 * is `jx-color-area`'s contract and is adopted here so the family reads one way. A host listening
 * for a colour reads `e.target.value` off the ELEMENT — a number in the element's own units — and
 * never has to know whether the event came from a hue track, an alpha track or a square. The cost
 * is one dispatch per keystroke; the alternative is a host that must ask which node fired.
 *
 * @docs extending/ui-kit
 */

import { snapToStep } from "../color.ts";

/** The tag this sidecar belongs to. */
const HOST = "jx-color-slider";

/** The reactive scope a `jx-color-slider` document hands its handlers. */
export interface ColorSliderState {
  /** Where the thumb is, in the track's own units. */
  value: number;
  /** The bottom of the track's range. */
  min: number;
  /** The top of it, already resolved: the element computes it from `max` and `channel`. */
  maxValue: number;
  /** The grid the value moves on. */
  step: number;
  /** Whether the element refuses to move. */
  disabled: boolean;
  [key: string]: unknown;
}

/** Which way each arrow moves the value. */
const KEY_SIGN: Readonly<Record<string, number>> = {
  ArrowDown: -1,
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

/** The `jx-color-slider` an event is being handled on. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof HTMLElement && target.localName === HOST ? target : null;
}

/** The element's own native range. */
function controlOf(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[part="input"]');
}

/** Say the value moved, from the HOST, in the platform's own names. */
function announce(host: HTMLElement, ...names: string[]): void {
  for (const name of names) {
    host.dispatchEvent(new Event(name, { bubbles: true }));
  }
}

/**
 * The bounds and grid as numbers.
 *
 * The top comes from `maxValue`, which the DOCUMENT computes from `max` and `channel` — a hue track
 * runs to 360 and an alpha track to 100, and neither is a number an author should have to remember
 * to write. Resolving it in the document rather than here keeps one definition: the same computed
 * is what the inner range's own `max` attribute is bound to, so the platform's clamp and this one
 * cannot drift apart.
 */
function boundsOf(state: ColorSliderState): { min: number; max: number; step: number } {
  const min = Number.isFinite(Number(state.min)) ? Number(state.min) : 0;
  const top = Number(state.maxValue);
  const step = Number(state.step);
  return {
    max: Number.isFinite(top) && top > min ? top : 360,
    min,
    step: Number.isFinite(step) && step > 0 ? step : 1,
  };
}

/**
 * The inner range's `input`: mirror it, and re-say it from the host.
 *
 * @param state The element's reactive scope.
 * @param event The range's own input event.
 */
export function onSliderInput(state: ColorSliderState, event: Event): void {
  const host = hostOf(event);
  if (!host || event.target === host) {
    /* The listener sits on the ROOT so `currentTarget` is the element, which means it also hears
       the element's own re-dispatch. That one has already been accounted for. */
    return;
  }
  event.stopPropagation();
  state.value = Number((event.target as HTMLInputElement).value);
  announce(host, "input");
}

/**
 * The inner range's `change`: the same stop, and the commit re-said from the host.
 *
 * @param state The element's reactive scope.
 * @param event The range's own change event.
 */
export function onSliderChange(state: ColorSliderState, event: Event): void {
  const host = hostOf(event);
  if (!host || event.target === host) {
    return;
  }
  event.stopPropagation();
  state.value = Number((event.target as HTMLInputElement).value);
  announce(host, "change");
}

/**
 * `Shift`+Arrow: ten steps, cancelled so the platform's own single step does not run on top.
 *
 * @param state The element's reactive scope.
 * @param event The keydown.
 */
export function onSliderKeydown(state: ColorSliderState, event: KeyboardEvent): void {
  const host = hostOf(event);
  const sign = KEY_SIGN[event.key];
  if (!host || !sign || !event.shiftKey || state.disabled === true) {
    return;
  }
  event.preventDefault();
  const { max, min, step } = boundsOf(state);
  const next = snapToStep(Number(state.value) + sign * step * 10, step, min, max);
  if (next === Number(state.value)) {
    return;
  }
  state.value = next;
  /* The control follows through its own binding, but the binding is what a RENDER does and the
     events go out now, so the control is written here too: a host that reads the range back out of
     `e.target` during the handler must not see the value it had before the key. */
  const control = controlOf(host);
  if (control) {
    control.value = String(next);
  }
  announce(host, "input", "change");
}
