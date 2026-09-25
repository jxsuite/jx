// Records a spec release as a FRAGMENT under specs/changes/, to be minted on the release branch in
// Merge order by `spec:release`. This is the release form that cannot conflict: a fragment is its
// Own file, so two pull requests releasing the same spec never rewrite the same line (#335).
//
// Usage:
//   `bun run spec:change <spec.md> <major|minor|patch|stable> -m "<what changed>"`
// E.g.
//   `bun run spec:change ui.md minor -m "jx-switch's hint is a jx-tooltip while it can act"`
//
// The levels are `spec:bump`'s (major = breaking contract change, minor = additive, patch =
// Editorial, stable = graduate 0.x to 1.0.0). The gate (`docs:spec-release`) accepts a fragment
// In place of an in-file release; `spec:bump` is still there for a release that must be minted in
// The pull request itself.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { FRAGMENTS_DIR, fragmentName, isLevel, renderFragment } from "./lib/spec-release.ts";

const ROOT = resolve(import.meta.dir, "../..");

function die(message: string): never {
  console.error(`spec:change: ${message}`);
  console.error(
    '\nUsage: bun run spec:change <spec.md> <major|minor|patch|stable> -m "<what changed>"',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const messageFlag = args.findIndex((a) => a === "-m" || a === "--message");
if (messageFlag === -1) {
  die('a changelog summary is required (-m "<what changed>")');
}
const summary = (args[messageFlag + 1] ?? "").replaceAll(/\s+/g, " ").trim();
if (!summary) {
  die("the changelog summary (-m) is empty");
}
const positional = args.filter((_, i) => i !== messageFlag && i !== messageFlag + 1);
const [rawSpec, level] = positional;
if (!rawSpec) {
  die("which spec? e.g. ui.md");
}
if (!level || !isLevel(level)) {
  die(`level must be one of major|minor|patch|stable (got "${level ?? ""}")`);
}
const spec = basename(rawSpec).endsWith(".md") ? basename(rawSpec) : `${basename(rawSpec)}.md`;
if (!existsSync(join(ROOT, "specs", spec))) {
  die(`no such spec: specs/${spec}`);
}

const dir = join(ROOT, FRAGMENTS_DIR);
mkdirSync(dir, { recursive: true });
const name = fragmentName(spec, summary);
const path = join(dir, name);
if (existsSync(path)) {
  die(`${FRAGMENTS_DIR}/${name} already records this sentence for ${spec}`);
}
writeFileSync(path, renderFragment(spec, level, summary), "utf8");
console.log(`${FRAGMENTS_DIR}/${name}: ${spec} ${level} — ${summary}`);
console.log(
  "\nThe version is minted on the release branch, in merge order, by `bun run spec:release`; the " +
    "spec's own **Version:** and changelog are untouched here, which is what keeps two releases of " +
    "one spec from conflicting.",
);
