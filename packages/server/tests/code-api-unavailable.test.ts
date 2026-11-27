/**
 * Lint graceful degradation — a host with no oxlint to run must return empty diagnostics cleanly
 * instead of erroring. An empty JX_OXLINT_BIN is the explicit disable switch and drives the same
 * null-resolution branch.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { handleCodeApi, resolveOxlintCommand } from "../src/code-api";

/** The code API answers every `/__studio/code/<action>` POST it knows; `null` means it declined. */
function handled(res: Response | null): Response {
  if (res === null) {
    throw new Error("handleCodeApi declined a request it was expected to answer");
  }
  return res;
}

afterEach(() => {
  delete process.env.JX_OXLINT_BIN;
});

describe("code-api — oxlint unavailable", () => {
  test("lint returns empty diagnostics without an error", async () => {
    process.env.JX_OXLINT_BIN = "";
    expect(resolveOxlintCommand()).toBeNull();

    const url = new URL("http://localhost/__studio/code/lint");
    const req = new Request(url, {
      body: JSON.stringify({ code: "debugger;" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await handleCodeApi(req, url);
    const data = await handled(res).json();
    expect(data).toEqual({ diagnostics: [] });
  });
});
