/**
 * The esbuild bundler backend: the default of `#bundler-backend` (`bundler-backend.ts`), so every
 * runtime that is not Bun bundles with it, and Bun does too under `JX_BUNDLER=esbuild`.
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BuildOptions } from "esbuild";
import type { BackendBuild, BundleTargetName } from "./bundler-backend.ts";

/** Which bundler this backend runs. */
export function backendName(): "bun" | "esbuild" {
  return "esbuild";
}

/** Resolve a bare specifier as an import from a module in `fromDir`. Throws when it does not. */
export function resolveBare(specifier: string, fromDir: string): string {
  return createRequire(join(fromDir, "package.json")).resolve(specifier);
}

/** Map a bundle target to esbuild's platform (conditions carry the workerd specifics). */
function esbuildPlatform(target: BundleTargetName): "browser" | "node" {
  return target === "node" || target === "bun" ? "node" : "browser";
}

/** Bundle to one ESM module and return its text. Throws with esbuild's diagnostics on failure. */
export async function build(request: BackendBuild): Promise<string> {
  // Dynamic import keeps esbuild (a native-binary dependency) off the load path until a bundle runs.
  const esbuild = await import("esbuild");
  const { entry } = request;
  const options: BuildOptions = {
    bundle: true,
    external: request.external,
    format: "esm",
    logLevel: "silent",
    minify: request.minify,
    platform: esbuildPlatform(request.target),
    plugins: request.plugins,
    write: false,
  };
  if (request.conditions) {
    options.conditions = request.conditions;
  }
  if (request.define) {
    options.define = request.define;
  }
  if ("path" in entry) {
    options.entryPoints = [entry.path];
  } else {
    options.stdin = {
      contents: entry.source,
      loader: "js",
      resolveDir: entry.resolveDir,
      sourcefile: "jx-entry.js",
    };
  }
  const result = await esbuild.build({ ...options, write: false });
  return result.outputFiles[0]!.text;
}
