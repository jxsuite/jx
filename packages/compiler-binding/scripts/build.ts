/**
 * Build the addon for this machine and put it where the loader looks first.
 *
 * `cargo build --release -p jx_napi` writes a shared library named for the platform's linker
 * (`libjx_napi.so`, `libjx_napi.dylib`, `jx_napi.dll`); Node loads it under any name ending in
 * `.node`, so the copy is the whole packaging step. `--target <rust-triple> --as <triple>` is the
 * form the release lane uses to cross-compile one of `RELEASE_TRIPLES`. `--zig` links through
 * `cargo zigbuild` instead, which is how the musl triples are built: a glibc runner's own linker
 * cannot find a C runtime to link a musl shared library against.
 *
 * `JX_ADDON_BUILD=skip` builds nothing and says so. It is for a job that runs `bun run build` and
 * encodes no image, in an environment with no Rust: the screenshots lane, whose pinned browser
 * container has neither a toolchain nor the rights to install one.
 *
 * `JX_ADDON_PREBUILT=1` makes this a check instead of a build: the Nix package compiles the addon
 * in a derivation of its own (packages/desktop/package.nix) and copies it here, and its sandbox has
 * no registry for cargo to reach, so the `bun run build` it then runs must not start one.
 */

import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { addonFileName, hostTriples } from "../src/triple.ts";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const rustTarget = option("--target");
const triple =
  option("--as") ?? hostTriples({ arch: process.arch, musl: false, platform: process.platform })[0];
if (!triple) {
  throw new Error(`No addon triple for ${process.platform}-${process.arch}; pass --as <triple>.`);
}

if (process.env.JX_ADDON_BUILD === "skip") {
  console.log(
    "JX_ADDON_BUILD=skip: the compiler addon is not built; image optimization will fail.",
  );
  process.exit(0);
}

if (process.env.JX_ADDON_PREBUILT === "1") {
  const prebuilt = resolve(import.meta.dir, "..", addonFileName(triple));
  if (!existsSync(prebuilt)) {
    throw new Error(`JX_ADDON_PREBUILT is set, but ${prebuilt} does not exist.`);
  }
  console.log(`${addonFileName(triple)} is prebuilt`);
  process.exit(0);
}

const build = args.includes("--zig") ? "zigbuild" : "build";
const cargo = ["cargo", build, "--release", "--locked", "-p", "jx_napi"];
if (rustTarget) {
  cargo.push("--target", rustTarget);
}
/* SAFETY: this package's own manifest, whose `version` release-please writes as a string. */
const { version } = (await Bun.file(resolve(root, "package.json")).json()) as { version: string };
const built = Bun.spawnSync(cargo, {
  cwd: root,
  env: { ...process.env, JX_ADDON_VERSION: version },
  stderr: "inherit",
  stdout: "inherit",
});
if (built.exitCode !== 0) {
  process.exit(built.exitCode);
}

const library = triple.startsWith("win32")
  ? "jx_napi.dll"
  : triple.startsWith("darwin")
    ? "libjx_napi.dylib"
    : "libjx_napi.so";
const from = resolve(root, "target", rustTarget ?? "", "release", library);
const to = resolve(import.meta.dir, "..", addonFileName(triple));
copyFileSync(from, to);
console.log(`${addonFileName(triple)} ← ${from}`);
