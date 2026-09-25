/**
 * Tests for the gateway's models route envelope (`modelsResponse`).
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import type { AiModelsResponse } from "@jxsuite/protocol";
import { modelsResponse } from "../src/gateway/models.ts";

describe("modelsResponse", () => {
  /* The route is a capability probe (ai.md §2.1): every credential state is a 200, because a
     non-2xx makes the probe throw. */
  it.each<[string, AiModelsResponse]>([
    [
      "no credentials",
      { configured: false, managed: false, models: [{ contextWindow: 128_000, id: "gpt-4o" }] },
    ],
    ["credentials, and the upstream's own listing", { configured: true, models: [{ id: "m-1" }] }],
    [
      "credentials, and an upstream that could not list",
      {
        configured: true,
        managed: false,
        models: [{ id: "gpt-4o" }],
        upstreamError: 404,
        upstreamMessage: "No route for that URI",
      },
    ],
    ["a lapsed brokered grant", { code: "cf_reconnect_required", configured: false, models: [] }],
    [
      "a model reporting no context window",
      { configured: true, models: [{ contextWindow: 0, id: "m-0", name: "m-0" }] },
    ],
  ])("answers %s with 200 and the body as given", async (_label, body) => {
    const response = modelsResponse(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe(JSON.stringify(body));
  });
});
