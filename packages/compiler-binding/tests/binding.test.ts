import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_IMAGE_QUALITY,
  currentHost,
  imageMetadata,
  loadBinding,
  loadBindingFor,
  processImage,
  installedPackageDir,
  isBinding,
  runsMusl,
} from "../src/index.ts";
import { gradientPng } from "./_png.ts";

import type { Binding, ImageQuality, ImageRequest, LoaderHost } from "../src/index.ts";

let dir = "";
let source = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "jx-binding-"));
  source = join(dir, "hero.png");
  writeFileSync(source, gradientPng(64, 32));
});

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("the addon, loaded for real", () => {
  test("it reports the core it was built from", () => {
    expect(loadBinding().coreVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(loadBinding()).toBe(loadBinding());
  });

  test("it reads a source's size and format", async () => {
    expect(await imageMetadata(source)).toEqual({ format: "png", height: 32, width: 64 });
  });

  test("it writes one file per width and format and names each", async () => {
    const outDir = join(dir, "out");
    const manifest = await processImage({
      formats: ["avif", "jpeg", "png", "webp"],
      hashes: { avif: "abcd1234", jpeg: "abcd1234", png: "abcd1234", webp: "abcd1234" },
      outDir,
      quality: { avif: 50, jpeg: 70 },
      source,
      stem: "hero",
      widths: [16, 32, 128],
    });
    expect(manifest.original).toEqual({ format: "png", height: 32, width: 64 });
    expect(manifest.variants.map((v) => `${v.width}:${v.format}`)).toEqual(
      [16, 32, 64].flatMap((w) => ["avif", "jpeg", "png", "webp"].map((f) => `${w}:${f}`)),
    );
    expect(readdirSync(outDir).toSorted()).toEqual(
      manifest.variants.map((v) => v.fileName).toSorted(),
    );
    const avif = readFileSync(join(outDir, "hero-16-abcd1234.avif"));
    expect(avif.subarray(4, 12).toString("latin1")).toBe("ftypavif");
    expect(await imageMetadata(join(outDir, "hero-32-abcd1234.jpeg"))).toEqual({
      format: "jpeg",
      height: 16,
      width: 32,
    });
  });

  test("each format's files carry the hash that format was given", async () => {
    const outDir = join(dir, "per-format");
    const manifest = await processImage({
      formats: ["avif", "jpeg"],
      hashes: { avif: "aaaa0000", jpeg: "bbbb1111" },
      outDir,
      source,
      stem: "hero",
      widths: [16],
    });
    expect(manifest.variants.map((v) => v.fileName)).toEqual([
      "hero-16-aaaa0000.avif",
      "hero-16-bbbb1111.jpeg",
    ]);
  });

  test("a request with no quality encodes at the defaults this package states", async () => {
    const encode = async (name: string, quality?: ImageQuality) => {
      const outDir = join(dir, name);
      const request: ImageRequest = {
        formats: ["avif", "jpeg"],
        hashes: { avif: "q", jpeg: "q" },
        outDir,
        source,
        stem: "hero",
        widths: [32],
      };
      if (quality) {
        request.quality = quality;
      }
      await processImage(request);
      return ["avif", "jpeg"].map((format) =>
        readFileSync(join(outDir, `hero-32-q.${format}`)).toString("base64"),
      );
    };
    const unset = await encode("quality-unset");
    expect(unset).toEqual(await encode("quality-default", { ...DEFAULT_IMAGE_QUALITY }));
    expect(unset).not.toEqual(await encode("quality-other", { avif: 30, jpeg: 30 }));
  });

  test("an unknown format and an undecodable source reject with the reason", async () => {
    const request = {
      hashes: { png: "h" },
      outDir: join(dir, "bad"),
      source,
      stem: "hero",
      widths: [16],
    };
    expect(processImage({ ...request, formats: ["heic"] })).rejects.toThrow(
      'unsupported output format "heic"',
    );
    expect(processImage({ ...request, formats: ["png"], hashes: { heic: "h" } })).rejects.toThrow(
      'unsupported output format "heic"',
    );
    expect(processImage({ ...request, formats: ["avif"] })).rejects.toThrow(
      'no file-name hash was given for format "avif"',
    );
    const text = join(dir, "notes.png");
    writeFileSync(text, "plain text");
    expect(imageMetadata(text)).rejects.toThrow("cannot decode image");
    expect(processImage({ ...request, formats: ["png"], source: text })).rejects.toThrow(
      "notes.png",
    );
  });
});

describe("finding the addon", () => {
  const fake: Binding = {
    coreVersion: () => "9.9.9",
    imageMetadata: async () => ({ format: "png", height: 1, width: 1 }),
    processImage: async () => ({
      original: { format: "png", height: 1, width: 1 },
      variants: [],
    }),
  };
  const notTheAddon: Binding | undefined = [fake].at(1);
  const host = (over: Partial<LoaderHost>): LoaderHost => ({
    arch: "x64",
    exists: () => false,
    load: () => {
      throw new Error("Cannot find module");
    },
    localDirs: ["/repo/packages/compiler-binding", "/repo/packages/compiler-binding/src"],
    musl: false,
    platform: "linux",
    ...over,
  });

  test("a checkout's own build wins over an installed package", () => {
    const asked: string[] = [];
    const found = loadBindingFor(
      host({
        exists: (path) => path.endsWith("jx-compiler.linux-x64-gnu.node"),
        load: (specifier) => {
          asked.push(specifier);
          return fake;
        },
      }),
    );
    expect(found).toBe(fake);
    expect(asked).toEqual(["/repo/packages/compiler-binding/jx-compiler.linux-x64-gnu.node"]);
  });

  test("a file beside a bundled loader is found when the package root has none", () => {
    const asked: string[] = [];
    loadBindingFor(
      host({
        exists: (path) => path.includes("/src/") && path.endsWith("-musl.node"),
        load: (specifier) => {
          asked.push(specifier);
          if (specifier.endsWith(".node")) {
            return fake;
          }
          throw new Error("Cannot find module");
        },
      }),
    );
    expect(asked).toEqual([
      "@jxsuite/compiler-binding-linux-x64-gnu",
      "/repo/packages/compiler-binding/src/jx-compiler.linux-x64-musl.node",
    ]);
  });

  test("without a local build the platform package is loaded, the other C library second", () => {
    const asked: string[] = [];
    const found = loadBindingFor(
      host({
        load: (specifier) => {
          asked.push(specifier);
          if (specifier.endsWith("-musl")) {
            return fake;
          }
          throw new Error("Cannot find module");
        },
      }),
    );
    expect(found).toBe(fake);
    expect(asked).toEqual([
      "@jxsuite/compiler-binding-linux-x64-gnu",
      "@jxsuite/compiler-binding-linux-x64-musl",
    ]);
  });

  test("when nothing loads, every attempt and both remedies are named", () => {
    const attempt = () =>
      loadBindingFor(
        host({
          exists: () => true,
          load: (specifier) => {
            if (specifier.endsWith(".node")) {
              throw new Error("wrong ELF class");
            }
            return notTheAddon;
          },
        }),
      );
    expect(attempt).toThrow("jx-compiler.linux-x64-gnu.node: wrong ELF class");
    expect(attempt).toThrow(
      "@jxsuite/compiler-binding-linux-x64-gnu: loaded, but it is not the Jx compiler addon",
    );
    expect(attempt).toThrow("bun run build:addon");
    expect(attempt).toThrow("--no-optional");
  });

  test("a host no release covers is told so, with the way to build without the addon", () => {
    const attempt = () => loadBindingFor(host({ arch: "riscv64" }));
    expect(attempt).toThrow("has no build for linux-riscv64");
    expect(attempt).toThrow("images.optimize");
  });

  test("musl is a Linux host whose report names no glibc", () => {
    expect(runsMusl("linux", { header: { glibcVersionRuntime: "2.44" } })).toBe(false);
    expect(runsMusl("linux", { header: {} })).toBe(true);
    expect(runsMusl("linux")).toBe(false);
    expect(runsMusl("darwin", { header: {} })).toBe(false);
  });

  test("the addon is an object with processImage, and nothing else passes for it", () => {
    expect(isBinding(fake)).toBe(true);
    expect(isBinding({ processImage: "not a function" })).toBe(false);
    expect(isBinding(null)).toBe(false);
    expect(isBinding("jx-compiler.node")).toBe(false);
  });

  test("the package's own install directory is searched, when the module system knows it", () => {
    expect(
      installedPackageDir(() => "/app/node_modules/@jxsuite/compiler-binding/package.json"),
    ).toEqual(["/app/node_modules/@jxsuite/compiler-binding"]);
    const unknown = () => {
      throw new Error("Cannot find module");
    };
    expect(installedPackageDir(unknown)).toEqual([]);
  });

  test("the real host describes this process", () => {
    const real = currentHost();
    expect(real.platform).toBe(process.platform);
    expect(real.arch).toBe(process.arch);
    expect(real.localDirs.map((local) => local.split("/").slice(-2).join("/"))).toEqual([
      "packages/compiler-binding",
      "compiler-binding/src",
    ]);
    // Something that loads and is not the addon is reported as that, not returned.
    expect(real.load("node:path")).toBeUndefined();
    expect(real.exists(source)).toBe(true);
    expect(() => real.load("@jxsuite/definitely-not-installed")).toThrow();
  });
});
