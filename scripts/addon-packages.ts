/**
 * Turn the addons a release built into the npm packages that carry them.
 *
 * The compiler's Rust core ships as one self-contained `.node` file per platform. npm's way of
 * installing exactly one of several binaries is a package per platform, each declaring the `os`,
 * `cpu` and `libc` it runs on, listed as `optionalDependencies` of whatever loads them: the package
 * manager installs the one that matches the host and skips the rest. This script writes those
 * packages and adds that list.
 *
 * Bun scripts/addon-packages.ts <directory holding jx-compiler.<triple>.node files>
 *
 * It runs in the publish job only, after the build and before `publish-released.ts`, and it edits
 * the working tree: `packages/compiler-binding/npm/<triple>/` appears, and two manifests gain
 * `optionalDependencies`. Neither is ever committed, and that is deliberate. A committed dependency
 * on `@jxsuite/compiler-binding-linux-x64-gnu@<next version>` would name a package that does not
 * exist until this very release publishes it, and `bun install --frozen-lockfile` would fail on
 * every branch in between.
 *
 * Two manifests, because two packages run the loader. `@jxsuite/compiler-binding` runs it from its
 * own sources under Bun. `@jxsuite/compiler` inlines it into `dist/cli.js`, the file `jx` runs
 * under Node, where a `require` resolves from the compiler's own directory; under a strict linker
 * (pnpm) that reaches only the compiler's own dependencies.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isJsonRecord, isText } from "./lib/json-guards.ts";

import type { JsonObject } from "@jxsuite/schema/types";

/**
 * The naming contract, read from the tree being published
 * (`packages/compiler-binding/src/triple.ts`).
 */
export interface Naming {
  RELEASE_TRIPLES: readonly string[];
  addonFileName: (triple: string) => string;
  addonPackageName: (triple: string) => string;
}

/** The fields by which npm decides whether a package installs on a host. */
export interface PlatformFields {
  os: string[];
  cpu: string[];
  libc?: string[];
}

/** The packages whose manifests list the platform packages, relative to the repository root. */
export const LOADER_PACKAGES = ["packages/compiler-binding", "packages/compiler"] as const;

/** The `os`, `cpu` and `libc` a triple runs on, in npm's vocabulary. */
export function platformFields(triple: string): PlatformFields {
  const [os, cpu, abi] = triple.split("-");
  if (!os || !cpu) {
    throw new Error(`"${triple}" is not an <os>-<cpu>[-<abi>] triple`);
  }
  const fields: PlatformFields = { cpu: [cpu], os: [os] };
  if (abi === "gnu") {
    fields.libc = ["glibc"];
  } else if (abi === "musl") {
    fields.libc = ["musl"];
  }
  return fields;
}

/** The manifest of the package that carries one platform's addon. */
export function platformManifest(triple: string, version: string, naming: Naming) {
  const file = naming.addonFileName(triple);
  return {
    name: naming.addonPackageName(triple),
    version,
    description: `The Jx compiler's native addon for ${triple}`,
    license: "MIT",
    repository: {
      directory: "packages/compiler-binding",
      type: "git",
      url: "git+https://github.com/jxsuite/jx.git",
    },
    files: [file],
    main: file,
    ...platformFields(triple),
    // Public by name: a scoped package is private until told otherwise, and npm refuses to write
    // Provenance for the first version of one (`EUSAGE`, run 43544518046).
    publishConfig: { access: "public", provenance: true },
  };
}

/** `manifest` with every platform package as an optional dependency, pinned to exactly `version`. */
export function withPlatformDependencies(manifest: JsonObject, version: string, naming: Naming) {
  const optional = isJsonRecord(manifest.optionalDependencies)
    ? { ...manifest.optionalDependencies }
    : {};
  for (const triple of naming.RELEASE_TRIPLES) {
    optional[naming.addonPackageName(triple)] = version;
  }
  return { ...manifest, optionalDependencies: optional };
}

function readManifest(path: string): JsonObject {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isJsonRecord(parsed)) {
    throw new TypeError(`${path} is not a JSON object`);
  }
  return parsed;
}

/**
 * Write the platform packages and list them in the loader packages' manifests.
 *
 * @param artifacts A directory holding one `jx-compiler.<triple>.node` per released triple.
 * @param root The repository root of the tree being published.
 * @returns The platform package directories, relative to `root`, in release order.
 * @throws {Error} Naming every triple with no addon. A release missing one would install on that
 *   platform and then fail the first build with an image in it.
 */
export function prepare(artifacts: string, root: string, naming: Naming): string[] {
  const binding = join(root, "packages/compiler-binding");
  const { version } = readManifest(join(binding, "package.json"));
  if (!isText(version)) {
    throw new TypeError("packages/compiler-binding/package.json has no version");
  }
  const missing = naming.RELEASE_TRIPLES.filter(
    (triple) => !existsSync(join(artifacts, naming.addonFileName(triple))),
  );
  if (missing.length > 0) {
    throw new Error(`No addon was built for: ${missing.join(", ")} (looked in ${artifacts}).`);
  }
  const dirs: string[] = [];
  for (const triple of naming.RELEASE_TRIPLES) {
    const dir = join("packages/compiler-binding/npm", triple);
    const file = naming.addonFileName(triple);
    mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(join(artifacts, file), join(root, dir, file));
    writeFileSync(
      join(root, dir, "package.json"),
      `${JSON.stringify(platformManifest(triple, version, naming), null, 2)}\n`,
    );
    dirs.push(dir);
  }
  for (const loader of LOADER_PACKAGES) {
    const path = join(root, loader, "package.json");
    const listed = withPlatformDependencies(readManifest(path), version, naming);
    writeFileSync(path, `${JSON.stringify(listed, null, 2)}\n`);
  }
  return dirs;
}

if (import.meta.main) {
  const artifacts = process.argv.at(2);
  if (!artifacts) {
    throw new Error("usage: bun scripts/addon-packages.ts <artifacts directory>");
  }
  const root = process.cwd();
  const contract = resolve(root, "packages/compiler-binding/src/triple.ts");
  if (existsSync(contract)) {
    /* SAFETY: the module this repository keeps at that path exports exactly `Naming`. */
    const naming = (await import(contract)) as Naming;
    for (const dir of prepare(resolve(artifacts), root, naming)) {
      console.log(`prepared ${dir}`);
    }
  } else {
    // A backfill from a tag older than the Rust core: that tree has no addon to package.
    console.log("This tree has no packages/compiler-binding; nothing to prepare.");
  }
}
