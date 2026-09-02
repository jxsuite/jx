---
title: "Props and scope"
description: "How state crosses component boundaries in Jx: explicit $props, signal forwarding, scope isolation, and the resolution order."
spec:
  - spec.md#13
  - spec.md#15
  - spec.md#16.5
code:
  - packages/runtime/src/runtime.ts
---

# Props and scope

> **Studio writes this format for you.** Editing an instance's props in the Inspector's **Content** tab (see [Working with components](/docs/studio/design/components)) writes the `$props` objects on this page.

Scope is where a name can be seen. Within one document, every `state` entry is visible to every descendant element, with no passing required. Across a component boundary, nothing is visible unless it is passed explicitly through `$props`. That single rule makes data flow statically knowable: you can read a file and see exactly what it depends on.

```json
{
  "tagName": "my-card",
  "$props": {
    "title": "Static string",
    "count": { "$ref": "#/state/count" }
  }
}
```

## Component instances

A component instance is created in two steps: **register** the component document under a custom-element tag in the top-level `$elements` map, then place an element node with that tag. `$props` is optional, and an instance without it renders the component with its own defaults:

```json
{
  "$elements": {
    "my-counter": { "$ref": "./components/my-counter.json" },
    "my-card": { "$ref": "./components/card.json" }
  },
  "children": [
    { "tagName": "my-counter" },
    {
      "tagName": "my-card",
      "$props": {
        "title": "Hello",
        "count": { "$ref": "#/state/count" }
      }
    }
  ]
}
```

:::doc-note
A bare `{ "$ref": "./card.json" }` placed directly in `children` is **not** a component instance; it renders an empty `<div>`. Register the document in `$elements` and instantiate it by its tag, as above. See spec §13.
:::

## Static and bound props

A prop value is either a plain JSON value (fixed for this instance) or a `$ref` (bound to the parent's state). Functions pass the same way, so a child can trigger behavior the parent owns:

```json
{
  "tagName": "my-card",
  "$props": {
    "title": "Static string",
    "count": { "$ref": "#/state/count" },
    "onAction": { "$ref": "#/state/handleAction" }
  }
}
```

Inside `card.json`, `title` and `count` behave like the component's own state entries, typically declared there with defaults and overridden per instance.

## Signal forwarding

When a `$props` value is a `$ref` to a reactive state entry, the child receives the **same reactive reference**, not a copy. A write in either scope triggers updates in both, so parent and child stay in sync through one shared signal. A plain value, by contrast, is just an initial setting for that instance.

## Scope levels

| Level      | Scope                   | Mirrors                   |
| ---------- | ----------------------- | ------------------------- |
| `window`   | Application-wide        | `window` global           |
| `document` | Document-wide           | `document` object         |
| Component  | Custom element boundary | CSS custom property scope |

Globals are reachable from any component via the `window#/` and `document#/` [reference schemes](/docs/framework/concepts/references); everything else is bounded at the component.

## Resolution order

When a name is looked up, scopes are consulted in order:

1. `$map/` context, the enclosing [repeater](/docs/framework/concepts/lists) iteration
2. Local component `state`
3. Explicitly passed `$props`
4. `window` globals
5. `document` globals

## Attribute props

A component that lists an entry in `observedAttributes` can also be given that prop from markup, which is how a component reached from plain HTML or from another framework gets its values:

```json
{
  "tagName": "my-card",
  "observedAttributes": ["title", "count", "featured"],
  "state": {
    "title": { "type": "string", "default": "Untitled", "attribute": "title" },
    "count": { "type": "number", "default": 1, "attribute": "count" },
    "featured": { "type": "boolean", "default": false, "attribute": "featured" }
  }
}
```

An attribute is text, so it is coerced by the entry's type on the way in: a `string` is taken as written, a `number` goes through `Number()`, and a `boolean` is read by presence, where the literal text `false` counts as absent. An attribute already on the element when it connects is read before `$props` are merged, so a property a parent set still wins.

**Removing an attribute restores the entry's declared default**, rather than leaving the prop holding nothing:

```html
<my-card title="Hello" count="7"></my-card>
<!-- After removeAttribute("count"): count is 1, its declared default, not 0 -->
```

That is what makes a numeric prop able to say "unset". A component whose entry is declared in the shorthand form (`"title": "Untitled"`) has that literal as its default; a computed entry, one written with `$expression`, `$prototype`, `$ref` or `$src`, has no default and a removal leaves it alone.

:::doc-tip
Give any prop you expect a host to clear a `default` you would be happy to see. It is the value the prop returns to, and it is the value a reader gets after any code path removes the attribute.
:::

## How it works

Each component builds its own reactive scope from its own `state`. When the runtime renders an instance, it resolves each `$props` entry against the **parent's** scope, then layers the results onto the child's scope: plain values as initial settings, `$ref` values as live references into the parent's reactive state. Nothing else crosses over: a template string or `$ref` inside the child can only see the child's scope plus what was passed.

## Rules

- `$props` is the only mechanism for passing state across a component boundary. Scope never leaks implicitly.
- Within a single component, all `state` entries are available to all descendant elements without passing.
- Signal scope is bounded at the component (custom element) level, like a CSS custom property.
- Private `#`-prefixed state entries can never be set via `$props`.
- A `$ref` prop is live in both directions; a plain value is per-instance and static.
- Every external dependency must appear in `$props`, which is what makes documents statically analyzable.

## Related

- [Components](/docs/framework/concepts/components): the component model and custom elements
- [State](/docs/framework/concepts/state): declaring the entries props override
- [References](/docs/framework/concepts/references): `parent#/`, `window#/`, `document#/` schemes
- [Dynamic switching](/docs/framework/concepts/switching): swapping whole components on state
- [Working with components](/docs/studio/design/components): the Studio props workflow
