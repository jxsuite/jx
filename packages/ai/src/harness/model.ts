/**
 * Model.ts — a model function over a v1 streaming client.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { toOpenAIMessages, toOpenAITools } from "../messages/openai.ts";
import type { SystemBlock } from "../messages/types.ts";
import type { StreamingClient } from "../streaming-client.ts";
import type { ModelFn } from "./types.ts";

/**
 * A request's system prompt as one text: its parts joined in order, with nothing between.
 *
 * @param {readonly SystemBlock[]} system
 * @returns {string}
 */
export function joinSystem(system: readonly SystemBlock[]): string {
  return system.map((block) => block.text).join("");
}

/**
 * A model function that sends each round through `client.streamChat`, projected onto the OpenAI
 * chat-completions wire (specs/ai.md §2.3). `streamChat` is read off the client on every call, so a
 * host that swaps it between rounds is honoured, and it is called exactly once per round.
 *
 * @param {StreamingClient} client
 * @returns {ModelFn}
 */
export function fromStreamingClient(client: StreamingClient): ModelFn {
  return (request, signal) => {
    const messages = toOpenAIMessages(request.messages);
    const tools = toOpenAITools(request.tools);
    return client.streamChat(messages, tools, joinSystem(request.system), signal);
  };
}
