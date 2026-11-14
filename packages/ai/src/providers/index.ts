/**
 * `@jxsuite/ai/providers`: provider families reached directly, behind one shape (specs/ai.md §2.7).
 *
 * A {@link Provider} takes a round's request in no provider's words and yields wire version 2
 * frames, so a gateway, a headless run and an eval can each drive a provider without knowing which
 * family answers. `providerModel` makes one the model function a turn engine calls.
 *
 * Worker-safe (`tests/worker-safety.test.ts`, `tsconfig.worker.json`). Studio never imports it: the
 * page talks to a backend, and the backend talks to the provider
 * (`packages/studio/tests/ai-import-rules.test.ts`).
 *
 * @module @jxsuite/ai/providers
 * @docs extending/embedding/assistant-harness
 */

import type { ModelFn } from "../harness/types.ts";
import { toWireMessages } from "../messages/convert.ts";
import type { Provider } from "./types.ts";

export {
  anthropicCapabilities,
  anthropicExchange,
  anthropicToolId,
  BINDING_CONTROLS_BETA,
  createAnthropicProvider,
  toAnthropicMessagesRequest,
} from "./anthropic.ts";
export type {
  AnthropicExchange,
  AnthropicProviderOptions,
  MessagesApiRequest,
  MessagesProjectionOptions,
} from "./anthropic.ts";
export { chatCompletionsBody } from "./body.ts";
export { createOpenAICompatProvider } from "./openai-compat.ts";
export type { ChatCompletionsBody, ChatCompletionsParts } from "./body.ts";
export type { OpenAICompatProviderOptions } from "./openai-compat.ts";
export type { Provider, ProviderCapabilities, ProviderRequest } from "./types.ts";

/**
 * The model function a turn engine calls, over a provider reached directly: each round is one
 * `provider.stream` of the conversation's wire messages (an assistant turn that drew nothing is not
 * sent, specs/ai.md §2.2).
 *
 * @param {Provider} provider
 * @param {string} model - The model every round is sent to
 * @returns {ModelFn}
 */
export function providerModel(provider: Provider, model: string): ModelFn {
  return (request, signal) =>
    provider.stream(
      {
        messages: toWireMessages(request.messages),
        model,
        system: request.system,
        tools: request.tools,
      },
      signal,
    );
}
