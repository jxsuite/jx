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

  test("every declaration at-rule, and one block under the key is still fine", async () => {
    for (const key of ["@font-face", "@property --a", "@position-try --p", "@counter-style c"]) {
      expect(await accepts({ [key]: [{ syntax: "a" }] }), key).toBe(true);
      expect(await accepts({ [key]: { syntax: "a" } }), key).toBe(true);
    }
  });

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
