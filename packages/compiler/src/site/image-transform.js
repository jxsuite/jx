/**
 * Image-transform.js — Document tree walker for responsive image optimization.
 *
 * Walks a Jx document tree, finds <img> nodes with static src paths, and injects srcset, sizes,
 * width, height, loading, and decoding attributes. Collects image references so the build
 * orchestrator knows which files to process.
 */

import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { processImage, buildSrcset, contentHash, configHash } from "./image-optimizer.js";
import { getCached, setCached } from "./image-cache.js";

/**
 * @typedef {import("./image-optimizer.js").ImageConfig} ImageConfig
 *
 * @typedef {import("./image-optimizer.js").ImageManifest} ImageManifest
 *
 * @typedef {import("./image-cache.js").CacheManifest} CacheManifest
 */

const SKIP_EXTENSIONS = new Set([".svg", ".gif"]);
const EXTERNAL_PREFIXES = ["http://", "https://", "data:", "//"];

/**
 * Check if a src value should be skipped for optimization.
 *
 * @param {any} src
 * @returns {boolean}
 */
function shouldSkip(src) {
  if (typeof src !== "string") return true;
  if (src.includes("${")) return true;
  if (EXTERNAL_PREFIXES.some((p) => src.startsWith(p))) return true;
  if (SKIP_EXTENSIONS.has(extname(src).toLowerCase())) return true;
  return false;
}

/**
 * Resolve a src path to an absolute filesystem path.
 *
 * Handles paths starting with "/" (relative to public dir or project root).
 *
 * @param {string} src
 * @param {string} projectRoot
 * @returns {string}
 */
function resolveImagePath(src, projectRoot) {
  if (src.startsWith("/")) {
    return resolve(projectRoot, "public", src.slice(1));
  }
  return resolve(projectRoot, src);
}

/**
 * Transform image nodes in a Jx document tree.
 *
 * Mutates img nodes in place, injecting srcset, sizes, width, height, loading, and decoding.
 * Returns a set of absolute source paths that need processing.
 *
 * @param {any} doc - The Jx document tree (mutated in place)
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {string} outDir
 * @param {CacheManifest} cache
 * @returns {Promise<{ imageRefs: Map<string, ImageManifest> }>}
 */
export async function transformImageNodes(doc, config, projectRoot, outDir, cache) {
  /** @type {Map<string, ImageManifest>} */
  const imageRefs = new Map();

  if (!config.optimize) return { imageRefs };

  await walkAndTransform(doc, config, projectRoot, outDir, cache, imageRefs);

  return { imageRefs };
}

/**
 * @param {any} node
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {string} outDir
 * @param {CacheManifest} cache
 * @param {Map<string, ImageManifest>} imageRefs
 */
async function walkAndTransform(node, config, projectRoot, outDir, cache, imageRefs) {
  if (!node || typeof node !== "object") return;

  if (node.tagName === "img") {
    await transformImgNode(node, config, projectRoot, outDir, cache, imageRefs);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      await walkAndTransform(child, config, projectRoot, outDir, cache, imageRefs);
    }
  }
}

/**
 * @param {any} node
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {string} outDir
 * @param {CacheManifest} cache
 * @param {Map<string, ImageManifest>} imageRefs
 */
async function transformImgNode(node, config, projectRoot, outDir, cache, imageRefs) {
  if (!node.attributes) node.attributes = {};

  const src = node.attributes.src ?? node.src;
  if (shouldSkip(src)) return;
  if (node.attributes["data-no-optimize"] !== undefined) return;

  const absoluteSrc = resolveImagePath(src, projectRoot);
  if (!existsSync(absoluteSrc)) return;

  let manifest = imageRefs.get(absoluteSrc);

  if (!manifest) {
    const key = `${contentHash(absoluteSrc)}:${configHash(config)}`;
    const cached = getCached(cache, key, outDir);
    manifest = cached ?? (await processImage(absoluteSrc, outDir, config));

    setCached(cache, key, src, manifest);
    imageRefs.set(absoluteSrc, manifest);
  }

  const preferredFormat = config.formats.includes("avif") ? "avif" : config.formats[0];
  const srcset = buildSrcset(manifest.variants, preferredFormat);

  if (srcset) {
    node.attributes.srcset = srcset;
    node.attributes.sizes = node.attributes.sizes ?? config.sizes;
  }

  if (!node.attributes.width && manifest.original.width) {
    node.attributes.width = String(manifest.original.width);
  }
  if (!node.attributes.height && manifest.original.height) {
    node.attributes.height = String(manifest.original.height);
  }

  if (config.lazyLoad && node.attributes.loading !== "eager") {
    node.attributes.loading = "lazy";
    node.attributes.decoding = "async";
  }
}
