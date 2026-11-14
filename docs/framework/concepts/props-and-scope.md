---
title: "Props and scope"
description: "How state crosses component boundaries in Jx: explicit $props, signal forwarding, scope isolation, and the resolution order."
spec:
  - spec.md#13
  - spec.md#15
  - spec.md#16.2
  - spec.md#16.5
code:
  - packages/runtime/src/runtime.ts
  - packages/runtime/src/expression.ts
  - packages/compiler/src/targets/compile-element.ts
  - packages/compiler/src/shared.ts
---

# Props and scope

> **Studio writes this format for you.** Editing an instance's props in the Inspector's **Content** view (see [Working with components](/docs/studio/design/components)) writes the `$props` objects on this page.

Scope is where a name can be seen. Within one document, every `state` entry is visible to every descendant element, with no passing required. Across a component boundary, no state is visible unless it is passed explicitly through `$props`. The one exception is not state at all: a component can call its project's [formulas](#project-formulas). That single rule makes data flow statically knowable: you can read a file and see exactly what it depends on.

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

## Setting props from script

A component's props are also its JavaScript properties. Setting `card.count = 5` on an instance sets the component's `count`, before or after the element is on the page, and re-renders it once it is there, in Studio and in a built site alike. When one component renders another, the props it binds arrive the same way, so a change in the parent reaches the child.

A prop is accepted for every entry the component's `state` declares, including one declared with only a `type`. Private `#`-prefixed entries are not props and have no property.

A prop may share its name with a built-in element property such as `title`, `lang` or `hidden`. Setting it still updates the component, including a value that arrives after the element is on the page, and the matching HTML attribute is set as well.

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

## Project formulas

A [named formula](/docs/framework/concepts/expressions#named-formulas-and-call) is a function, not a value, so it is the one thing a component gets from its project without being passed it. Declare `formatDate` once in the project file's `state` and a template inside any component of that project can call it:

```json
{
  "tagName": "post-date",
  "state": { "date": "" },
  "children": [
    {
      "tagName": "time",
      "textContent": "${state.formatDate(state.date, {\"dateStyle\":\"long\"})}"
    }
  ]
}
```

What crosses is deliberately narrow:

- **Only pure formulas that read no project data.** The entry has `parameters`, an `$expression` that changes nothing, and reads only its arguments, globals and other inherited formulas. A formula that reads a project value such as `state.currency` stays on the page side, together with anything that calls it. Pass the value as a parameter and it crosses.
- **Never data.** Project values, `$site` and `$page` are still invisible inside a component. A formula that formats in the page's language therefore uses the default language inside a component, unless the component is passed the language as a prop and hands it on as an argument.
- **The component's own names win.** A `state` entry or a prop with the same name as a project formula replaces it for that component.
- **From the project, not from the page.** State declared on a page or a layout never reaches a component, so a component renders the same on every page.

A component used outside a project inherits nothing. If you publish a component for other projects, copy the formulas it calls into its own `state`. That copy also wins over the project's, so the component behaves the same wherever it lands.

In a built site each component's module carries the formulas that component calls, and a static component that calls one is still plain HTML (see [How compilation works](/docs/framework/build#static-detection)).

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

An attribute is text, so it is coerced by the entry's type on the way in: a `string` is taken as written, a `number` goes through `Number()`, and a `boolean` is read by presence, where the literal text `false` counts as absent. An entry declared with only a `type` holds nothing until the attribute arrives, so it takes the text as written. An attribute already on the element when it connects is read before `$props` are merged, so a property a parent set still wins.

**Removing an attribute restores the entry's declared default**, rather than leaving the prop holding nothing:

```html
<my-card title="Hello" count="7"></my-card>
<!-- After removeAttribute("count"): count is 1, its declared default, not 0 -->
```

That is what makes a numeric prop able to say "unset". A component whose entry is declared in the shorthand form (`"title": "Untitled"`) has that literal as its default; a computed entry, one written with `$expression`, `$prototype`, `$ref`, `$src` or as a template string, has no default, and the attribute never writes a computed entry at all. An entry declared with only a `type` has no default either, and a removal clears it to the empty string.

A built site does the same: the prerendered page already shows the attribute's value, and a component that declares `observedAttributes` ships its script so a later change is heard.

:::doc-tip
Give any prop you expect a host to clear a `default` you would be happy to see. It is the value the prop returns to, and it is the value a reader gets after any code path removes the attribute.
:::

## How it works

Each component builds its own reactive scope from its own `state`. When the runtime renders an instance, it resolves each `$props` entry against the **parent's** scope, then layers the results onto the child's scope: plain values as initial settings, `$ref` values as live references into the parent's reactive state. Nothing else crosses over: a template string or `$ref` inside the child can only see the child's scope plus what was passed. In a project, that scope starts with the project's pure formulas, underneath the component's own entries.

## Rules

- `$props` is the only mechanism for passing state across a component boundary. Scope never leaks implicitly.
- A project's pure named formulas are functions, not state, and every component of the project can call them.
- Within a single component, all `state` entries are available to all descendant elements without passing.
- Signal scope is bounded at the component (custom element) level, like a CSS custom property.
- Private `#`-prefixed state entries can never be set via `$props`.
- A `$ref` prop is live in both directions; a plain value is per-instance and static.
- Every external data dependency must appear in `$props`, which is what makes documents statically analyzable.

## Related

- [Components](/docs/framework/concepts/components): the component model and custom elements
- [State](/docs/framework/concepts/state): declaring the entries props override
- [References](/docs/framework/concepts/references): `parent#/`, `window#/`, `document#/` schemes
- [Dynamic switching](/docs/framework/concepts/switching): swapping whole components on state
- [Working with components](/docs/studio/design/components): the Studio props workflow
