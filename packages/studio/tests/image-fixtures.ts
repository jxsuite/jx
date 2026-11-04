/**
 * Image bytes for the Image editor's suites: real files where a real file is small enough to
 * inline, and hand-built containers where the property under test is the container itself.
 *
 * Integers are written through a `DataView` rather than with bit operators, the same way
 * `src/media/image-format.ts` reads them.
 */

import type { BakeContext, BakePorts } from "../src/media/image-bake";

/** A 2D context that records what a bake set and called, and draws nothing. */
export class FakeContext implements BakeContext {
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = "low";
  filter = "";
  readonly calls: [string, ...number[]][] = [];
  translate(x: number, y: number): void {
    this.calls.push(["translate", x, y]);
  }
  scale(x: number, y: number): void {
    this.calls.push(["scale", x, y]);
  }
  rotate(angle: number): void {
    this.calls.push(["rotate", angle]);
  }
  drawImage(_image: CanvasImageSource, ...numbers: number[]): void {
    this.calls.push(["drawImage", ...numbers]);
  }
}

/**
 * Put a host primitive on `globalThis`, or put the original back. Defined rather than assigned: a
 * fake is the shape the bake uses, not the whole host type, so an assignment would need a cast.
 */
export function defineCreateBitmap(
  value: NonNullable<BakePorts["createBitmap"]> | typeof createImageBitmap,
): void {
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value,
    writable: true,
  });
}

/** The canvas constructor's half of {@link defineCreateBitmap}. */
export function defineOffscreen(
  value: NonNullable<BakePorts["Offscreen"]> | typeof OffscreenCanvas,
): void {
  Object.defineProperty(globalThis, "OffscreenCanvas", {
    configurable: true,
    value,
    writable: true,
  });
}

/** The bytes of a base64 string. */
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(b64), (c) => c.codePointAt(0)!);
}

/** A 1 × 1 PNG, as a canvas would write it. */
export const PNG_1X1 = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
);
/** A 1 × 1 lossless WebP (`VP8L`). */
export const WEBP_LOSSLESS_1X1 = fromBase64("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==");
/** A 1 × 1 lossy WebP (`VP8 `). */
export const WEBP_LOSSY_1X1 = fromBase64(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
);

/** Each character's code point, as a byte. */
export function ascii(text: string): number[] {
  return [...text].map((c) => c.codePointAt(0)!);
}

function bytesOf(length: number, write: (view: DataView) => void): number[] {
  const out = new Uint8Array(length);
  write(new DataView(out.buffer));
  return [...out];
}

export const be16 = (n: number) => bytesOf(2, (view) => view.setUint16(0, n));
export const be32 = (n: number) => bytesOf(4, (view) => view.setUint32(0, n));
export const le24 = (n: number) => bytesOf(4, (view) => view.setUint32(0, n, true)).slice(0, 3);

/** A PNG chunk: length, type, data, and four bytes standing in for the CRC (never read here). */
export function chunk(type: string, data: number[] = []): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG whose `IHDR` says `width × height`, followed by `chunks`. */
export function png(width: number, height: number, ...chunks: number[][]): Uint8Array<ArrayBuffer> {
  const ihdr = chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
  return Uint8Array.from([...PNG_SIGNATURE, ...ihdr, ...chunks.flat()]);
}

/** A WebP whose `VP8X` header carries `flags` and a `width × height` canvas. */
export function vp8x(flags: number, width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    ...ascii("RIFF"),
    30,
    0,
    0,
    0,
    ...ascii("WEBP"),
    ...ascii("VP8X"),
    10,
    0,
    0,
    0,
    flags,
    0,
    0,
    0,
    ...le24(width - 1),
    ...le24(height - 1),
  ]);
}

/** A JPEG that steps over an `APP0` and a `DHT` before a progressive start-of-frame. */
export function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0xff,
    0xd8,
    // APP0, sixteen bytes of JFIF the sniff steps over.
    0xff,
    0xe0,
    ...be16(16),
    ...ascii("JFIF"),
    0,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    // DHT, which shares the start-of-frame range and must not be read as one.
    0xff,
    0xc4,
    ...be16(4),
    0,
    0,
    // SOF2 (progressive): length, precision, height, width, component count.
    0xff,
    0xc2,
    ...be16(17),
    8,
    ...be16(height),
    ...be16(width),
    3,
  ]);
}
