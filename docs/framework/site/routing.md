---
title: "Routing"
description: "File-based routing in Jx sites: static routes, [param] dynamic routes, [...path] catch-alls, $paths expansion, priority, and route params at runtime."
spec:
  - site-architecture.md#4
code:
  - packages/compiler/src/site/pages-discovery.ts
  - packages/site/src/pagination.ts
---

# Routing

Every file in the `pages/` directory automatically becomes a route, and there is no routing configuration. `.json` pages are native; other extensions become routable when an enabled extension claims them, which is how jxsuite.com serves `pages/index.md` as its front page (see [Jx Markdown](/docs/framework/site/jx-markdown)).

## Static routes

The file path determines the URL path:

| File                         | URL                |
| ---------------------------- | ------------------ |
| `pages/index.json`           | `/`                |
| `pages/about.json`           | `/about`           |
| `pages/about/index.json`     | `/about`           |
| `pages/blog/index.json`      | `/blog`            |
| `pages/blog/first-post.json` | `/blog/first-post` |

`index` files map to their parent directory, so `pages/about.json` and `pages/about/index.json` produce the same URL. Use whichever keeps the folder tidy, but not both.

Files and directories whose names start with `_` are excluded from routing entirely. That's the convention for co-locating components next to the pages that use them: `pages/blog/_blog-card.json` is available for `$ref` but never becomes `/blog/_blog-card`.

## Dynamic routes

Bracket syntax in filenames creates parameterized routes:

| File                         | URL pattern      | Example match               |
| ---------------------------- | ---------------- | --------------------------- |
| `pages/blog/[slug].json`     | `/blog/:slug`    | `/blog/hello-world`         |
| `pages/[category]/[id].json` | `/:category/:id` | `/products/42`              |
| `pages/docs/[...path].json`  | `/docs/*`        | `/docs/api/runtime/install` |

`[param]` matches exactly one path segment. `[...param]` is a catch-all: it matches the whole remaining path, slashes included, so one catch-all page can serve an entire subtree.

## Generating pages with $paths

A static build has to know every URL in advance, so a dynamic page declares which paths it generates with a top-level `$paths`. The most common shape drives the route from a [content collection](/docs/framework/site/content-collections). This is, abbreviated, how the docs page you are reading is generated, from `pages/docs/[...slug].json`:

```json
{
  "$layout": "./layouts/docs.json",
  "$paths": { "contentType": "docs", "param": "slug" },
  "state": {
    "page": {
      "$prototype": "ContentEntry",
      "contentType": "docs",
      "id": { "$ref": "#/$params/slug" }
    }
  },
  "children": [{ "tagName": "article", "children": "${state.page.$children ?? []}" }]
}
```

The compiler iterates `$paths` at build time and emits one HTML page per entry, substituting each entry's value into the route pattern. A dynamic page without `$paths` generates nothing (the build warns and skips it).

`$paths` takes three shapes here, and a fourth, a [paged list](#paging-a-list), below:

```json
{ "contentType": "blog", "param": "slug", "field": "id" }
```

One page per collection entry. `param` names the route parameter (default `slug`); `field` picks which entry field supplies the value (default `id`, the entry id).

A content type that declares a [`route`](/docs/framework/site/content-collections#ids-and-routes) needs neither:

```json
{ "contentType": "kb" }
```

The compiler passes the page's own URL pattern to the collection, and each entry's route is matched against it to produce the parameters that page needs. The same `$paths` serves `pages/kb/[...path].json`, which receives the rest of each route, and a `[category]/[slug].json` plus `[category].json` pair, which receive one segment each. A `ContentEntry` with no `id` binds to the entry whose route is the page's URL. A route that no dynamic page of the project produces is reported once, because the links to it point at a page that was never generated. See [Obsidian vault as content](/docs/framework/site/obsidian-vault) for a worked example.

```json
{ "values": ["en", "fr", "de"], "param": "lang" }
```

An explicit list of values.

```json
{ "$ref": "./data/products.json", "param": "id", "field": "sku" }
```

A JSON array file, one page per item, with `field` selecting the property to use.

A parameter value is data, and it becomes part of the path a page is written to, so the compiler skips, with a warning, any value that would make the page's URL contain a `.` or `..` segment, a backslash or a NUL, whichever of these shapes produced it. A frontmatter field cannot put a page outside `dist/`.

For catch-all routes the parameter value may itself contain slashes: nested content entries get path-based ids (like `framework/site/routing`), so a single `[...slug]` page fans out into the whole tree of URLs.

:::doc-tip
Your project's generated `document.schema.json` validates `$paths` against exactly these shapes plus any your extensions contribute, so a misspelled key or a source belonging to an extension you have not enabled is flagged in the editor and by `jx validate`, rather than building zero pages and warning at the end of the log. Run [`jx schema`](/docs/framework/build/cli) after changing `extensions` to keep that set current.
:::

## Paging a list

A long list (a blog's posts, a tag's archive) reads better split across numbered pages. A `paginate` source does that for a list the page already declares: it names an entry of the page's own `state`, and the build makes one page per `pageSize` items of it. Here is `pages/blog/[...page].json`:

```json
{
  "$paths": { "paginate": { "$ref": "#/state/posts" }, "pageSize": 10 },
  "state": {
    "posts": {
      "$prototype": "ContentCollection",
      "contentType": "blog",
      "sort": [{ "field": "date", "order": "desc" }]
    }
  },
  "children": [
    {
      "tagName": "ul",
      "children": [
        {
          "$prototype": "Array",
          "items": { "$ref": "#/state/posts" },
          "map": { "tagName": "li", "textContent": "${$map.item.data.title}" }
        }
      ]
    }
  ]
}
```

Each page is built with `posts` replaced by its own ten items, so the query is written once and its `filter`, `sort` and `limit` decide what is paged and in what order. The entry can be any list known at build time: a `ContentCollection`, another class entry with `timing: "compiler"`, or a literal array. An empty list still gets its first page, so the listing exists before its first post does.

The page number fills the route's parameter. A catch-all may be empty, so its first page is the list's own address; a named parameter is always one segment, so every page is numbered:

| File                        | Pages                           |
| --------------------------- | ------------------------------- |
| `pages/blog/[...page].json` | `/blog`, `/blog/2`, `/blog/3`   |
| `pages/blog/[page].json`    | `/blog/1`, `/blog/2`, `/blog/3` |

Page 1 is `/blog` itself, so a folder with a paged `[...page].json` should not also have an `index.json`: both would build `/blog`. A paged `[page].json` beside a `[slug].json` in the same folder has the same shape, so a slug that is a number competes with that page. Use `[...page].json`, or give the pages a folder of their own, such as `pages/blog/page/[page].json`.

Every page gets `$page.pagination`, ready for a pager:

| Field       | Holds                                                          |
| ----------- | -------------------------------------------------------------- |
| `number`    | This page's number, from 1                                     |
| `pageCount` | How many pages the list fills                                  |
| `pageSize`  | Items on a page                                                |
| `itemCount` | Items in the whole list                                        |
| `first`     | The first page's URL                                           |
| `prev`      | The previous page's URL, or `null` on the first page           |
| `next`      | The next page's URL, or `null` on the last page                |
| `last`      | The last page's URL                                            |
| `pages`     | Every page as `{ number, url, current }`, for a numbered pager |

A previous and next pager binds the URLs, and a numbered one maps `pages`:

```json
{
  "tagName": "nav",
  "children": [
    {
      "tagName": "a",
      "attributes": { "href": "${state.$page.pagination.next ?? ''}" },
      "hidden": "${!state.$page.pagination.next}",
      "textContent": "Older posts"
    },
    {
      "$prototype": "Array",
      "items": { "$ref": "#/state/$page/pagination/pages" },
      "map": {
        "tagName": "a",
        "attributes": {
          "href": "${$map.item.url}",
          "aria-current": "${$map.item.current ? 'page' : null}"
        },
        "textContent": "${$map.item.number}"
      }
    }
  ]
}
```

`$page.params.page` is the page number as a string on every page, `"1"` included, even where the URL leaves it out. No `<link rel="prev">` or `<link rel="next">` is added for you; emit them from `$page.pagination` if you want them.

### A paged list per tag

An archive is a list per value of something else: a tag, a category, an author. `each` names where those values come from, with any other `$paths` shape, and the list is paged once per value. In `pages/tags/[tag]/[...page].json`:

```json
{
  "$paths": {
    "each": { "contentType": "tags", "param": "tag" },
    "paginate": { "$ref": "#/state/posts" },
    "pageSize": 10
  },
  "state": {
    "posts": {
      "$prototype": "ContentCollection",
      "contentType": "blog",
      "filter": [{ "field": "tags", "op": "contains", "value": { "$ref": "#/$params/tag" } }],
      "sort": [{ "field": "date", "order": "desc" }]
    }
  }
}
```

This builds `/tags/news`, `/tags/news/2` and so on for every tag. The list is resolved once per tag with that tag among the route's parameters, which is what the filter's `#/$params/tag` reads. Only the paged entry is resolved there, so its filter can read route parameters but not the page's other state.

A mistake in a paged source fails the build, naming the page, and that page builds nothing while the rest of the site builds: a `paginate` that does not point at `#/state/<key>`, a `pageSize` that is not a whole number above zero, an `each` that is not a `$paths` shape (or is itself paged), a route that does not leave exactly one parameter for the page number, a state entry the page does not declare, and an entry that is not a list. In the sitemap every page of a list is dated by its newest item, since one new post can move every page.

:::doc-note
Studio's **resolving with** popover does not list page numbers yet, and its canvas shows the whole list on a paged page. The build pages it as described.
:::

## Route priority

When several routes could match the same URL, the more specific one wins:

1. Static routes beat dynamic routes: `/about` beats `/[slug]`.
2. Named parameters beat catch-alls: `/blog/[slug]` beats `/blog/[...path]`.
3. More specific paths beat less specific ones: `/blog/[slug]` beats `/[...path]`.

## Params at runtime

Inside a dynamic page, the current route's parameters are addressable as `#/$params/<name>`. The usual pattern binds a parameter into a `ContentEntry` id, as in the example above:

```json
{ "id": { "$ref": "#/$params/slug" } }
```

Each generated page resolves the reference to its own concrete value, so `/blog/hello-world` sees `slug` as `"hello-world"`. The compiler also injects a read-only `$page` state entry carrying `params`, `title`, and `url` (and `pagination` on a [paged list](#paging-a-list)), alongside the site-level `$site` context (see [project.json](/docs/framework/site/project-json)). In static builds all of this resolves at compile time; nothing route-related ships to the browser.

:::doc-tip
In Studio, opening a dynamic page puts a picker per parameter in the context bar's **resolving with** popover, so the canvas previews a real entry instead of a placeholder.
:::

## Related

- [Content collections](/docs/framework/site/content-collections): the entries that drive `$paths`
- [Layouts](/docs/framework/site/layouts): the shells dynamic pages render into
- [Deployment](/docs/framework/site/deployment): how generated routes are served
