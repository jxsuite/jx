import { expect, test } from "bun:test";
import { MAX_COMPONENT_NESTING as compilerCap } from "../src/shared.ts";
import { MAX_COMPONENT_NESTING as runtimeCap } from "@jxsuite/runtime";

/*
 * The component nesting cap (spec.md §16.9, compiler.md §8.1) is written twice: once here, where
 * `renderComponentInstance` refuses a build whose expansion path reaches it, and once in the
 * runtime, where `connectedCallback` refuses an instance whose chain does. The compiler depends on
 * the runtime and not the other way round, and the runtime's browser bundle cannot import the
 * build tool, so neither copy can be the other's import today. This is the assertion that stands
 * in for the import: a page that builds is a page that renders, and a cap that differs between the
 * two would make one of them lie about the other — a tree thirty levels deep that the build
 * accepts and the canvas refuses, or the reverse, with nothing in either suite to say so.
 */
test("the compiler's nesting cap is the runtime's", () => {
  expect(compilerCap).toBe(runtimeCap);
});
