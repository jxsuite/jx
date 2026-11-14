/**
 * Applies the `no-credit` label to a pull request the test matrix would not run for.
 *
 * A pull request merged into this repository earns its author a free month of Jx Studio Cloud
 * (CONTRIBUTING.md), and what makes that safe to offer is the coverage gate. A pull request that
 * only touches paths `decide()` runs no tests for passes `ci` without ever meeting that gate, so a
 * one-word README fix would earn the same as a feature. The platform reads this label off the
 * merged pull request and grants nothing when it is there.
 *
 * It asks `decide()` rather than keeping a list of its own, so the two cannot drift: the rule is
 * exactly "the coverage gate saw this".
 *
 * WHO OWNS THE LABEL. Maintainers apply it by hand too, to withhold credit from a pull request that
 * does reach the tests. So this removes the label only when its own last application is the reason
 * it is there: a docs-only pull request that later gains code gets its credit back, and a
 * maintainer's decision is never undone by the next push.
 *
 * WHY `pull_request_target`, AND WHAT THAT DEMANDS. A fork's `pull_request` run has a read-only
 * token and cannot label anything, and most of the pull requests this exists for come from forks.
 * `pull_request_target` has write access, so the workflow must never run the pull request's own
 * code: it checks out the base branch, and this script learns the changed paths from the API and
 * never reads their contents. `no-credit-label.test.ts` pins that.
 *
 *     GITHUB_REPOSITORY=jxsuite/jx PR_NUMBER=123 GITHUB_TOKEN=<token> \
 *       bun scripts/ci/no-credit-label.ts
 *
 * @docs extending/contributing/monorepo
 */

import { isJsonRecord, isText } from "../lib/json-guards.ts";
import { readWorkspaces } from "../lib/workspaces.ts";
import type { Workspace } from "../lib/workspaces.ts";
import { decide } from "./affected.ts";
import type { JsonValue } from "@jxsuite/schema/types";

/** The label the platform reads. Renaming it here means renaming it in the platform's webhook. */
export const LABEL = "no-credit";

/** Who this script acts as, which is how it recognises its own application of the label. */
export const AUTOMATION = "github-actions[bot]";

const PAGE_SIZE = 100;

/** What a response has to offer: the fields read here, nothing more. */
export interface ApiResponse {
  ok: boolean;
  status: number;
  json: () => Promise<JsonValue>;
  text: () => Promise<string>;
}

/** The subset of `fetch` this script uses, so a test can hand it a fake. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<ApiResponse>;

export interface Options {
  /** `owner/repo`, as `GITHUB_REPOSITORY` spells it. */
  repo: string;
  pr: number;
  token: string;
  workspaces: Workspace[];
  fetch?: FetchLike;
  apiBase?: string;
}

export type LabelAction = "add" | "remove" | "none";

/** Whether the coverage gate would see a pull request changing these paths. */
export function reachesTests(changed: string[], workspaces: Workspace[]): boolean {
  return decide(changed, workspaces).testDirs.length > 0;
}

/** What to do, given where the pull request stands. See the module comment for who owns the label. */
export function labelAction(state: {
  reachesTests: boolean;
  labeled: boolean;
  lastLabeledBy: string | null;
}): LabelAction {
  if (!state.reachesTests) {
    return state.labeled ? "none" : "add";
  }
  return state.labeled && state.lastLabeledBy === AUTOMATION ? "remove" : "none";
}

/** Run one pull request through the rule, and answer what was done. */
export async function syncNoCreditLabel(options: Options): Promise<LabelAction> {
  const { repo, pr, token, workspaces } = options;
  const request = options.fetch ?? globalThis.fetch;
  const api = options.apiBase ?? "https://api.github.com";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  const send = async (path: string, init: { method?: string; body?: string } = {}) => {
    const res = await request(`${api}/repos/${repo}${path}`, { ...init, headers });
    if (!res.ok) {
      throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
    }
    return res;
  };

  /** Every page of a list, oldest first where GitHub orders it that way. */
  const list = async (path: string): Promise<JsonValue[]> => {
    const all: JsonValue[] = [];
    for (let page = 1; ; page += 1) {
      const res = await send(`${path}?per_page=${PAGE_SIZE}&page=${page}`);
      const body = await res.json();
      const items = Array.isArray(body) ? body : [];
      all.push(...items);
      if (items.length < PAGE_SIZE) {
        return all;
      }
    }
  };

  const files = await list(`/pulls/${pr}/files`);
  const changed = files.flatMap((file) =>
    isJsonRecord(file) && isText(file["filename"]) ? [file["filename"]] : [],
  );
  const labels = await list(`/issues/${pr}/labels`);
  const labeled = labels.some((label) => isJsonRecord(label) && label["name"] === LABEL);
  const action = labelAction({
    labeled,
    lastLabeledBy: labeled ? lastLabeledBy(await list(`/issues/${pr}/events`)) : null,
    reachesTests: reachesTests(changed, workspaces),
  });

  if (action === "add") {
    await send(`/issues/${pr}/labels`, {
      body: JSON.stringify({ labels: [LABEL] }),
      method: "POST",
    });
  } else if (action === "remove") {
    await send(`/issues/${pr}/labels/${LABEL}`, { method: "DELETE" });
  }
  return action;
}

/** Who last applied the label, from the issue's events, which GitHub lists oldest first. */
export function lastLabeledBy(events: JsonValue[]): string | null {
  const applied = events.findLast(
    (event) =>
      isJsonRecord(event) &&
      event["event"] === "labeled" &&
      isJsonRecord(event["label"]) &&
      event["label"]["name"] === LABEL,
  );
  if (!isJsonRecord(applied) || !isJsonRecord(applied["actor"])) {
    return null;
  }
  const { login } = applied["actor"];
  return isText(login) ? login : null;
}

async function main(): Promise<void> {
  const repo = process.env["GITHUB_REPOSITORY"];
  const pr = Number(process.env["PR_NUMBER"]);
  const token = process.env["GITHUB_TOKEN"];
  if (!repo || !Number.isInteger(pr) || pr <= 0 || !token) {
    throw new Error("GITHUB_REPOSITORY, PR_NUMBER and GITHUB_TOKEN are all required");
  }
  const workspaces = await readWorkspaces();
  const action = await syncNoCreditLabel({ pr, repo, token, workspaces });
  console.log(`no-credit-label: #${pr}: ${action}`);
}

if (import.meta.main) {
  await main();
}
