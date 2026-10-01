/**
 * `.github/workflows/electrobun-vendor.yml` is the second writer of a version that has two: it
 * moves the `vendor/electrobun` gitlink to the release the `electrobun` devDependency pins, so a
 * Dependabot bump of the pin no longer waits for a human to run `bun run electrobun:sync`.
 *
 * A workflow is the kind of code that fails only on the first real pull request, so this holds two
 * things. The STRUCTURE: which events fire it, what it may touch, and — the part that keeps the
 * design honest — that no other workflow ever moves the gitlink, because the gate in test.yml stays
 * strict precisely by never fixing what it reports. And the BEHAVIOUR of the one step that is not a
 * call to something else with its own tests: the push, which has to win or gracefully lose a race
 * against `schemas.yml` on the same branch. That step's `run:` block is lifted out of the YAML and
 * executed against real git repositories, so what is tested is the text that ships.
 *
 * The wiring shared with the other pushing lanes (the permission, the approval step, the
 * concurrency group) is pinned in `scripts/ci/approve-held-runs.test.ts`, next to the script it
 * concerns.
 *
 * It lives flat in `scripts/` for the same reason `scripts/dependabot-config.test.ts` does: it runs
 * unconditionally via `bun test --isolate scripts` in test.yml's `changes` job, and `.github/**`
 * reaches no test workspace, so this is the only place an edit to the workflow is judged.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findAngleTags } from "../commitlint.config.ts";

const WORKFLOWS = join(import.meta.dir, "../.github/workflows");
const LANE = "electrobun-vendor.yml";
const SOURCE = readFileSync(join(WORKFLOWS, LANE), "utf8");

interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
  run?: string;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { if?: string; steps: Step[] }>;
}

const workflow = Bun.YAML.parse(SOURCE) as Workflow;
const { steps } = workflow.jobs.move!;
const step = (id: string): Step => {
  const found = steps.find((s) => s.id === id);
  if (!found) {
    throw new Error(`${LANE} has no step with id '${id}'`);
  }
  return found;
};

describe("electrobun-vendor.yml: what fires it and what it may touch", () => {
  test("runs on pull requests, unfiltered, and never on a push to main", () => {
    /*
     * No trunk leg (header, item 1): a pull request that moves the pin and not the gitlink is red
     * on its own head, so there is no merge race on main to repair. And no `paths:`: the job is
     * seconds, and a path list here would be one more hand-maintained filter that is eventually
     * wrong about which pull requests move the pin.
     */
    expect(Object.keys(workflow.on)).toEqual(["pull_request"]);
    expect(workflow.on.pull_request).toBeNull();
  });

  test("skips forks, whose token cannot push, and any copy of the repository", () => {
    const condition = workflow.jobs.move!.if ?? "";
    expect(condition).toContain("github.event.pull_request.head.repo.fork != true");
    expect(condition).toContain("github.repository == 'jxsuite/jx'");
  });

  test("has no actor refusal: it is safe on its own head because it is a fixed point", () => {
    /*
     * The approve-held-runs.ts script requires every pushing lane to terminate by one of two mechanisms. This
     * is the schemas.yml one: after the move the gitlink names the pinned tag, so the run the push
     * queues finds nothing to move. A refusal on `github-actions[bot]` would be wrong anyway — it
     * would also refuse the Dependabot-authored PRs this lane exists for if they were ever re-run.
     */
    expect(workflow.jobs.move!.if ?? "").not.toContain("github-actions[bot]");
    expect(SOURCE).toContain("FIXED POINT");
  });

  test("sets up Bun without installing the workspace", () => {
    const setup = steps.find((s) => s.uses === "./.github/actions/setup-bun");
    expect(setup?.with?.install).toBe("false");
  });

  test("moves the submodule with --fix, which is the only sanctioned writer of the gitlink", () => {
    const run = step("sync").run ?? "";
    expect(run).toContain("bun scripts/check-electrobun-vendor.ts --fix");
    /*
     * `--soft` exits 0 on failure, which would turn "upstream never pushed that tag" into a green
     * run that pushes nothing and leaves the pull request red with no explanation.
     */
    expect(run).not.toContain("--soft");
  });

  test("compares the gitlink before and after rather than trusting `git status`", () => {
    const run = step("sync").run ?? "";
    expect(run).toContain("git rev-parse HEAD:vendor/electrobun");
    expect(run).toContain("git -C vendor/electrobun rev-parse HEAD");
  });
});

describe("the gate stays strict", () => {
  const workflowFiles = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));

  test("no workflow other than this lane moves the gitlink", () => {
    /*
     * The gate in test.yml runs `--init`, which materialises the submodule and deliberately does NOT move it,
     * because moving it is exactly how a bump would stop looking like a mismatch. If the gate ever
     * ran `--fix` it would repair the disagreement in its own checkout and report green, and this
     * lane (which commits the repair) would have nothing left to find. The two are meant to be a
     * red head and the commit that fixes it.
     */
    const offenders = workflowFiles.filter(
      (file) =>
        file !== LANE &&
        /check-electrobun-vendor\.ts\s+(?:\S+\s+)*--fix/.test(
          readFileSync(join(WORKFLOWS, file), "utf8"),
        ),
    );
    expect(offenders).toEqual([]);
  });

  test("test.yml still runs the gate with --init", () => {
    const testYml = readFileSync(join(WORKFLOWS, "test.yml"), "utf8");
    expect(testYml).toContain("bun scripts/check-electrobun-vendor.ts --init");
  });
});

describe("the push step", () => {
  const push = step("push");

  test("stages the gitlink alone and never sweeps the tree", () => {
    const run = push.run ?? "";
    expect(run).toContain("git add -- vendor/electrobun");
    expect(run).not.toMatch(/git add (-A|--all|\.)(\s|$)/);
  });

  test("runs without the husky hooks, which are a local authoring aid", () => {
    expect(push.env?.HUSKY).toBe("0");
  });

  test("pushes a fully qualified refspec, which works from a detached HEAD", () => {
    expect(push.run).toContain('git push origin "HEAD:refs/heads/${BRANCH}"');
  });

  test("only runs when the gitlink actually moved", () => {
    expect(push.if).toBe("steps.sync.outputs.changed == 'true'");
  });

  test("writes a commit subject release-please can read: a chore, and no raw angle bracket", () => {
    /*
     * A `<tag>` in a subject deletes the package from its own release (CLAUDE.md). The subject here
     * interpolates only a version, but the rule is cheap to hold and it is the one that cost a
     * release.
     */
    const subject = /git commit -m "([^"]+)"/.exec(push.run ?? "")?.[1];
    expect(subject).toBeDefined();
    const rendered = subject!.replace("${VERSION}", "2.0.2");
    expect(rendered).toBe("chore(desktop): move vendor/electrobun to v2.0.2");
    expect(findAngleTags(rendered)).toEqual([]);
  });
});

/**
 * The push step against real repositories.
 *
 * The runner's checkout is a DETACHED HEAD at the pull request's head SHA with `vendor/electrobun`
 * a gitlink whose submodule `repair()` has just moved to the pinned tag. The fixture reproduces
 * exactly that with no network: a bare `origin`, a work clone detached at the branch tip with a
 * nested repository at `vendor/electrobun` standing in for the moved submodule, and a `rival` clone
 * that plays whichever sibling lane pushed to the branch first.
 */
describe("the push step, executed against real git", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const BRANCH = "dependabot/bun/bun-minor-patch-0123456789";

  /*
   * Isolated from the developer's own git config: a global `commit.gpgsign` or a hooks path would
   * otherwise decide whether this test passes.
   */
  const GIT_ENV = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.com",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.com",
  };

  function sh(cwd: string, command: string, env: Record<string, string> = {}) {
    const run = Bun.spawnSync(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", command], {
      cwd,
      env: { ...GIT_ENV, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      code: run.exitCode,
      out: run.stdout.toString().trim(),
      err: run.stderr.toString().trim(),
    };
  }

  function must(cwd: string, command: string): string {
    const { code, out, err } = sh(cwd, command);
    if (code !== 0) {
      throw new Error(`fixture command failed (${code}): ${command}\n${err}`);
    }
    return out;
  }

  function pinFile(version: string): string {
    return `${JSON.stringify({ devDependencies: { electrobun: version } })}\n`;
  }

  /** A nested repository standing in for the submodule, with one commit; returns its SHA. */
  function nestedCommit(dir: string, label: string): string {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, ".git"))) {
      must(dir, "git init -q -b main");
    }
    writeFileSync(join(dir, "marker.txt"), label);
    must(dir, `git add -A && git commit -q -m ${label}`);
    return must(dir, "git rev-parse HEAD");
  }

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "electrobun-lane-"));
    roots.push(root);
    const origin = join(root, "origin.git");
    const seed = join(root, "seed");
    const work = join(root, "work");
    const rival = join(root, "rival");

    must(root, `git init -q --bare -b main ${origin}`);
    must(root, `git clone -q ${origin} ${seed}`);
    must(seed, `git checkout -q -b ${BRANCH}`);
    mkdirSync(join(seed, "packages/desktop"), { recursive: true });
    writeFileSync(join(seed, "packages/desktop/package.json"), pinFile("2.0.2"));
    writeFileSync(join(seed, "schema.json"), '{"v":1}\n');
    const before = nestedCommit(join(seed, "vendor/electrobun"), "v2.0.1");
    must(
      seed,
      `git add -A && git commit -q -m "chore(deps): bump electrobun" && git push -q origin ${BRANCH}`,
    );

    // The runner: detached at the branch tip, the submodule already moved to the pinned tag.
    must(root, `git clone -q ${origin} ${work}`);
    must(work, `git checkout -q --detach origin/${BRANCH}`);
    must(work, "git rm -rq --cached vendor/electrobun >/dev/null 2>&1 || true");
    rmSync(join(work, "vendor/electrobun"), { recursive: true, force: true });
    must(work, `git reset -q --hard origin/${BRANCH}`);
    const after = nestedCommit(join(work, "vendor/electrobun"), "v2.0.2");

    must(root, `git clone -q ${origin} ${rival}`);
    must(rival, `git checkout -q ${BRANCH}`);

    const output = join(root, "github-output");
    writeFileSync(output, "");
    return { root, origin, work, rival, before, after, output };
  }

  const script = (): string => {
    const { run } = step("push");
    if (!run) {
      throw new Error("the push step has no run block");
    }
    return run;
  };

  function runStep(f: ReturnType<typeof fixture>, version = "2.0.2") {
    return sh(f.work, script(), {
      BRANCH,
      VERSION: version,
      HUSKY: "0",
      GITHUB_OUTPUT: f.output,
    });
  }

  const tip = (f: ReturnType<typeof fixture>) => must(f.origin, `git rev-parse ${BRANCH}`);
  const gitlinkOnOrigin = (f: ReturnType<typeof fixture>) =>
    must(f.origin, `git rev-parse ${BRANCH}:vendor/electrobun`);
  const outputs = (f: ReturnType<typeof fixture>) => readFileSync(f.output, "utf8");

  test("pushes one commit that moves the gitlink and nothing else", () => {
    const f = fixture();
    const result = runStep(f);

    expect(result.code).toBe(0);
    expect(gitlinkOnOrigin(f)).toBe(f.after);
    expect(must(f.origin, `git log -1 --format=%s ${BRANCH}`)).toBe(
      "chore(desktop): move vendor/electrobun to v2.0.2",
    );
    // One path changed: the gitlink. The pin the pull request already moved is not rewritten.
    expect(must(f.origin, `git diff --name-only ${BRANCH}~1 ${BRANCH}`)).toBe("vendor/electrobun");
    expect(outputs(f)).toContain(`sha=${tip(f)}`);
  });

  test("survives losing the race to a sibling lane that pushed to the same branch first", () => {
    const f = fixture();
    /* The schemas.yml lane's commit: it started from the same head and touched a disjoint path. */
    writeFileSync(join(f.rival, "schema.json"), '{"v":2}\n');
    must(
      f.rival,
      `git commit -qam "chore(schema): regenerate stale schema builds" && git push -q origin ${BRANCH}`,
    );
    const rivalTip = must(f.rival, "git rev-parse HEAD");

    const result = runStep(f);

    expect(result.code).toBe(0);
    expect(result.out + result.err).toContain("push rejected (attempt 1)");
    // Both lanes' work is on the branch, the rival's untouched, ours on top of it.
    expect(gitlinkOnOrigin(f)).toBe(f.after);
    expect(must(f.origin, `git show ${BRANCH}:schema.json`)).toBe('{"v":2}');
    expect(must(f.origin, `git rev-parse ${BRANCH}~1`)).toBe(rivalTip);
    expect(outputs(f)).toContain(`sha=${tip(f)}`);
    // `reset --hard` must not have dragged the submodule off the pinned tag.
    expect(must(join(f.work, "vendor/electrobun"), "git rev-parse HEAD")).toBe(f.after);
  });

  test("pushes nothing when the race was lost to a re-pin, leaving that run to the next one", () => {
    const f = fixture();
    /*
     * Dependabot rebased the branch onto a newer release while this run was working. The gitlink
     * this run computed is for 2.0.2, which is no longer what the branch pins.
     */
    writeFileSync(join(f.rival, "packages/desktop/package.json"), pinFile("2.0.3"));
    must(
      f.rival,
      `git commit -qam "chore(deps): bump electrobun again" && git push -q origin ${BRANCH}`,
    );
    const rivalTip = must(f.rival, "git rev-parse HEAD");

    const result = runStep(f);

    expect(result.code).toBe(0);
    expect(result.out).toContain("now pins v2.0.3, not v2.0.2");
    expect(tip(f)).toBe(rivalTip);
    expect(gitlinkOnOrigin(f)).toBe(f.before);
    expect(outputs(f)).not.toContain("sha=");
  });

  test("pushes nothing when a sibling already moved the gitlink to the same place", () => {
    const f = fixture();
    must(
      f.rival,
      `git update-index --add --cacheinfo 160000,${f.after},vendor/electrobun && git commit -qm "move the gitlink by hand" && git push -q origin ${BRANCH}`,
    );
    const rivalTip = must(f.rival, "git rev-parse HEAD");

    const result = runStep(f);

    expect(result.code).toBe(0);
    expect(result.out).toContain("already names the pinned release");
    expect(tip(f)).toBe(rivalTip);
    expect(outputs(f)).not.toContain("sha=");
  });
});
