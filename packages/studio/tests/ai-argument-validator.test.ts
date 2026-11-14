/**
 * Studio's argument validator (specs/ai.md §3.10): ajv for JSON Schema 2020-12, checking what a
 * tool's schema says beyond the registry's own check, and coercing as that check does so it only
 * ever refuses what the schema refuses.
 */
import { describe, expect, test } from "bun:test";
import type { JSONSchema } from "@jxsuite/ai/tools";
import { createArgumentValidator } from "../src/services/harness/argument-validator";
import type { CompiledSchema, SchemaCompiler } from "../src/services/harness/argument-validator";

const SCHEMA: JSONSchema = {
  properties: {
    index: { type: "integer" },
    mode: { enum: ["design", "code"], type: "string" },
    node: {
      properties: { tagName: { pattern: "^[a-z][a-z0-9-]*$", type: "string" } },
      required: ["tagName"],
      type: "object",
    },
  },
  required: [],
  type: "object",
};

describe("createArgumentValidator", () => {
  test("accepts what the schema accepts, and hands back the arguments it was given", async () => {
    const validator = createArgumentValidator();
    await validator.ready;
    const check = validator.getValidator(SCHEMA);
    const args = { index: 2, mode: "code", node: { tagName: "my-card" } };
    expect(check(args)).toEqual({ data: args, valid: true });
    expect(check({})).toEqual({ data: {}, valid: true });
  });

  test("refuses an enum, a pattern and a nested shape the registry's own check lets through", async () => {
    const validator = createArgumentValidator();
    await validator.ready;
    const check = validator.getValidator(SCHEMA);
    expect(check({ mode: "preview" })).toEqual({
      errorMessage:
        'Argument at "/mode" must be equal to one of the allowed values: ["design","code"]',
      valid: false,
    });
    expect(check({ node: { tagName: "Not A Tag" } })).toEqual({
      errorMessage: 'Argument at "/node/tagName" must match pattern "^[a-z][a-z0-9-]*$"',
      valid: false,
    });
    expect(check({ node: {} })).toEqual({
      errorMessage: "Argument at \"/node\" must have required property 'tagName'",
      valid: false,
    });
  });

  /* A number written as a string has always been accepted for a numeric argument, and the tools
     that take an index coerce it themselves. The validator must not be what starts refusing it,
     and must not rewrite what the tool is given. */
  test("coerces as the registry does, on a copy", async () => {
    const validator = createArgumentValidator();
    await validator.ready;
    const check = validator.getValidator(SCHEMA);
    const args = { index: "3" };
    expect(check(args)).toEqual({ data: args, valid: true });
    expect(args.index).toBe("3");
    expect(check({ index: "third" }).valid).toBe(false);
  });

  test("names the call itself when the violation is at the root", async () => {
    const validator = createArgumentValidator();
    await validator.ready;
    const check = validator.getValidator({ required: ["path"], type: "object" });
    expect(check({})).toEqual({
      errorMessage: "The call must have required property 'path'",
      valid: false,
    });
  });

  test("passes every call until ajv has loaded, and for good when it cannot be", async () => {
    const gate = Promise.withResolvers<never>();
    const loading = createArgumentValidator(() => gate.promise);
    const check = loading.getValidator(SCHEMA);
    expect(check({ mode: "preview" })).toEqual({ data: { mode: "preview" }, valid: true });
    gate.reject(new Error("ajv is not installed"));
    await loading.ready;
    expect(check({ mode: "preview" }).valid).toBe(true);
  });

  /** A schema library whose `compile` is the one given: all the validator asks of one. */
  const compiling = (compile: SchemaCompiler["compile"]) => () => Promise.resolve({ compile });

  test("passes every call for a schema ajv cannot compile, and asks only once", async () => {
    let compiles = 0;
    const validator = createArgumentValidator(
      compiling(() => {
        compiles += 1;
        throw new Error("schema is invalid");
      }),
    );
    await validator.ready;
    const check = validator.getValidator(SCHEMA);
    expect(check({ mode: "preview" }).valid).toBe(true);
    expect(check({ mode: "preview" }).valid).toBe(true);
    expect(compiles).toBe(1);
  });

  test("says so plainly when a check fails with nothing to name", async () => {
    const failing: CompiledSchema = Object.assign(() => false, { errors: null });
    const validator = createArgumentValidator(compiling(() => failing));
    await validator.ready;
    expect(validator.getValidator(SCHEMA)({})).toEqual({
      errorMessage: "The arguments do not match the tool's schema.",
      valid: false,
    });
    const silent: CompiledSchema = Object.assign(() => false, {
      errors: [{ instancePath: "", keyword: "x", params: {} }],
    });
    const other = createArgumentValidator(compiling(() => silent));
    await other.ready;
    expect(other.getValidator(SCHEMA)({})).toEqual({
      errorMessage: "The call does not match the tool's schema",
      valid: false,
    });
  });
});
