/**
 * `screenshots.yml` gates itself with a hand-written `paths:` list, because a workflow-level filter
 * costs nothing while a gate job would cost a container boot — but a hand-written list of project
 * directories is exactly the thing that goes stale the moment someone re-points a shot.
 *
 * So it is checked against the manifest. Every project a shot opens must be in the filter, and
 * every project root in the filter must be one a shot opens. Both directions, because the list was
 * wrong in both at once: `packages/starters/sites/**` matched every starter root while shots open
 * only some of them, and `examples` — which `data-source-request` opens — matched nothing at all,
 * so a change there moved a picture and the lane never ran.
 *
 * Fixtures under `scripts/screenshots/` are deliberately NOT derived into their own entries: the
 * `scripts/screenshots/**` entry already covers them, and listing them twice would mean two places
 * to forget.
 */

import { describe, expect, test } from "bun:test";

import { DEFAULT_MANIFEST, validateManifest } from "./lib/types.ts";

const WORKFLOW = ".github/workflows/screenshots.yml";

/** Covered by the `scripts/screenshots/**` entry, so never derived into an entry of their own. */
const PIPELINE_PREFIX = "scripts/screenshots/";

/** Filter entries that are not project roots, and so are not derivable from the manifest. */
const NON_PROJECT = [
  "packages/studio/src/**",
  // Every starter is in `new-project`'s picture regardless of `open.project`.
  "packages/starters/registry.json",
  "scripts/screenshots/**",
  "scripts/check-image-lock.ts",
  "scripts/lib/png.ts",
];

interface Workflow {
  on: { pull_request: { paths: string[] }; push: { paths: string[] } };
}

/* SAFETY: screenshots.yml is a committed workflow whose `on.pull_request.paths` list is the filter
 * this suite exists to check; if that shape moved, reading or filtering `committed` throws, so the
 * suite fails rather than passing on an empty list. */
const workflow = Bun.YAML.parse(await Bun.file(WORKFLOW).text()) as Workflow;
const manifest = validateManifest(await Bun.file(DEFAULT_MANIFEST).json());
const committed = workflow.on.pull_request.paths;

describe("screenshots.yml paths", () => {
  test("the project roots in the filter are exactly the ones shots open", () => {
    const expected = new Set<string>();
    for (const shot of manifest.shots) {
      const project = shot.open?.project;
      if (!project || project.startsWith(PIPELINE_PREFIX)) {
        continue;
      }
      expected.add(`${project}/**`);
    }

    const declared = committed.filter((p) => !NON_PROJECT.includes(p));

    // Named both ways round, so the failure says which side to fix.
    const missing = [...expected].filter((p) => !declared.includes(p)).toSorted();
    const extra = declared.filter((p) => !expected.has(p)).toSorted();
    expect({ extra, missing }).toEqual({ extra: [], missing: [] });
  });

  test("the pipeline entries stay in the filter", () => {
    for (const path of NON_PROJECT) {
      expect(committed).toContain(path);
    }
  });

  test("the lane never lists its own outputs", () => {
    // `docs/images/**` and the capture lock are what this lane WRITES. Both are gitignored build
    // Outputs now, so neither can appear in a diff at all — which is the reason to keep them out
    // Of the filter rather than a reason they could go back in.
    for (const path of committed) {
      expect(path.startsWith("docs/images")).toBe(false);
      expect(path).not.toContain("capture.lock.json");
    }
  });

  test("the push that saves the baseline runs on exactly the pull request's filter", () => {
    // A push that can move a picture and saves no baseline leaves every later report comparing
    // Against a capture that is older than `main`.
    expect(workflow.on.push.paths).toEqual(committed);
  });

  test("the workflow does not list itself", () => {
    // PR #131: a dependabot bump of an action version re-captured all 61 shots.
    expect(committed).not.toContain(WORKFLOW);
  });
});
