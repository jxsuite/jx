/**
 * Covers `scripts/lib/release-please-commits.ts` and `scripts/check-release-parse.ts`: the gate
 * that would have refused PR #466 before it merged with a squash message release-please threw
 * away.
 *
 * The fixture is real: three of PR #466's 56 branch commits, as the GitHub API returned them,
 * including `8d282434`, whose body line `` `toBe(strip())` printed both… `` made
 * `@conventional-commits/parser` throw. The parser is the real one, at the version release-please
 * 17 resolves, so a pass here is a statement about release-please and not about a mock.
 */

import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { messageSetting, parseAuthoredLog, run, titleSetting } from "./check-release-parse.ts";
import {
  PARSE_ADVICE,
  REPOSITORY_SQUASH_SETTINGS,
  checkPullRequest,
  composeSquashMessage,
  findParseFailures,
  overrideMessage,
  splitMessages,
  stripGitComments,
} from "./lib/release-please-commits.ts";
import type { BranchCommit } from "./lib/release-please-commits.ts";

/* SAFETY: the fixture is committed beside this file, written from `gh api …/pulls/466/commits`
   as an array of `{ sha, message, author }` string records, which is `BranchCommit[]`. */
const PR466 = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/pr466-commits.json"), "utf8"),
) as BranchCommit[];
const TITLE = "feat(studio): five workspaces: Design, Content, Media, Styles, Publish";

const commit = (message: string, sha = "a".repeat(40)): BranchCommit => ({ message, sha });

describe("findParseFailures (the real parser, release-please's reading)", () => {
  test("PR #466's offending commit fails exactly where release-please said it did", () => {
    const bad = PR466[1]!;
    const failures = findParseFailures("commit", bad.message);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.text).toStartWith("`toBe(strip())` printed both");
    expect(failures[0]!.error).toContain("unexpected token '('");
    expect(failures[0]!.error).toContain("valid tokens [)]");
    expect(failures[0]!.header).toBe(bad.message.split("\n")[0]!);
  });

  test("the discriminator is a line-initial `name(` holding a second `(`", () => {
    expect(findParseFailures("x", "fix: a\n\nfoo(bar()) printed")).toHaveLength(1);
    expect(findParseFailures("x", "fix: a\n\nfoo(bar) printed")).toEqual([]);
    expect(findParseFailures("x", "fix: a\n\nsee foo(bar()) printed")).toEqual([]);
  });

  test("passes ordinary conventional commits, trailing newline or not", () => {
    expect(findParseFailures("x", "fix(site): raise the ceiling\n")).toEqual([]);
    expect(findParseFailures("x", "feat!: drop it\n\nBREAKING CHANGE: gone")).toEqual([]);
  });

  test("a non-conventional subject is a failure too: release-please drops it the same way", () => {
    const [failure] = findParseFailures("x", "Update things");
    expect(failure?.line).toBe(1);
  });

  test("locates a failure in a LATER piece by its line in the whole message", () => {
    const message = "feat: one\n\nbody\n\nfix: two\n\nRoot\na(b(c)) x";
    const failures = findParseFailures("x", message);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.line).toBe(8);
    expect(failures[0]!.text).toBe("a(b(c)) x");
    expect(failures[0]!.header).toBe("fix: two");
  });

  test("an error without a position is still reported, at line 1", () => {
    const [failure] = findParseFailures("x", "");
    expect(failure?.line ?? 1).toBe(1);
  });
});

describe("splitMessages (release-please's)", () => {
  test("splits at a blank line followed by a conventional prefix, and only there", () => {
    expect(splitMessages("feat: a\n\nfix(x): b\n\n* feat: c")).toEqual([
      "feat: a",
      "fix(x): b\n\n* feat: c",
    ]);
  });

  test("lifts nested commits out of the main message", () => {
    expect(splitMessages("chore: a\nBEGIN_NESTED_COMMIT\nfix: n\nEND_NESTED_COMMIT\ntail")).toEqual(
      ["chore: a\n\ntail", "\nfix: n\n"],
    );
  });
});

describe("overrideMessage", () => {
  test("reads the block release-please reads, trimmed", () => {
    expect(
      overrideMessage("intro\nBEGIN_COMMIT_OVERRIDE\n\nfeat: x\n\nEND_COMMIT_OVERRIDE\nmore"),
    ).toBe("feat: x");
  });

  test("an absent or empty block is no override, as in release-please", () => {
    expect(overrideMessage("no block")).toBeUndefined();
    expect(overrideMessage("BEGIN_COMMIT_OVERRIDE\n  \nEND_COMMIT_OVERRIDE")).toBeUndefined();
    expect(overrideMessage(null)).toBeUndefined();
  });
});

describe("stripGitComments", () => {
  test("drops comment lines and everything below the scissors, as git does", () => {
    expect(
      stripGitComments(
        "fix: a\n\nbody\n# a comment\n# ------------------------ >8 ------------------------\ndiff(x(y))",
      ),
    ).toBe("fix: a\n\nbody");
  });
});

describe("composeSquashMessage (GitHub's default squash format)", () => {
  test("several commits: `* subject`, blank, body, and the co-author trailer block", () => {
    const message = composeSquashMessage({
      body: "",
      commits: [
        {
          author: "A <a@x>",
          message: "feat: one\n\nBody one.\n\nCo-Authored-By: C <c@x>",
          sha: "1",
        },
        { author: "B <b@x>", message: "fix: two", sha: "2" },
      ],
      messageSetting: "COMMIT_MESSAGES",
      number: 7,
      title: "feat: the title",
      titleSetting: "COMMIT_OR_PR_TITLE",
    });
    expect(message).toBe(
      [
        "feat: the title (#7)",
        "",
        "* feat: one",
        "",
        "Body one.",
        "",
        "Co-Authored-By: C <c@x>",
        "",
        "* fix: two",
        "",
        "---------",
        "",
        "Co-authored-by: A <a@x>",
        "Co-authored-by: C <c@x>",
        "Co-authored-by: B <b@x>",
      ].join("\n"),
    );
  });

  test("one commit: its own subject and body under COMMIT_OR_PR_TITLE", () => {
    const one = { body: "", commits: [commit("chore(deps): bump nixpkgs\n\nWhy.\n")], number: 471 };
    expect(
      composeSquashMessage({
        ...one,
        messageSetting: "COMMIT_MESSAGES",
        title: "ignored",
        titleSetting: "COMMIT_OR_PR_TITLE",
      }),
    ).toBe("chore(deps): bump nixpkgs (#471)\n\nWhy.");
    expect(
      composeSquashMessage({
        ...one,
        messageSetting: "BLANK",
        title: "chore: the title",
        titleSetting: "PR_TITLE",
      }),
    ).toBe("chore: the title (#471)");
  });

  test("PR_BODY uses the description", () => {
    expect(
      composeSquashMessage({
        body: "Summary\r\n",
        commits: [],
        messageSetting: "PR_BODY",
        number: 1,
        title: "fix: t",
        titleSetting: "PR_TITLE",
      }),
    ).toBe("fix: t (#1)\n\nSummary");
  });

  test("PR #466's squash message, rebuilt from its commits, fails like the real one", () => {
    const message = composeSquashMessage({
      body: "",
      commits: PR466,
      messageSetting: "COMMIT_MESSAGES",
      number: 466,
      title: TITLE,
      titleSetting: "COMMIT_OR_PR_TITLE",
    });
    // The real one is the commit 9d290e38; release-please logged the same error against it.
    expect(message.split("\n")[0]).toBe(`${TITLE} (#466)`);
    const failures = findParseFailures("squash", message);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.header).toBe(`${TITLE} (#466)`);
    expect(failures[0]!.text).toStartWith("`toBe(strip())`");
  });
});

describe("checkPullRequest", () => {
  const base = { body: "", commits: PR466, number: 466, title: TITLE };

  test("PR #466 as it was merged: the commit and the squash message are both refused", () => {
    const result = checkPullRequest({
      ...base,
      messageSetting: "COMMIT_MESSAGES",
      titleSetting: "COMMIT_OR_PR_TITLE",
    });
    expect(result.override).toBe(false);
    expect(result.failures.map((f) => f.source)).toEqual([
      "commit 8d282434",
      "squash message (COMMIT_OR_PR_TITLE, COMMIT_MESSAGES)",
    ]);
  });

  test("unreadable settings fall back to the repository's own, not to every setting", () => {
    expect(REPOSITORY_SQUASH_SETTINGS).toEqual({
      messageSetting: "COMMIT_MESSAGES",
      titleSetting: "COMMIT_OR_PR_TITLE",
    });
    const result = checkPullRequest(base);
    expect(result.checked.filter((c) => c.startsWith("squash"))).toEqual([
      "squash message (COMMIT_OR_PR_TITLE, COMMIT_MESSAGES)",
    ]);
  });

  test("a description that would not parse as a squash body is not judged (Dependabot #422)", () => {
    // Release notes in a Dependabot description. Under PR_BODY they would be the squash body, but
    // This repository squashes with COMMIT_MESSAGES, so GitHub never puts them in the message.
    const body = "Release notes\n\nittyRouter.get('/hello', () => new Response('hi'))";
    const result = checkPullRequest({
      body,
      commits: [commit("chore(deps): bump itty-router from 5.0.0 to 5.0.1")],
      number: 422,
      title: "chore(deps): bump itty-router from 5.0.0 to 5.0.1",
    });
    expect(result.failures).toEqual([]);
    // The same body IS judged when the setting says the description is the squash body.
    const asBody = checkPullRequest({
      body,
      commits: [commit("chore(deps): bump itty-router from 5.0.0 to 5.0.1")],
      messageSetting: "PR_BODY",
      number: 422,
      title: "chore(deps): bump itty-router from 5.0.0 to 5.0.1",
      titleSetting: "PR_TITLE",
    });
    expect(asBody.failures).toHaveLength(1);
  });

  test("a branch commit that is not conventional at all is a warning, not a failure", () => {
    const result = checkPullRequest({
      body: "",
      commits: [commit("fix: a"), commit("Apply suggestions from code review", "c".repeat(40))],
      number: 5,
      title: "fix: a thing",
    });
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.header)).toEqual(["Apply suggestions from code review"]);
    const report = run(
      {
        body: "",
        commits: [commit("fix: a"), commit("Apply suggestions from code review", "c".repeat(40))],
        number: 5,
        title: "fix: a thing",
      },
      "r",
    );
    expect(report.failed).toBe(false);
    expect(report.lines.join("\n")).toContain("::warning::1 commit(s) are not conventional");
  });

  test("a conventional branch commit whose body breaks the parser still fails", () => {
    const result = checkPullRequest({
      body: "",
      commits: [commit("fix: a\n\n`toBe(strip())` printed both", "b".repeat(40))],
      number: 6,
      title: "fix: a",
    });
    expect(result.warnings).toEqual([]);
    expect(result.failures.map((f) => f.source)).toContain("commit bbbbbbbb");
  });

  test("an override block replaces everything, and is itself checked", () => {
    const good = checkPullRequest({
      ...base,
      body: "BEGIN_COMMIT_OVERRIDE\nfeat(runtime): a\n\nfix(site): b\nEND_COMMIT_OVERRIDE",
    });
    expect(good).toEqual({
      checked: ["BEGIN_COMMIT_OVERRIDE block"],
      failures: [],
      override: true,
      warnings: [],
    });

    const bad = checkPullRequest({
      ...base,
      body: "BEGIN_COMMIT_OVERRIDE\nfeat(runtime): a\n\nfix(site): b\n\nfoo(bar()) x\nEND_COMMIT_OVERRIDE",
    });
    expect(bad.failures.map((f) => f.source)).toEqual(["BEGIN_COMMIT_OVERRIDE block"]);
  });

  test("a non-conventional pull request title fails the squash form", () => {
    const result = checkPullRequest({
      body: "",
      commits: [commit("fix: a"), commit("fix: b", "b".repeat(40))],
      messageSetting: "BLANK",
      number: 3,
      title: "Fix things",
      titleSetting: "PR_TITLE",
    });
    expect(result.failures.map((f) => f.line)).toEqual([1]);
  });
});

describe("the CLI", () => {
  test("parses git log records with authors", () => {
    expect(parseAuthoredLog("s1\0A <a@x>\0fix: a\n\0s2\0\0feat: b\n\0")).toEqual([
      { author: "A <a@x>", message: "fix: a\n", sha: "s1" },
      { message: "feat: b\n", sha: "s2" },
    ]);
  });

  test("narrows repository settings to the values GitHub documents", () => {
    expect(titleSetting("PR_TITLE")).toBe("PR_TITLE");
    expect(titleSetting("")).toBeUndefined();
    expect(messageSetting("COMMIT_MESSAGES")).toBe("COMMIT_MESSAGES");
    expect(messageSetting("SQUASH_SOMETHING_NEW")).toBeUndefined();
    expect(messageSetting()).toBeUndefined();
  });

  test("a failing pull request names the line and both ways out", () => {
    const report = run({ body: "", commits: PR466, number: 466, title: TITLE }, "base..head");
    expect(report.failed).toBe(true);
    const text = report.lines.join("\n");
    expect(text).toContain("squash message (COMMIT_OR_PR_TITLE, COMMIT_MESSAGES)");
    expect(text).toContain("`toBe(strip())` printed both");
    expect(text).toContain("BEGIN_COMMIT_OVERRIDE");
    expect(text).toContain(PARSE_ADVICE);
  });

  test("a local run (no pull request) judges commits only", () => {
    const clean = run({ body: "", commits: [commit("fix: a")], number: 0, title: "" }, "r");
    expect(clean).toEqual({
      failed: false,
      lines: ["Checked 1 commit(s) in r and 0 squash form(s): release-please parses all of it."],
    });
    const dirty = run({ body: "", commits: PR466, number: 0, title: "" }, "r");
    expect(dirty.lines[0]).toContain("1 piece(s)");
  });

  test("an override run says so", () => {
    const report = run(
      {
        body: "BEGIN_COMMIT_OVERRIDE\nfix: a\nEND_COMMIT_OVERRIDE",
        commits: PR466,
        number: 9,
        title: "x",
      },
      "r",
    );
    expect(report.failed).toBe(false);
    expect(report.lines[0]).toContain("BEGIN_COMMIT_OVERRIDE block");
  });
});

describe("wiring", () => {
  test("checks runs it on every pull request, with the title and body passed through env", () => {
    const yml = readFileSync(join(import.meta.dir, "../.github/workflows/test.yml"), "utf8");
    const step = yml.slice(
      yml.indexOf("name: Commit messages must be parseable by release-please"),
    );
    expect(step).toContain("bun scripts/check-release-parse.ts");
    expect(step).toContain("--pr ${{ github.event.pull_request.number }}");
    expect(step).toContain("PR_BODY: ${{ github.event.pull_request.body }}");
    // Never interpolated into the script body, where a fork's title would be shell.
    const script = step.slice(step.indexOf("run: |"), step.indexOf("\n\n"));
    expect(script).not.toContain("pull_request.title");
    expect(script).not.toContain("pull_request.body");
  });

  test("the commit-msg hook runs the same parse", async () => {
    const { default: config } = await import("../commitlint.config.ts");
    expect(config.rules?.["release-please-parseable"]).toEqual([2, "always"]);
  });

  test("the parser is pinned exactly to what release-please 17 resolves", () => {
    /* SAFETY: the root package.json is the committed manifest; devDependencies is a string map. */
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies["@conventional-commits/parser"]).toBe("0.4.1");
  });
});
