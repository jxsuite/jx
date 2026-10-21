/**
 * Release-please's own reading of a commit message, reproduced so a pull request can be refused
 * BEFORE it merges with a message release-please would throw away.
 *
 * ## The failure this exists for
 *
 * Release-please parses every commit on `main` with `@conventional-commits/parser`. When the parser
 * throws, release-please logs `commit could not be parsed` at DEBUG level and drops the commit, for
 * every component at once: no changelog line, no version bump, no release, green run.
 *
 * PR #466 (`9d290e38`) was squash-merged with GitHub's default squash body, which concatenates
 * every branch commit message. One of those embedded bodies had a line that opens with ``
 * `toBe(strip())` printed both… ``. The parser reads a line-initial `word(` as the start of a
 * `type(scope)` token, finds a second `(` before the `)`, and throws `unexpected token '(' at
 * 790:12, valid tokens [)]`. So the whole of #466, a feature release of `runtime`, `site` and
 * `connector`, appeared in no changelog and released nothing.
 *
 * ## What is copied, from where
 *
 * Everything below mirrors release-please 17.11.2 `build/src/commit.js`, the version
 * `googleapis/release-please-action@v5` resolves (`"release-please": "^17.6.0"`):
 *
 * - `preprocessCommitMessage`: when the commit's pull request body has a `BEGIN_COMMIT_OVERRIDE`
 *   block, that block REPLACES the commit message entirely.
 * - `splitMessages`: `BEGIN_NESTED_COMMIT` blocks become their own messages, and the rest is split at
 *   every blank line followed by a conventional prefix. Each piece is parsed on its own, so one bad
 *   piece drops only itself.
 * - The parser is the same package at the same version, pinned exactly in the root `package.json`
 *   (`@conventional-commits/parser`, which release-please 17 declares as `^0.4.1`; 0.4.1 is the
 *   newest release).
 *
 * The squash message is GitHub's, not release-please's, and is composed by `composeSquashMessage`
 * below. Its doc comment states the format.
 */

import { parser } from "@conventional-commits/parser";

/** The split point release-please uses inside one message (release-please `splitMessages`). */
const CONVENTIONAL_SPLIT =
  /\r?\n\r?\n(?=(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\(.*?\))?: )/;

/**
 * The `BEGIN_COMMIT_OVERRIDE` block of a pull request body, trimmed, or `undefined` when there is
 * none or it is empty. An empty block is ignored by release-please too, which then falls back to
 * the commit message.
 */
export function overrideMessage(body: string | null | undefined): string | undefined {
  const inner = ((body ?? "").split("BEGIN_COMMIT_OVERRIDE")[1] ?? "")
    .split("END_COMMIT_OVERRIDE")[0]
    ?.trim();
  return inner || undefined;
}

/** Release-please's `splitMessages`, verbatim in behaviour. */
export function splitMessages(message: string): string[] {
  const parts = message.split("BEGIN_NESTED_COMMIT");
  const messages = [parts.shift() ?? ""];
  for (const part of parts) {
    const [nested, ...rest] = part.split("END_NESTED_COMMIT");
    messages.push(nested ?? "");
    messages[0] = `${messages[0]}${rest.join("END_NESTED_COMMIT")}`;
  }
  const conventional = (messages[0] ?? "").split(CONVENTIONAL_SPLIT).filter(Boolean);
  return [...conventional, ...messages.slice(1)];
}

/**
 * A commit-msg hook can be handed the editor buffer before git's own cleanup: `#` comment lines,
 * and with `--verbose` a scissors line followed by the whole diff. Git removes both before it
 * stores the message, so neither reaches release-please, and neither may be judged here.
 */
export function stripGitComments(raw: string): string {
  const lines = raw.replaceAll("\r\n", "\n").split("\n");
  const scissors = lines.findIndex((l) => /^# -+ >8 -+$/.test(l));
  return (scissors === -1 ? lines : lines.slice(0, scissors))
    .filter((l) => !l.startsWith("#"))
    .join("\n")
    .trim();
}

/** One piece of a message that release-please would throw away. */
export interface ParseFailure {
  /** Where the message came from, e.g. `commit 1a2b3c4d` or `squash message`. */
  source: string;
  /** The first line of the piece that failed: what release-please would have recorded. */
  header: string;
  /** 1-based line in the WHOLE message (not the piece) the parser stopped at. */
  line: number;
  /** 1-based column on that line. */
  column: number;
  /** That line, verbatim. */
  text: string;
  /** The parser's own message. */
  error: string;
}

const AT = /\bat (\d+):(\d+)\b/;

/**
 * Every piece of `message` that release-please would fail to parse, each located in the whole
 * message so the report can quote the line to reword.
 */
export function findParseFailures(source: string, message: string): ParseFailure[] {
  const lines = message.split("\n");
  const failures: ParseFailure[] = [];
  let cursor = 0;
  for (const piece of splitMessages(message)) {
    const offset = Math.max(message.indexOf(piece, cursor), 0);
    cursor = offset + piece.length;
    try {
      parser(piece);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const at = AT.exec(text);
      const pieceLine = at ? Number(at[1]) : 1;
      const column = at ? Number(at[2]) : 1;
      const line = message.slice(0, offset).split("\n").length - 1 + pieceLine;
      failures.push({
        column,
        error: text,
        header: piece.split("\n")[0] ?? "",
        line,
        source,
        text: lines[line - 1] ?? "",
      });
    }
  }
  return failures;
}

/** GitHub's `squash_merge_commit_title` repository setting. */
export type SquashTitleSetting = "PR_TITLE" | "COMMIT_OR_PR_TITLE";
/** GitHub's `squash_merge_commit_message` repository setting. */
export type SquashMessageSetting = "PR_BODY" | "COMMIT_MESSAGES" | "BLANK";

export const SQUASH_TITLE_SETTINGS: readonly SquashTitleSetting[] = [
  "COMMIT_OR_PR_TITLE",
  "PR_TITLE",
];
export const SQUASH_MESSAGE_SETTINGS: readonly SquashMessageSetting[] = [
  "COMMIT_MESSAGES",
  "PR_BODY",
  "BLANK",
];

/**
 * The squash settings this repository uses, read with push rights (`gh api repos/jxsuite/jx --jq
 * '[.squash_merge_commit_title, .squash_merge_commit_message]'`, 2026-10-21). GitHub returns the
 * two fields only to a token with push or admin rights, so the `contents: read` token of the
 * `checks` job, and Dependabot's read-only one, never see them. Guessing every setting instead
 * blocked real pull requests: under `PR_BODY` the description becomes the squash body, and
 * Dependabot's release-notes text (`ittyRouter.get('/hello', () => new Response(…`, #422) does not
 * parse, although the message GitHub actually composed for it did. Change this together with the
 * repository setting.
 */
export const REPOSITORY_SQUASH_SETTINGS = {
  messageSetting: "COMMIT_MESSAGES",
  titleSetting: "COMMIT_OR_PR_TITLE",
} as const satisfies Pick<SquashInput, "messageSetting" | "titleSetting">;

/**
 * A header shaped like a conventional commit (`type(scope)!: subject`), however malformed inside. A
 * branch commit whose header is not even that ("Apply suggestions from code review") is skipped by
 * release-please without losing anything, since it never carried a release, and in the squash
 * message it becomes a `* …` bullet that parses fine. Only a conventional commit the parser rejects
 * loses a release.
 */
const CONVENTIONAL_HEADER = /^[A-Za-z]+(?:\(.*\))?!?: \S/;

export interface BranchCommit {
  sha: string;
  /** The raw message, subject first. */
  message: string;
  /** `Name <email>` of the commit author, when known. */
  author?: string;
}

export interface SquashInput {
  number: number;
  title: string;
  body: string;
  commits: readonly BranchCommit[];
  titleSetting: SquashTitleSetting;
  messageSetting: SquashMessageSetting;
}

const CO_AUTHOR = /^co-authored-by:\s*(.+)$/gim;

function subjectAndBody(message: string) {
  const [subject = "", ...rest] = message.replaceAll("\r\n", "\n").split("\n");
  return { body: rest.join("\n").trim(), subject: subject.trim() };
}

/**
 * The commit message GitHub's "Squash and merge" button proposes, by default, for a pull request.
 *
 * Read off real squash commits on this repository (`git show -s 9d290e38`, 56 non-merge commits;
 * `chore(deps): bump nixpkgs (#471)`, one commit):
 *
 * - **Title.** `COMMIT_OR_PR_TITLE` uses the commit's subject when the branch has exactly one commit
 *   and the pull request title otherwise; `PR_TITLE` always uses the title. Either way GitHub
 *   appends ` (#<number>)`.
 * - **Body, `COMMIT_MESSAGES`.** One commit: that commit's body. Several: each commit as `*
 *   <subject>`, a blank line, then its body when it has one, joined by blank lines, oldest first.
 *   When anyone besides the merger authored or co-authored a commit, GitHub then appends a line of
 *   nine hyphens, a blank line and one `Co-authored-by: Name <email>` per distinct person. The
 *   merger cannot be known before the merge, so every distinct person is listed; the lines are
 *   trailers either way and parse the same.
 * - **Body, `PR_BODY`** is the pull request description; **`BLANK`** is empty.
 *
 * Commit messages are trimmed at the end, as the GitHub API returns them.
 */
export function composeSquashMessage(input: SquashInput): string {
  const commits = input.commits.map((c) => ({ ...c, ...subjectAndBody(c.message) }));
  const only = commits.length === 1 ? commits[0] : undefined;
  const title =
    input.titleSetting === "COMMIT_OR_PR_TITLE" && only ? only.subject : input.title.trim();
  const header = `${title} (#${input.number})`;

  let body = "";
  if (input.messageSetting === "PR_BODY") {
    body = input.body.replaceAll("\r\n", "\n").trim();
  } else if (input.messageSetting === "COMMIT_MESSAGES") {
    if (only) {
      ({ body } = only);
    } else {
      body = commits
        .map((c) => (c.body ? `* ${c.subject}\n\n${c.body}` : `* ${c.subject}`))
        .join("\n\n");
      const people = new Set<string>();
      for (const c of commits) {
        if (c.author) {
          people.add(c.author);
        }
        for (const m of c.body.matchAll(CO_AUTHOR)) {
          people.add((m[1] ?? "").trim());
        }
      }
      if (people.size > 0) {
        body += `\n\n---------\n\n${[...people].map((p) => `Co-authored-by: ${p}`).join("\n")}`;
      }
    }
  }
  return body ? `${header}\n\n${body}` : header;
}

export interface PullRequestCheck {
  /** True when the PR body carries a non-empty override, so commit messages are never read. */
  override: boolean;
  /** Every message checked, by source label, so the CLI can say how much it looked at. */
  checked: string[];
  failures: ParseFailure[];
  /** Branch commits that are not conventional at all: release-please skips them, losing nothing. */
  warnings: ParseFailure[];
}

export interface PullRequestInput {
  number: number;
  title: string;
  body: string;
  commits: readonly BranchCommit[];
  /**
   * The repository's settings, or `undefined` when the token could not read them, in which case
   * `REPOSITORY_SQUASH_SETTINGS` applies.
   */
  titleSetting?: SquashTitleSetting | undefined;
  messageSetting?: SquashMessageSetting | undefined;
}

/**
 * Everything release-please could be handed for this pull request, checked the way it reads it.
 *
 * With an override block in the body, release-please reads only that block, for the squash commit
 * and for every rebased commit alike, so only the block is checked. Without one, both merge methods
 * this repository allows are covered: every branch commit (a rebase merge lands each one) and the
 * squash message, under the repository's settings when the token can read them and under
 * `REPOSITORY_SQUASH_SETTINGS` when it cannot. A branch commit that is not conventional at all is a
 * warning, not a failure (see `CONVENTIONAL_HEADER`).
 */
export function checkPullRequest(input: PullRequestInput): PullRequestCheck {
  const override = overrideMessage(input.body);
  if (override) {
    const source = "BEGIN_COMMIT_OVERRIDE block";
    return {
      checked: [source],
      failures: findParseFailures(source, override),
      override: true,
      warnings: [],
    };
  }

  const checked: string[] = [];
  const failures: ParseFailure[] = [];
  const warnings: ParseFailure[] = [];
  for (const c of input.commits) {
    const source = `commit ${c.sha.slice(0, 8)}`;
    checked.push(source);
    for (const f of findParseFailures(source, c.message.trimEnd())) {
      (CONVENTIONAL_HEADER.test(f.header) ? failures : warnings).push(f);
    }
  }

  const titleSetting = input.titleSetting ?? REPOSITORY_SQUASH_SETTINGS.titleSetting;
  const messageSetting = input.messageSetting ?? REPOSITORY_SQUASH_SETTINGS.messageSetting;
  const source = `squash message (${titleSetting}, ${messageSetting})`;
  checked.push(source);
  failures.push(
    ...findParseFailures(source, composeSquashMessage({ ...input, messageSetting, titleSetting })),
  );
  return { checked, failures, override: false, warnings };
}

/**
 * Why a failure matters and the two ways out, worded once so the CI gate and the commit-msg hook
 * say the same thing.
 */
export const PARSE_ADVICE = [
  "release-please parses each commit with @conventional-commits/parser and silently DROPS a",
  "message it cannot parse, from every component at once: no changelog entry, no version bump, no",
  "release (.github/AGENTS.md, “An unparseable commit message drops it from every component”).",
  "The usual cause is a body line that opens with `name(` and holds a second `(` before the first",
  "`)`, such as `toBe(strip())` at the start of a line: put a word in front of it.",
  "",
  "Fix it either way:",
  "  1. Reword the line named above and force-push. For the squash message, that means rewording",
  "     the branch commit it came from (or the pull request title, for line 1).",
  "  2. Or add a block to the pull request description, which release-please reads INSTEAD of",
  "     every commit message of this pull request, then re-run this job:",
  "",
  "       BEGIN_COMMIT_OVERRIDE",
  "       feat(runtime): one conventional commit per paragraph",
  "",
  "       fix(site): another one",
  "       END_COMMIT_OVERRIDE",
].join("\n");

/** One readable paragraph per failure. */
export function describeFailures(failures: readonly ParseFailure[]): string {
  return failures
    .map(
      (f) =>
        `  ${f.source}, line ${f.line}:${f.column}\n` +
        `      | ${f.text}\n` +
        `      drops: ${f.header}\n` +
        `      parser: ${f.error}`,
    )
    .join("\n\n");
}
