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

export interface PlatformErrorInfo {
  code?: string;
  installUrl?: string;
  /** Where a `subscription-required` refusal says the plan can be started. */
  upgradeUrl?: string;
  /** Whether that plan still offers this user a free trial. */
  trialAvailable?: boolean;
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
  const { code, installUrl, trialAvailable, type, upgradeUrl } = error as {
    code?: unknown;
    installUrl?: unknown;
    trialAvailable?: unknown;
    type?: unknown;
    upgradeUrl?: unknown;
  };
  // A problem type wins over a legacy code: it is the shape the backend is migrating toward.
  const derived = problemSlug(type) ?? (typeof code === "string" ? normalizeCode(code) : null);
  return {
    ...(derived === null ? {} : { code: derived }),
    ...(typeof installUrl === "string" ? { installUrl } : {}),
    ...(typeof upgradeUrl === "string" ? { upgradeUrl } : {}),
    ...(typeof trialAvailable === "boolean" ? { trialAvailable } : {}),
  };
}

/** The GitHub-App install link when the error is the structured needs-installation 403. */
export function installUrlOf(error: unknown): string | null {
  const info = platformErrorInfo(error);
  return info.code === "needs-installation-access" && info.installUrl ? info.installUrl : null;
}

/**
 * True when the error is a hosted plan's refusal (`subscription-required`, HTTP 402) — whether the
 * backend sent the problem type or the legacy `subscription_required` code.
 */
export function isSubscriptionRequired(error: unknown): boolean {
  return platformErrorInfo(error).code === "subscription-required";
}
