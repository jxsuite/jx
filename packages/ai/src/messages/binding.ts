/**
 * Binding.ts — which request a signed reasoning block belongs to (specs/ai.md §2.2, §2.6).
 *
 * A provider that signs its thinking binds each block to the request that produced it: the system
 * prompt, the tools, and every message before it. A block replayed under any other is refused, or
 * silently dropped along with every block after it. So a block records the digest of what it was
 * produced under, and a projection replays it only while that digest still holds.
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import { digest } from "./digest.ts";
import type { Block, LiveMessage, SystemBlock, ToolSpec, WireMessage } from "./types.ts";

/**
 * The binding of the message at `index`: a digest of the system prompt's text, the tools as the
 * model is told of them, and every message before it with its reasoning removed. Reasoning is left
 * out of the prefix because a provider lets a leading run of it be removed, and removing it must
 * not unbind what follows.
 *
 * @param {{ system: readonly SystemBlock[]; tools: readonly ToolSpec[] }} request - The request the
 *   message was, or would be, produced under
 * @param {readonly WireMessage[]} messages - The conversation as it is sent
 * @param {number} index - The message's place in `messages`
 * @returns {string}
 */
export function bindingOf(
  request: { readonly system: readonly SystemBlock[]; readonly tools: readonly ToolSpec[] },
  messages: readonly WireMessage[],
  index: number,
): string {
  return digest({
    prefix: messages.slice(0, index).map((message) => ({
      blocks: message.blocks.filter((block) => block.type !== "reasoning"),
      role: message.role,
    })),
    system: request.system.map((block) => block.text).join(""),
    tools: request.tools.map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name,
    })),
  });
}

/**
 * Whether a block is thinking a provider signed or redacted: the kind that is bound to a request.
 *
 * @param {Block} block
 * @returns {boolean}
 */
export function isBoundReasoning(block: Block): boolean {
  return (
    block.type === "reasoning" && (block.signature !== undefined || block.redacted !== undefined)
  );
}

/**
 * A conversation as it is saved: signatures and redacted payloads kept only on its latest assistant
 * turn. An earlier turn's signed thinking is bound to a request that will never be sent again once
 * the window is reloaded, so only its text is worth keeping; a block that was redacted outright has
 * no text and is dropped. The messages given are not changed.
 *
 * @param {readonly LiveMessage[]} messages
 * @returns {LiveMessage[]}
 */
export function stripOlderSignatures(messages: readonly LiveMessage[]): LiveMessage[] {
  const latest = messages.findLastIndex(
    (message) => message.role === "assistant" && message.blocks?.some(isBoundReasoning) === true,
  );
  return messages.map((message, index) => {
    if (index === latest || !message.blocks?.some(isBoundReasoning)) {
      return message;
    }
    const blocks = message.blocks.flatMap((block): Block[] => {
      if (block.type !== "reasoning" || !isBoundReasoning(block)) {
        return [block];
      }
      if (block.text === "") {
        return [];
      }
      const { signature: _signature, redacted: _redacted, ...unsigned } = block;
      return [unsigned];
    });
    return { ...message, blocks };
  });
}
