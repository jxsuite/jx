/**
 * Openai.ts — the neutral conversation, and the tools, on the OpenAI chat-completions wire.
 *
 * The OpenAI-compatible projection is the one every v1 request was built with
 * (`createChatState().toMessagesArray()`), stated once so a harness, a gateway and chat-state
 * cannot each keep a copy that drifts (specs/ai.md §2.2, §2.3).
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import { isEmptyAssistant } from "./convert.ts";
import type {
  ChatMessage,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolCall,
  ReasoningBlock,
  ToolSpec,
} from "./types.ts";

/**
 * Whether a reasoning block is replayed to an OpenAI-compatible provider: it came from one (its own
 * provenance, else its message's family, else the v1 default), and it is not redacted. A block
 * another family signed is that family's to read, and a redacted payload is nobody's text.
 */
function replays(block: ReasoningBlock, message: ChatMessage): boolean {
  const family = block.provenance?.family ?? message.meta?.family ?? "openai-compat";
  return family === "openai-compat" && block.redacted === undefined;
}

/**
 * A conversation as an OpenAI chat-completions `messages` array. The system prompt travels
 * separately.
 *
 * Two things it does NOT do verbatim, both because a transcript is not the wire:
 *
 * 1. **An assistant turn carrying neither text nor tool calls is dropped** ({@link isEmptyAssistant}).
 *    The one that always exists is the placeholder a turn opens with: the message being generated
 *    by the very request this builds. It reached providers as a trailing
 *    `{"role":"assistant","content":""}`, which most read as an empty prefill and ignore;
 *    DeepSeek's thinking mode instead answers 400 `The reasoning_content in the thinking mode must
 *    be passed back to the API`, because a thinking-mode assistant turn owes it one.
 * 2. **`reasoning_content` is replayed when the turn has one.** DeepSeek requires the reasoning of all
 *    previous turns back on any request carrying `tools`, which is every request the agent loop
 *    makes, and ignores it on requests that carry none, so echoing what the provider itself
 *    streamed is safe for providers that never send it (they get no field at all).
 *
 * Assistant `content` is `null` when the turn made calls and wrote nothing; a `tool` message is one
 * entry per result; any other role is `{ role, content }`, its text byte for byte.
 *
 * @param {readonly ChatMessage[]} messages @returns {OpenAIMessage[]}
 */
export function toOpenAIMessages(messages: readonly ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      if (isEmptyAssistant(message)) {
        continue;
      }
      let text = "";
      let reasoning = "";
      const calls: OpenAIToolCall[] = [];
      for (const block of message.blocks) {
        if (block.type === "text") {
          text += block.text;
        } else if (block.type === "reasoning" && replays(block, message)) {
          reasoning += block.text;
        } else if (block.type === "tool_call") {
          calls.push({
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: block.argumentsText },
          });
        }
      }
      const entry: Extract<OpenAIMessage, { role: "assistant" }> = {
        role: "assistant",
        content: calls.length > 0 ? text || null : text,
      };
      if (reasoning) {
        entry.reasoning_content = reasoning;
      }
      if (calls.length > 0) {
        entry.tool_calls = calls;
      }
      out.push(entry);
    } else if (message.role === "tool") {
      for (const block of message.blocks) {
        if (block.type === "tool_result") {
          out.push({ role: "tool", tool_call_id: block.callId, content: block.content });
        }
      }
    } else {
      let text = "";
      for (const block of message.blocks) {
        if (block.type === "text") {
          text += block.text;
        }
      }
      out.push({ role: message.role, content: text });
    }
  }
  return out;
}

/**
 * Tools as an OpenAI chat-completions `tools` array, in `ToolRegistry.listForLLM()`'s shape: the
 * same members in the same order, so the serialized request is byte for byte what it was. A tool's
 * `title` has no OpenAI field and is not sent.
 *
 * @param {readonly ToolSpec[]} tools
 * @returns {OpenAITool[]}
 */
export function toOpenAITools(tools: readonly ToolSpec[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      ...(tool.strict === true ? { strict: true as const } : {}),
    },
  }));
}

/**
 * The tools an OpenAI chat-completions `tools` array describes. Each schema is kept by reference,
 * so a schema built with live getters still serializes live.
 *
 * @param {readonly object[]} tools - `ToolRegistry.listForLLM()`, or any array of that shape
 * @returns {ToolSpec[]}
 * @throws {TypeError} When an entry is not a function tool with a name, a description and a schema
 */
export function fromOpenAITools(tools: readonly object[]): ToolSpec[] {
  return tools.map((tool, index) => {
    const fn = (tool as { type?: unknown; function?: unknown }).function as
      | { name?: unknown; description?: unknown; parameters?: unknown; strict?: unknown }
      | undefined;
    if (
      (tool as { type?: unknown }).type !== "function" ||
      typeof fn !== "object" ||
      fn === null ||
      typeof fn.name !== "string" ||
      typeof fn.description !== "string" ||
      typeof fn.parameters !== "object" ||
      fn.parameters === null
    ) {
      throw new TypeError(
        `tools[${index}] is not an OpenAI function tool with a name, a description and parameters`,
      );
    }
    return {
      name: fn.name,
      description: fn.description,
      inputSchema: fn.parameters as Readonly<Record<string, unknown>>,
      ...(fn.strict === true ? { strict: true } : {}),
    };
  });
}
