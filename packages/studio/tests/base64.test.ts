/**
 * Base64 upload encoding — the shim that lets the RPC desktop platforms carry binary over a
 * JSON-serialized wire (a File/Blob would otherwise serialize to `{}`).
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { base64ToBytes, bytesToBase64, toBase64 } from "../src/utils/base64";

describe("bytesToBase64", () => {
  test("encodes bytes", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  test("encodes the empty buffer", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });

  test("chunks past the 32KiB spread limit without blowing the stack", () => {
    // A single String.fromCodePoint(...bytes) at this size overflows the call stack; the chunked
    // Loop is the reason this function exists.
    const bytes = new Uint8Array(100_000).fill(65);
    const encoded = bytesToBase64(bytes);
    expect(atob(encoded)).toHaveLength(100_000);
    expect(atob(encoded).startsWith("AAA")).toBe(true);
  });

  test("survives high bytes (not just ASCII)", () => {
    const bytes = new Uint8Array([0, 127, 128, 255]);
    const round = atob(bytesToBase64(bytes));
    expect([...round].map((c) => c.codePointAt(0))).toEqual([0, 127, 128, 255]);
  });
});

describe("toBase64", () => {
  test("a string passes through untouched — desktop callers already send base64", async () => {
    expect(await toBase64("YWxyZWFkeQ==")).toBe("YWxyZWFkeQ==");
  });

  test("encodes a Blob", async () => {
    expect(await toBase64(new Blob(["hi"]))).toBe("aGk=");
  });

  test("encodes a File", async () => {
    expect(await toBase64(new File(["hi"], "a.txt"))).toBe("aGk=");
  });

  test("encodes a raw ArrayBuffer", async () => {
    expect(await toBase64(new Uint8Array([104, 105]).buffer)).toBe("aGk=");
  });
});

describe("base64ToBytes", () => {
  test("decodes to bytes", () => {
    expect([...base64ToBytes("aGk=")]).toEqual([104, 105]);
  });

  test("decodes the empty string", () => {
    expect(base64ToBytes("")).toHaveLength(0);
  });

  /* The whole reason this exists rather than a `TextEncoder` round trip: every byte above 0x7F is
     a byte, not a character. Decoding through a string type would re-encode these as two UTF-8
     bytes each and the image would be corrupt in a way nothing downstream could detect. */
  test("round-trips high bytes that UTF-8 would mangle", () => {
    const bytes = new Uint8Array([0, 127, 128, 255, 0xff, 0xd8, 0xff, 0xe0]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  test("round-trips a buffer larger than the encoder's chunk", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});
