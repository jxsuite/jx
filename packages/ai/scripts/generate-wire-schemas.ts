/**
 * Writes the published JSON Schemas of chat wire version 2 (specs/ai.md §2.7):
 * `schemas/wire-v2.request.schema.json`, the body a client POSTs to the chat route, and
 * `schemas/wire-v2.frame.schema.json`, one `data:` line of the stream it is answered with.
 *
 * They are build outputs, committed because a backend written in another language reads them off
 * disk, and held fresh by `bun run schema:verify`. The gateway does not validate with them (it runs
 * in a Worker, where a schema validator is too much to carry): `checkChatRequestV2` checks by hand,
 * and `tests/wire-schemas.test.ts` holds it to the request schema over one corpus.
 *
 * Run: `bun run --cwd packages/ai generate:wire-schemas`
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const BASE = "https://jxsuite.com/schemas/ai";

const family = { enum: ["openai-compat", "anthropic"] };
const text = { type: "string" };

const block = {
  oneOf: [
    {
      properties: { text, type: { const: "text" } },
      required: ["type", "text"],
      type: "object",
    },
    {
      properties: {
        provenance: {
          properties: { binding: text, family, model: { type: ["string", "null"] } },
          required: ["family", "model"],
          type: "object",
        },
        redacted: text,
        signature: text,
        text,
        type: { const: "reasoning" },
      },
      required: ["type", "text"],
      type: "object",
    },
    {
      properties: {
        argumentsText: text,
        id: text,
        name: text,
        signature: text,
        type: { const: "tool_call" },
      },
      required: ["type", "id", "name", "argumentsText"],
      type: "object",
    },
    {
      properties: {
        callId: text,
        content: text,
        isError: { type: "boolean" },
        type: { const: "tool_result" },
      },
      required: ["type", "callId", "isError", "content"],
      type: "object",
    },
    {
      properties: { data: true, family, type: { const: "opaque" } },
      required: ["type", "family", "data"],
      type: "object",
    },
  ],
};

const request = {
  $id: `${BASE}/wire-v2.request.schema.json`,
  $schema: DRAFT,
  description:
    "The body of a version 2 chat request: the conversation in no provider's words. Members the schema does not name are ignored by a gateway, so the object is open.",
  properties: {
    maxTokens: { type: "number" },
    messages: {
      items: {
        properties: {
          blocks: { items: block, type: "array" },
          role: { enum: ["user", "assistant", "tool", "system"] },
        },
        required: ["role", "blocks"],
        type: "object",
      },
      type: "array",
    },
    metadata: {
      description: "For the backend's own audit and rate limiting. Never forwarded to a provider.",
      properties: { round: { type: "number" }, sessionId: text, turnId: text },
      type: "object",
    },
    model: text,
    reasoning: {
      properties: { effort: { enum: ["low", "medium", "high"] } },
      type: "object",
    },
    system: {
      items: {
        properties: { cache: { const: true }, text },
        required: ["text"],
        type: "object",
      },
      type: "array",
    },
    temperature: { type: "number" },
    toolChoice: {
      oneOf: [
        { enum: ["auto", "none", "required"] },
        { properties: { name: text }, required: ["name"], type: "object" },
      ],
    },
    tools: {
      items: {
        properties: {
          description: text,
          inputSchema: { type: "object" },
          name: text,
          strict: { type: "boolean" },
          title: text,
        },
        required: ["name", "description", "inputSchema"],
        type: "object",
      },
      type: "array",
    },
    wire: { const: 2 },
  },
  required: ["wire", "system", "messages", "tools"],
  title: "Jx chat request, wire version 2",
  type: "object",
};

const blockIndex = { minimum: 0, type: "integer" };

/** A JSON Schema, as this generator writes one: a plain object of keywords. */
interface SchemaObject {
  [keyword: string]: string | number | boolean | SchemaObject | (string | SchemaObject)[];
}

/** One frame: its `type`, the members it requires, and the ones it may carry. */
const frameOf = (
  type: string,
  required: Record<string, SchemaObject>,
  optional: Record<string, SchemaObject> = {},
): SchemaObject => ({
  properties: { ...required, ...optional, type: { const: type } },
  required: ["type", ...Object.keys(required)],
  type: "object",
});

const frame = {
  $id: `${BASE}/wire-v2.frame.schema.json`,
  $schema: DRAFT,
  description:
    "One frame of a version 2 chat stream, sent as a Server-Sent Events data line. The first eight are the version 1 frames, which a version 1 stream carries too; a reader ignores a member or a type it does not know.",
  oneOf: [
    frameOf(
      "stream_start",
      { family, model: text, wire: { const: 2 } },
      {
        droppedThinking: blockIndex,
        requestId: text,
      },
    ),
    frameOf("delta", { content: text }, { block: blockIndex }),
    frameOf("reasoning", { content: text }, { block: blockIndex }),
    frameOf("reasoning_signature", { block: blockIndex, signature: text }),
    frameOf("reasoning_redacted", { block: blockIndex, data: text }),
    frameOf("tool_call_start", { id: text, name: text }, { block: blockIndex }),
    frameOf("tool_call_delta", { args: text, id: text }),
    frameOf("tool_call_end", { id: text }, { signature: text }),
    frameOf(
      "usage",
      { inputTokens: { type: "number" }, outputTokens: { type: "number" } },
      {
        cacheWriteInputTokens: { type: "number" },
        cachedInputTokens: { type: "number" },
        reasoningTokens: { type: "number" },
      },
    ),
    frameOf("done", { stopReason: text }, { truncated: { const: true } }),
    frameOf(
      "error",
      { message: text },
      {
        code: text,
        problem: {
          description: "An RFC 9457 problem document naming the kind of failure.",
          properties: { type: text },
          required: ["type"],
          type: "object",
        },
      },
    ),
  ],
  title: "Jx chat stream frame, wire version 2",
};

const OUT = join(import.meta.dir, "..", "schemas");
const files = [
  ["wire-v2.request.schema.json", request],
  ["wire-v2.frame.schema.json", frame],
] as const;
for (const [name, schema] of files) {
  writeFileSync(join(OUT, name), `${JSON.stringify(schema, null, 2)}\n`, "utf8");
}
// The committed bytes are the formatter's, so a pre-commit format never makes them drift.
const formatted = Bun.spawnSync(["bunx", "oxfmt", ...files.map(([name]) => join(OUT, name))]);
if (formatted.exitCode !== 0) {
  console.warn(`oxfmt exited ${String(formatted.exitCode)}; the schemas were written unformatted.`);
}
console.log(files.map(([name]) => `packages/ai/schemas/${name}`).join("\n"));
