/**
 * Media metadata, and the difference between a zero and a shrug.
 *
 * The assertions worth reading are the ones about NOT knowing: a directory that cannot be listed
 * yields `bytes: null`, and a file nobody has rendered yields `width: null`. Neither is allowed to
 * become `0`, because `0 B` and `0 × 0` read like measurements.
 */

import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { installMockPlatform } from "./harness";
import {
  formatBytes,
  invalidateMediaMeta,
  loadMediaMeta,
  mediaMetaSettled,
  mediaMetaSummary,
  peekMediaMeta,
  recordImageSize,
  seedMediaMeta,
  svgIntrinsicSize,
} from "../src/files/media-meta";
import type { DirEntry } from "../src/types";

function file(path: string, over: Partial<DirEntry> = {}): DirEntry {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    type: "file",
    ...over,
  };
}

/**
 * A platform whose `listDirectory` answers with `entries` and records the directories it was asked
 * about.
 */
function listing(entries: DirEntry[]) {
  const dirs: string[] = [];
  installMockPlatform({
    listDirectory: async (dir: string) => {
      dirs.push(dir);
      return entries;
    },
  });
  return { dirs };
}

beforeEach(() => {
  invalidateMediaMeta();
  installMockPlatform();
});

describe("seedMediaMeta", () => {
  test("folds a listing in without a round trip", () => {
    seedMediaMeta([file("public/hero.jpg", { modified: "2026-01-02T03:04:05Z", size: 2048 })]);
    const meta = peekMediaMeta("public/hero.jpg");
    expect(meta).toMatchObject({
      bytes: 2048,
      ext: ".jpg",
      height: null,
      kind: "image",
      modified: "2026-01-02T03:04:05Z",
      name: "hero.jpg",
      path: "public/hero.jpg",
      width: null,
    });
  });

  test("skips directories", () => {
    seedMediaMeta([{ name: "images", path: "public/images", type: "directory" }]);
    expect(peekMediaMeta("public/images")).toBeNull();
  });

  test("a second listing does not overwrite the first", () => {
    seedMediaMeta([file("public/hero.jpg", { size: 2048 })]);
    seedMediaMeta([file("public/hero.jpg", { size: 4096 })]);
    expect(peekMediaMeta("public/hero.jpg")?.bytes).toBe(2048);
  });

  test("a size the listing omitted is unknown, not zero", () => {
    seedMediaMeta([file("public/hero.jpg")]);
    expect(peekMediaMeta("public/hero.jpg")?.bytes).toBeNull();
  });
});

describe("loadMediaMeta", () => {
  test("lists the containing directory and caches the answer", async () => {
    const listed = listing([file("public/hero.jpg", { size: 1024 })]);
    const meta = await loadMediaMeta("public/hero.jpg");
    expect(meta.bytes).toBe(1024);
    await loadMediaMeta("public/hero.jpg");
    expect(listed.dirs).toEqual(["public"]);
  });

  test("two concurrent asks are one round trip", async () => {
    const listed = listing([file("public/hero.jpg", { size: 1024 })]);
    const [a, b] = await Promise.all([
      loadMediaMeta("public/hero.jpg"),
      loadMediaMeta("public/hero.jpg"),
    ]);
    expect(a).toBe(b);
    expect(listed.dirs).toEqual(["public"]);
  });

  test("a root-level file is looked up in the project root", async () => {
    const listed = listing([file("favicon.ico", { size: 99 })]);
    const meta = await loadMediaMeta("favicon.ico");
    expect(meta.bytes).toBe(99);
    expect(listed.dirs).toEqual(["."]);
  });

  test("an unreadable directory yields unknown, never zero", async () => {
    installMockPlatform({
      listDirectory: async () => {
        throw new Error("ENOENT");
      },
    });
    const meta = await loadMediaMeta("public/hero.jpg");
    expect(meta.bytes).toBeNull();
    expect(meta.modified).toBeNull();
    expect(meta.name).toBe("hero.jpg");
  });

  test("a file missing from the listing is still described", async () => {
    installMockPlatform({ listDirectory: async () => [file("public/other.jpg", { size: 5 })] });
    const meta = await loadMediaMeta("public/hero.jpg");
    expect(meta.bytes).toBeNull();
  });

  test("a seeded record short-circuits the listing", async () => {
    const listed = listing([file("public/hero.jpg", { size: 999 })]);
    seedMediaMeta([file("public/hero.jpg", { size: 7 })]);
    const meta = await loadMediaMeta("public/hero.jpg");
    expect(meta.bytes).toBe(7);
    expect(listed.dirs).toEqual([]);
  });
});

describe("recordImageSize", () => {
  test("a measurement is news once", () => {
    seedMediaMeta([file("public/hero.jpg", { size: 1024 })]);
    const first = recordImageSize("public/hero.jpg", 1200, 800);
    const repeated = recordImageSize("public/hero.jpg", 1200, 800);
    expect(first).toBe(true);
    expect(repeated).toBe(false);
    expect(peekMediaMeta("public/hero.jpg")).toMatchObject({ height: 800, width: 1200 });
  });

  test("a broken image reports zero and is not a measurement", () => {
    seedMediaMeta([file("public/hero.jpg")]);
    expect(recordImageSize("public/hero.jpg", 0, 0)).toBe(false);
    expect(peekMediaMeta("public/hero.jpg")?.width).toBeNull();
  });

  test("a measurement taken before the listing survives it", async () => {
    installMockPlatform({ listDirectory: async () => [file("public/hero.jpg", { size: 1024 })] });
    expect(recordImageSize("public/hero.jpg", 640, 480)).toBe(true);
    const meta = await loadMediaMeta("public/hero.jpg");
    expect(meta).toMatchObject({
      bytes: 1024,
      height: 480,
      width: 640,
    });
  });

  test("a replaced file's new size wins", () => {
    seedMediaMeta([file("public/hero.jpg")]);
    recordImageSize("public/hero.jpg", 100, 100);
    expect(recordImageSize("public/hero.jpg", 200, 100)).toBe(true);
    expect(peekMediaMeta("public/hero.jpg")?.width).toBe(200);
  });
});

describe("invalidateMediaMeta", () => {
  test("drops records and measurements together", () => {
    seedMediaMeta([file("public/hero.jpg", { size: 1024 })]);
    recordImageSize("public/hero.jpg", 100, 100);
    invalidateMediaMeta();
    expect(peekMediaMeta("public/hero.jpg")).toBeNull();
    seedMediaMeta([file("public/hero.jpg", { size: 1024 })]);
    expect(peekMediaMeta("public/hero.jpg")?.width).toBeNull();
  });
});

describe("formatBytes / mediaMetaSummary", () => {
  test("scales the unit to the number", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(903)).toBe("903 B");
    expect(formatBytes(86_016)).toBe("84 KB");
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
  });

  test("omits what is unknown rather than printing a placeholder", () => {
    seedMediaMeta([file("public/hero.jpg", { size: 86_016 })]);
    expect(mediaMetaSummary(peekMediaMeta("public/hero.jpg"))).toBe("84 KB");
    recordImageSize("public/hero.jpg", 1200, 800);
    expect(mediaMetaSummary(peekMediaMeta("public/hero.jpg"))).toBe("1200 × 800 · 84 KB");
  });

  test("says nothing when nothing is known", () => {
    seedMediaMeta([file("public/hero.jpg")]);
    expect(mediaMetaSummary(peekMediaMeta("public/hero.jpg"))).toBe("");
    expect(mediaMetaSummary(null)).toBe("");
  });
});

describe("an SVG's own size", () => {
  const svg = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`;

  test("is width and height, else the viewBox, else one length and the viewBox's ratio", () => {
    expect(svgIntrinsicSize(svg('width="32" height="24px" viewBox="0 0 64 64"'))).toEqual({
      height: 24,
      width: 32,
    });
    expect(svgIntrinsicSize(svg('viewBox="0 0 64 64"'))).toEqual({ height: 64, width: 64 });
    expect(svgIntrinsicSize(svg('viewBox="0,0,120,40"'))).toEqual({ height: 40, width: 120 });
    expect(svgIntrinsicSize(svg('width="60" viewBox="0 0 120 40"'))).toEqual({
      height: 20,
      width: 60,
    });
    expect(svgIntrinsicSize(svg('height="10" viewBox="0 0 120 40"'))).toEqual({
      height: 10,
      width: 30,
    });
  });

  test("is unknown when the file declares none, or only sizes relative to its host", () => {
    expect(svgIntrinsicSize(svg(""))).toBeNull();
    expect(svgIntrinsicSize(svg('width="100%" height="50%"'))).toBeNull();
    expect(svgIntrinsicSize(svg('width="2em" viewBox="0 0 0 10"'))).toBeNull();
    expect(svgIntrinsicSize("<html></html>")).toBeNull();
  });

  test("an <img> decode is not its size, the file is, read once", async () => {
    let reads = 0;
    installMockPlatform({
      listDirectory: async () => [file("public/favicon.svg", { size: 300 })],
      readFile: async () => {
        reads += 1;
        return svg('viewBox="0 0 64 64"');
      },
    });
    seedMediaMeta([file("public/favicon.svg", { size: 300 })]);
    // Chromium's default object size for a sizeless vector, which says nothing about the file.
    expect(recordImageSize("public/favicon.svg", 150, 150)).toBe(false);
    expect(mediaMetaSettled("public/favicon.svg")).toBe(false);
    const meta = await loadMediaMeta("public/favicon.svg");
    expect(mediaMetaSummary(meta)).toBe("64 × 64 · 300 B");
    expect(mediaMetaSummary(peekMediaMeta("public/favicon.svg"))).toBe("64 × 64 · 300 B");
    expect(mediaMetaSettled("public/favicon.svg")).toBe(true);
    await loadMediaMeta("public/favicon.svg");
    expect(reads).toBe(1);
  });

  test("an unreadable SVG is settled without dimensions", async () => {
    installMockPlatform({
      listDirectory: async () => [file("public/a.svg", { size: 10 })],
      readFile: () => Promise.reject(new Error("gone")),
    });
    const meta = await loadMediaMeta("public/a.svg");
    expect(meta.width).toBeNull();
    expect(mediaMetaSettled("public/a.svg")).toBe(true);
  });
});
