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

/** Where one chat request is forwarded. A host decides it per request, in `resolveUpstream`. */
export interface Upstream {
  /** The wire the upstream speaks. The OpenAI-compatible chat-completions API is the only one. */
  readonly family: "openai-compat";
  /** The provider's base URL, without the `/chat/completions` the gateway appends. */
  readonly baseUrl: string;
  /** Sent as a bearer token in the `Authorization` header. */
  readonly apiKey: string;
  /** The model a request that names none is forwarded with. */
  readonly defaultModel: string;
  /** True when the platform brokers the credential, rather than the user supplying one. */
  readonly managed: boolean;
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
  /** The wire version of the accepted body. Version 1 is the only one. */
  readonly wire: 1;
  /** The model the request is forwarded with: the body's, or the upstream's default. */
  readonly model: string;
  /** How many messages the body carried, not counting the system prompt the gateway prepends. */
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
  /** Called once per accepted request, after every check and before the upstream is contacted. */
  readonly onAccepted?: (admission: ChatAdmission, upstream: Upstream, context: C) => void;
  /** The fetch the upstream is called with. The global `fetch`, looked up per call, when absent. */
  readonly fetch?: typeof fetch;
}
