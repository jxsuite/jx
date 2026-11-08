/** `core.ts` imported alone, as an entry that forgot to say how to load the stripper would. */
import { expect, test } from "bun:test";
import { eraseBody } from "../src/core.ts";

test("a body that needs the stripper names the missing entry", () => {
  expect(eraseBody("state.n++").code).toBe("state.n++");
  expect(() => eraseBody("let n: number;")).toThrow("without an entry that loads its stripper");
});
