/**
 * Foreign.ts — who hears that another writer changed a document (`project-state.md` §2.4, §4.3).
 *
 * `files/fs-events.ts` runs the project state subscription and knows, for every `docChanged`,
 * whether it is the echo of Studio's own write (by write id, or by the hash Studio noted before
 * writing). A surface that keeps its own copy of a file's contents outside a tab (a data grid's
 * rows) listens here rather than to the watcher's file events, so Studio's own write never reaches
 * it however late its echo arrives, and no time window is needed to say so. Nothing is reported
 * while no subscription is served (`studio.md` §9.2).
 *
 * @license MIT
 * @docs extending/embedding/platform-adapter
 */

const listeners = new Set<(path: string) => void>();

/**
 * Be told of every document whose bytes another writer changed: a `docChanged` that is not the echo
 * of Studio's own write, a removal Studio did not make, and each file a snapshot that replaced
 * earlier state changed or removed.
 *
 * @returns The unsubscribe.
 */
export function onForeignDocumentChange(listener: (path: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Report that another writer changed the document at `path` (the subscription's half). */
export function reportForeignChange(path: string): void {
  for (const listener of listeners) {
    listener(path);
  }
}
