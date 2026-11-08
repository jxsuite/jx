/**
 * Where each image format keeps its XMP packet, and how to put a new one there.
 *
 * Each format has exactly one place the XMP specification (Part 3, "Storage in files") or the
 * format's own specification names, and that is the only place read or written:
 *
 * - **JPEG**: an `APP1` segment whose payload starts `http://ns.adobe.com/xap/1.0/\0`, placed after
 *   the `APP0`/Exif `APP1` segments at the head of the file. Extended XMP segments are left alone.
 * - **PNG**: an `iTXt` chunk with the keyword `XML:com.adobe.xmp`, uncompressed, before `IDAT`.
 * - **WebP**: an `XMP ` chunk in the extended file format, flagged in `VP8X`; a simple (lossy or
 *   lossless) file is converted to the extended form, its canvas taken from the bitstream header.
 * - **SVG**: an `x:xmpmeta` inside the root's `<metadata>` element. The file is text, so the packet
 *   is spliced into the source rather than re-serialized: the author's own formatting is kept.
 *
 * Any other format (GIF, AVIF, HEIC, TIFF, every video) has no writer here, and {@link xmpFormatOf}
 * answers `null` for it: the Media workspace then says the file cannot hold alt text rather than
 * pretending to save it.
 *
 * @docs studio/projects/media
 */

import { extensionOf } from "./media-types";

export type XmpFormat = "jpeg" | "png" | "webp" | "svg";

/** Why bytes could not be read or rewritten. */
export class XmpContainerError extends Error {
  override name = "XmpContainerError";
}

const FORMAT_BY_EXTENSION = new Map<string, XmpFormat>([
  [".jpeg", "jpeg"],
  [".jpg", "jpeg"],
  [".png", "png"],
  [".svg", "svg"],
  [".webp", "webp"],
]);

/** The container a path's extension names, when Studio can read and write its XMP. */
export function xmpFormatOf(path: string): XmpFormat | null {
  return FORMAT_BY_EXTENSION.get(extensionOf(path)) ?? null;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

function decode(bytes: Uint8Array): string {
  try {
    return fromUtf8.decode(bytes);
  } catch {
    throw new XmpContainerError("The metadata is not valid UTF-8.");
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Whether a flag bit is set in a byte: a bit test by arithmetic, as the lint asks. */
function hasFlag(byte: number, flag: number): boolean {
  return Math.floor(byte / flag) % 2 === 1;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCodePoint(...bytes.subarray(at, at + length));
}

/** The packet in `bytes`, or `null` when the file has none. */
export function extractXmp(bytes: Uint8Array, format: XmpFormat): string | null {
  switch (format) {
    case "jpeg": {
      return jpegXmp(bytes).packet;
    }
    case "png": {
      return pngXmp(bytes).packet;
    }
    case "webp": {
      return webpXmp(bytes).packet;
    }
    default: {
      return svgXmp(decode(bytes)).packet;
    }
  }
}

/** `bytes` with its packet replaced by `packet` (or given one). */
export function embedXmp(
  bytes: Uint8Array,
  format: XmpFormat,
  packet: string,
): Uint8Array<ArrayBuffer> {
  switch (format) {
    case "jpeg": {
      return jpegEmbed(bytes, packet);
    }
    case "png": {
      return pngEmbed(bytes, packet);
    }
    case "webp": {
      return webpEmbed(bytes, packet);
    }
    default: {
      return utf8.encode(svgEmbed(decode(bytes), packet));
    }
  }
}

// ─── JPEG ────────────────────────────────────────────────────────────────────

const JPEG_XMP_HEADER = utf8.encode("http://ns.adobe.com/xap/1.0/\0");
/** The largest payload one segment holds: a 16-bit length that counts its own two bytes. */
const JPEG_SEGMENT_MAX = 0xff_ff - 2;

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
}

/** The marker segments before the scan data. */
function jpegSegments(bytes: Uint8Array): JpegSegment[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new XmpContainerError("Not a JPEG file.");
  }
  const segments: JpegSegment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) {
      throw new XmpContainerError("The JPEG's markers are damaged.");
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      // Fill byte.
      at += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    const length = view(bytes).getUint16(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) {
      throw new XmpContainerError("The JPEG's markers are damaged.");
    }
    segments.push({ end, marker, start: at });
    at = end;
  }
  return segments;
}

function isJpegXmp(bytes: Uint8Array, segment: JpegSegment): boolean {
  const payload = segment.start + 4;
  return (
    segment.marker === 0xe1 &&
    segment.end - payload >= JPEG_XMP_HEADER.length &&
    JPEG_XMP_HEADER.every((byte, i) => bytes[payload + i] === byte)
  );
}

interface Found<T> {
  packet: string | null;
  parts: T[];
}

function jpegXmp(bytes: Uint8Array): Found<JpegSegment> {
  const segments = jpegSegments(bytes);
  const found = segments.find((segment) => isJpegXmp(bytes, segment));
  const packet =
    found === undefined
      ? null
      : decode(bytes.subarray(found.start + 4 + JPEG_XMP_HEADER.length, found.end));
  return { packet, parts: segments };
}

function jpegEmbed(bytes: Uint8Array, packet: string): Uint8Array<ArrayBuffer> {
  const { parts: segments } = jpegXmp(bytes);
  const body = utf8.encode(packet);
  const length = JPEG_XMP_HEADER.length + body.length;
  if (length > JPEG_SEGMENT_MAX) {
    throw new XmpContainerError("The metadata is too large for one JPEG segment.");
  }
  const head = Uint8Array.of(0xff, 0xe1, 0, 0);
  view(head).setUint16(2, length + 2);
  const segment = concat([head, JPEG_XMP_HEADER, body]);
  // After the leading APP0 (JFIF) and Exif APP1 segments, where readers look first.
  let insertAt = 2;
  for (const each of segments) {
    if ((each.marker === 0xe0 || each.marker === 0xe1) && !isJpegXmp(bytes, each)) {
      insertAt = each.end;
    } else {
      break;
    }
  }
  const parts: Uint8Array[] = [bytes.subarray(0, insertAt), segment];
  let at = insertAt;
  for (const each of segments) {
    if (each.start >= insertAt && isJpegXmp(bytes, each)) {
      parts.push(bytes.subarray(at, each.start));
      at = each.end;
    }
  }
  parts.push(bytes.subarray(at));
  return concat(parts);
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_XMP_KEYWORD = "XML:com.adobe.xmp";

interface PngChunk {
  type: string;
  start: number;
  dataStart: number;
  end: number;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 as PNG computes it (ISO 3309), over the chunk type and data. */
/* oxlint-disable no-bitwise -- CRC-32 IS bitwise arithmetic over 32-bit words; written any other
   way it is the same operations, slower and harder to check against the specification. */
export function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}
/* oxlint-enable no-bitwise */

function pngChunks(bytes: Uint8Array): PngChunk[] {
  if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) {
    throw new XmpContainerError("Not a PNG file.");
  }
  const chunks: PngChunk[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const length = view(bytes).getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.length) {
      throw new XmpContainerError("The PNG's chunks are damaged.");
    }
    const type = ascii(bytes, at + 4, 4);
    chunks.push({ dataStart: at + 8, end, start: at, type });
    at = end;
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

/** An `iTXt` chunk's text when its keyword is XMP's, else `null`. */
function pngChunkXmp(bytes: Uint8Array, chunk: PngChunk): string | null {
  if (chunk.type !== "iTXt") {
    return null;
  }
  const data = bytes.subarray(chunk.dataStart, chunk.end - 4);
  const keywordEnd = data.indexOf(0);
  if (keywordEnd === -1 || ascii(data, 0, keywordEnd) !== PNG_XMP_KEYWORD) {
    return null;
  }
  if (data[keywordEnd + 1] !== 0) {
    throw new XmpContainerError("The PNG's metadata is compressed, which Studio does not rewrite.");
  }
  // Keyword \0, compression flag, method, language \0, translated keyword \0, then the text.
  const languageEnd = data.indexOf(0, keywordEnd + 3);
  const translatedEnd = languageEnd === -1 ? -1 : data.indexOf(0, languageEnd + 1);
  if (translatedEnd === -1) {
    throw new XmpContainerError("The PNG's metadata chunk is damaged.");
  }
  return decode(data.subarray(translatedEnd + 1));
}

function pngXmp(bytes: Uint8Array): Found<PngChunk> {
  const chunks = pngChunks(bytes);
  const packets = chunks.map((chunk) => pngChunkXmp(bytes, chunk));
  return { packet: packets.find((packet) => packet !== null) ?? null, parts: chunks };
}

function pngEmbed(bytes: Uint8Array, packet: string): Uint8Array<ArrayBuffer> {
  const { parts: chunks } = pngXmp(bytes);
  const data = concat([
    utf8.encode(PNG_XMP_KEYWORD),
    Uint8Array.of(0, 0, 0, 0, 0),
    utf8.encode(packet),
  ]);
  const typeAndData = concat([utf8.encode("iTXt"), data]);
  const chunk = new Uint8Array(12 + data.length);
  view(chunk).setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view(chunk).setUint32(8 + data.length, crc32(typeAndData));
  const firstData = chunks.find((each) => each.type === "IDAT");
  if (firstData === undefined) {
    throw new XmpContainerError("The PNG has no image data.");
  }
  const parts: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE.length)];
  for (const each of chunks) {
    if (each === firstData) {
      parts.push(chunk);
    }
    if (pngChunkXmp(bytes, each) === null) {
      parts.push(bytes.subarray(each.start, each.end));
    }
  }
  const last = chunks.at(-1);
  parts.push(bytes.subarray(last === undefined ? PNG_SIGNATURE.length : last.end));
  return concat(parts);
}

// ─── WebP ────────────────────────────────────────────────────────────────────

interface RiffChunk {
  fourcc: string;
  start: number;
  dataStart: number;
  size: number;
  /** The end including the pad byte. */
  end: number;
}

const VP8X_XMP = 0x04;
const VP8X_ALPHA = 0x10;

function webpChunks(bytes: Uint8Array): RiffChunk[] {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    throw new XmpContainerError("Not a WebP file.");
  }
  const riffEnd = Math.min(bytes.length, 8 + view(bytes).getUint32(4, true));
  const chunks: RiffChunk[] = [];
  let at = 12;
  while (at + 8 <= riffEnd) {
    const size = view(bytes).getUint32(at + 4, true);
    const dataStart = at + 8;
    const end = dataStart + size + (size % 2);
    if (dataStart + size > riffEnd) {
      throw new XmpContainerError("The WebP's chunks are damaged.");
    }
    chunks.push({
      dataStart,
      end: Math.min(end, riffEnd),
      fourcc: ascii(bytes, at, 4),
      size,
      start: at,
    });
    at = end;
  }
  return chunks;
}

function webpXmp(bytes: Uint8Array): Found<RiffChunk> {
  const chunks = webpChunks(bytes);
  const found = chunks.find((chunk) => chunk.fourcc === "XMP ");
  const packet =
    found === undefined
      ? null
      : decode(bytes.subarray(found.dataStart, found.dataStart + found.size));
  return { packet, parts: chunks };
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + (data.length % 2));
  chunk.set(utf8.encode(fourcc), 0);
  view(chunk).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

/** A `VP8X` header for a simple file, its canvas and alpha read from the bitstream. */
function vp8xFor(bytes: Uint8Array, image: RiffChunk): Uint8Array {
  const data = bytes.subarray(image.dataStart, image.dataStart + image.size);
  let width: number;
  let height: number;
  let alpha = false;
  if (image.fourcc === "VP8 ") {
    // Frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height.
    if (data.length < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
      throw new XmpContainerError("The WebP's image data is damaged.");
    }
    // The top two bits of each are a scale, not part of the size.
    width = view(data).getUint16(6, true) % 0x40_00;
    height = view(data).getUint16(8, true) % 0x40_00;
  } else if (image.fourcc === "VP8L") {
    if (data.length < 5 || data[0] !== 0x2f) {
      throw new XmpContainerError("The WebP's image data is damaged.");
    }
    // 14 bits of width - 1, 14 of height - 1, then the alpha hint, little-endian.
    const bits = view(data).getUint32(1, true);
    width = (bits % 0x40_00) + 1;
    height = (Math.floor(bits / 0x40_00) % 0x40_00) + 1;
    alpha = hasFlag(bits, 2 ** 28);
  } else {
    throw new XmpContainerError("The WebP has no image data.");
  }
  const header = new Uint8Array(10);
  header[0] = VP8X_XMP + (alpha ? VP8X_ALPHA : 0);
  // Canvas width - 1 and height - 1, each 24 bits little-endian; a 14-bit size fits in the low 16.
  view(header).setUint16(4, width - 1, true);
  view(header).setUint16(7, height - 1, true);
  return riffChunk("VP8X", header);
}

function webpEmbed(bytes: Uint8Array, packet: string): Uint8Array<ArrayBuffer> {
  const { parts: chunks } = webpXmp(bytes);
  const parts: Uint8Array[] = [];
  const vp8x = chunks.find((chunk) => chunk.fourcc === "VP8X");
  if (vp8x === undefined) {
    const [image] = chunks;
    if (image === undefined) {
      throw new XmpContainerError("The WebP has no image data.");
    }
    parts.push(vp8xFor(bytes, image));
  }
  for (const chunk of chunks) {
    if (chunk.fourcc === "XMP ") {
      continue;
    }
    if (chunk === vp8x) {
      const copy = bytes.slice(chunk.start, chunk.end);
      const flags = copy[8] ?? 0;
      copy[8] = hasFlag(flags, VP8X_XMP) ? flags : flags + VP8X_XMP;
      parts.push(copy);
    } else {
      parts.push(bytes.subarray(chunk.start, chunk.end));
    }
  }
  // XMP is the last chunk of an extended file.
  parts.push(riffChunk("XMP ", utf8.encode(packet)));
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(utf8.encode("RIFF"), 0);
  view(out).setUint32(4, 4 + body.length, true);
  out.set(utf8.encode("WEBP"), 8);
  out.set(body, 12);
  return out;
}

// ─── SVG ─────────────────────────────────────────────────────────────────────

const XMPMETA = /<([\w.-]+:)?xmpmeta\b[\s\S]*?<\/\1?xmpmeta\s*>/;

/** The end of the start tag that begins at `lt`, honouring quoted attribute values. */
function tagEnd(text: string, lt: number): number {
  let quote: string | null = null;
  for (let at = lt + 1; at < text.length; at++) {
    const ch = text[at];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return at;
    }
  }
  return -1;
}

/** A range of the SVG source. */
interface SvgSpan {
  start: number;
  end: number;
}

/** The root `<svg …>` start tag's range. */
function svgRoot(text: string): SvgSpan & { selfClosing: boolean } {
  const match = /<svg[\s>/]/.exec(text);
  if (match === null) {
    throw new XmpContainerError("Not an SVG file.");
  }
  const end = tagEnd(text, match.index);
  if (end === -1) {
    throw new XmpContainerError("The SVG's root element is damaged.");
  }
  return { end, selfClosing: text[end - 1] === "/", start: match.index };
}

/** The `x:xmpmeta` element's source and range, inside the root's metadata. */
function svgXmp(text: string): SvgSpan & { packet: string | null } {
  svgRoot(text);
  const match = XMPMETA.exec(text);
  return match === null
    ? { end: -1, packet: null, start: -1 }
    : { end: match.index + match[0].length, packet: match[0], start: match.index };
}

/** The packet without its `xpacket` wrapper: SVG is already XML, and holds the element alone. */
function bareXmpmeta(packet: string): string {
  const match = XMPMETA.exec(packet);
  if (match === null) {
    throw new XmpContainerError("The metadata has no x:xmpmeta element.");
  }
  return match[0];
}

function svgEmbed(text: string, packet: string): string {
  const meta = bareXmpmeta(packet);
  const found = svgXmp(text);
  if (found.packet !== null) {
    return text.slice(0, found.start) + meta + text.slice(found.end);
  }
  const root = svgRoot(text);
  if (root.selfClosing) {
    const open = text.slice(root.start, root.end - 1).trimEnd();
    return `${text.slice(0, root.start)}${open}><metadata>${meta}</metadata></svg>${text.slice(root.end + 1)}`;
  }
  const existing = /<metadata(\s[^>]*)?>/.exec(text.slice(root.end));
  if (existing !== null) {
    const at = root.end + existing.index + existing[0].length;
    return text.slice(0, at) + meta + text.slice(at);
  }
  return `${text.slice(0, root.end + 1)}<metadata>${meta}</metadata>${text.slice(root.end + 1)}`;
}
