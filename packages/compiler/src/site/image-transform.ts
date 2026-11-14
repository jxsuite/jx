/**
 * Image-transform.js — Document tree walker for responsive image optimization.
 *
 * Walks a Jx document tree, finds <img> nodes with static src paths, and injects srcset, sizes,
 * width, height, loading, and decoding attributes. Collects image references so the build
 * orchestrator knows which files to process.
 *
 * Two passes, deliberately separable. The **loading** pass (`images.lazyLoad`) runs on every image
 * in every project, because deciding not to optimize an image says nothing about when to fetch it.
 * The **variant** pass (`images.optimize`) is the expensive half and is the one the master switch
 * turns off.
 *
 * A third, cheap pass runs on every image too: a picture whose own file names a **focal point**
 * (studio.md §22.6, an IPTC Image Region read by `@jxsuite/site/xmp-packet`) is given it as its
 * `object-position`, unless the author set one, so any `object-fit` crop keeps that point in view.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import {
  buildSrcset,
  contentHash,
  getImageMetadata,
  processImage,
  variantUrl,
} from "./image-optimizer.ts";
import { cacheKey, getCached, getImageCacheDir, setCached } from "./image-cache.ts";
import { imgLoadingAttrs } from "./img-loading.ts";
import { resolveAssetUrl } from "@jxsuite/schema/asset-paths";
import { isNodeObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { extractXmp, xmpFormatOf } from "@jxsuite/site/xmp-containers";
import { readMediaRecord } from "@jxsuite/site/xmp-packet";

import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { ImageConfig, ImageManifest, ImageVariant } from "./image-optimizer.ts";
import type { JxAttributeValue, JxDocument, JxMutableNode, JxStyle } from "@jxsuite/schema/types";
import type { CacheManifest } from "./image-cache.ts";

/**
 * The local sources the variant pass takes: the extensions of the formats the compiler's native
 * core decodes (JPEG, PNG, WebP, TIFF and BMP; `crates/jx_media` in `@jxsuite/compiler-binding`).
 * Anything else, or no extension at all, is left alone: a `.ico`, a `.heic` or an upload with no
 * extension used to reach the encoder, fail to decode, and fail every route whose layout held it.
 * Every GIF is outside it, animated or not (site-architecture.md §9.2.3).
 */
const RASTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"]);
/**
 * Local sources the build service serves as written, and the Cloudflare service still resizes: the
 * native core has no AVIF decoder and nothing better to convert one to, while Cloudflare reads it.
 */
const ENCODED_AS_WRITTEN = new Set([".avif"]);
/**
 * What an allowlisted remote source is refused for. A denylist, because a remote URL often has no
 * extension at all and Cloudflare decodes more than the build service does.
 */
const REMOTE_SKIP_EXTENSIONS = new Set([".svg", ".gif"]);
const EXTERNAL_PREFIXES = ["http://", "https://", "data:", "//"];

/** Per-build memo of original image dimensions + content hash (cloudflare mode). */
export type ImageMetaCache = Map<
  string,
  { width: number | null; height: number | null; hash: string }
>;

let dimensionsWarned = false;

/**
 * Resolve original image dimensions and content hash for cloudflare mode. Reads only the image
 * header — no variants are generated. Dimensions degrade to null when the header cannot be read (a
 * format the compiler does not decode, or no native addon for this platform): srcsets are still
 * emitted (fit=scale-down guards against upscaling), only the width/height attributes are skipped.
 *
 * @param {string} absoluteSrc
 * @param {ImageMetaCache} metaCache
 * @returns {Promise<{ width: number | null; height: number | null; hash: string }>}
 */
async function resolveCfMeta(absoluteSrc: string, metaCache: ImageMetaCache) {
  let meta = metaCache.get(absoluteSrc);
  if (!meta) {
    const hash = contentHash(absoluteSrc);
    try {
      const m = await getImageMetadata(absoluteSrc);
      meta = { width: m.width, height: m.height, hash };
    } catch (error) {
      if (!dimensionsWarned) {
        dimensionsWarned = true;
        console.warn(
          `Could not read image dimensions (${errorMessage(error)}) — ` +
            `emitting srcsets without width/height attributes.`,
        );
      }
      meta = { width: null, height: null, hash };
    }
    metaCache.set(absoluteSrc, meta);
  }
  return meta;
}

/**
 * Build a srcset of Cloudflare `/cdn-cgi/image/` transform-via-URL entries for the configured
 * widths that fit within the original image width. `format=auto` lets Cloudflare negotiate
 * AVIF/WebP per browser; `fit=scale-down` guards against upscaling. Requires Image Transformations
 * to be enabled on the serving zone (does not work on *.pages.dev).
 *
 * @param {string} src - Site-relative src (e.g. "/images/hero.png") or allowlisted https URL
 * @param {ImageConfig} config
 * @param {number} originalWidth
 * @param {string | null} hash - 8-char content hash for cache busting (null for remote sources,
 *   whose bytes aren't available at build time)
 * @returns {string}
 */
function buildCloudflareSrcset(
  src: string,
  config: ImageConfig,
  originalWidth: number,
  hash: string | null,
) {
  const quality = config.quality.webp ?? 80;
  const separator = src.startsWith("/") ? "" : "/";
  const suffix = hash ? `?v=${hash}` : "";
  const path = srcsetSafe(src);
  return config.widths
    .filter((w) => w <= originalWidth)
    .toSorted((a, b) => a - b)
    .map(
      (w) =>
        `/cdn-cgi/image/width=${w},quality=${quality},fit=scale-down,format=auto` +
        `${separator}${path}${suffix} ${w}w`,
    )
    .join(", ");
}

/**
 * An authored `src` made safe to stand as a `srcset` candidate: whitespace and commas encoded,
 * everything else as written. A `src` attribute tolerates a space, but a `srcset` splits on it.
 * Only those characters are touched, because an author's `src` may already be percent-encoded and
 * encoding it whole would encode its `%` a second time.
 *
 * @param {string} src
 * @returns {string}
 */
function srcsetSafe(src: string) {
  return src.replaceAll(/[\s,]/g, (char) => encodeURIComponent(char));
}

/**
 * @param {string} absoluteSrc
 * @param {string} src
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {CacheManifest} cache
 * @returns {Promise<ImageManifest>}
 */
async function resolveManifest(
  absoluteSrc: string,
  src: string,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest,
) {
  const key = cacheKey(absoluteSrc, config);
  const cached = getCached(cache, key);

  if (cached) {
    const allExist = cached.variants.every((v) => existsSync(v.absolutePath));
    if (allExist) {
      return cached;
    }
  }

  if (!cached) {
    console.log(`    Optimizing ${basename(absoluteSrc)}...`);
  }
  const manifest = await processImage(absoluteSrc, getImageCacheDir(projectRoot), config);
  setCached(cache, key, src, manifest);
  return manifest;
}

/**
 * Check if a src value should be skipped for optimization.
 *
 * @param {string} src
 * @returns {boolean}
 */
function shouldSkip(src: string) {
  if (!src) {
    return true;
  }
  if (src.includes("${")) {
    return true;
  }
  if (EXTERNAL_PREFIXES.some((p) => src.startsWith(p))) {
    return true;
  }
  const extension = extname(src).toLowerCase();
  return !RASTER_EXTENSIONS.has(extension) && !ENCODED_AS_WRITTEN.has(extension);
}

/**
 * Check if a remote src is eligible for cloudflare-service optimization: an https URL whose
 * hostname is in the project's `images.remoteDomains` allowlist. Content data (e.g. CSV columns)
 * routinely references externally hosted images — allowlisted hosts flow through the /cdn-cgi/image
 * transform URL like local assets; everything else passes through untouched. The zone must permit
 * resizing from the remote origin (Images → Transformations → Sources).
 *
 * @param {string} src
 * @param {ImageConfig} config
 * @returns {boolean}
 */
function isAllowedRemote(src: string, config: ImageConfig) {
  if (config.service !== "cloudflare") {
    return false;
  }
  if (!config.remoteDomains?.length) {
    return false;
  }
  if (!src.startsWith("https://")) {
    return false;
  }
  if (src.includes("${")) {
    return false;
  }
  try {
    const url = new URL(src);
    if (REMOTE_SKIP_EXTENSIONS.has(extname(url.pathname).toLowerCase())) {
      return false;
    }
    return config.remoteDomains.includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve a src path to an absolute filesystem path.
 *
 * Extension asset mounts win first — they publish directories that may sit outside the project root
 * (extensions.md §8.5), so a mounted src has no other resolution. Otherwise paths starting with "/"
 * resolve into `public/`, and relative ones from the project root.
 *
 * @param {string} src
 * @param {string} projectRoot
 * @param {readonly AssetMount[]} [mounts]
 * @returns {string}
 */
function resolveImagePath(src: string, projectRoot: string, mounts?: readonly AssetMount[]) {
  const mounted = mounts?.length ? resolveAssetUrl(mounts, src) : null;
  if (mounted) {
    return mounted;
  }
  if (src.startsWith("/")) {
    return resolve(projectRoot, "public", src.slice(1));
  }
  return resolve(projectRoot, src);
}

/** Focal points already read, keyed by the file's path, modified time and size. */
const focusCache = new Map<string, string | null>();

/** A fraction as a CSS percentage, to one decimal place. */
function percent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/**
 * The `object-position` a picture's own focal point asks for, or `null` when the file names none,
 * cannot hold one, or cannot be read. A file whose metadata does not parse is a picture, not a
 * broken build: it is drawn as it was before it had a focal point.
 */
function focusPosition(absolute: string): string | null {
  const format = xmpFormatOf(absolute);
  if (format === null) {
    return null;
  }
  let stamp: string;
  try {
    const stat = statSync(absolute);
    stamp = `${absolute}|${stat.mtimeMs}|${stat.size}`;
  } catch {
    return null;
  }
  const cached = focusCache.get(stamp);
  if (cached !== undefined) {
    return cached;
  }
  let position: string | null = null;
  try {
    const bytes = new Uint8Array(readFileSync(absolute));
    const { focus } = readMediaRecord(extractXmp(bytes, format));
    position = focus === null ? null : `${percent(focus.x)} ${percent(focus.y)}`;
  } catch {
    position = null;
  }
  focusCache.set(stamp, position);
  return position;
}

/**
 * Give an `<img>` its file's focal point as `object-position`. The author's own `objectPosition`
 * wins, a style written as something other than an object is left alone, and a bound, remote or
 * inline `src` names no file to read.
 */
function applyFocalPoint(
  node: JxMutableNode | JxDocument,
  src: JxAttributeValue | undefined,
  projectRoot: string,
  mounts: readonly AssetMount[],
): void {
  if (!isString(src) || src === "" || src.includes("${")) {
    return;
  }
  if (EXTERNAL_PREFIXES.some((prefix) => src.startsWith(prefix))) {
    return;
  }
  const { style } = node;
  if (style !== undefined && !isNonNullObject(style)) {
    return;
  }
  if (style?.objectPosition !== undefined) {
    return;
  }
  const [path = ""] = src.split(/[?#]/);
  const position = focusPosition(resolveImagePath(path, projectRoot, mounts));
  if (position !== null) {
    node.style = { ...style, objectPosition: position };
  }
}

/**
 * Transform image nodes in a Jx document tree.
 *
 * Mutates img nodes in place, injecting srcset, sizes, width, height, loading, and decoding.
 * Optimized variants are written to the image cache's `_optimized/` (`getImageCacheDir`), and the
 * build copies the ones it used into the dist directory after all pages are compiled.
 *
 * @param {JxMutableNode | JxDocument} doc - The Jx document tree (mutated in place)
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {CacheManifest | null} cache - Variant cache (build mode); unused in cloudflare mode
 * @param {ImageMetaCache} [metaCache] - Dimension/hash memo (cloudflare mode)
 * @param {readonly AssetMount[]} [mounts] - Extension asset mounts (extensions.md §8.5)
 * @returns {Promise<{ imageRefs: Map<string, ImageManifest> }>}
 */
export async function transformImageNodes(
  doc: JxMutableNode | JxDocument,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest | null,
  metaCache?: ImageMetaCache,
  mounts: readonly AssetMount[] = [],
) {
  const imageRefs = new Map<string, ImageManifest>();
  const meta = metaCache ?? new Map();
  await walkAndTransform(doc, config, projectRoot, cache, meta, imageRefs, mounts);
  return { imageRefs };
}

async function walkAndTransform(
  node: JxMutableNode | JxDocument,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest | null,
  metaCache: ImageMetaCache,
  imageRefs: Map<string, ImageManifest>,
  mounts: readonly AssetMount[],
  containerWidth: number | null = null,
) {
  if (node.tagName === "img") {
    const wrapped = await transformImgNode(
      node,
      config,
      projectRoot,
      cache,
      metaCache,
      imageRefs,
      mounts,
      containerWidth,
    );
    // Wrapping rewrote this node into a `<picture>` whose children this pass just authored.
    // Descending into them would find the `<img>` and wrap it again, forever.
    if (wrapped) {
      return;
    }
  }

  // A document is authored JSON, so `innerHTML` is checked rather than trusted to be a string.
  if (isString(node.innerHTML) && node.innerHTML.includes("<img")) {
    node.innerHTML = await transformInnerHtmlImages(
      node.innerHTML,
      config,
      projectRoot,
      cache,
      metaCache,
      imageRefs,
      mounts,
      // The node holding the content is the innermost container of every image in it.
      containerWidthOf(node, containerWidth),
    );
  }

  if (Array.isArray(node.children)) {
    // Every descendant is bounded by the narrowest literal max-width or width above it.
    const inner = containerWidthOf(node, containerWidth);
    for (const child of node.children) {
      // Text children carry no images, and a non-object child (an authored `null`) is skipped.
      if (!isNodeObject(child)) {
        continue;
      }
      await walkAndTransform(
        child,
        config,
        projectRoot,
        cache,
        metaCache,
        imageRefs,
        mounts,
        inner,
      );
    }
  }
}

/** A `<source>` in a generated `<picture>`: one image format, one candidate list. */
interface PictureSource {
  type: string;
  srcset: string;
}

/**
 * Formats in the order a browser should be offered them — best compression first. A `<picture>`
 * takes the FIRST source it can decode, so this order is the whole negotiation.
 */
const PICTURE_FORMAT_ORDER: readonly string[] = ["avif", "webp", "jpeg", "png"];
const MEDIA_TYPES = new Map<string, string>([
  ["avif", "image/avif"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
]);

interface ResolvedVariants {
  /** Candidate list for the `<img>` itself, in the preferred format. */
  srcset: string;
  dims: { width: number; height: number } | null;
  /** One entry per additional format, when the image is to be wrapped in a `<picture>`. */
  sources: PictureSource[];
  /** Resized last-resort `src`, when a universally decodable format was emitted. */
  fallbackSrc?: string | undefined;
}

/**
 * Generate (or look up) this image's variants and describe what the markup should say.
 *
 * Returns null whenever the image is not ours to touch — a bound `src`, an SVG, a remote URL off
 * the allowlist, a missing file, an explicit `data-no-optimize`, an authored `srcset`. Both callers
 * treat null the same way: leave the markup alone apart from the loading attributes.
 *
 * @param {JxAttributeValue | undefined} src - The `src` as written, which may be bound or absent
 * @param {boolean} optedOut - `data-no-optimize` or an authored `srcset` is present
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {CacheManifest | null} cache
 * @param {ImageMetaCache} metaCache
 * @param {Map<string, ImageManifest>} imageRefs
 * @param {readonly AssetMount[]} mounts
 * @returns {Promise<ResolvedVariants | null>}
 */
async function resolveVariants(
  src: JxAttributeValue | undefined,
  optedOut: boolean,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest | null,
  metaCache: ImageMetaCache,
  imageRefs: Map<string, ImageManifest>,
  mounts: readonly AssetMount[],
): Promise<ResolvedVariants | null> {
  // Bound ($ref) or missing srcs cannot be optimized at build time.
  if (!isString(src) || optedOut) {
    return null;
  }
  const remote = isAllowedRemote(src, config);
  if (!remote && shouldSkip(src)) {
    return null;
  }

  if (remote) {
    // Original dimensions are unknown without fetching — emit every configured width and let
    // Fit=scale-down avoid upscaling past the source size.
    return { dims: null, sources: [], srcset: buildCloudflareSrcset(src, config, Infinity, null) };
  }

  const absoluteSrc = resolveImagePath(src, projectRoot, mounts);
  if (!existsSync(absoluteSrc)) {
    return null;
  }

  if (config.service === "cloudflare") {
    // Cloudflare negotiates the format itself (`format=auto`), so there is nothing for a
    // `<picture>` to choose between.
    const meta = await resolveCfMeta(absoluteSrc, metaCache);
    const srcset = buildCloudflareSrcset(src, config, meta.width ?? Infinity, meta.hash);
    const dims = meta.width && meta.height ? { height: meta.height, width: meta.width } : null;
    return { dims, sources: [], srcset };
  }

  // An AVIF source is already in the best format every variant would be converted to.
  if (ENCODED_AS_WRITTEN.has(extname(absoluteSrc).toLowerCase())) {
    return null;
  }

  let manifest = imageRefs.get(absoluteSrc);
  if (!manifest) {
    manifest = await resolveManifest(absoluteSrc, src, config, projectRoot, cache!);
    imageRefs.set(absoluteSrc, manifest);
  }

  /*
   * The project's own formats, best-compression first. A format the project did not ask for is not
   * offered even if a stale manifest happens to hold variants of it, and one this order does not
   * know keeps the position the project gave it.
   */
  const asked = writtenFormats(config.formats, manifest.variants);
  const ordered = [
    ...PICTURE_FORMAT_ORDER.filter((format) => asked.includes(format)),
    ...asked.filter((format) => !PICTURE_FORMAT_ORDER.includes(format)),
  ];
  const available = ordered.flatMap((format): PictureSource[] => {
    const srcset = buildSrcset(manifest.variants, format);
    return srcset === "" ? [] : [{ srcset, type: MEDIA_TYPES.get(format) ?? `image/${format}` }];
  });

  const dims =
    manifest.original?.width && manifest.original.height
      ? { height: manifest.original.height, width: manifest.original.width }
      : null;
  /*
   * One format needs no negotiation, and a srcset in the single format the project asked for is
   * both smaller markup and the historical behaviour. Two or more do: `srcset` alone carries no
   * format information, so a browser that cannot decode AVIF would still pick an AVIF candidate.
   */
  const wrap = config.picture !== false && available.length > 1;
  return {
    dims,
    fallbackSrc: fallbackVariant(manifest.variants, asked),
    sources: wrap ? available : [],
    srcset: available[0]?.srcset ?? "",
  };
}

/**
 * The formats to offer for one image: the project's, with PNG added where it stands in for JPEG.
 *
 * JPEG has no alpha channel, so the encoder writes PNG wherever JPEG was asked of a source with
 * transparency (site-architecture.md §9.2.2). That PNG was asked for, under another name, and is
 * offered; any other format the project did not list stays out even if a stale manifest holds
 * variants of it.
 */
function writtenFormats(formats: readonly string[], variants: ImageVariant[]): readonly string[] {
  const standsIn =
    formats.includes("jpeg") &&
    !formats.includes("png") &&
    variants.some((variant) => variant.format === "png") &&
    !variants.some((variant) => variant.format === "jpeg");
  return standsIn ? [...formats, "png"] : formats;
}

/**
 * Formats an `<img src>` may point at without narrowing who can see the image.
 *
 * `src` is the last resort — reached only by a client that understood neither `srcset` nor any
 * `<source type>`, which in practice means it understands JPEG and PNG and little else.
 */
const UNIVERSAL_FORMATS: readonly string[] = ["jpeg", "png"];

/**
 * The largest emitted variant a `src` can safely fall back to, or `undefined` to keep the original.
 *
 * The original is a correct fallback and a terrible one: it is the unresized source, so a 3840 px
 * screenshot leaves a 1.7 MB PNG on the end of the chain. A resized variant of the same universally
 * decodable format is strictly better. When the project emits no such format — `["webp", "avif"]`
 * is a common and reasonable choice — there is nothing safe to point at, and the original stays: a
 * smaller image nobody can decode is not an improvement.
 */
function fallbackVariant(variants: ImageVariant[], formats: readonly string[]): string | undefined {
  const format = UNIVERSAL_FORMATS.find(
    (candidate) =>
      formats.includes(candidate) && variants.some((variant) => variant.format === candidate),
  );
  if (format === undefined) {
    return undefined;
  }
  let best: ImageVariant | undefined;
  for (const variant of variants) {
    if (variant.format === format && (best === undefined || variant.width > best.width)) {
      best = variant;
    }
  }
  return best && variantUrl(best.outputPath);
}

const CSS_LENGTH = /^(\d+(?:\.\d+)?)(px|rem)$/;

/** A CSS length in px, but only when it is a plain `px`/`rem` literal. `null` for anything else. */
function pxLength(value: JxStyle[string]): number | null {
  if (!isString(value)) {
    return null;
  }
  const match = CSS_LENGTH.exec(value.trim());
  if (!match) {
    return null;
  }
  const n = Number(match[1]);
  return match[2] === "rem" ? n * 16 : n;
}

/**
 * The narrowest literal `max-width` or `width` this element declares in its base `style`, or the
 * inherited bound when that is narrower. Nested blocks are not read (site-architecture.md §9.2.2).
 *
 * Only literal lengths count. A `clamp()`, a percentage or a custom property is a real constraint
 * too, but not one the build can resolve — and a wrong `sizes` is worse than none, because the
 * browser trusts it completely and picks its candidate before layout exists to contradict it.
 */
function containerWidthOf(
  node: JxMutableNode | JxDocument,
  inherited: number | null,
): number | null {
  // Authored JSON: a `style` that is not an object (a CSS string, say) declares no width here.
  const { style } = node;
  if (!isNonNullObject(style)) {
    return inherited;
  }
  let narrowest = inherited;
  for (const declared of [pxLength(style.maxWidth), pxLength(style.width)]) {
    if (declared !== null && (narrowest === null || declared < narrowest)) {
      narrowest = declared;
    }
  }
  return narrowest;
}

/**
 * The `sizes` an image in a `max-width` container needs.
 *
 * `sizes` is a promise about layout, and the browser keeps the browser's side of it absolutely: it
 * picks a candidate from this string before any layout has happened, and never revisits the choice.
 * A single project-wide string therefore cannot be right — jxsuite.com's `(max-width: 768px) 100vw,
 * 50vw` describes a half-width image, while its hero renders full-width inside a 960 px column, so
 * the same string is too small on a wide screen and too large on a narrow one. The container width
 * is layout the compiler already holds, so it is the better answer wherever it exists.
 */
function sizesForContainer(containerWidth: number | null): string | undefined {
  if (containerWidth === null) {
    return undefined;
  }
  const width = Math.round(containerWidth);
  return `(max-width: ${width}px) 100vw, ${width}px`;
}

async function transformImgNode(
  node: JxMutableNode | JxDocument,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest | null,
  metaCache: ImageMetaCache,
  imageRefs: Map<string, ImageManifest>,
  mounts: readonly AssetMount[],
  containerWidth: number | null = null,
): Promise<boolean> {
  if (!node.attributes) {
    node.attributes = {};
  }
  const attrs = node.attributes;
  /*
   * A node-level `src` is normalized into `attributes` first. The static emitter only renders a
   * fixed set of node-level DOM properties and `src` is not among them, so an image written that
   * way used to acquire a `srcset` and lose its `src` — the fallback the srcset exists to have.
   */
  if (attrs.src === undefined && isString(node.src)) {
    attrs.src = node.src;
    delete node.src;
  }
  applyFocalPoint(node, attrs.src, projectRoot, mounts);

  const variants = config.optimize
    ? await resolveVariants(
        attrs.src,
        // An image that already carries a candidate list is its author's, as in the innerHTML half.
        attrs["data-no-optimize"] !== undefined || attrs.srcset !== undefined,
        config,
        projectRoot,
        cache,
        metaCache,
        imageRefs,
        mounts,
      )
    : null;

  /*
   * Precedence: what the author wrote, then what the layout says, then the project-wide default.
   * The project default is a guess that cannot see the container; the container width is not a
   * guess, so it outranks it — and an image with neither keeps whatever the project chose.
   */
  const ownWidth = containerWidthOf(node, containerWidth);
  const resolvedSizes = attrs.sizes ?? sizesForContainer(ownWidth) ?? config.sizes;

  if (variants) {
    if (variants.srcset !== "") {
      attrs.srcset = variants.srcset;
      if (resolvedSizes !== undefined) {
        attrs.sizes = resolvedSizes;
      }
      if (variants.fallbackSrc !== undefined) {
        attrs.src = variants.fallbackSrc;
      }
    }
    // Intrinsic dimensions prevent layout shift; author-supplied values win.
    if (variants.dims && attrs.width === undefined && attrs.height === undefined) {
      attrs.width = String(variants.dims.width);
      attrs.height = String(variants.dims.height);
    }
  }

  Object.assign(attrs, imgLoadingAttrs(attrs, config.lazyLoad));

  if (variants && variants.sources.length > 0) {
    wrapInPicture(node, variants.sources, resolvedSizes);
    return true;
  }
  return false;
}

/**
 * Turn an `<img>` node into a `<picture>` wrapping it, one `<source>` per format.
 *
 * The `<img>` keeps everything that describes the image — `src`, `alt`, dimensions, styles, the
 * loading attributes — and loses `srcset`/`sizes`, which now live on the sources. That is what
 * makes it a real fallback: a browser that matches no `<source>` gets the original file, not a
 * candidate list in a format it just declined.
 *
 * @param {JxMutableNode | JxDocument} node - The `<img>` node, mutated into a `<picture>`
 * @param {PictureSource[]} sources
 * @param {JxAttributeValue | undefined} sizes - The resolved `sizes`, when anything names one
 */
function wrapInPicture(
  node: JxMutableNode | JxDocument,
  sources: readonly PictureSource[],
  sizes: JxAttributeValue | undefined,
) {
  const imgAttrs = { ...node.attributes };
  const inheritedSizes = imgAttrs.sizes ?? sizes;
  delete imgAttrs.srcset;
  delete imgAttrs.sizes;
  const img: JxMutableNode = { attributes: imgAttrs, tagName: "img" };
  if (node.style !== undefined) {
    img.style = node.style;
    delete node.style;
  }

  const children = sources.map((source): JxMutableNode => {
    const attributes: Record<string, JxAttributeValue> = {};
    // An empty `sizes` is not a neutral default — omit it and let the browser assume 100vw.
    if (inheritedSizes !== undefined && inheritedSizes !== "") {
      attributes.sizes = inheritedSizes;
    }
    attributes.srcset = source.srcset;
    attributes.type = source.type;
    return { attributes, tagName: "source" };
  });
  children.push(img);

  node.tagName = "picture";
  node.attributes = {};
  node.children = children;
}

const IMG_TAG_RE = /<img\b([^>]*)>/gi;
const DATA_NO_OPT_RE = /\bdata-no-optimize\b/;
const SRC_ATTR_RE = /(^|\s)src="[^"]*"/i;
const SIZES_ATTR_RE = /(?:^|\s)sizes="[^"]*"/i;

/**
 * Transform `<img>` tags embedded in pre-rendered innerHTML strings, by the rules
 * {@link transformImgNode} applies to a node: the same eligibility, the same `src` fallback, the
 * same `sizes` order. A rule added to one half is added to the other (site-architecture.md
 * §9.2.2).
 *
 * @param {string} html
 * @param {ImageConfig} config
 * @param {string} projectRoot
 * @param {CacheManifest | null} cache
 * @param {ImageMetaCache} metaCache
 * @param {Map<string, ImageManifest>} imageRefs
 * @param {readonly AssetMount[]} mounts
 * @param {number | null} containerWidth - The bound of the node holding this HTML
 * @returns {Promise<string>}
 */
async function transformInnerHtmlImages(
  html: string,
  config: ImageConfig,
  projectRoot: string,
  cache: CacheManifest | null,
  metaCache: ImageMetaCache,
  imageRefs: Map<string, ImageManifest>,
  mounts: readonly AssetMount[],
  containerWidth: number | null,
) {
  const replacements: { match: string; replacement: string }[] = [];

  for (const m of html.matchAll(IMG_TAG_RE)) {
    const tag = m[0]!;
    const attrs = m[1]!;

    // Attribute values in pre-rendered innerHTML are entity-escaped — decode for processing
    const src = (attrValue(attrs, "src") ?? "").replaceAll("&amp;", "&");
    const variants =
      config.optimize && src !== ""
        ? await resolveVariants(
            src,
            // An image that already carries a candidate list is its author's.
            DATA_NO_OPT_RE.test(attrs) || hasAttr(attrs, "srcset"),
            config,
            projectRoot,
            cache,
            metaCache,
            imageRefs,
            mounts,
          )
        : null;

    // The tag, then the layout, then the project: the order the node half resolves `sizes` in.
    const ownSizes = attrValue(attrs, "sizes");
    const resolvedSizes = ownSizes ?? sizesForContainer(containerWidth) ?? config.sizes;

    let written = attrs;
    let extra = "";
    if (variants && variants.srcset !== "") {
      extra += ` srcset="${variants.srcset}"`;
      if (ownSizes === undefined && resolvedSizes !== undefined && resolvedSizes !== "") {
        extra += ` sizes="${resolvedSizes}"`;
      }
      const { fallbackSrc } = variants;
      if (fallbackSrc !== undefined) {
        written = attrs.replace(
          SRC_ATTR_RE,
          (_match, space: string) => `${space}src="${fallbackSrc}"`,
        );
      }
    }
    if (variants?.dims && !hasAttr(attrs, "width") && !hasAttr(attrs, "height")) {
      extra += ` width="${variants.dims.width}" height="${variants.dims.height}"`;
    }
    const loading = imgLoadingAttrs(
      {
        decoding: attrValue(attrs, "decoding"),
        fetchpriority: attrValue(attrs, "fetchpriority"),
        loading: attrValue(attrs, "loading"),
      },
      config.lazyLoad,
    );
    for (const [key, value] of Object.entries(loading)) {
      extra += ` ${key}="${value}"`;
    }

    if (extra === "") {
      continue;
    }

    const img =
      variants && variants.sources.length > 0
        ? renderPictureTag(written, variants.sources, resolvedSizes, extra)
        : `<img${written}${extra}>`;
    replacements.push({ match: tag, replacement: img });
  }

  let result = html;
  for (const { match, replacement } of replacements) {
    result = result.replace(match, replacement);
  }
  return result;
}

/**
 * The string-surgery twin of {@link wrapInPicture}: the same markup, built from a raw attribute
 * string rather than a node. `srcset`/`sizes` stay off the `<img>` so it remains a real fallback.
 *
 * @param {string} attrs - The original tag's attribute string
 * @param {readonly PictureSource[]} sources
 * @param {string | undefined} sizes - The resolved `sizes`, the tag's own included
 * @param {string} extra - Attributes this pass decided to add
 * @returns {string}
 */
function renderPictureTag(
  attrs: string,
  sources: readonly PictureSource[],
  sizes: string | undefined,
  extra: string,
) {
  const imgAttrs = attrs.replace(SIZES_ATTR_RE, "");
  const imgExtra = extra.replace(/ srcset="[^"]*"/, "").replace(/ sizes="[^"]*"/, "");
  // An empty `sizes` is not a neutral default: leave it off and the browser assumes 100vw.
  const sizesAttr = sizes === undefined || sizes === "" ? "" : ` sizes="${sizes}"`;
  const sourceTags = sources
    .map((s) => `<source type="${s.type}" srcset="${s.srcset}"${sizesAttr}>`)
    .join("");
  return `<picture>${sourceTags}<img${imgAttrs}${imgExtra}></picture>`;
}

/**
 * Read one double-quoted attribute out of a raw tag attribute string. The name is matched whole:
 * `data-src` is not `src`.
 *
 * @param {string} attrs
 * @param {string} name
 * @returns {string | undefined}
 */
function attrValue(attrs: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i").exec(attrs)?.[1];
}

/**
 * Whether a raw tag attribute string sets an attribute. The name is matched whole: a lazy-loader's
 * `data-srcset` is not an authored `srcset`, and `data-width` is not `width`.
 *
 * @param {string} attrs
 * @param {string} name
 * @returns {boolean}
 */
function hasAttr(attrs: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}=`, "i").test(attrs);
}
