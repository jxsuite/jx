import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  collectSources,
  report,
  runCli,
  surfacePurityFindings,
} from "../scripts/check-surface-purity";

const KIT = ["jx-icon", "jx-menu"];

describe("surface purity", () => {
  test("a Spectrum tag in a surface document is NOT this gate's finding any more", () => {
    /* It was, and the rule is retired rather than kept as a matcher over a dead string: two gates
       cover it between them and in both directions. `check-styles.ts` bans `sp-` anywhere in the
       package with an empty allow-list, and `check-icons.ts` fails on a `"tagName": "jx-*"` the kit
       will not define — the general form of the question this rule only ever asked about one
       library. Deleting the assertion outright would leave nothing saying the coverage moved. */
    expect(
      surfacePurityFindings(
        [
          {
            path: "src/surfaces/menu.json",
            text: '{\n  "tagName": "div",\n  "children": [{ "tagName": "sp-menu" }]\n}',
          },
        ],
        KIT,
      ),
    ).toEqual([]);
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

  test("the CLI prints the report and hands back an exit code", () => {
    /* The entry point is a function returning the code rather than a `process.exit` inside
       `import.meta.main`, for the reason check-icons.ts and check-styles.ts give at theirs: one is
       runnable from a test and the other is not. This is what asserts it stayed that way. */
    const logs: string[] = [];
    const real = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      expect(runCli(resolve(import.meta.dir, ".."))).toBe(0);
    } finally {
      console.log = real;
    }
    expect(logs.join("\n")).toContain("no kit tag in a lit template");
  });

  test("the CLI returns 1 over a tree that is not pure, and says why", () => {
    const dir = join(tmpdir(), `jx-purity-cli-${process.pid}`);
    mkdirSync(join(dir, "src", "surfaces"), { recursive: true });
    writeFileSync(join(dir, "src", "surfaces", "bad.ts"), 'import { html } from "lit-html";\n');
    const logs: string[] = [];
    const real = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      expect(runCli(dir)).toBe(1);
    } finally {
      console.log = real;
      rmSync(dir, { force: true, recursive: true });
    }
    expect(logs.join("\n")).toContain("adapter imports lit");
  });

  test("the report names each finding by path and line, and is green with none", () => {
    const root = resolve(import.meta.dir, "..");
    const red = report(
      [
        {
          file: "src/panels/x.ts",
          line: 3,
          text: "a lit template renders the kit element <jx-icon>",
        },
      ],
      root,
    );
    expect(red.failed).toBe(true);
    expect(red.lines[0]).toContain("1 finding(s)");
    expect(red.lines[1]).toContain("src/panels/x.ts:3");
    const green = report([], root);
    expect(green.failed).toBe(false);
    expect(green.lines.join("\n")).toContain("no kit tag in a lit template");
  });
});
