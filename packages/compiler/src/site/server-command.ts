/**
 * A command the project's `@jxsuite/server` holds: `jx convert` and `jx format` resolve its entry
 * from the project and run it under Bun, as `jx dev` does and for the same reasons. The compiler
 * cannot depend on the server, and the server ships as TypeScript this Node entry cannot load.
 *
 * @module server-command
 * @docs framework/build/cli
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { ProcessLike } from "./dev-command.ts";

/**
 * Resolve the entry of one of the project's server commands.
 *
 * @param projectRoot Absolute project root.
 * @param name The command, which is the server's export of that name.
 * @throws {Error} When the server package is not installed.
 */
export function resolveServerEntry(projectRoot: string, name: string): string {
  try {
    return createRequire(join(projectRoot, "package.json")).resolve(`@jxsuite/server/${name}`);
  } catch {
    throw new Error(
      `@jxsuite/server is not installed in ${projectRoot}. ` +
        `Add it to devDependencies (e.g. \`bun add -d @jxsuite/server\`) and retry.`,
    );
  }
}

/**
 * Spawn one of the project's server commands under Bun.
 *
 * @param name The command.
 * @param projectRoot Absolute project root.
 * @param argv The arguments after the command.
 * @param spawnImpl Injectable for tests.
 * @param proc Injectable for tests.
 */
export function runServerCommand(
  name: string,
  projectRoot: string,
  argv: readonly string[],
  spawnImpl: typeof spawn = spawn,
  proc: ProcessLike = process,
): ChildProcess {
  const entry = resolveServerEntry(projectRoot, name);
  const child = spawnImpl("bun", [entry, "--root", projectRoot, ...argv], { stdio: "inherit" });
  child.on("error", (error: NodeJS.ErrnoException) => {
    console.error(
      error.code === "ENOENT"
        ? `jx ${name} runs on Bun, which was not found on your PATH. Install it from https://bun.sh and retry.`
        : `Failed to start jx ${name}: ${error.message}`,
    );
    proc.exitCode = 1;
  });
  child.on("exit", (code) => {
    proc.exitCode = code ?? 0;
  });
  return child;
}
