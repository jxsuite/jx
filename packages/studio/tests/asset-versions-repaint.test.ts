/**
 * The repaint key (studio.md §3.4) — `noteLocalWrite` in `src/files/asset-versions.ts`, and the two
 * asset-URL builders that carry it: `previewFileSrc` (`files/media-paths.ts`) and `resolveAssetRef`
 * (`canvas/asset-resolve.ts`, reached through `canvas/asset-refs.ts`).
 *
 * A host that vouches no version (`jx dev`, desktop) gave an in-place overwrite a byte-identical
 * URL, so every image already decoded kept the old pixels. The key is a second, separate channel,
 * spelt `r` and never `v`: §3.4 binds `v` to a version the HOST issued and may answer immutably.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BUILD_LANES } from "@jxsuite/schema/asset-paths";
import {
  assetVersionsEpoch,
  beginListing,
  forgetVersions,
  hasLocalRevisions,
  localRevisionOf,
  localRevisionsSnapshot,
  noteListing,
  noteLocalWrite,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";
import { previewFileSrc } from "../src/files/media-paths";
import { assetContextFor, previewAssetSrcFor } from "../src/canvas/asset-refs";
import { resolveAssetRef, withRevision, withVersion } from "../src/canvas/asset-resolve";
import type { AssetContext } from "../src/canvas/asset-resolve";

/* SAFETY: the harness registers happy-dom's GlobalRegistrator, which puts `happyDOM` (the
   DetachedWindowAPI that owns setURL) on globalThis. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};

/** The project-file base this suite's repo-space host declares. */
const FILES_BASE = "https://studio.example.com/p/o/r/edit/raw/";

function repo(): void {
  happyDOM.setURL("https://studio.example.com/");
  installMockPlatform({
    assetSpace: "repo",
    canvasUrl: "https://studio.example.com/canvas.html",
    documentBaseUrl: FILES_BASE,
  });
}

beforeEach(() => {
  resetStudioState({ projectConfig: { name: "Demo" }, projectRoot: "/demo" });
  installMockPlatform();
  resetAssetVersions();
});

afterEach(() => {
  resetAssetVersions();
  happyDOM.setURL("http://localhost:3000/");
});

describe("noteLocalWrite", () => {
  test("mints a key per write, moves the canvas epoch, and is absent for a path Studio never wrote", () => {
    const epoch = assetVersionsEpoch.value;
    expect(localRevisionOf("public/hero.png")).toBeUndefined();
    expect(hasLocalRevisions()).toBe(false);
    const first = noteLocalWrite("./public/hero.png");
    expect(first).toBeString();
    expect(localRevisionOf("public/hero.png")).toBe(first!);
    const second = noteLocalWrite("public/hero.png");
    expect(second).not.toBe(first);
    expect(assetVersionsEpoch.value).toBe(epoch + 2);
    expect(localRevisionOf("public/other.png")).toBeUndefined();
    // A non-media path keeps a key but does not repost the canvas.
    noteLocalWrite("notes.md");
    expect(assetVersionsEpoch.value).toBe(epoch + 2);
    expect(noteLocalWrite("")).toBeUndefined();
  });

  test("the snapshot is memoized until a key moves", () => {
    expect(localRevisionsSnapshot()).toEqual({});
    const token = noteLocalWrite("public/hero.png")!;
    const snapshot = localRevisionsSnapshot();
    expect(snapshot).toEqual({ "public/hero.png": token });
    expect(localRevisionsSnapshot()).toBe(snapshot);
  });

  test("a version a listing vouches supersedes the key, which then names the same bytes", () => {
    noteLocalWrite("public/hero.png");
    noteListing(
      [{ name: "hero.png", path: "public/hero.png", type: "file", version: "sha1" }],
      beginListing(),
    );
    expect(versionOf("public/hero.png")).toBe("sha1");
    expect(localRevisionOf("public/hero.png")).toBeUndefined();
  });

  test("forgetting a path mints its key again, because old pixels are cached behind the old one", () => {
    const first = noteLocalWrite("public/media/hero.png")!;
    const epoch = assetVersionsEpoch.value;
    // A source-control discard reaches here through the file-event stream.
    forgetVersions(["public/media/hero.png"]);
    const second = localRevisionOf("public/media/hero.png");
    expect(second).not.toBe(first);
    expect(assetVersionsEpoch.value).toBe(epoch + 1);
    forgetVersions([], ["public/media"]);
    expect(localRevisionOf("public/media/hero.png")).not.toBe(second);
    // A path holding no key is not given one, and a non-media key does not repost the canvas.
    forgetVersions(["public/other.png"]);
    expect(localRevisionOf("public/other.png")).toBeUndefined();
    noteLocalWrite("notes.md");
    const after = assetVersionsEpoch.value;
    forgetVersions(["notes.md"]);
    expect(assetVersionsEpoch.value).toBe(after);
  });

  test("a project switch forgets every key", () => {
    noteLocalWrite("public/hero.png");
    resetAssetVersions();
    expect(hasLocalRevisions()).toBe(false);
    expect(localRevisionsSnapshot()).toEqual({});
  });
});

describe("previewFileSrc carries the key in BOTH branches", () => {
  test("site space, which carries no version at all and needed it most", () => {
    expect(previewFileSrc("public/hero.png")).toBe("/hero.png");
    const token = noteLocalWrite("public/hero.png")!;
    expect(previewFileSrc("public/hero.png")).toBe(`/hero.png?r=${encodeURIComponent(token)}`);
  });

  test("repo space, beside the host's own version and never as it", async () => {
    repo();
    const token = noteLocalWrite("public/hero.png")!;
    const src = previewFileSrc("public/hero.png");
    expect(src).toBe(`${FILES_BASE}public/hero.png?r=${token}`);
    expect(src).not.toContain("v=");
    await flush();
  });
});

describe("resolveAssetRef carries the key in BOTH branches", () => {
  const site = (revisions?: Record<string, string>): AssetContext => ({
    documentDir: "pages",
    lanes: BUILD_LANES,
    mounts: [],
    revisions,
    space: "site",
  });

  test("site space: the reference as written, keyed, only for a path Studio wrote", () => {
    expect(resolveAssetRef("/hero.png", site({ "public/hero.png": "k1" }))).toBe("/hero.png?r=k1");
    expect(resolveAssetRef("/other.png", site({ "public/hero.png": "k1" }))).toBeNull();
    expect(resolveAssetRef("https://cdn.example.com/x.png", site({ "x.png": "k" }))).toBeNull();
    expect(resolveAssetRef("/hero.png", site({}))).toBeNull();
    expect(resolveAssetRef("/hero.png", site())).toBeNull();
  });

  test("site space with a mount: the mounted URL, keyed", () => {
    const mounted: AssetContext = {
      ...site({ "posts/images/a.png": "k2" }),
      documentDir: "posts",
      mounts: [{ dir: "posts", urlPrefix: "/content/blog" }],
    };
    expect(resolveAssetRef("./images/a.png", mounted)).toBe("/content/blog/images/a.png?r=k2");
  });

  test("repo space: beside the version, under its own name", () => {
    const ctx: AssetContext = {
      documentDir: "pages",
      fileBaseUrl: FILES_BASE,
      lanes: BUILD_LANES,
      mounts: [],
      revisions: { "public/hero.png": "k3" },
      space: "repo",
      versions: { "public/hero.png": "sha" },
    };
    expect(resolveAssetRef("/hero.png", ctx)).toBe(`${FILES_BASE}public/hero.png?v=sha&r=k3`);
  });

  test("the panel-chrome resolver asks for a context once Studio holds a key", () => {
    expect(assetContextFor("pages/index.json")).toBeNull();
    const token = noteLocalWrite("public/hero.png")!;
    expect(assetContextFor("pages/index.json")).not.toBeNull();
    expect(previewAssetSrcFor("/hero.png", "pages/index.json")).toEndWith(`/hero.png?r=${token}`);
  });
});

describe("withRevision", () => {
  test("is spelt r, replaces an authored r, and leaves v and the fragment alone", () => {
    expect(withRevision("/a.png?v=1&r=old#x", "new")).toBe("/a.png?v=1&r=new#x");
    expect(withRevision("/a.png?%72=old", "new")).toBe("/a.png?r=new");
    expect(withRevision("/a.png")).toBe("/a.png");
    // The two channels never stand in for each other.
    expect(withVersion("/a.png?r=k", "sha")).toBe("/a.png?r=k&v=sha");
  });
});
