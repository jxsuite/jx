/**
 * Tests for the native Anthropic provider (specs/ai.md §2.6): the projection of the neutral
 * conversation onto the Messages API, the rule that decides which signed thinking is replayed, the
 * one retry, and the stream it yields.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { bindingOf, stripOlderSignatures } from "../src/messages/index.ts";
import type {
  Block,
  LiveMessage,
  ReasoningBlock,
  ToolSpec,
  WireMessage,
} from "../src/messages/index.ts";
import {
  BINDING_CONTROLS_BETA,
  anthropicCapabilities,
  anthropicToolId,
  createAnthropicProvider,
  toAnthropicMessagesRequest,
} from "../src/providers/index.ts";
import type {
  MessagesProjectionOptions,
  Provider,
  ProviderRequest,
} from "../src/providers/index.ts";
import type { WireEvent } from "../src/streaming-client.ts";
import { fakeUpstream } from "../src/testing/index.ts";

const TOOLS: ToolSpec[] = [
  { description: "Set text", inputSchema: { properties: {}, type: "object" }, name: "set_text" },
];
const SYSTEM = [{ cache: true as const, text: "You edit pages. " }, { text: "The page is open." }];
const OPTIONS: MessagesProjectionOptions = { defaultMaxTokens: 1000 };

const user = (text: string): WireMessage => ({ blocks: [{ text, type: "text" }], role: "user" });
const reply = (callId: string, content = '{"success":true}', isError = false): WireMessage => ({
  blocks: [{ callId, content, isError, type: "tool_result" }],
  role: "tool",
});
const call = (id: string, argumentsText = "{}"): Block => ({
  argumentsText,
  id,
  name: "set_text",
  type: "tool_call",
});

/** A request over `messages`, with the fixed system prompt and tools. */
const requestOf = (messages: WireMessage[]): ProviderRequest => ({
  messages,
  model: "claude-opus-5-5",
  system: SYSTEM,
  tools: TOOLS,
});

/** A conversation whose signed thinking is bound as a real turn binds it: to its own request. */
function boundConversation(turns: number): WireMessage[] {
  const messages: WireMessage[] = [user("Start.")];
  for (let turn = 0; turn < turns; turn += 1) {
    const binding = bindingOf({ system: SYSTEM, tools: TOOLS }, messages, messages.length);
    const thinking: ReasoningBlock = {
      provenance: { binding, family: "anthropic", model: "claude-opus-5-5" },
      signature: `sig_${String(turn)}`,
      text: `Thinking ${String(turn)}.`,
      type: "reasoning",
    };
    messages.push(
      { blocks: [thinking, call(`toolu_${String(turn)}`)], role: "assistant" },
      reply(`toolu_${String(turn)}`),
    );
  }
  return messages;
}

/** The thinking parts a projected request carries, as `signature` strings, per assistant message. */
function replayed(
  request: ProviderRequest,
  options: MessagesProjectionOptions = OPTIONS,
): string[][] {
  const body = toAnthropicMessagesRequest(request, options);
  return body.messages
    .filter((message) => message.role === "assistant")
    .map((message) =>
      message.content.flatMap((part) => (part.type === "thinking" ? [part.signature] : [])),
    );
}

describe("toAnthropicMessagesRequest", () => {
  it("projects the system prompt, the tools and each message's blocks in order", () => {
    const messages = boundConversation(1);
    messages.push({ blocks: [{ text: "Done.", type: "text" }], role: "assistant" }, user("More."));
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body).toEqual({
      max_tokens: 1000,
      messages: [
        { content: [{ text: "Start.", type: "text" }], role: "user" },
        {
          content: [
            { signature: "sig_0", thinking: "Thinking 0.", type: "thinking" },
            { id: "toolu_0", input: {}, name: "set_text", type: "tool_use" },
          ],
          role: "assistant",
        },
        {
          content: [{ content: '{"success":true}', tool_use_id: "toolu_0", type: "tool_result" }],
          role: "user",
        },
        { content: [{ text: "Done.", type: "text" }], role: "assistant" },
        { content: [{ text: "More.", type: "text" }], role: "user" },
      ],
      model: "claude-opus-5-5",
      stream: true,
      system: [
        { text: "You edit pages. ", type: "text" },
        { text: "The page is open.", type: "text" },
      ],
      tools: [
        {
          description: "Set text",
          input_schema: { properties: {}, type: "object" },
          name: "set_text",
        },
      ],
    });
  });

  it("replays every signed block while each binding still holds", () => {
    const request = requestOf(boundConversation(3));
    expect(replayed(request)).toEqual([["sig_0"], ["sig_1"], ["sig_2"]]);
  });

  it("drops all thinking when the system prompt changed, since every binding is stale", () => {
    const request = { ...requestOf(boundConversation(2)), system: [{ text: "Another prompt." }] };
    expect(replayed(request)).toEqual([[], []]);
  });

  it("drops all thinking when the tools changed", () => {
    const request = { ...requestOf(boundConversation(2)), tools: [] };
    expect(replayed(request)).toEqual([[], []]);
  });

  it("keeps only the trailing run when an earlier message changed under a later block", () => {
    const messages = boundConversation(3);
    /* The first turn's tool result was shortened after the fact (a host shedding old output). The
       first turn's own block was bound before that result existed, and still binds. The second and
       third were bound over the result as it was, so both are stale: once one block in the run is
       stale, nothing before it is replayed either. */
    messages[2] = reply("toolu_0", '{"success":true,"shed":"removed"}');
    expect(replayed(requestOf(messages))).toEqual([[], [], []]);

    // A later turn bound over the changed history binds; the stale turns before it are stripped.
    const rebound = messages.slice(0, 5);
    const binding = bindingOf({ system: SYSTEM, tools: TOOLS }, rebound, rebound.length);
    rebound.push(
      {
        blocks: [
          {
            provenance: { binding, family: "anthropic", model: "claude-opus-5-5" },
            signature: "sig_fresh",
            text: "Fresh.",
            type: "reasoning",
          },
          call("toolu_9"),
        ],
        role: "assistant",
      },
      reply("toolu_9"),
    );
    expect(replayed(requestOf(rebound))).toEqual([[], [], ["sig_fresh"]]);
  });

  it("removing leading thinking does not unbind what follows", () => {
    const messages = boundConversation(2);
    // The first turn's thinking is gone (a reload kept only the latest signature).
    messages[1] = { blocks: [call("toolu_0")], role: "assistant" };
    expect(replayed(requestOf(messages))).toEqual([[], ["sig_1"]]);
  });

  it("never sends thinking another family produced, thinking with no signature, or any when told not to", () => {
    const binding = bindingOf({ system: SYSTEM, tools: TOOLS }, [user("Start.")], 1);
    const blocks: Block[] = [
      { text: "From a v1 turn.", type: "reasoning" },
      {
        provenance: { binding, family: "openai-compat", model: "deepseek" },
        signature: "foreign",
        text: "Foreign.",
        type: "reasoning",
      },
      {
        provenance: { binding, family: "anthropic", model: "m" },
        text: "Unsigned.",
        type: "reasoning",
      },
      {
        provenance: { binding, family: "anthropic", model: "m" },
        redacted: "opaque",
        text: "",
        type: "reasoning",
      },
      {
        provenance: { binding, family: "anthropic", model: "m" },
        signature: "sig",
        text: "Kept.",
        type: "reasoning",
      },
      { text: "Answer.", type: "text" },
    ];
    const messages = [user("Start."), { blocks, role: "assistant" as const }, user("Next.")];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body.messages[1]!.content).toEqual([
      { data: "opaque", type: "redacted_thinking" },
      { signature: "sig", thinking: "Kept.", type: "thinking" },
      { text: "Answer.", type: "text" },
    ]);
    const stripped = toAnthropicMessagesRequest(requestOf(messages), {
      ...OPTIONS,
      withoutThinking: true,
    });
    expect(stripped.messages[1]!.content).toEqual([{ text: "Answer.", type: "text" }]);
  });

  it("joins a run of tool replies into one user message, and marks a failed one", () => {
    const messages: WireMessage[] = [
      user("Start."),
      { blocks: [call("a"), call("b")], role: "assistant" },
      reply("a"),
      reply("b", '{"success":false,"error":"No."}', true),
      user("Carry on."),
    ];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body.messages[2]).toEqual({
      content: [
        { content: '{"success":true}', tool_use_id: "a", type: "tool_result" },
        {
          content: '{"success":false,"error":"No."}',
          is_error: true,
          tool_use_id: "b",
          type: "tool_result",
        },
        // The person's next message rides on the same user turn, after the results.
        { text: "Carry on.", type: "text" },
      ],
      role: "user",
    });
  });

  it("sends consecutive user messages as one user turn", () => {
    // A summary of an earlier conversation, then the person's new message.
    const body = toAnthropicMessagesRequest(
      requestOf([user("[Summary of the earlier conversation.]"), user("And now this.")]),
      OPTIONS,
    );
    expect(body.messages).toEqual([
      {
        content: [
          { text: "[Summary of the earlier conversation.]", type: "text" },
          { text: "And now this.", type: "text" },
        ],
        role: "user",
      },
    ]);
  });

  it("starts at a person's message and never ends on an assistant one", () => {
    const messages: WireMessage[] = [
      { blocks: [call("orphan")], role: "assistant" },
      reply("orphan"),
      user("Hello."),
      { blocks: [{ text: "Half a rep", type: "text" }], role: "assistant" },
    ];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body.messages).toEqual([{ content: [{ text: "Hello.", type: "text" }], role: "user" }]);
    // A history with nothing a person wrote sends no message at all.
    const none = toAnthropicMessagesRequest(requestOf([messages[0]!, messages[1]!]), OPTIONS);
    expect(none.messages).toEqual([]);
  });

  it("drops what the API would refuse: empty text, an empty turn, a block that is not a reply", () => {
    const messages: WireMessage[] = [
      user("Hello."),
      { blocks: [{ text: "", type: "text" }], role: "assistant" },
      { blocks: [{ text: "stray", type: "text" }], role: "tool" },
      user(""),
      user("Still here."),
    ];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    // With nothing left between them, the two messages of a person's are one user turn.
    expect(body.messages).toEqual([
      {
        content: [
          { text: "Hello.", type: "text" },
          { text: "Still here.", type: "text" },
        ],
        role: "user",
      },
    ]);
  });

  it("sends arguments that are not an object as an empty input", () => {
    const messages: WireMessage[] = [
      user("Go."),
      { blocks: [call("a", '{"x":'), call("b", "[1]"), call("c", '{"x":1}')], role: "assistant" },
      reply("a"),
      reply("b"),
      reply("c"),
    ];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body.messages[1]!.content).toEqual([
      { id: "a", input: {}, name: "set_text", type: "tool_use" },
      { id: "b", input: {}, name: "set_text", type: "tool_use" },
      { id: "c", input: { x: 1 }, name: "set_text", type: "tool_use" },
    ]);
  });

  it("rewrites an id the API would refuse, the same way on the call and its reply", () => {
    const messages: WireMessage[] = [
      user("Go."),
      { blocks: [call("call:1")], role: "assistant" },
      reply("call:1"),
      // A reply to a call no message made still gets an id the API accepts.
      reply("ghost!"),
    ];
    const body = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(body.messages[1]!.content[0]).toMatchObject({ id: "toolu_call_1_1" });
    expect(body.messages[2]!.content).toEqual([
      { content: '{"success":true}', tool_use_id: "toolu_call_1_1", type: "tool_result" },
      { content: '{"success":true}', tool_use_id: "toolu_ghost__3", type: "tool_result" },
    ]);
    expect(anthropicToolId("toolu_ok-1", 4)).toBe("toolu_ok-1");
    // Two ids that differ only in a refused character do not collide across messages.
    expect(anthropicToolId("a.b", 1)).not.toBe(anthropicToolId("a:b", 3));
  });

  it("puts a system message where the model takes one, or on the next user message where it does not", () => {
    const context: WireMessage = {
      blocks: [{ text: "The page changed.", type: "text" }],
      role: "system",
    };
    const messages: WireMessage[] = [
      { blocks: [{ text: "Before anything.", type: "text" }], role: "system" },
      { blocks: [{ text: "", type: "text" }], role: "system" },
      user("Go."),
      { blocks: [call("a")], role: "assistant" },
      reply("a"),
      context,
      user("And now?"),
    ];
    const capable = toAnthropicMessagesRequest(requestOf(messages), {
      ...OPTIONS,
      midConversationSystem: true,
    });
    // One before the conversation begins joins the top-level system either way.
    expect(capable.system!.at(-1)).toEqual({ text: "Before anything.", type: "text" });
    expect(capable.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "system",
      "user",
    ]);
    expect(capable.messages[3]!.content).toEqual([{ text: "The page changed.", type: "text" }]);

    const other = toAnthropicMessagesRequest(requestOf(messages), OPTIONS);
    expect(other.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(other.messages[2]!.content).toEqual([
      { content: '{"success":true}', tool_use_id: "a", type: "tool_result" },
      { text: "The page changed.", type: "text" },
      { text: "And now?", type: "text" },
    ]);

    // With no later user message, the context rides on the tool results it followed.
    const trailing = toAnthropicMessagesRequest(requestOf(messages.slice(0, 6)), OPTIONS);
    expect(trailing.messages.at(-1)!.content.at(-1)).toEqual({
      text: "The page changed.",
      type: "text",
    });
    // And with nothing to ride on at all, it is not sent.
    const nowhere = toAnthropicMessagesRequest(requestOf([user("Go."), context]), OPTIONS);
    expect(nowhere.messages).toEqual([{ content: [{ text: "Go.", type: "text" }], role: "user" }]);
  });

  it("marks the cacheable prefixes on Anthropic's own API, and nowhere else", () => {
    const messages = [...boundConversation(1), user("More.")];
    const marked = toAnthropicMessagesRequest(requestOf(messages), {
      ...OPTIONS,
      firstParty: true,
    });
    const mark = { type: "ephemeral" } as const;
    // The last system block flagged as stable, the last tool, and the last user message.
    expect(marked.system).toEqual([
      { cache_control: mark, text: "You edit pages. ", type: "text" },
      { text: "The page is open.", type: "text" },
    ]);
    expect(marked.tools!.at(-1)).toMatchObject({
      cache_control: mark,
      eager_input_streaming: true,
    });
    expect(marked.messages.at(-1)!.content.at(-1)).toEqual({
      cache_control: mark,
      text: "More.",
      type: "text",
    });
    const plain = JSON.stringify(toAnthropicMessagesRequest(requestOf(messages), OPTIONS));
    expect(plain).not.toContain("cache_control");
    expect(plain).not.toContain("eager_input_streaming");
  });

  it("marks only what is there: no flagged block, no tools, a last user turn of tool results", () => {
    const messages = boundConversation(1);
    const body = toAnthropicMessagesRequest(
      { messages, model: "m", system: [{ text: "" }, { text: "Plain." }], tools: [] },
      { ...OPTIONS, firstParty: true },
    );
    expect(body.system).toEqual([{ text: "Plain.", type: "text" }]);
    expect(body.tools).toBeUndefined();
    expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
      cache_control: { type: "ephemeral" },
      type: "tool_result",
    });
    // No user message at all leaves nothing to mark, and no system at all sends none.
    const empty = toAnthropicMessagesRequest(
      { messages: [], model: "m", system: [], tools: [] },
      { ...OPTIONS, firstParty: true },
    );
    expect(empty).toEqual({ max_tokens: 1000, messages: [], model: "m", stream: true });
  });

  it("carries the token ceiling, the temperature, and thinking with its binding control", () => {
    const body = toAnthropicMessagesRequest(
      { ...requestOf([user("Go.")]), maxTokens: 64, temperature: 0 },
      {
        ...OPTIONS,
        bindingControls: { prefixMismatch: "drop_block" },
        thinking: { type: "adaptive" },
      },
    );
    expect(body).toMatchObject({
      max_tokens: 64,
      temperature: 0,
      thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" }, type: "adaptive" },
    });
    const controlsOnly = toAnthropicMessagesRequest(requestOf([user("Go.")]), {
      ...OPTIONS,
      bindingControls: { prefixMismatch: "error" },
    });
    expect(controlsOnly.thinking).toEqual({ block_binding: { prefix_mismatch_behavior: "error" } });
    const plain = toAnthropicMessagesRequest(requestOf([user("Go.")]), OPTIONS);
    expect(plain.thinking).toBeUndefined();
  });
});

describe("anthropicCapabilities", () => {
  it.each<[string, boolean]>([
    ["claude-opus-5-5", true],
    ["claude-opus-4-8", true],
    ["claude-fable-5-1", true],
    ["claude-mythos-5", true],
    ["claude-sonnet-5-5", false],
    ["claude-haiku-5-5", false],
  ])("%s takes a mid-conversation system message: %p", (model, midConversationSystem) => {
    expect(anthropicCapabilities(model)).toEqual({
      family: "anthropic",
      maxCacheBreakpoints: 4,
      midConversationSystem,
      promptLayout: "append",
      requiresMaxTokens: true,
      toolListing: "stable",
    });
  });
});

describe("createAnthropicProvider", () => {
  const OK = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hm."}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}',
    'data: {"type":"content_block_stop","index":0}',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":"Hi"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    'data: {"type":"message_stop"}',
    "",
  ].join("\n\n");

  /** One round through `provider`, read to its end. */
  async function roundOf(provider: Provider, request: ProviderRequest): Promise<WireEvent[]> {
    const out: WireEvent[] = [];
    for await (const frame of provider.stream(request, new AbortController().signal)) {
      out.push(frame);
    }
    return out;
  }

  /** A conversation with one signed turn behind it, and a person's next message. */
  const SIGNED = requestOf([...boundConversation(1), user("More.")]);
  const HELLO = requestOf([user("Hello.")]);

  /** A `fetch` over a scripted upstream, with the global's own `preconnect` beside it. */
  function upstreamFetch(upstream: ReturnType<typeof fakeUpstream>): typeof fetch {
    return Object.assign((input: RequestInfo | URL, init?: RequestInit) => upstream(input, init), {
      preconnect: fetch.preconnect,
    });
  }

  const bodyOf = (upstream: ReturnType<typeof fakeUpstream>, nth = 0) =>
    // SAFETY: the provider's only request body is JSON.stringify of its Messages API request.
    JSON.parse(String(upstream.calls[nth]!.init?.body)) as {
      messages: { content: { type: string }[] }[];
      thinking?: object;
    };

  it("opens with stream_start, then signed thinking, text, usage and done", async () => {
    const upstream = fakeUpstream([{ sse: OK, status: 200 }]);
    const provider = createAnthropicProvider({ apiKey: "sk-ant", fetch: upstreamFetch(upstream) });
    expect(provider.family).toBe("anthropic");
    const frames = await roundOf(provider, HELLO);
    expect(frames).toEqual([
      { family: "anthropic", model: "claude-opus-5-5", type: "stream_start", wire: 2 },
      { block: 0, content: "Hm.", type: "reasoning" },
      { block: 0, signature: "sig", type: "reasoning_signature" },
      { block: 1, content: "Hi", type: "delta" },
      { inputTokens: 4, outputTokens: 2, type: "usage" },
      { stopReason: "stop", type: "done" },
    ]);
    const [sent] = upstream.calls;
    expect(sent!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent!.init?.headers).toMatchObject({ "x-api-key": "sk-ant" });
    expect(sent!.init?.headers).not.toHaveProperty("anthropic-beta");
    // Anthropic's own API: the request marks its cacheable prefixes.
    expect(String(sent!.init?.body)).toContain("cache_control");
  });

  it("retries once with no thinking when the API says a block is bound elsewhere", async () => {
    const refusal = JSON.stringify({
      error: {
        message: "thinking block is bound to a different conversation",
        type: "invalid_request_error",
      },
    });
    const upstream = fakeUpstream([
      { body: refusal, status: 400 },
      { sse: OK, status: 200 },
    ]);
    const provider = createAnthropicProvider({
      apiKey: "k",
      baseUrl: "https://claude.test",
      fetch: upstreamFetch(upstream),
    });
    const frames = await roundOf(provider, SIGNED);
    expect(frames.at(-1)).toEqual({ stopReason: "stop", type: "done" });
    expect(upstream.calls).toHaveLength(2);
    const types = (nth: number) =>
      bodyOf(upstream, nth).messages.flatMap((message) => message.content.map((part) => part.type));
    expect(types(0)).toContain("thinking");
    expect(types(1)).not.toContain("thinking");
    expect(upstream.calls[0]!.url).toBe("https://claude.test/v1/messages");
  });

  it("shows any other refusal, and a refusal of a request that replays nothing, as the error it is", async () => {
    const bound = JSON.stringify({ error: { message: "bound to a different conversation" } });
    const upstream = fakeUpstream([
      { body: JSON.stringify({ error: { message: "max_tokens too large" } }), status: 400 },
      { body: bound, status: 400 },
    ]);
    const provider = createAnthropicProvider({ apiKey: "k", fetch: upstreamFetch(upstream) });
    const first = await roundOf(provider, SIGNED);
    expect(first.at(-1)).toMatchObject({
      code: "400",
      message: "max_tokens too large",
      type: "error",
    });
    // Nothing to strip, so nothing to retry with.
    const second = await roundOf(provider, HELLO);
    expect(second.at(-1)).toMatchObject({ code: "400", type: "error" });
    expect(upstream.calls).toHaveLength(2);
  });

  it("says what to do with a mismatch where binding controls exist, and passes thinking through", async () => {
    const upstream = fakeUpstream([{ sse: OK, status: 200 }]);
    const provider = createAnthropicProvider({
      apiKey: "k",
      bindingControls: { prefixMismatch: "drop_block" },
      defaultMaxTokens: 512,
      fetch: upstreamFetch(upstream),
      thinking: { type: "adaptive" },
    });
    await roundOf(provider, HELLO);
    expect(upstream.calls[0]!.init?.headers).toMatchObject({
      "anthropic-beta": BINDING_CONTROLS_BETA,
    });
    expect(bodyOf(upstream)).toMatchObject({
      max_tokens: 512,
      thinking: { block_binding: { prefix_mismatch_behavior: "drop_block" }, type: "adaptive" },
    });
    expect(provider.capabilities("claude-sonnet-5-5").midConversationSystem).toBe(false);
  });

  it("answers an API that cannot be reached with one error frame, through the global fetch", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = upstreamFetch(fakeUpstream([]));
    try {
      const provider = createAnthropicProvider({ apiKey: "k" });
      const frames = await roundOf(provider, HELLO);
      expect(frames).toHaveLength(2);
      expect(frames[1]).toMatchObject({ type: "error" });
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe("bindingOf", () => {
  const request = { system: SYSTEM, tools: TOOLS };
  const messages = boundConversation(2);

  it("is the same for the same request and prefix, however the system prompt is split", () => {
    const joined = { system: [{ text: "You edit pages. The page is open." }], tools: TOOLS };
    expect(bindingOf(joined, messages, 3)).toBe(bindingOf(request, messages, 3));
  });

  it("changes with the system prompt, the tools, the prefix, and the place", () => {
    const base = bindingOf(request, messages, 3);
    const variants = [
      bindingOf({ ...request, system: [{ text: "Other." }] }, messages, 3),
      bindingOf({ ...request, tools: [] }, messages, 3),
      bindingOf({ ...request, tools: [{ ...TOOLS[0]!, description: "Changed" }] }, messages, 3),
      bindingOf(request, [user("Different."), ...messages.slice(1)], 3),
      bindingOf(request, messages, 1),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it("does not change when reasoning before it is removed, or when anything after it changes", () => {
    const base = bindingOf(request, messages, 3);
    const withoutThinking = messages.map((message): WireMessage => ({
      ...message,
      blocks: message.blocks.filter((block) => block.type !== "reasoning"),
    }));
    expect(bindingOf(request, withoutThinking, 3)).toBe(base);
    expect(bindingOf(request, [...messages.slice(0, 3), user("Anything.")], 3)).toBe(base);
    // A tool's title is not sent to the provider, so it is not part of what binds.
    const titled = { ...request, tools: [{ ...TOOLS[0]!, title: "Set the text" }] };
    expect(bindingOf(titled, messages, 3)).toBe(base);
  });
});

describe("stripOlderSignatures", () => {
  const signed = (id: string, text: string): LiveMessage => ({
    blocks: [
      {
        provenance: { family: "anthropic", model: "m" },
        signature: `sig_${id}`,
        text,
        type: "reasoning",
      },
      { text: "Answer.", type: "text" },
    ],
    content: "Answer.",
    id,
    role: "assistant",
    timestamp: 1,
  });

  it("keeps signatures on the latest signed turn alone, and the text of the others", () => {
    const messages: LiveMessage[] = [
      { content: "Hi", id: "u1", role: "user", timestamp: 1 },
      signed("a1", "First."),
      {
        blocks: [
          { redacted: "opaque", text: "", type: "reasoning" },
          { redacted: "kept-text", text: "Partly shown.", type: "reasoning" },
          { text: "Answer.", type: "text" },
        ],
        content: "Answer.",
        id: "a2",
        role: "assistant",
        timestamp: 1,
      },
      signed("a3", "Latest."),
      { content: "plain", id: "a4", role: "assistant", timestamp: 1 },
    ];
    const stripped = stripOlderSignatures(messages);
    expect(stripped[1]!.blocks).toEqual([
      { provenance: { family: "anthropic", model: "m" }, text: "First.", type: "reasoning" },
      { text: "Answer.", type: "text" },
    ]);
    // A block that was only an opaque payload has nothing left to keep.
    expect(stripped[2]!.blocks).toEqual([
      { text: "Partly shown.", type: "reasoning" },
      { text: "Answer.", type: "text" },
    ]);
    expect(stripped[3]).toBe(messages[3]!);
    expect(stripped[0]).toBe(messages[0]!);
    expect(stripped[4]).toBe(messages[4]!);
    // The messages given are not changed.
    expect(messages[1]!.blocks![0]).toHaveProperty("signature", "sig_a1");
  });

  it("changes nothing in a conversation with no signed thinking", () => {
    const messages: LiveMessage[] = [
      { content: "Hi", id: "u1", role: "user", timestamp: 1 },
      {
        blocks: [{ text: "t", type: "reasoning" }],
        content: "",
        id: "a1",
        role: "assistant",
        timestamp: 1,
      },
    ];
    const stripped = stripOlderSignatures(messages);
    expect(stripped).toEqual(messages);
    expect(stripped[1]).toBe(messages[1]!);
  });
});
