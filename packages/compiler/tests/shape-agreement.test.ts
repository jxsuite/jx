import { describe, expect, test } from "bun:test";
import { buildInitialScope } from "../src/shared.ts";
import { buildScope } from "@jxsuite/runtime";
import type { JxStateDefinition } from "@jxsuite/schema/types";

/*
 * Whether a state object holds a value is decided in two tiers: the interpreter's `buildScope` and
 * the compiler's `buildInitialScope`. Both call one predicate (spec.md §5.7), so a row below that
 * one tier keeps and the other drops fails here, rather than as a page that prerenders one thing
 * and hydrates another.
 */

const rows: [string, JxStateDefinition][] = [
  ["a schema alone", { type: "string" }],
  ["a schema with annotations", { description: "n", maximum: 10, minimum: 0, type: "number" }],
  ["an enum alone", { enum: ["a"] }],
  ["a ref alone", { $ref: "#/$defs/Count" }],
  ["a data object with a type field", { name: "x", type: "admin" }],
  ["a schema with a foreign key", { label: "x", type: "string" }],
  ["an empty object", {}],
  ["a description alone", { description: "x" }],
  ["a title alone", { title: "Hello" }],
  ["a default beside a schema", { default: 1, type: "number" }],
];

describe("the interpreter and the compiler agree on a pure type definition", () => {
  test.each(rows)("%s", async (_name, def) => {
    const runtime = await buildScope({ state: { entry: def } }, {}, "http://localhost/");
    const compiled = buildInitialScope({ entry: def });
    expect("entry" in runtime).toBe("entry" in compiled);
  });
});
