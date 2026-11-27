import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@jxsuite/schema/types";
import {
  CODE_SERVICE_ACTIONS,
  handleCodeApi,
  resolveOxlintCommand,
  runCodeService,
} from "../src/code-api";

/** The code API answers every `/__studio/code/<action>` POST it knows; `null` means it declined. */
function handled(res: Response | null): Response {
  if (res === null) {
    throw new Error("handleCodeApi declined a request it was expected to answer");
  }
  return res;
}

/**
 * @param {string} action
 * @param {JsonObject} body
 */
function codeRequest(action: string, body: JsonObject) {
  const url = new URL(`http://localhost/__studio/code/${action}`);
  return {
    req: new Request(url, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    url,
  };
}

describe("code-api", () => {
  test("returns null for non-matching paths", async () => {
    const url = new URL("http://localhost/__studio/other");
    const req = new Request(url, { method: "POST" });
    const res = await handleCodeApi(req, url);
    expect(res).toBeNull();
  });

  test("returns null for GET requests", async () => {
    const url = new URL("http://localhost/__studio/code/format");
    const req = new Request(url, { method: "GET" });
    const res = await handleCodeApi(req, url);
    expect(res).toBeNull();
  });

  test("returns 400 for invalid JSON body", async () => {
    const url = new URL("http://localhost/__studio/code/format");
    const req = new Request(url, { body: "not json", method: "POST" });
    const res = await handleCodeApi(req, url);
    expect(handled(res).status).toBe(400);
  });

  test("returns null for unknown action", async () => {
    const { req, url } = codeRequest("unknown", { code: "x" });
    const res = await handleCodeApi(req, url);
    expect(res).toBeNull();
  });

  describe("format", () => {
    test("returns empty for empty code", async () => {
      const { req, url } = codeRequest("format", { code: "" });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.code).toBe("");
      expect(data.errors).toEqual([]);
    });

    test("returns empty for whitespace-only code", async () => {
      const { req, url } = codeRequest("format", { code: "   " });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.code).toBe("");
    });

    test("formats valid code", async () => {
      const { req, url } = codeRequest("format", {
        code: "const x=1;const y=2;",
      });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.code).toContain("const x = 1");
      expect(data.errors).toEqual([]);
    });

    test("accepts custom args", async () => {
      const { req, url } = codeRequest("format", {
        args: ["a", "b"],
        code: "return a + b;",
      });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.code).toContain("return a + b");
    });

    test("returns the code as written, with why, where it does not parse", async () => {
      const { req, url } = codeRequest("format", { code: "const x = ;" });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data).toEqual({
        code: "const x = ;",
        errors: [{ message: "Unexpected token (line 1)" }],
      });
    });

    test("a body that awaits is formatted, which a method of a class may", async () => {
      const { req, url } = codeRequest("format", { code: "const r=await load();return r" });
      const data = await handled(await handleCodeApi(req, url)).json();
      expect(data).toEqual({ code: "const r = await load();\nreturn r;", errors: [] });
    });

    test("indents with two spaces, as the editor does", async () => {
      const { req, url } = codeRequest("format", { code: "if(a){b()}" });
      const data = await handled(await handleCodeApi(req, url)).json();
      expect(data.code).toBe("if (a) {\n  b();\n}");
    });
  });

  describe("a TypeScript body (spec.md §23.1)", () => {
    const TYPED = "const input=event.target as HTMLInputElement;state.label=input.value;";

    test("formats with its types kept", async () => {
      const { req, url } = codeRequest("format", { code: TYPED });
      const data = await handled(await handleCodeApi(req, url)).json();
      expect(data.errors).toEqual([]);
      expect(data.code).toBe(
        "const input = event.target as HTMLInputElement;\nstate.label = input.value;",
      );
    });

    test("lints with no parse error", async () => {
      const { req, url } = codeRequest("lint", { code: TYPED });
      const data = await handled(await handleCodeApi(req, url)).json();
      expect(data.error).toBeUndefined();
      expect(data.diagnostics).toEqual([]);
    });

    test("is never minified: the service has no minify action", async () => {
      const { req, url } = codeRequest("minify", { code: TYPED });
      expect(await handleCodeApi(req, url)).toBeNull();
    });
  });

  describe("lint", () => {
    test("returns empty diagnostics for empty code", async () => {
      const { req, url } = codeRequest("lint", { code: "" });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.diagnostics).toEqual([]);
    });

    test("returns diagnostics for code with issues", async () => {
      const { req, url } = codeRequest("lint", { code: "debugger;" });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      // Oxlint must actually flag the `debugger` statement — an empty array here means the
      // Binary was not found and the endpoint failed silently (the original regression).
      expect(data.error).toBeUndefined();
      expect(data.diagnostics.length).toBeGreaterThan(0);
    });

    test("returns empty diagnostics for clean code", async () => {
      const { req, url } = codeRequest("lint", {
        code: "const x = 1;\nreturn x;",
      });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(Array.isArray(data.diagnostics)).toBe(true);
    });

    test("a body that awaits is told so, as the function a document's body becomes is not async", async () => {
      const { req, url } = codeRequest("lint", { code: "const r = await load();\nreturn r;" });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(data.error).toBeUndefined();
      expect(JSON.stringify(data.diagnostics)).toContain("await");
      expect(data.diagnostics[0].labels[0].span.line).toBe(1);
    });

    test("accepts custom args for lint", async () => {
      const { req, url } = codeRequest("lint", {
        args: ["a"],
        code: "return a;",
      });
      const res = await handleCodeApi(req, url);
      const data = await handled(res).json();
      expect(Array.isArray(data.diagnostics)).toBe(true);
    });
  });

  describe("resolveOxlintCommand", () => {
    test("an explicit JX_OXLINT_BIN override wins", () => {
      process.env.JX_OXLINT_BIN = "/custom/bin/oxlint";
      try {
        expect(resolveOxlintCommand()).toEqual(["/custom/bin/oxlint"]);
      } finally {
        delete process.env.JX_OXLINT_BIN;
      }
    });

    test("walks up to the workspace-root node_modules/oxlint, run by the host's own runtime", () => {
      const command = resolveOxlintCommand();
      expect(command?.[0]).toBe(process.execPath);
      expect(command?.[1]).toEndWith(join("node_modules", "oxlint", "bin", "oxlint"));
      expect(existsSync(command![1]!)).toBe(true);
    });

    test("a staged copy beside the module wins", () => {
      const dir = mkdtempSync(join(tmpdir(), "jx-oxlint-staged-"));
      try {
        mkdirSync(join(dir, "oxlint", "bin"), { recursive: true });
        writeFileSync(join(dir, "oxlint", "bin", "oxlint"), "");
        expect(resolveOxlintCommand(dir)).toEqual([
          process.execPath,
          join(dir, "oxlint", "bin", "oxlint"),
        ]);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test("finds oxlint on PATH when nothing is staged or installed above", () => {
      const dir = mkdtempSync(join(tmpdir(), "jx-oxlint-path-"));
      const path = process.env.PATH;
      try {
        const name = process.platform === "win32" ? "oxlint.exe" : "oxlint";
        writeFileSync(join(dir, name), "");
        process.env.PATH = dir;
        expect(resolveOxlintCommand("/")).toEqual([join(dir, name)]);
      } finally {
        process.env.PATH = path;
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test("returns null when no copy and no PATH candidate exist", () => {
      const path = process.env.PATH;
      process.env.PATH = "";
      try {
        // Starting at the filesystem root skips every node_modules probe.
        expect(resolveOxlintCommand("/")).toBeNull();
      } finally {
        process.env.PATH = path;
      }
    });
  });

  describe("runCodeService", () => {
    test("names the two actions it answers", () => {
      expect([...CODE_SERVICE_ACTIONS]).toEqual(["format", "lint"]);
    });

    test("format returns what the HTTP route returns for the same body", async () => {
      const body = { code: "const x=1;const y=2;" };
      const { req, url } = codeRequest("format", body);
      const http = await handled(await handleCodeApi(req, url)).json();
      expect(await runCodeService("format", body)).toEqual(http);
    });

    test("lint of debugger returns a diagnostic on line 1, unwrapped", async () => {
      const result = await runCodeService("lint", { code: "debugger;" });
      const diagnostics = result?.diagnostics ?? [];
      const text = JSON.stringify(diagnostics);
      expect([text.includes("no-debugger"), text.includes('"line":1')]).toEqual([true, true]);
    });

    test("an unknown action returns null", async () => {
      expect(await runCodeService("minify", { code: "x" })).toBeNull();
    });

    test("a payload that is not an object behaves as an empty body", async () => {
      expect(await runCodeService("format", "nope")).toEqual({ code: "", errors: [] });
      expect(await runCodeService("lint", null)).toEqual({ diagnostics: [] });
    });

    test("a non-array args is ignored, so the default wrapper applies", async () => {
      const result = await runCodeService("format", { args: 123, code: "return 1;" });
      expect(result).toEqual({ code: "return 1;", errors: [] });
    });
  });
});
