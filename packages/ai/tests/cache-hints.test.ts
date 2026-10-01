/**
 * Tests for src/cache-hints.ts — the prompt-cache routing hints.
 *
 * Three properties carry the design: a hint reaches ONLY the host that understands it (anything
 * else gets nothing, so no strict server sees an unknown field and no arbitrary endpoint sees a
 * stable id), the affinity key is a deterministic, scoped hash rather than the raw id, and the
 * session-id check is a bound on what a backend will hash at all.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import {
  AI_SESSION_HEADER,
  affinityKey,
  isAiSessionId,
  upstreamCacheHints,
} from "../src/cache-hints.ts";
import * as ai from "../src/index.ts";
import * as gateway from "../src/gateway/index.ts";
import * as streamingClient from "../src/streaming-client.ts";

describe("upstreamCacheHints", () => {
  it("sends prompt_cache_key in the body to OpenAI, and no header", () => {
    expect(upstreamCacheHints("https://api.openai.com/v1", "k1")).toEqual({
      body: { prompt_cache_key: "k1" },
      headers: {},
    });
    // The host is compared case-insensitively, as hosts are.
    expect(upstreamCacheHints("https://API.OpenAI.com/v1", "k1").body).toEqual({
      prompt_cache_key: "k1",
    });
  });

  it("sends x-session-affinity to Workers AI and AI Gateway, and no body field", () => {
    for (const baseUrl of [
      "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1",
      "https://gateway.ai.cloudflare.com/v1/abc/my-gateway/workers-ai/v1",
    ]) {
      expect([baseUrl, upstreamCacheHints(baseUrl, "k2")]).toEqual([
        baseUrl,
        { body: {}, headers: { "x-session-affinity": "k2" } },
      ]);
    }
  });

  it("sends nothing to any other host", () => {
    for (const baseUrl of [
      // Cloudflare's REST API outside Workers AI does not route by affinity.
      "https://api.cloudflare.com/client/v4/accounts/abc/d1/database",
      "https://openrouter.ai/api/v1",
      "http://localhost:11434/v1",
      // A lookalike host is another host.
      "https://api.openai.com.example/v1",
      "https://proxy.example/api.openai.com/v1",
    ]) {
      expect([baseUrl, upstreamCacheHints(baseUrl, "k3")]).toEqual([
        baseUrl,
        { body: {}, headers: {} },
      ]);
    }
  });

  it("sends nothing without an affinity, or for an unparseable base URL", () => {
    expect(upstreamCacheHints("https://api.openai.com/v1")).toEqual({ body: {}, headers: {} });
    expect(upstreamCacheHints("https://api.openai.com/v1", "")).toEqual({ body: {}, headers: {} });
    expect(upstreamCacheHints("not a url", "k4")).toEqual({ body: {}, headers: {} });
  });

  it("returns fresh objects, so a caller merging them cannot leak into the next request", () => {
    const first = upstreamCacheHints("https://api.openai.com/v1", "a");
    first.headers.extra = "x";
    expect(upstreamCacheHints("https://api.openai.com/v1", "a").headers).toEqual({});
  });
});

describe("affinityKey", () => {
  it("is 32 lowercase hex characters and deterministic", async () => {
    const key = await affinityKey("local", "s_1_abc");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(await affinityKey("local", "s_1_abc")).toBe(key);
  });

  it("is the head of SHA-256 over the versioned, scoped input", async () => {
    const expected = new Bun.CryptoHasher("sha256")
      .update("jx-ai-affinity/v1:local:s_1_abc")
      .digest("hex")
      .slice(0, 32);
    expect(await affinityKey("local", "s_1_abc")).toBe(expected);
  });

  it("changes with the scope and with the id, and never contains the id", async () => {
    const local = await affinityKey("local", "s_1_abc");
    expect(await affinityKey("cloud", "s_1_abc")).not.toBe(local);
    expect(await affinityKey("local", "s_1_abd")).not.toBe(local);
    expect(local).not.toContain("s_1_abc");
  });
});

describe("isAiSessionId", () => {
  it("accepts 1 to 128 characters of word characters, dots, colons and hyphens", () => {
    for (const id of ["a", "s_1727000000000_k3j2h1x", "eval-task.id:2", "x".repeat(128)]) {
      expect([id, isAiSessionId(id)]).toEqual([id, true]);
    }
  });

  it("refuses the empty string, anything longer than 128, other characters and non-strings", () => {
    for (const id of ["", "x".repeat(129), "has space", "slash/id", "ünïcode", "a\nb"]) {
      expect([id, isAiSessionId(id)]).toEqual([id, false]);
    }
    // A missing header reads as null; nothing that is not a string is an id.
    for (const value of [null, 42, ["s_1"]]) {
      expect(isAiSessionId(value)).toBe(false);
    }
  });
});

describe("the hints are exported where a backend looks for them", () => {
  it("names the client's session header", () => {
    expect(AI_SESSION_HEADER).toBe("X-Jx-Ai-Session");
  });

  it("from the root, ./streaming-client and ./gateway alike", () => {
    for (const surface of [ai, streamingClient, gateway] as Record<string, unknown>[]) {
      expect(surface.AI_SESSION_HEADER).toBe(AI_SESSION_HEADER);
      expect(surface.affinityKey).toBe(affinityKey);
      expect(surface.isAiSessionId).toBe(isAiSessionId);
      expect(surface.upstreamCacheHints).toBe(upstreamCacheHints);
    }
  });
});
