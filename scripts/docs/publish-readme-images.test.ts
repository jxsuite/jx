/**
 * The README's pictures are build outputs with no address in the repository, so the README names
 * the published site and the site build has to put each picture where the README says it is. These
 * hold the two halves to each other: the names are derived from the README's own text, and a
 * picture this checkout does not hold is reported rather than fatal.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { manifestImageNames } from "../check-image-lock";
import { publishReadmeImages, readmeImages } from "./publish-readme-images.ts";

const ROOT = resolve(import.meta.dir, "../..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

describe("readmeImages", () => {
  test("reads each published image address once, and nothing else", () => {
    const source = [
      '<img src="https://jxsuite.com/content/docs/images/hero.png" alt="x">',
      "![again](https://jxsuite.com/content/docs/images/hero.png)",
      "![other](https://jxsuite.com/content/docs/images/git-panel.png)",
      "![elsewhere](https://example.com/content/docs/images/nope.png)",
      "![relative](docs/images/nope.png)",
    ].join("\n");
    expect(readmeImages(source)).toEqual(["git-panel.png", "hero.png"]);
  });

  test("the README names no picture in the repository, and only ones a shot produces", () => {
    // A repository-relative path would render as a broken image: docs/images is not committed.
    expect(README).not.toMatch(/src="docs\/images\//);
    expect(README).not.toMatch(/\]\(docs\/images\//);
    const names = readmeImages(README);
    expect(names.length).toBeGreaterThan(0);
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "scripts/screenshots/manifest.json"), "utf8"),
    );
    const producible = manifestImageNames(manifest);
    for (const name of names) {
      expect({ name, producible: producible.has(name.replace(/\.png$/, "")) }).toEqual({
        name,
        producible: true,
      });
    }
  });
});

describe("publishReadmeImages", () => {
  test("copies what is captured to the path the README names, and reports what is not", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-readme-images-"));
    const images = join(root, "images");
    const dist = join(root, "dist");
    mkdirSync(images);
    writeFileSync(join(images, "hero.png"), "png-bytes");
    const source =
      "https://jxsuite.com/content/docs/images/hero.png " +
      "https://jxsuite.com/content/docs/images/absent.png";
    const result = publishReadmeImages(source, images, dist);
    expect(result).toEqual({ missing: ["absent.png"], published: ["hero.png"] });
    expect(readFileSync(join(dist, "content/docs/images/hero.png"), "utf8")).toBe("png-bytes");
    expect(existsSync(join(dist, "content/docs/images/absent.png"))).toBe(false);
  });
});
