/**
 * Context resolver — generic `#/$context/<pointer>` resolution over the project config
 * (specs/extensions.md §9.1).
 *
 * Pointers walk the project config segment by segment. `{@param}` segments substitute values from a
 * caller-provided scope (e.g. the form's current value record), and the `$formats` virtual root
 * resolves to the registered format names instead of a project.json key.
 */

import { isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, ProjectConfig } from "@jxsuite/schema/types";

/** Options for {@link resolveContextPointer}. */
export interface ResolveContextOptions {
  /** The project configuration object the pointer walks over. */
  projectConfig: ProjectConfig;
  /** Scope record supplying `{@param}` substitutions (e.g. the enclosing form value). */
  scope?: JsonObject | undefined;
  /** Registered formats backing the `$formats` virtual root. */
  formats?: { name: string }[] | undefined;
}

/** Matches a `{@param}` pointer segment, capturing the param name. */
const PARAM_SEGMENT = /^\{@(\w+)\}$/;

/**
 * Resolve a `#/$context/<seg>/<seg>…` pointer.
 *
 * - `{@param}` segments substitute from `opts.scope`; an unresolvable param yields `undefined`.
 * - The `$formats` virtual root returns the format names from `opts.formats`.
 * - Every other pointer is a plain JSON-pointer walk over `opts.projectConfig` — no key is
 *   special-cased, so both legacy (`contentTypes`) and newer (`content`) sections resolve alike.
 *
 * @param {string} pointer
 * @param {ResolveContextOptions} opts
 * @returns {JsonValue | undefined} The resolved value, or `undefined` when the pointer does not
 *   resolve.
 */
export function resolveContextPointer(
  pointer: string,
  opts: ResolveContextOptions,
): JsonValue | undefined {
  if (!pointer.startsWith("#/$context/")) {
    return undefined;
  }

  const segments: string[] = [];
  for (const raw of pointer.slice("#/$context/".length).split("/")) {
    const match = raw.match(PARAM_SEGMENT);
    if (match) {
      const value = opts.scope?.[match[1]!];
      if (!isString(value) && !isNumber(value)) {
        return undefined;
      }
      const substituted = String(value);
      if (!substituted) {
        return undefined;
      }
      segments.push(substituted);
    } else {
      segments.push(raw);
    }
  }

  if (segments[0] === "$formats") {
    if (segments.length !== 1) {
      return undefined;
    }
    return (opts.formats ?? []).map((format) => format.name);
  }

  /* SAFETY: the project config is parsed project.json, so every value under it is JSON;
     ProjectConfig is the typed reading of that same object. */
  let node: JsonValue | undefined = opts.projectConfig as JsonObject;
  for (const segment of segments) {
    if (!isNonNullObject(node)) {
      return undefined;
    }
    /* SAFETY: node is a JSON object or array, and a pointer segment reads an array by its own
       Index (and `length`) keys exactly as it reads an object's members, so the object view of
       an array addresses the same values. */
    node = (node as JsonObject)[segment];
  }
  return node;
}
