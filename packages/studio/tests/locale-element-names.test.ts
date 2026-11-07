/**
 * What Studio calls an HTML element, `src/locale/element-names.ts`: the English catalog's
 * completeness against what the Insert palette offers, the language a reader gets, and the
 * fallbacks that keep a card named when a catalog is missing an entry.
 */
import { afterEach, describe, expect, test } from "bun:test";
import en from "../data/locales/en/elements.json";
import type { ElementCatalog } from "../src/locale/element-names";
import webdata from "../data/webdata.json";
import {
  SOURCE_LOCALE,
  categoryName,
  elementDescription,
  elementName,
  resolveLocale,
  studioLocale,
} from "../src/locale/element-names";

/** The English catalog, read through the open shape the module reads every catalog with. */
const source: ElementCatalog = en;

/** The `navigator` members a test has replaced, with what each was before, to put back. */
const replaced: [key: string, before: PropertyDescriptor | undefined][] = [];

/** Answer `navigator[key]` with `value` until the test ends, the way a browser setting would. */
function shadowNavigator(key: "language" | "languages", value: string | readonly string[]): void {
  replaced.push([key, Object.getOwnPropertyDescriptor(navigator, key)]);
  Object.defineProperty(navigator, key, { configurable: true, get: () => value });
}

afterEach(() => {
  /* Newest first, so a member replaced twice ends as it started. An own property that was not
     there before is deleted, which uncovers the prototype's getter again. */
  for (const [key, before] of replaced.splice(0).toReversed()) {
    if (before) {
      Object.defineProperty(navigator, key, before);
    } else {
      Reflect.deleteProperty(navigator, key);
    }
  }
});

describe("the English catalog", () => {
  test("names and describes every element the palette offers", () => {
    for (const { tag } of Object.values(webdata.elements).flat()) {
      const entry = source.elements[tag];
      expect(entry?.name.length ?? 0, tag).toBeGreaterThan(0);
      expect(entry?.description.length ?? 0, tag).toBeGreaterThan(0);
    }
  });

  test("names every category the palette draws", () => {
    for (const key of Object.keys(webdata.elements)) {
      expect(source.categories[key], key).toBeString();
    }
  });

  test("gives no two elements the same name, so a filter by name finds one card", () => {
    const names = Object.values(en.elements).map((entry) => entry.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  test("holds no entry for an element the palette does not offer", () => {
    const offered = new Set(
      Object.values(webdata.elements)
        .flat()
        .map(({ tag }) => tag),
    );
    expect(Object.keys(en.elements).filter((tag) => !offered.has(tag))).toEqual([]);
  });
});

describe("resolveLocale", () => {
  test("takes the first preference with a catalog, whole and case-insensitively", () => {
    expect(resolveLocale(["de", "FR"], ["en", "fr"])).toBe("fr");
  });

  test("tries a preference's base language before the next preference", () => {
    expect(resolveLocale(["fr-CA", "de"], ["en", "fr", "de"])).toBe("fr");
  });

  test("prefers the exact regional catalog to the base language", () => {
    expect(resolveLocale(["pt-BR"], ["pt", "pt-BR"])).toBe("pt-BR");
  });

  test("falls back to English when nothing matches", () => {
    expect(resolveLocale(["ja", "ko"], ["en", "fr"])).toBe(SOURCE_LOCALE);
    expect(resolveLocale([], ["en"])).toBe(SOURCE_LOCALE);
  });

  test("reads the catalogs Studio ships by default", () => {
    expect(resolveLocale(["en-GB"])).toBe("en");
  });
});

describe("studioLocale", () => {
  test("follows the browser's preferred languages", () => {
    shadowNavigator("languages", ["en-US", "fr"]);
    expect(studioLocale()).toBe("en");
  });

  test("falls back to the one language a browser without a list reports", () => {
    shadowNavigator("languages", []);
    shadowNavigator("language", "en-AU");
    expect(studioLocale()).toBe("en");
  });

  test("ignores a blank answer and reads English", () => {
    shadowNavigator("languages", []);
    shadowNavigator("language", "");
    expect(studioLocale()).toBe("en");
  });

  test("reads the one language a navigator without a list reports", () => {
    replaced.push(["languages", Object.getOwnPropertyDescriptor(navigator, "languages")]);
    Object.defineProperty(navigator, "languages", { configurable: true, value: undefined });
    shadowNavigator("language", "en-NZ");
    expect(studioLocale()).toBe("en");
  });

  test("is English where there is no navigator to ask", () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: undefined });
    try {
      expect(studioLocale()).toBe("en");
    } finally {
      Object.defineProperty(globalThis, "navigator", { configurable: true, value: original });
    }
  });
});

describe("lookups", () => {
  test("name an element, a category and what an element is for", () => {
    expect(elementName("ul")).toBe("Bulleted list");
    expect(elementName("h1", "en")).toBe("Heading 1");
    expect(categoryName("inline")).toBe("Inline text");
    expect(elementDescription("p")).toBe("A block of body text.");
  });

  test("a language without a catalog reads the English one", () => {
    expect(elementName("img", "xx")).toBe("Image");
    expect(categoryName("media", "xx")).toBe("Media");
    expect(elementDescription("img", "xx")).toBe("A picture.");
  });

  test("a tag or key no catalog knows is shown as itself, with no description", () => {
    expect(elementName("my-widget")).toBe("my-widget");
    expect(categoryName("future")).toBe("future");
    expect(elementDescription("my-widget")).toBe("");
  });
});
