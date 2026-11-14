/**
 * Digest.ts — a stable identity for a JSON value.
 *
 * Two parts of a turn need to ask "is this the same as before": a checkpoint, which may only be
 * resumed against the tools, policy and system prompt it was taken under (specs/ai.md §3.12), and a
 * provider that binds its output to the request that produced it. Both compare a short digest of
 * the value's canonical JSON rather than the value.
 *
 * The digest is identity, not security: FNV-1a tells two honest values apart and resists nothing.
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type { JsonObject, JsonValue } from "../core-types.ts";

/**
 * True when a JSON value is an object whose members may be walked.
 *
 * @param {JsonValue} value
 * @returns {boolean}
 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A JSON value with every object's keys in code-unit order, at every depth.
 *
 * @param {JsonValue} value
 * @returns {JsonValue}
 */
function sorted(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sorted(entry));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const out: JsonObject = {};
  for (const key of Object.keys(value).toSorted()) {
    out[key] = sorted(value[key]!);
  }
  return out;
}

/**
 * A value's canonical JSON: object keys sorted at every depth, no whitespace, and whatever JSON
 * itself drops (an `undefined` member, a function) dropped. Two values that serialize to the same
 * data serialize to the same text, whatever order their members were written in.
 *
 * @param {Value} value - Anything `JSON.stringify` accepts
 * @returns {string}
 */
export function canonicalJson<Value>(value: Value): string {
  /* Wrapped, so a value with no JSON of its own (a function, `undefined`) is an absent member
     rather than no text at all, and is said as null: it still has a digest.
     SAFETY: the text is JSON.stringify's own output for an object, so parsing it yields an object
     whose `value` member, when present, is a JSON value. */
  // oxlint-disable-next-line unicorn/prefer-structured-clone -- the JSON form is the point
  const wrapped = JSON.parse(JSON.stringify({ value })) as { readonly value?: JsonValue };
  return JSON.stringify(sorted(wrapped.value ?? null));
}

/** FNV-1a's 64-bit offset basis and prime. */
const FNV_OFFSET = 0xcb_f2_9c_e4_84_22_23_25n;
const FNV_PRIME = 0x1_00_00_00_01_b3n;
const MASK_64 = 0xff_ff_ff_ff_ff_ff_ff_ffn;

/**
 * A short identity for a value: `f1:` and the 64-bit FNV-1a hash of its canonical JSON, in hex. The
 * prefix names the scheme, so a later one can be told from this.
 *
 * @param {Value} value - Anything `JSON.stringify` accepts
 * @returns {string}
 */
export function digest<Value>(value: Value): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(canonicalJson(value))) {
    // oxlint-disable-next-line no-bitwise -- FNV-1a IS an xor and a multiply, kept to 64 bits
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return `f1:${hash.toString(16).padStart(16, "0")}`;
}
