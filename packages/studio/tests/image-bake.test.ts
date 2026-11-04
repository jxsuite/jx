/**
 * The bake — `src/media/image-bake.ts` — through injected fakes rather than a real canvas, since
 * happy-dom has neither `createImageBitmap` nor `OffscreenCanvas`.
 *
 * Assertions are on the recorded call log: what the decode was asked for, what the context was set
 * to, which source rectangle was drawn, and that the bitmap was released. Every recorded value is a
 * primitive or a plain record, so deep equality is safe here (no DOM node is ever recorded).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { MIN_ENCODED_BYTES, bakeImage, surfaceRefusal } from "../src/media/image-bake";
import { IDENTITY } from "../src/media/image-recipe";
import type { ImageRecipe } from "../src/media/image-recipe";
import type { BakeContext, BakePorts, BakeSurface } from "../src/media/image-bake";
import { FakeContext, defineCreateBitmap, defineOffscreen } from "./image-fixtures";

/** A fake host: a bitmap of `source`, and a canvas whose encoder answers `answer`. */
function fakes(
  source: { width: number; height: number },
  answer: { type?: string; size?: number } = {},
  opts: { noContext?: boolean } = {},
) {
  const canvases: [number, number][] = [];
  const decodeOptions: ImageBitmapOptions[] = [];
  const decodedType: string[] = [];
  const encode: (ImageEncodeOptions | undefined)[] = [];
  const log = {
    canvases,
    closed: 0,
    context: new FakeContext(),
    decodeOptions,
    decodedType,
    encode,
  };
  class FakeCanvas implements BakeSurface {
    readonly context: FakeContext | null = opts.noContext ? null : log.context;
    constructor(width: number, height: number) {
      log.canvases.push([width, height]);
    }
    getContext(): BakeContext | null {
      return this.context;
    }
    readonly bytes = answer.size ?? 500;
    convertToBlob(options?: ImageEncodeOptions): Promise<Blob> {
      log.encode.push(options);
      const type = answer.type ?? options?.type ?? "";
      return Promise.resolve(new Blob([new Uint8Array(this.bytes)], { type }));
    }
  }
  const createBitmap = (image: Blob, options: ImageBitmapOptions): Promise<ImageBitmap> => {
    log.decodeOptions.push(options);
    log.decodedType.push(image.type);
    const bitmap: ImageBitmap = {
      close: () => {
        log.closed += 1;
      },
      height: source.height,
      width: source.width,
    };
    return Promise.resolve(bitmap);
  };
  return { log, ports: { Offscreen: FakeCanvas, createBitmap } satisfies BakePorts };
}

const BYTES = new Uint8Array([1, 2, 3]);

function recipe(over: Partial<ImageRecipe> = {}): ImageRecipe {
  return { ...IDENTITY, ...over };
}

describe("bakeImage", () => {
  test("decodes with the orientation tag applied, as the type the path promises", async () => {
    const { log, ports } = fakes({ height: 300, width: 400 });
    await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(log.decodeOptions).toEqual([{ imageOrientation: "from-image" }]);
    expect(log.decodedType).toEqual(["image/png"]);
  });

  test("asks for the best resampling and sets the preview's own filter string", async () => {
    const { log, ports } = fakes({ height: 300, width: 400 });
    await bakeImage(recipe({ brightness: 120, width: 100 }), BYTES, "image/jpeg", ports);
    expect(log.context.imageSmoothingQuality).toBe("high");
    expect(log.context.imageSmoothingEnabled).toBe(true);
    expect(log.context.filter).toBe("brightness(120%)");
    expect(log.canvases).toEqual([[100, 75]]);
    // Quality is an encode parameter for a lossy type, as a fraction.
    expect(log.encode).toEqual([{ quality: 0.9, type: "image/jpeg" }]);
  });

  test("a neutral tone sets no filter, and a PNG is encoded with no quality", async () => {
    const { log, ports } = fakes({ height: 300, width: 400 });
    await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(log.context.filter).toBe("none");
    expect(log.encode).toEqual([{ type: "image/png" }]);
  });

  test("draws the STORED source rectangle under a turn and a flip — never an inverse-mapped one", async () => {
    const { log, ports } = fakes({ height: 300, width: 400 });
    const crop = { height: 100, width: 200, x: 30, y: 50 };
    const result = await bakeImage(
      recipe({ crop, flipH: true, turns: 1 }),
      BYTES,
      "image/webp",
      ports,
    );
    // An odd turn swaps the output's sides.
    expect(log.canvases).toEqual([[100, 200]]);
    expect(result.ok ? result.size : null).toEqual({ height: 200, width: 100 });
    expect(log.context.calls).toEqual([
      ["translate", 50, 100],
      ["scale", -1, 1],
      ["rotate", Math.PI / 2],
      // The source rectangle is the crop exactly; the destination is the output in the unturned frame.
      ["drawImage", 30, 50, 200, 100, -100, -50, 200, 100],
    ]);
  });

  test("releases the decoded bitmap whatever happens", async () => {
    const ok = fakes({ height: 10, width: 10 });
    await bakeImage(recipe(), BYTES, "image/png", ok.ports);
    expect(ok.log.closed).toBe(1);
    const refused = fakes({ height: 10, width: 10 }, { type: "image/png" });
    await bakeImage(recipe(), BYTES, "image/webp", refused.ports);
    expect(refused.log.closed).toBe(1);
  });
});

describe("verification", () => {
  test("an output past the maximum drawing surface is refused before a canvas exists", async () => {
    const { log, ports } = fakes({ height: 10, width: 20_000 });
    const result = await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("16384 × 16384");
    expect(log.canvases).toEqual([]);
    expect(log.closed).toBe(1);
    expect(surfaceRefusal({ height: 16_384, width: 16_384 })).toBeNull();
    expect(surfaceRefusal({ height: 16_385, width: 1 })).not.toBeNull();
  });

  test("an encoder that answered a different type is refused (the silent PNG fallback)", async () => {
    const { ports } = fakes({ height: 10, width: 10 }, { type: "image/png" });
    const result = await bakeImage(recipe(), BYTES, "image/webp", ports);
    expect(!result.ok && result.reason).toContain("encoded image/png when asked for image/webp");
    const untyped = fakes({ height: 10, width: 10 }, { type: "" });
    const blank = await bakeImage(recipe(), BYTES, "image/webp", untyped.ports);
    expect(!blank.ok && blank.reason).toContain("encoded an unknown type");
  });

  test("a blob too small to be an image is refused", async () => {
    const { ports } = fakes({ height: 10, width: 10 }, { size: MIN_ENCODED_BYTES - 1 });
    const result = await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(!result.ok && result.reason).toContain("which is not an image");
  });

  test("a crop outside the bitmap is refused before it can encode a blank image", async () => {
    for (const crop of [
      { height: 10, width: 10, x: -1, y: 0 },
      { height: 10, width: 10, x: 0, y: -1 },
      { height: 10, width: 10, x: 95, y: 0 },
      { height: 10, width: 10, x: 0, y: 95 },
    ]) {
      const { log, ports } = fakes({ height: 100, width: 100 });
      const result = await bakeImage(recipe({ crop }), BYTES, "image/png", ports);
      expect(!result.ok && result.reason).toContain("no longer fits");
      expect(log.canvases).toEqual([]);
      expect(log.closed).toBe(1);
    }
  });

  test("a host that gives no drawing context is refused", async () => {
    const { ports } = fakes({ height: 10, width: 10 }, {}, { noContext: true });
    const result = await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(!result.ok && result.reason).toContain("drawing surface");
  });

  test("a good bake hands back the blob", async () => {
    const { ports } = fakes({ height: 10, width: 10 });
    const result = await bakeImage(recipe(), BYTES, "image/png", ports);
    expect(result.ok ? result.blob.size : 0).toBe(500);
  });
});

describe("the host's own primitives", () => {
  const saved = {
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
  };
  afterEach(() => {
    defineCreateBitmap(saved.createImageBitmap);
    defineOffscreen(saved.OffscreenCanvas);
  });

  test("with no options object, the globals are what the bake calls", async () => {
    const { log, ports } = fakes({ height: 4, width: 4 });
    defineCreateBitmap(ports.createBitmap);
    defineOffscreen(ports.Offscreen);
    const result = await bakeImage(recipe(), BYTES, "image/png");
    expect(result.ok).toBe(true);
    expect(log.canvases).toEqual([[4, 4]]);
  });
});
