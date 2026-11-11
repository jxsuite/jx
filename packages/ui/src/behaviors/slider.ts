/**
 * `jx-slider`'s behaviour sidecar: ten steps, and one event contract.
 *
 * The element is ONE native `<input type="range">`, so almost nothing is left for this file. The
 * platform owns the thumb, the drag, the along-axis arrows with their clamping and snapping, Home,
 * End, PageUp, PageDown, the focus ring, `:disabled`, and every word of `role="slider"` with its
 * `aria-valuemin`, `aria-valuemax` and `aria-valuenow`. An arrow key with no `Shift` on it returns
 * from {@link onSliderKeydown} untouched so that stays true.
 *
 * Two things are the kit's, and both are `jx-color-slider`'s (its sidecar is the model):
 * `Shift`+Arrow moves ten steps, which no range has of its own, and the inner control's own `input`
 * and `change` are STOPPED and re-dispatched from the host, so a listener reads `e.target.value`
 * off the ELEMENT as a number and never has to ask which node fired. A native `dblclick` is not
 * touched: it bubbles from the range, and the host document that wants "double-click resets"
 * listens for it.
 *
 * @docs extending/ui-kit
 */

import { ARROW_SIGN, snapToStep } from "../color.ts";

/** The tag this sidecar belongs to. */
const HOST = "jx-slider";

/** The reactive scope a `jx-slider` document hands its handlers. */
export interface SliderState {
  /** Where the thumb is, in the track's own units. */
  value: number;
  /** The bottom of the range. */
  min: number;
  /** The top of the range. */
  max: number;
  /** The grid the value moves on. */
  step: number;
  /** Whether the element refuses to move. */
  disabled: boolean;
}

/** The `jx-slider` an event is being handled on. */
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
 * The inner range's `input`: mirror it, and re-say it from the host.
 *
 * @param state The element's reactive scope.
 * @param event The range's own input event.
 */
export function onSliderInput(state: SliderState, event: Event): void {
  const host = hostOf(event);
  if (!host || event.target === host) {
    /* The listener sits on the ROOT so `currentTarget` is the element, which means it also hears
       the element's own re-dispatch. That one has already been accounted for. */
    return;
  }
  event.stopPropagation();
  /* SAFETY: the element's only form control is its `input[part="input"]` range, so an `input` event
     reaching the host from anything other than the host itself was fired by that range. */
  state.value = Number((event.target as HTMLInputElement).value);
  announce(host, "input");
}

/**
 * The inner range's `change`: the same stop, and the commit re-said from the host.
 *
 * @param state The element's reactive scope.
 * @param event The range's own change event.
 */
export function onSliderChange(state: SliderState, event: Event): void {
  const host = hostOf(event);
  if (!host || event.target === host) {
    return;
  }
  event.stopPropagation();
  /* SAFETY: the element's only form control is its `input[part="input"]` range, so a `change` event
     reaching the host from anything other than the host itself was fired by that range. */
  state.value = Number((event.target as HTMLInputElement).value);
  announce(host, "change");
}

/**
 * `Shift`+Arrow: ten steps, cancelled so the platform's own single step does not run on top.
 *
 * @param state The element's reactive scope.
 * @param event The keydown.
 */
export function onSliderKeydown(state: SliderState, event: KeyboardEvent): void {
  const host = hostOf(event);
  const sign = ARROW_SIGN.get(event.key);
  if (!host || !sign || !event.shiftKey || state.disabled === true) {
    return;
  }
  event.preventDefault();
  const min = Number.isFinite(Number(state.min)) ? Number(state.min) : 0;
  const top = Number(state.max);
  const max = Number.isFinite(top) && top > min ? top : min + 100;
  const step =
    Number(state.step) > 0 && Number.isFinite(Number(state.step)) ? Number(state.step) : 1;
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
