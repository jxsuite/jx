/**
 * `.github/workflows/mas-publish.yml` is the Mac App Store lane (packages/desktop/AGENTS.md, "Mac
 * App Store Publishing"): it builds and uploads the package, and a second job submits it to App
 * Review with `scripts/mas-submit.ts`. The lane is only ever called from release-please.yml, so
 * each wiring decision below would otherwise first be tested by a real release.
 *
 * It lives flat in `scripts/` for the reason `store-publish-lane.test.ts` does: `.github/**`
 * reaches no test workspace, so this is the only place an edit to the workflow is judged.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkflowStep } from "./lib/workflow-syntax.ts";

const read = (file: string): string =>
  readFileSync(join(import.meta.dir, "../.github/workflows", file), "utf8");

interface Input {
  default?: string | boolean;
  type?: string;
}
interface Job {
  if?: string;
  needs?: string;
  outputs?: Record<string, string>;
  "runs-on": string;
  steps: WorkflowStep[];
  uses?: string;
  with?: Record<string, string>;
}
interface Workflow {
  jobs: Record<string, Job>;
  on: {
    workflow_call: { inputs: Record<string, Input> };
    workflow_dispatch: { inputs: Record<string, Input> };
  };
}

/* SAFETY: both files are committed workflows GitHub refuses to run unless they carry an `on` map
 * and a `jobs` map; a job or step this suite names but the file lacks fails by name below. */
const parse = (file: string) => Bun.YAML.parse(read(file)) as Workflow;
const lane = parse("mas-publish.yml");
const release = parse("release-please.yml");

const submit = lane.jobs["mas-submit"];
const upload = lane.jobs["mas-publish"];

describe("mas-publish.yml", () => {
  test("submits in a job of its own, after the upload", () => {
    expect(submit?.needs).toBe("mas-publish");
    expect(upload?.["runs-on"]).toBe("macos-15");
    // Waiting for Apple to process the build must not hold a macOS runner.
    expect(submit?.["runs-on"]).toBe("ubuntu-latest");
  });

  test("hands the submission the build number the package carries, and whether anything uploaded", () => {
    const build = upload?.steps.find((step) => step.name === "Build the Mac App Store package");
    expect(build?.run).toContain("-c.mac.bundleVersion=${{ github.run_number }}");
    expect(upload?.outputs).toEqual({
      build_number: "${{ github.run_number }}",
      uploaded: "${{ steps.credentials.outputs.configured }}",
    });
    expect(submit?.if).toBe("inputs.submit && needs.mas-publish.outputs.uploaded == 'true'");
  });

  test("submits on a release and not on a run started by hand", () => {
    expect(lane.on.workflow_call.inputs.submit?.default).toBe(true);
    expect(lane.on.workflow_dispatch.inputs.submit?.default).toBe(false);
    expect(lane.on.workflow_call.inputs.release_type?.default).toBe("MANUAL");
    expect(lane.on.workflow_dispatch.inputs.release_type?.default).toBe("MANUAL");
  });

  test("runs the script with the build number and release type, reading the key from a file it removes", () => {
    const step = submit?.steps.find((candidate) => candidate.name === "Submit to App Review");
    expect(step?.env).toMatchObject({
      BUILD_NUMBER: "${{ needs.mas-publish.outputs.build_number }}",
      RELEASE_TYPE: "${{ inputs.release_type }}",
    });
    expect(step?.run).toContain('bun scripts/mas-submit.ts --build "$BUILD_NUMBER"');
    expect(step?.run).toContain('--release-type "$RELEASE_TYPE"');
    expect(step?.run).toContain("trap 'rm -f \"$APPLE_API_KEY_PATH\"' EXIT");
  });

  test("installs no dependencies, because the script imports only Node", () => {
    const setup = submit?.steps.find((step) => step.uses === "./.github/actions/setup-bun");
    expect(setup?.with).toEqual({ install: "false" });
    expect(readFileSync(join(import.meta.dir, "mas-submit.ts"), "utf8")).not.toMatch(
      /from "(?!node:|\.)[^"]+"/,
    );
  });
});

describe("release-please.yml", () => {
  test("calls the lane with the repository variables that steer the submission", () => {
    const call = release.jobs["mas-publish"];
    expect(call?.uses).toBe("./.github/workflows/mas-publish.yml");
    expect(call?.with?.submit).toBe("${{ vars.MAS_SUBMIT != 'false' }}");
    expect(call?.with?.release_type).toBe("${{ vars.MAS_RELEASE_TYPE || 'MANUAL' }}");
  });

  test("nothing waits on the store lane, so a failed submission never holds the release", () => {
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name !== "mas-publish") {
        expect(String(job.needs ?? "")).not.toContain("mas-publish");
      }
    }
  });
});
