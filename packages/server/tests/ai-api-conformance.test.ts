/**
 * The dev server's AI proxy, held to the gateway conformance kit (specs/ai.md §2.4).
 *
 * The kit is the list of things a Jx client expects of ANY backend serving the chat and models
 * routes; `@jxsuite/ai` runs it against its own gateway, and this suite runs the same cases against
 * the routes this server actually mounts, with its real key and base-URL policy in front.
 *
 * @module @jxsuite/server/tests
 */

import { afterEach, describe, it } from "bun:test";
import { gatewayConformanceCases } from "@jxsuite/ai/testing";
import type { ConformanceGateway } from "@jxsuite/ai/testing";
import { handleChat, handleModels } from "../src/ai-api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** This server's two routes; its upstream calls go through the global `fetch`. */
const gateway: ConformanceGateway = {
  chat: (request) => handleChat(request),
  installUpstream(upstream) {
    globalThis.fetch = Object.assign(upstream, { preconnect: realFetch.preconnect });
  },
  models: (request) => handleModels(request),
};

describe("the AI proxy passes the gateway conformance kit", () => {
  // A caller's own key: with none, the chat route refuses before it reaches any case's subject.
  const options = { headers: { "X-Api-Key": "sk-test" }, wire: [1, 2] };
  for (const conformance of gatewayConformanceCases(options)) {
    it(conformance.id, async () => {
      await conformance.run(gateway);
    });
  }
});
