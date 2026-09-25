/**
 * The launcher's PAL-init bundle (`views/studio/dist/init.js`): how it is built, and what a correct
 * one must contain.
 *
 * It is the one piece of the packaged app that plain `bun build` compiles rather than Hutch, so it
 * does NOT see Hutch's `.hutch/devkit`. `electrobun/view` resolves through
 * `packages/desktop/tsconfig.json` `paths` into the vendored `vendor/electrobun` submodule — and
 * when that submodule is not checked out, the bundler falls back to `node_modules/electrobun`,
 * whose `exports` map sends every specifier to `lib/moved.cjs`, a module whose whole body is `throw
 * new Error(...)`. Nothing about that fails the build: it inlines the throw as `require_moved`, the
 * file exists, and the app ships a launcher that throws on import and never registers a platform.
 * Every desktop release from 5.0.0 through 5.1.3 did exactly that, because no release lane checked
 * the submodule out.
 *
 * So both the pre-build hooks (right after they bundle) and the post-build gate (on the packaged
 * copy) judge the bundle's CONTENT here, not merely its existence. Kept in its own module, free of
 * Bun-only APIs, because `pre-build.ts` runs under Hutch's Cottontail runtime.
 */

/** `bun build` arguments for an init entry point. One definition for both launchers' hooks. */
export function initBundleArgs(entry: string, outdir: string): string[] {
  return ["build", entry, "--outdir", outdir, "--target", "browser", "--sourcemap=linked"];
}

/**
 * Why a built init bundle would throw on import or never announce itself; empty when it is sound.
 *
 * `electrobun` says whether this bundle is the Electrobun launcher's (`src/init.ts`), which must
 * inline the real view SDK, or the chromium launcher's (`src/chromium/init.ts`), which imports no
 * Electrobun at all. The checks are on strings the bundler emits, deliberately: the path comment
 * and `require_moved` are exactly what the 5.1.3 bundle carries, and `class Electroview` is the
 * SDK's own declaration, so its absence means the SDK did not make it in by any route.
 */
export function initBundleProblems(code: string, opts: { electrobun: boolean }): string[] {
  const problems: string[] = [];
  if (code.includes("node_modules/electrobun/") || code.includes("require_moved")) {
    problems.push(
      "it inlines node_modules/electrobun's throwing stub (lib/moved.cjs), so it throws on import — " +
        "the vendored SDK was not checked out; run `bun scripts/check-electrobun-vendor.ts --init` " +
        "from the repository root",
    );
  }
  if (opts.electrobun && !code.includes("class Electroview")) {
    problems.push("the Electrobun view SDK is not inlined (no `class Electroview`)");
  }
  /* `__jxLauncher` is the global src/boot.ts publishes before anything else runs; without it the
     studio cannot tell a launcher that failed to boot from a browser with no launcher at all. */
  if (!code.includes("__jxLauncher")) {
    problems.push("the launcher boot signal (src/boot.ts) is missing (no `__jxLauncher`)");
  }
  return problems;
}
