/**
 * Covers `scripts/ci/no-credit-label.ts` against a scripted GitHub and the REAL workspace graph,
 * and pins the workflow around it: `pull_request_target` has write access, so the one thing that
 * must never change is that it does not check out the pull request's code.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { readWorkspaces } from "../lib/workspaces.ts";
import {
  AUTOMATION,
  LABEL,
  labelAction,
  lastLabeledBy,
  reachesTests,
  syncNoCreditLabel,
} from "./no-credit-label.ts";
import type { ApiResponse, FetchLike } from "./no-credit-label.ts";
import type { JsonValue } from "@jxsuite/schema/types";

const workspaces = await readWorkspaces();
const WORKFLOW = await Bun.file(
  join(import.meta.dir, "../../.github/workflows/no-credit-label.yml"),
).text();

const respond = (body: JsonValue, status = 200): ApiResponse => ({
  json: () => Promise.resolve(body),
  ok: status < 400,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
});

interface Scripted {
  files?: JsonValue[];
  labels?: JsonValue[];
  events?: JsonValue[];
  failWith?: number;
}

interface ScriptedGithub {
  fetch: FetchLike;
  writes: string[];
}

/** A GitHub answering one pull request, recording every write it is asked for. */
function github(script: Scripted): ScriptedGithub {
  const writes: string[] = [];
  const fetch: FetchLike = (url, init) => {
    const { pathname, searchParams } = new URL(url);
    if (init?.method) {
      writes.push(`${init.method} ${pathname} ${init.body ?? ""}`.trim());
      return Promise.resolve(respond({}, script.failWith ?? 200));
    }
    const page = Number(searchParams.get("page"));
    const all = pathname.endsWith("/files")
      ? (script.files ?? [])
      : pathname.endsWith("/labels")
        ? (script.labels ?? [])
        : (script.events ?? []);
    return Promise.resolve(respond(all.slice((page - 1) * 100, page * 100)));
  };
  return { fetch, writes };
}

const file = (filename: string) => ({ filename });
const labeledBy = (login: string, name = LABEL) => ({
  actor: { login },
  event: "labeled",
  label: { name },
});

function run(script: Scripted) {
  const { fetch, writes } = github(script);
  return {
    action: syncNoCreditLabel({
      apiBase: "https://api.test",
      fetch,
      pr: 7,
      repo: "jxsuite/jx",
      token: "t",
      workspaces,
    }),
    writes,
  };
}

describe("reachesTests", () => {
  test("source in a workspace meets the coverage gate", () => {
    expect(reachesTests(["packages/schema/src/schema.ts"], workspaces)).toBe(true);
  });

  test("paths the matrix skips do not", () => {
    for (const path of [
      "README.md",
      "docs/start/install.md",
      "specs/spec.md",
      "plans/README.md",
      "sites/jxsuite.com/pages/terms.md",
      ".github/workflows/screenshots.yml",
    ]) {
      expect({ path, reaches: reachesTests([path], workspaces) }).toEqual({ path, reaches: false });
    }
  });

  test("one source file among docs is enough, which is how landing a plan still earns", () => {
    expect(reachesTests(["plans/README.md", "packages/schema/src/schema.ts"], workspaces)).toBe(
      true,
    );
  });

  test("a path nobody classified runs everything, so it earns rather than being refused", () => {
    expect(reachesTests(["brand-new-top-level/file.txt"], workspaces)).toBe(true);
  });
});

describe("labelAction", () => {
  const state = (reaches: boolean, labeled: boolean, by: string | null = null) => ({
    labeled,
    lastLabeledBy: by,
    reachesTests: reaches,
  });

  test("a pull request the gate never sees gets the label, once", () => {
    expect(labelAction(state(false, false))).toBe("add");
    expect(labelAction(state(false, true, AUTOMATION))).toBe("none");
    expect(labelAction(state(false, true, "a-maintainer"))).toBe("none");
  });

  test("gaining code takes back this script's label, and never a maintainer's", () => {
    expect(labelAction(state(true, true, AUTOMATION))).toBe("remove");
    expect(labelAction(state(true, true, "a-maintainer"))).toBe("none");
    expect(labelAction(state(true, true, null))).toBe("none");
    expect(labelAction(state(true, false))).toBe("none");
  });
});

describe("lastLabeledBy", () => {
  test("is the newest application of this label, ignoring others", () => {
    expect(
      lastLabeledBy([
        labeledBy(AUTOMATION),
        labeledBy("a-maintainer"),
        labeledBy("someone-else", "bug"),
        { actor: { login: "x" }, event: "unlabeled", label: { name: LABEL } },
      ]),
    ).toBe("a-maintainer");
  });

  test("is null when nothing says who", () => {
    expect(lastLabeledBy([])).toBeNull();
    expect(lastLabeledBy([{ event: "labeled", label: { name: LABEL } }])).toBeNull();
    expect(lastLabeledBy([{ actor: { login: 5 }, event: "labeled", label: { name: LABEL } }])).toBe(
      null,
    );
  });
});

describe("syncNoCreditLabel", () => {
  test("labels a docs-only pull request", async () => {
    const { action, writes } = run({ files: [file("README.md")] });
    expect(await action).toBe("add");
    expect(writes).toEqual([
      `POST /repos/jxsuite/jx/issues/7/labels ${JSON.stringify({ labels: [LABEL] })}`,
    ]);
  });

  test("leaves a code pull request alone", async () => {
    const { action, writes } = run({ files: [file("packages/schema/src/schema.ts")] });
    expect(await action).toBe("none");
    expect(writes).toEqual([]);
  });

  test("takes its own label back when code arrives", async () => {
    const { action, writes } = run({
      events: [labeledBy(AUTOMATION)],
      files: [file("packages/schema/src/schema.ts")],
      labels: [{ name: LABEL }],
    });
    expect(await action).toBe("remove");
    expect(writes).toEqual([`DELETE /repos/jxsuite/jx/issues/7/labels/${LABEL}`]);
  });

  test("never removes a maintainer's label", async () => {
    const { action, writes } = run({
      events: [labeledBy(AUTOMATION), labeledBy("a-maintainer")],
      files: [file("packages/schema/src/schema.ts")],
      labels: [{ name: LABEL }],
    });
    expect(await action).toBe("none");
    expect(writes).toEqual([]);
  });

  test("reads past the first page, so a large pull request is judged on all of it", async () => {
    const docs = Array.from({ length: 100 }, (_, i) => file(`docs/page-${i}.md`));
    const { action, writes } = run({ files: [...docs, file("packages/schema/src/schema.ts")] });
    expect(await action).toBe("none");
    expect(writes).toEqual([]);
  });

  test("skips an entry it cannot read", async () => {
    const { action } = run({ files: [{ nope: 1 }, file("README.md")] });
    expect(await action).toBe("add");
  });

  test("a refused write fails the job, naming what was refused", () => {
    const { action } = run({ failWith: 403, files: [file("README.md")] });
    return expect(action).rejects.toThrow("POST /issues/7/labels: 403");
  });
});

describe("the workflow", () => {
  test("has the write access a fork's pull request needs, and nothing broader", () => {
    expect(WORKFLOW).toContain("pull_request_target:");
    expect(WORKFLOW).toContain("pull-requests: write");
    expect(WORKFLOW).not.toContain("contents: write");
  });

  test("never checks out the pull request's code", () => {
    // `ref:` is how a pull_request_target job comes to run untrusted code with a write token.
    expect(WORKFLOW).not.toMatch(/^\s*ref:/m);
    expect(WORKFLOW).not.toContain("github.event.pull_request.head");
    expect(WORKFLOW).toContain("persist-credentials: false");
  });

  test("runs the script against this pull request, skipping bots, which earn nothing", () => {
    expect(WORKFLOW).toContain("bun scripts/ci/no-credit-label.ts");
    expect(WORKFLOW).toContain("PR_NUMBER: ${{ github.event.pull_request.number }}");
    expect(WORKFLOW).toContain("github.event.pull_request.user.type != 'Bot'");
  });

  test("installs nothing, so no dependency script runs with the write token", () => {
    expect(WORKFLOW).toContain('install: "false"');
  });
});
