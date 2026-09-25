/**
 * Every workflow step that builds the Electrobun desktop app must first materialise the vendored
 * Electrobun SDK.
 *
 * The launcher's init bundle is compiled by plain `bun build`, which resolves `electrobun/view`
 * through `packages/desktop/tsconfig.json` `paths` into `vendor/electrobun`. A bare
 * `actions/checkout` leaves that submodule empty, the bundler silently falls back to
 * `node_modules/electrobun` (every export of which throws), and the build still succeeds. Desktop
 * 5.0.0 through 5.1.3 shipped that init.js from every release lane. `pre-build.ts` now runs
 * `--init` itself, so this is the second line; it is the one that says which lane forgot, in the
 * pull request that added it, instead of at the first release that runs it — release lanes are
 * `workflow_call`-only and nothing else executes them before a tag.
 *
 * It lives flat in `scripts/` for the same reason `scripts/dependabot-config.test.ts` does: it runs
 * unconditionally via `bun test --isolate scripts` in test.yml's `changes` job, and `.github/**`
 * reaches no test workspace, so this is the only place a workflow edit is judged.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = ".github/workflows";

/** A step that packages the Electrobun app, by any of the routes a workflow could spell it. */
const DESKTOP_BUILD =
  /desktop:(stable|msix|release|build)|electrobun (build|dev)|build:(stable|msix|release)/;

/** What makes `vendor/electrobun` real before the build reads it. */
const VENDOR_INIT = "check-electrobun-vendor.ts --init";

interface Step {
  name?: string;
  run?: string;
  uses?: string;
}
interface Workflow {
  jobs?: Record<string, { steps?: Step[] }>;
}

/** Every desktop build step in the repository, with whether its own job prepared the SDK first. */
function desktopBuildSteps(): { where: string; prepared: boolean }[] {
  const found: { where: string; prepared: boolean }[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f))) {
    const workflow = Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow;
    for (const [job, { steps = [] }] of Object.entries(workflow.jobs ?? {})) {
      for (const [index, step] of steps.entries()) {
        if (typeof step.run !== "string" || !DESKTOP_BUILD.test(step.run)) {
          continue;
        }
        const prepared = steps
          .slice(0, index)
          .some((earlier) => typeof earlier.run === "string" && earlier.run.includes(VENDOR_INIT));
        found.push({ where: `${file} › ${job} › ${step.name ?? step.run}`, prepared });
      }
    }
  }
  return found;
}

describe("desktop build lanes", () => {
  const lanes = desktopBuildSteps();

  // Without this, renaming the npm scripts would make every lane invisible and the test green.
  test("at least one workflow builds the desktop app", () => {
    expect(lanes.length).toBeGreaterThan(0);
  });

  test("every desktop build step is preceded, in its own job, by the vendor --init", () => {
    expect(lanes.filter((lane) => !lane.prepared).map((lane) => lane.where)).toEqual([]);
  });
});
