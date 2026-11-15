/**
 * Publish-readme-images.ts — give the README's pictures an address.
 *
 * `docs/images/` is a build output (scripts/screenshots/README.md), so `README.md` cannot point at
 * a file in the repository. It names the published site instead:
 * `https://jxsuite.com/content/docs/images/hero.png`, the same path a site page reaches a
 * screenshot through. But the compiler only republishes an image under that mount when a page
 * references it un-optimised, and the hero is optimised into hashed variants whose names change
 * with every capture. A README needs one URL that stays put.
 *
 * So this runs after `jx build` and copies each image the README names into the built site at the
 * path the README names it by. The list is derived from the README: add a picture there and it is
 * published, with no second list to forget. `docs:claims` holds every such reference to a name the
 * screenshot manifest produces.
 *
 * A missing source is a warning, not an error. A local build has no capture unless somebody ran
 * `bun run screenshots`, and the lane that publishes verifies the capture is complete before it
 * builds (`check-image-lock.ts --capture` in deploy-site.yml).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const MOUNT = "content/docs/images";

/** `https://jxsuite.com/content/docs/images/<name>.png`, as written in the README. */
const README_IMAGE_RE = /https:\/\/jxsuite\.com\/content\/docs\/images\/([\w-]+\.png)/g;

/** The image file names a README source addresses on the published site, each once. */
export function readmeImages(source: string): string[] {
  return [...new Set([...source.matchAll(README_IMAGE_RE)].map((match) => match[1]!))].toSorted();
}

export interface PublishResult {
  published: string[];
  missing: string[];
}

/** Copy every image the README names from `imagesDir` into `distDir` under the docs mount. */
export function publishReadmeImages(
  source: string,
  imagesDir: string,
  distDir: string,
): PublishResult {
  const result: PublishResult = { missing: [], published: [] };
  for (const name of readmeImages(source)) {
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
  const result = publishReadmeImages(
    readFileSync(join(ROOT, "README.md"), "utf8"),
    join(ROOT, "docs/images"),
    join(ROOT, "sites/jxsuite.com/dist"),
  );
  for (const name of result.missing) {
    console.warn(
      `readme images: docs/images/${name} is not captured on this checkout, so the built site ` +
        `will not carry it. Run "bun run screenshots" to build with pictures.`,
    );
  }
  console.log(`readme images: ${result.published.length} published under /${MOUNT}/`);
}
