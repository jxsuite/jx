/**
 * Types.ts — the provider-neutral conversation model, and the v1 shape it is read from.
 *
 * Type-only. `@jxsuite/ai/messages` re-exports all of it; the conversions live in `convert.ts` and
 * `openai.ts`.
 *
 * A conversation used to have one shape, OpenAI's: a message was `content`, an optional
 * `reasoningContent` and an optional list of `toolCalls`, and the request was that array with the
 * field names changed. Every provider that is not OpenAI-compatible describes a turn differently
 * (Anthropic's thinking blocks carry a signature that must be replayed byte for byte, and its tool
 * results ride on a user message), so a transcript written in one provider's words cannot be sent
 * to another without guessing. A {@link ChatMessage} is a list of typed {@link Block}s instead, and
 * each provider's adapter projects it onto its own wire (specs/ai.md §2.3).
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type { JsonValue, ToolResult } from "../core-types.ts";

export type { JsonArray, JsonObject, JsonValue } from "../core-types.ts";

/** The provider families a block can come from, and that an adapter projects onto. */
export type ProviderFamily = "openai-compat" | "anthropic";

/** Which provider produced a block, for a block that must only be replayed to that provider. */
export interface Provenance {
  readonly family: ProviderFamily;
  /** The model that produced it; null only for data migrated from the v1 shape. */
  readonly model: string | null;
}

/** Text the model wrote, or the person did. */
export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

/** A thinking model's chain of thought: owed back to the provider that streamed it (§2.2). */
export interface ReasoningBlock {
  readonly type: "reasoning";
  /** Empty when the provider sent only a redacted payload. */
  readonly text: string;
  /** Opaque, replayed unchanged to the provider that signed it. */
  readonly signature?: string;
  /** An opaque redacted payload, never merged into `text`. */
  readonly redacted?: string;
  /** Absent: the message's own `meta.family` decides, and v1 data is `openai-compat`. */
  readonly provenance?: Provenance;
}

/** A tool call the model made. */
export interface ToolCallBlock {
  readonly type: "tool_call";
  readonly id: string;
  readonly name: string;
  /** The arguments exactly as streamed, which may not parse: the only source of truth. */
  readonly argumentsText: string;
  /** An opaque per-call signature, round-tripped. */
  readonly signature?: string;
}

/** What a tool call answered. */
export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly callId: string;
  /** True when `content` parses as a result whose `success` is false; unparseable is false. */
  readonly isError: boolean;
  /** For a Jx tool, exactly the serialized `ToolResult`. */
  readonly content: string;
}

/** Provider data the model has no neutral word for, kept for that provider alone. */
export interface OpaqueBlock {
  readonly type: "opaque";
  readonly family: ProviderFamily;
  readonly data: JsonValue;
}

export type Block = TextBlock | ReasoningBlock | ToolCallBlock | ToolResultBlock | OpaqueBlock;

/** `system` is the v1 passthrough: a message any consumer may push, sent as it is. */
export type Role = "user" | "assistant" | "tool" | "system";

/** What a synthetic message is, for a message the harness rather than the model wrote. */
export type MessageKind =
  | "ctx_summary"
  | "sealed"
  | "round_cap"
  | "seeded"
  | "restored"
  | "context"
  | "compaction";

/** Facts about a message that are never sent to a provider. */
export interface MessageMeta {
  readonly origin?: "model" | "harness" | "user";
  readonly kind?: MessageKind;
  readonly model?: string;
  readonly family?: ProviderFamily;
  readonly incomplete?: "error" | "truncated" | "length";
  readonly turnId?: string;
  /** A host's own facts, under reverse-DNS keys such as `com.jxsuite.studio/ledger`. */
  readonly host?: Readonly<Record<string, JsonValue>>;
}

/** One message of a conversation, in no provider's words. */
export interface ChatMessage {
  readonly id: string;
  readonly role: Role;
  readonly blocks: readonly Block[];
  readonly timestamp: number;
  readonly meta?: MessageMeta;
}

/** What travels in a request: the role and the blocks, with no id, timestamp or meta. */
export interface WireMessage {
  readonly role: Role;
  readonly blocks: readonly Block[];
}

/** A tool call as the v1 transcript records it: what the model sent, and the chip's outcome. */
export interface LiveToolCall {
  id: string;
  name: string;
  arguments: string;
  /** Transcript-only: the outcome the chip renders. The `tool` reply is what the wire carries. */
  result?: ToolResult | null;
}

/**
 * The v1 message: chat-state's live shape and the shape every saved session holds, plus two
 * optional fields.
 */
export interface LiveMessage {
  id: string;
  role: Role;
  content: string;
  /**
   * The turn's chain of thought, when the provider streamed one (`reasoning_content` /
   * `reasoning`). Kept because a thinking model's own history is not optional: DeepSeek's thinking
   * mode REQUIRES every prior turn's `reasoning_content` back on any request that carries `tools`,
   * which is every request the agent loop makes.
   */
  reasoningContent?: string;
  toolCalls?: LiveToolCall[];
  toolCallId?: string;
  timestamp: number;
  /**
   * The message's blocks, present ONLY when the v1 fields above cannot describe them exactly: a
   * signed, redacted or provider-bound reasoning block, an opaque block, or text and calls
   * interleaved, for instance. The v1 fields are still written, so a reader that predates blocks
   * keeps working.
   */
  blocks?: Block[];
  meta?: MessageMeta;
}

/** One part of a system prompt. A request's parts are joined in order, with nothing between. */
export interface SystemBlock {
  readonly text: string;
}

/** A tool as a provider is told about it. */
export interface ToolSpec {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** JSON Schema for the arguments, by reference: a host may build it with live getters. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** OpenAI's strict mode, opted into per tool. */
  readonly strict?: boolean;
}

/** One OpenAI chat-completions tool call. */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message on the OpenAI chat-completions wire. */
export type OpenAIMessage =
  | { role: "user" | "system"; content: string }
  | {
      role: "assistant";
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

/** One tool on the OpenAI chat-completions wire: `ToolRegistry.listForLLM()`'s shape. */
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Readonly<Record<string, unknown>>;
    strict?: true;
  };
}
