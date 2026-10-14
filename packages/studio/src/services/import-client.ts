/**
 * Shared client for the /__studio/import-site NDJSON stream. Every platform's importSite is "a
 * streaming fetch to some URL" — the dev server posts to its own origin, the desktop platforms post
 * to their token-gated loopback servers — so the request/parse/settle logic lives here once.
 *
 * The endpoint emits one JSON object per line: `progress` lines (forwarded to onProgress), a
 * `ready` line the moment the destination is an openable project (forwarded to onReady),
 * `heartbeat` keep-alives (ignored), and a terminal `done` ({root, config, result}) or `error`
 * line. `result` is optional — a backend that does not send one is not broken, and every caller
 * treats its absence as "the run happened, and it did not say what it found". `ready` is optional
 * for the same reason: an older backend simply never sends one, and the caller opens the project at
 * the end as it always did.
 */

import type {
  ImportProgressEvent,
  ImportReadyEvent,
  ImportSiteOptions,
  ImportSiteSummary,
} from "../types";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { ProjectConfig } from "@jxsuite/schema/types";

/**
 * The `phase` of the one progress line this client emits itself rather than forwarding.
 *
 * Exported so a caller can recognize it without matching a bare string: the import log renders
 * every phase verbatim, but a warning also needs to outlive the log, which vanishes the moment a
 * successful import hands off to the new project.
 */
export const IMPORT_WARNING_PHASE = "warning";

/** The request headers: JSON, plus the caller's AI credentials when it has them. */
interface ImportRequestHeaders {
  "Content-Type": string;
  "X-Api-Key"?: string;
  "X-Api-Base-URL"?: string;
}

/** The JSON body the import-site route reads; `model` travels as `aiModel`. */
interface ImportRequestBody {
  url: string;
  directory: string;
  depth: number;
  maxPages: number;
  aiComponents: boolean;
  breakpoints?: ImportSiteOptions["breakpoints"];
  aiModel?: ImportSiteOptions["model"];
  verify?: boolean;
  verifyThreshold?: number;
  verifyMinFidelity?: number;
}

/** What a `done` line settles the stream with. */
export interface ImportStreamResult {
  root: string;
  config: ProjectConfig;
  result?: ImportSiteSummary;
}

interface StreamLine {
  type: string;
  phase?: string;
  message?: string;
  current?: number;
  total?: number;
  root?: string;
  config?: ProjectConfig;
  result?: ImportSiteSummary;
  error?: string;
}

/**
 * POST an import request and consume its NDJSON progress stream.
 *
 * @param {string} endpoint — the platform's import-site URL (may carry an auth token)
 * @param {ImportSiteOptions} opts — the import request; `apiKey`/`baseUrl` travel as headers
 * @param {(evt: ImportProgressEvent) => void} onProgress
 * @param {AbortSignal} [signal]
 * @param {(evt: ImportReadyEvent) => void} [onReady] — fires once, as soon as the destination holds
 *   an openable project. Minutes before `done` on a real crawl, which is the whole reason it
 *   exists.
 */
export async function streamImport(
  endpoint: string,
  opts: ImportSiteOptions,
  onProgress: (evt: ImportProgressEvent) => void,
  signal?: AbortSignal,
  onReady?: (evt: ImportReadyEvent) => void,
): Promise<ImportStreamResult> {
  const headers: ImportRequestHeaders = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["X-Api-Key"] = opts.apiKey;
  }
  if (opts.baseUrl) {
    headers["X-Api-Base-URL"] = opts.baseUrl;
  }

  const request: ImportRequestBody = {
    url: opts.url,
    directory: opts.directory,
    depth: opts.depth,
    maxPages: opts.maxPages,
    aiComponents: opts.aiComponents,
  };
  if (opts.breakpoints !== undefined) {
    request.breakpoints = opts.breakpoints;
  }
  if (opts.model !== undefined) {
    request.aiModel = opts.model;
  }
  if (opts.verify !== undefined) {
    request.verify = opts.verify;
  }
  if (opts.verifyThreshold !== undefined) {
    request.verifyThreshold = opts.verifyThreshold;
  }
  if (opts.verifyMinFidelity !== undefined) {
    request.verifyMinFidelity = opts.verifyMinFidelity;
  }
  // The spread is a plain record copy: an interface is not assignable to the `HeadersInit` record.
  const init: RequestInit = {
    body: JSON.stringify(request),
    headers: { ...headers },
    method: "POST",
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const res = await fetch(endpoint, init);

  if (!res.ok) {
    let message = `Import failed (${res.status})`;
    try {
      const body: unknown = await res.json();
      // `new Error()` stringifies a non-string message, so String() keeps any `error` value's text.
      if (isJsonObject(body) && body.error) {
        message = String(body.error);
      }
    } catch {
      /* Non-JSON error body — keep the status message. */
    }
    throw new Error(message);
  }
  if (!res.body) {
    throw new Error("Import stream had no response body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ImportStreamResult | null = null;
  /*
   * Lines the parser could not read. Tolerating one is right — an import that ran for two minutes
   * should not die on a garbled progress line — but doing it *silently* is not: the import then
   * finishes looking clean while the user never sees the pages it skipped. Counted here and
   * surfaced once at the end, so the tolerance stays visible instead of becoming a hiding place.
   */
  let unreadable = 0;

  /** Apply one line; a `done` line's result is returned for the read loop to keep. */
  const handleLine = (line: string): ImportStreamResult | undefined => {
    const trimmed = line.trim();
    if (!trimmed) {
      return undefined;
    }
    let parsed: StreamLine;
    try {
      /* SAFETY: the import-site route writes every line as JSON.stringify of one stream line
         object with a string `type`, and every other member is optional; each branch below
         compares `type` to a literal and checks the members it reads before using them. */
      parsed = JSON.parse(trimmed) as StreamLine;
    } catch {
      unreadable += 1;
      return undefined; // Tolerate a mangled line rather than killing the whole import.
    }
    if (parsed.type === "progress") {
      const progress: ImportProgressEvent = {
        phase: parsed.phase ?? "",
        message: parsed.message ?? "",
      };
      if (parsed.current !== undefined) {
        progress.current = parsed.current;
      }
      if (parsed.total !== undefined) {
        progress.total = parsed.total;
      }
      onProgress(progress);
    } else if (parsed.type === "ready" && parsed.root !== undefined) {
      onReady?.({ root: parsed.root });
    } else if (parsed.type === "done" && parsed.root !== undefined && parsed.config) {
      const settled: ImportStreamResult = { root: parsed.root, config: parsed.config };
      if (parsed.result !== undefined) {
        settled.result = parsed.result;
      }
      return settled;
    } else if (parsed.type === "error") {
      throw new Error(parsed.error || "Import failed");
    }
    // Heartbeats and unknown line types are ignored.
    return undefined;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      // Lines can split across chunks: keep the trailing partial in the buffer.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        result = handleLine(line) ?? result;
      }
    }
    result = handleLine(buffer) ?? result;
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* The stream is already closed (e.g. after an abort). */
    }
  }

  if (unreadable > 0) {
    onProgress({
      message:
        `${unreadable} progress line${unreadable === 1 ? "" : "s"} could not be read and ` +
        `${unreadable === 1 ? "was" : "were"} skipped — the import may be missing steps.`,
      phase: IMPORT_WARNING_PHASE,
    });
  }

  if (!result) {
    throw new Error("Import stream ended without a result");
  }
  return result;
}
