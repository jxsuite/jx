import { $ } from "bun";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stageStudioAssets } from "./stage-studio-assets";

/**
 * Build the studio and stage what every window serves: `assets/studio`, the studio shell with the
 * desktop PAL init bundle in its boot slot. The Nix derivation, the checkout runner (`bun run
 * desktop`) and `stage-app.ts` all start here.
 */

const desktopDir = resolve(import.meta.dir, "..");

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild-rpc] Building @jxsuite/studio…");
await $`bun run build`.cwd(resolve(desktopDir, "../studio"));

// ── 2. Build the launcher's init script ────────────────────────────────────

console.log("[prebuild-rpc] Building the launcher init script…");
await $`bun build ./src/webview/init.ts --outdir ./assets/studio/dist --target browser --sourcemap=linked`.cwd(
  desktopDir,
);

/* `__jxLauncher` is the global src/boot.ts publishes before anything else runs; without it Studio
   cannot tell a launcher that failed to boot from a browser with no launcher at all. A bundle that
   lacks it is not this launcher's init, whatever else is in it. */
if (
  !readFileSync(resolve(desktopDir, "assets/studio/dist/init.js"), "utf8").includes("__jxLauncher")
) {
  throw new Error(
    "assets/studio/dist/init.js lacks the launcher boot signal (no `__jxLauncher`): src/boot.ts did not make it into the bundle",
  );
}

// ── 3. Copy + patch assets ─────────────────────────────────────────────────

console.log("[prebuild-rpc] Staging studio assets…");
await stageStudioAssets(desktopDir);

console.log("[prebuild-rpc] Done.");
