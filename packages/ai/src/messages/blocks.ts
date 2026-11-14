/**
 * Blocks.ts — whether a parsed value is a block of the neutral conversation model.
 *
 * Two readers take blocks from outside the program: the gateway, from a version 2 chat body
 * (specs/ai.md §2.7), and a session store, from a saved conversation (§3.13). Both ask this one
 * function, so a block one accepts is a block the other does.
 *
 * @module @jxsuite/ai/messages
 * @license MIT
 */

import type { JsonObject, JsonValue } from "../core-types.ts";
import type { Block } from "./types.ts";

/** The provider families a block may name. */
const FAMILIES: ReadonlySet<string> = new Set(["openai-compat", "anthropic"]);

/**
 * True when a parsed value is a JSON object.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when a parsed value is a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/**
 * True when a parsed value is absent or a string.
 *
 * @param {JsonValue | undefined} value
 * @returns {boolean}
 */
function isOptionalString(value: JsonValue | undefined): boolean {
  return value === undefined || isString(value);
}

/**
 * The first member of `block` that is not what its `type` requires, as a path under the block, or
 * null when the block is well formed.
 *
 * @param {JsonValue} block - One entry of a message's `blocks`
 * @returns {string | null}
 */
export function checkBlock(block: JsonValue): string | null {
  if (!isObject(block)) {
    return "";
  }
  switch (block.type) {
    case "text": {
      return isString(block.text) ? null : "/text";
    }
    case "reasoning": {
      if (!isString(block.text)) {
        return "/text";
      }
      if (!isOptionalString(block.signature)) {
        return "/signature";
      }
      if (!isOptionalString(block.redacted)) {
        return "/redacted";
      }
      const { provenance } = block;
      if (provenance === undefined) {
        return null;
      }
      if (!isObject(provenance)) {
        return "/provenance";
      }
      if (!isString(provenance.family) || !FAMILIES.has(provenance.family)) {
        return "/provenance/family";
      }
      if (provenance.model !== null && !isString(provenance.model)) {
        return "/provenance/model";
      }
      return isOptionalString(provenance.binding) ? null : "/provenance/binding";
    }
    case "tool_call": {
      for (const key of ["id", "name", "argumentsText"]) {
        if (!isString(block[key])) {
          return `/${key}`;
        }
      }
      return isOptionalString(block.signature) ? null : "/signature";
    }
    case "tool_result": {
      if (!isString(block.callId)) {
        return "/callId";
      }
      if (block.isError !== true && block.isError !== false) {
        return "/isError";
      }
      return isString(block.content) ? null : "/content";
    }
    case "opaque": {
      if (!isString(block.family) || !FAMILIES.has(block.family)) {
        return "/family";
      }
      return block.data === undefined ? "/data" : null;
    }
    default: {
      return "/type";
    }
  }
}

/**
 * True when a value read from outside the program is a well-formed block.
 *
 * @param {unknown} value - One entry of a stored message's `blocks`
 * @returns {boolean}
 */
export function isBlock(value: unknown): value is Block {
  /* SAFETY: every caller's value came out of JSON.parse, so it is a JSON value; `checkBlock` reads
     it as one and checks each member before the claim is made. */
  return checkBlock(value as JsonValue) === null;
}
