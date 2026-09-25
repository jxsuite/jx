/**
 * Module-preloads.ts — batch Bun's per-graph `<link rel=modulepreload>` insertions onto one frame.
 *
 * The bundler's dynamic-import runtime warm-fetches each lazy graph by appending a `<link
 * rel="modulepreload">` to `head` the moment the first `import()` of that graph runs. The insertion
 * itself costs a recalculation sweep of the WHOLE document — a link's addition invalidates style
 * matching everywhere, so the DevTools timeline bills a large batch of invalidation records (`Style
 * rule change → <every element>`) to whatever read next. Studio's palette pays this on its first
 * open, once per inserted link: the traced cost is a document recalculation per link, laid on top
 * of quick-search's own work.
 *
 * Batching is the whole fix: links queued during a task are appended together on ONE animation
 * frame, so the browser merges their invalidations into a single sweep. Nothing is dropped and no
 * fetch is slowed — `import()` resolves on its own fetch regardless of the link, and one frame is
 * shorter than any chunk is likely to be. The original append order is kept because the graph's
 * entry chunk should warm before its children.
 *
 * Idempotent by a flag on `head`: installed once per document, before any dynamic `import()` of
 * studio's own lazy surfaces runs.
 */

const QUEUED: HTMLLinkElement[] = [];
let frame: number | null = null;
let originalAppend: (<T extends Node>(node: T) => T) | null = null;

function flush(): void {
  frame = null;
  const singleOrigin = originalAppend;
  if (!singleOrigin) {
    return;
  }
  for (const link of QUEUED.splice(0)) {
    singleOrigin.call(document.head, link);
  }
}

/**
 * `appendChildPatched` — defer a modulepreload link to the shared frame; anything else goes
 * straight. Returns the appended node either way, matching `Node.appendChild`'s own contract, so a
 * caller that reads the return value (as `Node.appendChild` promises) sees the node it passed in
 * rather than `undefined` on the deferred path.
 */
function appendChildPatched<T extends Node>(this: Node, node: T): T {
  if (node instanceof HTMLLinkElement && node.rel === "modulepreload") {
    QUEUED.push(node);
    if (frame === null) {
      frame = requestAnimationFrame(flush);
    }
    return node;
  }
  // `originalAppend` is already bound to `head` at install time, so no `this` needs passing here.
  return originalAppend ? originalAppend(node) : node;
}

export function installModulePreloadBatcher(): void {
  const { head } = document;
  if (
    !head ||
    (head as HTMLElement & { __modulePreloadsBatched?: boolean }).__modulePreloadsBatched
  ) {
    return;
  }
  const patched = head as HTMLElement & { __modulePreloadsBatched?: boolean };
  originalAppend = Node.prototype.appendChild.bind(head);
  patched.__modulePreloadsBatched = true;
  head.appendChild = appendChildPatched as unknown as typeof head.appendChild;
}
