/**
 * The version arithmetic behind `spec:bump` and `docs:status`.
 *
 * `versionFloor` exists because of a real collision: two branches each released `specs/studio.md`
 * as `0.9.31-draft`, because `spec:bump` read only the working file and neither branch could see
 * what the other had published. It surfaced at merge time as an ordering error, and the fix was
 * renumbering a header, a footer and two changelog entries by hand.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  compareSpecVersion,
  openItems,
  parseSpecSource,
  parseSpecStatuses,
  splitVersion,
  versionFloor,
} from "./spec-status.ts";

function v(raw: string) {
  const parsed = splitVersion(raw);
  if (!parsed) {
    throw new Error(`fixture "${raw}" is not a spec version`);
  }
  return parsed;
}

describe("versionFloor", () => {
  test("a base ahead of the working file raises the floor, and says it did", () => {
    // The exact shape of the collision: forked at 0.9.30, main released 0.9.31 meanwhile.
    // Bumping from 0.9.30 would mint 0.9.31 a second time.
    const { version, raised } = versionFloor(v("0.9.30-draft"), v("0.9.31-draft"));
    expect(version.raw).toBe("0.9.31-draft");
    expect(raised).toBe(true);
  });

  test("a base level with the working file changes nothing", () => {
    const { version, raised } = versionFloor(v("0.9.33-draft"), v("0.9.33-draft"));
    expect(version.raw).toBe("0.9.33-draft");
    expect(raised).toBe(false);
  });

  test("a base BEHIND the working file is ignored", () => {
    // The ordinary case on a branch that has already released once: the local file is ahead, and
    // The base must not drag it back.
    const { version, raised } = versionFloor(v("0.9.34-draft"), v("0.9.31-draft"));
    expect(version.raw).toBe("0.9.34-draft");
    expect(raised).toBe(false);
  });

  test("no base at all means no floor", () => {
    // An unfetched ref, a shallow clone, or a spec this branch is the one to add.
    const { version, raised } = versionFloor(v("0.1.0-draft"), null);
    expect(version.raw).toBe("0.1.0-draft");
    expect(raised).toBe(false);
  });

  test("a released base outranks the same tuple still in draft", () => {
    // `2.1.0-draft` < `2.1.0`, so graduating on main must still raise a drafting branch's floor.
    const { version, raised } = versionFloor(v("2.1.0-draft"), v("2.1.0"));
    expect(version.raw).toBe("2.1.0");
    expect(raised).toBe(true);
  });

  test("it compares numerically, not lexically", () => {
    // "0.9.9" vs "0.9.10": string comparison puts 9 after 10 and would miss the collision.
    const { version, raised } = versionFloor(v("0.9.9-draft"), v("0.9.10-draft"));
    expect(version.raw).toBe("0.9.10-draft");
    expect(raised).toBe(true);
  });
});

describe("compareSpecVersion", () => {
  test("orders by major, then minor, then patch, then draft", () => {
    expect(compareSpecVersion("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSpecVersion("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareSpecVersion("0.9.10", "0.9.9")).toBeGreaterThan(0);
    expect(compareSpecVersion("2.1.0-draft", "2.1.0")).toBeLessThan(0);
    expect(compareSpecVersion("0.9.31-draft", "0.9.31-draft")).toBe(0);
  });

  test("an unparseable version is null rather than a guess", () => {
    expect(compareSpecVersion("not-a-version", "1.0.0")).toBeNull();
  });
});

describe("against the committed specs", () => {
  test("no spec declares the same version twice in its changelog", () => {
    // The regression this whole change is about, asserted directly rather than inferred from the
    // Newest-first rule, which reports a collision as an ordering fault and sends you looking at
    // The wrong thing.
    const offenders: string[] = [];
    for (const file of [...new Bun.Glob("*.md").scanSync({ cwd: "specs" })].toSorted()) {
      const text = readFileSync(join("specs", file), "utf8");
      const seen = new Map<string, number>();
      for (const match of text.matchAll(/^- \*\*(\d+\.\d+\.\d+(?:-draft)?)\*\*/gm)) {
        const version = match[1]!;
        seen.set(version, (seen.get(version) ?? 0) + 1);
      }
      for (const [version, count] of seen) {
        if (count > 1) {
          offenders.push(`specs/${file}: ${count} changelog entries claim ${version}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** A spec body: a header block, then the given lines, then a changelog. */
function spec(...body: string[]): string {
  return [
    "# X",
    "",
    "**Version:** 0.1.0-draft\\",
    "**Status:** Partial\\",
    "**Updated:** 2026-01-01",
    "",
    ...body,
    "",
    "## Changelog",
    "",
    "- **0.1.0-draft** (2026-01-01) — first",
  ].join("\n");
}

const parse = (...body: string[]) => parseSpecSource(spec(...body), "x.md");

describe("markers", () => {
  test("the first blockquote sets `status`, and every marker is kept in `markers`", () => {
    const s = parse(
      "## 6. Scope",
      "> **Status: Implemented.** The interpreter.",
      "> **Status: Future.** A restricted evaluator.",
    );
    const [section] = s.sections;
    expect(section?.status).toBe("Implemented");
    expect(section?.markers.map((m) => m.status)).toEqual(["Implemented", "Future"]);
    // A Future remainder is deferred, not unbuilt: the §6.6 shape is not an open item.
    expect(openItems(s)).toEqual([]);
  });

  test("a later Partial opens a section that leads with Implemented", () => {
    // The ai.md §2.2 shape: the Anthropic provider's gap sat under a second marker for months.
    const s = parse(
      "### 2.2 The request",
      "> **Status: Implemented.** The openai path.",
      "> **Status: Partial.** The Anthropic provider is not yet implemented.",
    );
    expect(s.sections[0]?.status).toBe("Implemented");
    expect(openItems(s)).toMatchObject([
      { anchor: "2.2", status: "Partial", form: "blockquote", leading: false, line: 9 },
    ]);
  });

  test("a second status on a marker line is a second marker", () => {
    // The spec.md §7.4 shape.
    const s = parse(
      "### 7.4 `$ref` Resolution",
      "> **Status: Implemented** for `$map/` in `resolveRef`. **Partial** for node-level refs.",
    );
    expect(s.sections[0]?.markers.map((m) => m.status)).toEqual(["Implemented", "Partial"]);
    expect(openItems(s)).toMatchObject([{ anchor: "7.4", status: "Partial", leading: false }]);
  });

  test("Implemented, Future and Removed prose words on a marker line are history, not markers", () => {
    const s = parse(
      "## 10. SaaS",
      "> **Status: Implemented.** This section said **Future** for as long as it ran.",
    );
    expect(s.sections[0]?.markers).toHaveLength(1);
  });

  test("a qualified marker still reads its status word", () => {
    const s = parse("### 11.4 Server", "> **Status: Partial (dev boundary).** During dev…");
    expect(s.sections[0]?.status).toBe("Partial");
  });

  test("the colon-outside form is an error, not a silent non-marker", () => {
    const s = parse("### 3.7 Context", "> **Status:** Implemented");
    expect(s.sections[0]?.status).toBeUndefined();
    expect(s.badForms).toMatchObject([{ line: 8, reason: expect.stringContaining("colon") }]);
  });

  test("a bare header-style `**Status:**` line under a section is an error, not a marker", () => {
    // The studio-ui-guidelines §11–§13 shape: two Partials no page ever listed.
    const s = parse(
      "## 12. Rendering Rules",
      "**Status:** Partial — the surfaces are being ported.",
    );
    expect(s.headerStatus).toBe("Partial");
    expect(s.sections[0]?.markers).toEqual([]);
    expect(s.badForms[0]?.reason).toContain("a section's status is a blockquote");
  });

  test("an off-vocabulary status word is an error", () => {
    const s = parse("## 1. A", "> **Status: Planned.**");
    expect(s.badForms[0]?.reason).toContain('"Planned" is not in the status vocabulary');
  });
});

describe("sections and headings", () => {
  test("a marker above the first numbered heading is the preamble, not §1's", () => {
    // The ai.md / collab.md "stub spec" shape, with a subtitle heading in front of it.
    const s = parse(
      "## A Subtitle",
      "---",
      "> **Status: Partial.** This is a stub spec.",
      "## 1. Overview",
      "> **Status: Implemented.**",
    );
    expect(s.preamble.map((m) => m.status)).toEqual(["Partial"]);
    expect(s.sections[0]?.status).toBe("Implemented");
    const [item] = openItems(s);
    expect(item).toMatchObject({ form: "preamble", status: "Partial", leading: true, line: 9 });
    expect(item?.anchor).toBeUndefined();
  });

  test("a deeper unnumbered heading stays inside its numbered section", () => {
    const s = parse(
      "### 11.4 Server Timing",
      "#### Security Boundary",
      "> **Status: Partial.** dev boundary",
      "##### Deeper still",
      "> **Status: Pending.** later",
    );
    expect(s.sections[0]?.markers.map((m) => m.status)).toEqual(["Partial", "Pending"]);
  });

  test("an unnumbered heading at the same depth ends the numbered section", () => {
    const s = parse(
      "## 12. Build",
      "### 12.3 Incremental",
      "> **Status: Pending.**",
      "### Notes",
      "> **Status: Implemented.**",
    );
    const [twelve, twelveThree] = s.sections;
    expect(twelveThree?.markers.map((m) => m.status)).toEqual(["Pending"]);
    expect(twelve?.markers.map((m) => m.status)).toEqual(["Implemented"]);
  });

  test("a marker under an unnumbered top-level heading after §1 is an orphan", () => {
    const s = parse("## 1. A", "## Appendix C: Things", "> **Status: Partial.**");
    expect(s.sections[0]?.markers).toEqual([]);
    expect(s.badForms[0]?.reason).toContain("belongs to no numbered section");
  });

  test("headings, markers and cells inside a fence describe nothing", () => {
    // The standards.md §4.4 worked example is a fenced table carrying `**Pending**`.
    const s = parse(
      "## 4. Examples",
      "```markdown",
      "## 9. Not A Section",
      "> **Status: Partial.**",
      "| Std | **Pending** | §5 |",
      "```",
    );
    expect(s.sections.map((x) => x.anchor)).toEqual(["4"]);
    expect(s.sections[0]?.markers).toEqual([]);
  });

  test("nothing after `## Changelog` is scanned as body", () => {
    const s = parseSpecSource(
      `${spec("## 1. A")}\n- **0.0.9-draft** (2025-12-31) — > **Status: Partial.**`,
      "x.md",
    );
    expect(s.sections[0]?.markers).toEqual([]);
    expect(s.changelog).toHaveLength(2);
  });

  test("depth is recorded, and roadmap headings are found numbered or not", () => {
    const s = parse("## 11. Implementation Roadmap", "### 11.1 X", "## Appendix C: Roadmap");
    expect(s.sections.map((x) => x.depth)).toEqual([2, 3]);
    expect(s.roadmaps).toMatchObject([
      { title: "11. Implementation Roadmap", anchor: "11" },
      { title: "Appendix C: Roadmap", anchor: undefined },
    ]);
  });
});

describe("status cells", () => {
  test("a cell that opens with a bold status word is a marker", () => {
    // The compiler.md §10 shape: no blockquote at all, every status in the table.
    const s = parse(
      "## 10. Pending Features",
      "| Feature | Status |",
      "| --- | --- |",
      "| Layouts | **Implemented** via `site-build` |",
      "| Islands | **Pending** |",
    );
    expect(s.sections[0]?.status).toBeUndefined();
    expect(s.sections[0]?.markers).toMatchObject([
      { status: "Implemented", form: "cell" },
      { status: "Pending", form: "cell", line: 11 },
    ]);
    // Built and unbuilt rows side by side: the section is Partial, not Pending.
    expect(openItems(s)).toMatchObject([{ anchor: "10", status: "Partial", form: "cell" }]);
  });

  test("a section is Pending only when every marker in it is", () => {
    const s = parse("## 10. F", "| A | **Pending** |", "| B | **Pending** — later |");
    expect(openItems(s)[0]?.status).toBe("Pending");
  });

  test("a leading open blockquote names the section's status", () => {
    const s = parse("## 4. X", "> **Status: Pending.**", "| A | **Implemented** |");
    expect(openItems(s)[0]).toMatchObject({ status: "Pending", leading: true, form: "blockquote" });
  });

  test("a status word mid-cell is prose", () => {
    const s = parse("## 12. F", "| Media | Six rows were marked **Pending** long after |");
    expect(s.sections[0]?.markers).toEqual([]);
  });

  test("an escaped pipe does not split a cell", () => {
    const s = parse("## 12. F", "| `a \\| b` | **Pending** |");
    expect(s.sections[0]?.markers).toMatchObject([{ status: "Pending" }]);
  });

  test("Standards Alignment and Adoption Backlog tables use Pending as a conformance class", () => {
    const s = parse(
      "## 18. Standards Alignment",
      "| [MQ5](https://x) | **Pending** | §5 | — | `gap:x` y |",
      "## 11. Adoption Backlog",
      "| Std | **Pending** |",
    );
    expect(s.sections.flatMap((x) => x.markers)).toEqual([]);
  });
});

describe("the parser against the committed specs", () => {
  const specs = parseSpecStatuses("specs");

  test("`status` is still exactly the first blockquote marker under each numbered heading", () => {
    /*
     * An independent walk with the pre-hardening algorithm. `status` is what the standards tiers
     * and the implementation-status page read, so hardening the parser must not move it.
     */
    const NUMBERED = /^#{2,6}\s+(\d+(?:\.\d+)*[a-z]?)\\?\.?\s+/;
    const MARKER = /^>\s*\*\*Status:\s*(Implemented|Partial|Pending|Future|Removed)\b/;
    const drift: string[] = [];
    for (const parsed of specs) {
      const expected = new Map<string, string | undefined>();
      let current: string | null = null;
      for (const line of readFileSync(join("specs", parsed.file), "utf8").split("\n")) {
        if (/^##\s+Changelog\s*$/.test(line)) {
          break;
        }
        const heading = line.match(NUMBERED);
        if (heading) {
          current = heading[1]!;
          expected.set(current, undefined);
        }
        const marker = line.match(MARKER);
        if (marker && current && expected.get(current) === undefined) {
          expected.set(current, marker[1]);
        }
      }
      for (const section of parsed.sections) {
        if (expected.get(section.anchor) !== section.status) {
          drift.push(
            `${parsed.file} §${section.anchor}: ${expected.get(section.anchor)} → ${section.status}`,
          );
        }
      }
    }
    expect(drift).toEqual([]);
  });

  test("no committed spec carries a malformed or orphaned marker", () => {
    expect(specs.flatMap((s) => s.badForms.map((b) => `${s.file}:${b.line} ${b.reason}`))).toEqual(
      [],
    );
  });
});
