/**
 * Dynamic-list.js — handlers for the dynamic list demo.
 *
 * Editable items: click to edit inline, Enter to save, Escape to cancel. All mutations to
 * state.items are automatically persisted by the LocalStorage prototype — no explicit save calls
 * required.
 */

export function addItem(state) {
  const text = state.newText.trim();
  if (!text) return;
  state.items.push(text);
  state.newText = "";
}

export function addKeydown(state, event) {
  if (event.key === "Enter") addItem(state);
}

export function removeItem(state) {
  const index = state.$map?.index ?? -1;
  if (index < 0) return;
  state.items.splice(index, 1);
}

export function saveEdit(state, event) {
  const index = state.$map?.index ?? -1;
  if (index < 0) return;
  const newText = event.target.textContent.trim();
  if (!newText) {
    event.target.textContent = state.$map?.item ?? "";
    return;
  }
  state.items[index] = newText;
}

export function editKeydown(state, event) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.target.blur();
  } else if (event.key === "Escape") {
    event.target.textContent = state.$map?.item ?? "";
    event.target.blur();
  }
}

export function updateText(state, event) {
  state.newText = event.target.value;
}
