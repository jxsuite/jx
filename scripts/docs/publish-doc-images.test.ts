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

import { capturedImageNames, manifestImageNames, readShots } from "../check-image-lock";
import { imageSources, publishDocImages, publishedImages } from "./publish-doc-images.ts";

const ROOT = resolve(import.meta.dir, "../..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");

describe("publishedImages", () => {
  test("reads each published image address once, and nothing else", () => {
    const source = [
      '<img src="https://jxsuite.com/content/docs/images/hero.png" alt="x">',
      "![again](https://jxsuite.com/content/docs/images/hero.png)",
      "![other](https://jxsuite.com/content/docs/images/git-panel.png)",
      "![elsewhere](https://example.com/content/docs/images/nope.png)",
      "![relative](docs/images/nope.png)",
    ].join("\n");
    expect(publishedImages(source)).toEqual(["git-panel.png", "hero.png"]);
  });

  test("the README names no picture in the repository, and only ones a shot produces", () => {
    // A repository-relative path would render as a broken image: docs/images is not committed.
    expect(README).not.toMatch(/src="docs\/images\//);
    expect(README).not.toMatch(/\]\(docs\/images\//);
    const names = publishedImages(README);
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

describe("imageSources", () => {
  test("the README and every docs page are read, and between them they name the whole capture", () => {
    const sources = imageSources();
    expect(sources[0]).toBe(join(ROOT, "README.md"));
    expect(sources.length).toBeGreaterThan(100);
    // Every docs page names its pictures by published address, so what this publishes is what a
    // Reader of the source can load: each image some page reads, which is each image a shot makes.
    const named = new Set(
      publishedImages(sources.map((file) => readFileSync(file, "utf8")).join("\n")),
    );
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "scripts/screenshots/manifest.json"), "utf8"),
    );
    const produced: string[] = [];
    for (const shot of readShots(manifest)) {
      for (const name of capturedImageNames(shot.raw)) {
        produced.push(`${name}.png`);
      }
    }
    produced.sort();
    expect([...named].toSorted()).toEqual(produced);
  });
});

describe("publishDocImages", () => {
  test("copies what is captured to the path the README names, and reports what is not", () => {
    const root = mkdtempSync(join(tmpdir(), "jx-readme-images-"));
    const images = join(root, "images");
    const dist = join(root, "dist");
    mkdirSync(images);
    writeFileSync(join(images, "hero.png"), "png-bytes");
    const source =
      "https://jxsuite.com/content/docs/images/hero.png " +
      "https://jxsuite.com/content/docs/images/absent.png";
    const result = publishDocImages(source, images, dist);
    expect(result).toEqual({ missing: ["absent.png"], published: ["hero.png"] });
    expect(readFileSync(join(dist, "content/docs/images/hero.png"), "utf8")).toBe("png-bytes");
    expect(existsSync(join(dist, "content/docs/images/absent.png"))).toBe(false);
  });
});
