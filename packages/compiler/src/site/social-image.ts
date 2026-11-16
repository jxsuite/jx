/**
 * The size of a page's social image, stated for the crawlers that ask for it.
 *
 * A link preview is drawn before the image has been fetched, so Open Graph's `og:image:width` and
 * `og:image:height` let a consumer reserve the card's box (and decide between a large and a small
 * card) without downloading the picture first. A page states the image (`og:image`) and the build
 * already holds the file, so the two numbers are read from it rather than typed twice and left to
 * drift when the image is replaced (site-architecture.md §8.4.4).
 *
 * Only an image the build can open is measured: one under `public/` or an extension's asset mount,
 * named by a site-absolute path or by an absolute URL under the project's own `url`. A remote
 * image, a `data:` URI, a file that does not exist and one whose header the compiler cannot read
 * are left alone, because a wrong size is worse than none. The author's own `og:image:width` or
 * `og:image:height` always wins.
 *
 * @docs framework/site/seo
 */

import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { getImageMetadata } from "./image-optimizer.ts";
import { resolveImagePath } from "./image-transform.ts";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";

import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { JxHeadEntry } from "@jxsuite/schema/types";

/** What the build knows about where an image named in the head may live. */
export interface SocialImageContext {
  projectRoot: string;
  /** The project's `url`, whose origin and path an absolute `og:image` is read relative to. */
  siteUrl?: string | undefined;
  mounts: readonly AssetMount[];
}

/** Sizes already read, keyed by the file's path, modified time and byte length. */
const sizeCache = new Map<string, { width: number; height: number } | null>();

/**
 * The size of a GIF, from the 10 bytes that carry it. The compiler's native core decodes no GIF
 * (§9.2.3), but the logical screen descriptor is two little-endian words after the signature.
 *
 * @param {string} absolute - Path to a file
 * @returns {{ width: number; height: number } | null} Null when the file is not a GIF
 */
function gifSize(absolute: string): { width: number; height: number } | null {
  const head = new Uint8Array(10);
  const fd = openSync(absolute, "r");
  try {
    if (readSync(fd, head, 0, 10, 0) < 10) {
      return null;
    }
  } finally {
    closeSync(fd);
  }
  const signature = String.fromCodePoint(...head.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    return null;
  }
  const view = new DataView(head.buffer);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  return width > 0 && height > 0 ? { height, width } : null;
}

/**
 * The size of an image file as a viewer sees it, or null when the build cannot tell.
 *
 * @param {string} absolute - Path to the file
 * @returns {Promise<{ width: number; height: number } | null>}
 */
async function readSize(absolute: string): Promise<{ width: number; height: number } | null> {
  const stat = statSync(absolute);
  const key = `${absolute}:${stat.mtimeMs}:${stat.size}`;
  if (sizeCache.has(key)) {
    return sizeCache.get(key) ?? null;
  }
  let size: { width: number; height: number } | null = null;
  try {
    size = gifSize(absolute);
    if (size === null) {
      const { height, width } = await getImageMetadata(absolute);
      size = width > 0 && height > 0 ? { height, width } : null;
    }
  } catch {
    // A header the compiler cannot read (an SVG, an unknown format, no native addon) states no size.
    size = null;
  }
  sizeCache.set(key, size);
  return size;
}

/**
 * The site-absolute path a head value names, or null when it names no file the build can open.
 *
 * @param {string} value - The `og:image` content
 * @param {string | undefined} siteUrl - The project's `url`
 * @returns {string | null}
 */
function localPath(value: string, siteUrl: string | undefined): string | null {
  let path = value.trim();
  const base = siteUrl?.replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) {
    path = path.slice(base.length);
  }
  // `//host/x` is a scheme-relative URL and a bare `x.png` names no site path: neither is ours.
  if (!path.startsWith("/") || path.startsWith("//")) {
    return null;
  }
  path = path.split("#")[0]!.split("?")[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  return path.split("/").includes("..") ? null : path;
}

/**
 * The head with `og:image:width` and `og:image:height` entries after `og:image`, when the build can
 * read that image's size and the author stated neither.
 *
 * @param {JxHeadEntry[]} head - The merged head
 * @param {SocialImageContext} context
 * @returns {Promise<JxHeadEntry[]>} The same array when nothing was added
 */
export async function withSocialImageSize(
  head: JxHeadEntry[],
  context: SocialImageContext,
): Promise<JxHeadEntry[]> {
  const isMeta = (entry: JxHeadEntry, property: string) =>
    isNonNullObject(entry) && entry.tagName === "meta" && entry.attributes?.property === property;
  const at = head.findLastIndex((entry) => isMeta(entry, "og:image"));
  if (at === -1 || head.some((e) => isMeta(e, "og:image:width") || isMeta(e, "og:image:height"))) {
    return head;
  }
  const content = head[at]!.attributes?.content;
  const path = isString(content) ? localPath(content, context.siteUrl) : null;
  if (path === null) {
    return head;
  }
  const absolute = resolveImagePath(path, context.projectRoot, context.mounts);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    return head;
  }
  const size = await readSize(absolute);
  if (size === null) {
    return head;
  }
  const meta = (property: string, value: number): JxHeadEntry => ({
    attributes: { content: String(value), property },
    tagName: "meta",
  });
  return [
    ...head.slice(0, at + 1),
    meta("og:image:width", size.width),
    meta("og:image:height", size.height),
    ...head.slice(at + 1),
  ];
}
