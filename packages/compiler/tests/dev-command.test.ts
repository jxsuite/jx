/** Tests for src/site/dev-command.ts — `jx dev` resolution and spawn wiring. */

import { describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChildProcess } from "node:child_process";
import type { SpawnOptions, spawn } from "node:child_process";
import { resolveDevEntry, runDev } from "../src/site/dev-command.ts";
import type { ProcessLike } from "../src/site/dev-command.ts";

// The monorepo root has @jxsuite/server installed (workspace link) — a real resolution target.
const REPO_ROOT = resolve(import.meta.dir, "../../..");

/**
 * An unspawned ChildProcess: a real EventEmitter, so `emit` drives the handlers runDev registers,
 * with `kill` recorded instead of signalling anything.
 */
function fakeChild() {
  const child = new ChildProcess();
  const kill = spyOn(child, "kill").mockImplementation(() => true);
  return { child, kill };
}

/** The one `spawn` overload runDev uses: `(command, args, options)`. */
type SpawnWithArgs = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/** A recording spawn double that hands back `child` for every call. */
function fakeSpawn(child: ChildProcess) {
  const recorder = mock<SpawnWithArgs>(() => child);
  /* SAFETY: runDev calls spawnImpl once, as spawnImpl("bun", args, { stdio: "inherit" }) (the
     (command, args, options) overload), and only reads `on` and `kill` from the result, so a
     recorder of that overload returning a ChildProcess serves every overload of `typeof spawn`. */
  const spawnImpl = recorder as typeof recorder & typeof spawn;
  return { recorder, spawnImpl };
}

/** Fake ProcessLike capturing signal handlers and exitCode writes. */
function fakeProc(): ProcessLike & { fire: (event: string) => void } {
  const handlers = new Map<string, (() => void)[]>();
  return {
    exitCode: undefined,
    fire: (event: string) => {
      for (const handler of handlers.get(event) ?? []) {
        handler();
      }
    },
    on: (event: string, handler: () => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
}

describe("resolveDevEntry", () => {
  test("resolves @jxsuite/server/dev from a project with the dependency", () => {
    const entry = resolveDevEntry(REPO_ROOT);
    expect(entry).toContain("dev.ts");
  });

  test("throws an install hint when the package is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "jx-dev-"));
    try {
      mkdirSync(join(empty, "node_modules"), { recursive: true });
      writeFileSync(join(empty, "package.json"), "{}", "utf8");
      expect(() => resolveDevEntry(empty)).toThrow("Add it to devDependencies");
    } finally {
      rmSync(empty, { force: true, recursive: true });
    }
  });
});

describe("runDev", () => {
  test("spawns bun on the resolved entry with root and port args", () => {
    const { child } = fakeChild();
    const { recorder, spawnImpl } = fakeSpawn(child);
    runDev(REPO_ROOT, 4000, spawnImpl, fakeProc());

    expect(recorder).toHaveBeenCalledTimes(1);
    const [cmd, args = [], opts] = recorder.mock.calls[0] ?? [];
    expect(cmd).toBe("bun");
    expect(args[0]).toContain("dev.ts");
    expect(args).toContain("--root");
    expect(args).toContain(REPO_ROOT);
    expect(args).toContain("--port");
    expect(args).toContain("4000");
    expect(opts?.stdio).toBe("inherit");
  });

  test("omits --port when no port is given and mirrors the child exit code", () => {
    const { child } = fakeChild();
    const { recorder, spawnImpl } = fakeSpawn(child);
    const proc = fakeProc();
    runDev(REPO_ROOT, undefined, spawnImpl, proc);

    const [, args] = recorder.mock.calls[0] ?? [];
    expect(args).toBeArray();
    expect(args).not.toContain("--port");

    child.emit("exit", 3);
    expect(proc.exitCode).toBe(3);
  });

  test("forwards SIGINT and SIGTERM to the child", () => {
    const { child, kill } = fakeChild();
    const { spawnImpl } = fakeSpawn(child);
    const proc = fakeProc();
    runDev(REPO_ROOT, undefined, spawnImpl, proc);

    proc.fire("SIGINT");
    proc.fire("SIGTERM");
    expect(kill).toHaveBeenCalledTimes(2);
    expect(kill.mock.calls).toEqual([["SIGINT"], ["SIGTERM"]]);
  });

  test("reports a Bun hint on ENOENT spawn errors", () => {
    const { child } = fakeChild();
    const { spawnImpl } = fakeSpawn(child);
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    const proc = fakeProc();
    try {
      runDev(REPO_ROOT, undefined, spawnImpl, proc);
      const err: NodeJS.ErrnoException = Object.assign(new Error("spawn bun ENOENT"), {
        code: "ENOENT",
      });
      child.emit("error", err);
    } finally {
      console.error = origError;
    }
    expect(errors.some((e) => e.includes("bun.sh"))).toBe(true);
    expect(proc.exitCode).toBe(1);
  });

  test("reports plain spawn errors without the Bun hint", () => {
    const { child } = fakeChild();
    const { spawnImpl } = fakeSpawn(child);
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    const proc = fakeProc();
    try {
      runDev(REPO_ROOT, undefined, spawnImpl, proc);
      child.emit("error", new Error("boom"));
    } finally {
      console.error = origError;
    }
    expect(errors.some((e) => e.includes("Failed to start the dev server: boom"))).toBe(true);
    expect(proc.exitCode).toBe(1);
  });
});
