/**
 * Convert command: `jx convert` resolves the project's `@jxsuite/server/convert` and runs it under
 * Bun, as `jx dev` does and for the same reasons. The compiler cannot depend on the server, and the
 * refactor pass that repairs references ships as TypeScript this Node entry cannot load.
 *
 * @module convert-command
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ProcessLike } from "./dev-command.ts";

/**
 * Resolve the project's converter.
 *
 * @param projectRoot Absolute project root.
 * @throws {Error} When the server package is not installed.
 */
export function resolveConvertEntry(projectRoot: string): string {
  try {
    return createRequire(join(projectRoot, "package.json")).resolve("@jxsuite/server/convert");
  } catch {
    throw new Error(
      `@jxsuite/server is not installed in ${projectRoot}. ` +
        `Add it to devDependencies (e.g. \`bun add -d @jxsuite/server\`) and retry.`,
    );
  }
}

/**
 * Spawn the converter under Bun.
 *
 * @param projectRoot Absolute project root.
 * @param argv The arguments after the command.
 * @param spawnImpl Injectable for tests.
 * @param proc Injectable for tests.
 */
export function runConvert(
  projectRoot: string,
  argv: readonly string[],
  spawnImpl: typeof spawn = spawn,
  proc: ProcessLike = process,
): ChildProcess {
  const entry = resolveConvertEntry(projectRoot);
  const child = spawnImpl("bun", [entry, "--root", projectRoot, ...argv], { stdio: "inherit" });
  child.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "ENOENT"
        ? "jx convert runs on Bun, which was not found on your PATH. Install it from https://bun.sh and retry."
        : `Failed to start jx convert: ${error.message}`,
    );
    proc.exitCode = 1;
  });
  child.on("exit", (code) => {
    proc.exitCode = code ?? 0;
  });
  return child;
}
