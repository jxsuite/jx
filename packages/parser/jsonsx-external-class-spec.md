# JSONsx External Class Integration
## Spec Amendment: `$src` on `$defs` Entries + `@jsonsx/md` Reference Implementation

**Amendment to:** JSONsx Specification v0.8.0+  
**Status:** Draft  
**Version:** 0.1.0

---

## Table of Contents

1. [Overview](#1-overview)
2. [Motivation](#2-motivation)
3. [The `$src` Property on `$defs` Entries](#3-the-src-property-on-defs-entries)
4. [External Class Contract](#4-external-class-contract)
5. [Resolution Algorithm](#5-resolution-algorithm)
6. [The `$prototype` Registry](#6-the-prototype-registry)
7. [Signal Wrapping](#7-signal-wrapping)
8. [`@jsonsx/md` — Reference Implementation](#8-jsonsxmd--reference-implementation)
9. [Markdown as Template Input](#9-markdown-as-template-input)
10. [Markdown as a Data Source](#10-markdown-as-a-data-source)
11. [JSONsx Components Inside Markdown](#11-jsonsx-components-inside-markdown)
12. [Complete Example](#12-complete-example)
13. [Standards Alignment](#13-standards-alignment)
14. [Appendix A — External Class Checklist](#appendix-a--external-class-checklist)
15. [Appendix B — `@jsonsx/md` API Reference](#appendix-b--jsonsxmd-api-reference)

---

## 1. Overview

This amendment specifies a single surgical extension to the JSONsx `$defs` system: the addition of an optional `$src` property on any `$defs` entry that carries a `$prototype` value.

When `$src` is present, the runtime resolves `$prototype` as a named export from the specified module rather than from the built-in prototype registry. All other behavior — constructor invocation with the remaining `$defs` properties, signal wrapping, reactivity — is identical to built-in prototypes.

This extension makes JSONsx's prototype system fully open, allowing any JavaScript class from any source to back a reactive `$defs` signal, while introducing zero new concepts and maintaining complete consistency with existing spec conventions.

The `@jsonsx/md` markdown integration library is the flagship proof of concept for this mechanism. It demonstrates that complex, Astro-like content pipeline capabilities — markdown rendering, frontmatter extraction, file-system content collections, and directive-based component embedding — are achievable within JSONsx's existing design philosophy without any special-casing in the core spec.

---

## 2. Motivation

### 2.1 The `$prototype` Convention

Every `$prototype` value in the JSONsx spec is a real JavaScript class name. The runtime backs the signal with an instance of that class:

| `$prototype` | Backed by |
|---|---|
| `Request` | `globalThis.Request` |
| `URLSearchParams` | `globalThis.URLSearchParams` |
| `FormData` | `globalThis.FormData` |
| `LocalStorage` | JSONsx built-in wrapper |
| `Array` | JSONsx reactive array |

This convention is load-bearing. It is why JSONsx's property names are self-documenting and why the schema is readable without a reference guide. `$prototype: "Request"` means exactly what a web developer expects it to mean.

### 2.2 The Gap

The built-in registry covers the Web API classes that ship with every browser. It cannot cover user-defined classes, project-specific parsers, third-party libraries, or domain objects. Without an extension mechanism, the only way to use custom logic in a `$defs` signal is to put it in a `$handler` — which is the right home for behavior, but not for data source configuration.

A content collection backed by a markdown parser is a *data source*, not a *behavior*. It belongs in `$defs`, not in `$handlers`. The question is simply: how does the runtime know which class to use?

### 2.3 The Solution

The answer is already present in the spec. `$handlers` already uses `$src` to locate function implementations in external modules. The same mechanism, applied to `$defs` entries, resolves class implementations. No new concepts. No new keywords. One new application of an existing pattern.

---

## 3. The `$src` Property on `$defs` Entries

### 3.1 Syntax

`$src` is an optional property on any `$defs` entry that carries a `$prototype` value:

```json
{
  "$defs": {
    "$posts": {
      "$prototype": "MarkdownCollection",
      "$src": "./lib/markdown-collection.js",
      "src": "./content/posts/*.md",
      "timing": "compiler",
      "signal": true
    }
  }
}
```

### 3.2 Value

The `$src` value is a module specifier string. It follows the same resolution semantics as `$src` on handler declarations:

| Specifier form | Example | Resolution |
|---|---|---|
| Relative path | `"./lib/my-class.js"` | Relative to the `.json` file |
| Absolute URL | `"https://cdn.example.com/parser.js"` | Fetched directly |
| npm specifier | `"npm:@jsonsx/md"` | Resolved via npm resolver |
| Package name | `"@jsonsx/md"` | Resolved via npm resolver |

### 3.3 Named export

By default, the runtime looks for a named export matching `$prototype` in the resolved module:

```js
// markdown-collection.js
export class MarkdownCollection { ... }
//           ^^^^^^^^^^^^^^^^^ must match $prototype value
```

An optional `$export` property overrides the export name when the class is exported under a different name:

```json
{
  "$prototype": "MarkdownCollection",
  "$src": "./lib/parsers.js",
  "$export": "MDCollection"
}
```

### 3.4 When `$src` is absent

When `$src` is absent, resolution falls through to the built-in prototype registry. This is identical to current spec behavior. Existing documents require no changes.

### 3.5 Relationship to `$handlers`

`$src` on a `$defs` entry and `$src` on a handler declaration use the same module specifier syntax and the same resolution algorithm. The distinction is:

- `$src` on a `$handler: true` entry → resolves a **function** export
- `$src` on a `$prototype` entry → resolves a **class** export

Both are optional companions to the main JSONsx file. Both are followed by IDEs as standard module specifiers with no custom tooling required.

---

## 4. External Class Contract

Any class used as a JSONsx prototype via `$src` must satisfy the following contract. The contract is deliberately minimal to accommodate the widest range of existing libraries.

### 4.1 Constructor

The class constructor receives a single configuration object containing all `$defs` properties except the JSONsx-reserved keywords (`$prototype`, `$src`, `$export`, `signal`, `timing`, `$compute`, `$deps`):

```js
// Given this $defs entry:
{
  "$prototype": "MarkdownCollection",
  "$src": "./lib/markdown-collection.js",
  "src": "./content/posts/*.md",
  "sortBy": "frontmatter.date",
  "limit": 10,
  "signal": true
}

// The runtime calls:
new MarkdownCollection({
  src: "./content/posts/*.md",
  sortBy: "frontmatter.date",
  limit: 10
})
// JSONsx-reserved properties are stripped before passing
```

### 4.2 Value resolution

The runtime needs to obtain the signal's initial value from the class instance. It checks for these methods in order:

1. `instance.resolve()` — async method, awaited. Preferred for async sources (file I/O, network).
2. `instance.value` — synchronous getter or property.
3. `instance` itself — if neither above is present, the instance is used as the value directly.

### 4.3 Reactivity (optional)

Classes that want to participate in JSONsx reactivity — pushing updates when their underlying data changes — may implement:

```js
instance.subscribe(callback)  // called with new value whenever data changes
instance.unsubscribe()        // cleanup, called when signal is disposed
```

When `subscribe` is present, the runtime wraps the instance in a `Signal.State` and calls `subscribe` to trigger updates. When absent, the signal is initialized once with the resolved value and treated as static.

### 4.4 Minimum viable implementation

A class with only a constructor and `resolve()` is sufficient for all static/server-timed use cases:

```js
export class MarkdownCollection {
  constructor(config) {
    this.config = config;
  }

  async resolve() {
    // return an array of processed items
  }
}
```

---

## 5. Resolution Algorithm

The runtime resolves an external `$prototype` as follows:

```
Given a $defs entry with $prototype: "MyClass" and $src: "./lib/my-class.js":

1. Check module cache for $src specifier
   → If cached, use cached module (avoid duplicate imports)
   
2. If not cached:
   a. Resolve $src relative to the component .json file path
   b. import($resolvedSrc)
   c. Cache result under $src specifier

3. Extract export:
   a. If $export is present: use module[$export]
   b. Else: use module[$prototype]
   c. If neither resolves: throw "Export '$prototype' not found in '$src'"

4. Verify export is a constructor (typeof === 'function')
   → If not: throw "'$prototype' from '$src' is not a class"

5. Strip JSONsx-reserved properties from $defs entry to produce config object

6. Instantiate: new ExportedClass(config)

7. Resolve value:
   a. If instance.resolve is a function: value = await instance.resolve()
   b. Else if instance.value is defined: value = instance.value
   c. Else: value = instance

8. Wrap in signal per §7 and register in component scope
```

Module caching in step 1–2 is important: a component that declares multiple `$defs` entries pointing to the same `$src` module imports it only once. This mirrors how ES module imports behave and prevents redundant network requests.

---

## 6. The `$prototype` Registry

The full registry of built-in `$prototype` values, unchanged from the base spec, plus the new resolution path:

| `$prototype` | Source | Notes |
|---|---|---|
| `Request` | Built-in | Fetch API integration |
| `URLSearchParams` | Built-in | Reactive query string |
| `FormData` | Built-in | Reactive form data |
| `LocalStorage` | Built-in | Reactive persistent storage |
| `SessionStorage` | Built-in | Reactive session storage |
| `Cookie` | Built-in | Reactive cookie access |
| `IndexedDB` | Built-in | Reactive IDB database |
| `Array` | Built-in | Reactive mapped list |
| `Set` | Built-in | Reactive Set collection |
| `Map` | Built-in | Reactive Map collection |
| `Blob` | Built-in | Reactive binary data |
| `ReadableStream` | Built-in | Reactive stream |
| *Any other name* | `$src` required | External class |

When `$prototype` is not in the built-in registry and `$src` is absent, the runtime throws a clear error: `"Unknown $prototype 'X'. Did you mean to add '$src'?"`.

---

## 7. Signal Wrapping

Signal wrapping behavior for external classes is identical to built-in prototypes:

| `signal` | `timing` | `subscribe` present | Result |
|---|---|---|---|
| `true` | `"server"` | — | Resolved at build time, baked as static value |
| `true` | `"client"` (default) | No | `Signal.State`, initialized with `resolve()` result |
| `true` | `"client"` | Yes | `Signal.State`, updated via `subscribe()` |
| `false` / absent | — | — | Resolved once, not wrapped |

The `timing` property determines *when* resolution occurs. For `timing: "compiler"`, the compiler calls `resolve()` at build time and replaces the `$defs` entry with a static value in the output. This is the mechanism by which content collections produce zero-JS static HTML.

---

## 8. `@jsonsx/md` — Reference Implementation

`@jsonsx/md` is the official JSONsx markdown integration library. It demonstrates the external class mechanism by providing three classes that cover the full range of markdown integration use cases:

```
npm install @jsonsx/md
```

### Classes provided

| Export | Purpose |
|---|---|
| `MarkdownFile` | Parse a single markdown file |
| `MarkdownCollection` | Parse a glob of markdown files as a content collection |
| `MarkdownDirective` | Remark plugin: map markdown directives to JSONsx custom elements |

### Dependency stack

`@jsonsx/md` is built on the unified/remark/rehype ecosystem:

```
unified          — processing pipeline core
remark-parse     — markdown → mdast
remark-frontmatter + remark-parse-frontmatter  — YAML/TOML frontmatter
remark-gfm       — GitHub Flavored Markdown
remark-directive — ::directive{} syntax parsing
remarkRehype     — mdast → hast
rehype-stringify — hast → HTML string
```

No React. No JSX. No framework dependency of any kind.

---

## 9. Markdown as Template Input

### 9.1 Use case

Render a single markdown file's content inside a JSONsx layout component. The markdown file's frontmatter populates signals; its body HTML is injected into the layout.

### 9.2 The `MarkdownFile` class

```json
{
  "$defs": {
    "$page": {
      "$prototype": "MarkdownFile",
      "$src": "@jsonsx/md",
      "src": "./content/about.md",
      "timing": "compiler",
      "signal": true
    }
  }
}
```

`MarkdownFile` resolves to an object with a consistent shape:

```ts
interface MarkdownFileResult {
  slug:        string;          // filename without extension
  path:        string;          // full resolved file path
  frontmatter: Record<string, unknown>;  // parsed YAML frontmatter
  $body:       string;          // rendered HTML body
  $excerpt:    string;          // first paragraph as HTML
  $toc:        TocEntry[];      // table of contents entries
  $readingTime: number;         // estimated reading time in minutes
}
```

### 9.3 Injecting body content

The `$body` property contains the rendered HTML string. It can be bound to an element's `innerHTML` equivalent using the `$ref` binding system:

```json
{
  "tagName": "article",
  "children": [
    {
      "tagName": "h1",
      "textContent": { "$ref": "#/$defs/$page/frontmatter/title" }
    },
    {
      "tagName": "div",
      "className": "prose",
      "innerHTML": { "$ref": "#/$defs/$page/$body" }
    }
  ]
}
```

### 9.4 Frontmatter as signals

Individual frontmatter values can be referenced directly via JSON Pointer fragments:

```json
{ "$ref": "#/$defs/$page/frontmatter/title" }
{ "$ref": "#/$defs/$page/frontmatter/date" }
{ "$ref": "#/$defs/$page/frontmatter/tags" }
```

When the parent signal is `timing: "compiler"`, these references are resolved statically at compile time — the resulting HTML contains no JavaScript for reading frontmatter values.

### 9.5 Frontmatter-driven signals

Frontmatter values can also seed component signals for client-side reactivity:

```json
{
  "$defs": {
    "$page": {
      "$prototype": "MarkdownFile",
      "$src": "@jsonsx/md",
      "src": "./content/post.md",
      "timing": "compiler",
      "signal": true
    },
    "$title": {
      "$compute": "$page.frontmatter.title",
      "$deps": ["#/$defs/$page"],
      "type": "string",
      "signal": true
    }
  }
}
```

---

## 10. Markdown as a Data Source

### 10.1 Use case

Glob a directory of markdown files and expose them as a reactive array for rendering lists: blog post indexes, documentation navigation, product cards, etc.

### 10.2 The `MarkdownCollection` class

```json
{
  "$defs": {
    "$posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "sortBy": "frontmatter.date",
      "sortOrder": "desc",
      "limit": 10,
      "timing": "compiler",
      "signal": true
    }
  }
}
```

`MarkdownCollection` resolves to an array of `MarkdownFileResult` objects (see §9.2), sorted and filtered per configuration.

### 10.3 Configuration properties

| Property | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | Required | Glob pattern, file path, or directory |
| `sortBy` | `string` | `"frontmatter.date"` | Dot-notation path into the item object |
| `sortOrder` | `"asc" \| "desc"` | `"desc"` | Sort direction |
| `limit` | `integer` | No limit | Maximum items to return |
| `filter` | `string` | No filter | JSONata expression evaluated against each item |
| `timing` | `"compiler" \| "client"` | `"compiler"` | When to resolve the collection |

### 10.4 Rendering a post list

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "PostIndex",
  "$defs": {
    "$posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "sortBy": "frontmatter.date",
      "sortOrder": "desc",
      "timing": "compiler",
      "signal": true
    }
  },
  "tagName": "post-index",
  "children": [
    {
      "tagName": "h1",
      "textContent": "Latest Posts"
    },
    {
      "tagName": "ul",
      "className": "post-list",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/$defs/$posts" },
        "map": {
          "tagName": "li",
          "children": [
            {
              "tagName": "a",
              "attributes": {
                "href": { "$ref": "$map/item/slug" }
              },
              "textContent": { "$ref": "$map/item/frontmatter/title" }
            },
            {
              "tagName": "time",
              "textContent": { "$ref": "$map/item/frontmatter/date" }
            },
            {
              "tagName": "p",
              "textContent": { "$ref": "$map/item/$excerpt" }
            }
          ]
        }
      }
    }
  ]
}
```

With `timing: "compiler"`, the compiler resolves `$posts` at build time and renders this entire structure as static HTML. Zero JavaScript ships for this component.

### 10.5 Filtering with JSONata

The `filter` property accepts a JSONata expression evaluated against each `MarkdownFileResult`:

```json
{
  "$prototype": "MarkdownCollection",
  "$src": "@jsonsx/md",
  "src": "./content/posts/*.md",
  "filter": "frontmatter.published = true and 'web' in frontmatter.tags",
  "sortBy": "frontmatter.date",
  "timing": "compiler",
  "signal": true
}
```

---

## 11. JSONsx Components Inside Markdown

### 11.1 Use case

Embed JSONsx custom elements inside markdown content without JSX or JavaScript syntax. Authors write standard markdown with directive syntax; the compiler outputs HTML containing registered custom elements that the JSONsx runtime hydrates.

### 11.2 The directive syntax

`@jsonsx/md` uses `remark-directive` to parse a markdown extension syntax for component embedding. Three directive forms are supported:

**Leaf directive** — a self-contained component on its own line:
```markdown
::user-card{firstName="Jane" lastName="Smith" score="92"}
```

**Container directive** — a component with markdown content inside:
```markdown
:::feature-callout{type="warning"}
This is **important** content that the component will receive.
:::
```

**Inline directive** — a component within flowing text:
```markdown
See :tooltip[the docs]{href="/docs"} for more detail.
```

### 11.3 The `MarkdownDirective` remark plugin

`MarkdownDirective` is a remark plugin (not a prototype class) that maps directives to custom element tags in the HTML output:

```js
// In a Node.js build script or JSONsx compiler config:
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { MarkdownDirective } from '@jsonsx/md';

const result = await unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(MarkdownDirective)          // maps ::tag-name{} → <tag-name>
  .use(remarkRehype)
  .use(rehypeStringify)
  .process(markdownSource);
```

`MarkdownDirective` converts each directive into a custom element tag in the hast tree by setting `data.hName` to the directive name and `data.hProperties` to the directive's attributes. The output is valid HTML containing custom element tags, which the JSONsx runtime hydrates on the client.

### 11.4 Directive-to-element mapping

| Markdown directive | HTML output | JSONsx behavior |
|---|---|---|
| `::user-card{firstName="Jane"}` | `<user-card firstName="Jane"></user-card>` | Hydrated by JSONsx if `user-card` is registered |
| `:::callout{type="warning"}..content..:::` | `<callout type="warning"><p>..content..</p></callout>` | Content passed as slot |
| `:tooltip[text]{href="/docs"}` | `<tooltip href="/docs">text</tooltip>` | Inline component |

**The hyphen requirement:** Custom element tag names must contain a hyphen per the Web Components specification. Directive names without a hyphen are automatically prefixed with `jx-`: `::card{}` becomes `<jx-card>`, `::button{}` becomes `<jx-button>`. Directive names that already contain a hyphen are passed through unchanged.

### 11.5 Component registration

Custom elements used in markdown must be registered in the JSONsx application. This is standard JSONsx custom element definition — nothing directive-specific:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "UserCard",
  "tagName": "user-card",
  "$defs": {
    "firstName": { "type": "string", "default": "" },
    "lastName":  { "type": "string", "default": "" },
    "score":     { "type": "integer", "default": 0 }
  },
  "children": [ ... ]
}
```

### 11.6 Progressive enhancement

The directive approach is naturally progressively enhanced. The HTML rendered by the markdown pipeline contains a valid custom element tag with its attributes. If JavaScript is unavailable or the component hasn't loaded yet:

- The tag renders as an unknown HTML element (visible but unstyled)
- Any fallback content in the container directive renders normally
- No layout shift occurs

When the JSONsx runtime loads and registers the custom element, it hydrates in place using the attributes as `$props`.

### 11.7 Using `MarkdownFile` with directives

`MarkdownFile` automatically applies `MarkdownDirective` when the `directives` option is enabled:

```json
{
  "$defs": {
    "$post": {
      "$prototype": "MarkdownFile",
      "$src": "@jsonsx/md",
      "src": "./content/posts/my-post.md",
      "directives": true,
      "timing": "compiler",
      "signal": true
    }
  }
}
```

The `$body` property of the resolved result will contain HTML with custom element tags wherever directives appeared in the source markdown.

---

## 12. Complete Example

A complete blog post page demonstrating all three markdown integration modes together.

### `post-page.json`

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "PostPage",
  "$handlers": "./post-page.js",

  "$defs": {
    "$slug": {
      "type": "string",
      "default": "",
      "signal": true
    },
    "$post": {
      "$prototype": "MarkdownFile",
      "$src": "@jsonsx/md",
      "src": { "$ref": "#/$defs/$slug" },
      "directives": true,
      "timing": "compiler",
      "signal": true
    },
    "$relatedPosts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "filter": "slug != $slug and frontmatter.published = true",
      "sortBy": "frontmatter.date",
      "limit": 3,
      "timing": "compiler",
      "signal": true
    },
    "onLoad": { "$handler": true }
  },

  "tagName": "post-page",
  "style": {
    "maxWidth": "720px",
    "margin": "0 auto",
    "padding": "2rem 1rem",
    "fontFamily": "system-ui, sans-serif"
  },

  "children": [
    {
      "tagName": "header",
      "children": [
        {
          "tagName": "h1",
          "textContent": { "$ref": "#/$defs/$post/frontmatter/title" }
        },
        {
          "tagName": "div",
          "className": "meta",
          "style": { "color": "#666", "fontSize": "0.875em" },
          "children": [
            {
              "tagName": "time",
              "textContent": { "$ref": "#/$defs/$post/frontmatter/date" }
            },
            {
              "tagName": "span",
              "textContent": { "$ref": "#/$defs/$post/$readingTime" }
            }
          ]
        }
      ]
    },
    {
      "tagName": "article",
      "className": "prose",
      "innerHTML": { "$ref": "#/$defs/$post/$body" }
    },
    {
      "tagName": "aside",
      "children": [
        {
          "tagName": "h2",
          "textContent": "Related Posts"
        },
        {
          "tagName": "ul",
          "children": {
            "$prototype": "Array",
            "items": { "$ref": "#/$defs/$relatedPosts" },
            "map": {
              "tagName": "li",
              "children": [
                {
                  "tagName": "a",
                  "attributes": { "href": { "$ref": "$map/item/slug" } },
                  "textContent": { "$ref": "$map/item/frontmatter/title" }
                }
              ]
            }
          }
        }
      ]
    }
  ]
}
```

### `post-page.js`

```js
export default {
  onLoad() {
    // Set slug from URL path on client-side navigation
    const slug = window.location.pathname.replace('/posts/', '');
    this.$slug.set(`./content/posts/${slug}.md`);
  }
};
```

### Example markdown file: `./content/posts/intro-to-jsonsx.md`

```markdown
---
title: Introduction to JSONsx
date: 2025-04-01
tags: [web, jsonsx, standards]
published: true
---

JSONsx is a JSON schema for reactive web applications.

## Getting Started

Install the runtime:

::code-block{lang="bash"}
npm install @jsonsx/runtime
::

## Interactive Demo

Try adjusting the counter below:

::counter-widget{initialValue="0" step="5"}

More content follows normally after the component.

:::callout{type="info"}
This callout is a **JSONsx component** rendered inside markdown.
It receives its `type` prop from the directive attribute.
:::
```

The `::counter-widget` and `:::callout` directives render as `<counter-widget>` and `<callout>` custom elements in the output HTML, which the JSONsx runtime hydrates if those components are registered.

---

## 13. Standards Alignment

### 13.1 What is novel

This amendment introduces one genuinely novel element: the `$src` property on `$defs` entries. This has no direct web platform equivalent. It is an intentional extension point — an escape hatch from the built-in registry to user-defined classes.

### 13.2 What is inherited

| Feature | Standard |
|---|---|
| Module specifier syntax for `$src` | WHATWG URL + ES Modules |
| MIME type dispatch via `type` property | IANA Media Types |
| Constructor-with-config pattern | Web API convention (Request, FormData, etc.) |
| Custom element tags from directives | W3C Custom Elements |
| Markdown directive syntax | remark-directive (community standard) |
| unified/remark/rehype pipeline | npm standard for markdown processing |
| Frontmatter YAML | YAML 1.2 |

### 13.3 Platform trajectory

The web platform does not currently have a content collection or markdown parsing primitive. If it ever does, the most likely form is a declarative `<link rel="...">` or a fetch-based API. JSONsx's `$prototype` + `$src` mechanism is designed so that if such a primitive ships, it can be added to the built-in registry and the `$src` property becomes optional — without any breaking changes to existing JSONsx documents.

---

## Appendix A — External Class Checklist

When authoring a class for use as a JSONsx `$prototype` via `$src`:

- [ ] Class is a named export matching the `$prototype` value (or aliased via `$export`)
- [ ] Constructor accepts a single config object
- [ ] Constructor config uses property names that are valid JSON keys and don't conflict with JSONsx reserved keywords
- [ ] `resolve()` is async if the value requires I/O or network access
- [ ] `resolve()` returns a JSON-serializable value (required for `timing: "compiler"`)
- [ ] If reactive updates are needed, `subscribe(callback)` and `unsubscribe()` are implemented
- [ ] The module exports are tree-shakable (don't bundle unneeded dependencies)
- [ ] The class is documented with which config properties it accepts and what `resolve()` returns

---

## Appendix B — `@jsonsx/md` API Reference

### `MarkdownFile`

Parses a single markdown file.

**Config properties:**

| Property | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | Required | File path or URL to markdown file |
| `directives` | `boolean` | `false` | Enable directive-to-custom-element mapping |
| `remarkPlugins` | `array` | `[]` | Additional remark plugins |
| `rehypePlugins` | `array` | `[]` | Additional rehype plugins |
| `highlight` | `boolean` | `false` | Enable syntax highlighting in code blocks |

**Resolved value shape:**

```ts
interface MarkdownFileResult {
  slug:         string;
  path:         string;
  frontmatter:  Record<string, unknown>;
  $body:        string;    // full rendered HTML
  $excerpt:     string;    // first paragraph HTML
  $toc:         Array<{ depth: number; text: string; id: string }>;
  $readingTime: number;    // minutes
  $wordCount:   number;
}
```

---

### `MarkdownCollection`

Parses a glob of markdown files into an array.

**Config properties:**

| Property | Type | Default | Description |
|---|---|---|---|
| `src` | `string` | Required | Glob pattern or directory path |
| `sortBy` | `string` | `"frontmatter.date"` | Dot-notation sort key |
| `sortOrder` | `"asc" \| "desc"` | `"desc"` | Sort direction |
| `limit` | `integer` | No limit | Max items |
| `filter` | `string` | No filter | JSONata expression |
| `directives` | `boolean` | `false` | Enable directives in all files |
| `remarkPlugins` | `array` | `[]` | Additional remark plugins |
| `rehypePlugins` | `array` | `[]` | Additional rehype plugins |

**Resolved value:** `MarkdownFileResult[]`

---

### `MarkdownDirective`

A remark plugin (not a prototype class). Pass directly to unified's `.use()`:

```js
import { MarkdownDirective } from '@jsonsx/md';

unified()
  .use(remarkParse)
  .use(remarkDirective)
  .use(MarkdownDirective)   // ← here, after remarkDirective
  .use(remarkRehype)
  .use(rehypeStringify)
```

**Options:**

```js
.use(MarkdownDirective, {
  prefix: 'jx-',          // prefix for directives without hyphens (default: 'jx-')
  passContent: true,      // pass directive content as slot (default: true)
  allowedNames: ['user-card', 'callout']  // whitelist (default: all)
})
```

---

*JSONsx External Class Integration — Amendment v0.1.0-draft*
