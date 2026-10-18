/**
 * Tests for src/browse/library-model.ts — the scan, the collection each file is in, and the two
 * derived axes.
 *
 * The load-bearing one is "a directory it could not read is reported, not swallowed". That single
 * `catch {}` in the predecessor is why an HTTP 500 and an empty project rendered the same sentence,
 * and why a reader could not tell a broken dev server from a new site.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { resetStudioState } from "./harness";
import {
  LIBRARY_LAYOUTS,
  LIBRARY_LAYOUT_LABELS,
  PREVIEW_LAYOUTS,
  filterLibrary,
  folderOf,
  groupByDate,
  groupByFolder,
  isLibraryLayout,
  libraryDate,
  libraryLocales,
  projectLocales,
  entryCollectionOf,
  libraryScanDirs,
  scanLibrary,
} from "../src/browse/library-model";
import { resetAssetVersions, versionOf } from "../src/files/asset-versions";
import type { LibraryFile } from "../src/browse/library-model";
import type { DirEntry } from "../src/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function file(name: string, path: string, extra: Partial<DirEntry> = {}): DirEntry {
  return { name, path, type: "file", ...extra };
}
function dir(name: string, path: string): DirEntry {
  return { name, path, type: "directory" };
}

const TREE = {
  components: [file("button.json", "components/button.json")],
  content: [dir("posts", "content/posts")],
  "content/posts": [
    file("2024-01-02-hello.md", "content/posts/2024-01-02-hello.md", { size: 2048 }),
    file("draft.md", "content/posts/draft.md"),
  ],
  pages: [
    file("index.json", "pages/index.json", { modified: "2024-03-04T10:00:00.000Z", size: 120 }),
    dir("node_modules", "pages/node_modules"),
  ],
  public: [file("logo.png", "public/logo.png")],
} satisfies Record<string, DirEntry[]>;

function listDirectory(tree: Record<string, DirEntry[]> = TREE) {
  return (path: string) => {
    const entries = tree[path];
    if (!entries) {
      return Promise.reject(new Error(`ENOENT: ${path}`));
    }
    return Promise.resolve(entries);
  };
}

beforeEach(() => {
  resetStudioState({
    projectConfig: {
      content: { drafts: {}, posts: { source: "./content/posts/" } },
    },
    projectDirs: ["pages", "content", "components", "public"],
  });
});

// ─── Collections ─────────────────────────────────────────────────────────────

describe("the collection a scanned file is in", () => {
  test("a page is in Pages, an entry in its collection, everything else in none", async () => {
    const scan = await scanLibrary(["pages", "content", "components", "public"], {
      listDirectory: listDirectory(),
    });
    const of = (path: string) => scan.files.find((f) => f.path === path);
    expect(of("pages/index.json")?.collection).toBe("pages");
    expect(of("content/posts/draft.md")?.collection).toBe("posts");
    expect(of("components/button.json")?.collection).toBeNull();
    expect(of("public/logo.png")?.collection).toBeNull();
  });

  test("media is media by its extension, whatever folder it is in", async () => {
    const tree = {
      pages: [file("hero.png", "pages/hero.png"), file("a.json", "pages/a.json")],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["pages"], { listDirectory: listDirectory(tree) });
    expect(scan.files.map((f) => [f.name, f.media, f.collection])).toEqual([
      ["a.json", false, "pages"],
      ["hero.png", true, null],
    ]);
  });

  test("an underscore-prefixed page part is no route, so it is in no collection", async () => {
    const tree = {
      pages: [file("_card.json", "pages/_card.json")],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["pages"], { listDirectory: listDirectory(tree) });
    expect(scan.files[0]!.collection).toBeNull();
  });
});

// ─── The scan ────────────────────────────────────────────────────────────────

describe("scanLibrary", () => {
  test("walks nested directories and types every file it finds", async () => {
    const scan = await scanLibrary(["pages", "content", "components", "public"], {
      listDirectory: listDirectory(),
    });
    expect(scan.failures).toEqual([]);
    expect(scan.files.map((f) => f.path)).toEqual([
      "components/button.json",
      "content/posts/2024-01-02-hello.md",
      "content/posts/draft.md",
      "pages/index.json",
      "public/logo.png",
    ]);
    const post = scan.files.find((f) => f.name === "draft.md")!;
    expect(post.collection).toBe("posts");
    expect(post.type).toBe(".md");
  });

  test("carries size and modification time through when the platform reports them", async () => {
    const scan = await scanLibrary(["pages"], { listDirectory: listDirectory() });
    expect(scan.files[0]).toMatchObject({
      modified: "2024-03-04T10:00:00.000Z",
      size: 120,
    });
  });

  /* The Library walks every media directory, so it is where most content versions are learned —
     the thumbnails it draws next are the first URLs that can use them. */
  test("notes the content versions its listings carry", async () => {
    resetAssetVersions();
    const tree = {
      public: [file("hero.png", "public/hero.png", { version: "abc" })],
    } satisfies Record<string, DirEntry[]>;
    await scanLibrary(["public"], { listDirectory: listDirectory(tree) });
    expect(versionOf("public/hero.png")).toBe("abc");
    resetAssetVersions();
  });

  test("REPORTS a directory it could not read instead of contributing nothing", async () => {
    const scan = await scanLibrary(["pages", "missing"], { listDirectory: listDirectory() });
    expect(scan.files.length).toBe(1);
    expect(scan.failures).toEqual([{ dir: "missing", error: "ENOENT: missing" }]);
  });

  test("a failure at depth names the directory that failed, not its root", async () => {
    const tree = {
      content: [dir("posts", "content/posts")],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["content"], { listDirectory: listDirectory(tree) });
    expect(scan.failures.map((f) => f.dir)).toEqual(["content/posts"]);
  });

  test("never rejects — a half-scan is a real answer the caller must be able to render", async () => {
    const scan = await scanLibrary(["nope"], {
      listDirectory: () => Promise.reject(new Error("boom")),
    });
    expect(scan.files).toEqual([]);
    expect(scan.failures.length).toBe(1);
  });

  test("does not walk node_modules and friends", async () => {
    const asked: string[] = [];
    await scanLibrary(["pages"], {
      listDirectory: (path: string) => {
        asked.push(path);
        return listDirectory()(path);
      },
    });
    expect(asked).toEqual(["pages"]);
  });

  test("a file with no extension still gets a type", async () => {
    const tree = { misc: [file("Makefile", "misc/Makefile")] } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["misc"], { listDirectory: listDirectory(tree) });
    expect(scan.files[0]!.type).toBe("file");
  });

  test("a content file outside every declared collection is in none", async () => {
    const tree = { content: [file("note.md", "content/note.md")] } satisfies Record<
      string,
      DirEntry[]
    >;
    const scan = await scanLibrary(["content"], { listDirectory: listDirectory(tree) });
    expect([scan.files[0]!.type, scan.files[0]!.collection]).toEqual([".md", null]);
  });

  /* The jxsuite docs file their CLI pages under `framework/build/`: skipping the NAME `build`
     dropped two entries and made the Content home and the Site panel disagree. */
  test("walks a collection folder named build or dist", async () => {
    const tree = {
      "content/posts": [dir("build", "content/posts/build"), dir("dist", "content/posts/dist")],
      "content/posts/build": [file("cli.md", "content/posts/build/cli.md")],
      "content/posts/dist": [file("out.md", "content/posts/dist/out.md")],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["content/posts"], { listDirectory: listDirectory(tree) });
    expect(scan.files.map((f) => [f.path, f.collection])).toEqual([
      ["content/posts/build/cli.md", "posts"],
      ["content/posts/dist/out.md", "posts"],
    ]);
  });

  test("an OPTIONAL root that cannot be read is empty, not a failure; its depths still fail", async () => {
    const tree = {
      shown: [dir("gone", "shown/gone")],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(
      ["missing", "shown"],
      { listDirectory: listDirectory(tree) },
      new Set(["missing", "shown"]),
    );
    expect(scan.files).toEqual([]);
    expect(scan.failures.map((f) => f.dir)).toEqual(["shown/gone"]);
  });
});

describe("libraryScanDirs", () => {
  test("adds every directory collection a project directory does not already cover", () => {
    const config = {
      content: {
        catalogue: { source: "./data/products.csv" },
        docs: { source: "../../docs" },
        exhibitions: { source: "./content/exhibitions/{locale}/" },
        none: {},
        posts: { source: "./content/posts/" },
        root: { source: "./" },
      },
    };
    expect(libraryScanDirs(["pages", "content"], config)).toEqual([
      "pages",
      "content",
      "../../docs",
    ]);
    // A collection declared after the project opened, before `content/` existed.
    expect(libraryScanDirs(["pages"], config)).toEqual([
      "pages",
      "../../docs",
      "content/exhibitions",
      "content/posts",
    ]);
  });

  test("hands back the project's own list, untouched, when nothing is missing", () => {
    const dirs = ["pages", "content"];
    expect(libraryScanDirs(dirs, { content: { posts: { source: "content/posts" } } })).toBe(dirs);
    expect(libraryScanDirs(dirs, null)).toBe(dirs);
  });
});

describe("entryCollectionOf", () => {
  test("a declared format lists only its own files; an undeclared one lists everything", () => {
    resetStudioState({
      projectConfig: {
        content: {
          docs: { format: "json", source: "./docs/" },
          notes: { source: "./notes/" },
        },
      },
    });
    expect(entryCollectionOf("docs/a.json")).toBe("docs");
    // `nav.json` beside Markdown pages is the collection's folder, not one of its entries.
    expect(entryCollectionOf("docs/nav.md")).toBeNull();
    expect(entryCollectionOf("notes/a.md")).toBe("notes");
    expect(entryCollectionOf("notes/b.json")).toBe("notes");
    expect(entryCollectionOf("elsewhere/a.md")).toBeNull();
  });

  test("a page is a file the build routes: a backup beside it is in no collection", () => {
    resetStudioState({ projectConfig: {} });
    const routed = [".json", ".md"];
    expect(entryCollectionOf("pages/index.md", routed)).toBe("pages");
    expect(entryCollectionOf("pages/index.json.bak", routed)).toBeNull();
    // With no extensions known, the folder still decides, as it always has.
    expect(entryCollectionOf("pages/index.json.bak")).toBe("pages");
  });

  test("the scan hands its extensions to every file it lists, at every depth", async () => {
    resetStudioState({ projectConfig: {} });
    const tree = {
      pages: [
        file("index.json", "pages/index.json"),
        file("index.json.bak", "pages/index.json.bak"),
        { name: "products", path: "pages/products", type: "directory" },
      ],
      "pages/products": [
        file("[sku].md", "pages/products/[sku].md"),
        file("notes.txt", "pages/products/notes.txt"),
      ],
    } satisfies Record<string, DirEntry[]>;
    const scan = await scanLibrary(["pages"], { listDirectory: listDirectory(tree) }, new Set(), [
      ".json",
      ".md",
    ]);
    const pages = scan.files.filter((f) => f.collection === "pages").map((f) => f.path);
    expect(pages.toSorted()).toEqual(["pages/index.json", "pages/products/[sku].md"]);
  });
});

// ─── Filtering ───────────────────────────────────────────────────────────────

describe("filterLibrary", () => {
  const files: LibraryFile[] = [
    {
      collection: "pages",
      ext: ".json",
      media: false,
      name: "index.json",
      path: "pages/index.json",
      type: ".json",
    },
    {
      collection: "pages",
      ext: ".json",
      media: false,
      name: "about.json",
      path: "pages/about/index.json",
      type: ".json",
    },
    {
      collection: null,
      ext: ".png",
      media: true,
      name: "logo.png",
      path: "public/logo.png",
      type: ".png",
    },
  ];

  test("keeps only the named collection's files", () => {
    expect(filterLibrary(files, { collection: "pages", query: "" }).map((f) => f.name)).toEqual([
      "index.json",
      "about.json",
    ]);
  });

  test("a file in no collection is in no collection's list", () => {
    expect(filterLibrary(files, { collection: "posts", query: "" })).toEqual([]);
  });

  test("matches the query against name AND path, case-insensitively", () => {
    expect(filterLibrary(files, { collection: "pages", query: "ABOUT" }).length).toBe(1);
    expect(filterLibrary(files, { collection: "pages", query: "  index " }).length).toBe(2);
  });

  test("an absent or blank locale filters nothing", () => {
    expect(filterLibrary(files, { collection: "pages", query: "" })).toHaveLength(2);
    expect(filterLibrary(files, { collection: "pages", locale: "", query: "" })).toHaveLength(2);
    expect(filterLibrary(files, { collection: "pages", locale: "   ", query: "" })).toHaveLength(2);
  });

  test("filters on the canonical TAG, never on the label two locales can share", () => {
    const localized: LibraryFile[] = [
      { ...files[0]!, locale: "fr", path: "pages/fr/index.json" },
      { ...files[0]!, locale: "fr-CA", name: "ca.json", path: "pages/fr-ca/ca.json" },
      files[1]!,
    ];
    expect(filterLibrary(localized, { collection: "pages", locale: "fr", query: "" })).toHaveLength(
      1,
    );
    expect(
      filterLibrary(localized, { collection: "pages", locale: "fr-CA", query: "" }).map(
        (f) => f.name,
      ),
    ).toEqual(["ca.json"]);
  });

  test("stacks with the other two rather than replacing them", () => {
    const localized: LibraryFile[] = [
      { ...files[0]!, locale: "fr", path: "pages/fr/index.json" },
      { ...files[0]!, locale: "fr", name: "about.json", path: "pages/fr/about.json" },
    ];
    expect(
      filterLibrary(localized, { collection: "pages", locale: "fr", query: "about" }).map(
        (f) => f.name,
      ),
    ).toEqual(["about.json"]);
    expect(filterLibrary(localized, { collection: "posts", locale: "fr", query: "" })).toEqual([]);
  });
});

// ─── Locales ─────────────────────────────────────────────────────────────────

describe("the locale a file sits under", () => {
  const I18N_TREE = {
    layouts: [file("main.json", "layouts/main.json")],
    pages: [dir("fr", "pages/fr"), dir("de", "pages/de"), file("index.json", "pages/index.json")],
    "pages/de": [file("index.json", "pages/de/index.json")],
    "pages/fr": [file("index.json", "pages/fr/index.json")],
  } satisfies Record<string, DirEntry[]>;

  function multilingual(locales: string[] = ["en", "fr", "de"]) {
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "en", locales } },
      projectDirs: ["pages", "layouts"],
    });
  }

  async function scan() {
    return scanLibrary(["pages", "layouts"], { listDirectory: listDirectory(I18N_TREE) });
  }

  test("comes from the path, and from routing where the path is silent", async () => {
    multilingual();
    const files = await scan();
    const byPath = new Map(files.files.map((f) => [f.path, f.locale]));
    expect(byPath.get("pages/fr/index.json")).toBe("fr");
    expect(byPath.get("pages/de/index.json")).toBe("de");
    /*
     * Under `prefix-except-default` the unprefixed page IS the English copy, and saying so is what
     * lets the facet answer "show me the English pages" — the question it is most often asked, and
     * the one it could not answer while every unprefixed file had no language at all.
     */
    expect(byPath.get("pages/index.json")).toBe("en");
    // Not a page: a layout is shared by every locale rather than belonging to one.
    expect(byPath.get("layouts/main.json")).toBeUndefined();
  });

  // Under `prefix-always` an unprefixed page is outside the locale tree, which routing calls a
  // Mistake rather than the default language — so the facet says nothing about it either.
  test("says nothing about an unprefixed page under prefix-always", async () => {
    resetStudioState({
      projectConfig: {
        i18n: { defaultLocale: "en", locales: ["en", "fr", "de"], routing: "prefix-always" },
      },
      projectDirs: ["pages", "layouts"],
    });
    const files = await scan();
    const byPath = new Map(files.files.map((f) => [f.path, f.locale]));
    expect(byPath.get("pages/index.json")).toBeUndefined();
    expect(byPath.get("pages/fr/index.json")).toBe("fr");
  });

  test("a project that declares no i18n gives every file no locale at all", async () => {
    resetStudioState({ projectConfig: {}, projectDirs: ["pages"] });
    const files = await scan();
    expect(files.files.every((f) => f.locale === undefined)).toBe(true);
  });

  /*
   * `fr` is not a locale this project has, so `pages/fr/` is not a locale directory — it is an
   * ordinary path segment, and the build serves everything under it as the default locale, warning
   * once about the directory that looks like a language and is not (site-architecture.md §13.2).
   * The facet says the same thing the build does rather than inventing a language nothing
   * declares.
   */
  test("a directory the project does not declare is not a locale", async () => {
    multilingual(["en", "de"]);
    const files = await scan();
    const byPath = new Map(files.files.map((f) => [f.path, f.locale]));
    expect(byPath.get("pages/fr/index.json")).toBe("en");
    expect(byPath.get("pages/de/index.json")).toBe("de");
    expect(libraryLocales(files.files)).toEqual(["en", "de"]);
  });

  test("projectLocales answers the declaration, canonicalized and default-first", () => {
    resetStudioState({
      projectConfig: { i18n: { defaultLocale: "EN-us", locales: ["fr", "not_a_tag"] } },
    });
    expect(projectLocales()).toEqual(["en-US", "fr"]);
    resetStudioState({ projectConfig: {} });
    expect(projectLocales()).toEqual([]);
  });

  test("libraryLocales lists only what is PRESENT, in declaration order", async () => {
    multilingual(["en", "de", "fr"]);
    const files = await scan();
    /* `en` is present without a directory of its own — under `prefix-except-default` the unprefixed
       pages are its, which is the whole reason the facet can offer it at all. `layouts/main.json`
       belongs to no language and puts nothing in the list. */
    expect(libraryLocales(files.files)).toEqual(["en", "de", "fr"]);
  });

  // Under `prefix-always` an unprefixed page is outside the locale tree, so the default language
  // Appears only once something is actually written in it.
  test("libraryLocales offers the default only where routing puts pages in it", async () => {
    resetStudioState({
      projectConfig: {
        i18n: { defaultLocale: "en", locales: ["en", "de", "fr"], routing: "prefix-always" },
      },
      projectDirs: ["pages", "layouts"],
    });
    const files = await scan();
    expect(libraryLocales(files.files)).toEqual(["de", "fr"]);
  });

  test("libraryLocales is empty when nothing carries a locale", () => {
    multilingual();
    expect(libraryLocales([])).toEqual([]);
  });
});

// ─── Layouts ─────────────────────────────────────────────────────────────────

describe("layouts", () => {
  test("every layout has a label, and only Cards draws previews", () => {
    for (const layout of LIBRARY_LAYOUTS) {
      expect(LIBRARY_LAYOUT_LABELS[layout]).toBeTruthy();
    }
    expect([...PREVIEW_LAYOUTS]).toEqual(["cards"]);
  });

  test("isLibraryLayout is the guard the setter refuses through", () => {
    expect(isLibraryLayout("board")).toBe(true);
    expect(isLibraryLayout("gallery")).toBe(false);
  });
});

// ─── Derived axes ────────────────────────────────────────────────────────────

describe("libraryDate", () => {
  const base: LibraryFile = {
    collection: "posts",
    ext: ".md",
    media: false,
    name: "post.md",
    path: "content/post.md",
    type: "Posts",
  };

  test("the authored date in the filename wins over the filesystem's mtime", () => {
    expect(
      libraryDate({
        ...base,
        modified: "2020-01-01T00:00:00.000Z",
        name: "2024-01-02-hello.md",
      }),
    ).toBe("2024-01-02");
  });

  test("falls back to the modification time", () => {
    expect(libraryDate({ ...base, modified: "2024-05-06T12:00:00.000Z" })).toBe("2024-05-06");
  });

  test("a file with neither is undated — it is NOT parked on today", () => {
    expect(libraryDate(base)).toBeNull();
    expect(libraryDate({ ...base, modified: "not a date" })).toBeNull();
  });
});

describe("grouping", () => {
  const entry = (name: string, path: string): LibraryFile => ({
    collection: "posts",
    ext: ".md",
    media: false,
    name,
    path,
    type: ".md",
  });
  const files: LibraryFile[] = [
    entry("2024-01-02-a.md", "c/a.md"),
    entry("2024-03-04-b.md", "c/b.md"),
    entry("2024-01-02-c.md", "c/2024/c.md"),
    { ...entry("index.json", "pages/index.json"), collection: "pages", ext: ".json" },
  ];

  test("days come back newest first, with the undated set apart", () => {
    const { days, undated } = groupByDate(files);
    expect(days.map((d) => d.date)).toEqual(["2024-03-04", "2024-01-02"]);
    expect(days[1]!.files.length).toBe(2);
    expect(undated.map((f) => f.name)).toEqual(["index.json"]);
  });

  test("board columns are the folders the files are in, in path order", () => {
    expect(groupByFolder(files).map((g) => [g.group, g.files.length])).toEqual([
      ["c", 2],
      ["c/2024", 1],
      ["pages", 1],
    ]);
  });

  test("a file at the root is in the root folder", () => {
    expect(folderOf("README.md")).toBe(".");
    expect(folderOf("pages/blog/a.md")).toBe("pages/blog");
  });
});
