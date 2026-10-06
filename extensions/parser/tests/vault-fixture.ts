/**
 * A small Obsidian-style vault that mirrors the shape of a real knowledge base, written to disk for
 * the "vault as content" tests.
 *
 * Everything that made the real thing awkward to publish is here on purpose: filenames with spaces,
 * a `Git & Dev Tools` category, a nested subfolder with its own README, section READMEs that carry
 * a slug, unpublished and draft documents, links to documents that are unpublished or missing,
 * GitHub alerts (one nested in a list), code fences containing double braces and `${…}`, files that
 * are not documents at all (a README with no frontmatter, a style guide, a working-notes folder, an
 * app's own `node_modules`), and two documents that claim the same slug.
 *
 * The content is invented; nothing in it is real.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Frontmatter block from key/value pairs; arrays and booleans are written as YAML. */
function doc(front: Record<string, unknown> | null, body: string): string {
  if (front === null) {
    return `${body.trim()}\n`;
  }
  const lines = Object.entries(front).map(([key, value]) =>
    Array.isArray(value) ? `${key}: [${value.join(", ")}]` : `${key}: ${String(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

/** The frontmatter a published knowledge-base document carries. */
function page(
  category: string,
  slug: string,
  title: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title,
    description: `${title}, written for the fixture.`,
    slug,
    category,
    tags: [slug.split("-")[0]!, "fixture"],
    created: "2024-01-02",
    updated: "2026-10-01",
    status: "review",
    publish: true,
    ...extra,
  };
}

/** Every file of the fixture vault: relative path → file text. */
export const VAULT_FILES: Record<string, string> = {
  // ── Not documents ────────────────────────────────────────────────────────────
  "README.md": doc(null, "# Vault\n\nIndex of sections. See [Frappe](Frappe/README.md)."),
  "STYLE.md": doc({ title: "Style Guide", slug: "style-guide", publish: false }, "Conventions."),
  ".obsidian/notes.md": doc(page("Meta", "obsidian-notes", "App notes"), "Hidden app folder."),
  "internal/README.md": doc({ title: "Internal", publish: false }, "Private."),
  "internal/Clients/Acme Print/Notes.md": doc(
    { title: "Client notes", slug: "client-notes", publish: false },
    "Private client material.",
  ),
  // Flagged publish: true on purpose, so the exclude glob and not the flag keeps it out.
  "internal/Company/Plan.md": doc(page("Internal", "plan", "Plan"), "Excluded by path."),
  "Sites/demo/content/post.md": doc({ title: "A site post" }, "Belongs to a website project."),
  "Sites/demo/node_modules/pkg/README.md": doc(page("Pkg", "pkg", "Package"), "Vendored."),
  "Jx/Slides.md": doc(null, "Presentation outline with no frontmatter."),

  // ── Frappe ───────────────────────────────────────────────────────────────────
  "Frappe/README.md": doc(
    page("Frappe", "frappe", "Frappe Framework and ERPNext"),
    `
Section index.

- [Bench Operations](Bench%20Operations.md): backups and migrations.
- [Custom Pages](Custom%20Pages.md): standalone pages.
`,
  ),
  "Frappe/Bench Operations.md": doc(
    page("Frappe", "bench-operations", "Bench Operations"),
    `
Run these from the bench directory. Swap is covered in [Swap](../Linux/Swap%20Configuration.md); the
section index is [Frappe](README.md) and also [the folder](../Frappe/).

## Backups

> [!NOTE]
> Take a backup before you [migrate](Custom%20Pages.md#Custom%20Page%20Setup).

> [!WARNING] Destructive
> This **drops** the site.

## Restore Steps

1. Stop the bench.
2. Restore.
   > [!TIP]
   > Restore into a scratch site first.

## Links that must not publish

[draft](Draft%20Recipe.md), [private](Private%20Notes.md), [internal](../internal/Company/Plan.md),
[missing](Nope.md), [escape](../../../etc/passwd.md), [styleguide](../STYLE.md) and
[archived](../Linux/Swap%20Notes%20Archive.md).

## Links that stay as written

[site](https://example.com/guide.md), [mail](mailto:support@example.com), [phone](tel:+15555550100),
[absolute](/already/absolute/), [asset](assets/diagram.png), [top](#backups),
[heading](#Restore%20Steps), [pdf](assets/guide.pdf), [query](../Linux/Swap%20Configuration.md?tab=2#Create%20a%20Swap%20File).

![diagram](assets/diagram.png)

\`\`\`python
# Jinja and JavaScript templates must survive untouched
print("{{ doc.name }} says \${first} \${last}")
\`\`\`

\`\`\`caddyfile
example.com {
    reverse_proxy {host}
}
\`\`\`

\`\`\`js
const html = \`<div class="alert alert-info">\${__("Pick one")}</div>\`;
\`\`\`

Prose naming \${first} and inline code \`\${last}\`.
`,
  ),
  "Frappe/assets/diagram.png": "\u0089PNG",
  "Frappe/assets/guide.pdf": "%PDF-1.4",
  "Frappe/Custom Pages.md": doc(
    page("Frappe", "custom-pages", "Custom Pages"),
    "## Custom Page Setup\n\nBack to [Bench Operations](Bench%20Operations.md).",
  ),
  "Frappe/Draft Recipe.md": doc(
    page("Frappe", "draft-recipe", "Draft Recipe", { status: "draft" }),
    "Unreviewed.",
  ),
  "Frappe/Private Notes.md": doc(
    page("Frappe", "private-notes", "Private Notes", { publish: false }),
    "Not for the website.",
  ),

  // ── Linux ────────────────────────────────────────────────────────────────────
  "Linux/README.md": doc(page("Linux", "linux", "Linux"), "Server configuration."),
  "Linux/Swap Configuration.md": doc(
    page("Linux", "swap-configuration", "Swap Configuration"),
    `
## Create a Swap File

\`\`\`bash
fallocate -l 4G /swapfile
\`\`\`

\`\`\`sql
SELECT 1;
\`\`\`
`,
  ),
  // Same category, same slug: a real duplicate. It sorts after the document above, so it loses.
  "Linux/Swap Notes Archive.md": doc(
    page("Linux", "swap-configuration", "Swap Notes Archive"),
    "Superseded notes that claim the same slug.",
  ),
  "Linux/sudo-rs and update-alternatives.md": doc(
    page("Linux", "sudo-rs", "sudo-rs and update-alternatives"),
    "Lower-case file name.",
  ),

  // ── Git & Dev Tools ──────────────────────────────────────────────────────────
  "Git & Dev Tools/README.md": doc(
    page("Git & Dev Tools", "git-and-dev-tools", "Git & Dev Tools"),
    "Tips for everyday tools.",
  ),
  "Git & Dev Tools/Git Cheatsheet.md": doc(
    page("Git & Dev Tools", "git-cheatsheet", "Git Cheatsheet"),
    "```diff\n- old\n+ new\n```",
  ),

  // ── WordPress, with nested sub-sections ──────────────────────────────────────
  "WordPress/README.md": doc(page("WordPress", "wordpress", "WordPress"), "WordPress recipes."),
  "WordPress/Docket Cache.md": doc(
    page("WordPress", "docket-cache", "Docket Cache"),
    "```php\n<?php echo 1;\n```",
  ),
  "WordPress/Gravity Forms/README.md": doc(
    page("WordPress", "gravity-forms", "Gravity Forms"),
    "Sub-section index: [Spinner](Submission%20Overlay%20Spinner.md).",
  ),
  "WordPress/Gravity Forms/Submission Overlay Spinner.md": doc(
    page("WordPress", "submission-overlay-spinner", "Submission Overlay Spinner"),
    "Back to the [Gravity Forms index](README.md) or [WordPress](../README.md).",
  ),
  "WordPress/WooCommerce/README.md": doc(
    page("WordPress", "woocommerce", "WooCommerce", { status: "draft" }),
    "Held back.",
  ),
};

/** Write {@link VAULT_FILES} under `root`. */
export function writeVault(root: string): void {
  for (const [rel, text] of Object.entries(VAULT_FILES)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

/**
 * The documents a `publish: true`, not-`draft` rule keeps, in the order a sorted depth-first walk
 * visits them (entries sorted by name within each directory, so `Gravity Forms/` precedes
 * `README.md` beside it).
 */
export const PUBLISHED_PATHS = [
  "Frappe/Bench Operations.md",
  "Frappe/Custom Pages.md",
  "Frappe/README.md",
  "Git & Dev Tools/Git Cheatsheet.md",
  "Git & Dev Tools/README.md",
  "Linux/README.md",
  "Linux/Swap Configuration.md",
  "Linux/Swap Notes Archive.md",
  "Linux/sudo-rs and update-alternatives.md",
  "WordPress/Docket Cache.md",
  "WordPress/Gravity Forms/README.md",
  "WordPress/Gravity Forms/Submission Overlay Spinner.md",
  "WordPress/README.md",
];

/** The `kb` content type the knowledge-base conventions call for. */
export const KB_TYPE = {
  exclude: [
    "internal/**",
    "Sites/**",
    "Jx/**",
    "STYLE.md",
    "README.md",
    ".*/**",
    "**/node_modules/**",
  ],
  format: "Markdown",
  idField: "slug",
  links: "warn" as const,
  indexRoute: "/kb/{dir:slug}/",
  route: "/kb/{category:slug}/{slug}/",
  schema: {
    properties: {
      category: { type: "string" },
      created: { format: "date", type: "string" },
      description: { type: "string" },
      publish: { type: "boolean" },
      slug: { type: "string" },
      status: { type: "string" },
      tags: { items: { type: "string" }, type: "array" },
      title: { type: "string" },
      updated: { format: "date", type: "string" },
    },
    required: ["title", "description", "slug", "category"],
    type: "object",
  },
  source: ".",
  where: { publish: true, status: { $ne: "draft" } },
};
