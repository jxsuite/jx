/**
 * Electrobun preBuild hook: build the studio bundle and the desktop init script, then stage both
 * into assets/ for `build.copy` to place in the bundle.
 *
 * Runs under HUTCH's runtime (Cottontail), not Bun — Hutch executes project TypeScript and shell
 * tasks with Cottontail regardless of the app's own `build.mainProcess`. Cottontail ships a `bun`
 * module shim, but its `$` shell fails on the `.cwd()` form this script used to use, so the
 * subprocesses go through node:child_process instead. That is portable across both runtimes, which
 * is what a build hook wants; the sibling chromium hook (pre-build-rpc.ts) is invoked by `bun run`
 * directly and is free to keep using Bun's shell.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initBundleArgs, initBundleProblems } from "./init-bundle";
import { stageStudioAssets } from "./stage-studio-assets";

const desktopDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopDir, "../..");

/** Run a command to completion, failing the build (non-zero exit) the way the hook contract wants. */
function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, shell: true, stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}`);
  }
}

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild] Building @jxsuite/studio…");
run("bun", ["run", "build"], resolve(desktopDir, "../studio"));

// ── 2. Build desktop init script ───────────────────────────────────────────

/* The init bundle is the one part of the app compiled by plain `bun build` rather than by Hutch, so
   `electrobun/view` resolves through tsconfig `paths` into the vendored submodule — NOT Hutch's
   `.hutch/devkit`. With the submodule absent the bundler silently falls back to
   `node_modules/electrobun`, whose every export is a module that throws, and the build still
   succeeds. Desktop 5.0.0 through 5.1.3 shipped exactly that: every release lane used a bare
   checkout, and the root `postinstall` skips its soft `--fix` under CI, so nothing materialised the
   submodule and every packaged launcher threw on import before registering a platform.

   Running `--init` here rather than trusting each workflow to makes every lane, a local build and
   `electrobun dev` safe by the same step. It checks out and narrows the submodule when it is
   missing and fails when it names a different release than the pin; it never moves the gitlink. */
console.log("[prebuild] Preparing the vendored Electrobun SDK…");
run("bun", ["scripts/check-electrobun-vendor.ts", "--init"], repoRoot);

console.log("[prebuild] Building desktop init script…");
run("bun", initBundleArgs("./src/init.ts", "./assets/studio/dist"), desktopDir);

// Judge what was built, not just that the build exited 0 — the 5.x bundles all exited 0.
const initProblems = initBundleProblems(
  readFileSync(resolve(desktopDir, "assets/studio/dist/init.js"), "utf8"),
  { electrobun: true },
);
if (initProblems.length > 0) {
  throw new Error(
    `assets/studio/dist/init.js would not boot the launcher:\n  ${initProblems.join("\n  ")}`,
  );
}

// ── 3. Copy + patch assets (shared with the chromium pre-build) ────────────

console.log("[prebuild] Staging studio assets into packages/desktop/assets/…");
await stageStudioAssets(desktopDir);

console.log("[prebuild] Done.");
