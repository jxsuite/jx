/**
 * Convert.ts — between the v1 transcript and the neutral conversation model.
 *
 * Chat-state and every saved session hold {@link LiveMessage}s, the v1 shape. A {@link ChatMessage}
 * describes the same message as blocks. The conversion keeps every field a message's role uses
 * except a tool call's `result`, which is the chip's copy of an outcome the `tool` reply already
 * carries; a host that renders chips rebuilds it from the reply.
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type {
  Block,
  ChatMessage,
  LiveMessage,
  LiveToolCall,
  ToolCallBlock,
  ToolResultBlock,
  WireMessage,
} from "./types.ts";

/** Whether a tool reply's content is a result that failed. Unparseable content is not. */
function isErrorContent(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { success?: unknown }).success === false
    );
  } catch {
    return false;
  }
}

/** A v1 value read as text: a string is itself, and anything else is absent. */
function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The blocks a message's v1 fields describe, in the order a provider streams them.
 *
 * A saved session is restored without being checked, so a field can hold anything. A value of the
 * wrong type is read as absent rather than turned into text or allowed to throw: a corrupt message
 * is sent without its garbage, and never stops the send.
 */
function blocksFromFields(message: LiveMessage): Block[] {
  if (message.role === "tool") {
    const content = asText(message.content);
    return [
      {
        type: "tool_result",
        callId: asText(message.toolCallId),
        isError: isErrorContent(content),
        content,
      },
    ];
  }
  const blocks: Block[] = [];
  if (message.role === "assistant" && typeof message.reasoningContent === "string") {
    blocks.push({ type: "reasoning", text: message.reasoningContent });
  }
  if (asText(message.content)) {
    blocks.push({ type: "text", text: message.content });
  }
  if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
    for (const call of message.toolCalls as unknown[]) {
      if (typeof call !== "object" || call === null) {
        continue;
      }
      const { id, name, arguments: args } = call as Record<string, unknown>;
      blocks.push({
        type: "tool_call",
        id: asText(id),
        name: asText(name),
        argumentsText: asText(args),
      });
    }
  }
  return blocks;
}

/** Whether two JSON values are equal, member order aside. */
function sameJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  const left = Object.entries(a).filter(([, value]) => value !== undefined);
  const right = Object.entries(b).filter(([, value]) => value !== undefined);
  return (
    left.length === right.length &&
    left.every(([key, value]) => sameJson(value, (b as Record<string, unknown>)[key]))
  );
}

/** The concatenated text of a message's blocks of one kind. */
function joined(blocks: readonly Block[], type: "text" | "reasoning"): string {
  let text = "";
  for (const block of blocks) {
    if (block.type === type) {
      text += block.text;
    }
  }
  return text;
}

/**
 * Whether a message is an assistant turn carrying neither text nor a tool call.
 *
 * Such a turn is never sent (specs/ai.md §2.2): the one that always exists is the placeholder a
 * turn opens with, which is the answer the request carrying it would generate. A message's blocks
 * decide when it has them; a v1 message is read by its fields, as {@link toChatMessages} reads them.
 *
 * @param {ChatMessage | LiveMessage} message
 * @returns {boolean}
 */
export function isEmptyAssistant(message: ChatMessage | LiveMessage): boolean {
  if (message.role !== "assistant") {
    return false;
  }
  const blocks = message.blocks ?? blocksFromFields(message as LiveMessage);
  return !blocks.some(
    (block) => block.type === "tool_call" || (block.type === "text" && block.text !== ""),
  );
}

/**
 * The neutral form of a v1 transcript. A message that carries `blocks` keeps them; any other is
 * read from its fields. Fields a v1 message does not declare are not carried.
 *
 * @param {readonly LiveMessage[]} live
 * @returns {ChatMessage[]}
 */
export function toChatMessages(live: readonly LiveMessage[]): ChatMessage[] {
  return live.map((message) => ({
    id: message.id,
    role: message.role,
    blocks: message.blocks ? [...message.blocks] : blocksFromFields(message),
    timestamp: message.timestamp,
    ...(message.meta ? { meta: message.meta } : {}),
  }));
}

/**
 * The v1 form of a neutral transcript: every v1 field rebuilt from the blocks, and the blocks kept
 * beside them only when those fields cannot describe them. A tool call carries no `result`.
 *
 * @param {readonly ChatMessage[]} messages
 * @returns {LiveMessage[]}
 */
export function toLiveMessages(messages: readonly ChatMessage[]): LiveMessage[] {
  return messages.map((message) => {
    const live: LiveMessage = {
      id: message.id,
      role: message.role,
      content: joined(message.blocks, "text"),
      timestamp: message.timestamp,
    };
    if (message.role === "tool") {
      const reply = message.blocks.find(
        (block): block is ToolResultBlock => block.type === "tool_result",
      );
      if (reply) {
        live.content = reply.content;
        live.toolCallId = reply.callId;
      }
    } else if (message.role === "assistant") {
      if (message.blocks.some((block) => block.type === "reasoning")) {
        live.reasoningContent = joined(message.blocks, "reasoning");
      }
      const calls = message.blocks.filter(
        (block): block is ToolCallBlock => block.type === "tool_call",
      );
      if (calls.length > 0) {
        live.toolCalls = calls.map((call): LiveToolCall => ({
          id: call.id,
          name: call.name,
          arguments: call.argumentsText,
        }));
      }
    }
    if (!sameJson(blocksFromFields(live), message.blocks)) {
      live.blocks = [...message.blocks];
    }
    if (message.meta) {
      live.meta = message.meta;
    }
    return live;
  });
}

/**
 * What a request carries: each message's role and blocks, without the empty assistant turns no
 * provider is sent (§2.2), and without ids, timestamps or meta.
 *
 * @param {readonly ChatMessage[]} messages
 * @returns {WireMessage[]}
 */
export function toWireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  return messages
    .filter((message) => !isEmptyAssistant(message))
    .map((message) => ({ role: message.role, blocks: message.blocks }));
}
