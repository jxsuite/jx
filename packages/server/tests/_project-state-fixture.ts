/**
 * The conformance fixture on a real disk, shared by every driver that runs the project state suite
 * over `createProjectStateHost` (`specs/project-state.md` §10.4): the files written, a repository
 * with them committed, and an installer that needs no network.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FixtureFiles } from "@jxsuite/protocol/project-state-conformance";
import { nodeGitRunner } from "../src/project-state/git-monitor.ts";

/** Git with an identity and none of the machine's hooks or signing, for a fixture repository. */
export const GIT_FIXTURE_CONFIG = [
  "-c",
  "user.name=Conformance",
  "-c",
  "user.email=conformance@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** Write `files` under `root`, creating directories as the paths imply. */
export async function writeFixture(root: string, files: FixtureFiles): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
}

/** Make `root` a repository with every file committed on `main`. */
export async function commitFixture(root: string): Promise<void> {
  const git = nodeGitRunner(root);
  await git(["init", "-q", "-b", "main"]);
  await git(["add", "-A"]);
  await git([...GIT_FIXTURE_CONFIG, "commit", "-q", "-m", "fixture"]);
}

/**
 * The installer the driver hands the host: what a package manager does to the fixture, without a
 * network. Each `file:` dependency is copied into `node_modules`, and `package-lock.json` records
 * the dependencies, so an install that changes them changes the lockfile (§7).
 */
export async function fixtureInstaller(root: string): Promise<void> {
  // SAFETY: the fixture's manifest, which the suite writes with an object of dependencies or none.
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = manifest.dependencies ?? {};
  for (const [name, spec] of Object.entries(dependencies)) {
    const from = spec.startsWith("file:") ? resolve(root, spec.slice("file:".length)) : null;
    const into = join(root, "node_modules", name);
    await mkdir(into, { recursive: true });
    await writeFile(
      join(into, "package.json"),
      from === null ? JSON.stringify({ name }) : await readFile(join(from, "package.json")),
    );
  }
  await writeFile(
    join(root, "package-lock.json"),
    `${JSON.stringify({ lockfileVersion: 3, packages: dependencies }, null, 2)}\n`,
  );
}
