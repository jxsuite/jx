import { describe, expect, test } from "bun:test";
import css from "@webref/css";
import cssMeta from "../data/css-meta.json";
import { INHERITED_PROPERTIES, tagAncestorSources } from "../src/style/tag-inheritance";
import type { JxStyle } from "@jxsuite/schema/types";

/** One property entry in @webref/css (the package ships no declarations). */
interface WebrefCssProperty {
  legacyAliasOf?: string;
  styleDeclaration?: string[];
  inherited?: string;
}

/** The part of @webref/css's `listAll()` result this test reads. */
interface WebrefCss {
  properties: WebrefCssProperty[];
}

/** Every camelCase property name the specification says CSS inherits. */
async function specInherited(): Promise<Set<string>> {
  /* SAFETY: @webref/css's listAll() resolves to { properties: [...] } whose entries carry the
     members WebrefCssProperty names, as its README documents and scripts/gen-webdata.ts reads. */
  const { properties } = (await css.listAll()) as WebrefCss;
  const names = new Set<string>();
  for (const prop of properties) {
    if (prop.legacyAliasOf || prop.inherited !== "yes") {
      continue;
    }
    const camel = (prop.styleDeclaration ?? []).find(
      (name) => !name.includes("-") && !/^[A-Z]/.test(name),
    );
    if (camel) {
      names.add(camel);
    }
  }
  return names;
}

describe("INHERITED_PROPERTIES", () => {
  test("is exactly the panel's properties that the specification says are inherited", async () => {
    const inherited = await specInherited();
    const drawn = Object.keys(cssMeta.$defs);
    // Every entry is inherited and drawn …
    for (const prop of INHERITED_PROPERTIES) {
      expect(inherited.has(prop)).toBe(true);
      expect(drawn).toContain(prop);
    }
    // … and no drawn, inherited property is missing.
    expect(drawn.filter((prop) => inherited.has(prop) && !INHERITED_PROPERTIES.has(prop))).toEqual(
      [],
    );
  });
});

describe("tagAncestorSources", () => {
  const style: JxStyle = {
    "--font-body": "'Mulish', sans-serif",
    "@--dark": { color: "white", table: { color: "silver" } },
    body: { letterSpacing: "0.01em" },
    color: "black",
    fontFamily: "var(--font-body)",
    fontSize: 17,
    margin: "0",
    table: { color: "navy", th: { fontWeight: "700" } },
  };

  test("a top-level tag inherits the flat properties and the body rule, and nothing that does not inherit", () => {
    expect(tagAncestorSources(style, "h1", null)).toEqual({
      color: { donor: "body", value: "black" },
      fontFamily: { donor: "body", value: "var(--font-body)" },
      fontSize: { donor: "body", value: 17 },
      letterSpacing: { donor: "body", value: "0.01em" },
    });
  });

  test("a nested tag takes its nearest ancestor's value first", () => {
    const sources = tagAncestorSources(style, "table th", null);
    expect(sources["color"]).toEqual({ donor: "table", value: "navy" });
    expect(sources["fontFamily"]).toEqual({ donor: "body", value: "var(--font-body)" });
    // The tag's own declarations are not inherited from anything.
    expect(sources["fontWeight"]).toBeUndefined();
  });

  test("a context's blocks layer over each donor's base", () => {
    expect(tagAncestorSources(style, "h1", "--dark")["color"]).toEqual({
      donor: "body",
      value: "white",
    });
    expect(tagAncestorSources(style, "table th", "--dark")["color"]).toEqual({
      donor: "table",
      value: "silver",
    });
  });

  test("the body rule does not inherit from itself", () => {
    expect(tagAncestorSources(style, "body", null)["letterSpacing"]).toBeUndefined();
  });
});
