/**
 * Argument-validator.ts — the JSON Schema 2020-12 validator Studio's tool catalog checks a call's
 * arguments with (specs/ai.md §3.10).
 *
 * The registry's own check knows required keys and primitive types; this adds what a tool's schema
 * says beyond them: an `enum`, a `pattern`, the shape of a nested argument. It is ajv, the
 * validator documents are already checked with (`jx-validate.ts`), loaded the same lazy way so the
 * shell does not wait on it.
 *
 * **It coerces as the registry does.** A number written as a string has always been accepted for a
 * numeric argument, because models write one, and the tools that take an index coerce it
 * themselves. So this validator runs with type coercion, on a copy of the arguments: it may only
 * refuse what the schema refuses, never what the registry has always let through, and the tool
 * still receives exactly what the model sent.
 *
 * @license MIT
 */

import type { ArgumentCheck, Validator } from "@jxsuite/ai/catalog";
import type { JSONSchema, ToolArguments } from "@jxsuite/ai/tools";
import type { JsonObject } from "@jxsuite/schema/types";

/** One violation, as a schema library reports it: where, which keyword, and what it required. */
export interface SchemaViolation {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message?: string;
  readonly params: JsonObject;
}

/** A schema, compiled: answers whether arguments match, and keeps what the last ones violated. */
export interface CompiledSchema {
  (data: ToolArguments): boolean;
  errors?: readonly SchemaViolation[] | null;
}

/** All this module asks of a schema library: ajv is one. */
export interface SchemaCompiler {
  compile: (schema: Readonly<JSONSchema> | JsonObject) => CompiledSchema;
}

/** The arguments are valid as far as this validator can say: it is not loaded, or cannot compile. */
const UNCHECKED: ArgumentCheck = (input) => ({ data: input, valid: true });

/** The sentence for a schema violation: where, and what the schema required there. */
function sentenceOf(errors: readonly SchemaViolation[] | null | undefined): string {
  const [first] = errors ?? [];
  if (!first) {
    return "The arguments do not match the tool's schema.";
  }
  const where = first.instancePath ? `Argument at "${first.instancePath}"` : "The call";
  const allowed = first.keyword === "enum" ? `: ${JSON.stringify(first.params.allowedValues)}` : "";
  return `${where} ${first.message ?? "does not match the tool's schema"}${allowed}`;
}

/**
 * A validator over ajv, usable at once and checking once ajv has loaded. Until then, and for a
 * schema ajv cannot compile, every call passes: the registry's own check still ran, and a missing
 * validator must never be what refuses a call.
 *
 * @param {() => Promise<SchemaCompiler>} [load] - Loads and configures ajv; a test supplies its own
 * @returns {Validator & { readonly ready: Promise<void> }}
 */
export function createArgumentValidator(
  load: () => Promise<SchemaCompiler> = loadAjv,
): Validator & { readonly ready: Promise<void> } {
  let ajv: SchemaCompiler | null = null;
  const ready = load().then(
    (loaded) => {
      ajv = loaded;
    },
    () => {
      // Ajv is an optional peer: without it, arguments meet the registry's own check alone.
    },
  );
  return {
    getValidator(schema) {
      let compiled: CompiledSchema | null | undefined;
      return (input) => {
        if (!ajv) {
          return UNCHECKED(input);
        }
        if (compiled === undefined) {
          try {
            compiled = ajv.compile(schema);
          } catch {
            compiled = null;
          }
        }
        if (compiled === null) {
          return UNCHECKED(input);
        }
        // A copy: coercion rewrites what it reads, and the tool is owed what the model sent.
        return compiled(structuredClone(input))
          ? { data: input, valid: true }
          : { errorMessage: sentenceOf(compiled.errors), valid: false };
      };
    },
    ready,
  };
}

/** Ajv for draft 2020-12, coercing types as the registry's own check does. */
async function loadAjv(): Promise<SchemaCompiler> {
  const { default: Ajv } = await import("ajv/dist/2020.js");
  return new Ajv({ allErrors: false, coerceTypes: true, strict: false });
}
