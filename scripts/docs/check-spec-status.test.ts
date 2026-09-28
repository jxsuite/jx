/**
 * `docs:status`: the header, vocabulary and changelog rules, and the one rule that keeps a
 * graduated spec honest — an Implemented header admits nothing unbuilt anywhere below it.
 */

import { describe, expect, test } from "bun:test";

import { checkSpecStatus, specStatusViolations } from "./check-spec-status.ts";
import { parseSpecSource } from "./lib/spec-status.ts";

function spec(status: string, version: string, ...body: string[]): string {
  return [
    "# X",
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

const violations = (source: string) => specStatusViolations(parseSpecSource(source, "x.md"));

describe("an Implemented header", () => {
  test("passes with every section Implemented", () => {
    expect(
      violations(spec("Implemented", "0.2.0", "## 1. A", "> **Status: Implemented.**")),
    ).toEqual([]);
  });

  test("passes with a Future remainder: deferred is not unbuilt", () => {
    const source = spec(
      "Implemented",
      "0.2.0",
      "## 6. Scope",
      "> **Status: Implemented.** The interpreter.",
      "> **Status: Future.** A restricted evaluator.",
    );
    expect(violations(source)).toEqual([]);
  });

  test("fails on a Partial status cell in a section that leads with Implemented", () => {
    const source = spec(
      "Implemented",
      "0.2.0",
      "## 11. Prototypes",
      "> **Status: Implemented.**",
      "| Blob | **Implemented** |",
      "| ReadableStream | **Pending** — stub |",
    );
    expect(violations(source)).toEqual([
      "specs/x.md: 10: header **Status:** is Implemented, but §11 is Partial (cell) — a spec is Implemented only when none of its items is Partial or Pending",
    ]);
  });

  test("fails on a whole-spec Partial above the first numbered section", () => {
    const source = spec("Implemented", "0.2.0", "> **Status: Partial.** A stub.", "## 1. A");
    expect(violations(source)[0]).toContain("the preamble above §1 is Partial (preamble)");
  });

  test("a Partial header may carry open items", () => {
    const source = spec("Partial", "0.2.0-draft", "## 1. A", "> **Status: Partial.**");
    expect(violations(source)).toEqual([]);
  });
});

describe("marker forms", () => {
  test("the colon-outside form is reported with the canonical form to write", () => {
    const [v] = violations(spec("Partial", "0.2.0-draft", "## 1. A", "> **Status:** Implemented"));
    expect(v).toContain("write `> **Status: X.**`");
  });
});

describe("the -draft suffix", () => {
  test("follows the header status both ways", () => {
    expect(violations(spec("Implemented", "0.2.0-draft"))[0]).toContain("must drop the -draft");
    expect(violations(spec("Partial", "0.2.0"))[0]).toContain("must carry the -draft");
  });
});

describe("the committed specs", () => {
  test("are green", () => {
    expect(checkSpecStatus("specs").violations).toEqual([]);
  });
});
