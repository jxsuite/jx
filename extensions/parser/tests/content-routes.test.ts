/**
 * Content-routes tests: route templates, slugs, and matching a route against a page pattern
 * (src/content-routes.ts). The module is the single source of truth for an entry's URL, so the
 * cases here are the ones where two consumers could otherwise disagree.
 */

import { describe, expect, it } from "bun:test";
import {
  directoryOf,
  isDirectoryIndex,
  normalizeRoute,
  parseRouteConfig,
  parseRouteTemplate,
  renderRoute,
  routeHref,
  routeParams,
  slugifyPath,
  slugifySegment,
} from "../src/content-routes.ts";

describe("slugifySegment", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifySegment("Swap Configuration")).toBe("swap-configuration");
    expect(slugifySegment("  Frappe  ")).toBe("frappe");
    expect(slugifySegment("a--b__c")).toBe("a-b-c");
  });

  it("reads & as 'and', so the section names its own slug", () => {
    expect(slugifySegment("Git & Dev Tools")).toBe("git-and-dev-tools");
    expect(slugifySegment("Q&A")).toBe("q-and-a");
  });

  it("drops apostrophes instead of splitting the word", () => {
    expect(slugifySegment("Don't Panic")).toBe("dont-panic");
    expect(slugifySegment("BJ’s")).toBe("bjs");
  });

  it("folds diacritics on Latin letters", () => {
    expect(slugifySegment("Café Crème")).toBe("cafe-creme");
    expect(slugifySegment("Zoë")).toBe("zoe");
  });

  it("keeps letters and vowel signs of other scripts", () => {
    expect(slugifySegment("日本語 ガイド")).toBe("日本語-ガイド");
    expect(slugifySegment("Привет мир")).toBe("привет-мир");
    // Devanagari vowel signs are marks; folding them would spell a different word.
    expect(slugifySegment("नमस्ते दुनिया")).toBe("नमस्ते-दुनिया");
  });

  it("yields an empty string when nothing is left", () => {
    expect(slugifySegment("!!!")).toBe("");
    expect(slugifySegment("")).toBe("");
  });
});

describe("slugifyPath", () => {
  it("slugifies each segment and keeps the depth", () => {
    expect(slugifyPath("WordPress/Gravity Forms")).toBe("wordpress/gravity-forms");
    expect(slugifyPath("Git & Dev Tools")).toBe("git-and-dev-tools");
  });

  it("drops segments that slugify to nothing", () => {
    expect(slugifyPath("a//!!!/b")).toBe("a/b");
    expect(slugifyPath("")).toBe("");
  });
});

describe("parseRouteTemplate", () => {
  it("splits literals from placeholders and their transforms", () => {
    const t = parseRouteTemplate("/kb/{category:slug}/{slug}/", "route");
    expect(t.tokens).toEqual([
      { literal: "/kb/" },
      { name: "category", source: "{category:slug}", transforms: ["slug"] },
      { literal: "/" },
      { name: "slug", source: "{slug}", transforms: [] },
      { literal: "/" },
    ]);
  });

  it("allows chained transforms and a literal-only template", () => {
    expect(parseRouteTemplate("/a/{x:lower:slug}", "route").tokens).toHaveLength(2);
    expect(parseRouteTemplate("/about", "route").tokens).toEqual([{ literal: "/about" }]);
  });

  it("refuses a template that could not render", () => {
    expect(() => parseRouteTemplate("kb/{slug}", "route")).toThrow(/site-absolute path/);
    expect(() => parseRouteTemplate(7, "route")).toThrow(/site-absolute path/);
    expect(() => parseRouteTemplate("/kb/{}", "route")).toThrow(/empty placeholder/);
    expect(() => parseRouteTemplate("/kb/{ :slug}", "route")).toThrow(/empty placeholder/);
    expect(() => parseRouteTemplate("/kb/{slug:shout}", "route")).toThrow(
      /unknown transform "shout"/,
    );
    expect(() => parseRouteTemplate("/kb/{slug", "route")).toThrow(/unbalanced brace/);
    expect(() => parseRouteTemplate("/kb/slug}", "route")).toThrow(/unbalanced brace/);
  });
});

describe("parseRouteConfig", () => {
  it("is null when the type declares no route", () => {
    expect(parseRouteConfig(undefined, undefined, "kb")).toBeNull();
  });

  it("accepts a template string", () => {
    const spec = parseRouteConfig("/kb/{id}", undefined, "kb")!;
    expect(spec.entry.source).toBe("/kb/{id}");
    expect(spec.index).toBeNull();
  });

  it("accepts an index template beside it", () => {
    const spec = parseRouteConfig("/kb/{slug}", "/kb/{dir:slug}", "kb")!;
    expect(spec.entry.source).toBe("/kb/{slug}");
    expect(spec.index?.source).toBe("/kb/{dir:slug}");
  });

  it("names the content type in every refusal", () => {
    expect(() => parseRouteConfig(42, undefined, "kb")).toThrow(
      /Content type "kb": route: a route template is a site-absolute path/,
    );
    expect(() => parseRouteConfig("/x", "y", "kb")).toThrow(
      /Content type "kb": indexRoute: a route/,
    );
    expect(() => parseRouteConfig(undefined, "/y", "kb")).toThrow(
      /Content type "kb": "indexRoute" needs a "route"/,
    );
  });
});

describe("isDirectoryIndex / directoryOf", () => {
  it("README and index stand for their directory, in any case", () => {
    expect(isDirectoryIndex("Frappe/README.md")).toBe(true);
    expect(isDirectoryIndex("Frappe/readme.md")).toBe(true);
    expect(isDirectoryIndex("Frappe/index.md")).toBe(true);
    expect(isDirectoryIndex("README.md")).toBe(true);
    expect(isDirectoryIndex("Frappe/Readme Notes.md")).toBe(false);
    expect(isDirectoryIndex("Frappe/Bench.md")).toBe(false);
    expect(isDirectoryIndex("Frappe/README")).toBe(false);
  });

  it("directoryOf is empty at the root", () => {
    expect(directoryOf("a/b/c.md")).toBe("a/b");
    expect(directoryOf("c.md")).toBe("");
  });
});

describe("normalizeRoute", () => {
  it("adds a leading slash and drops doubled and trailing ones", () => {
    expect(normalizeRoute("kb//a/")).toBe("/kb/a");
    expect(normalizeRoute("/")).toBe("/");
    expect(normalizeRoute("")).toBe("/");
  });

  it("refuses a route that could climb out of dist", () => {
    expect(normalizeRoute("/kb/../etc")).toBeNull();
    expect(normalizeRoute("/kb/./x")).toBeNull();
    expect(normalizeRoute(String.raw`/kb/a\b`)).toBeNull();
  });
});

describe("renderRoute", () => {
  const spec = parseRouteConfig("/kb/{category:slug}/{slug}/", "/kb/{dir:slug}/", "kb")!;
  const subject = (path: string, data: Record<string, unknown>, id = path) => ({
    data,
    id,
    path,
  });

  it("renders frontmatter placeholders through their transforms", () => {
    expect(
      renderRoute(
        spec,
        subject("Git & Dev Tools/Git Cheatsheet.md", {
          category: "Git & Dev Tools",
          slug: "git-cheatsheet",
        }),
      ),
    ).toEqual({ route: "/kb/git-and-dev-tools/git-cheatsheet" });
  });

  it("routes a directory index with the index template", () => {
    expect(renderRoute(spec, subject("Frappe/README.md", { slug: "frappe" }))).toEqual({
      route: "/kb/frappe",
    });
    expect(renderRoute(spec, subject("WordPress/Gravity Forms/README.md", {}))).toEqual({
      route: "/kb/wordpress/gravity-forms",
    });
  });

  it("a root-level index has an empty directory and routes to the collection root", () => {
    expect(renderRoute(spec, subject("README.md", {}))).toEqual({ route: "/kb" });
  });

  it("falls back to the entry template for an index when there is no index template", () => {
    const flat = parseRouteConfig("/docs/{id}", undefined, "docs")!;
    expect(renderRoute(flat, subject("guide/README.md", {}, "guide"))).toEqual({
      route: "/docs/guide",
    });
  });

  it("reads id, dir, file and nested fields, with or without the data. prefix", () => {
    const all = parseRouteConfig(
      "/{dir}/{file}/{id}/{data.title}/{meta.n}/{year}",
      undefined,
      "x",
    )!;
    const data = { meta: { n: 3 }, title: "T", year: new Date("2025-03-04") };
    const rendered = renderRoute(all, subject("a/b/c.md", data, "a/b/c"));
    expect(rendered).toEqual({ route: "/a/b/c/a/b/c/T/3/2025-03-04" });
  });

  it("applies lower, upper and raw", () => {
    const t = parseRouteConfig("/{a:lower}/{b:upper}/{c:raw}", undefined, "x")!;
    expect(renderRoute(t, subject("p.md", { a: "AbC", b: "xyz", c: "KeEp" }))).toEqual({
      route: "/abc/XYZ/KeEp",
    });
  });

  it("numbers and booleans are text; arrays, objects and blanks are missing", () => {
    const t = parseRouteConfig("/{v}", undefined, "x")!;
    expect(renderRoute(t, subject("p.md", { v: 7 }))).toEqual({ route: "/7" });
    expect(renderRoute(t, subject("p.md", { v: true }))).toEqual({ route: "/true" });
    for (const v of [[1], { a: 1 }, "  ", null, undefined, new Date("nope")]) {
      const out = renderRoute(t, subject("p.md", { v }));
      expect("error" in out).toBe(true);
    }
  });

  it("names the field and the template when one is missing", () => {
    const out = renderRoute(spec, subject("Frappe/A.md", { slug: "a" }));
    expect(out).toEqual({
      error: expect.stringContaining('field "category" (needed by "{category:slug}"'),
    });
  });

  it("refuses a value that would climb out of the output directory", () => {
    const t = parseRouteConfig("/kb/{slug}", undefined, "kb")!;
    const out = renderRoute(t, subject("A.md", { slug: "../../etc" }));
    expect(out).toEqual({ error: expect.stringContaining('contains a "." or ".." segment') });
  });

  it("a slug transform turns a hostile value into a harmless one", () => {
    const t = parseRouteConfig("/kb/{slug:slug}", undefined, "kb")!;
    expect(renderRoute(t, subject("A.md", { slug: "../../etc" }))).toEqual({ route: "/kb/etc" });
  });

  it("a slug transform that leaves nothing is a missing field", () => {
    const t = parseRouteConfig("/kb/{slug:slug}", undefined, "kb")!;
    expect("error" in renderRoute(t, subject("A.md", { slug: "!!!" }))).toBe(true);
  });

  it("file reads the name without its extension, including a dotless name", () => {
    const t = parseRouteConfig("/{file}", undefined, "x")!;
    expect(renderRoute(t, subject("dir/My Doc.md", {}))).toEqual({ route: "/My Doc" });
    expect(renderRoute(t, subject("dir/NOTES", {}))).toEqual({ route: "/NOTES" });
  });
});

describe("routeParams", () => {
  it("derives named parameters from a one-segment-per-param pattern", () => {
    expect(routeParams("/kb/frappe/bench", "/kb/:category/:slug", ["category", "slug"])).toEqual({
      category: "frappe",
      slug: "bench",
    });
  });

  it("a catch-all takes the rest under the page's last parameter name", () => {
    expect(routeParams("/kb/frappe/bench", "/kb/*", ["path"])).toEqual({
      path: "frappe/bench",
    });
    expect(routeParams("/kb/frappe", "/kb/*", ["slug"])).toEqual({ slug: "frappe" });
    expect(routeParams("/kb/frappe", "/kb/*", [])).toEqual({ path: "frappe" });
  });

  it("a catch-all needs at least one segment", () => {
    expect(routeParams("/kb", "/kb/*", ["path"])).toBeNull();
  });

  it("does not match a different static prefix or segment count", () => {
    expect(routeParams("/docs/a", "/kb/:slug", ["slug"])).toBeNull();
    expect(routeParams("/kb/a/b", "/kb/:slug", ["slug"])).toBeNull();
    expect(routeParams("/kb", "/kb/:slug", ["slug"])).toBeNull();
  });

  it("a static page pattern matches only its own route", () => {
    expect(routeParams("/kb", "/kb", [])).toEqual({});
    expect(routeParams("/kb/a", "/kb", [])).toBeNull();
  });

  it("a catch-all that is not last cannot match", () => {
    expect(routeParams("/a/b/c", "/*/c", ["x"])).toBeNull();
  });
});

describe("routeHref", () => {
  it("applies the site's trailing-slash setting", () => {
    expect(routeHref("/kb/frappe", "always")).toBe("/kb/frappe/");
    expect(routeHref("/kb/frappe", "never")).toBe("/kb/frappe");
    expect(routeHref("/kb/frappe", "ignore")).toBe("/kb/frappe/");
  });

  it("percent-encodes segments", () => {
    expect(routeHref("/kb/a b/ü", "never")).toBe("/kb/a%20b/%C3%BC");
  });

  it("prefixes a locale, and the root stays a single slash", () => {
    expect(routeHref("/kb/x", "always", "/fr")).toBe("/fr/kb/x/");
    expect(routeHref("/", "always")).toBe("/");
    expect(routeHref("/", "never")).toBe("/");
    expect(routeHref("/", "always", "/fr")).toBe("/fr/");
    expect(routeHref("/", "never", "/fr")).toBe("/fr");
  });
});
