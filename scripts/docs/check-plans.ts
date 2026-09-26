/**
 * Gate for plans/: the transient implementation plans that close what the specs admit is unbuilt.
 * Two associations have to hold mechanically, because plans are deleted when they land and nothing
 * else would notice them drift:
 *
 * - Plan ↔ spec item: every open item (a Partial or Pending marker, cell or preamble claim, as
 *   `openItems()` reads them) in an audited spec is claimed by exactly one plan, and a plan that
 *   claims something no longer open is stale and must be deleted.
 * - Plan → plan: `requires` edges name plans that exist, form no cycle, and point at plans at least
 *   as settled as the one that depends on them.
 *
 * And one property makes deleting a plan safe: nothing outside plans/ may cite one, so a deletion
 * can never leave a dangling reference. `packages/studio/UX-REDESIGN-PLAN.md` was deleted while 28
 * tracked files still named it; this is the rule that would have refused the first of them.
 *
 * Usage: bun scripts/docs/check-plans.ts Contract: plans/README.md. Parser:
 * scripts/docs/lib/plans.ts.
 */

import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import type { PlanDoc, PlanRegistry } from "./lib/plans.ts";
import {
  buildPlanRegistry,
  DISPOSITIONS,
  findCycle,
  LEGACY_PLAN_DOC,
  parseClaim,
  PLAN_CITATION,
  PLAN_STATUSES,
  PR_REF,
  SHARED_HOME,
  SIZES,
  SLICE_ID,
  TEMPLATE_HEADINGS,
} from "./lib/plans.ts";
import type { SpecStatus } from "./lib/spec-status.ts";
import { openItems, parseSpecStatuses } from "./lib/spec-status.ts";
import { parseSpecStandards } from "./lib/standards.ts";

const ROOT = resolve(import.meta.dir, "../..");

export const VIOLATION_CODES = [
  // Layout
  "contract-missing",
  "path-shape",
  "stem-unknown",
  // Shape
  "frontmatter-missing",
  "field-unknown",
  "field-missing",
  "field-type",
  "status-unknown",
  "disposition-unknown",
  "size-unknown",
  "title-missing",
  "section-missing",
  "decision-open",
  "slices-missing",
  "slice-grammar",
  "slice-duplicate",
  "prs-grammar",
  "active-without-pr",
  "workspace-missing",
  "workspace-required",
  // Claims
  "claim-grammar",
  "claim-spec-unknown",
  "claim-anchor-unknown",
  "claim-not-open",
  "claim-duplicate",
  "claim-misplaced",
  "shared-single-spec",
  "plan-unanchored",
  // Coverage (audited specs only)
  "unclaimed-open",
  "marker-leading",
  "roadmap-in-spec",
  "header-stale",
  "graduation-ready",
  // Gaps
  "gap-unknown",
  "gap-duplicate",
  // Graph
  "requires-unknown",
  "requires-self",
  "requires-duplicate",
  "requires-cycle",
  "requires-not-ready",
  "active-with-requires",
  // Citations
  "citation-unknown",
  "citation-outside-plans",
  "plan-doc-outside-plans",
  // Ratchet
  "audit-missing",
  "unaudited-stale",
  "graduated-dir-stale",
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  code: ViolationCode;
  file: string;
  line?: number;
  message: string;
}

/**
 * Draft specs whose audit has not happened yet: no `plans/<stem>/README.md`, so their open items
 * are not yet required to be claimed. This list only SHRINKS. The census removes a spec in the pull
 * request that writes its audit record (`unaudited-stale` fires otherwise), and once it is empty a
 * spec that goes back to draft fails until somebody audits it.
 */
export const UNAUDITED: readonly string[] = [
  "ai.md",
  "collab.md",
  "compiler.md",
  "desktop.md",
  "extensions.md",
  "imports.md",
  "jx-markdown.md",
  "parser.md",
  "relationships.md",
  "schema.md",
  "site-architecture.md",
  "spec.md",
  "standards.md",
  "studio-ui-guidelines.md",
  "studio.md",
  "ui.md",
];

/** One line of a tracked text file outside plans/ that carries a plan citation or a slice id. */
export interface Mention {
  path: string;
  line: number;
  text: string;
}

export interface PlansInput {
  registry: PlanRegistry;
  specs: readonly SpecStatus[];
  /** Every `gap:` id on a Standards Alignment row. */
  gapIds: ReadonlySet<string>;
  /** Lines outside plans/ that `mentionPattern()` matched. */
  mentions: readonly Mention[];
  /** Every tracked (or untracked, not ignored) path, for the legacy plan-document rule. */
  paths: readonly string[];
  isDirectory: (rel: string) => boolean;
  unaudited?: readonly string[];
}

function v(code: ViolationCode, file: string, message: string, line?: number): Violation {
  return line === undefined ? { code, file, message } : { code, file, line, message };
}

const escapeRegExp = (s: string) => s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Every declared slice id, across all plans. */
function declaredSlices(plans: readonly PlanDoc[]): string[] {
  return [
    ...new Set(plans.flatMap((p) => p.slices.map((s) => s.id)).filter((id) => SLICE_ID.test(id))),
  ];
}

/**
 * The pattern a line outside plans/ must not match: a `plan:` citation, or any slice id a plan
 * declares. Slice ids are distinctive by grammar (`<PREFIX>.<n>`), which is what makes a
 * repository-wide search for them meaningful.
 */
export function mentionPattern(plans: readonly PlanDoc[]): RegExp {
  const slices = declaredSlices(plans).map((id) => escapeRegExp(id));
  const alternatives = [PLAN_CITATION.source];
  if (slices.length > 0) {
    alternatives.push(String.raw`(?<![\w.])(?:${slices.join("|")})(?!\w|\.\d)`);
  }
  return new RegExp(alternatives.join("|"), "g");
}

/**
 * A cheap literal prefilter for `mentionPattern`: the same alternatives without the lookarounds.
 * JavaScriptCore runs the precise pattern (a lookbehind ahead of a wide alternation) over a whole
 * file about three hundred times slower than this, so the scan only runs the precise one on the few
 * lines this lets through.
 */
export function mentionPrefilter(plans: readonly PlanDoc[]): RegExp {
  return new RegExp(["plan:", ...declaredSlices(plans).map((id) => escapeRegExp(id))].join("|"));
}

const claimKey = (file: string, anchor?: string) => (anchor ? `${file}#${anchor}` : file);

function checkPlanShape(plan: PlanDoc, input: PlansInput, out: Violation[]): void {
  const at = plan.path;
  if (plan.frontmatter !== "parsed") {
    out.push(
      v(
        "frontmatter-missing",
        at,
        plan.frontmatter === "invalid"
          ? `the frontmatter does not parse: ${plan.frontmatterError}`
          : "a plan opens with YAML frontmatter (status, disposition, claims, size): see plans/README.md",
      ),
    );
    return;
  }
  for (const field of plan.unknownFields) {
    out.push(v("field-unknown", at, `"${field}" is not a plan field: see plans/README.md`));
  }
  for (const field of plan.missingFields) {
    out.push(v("field-missing", at, `the frontmatter needs "${field}"`));
  }
  for (const problem of plan.fieldProblems) {
    out.push(v("field-type", at, problem.message));
  }
  if (plan.status !== undefined && !(PLAN_STATUSES as readonly string[]).includes(plan.status)) {
    out.push(
      v(
        "status-unknown",
        at,
        `status "${plan.status}" is not ${PLAN_STATUSES.join(" | ")} (a finished plan is deleted, not marked done)`,
      ),
    );
  }
  if (
    plan.disposition !== undefined &&
    !(DISPOSITIONS as readonly string[]).includes(plan.disposition)
  ) {
    out.push(
      v(
        "disposition-unknown",
        at,
        `disposition "${plan.disposition}" is not ${DISPOSITIONS.join(" | ")}`,
      ),
    );
  }
  if (plan.size !== undefined && !(SIZES as readonly string[]).includes(plan.size)) {
    out.push(v("size-unknown", at, `size "${plan.size}" is not S | M | L: split anything larger`));
  }
  if (plan.titles.length !== 1) {
    out.push(
      v("title-missing", at, `a plan has exactly one H1, its title (found ${plan.titles.length})`),
    );
  }

  const required = plan.status === "stub" ? ["Context"] : TEMPLATE_HEADINGS;
  const present = new Set(plan.sections.map((s) => s.title));
  for (const heading of required) {
    if (!present.has(heading)) {
      out.push(
        v("section-missing", at, `status ${plan.status ?? "?"} requires a "## ${heading}" section`),
      );
    }
  }
  if ((plan.status === "ready" || plan.status === "active") && plan.openDecisions.length > 0) {
    for (const line of plan.openDecisions) {
      out.push(
        v(
          "decision-open",
          at,
          `status ${plan.status}, but "## Decisions" still has an **Open:** item: decide it, or return the plan to drafted`,
          line,
        ),
      );
    }
  }
  if ((plan.size === "L" || plan.status === "active") && plan.slices.length === 0) {
    out.push(
      v(
        "slices-missing",
        at,
        'size L or status active needs a "## Slices" table: | Slice | Scope | Claims | State |',
      ),
    );
  }
  for (const slice of plan.slices) {
    if (!SLICE_ID.test(slice.id)) {
      out.push(
        v(
          "slice-grammar",
          at,
          `slice id "${slice.id}" is not <PREFIX>.<n>, an uppercase-led prefix, a dot and a number: a slice id has to be distinctive enough to search the repository for`,
          slice.line,
        ),
      );
    }
  }
  for (const pr of plan.prs) {
    if (!PR_REF.test(pr)) {
      out.push(v("prs-grammar", at, `prs entry "${pr}" is not owner/repo#N`));
    }
  }
  if (plan.status === "active" && plan.prs.length === 0) {
    out.push(v("active-without-pr", at, "status active, but prs names no pull request"));
  }
  for (const workspace of plan.workspaces) {
    if (!input.isDirectory(workspace)) {
      out.push(v("workspace-missing", at, `workspaces entry "${workspace}" is not a directory`));
    }
  }
  if (
    plan.disposition === "implement" &&
    plan.status !== undefined &&
    plan.status !== "stub" &&
    plan.workspaces.length === 0
  ) {
    out.push(
      v(
        "workspace-required",
        at,
        "an implement plan past stub names the workspaces it changes, so its CI cost is visible",
      ),
    );
  }
}

/** Is `ref` (a spec file, optionally `#anchor`) an open item right now? */
function openKeys(specs: readonly SpecStatus[]): Map<string, string> {
  const open = new Map<string, string>();
  for (const spec of specs) {
    for (const item of openItems(spec)) {
      open.set(claimKey(spec.file, item.anchor), item.status);
    }
  }
  return open;
}

function checkClaims(
  plans: readonly PlanDoc[],
  specs: readonly SpecStatus[],
  dependents: Map<string, string[]>,
  out: Violation[],
): Map<string, string> {
  const byFile = new Map(specs.map((s) => [s.file, s]));
  const open = openKeys(specs);
  const owner = new Map<string, string>();

  for (const plan of plans) {
    const at = plan.path;
    const files = new Set<string>();
    let closed = 0;
    for (const raw of plan.claims) {
      const claim = parseClaim(raw);
      if (!claim) {
        out.push(
          v(
            "claim-grammar",
            at,
            `claim "${raw}" must be <spec>.md or <spec>.md#<anchor>: no specs/ prefix, no §`,
          ),
        );
        continue;
      }
      files.add(claim.file);
      const spec = byFile.get(claim.file);
      if (!spec) {
        out.push(v("claim-spec-unknown", at, `specs/${claim.file} does not exist`));
        continue;
      }
      const section = claim.anchor
        ? spec.sections.find((s) => s.anchor === claim.anchor)
        : undefined;
      if (claim.anchor && !section) {
        out.push(
          v(
            "claim-anchor-unknown",
            at,
            `specs/${claim.file} has no numbered section §${claim.anchor}`,
          ),
        );
        continue;
      }
      const key = claimKey(claim.file, claim.anchor);
      const prior = owner.get(key);
      if (prior) {
        out.push(
          v(
            "claim-duplicate",
            at,
            `${key} is claimed by both ${prior} and ${plan.id}: one plan owns an item; make the other an enabling plan the owner requires`,
          ),
        );
      } else {
        owner.set(key, plan.id);
      }
      if (!open.has(key)) {
        closed += 1;
        const waiting = dependents.get(plan.id) ?? [];
        const edges =
          waiting.length > 0 ? ` and remove it from the requires of: ${waiting.join(", ")}` : "";
        const now = claim.anchor ? (section?.status ?? "unmarked") : "not open";
        out.push(
          v(
            "claim-not-open",
            at,
            closed === plan.claims.length
              ? `every claim is closed (${key} is ${now}): delete plans/${plan.id}.md in this pull request${edges}`
              : `${key} is ${now}, not Partial or Pending: it has landed, so remove the claim`,
          ),
        );
      }
      if (plan.home !== SHARED_HOME && claim.file !== `${plan.home}.md`) {
        out.push(
          v(
            "claim-misplaced",
            at,
            `${plan.id} lives under plans/${plan.home}/ but claims ${key}: move it to plans/_shared/ or split it`,
          ),
        );
      }
    }
    if (plan.home === SHARED_HOME && files.size === 1) {
      out.push(
        v(
          "shared-single-spec",
          at,
          `a _shared plan claims items in two or more specs; this one claims only ${[...files][0]}: move it under plans/${[...files][0]!.replace(/\.md$/, "")}/`,
        ),
      );
    }
    if (plan.claims.length === 0 && !dependents.get(plan.id)?.length) {
      out.push(
        v(
          "plan-unanchored",
          at,
          "claims nothing and no plan requires it: claim an open item, or delete it",
        ),
      );
    }
  }
  return owner;
}

function checkGraph(plans: readonly PlanDoc[], out: Violation[]): void {
  const byId = new Map(plans.map((p) => [p.id, p]));
  for (const plan of plans) {
    const at = plan.path;
    const seen = new Set<string>();
    for (const target of plan.requires) {
      if (seen.has(target)) {
        out.push(v("requires-duplicate", at, `requires ${target} twice`));
        continue;
      }
      seen.add(target);
      if (target === plan.id) {
        out.push(v("requires-self", at, "a plan cannot require itself"));
        continue;
      }
      const prerequisite = byId.get(target);
      if (!prerequisite) {
        out.push(
          v(
            "requires-unknown",
            at,
            `requires ${target}, which does not exist: if it landed, remove the edge and re-read this plan against what shipped`,
          ),
        );
        continue;
      }
      const settled = plan.status === "ready" || plan.status === "active";
      if (
        settled &&
        (prerequisite.status === "stub" || prerequisite.status === "drafted") &&
        prerequisite.status !== undefined
      ) {
        out.push(
          v(
            "requires-not-ready",
            at,
            `${plan.status}, but requires ${target} (${prerequisite.status}): a prerequisite is detailed first`,
          ),
        );
      }
    }
    if (plan.status === "active" && plan.requires.length > 0) {
      out.push(
        v(
          "active-with-requires",
          at,
          `active, but still requires ${plan.requires.join(", ")}: work starts when every prerequisite has landed`,
        ),
      );
    }
  }
  const cycle = findCycle(plans);
  if (cycle) {
    out.push(
      v(
        "requires-cycle",
        byId.get(cycle[0]!)!.path,
        `requires cycle ${cycle.join(" → ")}: merge the plans or drop an edge`,
      ),
    );
  }
}

function checkGaps(plans: readonly PlanDoc[], gapIds: ReadonlySet<string>, out: Violation[]) {
  const owner = new Map<string, string>();
  for (const plan of plans) {
    for (const gap of plan.gaps) {
      if (!gapIds.has(gap)) {
        out.push(
          v(
            "gap-unknown",
            plan.path,
            `gap:${gap} is on no Standards Alignment row: if the row was upgraded the gap closed, so drop it`,
          ),
        );
      }
      const prior = owner.get(gap);
      if (prior) {
        out.push(v("gap-duplicate", plan.path, `gap:${gap} is also closed by ${prior}`));
      } else {
        owner.set(gap, plan.id);
      }
    }
  }
}

function checkCitations(input: PlansInput, out: Violation[]): void {
  const { plans } = input.registry;
  const byId = new Map(plans.map((p) => [p.id, p]));
  const sliceOwner = new Map<string, string>();
  for (const plan of plans) {
    for (const slice of plan.slices) {
      const prior = sliceOwner.get(slice.id);
      if (prior && prior !== plan.id) {
        out.push(
          v(
            "slice-duplicate",
            plan.path,
            `slice ${slice.id} is also declared by ${prior}: slice ids are unique across plans`,
            slice.line,
          ),
        );
      } else {
        sliceOwner.set(slice.id, plan.id);
      }
    }
  }
  for (const plan of plans) {
    for (const citation of plan.citations) {
      const target = byId.get(citation.target);
      if (!target) {
        out.push(
          v(
            "citation-unknown",
            plan.path,
            `plan:${citation.target} names no plan: if it landed, cite the spec section it closed`,
            citation.line,
          ),
        );
      } else if (citation.slice && !target.slices.some((s) => s.id === citation.slice)) {
        out.push(
          v(
            "citation-unknown",
            plan.path,
            `plan:${citation.target}#${citation.slice}: that plan declares no slice ${citation.slice}`,
            citation.line,
          ),
        );
      }
    }
  }

  const pattern = mentionPattern(plans);
  for (const mention of input.mentions) {
    pattern.lastIndex = 0;
    for (const m of mention.text.matchAll(pattern)) {
      out.push(
        v(
          "citation-outside-plans",
          mention.path,
          `cites "${m[0]}": plans are deleted when they land, so a permanent file cites the spec section instead`,
          mention.line,
        ),
      );
    }
  }
  for (const path of input.paths) {
    if (path.startsWith(".claude/plans/") || LEGACY_PLAN_DOC.test(path)) {
      out.push(
        v(
          "plan-doc-outside-plans",
          path,
          "a plan document lives under plans/, where the gate can see it and its deletion is checked",
        ),
      );
    }
  }
}

function checkCoverage(
  input: PlansInput,
  owner: ReadonlyMap<string, string>,
  out: Violation[],
): void {
  const { registry, specs } = input;
  const unaudited = new Set(input.unaudited ?? UNAUDITED);
  const specFiles = new Set(specs.map((s) => s.file));
  for (const file of unaudited) {
    if (!specFiles.has(file)) {
      out.push(
        v(
          "unaudited-stale",
          `specs/${file}`,
          "no such spec: remove it from UNAUDITED in scripts/docs/check-plans.ts",
        ),
      );
    }
  }
  for (const spec of specs) {
    const stem = spec.file.replace(/\.md$/, "");
    const at = `specs/${spec.file}`;
    const audited = registry.audits.has(stem);
    const hasPlans = registry.plans.some((p) => p.home === stem);
    if (spec.headerStatus === "Implemented") {
      if (audited || hasPlans) {
        out.push(
          v(
            "graduated-dir-stale",
            at,
            `specs/${spec.file} is Implemented: delete plans/${stem}/ (a graduated spec has nothing left to plan)`,
          ),
        );
      }
      if (unaudited.has(spec.file)) {
        out.push(
          v(
            "unaudited-stale",
            at,
            "this spec is Implemented: remove it from UNAUDITED in scripts/docs/check-plans.ts (the list only shrinks)",
          ),
        );
      }
      continue;
    }
    if (unaudited.has(spec.file)) {
      if (audited) {
        out.push(
          v(
            "unaudited-stale",
            at,
            `plans/${stem}/README.md exists, so this spec is audited: remove it from UNAUDITED in scripts/docs/check-plans.ts (the list only shrinks)`,
          ),
        );
      }
      continue;
    }
    if (!audited) {
      out.push(
        v(
          "audit-missing",
          at,
          `this spec is ${spec.headerStatus ?? "unmarked"} but has no plans/${stem}/README.md: audit it, and plan every open item`,
        ),
      );
      continue;
    }

    const items = openItems(spec);
    for (const item of items) {
      const key = claimKey(spec.file, item.anchor);
      const where = item.anchor ? `§${item.anchor}` : "the preamble";
      if (!owner.has(key)) {
        out.push(
          v(
            "unclaimed-open",
            at,
            `${where} is ${item.status} (${item.form}, line ${item.line}) and no plan claims it: write a stub under plans/${stem}/`,
            item.line,
          ),
        );
      }
      if (!item.leading) {
        out.push(
          v(
            "marker-leading",
            at,
            `${where} admits a ${item.status} part (${item.form}, line ${item.line}) but leads with ` +
              `${spec.sections.find((s) => s.anchor === item.anchor)?.status ?? "no marker"}: lead with ` +
              `"> **Status: ${item.status}.**", since the first marker is the section's status everywhere it is derived`,
            item.line,
          ),
        );
      }
    }
    for (const roadmap of spec.roadmaps) {
      out.push(
        v(
          "roadmap-in-spec",
          at,
          `"${roadmap.title}" is a roadmap: move each open item onto its feature section's marker, then ${
            roadmap.anchor
              ? `mark §${roadmap.anchor} Removed (a numbered heading stays)`
              : "delete the heading"
          }`,
          roadmap.line,
        ),
      );
    }
    if (
      spec.headerStatus === "Pending" &&
      spec.sections.some((s) => s.status === "Implemented" || s.status === "Partial")
    ) {
      out.push(
        v(
          "header-stale",
          at,
          "the header says Pending, but sections below it are built: the header is Partial",
        ),
      );
    }
    if (items.length === 0) {
      out.push(
        v(
          "graduation-ready",
          at,
          `nothing in specs/${spec.file} is Partial or Pending: graduate it in this pull request: set ` +
            `**Status:** Implemented, run \`bun run spec:bump ${spec.file} patch -m "…"\` in place ` +
            `(a fragment would leave -draft on an Implemented header), and delete plans/${stem}/`,
        ),
      );
    }
  }
}

/** Every violation across the registry. Pure: the CLI builds the input, the tests build fixtures. */
export function checkPlans(input: PlansInput): Violation[] {
  const out: Violation[] = [];
  const { registry, specs } = input;
  const stems = new Set(specs.map((s) => s.file.replace(/\.md$/, "")));

  if (!registry.contract) {
    out.push(
      v(
        "contract-missing",
        "plans/README.md",
        "plans/README.md is the contract every plan follows",
      ),
    );
  }
  for (const stray of registry.strays) {
    out.push(v("path-shape", stray.path, stray.reason));
  }
  for (const stem of registry.audits) {
    if (!stems.has(stem)) {
      out.push(v("stem-unknown", `plans/${stem}/README.md`, `plans/${stem}/ names no spec`));
    }
  }
  const dependents = new Map<string, string[]>();
  for (const plan of registry.plans) {
    if (plan.home !== SHARED_HOME && !stems.has(plan.home)) {
      out.push(v("stem-unknown", plan.path, `plans/${plan.home}/ names no spec`));
    }
    for (const target of plan.requires) {
      dependents.set(target, [...(dependents.get(target) ?? []), plan.id]);
    }
    checkPlanShape(plan, input, out);
  }

  const owner = checkClaims(registry.plans, specs, dependents, out);
  checkGraph(registry.plans, out);
  checkGaps(registry.plans, input.gapIds, out);
  checkCitations(input, out);
  checkCoverage(input, owner, out);
  return out;
}

/* ── CLI ─────────────────────────────────────────────────────────────────────── */

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".txt",
  ".toml",
  ".nix",
  ".sh",
]);

/** Tracked files plus untracked ones git does not ignore: what a pull request could carry. */
function repositoryPaths(root: string): string[] {
  const run = (args: string[]) =>
    Bun.spawnSync(["git", ...args], { cwd: root })
      .stdout.toString()
      .split("\0")
      .filter(Boolean);
  return [
    ...new Set([
      ...run(["ls-files", "-z"]),
      ...run(["ls-files", "-z", "--others", "--exclude-standard"]),
    ]),
  ];
}

function isFile(root: string, rel: string): boolean {
  try {
    return statSync(resolve(root, rel)).isFile();
  } catch {
    return false;
  }
}

/** Whether the citation scan reads `path`: tracked text outside plans/, except changelogs. */
export function isMentionScanned(path: string): boolean {
  return (
    !path.startsWith("plans/") &&
    path !== "CHANGELOG.md" &&
    !path.endsWith("/CHANGELOG.md") &&
    TEXT_EXTENSIONS.has(extname(path))
  );
}

function scanMentions(
  root: string,
  paths: readonly string[],
  plans: readonly PlanDoc[],
): Mention[] {
  const quick = mentionPrefilter(plans);
  const precise = mentionPattern(plans);
  const mentions: Mention[] = [];
  for (const path of paths) {
    if (!isMentionScanned(path) || !isFile(root, path)) {
      continue;
    }
    const text = readFileSync(resolve(root, path), "utf8");
    if (!quick.test(text)) {
      continue;
    }
    for (const [i, line] of text.split("\n").entries()) {
      precise.lastIndex = 0;
      if (quick.test(line) && precise.test(line)) {
        mentions.push({ path, line: i + 1, text: line });
      }
    }
  }
  return mentions;
}

/** The gate's input for the repository at `root`, exactly as CI sees it. */
export function loadPlansInput(root = ROOT): PlansInput {
  const specsDir = resolve(root, "specs");
  const registry = buildPlanRegistry(root);
  const gapIds = new Set(
    parseSpecStandards(specsDir).flatMap((s) => s.rows.flatMap((r) => (r.gapId ? [r.gapId] : []))),
  );
  const paths = repositoryPaths(root);
  return {
    registry,
    specs: parseSpecStatuses(specsDir),
    gapIds,
    mentions: scanMentions(root, paths, registry.plans),
    paths,
    isDirectory: (rel) => {
      try {
        return statSync(resolve(root, rel)).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

if (import.meta.main) {
  const input = loadPlansInput();
  const violations = checkPlans(input);
  if (violations.length > 0) {
    for (const x of violations) {
      const where = x.line === undefined ? x.file : `${x.file}:${x.line}`;
      console.error(`${where} [${x.code}] ${x.message}`);
    }
    console.error(`\n${violations.length} plan violation(s). Contract: plans/README.md`);
    process.exit(1);
  }
  const { plans, audits } = input.registry;
  const owed = UNAUDITED.length > 0 ? `; ${UNAUDITED.length} draft spec(s) not yet audited` : "";
  console.log(
    `plans: ${plans.length} plan(s), ${audits.size} audited spec(s), every claim open and every edge sound${owed}.`,
  );
}
