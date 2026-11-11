/**
 * Convert command: `jx convert` is the project's `@jxsuite/server/convert`, run under Bun. The
 * refactor pass that repairs references is the server's.
 *
 * @module convert-command
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProcessLike } from "./dev-command.ts";
import { resolveServerEntry, runServerCommand } from "./server-command.ts";

/**
 * Resolve the project's converter.
 *
 * @param projectRoot Absolute project root.
 * @throws {Error} When the server package is not installed.
 */
export function resolveConvertEntry(projectRoot: string): string {
  return resolveServerEntry(projectRoot, "convert");
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
  return runServerCommand("convert", projectRoot, argv, spawnImpl, proc);
}
