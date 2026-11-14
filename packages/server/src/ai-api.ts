/**
 * Ai-api.js — AI proxy endpoints for Jx Studio
 *
 * Handles /__studio/ai/chat (SSE streaming proxy to OpenAI) and /__studio/ai/models. The server
 * acts as a thin proxy: validates the request shape, forwards to OpenAI, normalizes the SSE stream
 * into StreamEvent-compatible format, and pipes back.
 *
 * The wire half of that (reading the body, the upstream request, the stream normalizer, the SSE
 * framing, the problem responses) is `@jxsuite/ai/gateway`, which every backend serving these
 * routes can share. What stays here is this server's POLICY, which no other host shares:
 *
 * API key flow:
 *
 * 1. Request header X-Api-Key or Authorization: Bearer <key>
 * 2. Fallback: OPENAI_API_KEY env var — attached ONLY to the env/default base URL, never to a
 *    caller-supplied X-Api-Base-URL (prevents exfiltrating the server key to a chosen endpoint)
 * 3. If neither → 401 with error message
 *
 * Base URL flow:
 *
 * 1. Request header X-Api-Base-URL — allowed only alongside a header API key
 * 2. Fallback: OPENAI_BASE_URL env var
 * 3. Default: https://api.openai.com/v1
 *
 * Whichever it is, it is judged before anything is contacted (specs/ai.md §4): it must be an http
 * or https URL, and its host must not be a link-local address or a cloud metadata endpoint, in any
 * spelling. An upstream's redirect is not followed, so the host that was judged is the only one
 * contacted.
 *
 * Provider family (specs/ai.md §2.6): a request carrying `X-Api-Provider: anthropic` is served by
 * the Anthropic Messages API instead, with the same two flows read from ANTHROPIC_API_KEY,
 * ANTHROPIC_BASE_URL and `https://api.anthropic.com`. An env key is still attached only to its own
 * family's env/default base URL, so neither server key reaches the other family or a caller's
 * endpoint. Any other value is refused: a key must never be sent to a provider it was not meant
 * for. The models route lists both families in `providers`.
 *
 * `resolveAiConfig` is that whole policy for one request, and every server route that forwards a
 * provider key upstream calls it: both routes here, and the site import's component-naming pass.
 *
 * Prompt-cache affinity: a request carrying a valid X-Jx-Ai-Session header (the client's
 * conversation id) is forwarded with `sessionAffinity` set to a hash of it, scoped to this server
 * ("local"). The gateway sends that hash only to an upstream that routes on it (OpenAI, Workers
 * AI); the raw id never leaves this process. An absent or malformed header just means no hint: the
 * request is still served.
 *
 * The model catalogue for /models is this server's too: its defaults, and how it reads the
 * upstream's own listing.
 *
 * @license MIT
 * @docs extending/embedding/backend-protocol
 */
import { BlockList, isIP } from "node:net";
import {
  AI_SESSION_HEADER,
  affinityKey,
  ANTHROPIC_BASE_URL,
  createChatHandler,
  DEFAULT_UPSTREAM_BASE_URL,
  extractUpstreamErrorMessage,
  isAiSessionId,
  listAnthropicModels,
  modelsResponse,
  problemResponse,
} from "@jxsuite/ai/gateway";
import type { GatewayRefusal, Upstream } from "@jxsuite/ai/gateway";
import { AI_PROVIDER_HEADER } from "@jxsuite/ai/streaming-client";
import { problemDetails } from "@jxsuite/protocol";
import type { AiModelInfo, AiProviderFamily } from "@jxsuite/protocol";
import { errorMessage } from "@jxsuite/schema/parse";
import { problemTypeForStatus } from "./problem.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

/** The model a chat request that names none is forwarded with. */
const DEFAULT_MODEL = "gpt-4o";

/** The model an Anthropic chat request that names none is forwarded with, and the probe prefers. */
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

/** Every family this server's chat route can reach, as the models route declares them. */
const PROVIDERS: AiProviderFamily[] = ["openai-compat", "anthropic"];

/** The Claude catalogue the models route answers when it cannot list the caller's own. */
const ANTHROPIC_DEFAULTS: AiModelInfo[] = [
  { contextWindow: 1_000_000, id: "claude-opus-5-5", name: "Claude Opus 5.5" },
  { contextWindow: 1_000_000, id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
  { contextWindow: 1_000_000, id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
];

/**
 * This server's namespace for affinity keys. Every dev/desktop server shares it: their keys never
 * meet a hosted backend's, because that one hashes under its own scope.
 */
const AFFINITY_SCOPE = "local";

/** A model entry from the upstream `/models` listing. */
interface ModelEntry {
  id: string;
  context_window?: number;
  owned_by?: string;
}

/**
 * The IPv4 ranges a base URL may not address: the link-local range, where the cloud metadata
 * services listen (`169.254.169.254`), and the one metadata address outside it, Alibaba Cloud's.
 * Each as `[address, prefix length]`.
 */
const REFUSED_IPV4: readonly (readonly [string, number])[] = [
  ["169.254.0.0", 16],
  ["100.100.100.200", 32],
];

/** The IPv6 ranges: link-local, and EC2's IPv6 metadata address, which sits in unique-local space. */
const REFUSED_IPV6: readonly (readonly [string, number])[] = [
  ["fe80::", 10],
  ["fd00:ec2::254", 128],
];

/**
 * The IPv6 prefixes under which an address carries an IPv4 address in its low 32 bits, and is
 * judged as that address: NAT64's well-known prefix and the deprecated IPv4-compatible form. The
 * IPv4-mapped form (`::ffff:0:0/96`) is the third, and `BlockList` applies every IPv4 rule to it
 * already.
 */
const IPV4_EMBEDDING_PREFIXES = ["::", "64:ff9b::"] as const;

/** Every refused address, in whichever family and spelling it arrives. */
const REFUSED_ADDRESSES = new BlockList();
for (const [address, prefix] of REFUSED_IPV4) {
  REFUSED_ADDRESSES.addSubnet(address, prefix, "ipv4");
  for (const embedding of IPV4_EMBEDDING_PREFIXES) {
    REFUSED_ADDRESSES.addSubnet(`${embedding}${address}`, 96 + prefix, "ipv6");
  }
}
for (const [address, prefix] of REFUSED_IPV6) {
  REFUSED_ADDRESSES.addSubnet(address, prefix, "ipv6");
}

/** Host names refused outright. A name is never resolved, so this is by name alone. */
const REFUSED_NAMES: ReadonlySet<string> = new Set(["metadata.google.internal"]);

/** What a base URL that is not an http(s) URL, or not a URL at all, is refused with. */
const NOT_HTTP = "Base URL must be an http or https URL.";

/** What a base URL whose host is refused is answered with. */
const HOST_NOT_PERMITTED = "Base URL host is not permitted.";

/**
 * Why a provider base URL may not be contacted, or null when it may (specs/ai.md §4).
 *
 * - A URL that does not parse, or whose scheme is not `http:` or `https:`, is refused: the provider
 *   is an HTTP endpoint, and this runtime's `fetch` would read a `file:` URL from disk.
 * - A host that is an address in a refused range is refused, in every spelling the URL parser accepts
 *   (a decimal or hexadecimal IPv4, an IPv4-mapped, NAT64 or IPv4-compatible IPv6).
 * - A host that is a refused name is refused, with or without a trailing dot.
 *
 * Loopback and private-LAN hosts are deliberately allowed: self-hosted and local models run there.
 * **A name is not resolved**, so a DNS name that resolves into a refused range is not caught: a
 * check made before the request is undone by an answer that changes before the connection opens,
 * and `fetch` cannot be pinned to the address that was checked.
 *
 * @param {string} rawUrl - The base URL a request would be forwarded to
 * @returns {string | null} The sentence the refusal carries, or null
 */
export function baseUrlRefusal(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return NOT_HTTP;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NOT_HTTP;
  }
  // The parser lower-cases the host and writes an IPv6 address in brackets.
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  const family = isIP(host);
  if (family === 0) {
    return REFUSED_NAMES.has(host.endsWith(".") ? host.slice(0, -1) : host)
      ? HOST_NOT_PERMITTED
      : null;
  }
  return REFUSED_ADDRESSES.check(host, family === 6 ? "ipv6" : "ipv4") ? HOST_NOT_PERMITTED : null;
}

/** What this server decided for one request: where it goes and with whose key, or why it does not. */
export interface AiConfig {
  family: AiProviderFamily;
  apiKey: string | null;
  baseUrl: string;
  missingKey: boolean;
  reject?: { status: number; message: string };
}

/** Where each family's server-side key and base URL come from, and its default endpoint. */
interface FamilyEnvironment {
  keyVariable: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
  baseUrlVariable: "OPENAI_BASE_URL" | "ANTHROPIC_BASE_URL";
  defaultBaseUrl: string;
}

const ENVIRONMENTS: Readonly<Record<AiProviderFamily, FamilyEnvironment>> = {
  anthropic: {
    baseUrlVariable: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: ANTHROPIC_BASE_URL,
    keyVariable: "ANTHROPIC_API_KEY",
  },
  "openai-compat": {
    baseUrlVariable: "OPENAI_BASE_URL",
    defaultBaseUrl: DEFAULT_UPSTREAM_BASE_URL,
    keyVariable: "OPENAI_API_KEY",
  },
};

/**
 * The family a request names in `X-Api-Provider`: absent or empty is the OpenAI-compatible default,
 * and a value naming no family this server reaches is null, which the caller refuses.
 */
function familyOf(req: Request): AiProviderFamily | null {
  const named = (req.headers.get(AI_PROVIDER_HEADER) || "").trim().toLowerCase();
  if (named === "" || named === "openai-compat") {
    return "openai-compat";
  }
  return named === "anthropic" ? "anthropic" : null;
}

/**
 * This server's whole provider policy for one request (specs/ai.md §4): the family it names, the
 * base URL it resolves to and whether that URL may be contacted, and the key it may carry there. A
 * `reject` means the request goes nowhere. Every route that forwards a provider key upstream calls
 * this and honours `reject`.
 *
 * @param {Request} req
 * @returns {AiConfig}
 */
export function resolveAiConfig(req: Request): AiConfig {
  const authHeader = req.headers.get("Authorization") || "";
  const apiKeyHeader = req.headers.get("X-Api-Key") || "";
  const baseUrlHeader = req.headers.get("X-Api-Base-URL") || "";
  const named = familyOf(req);
  if (named === null) {
    return {
      apiKey: null,
      baseUrl: "",
      family: "openai-compat",
      missingKey: true,
      reject: {
        status: 400,
        message: `Unknown ${AI_PROVIDER_HEADER}: this server reaches openai-compat and anthropic.`,
      },
    };
  }
  const family = named;
  const environment = ENVIRONMENTS[family];

  // Track the PROVENANCE of the key: a header-supplied key may ride a caller's custom base URL; the
  // Server's env key never leaves for a caller-chosen endpoint (key-exfiltration defense).
  let apiKey: string | null = null;
  let keyFromHeader = false;
  if (authHeader.startsWith("Bearer ")) {
    apiKey = authHeader.slice(7).trim();
    keyFromHeader = true;
  }
  if (apiKeyHeader) {
    apiKey = apiKeyHeader.trim(); // X-Api-Key overrides Bearer
    keyFromHeader = true;
  }

  const baseFromHeader = Boolean(baseUrlHeader);
  const baseUrl =
    baseUrlHeader || process.env[environment.baseUrlVariable] || environment.defaultBaseUrl;

  const refused = baseUrlRefusal(baseUrl);
  if (refused !== null) {
    return {
      apiKey: null,
      baseUrl,
      family,
      missingKey: true,
      reject: { status: 403, message: refused },
    };
  }

  // A caller-supplied base URL requires a caller-supplied key. Refuse to forward the env
  // OPENAI_API_KEY to an endpoint the request chose.
  if (baseFromHeader && !keyFromHeader) {
    return {
      apiKey: null,
      baseUrl,
      family,
      missingKey: true,
      reject: {
        status: 401,
        message: "A custom base URL requires an explicit API key (X-Api-Key).",
      },
    };
  }

  // Env key is only ever attached to its own family's env/default base URL.
  const envKey = process.env[environment.keyVariable];
  if (!apiKey && envKey) {
    apiKey = envKey;
  }

  return { apiKey, baseUrl, family, missingKey: !apiKey };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A refusal at a status this file chose.
 *
 * The status picks the type rather than the other way round, because this file's refusals were
 * always written as statuses (`reject.status`), and the response carries the TYPE's status, exactly
 * as `problem()` answers.
 */
function refuse(status: number, message: string): GatewayRefusal {
  const problem = problemDetails(problemTypeForStatus(status), message);
  return { problem, status: problem.status };
}

/**
 * This server's upstream for a request, or its refusal: the key-provenance and SSRF rules above,
 * applied per request (the environment is read each time, so a key set later is honoured). A valid
 * session header adds the hashed affinity key; an invalid one is ignored rather than refused.
 */
async function resolveUpstream(req: Request): Promise<Upstream | GatewayRefusal> {
  const { apiKey, baseUrl, family, reject } = resolveAiConfig(req);
  if (reject) {
    return refuse(reject.status, reject.message);
  }
  if (!apiKey) {
    return refuse(
      401,
      `No API key configured. Set ${ENVIRONMENTS[family].keyVariable} env var or send X-Api-Key header.`,
    );
  }
  const upstream: Upstream = {
    apiKey,
    baseUrl,
    defaultModel: family === "anthropic" ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_MODEL,
    family,
    managed: false,
  };
  const sessionId = req.headers.get(AI_SESSION_HEADER);
  if (isAiSessionId(sessionId)) {
    return { ...upstream, sessionAffinity: await affinityKey(AFFINITY_SCOPE, sessionId) };
  }
  return upstream;
}

// ─── /__studio/ai/chat — SSE streaming proxy ───────────────────────────────

/**
 * The fetch every upstream request is made with: the global one, read at call time, following no
 * redirect. A redirect is the one way a host that was judged can send the proxy to one that was
 * not, so the upstream's `3xx` is reported as the status it is (specs/ai.md §4).
 */
const upstreamFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, { ...init, redirect: "manual" }),
  { preconnect: fetch.preconnect },
);

const chatHandler = createChatHandler<{ readonly signal: AbortSignal }>({
  fetch: upstreamFetch,
  resolveUpstream: (request) => resolveUpstream(request),
});

/** Handle POST /__studio/ai/chat — proxy the chat to the request's provider family via SSE. */
export async function handleChat(req: Request): Promise<Response> {
  return chatHandler(req, { signal: req.signal });
}

// ─── /__studio/ai/models — model listing ────────────────────────────────────

/**
 * Handle GET /__studio/ai/models — return available models.
 *
 * When the caller has configured an API key (header or env), the request is proxied to the upstream
 * provider's /models endpoint so any OpenAI-compatible endpoint (OpenRouter, local LLM, OpenCode
 * Zen, Azure, etc.) returns its actual model list. Falls back to a hardcoded default list when no
 * key is available.
 */
export async function handleModels(req: Request): Promise<Response> {
  const { apiKey, baseUrl, family, missingKey, reject } = resolveAiConfig(req);
  if (reject) {
    return problemResponse(refuse(reject.status, reject.message));
  }
  if (family === "anthropic") {
    return anthropicModels(apiKey, baseUrl);
  }

  // No key available → return hardcoded defaults so the UI can at least render.
  if (missingKey) {
    const defaults = [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 },
      { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1_000_000 },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1_000_000 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128_000 },
    ];
    return modelsResponse({
      models: defaults,
      configured: false,
      managed: false,
      providers: PROVIDERS,
    });
  }

  // Key is available — proxy to the upstream /models endpoint.
  try {
    const upstreamUrl = `${baseUrl}/models`;
    const upstreamResp = await upstreamFetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!upstreamResp.ok) {
      // Upstream failed — return defaults with configured flag so user can still try.
      let errorBody = "";
      try {
        errorBody = await upstreamResp.text();
      } catch {
        /* Ignore */
      }
      const upstreamMessage = extractUpstreamErrorMessage(errorBody, upstreamResp.statusText);
      const defaults = [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 }];
      return modelsResponse({
        models: defaults,
        configured: true,
        managed: false,
        providers: PROVIDERS,
        upstreamError: upstreamResp.status,
        upstreamMessage,
      });
    }

    /* SAFETY: an OpenAI-compatible `/models` answers either the `{ object: "list", data }`
       envelope or a bare array of model entries. Both arrays are confirmed with Array.isArray
       below before use, and a body outside the contract (e.g. `null`) throws into the catch below,
       which answers with the default models. */
    const data = (await upstreamResp.json()) as { data?: ModelEntry[] } | ModelEntry[];
    // OpenAI /models returns { object: "list", data: [{ id, ... }] }
    // Map to our simpler format.
    const rawModels: ModelEntry[] = Array.isArray(data)
      ? data
      : Array.isArray(data.data)
        ? data.data
        : [];
    // `modelsResponse` drops a window that is not positive, so an upstream that sent none says none.
    const models = rawModels.map(({ id, context_window, owned_by }): AiModelInfo => {
      const model: AiModelInfo = { contextWindow: context_window || 0, id, name: id };
      if (owned_by !== undefined) {
        model.ownedBy = owned_by;
      }
      return model;
    });

    return modelsResponse({ models, configured: true, managed: false, providers: PROVIDERS });
  } catch (error) {
    // Network error → return defaults.
    const defaults = [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 }];
    return modelsResponse({
      models: defaults,
      configured: true,
      managed: false,
      providers: PROVIDERS,
      upstreamError: "network",
      upstreamMessage: errorMessage(error),
    });
  }
}

/**
 * The models route for the Anthropic family: the caller's own listing from `/v1/models`, or the
 * Claude defaults when there is no key or the listing failed, with the reason beside them exactly
 * as the OpenAI-compatible branch reports one. `defaultModel` is always set, because a client that
 * has chosen nothing must not fall back to an OpenAI model id here.
 */
async function anthropicModels(apiKey: string | null, baseUrl: string): Promise<Response> {
  const declared = { defaultModel: DEFAULT_ANTHROPIC_MODEL, managed: false, providers: PROVIDERS };
  if (!apiKey) {
    return modelsResponse({ ...declared, configured: false, models: ANTHROPIC_DEFAULTS });
  }
  const listing = await listAnthropicModels({ apiKey, baseUrl }, upstreamFetch);
  if (listing.ok) {
    return modelsResponse({ ...declared, configured: true, models: listing.models });
  }
  return modelsResponse({
    ...declared,
    configured: true,
    models: ANTHROPIC_DEFAULTS,
    upstreamError: listing.upstreamError,
    upstreamMessage: listing.message,
  });
}

// ─── Route handler ───────────────────────────────────────────────────────────

/**
 * Main handler for /__studio/ai/* requests.
 *
 * @returns Response if handled, null if route doesn't match
 */
export async function handleAiApi(req: Request, url: URL): Promise<Response | null> {
  const { pathname } = url;

  if (pathname === "/__studio/ai/chat" && req.method === "POST") {
    return handleChat(req);
  }

  if (pathname === "/__studio/ai/models" && req.method === "GET") {
    return handleModels(req);
  }

  return null;
}
