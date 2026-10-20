/**
 * A save given the text the file was read from changes only what was edited.
 *
 * The serializer's `source` option (`source-style.ts`): untouched frontmatter keys keep their own
 * spelling, and the body keeps the markers it was written with.
 */

import { describe, expect, test } from "bun:test";
import { serializeJxMarkdown } from "../src/serialize";
import {
  bodyText,
  frontmatterText,
  markdownMarkers,
  sameValue,
  spliceFrontmatter,
} from "../src/source-style";
import { transpileJxMarkdown } from "../src/transpile";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxElement } from "@jxsuite/schema/types";

const SOURCE = [
  "---",
  "# Contact details",
  'phone: "717-669-8739"',
  "summary: A long summary the author",
  "  wrapped over two lines.",
  "cta_text: >-",
  "  Call us today",
  "tags:",
  "  - one",
  "  - two",
  "",
  "title: Old title # the H1",
  "---",
  "",
  "Some _emphasis_ and __strong__ text.",
  "",
  "* first",
  "* second",
  "",
].join("\n");

/** Read SOURCE, apply `edit` to the parsed document, and write it back with the source. */
function save(edit: (doc: ReturnType<typeof transpileJxMarkdown>) => void, source = SOURCE) {
  const doc = transpileJxMarkdown(source);
  edit(doc);
  return serializeJxMarkdown(doc, { source });
}

describe("frontmatter keeps its own spelling", () => {
  test("an unedited document writes back byte for byte", () => {
    expect(save(() => {})).toBe(SOURCE);
  });

  test("editing one key rewrites that key only, keeping the comment after it", () => {
    const out = save((doc) => {
      doc.title = "New title";
    });
    expect(out).toBe(SOURCE.replace("title: Old title # the H1", "title: New title"));
  });

  test("a changed key keeps the comment and blank lines that follow its value", () => {
    const out = save((doc) => {
      doc.tags = ["one", "three"];
    });
    expect(out).toContain("tags:\n  - one\n  - three\n\ntitle: Old title");
    expect(out).toContain('phone: "717-669-8739"');
  });

  test("a removed key is dropped and a new key is appended", () => {
    const out = save((doc) => {
      delete doc.cta_text;
      doc.draft = true;
    });
    expect(out).not.toContain("cta_text");
    expect(out).toContain("title: Old title # the H1\ndraft: true\n---");
  });

  test("a source with no frontmatter block writes the whole block", () => {
    const source = "Body only.\n";
    const doc = transpileJxMarkdown(source);
    doc.title = "Added";
    expect(serializeJxMarkdown(doc, { source })).toBe("---\ntitle: Added\n---\n\nBody only.\n");
  });

  test("a flow-mapping source cannot be spliced and is written whole", () => {
    expect(spliceFrontmatter({ a: 2 }, "{ a: 1 }", () => "a: 2")).toBeNull();
    expect(spliceFrontmatter({ a: 2 }, "a: 1\na: 2", () => "a: 2")).toBeNull();
    expect(spliceFrontmatter({ a: 2 }, "? [x]\n: 1", () => "x")).toBeNull();
    expect(spliceFrontmatter({ a: 2 }, "- a", () => "x")).toBeNull();
  });

  test("a key with no value and an empty source block", () => {
    expect(spliceFrontmatter({ a: null, b: 1 }, "a:\nb: 0", () => "b: 1")).toBe("a:\nb: 1");
    expect(spliceFrontmatter({ b: 1 }, "", () => "b: 1")).toBeNull();
    expect(frontmatterText("---\n---\nx")).toBe("");
    expect(frontmatterText("no block")).toBeNull();
    expect(bodyText("---\na: 1\n---\nbody")).toBe("body");
  });
});

describe("value equality", () => {
  test("compares JSON values structurally, ignoring key order and undefined keys", () => {
    expect(sameValue({ a: [1, { b: 2 }], c: undefined }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue([1, 2], [1, 3])).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue("1", 1)).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("the body keeps its markers", () => {
  test("underscore emphasis and strong, and star bullets, survive an edit elsewhere", () => {
    const out = save((doc) => {
      doc.title = "New title";
    });
    expect(out).toContain("Some _emphasis_ and __strong__ text.");
    expect(out).toContain("* first\n* second");
  });

  test("a body edit keeps the markers of the text around it", () => {
    const out = save((doc) => {
      const children = Array.isArray(doc.children) ? doc.children : [];
      const [first] = children;
      if (isNodeObject(first)) {
        const p: JxElement = first;
        p.children = [...(Array.isArray(p.children) ? p.children : []), " More."];
      }
    });
    expect(out).toContain("Some _emphasis_ and __strong__ text. More.");
  });

  test("a body with no markers keeps the house defaults", () => {
    const tree = { children: [{ type: "text", value: "x" }], type: "root" };
    expect(markdownMarkers(tree, "x")).toEqual({ bullet: "-", emphasis: "*", strong: "*" });
  });
});
