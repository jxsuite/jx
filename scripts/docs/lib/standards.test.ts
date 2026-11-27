/**
 * Parser tests for the `## N. Standards Alignment` tables.
 *
 * Fixtures are inline strings, because the parser's job is to read markdown that does not exist in
 * the repo yet. The one exception is the determinism pair at the bottom, which runs against the
 * real `specs/` — a generated page must not depend on iteration order, so two builds agree byte for
 * byte.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  buildRegistry,
  canonicalUrlProblem,
  compareIds,
  GAP_TIER_BY_STATUS,
  isConformance,
  isOrg,
  numberedIdForm,
  ORGS,
  orgOfId,
  orgOfUrl,
  parseStandardsSource,
  splitRow,
  STANDARD_ID,
  tierOf,
  urlKey,
  urlNumberProblem,
} from "./standards.ts";
import type { Org } from "./standards.ts";
import { parseSpecSource, STATUS_VOCAB } from "./spec-status.ts";
import { HEADER } from "../test-fixtures.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const SPECS_DIR = resolve(ROOT, "specs");
const CATALOG = resolve(ROOT, "scripts/docs/standards.json");

function spec(body: string): string {
  return `# Fixture Specification\n\n## 1. Overview\n\n> **Status: Partial.** …\n\n## 2. Later\n\n${body}\n\n## Changelog\n\n- **0.1.0-draft** (2026-01-01) — x.\n`;
}

describe("section discovery", () => {
  test("finds a numbered Standards Alignment section", () => {
    const r = parseStandardsSource(spec(`## 3. Standards Alignment\n\n${HEADER}`), "f.md");
    expect(r.section?.anchor).toBe("3");
    expect(r.section?.depth).toBe(2);
    expect(r.sectionCount).toBe(1);
  });

  test("finds it at subsection depth", () => {
    const r = parseStandardsSource(spec(`### 2.5 Standards Alignment\n\n${HEADER}`), "f.md");
    expect(r.section?.anchor).toBe("2.5");
    expect(r.section?.depth).toBe(3);
  });

  test("stops at the next heading of equal or shallower depth", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | **Adopted** | §1 | a.ts | — |\n\n## 4. Other\n\n${HEADER}\n| [RFC 2](https://x/) | **Adopted** | §1 | a.ts | — |`,
    );
    const r = parseStandardsSource(src, "f.md");
    expect(r.rows.map((x) => x.id)).toEqual(["RFC 1"]);
  });

  test("stops at ## Changelog", () => {
    const r = parseStandardsSource(
      `## 3. Standards Alignment\n\n${HEADER}\n\n## Changelog\n\n| [RFC 9](https://x/) | **Adopted** | §1 | a.ts | — |\n`,
      "f.md",
    );
    expect(r.rows).toEqual([]);
  });

  /*
   * THE REGRESSION TEST FOR THE APPENDIX TRAP. An unnumbered heading is invisible to
   * check-doc-refs.ts and spec-status.ts alike, so it is not an anchor, it never reaches
   * implementation-status.md, and a `> **Status:**` under it is credited to the last NUMBERED
   * section above it. If this test is ever deleted, that whole class of silence comes back.
   */
  test("an unnumbered 'Standards Alignment' heading is recorded as the trap, not as the section", () => {
    const r = parseStandardsSource(
      spec(`## Appendix D — Standards Alignment\n\n${HEADER}`),
      "f.md",
    );
    expect(r.section).toBeUndefined();
    expect(r.unnumberedHeadingLine).toBeGreaterThan(0);
  });

  test("a plain unnumbered heading is caught too", () => {
    const r = parseStandardsSource(spec(`## Standards Alignment\n\n${HEADER}`), "f.md");
    expect(r.section).toBeUndefined();
    expect(r.unnumberedHeadingLine).toBeGreaterThan(0);
  });

  test("counts duplicates so the checker can report them", () => {
    const r = parseStandardsSource(
      spec(`## 3. Standards Alignment\n\n${HEADER}\n\n### 3.1 Standards Alignment\n\n${HEADER}`),
      "f.md",
    );
    expect(r.sectionCount).toBe(2);
  });
});

describe("fenced examples are not rows", () => {
  test("a table inside a fence produces no rows", () => {
    const src = spec(
      "## 3. Standards Alignment\n\n```markdown\n" +
        `${HEADER}\n| [RFC 1](https://x/) | **Adopted** | §1 | a.ts | — |\n` +
        "```\n\n" +
        `${HEADER}\n| [RFC 2](https://x/) | **Adopted** | §1 | a.ts | — |`,
    );
    const r = parseStandardsSource(src, "f.md");
    expect(r.rows.map((x) => x.id)).toEqual(["RFC 2"]);
  });
});

describe("cells", () => {
  test("oxfmt padding is trimmed away", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n|  [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)   |  **Adopted**   |  §7.1   |  a.ts   |  —   |`,
    );
    const row = parseStandardsSource(src, "f.md").rows[0]!;
    expect(row.id).toBe("RFC 6901");
    expect(row.url).toBe("https://www.rfc-editor.org/rfc/rfc6901");
    expect(row.conformance).toBe("Adopted");
    expect(row.binds).toEqual(["§7.1"]);
    expect(row.evidence).toEqual(["a.ts"]);
    expect(row.note).toBe("");
  });

  test("multiple binds and multiple evidence paths split on comma", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | **Subset** | §7, §19.4a | a.ts, b.ts | Partly. |`,
    );
    const row = parseStandardsSource(src, "f.md").rows[0]!;
    expect(row.binds).toEqual(["§7", "§19.4a"]);
    expect(row.evidence).toEqual(["a.ts", "b.ts"]);
    expect(row.note).toBe("Partly.");
  });

  test("the em-dash sentinel means empty", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | **Pending** | §1 | — | \`gap:a-b\` Not built. |`,
    );
    const row = parseStandardsSource(src, "f.md").rows[0]!;
    expect(row.evidence).toEqual([]);
    expect(row.gapId).toBe("a-b");
    expect(row.gapText).toBe("Not built.");
  });

  test("a rejection note is extracted", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | **Rejected** | §1 | — | because: the producer already escapes newlines. |`,
    );
    const row = parseStandardsSource(src, "f.md").rows[0]!;
    expect(row.rejection).toBe("the producer already escapes newlines.");
  });

  test("an off-vocabulary class leaves conformance undefined", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | **Mostly** | §1 | a.ts | — |`,
    );
    const row = parseStandardsSource(src, "f.md").rows[0]!;
    expect(row.conformance).toBeUndefined();
    expect(row.rawClass).toBe("**Mostly**");
  });

  test("splitRow rejects a non-row and splits a row", () => {
    expect(splitRow("not a row")).toBeNull();
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
  });
});

describe("legacy forms", () => {
  /*
   * The two parsers must not disagree about the same line. `spec-status.ts` already rejects a bare
   * `Planned` table cell, with a message about an unrelated subsystem; if this table format ever
   * admitted one, an author would be told the wrong thing by the wrong checker.
   */
  test("a bare Planned cell is a bad form to BOTH parsers", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://x/) | Planned | §1 | — | x |`,
    );
    expect(parseStandardsSource(src, "f.md").badForms.length).toBeGreaterThan(0);
    expect(parseSpecSource(src, "f.md").badForms.length).toBeGreaterThan(0);
  });

  test("a retired IETF URL names its replacement", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [RFC 1](https://tools.ietf.org/html/rfc1) | **Adopted** | §1 | a.ts | — |`,
    );
    const bad = parseStandardsSource(src, "f.md").badForms;
    expect(bad[0]?.reason).toContain("rfc-editor.org");
  });

  test("a dated W3C snapshot is rejected", () => {
    const src = spec(
      `## 3. Standards Alignment\n\n${HEADER}\n| [CSP3](https://www.w3.org/TR/2021/WD-CSP3/) | **Adopted** | §1 | a.ts | — |`,
    );
    expect(parseStandardsSource(src, "f.md").badForms.length).toBeGreaterThan(0);
  });
});

describe("status marker and stray content", () => {
  test("a status marker on the section is recorded", () => {
    const r = parseStandardsSource(
      spec(`## 3. Standards Alignment\n\n> **Status: Pending.** …\n\n${HEADER}`),
      "f.md",
    );
    expect(r.hasSectionStatusMarker).toBe(true);
  });

  test("prose before the table is fine; prose after it is stray", () => {
    const before = parseStandardsSource(
      spec(`## 3. Standards Alignment\n\nA sentence.\n\n${HEADER}`),
      "f.md",
    );
    expect(before.strayLines).toEqual([]);
    const after = parseStandardsSource(
      spec(`## 3. Standards Alignment\n\n${HEADER}\n\nA trailing sentence.`),
      "f.md",
    );
    expect(after.strayLines.length).toBe(1);
  });
});

describe("pure helpers", () => {
  test("orgOfId infers the issuing body from the identifier", () => {
    expect(orgOfId("RFC 9110")).toBe("IETF");
    expect(orgOfId("BCP 47")).toBe("IETF");
    expect(orgOfId("STD 90")).toBe("IETF");
    expect(orgOfId("UAX #15")).toBe("Unicode");
    expect(orgOfId("UTS #46")).toBe("Unicode");
    expect(orgOfId("ECMA-402")).toBe("Ecma");
    expect(orgOfId("ISO/IEC 8859-1")).toBe("ISO");
    expect(orgOfId("WebAuthn Level 3")).toBeNull();
  });

  test("a hyphenated or dotted name is a valid identifier", () => {
    // WAI-ARIA and JSON-LD carry a hyphen in their FIRST token; Schema.org a dot.
    for (const id of ["WAI-ARIA", "JSON-LD 1.1", "WCAG 2.2", "ATAG 2.0", "Schema.org"]) {
      expect(STANDARD_ID.test(id), `${id} should be a valid identifier`).toBe(true);
    }
    for (const id of [".org", "schema.org"]) {
      expect(STANDARD_ID.test(id), `${id} should be rejected`).toBe(false);
    }
  });

  test("canonicalUrlProblem accepts the canonical form and rejects the rest", () => {
    expect(canonicalUrlProblem("IETF", "https://www.rfc-editor.org/rfc/rfc9110")).toBeNull();
    expect(canonicalUrlProblem("IETF", "https://www.rfc-editor.org/info/bcp47")).toBeNull();
    expect(
      canonicalUrlProblem("IETF", "https://datatracker.ietf.org/doc/html/rfc9110"),
    ).not.toBeNull();
    expect(canonicalUrlProblem("W3C", "https://www.w3.org/TR/wcag22/")).toBeNull();
    // W3C shortnames carry a version dot — accname-1.2, wai-aria-1.2.
    expect(canonicalUrlProblem("W3C", "https://www.w3.org/TR/accname-1.2/")).toBeNull();
    expect(
      canonicalUrlProblem("W3C", "https://www.w3.org/TR/2023/REC-wcag22-20231005/"),
    ).not.toBeNull();
    expect(canonicalUrlProblem("Unicode", "https://www.unicode.org/reports/tr15/")).toBeNull();
    expect(canonicalUrlProblem("WHATWG", "https://dom.spec.whatwg.org/")).toBeNull();
    expect(
      canonicalUrlProblem("WHATWG", "https://html.spec.whatwg.org/#the-template-element"),
    ).not.toBeNull();
    const registry = "https://www.iana.org/assignments/iana-ipv4-special-registry";
    expect(canonicalUrlProblem("IANA", registry)).toBeNull();
    expect(canonicalUrlProblem("IANA", `${registry}/`)).not.toBeNull();
    const draft = "https://json-schema.org/draft/2020-12/schema";
    expect(canonicalUrlProblem("JSON Schema", draft)).toBeNull();
    for (const url of [
      `${draft}/`,
      "https://json-schema.org/draft/2020-12",
      "https://json-schema.org/understanding-json-schema/",
    ]) {
      expect(canonicalUrlProblem("JSON Schema", url), url).not.toBeNull();
    }
    for (const url of [
      "https://spec.commonmark.org/current/",
      "https://git-scm.com/docs/gitignore",
    ]) {
      expect(canonicalUrlProblem("Other", url), url).toBeNull();
    }
    for (const url of [
      "https://spec.commonmark.org/current/?v=1",
      "https://spec.commonmark.org/current/#tabs",
      "http://spec.commonmark.org/current/",
      "https://spec.commonmark.org:8443/current/",
      "https://spec.commonmark.org",
      "https://anything/",
    ]) {
      expect(canonicalUrlProblem("Other", url), url).not.toBeNull();
    }
    // SAFETY: the catalog is untyped JSON, so a body outside the union is what this probes.
    expect(canonicalUrlProblem("Git" as Org, "https://git-scm.com/docs/gitignore")).not.toBeNull();
  });

  test("every declared body has a canonical form, and none admits a query or a fragment", () => {
    const EXAMPLE: Record<Org, string> = {
      IETF: "https://www.rfc-editor.org/rfc/rfc9110",
      W3C: "https://www.w3.org/TR/wcag22/",
      WHATWG: "https://dom.spec.whatwg.org/",
      Unicode: "https://www.unicode.org/reports/tr15/",
      Ecma: "https://ecma-international.org/publications-and-standards/standards/ecma-262/",
      IANA: "https://www.iana.org/assignments/media-types",
      ISO: "https://www.iso.org/standard/12345.html",
      "JSON Schema": "https://json-schema.org/draft/2020-12/schema",
      Other: "https://spec.commonmark.org/current/",
    };
    expect(Object.keys(EXAMPLE).toSorted()).toEqual([...ORGS].toSorted());
    for (const org of ORGS) {
      expect(canonicalUrlProblem(org, EXAMPLE[org]), org).toBeNull();
      expect(canonicalUrlProblem(org, `${EXAMPLE[org]}?q=1`), `${org} query`).not.toBeNull();
      expect(canonicalUrlProblem(org, `${EXAMPLE[org]}#f`), `${org} fragment`).not.toBeNull();
    }
  });

  test("orgOfUrl infers the body from a recognized domain", () => {
    expect(orgOfUrl("https://www.rfc-editor.org/rfc/rfc9110")).toBe("IETF");
    expect(orgOfUrl("https://datatracker.ietf.org/doc/html/rfc9110")).toBe("IETF");
    expect(orgOfUrl("https://dom.spec.whatwg.org/")).toBe("WHATWG");
    expect(orgOfUrl("https://www.w3.org/TR/css-contain-3/")).toBe("W3C");
    expect(orgOfUrl("https://json-schema.org/draft/2020-12/schema")).toBe("JSON Schema");
    expect(orgOfUrl("https://spec.commonmark.org/current/")).toBeNull();
    expect(orgOfUrl("https://notw3.org/")).toBeNull();
    expect(orgOfUrl("not a url")).toBeNull();
  });

  test("numberedIdForm and urlNumberProblem agree with orgOfId", () => {
    for (const org of ["IETF", "Unicode", "Ecma", "ISO"] as const) {
      expect(numberedIdForm(org), org).not.toBeNull();
    }
    for (const org of ["W3C", "WHATWG", "IANA", "JSON Schema", "Other"] as const) {
      expect(numberedIdForm(org), org).toBeNull();
    }
    const rfc = "https://www.rfc-editor.org";
    expect(urlNumberProblem("IETF", "RFC 9110", `${rfc}/rfc/rfc9110`)).toBeNull();
    expect(urlNumberProblem("IETF", "BCP 47", `${rfc}/info/bcp47`)).toBeNull();
    expect(
      urlNumberProblem("Unicode", "UAX #9", "https://www.unicode.org/reports/tr9/"),
    ).toBeNull();
    expect(
      urlNumberProblem(
        "Ecma",
        "ECMA-262",
        "https://ecma-international.org/publications-and-standards/standards/ecma-262/",
      ),
    ).toBeNull();
    expect(
      urlNumberProblem("ISO", "ISO 8601", "https://www.iso.org/standard/70907.html"),
    ).toBeNull();
    expect(urlNumberProblem("IETF", "RFC 9110", "https://www.w3.org/TR/x/")).toBeNull();
    expect(urlNumberProblem("IETF", "RFC 9110", `${rfc}/rfc/rfc9111`)).not.toBeNull();
    expect(urlNumberProblem("IETF", "BCP 47", `${rfc}/info/std47`)).not.toBeNull();
    expect(
      urlNumberProblem("Unicode", "UAX #15", "https://www.unicode.org/reports/tr29/"),
    ).not.toBeNull();
  });

  test("urlKey folds a trailing slash and case only", () => {
    expect(urlKey("https://Spec.CommonMark.org/current/")).toBe(
      urlKey("https://spec.commonmark.org/current"),
    );
    expect(urlKey("https://www.w3.org/TR/WCAG22/")).toBe(urlKey("https://www.w3.org/TR/wcag22/"));
    expect(urlKey("https://spec.commonmark.org/current/")).not.toBe(
      urlKey("https://spec.commonmark.org/current/x"),
    );
    expect(urlKey("not a url")).toBe("not a url");
  });

  test("isOrg knows the bodies", () => {
    expect(isOrg("Other")).toBe(true);
    expect(isOrg("Git")).toBe(false);
  });

  test("tierOf maps only the unbuilt statuses", () => {
    expect(tierOf("Partial")).toBe("Near");
    expect(tierOf("Pending")).toBe("Next");
    expect(tierOf("Future")).toBe("Later");
    expect(tierOf("Implemented")).toBeNull();
    expect(tierOf("Removed")).toBeNull();
    // A section with no status marker has no tier.
    const [unmarked] = parseSpecSource("## 1. Overview\n\nProse.\n", "x.md").sections;
    expect(unmarked?.title).toBe("Overview");
    expect(unmarked?.status).toBeUndefined();
    expect(tierOf(unmarked?.status)).toBeNull();
  });

  /*
   * The tier table is keyed by the status vocabulary. If a status is ever renamed, this reds here
   * rather than silently dropping a tier from the generated gap list.
   */
  test("every tier key is in the status vocabulary", () => {
    for (const key of Object.keys(GAP_TIER_BY_STATUS)) {
      expect<readonly string[]>(STATUS_VOCAB).toContain(key);
    }
  });

  test("isConformance knows the vocabulary", () => {
    expect(isConformance("Adopted")).toBe(true);
    expect(isConformance("Planned")).toBe(false);
  });

  test("compareIds is codepoint order, not locale order", () => {
    expect(compareIds("RFC 2", "RFC 10")).toBeGreaterThan(0);
    expect(compareIds("BCP 14", "RFC 3986")).toBeLessThan(0);
  });
});

describe("source hygiene", () => {
  /*
   * A NUL byte in a source file is invisible to the formatter and the linter, survives every
   * gate, and makes ripgrep treat the file as binary — which is how the first one was found.
   * Two had crept in through scripted edits before this test existed.
   */
  test("no script or spec source contains a NUL byte", async () => {
    const files = [
      ...new Bun.Glob("scripts/**/*.ts").scanSync(ROOT),
      ...new Bun.Glob("specs/*.md").scanSync(ROOT),
    ];
    const offenders: string[] = [];
    for (const rel of files) {
      const bytes = await Bun.file(resolve(ROOT, rel)).bytes();
      if (bytes.includes(0)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("determinism against the real specs", () => {
  test("buildRegistry returns identical data twice", () => {
    const a = buildRegistry(SPECS_DIR, CATALOG);
    const b = buildRegistry(SPECS_DIR, CATALOG);
    expect(a.rows).toEqual(b.rows);
    expect(a.specs.map((s) => s.file)).toEqual(b.specs.map((s) => s.file));
    expect(a.catalogOrder).toEqual(b.catalogOrder);
  });

  test("specs are sorted by filename", () => {
    const reg = buildRegistry(SPECS_DIR, CATALOG);
    expect(reg.specs.map((s) => s.file)).toEqual(reg.specs.map((s) => s.file).toSorted());
  });
});
