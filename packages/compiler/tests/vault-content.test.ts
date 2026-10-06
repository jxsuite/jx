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
    extensions: ["@jxsuite/parser", "@jxsuite/search"],
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
      "/kb/frappe/",
      "/kb/frappe/bench-operations/",
      "/kb/git-and-dev-tools/",
      "/kb/git-and-dev-tools/git-cheatsheet/",
      "/kb/linux/",
      "/kb/linux/swap-configuration/",
    ]);
    const titles = index.documents.map((d) => d.title);
    for (const hidden of ["Draft", "Private", "Plan", "Style"]) {
      expect(titles).not.toContain(hidden);
    }
    // A section deep link is built on the same URL.
    expect(
      index.documents.some((d) => d.url === "/kb/frappe/bench-operations/#create-a-swap-file"),
    ).toBe(true);
  });

  it("the two page shapes agree on every URL the search index announces", () => {
    const urls = (root: string) =>
      (JSON.parse(html(root, "search-index.json")) as { documents: { url: string }[] }).documents
        .map((d) => d.url)
        .toSorted();
    expect(urls(named)).toEqual(urls(catchAll));
  });
});
