/**
 * The neutral conversation model (specs/ai.md §2.3) and its OpenAI-compatible projection (§2.2).
 *
 * Two properties are held against the frozen v1 corpus (`fixtures/v1/transcripts/`), which records
 * what `toMessagesArray` sent before the projection moved here:
 *
 * - `toOpenAIMessages(toChatMessages(x))` is that corpus's `wire`, for every transcript.
 * - `toLiveMessages(toChatMessages(x))` keeps every field a v1 message declares. The one it does not
 *   carry is a tool call's `result`, the chip's copy of what the `tool` reply already says.
 *
 * The rest pins the block rules the corpus cannot reach, because no v1 message has blocks.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fromOpenAITools,
  isEmptyAssistant,
  toChatMessages,
  toLiveMessages,
  toOpenAIMessages,
  toOpenAITools,
  toWireMessages,
} from "../src/messages/index.ts";
import type {
  Block,
  ChatMessage,
  LiveMessage,
  OpenAITool,
  ToolSpec,
} from "../src/messages/index.ts";

const DIR = join(import.meta.dir, "fixtures", "v1", "transcripts");

interface Fixture {
  file: string;
  messages: LiveMessage[];
  wire: unknown[];
}

const corpus: Fixture[] = readdirSync(DIR)
  .filter((file) => file.endsWith(".json"))
  .toSorted()
  .map((file) => {
    const data = JSON.parse(readFileSync(join(DIR, file), "utf8")) as Omit<Fixture, "file">;
    return { file, messages: data.messages, wire: data.wire };
  });

/** A JSON-only copy: `undefined` members dropped, as the wire drops them. */
function plain(value: unknown): unknown {
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- JSON normalization is the point
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/**
 * The fields a v1 message's role uses: its text for every role, its reasoning and calls (without
 * `result`) for an assistant, its call id for a tool reply. An empty call list says nothing.
 */
function declared(message: LiveMessage): Record<string, unknown> {
  const { id, role, content, reasoningContent, toolCalls, toolCallId, timestamp } = message;
  const fields: Record<string, unknown> = { id, role, content, timestamp };
  if (role === "assistant") {
    fields.reasoningContent = reasoningContent;
    fields.toolCalls = toolCalls?.length
      ? toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments }))
      : undefined;
  }
  if (role === "tool") {
    fields.toolCallId = toolCallId;
  }
  return fields;
}

function chat(id: string, role: ChatMessage["role"], blocks: Block[], extra = {}): ChatMessage {
  return { id, role, blocks, timestamp: 1, ...extra };
}

describe("the v1 corpus", () => {
  test("is not empty, so the properties below are not vacuous", () => {
    expect(corpus.length).toBeGreaterThan(10);
  });

  for (const fixture of corpus) {
    describe(fixture.file, () => {
      test("projects to the frozen wire", () => {
        const wire = toOpenAIMessages(toChatMessages(fixture.messages));
        expect(plain(wire)).toEqual(fixture.wire);
      });

      test("round-trips every declared field, and needs no blocks to do it", () => {
        const back = toLiveMessages(toChatMessages(fixture.messages));
        const expected = fixture.messages.map((m) => declared(m));
        expect(plain(back)).toEqual(plain(expected));
        expect(back.some((m) => m.blocks !== undefined)).toBe(false);
      });

      test("is a fixed point in the neutral form", () => {
        const neutral = toChatMessages(fixture.messages);
        const again = toChatMessages(toLiveMessages(neutral));
        expect(plain(again)).toEqual(plain(neutral));
      });
    });
  }
});

describe("toChatMessages", () => {
  test("reads an assistant turn as reasoning, then text, then its calls", () => {
    const [message] = toChatMessages([
      {
        id: "a",
        role: "assistant",
        content: "On it.",
        reasoningContent: "Think.",
        toolCalls: [{ id: "c1", name: "probe", arguments: "{}", result: null }],
        timestamp: 5,
      },
    ]);
    expect(message).toEqual({
      id: "a",
      role: "assistant",
      timestamp: 5,
      blocks: [
        { type: "reasoning", text: "Think." },
        { type: "text", text: "On it." },
        { type: "tool_call", id: "c1", name: "probe", argumentsText: "{}" },
      ],
    });
  });

  test("keeps an empty chain of thought, so it comes back as one", () => {
    const live: LiveMessage[] = [
      { id: "a", role: "assistant", content: "x", reasoningContent: "", timestamp: 1 },
    ];
    expect(toChatMessages(live)[0]!.blocks[0]).toEqual({ type: "reasoning", text: "" });
    expect(toLiveMessages(toChatMessages(live))).toEqual(live);
  });

  test.each([
    ['{"success":false,"error":"no"}', true],
    ['{"success":true}', false],
    ["not json", false],
    ["false", false],
    ["null", false],
  ])("a tool reply %p is an error: %p", (content, isError) => {
    const [message] = toChatMessages([
      { id: "t", role: "tool", toolCallId: "c1", content, timestamp: 1 },
    ]);
    expect(message!.blocks).toEqual([{ type: "tool_result", callId: "c1", isError, content }]);
  });

  test("a tool reply with no call id answers the empty id", () => {
    const [message] = toChatMessages([{ id: "t", role: "tool", content: "{}", timestamp: 1 }]);
    expect(message!.blocks[0]).toMatchObject({ type: "tool_result", callId: "" });
  });

  test("reads only text from a user or system message", () => {
    const [user, system] = toChatMessages([
      { id: "u", role: "user", content: "hi", reasoningContent: "ignored", timestamp: 1 },
      { id: "s", role: "system", content: "", timestamp: 2 },
    ]);
    expect(user!.blocks).toEqual([{ type: "text", text: "hi" }]);
    expect(system!.blocks).toEqual([]);
  });

  test("a message's own blocks win over its fields, and its meta is carried", () => {
    const blocks: Block[] = [{ type: "opaque", family: "anthropic", data: { kind: "server" } }];
    const meta = { origin: "harness", kind: "seeded" } as const;
    const [message] = toChatMessages([
      { id: "a", role: "assistant", content: "stale", timestamp: 1, blocks, meta },
    ]);
    expect(message!.blocks).toEqual(blocks);
    expect(message!.blocks).not.toBe(blocks);
    expect(message!.meta).toBe(meta);
  });
});

/* A saved session is restored without being checked, so any field can hold anything. A value of
   the wrong type is read as absent: never turned into text, and never allowed to stop the send. */
describe("a corrupt restored message", () => {
  const corrupt = (fields: Record<string, unknown>) =>
    ({ id: "x", timestamp: 1, ...fields }) as unknown as LiveMessage;

  test("sends no chain of thought for a reasoning field that is not text", () => {
    for (const reasoningContent of [null, false, 0, { text: "t" }]) {
      const messages = [corrupt({ role: "assistant", content: "hi", reasoningContent })];
      expect(toOpenAIMessages(toChatMessages(messages))).toEqual([
        { role: "assistant", content: "hi" },
      ]);
    }
  });

  test("survives a call list that is not a list, and skips entries that are not calls", () => {
    const notAList = [corrupt({ role: "assistant", content: "hi", toolCalls: {} })];
    expect(toOpenAIMessages(toChatMessages(notAList))).toEqual([
      { role: "assistant", content: "hi" },
    ]);
    expect(isEmptyAssistant(corrupt({ role: "assistant", content: "", toolCalls: {} }))).toBe(true);

    const mixed = [
      corrupt({
        role: "assistant",
        content: "",
        toolCalls: [null, "call", { id: "c1", name: 7, arguments: null }],
      }),
    ];
    expect(toOpenAIMessages(toChatMessages(mixed))).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "", arguments: "" } }],
      },
    ]);
  });

  test("reads text that is not a string as no text", () => {
    const messages = [
      corrupt({ role: "user", content: ["part"] }),
      corrupt({ role: "assistant", content: ["part"] }),
      corrupt({ role: "tool", toolCallId: 4, content: { success: false } }),
    ];
    expect(toOpenAIMessages(toChatMessages(messages))).toEqual([
      { role: "user", content: "" },
      { role: "tool", tool_call_id: "", content: "" },
    ]);
    expect(isEmptyAssistant(messages[1]!)).toBe(true);
  });
});

describe("toLiveMessages", () => {
  test("keeps the blocks beside the fields only when the fields cannot describe them", () => {
    const cases: [string, Block[]][] = [
      ["a signed chain of thought", [{ type: "reasoning", text: "t", signature: "sig" }]],
      ["a redacted one", [{ type: "reasoning", text: "", redacted: "xyz" }]],
      [
        "one bound to a provider",
        [{ type: "reasoning", text: "t", provenance: { family: "anthropic", model: "m" } }],
      ],
      [
        "two of them",
        [
          { type: "reasoning", text: "a" },
          { type: "reasoning", text: "b" },
        ],
      ],
      ["opaque provider data", [{ type: "opaque", family: "anthropic", data: [1, "two"] }]],
      [
        "text and calls interleaved",
        [
          { type: "text", text: "First " },
          { type: "tool_call", id: "c1", name: "probe", argumentsText: "{}" },
          { type: "text", text: "then." },
        ],
      ],
      [
        "a signed call",
        [{ type: "tool_call", id: "c1", name: "probe", argumentsText: "{}", signature: "s" }],
      ],
    ];
    for (const [, blocks] of cases) {
      const [live] = toLiveMessages([chat("a", "assistant", blocks)]);
      expect(live!.blocks).toEqual(blocks);
      // And the trip back is exact.
      expect(toChatMessages([live!])[0]!.blocks).toEqual(blocks);
    }
  });

  test("still writes the v1 fields a reader that predates blocks reads", () => {
    const [live] = toLiveMessages([
      chat("a", "assistant", [
        { type: "reasoning", text: "a", signature: "s" },
        { type: "text", text: "First " },
        { type: "tool_call", id: "c1", name: "probe", argumentsText: "{" },
        { type: "reasoning", text: "b" },
        { type: "text", text: "then." },
      ]),
    ]);
    expect(live).toMatchObject({
      content: "First then.",
      reasoningContent: "ab",
      toolCalls: [{ id: "c1", name: "probe", arguments: "{" }],
    });
    expect(live!.toolCalls![0]).not.toHaveProperty("result");
  });

  test("a tool message reads its first result, and keeps the blocks when it has two", () => {
    const one: Block[] = [{ type: "tool_result", callId: "c1", isError: false, content: "{}" }];
    const two: Block[] = [
      ...one,
      { type: "tool_result", callId: "c2", isError: true, content: '{"success":false}' },
    ];
    const [single, double, none] = toLiveMessages([
      chat("t1", "tool", one),
      chat("t2", "tool", two),
      chat("t3", "tool", []),
    ]);
    expect(single).toEqual({
      id: "t1",
      role: "tool",
      content: "{}",
      toolCallId: "c1",
      timestamp: 1,
    });
    expect(double).toMatchObject({ content: "{}", toolCallId: "c1", blocks: two });
    // A result whose recorded error flag disagrees with its content is not one the fields describe.
    const [flipped] = toLiveMessages([
      chat("t4", "tool", [{ type: "tool_result", callId: "c1", isError: true, content: "{}" }]),
    ]);
    expect(flipped!.blocks).toHaveLength(1);
    expect(none).toMatchObject({ content: "", blocks: [] });
    expect(none).not.toHaveProperty("toolCallId");
  });

  test("carries meta, and never writes undeclared fields", () => {
    const meta = { kind: "round_cap", origin: "harness" } as const;
    const [live] = toLiveMessages([
      chat("a", "assistant", [{ type: "text", text: "x" }], { meta }),
    ]);
    expect(live).toEqual({ id: "a", role: "assistant", content: "x", timestamp: 1, meta });
  });
});

describe("isEmptyAssistant", () => {
  test("reads a v1 message by its fields", () => {
    const base = { id: "a", role: "assistant" as const, timestamp: 1 };
    expect(isEmptyAssistant({ ...base, content: "" })).toBe(true);
    expect(isEmptyAssistant({ ...base, content: "", toolCalls: [] })).toBe(true);
    expect(isEmptyAssistant({ ...base, content: "", reasoningContent: "only thought" })).toBe(true);
    expect(isEmptyAssistant({ ...base, content: "hi" })).toBe(false);
    expect(
      isEmptyAssistant({
        ...base,
        content: "",
        toolCalls: [{ id: "c", name: "n", arguments: "" }],
      }),
    ).toBe(false);
  });

  test("reads blocks when a message has them, whatever its fields say", () => {
    expect(isEmptyAssistant(chat("a", "assistant", []))).toBe(true);
    expect(isEmptyAssistant(chat("a", "assistant", [{ type: "text", text: "" }]))).toBe(true);
    expect(isEmptyAssistant(chat("a", "assistant", [{ type: "reasoning", text: "t" }]))).toBe(true);
    expect(
      isEmptyAssistant(chat("a", "assistant", [{ type: "opaque", family: "anthropic", data: 1 }])),
    ).toBe(true);
    expect(isEmptyAssistant(chat("a", "assistant", [{ type: "text", text: "x" }]))).toBe(false);
    expect(
      isEmptyAssistant(
        chat("a", "assistant", [{ type: "tool_call", id: "c", name: "n", argumentsText: "" }]),
      ),
    ).toBe(false);
    const live: LiveMessage = {
      id: "a",
      role: "assistant",
      content: "stale",
      timestamp: 1,
      blocks: [],
    };
    expect(isEmptyAssistant(live)).toBe(true);
  });

  test("is never true of another role", () => {
    expect(isEmptyAssistant({ id: "u", role: "user", content: "", timestamp: 1 })).toBe(false);
    expect(isEmptyAssistant(chat("t", "tool", []))).toBe(false);
  });
});

describe("toWireMessages", () => {
  test("keeps role and blocks, drops ids, timestamps, meta and empty assistant turns", () => {
    const text: Block[] = [{ type: "text", text: "hi" }];
    const wire = toWireMessages([
      chat("u", "user", text, { meta: { origin: "user" } }),
      chat("a", "assistant", []),
      chat("b", "assistant", text),
    ]);
    expect(wire).toEqual([
      { role: "user", blocks: text },
      { role: "assistant", blocks: text },
    ]);
  });
});

describe("toOpenAIMessages", () => {
  test("lays an assistant entry out in the order the v1 request did", () => {
    const [entry] = toOpenAIMessages([
      chat("a", "assistant", [
        { type: "tool_call", id: "c1", name: "probe", argumentsText: "{}" },
        { type: "text", text: "Done." },
        { type: "reasoning", text: "Why." },
      ]),
    ]);
    expect(JSON.stringify(entry)).toBe(
      '{"role":"assistant","content":"Done.","reasoning_content":"Why.","tool_calls":' +
        '[{"id":"c1","type":"function","function":{"name":"probe","arguments":"{}"}}]}',
    );
  });

  test("replays reasoning only to the family that streamed it, and never a redacted payload", () => {
    const anthropic = { family: "anthropic", model: "claude" } as const;
    const openai = { family: "openai-compat", model: "deepseek" } as const;
    const project = (blocks: Block[], meta?: ChatMessage["meta"]) =>
      toOpenAIMessages([
        chat("a", "assistant", [...blocks, { type: "text", text: "x" }], meta ? { meta } : {}),
      ])[0];
    expect(project([{ type: "reasoning", text: "v1" }])).toHaveProperty("reasoning_content", "v1");
    expect(project([{ type: "reasoning", text: "t", provenance: anthropic }])).not.toHaveProperty(
      "reasoning_content",
    );
    expect(project([{ type: "reasoning", text: "t" }], { family: "anthropic" })).not.toHaveProperty(
      "reasoning_content",
    );
    // A block's own provenance outranks its message's family.
    expect(
      project([{ type: "reasoning", text: "t", provenance: openai }], { family: "anthropic" }),
    ).toHaveProperty("reasoning_content", "t");
    expect(project([{ type: "reasoning", text: "", redacted: "xyz" }])).not.toHaveProperty(
      "reasoning_content",
    );
    expect(
      project([
        { type: "reasoning", text: "a" },
        { type: "reasoning", text: "", redacted: "xyz" },
        { type: "reasoning", text: "b" },
      ]),
    ).toHaveProperty("reasoning_content", "ab");
  });

  test("sends no opaque data, one tool entry per result, and other roles as their text", () => {
    expect(
      toOpenAIMessages([
        chat("s", "system", [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ]),
        chat("a", "assistant", [
          { type: "opaque", family: "anthropic", data: null },
          { type: "text", text: "x" },
        ]),
        chat("t", "tool", [
          { type: "tool_result", callId: "c1", isError: false, content: "1" },
          { type: "text", text: "not a result" },
          { type: "tool_result", callId: "c2", isError: true, content: "2" },
        ]),
      ]),
    ).toEqual([
      { role: "system", content: "ab" },
      { role: "assistant", content: "x" },
      { role: "tool", tool_call_id: "c1", content: "1" },
      { role: "tool", tool_call_id: "c2", content: "2" },
    ]);
  });
});

describe("toOpenAITools and fromOpenAITools", () => {
  const listed: OpenAITool[] = [
    {
      type: "function",
      function: { name: "plain", description: "d", parameters: { type: "object" } },
    },
    {
      type: "function",
      function: {
        name: "strict",
        description: "s",
        parameters: { type: "object", properties: {} },
        strict: true,
      },
    },
  ];

  test("round-trip listForLLM's shape byte for byte", () => {
    const back = toOpenAITools(fromOpenAITools(listed));
    expect(JSON.stringify(back)).toBe(JSON.stringify(listed));
  });

  test("read a tool's parts, and send no title", () => {
    const specs = fromOpenAITools(listed);
    expect(specs[0]).toEqual({ name: "plain", description: "d", inputSchema: { type: "object" } });
    expect(specs[1]!.strict).toBe(true);
    const titled: ToolSpec = { ...specs[0]!, title: "Plain", strict: false };
    expect(toOpenAITools([titled])).toEqual([listed[0]!]);
  });

  test("keep each schema by reference, so a live getter still serializes live", () => {
    let choices = ["a"];
    const parameters = {
      type: "object",
      get properties() {
        return { pick: { enum: choices } };
      },
    };
    const [spec] = fromOpenAITools([
      { type: "function", function: { name: "live", description: "", parameters } },
    ]);
    expect(spec!.inputSchema).toBe(parameters);
    choices = ["a", "b"];
    expect(JSON.stringify(toOpenAITools([spec!]))).toContain('"enum":["a","b"]');
  });

  test.each([
    [
      "not a function tool",
      { type: "custom", function: { name: "x", description: "", parameters: {} } },
    ],
    ["no function", { type: "function" }],
    ["a null function", { type: "function", function: null }],
    ["no name", { type: "function", function: { description: "", parameters: {} } }],
    ["no description", { type: "function", function: { name: "x", parameters: {} } }],
    ["no parameters", { type: "function", function: { name: "x", description: "" } }],
    [
      "null parameters",
      { type: "function", function: { name: "x", description: "", parameters: null } },
    ],
  ])("refuse an entry with %s, naming its index", (_label, entry) => {
    expect(() => fromOpenAITools([listed[0]!, entry])).toThrow(
      new TypeError(
        "tools[1] is not an OpenAI function tool with a name, a description and parameters",
      ),
    );
  });
});
