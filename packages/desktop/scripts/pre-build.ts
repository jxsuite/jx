/**
 * pre-build.ts — Electrobun preBuild hook for @jsonsx/desktop
 *
 * Runs before Electrobun assembles the app bundle.  It:
 *   1. Builds @jsonsx/studio  → packages/studio/dist/{studio.js, studio.css}
 *   2. Copies the studio HTML + compiled assets into packages/desktop/assets/
 *      so the electrobun.config.ts copy rules can bundle them into the app.
 *
 * Environment variables available (set by Electrobun CLI):
 *   ELECTROBUN_BUILD_ENV  dev | canary | stable
 *   ELECTROBUN_OS         macos | linux | win
 */

import { $ } from "bun";
import { resolve, join } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

const desktopDir = resolve(import.meta.dir, "..");           // packages/desktop
const studioDir  = resolve(desktopDir, "../studio");         // packages/studio
const assetsDir  = join(desktopDir, "assets");

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild] Building @jsonsx/studio…");
await $`bun run build`.cwd(studioDir);

// ── 2. Copy assets into packages/desktop/assets/ ──────────────────────────

console.log("[prebuild] Staging studio assets into packages/desktop/assets/…");

await mkdir(join(assetsDir, "studio", "dist"), { recursive: true });

await copyFile(
  join(studioDir, "index.html"),
  join(assetsDir, "studio", "index.html"),
);
await copyFile(
  join(studioDir, "dist", "studio.css"),
  join(assetsDir, "studio", "dist", "studio.css"),
);
await copyFile(
  join(studioDir, "dist", "studio.js"),
  join(assetsDir, "studio", "dist", "studio.js"),
);

console.log("[prebuild] Done.");
