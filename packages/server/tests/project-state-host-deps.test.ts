/**
 * What the project state host reaches outside itself for (`src/project-state/host-deps.ts`), and
 * the two chokidar adapters, each against a double of the module it wraps: the compiler's format
 * host, the package installer, the asset mounts and chokidar itself (`specs/project-state.md` §2.2,
 * §4.5, §7, §8.1).
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PackageOpResult } from "@jxsuite/protocol";
import { toError } from "@jxsuite/schema/parse";

/** The message `promise` rejected with; fails the test when it resolves. */
async function rejection<T>(promise: Promise<T>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return toError(error).message;
  }
  throw new Error("expected a rejection");
}

type Handler = (...args: string[] | [Error]) => void;

/** The part of chokidar's `FSWatcher` the adapters use: `on`, `once` and `close`. */
class FakeWatcher {
  closed = false;
  readonly #handlers = new Map<string, Handler[]>();
  on(name: string, handler: Handler): this {
    this.#handlers.set(name, [...(this.#handlers.get(name) ?? []), handler]);
    return this;
  }
  once(name: string, handler: Handler): this {
    return this.on(name, handler);
  }
  emit(name: string, ...args: string[] | [Error]): void {
    for (const handler of this.#handlers.get(name) ?? []) {
      handler(...args);
    }
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

const watchers: FakeWatcher[] = [];
const installs: string[] = [];
let installResult: PackageOpResult = { ok: true };

void mock.module("chokidar", () => ({
  watch: () => {
    const watcher = new FakeWatcher();
    watchers.push(watcher);
    return watcher;
  },
}));

void mock.module("@jxsuite/compiler/format-host", () => ({
  buildInstalledExtensionRegistry: () =>
    Promise.resolve({
      missing: [],
      registry: {
        formats: {
          byExtension: (extension: string) =>
            extension === ".md"
              ? { call: (_capability: string, text: string) => Promise.resolve({ text }) }
              : undefined,
          documentExtensions: () => [".jxn", ".md"],
        },
      },
    }),
}));

void mock.module("../src/refactor/mounts.ts", () => ({
  refactorMounts: () => Promise.resolve([{ dir: "media", urlPrefix: "/media" }]),
}));

void mock.module("../src/packages.ts", () => ({
  installDependencies: (root: string) => {
    installs.push(root);
    return Promise.resolve(installResult);
  },
}));

const deps = await import("../src/project-state/host-deps.ts");
const { chokidarProjectWatcher } = await import("../src/project-state/host.ts");
const { chokidarGitWatch } = await import("../src/project-state/git-monitor.ts");

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { force: true, recursive: true });
  }
});

describe("loadInstalledFormats", () => {
  test("answers the registered extensions, their parser and the mounts", async () => {
    const formats = await deps.loadInstalledFormats("/project", {});
    expect(formats.extensions).toEqual([".md"]);
    expect(formats.mounts).toEqual([{ dir: "media", urlPrefix: "/media" }]);
    expect(await formats.parse(".md", "# A")).toEqual({ text: "# A" });
    expect(await rejection(formats.parse(".csv", "a,b"))).toBe('No parser for ".csv"');
  });
});

describe("NO_FORMATS", () => {
  test("registers nothing and parses nothing", async () => {
    expect([deps.NO_FORMATS.extensions, deps.NO_FORMATS.mounts]).toEqual([[], []]);
    expect(await rejection(deps.NO_FORMATS.parse(".md", "# A"))).toBe('No parser for ".md"');
  });
});

describe("installPackages", () => {
  test("runs the package service's install and rejects with its log on failure", async () => {
    installResult = { ok: true };
    await deps.installPackages("/project");
    expect(installs).toEqual(["/project"]);
    installResult = { log: "E404", ok: false };
    expect(await rejection(deps.installPackages("/project"))).toBe("E404");
    installResult = { ok: false };
    expect(await rejection(deps.installPackages("/project"))).toBe("The install failed");
  });
});

describe("dependenciesInstalled", () => {
  test("every declared package has a manifest under node_modules", async () => {
    const root = await mkdtemp(join(tmpdir(), "jx-installed-"));
    dirs.push(root);
    expect(await deps.dependenciesInstalled(root, null)).toBe(true);
    const manifest = {
      dependencies: { a: "1" },
      devDependencies: { "@scope/b": "1" },
      optionalDependencies: "not an object",
      peerDependencies: { peer: "1" },
    };
    expect(await deps.dependenciesInstalled(root, manifest)).toBe(false);
    for (const name of ["a", "@scope/b"]) {
      await mkdir(join(root, "node_modules", name), { recursive: true });
      await writeFile(join(root, "node_modules", name, "package.json"), "{}");
    }
    expect(await deps.dependenciesInstalled(root, manifest)).toBe(true);
  });
});

describe("sourceCollections", () => {
  const files = [
    "content/blog/a.md",
    "content/blog/drafts/b.md",
    "content/blog/c.md",
    "content/en/docs/x.md",
    "content/fr/docs/y.md",
    "data/people.csv",
    "pages/index.json",
  ];

  test("a directory, a file, a glob and a locale source, less their excludes", async () => {
    const collections = await deps.sourceCollections({
      config: {
        content: {
          blog: { exclude: ["drafts/**"], source: "./content/blog/" },
          broken: "not an object",
          docs: { source: "./content/{locale}/docs/" },
          people: { source: "data/people.csv" },
          remote: { source: "https://example.com/feed.csv" },
          top: { source: "./content/*/docs/?.md" },
          unsourced: { format: "Markdown" },
        },
      },
      files,
      root: "/project",
    });
    expect(collections).toEqual({
      blog: ["content/blog/a.md", "content/blog/c.md"],
      docs: ["content/en/docs/x.md", "content/fr/docs/y.md"],
      people: ["data/people.csv"],
      top: ["content/en/docs/x.md", "content/fr/docs/y.md"],
    });
  });

  test("a project with no content section has no collections", async () => {
    expect(await deps.sourceCollections({ config: undefined, files, root: "/p" })).toEqual({});
    expect(await deps.sourceCollections({ config: { content: "x" }, files, root: "/p" })).toEqual(
      {},
    );
  });

  test("a recursive glob matches at any depth", async () => {
    const collections = await deps.sourceCollections({
      config: { content: { all: { source: "content/**/*.md" } } },
      files,
      root: "/p",
    });
    expect(collections.all).toEqual(files.filter((path) => path.endsWith(".md")));
  });
});

describe("the chokidar adapters", () => {
  test("the project watcher reports the five changes, activity and errors", async () => {
    const seen: string[] = [];
    const errors: string[] = [];
    let activity = 0;
    const handle = chokidarProjectWatcher(
      "/project",
      {
        activity: () => {
          activity += 1;
        },
        error: (error) => errors.push(error.message),
        event: (type, path) => seen.push(`${type} ${path}`),
      },
      { atomicSaveMs: 100, ignored: () => false, stabilityMs: 50 },
    );
    const watcher = watchers.at(-1)!;
    watcher.emit("raw");
    watcher.emit("all", "add", "/project/a.json");
    watcher.emit("all", "ready", "/project");
    watcher.emit("error", new Error("limit"));
    watcher.emit("error", "string cause");
    watcher.emit("ready");
    await handle.ready;
    await handle.close();
    expect([seen, errors, activity, watcher.closed]).toEqual([
      ["add /project/a.json"],
      ["limit", "string cause"],
      1,
      true,
    ]);
  });

  test("the git watch reports every change and error", async () => {
    let changes = 0;
    const errors: string[] = [];
    const handle = chokidarGitWatch(
      ["/repo/.git/HEAD"],
      () => {
        changes += 1;
      },
      (error) => errors.push(error.message),
    );
    const watcher = watchers.at(-1)!;
    watcher.emit("all", "change", "/repo/.git/HEAD");
    watcher.emit("error", "denied");
    watcher.emit("error", new Error("gone"));
    watcher.emit("ready");
    await handle.ready;
    await handle.close();
    expect([changes, errors]).toEqual([1, ["denied", "gone"]]);
  });
});
