/** The format endpoint when the formatter itself fails: the body comes back as it was sent. */
import { describe, expect, mock, test } from "bun:test";

void mock.module("../src/code-format.ts", () => ({
  formatBody: () => Promise.reject(new Error("the formatter is not there")),
}));

const { handleCodeApi } = await import("../src/code-api.ts");

describe("code-api — the formatter fails", () => {
  test("returns the code as it was sent, with why", async () => {
    const url = new URL("http://localhost/__studio/code/format");
    const req = new Request(url, {
      body: JSON.stringify({ code: "return 1" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await handleCodeApi(req, url);
    expect(await res?.json()).toEqual({
      code: "return 1",
      errors: [{ message: "the formatter is not there" }],
    });
  });
});
