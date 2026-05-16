import { $ } from "bun";
import { resolve, join } from "node:path";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const desktopDir = resolve(import.meta.dir, "..");
const studioDir = resolve(desktopDir, "../studio");
const assetsDir = join(desktopDir, "assets");

// ── 1. Build studio ────────────────────────────────────────────────────────

console.log("[prebuild] Building @jxsuite/studio…");
await $`bun run build`.cwd(studioDir);

// ── 2. Build desktop init script ───────────────────────────────────────────

console.log("[prebuild] Building desktop init script…");
await $`bun build ./src/init.ts --outdir ./assets/studio/dist --target browser --sourcemap=linked`.cwd(
  desktopDir,
);

// ── 3. Copy + patch assets ─────────────────────────────────────────────────

console.log("[prebuild] Staging studio assets into packages/desktop/assets/…");
await mkdir(join(assetsDir, "studio", "dist"), { recursive: true });

await copyFile(
  join(studioDir, "dist", "studio.css"),
  join(assetsDir, "studio", "dist", "studio.css"),
);
await copyFile(
  join(studioDir, "dist", "studio.js"),
  join(assetsDir, "studio", "dist", "studio.js"),
);

const html = await readFile(join(studioDir, "index.html"), "utf8");
const patched = html.replace(
  '<script type="module" src="./dist/studio.js"></script>',
  '<script type="module" src="./dist/init.js"></script>\n  <script type="module" src="./dist/studio.js"></script>',
);
await writeFile(join(assetsDir, "studio", "index.html"), patched, "utf8");

// ── 4. Replace CEF libs with nix versions (if available) ──────────────────

const nixCefPath = process.env.NIX_CEF_BINARY;
if (nixCefPath && existsSync(nixCefPath)) {
  console.log(`[prebuild] Found nix CEF at ${nixCefPath}`);

  // Wait for Electrobun to create the build directory
  // (This happens after pre-build, so we'll do a post-build check)
  // For now, just note it for the post-build hook
  console.log(`[prebuild] CEF replacement will be applied post-build`);
}

console.log("[prebuild] Done.");
