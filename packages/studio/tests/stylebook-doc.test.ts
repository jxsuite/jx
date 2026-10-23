/**
 * Stylebook specimen-document generator (src/panels/stylebook-doc.ts) — the pure functions that
 * turn the element catalog + component registry + effective style into a JxDocument the iframe
 * canvas renders. Covers the two load-bearing style transforms (selector.@media hoisting, tag-rule
 * re-keying under the specimen scope) and the path↔tag maps that drive hit decoding.
 */
import "./with-dom.js";
import { describe, expect, test } from "bun:test";
import {
  buildStylebookDoc,
  catalogueRows,
  hasTagStyle,
  selectionLeaf,
  transposeStylebookStyle,
} from "../src/panels/stylebook-doc";
import type { BuildStylebookDocOpts } from "../src/panels/stylebook-doc";
import { serializeJxPath } from "../src/canvas/path-mapping";
import type { ComponentEntry } from "../src/files/components";
import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode, JxStyle } from "@jxsuite/schema/types";

const META: BuildStylebookDocOpts["meta"] = {
  $sections: [
    {
      elements: [
        { tag: "h1", text: "Heading" },
        { tag: "p", text: "Paragraph" },
      ],
      label: "Text",
    },
    {
      elements: [
        {
          children: [
            { tag: "li", text: "One" },
            { tag: "li", text: "Two" },
          ],
          tag: "ul",
        },
      ],
      label: "List",
    },
  ],
};

function build(overrides: Partial<BuildStylebookDocOpts> = {}) {
  return buildStylebookDoc({
    components: [],
    customizedOnly: false,
    effectiveMedia: { "--md": "(max-width: 768px)" },
    effectiveStyle: {},
    filter: "",
    meta: META,
    projectRoot: "examples",
    ...overrides,
  });
}

/** The generator emits element children only; a text child or a repeater here is a test failure. */
function kids(n: JxMutableNode): JxMutableNode[] {
  const { children } = n;
  if (!Array.isArray(children)) {
    throw new TypeError("expected an array of children");
  }
  const elements: JxMutableNode[] = [];
  for (const child of children) {
    if (isString(child)) {
      throw new TypeError(`expected element children, got text ${JSON.stringify(child)}`);
    }
    elements.push(child);
  }
  return elements;
}

const cls = (n: JxMutableNode) => n.attributes?.class;

describe("buildStylebookDoc — the project's head", () => {
  test("carries the merged $head, so the specimens load the project's webfonts", () => {
    const fonts = {
      attributes: { href: "https://fonts.googleapis.com/css2?family=Barlow", rel: "stylesheet" },
      tagName: "link",
    };
    expect(build({ effectiveHead: [fonts] }).doc.$head).toEqual([fonts]);
    expect(build({ effectiveHead: [] }).doc.$head).toBeUndefined();
    expect(build().doc.$head).toBeUndefined();
  });
});

describe("buildStylebookDoc — tree shape", () => {
  test("root carries sb-root, $media, and the transposed style; sections wrap labelled card bodies", () => {
    const { doc } = build({ effectiveStyle: { h1: { color: "red" } } });
    expect(cls(doc)).toBe("sb-root");
    expect(doc.$media).toEqual({ "--md": "(max-width: 768px)" });
    expect(doc.style?.["& .element-card-preview h1"]).toEqual({
      color: "red",
    });

    const [textSection, listSection] = kids(doc);
    expect(cls(textSection!)).toBe("sb-section");
    expect(kids(textSection!)[0]!.textContent).toBe("Text");
    const body = kids(textSection!)[1]!;
    expect(cls(body)).toBe("sb-body");
    const card = kids(body)[0]!;
    expect(cls(card)).toBe("element-card");
    const preview = kids(card)[0]!;
    expect(cls(preview)).toBe("element-card-preview");
    expect(kids(preview)[0]).toMatchObject({ tagName: "h1", textContent: "Heading" });
    expect(kids(card)[1]).toMatchObject({ textContent: "<h1>" });
    expect(cls(kids(listSection!)[1]!)).toBe("sb-body");
  });

  test("entry attributes + inline style ride as the style ATTRIBUTE (legacy cssText parity)", () => {
    const { doc } = build({
      meta: {
        $sections: [
          {
            elements: [{ attributes: { type: "text" }, style: "width: 40px", tag: "input" }],
            label: "Forms",
          },
        ],
      },
    });
    const section = kids(doc)[0]!;
    const body = kids(section)[1]!;
    const card = kids(body)[0]!;
    const preview = kids(card)[0]!;
    const spec = kids(preview)[0]!;
    expect(spec.tagName).toBe("input");
    expect(spec.attributes).toEqual({ style: "width: 40px", type: "text" });
  });

  test("pathToTag maps card/preview/specimen paths; descendants get compounds; chrome is absent", () => {
    const { pathToTag, tagToCardPath } = build();
    // Section 1 ("List") → body → card 0 → preview → ul → li[0]
    const cardPath = ["children", 1, "children", 1, "children", 0];
    expect(pathToTag.get(serializeJxPath(cardPath))).toBe("ul");
    expect(pathToTag.get(serializeJxPath([...cardPath, "children", 0]))).toBe("ul");
    const ulPath = [...cardPath, "children", 0, "children", 0];
    expect(pathToTag.get(serializeJxPath(ulPath))).toBe("ul");
    expect(pathToTag.get(serializeJxPath([...ulPath, "children", 0]))).toBe("ul li");
    expect(pathToTag.get(serializeJxPath([...ulPath, "children", 1]))).toBe("ul li");
    // Chrome (section/label/body/root) paths are unmapped → hit = deselect.
    expect(pathToTag.get(serializeJxPath(["children", 1]))).toBeUndefined();
    expect(pathToTag.get(serializeJxPath([]))).toBeUndefined();
    // TagToCardPath points at the FIRST matching card.
    expect(tagToCardPath.get("ul")).toEqual(cardPath);
    expect(tagToCardPath.get("h1")).toEqual(["children", 0, "children", 1, "children", 0]);
  });

  test("filter narrows by tag or section label; customizedOnly keeps only styled tags", () => {
    const filtered = build({ filter: "h1" });
    expect(kids(filtered.doc)).toHaveLength(1);
    expect(filtered.tagToCardPath.has("ul")).toBe(false);

    const custom = build({
      customizedOnly: true,
      effectiveStyle: { "@md": { p: { color: "blue" } } },
    });
    // Only <p> is customized (under a media block — hasTagStyle looks there too).
    expect(custom.tagToCardPath.has("p")).toBe(true);
    expect(custom.tagToCardPath.has("h1")).toBe(false);
  });

  test("empty result renders the sb-empty message node", () => {
    const none = build({ filter: "zzz-none" });
    expect(kids(none.doc)).toHaveLength(1);
    expect(cls(kids(none.doc)[0]!)).toBe("sb-empty");
    const customized = build({ customizedOnly: true, filter: "zzz-none" });
    expect(kids(customized.doc)[0]!.textContent).toBe("No customized elements");
  });

  test("project JSON components emit $elements refs + prop-default specimens; npm falls back", () => {
    const components: ComponentEntry[] = [
      {
        path: "components/user-card.json",
        props: [
          { default: "'Jane'", name: "name" },
          { default: "false", name: "compact" },
        ],
        source: "local",
        tagName: "user-card",
      },
      { package: "sl", source: "npm", tagName: "sl-button" },
    ];
    const { doc, tagToCardPath } = build({ components });
    expect(doc.$elements).toEqual([{ $ref: "/examples/components/user-card.json" }]);
    // An ABSOLUTE projectRoot must not produce a protocol-relative "//home/…" ref.
    const absolute = build({ components, projectRoot: "/home/user/site" });
    expect(absolute.doc.$elements).toEqual([{ $ref: "/home/user/site/components/user-card.json" }]);
    const compSection = kids(doc).at(-1)!;
    expect(kids(compSection)[0]!.textContent).toBe("Components");
    const cards = kids(kids(compSection)[1]!);
    const userCardSpecimen = kids(kids(cards[0]!)[0]!)[0]!;
    expect(userCardSpecimen).toMatchObject({
      attributes: { name: "Jane" },
      tagName: "user-card",
    });
    const npmSpecimen = kids(kids(cards[1]!)[0]!)[0]!;
    expect(cls(npmSpecimen)).toBe("sb-fallback");
    expect(npmSpecimen.textContent).toBe("<sl-button>");
    expect(tagToCardPath.has("user-card")).toBe(true);
    expect(tagToCardPath.has("sl-button")).toBe(true);
  });

  test("specimens draw a card with sample props or the placeholder box", () => {
    const components: ComponentEntry[] = ["x-a", "x-c", "x-d"].map((tagName) => ({
      path: `components/${tagName}.json`,
      props: [{ default: "'dflt'", name: "label" }],
      source: "local",
      tagName,
    }));
    const { doc } = build({
      components,
      specimens: new Map([
        ["x-a", { kind: "props", props: { label: "Sample" } }],
        ["x-c", { kind: "none" }],
      ]),
    });
    const cards = kids(kids(kids(doc).at(-1)!)[1]!);
    const specimen = (i: number) => kids(kids(cards[i]!)[0]!)[0]!;
    expect(specimen(0)).toEqual({ $props: { label: "Sample" }, tagName: "x-a" });
    expect(cls(specimen(1))).toBe("sb-fallback");
    // No answer is the bare instance with its defaults, as before specimens existed.
    expect(specimen(2)).toEqual({ attributes: { label: "dflt" }, tagName: "x-d" });
    expect(doc.state).toBeUndefined();
  });
});

describe("transposeStylebookStyle", () => {
  test("keeps flat scalars + custom props at the top; re-keys tag rules under the specimen scope", () => {
    const out = transposeStylebookStyle({
      "--accent": "#f00",
      "font-family": "serif",
      h1: { "font-size": "2rem" },
      "table th": undefined,
      table: { th: { padding: "4px" } },
    });
    expect(out["--accent"]).toBe("#f00");
    expect(out["font-family"]).toBe("serif");
    expect(out["& .element-card-preview h1"]).toEqual({ "font-size": "2rem" });
    // Nested tag rules stay nested (the builder descends them relative to the re-keyed parent).
    expect(out["& .element-card-preview table"]).toEqual({ th: { padding: "4px" } });
    // No bare tag keys survive (a bare `div` rule would restyle the card chrome).
    expect(out.h1).toBeUndefined();
    expect(out.table).toBeUndefined();
  });

  test("a nested @media stays where the author wrote it — the hoist is gone", () => {
    /* This used to hoist `selector → @media` into the top-level `@media → selector` block, because
       the runtime emitted only the latter. The runtime composes both orders now, so the workaround
       became a rewrite of the author's own structure for no reason. */
    const out = transposeStylebookStyle({
      h1: { "@md": { color: "green" }, color: "red" },
      ul: { li: { "@md": { margin: "0" } } },
    });
    expect(out["& .element-card-preview h1"]).toEqual({ "@md": { color: "green" }, color: "red" });
    expect(out["& .element-card-preview ul"]).toEqual({ li: { "@md": { margin: "0" } } });
    expect(out["@md"]).toBeUndefined();
  });

  test("a top-level @media block still re-keys the tag rules inside it", () => {
    // Still needed: a bare `h1` rule on the generated root would reach the card chrome.
    const out = transposeStylebookStyle({
      "@md": { h1: { "font-weight": "700" }, "line-height": "1.4" },
    });
    expect(out["@md"]).toEqual({
      "& .element-card-preview h1": { "font-weight": "700" },
      "line-height": "1.4",
    });
  });

  test("a @keyframes body is passed through — its stops are not selectors", () => {
    /* `from` and `to` pass `isTagPath`, so the media-block arm would re-key them as
       `& .element-card-preview from` and the browser would throw the whole animation away. */
    const out = transposeStylebookStyle({
      "@keyframes toast-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      h1: { animation: "toast-in 180ms" },
    });
    expect(out["@keyframes toast-in"]).toEqual({ from: { opacity: "0" }, to: { opacity: "1" } });
  });

  test("pseudo/class sub-rules ride along; @-- base-width markers are dropped", () => {
    const out = transposeStylebookStyle({
      "@--": { width: "1280px" },
      a: { ":hover": { color: "blue" }, "@--": { x: "y" }, color: "navy" },
    });
    expect(out["& .element-card-preview a"]).toEqual({
      ":hover": { color: "blue" },
      color: "navy",
    });
    expect(out["@--"]).toBeUndefined();
  });
});

describe("hasTagStyle", () => {
  test("finds direct, compound, and media-scoped customization; misses empty rules", () => {
    const style: JxStyle = {
      "@md": { p: { color: "blue" } },
      table: { th: { padding: "2px" } },
      ul: {},
    };
    expect(hasTagStyle(style, "table th")).toBe(true);
    expect(hasTagStyle(style, "p")).toBe(true);
    expect(hasTagStyle(style, "ul")).toBe(false);
    expect(hasTagStyle(style, "h1")).toBe(false);
  });
});

describe("catalogueRows (the one walk both element lists draw from)", () => {
  const entries = [
    { tag: "h1" },
    {
      children: [{ tag: "li" }, { tag: "li" }, { children: [{ tag: "a" }], tag: "ol" }],
      tag: "ul",
    },
  ];

  test("flattens in document order, with compound paths and depths, one row per child tag", () => {
    const rows = catalogueRows(entries, null);
    expect(rows.map((row) => [row.path, row.depth])).toEqual([
      ["h1", 0],
      ["ul", 0],
      ["ul li", 1],
      ["ul ol", 1],
      ["ul ol a", 2],
    ]);
    expect(rows.every((row) => !row.selected)).toBe(true);
    // The duplicate tags are one row, in the first one's place (a Map keeps the last entry's value).
    expect(rows[2]!.entry).toBe(entries[1]!.children![1]!);
  });

  test("marks the row whose tag is the selection's leaf", () => {
    expect(selectionLeaf(null)).toBeNull();
    expect(selectionLeaf("h1")).toBe("h1");
    expect(selectionLeaf("ul ol a")).toBe("a");
    const marked = catalogueRows(entries, "ul ol a").filter((row) => row.selected);
    expect(marked.map((row) => row.path)).toEqual(["ul ol a"]);
  });
});
