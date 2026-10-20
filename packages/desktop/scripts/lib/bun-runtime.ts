/**
 * Which Bun a packaged build carries, and how to tell a download is the one pinned.
 *
 * The table is `bun-runtime.json`; this is the lookup and the check, free of I/O so a test can hold
 * them. The download and the unpacking are `stage-app.ts`'s.
 */
import { createHash } from "node:crypto";
import table from "../../bun-runtime.json" with { type: "json" };

/** One platform's pinned release asset. */
export interface BunRuntime {
  /** The executable's name inside the archive's top directory. */
  binary: string;
  /** The archive's file name without `.zip`, which is also its top directory. */
  file: string;
  /** Lower-case hex SHA-256 of the archive. */
  sha256: string;
  /** Where the archive comes from. */
  url: string;
  version: string;
}

/**
 * The pinned Bun for a platform.
 *
 * @param platform `process.platform` of the build's target.
 * @param arch `process.arch` of the build's target.
 * @throws {Error} When no Bun release is pinned for the pair, rather than shipping an app that
 *   cannot start its backend.
 */
export function bunRuntimeFor(platform: string, arch: string): BunRuntime {
  const key = `${platform}-${arch}`;
  /* SAFETY: the table is a committed JSON object keyed by platform-arch; a missing key reads as undefined. */
  const asset = (table.assets as Record<string, { file: string; sha256: string } | undefined>)[key];
  if (!asset) {
    throw new Error(
      `No Bun release is pinned for ${key}; bun-runtime.json has ${Object.keys(table.assets).join(", ")}.`,
    );
  }
  return {
    binary: platform === "win32" ? "bun.exe" : "bun",
    file: asset.file,
    sha256: asset.sha256,
    url: `https://github.com/oven-sh/bun/releases/download/bun-v${table.version}/${asset.file}.zip`,
    version: table.version,
  };
}

/**
 * Whether downloaded bytes are the pinned archive.
 *
 * @param bytes The archive as downloaded.
 * @param expected The pinned lower-case hex SHA-256.
 */
export function matchesChecksum(bytes: Uint8Array, expected: string): boolean {
  return createHash("sha256").update(bytes).digest("hex") === expected;
}
