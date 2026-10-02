/**
 * `.github/workflows/store-publish.yml` is Microsoft's own publishing path (CLAUDE.md, "Microsoft
 * Store Publishing"): the Store CLI does the work, so what this repository owns is the wiring
 * around it. Each assertion below is one of those wiring decisions, and each would otherwise first
 * be tested by a real release, because the lane is `workflow_call`-only from release-please.yml.
 *
 * The one step with behaviour of its own, the credentials check, is lifted out of the YAML and run,
 * so what is tested is the text that ships.
 *
 * It lives flat in `scripts/` for the same reason `scripts/dependabot-config.test.ts` does: it runs
 * unconditionally via `bun test --isolate scripts` in test.yml's `changes` job, and `.github/**`
 * reaches no test workspace, so this is the only place an edit to the workflow is judged.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(import.meta.dir, "../.github/workflows/store-publish.yml"),
  "utf8",
);

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
  jobs: Record<
    string,
    { "runs-on": string; "timeout-minutes"?: number; steps: Step[]; env?: unknown }
  >;
}

const workflow = Bun.YAML.parse(SOURCE) as Workflow;
const job = workflow.jobs["store-publish"]!;
const step = (name: string): Step => {
  const found = job.steps.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`store-publish.yml has no step named "${name}"`);
  }
  return found;
};

const SECRETS = [
  "STORE_TENANT_ID",
  "STORE_SELLER_ID",
  "STORE_CLIENT_ID",
  "STORE_CLIENT_SECRET",
  "STORE_APP_ID",
];

describe("store-publish.yml", () => {
  test("runs on Windows, where msstore can keep its secret in the OS credential store", () => {
    // On Linux the CLI's credential store is libsecret, and a hosted runner runs no Secret Service.
    expect(job["runs-on"]).toStartWith("windows-");
  });

  test("bounds the CLI's unbounded wait on CommitStarted", () => {
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  test("installs a pinned CLI with Microsoft's own action", () => {
    const install = step("Install the Microsoft Store CLI");
    expect(install.uses).toStartWith("microsoft/microsoft-store-apppublisher@");
    expect(install.with?.version).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  test("never hands a secret to the installer action", () => {
    expect(job.env).toBeUndefined();
    for (const candidate of job.steps.filter((s) => s.uses)) {
      expect(JSON.stringify(candidate.env ?? {})).not.toContain("secrets.");
    }
  });

  test("publishes the release's one MSIX to the app the secret names", () => {
    expect(step("Publish to the Microsoft Store").run).toContain(
      'msstore publish "${packages[0]}" --appId "$STORE_APP_ID"',
    );
  });

  test("checks every secret the lane reads, and only runs the Store steps once all exist", () => {
    const referenced = new Set([...SOURCE.matchAll(/secrets\.(STORE_\w+)/g)].map((m) => m[1]));
    expect([...referenced].toSorted()).toEqual(SECRETS.toSorted());
    const check = step("Check the Store credentials");
    expect(Object.keys(check.env ?? {}).toSorted()).toEqual(SECRETS.toSorted());
    for (const later of job.steps.slice(job.steps.indexOf(check) + 1)) {
      expect(later.if).toBe("steps.credentials.outputs.configured == 'true'");
    }
  });

  test("a retry needs only the tag: a pending submission is replaced, not guarded", () => {
    expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(["tag_name"]);
  });
});

describe("the credentials check", () => {
  let dir: string;
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function check(env: Record<string, string>): Promise<{ output: string; stdout: string }> {
    dir = mkdtempSync(join(tmpdir(), "store-publish-lane-"));
    const outputFile = join(dir, "output");
    await Bun.write(outputFile, "");
    const proc = Bun.spawn(["bash", "-c", step("Check the Store credentials").run!], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile, ...env },
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    expect(await proc.exited).toBe(0);
    return { output: await Bun.file(outputFile).text(), stdout };
  }

  const all = Object.fromEntries(SECRETS.map((name) => [name, "set"]));

  test("lets the Store steps run once all five are set", async () => {
    const { output, stdout } = await check(all);
    expect(output).toBe("configured=true\n");
    expect(stdout).toBe("");
  });

  test("skips green, with a warning naming exactly what is missing", async () => {
    const { STORE_SELLER_ID: _seller, ...four } = all;
    const { output, stdout } = await check({ ...four, STORE_CLIENT_SECRET: "" });
    expect(output).toBe("configured=false\n");
    expect(stdout).toStartWith("::warning::");
    expect(stdout).toContain("missing STORE_SELLER_ID STORE_CLIENT_SECRET");
  });
});
