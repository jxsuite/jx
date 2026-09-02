import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { collectSources, report, surfacePurityFindings } from "../scripts/check-surface-purity";

const KIT = ["jx-icon", "jx-menu"];

describe("surface purity", () => {
  test("a Spectrum tag in a surface document is a finding", () => {
    const findings = surfacePurityFindings(
      [
        {
          path: "src/surfaces/menu.json",
          text: '{\n  "tagName": "div",\n  "children": [{ "tagName": "sp-menu" }]\n}',
        },
      ],
      KIT,
    );
    expect(findings).toEqual([
      { file: "src/surfaces/menu.json", line: 3, text: expect.stringContaining("Spectrum") },
    ]);
  });

  test("a kit tag inside a lit template is a finding; a Studio-owned jx- element is not", () => {
    const findings = surfacePurityFindings(
      [
        {
          path: "src/panels/toolbar.ts",
          text: 'const t = html`<div><jx-icon name="plus"></jx-icon><jx-value-selector></jx-value-selector></div>`;',
        },
      ],
      KIT,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]!.text).toContain("<jx-icon>");
    expect(findings[0]!.file).toBe("src/panels/toolbar.ts");
  });

  test("an adapter importing lit is a finding; any other module may", () => {
    const adapter = { path: "src/surfaces/menu.ts", text: 'import { html } from "lit-html";\n' };
    const panel = { path: "src/panels/x.ts", text: 'import { html } from "lit-html";\n' };
    expect(surfacePurityFindings([adapter], KIT).map((f) => f.text)).toEqual([
      expect.stringContaining("adapter imports lit"),
    ]);
    expect(surfacePurityFindings([panel], KIT)).toEqual([]);
  });

  test("files outside src, tests, and clean sources yield nothing", () => {
    expect(
      surfacePurityFindings(
        [
          { path: "tests/x.test.ts", text: "html`<jx-icon>`" },
          { path: "src/surfaces/clean.json", text: '{ "tagName": "jx-icon" }' },
          { path: "src/surfaces/clean.ts", text: 'import { mountSurface } from "../ui/surface";' },
        ],
        KIT,
      ),
    ).toEqual([]);
  });

  test("the package is clean today", () => {
    const root = resolve(import.meta.dir, "..");
    const sources = collectSources(root);
    expect(sources.length).toBeGreaterThan(100);
    expect(surfacePurityFindings(sources)).toEqual([]);
  });

  test("the report names each finding by path and line, and is green with none", () => {
    const root = resolve(import.meta.dir, "..");
    const red = report(
      [
        {
          file: "src/surfaces/x.json",
          line: 3,
          text: "a surface document renders a Spectrum element",
        },
      ],
      root,
    );
    expect(red.failed).toBe(true);
    expect(red.lines[0]).toContain("1 finding(s)");
    expect(red.lines[1]).toContain("src/surfaces/x.json:3");
    const green = report([], root);
    expect(green.failed).toBe(false);
    expect(green.lines.join("\n")).toContain("no Spectrum tag in a surface document");
  });
});
