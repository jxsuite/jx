/**
 * The colour maths the colour family is built on. Pure, so this file touches no DOM: every claim
 * here is a number, and the numbers are checked against the definitions the module cites rather
 * than against what it happens to return.
 */
import { describe, expect, test } from "bun:test";

import {
  clamp,
  contrastRatio,
  formatHex,
  formatOklch,
  hsvToRgb,
  inkOn,
  oklchToSrgb,
  parseColor,
  parseHex,
  preferredInk,
  relativeLuminance,
  rgbToHsv,
  snapToStep,
  srgbToOklch,
} from "../src/color.ts";
import type { Rgb } from "../src/color.ts";

/** A colour, rounded, so a float comparison reads as a colour rather than as noise. */
const near = (rgb: Rgb) => ({
  a: Number(rgb.a.toFixed(3)),
  b: Math.round(rgb.b),
  g: Math.round(rgb.g),
  r: Math.round(rgb.r),
});

describe("clamp", () => {
  test("holds a value inside its bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  test("resolves a value that is not a number to the minimum, never to NaN", () => {
    /* Every caller is converting a reader's text or a measured coordinate, and both can be
       nothing at all. NaN escaping here would reach a style as `NaN%`. */
    expect(clamp(Number.NaN, 3, 10)).toBe(3);
    expect(clamp(Number.POSITIVE_INFINITY, 3, 10)).toBe(3);
  });
});

describe("snapToStep", () => {
  test("snaps to the grid measured from the minimum", () => {
    expect(snapToStep(7, 5, 0, 100)).toBe(5);
    expect(snapToStep(8, 5, 0, 100)).toBe(10);
    /* The grid's origin is `min`, not zero: from 1 in threes the rungs are 1, 4, 7. */
    expect(snapToStep(6, 3, 1, 100)).toBe(7);
  });

  test("falls to the rung below when the nearest one is above the top, as a native range does", () => {
    /* 0 to 100 in fortieths rounds 100 up to 120, and a range holding the same three attributes
       reports 80. Rounding alone, or clamping to `max`, would have the element and the two ranges
       inside it disagreeing about the value at the top of every uneven track. */
    expect(snapToStep(100, 40, 0, 100)).toBe(80);
    /* An even grid has its top rung ON the maximum and keeps it. */
    expect(snapToStep(100, 25, 0, 100)).toBe(100);
    /* And 0-100 by thirty simply has no rung above 90. */
    expect(snapToStep(100, 30, 0, 100)).toBe(90);
    expect(snapToStep(-40, 30, 0, 100)).toBe(0);
  });

  test("a non-positive step snaps nothing but still bounds", () => {
    expect(snapToStep(37.4, 0, 0, 100)).toBe(37.4);
    expect(snapToStep(137.4, -1, 0, 100)).toBe(100);
  });

  test("keeps a fractional grid off the float error that would otherwise show", () => {
    expect(snapToStep(0.3, 0.1, 0, 1)).toBe(0.3);
    expect(snapToStep(0.7000000001, 0.1, 0, 1)).toBe(0.7);
  });
});

describe("parseHex", () => {
  test("reads all four lengths, with or without the leading hash", () => {
    expect(near(parseHex("#3b82f6")!)).toEqual({ a: 1, b: 246, g: 130, r: 59 });
    expect(near(parseHex("3b82f6")!)).toEqual({ a: 1, b: 246, g: 130, r: 59 });
    expect(near(parseHex("#F00")!)).toEqual({ a: 1, b: 0, g: 0, r: 255 });
    expect(near(parseHex("#f00c")!)).toEqual({ a: 0.8, b: 0, g: 0, r: 255 });
    expect(near(parseHex("#3b82f680")!).a).toBe(0.502);
  });

  test("refuses anything that is not one of those four lengths", () => {
    expect(parseHex("#12")).toBeNull();
    expect(parseHex("#1234567")).toBeNull();
    expect(parseHex("#zzzzzz")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("parseColor", () => {
  test("reads rgb() in both the legacy and the modern spellings", () => {
    expect(near(parseColor("rgb(59, 130, 246)")!)).toEqual({ a: 1, b: 246, g: 130, r: 59 });
    expect(near(parseColor("rgb(59 130 246 / 50%)")!)).toEqual({ a: 0.5, b: 246, g: 130, r: 59 });
    expect(near(parseColor("rgba(59,130,246,0.25)")!).a).toBe(0.25);
    expect(near(parseColor("rgb(100% 0% 0%)")!)).toEqual({ a: 1, b: 0, g: 0, r: 255 });
  });

  test("reads oklch(), including its percentage lightness and its alpha", () => {
    const red = parseColor("oklch(62.8% 0.2577 29.23)")!;
    expect(near(red)).toEqual({ a: 1, b: 0, g: 0, r: 255 });
    expect(near(parseColor("oklch(0.628 0.2577 29.23deg / 0.5)")!).a).toBe(0.5);
  });

  test("falls through to hex, and refuses what none of the three can read", () => {
    expect(near(parseColor(" #22c55e ")!)).toEqual({ a: 1, b: 94, g: 197, r: 34 });
    expect(parseColor("rebeccapurple")).toBeNull();
    expect(parseColor("var(--jx-accent)")).toBeNull();
    expect(parseColor("rgb(nope, 0, 0)")).toBeNull();
    expect(parseColor("oklch(nope 0 0)")).toBeNull();
    expect(parseColor("rgb(1 2)")).toBeNull();
  });
});

describe("formatHex", () => {
  test("writes six digits for an opaque colour and eight for a translucent one", () => {
    expect(formatHex({ a: 1, b: 246, g: 130, r: 59 })).toBe("#3b82f6");
    expect(formatHex({ a: 0.5, b: 246, g: 130, r: 59 })).toBe("#3b82f680");
  });

  test("rounds and bounds each channel rather than emitting a wider pair", () => {
    expect(formatHex({ a: 1, b: -20, g: 255.4, r: 300 })).toBe("#ffff00");
  });
});

describe("HSV", () => {
  test("round-trips a saturated colour through both directions", () => {
    const blue = parseHex("#3b82f6")!;
    const hsv = rgbToHsv(blue);
    expect(Math.round(hsv.h)).toBe(217);
    expect(Math.round(hsv.s)).toBe(76);
    expect(Math.round(hsv.v)).toBe(96);
    expect(formatHex(hsvToRgb(hsv))).toBe("#3b82f6");
  });

  test("reads a hue out of each of the three sectors a maximum channel can name", () => {
    const hueOf = (hex: string) => Math.round(rgbToHsv(parseHex(hex)!).h);
    expect(hueOf("#ff0000")).toBe(0);
    expect(hueOf("#00ff00")).toBe(120);
    expect(hueOf("#0000ff")).toBe(240);
    /* A negative sector: magenta's `(g - b) / span` is below zero and the hue must still land in
       0-360 rather than at -60. */
    expect(hueOf("#ff00ff")).toBe(300);
  });

  test("a grey has no hue and no saturation, and black is not a division by zero", () => {
    expect(rgbToHsv({ a: 1, b: 128, g: 128, r: 128 })).toMatchObject({ h: 0, s: 0 });
    expect(rgbToHsv({ a: 1, b: 0, g: 0, r: 0 })).toMatchObject({ h: 0, s: 0, v: 0 });
  });

  test("hsvToRgb draws every sixth of the wheel", () => {
    const at = (h: number) => formatHex(hsvToRgb({ a: 1, h, s: 100, v: 100 }));
    expect([0, 60, 120, 180, 240, 300].map((h) => at(h))).toEqual([
      "#ff0000",
      "#ffff00",
      "#00ff00",
      "#00ffff",
      "#0000ff",
      "#ff00ff",
    ]);
    /* A hue outside the circle wraps rather than falling off the sector table. */
    expect(at(420)).toBe("#ffff00");
    expect(at(-60)).toBe("#ff00ff");
  });
});

describe("OKLCH", () => {
  test("agrees with the values CSS Color 4 publishes for the sRGB primaries", () => {
    const red = srgbToOklch(parseHex("#ff0000")!);
    expect(red.l).toBeCloseTo(0.6279, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    const white = srgbToOklch(parseHex("#ffffff")!);
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeCloseTo(0, 3);
  });

  test("a colourless colour reports a hue of zero rather than an artefact of atan2", () => {
    expect(srgbToOklch({ a: 1, b: 128, g: 128, r: 128 }).h).toBe(0);
  });

  test("round-trips every hue back to the sRGB it came from", () => {
    for (const hex of ["#ff0000", "#22c55e", "#3b82f6", "#f5d90a", "#000000", "#8b5cf6"]) {
      const there = srgbToOklch(parseHex(hex)!);
      expect(formatHex(oklchToSrgb(there))).toBe(hex);
    }
  });

  test("clamps a chroma sRGB cannot hold instead of returning a channel out of range", () => {
    const wide = oklchToSrgb({ a: 1, c: 0.4, h: 150, l: 0.9 });
    expect(wide.r).toBeGreaterThanOrEqual(0);
    expect(wide.g).toBeLessThanOrEqual(255);
    expect(wide.b).toBeGreaterThanOrEqual(0);
  });

  test("formatOklch writes the alpha only when the colour is not opaque", () => {
    expect(formatOklch({ a: 1, c: 0.2577, h: 29.23, l: 0.6279 })).toBe("oklch(62.8% 0.258 29.2)");
    expect(formatOklch({ a: 0.5, c: 0.2577, h: 29.23, l: 0.6279 })).toBe(
      "oklch(62.8% 0.258 29.2 / 0.5)",
    );
  });
});

describe("contrast", () => {
  test("relative luminance is WCAG's, which is not OKLCH's lightness", () => {
    expect(relativeLuminance(parseHex("#ffffff")!)).toBeCloseTo(1, 6);
    expect(relativeLuminance(parseHex("#000000")!)).toBeCloseTo(0, 6);
    /* Mid grey sits near 0.216, well under the 0.5 that a lightness would say. */
    expect(relativeLuminance(parseHex("#808080")!)).toBeCloseTo(0.2159, 3);
  });

  test("the ratio runs 1 to 21 and does not depend on the order of its arguments", () => {
    const white = parseHex("#ffffff")!;
    const black = parseHex("#000000")!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 5);
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  test("preferredInk measures both rather than guessing at a threshold", () => {
    /* Mid grey is the case a luminance threshold gets wrong: 0.216 is below 0.5, so a threshold
       would say white, and white is the WORSE of the two here. */
    const grey = parseHex("#808080")!;
    const black = parseHex("#000000")!;
    const white = parseHex("#ffffff")!;
    expect(contrastRatio(grey, black)).toBeGreaterThan(contrastRatio(grey, white));
    expect(preferredInk(grey)).toBe("black");
    expect(preferredInk(parseHex("#f5d90a")!)).toBe("black");
    expect(preferredInk(parseHex("#1d4ed8")!)).toBe("white");
    expect(preferredInk(white)).toBe("black");
  });
});

describe("inkOn", () => {
  test("answers for a colour it can read", () => {
    expect(inkOn("#f5d90a")).toBe("black");
    expect(inkOn("rgb(29 78 216)")).toBe("white");
  });

  test("ignores the alpha, because the ink is drawn on the chip and not on what is behind it", () => {
    expect(inkOn("#00000010")).toBe("white");
  });

  test("answers with the empty string for a colour only the browser can resolve", () => {
    expect(inkOn("var(--jx-accent)")).toBe("");
    expect(inkOn("rebeccapurple")).toBe("");
    expect(inkOn(null)).toBe("");
    expect(inkOn(42)).toBe("");
  });
});
