/**
 * `hold` in the loader (site-architecture.md §7.6): one rule, applied where `where` runs, so
 * nothing that reads a content type can disagree about what production publishes.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { FormatHostIO } from "@jxsuite/schema/format-registry";
import type { JsonValue, ProjectConfig } from "@jxsuite/schema/types";
import { Content } from "../src/content-loader";
import type { ContentSection } from "../src/content-loader";
import type { ContentLoaderEntry } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "jx-hold-"));
let info: ReturnType<typeof spyOn>;
let registry: ExtensionRegistry;

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

const entry = (frontmatter: string, body = "Body.") => `---\n${frontmatter}\n---\n\n${body}\n`;

function write(path: string, text: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

beforeAll(async () => {
  write(
    "ext/jx-extension.json",
    JSON.stringify({
      classes: {
        Content: resolve(import.meta.dir, "../src/Content.class.json"),
        Csv: resolve(import.meta.dir, "../src/Csv.class.json"),
        Markdown: resolve(import.meta.dir, "../src/Markdown.class.json"),
      },
      name: "parser-fixture",
    }),
  );
  registry = await buildExtensionRegistry(["./ext"], nodeIO(), resolve(root, "project.json"));
});

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

const WORK = {
  format: "Markdown",
  hold: [
    { label: "Draft", when: { draft: true } },
    { label: "Pending client review", when: { review: { $nin: ["approved"] } } },
    { label: "Scheduled", when: { publishDate: { $gt: { $now: true } } } },
  ],
  source: "./content/work/",
} satisfies ContentSection[string];

/** Load a section the way a host does. */
async function load(
  section: ContentSection,
  options: { includeHeld?: boolean; lazy?: boolean } = {},
  extra: Partial<ProjectConfig> = {},
) {
  return await Content.projectData(section, {
    projectConfig: { content: section, name: "Hold", ...extra },
    registry,
    root,
    ...options,
  });
}

const ids = (entries: ContentLoaderEntry[] | undefined) =>
  (entries ?? []).map((e) => e.id).toSorted();

/** Every line the build said, and which held nothing is what the assertions read. */
const said = (): string[] => info.mock.calls.map(([line]: unknown[]) => String(line));

beforeEach(() => {
  info = spyOn(console, "info").mockImplementation(() => {});
  write("content/work/live.md", entry("review: approved"));
  write("content/work/draft.md", entry("review: approved\ndraft: true"));
  write("content/work/pending.md", entry("review: pending"));
  write("content/work/unreviewed.md", entry("title: no review field"));
  write("content/work/future.md", entry("review: approved\npublishDate: 2999-01-01"));
  write("content/work/past.md", entry("review: approved\npublishDate: 2001-01-01"));
  write("content/work/typo.md", entry("review: approved\npublishDate: next week"));
});

afterEach(() => {
  info.mockRestore();
});

describe("a production build", () => {
  test("leaves out everything a rule matches", async () => {
    const store = await load({ work: WORK });
    expect(ids(store.get("work"))).toEqual(["live", "past"]);
  });

  test("is the default, so a host that forgets cannot leak an entry", async () => {
    const store = await load({ work: WORK }, {});
    expect(ids(store.get("work"))).not.toContain("draft");
  });

  test("says what it held and why", async () => {
    await load({ work: WORK });
    const [message] = said();
    expect(message).toContain('"work"');
    expect(message).toContain("holding 5");
    expect(message).toContain("draft.md (Draft)");
    expect(message).toContain("pending.md (Pending client review)");
    expect(message).toContain("future.md (Scheduled)");
  });

  test("says nothing when nothing was held", async () => {
    await load({ work: { format: "Markdown", source: "./content/work/" } });
    expect(said()).toEqual([]);
  });

  test("a type with no hold keeps a field that merely says draft", async () => {
    const store = await load({ work: { format: "Markdown", source: "./content/work/" } });
    expect(ids(store.get("work"))).toContain("draft");
    expect(store.get("work")!.every((e) => e._meta?.hold === undefined)).toBe(true);
  });

  test("a link to a held entry is reported as one, with the rule that held it", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    write("content/work/live.md", entry("review: approved", "See [it](./draft.md)."));
    try {
      await load({ work: { ...WORK, route: "/work/{id}/" } });
      expect(warn.mock.calls.map(([line]: unknown[]) => String(line)).join("\n")).toContain(
        "held: Draft",
      );
    } finally {
      warn.mockRestore();
    }
  });

  /* A published page must not embed what its reference points at: that is the leak, by another door. */
  test("a reference to a held entry stays its id, with a warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    write("content/people/ada.md", entry("name: SECRET-ADA\ndraft: true"));
    write("content/posts/one.md", entry("title: One\nauthor: ada"));
    const section: ContentSection = {
      people: {
        format: "Markdown",
        hold: [{ label: "Draft", when: { draft: true } }],
        source: "./content/people/",
      },
      posts: {
        format: "Markdown",
        schema: { properties: { author: { $ref: "#/content/people" } } },
        source: "./content/posts/",
      },
    };
    try {
      const built = await load(section);
      const [post] = built.get("posts") ?? [];
      expect(post?.data.author).toBe("ada");
      expect(warn.mock.calls.map(([line]: unknown[]) => String(line)).join("\n")).toContain("ada");
      warn.mockClear();
      const shown = await load(section, { includeHeld: true });
      const [kept] = shown.get("posts") ?? [];
      expect(JSON.stringify(kept?.data.author)).toContain("SECRET-ADA");
    } finally {
      warn.mockRestore();
    }
  });

  test("the rules are checked when the type loads, naming it", async () => {
    const refused = await load({ work: { ...WORK, hold: [{ label: "x", when: {} }] } }).then(
      () => "",
      (error: Error) => error.message,
    );
    expect(refused).toMatch(/work.*hold\[0\]/);
  });

  test("`where` still decides first: an entry it left out is not reported as held", async () => {
    const store = await load({ work: { ...WORK, where: { review: "approved" } } });
    expect(ids(store.get("work"))).toEqual(["live", "past"]);
    expect(said().join("\n")).not.toContain("pending.md");
  });
});

describe("a host that shows authors their work", () => {
  test("keeps every entry", async () => {
    const store = await load({ work: WORK }, { includeHeld: true });
    expect(ids(store.get("work"))).toEqual([
      "draft",
      "future",
      "live",
      "past",
      "pending",
      "typo",
      "unreviewed",
    ]);
    expect(said()).toEqual([]);
  });

  test("labels each with the rule that holds it", async () => {
    const store = await load({ work: WORK }, { includeHeld: true });
    const labels = Object.fromEntries(store.get("work")!.map((e) => [e.id, e._meta?.hold]));
    expect(labels).toEqual({
      draft: "Draft",
      future: "Scheduled",
      live: undefined,
      past: undefined,
      pending: "Pending client review",
      typo: "Scheduled",
      unreviewed: "Pending client review",
    });
  });

  test("a lazy host agrees with a whole one", async () => {
    const lazy = await load({ work: WORK }, { includeHeld: true, lazy: true });
    expect(ids(await lazy.load("work"))).toContain("draft");
    const held = await load({ work: WORK }, { lazy: true });
    expect(ids(await held.load("work"))).toEqual(["live", "past"]);
  });
});

describe("every source kind", () => {
  test("a row of a file-backed collection is held on its own", async () => {
    write("content/rows.csv", "id,title,draft\na,One,false\nb,Two,true\n");
    const section: ContentSection = {
      rows: {
        format: "Csv",
        hold: [{ label: "Draft", when: { draft: true } }],
        // A CSV cell is text until the schema types it, which is what makes `true` a boolean here.
        schema: { properties: { draft: { type: "boolean" } } },
        source: "./content/rows.csv",
      },
    };
    const built = await load(section);
    expect(ids(built.get("rows"))).toEqual(["a"]);
    const shown = await load(section, { includeHeld: true });
    expect(ids(shown.get("rows"))).toEqual(["a", "b"]);
  });

  test("a {locale} source is held per locale", async () => {
    write("content/i18n/en/a.md", entry("draft: true"));
    write("content/i18n/en/b.md", entry("title: B"));
    write("content/i18n/fr/a.md", entry("title: A"));
    const section: ContentSection = {
      posts: {
        format: "Markdown",
        hold: [{ label: "Draft", when: { draft: true } }],
        source: "./content/i18n/{locale}/",
      },
    };
    const store = await load(section, {}, { i18n: { defaultLocale: "en", locales: ["en", "fr"] } });
    const rows = store
      .get("posts")!
      .map((e) => `${e._meta?.locale}/${e.id}`)
      .toSorted();
    expect(rows).toEqual(["en/b", "fr/a"]);
  });
});

describe("the asset mount", () => {
  test("a type with a hold does not serve its documents as raw downloads", () => {
    write("content/work/photo.jpg", "jpeg");
    const [mount] = Content.assets({ work: WORK }, { root });
    expect(mount?.filter?.("draft.md")).toBe(false);
    expect(mount?.filter?.("photo.jpg")).toBe(true);
    expect(mount?.filter?.(".env")).toBe(false);
  });
});
