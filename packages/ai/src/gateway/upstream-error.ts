/**
 * The sentence inside an upstream provider's error body.
 *
 * @module @jxsuite/ai/gateway
 */

/**
 * Extract a human-readable message from an upstream error body, falling back to the raw body (or
 * `fallback` when the body is empty).
 *
 * OpenAI-compatible providers return `{ error: "..." }` or `{ error: { message: "..." } }`.
 * Cloudflare's own REST API (what a BYOK base URL pointed at Workers AI actually returns) uses a
 * different envelope, `{ success: false, errors: [{ code, message }] }`, with no top-level `error`
 * key at all. Without this branch that shape parses as valid JSON with nothing matched, and the
 * caller was left showing the whole raw body (e.g. the full `{"success":false,"errors":[...]}`
 * blob) instead of the human sentence inside it.
 *
 * The chat stream's `error` frame reads it, and so does a host's model catalogue, which reports the
 * same sentence as `upstreamMessage`.
 *
 * @param {string} rawBody - The upstream's response body, as text
 * @param {string} fallback - What to say when the body is empty (the status text, usually)
 * @returns {string}
 */
export function extractUpstreamErrorMessage(rawBody: string, fallback: string): string {
  if (!rawBody) {
    return fallback;
  }
  try {
    const { error, errors } = JSON.parse(rawBody) as {
      error?: string | { message?: string };
      errors?: { code?: number; message?: string }[];
    };
    if (typeof error === "string") {
      return error;
    }
    if (error) {
      const { message } = error;
      if (message) {
        return message;
      }
    }
    const [first] = errors ?? [];
    if (first) {
      const { message } = first;
      if (message) {
        return message;
      }
    }
  } catch {
    /* Not JSON: use the raw body. */
  }
  return rawBody;
}
