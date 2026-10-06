/**
 * Vault-as-content integration tests: a documentation vault published straight from its folder.
 *
 * Drives the real `Content` project-section class through a real extension registry over the
 * fixture vault in `vault-fixture.ts`, so exclusion, `where`, ids, routes, link rewriting, alerts,
 * `$paths` expansion and entry binding are exercised exactly as a host runs them.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { JxElement, ProjectConfig } from "@jxsuite/schema/types";
import { buildExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { ExtensionRegistry } from "@jxsuite/schema/extension-registry";
import type { FormatHostIO } from "@jxsuite/schema/format-registry";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ContentEntry } from "../src/content.ts";
import { Content } from "../src/content-loader.ts";
import type { ContentSection } from "../src/content-loader.ts";
import type { ContentLoaderEntry } from "../src/types.ts";
import { KB_TYPE, PUBLISHED_PATHS, VAULT_FILES, writeVault } from "./vault-fixture.ts";

const TMP = mkdtempSync(join(tmpdir(), "jx-parser-vault-"));
const VAULT = join(TMP, "vault");

beforeAll(() => {
  writeVault(VAULT);
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
        return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
      } catch {
        return (await import(pathToFileURL(`${path.slice(0, -3)}.ts`).href)) as Record<
          string,
          unknown
        >;
      }
    },
    loadJson: (path) =>
      Promise.resolve(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>),
    resolvePath: (base, ref) => (isAbsolute(ref) ? ref : resolve(dirname(base), ref)),
  };
}

let registryPromise: Promise<ExtensionRegistry> | undefined;
function registry(): Promise<ExtensionRegistry> {
  registryPromise ??= buildExtensionRegistry(["./ext"], nodeIO(), resolve(TMP, "project.json"));
  return registryPromise;
}

/** Load the fixture vault through `Content.projectData` with the given overrides on the kb type. */
async function loadVault(
  overrides: Record<string, unknown> = {},
  projectConfig: ProjectConfig = {},
): Promise<Map<string, ContentLoaderEntry[]>> {
  const section = {
    kb: { ...KB_TYPE, source: "./vault", ...overrides },
  } as unknown as ContentSection;
  return await Content.projectData(section, {
    projectConfig,
    registry: await registry(),
    root: TMP,
  });
}

const byPath = (entries: ContentLoaderEntry[], path: string) =>
  entries.find((e) => e._meta?.path === path)!;

/** All Jx descendants matching a predicate, depth first. */
function find(nodes: (JxElement | string)[] | undefined, test: (el: JxElement) => boolean) {
  const out: JxElement[] = [];
  for (const node of nodes ?? []) {
    if (typeof node !== "object") {
      continue;
    }
    if (test(node)) {
      out.push(node);
    }
    out.push(...find(node.children as (JxElement | string)[] | undefined, test));
  }
  return out;
}

const links = (entry: ContentLoaderEntry) =>
  find(entry.$children, (el) => el.tagName === "a").map((el) => ({
    href: el.attributes?.href,
    text: el.textContent,
  }));

describe("filtering: exclude and where", () => {
  it("publishes exactly the documents that are published and not drafts", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    expect(kb!.map((e) => e._meta?.path)).toEqual(PUBLISHED_PATHS);
  });

  it("never reads what is excluded or filtered, so it is never validated", async () => {
    const warnings = captureWarnings();
    await loadVault();
    // A link warning names the document it points at on purpose; everything else must not.
    const text = warnings.filter((w) => !w.startsWith("Content links:")).join("\n");
    for (const path of [
      "STYLE.md",
      "internal/",
      "Sites/",
      "Jx/",
      ".obsidian",
      "node_modules",
      "Draft Recipe",
      "Private Notes",
      "draft-recipe",
      "private-notes",
      "obsidian-notes",
    ]) {
      expect(text).not.toContain(path);
    }
    // The root README and the working notes carry no required fields; none was complained about.
    expect(text).not.toContain("missing required field");
  });

  it("a type with no filters keeps every file, as before", async () => {
    captureWarnings();
    const data = await loadVault({
      exclude: undefined,
      idField: undefined,
      indexRoute: undefined,
      links: undefined,
      route: undefined,
      schema: undefined,
      where: undefined,
    });
    const paths = data.get("kb")!.map((e) => e._meta?.path);
    expect(paths).toContain("STYLE.md");
    expect(paths).toContain("internal/Clients/Acme Print/Notes.md");
    expect(paths).toContain("Sites/demo/node_modules/pkg/README.md");
    expect(paths).toContain(".obsidian/notes.md");
    expect(paths).toContain("Frappe/Draft Recipe.md");
  });

  it("exclude alone leaves unpublished documents to where", async () => {
    captureWarnings();
    const data = await loadVault({ where: undefined });
    const paths = data.get("kb")!.map((e) => e._meta?.path);
    expect(paths).toContain("Frappe/Draft Recipe.md");
    expect(paths).toContain("Frappe/Private Notes.md");
    expect(paths).not.toContain("internal/Company/Plan.md");
  });

  it("loads in the same order on every run", async () => {
    captureWarnings();
    const firstLoad = await loadVault();
    const secondLoad = await loadVault();
    const pathsOf = (data: Map<string, ContentLoaderEntry[]>) =>
      data.get("kb")!.map((e) => e._meta?.path);
    expect(pathsOf(secondLoad)).toEqual(pathsOf(firstLoad));
  });

  it("a malformed where is a build error naming the content type and key", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadVault({ where: { status: { $regex: "x" } } })).rejects.toThrow(
      /Content type "kb": where\.status: unknown operator "\$regex"/,
    );
  });

  it("a malformed exclude is a build error naming the content type", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadVault({ exclude: ["!keep.md"] })).rejects.toThrow(
      /Content type "kb": "exclude" pattern "!keep.md"/,
    );
  });
});

describe("ids", () => {
  it("idField makes the frontmatter field the id", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    expect(byPath(kb!, "Frappe/Bench Operations.md").id).toBe("bench-operations");
    expect(byPath(kb!, "Frappe/README.md").id).toBe("frappe");
  });

  it("without idField, ids are the path, with README mapped to its directory", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault({ idField: undefined }));
    expect(byPath(kb!, "Frappe/Bench Operations.md").id).toBe("Frappe/Bench Operations");
    expect(byPath(kb!, "Frappe/README.md").id).toBe("Frappe");
    expect(byPath(kb!, "WordPress/Gravity Forms/README.md").id).toBe("WordPress/Gravity Forms");
    expect(byPath(kb!, "Git & Dev Tools/Git Cheatsheet.md").id).toBe(
      "Git & Dev Tools/Git Cheatsheet",
    );
  });

  it("an entry without the id field keeps its path id and says so", async () => {
    const warnings = captureWarnings();
    const { kb } = Object.fromEntries(
      await loadVault({ idField: "nickname", indexRoute: undefined, route: undefined }),
    );
    expect(byPath(kb!, "Frappe/README.md").id).toBe("Frappe");
    expect(warnings.some((w) => w.includes('has no usable "nickname" field'))).toBe(true);
  });

  it("reports two entries that share an id, naming both files", async () => {
    const warnings = captureWarnings();
    await loadVault();
    const dup = warnings.find((w) => w.includes('the id "swap-configuration"'));
    expect(dup).toContain("Linux/Swap Configuration.md");
    expect(dup).toContain("Linux/Swap Notes Archive.md");
  });
});

describe("routes", () => {
  it("routes documents by category and slug, and sections to their directory", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    const route = (path: string) => byPath(kb!, path)._meta?.route;
    expect(route("Frappe/Bench Operations.md")).toBe("/kb/frappe/bench-operations");
    expect(route("Frappe/README.md")).toBe("/kb/frappe");
    expect(route("Git & Dev Tools/README.md")).toBe("/kb/git-and-dev-tools");
    expect(route("Git & Dev Tools/Git Cheatsheet.md")).toBe("/kb/git-and-dev-tools/git-cheatsheet");
    expect(route("WordPress/README.md")).toBe("/kb/wordpress");
    expect(route("WordPress/Gravity Forms/README.md")).toBe("/kb/wordpress/gravity-forms");
    expect(route("WordPress/Gravity Forms/Submission Overlay Spinner.md")).toBe(
      "/kb/wordpress/submission-overlay-spinner",
    );
    expect(route("Linux/sudo-rs and update-alternatives.md")).toBe("/kb/linux/sudo-rs");
  });

  it("stamps the link-target url with the site's trailing-slash rule", async () => {
    captureWarnings();
    const always = Object.fromEntries(await loadVault()).kb!;
    expect(byPath(always, "Frappe/README.md")._meta?.url).toBe("/kb/frappe/");
    const never = Object.fromEntries(
      await loadVault({}, { build: { trailingSlash: "never" } }),
    ).kb!;
    expect(byPath(never, "Frappe/README.md")._meta?.url).toBe("/kb/frappe");
  });

  it("reports a duplicate route and routes only the first", async () => {
    const warnings = captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    const dup = warnings.find((w) => w.includes("two entries at /kb/linux/swap-configuration"));
    expect(dup).toContain("Linux/Swap Configuration.md");
    expect(dup).toContain("Linux/Swap Notes Archive.md");
    expect(dup).toContain("Only Linux/Swap Configuration.md is routed");
    expect(byPath(kb!, "Linux/Swap Configuration.md")._meta?.route).toBe(
      "/kb/linux/swap-configuration",
    );
    expect(byPath(kb!, "Linux/Swap Notes Archive.md")._meta?.route).toBeUndefined();
  });

  it("an entry the template cannot render has no route, and the build says why", async () => {
    const warnings = captureWarnings();
    const { kb } = Object.fromEntries(
      await loadVault({
        idField: undefined,
        indexRoute: undefined,
        route: "/kb/{category:slug}/{nickname}/",
      }),
    );
    expect(byPath(kb!, "Frappe/README.md")._meta?.route).toBeUndefined();
    expect(warnings.some((w) => w.includes('field "nickname"'))).toBe(true);
  });

  it("a malformed route template is a build error naming the content type", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadVault({ route: "kb/{slug}" })).rejects.toThrow(
      /Content type "kb": route: a route template is a site-absolute path/,
    );
  });

  it("a type with no route stamps none and rewrites no links", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault({ indexRoute: undefined, route: undefined }));
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    expect(entry._meta?.route).toBeUndefined();
    expect(entry._meta?.url).toBeUndefined();
    expect(links(entry).find((l) => l.text === "Swap")?.href).toBe(
      "../Linux/Swap%20Configuration.md",
    );
  });
});

describe("links between entries", () => {
  const bench = async (overrides: Record<string, unknown> = {}) => {
    const { kb } = Object.fromEntries(await loadVault(overrides));
    return byPath(kb!, "Frappe/Bench Operations.md");
  };
  const href = (entry: ContentLoaderEntry, text: string) =>
    links(entry).find((l) => l.text === text)?.href;

  it("rewrites a relative .md link, decoding spaces, to the target's routed URL", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "Swap")).toBe("/kb/linux/swap-configuration/");
  });

  it("resolves ../ traversal, a bare directory and an explicit README", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "Frappe")).toBe("/kb/frappe/");
    expect(href(entry, "the folder")).toBe("/kb/frappe/");
    const spinner = byPath(
      Object.fromEntries(await loadVault()).kb!,
      "WordPress/Gravity Forms/Submission Overlay Spinner.md",
    );
    expect(href(spinner, "Gravity Forms index")).toBe("/kb/wordpress/gravity-forms/");
    expect(href(spinner, "WordPress")).toBe("/kb/wordpress/");
  });

  it("normalises #fragments to heading ids and keeps ?query", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "migrate")).toBe("/kb/frappe/custom-pages/#custom-page-setup");
    expect(href(entry, "heading")).toBe("#restore-steps");
    expect(href(entry, "top")).toBe("#backups");
  });

  it("keeps ?query and rewrites the fragment of a link to a routed entry", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "query")).toBe("/kb/linux/swap-configuration/?tab=2#create-a-swap-file");
  });

  it("a link to a duplicate-route loser renders as text and says why", async () => {
    const warnings = captureWarnings();
    const entry = await bench();
    expect(links(entry).some((l) => l.text === "archived")).toBe(false);
    expect(
      warnings.some(
        (w) =>
          w.startsWith("Content links:") &&
          w.includes("Frappe/Bench Operations.md") &&
          w.includes("../Linux/Swap%20Notes%20Archive.md") &&
          w.includes(
            "its route /kb/linux/swap-configuration is already used by Linux/Swap Configuration.md",
          ),
      ),
    ).toBe(true);
  });

  it("leaves external, mailto, tel, absolute, asset and fragment links exactly as written", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "site")).toBe("https://example.com/guide.md");
    expect(href(entry, "mail")).toBe("mailto:support@example.com");
    expect(href(entry, "phone")).toBe("tel:+15555550100");
    expect(href(entry, "absolute")).toBe("/already/absolute/");
    expect(href(entry, "asset")).toBe("assets/diagram.png");
    expect(href(entry, "pdf")).toBe("assets/guide.pdf");
  });

  it("images keep working: the relative src is remapped onto the collection mount", async () => {
    captureWarnings();
    const entry = await bench();
    const [img] = find(entry.$children, (el) => el.tagName === "img");
    expect(img!.attributes?.src).toBe("/content/kb/Frappe/assets/diagram.png");
  });

  it("renders a link to an unpublished or missing entry as text and warns with file and target", async () => {
    const warnings = captureWarnings();
    const entry = await bench();
    for (const text of ["draft", "private", "internal", "missing", "escape", "styleguide"]) {
      expect(links(entry).some((l) => l.text === text)).toBe(false);
    }
    const body = JSON.stringify(entry.$children);
    for (const text of ["draft", "private", "internal", "missing", "escape", "styleguide"]) {
      expect(body).toContain(`"${text}"`);
    }
    const linkWarnings = warnings.filter((w) => w.startsWith("Content links:"));
    const joined = linkWarnings.join("\n");
    expect(joined).toContain('"Frappe/Bench Operations.md" links to "Draft%20Recipe.md"');
    expect(joined).toContain("left out by where.status");
    expect(joined).toContain(
      'links to "Private%20Notes.md", which is not published (left out by where.publish)',
    );
    expect(joined).toContain(
      '"../internal/Company/Plan.md", which is not published (excluded by "internal/**")',
    );
    expect(joined).toContain('"Nope.md", which does not exist');
    expect(joined).toContain('"../../../etc/passwd.md", which points outside');
    expect(joined).toContain('"../STYLE.md", which is not published (excluded by "STYLE.md")');
  });

  it("never rewrites a path outside the source root, however it is spelled", async () => {
    captureWarnings();
    const entry = await bench();
    expect(JSON.stringify(entry.$children)).not.toContain("etc/passwd");
    expect(JSON.stringify(entry.$children)).not.toContain('"href":"../../');
  });

  it("links: error fails the build with every broken link in one message", async () => {
    captureWarnings();
    const attempt = loadVault({ links: "error" });
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(attempt).rejects.toThrow(/Content links: "kb" has \d+ broken links:/);
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(attempt).rejects.toThrow(/Draft%20Recipe\.md/);
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(attempt).rejects.toThrow(/Nope\.md/);
  });

  it("links: ignore is silent but still never publishes a dead link", async () => {
    const warnings = captureWarnings();
    const entry = await bench({ links: "ignore" });
    expect(warnings.filter((w) => w.startsWith("Content links:"))).toEqual([]);
    expect(links(entry).some((l) => l.text === "draft")).toBe(false);
  });

  it("an invalid links value is a build error", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadVault({ links: "loud" })).rejects.toThrow(
      /Content type "kb": "links" must be "warn", "error" or "ignore"/,
    );
  });

  it("warns once per source file and target", async () => {
    const warnings = captureWarnings();
    await loadVault();
    const drafts = warnings.filter((w) => w.includes("Draft%20Recipe.md"));
    expect(drafts).toHaveLength(1);
  });
});

describe("alerts", () => {
  it("renders alerts as callouts, including one nested in a list", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    const alerts = find(entry.$children, (el) => el.attributes?.role === "note");
    expect(alerts.map((a) => a.attributes?.["data-alert"])).toEqual(["note", "warning", "tip"]);
    const warning = alerts[1]!;
    expect((warning.children as JxElement[])[0]!.textContent).toBe("Destructive");
    expect(find(entry.$children, (el) => el.tagName === "blockquote")).toEqual([]);
  });

  it("the type's alerts option maps a callout to a component", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(
      await loadVault({ alerts: { NOTE: "doc-note", WARNING: "doc-warning" } }),
    );
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    const mapped = find(
      entry.$children,
      (el) => typeof el.tagName === "string" && el.tagName.startsWith("doc-"),
    );
    expect(mapped.map((el) => el.tagName)).toEqual(["doc-note", "doc-warning"]);
    expect(mapped[1]!.attributes?.["data-title"]).toBe("Destructive");
    expect(find(entry.$children, (el) => el.attributes?.["data-alert"] === "tip")).toHaveLength(1);
  });

  it("alerts: false leaves them as blockquotes", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault({ alerts: false }));
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    expect(find(entry.$children, (el) => el.tagName === "blockquote").length).toBeGreaterThan(0);
  });

  it("a malformed alerts option is a build error naming the content type", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadVault({ alerts: { NOTE: 3 } })).rejects.toThrow(
      /Content type "kb": "alerts"\.NOTE: expected an element name/,
    );
  });
});

describe("code fences with braces", () => {
  /** The text of a node, reading escaped innerHTML back the way a browser would. */
  const textOf = (node: JxElement | string): string => {
    if (typeof node === "string") {
      return node;
    }
    if (typeof node.innerHTML === "string") {
      return node.innerHTML
        .replaceAll("&#36;", "$")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
    }
    return (
      (node.textContent ?? "") +
      ((node.children as (JxElement | string)[] | undefined) ?? [])
        .map((child) => textOf(child))
        .join("")
    );
  };

  it("keeps double braces and ${…} verbatim in highlighted code", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    const [python, , js] = find(entry.$children, (el) => el.tagName === "pre");
    expect(textOf(python!)).toContain("{{ doc.name }} says ${first} ${last}");
    expect(textOf(js!)).toContain(
      'const html = `<div class="alert alert-info">${__("Pick one")}</div>`;',
    );
    expect(entry.body).toContain("{{ doc.name }}");
  });

  it("never leaves a ${ in the tree for the build to read as a template", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    const entry = byPath(kb!, "Frappe/Bench Operations.md");
    expect(JSON.stringify(entry.$children)).not.toContain("${");
    // The raw body, which Studio writes back, is never touched.
    expect(entry.body).toContain("${first}");
    expect(
      textOf({ children: entry.$children as (JxElement | string)[], tagName: "div" }),
    ).toContain("Prose naming ${first} and inline code ${last}.");
  });

  it("highlights the languages the vault uses", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    for (const [path, lang] of [
      ["Frappe/Bench Operations.md", "python"],
      ["Frappe/Bench Operations.md", "caddyfile"],
      ["Linux/Swap Configuration.md", "sql"],
      ["WordPress/Docket Cache.md", "php"],
      ["Git & Dev Tools/Git Cheatsheet.md", "diff"],
    ] as const) {
      const entry = byPath(kb!, path);
      const hit = find(entry.$children, (el) => el.className === `language-${lang} shiki`);
      expect(hit.length).toBeGreaterThan(0);
    }
  });
});

describe("$paths for a routed type", () => {
  const paths = async (
    urlPattern: string,
    params: string[],
    pathsDef: Record<string, unknown>,
    locale?: string,
  ) => {
    const data = await loadVault();
    return Content.resolvePaths(pathsDef as never, {
      data,
      params,
      projectConfig: {},
      root: TMP,
      urlPattern,
      ...(locale === undefined ? {} : { locale }),
    });
  };
  const strip = (rows: Record<string, unknown>[]) =>
    rows
      .map(({ _meta, ...params }) => params)
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

  it("a catch-all page gets every route with no param named", async () => {
    captureWarnings();
    const rows = strip(await paths("/kb/*", ["path"], { contentType: "kb" }));
    expect(rows).toContainEqual({ path: "frappe" });
    expect(rows).toContainEqual({ path: "frappe/bench-operations" });
    expect(rows).toContainEqual({ path: "git-and-dev-tools/git-cheatsheet" });
    expect(rows).toContainEqual({ path: "wordpress/gravity-forms" });
    // One entry lost the duplicate route; every other published entry has one.
    expect(rows).toHaveLength(PUBLISHED_PATHS.length - 1);
  });

  it("[category]/[slug] pages get named parameters, and section pages their own", async () => {
    captureWarnings();
    const articles = strip(
      await paths("/kb/:category/:slug", ["category", "slug"], { contentType: "kb" }),
    );
    expect(articles).toContainEqual({ category: "frappe", slug: "bench-operations" });
    expect(articles).toContainEqual({ category: "wordpress", slug: "gravity-forms" });
    expect(articles.every((r) => "category" in r && "slug" in r)).toBe(true);
    const sections = strip(await paths("/kb/:category", ["category"], { contentType: "kb" }));
    expect(sections).toContainEqual({ category: "frappe" });
    expect(sections).toContainEqual({ category: "git-and-dev-tools" });
    expect(sections).toHaveLength(4);
    expect(sections.map((r) => r.category).toSorted()).toEqual([
      "frappe",
      "git-and-dev-tools",
      "linux",
      "wordpress",
    ]);
  });

  it("carries each entry's _meta so the sitemap can date the page", async () => {
    captureWarnings();
    const rows = await paths("/kb/*", ["path"], { contentType: "kb" });
    expect(rows.every((r) => typeof (r._meta as { mtime?: string }).mtime === "string")).toBe(true);
  });

  it("explicit param and field still win, with the older meaning", async () => {
    captureWarnings();
    const rows = strip(
      await paths("/kb/*", ["path"], { contentType: "kb", field: "slug", param: "slug" }),
    );
    expect(rows).toContainEqual({ slug: "bench-operations" });
    const defaults = strip(await paths("/kb/*", ["path"], { contentType: "kb", param: "path" }));
    expect(defaults).toContainEqual({ path: "bench-operations" });
  });

  it("a page whose pattern fits no route generates nothing and says why", async () => {
    const warnings = captureWarnings();
    const rows = await paths("/docs/:slug", ["slug"], { contentType: "kb" });
    expect(rows).toEqual([]);
    expect(
      warnings.some((w) => w.includes('no entry route fits the page pattern "/docs/:slug"')),
    ).toBe(true);
  });

  it("without the page pattern it falls back to the id-based expansion", async () => {
    captureWarnings();
    const data = await loadVault();
    const rows = await Content.resolvePaths({ contentType: "kb" }, { data, root: TMP });
    expect(rows).toContainEqual(expect.objectContaining({ slug: "bench-operations" }));
  });

  it("strips a locale prefix from the page pattern before matching", async () => {
    captureWarnings();
    const data = await loadVault();
    const rows = await Content.resolvePaths(
      { contentType: "kb" },
      {
        data,
        locale: "fr",
        params: ["path"],
        projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
        root: TMP,
        urlPattern: "/fr/kb/*",
      },
    );
    expect(strip(rows)).toContainEqual({ path: "frappe/bench-operations" });
    const home = await Content.resolvePaths(
      { contentType: "kb" },
      {
        data,
        locale: "fr",
        params: ["slug"],
        projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
        root: TMP,
        urlPattern: "/fr",
      },
    );
    expect(home).toEqual([]);
  });
});

describe("ContentEntry bound to its page", () => {
  const entryFor = async (urlPattern: string, extra: Record<string, unknown> = {}) => {
    captureWarnings();
    const data = await loadVault();
    return new ContentEntry({
      _document: { route: { urlPattern } },
      _project: { config: {}, content: data },
      contentType: "kb",
      ...extra,
    }).resolve() as ContentLoaderEntry | null;
  };

  it("with no id, finds the entry whose route is the page's URL", async () => {
    const article = await entryFor("/kb/frappe/bench-operations");
    const section = await entryFor("/kb/frappe");
    const slashed = await entryFor("/kb/frappe/bench-operations/");
    expect(article?.data.title).toBe("Bench Operations");
    expect(section?.data.title).toBe("Frappe Framework and ERPNext");
    expect(slashed?.id).toBe("bench-operations");
  });

  it("is null for a URL no entry owns, or a page with no URL", async () => {
    expect(await entryFor("/kb/nope")).toBeNull();
    captureWarnings();
    const data = await loadVault();
    expect(
      new ContentEntry({ _project: { content: data }, contentType: "kb" }).resolve(),
    ).toBeNull();
  });

  it("an explicit id still looks the entry up by id", async () => {
    const byId = await entryFor("/anything", { id: "bench-operations" });
    const byField = await entryFor("/anything", { field: "slug", id: "git-cheatsheet" });
    expect(byId?.data.title).toBe("Bench Operations");
    expect(byField?.data.title).toBe("Git Cheatsheet");
  });
});

describe("the loaded collection is the filtered one", () => {
  it("holds only published entries for every consumer that reads the map", async () => {
    captureWarnings();
    const data = await loadVault();
    const titles = data.get("kb")!.map((e) => e.data.title);
    expect(titles).not.toContain("Draft Recipe");
    expect(titles).not.toContain("Private Notes");
    expect(titles).not.toContain("Plan");
    expect(titles).not.toContain("Style Guide");
  });

  it("the fixture really contains the files the rules exist to hide", () => {
    for (const hidden of [
      "STYLE.md",
      "internal/Company/Plan.md",
      "Sites/demo/content/post.md",
      "Frappe/Draft Recipe.md",
      "Frappe/Private Notes.md",
      ".obsidian/notes.md",
    ]) {
      expect(VAULT_FILES[hidden]).toBeDefined();
    }
  });
});
