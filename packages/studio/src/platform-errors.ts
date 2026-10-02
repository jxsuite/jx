/**
 * Structured platform errors. Backend routes attach machine-readable fields to failures (e.g.
 * project creation blocked by missing GitHub App installation access → `code:
 * "needs_installation_access"` + `installUrl`); adapters preserve them on the thrown Error via
 * `Object.assign`, and UI surfaces recover them here to render actions (an install link) instead of
 * plain text.
 *
 * **RFC 9457 reconciles cleanly with this, because a problem's `type` IS the code.** A backend
 * answering `type: "https://jxsuite.com/problems/needs-installation-access"` is saying exactly what
 * `code: "needs_installation_access"` said; `problemSlug` derives the one from the other, and
 * `installUrl` is the extension member (RFC 9457 §3.2) that type documents. So this module reads
 * both, and every surface above it keeps branching on `code` without knowing which shape arrived.
 */

import { problemSlug } from "@jxsuite/protocol";
import type { OfferedAction, RetryHint } from "@jxsuite/protocol";

export interface PlatformErrorInfo {
  code?: string;
  installUrl?: string;
  /** What an `action-required` refusal offers the user (desktop.md §10.4). */
  actions?: OfferedAction[];
  /** That refusal's heading, in the backend's words. */
  heading?: string;
  /** What to do once one of its actions is done. */
  retry?: RetryHint;
}

const RETRY_HINTS = new Set<string>(["reload", "repeat", "none"]);

/**
 * The offered actions a wire value holds, each one checked: an action needs an `id` and a `label`
 * to be drawn at all, and anything else it carries is kept only when it has the right type. A
 * malformed entry is dropped rather than drawn as a button that does nothing.
 */
export function offeredActions(value: unknown): OfferedAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): OfferedAction[] => {
    const raw = entry as Partial<Record<keyof OfferedAction, unknown>> | null;
    if (
      !raw ||
      typeof raw.id !== "string" ||
      !raw.id ||
      typeof raw.label !== "string" ||
      !raw.label
    ) {
      return [];
    }
    return [
      {
        id: raw.id,
        label: raw.label,
        ...(typeof raw.href === "string" && raw.href ? { href: raw.href } : {}),
        ...(raw.primary === true ? { primary: true } : {}),
      },
    ];
  });
}

/** The retry hint a wire value names, or undefined when it names none we know. */
export function retryHint(value: unknown): RetryHint | undefined {
  return typeof value === "string" && RETRY_HINTS.has(value) ? (value as RetryHint) : undefined;
}

/**
 * The slug spelling of a code, so a hyphenated problem type and an underscored legacy code compare
 * equal. The two spellings exist because the type is a URI path segment and the code was a JS-ish
 * identifier; neither is worth migrating the other to while both are on the wire.
 */
function normalizeCode(value: string): string {
  return value.replaceAll("_", "-");
}

/** Machine-readable fields carried by a thrown platform error (empty object when none). */
export function platformErrorInfo(error: unknown): PlatformErrorInfo {
  if (!error || typeof error !== "object") {
    return {};
  }
  const { actions, code, heading, installUrl, retry, type } = error as {
    actions?: unknown;
    code?: unknown;
    heading?: unknown;
    installUrl?: unknown;
    retry?: unknown;
    type?: unknown;
  };
  const hint = retryHint(retry);
  // A problem type wins over a legacy code: it is the shape the backend is migrating toward.
  const derived = problemSlug(type) ?? (typeof code === "string" ? normalizeCode(code) : null);
  return {
    ...(derived === null ? {} : { code: derived }),
    ...(typeof installUrl === "string" ? { installUrl } : {}),
    ...(actions === undefined ? {} : { actions: offeredActions(actions) }),
    ...(typeof heading === "string" && heading ? { heading } : {}),
    ...(hint === undefined ? {} : { retry: hint }),
  };
}

/** The GitHub-App install link when the error is the structured needs-installation 403. */
export function installUrlOf(error: unknown): string | null {
  const info = platformErrorInfo(error);
  return info.code === "needs-installation-access" && info.installUrl ? info.installUrl : null;
}

/**
 * True when the error is an `action-required` refusal (HTTP 403, desktop.md §10.4) — whether the
 * backend sent the problem type or the legacy `action_required` code.
 */
export function isActionRequired(error: unknown): boolean {
  return platformErrorInfo(error).code === "action-required";
}
