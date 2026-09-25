/**
 * Tests for tests/harness/native-fetch.ts — the live evals reach their provider with Bun's fetch
 * rather than happy-dom's, whose CORS rules blocked a provider that answers no preflight.
 */
/* First, ahead of `with-dom`, by design: it captures fetch before happy-dom replaces it. It imports
   nothing, so nothing that reads `document` at import time runs before the DOM exists. */
import { nativeFetch, useNativeFetch } from "./harness/native-fetch";
import "./with-dom.ts";
import { expect, test } from "bun:test";

test("happy-dom replaces fetch, and useNativeFetch puts Bun's back", () => {
  expect(globalThis.fetch).not.toBe(nativeFetch);
  useNativeFetch();
  expect(globalThis.fetch).toBe(nativeFetch);
});
