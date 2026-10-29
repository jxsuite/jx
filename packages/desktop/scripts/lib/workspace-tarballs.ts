/**
 * Install a project against this checkout's `@jxsuite/*` packages instead of the registry's.
 *
 * A starter pins the versions it will be published beside, and release-please writes those pins in
 * the release commit, so on the release pull request (and in the release lanes, racing the npm
 * publish) a new project names versions npm does not have yet: the smoke test's install failed with
 * `ETARGET: No matching version found for @jxsuite/compiler@^8.0.0`. Everywhere else the registry
 * answered, but with the LAST release, which is not the code under test. Packing the workspace
 * answers both: the install resolves what this checkout would publish, whatever its version says.
 *
 * Only the `@jxsuite` packages are swapped. Third-party dependencies still come from the registry,
 * because that is what a user's install does.
 *
 * @license MIT
 */
import { readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { toPosixPath } from "./posix-path.ts";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/** A `package.json`, as far as this module reads or writes it. */
export interface Manifest {
  [key: string]: JsonValue | undefined;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** The `overrides` field npm reads: a spec, or a nested object of them, per package name. */
  overrides?: JsonObject;
  peerDependencies?: Record<string, string>;
}

/** The sections a dependency can be declared in. */
const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** Every `@jxsuite/*` name the manifest declares, in any section, once each. */
export function jxDependencies(manifest: Manifest): string[] {
  const names = new Set<string>();
  for (const section of SECTIONS) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (name.startsWith("@jxsuite/")) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/** The `file:` spec npm resolves to `tarball`, with forward slashes on every OS. */
export function tarballSpec(tarball: string): string {
  return `file:${toPosixPath(tarball)}`;
}

/**
 * The manifest with every packed package pinned to its tarball.
 *
 * Each direct declaration is rewritten, and every packed package is also an `overrides` entry,
 * because a packed `@jxsuite/compiler` declares `@jxsuite/runtime` by version and that version may
 * be the unpublished one too. npm refuses an override that disagrees with a direct dependency, so
 * both carry the same spec. A name with no tarball is left as it was.
 */
export function pinToTarballs(manifest: Manifest, tarballs: ReadonlyMap<string, string>): Manifest {
  const pinned: Manifest = { ...manifest };
  for (const section of SECTIONS) {
    const declared = manifest[section];
    if (declared) {
      pinned[section] = Object.fromEntries(
        Object.entries(declared).map(([name, spec]) => {
          const tarball = tarballs.get(name);
          return [name, tarball ? tarballSpec(tarball) : spec];
        }),
      );
    }
  }
  pinned.overrides = {
    ...manifest.overrides,
    ...Object.fromEntries([...tarballs].map(([name, tarball]) => [name, tarballSpec(tarball)])),
  };
  return pinned;
}

/** How a workspace is packed: `bun pm pack`, as the publish job does, by default. */
export type Packer = (dir: string, destination: string) => { exitCode: number; output: string };

const bunPack: Packer = (dir, destination) => {
  const proc = Bun.spawnSync(["bun", "pm", "pack", "--destination", destination, "--quiet"], {
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  return { exitCode: proc.exitCode, output: `${proc.stdout.toString()}${proc.stderr.toString()}` };
};

/**
 * Pack one workspace into `destination` and return the tarball's absolute path.
 *
 * `bun pm pack` rewrites each `workspace:^` to the version beside it and runs the package's
 * `prepare`, so the tarball is the one the publish job would upload. The tarball is found by what
 * appeared in `destination`, not by parsing the tool's output.
 *
 * @throws {Error} When the packer fails or writes no tarball
 */
export function packWorkspace(dir: string, destination: string, pack: Packer = bunPack): string {
  const before = new Set(readdirSync(destination));
  const result = pack(dir, destination);
  const written = readdirSync(destination).find(
    (file) => file.endsWith(".tgz") && !before.has(file),
  );
  if (result.exitCode !== 0 || !written) {
    throw new Error(`Packing ${dir} produced no tarball:\n${result.output.trim()}`);
  }
  const tarball = join(destination, written);
  return isAbsolute(tarball) ? tarball : resolve(tarball);
}
