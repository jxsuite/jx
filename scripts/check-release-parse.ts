/**
 * Every message release-please could be handed for this pull request must be one it can parse.
 *
 * Release-please DROPS a commit it cannot parse, from every component, with nothing but a DEBUG log
 * line to say so. PR #466 was dropped that way: GitHub's default squash body concatenated its 56
 * non-merge branch commits (59 with the merges, which GitHub leaves out), one body line opened with
 * `` `toBe(strip())` ``, and the parser threw at line 790. `runtime`, `site` and `connector` got no
 * release and no changelog entry. The mechanism, and the reproduction of release-please's reading
 * of a message, are in `scripts/lib/release-please-commits.ts`.
 *
 * It runs in the `checks` job, next to `check-changelog-safety.ts`, over:
 *
 * - Every branch commit (a rebase merge lands each one on `main`). One that is not conventional at
 *   all ("Apply suggestions from code review") is a WARNING: release-please skips it without losing
 *   a release, and the squash message turns it into a bullet that parses fine;
 * - The squash message GitHub will propose, under the repository's squash settings when the token can
 *   read them and under `REPOSITORY_SQUASH_SETTINGS` when it cannot (GitHub hides them from a
 *   read-only token, and Dependabot's is one);
 * - Or, when the pull request body has a `BEGIN_COMMIT_OVERRIDE` block, only that block, because
 *   release-please then reads nothing else.
 *
 * The pull request's title and body are FETCHED rather than read from the event payload, so adding
 * an override block and re-running the job sees the new body (a re-run replays the old payload).
 * What this cannot see is a message edited by hand in the merge dialog.
 *
 *     bun scripts/check-release-parse.ts                                  # origin/main..HEAD
 *     bun scripts/check-release-parse.ts --from <sha> --to <sha> --pr <n>
 *
 * The same parse runs on every commit as you make it, through `.husky/commit-msg` (commitlint rule
 * `release-please-parseable`).
 */

import type { CliReport } from "./lib/cli-report.ts";
import {
  PARSE_ADVICE,
  SQUASH_MESSAGE_SETTINGS,
  SQUASH_TITLE_SETTINGS,
  checkPullRequest,
  describeFailures,
} from "./lib/release-please-commits.ts";
import type {
  BranchCommit,
  PullRequestInput,
  SquashMessageSetting,
  SquashTitleSetting,
} from "./lib/release-please-commits.ts";

/** A `git log` record: sha, author, raw message, each NUL-terminated. */
const RECORD = "%H%x00%an <%ae>%x00%B%x00";

/** Split `git log --format=RECORD` output into commits. */
export function parseAuthoredLog(stdout: string): BranchCommit[] {
  const fields = stdout.split("\0");
  const commits: BranchCommit[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const sha = fields[i]?.trim();
    const author = fields[i + 1];
    const message = fields[i + 2];
    if (sha && message !== undefined) {
      const commit: BranchCommit = { message, sha };
      if (author) {
        commit.author = author;
      }
      commits.push(commit);
    }
  }
  return commits;
}

/** A repository setting as GitHub spells it, or `undefined` for an absent or unknown value. */
export function titleSetting(value?: string): SquashTitleSetting | undefined {
  return SQUASH_TITLE_SETTINGS.find((s) => s === value);
}

/** A repository setting as GitHub spells it, or `undefined` for an absent or unknown value. */
export function messageSetting(value?: string): SquashMessageSetting | undefined {
  return SQUASH_MESSAGE_SETTINGS.find((s) => s === value);
}

/**
 * The whole run as a report, so the test can drive it without git or GitHub. `number: 0` means
 * there is no pull request (a local run), so there is no squash message and only the commits are
 * judged.
 */
export function run(input: PullRequestInput, range: string): CliReport {
  const local = input.number === 0;
  const result = checkPullRequest(input);
  const failures = local
    ? result.failures.filter((f) => f.source.startsWith("commit "))
    : result.failures;
  const squashForms = local ? 0 : result.checked.length - input.commits.length;
  const scope = result.override
    ? "the BEGIN_COMMIT_OVERRIDE block (release-please reads it instead of every commit message)"
    : `${input.commits.length} commit(s) in ${range} and ${squashForms} squash form(s)`;
  const warnings =
    result.warnings.length === 0
      ? []
      : [
          "",
          `::warning::${result.warnings.length} commit(s) are not conventional commits; release-please skips them, which loses nothing (they carry no release):`,
          ...result.warnings.map((w) => `  ${w.source}: ${w.header}`),
        ];
  if (failures.length === 0) {
    return {
      failed: false,
      lines: [`Checked ${scope}: release-please parses all of it.`, ...warnings],
    };
  }
  return {
    failed: true,
    lines: [
      `Checked ${scope}: ${failures.length} piece(s) release-please cannot parse.\n`,
      describeFailures(failures),
      "",
      PARSE_ADVICE,
      ...warnings,
    ],
  };
}

/** One `gh api … --jq` value, or `undefined` when the call fails (no token, no network). */
function ghValue(path: string, jq: string): string | undefined {
  const proc = Bun.spawnSync(["gh", "api", path, "--jq", jq], { stderr: "pipe" });
  return proc.exitCode === 0 ? proc.stdout.toString().replace(/\n$/, "") : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const from = arg("--from") ?? "origin/main";
  const to = arg("--to") ?? "HEAD";
  const pr = Number(arg("--pr") ?? 0);
  const repo = arg("--repo") ?? process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? "";
  const range = `${from}..${to}`;

  // GitHub leaves merge commits out of the squash body, and release-please cannot parse a "Merge
  // Pull request" subject anyway, so they are not judged. Oldest first, as GitHub lists them.
  const proc = Bun.spawnSync([
    "git",
    "log",
    "--no-merges",
    "--reverse",
    `--format=${RECORD}`,
    range,
  ]);
  if (proc.exitCode !== 0) {
    console.error(`git log ${range} failed — is the range fetched?\n${proc.stderr.toString()}`);
    process.exit(1);
  }
  const commits = parseAuthoredLog(proc.stdout.toString());

  let input: PullRequestInput = { body: "", commits, number: 0, title: "" };
  if (pr > 0) {
    const pulls = `repos/${repo}/pulls/${pr}`;
    const ts = titleSetting(ghValue(`repos/${repo}`, ".squash_merge_commit_title // empty"));
    const ms = messageSetting(ghValue(`repos/${repo}`, ".squash_merge_commit_message // empty"));
    input = {
      body: ghValue(pulls, '.body // ""') ?? process.env.PR_BODY ?? "",
      commits,
      messageSetting: ms,
      number: pr,
      title: ghValue(pulls, ".title") ?? process.env.PR_TITLE ?? "",
      titleSetting: ts,
    };
    console.log(
      ts && ms
        ? `Repository squash settings: title ${ts}, message ${ms}.`
        : "Squash settings are unreadable with this token (GitHub shows them only to push rights); using the repository's known ones.",
    );
  }

  const report = run(input, range);
  for (const line of report.lines) {
    if (report.failed) {
      console.error(line);
    } else {
      console.log(line);
    }
  }
  process.exit(report.failed ? 1 : 0);
}
