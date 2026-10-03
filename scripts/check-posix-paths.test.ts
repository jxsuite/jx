import { describe, expect, test } from "bun:test";
import { findingsIn, report, scanRepo } from "./check-posix-paths.ts";

describe("findingsIn", () => {
  test("flags a raw glob-scan result compared unwrapped", () => {
    const source = `
      for (const rel of new Bun.Glob("**/*.json").scanSync(root)) {
        if (rel.endsWith("/statusbar.json")) continue;
      }
    `;
    const findings = findingsIn("fixture.ts", source);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: "fixture.ts", variable: "rel" });
  });

  test("does not flag a variable wrapped at every use", () => {
    const source = `
      for (const rawRel of new Bun.Glob("**/*.json").scanSync(root)) {
        if (toPosixPath(rawRel).endsWith("/statusbar.json")) continue;
        used.add(toPosixPath(rawRel));
      }
    `;
    expect(findingsIn("fixture.ts", source)).toEqual([]);
  });

  test("does not flag a variable renamed once via toPosixPath and used only by its new name", () => {
    const source = `
      for (const rawRel of new Bun.Glob("**/*.json").scanSync(root)) {
        const rel = toPosixPath(rawRel);
        if (rel.endsWith("/statusbar.json")) continue;
        used.add(rel);
      }
    `;
    expect(findingsIn("fixture.ts", source)).toEqual([]);
  });

  test("recognizes a package-local toPosix() name too, not only toPosixPath()", () => {
    // `packages/desktop/src/project-session.ts` predates the shared helper and keeps its own
    // `toPosix()` — the check must not force every caller onto one literal function name.
    const source = `
      for (const rawMatch of glob.scan(root)) {
        const match = toPosix(rawMatch);
        used.push(match);
      }
    `;
    expect(findingsIn("fixture.ts", source)).toEqual([]);
  });

  test("a `.scan(`-named method unrelated to Bun.Glob still gets the same treatment", () => {
    /* The check is textual, not semantic: it cannot tell a Bun.Glob from an unrelated `.scan(`
       method by name alone. That's an accepted, documented trade-off (this file's own module
       comment) rather than a bug — a false positive here is a one-line `toPosixPath` wrap, and a
       false negative (missing a real glob call) is the failure mode that actually ships bugs. */
    const source = `
      for (const hit of scanner.scan(query)) {
        results.push(hit);
      }
    `;
    expect(findingsIn("fixture.ts", source)).toHaveLength(1);
  });

  test("a loop with no body braces (a single-statement loop) is skipped rather than crashing", () => {
    const source = `for (const rel of glob.scanSync(root)) use(rel);`;
    expect(() => findingsIn("fixture.ts", source)).not.toThrow();
  });

  test("multiple loops in one file are each checked independently", () => {
    const source = `
      for (const a of g1.scanSync(root)) {
        ok.add(toPosixPath(a));
      }
      for (const b of g2.scanSync(root)) {
        bad.add(b);
      }
    `;
    const findings = findingsIn("fixture.ts", source);
    expect(findings.map((f) => f.variable)).toEqual(["b"]);
  });
});

describe("report", () => {
  test("is green with no findings", () => {
    expect(report([])).toEqual({
      failed: false,
      lines: ["✓ check-posix-paths: every glob-scan result is normalized before use"],
    });
  });

  test("names the file, line, and variable for each finding", () => {
    const { failed, lines } = report([{ file: "src/x.ts", line: 3, variable: "rel" }]);
    expect(failed).toBe(true);
    expect(lines[0]).toContain("1 finding(s)");
    expect(lines[1]).toContain("src/x.ts:3");
    expect(lines[1]).toContain("`rel`");
  });
});

describe("scanRepo — the real tree", () => {
  test("no tracked file lets a glob-scan result reach a comparison un-normalized", () => {
    // The gate proving itself against the codebase it actually protects, exactly as
    // `check-coverage-manifest.ts` and the other repo-root `scripts/**` checks do (AGENTS.md).
    const findings = scanRepo();
    if (findings.length > 0) {
      console.error(report(findings).lines.join("\n"));
    }
    expect(findings).toEqual([]);
  });
});
