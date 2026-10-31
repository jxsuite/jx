/**
 * Unit tests for client.ts — the headless browser client: memoized preload with retry on failure,
 * synchronous grouped queries over a real MiniSearch index, and the $src state-convention helpers.
 * Fetch is mocked; MiniSearch is real.
 *
 * The client memoizes module-level state, so the load-failure cases run FIRST (they clear the memo)
 * and the success path builds the index the query tests share.
 */

import { describe, expect, test } from "bun:test";
import {
  buildExcerpt,
  buildTokens,
  configure,
  crumbsFromSlug,
  isReady,
  preload,
  query,
  runSearch,
  searchInit,
} from "../src/client";
import type { SearchComponentState, SearchToken } from "../src/client";
import type { SearchIndexEnvelope } from "../src/search-index";

/** Render tokens back to a string, wrapping matched runs, for readable assertions. */
function marked(tokens: SearchToken[]): string {
  return tokens.map((token) => (token.m ? `[${token.t}]` : token.t)).join("");
}

const ENVELOPE: SearchIndexEnvelope = {
  boost: { heading: 2, title: 4 },
  documents: [
    {
      collection: "docs",
      description: "How sites are built",
      heading: "",
      id: "docs:framework/site",
      slug: "framework/site",
      text: "Sites are folders of pages. The build pipeline emits assets and a search index.",
      title: "Site architecture",
      url: "/docs/framework/site/",
    },
    {
      collection: "docs",
      description: "How sites are built",
      heading: "Search index",
      id: "docs:framework/site#search-index",
      slug: "framework/site",
      text: "The emit capability writes the search index into dist.",
      title: "Site architecture",
      url: "/docs/framework/site/#search-index",
    },
    {
      collection: "docs",
      description: "",
      heading: "",
      id: "docs:start/install",
      slug: "start/install",
      text: "Install the toolchain with bun install.",
      title: "Install",
      url: "/docs/start/install/",
    },
    // Two translations of one entry: same slug, different locale, different URL (§13.3).
    {
      collection: "docs",
      description: "",
      heading: "",
      id: "docs:en:greet",
      locale: "en",
      slug: "greet",
      text: "Salutations everyone, from the English copy.",
      title: "Greeting",
      url: "/docs/greet/",
    },
    {
      collection: "docs",
      description: "",
      heading: "",
      id: "docs:fr-CA:greet",
      locale: "fr-CA",
      slug: "greet",
      text: "Salutations tout le monde, depuis la copie francaise.",
      title: "Salutation",
      url: "/fr-ca/docs/greet/",
    },
  ],
  engine: "minisearch",
  fields: ["title", "heading", "text"],
  version: 1,
};

/** The globals these tests replace: `fetch` with a stub, and `document` with a page that has a lang. */
interface GlobalSlots {
  fetch: (input: string) => Promise<Response> | Response;
  document?: object | undefined;
}

const globals: GlobalSlots = globalThis;

function mockFetch(handler: () => Promise<Response> | Response) {
  globals.fetch = handler;
}

/** Let queued microtasks/timers settle (async completions inside the client). */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** A body long enough that the excerpt window has to elide on both sides. */
const LONG_TEXT = `${"alpha ".repeat(40)}needle ${"omega ".repeat(40)}`.trim();

describe("highlight tokens", () => {
  test("marks whole words that start with a term, leaving the rest plain", () => {
    expect(marked(buildTokens("Search the index", ["index"]))).toBe("Search the [index]");
  });

  test("a prefix term highlights the whole word it landed on, case-insensitively", () => {
    expect(marked(buildTokens("An Introduction", ["intro"]))).toBe("An [Introduction]");
  });

  test("marks every occurrence, including at the very start and very end", () => {
    expect(marked(buildTokens("index of the index", ["index"]))).toBe("[index] of the [index]");
  });

  test("adjacent matches keep their separator as a plain run", () => {
    expect(marked(buildTokens("site search index", ["search", "index"]))).toBe(
      "site [search] [index]",
    );
  });

  test("no match yields a single plain run; empty text yields no tokens", () => {
    expect(buildTokens("Site architecture", ["nothing"])).toEqual([
      { m: false, t: "Site architecture" },
    ]);
    expect(buildTokens("", ["anything"])).toEqual([]);
  });

  test("empty and blank terms are ignored rather than matching everything", () => {
    expect(buildTokens("Site", [])).toEqual([{ m: false, t: "Site" }]);
    expect(marked(buildTokens("Site index", ["", "index"]))).toBe("Site [index]");
  });
});

describe("excerpts", () => {
  test("text shorter than the window comes back whole, unelided", () => {
    expect(buildExcerpt("The emit capability writes the index.", ["index"])).toBe(
      "The emit capability writes the index.",
    );
  });

  test("a match in the middle elides on both sides and stays near the window width", () => {
    const excerpt = buildExcerpt(LONG_TEXT, ["needle"]);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).toContain("needle");
    expect(excerpt.length).toBeLessThan(180);
  });

  test("a match near the start keeps the opening intact", () => {
    const excerpt = buildExcerpt(`needle ${"omega ".repeat(40)}`, ["needle"]);
    expect(excerpt.startsWith("needle")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  test("with no match in the body, the opening of the text is used", () => {
    const excerpt = buildExcerpt(LONG_TEXT, ["absent"]);
    expect(excerpt.startsWith("alpha")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  test("blank text yields no excerpt", () => {
    expect(buildExcerpt("   ", ["needle"])).toBe("");
  });
});

describe("breadcrumbs", () => {
  test("ancestor segments are title-cased, the leaf dropped", () => {
    expect(crumbsFromSlug("framework/site/search")).toEqual(["Framework", "Site"]);
  });

  test("hyphens and underscores become spaces", () => {
    expect(crumbsFromSlug("extending/custom-elements/api_reference")).toEqual([
      "Extending",
      "Custom Elements",
    ]);
  });

  test("a top-level slug has no ancestors, and empty segments are dropped", () => {
    expect(crumbsFromSlug("install")).toEqual([]);
    expect(crumbsFromSlug("/start//install/")).toEqual(["Start"]);
  });
});

describe("preload failure handling (runs before the success path)", () => {
  test("query before ready returns [] and kicks off a (failing) preload", async () => {
    mockFetch(() => Promise.reject(new Error("offline")));
    expect(isReady()).toBe(false);
    expect(query("anything")).toEqual([]);
    // Allow the kicked-off preload to settle and clear its memo.
    await settle();
    expect(isReady()).toBe(false);
  });

  test("a non-OK response rejects and clears the memo for retry", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    configure({ indexUrl: "/search-index.json" });
    // oxlint-disable-next-line typescript/await-thenable -- Bun types `.rejects.toThrow` as void, but it resolves a Promise at runtime; the await is required.
    await expect(preload()).rejects.toThrow(/search index fetch failed: 500/);
    expect(isReady()).toBe(false);
  });

  test("searchInit swallows a failed load with a warning instead of rejecting", async () => {
    mockFetch(() => Promise.reject(new Error("still offline")));
    const state: SearchComponentState = {};
    expect(searchInit(state)).toBe(true);
    await settle();
    expect(state.searchReady).toBeUndefined();
    expect(isReady()).toBe(false);
  });
});

describe("preload success + queries", () => {
  test("preload fetches the envelope once and builds the index", async () => {
    let calls = 0;
    mockFetch(() => {
      calls += 1;
      return Response.json(ENVELOPE);
    });
    await preload("/search-index.json");
    await preload(); // Memoized — no second fetch.
    expect(calls).toBe(1);
    expect(isReady()).toBe(true);
  });

  test("grouped query nests section hits under their page, best score first", () => {
    const groups = query("search index");
    expect(groups.length).toBeGreaterThan(0);
    const top = groups[0]!;
    expect(top.slug).toBe("framework/site");
    expect(top.url).toBe("/docs/framework/site/");
    expect(top.title).toBe("Site architecture");
    expect(top.hits.map((h) => h.heading)).toEqual(["Search index"]);
    expect(top.hits[0]!.url).toBe("/docs/framework/site/#search-index");
  });

  test("title boost ranks title matches above body mentions", () => {
    const groups = query("install");
    expect(groups[0]!.slug).toBe("start/install");
  });

  test("limit caps result groups", () => {
    expect(query("site install search", { limit: 1 })).toHaveLength(1);
  });

  test("group:false returns flat rows with breadcrumbs and highlight tokens", () => {
    const rows = query("search index", { group: false });
    expect(rows.length).toBeGreaterThan(1);
    const section = rows.find((row) => row.heading === "Search index")!;
    expect(section.url).toBe("/docs/framework/site/#search-index");
    // A section row trails the page title after the slug's ancestors.
    expect(section.crumbs).toEqual(["Framework", "Site architecture"]);
    expect(marked(section.titleTokens)).toBe("[Search] [index]");
    expect(marked(section.excerptTokens)).toBe(
      "The emit capability writes the [search] [index] into dist.",
    );
    const page = rows.find((row) => row.heading === "")!;
    expect(page.crumbs).toEqual(["Framework"]);
    expect(page.titleTokens).toEqual([{ m: false, t: "Site architecture" }]);
  });

  test("group:false caps how many rows one page contributes", () => {
    const uncapped = query("search index", { group: false });
    expect(uncapped.filter((row) => row.slug === "framework/site").length).toBeGreaterThan(1);
    const capped = query("search index", { group: false, pageCap: 1 });
    expect(capped.filter((row) => row.slug === "framework/site")).toHaveLength(1);
  });

  test("group:false honours limit", () => {
    expect(query("search index install", { group: false, limit: 1 })).toHaveLength(1);
  });

  test("blank queries return no results", () => {
    expect(query("")).toEqual([]);
    expect(query("   ")).toEqual([]);
  });
});

describe("$src state conventions", () => {
  test("searchInit flips searchReady and re-runs a pending query", async () => {
    const state: SearchComponentState = { searchQuery: "install" };
    expect(searchInit(state)).toBe(true);
    await settle();
    expect(state.searchReady).toBe(true);
    expect(state.searchResults?.[0]?.slug).toBe("start/install");
  });

  test("runSearch reads the input event, stores flat rows, and resets the active row", () => {
    const state: SearchComponentState = { searchActive: 3 };
    const results = runSearch(state, { target: { value: "search index" } });
    expect(state.searchQuery).toBe("search index");
    expect(state.searchResults).toBe(results);
    expect(state.searchCount).toBe(results.length);
    expect(state.searchActive).toBe(0);
    expect(results[0]!.slug).toBe("framework/site");
    expect(results[0]!.titleTokens.some((token) => token.m)).toBe(true);
  });

  test("runSearch without an event falls back to state.searchQuery", () => {
    const state: SearchComponentState = { searchQuery: "install" };
    expect(runSearch(state)[0]!.slug).toBe("start/install");
  });
});

// ─── Locale scoping ─────────────────────────────────────────────────────────

/*
 * A multilingual site's index holds every translation of every post. Unscoped, a search on a French
 * page hands the reader the English copy of the page they are already on — ranked first, because it
 * matched the same words.
 */
describe("locale scoping", () => {
  test("a search in one language returns that language's copy, and its URL", () => {
    const french = query("salutations", { locale: "fr-CA" });
    expect(french.map((g) => g.url)).toEqual(["/fr-ca/docs/greet/"]);
    expect(french[0]!.title).toBe("Salutation");

    const english = query("salutations", { locale: "en" });
    expect(english.map((g) => g.url)).toEqual(["/docs/greet/"]);
  });

  // RFC 4647's truncation, at the one length that matters: a reader on /fr-ca/ wants French posts.
  test("a region-qualified page finds the language's entries", () => {
    expect(query("salutations", { locale: "fr" })).toHaveLength(1);
    expect(query("salutations", { locale: "FR-ca" })).toHaveLength(1);
  });

  /*
   * Two translations share a slug, so the group key has to carry the locale — without it these two
   * collapse into one group titled whichever was indexed first.
   */
  test("searching every language keeps the two copies apart", () => {
    const all = query("salutations", { locale: null });
    expect(all).toHaveLength(2);
    expect(all.map((g) => g.url).toSorted()).toEqual(["/docs/greet/", "/fr-ca/docs/greet/"]);
  });

  // An unlocalized collection is not in one language; it is outside the question.
  test("documents with no locale answer every search", () => {
    expect(query("install", { locale: "fr-CA" })).toHaveLength(1);
  });

  /*
   * The default is the page's own language, read from `<html lang>` — the attribute the build wrote
   * from the route's locale, so it is the same answer the index was built against.
   */
  test("with no locale option, the page's own language decides", () => {
    const real = globals.document;
    globals.document = { documentElement: { lang: "fr-CA" } };
    try {
      expect(query("salutations").map((g) => g.url)).toEqual(["/fr-ca/docs/greet/"]);
    } finally {
      globals.document = real;
    }
  });

  // Off a document — a worker, a test, a server render — nothing is scoped away.
  test("no document at all searches everything", () => {
    expect(query("salutations")).toHaveLength(2);
  });
});

// ─── URL scoping ────────────────────────────────────────────────────────────

/*
 * One index serves a site that holds many parts — several projects' documentation, say. A reader in
 * one part searches that part, without the site splitting its index per part at build time.
 */
describe("URL scoping", () => {
  test("only results within the scope come back", () => {
    expect(query("install", { scope: "/docs/start/" }).map((g) => g.url)).toEqual([
      "/docs/start/install/",
    ]);
    expect(query("install", { scope: "/docs/framework/" })).toEqual([]);
  });

  // A section hit carries its page's URL plus a fragment, and is within the scope its page is.
  test("section hits are within their page's scope", () => {
    const rows = query("search index", { group: false, scope: "/docs/framework/site/" });
    expect(rows.map((row) => row.url)).toContain("/docs/framework/site/#search-index");
    expect(rows.every((row) => row.url.startsWith("/docs/framework/site/"))).toBe(true);
  });

  /*
   * The scope is applied before `limit`. Cut after, a scoped search would hand back whichever of the
   * top rows happened to fall inside it, which on a large site is usually none.
   */
  test("limit counts only results within the scope", () => {
    const unscoped = query("site install search", { limit: 1 });
    expect(unscoped.map((g) => g.url)).toEqual(["/docs/framework/site/"]);
    const scoped = query("site install search", { limit: 1, scope: "/docs/start/" });
    expect(scoped.map((g) => g.url)).toEqual(["/docs/start/install/"]);
  });

  // The Web App Manifest's test is a string prefix of the path, and so is this one.
  test("a scope without a trailing slash is a path prefix", () => {
    expect(query("install", { scope: "/docs/sta" })).toHaveLength(1);
  });

  test("an absolute scope on another origin holds nothing", () => {
    expect(query("install", { scope: "https://elsewhere.example/docs/" })).toEqual([]);
  });

  test("a scope that is not a URL holds nothing", () => {
    expect(query("install", { scope: "http://[" })).toEqual([]);
  });

  test("an empty scope searches everything", () => {
    expect(query("search index install", { scope: "" })).toEqual(query("search index install"));
  });

  // Scope and locale are two filters on the same rows, and both have to answer.
  test("scope and locale combine", () => {
    expect(query("salutations", { locale: null, scope: "/fr-ca/" }).map((g) => g.url)).toEqual([
      "/fr-ca/docs/greet/",
    ]);
    expect(query("salutations", { locale: "en", scope: "/fr-ca/" })).toEqual([]);
  });

  // A relative scope resolves against the page's base URL, as a link on that page would.
  test("a relative scope resolves against the document's base URL", () => {
    const real = globals.document;
    globals.document = {
      baseURI: "https://site.example/docs/start/",
      documentElement: { lang: "" },
    };
    try {
      expect(query("install", { scope: "./" }).map((g) => g.url)).toEqual(["/docs/start/install/"]);
      expect(query("install", { scope: "../framework/" })).toEqual([]);
    } finally {
      globals.document = real;
    }
  });

  test("runSearch searches within state.searchScope", () => {
    const state: SearchComponentState = { searchQuery: "install", searchScope: "/docs/framework/" };
    expect(runSearch(state)).toEqual([]);
    state.searchScope = "/docs/start/";
    expect(runSearch(state).map((row) => row.url)).toEqual(["/docs/start/install/"]);
  });

  // The two state keys an author declares are document JSON; a scope that is not a string is ignored.
  test("runSearch ignores a searchScope that is not a string", () => {
    const state: SearchComponentState = { searchQuery: "install", searchScope: 7 };
    expect(runSearch(state)).toHaveLength(1);
  });
});
