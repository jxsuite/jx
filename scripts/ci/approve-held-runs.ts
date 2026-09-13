/**
 * Approves the workflow runs the repository's Actions policy holds on a commit a lane just pushed,
 * so the `ci` required check can report on that head. Called by `.github/workflows/screenshots.yml`
 * right after its push step; generic enough for any lane that writes a `GITHUB_TOKEN` commit.
 *
 * THE PROBLEM IT CLOSES (issue #307). A lane's `GITHUB_TOKEN` push moves the PR head, and
 * `pull_request: synchronize` DOES fire for it — every workflow is queued on the new commit. But
 * the actor of those runs is `github-actions[bot]`, and the repository's Actions policy holds every
 * run on a bot-authored head in `action_required`. `ci` therefore never reports on the head that
 * branch protection requires it on, and the PR reads BLOCKED with nothing red anywhere. Seen twice
 * on #298; measured on the head `3e6b589a`: seven runs, all `actor=github-actions[bot]`, none of
 * them started until a human pressed _Approve and run_ on each. There are 457 runs in that state in
 * this repository's history.
 *
 * WHAT IT DOES. Polls `GET /actions/runs?head_sha=<sha>` until the runs GitHub queues for the
 * pushed commit have appeared and settled, and `POST /actions/runs/<id>/approve`s every one whose
 * conclusion is `action_required`. Held runs are created ALREADY completed with that conclusion,
 * which is the discriminator — a run that is `queued` or `in_progress` was never held, and one that
 * is `completed` with any other conclusion has already run.
 *
 * EVERY held run on the head, not only `Test`. The runs worth worrying about are the two lanes that
 * push, and each terminates on its own head by a DIFFERENT mechanism — both must hold for this
 * script to be safe, and a third pushing lane must bring one of them before this step may approve
 * it:
 *
 * - `screenshots.yml` DECLINES its own head: a job-level `if:` on `github.actor`, which stays
 *   `github-actions[bot]` through an approval (that only sets `triggering_actor`). On `3e6b589a`
 *   the approved Screenshots run concluded `skipped`.
 * - `schemas.yml` has NO actor refusal, on purpose (its header, item 3): it terminates on a FIXED
 *   POINT. The generators are deterministic, so the approved run regenerates the same bytes from
 *   the same tree and pushes nothing.
 *
 * Approving one run by name and leaving the rest would also be the wrong shape: `ci` is an
 * aggregate, and a held run that never reports is what leaves a PR BLOCKED.
 *
 * WHAT IT MUST NEVER DO IS FAIL THE JOB. The capture succeeded and the push landed before this
 * runs; a refusal here is a policy fact, not a pipeline fault. Whether a `GITHUB_TOKEN` carrying
 * `actions: write` is allowed to approve runs on this repository is the one thing that could not be
 * verified from outside a run, so a refusal (a 403, a network fault, anything) is recorded, printed
 * with the exact one-line human crank per run, and written to `NOTE_FILE` for the lane's PR comment
 * to append. The process exits 0 on every API outcome; only a missing input throws, because that is
 * a workflow edit that must go red on the PR that made it.
 *
 *     GITHUB_REPOSITORY=jxsuite/jx HEAD_SHA=<sha> GITHUB_TOKEN=<token> \
 *       NOTE_FILE=/tmp/approval.md bun scripts/ci/approve-held-runs.ts
 *
 * @docs extending/contributing/monorepo
 */

import { appendFileSync } from "node:fs";

/** The subset of a workflow run this script reads. */
export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/** The subset of `fetch` this script uses, so a test can hand it a fake. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string> },
) => Promise<ApiResponse>;

/** What a response has to offer: the fields read here, nothing more. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export interface Options {
  /** `owner/repo`, as `GITHUB_REPOSITORY` spells it. */
  repo: string;
  /** The commit whose runs are to be approved — the lane's own push. */
  sha: string;
  token: string;
  fetch?: FetchLike;
  /** Injected so the test does not wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Total budget. GitHub queues the runs within seconds of a push; 90 s is generous. */
  timeoutMs?: number;
  pollMs?: number;
  apiBase?: string;
}

export interface Refusal {
  run: WorkflowRun;
  /** HTTP status, or 0 for a fault that never produced a response. */
  status: number;
  message: string;
}

export interface Outcome {
  /** Every run seen on the head in the final poll. */
  runs: WorkflowRun[];
  approved: WorkflowRun[];
  refused: Refusal[];
  /** True when the budget ran out before any run at all was queued for the head. */
  timedOut: boolean;
}

/** A run the Actions policy is holding for a human. */
export const isHeld = (run: WorkflowRun): boolean =>
  run.status === "completed" && run.conclusion === "action_required";

/** The one-line crank a human runs when the API refuses this script. */
export const crankFor = (repo: string, run: WorkflowRun): string =>
  `gh api -X POST repos/${repo}/actions/runs/${run.id}/approve`;

const headersFor = (token: string) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
});

/**
 * Poll for the head's runs and approve the held ones as they appear.
 *
 * Termination is "the set of runs has settled", not "N runs exist": the number of workflows a push
 * queues depends on every `paths:` filter in the repository and is not this script's to know. A
 * round whose run ids match the previous round's, with every held run already attempted, is the
 * settled state; one quiet round at the poll interval is the settling window. Approval is attempted
 * at most once per run — a refusal is a policy answer, and asking again is noise.
 */
export async function approveHeldRuns(options: Options): Promise<Outcome> {
  const {
    repo,
    sha,
    token,
    fetch: doFetch = globalThis.fetch as unknown as FetchLike,
    sleep = (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    now = () => Date.now(),
    timeoutMs = 90_000,
    pollMs = 5000,
    apiBase = "https://api.github.com",
  } = options;

  const headers = headersFor(token);
  const runsUrl = `${apiBase}/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`;

  const approved: WorkflowRun[] = [];
  const refused: Refusal[] = [];
  const attempted = new Set<number>();
  let runs: WorkflowRun[] = [];
  let previousIds = "";
  const deadline = now() + timeoutMs;

  const approve = async (run: WorkflowRun) => {
    attempted.add(run.id);
    try {
      const response = await doFetch(`${apiBase}/repos/${repo}/actions/runs/${run.id}/approve`, {
        method: "POST",
        headers,
      });
      if (response.ok) {
        approved.push(run);
        console.log(`approved  ${run.name} (${run.id})`);
        return;
      }
      const message = await describeError(response);
      refused.push({ run, status: response.status, message });
      console.log(`REFUSED   ${run.name} (${run.id}): HTTP ${response.status} ${message}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      refused.push({ run, status: 0, message });
      console.log(`REFUSED   ${run.name} (${run.id}): ${message}`);
    }
  };

  for (;;) {
    let listed = false;
    try {
      const response = await doFetch(runsUrl, { headers });
      if (!response.ok) {
        /*
         * A listing failure is not a termination condition: GitHub's API has transient 5xxs and
         * the next round may answer. Logged, so a budget spent on them reads as what it was.
         */
        console.log(
          `listing runs for ${sha}: HTTP ${response.status} ${await describeError(response)}`,
        );
      } else {
        const body = (await response.json()) as { workflow_runs?: WorkflowRun[] };
        runs = body.workflow_runs ?? [];
        listed = true;
      }
    } catch (error) {
      console.log(
        `listing runs for ${sha}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (listed) {
      for (const run of runs) {
        if (isHeld(run) && !attempted.has(run.id)) {
          await approve(run);
        }
      }

      /*
       * Only a round that actually listed can be the quiet one. A failed round leaves `runs` at
       * the previous answer, whose ids equal `previousIds` by construction, and counting that as
       * settled would end the poll on a 502 with a late-queued run still held.
       */
      const ids = runs
        .map((run) => run.id)
        .toSorted((a, b) => a - b)
        .join(",");
      const settled = runs.length > 0 && ids === previousIds;
      previousIds = ids;
      if (settled) {
        return { runs, approved, refused, timedOut: false };
      }
    }
    if (now() >= deadline) {
      return { runs, approved, refused, timedOut: runs.length === 0 };
    }
    await sleep(pollMs);
  }
}

async function describeError(response: Pick<ApiResponse, "text">): Promise<string> {
  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { message?: string };
    return parsed.message ?? text.slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * What the human needs to know, as Markdown for the lane's PR comment. Empty when there is nothing
 * to do — an approved head needs no paragraph, and a paragraph that appears every time is one
 * nobody reads.
 */
export function renderNote(outcome: Outcome, repo: string, sha: string): string {
  const short = sha.slice(0, 7);
  if (outcome.timedOut) {
    return [
      "",
      "> [!WARNING]",
      `> **No workflow run was queued for \`${short}\` within the budget**, so nothing could be approved. If this PR reads BLOCKED with nothing red, list the head's runs and approve the held ones by hand:`,
      ">",
      `> \`gh api "repos/${repo}/actions/runs?head_sha=${sha}" --jq '.workflow_runs[] | select(.conclusion == "action_required") | "gh api -X POST repos/${repo}/actions/runs/\\(.id)/approve"'\``,
      "",
    ].join("\n");
  }
  if (outcome.refused.length === 0) {
    return "";
  }
  const lines = [
    "",
    "> [!WARNING]",
    `> **The Actions policy is holding ${outcome.refused.length} run(s) on \`${short}\`, and the lane's token was refused when it tried to approve them.** \`ci\` cannot report on this head until they run, so the PR reads BLOCKED until someone does — one line each:`,
    ">",
    ...outcome.refused.map(
      ({ run, status, message }) =>
        `> - [${run.name}](${run.html_url}) — \`${crankFor(repo, run)}\`` +
        `${status > 0 ? ` (HTTP ${status}${message ? `: ${message}` : ""})` : ` (${message})`}`,
    ),
    ">",
    "> Approving every held run is safe, by two different mechanisms: `screenshots.yml` declines its own head on `github.actor` (an approval leaves it alone), and `schemas.yml` regenerates deterministically, so on its own head it pushes nothing.",
    "",
  ];
  return lines.join("\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required — see the header of scripts/ci/approve-held-runs.ts`);
  }
  return value;
}

async function main() {
  const repo = requireEnv("GITHUB_REPOSITORY");
  const sha = requireEnv("HEAD_SHA");
  const token = requireEnv("GITHUB_TOKEN");
  const timeoutMs = Number(process.env.APPROVE_TIMEOUT_MS ?? 90_000);
  /*
   * Actions sets GITHUB_API_URL on every runner; it is also the seam the CLI test points at a
   * local server, because a refusal is the outcome worth exercising end to end.
   */
  const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";

  const outcome = await approveHeldRuns({ repo, sha, token, timeoutMs, apiBase });

  /*
   * "Still held" is counted from the final listing, where an approved run already reads `queued`
   * (attempt 2), so it is the held runs this script never approved — the refused ones, plus any
   * that arrived after the budget — never `held - approved`, which goes negative.
   */
  const stillHeld = outcome.runs.filter(
    (run) => isHeld(run) && !outcome.approved.some((a) => a.id === run.id),
  ).length;
  console.log(
    `${outcome.runs.length} run(s) on ${sha.slice(0, 7)}: ${outcome.approved.length} approved, ` +
      `${outcome.refused.length} refused, ${stillHeld} still held`,
  );
  for (const { run } of outcome.refused) {
    console.log(`::warning::${run.name} is held and could not be approved: ${crankFor(repo, run)}`);
  }
  if (outcome.timedOut) {
    console.log(`::warning::no workflow run appeared for ${sha} within ${timeoutMs} ms`);
  }

  const note = renderNote(outcome, repo, sha);
  const noteFile = process.env.NOTE_FILE;
  if (note && noteFile) {
    appendFileSync(noteFile, note);
  }
}

if (import.meta.main) {
  await main();
}
