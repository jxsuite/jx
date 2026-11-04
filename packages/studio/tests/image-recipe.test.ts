/**
 * The Image editor's recipe — `src/media/image-recipe.ts`. Pure: no DOM, no canvas.
 *
 * The coordinate mappings carry the whole of the turn-and-flip bookkeeping, and a mistake in them
 * is invisible exactly where it matters: the preview looks right and the bake crops elsewhere. So
 * they are pinned over every combination, and each handle is checked to move the edge the author
 * SEES it on.
 */
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_QUALITY,
  HANDLES,
  RECIPE_HISTORY_LIMIT,
  IDENTITY,
  cloneRecipe,
  cropOf,
  displaySize,
  displayToSource,
  filterString,
  fitForWebWidth,
  flip,
  historyOf,
  isIdentity,
  aspectRatio,
  moveCrop,
  moveHandle,
  moveStop,
  orientedSize,
  outputSize,
  pushStep,
  redoStep,
  sameRecipe,
  sourceToDisplay,
  turn,
  undoStep,
  withAspect,
  withValue,
  withWidth,
} from "../src/media/image-recipe";
import type { CropHandle, ImageRecipe, PixelRect, QuarterTurns } from "../src/media/image-recipe";

const SOURCE = { height: 300, width: 400 };

function recipe(over: Partial<ImageRecipe> = {}): ImageRecipe {
  return { ...IDENTITY, ...over };
}

const CASES: [CropHandle, QuarterTurns, boolean, boolean][] = [];
for (const handle of HANDLES) {
  for (const turns of [0, 1, 2, 3] as const) {
    for (const flipH of [false, true]) {
      for (const flipV of [false, true]) {
        CASES.push([handle, turns, flipH, flipV]);
      }
    }
  }
}

describe("coordinate mappings", () => {
  const crop: PixelRect = { height: 120, width: 200, x: 30, y: 50 };

  test.each(CASES)(
    "handle %s, %i turns, flipH %p, flipV %p: the round trip is identity and the seen edge moves",
    (handle, turns, flipH, flipV) => {
      const r = recipe({ crop, flipH, flipV, turns });
      const shown = sourceToDisplay(crop, r, SOURCE);
      expect(displayToSource(shown, r, SOURCE)).toEqual(crop);
      expect(sourceToDisplay(displayToSource(shown, r, SOURCE), r, SOURCE)).toEqual(shown);

      // Drag the handle 10 display pixels outward-or-inward along each axis it names.
      const dx = handle.includes("e") ? 10 : handle.includes("w") ? 10 : 0;
      const dy = handle.includes("s") ? 10 : handle.includes("n") ? 10 : 0;
      const moved = sourceToDisplay(
        cropOf(moveHandle(r, SOURCE, handle, dx, dy), SOURCE),
        r,
        SOURCE,
      );
      // Only the edges the handle names move, and they move where the author sees them.
      expect(moved.x).toBe(shown.x + (handle.includes("w") ? 10 : 0));
      expect(moved.y).toBe(shown.y + (handle.includes("n") ? 10 : 0));
      expect(moved.x + moved.width).toBe(shown.x + shown.width + (handle.includes("e") ? 10 : 0));
      expect(moved.y + moved.height).toBe(shown.y + shown.height + (handle.includes("s") ? 10 : 0));
    },
  );

  test("under one quarter-turn the top handle moves the source's LEFT edge", () => {
    const r = recipe({ turns: 1 });
    const next = moveHandle(r, SOURCE, "n", 0, 25);
    expect(next.crop).toEqual({ height: 300, width: 375, x: 25, y: 0 });
  });

  test("a flip reverses that again: under a turn and a top-bottom flip, the top is the right", () => {
    const r = recipe({ flipV: true, turns: 1 });
    const next = moveHandle(r, SOURCE, "n", 0, 25);
    expect(next.crop).toEqual({ height: 300, width: 375, x: 0, y: 0 });
  });

  test("a handle is clamped to the image and to one pixel of crop", () => {
    expect(moveHandle(recipe(), SOURCE, "w", -50, 0).crop).toBeNull();
    expect(moveHandle(recipe(), SOURCE, "e", -1000, 0).crop).toEqual({
      height: 300,
      width: 1,
      x: 0,
      y: 0,
    });
    expect(moveHandle(recipe(), SOURCE, "s", 0, -1000).crop?.height).toBe(1);
    expect(moveHandle(recipe(), SOURCE, "n", 0, 5000).crop?.height).toBe(1);
  });

  test("a crop that a drag drags back to the whole image is stored as none", () => {
    const cropped = moveHandle(recipe(), SOURCE, "e", -50, 0);
    expect(moveHandle(cropped, SOURCE, "e", 50, 0).crop).toBeNull();
  });

  test("the display size swaps on an odd turn", () => {
    expect(displaySize(0, SOURCE)).toEqual(SOURCE);
    expect(displaySize(3, SOURCE)).toEqual({ height: 400, width: 300 });
  });
});

const ORIENTATIONS: [QuarterTurns, boolean, boolean][] = [];
for (const turns of [0, 1, 2, 3] as const) {
  for (const flipH of [false, true]) {
    for (const flipV of [false, true]) {
      ORIENTATIONS.push([turns, flipH, flipV]);
    }
  }
}

describe("moving the crop", () => {
  const crop: PixelRect = { height: 120, width: 200, x: 30, y: 50 };

  test.each(ORIENTATIONS)(
    "%i turns, flipH %p, flipV %p: it goes where the author drags it, keeping its size",
    (turns, flipH, flipV) => {
      const r = recipe({ crop, flipH, flipV, turns });
      const before = sourceToDisplay(crop, r, SOURCE);
      const after = sourceToDisplay(cropOf(moveCrop(r, SOURCE, 7, -5), SOURCE), r, SOURCE);
      expect(after).toEqual({ ...before, x: before.x + 7, y: before.y - 5 });
    },
  );

  test("stops at the edge of the image without changing size", () => {
    const r = recipe({ crop });
    expect(moveCrop(r, SOURCE, -1000, -1000).crop).toEqual({ ...crop, x: 0, y: 0 });
    expect(moveCrop(r, SOURCE, 1000, 1000).crop).toEqual({ ...crop, x: 200, y: 180 });
  });

  test("a crop of the whole image has nowhere to go", () => {
    expect(moveCrop(recipe(), SOURCE, 50, 50).crop).toBeNull();
  });

  test("a move keeps a reduction, which a crop of the same size has not invalidated", () => {
    expect(moveCrop(recipe({ crop, width: 100 }), SOURCE, 5, 5).width).toBe(100);
  });

  test("moveStop dispatches: the area moves the crop, and a handle resizes it", () => {
    const r = recipe({ crop });
    expect(moveStop(r, SOURCE, "move", 5, 0).crop).toEqual({ ...crop, x: 35 });
    expect(moveStop(r, SOURCE, "e", 5, 0).crop).toEqual({ ...crop, width: 205 });
  });
});

describe("holding a ratio", () => {
  const ratioOf = (r: ImageRecipe) => {
    const shown = sourceToDisplay(cropOf(r, SOURCE), r, SOURCE);
    return shown.width / shown.height;
  };

  test("choosing one takes the largest of that shape in the whole image, centred", () => {
    expect(withAspect(recipe(), SOURCE, "16:9").crop).toEqual({
      height: 225,
      width: 400,
      x: 0,
      y: 38,
    });
    expect(withAspect(recipe(), SOURCE, "1:1").crop).toEqual({
      height: 300,
      width: 300,
      x: 50,
      y: 0,
    });
    expect(withAspect(recipe(), SOURCE, "9:16").crop?.height).toBe(300);
  });

  test("trying several does not shrink the crop at each choice", () => {
    const direct = withAspect(recipe(), SOURCE, "16:9");
    const viaSquare = withAspect(withAspect(recipe(), SOURCE, "1:1"), SOURCE, "16:9");
    expect(viaSquare.crop).toEqual(direct.crop);
  });

  test("it centres on the crop as it stands, and stays inside the image", () => {
    const corner = recipe({ crop: { height: 40, width: 40, x: 360, y: 260 } });
    expect(withAspect(corner, SOURCE, "1:1").crop).toEqual({
      height: 300,
      width: 300,
      x: 100,
      y: 0,
    });
  });

  test("Free only lets go, and Original on an uncropped image changes nothing about the file", () => {
    const crop = { height: 100, width: 100, x: 10, y: 10 };
    const freed = withAspect(recipe({ aspect: "1:1", crop }), SOURCE, "free");
    expect(freed.aspect).toBe("free");
    expect(freed.crop).toEqual(crop);
    const original = withAspect(recipe(), SOURCE, "original");
    expect(original.crop).toBeNull();
    expect(isIdentity(original, SOURCE)).toBe(true);
    expect(aspectRatio(original, SOURCE)).toBe(400 / 300);
    expect(aspectRatio(recipe(), SOURCE)).toBeNull();
  });

  test.each(ORIENTATIONS)(
    "%i turns, flipH %p, flipV %p: every handle keeps the ratio as the author sees it",
    (turns, flipH, flipV) => {
      const start = withAspect(recipe({ flipH, flipV, turns }), SOURCE, "4:3");
      // Inset first, so every handle has room to move outward as well as inward.
      const held = moveHandle(moveHandle(start, SOURCE, "nw", 40, 40), SOURCE, "se", -40, -40);
      for (const handle of HANDLES) {
        for (const [dx, dy] of [
          [12, 12],
          [-12, -12],
          [30, 0],
          [0, -30],
          [5000, 5000],
          [-5000, -5000],
        ] as const) {
          const moved = moveHandle(held, SOURCE, handle, dx, dy);
          const shown = sourceToDisplay(cropOf(moved, SOURCE), moved, SOURCE);
          // Whole pixels, so a side rounds; the error is at most half a pixel on each.
          expect(Math.abs(shown.width - (shown.height * 4) / 3)).toBeLessThanOrEqual(1.5);
          const bounds = displaySize(turns, SOURCE);
          expect(shown.x).toBeGreaterThanOrEqual(0);
          expect(shown.y).toBeGreaterThanOrEqual(0);
          expect(shown.x + shown.width).toBeLessThanOrEqual(bounds.width);
          expect(shown.y + shown.height).toBeLessThanOrEqual(bounds.height);
        }
      }
    },
  );

  test("a corner keeps the opposite corner still and follows the axis moved further", () => {
    const held = recipe({ aspect: "1:1", crop: { height: 100, width: 100, x: 50, y: 50 } });
    expect(moveHandle(held, SOURCE, "se", 40, 10).crop).toEqual({
      height: 140,
      width: 140,
      x: 50,
      y: 50,
    });
    expect(moveHandle(held, SOURCE, "se", 10, -40).crop).toEqual({
      height: 60,
      width: 60,
      x: 50,
      y: 50,
    });
    expect(moveHandle(held, SOURCE, "nw", -20, -5).crop).toEqual({
      height: 120,
      width: 120,
      x: 30,
      y: 30,
    });
  });

  test("an edge keeps the opposite edge still and grows the other two sides evenly", () => {
    const held = recipe({ aspect: "1:1", crop: { height: 100, width: 100, x: 100, y: 100 } });
    expect(moveHandle(held, SOURCE, "e", 20, 0).crop).toEqual({
      height: 120,
      width: 120,
      x: 100,
      y: 90,
    });
    expect(moveHandle(held, SOURCE, "n", 0, -20).crop).toEqual({
      height: 120,
      width: 120,
      x: 90,
      y: 80,
    });
  });

  test("the ratio holds at the edge of the image rather than giving way there", () => {
    const held = recipe({ aspect: "1:1", crop: { height: 100, width: 100, x: 250, y: 150 } });
    // The bottom edge is 50 away and the right 50: a far drag stops at the nearer limit, square.
    expect(moveHandle(held, SOURCE, "se", 5000, 5000).crop).toEqual({
      height: 150,
      width: 150,
      x: 250,
      y: 150,
    });
    // It never shrinks below one pixel either.
    expect(moveHandle(held, SOURCE, "se", -5000, -5000).crop).toEqual({
      height: 1,
      width: 1,
      x: 250,
      y: 150,
    });
  });

  test("a quarter turn swaps the ratio with the picture, and undo restores it with the crop", () => {
    const held = withAspect(recipe(), SOURCE, "16:9");
    const turned = turn(held, 1);
    expect(turned.aspect).toBe("9:16");
    expect(ratioOf(turned)).toBeCloseTo(9 / 16, 1);
    expect(turn(turned, -1).aspect).toBe("16:9");
    expect(turn(recipe({ aspect: "1:1" }), 1).aspect).toBe("1:1");
    const history = pushStep(historyOf(), held);
    expect(undoStep(history).present.aspect).toBe("free");
    expect(undoStep(history).present.crop).toBeNull();
  });

  test("the ratio is not an edit on its own", () => {
    expect(isIdentity(recipe({ aspect: "16:9" }), SOURCE)).toBe(true);
  });
});

describe("outputSize", () => {
  test("is the crop, with dimensions swapped on an odd turn", () => {
    const crop = { height: 100, width: 200, x: 0, y: 0 };
    expect(outputSize(recipe({ crop }), SOURCE)).toEqual({ height: 100, width: 200 });
    expect(outputSize(recipe({ crop, turns: 1 }), SOURCE)).toEqual({ height: 200, width: 100 });
    expect(outputSize(recipe({ crop, turns: 2 }), SOURCE)).toEqual({ height: 100, width: 200 });
  });

  test("a reduction keeps the aspect and never reaches zero", () => {
    expect(outputSize(recipe({ width: 200 }), SOURCE)).toEqual({ height: 150, width: 200 });
    expect(outputSize(recipe({ width: 1 }), { height: 10, width: 4000 })).toEqual({
      height: 1,
      width: 1,
    });
    // A width at or above the crop is no reduction.
    expect(outputSize(recipe({ width: 900 }), SOURCE)).toEqual(SOURCE);
  });

  test("orientedSize is the crop before any reduction", () => {
    expect(orientedSize(recipe({ turns: 1, width: 10 }), SOURCE)).toEqual({
      height: 400,
      width: 300,
    });
  });
});

describe("filterString", () => {
  test("is empty for a neutral recipe", () => {
    expect(filterString(IDENTITY)).toBe("");
  });

  test("is the exact CSS filter, in one order, for a non-neutral one", () => {
    expect(filterString(recipe({ brightness: 110, contrast: 90, saturation: 0 }))).toBe(
      "brightness(110%) contrast(90%) saturate(0%)",
    );
    expect(filterString(recipe({ contrast: 120 }))).toBe("contrast(120%)");
  });
});

describe("identity", () => {
  test("the identity recipe, and a whole-image crop, change nothing", () => {
    expect(isIdentity(IDENTITY, SOURCE)).toBe(true);
    expect(isIdentity(recipe({ crop: { height: 300, width: 400, x: 0, y: 0 } }), SOURCE)).toBe(
      true,
    );
    expect(isIdentity(recipe({ width: 400 }), SOURCE)).toBe(true);
  });

  test("a half turn with both mirrors is the same picture, so it is no edit", () => {
    expect(isIdentity(recipe({ flipH: true, flipV: true, turns: 2 }), SOURCE)).toBe(true);
    expect(isIdentity(recipe({ flipH: true, turns: 2 }), SOURCE)).toBe(false);
    expect(isIdentity(recipe({ flipH: true, flipV: true, turns: 1 }), SOURCE)).toBe(false);
    expect(isIdentity(recipe({ turns: 2 }), SOURCE)).toBe(false);
  });

  test("every field counts, quality included, because a new quality is a re-encode", () => {
    for (const over of [
      { crop: { height: 10, width: 10, x: 0, y: 0 } },
      { turns: 2 as const },
      { flipH: true },
      { flipV: true },
      { width: 100 },
      { quality: DEFAULT_QUALITY - 10 },
      { brightness: 101 },
      { contrast: 99 },
      { saturation: 50 },
    ]) {
      expect(isIdentity(recipe(over), SOURCE)).toBe(false);
    }
  });
});

describe("steps", () => {
  test("a turn wraps both ways and keeps the picture turning as a whole under a flip", () => {
    expect(turn(recipe({ turns: 3 }), 1).turns).toBe(0);
    expect(turn(recipe(), -1).turns).toBe(3);
    const flipped = turn(recipe({ flipH: true }), 1);
    expect([flipped.flipH, flipped.flipV]).toEqual([false, true]);
    // A reduction is a width as seen, so a turn drops it rather than reinterpreting it.
    expect(turn(recipe({ width: 100 }), 1).width).toBeNull();
  });

  test("a flip toggles one axis", () => {
    expect(flip(recipe(), "h").flipH).toBe(true);
    expect(flip(recipe({ flipV: true }), "v").flipV).toBe(false);
  });

  test("a width is only ever a reduction", () => {
    expect(withWidth(recipe(), SOURCE, 200).width).toBe(200);
    expect(withWidth(recipe(), SOURCE, 400).width).toBeNull();
    expect(withWidth(recipe(), SOURCE, 0).width).toBeNull();
    expect(withWidth(recipe(), SOURCE, Number.NaN).width).toBeNull();
    expect(withWidth(recipe({ width: 100 }), SOURCE, null).width).toBeNull();
    expect(withWidth(recipe(), SOURCE, 199.6).width).toBe(200);
  });

  test("a crop narrower than the width drops the width", () => {
    const narrow = moveHandle(recipe({ width: 300 }), SOURCE, "e", -200, 0);
    expect(narrow.width).toBeNull();
  });

  test("tone and quality are clamped to their ranges, and junk keeps the old value", () => {
    expect(withValue(recipe(), "brightness", 500).brightness).toBe(200);
    expect(withValue(recipe(), "contrast", -3).contrast).toBe(0);
    expect(withValue(recipe(), "quality", 0).quality).toBe(1);
    expect(withValue(recipe(), "saturation", Number.NaN).saturation).toBe(100);
  });

  test("Fit for web proposes the largest declared width below the crop", () => {
    expect(fitForWebWidth(recipe(), { height: 3000, width: 4000 }, [320, 1920, 1280])).toBe(1920);
    expect(fitForWebWidth(recipe(), SOURCE, [320, 640])).toBe(320);
    expect(fitForWebWidth(recipe(), SOURCE, [640, 960, Number.NaN, 0])).toBeNull();
    expect(fitForWebWidth(recipe({ turns: 1 }), SOURCE, [320, 350])).toBeNull();
  });
});

describe("whole-record undo", () => {
  test("a push and a pop restore byte-equal records", () => {
    const start = historyOf();
    const cropped = moveHandle(start.present, SOURCE, "se", -40, -30);
    const pushed = pushStep(start, cropped);
    expect(sameRecipe(pushed.present, cropped)).toBe(true);
    const undone = undoStep(pushed);
    expect(JSON.stringify(undone.present)).toBe(JSON.stringify(start.present));
    const redone = redoStep(undone);
    expect(JSON.stringify(redone.present)).toBe(JSON.stringify(cropped));
  });

  test("a stored step cannot be mutated through the live one", () => {
    const crop = { height: 1, width: 1, x: 0, y: 0 };
    const history = pushStep(historyOf(), recipe({ crop }));
    crop.width = 99;
    expect(history.present.crop?.width).toBe(1);
    expect(cloneRecipe(history.present)).not.toBe(history.present);
  });

  test("pushing the present is not a step, and an empty side is a no-op", () => {
    const start = historyOf();
    expect(pushStep(start, cloneRecipe(IDENTITY))).toBe(start);
    expect(undoStep(start)).toBe(start);
    expect(redoStep(start)).toBe(start);
  });

  test("a push drops the redo side, and the past is bounded", () => {
    let history = historyOf();
    for (let i = 1; i <= RECIPE_HISTORY_LIMIT + 5; i++) {
      history = pushStep(history, recipe({ brightness: i }));
    }
    expect(history.past).toHaveLength(RECIPE_HISTORY_LIMIT);
    const branched = pushStep(undoStep(history), recipe({ contrast: 1 }));
    expect(branched.future).toEqual([]);
  });
});
