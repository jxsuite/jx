import { $ } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initBundleArgs, initBundleProblems } from "./init-bundle";
import { stageStudioAssets } from "./stage-studio-assets";

const desktopDir = resolve(import.meta.dir, "..");

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild-rpc] Building @jxsuite/studio…");
await $`bun run build`.cwd(resolve(desktopDir, "../studio"));

// ── 2. Build chromium init script ────────────────────────────────────────

/* No `check-electrobun-vendor.ts --init` here, unlike the electrobun hook: this launcher imports no
   Electrobun, and it is what the Nix derivation builds, whose sandbox has neither network nor git
   to materialise a submodule with. The content check below still runs — it is what would notice an
   Electrobun import creeping into the chromium graph, since that would inline the throwing stub. */
console.log("[prebuild-rpc] Building chromium init script…");
await $`bun ${initBundleArgs("./src/chromium/init.ts", "./assets/studio/dist")}`.cwd(desktopDir);

const initProblems = initBundleProblems(
  readFileSync(resolve(desktopDir, "assets/studio/dist/init.js"), "utf8"),
  { electrobun: false },
);
if (initProblems.length > 0) {
  throw new Error(
    `assets/studio/dist/init.js would not boot the launcher:\n  ${initProblems.join("\n  ")}`,
  );
}

// ── 3. Copy + patch assets (shared with the electrobun pre-build) ──────────

console.log("[prebuild-rpc] Staging studio assets…");
await stageStudioAssets(desktopDir);

console.log("[prebuild-rpc] Done.");
