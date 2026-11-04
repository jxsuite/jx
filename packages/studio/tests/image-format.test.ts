/**
 * Which images the editor may write, decided from the bytes — `src/media/image-format.ts`. Pure.
 *
 * The fixtures are real files where a real file is small enough to inline (a 1 × 1 PNG, a lossless
 * and a lossy WebP), and hand-built containers where the property under test is the container
 * itself (an `acTL` chunk, the `VP8X` animation bit, a JPEG start-of-frame).
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_SURFACE_SIDE,
  SOURCE_PIXEL_CEILING,
  editRefusal,
  isEditableExtension,
  mimeForPath,
  sniffImage,
  takesQuality,
} from "../src/media/image-format";
import {
  PNG_1X1,
  WEBP_LOSSLESS_1X1,
  WEBP_LOSSY_1X1,
  ascii,
  be16,
  chunk,
  jpeg,
  png,
  vp8x,
} from "./image-fixtures";

const IHDR_W = 640;
const IHDR_H = 480;
const pngWith = (...chunks: number[][]) => png(IHDR_W, IHDR_H, ...chunks);
/** What the sniff says about a PNG of these chunks, about these bytes, or about this text. */
const sniffPng = (...chunks: number[][]) => sniffImage(pngWith(...chunks));
const sniffBytes = (bytes: number[]) => sniffImage(Uint8Array.from(bytes));
const sniffText = (text: string) => sniffBytes(ascii(text));
const ACTL = chunk("acTL", [0, 0, 0, 2, 0, 0, 0, 0]);
const IDAT = chunk("IDAT");

describe("sniffImage", () => {
  test("a real PNG and both kinds of real WebP read as still, with their sizes", () => {
    expect(sniffImage(PNG_1X1)).toEqual({
      animated: false,
      container: "png",
      size: { height: 1, width: 1 },
    });
    expect(sniffImage(WEBP_LOSSLESS_1X1)).toEqual({
      animated: false,
      container: "webp",
      size: { height: 1, width: 1 },
    });
    expect(sniffImage(WEBP_LOSSY_1X1)).toEqual({
      animated: false,
      container: "webp",
      size: { height: 1, width: 1 },
    });
  });

  test("an acTL chunk before the first IDAT is an animated PNG; IDAT alone is not", () => {
    expect(sniffPng(ACTL, IDAT).animated).toBe(true);
    expect(sniffPng(IDAT, ACTL).animated).toBe(false);
    const text = chunk("tEXt", [1, 2]);
    expect(sniffPng(text, chunk("IEND")).animated).toBe(false);
    expect(sniffPng().size).toEqual({ height: IHDR_H, width: IHDR_W });
  });

  test("the VP8X animation bit (0x02) is an animated WebP, and its canvas is the size", () => {
    expect(sniffImage(vp8x(0x02, 300, 200))).toEqual({
      animated: true,
      container: "webp",
      size: { height: 200, width: 300 },
    });
    // 0x10 is the alpha flag: a still image with transparency.
    expect(sniffImage(vp8x(0x10, 300, 200)).animated).toBe(false);
  });

  test("a JPEG's size comes from its start-of-frame, stepping over DHT", () => {
    expect(sniffImage(jpeg(4000, 3000))).toEqual({
      animated: false,
      container: "jpeg",
      size: { height: 3000, width: 4000 },
    });
    expect(sniffBytes([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0, 0, 0]).size).toBeNull();
    expect(sniffBytes([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]).size).toBeNull();
  });

  test("fill bytes and standalone markers before the start-of-frame are stepped over", () => {
    const sof = [0xff, 0xc0, ...be16(17), 8, ...be16(10_000), ...be16(10_000), 3];
    expect(sniffBytes([0xff, 0xd8, 0xff, ...sof]).size).toEqual({ height: 10_000, width: 10_000 });
    expect(sniffBytes([0xff, 0xd8, 0xff, 0x01, ...sof]).size?.width).toBe(10_000);
    expect(sniffBytes([0xff, 0xd8, 0xff, 0xd3, ...sof]).size?.width).toBe(10_000);
    // Which is what keeps such a file under the ceiling's eye.
    expect(editRefusal("a.jpg", Uint8Array.from([0xff, 0xd8, 0xff, ...sof]))).toContain(
      "megapixels",
    );
  });

  test("the other containers are named, and anything else is unknown", () => {
    expect(sniffText("GIF89a.....").container).toBe("gif");
    expect(sniffText("\0\0\0\0ftypavif")).toEqual({
      animated: false,
      container: "avif",
      size: null,
    });
    expect(sniffText("\0\0\0\0ftypavis").animated).toBe(true);
    expect(sniffText("RIFF....WEBPVP8?").size).toBeNull();
    expect(sniffImage(new Uint8Array(0)).container).toBe("unknown");
    expect(sniffText("<svg>").container).toBe("unknown");
  });

  test("the signature check compares bytes above 0x7F as bytes (the TextDecoder trap)", () => {
    // Windows-1252 decodes 0x89 to U+2030; a decoded comparison would never match the signature.
    const decoded = new TextDecoder("latin1").decode(Uint8Array.from([0x89]));
    expect(decoded).toBe("\u2030");
    expect(sniffImage(PNG_1X1).container).toBe("png");
    // One byte off in the high half is not a PNG.
    expect(sniffBytes([0x88, ...PNG_1X1.slice(1)]).container).toBe("unknown");
  });
});

describe("editRefusal", () => {
  test("the three editable formats are accepted, by extension and by bytes", () => {
    expect(editRefusal("public/a.png", PNG_1X1)).toBeNull();
    expect(editRefusal("public/a.webp", WEBP_LOSSY_1X1)).toBeNull();
    expect(editRefusal("public/a.jpg", jpeg(10, 10))).toBeNull();
    expect(editRefusal("public/a.JPEG", jpeg(10, 10))).toBeNull();
    for (const path of ["a.png", "a.jpg", "a.jpeg", "a.webp"]) {
      expect(isEditableExtension(path)).toBe(true);
    }
  });

  test("the other image formats are refused, each by name", () => {
    expect(editRefusal("a.gif", new Uint8Array(0))).toContain("first frame");
    expect(editRefusal("a.avif", new Uint8Array(0))).toContain("AVIF encoder");
    expect(editRefusal("a.svg", new Uint8Array(0))).toContain("Source mode");
    expect(editRefusal("a.ico", new Uint8Array(0))).toContain("several resolutions");
    expect(editRefusal("a.bmp", new Uint8Array(0))).toContain("BMP encoder");
    expect(editRefusal("a.tiff", new Uint8Array(0))).toContain(".tiff is not an image format");
    expect(editRefusal("README", new Uint8Array(0))).toContain("A file with no extension");
    expect(isEditableExtension("a.gif")).toBe(false);
  });

  test("an animated .png and an animated .webp are refused", () => {
    expect(editRefusal("a.png", pngWith(ACTL, IDAT))).toContain("animated");
    expect(editRefusal("a.webp", vp8x(0x02, 10, 10))).not.toBeNull();
  });

  test("bytes of another format than the extension promises are refused", () => {
    expect(editRefusal("a.png", jpeg(10, 10))).toContain("are not PNG");
    expect(editRefusal("a.jpg", PNG_1X1)).toContain("are not JPEG");
  });

  test("a source past the pixel ceiling is refused with the limit stated", () => {
    const side = Math.ceil(Math.sqrt(SOURCE_PIXEL_CEILING)) + 1;
    const refusal = editRefusal("big.webp", vp8x(0, side, side));
    expect(refusal).toContain(`${SOURCE_PIXEL_CEILING / 1e6} megapixels`);
    expect(refusal).toContain(`${side} × ${side}`);
    expect(editRefusal("ok.webp", vp8x(0, 8000, 6000))).toBeNull();
  });
});

describe("types", () => {
  test("an extension promises a MIME for the editable set alone", () => {
    expect(mimeForPath("x/a.jpeg")).toBe("image/jpeg");
    expect(mimeForPath("a.webp")).toBe("image/webp");
    expect(mimeForPath("a.png")).toBe("image/png");
    expect(mimeForPath("a.gif")).toBeNull();
  });

  test("quality means something for the lossy formats only", () => {
    expect(takesQuality("image/jpeg")).toBe(true);
    expect(takesQuality("image/webp")).toBe(true);
    expect(takesQuality("image/png")).toBe(false);
    expect(MAX_SURFACE_SIDE).toBe(16_384);
  });
});
