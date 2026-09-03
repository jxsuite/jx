import { describe, expect, test } from "bun:test";

const { validateDocument } = await import("../src/schema");

/**
 * A style declaration value may be a `{ $ref }`.
 *
 * The runtime has always resolved one — `CssBuildOptions.resolveValue` is typed for it and
 * `declarationValue` has an explicit ref branch (spec.md §9.6). Only the validator refused, because
 * every one of the 1,633 generated CSS properties was `string | number`, so a document asking a row
 * to render in the face it names reported "must be string". It is the declaration that lets a
 * component internalize a value it cannot know until it renders.
 */
const doc = (style: Record<string, unknown>) => ({ style, tagName: "div" });

describe("a style value may be a ref", () => {
  test("on an enumerated CSS property", async () => {
    const result = await validateDocument(doc({ fontFamily: { $ref: "$map/item/face" } }));
    expect(result.errors).toBeNull();
    expect(result.valid).toBe(true);
  });

  test("on a custom property, which is where a component keeps a per-instance value", async () => {
    const result = await validateDocument(doc({ "--row-face": { $ref: "$map/item/face" } }));
    expect(result.valid).toBe(true);
  });

  test("every ref spelling the schema knows", async () => {
    for (const ref of ["#/state/face", "$map/item/face", "$map/index"]) {
      const result = await validateDocument(doc({ color: { $ref: ref } }));
      expect(result.valid, ref).toBe(true);
    }
  });

  test("a nested block is still a nested block", async () => {
    const nested = await validateDocument(
      doc({ ":hover": { color: "blue" }, "@(min-width: 40rem)": { ":hover": { color: "red" } } }),
    );
    expect(nested.valid).toBe(true);
  });

  test("a template string is untouched", async () => {
    const templated = await validateDocument(doc({ color: "${state.c}" }));
    expect(templated.valid).toBe(true);
  });

  test("an object that is not a ref is still refused on a known property", async () => {
    const bogus = await validateDocument(doc({ color: { nope: 1 } }));
    expect(bogus.valid).toBe(false);
  });

  test("a ref to nowhere is refused, so the permission is not a hole", async () => {
    // The value must still be a ref the schema recognises; `AnyRef` is a closed union of patterns.
    const bad = await validateDocument(doc({ color: { $ref: "not-a-pointer" } }));
    expect(bad.valid).toBe(false);
  });

  test("a ref carrying anything else is refused", async () => {
    const extra = await validateDocument(doc({ color: { $ref: "#/state/c", nope: 1 } }));
    expect(extra.valid).toBe(false);
  });
});
