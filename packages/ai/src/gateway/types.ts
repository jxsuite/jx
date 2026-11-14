/**
 * The gateway's contract types: what a host hands `createChatHandler`, and what the handler reports
 * back to it.
 *
 * The split these types draw is the point of the gateway. The WIRE (reading the body, shaping the
 * upstream request, normalizing the upstream stream, framing SSE, rendering a refusal) is the same
 * for every host, so it lives here once. The POLICY (whose key a request may use, which base URLs
 * are safe to reach, how many requests a caller may make) differs per host, so the host supplies it
 * as `admit` and `resolveUpstream` and the gateway never second-guesses the answer.
 *
 * Type-only, so it is on the allowlist in `scripts/check-coverage-manifest.ts`.
 *
 * @module @jxsuite/ai/gateway
 */

import type { ProblemDetails } from "@jxsuite/protocol/problem";

/**
 * How one OpenAI-compatible upstream departs from the chat-completions wire. Every member is
 * optional, and the defaults read the widest set of providers correctly; a host names a quirk only
 * for an upstream it knows needs it.
 */
export interface OpenAICompatQuirks {
  /** The one delta member chain-of-thought arrives in. Both known spellings are read when absent. */
  readonly reasoningField?: "reasoning_content" | "reasoning";
  /**
   * Dotted paths inside the usage object that may hold the cached-input count, tried in order.
   * Defaults to `prompt_tokens_details.cached_tokens`; DeepSeek uses `prompt_cache_hit_tokens`.
   */
  readonly cachedTokensPaths?: readonly string[];
  /**
   * What joins a tool call's fragments: `index-then-position` (the default) uses the fragment's
   * `index` and falls back to its place in the chunk; `index` trusts the index alone.
   */
  readonly callKey?: "index" | "index-then-position";
  /**
   * When a fragment carrying an id opens a new call: `id-change` (the default) only when the id
   * differs from the call open at that key; `id` on every fragment that carries one.
   */
  readonly newCallOn?: "id" | "id-change";
}

/** Where one chat request is forwarded. A host decides it per request, in `resolveUpstream`. */
export interface Upstream {
  /**
   * The wire the upstream speaks: the OpenAI-compatible chat-completions API, or the Anthropic
   * Messages API (specs/ai.md §2.6). A client's body is the same version 1 body either way; the
   * gateway projects it onto the family's wire and normalizes the family's stream.
   */
  readonly family: "openai-compat" | "anthropic";
  /**
   * The provider's base URL, without the path the gateway appends: `/chat/completions` for the
   * OpenAI-compatible family (so it usually ends in `/v1`), `/v1/messages` for Anthropic (so it is
   * the origin, `ANTHROPIC_BASE_URL`).
   */
  readonly baseUrl: string;
  /** Sent as a bearer token in the `Authorization` header, or as `x-api-key` to Anthropic. */
  readonly apiKey: string;
  /** The model a request that names none is forwarded with. */
  readonly defaultModel: string;
  /** True when the platform brokers the credential, rather than the user supplying one. */
  readonly managed: boolean;
  /**
   * The prompt-cache affinity key for the request's conversation, when the host derived one: the
   * gateway forwards it in whatever form this upstream understands, and to no other upstream
   * (`upstreamCacheHints`). A host derives it with `affinityKey(scope, id)` from the client's
   * `X-Jx-Ai-Session` header, so the raw id never leaves the host.
   */
  readonly sessionAffinity?: string;
  /** How this upstream departs from the chat-completions wire, when the host knows it does. */
  readonly quirks?: OpenAICompatQuirks;
}

/**
 * A request the gateway (or the host's policy) declined, answered as `application/problem+json`
 * before any upstream is contacted.
 */
export interface GatewayRefusal {
  /** The HTTP status of the refusal. */
  readonly status: number;
  /** The RFC 9457 problem document the body carries. */
  readonly problem: ProblemDetails;
  /** A machine code for clients that key on `code` rather than on the problem type. */
  readonly code?: string;
}

/** What a request the gateway accepted asked for, reported to `onAccepted` for audit. */
export interface ChatAdmission {
  /** The wire version of the accepted body. */
  readonly wire: 1 | 2;
  /** The model the request is forwarded with: the body's, or the upstream's default. */
  readonly model: string;
  /**
   * How many messages the body carried, not counting the system prompt the gateway prepends. A
   * version 2 body's are counted as the conversation's own messages, before they are projected.
   */
  readonly messageCount: number;
  /** The body's size in bytes, as read rather than as declared. */
  readonly bytes: number;
}

/** A host's half of the chat route. Only `resolveUpstream` is required. */
export interface ChatGatewayOptions<C> {
  /** Runs first, before the body is read (a rate limit, say). A refusal ends the request. */
  readonly admit?: (
    request: Request,
    context: C,
  ) => Promise<GatewayRefusal | null> | GatewayRefusal | null;
  /**
   * Where the request goes, or why it goes nowhere. This is the host's policy: key provenance and
   * any guard on a caller-supplied base URL belong here, not in the gateway.
   */
  readonly resolveUpstream: (
    request: Request,
    context: C,
  ) => Promise<Upstream | GatewayRefusal> | Upstream | GatewayRefusal;
  /** The largest body accepted, in bytes actually read. Reading stops once it is passed. */
  readonly maxBodyBytes?: number;
  /** The most messages one request may carry. */
  readonly maxMessages?: number;
  /**
   * The wire versions this host's chat route accepts. `WIRE_VERSIONS` (both) when absent; a host
   * that must hold its clients to version 1 says `[1]`, and should advertise the same list from its
   * models route.
   */
  readonly wire?: readonly number[];
  /** Called once per accepted request, after every check and before the upstream is contacted. */
  readonly onAccepted?: (admission: ChatAdmission, upstream: Upstream, context: C) => void;
  /**
   * The `code` an error frame carries for an upstream's non-2xx status, when the host knows one
   * better than the status: a brokered credential that lapsed is something a client can offer to
   * reconnect, and a bare `401` is not. Undefined keeps the status.
   */
  readonly upstreamErrorCode?: (status: number, upstream: Upstream) => string | undefined;
  /** The fetch the upstream is called with. The global `fetch`, looked up per call, when absent. */
  readonly fetch?: typeof fetch;
}
