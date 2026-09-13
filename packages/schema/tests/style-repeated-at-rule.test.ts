import { describe, expect, test } from "bun:test";

const { validateDocument } = await import("../src/schema");

/**
 * A declaration at-rule may be written more than once, as an array of blocks.
 *
 * An object's keys are unique, so a key names a rule once — and `@font-face` is the at-rule whose
 * identity is not in its key. A family with three weights therefore had no spelling at all, which
 * is what kept Studio's three vendored JetBrains Mono faces in a hand-written stylesheet.
 *
 * The schema and the builder (`blocksOf`, `packages/runtime/src/css.ts`) scope the form the same
 * way, and they must: a schema admitting an array the builder drops validates a document that
 * silently renders nothing.
 */
const doc = (style: Record<string, unknown>) => ({ style, tagName: "div" });

describe("a declaration at-rule may hold several blocks", () => {
  test("three faces of one family, which is the case it exists for", async () => {
    const result = await validateDocument(
      doc({
        "@font-face": [
          { fontFamily: "JetBrains Mono", fontWeight: "400", src: 'url("a.woff2")' },
          { fontFamily: "JetBrains Mono", fontWeight: "500", src: 'url("b.woff2")' },
          { fontFamily: "JetBrains Mono", fontWeight: "700", src: 'url("c.woff2")' },
        ],
      }),
    );
    expect(result.errors).toBeNull();
    expect(result.valid).toBe(true);
  });

  /** Whether a style block validates as a document. */
  const accepts = async (style: Record<string, unknown>): Promise<boolean> => {
    const result = await validateDocument(doc(style));
    return result.valid;
  };

  /* One test per at-rule rather than one loop: a validation against the document schema costs
     over half a second on a CI runner, and eight of them in one test crossed the 5s timeout. */
  for (const key of ["@font-face", "@property --a", "@position-try --p", "@counter-style c"]) {
    test(`${key} takes several blocks, and one block under the key is still fine`, async () => {
      expect(await accepts({ [key]: [{ syntax: "a" }] }), key).toBe(true);
      expect(await accepts({ [key]: { syntax: "a" } }), key).toBe(true);
    });
  }

  test("a selector key refuses an array, because the builder drops one", async () => {
    expect(await accepts({ ":hover": [{ color: "red" }] })).toBe(false);
    expect(await accepts({ "@(min-width: 40rem)": [{ color: "red" }] })).toBe(false);
  });

  test("an array of anything but blocks is refused", async () => {
    expect(await accepts({ "@font-face": ["a", "b"] })).toBe(false);
    expect(await accepts({ "@font-face": [] })).toBe(false);
    expect(await accepts({ color: [{ a: "b" }] })).toBe(false);
  });
});

describe("a style block may document itself", () => {
  const accepts = async (style: Record<string, unknown>): Promise<boolean> => {
    const result = await validateDocument(doc(style));
    return result.valid;
  };

  test("$description is prose, at any depth", async () => {
    expect(await accepts({ $description: "why this rule exists", color: "red" })).toBe(true);
    expect(await accepts({ "&:hover": { $description: "why the hover", color: "blue" } })).toBe(
      true,
    );
    expect(await accepts({ "@font-face": [{ $description: "the face", fontFamily: "A" }] })).toBe(
      true,
    );
  });

  test("it is a string, and the generator carries the constraint to every depth", async () => {
    /* `buildCssProperties` REPLACES the block's properties rather than adding to them, so the
       authored `$description` entry was dropped and a number validated. The generated schema is the
       one every consumer reads, so the constraint has to survive generation to exist at all. */
    expect(await accepts({ $description: 42 })).toBe(false);
    expect(await accepts({ "&:hover": { $description: 42 } })).toBe(false);
  });
});
