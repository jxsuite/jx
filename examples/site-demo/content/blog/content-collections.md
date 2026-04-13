---
title: Content Collections in Practice
description: How to use content collections for your blog
pubDate: "2024-02-20"
tags:
  - content
  - collections
draft: false
---

# Content Collections in Practice

Content collections bring structure to your content. Define schemas in `content.config.json`, write Markdown with frontmatter, and query it from your pages.

## Defining a Collection

Put a `content.config.json` in your `content/` directory with collection schemas.

## Querying in Pages

Use `$prototype: "ContentCollection"` in your page state to query collections with filtering, sorting, and pagination.
