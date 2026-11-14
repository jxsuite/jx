/**
 * Types.ts — what a provider adapter is: one family's wire, behind one shape.
 *
 * Type-only. `@jxsuite/ai/providers` re-exports all of it.
 *
 * @module @jxsuite/ai/providers
 * @license MIT
 */

import type { ProviderFamily, SystemBlock, ToolSpec, WireMessage } from "../messages/types.ts";
import type { WireEvent } from "../streaming-client.ts";

/** One round's request, in no provider's words. */
export interface ProviderRequest {
  readonly model: string;
  readonly system: readonly SystemBlock[];
  readonly messages: readonly WireMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens?: number;
  readonly temperature?: number;
}

/** What a caller must know about a family before it builds a request for it. */
export interface ProviderCapabilities {
  readonly family: ProviderFamily;
  /**
   * Whether the system prompt may be rebuilt between rounds (`rebuild`), or must stay fixed with
   * later context appended as messages (`append`), because the provider binds earlier output to
   * it.
   */
  readonly promptLayout: "rebuild" | "append";
  /** Whether the tool list may change between rounds (`per-round`) or must not (`stable`). */
  readonly toolListing: "per-round" | "stable";
  /** Whether a request without a token ceiling is refused. */
  readonly requiresMaxTokens: boolean;
  /** How many prompt-cache breakpoints one request may carry. Zero when caching is automatic. */
  readonly maxCacheBreakpoints: number;
  /** Whether a `system` message may appear after the conversation has begun. */
  readonly midConversationSystem: boolean;
}

/** One provider family, reached directly. */
export interface Provider {
  readonly family: ProviderFamily;
  /** What the family requires of a request for `model`. */
  capabilities: (model: string) => ProviderCapabilities;
  /** One round: the request in, version 2 frames out, opening with `stream_start`. */
  stream: (request: ProviderRequest, signal: AbortSignal) => AsyncGenerator<WireEvent>;
}
