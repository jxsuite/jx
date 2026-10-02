/**
 * Content versions — learned from listings, forgotten on change, and never restored by a listing
 * that began before the change.
 *
 * The version decides whether a browser may keep a file's bytes forever (`?v=` → immutable), so the
 * one failure that matters is a STALE version surviving. Most cases here are that failure from a
 * different direction: a write the event stream reported, a directory removed under the files, a
 * listing whose answer arrived after the forget it predates.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import {
  assetVersionsEpoch,
  assetVersionsSnapshot,
  beginListing,
  forgetAllVersions,
  forgetVersions,
  isVersionedMediaPath,
  notedListing,
  noteListing,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";
import type { DirEntry } from "../src/types";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function file(path: string, version?: string): DirEntry {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return version === undefined
    ? { name, path, type: "file" }
    : { name, path, type: "file", version };
}

beforeEach(() => {
  resetAssetVersions();
});

describe("noteListing", () => {
  test("a versioned file entry sets its version; a directory is ignored", () => {
    noteListing(
      [
        file("public/hero.jpg", SHA_A),
        { name: "img", path: "public/img", type: "directory", version: SHA_B },
      ],
      beginListing(),
    );
    expect(versionOf("public/hero.jpg")).toBe(SHA_A);
    expect(versionOf("public/img")).toBeUndefined();
  });

  test("an entry WITHOUT a version withdraws the one held — the backend stopped vouching", () => {
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    noteListing([file("public/hero.jpg")], beginListing());
    expect(versionOf("public/hero.jpg")).toBeUndefined();
    // An empty string is no version either.
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    noteListing([file("public/hero.jpg", "")], beginListing());
    expect(versionOf("public/hero.jpg")).toBeUndefined();
  });

  test("paths are keyed in their normalized spelling", () => {
    noteListing([file("./public/hero.jpg", SHA_A)], beginListing());
    expect(versionOf("public/hero.jpg")).toBe(SHA_A);
    expect(versionOf("/public/hero.jpg")).toBe(SHA_A);
  });

  test("an entry with an empty path is skipped", () => {
    noteListing([file("", SHA_A)], beginListing());
    expect(assetVersionsSnapshot()).toEqual({});
  });
});

describe("the race guard", () => {
  test("a listing begun before a forget cannot restore the forgotten version", () => {
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    // The listing is requested…
    const since = beginListing();
    // …the file is rewritten and its event forgets the version…
    forgetVersions(["public/hero.jpg"]);
    // …and the listing, answered from before the write, arrives last.
    noteListing([file("public/hero.jpg", SHA_A), file("public/logo.png", SHA_B)], since);
    expect(versionOf("public/hero.jpg")).toBeUndefined();
    // Paths the forget did not touch are still learned from the same listing.
    expect(versionOf("public/logo.png")).toBe(SHA_B);
    // The next listing, begun after the forget, decides.
    noteListing([file("public/hero.jpg", SHA_B)], beginListing());
    expect(versionOf("public/hero.jpg")).toBe(SHA_B);
  });

  test("a directory forget guards every path beneath it", () => {
    const since = beginListing();
    forgetVersions([], ["public/img"]);
    noteListing([file("public/img/a.png", SHA_A), file("public/img-other/b.png", SHA_B)], since);
    expect(versionOf("public/img/a.png")).toBeUndefined();
    // A sibling whose name merely STARTS with the directory's is not beneath it.
    expect(versionOf("public/img-other/b.png")).toBe(SHA_B);
  });

  test("a listing begun before a project reset is ignored entirely", () => {
    const since = beginListing();
    resetAssetVersions();
    noteListing([file("public/hero.jpg", SHA_A)], since);
    expect(versionOf("public/hero.jpg")).toBeUndefined();
  });

  test("notedListing begins before the read and notes its answer", async () => {
    let release: (entries: DirEntry[]) => void = () => {};
    const pending = notedListing(
      () =>
        new Promise<DirEntry[]>((resolve) => {
          release = resolve;
        }),
    );
    forgetVersions(["public/hero.jpg"]);
    release([file("public/hero.jpg", SHA_A), file("public/logo.png", SHA_B)]);
    const entries = await pending;
    expect(entries).toHaveLength(2);
    expect(versionOf("public/hero.jpg")).toBeUndefined();
    expect(versionOf("public/logo.png")).toBe(SHA_B);
  });

  test("notedListing passes a failed read through untouched", async () => {
    let caught: unknown = null;
    try {
      await notedListing(() => Promise.reject(new Error("gone")));
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe("gone");
  });
});

describe("forgetVersions", () => {
  test("forgets a path and every file under a prefix, and nothing else", () => {
    noteListing(
      [
        file("public/hero.jpg", SHA_A),
        file("public/img/a.png", SHA_A),
        file("public/img/deep/b.png", SHA_B),
        file("public/imgs.png", SHA_B),
      ],
      beginListing(),
    );
    forgetVersions(["public/hero.jpg", ""], ["public/img", ""]);
    expect(versionOf("public/hero.jpg")).toBeUndefined();
    expect(versionOf("public/img/a.png")).toBeUndefined();
    expect(versionOf("public/img/deep/b.png")).toBeUndefined();
    expect(versionOf("public/imgs.png")).toBe(SHA_B);
  });
});

/**
 * A gap in the event stream (a reconnect, or the stream's first open) loses the events that would
 * have forgotten single paths, so every version goes — including ones the file tree never listed —
 * and a listing in flight across the gap must not put one back.
 */
describe("forgetAllVersions", () => {
  test("forgets every version, wherever it was learned", () => {
    noteListing([file("public/img/hero.png", SHA_A), file("pages/a.json", SHA_B)], beginListing());
    const epoch = assetVersionsEpoch.value;
    forgetAllVersions();
    expect(versionOf("public/img/hero.png")).toBeUndefined();
    expect(versionOf("pages/a.json")).toBeUndefined();
    expect(assetVersionsSnapshot()).toEqual({});
    expect(assetVersionsEpoch.value).toBe(epoch + 1);
  });

  test("a listing begun before it is ignored, even with no forget recorded for its paths", () => {
    const stale = beginListing();
    forgetAllVersions();
    const fresh = beginListing();
    noteListing([file("public/hero.png", SHA_B)], fresh);
    // The pre-gap listing answers last, with the version the file had before the gap.
    noteListing([file("public/hero.png", SHA_A)], stale);
    expect(versionOf("public/hero.png")).toBe(SHA_B);
  });

  test("a listing begun after it vouches afresh", () => {
    noteListing([file("public/hero.png", SHA_A)], beginListing());
    forgetAllVersions();
    noteListing([file("public/hero.png", SHA_B)], beginListing());
    expect(versionOf("public/hero.png")).toBe(SHA_B);
  });

  test("with no media held, the epoch and the snapshot's identity stay put", () => {
    noteListing([file("pages/a.json", SHA_A)], beginListing());
    const before = assetVersionsSnapshot();
    const epoch = assetVersionsEpoch.value;
    forgetAllVersions();
    expect(versionOf("pages/a.json")).toBeUndefined();
    expect(assetVersionsEpoch.value).toBe(epoch);
    expect(assetVersionsSnapshot()).toBe(before);
  });
});

describe("assetVersionsSnapshot", () => {
  /* The canvas host compares identities, so a map that is empty before and after anything must be
     the SAME object — or a host that never versions anything pays a message for nothing. */
  test("every empty map is one shared object, across resets", () => {
    const empty = assetVersionsSnapshot();
    resetAssetVersions();
    expect(assetVersionsSnapshot()).toBe(empty);
    noteListing([file("public/a.png", SHA_A)], beginListing());
    forgetVersions(["public/a.png"]);
    expect(assetVersionsSnapshot()).toBe(empty);
    expect(Object.isFrozen(empty)).toBe(true);
  });

  test("carries media paths only — never a document or data file", () => {
    noteListing(
      [
        file("public/hero.jpg", SHA_A),
        file("public/icon.svg", SHA_A),
        file("public/fonts/body.woff2", SHA_A),
        file("public/clip.mp4", SHA_A),
        file("public/theme.mp3", SHA_A),
        file("pages/index.json", SHA_B),
        file("content/posts/hello.md", SHA_B),
      ],
      beginListing(),
    );
    expect(assetVersionsSnapshot()).toEqual({
      "public/clip.mp4": SHA_A,
      "public/fonts/body.woff2": SHA_A,
      "public/hero.jpg": SHA_A,
      "public/icon.svg": SHA_A,
      "public/theme.mp3": SHA_A,
    });
    // `versionOf` still answers for every file — `previewFileSrc` may ask about any of them.
    expect(versionOf("pages/index.json")).toBe(SHA_B);
  });

  test("keeps its identity until a media version changes", () => {
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    const first = assetVersionsSnapshot();
    expect(assetVersionsSnapshot()).toBe(first);
    // The same answer again, and a document's version moving, change nothing the canvas holds.
    noteListing([file("public/hero.jpg", SHA_A), file("pages/a.json", SHA_B)], beginListing());
    expect(assetVersionsSnapshot()).toBe(first);
    noteListing([file("public/hero.jpg", SHA_B)], beginListing());
    const second = assetVersionsSnapshot();
    expect(second).not.toBe(first);
    expect(second).toEqual({ "public/hero.jpg": SHA_B });
    expect(Object.isFrozen(second)).toBe(true);
  });
});

describe("assetVersionsEpoch", () => {
  test("moves on every media mutation and on nothing else", () => {
    const at = () => assetVersionsEpoch.value;
    const start = at();
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    expect(at()).toBe(start + 1);
    // Unchanged answer: no move.
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    expect(at()).toBe(start + 1);
    // A non-media version: no move.
    noteListing([file("pages/index.json", SHA_A)], beginListing());
    forgetVersions(["pages/index.json"]);
    expect(at()).toBe(start + 1);
    // A media version replaced, withdrawn, re-learned and forgotten: one move each.
    noteListing([file("public/hero.jpg", SHA_B)], beginListing());
    expect(at()).toBe(start + 2);
    noteListing([file("public/hero.jpg")], beginListing());
    expect(at()).toBe(start + 3);
    // Withdrawing what is not held moves nothing.
    noteListing([file("public/hero.jpg")], beginListing());
    expect(at()).toBe(start + 3);
    noteListing([file("public/img/a.png", SHA_A)], beginListing());
    expect(at()).toBe(start + 4);
    forgetVersions([], ["public/img"]);
    expect(at()).toBe(start + 5);
    // Forgetting what is not held moves nothing.
    forgetVersions(["public/hero.jpg"], ["public/img"]);
    expect(at()).toBe(start + 5);
  });

  test("a reset moves it only when there was media to drop", () => {
    const start = assetVersionsEpoch.value;
    resetAssetVersions();
    expect(assetVersionsEpoch.value).toBe(start);
    noteListing([file("public/hero.jpg", SHA_A)], beginListing());
    resetAssetVersions();
    expect(assetVersionsEpoch.value).toBe(start + 2);
    expect(assetVersionsSnapshot()).toEqual({});
  });
});

describe("isVersionedMediaPath", () => {
  test("matches by extension, case-insensitively, and never a bare dotfile", () => {
    expect(isVersionedMediaPath("public/HERO.JPG")).toBe(true);
    expect(isVersionedMediaPath("public/font.ttf")).toBe(true);
    expect(isVersionedMediaPath("public/data.json")).toBe(false);
    expect(isVersionedMediaPath("public/.png")).toBe(false);
    expect(isVersionedMediaPath("public.d/README")).toBe(false);
  });
});
