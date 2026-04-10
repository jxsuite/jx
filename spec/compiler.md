# `@jsonsx/compiler` Specification
## Static HTML Compiler, Custom Element Emitter, and Island Detector

**Version:** 2.0.0-draft
**Status:** In Progress
**License:** MIT

---

## 1. Overview

The JSONsx compiler transforms `.json` component files into optimized production artifacts. It erases all JSONsx abstractions at build time — no JSON, no runtime, and no JSONsx code ships to production. The compiler auto-detects the appropriate output target based on document analysis.

**Production dependencies:** `@vue/reactivity` (~7 kB gzip) + `lit-html` (~3 kB gzip).

---

## 2. Compilation Routes

The compiler inspects each input document and routes to the appropriate compilation target:

| Route | Condition | Output | Status |
|---|---|---|---|
| 0 — Class | Input is `.class.json` | ES class module | **Implemented** |
| 1 — Static | `isDynamic()` returns false | Plain HTML/CSS, zero JS | **Implemented** |
| 2 — Custom Element | Root `tagName` contains hyphen | `class extends HTMLElement` + lit-html | **Implemented** |
| 3 — Dynamic Page | `isDynamic()` returns true, no hyphen | Pre-rendered HTML + reactive JS | **Implemented** |
| 4 — Server | Document has `timing: "server"` entries | Hono server handler file | **Implemented** |

### 2.1 Static Detection (`isDynamic`)

A node is static if it and all descendants satisfy:
- No `state` entries that produce signals or functions
- No `${}` template strings in any property value
- No `$prototype` namespaces
- No `$switch` nodes
- No `$prototype: "Array"` children
- No `$ref` bindings on element properties

Static detection is a single recursive tree walk — no code execution required.

> **Status: Implemented.** `isDynamic()` in `shared.js` performs complete recursive analysis.

---

## 3. Output Tiers

| Component surface | Compiler output |
|---|---|
| Fully static subtree | Plain HTML, zero JS |
| Naked value with `${}` in document | HTML + `effect()` only |
| Template string signal | HTML + `computed()` + `effect()` |
| `$prototype: "Function"` | HTML + function + handler wiring |
| External class with `timing: "compiler"` | HTML with baked response data |
| External class with `timing: "client"` | HTML + runtime hydration |
| Server function (`timing: "server"`) | HTML + client fetch + generated server handler |
| Custom element (hyphenated `tagName`) | `class extends HTMLElement` + lit-html template |
| Pure type definition (`$defs`) | No output |

---

## 4. Custom Element Compilation

### 4.1 Output Structure

For each custom element, the compiler emits a self-contained ES module:

1. Imports for `@vue/reactivity` and `lit-html`
2. Imports for `$elements` dependencies (sub-component registrations)
3. `class extends HTMLElement` with reactive state and lit-html template
4. Static CSS extracted to a `<style>` block
5. `customElements.define()` registration call

### 4.2 Example

**Input** (`user-card.json`):
```json
{
  "tagName": "user-card",
  "state": {
    "username": "Guest",
    "status": "online",
    "displayStatus": "${state.status === 'online' ? 'Available' : 'Away'}",
    "setAway": {
      "$prototype": "Function",
      "body": "state.status = 'away'"
    }
  },
  "style": { "display": "block", "padding": "1em" },
  "children": [
    { "tagName": "h3", "textContent": "${state.username}" },
    { "tagName": "button", "textContent": "Set Away", "onclick": { "$ref": "#/state/setAway" } }
  ]
}
```

**Output** (`user-card.js`):
```js
import { reactive, computed, effect } from '@vue/reactivity';
import { render, html } from 'lit-html';

class UserCard extends HTMLElement {
  #dispose = null;

  constructor() {
    super();
    this.state = reactive({
      username: 'Guest',
      status: 'online',
    });
    this.state.displayStatus = computed(
      () => this.state.status === 'online' ? 'Available' : 'Away'
    );
    this.state.setAway = (state) => { state.status = 'away' };
  }

  template() {
    const s = this.state;
    return html`
      <h3>${s.username}</h3>
      <button @click="${() => s.setAway(s)}">Set Away</button>
    `;
  }

  connectedCallback() {
    for (const key of Object.keys(this.state)) {
      if (key in this && this[key] !== undefined) {
        this.state[key] = this[key];
      }
    }
    this.#dispose = effect(() => render(this.template(), this));
  }

  disconnectedCallback() {
    if (this.#dispose) { this.#dispose(); this.#dispose = null; }
  }
}

customElements.define('user-card', UserCard);
```

### 4.3 lit-html Binding Syntax

| JSONsx | lit-html | What it does |
|---|---|---|
| `"textContent": "${state.name}"` | `${s.name}` | Reactive text |
| `"onclick": { "$ref": "#/state/fn" }` | `@click="${() => s.fn(s)}"` | Event listener |
| `"$props": { "items": { "$ref": "..." } }` | `.items="${s.items}"` | JS property (by reference) |
| `"hidden": "${state.loading}"` | `?hidden="${s.loading}"` | Boolean attribute |
| `"className": "${state.cls}"` | `class="${s.cls}"` | Attribute binding |
| `"style": { "color": "${state.c}" }` | `style="color: ${s.c}"` | Inline style |

The `.property` syntax is the key enabler for the property-first interface.

### 4.4 Property Bridge

`connectedCallback` merges JS properties set before connection into reactive state:

```js
connectedCallback() {
  for (const key of Object.keys(this.state)) {
    if (key in this && this[key] !== undefined) {
      this.state[key] = this[key];
    }
  }
  this.#dispose = effect(() => render(this.template(), this));
}
```

### 4.5 Nested CSS

```json
{ "style": { "display": "block", ":hover": { "backgroundColor": "#f0f0f0" } } }
```

Emits:
```css
user-card { display: block; }
user-card:hover { background-color: #f0f0f0; }
```

### 4.6 `$elements` Dependencies

```js
import './variant-card.js';
import './variant-attribute.js';
```

Registered before the parent's `customElements.define()`.

### 4.7 Mapped Array Compilation

```js
template() {
  const s = this.state;
  return html`
    ${s.options.map((item, index) => html`
      <button-selector-choice .option="${item}"></button-selector-choice>
    `)}
  `;
}
```

### 4.8 `$switch` Compilation

```js
${s.currentRoute === 'home' ? html`<div>Home page</div>` : ''}
${s.currentRoute === 'about' ? html`<div>About page</div>` : ''}
```

> **Status: Implemented.** `compile-element.js` produces complete lit-html custom element modules.

---

## 5. `.class.json` Compilation

### 5.1 Overview

`.class.json` files are JSON Schema 2020-12 documents that define class structures. The compiler transforms them into standard ES class modules.

### 5.2 Document Format

```json
{
  "$schema": "https://jsonsx.dev/schema/v1/class",
  "$id": "MarkdownCollection",
  "description": "Globs and parses markdown files into a collection",
  "$defs": {
    "parameters": {
      "src":       { "type": "string", "description": "Glob pattern for markdown files" },
      "sortBy":    { "type": "string", "default": "date" },
      "sortOrder": { "type": "string", "default": "desc", "enum": ["asc", "desc"] },
      "limit":     { "type": "integer" }
    },
    "fields": {
      "files":    { "type": "array", "items": { "$ref": "#/$defs/fields/file" } },
      "resolved": { "type": "boolean", "default": false }
    },
    "constructor": {
      "body": "Object.assign(this, config)"
    },
    "methods": {
      "resolve": {
        "async": true,
        "body": "..."
      }
    }
  },
  "$implementation": "./md.js"
}
```

### 5.3 `$defs` Object Categories

| Category | Purpose |
|---|---|
| `parameters` | Constructor parameter properties (config object fields) |
| `fields` | Instance fields (private if `#`-prefixed) |
| `constructor` | Constructor body and super args |
| `methods` | Instance methods and accessors (`get`/`set` prefix or `accessor: true`) |
| `returnTypes` | Named return type schemas for tooling |

### 5.4 The `$implementation` Key

Links the schema to its JavaScript implementation:

```json
"$implementation": "./md.js"
```

When present, the runtime/server follows this reference to import the actual class. When absent, the compiler generates an ES class from the schema.

### 5.5 Compilation Output

The compiler emits:
- Private fields (`#name`)
- Static fields and methods
- Constructor with `super()` support
- Getters/setters (accessor methods)
- Async method detection
- `extends` clause from `$ref` or string

### 5.6 Detection and Routing

A file is a `.class.json` document when:
- File extension is `.class.json`, OR
- Root object has `$defs` with `constructor` or `methods` or `fields`, AND no `tagName`

> **Status: Implemented.** `compile-class.js` handles full `.class.json` → ES class compilation.

---

## 6. Server Compilation

### 6.1 `timing: "server"` Entries

For each `timing: "server"` entry, the compiler emits two artifacts:

1. **Client-side:** A `POST /_jsonsx/server/$export` fetch call that stores the JSON response in a signal. If any `arguments` value is reactive, the fetch is wrapped in an effect.
2. **Server-side:** A Hono handler file that imports the `$export` from `$src` and exposes it at `/_jsonsx/server/$export`.

### 6.2 Generated Server Handler

```js
import { Hono } from 'hono';
import { fetchMetrics } from './dashboard.server.js';

const app = new Hono();

app.post('/_jsonsx/server/fetchMetrics', async (c) => {
  const args = await c.req.json();
  const result = await fetchMetrics(args);
  return c.json(result);
});

export default app;
```

> **Status: Implemented.** `compile-server.js` generates Hono handlers.

---

## 7. Static Page Compilation

### 7.1 Fully Static Output

When `isDynamic()` returns false for an entire document, the compiler emits plain HTML/CSS with zero JavaScript.

### 7.2 CSS Extraction

All static `style` definitions are extracted into a single `<style>` block in `<head>`.

> **Status: Implemented.** `compile-static.js` handles zero-JS output.

---

## 8. Dynamic Page Compilation

### 8.1 Pre-rendered HTML + Reactive JS

For dynamic documents that are not custom elements, the compiler emits:
- Pre-rendered HTML from static portions
- `@vue/reactivity` bootstrapper for dynamic state
- `effect()` bindings for reactive properties

> **Status: Implemented.** `compile-client.js` handles dynamic page compilation.

---

## 9. Pending Features

| Feature | Description | Status |
|---|---|---|
| `timing: "compiler"` | Bake fetch responses into HTML at build time | **Not implemented** |
| Island serialization | `<script type="application/JSONsx+json">` hydration islands | **Not implemented** |
| Bundle manifest | Exact dependency manifest from JSON analysis | **Partially implemented** (imports collected but no standalone manifest file) |

---

## 10. Shared Utilities

### `isDynamic(def)` — Recursive static detection
### `isSchemaOnly(def)` — Shape 2b detection (pure type definitions)
### `buildInitialScope(state)` — Static scope for compile-time pre-rendering
### `compileStyles(def)` — CSS extraction from component tree
### `collectServerEntries(doc)` — Find all `timing: "server"` entries

> **Status: Implemented.** All in `shared.js`.

---

## Appendix A — Production Dependency Stack

| Package | Size (gzip) | Purpose |
|---|---|---|
| `@vue/reactivity` | ~7 kB | `reactive()`, `computed()`, `effect()` |
| `lit-html` | ~3 kB | `html`, `render()` |
| **Total** | **~10 kB** | |

---

*`@jsonsx/compiler` Specification v2.0.0-draft*
