/**
 * site-build.test.js — Tests for the Phase 1 site build pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadSiteConfig } from "../site-loader.js";
import { discoverPages, expandDynamicRoutes } from "../pages-discovery.js";
import { resolveLayout } from "../layout-resolver.js";
import { mergeHead, renderHead } from "../head-merger.js";
import { injectContext } from "../context-injection.js";
import { buildSite } from "../site-build.js";

const TMP = resolve(import.meta.dir, "__test-site__");

/** @param {string} path @param {any} obj */
function writeJSON(path, obj) {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), JSON.stringify(obj, null, 2), "utf8");
}

/** @param {string} path @param {string} content */
function writePlain(path, content) {
  mkdirSync(resolve(TMP, ...path.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(resolve(TMP, path), content, "utf8");
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

beforeAll(() => {
  rmSync(TMP, { recursive: true, force: true });

  writeJSON("site.json", {
    name: "Test Site",
    url: "https://test.com",
    defaults: { layout: "./layouts/base.json", lang: "en" },
    $head: [
      { tagName: "meta", attributes: { name: "generator", content: "Jx" } },
    ],
    redirects: { "/old": "/new" },
    build: { outDir: "./dist" },
  });

  writeJSON("layouts/base.json", {
    tagName: "div",
    children: [
      { tagName: "header", children: ["Site Header"] },
      { tagName: "main", children: [{ tagName: "slot" }] },
      { tagName: "footer", children: ["Site Footer"] },
    ],
  });

  writeJSON("pages/index.json", {
    title: "Home",
    children: [{ tagName: "h1", children: ["Welcome"] }],
  });

  writeJSON("pages/about.json", {
    title: "About",
    $head: [
      { tagName: "meta", attributes: { name: "description", content: "About page" } },
    ],
    children: [{ tagName: "h1", children: ["About Us"] }],
  });

  writeJSON("pages/blog/index.json", {
    title: "Blog",
    children: [{ tagName: "h1", children: ["Blog"] }],
  });

  writeJSON("pages/_helpers.json", {
    tagName: "div",
    children: ["I should not be a route"],
  });

  writePlain("public/robots.txt", "User-agent: *\nAllow: /\n");
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

// ── site-loader ───────────────────────────────────────────────────────────────

describe("site-loader", () => {
  it("loads site.json with defaults", () => {
    const { config } = loadSiteConfig(TMP);
    expect(config.name).toBe("Test Site");
    expect(config.url).toBe("https://test.com");
    expect(config.defaults.lang).toBe("en");
    expect(config.defaults.charset).toBe("utf-8");
    expect(config.build.outDir).toBe("./dist");
  });

  it("throws on missing site.json", () => {
    expect(() => loadSiteConfig("/nonexistent")).toThrow("site.json not found");
  });
});

// ── pages-discovery ───────────────────────────────────────────────────────────

describe("pages-discovery", () => {
  it("discovers static routes", () => {
    const pagesDir = resolve(TMP, "pages");
    const routes = discoverPages(pagesDir);
    const urls = routes.map((r) => r.urlPattern);

    expect(urls).toContain("/");
    expect(urls).toContain("/about");
    expect(urls).toContain("/blog");
  });

  it("skips underscore-prefixed files", () => {
    const pagesDir = resolve(TMP, "pages");
    const routes = discoverPages(pagesDir);
    const urls = routes.map((r) => r.urlPattern);
    expect(urls).not.toContain("/_helpers");
  });

  it("sorts static routes before dynamic", () => {
    const pagesDir = resolve(TMP, "pages");
    const routes = discoverPages(pagesDir);
    // All routes in our fixture are static
    for (const r of routes) {
      expect(r.isDynamic).toBe(false);
    }
  });
});

// ── layout-resolver ───────────────────────────────────────────────────────────

describe("layout-resolver", () => {
  const siteConfig = {
    defaults: { layout: "./layouts/base.json" },
  };

  it("wraps page content in layout with slot distribution", () => {
    const pageDoc = {
      title: "Test",
      children: [{ tagName: "p", children: ["Hello"] }],
    };

    const result = resolveLayout(pageDoc, siteConfig, TMP);

    // Should have the layout structure
    expect(result.tagName).toBe("div");
    expect(result.children).toHaveLength(3); // header, main, footer

    // Main should now contain the page's <p> instead of <slot>
    const main = result.children[1];
    expect(main.tagName).toBe("main");
    expect(main.children[0].tagName).toBe("p");
    expect(main.children[0].children[0]).toBe("Hello");
  });

  it("returns page as-is when no layout", () => {
    const pageDoc = { tagName: "div", children: ["Hello"] };
    const result = resolveLayout(pageDoc, { defaults: {} }, TMP);
    expect(result).toEqual(pageDoc);
  });
});

// ── head-merger ───────────────────────────────────────────────────────────────

describe("head-merger", () => {
  it("merges site + page heads with deduplication", () => {
    const siteHead = [
      { tagName: "meta", attributes: { name: "generator", content: "Jx" } },
    ];
    const pageHead = [
      { tagName: "meta", attributes: { name: "description", content: "Page desc" } },
    ];

    const merged = mergeHead(siteHead, [], pageHead, { title: "Test" });

    const names = merged
      .filter((e) => e.tagName === "meta" && e.attributes?.name)
      .map((e) => e.attributes.name);

    expect(names).toContain("generator");
    expect(names).toContain("description");
    expect(names).toContain("viewport");
  });

  it("page-level overrides site-level for same key", () => {
    const siteHead = [
      { tagName: "meta", attributes: { name: "description", content: "Site" } },
    ];
    const pageHead = [
      { tagName: "meta", attributes: { name: "description", content: "Page" } },
    ];

    const merged = mergeHead(siteHead, [], pageHead, {});
    const desc = merged.find(
      (e) => e.tagName === "meta" && e.attributes?.name === "description"
    );
    expect(desc.attributes.content).toBe("Page");
  });

  it("renders to valid HTML", () => {
    const entries = [
      { tagName: "meta", attributes: { charset: "utf-8" } },
      { tagName: "title", children: ["Test"] },
    ];
    const html = renderHead(entries);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Test</title>");
  });
});

// ── context-injection ─────────────────────────────────────────────────────────

describe("context-injection", () => {
  it("injects $site and $page into state", () => {
    /** @type {any} */
    const doc = {};
    const siteConfig = { name: "Test", url: "https://test.com" };
    const route = { urlPattern: "/about", _pathParams: {} };

    injectContext(doc, siteConfig, route);

    expect(doc.state.$site.name).toBe("Test");
    expect(doc.state.$site.url).toBe("https://test.com");
    expect(doc.state.$page.url).toBe("/about");
  });
});

// ── Full build ────────────────────────────────────────────────────────────────

describe("buildSite", () => {
  it("builds the full site", async () => {
    const result = await buildSite(TMP, { verbose: false });

    expect(result.routes).toBe(3); // /, /about, /blog
    expect(result.errors).toHaveLength(0);

    // Verify output files exist
    const distDir = resolve(TMP, "dist");
    expect(existsSync(join(distDir, "index.html"))).toBe(true);
    expect(existsSync(join(distDir, "about/index.html"))).toBe(true);
    expect(existsSync(join(distDir, "blog/index.html"))).toBe(true);
    expect(existsSync(join(distDir, "_redirects"))).toBe(true);
    expect(existsSync(join(distDir, "robots.txt"))).toBe(true);
  });

  it("generates correct HTML with layout and head merging", async () => {
    await buildSite(TMP, { verbose: false });

    const html = readFileSync(resolve(TMP, "dist/about/index.html"), "utf8");

    // Layout applied
    expect(html).toContain("Site Header");
    expect(html).toContain("Site Footer");

    // Page content in slot
    expect(html).toContain("About Us");

    // Head merging
    expect(html).toContain('name="generator"');
    expect(html).toContain('name="description"');
    expect(html).toContain("<title>About</title>");
  });

  it("generates redirect files", async () => {
    await buildSite(TMP, { verbose: false });

    const redirects = readFileSync(resolve(TMP, "dist/_redirects"), "utf8");
    expect(redirects).toContain("/old /new 301");

    const redirectHtml = readFileSync(
      resolve(TMP, "dist/old/index.html"),
      "utf8"
    );
    expect(redirectHtml).toContain('http-equiv="refresh"');
    expect(redirectHtml).toContain("/new");
  });
});
