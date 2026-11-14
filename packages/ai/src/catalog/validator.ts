/**
 * Validator.ts — how a catalog checks a call's arguments against its member's schema (specs/ai.md
 * §3.10).
 *
 * A registry's own check knows required keys and primitive types. A member's schema says more: an
 * `enum`, a `pattern`, the shape of a nested object. Checking that takes a JSON Schema validator,
 * which is too much for this package to carry into a Worker, so a host supplies one in the shape
 * below and the catalog asks it. The shape is the one the Model Context Protocol's SDK asks a host
 * for, so one validator serves both.
 *
 * @module @jxsuite/ai/catalog
 * @license MIT
 */

import type { JsonObject } from "../core-types.ts";
import type { JSONSchema, ToolArguments } from "../tools.ts";

/** What a check came to: the arguments as the schema reads them, or the sentence saying what failed. */
export type ValidatorVerdict =
  | { readonly valid: true; readonly data: ToolArguments; readonly errorMessage?: undefined }
  | { readonly valid: false; readonly data?: undefined; readonly errorMessage: string };

/** Checks one call's arguments against the schema it was compiled from. */
export type ArgumentCheck = (input: ToolArguments) => ValidatorVerdict;

/** A JSON Schema 2020-12 validator, as a host supplies one. */
export interface Validator {
  /** The check for `schema`. Asked once per schema a host keeps, so it may compile. */
  getValidator: (schema: Readonly<JSONSchema> | JsonObject) => ArgumentCheck;
}

/**
 * A validator that compiles each schema once, by identity: asked again for the same schema object,
 * it answers the check it already built. For a host whose schemas are fixed objects; a schema that
 * is rebuilt, or that changes underneath its object, is compiled as often as it is asked for.
 *
 * @param {(schema: Readonly<JSONSchema> | JsonObject) => ArgumentCheck} compile - Builds the check
 *   for a schema, as the host's JSON Schema library does
 * @returns {Validator}
 */
export function cachedValidator(
  compile: (schema: Readonly<JSONSchema> | JsonObject) => ArgumentCheck,
): Validator {
  const compiled = new WeakMap<object, ArgumentCheck>();
  return {
    getValidator(schema) {
      let check = compiled.get(schema);
      if (!check) {
        check = compile(schema);
        compiled.set(schema, check);
      }
      return check;
    },
  };
}
