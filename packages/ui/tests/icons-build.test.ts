import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assetPath,
  buildManifest,
  extractPathData,
  ICON_VIEW_BOX,
  ICON_WEIGHTS,
} from "../src/icons-build.ts";
import type { IconList, IconManifest } from "../src/icons-build.ts";

const here = resolve(import.meta.dir);
const list = JSON.parse(readFileSync(resolve(here, "../icons/list.json"), "utf8")) as IconList;
const manifest = JSON.parse(
  readFileSync(resolve(here, "../icons/manifest.json"), "utf8"),
) as IconManifest;

describe("icon build", () => {
  test("names a regular asset without a suffix and every other weight with one", () => {
    expect(assetPath("plus", "regular")).toBe("assets/regular/plus.svg");
    expect(assetPath("plus", "bold")).toBe("assets/bold/plus-bold.svg");
    expect(assetPath("plus", "fill")).toBe("assets/fill/plus-fill.svg");
  });

  test("lifts every path's data out of an svg, and refuses one that draws nothing", () => {
    expect(extractPathData('<svg><path d="M1 1"/><path fill="x" d="M2 2"/></svg>')).toBe(
      "M1 1 M2 2",
    );
    expect(() => extractPathData("<svg><rect/></svg>")).toThrow("no <path d>");
  });

  test("builds a sorted manifest carrying only the listed weights", () => {
    const built = buildManifest(
      { zeta: ["regular"], alpha: ["regular", "bold"] },
      (path) => `<svg><path d="${path}"/></svg>`,
    );
    expect(Object.keys(built.icons)).toEqual(["alpha", "zeta"]);
    expect(built.icons.alpha).toEqual({
      bold: "assets/bold/alpha-bold.svg",
      regular: "assets/regular/alpha.svg",
    });
    expect(built.icons.zeta).toEqual({ regular: "assets/regular/zeta.svg" });
    expect(built.viewBox).toBe(ICON_VIEW_BOX);
  });
});

describe("the committed manifest", () => {
  test("carries every name and weight the list asks for, and nothing else", () => {
    expect(Object.keys(manifest.icons)).toEqual(Object.keys(list).toSorted());
    for (const [name, weights] of Object.entries(list)) {
      const entry = manifest.icons[name]!;
      expect(Object.keys(entry).toSorted()).toEqual([...weights].toSorted());
      for (const weight of weights) {
        expect(ICON_WEIGHTS).toContain(weight);
        expect(entry[weight]!.startsWith("M")).toBe(true);
      }
    }
    expect(manifest.viewBox).toBe(ICON_VIEW_BOX);
  });

  test("every listed icon has a regular weight to fall back to", () => {
    for (const [name, weights] of Object.entries(list)) {
      expect(weights, name).toContain("regular");
    }
  });
});
