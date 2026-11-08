/**
 * A media file's own record — `src/files/media-record.ts`: read out of the file, cached against the
 * file's stamp, and written back into its bytes at the same path.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { installMockPlatform, resetStudioState } from "./harness";
import {
  canHoldMediaRecord,
  carryMediaRecord,
  carryRecordBetween,
  forgetMediaRecord,
  loadMediaRecord,
  mediaRecordsSupported,
  onMediaRecordsChanged,
  peekMediaRecord,
  resetMediaRecords,
  saveMediaRecord,
  withMediaRecord,
} from "../src/files/media-record";
import { embedXmp, extractXmp } from "../src/files/xmp-containers";
import { readMediaRecord, writeMediaRecord } from "../src/files/xmp-packet";
import { invalidateMediaMeta, seedMediaMeta } from "../src/files/media-meta";
import {
  beginListing,
  localRevisionOf,
  noteListing,
  resetAssetVersions,
} from "../src/files/asset-versions";
import { isRecentLocal } from "../src/files/fs-events";
import { setMediaChangedHandler } from "../src/files/media-upload";
import type { StudioPlatform } from "../src/types";

const BARE_JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function jpegWith(alt: string, tags: string[]): Uint8Array<ArrayBuffer> {
  return embedXmp(BARE_JPEG, "jpeg", writeMediaRecord(null, { alt, tags }));
}

/** The files on the fake disk, as bytes. */
let disk: Map<string, Uint8Array>;
let reads: string[];
let writes: string[];

function install(overrides: Partial<StudioPlatform> = {}): StudioPlatform {
  return installMockPlatform({
    readFileBytes: async (path: string) => {
      reads.push(path);
      const bytes = disk.get(path);
      if (bytes === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return Uint8Array.from(bytes).buffer;
    },
    uploadFile: async (path: string, body: string | Blob | ArrayBuffer) => {
      writes.push(path);
      if (body instanceof ArrayBuffer) {
        disk.set(path, new Uint8Array(body));
      }
      return { path };
    },
    ...overrides,
  }).platform;
}

beforeEach(() => {
  resetStudioState();
  resetMediaRecords();
  resetAssetVersions();
  invalidateMediaMeta();
  setMediaChangedHandler(null);
  disk = new Map([["public/hero.jpg", jpegWith("A hero", ["Garden"])]]);
  reads = [];
  writes = [];
  install();
});

describe("which files hold a record", () => {
  test("a format with a place for XMP, on a host that reads bytes", () => {
    expect(mediaRecordsSupported()).toBe(true);
    expect(canHoldMediaRecord("public/hero.jpg")).toBe(true);
    expect(canHoldMediaRecord("public/anim.gif")).toBe(false);
    expect(peekMediaRecord("public/anim.gif")).toEqual({ status: "unsupported" });
    const platform = install();
    delete platform.readFileBytes;
    expect(mediaRecordsSupported()).toBe(false);
    expect(canHoldMediaRecord("public/hero.jpg")).toBe(false);
  });

  test("an unsupported file is answered without a read, and refused a save", async () => {
    expect(await loadMediaRecord("public/anim.gif")).toEqual({ status: "unsupported" });
    expect(await saveMediaRecord("public/anim.gif", { alt: "x", tags: [] })).toBe(
      "This file's format cannot hold alt text or tags.",
    );
    expect(reads).toEqual([]);
  });
});

describe("reading", () => {
  test("reads once, shares the read in flight, and answers from memory after", async () => {
    expect(peekMediaRecord("public/hero.jpg")).toEqual({ status: "pending" });
    const heard = mock(() => {});
    const stop = onMediaRecordsChanged(heard);
    const [a, b] = await Promise.all([
      loadMediaRecord("public/hero.jpg"),
      loadMediaRecord("public/hero.jpg"),
    ]);
    expect(a).toEqual({ record: { alt: "A hero", tags: ["Garden"] }, status: "ready" });
    expect(b).toBe(a);
    expect(await loadMediaRecord("./public/hero.jpg")).toBe(a);
    expect(reads).toEqual(["public/hero.jpg"]);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  test("an unreadable file or packet is failed, never empty", async () => {
    disk.set("public/broken.png", Uint8Array.of(1, 2, 3));
    expect(await loadMediaRecord("public/broken.png")).toEqual({
      error: "Not a PNG file.",
      status: "failed",
    });
    expect(await loadMediaRecord("public/missing.jpg")).toEqual({
      error: "no such file: public/missing.jpg",
      status: "failed",
    });
  });

  test("a file whose stamp moved is read again", async () => {
    seedMediaMeta([
      { modified: "1", name: "hero.jpg", path: "public/hero.jpg", size: 10, type: "file" },
    ]);
    await loadMediaRecord("public/hero.jpg");
    // The listing is dropped: no stamp is known, so the cached answer stands.
    invalidateMediaMeta();
    await loadMediaRecord("public/hero.jpg");
    expect(reads).toHaveLength(1);
    // A new listing says the file changed.
    disk.set("public/hero.jpg", jpegWith("Changed", []));
    seedMediaMeta([
      { modified: "2", name: "hero.jpg", path: "public/hero.jpg", size: 10, type: "file" },
    ]);
    expect(peekMediaRecord("public/hero.jpg")).toEqual({ status: "pending" });
    expect(await loadMediaRecord("public/hero.jpg")).toEqual({
      record: { alt: "Changed", tags: [] },
      status: "ready",
    });
    expect(reads).toHaveLength(2);
  });

  test("a host's content version is the stamp where it vouches for one", async () => {
    const since = beginListing();
    noteListing([{ name: "hero.jpg", path: "public/hero.jpg", type: "file", version: "a" }], since);
    await loadMediaRecord("public/hero.jpg");
    const again = beginListing();
    noteListing([{ name: "hero.jpg", path: "public/hero.jpg", type: "file", version: "b" }], again);
    await loadMediaRecord("public/hero.jpg");
    expect(reads).toHaveLength(2);
  });

  test("a read that began before a reset does not land after it", async () => {
    const pending = loadMediaRecord("public/hero.jpg");
    resetMediaRecords();
    await pending;
    expect(peekMediaRecord("public/hero.jpg")).toEqual({ status: "pending" });
  });

  test("forgetting drops one file's answer and says so; forgetting nothing is silent", async () => {
    await loadMediaRecord("public/hero.jpg");
    const heard = mock(() => {});
    const stop = onMediaRecordsChanged(heard);
    forgetMediaRecord("public/hero.jpg");
    forgetMediaRecord("public/hero.jpg");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(peekMediaRecord("public/hero.jpg")).toEqual({ status: "pending" });
    stop();
  });
});

describe("saving", () => {
  test("rewrites the file at its own path, as Studio's own write", async () => {
    let markedFirst = false;
    install({
      uploadFile: async (path: string, body: string | Blob | ArrayBuffer) => {
        markedFirst = isRecentLocal(path);
        writes.push(path);
        if (body instanceof ArrayBuffer) {
          disk.set(path, new Uint8Array(body));
        }
        return { path };
      },
    });
    expect(
      await saveMediaRecord("public/hero.jpg", { alt: " New alt ", tags: ["b", "B", "a"] }),
    ).toBeNull();
    expect(markedFirst).toBe(true);
    const written = extractXmp(disk.get("public/hero.jpg") ?? BARE_JPEG, "jpeg");
    expect(readMediaRecord(written)).toEqual({
      alt: "New alt",
      tags: ["b", "a"],
    });
    expect(localRevisionOf("public/hero.jpg")).toBeString();
    // The written record is the answer, with no second read of the file just written.
    const readsAfter = reads.length;
    expect(await loadMediaRecord("public/hero.jpg")).toEqual({
      record: { alt: "New alt", tags: ["b", "a"] },
      status: "ready",
    });
    expect(reads).toHaveLength(readsAfter);
  });

  test("a record the file already carries writes nothing", async () => {
    expect(
      await saveMediaRecord("public/hero.jpg", { alt: "A hero", tags: ["Garden"] }),
    ).toBeNull();
    expect(writes).toEqual([]);
    expect(peekMediaRecord("public/hero.jpg")).toEqual({
      record: { alt: "A hero", tags: ["Garden"] },
      status: "ready",
    });
  });

  test("a file that cannot be read, or rewritten, is left as it was and the reason returned", async () => {
    expect(await saveMediaRecord("public/gone.jpg", { alt: "x", tags: [] })).toBe(
      "no such file: public/gone.jpg",
    );
    disk.set("public/odd.png", Uint8Array.of(0));
    expect(await saveMediaRecord("public/odd.png", { alt: "x", tags: [] })).toBe("Not a PNG file.");
    expect(writes).toEqual([]);
  });

  test("a refused upload, and an upload stored elsewhere, are reported", async () => {
    install({
      uploadFile: async () => {
        throw new Error("read-only");
      },
    });
    expect(await saveMediaRecord("public/hero.jpg", { alt: "x", tags: [] })).toBe("read-only");
    install({ uploadFile: async () => ({ path: "public/hero-1.jpg" }) });
    expect(await saveMediaRecord("public/hero.jpg", { alt: "x", tags: [] })).toBe(
      "The backend stored the file as public/hero-1.jpg instead of rewriting it.",
    );
  });
});

describe("carrying a record across an overwrite", () => {
  test("the old file's fields fill the new bytes' blanks", async () => {
    const carried = await carryMediaRecord("public/hero.jpg", BARE_JPEG);
    expect(readMediaRecord(extractXmp(carried, "jpeg"))).toEqual({
      alt: "A hero",
      tags: ["Garden"],
    });
  });

  test("the new bytes' own fields win, field by field", async () => {
    const own = jpegWith("Own alt", []);
    const carried = await carryMediaRecord("public/hero.jpg", own);
    expect(readMediaRecord(extractXmp(carried, "jpeg"))).toEqual({
      alt: "Own alt",
      tags: ["Garden"],
    });
    const complete = jpegWith("Own alt", ["Own"]);
    expect(await carryMediaRecord("public/hero.jpg", complete)).toBe(complete);
  });

  test("nothing to carry, nothing readable, or no place for it: the bytes as chosen", async () => {
    disk.set("public/empty.jpg", BARE_JPEG);
    expect(await carryMediaRecord("public/empty.jpg", BARE_JPEG)).toBe(BARE_JPEG);
    const odd = Uint8Array.of(9, 9);
    expect(await carryMediaRecord("public/hero.jpg", odd)).toBe(odd);
    expect(await carryMediaRecord("public/anim.gif", odd)).toBe(odd);
    expect(await carryMediaRecord("public/gone.jpg", BARE_JPEG)).toBe(BARE_JPEG);
  });

  test("from bytes in hand, reading nothing", () => {
    const carried = carryRecordBetween("public/hero.jpg", jpegWith("Held", ["x"]), BARE_JPEG);
    expect(readMediaRecord(extractXmp(carried, "jpeg"))).toEqual({ alt: "Held", tags: ["x"] });
    expect(reads).toEqual([]);
    // Nothing to carry from bytes that are not a JPEG, or into a format with no place for it.
    expect(carryRecordBetween("public/hero.jpg", Uint8Array.of(1), BARE_JPEG)).toBe(BARE_JPEG);
    expect(carryRecordBetween("public/a.gif", BARE_JPEG, BARE_JPEG)).toBe(BARE_JPEG);
  });

  test("withMediaRecord refuses a format with no place for one", () => {
    expect(() => withMediaRecord("a.gif", BARE_JPEG, { alt: "", tags: [] })).toThrow(
      "This format cannot hold alt text or tags.",
    );
  });
});
