import { describe, expect, test } from "bun:test";
import type { JxElement, JxStyle } from "@jxsuite/schema/types";
import { dropDerivedGeometry } from "../src/derived-geometry.ts";

const box: JxElement = {
  children: [{ tagName: "p", textContent: "copy" }],
  tagName: "div",
};

describe("measured geometry", () => {
  test("drops the width a full-width section was measured at", () => {
    /* The user-visible symptom: a section captured at a 1440px viewport keeps that width forever,
       so dragging a canvas wider leaves empty space beside the page. */
    const style: JxStyle = { position: "relative", width: "1440px" };

    expect(dropDerivedGeometry(box, style)).toBe(1);
    expect(style["width"]).toBeUndefined();
    expect(style["position"]).toBe("relative");
  });

  test("keeps the authored constraint that produced the measurement", () => {
    /* This is what makes the drop safe rather than lossy: `max-width` is captured separately and
       reproduces the same layout, fluid below the cap instead of pinned at it. */
    const style: JxStyle = { display: "grid", maxWidth: "1390px", width: "1390px" };

    dropDerivedGeometry(box, style);

    expect(style["width"]).toBeUndefined();
    expect(style["maxWidth"]).toBe("1390px");
  });

  test("leaves a value that is not a bare measurement", () => {
    for (const width of ["100%", "auto", "min(100%, 1296px)", "calc(100% - 2rem)", "fit-content"]) {
      const style: JxStyle = { width };
      expect(dropDerivedGeometry(box, style)).toBe(0);
      expect(style["width"]).toBe(width);
    }
  });
});

describe("elements whose size the layout does not imply", () => {
  test("keeps a replaced element's measurements", () => {
    const image: JxElement = { attributes: { src: "/a.png" }, tagName: "img" };
    const style: JxStyle = { height: "204px", width: "400px" };

    expect(dropDerivedGeometry(image, style)).toBe(0);
    expect(style["width"]).toBe("400px");
  });

  test("keeps an out-of-flow box's measurements", () => {
    for (const position of ["absolute", "fixed", "sticky"]) {
      const style: JxStyle = { position, width: "300px" };
      expect(dropDerivedGeometry(box, style)).toBe(0);
    }
  });

  test("keeps a shrink-to-fit box's width", () => {
    const style: JxStyle = { display: "inline-block", width: "180px" };
    expect(dropDerivedGeometry(box, style)).toBe(0);
  });
});

describe("height, which is judged separately", () => {
  test("drops the height of a box whose content decides it", () => {
    /* Pinning this is the most damaging form of the defect: the moment text reflows at a narrower
       width the content is taller than the box that was measured around it. */
    const style: JxStyle = { height: "2772.39px" };

    expect(dropDerivedGeometry(box, style)).toBe(1);
    expect(style["height"]).toBeUndefined();
  });

  test("keeps the height of an empty box, whose whole purpose it is", () => {
    const spacer: JxElement = { tagName: "div" };
    const style: JxStyle = { height: "80px" };

    expect(dropDerivedGeometry(spacer, style)).toBe(0);
    expect(style["height"]).toBe("80px");
  });

  test("treats whitespace-only content as empty", () => {
    const spacer: JxElement = { children: ["  \n "], tagName: "div" };
    const style: JxStyle = { height: "80px" };

    expect(dropDerivedGeometry(spacer, style)).toBe(0);
  });

  test("counts textContent as content", () => {
    const labelled: JxElement = { tagName: "div", textContent: "Hello" };
    const style: JxStyle = { height: "40px" };

    expect(dropDerivedGeometry(labelled, style)).toBe(1);
  });
});

describe("context, for a style that states only what changed", () => {
  test("reads position from the base when a breakpoint delta omits it", () => {
    /* A delta carries only what CHANGED, so it usually states neither `position` nor `display`.
       Judging it alone would strip an absolutely-positioned box's width on the grounds that it
       looked like an in-flow one. */
    const delta: JxStyle = { width: "767px" };
    const base = { position: "absolute", width: "1296px" };

    expect(dropDerivedGeometry(box, delta, base)).toBe(0);
    expect(delta["width"]).toBe("767px");
  });

  test("reads display from the base when a breakpoint delta omits it", () => {
    const delta: JxStyle = { width: "180px" };
    const base = { display: "inline-flex" };

    expect(dropDerivedGeometry(box, delta, base)).toBe(0);
  });

  test("still drops an in-flow delta", () => {
    const delta: JxStyle = { width: "767px" };
    const base = { display: "flex", position: "relative" };

    expect(dropDerivedGeometry(box, delta, base)).toBe(1);
  });

  test("the delta's own value wins over the base's", () => {
    // The element became absolutely positioned at this breakpoint, so its width is intentional now.
    const delta: JxStyle = { position: "absolute", width: "300px" };
    const base = { position: "relative" };

    expect(dropDerivedGeometry(box, delta, base)).toBe(0);
  });
});
