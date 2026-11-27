/** A formatter whose native binding cannot load: format answers nothing and the route says why. */
import { describe, expect, mock, test } from "bun:test";

const format = mock(() => Promise.reject(new Error("Cannot find native binding")));
void mock.module("oxfmt", () => ({ format }));

const { handleCodeApi, runCodeService } = await import("../src/code-api.ts");

describe("code-api: the formatter does not load", () => {
  test("format resolves null, once probed for any number of calls", async () => {
    expect(await runCodeService("format", { code: "return 1;" })).toBeNull();
    expect(await runCodeService("format", { code: "return 2;" })).toBeNull();
    expect(format).toHaveBeenCalledTimes(1);
  });

  test("the route answers 501 capability-unavailable", async () => {
    const url = new URL("http://localhost/__studio/code/format");
    const req = new Request(url, {
      body: JSON.stringify({ code: "return 1;" }),
      method: "POST",
    });
    const res = await handleCodeApi(req, url);
    expect(res?.status).toBe(501);
    expect(res?.headers.get("content-type")).toContain("application/problem+json");
    const problem = await res?.json();
    expect(problem.type).toEndWith("capability-unavailable");
  });

  test("lint still returns diagnostics", async () => {
    const result = await runCodeService("lint", { code: "debugger;" });
    expect(JSON.stringify(result)).toContain("no-debugger");
  });
});
