/**
 * `@jxsuite/ai/messages`: the provider-neutral conversation model (specs/ai.md §2.3).
 *
 * A conversation is a list of {@link ChatMessage}s, each a list of typed blocks: text, reasoning,
 * tool calls, tool results, and provider data with no neutral word. Chat-state and saved sessions
 * keep the v1 shape ({@link LiveMessage}); `toChatMessages` and `toLiveMessages` convert between
 * the two, and `toOpenAIMessages` is the OpenAI-compatible projection every request is built with.
 *
 * Worker-safe: it imports nothing at runtime outside itself (`tests/worker-safety.test.ts`,
 * `tsconfig.worker.json`).
 *
 * @module @jxsuite/ai/messages
 * @docs extending/embedding/assistant-harness
 */

export { isEmptyAssistant, toChatMessages, toLiveMessages, toWireMessages } from "./convert.ts";
export { fromOpenAITools, toOpenAIMessages, toOpenAITools } from "./openai.ts";

export type {
  Block,
  ChatMessage,
  JsonArray,
  JsonObject,
  JsonValue,
  LiveMessage,
  LiveToolCall,
  MessageKind,
  MessageMeta,
  OpaqueBlock,
  OpenAIMessage,
  OpenAITool,
  OpenAIToolCall,
  Provenance,
  ProviderFamily,
  ReasoningBlock,
  Role,
  SystemBlock,
  TextBlock,
  ToolCallBlock,
  ToolResultBlock,
  ToolSpec,
  WireMessage,
} from "./types.ts";
