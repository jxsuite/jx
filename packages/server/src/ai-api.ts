/**
 * Ai-api.js — AI proxy endpoints for Jx Studio
 *
 * Handles /__studio/ai/chat (SSE streaming proxy to OpenAI) and /__studio/ai/models.
 * The server acts as a thin proxy: validates the request shape, forwards to OpenAI,
 * normalizes the SSE stream into StreamEvent-compatible format, and pipes back.
 *
 * The wire half of that (reading the body, the upstream request, the stream normalizer, the SSE
 * framing, the problem responses) is `@jxsuite/ai/gateway`, which every backend serving these
 * routes can share. What stays here is this server's POLICY, which no other host shares:
 *
 * API key flow:
 *   1. Request header X-Api-Key or Authorization: Bearer <key>
 *   2. Fallback: OPENAI_API_KEY env var — attached ONLY to the env/default base URL, never to a
 *      caller-supplied X-Api-Base-URL (prevents exfiltrating the server key to a chosen endpoint)
 *   3. If neither → 401 with error message
 *
 * Base URL flow:
 *   1. Request header X-Api-Base-URL — allowed only alongside a header API key
 *   2. Fallback: OPENAI_BASE_URL env var
 *   3. Default: https://api.openai.com/v1
 *   A base URL resolving to a cloud metadata / link-local host is refused (SSRF defense).
 *
 * The model catalogue for /models is this server's too: its defaults, and how it reads the
 * upstream's own listing.
 *
 * @license MIT
 */
import {
  createChatHandler,
  extractUpstreamErrorMessage,
  modelsResponse,
  problemResponse,
} from "@jxsuite/ai/gateway";
import type { GatewayRefusal, Upstream } from "@jxsuite/ai/gateway";
import { problemDetails } from "@jxsuite/protocol";
import { problemTypeForStatus } from "./problem.ts";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** The model a chat request that names none is forwarded with. */
const DEFAULT_MODEL = "gpt-4o";

/** A model entry from the upstream `/models` listing. */
interface ModelEntry {
  id: string;
  context_window?: number;
  owned_by?: string;
}

/**
 * SSRF defense: refuse to proxy to a cloud metadata endpoint or a link-local host. Loopback and
 * private-LAN hosts are intentionally allowed — self-hosted / local LLMs run there. An unparseable
 * base URL is blocked. `169.254.169.254` (the AWS/GCP/Azure metadata IP) lives in the link-local
 * `169.254.0.0/16` range, which is the primary thing this stops.
 */
function isBlockedHost(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return true;
  }
  const h = host.startsWith("[") ? host.slice(1, -1) : host;
  if (h === "metadata.google.internal") {
    return true;
  }
  if (h.startsWith("169.254.")) {
    return true; // IPv4 link-local, incl. the cloud metadata IP
  }
  if (h.startsWith("fe80:")) {
    return true; // IPv6 link-local
  }
  return false;
}

interface AiConfig {
  apiKey: string | null;
  baseUrl: string;
  missingKey: boolean;
  reject?: { status: number; message: string };
}

function getConfig(req: Request): AiConfig {
  const authHeader = req.headers.get("Authorization") || "";
  const apiKeyHeader = req.headers.get("X-Api-Key") || "";
  const baseUrlHeader = req.headers.get("X-Api-Base-URL") || "";

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
  const baseUrl = baseUrlHeader || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;

  if (isBlockedHost(baseUrl)) {
    return {
      apiKey: null,
      baseUrl,
      missingKey: true,
      reject: { status: 403, message: "Base URL host is not permitted." },
    };
  }

  // A caller-supplied base URL requires a caller-supplied key. Refuse to forward the env
  // OPENAI_API_KEY to an endpoint the request chose.
  if (baseFromHeader && !keyFromHeader) {
    return {
      apiKey: null,
      baseUrl,
      missingKey: true,
      reject: {
        status: 401,
        message: "A custom base URL requires an explicit API key (X-Api-Key).",
      },
    };
  }

  // Env key is only ever attached to the env/default base URL.
  if (!apiKey && process.env.OPENAI_API_KEY) {
    apiKey = process.env.OPENAI_API_KEY;
  }

  return { apiKey, baseUrl, missingKey: !apiKey };
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
 * applied per request (the environment is read each time, so a key set later is honoured).
 */
function resolveUpstream(req: Request): Upstream | GatewayRefusal {
  const { apiKey, baseUrl, reject } = getConfig(req);
  if (reject) {
    return refuse(reject.status, reject.message);
  }
  if (!apiKey) {
    return refuse(
      401,
      "No API key configured. Set OPENAI_API_KEY env var or send X-Api-Key header.",
    );
  }
  return { apiKey, baseUrl, defaultModel: DEFAULT_MODEL, family: "openai-compat", managed: false };
}

// ─── /__studio/ai/chat — SSE streaming proxy ───────────────────────────────

const chatHandler = createChatHandler<{ readonly signal: AbortSignal }>({
  resolveUpstream: (request) => resolveUpstream(request),
});

/** Handle POST /__studio/ai/chat — proxy chat completions to OpenAI via SSE. */
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
  const { apiKey, baseUrl, missingKey, reject } = getConfig(req);
  if (reject) {
    return problemResponse(refuse(reject.status, reject.message));
  }

  // No key available → return hardcoded defaults so the UI can at least render.
  if (missingKey) {
    const defaults = [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 },
      { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1_000_000 },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1_000_000 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128_000 },
    ];
    return modelsResponse({ models: defaults, configured: false, managed: false });
  }

  // Key is available — proxy to the upstream /models endpoint.
  try {
    const upstreamUrl = `${baseUrl}/models`;
    const upstreamResp = await fetch(upstreamUrl, {
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
        upstreamError: upstreamResp.status,
        upstreamMessage,
      });
    }

    const data = (await upstreamResp.json()) as { data?: ModelEntry[] } | ModelEntry[];
    // OpenAI /models returns { object: "list", data: [{ id, ... }] }
    // Map to our simpler format.
    const rawModels: ModelEntry[] = Array.isArray(data)
      ? data
      : Array.isArray(data.data)
        ? data.data
        : [];
    const models = rawModels.map(({ id, context_window, owned_by }) => ({
      id,
      name: id,
      contextWindow: context_window || 0,
      ownedBy: owned_by,
    }));

    return modelsResponse({ models, configured: true, managed: false });
  } catch (error) {
    // Network error → return defaults.
    const defaults = [{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 }];
    return modelsResponse({
      models: defaults,
      configured: true,
      managed: false,
      upstreamError: "network",
      upstreamMessage: (error as Error).message,
    });
  }
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
