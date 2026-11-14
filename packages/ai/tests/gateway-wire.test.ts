/**
 * Tests for wire version 2 at the gateway (specs/ai.md §2.7): the hand validator, held to the
 * published request schema over one corpus, and the projection onto the version 1 body.
 *
 * The gateway checks by hand because it runs in a Worker, where a schema validator is too much to
 * carry. The schema is what a backend in another language reads, so the two must agree, and this
 * suite is where they are compared: every body below is checked both ways.
 *
 * @module @jxsuite/ai/tests
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { JsonObject, JsonValue } from "../src/core-types.ts";
import { checkChatRequestV2, projectV2Request } from "../src/gateway/wire.ts";

const SCHEMAS = join(import.meta.dir, "..", "schemas");
// SAFETY: a committed schema file is a JSON object; ajv validates its own input.
const readSchema = (name: string) =>
  JSON.parse(readFileSync(join(SCHEMAS, name), "utf8")) as object;
const ajv = new Ajv2020({ strict: true });
const validRequest = ajv.compile(readSchema("wire-v2.request.schema.json"));
const validFrame = ajv.compile(readSchema("wire-v2.frame.schema.json"));

const BASE: JsonObject = { messages: [], system: [], tools: [], wire: 2 };
const withMember = (key: string, value: JsonValue): JsonObject => ({ ...BASE, [key]: value });
const message = (blocks: JsonValue[], role = "assistant"): JsonObject =>
  withMember("messages", [{ blocks, role }]);

const VALID: [string, JsonValue][] = [
  ["the smallest request", BASE],
  [
    "a model and every optional member",
    {
      ...BASE,
      maxTokens: 1024,
      metadata: { round: 1, sessionId: "s", turnId: "t" },
      model: "m",
      reasoning: { effort: "high" },
      temperature: 0.2,
      toolChoice: "none",
    },
  ],
  ["a tool chosen by name", withMember("toolChoice", { name: "set_text" })],
  ["an empty reasoning object", withMember("reasoning", {})],
  ["an empty metadata object", withMember("metadata", {})],
  [
    "system blocks, one marked for the cache",
    withMember("system", [{ text: "a" }, { cache: true, text: "b" }]),
  ],
  [
    "a tool with a title and strict mode",
    withMember("tools", [
      { description: "d", inputSchema: { type: "object" }, name: "n", strict: true, title: "N" },
    ]),
  ],
  [
    "every kind of block",
    message([
      { text: "hello", type: "text" },
      { text: "thinking", type: "reasoning" },
      {
        provenance: { binding: "f1:00", family: "anthropic", model: "claude" },
        redacted: "opaque",
        signature: "sig",
        text: "",
        type: "reasoning",
      },
      { provenance: { family: "openai-compat", model: null }, text: "t", type: "reasoning" },
      { argumentsText: "{}", id: "c1", name: "n", signature: "s", type: "tool_call" },
      { data: { any: ["thing"] }, family: "anthropic", type: "opaque" },
      { data: null, family: "openai-compat", type: "opaque" },
    ]),
  ],
  [
    "a tool result",
    message([{ callId: "c1", content: "{}", isError: false, type: "tool_result" }], "tool"),
  ],
  ["a member the wire does not name", withMember("futureMember", { anything: true })],
];

const INVALID: [string, JsonValue, string][] = [
  ["a body that is not an object", [], ""],
  ["null", null, ""],
  ["a string", "wire 2", ""],
  ["no wire", { messages: [], system: [], tools: [] }, "/wire"],
  ["wire 1", withMember("wire", 1), "/wire"],
  ["a model that is not a string", withMember("model", 4), "/model"],
  ["no system", { messages: [], tools: [], wire: 2 }, "/system"],
  ["a system that is not a list", withMember("system", "be brief"), "/system"],
  ["a system block that is not an object", withMember("system", ["be brief"]), "/system/0"],
  ["a system block with no text", withMember("system", [{ text: "a" }, {}]), "/system/1/text"],
  [
    "a cache mark that is not true",
    withMember("system", [{ cache: false, text: "a" }]),
    "/system/0/cache",
  ],
  ["no messages", { system: [], tools: [], wire: 2 }, "/messages"],
  ["a message that is not an object", withMember("messages", [7]), "/messages/0"],
  ["a role the wire does not have", message([], "narrator"), "/messages/0/role"],
  [
    "a role that is not a string",
    withMember("messages", [{ blocks: [], role: 1 }]),
    "/messages/0/role",
  ],
  [
    "blocks that are not a list",
    withMember("messages", [{ blocks: "text", role: "user" }]),
    "/messages/0/blocks",
  ],
  ["a block that is not an object", message(["text"]), "/messages/0/blocks/0"],
  ["a block of no known type", message([{ type: "image" }]), "/messages/0/blocks/0/type"],
  ["a text block with no text", message([{ type: "text" }]), "/messages/0/blocks/0/text"],
  ["a reasoning block with no text", message([{ type: "reasoning" }]), "/messages/0/blocks/0/text"],
  [
    "a signature that is not a string",
    message([{ signature: 1, text: "", type: "reasoning" }]),
    "/messages/0/blocks/0/signature",
  ],
  [
    "a redacted payload that is not a string",
    message([{ redacted: {}, text: "", type: "reasoning" }]),
    "/messages/0/blocks/0/redacted",
  ],
  [
    "a provenance that is not an object",
    message([{ provenance: "anthropic", text: "", type: "reasoning" }]),
    "/messages/0/blocks/0/provenance",
  ],
  [
    "a provenance of no known family",
    message([{ provenance: { family: "gemini", model: null }, text: "", type: "reasoning" }]),
    "/messages/0/blocks/0/provenance/family",
  ],
  [
    "a provenance with no model",
    message([{ provenance: { family: "anthropic" }, text: "", type: "reasoning" }]),
    "/messages/0/blocks/0/provenance/model",
  ],
  [
    "a binding that is not a string",
    message([
      { provenance: { binding: 1, family: "anthropic", model: null }, text: "", type: "reasoning" },
    ]),
    "/messages/0/blocks/0/provenance/binding",
  ],
  [
    "a tool call with no id",
    message([{ argumentsText: "{}", name: "n", type: "tool_call" }]),
    "/messages/0/blocks/0/id",
  ],
  [
    "a tool call with no name",
    message([{ argumentsText: "{}", id: "c", type: "tool_call" }]),
    "/messages/0/blocks/0/name",
  ],
  [
    "a tool call with parsed arguments",
    message([{ argumentsText: {}, id: "c", name: "n", type: "tool_call" }]),
    "/messages/0/blocks/0/argumentsText",
  ],
  [
    "a tool call whose signature is not a string",
    message([{ argumentsText: "{}", id: "c", name: "n", signature: 0, type: "tool_call" }]),
    "/messages/0/blocks/0/signature",
  ],
  [
    "a tool result with no call id",
    message([{ content: "", isError: false, type: "tool_result" }]),
    "/messages/0/blocks/0/callId",
  ],
  [
    "a tool result that does not say whether it failed",
    message([{ callId: "c", content: "", type: "tool_result" }]),
    "/messages/0/blocks/0/isError",
  ],
  [
    "a tool result with no content",
    message([{ callId: "c", isError: true, type: "tool_result" }]),
    "/messages/0/blocks/0/content",
  ],
  [
    "an opaque block of no known family",
    message([{ data: 1, family: "x", type: "opaque" }]),
    "/messages/0/blocks/0/family",
  ],
  [
    "an opaque block with no data",
    message([{ family: "anthropic", type: "opaque" }]),
    "/messages/0/blocks/0/data",
  ],
  ["no tools", { messages: [], system: [], wire: 2 }, "/tools"],
  ["a tool that is not an object", withMember("tools", ["set_text"]), "/tools/0"],
  [
    "a tool with no name",
    withMember("tools", [{ description: "d", inputSchema: {} }]),
    "/tools/0/name",
  ],
  [
    "a tool with no description",
    withMember("tools", [{ inputSchema: {}, name: "n" }]),
    "/tools/0/description",
  ],
  [
    "a tool whose schema is not an object",
    withMember("tools", [{ description: "d", inputSchema: [], name: "n" }]),
    "/tools/0/inputSchema",
  ],
  [
    "a tool whose title is not a string",
    withMember("tools", [{ description: "d", inputSchema: {}, name: "n", title: 1 }]),
    "/tools/0/title",
  ],
  [
    "a tool whose strict is not a boolean",
    withMember("tools", [{ description: "d", inputSchema: {}, name: "n", strict: "yes" }]),
    "/tools/0/strict",
  ],
  ["a token ceiling that is not a number", withMember("maxTokens", "many"), "/maxTokens"],
  ["a temperature that is not a number", withMember("temperature", "warm"), "/temperature"],
  ["a tool choice of no known word", withMember("toolChoice", "always"), "/toolChoice"],
  ["a tool choice naming nothing", withMember("toolChoice", {}), "/toolChoice"],
  ["a reasoning that is not an object", withMember("reasoning", "high"), "/reasoning"],
  ["an effort of no known word", withMember("reasoning", { effort: "max" }), "/reasoning/effort"],
  ["a metadata that is not an object", withMember("metadata", []), "/metadata"],
  [
    "a session id that is not a string",
    withMember("metadata", { sessionId: 1 }),
    "/metadata/sessionId",
  ],
  ["a turn id that is not a string", withMember("metadata", { turnId: 1 }), "/metadata/turnId"],
  ["a round that is not a number", withMember("metadata", { round: "2" }), "/metadata/round"],
];

describe("checkChatRequestV2 and the published request schema", () => {
  it.each(VALID)("both accept %s", (_label, body) => {
    expect(checkChatRequestV2(body)).toBeNull();
    expect(validRequest(body)).toBe(true);
  });

  it.each(INVALID)("both refuse %s", (_label, body, pointer) => {
    expect(checkChatRequestV2(body)).toBe(pointer);
    expect(validRequest(body)).toBe(false);
  });
});

describe("the published frame schema", () => {
  it.each<[string, JsonValue]>([
    [
      "stream_start",
      { family: "anthropic", model: "m", requestId: "r", type: "stream_start", wire: 2 },
    ],
    ["delta", { block: 0, content: "a", type: "delta" }],
    ["reasoning", { content: "a", type: "reasoning" }],
    ["reasoning_signature", { block: 0, signature: "s", type: "reasoning_signature" }],
    ["reasoning_redacted", { block: 1, data: "d", type: "reasoning_redacted" }],
    ["tool_call_start", { id: "c", name: "n", type: "tool_call_start" }],
    ["tool_call_delta", { args: "{", id: "c", type: "tool_call_delta" }],
    ["tool_call_end", { id: "c", signature: "s", type: "tool_call_end" }],
    ["usage", { cachedInputTokens: 1, inputTokens: 2, outputTokens: 3, type: "usage" }],
    ["done", { stopReason: "stop", truncated: true, type: "done" }],
    ["error", { code: "429", message: "slow down", problem: { type: "urn:x" }, type: "error" }],
  ])("accepts a %s frame", (_label, frame) => {
    expect(validFrame(frame)).toBe(true);
  });

  it.each<[string, JsonValue]>([
    ["a frame of no known type", { type: "ping" }],
    [
      "a stream_start on another wire",
      { family: "anthropic", model: "m", type: "stream_start", wire: 1 },
    ],
    ["a delta with no content", { type: "delta" }],
    ["a done that is truncated: false", { stopReason: "stop", truncated: false, type: "done" }],
    ["an error whose problem names no type", { message: "m", problem: {}, type: "error" }],
  ])("refuses %s", (_label, frame) => {
    expect(validFrame(frame)).toBe(false);
  });
});

describe("projectV2Request", () => {
  it("reads the conversation, the tools and the system prompt as version 1 states them", () => {
    const projected = projectV2Request({
      messages: [
        { blocks: [{ text: "hi", type: "text" }], role: "user" },
        {
          blocks: [
            { text: "thinking", type: "reasoning" },
            { argumentsText: "{}", id: "c1", name: "n", type: "tool_call" },
          ],
          role: "assistant",
        },
        {
          blocks: [{ callId: "c1", content: "ok", isError: false, type: "tool_result" }],
          role: "tool",
        },
      ],
      system: [{ text: "a" }, { cache: true, text: "b" }],
      tools: [{ description: "d", inputSchema: { type: "object" }, name: "n" }],
      wire: 2,
    });
    expect(projected).toEqual({
      extras: {},
      messages: [
        { content: "hi", role: "user" },
        {
          content: null,
          reasoning_content: "thinking",
          role: "assistant",
          tool_calls: [{ function: { arguments: "{}", name: "n" }, id: "c1", type: "function" }],
        },
        { content: "ok", role: "tool", tool_call_id: "c1" },
      ],
      model: undefined,
      systemPrompt: "ab",
      tools: [
        {
          function: { description: "d", name: "n", parameters: { type: "object" } },
          type: "function",
        },
      ],
    });
  });

  it("carries the members version 1 has no word for, on the chat-completions wire", () => {
    const base = { messages: [], system: [], tools: [], wire: 2 } as const;
    expect(
      projectV2Request({
        ...base,
        maxTokens: 9,
        messages: [],
        model: "m",
        reasoning: { effort: "medium" },
        system: [],
        temperature: 1,
        toolChoice: "auto",
        tools: [],
      }),
    ).toMatchObject({
      extras: { max_tokens: 9, reasoning_effort: "medium", temperature: 1, tool_choice: "auto" },
      model: "m",
    });
    expect(
      projectV2Request({
        ...base,
        messages: [],
        reasoning: {},
        system: [],
        toolChoice: { name: "n" },
        tools: [],
      }).extras,
    ).toEqual({ tool_choice: { function: { name: "n" }, type: "function" } });
  });
});
