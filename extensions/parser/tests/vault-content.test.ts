/**
 * Vault-as-content integration tests: a documentation vault published straight from its folder.
 *
 * Drives the real `Content` project-section class through a real extension registry over the
 * fixture vault in `vault-fixture.ts`, so exclusion, `where`, ids, routes, link rewriting, alerts,
 * `$paths` expansion and entry binding are exercised exactly as a host runs them.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { assetUrlFor, resolveAssetUrl } from "@jxsuite/schema/asset-paths";
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
import {
  DUPLICATE_ROUTE_PATH,
  KB_TYPE,
  PUBLISHED_PATHS,
  VAULT_FILES,
  writeVault,
} from "./vault-fixture.ts";

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
    expect(dup).toContain(DUPLICATE_ROUTE_PATH);
    expect(dup).toContain("Only Linux/Swap Configuration.md is routed");
    expect(byPath(kb!, "Linux/Swap Configuration.md")._meta?.route).toBe(
      "/kb/linux/swap-configuration",
    );
  });

  it("an entry with no route of its own is not in the collection, so no consumer can invent one", async () => {
    captureWarnings();
    const { kb } = Object.fromEntries(await loadVault());
    // The loser of the duplicate route is published and not a draft, and still has no page.
    expect(kb!.some((e) => e._meta?.path === DUPLICATE_ROUTE_PATH)).toBe(false);
    expect(
      kb!.every((e) => typeof e._meta?.route === "string" && typeof e._meta?.url === "string"),
    ).toBe(true);
    // Without a route template nothing is dropped: the collection is whatever was loaded.
    const flat = Object.fromEntries(
      await loadVault({ indexRoute: undefined, route: undefined }),
    ).kb!;
    expect(flat.some((e) => e._meta?.path === DUPLICATE_ROUTE_PATH)).toBe(true);
  });

  it("an entry the template cannot render has no route, is left out, and the build says why", async () => {
    const warnings = captureWarnings();
    const { kb } = Object.fromEntries(
      await loadVault({
        idField: undefined,
        indexRoute: undefined,
        route: "/kb/{category:slug}/{nickname}/",
      }),
    );
    expect(kb).toEqual([]);
    expect(warnings.some((w) => w.includes('field "nickname"'))).toBe(true);
  });

  it("names a reason once, with a count and examples, when most entries share it", async () => {
    const warnings = captureWarnings();
    await loadVault({
      idField: undefined,
      indexRoute: undefined,
      route: "/kb/{category:slug}/{nickname}/",
    });
    const routeWarnings = warnings.filter((w) => w.startsWith("Content routes:"));
    expect(routeWarnings).toHaveLength(1);
    expect(routeWarnings[0]).toMatch(
      /Content routes: "kb": \d+ entries have no route: field "nickname"/,
    );
    expect(routeWarnings[0]).toContain("for example");
  });

  it("lists a few unrouted entries one by one", async () => {
    const warnings = captureWarnings();
    await loadVault({
      idField: undefined,
      indexRoute: undefined,
      route: "/kb/{nickname}/",
      where: { slug: "frappe" },
    });
    expect(warnings.filter((w) => w.startsWith("Content routes:"))).toEqual([
      expect.stringContaining('(Frappe/README.md) has no route: field "nickname"'),
    ]);
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

  it("leaves external, mailto, tel, absolute and fragment links exactly as written", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "site")).toBe("https://example.com/guide.md");
    expect(href(entry, "mail")).toBe("mailto:support@example.com");
    expect(href(entry, "phone")).toBe("tel:+15555550100");
    expect(href(entry, "absolute")).toBe("/already/absolute/");
  });

  it("publishes a link to an attachment at the collection's asset URL, like an image", async () => {
    captureWarnings();
    const entry = await bench();
    expect(href(entry, "asset")).toBe("/content/kb/Frappe/assets/diagram.png");
    expect(href(entry, "pdf")).toBe("/content/kb/Frappe/assets/guide.pdf");
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
    // One entry lost the duplicate route and is not in the collection; every other has one.
    expect(rows).toHaveLength(PUBLISHED_PATHS.length);
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

// ─── Hardening: what a reviewer could make the loader do wrong ───────────────

let sandboxCounter = 0;

/**
 * Load a small vault written for one test: `files` are relative paths under a fresh directory, and
 * the `kb` type is `overrides` over a Markdown directory source with a route. Returns the entries
 * and the warnings the load printed.
 */
async function loadFiles(
  files: Record<string, string>,
  overrides: Record<string, unknown> = {},
  projectConfig: ProjectConfig = {},
) {
  sandboxCounter += 1;
  const dir = join(TMP, `sandbox-${sandboxCounter}`);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  const warnings = captureWarnings();
  const section = {
    kb: {
      format: "Markdown",
      route: "/kb/{id:slug}/",
      source: `./sandbox-${sandboxCounter}`,
      ...overrides,
    },
  } as unknown as ContentSection;
  const data = await Content.projectData(section, {
    projectConfig,
    registry: await registry(),
    root: TMP,
  });
  return { dir, entries: data.get("kb")!, section, warnings };
}

const note = (title: string, body = "", extra = "") =>
  `---\ntitle: ${title}\n${extra}---\n\n${body}\n`;

describe("option names", () => {
  it("an option that is one typo from a real one is a build error, so a filter cannot fail open", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadFiles({ "a.md": note("A") }, { excludes: ["internal/**"] })).rejects.toThrow(
      /Content type "kb": unknown option "excludes", did you mean "exclude"\?/,
    );
    for (const [typo, want] of [
      ["exlude", "exclude"],
      ["wher", "where"],
      ["idfield", "idField"],
      ["routes", "route"],
      ["link", "links"],
      ["alert", "alerts"],
      ["indexroute", "indexRoute"],
    ] as const) {
      // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
      await expect(loadFiles({ "a.md": note("A") }, { [typo]: "x" })).rejects.toThrow(
        new RegExp(`unknown option "${typo}", did you mean "${want}"`),
      );
    }
  });

  it("a key that resembles nothing is ignored, and said so", async () => {
    const { warnings, entries } = await loadFiles({ "a.md": note("A") }, { flavour: "mild" });
    expect(entries).toHaveLength(1);
    expect(
      warnings.some((w) => w.includes('Content type "kb": ignores the unknown option "flavour"')),
    ).toBe(true);
  });

  it("every documented option, and $comment, is accepted silently", async () => {
    const { warnings } = await loadFiles(
      { "a.md": note("A", "", "slug: a\n") },
      {
        $comment: "notes",
        alerts: { NOTE: true },
        exclude: ["x/**"],
        idField: "slug",
        indexRoute: "/kb/{dir:slug}/",
        links: "warn",
        schema: { properties: {}, type: "object" },
        where: { title: "A" },
      },
    );
    expect(warnings.filter((w) => w.includes("unknown option"))).toEqual([]);
  });
});

describe("a file that cannot be read", () => {
  it("names the file and says how to move on", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(
      loadFiles({
        "good.md": note("Good"),
        "Templates/Note.md": "---\ntitle: [unclosed\npublish: false\n---\n\nbody\n",
      }),
    ).rejects.toThrow(
      /Content type "kb": cannot read "Templates\/Note\.md": .*Fix the file, or add it to "exclude"/,
    );
  });

  it("is no problem when the folder is excluded", async () => {
    const { entries } = await loadFiles(
      { "good.md": note("Good"), "Templates/Note.md": "---\ntitle: [unclosed\n---\n" },
      { exclude: ["Templates"] },
    );
    expect(entries.map((e) => e._meta?.path)).toEqual(["good.md"]);
  });
});

describe("a filter that removes everything", () => {
  it("where says so, with the field it failed on", async () => {
    const { entries, warnings } = await loadFiles(
      { "a.md": note("A", "", "publish: true\n"), "b.md": note("B", "", "publish: true\n") },
      { where: { publish: "true" } },
    );
    expect(entries).toEqual([]);
    const warning = warnings.find((w) => w.includes('"where" left out all 2 entries'));
    expect(warning).toContain('failed on "publish"');
  });

  it("is silent when the source is simply empty", async () => {
    const { warnings } = await loadFiles({ "readme.txt": "not a document" }, { where: { x: 1 } });
    expect(warnings.filter((w) => w.includes('"where" left out'))).toEqual([]);
  });

  it("exclude says so when nothing is left to load", async () => {
    const { entries, warnings } = await loadFiles(
      { "a.md": note("A"), "b/c.md": note("C") },
      { exclude: ["**/*.md"] },
    );
    expect(entries).toEqual([]);
    expect(warnings.some((w) => w.includes("no file was loaded") && w.includes('"exclude"'))).toBe(
      true,
    );
  });

  it("a bare folder name in exclude excludes the folder", async () => {
    const { entries } = await loadFiles(
      { "a.md": note("A"), "internal/x.md": note("X"), "internal/deep/y.md": note("Y") },
      { exclude: ["internal"] },
    );
    expect(entries.map((e) => e._meta?.path)).toEqual(["a.md"]);
  });
});

describe("what the asset mount serves", () => {
  const files = {
    ".env": "SECRET=1",
    ".git/config": "[core]",
    "a.md": note(
      "A",
      [
        "![ok](pics/ok.png)",
        "![excluded](internal/secret.png)",
        "![hidden](.git/config)",
        "![dot](.env)",
        "![doc](internal/plan.md)",
        "![draft](notes/draft.md)",
      ].join("\n\n"),
      "publish: true\n",
    ),
    "internal/plan.md": note("Plan", "", "publish: true\n"),
    "internal/secret.png": "SECRET",
    "notes/draft.md": note("Draft", "", "publish: false\n"),
    "pics/ok.png": "PNG",
  };
  const options = { exclude: ["internal/**"], where: { publish: true } };

  it("a type that declares the vault options does not serve what they leave out", async () => {
    const { entries, warnings, section, dir } = await loadFiles(files, options);
    const srcs = find(entries[0]!.$children, (el) => el.tagName === "img").map(
      (el) => el.attributes?.src,
    );
    expect(srcs).toEqual([
      "/content/kb/pics/ok.png",
      "internal/secret.png",
      ".git/config",
      ".env",
      "internal/plan.md",
      "notes/draft.md",
    ]);
    const refused = warnings.filter((w) => w.includes("which the collection does not publish"));
    expect(refused).toHaveLength(5);
    expect(refused.join("\n")).toContain('"internal/secret.png"');
    // The mount itself says the same to every host that serves or copies through it.
    const [mount] = Content.assets(section, { root: TMP });
    expect(mount!.dir).toBe(resolve(dir));
    const { filter: serves } = mount!;
    expect(serves!("pics/ok.png")).toBe(true);
    for (const path of ["internal/secret.png", ".git/config", ".env", "a.md", "notes/draft.md"]) {
      expect(serves!(path)).toBe(false);
    }
    expect(resolveAssetUrl([mount!], "/content/kb/internal/secret.png")).toBeNull();
    expect(resolveAssetUrl([mount!], "/content/kb/pics/ok.png")).toBe(`${dir}/pics/ok.png`);
    expect(assetUrlFor([mount!], `${dir}/.env`)).toBeNull();
  });

  it("reaches an image in a raw HTML block, which is a nested list of nodes", async () => {
    const { entries } = await loadFiles(
      {
        "a.md": note(
          "A",
          '<div>\n<img src="pics/ok.png"> <img src=".env">\n</div>',
          "publish: true\n",
        ),
        ".env": "SECRET=1",
        "pics/ok.png": "PNG",
      },
      { where: { publish: true } },
    );
    const srcs = (entries[0]!.$children as unknown[])
      .flat(Number.POSITIVE_INFINITY)
      .flatMap((n) => find([n as JxElement], (el) => el.tagName === "img"))
      .map((el) => el.attributes?.src);
    expect(srcs).toEqual(["/content/kb/pics/ok.png", ".env"]);
  });

  it("an unfiltered type keeps today's behavior: the whole directory is served", async () => {
    const { section, warnings } = await loadFiles(files, {
      exclude: undefined,
      route: undefined,
      where: undefined,
    });
    const [mount] = Content.assets(section, { root: TMP });
    expect(mount!.filter).toBeUndefined();
    expect(warnings.filter((w) => w.includes("does not publish"))).toEqual([]);
  });

  it("a malformed exclude serves nothing until the load fails on it", () => {
    const [mount] = Content.assets(
      { kb: { exclude: ["!x"], format: "Markdown", source: "./sandbox-1" } },
      { root: TMP },
    );
    const { filter: serves } = mount!;
    expect(serves!("anything.png")).toBe(false);
  });
});

describe("links to files that are not entries", () => {
  const files = {
    "a.md": note(
      "A",
      "[pdf](files/report.pdf), [secret](internal/plan.pdf), [empty](Empty/), [gone](nowhere/x.png), [folder](sub/)",
    ),
    "Empty/keep.txt": "x",
    "files/report.pdf": "%PDF",
    "internal/plan.pdf": "%PDF",
    "sub/README.md": note("Sub"),
  };

  it("publishes an attachment at its mount URL and refuses one the collection excludes", async () => {
    const { entries, warnings } = await loadFiles(files, { exclude: ["internal/**"] });
    const a = byPath(entries, "a.md");
    expect(links(a).find((l) => l.text === "pdf")?.href).toBe("/content/kb/files/report.pdf");
    expect(links(a).find((l) => l.text === "gone")?.href).toBe("nowhere/x.png");
    expect(links(a).find((l) => l.text === "folder")?.href).toBe("/kb/sub/");
    for (const text of ["secret", "empty"]) {
      expect(links(a).some((l) => l.text === text)).toBe(false);
    }
    const joined = warnings.filter((w) => w.startsWith("Content links:")).join("\n");
    expect(joined).toContain(
      'links to "internal/plan.pdf", which is not published (excluded by "internal/**")',
    );
    expect(joined).toContain('links to "Empty/", which is a folder with no README.md or index.md');
  });
});

describe("ids that become directories", () => {
  it("an idField that would climb out of the output keeps the path id, and says so", async () => {
    const { entries, warnings } = await loadFiles(
      {
        "a.md": note("A", "", "slug: ../../../escaped\n"),
        "b.md": note("B", "", "slug: fine\n"),
        "c.md": note("C", "", "slug: a\\b\n"),
      },
      { idField: "slug", route: undefined },
    );
    expect(entries.map((e) => e.id)).toEqual(["a", "fine", "c"]);
    expect(warnings.filter((w) => w.includes('has a "slug" that'))).toEqual([
      expect.stringContaining('"kb/a" has a "slug" that contains a "." or ".." segment'),
      expect.stringContaining('"kb/c" has a "slug" that contains a backslash'),
    ]);
  });

  it("$paths with a field never hands a page an escaping value", async () => {
    const { entries } = await loadFiles(
      { "a.md": note("A", "", "slug: ../../x\n"), "b.md": note("B", "", "slug: ok\n") },
      { route: undefined },
    );
    const warnings = captureWarnings();
    const data = new Map([["kb", entries]]);
    const rows = await Content.resolvePaths(
      { contentType: "kb", field: "slug", param: "slug" },
      { data, root: TMP },
    );
    expect(rows.map((r) => r.slug)).toEqual(["ok"]);
    expect(warnings.some((w) => w.includes('"slug" of "a" contains a "." or ".." segment'))).toBe(
      true,
    );
  });
});

describe("a folder with a README and an index", () => {
  it("the index keeps the folder's id and the README keeps the one it had before", async () => {
    const { entries, warnings } = await loadFiles(
      {
        "Foo/README.md": note("Readme"),
        "Foo/index.md": note("Index"),
        "Bar/README.md": note("Bar readme"),
        "Foo/Sub/README.md": note("Sub"),
        "Foo/Sub/Index.md": note("Sub index"),
      },
      { route: undefined },
    );
    const ids = Object.fromEntries(entries.map((e) => [e._meta?.path, e.id]));
    expect(ids["Foo/index.md"]).toBe("Foo");
    expect(ids["Foo/README.md"]).toBe("Foo/README");
    expect(ids["Bar/README.md"]).toBe("Bar");
    // A capitalised Index.md is the folder's index like any other.
    expect(ids["Foo/Sub/Index.md"]).toBe("Foo/Sub");
    expect(ids["Foo/Sub/README.md"]).toBe("Foo/Sub/README");
    expect(warnings.filter((w) => w.includes("two entries with the id"))).toEqual([]);
    expect(warnings.filter((w) => w.includes("keeps the id")).length).toBe(2);
  });

  it("links to the folder resolve to the index, which is the entry that has the id", async () => {
    const { entries } = await loadFiles(
      {
        "Foo/README.md": note("Readme", "[home](../)"),
        "Foo/index.md": note("Index"),
        "top.md": note("Top", "[foo](Foo/)"),
      },
      { route: "/kb/{id:slug}/" },
    );
    expect(links(byPath(entries, "top.md")).find((l) => l.text === "foo")?.href).toBe("/kb/foo/");
    expect(byPath(entries, "Foo/index.md")._meta?.route).toBe("/kb/foo");
    expect(byPath(entries, "Foo/README.md")._meta?.route).toBe("/kb/foo/readme");
  });
});

describe("the page patterns of the project", () => {
  const loadEntries = async () => {
    const loaded = await loadFiles({
      "A/B/C/Deep.md": note("Deep"),
      "A/Mid.md": note("Mid"),
      "Top.md": note("Top"),
    });
    return loaded.entries;
  };
  const resolveWith = async (
    patterns: string[] | undefined,
    urlPattern: string,
    params: string[],
  ) => {
    const data = new Map([["kb", await loadEntries()]]);
    const warnings = captureWarnings();
    const rows = await Content.resolvePaths(
      { contentType: "kb" },
      { data, params, root: TMP, urlPattern, ...(patterns === undefined ? {} : { patterns }) },
    );
    return { rows, warnings };
  };

  it("reports once the routes that no page of the project produces", async () => {
    const { warnings } = await resolveWith(["/kb/:category/:slug"], "/kb/:category/:slug", [
      "category",
      "slug",
    ]);
    const unserved = warnings.filter((w) => w.includes("no dynamic page produces"));
    expect(unserved).toHaveLength(1);
    expect(unserved[0]).toContain("2 routed entries have a route");
    expect(unserved[0]).toContain("/kb/top");
    expect(unserved[0]).toContain("/kb/a/b/c/deep");
  });

  it("reports a content type once per build, however many pages ask", async () => {
    const data = new Map([["kb", await loadEntries()]]);
    const warnings = captureWarnings();
    for (let page = 0; page < 3; page++) {
      await Content.resolvePaths(
        { contentType: "kb" },
        { data, params: ["a", "b"], patterns: ["/kb/:a/:b"], root: TMP, urlPattern: "/kb/:a/:b" },
      );
    }
    expect(warnings.filter((w) => w.includes("no dynamic page produces"))).toHaveLength(1);
  });

  it("is quiet when other pages of the project serve the rest", async () => {
    const { rows, warnings } = await resolveWith(
      ["/kb/:category/:slug", "/kb/:slug", "/kb/*"],
      "/kb/:category/:slug",
      ["category", "slug"],
    );
    expect(rows).toHaveLength(1);
    expect(warnings.filter((w) => w.includes("no dynamic page produces"))).toEqual([]);
  });

  it("without the list it says nothing, and a single catch-all serves everything", async () => {
    const noPatterns = await resolveWith(undefined, "/docs/:slug", ["slug"]);
    expect(noPatterns.warnings).toEqual([expect.stringContaining("no entry route fits")]);
    const all = await resolveWith(["/kb/*"], "/kb/*", ["path"]);
    expect(all.rows).toHaveLength(3);
    expect(all.warnings).toEqual([]);
  });

  it("reads a localized project's patterns without their locale prefix", async () => {
    const data = new Map([["kb", await loadEntries()]]);
    const warnings = captureWarnings();
    await Content.resolvePaths(
      { contentType: "kb" },
      {
        data,
        locale: "fr",
        params: ["path"],
        patterns: ["/fr/kb/*"],
        projectConfig: { i18n: { defaultLocale: "en", locales: ["en", "fr"] } },
        root: TMP,
        urlPattern: "/fr/kb/*",
      },
    );
    expect(warnings.filter((w) => w.includes("no dynamic page produces"))).toEqual([]);
  });
});

describe("broken links in bulk", () => {
  it("names the first screenful and counts the rest", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `[l${i}](Missing${i}.md)`).join(" ");
    const { warnings } = await loadFiles({ "a.md": note("A", body) });
    const lines = warnings.filter((w) => w.startsWith("Content links:"));
    expect(lines).toHaveLength(26);
    expect(lines.at(-1)).toContain("and 5 more broken links");
  });

  it("error mode still lists every one", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `[l${i}](Missing${i}.md)`).join(" ");
    // oxlint-disable-next-line typescript/await-thenable -- bun:test async matcher returns a Promise; type-aware engine misresolves its return type
    await expect(loadFiles({ "a.md": note("A", body) }, { links: "error" })).rejects.toThrow(
      /has 30 broken links[\s\S]*Missing29\.md/,
    );
  });
});

describe("callouts of an unknown type", () => {
  it("are reported with the file, and the fix", async () => {
    const { warnings, entries } = await loadFiles({
      "a.md": note("A", "> [!info]\n> hello\n\n> [!NOTE]\n> fine\n"),
    });
    const callout = warnings.filter((w) => w.startsWith("Content callouts:"));
    expect(callout).toEqual([
      expect.stringContaining('"a.md" has a [!info] callout, but "info" is not an enabled type'),
    ]);
    expect(callout[0]).toContain('"alerts": { "INFO": true }');
    expect(find(entries[0]!.$children, (el) => el.tagName === "blockquote")).toHaveLength(1);
  });

  it("is quiet once the type is enabled", async () => {
    const { warnings } = await loadFiles(
      { "a.md": note("A", "> [!info]\n> hello\n") },
      { alerts: { INFO: true } },
    );
    expect(warnings.filter((w) => w.startsWith("Content callouts:"))).toEqual([]);
  });
});

describe("file names", () => {
  it("an .MD file is a document, and a capitalised Index.md is its folder's", async () => {
    const { entries } = await loadFiles(
      { "Shout.MD": note("Shout"), "Dir/Index.md": note("Dir index") },
      { route: undefined },
    );
    expect(entries.map((e) => e.id).toSorted()).toEqual(["Dir", "Shout"]);
  });
});

describe("a file saved with Windows line endings", () => {
  it("publishes its callouts, its frontmatter and its title without carriage returns", async () => {
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");
    const { entries, warnings } = await loadFiles(
      {
        "Win.md": crlf(
          "---\ntitle: Win\nslug: win\n---\n\n> [!NOTE]\n> Back up first.\n\n> [!WARNING] Careful\n> Drops the site.\n",
        ),
      },
      { route: undefined },
    );
    const [noteBox, warningBox] = find(entries[0]!.$children, (el) => el.tagName === "div");
    expect(noteBox!.className).toBe("jx-alert jx-alert-note");
    expect(warningBox!.className).toBe("jx-alert jx-alert-warning");
    expect(JSON.stringify(entries[0]!.$children)).not.toContain(String.raw`\r`);
    expect(entries[0]!.data.title).toBe("Win");
    expect(warnings.filter((w) => w.startsWith("Content callouts:"))).toEqual([]);
  });
});
