/**
 * Display formatting for live expression-preview values, shared by the parent-side snapshot
 * evaluator (services/preview-eval.ts) and the in-iframe live evaluator (canvas/iframe-eval.ts) so
 * both realms badge values with identical truncation rules. Dependency-light and DOM-free (the
 * strip-events pattern) so importing it never grows the iframe bundle.
 */

import type { JsonPrimitive } from "@jxsuite/schema/types";

const MAX_BADGE_LENGTH = 48;

/**
 * A value an expression evaluated to, as a badge has to show it: JSON from state, a bigint or
 * symbol a helper returned, a function, and arrays and records of those. A record can be cyclic,
 * and a bigint cannot be stringified at all, which is why formatting falls back to `String()`.
 */
export type PreviewValue =
  | JsonPrimitive
  | undefined
  | bigint
  | symbol
  | ((...args: never[]) => void)
  | PreviewValue[]
  | PreviewRecord;

/** An object an expression evaluated to, read key by key. */
export interface PreviewRecord {
  [key: string]: PreviewValue;
}

/** Format a runtime value as a short badge string. */
export function formatPreviewValue(value?: PreviewValue): string {
  if (value === undefined) {
    return "undefined";
  }
  let text: string;
  try {
    // SAFETY: lib.d.ts declares a string, but JSON.stringify answers undefined for a function or a symbol.
    const json = JSON.stringify(value) as string | undefined;
    text = json ?? "undefined";
  } catch {
    text = String(value);
  }
  if (text.length > MAX_BADGE_LENGTH) {
    text = `${text.slice(0, MAX_BADGE_LENGTH - 1)}…`;
  }
  return text;
}
