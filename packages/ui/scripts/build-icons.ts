/**
 * Regenerate `icons/manifest.json` from `icons/list.json` and the installed `@phosphor-icons/core`.
 *
 * Run it with `bun run --cwd packages/ui build:icons`.
 *
 * The manifest is committed: the kit has no build-time dependency at consume time, and a diff to it
 * is reviewable. The list is the allow-list — the bundle carries the glyphs the shell uses, not the
 * whole set — and a name the package does not know fails here, loudly, rather than drawing nothing
 * at runtime.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { buildManifest } from "../src/icons-build.ts";
import type { IconList } from "../src/icons-build.ts";

const here = dirname(new URL(import.meta.url).pathname);
const listPath = resolve(here, "../icons/list.json");
const manifestPath = resolve(here, "../icons/manifest.json");
const phosphorRoot = dirname(Bun.resolveSync("@phosphor-icons/core/package.json", here));

const list = JSON.parse(readFileSync(listPath, "utf8")) as IconList;
const manifest = buildManifest(list, (relativePath) => {
  const file = join(phosphorRoot, relativePath);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`icons/list.json names an icon Phosphor does not ship: ${relativePath}`);
  }
});

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const glyphs = Object.values(manifest.icons).reduce((n, entry) => n + Object.keys(entry).length, 0);
console.log(`icons/manifest.json: ${Object.keys(manifest.icons).length} names, ${glyphs} glyphs`);
