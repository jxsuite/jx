/**
 * The contract between `bundler.ts` and the backend that does the bundling.
 *
 * The backend is chosen at **resolution time** by the `#bundler-backend` import's conditions
 * (Node's conditional exports): `bundler-backend.bun.ts` under Bun, `bundler-backend.node.ts`
 * (esbuild) everywhere else. A build of this package for Node therefore contains no Bun code at
 * all, which is what lets the desktop backend run on Electron's Node (specs/desktop.md §7.1). Under
 * Bun, `JX_BUNDLER=esbuild` still forces the esbuild backend for parity checks.
 *
 * `bundler.ts` owns everything both backends agree on (the defines, the minify default, the hook
 * plugin); a backend owns only the call into its bundler and the spelling of its target.
 */

/** Resolution/runtime targets: client sidecars use "browser"; the site worker uses the rest. */
export type BundleTargetName = "browser" | "node" | "bun" | "workerd";

/**
 * The part of a plugin builder the hooks use, typed so that both Bun's `PluginBuilder` and
 * esbuild's `PluginBuild` are assignable to it: a plugin written against it is a plugin for either
 * backend.
 */
export interface PluginBuild {
  onResolve: (
    options: { filter: RegExp },
    callback: (args: {
      path: string;
      importer: string;
    }) => { path: string; external: true } | undefined,
  ) => void;
  /** An `undefined` result hands the file back to the backend's own loader. */
  onLoad: (options: { filter: RegExp }, callback: (args: { path: string }) => undefined) => void;
}

/** A plugin in the one shape both `Bun.build` and `esbuild.build` accept. */
export interface BundlePlugin {
  name: string;
  setup: (build: PluginBuild) => void;
}

/** One bundle, with every option already decided by `bundler.ts`. */
export interface BackendBuild {
  /** A file to start from, or source text resolved as though it sat in `resolveDir`. */
  entry: { path: string } | { source: string; resolveDir: string };
  target: BundleTargetName;
  external: string[];
  conditions?: string[];
  define?: Record<string, string>;
  minify: boolean;
  plugins: BundlePlugin[];
}

/** Basename prefix of the throwaway entry the Bun backend writes for a source entry. */
export const TRANSIENT_ENTRY_PREFIX = ".jx-entry-";
