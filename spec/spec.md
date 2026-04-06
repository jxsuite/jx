# JSONsx Specification
## Declarative Document Object Model — JSON Edition

**Version:** 1.0.0-draft
**Status:** In Progress
**License:** MIT

---

## Table of Contents

1. [Overview](#1-overview)
2. [Philosophy](#2-philosophy)
3. [Document Format](#3-document-format)
4. [The Component Model](#4-the-component-model)
5. [The `$defs` Grammar](#5-the-defs-grammar)
6. [Universal Reactivity](#6-universal-reactivity)
7. [Reference System](#7-reference-system)
8. [Element Definitions](#8-element-definitions)
9. [Styling](#9-styling)
10. [Dynamic Mapped Arrays](#10-dynamic-mapped-arrays)
11. [Web API Namespaces](#11-web-api-namespaces)
12. [External Class Integration](#12-external-class-integration)
13. [Component Encapsulation](#13-component-encapsulation)
14. [Dynamic Component Switching](#14-dynamic-component-switching)
15. [Scope Rules](#15-scope-rules)
16. [Compilation Model](#16-compilation-model)
17. [Runtime Pipeline](#17-runtime-pipeline)
18. [Reserved Keywords](#18-reserved-keywords)
19. [Standards Alignment](#19-standards-alignment)

---

## 1. Overview

JSONsx is a schema and runtime for building reactive web applications using plain JSON. A JSONsx application is a tree of JSON objects whose structure mirrors the DOM API, whose reactivity is powered by `@vue/reactivity`, and whose behavior is declared in `$defs` entries as inline functions or external module references.

The core premise: **structure and state are data; the shape of each `$defs` entry determines its type and behavior — no additional flags required in the common case.**

A JSONsx component is a single `.json` file that can be fully self-describing:

```
component.json   ← structure, styling, signal declarations, functions, bindings
```

When handler functions grow complex, they may be extracted to an external `.js` sidecar referenced via `$src` on individual `$prototype: "Function"` entries. This is optional — simple components need no sidecar.

The JSON file is fully serializable, statically analyzable, and visual-builder-friendly.

---

## 2. Philosophy

### 2.1 DOM-First Design

JSONsx property names mirror standard DOM element properties. `tagName`, `className`, `textContent`, `hidden`, `tabIndex` — all map directly to their DOM equivalents. This makes the schema self-documenting to any web developer and reduces the surface area of novel concepts to learn.

### 2.2 Rule of Least Power

Following [Tim Berners-Lee's Rule of Least Power](https://www.w3.org/DesignIssues/Principles.html#PLP): given a choice of solutions, use the least powerful one capable of solving the problem.

- Declarative JSON over imperative JavaScript wherever possible
- `$ref` bindings over template expressions wherever possible
- Template expressions over handler functions wherever possible
- Handler functions only when logic cannot be expressed otherwise

### 2.3 JSON as the Authoritative Format

JSONsx documents are valid JSON. They are not JavaScript object literals, not JSX, not a template DSL. This distinction is intentional and load-bearing:

- JSON is fully serializable and deserializable without code execution
- JSON has no `this` ambiguity — self-references use explicit `$ref` pointers
- JSON is natively understood by visual builders, IDEs, validators, and bundlers
- JSON Schema tooling (validation, autocomplete, LSP) applies directly

### 2.4 Explicit Over Implicit

Signal scope does not leak across component boundaries. Every dependency a component has on external state must be explicitly declared as a `$prop`. This makes data flow statically knowable — a requirement for both the compiler and visual builder tooling.

Within a single component, signals declared in `$defs` are available to all descendant elements of that component without explicit passing.

### 2.5 Standards Alignment

Where a web platform standard exists, JSONsx follows it:

| JSONsx Feature | Platform Precedent |
|---|---|
| `$ref` for references | JSON Reference / JSON Pointer (RFC 6901) |
| `$defs` for declarations | JSON Schema 2020-12 |
| Signal scope at component boundary | CSS Custom Properties scope |
| Explicit props at element boundary | HTML attributes on Custom Elements |
| `.json` / `.js` file pairs | HTML / JS, CSS Modules / JS |
| `$prototype` namespaces | Web API constructor names |

---

## 3. Document Format

### 3.1 Root Structure

Every JSONsx document is a JSON object with the following top-level fields:

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "ComponentName",
  "$defs": { },
  "tagName": "my-component",
  "children": [ ]
}
```

| Field | Required | Description |
|---|---|---|
| `$schema` | Recommended | URI identifying the JSONsx dialect version |
| `$id` | Recommended | Component identifier, used by tooling |
| `$defs` | Optional | Signal, function, type, and data source declarations |
| `tagName` | Required | HTML tag name for the root element |
| `children` | Optional | Array of child element definitions, or Array namespace |

### 3.2 JSON Schema Dialect

JSONsx is a JSON Schema dialect. Documents may be validated against the JSONsx meta-schema using any JSON Schema 2020-12 compatible validator. The `$schema` URI identifies the dialect version and enables schema-aware tooling.

JSONsx extends the base JSON Schema vocabulary with the following reserved keywords: `$prototype`, `$props`, `$switch`, `$map`, `$src`, `$export`, `signal`, `timing`, `default`, `body`, `arguments`, `name`.

Standard JSON Schema 2020-12 keywords (`type`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `description`, `examples`, etc.) are inherited from the JSON Schema vocabulary and are valid on any `$defs` entry that is a signal or type definition.

---

## 4. The Component Model

### 4.1 Self-Describing Components

A JSONsx component is a single `.json` file. All state, computed values, and functions are declared in `$defs`. Simple components are fully self-describing — no sidecar file required:

```json
{
  "$id": "Counter",
  "$defs": {
    "count": 0,
    "increment": { "$prototype": "Function", "body": "$defs.count++" }
  },
  "tagName": "my-counter",
  "children": [
    { "tagName": "span", "textContent": "${$defs.count}" },
    { "tagName": "button", "textContent": "+", "onclick": { "$ref": "#/$defs/increment" } }
  ]
}
```

### 4.2 External Function Sidecar

When handler functions grow complex, they may be extracted to a `.js` sidecar file. Each function entry declares its own `$src`:

```json
{
  "$defs": {
    "increment": { "$prototype": "Function", "$src": "./counter.js" },
    "decrement": { "$prototype": "Function", "$src": "./counter.js" }
  }
}
```

The `.js` file exports each function as a named export. The first parameter is always `$defs` — the component's reactive scope object:

```js
export function increment($defs) { $defs.count++ }
export function decrement($defs) { $defs.count = Math.max(0, $defs.count - 1) }
```

When multiple Function entries share a `$src`, the runtime imports the module once and extracts named exports. Module caching is automatic.

### 4.3 Handler Binding

At runtime, function exports are called with `$defs` as their first argument. `$defs` is the component's reactive scope object — a `reactive()` proxy of all declared signals and functions. Inside a handler, state is read and written directly:

```js
export function increment($defs) {
  $defs.count++
}
export function handleInput($defs, event) {
  $defs.name = event.target.value
}
```

`this` is never used in JSONsx-managed code. All component state is accessed via `$defs`.

---

## 5. The `$defs` Grammar

Every entry in `$defs` falls into exactly one of five shapes, determinable by inspection alone.

### 5.1 Shape 1 — Naked Value Signal

**Identified by:** a JSON scalar (number, string without `${}`, boolean, null), array, or plain object with no JSONsx reserved keys.

```json
{
  "$defs": {
    "count":   0,
    "price":   9.99,
    "name":    "World",
    "active":  false,
    "data":    null,
    "tags":    [],
    "user":    { "id": null, "name": "", "role": "guest" }
  }
}
```

**Emitted as:** `Signal.State(value)`

**Type inference:** The compiler infers the JSON Schema type from the value:

| JSON value | Inferred type |
|---|---|
| `0`, `1`, `3.14` | `number` |
| `"hello"` | `string` |
| `true` / `false` | `boolean` |
| `null` | `null` |
| `[]` | `array` |
| `{}` | `object` |

**Rules:**
- A plain string without `${}` is a string state signal initialized to that string value
- A plain object with no `$prototype`, no `type`, no `default`, and no `properties` is an object state signal
- `signal: true` must not be declared — it is implied. Doing so is a compile error.

### 5.2 Shape 2 — Expanded Signal (JSON Schema)

**Identified by:** an object with a `default` property and no `$prototype`.

```json
{
  "$defs": {
    "count": {
      "type": "integer",
      "default": 0,
      "minimum": 0,
      "maximum": 100,
      "description": "Current counter value"
    },
    "status": {
      "type": "string",
      "default": "idle",
      "enum": ["idle", "loading", "success", "error"]
    }
  }
}
```

**Emitted as:** `Signal.State(default)`

**Rules:**
- The `default` keyword is the required discriminator — its value is the signal's initial state
- All JSON Schema 2020-12 keywords are valid: `type`, `properties`, `items`, `enum`, `minimum`, `maximum`, etc.
- Schema keywords are tooling-only — they power LSP validation and TypeScript declaration generation. Stripped before runtime emission.
- `signal: true` must not be declared — it is implied by `default`. Doing so is a compile error.

**Use the expanded form when** the value needs type constraints, documentation, or references a shared type via `$ref`. **Use the naked form (Shape 1) when none apply.**

### 5.3 Shape 2b — Pure Type Definition

**Identified by:** an object with JSON Schema keywords (`type`, `properties`, `items`, etc.) but **no** `default` and **no** `$prototype`.

```json
{
  "$defs": {
    "TodoItem": {
      "type": "object",
      "properties": {
        "id":   { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    }
  }
}
```

**Emitted as:** nothing — no signal, no function, no runtime artifact.

Pure type definitions exist solely for tooling. They are reusable subschemas referenced by other `$defs` entries via `$ref`. **Naming convention:** `PascalCase` without a `$` prefix.

### 5.4 Shape 3 — Computed Signal (Template String)

**Identified by:** a JSON string value containing `${}` syntax.

```json
{
  "$defs": {
    "fullName":     "${$defs.firstName} ${$defs.lastName}",
    "displayTitle": "${$defs.score >= 90 ? 'Expert' : 'Beginner'}",
    "scoreLabel":   "${$defs.score}%",
    "isEmpty":      "${$defs.items.length === 0}"
  }
}
```

**Emitted as:** `computed(() => \`...template...\`)`

**Rules:**
- `signal: true` is implied — must not be declared
- `$deps` is never declared — dependencies are tracked automatically by Vue when `$defs.*` properties are read during evaluation
- The string must be a pure expression — no statements, no assignments, no semicolons
- `return` is never written — the expression value is the signal value
- `$defs` refers exclusively to the current component's reactive scope

### 5.5 Shape 4 — Function (Inline or External)

**Identified by:** object with `$prototype: "Function"`.

Functions serve two roles:
- **Handler** — void function called in response to events
- **Computed with logic** — function returning a value, wrapped in `Signal.Computed` when `signal: true`

#### 5.5a — Inline handler

```json
"increment": {
  "$prototype": "Function",
  "body": "$defs.count++"
},
"handleInput": {
  "$prototype": "Function",
  "arguments": ["event"],
  "body": "$defs.value = event.target.value"
}
```

#### 5.5b — Inline computed function

```json
"titleClass": {
  "$prototype": "Function",
  "body": "return $defs.score >= 90 ? 'gold' : 'silver'",
  "signal": true
}
```

`signal: true` here wraps the function in `Signal.Computed`. Required when the function should produce a reactive derived value.

#### 5.5c — External function

```json
"addItem": {
  "$prototype": "Function",
  "$src": "./handlers/items.js"
},
"validateEmail": {
  "$prototype": "Function",
  "$src": "npm:@myorg/validators",
  "$export": "validateEmail"
}
```

#### 5.5d — Properties

| Property | Required | Description |
|---|---|---|
| `$prototype` | Yes | Must be `"Function"` |
| `body` | If no `$src` | Raw function body string |
| `arguments` | No | Array of parameter name strings. Default: `[]` |
| `name` | No | Explicit function name. Default: the `$defs` key name |
| `$src` | If no `body` | External module specifier |
| `$export` | No | Named export in `$src` module. Default: `$defs` key name |
| `signal` | No | When `true`, wraps in `Signal.Computed`. Default: `false` |
| `description` | No | Documentation string |

`body` and `$src` are mutually exclusive. Declaring both is a compile-time error.

### 5.6 Shape 5 — External Class (Data Source)

**Identified by:** object with `$prototype` set to any value **other than** `"Function"`.

```json
{
  "$defs": {
    "userData": {
      "$prototype": "Request",
      "url": "/api/user",
      "signal": true
    },
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "signal": true
    }
  }
}
```

`signal: true` on external class entries is meaningful — when present, the resolved value is wrapped in a reactive signal. This is one of two remaining places where `signal: true` is an active flag (the other being Shape 4 computed functions).

### 5.7 `signal: true` Semantics

| Shape | `signal: true` | Behaviour |
|---|---|---|
| Naked value | Forbidden — compile error | Implied |
| Expanded JSON Schema with `default` | Forbidden — compile error | Implied |
| Template string | Forbidden — compile error | Implied |
| `$prototype: "Function"` (handler) | Forbidden — compile error | Not applicable |
| `$prototype: "Function"` (computed) | **Required to opt in** | Wraps in `computed()` |
| `$prototype: "ClassName"` | **Optional** | Wraps resolved value in `ref()` |

### 5.8 Naming Convention

Signal entries in `$defs` use plain camelCase names without a `$` prefix (e.g. `count`, `items`, `firstName`). Since all signals are namespaced under `$defs`, a `$` prefix on individual names is redundant. Function entries and type definitions also use plain camelCase (e.g. `increment`, `TodoItem`).

### 5.9 Signal Access in JavaScript

Within function `body` strings and external `.js` files, signals are read and written directly on the `$defs` reactive proxy — no `.get()` or `.set()` calls:

```js
// Read
const current = $defs.count

// Write
$defs.count = current + 1

// Mutate array in place (Vue tracks array mutations)
$defs.items.push(newItem)
$defs.items.splice(0, 1)

// Mutate nested object (Vue tracks nested reads and writes)
$defs.user.name = 'Alice'
```

### 5.10 Shape Detection Algorithm

```
For each entry in $defs:

1. Value is a string?
   a. Contains "${" → Shape 3: Computed signal (computed())
   b. No "${" → Shape 1: String state signal (reactive property)

2. Value is a number, boolean, or null?
   → Shape 1: Naked state signal (reactive property)

3. Value is an array?
   → Shape 1: Array state signal (reactive property)

4. Value is an object?
   a. Has "$prototype: Function" → Shape 4: Function
   b. Has "$prototype: <other>" → Shape 5: External class
   c. Has "default" (no $prototype) → Shape 2: Expanded signal (reactive property)
   d. Has JSON Schema keywords, no "default", no "$prototype"
      → Shape 2b: Pure type definition (tooling only, no emission)
   e. No reserved keys → Shape 1: Object state signal (reactive property)
```

---

## 6. Universal Reactivity

Template literal syntax `${}` is valid **anywhere a string value appears in the document tree** — not only in `$defs`.

### 6.1 Reactive element properties

```json
{
  "tagName": "div",
  "textContent": "${$defs.count} items remaining",
  "className":   "${$defs.active ? 'card active' : 'card'}",
  "hidden":      "${$defs.items.length === 0}"
}
```

### 6.2 Reactive style properties

```json
{
  "tagName": "div",
  "style": {
    "color":   "${$defs.score > 90 ? 'gold' : 'inherit'}",
    "opacity": "${$defs.loading ? '0.5' : '1'}"
  }
}
```

### 6.3 Reactive attributes

```json
{
  "tagName": "button",
  "attributes": {
    "aria-label": "${$defs.count} unread messages",
    "data-state": "${$defs.status}"
  }
}
```

### 6.4 Compilation

When the compiler encounters `${}` in any string-valued property, it wraps the binding in a reactive effect:

```js
watchEffect(() => {
  el.textContent = `${$defs.count} items remaining`;
});
```

### 6.5 Relationship to `$ref`

| Pattern | Use when |
|---|---|
| `{ "$ref": "#/$defs/$label" }` | Binding to a named signal — referenced in multiple places |
| `"${this.$count.get()} items"` | Inline computed binding used in exactly one place |

Prefer `${}` for single-use reactive bindings. Prefer `$ref` for reused or named signals.

### 6.6 Scope

Template strings anywhere in a component's document tree have access only to that component's `$defs` signals via `$defs.signalName`. The `$defs` scope is always the current component's reactive proxy.

---

## 7. Reference System

### 7.1 `$ref` Syntax

JSONsx uses `$ref` to express bindings between properties and declared signals, following the JSON Reference convention. A `$ref` value is a URI string:

```json
{ "$ref": "#/$defs/count" }
```

### 7.2 Reference Schemes

| Scheme | Example | Resolves to |
|---|---|---|
| Internal `$defs` | `"#/$defs/count"` | Signal or handler in current component's `$defs` |
| Window global | `"window#/currentUser"` | `window.currentUser` |
| Document global | `"document#/appConfig"` | `document.appConfig` |
| Parent scope | `"parent#/sharedState"` | Named signal passed via `$props` |
| Map context | `"$map/item"` | Current item in an Array map iteration |
| Map index | `"$map/index"` | Current index in an Array map iteration |
| External file | `"./other.json"` | Another JSONsx component (fully dereferenced) |

### 7.3 Reactive Bindings

When a `$ref` resolves to a `Signal.State` or `Signal.Computed`, the binding is reactive — the DOM property updates automatically whenever the signal value changes:

```json
{
  "tagName": "p",
  "textContent": { "$ref": "#/$defs/count" }
}
```

When a `$ref` resolves to a plain value (non-signal), it is resolved once at render time.

### 7.4 `$ref` Resolution Order

The runtime resolves `$ref` values in the following order:

1. `$map/` prefix — iteration context (highest priority)
2. `#/$defs/` — current component scope
3. `parent#/` — explicitly passed props
4. `window#/` — global window properties
5. `document#/` — global document properties

---

## 8. Element Definitions

### 8.1 DOM Property Mapping

Any valid DOM element property may be set directly on an element definition object. Property names follow the DOM camelCase convention:

```json
{
  "tagName": "div",
  "id": "my-element",
  "className": "container active",
  "hidden": false,
  "tabIndex": 0,
  "textContent": "Hello World"
}
```

This is equivalent to:
```html
<div id="my-element" class="container active" tabindex="0">Hello World</div>
```

### 8.2 Protected Properties

`id` and `tagName` are protected — they may not be set via `$ref` bindings. This mirrors the DOM's own immutability constraints on these properties and prevents conflicts with element identity.

### 8.3 Custom Attributes

Non-standard attributes are set via the `attributes` object, following the distinction the DOM makes between properties and attributes:

```json
{
  "tagName": "div",
  "attributes": {
    "data-component": "my-widget",
    "aria-label": "Interactive counter",
    "slot": "header"
  }
}
```

### 8.4 Child Arrays

Children are expressed as a JSON array of element definition objects:

```json
{
  "tagName": "div",
  "children": [
    { "tagName": "h1", "textContent": "Title" },
    { "tagName": "p",  "textContent": "Content" }
  ]
}
```

Children may be nested to arbitrary depth. Each child follows the same element definition schema.

### 8.5 Slot Support

Custom elements support the standard HTML `slot` mechanism:

```json
{
  "tagName": "card-component",
  "children": [
    { "tagName": "slot", "attributes": { "name": "header" } },
    { "tagName": "slot" }
  ]
}
```

Usage with slotted content:

```json
{
  "tagName": "card-component",
  "children": [
    { "tagName": "h2", "attributes": { "slot": "header" }, "textContent": "Title" },
    { "tagName": "p",  "textContent": "Default slot content" }
  ]
}
```

---

## 9. Styling

### 9.1 Inline Styles as Objects

The `style` property accepts an object with camelCase CSS property names, following the CSSOM convention:

```json
{
  "tagName": "div",
  "style": {
    "backgroundColor": "blue",
    "marginTop": "10px",
    "fontSize": "16px",
    "display": "flex"
  }
}
```

### 9.2 Nested CSS Selectors

CSS nesting is supported via special keys within the `style` object. Keys beginning with `:`, `.`, or `&` are treated as nested selectors:

```json
{
  "style": {
    "backgroundColor": "blue",
    ":hover": {
      "backgroundColor": "darkblue",
      "cursor": "pointer"
    },
    ".child": {
      "color": "white"
    },
    "&.active": {
      "outline": "2px solid white"
    }
  }
}
```

Inline properties are applied directly to the element. Nested rules are emitted as a scoped `<style>` block using a generated data attribute selector.

### 9.3 Static Style Extraction

The compiler extracts all static `style` definitions into a single `<style>` block in the document `<head>`, eliminating per-element style tags at build time.

### 9.4 Named Media Breakpoints (`$media`)

Named breakpoints may be declared at the root document level using `$media`, following the [CSS Media Queries Level 4 `@custom-media` convention](https://www.w3.org/TR/mediaqueries-5/#custom-mq). Names use the CSS custom property `--` prefix:

```json
{
  "$media": {
    "--sm":   "(min-width: 640px)",
    "--md":   "(min-width: 768px)",
    "--lg":   "(min-width: 1024px)",
    "--dark": "(prefers-color-scheme: dark)"
  }
}
```

Within any `style` object, keys beginning with `@--` reference a named breakpoint. Keys beginning with `@` followed by a parenthesized condition are treated as literal media queries:

```json
{
  "style": {
    "fontSize": "14px",
    "@--md": {
      "fontSize": "16px"
    },
    "@--dark": {
      "color": "#ccc"
    },
    "@(min-width: 1280px)": {
      "fontSize": "18px"
    }
  }
}
```

The runtime resolves `@--name` to its registered condition string at render time, emitting a scoped `@media` rule:

```css
@media (min-width: 768px) { [data-jsonsx="abc12"] { font-size: 16px; } }
@media (prefers-color-scheme: dark) { [data-jsonsx="abc12"] { color: #ccc; } }
@media (min-width: 1280px) { [data-jsonsx="abc12"] { font-size: 18px; } }
```

`$media` declarations propagate through the component scope, so all descendant elements of a component share its named breakpoints without re-declaring them. If a child component declares its own `$media`, its definitions take precedence for that subtree.

---

## 10. Dynamic Mapped Arrays

### 10.1 Array Namespace Syntax

Dynamic lists are declared by setting `children` to an object with `$prototype: "Array"` instead of a plain array:

```json
{
  "tagName": "ul",
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/$defs/todoList" },
    "map": {
      "tagName": "li",
      "todoItem":  { "$ref": "$map/item" },
      "todoIndex": { "$ref": "$map/index" }
    }
  }
}
```

### 10.2 Iteration Context

Within a `map` definition, two reserved `$ref` values are available:

| Reference | Resolves to |
|---|---|
| `{ "$ref": "$map/item" }` | The current array item object |
| `{ "$ref": "$map/index" }` | The current zero-based integer index |

### 10.3 Static vs Reactive Items

The `items` source may be a signal reference (reactive) or a static array (rendered once):

```json
{ "items": { "$ref": "#/$defs/$todoList" } }
{ "items": [{ "id": 1, "text": "Static item" }] }
```

When `items` is a signal, the list re-renders automatically when the signal value changes.

### 10.4 Filtering and Sorting

Declarative filter and sort operations are supported via `$ref` to handler-implemented predicates:

```json
{
  "$prototype": "Array",
  "items":  { "$ref": "#/$defs/allItems" },
  "filter": { "$ref": "#/$defs/isVisible" },
  "sort":   { "$ref": "#/$defs/sortByDate" },
  "map": { "tagName": "list-item", "item": { "$ref": "$map/item" } }
}
```

---

## 11. Web API Namespaces

### 11.1 Prototype Namespace Syntax

Web APIs are accessed via the `$prototype` keyword in a `$defs` entry:

```json
{
  "$defs": {
    "userData": {
      "$prototype": "Request",
      "url": "/api/users/",
      "urlParams": { "$ref": "#/$defs/userId" },
      "method": "GET",
      "signal": true
    }
  }
}
```

### 11.2 Supported Prototypes

| `$prototype` | Web API | Notes |
|---|---|---|
| `Request` | Fetch API | Reactive HTTP requests |
| `URLSearchParams` | URL API | Reactive query string construction |
| `FormData` | FormData API | Reactive form data |
| `LocalStorage` | Storage API | Reactive read/write with persistence |
| `SessionStorage` | Storage API | Session-scoped reactive storage |
| `Cookie` | Cookie API | Reactive cookie access |
| `IndexedDB` | IDB API | Full reactive database with CRUD |
| `Array` | — | Dynamic mapped list (see §10) |
| `Set` | — | Reactive Set collection |
| `Map` | — | Reactive Map collection |
| `Blob` | Blob API | Reactive binary data |
| `ReadableStream` | Streams API | Reactive stream creation |

### 11.3 Timing Values

The `timing` field controls when a `$defs` entry is resolved. Three values are defined:

| Value | When | Requires |
|---|---|---|
| `"compiler"` | Resolved at build time; result baked into emitted HTML | Static URL and all dependencies |
| `"server"` | Resolved at runtime on the server via RPC; result stored in signal | `$src` + `$export`; no `$prototype` |
| `"client"` | Resolved at runtime in the browser (default) | — |

`timing: "compiler"` and `timing: "client"` apply to `$prototype`-based entries (`Request`, external classes). `timing: "server"` applies to entries with no `$prototype` — it designates a server function boundary (see §11.4).

```json
{
  "$defs": {
    "posts": {
      "$prototype": "Request",
      "timing": "compiler",
      "url": "/api/posts",
      "signal": true
    },
    "userData": {
      "$prototype": "Request",
      "timing": "client",
      "url": "/api/user/",
      "urlParams": { "$ref": "#/$defs/userId" },
      "signal": true
    }
  }
}
```

`timing: "compiler"` is only valid when the URL and all dependencies are statically resolvable at build time. The compiler validates this constraint and bakes the response into the emitted HTML. `timing: "client"` (the default) executes at runtime in the browser.

---

### 11.4 Server Timing — RPC Function Boundary

`timing: "server"` designates a cross-process function call. Rather than referencing a built-in prototype constructor, the entry points to a named export in a server-side module via `$src` and `$export`. No `$prototype` is used — the presence of `timing: "server"` with `$src`/`$export` (and no `$prototype`) is the compiler's signal that this entry crosses a process boundary.

```json
{
  "$defs": {
    "$metrics": {
      "$src": "./dashboard.server.js",
      "$export": "fetchMetrics",
      "timing": "server",
      "signal": true
    }
  }
}
```

The referenced function must be an async export in the `$src` module. It lives server-side and may safely access private credentials, environment variables, and server-only APIs:

```js
// dashboard.server.js
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export async function fetchMetrics() {
  const { data } = await supabase.from('metrics').select('*')
  return data
}
```

#### Arguments

An optional `arguments` field passes named parameters to the server function as a JSON object. Keys map directly to the function's destructured parameter names. Values may be static literals or reactive `$ref` signal references:

```json
"$metrics": {
  "$src": "./dashboard.server.js",
  "$export": "fetchMetrics",
  "timing": "server",
  "signal": true,
  "arguments": {
    "userId": { "$ref": "#/$defs/$userId" },
    "filter": "active"
  }
}
```

```js
export async function fetchMetrics({ userId, filter }) {
  const { data } = await supabase.from('metrics').select('*')
    .eq('user_id', userId)
    .eq('status', filter)
  return data
}
```

When any `arguments` value is a signal `$ref`, the call becomes reactive: the runtime re-invokes the server endpoint whenever the referenced signal changes, mirroring the behavior of `subscribe` on `timing: "client"` requests.

#### Compiler Output

For each `timing: "server"` entry, the compiler emits two artifacts:

1. **Client-side** — a `POST /_jsonsx/server/$export` fetch call that stores the JSON response in the signal. If any `arguments` value is reactive, the fetch is wrapped in a signal effect.
2. **Server-side** — a generated handler file (using Hono) that imports the `$export` from `$src` and exposes it at `/_jsonsx/server/$export`. Arguments are received as the parsed POST body.

The user is responsible for deploying and running the generated server handler. The client code is emitted alongside the regular HTML/JS output.

#### Security Boundary

Private environment variables and server-only credentials remain in the server process. The browser receives only the function's serialized return value. The generated handler restricts the `/_jsonsx/server/` route to same-origin requests by default.

#### Development Mode

In the runtime (used during development), `timing: "server"` entries are executed client-side as if they were `timing: "client"`. The server process boundary is not enforced during development, allowing the full JSONsx runtime to operate without a separate server process.

---

## 12. External Class Integration

### 12.1 The `$src` Property on `$defs` Entries

`$src` is an optional property on any `$defs` entry that carries a `$prototype` value. When present, the runtime resolves `$prototype` as a named export from the specified module rather than from the built-in prototype registry:

```json
{
  "$defs": {
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "timing": "compiler",
      "signal": true
    }
  }
}
```

The `$src` value is a module specifier string following the same resolution semantics as `$handlers`:

| Specifier form | Example | Resolution |
|---|---|---|
| Relative path | `"./lib/my-class.js"` | Relative to the `.json` file |
| Absolute URL | `"https://cdn.example.com/parser.js"` | Fetched directly |
| npm specifier | `"npm:@jsonsx/md"` | Resolved via npm resolver |
| Package name | `"@jsonsx/md"` | Resolved via npm resolver |

By default, the runtime looks for a named export matching `$prototype` in the resolved module. An optional `$export` property overrides the export name when the class is exported under a different name.

When `$src` is absent, resolution falls through to the built-in prototype registry unchanged.

### 12.2 External Class Contract

Any class used as a JSONsx prototype via `$src` must satisfy the following contract:

**Constructor:** The class constructor receives a single configuration object containing all `$defs` properties except the JSONsx-reserved keywords (`$prototype`, `$src`, `$export`, `signal`, `timing`, `$compute`, `$deps`):

```js
// Given: { "$prototype": "MyParser", "$src": "./parser.js", "src": "./data.md", "signal": true }
// Runtime calls: new MyParser({ src: "./data.md" })
```

**Value resolution:** The runtime obtains the signal's initial value by checking in order:

1. `instance.resolve()` — async method, awaited. Preferred for async sources.
2. `instance.value` — synchronous getter or property.
3. `instance` itself — fallback if neither above is present.

**Reactivity (optional):** Classes wanting to push updates may implement:

```js
instance.subscribe(callback)  // called with new value on data change
instance.unsubscribe()        // cleanup on signal disposal
```

### 12.3 Resolution Algorithm

```
Given $prototype: "MyClass" and $src: "./lib/my-class.js":

1. Check module cache for $src specifier
2. If not cached: import($src resolved relative to .json file), cache result
3. Extract export: module[$export] if set, else module[$prototype]
4. Verify export is a constructor (typeof === 'function')
5. Strip JSONsx-reserved properties to produce config object
6. Instantiate: new ExportedClass(config)
7. Resolve value: await resolve() → .value → instance
8. Wrap in signal and register in component scope
```

### 12.4 Signal Wrapping

Signal wrapping for external classes follows the same rules as built-in prototypes:

| `signal` | `timing` | `subscribe` present | Result |
|---|---|---|---|
| `true` | `"server"` | — | Resolved at build time, baked as static value |
| `true` | `"client"` (default) | No | `Signal.State`, initialized with resolved value |
| `true` | `"client"` | Yes | `Signal.State`, updated via `subscribe()` |
| `false` / absent | — | — | Resolved once, not wrapped in signal |

### 12.5 Extended `$prototype` Registry

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

When `$prototype` is not in the built-in registry and `$src` is absent, the runtime throws: `"Unknown $prototype 'X'. Did you mean to add '$src'?"`.

---

## 13. Component Encapsulation

### 13.1 External Component References

Components are referenced via `$ref` pointing to an external `.json` file:

```json
{
  "children": [
    { "$ref": "./components/my-counter.json" },
    {
      "$ref": "./components/card.json",
      "$props": {
        "title": "Hello",
        "count": { "$ref": "#/$defs/count" }
      }
    }
  ]
}
```

External `$ref` resolution is handled by `@apidevtools/json-schema-ref-parser`, which also supports URLs and custom URI scheme resolvers.

### 13.2 Explicit Props

Props are passed explicitly via the `$props` object on the reference site. This is the only mechanism for passing state across component boundaries:

```json
{
  "$ref": "./card.json",
  "$props": {
    "title": "Static string",
    "count": { "$ref": "#/$defs/count" },
    "onAction": { "$ref": "#/$defs/handleAction" }
  }
}
```

The receiving component declares what it accepts in its own `$defs`:

```json
{
  "$defs": {
    "title":    "",
    "count":    0,
    "onAction": { "$prototype": "Function", "body": "" }
  }
}
```

**Compile-time validation:** The compiler verifies that every key in `$props` corresponds to a declared `$defs` entry in the referenced component, and that types are compatible.

### 13.3 Scope Isolation

Signal scope is bounded at the component (custom element) level, following the same model as CSS Custom Properties. Signals declared in a component's `$defs` are available to all descendants within that component, but do not propagate into child custom elements. Child components must receive all external state via explicit `$props`.

### 13.4 npm and Remote Components

Components may be referenced via any URI supported by the ref-parser resolver:

```json
{ "$ref": "https://cdn.example.com/components/button.json" }
```

An `npm:` URI scheme resolver may be registered with the ref-parser to support npm package imports:

```json
{ "$ref": "npm:@my-org/ui-library/components/card.json" }
```

---

## 14. Dynamic Component Switching

### 14.1 `$switch` Syntax

Components may be rendered conditionally based on a signal value using `$switch`:

```json
{
  "tagName": "main",
  "children": [{
    "$switch": { "$ref": "#/$defs/currentRoute" },
    "cases": {
      "home":    { "$ref": "./views/home.json" },
      "about":   { "$ref": "./views/about.json" },
      "profile": { "$ref": "./views/profile.json" }
    }
  }]
}
```

When the referenced signal changes value, the currently rendered case is replaced with the new one.

### 14.2 Compiler Visibility

Because all cases are declared statically in the JSON, the compiler has full knowledge of all possible component variants at build time. All case components can be pre-compiled and bundled, with only the active case hydrated on load.

---

## 15. Scope Rules

### 15.1 Scope Levels

JSONsx has three scope levels, matching the web platform:

| Level | Scope | Mirrors |
|---|---|---|
| `window` | Application-wide | `window` global |
| `document` | Document-wide | `document` object |
| Component | Custom element boundary | CSS Custom Property scope |

### 15.2 Within-Component Scope

All `$defs` entries in a component are available to all descendant elements within that component without explicit passing. This mirrors CSS Custom Properties, which are available to all descendants of the element where they are declared.

### 15.3 Cross-Component Scope

Signals do not cross component boundaries implicitly. Passing state to a child component requires explicit `$props`. This is the web platform model: HTML attributes are the interface of a custom element.

### 15.4 Scope Resolution Order

When resolving a `$ref` at runtime, the following order applies:

1. `$map/` context (iteration variables)
2. Local component `$defs`
3. Explicitly passed `$props`
4. `window` globals
5. `document` globals

---

## 16. Compilation Model

### 16.1 Static Detection

A node is considered static if it and all its descendants satisfy all of the following:

- No `$defs` entries that produce signals or functions
- No `${}` template strings in any property value
- No `$prototype` namespaces
- No `$switch` nodes
- No `$prototype: "Array"` children
- No `$ref` bindings on element properties

Static detection is performed by a single recursive tree walk — no code execution required.

### 16.2 Output Tiers

| Component surface | Compiler output |
|---|---|
| Fully static subtree | Plain HTML, zero JS |
| Naked value with `${}` references in document | HTML + effect only |
| Template string signal | HTML + signal + effect |
| `$prototype: "Function"` | HTML + function + handler wiring |
| External class with `timing: "compiler"` | HTML with baked response data |
| External class with `timing: "client"` | HTML + runtime hydration |
| Server function (`timing: "server"`) | HTML + client fetch + generated server handler |
| Pure type definition | No output |

### 16.3 Island Serialization

Dynamic subtrees are serialized as hydration islands. The component's JSON descriptor is embedded directly in the HTML as a `<script type="application/JSONsx+json">` block:

```html
<my-counter data-JSONsx-island>
  <script type="application/JSONsx+json">
  { "tagName": "my-counter", "$defs": { "$count": { ... } }, ... }
  </script>
</my-counter>
```

The JSONsx runtime picks up these descriptors on page load and hydrates each island independently.

### 16.4 CSS Extraction

All static `style` definitions are extracted from the component tree and emitted as a single `<style>` block in the document `<head>`. Per-element style tags are not emitted in compiled output.

### 16.5 Bundle Manifest

Because all `$src` paths and `$ref` component references are explicit strings in the JSON, the compiler produces an exact bundle manifest with zero static analysis of JS required. The JSON is the manifest.

---

## 17. Runtime Pipeline

The JSONsx runtime processes a document in four sequential steps:

### Step 1 — Resolve

```
$RefParser.dereference(source)
```

All `$ref` pointers — internal, external file, and URL — are resolved into a single dereferenced document object. Circular references are handled. Cross-file references are fetched. The result is a plain JavaScript object with no remaining `$ref` strings.

**Library:** `@apidevtools/json-schema-ref-parser`

### Step 2 — Build Scope

```
buildScope($defs) → $defs{}
```

Each `$defs` entry is processed according to the shape detection algorithm (§5.10):

- Naked values → property on `reactive({})`, initialized to value
- Expanded signals (has `default`) → property on `reactive({})`, initialized to `default`, schema keywords stripped
- Pure type definitions → no-op
- Template strings (contains `${}`) → `computed(() => template)` stored on `reactive({})`
- `$prototype: "Function"` + `body` → named function, first param is `$defs`
- `$prototype: "Function"` + `$src` → dynamic import, named export, first param is `$defs`
- `$prototype: "Function"` + `signal: true` → `computed()` wrapping above
- `$prototype: "ClassName"` → external class resolution

**Library:** `@vue/reactivity`

### Step 3 — Render

```
renderNode(def, scope) → HTMLElement
```

The dereferenced document tree is walked recursively. Each node produces a DOM element. `$ref` bindings to signals are wired to reactive effects. Template strings (`${}`) in any string property are wrapped in reactive effects. Static values are set once. Event handlers are attached as event listeners.

**Library:** `@vue/reactivity` (`watchEffect`)

### Step 4 — Output

The rendered element tree is appended to the target container. For SSR/compilation, the tree is serialized to an HTML string instead of appended to a live DOM.

---

## 18. Reserved Keywords

The following keys have special meaning in JSONsx and may not be used as element property names:

| Keyword | Purpose |
|---|---|
| `$schema` | Dialect identifier |
| `$id` | Component identifier |
| `$defs` | Signal, function, type, and data source declarations |
| `$ref` | Reference pointer (JSON Pointer, RFC 6901) |
| `$props` | Explicit prop passing at component boundary |
| `$prototype` | Constructor name — Web API class, `"Function"`, or external class |
| `$src` | External module specifier for functions or classes |
| `$export` | Named export within `$src` module |
| `$switch` | Dynamic component switching |
| `$map` | Iteration context namespace (read-only, inside Array children) |
| `$media` | Named media breakpoint declarations (root-level) |
| `signal` | Reactive wrapping: required on `$prototype: "Function"` computed and external class entries |
| `timing` | Execution timing: `"compiler"`, `"server"`, or `"client"` |
| `default` | Initial value — discriminator for expanded signal shape (Shape 2) |
| `body` | Inline function body |
| `arguments` | Inline function parameter names |
| `name` | Inline function explicit name |
| `description` | Documentation string on any `$defs` entry |

Standard JSON Schema 2020-12 keywords (`type`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `examples`, etc.) are inherited from the JSON Schema vocabulary and are valid on any `$defs` entry that is a signal or type definition.

---

## 19. Standards Alignment

### 19.1 JSON Schema 2020-12

JSONsx documents are valid JSON. The `$schema`, `$defs`, `$ref`, `$id`, and `type` keywords follow JSON Schema 2020-12 semantics. JSONsx is defined as a JSON Schema dialect with additional vocabulary for reactivity and DOM binding. JSON Schema type vocabulary (`type`, `properties`, `items`, `enum`, `minimum`, `maximum`, etc.) is first-class on `$defs` entries for signal type annotation, LSP hints, and TypeScript declaration generation.

### 19.2 JSON Pointer (RFC 6901)

Internal `$ref` values use JSON Pointer syntax for path navigation: `#/$defs/$count` follows the RFC 6901 fragment identifier format.

### 19.3 `@vue/reactivity`

Reactivity is implemented using `@vue/reactivity` — the framework-agnostic reactivity core of Vue 3. The primitives used are `reactive()`, `computed()`, and `watchEffect()`. JSONsx will track the TC39 Signals proposal and may migrate to native signals when the proposal matures; the `$defs`-based authoring model is designed to be independent of the underlying reactivity library.

### 19.4 Web Components

Custom elements defined in JSONsx follow the Web Components specification. `tagName` values containing a hyphen are registered as autonomous custom elements. Slot behavior follows the HTML slot specification.

### 19.5 CSSOM

Style object property names follow the CSS Object Model camelCase convention (`backgroundColor`, `marginTop`, etc.), identical to the `element.style` API.

### 19.8 CSS Media Queries Level 4

`$media` breakpoint names follow the [`@custom-media` convention](https://www.w3.org/TR/mediaqueries-5/#custom-mq) from the CSS Media Queries Level 4 Working Draft: names use the `--` prefix and values are parenthesized media conditions. The runtime resolves named queries at render time, emitting standard `@media` rules, providing full cross-browser support without requiring native `@custom-media` support.

### 19.6 ECMAScript Modules

The `$src` field on `$prototype: "Function"` and external class entries accepts any valid ES module specifier. The runtime loads external code via the native dynamic `import()` API. No module bundler is required for development.

---

## Appendix A — Minimal Complete Example

### `todo-app.json`

```json
{
  "$schema": "https://jsonsx.dev/schema/v1",
  "$id": "TodoApp",

  "$defs": {
    "TodoItem": {
      "type": "object",
      "properties": {
        "id":   { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    },

    "items": {
      "type": "array",
      "default": [{ "id": 1, "text": "Learn JSONsx", "done": false }],
      "items": { "$ref": "#/$defs/TodoItem" }
    },

    "remaining": "${$defs.items.filter(i => !i.done).length}",
    "total":     "${$defs.items.length}",
    "summary":   "${$defs.remaining} of ${$defs.total} remaining",

    "addItem": {
      "$prototype": "Function",
      "body": "$defs.items.push({ id: Date.now(), text: 'New item', done: false })"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "const item = $defs.items.find(i => i.id === id); if (item) item.done = !item.done"
    },
    "clearDone": {
      "$prototype": "Function",
      "body": "$defs.items.splice(0, $defs.items.length, ...$defs.items.filter(i => !i.done))"
    }
  },

  "tagName": "todo-app",
  "style": { "fontFamily": "system-ui", "maxWidth": "480px", "margin": "2rem auto" },

  "children": [
    {
      "tagName": "h1",
      "textContent": "${$defs.summary}"
    },
    {
      "tagName": "div",
      "style": { "display": "flex", "gap": "0.5rem", "marginBottom": "1rem" },
      "children": [
        {
          "tagName": "button",
          "textContent": "Add item",
          "onclick": { "$ref": "#/$defs/addItem" }
        },
        {
          "tagName": "button",
          "textContent": "Clear done",
          "onclick": { "$ref": "#/$defs/clearDone" }
        }
      ]
    },
    {
      "tagName": "ul",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/$defs/items" },
        "map": {
          "tagName": "li",
          "style": {
            "textDecoration": "${$map.item.done ? 'line-through' : 'none'}",
            "opacity":        "${$map.item.done ? '0.5' : '1'}"
          },
          "textContent": "${$map.item.text}",
          "onclick": { "$ref": "#/$defs/toggleItem" }
        }
      }
    }
  ]
}
```

### Usage

```js
import { JSONsx } from '@jsonsx/runtime';
await JSONsx('./todo-app.json', document.body);
```

---

## Appendix B — Dependency Stack

| Package | Version | Purpose |
|---|---|---|
| `@apidevtools/json-schema-ref-parser` | `^15.0` | `$ref` resolution and external file dereferencing |
| `@vue/reactivity` | `^3.5` | Reactive primitives (`reactive`, `computed`, `watchEffect`) |

The JSONsx runtime has no novel infrastructure code for reactivity scheduling — `@vue/reactivity`'s `watchEffect` handles all effect scheduling out of the box.

---

## Appendix C — Component Checklist

When creating a new JSONsx component:

- [ ] `component.json` declares `$schema` and `$id`
- [ ] Simple mutable state uses naked values — no `signal: true`, no wrapper object needed
- [ ] State needing constraints or documentation uses expanded JSON Schema form with `default`
- [ ] Shared type shapes use `PascalCase` pure type definitions (no `default`, no `$prototype`)
- [ ] Derived values use template strings with `${}` — e.g. `"${$defs.count} items"`
- [ ] Template strings use `$defs.signalName` — no `.get()` calls, no `this`
- [ ] Handler bodies use `$defs.signalName = v` to write — no `.set()` calls
- [ ] Handler bodies use `$defs.items.push(...)` etc. — Vue tracks array mutations directly
- [ ] Template strings used directly in element properties for single-use reactive bindings
- [ ] `$ref` used for signals referenced in multiple places or complex enough to deserve a name
- [ ] All functions declared with `$prototype: "Function"` and either `body` or `$src`
- [ ] Handler `body` strings do not include non-void `return`
- [ ] Computed `body` strings (`signal: true`) include `return`
- [ ] `signal: true` declared only on `$prototype: "Function"` computed entries and external class entries
- [ ] External sidecar functions declare `$defs` as their first parameter
- [ ] External `$src` paths are valid module specifiers resolvable from the `.json` file location
- [ ] Cross-component state is passed via `$props`, not assumed from the parent scope
- [ ] Server-timed external class entries use only statically resolvable configuration

---

*JSONsx Specification v1.0.0-draft — subject to revision*
