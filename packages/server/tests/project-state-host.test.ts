/**
 * The project state conformance suite (`specs/project-state.md` §10.4) against the host in
 * `src/project-state/host.ts`, over real temporary directories, the real chokidar watcher and a
 * real git repository, with the dependency graph (§8) on. The driver uses only Node APIs
 * (`node:fs/promises`, `node:child_process` through the git runner), so it drives the host the way
 * the desktop backend's utility process will.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runProjectStateConformance } from "@jxsuite/protocol/project-state-conformance";
import type {
  FixtureFiles,
  ProjectStateDriver,
  ProjectStateHost,
  ProjectStateHostOptions,
  ProjectStateSubscription,
} from "@jxsuite/protocol/project-state-conformance";
import type { ProjectEvent } from "@jxsuite/protocol/project-state";
import { chokidarProjectWatcher, createProjectStateHost } from "../src/project-state/host.ts";
import type { ProjectWatcherFactory } from "../src/project-state/host.ts";
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
async function fixtureInstaller(root: string): Promise<void> {
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

/** The host under test, as `createProjectStateHost` answers it. */
type Host = Awaited<ReturnType<typeof createProjectStateHost>>;

async function createDriverHost(
  files: FixtureFiles,
  options: ProjectStateHostOptions,
): Promise<ProjectStateHost> {
  const base = await mkdtemp(join(tmpdir(), "jx-project-state-"));
  const root = join(base, "project");
  const scratch = join(base, "scratch");
  await mkdir(scratch, { recursive: true });
  await writeFixture(root, files);
  await commitFixture(root);
  const git = nodeGitRunner(root);
  let degrade: ((error: Error) => void) | null = null;
  const watcher: ProjectWatcherFactory = (watched, sink, watchOptions) => {
    degrade = sink.error;
    return chokidarProjectWatcher(watched, sink, watchOptions);
  };
  const start = (hold: boolean): Promise<Host> =>
    createProjectStateHost({
      hold,
      installer: fixtureInstaller,
      logCapacity: options.logCapacity ?? 1024,
      onError: () => {},
      root,
      watcher,
    });
  let host = await start(options.hold === true);
  const at = (path: string): string => join(root, path);

  return {
    close: async () => {
      await host.close();
      await rm(base, { force: true, recursive: true });
    },
    commit: async (message) => {
      await git(["add", "-A"]);
      await git([...GIT_FIXTURE_CONFIG, "commit", "-q", "-m", message]);
    },
    createDirectory: (path, writeId) => host.createDirectory(path, writeId),
    delete: (request) => host.delete(request),
    external: {
      atomicSave: async (path, contents, timing) => {
        if (timing === "inside") {
          // Written beside the project and renamed over the target, as an editor saves.
          const temp = join(scratch, `save-${Date.now()}`);
          await writeFile(temp, contents);
          await rename(temp, at(path));
          return;
        }
        await rm(at(path));
        await host.idle();
        await writeFile(at(path), contents);
      },
      remove: (path) => rm(at(path), { force: true, recursive: true }),
      rename: async (from, to) => {
        await mkdir(dirname(at(to)), { recursive: true });
        await rename(at(from), at(to));
      },
      symlink: async (path, target) => {
        const resolved = resolve(root, target);
        if (!resolved.startsWith(`${root}/`)) {
          await writeFile(resolved, "{}\n");
        }
        await symlink(resolved, at(path));
      },
      write: async (path, contents) => {
        await mkdir(dirname(at(path)), { recursive: true });
        await writeFile(at(path), contents);
      },
    },
    install: () => host.install(),
    read: async (path) => {
      try {
        return new Uint8Array(await readFile(at(path)));
      } catch {
        return null;
      }
    },
    release: () => host.release(),
    restart: async () => {
      await host.close();
      host = await start(false);
    },
    settle: () => host.idle(),
    subscribe: (request) => {
      const events: ProjectEvent[] = [];
      let ended = false;
      const sub = host.subscribe(request, {
        end: () => {
          ended = true;
        },
        events: (batch) => {
          events.push(...batch);
        },
      });
      const subscription: ProjectStateSubscription = {
        close: () => sub.close(),
        get ended() {
          return ended;
        },
        events,
        response: sub.response,
      };
      return Promise.resolve(subscription);
    },
    watcher: {
      degrade: (reason) => {
        degrade?.(new Error(reason));
        return Promise.resolve();
      },
      recover: () => host.restart(),
    },
    write: (request) => host.write(request),
  };
}

const driver: ProjectStateDriver = {
  create: createDriverHost,
  graph: { complete: true },
  name: "the desktop and dev-server host",
};

runProjectStateConformance(driver, {
  describe,
  expect,
  test: (name, body) => {
    test(name, body, 30_000);
  },
});
