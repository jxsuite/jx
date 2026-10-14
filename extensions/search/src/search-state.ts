/**
 * Search-state — the `Search` state class.
 *
 * An ordinary external class (constructor + resolve) with a static `lower` capability
 * (extensions.md §8.3). In browsers, resolve() lazily imports the bundled headless client and
 * queries the emitted index. Under node (compiler-timing bakes, dev-server resolve proxy) it
 * degrades to an empty result — search is a client-side interaction.
 *
 * Lowering: in compiled sites a `timing: "client"` Search def becomes a core `Function` computed
 * that lazy-imports the client bundle, preloads the index once per page, and re-runs reactively
 * when the query state or the ready flag changes. The client module itself reaches the browser
 * through the sidecar bundler via the `$bundle` hint (spec.md §5.3).
 *
 * @docs extending/extensions/search
 * @docs framework/site/search
 */

import { sidecarAssetPath } from "@jxsuite/schema/asset-paths";
import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import type * as ClientModule from "./client.ts";
import type { QueryOptions, SearchResult, SearchResultGroup } from "./client.ts";

/** The npm specifier of the headless browser client, bundled by the site build. */
export const CLIENT_SPECIFIER = "npm:@jxsuite/search/client";

/** A `Search` state def as authored in page state. */
export interface SearchDef {
  $prototype?: string;
  timing?: string;
  /** Query text: a literal string or a `$ref` into page state. */
  query?: string | { $ref: string };
  /** Maximum result groups returned. */
  limit?: number;
  /** Group section hits under their page (default true). */
  group?: boolean;
  /** Override the index URL (defaults to the project's `search.output`). */
  index?: string;
  /**
   * Language to search in. Omitted, the client uses the page's own — `<html lang>`, which the build
   * wrote from the route's locale — so a search box needs no configuration to stop handing a French
   * reader the English copy of the page they are on. `null` searches every language.
   */
  locale?: string | null;
  default?: JsonValue;
  /** Any other key an author wrote on the def: document JSON this class does not read. */
  [key: string]: JsonValue | undefined;
}

/** The context object hosts pass to `lower(def, context)`. */
export interface LowerContext {
  /** The project config. `lower` reads only the raw `search` section's `output`. */
  projectConfig?: { search?: { output?: string } };
  root?: string;
  /** The route being compiled (prototype-resolver.ts passes its source path and path params). */
  route?: { sourcePath?: string; _pathParams?: Record<string, string> };
}

/** The core `Function` def a `Search` def lowers into, plus the `$bundle` host hint. */
export interface LoweredSearchDef {
  /** Client modules the site build must bundle; the host strips the key after reading it. */
  $bundle: string[];
  $prototype: "Function";
  body: string;
  timing: "client";
  default?: JsonValue;
}

/** The part of the bundled client module `resolve` calls. */
type SearchClient = Pick<typeof ClientModule, "preload" | "query">;

/** True when running in a browser; node hosts degrade to empty results. */
function inBrowser(): boolean {
  return typeof document !== "undefined" && isFunction(globalThis.fetch);
}

/** Compile a def's `query` into a client JS expression (`$ref` → state path, literal → string). */
function queryExpression(query: SearchDef["query"]): string {
  if (isNonNullObject(query) && isString(query.$ref)) {
    const path = query.$ref.replace(/^#\//, "").split("/");
    if (path[0] === "state" && path.length > 1) {
      return ["state", ...path.slice(1)].join(".");
    }
  }
  return JSON.stringify(isString(query) ? query : "");
}

export class Search {
  config: SearchDef & { _project?: { search?: { output?: string } } };

  constructor(config: SearchDef) {
    this.config = config;
  }

  /** Grouped search results for the configured query — browser only. */
  async resolve(): Promise<SearchResultGroup[] | SearchResult[]> {
    if (!inBrowser()) {
      console.warn("Search resolves to [] outside the browser — search is a client interaction");
      return [];
    }
    const clientUrl = sidecarAssetPath(CLIENT_SPECIFIER);
    /*
     * SAFETY: `clientUrl` is the sidecar asset path of CLIENT_SPECIFIER, which the site build
     * bundles from ./client.ts (the `$bundle` hint `lower` emits), so the module it serves exports
     * that file's `preload` and `query`.
     */
    const client = (await import(clientUrl)) as SearchClient;
    await client.preload(this.indexUrl());
    const query = isString(this.config.query) ? this.config.query : "";
    const opts: QueryOptions = {
      group: this.config.group ?? true,
      limit: this.config.limit ?? 8,
    };
    if (this.config.locale !== undefined) {
      opts.locale = this.config.locale;
    }
    return client.query(query, opts);
  }

  /** The index URL: def override, then the project's `search.output`, then the default. */
  indexUrl(): string {
    return this.config.index ?? this.config._project?.search?.output ?? "/search-index.json";
  }

  /**
   * Static `lower` capability: compile away into a core Function computed that lazily loads the
   * bundled client + index, then queries reactively. `$bundle` registers the client module with the
   * sidecar bundler (extensions.md §8.3).
   */
  static lower(def: SearchDef, context: LowerContext = {}): LoweredSearchDef {
    const indexUrl = def.index ?? context.projectConfig?.search?.output ?? "/search-index.json";
    const clientUrl = sidecarAssetPath(CLIENT_SPECIFIER);
    /*
     * `locale` is passed only when the def names one. Omitting the key is not the same as passing
     * `undefined` through JSON — the client reads "absent" as "the page's own language", which is
     * the default a search box should have and the one nobody has to configure.
     */
    const queryOptions: QueryOptions = { group: def.group ?? true, limit: def.limit ?? 8 };
    if (def.locale !== undefined) {
      queryOptions.locale = def.locale;
    }
    const opts = JSON.stringify(queryOptions);
    const body = [
      // Reading the ready flag makes the computed re-run when the client finishes loading.
      "void state.__jxSearchReady;",
      "if (!globalThis.__jxSearch) {",
      "  globalThis.__jxSearch = {};",
      `  import(${JSON.stringify(clientUrl)})`,
      `    .then((m) => { globalThis.__jxSearch.m = m; return m.preload(${JSON.stringify(indexUrl)}); })`,
      "    .then(() => { state.__jxSearchReady = true; })",
      "    .catch((err) => console.warn('search client failed to load:', err));",
      "}",
      "const m = globalThis.__jxSearch.m;",
      `return m && m.isReady() ? m.query(${queryExpression(def.query)}, ${opts}) : [];`,
    ].join("\n");
    const lowered: LoweredSearchDef = {
      $bundle: [CLIENT_SPECIFIER],
      $prototype: "Function",
      body,
      timing: "client",
    };
    if (def.default !== undefined) {
      lowered.default = def.default;
    }
    return lowered;
  }
}
