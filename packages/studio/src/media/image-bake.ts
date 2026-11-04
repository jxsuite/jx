/**
 * The bake: a recipe applied to an image's bytes, once, at save (studio.md §9.5).
 *
 * The only module in the Image editor that touches pixels. It decodes the source with the
 * orientation tag applied (stated explicitly, so the decode and the `<img>` the author edited over
 * cannot disagree), sizes an `OffscreenCanvas` to the output, turns and flips the context, asks for
 * the host's best resampling rather than its default (which is its fastest, and which visibly
 * aliases a reduction of more than about a factor of two), sets the same filter string the preview
 * showed, draws the stored SOURCE rectangle directly, and encodes.
 *
 * **It verifies before anything is written, because every relevant host failure is silent.** Past
 * the maximum drawing surface a context draws and reads back zeros; `convertToBlob` asked for a
 * type it cannot encode returns a PNG rather than rejecting; and a surface that produced nothing
 * still produces a blob. So the output must be within the surface, the encoded type must be the one
 * the path promises, and the blob must be large enough to be an image. A failed check returns a
 * reason and the caller writes nothing.
 *
 * The two host primitives are parameters, defaulting to the globals, so the module is exercised
 * against fakes under happy-dom (which has neither) with no `mock.module()` of a first-party file.
 * `OffscreenCanvas` is not a DOM node, so nothing here constructs UI.
 *
 * @docs studio/projects/media
 */

import { MAX_SURFACE_AREA, MAX_SURFACE_SIDE, takesQuality } from "./image-format";
import { cropOf, filterString, outputSize, swapsAxes } from "./image-recipe";
import type { ImageRecipe, PixelSize } from "./image-recipe";

/** The part of a 2D context a bake uses — all of it, so a fake can be honest about its shape. */
export type BakeContext = Pick<
  OffscreenCanvasRenderingContext2D,
  | "drawImage"
  | "filter"
  | "imageSmoothingEnabled"
  | "imageSmoothingQuality"
  | "rotate"
  | "scale"
  | "translate"
>;

/** The part of an `OffscreenCanvas` a bake uses. */
export interface BakeSurface {
  getContext: (contextId: "2d") => BakeContext | null;
  convertToBlob: (options?: ImageEncodeOptions) => Promise<Blob>;
}

/** The two host primitives a bake needs, replaceable for a test. */
export interface BakePorts {
  createBitmap?: (image: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  Offscreen?: new (width: number, height: number) => BakeSurface;
}

/** A bake that produced bytes fit to write, or the reason it did not. */
export type BakeResult = { ok: true; blob: Blob; size: PixelSize } | { ok: false; reason: string };

/**
 * The smallest encoded output accepted as an image. The smallest valid PNG a canvas writes is about
 * seventy bytes and a JPEG well over a hundred, so anything under this is a surface that produced
 * nothing, and it must not be written over a file that was something.
 */
export const MIN_ENCODED_BYTES = 64;

/** Why `size` cannot be drawn on this host, or null when it can. */
export function surfaceRefusal(size: PixelSize): string | null {
  if (
    size.width > MAX_SURFACE_SIDE ||
    size.height > MAX_SURFACE_SIDE ||
    size.width * size.height > MAX_SURFACE_AREA
  ) {
    return `The result would be ${size.width} × ${size.height}, past the ${MAX_SURFACE_SIDE} × ${MAX_SURFACE_SIDE} the browser can draw. Reduce the width or crop first.`;
  }
  return null;
}

/**
 * Bake `recipe` over `bytes`, encoded as `mime`.
 *
 * @param recipe - The edit, with its crop in source coordinates
 * @param bytes - The file's bytes, exactly as read
 * @param mime - The type the path's extension promises, which the output must be
 * @param ports - The host primitives; the globals when omitted
 */
export async function bakeImage(
  recipe: Readonly<ImageRecipe>,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  {
    createBitmap = (image, options) => globalThis.createImageBitmap(image, options),
    Offscreen = globalThis.OffscreenCanvas,
  }: BakePorts = {},
): Promise<BakeResult> {
  const bitmap = await createBitmap(new Blob([bytes], { type: mime }), {
    imageOrientation: "from-image",
  });
  try {
    const source = { height: bitmap.height, width: bitmap.width };
    const out = outputSize(recipe, source);
    const tooLarge = surfaceRefusal(out);
    if (tooLarge !== null) {
      return { ok: false, reason: tooLarge };
    }
    /* A crop outside the bitmap draws nothing and encodes a blank image that passes every check
       below, so a crop made against bytes that have since changed stops here. */
    const stored = cropOf(recipe, source);
    if (
      stored.x < 0 ||
      stored.y < 0 ||
      stored.x + stored.width > source.width ||
      stored.y + stored.height > source.height
    ) {
      return {
        ok: false,
        reason: "The crop no longer fits this image, which changed after the edit began.",
      };
    }
    const canvas = new Offscreen(out.width, out.height);
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
      return { ok: false, reason: "The browser would not give the editor a drawing surface." };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.filter = filterString(recipe) || "none";
    /* Centre, mirror, then turn — applied to points in the reverse order, so a point is turned
       first and mirrored in the frame the author sees, which is what the recipe's flips mean. */
    ctx.translate(out.width / 2, out.height / 2);
    ctx.scale(recipe.flipH ? -1 : 1, recipe.flipV ? -1 : 1);
    ctx.rotate((recipe.turns * Math.PI) / 2);
    const crop = cropOf(recipe, source);
    // In the pre-turn frame the destination is the output with its sides swapped back.
    const width = swapsAxes(recipe.turns) ? out.height : out.width;
    const height = swapsAxes(recipe.turns) ? out.width : out.height;
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -width / 2,
      -height / 2,
      width,
      height,
    );
    const blob = await canvas.convertToBlob(
      takesQuality(mime) ? { quality: recipe.quality / 100, type: mime } : { type: mime },
    );
    if (blob.type !== mime) {
      return {
        ok: false,
        reason: `The browser encoded ${blob.type || "an unknown type"} when asked for ${mime}, and those bytes would not be what the file's extension promises.`,
      };
    }
    if (blob.size < MIN_ENCODED_BYTES) {
      return {
        ok: false,
        reason: `The browser produced ${blob.size} bytes, which is not an image. Nothing was written.`,
      };
    }
    return { blob, ok: true, size: out };
  } finally {
    // The one full-resolution allocation, released as soon as the draw no longer needs it.
    bitmap.close();
  }
}
