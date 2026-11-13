/**
 * Image-optimizer — responsive image variants, encoded by the compiler's Rust core.
 *
 * Generates the variants of one source image (AVIF, JPEG, PNG, lossless WebP) at the configured
 * breakpoint widths, and returns an ImageManifest describing them. The pixels never enter
 * JavaScript: `@jxsuite/compiler-binding` decodes, orients, converts to sRGB, resizes and encodes
 * in process, in parallel across a source's variants (compiler.md §7.2).
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { imageMetadata, processImage as encodeVariants } from "@jxsuite/compiler-binding";

import type { ImageQuality } from "@jxsuite/compiler-binding";

export interface ImageVariant {
  width: number; // Pixel width of the variant
  format: string; // "webp", "avif", "jpeg", "png"
  outputPath: string; // Relative path from outDir (e.g.
  absolutePath: string; // Absolute filesystem path to the generated file
}

export interface ImageManifest {
  variants: ImageVariant[]; // Array of generated responsive variants
  contentHash: string; // 8-char content hash for cache busting
  original?: { width: number; height: number; format?: string }; // Original image dimensions
}

export interface ImageConfig {
  optimize: boolean;
  widths: number[];
  formats: string[];
  /**
   * Lossy quality per format, 1 to 100. The build service reads `avif` and `jpeg`: PNG is lossless,
   * and so is WebP as this compiler writes it. `webp` is still read by the Cloudflare service, as
   * the quality of its transform URLs; `png` is accepted so existing projects still validate.
   */
  quality: { webp?: number; avif?: number; jpeg?: number; png?: number };
  sizes: string;
  lazyLoad: boolean;
  /**
   * Wrap a multi-format image in a `<picture>` with one `<source>` per format. Default true.
   * Setting it false restores a bare `<img srcset>` in the preferred format, at the cost of
   * browsers that cannot decode that format: `srcset` carries no type information, so they pick an
   * undecodable candidate rather than falling back.
   */
  picture?: boolean;
  service?: "build" | "cloudflare";
  /**
   * Hostnames whose remote (https) images are routed through the optimization pipeline. Cloudflare
   * service only — allowlisted remote sources get /cdn-cgi/image transform srcsets (the zone must
   * permit resizing from the remote origin); everything else is left untouched.
   */
  remoteDomains?: string[];
}

const OPTIMIZED_DIR = "images/_optimized";

/**
 * Get an image's dimensions and format, reading only its header.
 *
 * The dimensions are the ones a viewer sees: an EXIF orientation that turns the image on its side
 * has already exchanged them.
 *
 * @param {string} srcPath - Absolute path to source image
 * @returns {Promise<{ width: number; height: number; format: string }>}
 */
export async function getImageMetadata(srcPath: string) {
  return imageMetadata(srcPath);
}

/**
 * Compute a content hash for a source image file.
 *
 * @param {string} srcPath - Absolute path to source image
 * @returns {string} 8-character hex hash
 */
export function contentHash(srcPath: string) {
  const buf = readFileSync(srcPath);
  return createHash("md5").update(buf).digest("hex").slice(0, 8);
}

/**
 * Bumped whenever the pipeline produces different output for the same source and settings.
 *
 * It is part of two things. The cache key is settings plus source bytes, which answers "would this
 * produce the same output?" only while the code between them is fixed; capping variants at the
 * largest configured width changed the answer for every image already cached, and without a version
 * those images kept their stale manifests. And a variant's file name carries it (`variantHash`),
 * because `/images/_optimized/*` is served as immutable: the same name must always be the same
 * bytes, and a new encoder writes different bytes for an unchanged source.
 *
 * 1 → 2: variants stop at the largest configured width (compiler.md §7.2).
 *
 * 2 → 3: the Rust core encodes. EXIF orientation is applied, embedded colour profiles are converted
 * to sRGB, WebP is lossless, and a transparent source asked for as JPEG is PNG.
 */
const PIPELINE_VERSION = 3;

/**
 * The hash in a variant's file name: the source's bytes and the pipeline that encoded them.
 *
 * @param {string} srcPath - Absolute path to source image
 * @returns {string} 8-character hex hash
 */
export function variantHash(srcPath: string) {
  return createHash("md5")
    .update(`${contentHash(srcPath)}:${PIPELINE_VERSION}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Compute a config hash from the image optimization settings.
 *
 * @param {ImageConfig} config
 * @returns {string}
 */
export function configHash(config: ImageConfig) {
  const key = JSON.stringify({
    formats: config.formats,
    quality: config.quality,
    v: PIPELINE_VERSION,
    widths: config.widths,
  });
  return createHash("md5").update(key).digest("hex").slice(0, 8);
}

/**
 * Process a single source image: resize to each configured width, encode to each format. Writes
 * variants to cacheImgDir/_optimized/ (e.g. .cache/images/_optimized/).
 *
 * The width ladder is the configured one capped at the source's own width, plus the source's native
 * width when it is narrower than the top rung; a source wider than the top rung stops there. A
 * variant whose file already exists is not encoded again, because its name carries a hash of the
 * source's bytes and the pipeline version.
 *
 * @param {string} srcPath - Absolute path to source image
 * @param {string} cacheImgDir - Absolute path to the image cache directory (.cache/images/)
 * @param {ImageConfig} config
 * @returns {Promise<ImageManifest>}
 */
export async function processImage(
  srcPath: string,
  cacheImgDir: string,
  config: ImageConfig,
): Promise<ImageManifest> {
  const optimizedDir = resolve(cacheImgDir, "_optimized");
  const quality: ImageQuality = {};
  if (config.quality.avif !== undefined) {
    quality.avif = config.quality.avif;
  }
  if (config.quality.jpeg !== undefined) {
    quality.jpeg = config.quality.jpeg;
  }
  const encoded = await encodeVariants({
    formats: config.formats,
    hash: variantHash(srcPath),
    outDir: optimizedDir,
    quality,
    source: srcPath,
    stem: basename(srcPath, extname(srcPath)),
    widths: config.widths,
  });
  return {
    contentHash: contentHash(srcPath),
    original: encoded.original,
    variants: encoded.variants.map((variant) => ({
      absolutePath: resolve(optimizedDir, variant.fileName),
      format: variant.format,
      outputPath: `/${OPTIMIZED_DIR}/${variant.fileName}`,
      width: variant.width,
    })),
  };
}

/**
 * Build a srcset string from variants of a specific format.
 *
 * @param {ImageVariant[]} variants
 * @param {string} format
 * @returns {string}
 */
export function buildSrcset(variants: ImageVariant[], format: string) {
  return variants
    .flatMap((v) => (v.format === format ? [`${variantUrl(v.outputPath)} ${v.width}w`] : []))
    .join(", ");
}

/**
 * The URL of an emitted variant: its output path with each segment percent-encoded.
 *
 * A variant is named after its source file, and a source file may be named anything. Written raw, a
 * name with a space breaks a `srcset`, which splits candidates on whitespace, so `Designer, White,
 * Black.jpg` became a candidate for `…/Designer,` and a descriptor of `White,`. A comma is legal
 * inside a candidate URL but not at its end, and is encoded too, so no file name can end a
 * candidate early. The file on disk keeps its name: a server decodes the path back to it.
 *
 * @param {string} outputPath - A variant's `outputPath`, as written to disk
 * @returns {string}
 */
export function variantUrl(outputPath: string) {
  return outputPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
