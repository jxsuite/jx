/**
 * Unit tests for search-state.ts — the Search state class: lower() shapes (queries, index
 * resolution, $bundle registration) and resolve() in browser and node environments.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { sidecarAssetPath } from "@jxsuite/schema/asset-paths";
import { CLIENT_SPECIFIER, Search } from "../src/search-state";
import type { SearchResultGroup } from "../src/client";

const CLIENT_URL = sidecarAssetPath(CLIENT_SPECIFIER);

/** The global the browser check probes. Bun has no `document`, so the resolve tests install one. */
interface DocumentSlot {
  document?: object;
  /** The client handle a lowered body keeps between runs. */
  __jxSearch?: object;
}

const globals: DocumentSlot = globalThis;

describe("Search.lower", () => {
  test("compiles a $ref query into a reactive state expression", () => {
    const lowered = Search.lower({ query: { $ref: "#/state/q" } });
    expect(lowered.$prototype).toBe("Function");
    expect(lowered.timing).toBe("client");
    expect(lowered.$bundle).toEqual([CLIENT_SPECIFIER]);
    const { body } = lowered;
    expect(body).toContain("return");
    expect(body).toContain("m.query(state.q, ");
    expect(body).toContain(`import(${JSON.stringify(CLIENT_URL)})`);
    expect(body).toContain('m.preload("/search-index.json")');
  });

  test("nested $ref paths and literal queries compile correctly", () => {
    expect(Search.lower({ query: { $ref: "#/state/ui/q" } }).body).toContain(
      "m.query(state.ui.q, ",
    );
    expect(Search.lower({ query: "fixed terms" }).body).toContain('m.query("fixed terms", ');
    // Refs outside state degrade to an empty literal query.
    expect(Search.lower({ query: { $ref: "#/$params/slug" } }).body).toContain('m.query("", ');
  });

  test("index resolution: def override, then projectConfig.search.output, then default", () => {
    const fromProject = Search.lower(
      { query: "x" },
      { projectConfig: { search: { output: "/idx.json" } } },
    );
    expect(fromProject.body).toContain('m.preload("/idx.json")');

    const fromDef = Search.lower(
      { index: "/other.json", query: "x" },
      { projectConfig: { search: { output: "/idx.json" } } },
    );
    expect(fromDef.body).toContain('m.preload("/other.json")');
  });

  test("limit/group options and default value pass through", () => {
    const lowered = Search.lower({ default: null, group: false, limit: 3, query: "x" });
    expect(lowered.body).toContain('{"group":false,"limit":3}');
    expect(lowered.default).toBeNull();
    expect(Search.lower({ query: "x" }).default).toBeUndefined();
  });

  /*
   * An absent `locale` is not the same as a null one, and the difference has to survive being
   * serialized into the emitted call: absent means "the page's own language", which is the default
   * a search box should have and the one nobody configures. Null means "every language".
   */
  test("locale is passed only when the def names one", () => {
    expect(Search.lower({ query: "x" }).body).not.toContain("locale");
    expect(Search.lower({ locale: "fr-CA", query: "x" }).body).toContain('"locale":"fr-CA"');
    expect(Search.lower({ locale: null, query: "x" }).body).toContain('"locale":null');
  });

  test("a literal scope is baked into the query options", () => {
    expect(Search.lower({ query: "x" }).body).not.toContain("scope");
    expect(Search.lower({ query: "x", scope: "/example/docs/" }).body).toContain(
      '"scope":"/example/docs/"',
    );
  });

  /*
   * A `$ref` scope has to reach the client as the state value at query time, so the emitted body is
   * run here rather than read: the options it builds are what the client is handed.
   */
  test("a $ref scope is read from state each time the query runs", () => {
    const { body } = Search.lower({
      limit: 4,
      query: { $ref: "#/state/q" },
      scope: { $ref: "#/state/nav/scope" },
    });
    const query = mock(() => []);
    globals.__jxSearch = { m: { isReady: () => true, query } };
    try {
      const run = new Function("state", body);
      run({ nav: { scope: "/example/docs/" }, q: "install" });
      expect(query).toHaveBeenLastCalledWith("install", {
        group: true,
        limit: 4,
        scope: "/example/docs/",
      });
      run({ nav: { scope: "/other/docs/" }, q: "install" });
      expect(query).toHaveBeenLastCalledWith("install", {
        group: true,
        limit: 4,
        scope: "/other/docs/",
      });
    } finally {
      delete globals.__jxSearch;
    }
  });
});

describe("Search resolve", () => {
  afterEach(() => {
    delete globals.document;
  });

  test("degrades to [] with a warning outside the browser", async () => {
    const search = new Search({ query: "anything" });
    expect(await search.resolve()).toEqual([]);
  });

  test("in browsers, loads the bundled client, preloads, and queries", async () => {
    globals.document = {};
    const preload = mock(async () => {});
    const hit: SearchResultGroup = {
      collection: "docs",
      description: "",
      hits: [],
      score: 1,
      slug: "hit",
      title: "Hit",
      url: "/docs/hit/",
    };
    const query = mock(() => [hit]);
    await mock.module(CLIENT_URL, () => ({ preload, query }));

    const search = new Search({ index: "/custom.json", limit: 5, query: "docs" });
    const results = await search.resolve();
    expect(results).toEqual([hit]);
    expect(preload).toHaveBeenCalledWith("/custom.json");
    expect(query).toHaveBeenCalledWith("docs", { group: true, limit: 5 });
  });

  test("resolve forwards a named locale, and omits the key when the def has none", async () => {
    globals.document = {};
    const preload = mock(async () => {});
    const query = mock(() => []);
    await mock.module(CLIENT_URL, () => ({ preload, query }));

    await new Search({ locale: null, query: "docs" }).resolve();
    expect(query).toHaveBeenCalledWith("docs", { group: true, limit: 8, locale: null });

    await new Search({ query: "docs" }).resolve();
    expect(query).toHaveBeenLastCalledWith("docs", { group: true, limit: 8 });
  });

  test("resolve forwards a literal scope", async () => {
    globals.document = {};
    const preload = mock(async () => {});
    const query = mock(() => []);
    await mock.module(CLIENT_URL, () => ({ preload, query }));

    await new Search({ query: "docs", scope: "/example/docs/" }).resolve();
    expect(query).toHaveBeenCalledWith("docs", { group: true, limit: 8, scope: "/example/docs/" });
  });

  test("indexUrl precedence: def, then _project.search.output, then default", () => {
    expect(new Search({ index: "/a.json" }).indexUrl()).toBe("/a.json");
    const withProject = new Search({});
    withProject.config._project = { search: { output: "/b.json" } };
    expect(withProject.indexUrl()).toBe("/b.json");
    expect(new Search({}).indexUrl()).toBe("/search-index.json");
  });
});
