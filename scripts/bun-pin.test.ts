/**
 * ONE exact Bun for every workflow. The pin is `.bun-version` at the repository root; the composite
 * `.github/actions/setup-bun` is the only reader of it in CI, and every job that runs Bun goes
 * through that action. Before this, the composite pinned 1.4.3 while nine workflows still carried
 * their own `bun-version: 1.4`, a floating minor, so a bump reached the test matrix and silently
 * missed the release lanes that build and publish what the matrix tested.
 *
 * It lives flat in `scripts/` for the same reason `scripts/dependabot-config.test.ts` does: it runs
 * unconditionally via `bun test --isolate scripts` in test.yml's `changes` job, and `.github/**`
 * reaches no test workspace, so this is the only place an edit to a workflow is judged.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readPinnedBunVersion } from "../packages/test-support/src/bun-pin.ts";
import type { WorkflowStep } from "./lib/workflow-syntax.ts";

const ROOT = join(import.meta.dir, "..");
const WORKFLOWS = join(ROOT, ".github/workflows");
const COMPOSITE = join(ROOT, ".github/actions/setup-bun/action.yml");
const PIN = readFileSync(join(ROOT, ".bun-version"), "utf8");

interface Job {
  uses?: string;
  steps?: WorkflowStep[];
}
interface Workflow {
  jobs: Record<string, Job>;
}
interface CompositeAction {
  runs: { using: string; steps: WorkflowStep[] };
}

/** A shell line that invokes Bun: `bun …` or `bunx …` as a command, not as part of a word. */
const RUNS_BUN = /(?:^|[\s;&|(`])bunx?\s/mu;

function workflows(): [string, Workflow][] {
  return readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
    .toSorted()
    .map((file) => {
      /* SAFETY: every file in .github/workflows is a workflow GitHub accepts, which requires a
         `jobs` map; a job is either a reusable-workflow call (`uses`) or carries `steps`. */
      const parsed = Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow;
      return [file, parsed];
    });
}

/* SAFETY: the composite is an action GitHub runs, which requires `runs.using` and, for a
   composite, `runs.steps`. */
const composite = Bun.YAML.parse(readFileSync(COMPOSITE, "utf8")) as CompositeAction;

describe("the pin", () => {
  test("is one exact version on one line", () => {
    expect(PIN).toMatch(/^\d+\.\d+\.\d+\n?$/u);
  });

  test("is the version the test preload compares the local Bun against", () => {
    expect(readPinnedBunVersion()).toBe(PIN.trim());
  });
});

/** Every step that sets up Bun other than through the composite, or names its own version. */
function setupOffences(all: [string, Workflow][]): string[] {
  const offences: string[] = [];
  for (const [file, workflow] of all) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith("oven-sh/setup-bun") === true) {
          offences.push(`${file} › ${id}: uses ${step.uses} directly`);
        }
        for (const key of ["bun-version", "bun-version-file"]) {
          if (step.with !== undefined && key in step.with) {
            offences.push(`${file} › ${id}: sets ${key}`);
          }
        }
      }
    }
  }
  return offences;
}

/** Every job whose first Bun command comes before (or without) the composite. */
function orderOffences(all: [string, Workflow][]): string[] {
  const offences: string[] = [];
  for (const [file, workflow] of all) {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      const steps = job.steps ?? [];
      const setup = steps.findIndex((step) => step.uses === "./.github/actions/setup-bun");
      const first = steps.findIndex((step) => RUNS_BUN.test(step.run ?? ""));
      if (first !== -1 && (setup === -1 || setup > first)) {
        offences.push(`${file} › ${id}: step ${first} runs bun before the composite set it up`);
      }
    }
  }
  return offences;
}

describe("the composite", () => {
  test("installs exactly the version in .bun-version, read from the file", () => {
    const { steps } = composite.runs;
    const read = steps.find((step) => step.id === "pin");
    const setup = steps.find((step) => step.uses?.startsWith("oven-sh/setup-bun@") === true);
    expect(composite.runs.using).toBe("composite");
    expect(read?.run).toBe(
      `echo "version=$(tr -d '[:space:]' < .bun-version)" >> "$GITHUB_OUTPUT"`,
    );
    expect(setup?.with).toEqual({ "bun-version": "${{ steps.pin.outputs.version }}" });
    expect(steps.indexOf(read ?? {})).toBeLessThan(steps.indexOf(setup ?? {}));
  });
});

describe("every workflow", () => {
  const all = workflows();

  test("there are workflows to check, and they set Bun up only through the composite", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(setupOffences(all)).toEqual([]);
  });

  test("a job that runs Bun sets it up through the composite first", () => {
    expect(orderOffences(all)).toEqual([]);
  });
});

describe("the checks themselves", () => {
  const job = (steps: WorkflowStep[]): [string, Workflow][] => [
    ["w.yml", { jobs: { j: { steps } } }],
  ];
  const viaComposite: WorkflowStep = { uses: "./.github/actions/setup-bun" };

  test("refuse a direct setup-bun, and a version or version file on any step", () => {
    const steps: WorkflowStep[] = [
      { uses: "oven-sh/setup-bun@v2", with: { "bun-version": "1.4" } },
      { uses: "some/other@v1", with: { "bun-version-file": "package.json" } },
    ];
    expect(setupOffences(job(steps))).toEqual([
      "w.yml › j: uses oven-sh/setup-bun@v2 directly",
      "w.yml › j: sets bun-version",
      "w.yml › j: sets bun-version-file",
    ]);
  });

  test("refuse a bun command with no composite, or before it; allow one after it", () => {
    const missing = orderOffences(job([{ run: "bun install" }]));
    const early = orderOffences(job([{ run: "set -e\nbunx oxfmt ." }, viaComposite]));
    const nested = orderOffences(job([{ run: '( cd "$pkg" && bun pm pack )' }]));
    const fine = orderOffences(job([viaComposite, { run: "bun test --isolate" }]));
    expect([missing, early, nested, fine]).toEqual([
      ["w.yml › j: step 0 runs bun before the composite set it up"],
      ["w.yml › j: step 0 runs bun before the composite set it up"],
      ["w.yml › j: step 0 runs bun before the composite set it up"],
      [],
    ]);
  });

  test("do not mistake a mention of the word for a bun command", () => {
    const steps: WorkflowStep[] = [
      { run: "echo bun.lock changed" },
      { run: "rm -rf ~/.bun/install/cache" },
    ];
    expect(orderOffences(job(steps))).toEqual([]);
  });

  test("ignore a job that calls a reusable workflow", () => {
    expect(
      orderOffences([["w.yml", { jobs: { j: { uses: "./.github/workflows/x.yml" } } }]]),
    ).toEqual([]);
  });
});
