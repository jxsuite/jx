/** A linter that runs but prints something other than JSON: lint reports the failure, not a crash. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runCodeService } from "../src/code-api.ts";

let saved: string | undefined;

beforeAll(() => {
  saved = process.env.JX_OXLINT_BIN;
  // `echo` ignores the lint arguments and prints them as text, which is not JSON.
  process.env.JX_OXLINT_BIN = "echo";
});

afterAll(() => {
  if (saved === undefined) {
    delete process.env.JX_OXLINT_BIN;
  } else {
    process.env.JX_OXLINT_BIN = saved;
  }
});

describe("code-api: oxlint prints something that is not JSON", () => {
  test("lint answers no diagnostics and the parse error", async () => {
    const result = await runCodeService("lint", { code: "debugger;" });
    expect(result).toMatchObject({ diagnostics: [] });
    expect(JSON.stringify(result)).toContain("error");
  });
});
