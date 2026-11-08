/** The server's entry, alone: it requires `ts-blank-space` the first time a body needs it. */
import { expect, test } from "bun:test";
import { eraseBody } from "../src/index.ts";

test("erases a body with the stripper it requires", () => {
  expect(eraseBody("const label: string = state.name;").code).toBe(
    "const label         = state.name;",
  );
});
