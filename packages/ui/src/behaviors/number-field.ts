/**
 * `jx-number-field`'s behaviour sidecar: the stepping a document cannot express, and the mirror
 * that follows a value the platform wrote without telling anyone.
 *
 * Everything here goes through the element's OWN inner `<input type="number">` and its own value
 * API. `HTMLInputElement.stepUp(n)` / `stepDown(n)` take a multiplier, clamp to `min` and `max`,
 * and snap to the step grid measured from `min` — hand-rolled `value ± step` diverges the moment
 * the value is off that grid (min 0, step 0.3, value 0.5: `stepUp(1)` is 0.6 and `value + step` is
 * 0.8). They are unreachable from a document body, because the expression evaluator's `calleeOwner`
 * has no `event#/` branch and a `call` on `event#/target/stepUp` would invoke with an undefined
 * receiver. That is why this module exists, and it is the amendment to specs/ui.md §2 principle 5:
 * a native form control's own value-stepping API, on the element's own inner control.
 *
 * WHO WROTE THE VALUE DECIDES WHO SAYS SO.
 *
 * When the READER wrote it, the platform has already said so and nothing here touches that: the
 * native `input` and `change` bubble out of `[part="input"]` unstopped and un-re-sent, so a host's
 * `e.target` is the live control and `e.target.valueAsNumber` (NaN when empty), `.validity`,
 * `.checkValidity()` and `.form` all read. `jx-textfield`'s sidecar leaves the same pair alone, so
 * one ported `(e.target as HTMLInputElement)` cast is right for both kit fields.
 *
 * When the ELEMENT wrote it — the two stepper buttons, and Shift+Arrow — the platform fires nothing
 * at all for a programmatic value write, so the same two NAMES are dispatched from the HOST, whose
 * own `value` is that same string. No new names, and no `detail`: an event is how a host is told
 * that the value moved, not where the element keeps its state.
 *
 * SO `badInput` RIDES THE ELEMENT, NOT AN EVENT. `<input type="number">` runs a value sanitization
 * algorithm and discards what it cannot parse, so a half-typed "1e" reads as an empty value with
 * `validity.badInput` true. A host that deletes a key when the field goes empty must tell that from
 * a clear, and it asks the element: `host.badInput`, written here before the event bubbles past,
 * and mirrored to `data-bad-input` on the host for a selector. From a handler holding only the
 * event that is `(event.target as Element).closest("jx-number-field")` — which works on both paths,
 * because the control is inside the host and the host is itself.
 *
 * @docs extending/ui-kit
 */

/** The reactive scope a `jx-number-field` document hands its handlers. */
export interface NumberFieldState {
  /** The field's text, as a string — empty is empty, never 0. */
  value: string;
  /** Whether the control is holding something it cannot parse as a number. */
  badInput: boolean;
  [key: string]: unknown;
}

const HOST = "jx-number-field";

/** The `jx-number-field` an event belongs to. */
function hostOf(event: Event): HTMLElement | null {
  const target = event.currentTarget;
  return target instanceof Element ? target.closest<HTMLElement>(HOST) : null;
}

/** The element's own native control. */
function controlOf(host: HTMLElement): HTMLInputElement | null {
  return host.querySelector<HTMLInputElement>('input[part="input"]');
}

/**
 * Read the control back into state.
 *
 * `badInput` is the third case between empty and zero, and this is where a host reads it from: the
 * element, synchronously, before any event this write precedes has finished bubbling.
 */
function mirror(state: NumberFieldState, control: HTMLInputElement): void {
  state.value = control.value;
  state.badInput = control.validity?.badInput === true;
}

/**
 * Say that a value the ELEMENT wrote moved and was committed, in the platform's own two names, from
 * the host — the platform fires neither for a programmatic write.
 */
function announce(host: HTMLElement): void {
  host.dispatchEvent(new Event("input", { bubbles: true }));
  host.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Step the control by `n` steps — negative steps down — through the control's own API, then mirror
 * and announce.
 *
 * @param state The element's reactive scope.
 * @param event The event whose `currentTarget` sits inside the field.
 * @param n How many steps, signed.
 */
export function stepBy(state: NumberFieldState, event: Event, n: number): void {
  const host = hostOf(event);
  const control = host ? controlOf(host) : null;
  if (!host || !control) {
    return;
  }
  try {
    if (n < 0) {
      control.stepDown(-n);
    } else {
      control.stepUp(n);
    }
  } catch {
    /* A control whose value cannot be converted to a number throws InvalidStateError: there is
       nothing to step from, and the reader's half-typed text is not ours to replace. */
    return;
  }
  mirror(state, control);
  announce(host);
}

/**
 * The inner control's `keydown`: Shift+ArrowUp / Shift+ArrowDown move ten steps.
 *
 * A plain Arrow is left alone — the platform already steps by one, clamps and snaps. The shifted
 * pair is cancelled so the platform's own single step does not run on top of the ten.
 *
 * @param state The element's reactive scope.
 * @param event The keyboard event.
 */
export function onNumberKeydown(state: NumberFieldState, event: Event): void {
  const key = event as KeyboardEvent;
  if (!key.shiftKey) {
    return;
  }
  if (key.key === "ArrowUp") {
    key.preventDefault();
    stepBy(state, event, 10);
  } else if (key.key === "ArrowDown") {
    key.preventDefault();
    stepBy(state, event, -10);
  }
}

/** The step-up button: one step, the same way an ArrowUp does it. */
export function onStepUp(state: NumberFieldState, event: Event): void {
  stepBy(state, event, 1);
}

/** The step-down button: one step down. */
export function onStepDown(state: NumberFieldState, event: Event): void {
  stepBy(state, event, -1);
}

/**
 * The inner control's `change`: the reader committed an edit.
 *
 * This only reads the control back into state. The native event is neither stopped nor re-sent — it
 * goes on bubbling from `[part="input"]`, which is the whole reason a host can still reach
 * `e.target.valueAsNumber` and `e.target.validity`. The mirror lives here as well as on `input`
 * because a `change` can arrive without one: a host that writes the control's value itself gets no
 * `input` from the platform either.
 *
 * @param state The element's reactive scope.
 * @param event The native change event.
 */
export function onNumberChange(state: NumberFieldState, event: Event): void {
  const host = hostOf(event);
  const control = host ? controlOf(host) : null;
  if (!host || !control) {
    return;
  }
  mirror(state, control);
}
