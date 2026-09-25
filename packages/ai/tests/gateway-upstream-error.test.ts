/**
 * Tests for `extractUpstreamErrorMessage`, the sentence inside an upstream provider's error body.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { extractUpstreamErrorMessage } from "../src/gateway/upstream-error.ts";

describe("extractUpstreamErrorMessage", () => {
  it.each<[string, string, string]>([
    ["an empty body falls back", "", "Bad Gateway"],
    ["OpenAI's object form", JSON.stringify({ error: { message: "Bad key" } }), "Bad key"],
    ["the flat string form", JSON.stringify({ error: "bad request" }), "bad request"],
    [
      "Cloudflare's array envelope",
      JSON.stringify({
        errors: [{ code: 7000, message: "No route for that URI" }],
        success: false,
      }),
      "No route for that URI",
    ],
    [
      "an error object with no message falls through to errors",
      JSON.stringify({ error: {}, errors: [{ message: "from errors" }] }),
      "from errors",
    ],
    [
      "an errors entry with no message is the raw body",
      JSON.stringify({ errors: [{ code: 1 }] }),
      JSON.stringify({ errors: [{ code: 1 }] }),
    ],
    [
      "an empty errors array is the raw body",
      JSON.stringify({ errors: [] }),
      JSON.stringify({ errors: [] }),
    ],
    ["JSON with neither member is the raw body", '{"ok":false}', '{"ok":false}'],
    ["a body that is not JSON is the raw body", "upstream exploded", "upstream exploded"],
  ])("%s", (_label, body, message) => {
    expect(extractUpstreamErrorMessage(body, "Bad Gateway")).toBe(message);
  });
});
