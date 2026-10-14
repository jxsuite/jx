/// <reference lib="dom" />
/**
 * Agent-seed.ts — cross-window handoff of a pending AI assistant prompt.
 *
 * The New Project flow stores the user's project brief here; the Studio window that opens the
 * project consumes it and seeds the Assistant tab. localStorage (not module state) is deliberate:
 * on desktop the new project opens in a NEW window, and the per-root localStorage key is the
 * cross-window channel (precedent: the chat-history key `jx-ai-chat-history:<root>`).
 *
 * @license MIT
 */

import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

const PENDING_PROMPT_PREFIX = "jx.ai.pendingAgentPrompt";

/** Entries older than this are considered stale and dropped on read. */
const MAX_AGE_MS = 15 * 60 * 1000;

/** `localStorage`, or `undefined` on a host that has none (a worker, a test run without a DOM). */
function storage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function storageKey(root: string) {
  return `${PENDING_PROMPT_PREFIX}:${root}`;
}

/**
 * Read the pending entry for a project root, dropping stale or malformed entries.
 *
 * @param {string} root
 * @returns {{ prompt: string; ts: number } | null}
 */
function readEntry(root: string): { prompt: string; ts: number } | null {
  try {
    const raw = storage()?.getItem(storageKey(root));
    if (!raw) {
      return null;
    }
    // SAFETY: `JSON.parse` without a reviver yields nothing but JSON values.
    const parsed = JSON.parse(raw) as JsonValue;
    if (parsed === null) {
      /* A stored JSON `null` reads as "no entry" but is left in place rather than dropped as
         malformed, matching how this reader has always treated it. */
      return null;
    }
    const prompt = isJsonObject(parsed) ? parsed.prompt : undefined;
    const ts = isJsonObject(parsed) ? parsed.ts : undefined;
    if (!isString(prompt) || !isNumber(ts) || !(Date.now() - ts <= MAX_AGE_MS)) {
      // Stale or malformed — remove so it never seeds a later session.
      storage()?.removeItem(storageKey(root));
      return null;
    }
    return { prompt, ts };
  } catch {
    return null;
  }
}

/**
 * Store a pending assistant prompt for the project at `root`.
 *
 * @param {string} root
 * @param {string} prompt
 */
export function setPendingAgentPrompt(root: string, prompt: string): void {
  try {
    storage()?.setItem(storageKey(root), JSON.stringify({ prompt, ts: Date.now() }));
  } catch {
    /* LocalStorage unavailable — the prompt is simply not handed off. */
  }
}

/**
 * Whether a fresh (younger than 15 min) pending prompt exists for `root`.
 *
 * @param {string} root
 */
export function hasPendingAgentPrompt(root: string): boolean {
  return readEntry(root) !== null;
}

/**
 * Read AND delete the pending prompt for `root` (consume-on-read keeps repeated renders
 * idempotent). Returns null when there is no fresh entry.
 *
 * @param {string} root
 * @returns {string | null}
 */
export function consumePendingAgentPrompt(root: string): string | null {
  const entry = readEntry(root);
  if (!entry) {
    return null;
  }
  try {
    storage()?.removeItem(storageKey(root));
  } catch {
    /* LocalStorage unavailable — nothing to delete. */
  }
  return entry.prompt;
}
