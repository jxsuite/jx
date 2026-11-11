/** `jx format`: finding the project's formatter and running it under Bun. */
import { describe, expect, test } from "bun:test";
import { ChildProcess } from "node:child_process";
import type { SpawnOptions, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProcessLike } from "../src/site/dev-command.ts";
import { runFormat } from "../src/site/format-command.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

type SpawnWithArgs = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

describe("runFormat", () => {
  test("runs the server's formatter under Bun with the arguments it was given", () => {
    const child = new ChildProcess();
    const calls: { args: readonly string[]; command: string }[] = [];
    const impl: SpawnWithArgs = (command, args) => {
      calls.push({ args, command });
      return child;
    };
    const proc: ProcessLike = { on: () => {} };
    // SAFETY: runFormat uses the one `(command, args, options)` overload this implements.
    runFormat(REPO_ROOT, ["pages", "--check"], impl as typeof spawn, proc);
    expect(calls[0]?.command).toBe("bun");
    expect(calls[0]?.args[0]).toEndWith("packages/server/src/format.ts");
    expect(calls[0]?.args.slice(1)).toEqual(["--root", REPO_ROOT, "pages", "--check"]);
    child.emit("exit", 1);
    expect(proc.exitCode).toBe(1);
  });

  test("says what to install when the project has no server", () => {
    const empty = mkdtempSync(join(tmpdir(), "jx-format-"));
    try {
      expect(() => runFormat(empty, [])).toThrow("@jxsuite/server is not installed");
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });
});
