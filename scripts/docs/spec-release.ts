// Mints every fragment under specs/changes/ into its spec, in the order the fragments landed, and
// Removes the fragments. What the release lane (.github/workflows/release-specs.yml) runs on the
// Release pull request's branch, so spec versions ride the same release as package versions and
// Are sequential in merge order; also the local preview of that.
//
// Usage:
//   `bun run spec:release`          mint every fragment into its spec, delete the fragments
//   `bun run spec:release --dry`    print what would be minted, change nothing
//
// The order is when each fragment LANDED (the first-parent commit that added it, which for a merged
// Pull request is the merge commit), so two fragments for one spec release in the order their pull
// Requests merged; a fragment git has not seen yet (a local preview) sorts last, by name. Each spec is read once and released once per fragment, so three
// Fragments for `studio.md` become three consecutive versions and three changelog lines.

import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FRAGMENTS_DIR,
  fragmentLandingClock,
  orderFragments,
  readFragments,
  releaseSpecSource,
} from "./lib/spec-release.ts";

const ROOT = resolve(import.meta.dir, "../..");
const dry = process.argv.includes("--dry");

const fragments = orderFragments(readFragments(ROOT), fragmentLandingClock(ROOT));
if (fragments.length === 0) {
  console.log("spec release: no fragments under specs/changes/; nothing to mint.");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
const released: string[] = [];
/* Each spec's source is carried in memory across its fragments, so consecutive fragments for one
   spec each read the version the previous one minted — in a dry run as much as a real one. The
   base is the working file itself: on the release branch the specs ARE main's. */
const sources = new Map<string, string>();
for (const fragment of fragments) {
  const source =
    sources.get(fragment.spec) ?? readFileSync(join(ROOT, "specs", fragment.spec), "utf8");
  const result = releaseSpecSource(
    source,
    fragment.spec,
    fragment.level,
    fragment.summary,
    null,
    today,
  );
  sources.set(fragment.spec, result.source);
  released.push(
    `${fragment.spec} ${result.from} → ${result.version} (${fragment.level}: ${fragment.summary})`,
  );
}

if (!dry) {
  for (const [spec, source] of sources) {
    writeFileSync(join(ROOT, "specs", spec), source, "utf8");
  }
  for (const fragment of fragments) {
    unlinkSync(join(ROOT, FRAGMENTS_DIR, fragment.name));
  }
  const paths = [...sources.keys()].map((spec) => join(ROOT, "specs", spec));
  const fmt = Bun.spawnSync(["bunx", "oxfmt", ...paths], { cwd: ROOT });
  if (fmt.exitCode !== 0) {
    console.error(fmt.stderr.toString() || fmt.stdout.toString());
    process.exit(fmt.exitCode);
  }
}
console.log(`spec release${dry ? " (dry)" : ""}: ${released.length} fragment(s) minted:`);
for (const line of released) {
  console.log(`  ${line}`);
}
