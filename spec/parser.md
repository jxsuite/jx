# `@jxplatform/parser` Specification

## Markdown Parser and External Class Integration

**Version:** 2.0.0-draft
**Status:** In Progress
**License:** MIT

---

## 1. Overview

`@jxplatform/parser` provides the content layer for Jx applications. It exports external classes (`MarkdownFile`, `MarkdownCollection`) that satisfy the Jx `$prototype` + `$src` external class contract, enabling markdown content to be declared as reactive data sources in Jx component files.

Built on the `unified` / `remark` / `rehype` pipeline.

---

## 2. Exports

| Export               | Type          | Description                                               |
| -------------------- | ------------- | --------------------------------------------------------- |
| `MarkdownFile`       | Class         | Parses a single markdown file into structured data        |
| `MarkdownCollection` | Class         | Globs markdown files into a sorted, filterable collection |
| `MarkdownDirective`  | Remark plugin | Maps `::directive{attrs}` syntax to custom element tags   |

---

## 3. `MarkdownFile`

### 3.1 Jx Usage

```json
{
  "state": {
    "post": {
      "$prototype": "MarkdownFile",
      "$src": "@jxplatform/md",
      "src": "./content/posts/hello-world.md"
    }
  }
}
```

### 3.2 Constructor

Receives a configuration object with:

| Property | Type     | Required | Description                    |
| -------- | -------- | -------- | ------------------------------ |
| `src`    | `string` | Yes      | Path to a single markdown file |

### 3.3 Resolved Value

The `resolve()` method returns an object with:

| Property       | Type     | Description                                 |
| -------------- | -------- | ------------------------------------------- |
| `slug`         | `string` | Filename without extension                  |
| `path`         | `string` | Full file path                              |
| `frontmatter`  | `object` | Parsed YAML frontmatter                     |
| `$body`        | `string` | Rendered HTML body                          |
| `$excerpt`     | `string` | First paragraph as HTML                     |
| `$toc`         | `array`  | Table of contents (heading id, text, depth) |
| `$readingTime` | `number` | Estimated reading time in minutes           |
| `$wordCount`   | `number` | Word count                                  |

### 3.4 Parsing Pipeline

1. `remark-parse` — markdown to MDAST
2. `remark-frontmatter` + `remark-parse-frontmatter` — YAML frontmatter extraction
3. `remark-gfm` — GitHub Flavored Markdown (tables, strikethrough, autolinks)
4. `remark-directive` — `::directive{attrs}` syntax
5. `remark-rehype` — MDAST to HAST
6. `rehype-stringify` — HAST to HTML string

> **Status: Implemented.** Full parsing pipeline with all listed output properties.

---

## 4. `MarkdownCollection`

### 4.1 Jx Usage

```json
{
  "state": {
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jxplatform/md",
      "src": "./content/posts/*.md",
      "sortBy": "date",
      "sortOrder": "desc",
      "limit": 10
    }
  }
}
```

### 4.2 Constructor

| Property    | Type     | Required | Description                                      |
| ----------- | -------- | -------- | ------------------------------------------------ |
| `src`       | `string` | Yes      | Glob pattern for markdown files                  |
| `sortBy`    | `string` | No       | Frontmatter field to sort by (default: `"date"`) |
| `sortOrder` | `string` | No       | `"asc"` or `"desc"` (default: `"desc"`)          |
| `limit`     | `number` | No       | Maximum number of results                        |
| `filter`    | `string` | No       | Frontmatter field filter expression              |

### 4.3 Resolved Value

An array of `MarkdownFile` resolved objects, sorted and filtered per configuration.

> **Status: Implemented.** Full collection with glob, sort, limit, and filter.

---

## 5. `MarkdownDirective`

### 5.1 Purpose

A remark plugin that transforms markdown directive syntax into custom element tags in the HTML output:

```markdown
::my-component{title="Hello" count=5}
```

Becomes:

```html
<my-component title="Hello" count="5"></my-component>
```

This allows Jx custom elements to be embedded inside markdown content.

> **Status: Implemented.** Plugin registered in the remark pipeline.

---

## 6. External Class Contract Compliance

Both `MarkdownFile` and `MarkdownCollection` satisfy the Jx external class contract:

| Requirement                        | Implementation                                   |
| ---------------------------------- | ------------------------------------------------ |
| Constructor receives config object | Yes — all properties except reserved keywords    |
| `resolve()` async method           | Yes — returns parsed content                     |
| `value` property                   | Accessible after resolution                      |
| `subscribe(callback)`              | Not implemented (content is static at load time) |

---

## 7. `.class.json` Schemas

The package includes JSON Schema definitions for both classes:

- `MarkdownFile.class.json` — schema with `$implementation: "./md.js"`
- `MarkdownCollection.class.json` — schema with `$implementation: "./md.js"`

These enable the dev server and compiler to introspect class structure without importing the implementation.

> **Status: Implemented.** Both `.class.json` files are present and used by the resolution pipeline.

---

## 8. Dependencies

| Package                    | Purpose                       |
| -------------------------- | ----------------------------- |
| `unified`                  | Pipeline orchestrator         |
| `remark-parse`             | Markdown → MDAST              |
| `remark-frontmatter`       | YAML frontmatter support      |
| `remark-parse-frontmatter` | Frontmatter extraction        |
| `remark-gfm`               | GitHub Flavored Markdown      |
| `remark-directive`         | Directive syntax              |
| `remark-rehype`            | MDAST → HAST                  |
| `rehype-stringify`         | HAST → HTML                   |
| `glob`                     | File globbing for collections |
| `mdast-util-to-string`     | Text extraction               |
| `unist-util-visit`         | AST traversal                 |

---

_`@jxplatform/parser` Specification v2.0.0-draft_
