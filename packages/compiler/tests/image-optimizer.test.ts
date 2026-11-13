import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  contentHash,
  configHash,
  variantHash,
  buildSrcset,
  getImageMetadata,
  processImage,
  variantUrl,
} from "../src/site/image-optimizer";
import { cacheKey, loadCache, saveCache, getCached, setCached } from "../src/site/image-cache";
import { transformImageNodes } from "../src/site/image-transform";
import {
  fakeSource,
  imageMetadata,
  installFakeBinding,
  processImage as encodeVariants,
  resetFakeSource,
} from "./_fake-binding";
import type { CacheManifest } from "../src/site/image-cache";
import type { JxMutableNode } from "@jxsuite/schema/types";

// The native addon is replaced by a double: these tests prove what the compiler asks of it.
installFakeBinding();

const TMP = resolve(tmpdir(), `jx-image-test-${Date.now()}`);

function setup() {
  rmSync(TMP, { force: true, recursive: true });
  mkdirSync(TMP, { recursive: true });
  mkdirSync(join(TMP, "public/images"), { recursive: true });
  return TMP;
}

function teardown() {
  rmSync(TMP, { force: true, recursive: true });
}

// ─── Pure utility tests (no Sharp needed) ────────────────────────────────────

describe("image-optimizer utilities", () => {
  test("buildSrcset filters by format", () => {
    const variants = [
      {
        absolutePath: "",
        format: "webp",
        outputPath: "/images/_optimized/hero-320-abc.webp",
        width: 320,
      },
      {
        absolutePath: "",
        format: "webp",
        outputPath: "/images/_optimized/hero-640-abc.webp",
        width: 640,
      },
      {
        absolutePath: "",
        format: "avif",
        outputPath: "/images/_optimized/hero-320-abc.avif",
        width: 320,
      },
      {
        absolutePath: "",
        format: "avif",
        outputPath: "/images/_optimized/hero-640-abc.avif",
        width: 640,
      },
    ];

    const webpSrcset = buildSrcset(variants, "webp");
    expect(webpSrcset).toBe(
      "/images/_optimized/hero-320-abc.webp 320w, /images/_optimized/hero-640-abc.webp 640w",
    );

    const avifSrcset = buildSrcset(variants, "avif");
    expect(avifSrcset).toContain("avif");
    expect(avifSrcset).not.toContain("webp");
  });

  test("buildSrcset returns empty for no matches", () => {
    expect(buildSrcset([], "webp")).toBe("");
  });

  test("buildSrcset encodes a file name a srcset would split", () => {
    const stem = "12x28 Designer, White, Black";
    const variants = [320, 640].map((width) => ({
      absolutePath: `/tmp/${stem}-${width}-abc.avif`,
      format: "avif",
      outputPath: `/images/_optimized/${stem}-${width}-abc.avif`,
      width,
    }));
    const srcset = buildSrcset(variants, "avif");
    expect(srcset).toBe(
      "/images/_optimized/12x28%20Designer%2C%20White%2C%20Black-320-abc.avif 320w, " +
        "/images/_optimized/12x28%20Designer%2C%20White%2C%20Black-640-abc.avif 640w",
    );
    // Each candidate is one URL and one descriptor, which is what a browser's srcset parser reads.
    for (const candidate of srcset.split(", ")) {
      expect(candidate.split(" ")).toHaveLength(2);
    }
  });

  test("variantUrl encodes each segment and leaves the separators", () => {
    expect(variantUrl("/images/_optimized/hero-640-abc.webp")).toBe(
      "/images/_optimized/hero-640-abc.webp",
    );
    expect(variantUrl("/images/_optimized/Café 100%-640-abc.webp")).toBe(
      "/images/_optimized/Caf%C3%A9%20100%25-640-abc.webp",
    );
  });
});

describe("contentHash and configHash", () => {
  test("contentHash returns 8-char hex string", () => {
    const root = setup();
    const file = join(root, "test.bin");
    writeFileSync(file, "hello world");

    const hash = contentHash(file);
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);

    teardown();
  });

  test("contentHash changes when file content changes", () => {
    const root = setup();
    const file = join(root, "test.bin");

    writeFileSync(file, "content A");
    const hashA = contentHash(file);

    writeFileSync(file, "content B");
    const hashB = contentHash(file);

    expect(hashA).not.toBe(hashB);
    teardown();
  });

  test("configHash returns 8-char hex string", () => {
    const hash = configHash({
      formats: ["webp"],
      lazyLoad: true,
      optimize: true,
      quality: { webp: 80 },
      sizes: "100vw",
      widths: [320, 640],
    });
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  test("configHash changes with different settings", () => {
    const base = { lazyLoad: true, optimize: true, sizes: "100vw" };
    const hashA = configHash({
      ...base,
      formats: ["webp"],
      quality: { webp: 80 },
      widths: [320],
    });
    const hashB = configHash({
      ...base,
      formats: ["webp"],
      quality: { webp: 80 },
      widths: [640],
    });
    expect(hashA).not.toBe(hashB);
  });

  /*
   * The cache key answers "would this produce the same output?", which is only true while the code
   * between the settings and the output is fixed. Capping variants at the largest configured width
   * changed the answer for every already-cached image, and without a version in the key those
   * images kept their stale manifests — oversized variants and all.
   */
  test("configHash carries a pipeline version, not just the settings", () => {
    const config = {
      formats: ["webp"],
      lazyLoad: true,
      optimize: true,
      quality: { webp: 80 },
      sizes: "100vw",
      widths: [320],
    };
    const settingsOnly = createHash("md5")
      .update(
        JSON.stringify({ formats: config.formats, quality: config.quality, widths: config.widths }),
      )
      .digest("hex")
      .slice(0, 8);

    expect(configHash(config)).not.toBe(settingsOnly);
  });
});

// ─── Cache tests ─────────────────────────────────────────────────────────────

describe("image-cache", () => {
  test("loadCache returns empty manifest when no cache exists", () => {
    const cache = loadCache("/nonexistent/path");
    expect(cache).toEqual({ entries: {}, touched: new Set(), version: 1 });
  });

  test("saveCache and loadCache round-trip", () => {
    const root = setup();
    const cache = {
      entries: {
        "abc:def": {
          manifest: {
            contentHash: "abc",
            original: { format: "jpeg", height: 100, width: 100 },
            variants: [],
          },
          source: "test.jpg",
          timestamp: 1000,
        },
      },
      version: 1,
    };

    saveCache(root, cache);
    const loaded = loadCache(root);
    expect(loaded.entries["abc:def"]!.source).toBe("test.jpg");
    teardown();
  });

  test("getCached returns null for missing key", () => {
    const cache = { entries: {}, version: 1 };
    expect(getCached(cache, "missing")).toBeNull();
  });

  test("getCached returns manifest regardless of output file existence", () => {
    const manifest = {
      contentHash: "abc",
      original: { format: "jpeg", height: 600, width: 800 },
      variants: [
        {
          absolutePath: "/nonexistent/dist/images/_optimized/hero-320-abc.avif",
          format: "avif",
          outputPath: "/images/_optimized/hero-320-abc.avif",
          width: 320,
        },
      ],
    };
    const cache = {
      entries: {
        "abc:def": { manifest, source: "hero.jpg", timestamp: 1000 },
      },
      version: 1,
    };
    const result = getCached(cache, "abc:def");
    expect(result).not.toBeNull();
    expect(result?.original!.width).toBe(800);
    expect(result?.variants).toHaveLength(1);
  });

  test("setCached stores entry", () => {
    const cache: CacheManifest = { entries: {}, version: 1 };
    const manifest = {
      contentHash: "abc",
      original: { format: "jpeg", height: 600, width: 800 },
      variants: [],
    };
    setCached(cache, "key1", "test.jpg", manifest);
    expect(cache.entries["key1"]).toBeDefined();
    expect(cache.entries["key1"]?.source).toBe("test.jpg");
  });
});

// ─── Transform tests (no Sharp — tests skip conditions and tree walking) ─────

describe("image-transform", () => {
  const defaultConfig = {
    formats: ["webp", "avif"],
    lazyLoad: true,
    optimize: true,
    quality: { avif: 65, webp: 80 },
    sizes: "(max-width: 768px) 100vw, 50vw",
    widths: [320, 640],
  };

  test("skips when optimize is false", async () => {
    const img: JxMutableNode = { attributes: { src: "/images/hero.jpg" }, tagName: "img" };
    const doc = { children: [img], tagName: "div" };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(
      doc,
      { ...defaultConfig, optimize: false },
      "/tmp",
      cache,
    );
    expect(result.imageRefs.size).toBe(0);
    expect(img.attributes?.srcset).toBeUndefined();
  });

  test("skips template string src", async () => {
    const root = setup();
    const doc = {
      children: [{ attributes: { src: "${state.image}" }, tagName: "img" }],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("skips external URLs", async () => {
    const root = setup();
    const doc = {
      children: [
        { attributes: { src: "https://example.com/img.jpg" }, tagName: "img" },
        { attributes: { src: "data:image/png;base64,abc" }, tagName: "img" },
        { attributes: { src: "//cdn.example.com/img.jpg" }, tagName: "img" },
      ],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("skips SVG and GIF files", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/icon.svg"), "<svg></svg>");
    writeFileSync(join(root, "public/images/anim.gif"), "GIF89a");

    const doc = {
      children: [
        { attributes: { src: "/images/icon.svg" }, tagName: "img" },
        { attributes: { src: "/images/anim.gif" }, tagName: "img" },
      ],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("serves an AVIF source as written instead of re-encoding it", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/photo.avif"), "avif bytes");
    const img: JxMutableNode = { attributes: { src: "/images/photo.avif" }, tagName: "img" };
    const result = await transformImageNodes(img, defaultConfig, root, { entries: {}, version: 1 });
    expect(result.imageRefs.size).toBe(0);
    expect(img.attributes?.src).toBe("/images/photo.avif");
    expect(img.attributes?.srcset).toBeUndefined();
    teardown();
  });

  test("skips data-no-optimize images", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/hero.jpg"), "fake jpg data");

    const doc = {
      children: [
        {
          attributes: { "data-no-optimize": "", src: "/images/hero.jpg" },
          tagName: "img",
        },
      ],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("skips when source file does not exist", async () => {
    const root = setup();
    const doc = {
      children: [{ attributes: { src: "/images/nonexistent.jpg" }, tagName: "img" }],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("walks nested children", async () => {
    const root = setup();
    const doc = {
      children: [
        {
          children: [
            { tagName: "p", textContent: "text" },
            {
              attributes: { src: "https://external.com/photo.jpg" },
              tagName: "img",
            },
          ],
          tagName: "section",
        },
      ],
      tagName: "div",
    };
    const cache = { entries: {}, version: 1 };
    const result = await transformImageNodes(doc, defaultConfig, root, cache);
    expect(result.imageRefs.size).toBe(0);
    teardown();
  });

  test("transforms img tags inside innerHTML strings", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/photo.jpg"), "fake jpg data");

    const cacheOptDir = join(root, ".cache/images/_optimized");
    mkdirSync(cacheOptDir, { recursive: true });

    const manifest = {
      contentHash: "abc12345",
      original: { format: "jpeg", height: 800, width: 1200 },
      variants: [
        {
          absolutePath: join(cacheOptDir, "photo-320-abc.avif"),
          format: "avif",
          outputPath: "/images/_optimized/photo-320-abc.avif",
          width: 320,
        },
        {
          absolutePath: join(cacheOptDir, "photo-640-abc.avif"),
          format: "avif",
          outputPath: "/images/_optimized/photo-640-abc.avif",
          width: 640,
        },
      ],
    };

    for (const v of manifest.variants) {
      writeFileSync(v.absolutePath, "");
    }

    const cache = { entries: {}, version: 1 };
    setCached(
      cache,
      cacheKey(join(root, "public/images/photo.jpg"), defaultConfig),
      "/images/photo.jpg",
      manifest,
    );

    const doc = {
      innerHTML: '<img class="hero" src="/images/photo.jpg" alt="Photo">',
      tagName: "my-component",
    };

    await transformImageNodes(doc, defaultConfig, root, cache);

    expect(doc.innerHTML).toContain("srcset=");
    expect(doc.innerHTML).toContain("photo-320-abc.avif 320w");
    expect(doc.innerHTML).toContain("photo-640-abc.avif 640w");
    expect(doc.innerHTML).toContain('width="1200" height="800"');
    expect(doc.innerHTML).toContain('sizes="');

    teardown();
  });

  test("innerHTML: skips img tags that already have srcset", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/photo.jpg"), "fake jpg data");

    const doc = {
      innerHTML: '<img src="/images/photo.jpg" srcset="already-set" alt="Photo">',
      tagName: "my-component",
    };
    const cache = { entries: {}, version: 1 };

    await transformImageNodes(doc, defaultConfig, root, cache);
    // The candidate list is the author's; when to fetch is still the pipeline's call.
    expect(doc.innerHTML).toContain('srcset="already-set"');
    expect(doc.innerHTML).not.toContain("_optimized");
    expect(doc.innerHTML).toContain('loading="lazy"');
    teardown();
  });

  test("innerHTML: skips data-no-optimize img tags", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/photo.jpg"), "fake jpg data");

    const doc = {
      innerHTML: '<img src="/images/photo.jpg" data-no-optimize alt="Photo">',
      tagName: "my-component",
    };
    const cache = { entries: {}, version: 1 };

    await transformImageNodes(doc, defaultConfig, root, cache);
    expect(doc.innerHTML).not.toContain("srcset=");
    teardown();
  });

  test("innerHTML: skips template strings and external URLs", async () => {
    const root = setup();
    const doc = {
      innerHTML:
        '<img src="${state.image}" alt="Dynamic"><img src="https://cdn.example.com/img.jpg" alt="External">',
      tagName: "my-component",
    };
    const cache = { entries: {}, version: 1 };

    await transformImageNodes(doc, defaultConfig, root, cache);
    expect(doc.innerHTML).not.toContain("srcset=");
    teardown();
  });

  test("innerHTML: preserves existing loading and decoding attributes", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/hero.jpg"), "fake jpg data");

    const cacheOptDir = join(root, ".cache/images/_optimized");
    mkdirSync(cacheOptDir, { recursive: true });

    const manifest = {
      contentHash: "abc12345",
      original: { format: "jpeg", height: 600, width: 800 },
      variants: [
        {
          absolutePath: join(cacheOptDir, "hero-320-abc.avif"),
          format: "avif",
          outputPath: "/images/_optimized/hero-320-abc.avif",
          width: 320,
        },
      ],
    };
    for (const v of manifest.variants) {
      writeFileSync(v.absolutePath, "");
    }

    const cache = { entries: {}, version: 1 };
    setCached(
      cache,
      cacheKey(join(root, "public/images/hero.jpg"), defaultConfig),
      "/images/hero.jpg",
      manifest,
    );

    const doc = {
      innerHTML: '<img src="/images/hero.jpg" loading="eager" decoding="sync">',
      tagName: "my-component",
    };

    await transformImageNodes(doc, defaultConfig, root, cache);
    expect(doc.innerHTML).toContain('loading="eager"');
    expect(doc.innerHTML).not.toContain('loading="lazy"');
    expect(doc.innerHTML).not.toContain('decoding="async"');
    teardown();
  });

  test("innerHTML: handles multiple img tags in one string", async () => {
    const root = setup();
    writeFileSync(join(root, "public/images/a.jpg"), "fake a");
    writeFileSync(join(root, "public/images/b.jpg"), "fake b");

    const cacheOptDir = join(root, ".cache/images/_optimized");
    mkdirSync(cacheOptDir, { recursive: true });

    const makeManifest = (name: string) => {
      const m = {
        contentHash: "abc12345",
        original: { format: "jpeg", height: 480, width: 640 },
        variants: [
          {
            absolutePath: join(cacheOptDir, `${name}-320-abc.avif`),
            format: "avif",
            outputPath: `/images/_optimized/${name}-320-abc.avif`,
            width: 320,
          },
        ],
      };
      for (const v of m.variants) {
        writeFileSync(v.absolutePath, "");
      }
      return m;
    };

    const cache = { entries: {}, version: 1 };
    setCached(
      cache,
      cacheKey(join(root, "public/images/a.jpg"), defaultConfig),
      "/images/a.jpg",
      makeManifest("a"),
    );
    setCached(
      cache,
      cacheKey(join(root, "public/images/b.jpg"), defaultConfig),
      "/images/b.jpg",
      makeManifest("b"),
    );

    const doc = {
      innerHTML:
        '<div><img src="/images/a.jpg" alt="A"><p>text</p><img src="/images/b.jpg" alt="B"></div>',
      tagName: "my-component",
    };

    await transformImageNodes(doc, defaultConfig, root, cache);
    expect(doc.innerHTML).toContain("a-320-abc.avif");
    expect(doc.innerHTML).toContain("b-320-abc.avif");
    teardown();
  });
});

// ─── The addon boundary (getImageMetadata, processImage) ─────────────────────

describe("getImageMetadata", () => {
  test("returns what the addon reads from the source's header", async () => {
    imageMetadata.mockClear();
    const meta = await getImageMetadata("/project/public/images/test.png");
    expect(meta).toEqual({ format: "jpeg", height: 600, width: 800 });
    expect(imageMetadata.mock.calls).toEqual([["/project/public/images/test.png"]]);
  });
});

describe("processImage", () => {
  const config = {
    formats: ["avif", "jpeg"],
    lazyLoad: true,
    optimize: true,
    quality: { avif: 60, jpeg: 75, png: 90, webp: 70 },
    sizes: "100vw",
    widths: [320, 640, 1280],
  };

  beforeEach(() => {
    encodeVariants.mockClear();
    resetFakeSource();
  });

  test("asks the addon for the configured ladder, named by stem and content hash", async () => {
    const root = setup();
    const imgPath = join(root, "public/images/hero shot.jpg");
    writeFileSync(imgPath, "fake jpeg data");
    const cacheDir = join(root, ".cache/images");

    await processImage(imgPath, cacheDir, config);

    expect(encodeVariants.mock.calls).toEqual([
      [
        {
          formats: ["avif", "jpeg"],
          hash: variantHash(imgPath),
          outDir: join(cacheDir, "_optimized"),
          quality: { avif: 60, jpeg: 75 },
          source: imgPath,
          stem: "hero shot",
          widths: [320, 640, 1280],
        },
      ],
    ]);
    teardown();
  });

  test("a quality the project leaves out is left to the addon's default", async () => {
    const root = setup();
    const imgPath = join(root, "public/images/hero.jpg");
    writeFileSync(imgPath, "fake jpeg data");

    await processImage(imgPath, join(root, ".cache/images"), { ...config, quality: {} });
    expect(encodeVariants.mock.calls[0]?.[0].quality).toEqual({});

    await processImage(imgPath, join(root, ".cache/images"), { ...config, quality: { jpeg: 50 } });
    expect(encodeVariants.mock.calls[1]?.[0].quality).toEqual({ jpeg: 50 });
    teardown();
  });

  test("describes every variant by its cache path and its site URL", async () => {
    const root = setup();
    const imgPath = join(root, "public/images/hero.jpg");
    writeFileSync(imgPath, "fake jpeg data");
    const cacheDir = join(root, ".cache/images");
    const hash = variantHash(imgPath);

    const manifest = await processImage(imgPath, cacheDir, config);

    // The manifest keeps the source's own hash; a variant's name also carries the pipeline.
    expect(manifest.contentHash).toBe(contentHash(imgPath));
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hash).not.toBe(contentHash(imgPath));
    expect(manifest.original).toEqual({ format: "jpeg", height: 600, width: 800 });
    // An 800 px source: the 1280 rung is dropped and the native width is offered instead.
    expect(manifest.variants.map((v) => `${v.width}:${v.format}`)).toEqual([
      "320:avif",
      "320:jpeg",
      "640:avif",
      "640:jpeg",
      "800:avif",
      "800:jpeg",
    ]);
    expect(manifest.variants[0]).toEqual({
      absolutePath: join(cacheDir, "_optimized", `hero-320-${hash}.avif`),
      format: "avif",
      outputPath: `/images/_optimized/hero-320-${hash}.avif`,
      width: 320,
    });
    for (const variant of manifest.variants) {
      expect(existsSync(variant.absolutePath)).toBe(true);
    }
    teardown();
  });

  test("the reported size is the addon's, after orientation", async () => {
    const root = setup();
    const imgPath = join(root, "public/images/portrait.jpg");
    writeFileSync(imgPath, "fake jpeg data");
    Object.assign(fakeSource, { height: 4000, width: 3000 });

    const manifest = await processImage(imgPath, join(root, ".cache/images"), config);
    expect(manifest.original).toEqual({ format: "jpeg", height: 4000, width: 3000 });
    expect(manifest.variants.at(-1)?.width).toBe(1280);
    teardown();
  });

  test("an addon failure rejects with its message", async () => {
    encodeVariants.mockImplementationOnce(async () => {
      throw new Error("/x/broken.png: cannot decode image: unexpected end of file");
    });
    const root = setup();
    const imgPath = join(root, "public/images/broken.png");
    writeFileSync(imgPath, "not a png");
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(processImage(imgPath, join(root, ".cache/images"), config)).rejects.toThrow(
      "cannot decode image",
    );
    teardown();
  });
});

// ─── Site-loader config tests ────────────────────────────────────────────────

describe("site-loader images config", () => {
  test("DEFAULTS include images config", async () => {
    const { loadProjectConfig } = await import("../src/site/site-loader.js");
    const root = setup();
    writeFileSync(join(root, "project.json"), JSON.stringify({ name: "Test" }));

    const { config } = loadProjectConfig(root);
    expect(config.images).toBeDefined();
    expect(config.images.optimize).toBe(true);
    expect(config.images.widths).toEqual([320, 640, 960, 1280, 1920]);
    expect(config.images.formats).toEqual(["avif", "jpeg"]);
    expect(config.images.quality).toEqual({ avif: 65, jpeg: 80 });
    expect(config.images.sizes).toBe("(max-width: 768px) 100vw, 50vw");
    expect(config.images.lazyLoad).toBe(true);

    teardown();
  });

  test("project.json images config merges with defaults", async () => {
    const { loadProjectConfig } = await import("../src/site/site-loader.js");
    const root = setup();
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({
        images: { optimize: false, widths: [400, 800] },
        name: "Test",
      }),
    );

    const { config } = loadProjectConfig(root);
    expect(config.images.optimize).toBe(false);
    expect(config.images.widths).toEqual([400, 800]);
    expect(config.images.formats).toEqual(["avif", "jpeg"]);

    teardown();
  });
});
