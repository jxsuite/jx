/** `plans:status`: the report is derived, never written, so what it prints is the whole contract. */

import { describe, expect, test } from "bun:test";

import { parsePlanSource } from "./lib/plans.ts";
import type { PlanRegistry } from "./lib/plans.ts";
import { parseSpecSource } from "./lib/spec-status.ts";
import { buildStatusReport, mermaid, renderStatus } from "./plans-status.ts";

const spec = (file: string, status: string, ...body: string[]) =>
  parseSpecSource(
    [`**Version:** 0.1.0-draft\\`, `**Status:** ${status}\\`, "", ...body].join("\n"),
    file,
  );

const plan = (id: string, frontmatter: string) =>
  parsePlanSource(`---\n${frontmatter}\n---\n\n# ${id}\n`, `plans/${id}.md`, id);

const specs = [
  spec(
    "compiler.md",
    "Partial",
    "## 3. Tiers",
    "> **Status: Partial.**",
    "## 10. Features",
    "| x | **Pending** |",
  ),
  spec("spec.md", "Partial", "## 7. Refs", "> **Status: Pending.**"),
  spec("server.md", "Implemented", "## 1. A", "> **Status: Implemented.**"),
];

const registry: PlanRegistry = {
  root: "/repo",
  contract: true,
  audits: new Set(["compiler"]),
  plans: [
    plan("compiler/tiers", "status: ready\nclaims: [compiler.md#3]\nrequires: [spec/refs]"),
    plan("spec/refs", "status: ready\nclaims: [spec.md#7]"),
  ],
  strays: [],
};

describe("buildStatusReport", () => {
  const report = buildStatusReport(registry, specs, ["spec.md"]);

  test("lists draft specs only, with each open item and its claimant", () => {
    expect(report.specs.map((s) => s.file)).toEqual(["compiler.md", "spec.md"]);
    const [compiler] = report.specs;
    expect(compiler?.audited).toBe(true);
    expect(compiler?.items.map((i) => [i.anchor, i.claimedBy])).toEqual([
      ["3", "compiler/tiers"],
      ["10", undefined],
    ]);
    expect(report.specs[1]?.audited).toBe(false);
  });

  test("orders the work: waves, the ready queue, and specs after the specs they require", () => {
    expect(report.waves).toEqual([["spec/refs"], ["compiler/tiers"]]);
    expect(report.ready).toEqual(["spec/refs"]);
    expect(report.order).toEqual([["spec"], ["compiler"]]);
  });
});

describe("renderStatus", () => {
  const report = buildStatusReport(registry, specs, ["spec.md"]);

  test("prints a line per spec and per item, marking what is unclaimed and where", () => {
    const text = renderStatus(report);
    expect(text).toContain("compiler.md (Partial, audited): 2 open, 1 claimed, 1 plan(s)");
    expect(text).toContain("→ compiler/tiers");
    expect(text).toContain("→ (unclaimed), cell at line 7");
    expect(text).toContain("Ready queue: spec/refs");
    expect(text).toContain("Detailing order: spec → compiler");
  });

  test("--spec narrows the report to one spec", () => {
    const text = renderStatus(report, "spec");
    expect(text).toContain("spec.md (Partial, not audited)");
    expect(text).not.toContain("compiler.md");
    expect(text).not.toContain("Ready queue");
  });

  test("an audited spec with nothing open is told to graduate", () => {
    const clean = buildStatusReport(
      { ...registry, audits: new Set(["spec"]), plans: [] },
      [spec("spec.md", "Partial", "## 1. A", "> **Status: Implemented.**")],
      [],
    );
    expect(renderStatus(clean)).toContain("nothing open: graduate it");
  });
});

describe("mermaid", () => {
  test("draws one subgraph per home and an edge per requires", () => {
    const text = mermaid(registry.plans);
    expect(text).toStartWith("flowchart RL");
    expect(text).toContain('subgraph compiler["compiler"]');
    expect(text).toContain("compiler_tiers --> spec_refs");
  });
});
