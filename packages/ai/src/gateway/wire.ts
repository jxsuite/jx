/**
 * Wire version 2 at the gateway: checking a version 2 body, and reading it as the version 1 body
 * the upstream request is built from (specs/ai.md §2.7).
 *
 * @module @jxsuite/ai/gateway
 */

import type { JsonObject, JsonValue } from "../core-types.ts";
import { checkBlock } from "../messages/blocks.ts";
import { toOpenAIMessages, toOpenAITools } from "../messages/openai.ts";
import type { ChatRequestV2 } from "../streaming-client.ts";

/** The roles a message may carry. */
const ROLES: ReadonlySet<string> = new Set(["user", "assistant", "tool", "system"]);

/** The tool-choice words a request may carry. */
const TOOL_CHOICES: ReadonlySet<string> = new Set(["auto", "none", "required"]);

/** The reasoning efforts a request may ask for. */
const EFFORTS: ReadonlySet<string> = new Set(["low", "medium", "high"]);

/**
 * True when a parsed value is a JSON object.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a parsed value is a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/**
 * True when a parsed value is absent or a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isOptionalString(value: JsonValue | undefined): boolean {
  return value === undefined || isString(value);
}

/**
 * True when a parsed value is a number.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

/**
 * True when a parsed value is absent or a finite number.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isOptionalNumber(value: JsonValue | undefined): boolean {
  return value === undefined || (isNumber(value) && Number.isFinite(value));
}

/**
 * The first entry of a list that fails `check`, as a path under `base`, or null when every entry
 * passes (and the value is a list at all).
 *
 * @param {JsonValue | undefined} list - The member that must be an array
 * @param {string} base - The member's own pointer
 * @param {(entry: JsonValue) => string | null} check - The path under an entry that fails, or null
 * @returns {string | null}
 */
function checkEach(
  list: JsonValue | undefined,
  base: string,
  check: (entry: JsonValue) => string | null,
): string | null {
  if (!Array.isArray(list)) {
    return base;
  }
  for (const [index, entry] of list.entries()) {
    const failing = check(entry);
    if (failing !== null) {
      return `${base}/${String(index)}${failing}`;
    }
  }
  return null;
}

/**
 * The path under a system block that fails, or null.
 *
 * @param {JsonValue} block - One entry of `system`
 * @returns {string | null}
 */
function checkSystemBlock(block: JsonValue): string | null {
  if (!isObject(block)) {
    return "";
  }
  if (!isString(block.text)) {
    return "/text";
  }
  return block.cache === undefined || block.cache === true ? null : "/cache";
}

/**
 * The path under a message that fails, or null.
 *
 * @param {JsonValue} message - One entry of `messages`
 * @returns {string | null}
 */
function checkMessage(message: JsonValue): string | null {
  if (!isObject(message)) {
    return "";
  }
  if (!isString(message.role) || !ROLES.has(message.role)) {
    return "/role";
  }
  return checkEach(message.blocks, "/blocks", checkBlock);
}

/**
 * The path under a tool that fails, or null.
 *
 * @param {JsonValue} tool - One entry of `tools`
 * @returns {string | null}
 */
function checkTool(tool: JsonValue): string | null {
  if (!isObject(tool)) {
    return "";
  }
  if (!isString(tool.name)) {
    return "/name";
  }
  if (!isString(tool.description)) {
    return "/description";
  }
  if (!isObject(tool.inputSchema)) {
    return "/inputSchema";
  }
  if (!isOptionalString(tool.title)) {
    return "/title";
  }
  return tool.strict === undefined || tool.strict === true || tool.strict === false
    ? null
    : "/strict";
}

/**
 * Check a parsed chat body against wire version 2, by hand: the gateway runs in a Worker, where a
 * schema validator is too much to carry, and `tests/wire-schemas.test.ts` holds this function to
 * the published schema (`schemas/wire-v2.request.schema.json`) over one corpus.
 *
 * @param {JsonValue} body - The parsed request body
 * @returns {string | null} The JSON Pointer of the first member that fails, `""` for the body
 *   itself, or null when the body is a version 2 request
 */
export function checkChatRequestV2(body: JsonValue): string | null {
  if (!isObject(body)) {
    return "";
  }
  if (body.wire !== 2) {
    return "/wire";
  }
  if (!isOptionalString(body.model)) {
    return "/model";
  }
  const listed =
    checkEach(body.system, "/system", checkSystemBlock) ??
    checkEach(body.messages, "/messages", checkMessage) ??
    checkEach(body.tools, "/tools", checkTool);
  if (listed !== null) {
    return listed;
  }
  if (!isOptionalNumber(body.maxTokens)) {
    return "/maxTokens";
  }
  if (!isOptionalNumber(body.temperature)) {
    return "/temperature";
  }
  const { toolChoice, reasoning, metadata } = body;
  if (toolChoice !== undefined) {
    const named = isObject(toolChoice) && isString(toolChoice.name);
    if (!named && !(isString(toolChoice) && TOOL_CHOICES.has(toolChoice))) {
      return "/toolChoice";
    }
  }
  if (reasoning !== undefined) {
    if (!isObject(reasoning)) {
      return "/reasoning";
    }
    const { effort } = reasoning;
    if (effort !== undefined && !(isString(effort) && EFFORTS.has(effort))) {
      return "/reasoning/effort";
    }
  }
  if (metadata !== undefined) {
    if (!isObject(metadata)) {
      return "/metadata";
    }
    if (!isOptionalString(metadata.sessionId)) {
      return "/metadata/sessionId";
    }
    if (!isOptionalString(metadata.turnId)) {
      return "/metadata/turnId";
    }
    if (!isOptionalNumber(metadata.round)) {
      return "/metadata/round";
    }
  }
  return null;
}

/** A version 2 request, read as the version 1 members the upstream request is built from. */
export interface ProjectedRequest {
  readonly messages: object[];
  readonly tools: object[];
  readonly systemPrompt: string;
  readonly model: string | undefined;
  /** The members version 1 has no word for, each on the chat-completions wire. */
  readonly extras: {
    temperature?: number;
    max_tokens?: number;
    tool_choice?: string | object;
    reasoning_effort?: string;
  };
}

/**
 * Read a checked version 2 body as the version 1 one. The conversation and the tools go through the
 * same projection a version 1 client applies before it sends (`toOpenAIMessages`, `toOpenAITools`),
 * so one transcript reaches the upstream as the same bytes on either wire. The request's `metadata`
 * is for the host and is not forwarded.
 *
 * @param {ChatRequestV2} body - A body `checkChatRequestV2` accepted
 * @returns {ProjectedRequest}
 */
export function projectV2Request(body: ChatRequestV2): ProjectedRequest {
  const extras: ProjectedRequest["extras"] = {};
  if (body.temperature !== undefined) {
    extras.temperature = body.temperature;
  }
  if (body.maxTokens !== undefined) {
    extras.max_tokens = body.maxTokens;
  }
  if (body.toolChoice !== undefined) {
    extras.tool_choice = TOOL_CHOICES.has(String(body.toolChoice))
      ? body.toolChoice
      : // SAFETY: the check admits a word from TOOL_CHOICES or an object naming a tool.
        { type: "function", function: { name: (body.toolChoice as { name: string }).name } };
  }
  if (body.reasoning?.effort !== undefined) {
    extras.reasoning_effort = body.reasoning.effort;
  }
  return {
    extras,
    messages: toOpenAIMessages(body.messages),
    model: body.model,
    systemPrompt: body.system.map((block) => block.text).join(""),
    tools: toOpenAITools(body.tools),
  };
}
