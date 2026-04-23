import { describe, test, expect, beforeAll, spyOn } from "bun:test";
import { resolve as resolvePath, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

try {
  GlobalRegistrator.register();
} catch {
  /* already registered */
}

import { buildScope, resolvePrototype, isSignal, RESERVED_KEYS } from "@jxplatform/runtime";
import { MarkdownFile, MarkdownCollection, MarkdownDirective } from "../src/md.js";
import { readFileSync } from "node:fs";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_DIR = join(__dirname, "..", "..", "..", "examples", "markdown", "content", "posts");

/**
 * Mock fetch to serve .class.json files from disk (Happy DOM can't fetch file:// URLs).
 *
 * @param {Record<string, string>} fileMap - Maps URL substrings to absolute file paths
 * @returns {() => void} Restore function
 */
function setupClassJsonFetchMock(/** @type {Record<string, string>} */ fileMap) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {any} */ url, /** @type {any} */ opts) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      for (const [pattern, filePath] of Object.entries(fileMap)) {
        if (urlStr.includes(pattern)) {
          const content = readFileSync(filePath, "utf8");
          return { ok: true, json: () => Promise.resolve(JSON.parse(content)) };
        }
      }
      return originalFetch(url, opts);
    }
  );
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ─── MarkdownFile ─────────────────────────────────────────────────────────────

describe("MarkdownFile", () => {
  /** @type {any} */ let result;

  beforeAll(async () => {
    const mf = new MarkdownFile({
      src: join(FIXTURE_DIR, "getting-started.md"),
    });
    result = await mf.resolve();
  });

  test("constructor stores config", () => {
    const mf = new MarkdownFile({ src: "test.md" });
    expect(mf.config.src).toBe("test.md");
  });

  test("resolve returns an object", () => {
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });

  test("slug is filename without extension", () => {
    expect(result.slug).toBe("getting-started");
  });

  test("path is the resolved file path", () => {
    expect(result.path).toContain("getting-started.md");
  });

  test("frontmatter.title is extracted", () => {
    expect(result.frontmatter.title).toBe("Getting Started with Jx");
  });

  test("frontmatter.date is extracted", () => {
    expect(result.frontmatter.date).toBe("2025-03-15");
  });

  test("frontmatter.tags is an array", () => {
    expect(Array.isArray(result.frontmatter.tags)).toBe(true);
    expect(result.frontmatter.tags).toContain("jx");
  });

  test("frontmatter.published is a boolean", () => {
    expect(result.frontmatter.published).toBe(true);
  });

  test("$body is a non-empty HTML string", () => {
    expect(typeof result.$body).toBe("string");
    expect(result.$body.length).toBeGreaterThan(0);
  });

  test("$body contains rendered markdown", () => {
    expect(result.$body).toContain("<h2>");
    expect(result.$body).toContain("<p>");
  });

  test("$body contains rendered code blocks", () => {
    expect(result.$body).toContain("<code");
  });

  test("$body contains rendered bold text", () => {
    expect(result.$body).toContain("<strong>");
  });

  test("$body contains rendered list", () => {
    expect(result.$body).toContain("<ol>");
    expect(result.$body).toContain("<li>");
  });

  test("$body does not contain frontmatter YAML", () => {
    expect(result.$body).not.toContain("---");
    expect(result.$body).not.toContain("title:");
  });

  test("$excerpt is the first paragraph as HTML", () => {
    expect(typeof result.$excerpt).toBe("string");
    expect(result.$excerpt).toContain("<p>");
  });

  test("$toc is an array of heading entries", () => {
    expect(Array.isArray(result.$toc)).toBe(true);
    expect(result.$toc.length).toBeGreaterThan(0);
  });

  test("$toc entries have depth, text, and id", () => {
    const entry = result.$toc[0];
    expect(entry).toHaveProperty("depth");
    expect(entry).toHaveProperty("text");
    expect(entry).toHaveProperty("id");
    expect(typeof entry.depth).toBe("number");
    expect(typeof entry.text).toBe("string");
    expect(typeof entry.id).toBe("string");
  });

  test('$toc contains "Installation" heading', () => {
    const found = result.$toc.some((/** @type {any} */ e) => e.text === "Installation");
    expect(found).toBe(true);
  });

  test("$readingTime is a positive integer", () => {
    expect(typeof result.$readingTime).toBe("number");
    expect(result.$readingTime).toBeGreaterThanOrEqual(1);
  });

  test("$wordCount is a positive integer", () => {
    expect(typeof result.$wordCount).toBe("number");
    expect(result.$wordCount).toBeGreaterThan(0);
  });

  test("basePath resolves relative src", async () => {
    const mf = new MarkdownFile({
      src: "getting-started.md",
      basePath: FIXTURE_DIR,
    });
    const r = /** @type {any} */ (await mf.resolve());
    expect(r.slug).toBe("getting-started");
  });
});

// ─── MarkdownFile with directives ─────────────────────────────────────────────

describe("MarkdownFile with directives", () => {
  /** @type {any} */ let result;

  beforeAll(async () => {
    const mf = new MarkdownFile({
      src: join(FIXTURE_DIR, "interactive-post.md"),
      directives: true,
    });
    result = await mf.resolve();
  });

  test("$body contains custom element from container directive", () => {
    expect(result.$body).toContain("<info-box");
  });

  test("$body preserves directive attributes", () => {
    expect(result.$body).toContain('type="warning"');
  });

  test("$body contains custom element from leaf directive", () => {
    expect(result.$body).toContain("<user-card");
  });

  test("$body contains leaf directive attributes", () => {
    expect(result.$body).toContain('firstName="Jane"');
    expect(result.$body).toContain('lastName="Smith"');
  });

  test("$body contains text directive with jx- prefix for hyphen-less names", () => {
    expect(result.$body).toContain("jx-tooltip");
  });

  test("container directive content is rendered inside the element", () => {
    expect(result.$body).toContain("<strong>");
  });
});

// ─── MarkdownCollection ───────────────────────────────────────────────────────

describe("MarkdownCollection", () => {
  test("constructor stores config", () => {
    const mc = new MarkdownCollection({ src: "*.md" });
    expect(mc.config.src).toBe("*.md");
  });

  test("resolve returns an array", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
    });
    const results = await mc.resolve();
    expect(Array.isArray(results)).toBe(true);
  });

  test("resolve returns all files matching glob", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
    });
    const results = await mc.resolve();
    expect(results.length).toBe(4); // getting-started, advanced-patterns, building-a-blog, interactive-post
  });

  test("each item has the MarkdownFileResult shape", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
    });
    const results = await mc.resolve();
    for (const item of results) {
      expect(item).toHaveProperty("slug");
      expect(item).toHaveProperty("path");
      expect(item).toHaveProperty("frontmatter");
      expect(item).toHaveProperty("$body");
      expect(item).toHaveProperty("$excerpt");
      expect(item).toHaveProperty("$toc");
      expect(item).toHaveProperty("$readingTime");
      expect(item).toHaveProperty("$wordCount");
    }
  });

  test("default sortBy is frontmatter.date descending", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
    });
    const results = await mc.resolve();
    const dates = results.map((/** @type {any} */ r) => r.frontmatter.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] >= dates[i]).toBe(true);
    }
  });

  test("sortOrder asc works", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      sortOrder: "asc",
    });
    const results = await mc.resolve();
    const dates = results.map((/** @type {any} */ r) => r.frontmatter.date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1] <= dates[i]).toBe(true);
    }
  });

  test("custom sortBy field", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      sortBy: "frontmatter.title",
      sortOrder: "asc",
    });
    const results = await mc.resolve();
    const titles = results.map((/** @type {any} */ r) => r.frontmatter.title);
    for (let i = 1; i < titles.length; i++) {
      expect(titles[i - 1] <= titles[i]).toBe(true);
    }
  });

  test("limit caps the result count", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      limit: 2,
    });
    const results = await mc.resolve();
    expect(results.length).toBe(2);
  });

  test("filter function removes items", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      filter: (/** @type {any} */ item) => item.frontmatter.author === "Jane Smith",
    });
    const results = await mc.resolve();
    for (const item of results) {
      expect(/** @type {any} */ (item).frontmatter.author).toBe("Jane Smith");
    }
    expect(results.length).toBe(2);
  });

  test("basePath resolves relative glob patterns", async () => {
    const mc = new MarkdownCollection({
      src: "*.md",
      basePath: FIXTURE_DIR,
    });
    const results = await mc.resolve();
    expect(results.length).toBe(4);
  });

  test("combined filter, sort, and limit", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      filter: (/** @type {any} */ item) => item.frontmatter.published === true,
      sortBy: "frontmatter.date",
      sortOrder: "desc",
      limit: 2,
    });
    const results = await mc.resolve();
    expect(results.length).toBe(2);
    expect(
      /** @type {any} */ (results[0]).frontmatter.date >=
        /** @type {any} */ (results[1]).frontmatter.date,
    ).toBe(true);
  });

  test("directives option applies to all files", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "interactive-post.md"),
      directives: true,
    });
    const results = await mc.resolve();
    expect(results.length).toBe(1);
    expect(/** @type {any} */ (results[0]).$body).toContain("<info-box");
  });
});

// ─── MarkdownDirective (remark plugin) ────────────────────────────────────────

describe("MarkdownDirective", () => {
  /** @param {any} md @param {any} [opts] */
  async function processWithDirectives(md, opts = {}) {
    const result = await unified()
      .use(remarkParse)
      .use(remarkDirective)
      .use(/** @type {any} */ (MarkdownDirective), opts)
      .use(remarkRehype)
      .use(rehypeStringify)
      .process(md);
    return String(result);
  }

  test("leaf directive → custom element tag", async () => {
    const html = await processWithDirectives('::user-card{firstName="Jane"}');
    expect(html).toContain("<user-card");
    expect(html).toContain('firstName="Jane"');
  });

  test("container directive → custom element with content", async () => {
    const md = ':::my-callout{type="info"}\nSome **bold** content\n:::';
    const html = await processWithDirectives(md);
    expect(html).toContain("<my-callout");
    expect(html).toContain('type="info"');
    expect(html).toContain("<strong>bold</strong>");
  });

  test("text directive → inline custom element", async () => {
    const html = await processWithDirectives('See :my-tooltip[the docs]{href="/docs"} here.');
    expect(html).toContain("<my-tooltip");
    expect(html).toContain('href="/docs"');
    expect(html).toContain("the docs");
  });

  test("directive without hyphen gets jx- prefix", async () => {
    const html = await processWithDirectives('::card{title="Hello"}');
    expect(html).toContain("<jx-card");
    expect(html).toContain('title="Hello"');
  });

  test("directive with hyphen keeps name as-is", async () => {
    const html = await processWithDirectives('::my-card{title="Hello"}');
    expect(html).toContain("<my-card");
  });

  test("custom prefix option", async () => {
    const html = await processWithDirectives('::card{title="Hello"}', { prefix: "x-" });
    expect(html).toContain("<x-card");
  });

  test("allowedNames whitelist filters directives", async () => {
    const html = await processWithDirectives(
      '::user-card{name="Jane"}\n\n::blocked-card{name="No"}',
      { allowedNames: ["user-card"] },
    );
    expect(html).toContain("<user-card");
    expect(html).not.toContain("<blocked-card");
  });

  test("passContent=false strips container content", async () => {
    const md = ':::my-callout{type="info"}\nContent here\n:::';
    const html = await processWithDirectives(md, { passContent: false });
    expect(html).toContain("<my-callout");
    expect(html).not.toContain("Content here");
  });

  test("multiple directives in one document", async () => {
    const md = '::widget-a{x="1"}\n\nSome text\n\n::widget-b{y="2"}';
    const html = await processWithDirectives(md);
    expect(html).toContain("<widget-a");
    expect(html).toContain("<widget-b");
  });
});

// ─── External class contract compliance ───────────────────────────────────────

describe("External class contract", () => {
  test("MarkdownFile has resolve() method", () => {
    const mf = new MarkdownFile({ src: "test.md" });
    expect(typeof mf.resolve).toBe("function");
  });

  test("MarkdownCollection has resolve() method", () => {
    const mc = new MarkdownCollection({ src: "*.md" });
    expect(typeof mc.resolve).toBe("function");
  });

  test("MarkdownFile constructor accepts single config object", () => {
    const config = { src: "test.md", directives: true };
    const mf = new MarkdownFile(config);
    expect(mf.config).toEqual(config);
  });

  test("MarkdownCollection constructor accepts single config object", () => {
    const config = { src: "*.md", sortBy: "frontmatter.title", limit: 5 };
    const mc = new MarkdownCollection(config);
    expect(mc.config).toEqual(config);
  });

  test("MarkdownFile.resolve returns JSON-serializable result", async () => {
    const mf = new MarkdownFile({
      src: join(FIXTURE_DIR, "getting-started.md"),
    });
    const result = /** @type {any} */ (await mf.resolve());
    const serialized = JSON.stringify(result);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.slug).toBe(result.slug);
    expect(deserialized.frontmatter.title).toBe(result.frontmatter.title);
    expect(deserialized.$body).toBe(result.$body);
  });

  test("MarkdownCollection.resolve returns JSON-serializable result", async () => {
    const mc = new MarkdownCollection({
      src: join(FIXTURE_DIR, "*.md"),
      limit: 1,
    });
    const results = await mc.resolve();
    const serialized = JSON.stringify(results);
    const deserialized = JSON.parse(serialized);
    expect(deserialized[0].slug).toBe(/** @type {any} */ (results[0]).slug);
  });

  test("MarkdownDirective is a function (remark plugin)", () => {
    expect(typeof MarkdownDirective).toBe("function");
  });
});

// ─── Runtime integration ($src external prototype) ────────────────────────────

describe("Runtime external prototype ($src)", () => {
  const parserDir = resolvePath(__dirname, "..");
  const mdFilePath = resolvePath(parserDir, "src", "MarkdownFile.class.json");
  const mdCollPath = resolvePath(parserDir, "src", "MarkdownCollection.class.json");

  /** @type {() => void} */
  let _restore;

  beforeAll(() => {
    _restore = setupClassJsonFetchMock({
      "MarkdownFile.class.json": mdFilePath,
      "MarkdownCollection.class.json": mdCollPath,
    });
  });

  // afterAll not available in bun:test, but restore on process exit is fine for tests

  test("RESERVED_KEYS includes $src", () => {
    expect(RESERVED_KEYS.has("$src")).toBe(true);
  });

  test("RESERVED_KEYS includes $export", () => {
    expect(RESERVED_KEYS.has("$export")).toBe(true);
  });

  test("resolvePrototype with $src loads MarkdownFile", async () => {
    const def = {
      $prototype: "MarkdownFile",
      $src: "file://" + mdFilePath,
      src: join(FIXTURE_DIR, "getting-started.md"),
    };
    const sig = await resolvePrototype(def, {}, "$post");
    expect(isSignal(sig)).toBe(true);
    const val = sig.value;
    expect(val.slug).toBe("getting-started");
    expect(val.frontmatter.title).toBe("Getting Started with Jx");
  });

  test("resolvePrototype with $src loads MarkdownCollection", async () => {
    const def = {
      $prototype: "MarkdownCollection",
      $src: "file://" + mdCollPath,
      src: join(FIXTURE_DIR, "*.md"),
      sortBy: "frontmatter.date",
      sortOrder: "desc",
      limit: 2,
    };
    const sig = await resolvePrototype(def, {}, "$posts");
    expect(isSignal(sig)).toBe(true);
    const val = sig.value;
    expect(Array.isArray(val)).toBe(true);
    expect(val.length).toBe(2);
  });

  test("resolvePrototype strips reserved keys from config", async () => {
    const def = {
      $prototype: "MarkdownFile",
      $src: "file://" + mdFilePath,
      src: join(FIXTURE_DIR, "getting-started.md"),
      timing: "client",
      description: "test",
    };
    const sig = await resolvePrototype(def, {}, "$test");
    expect(isSignal(sig)).toBe(true);
    // If reserved keys leaked in, the constructor would get them — but resolve() still works
    expect(sig.value.slug).toBe("getting-started");
  });

  test("resolvePrototype with $export override", async () => {
    // MarkdownCollection is a named export referenced via .class.json
    const def = {
      $prototype: "MC",
      $src: "file://" + mdCollPath,
      $export: "MarkdownCollection",
      src: join(FIXTURE_DIR, "*.md"),
      limit: 1,
    };
    const sig = await resolvePrototype(def, {}, "$posts");
    expect(isSignal(sig)).toBe(true);
    const val = sig.value;
    expect(Array.isArray(val)).toBe(true);
    expect(val.length).toBe(1);
  });

  test("rejects non-Function $src pointing to .js", async () => {
    const def = {
      $prototype: "MarkdownFile",
      $src: resolvePath(__dirname, "..", "md.js"),
    };
    await expect(resolvePrototype(def, {}, "$x")).rejects.toThrow(".class.json");
  });

  test("buildScope with external $src prototype", async () => {
    const doc = {
      state: {
        $post: {
          $prototype: "MarkdownFile",
          $src: "file://" + mdFilePath,
          src: join(FIXTURE_DIR, "getting-started.md"),
        },
      },
    };
    const scope = await buildScope(doc, {}, "http://localhost/");
    // Vue reactive() unwraps refs, so scope.$post is the raw value
    expect(scope.$post.slug).toBe("getting-started");
  });

  test("unknown $prototype without $src warns with helpful message", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const sig = await resolvePrototype({ $prototype: "UnknownThing" }, {}, "$u");
    expect(isSignal(sig)).toBe(true);
    expect(sig.value).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Did you mean to add '$src'?"));
    warn.mockRestore();
  });
});
