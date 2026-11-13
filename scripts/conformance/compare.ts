/**
 * Compare two captures and say what differs (scripts/conformance/README.md).
 *
 * A capture is a directory: `<project>/<route>.<viewport>.json` holds an `Observation` and the
 * `.png` beside it holds its screenshot. Comparison is by name, so a page present on one side only
 * is itself a finding, and then field by field, after the tolerated differences are removed
 * (`normalize.ts`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { changedPixelRatio, decodePng } from "../lib/png.ts";
import { normalize } from "./normalize.ts";
import type { Observation } from "./observe.ts";

/** What kind of thing differed. */
export type FindingKind =
  | "build"
  | "missing"
  | "extra"
  | "dom"
  | "accessibility"
  | "complaints"
  | "interactions"
  | "pixels";

/** One difference between a baseline and a candidate. */
export interface Finding {
  project: string;
  /** The observation's file name without its extension: `<route>.<viewport>`. */
  page: string;
  kind: FindingKind;
  /** One line a person can act on. */
  summary: string;
  /** The first differing lines, baseline then candidate, for the line-based kinds. */
  detail?: string[];
}

/** How strictly pictures are compared. */
export interface CompareOptions {
  /** The share of pixels that may differ before a picture is a finding. 0 means none. */
  pixelTolerance: number;
  /** How far a channel may move before a pixel counts as different (0 to 255). */
  channelTolerance: number;
}

export const EXACT: CompareOptions = { channelTolerance: 0, pixelTolerance: 0 };

/** The line-based fields of an observation, in the order they are reported. */
const LINE_FIELDS = ["dom", "accessibility", "complaints", "interactions"] as const;

/** The file in a project's capture that holds what its build reported. Not an observation. */
export const BUILD_RECORD = "_build.record";

/** How many differing lines a finding quotes from each side. */
const QUOTED = 3;

/**
 * Where two lists of lines first part, and how many lines differ in all.
 *
 * Positional, not a longest-common-subsequence diff: the question is whether two pages are the
 * same, and the first place they are not is where a person starts reading either way.
 */
export function lineDifference(
  baseline: readonly string[],
  candidate: readonly string[],
): { at: number; count: number; detail: string[] } | null {
  const length = Math.max(baseline.length, candidate.length);
  let at = -1;
  let count = 0;
  for (let index = 0; index < length; index += 1) {
    if (baseline[index] !== candidate[index]) {
      count += 1;
      if (at === -1) {
        at = index;
      }
    }
  }
  if (at === -1) {
    return null;
  }
  const quote = (lines: readonly string[], mark: string) =>
    lines.slice(at, at + QUOTED).map((line) => `${mark} ${line.trim()}`);
  return { at, count, detail: [...quote(baseline, "-"), ...quote(candidate, "+")] };
}

function isObservation(value: unknown): value is Observation {
  return (
    typeof value === "object" &&
    value !== null &&
    "dom" in value &&
    Array.isArray(value.dom) &&
    "screenshot" in value &&
    typeof value.screenshot === "string"
  );
}

function readObservation(path: string): Observation {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObservation(parsed)) {
    throw new TypeError(`${path} is not an observation`);
  }
  return parsed;
}

function isBuildRecord(value: unknown): value is { errors: string[] } {
  return (
    typeof value === "object" && value !== null && "errors" in value && Array.isArray(value.errors)
  );
}

/** The errors a project's build reported, or none when the capture predates the record. */
function buildErrors(dir: string): string[] {
  const path = join(dir, BUILD_RECORD);
  if (!existsSync(path)) {
    return [];
  }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  return isBuildRecord(parsed) ? parsed.errors.map((error) => normalize(error)) : [];
}

function names(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(suffix))
    .map((name) => name.slice(0, -suffix.length))
    .toSorted();
}

function comparePixels(
  baselineDir: string,
  candidateDir: string,
  page: string,
  options: CompareOptions,
): string | null {
  const baseline = decodePng(readFileSync(join(baselineDir, `${page}.png`)));
  const candidate = decodePng(readFileSync(join(candidateDir, `${page}.png`)));
  if (!baseline || !candidate) {
    return "a screenshot could not be decoded";
  }
  const ratio = changedPixelRatio(baseline, candidate, options.channelTolerance);
  if (ratio === null) {
    return `the screenshots differ in size: ${baseline.width}x${baseline.height} against ${candidate.width}x${candidate.height}`;
  }
  if (ratio <= options.pixelTolerance) {
    return null;
  }
  return `${(ratio * 100).toFixed(3)}% of pixels differ (tolerance ${(options.pixelTolerance * 100).toFixed(3)}%)`;
}

/** Compare one project's pages. */
export function compareProject(
  project: string,
  baselineDir: string,
  candidateDir: string,
  options: CompareOptions = EXACT,
): Finding[] {
  const findings: Finding[] = [];
  const build = lineDifference(buildErrors(baselineDir), buildErrors(candidateDir));
  if (build) {
    findings.push({
      detail: build.detail,
      kind: "build",
      page: "(build)",
      project,
      summary: `the builds report different errors, ${build.count} line(s)`,
    });
  }
  const baselinePages = names(baselineDir, ".json");
  const candidatePages = new Set(names(candidateDir, ".json"));
  for (const page of candidatePages) {
    if (!baselinePages.includes(page)) {
      findings.push({ kind: "extra", page, project, summary: "the baseline has no such page" });
    }
  }
  for (const page of baselinePages) {
    if (!candidatePages.has(page)) {
      findings.push({ kind: "missing", page, project, summary: "the candidate has no such page" });
      continue;
    }
    const baseline = readObservation(join(baselineDir, `${page}.json`));
    const candidate = readObservation(join(candidateDir, `${page}.json`));
    for (const field of LINE_FIELDS) {
      const difference = lineDifference(
        baseline[field].map((line) => normalize(line)),
        candidate[field].map((line) => normalize(line)),
      );
      if (difference) {
        findings.push({
          detail: difference.detail,
          kind: field,
          page,
          project,
          summary: `${difference.count} line(s) differ, the first at line ${difference.at + 1}`,
        });
      }
    }
    if (baseline.screenshot !== candidate.screenshot) {
      const summary = comparePixels(baselineDir, candidateDir, page, options);
      if (summary) {
        findings.push({ kind: "pixels", page, project, summary });
      }
    }
  }
  return findings;
}

/** Compare every project either capture holds. */
export function compareCaptures(
  baseline: string,
  candidate: string,
  options: CompareOptions = EXACT,
): Finding[] {
  const projects = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
  const all = [...new Set([...projects(baseline), ...projects(candidate)])].toSorted();
  return all.flatMap((project) =>
    compareProject(project, join(baseline, project), join(candidate, project), options),
  );
}

/** A report a person reads: a count per kind, then each finding with its first lines. */
export function report(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return "conformance: the two captures agree.";
  }
  const kinds = new Map<string, number>();
  for (const finding of findings) {
    kinds.set(finding.kind, (kinds.get(finding.kind) ?? 0) + 1);
  }
  const tally = [...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ");
  const lines = [`conformance: ${findings.length} finding(s): ${tally}.`, ""];
  for (const finding of findings) {
    lines.push(`${finding.project} ${finding.page} [${finding.kind}] ${finding.summary}`);
    for (const line of finding.detail ?? []) {
      lines.push(`    ${line}`);
    }
  }
  return lines.join("\n");
}
