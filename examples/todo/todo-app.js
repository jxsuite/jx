/**
 * Todo-app.js — external functions for todo-app.json
 *
 * With the new state grammar, handlers are defined inline as $prototype: "Function" entries with
 * `body`. This sidecar is kept as documentation of the external $src pattern.
 */

export function addItem(state, event) {
  if (event.key !== "Enter") return;
  const text = event.target.value.trim();
  if (!text) return;
  state.items.push({ id: Date.now(), text, done: false });
  event.target.value = "";
}

export function toggleItem(state, _event) {
  const index = state.$map?.index ?? -1;
  if (index < 0) return;
  state.items[index].done = !state.items[index].done;
}

export function clearDone(state) {
  state.items.splice(0, state.items.length, ...state.items.filter((item) => !item.done));
}
