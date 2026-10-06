---
title: "Obsidian vault as content"
description: "Publish an Obsidian vault straight from its folder: filter drafts and private notes, route entries, render callouts, and keep relative links working."
spec:
  - parser.md#3.3
  - parser.md#9.4
  - parser.md#9.5
  - parser.md#9.6
code:
  - extensions/parser/src/content-loader.ts
  - extensions/parser/src/content-rules.ts
  - extensions/parser/src/content-routes.ts
  - extensions/parser/src/content-links.ts
  - extensions/parser/src/alerts.ts
  - extensions/parser/src/walk.ts
---

# Obsidian vault as content

An Obsidian vault is a folder of Markdown files, which is exactly what a [content collection](/docs/framework/site/content-collections) reads. This guide publishes one as a website directly from the folder: no copy step, no export script, and the vault stays the place you write.

It uses the conventions of a real knowledge base as the example: Avunu's development notes, where each note marked for publication becomes a page of its public knowledge base and the rest stay private. The same setup fits any vault that has some pages to publish and some to keep private.

## The vault

The layout that makes this easy is one folder per topic, each with a `README.md` that indexes it:

```text
README.md
STYLE.md
.obsidian/
Frappe/
  README.md
  Bench Operations.md
  Custom Pages.md
Git & Dev Tools/
  README.md
  Git Cheatsheet.md
WordPress/
  README.md
  Gravity Forms/
    README.md
    Submission Overlay Spinner.md
internal/
  Company/
  Drafts/
Sites/
  website/
    project.json
    pages/
```

File names are Title Case with spaces, because that is how a person names a note. The website project lives inside the same repository (`Sites/website`), which is why its content source will be `../..`.

Every document starts with the same frontmatter:

```yaml
---
title: Bench Operations
description: Backup and restore, switching branches, and schema repair for a Frappe bench.
slug: bench-operations
category: Frappe
tags: [frappe, bench]
created: 2024-08-26
updated: 2026-10-01
status: review
publish: true
---
```

The body has no H1, because the title comes from frontmatter. Callouts use GitHub's alert notation, links between notes are relative with `%20` for spaces, and every code fence names its language:

````markdown
Run these from the bench directory. Swap setup is in [Swap Configuration](../Linux/Swap%20Configuration.md).

> [!WARNING]
> Take a backup first. Restoring replaces the site.

```bash
bench --site <SITE_NAME> backup
```
````

## Wire up the content type

Enable the parser and search extensions, then describe the collection in `Sites/website/project.json`:

```json
{
  "extensions": ["@jxsuite/parser", "@jxsuite/search"],
  "content": {
    "kb": {
      "source": "../..",
      "format": "Markdown",
      "exclude": [
        "internal/**",
        "Sites/**",
        "STYLE.md",
        "README.md",
        ".*/**",
        "**/node_modules/**"
      ],
      "where": { "publish": true, "status": { "$ne": "draft" } },
      "route": "/kb/{category:slug}/{slug}/",
      "indexRoute": "/kb/{dir:slug}/",
      "schema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "description": { "type": "string" },
          "slug": { "type": "string" },
          "category": { "type": "string" },
          "tags": { "type": "array", "items": { "type": "string" } },
          "created": { "type": "string", "format": "date" },
          "updated": { "type": "string", "format": "date" },
          "publish": { "type": "boolean" },
          "status": { "type": "string" }
        },
        "required": ["title", "description", "slug", "category"]
      }
    }
  },
  "search": { "collections": { "kb": { "basePath": "/kb/" } } }
}
```

These options do the work that would otherwise need a script:

- `exclude` keeps whole folders and single files out. The private `internal/` notes, the website project itself, the style guide, the vault's root README and Obsidian's own `.obsidian` folder are never read, so none of them can be validated, routed, linked or searched.
- `where` publishes only documents with `publish: true` that are not drafts. A note without those keys is out, which is the safe default for a vault.
- `route` gives each document its URL from its own frontmatter. `{category:slug}` turns `Git & Dev Tools` into `git-and-dev-tools`, and `indexRoute` sends each folder's `README.md` to the folder's own page.
- `schema` still validates what is published, and only that.

## One page serves the whole collection

Add `pages/kb/[...path].json`. It names no parameter, because the route decides every URL:

```json
{
  "$layout": "./layouts/docs.json",
  "$paths": { "contentType": "kb" },
  "title": "${state.page.data.title}",
  "state": {
    "page": { "$prototype": "ContentEntry", "contentType": "kb" }
  },
  "children": [
    {
      "tagName": "article",
      "style": {
        "& .jx-alert": {
          "margin": "1.5rem 0",
          "padding": "0.75rem 1rem",
          "borderLeft": "3px solid currentColor"
        },
        "& .jx-alert-title": { "margin": "0 0 0.25rem", "fontWeight": "600" }
      },
      "children": "${state.page.$children ?? []}"
    }
  ]
}
```

The compiler hands the page's URL pattern (`/kb/*`) to the collection, which returns one set of parameters per routed entry. The same `$paths` would serve `pages/kb/[category]/[slug].json` and `pages/kb/[category].json` as separate article and section pages. The `ContentEntry` with no `id` binds to the entry whose route is this page's own URL.

A listing page, such as a section's index, links to entries with the URL the loader worked out:

```json
{
  "state": {
    "docs": { "$prototype": "ContentCollection", "contentType": "kb", "sort": { "field": "title" } }
  },
  "tagName": "ul",
  "children": {
    "$prototype": "Array",
    "of": { "$ref": "#/state/docs" },
    "map": {
      "tagName": "li",
      "children": [
        {
          "tagName": "a",
          "attributes": { "href": "${item._meta.url}" },
          "textContent": "${item.data.title}"
        }
      ]
    }
  }
}
```

## What happens to each file

| File                                    | Result                                            |
| --------------------------------------- | ------------------------------------------------- |
| `Frappe/Bench Operations.md`, published | page at `/kb/frappe/bench-operations/`            |
| `Frappe/README.md`                      | the section page at `/kb/frappe/`                 |
| `WordPress/Gravity Forms/README.md`     | `/kb/wordpress/gravity-forms/`                    |
| a note with `status: draft`             | left out by `where`, with no route and no warning |
| a note with `publish: false`            | left out by `where`                               |
| anything under `internal/` or `Sites/`  | never read, even if it says `publish: true`       |
| `STYLE.md`, the root `README.md`        | never read                                        |
| `.obsidian/`                            | never read, and never even listed                 |

The folders are not part of the URL. The category comes from frontmatter, so moving a note between folders does not change its address unless you also change `category`.

## Callouts

`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]` and `> [!CAUTION]` render as accessible callouts: a `div` with `role="note"`, a visible title, and `jx-alert-*` classes for your stylesheet. A title after the marker, as in `> [!TIP] Faster restores`, replaces the default one, and callouts work inside list items.

If your site already has callout components, map the types onto them with `"alerts": { "NOTE": "doc-note", "TIP": "doc-tip", "WARNING": "doc-warning" }` in the content type. See [Callouts](/docs/framework/site/jx-markdown#callouts) for the details.

## Links between notes

The links you write for Obsidian work as written. `[Swap](../Linux/Swap%20Configuration.md#Create%20a%20Swap%20File)` becomes `/kb/linux/swap-configuration/#create-a-swap-file`, and `[the folder](../Frappe/)` becomes `/kb/frappe/`.

A link to a note that is not published is shown as plain text and the build says so:

```text
Content links: "kb": "Frappe/Bench Operations.md" links to "Draft%20Recipe.md", which is not published (left out by where.status); it renders as plain text.
Content links: "kb": "Frappe/Bench Operations.md" links to "../internal/Plan.md", which is not published (excluded by "internal/**"); it renders as plain text.
```

That is the right default while you write, because an unpublished note should not break the build. For a deploy, add `"links": "error"` (or set it from CI) and every broken link fails the build, listed together.

## Code

Fences are highlighted at build time with light and dark colors. Besides the web languages, the set covers what a notes vault tends to contain: `sql`, `php`, `python`, `ruby`, `nix`, `nginx`, `caddyfile`, `toml`, `ini`, `diff`, `xml` and `dockerfile`. A fence with no language, or `text`, stays plain. Braces in code are left alone: `{{ doc.name }}`, `${first}` and `${{ secrets.TOKEN }}` come out exactly as written, because a Markdown body is never evaluated as a template.

## Check the build

Run `jx build` and read three things:

- The warnings. Every `Content links`, `Content routes` and `Content ids` line names the file involved. Two notes with the same category and slug are reported with both file names, and only the first is routed.
- `dist/kb/`. The folders there are exactly the published set.
- `dist/search-index.json`. It lists the same pages, at the same URLs.

:::doc-note
A vault of Markdown can contain text that looks like something else. Jx never evaluates a code fence, and `where` and `exclude` take no code, only data, so nothing in a note is executed by the build.
:::

## What is not supported

- Obsidian wikilinks (`[[Note]]`) and embeds (`![[Note]]`) are plain text to the parser. Turn off **Use [[Wikilinks]]** in the vault's Files and Links settings so links are written as Markdown links.
- A foldable callout (`> [!NOTE]-`) is shown open. Plugin syntax such as Dataview blocks is not interpreted.
- Studio's canvas shows callouts and relative links as written, because it opens a file through the component parser. The built site and build previews show them rendered.
- A link whose file name differs from the real one only by case resolves when exactly one file matches, so a vault written on a case-insensitive filesystem still publishes from a Linux CI runner. Two files that differ only by case make such a link ambiguous and it is reported.

## Related

- [Content collections](/docs/framework/site/content-collections): every content type option, including `exclude`, `where`, `idField` and `route`
- [Jx Markdown](/docs/framework/site/jx-markdown): callouts and code highlighting
- [Site search](/docs/framework/site/search): the index a published vault feeds
- [Routing](/docs/framework/site/routing): how `$paths` generates a page per entry
