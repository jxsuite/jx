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
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

export interface PlatformErrorInfo {
  code?: string;
  installUrl?: string;
  /** What an `action-required` refusal offers the user (desktop.md §10.4). */
  actions?: OfferedAction[];
  /** That refusal's heading, in the backend's words. */
  heading?: string;
  /** What to do once one of its actions is done. */
  retry?: RetryHint;
  /** The paths a `conflict` names: the files the remote changed that this side changed too. */
  conflicts?: string[];
}

const RETRY_HINTS = new Set<string>(["reload", "repeat", "none"]);

/**
 * The offered actions a wire value holds, each one checked: an action needs an `id` and a `label`
 * to be drawn at all, and anything else it carries is kept only when it has the right type. A
 * malformed entry is dropped rather than drawn as a button that does nothing.
 *
 * A typed `OfferedAction[]` is accepted too, and checked the same way: it is what a response body
 * cast to its protocol type holds, and nothing has verified that cast.
 */
export function offeredActions(
  value: JsonValue | readonly OfferedAction[] | undefined,
): OfferedAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: readonly (JsonValue | OfferedAction)[] = value;
  return entries.flatMap((entry): OfferedAction[] => {
    if (!isJsonObject(entry)) {
      return [];
    }
    const { href, id, label, primary } = entry;
    if (!isString(id) || !id || !isString(label) || !label) {
      return [];
    }
    const action: OfferedAction = { id, label };
    if (isString(href) && href) {
      action.href = href;
    }
    if (primary === true) {
      action.primary = true;
    }
    return [action];
  });
}

/** Whether a value names one of the retry hints this client knows. */
function isRetryHint(value: JsonValue | undefined): value is RetryHint {
  return isString(value) && RETRY_HINTS.has(value);
}

/** The retry hint a wire value names, or undefined when it names none we know. */
export function retryHint(value: JsonValue | undefined): RetryHint | undefined {
  return isRetryHint(value) ? value : undefined;
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
export function platformErrorInfo(cause: unknown): PlatformErrorInfo {
  /* An Error carrying the members an adapter assigned onto it passes as a JSON object here: every
     member below is read through a check that accepts any value, so nothing trusts that typing. */
  if (!isJsonObject(cause)) {
    return {};
  }
  const { actions, code, conflicts, heading, installUrl, retry, type } = cause;
  const info: PlatformErrorInfo = {};
  // A problem type wins over a legacy code: it is the shape the backend is migrating toward.
  const derived = problemSlug(type) ?? (isString(code) ? normalizeCode(code) : null);
  if (derived !== null) {
    info.code = derived;
  }
  if (isString(installUrl)) {
    info.installUrl = installUrl;
  }
  if (actions !== undefined) {
    info.actions = offeredActions(actions);
  }
  if (isString(heading) && heading) {
    info.heading = heading;
  }
  if (isRetryHint(retry)) {
    info.retry = retry;
  }
  if (Array.isArray(conflicts)) {
    info.conflicts = conflicts.filter((path) => isString(path));
  }
  return info;
}

/**
 * The files a refused publish overlaps on the remote, when the error is that refusal: a pull or a
 * commit the remote has moved under, whose changes touch the same paths (`pull_conflict`, or the
 * `conflict` problem type carrying `conflicts`). Null for every other failure.
 */
export function remoteConflictsOf(cause: unknown): string[] | null {
  const info = platformErrorInfo(cause);
  const conflicting = info.code === "pull-conflict" || info.code === "conflict";
  return conflicting && info.conflicts ? info.conflicts : null;
}

/** The GitHub-App install link when the error is the structured needs-installation 403. */
export function installUrlOf(cause: unknown): string | null {
  const info = platformErrorInfo(cause);
  return info.code === "needs-installation-access" && info.installUrl ? info.installUrl : null;
}

/**
 * True when the error is an `action-required` refusal (HTTP 403, desktop.md §10.4) — whether the
 * backend sent the problem type or the legacy `action_required` code.
 */
export function isActionRequired(cause: unknown): boolean {
  return platformErrorInfo(cause).code === "action-required";
}
