/**
 * Publish-doc-images.ts — put every screenshot at the address the sources name it by.
 *
 * `docs/images/` is a build output (scripts/screenshots/README.md), so neither `README.md` nor a
 * page under `docs/` can point at a file in the repository. They name the published site instead:
 * `https://jxsuite.com/content/docs/images/hero.png`. That is what lets a docs page read on
 * github.com, or in a Markdown editor, show its pictures.
 *
 * The site build does not put the files there by itself. It remaps each such address to the local
 * capture and OPTIMIZES it (parser.md §9.2), so the built pages reference hashed variants and the
 * original PNG is never copied. The README is not compiled at all. A reader of the source needs one
 * URL per picture that stays put across captures.
 *
 * So this runs after `jx build` and copies each image those sources name into the built site at the
 * path they name it by. The list is derived from the sources: reference a picture and it is
 * published, with no second list to forget. `docs:check` and `docs:claims` hold every such
 * reference to a name the screenshot manifest produces.
 *
 * A missing source is a warning, not an error. A local build has no capture unless somebody ran
 * `bun run screenshots`, and the lane that publishes verifies the capture is complete before it
 * builds (`check-image-lock.ts --capture` in deploy-site.yml).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { PUBLISHED_IMAGES_URL } from "../check-image-lock";

const ROOT = resolve(import.meta.dir, "../..");
const MOUNT = "content/docs/images";

const escaped = PUBLISHED_IMAGES_URL.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
/** A screenshot's published address, wherever it appears in a source. */
const PUBLISHED_IMAGE_RE = new RegExp(String.raw`${escaped}([\w-]+\.png)`, "g");

/** The image file names a source addresses on the published site, each once. */
export function publishedImages(source: string): string[] {
  return [
    ...new Set([...source.matchAll(PUBLISHED_IMAGE_RE)].map((match) => match[1]!)),
  ].toSorted();
}

/** Every source that may name a screenshot: the README and each page under `docs/`. */
export function imageSources(root: string = ROOT): string[] {
  const docs = join(root, "docs");
  const pages = existsSync(docs)
    ? [...new Bun.Glob("**/*.md").scanSync({ cwd: docs })].toSorted().map((rel) => join(docs, rel))
    : [];
  return [join(root, "README.md"), ...pages];
}

export interface PublishResult {
  published: string[];
  missing: string[];
}

/** Copy every image the source names from `imagesDir` into `distDir` under the docs mount. */
export function publishDocImages(
  source: string,
  imagesDir: string,
  distDir: string,
): PublishResult {
  const result: PublishResult = { missing: [], published: [] };
  for (const name of publishedImages(source)) {
    const from = join(imagesDir, name);
    if (!existsSync(from)) {
      result.missing.push(name);
      continue;
    }
    const to = join(distDir, MOUNT, name);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    result.published.push(name);
  }
  return result;
}

if (import.meta.main) {
  const source = imageSources()
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const result = publishDocImages(
    source,
    join(ROOT, "docs/images"),
    join(ROOT, "sites/jxsuite.com/dist"),
  );
  if (result.missing.length > 0) {
    console.warn(
      `doc images: ${result.missing.length} image(s) are not captured on this checkout, so the ` +
        `built site will not carry them (${result.missing.slice(0, 3).join(", ")}` +
        `${result.missing.length > 3 ? ", …" : ""}). Run "bun run screenshots" to build with pictures.`,
    );
  }
  console.log(`doc images: ${result.published.length} published under /${MOUNT}/`);
}
