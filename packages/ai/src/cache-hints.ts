/**
 * Cache-hints.ts — Prompt-cache routing hints for OpenAI-compatible upstreams.
 *
 * A provider's prompt cache only pays off when consecutive requests sharing a prefix reach the same
 * machine. The assistant's requests are built for that (a stable system-prompt prefix, then a
 * history that only grows), but the providers that route by prefix still need to be told which
 * requests belong together, and each one is told differently:
 *
 * - OpenAI reads a `prompt_cache_key` body field.
 * - Cloudflare Workers AI (directly, or through AI Gateway) reads an `x-session-affinity` header.
 *
 * Neither hint is sent anywhere else. An OpenAI-compatible server is free to reject an unknown body
 * field, and a browser-side BYOK client adding an unknown header to a cross-origin request turns a
 * simple request into a CORS preflight the endpoint may not answer. Above all, the value is a
 * stable per-conversation identifier, and an arbitrary endpoint the user pointed a key at has no
 * use for one.
 *
 * What travels is never the client's own session id. A client sends that only to its own backend
 * (as {@link AI_SESSION_HEADER}); the backend hashes it with {@link affinityKey}, scoped to itself,
 * and the hash is the only form a provider sees.
 *
 * Worker-safe: `crypto.subtle` and `TextEncoder` are globals in every runtime the gateway targets.
 *
 * @module @jxsuite/ai/streaming-client
 * @license MIT
 * @docs extending/embedding/backend-protocol
 */

/**
 * The request header a client puts its conversation id in, for its OWN backend to hash. Never
 * forwarded to a provider as sent.
 */
export const AI_SESSION_HEADER = "X-Jx-Ai-Session";

/** 1–128 characters of `[A-Za-z0-9_.:-]`: wide enough for any id a client mints, nothing else. */
const SESSION_ID = /^[\w.:-]{1,128}$/;

/**
 * Whether a value is a session id a backend may hash. A header that fails this is ignored rather
 * than refused: the hint is an optimisation, and a request without one is still a valid request.
 *
 * @param {unknown} value - Typically the raw {@link AI_SESSION_HEADER} value, or null
 * @returns {boolean}
 */
export function isAiSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID.test(value);
}

/**
 * The affinity key a backend forwards for a session: the first 32 hex characters of
 * SHA-256(`jx-ai-affinity/v1:<scope>:<sessionId>`).
 *
 * `scope` names the backend (`"local"` for the dev/desktop server), so two backends that happen to
 * see the same id never share a key, and the version prefix lets the derivation change without
 * colliding with the old one. 128 bits is plenty to keep unrelated conversations apart, and short
 * enough for every provider's limit on the field.
 *
 * @param {string} scope - The backend's own namespace
 * @param {string} sessionId - The client's session id, already checked with {@link isAiSessionId}
 * @returns {Promise<string>} 32 lowercase hex characters
 */
export async function affinityKey(scope: string, sessionId: string): Promise<string> {
  const input = new TextEncoder().encode(`jx-ai-affinity/v1:${scope}:${sessionId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  let hex = "";
  for (const byte of digest.subarray(0, 16)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** The hints to merge into one upstream request: extra headers, and extra body members. */
export interface UpstreamCacheHints {
  headers: Record<string, string>;
  body: { prompt_cache_key?: string };
}

/**
 * The cache hints for a request to `baseUrl`, in the form that upstream understands, or none.
 *
 * Classified by host, because the hint's NAME is per provider: `api.openai.com` gets
 * `prompt_cache_key` in the body; Workers AI (an `api.cloudflare.com` URL with `/ai/` in its path)
 * and AI Gateway (`gateway.ai.cloudflare.com`) get the `x-session-affinity` header. Every other
 * host, an unparseable base URL, and a request with no affinity get nothing.
 *
 * @param {string} baseUrl - The upstream's base URL, as the request is about to use it
 * @param {string} [affinity] - The affinity key, from {@link affinityKey} (or a caller's own id)
 * @returns {UpstreamCacheHints}
 */
export function upstreamCacheHints(baseUrl: string, affinity?: string): UpstreamCacheHints {
  const hints: UpstreamCacheHints = { body: {}, headers: {} };
  if (!affinity) {
    return hints;
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return hints;
  }
  const host = url.hostname.toLowerCase();
  if (host === "api.openai.com") {
    hints.body.prompt_cache_key = affinity;
  } else if (
    (host === "api.cloudflare.com" && url.pathname.includes("/ai/")) ||
    host === "gateway.ai.cloudflare.com"
  ) {
    hints.headers["x-session-affinity"] = affinity;
  }
  return hints;
}
