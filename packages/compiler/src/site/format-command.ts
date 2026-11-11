/**
 * Format command: `jx format` is the project's `@jxsuite/server/format`, run under Bun. The
 * formatter it asks is the one Studio's code editor asks, and it is the server's dependency.
 *
 * @module format-command
 * @docs framework/build/cli
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProcessLike } from "./dev-command.ts";
import { runServerCommand } from "./server-command.ts";

/**
 * Spawn the formatter under Bun.
 *
 * @param projectRoot Absolute project root.
 * @param argv The arguments after the command.
 * @param spawnImpl Injectable for tests.
 * @param proc Injectable for tests.
 * @throws {Error} When the server package is not installed.
 */
export function runFormat(
  projectRoot: string,
  argv: readonly string[],
  spawnImpl: typeof spawn = spawn,
  proc: ProcessLike = process,
): ChildProcess {
  return runServerCommand("format", projectRoot, argv, spawnImpl, proc);
}
