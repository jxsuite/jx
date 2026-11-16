/**
 * `$page` in a layout through a real build (site-architecture.md §5.5). What this has to prove is
 * that a layout reads the PAGE's own facts: `${state.$page.title}` in a layout's `$head` is the
 * text the page's `<title>` shows, on a page with a frontmatter title and on a content-collection
 * page whose title is a template, and never the layout's own `title` or template text.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build.ts";
import type { JsonObject } from "@jxsuite/schema/types";

const DIR = resolve(import.meta.dir, "__test-site-page-context__");
const OUT = resolve(DIR, "dist");

function write(path: string, text: string): void {
  const file = resolve(DIR, path);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, text, "utf8");
}

const page = (rel: string, doc: JsonObject) => write(`pages/${rel}`, JSON.stringify(doc));
const html = (rel: string) => readFileSync(resolve(OUT, rel), "utf8");
const meta = (name: "name" | "property", key: string, content: string) => ({
  attributes: { content, [name]: key },
  tagName: "meta",
});

/** The `content` of the `<meta>` whose `name` or `property` is `key`, or null. */
function metaContent(source: string, key: string): string | null {
  const tag = new RegExp(`<meta[^>]*(?:name|property)="${key}"[^>]*>`).exec(source)?.[0];
  return tag ? (/content="([^"]*)"/.exec(tag)?.[1] ?? null) : null;
}

const text = (source: string, id: string) =>
  new RegExp(`<p id="${id}">([^<]*)</p>`).exec(source)?.[1];

describe("buildSite — $page in a layout", () => {
  beforeAll(async () => {
    rmSync(DIR, { force: true, recursive: true });
    write(
      "project.json",
      JSON.stringify({
        build: { outDir: "./dist" },
        content: { posts: { format: "Markdown", source: "./content/posts/" } },
        defaults: { lang: "en" },
        extensions: ["@jxsuite/parser"],
        name: "Ctx",
      }),
    );
    write(
      "layouts/base.json",
      JSON.stringify({
        $head: [
          meta("property", "og:title", "${state.$page.title}"),
          meta("name", "twitter:title", "${state.$page.title}"),
          meta("property", "og:description", "${$page.description ?? ''}"),
        ],
        $lang: "de",
        children: [
          { attributes: { id: "t" }, tagName: "p", textContent: "${$page.title}" },
          { attributes: { id: "l" }, tagName: "p", textContent: "${$page.locale}" },
          { tagName: "slot" },
        ],
        tagName: "div",
        title: "Shell",
      }),
    );
    page("about.json", {
      $head: [meta("name", "description", "About us")],
      $layout: "./layouts/base.json",
      children: [{ tagName: "main", textContent: "About" }],
      title: "About",
    });
    page("templated.json", {
      $layout: "./layouts/base.json",
      children: [{ tagName: "main", textContent: "T" }],
      state: { heading: { default: "Hello", timing: "compiler" } },
      title: "${state.heading} | Blog",
    });
    page("fr.json", {
      $lang: "fr",
      $layout: "./layouts/base.json",
      children: [{ tagName: "main", textContent: "F" }],
      title: "Accueil",
    });
    page("untitled.json", {
      $layout: "./layouts/base.json",
      children: [{ tagName: "main", textContent: "U" }],
    });
    page("blog/[slug].json", {
      $layout: "./layouts/base.json",
      $paths: { contentType: "posts", field: "id", param: "slug" },
      children: [{ tagName: "h1", textContent: "${state.entry.data.title}" }],
      state: {
        entry: {
          $prototype: "ContentEntry",
          $src: "@jxsuite/parser/ContentEntry.class.json",
          contentType: "posts",
          field: "id",
          id: { $ref: "#/$params/slug" },
        },
      },
      title: "${state.entry.data.title} — The Long Field",
    });
    write("content/posts/hello.md", "---\ntitle: Hello World\n---\n\nBody\n");
    const result = await buildSite(DIR, { verbose: false });
    expect(result.errors).toHaveLength(0);
  }, 60_000);

  afterAll(() => {
    rmSync(DIR, { force: true, recursive: true });
  });

  it("gives og:title and twitter:title the page's own title, not the layout's", () => {
    const about = html("about/index.html");
    expect(about).toContain("<title>About</title>");
    expect(metaContent(about, "og:title")).toBe("About");
    expect(metaContent(about, "twitter:title")).toBe("About");
    expect(text(about, "t")).toBe("About");
    expect(about).not.toContain("Shell");
  });

  it("gives a content-collection page its resolved title in og:title and twitter:title", () => {
    const post = html("blog/hello/index.html");
    const expected = "Hello World — The Long Field";
    expect(post).toContain(`<title>${expected}</title>`);
    expect(metaContent(post, "og:title")).toBe(expected);
    expect(metaContent(post, "twitter:title")).toBe(expected);
    expect(text(post, "t")).toBe(expected);
    expect(post).not.toContain("${");
  });

  it("resolves a templated title before the layout reads it", () => {
    const source = html("templated/index.html");
    expect(source).toContain("<title>Hello | Blog</title>");
    expect(metaContent(source, "og:title")).toBe("Hello | Blog");
    expect(text(source, "t")).toBe("Hello | Blog");
    expect(source).not.toContain("${");
  });

  it("feeds the page's description into the layout's own $head", () => {
    expect(metaContent(html("about/index.html"), "og:description")).toBe("About us");
    expect(metaContent(html("untitled/index.html"), "og:description")).toBe("");
  });

  it("reads the page's own $lang as $page.locale, not the layout's", () => {
    const fr = html("fr/index.html");
    expect(text(fr, "l")).toBe("fr");
    expect(/<html[^>]*lang="fr"/.test(fr)).toBe(true);
    expect(text(html("about/index.html"), "l")).toBe("en");
  });

  it("reads the project name for a page with no title", () => {
    const source = html("untitled/index.html");
    expect(text(source, "t")).toBe("Ctx");
    expect(metaContent(source, "og:title")).toBe("Ctx");
    expect(source).toContain("<title>Ctx</title>");
  });
});
