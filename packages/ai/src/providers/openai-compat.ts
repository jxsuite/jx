/**
 * Openai-compat.ts — the OpenAI-compatible family as a provider adapter.
 *
 * It sends the body `createOpenAIStreamingClient` sends (`body.ts`) and reads the answer with the
 * normalizer that client and every gateway run (`gateway/normalize.ts`), so the family has one
 * request and one set of frames however it is reached (specs/ai.md §2.7).
 *
 * @module @jxsuite/ai/providers
 * @license MIT
 */

import { upstreamCacheHints } from "../cache-hints.ts";
import { fetchFailureFrame, normalizeOpenAIStream } from "../gateway/normalize.ts";
import type { OpenAICompatQuirks } from "../gateway/types.ts";
import { toOpenAIMessages, toOpenAITools } from "../messages/openai.ts";
import type { WireEvent } from "../streaming-client.ts";
import { chatCompletionsBody } from "./body.ts";
import type { Provider, ProviderCapabilities, ProviderRequest } from "./types.ts";

/** How an OpenAI-compatible provider is reached. */
export interface OpenAICompatProviderOptions {
  /** The provider's base URL, without `/chat/completions` (it usually ends in `/v1`). */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** How this provider departs from the chat-completions wire, when the caller knows it does. */
  readonly quirks?: OpenAICompatQuirks;
  /** A stable key for the conversation, forwarded as the cache hint this host understands. */
  readonly sessionAffinity?: string;
  /** The fetch the provider is called with. The global `fetch`, looked up per call, when absent. */
  readonly fetch?: typeof fetch;
}

/**
 * What the family asks of a request. The same for every model: the system prompt may be rebuilt and
 * the tools relisted each round, no token ceiling is required, and caching is the provider's own
 * business.
 */
const CAPABILITIES: ProviderCapabilities = {
  family: "openai-compat",
  maxCacheBreakpoints: 0,
  midConversationSystem: true,
  promptLayout: "rebuild",
  requiresMaxTokens: false,
  toolListing: "per-round",
};

/**
 * A provider adapter for any OpenAI-compatible chat-completions endpoint.
 *
 * @param {OpenAICompatProviderOptions} options
 * @returns {Provider}
 */
export function createOpenAICompatProvider(options: OpenAICompatProviderOptions): Provider {
  // Fixed for the provider's life, so it is classified once rather than per request.
  const hints = upstreamCacheHints(options.baseUrl, options.sessionAffinity);

  /**
   * @param {ProviderRequest} request
   * @param {AbortSignal} signal
   * @yields {WireEvent} `stream_start`, then the normalized frames
   */
  async function* stream(request: ProviderRequest, signal: AbortSignal): AsyncGenerator<WireEvent> {
    yield { family: "openai-compat", model: request.model, type: "stream_start", wire: 2 };
    const body = chatCompletionsBody({
      hints: hints.body,
      maxTokens: request.maxTokens,
      messages: toOpenAIMessages(request.messages),
      model: request.model,
      systemPrompt: request.system.map((block) => block.text).join(""),
      temperature: request.temperature,
      tools: toOpenAITools(request.tools),
    });
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(`${options.baseUrl}/chat/completions`, {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          ...hints.headers,
        },
        method: "POST",
        signal,
      });
    } catch (error) {
      yield fetchFailureFrame(error);
      return;
    }
    yield* normalizeOpenAIStream(response, options.quirks ? { quirks: options.quirks } : {});
  }

  return { capabilities: () => CAPABILITIES, family: "openai-compat", stream };
}
