/**
 * Counter.js — external function examples for counter.json
 *
 * With the new state grammar, handlers are defined inline as $prototype: "Function" entries with
 * `body`. This sidecar is kept as documentation of the external $src pattern.
 *
 * `state` is passed as the first parameter. Signals are accessed as plain properties on state.
 */

export function increment(state) {
  state.count++;
}

export function decrement(state) {
  state.count = Math.max(0, state.count - 1);
}

export function reset(state) {
  state.count = 0;
}
