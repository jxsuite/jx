/**
 * Which tabs hold typing in a source buffer that no save has kept yet.
 *
 * A Monaco buffer reaches its document on a debounce, and a buffer whose text does not parse never
 * reaches it at all. `tab.doc.dirty` deliberately says nothing about either: it is the DOCUMENT's
 * flag, and the close and quit gates ask the buffers themselves (`tabBufferUnsaved`). Save's
 * enablement needs the union, and needs it REACTIVELY, so the Command Bar's Save lights up on the
 * first keystroke rather than when the commit lands. The buffers' own flag is a closure variable no
 * effect can track, so the keystroke handlers note the tab here as well.
 *
 * Kept out of `services/monaco-buffer.ts` because `commands/live-context.ts` reads it, and
 * everything that module reaches has to load in a bare Bun process with no DOM.
 */
import { reactive } from "../reactivity";

const typing = reactive(new Set<string>());

/** A keystroke in one of `tabId`'s source buffers. */
export function noteTyping(tabId: string): void {
  typing.add(tabId);
}

/** A save kept everything the buffers held, or the tab is gone. */
export function clearTyping(tabId: string): void {
  typing.delete(tabId);
}

/** Whether `tabId` holds typing no save has kept. Tracked by effects. */
export function hasTyping(tabId: string): boolean {
  return typing.has(tabId);
}
