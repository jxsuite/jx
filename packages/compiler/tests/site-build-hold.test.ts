/**
 * `hold` through a real build (site-architecture.md §7.6). What this has to prove is the absence of
 * a thing: nothing about a held entry reaches `dist/`, whichever door it could have left by.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSite } from "../src/site/site-build.ts";

const DIR = resolve(import.meta.dir, "__test-site-hold__");

function write(path: string, text: string): void {
  const file = resolve(DIR, path);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, text, "utf8");
}

const entry = (fields: string, body: string) => `---\n${fields}\n---\n\n${body}\n`;

/** Every file under `dir`, relative to it. */
function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    return item.isDirectory() ? files(path, base) : [path.slice(base.length + 1)];
  });
}

/** The text of everything a build wrote. */
const everything = (out: string): string =>
  files(out)
    .map((file) => `${file}\n${readFileSync(join(out, file), "latin1")}`)
    .join("\n");

function scaffold(): void {
  rmSync(DIR, { force: true, recursive: true });
  write(
    "project.json",
    JSON.stringify({
      content: {
        work: {
          format: "Markdown",
          hold: [
            { label: "Draft", when: { draft: true } },
            { label: "Pending client review", when: { review: { $nin: ["approved"] } } },
            { label: "Scheduled", when: { publishDate: { $gt: { $now: true } } } },
          ],
          schema: {
            properties: {
              photo: { format: "uri-reference", type: "string" },
              title: { type: "string" },
            },
          },
          source: "./content/work/",
        },
      },
      extensions: ["@jxsuite/parser", "@jxsuite/feed", "@jxsuite/search"],
      feed: { work: { basePath: "/work/", collection: "work", title: "Work feed" } },
      name: "Hold",
      search: { collections: { work: { basePath: "/work/" } } },
      url: "https://example.test",
    }),
  );
  write(
    "content/work/live.md",
    entry("title: Public case\nreview: approved\nphoto: ./public.txt", "PUBLIC-BODY"),
  );
  write(
    "content/work/pending.md",
    entry("title: SECRET-PENDING\nreview: pending\nphoto: ./secret.txt", "SECRET-BODY-PENDING"),
  );
  write(
    "content/work/draft.md",
    entry("title: SECRET-DRAFT\nreview: approved\ndraft: true", "SECRET-BODY-DRAFT"),
  );
  write(
    "content/work/future.md",
    entry("title: SECRET-FUTURE\nreview: approved\npublishDate: 2999-01-01", "SECRET-BODY-FUTURE"),
  );
  write(
    "content/work/typo.md",
    entry("title: SECRET-TYPO\nreview: approved\npublishDate: next week", "SECRET-BODY-TYPO"),
  );
  write("content/work/public.txt", "PUBLIC-ASSET");
  write("content/work/secret.txt", "SECRET-ASSET");
  write(
    "pages/index.json",
    JSON.stringify({
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/work" },
          map: { tagName: "li", textContent: "${item.data.title}" },
        },
      ],
      state: {
        work: {
          $prototype: "ContentCollection",
          $src: "@jxsuite/parser/ContentCollection.class.json",
          contentType: "work",
        },
      },
      tagName: "ul",
    }),
  );
  write(
    "pages/work/[slug].json",
    JSON.stringify({
      $paths: { contentType: "work", field: "id", param: "slug" },
      children: [
        { tagName: "h1", textContent: "${state.entry.data.title}" },
        { children: "${state.entry.$children ?? []}", tagName: "div" },
        { tagName: "small", textContent: "${state.entry._meta.hold ?? 'live'}" },
        {
          attributes: { href: "${state.entry.data.photo ?? ''}" },
          tagName: "a",
          textContent: "Photo",
        },
      ],
      state: {
        entry: {
          $prototype: "ContentEntry",
          $src: "@jxsuite/parser/ContentEntry.class.json",
          contentType: "work",
          field: "id",
          id: { $ref: "#/$params/slug" },
        },
      },
      tagName: "article",
    }),
  );
}

const OUT = resolve(DIR, "dist");

describe("a production build", () => {
  let info: string[] = [];
  let errors: string[] = [];

  beforeAll(async () => {
    scaffold();
    const spy = spyOn(console, "info").mockImplementation(() => {});
    try {
      ({ errors } = await buildSite(DIR));
      info = spy.mock.calls.map(([line]) => String(line));
    } finally {
      spy.mockRestore();
    }
  });
  afterAll(() => rmSync(DIR, { force: true, recursive: true }));

  it("builds cleanly", () => {
    expect(errors).toEqual([]);
  });

  it("publishes the entry no rule matches", () => {
    expect(existsSync(resolve(OUT, "work/live/index.html"))).toBe(true);
    const page = readFileSync(resolve(OUT, "work/live/index.html"), "utf8");
    expect(page).toContain("Public case");
    expect(page).toContain("PUBLIC-BODY");
    expect(readFileSync(resolve(OUT, "index.html"), "utf8")).toContain("Public case");
  });

  it.each([["pending"], ["draft"], ["future"], ["typo"]])("generates no page for %s", (id) => {
    expect(existsSync(resolve(OUT, `work/${id}`))).toBe(false);
  });

  /* The door-by-door checks above are only as good as the list of doors. This one is not. */
  it("leaves no trace of a held entry anywhere in the output", () => {
    const output = everything(OUT);
    expect(output).toContain("PUBLIC-BODY");
    expect(output).not.toContain("SECRET");
    expect(output).not.toContain("/work/pending");
    expect(output).not.toContain("/work/draft");
  });

  it("publishes the asset of the entry it kept, and not the one only a held entry references", () => {
    const names = files(OUT);
    expect(names.some((name) => name.endsWith("public.txt"))).toBe(true);
    expect(names.some((name) => name.endsWith("secret.txt"))).toBe(false);
  });

  /* The two consumers that read the section without going through a page. */
  it("feeds and the search index carry what it kept and nothing it held", () => {
    const names = files(OUT);
    const feed = names.find((name) => name.endsWith(".xml") && !name.includes("sitemap"));
    const index = names.find((name) => name.includes("search") && name.endsWith(".json"));
    expect(feed).toBeDefined();
    expect(index).toBeDefined();
    for (const file of [feed!, index!]) {
      const text = readFileSync(join(OUT, file), "utf8");
      expect(text).toContain("Public case");
      expect(text).not.toContain("SECRET");
    }
  });

  it("the sitemap lists only what it kept", () => {
    const sitemap = readFileSync(resolve(OUT, "sitemap.xml"), "utf8");
    expect(sitemap).toContain("/work/live");
    expect(sitemap).not.toContain("/work/pending");
  });

  it("says what it held and why", () => {
    const line = info.find((message) => message.includes("holding")) ?? "";
    expect(line).toContain("pending.md (Pending client review)");
    expect(line).toContain("draft.md (Draft)");
    expect(line).toContain("future.md (Scheduled)");
    expect(line).toContain("typo.md (Scheduled)");
  });
});

describe("a preview build", () => {
  let errors: string[] = [];

  beforeAll(async () => {
    scaffold();
    ({ errors } = await buildSite(DIR, { includeHeld: true }));
  });
  afterAll(() => rmSync(DIR, { force: true, recursive: true }));

  it("keeps every entry, so a client can read one before it ships", () => {
    expect(errors).toEqual([]);
    for (const id of ["live", "pending", "draft", "future", "typo"]) {
      expect(existsSync(resolve(OUT, `work/${id}/index.html`))).toBe(true);
    }
  });

  it("hands a page the rule's label, to draw as a chip", () => {
    expect(readFileSync(resolve(OUT, "work/pending/index.html"), "utf8")).toContain(
      "Pending client review",
    );
    expect(readFileSync(resolve(OUT, "work/live/index.html"), "utf8")).toContain(">live<");
  });
});
