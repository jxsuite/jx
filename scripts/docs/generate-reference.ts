// Writes the product-data-derived reference pages under /docs. They are BUILD OUTPUTS, gitignored,
// Never committed: `postinstall` writes them so a fresh checkout reads whole, every docs gate that
// Reads the page set writes them first (`docs:check`, `docs:links`, `docs:sync`), and the site's
// Build writes them before `jx build` reads the collection. They cannot drift from the packages
// They document, because nothing ever holds a copy: the generators are pure functions of the tree.
//
// They were committed once, with a CI diff gate. Every spec release rewrote the same nine files, so
// Any two open pull requests that each released a spec conflicted on implementation-status.md and
// Spec-changelog.md by construction — a merge conflict that carried no information, on every pair.
//
// Usage: bun scripts/docs/generate-reference.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PAGES } from "./generators/pages.ts";

const ROOT = resolve(import.meta.dir, "../..");

const written: string[] = [];
for (const [relPath, generate] of Object.entries(PAGES)) {
  const path = join(ROOT, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generate(), "utf8");
  written.push(path);
  console.log(`wrote ${relPath}`);
}

// Format the written pages so what the site builds and the docs gates read is oxfmt-stable, the
// Same as every hand-written page beside them; a generator's output is not exempt from the
// Formatter's markdown rules only because nobody commits it.
const fmt = Bun.spawnSync(["bunx", "oxfmt", ...written], { cwd: ROOT });
if (fmt.exitCode !== 0) {
  console.error(fmt.stderr.toString() || fmt.stdout.toString());
  process.exit(fmt.exitCode);
}
