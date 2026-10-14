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
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    /* Not JSON: use the raw body. */
    return rawBody;
  }
  // JSON `null`, a primitive or an array carries neither member, so it is the raw body.
  if (isMemberBag(parsed)) {
    if ("error" in parsed) {
      const { error } = parsed;
      if (isText(error)) {
        return error;
      }
      if (isMemberBag(error) && "message" in error && Boolean(error.message)) {
        return String(error.message);
      }
    }
    if ("errors" in parsed && isEntryList(parsed.errors)) {
      const [first] = parsed.errors;
      if (isMemberBag(first) && "message" in first && Boolean(first.message)) {
        return String(first.message);
      }
    }
  }
  return rawBody;
}

/**
 * True when a parsed body is a string, empty or not: a flat `error` string is the answer as sent.
 *
 * @param {unknown} value - A member of the parsed body
 * @returns {boolean}
 */
function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * True when a parsed `errors` member is an array, whose first entry is Cloudflare's sentence.
 *
 * @param {unknown} value - The parsed body's `errors` member
 * @returns {boolean}
 */
function isEntryList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * True when a parsed value is a JSON object (or array) whose members may be probed with `in`; false
 * for `null` and every primitive.
 *
 * @param {unknown} value - The parsed body, or one of its members
 * @returns {boolean}
 */
function isMemberBag(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}
