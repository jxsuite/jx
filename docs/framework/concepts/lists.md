---
title: "Lists and iteration"
description: "Repeating elements from data in Jx: the Array pseudo-element, its items and map, the $map iteration context, and filtering and sorting."
spec:
  - spec.md#10
  - spec.md#10.2 # iteration context, including state.$map from a handler
  - spec.md#10.3 # filter then sort, and how each is called
  - spec.md#10.4 # keys
  - spec.md#10.5 # empty lists at build time
  - compiler.md#8.1 # an empty expansion collapses only when the build resolved the list; a component's repeater prerenders its rows
code:
  - packages/compiler/src/targets/compile-element.ts
  - packages/compiler/src/targets/compile-client.ts
  - packages/compiler/src/site/site-build.ts
  - packages/compiler/src/shared.ts
---

# Lists and iteration

> **Studio writes this format for you.** Converting an element with **Repeat…** and binding its data source ([Repeaters](/docs/studio/design/repeaters)) writes the Array pseudo-elements on this page.

A dynamic list is an **Array pseudo-element**: an object with `$prototype: "Array"` sitting inside a `children` array. It names the data (`items`) and a template (`map`) rendered once per item. The list re-renders automatically whenever the data changes.

```json
{
  "tagName": "ul",
  "children": [
    {
      "$prototype": "Array",
      "items": { "$ref": "#/state/todoList" },
      "map": { "tagName": "li", "textContent": { "$ref": "$map/item" } }
    }
  ]
}
```

## The iteration context

Inside the `map` template, the `$map/` [reference scheme](/docs/framework/concepts/references) reads the current iteration:

| Reference                  | Resolves to                          |
| -------------------------- | ------------------------------------ |
| `{ "$ref": "$map/item" }`  | The current array item               |
| `{ "$ref": "$map/index" }` | The current zero-based integer index |

Deeper paths reach into item fields, as in `"$map/item/title"`, and template strings inside the template can read the same context as `${$map.item.title}` or `${$map.index}`:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/posts" },
  "map": {
    "tagName": "article",
    "children": [{ "tagName": "h2", "textContent": { "$ref": "$map/item/title" } }]
  }
}
```

The `map` template is an ordinary element def, so `attributes`, `id`, `className`, `style`, and event handlers all work there and can read the iteration context, which is how a list row gets a per-item link or a selected state:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/posts" },
  "map": {
    "tagName": "a",
    "id": "post-${index}",
    "attributes": {
      "href": "${item.url}",
      "class": "row ${index === state.active ? 'is-active' : ''}"
    },
    "textContent": "${item.title}"
  }
}
```

## Mixing with sibling elements

The Array object is a _member_ of `children`, so it can sit among ordinary siblings, such as a static header row followed by a dynamic list. It renders **wrapper-less**: mapped items become direct children of the parent element, with no container in between.

```json
{
  "tagName": "ul",
  "children": [
    { "tagName": "li", "textContent": "Header" },
    {
      "$prototype": "Array",
      "items": { "$ref": "#/state/todoList" },
      "map": { "tagName": "li", "textContent": { "$ref": "$map/item" } }
    }
  ]
}
```

## Reading the row from a handler

One handler serves every row. Which row invoked it is on state as `state.$map`, with `item` and `index`:

```json
{
  "state": {
    "toggle": {
      "$prototype": "Function",
      "body": "state.items[state.$map.index].done = !state.items[state.$map.index].done"
    }
  },
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/state/items" },
    "map": {
      "tagName": "li",
      "children": [{ "tagName": "input", "onclick": { "$ref": "#/state/toggle" } }]
    }
  }
}
```

This works on the map body and on any descendant of it. A nested list shadows the outer context for handlers inside it.

## Passing a row to a component

`$props` on the map body hands each item's data to a component. Template values are bindings, so they read the current row:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/posts" },
  "map": {
    "tagName": "post-card",
    "$props": { "title": "${$map.item.title}", "index": { "$ref": "$map/index" } }
  }
}
```

## Setting a property on each row

Properties that live on the DOM element rather than in markup (`value`, `checked`, `selected`, `disabled`) go directly on the map body, the same as anywhere else. They may interpolate `$map`:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/rows" },
  "map": {
    "tagName": "option",
    "value": "${$map.item.id}",
    "textContent": "${$map.item.label}"
  }
}
```

Each `<option>` gets its row's `id` as its value, so a `change` handler reads the key rather than the label shown on screen. Put it in `attributes` instead and you get an HTML attribute, which for `value` sets only the _default_, and the two diverge as soon as the user interacts.

## Filtering and sorting

`filter` and `sort` reference [functions](/docs/framework/concepts/functions) declared in `state`. The filter is called with each item (then its index) and returns true to keep it. The sort is called with two items and returns a number, like a standard comparator. The list renders the items filtered first, then sorted:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/allItems" },
  "filter": { "$ref": "#/state/isVisible" },
  "sort": { "$ref": "#/state/byRank" },
  "map": { "tagName": "list-item", "item": { "$ref": "$map/item" } }
}
```

Write both as [named formulas](/docs/framework/concepts/expressions), which take those arguments on the parameters they declare. That form is called the same way in Studio and in a built site:

```json
{
  "state": {
    "isVisible": {
      "parameters": ["item"],
      "$expression": { "operator": "!", "target": { "$ref": "$args/item/hidden" } }
    },
    "byRank": {
      "parameters": ["a", "b"],
      "$expression": {
        "operator": "-",
        "target": { "$ref": "$args/a/rank" },
        "value": { "$ref": "$args/b/rank" }
      }
    }
  }
}
```

Filtering and sorting never mutate the source array. Whatever the filter or the sort reads is a dependency of the list, so a row appears when the field its filter reads changes.

## Keeping rows across changes

Give the list a `key` when people interact with its rows. The key is a `$map/item` pointer that names what makes each row itself. It may also be written `#/$map/item/id`.

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/tasks" },
  "key": { "$ref": "$map/item/id" },
  "map": { "tagName": "li", "textContent": "${$map.item.title}" }
}
```

A keyed row keeps its element when the list changes. Reordering moves the element, inserting creates only the new rows, and removing tears down only the removed ones. Focus, scroll position, an open `<details>` and a half-typed value all survive. The `$map.index` of a row that moved updates in place. A built site keeps rows the same way.

Use `{ "$ref": "$map/item" }` to key by the item itself, which works for objects and for primitive values. A key that is missing on an item falls back to that item's position, and the runtime warns once. Two rows with the same key also warn once; the second and later rows are rebuilt on every change.

Without a key, rows are matched by position. That is fine for a list that only grows at the end, and wrong for one that reorders or inserts in the middle, because the element at each position is reused for whatever item lands there.

## Empty lists

An empty list renders nothing: no rows and no wrapper. What a [build](/docs/framework/build) leaves behind depends on where the data comes from.

- **Data the build resolved** is final. A content collection or any other `timing: "compiler"` entry, the slice of a paged route, `$site` and `$page`, a `$map/` pointer inside a row the build expanded, and a literal array are all finished when the build ends. An empty one is removed from the page with its binding, so the page stays as static as it would be with rows.
- **Client state** is a starting value. A list over `{ "rows": { "default": [] } }`, over an entry a handler writes, or over a `Request` keeps its binding, and the rows appear when the data does. On a page, a list that reads an entry a handler writes is always left for the browser to render, even when it starts with rows, because a list written into the page could never change.

So a page that lists "related posts" from a collection ships no JavaScript for the list on the pages where there are none.

## How it works

The runtime places an invisible anchor where the Array object sits, then renders the mapped items inline ahead of it. When `items` (or a filter or sort dependency) changes, the rows are reconciled: a row whose key survives keeps its node, and only new rows are created and only removed rows are torn down. Several changes made together, such as an in-place `reverse()`, are batched into one pass on the next microtask. Each item's template renders in a child scope carrying `$map`, and the surrounding document's `state` remains fully visible inside the template.

On a built site, a list inside a component is in the page's HTML before any script runs. The build renders one row for each item the list starts with, in the component's own scope, so a navigation menu kept as a data table reaches crawlers as links. The component's module then draws the same rows when it loads and keeps them current. A `filter` and a `sort` are applied at build time too, so the rows in the page are the rows the component shows first. A list renders no rows at build time, and fills in when the module runs, when its `items`, `filter` or `sort` exists only in the browser (a `Request`, say). A component whose only list is over a literal array, with no `filter`, `sort` or `key`, never changes, so it ships no JavaScript for the list at all.

## Rules

- The Array object must have `$prototype: "Array"`, an `items` source, and a `map` template.
- `items` must resolve to an array: a state entry, a [data prototype](/docs/framework/concepts/data-prototypes) such as a content collection, or a literal array.
- The list renders wrapper-less; give structure a container by making the _parent_ the container element (`ul`, `tbody`, a grid `div`).
- `$map/` references are valid only inside the `map` template.
- `items` is a `$ref` or a literal array. A template string there is a build error.
- `filter` and `sort` must be `$ref`s to callable state entries. A named formula is called the same way everywhere.
- The legacy form where `children` is _itself_ the Array object is still accepted; Studio normalizes it to a single array member on load.

## Related

- [References](/docs/framework/concepts/references): the `$map/` scheme and resolution order
- [State](/docs/framework/concepts/state): declaring the arrays lists iterate
- [Data prototypes](/docs/framework/concepts/data-prototypes): collections and requests as `items` sources
- [Content collections](/docs/framework/site/content-collections): site content as list data
- [Repeaters](/docs/studio/design/repeaters): the Studio surface that writes this format
