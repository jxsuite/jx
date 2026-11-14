/**
 * Tests for `@jxsuite/ai/providers`: the shared chat-completions body, the OpenAI-compatible
 * provider adapter, and the model function over a provider (specs/ai.md §2.7).
 *
 * @module @jxsuite/ai/tests
 */

import { afterEach, describe, expect, it } from "bun:test";
import { problemDetails } from "@jxsuite/protocol/problems";
import { toOpenAIMessages, toOpenAITools } from "../src/messages/index.ts";
import type { ChatMessage } from "../src/messages/index.ts";
import {
  chatCompletionsBody,
  createOpenAICompatProvider,
  providerModel,
} from "../src/providers/index.ts";
import type { ProviderRequest } from "../src/providers/index.ts";
import { createOpenAIStreamingClient } from "../src/streaming-client.ts";
import type { WireEvent } from "../src/streaming-client.ts";
import { fakeUpstream } from "../src/testing/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const OK =
  'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

const REQUEST: ProviderRequest = {
  messages: [{ blocks: [{ text: "Hello", type: "text" }], role: "user" }],
  model: "m-1",
  system: [{ text: "Be " }, { text: "brief." }],
  tools: [{ description: "d", inputSchema: { type: "object" }, name: "probe" }],
};

async function collect(frames: AsyncIterable<WireEvent>): Promise<WireEvent[]> {
  const out: WireEvent[] = [];
  for await (const frame of frames) {
    out.push(frame);
  }
  return out;
}

/** A `fetch` over a scripted upstream, with the global's own `preconnect` beside it. */
function upstreamFetch(upstream: ReturnType<typeof fakeUpstream>): typeof fetch {
  return Object.assign((input: RequestInfo | URL, init?: RequestInit) => upstream(input, init), {
    preconnect: realFetch.preconnect,
  });
}

describe("chatCompletionsBody", () => {
  it("is the system prompt, the conversation and a request for the provider's own count", () => {
    expect(
      chatCompletionsBody({
        messages: [{ content: "a", role: "user" }],
        model: "m",
        systemPrompt: "S",
        tools: [],
      }),
    ).toEqual({
      messages: [
        { content: "S", role: "system" },
        { content: "a", role: "user" },
      ],
      model: "m",
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("offers tools with a choice and parallel calls only when there are any", () => {
    const tools = [{ type: "function" }];
    const base = { messages: [], model: "m", systemPrompt: "" };
    expect(chatCompletionsBody({ ...base, tools })).toMatchObject({
      parallel_tool_calls: true,
      tool_choice: "auto",
      tools,
    });
    expect(chatCompletionsBody({ ...base, toolChoice: "required", tools }).tool_choice).toBe(
      "required",
    );
    // A choice with nothing to choose from is not sent.
    expect(chatCompletionsBody({ ...base, toolChoice: "required", tools: [] })).not.toHaveProperty(
      "tool_choice",
    );
  });

  it("adds an optional member only when it was given, in one order, with the hints last", () => {
    const body = chatCompletionsBody({
      hints: { prompt_cache_key: "k" },
      maxTokens: 64,
      messages: [],
      model: "m",
      reasoningEffort: "low",
      systemPrompt: "",
      temperature: 0,
      tools: [{ type: "function" }],
    });
    expect(Object.keys(body)).toEqual([
      "model",
      "messages",
      "stream",
      "stream_options",
      "temperature",
      "max_tokens",
      "reasoning_effort",
      "tools",
      "tool_choice",
      "parallel_tool_calls",
      "prompt_cache_key",
    ]);
    expect(body).toMatchObject({ max_tokens: 64, reasoning_effort: "low", temperature: 0 });
  });
});

describe("createOpenAICompatProvider", () => {
  it("declares the family's capabilities, the same for every model", () => {
    const provider = createOpenAICompatProvider({ apiKey: "k", baseUrl: "https://llm.test/v1" });
    expect(provider.family).toBe("openai-compat");
    expect(provider.capabilities("any-model")).toEqual({
      family: "openai-compat",
      maxCacheBreakpoints: 0,
      midConversationSystem: true,
      promptLayout: "rebuild",
      requiresMaxTokens: false,
      toolListing: "per-round",
    });
  });

  it("opens with stream_start, then the gateway normalizer's frames", async () => {
    const upstream = fakeUpstream([{ sse: OK, status: 200 }]);
    const provider = createOpenAICompatProvider({
      apiKey: "sk-1",
      baseUrl: "https://llm.test/v1",
      fetch: upstreamFetch(upstream),
    });
    const frames = await collect(provider.stream(REQUEST, new AbortController().signal));
    expect(frames).toEqual([
      { family: "openai-compat", model: "m-1", type: "stream_start", wire: 2 },
      { content: "Hi", type: "delta" },
      { stopReason: "stop", type: "done" },
    ]);
    const [call] = upstream.calls;
    expect(call!.url).toBe("https://llm.test/v1/chat/completions");
    expect(call!.init?.headers).toEqual({
      Authorization: "Bearer sk-1",
      "Content-Type": "application/json",
    });
  });

  it("sends the body the OpenAI streaming client sends for the same request", async () => {
    const viaProvider = fakeUpstream([{ sse: OK, status: 200 }]);
    const provider = createOpenAICompatProvider({
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      fetch: upstreamFetch(viaProvider),
      sessionAffinity: "aff-1",
    });
    await collect(provider.stream(REQUEST, new AbortController().signal));

    const viaClient = fakeUpstream([{ sse: OK, status: 200 }]);
    globalThis.fetch = upstreamFetch(viaClient);
    const client = createOpenAIStreamingClient({
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      model: "m-1",
      sessionAffinity: "aff-1",
    });
    // What a version 1 caller hands the client: the same request, through the same projections.
    const sent = client.streamChat(
      toOpenAIMessages(REQUEST.messages),
      toOpenAITools(REQUEST.tools),
      "Be brief.",
      new AbortController().signal,
    );
    await collect(sent);

    const sentByProvider = String(viaProvider.calls[0]!.init?.body);
    expect(sentByProvider).toBe(String(viaClient.calls[0]!.init?.body));
    expect(sentByProvider).toContain('"prompt_cache_key":"aff-1"');
  });

  it("forwards a token ceiling and a temperature, and reads with the caller's quirks", async () => {
    const upstream = fakeUpstream([
      {
        sse: 'data: {"choices":[{"delta":{"reasoning":"kept","reasoning_content":"dropped"}}]}\n\ndata: [DONE]\n\n',
        status: 200,
      },
    ]);
    const provider = createOpenAICompatProvider({
      apiKey: "k",
      baseUrl: "https://llm.test/v1",
      fetch: upstreamFetch(upstream),
      quirks: { reasoningField: "reasoning" },
    });
    const frames = await collect(
      provider.stream(
        { ...REQUEST, maxTokens: 32, temperature: 0.5 },
        new AbortController().signal,
      ),
    );
    expect(frames[1]).toEqual({ content: "kept", type: "reasoning" });
    expect(String(upstream.calls[0]!.init?.body)).toContain('"temperature":0.5,"max_tokens":32');
  });

  it("answers an upstream that cannot be reached with one error frame, through the global fetch", async () => {
    globalThis.fetch = upstreamFetch(fakeUpstream([]));
    const provider = createOpenAICompatProvider({ apiKey: "k", baseUrl: "https://llm.test/v1" });
    const frames = await collect(provider.stream(REQUEST, new AbortController().signal));
    const message = "Network error: fakeUpstream: no fixture left for this request";
    expect(frames).toEqual([
      { family: "openai-compat", model: "m-1", type: "stream_start", wire: 2 },
      { message, problem: problemDetails("upstreamFailure", message), type: "error" },
    ]);
  });
});

describe("providerModel", () => {
  it("sends each round's conversation to the provider, without the turn's empty placeholder", async () => {
    const requests: ProviderRequest[] = [];
    const model = providerModel(
      {
        capabilities: () => {
          throw new Error("not asked");
        },
        family: "openai-compat",
        async *stream(request) {
          requests.push(request);
          yield { stopReason: "stop", type: "done" };
        },
      },
      "m-7",
    );
    const history: ChatMessage[] = [
      { blocks: [{ text: "Hello", type: "text" }], id: "u1", role: "user", timestamp: 1 },
      { blocks: [], id: "a1", role: "assistant", timestamp: 2 },
    ];
    const tools = [{ description: "d", inputSchema: { type: "object" as const }, name: "probe" }];
    const frames = await collect(
      model({ messages: history, system: [{ text: "S" }], tools }, new AbortController().signal),
    );
    expect(frames).toEqual([{ stopReason: "stop", type: "done" }]);
    expect(requests).toEqual([
      {
        messages: [{ blocks: [{ text: "Hello", type: "text" }], role: "user" }],
        model: "m-7",
        system: [{ text: "S" }],
        tools,
      },
    ]);
  });
});
