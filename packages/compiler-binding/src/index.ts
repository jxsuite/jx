/**
 * The Jx compiler's Rust core, loaded as a Node-API addon (specs/compiler.md §14).
 *
 * The addon is one self-contained file per platform: every codec in it is compiled in, so it links
 * no system library and has nothing to install beside it. This module finds that file and gives its
 * functions types. Nothing is loaded until the first call, so importing the compiler never requires
 * the addon; a build that optimizes no image never touches it.
 *
 * @docs framework/site/images
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { addonFileName, addonPackageName, hostTriples } from "./triple.ts";

import type { Host } from "./triple.ts";

/** Per-format quality, 1 to 100. Lossless formats (PNG, WebP) have none. */
export interface ImageQuality {
  avif?: number;
  jpeg?: number;
}

/** One source image and the variants to make of it. */
export interface ImageRequest {
  /** Absolute path of the source image. */
  source: string;
  /** Absolute path of the directory variants are written into. Created if missing. */
  outDir: string;
  /** The file-name stem of every variant. */
  stem: string;
  /** The source's content hash, part of every variant's name. */
  hash: string;
  /** The configured width ladder. */
  widths: number[];
  /** Output format names: `avif`, `jpeg`, `png`, `webp`. */
  formats: string[];
  quality?: ImageQuality;
}

/** A source image's dimensions after EXIF orientation, and its container format. */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

/** One written variant. */
export interface ImageVariant {
  width: number;
  format: string;
  /** File name inside the request's `outDir`. */
  fileName: string;
}

/** The result of processing one source image. */
export interface ImageManifest {
  original: ImageMetadata;
  /** Every variant, ordered by width and then by configured format. */
  variants: ImageVariant[];
}

/** The addon's exports. */
export interface Binding {
  /** The version of the Rust core the addon was built from. */
  coreVersion: () => string;
  /** Read a source image's oriented dimensions and format without decoding its pixels. */
  imageMetadata: (source: string) => Promise<ImageMetadata>;
  /** Produce every missing variant of one source image, and describe the whole set. */
  processImage: (request: ImageRequest) => Promise<ImageManifest>;
}

/** How the loader reaches the host: replaced by tests, never by callers. */
export interface LoaderHost extends Host {
  /** Whether a file exists. */
  exists: (path: string) => boolean;
  /**
   * Load the addon by path or package name. Throws when the module cannot be loaded, and returns
   * `undefined` when it loads and is something else.
   */
  load: (specifier: string) => Binding | undefined;
  /**
   * Directories searched for an addon file before any package is tried: the package's own root,
   * where a checkout builds it, and the directory of the module that holds this loader, which is
   * where an application that bundles the loader stages the file (the desktop backend puts it
   * beside its `index.js`).
   */
  localDirs: string[];
}

const nodeRequire = createRequire(import.meta.url);

/** The part of Node's diagnostic report that names the C library. */
export interface LibcReport {
  header?: { glibcVersionRuntime?: string };
}

/**
 * Whether a host runs musl. Node reports the glibc it runs on and reports nothing under musl; a
 * runtime with no report at all is taken for glibc, and the loader tries musl second.
 */
export function runsMusl(platform: string, report?: LibcReport): boolean {
  return platform === "linux" && report !== undefined && !report.header?.glibcVersionRuntime;
}

/** The real host. */
export function currentHost(): LoaderHost {
  return {
    arch: process.arch,
    exists: existsSync,
    load: (specifier) => {
      const loaded: unknown = nodeRequire(specifier);
      return isBinding(loaded) ? loaded : undefined;
    },
    localDirs: [dirname(import.meta.dirname), import.meta.dirname],
    /* SAFETY: `getReport` returns an untyped diagnostic object; one optional string is read. */
    musl: runsMusl(process.platform, process.report.getReport() as LibcReport),
    platform: process.platform,
  };
}

/** Whether a loaded module is the addon: an object with the function every caller needs. */
export function isBinding(value: unknown): value is Binding {
  return (
    typeof value === "object" &&
    value !== null &&
    "processImage" in value &&
    typeof value.processImage === "function"
  );
}

/**
 * Find and load the addon for a host.
 *
 * A file beside the loader wins over an installed package, so a contributor always runs the Rust
 * they are editing and a bundled application runs the addon it shipped. Every failure is kept and
 * reported together: "not found" alone would hide a build that exists and cannot load.
 */
export function loadBindingFor(host: LoaderHost): Binding {
  const triples = hostTriples(host);
  if (triples.length === 0) {
    throw new Error(
      `@jxsuite/compiler-binding has no build for ${host.platform}-${host.arch}. ` +
        "Image optimization needs one; set images.optimize to false to build without it.",
    );
  }
  const failures: string[] = [];
  for (const triple of triples) {
    const candidates = [
      ...host.localDirs
        .map((dir) => join(dir, addonFileName(triple)))
        .filter((file) => host.exists(file)),
      addonPackageName(triple),
    ];
    for (const candidate of candidates) {
      try {
        const loaded = host.load(candidate);
        if (loaded) {
          return loaded;
        }
        failures.push(`${candidate}: loaded, but it is not the Jx compiler addon`);
      } catch (error) {
        failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const attempts = failures.map((line) => `  - ${line}`).join("\n");
  throw new Error(
    `The Jx compiler's native addon could not be loaded.\n${attempts}\n` +
      "In a checkout of the Jx repository, build it with `bun run build:addon` (needs Rust). " +
      "In a project, reinstall dependencies without --no-optional so the package for this " +
      "platform is installed.",
  );
}

let cached: Binding | undefined;

/** The addon for this process, loaded on first use. */
export function loadBinding(): Binding {
  cached ??= loadBindingFor(currentHost());
  return cached;
}

/** Read a source image's oriented dimensions and format without decoding its pixels. */
export async function imageMetadata(source: string): Promise<ImageMetadata> {
  return loadBinding().imageMetadata(source);
}

/** Produce every missing variant of one source image, and describe the whole set. */
export async function processImage(request: ImageRequest): Promise<ImageManifest> {
  return loadBinding().processImage(request);
}
