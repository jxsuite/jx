import { describe, expect, test } from "bun:test";

import { processMarkdown } from "../src/md";
import { serializeJxMarkdown } from "../src/serialize";
import { transpileJxMarkdown } from "../src/transpile";
import { isString } from "@jxsuite/schema/guards";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

type Node = JxElement | string;

const childrenOf = (doc: JxDocument): Node[] => {
  const { children } = doc;
  return Array.isArray(children) ? children : [];
};

const body = (md: string): Node[] => childrenOf(transpileJxMarkdown(md));

/** Serializing the transpiled source and transpiling it again gives the same tree. */
function roundTrip(md: string, mode: "roundtrip" | "export" = "roundtrip") {
  const doc = transpileJxMarkdown(md);
  expect(transpileJxMarkdown(serializeJxMarkdown(doc, { mode })).children).toEqual(doc.children);
}

/** Serializing a document and transpiling the result gives the document's children. */
function roundTripDoc(doc: JxDocument) {
  expect(transpileJxMarkdown(serializeJxMarkdown(doc)).children).toEqual(doc.children);
}

const el = (node: Node | undefined): JxElement => {
  if (node === undefined || isString(node)) {
    throw new TypeError(`expected an element, got ${String(node)}`);
  }
  return node;
};

const kids = (node: Node | undefined): Node[] => {
  const { children } = el(node);
  return Array.isArray(children) ? children : [];
};

/** The element children of a node. */
const elems = (node: Node | undefined): JxElement[] =>
  kids(node).filter((n): n is JxElement => !isString(n));

/** The node reached by taking the child at each index in turn. */
const at = (node: Node | undefined, ...path: number[]): Node | undefined => {
  let cursor = node;
  for (const index of path) {
    cursor = kids(cursor)[index];
  }
  return cursor;
};

/** Each child's tag, or the text itself for a string. */
const tags = (node: Node | undefined): string[] =>
  kids(node).map((n) => (isString(n) ? n : String(n.tagName)));

describe("reference links and images", () => {
  test("full, collapsed and shortcut reference links resolve to a with href and title", () => {
    const [p] = body("[full][r] [r][] [r]\n\n[r]: http://x.test 'T'\n");
    const links = elems(p);
    expect(links).toHaveLength(3);
    for (const link of links) {
      expect(link.tagName).toBe("a");
      expect(link.attributes).toEqual({ href: "http://x.test", title: "T" });
    }
    expect(links.map((l) => l.textContent)).toEqual(["full", "r", "r"]);
  });

  test("a reference image resolves to img with src, alt and title", () => {
    const [p] = body("![pic][i]\n\n[i]: x.png 'Tt'\n");
    expect(kids(p)).toEqual([
      { attributes: { alt: "pic", src: "x.png", title: "Tt" }, tagName: "img" },
    ]);
  });

  test("labels match regardless of case and spacing, and the first definition wins", () => {
    const [p] = body("[a b][A   B]\n\n[a  b]: first\n[A B]: second\n");
    expect(el(kids(p)[0]).attributes?.href).toBe("first");
  });

  test("an undefined label stays literal text", () => {
    expect(body("[text][nope] and [^zz]")).toEqual([
      { tagName: "p", textContent: "[text][nope] and [^zz]" },
    ]);
  });

  test("a definition inside a container directive or blockquote serves references anywhere", () => {
    const children = body("> [r]: http://q.test\n\n[go][r]\n\n:::note\n[in][r]\n:::\n");
    const link = JSON.stringify(children);
    expect(link.match(/"href":"http:\/\/q.test"/g)).toHaveLength(2);
  });

  test("the formats page keeps its RFC link text", () => {
    const md = [
      "| Extension | Why |",
      "| --- | --- |",
      "| `.md` | Bare `text/markdown` doesn't say _which_ markdown ([RFC 7763][7763]) |",
      "| `.yml` | pre-registration ([RFC 9512][9512] §5) |",
      "",
      "[7763]: https://www.rfc-editor.org/rfc/rfc7763",
      "[9512]: https://www.rfc-editor.org/rfc/rfc9512",
    ].join("\n");
    const { $children } = processMarkdown(md, "formats.md", { directives: true });
    const text = JSON.stringify($children);
    expect(text).toContain('"textContent":"RFC 7763"');
    expect(text).toContain('"href":"https://www.rfc-editor.org/rfc/rfc9512"');
  });

  test("roundTrip writes a reference inline", () => {
    roundTrip("a ![pic][i] [full][r] [r]\n\n[i]: x.png\n[r]: http://r.test 'T'\n");
  });
});

describe("raw HTML", () => {
  test("inline raw HTML nests the Markdown between its tags", () => {
    const [p] = body('a <kbd>K</kbd> b <span class="y">**b** c</span>');
    const [a, kbd, b, span] = kids(p);
    expect([a, b]).toEqual(["a ", " b "]);
    expect(kbd).toEqual({ tagName: "kbd", textContent: "K" });
    expect(el(span).attributes).toEqual({ class: "y" });
    expect(el(span).children).toEqual([{ tagName: "strong", textContent: "b" }, " c"]);
  });

  test("a block start tag and its end tag wrap the paragraphs between them", () => {
    const children = body("<details>\n\nsome *text*\n\n</details>\n");
    expect(children).toHaveLength(1);
    expect(el(children[0]).tagName).toBe("details");
    expect(kids(children[0]).map((n) => el(n).tagName)).toEqual(["p"]);
  });

  test("a stray end tag and an HTML comment produce nothing", () => {
    expect(body("</kbd>\n\n<!-- note -->\n")).toEqual([]);
  });

  test("a placeholder swallowed as raw text falls back to per-node conversion", () => {
    const [p] = body("a <textarea>b</textarea> c");
    expect(kids(p)).toEqual(["a ", { tagName: "textarea" }, "b", " c"]);
    const title = body("<title>\n\nx\n\n</title>\n");
    const titleTags = title.map((n) => (isString(n) ? n : n.tagName));
    expect(titleTags).toContain("p");
  });

  test("an unclosed start tag wraps the rest of its run", () => {
    const [p] = body("a <my-icon /> b");
    expect(kids(p)[0]).toBe("a ");
    expect(el(kids(p)[1]).tagName).toBe("my-icon");
    expect(el(kids(p)[1]).textContent).toBe(" b");
  });

  test("processMarkdown flattens raw HTML like transpileJxMarkdown", () => {
    const md = '<div class="x">hi</div>\n\n<!-- c -->\n\npara\n';
    const content = processMarkdown(md, "/a.md").$children;
    expect(content).toEqual(body(md));
    expect(content).toHaveLength(2);
  });

  test("roundTrip over kbd and details", () => {
    roundTrip("a <kbd>K</kbd> b\n\n<details>\n\npara\n\n</details>\n");
  });
});

describe("task lists and alignment", () => {
  test("task items get a disabled checkbox, checked when marked, and the list gets contains-task-list", () => {
    const [ul] = body("- [x] done\n- [ ] open\n");
    expect(el(ul).className).toBe("contains-task-list");
    const [done, open] = kids(ul);
    expect(el(done).className).toBe("task-list-item");
    expect(kids(done)).toEqual([
      { attributes: { checked: "", disabled: "", type: "checkbox" }, tagName: "input" },
      "done",
    ]);
    expect(kids(open)[0]).toEqual({
      attributes: { disabled: "", type: "checkbox" },
      tagName: "input",
    });
  });

  test("a task item in a loose list starts its paragraph with the checkbox", () => {
    const [ul] = body("- [x] a\n\n- [ ] b\n");
    const [first, second] = kids(ul);
    expect(el(kids(first)[0]).tagName).toBe("p");
    expect(el(at(first, 0, 0)).tagName).toBe("input");
    expect(el(at(second, 0, 0)).attributes?.checked).toBeUndefined();
  });

  test("a loose task item with inline children keeps them after the checkbox", () => {
    const [ul] = body("- [x] a **b**\n\n- c\n");
    const p = at(ul, 0, 0);
    expect(tags(p)).toEqual(["input", "a ", "strong"]);
  });

  test("column alignment sets text-align on every cell of the column", () => {
    const [table] = body("| a | b | c |\n|:-|:-:|--:|\n| 1 | 2 | 3 |\n");
    const rows = kids(table).flatMap((section) => kids(section));
    for (const row of rows) {
      expect(kids(row).map((c) => el(c).style)).toEqual([
        { textAlign: "left" },
        { textAlign: "center" },
        { textAlign: "right" },
      ]);
    }
  });

  test("an unaligned column gets no style", () => {
    const [table] = body("| a | b |\n|:-|---|\n| 1 | 2 |\n");
    expect(el(at(table, 0, 0, 1)).style).toBeUndefined();
  });
});

describe("footnotes", () => {
  const md = "x[^b] y[^a] z[^b]\n\n[^a]: first\n\n[^b]: second *em*\n\n[^c]: unused\n";

  test("footnote references are numbered in first-reference order", () => {
    const [p] = body(md);
    const sups = elems(p);
    expect(sups.map((s) => el(at(s, 0)).textContent)).toEqual(["1", "2", "1"]);
    expect(el(at(sups[0], 0)).attributes).toEqual({
      "data-footnote-ref": "",
      href: "#fn-b",
      role: "doc-noteref",
    });
  });

  test("a repeated reference gets its own id and its own backlink", () => {
    const [p, section] = body(md);
    const refs = elems(p).map((sup) => el(at(sup, 0)));
    const ids = refs.map((ref) => ref.id);
    expect(ids).toEqual(["fnref-b", "fnref-a", "fnref-b-2"]);
    const li = at(section, 0, 0);
    const anchors = elems(at(li, 0)).filter((n) => n.tagName === "a");
    const hrefs = anchors.map((a) => a.attributes?.href);
    expect(hrefs).toEqual(["#fnref-b", "#fnref-b-2"]);
  });

  test("definitions become a trailing section; unreferenced ones come last with no backlink", () => {
    const children = body(md);
    const section = el(children.at(-1));
    expect(section.tagName).toBe("section");
    expect(section.className).toBe("footnotes");
    expect(section.attributes).toEqual({ "data-footnotes": "", role: "doc-endnotes" });
    const items = kids(kids(section)[0]);
    expect(items.map((li) => el(li).id)).toEqual(["fn-b", "fn-a", "fn-c"]);
    expect(JSON.stringify(items[2])).not.toContain("backref");
    expect(JSON.stringify(items[0])).toContain("backref");
  });

  test("a note that does not end in a paragraph gets its backlinks after its content", () => {
    const children = body("x[^a]\n\n[^a]:\n    ```\n    code\n    ```\n");
    const li = at(children.at(-1), 0, 0);
    const last = kids(li).at(-1);
    expect(el(last).attributes?.["data-footnote-backref"]).toBe("");
  });

  test("an undefined footnote label stays literal text", () => {
    expect(body("x[^zz]")).toEqual([{ tagName: "p", textContent: "x[^zz]" }]);
  });
});

describe("tight and loose lists", () => {
  test("a tight list's items hold their text directly", () => {
    expect(body("- a\n- b\n")).toEqual([
      {
        children: [
          { tagName: "li", textContent: "a" },
          { tagName: "li", textContent: "b" },
        ],
        tagName: "ul",
      },
    ]);
  });

  test("a loose list keeps its paragraphs", () => {
    const [ul] = body("- a\n\n- b\n");
    expect(elems(ul).map((li) => tags(li))).toEqual([["p"], ["p"]]);
  });

  test("a tight item with a nested list keeps its text before the list", () => {
    const [ul] = body("- a\n  - b\n");
    const [li] = kids(ul);
    expect(kids(li)[0]).toBe("a");
    expect(el(kids(li)[1]).tagName).toBe("ul");
  });

  test("a task item in a tight list starts with its checkbox", () => {
    const [ul] = body("- [x] a\n  - b\n");
    expect(el(at(ul, 0, 0)).tagName).toBe("input");
  });

  test("raw HTML pairs inside a tight item still meet", () => {
    const [ul] = body("- a <kbd>K</kbd>\n");
    expect(kids(kids(ul)[0])).toEqual(["a ", { tagName: "kbd", textContent: "K" }]);
  });

  test("both modes write a loose list with blank lines between its items", () => {
    for (const mode of ["roundtrip", "export"] as const) {
      expect(serializeJxMarkdown(transpileJxMarkdown("- a\n\n- b\n"), { mode })).toBe(
        "- a\n\n- b\n",
      );
      expect(serializeJxMarkdown(transpileJxMarkdown("- a\n- b\n"), { mode })).toBe("- a\n- b\n");
    }
  });

  test("a list mixing text items and paragraph items re-parses loose", () => {
    const doc: JxDocument = {
      children: [
        {
          children: [
            { tagName: "li", textContent: "x" },
            { children: [{ tagName: "p", textContent: "y" }], tagName: "li" },
          ],
          tagName: "ul",
        },
      ],
    };
    const again = childrenOf(transpileJxMarkdown(serializeJxMarkdown(doc)));
    expect(kids(kids(again[0])[0])).toEqual([{ tagName: "p", textContent: "x" }]);
  });

  test("roundTrip over tight, loose and nested lists", () => {
    roundTrip("- a\n- b\n  - c\n  - d\n\n1. x\n2. y\n\n- p\n\n- q\n");
    roundTrip("- p\n\n  more\n\n- q\n", "export");
  });

  test("roundTripDoc over Studio's li shapes", () => {
    roundTripDoc({
      children: [{ children: [{ tagName: "li", textContent: "Item" }], tagName: "ul" }],
    });
    roundTripDoc({
      children: [
        {
          children: [{ children: ["a ", { tagName: "strong", textContent: "b" }], tagName: "li" }],
          tagName: "ul",
        },
      ],
    });
    roundTripDoc({
      children: [
        {
          children: [{ children: ["a ", { tagName: "sup", textContent: "2" }], tagName: "li" }],
          tagName: "ul",
        },
      ],
    });
  });

  test("a nested list among an item's phrasing content converts as its own block", () => {
    roundTripDoc({
      children: [
        {
          children: [
            {
              children: ["a", { children: [{ tagName: "li", textContent: "b" }], tagName: "ul" }],
              tagName: "li",
            },
          ],
          tagName: "ul",
        },
      ],
    });
  });
});

describe("GFM syntax written back", () => {
  const md =
    "x[^note] again[^note]\n\n- [x] done\n- [ ] open\n\n| a | b |\n| :- | -: |\n| 1 | 2 |\n\n[^note]: two\n";

  for (const mode of ["roundtrip", "export"] as const) {
    test(`${mode} writes footnotes, task items and the alignment row as GFM`, () => {
      const out = serializeJxMarkdown(transpileJxMarkdown(md), { mode });
      expect(out).toContain("[^note]");
      expect(out).toContain("[^note]: two");
      expect(out).toContain("- [x] done");
      expect(out).toContain("- [ ] open");
      expect(out).toContain("| :- |");
      expect(out).toContain("-: |");
    });
  }

  test("roundTrip over footnotes, task items and alignment, including a note referenced twice", () => {
    roundTrip(md);
  });

  test("a footnote label comes back lowercased", () => {
    const out = serializeJxMarkdown(transpileJxMarkdown("x[^Note]\n\n[^Note]: y\n"));
    expect(out).toContain("[^note]: y");
  });

  test("serializing leaves the document's decoration in place", () => {
    const doc = transpileJxMarkdown(md);
    const before = structuredClone(doc);
    serializeJxMarkdown(doc);
    serializeJxMarkdown(doc, { mode: "export" });
    expect(doc).toEqual(before);
  });

  test("a cell whose text-align differs from its column's keeps its style", () => {
    const doc = transpileJxMarkdown("| a | b |\n|:-|:-|\n| 1 | 2 |\n");
    const table = el(childrenOf(doc)[0]);
    const bodyRow = at(table, 1, 0);
    el(kids(bodyRow)[0]).style = { textAlign: "right" };
    const out = serializeJxMarkdown(doc);
    expect(out).toContain(":::table");
    expect(out).not.toContain("| :- |");
  });

  test("an element with its own class keeps it beside the task decoration", () => {
    const doc = transpileJxMarkdown("- [x] a\n");
    const ul = el(childrenOf(doc)[0]);
    ul.className = "contains-task-list extra";
    expect(serializeJxMarkdown(doc)).toContain(":::ul");
  });

  test("a table without alignment and a task class without a checkbox are left alone", () => {
    roundTrip("| a |\n| - |\n| 1 |\n");
    const out = serializeJxMarkdown({
      children: [
        {
          children: [{ className: "task-list-item", tagName: "li", textContent: "x" }],
          tagName: "ul",
        },
      ],
    });
    expect(out).toContain(":::");
  });
});
