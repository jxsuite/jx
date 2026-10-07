import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  hasAlternateLink,
  htmlDeclaresNoindex,
  isNotFoundRoute,
  outputUrlPath,
  servedRoute,
  withAlternateLink,
} from "../src/site/static-host.ts";

describe("servedRoute", () => {
  test('"always" serves a route as a directory: one trailing slash', () => {
    expect(servedRoute("/about", "always")).toBe("/about/");
    expect(servedRoute("/kb/a/b", "always")).toBe("/kb/a/b/");
    expect(servedRoute("/about/", "always")).toBe("/about/");
  });

  test('"never" serves a route as a file: no trailing slash', () => {
    expect(servedRoute("/about/", "never")).toBe("/about");
    expect(servedRoute("/about//", "never")).toBe("/about");
    expect(servedRoute("/about", "never")).toBe("/about");
  });

  test("the root is / under every setting", () => {
    for (const setting of ["always", "never", "preserve"]) {
      expect(servedRoute("/", setting)).toBe("/");
    }
    expect(servedRoute("/")).toBe("/");
    expect(servedRoute("//", "never")).toBe("/");
  });

  test("an unset or unknown setting leaves the route as written", () => {
    expect(servedRoute("/about")).toBe("/about");
    expect(servedRoute("/about/", "preserve")).toBe("/about/");
  });
});

describe("isNotFoundRoute", () => {
  test("is the /404 route and nothing else", () => {
    expect(isNotFoundRoute("/404")).toBe(true);
    expect(isNotFoundRoute("/404/")).toBe(false);
    expect(isNotFoundRoute("/docs/404")).toBe(false);
    expect(isNotFoundRoute("/")).toBe(false);
  });
});

describe("htmlDeclaresNoindex", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  test("reads noindex from the robots meta, in either attribute order", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="noindex">'))).toBe(true);
    expect(htmlDeclaresNoindex(page('<meta content="noindex" name="robots">'))).toBe(true);
  });

  test("finds noindex among other directives, with any case and spacing", () => {
    expect(htmlDeclaresNoindex(page('<meta name="ROBOTS" content="Follow , NoIndex">'))).toBe(true);
    expect(htmlDeclaresNoindex(page("<meta name='robots' content='noarchive,noindex'>"))).toBe(
      true,
    );
    expect(htmlDeclaresNoindex(page("<meta name=robots content=noindex>"))).toBe(true);
  });

  test("`none` means noindex and nofollow", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="none">'))).toBe(true);
  });

  test("a page that allows indexing is not flagged", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="index, follow">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta name="robots" content="nofollow">'))).toBe(false);
    expect(htmlDeclaresNoindex(page(""))).toBe(false);
  });

  test("only the generic robots tag counts, not other names that mention noindex", () => {
    expect(htmlDeclaresNoindex(page('<meta name="googlebot" content="noindex">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta name="description" content="noindex">'))).toBe(false);
    expect(htmlDeclaresNoindex(page('<meta property="robots" content="noindex">'))).toBe(false);
  });

  test("looks in the head only: the word in the body is not a directive", () => {
    const html = `<html><head><title>t</title></head><body><meta name="robots" content="noindex"></body></html>`;
    expect(htmlDeclaresNoindex(html)).toBe(false);
    expect(htmlDeclaresNoindex('<meta name="robots" content="noindex">')).toBe(true);
  });

  test("a tag without a content attribute allows indexing", () => {
    expect(htmlDeclaresNoindex(page('<meta name="robots">'))).toBe(false);
  });
});

describe("hasAlternateLink", () => {
  const page = (head: string) => `<!doctype html><html><head>${head}</head><body></body></html>`;

  test("finds an alternate of the type, whatever the attribute order or the case", () => {
    expect(
      hasAlternateLink(
        page('<link href="/a.md" rel="alternate" type="text/markdown">'),
        "text/markdown",
      ),
    ).toBe(true);
    expect(
      hasAlternateLink(
        page('<link type="TEXT/Markdown" rel="Alternate" href="/a.md">'),
        "text/markdown",
      ),
    ).toBe(true);
    expect(
      hasAlternateLink(
        page('<link rel="alternate stylesheet" type="text/markdown" href="/a.md">'),
        "text/markdown",
      ),
    ).toBe(true);
  });

  test("a media type parameter does not change the type", () => {
    expect(
      hasAlternateLink(
        page('<link rel="alternate" type="text/markdown; charset=utf-8" href="/a.md">'),
        "text/markdown",
      ),
    ).toBe(true);
  });

  test("other alternates, other types and other relations do not count", () => {
    expect(
      hasAlternateLink(page('<link rel="alternate" hreflang="fr" href="/fr/">'), "text/markdown"),
    ).toBe(false);
    expect(
      hasAlternateLink(
        page('<link rel="alternate" type="application/atom+xml" href="/feed.xml">'),
        "text/markdown",
      ),
    ).toBe(false);
    expect(
      hasAlternateLink(
        page('<link rel="canonical" type="text/markdown" href="/a">'),
        "text/markdown",
      ),
    ).toBe(false);
    expect(hasAlternateLink(page(""), "text/markdown")).toBe(false);
  });

  test("looks in the head only", () => {
    const html =
      '<html><head></head><body><link rel="alternate" type="text/markdown" href="/a.md"></body></html>';
    expect(hasAlternateLink(html, "text/markdown")).toBe(false);
  });
});

describe("withAlternateLink", () => {
  const link = { href: "/about/index.md", type: "text/markdown" };
  const page = (head: string) => `<html><head>${head}</head><body>x</body></html>`;

  test("adds the link at the end of the head, attributes in the order the emitter writes them", () => {
    const out = withAlternateLink(page("<title>t</title>"), link);
    expect(out).toBe(
      `<html><head><title>t</title><link href="/about/index.md" rel="alternate" type="text/markdown">\n</head><body>x</body></html>`,
    );
  });

  test("leaves a page alone when it already advertises that type, so an author's own link wins", () => {
    const own = page('<link href="/custom.md" rel="alternate" type="text/markdown">');
    expect(withAlternateLink(own, link)).toBe(own);
  });

  test("leaves a page with no head alone: there is nowhere to put it", () => {
    expect(withAlternateLink("<p>fragment</p>", link)).toBe("<p>fragment</p>");
  });

  test("escapes the values it writes into attributes", () => {
    const out = withAlternateLink(page(""), { href: '/a"b&c.md', type: "text/markdown" });
    expect(out).toContain('href="/a&quot;b&amp;c.md"');
  });

  test("adds nothing twice", () => {
    const once = withAlternateLink(page(""), link);
    expect(withAlternateLink(once, link)).toBe(once);
  });
});

describe("outputUrlPath", () => {
  test("is the site-absolute path of a file in the output, with forward slashes", () => {
    const out = join("/site", "dist");
    expect(outputUrlPath(out, join(out, "about", "index.md"))).toBe("/about/index.md");
    expect(outputUrlPath(out, join(out, "index.md"))).toBe("/index.md");
    expect(outputUrlPath(out, join(out, "about.md"))).toBe("/about.md");
  });

  test("percent-encodes what a URL cannot carry, as the canonical link does", () => {
    const out = join("/site", "dist");
    expect(outputUrlPath(out, join(out, "kb", "a b", "index.md"))).toBe("/kb/a%20b/index.md");
    expect(outputUrlPath(out, join(out, "kb", "é", "index.md"))).toBe("/kb/%C3%A9/index.md");
  });
});
