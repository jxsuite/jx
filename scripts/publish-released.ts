/**
 * Publish every package release-please released this run, in topological order, attempting EVERY
 * one even when an earlier one fails, and say exactly what happened to each.
 *
 * ## Why the loop no longer stops at the first failure
 *
 * It was a bash loop under `set -euo pipefail`. On the 2026-10-17 release (run 39048400671) it
 * reached `@jxsuite/catalog`, a brand-new package with no npm trusted publisher yet, and npm
 * answered `E404 Not Found - PUT …/@jxsuite%2fcatalog`. The step died there, so every package later
 * in topological order was never attempted: `@jxsuite/site@2.0.5` and `@jxsuite/runtime@5.0.0` both
 * had a tag and a GitHub release and were never on npm. Every package published since then depends
 * on `^5.0.0` and `^2.0.5`, so installing any of them failed to resolve. The run was red, but a
 * Microsoft Store failure in the same run drew the eye.
 *
 * Attempting the rest does not risk publishing a dependent before its dependency: a dependent whose
 * dependency failed is published against a range npm cannot satisfy YET, which is the same state
 * the stopped loop left (the dependents released before the failure were already out), and the
 * backfill below completes it. Stopping early only made the hole bigger.
 *
 * ## What it reports
 *
 * - One line per package in the log, and a table in the job summary: published, already published, or
 *   FAILED with npm's own error line.
 * - With `--issue-body <file>`, a Markdown section naming every unpublished `name@version` and the
 *   one command that publishes them (see `backfillCommand`). The workflow files it on the single
 *   `release-incomplete` issue. That is this job's own deterministic outcome, not a registry probe,
 *   so it cannot race the registry's write lag the way the removed npm probe did
 *   (.github/AGENTS.md, "The post-merge gate does not ask npm").
 * - Exit status 1 at the END when anything failed.
 *
 *   PATHS_RELEASED='["packages/runtime"]' bun scripts/publish-released.ts --issue-body issue.md
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isJsonRecord, isText } from "./lib/json-guards.ts";

export interface ReleasedPackage {
  /** Repo-relative workspace directory, e.g. `packages/runtime`. */
  dir: string;
  name: string;
  version: string;
}

export type PublishStatus = "published" | "already published" | "FAILED";

export interface PublishOutcome extends ReleasedPackage {
  status: PublishStatus;
  /** Npm's own error line, for a failure. */
  error?: string;
}

/** What one `npm publish` attempt printed, and whether it exited 0. */
export interface PublishAttempt {
  ok: boolean;
  output: string;
}

/** The registry, injected so the loop is testable without npm. */
export interface Registry {
  isPublished: (name: string, version: string) => boolean;
  publish: (pkg: ReleasedPackage) => PublishAttempt;
}

/** Npm's answer to publishing a version that already exists: an outcome, not a failure. */
const ALREADY = /EPUBLISHCONFLICT|cannot publish over the previously published version/i;

/**
 * The line of npm's output that says why. In order of preference: an HTTP status with its reason
 * (`npm error 404 Not Found - PUT …`, which names the request that failed), then the error code
 * (`npm error code EOTP`), then the first `npm error` line, then the last non-empty line.
 */
export function npmErrorLine(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const errors = lines.filter((l) => /^npm (?:error|ERR!)/i.test(l));
  return (
    errors.find((l) => /^npm (?:error|ERR!) [45]\d\d [A-Z]/i.test(l)) ??
    errors.find((l) => /^npm (?:error|ERR!) code E/i.test(l)) ??
    errors[0] ??
    lines.at(-1) ??
    "no output"
  );
}

/** Attempt every package in order; never stop early. */
export function publishAll(
  packages: readonly ReleasedPackage[],
  registry: Registry,
  log: (line: string) => void = () => {},
): PublishOutcome[] {
  const outcomes: PublishOutcome[] = [];
  for (const pkg of packages) {
    log(`::group::${pkg.dir} -> ${pkg.name}@${pkg.version}`);
    let outcome: PublishOutcome;
    if (registry.isPublished(pkg.name, pkg.version)) {
      outcome = { ...pkg, status: "already published" };
    } else {
      const attempt = registry.publish(pkg);
      log(attempt.output.trimEnd());
      if (attempt.ok) {
        outcome = { ...pkg, status: "published" };
      } else if (ALREADY.test(attempt.output)) {
        outcome = { ...pkg, status: "already published" };
      } else {
        outcome = { ...pkg, error: npmErrorLine(attempt.output), status: "FAILED" };
      }
    }
    log(outcome.error ? `${outcome.status}: ${outcome.error}` : outcome.status);
    log("::endgroup::");
    outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * The command that publishes `dirs` from `sha`. It goes through `release-please.yml` because npm's
 * trusted publisher matches the workflow file that REQUESTED the OIDC token: that is
 * `release-please.yml` when `publish.yml` runs as its reusable workflow, so dispatching
 * `publish.yml` directly is refused with the same E404 (run 39607367057).
 */
export function backfillCommand(dirs: readonly string[], sha: string): string {
  return `gh workflow run release-please.yml -f backfill_paths='${JSON.stringify(dirs)}' -f backfill_sha=${sha}`;
}

function cell(text: string): string {
  return text.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

/** The job summary table. */
export function summaryTable(outcomes: readonly PublishOutcome[]): string {
  const rows = outcomes.map(
    (o) =>
      `| \`${o.name}@${o.version}\` | ${o.status} | ${o.error ? `\`${cell(o.error)}\`` : ""} |`,
  );
  const failed = outcomes.filter((o) => o.status === "FAILED").length;
  return [
    "## npm publish",
    "",
    failed === 0
      ? `All ${outcomes.length} package(s) are on npm.`
      : `**${failed} of ${outcomes.length} package(s) were not published.**`,
    "",
    "| Package | Outcome | npm said |",
    "| ------- | ------- | -------- |",
    ...rows,
    "",
  ].join("\n");
}

/** The `release-incomplete` issue text for the failures, or `undefined` when nothing failed. */
export function issueSection(
  outcomes: readonly PublishOutcome[],
  context: { sha: string; runUrl: string },
): string | undefined {
  const failed = outcomes.filter((o) => o.status === "FAILED");
  if (failed.length === 0) {
    return undefined;
  }
  return [
    `### npm publish failed for ${failed.length} released package(s)`,
    "",
    `The publish job of [this run](${context.runUrl}) attempted every released package; these have a tag and a GitHub release but are **not on npm**, so anything depending on them fails to install:`,
    "",
    ...failed.map((o) => `- \`${o.name}@${o.version}\` (\`${o.dir}\`): \`${cell(o.error ?? "")}\``),
    "",
    "Fix the cause first (an `E404` on `PUT` for a new package means npm has no trusted publisher for it yet: add one naming `jxsuite/jx` and the workflow `release-please.yml`), then publish them from the release commit:",
    "",
    "```sh",
    backfillCommand(
      failed.map((o) => o.dir),
      context.sha,
    ),
    "```",
    "",
    "It is idempotent: a version already on npm is skipped.",
    "",
  ].join("\n");
}

/** Read `name` and `version` from a workspace manifest. */
async function readPackage(dir: string): Promise<ReleasedPackage> {
  const json: unknown = await Bun.file(join(dir, "package.json")).json();
  const name = isJsonRecord(json) ? json.name : undefined;
  const version = isJsonRecord(json) ? json.version : undefined;
  if (!isText(name) || !isText(version)) {
    throw new Error(`${dir}/package.json has no name or version`);
  }
  return { dir, name, version };
}

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? new TextDecoder().decode(bytes) : "";
}

const npm: Registry = {
  isPublished(name, version) {
    const proc = Bun.spawnSync(["npm", "view", `${name}@${version}`, "version"], {
      stderr: "ignore",
    });
    return proc.exitCode === 0 && decode(proc.stdout).trim() !== "";
  },
  publish(pkg) {
    const pack = Bun.spawnSync(["bun", "pm", "pack"], { cwd: pkg.dir, stderr: "pipe" });
    const packed = `${decode(pack.stdout)}${decode(pack.stderr)}`;
    const tarball = readdirSync(pkg.dir).find((f) => f.endsWith(".tgz"));
    if (pack.exitCode !== 0 || !tarball) {
      return { ok: false, output: `${packed}\nnpm error bun pm pack produced no tarball` };
    }
    const proc = Bun.spawnSync(["npm", "publish", "--provenance", tarball], {
      cwd: pkg.dir,
      stderr: "pipe",
    });
    return {
      ok: proc.exitCode === 0,
      output: `${packed}${decode(proc.stdout)}${decode(proc.stderr)}`,
    };
  },
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--issue-body");
  const issueFile = flag === -1 ? undefined : args[flag + 1];

  // The order comes from publish-order.ts, which owns WHICH packages; its stderr names any
  // Released path it skips (desktop, or a package that lost its publishConfig).
  const order = Bun.spawnSync(["bun", join(import.meta.dir, "publish-order.ts")], {
    stderr: "inherit",
  });
  if (order.exitCode !== 0) {
    process.exit(1);
  }
  const dirs = decode(order.stdout).split("\n").filter(Boolean);
  if (dirs.length === 0) {
    console.log("No npm packages released this run; nothing to publish.");
    process.exit(0);
  }

  const packages = await Promise.all(dirs.map((dir) => readPackage(dir)));
  const outcomes = publishAll(packages, npm, (line) => console.log(line));

  const summary = summaryTable(outcomes);
  console.log(`\n${summary}`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    await Bun.write(
      summaryFile,
      `${await Bun.file(summaryFile)
        .text()
        .catch(() => "")}${summary}`,
    );
  }

  const sha =
    process.env.RELEASE_SHA ||
    decode(Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout).trim() ||
    "<release commit>";
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY ?? "jxsuite/jx"}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
  const issue = issueSection(outcomes, { runUrl, sha });
  if (issue) {
    if (issueFile) {
      await Bun.write(issueFile, issue);
    }
    for (const o of outcomes.filter((x) => x.status === "FAILED")) {
      console.error(`::error::${o.name}@${o.version} was not published: ${o.error ?? ""}`);
    }
    console.error(
      `\nRecover with:\n  ${backfillCommand(
        outcomes.filter((o) => o.status === "FAILED").map((o) => o.dir),
        sha,
      )}`,
    );
    process.exit(1);
  }
}
