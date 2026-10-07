/**
 * What a static host and a crawler are told about each page, end to end through a real build
 * (specs/site-architecture.md §8.4).
 *
 * Each rule lives in a different place: the output path in `routeToOutputPath`, the canonical link
 * in the head merge, the sitemap entry beside the page loop. Only a build shows that they agree,
 * which is what a host and a crawler check: a sitemap that lists a URL the canonical link
 * contradicts, or a not-found page the host cannot find, are each correct in isolation.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite } from "../src/site/site-build.ts";

const SITE = "https://static.example";
const roots: string[] = [];

/** A small site: an indexable page, a page that asks not to be indexed, and a not-found page. */
async function build(trailingSlash: "always" | "never"): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `jx-static-host-${trailingSlash}-`));
  roots.push(root);
  const write = (path: string, contents: unknown) => {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(contents), "utf8");
  };
  write("project.json", {
    build: { outDir: "./dist", trailingSlash },
    name: "Static Host Site",
    url: SITE,
  });
  write("pages/index.json", { children: ["home"], tagName: "div" });
  write("pages/about.json", { children: ["about"], tagName: "div" });
  write("pages/blog/post.json", { children: ["post"], tagName: "div" });
  write("pages/private.json", {
    $head: [{ attributes: { content: "noindex, nofollow", name: "robots" }, tagName: "meta" }],
    children: ["private"],
    tagName: "div",
  });
  write("pages/404.json", { children: ["not found"], tagName: "div" });
  await buildSite(root, { clean: true });
  return root;
}

const read = (root: string, path: string) => readFileSync(join(root, "dist", path), "utf8");
const locs = (root: string) =>
  [...read(root, "sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const canonical = (html: string) => /<link[^>]*rel="canonical"[^>]*>/.exec(html)?.[0] ?? null;

let always = "";
let never = "";

beforeAll(async () => {
  always = await build("always");
  never = await build("never");
}, 60_000);

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('build.trailingSlash: "always"', () => {
  it("names the directory form in the canonical link, og:url and the sitemap alike", () => {
    const html = read(always, "about/index.html");
    expect(canonical(html)).toContain(`href="${SITE}/about/"`);
    expect(html).toContain(`content="${SITE}/about/" property="og:url"`);
    expect(locs(always)).toContain(`${SITE}/about/`);
    expect(locs(always)).toContain(`${SITE}/blog/post/`);
  });

  it("keeps the root as /", () => {
    expect(canonical(read(always, "index.html"))).toContain(`href="${SITE}/"`);
    expect(locs(always)).toContain(`${SITE}/`);
  });
});

describe('build.trailingSlash: "never"', () => {
  it("names the file form: no trailing slash anywhere", () => {
    const html = read(never, "about.html");
    expect(canonical(html)).toContain(`href="${SITE}/about"`);
    expect(html).toContain(`content="${SITE}/about" property="og:url"`);
    expect(locs(never)).toContain(`${SITE}/about`);
    expect(locs(never)).toContain(`${SITE}/blog/post`);
  });
});

describe("the sitemap lists what a crawler may index", () => {
  it("leaves out a page whose head asks for noindex, though the page is still built", () => {
    expect(existsSync(join(always, "dist/private/index.html"))).toBe(true);
    expect(locs(always)).not.toContain(`${SITE}/private/`);
    expect(locs(never)).not.toContain(`${SITE}/private`);
  });

  it("leaves out the not-found page", () => {
    for (const root of [always, never]) {
      expect(locs(root).some((loc) => loc?.includes("404"))).toBe(false);
    }
  });

  it("lists every other page exactly once", () => {
    expect(locs(always).toSorted()).toEqual([`${SITE}/`, `${SITE}/about/`, `${SITE}/blog/post/`]);
    expect(locs(never).toSorted()).toEqual([`${SITE}/`, `${SITE}/about`, `${SITE}/blog/post`]);
  });
});

describe("the not-found page", () => {
  it("is written to 404.html, the file a static host looks for, under either setting", () => {
    for (const root of [always, never]) {
      expect(existsSync(join(root, "dist/404.html"))).toBe(true);
      expect(read(root, "404.html")).toContain("not found");
    }
  });

  it("is not also written as a page of its own", () => {
    expect(existsSync(join(always, "dist/404/index.html"))).toBe(false);
  });

  it("carries no canonical link or og:url: the URL it answers at is whatever was mistyped", () => {
    for (const root of [always, never]) {
      const html = read(root, "404.html");
      expect(canonical(html)).toBeNull();
      expect(html).not.toContain('property="og:url"');
    }
  });
});
