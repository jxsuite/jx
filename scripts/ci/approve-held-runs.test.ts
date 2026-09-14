/**
 * Covers `scripts/ci/approve-held-runs.ts` against a scripted GitHub, and pins the way the two
 * pushing lanes, `screenshots.yml`, `schemas.yml` and `release-specs.yml`, wire it: the permission
 * it needs, the step that calls it, the concurrency suffix that keeps the approved bot run out of
 * its approver's group, and the actor refusal that makes approving the screenshots lane's own run a
 * skipped job rather than another push.
 *
 * `fetch`, `sleep` and `now` are injected, so nothing here waits or talks to GitHub. What is tested
 * is the discriminator (held means `completed` + `action_required`), the settling rule, the
 * one-attempt-per-run rule, and that a refusal never throws and names the crank.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { approveHeldRuns, crankFor, isHeld, renderNote } from "./approve-held-runs.ts";
import type { ApiResponse, FetchLike, Outcome, WorkflowRun } from "./approve-held-runs.ts";

const REPO = "jxsuite/jx";
const WORKFLOWS = join(import.meta.dir, "../../.github/workflows");
const WORKFLOW_SOURCE = await Bun.file(join(WORKFLOWS, "screenshots.yml")).text();
const SCHEMAS_SOURCE = await Bun.file(join(WORKFLOWS, "schemas.yml")).text();
const RELEASE_SPECS_SOURCE = await Bun.file(join(WORKFLOWS, "release-specs.yml")).text();
const SHA = "3e6b589a845c9472be30333ed1db46599215802a";

const run = (id: number, name: string, over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  id,
  name,
  status: "completed",
  conclusion: "action_required",
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  ...over,
});

const json = (status: number, body: unknown): ApiResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});

/**
 * A GitHub whose listing answers come from a script, one entry per poll (the last entry repeats),
 * and whose approvals answer with `approveStatus`. Records every request it saw.
 */
function github(listings: WorkflowRun[][], approveStatus = 201) {
  const calls: { method: string; url: string }[] = [];
  let poll = 0;
  const fetch: FetchLike = (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "POST") {
      return Promise.resolve(
        json(approveStatus, approveStatus === 201 ? {} : { message: "Resource not accessible" }),
      );
    }
    const listing = listings[Math.min(poll, listings.length - 1)] ?? [];
    poll += 1;
    return Promise.resolve(json(200, { workflow_runs: listing }));
  };
  return { fetch, calls, approvals: () => calls.filter((c) => c.method === "POST") };
}

/** A clock the loop advances by `pollMs` on every sleep, so budgets are exact and instant. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

const options = (
  gh: ReturnType<typeof github>,
  over: Partial<Parameters<typeof approveHeldRuns>[0]> = {},
) => ({
  repo: REPO,
  sha: SHA,
  token: "t",
  fetch: gh.fetch,
  ...clock(),
  timeoutMs: 90_000,
  pollMs: 5000,
  ...over,
});

describe("isHeld", () => {
  test("a held run is completed with conclusion action_required — nothing else qualifies", () => {
    // The shape the API actually reports for a policy-held run (run 34752815008, 2026-09-13).
    expect(isHeld(run(1, "Test"))).toBe(true);
    expect(isHeld(run(1, "Test", { status: "queued", conclusion: null }))).toBe(false);
    expect(isHeld(run(1, "Test", { status: "in_progress", conclusion: null }))).toBe(false);
    expect(isHeld(run(1, "Test", { conclusion: "success" }))).toBe(false);
    expect(isHeld(run(1, "Test", { conclusion: "skipped" }))).toBe(false);
  });
});

describe("approveHeldRuns", () => {
  test("approves every held run on the head, the lane's own included", async () => {
    const head = [
      run(1, "Test"),
      run(2, "Screenshots"),
      run(3, "Schemas", { conclusion: "success" }),
    ];
    const gh = github([head]);
    const outcome = await approveHeldRuns(options(gh));

    expect(outcome.approved.map((r) => r.id)).toEqual([1, 2]);
    expect(outcome.refused).toEqual([]);
    expect(outcome.timedOut).toBe(false);
    expect(gh.approvals().map((c) => c.url)).toEqual([
      `https://api.github.com/repos/${REPO}/actions/runs/1/approve`,
      `https://api.github.com/repos/${REPO}/actions/runs/2/approve`,
    ]);
  });

  test("lists by head sha with the token, and never approves a run that was not held", async () => {
    const gh = github([[run(1, "Test", { status: "queued", conclusion: null })]]);
    const outcome = await approveHeldRuns(options(gh));

    expect(gh.calls[0]?.url).toBe(
      `https://api.github.com/repos/${REPO}/actions/runs?head_sha=${SHA}&per_page=100`,
    );
    expect(gh.approvals()).toEqual([]);
    expect(outcome.approved).toEqual([]);
    expect(outcome.runs.length).toBe(1);
  });

  test("waits for the runs to appear, then for the set to settle, and approves late arrivals", async () => {
    /*
     * Nothing, then Test alone, then the full set. The loop must not stop at the first non-empty
     * poll, because GitHub queues a push's runs over a few seconds, not atomically.
     */
    const gh = github([[], [run(1, "Test")], [run(1, "Test"), run(2, "Bundle Analysis")]]);
    const outcome = await approveHeldRuns(options(gh));

    expect(outcome.approved.map((r) => r.id)).toEqual([1, 2]);
    // 4 listings: empty, one, two, two-again (settled). Each held run approved exactly once.
    expect(gh.calls.filter((c) => c.method === "GET").length).toBe(4);
    expect(gh.approvals().length).toBe(2);
  });

  test("attempts each run once — a refusal is an answer, not a retry", async () => {
    const gh = github([[run(1, "Test")]], 403);
    const outcome = await approveHeldRuns(options(gh));

    expect(outcome.approved).toEqual([]);
    expect(outcome.refused.length).toBe(1);
    expect(outcome.refused[0]).toMatchObject({ status: 403, message: "Resource not accessible" });
    expect(outcome.refused[0]?.run.id).toBe(1);
    expect(gh.approvals().length).toBe(1);
  });

  test("a fetch that throws is a refusal with status 0, never an exception", async () => {
    const gh = github([[run(1, "Test")]]);
    const fetch: FetchLike = (url, init) =>
      init?.method === "POST" ? Promise.reject(new Error("ECONNRESET")) : gh.fetch(url, init);
    const outcome = await approveHeldRuns(options(gh, { fetch }));

    expect(outcome.refused).toEqual([{ run: run(1, "Test"), status: 0, message: "ECONNRESET" }]);
  });

  test("a failed listing is retried on the next poll rather than ending the loop", async () => {
    let first = true;
    const gh = github([[run(1, "Test")]]);
    const fetch: FetchLike = (url, init) => {
      if (init?.method !== "POST" && first) {
        first = false;
        return Promise.resolve(json(502, { message: "Bad gateway" }));
      }
      return gh.fetch(url, init);
    };
    const outcome = await approveHeldRuns(options(gh, { fetch }));
    expect(outcome.approved.map((r) => r.id)).toEqual([1]);
  });

  test("a failed listing after the first is not the quiet round — a late arrival is still approved", async () => {
    /*
     * Round 1 lists Test, round 2 is a 502, round 3 lists Test and a late Bundle Analysis. A
     * failed round leaves the previous answer in hand, whose ids equal the previous round's by
     * construction; counting that as settled would have ended the poll after round 2 with Bundle
     * Analysis held and no note about it.
     */
    let round = 0;
    const gh = github([[run(1, "Test")], [run(1, "Test"), run(2, "Bundle Analysis")]]);
    const fetch: FetchLike = (url, init) => {
      if (init?.method === "POST") {
        return gh.fetch(url, init);
      }
      round += 1;
      return round === 2 ? Promise.reject(new Error("socket hang up")) : gh.fetch(url, init);
    };
    const outcome = await approveHeldRuns(options(gh, { fetch }));

    expect(outcome.approved.map((r) => r.id)).toEqual([1, 2]);
    expect(outcome.runs.length).toBe(2);
    // Rounds: Test, 502, Test+BA, Test+BA again (settled).
    expect(round).toBe(4);
  });

  test("gives up at the budget when nothing is ever queued, and says so", async () => {
    const gh = github([[]]);
    const outcome = await approveHeldRuns(options(gh, { timeoutMs: 20_000, pollMs: 5000 }));

    expect(outcome.timedOut).toBe(true);
    expect(outcome.runs).toEqual([]);
    // Polls at t=0, 5, 10, 15, 20 — the deadline is inclusive of its last round.
    expect(gh.calls.length).toBe(5);
  });

  test("a head whose runs never settle still ends at the budget, without timing out", async () => {
    const listings = Array.from({ length: 30 }, (_, i) =>
      Array.from({ length: i + 1 }, (__, id) => run(id + 1, `W${id + 1}`)),
    );
    const gh = github(listings);
    const outcome = await approveHeldRuns(options(gh, { timeoutMs: 20_000, pollMs: 5000 }));

    expect(outcome.timedOut).toBe(false);
    expect(outcome.runs.length).toBe(5);
    expect(outcome.approved.length).toBe(5);
  });
});

describe("crankFor and renderNote", () => {
  test("the crank is the exact line a human ran on #298", () => {
    expect(crankFor(REPO, run(34_666_604_097, "Test"))).toBe(
      "gh api -X POST repos/jxsuite/jx/actions/runs/34666604097/approve",
    );
  });

  const outcome = (over: Partial<Outcome> = {}): Outcome => ({
    runs: [],
    approved: [],
    refused: [],
    timedOut: false,
    ...over,
  });

  test("an approved head needs no note", () => {
    const approved = outcome({ approved: [run(1, "Test")] });
    expect(renderNote(approved, REPO, SHA)).toBe("");
  });

  test("a refusal names every held run, its crank, and why approving all of them is safe", () => {
    const refused = [
      { run: run(1, "Test"), status: 403, message: "Resource not accessible by integration" },
      { run: run(2, "Screenshots"), status: 0, message: "ECONNRESET" },
    ];
    const note = renderNote(outcome({ refused }), REPO, SHA);
    expect(note).toContain("> [!WARNING]");
    expect(note).toContain("holding 2 run(s) on `3e6b589`");
    expect(note).toContain(
      "`gh api -X POST repos/jxsuite/jx/actions/runs/1/approve` (HTTP 403: Resource not accessible by integration)",
    );
    expect(note).toContain("`gh api -X POST repos/jxsuite/jx/actions/runs/2/approve` (ECONNRESET)");
    expect(note).toContain("[Test](https://github.com/jxsuite/jx/actions/runs/1)");
    /*
     * Both mechanisms, because they differ: schemas.yml has no actor refusal and is safe by fixed
     * point instead (its header, item 3). Naming only one would misinform the author of the next
     * pushing lane about what it has to bring.
     */
    expect(note).toContain("`screenshots.yml` declines its own head on `github.actor`");
    expect(note).toContain("`schemas.yml` and `release-specs.yml` regenerate deterministically");
  });

  test("a budget that found no run at all points at the listing, since there is no id to name", () => {
    const note = renderNote(outcome({ timedOut: true }), REPO, SHA);
    expect(note).toContain("No workflow run was queued for `3e6b589`");
    expect(note).toContain(`repos/${REPO}/actions/runs?head_sha=${SHA}`);
    expect(note).toContain('select(.conclusion == "action_required")');
  });
});

describe("the CLI", () => {
  test("exits 0 on a refusal and writes the note where the lane's comment step reads it", async () => {
    /*
     * A token nobody holds against api.github.com would be a network call. The CLI is pointed at
     * a local server that refuses, which is exactly the outcome the job must survive.
     */
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "POST") {
          return Response.json(
            { message: "Resource not accessible by integration" },
            { status: 403 },
          );
        }
        return Response.json({ workflow_runs: [run(7, "Test")] });
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "approve-held-runs-"));
    const noteFile = join(dir, "note.md");
    try {
      const proc = Bun.spawn(["bun", "scripts/ci/approve-held-runs.ts"], {
        cwd: join(import.meta.dir, "../.."),
        env: {
          ...process.env,
          GITHUB_REPOSITORY: REPO,
          HEAD_SHA: SHA,
          GITHUB_TOKEN: "t",
          GITHUB_API_URL: `http://localhost:${server.port}`,
          APPROVE_TIMEOUT_MS: "0",
          NOTE_FILE: noteFile,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

      expect(code).toBe(0);
      expect(stdout).toContain(
        "::warning::Test is held and could not be approved: gh api -X POST repos/jxsuite/jx/actions/runs/7/approve",
      );
      // Still-held is the held runs never approved, counted from the final listing — not
      // `held - approved`, which read "-7 still held" once approved runs re-listed as queued.
      expect(stdout).toContain("1 run(s) on 3e6b589: 0 approved, 1 refused, 1 still held");
      expect(await Bun.file(noteFile).text()).toContain("actions/runs/7/approve");
    } finally {
      await server.stop(true);
    }
  });

  test("a missing input throws, because that is a workflow edit that must go red", async () => {
    const proc = Bun.spawn(["bun", "scripts/ci/approve-held-runs.ts"], {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, GITHUB_REPOSITORY: REPO, HEAD_SHA: "", GITHUB_TOKEN: "t" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("HEAD_SHA is required");
  });
});

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Workflow {
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: Record<string, { if?: string; steps: Step[] }>;
}

/** The wiring both pushing lanes must have, asserted once per lane. */
function itWiresTheApproval(
  lane: string,
  workflow: Workflow,
  job: string,
  commentStep: string,
): void {
  test(`${lane} carries actions: write, which the approve endpoint needs`, () => {
    expect(workflow.permissions.actions).toBe("write");
  });

  test(`${lane} runs the script on the pushed sha, after the push, with the token and the note file`, () => {
    const { steps } = workflow.jobs[job]!;
    const push = steps.findIndex((s) => s.id === "push");
    const approve = steps.findIndex((s) => s.id === "approve");
    expect(steps[approve]?.run).toContain("scripts/ci/approve-held-runs.ts");
    const comment = steps.findIndex((s) => s.name === commentStep);
    expect(push).toBeGreaterThan(-1);
    expect(approve).toBeGreaterThan(push);
    expect(comment).toBeGreaterThan(approve);

    const { [approve]: step } = steps;
    expect(step!.if).toContain("steps.push.outputs.sha != ''");
    expect(step!.env?.HEAD_SHA).toBe("${{ steps.push.outputs.sha }}");
    expect(step!.env?.GITHUB_TOKEN).toBe("${{ github.token }}");
    expect(step!.env?.NOTE_FILE).toBeTruthy();
    // The comment step appends the note, so a refusal reaches the PR and not only the job log.
    expect(steps[comment]!.env?.NOTE_FILE).toBe(step!.env?.NOTE_FILE);
  });

  test(`${lane} keys the concurrency group on bot-versus-human, so the approved bot run cannot cancel its approver`, () => {
    /*
     * `cancel-in-progress` on a group shared by the run doing the approving and the run it just
     * approved would cancel the former seconds before it posts the comment. The approved run's
     * actor is the bot's and the approver's is a human's, so bot-versus-human in the group name is
     * what keeps them apart — and NOT the actor's identity, which would split two humans' pushes
     * on one PR into groups that no longer cancel each other and race the push step.
     */
    expect(workflow.concurrency.group).toContain(
      "${{ github.actor == 'github-actions[bot]' && 'bot' || 'human' }}",
    );
    expect(workflow.concurrency.group).not.toContain("${{ github.actor }}");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  });
}

describe("screenshots.yml wires it", () => {
  const workflow = Bun.YAML.parse(WORKFLOW_SOURCE) as Workflow;
  itWiresTheApproval("screenshots.yml", workflow, "capture", "Comment");

  test("keeps the actor refusal that makes approving the lane's own run a skipped job", () => {
    expect(workflow.jobs.capture!.if).toContain(
      "!(github.event_name == 'pull_request' && github.actor == 'github-actions[bot]')",
    );
  });
});

describe("schemas.yml wires it", () => {
  const workflow = Bun.YAML.parse(SCHEMAS_SOURCE) as Workflow;
  itWiresTheApproval("schemas.yml", workflow, "regenerate", "Comment on the pull request");

  test("has no actor refusal, and is safe on its own head by the fixed point instead", () => {
    // The approved bot-head run regenerates identical bytes and pushes nothing (the lane's header,
    // Item 3). If a refusal is ever added here, the note's safety argument must say so too.
    expect(workflow.jobs.regenerate!.if ?? "").not.toContain("github-actions[bot]");
    expect(SCHEMAS_SOURCE).toContain("fixed point");
  });
});

describe("release-specs.yml wires it", () => {
  const workflow = Bun.YAML.parse(RELEASE_SPECS_SOURCE) as Workflow;
  itWiresTheApproval(
    "release-specs.yml",
    workflow,
    "mint",
    "Say what happened, on the pull request",
  );

  test("has no actor refusal either: it pushes only when a fragment was minted", () => {
    // The release pull request is AUTHORED by a bot, so an actor refusal would skip every release;
    // The lane is safe on its own head because the run its push triggers finds specs/changes/ empty.
    expect(workflow.jobs.mint!.if ?? "").not.toContain("github-actions[bot]");
    expect(RELEASE_SPECS_SOURCE).toContain("fixed point");
  });
});
