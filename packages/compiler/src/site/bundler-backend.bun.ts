/**
 * The Bun bundler backend: `Bun.build` and `Bun.resolveSync`. Selected by the `bun` condition of
 * `#bundler-backend` (`bundler-backend.ts`), so only a Bun process ever loads this file.
 *
 * `JX_BUNDLER=esbuild` hands every call to the esbuild backend instead, so a parity check can run
 * both under one Bun.
 */
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BuildConfig } from "bun";
import type { BackendBuild, BackendSplitBuild, BundleTargetName } from "./bundler-backend.ts";
import { TRANSIENT_ENTRY_PREFIX } from "./bundler-backend.ts";
import * as esbuildBackend from "./bundler-backend.node.ts";

/** True when this process was told to bundle with esbuild instead. */
function forcedToEsbuild(): boolean {
  return process.env.JX_BUNDLER === "esbuild";
}

/** Which bundler this backend runs. */
export function backendName(): "bun" | "esbuild" {
  return forcedToEsbuild() ? "esbuild" : "bun";
}

/** Resolve a bare specifier as an import from a module in `fromDir`. Throws when it does not. */
export function resolveBare(specifier: string, fromDir: string): string {
  if (forcedToEsbuild()) {
    return esbuildBackend.resolveBare(specifier, fromDir);
  }
  return Bun.resolveSync(specifier, fromDir);
}

/** Map a bundle target to Bun.build's target. */
function bunTarget(target: BundleTargetName): "browser" | "node" | "bun" {
  if (target === "workerd") {
    return "browser";
  }
  return target;
}

/**
 * Bundle one file with `Bun.build` and return the output's text. With `contents`, the file is the
 * text given and nothing is read from `entryPath`.
 */
async function buildFile(
  entryPath: string,
  request: BackendBuild,
  contents?: string,
): Promise<string> {
  const config: BuildConfig = {
    entrypoints: [entryPath],
    external: request.external,
    format: "esm",
    minify: request.minify,
    plugins: request.plugins,
    target: bunTarget(request.target),
    throw: false,
  };
  if (request.conditions) {
    config.conditions = request.conditions;
  }
  if (request.define) {
    config.define = request.define;
  }
  if (contents !== undefined) {
    // An in-memory file: Bun never asks a plugin to resolve an entry point, so a module that is not
    // On disk can only be an entry this way.
    config.files = { [entryPath]: contents };
  }
  const result = await Bun.build(config);
  if (!result.success || result.outputs.length === 0) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`Bun.build failed for ${entryPath}:\n${logs}`);
  }
  return result.outputs[0]!.text();
}

/** Bundle to one ESM module and return its text. Throws with the backend's diagnostics on failure. */
export async function build(request: BackendBuild): Promise<string> {
  if (forcedToEsbuild()) {
    return esbuildBackend.build(request);
  }
  const { entry } = request;
  if ("path" in entry) {
    return buildFile(entry.path, request, entry.contents);
  }
  // Bun.build has no stdin input: write a transient entry in `resolveDir` so resolution matches
  // The stdin/resolveDir behaviour, and always remove it.
  const entryPath = join(entry.resolveDir, `${TRANSIENT_ENTRY_PREFIX}${process.pid}.mjs`);
  writeFileSync(entryPath, entry.source, "utf8");
  try {
    return await buildFile(entryPath, request);
  } finally {
    rmSync(entryPath, { force: true });
  }
}

/**
 * Bundle several entries with code splitting into `outdir`, and return the files written. Throws
 * with the backend's diagnostics on failure.
 */
export async function buildSplit(request: BackendSplitBuild): Promise<string[]> {
  if (forcedToEsbuild()) {
    return esbuildBackend.buildSplit(request);
  }
  const config: BuildConfig = {
    entrypoints: request.entries,
    external: request.external,
    format: "esm",
    minify: request.minify,
    naming: { chunk: "chunk-[hash].[ext]", entry: "[name].[ext]" },
    outdir: request.outdir,
    plugins: request.plugins,
    splitting: true,
    target: bunTarget(request.target),
    throw: false,
  };
  if (request.conditions) {
    config.conditions = request.conditions;
  }
  if (request.define) {
    config.define = request.define;
  }
  const result = await Bun.build(config);
  if (!result.success) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`Bun.build failed for ${request.entries.join(", ")}:\n${logs}`);
  }
  return result.outputs.map((output) => resolve(request.outdir, output.path));
}
