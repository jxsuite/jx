/**
 * Contact-form.js — external functions for contact-form.json
 *
 * With the new state grammar, all handlers are defined inline as $prototype: "Function" entries
 * with `body`. This sidecar is kept as documentation of the external $src pattern.
 */

export function setName(state, event) {
  state.name = event.target.value;
}
export function setEmail(state, event) {
  state.email = event.target.value;
}
export function setMessage(state, event) {
  state.message = event.target.value;
}

export function submit(state) {
  if (!state.formValid) return;
  console.log("Form submitted:", {
    name: state.name,
    email: state.email,
    message: state.message,
  });
  state.submitted = true;
  state.reset();
}

export function reset(state) {
  state.name = "";
  state.email = "";
  state.message = "";
  state.submitted = false;
}
