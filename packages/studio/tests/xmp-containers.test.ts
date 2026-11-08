import { describe, expect, test } from "bun:test";
import {
  XmpContainerError,
  crc32,
  embedXmp,
  extractXmp,
  xmpFormatOf,
} from "../src/files/xmp-containers";
import { readMediaRecord, writeMediaRecord } from "../src/files/xmp-packet";
import { isString } from "@jxsuite/schema/guards";
import type { XmpFormat } from "../src/files/xmp-containers";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytes(...parts: (number[] | Uint8Array | string)[]): Uint8Array<ArrayBuffer> {
  const arrays = parts.map((part) => (isString(part) ? enc.encode(part) : Uint8Array.from(part)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

const PACKET = writeMediaRecord(null, { alt: "Seedlings", tags: ["Garden"] });
const PACKET_2 = writeMediaRecord(null, { alt: "Bees", tags: [] });

// ─── JPEG ────────────────────────────────────────────────────────────────────

function segment(marker: number, payload: Uint8Array | string): Uint8Array {
  const data = isString(payload) ? enc.encode(payload) : payload;
  const head = Uint8Array.of(0xff, marker, 0, 0);
  new DataView(head.buffer).setUint16(2, data.length + 2);
  return bytes(head, data);
}

const SCAN = bytes([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);
const JPEG = bytes(
  [0xff, 0xd8],
  segment(0xe0, "JFIF\0\u0001\u0002"),
  segment(0xe1, "Exif\0\0MM"),
  segment(0xdb, "quant"),
  SCAN,
);

describe("JPEG", () => {
  test("a file with no packet reads null, and is given one after its Exif segment", () => {
    expect(extractXmp(JPEG, "jpeg")).toBeNull();
    const out = embedXmp(JPEG, "jpeg", PACKET);
    expect(extractXmp(out, "jpeg")).toBe(PACKET);
    const text = dec.decode(out);
    expect(text.indexOf("Exif")).toBeLessThan(text.indexOf("http://ns.adobe.com/xap/1.0/"));
    expect(text.indexOf("http://ns.adobe.com/xap/1.0/")).toBeLessThan(text.indexOf("quant"));
    // The scan data is untouched.
    expect(out.subarray(-SCAN.length)).toEqual(SCAN);
  });

  test("a second write replaces the packet rather than adding one", () => {
    const once = embedXmp(JPEG, "jpeg", PACKET);
    const twice = embedXmp(once, "jpeg", PACKET_2);
    expect(extractXmp(twice, "jpeg")).toBe(PACKET_2);
    expect(dec.decode(twice).split("http://ns.adobe.com/xap/1.0/")).toHaveLength(2);
  });

  test("a packet placed late in the header is moved to the front", () => {
    const late = bytes(
      [0xff, 0xd8],
      segment(0xdb, "quant"),
      segment(0xe1, bytes("http://ns.adobe.com/xap/1.0/\0", PACKET)),
      SCAN,
    );
    expect(readMediaRecord(extractXmp(late, "jpeg")).alt).toBe("Seedlings");
    const out = embedXmp(late, "jpeg", PACKET_2);
    expect(extractXmp(out, "jpeg")).toBe(PACKET_2);
    expect(dec.decode(out).split("http://ns.adobe.com/xap/1.0/")).toHaveLength(2);
  });

  test("skips fill bytes and stops at the end of the image", () => {
    const filled = bytes([0xff, 0xd8, 0xff], segment(0xe0, "JFIF"), [0xff, 0xd9]);
    expect(extractXmp(filled, "jpeg")).toBeNull();
  });

  test("refuses what is not a JPEG, damaged markers, and a packet too large", () => {
    expect(() => extractXmp(enc.encode("nope"), "jpeg")).toThrow(XmpContainerError);
    expect(() => extractXmp(bytes([0xff, 0xd8, 0x00, 0x00, 0, 0]), "jpeg")).toThrow(
      /markers are damaged/,
    );
    expect(() => extractXmp(bytes([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff]), "jpeg")).toThrow(
      /markers are damaged/,
    );
    expect(() => embedXmp(JPEG, "jpeg", "x".repeat(70_000))).toThrow(/too large/);
  });

  test("refuses metadata that is not UTF-8", () => {
    const bad = bytes(
      [0xff, 0xd8],
      segment(0xe1, bytes("http://ns.adobe.com/xap/1.0/\0", [0xff, 0xfe])),
      SCAN,
    );
    expect(() => extractXmp(bad, "jpeg")).toThrow(/not valid UTF-8/);
  });
});

// ─── PNG ─────────────────────────────────────────────────────────────────────

function chunk(type: string, data: Uint8Array | string): Uint8Array {
  const body = isString(data) ? enc.encode(data) : data;
  const typed = bytes(type, body);
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(typed, 4);
  view.setUint32(8 + body.length, crc32(typed));
  return out;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG = bytes(SIGNATURE, chunk("IHDR", "header"), chunk("IDAT", "pixels"), chunk("IEND", ""));

function xmpChunk(packet: string, compressed = 0): Uint8Array {
  return chunk("iTXt", bytes("XML:com.adobe.xmp", [0, compressed, 0], "\0\0", packet));
}

describe("PNG", () => {
  test("crc32 is PNG's", () => {
    // The CRC of an empty IEND chunk, as every PNG ends.
    expect(crc32(enc.encode("IEND"))).toBe(0xae_42_60_82);
  });

  test("a packet is written as an iTXt chunk before the image data", () => {
    expect(extractXmp(PNG, "png")).toBeNull();
    const out = embedXmp(PNG, "png", PACKET);
    expect(extractXmp(out, "png")).toBe(PACKET);
    const text = dec.decode(out);
    expect(text.indexOf("XML:com.adobe.xmp")).toBeLessThan(text.indexOf("IDAT"));
    // The new chunk's CRC is valid.
    const at = text.indexOf("iTXt") - 4;
    const length = new DataView(out.buffer).getUint32(at);
    const crc = new DataView(out.buffer).getUint32(at + 8 + length);
    expect(crc).toBe(crc32(out.subarray(at + 4, at + 8 + length)));
  });

  test("an existing packet after the image data is replaced, and other text chunks kept", () => {
    const withLate = bytes(
      SIGNATURE,
      chunk("IHDR", "header"),
      chunk("iTXt", bytes("Comment", [0, 0, 0], "\0\0", "hello")),
      chunk("IDAT", "pixels"),
      xmpChunk(PACKET),
      chunk("IEND", ""),
    );
    expect(extractXmp(withLate, "png")).toBe(PACKET);
    const out = embedXmp(withLate, "png", PACKET_2);
    expect(extractXmp(out, "png")).toBe(PACKET_2);
    const text = dec.decode(out);
    expect(text.split("XML:com.adobe.xmp")).toHaveLength(2);
    expect(text).toContain("hello");
  });

  test("refuses a compressed packet, a damaged one, a damaged file, and one with no pixels", () => {
    const compressed = bytes(SIGNATURE, chunk("IHDR", "h"), xmpChunk("zz", 1), chunk("IEND", ""));
    expect(() => extractXmp(compressed, "png")).toThrow(/compressed/);
    const damaged = bytes(
      SIGNATURE,
      chunk("iTXt", bytes("XML:com.adobe.xmp", [0, 0, 0], "no-terminators")),
      chunk("IEND", ""),
    );
    expect(() => extractXmp(damaged, "png")).toThrow(/damaged/);
    expect(() => extractXmp(bytes(SIGNATURE, [0, 0, 0, 99], "IDAT", [0, 0, 0, 0]), "png")).toThrow(
      /damaged/,
    );
    expect(() => extractXmp(enc.encode("not a png at all"), "png")).toThrow(/Not a PNG/);
    expect(() => embedXmp(bytes(SIGNATURE, chunk("IEND", "")), "png", PACKET)).toThrow(
      /no image data/,
    );
    // A chunk-less tail after the signature is tolerated when reading.
    expect(extractXmp(bytes(SIGNATURE), "png")).toBeNull();
  });
});

// ─── WebP ────────────────────────────────────────────────────────────────────

function riff(...chunks: Uint8Array[]): Uint8Array {
  const body = bytes("WEBP", ...chunks);
  const head = new Uint8Array(8);
  head.set(enc.encode("RIFF"));
  new DataView(head.buffer).setUint32(4, body.length, true);
  return bytes(head, body);
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length % 2));
  out.set(enc.encode(fourcc));
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/** A VP8L header for a `w` × `h` image, with or without alpha. */
function vp8l(w: number, h: number, alpha: boolean): Uint8Array {
  const bits = w - 1 + (h - 1) * 0x40_00 + (alpha ? 2 ** 28 : 0);
  const data = new Uint8Array(9);
  data[0] = 0x2f;
  new DataView(data.buffer).setUint32(1, bits, true);
  return riffChunk("VP8L", data);
}

/** A VP8 (lossy) key frame header for a `w` × `h` image. */
function vp8(w: number, h: number): Uint8Array {
  const data = Uint8Array.of(0, 0, 0, 0x9d, 0x01, 0x2a, 0, 0, 0, 0, 7);
  const view = new DataView(data.buffer);
  view.setUint16(6, w, true);
  view.setUint16(8, h, true);
  return riffChunk("VP8 ", data);
}

/** What a VP8X chunk says: its flags, and its canvas. */
interface Canvas {
  flags: number;
  width: number;
  height: number;
}

function canvas(out: Uint8Array): Canvas {
  const at = dec.decode(out).indexOf("VP8X") + 8;
  const view = new DataView(out.buffer, out.byteOffset);
  const read24 = (o: number): number => view.getUint16(o, true) + (out[o + 2] ?? 0) * 0x1_00_00;
  return { flags: out[at] ?? 0, height: read24(at + 7) + 1, width: read24(at + 4) + 1 };
}

/** A file that `embedXmp` must refuse, with the reason it gives. */
function refusedEmbed(file: Uint8Array): () => Uint8Array {
  return () => embedXmp(file, "webp", PACKET);
}

describe("WebP", () => {
  test("a lossless file is extended, its canvas and alpha taken from the bitstream", () => {
    const file = riff(vp8l(640, 427, true));
    expect(extractXmp(file, "webp")).toBeNull();
    const out = embedXmp(file, "webp", PACKET);
    expect(extractXmp(out, "webp")).toBe(PACKET);
    expect(canvas(out)).toEqual({ flags: 0x14, height: 427, width: 640 });
    // The RIFF size covers the whole file.
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    // XMP is the last chunk.
    expect(dec.decode(out).lastIndexOf("XMP ")).toBeGreaterThan(dec.decode(out).indexOf("VP8L"));
  });

  test("a lossy file is extended with its frame size and no alpha", () => {
    const out = embedXmp(riff(vp8(1200, 630)), "webp", PACKET);
    expect(canvas(out)).toEqual({ flags: 0x04, height: 630, width: 1200 });
    expect(extractXmp(out, "webp")).toBe(PACKET);
  });

  test("an extended file has its flag set and its packet replaced in place of a second", () => {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x10;
    const file = riff(riffChunk("VP8X", vp8x), vp8l(2, 2, true));
    const once = embedXmp(file, "webp", PACKET);
    const twice = embedXmp(once, "webp", PACKET_2);
    expect(extractXmp(twice, "webp")).toBe(PACKET_2);
    expect(dec.decode(twice).split("XMP ")).toHaveLength(2);
    expect(canvas(twice).flags).toBe(0x14);
  });

  test("an odd-length packet is padded and still reads back", () => {
    const odd = `${PACKET} `.length % 2 === 1 ? `${PACKET} ` : `${PACKET}  `;
    const out = embedXmp(riff(vp8l(1, 1, false)), "webp", odd);
    expect(out.length % 2).toBe(0);
    expect(extractXmp(out, "webp")).toBe(odd);
  });

  test("refuses what is not a WebP, damaged chunks, and damaged bitstreams", () => {
    expect(() => extractXmp(enc.encode("RIFF0000WAVE"), "webp")).toThrow(/Not a WebP/);
    const damaged = riff(riffChunk("VP8L", Uint8Array.of(0x2f)));
    // The chunk claims more bytes than the file has.
    damaged[16] = 0xff;
    expect(() => extractXmp(damaged, "webp")).toThrow(/damaged/);
    const lossless = riff(riffChunk("VP8L", Uint8Array.of(0, 0, 0, 0, 0)));
    expect(refusedEmbed(lossless)).toThrow(/image data is damaged/);
    const lossy = riff(riffChunk("VP8 ", Uint8Array.of(0, 0, 0, 0, 0, 0)));
    expect(refusedEmbed(lossy)).toThrow(/image data is damaged/);
    const alphaOnly = riff(riffChunk("ALPH", Uint8Array.of(0)));
    expect(refusedEmbed(alphaOnly)).toThrow(/no image data/);
    expect(() => embedXmp(riff(), "webp", PACKET)).toThrow(/no image data/);
  });
});

// ─── SVG ─────────────────────────────────────────────────────────────────────

describe("SVG", () => {
  const svg = (text: string): Uint8Array => enc.encode(text);

  test("a packet goes into a new metadata element, without its xpacket wrapper", () => {
    const source = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" data-x='a>b' viewBox="0 0 10 10">\n  <rect width="10" height="10"/>\n</svg>\n`;
    const out = dec.decode(embedXmp(svg(source), "svg", PACKET));
    expect(out).not.toContain("xpacket");
    expect(out).toContain(`data-x='a>b' viewBox="0 0 10 10"><metadata><x:xmpmeta`);
    // The author's own markup is untouched.
    expect(out).toContain('\n  <rect width="10" height="10"/>\n</svg>\n');
    const packet = extractXmp(svg(out), "svg");
    expect(readMediaRecord(packet)).toEqual({
      alt: "Seedlings",
      tags: ["Garden"],
    });
  });

  test("an existing packet is replaced where it is; an existing metadata element is reused", () => {
    const source = svg(
      `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="m"><dc:x xmlns:dc="urn:x"/></metadata></svg>`,
    );
    const once = embedXmp(source, "svg", PACKET);
    const text = dec.decode(once);
    expect(text).toContain(`<metadata id="m"><x:xmpmeta`);
    expect(text).toContain(`<dc:x xmlns:dc="urn:x"/></metadata>`);
    const twice = dec.decode(embedXmp(once, "svg", PACKET_2));
    expect(twice.split("xmpmeta")).toHaveLength(3);
    const packet = extractXmp(svg(twice), "svg");
    expect(readMediaRecord(packet).alt).toBe("Bees");
  });

  test("a self-closing root is opened to hold the metadata", () => {
    const out = dec.decode(
      embedXmp(svg(`<svg xmlns="http://www.w3.org/2000/svg" />`), "svg", PACKET),
    );
    expect(out).toMatch(
      /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"><metadata><x:xmpmeta[\s\S]*<\/metadata><\/svg>$/,
    );
  });

  test("refuses what is not an SVG, a damaged root, and a packet with no xmpmeta", () => {
    expect(() => extractXmp(svg("<html/>"), "svg")).toThrow(/Not an SVG/);
    expect(() => extractXmp(svg(`<svg a="b`), "svg")).toThrow(/damaged/);
    expect(() => embedXmp(svg("<svg></svg>"), "svg", "<rdf:RDF/>")).toThrow(/no x:xmpmeta/);
    expect(() => extractXmp(Uint8Array.of(0xff), "svg")).toThrow(/UTF-8/);
  });
});

describe("xmpFormatOf", () => {
  test.each<[string, XmpFormat | null]>([
    ["a/b.jpg", "jpeg"],
    ["a/b.JPEG", "jpeg"],
    ["b.png", "png"],
    ["b.webp", "webp"],
    ["b.svg", "svg"],
    ["b.gif", null],
    ["b.avif", null],
    ["b.mp4", null],
  ])("%s → %s", (path, format) => {
    expect(xmpFormatOf(path)).toBe(format);
  });
});
