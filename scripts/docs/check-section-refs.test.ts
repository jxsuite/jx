/**
 * `docs:section-refs`: a `§` citation in a workspace with a home spec resolves, bare or qualified,
 * and no circled region numeral survives the plan it numbered.
 */

import { describe, expect, test } from "bun:test";

import { checkSectionRefs, loadSectionRefsInput, specAnchors } from "./check-section-refs.ts";

const anchors = new Map([
  ["studio.md", new Set(["6", "6.7", "13", "13.3", "18", "18.1"])],
  ["studio-ui-guidelines.md", new Set(["12", "12.2", "12.5"])],
]);

const run = (text: string, path = "packages/studio/src/a.ts") =>
  checkSectionRefs({ files: [{ path, text }], anchors, homes: { "packages/studio": "studio.md" } });

describe("bare citations", () => {
  test("resolve in the workspace's home spec", () => {
    expect(run("// the multi-selection rule (§6.7)")).toEqual([]);
    expect(run("// the plan's old number (§6.5)")[0]?.message).toContain(
      "a bare §6.5 here means studio.md §6.5, which does not exist",
    );
  });

  test("a chain is judged link by link", () => {
    expect(run("// §13–§13.3 and §18.1")).toEqual([]);
    expect(run("// §13.3, §13.9")).toHaveLength(1);
  });

  test("files outside a workspace with a home spec are not judged", () => {
    expect(run("// §99.9", "packages/compiler/src/a.ts")).toEqual([]);
  });
});

describe("qualified citations", () => {
  test("resolve in the named spec, in every spelling", () => {
    for (const text of [
      "// studio-ui-guidelines.md §12.2",
      "// `studio-ui-guidelines.md` §12.5",
      "// specs/studio-ui-guidelines.md §12",
      "// see [studio-ui-guidelines.md](../../specs/studio-ui-guidelines.md) §12.2",
      "// (studio-ui-guidelines.md §12.2–§12.5)",
    ]) {
      expect(run(text)).toEqual([]);
    }
  });

  test("a qualified anchor that does not exist is reported against that spec", () => {
    expect(run("// studio-ui-guidelines.md §14.9")[0]?.message).toBe(
      "studio-ui-guidelines.md has no numbered section §14.9",
    );
  });

  test("a README or docs page is not a spec, and an external standard is not judged", () => {
    expect(run("// scripts/screenshots/README.md §9")).toEqual([]);
    expect(run("// RFC 9457 §3.1, HTML §4.10.5, WCAG 2.2 §1.4.3")).toEqual([]);
  });
});

describe("a citation the formatter split across lines", () => {
  test("takes its qualifier from the end of the line above", () => {
    expect(run(" * the chrome budget, studio-ui-guidelines.md\n * §12.2, caps the bar")).toEqual(
      [],
    );
    expect(run(" * the budget of studio-ui-guidelines.md\n * (§14.9)")[0]?.message).toBe(
      "studio-ui-guidelines.md has no numbered section §14.9",
    );
  });

  test("a § after real text on its own line does not look upward", () => {
    expect(run(" * see studio-ui-guidelines.md\n * and §6.5 here")).toHaveLength(1);
  });
});

describe("region numerals", () => {
  test("a circled numeral is refused, with the region's name as the fix", () => {
    expect(run("// ⑥ The jump bar")[0]?.message).toContain("name the region");
  });
});

describe("specAnchors", () => {
  test("reads numbered headings and stops at the changelog", () => {
    const source = "## 1. A\n### 1.2 B\n## Appendix\n## Changelog\n## 9. After";
    expect([...specAnchors(source)]).toEqual(["1", "1.2"]);
  });
});

describe("the committed tree", () => {
  test("every § citation in a workspace with a home spec resolves", () => {
    const violations = checkSectionRefs(loadSectionRefsInput());
    expect(violations.map((v) => `${v.path}:${v.line} ${v.message}`)).toEqual([]);
  });
});
