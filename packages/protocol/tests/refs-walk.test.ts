/**
 * The reference walk's reading side and its edges (`specs/project-state.md` §12): the tag counts
 * the dependency graph and the usage query read, the walk's own guards, and the path tests the
 * rewrite resolves through. The rewrite's cases are `refs.test.ts` and `ref-paths.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@jxsuite/schema/types";
import { looksLikeFileRef, projectPathsForRootedRef } from "../src/ref-paths";
import { collectTagUses, countTagUses, rewriteDocRefs, walkDocRefs } from "../src/refs";

/** Every reference the walk offers in `doc`, as `<refType> <value>`. */
function offered(doc: JsonValue): string[] {
  const seen: string[] = [];
  walkDocRefs(doc, (value, refType) => {
    seen.push(`${refType} ${value}`);
    return null;
  });
  return seen;
}

describe("the tag counts", () => {
  const doc: JsonValue = {
    children: [{ tagName: "x-a" }, { children: [{ tagName: "x-a" }, { tagName: "x-b" }] }],
    tagName: "main",
  };

  test("count one tag, or every tag at once, by the same walk", () => {
    expect(countTagUses(doc, "x-a")).toBe(2);
    expect(countTagUses(doc, "x-none")).toBe(0);
    expect([...collectTagUses(doc)].toSorted()).toEqual([
      ["main", 1],
      ["x-a", 2],
      ["x-b", 1],
    ]);
  });
});

describe("the walk", () => {
  test("walks a list at the top and ignores what is not an object", () => {
    expect(offered([{ src: "a.png" }, "b.png", 3, null])).toEqual(["attr a.png"]);
    expect(offered("a.png")).toEqual([]);
  });

  test("a reference key that holds no string is no reference", () => {
    expect(offered({ $elements: [{ $ref: 3 }, 4], $ref: 2, src: true })).toEqual([]);
  });

  test("a list under any other key offers its file-shaped strings and walks its objects", () => {
    expect(
      offered({ gallery: ["a.png", "not a file", { cover: "c.jpg" }], textContent: ["d.png"] }),
    ).toEqual(["path a.png", "path c.jpg"]);
  });

  test("a visitor's answer is written back into a list", () => {
    const doc: JsonValue = { gallery: ["a.png"] };
    walkDocRefs(doc, () => "b.png");
    expect(doc).toEqual({ gallery: ["b.png"] });
  });
});

describe("the path tests", () => {
  test("a file-shaped string has no space, no template and a lettered extension", () => {
    expect(looksLikeFileRef("")).toBe(false);
    expect(looksLikeFileRef("a b.png")).toBe(false);
    expect(looksLikeFileRef("${x}.png")).toBe(false);
    expect(looksLikeFileRef("https://example.com/a.png")).toBe(false);
    expect(looksLikeFileRef("media/a.png")).toBe(true);
  });

  test("a rooted reference names a file in each lane that serves it", () => {
    expect(projectPathsForRootedRef("/a.png", [])).toEqual(["a.png", "public/a.png"]);
  });

  test("a rooted reference follows its file to the lane that serves it", () => {
    const doc: JsonValue = { src: "/a.png" };
    expect(
      rewriteDocRefs(doc, {
        docNewDir: "/p/pages",
        docOldDir: "/p/pages",
        newAbs: "/p/b.png",
        oldAbs: "/p/a.png",
        root: "/p",
      }).changes,
    ).toEqual([{ from: "/a.png", refType: "attr", to: "/b.png" }]);
  });
});
