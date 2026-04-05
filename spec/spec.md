# JSONsx Specification
## Declarative Document Object Model — JSON Edition

**Version:** 0.8.0-draft  
**Status:** In Progress  
**License:** MIT

---

## Table of Contents

1. [Overview](#1-overview)
2. [Philosophy](#2-philosophy)
3. [Document Format](#3-document-format)
4. [The Component Pair Model](#4-the-component-pair-model)
5. [Signal Declarations](#5-signal-declarations)
6. [Reference System](#6-reference-system)
7. [Element Definitions](#7-element-definitions)
8. [Styling](#8-styling)
9. [Event Handlers](#9-event-handlers)
10. [Dynamic Mapped Arrays](#10-dynamic-mapped-arrays)
11. [Web API Namespaces](#11-web-api-namespaces)
12. [Component Encapsulation](#12-component-encapsulation)
13. [Computed Expressions](#13-computed-expressions)
14. [Dynamic Component Switching](#14-dynamic-component-switching)
15. [Scope Rules](#15-scope-rules)
16. [Compilation Model](#16-compilation-model)
17. [Runtime Pipeline](#17-runtime-pipeline)
18. [Reserved Keywords](#18-reserved-keywords)
19. [Standards Alignment](#19-standards-alignment)

---

## 1. Overview

JSONsx is a schema and runtime for building reactive web applications using plain JSON. A JSONsx application is a tree of JSON objects whose structure mirrors the DOM API, whose reactivity is powered by the TC39 Signals proposal, and whose behavior is implemented in companion JavaScript files.

The core premise: **structure and state are data; behavior is code; the two are kept strictly separate and connected explicitly.**

Every JSONsx application ships as pairs of files:

```
component.json   ← structure, styling, signal declarations, bindings
component.js     ← event handlers, computed logic, lifecycle
```

The JSON file is fully serializable, statically analyzable, and visual-builder-friendly. The JS file is a standard ES module whose exports are declared in the JSON, making the connection between the two explicit and IDE-navigable.

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
  "$schema": "https://declarative-dom.org/schema/v1",
  "$id": "ComponentName",
  "$handlers": "./component.js",
  "$defs": { },
  "tagName": "my-component",
  "children": [ ]
}
```

| Field | Required | Description |
|---|---|---|
| `$schema` | Recommended | URI identifying the JSONsx dialect version |
| `$id` | Recommended | Component identifier, used by tooling |
| `$handlers` | Optional | Relative path or URL to companion `.js` file |
| `$defs` | Optional | Signal and handler declarations for this component |
| `tagName` | Required | HTML tag name for the root element |
| `children` | Optional | Array of child element definitions, or Array namespace |

### 3.2 JSON Schema Dialect

JSONsx is a JSON Schema dialect. Documents may be validated against the JSONsx meta-schema using any JSON Schema 2020-12 compatible validator. The `$schema` URI identifies the dialect version and enables schema-aware tooling.

JSONsx extends the base JSON Schema vocabulary with the following reserved keywords: `$handlers`, `$prototype`, `$handler`, `$compute`, `$deps`, `$props`, `$switch`, `$map`, `signal`, `timing`.

---

## 4. The Component Pair Model

### 4.1 File Pairing

Every JSONsx component consists of two files with the same stem:

```
components/
  my-counter.json    ← declaration
  my-counter.js      ← implementation
```

The connection is declared explicitly in the JSON via `$handlers`:

```json
{
  "$handlers": "./my-counter.js"
}
```

This string is a standard ES module specifier. IDEs follow it natively (CTRL-click). Bundlers follow it as a static import path. No custom tooling or plugins required for basic navigation.

### 4.2 Handler Declaration

Handlers that exist in the `.js` file must be declared in the JSON `$defs`. This declaration serves as the interface contract between the two files:

```json
{
  "$defs": {
    "increment": { "$handler": true },
    "decrement": { "$handler": true },
    "onMount":   { "$handler": true, "description": "Fires when element connects" }
  }
}
```

The companion `.js` file exports a default object whose keys match these declarations:

```js
export default {
  increment() { this.$count.set(this.$count.get() + 1); },
  decrement() { this.$count.set(this.$count.get() - 1); },
  onMount()   { console.log('mounted'); }
};
```

**Compile-time contract:** The compiler validates that every `$handler: true` declaration in the JSON has a corresponding export in the `.js` file, and warns on undeclared exports.

### 4.3 Handler Binding

At runtime, handler exports are bound to the component scope. Inside a handler, `this` refers to the component scope object — providing access to all declared signals via `this.$signalName.get()` and `this.$signalName.set(value)`.

---

## 5. Signal Declarations

### 5.1 Signal Definition

Reactive signals are declared in `$defs` with `"signal": true`:

```json
{
  "$defs": {
    "$count":   { "type": "integer", "default": 0,       "signal": true },
    "$name":    { "type": "string",  "default": "World", "signal": true },
    "$visible": { "type": "boolean", "default": true,    "signal": true }
  }
}
```

The `type` field follows JSON Schema type vocabulary and is used for validation and IDE autocomplete. The `default` field provides the initial signal value.

### 5.2 Signal Types

JSONsx maps signal definitions to TC39 Signal types:

| Definition shape | Signal type | Notes |
|---|---|---|
| Literal `default` value | `Signal.State` | Mutable, set via `.set()` |
| `$compute` expression | `Signal.Computed` | Read-only, recomputes on dep change |
| `$handler: true` | Function (not a signal) | Bound to scope, callable directly |

### 5.3 Signal Naming Convention

Signal names use the `$` prefix by convention, matching the JSON Schema system keyword convention and providing visual distinction from static properties. Non-`$` names in `$defs` are handler declarations.

### 5.4 Signal Access in JavaScript

Within `.js` handler files, signals require explicit `.get()` and `.set()` calls:

```js
// Reading
const current = this.$count.get();

// Writing
this.$count.set(current + 1);

// Computed signals are read-only
const label = this.$displayText.get();
```

---

## 6. Reference System

### 6.1 `$ref` Syntax

JSONsx uses `$ref` to express bindings between properties and declared signals, following the JSON Reference convention. A `$ref` value is a URI string:

```json
{ "$ref": "#/$defs/$count" }
```

### 6.2 Reference Schemes

| Scheme | Example | Resolves to |
|---|---|---|
| Internal `$defs` | `"#/$defs/$count"` | Signal or handler in current component's `$defs` |
| Window global | `"window#/currentUser"` | `window.currentUser` |
| Document global | `"document#/appConfig"` | `document.appConfig` |
| Parent scope | `"parent#/$sharedState"` | Named signal passed via `$props` |
| Map context | `"$map/item"` | Current item in an Array map iteration |
| Map index | `"$map/index"` | Current index in an Array map iteration |
| External file | `"./other.json"` | Another JSONsx component (fully dereferenced) |

### 6.3 Reactive Bindings

When a `$ref` resolves to a `Signal.State` or `Signal.Computed`, the binding is reactive — the DOM property updates automatically whenever the signal value changes:

```json
{
  "tagName": "p",
  "textContent": { "$ref": "#/$defs/$count" }
}
```

When a `$ref` resolves to a plain value (non-signal), it is resolved once at render time.

### 6.4 `$ref` Resolution Order

The runtime resolves `$ref` values in the following order:

1. `$map/` prefix — iteration context (highest priority)
2. `#/$defs/` — current component scope
3. `parent#/` — explicitly passed props
4. `window#/` — global window properties
5. `document#/` — global document properties

---

## 7. Element Definitions

### 7.1 DOM Property Mapping

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

### 7.2 Protected Properties

`id` and `tagName` are protected — they may not be set via `$ref` bindings. This mirrors the DOM's own immutability constraints on these properties and prevents conflicts with element identity.

### 7.3 Custom Attributes

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

### 7.4 Child Arrays

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

### 7.5 Slot Support

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

## 8. Styling

### 8.1 Inline Styles as Objects

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

### 8.2 Nested CSS Selectors

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

### 8.3 Static Style Extraction

The compiler extracts all static `style` definitions into a single `<style>` block in the document `<head>`, eliminating per-element style tags at build time.

---

## 9. Event Handlers

### 9.1 Handler Binding Syntax

Event handlers are bound using DOM event property names (`onclick`, `onchange`, etc.) with a `$ref` to a declared handler:

```json
{
  "tagName": "button",
  "textContent": "Increment",
  "onclick": { "$ref": "#/$defs/increment" }
}
```

The handler must be declared in `$defs` and implemented in the companion `.js` file.

### 9.2 Handler Declaration

```json
{
  "$defs": {
    "increment": { "$handler": true }
  }
}
```

### 9.3 Handler Implementation

```js
export default {
  increment() {
    this.$count.set(this.$count.get() + 1);
  }
};
```

### 9.4 Handler Arguments

Event handlers receive the native DOM event object as their first argument:

```js
export default {
  handleInput(event) {
    this.$value.set(event.target.value);
  }
};
```

---

## 10. Dynamic Mapped Arrays

### 10.1 Array Namespace Syntax

Dynamic lists are declared by setting `children` to an object with `$prototype: "Array"` instead of a plain array:

```json
{
  "tagName": "ul",
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/$defs/$todoList" },
    "map": {
      "tagName": "li",
      "$todoItem":  { "$ref": "$map/item" },
      "$todoIndex": { "$ref": "$map/index" }
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
  "items":  { "$ref": "#/$defs/$allItems" },
  "filter": { "$ref": "#/$defs/isVisible" },
  "sort":   { "$ref": "#/$defs/sortByDate" },
  "map": { "tagName": "list-item", "$item": { "$ref": "$map/item" } }
}
```

---

## 11. Web API Namespaces

### 11.1 Prototype Namespace Syntax

Web APIs are accessed via the `$prototype` keyword in a `$defs` entry:

```json
{
  "$defs": {
    "$userData": {
      "$prototype": "Request",
      "url": "/api/users/",
      "urlParams": { "$ref": "#/$defs/$userId" },
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

### 11.3 Server vs Client Timing

The `timing` field controls when a `Request` prototype executes:

```json
{
  "$defs": {
    "$posts": {
      "$prototype": "Request",
      "timing": "server",
      "url": "/api/posts",
      "signal": true
    },
    "$userData": {
      "$prototype": "Request",
      "timing": "client",
      "url": "/api/user/",
      "urlParams": { "$ref": "#/$defs/$userId" },
      "signal": true
    }
  }
}
```

`timing: "server"` is only valid when the URL and all dependencies are statically resolvable at build time. The compiler validates this constraint and bakes the response into the emitted HTML. `timing: "client"` (the default) executes at runtime in the browser.

---

## 12. Component Encapsulation

### 12.1 External Component References

Components are referenced via `$ref` pointing to an external `.json` file:

```json
{
  "children": [
    { "$ref": "./components/my-counter.json" },
    {
      "$ref": "./components/card.json",
      "$props": {
        "title": "Hello",
        "$count": { "$ref": "#/$defs/$count" }
      }
    }
  ]
}
```

External `$ref` resolution is handled by `@apidevtools/json-schema-ref-parser`, which also supports URLs and custom URI scheme resolvers.

### 12.2 Explicit Props

Props are passed explicitly via the `$props` object on the reference site. This is the only mechanism for passing state across component boundaries:

```json
{
  "$ref": "./card.json",
  "$props": {
    "title": "Static string",
    "$count": { "$ref": "#/$defs/$count" },
    "onAction": { "$ref": "#/$defs/handleAction" }
  }
}
```

The receiving component declares what it accepts in its own `$defs`:

```json
{
  "$defs": {
    "title":    { "type": "string",  "default": "" },
    "$count":   { "type": "integer", "default": 0, "signal": true },
    "onAction": { "$handler": true }
  }
}
```

**Compile-time validation:** The compiler verifies that every key in `$props` corresponds to a declared `$defs` entry in the referenced component, and that types are compatible.

### 12.3 Scope Isolation

Signal scope is bounded at the component (custom element) level, following the same model as CSS Custom Properties. Signals declared in a component's `$defs` are available to all descendants within that component, but do not propagate into child custom elements. Child components must receive all external state via explicit `$props`.

### 12.4 npm and Remote Components

Components may be referenced via any URI supported by the ref-parser resolver:

```json
{ "$ref": "https://cdn.example.com/components/button.json" }
```

An `npm:` URI scheme resolver may be registered with the ref-parser to support npm package imports:

```json
{ "$ref": "npm:@my-org/ui-library/components/card.json" }
```

---

## 13. Computed Expressions

### 13.1 JSONata Expressions

Computed signals may use JSONata expressions for inline value derivation. JSONata is a JSON query and transformation language with JavaScript-like expression syntax:

```json
{
  "$defs": {
    "$count": { "type": "integer", "default": 0, "signal": true },
    "$label": {
      "$compute": "$count > 10 ? 'high' : 'low'",
      "$deps":    ["#/$defs/$count"],
      "signal": true
    },
    "$doubled": {
      "$compute": "$count * 2",
      "$deps":    ["#/$defs/$count"],
      "signal": true
    }
  }
}
```

### 13.2 `$deps` Declaration

The `$deps` array explicitly declares which signals the computed expression depends on. Dependencies are `$ref` strings pointing to `$defs` entries:

```json
{
  "$compute": "count($items[done = false])",
  "$deps": ["#/$defs/$items"],
  "signal": true
}
```

Explicit `$deps` declarations make dependency graphs statically analyzable — the compiler can determine the full reactivity graph without evaluating any code.

### 13.3 Scope of Use

JSONata expressions are appropriate for value derivation: arithmetic, string operations, conditionals, and simple array operations. Complex logic (closures, async operations, multi-step transformations, side effects) belongs in the `.js` handler file.

This boundary is not enforced at runtime but is a recommended practice and may be linted by the compiler.

---

## 14. Dynamic Component Switching

### 14.1 `$switch` Syntax

Components may be rendered conditionally based on a signal value using `$switch`:

```json
{
  "tagName": "main",
  "children": [{
    "$switch": { "$ref": "#/$defs/$currentRoute" },
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

- No `signal: true` in any `$defs` entry
- No `$compute` expressions
- No `$handler: true` declarations
- No `$prototype` namespaces
- No `$switch` nodes
- No `$prototype: "Array"` children
- No `$ref` bindings on element properties

Static detection is performed by a single recursive tree walk — no code execution required.

### 16.2 Output Tiers

| Component surface | Compiler output |
|---|---|
| Fully static subtree | Plain HTML, zero JS |
| Signals only (no handlers) | HTML + signal initialization inline script |
| Signals + handlers | HTML + named handler exports from `$handlers` |
| Server-timed `Request` | HTML with baked response data |

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

Because all `$handlers` paths and `$ref` component references are explicit strings in the JSON, the compiler produces an exact bundle manifest with zero static analysis of JS required. The JSON is the manifest.

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
injectSignals($defs) → scope{}
loadHandlers($handlers) → merge into scope{}
```

Each `$defs` entry with `signal: true` is wrapped in a `Signal.State` or `Signal.Computed`. Each `$defs` entry with `$prototype` is resolved into the appropriate Web API wrapper signal. The `$handlers` module is dynamically imported and its exports are bound to the scope.

**Libraries:** `signal-polyfill`, `jsonata`

### Step 3 — Render

```
renderNode(def, scope) → HTMLElement
```

The dereferenced document tree is walked recursively. Each node produces a DOM element. `$ref` bindings to signals are wired to reactive effects. Static values are set once. Event handlers are attached as event listeners.

**Library:** Effect scheduler (`effect.js` — ~20 lines, the only novel infrastructure code)

### Step 4 — Output

The rendered element tree is appended to the target container. For SSR/compilation, the tree is serialized to an HTML string instead of appended to a live DOM.

---

## 18. Reserved Keywords

The following keys have special meaning in JSONsx and may not be used as element property names:

| Keyword | Purpose |
|---|---|
| `$schema` | Dialect identifier |
| `$id` | Component identifier |
| `$defs` | Signal and handler declarations |
| `$handlers` | Path to companion `.js` file |
| `$ref` | Reference pointer |
| `$props` | Explicit prop passing at component boundary |
| `$prototype` | Web API namespace identifier |
| `$handler` | Marks a `$defs` entry as a handler declaration |
| `$compute` | JSONata expression for computed signals |
| `$deps` | Dependency list for computed signals |
| `$switch` | Dynamic component switching |
| `$map` | Iteration context namespace (read-only) |
| `signal` | Marks a `$defs` entry as reactive |
| `timing` | Execution timing for `Request` prototype (`"server"` \| `"client"`) |
| `default` | Initial value for a signal |

---

## 19. Standards Alignment

### 19.1 JSON Schema 2020-12

JSONsx documents are valid JSON. The `$schema`, `$defs`, `$ref`, `$id`, and `type` keywords follow JSON Schema 2020-12 semantics. JSONsx is defined as a JSON Schema dialect with additional vocabulary for reactivity and DOM binding.

### 19.2 JSON Pointer (RFC 6901)

Internal `$ref` values use JSON Pointer syntax for path navigation: `#/$defs/$count` follows the RFC 6901 fragment identifier format.

### 19.3 TC39 Signals Proposal

Reactivity is implemented using the TC39 Signals proposal (`Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher`). JSONsx tracks the proposal as it advances and will remove the polyfill dependency when native support ships.

### 19.4 Web Components

Custom elements defined in JSONsx follow the Web Components specification. `tagName` values containing a hyphen are registered as autonomous custom elements. Slot behavior follows the HTML slot specification.

### 19.5 CSSOM

Style object property names follow the CSS Object Model camelCase convention (`backgroundColor`, `marginTop`, etc.), identical to the `element.style` API.

### 19.6 ECMAScript Modules

The `$handlers` field accepts any valid ES module specifier. The runtime loads handlers via the native dynamic `import()` API. No module bundler is required for development.

### 19.7 JSONata

Computed expressions use [JSONata](https://jsonata.org) — an open-source query and transformation language for JSON with an established JavaScript implementation (`jsonata` npm package).

---

## Appendix A — Minimal Complete Example

### `todo-app.json`

```json
{
  "$schema": "https://declarative-dom.org/schema/v1",
  "$id": "TodoApp",
  "$handlers": "./todo-app.js",
  "$defs": {
    "$items": {
      "type": "array",
      "default": [
        { "id": 1, "text": "Learn JSONsx", "done": false }
      ],
      "signal": true
    },
    "$remaining": {
      "$compute": "count($items[done = false])",
      "$deps": ["#/$defs/$items"],
      "signal": true
    },
    "addItem":    { "$handler": true },
    "toggleItem": { "$handler": true }
  },
  "tagName": "todo-app",
  "style": { "fontFamily": "system-ui", "maxWidth": "480px", "margin": "2rem auto" },
  "children": [
    {
      "tagName": "h1",
      "textContent": { "$ref": "#/$defs/$remaining" }
    },
    {
      "tagName": "button",
      "textContent": "Add item",
      "onclick": { "$ref": "#/$defs/addItem" }
    },
    {
      "tagName": "ul",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/$defs/$items" },
        "map": {
          "tagName": "li",
          "$item":        { "$ref": "$map/item" },
          "$index":       { "$ref": "$map/index" },
          "$toggleItem":  { "$ref": "#/$defs/toggleItem" }
        }
      }
    }
  ]
}
```

### `todo-app.js`

```js
export default {
  addItem() {
    this.$items.set([
      ...this.$items.get(),
      { id: Date.now(), text: 'New item', done: false }
    ]);
  },
  toggleItem(index) {
    this.$items.set(
      this.$items.get().map((item, i) =>
        i === index ? { ...item, done: !item.done } : item
      )
    );
  }
};
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
| `signal-polyfill` | `^0.2` | TC39 Signals polyfill (`Signal.State`, `Signal.Computed`) |
| `jsonata` | `^2.0` | JSONata expression evaluation for `$compute` |

The JSONsx runtime introduces one file of novel infrastructure code: `effect.js` (~20 lines), which implements a microtask-batched effect scheduler on top of `Signal.subtle.Watcher`.

---

## Appendix C — File Pair Checklist

When creating a new JSONsx component:

- [ ] `component.json` declares `$schema` and `$id`
- [ ] `component.json` declares `$handlers` if any behavior is needed
- [ ] All reactive state is declared in `$defs` with `signal: true`
- [ ] All handler names used in `onclick` etc. are declared in `$defs` with `$handler: true`
- [ ] `component.js` default export has a key for every `$handler: true` declaration
- [ ] All `$compute` expressions declare their `$deps` explicitly
- [ ] Cross-component state is passed via `$props`, not assumed from global scope
- [ ] Server-timed `Request` prototypes use only statically resolvable URLs

---

*JSONsx Specification v0.8.0-draft — subject to revision*
