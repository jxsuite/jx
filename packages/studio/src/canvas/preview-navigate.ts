/**
 * Where a Preview link goes.
 *
 * Preview keeps anchors live (editable modes de-link them onto `data-jx-href`), so a click would
 * navigate the canvas iframe and destroy the render along with the editing session. The iframe
 * reports the intent instead and the shell opens the target for real — see `specs/studio.md` §4.2.
 *
 * A separate module from the canvas host so an embedder can override the destination without
 * importing the host's internals: the desktop app routes it through the OS so the page opens in the
 * user's own browser rather than a webview with no address bar, history or devtools.
 */

/** Handles a fully-resolved absolute URL. */
export type PreviewNavigateHandler = (url: string) => void;

let handler: PreviewNavigateHandler | null = null;

/** Override where preview links open. Pass null to restore the default (a new browser tab). */
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
 * Reuses the seam the desktop launchers already register for Preview link clicks, which routes
 * through the OS rather than navigating a webview with no address bar; the browser build falls back
 * to a new tab. One function, because Open in Browser and the Publish workspace's Visit site and
 * deployment links all mean the same thing by "open this outside Studio".
 */
export function openUrlExternally(url: string): void {
  if (handler) {
    handler(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
