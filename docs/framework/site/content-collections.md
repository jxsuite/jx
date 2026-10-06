---
title: "Content collections"
description: "The content section of project.json: sources, formats, entry ids, ContentCollection queries, ContentEntry lookups, and schema validation."
spec:
  - site-architecture.md#6
  - site-architecture.md#9.3
  - parser.md#3.2
  - parser.md#9.2
  - parser.md#9.4
  - parser.md#9.5
  - parser.md#9.6
code:
  - extensions/parser/src/content-loader.ts
  - extensions/parser/src/content.ts
  - extensions/parser/src/content-rules.ts
  - extensions/parser/src/content-routes.ts
  - extensions/parser/src/content-links.ts
  - extensions/parser/src/walk.ts
  - extensions/parser/src/md.ts
---

# Content collections

> **Studio writes this format for you.** The [content-type builder](/docs/studio/projects/content-types) edits the `content` section visually, and entries show up in [The Library](/docs/studio/projects/browse) with schema-driven forms.
>
> It also enforces the collection's format where you create files: **New File…** in a collection's folder is **New Entry**, and in a subfolder of it the format picker is locked to the collection's extension. See [Creating a file](/docs/studio/interface#creating-a-file).

Content collections are the data layer for content-driven sites: they turn folders of Markdown, JSON, or CSV files into typed, queryable data with JSON Schema validation. Each collection is a **content type**, declared in the `content` section of `project.json`.

Formats other than JSON come from extension packages, so a site using Markdown or CSV content enables the parser in `project.json`: `"extensions": ["@jxsuite/parser"]`.

## Defining a content type

```json
{
  "content": {
    "blog": {
      "source": "./content/blog/",
      "format": "Markdown",
      "schema": {
        "type": "object",
        "properties": { "title": { "type": "string" }, "pubDate": { "type": "string" } },
        "required": ["title", "pubDate"]
      }
    }
  }
}
```

Each definition takes these keys, and only `source` is usually needed:

- **`source`**: a directory of entry files, a single file containing many entries (one CSV or JSON file), or an `https://` URL. jxsuite.com's `docs` type points outside the project entirely (`"source": "../../docs"`) to publish this documentation from the repo.
- **`format`**: the name of a format class provided by an enabled extension (`"Markdown"`, `"Csv"`); `"json"` is the only built-in. When omitted, the format is derived from the source file's extension; directory and remote sources require an explicit `format`, and remote sources need a format that supports remote loading (such as `Csv`).
- **`$elements`**: components available inside entries as directives, e.g. jxsuite.com registers `doc-note` and `doc-tip` for these docs. See [Jx Markdown](/docs/framework/site/jx-markdown).
- **`schema`**: a JSON Schema every entry's data must satisfy.
- **`exclude`** and **`where`**: which files are entries at all. See [Choosing which files are entries](#choosing-which-files-are-entries).
- **`idField`**, **`route`** and **`indexRoute`**: what each entry is called and where it lives. See [Ids and routes](#ids-and-routes).
- **`links`**: how a relative link to an entry with no page is reported. See [Links between entries](#links-between-entries).
- **`alerts`**: which component renders a `> [!NOTE]` callout. See [Callouts](/docs/framework/site/jx-markdown#callouts).

## Entry ids

Every entry has an `id`, derived from the filesystem:

- **Flat directories**: the filename without extension: `content/blog/hello-world.md` → `hello-world`.
- **Nested directories**: a path-based id with `/` separators: `docs/framework/site/routing.md` → `framework/site/routing`, with a trailing `/index` or `/README` stripped, so `docs/studio/README.md` is `studio`. A `README.md` directly in the source folder keeps the id `README`. Path-based ids pair naturally with `[...param]` catch-all routes. See [Routing](/docs/framework/site/routing).
- **JSON files**: an array file yields one entry per item (each item's `id` field, or an indexed fallback); an object file is a single entry named after the file.

Ids keep the case and spaces of the file name exactly as written: `Linux/Swap Configuration.md` is the id `Linux/Swap Configuration`. They are stable for as long as the file keeps its name and place. They are also not pretty URLs, which is why a collection that publishes files named for people sets an `idField` or a `route` (below) rather than renaming files.

## Choosing which files are entries

By default every file under the source is an entry. Two options narrow that, and both are plain data: a `project.json` is read by Studio, the dev server and CI, so a filter that ran code would make each of them run your project's text.

```json
{
  "content": {
    "kb": {
      "source": "../..",
      "format": "Markdown",
      "exclude": ["internal/**", "Sites/**", "STYLE.md", ".*/**", "**/node_modules/**"],
      "where": { "publish": true, "status": { "$ne": "draft" } }
    }
  }
}
```

**`exclude`** is a list of glob patterns, relative to the source folder, for files that are never read.

| Pattern              | Excludes                                          |
| -------------------- | ------------------------------------------------- |
| `STYLE.md`           | that file at the source root only                 |
| `**/README.md`       | every `README.md`, at any depth                   |
| `internal/**`        | everything below `internal/`, however deep        |
| `drafts/`            | the same as `drafts/**`                           |
| `.*/**`              | every dot folder at the root, such as `.obsidian` |
| `**/node_modules/**` | a `node_modules` folder anywhere                  |
| `{notes,scratch}/**` | either folder                                     |

`*` and `?` stop at a slash, `**` crosses folders, and a dotfile is an ordinary file, so a pattern that should skip `.obsidian` says so. A folder that a pattern excludes whole is never opened, which keeps a vault that sits next to a website's `node_modules` quick to build. Patterns cannot be negated (`!keep.md` is an error).

**`where`** keeps only the entries whose frontmatter passes. Every key is a frontmatter field, keys combine with AND, and a value is either a literal to equal or an operator object.

| Operator                          | Keeps an entry when the field                                      |
| --------------------------------- | ------------------------------------------------------------------ |
| `true`, `"review"`, `3`           | equals that value exactly (`"true"` is not `true`)                 |
| `{ "$ne": "draft" }`              | is anything else, or absent                                        |
| `{ "$in": ["review", "stable"] }` | is one of the values                                               |
| `{ "$nin": ["draft"] }`           | is none of them, or absent                                         |
| `{ "$exists": true }`             | is set (an empty YAML key counts as not set)                       |
| `{ "$gte": "2026-01-01" }`        | is at or after a date, number or string (`$gt`, `$lt`, `$lte` too) |

A plain value also matches an array that contains it, so `{ "tags": "frappe" }` keeps every entry tagged `frappe`. A dotted key such as `meta.public` reaches into nested data. There is no OR: a site that needs "either" declares two content types. An operator the filter does not know is a build error that names the key, and so is a malformed pattern, so a typo never quietly publishes everything or nothing.

An entry that fails `where`, and a file that matches `exclude`, are gone for every consumer at once: they are not validated, so their missing frontmatter never warns, and they never appear in `ContentCollection` or `ContentEntry` results, `$paths` expansion, the sitemap, the [search index](/docs/framework/site/search), a [feed](/docs/framework/site/feeds), or a [relationship](/docs/framework/site/relationships). Files are read in sorted order (by name, folder by folder), so a collection loads in the same order on every machine.

## Ids and routes

Two more options say what an entry is called and where it lives.

**`idField`** takes a frontmatter field name and uses its value as the id: `"idField": "slug"` makes `slug: bench-operations` the id of that entry. An entry without the field keeps its path id and a warning says so. Two entries with the same id are reported with both file names, because a lookup by id finds only the first.

**`route`** is a template for the entry's URL (`indexRoute`, below, is its counterpart for a folder's README). It is the one place that URL is decided, and the pages `$paths` generates, the links between entries, the sitemap, the search index and feeds all read it.

```json
"route": "/kb/{category:slug}/{slug}/"
```

| Placeholder                    | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| `{id}`                         | the entry id                                                  |
| `{dir}`                        | the file's folder, relative to the source (empty at the root) |
| `{file}`                       | the file name without its extension                           |
| `{category}`, `{meta.section}` | a frontmatter field (dotted paths reach into nested data)     |

A transform follows a colon and they chain: `{category:slug}`, `{title:lower}`. `slug` lowercases, folds accents, reads `&` as "and" (so `Git & Dev Tools` becomes `git-and-dev-tools`), drops apostrophes, turns other punctuation into single hyphens, and keeps letters of every script. `lower`, `upper` and `raw` (no change) are the others. A value that cannot be turned into a path segment, such as a missing field, leaves the entry without a route and a warning names the file; so does an entry whose route another entry already holds, and the first one wins. Whether the built URL ends in a slash follows `build.trailingSlash`, whatever the template ends with.

A folder's `README.md` or `index.md` stands for the folder, and `indexRoute` says where it goes:

```json
"route": "/kb/{category:slug}/{slug}/",
"indexRoute": "/kb/{dir:slug}/"
```

With that, `Frappe/README.md` is the section page `/kb/frappe/`, and `WordPress/Gravity Forms/README.md` is `/kb/wordpress/gravity-forms/`. Without `indexRoute`, a README is routed like any other entry.

With a `route`, a dynamic page needs no parameter name. The compiler hands the page's own URL pattern to the content type, so one `$paths` serves whichever page shape you choose:

```json
{
  "$paths": { "contentType": "kb" },
  "state": { "page": { "$prototype": "ContentEntry", "contentType": "kb" } }
}
```

That page can be `pages/kb/[...path].json`, which serves every route under `/kb/`, or `pages/kb/[category]/[slug].json` plus `pages/kb/[category].json` for articles and section pages. A `ContentEntry` with no `id` is bound to the entry whose route is the page's own URL. Name `param` or `field` in `$paths` and you get the older meaning instead: one parameter, valued by the id or that field.

Each entry also carries what the loader worked out: `_meta.path` is its file relative to the source, and, when there is a route, `_meta.route` and `_meta.url` are its path and its link target (`/kb/frappe/bench-operations/`). A listing page links to an entry with `${item._meta.url}`.

## Links between entries

A document written for an editor links to its neighbours by file: `[Swap](../Linux/Swap%20Configuration.md)`. On the built site that has to be the neighbour's URL, so a content type with a `route` rewrites those links once the whole collection has loaded.

- The path is resolved from the entry's own folder, with `%20` and other escapes decoded and `..` followed, and it never leaves the source folder: a link that climbs out of it is not rewritten and is reported.
- A link to a folder (`../Frappe/`) goes to that folder's `README.md` or `index.md`.
- A `?query` is kept, and a `#fragment` becomes the heading id the page carries, so `Note.md#Heading%20Text` (Obsidian's spelling) and `#heading-text` both land on the heading. A `#Heading%20Text` link within the same page is fixed the same way.
- External links, `mailto:` and `tel:` links, absolute paths and links to anything that is not an entry, such as an image or a PDF, are left exactly as written.
- A link to an entry that is excluded, filtered out, has no route, or does not exist is shown as plain text, so the site never publishes a dead link, and the build names the file and the target.

```text
Content links: "kb": "Frappe/Bench Operations.md" links to "Draft%20Recipe.md", which is not published (left out by where.status); it renders as plain text.
```

The `links` option sets how loud that is: `"warn"` (the default) prints each one, `"error"` fails the build with every broken link in one message, and `"ignore"` says nothing. The link is text in all three. Links are only rewritten when the type declares a `route`, so a collection without one behaves as it always did. [Obsidian vault as content](/docs/framework/site/obsidian-vault) walks through all of this on a real vault.

## Media beside your content

Entries reference images the way any markdown editor expects, relative to the file itself:

```markdown
![A diagram of the pipeline](./images/diagram.png)
```

Keep the images in the collection directory (`content/blog/images/diagram.png`), and the entry reads correctly in VS Code, Obsidian, GitHub, and on the built site alike. When the collection loads, that reference is remapped to the collection's own URL, `/content/blog/images/diagram.png`, which the build copies into `dist/` and the dev server serves straight from the source file. It works even when the source lives outside the project, which is how these docs ship their screenshots from `docs/images/`.

Only files an entry actually references are published; unreferenced siblings and the entry files themselves never reach `dist/`.

:::doc-note
Remapping applies to element `src`/`poster` values and to frontmatter fields your schema declares as `"format": "uri-reference"` (that's also what gives Studio a [media picker](/docs/studio/projects/media) for the field). A path that doesn't resolve to a real file beside the entry is left exactly as written, with a build warning naming the entry, so root-relative paths into `public/` keep working unchanged.
:::

## Querying with ContentCollection

Pages read a collection through a `state` entry with `$prototype: "ContentCollection"`:

```json
{
  "state": {
    "posts": {
      "$prototype": "ContentCollection",
      "contentType": "blog",
      "filter": { "draft": false },
      "sort": { "field": "pubDate", "order": "desc" },
      "limit": 10
    }
  }
}
```

- **`filter`**: either a shorthand object (each key must equal its value, as above) or an array of rules: `{ "field": "tags", "op": "contains", "value": "intro" }`. Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `not contains`, `empty`, `not empty`. Use `"field": "id"` to match the entry id.
- **`sort`**: a rule or array of rules, `{ "field": "pubDate", "order": "desc" }`; `asc` is the default.
- **`limit`**: maximum number of entries.

The result is an array of entries, rendered with a [repeater](/docs/framework/concepts/lists):

```json
{
  "tagName": "ul",
  "children": {
    "$prototype": "Array",
    "of": { "$ref": "#/state/posts" },
    "map": { "tagName": "li", "textContent": "${item.data.title}" }
  }
}
```

## Single entries with ContentEntry

`$prototype: "ContentEntry"` fetches one entry by id, usually bound to a route parameter:

```json
{
  "state": {
    "post": {
      "$prototype": "ContentEntry",
      "contentType": "blog",
      "id": { "$ref": "#/$params/slug" }
    }
  }
}
```

By default `id` matches the entry id; set `"field"` to match a data field instead (e.g. `"field": "sku"` to look up a product by SKU).

A resolved entry has this shape:

```json
{
  "id": "hello-world",
  "data": { "title": "Hello World", "pubDate": "2024-01-15" },
  "body": "# Hello\n\nThis is my first post.",
  "$children": [{ "tagName": "h1", "textContent": "Hello" }]
}
```

Frontmatter and data fields live under `data` (`${state.post.data.title}`); for Markdown entries, `body` is the raw source and `$children` is the parsed Jx tree, rendered with `"children": "${state.post.$children ?? []}"`.

Markdown headings in `$children` carry automatic anchor `id`s: the heading text lowercased, punctuation stripped, spaces hyphenated, with `-2`, `-3` suffixes deduplicating repeats in document order. The entry's table of contents (`_meta.toc`: `depth`, `text`, `id` per heading) uses the same ids, so TOC links, search results, and hand-written `#fragment` URLs all land on the rendered section.

Two details of that are worth knowing if you write in anything but English. **Letters outside ASCII are kept**, so a Japanese or Russian heading gets an anchor made of its own words rather than an empty one falling back to `section`. And an accented heading gets **one** anchor whichever way it was typed: `é` can be a single character or an `e` with a combining accent, they look identical and used to produce two different links, so the text is normalized before the id is built. Anchors for plain-ASCII headings are unchanged, so existing links still work.

`_meta.wordCount` and `_meta.readingTime` count **words as the language defines them**, not runs of text between spaces. A Japanese or Thai article has no spaces between its words and used to count as one word, and therefore as one minute to read however long it was. Reading time is word count at 200 words per minute; that rate is a single honest constant rather than a per-language table, so treat it as an estimate for prose in any script.

Fenced code blocks in `$children` arrive syntax-highlighted: recognized languages become token spans carrying `--shiki-light`/`--shiki-dark` color variables that follow the site's [color scheme](/docs/framework/concepts/color-schemes). See [Jx Markdown](/docs/framework/site/jx-markdown) for the language set.

## Schema validation

Every entry is validated against its content type's `schema` when collections load, at build time and on the dev server alike. Missing required fields and type mismatches are reported with the content type and entry id, so a bad frontmatter key fails loudly instead of rendering an empty spot. The same schema drives Studio's [frontmatter forms](/docs/studio/editing/frontmatter) and the content-type builder's field editor.

## Dates

Declare a date field with `format`, and the loader normalizes it so sorting and filtering work:

```json
{
  "properties": {
    "pubDate": { "type": "string", "format": "date" },
    "updated": { "type": "string", "format": "date-time" }
  }
}
```

| `format`      | Stored as                          |
| ------------- | ---------------------------------- |
| `"date"`      | `2025-03-04`                       |
| `"date-time"` | `2025-03-04T16:00:00Z`, always UTC |

Date-times are converted to UTC because otherwise they don't sort: `2025-03-04T01:00:00+02:00` looks _later_ than `2025-03-04T00:00:00Z` as text and is actually two hours _earlier_. If you need the original offset back, as an events collection meaning "7pm local" would, it's kept at `_meta.rawDates`.

You can write a `Date` from YAML, a full RFC 3339 timestamp, or a bare `YYYY-MM-DD`. Anything else is left exactly as you wrote it and reported as a warning naming the entry and field:

```text
Content dates: "blog/my-post" field "pubDate" is "03/04/2025", which is not an
unambiguous date. Write it as YYYY-MM-DD — a form like "03/04/2025" means two
different days depending on who reads it, so it is left as authored rather than guessed.
```

:::doc-note
Without a `format`, a date is just a string. `MarkdownCollection`'s default sort compares text, which works for `YYYY-MM-DD` and not for timestamps with offsets. Declare the field in a content type and the loader handles it.
:::

## Relationships

A schema field can reference another content type:

```json
{ "author": { "$ref": "#/content/authors" } }
```

An entry then stores the target's id (`author: jane-doe` in frontmatter), and loading resolves it to the full entry, so templates read `${state.post.data.author.data.name}`. Array fields whose `items` carry the `$ref` are to-many. Resolution rules, editing support, and modeling patterns are covered in [Relationships](/docs/framework/site/relationships).

## Related

- [Obsidian vault as content](/docs/framework/site/obsidian-vault): publishing a folder of notes as it is
- [Routing](/docs/framework/site/routing): generating one page per entry with `$paths`
- [Jx Markdown](/docs/framework/site/jx-markdown): the entry format for prose content
- [project.json](/docs/framework/site/project-json): where the `content` section lives
