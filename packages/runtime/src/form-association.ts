/**
 * Form association for a custom element (spec.md §16.11): what an element that declares
 * `formAssociated: true` does with the `ElementInternals` the platform hands it.
 *
 * HTML already names a form control's state (`value`, `checked`, `disabled`, `required`), and a Jx
 * control declares its state under those names, so the binding needs no vocabulary of its own:
 *
 * - A declared `formValue` is the value the HOST submits, through `setFormValue`. Without one the
 *   host submits nothing itself: a light-DOM control's own named native control is in the form's
 *   tree and already does, and a second entry under the same name would submit the value twice.
 * - `required` with an empty value is `valueMissing`, reported through `setValidity`.
 * - `form.reset()` returns `value` and `checked` to what the instance first connected with.
 * - A disabled `<fieldset>`, or the host's own `disabled` attribute, writes `disabled`, and its
 *   re-enabling restores the element's own.
 * - A `<label for>` naming the host reaches the element's CONTROL, the first `input`, `textarea` or
 *   `select` it renders: a click on the host (which is what a label's activation is) focuses it,
 *   and toggles a checkbox or a radio button; and the control is named by the host's labels, by
 *   element reference, unless it already carries a name of its own.
 *
 * It is one function with no import from the renderer, so the compiler can carry the same rule into
 * a generated module (`formAssociationHelperSource` in `@jxsuite/compiler`), and
 * `form-association-agreement.test.ts` there runs both over one scenario table.
 *
 * @docs framework/concepts/components
 */

import type { JxScope, JxScopeValue } from "./types.ts";

/** Which of HTML's form-control state names a definition declares as writable state. */
export interface FormStateKeys {
  value: boolean;
  checked: boolean;
  disabled: boolean;
  required: boolean;
}

/**
 * The part of `ElementInternals` the binding uses. Structural, so the platform's object satisfies
 * it and so does anything a host or a test stands in for it.
 */
export interface FormInternals {
  /** The `<label>` elements that name the host. */
  readonly labels: Iterable<Node> & { readonly length: number };
  setFormValue: (value: File | string | FormData | null) => void;
  setValidity: (flags?: ValidityStateFlags, message?: string, anchor?: HTMLElement) => void;
}

/** What the platform's form callbacks are forwarded to. */
export interface FormAssociation {
  /** Start the reactive half: the submitted value, validity and the label's name. Per connection. */
  start: () => void;
  /** `formResetCallback`. */
  reset: () => void;
  /** `formDisabledCallback`. */
  disabled: (flag: boolean) => void;
}

/** Everything {@link associateForm} needs that is not the element itself. */
export interface FormAssociationOptions {
  /** `formStateKeys` of the definition. */
  keys: FormStateKeys;
  /** The tree the element renders into, asked each time: the host, or its shadow root. */
  root: () => ParentNode;
  /** The declared `formValue`, resolved against the scope, when the definition has one. */
  formValue?: (() => JxScopeValue) | undefined;
  /** Run `fn` now and again whenever the state it read changes: the caller's `effect`. */
  watch: (fn: () => void) => void;
}

/** The message a detached native control gives for a missing value, in the reader's language. */
const VALUE_MISSING_FALLBACK = "Please fill out this field.";

/**
 * Bind a form-associated element's state to its `ElementInternals`.
 *
 * Called once per instance, at its first connection, after the props it arrived with are merged:
 * the values `reset()` returns to are read here. `start()` is called on every connection, by a
 * caller whose effects stop when the element is removed.
 *
 * @param host The element
 * @param internals What `host.attachInternals()` answered
 * @param state The element's scope, read and written under HTML's own names for a control's state
 * @param options See {@link FormAssociationOptions}
 * @returns {FormAssociation}
 */
export function associateForm(
  host: HTMLElement,
  internals: FormInternals,
  state: JxScope,
  options: FormAssociationOptions,
): FormAssociation {
  const { keys, root, formValue, watch } = options;
  const initial = { checked: state.checked, value: state.value };
  let ownDisabled = state.disabled;
  let forced = false;

  const control = (): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null =>
    root().querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    );

  /* The host's labels name its control, by element reference, so a `<label for>` needs no id
     copied anywhere. A name the control already carries (the element's own `label` or
     `labelledby`) is left alone, and an engine without the reflection names nothing. */
  const nameControl = (): void => {
    const target = control();
    const { labels } = internals;
    if (
      target &&
      labels.length > 0 &&
      "ariaLabelledByElements" in target &&
      !target.hasAttribute("aria-label") &&
      !target.getAttribute("aria-labelledby")
    ) {
      target.ariaLabelledByElements = [...labels].filter((label) => label instanceof Element);
    }
  };

  /* A label's activation is a click on the element it names. One whose target is the host itself
     came from a label, or from the host's own padding, and goes to the control. */
  host.addEventListener("click", (event) => {
    const target = control();
    if (event.target !== host || !target || target.disabled) {
      return;
    }
    target.focus();
    if (target.type === "checkbox" || target.type === "radio") {
      target.click();
    }
  });
  host.addEventListener("focusin", nameControl);

  const valueMissingMessage = (): string => {
    const probe = host.ownerDocument.createElement("input");
    probe.required = true;
    if (keys.checked) {
      probe.type = "checkbox";
    }
    return probe.validationMessage || VALUE_MISSING_FALLBACK;
  };

  return {
    disabled(flag) {
      if (!keys.disabled) {
        return;
      }
      if (flag) {
        if (!forced) {
          /* The platform reports the element's EFFECTIVE state, so this also fires for the
             host's own `disabled` attribute. Then the attribute is the element's own state, and
             what it returns to when the attribute goes is enabled; otherwise a fieldset did it,
             and the element returns to whatever its `disabled` was. */
          ownDisabled = host.hasAttribute("disabled") ? false : state.disabled;
          forced = true;
        }
        state.disabled = true;
      } else if (forced) {
        forced = false;
        state.disabled = ownDisabled;
      }
    },
    reset() {
      if (keys.value) {
        state.value = initial.value;
      }
      if (keys.checked) {
        state.checked = initial.checked;
      }
    },
    start() {
      if (formValue) {
        watch(() => {
          const value = formValue();
          if (value === null || value === undefined) {
            internals.setFormValue(null);
          } else if (value instanceof File || value instanceof FormData) {
            internals.setFormValue(value);
          } else {
            internals.setFormValue(String(value));
          }
        });
      }
      if (keys.required) {
        watch(() => {
          const empty = keys.checked
            ? !state.checked
            : state.value === null || state.value === undefined || state.value === "";
          if (state.required && empty) {
            internals.setValidity(
              { valueMissing: true },
              valueMissingMessage(),
              control() ?? undefined,
            );
          } else {
            internals.setValidity({});
          }
        });
      }
      nameControl();
    },
  };
}
