/**
 * Where the spec-completion program stands, derived from specs/ and plans/ and printed, never
 * written: per-spec graduation readiness, who claims each open item, the ready queue, the
 * topological waves of `requires`, and the order to detail specs in.
 *
 * Usage: bun scripts/docs/plans-status.ts every spec, the queue, the waves bun
 * scripts/docs/plans-status.ts --spec compiler one spec's open items and claimants bun
 * scripts/docs/plans-status.ts --who-claims ai.md#2.2 the plan that owns one item bun
 * scripts/docs/plans-status.ts --json the same data, machine-readable bun
 * scripts/docs/plans-status.ts --mermaid the requires graph
 */

import { resolve } from "node:path";

import { UNAUDITED } from "./check-plans.ts";
import type { PlanDoc, PlanRegistry } from "./lib/plans.ts";
import { buildPlanRegistry, readyQueue, specOrder, topoWaves } from "./lib/plans.ts";
import type { OpenItem, SpecStatus } from "./lib/spec-status.ts";
import { openItems, parseSpecStatuses } from "./lib/spec-status.ts";

const ROOT = resolve(import.meta.dir, "../..");

/** The detailing order plans/README.md proposes, used to break ties the graph leaves open. */
export const PROVISIONAL_ORDER = [
  "collab",
  "spec",
  "schema",
  "extensions",
  "relationships",
  "imports",
  "parser",
  "jx-markdown",
  "compiler",
  "site-architecture",
  "ai",
  "ui",
  "studio-ui-guidelines",
  "studio",
  "desktop",
  "standards",
] as const;

export interface SpecReport {
  file: string;
  stem: string;
  header?: string;
  audited: boolean;
  items: (OpenItem & { claimedBy?: string })[];
  plans: string[];
}

export interface StatusReport {
  specs: SpecReport[];
  ready: string[];
  waves: string[][];
  blocked: string[];
  order: string[][];
}

const keyOf = (file: string, anchor?: string) => (anchor ? `${file}#${anchor}` : file);

/** Build the whole report. Pure over its inputs, so the tests can drive it. */
export function buildStatusReport(
  registry: PlanRegistry,
  specs: readonly SpecStatus[],
  unaudited: readonly string[] = UNAUDITED,
): StatusReport {
  const owner = new Map<string, string>();
  for (const plan of registry.plans) {
    for (const claim of plan.claims) {
      if (!owner.has(claim)) {
        owner.set(claim, plan.id);
      }
    }
  }
  const drafts = specs.filter((s) => s.headerStatus !== "Implemented");
  const reports = drafts.map((spec): SpecReport => {
    const stem = spec.file.replace(/\.md$/, "");
    return {
      file: spec.file,
      stem,
      header: spec.headerStatus,
      audited: registry.audits.has(stem) && !unaudited.includes(spec.file),
      items: openItems(spec).map((item) =>
        Object.assign(item, { claimedBy: owner.get(keyOf(spec.file, item.anchor)) }),
      ),
      plans: registry.plans.filter((p) => p.home === stem).map((p) => p.id),
    };
  });
  const { waves, blocked } = topoWaves(registry.plans);
  return {
    specs: reports,
    ready: readyQueue(registry.plans).map((p) => p.id),
    waves,
    blocked,
    order: specOrder(
      registry.plans,
      drafts.map((s) => s.file.replace(/\.md$/, "")),
      PROVISIONAL_ORDER,
    ),
  };
}

/** A Mermaid flowchart of the `requires` graph, one subgraph per home. */
export function mermaid(plans: readonly PlanDoc[]): string {
  const node = (id: string) => id.replaceAll(/[^A-Za-z0-9]/g, "_");
  const lines = ["flowchart RL"];
  const homes = [...new Set(plans.map((p) => p.home))].toSorted();
  for (const home of homes) {
    lines.push(`  subgraph ${node(home)}["${home}"]`);
    for (const plan of plans.filter((p) => p.home === home)) {
      lines.push(`    ${node(plan.id)}["${plan.slug} (${plan.status ?? "?"})"]`);
    }
    lines.push("  end");
  }
  for (const plan of plans) {
    for (const target of plan.requires) {
      lines.push(`  ${node(plan.id)} --> ${node(target)}`);
    }
  }
  return lines.join("\n");
}

function describe(item: SpecReport["items"][number]): string {
  const where = item.anchor ? `§${item.anchor}` : "preamble";
  const form = item.leading ? "" : `, ${item.form} at line ${item.line}`;
  const owner = item.claimedBy ? `→ ${item.claimedBy}` : "→ (unclaimed)";
  return `${where.padEnd(10)} ${item.status.padEnd(8)} ${item.title.slice(0, 48).padEnd(48)} ${owner}${form}`;
}

/** The human-readable report. */
export function renderStatus(report: StatusReport, only?: string): string {
  const out: string[] = [];
  const specs = only ? report.specs.filter((s) => s.stem === only) : report.specs;
  for (const spec of specs) {
    const claimed = spec.items.filter((i) => i.claimedBy).length;
    const state = spec.audited ? "audited" : "not audited";
    out.push(
      `${spec.file} (${spec.header ?? "?"}, ${state}): ${spec.items.length} open, ${claimed} claimed, ${spec.plans.length} plan(s)`,
    );
    for (const item of spec.items) {
      out.push(`  ${describe(item)}`);
    }
    if (spec.audited && spec.items.length === 0) {
      out.push("  nothing open: graduate it");
    }
  }
  if (only) {
    return out.join("\n");
  }
  out.push(
    "",
    `Ready queue: ${report.ready.length > 0 ? report.ready.join(", ") : "(empty)"}`,
    "",
    "Waves:",
  );
  for (const [i, wave] of report.waves.entries()) {
    out.push(`  ${i}: ${wave.join(", ")}`);
  }
  if (report.blocked.length > 0) {
    out.push(`  on a cycle: ${report.blocked.join(", ")}`);
  }
  out.push("", `Detailing order: ${report.order.map((group) => group.join(" + ")).join(" → ")}`);
  return out.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : (args[i + 1] ?? "");
  };
  const registry = buildPlanRegistry(ROOT);
  const specs = parseSpecStatuses(resolve(ROOT, "specs"));
  const report = buildStatusReport(registry, specs);
  const who = flag("--who-claims");
  if (who !== undefined) {
    const plan = registry.plans.find((p) => p.claims.includes(who));
    console.log(plan ? `${who} → ${plan.id} (${plan.path})` : `${who} → no plan claims it`);
  } else if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else if (args.includes("--mermaid")) {
    console.log(mermaid(registry.plans));
  } else {
    console.log(renderStatus(report, flag("--spec")));
  }
}
