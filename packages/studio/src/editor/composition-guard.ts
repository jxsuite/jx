/**
 * The composition guard: one listener that keeps Studio's key handlers out of an input method's
 * way.
 *
 * While an input method editor is composing (Japanese, Chinese, Korean, and dead-key or dictation
 * sequences elsewhere), Enter confirms a candidate and Escape cancels one. Both arrive as ordinary
 * `keydown` events, so a handler that commits a rename on Enter, or closes a dialog on Escape, acts
 * on a keystroke the person aimed at the candidate window. `isComposing` says so, and `keyCode ===
 * 229` covers the first keystroke of a composition in the engines that dispatch it before
 * `compositionstart`.
 *
 * Studio has several dozen such handlers: surface documents, the shortcut dispatcher, the slash
 * menu, the grid's cell editors. A window listener in the capture phase runs before every one of
 * them, so the rule is stated once here instead of repeated in each. Stopping propagation does not
 * cancel the default action, so the input method still receives the key.
 *
 * Monaco is exempt: it tracks composition itself and needs the events to do it. The canvas is a
 * separate document with its own composition tracking (`canvas/iframe-editable-root.ts`), and this
 * listener never sees its keys.
 */

/** Editors that handle composition themselves and must keep receiving its key events. */
const SELF_COMPOSING = ".monaco-editor";

/** Whether a key event belongs to an input method rather than to the application. */
export function isCompositionKey(event: KeyboardEvent): boolean {
  // oxlint-disable-next-line typescript/no-deprecated -- 229 is the only signal for a composition's first key
  return event.isComposing || event.keyCode === 229;
}

function onKeydown(event: KeyboardEvent): void {
  if (!isCompositionKey(event)) {
    return;
  }
  const { target } = event;
  if (target instanceof Element && target.closest(SELF_COMPOSING)) {
    return;
  }
  event.stopImmediatePropagation();
}

/**
 * Install the guard on a window. Call it before any other `keydown` listener is registered there:
 * listeners on one target run in registration order, and this one has to be first.
 *
 * @returns A function that removes it.
 */
export function installCompositionGuard(target: Window = window): () => void {
  target.addEventListener("keydown", onKeydown, true);
  return () => {
    target.removeEventListener("keydown", onKeydown, true);
  };
}
