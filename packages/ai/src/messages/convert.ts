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

/**
 * True when an unchecked value (a v1 field, a `tools` listing's member) is a string. A v1 field
 * that is anything else is absent (see {@link blocksFromFields}).
 */
export function isText(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * A v1 tool call as a restored session may hold it: never checked, so any member may be missing or
 * hold anything.
 */
interface StoredToolCall {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly arguments?: unknown;
}

/**
 * True when an unchecked value (a stored tool call, a parsed tool reply, a `tools` listing's
 * member) is an object whose members may be read; null and every primitive are not.
 */
export function isMemberBag(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whether a tool reply's content is a result that failed. Unparseable content is not. */
function isErrorContent(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return isMemberBag(parsed) && "success" in parsed && parsed.success === false;
  } catch {
    return false;
  }
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
    const content = isText(message.content) ? message.content : "";
    return [
      {
        type: "tool_result",
        callId: isText(message.toolCallId) ? message.toolCallId : "",
        isError: isErrorContent(content),
        content,
      },
    ];
  }
  const blocks: Block[] = [];
  if (message.role === "assistant" && isText(message.reasoningContent)) {
    blocks.push({ type: "reasoning", text: message.reasoningContent });
  }
  if (isText(message.content) && message.content) {
    blocks.push({ type: "text", text: message.content });
  }
  if (message.role === "assistant" && Array.isArray(message.toolCalls)) {
    // A restored session's calls are unchecked, so each is read as what it may really be.
    const stored: readonly unknown[] = message.toolCalls;
    for (const call of stored) {
      if (!isMemberBag(call)) {
        continue;
      }
      // Every member of StoredToolCall is optional and `unknown`, so any object is one.
      const { id, name, arguments: args }: StoredToolCall = call;
      blocks.push({
        type: "tool_call",
        id: isText(id) ? id : "",
        name: isText(name) ? name : "",
        argumentsText: isText(args) ? args : "",
      });
    }
  }
  return blocks;
}

/**
 * A value {@link sameJson} walks: JSON, in which an object member may also be `undefined` (an
 * optional member left unset), which counts as absent.
 */
type Walked = null | boolean | number | string | Walked[] | WalkedObject;

/** An object {@link sameJson} walks. */
interface WalkedObject {
  readonly [member: string]: Walked | undefined;
}

/** True when a walked value is an array or an object rather than a primitive or `null`. */
function isComposite(value: Walked | undefined): value is Walked[] | WalkedObject {
  return typeof value === "object" && value !== null;
}

/**
 * A block as the JSON {@link sameJson} walks: a shallow copy, which carries every member (an
 * undefined one included) and so compares exactly as the block itself would. A reasoning block's
 * `provenance` is copied too, since it is the one member that is itself an object.
 *
 * @param {Block} block
 * @returns {WalkedObject}
 */
function walkedBlock(block: Block): WalkedObject {
  if (block.type !== "reasoning") {
    return { ...block };
  }
  const { provenance, ...rest } = block;
  return provenance === undefined ? rest : { ...rest, provenance: { ...provenance } };
}

/** Whether two JSON values are equal, member order aside. */
function sameJson(a: Walked | undefined, b: Walked | undefined): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (!isComposite(a) || !isComposite(b)) {
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
  return left.length === right.length && left.every(([key, value]) => sameJson(value, b[key]));
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
  // SAFETY: a ChatMessage always carries `blocks`, so a message without them is a LiveMessage.
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
  return live.map((message): ChatMessage => {
    const { id, role, timestamp, meta } = message;
    const blocks = message.blocks ? [...message.blocks] : blocksFromFields(message);
    const chat: ChatMessage = { id, role, blocks, timestamp };
    return meta ? { ...chat, meta } : chat;
  });
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
    const rebuilt = blocksFromFields(live).map((block) => walkedBlock(block));
    if (
      !sameJson(
        rebuilt,
        message.blocks.map((block) => walkedBlock(block)),
      )
    ) {
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
  return messages.flatMap((message): WireMessage[] =>
    isEmptyAssistant(message) ? [] : [{ role: message.role, blocks: message.blocks }],
  );
}
