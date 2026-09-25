/// <reference lib="dom" />
/**
 * Base64 encoding for binary payloads that cross an RPC boundary.
 *
 * `StudioPlatform.uploadFile` accepts `string | File | Blob | ArrayBuffer`, but the RPC platforms
 * (electrobun, chromium) JSON-serialize their params — a `File`/`Blob` becomes `{}` on the wire.
 * Those platforms encode here before the call; the HTTP platforms (dev server, cloud) post the
 * binary body directly and must NOT use this.
 *
 * {@link base64ToBytes} is the same boundary in the other direction, for `readFileBytes`: the RPC
 * backends answer a base64 string for the same reason they accept one, and the caller wants bytes.
 */

/** Bytes per `String.fromCodePoint` call — spreading a whole large file blows the call stack. */
const CHUNK = 32_768;

/** Base64-encode raw bytes without blowing the call stack on spread. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Normalize an upload payload to base64. A `string` passes through unchanged — the RPC backends
 * have always received base64 strings, so existing callers keep working.
 */
export async function toBase64(data: string | File | Blob | ArrayBuffer): Promise<string> {
  if (typeof data === "string") {
    return data;
  }
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

/**
 * Decode a base64 string to raw bytes — the inverse of {@link bytesToBase64}.
 *
 * The RPC platforms' `readFileBytes` answers base64 because their params and results are JSON, so
 * this is where a JPEG becomes a JPEG again. `atob` yields one character per byte, and reading them
 * back with `charCodeAt` is what keeps a byte above 0x7F from being re-encoded as UTF-8 — the exact
 * corruption that makes `readFile` useless for an image.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
