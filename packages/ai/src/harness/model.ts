/**
 * Model.ts — a model function over a v1 streaming client.
 *
 * @module @jxsuite/ai/harness
 * @license MIT
 */

import { toWireMessages } from "../messages/convert.ts";
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
 * chat-completions wire (specs/ai.md §2.3), or through `client.streamTurn` when the client was
 * built for wire version 2, which takes the neutral conversation itself (specs/ai.md §2.7). The
 * method is read off the client on every call, so a host that swaps it between rounds is honoured,
 * and exactly one of the two is called once per round.
 *
 * @param {StreamingClient} client
 * @returns {ModelFn}
 */
export function fromStreamingClient(client: StreamingClient): ModelFn {
  return (request, signal) => {
    // A client built for wire version 2 takes the conversation as it is (specs/ai.md §2.7).
    if (client.streamTurn) {
      return client.streamTurn(
        {
          messages: toWireMessages(request.messages),
          system: [...request.system],
          tools: [...request.tools],
        },
        signal,
      );
    }
    const messages = toOpenAIMessages(request.messages);
    const tools = toOpenAITools(request.tools);
    return client.streamChat(messages, tools, joinSystem(request.system), signal);
  };
}
