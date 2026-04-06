---
title: Advanced Patterns in JSONsx
date: 2025-04-01
tags: [jsonsx, advanced, patterns]
published: true
author: John Doe
---

Once you have the basics down, JSONsx offers several powerful patterns for building complex applications.

## Dynamic Component Switching

Use `$switch` to conditionally render components based on signal values:

```json
{
  "$switch": { "$ref": "#/$defs/$currentRoute" },
  "cases": {
    "home": { "$ref": "./views/home.json" },
    "about": { "$ref": "./views/about.json" }
  }
}
```

## Content Collections

With the `@jsonsx/md` library and **external class integration**, you can build Astro-like content pipelines entirely within JSONsx's declarative model.

### Markdown as a Data Source

Glob a directory of markdown files and render them as a list:

```json
{
  "$prototype": "MarkdownCollection",
  "$src": "@jsonsx/md",
  "src": "./content/posts/*.md",
  "sortBy": "frontmatter.date",
  "timing": "compiler",
  "signal": true
}
```

### Directives Inside Markdown

Embed custom elements directly in your markdown content using directive syntax.

## Compile-Time Processing

The JSONsx compiler produces five output tiers depending on how dynamic your component is:

| Surface | Output |
|---|---|
| Fully static | Plain HTML, zero JS |
| Signals only | HTML + signal init script |
| Signals + handlers | HTML + module script |
| Server-timed Request | HTML with baked data |

This means a blog built with `MarkdownCollection` and `timing: "compiler"` ships **zero JavaScript** for the index page.
