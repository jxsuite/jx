/**
 * The one custom-element-name rule, `src/create/element-name.ts`: HTML's production, its reserved
 * names, the sentence each refusal earns, and the deriver that turns a display name into a tag.
 */
import { describe, expect, test } from "bun:test";
import {
  customElementNameProblem,
  deriveTagName,
  RESERVED_ELEMENT_NAMES,
  TAG_PREFIX,
} from "../src/create/element-name";

describe("valid names", () => {
  test("accepts what HTML accepts, including the names the two old rules disagreed about", () => {
    for (const name of [
      "my-card",
      "x-card.v2",
      "my_el-x",
      "a-",
      "pricing-table",
      "math-α",
      "x-😀",
    ]) {
      expect([name, customElementNameProblem(name)]).toEqual([name, ""]);
    }
  });

  test("refuses no hyphen, a leading digit or upper case letter, and a reserved name", () => {
    for (const name of ["card", "1-card", "My-card", "my-Card", "my card-x", "-card", ""]) {
      expect(customElementNameProblem(name)).not.toBe("");
    }
    for (const name of RESERVED_ELEMENT_NAMES) {
      expect(customElementNameProblem(name)).not.toBe("");
    }
  });
});

describe("customElementNameProblem", () => {
  test("names the one thing to change, in the order a reader fixes them", () => {
    expect(customElementNameProblem("")).toBe("Enter a tag name.");
    expect(customElementNameProblem("9-lives")).toBe("A tag name starts with a lower-case letter.");
    expect(customElementNameProblem("my-Card")).toBe("A tag name is lower case.");
    expect(customElementNameProblem("my@card")).toBe("“@” cannot appear in a tag name.");
    expect(customElementNameProblem("card")).toBe("A tag name needs a hyphen, such as my-card.");
    expect(customElementNameProblem("font-face")).toBe("<font-face> is reserved by HTML.");
    expect(customElementNameProblem("pricing-table")).toBe("");
  });
});

describe("deriveTagName", () => {
  test("slugifies a display name and keeps a hyphen it already has", () => {
    expect(deriveTagName("Pricing table")).toBe("pricing-table");
    expect(deriveTagName("  Hero -- Block  ")).toBe("hero-block");
  });

  test("prefixes a hyphenless or digit-led slug so the tag is valid", () => {
    expect(deriveTagName("Hero")).toBe(`${TAG_PREFIX}hero`);
    expect(deriveTagName("2 columns")).toBe("site-2-columns");
    expect(customElementNameProblem(deriveTagName("Hero"))).toBe("");
  });

  test("a name with nothing usable in it derives nothing, which the validator refuses", () => {
    expect(deriveTagName("!!!")).toBe("");
    expect(customElementNameProblem(deriveTagName("!!!"))).toBe("Enter a tag name.");
  });
});
