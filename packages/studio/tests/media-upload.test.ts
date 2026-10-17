/**
 * Media-upload core: file classification, destination resolution, collision-free naming, and the
 * uploadAssets orchestration every upload surface funnels through.
 *
 * The pure helpers carry most of the coverage; uploadAssets is exercised against the harness's
 * in-memory platform, asserting the ordered `state.calls` log (the only place the destination path
 * and the payload identity are both observable).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { installMockPlatform, resetStudioState, resetWorkspaceWithTab, testFile } from "./harness";
import {
  DEFAULT_MEDIA_DIR,
  announceMediaChanged,
  assetRef,
  extensionOf,
  mediaFileKind,
  canReplaceWith,
  replaceAccept,
  replaceAsset,
  isImage,
  isMediaFile,
  joinDir,
  mediaKind,
  setMediaChangedHandler,
  uniqueName,
  uploadAccept,
  uploadAssets,
  uploadDirFor,
} from "../src/files/media-upload";
import { closeAllTabs } from "../src/workspace/workspace";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import {
  beginListing,
  noteListing,
  resetAssetVersions,
  versionOf,
} from "../src/files/asset-versions";

beforeEach(() => {
  resetStudioState();
  closeAllTabs();
  setMediaChangedHandler(null);
});

afterEach(() => {
  setMediaChangedHandler(null);
});

// ─── Classification ──────────────────────────────────────────────────────────

describe("extensionOf", () => {
  test("lowercases, keeps the dot, and ignores dotfiles and extensionless names", () => {
    expect(extensionOf("hero.PNG")).toBe(".png");
    expect(extensionOf("a.tar.gz")).toBe(".gz");
    expect(extensionOf("README")).toBe("");
    // A leading dot is index 0, not > 0 — ".gitignore" is a name, not an extension.
    expect(extensionOf(".gitignore")).toBe("");
  });
});

describe("isImage / isMediaFile", () => {
  test("isImage accepts an extension with or without the dot, case-insensitively", () => {
    expect(isImage(".png")).toBe(true);
    expect(isImage("PNG")).toBe(true);
    expect(isImage(".avif")).toBe(true);
    expect(isImage(".mp4")).toBe(false);
  });

  test("isMediaFile spans images, playable media, documents, and fonts", () => {
    expect(isMediaFile("a.png")).toBe(true);
    expect(isMediaFile("a.mp4")).toBe(true);
    expect(isMediaFile("a.pdf")).toBe(true);
    expect(isMediaFile("a.woff2")).toBe(true);
    expect(isMediaFile("a.ts")).toBe(false);
  });

  test("every extension mediaKind calls video or audio is media, so the listing shows it", () => {
    for (const name of ["a.mov", "a.m4v", "a.m4a", "a.flac"]) {
      expect(mediaKind({ name })).not.toBe("file");
      expect(isMediaFile(name)).toBe(true);
    }
  });
});

describe("mediaKind", () => {
  test("prefers the MIME type", () => {
    expect(mediaKind({ name: "no-extension", type: "image/webp" })).toBe("image");
    expect(mediaKind({ name: "no-extension", type: "video/mp4" })).toBe("video");
    expect(mediaKind({ name: "no-extension", type: "audio/ogg" })).toBe("audio");
  });

  test("falls back to the extension when the MIME type is missing", () => {
    // Some Linux file managers hand over a drop with an empty `type`.
    expect(mediaKind({ name: "a.PNG" })).toBe("image");
    expect(mediaKind({ name: "a.mov", type: "" })).toBe("video");
    expect(mediaKind({ name: "a.flac", type: "" })).toBe("audio");
  });

  test("anything unrecognized is a plain file", () => {
    expect(mediaKind({ name: "spec.pdf", type: "application/pdf" })).toBe("file");
    expect(mediaKind({ name: "font.woff2" })).toBe("file");
  });
});

// ─── Destination ─────────────────────────────────────────────────────────────

describe("uploadDirFor", () => {
  test("a content-collection document co-locates its media", () => {
    expect(uploadDirFor("content/blog/hello.md")).toBe("content/blog/images");
    expect(uploadDirFor("content/blog/nested/hello.md")).toBe("content/blog/images");
    expect(uploadDirFor(String.raw`content\blog\hello.md`)).toBe("content/blog/images");
  });

  test("everything else — including a bare content/ file and no document — goes to public/media", () => {
    expect(uploadDirFor("pages/index.json")).toBe("public/media");
    expect(uploadDirFor("content/orphan.md")).toBe("public/media");
    expect(uploadDirFor(null)).toBe("public/media");
    expect(DEFAULT_MEDIA_DIR).toBe("public/media");
  });
});

describe("assetRef", () => {
  test("public/ is served from the site root", () => {
    expect(assetRef("public/hero.jpg")).toBe("/hero.jpg");
    expect(assetRef("public/img/hero.jpg")).toBe("/img/hero.jpg");
  });

  test("a content asset is referenced relative to the entry that owns it", () => {
    expect(assetRef("content/blog/images/hero.jpg")).toBe("./images/hero.jpg");
  });

  test("anything else is project-root relative", () => {
    expect(assetRef("assets/hero.jpg")).toBe("./assets/hero.jpg");
    expect(assetRef("hero.jpg")).toBe("./hero.jpg");
  });
});

describe("uniqueName", () => {
  test("passes an unused name through", () => {
    expect(uniqueName("hero.jpg", new Set())).toBe("hero.jpg");
  });

  test("suffixes before the extension and skips taken suffixes", () => {
    expect(uniqueName("hero.jpg", new Set(["hero.jpg"]))).toBe("hero-1.jpg");
    expect(uniqueName("hero.jpg", new Set(["hero.jpg", "hero-1.jpg"]))).toBe("hero-2.jpg");
  });

  test("an extensionless name suffixes at the end", () => {
    expect(uniqueName("LICENSE", new Set(["LICENSE"]))).toBe("LICENSE-1");
  });
});

describe("joinDir", () => {
  test("the project root contributes no prefix", () => {
    expect(joinDir(".", "a.png")).toBe("a.png");
    expect(joinDir("", "a.png")).toBe("a.png");
  });

  test("trailing slashes and backslashes normalize", () => {
    expect(joinDir("public/", "a.png")).toBe("public/a.png");
    expect(joinDir(String.raw`public\img`, "a.png")).toBe("public/img/a.png");
  });
});

// ─── uploadAssets ────────────────────────────────────────────────────────────

describe("uploadAssets", () => {
  test("an empty batch never touches the platform", async () => {
    const { state } = installMockPlatform();
    expect(await uploadAssets([])).toEqual([]);
    expect(state.calls).toEqual([]);
  });

  test("`only` uploads just what the listing will show, and names what it skipped", async () => {
    resetNotifications();
    const { state } = installMockPlatform();
    const media = await uploadAssets([testFile("clip.mov"), testFile("notes.txt")], {
      only: "media",
    });
    expect(media.map((asset) => asset.path)).toEqual(["public/media/clip.mov"]);
    const images = await uploadAssets([testFile("a.png"), testFile("b.heic"), testFile("c.pdf")], {
      only: "image",
    });
    expect(images.map((asset) => asset.path)).toEqual(["public/media/a.png"]);
    expect(state.calls.filter(([call]) => call === "uploadFile")).toHaveLength(2);
    const said = toasts.map((toast) => toast.message);
    expect(said).toContain("Skipped notes.txt");
    expect(said).toContain("Skipped 2 files");
    // Nothing left to upload: nothing is asked of the platform at all.
    expect(await uploadAssets([testFile("x.txt")], { only: "image" })).toEqual([]);
  });

  test("uploads to public/media/ and reports the site-root ref", async () => {
    const { state } = installMockPlatform();
    const file = testFile("hero.png");

    const assets = await uploadAssets([file]);

    expect(assets).toEqual([
      { kind: "image", name: "hero.png", path: "public/media/hero.png", ref: "/media/hero.png" },
    ]);
    expect(state.calls).toContainEqual(["uploadFile", "public/media/hero.png", file]);
  });

  test("follows the active content document to its collection images directory", async () => {
    const { state } = installMockPlatform();
    resetWorkspaceWithTab(undefined, { documentPath: "content/blog/post.md" });

    const [asset] = await uploadAssets([testFile("hero.png")]);

    expect(asset?.path).toBe("content/blog/images/hero.png");
    expect(asset?.ref).toBe("./images/hero.png");
    expect(state.calls).toContainEqual([
      "uploadFile",
      "content/blog/images/hero.png",
      expect.anything(),
    ]);
  });

  test("an explicit dir overrides the active document", async () => {
    installMockPlatform();
    resetWorkspaceWithTab(undefined, { documentPath: "content/blog/post.md" });

    const [asset] = await uploadAssets([testFile("hero.png")], { dir: "styles" });

    expect(asset?.path).toBe("styles/hero.png");
  });

  test("never overwrites: colliding names get a suffix, within the batch too", async () => {
    installMockPlatform({}, { "public/media/hero.png": "existing" });

    const assets = await uploadAssets([testFile("hero.png"), testFile("hero.png")]);

    expect(assets.map((a) => a.path)).toEqual([
      "public/media/hero-1.png",
      "public/media/hero-2.png",
    ]);
  });

  test("an unlistable destination is treated as empty rather than failing", async () => {
    const { state } = installMockPlatform({
      listDirectory: () => Promise.reject(new Error("ENOENT")),
    });

    const assets = await uploadAssets([testFile("hero.png")]);

    expect(assets.map((a) => a.path)).toEqual(["public/media/hero.png"]);
    expect(state.calls).toContainEqual(["uploadFile", "public/media/hero.png", expect.anything()]);
  });

  /* A store may report a path that already existed (one that de-duplicates by content, say). Its
     version named the bytes before the upload, so it goes. */
  test("forgets the content version of the path the backend reports writing", async () => {
    resetAssetVersions();
    noteListing(
      [{ name: "shared.png", path: "public/shared.png", type: "file", version: "old" }],
      beginListing(),
    );
    installMockPlatform({ uploadFile: () => Promise.resolve({ path: "public/shared.png" }) });
    await uploadAssets([testFile("hero.png")]);
    expect(versionOf("public/shared.png")).toBeUndefined();
    resetAssetVersions();
  });

  test("the destination listing it reads for taken names notes their versions", async () => {
    resetAssetVersions();
    installMockPlatform({
      listDirectory: () =>
        Promise.resolve([
          { name: "logo.svg", path: "public/logo.svg", type: "file" as const, version: "b10b" },
        ]),
    });
    await uploadAssets([testFile("hero.png")]);
    expect(versionOf("public/logo.svg")).toBe("b10b");
    resetAssetVersions();
  });

  test("one failed upload does not abandon the rest of the batch", async () => {
    let seen = 0;
    installMockPlatform({
      uploadFile: (path: string) => {
        seen += 1;
        return seen === 1 ? Promise.reject(new Error("disk full")) : Promise.resolve({ path });
      },
    });

    const assets = await uploadAssets([testFile("a.png"), testFile("b.png")]);

    expect(assets.map((a) => a.name)).toEqual(["b.png"]);
  });

  test("the media-changed handler runs once per batch, with the destination", async () => {
    installMockPlatform();
    const changed = mock(() => {});
    setMediaChangedHandler(changed);

    await uploadAssets([testFile("a.png"), testFile("b.png")]);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith("public/media");
  });

  test("a wholly failed batch skips the media-changed handler", async () => {
    installMockPlatform({ uploadFile: () => Promise.reject(new Error("nope")) });
    const changed = mock(() => {});
    setMediaChangedHandler(changed);

    expect(await uploadAssets([testFile("a.png")])).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });
});

/**
 * What the backend ANSWERS, and what it will accept.
 *
 * The upload response used to be `Promise<unknown>` and every caller used the path it had ASKED
 * for. A backend that stores the bytes anywhere else — de-duplicating by content hash, appending a
 * collision suffix, normalizing a name — therefore produced a document referencing a file that is
 * not there, with no error anywhere.
 */
describe("the backend's answer", () => {
  test("a renaming store is honoured end to end", async () => {
    installMockPlatform({
      // A content-addressed store: the name asked for is not the name written.
      uploadFile: () =>
        Promise.resolve({ path: joinDir("public", "sha256-deadbeef.png"), size: 12 }),
    });

    const [asset] = await uploadAssets([testFile("hero.png")]);

    expect(asset?.path).toBe("public/sha256-deadbeef.png");
    // And the reference written into the document names the file that exists.
    expect(asset?.ref).toBe("/sha256-deadbeef.png");
  });

  test("a backend that reports nothing keeps the requested path", async () => {
    installMockPlatform({ uploadFile: (path: string) => Promise.resolve({ path }) });
    const [asset] = await uploadAssets([testFile("hero.png")]);
    expect(asset?.path).toBe("public/media/hero.png");
  });
});

describe("assetCapabilities", () => {
  /* A DECLARED limit only. Studio must not invent one — a limit it made up is a file the user
     cannot upload for no reason anyone can name. */
  test("with no declared limit, size is never checked", async () => {
    const { state } = installMockPlatform();
    const big = testFile("huge.png");
    Object.defineProperty(big, "size", { value: 999_999_999 });
    const assets = await uploadAssets([big]);
    expect(assets).toHaveLength(1);
    expect(state.calls).toContainEqual(["uploadFile", "public/media/huge.png", big]);
  });

  test("an oversized file is refused before the round trip, naming the limit", async () => {
    const { state } = installMockPlatform({
      assetCapabilities: { maxUploadBytes: 1024 },
    });
    const big = testFile("huge.png");
    Object.defineProperty(big, "size", { value: 4096 });

    expect(await uploadAssets([big])).toEqual([]);
    // Never sent: the point of a declared limit is that the client does not spend the request.
    expect(state.calls.filter(([call]) => call === "uploadFile")).toEqual([]);
  });

  test("the rest of the batch still lands", async () => {
    installMockPlatform({ assetCapabilities: { maxUploadBytes: 1024 } });
    const big = testFile("huge.png");
    Object.defineProperty(big, "size", { value: 4096 });

    const assets = await uploadAssets([big, testFile("small.png")]);

    expect(assets.map((a) => a.name)).toEqual(["small.png"]);
  });

  test("a declared accept narrows the picker; absent, Studio's own default stands", () => {
    installMockPlatform();
    expect(uploadAccept()).toContain("image/*");
    installMockPlatform({ assetCapabilities: { accept: "image/png" } });
    expect(uploadAccept()).toBe("image/png");
  });
});

describe("mediaFileKind", () => {
  test("names the five kinds the Media workspace filters by", () => {
    expect(mediaFileKind("hero.JPG")).toBe("image");
    expect(mediaFileKind("clip.webm")).toBe("video");
    expect(mediaFileKind("song.mp3")).toBe("audio");
    // A font first: as an element it is only an `<a href>`, but it is not a document.
    expect(mediaFileKind("Inter.woff2")).toBe("font");
    expect(mediaFileKind("menu.pdf")).toBe("document");
  });
});

describe("announceMediaChanged", () => {
  test("runs the injected handler with the directory, and is inert without one", async () => {
    await announceMediaChanged("public/media");
    const changed = mock(() => {});
    setMediaChangedHandler(changed);
    await announceMediaChanged("public/media");
    expect(changed).toHaveBeenCalledWith("public/media");
  });
});

/**
 * Replace: the one door that writes over an existing file (studio.md §9.3). The path does not
 * change, so every reference keeps resolving and shows the new bytes, and nothing about the path
 * tells a cache it did, so the version goes and the change is announced.
 */
describe("replaceAsset", () => {
  beforeEach(() => {
    resetNotifications();
    resetAssetVersions();
  });

  test("writes to the SAME path, forgets its version and announces the change", async () => {
    noteListing(
      [{ name: "hero.jpg", path: "public/media/hero.jpg", type: "file", version: "v1" }],
      beginListing(),
    );
    const { state } = installMockPlatform();
    const changed = mock(() => {});
    setMediaChangedHandler(changed);
    // `.jpeg` names the same format as `.jpg`, so it may stand in for it.
    const file = testFile("other-name.jpeg");

    expect(await replaceAsset("public/media/hero.jpg", file)).toBe(true);

    // The chosen file's own name is irrelevant: the bytes land under the replaced file's path.
    expect(state.calls).toContainEqual(["uploadFile", "public/media/hero.jpg", file]);
    expect(versionOf("public/media/hero.jpg")).toBeUndefined();
    expect(changed).toHaveBeenCalledWith("public/media");
  });

  test("a backend that stored it elsewhere did not replace anything, and says so", async () => {
    installMockPlatform({ uploadFile: () => Promise.resolve({ path: "public/media/hero-1.jpg" }) });
    expect(await replaceAsset("public/media/hero.jpg", testFile("hero.jpg"))).toBe(false);
    expect(problems.some((p) => p.message === "hero.jpg was not replaced.")).toBe(true);
  });

  test("a failed write is reported and changes nothing", async () => {
    installMockPlatform({ uploadFile: () => Promise.reject(new Error("read-only")) });
    const changed = mock(() => {});
    setMediaChangedHandler(changed);
    expect(await replaceAsset("hero.jpg", testFile("hero.jpg"))).toBe(false);
    expect(changed).not.toHaveBeenCalled();
    expect(problems.some((p) => p.message === "Could not replace hero.jpg.")).toBe(true);
  });

  test("a file of another format is refused before anything is written", async () => {
    const { state } = installMockPlatform();
    const changed = mock(() => {});
    setMediaChangedHandler(changed);
    // A PNG under hero.jpg, or a PDF under it, breaks every page that uses the address.
    expect(await replaceAsset("public/media/hero.jpg", testFile("logo.png"))).toBe(false);
    expect(await replaceAsset("public/logo.svg", testFile("menu.pdf"))).toBe(false);
    expect(state.calls.filter(([call]) => call === "uploadFile")).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(problems.some((p) => p.message === "logo.png cannot replace hero.jpg.")).toBe(true);
  });

  test("replaceAccept offers the replaced file's own format, and canReplaceWith agrees", () => {
    expect(replaceAccept("public/hero.jpg")).toBe(".jpg,.jpeg");
    expect(replaceAccept("public/scan.TIFF")).toBe(".tif,.tiff");
    expect(replaceAccept("public/media/clip.mp4")).toBe(".mp4");
    expect(canReplaceWith("public/hero.JPEG", { name: "new.jpg" })).toBe(true);
    expect(canReplaceWith("public/media/clip.mp4", { name: "clip.webm" })).toBe(false);
    expect(canReplaceWith("public/README", { name: "x" })).toBe(true);
  });

  test("a declared limit refuses an oversized replacement before the round trip", async () => {
    const { state } = installMockPlatform({ assetCapabilities: { maxUploadBytes: 10 } });
    const big = testFile("big.png");
    Object.defineProperty(big, "size", { value: 4096 });
    expect(await replaceAsset("public/media/hero.png", big)).toBe(false);
    expect(state.calls.filter(([call]) => call === "uploadFile")).toEqual([]);
  });
});
