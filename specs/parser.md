# `@jxsuite/parser` Specification

## Content Formats and the Reference Format-Extension Classes

**Version:** 0.2.11-draft\
**Status:** Partial\
**Updated:** 2026-09-29\
**License:** MIT

---

## 1. Overview

`@jxsuite/parser` provides the content layer for Jx applications — and is the **reference implementation of the Jx format-extension contract** (see `specs/extensions.md`). It exports format classes (`Markdown`, `Csv`) and content-query classes (`MarkdownCollection`, `ContentCollection`, `ContentEntry`) that satisfy the Jx `$prototype` + `$src` external class contract and the format capability contract.

The compiler, dev server, and studio contain no markdown or CSV knowledge: every capability they need is declared in this package's `.class.json` files and dispatched through the format registry. A third-party package shipping the same shape of class is indistinguishable from this one.

Built on the `unified` / `remark` pipeline (markdown) and a minimal RFC 4180 parser (CSV).

---

## 2. Exports

| Export                            | Type           | Description                                                                       |
| --------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `.` (`md.ts`)                     | Module         | Node entry: `Markdown` (re-export), `MarkdownCollection`, transpiler re-exports   |
| `./markdown`                      | Module         | Browser-safe `Markdown` format class (node-only capabilities dynamic-import `fs`) |
| `./csv`                           | Module         | `Csv` format class + `parseCSV` / `coerceCSVRows`                                 |
| `./serialize`                     | Module         | `serializeJxMarkdown` (roundtrip/export), `jxToMdast`, `mdastToJx`, element sets  |
| `./transpile`                     | Module         | `transpileJxMarkdown`, `mdastNodeToJx`, dot-path utilities (browser-safe)         |
| `./content`                       | Module         | `ContentCollection`, `ContentEntry` query classes                                 |
| `./html-to-jx`                    | Module         | `htmlToJx` — HTML string → Jx element tree                                        |
| `./Markdown.class.json`           | Format class   | Markdown format declaration (parse/serialize/discover/load + `$studio`)           |
| `./Csv.class.json`                | Format class   | CSV format declaration (parse/discover/load, `remote: true`)                      |
| `./MarkdownCollection.class.json` | External class | Glob collection of markdown files (runtime `resolve`)                             |
| `./ContentCollection.class.json`  | External class | Query a project content type                                                      |
| `./ContentEntry.class.json`       | External class | Fetch a single content entry                                                      |

---

## 3. `Markdown` — the markdown format class

> **Status: Partial.** The class and every capability ship, and `$wordCount`/`$readingTime` segment words with `Intl.Segmenter` (`extensions/parser/src/md.ts`). Heading anchors are still wrong for scripts written with combining marks: `slugifyHeading` (`extensions/parser/src/transpile.ts`) keeps only letters, numbers, `_`, whitespace and `-`, so the Unicode mark category (`\p{M}`) is stripped as if it were punctuation. Devanagari, Bengali, Tamil and Thai vowel signs and viramas, and Arabic or Hebrew points, disappear from the slug, which then spells a different word than the heading: `नमस्ते दुनिया` slugifies to `नमसत-दनय`. The anchors stay unique and still agree with `$toc`.

A single class carrying every capability (`Markdown.class.json`):

```json
"format": {
  "extensions": [".md"],
  "mediaType": "text/markdown; variant=GFM",
  "documentKinds": ["page", "component", "content"],
  "exportTarget": true
}
```

**The `variant` is load-bearing.** `text/markdown` names a family, not a syntax (RFC 7763 §2); the `variant` parameter RFC 7764 registers is the only thing on the wire that says which dialect a `.md` file is written in, and Jx's is GFM. Two places must agree about that and cannot import each other — this class, which the format registry dispatches through, and the static file servers, which have no registry to consult and answer from an extension table (`MEDIA_TYPE_BY_EXTENSION` in `@jxsuite/schema/media-type`). A drift test joins them.

The same table is where YAML's media type lives. Frontmatter is YAML, and so is any `.yaml` an author drops in `public/` — served as `application/yaml` (RFC 9512 §4), never as the `text/yaml` spelling §5 asks implementations to retire and that most platform lookup tables, Bun's included, still answer with. Anything absent from that table keeps the host's own answer: it exists to correct a lookup, not to become a second MIME table.

| Capability  | Scope    | Timing                   | Behavior                                                                                                                                                                                                    |
| ----------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`     | static   | compiler, server, client | `transpileJxMarkdown(source)` → Jx JSON document (frontmatter → top-level keys, body → children)                                                                                                            |
| `serialize` | static   | compiler, server, client | `serializeJxMarkdown(doc, options)` — see §5                                                                                                                                                                |
| `discover`  | static   | compiler, server         | List `.md` entry files for a content-type source (file or directory), in sorted order, leaving out what `exclude` names (§9.4)                                                                              |
| `load`      | static   | compiler, server         | One file → `ContentLoaderEntry[]` (frontmatter as `data`, raw source as `body`, `$children` with deduplicated heading `id`s and callouts rendered per §3.3, `_meta` with excerpt/toc/readingTime/wordCount) |
| `resolve`   | instance | runtime                  | `{ "$prototype": "Markdown", "src": "./post.md" }` → `MarkdownFileResult`                                                                                                                                   |

`$studio` declares the full editing control surface: editor modes, `documentMode` (content by default; component when frontmatter `tagName` matches `.+-.+`), `newFileTemplate`, and the element allowlist + nesting constraints that gate structural editing. The element sets are asserted in tests to match `MD_ELEMENTS` in `serialize.ts` (the source of truth).

### 3.1 Jx Usage (runtime)

```json
{
  "state": {
    "post": {
      "$prototype": "Markdown",
      "$src": "@jxsuite/parser/Markdown.class.json",
      "src": "./content/posts/hello-world.md"
    }
  }
}
```

### 3.2 `MarkdownFileResult`

| Property       | Type     | Description                                 |
| -------------- | -------- | ------------------------------------------- |
| `slug`         | `string` | Filename without extension                  |
| `path`         | `string` | Full file path                              |
| `frontmatter`  | `object` | Parsed YAML frontmatter                     |
| `$children`    | `array`  | Jx node tree (MDAST → Jx, no HTML pass)     |
| `$excerpt`     | `string` | First paragraph as plain text               |
| `$toc`         | `array`  | Table of contents (heading id, text, depth) |
| `$readingTime` | `number` | Estimated reading time in minutes           |
| `$wordCount`   | `number` | Word count                                  |

**Heading anchors.** `processMarkdown` assigns every `h1`–`h6` in `$children` a slug `id` (`slugifyHeading` in `transpile.ts`: lowercase, punctuation stripped, spaces → hyphens) with document-order deduplication — the first occurrence is unsuffixed, repeats get `-2`, `-3`, …. `$toc` entries are built from the same walk (`assignHeadingIds`), so rendered anchors and `$toc[i].id` always agree; pre-existing ids are respected and still claim their slug. Rendered pages are therefore deep-linkable to sections (`/docs/<slug>/#<heading-id>`), which site search and TOC UIs rely on. `transpileJxMarkdown` (the component path) is unaffected.

### 3.3 Callouts (GitHub alerts)

A blockquote whose first line is `[!TYPE]` is a callout, not a quotation. `processMarkdown` rewrites it before conversion, so the content loader, `MarkdownCollection` and the runtime `Markdown` class all agree; `transpileJxMarkdown`, the path Studio parses a file through, never does, because a converted callout would round-trip back to the file as a directive and silently rewrite what the author wrote.

| Part          | Rule                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types         | `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`, matched case-insensitively; a type beyond them is a callout only when the content type's `alerts` option names it                                                                         |
| Title         | The text after the marker on its own line, with its inline formatting (`> [!NOTE] A **bold** title`), is the title. This is Obsidian's form; GitHub itself shows such a quotation as plain text. With no text, the title is the type's name |
| Fold markers  | `[!NOTE]+` and `[!NOTE]-` are accepted and ignored: the callout is always shown                                                                                                                                                             |
| Nesting       | Found at any depth: in list items, in ordinary blockquotes, in other callouts                                                                                                                                                               |
| Not a callout | A marker that is not the first thing in the first paragraph, one followed directly by text (`[!NOTE]x`), and an unknown type. These stay blockquotes with their text intact                                                                 |

The content type's `alerts` option maps an alert type to the element that renders it, or turns recognition off:

```json
"alerts": { "NOTE": "doc-note", "TIP": "doc-tip", "WARNING": "doc-warning", "INFO": true, "CAUTION": null }
```

- **A tag name** renders `{ "tagName": "doc-note", "attributes": { "data-alert": "note" }, "children": [body] }`, exactly what the `:::doc-note` directive produces, so a project's existing callout components serve both notations. An author's title arrives as `data-title` (plain text); the component decides whether to show it.
- **`true`** renders the type with the built-in markup, which is how a type beyond GitHub's five is switched on.
- **`null` or `false`** leaves that type as an ordinary blockquote. To turn every callout off, map each of the five types to `false`.
- **A type with no mapping** renders the built-in markup: `<div role="note" class="jx-alert jx-alert-note" data-alert="note">` whose first child is `<p class="jx-alert-title">Note</p>`, followed by the body. The title is a paragraph and not a heading, so a callout never enters `$toc` or the search index's section list. The classes are the stylesheet's hooks; the built-in markup carries no styles of its own.

An invalid `alerts` value (a non-object, a non-tag name) fails the build naming the content type. The raw `body` is never rewritten. `$excerpt` and `$wordCount` read the callout's own text, not its marker.

### 3.4 Syntax highlighting

Fenced code in `$children` is tokenized at build time by a synchronous Shiki core on the JavaScript regex engine, against a light and a dark GitHub theme, and each token is a `span` carrying `--shiki-light` and `--shiki-dark`. The grammar set is fixed: `json`, `jsonc`, `typescript`, `javascript`, `markdown`, `html`, `shellscript`, `css`, `yaml`, `sql`, `php`, `python`, `ruby`, `nix`, `nginx`, `caddyfile`, `toml`, `ini`, `diff`, `xml` and `dockerfile`, with Shiki's own aliases (`bash`, `sh`, `ts`, `js`, `py`, `rb`, `yml`, `md`, `docker`). `caddyfile` is a small grammar shipped with the parser, because Shiki has none. A language outside the set stays plain text and never fails the build. The additions were chosen by reading every fence in a real operations knowledge base, an Obsidian vault of server, database and framework notes, and `tests/highlight.test.ts` tokenizes a sample of each.

### 3.5 Text that looks like a template

Jx reads any string containing `${` as a template and evaluates it, at build time and again in the browser (spec.md §21.1). That is right for a document an author wrote and wrong for content: a JavaScript template literal, a shell `${HOME}` or a GitHub Actions `${{ secrets.TOKEN }}` in a fence is text to show. Before this rule a highlighted fence containing `${` had its tokens turned into reactive bindings whose value was whatever the page's state said, usually nothing, so the sample silently lost the code it was there to show.

`processMarkdown` therefore makes template-looking text in `$children` inert, as its last step. spec.md §21.1 tells a producer of content to escape `${` first, and the compiler's idiom for that is `&#36;{` in `innerHTML` (its own `innerHTML` resolution writes the same), so that is the form used:

- a node whose `textContent` contains `${` carries the same text as HTML-escaped `innerHTML` instead (`&`, `<` and `>` escaped, `${` written `&#36;{`), which covers fenced and inline code, headings, paragraphs, list items and table cells;
- a bare string child that contains `${` becomes a `span` with that `innerHTML`;
- text without `${` is untouched, and so is every attribute value, because an entity cannot be written into one (a `${` in a link's `href` is still read as a template).

It runs after heading ids and `$toc` are built from the text, so they are unchanged, and the raw `body`, `$excerpt` and `_meta` are never touched. A consumer that extracts the words of a tree reads `innerHTML` as well as `textContent`: `@jxsuite/search` does.

---

## 4. `Csv` — the CSV format class

`Csv.class.json` declares `format: { extensions: [".csv"], documentKinds: ["content"], remote: true }`.

| Capability | Scope    | Timing                   | Behavior                                                            |
| ---------- | -------- | ------------------------ | ------------------------------------------------------------------- |
| `parse`    | static   | compiler, server, client | RFC 4180 parse + schema-driven coercion (pure)                      |
| `discover` | static   | compiler, server         | List `.csv` entry files                                             |
| `load`     | static   | compiler, server         | Read file **or fetch http(s) URL** → coerced `ContentLoaderEntry[]` |
| `resolve`  | instance | runtime                  | Load the configured `src` (file or remote)                          |

Coercion per the content-type schema: `number` strips currency symbols/commas (`null` for empty/invalid), `boolean` is `"true"` only, `array` is comma-split/trimmed. **Dates are not coerced here** — a `format: "date"` field is handled once for every format by the content loader (§9.3), which is the only place that holds both the entries and the schema. Entry ids resolve `idField` → `id` → `sku` → `slug` → `Slug` → row index.

---

## 5. `serializeJxMarkdown` — the single Jx → markdown serializer

`@jxsuite/parser/serialize`. Replaces the studio's former `md-convert` and the compiler's former `compile-markdown` with one bidirectional module:

```ts
serializeJxMarkdown(doc, {
  mode?: "roundtrip" | "export",   // default "roundtrip"
  frontmatter?: boolean,            // roundtrip: emit YAML frontmatter (default true)
  allowlist?: Set<string>,          // roundtrip: markdown-native tags (default MD_ALL)
  componentDefs?: Map<string, JxElement>,                       // export: inline custom elements
  evaluateTemplate?: (value, scope) => unknown,                  // export: injected template hook
  buildScope?: (state) => Record<string, unknown> | null,        // export: injected scope builder
})
```

- **roundtrip** — lossless for everything it can express: YAML frontmatter (via the `yaml` package) from non-children doc keys; elements outside the allowlist (or carrying Jx-specific props) emit as remark directives with collapsed dot-path attributes. Inverse of `transpileJxMarkdown()`. It is not TOTAL: a `tagName` chosen at render time cannot be expressed at all and throws, naming the candidates it saw.
- **export** — lossy clean GFM: wrappers (`div`, `section`, …) unwrapped, custom elements inlined by resolving definitions with instance `$props`, `$prototype: "Array"` descriptors expanded, `innerHTML` converted, template strings evaluated through the injected hooks (the compiler passes its static-template machinery; the default keeps templates verbatim). No frontmatter, no directives.

Fenced-code language is canonical on `className` (`language-x`); `attributes.class` is read for backward compatibility.

Also exported: `jxToMdast` / `mdastToJx` (roundtrip tree conversions) and the element-set constants (`MD_ELEMENTS`, `MD_BLOCK`, `MD_INLINE`, `MD_ALL`, `MD_VOID`, `MD_TEXT_ONLY`) that feed `$studio.elements`.

---

## 6. `MarkdownCollection`

Runtime glob collection (node-only):

```json
{
  "state": {
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jxsuite/parser/MarkdownCollection.class.json",
      "src": "./posts/*.md",
      "sortBy": "frontmatter.date",
      "sortOrder": "desc",
      "limit": 10
    }
  }
}
```

`resolve()` returns sorted/filtered/limited `MarkdownFileResult[]`.

---

## 7. `MarkdownDirective` — `::directive{attrs}` syntax

> **Status: Partial.** The directive-to-element mapping ships in `mdastNodeToJx` (`extensions/parser/src/transpile.ts`): text, leaf and container directives, dot-path expansion, `$`-keyword mapping, pseudo-class and media style keys, and the `--title`/`--description` annotations. The `allowedNames` restriction does not: `loadContentType` (`extensions/parser/src/content-loader.ts`) derives it from the content type's `$elements` and passes it through `Markdown.load`, but `processMarkdown` (`extensions/parser/src/md.ts`) only treats `directiveOptions` as a switch for an unconfigured `remark-directive`, and no `MarkdownDirective` plugin exists. So `$elements` works only as an on/off switch: the loader never passes `directives`, a collection that declares any `$elements` accepts every directive name, and one that declares none parses no directives at all, leaving them as literal paragraph text.

Directives map to custom element tags in the Jx tree (text/leaf/container, nesting via colon count). Directive attributes use dot-path expansion (`style.backgroundColor="blue"`), `$`-keyword mapping (`prototype=` → `$prototype`), pseudo-class/media style keys, and `--title`/`--description` annotations. Content-type `$elements` become the plugin's `allowedNames`. See `specs/jx-markdown.md` for the full dialect.

---

## 8. External class contract compliance

All classes satisfy the Jx external class contract: constructor receives the config object, `resolve()` returns the value (async), and `.class.json` schemas allow the dev server, compiler, and studio to introspect structure — including the format block, capability roles with `timing`, and `$studio` hints — without importing the implementation.

## 9. `Content` — the project-section class

> **Status: Implemented.**

`Content.class.json` owns the `project.json` `content` section (extensions.md §9). Its capabilities are format-agnostic: `projectData` loads every content type through the format registry, `resolvePaths` expands `contentType` `$paths`, and `assets` publishes the collections' directories.

A content type takes seven options beyond `source`, `format`, `schema` and `$elements`, and they are what lets a folder of Markdown that was never written for a website, an Obsidian vault for instance, publish as it is: `exclude` and `where` choose which files are entries (§9.4), `idField`, `route` and `indexRoute` say what each entry is called and where it lives (§9.5), `links` says how a relative link to an entry with no page is reported (§9.6), and `alerts` maps callouts to components (§3.3). Every one is optional and absent means the behavior this section described before they existed.

### 9.1 `assets` — collection asset mounts

> **Status: Partial.** Mounts ship for plain and `{locale}` directory sources (`contentAssetMounts` in `extensions/parser/src/content-loader.ts`), and a plain source whose content type name is not URL-safe is skipped with the warning. A `{locale}` source is not: its branch tests the name inside the mount condition and moves on, so such a type gets no mounts and no warning, and its entries' content-relative references (§9.2) stay unrewritten without a word.

`Content.assets(sectionValue, { root })` returns one mount per content type whose `source` is a local **directory**: `{ urlPrefix: "/content/<type>", dir: <resolved source> }`. Single-file, remote, and missing sources get no mount — a lone file's siblings are not its collection — and a content type whose name is not URL-safe is skipped with a warning.

### 9.2 Content-relative asset references

Entries address media relative to themselves, so a collection reads correctly in a markdown editor and on the built site alike. After a format class loads a file, the loader remaps its references onto that collection's mount:

- element `src` and `poster` values anywhere in `$children`, and frontmatter fields the content-type schema declares `"format": "uri-reference"` (string or array of strings);
- only when the value is relative (no leading `/`, no `scheme:`, no `#`, no `${…}` template) **and** resolves against the entry's own directory to an existing file inside the mount directory;
- a relative reference that resolves to nothing is left as authored and reported as a warning naming the entry;
- the raw `body` is never rewritten — it is the round-trip source Studio saves back — and `href` is out of scope, since links between entries are routes rather than assets.

Because the rewrite happens in the loader, every consumer of `projectData` — site build, dev server, studio preview, search indexing — sees the same mounted URLs with no extra work.

### 9.3 Date coercion

> **Status: Partial.** `coerceEntryDates` (`extensions/parser/src/dates.ts`) runs in `loadContentType` between a format class's `load` and `validateEntries`, but only on the local format-class branch: native JSON collections and remote http(s) sources reach `validateEntries` uncoerced, so a declared date there is left as authored. An offset, fractional-second or zone-less date-time passes silently and is never normalized to UTC, because `isCoercedDate` accepts every RFC 3339 form; only a value that is not RFC 3339 at all draws the "was not coerced" warning. `_meta.mtime` is stamped by `Markdown.load` alone; `Csv.load` and `loadJSONEntries` set no `_meta`, so CSV and JSON entries carry no modification time.

A field the content-type schema declares as `format: "date"` or `format: "date-time"` is normalized to RFC 3339:

| Declared    | Stored                                                  |
| ----------- | ------------------------------------------------------- |
| `date`      | `YYYY-MM-DD`                                            |
| `date-time` | `YYYY-MM-DDTHH:MM:SSZ` — **UTC**, no fractional seconds |

**Why a string and not a `Date`.** `JSON.stringify(new Date("2025-03-04"))` yields an instant, so a Studio save would rewrite `2025-03-04` as `2025-03-04T00:00:00.000Z` — which is _March 3_ west of UTC. A `Temporal.PlainDate` is semantically right and fails differently: `<` and `>` on one yield `NaN`, and §6's sort compares with exactly those.

**Why UTC.** Mixed offsets do not sort lexicographically: `2025-03-04T01:00:00+02:00` sorts _after_ `2025-03-04T00:00:00Z` as text and is _earlier_ in fact. Normalizing makes the sort correct by construction rather than correct by accident for ISO 8601.

**Accepted**, in order: a `Date` instance, an RFC 3339 string, a bare `YYYY-MM-DD`. **Everything else is refused**, left exactly as authored, and reported naming the collection, entry, field and value. `03/04/2025` is March 4th or April 3rd depending on the reader and `new Date()` resolves it by implementation-defined rules, so guessing is the failure this pass exists to prevent — refusing is the feature.

When coercion rewrote a value the authored text is kept at `_meta.rawDates[field]`, because a collection that genuinely means "7pm local" has had that thrown away by the normalized instant.

**`_meta.mtime`.** Every loaded entry carries its source file's modification time as RFC 3339. It is the only date a file always has, so it is the fallback a feed uses when the frontmatter carries none (`site-architecture.md` §6.7) — and it is what would let the sitemap stop giving every page generated from one template that template's `<lastmod>`.

**A schemaless collection is not covered.** `MarkdownCollection` (§6) globs and sorts without a content-type schema, so nothing can know which of its frontmatter fields is a date. Its default `sortBy: "frontmatter.date"` compares text, which is correct for `YYYY-MM-DD` and wrong for an offset date-time. Declaring the field in a content type is what fixes it; inferring would mean guessing, which §9.3 refuses everywhere else.

### 9.4 Source filtering: `exclude` and `where`

Two options decide which of a source's files become entries. Both are data, never code: a `project.json` is read by Studio, the dev server and CI, and a filter that needed `eval` would make each of them a place that runs the project's text. Both grammars are closed, so an unknown operator or a negated glob is a build error naming the content type and the key, not a filter that quietly matches nothing.

**`exclude`** is a list of glob patterns, relative to a directory `source`, for files that are **never read**.

- `*` and `?` stop at `/`; `**` as a whole segment crosses directories; `[a-z]`, `[!a]` and `{a,b}` work; a trailing `/` means everything below; a backslash escapes.
- **Dotfiles are ordinary files.** A pattern that should skip `.obsidian/` says so (`.*/**`) instead of relying on a hidden default, because one glob must behave identically in a vault, a checkout and CI.
- Patterns are anchored at the source root: `STYLE.md` names that file only, and `**/README.md` names every one.
- A directory a pattern excludes whole (`internal/**`, `**/node_modules/**`) is never entered, so a vault that sits beside a website's `node_modules` does not pay to list it.
- A format class's `discover` receives the list as `options.exclude`, and the loader applies it again to whatever comes back, so a third-party format that ignores the option is filtered anyway. A single-file or remote source has nothing to exclude and ignores the option.

**`where`** is a declarative filter on each entry's frontmatter (`data`), applied after the file is read, so an entry that fails it is left out **before** it is validated, coerced, given an id or a route, or counted as a duplicate.

```json
"where": { "publish": true, "status": { "$ne": "draft" } }
```

- Keys are frontmatter fields (a dotted key reaches nested data) and combine with AND. There is no OR and nothing is evaluated: a project that needs "either" declares two content types.
- A value is a literal to equal, strictly (`"true"` is not `true`), or an operator object: `$eq`, `$ne`, `$in`, `$nin`, `$exists`, `$gt`, `$gte`, `$lt`, `$lte`. Several operators in one object combine with AND.
- A scalar matches an array field that contains it, so `{ "tags": "frappe" }` selects every entry tagged `frappe`; an array or object compares as a whole value. A field that is absent satisfies `$ne` and `$nin` and fails every other condition. `$exists` treats `null` (an empty YAML key) as absent. A YAML date compares as RFC 3339 text.

The loaded `Map` holds only the kept entries, and every consumer reads that Map, so `ContentCollection`, `ContentEntry`, `$paths`, the sitemap, the search index, feeds and relationships ([relationships.md](./relationships.md)) see the same set with no filtering of their own. Files are discovered in sorted order (entries sorted by name within each directory, depth first), so the order of an unsorted collection, and which of two entries wins a duplicate, is the same on every machine.

### 9.5 Entry ids and routes

**Ids** are derived as before: the path under the source root without its extension, `/`-separated, with the case and spaces of the file name kept as written (`Linux/Swap Configuration.md` is `Linux/Swap Configuration`). A trailing `/index` is stripped, and so is a trailing `/README` in any case, so `Frappe/README.md` is the id `Frappe`, the same entry a folder shows on GitHub and in Obsidian. A file directly at the source root keeps its basename, `README` included.

**`idField`** names a frontmatter field whose value (a string or a number) replaces the id. An entry without it keeps its path id and is reported. Two entries that end up with the same id are reported naming both files, and a lookup finds the first; ids are not required to be unique when a `route` is declared, because routes are what pages are found by.

**`route`** is a template giving each entry its URL, and it is the single place that URL is decided:

```json
"route": "/kb/{category:slug}/{slug}/",
"indexRoute": "/kb/{dir:slug}/"
```

- `route` is one template for every entry. `indexRoute` routes a directory's `README.md` or `index.md` instead, which is how `Frappe/README.md` becomes `/kb/frappe/` and `WordPress/Gravity Forms/README.md` becomes `/kb/wordpress/gravity-forms/`. Without it a README is routed like any other entry, and `indexRoute` without `route` is an error.
- Placeholders are `{id}`, `{dir}` (the file's directory, empty at the root), `{file}` (its name without extension) or a frontmatter field (`data.` prefix optional, dotted paths allowed). Transforms follow a colon and chain: `slug`, `lower`, `upper`, `raw`.
- `slug` works per path segment: Latin diacritics fold away, `&` reads as "and" (`Git & Dev Tools` is `git-and-dev-tools`), apostrophes drop, other punctuation becomes one hyphen, and letters and digits of every script are kept.
- A route is normalized to a leading `/`, no doubled or trailing slash; `build.trailingSlash` decides whether the URL a reader gets carries one. A value that renders to a `.` or `..` segment fails: a route is written to disk under `dist/`.
- An entry the template cannot render (a missing field), and an entry whose route another already holds, get no route and are reported with the file names involved; the second never overwrites the first.

The loader stamps three facts on each kept entry: `_meta.path` (the source file relative to the source root), and, when `route` is declared, `_meta.route` (the path) and `_meta.url` (the same, percent-encoded, with the locale prefix of a `{locale}` collection and the site's trailing-slash rule). Nothing else computes an entry's URL: link rewriting (§9.6), `resolvePaths`, `ContentEntry`, `@jxsuite/search` and `@jxsuite/feed` all read these, so a page that exists and a link to it cannot disagree.

**`$paths` on a routed type.** With a `route` and neither `param` nor `field` in the `$paths` value, `resolvePaths` matches each entry's route against the URL pattern of the page being expanded, which the host passes as `urlPattern` and `params` in the context, and returns the parameters that pattern needs. The same `$paths: { "contentType": "kb" }` therefore serves `pages/kb/[...path].json` (one parameter holding the rest of the route), `pages/kb/[category]/[slug].json` and `pages/kb/[category].json`, and the page generated for an entry is always at the entry's own URL. An entry whose route the pattern cannot produce belongs to another page and is skipped; a page that fits none says so once. Naming `param` or `field` keeps the older meaning exactly: one parameter, valued by the entry id or that field.

**`ContentEntry`** with no `id` and no `field` binds to the entry whose route is the URL of the page being built (the locale prefix removed), so a routed page needs no parameter name at all.

### 9.6 Links between entries

A content type that declares a `route` rewrites the relative links of its entries once the whole collection has loaded, because a link can be resolved only when every other entry is known. Without a `route` nothing is rewritten and no link is reported.

- **What is rewritten.** An `<a href>` (authored as a Markdown link or as raw HTML) whose reference resolves, against the entry's own directory, to a source file of the collection. The href becomes the target's `_meta.url`; a `?query` is kept; a `#fragment` is normalized to the heading id the page carries (`slugifyHeading`, §3.2), so Obsidian's `Note.md#Heading%20Text` and GitHub's `#heading-text` both land. A same-page `#Heading%20Text` is normalized the same way.
- **How it resolves.** Each path segment is percent-decoded on its own (`%20` is a space; `%2F` never becomes a separator), `.` and `..` are applied against the entry's directory, and the walk **stops at the source root**: a `..` that would climb out of it never produces a path. A name is matched exactly, then case-insensitively when that is unambiguous. A reference to a directory (`../Frappe/`, or `../Frappe`) is that directory's `README.md` or `index.md`, and an extension-less one may be a file whose `.md` was left off.
- **What is never touched.** A scheme (`https:`, `mailto:`, `tel:`, `data:`), an absolute or protocol-relative path, a `${…}` template, a same-page anchor that is already a heading id, and a reference to anything that is not an entry (an image, a PDF). Relative images are the business of §9.2.
- **A link with no page** (excluded, filtered out by `where`, without a route, a duplicate-route loser, absent, or pointing outside the source root) is replaced by its own content, so no dead link is published, and is reported with the source file and the target: `"Frappe/Bench Operations.md" links to "Draft%20Recipe.md", which is not published (left out by where.status)`. The `links` option sets the severity: `"warn"` (default) logs each, `"error"` fails the build with every broken link in one message, `"ignore"` is silent. A link is reported once per source file and target.

Studio's canvas does not apply any of this: it parses an entry through `transpileJxMarkdown`, which rewrites no links and renders no callouts, so a relative link and a `> [!NOTE]` read as authored there.

## 10. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). `remark`, `unified` and the MDAST node model are libraries rather than published standards, so they are described in §2 rather than cited here.

| Standard                                           | Class       | Binds | Evidence                                                                                                                       | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CommonMark](https://spec.commonmark.org/current/) | **Subset**  | §3    | extensions/parser/src/md.ts, extensions/parser/tests/transpile.test.ts                                                         | Parsing is CommonMark via `remark`, but only the constructs §8 maps reach a Jx node — an unmapped construct is dropped rather than mis-rendered.                                                                                                                                                                                                                                                                                                                                    |
| [GFM](https://github.github.com/gfm/)              | **Subset**  | §3    | extensions/parser/src/md.ts                                                                                                    | Tables, strikethrough, task lists and autolinks are parsed; the mapping restriction above applies to them too.                                                                                                                                                                                                                                                                                                                                                                      |
| [RFC 7763](https://www.rfc-editor.org/rfc/rfc7763) | **Adopted** | §3    | extensions/parser/src/Markdown.class.json, packages/schema/src/media-type.ts, packages/schema/tests/class-schema-drift.test.ts | The class declares `text/markdown; variant=GFM`, and every host that serves a `.md` file off disk sends the same thing — the `variant` RFC 7764 registers is the only thing on the wire that says which markdown a file is. A drift test joins the two statements, which live in files that cannot import each other.                                                                                                                                                               |
| [RFC 3986](https://www.rfc-editor.org/rfc/rfc3986) | **Subset**  | §9.6  | extensions/parser/src/content-links.ts, extensions/parser/tests/content-links.test.ts                                          | §5 reference resolution of a relative path against the entry's own directory, with dot segments removed (§5.2.4) and each segment percent-decoded on its own (§2.1), and the query and fragment kept apart from the path. A reference with a scheme or an authority is left alone, and the walk never leaves the source root, which is a stricter rule than §5.2.4 (it would discard a surplus `..`). Not implemented: §6 normalization and comparison.                             |
| [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180) | **Subset**  | §4    | extensions/parser/src/csv.ts, extensions/parser/tests/csv.test.ts                                                              | Quoted fields, embedded separators and CRLF records are handled. There is no dialect negotiation and no header-less mode: the first record is always the header.                                                                                                                                                                                                                                                                                                                    |
| [RFC 9512](https://www.rfc-editor.org/rfc/rfc9512) | **Adopted** | §3    | packages/schema/src/media-type.ts, packages/schema/tests/media-type.test.ts, packages/compiler/tests/preview-server.test.ts    | `application/yaml`, which is the registration — deliberately not `text/yaml`, `text/x-yaml` or `application/x-yaml`, the pre-registration spellings §5 asks implementations to retire and the ones most platform tables still answer with. A `.yaml` file in `public/` is served under the registered type by both the dev server and `jx preview`.                                                                                                                                 |
| [UAX #15](https://www.unicode.org/reports/tr15/)   | **Adopted** | §3    | extensions/parser/src/transpile.ts, extensions/parser/tests/transpile.test.ts                                                  | `slugifyHeading` normalizes to NFC before casing, so the two spellings of an accented heading — `e` + U+0301 on macOS, U+00E9 on Windows — produce one anchor instead of two that look identical and compare unequal. Casing is `toLowerCase`, never `toLocaleLowerCase`: an anchor is a URL and belongs to the document, not to the reader's locale.                                                                                                                               |
| [UAX #29](https://www.unicode.org/reports/tr29/)   | **Adopted** | §3    | extensions/parser/src/md.ts, extensions/parser/tests/md-units.test.ts                                                          | `$wordCount` and `$readingTime` segment words with `Intl.Segmenter` rather than splitting on whitespace, so a Japanese or Thai article is no longer counted as one word. The word-like test is spelled out as "contains a letter or a digit" because Bun's engine answers `isWordLike: false` for a mixed alphanumeric segment. Studio's SEO counters segment graphemes for the same reason: `String.length` counts code units, so an emoji spent two characters of a title budget. |
| [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) | **Subset**  | §9.3  | extensions/parser/src/dates.ts, extensions/parser/tests/dates.test.ts                                                          | Schema-declared date fields are normalized to `full-date` or a UTC `date-time`, so sorting and comparison are correct by construction. Local offsets are not preserved in the stored value — the authored text is kept at `_meta.rawDates` instead — and a value outside the accepted forms is refused rather than parsed heuristically.                                                                                                                                            |

## Changelog

- **0.2.11-draft** (2026-09-29) — Census against the code: the §3 marker narrowed to heading slugs that strip combining marks, §7 marked Partial because a collection's $elements only switch directive parsing on and restrict no names, §9.1 marked Partial for the silent skip of a localized content type with an unsafe name, and §9.3 corrected to Partial for uncoerced JSON and remote dates and the markdown-only mtime.
- **0.2.10-draft** (2026-08-27) — roundtrip serialization is lossless where expressible, not total.
- **0.2.9-draft** (2026-08-16) — §3 heading slugs normalize to NFC before casing (UAX #15) and word counts segment rather than split on whitespace (UAX #29). Closes gap:heading-slug-normalization and gap:word-segmentation.
- **0.2.8-draft** (2026-08-16) — §3 the markdown variant and YAML media type are what hosts serve, not only what the class declares; gap:markdown-variant and gap:yaml-media-type closed.
- **0.2.7-draft** (2026-08-15) — §9.3 records _meta.mtime as the date fallback a feed uses.
- **0.2.6-draft** (2026-08-15) — Add §9.3 date coercion: schema-declared date fields normalize to RFC 3339, ambiguous values are refused rather than guessed.
- **0.2.5-draft** (2026-08-15) — Add §10 Standards Alignment; §3 marked Partial — heading slugs and word counts are correct only for Latin script.
- **0.2.4-draft** (2026-07-23) — Document the Content project-section class: asset mounts and content-relative reference rewriting (§9).
- **0.2.3-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.2.2-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`79daba23`).
- **0.2.1-draft** (2026-07-17) — Sidecar bundling, extension emit capability, heading anchors (`07e28bc3`).
- **0.2.0-draft** (2026-06-10) — Consolidate markdown and csv handling to the parser package (`8b1ba6da`).
- **0.1.6-draft** (2026-05-20) — Run formatter (`8ba47930`).
- **0.1.5-draft** (2026-05-08) — Pass markdown attributes as properties (`407b70fc`).
- **0.1.4-draft** (2026-04-23) — Rebrand to jxsuite (`2897a4e8`).
- **0.1.3-draft** (2026-04-22) — Consolidate project config schema and rename as such (`e3523dbf`).
- **0.1.2-draft** (2026-04-16) — Landing site + working exports + release-it + linting (`a8409b5f`).
- **0.1.1-draft** (2026-04-15) — Rebrand to Jx / Jx Platform (`abc63f2d`).
- **0.1.0-draft** (2026-04-10) — Consolidate specs (`80ca313f`).

---

_`@jxsuite/parser` Specification v0.2.11-draft_
