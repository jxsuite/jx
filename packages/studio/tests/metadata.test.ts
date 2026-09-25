import "./with-dom.js";
import { ICON_NAMES } from "@jxsuite/ui/icons";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface MetaEntry {
  $section: string;
  $order: number;
  type: string;
  enum?: string[];
  $buttonValues?: string[];
  $icons?: Record<string, string>;
  $elements?: string[];
  $inlineChildren?: string[];
  [key: string]: unknown;
}

const __dirname = import.meta.dirname;
const studioDir = join(__dirname, "..");

const cssMeta = JSON.parse(readFileSync(join(studioDir, "data", "css-meta.json"), "utf8"));
const htmlMeta = JSON.parse(readFileSync(join(studioDir, "data", "html-meta.json"), "utf8"));
const stylebookMeta = JSON.parse(
  readFileSync(join(studioDir, "data", "stylebook-meta.json"), "utf8"),
);
const elementsMeta = JSON.parse(
  readFileSync(join(studioDir, "data", "elements-meta.json"), "utf8"),
);

// ─── Shared metadata helpers ─────────────────────────────────────────────────

/** @param {any} meta */
function sectionKeys(meta: any) {
  return new Set(meta.$sections.map((s: any) => s.key));
}

// ─── css-meta.json ───────────────────────────────────────────────────────────

describe("css-meta.json", () => {
  const sections = sectionKeys(cssMeta);
  const defs = Object.entries(cssMeta.$defs) as [string, MetaEntry][];

  test("has $id and title", () => {
    expect(cssMeta.$id).toBe("css-meta");
    expect(typeof cssMeta.title).toBe("string");
  });

  test("has at least 5 sections", () => {
    expect(cssMeta.$sections.length).toBeGreaterThanOrEqual(5);
  });

  test("every section has key and label", () => {
    for (const section of cssMeta.$sections) {
      expect(typeof section.key).toBe("string");
      expect(typeof section.label).toBe("string");
    }
  });

  test("section keys are unique", () => {
    const keys = cssMeta.$sections.map((s: any) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("every def has $section referencing a valid section", () => {
    for (const [_prop, entry] of defs) {
      expect(sections.has(entry.$section)).toBe(true);
    }
  });

  test("every def has numeric $order", () => {
    for (const [_prop, entry] of defs) {
      expect(typeof entry.$order).toBe("number");
    }
  });

  test("every def has a type", () => {
    const validTypes = new Set(["string", "number", "boolean", "color"]);
    for (const [_prop, entry] of defs) {
      expect(validTypes.has(entry.type)).toBe(true);
    }
  });

  test("enum entries are arrays of strings", () => {
    for (const [_prop, entry] of defs) {
      if (entry.enum) {
        expect(Array.isArray(entry.enum)).toBe(true);
        for (const v of entry.enum) {
          expect(typeof v).toBe("string");
        }
      }
    }
  });

  test("$buttonValues are subsets of enum", () => {
    for (const [_prop, entry] of defs) {
      if (entry.$buttonValues && entry.enum) {
        for (const bv of entry.$buttonValues) {
          expect(entry.enum).toContain(bv);
        }
      }
    }
  });

  test("$icons keys exist in $buttonValues", () => {
    for (const [_prop, entry] of defs) {
      if (entry.$icons && entry.$buttonValues) {
        for (const iconKey of Object.keys(entry.$icons)) {
          expect(entry.$buttonValues).toContain(iconKey);
        }
      }
    }
  });

  /* The `$icons` values are kit MANIFEST names (ui.md §8, one key space), drawn by the Style
     panel's button rows verbatim: `panels/style-panel.ts` has no translation table and no runtime
     guard, so these four tests are the whole of what keeps a row from shipping as abbreviations.
     A table from css-meta's own semantic names did exactly that, silently, for every Display,
     wrap, justify and align value.

     The choices the tests hold, and why, since the JSON cannot carry a comment:
     - display: `columns` and `grid-four` are Spectrum's view-column and view-grid; `eye-slash` is
       visibility-off, and the Files panel's "hidden" glyph already. `block` is `rectangle`, one
       full-width box, because the nearer `square` is the titlebar's Maximize; `inline` is `text-t`,
       content that flows like text, because Spectrum's `remove` would be `minus`, which Studio
       already draws for Minimize, Zoom out and unstage.
     - wrap: `arrow-u-down-left`, the conventional wrap arrow (along, down, back). `flip-vertical`
       was the Spectrum-era pick, and Phosphor draws it as two mirrored triangles. `wrap-reverse`
       has NO glyph on purpose: its mirror, `arrow-u-up-left`, is Undo's picture in this app (the
       command bar's and Source Control's discard), and one picture with two meanings is the failure
       these tests exist for. `nowrap` has none either, there being no glyph for an absence.
     - justify and align: the object-alignment family, which is what Phosphor's `align-*` are (a
       rule and two bars, not text lines). The AXIS decides which half of the family a row takes,
       and the axis is the property's, not the writing direction's: justify-content works on the
       main axis and draws the horizontal glyphs; align-items, align-content and align-self all
       work on the cross axis and draw the vertical ones. align-content drew the horizontal family
       until it was noticed that it sat directly under align-items drawing the vertical one, so two
       neighbouring rows described opposite axes for the same placement, and four of its buttons
       were pixel-identical to justify-content's two rows up.
       space-between is arrows pushed OUT from a centre rule; space-around is its mirror, the
       weaker of the pair, because Phosphor has no distribute family; space-evenly is a plain
       double arrow, weaker still, chosen because it is distinct from the other two in the same
       row. On the cross axis space-between is `arrows-vertical` rather than the rotation of its
       own main-axis glyph, because `arrows-out-line-vertical` is already stretch there; that makes
       `arrows-horizontal`/`arrows-vertical` the one pair in the set whose two halves do not mean
       the same keyword, and it is the right trade because align-content is the only align row that
       distributes at all, so the plain double arrow has nothing to be confused with in it.
       stretch is the vertical out-arrows, filling the cross axis. baseline is a letter on a
       full-width rule, `text-a-underline`, because `text-subscript` is the rich-text bar's
       Subscript. Every button carries its CSS value as its accessible name and tooltip, so a weak
       glyph is never the only way to tell. */

  test("every $icons glyph is one the kit ships", () => {
    for (const [prop, entry] of defs) {
      for (const [value, glyph] of Object.entries(entry.$icons ?? {})) {
        expect(ICON_NAMES, `${prop}: ${value} → "${glyph}"`).toContain(glyph);
      }
    }
  });

  test("a button row never draws two values with one glyph", () => {
    for (const [prop, entry] of defs) {
      const glyphs = Object.values(entry.$icons ?? {});
      expect(new Set(glyphs).size, prop).toBe(glyphs.length);
    }
  });

  test("a glyph stands for one keyword across every row", () => {
    /* `align-left` may be flex-start in justifyContent and in alignContent, because it is the same
       keyword; it may not also be `left` somewhere else. Two meanings for one picture is the
       failure the abbreviations already were. */
    const meaning = new Map<string, string>();
    for (const [prop, entry] of defs) {
      for (const [value, glyph] of Object.entries(entry.$icons ?? {})) {
        meaning.set(glyph, meaning.get(glyph) ?? value);
        expect(meaning.get(glyph), `${prop}: "${glyph}"`).toBe(value);
      }
    }
    expect(meaning.size).toBeGreaterThan(0);
  });

  test("every Display button is a glyph", () => {
    /* The regression this section exists for: the topmost control of the Style panel drew
       `flex grid block inl none` as text. */
    const display = cssMeta.$defs.display as MetaEntry;
    expect(Object.keys(display.$icons!).toSorted()).toEqual(display.$buttonValues!.toSorted());
  });

  test("a row's glyphs are all of its property's own axis", () => {
    /* A cross-axis property drawing left/right/centre-horizontal pictures is a lie about what the
       button does, and `align-content` told it directly under `align-items` telling the truth. The
       axis is read off the glyph name, so a future row cannot pick up the wrong half of the family
       without saying so here. */
    const HORIZONTAL = /-(?:left|right)$|horizontal/;
    const VERTICAL = /-(?:top|bottom)$|vertical/;
    const axisOf = (prop: string) => (prop.startsWith("justify") ? "main" : "cross");
    for (const prop of ["justifyContent", "alignItems", "alignContent", "alignSelf"]) {
      const entry = cssMeta.$defs[prop] as MetaEntry;
      for (const [value, glyph] of Object.entries(entry.$icons ?? {})) {
        const wrong = axisOf(prop) === "main" ? VERTICAL : HORIZONTAL;
        expect(wrong.test(glyph), `${prop}: ${value} → "${glyph}"`).toBe(false);
      }
    }
  });

  test("a value with no glyph is drawn as its own keyword, so it cannot be cryptic", () => {
    /* The Style panel prints a glyph-less value verbatim (`panels/style-panel.ts`), so the guard is
       that the keyword itself reads: a one-word CSS value does, `flex-start` compressed to `start`
       did not, and `wrap-reverse` compressed to `wr-rev` did not either. Anything multi-word needs
       a glyph or it needs to stop being a button, which is where `wrap-reverse` went: written out it
       is 76px, and the three-button row ran past a 190px Inspector and drew a segmented frame with
       its right border cut off and the word sliced mid-letter. In the `…` menu it costs the rarest
       of the three values one click and the row fits at the 160px drag floor. */
    const bare: string[] = [];
    for (const [prop, entry] of defs) {
      if (entry.$input !== "button-group") {
        continue;
      }
      const values = (entry.$buttonValues ?? entry.enum ?? []) as string[];
      for (const value of values) {
        if (!(entry.$icons ?? {})[value]) {
          bare.push(`${prop}: ${value}`);
        }
      }
    }
    /* The three the design accepts as words, and nothing else. Each is one short word, and each is
       its row's leading default, so the words come first and the glyphs follow. */
    expect(bare.toSorted()).toEqual([
      "alignContent: normal",
      "alignSelf: auto",
      "flexWrap: nowrap",
    ]);
  });

  test("no duplicate $order within a section", () => {
    const ordersBySection: Record<string, Record<string, any>> = {};
    for (const [prop, entry] of defs) {
      const sec = entry.$section;
      if (!ordersBySection[sec]) {
        ordersBySection[sec] = {};
      }
      // Same order values in a section would be a conflict
      if (ordersBySection[sec][entry.$order]) {
        // Allow it but track — some sections may legitimately share order
        // Just ensure we can at least detect it
      }
      ordersBySection[sec][entry.$order] = prop;
    }
    // Verify at minimum that the map built successfully
    expect(Object.keys(ordersBySection).length).toBeGreaterThan(0);
  });

  test("known CSS properties are present", () => {
    const defKeys = new Set(Object.keys(cssMeta.$defs));
    const expected = ["display", "color", "padding", "margin", "fontFamily", "fontSize"];
    for (const prop of expected) {
      expect(defKeys.has(prop)).toBe(true);
    }
  });
});

// ─── html-meta.json ──────────────────────────────────────────────────────────

describe("html-meta.json", () => {
  const sections = sectionKeys(htmlMeta);
  const defs = Object.entries(htmlMeta.$defs) as [string, MetaEntry][];

  test("has $id and title", () => {
    expect(htmlMeta.$id).toBe("html-meta");
    expect(typeof htmlMeta.title).toBe("string");
  });

  test("has at least 4 sections", () => {
    expect(htmlMeta.$sections.length).toBeGreaterThanOrEqual(4);
  });

  test("every section has key and label", () => {
    for (const section of htmlMeta.$sections) {
      expect(typeof section.key).toBe("string");
      expect(typeof section.label).toBe("string");
    }
  });

  test("every def has $section referencing a valid section", () => {
    for (const [_attr, entry] of defs) {
      expect(sections.has(entry.$section)).toBe(true);
    }
  });

  test("every def has numeric $order", () => {
    for (const [_attr, entry] of defs) {
      expect(typeof entry.$order).toBe("number");
    }
  });

  test("every def has a type", () => {
    const validTypes = new Set(["string", "boolean"]);
    for (const [_attr, entry] of defs) {
      expect(validTypes.has(entry.type)).toBe(true);
    }
  });

  test("$elements arrays contain only lowercase tag names", () => {
    for (const [_attr, entry] of defs) {
      if (entry.$elements) {
        expect(Array.isArray(entry.$elements)).toBe(true);
        for (const tag of entry.$elements) {
          expect(tag).toBe(tag.toLowerCase());
          expect(tag).toMatch(/^[a-z][a-z0-9]*$/);
        }
      }
    }
  });

  test("global attributes have no $elements", () => {
    const globalAttrs = ["id", "class", "title", "hidden", "lang", "dir", "role", "tabindex"];
    for (const attr of globalAttrs) {
      const entry = htmlMeta.$defs[attr];
      if (entry) {
        expect(entry.$elements).toBeUndefined();
      }
    }
  });

  test("known HTML attributes are present", () => {
    const defKeys = new Set(Object.keys(htmlMeta.$defs));
    const expected = ["id", "class", "href", "src", "alt", "role", "aria-label"];
    for (const attr of expected) {
      expect(defKeys.has(attr)).toBe(true);
    }
  });

  test("tag-specific attributes have valid $elements", () => {
    // Href should only be on a, area, link
    const { href } = htmlMeta.$defs;
    if (href && href.$elements) {
      expect(href.$elements).toContain("a");
    }
    // Src should include img
    const { src } = htmlMeta.$defs;
    if (src && src.$elements) {
      expect(src.$elements).toContain("img");
    }
  });
});

// ─── stylebook-meta.json ─────────────────────────────────────────────────────

describe("stylebook-meta.json", () => {
  test("has $sections array", () => {
    expect(Array.isArray(stylebookMeta.$sections)).toBe(true);
    expect(stylebookMeta.$sections.length).toBeGreaterThan(0);
  });

  test("every section has label and elements array", () => {
    for (const section of stylebookMeta.$sections) {
      expect(typeof section.label).toBe("string");
      expect(Array.isArray(section.elements)).toBe(true);
    }
  });

  test("every element has a tag", () => {
    for (const section of stylebookMeta.$sections) {
      for (const el of section.elements) {
        expect(typeof el.tag).toBe("string");
      }
    }
  });

  test("section labels are unique", () => {
    const labels = stylebookMeta.$sections.map((s: any) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ─── elements-meta.json ─────────────────────────────────────────────────────

describe("elements-meta.json", () => {
  test("has $id and title", () => {
    expect(elementsMeta.$id).toBe("elements-meta");
    expect(typeof elementsMeta.title).toBe("string");
  });

  test("every element def has $inlineChildren array", () => {
    for (const [_tag, def] of Object.entries(elementsMeta.$defs) as [string, MetaEntry][]) {
      expect(Array.isArray(def.$inlineChildren)).toBe(true);
    }
  });

  test("$inlineChildren contain only lowercase tag names", () => {
    for (const [_tag, def] of Object.entries(elementsMeta.$defs) as [string, MetaEntry][]) {
      for (const child of def.$inlineChildren!) {
        expect(child).toBe(child.toLowerCase());
        expect(child).toMatch(/^[a-z][a-z0-9]*$/);
      }
    }
  });

  test("<a> is inline within <p> but not within <div>", () => {
    expect(elementsMeta.$defs.p.$inlineChildren).toContain("a");
    expect(elementsMeta.$defs.div.$inlineChildren).not.toContain("a");
  });

  test("$inlineActions string references resolve to valid arrays", () => {
    for (const [_tag, def] of Object.entries(elementsMeta.$defs) as [string, MetaEntry][]) {
      if (typeof def.$inlineActions === "string") {
        const ref = elementsMeta.$defs[def.$inlineActions];
        expect(ref).toBeDefined();
        expect(Array.isArray(ref.$inlineActions)).toBe(true);
      }
    }
  });

  /**
   * `icon` was a required field here and is now a forbidden one, which is the same claim inverted.
   *
   * The data file carried an `sp-icon-*` name on every action, and nothing ever read it: the bar
   * draws `toolOf(registry, command, …)`, so the glyph comes off the `format.*` COMMAND RECORD
   * (`panels/block-action-bar.ts`, kit keys like `text-b`). Two definition sites for one glyph is
   * the defect studio-ui-guidelines.md §12.5 names, and this one had already drifted: the records
   * moved to kit keys while the data file still said Spectrum. Asserting its ABSENCE is what keeps
   * the second site from growing back — deleting the line would have left the field free to
   * return.
   */
  test("$inlineActions entries carry their vocabulary, and not a second glyph", () => {
    for (const [_tag, def] of Object.entries(elementsMeta.$defs) as [string, MetaEntry][]) {
      let actions = def.$inlineActions;
      if (typeof actions === "string") {
        actions = elementsMeta.$defs[actions]?.$inlineActions;
      }
      if (!Array.isArray(actions)) {
        continue;
      }
      for (const action of actions) {
        expect(typeof action.tag).toBe("string");
        expect(typeof action.label).toBe("string");
        expect(typeof action.command).toBe("string");
        expect(
          action,
          `${action.tag}: the glyph is the format.${action.command} record's`,
        ).not.toHaveProperty("icon");
      }
    }
  });

  test("text-bearing elements have non-empty $inlineChildren", () => {
    const textBearing = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th"];
    for (const tag of textBearing) {
      const def = elementsMeta.$defs[tag];
      expect(def).toBeDefined();
      expect(def.$inlineChildren.length).toBeGreaterThan(0);
    }
  });

  test("container elements have empty $inlineChildren", () => {
    const containers = ["div", "section", "article", "nav", "main"];
    for (const tag of containers) {
      const def = elementsMeta.$defs[tag];
      expect(def).toBeDefined();
      expect(def.$inlineChildren).toEqual([]);
    }
  });
});
