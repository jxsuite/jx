/**
 * Every version in `.release-please-manifest.json` must have actually shipped a GitHub release at
 * its tag.
 *
 * NOTHING ASKED THIS QUESTION BEFORE, and the answer was no for six weeks. Two independent ways to
 * lose a release, both of which exit 0:
 *
 * 1. Release-please drops a component whose changelog contains a raw `<tag>` (the defect written up in
 *    `commitlint.config.ts`). It logs "Pull request contains releases, but not for component:
 *    starters", creates the other 18, and succeeds. The manifest still says 1.5.0.
 * 2. The `release-please` job dies PART WAY THROUGH — a GitHub 5xx while it backfills file lists,
 *    which is exactly what a component with no tag provokes, because it forces a walk back through
 *    500 commits. Re-running the job then finds the pull request already labelled `autorelease:
 *    tagged`, so `releases_created` comes back `false` and `publish`, all four desktop bundlers,
 *    `nix-build` and `deploy-site` SKIP. A green run, no release.
 *
 * The visible damage from (1)+(2) was `@jxsuite/starters` sitting at 1.2.2 on npm while
 * `@jxsuite/create@1.3.2` and `@jxsuite/server@2.2.1` shipped declaring `^1.5.0` — so `npm install
 * @jxsuite/create` failed to resolve, for everyone, silently.
 *
 * This is the job that says so. It runs in `release-please.yml` with `if: always()`, so a crashed
 * or no-op release run still gets checked, and again on that workflow's daily schedule.
 *
 *     bun scripts/check-release-integrity.ts
 *
 * ## It deliberately does NOT ask npm, and there is evidence behind that
 *
 * It used to, and the registry probe was removed rather than made more patient. `npm publish`
 * printing `+ @jxsuite/ai@0.37.0` does not mean `npm view @jxsuite/ai@0.37.0` will find it: the
 * version's `time` entry in the packument is stamped when the registry finishes WRITING, and that
 * trails acceptance by up to three minutes, for a package or two per release, unpredictably. (On
 * the 2026-08-30 release: `connector` +76s, `site` +96s, `ai` +187s — and the other sixteen
 * packages in that same run were readable within a second.)
 *
 * So the probe filed an issue every time it raced a slow write. Every "Released versions that never
 * shipped" issue this repository has ever had, against when npm actually became readable:
 *
 *     #177  @jxsuite/ai@0.36.2         readable  39s AFTER the issue was filed
 *     #199  @jxsuite/connector@0.5.3   readable  36s AFTER the issue was filed
 *     #264  @jxsuite/ai@0.37.0         readable  82s AFTER the issue was filed
 *     #264  @jxsuite/site@1.1.0        readable   1s AFTER the issue was filed
 *
 * Nought for three: not one real catch, and three rounds of someone investigating a release that
 * was already fine. A detector whose every firing is noise teaches people to ignore the firing that
 * is not, which costs more than the check was ever worth.
 *
 * The release check is the half that had the value anyway. The six-week `starters` incident had NO
 * TAG AND NO RELEASE — not merely a missing publish — so this catches it. And it cannot fail the
 * way the npm probe did: `gh release view` is read-after-write consistent, so a 404 means the
 * release is genuinely absent rather than merely not replicated yet.
 *
 * ## Except on the daily sweep, behind a one-hour floor (`--npm`)
 *
 * What the release check cannot see is a release that exists while its publish does not. On the
 * 2026-10-17 release the publish loop died at `@jxsuite/catalog` (a new package with no npm trusted
 * publisher yet) and never attempted `@jxsuite/site@2.0.5` or `@jxsuite/runtime@5.0.0` behind it.
 * Both had a tag and a GitHub release, so this gate was green, and every package published after
 * them depended on versions npm did not have.
 *
 * So the SCHEDULED run passes `--npm`, and asks the registry about every npm-publishable component
 * whose GitHub release is MORE THAN ONE HOUR OLD, never about a younger one, and never on the
 * post-merge run. The lag that made the old probe 0-for-3 is at most minutes (187s was the worst
 * ever measured); an hour is about nineteen times that, so the floor cannot race it, which is the
 * difference between this and the "longer retry" the old probe would have needed. It is a floor on
 * the RELEASE's age, not a wait, and it also keeps the scheduled run from judging a release it
 * created itself minutes earlier. The sweep runs at 05:00 UTC, so a real gap is reported at the
 * first sweep more than an hour after the release: within 25 hours at worst. It would have reported
 * runtime and site at 05:00 on 2026-10-18, 12.8h after their releases.
 *
 * A registry answer that is neither 200 nor 404 (an outage, a rate limit) is printed as unknown and
 * does not fail the run: only a definite 404 is a finding.
 */

import { backfillCommand } from "./publish-released.ts";
import { readWorkspaces } from "./lib/workspaces.ts";

/** Release-please's config and the manifest it writes, repo-relative. */
export const RELEASE_PLEASE_CONFIG = "release-please-config.json";
export const RELEASE_PLEASE_MANIFEST = ".release-please-manifest.json";

interface PackageConfig {
  component?: string;
  "include-v-in-tag"?: boolean;
  "include-component-in-tag"?: boolean;
  "tag-separator"?: string;
}
interface Config {
  packages: Record<string, PackageConfig>;
  "include-v-in-tag"?: boolean;
  "include-component-in-tag"?: boolean;
  "tag-separator"?: string;
}

export interface ReleaseTarget {
  /** Repo-relative workspace directory, e.g. `packages/starters`. */
  path: string;
  /** The tag release-please would have created, e.g. `starters-v1.5.0`. */
  tag: string;
  version: string;
}

/**
 * Reproduce release-please's `TagName.toString()`: `<component><separator>v<version>`, with each
 * part defaulting at the top level and overridable per package. Derived rather than hardcoded so a
 * config change cannot make this gate quietly check the wrong tag.
 */
export function tagFor(path: string, version: string, config: Config): string {
  const pkg = config.packages[path] ?? {};
  const includeComponent =
    pkg["include-component-in-tag"] ?? config["include-component-in-tag"] ?? true;
  const includeV = pkg["include-v-in-tag"] ?? config["include-v-in-tag"] ?? true;
  const separator = pkg["tag-separator"] ?? config["tag-separator"] ?? "-";
  const component = pkg.component ?? path.split("/").at(-1)!;

  const prefix = includeComponent ? `${component}${separator}` : "";
  return `${prefix}${includeV ? "v" : ""}${version}`;
}

/**
 * The version release-please reads as "no release yet". A new component enters the manifest at
 * `0.0.0`, and release-please's own backfill (`manifest.js`, "backfill latest release tags from
 * manifest") skips exactly that string, so the first release pull request starts the component at
 * its `initial-version` rather than bumping from it. Such an entry CLAIMS nothing, and a gate that
 * demanded `ui-v0.0.0` of it would be red from the day a package is added until the day it is first
 * released — which is a red X that names no defect, the failure mode this script's header argues
 * against.
 */
export const UNRELEASED = "0.0.0";

/** What every manifest entry claims to have shipped. */
export async function readTargets(root = "."): Promise<ReleaseTarget[]> {
  /* SAFETY: release-please-config.json declares release-please's own config schema in `$schema`,
     and release-please rejects a config that breaks it on every release run, so the four keys
     `tagFor` reads carry the types `Config` gives them. */
  const config = (await Bun.file(`${root}/${RELEASE_PLEASE_CONFIG}`).json()) as Config;
  // SAFETY: release-please writes this manifest itself, as one `"<path>": "<version>"` string per package.
  const manifest = (await Bun.file(`${root}/${RELEASE_PLEASE_MANIFEST}`).json()) as Record<
    string,
    string
  >;

  return Object.entries(manifest)
    .filter(([, version]) => version !== UNRELEASED)
    .map(([path, version]) => ({
      path,
      tag: tagFor(path, version, config),
      version,
    }));
}

/**
 * Does a GitHub RELEASE exist at this tag? A bare tag is not enough — the bundlers attach to the
 * release, and release-please creates both or neither.
 */
export type ReleaseExists = (tag: string) => Promise<boolean>;

/** The manifest entries whose release release-please never actually created. */
export async function findGaps(
  targets: ReleaseTarget[],
  releaseExists: ReleaseExists,
): Promise<ReleaseTarget[]> {
  const gaps: ReleaseTarget[] = [];
  for (const target of targets) {
    if (!(await releaseExists(target.tag))) {
      gaps.push(target);
    }
  }
  return gaps;
}

export function report(gaps: ReleaseTarget[]): string {
  const lines = gaps.map(
    (g) => `- **${g.path}** claims ${g.version} in the manifest — no GitHub release \`${g.tag}\``,
  );

  return [
    ...lines,
    "",
    "A missing GitHub release means release-please skipped the component. Check the " +
      "`release-please` job log for “Pull request contains releases, but not for component” " +
      "and read the header of `commitlint.config.ts`.",
    "",
    "Nothing was published for a component with no release, so once the release exists, " +
      "publish it with `gh workflow run release-please.yml -f backfill_paths='[\"<path>\"]' " +
      "-f backfill_sha=<tag>` — it is idempotent.",
  ].join("\n");
}

/** The npm half only judges releases older than this. See the header for why a day. */
export const NPM_AGE_FLOOR_MS = 60 * 60 * 1000;

/** A released, npm-publishable component, with when its GitHub release was published. */
export interface NpmTarget extends ReleaseTarget {
  /** The npm package name, e.g. `@jxsuite/runtime`. */
  name: string;
  releasedAt: Date;
}

/**
 * The targets the npm half may ask about: npm-publishable (`desktop` ships as installers and is
 * not), with a GitHub release (a missing one is the release half's finding), and released more than
 * `floor` before `now`.
 */
export function npmCandidates(
  targets: readonly ReleaseTarget[],
  workspaces: readonly { dir: string; name: string; publishable: boolean }[],
  releasedAt: ReadonlyMap<string, Date>,
  now: Date,
  floor = NPM_AGE_FLOOR_MS,
): NpmTarget[] {
  const candidates: NpmTarget[] = [];
  for (const target of targets) {
    const ws = workspaces.find((w) => w.dir === target.path);
    const at = releasedAt.get(target.tag);
    if (ws?.publishable && at && now.getTime() - at.getTime() > floor) {
      candidates.push({ ...target, name: ws.name, releasedAt: at });
    }
  }
  return candidates;
}

/** What the registry said about one version: a definite yes, a definite no, or no answer. */
export type NpmVersionState = "present" | "absent" | "unknown";

/** Ask the registry for one version's document: 200 is present, 404 absent, anything else unknown. */
export async function registryProbe(
  name: string,
  version: string,
  fetcher: (url: string) => Promise<{ status: number }> = (url) => fetch(url),
): Promise<NpmVersionState> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`;
  try {
    const { status } = await fetcher(url);
    if (status === 200) {
      return "present";
    }
    return status === 404 ? "absent" : "unknown";
  } catch {
    return "unknown";
  }
}

/** Split candidates by what the registry answered. */
export async function findUnpublished(
  candidates: readonly NpmTarget[],
  probe: (name: string, version: string) => Promise<NpmVersionState>,
): Promise<{ absent: NpmTarget[]; unknown: NpmTarget[] }> {
  const absent: NpmTarget[] = [];
  const unknown: NpmTarget[] = [];
  for (const c of candidates) {
    const state = await probe(c.name, c.version);
    if (state === "absent") {
      absent.push(c);
    } else if (state === "unknown") {
      unknown.push(c);
    }
  }
  return { absent, unknown };
}

export function npmReport(absent: readonly NpmTarget[], now: Date): string {
  const hours = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 3_600_000);
  return [
    ...absent.map(
      (a) =>
        `- **${a.name}@${a.version}** has had a GitHub release (\`${a.tag}\`) for ${hours(a.releasedAt)}h ` +
        "and is NOT on npm",
    ),
    "",
    "Anything that depends on these fails to install. The publish job attempts every package and " +
      "names each failure in its summary; fix the cause there (an `E404` on `PUT` for a new package " +
      "means npm has no trusted publisher for it yet), then publish from each release tag:",
    "",
    ...absent.map((a) => `    ${backfillCommand([a.path], a.tag)}`),
  ].join("\n");
}

if (import.meta.main) {
  const checkNpm = process.argv.includes("--npm");
  const releasedAt = new Map<string, Date>();
  const releaseExists: ReleaseExists = async (tag) => {
    const proc = Bun.spawnSync(
      ["gh", "release", "view", tag, "--json", "publishedAt", "--jq", ".publishedAt"],
      { stderr: "ignore" },
    );
    if (proc.exitCode !== 0) {
      return false;
    }
    const at = new Date(proc.stdout.toString().trim());
    if (!Number.isNaN(at.getTime())) {
      releasedAt.set(tag, at);
    }
    return true;
  };

  const targets = await readTargets();
  const gaps = await findGaps(targets, releaseExists);
  let failed = false;

  if (gaps.length === 0) {
    console.log(`All ${targets.length} released components have a GitHub release.`);
  } else {
    failed = true;
    console.error(`${gaps.length} of ${targets.length} released components never shipped:\n`);
    console.error(report(gaps));
  }

  if (checkNpm) {
    const now = new Date();
    const candidates = npmCandidates(targets, await readWorkspaces(), releasedAt, now);
    const { absent, unknown } = await findUnpublished(candidates, (name, version) =>
      registryProbe(name, version),
    );
    for (const u of unknown) {
      console.log(`::warning::npm gave no definite answer for ${u.name}@${u.version}; not judged`);
    }
    if (absent.length === 0) {
      console.log(
        `All ${candidates.length} npm packages released more than an hour ago are readable on npm.`,
      );
    } else {
      failed = true;
      console.error(
        `\n${absent.length} of ${candidates.length} npm packages released more than an hour ago are not on npm:\n`,
      );
      console.error(npmReport(absent, now));
    }
  }

  process.exit(failed ? 1 : 0);
}
