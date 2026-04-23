/**
 * Pre-build.js — Electrobun preBuild hook for @jxsuite/desktop
 *
 * Runs before Electrobun assembles the app bundle. It:
 *
 * 1. Builds @jxsuite/studio → packages/studio/dist/{studio.js, studio.css}
 * 2. Builds the desktop init script → packages/desktop/assets/studio/dist/init.js
 * 3. Patches the studio index.html to load init.js before studio.js
 * 4. Copies everything into packages/desktop/assets/ for bundling
 *
 * Environment variables available (set by Electrobun CLI): ELECTROBUN_BUILD_ENV dev | canary |
 * stable ELECTROBUN_OS macos | linux | win
 */

import { $ } from "bun";
import { resolve, join } from "node:path";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";

const desktopDir = resolve(import.meta.dir, ".."); // packages/desktop
const studioDir = resolve(desktopDir, "../studio"); // packages/studio
const assetsDir = join(desktopDir, "assets");

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild] Building @jxsuite/studio…");
await $`bun run build`.cwd(studioDir);

// ── 2. Build desktop init script ───────────────────────────────────────────
// This bundles src/init.js + src/platform.js + the RPC schema into a single
// browser-targeted JS file that registers the DesktopPlatform adapter.

console.log("[prebuild] Building desktop init script…");
await $`bun build ./src/init.js --outdir ./assets/studio/dist --target browser --sourcemap=linked`.cwd(
  desktopDir,
);

// ── 3. Copy + patch assets ─────────────────────────────────────────────────

console.log("[prebuild] Staging studio assets into packages/desktop/assets/…");
await mkdir(join(assetsDir, "studio", "dist"), { recursive: true });

// Copy studio CSS + JS
await copyFile(
  join(studioDir, "dist", "studio.css"),
  join(assetsDir, "studio", "dist", "studio.css"),
);
await copyFile(
  join(studioDir, "dist", "studio.js"),
  join(assetsDir, "studio", "dist", "studio.js"),
);

// Patch index.html: insert init.js script tag before studio.js
const html = await readFile(join(studioDir, "index.html"), "utf8");
const patched = html.replace(
  '<script type="module" src="./dist/studio.js"></script>',
  '<script type="module" src="./dist/init.js"></script>\n  <script type="module" src="./dist/studio.js"></script>',
);
await writeFile(join(assetsDir, "studio", "index.html"), patched, "utf8");

console.log("[prebuild] Done.");
