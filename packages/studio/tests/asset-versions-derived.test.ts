/**
 * Content versions derived from the content store while a project state subscription is live
 * (`project-state.md` §11.1): the store's hash is the version, a forget withholds it until the
 * store reports the path again, and detaching falls back to the listings.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  assetVersionsEpoch,
  assetVersionsSnapshot,
  deriveVersionsFrom,
  derivedVersionsChanged,
  forgetVersions,
  localRevisionOf,
  noteListing,
  noteLocalWrite,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";
import type { VersionSource } from "../src/files/asset-versions";

/** A store stand-in: `hashes` by path, mutable. */
function sourceOf(hashes: Map<string, string>): VersionSource {
  return {
    documents: () => [...hashes].map(([path, hash]) => ({ hash, path })),
    hashAt: (path) => hashes.get(path),
  };
}

afterEach(() => {
  deriveVersionsFrom(null);
  resetAssetVersions();
});

describe("versions derived from the content store", () => {
  test("the store's hash is the version, over a listing's, and only while attached", () => {
    noteListing([{ name: "a.png", path: "img/a.png", type: "file", version: "listed" }], 0);
    noteListing([{ name: "b.png", path: "img/b.png", type: "file", version: "listed-b" }], 0);
    const hashes = new Map([
      ["img/a.png", "hash-a"],
      ["pages/x.json", "hash-x"],
    ]);
    const source = sourceOf(hashes);
    const epoch = assetVersionsEpoch.value;
    deriveVersionsFrom(source);
    expect(assetVersionsEpoch.value).toBe(epoch + 1);
    // Attaching the same store again changes nothing.
    deriveVersionsFrom(source);
    expect(assetVersionsEpoch.value).toBe(epoch + 1);
    expect(versionOf("img/a.png")).toBe("hash-a");
    expect(versionOf("img/b.png")).toBe("listed-b");
    expect(versionOf("pages/x.json")).toBe("hash-x");
    // The snapshot holds media only, the store's versions over the listings'.
    expect(assetVersionsSnapshot()).toEqual({ "img/a.png": "hash-a", "img/b.png": "listed-b" });

    deriveVersionsFrom(null);
    expect(versionOf("img/a.png")).toBe("listed");
  });

  test("a forget withholds the store's hash until the store reports the path again", () => {
    const hashes = new Map([
      ["img/a.png", "hash-a"],
      ["img/dir/c.png", "hash-c"],
      ["notes.md", "hash-n"],
    ]);
    const source = sourceOf(hashes);
    deriveVersionsFrom(source);
    const epoch = assetVersionsEpoch.value;
    forgetVersions(["img/a.png", "missing.png", ""], ["img/dir", ""]);
    expect(assetVersionsEpoch.value).toBe(epoch + 1);
    expect(versionOf("img/a.png")).toBeUndefined();
    expect(versionOf("img/dir/c.png")).toBeUndefined();
    expect(assetVersionsSnapshot()).toEqual({});
    // Forgetting a withheld path again, or a document that is not media, moves no epoch.
    const before = assetVersionsEpoch.value;
    forgetVersions(["img/a.png", "notes.md"]);
    expect(assetVersionsEpoch.value).toBe(before);
    expect(versionOf("notes.md")).toBeUndefined();

    // The echo: the store reports the path with its new hash.
    hashes.set("img/a.png", "hash-a2");
    derivedVersionsChanged(["img/a.png", "notes.md"]);
    expect(versionOf("img/a.png")).toBe("hash-a2");
    expect(versionOf("notes.md")).toBe("hash-n");
    expect(assetVersionsEpoch.value).toBe(before + 1);
    // A change to no media path reposts nothing.
    derivedVersionsChanged(["notes.md"]);
    expect(assetVersionsEpoch.value).toBe(before + 1);
  });

  test("the store vouching for new bytes drops Studio's repaint key; a path it no longer holds keeps it", () => {
    const hashes = new Map([["img/a.png", "hash-a"]]);
    deriveVersionsFrom(sourceOf(hashes));
    noteLocalWrite("img/a.png");
    noteLocalWrite("img/gone.png");
    derivedVersionsChanged(["img/a.png", "img/gone.png"]);
    expect(localRevisionOf("img/a.png")).toBeUndefined();
    expect(localRevisionOf("img/gone.png")).toBeDefined();
  });

  test("without a store, a reported change is ignored", () => {
    const epoch = assetVersionsEpoch.value;
    derivedVersionsChanged(["img/a.png"]);
    expect(assetVersionsEpoch.value).toBe(epoch);
  });
});
