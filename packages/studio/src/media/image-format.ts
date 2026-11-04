/**
 * Which image files the Image editor may write, decided from the bytes (studio.md §9.5).
 *
 * An extension is a claim about the bytes, and the bytes are checked. A still `.png` and an
 * animated one share an extension, so the container is read: the PNG signature with an `acTL` chunk
 * before the first `IDAT`, or `RIFF`/`WEBP` with the animation bit in a `VP8X` header. An animated
 * `.png` or `.webp` is refused for the reason `.gif` is, rather than silently losing every frame
 * but the first.
 *
 * **No `TextDecoder` anywhere.** Every Latin-1 label is windows-1252 in the Encoding Standard,
 * which remaps 0x80 to 0x9F: `new TextDecoder("latin1").decode([0x89])` is U+2030, and 0x89 is the
 * PNG signature's first byte. So every comparison here is byte against byte.
 *
 * Pure: a function over bytes the editor already holds. It decodes nothing.
 *
 * @docs studio/projects/media
 */

import { extensionOf } from "../files/media-types";
import type { PixelSize } from "./image-recipe";

/** The containers this module can name. */
export type ImageContainer = "png" | "jpeg" | "webp" | "gif" | "avif" | "unknown";

/** What a file's own bytes say it is. */
export interface ImageSniff {
  container: ImageContainer;
  /** More than one frame. Only ever true for a container that can carry an animation. */
  animated: boolean;
  /** The stored pixel size from the header, or null when the header does not say. */
  size: PixelSize | null;
}

/** The three formats a host can both decode and encode, by extension. */
const EDITABLE: ReadonlyMap<string, { container: ImageContainer; label: string; mime: string }> =
  new Map([
    [".jpeg", { container: "jpeg", label: "JPEG", mime: "image/jpeg" }],
    [".jpg", { container: "jpeg", label: "JPEG", mime: "image/jpeg" }],
    [".png", { container: "png", label: "PNG", mime: "image/png" }],
    [".webp", { container: "webp", label: "WebP", mime: "image/webp" }],
  ]);

/** Why an image extension outside the editable set is not offered, one reason each. */
const REFUSED: ReadonlyMap<string, string> = new Map([
  [".avif", "The browser has no AVIF encoder, so an edit could not be written back as AVIF."],
  [".bmp", "The browser has no BMP encoder, so an edit could not be written back as BMP."],
  [
    ".gif",
    "The browser has no GIF encoder, and a bake would flatten the animation to its first frame.",
  ],
  [".ico", "An icon file holds several resolutions, not one image."],
  [".svg", "An SVG is a vector document, not a bitmap. Edit it in its Source mode instead."],
]);

/**
 * The most source pixels a bake will take on, counted before anything is decoded.
 *
 * A bake holds the decoded source and the destination at once, four bytes a pixel each, and the
 * destination is never larger than the source (enlarging is not offered). 48 megapixels is 8000 ×
 * 6000, a full-frame camera's output: 48e6 × 4 B × 2 surfaces is about 384 MB at the peak, which a
 * desktop browser tab can hold and a larger figure starts not to. A ceiling in BYTES ON DISK would
 * be the wrong unit, since a compressed file says nothing about its decoded size, and
 * `assetCapabilities.maxUploadBytes` is declared by no adapter, so there is no host figure to
 * borrow either.
 */
export const SOURCE_PIXEL_CEILING = 48_000_000;

/**
 * The host's largest drawing surface. Measured in Chromium: 16384 × 16384 draws and reads back, and
 * 20000 × 20000 hands back a context whose pixels read as zeros. Past it a bake would "succeed" and
 * write an empty image, so the bake refuses rather than finding out.
 */
export const MAX_SURFACE_SIDE = 16_384;
export const MAX_SURFACE_AREA = MAX_SURFACE_SIDE * MAX_SURFACE_SIDE;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Whether `bytes` holds `ascii` at `at`, compared byte by byte. */
function hasAscii(bytes: Uint8Array, at: number, ascii: string): boolean {
  if (at + ascii.length > bytes.length) {
    return false;
  }
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[at + i] !== ascii.codePointAt(i)) {
      return false;
    }
  }
  return true;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.length <= bytes.length && prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * The bytes as a view that reads integers in either byte order. Arithmetic rather than bit
 * operators throughout, so no read here can wrap a 32-bit value negative.
 */
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** A 24-bit little-endian integer, the width WebP's `VP8X` header stores each side minus one in. */
function u24le(bytes: Uint8Array, at: number): number {
  return view(bytes).getUint16(at, true) + bytes[at + 2]! * 0x1_00_00;
}

/** The low fourteen bits of an integer: a WebP side, which is never wider than 16383. */
function low14(value: number): number {
  return value % 0x40_00;
}

/** A PNG: its `IHDR` size, and whether an `acTL` chunk comes before the first `IDAT`. */
function sniffPng(bytes: Uint8Array): ImageSniff {
  let size: PixelSize | null = null;
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    const length = view(bytes).getUint32(at);
    if (hasAscii(bytes, at + 4, "IHDR") && at + 16 <= bytes.length) {
      size = { height: view(bytes).getUint32(at + 12), width: view(bytes).getUint32(at + 8) };
    } else if (hasAscii(bytes, at + 4, "acTL")) {
      return { animated: true, container: "png", size };
    } else if (hasAscii(bytes, at + 4, "IDAT") || hasAscii(bytes, at + 4, "IEND")) {
      break;
    }
    at += 12 + length;
  }
  return { animated: false, container: "png", size };
}

/** A WebP: the first chunk's size, and the `VP8X` animation flag (0x02). */
function sniffWebp(bytes: Uint8Array): ImageSniff {
  if (hasAscii(bytes, 12, "VP8X") && bytes.length >= 30) {
    return {
      // Bit 1 of the flags byte.
      animated: Math.floor(bytes[20]! / 2) % 2 === 1,
      container: "webp",
      size: { height: u24le(bytes, 27) + 1, width: u24le(bytes, 24) + 1 },
    };
  }
  if (hasAscii(bytes, 12, "VP8L") && bytes.length >= 25) {
    // Fourteen bits of width minus one, then fourteen of height minus one, after a signature byte.
    const bits = view(bytes).getUint32(21, true);
    return {
      animated: false,
      container: "webp",
      size: { height: low14(Math.floor(bits / 0x40_00)) + 1, width: low14(bits) + 1 },
    };
  }
  if (hasAscii(bytes, 12, "VP8 ") && bytes.length >= 30) {
    return {
      animated: false,
      container: "webp",
      size: {
        height: low14(view(bytes).getUint16(28, true)),
        width: low14(view(bytes).getUint16(26, true)),
      },
    };
  }
  return { animated: false, container: "webp", size: null };
}

/** A JPEG: the size from the first start-of-frame marker. A JPEG is never animated. */
function sniffJpeg(bytes: Uint8Array): ImageSniff {
  let at = 2;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      break;
    }
    const marker = bytes[at + 1]!;
    // Any number of fill bytes may precede a marker (T.81 B.1.1.2), and a standalone marker has no length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // SOF0 to SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        animated: false,
        container: "jpeg",
        size: { height: view(bytes).getUint16(at + 5), width: view(bytes).getUint16(at + 7) },
      };
    }
    at += 2 + view(bytes).getUint16(at + 2);
  }
  return { animated: false, container: "jpeg", size: null };
}

/** What a file's own bytes say it is. Only the header is read; nothing is decoded. */
export function sniffImage(bytes: Uint8Array): ImageSniff {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) {
    return sniffPng(bytes);
  }
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return sniffJpeg(bytes);
  }
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    return sniffWebp(bytes);
  }
  if (hasAscii(bytes, 0, "GIF8")) {
    return { animated: false, container: "gif", size: null };
  }
  if (hasAscii(bytes, 4, "ftyp") && (hasAscii(bytes, 8, "avif") || hasAscii(bytes, 8, "avis"))) {
    return { animated: hasAscii(bytes, 8, "avis"), container: "avif", size: null };
  }
  return { animated: false, container: "unknown", size: null };
}

/** The MIME type a path's extension promises, for the three editable formats; null otherwise. */
export function mimeForPath(path: string): string | null {
  return EDITABLE.get(extensionOf(path))?.mime ?? null;
}

/**
 * Whether an encode quality means anything for this type. It is an encode parameter for `.jpg` and
 * `.webp` and has no meaning for `.png`, which is lossless, so it is not drawn for one.
 */
export function takesQuality(mime: string): boolean {
  return mime === "image/jpeg" || mime === "image/webp";
}

/**
 * Whether the path's extension is one the editor can write. The cheap half of the question, asked
 * before any byte is read: it decides whether the Image mode is OFFERED at all.
 */
export function isEditableExtension(path: string): boolean {
  return EDITABLE.has(extensionOf(path));
}

/**
 * Why the file at `path` with these bytes cannot be edited, or null when it can.
 *
 * Four answers, each a sentence a person can act on: an extension outside the set, bytes of a
 * different format than the extension promises, an animation, and a source past
 * {@link SOURCE_PIXEL_CEILING} (stated with the limit, before anything is decoded).
 */
export function editRefusal(path: string, bytes: Uint8Array): string | null {
  const ext = extensionOf(path);
  const editable = EDITABLE.get(ext);
  if (editable === undefined) {
    return (
      REFUSED.get(ext) ??
      `${ext || "A file with no extension"} is not an image format Studio edits.`
    );
  }
  const sniff = sniffImage(bytes);
  if (sniff.container !== editable.container) {
    return `This file's bytes are not ${editable.label}, whatever its ${ext} extension says, so an edit could not be written back as one.`;
  }
  if (sniff.animated) {
    return `This ${editable.label} is animated, and a bake would keep only its first frame.`;
  }
  if (sniff.size !== null && sniff.size.width * sniff.size.height > SOURCE_PIXEL_CEILING) {
    const megapixels = (sniff.size.width * sniff.size.height) / 1e6;
    return `This image is ${sniff.size.width} × ${sniff.size.height} (${megapixels.toFixed(1)} megapixels), past the ${SOURCE_PIXEL_CEILING / 1e6} megapixels an edit can hold in memory.`;
  }
  return null;
}
