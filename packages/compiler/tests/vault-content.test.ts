/**
 * A documentation vault published straight from its folder, through a real build.
 *
 * The parser's own suites prove each rule; this is the one test that proves they meet the rest of
 * the build correctly: `$paths` is expanded from the page's own URL pattern, a `ContentEntry` with
 * no id binds to the page it generated, the sitemap and the search index list exactly the routed
 * documents, and the HTML a reader gets has callouts, working links and untouched code.
 *
 * Two projects share one vault: a catch-all `[...path]` page and a `[category]/[slug]` plus
 * `[category]` page set, because the same `$paths: { contentType }` has to serve both shapes.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSite } from "../src/site/site-build.ts";

const roots: string[] = [];

/** Frontmatter for a published knowledge-base document. */
const fm = (title: string, slug: string, category: string, extra = "") =>
  `---\ntitle: ${title}\ndescription: ${title} for the vault test.\nslug: ${slug}\ncategory: ${category}\nstatus: review\npublish: true\n${extra}---\n\n`;

const VAULT: Record<string, string> = {
  "README.md": "# Vault\n\nNot a document.\n",
  "STYLE.md": "---\ntitle: Style\nslug: style\npublish: false\n---\n\nConventions.\n",
  "internal/Plan.md": `${fm("Plan", "plan", "Internal")}Excluded by path although flagged to publish.\n`,
  "Frappe/README.md": `${fm("Frappe", "frappe", "Frappe")}Section index. See [Bench Operations](Bench%20Operations.md).\n`,
  "Frappe/Bench Operations.md": `${fm("Bench Operations", "bench-operations", "Frappe")}Read [Swap](../Linux/Swap%20Configuration.md#Create%20a%20Swap%20File), [the draft](Draft.md) and [the plan](../internal/Plan.md).

> [!NOTE]
> Back up first.

> [!WARNING] Destructive
> This drops the site.

## Create a Swap File

\`\`\`python
print("{{ doc.name }} says \${first}")
\`\`\`

Prose that names \${state.page.data.title} and inline code like \`\${HOME}\`.

\`\`\`bash
echo \${HOME} \${{ github.event.number }}
\`\`\`

\`\`\`js
const html = \`<div class="alert alert-info">\${__("Pick one")}</div>\`;
\`\`\`
`,
  "Frappe/Draft.md": `${fm("Draft", "draft", "Frappe").replace("status: review", "status: draft")}Unreviewed.\n`,
  "Frappe/Private.md": `${fm("Private", "private", "Frappe").replace("publish: true", "publish: false")}Not for the web.\n`,
  "Linux/README.md": `${fm("Linux", "linux", "Linux")}Section.\n`,
  "Linux/Swap Configuration.md": `${fm("Swap Configuration", "swap-configuration", "Linux")}Make swap. Back to [Linux](README.md).\n`,
  /* Two documents that claim one route, and one that has no category to route by: published, not
     drafts, and without a page. */
  "Dup/One.md": `${fm("Dup One", "same", "Dup")}Wins the route.\n`,
  "Dup/Two.md": `${fm("Dup Two", "same", "Dup")}Loses the route, uniquewordloser.\n`,
  "NoCat/Orphan.md":
    "---\ntitle: Orphan\ndescription: Has no category.\nslug: orphan\nstatus: review\npublish: true\n---\n\nHas no route, uniquewordorphan.\n",
  "Git & Dev Tools/README.md": `${fm("Git & Dev Tools", "git-and-dev-tools", "Git & Dev Tools")}Section.\n`,
  "Git & Dev Tools/Git Cheatsheet.md": `${fm("Git Cheatsheet", "git-cheatsheet", "Git & Dev Tools")}Tips.\n`,
};

const KB = {
  exclude: ["internal/**", "STYLE.md", "README.md", ".*/**"],
  format: "Markdown",
  indexRoute: "/kb/{dir:slug}/",
  route: "/kb/{category:slug}/{slug}/",
  schema: {
    properties: { category: { type: "string" }, title: { type: "string" } },
    required: ["title", "slug", "category"],
    type: "object",
  },
  source: "./vault",
  where: { publish: true, status: { $ne: "draft" } },
};

function write(root: string, rel: string, content: string | object) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

const articleBody = {
  children: [{ children: "${state.page.$children ?? []}", tagName: "article" }],
  state: { page: { $prototype: "ContentEntry", contentType: "kb" } },
  title: "${state.page.data.title}",
};

/** One project over the shared vault; `pages` are written under pages/. */
async function buildProject(pages: Record<string, object>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "jx-vault-e2e-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(VAULT)) {
    write(root, `vault/${rel}`, text);
  }
  write(root, "project.json", {
    build: { outDir: "./dist" },
    content: { kb: KB },
    extensions: ["@jxsuite/parser", "@jxsuite/search", "@jxsuite/feed"],
    feed: { kb: { basePath: "/never-used/", collection: "kb", dateField: "updated", title: "KB" } },
    images: { optimize: false },
    name: "Vault Site",
    search: { collections: { kb: { basePath: "/never-used/" } } },
    url: "https://vault.example",
  });
  write(root, "pages/index.json", { children: ["home"], tagName: "div" });
  for (const [rel, doc] of Object.entries(pages)) {
    write(root, `pages/${rel}`, doc);
  }
  await buildSite(root, { verbose: false });
  return root;
}

const html = (root: string, rel: string) => readFileSync(join(root, "dist", rel), "utf8");
/** The text a reader sees: tags dropped, entities decoded. A highlighted fence is many spans. */
const visibleText = (markup: string) =>
  markup
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#36;", "$")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
const has = (root: string, rel: string) => existsSync(join(root, "dist", rel));

let catchAll = "";
let named = "";

beforeAll(async () => {
  catchAll = await buildProject({
    "kb/[...path].json": { ...articleBody, $paths: { contentType: "kb" } },
  });
  named = await buildProject({
    "kb/[category]/[slug].json": { ...articleBody, $paths: { contentType: "kb" } },
    "kb/[category].json": { ...articleBody, $paths: { contentType: "kb" } },
  });
});

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("pages generated from the vault", () => {
  it("a catch-all page generates every routed document and every section index", () => {
    for (const route of [
      "kb/frappe/bench-operations",
      "kb/frappe",
      "kb/linux/swap-configuration",
      "kb/linux",
      "kb/git-and-dev-tools",
      "kb/git-and-dev-tools/git-cheatsheet",
    ]) {
      expect(has(catchAll, `${route}/index.html`)).toBe(true);
    }
  });

  it("named-segment pages generate the same URLs from the same $paths", () => {
    for (const route of [
      "kb/frappe/bench-operations",
      "kb/frappe",
      "kb/linux/swap-configuration",
      "kb/git-and-dev-tools/git-cheatsheet",
    ]) {
      expect(has(named, `${route}/index.html`)).toBe(true);
    }
  });

  it("generates nothing for what is unpublished, excluded or not a document", () => {
    for (const root of [catchAll, named]) {
      for (const route of [
        "kb/frappe/draft",
        "kb/frappe/private",
        "kb/internal",
        "kb/internal/plan",
        "kb/style",
        "kb/readme",
        "kb/vault",
      ]) {
        expect(has(root, `${route}/index.html`)).toBe(false);
      }
    }
  });

  it("each page renders its own entry, found by its URL", () => {
    expect(html(catchAll, "kb/frappe/bench-operations/index.html")).toContain("Back up first");
    expect(html(catchAll, "kb/linux/swap-configuration/index.html")).toContain("Make swap");
    expect(html(catchAll, "kb/frappe/index.html")).toContain("Section index");
    expect(html(named, "kb/linux/swap-configuration/index.html")).toContain("Make swap");
    expect(html(named, "kb/frappe/index.html")).toContain("Section index");
  });
});

describe("the rendered HTML", () => {
  const page = () => html(catchAll, "kb/frappe/bench-operations/index.html");

  it("renders alerts as accessible callouts, not blockquotes with a literal marker", () => {
    const out = page();
    expect(out).not.toContain("[!NOTE]");
    expect(out).not.toContain("[!WARNING]");
    expect(out).toContain('role="note"');
    expect(out).toContain("jx-alert-note");
    expect(out).toContain("jx-alert-warning");
    expect(out).toContain("jx-alert-title");
    expect(out).toContain("Destructive");
    expect(out).not.toContain("<blockquote");
  });

  it("rewrites a relative link to the target's route, with its fragment as a heading id", () => {
    expect(page()).toContain('href="/kb/linux/swap-configuration/#create-a-swap-file"');
    expect(html(catchAll, "kb/frappe/index.html")).toContain('href="/kb/frappe/bench-operations/"');
    expect(html(catchAll, "kb/linux/swap-configuration/index.html")).toContain('href="/kb/linux/"');
  });

  it("renders links to unpublished documents as plain text, never as dead links", () => {
    const out = page();
    expect(out).toContain("the draft");
    expect(out).toContain("the plan");
    expect(out).not.toContain("Draft.md");
    expect(out).not.toContain("Plan.md");
    expect(out).not.toContain('href="Draft');
  });

  it("keeps double braces and template-looking text in code exactly as written", () => {
    // Highlighting splits the fence into token spans; what a reader sees is the source, unevaluated.
    const text = visibleText(page());
    expect(text).toContain('print("{{ doc.name }} says ${first}")');
    expect(text).toContain("echo ${HOME} ${{ github.event.number }}");
    expect(text).toContain('const html = `<div class="alert alert-info">${__("Pick one")}</div>`;');
    // Prose and inline code are broken into lines by the page printer, so check the words.
    expect(text).toMatch(/names \$\{state\.page\.data\.title\} and inline code like\s+\$\{HOME\}/);
  });

  it("never turns that text into a binding the browser would evaluate", () => {
    const out = page();
    expect(out).not.toMatch(/<(?:code|span|p)[^>]*data-bind/);
    expect(out).not.toContain("text-content");
  });

  it("highlights code with the new languages", () => {
    expect(page()).toContain("language-python shiki");
    expect(page()).toContain("--shiki-light");
  });
});

describe("what every consumer of the collection sees", () => {
  it("the sitemap lists the routed documents and nothing else", () => {
    const sitemap = html(catchAll, "sitemap.xml");
    expect(sitemap).toContain("<loc>https://vault.example/kb/frappe/bench-operations</loc>");
    expect(sitemap).toContain("<loc>https://vault.example/kb/frappe</loc>");
    expect(sitemap).not.toContain("draft");
    expect(sitemap).not.toContain("private");
    expect(sitemap).not.toContain("internal");
    expect(sitemap).not.toContain("/kb/style");
  });

  it("the search index holds only routed documents, at their routed URLs", () => {
    const index = JSON.parse(html(catchAll, "search-index.json")) as {
      documents: { url: string; title: string; heading: string }[];
    };
    const pages = index.documents.filter((d) => d.heading === "");
    expect(pages.map((d) => d.url).toSorted()).toEqual([
      "/kb/dup/same/",
      "/kb/frappe/",
      "/kb/frappe/bench-operations/",
      "/kb/git-and-dev-tools/",
      "/kb/git-and-dev-tools/git-cheatsheet/",
      "/kb/linux/",
      "/kb/linux/swap-configuration/",
    ]);
    const titles = index.documents.map((d) => d.title);
    for (const hidden of ["Draft", "Private", "Plan", "Style", "Dup Two", "Orphan"]) {
      expect(titles).not.toContain(hidden);
    }
    // A section deep link is built on the same URL.
    expect(
      index.documents.some((d) => d.url === "/kb/frappe/bench-operations/#create-a-swap-file"),
    ).toBe(true);
  });

  it("an entry with no route is in no consumer: not the sitemap, the search index or the feed", () => {
    const sitemap = html(catchAll, "sitemap.xml");
    const index = html(catchAll, "search-index.json");
    const feed = html(catchAll, "feed.xml");
    expect(sitemap).toContain("<loc>https://vault.example/kb/dup/same</loc>");
    for (const unrouted of ["Dup/Two", "NoCat", "Orphan", "uniquewordloser", "uniquewordorphan"]) {
      expect(sitemap).not.toContain(unrouted);
      expect(index).not.toContain(unrouted);
      expect(feed).not.toContain(unrouted);
    }
    // No consumer used the flat basePath + id rule for an entry that has a route.
    expect(index).not.toContain("never-used");
    expect(feed.split("<entry>").slice(1).join("")).not.toContain("never-used");
  });

  it("the sitemap, the search index and the feed announce the same pages", () => {
    const origin = "https://vault.example";
    const fromSitemap = [...html(catchAll, "sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => m[1]!.replace(origin, "").replace(/\/?$/, "/"))
      .filter((url) => url.startsWith("/kb/"))
      .toSorted();
    const fromIndex = [
      ...new Set(
        (
          JSON.parse(html(catchAll, "search-index.json")) as { documents: { url: string }[] }
        ).documents.map((d) => d.url.split("#")[0]!),
      ),
    ].toSorted();
    const fromFeed = [...html(catchAll, "feed.xml").matchAll(/<link[^>]*href="([^"]+)"/g)]
      .map((m) => m[1]!.replace(origin, ""))
      .filter((url) => url.startsWith("/kb/") && url !== "/kb/")
      .toSorted();
    expect(fromIndex).toEqual(fromSitemap);
    expect(fromFeed).toEqual(fromSitemap);
  });

  it("the two page shapes agree on every URL the search index announces", () => {
    const urls = (root: string) =>
      (JSON.parse(html(root, "search-index.json")) as { documents: { url: string }[] }).documents
        .map((d) => d.url)
        .toSorted();
    expect(urls(named)).toEqual(urls(catchAll));
  });
});

// ─── Hardening: what a note can make a build do ─────────────────────────────

/** A project of its own over a vault of its own; `warnings` are what the build printed. */
async function buildCustom(options: {
  vault: Record<string, string>;
  kb?: Record<string, unknown>;
  pages: Record<string, object>;
  project?: Record<string, unknown>;
}): Promise<{ root: string; warnings: string[] }> {
  const root = mkdtempSync(join(tmpdir(), "jx-vault-e2e-custom-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(options.vault)) {
    write(root, `vault/${rel}`, text);
  }
  write(root, "project.json", {
    build: { outDir: "./dist" },
    content: { kb: { format: "Markdown", route: "/kb/{slug}/", source: "./vault", ...options.kb } },
    extensions: ["@jxsuite/parser", "@jxsuite/search"],
    images: { optimize: false },
    name: "Custom Vault Site",
    url: "https://vault.example",
    ...options.project,
  });
  write(root, "pages/index.json", { children: ["home"], tagName: "div" });
  for (const [rel, doc] of Object.entries(options.pages)) {
    write(root, `pages/${rel}`, doc);
  }
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    await buildSite(root, { verbose: false });
  } finally {
    console.warn = original;
  }
  return { root, warnings };
}

/** The article page without the page-level title binding, so a `data-bind` in the output is news. */
const plainArticle = { ...articleBody, title: "page" };

const note = (slug: string, body: string, extra = "") =>
  `---\ntitle: ${slug}\nslug: ${slug}\npublish: true\n${extra}---\n\n${body}\n`;

describe("frontmatter cannot write outside the output directory", () => {
  it("an idField that climbs out gets no page, here or anywhere above the site", async () => {
    const escaped = `escaped-${process.pid}-${Date.now()}`;
    const { root, warnings } = await buildCustom({
      kb: { idField: "slug", route: undefined },
      pages: {
        "kb/[slug].json": {
          $paths: { contentType: "kb" },
          children: [{ tagName: "p", textContent: "${state.page.data.title}" }],
          state: {
            page: { $prototype: "ContentEntry", contentType: "kb", id: { $ref: "#/$params/slug" } },
          },
          title: "page",
        },
      },
      vault: {
        "Safe.md": note("safe", "ok"),
        "Evil.md": note(`../../../${escaped}`, "gone"),
      },
    });
    expect(has(root, "kb/safe/index.html")).toBe(true);
    expect(existsSync(join(root, "..", escaped))).toBe(false);
    expect(existsSync(join(root, "dist", "kb", "..", "..", "..", escaped))).toBe(false);
    // The entry keeps its path id and its page, at a path inside the site.
    expect(html(root, "kb/Evil/index.html")).toContain(escaped);
    expect(
      warnings.some((w) => w.includes('has a "slug" that contains a "." or ".." segment')),
    ).toBe(true);
  });

  it("a $paths value that climbs out is skipped by the compiler, whatever produced it", async () => {
    const escaped = `escaped-paths-${process.pid}-${Date.now()}`;
    const { root, warnings } = await buildCustom({
      pages: {
        "x/[name].json": {
          $paths: { param: "name", values: ["fine", `../../../${escaped}`, String.raw`a\b`] },
          children: [{ tagName: "p", textContent: "x" }],
          title: "x",
        },
      },
      vault: { "A.md": note("a", "x") },
    });
    expect(has(root, "x/fine/index.html")).toBe(true);
    expect(existsSync(join(root, "..", escaped))).toBe(false);
    expect(warnings.filter((w) => w.includes("skipping it"))).toHaveLength(2);
  });
});

describe("what the mount publishes", () => {
  it("copies what a page refers to, and never what exclude or a hidden name keeps out", async () => {
    const { root, warnings } = await buildCustom({
      kb: { exclude: ["internal/**"], route: "/kb/{slug}/", where: { publish: true } },
      pages: { "kb/[...path].json": { ...plainArticle, $paths: { contentType: "kb" } } },
      vault: {
        ".env": "SECRET=1",
        "a.md": note(
          "a",
          [
            "![ok](pics/ok.png)",
            "![secret](internal/secret.png)",
            "![dot](.env)",
            '<img src="/content/kb/internal/secret.png"> <img src="/content/kb/.env">',
            "[report](files/report.pdf)",
          ].join("\n\n"),
        ),
        "files/report.pdf": "%PDF",
        "internal/secret.png": "SECRET",
        "pics/ok.png": "PNG",
      },
    });
    expect(has(root, "content/kb/pics/ok.png")).toBe(true);
    expect(has(root, "content/kb/files/report.pdf")).toBe(true);
    expect(html(root, "kb/a/index.html")).toContain('href="/content/kb/files/report.pdf"');
    expect(has(root, "content/kb/internal/secret.png")).toBe(false);
    expect(has(root, "content/kb/.env")).toBe(false);
    const refused = warnings.filter((w) => w.includes("does not publish"));
    expect(refused.length).toBeGreaterThanOrEqual(2);
  });
});

describe("text that looks like a template", () => {
  it("an excerpt and a heading bound by a listing page stay text", async () => {
    const { root } = await buildCustom({
      pages: {
        "kb/[...path].json": { ...plainArticle, $paths: { contentType: "kb" } },
        "list.json": {
          children: [
            {
              children: {
                $prototype: "Array",
                items: { $ref: "#/state/posts" },
                map: {
                  children: [
                    { tagName: "em", textContent: "${item._meta.excerpt}" },
                    { tagName: "b", textContent: "${item._meta.toc[0].text}" },
                    {
                      attributes: { title: "${item._meta.excerpt}" },
                      tagName: "i",
                      textContent: "x",
                    },
                  ],
                  tagName: "li",
                },
              },
              tagName: "ul",
            },
          ],
          state: { posts: { $prototype: "ContentCollection", contentType: "kb" } },
          title: "list",
        },
      },
      vault: {
        "A.md": note(
          "a",
          "Prose naming ${state.page.data.title} and ${HOME} here.\n\n## Heading ${h}",
        ),
      },
    });
    const out = html(root, "list/index.html");
    expect(out).not.toContain("data-bind");
    expect(visibleText(out)).toContain("Prose naming ${state.page.data.title} and ${HOME} here.");
    expect(visibleText(out)).toContain("Heading ${h}");
    // The attribute cannot hold an entity, so the sequence is split rather than left to evaluate.
    expect(out).toContain("$\u200B{state.page.data.title}");
  });

  it("image descriptions, callout titles and the words of a dead link never become bindings", async () => {
    const { root } = await buildCustom({
      kb: { alerts: { NOTE: "doc-note" } },
      pages: { "kb/[...path].json": { ...plainArticle, $paths: { contentType: "kb" } } },
      vault: {
        "a.md": note(
          "a",
          [
            "![diagram of ${HOME}](x.png)",
            "> [!NOTE] Use ${HOME}\n> body",
            "[link text ${y}](Missing.md)",
          ].join("\n\n"),
        ),
      },
    });
    const out = html(root, "kb/a/index.html");
    expect(out).not.toContain("data-bind");
    expect(visibleText(out)).toContain("link text ${y}");
    expect(out).toContain("diagram of $\u200B{HOME}");
    expect(out).toContain('data-title="Use $\u200B{HOME}"');
    // Nothing is bound, so the hydration script has no expression to evaluate in a browser.
    expect(readFileSync(join(root, "dist/kb/a/app.js"), "utf8")).toContain("const bind = {};");
  });
});

describe("a localized collection", () => {
  it("binds each language's page to its own entry through the page's locale-prefixed URL", async () => {
    const { root } = await buildCustom({
      kb: { route: "/kb/{slug}/", source: "./vault/{locale}" },
      pages: {
        "fr/kb/[...path].json": { ...plainArticle, $paths: { contentType: "kb" } },
        "kb/[...path].json": { ...plainArticle, $paths: { contentType: "kb" } },
      },
      project: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
      vault: {
        "en/Guide.md": note("guide", "English words."),
        "fr/Guide.md": note("guide", "Mots en francais."),
      },
    });
    expect(html(root, "kb/guide/index.html")).toContain("English words.");
    expect(html(root, "fr/kb/guide/index.html")).toContain("Mots en francais.");
    expect(html(root, "fr/kb/guide/index.html")).not.toContain("English words.");
  });
});

describe("a route no page produces", () => {
  it("is reported once for the content type, with the routes, and links to it are still not dead text", async () => {
    const { root, warnings } = await buildCustom({
      kb: { route: "/kb/{id:slug}/" },
      pages: { "kb/[category]/[slug].json": { ...plainArticle, $paths: { contentType: "kb" } } },
      vault: {
        "A/Deep/Deeper.md": note("deeper", "d"),
        "A/Mid.md": note("mid", "[top](../Top.md) and [deep](Deep/Deeper.md)"),
        "Top.md": note("top", "t"),
      },
    });
    expect(has(root, "kb/a/mid/index.html")).toBe(true);
    const unserved = warnings.filter((w) => w.includes("no dynamic page produces"));
    expect(unserved).toHaveLength(1);
    expect(unserved[0]).toContain("/kb/top");
    expect(unserved[0]).toContain("/kb/a/deep/deeper");
  });
});
