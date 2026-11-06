/** `jx convert`: finding the project's converter and running it under Bun. */
import { describe, expect, spyOn, test } from "bun:test";
import { ChildProcess } from "node:child_process";
import type { SpawnOptions, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConvertEntry, runConvert } from "../src/site/convert-command.ts";
import type { ProcessLike } from "../src/site/dev-command.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

type SpawnWithArgs = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** A process that records its exit code. */
function fakeProcess(): ProcessLike {
  return { on: () => {} };
}

/** Run with a child that never spawned, which `emit` drives. */
function run(proc: ProcessLike) {
  const child = new ChildProcess();
  const calls: { args: readonly string[]; command: string }[] = [];
  const impl: SpawnWithArgs = (command, args) => {
    calls.push({ args, command });
    return child;
  };
  // SAFETY: runConvert uses the one `(command, args, options)` overload this implements.
  runConvert(REPO_ROOT, ["pages", "--to", "jxn"], impl as typeof spawn, proc);
  return { calls, child };
}

describe("resolveConvertEntry", () => {
  test("finds the server's converter from the project", () => {
    expect(resolveConvertEntry(REPO_ROOT)).toEndWith("packages/server/src/convert.ts");
  });

  test("says what to install when there is none", () => {
    const empty = mkdtempSync(join(tmpdir(), "jx-convert-"));
    try {
      expect(() => resolveConvertEntry(empty)).toThrow("@jxsuite/server is not installed");
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });
});

describe("runConvert", () => {
  test("runs it under Bun with the arguments it was given", () => {
    const { calls } = run(fakeProcess());
    expect(calls[0]?.command).toBe("bun");
    expect(calls[0]?.args.slice(1)).toEqual(["--root", REPO_ROOT, "pages", "--to", "jxn"]);
  });

  test("takes the converter's exit code", () => {
    const proc = fakeProcess();
    run(proc).child.emit("exit", 1);
    expect(proc.exitCode).toBe(1);
  });

  test("a signal with no code is not a failure", () => {
    const proc = fakeProcess();
    run(proc).child.emit("exit", null);
    expect(proc.exitCode).toBe(0);
  });

  test("says Bun is missing when it is", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    const proc = fakeProcess();
    run(proc).child.emit("error", Object.assign(new Error("no"), { code: "ENOENT" }));
    expect(logged.mock.calls[0]?.[0]).toContain("runs on Bun");
    expect(proc.exitCode).toBe(1);
    logged.mockRestore();
  });

  test("reports any other failure as it is", () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});
    run(fakeProcess()).child.emit("error", new Error("boom"));
    expect(logged.mock.calls[0]?.[0]).toContain("boom");
    logged.mockRestore();
  });
});
