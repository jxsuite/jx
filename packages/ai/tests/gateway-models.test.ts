/**
 * Tests for the gateway's models route envelope (`modelsResponse`).
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import type { AiModelsResponse } from "@jxsuite/protocol";
import { modelsResponse, WIRE_VERSIONS } from "../src/gateway/models.ts";

describe("modelsResponse", () => {
  /* The route is a capability probe (ai.md §2.1): every credential state is a 200, because a
     non-2xx makes the probe throw. */
  it.each<[string, Omit<AiModelsResponse, "wire" | "limits">]>([
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
  ])("answers %s with 200, the body as given, and the wire it speaks", async (_label, body) => {
    const response = modelsResponse(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe(JSON.stringify({ ...body, wire: WIRE_VERSIONS }));
  });

  // Zero is how a listing that carried no window used to be written; a client budgeting on it trims everything.
  it("drops a context window that is not positive, and keeps one that is", async () => {
    const response = modelsResponse({
      configured: true,
      models: [
        { contextWindow: 0, id: "m-0", name: "m-0" },
        { contextWindow: -1, id: "m-neg" },
        { contextWindow: 8192, id: "m-8k" },
      ],
    });
    expect(await response.json()).toEqual({
      configured: true,
      models: [{ id: "m-0", name: "m-0" }, { id: "m-neg" }, { contextWindow: 8192, id: "m-8k" }],
      wire: [1],
    });
  });

  it("advertises the host's wire versions and the limits its chat route enforces", async () => {
    const response = modelsResponse(
      { configured: true, models: [] },
      { limits: { maxBodyBytes: 1_000_000, maxMessages: 200 }, wire: [1, 2] },
    );
    expect(await response.json()).toEqual({
      configured: true,
      limits: { maxBodyBytes: 1_000_000, maxMessages: 200 },
      models: [],
      wire: [1, 2],
    });
  });

  it("says nothing about limits when the host enforces none", async () => {
    const response = modelsResponse({ configured: true, models: [] }, { limits: {} });
    expect(await response.json()).toEqual({ configured: true, models: [], wire: [1] });
  });
});
