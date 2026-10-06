/**
 * Content-loader rules across source kinds: `exclude`, `where`, `idField` and `route` on JSON,
 * single-file, remote, third-party-format and localized sources.
 *
 * The vault suite (vault-content.test.ts) drives the Markdown directory case end to end. This one
 * covers the other branches of `loadContentType`, because the rules are format-agnostic and the
 * claim is that every consumer of `projectData` sees them applied the same way.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FormatEntry, FormatRegistry } from "@jxsuite/schema/format-registry";
import type { FormatHostIO } from "@jxsuite/schema/format-registry";
import { Content, loadContentSection } from "../src/content-loader.ts";
import type { ContentSection } from "../src/content-loader.ts";
import type { ContentLoaderEntry } from "../src/types.ts";
import { Markdown } from "../src/markdown.ts";

const TMP = mkdtempSync(join(tmpdir(), "jx-parser-rules-"));

function write(rel: string, text: string) {
  const path = join(TMP, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeAll(() => {
  // A directory of JSON entries, one file each, one file holding an array.
  write("things/one.json", JSON.stringify({ id: "one", name: "One", ok: true, ref: "r-1" }));
  write("things/two.json", JSON.stringify({ id: "two", name: "Two", ok: false, ref: "r-2" }));
  write("things/_scratch.json", JSON.stringify({ id: "scratch", name: "Scratch", ok: true }));
  write(
    "things/nested/list.json",
    JSON.stringify([
      { id: "a", name: "A", ok: true, ref: 7 },
      { id: "b", name: "B", ok: true, ref: "" },
    ]),
  );
  // Two entries that name the same id through a field.
  write("dups/a.json", JSON.stringify({ id: "a1", kind: "shared" }));
  write("dups/b.json", JSON.stringify({ id: "b1", kind: "shared" }));
  // A single JSON file of many entries.
  write(
    "single.json",
    JSON.stringify([
      { id: "s1", ok: true, sku: "X-1" },
      { id: "s2", ok: false, sku: "X-2" },
    ]),
  );
  // A localized Markdown collection.
  for (const locale of ["en", "fr"]) {
    write(
      `notes/${locale}/Intro Guide.md`,
      `---\ntitle: Intro ${locale}\nslug: intro\nsection: Guides\n---\n\nSee [Next](Next%20Steps.md) and [Gone](Gone.md).\n`,
    );
    write(
      `notes/${locale}/Next Steps.md`,
      `---\ntitle: Next ${locale}\nslug: next\nsection: Guides\n---\n\nBack to [Intro](Intro%20Guide.md).\n`,
    );
  }
  // A folder with both a README and an index, and a page that links to the folder.
  write("both/README.md", "---\ntitle: Readme\nslug: readme\n---\n\nReadme.\n");
  write("both/index.md", "---\ntitle: Index\nslug: index-page\n---\n\nIndex.\n");
  write(
    "both/page.md",
    "---\ntitle: Page\nslug: page\n---\n\nSee [the folder](./) and [home](../both).\n",
  );
  write("fake/a.fake", "a");
  write("fake/_b.fake", "b");
  write("fake/sub/c.fake", "c");
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

// ─── A fake third-party format class (does not understand `exclude`) ─────────

interface FakeCall {
  method: string;
  args: unknown[];
}

function fakeFormat(options: { remote?: boolean; discover?: string[]; fail?: boolean } = {}) {
  const calls: FakeCall[] = [];
  const Impl = {
    discover: (...args: unknown[]) => {
      calls.push({ args, method: "discover" });
      return options.discover ?? [];
    },
    load: (...args: unknown[]) => {
      calls.push({ args, method: "load" });
      if (options.fail) {
        throw new Error("network down");
      }
      const path = String(args[0]);
      return [
        { body: null, data: { name: path, ok: true, slug: `s-${path.length}` }, id: path },
        { body: null, data: { name: `${path}#2`, ok: false, slug: "other" }, id: `${path}#2` },
      ];
    },
  };
  const io: FormatHostIO = {
    importModule: () => Promise.resolve({ Fake: Impl }),
    loadJson: () => Promise.reject(new Error("not used")),
    resolvePath: (_base, ref) => ref,
  };
  const methods: Record<string, { role: string; identifier: string }> = {
    load: { identifier: "load", role: "load" },
  };
  if (options.discover) {
    methods.discover = { identifier: "discover", role: "discover" };
  }
  const entry = new FormatEntry(
    "Fake",
    "/virtual/fake.class.json",
    {
      $defs: { methods },
      $implementation: "./fake.js",
      format: { extensions: [".fake"], ...(options.remote ? { remote: true } : {}) },
      title: "Fake",
    },
    io,
  );
  return { calls, registry: new FormatRegistry([entry]) };
}

const load = async (
  section: Record<string, unknown>,
  registry = new FormatRegistry([]),
  projectConfig = {},
) => await loadContentSection(section as unknown as ContentSection, TMP, registry, projectConfig);

describe("native JSON sources", () => {
  it("a JSON file that does not parse is reported by its path", async () => {
    captureWarnings();
    write("broken/ok.json", JSON.stringify({ id: "ok" }));
    write("broken/sub/bad.json", "{ not json");
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(load({ broken: { format: "json", source: "./broken" } })).rejects.toThrow(
      /Content type "broken": cannot read "sub\/bad\.json"/,
    );
  });

  it("exclude skips files in a JSON directory before they are read", async () => {
    captureWarnings();
    const data = await load({
      things: { exclude: ["**/_*.json", "nested/**"], format: "json", source: "./things" },
    });
    expect(
      data
        .get("things")!
        .map((e) => e.id)
        .toSorted(),
    ).toEqual(["one", "two"]);
  });

  it("where filters entries, including inside a multi-entry file", async () => {
    captureWarnings();
    const data = await load({
      things: { format: "json", source: "./things", where: { ok: true } },
    });
    expect(
      data
        .get("things")!
        .map((e) => e.id)
        .toSorted(),
    ).toEqual(["a", "b", "one", "scratch"]);
  });

  it("where and idField work on a single-file source", async () => {
    captureWarnings();
    const data = await load({
      single: { idField: "sku", source: "./single.json", where: { ok: true } },
    });
    expect(data.get("single")!.map((e) => e.id)).toEqual(["X-1"]);
  });

  it("a numeric idField value becomes a string id, and a blank one keeps the old id", async () => {
    const warnings = captureWarnings();
    const data = await load({
      things: { format: "json", idField: "ref", source: "./things/nested" },
    });
    expect(data.get("things")!.map((e) => e.id)).toEqual(["7", "b"]);
    expect(warnings.some((w) => w.includes('"things/b" has no usable "ref" field'))).toBe(true);
  });

  it("routes entries by id and reports a duplicate by its path", async () => {
    const warnings = captureWarnings();
    const data = await load({
      dups: { format: "json", idField: "kind", route: "/d/{id}", source: "./dups" },
    });
    const entries = data.get("dups")!;
    expect(entries.map((e) => e._meta?.route)).toEqual(["/d/shared", undefined]);
    expect(warnings.some((w) => w.includes("a.json and b.json"))).toBe(true);
    expect(
      warnings.some((w) => w.includes("has two entries at /d/shared (a.json and b.json)")),
    ).toBe(true);
  });

  it("a multi-entry file takes no part in link resolution", async () => {
    captureWarnings();
    const data = await load({
      things: { format: "json", route: "/things/{id}", source: "./things" },
    });
    expect(data.get("things")!.every((e) => e._meta?.route !== undefined)).toBe(true);
  });
});

describe("remote sources", () => {
  it("apply where and idField to what the format returns", async () => {
    captureWarnings();
    const { calls, registry } = fakeFormat({ remote: true });
    const data = await load(
      {
        feed: {
          format: "Fake",
          idField: "slug",
          source: "https://example.com/data",
          where: { ok: true },
        },
      },
      registry,
    );
    expect(data.get("feed")!).toHaveLength(1);
    expect(data.get("feed")![0]!.id).toMatch(/^s-/);
    expect(calls[0]!.args[1]).toMatchObject({ idField: "slug" });
  });

  it("a failing remote load is still a warning and an empty collection", async () => {
    const warnings = captureWarnings();
    const { registry } = fakeFormat({ fail: true, remote: true });
    const data = await load(
      { feed: { format: "Fake", source: "https://example.com/data", where: { ok: true } } },
      registry,
    );
    expect(data.get("feed")).toEqual([]);
    expect(warnings).toContain('Content type "feed": network down');
  });
});

describe("a third-party format class", () => {
  const files = ["a.fake", "_b.fake", "sub/c.fake"].map((f) => resolve(TMP, "fake", f));

  it("receives exclude when one is set, and is filtered again by the loader if it ignores it", async () => {
    captureWarnings();
    const { calls, registry } = fakeFormat({ discover: files });
    const data = await load(
      { fake: { exclude: ["**/_*.fake", "sub/**"], format: "Fake", source: "./fake" } },
      registry,
    );
    const discover = calls.find((c) => c.method === "discover")!;
    expect(discover.args[1]).toEqual({
      baseDir: TMP,
      exclude: ["**/_*.fake", "sub/**"],
    });
    const loaded = calls.filter((c) => c.method === "load").map((c) => String(c.args[0]));
    expect(loaded).toEqual([resolve(TMP, "fake/a.fake")]);
    expect(data.get("fake")).toHaveLength(2);
  });

  it("is not handed an exclude option it never asked for", async () => {
    captureWarnings();
    const { calls, registry } = fakeFormat({ discover: files });
    await load({ fake: { format: "Fake", source: "./fake" } }, registry);
    expect(calls.find((c) => c.method === "discover")!.args[1]).toEqual({ baseDir: TMP });
    expect(calls.filter((c) => c.method === "load")).toHaveLength(3);
  });

  it("where splits a file's entries, and a file with none left drops out", async () => {
    captureWarnings();
    const { registry } = fakeFormat({ discover: files });
    const data = await load(
      { fake: { format: "Fake", source: "./fake", where: { name: { $exists: true }, ok: true } } },
      registry,
    );
    expect(data.get("fake")!.every((e) => e.data.ok === true)).toBe(true);
    expect(data.get("fake")).toHaveLength(3);
  });

  it("a format with no discover capability reads the source as one file", async () => {
    captureWarnings();
    const { calls, registry } = fakeFormat();
    const data = await load(
      { one: { exclude: ["x"], format: "Fake", source: "./fake/a.fake" } },
      registry,
    );
    expect(calls.map((c) => c.method)).toEqual(["load"]);
    expect(data.get("one")).toHaveLength(2);
  });

  it("an entry that is not under the source root is never excluded by a path it does not have", async () => {
    captureWarnings();
    const outside = resolve(TMP, "single.json");
    const { registry } = fakeFormat({ discover: [outside] });
    const data = await load(
      { fake: { exclude: ["**"], format: "Fake", source: "./fake" } },
      registry,
    );
    // `single.json` sits beside `fake/`, outside the source root, so no relative path exists for it.
    expect(data.get("fake")!.length).toBeGreaterThan(0);
  });
});

describe("option validation", () => {
  it("an empty or non-string idField is refused naming the content type", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(load({ t: { format: "json", idField: "", source: "./things" } })).rejects.toThrow(
      'Content type "t": "idField" must be a field name',
    );
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(load({ t: { format: "json", idField: 3, source: "./things" } })).rejects.toThrow(
      /"idField" must be a field name/,
    );
  });

  it("a non-array exclude is refused", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(load({ t: { exclude: "x", format: "json", source: "./things" } })).rejects.toThrow(
      /Content type "t": "exclude" must be an array/,
    );
  });

  it("does not repeat the content type in a message that already names it", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(
      load({ t: { format: "json", indexRoute: "y", route: "/x", source: "./things" } }),
    ).rejects.toThrow(/^Content type "t": indexRoute: /);
  });
});

async function realRegistry() {
  const { buildExtensionRegistry } = await import("@jxsuite/schema/extension-registry");
  writeFileSync(
    join(TMP, "jx-extension.json"),
    JSON.stringify({
      classes: {
        Content: resolve(import.meta.dir, "../src/Content.class.json"),
        Markdown: resolve(import.meta.dir, "../src/Markdown.class.json"),
      },
      name: "fixture",
    }),
  );
  const { pathToFileURL } = await import("node:url");
  const { readFileSync } = await import("node:fs");
  const { dirname, isAbsolute } = await import("node:path");
  return await buildExtensionRegistry(
    ["./"],
    {
      importModule: async (path: string) => {
        try {
          return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
        } catch {
          return (await import(pathToFileURL(`${path.slice(0, -3)}.ts`).href)) as Record<
            string,
            unknown
          >;
        }
      },
      loadJson: (path: string) =>
        Promise.resolve(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>),
      resolvePath: (base: string, ref: string) =>
        isAbsolute(ref) ? ref : resolve(dirname(base), ref),
    },
    resolve(TMP, "project.json"),
  );
}

describe("a folder with both a README and an index", () => {
  it("links to the folder go to the index, as ids do", async () => {
    captureWarnings();
    const data = await Content.projectData(
      { both: { exclude: [], format: "Markdown", route: "/b/{slug}", source: "./both" } },
      { projectConfig: {}, registry: await realRegistry(), root: TMP },
    );
    const entries = data.get("both") as ContentLoaderEntry[];
    const page = entries.find((e) => e.data.slug === "page")!;
    const hrefs = JSON.stringify(page.$children);
    expect(hrefs).toContain('"href":"/b/index-page/"');
    expect(hrefs).not.toContain("/b/readme/");
  });
});

describe("a localized collection with a route", () => {
  const config = { i18n: { defaultLocale: "en", locales: ["en", "fr"] } };
  const section = {
    notes: {
      format: "Markdown",
      route: "/guides/{slug}",
      source: "./notes/{locale}/",
    },
  };
  it("gives each locale's entries a locale-prefixed url, and links resolve inside the locale", async () => {
    const warnings = captureWarnings();
    const data = await Content.projectData(section, {
      projectConfig: {
        ...config,
        i18n: { ...config.i18n, routing: "prefix-except-default" as const },
      },
      registry: await realRegistry(),
      root: TMP,
    } as never);
    const entries = data.get("notes") as ContentLoaderEntry[];
    const urls = entries.map((e) => [e._meta?.locale, e._meta?.route, e._meta?.url]);
    expect(urls).toContainEqual(["en", "/guides/intro", "/guides/intro/"]);
    expect(urls).toContainEqual(["fr", "/guides/intro", "/fr/guides/intro/"]);

    const anchors = (entry: ContentLoaderEntry) => {
      const out: string[] = [];
      const walk = (nodes: unknown[]) => {
        for (const node of nodes) {
          const el = node as {
            tagName?: string;
            attributes?: { href?: string };
            children?: unknown[];
          };
          if (el?.tagName === "a" && el.attributes?.href) {
            out.push(el.attributes.href);
          }
          if (Array.isArray(el?.children)) {
            walk(el.children);
          }
        }
      };
      walk(entry.$children ?? []);
      return out;
    };
    const fr = entries.find((e) => e._meta?.locale === "fr" && e.data.slug === "intro")!;
    expect(anchors(fr)).toEqual(["/fr/guides/next/"]);
    const en = entries.find((e) => e._meta?.locale === "en" && e.data.slug === "intro")!;
    expect(anchors(en)).toEqual(["/guides/next/"]);
    expect(warnings.filter((w) => w.includes("Gone.md"))).toHaveLength(2);
  });

  it("expands a locale's page only over that locale's entries", async () => {
    captureWarnings();
    const projectConfig = {
      ...config,
      i18n: { ...config.i18n, routing: "prefix-except-default" as const },
    };
    const data = await Content.projectData(section, {
      projectConfig,
      registry: await realRegistry(),
      root: TMP,
    } as never);
    const fr = await Content.resolvePaths(
      { contentType: "notes" },
      {
        data,
        locale: "fr",
        params: ["slug"],
        projectConfig,
        root: TMP,
        urlPattern: "/fr/guides/:slug",
      },
    );
    expect(fr.map((row) => row.slug).toSorted()).toEqual(["intro", "next"]);
    expect(fr.every((row) => (row._meta as { locale?: string }).locale === "fr")).toBe(true);
  });
});

describe("Markdown.load hands alerts and the id rule to processMarkdown", () => {
  it("passes the alerts option through", async () => {
    const [entry] = await Markdown.load(join(TMP, "notes/en/Intro Guide.md"), { alerts: false });
    expect(entry!.id).toBe("Intro Guide");
  });
});
