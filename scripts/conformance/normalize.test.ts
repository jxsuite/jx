import { describe, expect, test } from "bun:test";
import { normalize, RULES } from "./normalize.ts";

describe("normalize", () => {
  test("the origin a capture was served from is removed", () => {
    expect(normalize('a href="http://127.0.0.1:41233/docs/"')).toBe('a href="/docs/"');
    expect(normalize("HTTP 404: http://localhost:3000/x.png")).toBe("HTTP 404: /x.png");
    expect(normalize('a href="https://example.com:8443/"')).toBe(
      'a href="https://example.com:8443/"',
    );
  });

  test("an optimized variant keeps its stem, width and format, and loses its hash", () => {
    expect(
      normalize(
        'srcset="/images/_optimized/hero-640-a1b2c3d4.avif 640w, /images/_optimized/hero-1280-a1b2c3d4.avif 1280w"',
      ),
    ).toBe(
      'srcset="/images/_optimized/hero-640.avif 640w, /images/_optimized/hero-1280.avif 1280w"',
    );
    // A stem that itself ends in digits and a dash is not mistaken for the width and hash.
    expect(normalize("/images/_optimized/photo-2024-320-deadbeef.jpeg")).toBe(
      "/images/_optimized/photo-2024-320.jpeg",
    );
    // Outside the optimized directory a hash-like name is the author's own.
    expect(normalize("/images/hero-640-a1b2c3d4.avif")).toBe("/images/hero-640-a1b2c3d4.avif");
  });

  test("a content hash in a query is blanked, and another parameter is kept", () => {
    expect(normalize("/cdn-cgi/image/width=640/hero.png?v=0a1b2c3d 640w")).toBe(
      "/cdn-cgi/image/width=640/hero.png?v=# 640w",
    );
    expect(normalize("/page?id=7&v=0a1b2c3d")).toBe("/page?id=7&v=#");
    expect(normalize("/page?v=latest")).toBe("/page?v=latest");
  });

  test("a minted style handle leaves the class list, and an authored class stays", () => {
    expect(normalize('div class="card jx-12 wide" @0,0,10,10')).toBe(
      'div class="card wide" @0,0,10,10',
    );
    expect(normalize('p class="jx-3" id="x"')).toBe('p id="x"');
    expect(normalize('p class="jx-large"')).toBe('p class="jx-large"');
  });

  test("an island's ordinal is dropped from its tag", () => {
    expect(normalize("jx-island-3 @0,0,5,5")).toBe("jx-island @0,0,5,5");
    expect(normalize("my-jx-island-3x")).toBe("my-jx-island-3x");
  });

  test("a chosen subset of the rules can be applied alone", () => {
    const origin = RULES.filter((rule) => rule.name === "origin");
    expect(normalize('img class="jx-1" src="http://127.0.0.1:9/a.png"', origin)).toBe(
      'img class="jx-1" src="/a.png"',
    );
  });
});

test("every rule says why its difference is not behaviour, and has a name of its own", () => {
  const names = RULES.map((rule) => rule.name);
  expect(new Set(names).size).toBe(names.length);
  for (const rule of RULES) {
    expect(rule.why.length).toBeGreaterThan(40);
  }
});
