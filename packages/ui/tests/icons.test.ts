import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { hasIcon, ICON_NAMES, iconPath, iconViewBox } from "../src/icons.ts";
import { ICON_VIEW_BOX } from "../src/icons-build.ts";

let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => null);
});

afterEach(() => {
  warn.mockRestore();
});

describe("icon lookup", () => {
  test("names are sorted and the viewBox is the manifest's", () => {
    expect(ICON_NAMES).toEqual([...ICON_NAMES].toSorted());
    expect(ICON_NAMES).toContain("plus");
    expect(iconViewBox).toBe(ICON_VIEW_BOX);
  });

  test("hasIcon answers per name and per weight", () => {
    expect(hasIcon("plus")).toBe(true);
    expect(hasIcon("plus", "bold")).toBe(true);
    expect(hasIcon("trash", "bold")).toBe(false);
    expect(hasIcon("no-such-icon")).toBe(false);
  });

  test("a weight the manifest lacks falls back to regular", () => {
    expect(iconPath("trash", "bold")).toBe(iconPath("trash", "regular"));
    expect(iconPath("plus", "bold")).not.toBe(iconPath("plus", "regular"));
    expect(iconPath("plus", "nonsense")).toBe(iconPath("plus", "regular"));
  });

  test("an unknown name draws nothing and warns once", () => {
    expect(iconPath("no-such-icon", "regular")).toBe("");
    expect(iconPath("no-such-icon", "regular")).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("no-such-icon");
  });

  /* THE PORTER'S MAP, and all of it. `packages/studio/data/css-meta.json` names 25 distinct
     `$icons` glyphs across the eight `$input: "button-group"` properties, and `button-group.ts`
     falls back to `abbreviateValue(v)` TEXT for every one the kit cannot resolve — so a value
     missing here does not fail loudly, it ships as a two-letter abbreviation on the most-used
     control of the Style panel. The keys are css-meta's own `$icons` NAMES, which is what a porter
     holds and greps for; the tables are transcribed rather than read out of `css-meta.json`,
     because that file is in another workspace and reading it would need an `EXTRA_EDGES` entry in
     `scripts/ci/affected.ts` to stay honest. Counting all three tables is how the gap stays
     falsifiable: it is 6 of 25, not the 5 this slice added glyphs for. */

  /** The css-meta names the kit already ships VERBATIM: `$icons` name === manifest name. */
  const CSS_META_VERBATIM = [
    "arrow-up",
    "arrow-down",
    "arrow-left",
    "arrow-right",
    "text-align-left",
    "text-align-center",
    "text-align-right",
    "text-align-justify",
  ] as const;

  /** Each css-meta name → the kit glyph a porter must translate it to. */
  const CSS_META_MAPPED: Record<string, string> = {
    /* Baseline: a letterform sitting on a full-width rule IS the picture, and every design tool
       draws it that way. `text-subscript` was rejected because the kit ships that exact glyph for
       the rich-text bar's Subscript — one glyph, two meanings. `text-underline` is a DIFFERENT
       glyph of similar composition (a U, on a narrower rule); rendered at the shipped 16px the two
       silhouettes are a pointed triangle against an open bowl, and they are never adjacent — the
       Style panel's alignItems group and the formatting bar are two different toolbars. */
    "align-baseline": "text-a-underline",
    // Arrows away from a centre rule, vertically: filling the cross axis.
    "align-stretch-v": "arrows-out-line-vertical",
    "align-start-v": "align-top",
    "align-end-v": "align-bottom",
    "align-center-v": "align-center-vertical",
    "justify-start": "align-left",
    "justify-end": "align-right",
    "justify-center": "align-center-horizontal",
    // Arrows pushed OUT from a centre rule to the edges: content at the ends, the gap in the middle.
    "justify-between": "arrows-out-line-horizontal",
    /* Its mirror, and the weaker half of the pair: the artwork is two arrowheads pointing IN at
       that same centre rule, so read alone it says "collapse together" rather than "a gap at each
       end". It ships as the mirror of `justify-between` — content inset from the edges, which is
       what space-around leaves — because Phosphor has no distribute family at all, and because the
       button carries the CSS value as its accessible name and tooltip either way. */
    "justify-around": "arrows-in-line-horizontal",
    /* Weaker still, and named as such: a plain double-headed arrow reads as "horizontal extent",
       not "an equal gap everywhere". It ships because it is legibly DISTINCT from the other two in
       the same six-button group. */
    "justify-evenly": "arrows-horizontal",
  };

  /** The css-meta names with no kit glyph under any name: still `abbreviateValue` text when ported. */
  const CSS_META_UNRESOLVED = [
    "display-flex",
    "display-grid",
    "display-block",
    "display-inline",
    "display-none",
    "wrap-text",
  ] as const;

  test("every css-meta button-group glyph is shipped, mapped, or a NAMED gap", () => {
    for (const name of CSS_META_VERBATIM) {
      expect(hasIcon(name), name).toBe(true);
    }
    for (const [meta, kit] of Object.entries(CSS_META_MAPPED)) {
      expect(ICON_NAMES, meta).toContain(kit);
      expect(hasIcon(kit), meta).toBe(true);
      expect(iconPath(kit, "regular"), meta).not.toBe("");
    }
    /* One glyph may not carry two of these meanings: two buttons a reader cannot tell apart is the
       failure the abbreviation already was. */
    const drawn = [...CSS_META_VERBATIM, ...Object.values(CSS_META_MAPPED)];
    expect(new Set(drawn).size).toBe(drawn.length);
    /* The gap, asserted in BOTH directions. It stays a gap until someone ships the glyph, and the
       day they do this reddens and asks them to move the name up into the mapped table rather than
       leaving a count frozen at a number that was never the whole story. `display` is the topmost
       control of the Style panel and all five of its values are here. */
    for (const name of CSS_META_UNRESOLVED) {
      expect(hasIcon(name), name).toBe(false);
    }
    expect(
      CSS_META_VERBATIM.length + Object.keys(CSS_META_MAPPED).length + CSS_META_UNRESOLVED.length,
    ).toBe(25);
  });

  test("a missing or non-string name draws nothing silently", () => {
    expect(iconPath("", "regular")).toBe("");
    expect(iconPath(undefined, "regular")).toBe("");
    expect(iconPath(42, "regular")).toBe("");
    expect(warn).not.toHaveBeenCalled();
  });
});
