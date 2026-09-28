/**
 * The plans/ parser and its graph: paths, claims, the parts of a plan body the gate reads, and the
 * orderings `plans:status` prints. `check-plans.test.ts` covers the rules built on top.
 */

import { describe, expect, test } from "bun:test";

import { splitFrontmatter } from "./frontmatter.ts";
import type { PlanDoc } from "./plans.ts";
import {
  classifyPlanPath,
  findCycle,
  parseClaim,
  parsePlanSource,
  readyQueue,
  specOrder,
  topoWaves,
} from "./plans.ts";

/** Built at runtime so no line of this file is itself a plan citation. */
const PLAN = "plan:";

function plan(id: string, frontmatter: string, body = "# A plan\n\n## Context\n\nWhy.\n"): PlanDoc {
  return parsePlanSource(`---\n${frontmatter}\n---\n\n${body}`, `plans/${id}.md`, id);
}

const node = (id: string, requires: string[] = [], status = "ready") =>
  plan(id, `status: ${status}\nrequires: [${requires.join(", ")}]`);

describe("splitFrontmatter", () => {
  test("parses the block and says where the body starts", () => {
    const split = splitFrontmatter("---\nstatus: stub\n---\n# T\n");
    expect(split).toMatchObject({ kind: "parsed", data: { status: "stub" }, bodyLine: 4 });
  });

  test("tells an unparseable block apart from an absent one", () => {
    expect(splitFrontmatter("# T\n").kind).toBe("absent");
    expect(splitFrontmatter("---\nstatus: [unclosed\n---\n").kind).toBe("invalid");
    expect(splitFrontmatter("---\n- a list\n---\n")).toMatchObject({
      kind: "invalid",
      error: "frontmatter is not a mapping",
    });
  });

  test("an empty block is an empty mapping", () => {
    expect(splitFrontmatter("---\n\n---\n")).toMatchObject({ kind: "parsed", data: {} });
  });
});

describe("classifyPlanPath", () => {
  test("names the contract, an audit record, a plan and a shared plan", () => {
    expect(classifyPlanPath("plans/README.md")).toEqual({ kind: "contract" });
    expect(classifyPlanPath("plans/compiler/README.md")).toEqual({
      kind: "audit",
      stem: "compiler",
    });
    expect(classifyPlanPath("plans/compiler/csp-emission.md")).toEqual({
      kind: "plan",
      id: "compiler/csp-emission",
      home: "compiler",
      slug: "csp-emission",
    });
    expect(classifyPlanPath("plans/_shared/a11y-audit.md")).toMatchObject({
      kind: "plan",
      home: "_shared",
    });
  });

  test("refuses every other shape", () => {
    for (const path of [
      "plans/loose.md",
      "plans/compiler/deep/x.md",
      "plans/compiler/notes.txt",
      "plans/compiler/readme.md",
      "plans/compiler/Upper-Case.md",
      "plans/_shared/README.md",
      "plans/Not_A_Stem/x.md",
      "elsewhere/x.md",
    ]) {
      expect(classifyPlanPath(path).kind).toBe("stray");
    }
  });
});

describe("parseClaim", () => {
  test("accepts a section, a lettered section and a whole spec", () => {
    expect(parseClaim("compiler.md#3")).toEqual({
      raw: "compiler.md#3",
      file: "compiler.md",
      anchor: "3",
    });
    expect(parseClaim("spec.md#19.4a")?.anchor).toBe("19.4a");
    expect(parseClaim("ai.md")).toEqual({ raw: "ai.md", file: "ai.md" });
  });

  test("rejects the forms a docs page would not accept", () => {
    for (const raw of ["specs/x.md#3", "x.md#§3", "x.md#", "x#3", "X.md#3", "x.md#a"]) {
      expect(parseClaim(raw)).toBeNull();
    }
  });
});

describe("parsePlanSource", () => {
  test("reads the frontmatter fields and reports unknown, missing and mistyped ones", () => {
    const doc = plan("compiler/a", "status: drafted\nclaims: compiler.md#3\ntitle: Nope\nsize: 3");
    expect(doc.status).toBe("drafted");
    expect(doc.unknownFields).toEqual(["title"]);
    expect(doc.missingFields).toEqual(["disposition"]);
    expect(doc.fieldProblems.map((p) => p.field)).toEqual(["size", "claims"]);
  });

  test("an absent list field is empty", () => {
    const doc = plan("compiler/a", "status: stub");
    expect(doc.requires).toEqual([]);
    expect(doc.claims).toEqual([]);
  });

  test("reads the H1, the sections, and the slice ids, skipping fenced code", () => {
    const body = [
      "# Emit a CSP",
      "",
      "## Context",
      "",
      "```markdown",
      "# Not a title",
      "## Not a section",
      "```",
      "",
      "## Slices",
      "",
      "| Slice | Scope | Claims | State |",
      "| --- | --- | --- | --- |",
      "| `CS1.1` | hashes | — | open |",
      "| CS1.2 | header | — | merged jxsuite/jx#1 |",
      "",
      "Notes under the table are not rows.",
      "| X9.9 | a second table | | |",
    ].join("\n");
    const doc = plan("compiler/a", "status: active", body);
    expect(doc.titles).toEqual(["Emit a CSP"]);
    expect(doc.sections.map((s) => s.title)).toEqual(["Context", "Slices"]);
    expect(doc.slices.map((s) => s.id)).toEqual(["CS1.1", "CS1.2"]);
  });

  test("an **Open:** item counts only inside ## Decisions", () => {
    const body = [
      "# T",
      "## Context",
      "- **Open:** context is not decisions",
      "## Decisions",
      "- **Decided:** yes",
      "- **Open:** which header",
      "1. **Open:** numbered too",
      "## Tests",
      "- **Open:** not here either",
    ].join("\n");
    expect(plan("compiler/a", "status: ready", body).openDecisions).toHaveLength(2);
  });

  test("finds plan citations with their slices and lines", () => {
    const body = `# T\n\nSee \`${PLAN}spec/csp-hashes\` and ${PLAN}ai/harness-phase-1#CS2.4.\n`;
    expect(plan("compiler/a", "status: stub", body).citations).toEqual([
      { target: "spec/csp-hashes", line: 7 },
      { target: "ai/harness-phase-1", slice: "CS2.4", line: 7 },
    ]);
  });

  test("an unparseable frontmatter is reported, not mistaken for none", () => {
    const doc = parsePlanSource("---\nstatus: [\n---\n# T\n", "plans/x/y.md", "x/y");
    expect(doc.frontmatter).toBe("invalid");
    expect(doc.frontmatterError).toBeString();
  });
});

describe("the requires graph", () => {
  test("findCycle reports the path, and ignores edges to plans that do not exist", () => {
    expect(findCycle([node("a/x", ["b/y"]), node("b/y", ["a/x"])])).toEqual(["a/x", "b/y", "a/x"]);
    expect(findCycle([node("a/x", ["gone/z"]), node("b/y", ["a/x"])])).toBeNull();
  });

  test("topoWaves orders prerequisites first, deterministically, and isolates a cycle", () => {
    const plans = [
      node("c/z", ["a/x", "b/y"]),
      node("b/y", ["a/x"]),
      node("a/x"),
      node("d/w"),
      node("e/1", ["e/2"]),
      node("e/2", ["e/1"]),
    ];
    expect(topoWaves(plans)).toEqual({
      waves: [["a/x", "d/w"], ["b/y"], ["c/z"]],
      blocked: ["e/1", "e/2"],
    });
  });

  test("readyQueue holds ready and active plans whose prerequisites have all landed", () => {
    const plans = [
      node("a/x", [], "ready"),
      node("b/y", [], "stub"),
      node("c/z", ["a/x"], "ready"),
      node("d/w", [], "active"),
      node("e/v", [], "drafted"),
    ];
    expect(readyQueue(plans).map((p) => p.id)).toEqual(["a/x", "d/w"]);
  });

  test("specOrder puts a spec after the specs its plans reach, through _shared", () => {
    const plans = [
      node("studio/x", ["_shared/bridge"]),
      node("_shared/bridge", ["ui/y"]),
      node("ui/y", ["spec/z"]),
      node("spec/z"),
    ];
    expect(specOrder(plans, ["studio", "ui", "spec", "desktop"], ["desktop"])).toEqual([
      // Desktop reaches nothing, so the provisional order is free to put it first.
      ["desktop"],
      ["spec"],
      ["ui"],
      ["studio"],
    ]);
  });

  test("specOrder merges specs whose plans require each other into one group", () => {
    const plans = [
      node("ui/a", ["studio-ui-guidelines/b"]),
      node("studio-ui-guidelines/b", ["ui/c"]),
      node("ui/c"),
    ];
    expect(
      specOrder(plans, ["ui", "studio-ui-guidelines"], ["ui", "studio-ui-guidelines"]),
    ).toEqual([["ui", "studio-ui-guidelines"]]);
  });
});
