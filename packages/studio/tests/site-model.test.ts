/**
 * The Site panel's derivations (`src/panels/site-model.ts`, specs/studio.md §5.7): route order, the
 * collection nesting, the labels, and the filter. Pure, so no DOM and no project.
 */
import { describe, expect, test } from "bun:test";
import {
  entryCountLabel,
  filterNeedle,
  filterPageRows,
  humanize,
  localeMarked,
  matchesFilter,
  pageLabel,
  pageRows,
  singularLabel,
  templateRows,
  usedByLabel,
} from "../src/panels/site-model";
import { fileToRoute } from "@jxsuite/site/routes";
import { resolveI18n } from "@jxsuite/schema/locale";
import type { SitePageFact } from "../src/panels/site-model";

const page = (path: string, contentType: string | null = null): SitePageFact => ({
  contentType,
  path,
});

describe("pageRows — routes come from the router", () => {
  const pages = [
    page("pages/blog/[slug].json", "posts"),
    page("pages/about.json"),
    page("pages/docs/[...rest].json"),
    page("pages/index.json"),
    page("pages/blog/index.json"),
    page("pages/_partials/card.json"),
    page("pages/tags/[tag].json", "missing"),
  ];
  const collections = new Map<string, number | null>([["posts", 12]]);

  test("home first, static before dynamic before catch-all, and the router's opt-outs dropped", () => {
    const rows = pageRows(pages, collections, null);
    expect(rows.map((row) => row.detail)).toEqual([
      "/",
      "/about",
      "/blog",
      "12 entries",
      "/blog/:slug",
      "/tags/:tag",
      "/docs/*",
    ]);
    expect(rows.map((row) => row.path)).not.toContain("pages/_partials/card.json");
  });

  test("a dynamic page over a declared collection nests under a heading for it", () => {
    const rows = pageRows(pages, collections, null);
    const heading = rows.find((row) => row.kind === "collection");
    expect(heading).toMatchObject({
      detail: "12 entries",
      key: "collection:posts",
      label: "Posts",
      path: "",
    });
    const entry = rows.find((row) => row.kind === "entry-page");
    expect(entry).toMatchObject({ detail: "/blog/:slug", label: "Post page" });
    expect(rows.indexOf(entry!)).toBe(rows.indexOf(heading!) + 1);
  });

  test("a collection's pages stay together under its heading when routes interleave", () => {
    // The museum's three localized exhibition pages sort around another collection's page.
    // Nesting is by position, so each collection's group must be contiguous under its heading.
    const interleaved = [
      page("pages/ar/exhibitions/[slug].json", "exhibitions"),
      page("pages/events/[slug].json", "events"),
      page("pages/exhibitions/[slug].json", "exhibitions"),
      page("pages/fr-ca/expositions/[slug].json", "exhibitions"),
      page("pages/visit.json"),
    ];
    const counts = new Map<string, number | null>([
      ["exhibitions", 9],
      ["events", 1],
    ]);
    const rows = pageRows(interleaved, counts, null);
    expect(rows.map((row) => [row.kind, row.detail])).toEqual([
      ["page", "/visit"],
      ["collection", "9 entries"],
      ["entry-page", "/ar/exhibitions/:slug"],
      ["entry-page", "/exhibitions/:slug"],
      ["entry-page", "/fr-ca/expositions/:slug"],
      ["collection", "1 entry"],
      ["entry-page", "/events/:slug"],
    ]);
  });

  test("a contentType naming no declared collection is an ordinary page, not a heading", () => {
    const rows = pageRows(pages, collections, null);
    const tags = rows.find((row) => row.path === "pages/tags/[tag].json");
    expect(tags?.kind).toBe("page");
    expect(rows.filter((row) => row.kind === "collection")).toHaveLength(1);
  });

  test("the focused document's row is selected", () => {
    const rows = pageRows(pages, collections, "pages/about.json");
    expect(rows.filter((row) => row.selected === "true").map((row) => row.path)).toEqual([
      "pages/about.json",
    ]);
  });

  test("a count still being read leaves the heading's detail empty", () => {
    const rows = pageRows(pages, new Map([["posts", null]]), null);
    expect(rows.find((row) => row.kind === "collection")?.detail).toBe("");
  });
});

describe("pageRows — what the build routes, and which language", () => {
  test("a file without a routed extension is not a page", () => {
    const rows = pageRows(
      [page("pages/index.md"), page("pages/index.json.bak"), page("pages/about.md")],
      new Map(),
      null,
      { extensions: [".json", ".md"] },
    );
    expect(rows.map((row) => row.path)).toEqual(["pages/index.md", "pages/about.md"]);
  });

  test("a page in a locale folder is named for its route without the folder, marked with it", () => {
    const { i18n } = resolveI18n({
      i18n: { defaultLocale: "en", locales: ["en", "ar", "fr-CA"] },
    });
    const rows = pageRows(
      [
        page("pages/index.json"),
        page("pages/ar/index.json"),
        page("pages/fr-ca/a-propos.json"),
        page("pages/exhibitions/[slug].json", "exhibitions"),
        page("pages/ar/exhibitions/[slug].json", "exhibitions"),
      ],
      new Map<string, number | null>([["exhibitions", 3]]),
      null,
      { i18n },
    );
    const labels = new Map(rows.map((row) => [row.path || row.key, row.label]));
    expect(labels.get("pages/index.json")).toBe("Home");
    expect(labels.get("pages/ar/index.json")).toBe("Home (ar)");
    expect(labels.get("pages/fr-ca/a-propos.json")).toBe("A propos (fr-CA)");
    expect(labels.get("pages/exhibitions/[slug].json")).toBe("Exhibition page");
    expect(labels.get("pages/ar/exhibitions/[slug].json")).toBe("Exhibition page (ar)");
  });

  test("without an i18n, a folder that looks like a language is an ordinary segment", () => {
    expect(pageLabel(fileToRoute("pages/ar/index.json"), "pages/ar/index.json")).toBe("Ar");
    expect(localeMarked("Home", "pages/ar/index.json", null)).toBe("Home");
  });
});

describe("labels", () => {
  test("a page is named for its route, an index file for its directory", () => {
    expect(pageLabel(fileToRoute("pages/index.json"), "pages/index.json")).toBe("Home");
    expect(pageLabel(fileToRoute("pages/about-us.md"), "pages/about-us.md")).toBe("About us");
    expect(pageLabel(fileToRoute("pages/blog/index.json"), "pages/blog/index.json")).toBe("Blog");
    expect(pageLabel(fileToRoute("pages/p/[id].json"), "pages/p/[id].json")).toBe("P");
    expect(
      pageLabel(fileToRoute("pages/project_tag/[slug].json"), "pages/project_tag/[slug].json"),
    ).toBe("Project tag");
    expect(
      pageLabel(fileToRoute("pages/service-type/[slug].json"), "pages/service-type/[slug].json"),
    ).toBe("Service type");
    expect(pageLabel(fileToRoute("pages/[...rest].json"), "pages/[...rest].json")).toBe("Rest");
  });

  test("humanize and singularLabel", () => {
    expect(humanize("site_header")).toBe("Site header");
    expect(humanize("---")).toBe("---");
    expect(singularLabel("posts")).toBe("Post");
    expect(singularLabel("stories")).toBe("Story");
    expect(singularLabel("glass")).toBe("Glass");
    expect(singularLabel("staff")).toBe("Staff");
  });

  test("counts read as an author would say them", () => {
    expect(entryCountLabel(1)).toBe("1 entry");
    expect(entryCountLabel(0)).toBe("0 entries");
    expect(entryCountLabel(null)).toBe("");
    expect(usedByLabel(null)).toBe("");
    expect(usedByLabel(0)).toBe("not used yet");
    expect(usedByLabel(1)).toBe("used by 1 page");
    expect(usedByLabel(4)).toBe("used by 4 pages");
  });
});

describe("the filter narrows every section by name, route or path", () => {
  const rows = pageRows(
    [page("pages/index.json"), page("pages/about.json"), page("pages/blog/[slug].json", "posts")],
    new Map([["posts", 3]]),
    null,
  );

  test("an empty needle keeps everything", () => {
    expect(filterNeedle("   ")).toBe("");
    expect(matchesFilter("", "anything")).toBe(true);
    expect(filterPageRows(rows, "")).toEqual(rows);
  });

  test("a page match keeps the page; a nested match brings its heading", () => {
    expect(filterPageRows(rows, "about").map((row) => row.label)).toEqual(["About"]);
    expect(filterPageRows(rows, "/blog/").map((row) => row.label)).toEqual(["Posts", "Post page"]);
  });

  test("a heading match keeps the whole group", () => {
    expect(filterPageRows(rows, filterNeedle("POSTS")).map((row) => row.kind)).toEqual([
      "collection",
      "entry-page",
    ]);
  });

  test("templates are the JSON layouts, sorted, filtered, and counted when known", () => {
    const usage = new Map([["layouts/base.json", 3]]);
    const all = templateRows(
      ["layouts/post.json", "layouts/base.json", "layouts/notes.md"],
      (path) => usage.get(path) ?? null,
      "layouts/post.json",
      "",
    );
    expect(all.map((row) => [row.label, row.detail, row.selected])).toEqual([
      ["Base", "used by 3 pages", "false"],
      ["Post", "", "true"],
    ]);
    expect(templateRows(["layouts/base.json"], () => null, null, "post")).toEqual([]);
    // The default layout is used by every page that names none, which no reference counts.
    expect(
      templateRows(["layouts/base.json"], () => 0, null, "", "layouts/base.json")[0]?.detail,
    ).toBe("default layout");
  });
});
