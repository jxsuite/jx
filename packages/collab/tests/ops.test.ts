import { describe, expect, test } from "bun:test";
import * as schemaOps from "@jxsuite/schema/doc-ops";
import * as ops from "../src/ops.ts";

/* The vocabulary lives in `@jxsuite/schema/doc-ops` (its tests are there). This subpath is kept so
   every `@jxsuite/collab/ops` import resolves to the SAME implementation — two appliers that could
   drift are exactly what the canvas iframe and history replay must never have. */
describe("@jxsuite/collab/ops", () => {
  test("re-exports the schema's own functions, not copies of them", () => {
    expect(ops.applyDocOpToDoc).toBe(schemaOps.applyDocOpToDoc);
    expect(ops.applyDocOpsWithInverse).toBe(schemaOps.applyDocOpsWithInverse);
    expect(ops.childArray).toBe(schemaOps.childArray);
    expect(ops.cloneValue).toBe(schemaOps.cloneValue);
    expect(ops.getNodeAtPath).toBe(schemaOps.getNodeAtPath);
    expect(ops.inverseOf).toBe(schemaOps.inverseOf);
  });
});
