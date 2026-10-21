/**
 * Covers `scripts/publish-released.ts` and the two workflows around it.
 *
 * The case is the 2026-10-17 release: the old `set -e` loop died at `@jxsuite/catalog` with npm's
 * `E404 Not Found - PUT` and never attempted `site` or `runtime` behind it. The registry is
 * injected, so nothing here touches npm.
 */

import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkflowStep } from "./lib/workflow-syntax.ts";
import {
  backfillCommand,
  issueSection,
  npmErrorLine,
  publishAll,
  summaryTable,
} from "./publish-released.ts";
import type { PublishAttempt, ReleasedPackage, Registry } from "./publish-released.ts";

const pkg = (name: string, version: string): ReleasedPackage => ({
  dir: `packages/${name}`,
  name: `@jxsuite/${name}`,
  version,
});

/** The order run 39048400671 published in, from catalog onward. */
const ORDER = [pkg("catalog", "0.1.2"), pkg("site", "2.0.5"), pkg("runtime", "5.0.0")];

const E404 = [
  "npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access",
  "npm error code E404",
  "npm error 404 Not Found - PUT https://registry.npmjs.org/@jxsuite%2fcatalog - Not found",
  "npm error 404",
  "npm error 404  '@jxsuite/catalog@0.1.2' is not in this registry.",
].join("\n");

function registry(
  published: string[],
  attempts: Record<string, PublishAttempt>,
): Registry & { tried: string[] } {
  const tried: string[] = [];
  return {
    isPublished: (name, version) => published.includes(`${name}@${version}`),
    publish: (p) => {
      tried.push(p.name);
      return attempts[p.name] ?? { ok: true, output: `+ ${p.name}@${p.version}` };
    },
    tried,
  };
}

describe("publishAll", () => {
  test("a failure does not stop the loop: site and runtime are still attempted", () => {
    const npm = registry([], { "@jxsuite/catalog": { ok: false, output: E404 } });
    const outcomes = publishAll(ORDER, npm);
    expect(npm.tried).toEqual(["@jxsuite/catalog", "@jxsuite/site", "@jxsuite/runtime"]);
    expect(outcomes.map((o) => o.status)).toEqual(["FAILED", "published", "published"]);
    expect(outcomes[0]!.error).toBe(
      "npm error 404 Not Found - PUT https://registry.npmjs.org/@jxsuite%2fcatalog - Not found",
    );
  });

  test("keeps the given (topological) order and skips what npm already has", () => {
    const npm = registry(["@jxsuite/site@2.0.5"], {});
    const outcomes = publishAll(ORDER, npm);
    expect(outcomes.map((o) => `${o.name} ${o.status}`)).toEqual([
      "@jxsuite/catalog published",
      "@jxsuite/site already published",
      "@jxsuite/runtime published",
    ]);
    expect(npm.tried).not.toContain("@jxsuite/site");
  });

  test("a publish conflict is an outcome, not a failure (the registry lagged the view)", () => {
    const npm = registry([], {
      "@jxsuite/site": {
        ok: false,
        output:
          "npm error code E403\nnpm error You cannot publish over the previously published versions: 2.0.5.",
      },
    });
    expect(publishAll(ORDER, npm).map((o) => o.status)).toEqual([
      "published",
      "already published",
      "published",
    ]);
  });

  test("logs a group per package and the outcome inside it", () => {
    const lines: string[] = [];
    publishAll(
      [ORDER[0]!],
      registry([], { "@jxsuite/catalog": { ok: false, output: E404 } }),
      (l) => lines.push(l),
    );
    expect(lines[0]).toBe("::group::packages/catalog -> @jxsuite/catalog@0.1.2");
    expect(lines.at(-2)).toStartWith("FAILED: npm error 404 Not Found - PUT");
    expect(lines.at(-1)).toBe("::endgroup::");
  });
});

describe("npmErrorLine", () => {
  test("prefers the line that carries a status or code", () => {
    expect(npmErrorLine(E404)).toStartWith("npm error 404 Not Found - PUT");
    expect(npmErrorLine("npm error something\nnpm error code EOTP")).toBe("npm error code EOTP");
  });

  test("falls back to the first npm error line, then the last line, then a placeholder", () => {
    expect(npmErrorLine("npm error vague\nnpm error vaguer")).toBe("npm error vague");
    expect(npmErrorLine("built\nsegfault\n")).toBe("segfault");
    expect(npmErrorLine("")).toBe("no output");
  });
});

describe("reports", () => {
  const green = publishAll(ORDER, registry([], {}));
  const outcomes = publishAll(
    ORDER,
    registry([], {
      "@jxsuite/runtime": { ok: false, output: "npm error code E500 | boom" },
      "@jxsuite/site": { ok: false, output: E404 },
    }),
  );

  test("the summary table has one row per package and escapes pipes", () => {
    const table = summaryTable(outcomes);
    expect(table).toContain("**2 of 3 package(s) were not published.**");
    expect(table).toContain("| `@jxsuite/catalog@0.1.2` | published |  |");
    expect(table).toContain(String.raw`E500 \| boom`);
  });

  test("an all-green table says so", () => {
    expect(summaryTable(green)).toContain("All 3 package(s) are on npm.");
  });

  test("the issue names every unpublished name@version and the one recovery command", () => {
    const issue = issueSection(outcomes, { runUrl: "https://x/run", sha: "abc123" });
    expect(issue).toContain("`@jxsuite/site@2.0.5`");
    expect(issue).toContain("`@jxsuite/runtime@5.0.0`");
    expect(issue).not.toContain("catalog@");
    expect(issue).toContain(
      `gh workflow run release-please.yml -f backfill_paths='["packages/site","packages/runtime"]' -f backfill_sha=abc123`,
    );
    expect(issue).toContain("trusted publisher");
  });

  test("no failures, no issue", () => {
    expect(issueSection(green, { runUrl: "", sha: "" })).toBe(undefined);
  });

  test("the backfill command goes through release-please.yml, never publish.yml", () => {
    expect(backfillCommand(["packages/runtime"], "runtime-v5.0.0")).toBe(
      `gh workflow run release-please.yml -f backfill_paths='["packages/runtime"]' -f backfill_sha=runtime-v5.0.0`,
    );
  });
});

interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  uses?: string;
  with?: Record<string, string>;
  steps?: WorkflowStep[];
}
interface Workflow {
  on?: Record<string, { inputs?: Record<string, { type?: string }> } | null>;
  jobs?: Record<string, Job>;
}

function workflow(file: string): Workflow {
  /* SAFETY: a committed GitHub Actions workflow; every member read below is optional and
     re-checked where it is used. */
  return Bun.YAML.parse(
    readFileSync(join(import.meta.dir, "../.github/workflows", file), "utf8"),
  ) as Workflow;
}

describe("the publish lane", () => {
  const publish = workflow("publish.yml");
  const release = workflow("release-please.yml");

  test("publish.yml cannot be dispatched directly: npm's trusted publisher would refuse it", () => {
    expect(Object.keys(publish.on ?? {})).toEqual(["workflow_call"]);
  });

  test("publish.yml runs the script, not a `set -e` loop, and files failures on the issue", () => {
    const steps = publish.jobs?.publish?.steps ?? [];
    const run = steps.find((s) => s.run?.includes("scripts/publish-released.ts"));
    expect(run?.run).toContain("--issue-body publish-issue.md");
    const file = steps.find((s) => s.run?.includes("--body-file publish-issue.md"));
    expect(file?.if).toContain("failure()");
    expect(file?.run).toContain('title="Released versions that never shipped"');
  });

  test("the script runs from the caller's ref, so a backfill from an older release tag still finds it", () => {
    // The runtime-v5.0.0 tree has no publish-released.ts. The packages come from `inputs.sha`,
    // The tooling from `github.sha` (the dispatched branch head), checked out beside them.
    const steps = publish.jobs?.publish?.steps ?? [];
    const packages = steps.find((s) => s.uses?.startsWith("actions/checkout") && !s.with?.path);
    expect(packages?.with?.ref).toBe("${{ inputs.sha || github.sha }}");
    const toolsAt = steps.findIndex((s) => s.with?.path === ".release-tools");
    const tools = steps[toolsAt];
    expect(tools?.uses).toStartWith("actions/checkout");
    expect(tools?.with?.ref).toBe("${{ github.sha }}");
    expect(tools?.with?.["sparse-checkout"]).toBe("scripts");
    const build = steps.findIndex((s) => s.run === "bun run build");
    const run = steps.findIndex((s) => s.run?.includes("publish-released.ts"));
    // After the build, so nothing in it joins the install or the build; before the publish.
    expect(build).toBeLessThan(toolsAt);
    expect(toolsAt).toBeLessThan(run);
    expect(steps[run]?.run).toStartWith("bun .release-tools/scripts/publish-released.ts");
  });

  test("release-please.yml's dispatch takes the backfill inputs", () => {
    const inputs = release.on?.workflow_dispatch?.inputs ?? {};
    expect(Object.keys(inputs).toSorted()).toEqual(["backfill_paths", "backfill_sha"]);
  });

  test("backfill mode skips release-please and runs publish with the backfill inputs", () => {
    const jobs = release.jobs ?? {};
    expect(jobs["release-please"]?.if).toContain("!inputs.backfill_paths");
    const job = jobs.publish;
    expect(job?.uses).toBe("./.github/workflows/publish.yml");
    expect(job?.if).toContain("inputs.backfill_paths ||");
    expect(job?.if).toContain("needs.release-please.result == 'success'");
    expect(job?.with?.paths_released).toContain("inputs.backfill_paths ||");
    expect(job?.with?.sha).toContain("inputs.backfill_sha ||");
    expect(job?.permissions).toEqual({ contents: "read", "id-token": "write", issues: "write" });
  });

  test("no other job can run in backfill mode", () => {
    // Each job but publish either needs release-please's outputs (empty when it is skipped) or
    // Opts out of backfill mode by name.
    for (const [name, job] of Object.entries(release.jobs ?? {})) {
      if (name === "publish" || name === "release-please") {
        continue;
      }
      const cond = job.if ?? "";
      expect(
        cond.includes("needs.release-please.outputs.") || cond.includes("!inputs.backfill_paths"),
        `${name}: ${cond}`,
      ).toBe(true);
      // A condition that ORs in something else could still fire with empty outputs.
      expect(cond, name).not.toContain("||");
    }
  });

  test("the scheduled integrity sweep, and only it, asks npm", () => {
    const steps = release.jobs?.["verify-release-integrity"]?.steps ?? [];
    const step = steps.find((s) => s.run?.includes("check-release-integrity.ts"));
    expect(step?.run).toContain('if [ "$EVENT" = "schedule" ]; then npm_flag="--npm"; fi');
    expect(step?.env?.EVENT).toBe("${{ github.event_name }}");
  });
});
