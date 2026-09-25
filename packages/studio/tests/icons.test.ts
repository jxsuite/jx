/**
 * Tests for scripts/check-icons.ts — the two key spaces, and the reason they are two.
 *
 * The first version of this checker treated a record's `icon:` string as a custom-element tag. It
 * is not: it is a key into a resolver map. That single conflation passed the gate on a Source
 * Control rail button rendering a 20px hole, so most of what is asserted here is the DISTINCTION.
 *
 * The tag half used to be `<sp-icon-*>` against the hand-written table in `src/ui/spectrum.ts`.
 * Spectrum is removed; a tag is now a `"tagName"` in a surface document, checked against `KIT_TAGS`
 * — the same question about the substrate that replaced it. Two things went with the old registry
 * rather than being re-aimed, and each is asserted here as an absence rather than left to be
 * noticed: the element-name/import rules (a kit element is defined from the document that names it,
 * so the tag and the class cannot disagree) and the `UNWRITTEN` allow-list (it existed because a
 * Spectrum component registered icons into its own shadow DOM).
 */

import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { KIT_TAGS } from "@jxsuite/ui";
import {
  checkIcons,
  iconKeysDeclared,
  iconProblems,
  kitTagsUsed,
  report,
  manifestNames,
} from "../scripts/check-icons";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const STUDIO = fileURLToPath(new URL("..", import.meta.url));

describe("check-icons", () => {
  test("the shipped tree is clean", () => {
    expect(checkIcons().problems).toEqual([]);
  });

  test("it actually read the tree — a walk that found nothing would pass every rule", () => {
    const { keyCount, tagCount } = checkIcons();
    expect(tagCount).toBeGreaterThan(10);
    expect(keyCount).toBeGreaterThan(3);
  });

  /*
   * The distinction, stated three ways. A `"tagName"` is a tag; an `icon:` string is a key; and on
   * the day both were spelled `sp-icon-x` that was the whole trap. They are spelled differently
   * now, which is a consequence of the migration rather than a reason to stop separating them.
   */
  describe("a tag is not a key", () => {
    test("a tag declared twice in one document is recorded once; in two, twice", () => {
      const dir = join(tmpdir(), `jx-icons-${process.pid}`);
      mkdirSync(join(dir, "surfaces", "nested"), { recursive: true });
      writeFileSync(
        join(dir, "surfaces", "a.json"),
        '{"tagName":"jx-icon","children":[{"tagName":"jx-icon"}]}',
      );
      writeFileSync(join(dir, "surfaces", "nested", "b.json"), '{"tagName":"jx-icon"}');
      try {
        const tags = kitTagsUsed(dir);
        expect(tags.get("jx-icon")).toEqual(["surfaces/a.json", "surfaces/nested/b.json"]);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test("only the tagName shape counts as a tag", () => {
      const dir = join(tmpdir(), `jx-icons-shape-${process.pid}`);
      mkdirSync(join(dir, "surfaces"), { recursive: true });
      /* A kit tag named in prose, in a selector and on an `icon:` key — none of which constructs an
         element. Reading any of them here is the conflation this file exists to prevent. */
      writeFileSync(
        join(dir, "surfaces", "a.json"),
        JSON.stringify({
          $description: "it draws a jx-swatch under the label",
          style: { "& jx-menu-item": { color: "red" } },
          icon: "jx-icon",
          tagName: "jx-button",
        }),
      );
      try {
        expect([...kitTagsUsed(dir).keys()]).toEqual(["jx-button"]);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    test("every panel key names a glyph the kit ships", () => {
      const keys = new Set(iconKeysDeclared(join(STUDIO, "src")).keys());
      const glyphs = manifestNames();
      expect([...keys].filter((k) => !glyphs.has(k))).toEqual([]);
    });

    test("a key is not a tag — `git-branch` is a glyph and no document declares it", () => {
      const tags = kitTagsUsed(join(STUDIO, "src"));
      expect(tags.has("git-branch")).toBe(false);
      expect(manifestNames()).toContain("git-branch");
    });

    test("only registerPanel keys are collected — a command's icon has a visible fallback", () => {
      const keys = iconKeysDeclared(join(STUDIO, "src"));
      expect(keys.has("git-branch")).toBe(true);
      // Declared on command records, which fall back to the title. Sweeping those in is what let
      // The first version report 83 icons "all registered" with three rail buttons drawing nothing.
      expect(keys.has("arrow-up")).toBe(false);
    });
  });

  describe("the rules, over stated inputs", () => {
    const base = {
      keys: new Map<string, string>(),
      registered: new Set<string>(),
      rows: new Set<string>(),
      tags: new Map<string, string[]>(),
    };

    test("a tag the kit does not define", () => {
      const [problem] = iconProblems({ ...base, tags: new Map([["jx-x", ["surfaces/a.json"]]]) });
      expect(problem).toContain("surfaces/a.json");
      expect(problem).toContain("empty box");
    });

    /**
     * Two undefined tags, so the SORT actually sorts.
     *
     * `iconProblems` orders its findings with `toSorted(([a], [b]) => a.localeCompare(b))` so a
     * report reads the same twice, and a comparator is only invoked with two or more entries.
     */
    test("findings are ordered by tag, not by discovery", () => {
      expect(
        iconProblems({
          ...base,
          tags: new Map([
            ["jx-zebra", ["z.json"]],
            ["jx-apple", ["a.json"]],
          ]),
        }).map((line) => line.slice(0, line.indexOf(">") + 1)),
      ).toEqual(["<jx-apple>", "<jx-zebra>"]);
    });

    test("THE REGRESSION: a panel key the manifest lacks says defining an element will not help", () => {
      const [problem] = iconProblems({
        ...base,
        // The tag is defined and the document is fine — which is exactly why the first checker passed.
        keys: new Map([["branch-1", "panels/git-panel.ts:995"]]),
        registered: new Set(["jx-icon"]),
        rows: new Set(["git-branch"]),
        tags: new Map([["jx-icon", ["surfaces/rail.json"]]]),
      });
      expect(problem).toContain("panels/git-panel.ts:995");
      expect(problem).toContain("renders NOTHING");
      expect(problem).toContain("manifest");
    });

    test("a kit tag no document declares is not a finding — the direction that left with Spectrum", () => {
      /* The old rule 2 failed a REGISTERED tag nothing wrote, held back by an `UNWRITTEN`
         allow-list, because Spectrum's registry was hand-written and a stale row was a real
         mistake. The kit defines one element per document it ships, so a kit tag Studio does not
         use is `@jxsuite/ui`'s business — asking this package about it would be asking it to
         ratchet somebody else's inventory. */
      expect(iconProblems({ ...base, registered: new Set(KIT_TAGS) })).toEqual([]);
    });

    test("a fully wired icon is silent", () => {
      expect(
        iconProblems({
          ...base,
          keys: new Map([["ghost", "panels/a.ts:1"]]),
          registered: new Set(["jx-icon"]),
          rows: new Set(["ghost"]),
          tags: new Map([["jx-icon", ["surfaces/files.json"]]]),
        }),
      ).toEqual([]);
    });
  });

  describe("report", () => {
    test("returns 1 and names both fixes, 0 with both counts", () => {
      const errors: unknown[][] = [];
      const logs: unknown[][] = [];
      const realError = console.error;
      const realLog = console.log;
      console.error = (...a: unknown[]) => errors.push(a);
      console.log = (...a: unknown[]) => logs.push(a);
      try {
        expect(report(['git-panel.ts:995 declares icon "branch-1"'], 3, 2)).toBe(1);
        expect(report([], 74, 11)).toBe(0);
      } finally {
        console.error = realError;
        console.log = realLog;
      }
      const said = errors.flat().join(" ");
      expect(said).toContain("branch-1");
      // The refusal has to name the RIGHT fix for each space, because "define an element" is the
      // Wrong advice for a key and following it is what produced the regression.
      expect(said).toContain("packages/ui/components/");
      expect(said).toContain("manifest");
      expect(said).not.toContain("spectrum");
      expect(logs.flat().join(" ")).toContain("74 kit tag(s)");
      expect(logs.flat().join(" ")).toContain("11 panel key(s)");
    });
  });
});
