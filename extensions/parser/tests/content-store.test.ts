/**
 * Content-store tests — the `content` section loaded whole or on demand (src/content-loader.ts's
 * `ContentStore`, src/content-data.ts), and the frontmatter-only read that makes on demand cheap.
 *
 * The load-bearing property is parity: a collection loaded lazily, then given its bodies, must be
 * byte-for-byte the collection a build loads whole, warnings included. The vault fixture is the
 * corpus because it exercises everything a body pass does (links to routed, unpublished and missing
 * documents, README ids, `where`, assets); the fake format counts loads.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { buildExtensionRegistry } from "@jxsuite/schema/extension-registry";
import { isNonNullObject } from "@jxsuite/schema/guards";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import { FormatEntry, FormatRegistry } from "@jxsuite/schema/format-registry";
import type { FormatHostIO } from "@jxsuite/schema/format-registry";
import type { ContentFieldValue, JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContentCollection, ContentEntry } from "../src/content.ts";
import { entriesOf } from "../src/content-data.ts";
import { Content, ContentStore } from "../src/content-loader.ts";
import type { ContentSection } from "../src/content-loader.ts";
import { Markdown } from "../src/markdown.ts";
import { processMarkdown, readFrontmatter } from "../src/md.ts";
import type { ContentLoaderEntry } from "../src/types.ts";
import { KB_TYPE, writeVault } from "./vault-fixture.ts";

const TMP = mkdtempSync(join(tmpdir(), "jx-parser-content-store-"));

beforeAll(() => {
  writeVault(join(TMP, "vault"));
  mkdirSync(join(TMP, "posts"), { recursive: true });
  writeFileSync(
    join(TMP, "posts/hello.md"),
    "---\ntitle: Hello\nauthor: jane\n---\n\n# Hello\n\nBy Jane.\n",
  );
  writeFileSync(join(TMP, "posts/second.md"), "---\ntitle: Second\nauthor: ghost\n---\n\nText.\n");
  mkdirSync(join(TMP, "authors"), { recursive: true });
  writeFileSync(join(TMP, "authors/jane.md"), "---\nname: Jane\n---\n\nJane writes.\n");
  mkdirSync(join(TMP, "ext"), { recursive: true });
  writeFileSync(
    join(TMP, "ext/jx-extension.json"),
    JSON.stringify({
      classes: {
        Content: resolve(import.meta.dir, "../src/Content.class.json"),
        Markdown: resolve(import.meta.dir, "../src/Markdown.class.json"),
      },
      name: "parser-fixture",
    }),
  );
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

const origWarn = console.warn;
afterEach(() => {
  console.warn = origWarn;
});

function captureWarnings(): string[] {
  const warnings: string[] = [];
  console.warn = (msg: string) => warnings.push(msg);
  return warnings;
}

function nodeIO(): FormatHostIO {
  return {
    importModule: async (path) => {
      try {
        return await import(pathToFileURL(path).href);
      } catch {
        return await import(pathToFileURL(`${path.slice(0, -3)}.ts`).href);
      }
    },
    loadJson: (path) => {
      const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"));
      return Promise.resolve(parsed);
    },
    resolvePath: (base, ref) => (isAbsolute(ref) ? ref : resolve(dirname(base), ref)),
  };
}

let registryPromise: Promise<ExtensionRegistry> | undefined;
function registry(): Promise<ExtensionRegistry> {
  registryPromise ??= buildExtensionRegistry(["./ext"], nodeIO(), resolve(TMP, "project.json"));
  return registryPromise;
}

const VAULT_SECTION: ContentSection = { kb: { ...KB_TYPE, source: "./vault" } };

const RELATED_SECTION: ContentSection = {
  authors: { format: "Markdown", source: "./authors" },
  posts: {
    format: "Markdown",
    schema: { properties: { author: { $ref: "#/content/authors", type: "string" } } },
    source: "./posts",
  },
};

async function sectionData(section: ContentSection, lazy: boolean, projectConfig?: ProjectConfig) {
  return await Content.projectData(section, {
    projectConfig,
    registry: await registry(),
    root: TMP,
    ...(lazy && { lazy: true }),
  });
}

/** The entries a store holds for `name`, failing the test when the type is absent. */
function typeOf(data: ReadonlyMap<string, ContentLoaderEntry[]>, name: string) {
  const entries = data.get(name);
  if (entries === undefined) {
    throw new Error(`no content type "${name}" was loaded`);
  }
  return entries;
}

/** A relationship field's resolved entry, failing the test when it still holds the id. */
function related(value: ContentFieldValue | undefined): ContentLoaderEntry {
  const entry = isNonNullObject(value) && !Array.isArray(value) && "data" in value ? value : null;
  if (entry === null) {
    throw new Error(`expected a related entry, got ${JSON.stringify(value)}`);
  }
  /* SAFETY: a relationship field holds the entry `resolveContentTypeRefs` put there, checked above
     to be an object carrying `data`, which only an entry does among field values. */
  return entry as ContentLoaderEntry;
}

// ─── Parity ──────────────────────────────────────────────────────────────────

describe("a lazily loaded collection is the collection a build loads", () => {
  it("serializes identically once its bodies are given, and warns the same", async () => {
    const wholeWarnings = captureWarnings();
    const whole = await sectionData(VAULT_SECTION, false);
    const lazyWarnings = captureWarnings();
    const lazy = await sectionData(VAULT_SECTION, true);
    const entries = (await lazy.load("kb")) ?? [];
    await lazy.materialize(entries);
    expect(JSON.stringify(entries)).toBe(JSON.stringify(typeOf(whole, "kb")));
    expect(entries.length).toBeGreaterThan(3);
    expect(lazyWarnings.toSorted()).toEqual(wholeWarnings.toSorted());
  });

  it("is whole after complete(), relationships and related bodies included", async () => {
    captureWarnings();
    const whole = await sectionData(RELATED_SECTION, false);
    const lazy = await sectionData(RELATED_SECTION, true);
    await lazy.complete();
    expect(JSON.stringify([...lazy])).toBe(JSON.stringify([...whole]));
  });

  it("a whole store's on-demand methods answer what it already holds", async () => {
    captureWarnings();
    const whole = await sectionData(RELATED_SECTION, false);
    const posts = typeOf(whole, "posts");
    expect(await whole.load("posts")).toBe(posts);
    await whole.materialize(posts);
    await whole.complete();
    expect(typeOf(whole, "posts")).toBe(posts);
  });
});

// ─── On demand ───────────────────────────────────────────────────────────────

describe("a lazy store", () => {
  it("loads nothing until a type is asked for, then only its frontmatter", async () => {
    captureWarnings();
    const lazy = await sectionData(VAULT_SECTION, true);
    expect(lazy.size).toBe(0);
    const entries = (await lazy.load("kb")) ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.$children).toBeUndefined();
      expect(entry._meta?.excerpt).toBeUndefined();
      expect(entry._meta?.route).toBeDefined();
      expect(entry.data.title).toBeDefined();
    }
  });

  it("gives only the entries it is asked about their bodies", async () => {
    captureWarnings();
    const lazy = await sectionData(VAULT_SECTION, true);
    const [first, second] = (await lazy.load("kb")) ?? [];
    await lazy.materialize([first, null, undefined]);
    expect(first?.$children).toBeDefined();
    expect(first?._meta?.toc).toBeDefined();
    expect(second?.$children).toBeUndefined();
  });

  it("answers undefined for a type the section does not declare", async () => {
    const lazy = await sectionData(VAULT_SECTION, true);
    expect(await lazy.load("nope")).toBeUndefined();
    expect(await lazy.load("toString")).toBeUndefined();
  });

  it("loads a type with every type its schema relates it to, and their bodies with it", async () => {
    captureWarnings();
    const lazy = await sectionData(RELATED_SECTION, true);
    const posts = (await lazy.load("posts")) ?? [];
    expect(lazy.has("authors")).toBe(true);
    const hello = posts.find((post) => post.id === "hello")!;
    const jane = related(hello.data.author);
    expect(jane.id).toBe("jane");
    expect(jane.$children).toBeUndefined();
    await lazy.materialize([hello]);
    expect(jane.$children).toBeDefined();
    // An id with no entry stays the id, as in a whole load.
    expect(posts.find((post) => post.id === "second")?.data.author).toBe("ghost");
  });

  it("resolves a type's relationships once however it is reached", async () => {
    captureWarnings();
    const lazy = await sectionData(RELATED_SECTION, true);
    const [viaPosts] = await Promise.all([lazy.load("posts"), lazy.load("authors")]);
    await lazy.load("posts");
    const hello = viaPosts?.find((post) => post.id === "hello");
    expect(related(hello?.data.author).id).toBe("jane");
  });

  it("throws a broken link of a `links: error` collection when that entry's body loads", async () => {
    captureWarnings();
    const lazy = await sectionData({ kb: { ...KB_TYPE, links: "error", source: "./vault" } }, true);
    const entries = (await lazy.load("kb")) ?? [];
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(lazy.materialize(entries)).rejects.toThrow(
      /Content links: "kb" has \d+ broken link/,
    );
  });
});

// ─── Sharing and retrying (counted through a fake format) ────────────────────

interface FakeFormat {
  loads: string[];
  discovers: number;
  failNext: { load?: boolean; body?: boolean };
  formats: FormatRegistry;
}

/** A format whose `load` honors `deferBody`, records each call, and can be told to fail once. */
function fakeFormat(): FakeFormat {
  const state: FakeFormat = {
    discovers: 0,
    failNext: {},
    formats: new FormatRegistry([]),
    loads: [],
  };
  const Impl = {
    discover: () => {
      state.discovers += 1;
      return ["/virtual/a.fake", "/virtual/b.fake"];
    },
    load: (path: string, options?: { deferBody?: boolean }) => {
      const deferred = options?.deferBody === true;
      state.loads.push(`${deferred ? "head" : "full"}:${path}`);
      if (deferred ? state.failNext.load : state.failNext.body) {
        state.failNext = {};
        throw new Error("transient");
      }
      const id = path.slice("/virtual/".length, -".fake".length);
      const entry: ContentLoaderEntry = { body: id, data: { title: id }, id };
      return deferred ? [entry] : [{ $children: [id], ...entry, _meta: { excerpt: id } }];
    },
  };
  const io: FormatHostIO = {
    importModule: () => Promise.resolve({ Fake: Impl }),
    loadJson: () => Promise.reject(new Error("not used")),
    resolvePath: (_base, ref) => ref,
  };
  const classDef = {
    $defs: {
      methods: {
        discover: { identifier: "discover", role: "discover" },
        load: { identifier: "load", role: "load" },
      },
    },
    $implementation: "./fake.js",
    format: { extensions: [".fake"] },
    title: "Fake",
  };
  state.formats = new FormatRegistry([
    new FormatEntry("Fake", "/virtual/fake.class.json", classDef, io),
  ]);
  return state;
}

function fakeStore(format: FakeFormat) {
  return ContentStore.lazy({
    formats: format.formats,
    projectConfig: undefined,
    root: TMP,
    section: { notes: { format: "Fake", source: "./notes" } },
  });
}

describe("a lazy store shares work and retries failures", () => {
  it("loads a type once for concurrent asks, and each body once", async () => {
    const format = fakeFormat();
    const store = fakeStore(format);
    const [a, b] = await Promise.all([store.load("notes"), store.load("notes")]);
    expect(a).toBe(b);
    expect(format.discovers).toBe(1);
    await Promise.all([store.materialize(a ?? []), store.materialize(a ?? [])]);
    await store.materialize(a ?? []);
    expect(format.loads.toSorted()).toEqual([
      "full:/virtual/a.fake",
      "full:/virtual/b.fake",
      "head:/virtual/a.fake",
      "head:/virtual/b.fake",
    ]);
    expect(a?.[0]).toEqual({
      $children: ["a"],
      _meta: { excerpt: "a" },
      body: "a",
      data: { title: "a" },
      id: "a",
    });
  });

  it("tries a type again after its load failed", async () => {
    const format = fakeFormat();
    const store = fakeStore(format);
    format.failNext = { load: true };
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(store.load("notes")).rejects.toThrow(/transient/);
    const retried = await store.load("notes");
    expect(retried?.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("tries a body again after it failed", async () => {
    const format = fakeFormat();
    const store = fakeStore(format);
    const [first] = (await store.load("notes")) ?? [];
    format.failNext = { body: true };
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(store.materialize([first])).rejects.toThrow(/transient/);
    expect(first?.$children).toBeUndefined();
    await store.materialize([first]);
    expect(first?.$children).toEqual(["a"]);
  });
});

// ─── Readers ─────────────────────────────────────────────────────────────────

describe("entriesOf", () => {
  it("reads a plain map, and a store through load", async () => {
    const entry: ContentLoaderEntry = { body: null, data: {}, id: "x" };
    expect(await entriesOf(new Map([["t", [entry]]]), "t")).toEqual([entry]);
    expect(await entriesOf(undefined, "t")).toBeUndefined();
    captureWarnings();
    const lazy = await sectionData(RELATED_SECTION, true);
    const authors = await entriesOf(lazy, "authors");
    expect(authors?.map((author) => author.id)).toEqual(["jane"]);
  });
});

describe("the content classes over a lazy store", () => {
  it("declare that they read the section on demand", () => {
    expect(ContentCollection.projectOnDemand).toBe(true);
    expect(ContentEntry.projectOnDemand).toBe(true);
  });

  it("ContentCollection gives what it returns a body, and nothing else", async () => {
    captureWarnings();
    const content = await sectionData(VAULT_SECTION, true);
    const result = await new ContentCollection({
      _project: { content },
      contentType: "kb",
      limit: 1,
    }).resolve();
    expect(result).toHaveLength(1);
    expect(result[0]?.$children).toBeDefined();
    const rest = typeOf(content, "kb").filter((entry) => entry !== result[0]);
    expect(rest.every((entry) => entry.$children === undefined)).toBe(true);
  });

  it("ContentEntry gives the entry it finds a body", async () => {
    captureWarnings();
    const content = await sectionData(RELATED_SECTION, true);
    const found = await new ContentEntry({
      _project: { content },
      contentType: "posts",
      id: "hello",
    }).resolve();
    expect(found?.$children).toBeDefined();
    expect(related(found?.data.author).$children).toBeDefined();
    expect(
      await new ContentEntry({
        _project: { content },
        contentType: "posts",
        id: "missing",
      }).resolve(),
    ).toBeNull();
  });
});

// ─── The frontmatter-only read ───────────────────────────────────────────────

describe("readFrontmatter agrees with processMarkdown", () => {
  const cases = {
    "closing fence at end of file": "---\ntitle: End\n---",
    "CRLF line endings": "---\r\ntitle: Windows\r\n---\r\n\r\nBody.\r\n",
    "empty block": "---\n---\n\nBody.\n",
    "fence with trailing spaces": "---  \ntitle: Spaced\n--- \t\n\nBody.\n",
    "no closing fence": "---\ntitle: Open\n\nBody that never closes.\n",
    "no frontmatter": "# Title\n\nJust a body.\n",
    "not at the start": "\n---\ntitle: Late\n---\n",
    "one line only": "---",
    "rule inside the body": "---\ntitle: Rules\n---\n\nAbove\n\n---\n\nBelow\n",
  } satisfies Record<string, string>;
  for (const [name, source] of Object.entries(cases)) {
    it(name, () => {
      const full = processMarkdown(source, "/notes/doc.md", { sourceRoot: "/notes" });
      expect(readFrontmatter(source, "/notes/doc.md", "/notes")).toEqual({
        frontmatter: full.frontmatter,
        slug: full.slug,
      });
    });
  }
});

describe("Markdown.load with deferBody", () => {
  it("returns the frontmatter, id and body text, and leaves the body unparsed", async () => {
    const path = join(TMP, "posts/hello.md");
    const [deferred] = await Markdown.load(path, {
      deferBody: true,
      sourceRoot: join(TMP, "posts"),
    });
    const [full] = await Markdown.load(path, { sourceRoot: join(TMP, "posts") });
    expect(deferred?.$children).toBeUndefined();
    expect(deferred?._meta?.excerpt).toBeUndefined();
    expect(deferred?._meta?.mtime).toBe(full?._meta?.mtime);
    expect(deferred?.data).toEqual(full?.data);
    expect(deferred?.id).toBe(full?.id);
    expect(deferred?.body).toBe(full?.body);
  });
});
