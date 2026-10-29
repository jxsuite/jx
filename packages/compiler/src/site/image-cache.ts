/**
 * Image-cache.js — Content-hash based cache for processed image variants.
 *
 * Stores a manifest of previously processed images so that unchanged sources can skip re-encoding
 * on subsequent builds. Cache lives in the npm global cache directory under jxsuite-images/ so that
 * CI environments (e.g. Cloudflare Pages) can persist it via their npm cache layer.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { configHash, contentHash } from "./image-optimizer.ts";

import type { ImageConfig, ImageManifest, ImageVariant } from "./image-optimizer.ts";

interface CacheEntry {
  source: string; // Relative path to source image
  manifest: ImageManifest; // Processed image manifest
  timestamp: number; // When the entry was cached
}

/**
 * A cache entry as `manifest.json` may still hold it. A persisted cache outlives the build that
 * wrote it, and an entry from before manifests carried `variants` has none, so pruning, which reads
 * every entry rather than only the ones this build looked up, does not assume the list is there.
 */
interface PersistedEntry {
  manifest: { variants?: readonly ImageVariant[] };
}

export interface CacheManifest {
  version: number; // Cache format version
  entries: Record<string, CacheEntry>; // Cached entries keyed by content+config hash
  touched?: Set<string>; // Keys resolved during this build — runtime only, never serialized
}

// ─── Cache directory resolution ──────────────────────────────────────────────

let _npmCacheBase: string | null | undefined; // Undefined = not yet resolved

/** Reset the memoized npm cache base so the next call re-evaluates. Tests only. */
export function _testResetNpmCacheBase() {
  _npmCacheBase = undefined;
}

/**
 * Directly set the memoized npm cache base. Pass null to force the project-local fallback. Tests
 * only.
 */
export function _testSetNpmCacheBase(value: string | null) {
  _npmCacheBase = value;
}

/**
 * How long the npm probe may run before the build stops waiting and caches in the project.
 *
 * `npm config get cache` answers in a fraction of a second, but nothing bounded it, and the call is
 * synchronous: when npm hung, the first build of the process hung with it. On a CI runner it
 * stalled past both of the dev server's 5 s and 20 s test timeouts with nothing to show for it but
 * "killed 1 dangling process". Missing the npm cache only costs persistence across builds.
 */
const NPM_PROBE_TIMEOUT_MS = 3000;

/**
 * Where npm keeps its cache, or null when npm cannot say.
 *
 * Npm reads its configuration from the environment as well as from `.npmrc`, and the environment
 * wins, so a value there is npm's own answer and no process is needed to ask for it. A script run
 * by a package manager usually has it there.
 */
function npmCacheBase(): string | null {
  const fromEnv = process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE;
  if (fromEnv) {
    return fromEnv;
  }
  try {
    const result = execSync("npm config get cache", {
      cwd: tmpdir(), // Avoid ENOWORKSPACES when cwd is inside an npm workspace
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: NPM_PROBE_TIMEOUT_MS,
    }).trim();
    return result && result !== "undefined" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Return the image cache directory for a project.
 *
 * Prefers the npm global cache (`npm config get cache`) so CI environments that cache ~/.npm (e.g.
 * Cloudflare Pages) automatically persist optimized images across builds. Falls back to
 * .cache/images inside the project root when npm is unavailable or does not answer in time.
 *
 * Result is memoized — npm is asked at most once per process.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function getImageCacheDir(projectRoot: string): string {
  if (_npmCacheBase === undefined) {
    _npmCacheBase = npmCacheBase();
  }
  if (_npmCacheBase) {
    return resolve(_npmCacheBase, "jxsuite-images", basename(projectRoot));
  }
  return resolve(projectRoot, ".cache/images");
}

// ─── Cache key ───────────────────────────────────────────────────────────────

/**
 * Build a cache key from source file content and config.
 *
 * @param {string} srcPath - Absolute path to source image
 * @param {ImageConfig} config
 * @returns {string}
 */
export function cacheKey(srcPath: string, config: ImageConfig) {
  return `${contentHash(srcPath)}:${configHash(config)}`;
}

// ─── Load / save ─────────────────────────────────────────────────────────────

/**
 * Load the cache manifest from disk, or return an empty one.
 *
 * @param {string} projectRoot
 * @returns {CacheManifest}
 */
export function loadCache(projectRoot: string): CacheManifest {
  const manifestPath = resolve(getImageCacheDir(projectRoot), "manifest.json");
  if (!existsSync(manifestPath)) {
    return { entries: {}, touched: new Set(), version: 1 };
  }
  try {
    /* SAFETY: manifest.json is written only by saveCache, from a CacheManifest minus its
       runtime-only `touched`, which is restored below; bytes that do not parse throw into the
       empty-cache fallback. */
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as CacheManifest;
    parsed.touched = new Set();
    return parsed;
  } catch {
    return { entries: {}, touched: new Set(), version: 1 };
  }
}

/**
 * Save the cache manifest to disk.
 *
 * With `prune: true`, entries whose key was never touched during this build (deleted/replaced
 * sources, superseded configs) are dropped and their variant files deleted first, so a persisted
 * cache — and the dist copy made from it — stays bounded to images the build actually uses.
 *
 * @param {string} projectRoot
 * @param {CacheManifest} cache
 * @param {{ prune?: boolean }} [options]
 */
export function saveCache(
  projectRoot: string,
  cache: CacheManifest,
  options: { prune?: boolean } = {},
) {
  if (options.prune && cache.touched) {
    pruneStale(cache, cache.touched);
  }
  const cacheDir = getImageCacheDir(projectRoot);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(
    resolve(cacheDir, "manifest.json"),
    JSON.stringify({ entries: cache.entries, version: cache.version }, null, 2),
    "utf8",
  );
}

/**
 * Remove entries (and their variant files) that were not touched during this build. A file shared
 * with a surviving entry is kept — the same source under an older config produces overlapping
 * width/format filenames, so deleting blindly would remove files a live entry still references.
 *
 * @param {CacheManifest} cache
 * @param {Set<string>} touched
 */
function pruneStale(cache: CacheManifest, touched: Set<string>) {
  const keep = new Set<string>();
  const entries = Object.entries<PersistedEntry>(cache.entries);
  for (const [key, entry] of entries) {
    if (touched.has(key)) {
      for (const variant of entry.manifest.variants ?? []) {
        keep.add(variant.absolutePath);
      }
    }
  }
  for (const [key, entry] of entries) {
    if (touched.has(key)) {
      continue;
    }
    for (const variant of entry.manifest.variants ?? []) {
      if (!keep.has(variant.absolutePath)) {
        rmSync(variant.absolutePath, { force: true });
      }
    }
    delete cache.entries[key];
  }
}

// ─── Entry access ─────────────────────────────────────────────────────────────

/**
 * Check if a cache entry exists and its output files are still present.
 *
 * @param {CacheManifest} cache
 * @param {string} key
 * @returns {ImageManifest | null}
 */
export function getCached(cache: CacheManifest, key: string) {
  cache.touched?.add(key);
  const entry = cache.entries[key];
  if (!entry) {
    return null;
  }
  return entry.manifest;
}

/**
 * Store a processed result in the cache.
 *
 * @param {CacheManifest} cache
 * @param {string} key
 * @param {string} sourcePath - Relative source path for reference
 * @param {ImageManifest} manifest
 */
export function setCached(
  cache: CacheManifest,
  key: string,
  sourcePath: string,
  manifest: ImageManifest,
) {
  cache.touched?.add(key);
  cache.entries[key] = {
    manifest,
    source: sourcePath,
    timestamp: Date.now(),
  };
}
