import { resetStudioState, resetWorkspaceWithTab } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { closeAllTabs } from "../src/workspace/workspace";
import {
  BORDER_STYLES,
  allConditionsPass,
  autoOpenSections,
  compressBorderSide,
  compressShorthand,
  conditionPasses,
  cssMeta,
  expandBorderSide,
  expandShorthand,
  getCssInitialMap,
  getFontVars,
  getLonghands,
  initCssData,
} from "../src/panels/style-utils";
import type { JxMutableNode } from "@jxsuite/schema/types";

beforeEach(() => {
  resetStudioState();
  closeAllTabs();
});

// ─── initCssData / getCssInitialMap ──────────────────────────────────────────

describe("initCssData / getCssInitialMap", () => {
  test("populates the initial-value map from webdata pairs", () => {
    initCssData({
      cssProps: [
        ["display", "inline"],
        ["color", "canvastext"],
      ],
    });
    const map = getCssInitialMap();
    expect(map.get("display")).toBe("inline");
    expect(map.get("color")).toBe("canvastext");
    expect(map.get("unknownProp")).toBeUndefined();
  });

  test("re-initialization replaces the previous map", () => {
    initCssData({ cssProps: [["display", "inline"]] });
    initCssData({ cssProps: [["zoom", "1"]] });
    const map = getCssInitialMap();
    expect(map.get("display")).toBeUndefined();
    expect(map.get("zoom")).toBe("1");
  });
});

// ─── Condition helpers ───────────────────────────────────────────────────────

describe("conditionPasses", () => {
  test("empty values list requires a non-empty, non-initial value", () => {
    const cond = { prop: "display", values: [] as string[] };
    expect(conditionPasses(cond, { display: "flex" })).toBe(true);
    expect(conditionPasses(cond, { display: "" })).toBe(false);
    expect(conditionPasses(cond, { display: "initial" })).toBe(false);
    expect(conditionPasses(cond, {})).toBe(false);
  });

  test("non-empty values list requires inclusion", () => {
    const cond = { prop: "display", values: ["flex", "inline-flex"] };
    expect(conditionPasses(cond, { display: "flex" })).toBe(true);
    expect(conditionPasses(cond, { display: "grid" })).toBe(false);
    expect(conditionPasses(cond, {})).toBe(false);
  });
});

describe("allConditionsPass", () => {
  test("entry without $show always passes", () => {
    expect(allConditionsPass({}, {})).toBe(true);
  });

  test("all conditions must pass", () => {
    const entry = {
      $show: [
        { prop: "display", values: ["flex"] },
        { prop: "position", values: ["absolute"] },
      ],
    };
    expect(allConditionsPass(entry, { display: "flex", position: "absolute" })).toBe(true);
    expect(allConditionsPass(entry, { display: "flex", position: "static" })).toBe(false);
    expect(allConditionsPass(entry, {})).toBe(false);
  });
});

// ─── autoOpenSections ────────────────────────────────────────────────────────

describe("autoOpenSections", () => {
  test("opens sections for set scalar props, mapping unknown props to other", () => {
    const node = {
      style: { display: "flex", someUnknownProp: "x" },
      tagName: "div",
    } as unknown as JxMutableNode;
    const result = autoOpenSections(node, {});
    expect(result.layout).toBe(true);
    expect(result.other).toBe(true);
    expect(result.size).toBeUndefined();
  });

  test("skips object-valued props (nested selectors, media blocks)", () => {
    const node = {
      style: { ":hover": { color: "red" }, "@sm": { display: "grid" } },
      tagName: "div",
    } as unknown as JxMutableNode;
    expect(autoOpenSections(node, {})).toEqual({});
  });

  test("preserves already-open sections and handles missing style", () => {
    const node = { tagName: "div" } as unknown as JxMutableNode;
    expect(autoOpenSections(node, { border: true })).toEqual({ border: true });
  });

  test("a section somebody CLOSED stays closed, even with a value in it", () => {
    const node = { style: { display: "flex" }, tagName: "div" } as unknown as JxMutableNode;
    // The distinction is `false` versus absent, and it is what makes the accordion obey a click:
    // The Style tab re-projects the moment the record moves, so treating "closed" as "never
    // Opened" re-opened the section in the same frame the reader closed it.
    expect(autoOpenSections(node, { layout: false })).toEqual({ layout: false });
    expect(autoOpenSections(node, {})).toEqual({ layout: true });
  });
});

// ─── getLonghands ────────────────────────────────────────────────────────────

describe("getLonghands", () => {
  test("uses $longhands list when present (border), sorted by $order", () => {
    const longhands = getLonghands("border");
    expect(longhands.map((l) => l.name)).toEqual(["borderWidth", "borderStyle", "borderColor"]);
  });

  test("falls back to $shorthand scan for padding in TRBL order", () => {
    const longhands = getLonghands("padding");
    expect(longhands.map((l) => l.name)).toEqual([
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
    ]);
  });

  test("unknown shorthand returns empty list", () => {
    expect(getLonghands("notARealShorthand")).toEqual([]);
  });
});

// ─── expandShorthand / compressShorthand ─────────────────────────────────────

describe("expandShorthand", () => {
  test("empty value yields blanks", () => {
    expect(expandShorthand("", 4)).toEqual(["", "", "", ""]);
  });

  test("non-4 count yields blanks", () => {
    expect(expandShorthand("1px 2px", 3)).toEqual(["", "", ""]);
  });

  test("expands 1, 2, 3, and 4 value forms per TRBL rules", () => {
    expect(expandShorthand("4px", 4)).toEqual(["4px", "4px", "4px", "4px"]);
    expect(expandShorthand("4px 8px", 4)).toEqual(["4px", "8px", "4px", "8px"]);
    expect(expandShorthand("1px 2px 3px", 4)).toEqual(["1px", "2px", "3px", "2px"]);
    expect(expandShorthand("1px 2px 3px 4px", 4)).toEqual(["1px", "2px", "3px", "4px"]);
  });
});

describe("compressShorthand", () => {
  test("compresses to the shortest equivalent form", () => {
    expect(compressShorthand(["4px", "4px", "4px", "4px"])).toBe("4px");
    expect(compressShorthand(["4px", "8px", "4px", "8px"])).toBe("4px 8px");
    expect(compressShorthand(["1px", "2px", "3px", "2px"])).toBe("1px 2px 3px");
    expect(compressShorthand(["1px", "2px", "3px", "4px"])).toBe("1px 2px 3px 4px");
  });
});

// ─── Border-side parsing ─────────────────────────────────────────────────────

describe("expandBorderSide", () => {
  test("empty value yields three blanks", () => {
    expect(expandBorderSide("")).toEqual(["", "", ""]);
  });

  test("parses width / style / color in any order", () => {
    expect(expandBorderSide("1px solid red")).toEqual(["1px", "solid", "red"]);
    expect(expandBorderSide("solid 2px blue")).toEqual(["2px", "solid", "blue"]);
  });

  test("partial values fill only the matching slots", () => {
    expect(expandBorderSide("solid")).toEqual(["", "solid", ""]);
    expect(expandBorderSide("dotted #fff")).toEqual(["", "dotted", "#fff"]);
    expect(expandBorderSide("3px")).toEqual(["3px", "", ""]);
  });

  test("keeps function colors with internal spaces intact", () => {
    expect(expandBorderSide("1px solid rgb(0, 0, 0)")).toEqual(["1px", "solid", "rgb(0, 0, 0)"]);
  });

  test("joins extra color tokens with spaces", () => {
    expect(expandBorderSide("1px solid red green")).toEqual(["1px", "solid", "red green"]);
  });

  test("BORDER_STYLES contains the standard keywords", () => {
    expect(BORDER_STYLES.has("solid")).toBe(true);
    expect(BORDER_STYLES.has("magenta")).toBe(false);
  });
});

describe("compressBorderSide", () => {
  test("joins non-empty values and drops blanks", () => {
    expect(compressBorderSide(["1px", "solid", "red"])).toBe("1px solid red");
    expect(compressBorderSide(["", "solid", ""])).toBe("solid");
    expect(compressBorderSide(["", " ", ""])).toBe("");
  });
});

// ─── Font helpers (tab-dependent) ────────────────────────────────────────────

describe("getFontVars", () => {
  test("returns empty when no tab is open", () => {
    expect(getFontVars()).toEqual([]);
  });

  test("returns empty when document has no style", () => {
    resetWorkspaceWithTab({ children: [], tagName: "div" });
    expect(getFontVars()).toEqual([]);
  });

  test("collects --font-* string and number values, skipping objects and other props", () => {
    resetWorkspaceWithTab({
      children: [],
      style: {
        "--color-primary": "#000",
        "--font-body": "Inter, sans-serif",
        "--font-weight-ish": 700,
        "--font-nested": { not: "a font" },
        color: "red",
      },
      tagName: "div",
    } as unknown as JxMutableNode);
    expect(getFontVars()).toEqual([
      { name: "--font-body", value: "Inter, sans-serif" },
      { name: "--font-weight-ish", value: "700" },
    ]);
  });

  test("the site's fonts are offered under the document's, and the document's spelling wins", () => {
    /* A project declares its fonts once, in `project.json`; a list that read only the document
       offered a component none of its project's fonts. The effective style is site then document,
       so a token both declare is the document's. */
    resetStudioState({
      projectConfig: {
        style: { "--font-body": "Georgia, serif", "--font-ui": "Inter, sans-serif" },
      },
    });
    resetWorkspaceWithTab({
      children: [],
      style: { "--font-body": "Charter, serif" },
      tagName: "div",
    } as unknown as JxMutableNode);
    expect(getFontVars()).toEqual([
      { name: "--font-body", value: "Charter, serif" },
      { name: "--font-ui", value: "Inter, sans-serif" },
    ]);
  });
});

// ─── Re-exports ──────────────────────────────────────────────────────────────

describe("re-exports", () => {
  test("cssMeta is re-exported", () => {
    expect(Array.isArray(cssMeta.$sections)).toBe(true);
    expect(cssMeta.$defs.display).toBeDefined();
  });
});
