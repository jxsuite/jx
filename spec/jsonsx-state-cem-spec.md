# JSONsx State & CEM Adoption Specification
## Separating Types from State · Custom Elements Manifest Integration

**Version:** 1.0.0-draft
**Status:** Proposal
**License:** MIT
**Supersedes:** [JSONsx Spec §5 ($defs Grammar)](./spec.md#5-the-defs-grammar)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Motivation](#2-motivation)
3. [The New Document Model](#3-the-new-document-model)
4. [`$defs` — Pure Type Definitions](#4-defs--pure-type-definitions)
5. [`state` — Runtime Variables](#5-state--runtime-variables)
6. [State Entry Shapes](#6-state-entry-shapes)
7. [Type References on State Entries](#7-type-references-on-state-entries)
8. [Private State (`#` prefix)](#8-private-state--prefix)
9. [Computed Values](#9-computed-values)
10. [Functions](#10-functions)
11. [Data Sources (Prototypes)](#11-data-sources-prototypes)
12. [References (`$ref`) in the New Model](#12-references-ref-in-the-new-model)
13. [Template Strings in the New Model](#13-template-strings-in-the-new-model)
14. [Dropping `signal: true`](#14-dropping-signal-true)
15. [CEM-Compatible Element Annotations](#15-cem-compatible-element-annotations)
16. [CEM Generation](#16-cem-generation)
17. [Consistency Across Document Types](#17-consistency-across-document-types)
18. [Migration Guide](#18-migration-guide)

---

## 1. Overview

This specification proposes two changes to the JSONsx document model:

1. **Separate `$defs` from `state`** — `$defs` becomes a pure JSON Schema type definition space. A new root-level `state` property holds all runtime variables. The two complement each other but have distinct purposes.

2. **Adopt CEM-compatible annotations** — Custom element definitions enrich their existing properties (`observedAttributes`, slot nodes, function emits) with metadata from the [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) specification. This enables mechanical CEM extraction without introducing a parallel declaration format.

The goal is consistency: `$defs` and `state` work identically across pages, apps, and elements. Elements gain a few CEM-compatible annotations that are additive, not structural.

---

## 2. Motivation

### 2.1 The Problem: `$defs` Does Too Much

The current `$defs` grammar serves five roles simultaneously:

| Shape | Role | Runtime artifact | Tooling artifact |
|---|---|---|---|
| Naked value | Reactive state | `ref()` | None |
| Expanded signal | Reactive state + type | `ref()` | Type schema |
| Template string | Computed value | `computed()` | None |
| `$prototype: "Function"` | Callable / derived | Function or `computed()` | None |
| `$prototype: <Class>` | Data source | Resolved value | None |
| Pure type def (no `default`) | Type only | Nothing | Schema |

Type definitions and runtime variables live in the same namespace, distinguished only by shape detection heuristics. This creates ambiguity (expanded signal vs. pure type def is a single keyword apart), makes `$ref` paths serve double duty (type navigation vs. value reading), and forces the studio to reverse-engineer which entries are configurable.

### 2.2 The Problem: No Standard Control Surface

When the studio needs to render a property panel for a custom element, it has no standard description of that element's public interface. For JSONsx-native elements, it parses the JSON definition. For third-party web components (Shoelace, Lit, etc.), it has nothing.

The Custom Elements Manifest (CEM) is the web components community standard for describing element interfaces. Adopting CEM-compatible annotations on existing JSONsx structures means the studio can consume both JSONsx elements and third-party components through a single codepath.

### 2.3 The Solution

- `$defs` holds **types** — reusable schemas, validation shapes, documentation
- `state` holds **variables** — everything that exists at runtime
- State entries **explicitly reference** their types via `$ref` into `$defs` or external files
- CEM metadata is **annotated on existing properties**, not declared in parallel arrays
- CEM generation is **extraction** — a filter that reads existing structures, not a transformation

---

## 3. The New Document Model

### Before (current)

```json
{
  "$defs": {
    "count": { "type": "integer", "default": 0, "minimum": 0 },
    "TodoItem": { "type": "object", "properties": { ... } },
    "label": "${$defs.count} items",
    "addItem": { "$prototype": "Function", "body": "..." },
    "posts": { "$prototype": "Request", "url": "/api", "signal": true }
  },
  "tagName": "div",
  "children": [...]
}
```

### After (proposed)

```json
{
  "$defs": {
    "Count": { "type": "integer", "minimum": 0 },
    "TodoItem": { "type": "object", "properties": { ... } }
  },
  "state": {
    "count": { "type": { "$ref": "#/$defs/Count" }, "default": 0 },
    "label": "${state.count} items",
    "addItem": { "$prototype": "Function", "body": "..." },
    "posts": { "$prototype": "Request", "url": "/api" }
  },
  "tagName": "div",
  "children": [...]
}
```

---

## 4. `$defs` — Pure Type Definitions

`$defs` contains only JSON Schema 2020-12 type definitions. No runtime artifacts are produced from `$defs`.

```json
{
  "$defs": {
    "Count": { "type": "integer", "minimum": 0, "maximum": 100 },
    "Status": { "type": "string", "enum": ["idle", "loading", "success", "error"] },
    "TodoItem": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    },
    "PostFrontmatter": { "$ref": "./schemas/PostFrontmatter.schema.json" }
  }
}
```

### Rules

- Every `$defs` entry is a JSON Schema — it has `type`, `properties`, `enum`, `$ref`, etc.
- No `default`, `$prototype`, `body`, `signal`, or template strings
- Naming convention: PascalCase for object types (`TodoItem`), camelCase for scalar types (`count`, `status`)
- `$defs` entries are referenced from `state` entries, `observedAttributes`, or external documents
- `$defs` is optional — state entries can declare types inline or omit types entirely
- This aligns `$defs` with its standard JSON Schema 2020-12 meaning

---

## 5. `state` — Runtime Variables

`state` is a new root-level property containing all runtime variables. Everything in `state` is initialized inside Vue's `reactive()`, making all entries reactive by default.

```json
{
  "state": {
    "count": 0,
    "tasks": [],
    "label": "${state.count} items",
    "#cache": {},
    "allPosts": { "$prototype": "Request", "url": "/api/posts" },
    "onSearch": { "$prototype": "Function", "body": "..." }
  }
}
```

### Rules

- Every `state` entry produces a runtime value
- All entries are reactive by default (no `signal: true` needed)
- `#`-prefixed entries are private (see [Section 8](#8-private-state--prefix))
- Template strings are computed values (see [Section 9](#9-computed-values))
- `$prototype` entries are functions or data sources (see [Sections 10–11](#10-functions))
- Naked values (strings, numbers, booleans, arrays, objects) are mutable reactive state
- `state` replaces `$defs` as the runtime scope for all document types

---

## 6. State Entry Shapes

The shape detection algorithm simplifies from the current five-shape grammar to four shapes. The "pure type definition" shape moves to `$defs` and is no longer part of the detection algorithm.

### Shape 1 — Naked Value

```json
"state": {
  "count": 0,
  "name": "untitled",
  "visible": true,
  "items": [1, 2, 3],
  "config": { "theme": "dark" }
}
```

Any JSON primitive, array, or plain object. Produces a mutable reactive property.

### Shape 2 — Typed Value

```json
"state": {
  "count": { "type": { "$ref": "#/$defs/Count" }, "default": 0 },
  "status": { "type": { "type": "string", "enum": ["idle", "loading"] }, "default": "idle" }
}
```

An object with `type` and `default`, no `$prototype`. The `type` is used for validation and studio rendering. The `default` is the initial runtime value. See [Section 7](#7-type-references-on-state-entries) for type reference options.

**Discriminator:** has `default`, has `type`, no `$prototype`.

### Shape 3 — Computed (Template String)

```json
"state": {
  "label": "${state.count} items",
  "isActive": "${state.filter === 'active'}",
  "titleClass": "${state.score >= 90 ? 'gold' : 'silver'}"
}
```

A string containing `${}`. Produces a `computed()`. Inherently reactive — dependencies are tracked automatically by Vue.

### Shape 4 — Prototype (`$prototype`)

```json
"state": {
  "addItem": { "$prototype": "Function", "body": "..." },
  "posts": { "$prototype": "Request", "url": "/api/posts" },
  "markdown": { "$prototype": "MarkdownCollection", "$src": "..." }
}
```

An object with `$prototype`. Produces a function, data source, or external class instance. See [Sections 10–11](#10-functions).

### Detection Algorithm

```
For each entry in state:

1. Value is a string containing "${"?
   → Shape 3: Computed (computed())

2. Value is a string, number, boolean, null, or array?
   → Shape 1: Naked value (reactive property)

3. Value is an object with "$prototype"?
   → Shape 4: Prototype (function, data source, or external class)

4. Value is an object with "type" and "default" (no "$prototype")?
   → Shape 2: Typed value (reactive property with type metadata)

5. Value is a plain object (no reserved keys)?
   → Shape 1: Object value (reactive property)
```

---

## 7. Type References on State Entries

State entries declare their types explicitly. Types are never inferred by matching names against `$defs`. Three forms are supported:

### 7.1 Reference to `$defs`

```json
{
  "$defs": {
    "Count": { "type": "integer", "minimum": 0, "maximum": 100 }
  },
  "state": {
    "count": { "type": { "$ref": "#/$defs/Count" }, "default": 0 }
  }
}
```

The `type` property contains a JSON Schema `$ref` pointing to a `$defs` entry. The studio resolves the reference and uses the full schema for form rendering (integer input with min 0, max 100).

### 7.2 Inline Type

```json
{
  "state": {
    "status": {
      "type": { "type": "string", "enum": ["idle", "loading", "success", "error"] },
      "default": "idle"
    }
  }
}
```

The `type` property contains a JSON Schema object directly. No `$defs` entry needed. Use for one-off types that aren't reused.

### 7.3 External Reference

```json
{
  "state": {
    "config": {
      "type": { "$ref": "./schemas/AppConfig.schema.json" },
      "default": {}
    }
  }
}
```

The `type` property contains a `$ref` pointing to an external JSON Schema file. The runtime ignores the type (it's tooling-only); the studio and compiler resolve it for validation and form rendering.

### 7.4 No Type (Naked Values)

```json
{
  "state": {
    "count": 0,
    "items": []
  }
}
```

Naked values have no explicit type. The studio can infer basic types from the default value (`0` → number, `""` → string, `[]` → array) but has no constraints, enums, or descriptions. Use naked values for internal state that doesn't need studio controls.

### 7.5 Type References on Prototypes

Data sources and functions can also carry type references — typically for their return type:

```json
{
  "$defs": {
    "Post": { "type": "object", "properties": { "id": { "type": "integer" }, "title": { "type": "string" } } }
  },
  "state": {
    "allPosts": {
      "$prototype": "Request",
      "url": "/api/posts",
      "type": { "type": "array", "items": { "$ref": "#/$defs/Post" } }
    }
  }
}
```

For data sources, `type` describes the resolved value's shape. For typed functions, see "Computed with return type" in [Section 10](#10-functions). The CEM generator uses this to populate the `type` field on emitted members.

---

## 8. Private State (`#` prefix)

State entries prefixed with `#` are private. They are never exposed to the studio property panel, never included in CEM extraction, and never settable by a parent element via `$props`.

```json
{
  "state": {
    "count": 0,
    "#cache": {},
    "#lastFetchTime": null,
    "label": "${state.count} items"
  }
}
```

### Rules

- `#foo` is accessible within the component as `state.#foo` in function bodies (compiled to a local variable reference)
- The `#` prefix is stripped in the reactive scope — the runtime property name is `_foo` (development) or `#foo` (compiled)
- Private entries are excluded from CEM `members` output
- Private entries are not settable via `$props`
- Private entries do not appear in the studio sidebar
- `#` can be combined with any shape: `"#cache": {}`, `"#internal": "${state.count * 2}"`, `"#fetcher": { "$prototype": "Request", ... }`

---

## 9. Computed Values

A computed value is a reactive derived value that re-evaluates when its dependencies change.

### 9.1 Template String (simple)

```json
"state": {
  "label": "${state.count} items",
  "isActive": "${state.filter === 'active'}"
}
```

Any string value containing `${}` is a computed. Implemented as `computed(() => `...`)`. The expression must be pure — no statements, no assignments.

### 9.2 Function with Return Value (complex)

When a computed needs logic beyond a single expression, use a `$prototype: "Function"` entry that returns a value. The runtime detects that the function reads reactive dependencies and wraps it in `computed()` automatically:

```json
"state": {
  "filteredPosts": {
    "$prototype": "Function",
    "body": "const f = state.filter; if (f === 'active') return state.tasks.filter(t => !t.done); return state.tasks;"
  }
}
```

### 9.3 How the Runtime Distinguishes Computed from Handler

In the current model, `signal: true` explicitly marks a `$prototype: "Function"` as computed. In the new model, this flag is dropped (see [Section 14](#14-dropping-signal-true)). The runtime distinguishes computed from handler by context:

- A function referenced by an event handler (`onclick`, `oninput`, etc.) → **handler**
- A function referenced by a template string or `$ref` in a property binding → **computed**
- A function with a `return` statement and no event-handler references → **computed**
- A function with no `return` and called only from event contexts → **handler**

The compiler has full visibility over the document tree and makes this determination at build time. The runtime applies `computed()` wrapping when a function's return value is observed reactively.

---

## 10. Functions

Functions in `state` use the same `$prototype: "Function"` convention as before, with one change: `$defs` references in function bodies become `state` references.

### 10.1 Inline Handler

```json
"state": {
  "addTask": {
    "$prototype": "Function",
    "body": "const text = state.newTaskText.trim(); if (!text) return; state.tasks.push({ id: state.nextId++, text, done: false }); state.newTaskText = ''"
  }
}
```

### 10.2 Handler with Parameters

```json
"state": {
  "onSearch": {
    "$prototype": "Function",
    "parameters": [{ "name": "event", "type": { "text": "Event" } }],
    "body": "state.searchTerm = event.target.value; state.currentPage = 1;"
  }
}
```

Note: `parameters` replaces `arguments`. The new property uses the CEM `Parameter` shape (`{ name, type, description, optional, default }`) instead of a bare string array. Bare string arrays remain accepted for backward compatibility.

### 10.3 External Function

```json
"state": {
  "filteredPosts": {
    "$prototype": "Function",
    "$src": "./fetch-demo.js"
  }
}
```

### 10.4 Function Properties

| Property | Required | Description |
|---|---|---|
| `$prototype` | Yes | Must be `"Function"` |
| `body` | If no `$src` | Function body string |
| `parameters` | No | Array of CEM-compatible parameter objects or bare strings |
| `$src` | If no `body` | External module specifier |
| `$export` | No | Named export in `$src` module. Default: state key name |
| `description` | No | Documentation string |
| `type` | No | Return type (JSON Schema or CEM `{ text }`) for tooling |
| `emits` | No | Array of CEM `Event` objects this function dispatches (see [Section 15.3](#153-events-emits-on-functions)) |

### 10.5 Accessing State in Function Bodies

Within function `body` strings and external `.js` files, state is accessed via the `state` object:

```js
// Read
const current = state.count;

// Write
state.count = current + 1;

// Mutate array (Vue tracks mutations)
state.tasks.push(newItem);

// Mutate nested object
state.config.theme = 'dark';
```

This replaces `$defs.count` with `state.count`. The runtime provides `state` as the reactive proxy to all function bodies.

---

## 11. Data Sources (Prototypes)

Built-in and external class prototypes work the same as before, declared in `state` instead of `$defs`:

### 11.1 Built-in Prototypes

```json
"state": {
  "posts": {
    "$prototype": "Request",
    "url": "/api/posts",
    "type": { "type": "array", "items": { "$ref": "#/$defs/Post" } }
  },
  "params": { "$prototype": "URLSearchParams" },
  "prefs": { "$prototype": "LocalStorage", "key": "user-prefs" }
}
```

### 11.2 External Classes

```json
"state": {
  "posts": {
    "$prototype": "MarkdownCollection",
    "$src": "../../packages/parser/MarkdownCollection.class.json",
    "src": "./content/posts/*.md",
    "sortBy": "frontmatter.date",
    "type": { "type": "array" }
  }
}
```

### 11.3 `signal: true` Is No Longer Needed

All state entries are reactive by default. The `signal: true` flag is dropped. See [Section 14](#14-dropping-signal-true).

---

## 12. References (`$ref`) in the New Model

`$ref` paths change to reflect the `$defs`/`state` split:

| Old path | New path | Meaning |
|---|---|---|
| `#/$defs/count` | `#/state/count` | Read a runtime value |
| `#/$defs/TodoItem` | `#/$defs/TodoItem` | Reference a type schema |
| `#/$defs/addTask` | `#/state/addTask` | Reference a function |
| `$map/item` | `$map/item` | Mapped array item (unchanged) |

### In Element Properties

```json
{
  "tagName": "input",
  "value": { "$ref": "#/state/searchTerm" },
  "oninput": { "$ref": "#/state/onSearch" }
}
```

### In `$props`

```json
{
  "tagName": "task-item",
  "$props": {
    "task": { "$ref": "$map/item" },
    "tasks": { "$ref": "#/state/tasks" }
  }
}
```

### In Type References

```json
{
  "state": {
    "count": { "type": { "$ref": "#/$defs/Count" }, "default": 0 }
  }
}
```

The split makes `$ref` unambiguous: `#/$defs/...` is always a type, `#/state/...` is always a value.

---

## 13. Template Strings in the New Model

Template strings reference `state` instead of `$defs`:

### Before

```json
"textContent": "${$defs.count} items remaining"
"style": { "color": "${$defs.active ? 'blue' : 'gray'}" }
```

### After

```json
"textContent": "${state.count} items remaining"
"style": { "color": "${state.active ? 'blue' : 'gray'}" }
```

The `state` prefix in template strings refers to the current component's reactive scope, same as `$defs` did before. Within `state` itself, computed template strings reference sibling entries:

```json
"state": {
  "count": 0,
  "label": "${state.count} items"
}
```

---

## 14. Dropping `signal: true`

Vue's `reactive()` makes all state entries reactive by default. The `signal: true` flag served two purposes that are now unnecessary:

### 14.1 On Expanded Signals / Data Sources

`signal: true` wrapped the resolved value in `ref()`. Since everything in `state` is inside `reactive()`, which deeply tracks all properties, explicit wrapping is redundant.

### 14.2 On Functions (Computed vs. Handler)

`signal: true` distinguished computed functions from handlers. This distinction is now made by the runtime/compiler based on usage context (see [Section 9.3](#93-how-the-runtime-distinguishes-computed-from-handler)).

### 14.3 Performance

The concern that making everything reactive wastes resources is addressed by the compiler: static compilation bakes values at build time, removing them from the reactive system entirely. This is already part of the framework via `timing: "compiler"` / `timing: "server"`. Performance-sensitive deployments compile; development mode runs everything reactively for convenience.

---

## 15. CEM-Compatible Element Annotations

Custom element definitions enrich their **existing** JSONsx properties with CEM metadata. No new root-level arrays are introduced. The CEM is extracted from what's already in the document.

### 15.1 Observed Attributes

Currently `observedAttributes` is a string array:

```json
"observedAttributes": ["my-label", "task-id"]
```

Entries may optionally be objects with CEM `Attribute` properties:

```json
"observedAttributes": [
  "my-label",
  {
    "name": "task-id",
    "type": { "text": "string" },
    "description": "Unique task identifier",
    "fieldName": "taskId"
  }
]
```

**Rules:**
- String entries remain supported — `fieldName` is derived via the existing kebab→camelCase convention, `type` is inferred from the matching `state` entry's `type` or value
- Object entries use CEM `Attribute` shape: `{ name, type, description, fieldName, default, deprecated }`
- `fieldName` on an object entry links the attribute to a `state` property. If omitted, kebab→camelCase applies
- The `reflects` property can be set on the matching `state` entry (see Section 15.5)

### 15.2 Slots

Slots are already embedded in the `children` tree as `{ "tagName": "slot" }` nodes. CEM metadata is added directly on those nodes:

```json
{
  "tagName": "slot",
  "description": "The component's main body content"
}
```

```json
{
  "tagName": "slot",
  "name": "header",
  "description": "Content for the header area"
}
```

**Extraction:** The CEM generator scans `children` (recursively) for `{ tagName: "slot" }` nodes and collects `{ name, description }` from each. Default slot has `name: ""`.

### 15.3 Events — `emits` on Functions

Events the element *dispatches* (its public event API) are declared via an `emits` property on the function that dispatches them:

```json
"state": {
  "toggle": {
    "$prototype": "Function",
    "body": "state.task.done = !state.task.done; this.dispatchEvent(new CustomEvent('task-toggled', { detail: state.task }));",
    "emits": [
      {
        "name": "task-toggled",
        "type": { "text": "CustomEvent" },
        "description": "Fired when the task's completion state changes"
      }
    ]
  }
}
```

**Rules:**
- `emits` is an array of CEM `Event` objects: `{ name, type, description, deprecated }`
- `emits` is optional — if omitted, the compiler can still scan `body` for `CustomEvent('...')` patterns to generate CEM events
- Explicit `emits` is preferred when the event needs a description or typed detail payload
- The CEM generator collects all `emits` from all `state` functions and deduplicates by event name

### 15.4 CSS Custom Properties

CSS custom properties are already declared in the `style` object via `var(--...)` usage. CEM metadata can be added via a `cssProperties` key on the `style` object:

```json
"style": {
  "color": "var(--task-color, #333)",
  "padding": "var(--task-spacing, 0.5rem)",
  "cssProperties": [
    { "name": "--task-color", "syntax": "<color>", "default": "#333", "description": "Text color for task items" },
    { "name": "--task-spacing", "syntax": "<length>", "default": "0.5rem", "description": "Internal padding" }
  ]
}
```

**Rules:**
- `cssProperties` is an optional array of CEM `CssCustomProperty` objects on the `style` object
- If omitted, the CEM generator scans `var(--name, default)` usage in the style tree and generates entries with name and default but no description or syntax
- Explicit `cssProperties` adds descriptions and CSS syntax types for richer studio controls

### 15.5 CSS Parts

CSS parts are declared via `part` attributes on elements in the `children` tree:

```json
{
  "tagName": "span",
  "attributes": { "part": "label" },
  "description": "The task text",
  "textContent": "${state.task.text}"
}
```

**Extraction:** The CEM generator scans `children` for elements with a `part` attribute and collects `{ name: attributes.part, description }` from each.

### 15.6 State Entry CEM Annotations

Individual state entries can carry CEM-compatible properties that enrich the generated `members`:

```json
"state": {
  "count": {
    "type": { "$ref": "#/$defs/Count" },
    "default": 0,
    "description": "Current counter value",
    "attribute": "count",
    "reflects": true
  }
}
```

| Property | CEM equivalent | Description |
|---|---|---|
| `description` | `description` | Human-readable description |
| `type` | `type` | Type schema (resolved to `{ text }` for CEM) |
| `attribute` | `attribute` | Linked HTML attribute name |
| `reflects` | `reflects` | Whether property changes reflect back to the attribute |
| `deprecated` | `deprecated` | Deprecation notice (boolean or string) |

These properties are only meaningful for studio and CEM generation — the runtime ignores them.

---

## 16. CEM Generation

The CEM is extracted mechanically from the JSONsx document. No transformation logic is needed — each CEM field maps to an existing JSONsx structure.

### 16.1 Members — from `state`

Each `state` entry maps to a CEM `ClassMember`:

| State shape | CEM member kind | Notes |
|---|---|---|
| Naked value | `kind: "field"` | `default` from value, `type` inferred |
| Typed value | `kind: "field"` | `default` and `type` from entry |
| Template string | `kind: "field"`, `readonly: true` | Computed/derived |
| `$prototype: "Function"` (handler) | `kind: "method"` | `parameters` from entry |
| `$prototype: "Function"` (computed) | `kind: "field"`, `readonly: true` | Return type from `type` if present |
| `$prototype: <Class>` | `kind: "field"` | `type` from entry, `default: null` |
| `#`-prefixed entry | `privacy: "private"` | Any of the above |

### 16.2 Attributes — from `observedAttributes`

String entries are expanded to `{ name, fieldName, type }` using kebab→camelCase and the matching state entry's type. Object entries are passed through as-is.

### 16.3 Events — from `emits`

All `emits` arrays across all `state` functions are collected and deduplicated by `name`. If no explicit `emits` exist, the generator optionally scans function bodies for `CustomEvent(...)` patterns.

### 16.4 Slots — from `children` tree

Recursively scan for `{ tagName: "slot" }` nodes. Collect `{ name, description }` from each.

### 16.5 CSS Custom Properties — from `style`

Use explicit `style.cssProperties` if present. Otherwise scan `var(--name, default)` usage.

### 16.6 CSS Parts — from `children` tree

Scan for elements with `attributes.part`. Collect `{ name, description }`.

### 16.7 Output Shape

```json
{
  "schemaVersion": "2.1.0",
  "modules": [{
    "kind": "javascript-module",
    "path": "task-item.js",
    "declarations": [{
      "kind": "class",
      "name": "TaskItem",
      "customElement": true,
      "tagName": "task-item",
      "superclass": { "name": "HTMLElement", "package": "global:" },
      "members": [ ... ],
      "attributes": [ ... ],
      "events": [ ... ],
      "slots": [ ... ],
      "cssProperties": [ ... ],
      "cssParts": [ ... ]
    }],
    "exports": [
      { "kind": "js", "name": "TaskItem", "declaration": { "name": "TaskItem" } },
      { "kind": "custom-element-definition", "name": "task-item", "declaration": { "name": "TaskItem" } }
    ]
  }]
}
```

### 16.8 Third-Party Component Ingestion

The studio can consume CEM manifests from third-party web component libraries:

1. Library publishes `custom-elements.json` (declared in `package.json` via `"customElements"` field)
2. The studio reads it at design time
3. When the user places a third-party element on the canvas, the studio renders property controls from the CEM `members`, `attributes`, `events`, and `slots`
4. No adapter code needed — the same rendering logic works for JSONsx elements and third-party components

---

## 17. Consistency Across Document Types

The `$defs` + `state` split works identically for all JSONsx document types:

### Page (no custom element registration)

```json
{
  "$defs": {
    "Post": { "type": "object", "properties": { ... } }
  },
  "state": {
    "searchTerm": "",
    "allPosts": { "$prototype": "Request", "url": "/api/posts" },
    "onSearch": { "$prototype": "Function", "body": "..." }
  },
  "tagName": "div",
  "children": [...]
}
```

### Custom Element

```json
{
  "$defs": {
    "TaskItem": { "type": "object", "properties": { ... } }
  },
  "state": {
    "task": {},
    "tasks": [],
    "toggleDone": { "$prototype": "Function", "body": "..." }
  },
  "tagName": "task-item",
  "observedAttributes": ["task-id"],
  "$elements": [...],
  "children": [...]
}
```

### App (multiple pages/components)

```json
{
  "$defs": {
    "AppConfig": { "$ref": "./schemas/config.schema.json" }
  },
  "state": {
    "config": { "type": { "$ref": "#/$defs/AppConfig" }, "default": {} },
    "#router": { "$prototype": "Function", "body": "..." }
  },
  "tagName": "div",
  "children": [...]
}
```

The authoring experience is uniform:
- `$defs` for types, `state` for variables — always
- `#` for private — always
- Template strings for computed — always
- `$prototype` for functions and data sources — always
- `$ref` into `#/state/` for values, `#/$defs/` for types — always

Elements add `observedAttributes`, `$elements`, and CEM-compatible annotations atop the same base structure. No special syntax, no mode switching.

---

## 18. Migration Guide

### 18.1 Automated Migration

A codemod can perform the migration mechanically:

1. **Split `$defs`:**
   - Entries with `$prototype`, `default`, template strings, naked values, arrays → move to `state`
   - Pure type definitions (object with `type`/`properties`/`items` but no `default`, no `$prototype`) → keep in `$defs`

2. **Rename references:**
   - `#/$defs/<name>` where `<name>` was a state entry → `#/state/<name>`
   - `$defs.<name>` in template strings → `state.<name>`
   - `$defs.<name>` in function bodies → `state.<name>`

3. **Drop `signal: true`:**
   - Remove from all entries (no longer needed)

4. **Rename `arguments` to `parameters`:**
   - Convert bare string arrays to CEM parameter objects: `["event"]` → `[{ "name": "event" }]`
   - Bare string arrays remain accepted (backward compat)

### 18.2 Backward Compatibility

During transition, the runtime and compiler accept both `$defs`-only (legacy) and `$defs`+`state` (new) documents. Detection:

- If `state` property exists → new model
- If `state` is absent and `$defs` contains runtime entries → legacy model, apply old shape detection

This allows incremental migration. A deprecation warning is emitted for legacy documents.

---

## Appendix A — Fetch Demo (Migrated)

### Before

```json
{
  "$defs": {
    "searchTerm":     { "type": "string",  "default": "" },
    "selectedUserId": { "type": "string",  "default": "" },
    "currentPage":    { "type": "integer", "default": 1 },
    "perPage":        { "type": "integer", "default": 10 },
    "allPosts":       { "$prototype": "Request", "url": "https://jsonplaceholder.typicode.com/posts", "signal": true },
    "filteredPosts":  { "$prototype": "Function", "$src": "./fetch-demo.js", "signal": true },
    "onSearch":       { "$prototype": "Function", "arguments": ["event"], "body": "$defs.searchTerm = event.target.value;" }
  }
}
```

### After

```json
{
  "$defs": {
    "SearchTerm": { "type": "string" },
    "PageNumber": { "type": "integer", "minimum": 1 }
  },
  "state": {
    "searchTerm":     { "type": { "$ref": "#/$defs/SearchTerm" }, "default": "" },
    "selectedUserId": "",
    "currentPage":    { "type": { "$ref": "#/$defs/PageNumber" }, "default": 1 },
    "perPage":        10,
    "allPosts":       { "$prototype": "Request", "url": "https://jsonplaceholder.typicode.com/posts", "type": { "type": "array" } },
    "filteredPosts":  { "$prototype": "Function", "$src": "./fetch-demo.js", "type": { "type": "array" } },
    "onSearch": {
      "$prototype": "Function",
      "parameters": [{ "name": "event", "type": { "text": "Event" } }],
      "body": "state.searchTerm = event.target.value; state.currentPage = 1;"
    }
  }
}
```

---

## Appendix B — Task Item Element (Migrated with CEM Annotations)

```json
{
  "$schema": "../../../packages/schema/schema.json",
  "$id": "TaskItem",
  "tagName": "task-item",

  "$defs": {
    "Task": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    }
  },

  "state": {
    "task": { "type": { "$ref": "#/$defs/Task" }, "default": {}, "description": "The task object" },
    "tasks": { "type": { "type": "array", "items": { "$ref": "#/$defs/Task" } }, "default": [] },

    "toggleDone": {
      "$prototype": "Function",
      "description": "Toggle the task's completion state",
      "body": "const t = state.task; const idx = state.tasks.findIndex(x => x.id === t.id); if (idx >= 0) state.tasks[idx] = { ...t, done: !t.done }",
      "emits": [{ "name": "task-toggled", "type": { "text": "CustomEvent" } }]
    },

    "removeTask": {
      "$prototype": "Function",
      "description": "Remove the task from the list",
      "body": "const t = state.task; const idx = state.tasks.findIndex(x => x.id === t.id); if (idx >= 0) state.tasks.splice(idx, 1)"
    }
  },

  "style": {
    "display": "flex",
    "alignItems": "center",
    "gap": "0.75em",
    "padding": "0.75em 1em",
    "borderBottom": "1px solid #eee",
    ":last-child": { "borderBottom": "none" },
    "cssProperties": [
      { "name": "--task-spacing", "syntax": "<length>", "default": "0.75em", "description": "Vertical padding" }
    ]
  },

  "children": [
    {
      "tagName": "input",
      "attributes": { "type": "checkbox", "checked": "${state.task.done ? '' : undefined}" },
      "onclick": { "$ref": "#/state/toggleDone" },
      "style": { "cursor": "pointer", "width": "18px", "height": "18px" }
    },
    {
      "tagName": "span",
      "attributes": { "part": "label" },
      "description": "The task text",
      "textContent": "${state.task.text}",
      "style": {
        "flex": "1",
        "textDecoration": "${state.task.done ? 'line-through' : 'none'}",
        "color": "${state.task.done ? '#999' : '#333'}"
      }
    },
    {
      "tagName": "button",
      "textContent": "\u00d7",
      "onclick": { "$ref": "#/state/removeTask" },
      "style": {
        "border": "none", "background": "none", "color": "#dc3545",
        "fontSize": "1.25em", "cursor": "pointer", "padding": "0 0.25em",
        ":hover": { "color": "#a71d2a" }
      }
    }
  ]
}
```

**Generated CEM excerpt:**

```json
{
  "kind": "class",
  "name": "TaskItem",
  "customElement": true,
  "tagName": "task-item",
  "superclass": { "name": "HTMLElement", "package": "global:" },
  "members": [
    { "kind": "field", "name": "task", "type": { "text": "Task" }, "default": "{}", "description": "The task object" },
    { "kind": "field", "name": "tasks", "type": { "text": "Array<Task>" }, "default": "[]" },
    { "kind": "method", "name": "toggleDone", "description": "Toggle the task's completion state" },
    { "kind": "method", "name": "removeTask", "description": "Remove the task from the list" }
  ],
  "events": [
    { "name": "task-toggled", "type": { "text": "CustomEvent" } }
  ],
  "slots": [],
  "cssParts": [
    { "name": "label", "description": "The task text" }
  ],
  "cssProperties": [
    { "name": "--task-spacing", "syntax": "<length>", "default": "0.75em", "description": "Vertical padding" }
  ]
}
```

---

## Appendix C — Checklist

When migrating or creating a JSONsx document:

- [ ] Types in `$defs`, variables in `state` — never mix
- [ ] State entries that need studio controls have an explicit `type` referencing `$defs` or inline
- [ ] State entries that are internal use `#` prefix
- [ ] Template strings reference `state.` not `$defs.`
- [ ] Function bodies reference `state.` not `$defs.`
- [ ] `$ref` paths use `#/state/` for values and `#/$defs/` for types
- [ ] No `signal: true` on any entry
- [ ] `parameters` on functions (not `arguments`) for CEM compatibility
- [ ] Slot elements in children have `description` for CEM extraction
- [ ] Functions that dispatch events have `emits` for CEM extraction
- [ ] CSS custom properties documented via `style.cssProperties` for CEM extraction
