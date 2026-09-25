/**
 * Native-fetch.ts — Bun's own `fetch`, for a harness that also needs a DOM.
 *
 * The live evals load happy-dom (`with-dom.ts`) so the render critic can mount a document, and
 * happy-dom's global registrator replaces `fetch` with the window's. That fetch enforces the
 * browser's CORS rules: a cross-origin POST with an Authorization header sends a preflight first,
 * and a provider that does not answer one (Cloudflare's REST API returns 405) blocks the request
 * before it leaves. OpenAI answers preflights, which is why the harness looked fine against it and
 * could not reach Workers AI at all. A harness talks to its provider as a server does, not as a
 * page, so it puts Bun's fetch back.
 *
 * Import this module BEFORE `with-dom.ts`, so the value captured here is Bun's, then call
 * {@link useNativeFetch} once happy-dom has registered.
 */

/** The global `fetch` as it was when this module was evaluated. */
export const nativeFetch: typeof fetch = globalThis.fetch;

/** Restore Bun's fetch over happy-dom's. */
export function useNativeFetch(): void {
  globalThis.fetch = nativeFetch;
}
