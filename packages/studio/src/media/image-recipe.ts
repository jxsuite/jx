/**
 * The Image editor's edit, as a record (studio.md §9.5).
 *
 * An edit is about a dozen numbers rather than a buffer of pixels: a crop rectangle, a quarter-turn
 * count, two flip flags, an output width, an encode quality and three tone values. Nothing is
 * applied to pixels until a save bakes it (`media/image-bake.ts`), so undo is an assignment, the
 * preview is CSS over the image already on screen, and the preview and the bake read one filter
 * string written here.
 *
 * **Geometry has one canonical space.** The crop is stored in the SOURCE bitmap's coordinates,
 * before any turn or flip, because that is the frame `drawImage`'s source rectangle takes: the bake
 * draws the stored rectangle directly and never inverse-maps it. The author looks at a different
 * frame (the source turned clockwise, then flipped as they see it), and exactly two functions cross
 * between the frames: {@link sourceToDisplay} and {@link displayToSource}. A handle is named for
 * where it sits ON SCREEN, so under one quarter-turn the top handle moves the source's left edge,
 * and a flip reverses that again; {@link moveHandle} gets that right by moving the edge in the
 * display frame and mapping the result back.
 *
 * Pure: no DOM, no canvas, no file, no tab, no host primitive.
 *
 * @docs studio/projects/media
 */

import type { FocalPoint } from "@jxsuite/site/xmp-packet";

/** A bitmap's size in pixels. */
export type PixelSize = Pick<DOMRectReadOnly, "height" | "width">;

/** A rectangle in pixels — a size at an origin — in whichever frame the function naming it says. */
export type PixelRect = PixelSize & { x: number; y: number };

/** Clockwise quarter turns. */
export type QuarterTurns = 0 | 1 | 2 | 3;

/** Every turn count, indexed by itself, so arithmetic on a count lands back on the type. */
const QUARTER_TURNS: readonly QuarterTurns[] = [0, 1, 2, 3];

/** The ratios a crop can be held to, as the author sees them: width to height. */
export const ASPECTS = [
  { id: "free", label: "Free" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "Square (1:1)" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "3:2", label: "3:2" },
  { id: "2:3", label: "2:3" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
] as const;
export type AspectId = (typeof ASPECTS)[number]["id"];

/** Each ratio after a quarter turn, which swaps the sides the author sees. */
const TURNED_ASPECT: Readonly<Record<AspectId, AspectId>> = {
  "1:1": "1:1",
  "16:9": "9:16",
  "2:3": "3:2",
  "3:2": "2:3",
  "3:4": "4:3",
  "4:3": "3:4",
  "9:16": "16:9",
  free: "free",
  original: "original",
};

/** The edit. Every field is a number, a flag or a word, so a structured clone is a deep copy. */
export interface ImageRecipe {
  /** The kept region in SOURCE coordinates, or null for the whole source. */
  crop: PixelRect | null;
  /**
   * The ratio the crop is held to. A constraint on gestures rather than an instruction to the bake,
   * so it changes nothing about the file on its own; it lives here so undo restores it with the
   * crop it shaped.
   */
  aspect: AspectId;
  /** Clockwise quarter turns, applied before the flips. */
  turns: QuarterTurns;
  /** Mirror left to right, as the author sees the turned image. */
  flipH: boolean;
  /** Mirror top to bottom, as the author sees the turned image. */
  flipV: boolean;
  /** The output width in pixels, or null for the cropped width. Only ever a reduction. */
  width: number | null;
  /** The encode quality for `.jpg` and `.webp`, as a percentage. Meaningless for `.png`. */
  quality: number;
  /** Tone, as CSS filter percentages; 100 is neutral. */
  brightness: number;
  contrast: number;
  saturation: number;
}

/** The quality a re-encode asks for when the author has not chosen one. */
export const DEFAULT_QUALITY = 90;

/** The recipe that changes nothing. */
export const IDENTITY: Readonly<ImageRecipe> = Object.freeze({
  aspect: "free",
  brightness: 100,
  contrast: 100,
  crop: null,
  flipH: false,
  flipV: false,
  quality: DEFAULT_QUALITY,
  saturation: 100,
  turns: 0,
  width: null,
});

/** A deep copy of a recipe, so a stored step can never be mutated through a live one. */
export function cloneRecipe(recipe: Readonly<ImageRecipe>): ImageRecipe {
  return { ...recipe, crop: recipe.crop === null ? null : { ...recipe.crop } };
}

/** The crop as a rectangle, the whole source when none is stored. */
export function cropOf(recipe: Readonly<ImageRecipe>, source: PixelSize): PixelRect {
  return recipe.crop ?? { height: source.height, width: source.width, x: 0, y: 0 };
}

/** Whether a stored crop keeps the whole source. */
function cropIsWhole(crop: PixelRect | null, source: PixelSize): boolean {
  return (
    crop === null ||
    (crop.x === 0 && crop.y === 0 && crop.width === source.width && crop.height === source.height)
  );
}

/**
 * Whether the recipe changes nothing about the file: the whole source, no turn, no flip, no
 * reduction and neutral tone. Quality counts, because asking for a different one is asking for a
 * re-encode. A save of an identity recipe writes nothing (§9.5).
 */
export function isIdentity(recipe: Readonly<ImageRecipe>, source: PixelSize): boolean {
  return (
    cropIsWhole(recipe.crop, source) &&
    /* A half turn and both mirrors are the same picture, so a lossy re-encode for them would degrade
       the master for nothing. */
    (recipe.turns === 0
      ? !recipe.flipH && !recipe.flipV
      : recipe.turns === 2 && recipe.flipH && recipe.flipV) &&
    (recipe.width === null || recipe.width >= orientedSize(recipe, source).width) &&
    recipe.quality === DEFAULT_QUALITY &&
    recipe.brightness === 100 &&
    recipe.contrast === 100 &&
    recipe.saturation === 100
  );
}

/** Whether `turns` swaps width and height. */
export function swapsAxes(turns: QuarterTurns): boolean {
  return turns % 2 === 1;
}

/** The crop's size as the author sees it: swapped on an odd turn, before any reduction. */
export function orientedSize(recipe: Readonly<ImageRecipe>, source: PixelSize): PixelSize {
  const crop = cropOf(recipe, source);
  return swapsAxes(recipe.turns)
    ? { height: crop.width, width: crop.height }
    : { height: crop.height, width: crop.width };
}

/**
 * The size the bake writes: the oriented crop, reduced to `width` when one is set below it. The
 * height follows the aspect and is never less than one pixel.
 */
export function outputSize(recipe: Readonly<ImageRecipe>, source: PixelSize): PixelSize {
  const oriented = orientedSize(recipe, source);
  if (recipe.width === null || recipe.width >= oriented.width) {
    return oriented;
  }
  const width = Math.max(1, Math.round(recipe.width));
  return { height: Math.max(1, Math.round((oriented.height * width) / oriented.width)), width };
}

/**
 * The CSS filter for the tone pass, or `""` when all three values are neutral.
 *
 * One string, read twice: the preview sets it on the `<img>` and the bake sets it on the drawing
 * context, so the two cannot be written differently. Every function here is scale-invariant, which
 * is the admission rule for a tone control (a blur's radius is a length, and would not be).
 */
export function filterString(recipe: Readonly<ImageRecipe>): string {
  const parts: string[] = [];
  if (recipe.brightness !== 100) {
    parts.push(`brightness(${recipe.brightness}%)`);
  }
  if (recipe.contrast !== 100) {
    parts.push(`contrast(${recipe.contrast}%)`);
  }
  if (recipe.saturation !== 100) {
    parts.push(`saturate(${recipe.saturation}%)`);
  }
  return parts.join(" ");
}

// ─── The two frames ──────────────────────────────────────────────────────────

/** The size of the whole source as the author sees it. */
export function displaySize(turns: QuarterTurns, source: PixelSize): PixelSize {
  return swapsAxes(turns)
    ? { height: source.width, width: source.height }
    : { height: source.height, width: source.width };
}

type Point = [number, number];

/** One source point, turned clockwise and then flipped in the display frame. */
function pointToDisplay([x, y]: Point, recipe: Readonly<ImageRecipe>, source: PixelSize): Point {
  const { width: w, height: h } = source;
  let p: Point;
  switch (recipe.turns) {
    case 1: {
      p = [h - y, x];
      break;
    }
    case 2: {
      p = [w - x, h - y];
      break;
    }
    case 3: {
      p = [y, w - x];
      break;
    }
    default: {
      p = [x, y];
    }
  }
  const shown = displaySize(recipe.turns, source);
  return [recipe.flipH ? shown.width - p[0] : p[0], recipe.flipV ? shown.height - p[1] : p[1]];
}

/** One display point, unflipped and then turned back. The inverse of {@link pointToDisplay}. */
function pointToSource([dx, dy]: Point, recipe: Readonly<ImageRecipe>, source: PixelSize): Point {
  const { width: w, height: h } = source;
  const shown = displaySize(recipe.turns, source);
  const x = recipe.flipH ? shown.width - dx : dx;
  const y = recipe.flipV ? shown.height - dy : dy;
  switch (recipe.turns) {
    case 1: {
      return [y, h - x];
    }
    case 2: {
      return [w - x, h - y];
    }
    case 3: {
      return [w - y, x];
    }
    default: {
      return [x, y];
    }
  }
}

/** A rectangle through a point map: both corners mapped, then normalised. */
function mapRect(rect: PixelRect, map: (p: Point) => Point): PixelRect {
  const [ax, ay] = map([rect.x, rect.y]);
  const [bx, by] = map([rect.x + rect.width, rect.y + rect.height]);
  return {
    height: Math.abs(by - ay),
    width: Math.abs(bx - ax),
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
  };
}

/** A rectangle in source coordinates, as the author sees it under the recipe's turn and flips. */
export function sourceToDisplay(
  rect: PixelRect,
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
): PixelRect {
  return mapRect(rect, (p) => pointToDisplay(p, recipe, source));
}

/** A rectangle the author sees, back in source coordinates. The inverse of the other one. */
export function displayToSource(
  rect: PixelRect,
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
): PixelRect {
  return mapRect(rect, (p) => pointToSource(p, recipe, source));
}

/**
 * Where a focal point (fractions of the source's width and height) lands in the picture the recipe
 * bakes, as fractions of ITS width and height: turned and mirrored with the pixels, then measured
 * inside the crop. `null` when the crop leaves the point out. A resize moves nothing, since both
 * are fractions.
 */
export function focusThrough(
  focus: FocalPoint,
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
): FocalPoint | null {
  const [px, py] = pointToDisplay(
    [focus.x * source.width, focus.y * source.height],
    recipe,
    source,
  );
  const crop = sourceToDisplay(cropOf(recipe, source), recipe, source);
  const x = (px - crop.x) / crop.width;
  const y = (py - crop.y) / crop.height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

// ─── Handles ─────────────────────────────────────────────────────────────────

/** The eight crop handles, named for where each sits ON SCREEN, clockwise from the top. */
export const HANDLES = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type CropHandle = (typeof HANDLES)[number];

/**
 * Everything in the crop that can be grabbed: the kept area itself, which moves the crop, and the
 * eight handles, which resize it. The area comes first, so the handles paint over it.
 */
export const CROP_STOPS = ["move", ...HANDLES] as const;
export type CropStop = (typeof CROP_STOPS)[number];

/** What a handle is called to a reader. */
export const HANDLE_LABELS: Readonly<Record<CropStop, string>> = {
  e: "Right edge",
  move: "Crop area",
  n: "Top edge",
  ne: "Top right corner",
  nw: "Top left corner",
  s: "Bottom edge",
  se: "Bottom right corner",
  sw: "Bottom left corner",
  w: "Left edge",
};

/** The smallest crop a handle may leave, in source pixels. */
export const MIN_CROP = 1;

/**
 * The recipe with one handle moved by `(dx, dy)` display pixels.
 *
 * The edge moves where the author sees it — the crop is mapped into the display frame, the edges
 * the handle names move there, clamped to the image and to {@link MIN_CROP}, and the result is
 * mapped back. That is the whole of the turn-and-flip bookkeeping, and it is why no handle needs a
 * table of which source edge it means.
 */
export function moveHandle(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  handle: CropHandle,
  dx: number,
  dy: number,
): ImageRecipe {
  const shown = displaySize(recipe.turns, source);
  const rect = sourceToDisplay(cropOf(recipe, source), recipe, source);
  const ratio = aspectRatio(recipe, source);
  const moved =
    ratio === null
      ? movedEdges(rect, shown, handle, dx, dy)
      : movedAtRatio(rect, shown, handle, dx, dy, ratio);
  return withDisplayCrop(recipe, source, moved);
}

/** The recipe with its crop moved by `(dx, dy)` display pixels, its size kept and inside the image. */
export function moveCrop(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  dx: number,
  dy: number,
): ImageRecipe {
  const shown = displaySize(recipe.turns, source);
  const rect = sourceToDisplay(cropOf(recipe, source), recipe, source);
  return withDisplayCrop(recipe, source, {
    ...rect,
    x: clamp(Math.round(rect.x + dx), 0, shown.width - rect.width),
    y: clamp(Math.round(rect.y + dy), 0, shown.height - rect.height),
  });
}

/** What dragging or nudging one stop does: the area moves the crop, and a handle resizes it. */
export function moveStop(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  stop: CropStop,
  dx: number,
  dy: number,
): ImageRecipe {
  return stop === "move"
    ? moveCrop(recipe, source, dx, dy)
    : moveHandle(recipe, source, stop, dx, dy);
}

/** The recipe with `rect`, a rectangle the author sees, as its crop. */
function withDisplayCrop(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  rect: PixelRect,
): ImageRecipe {
  const next = cloneRecipe(recipe);
  const crop = displayToSource(rect, recipe, source);
  next.crop = cropIsWhole(crop, source) ? null : crop;
  return clampWidth(next, source);
}

/** A free handle: only the edges it names move, each clamped to the image and to {@link MIN_CROP}. */
function movedEdges(
  rect: PixelRect,
  shown: PixelSize,
  handle: CropHandle,
  dx: number,
  dy: number,
): PixelRect {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (handle.includes("w")) {
    left = clamp(Math.round(left + dx), 0, right - MIN_CROP);
  }
  if (handle.includes("e")) {
    right = clamp(Math.round(right + dx), left + MIN_CROP, shown.width);
  }
  if (handle.includes("n")) {
    top = clamp(Math.round(top + dy), 0, bottom - MIN_CROP);
  }
  if (handle.includes("s")) {
    bottom = clamp(Math.round(bottom + dy), top + MIN_CROP, shown.height);
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
}

/**
 * A handle under a held ratio. A corner keeps the opposite corner still and follows whichever axis
 * the pointer has moved further, because following one axis alone would ignore a drag along the
 * other. An edge keeps the opposite edge still and grows the other two sides evenly about the
 * crop's centre. Either way the size is limited by the room the fixed point leaves in both
 * directions, so the ratio holds at the edge of the image rather than giving way there.
 */
function movedAtRatio(
  rect: PixelRect,
  shown: PixelSize,
  handle: CropHandle,
  dx: number,
  dy: number,
  ratio: number,
): PixelRect {
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const wider = east ? dx : west ? -dx : 0;
  const taller = south ? dy : north ? -dy : 0;
  const followsWidth =
    (east || west) && (!(north || south) || Math.abs(wider) >= Math.abs(taller) * ratio);
  const wanted = followsWidth ? rect.width + wider : (rect.height + taller) * ratio;

  // The point that stays still, on each axis: an edge, or the centre when the handle names neither.
  const anchorX = west ? rect.x + rect.width : east ? rect.x : rect.x + rect.width / 2;
  const anchorY = north ? rect.y + rect.height : south ? rect.y : rect.y + rect.height / 2;
  const roomX = west
    ? anchorX
    : east
      ? shown.width - anchorX
      : 2 * Math.min(anchorX, shown.width - anchorX);
  const roomY = north
    ? anchorY
    : south
      ? shown.height - anchorY
      : 2 * Math.min(anchorY, shown.height - anchorY);

  const limit = Math.min(roomX, roomY * ratio);
  const exact = Math.min(Math.max(wanted, Math.max(MIN_CROP, MIN_CROP * ratio)), limit);
  const width = Math.max(MIN_CROP, Math.round(exact));
  const height = Math.max(MIN_CROP, Math.round(exact / ratio));
  const x = west ? anchorX - width : east ? anchorX : Math.round(anchorX - width / 2);
  const y = north ? anchorY - height : south ? anchorY : Math.round(anchorY - height / 2);
  return {
    height,
    width,
    x: clamp(x, 0, shown.width - width),
    y: clamp(y, 0, shown.height - height),
  };
}

/** The ratio the recipe holds its crop to, width over height as the author sees it; null when free. */
export function aspectRatio(recipe: Readonly<ImageRecipe>, source: PixelSize): number | null {
  if (recipe.aspect === "free") {
    return null;
  }
  if (recipe.aspect === "original") {
    const shown = displaySize(recipe.turns, source);
    return shown.width / shown.height;
  }
  const [width, height] = recipe.aspect.split(":");
  return Number(width) / Number(height);
}

/**
 * The recipe held to a ratio, with its crop reshaped to the largest rectangle of that ratio in the
 * whole image, centred where the crop is now. The whole image rather than the current crop, so that
 * trying 1:1 and then 16:9 gives what 16:9 alone would have, instead of shrinking at every choice.
 * Choosing Free only lets go: the crop stays as it is.
 */
export function withAspect(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  aspect: AspectId,
): ImageRecipe {
  const held = { ...cloneRecipe(recipe), aspect };
  const ratio = aspectRatio(held, source);
  if (ratio === null) {
    return held;
  }
  const shown = displaySize(recipe.turns, source);
  const rect = sourceToDisplay(cropOf(recipe, source), recipe, source);
  const exact = Math.min(shown.width, shown.height * ratio);
  const width = Math.max(MIN_CROP, Math.round(exact));
  const height = Math.max(MIN_CROP, Math.round(exact / ratio));
  return withDisplayCrop(held, source, {
    height,
    width,
    x: clamp(Math.round(rect.x + rect.width / 2 - width / 2), 0, shown.width - width),
    y: clamp(Math.round(rect.y + rect.height / 2 - height / 2), 0, shown.height - height),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Drop a reduction the crop has made meaningless (a width at or above the new crop width). */
function clampWidth(recipe: ImageRecipe, source: PixelSize): ImageRecipe {
  if (recipe.width !== null && recipe.width >= orientedSize(recipe, source).width) {
    recipe.width = null;
  }
  return recipe;
}

// ─── Steps ───────────────────────────────────────────────────────────────────

/** The recipe turned one quarter clockwise (`+1`) or counter-clockwise (`-1`). */
export function turn(recipe: Readonly<ImageRecipe>, direction: 1 | -1): ImageRecipe {
  const next = cloneRecipe(recipe);
  next.turns = QUARTER_TURNS[(recipe.turns + direction + 4) % 4]!;
  /* The flips are in the DISPLAY frame, and a quarter turn of a left-right mirror is a top-bottom
     one, so swapping them keeps the picture the author sees turning as a whole. With both set (or
     neither) the swap changes nothing, which is also right: two mirrors are a half turn. */
  next.flipH = recipe.flipV;
  next.flipV = recipe.flipH;
  // A held ratio is as the author sees it too, and the crop has just turned with the picture.
  next.aspect = TURNED_ASPECT[recipe.aspect];
  /* A reduction is a width as the author sees it, and a quarter turn swaps which side that is, so
     the same number would be a different scale. It is dropped rather than reinterpreted. */
  next.width = null;
  return next;
}

/** The recipe mirrored on one axis as the author sees it. */
export function flip(recipe: Readonly<ImageRecipe>, axis: "h" | "v"): ImageRecipe {
  const next = cloneRecipe(recipe);
  if (axis === "h") {
    next.flipH = !recipe.flipH;
  } else {
    next.flipV = !recipe.flipV;
  }
  return next;
}

/**
 * The recipe with its output width set. Only a reduction is kept: a width at or above the oriented
 * crop, or one that is not a positive number, clears it, because a bake cannot add detail.
 */
export function withWidth(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  width: number | null,
): ImageRecipe {
  const next = cloneRecipe(recipe);
  next.width = width === null || !Number.isFinite(width) || width < 1 ? null : Math.round(width);
  return clampWidth(next, source);
}

/** The bounds each numeric control accepts, so the field and the recipe agree on them. */
export const TONE_RANGE = { max: 200, min: 0 } as const;
export const QUALITY_RANGE = { max: 100, min: 1 } as const;

/** The recipe with one tone or quality value set, clamped to its range. */
export function withValue(
  recipe: Readonly<ImageRecipe>,
  key: "brightness" | "contrast" | "saturation" | "quality",
  value: number,
): ImageRecipe {
  const next = cloneRecipe(recipe);
  const range = key === "quality" ? QUALITY_RANGE : TONE_RANGE;
  next[key] = Number.isFinite(value) ? clamp(Math.round(value), range.min, range.max) : recipe[key];
  return next;
}

/**
 * The width **Fit for web** proposes: the largest of the project's `images.widths` that is below
 * the oriented crop, or null when none is (nothing to reduce to). A reduction here produces what
 * the build would have produced from the same source.
 */
export function fitForWebWidth(
  recipe: Readonly<ImageRecipe>,
  source: PixelSize,
  widths: readonly number[],
): number | null {
  const oriented = orientedSize(recipe, source).width;
  let best: number | null = null;
  for (const width of widths) {
    if (
      Number.isFinite(width) &&
      width >= 1 &&
      width < oriented &&
      (best === null || width > best)
    ) {
      best = Math.round(width);
    }
  }
  return best;
}

// ─── Undo ────────────────────────────────────────────────────────────────────

/** A recipe and the steps either side of it. Whole records: undo is an assignment. */
export interface RecipeHistory {
  past: ImageRecipe[];
  present: ImageRecipe;
  future: ImageRecipe[];
}

/** How many steps are kept behind the present. A step is a dozen numbers, so this is generous. */
export const RECIPE_HISTORY_LIMIT = 100;

/** A history holding only `recipe`. */
export function historyOf(recipe: Readonly<ImageRecipe> = IDENTITY): RecipeHistory {
  return { future: [], past: [], present: cloneRecipe(recipe) };
}

/** Whether two recipes are the same edit. */
export function sameRecipe(a: Readonly<ImageRecipe>, b: Readonly<ImageRecipe>): boolean {
  return JSON.stringify(cloneRecipe(a)) === JSON.stringify(cloneRecipe(b));
}

/**
 * The history with `next` as the present, the old present pushed behind it and the redo side
 * dropped. Pushing the recipe already present is not a step.
 */
export function pushStep(history: RecipeHistory, next: Readonly<ImageRecipe>): RecipeHistory {
  if (sameRecipe(history.present, next)) {
    return history;
  }
  return {
    future: [],
    past: [...history.past, history.present].slice(-RECIPE_HISTORY_LIMIT),
    present: cloneRecipe(next),
  };
}

/** One step back, or the same history when there is none. */
export function undoStep(history: RecipeHistory): RecipeHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    future: [history.present, ...history.future],
    past: history.past.slice(0, -1),
    present: previous,
  };
}

/** One step forward, or the same history when there is none. */
export function redoStep(history: RecipeHistory): RecipeHistory {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return { future: rest, past: [...history.past, history.present], present: next };
}
