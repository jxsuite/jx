/// <reference lib="dom" />
/**
 * Canvas origin derivation. The canvas iframe may load same-origin (dev server / chromium / cloud,
 * where the platform canvasUrl is a relative path) or cross-origin (a host whose canvasUrl is an
 * absolute http://127.0.0.1:<port> URL).
 *
 * CanvasBaseOrigin() returns the origin the canvas document lives on, so callers that build
 * absolute asset/doc URLs target the right server. For a relative canvasUrl this resolves to
 * location.origin — IDENTITY for the same-origin paths, so dev/chromium/cloud are byte-identical to
 * before.
 */

import { getPlatform, hasPlatform } from "../platform";

/**
 * The origin serving the canvas document. When the platform registers an absolute canvasUrl (an
 * absolute loopback URL), this is that URL's origin; otherwise it falls back to the parent's own
 * origin (a relative canvasUrl resolves against location.href to location.origin).
 */
export function canvasBaseOrigin(): string {
  const canvasUrl = hasPlatform() ? getPlatform().canvasUrl : undefined;
  if (canvasUrl) {
    return new URL(canvasUrl, location.href).origin;
  }
  return location.origin;
}

/**
 * The dev-proxy token for a render in the SHELL's own realm, or null when it has none to use.
 *
 * A desktop server gates `/__jx_resolve__` and `/__jx_server__` on its rpcToken, and the canvas
 * iframe authenticates by reading it off its own URL (`?rpcToken=`). The shell renders documents
 * too (the Library's previews, the assistant's render check) through its own copy of the runtime,
 * and that copy was never told: every `$src` class on a previewed page posted without the token and
 * drew a 403. The token is read off the same canvas URL rather than a second channel, so there is
 * one place it is handed out.
 *
 * Same-origin only. A cross-origin canvas (an absolute loopback canvasUrl) is not where the shell's
 * relative dev-proxy fetches go, so its token would authenticate nothing and is better not spread
 * around.
 *
 * @returns {string | null} The token, or null on a host with no token or a cross-origin canvas.
 */
export function hostResolveToken(): string | null {
  const canvasUrl = hasPlatform() ? getPlatform().canvasUrl : undefined;
  if (!canvasUrl) {
    return null;
  }
  const url = new URL(canvasUrl, location.href);
  return url.origin === location.origin ? url.searchParams.get("rpcToken") : null;
}

/**
 * The base the canvas fetches PROJECT FILES against — component `$ref`s, `$src` modules, images.
 *
 * Two shapes, and the platform chooses. Most hosts serve the project tree from their web root, so
 * `<canvas origin>/<projectRoot>/` is a real URL: the dev server serves by path (absolute
 * filesystem paths included) and the desktop loopback does the same. Those set nothing.
 *
 * A host whose `projectRoot` is an IDENTIFIER rather than a served path sets `documentBaseUrl`. Jx
 * Cloud is one — its root is `owner/repo@branch`, and the default produced a URL nothing answered,
 * so every `$ref` fetch fell through to the SPA fallback. That fallback returns the marketing page
 * at **HTTP 200**, so `res.ok` passed and the runtime's `res.json()` died on `Unexpected token
 * '<'`; images failed the same way and reported nothing.
 *
 * @param {string | undefined} projectRoot - The active project root, for the default shape.
 * @returns {string} A base URL ending in `/`, safe to pass to `new URL(relativePath, base)`.
 */
export function documentBase(projectRoot?: string): string {
  const origin = canvasBaseOrigin();
  const declared = hasPlatform() ? getPlatform().documentBaseUrl : undefined;
  if (declared) {
    const withSlash = declared.endsWith("/") ? declared : `${declared}/`;
    /*
     * ABSOLUTE, ALWAYS. The caller uses this as `new URL(documentPath, base)`, and a `base` that is
     * itself relative throws `Failed to construct 'URL': Invalid base URL` — which is not a failed
     * fetch but a failed MOUNT: the canvas renders nothing at all.
     *
     * Jx Cloud declares a root-relative base (`/api/v1/p/:owner/:repo/:branch/studio/raw/`), which
     * is the natural thing to declare and must keep working. Resolving it against the canvas origin
     * here means a platform may declare either shape. An already-absolute URL passes through
     * unchanged, because that is what `new URL` does with one.
     */
    return new URL(withSlash, `${origin}/`).href;
  }
  const root = projectRoot || "";
  return `${origin}/${root ? `${root}/` : ""}`;
}

/**
 * Build an absolute loopback-origin src for a PROJECT asset path referenced by a PARENT-realm
 * (shell) preview <img>. On the views:// shell a relative "/images/foo.png" resolves to
 * views://studio/images/foo.png, which the browser fetches immediately on paint — a stray request
 * the desktop MutationObserver only rewrites asynchronously. Rendering the src loopback-absolute up
 * front eliminates that race for direct-parent <img> sites.
 *
 * Guarded: this ONLY rewrites when a real cross-origin http(s) loopback is registered (canvasUrl
 * set to an absolute http URL) whose origin differs from location.origin. Otherwise — dev server,
 * chromium, cloud, and the pre-activate window — it returns the ORIGINAL relative path unchanged,
 * keeping those cases byte-identical (an absolute ${location.origin}/... on the shell would just
 * reintroduce views://... — the exact bug).
 *
 * Only for PROJECT asset srcs; NEVER call it for shell-packaged views:// assets (sp-icons, bundled
 * chrome). Already-absolute inputs (data:/blob:/http/views://) are returned untouched, so it is
 * safe for user-typed media values too.
 *
 * @param {string} path — a project asset path (relative, e.g. "/public/logo.png" or "logo.png") or
 *   an already-absolute URL.
 * @returns {string} The loopback-absolute src when a cross-origin loopback is active, else `path`.
 */
export function loopbackAssetSrc(path: string): string {
  if (
    path.startsWith("data:") ||
    path.startsWith("blob:") ||
    path.startsWith("http") ||
    path.startsWith("views://")
  ) {
    return path;
  }
  const origin = canvasBaseOrigin();
  // Only rewrite when a real cross-origin http(s) loopback is registered. When canvasBaseOrigin()
  // Yields location.origin (the views:// shell / dev / chromium / gate-off) an absolute rewrite
  // Would produce views://... on the shell, so fall back to the relative path unchanged.
  if ((origin.startsWith("http:") || origin.startsWith("https:")) && origin !== location.origin) {
    return `${origin}/${path.replace(/^\.?\//, "")}`;
  }
  return path;
}
