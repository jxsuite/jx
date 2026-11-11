/**
 * An error the formatter gives no place for: it is told as it is, with no line.
 *
 * Every error oxfmt reports for real code carries a label, so the formatter is doubled here to say
 * one without.
 */
import { describe, expect, mock, test } from "bun:test";

void mock.module("oxfmt", () => ({
  format: () => Promise.resolve({ code: "", errors: [{ labels: [], message: "it is not right" }] }),
}));

const { formatBody, formatScript } = await import("../src/code-format.ts");

describe("an error with no place", () => {
  test("is told without a line, in a body and in a script", async () => {
    expect(await formatBody("return 1")).toEqual({ code: "return 1", errors: ["it is not right"] });
    expect(await formatScript("export {}")).toEqual({
      code: "export {}",
      errors: ["it is not right"],
    });
  });
});
