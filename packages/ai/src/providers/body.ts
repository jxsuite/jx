/**
 * Body.ts — the OpenAI chat-completions request body, built in one place.
 *
 * `createOpenAIStreamingClient` and the OpenAI-compatible provider adapter both send this body, and
 * a provider's prompt cache keys on its bytes, so the two must not each keep a builder that drifts
 * (specs/ai.md §2.7).
 *
 * @module @jxsuite/ai/providers
 * @license MIT
 */

/** What a caller knows about one chat-completions request. */
export interface ChatCompletionsParts {
  readonly model: string;
  readonly systemPrompt: string;
  /** The conversation, already on the OpenAI wire. */
  readonly messages: readonly object[];
  /** The tools on offer, already on the OpenAI wire. None is an empty list. */
  readonly tools: readonly object[];
  /** Forwarded only when defined: reasoning models reject a custom temperature. */
  readonly temperature?: number | undefined;
  /** The most tokens the reply may run to, forwarded only when defined. */
  readonly maxTokens?: number | undefined;
  /** The provider's own tool-choice value, in place of `"auto"`, when the caller chose one. */
  readonly toolChoice?: string | object | undefined;
  /** The provider's reasoning-effort setting, forwarded only when defined. */
  readonly reasoningEffort?: string | undefined;
  /** Prompt-cache members for this upstream's host (`upstreamCacheHints`), merged in last. */
  readonly hints?: Readonly<Record<string, string>> | undefined;
}

/** An OpenAI chat-completions streaming request body. */
export interface ChatCompletionsBody {
  model: string;
  messages: object[];
  stream: true;
  stream_options: { include_usage: true };
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: string;
  tools?: readonly object[];
  tool_choice?: string | object;
  parallel_tool_calls?: true;
  /** OpenAI's prompt-cache routing key, sent only to OpenAI itself (see `cache-hints.ts`). */
  prompt_cache_key?: string;
}

/**
 * The streaming chat-completions body for one request: the system prompt as a leading `system`
 * message, `stream_options.include_usage` so the provider's own token count arrives, and
 * `tool_choice` with parallel calls whenever tools are offered. Members are added in a fixed order,
 * and an optional one only when the caller gave it, so the same request always serializes to the
 * same bytes.
 *
 * @param {ChatCompletionsParts} parts
 * @returns {ChatCompletionsBody}
 */
export function chatCompletionsBody(parts: ChatCompletionsParts): ChatCompletionsBody {
  const body: ChatCompletionsBody = {
    model: parts.model,
    messages: [{ role: "system", content: parts.systemPrompt }, ...parts.messages],
    stream: true,
    stream_options: { include_usage: true },
  };
  if (parts.temperature !== undefined) {
    body.temperature = parts.temperature;
  }
  if (parts.maxTokens !== undefined) {
    body.max_tokens = parts.maxTokens;
  }
  if (parts.reasoningEffort !== undefined) {
    body.reasoning_effort = parts.reasoningEffort;
  }
  if (parts.tools.length > 0) {
    body.tools = parts.tools;
    body.tool_choice = parts.toolChoice ?? "auto";
    body.parallel_tool_calls = true;
  }
  Object.assign(body, parts.hints);
  return body;
}
