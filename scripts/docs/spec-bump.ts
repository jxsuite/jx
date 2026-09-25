// Releases a spec IN PLACE, NOW: bumps the header + footer version, restamps **Updated:** to today,
// And prepends a `## Changelog` entry. This is the low-friction path that makes the release gate
// (check-spec-release.ts) cheap to satisfy, so spec versions stay meaningful.
//
// It is also the path on which two pull requests releasing the same spec collide (both rewrite the
// Version line and the top of the changelog). `bun run spec:change` records the same release as a
// FRAGMENT under specs/changes/ instead, minted on the release branch in merge order by
// `spec:release`; prefer it when someone else may be releasing the same spec. The gate accepts
// Either. The three edits themselves live in lib/spec-release.ts, shared by both.
//
// The `-draft` suffix is derived from the header **Status:** — Implemented specs release without
// It, everything else keeps it (check-spec-status.ts enforces the same rule). To graduate a spec,
// Set `**Status:** Implemented` first, then bump: the suffix drops automatically.
//
// The next version is computed from the HIGHER of this file and the same file on the base branch,
// So a branch forked before a release cannot re-mint a number main has already used. `--base <ref>`
// Overrides the ref; see resolveBaseVersion below for why it reads the tip rather than a merge base.
//
// Usage:
//   `bun run spec:bump <spec.md> <major|minor|patch|stable> -m "<what changed>"`
// E.g.
//   `bun run spec:bump server.md patch -m "Clarify proxy resolution order in §6.3"`
//   `bun run spec:bump server.md patch --base upstream/main -m "..."`
//
// Bump levels: `major` = breaking change to a documented contract, `minor` = additive (new
// Sections/behavior), `patch` = editorial (wording, examples, non-normative clarification),
// `stable` = graduate a 0.x spec to 1.0.0. While a spec is pre-1.0 (all of them today) the
// Release-please bump-minor-pre-major policy applies: `major` moves the minor, `minor` and
// `patch` both move the patch. That is the policy the reconstructed history was derived under.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isLevel, releaseSpecSource } from "./lib/spec-release.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SPECS_DIR = join(ROOT, "specs");

function die(message: string): never {
  console.error(`spec:bump: ${message}`);
  console.error(
    '\nUsage: bun run spec:bump <spec.md> <major|minor|patch|stable> -m "<what changed>"\n' +
      "  major = breaking contract change, minor = additive, patch = editorial,\n" +
      "  stable = graduate a 0.x spec to 1.0.0\n" +
      "  (pre-1.0: major moves the minor, minor and patch both move the patch)\n" +
      "  --base <ref>  the branch whose released version is the floor (default origin/main, main)",
  );
  process.exit(1);
}

// ─── Arguments ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const messageFlag = args.findIndex((a) => a === "-m" || a === "--message");
if (messageFlag === -1) {
  die('a changelog summary is required (-m "<what changed>")');
}
const summary = (args[messageFlag + 1] ?? "").replaceAll(/\s+/g, " ").trim();
if (!summary) {
  die("the changelog summary (-m) is empty");
}
const baseFlag = args.indexOf("--base");
const explicitBase = baseFlag === -1 ? null : (args[baseFlag + 1] ?? null);
if (baseFlag !== -1 && (!explicitBase || explicitBase.startsWith("-"))) {
  // Without this, `--base -m "..."` swallows the message flag as a ref and reports "no such git
  // Ref", which sends you looking at your remotes instead of at your command line.
  die(`--base needs a git ref (got ${explicitBase ? `"${explicitBase}"` : "nothing"})`);
}
// Only the flags actually present consume an index. `baseFlag + 1` is 0 when --base is absent,
// Which would eat the spec name.
const consumed = new Set([messageFlag, messageFlag + 1]);
if (baseFlag !== -1) {
  consumed.add(baseFlag);
  consumed.add(baseFlag + 1);
}
const positional = args.filter((_, i) => !consumed.has(i));
const [rawSpec, bump] = positional;
if (!rawSpec) {
  die("which spec? e.g. server.md");
}
if (!bump || !isLevel(bump)) {
  die(`bump must be one of major|minor|patch|stable (got "${bump ?? ""}")`);
}

const file = basename(rawSpec).endsWith(".md") ? basename(rawSpec) : `${basename(rawSpec)}.md`;
const path = join(SPECS_DIR, file);
if (!existsSync(path)) {
  die(`no such spec: specs/${file}`);
}

// ─── Release ─────────────────────────────────────────────────────────────────

const source = readFileSync(path, "utf8");

function gitSafe(gitArgs: string[]): string | null {
  try {
    return execFileSync("git", gitArgs, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * The version this spec already carries on the base branch, or null when that cannot be read.
 *
 * This existed because `spec:bump` used to read only the working file. A branch forked before a
 * release on main would see the old version, mint the next one, and land a number main had already
 * used — two changelog entries claiming `0.9.31-draft`. Nothing said so until the merge, where it
 * surfaced as check-spec-status's "changelog must run newest-first — 0.9.31-draft is not older than
 * 0.9.31-draft": true, but it names the ordering symptom, and the fix is renumbering the header,
 * the footer and every entry above the collision by hand.
 *
 * It reads the base's TIP, deliberately, which is where this differs from check-spec-release.ts.
 * That script asks "did the body change since I forked", which is a merge-base question. This asks
 * "is the number I am about to mint already taken", and only the tip knows.
 *
 * Every failure path returns null and the local version stands: an unfetched or missing ref, a
 * shallow clone, no network, or a spec that does not exist on the base yet because it is new. A
 * stale `origin/main` therefore under-reports rather than blocking — which is why the ref and the
 * version it found are printed whenever they move the answer.
 */
function resolveBaseSource(): { ref: string; text: string } | null {
  const candidates = explicitBase ? [explicitBase] : ["origin/main", "main"];
  for (const ref of candidates) {
    if (!gitSafe(["rev-parse", "--verify", `${ref}^{commit}`])) {
      // An explicit ref that does not resolve is a typo worth stopping for. A default one that
      // Does not is just a repo without it — try the next, then give up quietly.
      if (explicitBase) {
        die(`--base ${explicitBase}: no such git ref`);
      }
      continue;
    }
    // The ref exists but the spec does not: a spec added on this branch has no base version, which
    // Is not an error at any level. It simply has no floor.
    const text = gitSafe(["show", `${ref}:specs/${file}`]);
    return text ? { ref, text } : null;
  }
  return null;
}

const base = resolveBaseSource();
const today = new Date().toISOString().slice(0, 10);
let released: ReturnType<typeof releaseSpecSource>;
try {
  released = releaseSpecSource(source, file, bump, summary, base?.text ?? null, today);
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
const nextVersion = released.version;
writeFileSync(path, released.source, "utf8");

// Keep the committed form oxfmt-stable (specs are in nano-staged's *.md scope).
const fmt = Bun.spawnSync(["bunx", "oxfmt", path], { cwd: ROOT });
if (fmt.exitCode !== 0) {
  console.error(fmt.stderr.toString() || fmt.stdout.toString());
  process.exit(fmt.exitCode);
}

if (released.raised && base) {
  console.log(
    `specs/${file}: ${base.ref} already released ${released.floor}, so this bumps from there rather ` +
      `than from the local ${released.from}.`,
  );
}
console.log(`specs/${file}: ${released.from} → ${nextVersion} (${today})`);
console.log(
  `  - **${nextVersion}** (${today}) — ${summary.endsWith(".") ? summary : `${summary}.`}`,
);
console.log(
  "\nThe derived reference pages (implementation status, spec changelog) are build outputs: " +
    "`bun run docs:generate` previews them locally; nothing to commit. If someone else may be " +
    "releasing this spec too, `bun run spec:change` records a fragment instead and avoids the merge.",
);
