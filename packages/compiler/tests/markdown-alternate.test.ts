/**
 * A page's Markdown twin is advertised from the page, end to end through a real build
 * (specs/site-architecture.md §8.4).
 *
 * The twin is written to a path the build derives from the HTML path, so the URL moves with
 * `build.trailingSlash` and with the deployment's base path, and a reader of the HTML cannot guess
 * it. These tests assert what a crawler does with it: follow the `<link>`, and find the file.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../src/site/site-build.ts";

const roots: string[] = [];

interface Options {
  trailingSlash?: "always" | "never";
  url?: string;
  extraPages?: Record<string, unknown>;
}

async function build({ trailingSlash, url, extraPages = {} }: Options): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "jx-md-alternate-"));
  roots.push(root);
  const write = (path: string, contents: unknown) => {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(contents), "utf8");
  };
  write("project.json", {
    build: { outDir: "./dist", ...(trailingSlash && { trailingSlash }) },
    extensions: ["@jxsuite/parser"],
    name: "Markdown Alternate Site",
    ...(url && { url }),
  });
  const body = (text: string) => ({
    children: [{ tagName: "h1", textContent: text }],
    tagName: "div",
    title: text,
  });
  write("pages/index.json", body("Home"));
  write("pages/about.json", body("About"));
  write("pages/blog/post.json", body("Post"));
  write("pages/404.json", body("Not found"));
  for (const [path, contents] of Object.entries(extraPages)) {
    write(path, contents);
  }
  const result = await buildSite(root, { clean: true });
  expect(result.errors).toEqual([]);
  return root;
}

const html = (root: string, path: string) => readFileSync(join(root, "dist", path), "utf8");
/** Every `<link rel="alternate" type="text/markdown">` of a page, as its `href`. */
const twins = (page: string) =>
  [...page.matchAll(/<link[^>]*rel="alternate"[^>]*type="text\/markdown"[^>]*>/g)].map(
    (m) => /href="([^"]*)"/.exec(m[0])?.[1],
  );

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('build.trailingSlash: "always" (the default)', () => {
  let root = "";
  beforeAll(async () => {
    root = await build({});
  }, 60_000);

  it("points each page at the index.md beside its index.html", () => {
    expect(twins(html(root, "index.html"))).toEqual(["/index.md"]);
    expect(twins(html(root, "about/index.html"))).toEqual(["/about/index.md"]);
    expect(twins(html(root, "blog/post/index.html"))).toEqual(["/blog/post/index.md"]);
  });

  it("advertises only files that were written", () => {
    const hrefs = ["index.html", "about/index.html", "blog/post/index.html"].flatMap((page) =>
      twins(html(root, page)),
    );
    // One per page: a loop over nothing would pass for a build that advertised nothing.
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      expect(existsSync(join(root, "dist", href!))).toBe(true);
    }
  });

  it("serves a twin that is the page's content", () => {
    expect(html(root, "about/index.md")).toContain("About");
  });

  it("gives the not-found page no twin: nothing advertised and nothing written", () => {
    expect(twins(html(root, "404.html"))).toEqual([]);
    expect(existsSync(join(root, "dist/404.md"))).toBe(false);
    expect(existsSync(join(root, "dist/404/index.md"))).toBe(false);
  });
});

describe('build.trailingSlash: "never"', () => {
  it("points each page at the page URL plus .md", async () => {
    const root = await build({ trailingSlash: "never" });
    expect(twins(html(root, "about.html"))).toEqual(["/about.md"]);
    expect(twins(html(root, "blog/post.html"))).toEqual(["/blog/post.md"]);
    expect(existsSync(join(root, "dist/about.md"))).toBe(true);
    expect(existsSync(join(root, "dist/blog/post.md"))).toBe(true);
  }, 60_000);
});

describe("a site deployed under a path", () => {
  it("keeps the base in the link, like every other URL the build writes", async () => {
    const root = await build({ url: "https://base.example/m/site/" });
    expect(twins(html(root, "about/index.html"))).toEqual(["/m/site/about/index.md"]);
    expect(twins(html(root, "index.html"))).toEqual(["/m/site/index.md"]);
  }, 60_000);
});

describe("a page that says something itself", () => {
  it("keeps an author's own Markdown alternate and adds no second one", async () => {
    const root = await build({
      extraPages: {
        "pages/guide.json": {
          $head: [
            {
              attributes: { href: "/custom/guide.md", rel: "alternate", type: "text/markdown" },
              tagName: "link",
            },
          ],
          children: [{ tagName: "h1", textContent: "Guide" }],
          tagName: "div",
          title: "Guide",
        },
      },
    });
    expect(twins(html(root, "guide/index.html"))).toEqual(["/custom/guide.md"]);
  }, 60_000);

  it("advertises no twin when the format cannot serialize the page, and still builds it", async () => {
    const root = mkdtempSync(join(tmpdir(), "jx-md-alternate-fail-"));
    roots.push(root);
    mkdirSync(join(root, "pages"), { recursive: true });
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({
        build: { outDir: "./dist" },
        extensions: ["@jxsuite/parser"],
        name: "Unserializable",
      }),
    );
    // Markdown cannot express a tag chosen at creation, so its serializer refuses this page.
    writeFileSync(
      join(root, "pages/index.json"),
      JSON.stringify({
        children: [
          {
            children: ["hi"],
            tagName: { $expression: { initial: "div", operator: "?:", target: true, value: "a" } },
          },
        ],
        title: "Home",
      }),
    );
    const result = await buildSite(root, { clean: true });
    expect(result.errors.some((e) => e.includes("Error exporting Markdown"))).toBe(true);
    expect(existsSync(join(root, "dist/index.html"))).toBe(true);
    expect(existsSync(join(root, "dist/index.md"))).toBe(false);
    expect(twins(html(root, "index.html"))).toEqual([]);
  }, 60_000);
});
