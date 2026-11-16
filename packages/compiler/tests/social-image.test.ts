/**
 * Social-image.test.ts — `og:image:width` and `og:image:height`, read from the image the page names
 * (site-architecture.md §8.4.4), from the unit that decides it up to a built page.
 *
 * What matters here is the refusals as much as the reading: a wrong size is worse than none, so a
 * remote image, a missing file, an unreadable header and an author's own tags each leave the head
 * exactly as it was.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { JsonValue, JxHeadEntry } from "@jxsuite/schema/types";
import { fakeSource, imageMetadata, installFakeBinding, resetFakeSource } from "./_fake-binding";

// The native addon is replaced by a double, as in the image suites: what is proven is what the
// Compiler asks of it and what it does with the answer.
installFakeBinding();

const { withSocialImageSize } = await import("../src/site/social-image.ts");
const { buildSite } = await import("../src/site/site-build.ts");

const TMP = resolve(import.meta.dir, "__test-social-image__");

const og = (content: string): JxHeadEntry => ({
  attributes: { content, property: "og:image" },
  tagName: "meta",
});
const property = (head: JxHeadEntry[], name: string) =>
  head.find((e) => e.attributes?.property === name)?.attributes?.content;

/** A GIF header: signature, then the logical screen's width and height as little-endian words. */
function gif(width: number, height: number, signature = "GIF89a") {
  const bytes = Buffer.alloc(10);
  bytes.write(signature, 0, "ascii");
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function put(path: string, bytes: Buffer | string = "img") {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), bytes);
}

const ctx = (extra: Partial<Parameters<typeof withSocialImageSize>[1]> = {}) => ({
  mounts: [],
  projectRoot: TMP,
  siteUrl: "https://example.com",
  ...extra,
});

describe("withSocialImageSize", () => {
  beforeEach(() => {
    rmSync(TMP, { force: true, recursive: true });
    mkdirSync(TMP, { recursive: true });
    resetFakeSource();
    imageMetadata.mockClear();
  });
  afterAll(() => rmSync(TMP, { force: true, recursive: true }));

  test("adds the size after og:image for a site-absolute path under public/", async () => {
    put("public/og/card.png");
    fakeSource.width = 1200;
    fakeSource.height = 630;
    const head = [{ tagName: "title" }, og("/og/card.png"), { tagName: "link" }];
    const out = await withSocialImageSize(head, ctx());
    expect(out.map((e) => e.attributes?.property ?? e.tagName)).toEqual([
      "title",
      "og:image",
      "og:image:width",
      "og:image:height",
      "link",
    ]);
    expect(property(out, "og:image:width")).toBe("1200");
    expect(property(out, "og:image:height")).toBe("630");
  });

  test("reads an absolute URL under the project's own url, keeping its path and dropping the query", async () => {
    put("public/og/my card.png");
    const out = await withSocialImageSize(
      [og("https://example.com/site/og/my%20card.png?v=2#x")],
      ctx({ siteUrl: "https://example.com/site/" }),
    );
    expect(property(out, "og:image:width")).toBe("800");
    expect(property(out, "og:image:height")).toBe("600");
  });

  test("reads an image served from an asset mount", async () => {
    put("elsewhere/hero.png");
    const mounts: AssetMount[] = [{ dir: resolve(TMP, "elsewhere"), urlPrefix: "/media" }];
    const out = await withSocialImageSize([og("/media/hero.png")], ctx({ mounts }));
    expect(property(out, "og:image:width")).toBe("800");
  });

  test("reads a GIF from its header, which the native core does not decode", async () => {
    put("public/card.gif", gif(300, 250));
    const out = await withSocialImageSize([og("/card.gif")], ctx());
    expect(property(out, "og:image:width")).toBe("300");
    expect(property(out, "og:image:height")).toBe("250");
    expect(imageMetadata).not.toHaveBeenCalled();
  });

  test("a GIF with a zero side, a short file or a wrong signature states no size", async () => {
    put("public/zero.gif", gif(0, 10));
    put("public/short.gif", Buffer.from("GIF89a"));
    put("public/fake.gif", gif(10, 10, "GIF90a"));
    imageMetadata.mockRejectedValue(new Error("not an image"));
    for (const name of ["zero", "short", "fake"]) {
      const head = [og(`/${name}.gif`)];
      expect(await withSocialImageSize(head, ctx())).toBe(head);
    }
    imageMetadata.mockImplementation(async () => ({ ...fakeSource }));
  });

  test("leaves the head alone when the author stated a size", async () => {
    put("public/card.png");
    for (const tag of ["og:image:width", "og:image:height"]) {
      const head = [
        og("/card.png"),
        { attributes: { content: "1", property: tag }, tagName: "meta" },
      ];
      expect(await withSocialImageSize(head, ctx())).toBe(head);
    }
  });

  test("leaves the head alone for every image the build cannot or should not read", async () => {
    put("public/card.png");
    const none: JxHeadEntry[] = [{ tagName: "title" }];
    expect(await withSocialImageSize(none, ctx())).toBe(none);
    for (const content of [
      "https://cdn.example.net/card.png", // Remote
      "//cdn.example.net/card.png", // Scheme-relative
      "card.png", // Names no site path
      "data:image/png;base64,AA",
      "/missing.png", // No such file
      "/", // A directory
      "/../public/card.png", // Escapes public/
      "/%E0%A4%A.png", // Not a decodable path
      "https://example.com", // The origin, with no path
    ]) {
      const head = [og(content)];
      expect(await withSocialImageSize(head, ctx())).toBe(head);
    }
    // An entry whose content is not a string, as authored JSON can hold one.
    const odd = [{ attributes: { property: "og:image" }, tagName: "meta" }];
    expect(await withSocialImageSize(odd, ctx())).toBe(odd);
    // No `url`: an absolute address names no file of ours.
    const abs = [og("https://example.com/card.png")];
    expect(await withSocialImageSize(abs, ctx({ siteUrl: undefined }))).toBe(abs);
  });

  test("a file whose header the compiler cannot read, or reads as empty, states no size", async () => {
    put("public/vector.svg", "<svg/>");
    imageMetadata.mockRejectedValueOnce(new Error("unsupported"));
    const head = [og("/vector.svg")];
    expect(await withSocialImageSize(head, ctx())).toBe(head);
    put("public/empty.png");
    fakeSource.width = 0;
    const empty = [og("/empty.png")];
    expect(await withSocialImageSize(empty, ctx())).toBe(empty);
  });

  test("measures a file once until it changes", async () => {
    put("public/once.png", "a");
    await withSocialImageSize([og("/once.png")], ctx());
    await withSocialImageSize([og("/once.png")], ctx());
    expect(imageMetadata).toHaveBeenCalledTimes(1);
    put("public/once.png", "bb");
    utimesSync(resolve(TMP, "public/once.png"), new Date(), new Date(Date.now() + 5000));
    fakeSource.width = 640;
    const out = await withSocialImageSize([og("/once.png")], ctx());
    expect(imageMetadata).toHaveBeenCalledTimes(2);
    expect(property(out, "og:image:width")).toBe("640");
  });

  test("the last og:image is the one measured", async () => {
    put("public/second.png");
    const out = await withSocialImageSize([og("/first.png"), og("/second.png")], ctx());
    expect(out.map((e) => e.attributes?.property)).toEqual([
      "og:image",
      "og:image",
      "og:image:width",
      "og:image:height",
    ]);
  });
});

// ─── The whole build ─────────────────────────────────────────────────────────

function writeJSON(path: string, obj: JsonValue) {
  put(path, JSON.stringify(obj, null, 2));
}
const read = (path: string) => readFileSync(resolve(TMP, path), "utf8");

describe("a built page", () => {
  beforeAll(() => {
    rmSync(TMP, { force: true, recursive: true });
    resetFakeSource();
    fakeSource.width = 1200;
    fakeSource.height = 630;
    writeJSON("project.json", {
      build: { outDir: "./dist" },
      defaults: { layout: "./layouts/base.json" },
      images: { optimize: false },
      name: "Probe",
      url: "https://example.com",
    });
    /* The layout is the recipe the docs give: a compiler-timed `ogImage` and `ogImageAlt`, each a
       state entry a page overrides, templated into the image, its alt and the Twitter alt. */
    writeJSON("layouts/base.json", {
      $head: [
        {
          attributes: { content: "${state.$site.url}${state.ogImage}", property: "og:image" },
          tagName: "meta",
        },
        {
          attributes: { content: "${state.ogImageAlt}", property: "og:image:alt" },
          tagName: "meta",
        },
        {
          attributes: { content: "${state.ogImageAlt}", name: "twitter:image:alt" },
          tagName: "meta",
        },
      ],
      children: [{ tagName: "slot" }],
      state: {
        ogImage: { default: "/og/default.png", timing: "compiler" },
        ogImageAlt: { default: "The Probe card", timing: "compiler" },
      },
      tagName: "div",
    });
    writeJSON("pages/index.json", {
      children: [{ children: ["Home"], tagName: "h1" }],
      title: "Home",
    });
    writeJSON("pages/remote.json", {
      children: [{ children: ["Remote"], tagName: "h1" }],
      $head: [
        {
          attributes: { content: "https://cdn.example.net/x.png", property: "og:image" },
          tagName: "meta",
        },
      ],
      title: "Remote",
    });
    writeJSON("pages/custom.json", {
      $head: [
        { attributes: { content: "10", property: "og:image:width" }, tagName: "meta" },
        { attributes: { content: "20", property: "og:image:height" }, tagName: "meta" },
      ],
      children: [{ children: ["Custom"], tagName: "h1" }],
      title: "Custom",
    });
    put("public/og/default.png");
  });
  afterAll(() => rmSync(TMP, { force: true, recursive: true }));

  test("states the size and the alt for a local default card", async () => {
    await buildSite(TMP, { verbose: false });
    const html = read("dist/index.html");
    expect(html).toContain(
      '<meta content="https://example.com/og/default.png" property="og:image">',
    );
    expect(html).toContain('<meta content="1200" property="og:image:width">');
    expect(html).toContain('<meta content="630" property="og:image:height">');
    expect(html).toContain('<meta content="The Probe card" property="og:image:alt">');
    expect(html).toContain('<meta content="The Probe card" name="twitter:image:alt">');
  });

  test("states no size for a remote image", () => {
    const html = read("dist/remote/index.html");
    expect(html).toContain('content="https://cdn.example.net/x.png"');
    expect(html).not.toContain("og:image:width");
    expect(html).not.toContain("og:image:height");
  });

  test("keeps a size the page wrote itself", () => {
    const html = read("dist/custom/index.html");
    expect(html).toContain('<meta content="10" property="og:image:width">');
    expect(html).not.toContain('content="1200"');
  });
});
