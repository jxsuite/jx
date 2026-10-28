/**
 * Bundler.js — timing-aware module bundling for compiled sites
 *
 * One backend abstraction serving every bundling need of the build (spec.md §12, compiler.md):
 * client-timing `$src` sidecars today, the server worker in a follow-up. The backend is chosen at
 * resolution time by the `#bundler-backend` import (`bundler-backend.ts`): `Bun.build` under Bun,
 * esbuild everywhere else, so a Node build of this module carries no Bun code. Options are kept
 * minimal and identical across backends so output stays as stable as possible; set
 * `JX_BUNDLER=esbuild` to force esbuild under Bun (e.g. for parity checks).
 *
 * `timing: "compiler"` code is never bundled — it executes in the build host via the extension
 * registry's `importImplementation` path.
 */

import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { isNpmSpecifier, NPM_SPECIFIER_PREFIX } from "@jxsuite/schema/asset-paths";
import * as backend from "#bundler-backend";
import type {
  BackendBuild,
  BundlePlugin,
  BundleTargetName,
  PluginBuild,
} from "./bundler-backend.ts";
import { TRANSIENT_ENTRY_PREFIX } from "./bundler-backend.ts";

export type { BundleTargetName } from "./bundler-backend.ts";

/** Import specifiers left external in client bundles — provided by the page importmap. */
export const CLIENT_EXTERNALS = ["@vue/reactivity", "lit-html"];

/**
 * True when a Function-def `$src` specifier is bundled by the build: `npm:` package specifiers and
 * project-relative files. Absolute URL paths (`/lib/x.js`, `https://…`) are served as-is.
 */
export function isBundleableSrc(specifier: string): boolean {
  return isNpmSpecifier(specifier) || specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * True when the esbuild backend is the one bundling: always outside Bun, or when
 * `JX_BUNDLER=esbuild` forces it for parity checks.
 */
export function useNodeFallback(): boolean {
  return backend.backendName() === "esbuild";
}

/**
 * Resolve a bundleable `$src` specifier to the absolute entry file the bundler starts from. `npm:`
 * specifiers resolve from the project root (project node_modules first, then up-tree); relative
 * specifiers resolve against the directory of the document that declared them.
 */
export function resolveSidecarEntry(
  specifier: string,
  docDir: string,
  projectRoot: string,
): string {
  if (isNpmSpecifier(specifier)) {
    return backend.resolveBare(specifier.slice(NPM_SPECIFIER_PREFIX.length), projectRoot);
  }
  return resolve(docDir, specifier);
}

/**
 * Resolve a bare specifier as an import from a module in `fromDir`, through the active backend's
 * resolver. Throws when it does not resolve.
 */
export function resolveBareSpecifier(specifier: string, fromDir: string): string {
  return backend.resolveBare(specifier, fromDir);
}

export interface BundleRequest {
  /** Absolute path of the module to bundle. */
  entryPath: string;
  /** Absolute path of the bundled output file. */
  outfile: string;
}

/**
 * A resolution hook, in the one shape both backends accept.
 *
 * `external: true` leaves the import in the output **as the source wrote it** — Bun ignores a
 * rewritten `path` for an external, so a caller that needs the two backends to agree returns the
 * specifier it was given and plans around the original text.
 */
export interface BundleResolver {
  /** Which specifiers the hook is consulted for. */
  filter: RegExp;
  /** `undefined` falls through to the bundler's own resolution. */
  resolve: (args: {
    path: string;
    importer: string;
  }) => { path: string; external: true } | undefined;
}

export interface BundleOptions {
  target: BundleTargetName;
  /** Bare specifiers left unresolved in the output. */
  external?: string[];
  /** Package.json export conditions for resolution (e.g. ["workerd", "worker"]). */
  conditions?: string[];
  /** Resolution hooks, applied before the bundler's own resolution. */
  resolver?: BundleResolver;
  /**
   * Whether to minify the bundle.
   *
   * Defaults to true for `target: "browser"` and false everywhere else: browser output is parsed on
   * someone else's phone, server output is read off a stack trace. Callers override it — the site
   * build from `build.minify`, and `jx dev` to keep a breakpoint on a line somebody wrote.
   */
  minify?: boolean;
  /**
   * Called with the absolute path of every file the bundler loads.
   *
   * The only way to ask a backend where a bare specifier _actually_ lands: resolution depends on
   * the target, the export conditions and the `NODE_ENV` define, so a caller that resolves the
   * specifier itself gets a different file than the bundle did — which is how the client runtime
   * used to hand pages the `node` build of a browser package.
   */
  onFileLoaded?: (path: string) => void;
}

/** Wrap the hooks as the one-plugin array both backends take. */
function hookPlugins(opts: BundleOptions): BundlePlugin[] {
  const { onFileLoaded, resolver } = opts;
  if (resolver === undefined && onFileLoaded === undefined) {
    return [];
  }
  const setup = (build: PluginBuild): void => {
    if (resolver !== undefined) {
      build.onResolve({ filter: resolver.filter }, (args) => resolver.resolve(args));
    }
    if (onFileLoaded !== undefined) {
      // Returning nothing hands the file back to the backend's own loader — this only observes.
      build.onLoad({ filter: /.*/ }, (args) => {
        onFileLoaded(args.path);
      });
    }
  };
  return [{ name: "jx-bundle-hooks", setup }];
}

/**
 * Per-adapter bundle options for the generated site worker (WinterTC runtimes). Cloudflare resolves
 * with workerd conditions and keeps `cloudflare:*`/`node:*` imports external (nodejs_compat
 * provides node builtins at runtime); node/bun bundle platform-native with builtins external by
 * construction.
 */
export function workerBundleOptions(adapter: string): BundleOptions {
  if (adapter === "cloudflare-workers" || adapter === "cloudflare-pages") {
    return {
      conditions: ["workerd", "worker"],
      external: ["cloudflare:*", "node:*"],
      target: "workerd",
    };
  }
  return { target: adapter === "bun" ? "bun" : "node" };
}

/**
 * Substitutions applied to browser bundles.
 *
 * `process` does not exist in a browser, so `process.env.NODE_ENV` has to be replaced by something
 * — but the value also decides which `exports` condition a package resolves to, and that is the
 * part that mattered. Bun reads it from the build's own `define` (it ignores a `NODE_ENV` set after
 * the process started), and with no answer it assumes development: `lit-html` was resolving to its
 * 31 kB dev build, which logs "Lit is in dev mode" into every visitor's console, instead of the 10
 * kB production one. esbuild already chose production, so the two backends were shipping different
 * code — exactly what this module exists to prevent.
 */
const BROWSER_DEFINE = { "process.env.NODE_ENV": '"production"' } as const;

/**
 * Whether this bundle is minified.
 *
 * Browser output defaults to minified and everything else to readable. Measured on jxsuite.com's
 * own deployed bytes, the six scripts a page loads go from 155,254 B to 64,994 B — and it is the 90
 * kB of source a phone no longer has to parse, not the 16 kB it no longer downloads, that moves
 * Total Blocking Time.
 *
 * This widens the backend divergence {@link BROWSER_DEFINE} warns about: the two minifiers agree on
 * semantics, not on bytes. A build that diffs `dist/` must pin one backend (`JX_BUNDLER=esbuild`).
 */
function shouldMinify(opts: BundleOptions): boolean {
  return opts.minify ?? opts.target === "browser";
}

/** The resolution options both backends spell the same way, present only when they apply. */
interface SharedResolution {
  conditions?: string[];
  define?: Record<string, string>;
}

/** Export conditions when the caller gave some, and {@link BROWSER_DEFINE} for browser bundles. */
function sharedResolution(opts: BundleOptions): SharedResolution {
  const shared: SharedResolution = {};
  if (opts.conditions) {
    shared.conditions = opts.conditions;
  }
  if (opts.target === "browser") {
    shared.define = { ...BROWSER_DEFINE };
  }
  return shared;
}

/** Every option {@link BundleOptions} decides, in the shape a backend takes. */
function backendOptions(opts: BundleOptions): Omit<BackendBuild, "entry"> {
  return {
    ...sharedResolution(opts),
    external: opts.external ?? [],
    minify: shouldMinify(opts),
    plugins: hookPlugins(opts),
    target: opts.target,
  };
}

/**
 * Bundle one entry module into a single self-contained ESM file. Throws with the backend's
 * diagnostics on failure.
 */
export async function bundleEntry(request: BundleRequest, opts: BundleOptions): Promise<void> {
  const code = await backend.build({ entry: { path: request.entryPath }, ...backendOptions(opts) });
  writeFileSync(request.outfile, code, "utf8");
}

/**
 * Bundle one entry module and return the code rather than writing it.
 *
 * For a host serving modules on demand (the dev server's and the desktop project server's bare
 * specifier routes, the live preview's runtime): what it needs is the text for a response body.
 */
export async function bundleToString(entryPath: string, opts: BundleOptions): Promise<string> {
  return backend.build({ entry: { path: entryPath }, ...backendOptions(opts) });
}

/**
 * True for the throwaway entry a {@link bundleSource} call is bundling, under either backend.
 *
 * A resolver hook needs it to tell the entry's OWN import apart from the imports of whatever that
 * import pulled in — the two want opposite answers, and only the importer distinguishes them.
 * esbuild bundles the string from stdin and names it `<stdin>`; Bun has no stdin input and writes a
 * real file.
 */
export function isTransientEntry(importer: string): boolean {
  return importer === "<stdin>" || basename(importer).startsWith(TRANSIENT_ENTRY_PREFIX);
}

/**
 * The file a bare specifier resolves to **through the bundler** — under the same target, export
 * conditions and `NODE_ENV` define the real bundle uses.
 *
 * `Bun.resolveSync` and `createRequire` answer a different question. Neither applies the export
 * conditions a browser bundle does, so both hand back the `node` or `development` build of a
 * package a page asked for the browser build of — the bug {@link BROWSER_DEFINE} exists to prevent,
 * reintroduced one layer up. Returns `undefined` when the specifier does not resolve at all.
 */
export async function resolveThroughBundler(
  specifier: string,
  resolveDir: string,
  opts: BundleOptions,
): Promise<string | undefined> {
  const loaded: string[] = [];
  const outfile = join(tmpdir(), `jx-resolve-${process.pid}.js`);
  try {
    await bundleSource(
      `export * from ${JSON.stringify(specifier)};\n`,
      { outfile, resolveDir },
      // The output is deleted in `finally` — this only wants the resolution, so never pay to minify.
      { ...opts, minify: false, onFileLoaded: (path) => loaded.push(path) },
    );
  } catch {
    return undefined;
  } finally {
    rmSync(outfile, { force: true });
  }
  return loaded.find((path) => !isTransientEntry(path));
}

/**
 * Bundle a source string rather than a file, resolving its imports from `resolveDir`.
 *
 * The indirection buys resolution control: what a bare specifier means depends on where you stand,
 * and the two callers stand in different places. Worker source resolves from the project root,
 * exactly as the unbundled source would have; the client runtime resolves from the compiler's own
 * directory, because the compiler is what depends on it.
 */
export async function bundleSource(
  source: string,
  { resolveDir, outfile }: { resolveDir: string; outfile: string },
  opts: BundleOptions,
): Promise<void> {
  const code = await backend.build({ entry: { resolveDir, source }, ...backendOptions(opts) });
  writeFileSync(outfile, code, "utf8");
}

/**
 * Bundle generated worker source into a self-contained module for the adapter's runtime. Bare and
 * relative specifiers resolve from the project root — exactly how the unbundled source would have
 * resolved when served from within the project.
 */
export async function bundleWorkerSource(
  source: string,
  { projectRoot, outfile, adapter }: { projectRoot: string; outfile: string; adapter: string },
): Promise<void> {
  await bundleSource(source, { outfile, resolveDir: projectRoot }, workerBundleOptions(adapter));
}
