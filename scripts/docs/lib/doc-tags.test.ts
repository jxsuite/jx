import { describe, expect, test } from "bun:test";

import { DOCS_TAG_RE } from "./doc-tags.ts";

function slugs(source: string): string[] {
  return [...source.matchAll(DOCS_TAG_RE)].map((match) => match[1] ?? "");
}

describe("DOCS_TAG_RE", () => {
  test("reads every tag's slug, nested paths included", () => {
    const source = "/**\n * @docs extending/contributing/docs\n * @docs start/install\n */";
    expect(slugs(source)).toEqual(["extending/contributing/docs", "start/install"]);
  });

  test("stops the slug at the first character a slug cannot hold", () => {
    expect(slugs("// @docs reference/cli.\n")).toEqual(["reference/cli"]);
  });

  test("ignores a bare @docs with no slug after it", () => {
    expect(slugs("// @docs\n")).toEqual([]);
  });
});
