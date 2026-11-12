/**
 * Where a page Studio opens outside itself goes.
 *
 * `View: Open in Browser` and the Publish workspace's Visit site and deployment links each hand a
 * URL to the user's real browser (§10.1). The default is a new browser tab; an embedder overrides
 * the destination here without importing anything else: the desktop app routes it through the OS so
 * the page opens in the user's own browser rather than a webview with no address bar, history or
 * devtools.
 *
 * The name is older than its job. The seam was made for link clicks in Studio's Preview, which is
 * gone; the module keeps its name because `packages/desktop` and the package's `./preview-navigate`
 * export address it by that name.
 */

/** Handles a fully-resolved absolute URL. */
export type PreviewNavigateHandler = (url: string) => void;

let handler: PreviewNavigateHandler | null = null;

/** Override where pages open. Pass null to restore the default (a new browser tab). */
export function setPreviewNavigateHandler(next: PreviewNavigateHandler | null): void {
  handler = next;
}

/** The registered override, or null when the default applies. */
export function getPreviewNavigateHandler(): PreviewNavigateHandler | null {
  return handler;
}

/**
 * Hand a URL to the user's real browser.
 *
 * Goes through the handler an embedder registered, which on the desktop routes through the OS
 * rather than navigating a webview with no address bar; the browser build falls back to a new tab.
 * One function, because Open in Browser and the Publish workspace's Visit site and deployment links
 * all mean the same thing by "open this outside Studio".
 */
export function openUrlExternally(url: string): void {
  if (handler) {
    handler(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
