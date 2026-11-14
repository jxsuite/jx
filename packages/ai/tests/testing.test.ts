/**
 * Tests for `@jxsuite/ai/testing`: the scripted upstream, and the gateway conformance kit run
 * against the gateway this package ships (specs/ai.md §2.4).
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { createChatHandler, modelsResponse } from "../src/gateway/index.ts";
import type { Upstream } from "../src/gateway/index.ts";
import { fakeUpstream, gatewayConformanceCases } from "../src/testing/index.ts";
import type { ConformanceGateway, UpstreamFetch } from "../src/testing/index.ts";

const UPSTREAM: Upstream = {
  apiKey: "k",
  baseUrl: "https://upstream.test/v1",
  defaultModel: "m",
  family: "openai-compat",
  managed: false,
};

/** This package's own gateway, wired the way a host wires it. */
function referenceGateway(wire?: readonly number[]): ConformanceGateway {
  let upstream: UpstreamFetch = fetch;
  const chat = createChatHandler<{ readonly signal: AbortSignal }>({
    // Read per call: the kit installs a new upstream for each case.
    fetch: Object.assign((input: RequestInfo | URL, init?: RequestInit) => upstream(input, init), {
      preconnect: fetch.preconnect,
    }),
    resolveUpstream: () => UPSTREAM,
  });
  return {
    chat: (request) => chat(request, { signal: request.signal }),
    installUpstream(next) {
      upstream = next;
    },
    models: async () => {
      const listing = await upstream("https://upstream.test/v1/models");
      /* SAFETY: the kit's models fixture is the OpenAI listing envelope. */
      const { data } = (await listing.json()) as { data: { id: string }[] };
      return modelsResponse({ configured: true, models: data }, wire ? { wire } : {});
    },
  };
}

describe("gatewayConformanceCases", () => {
  const cases = gatewayConformanceCases({ headers: { "X-Api-Key": "k" }, wire: [1, 2] });
  for (const conformance of cases) {
    it(conformance.id, async () => {
      await conformance.run(referenceGateway());
    });
  }

  it("holds only a gateway that declares version 2 to the version 2 cases", () => {
    expect(gatewayConformanceCases().length).toBe(cases.length - 2);
  });

  it("fails a gateway that answers a version 2 request without saying which wire it served", async () => {
    const start = cases.find((conformance) => conformance.id.includes("opening with stream_start"));
    const gateway: ConformanceGateway = {
      ...referenceGateway(),
      chat: () =>
        Promise.resolve(
          new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } }),
        ),
    };
    expect(start!.run(gateway)).rejects.toThrow(
      'expected the X-Jx-AI-Wire response header to say 2; got "absent"',
    );
  });

  it("checks the wire versions the host declares", async () => {
    const [models] = gatewayConformanceCases({ wire: [1, 2] }).slice(-1);
    await models!.run(referenceGateway());
    // A gateway that advertises less than the host declared fails the case, by name.
    expect(models!.run(referenceGateway([1]))).rejects.toThrow(
      "gateway conformance: expected wire to list [1,2]; got [1]",
    );
  });

  it("fails a gateway whose stream does not begin with a 200", async () => {
    const [first] = gatewayConformanceCases();
    const gateway: ConformanceGateway = {
      ...referenceGateway(),
      chat: () => Promise.resolve(new Response("no", { status: 500 })),
    };
    expect(first!.run(gateway)).rejects.toThrow(
      "expected a 200 once the stream has begun; got 500",
    );
  });

  it("fails a gateway that answers a stream with the wrong media type", async () => {
    const [first] = gatewayConformanceCases();
    const gateway: ConformanceGateway = {
      ...referenceGateway(),
      chat: () => Promise.resolve(new Response("data: {}\n\n", { status: 200 })),
    };
    expect(first!.run(gateway)).rejects.toThrow("expected a text/event-stream response");
  });
});

describe("fakeUpstream", () => {
  it("answers each call with the next fixture and records what was asked", async () => {
    const upstream = fakeUpstream([
      { body: '{"ok":true}', status: 201 },
      { sse: "data: [DONE]\n\n", status: 200 },
      { status: 204 },
    ]);
    const first = await upstream("https://a.test/one", { method: "POST" });
    expect(first.status).toBe(201);
    expect(first.headers.get("Content-Type")).toBe("application/json");
    expect(await first.text()).toBe('{"ok":true}');

    const second = await upstream(new URL("https://a.test/two"));
    expect(second.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await second.text()).toBe("data: [DONE]\n\n");

    const third = await upstream(new Request("https://a.test/three"));
    expect(await third.text()).toBe("");

    expect(upstream.calls.map((call) => call.url)).toEqual([
      "https://a.test/one",
      "https://a.test/two",
      "https://a.test/three",
    ]);
    expect(upstream.calls[0]?.init).toEqual({ method: "POST" });
  });

  it("rejects a call past the last fixture, as a provider that has gone away does", async () => {
    const upstream = fakeUpstream([]);
    expect(upstream("https://a.test/")).rejects.toThrow("no fixture left");
  });

  it("fails the read after the bytes it was told to deliver", async () => {
    const upstream = fakeUpstream([{ abortAfterBytes: 4, sse: "data: partial", status: 200 }]);
    const response = await upstream("https://a.test/");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("data");
    expect(reader.read()).rejects.toThrow("connection reset");
  });
});
