/**
 * Rule tests for the plans gate.
 *
 * Two halves, as in `check-standards.test.ts`. The GOLDEN tests run against the real tree: the gate
 * must be green on what is committed, and UNAUDITED must describe reality, which is what makes it a
 * ratchet rather than decoration. The RULE tests drive in-memory registries, one assertion per
 * violation code, and a meta-test at the end asserts every code in VIOLATION_CODES was actually
 * exercised: a rule nobody has seen fire is a rule nobody knows works.
 */

import { afterAll, describe, expect, test } from "bun:test";

import type { Mention, PlansInput, ViolationCode } from "./check-plans.ts";
import {
  auditPreview,
  checkPlans,
  isMentionScanned,
  loadPlansInput,
  mentionPattern,
  UNAUDITED,
  VIOLATION_CODES,
} from "./check-plans.ts";
import type { PlanDoc, PlanRegistry } from "./lib/plans.ts";
import { parsePlanSource } from "./lib/plans.ts";
import { parseSpecSource } from "./lib/spec-status.ts";

/** Built at runtime so no line of this file is itself a plan citation the real gate would see. */
const PLAN = "plan:";

const exercised = new Set<ViolationCode>();

function codes(input: Partial<PlansInput>): ViolationCode[] {
  return checkPlans(fixture(input)).map((v) => v.code);
}

function expectViolation(input: Partial<PlansInput>, code: ViolationCode): void {
  exercised.add(code);
  expect(codes(input)).toContain(code);
}

function expectNoViolation(input: Partial<PlansInput>, code: ViolationCode): void {
  expect(codes(input)).not.toContain(code);
}

/** The first violation of `code`, for a test that reads its message. Counts as exercising it. */
function first(input: Partial<PlansInput>, code: ViolationCode) {
  exercised.add(code);
  const violations = checkPlans(fixture(input));
  return violations.find((x) => x.code === code);
}

/* ── Fixtures ────────────────────────────────────────────────────────────────── */

function specSource(status: string, ...body: string[]): string {
  const version = status === "Implemented" ? "0.1.0" : "0.1.0-draft";
  return [
    "# Fixture",
    "",
    `**Version:** ${version}\\`,
    `**Status:** ${status}\\`,
    "**Updated:** 2026-01-01",
    "",
    ...body,
    "",
    "## Changelog",
    "",
    `- **${version}** (2026-01-01) — first`,
  ].join("\n");
}

/**
 * Compiler.md: §1 built, §3 Partial, §4 leads Implemented with a later Partial, §5 unmarked, §10 a
 * Pending status cell, §11 a roadmap. ai.md: a whole-spec Partial and §2 Partial. desktop.md: a
 * Pending header over a built section. done.md: draft, nothing open. embedding.md: Implemented.
 */
const SPECS = [
  parseSpecSource(
    specSource(
      "Partial",
      "## 1. Built",
      "> **Status: Implemented.**",
      "## 3. Tiers",
      "> **Status: Partial.**",
      "## 4. Mixed",
      "> **Status: Implemented.**",
      "> **Status: Partial.** one part is not",
      "## 5. Unmarked",
      "## 10. Features",
      "| Islands | **Pending** |",
      "## 11. Implementation Roadmap",
    ),
    "compiler.md",
  ),
  parseSpecSource(
    specSource(
      "Partial",
      "> **Status: Partial.** a stub spec",
      "## 1. A",
      "> **Status: Implemented.**",
      "## 2. B",
      "> **Status: Partial.**",
    ),
    "ai.md",
  ),
  parseSpecSource(
    specSource(
      "Pending",
      "## 3. Shell",
      "> **Status: Implemented.**",
      "## 4. Single file",
      "> **Status: Pending.**",
    ),
    "desktop.md",
  ),
  parseSpecSource(specSource("Partial", "## 1. A", "> **Status: Implemented.**"), "done.md"),
  parseSpecSource(
    specSource("Implemented", "## 1. A", "> **Status: Implemented.**"),
    "embedding.md",
  ),
];

const STUB_BODY = "# A plan\n\n## Context\n\nWhy.\n";
const FULL_BODY = [
  "# A plan",
  "## Context",
  "## Outcome",
  "## Decisions",
  "- **Decided:** yes",
  "## Implementation",
  "## Tests",
  "## Specs & docs",
  "## Acceptance",
].join("\n\n");

interface PlanSpec {
  status?: string;
  disposition?: string;
  claims?: string[];
  requires?: string[];
  gaps?: string[];
  workspaces?: string[];
  size?: string;
  prs?: string[];
  extra?: string;
  body?: string;
}

/** A plan with valid defaults: a stub claiming compiler.md#3 under plans/compiler/. */
function plan(id: string, p: PlanSpec = {}): PlanDoc {
  const list = (key: string, values: string[] | undefined) =>
    values === undefined ? "" : `${key}: [${values.map((x) => JSON.stringify(x)).join(", ")}]\n`;
  const frontmatter = [
    `status: ${p.status ?? "stub"}\n`,
    `disposition: ${p.disposition ?? "implement"}\n`,
    list("claims", p.claims ?? ["compiler.md#3"]),
    list("requires", p.requires),
    list("gaps", p.gaps),
    list("workspaces", p.workspaces),
    `size: ${p.size ?? "S"}\n`,
    list("prs", p.prs),
    p.extra ?? "",
  ].join("");
  const body = p.body ?? (p.status && p.status !== "stub" ? FULL_BODY : STUB_BODY);
  return parsePlanSource(`---\n${frontmatter}---\n\n${body}\n`, `plans/${id}.md`, id);
}

function registry(plans: PlanDoc[], over: Partial<PlanRegistry> = {}): PlanRegistry {
  return { root: "/repo", contract: true, audits: new Set(), plans, strays: [], ...over };
}

/** By default nothing is audited and every draft fixture spec is on UNAUDITED. */
function fixture(over: Partial<PlansInput>): PlansInput {
  return {
    registry: registry([plan("compiler/tiers")]),
    specs: SPECS,
    gapIds: new Set(["ui-aria", "wcag"]),
    mentions: [],
    paths: [],
    isDirectory: (rel) => rel === "packages/compiler",
    unaudited: ["compiler.md", "ai.md", "desktop.md", "done.md"],
    ...over,
  };
}

/** Audit `stems` (and take them off UNAUDITED). */
function audited(stems: string[], plans: PlanDoc[]): Partial<PlansInput> {
  return {
    registry: registry(plans, { audits: new Set(stems) }),
    unaudited: ["compiler.md", "ai.md", "desktop.md", "done.md"].filter(
      (f) => !stems.includes(f.replace(/\.md$/, "")),
    ),
  };
}

/* ── Golden ─────────────────────────────────────────────────────────────────── */

describe("the committed tree", () => {
  const input = loadPlansInput();

  test("is green", () => {
    expect(checkPlans(input)).toEqual([]);
  });

  test("UNAUDITED is exactly the draft specs with no audit record", () => {
    const expected = input.specs
      .filter((s) => s.headerStatus !== "Implemented")
      .map((s) => s.file)
      .filter((f) => !input.registry.audits.has(f.replace(/\.md$/, "")));
    expect([...UNAUDITED].toSorted()).toEqual(expected.toSorted());
  });

  test("a clean fixture is green too, so every rule test below fails for its own reason", () => {
    expect(checkPlans(fixture({}))).toEqual([]);
  });
});

/* ── Layout ─────────────────────────────────────────────────────────────────── */

describe("layout", () => {
  test("contract-missing", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers")], { contract: false }) },
      "contract-missing",
    );
  });

  test("path-shape", () => {
    const strays = [{ path: "plans/loose.md", reason: "plans live at …" }];
    expectViolation({ registry: registry([plan("compiler/tiers")], { strays }) }, "path-shape");
  });

  test("stem-unknown, for a plan and for an audit record", () => {
    expectViolation(
      {
        registry: registry([
          plan("compiler/tiers"),
          plan("nosuch/x", { claims: ["compiler.md#4"] }),
        ]),
      },
      "stem-unknown",
    );
    expectViolation(
      { registry: registry([plan("compiler/tiers")], { audits: new Set(["nosuch"]) }) },
      "stem-unknown",
    );
  });
});

/* ── Shape ──────────────────────────────────────────────────────────────────── */

describe("shape", () => {
  const only = (p: PlanDoc) => ({ registry: registry([p]) });

  test("frontmatter-missing, absent or unparseable", () => {
    const absent = parsePlanSource("# T\n\n## Context\n", "plans/compiler/x.md", "compiler/x");
    const invalid = parsePlanSource(
      "---\nstatus: [\n---\n# T\n",
      "plans/compiler/y.md",
      "compiler/y",
    );
    expectViolation(only(absent), "frontmatter-missing");
    expectViolation(only(invalid), "frontmatter-missing");
  });

  test("field-unknown, field-missing, field-type", () => {
    expectViolation(only(plan("compiler/tiers", { extra: "title: Nope\n" })), "field-unknown");
    const noDisposition = parsePlanSource(
      `---\nstatus: stub\nclaims: [compiler.md#3]\nsize: S\n---\n${STUB_BODY}`,
      "plans/compiler/tiers.md",
      "compiler/tiers",
    );
    expectViolation(only(noDisposition), "field-missing");
    expectViolation(only(plan("compiler/tiers", { extra: "gaps: ui-aria\n" })), "field-type");
  });

  test("status-unknown says a finished plan is deleted", () => {
    const v = first(only(plan("compiler/tiers", { status: "done" })), "status-unknown");
    expect(v?.message).toContain("a finished plan is deleted, not marked done");
  });

  test("disposition-unknown, size-unknown", () => {
    expectViolation(only(plan("compiler/tiers", { disposition: "build" })), "disposition-unknown");
    expectViolation(only(plan("compiler/tiers", { size: "XL" })), "size-unknown");
  });

  test("title-missing: exactly one H1", () => {
    expectViolation(only(plan("compiler/tiers", { body: "## Context\n" })), "title-missing");
    expectViolation(
      only(plan("compiler/tiers", { body: "# A\n# B\n## Context\n" })),
      "title-missing",
    );
  });

  test("section-missing: a stub needs Context, a drafted plan every template heading", () => {
    expectViolation(only(plan("compiler/tiers", { body: "# T\n" })), "section-missing");
    expectViolation(
      only(
        plan("compiler/tiers", {
          status: "drafted",
          workspaces: ["packages/compiler"],
          body: STUB_BODY,
        }),
      ),
      "section-missing",
    );
    expectNoViolation(only(plan("compiler/tiers")), "section-missing");
  });

  test("decision-open: ready and active plans have decided everything", () => {
    const body = FULL_BODY.replace("- **Decided:** yes", "- **Open:** which header");
    expectViolation(
      only(plan("compiler/tiers", { status: "ready", workspaces: ["packages/compiler"], body })),
      "decision-open",
    );
    expectNoViolation(
      only(plan("compiler/tiers", { status: "drafted", workspaces: ["packages/compiler"], body })),
      "decision-open",
    );
  });

  test("slices-missing, slice-grammar, slice-duplicate", () => {
    expectViolation(
      only(plan("compiler/tiers", { size: "L", status: "drafted" })),
      "slices-missing",
    );
    const stubL = only(plan("compiler/tiers", { size: "L" }));
    expect(checkPlans(fixture(stubL))).toEqual([]);
    const sliced = (id: string, slice: string, claims: string[]) =>
      plan(id, {
        claims,
        body: `${STUB_BODY}\n## Slices\n\n| Slice | Scope | Claims | State |\n| --- | --- | --- | --- |\n| ${slice} | x | — | open |\n`,
      });
    expectViolation(only(sliced("compiler/tiers", "1", ["compiler.md#3"])), "slice-grammar");
    expectViolation(
      {
        registry: registry([
          sliced("compiler/tiers", "CS1.1", ["compiler.md#3"]),
          sliced("compiler/mixed", "CS1.1", ["compiler.md#4"]),
        ]),
      },
      "slice-duplicate",
    );
  });

  test("prs-grammar, active-without-pr", () => {
    expectViolation(only(plan("compiler/tiers", { prs: ["#12"] })), "prs-grammar");
    expectViolation(
      only(plan("compiler/tiers", { status: "active", workspaces: ["packages/compiler"] })),
      "active-without-pr",
    );
  });

  test("workspace-missing, workspace-required", () => {
    expectViolation(
      only(plan("compiler/tiers", { workspaces: ["packages/nope"] })),
      "workspace-missing",
    );
    expectViolation(only(plan("compiler/tiers", { status: "drafted" })), "workspace-required");
    expectNoViolation(
      only(plan("compiler/tiers", { status: "drafted", disposition: "reconcile" })),
      "workspace-required",
    );
  });
});

/* ── Claims ─────────────────────────────────────────────────────────────────── */

describe("claims", () => {
  const only = (p: PlanDoc) => ({ registry: registry([p]) });

  test("claim-grammar, claim-spec-unknown, claim-anchor-unknown", () => {
    expectViolation(
      only(plan("compiler/tiers", { claims: ["specs/compiler.md#3"] })),
      "claim-grammar",
    );
    expectViolation(
      only(plan("compiler/tiers", { claims: ["nosuch.md#1"] })),
      "claim-spec-unknown",
    );
    expectViolation(
      only(plan("compiler/tiers", { claims: ["compiler.md#99"] })),
      "claim-anchor-unknown",
    );
  });

  test("claim-not-open: the last closed claim asks for the deletion and names the dependents", () => {
    const plans = [
      plan("compiler/built", { claims: ["compiler.md#1"] }),
      plan("compiler/tiers", { requires: ["compiler/built"] }),
    ];
    const v = first({ registry: registry(plans) }, "claim-not-open");
    expect(v?.message).toContain("delete plans/compiler/built.md in this pull request");
    expect(v?.message).toContain("remove it from the requires of: compiler/tiers");
  });

  test("claim-not-open for one of several claims asks only to drop that claim", () => {
    const two = plan("compiler/tiers", { claims: ["compiler.md#3", "compiler.md#5"] });
    const v = first(only(two), "claim-not-open");
    expect(v?.message).toContain("compiler.md#5 is unmarked");
    expect(v?.message).toContain("remove the claim");
  });

  test("a whole-spec claim is open while the preamble marker stands", () => {
    expectNoViolation(only(plan("ai/stub", { claims: ["ai.md"] })), "claim-not-open");
    expectViolation(only(plan("compiler/whole", { claims: ["compiler.md"] })), "claim-not-open");
  });

  test("claim-duplicate", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers"), plan("compiler/other")]) },
      "claim-duplicate",
    );
  });

  test("claim-misplaced, shared-single-spec", () => {
    expectViolation(only(plan("compiler/tiers", { claims: ["ai.md#2"] })), "claim-misplaced");
    expectViolation(
      only(plan("_shared/tiers", { claims: ["compiler.md#3"] })),
      "shared-single-spec",
    );
    expectNoViolation(
      only(plan("_shared/tiers", { claims: ["compiler.md#3", "ai.md#2"] })),
      "shared-single-spec",
    );
  });

  test("plan-unanchored, unless another plan requires it", () => {
    expectViolation(only(plan("compiler/enabler", { claims: [] })), "plan-unanchored");
    expectNoViolation(
      {
        registry: registry([
          plan("compiler/enabler", { claims: [] }),
          plan("compiler/tiers", { requires: ["compiler/enabler"] }),
        ]),
      },
      "plan-unanchored",
    );
  });
});

/* ── Coverage ───────────────────────────────────────────────────────────────── */

describe("coverage", () => {
  test("unclaimed-open, only once the spec is audited", () => {
    expectViolation(audited(["compiler"], [plan("compiler/tiers")]), "unclaimed-open");
    expectNoViolation({}, "unclaimed-open");
  });

  test("marker-leading: a later marker or a cell must be led by the open status", () => {
    const v = first(audited(["compiler"], [plan("compiler/tiers")]), "marker-leading");
    expect(v?.message).toContain("§4 admits a Partial part");
    expect(v?.message).toContain("leads with Implemented");
  });

  test("roadmap-in-spec", () => {
    expectViolation(audited(["compiler"], [plan("compiler/tiers")]), "roadmap-in-spec");
  });

  test("a numbered roadmap marked Removed is retired, and its heading stays", () => {
    const retired = parseSpecSource(
      specSource(
        "Partial",
        "## 1. A",
        "> **Status: Partial.**",
        "## 2. Implementation Roadmap",
        "> **Status: Removed.** Open work is tracked on each feature's own section.",
      ),
      "retired.md",
    );
    const plans = [plan("compiler/tiers"), plan("retired/a", { claims: ["retired.md#1"] })];
    const input = fixture({
      specs: [...SPECS, retired],
      registry: registry(plans, { audits: new Set(["retired"]) }),
    });
    const violations = checkPlans(input);
    expect(violations.filter((x) => x.file === "specs/retired.md")).toEqual([]);
  });

  test("header-stale: a Pending header over built sections is Partial", () => {
    expectViolation(
      audited(
        ["desktop"],
        [plan("compiler/tiers"), plan("desktop/single", { claims: ["desktop.md#4"] })],
      ),
      "header-stale",
    );
  });

  test("graduation-ready: an audited draft spec with nothing open graduates by spec:bump", () => {
    const v = first(audited(["done"], [plan("compiler/tiers")]), "graduation-ready");
    expect(v?.message).toContain("bun run spec:bump done.md patch");
  });
});

describe("auditPreview (--audit <stem>)", () => {
  test("judges the named spec as audited and reports only its own violations", () => {
    const { input, keep } = auditPreview(fixture({}), ["compiler"]);
    expect(input.unaudited).not.toContain("compiler.md");
    const reported = checkPlans(input).filter((x) => keep(x));
    expect(reported.map((x) => x.code)).toEqual(["audit-missing"]);
    expect(reported[0]?.file).toBe("specs/compiler.md");
  });

  test("keeps plans under the named spec and drops everything else", () => {
    const { keep } = auditPreview(fixture({}), ["ai"]);
    expect(keep({ code: "field-missing", file: "plans/ai/x.md", message: "" })).toBe(true);
    expect(keep({ code: "field-missing", file: "plans/compiler/x.md", message: "" })).toBe(false);
    expect(keep({ code: "audit-missing", file: "specs/ai.md", message: "" })).toBe(true);
  });
});

/* ── Gaps and graph ─────────────────────────────────────────────────────────── */

describe("gaps", () => {
  test("gap-unknown, gap-duplicate", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers", { gaps: ["nope"] })]) },
      "gap-unknown",
    );
    expectViolation(
      {
        registry: registry([
          plan("compiler/tiers", { gaps: ["ui-aria"] }),
          plan("compiler/mixed", { claims: ["compiler.md#4"], gaps: ["ui-aria"] }),
        ]),
      },
      "gap-duplicate",
    );
  });
});

describe("the requires graph", () => {
  const base = () => plan("compiler/tiers");

  test("requires-unknown tells whoever landed the prerequisite to re-read the dependent", () => {
    const dangling = plan("compiler/tiers", { requires: ["compiler/gone"] });
    const v = first({ registry: registry([dangling]) }, "requires-unknown");
    expect(v?.message).toContain("remove the edge and re-read this plan");
  });

  test("requires-self, requires-duplicate", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers", { requires: ["compiler/tiers"] })]) },
      "requires-self",
    );
    expectViolation(
      {
        registry: registry([
          plan("compiler/tiers", { requires: ["compiler/mixed", "compiler/mixed"] }),
          plan("compiler/mixed", { claims: ["compiler.md#4"] }),
        ]),
      },
      "requires-duplicate",
    );
  });

  test("requires-cycle", () => {
    expectViolation(
      {
        registry: registry([
          plan("compiler/tiers", { requires: ["compiler/mixed"] }),
          plan("compiler/mixed", { claims: ["compiler.md#4"], requires: ["compiler/tiers"] }),
        ]),
      },
      "requires-cycle",
    );
  });

  test("requires-not-ready, active-with-requires", () => {
    const ready = (status: string) =>
      plan("compiler/tiers", {
        status,
        workspaces: ["packages/compiler"],
        requires: ["compiler/mixed"],
        prs: ["jxsuite/jx#1"],
        body: `${FULL_BODY}\n\n## Slices\n\n| Slice | Scope | Claims | State |\n| --- | --- | --- | --- |\n| CS1.1 | x | — | open |`,
      });
    const prerequisite = plan("compiler/mixed", { claims: ["compiler.md#4"] });
    expectViolation({ registry: registry([ready("ready"), prerequisite]) }, "requires-not-ready");
    expectViolation(
      { registry: registry([ready("active"), prerequisite]) },
      "active-with-requires",
    );
    expectNoViolation({ registry: registry([base()]) }, "requires-not-ready");
  });
});

/* ── Citations ──────────────────────────────────────────────────────────────── */

describe("citations", () => {
  const sliced = plan("compiler/tiers", {
    body: `${STUB_BODY}\n## Slices\n\n| Slice | Scope | Claims | State |\n| --- | --- | --- | --- |\n| CS1.1 | x | — | open |\n`,
  });

  test("citation-unknown: a plan cites a plan or a slice that does not exist", () => {
    expectViolation(
      {
        registry: registry([
          plan("compiler/tiers", { body: `${STUB_BODY}\nSee ${PLAN}compiler/gone.\n` }),
        ]),
      },
      "citation-unknown",
    );
    expectViolation(
      {
        registry: registry([
          sliced,
          plan("compiler/mixed", {
            claims: ["compiler.md#4"],
            body: `${STUB_BODY}\nAfter ${PLAN}compiler/tiers#CS9.9.\n`,
          }),
        ]),
      },
      "citation-unknown",
    );
  });

  test("citation-outside-plans: a plan: token or a declared slice id in a permanent file", () => {
    const mention = (text: string): Mention => ({ path: "packages/x/src/a.ts", line: 3, text });
    expectViolation(
      { registry: registry([sliced]), mentions: [mention(`// see ${PLAN}compiler/tiers`)] },
      "citation-outside-plans",
    );
    expectViolation(
      { registry: registry([sliced]), mentions: [mention("// landed in CS1.1")] },
      "citation-outside-plans",
    );
    expectNoViolation(
      { registry: registry([sliced]), mentions: [mention("// CS1.10 is another slice")] },
      "citation-outside-plans",
    );
  });

  test("citation-outside-plans: a plan's section cited in prose, in either order", () => {
    // Assembled at runtime for the same reason as PLAN: this file is itself scanned.
    const sign = "§";
    const mention = (text: string): Mention => ({ path: "packages/x/src/a.ts", line: 9, text });
    for (const text of [
      `// the keymap (plan ${sign}5.3)`,
      `// the plan's ${sign}6.2 says so`,
      `// see UX-REDESIGN-PLAN ${sign}13.5`,
      `// (${sign}9.6 of UX-REDESIGN-PLAN)`,
    ]) {
      expectViolation({ mentions: [mention(text)] }, "citation-outside-plans");
    }
    // Naming a deleted document as history cites nothing.
    expectNoViolation(
      { mentions: [mention("// UX-REDESIGN-PLAN.md was deleted in 7670f37e")] },
      "citation-outside-plans",
    );
    expectNoViolation({ mentions: [mention(`// ${sign}5 of the spec`)] }, "citation-outside-plans");
  });

  test("plan-doc-outside-plans", () => {
    expectViolation({ paths: ["packages/studio/UX-REDESIGN-PLAN.md"] }, "plan-doc-outside-plans");
    expectViolation({ paths: [".claude/plans/cozy.md"] }, "plan-doc-outside-plans");
    expectNoViolation({ paths: ["plans/README.md", "docs/plan.md"] }, "plan-doc-outside-plans");
  });

  test("the scan skips plans/ and changelogs, and reads only text", () => {
    expect(isMentionScanned("packages/ai/src/a.ts")).toBe(true);
    expect(isMentionScanned("plans/ai/harness-phase-1.md")).toBe(false);
    expect(isMentionScanned("packages/schema/CHANGELOG.md")).toBe(false);
    expect(isMentionScanned("CHANGELOG.md")).toBe(false);
    expect(isMentionScanned("docs/images/a.png")).toBe(false);
  });

  test("a slice id matches whole, never inside a longer id", () => {
    const pattern = mentionPattern([sliced]);
    const hits = (s: string) => {
      pattern.lastIndex = 0;
      return pattern.test(s);
    };
    expect(hits("CS1.1 landed")).toBe(true);
    expect(hits("(CS1.1).")).toBe(true);
    expect(hits("CS1.10")).toBe(false);
    expect(hits("CS1.1.2")).toBe(false);
    expect(hits("XCS1.1")).toBe(false);
  });
});

/* ── Ratchet ────────────────────────────────────────────────────────────────── */

describe("the audit ratchet", () => {
  test("audit-missing: a draft spec off UNAUDITED needs its record", () => {
    expectViolation({ unaudited: ["ai.md", "desktop.md", "done.md"] }, "audit-missing");
  });

  test("unaudited-stale: an audited, graduated or missing spec leaves the list", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers")], { audits: new Set(["compiler"]) }) },
      "unaudited-stale",
    );
    expectViolation(
      { unaudited: ["compiler.md", "ai.md", "desktop.md", "done.md", "embedding.md"] },
      "unaudited-stale",
    );
    expectViolation(
      { unaudited: ["compiler.md", "ai.md", "desktop.md", "done.md", "gone.md"] },
      "unaudited-stale",
    );
  });

  test("graduated-dir-stale: an Implemented spec has nothing left to plan", () => {
    expectViolation(
      { registry: registry([plan("compiler/tiers")], { audits: new Set(["embedding"]) }) },
      "graduated-dir-stale",
    );
  });
});

/* ── Meta ───────────────────────────────────────────────────────────────────── */

afterAll(() => {
  const untested = VIOLATION_CODES.filter((c) => !exercised.has(c));
  if (untested.length > 0) {
    throw new Error(
      `these violation codes are never exercised by a test: ${untested.join(", ")}. ` +
        "A rule nobody has seen fire is a rule nobody knows works.",
    );
  }
});
