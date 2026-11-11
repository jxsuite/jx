# Jx Specification

## Declarative Document Object Model — JSON Edition

**Version:** 0.9.9-draft\
**Status:** Partial\
**Updated:** 2026-11-11\
**License:** MIT

---

## Table of Contents

1. [Overview](#1-overview)
2. [Philosophy](#2-philosophy)
3. [Document Format](#3-document-format)
4. [The Component Model](#4-the-component-model)
5. [The `$defs` and `state` Grammar](#5-the-defs-and-state-grammar)
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
16. [Custom Element Definitions](#16-custom-element-definitions)
17. [Reserved Keywords](#17-reserved-keywords)
18. [Standards Alignment](#18-standards-alignment)
19. [Declarative Expressions](#19-declarative-expressions-expression)
20. [Structured Function Bodies](#20-structured-function-bodies-statements)
21. [Evaluation Surface](#21-evaluation-surface)
22. [Jx Notation (`.jxn`)](#22-jx-notation-jxn)
23. [TypeScript in Documents](#23-typescript-in-documents)

---

## 1. Overview

Jx is a schema and runtime for building reactive web applications using plain JSON. A Jx application is a tree of JSON objects whose structure mirrors the DOM API, whose reactivity is powered by `@vue/reactivity`, and whose behavior is declared in `state` entries as inline functions or external module references.

The core premise: **structure and state are data; the shape of each `state` entry determines its type and behavior — no additional flags required in the common case.**

A Jx component is a single `.json` or `.jxn` file (§22) that can be fully self-describing:

```
component.json   ← structure, styling, state declarations, functions, bindings
```

When handler functions grow complex, they may be extracted to an external `.js` sidecar referenced via `$src` on individual `$prototype: "Function"` entries. This is optional — simple components need no sidecar.

The JSON file is fully serializable, statically analyzable, and visual-builder-friendly.

---

## 2. Philosophy

### 2.1 DOM-First Design

Jx property names mirror standard DOM element properties. `tagName`, `className`, `textContent`, `hidden`, `tabIndex` — all map directly to their DOM equivalents. This makes the schema self-documenting to any web developer and reduces the surface area of novel concepts to learn.

### 2.2 Rule of Least Power

Following [Tim Berners-Lee's Rule of Least Power](https://www.w3.org/DesignIssues/Principles.html#PLP): given a choice of solutions, use the least powerful one capable of solving the problem.

- Declarative JSON over imperative JavaScript wherever possible
- `$ref` bindings over template expressions wherever possible
- Template expressions over handler functions wherever possible
- Handler functions only when logic cannot be expressed otherwise

### 2.3 The JSON Data Model Is Authoritative

A Jx document is a JSON value. It is not a JavaScript object literal, not JSX, not a template DSL. A file holds that value as `.json`, or as Jx Notation in a `.jxn` file (§22), and both spellings read to the same object, so everything below the reader works on JSON whichever one the file used. This distinction is intentional and load-bearing:

- JSON is fully serializable and deserializable without code execution
- JSON has no `this` ambiguity — self-references use explicit `$ref` pointers
- JSON is natively understood by visual builders, IDEs, validators, and bundlers
- JSON Schema tooling (validation, autocomplete, LSP) applies directly

### 2.4 Explicit Over Implicit

Signal scope does not leak across component boundaries. Every dependency a component has on external state must be explicitly declared as a `$prop`. This makes data flow statically knowable — a requirement for both the compiler and visual builder tooling.

Within a single component, state declared in `state` is available to all descendant elements of that component without explicit passing.

### 2.5 Platform Precedents

Where a web platform standard exists, Jx follows it. This section is the design principle; the machine-checked register of what Jx actually claims about each standard is §18.

| Jx Feature                         | Platform Precedent                                           |
| ---------------------------------- | ------------------------------------------------------------ |
| `$ref` path syntax                 | JSON Pointer (RFC 6901); Jx binding semantics (see §7)       |
| `$defs` for type definitions       | JSON Schema 2020-12                                          |
| Signal scope at component boundary | CSS Custom Properties scope                                  |
| Explicit props at element boundary | HTML attributes on Custom Elements                           |
| `.json` / `.js` file pairs         | HTML / JS, CSS Modules / JS                                  |
| `$prototype` namespaces            | Named after Web API constructors (semantics are Jx-specific) |

Jx borrows the **shape** of these standards. Where the semantics diverge — `$ref` binds live state rather than substituting schemas, `$prototype: "Request"` auto-fetches rather than describing an inert request — the spec says so explicitly rather than implying full conformance.

---

## 3. Document Format

### 3.1 Root Structure

> **Status: Partial.** Every field matches the code except `tagName`, which the table marks Required at the root. Neither the generated root schema (`packages/schema/schema.json`) nor any per-project `document.schema.json` requires it, the runtime's `resolveTagName` renders a missing tag as `div`, and page documents omit it (`sites/test-blank/pages/contact.json`); only an element node requires `tagName` (`packages/schema/defs/element-def.schema.ts`).

Every Jx document is a JSON object with the following top-level fields:

```json
{
  "$schema": "https://jxsuite.com/schema/v1",
  "$id": "ComponentName",
  "$defs": {},
  "state": {},
  "tagName": "my-component",
  "children": []
}
```

| Field      | Required    | Description                                                                                                                                                                                                     |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$schema`  | Recommended | URI identifying the Jx dialect version                                                                                                                                                                          |
| `$id`      | Recommended | Component identifier, used by tooling                                                                                                                                                                           |
| `$defs`    | Optional    | Pure JSON Schema type definitions — tooling only, no runtime artifacts                                                                                                                                          |
| `state`    | Optional    | Reactive state: signals, computed values, functions, and data sources                                                                                                                                           |
| `$script`  | Optional    | The document's own client and server modules, as TypeScript text (§23.2)                                                                                                                                        |
| `tagName`  | Required    | HTML tag name for the root element                                                                                                                                                                              |
| `children` | Optional    | Array of child element definitions, text nodes (strings/numbers), and/or Array namespaces (repeaters) mixed freely. A bare Array namespace (the whole children slot is one repeater) is also accepted. See §10. |

### 3.2 Schema-Backed Documents

Jx ships a real JSON Schema 2020-12 meta-schema (generated from W3C webref data). A Jx document is validated **as an instance** against that meta-schema by any 2020-12-compatible validator — this is what powers editor autocomplete, hover docs, and CI validation. The `$schema` URI in a document points editors at the meta-schema for that document (the VS Code "schema for this instance" convention); it is a tooling pointer, not a dialect declaration.

> **Status: Implemented.** `packages/schema` generates the meta-schema and exposes `validateDocument` (ajv 2020). Two honesty notes: Jx is **not** a JSON Schema _dialect_ in the normative sense — it declares no `$vocabulary`, so a validator cannot process a Jx document as a _schema_. And the reserved Jx keywords below are not JSON Schema vocabulary; a standards-only processor ignores them.

Jx layers the following reserved keywords on top of the JSON object model: `$prototype`, `$props`, `$switch`, `$map`, `$src`, `$export`, `timing`, `default`, `body`, `arguments`, `name`. (`default` is a standard JSON Schema annotation keyword that Jx repurposes as the Shape-2 discriminator — see §5.)

Standard JSON Schema 2020-12 keywords (`type`, `format`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `description`, `examples`, etc.) are genuine 2020-12 and are valid on `$defs` type definitions. Note that a Shape-2 `state` entry may reference a def with `"type": { "$ref": "#/$defs/…" }`, which is a Jx convenience, not valid JSON Schema (there `type` must be a string).

---

## 4. The Component Model

### 4.1 Self-Describing Components

A Jx component is a single `.json` or `.jxn` file (§22). All state, computed values, and functions are declared in `state`. Simple components are fully self-describing — no sidecar file required:

```json
{
  "$id": "Counter",
  "state": {
    "count": 0,
    "increment": { "$prototype": "Function", "body": "state.count++" }
  },
  "tagName": "my-counter",
  "children": [
    { "tagName": "span", "textContent": "${state.count}" },
    {
      "tagName": "button",
      "textContent": "+",
      "onclick": { "$ref": "#/state/increment" }
    }
  ]
}
```

### 4.2 External Function Sidecar

When handler functions grow complex, they may be extracted to a `.js` sidecar file. Each function entry declares its own `$src`:

```json
{
  "state": {
    "increment": { "$prototype": "Function", "$src": "./counter.js" },
    "decrement": { "$prototype": "Function", "$src": "./counter.js" }
  }
}
```

The `.js` file exports each function as a named export. An export bound to an event or named as a lifecycle hook takes `state`, the component's reactive scope object, as its first parameter; a helper a template calls takes what the template passes (§5.3 4d):

```js
export function increment(state) {
  state.count++;
}
export function decrement(state) {
  state.count = Math.max(0, state.count - 1);
}
```

When multiple Function entries share a `$src`, the runtime imports the module once and extracts named exports. Module caching is automatic.

A document may carry the module instead of naming a file: `$src: "#client"` names the client module in the document's own `$script` (§23.2), and its exports follow the same contract.

### 4.3 Handler Binding

At runtime, function exports are called with `state` as their first argument. `state` is the component's reactive scope object — a `reactive()` proxy of all declared state and functions. Inside a handler, state is read and written directly:

```js
export function increment(state) {
  state.count++;
}
export function handleInput(state, event) {
  state.name = event.target.value;
}
```

`this` is never used in Jx-managed code. All component state is accessed via `state`.

**Listener options are not part of the grammar.** An `on*` key is attached with `addEventListener(type, fn)` and nothing else, in every one of the four spellings a handler has — a `$ref` to a function, a structured body (§20), a string body, an `$expression` — so `capture`, `once`, `passive` and a listener `signal` cannot be written in a document at all. Capture is the one of the four that changes an outcome rather than a cost: a handler declared on an ancestor runs AFTER a descendant's, so anything inside the subtree that calls `stopPropagation` silently takes the ancestor's handler with it, and the document has no way to say it meant to go first. A host that needs the capture phase attaches that one listener itself, after the mount, on a node it holds — `watchPaneFocus` in `packages/studio/src/panels/pane-grid.ts` is the worked example, and it records at its own definition site that it lives there because a document cannot express the option. A custom element may do the same from its behaviour sidecar. Either way the listener's lifetime is the node's, so nothing has to remove it.

---

## 5. The `$defs` and `state` Grammar

### 5.1 Separation of Concerns

Jx separates type definitions from runtime variables:

- **`$defs`** — Pure JSON Schema 2020-12 type definitions. Tooling only. No runtime artifacts.
- **`state`** — All runtime variables: mutable state, computed values, functions, and data sources.

This separation aligns `$defs` with its standard JSON Schema 2020-12 meaning and eliminates the ambiguity of a single namespace serving both roles.

### 5.2 `$defs` — Pure Type Definitions

`$defs` contains only JSON Schema type definitions. No signals, no functions, no runtime artifacts:

```json
{
  "$defs": {
    "Count": { "type": "integer", "minimum": 0, "maximum": 100 },
    "Status": {
      "type": "string",
      "enum": ["idle", "loading", "success", "error"]
    },
    "TodoItem": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "text": { "type": "string" },
        "done": { "type": "boolean" }
      },
      "required": ["id", "text", "done"]
    }
  }
}
```

**Rules:**

- Every `$defs` entry is a JSON Schema — it has `type`, `properties`, `enum`, `$ref`, etc.
- No `default`, `$prototype`, `body`, or template strings
- Naming convention: `PascalCase` for types (`TodoItem`, `Count`, `Status`)
- `$defs` entries are referenced from `state` entries via `$ref`, or from external documents
- `$defs` is optional — `state` entries can declare types inline or omit types entirely

> **Status: Implemented.** The runtime, compiler, schema, and all examples use the `$defs`/`state` split.

### 5.3 `state` — Runtime Variables

`state` is a root-level property containing all runtime variables. Everything in `state` is initialized inside Vue's `reactive()`, making all entries reactive by default.

Every entry in `state` falls into exactly one of four shapes, determinable by inspection alone.

#### Shape 1 — Naked Value

**Identified by:** a JSON scalar (number, string without `${}`, boolean, null), array, or plain object with no Jx reserved keys.

```json
{
  "state": {
    "count": 0,
    "price": 9.99,
    "name": "World",
    "active": false,
    "data": null,
    "tags": [],
    "user": { "id": null, "name": "", "role": "guest" }
  }
}
```

**Emitted as:** property on `reactive({})`, initialized to the value.

**Rules:**

- A plain string without `${}` is a string state property initialized to that string value
- A plain object with no `$prototype`, no `type`, no `default`, and no `properties` is an object state property
- All state entries are reactive by default

> **Status: Implemented.** Runtime `buildScope` handles all naked value types.

#### Shape 2 — Typed Value (JSON Schema)

**Identified by:** an object with a `default` property, optionally with `type`, and no `$prototype`.

```json
{
  "state": {
    "count": {
      "type": { "$ref": "#/$defs/Count" },
      "default": 0,
      "description": "Current counter value"
    },
    "status": {
      "type": {
        "type": "string",
        "enum": ["idle", "loading", "success", "error"]
      },
      "default": "idle"
    }
  }
}
```

**Emitted as:** property on `reactive({})`, initialized to the `default` value.

**Rules:**

- The `default` keyword is the required discriminator — its value is the initial state
- The `type` property references a JSON Schema (either via `$ref` to `$defs` or inline)
- Schema keywords are tooling-only — they power LSP validation, autocomplete, and studio rendering. Stripped before runtime emission.

**Use the typed form when** the value needs type constraints, documentation, or references a shared type via `$ref`. **Use naked values (Shape 1) when none apply.**

##### The `format` Keyword

The `format` keyword provides rendering hints for visual editors. It does not affect runtime behavior — the value remains its declared `type` — but tells the studio which specialized input control to present.

| `format` value | Underlying `type` | Studio control                          |
| -------------- | ----------------- | --------------------------------------- |
| `"image"`      | `string`          | Media picker (file browser + thumbnail) |
| `"date"`       | `string`          | Date input (YYYY-MM-DD)                 |
| `"color"`      | `string`          | Color picker                            |

```json
{
  "state": {
    "bg": { "type": "string", "format": "image", "default": "" },
    "publishDate": { "type": "string", "format": "date", "default": "" },
    "accentColor": { "type": "string", "format": "color", "default": "#000000" }
  }
}
```

> **Status: Implemented.** Runtime handles `default` extraction. Schema generator includes `TypedStateDef`.

#### Shape 3 — Computed (Template String)

**Identified by:** a JSON string value containing `${}` syntax.

```json
{
  "state": {
    "fullName": "${state.firstName} ${state.lastName}",
    "displayTitle": "${state.score >= 90 ? 'Expert' : 'Beginner'}",
    "scoreLabel": "${state.score}%",
    "isEmpty": "${state.items.length === 0}"
  }
}
```

**Emitted as:** `computed(() => (expression))` when the string is a single `${…}` from end to end, and `computed(() => \`...template...\`)` otherwise.

**Rules:**

- Dependencies are tracked automatically by Vue when `state.*` properties are read during evaluation
- The string must be a pure expression — no statements, no assignments, no semicolons
- `return` is never written — the expression value is the signal value
- `state` refers exclusively to the current component's reactive scope
- **A single expression keeps its own type.** `"${state.items.length === 0}"` is the boolean `false`, `"${state.count * 2}"` is a number, and `"${state.icons[state.name]}"` is `undefined` when the key is absent. Any text outside the one `${…}`, or a second `${…}`, makes the value a string by template-literal interpolation: `"${state.score}%"` is `"90%"`. This is the line an attribute binding draws (§8.3), and every tier draws it in the same place, so a prerendered page, a hydrated component and Studio's canvas read one entry as one value.

> **Status: Implemented.** The runtime (`evaluateValueTemplate`), the build-time scope (`evaluateStaticTemplate`) and both compile targets (`templateValueSource`) decide "single expression" with the one `isSingleExpression` brace scan.

#### Shape 4 — Prototype (`$prototype`)

**Identified by:** object with `$prototype` property.

Functions and data sources are both declared via `$prototype`:

##### 4a — Function (Inline handler)

```json
"increment": {
  "$prototype": "Function",
  "body": "state.count++"
},
"handleInput": {
  "$prototype": "Function",
  "arguments": ["event"],
  "body": "state.value = event.target.value"
}
```

##### 4b — Function (Inline computed)

> **Status: Partial.** The bare-`return;` rule and the "no `arguments`" condition ship in every tier: the interpreter's `buildScope`, both compiled targets and the build-time scope in `packages/compiler/src/shared.ts` read one verdict, `classifyFunctionEntries` (`packages/schema/src/function-role.ts`). No tier classifies an inline body by reactive use, as the first paragraph below describes; classification reads the declaration and the body text.

```json
"titleClass": {
  "$prototype": "Function",
  "body": "return state.score >= 90 ? 'gold' : 'silver'"
}
```

A function with only `body` (no `arguments`) and no event binding acts as a computed value — the framework automatically wraps it in `computed()` when it detects it is referenced reactively.

A body counts as returning a value only when something follows `return` on the same line. A bare `return;` is an early-exit guard, so a handler that begins `if (!x) return;` stays a handler; a newline after `return` is an ASI bare return and counts the same way.

##### 4c — Function (External)

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

`$src: "#client"` names the document's own client module, the text in its `$script.client` (§23.2), and `$export` names the export as it does for any other module. It is the one `$src` that says nothing about a file, so a host gives it its document's address as the document is read, and the entry is from then on an ordinary external Function. A `$src` may also name a `.ts` file: a build bundles it, and an interpreting host imports it through the module loader that imports a document's script (§23.2).

An `npm:` specifier names a package export, and each renderer resolves it where its packages are: the build bundles it (`packages/compiler/src/site/bundler.ts`), and the interpreter imports it through the host's package resolver (`setNpmModuleResolver`), which a live renderer installs to say where its packages are served; with none installed it imports the bare specifier, which an import map can answer. It never hands `import()` the `npm:` URL itself, which no browser fetches.

##### 4d — Function Properties

> **Status: Implemented.** The interpreter (`packages/runtime/src/runtime.ts`), both compiled targets and the build-time scope (`packages/compiler/src/shared.ts`) share each rule below: classification (`classifyFunctionEntries`), parameter lists (`handlerParamNames`) and the `body`/`$src` exclusion (`declaresBodyAndSrc`), all in `packages/schema/src/function-role.ts`, and `$lazy` imports (`collectFunctionImports`).

| Property      | Required     | Description                                                                                                     |
| ------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `$prototype`  | Yes          | Must be `"Function"`                                                                                            |
| `body`        | If no `$src` | Function body: raw JS source string, or a structured statement array (§20)                                      |
| `arguments`   | No           | Array of parameter name strings. Default: `[]`                                                                  |
| `parameters`  | No           | Array of parameter entries — bare string names or CEM-compatible parameter objects (alternative to `arguments`) |
| `type`        | No           | Return type for tooling — JSON Schema or CEM `{ text }` format                                                  |
| `name`        | No           | Explicit function name. Default: the `state` key name                                                           |
| `$src`        | If no `body` | External module specifier                                                                                       |
| `$export`     | No           | Named export in `$src` module. Default: `state` key name                                                        |
| `description` | No           | Documentation string                                                                                            |
| `emits`       | No           | Array of CEM `Event` objects this function dispatches                                                           |

`body` and `$src` are mutually exclusive. Declaring both is a compile-time error. The rule covers a `state` entry and a Function written inline on an `on*` property alike: both compiled targets refuse the pair at build, the interpreter throws when it builds the scope or binds the handler, and the `FunctionDef` schema refuses it, so `jx validate` reports it first.

`parameters` entries may be bare string names (`["item"]`, as in §20.1's example), CEM-compatible parameter objects (`{ "name": "id", "type": { "text": "number" }, "default": 1 }`), or a mix — the schema and runtime accept both forms, and the runtime normalizes every entry to its name. Prefer objects when tooling metadata (types, defaults, descriptions) matters; bare names suffice otherwise.

**Parameter binding at event call sites.** An event binding always invokes a handler with `(state, event)`. A string `body`, whether a `state` entry or a handler written inline on an `on*` property, is built with `state` as its first parameter and its other declared names after it in declared order. Binding is **by position**, as ECMAScript's is, and `state` is first because every Jx function takes the reactive state first (§4.2). So the first other name receives the event: `["event"]`, `["state", "event"]`, `["event", "state"]` and `["state"]` all bind what they read, and a body may reference `state` whether or not it declared it. A later name is the call's next argument, so an event binding leaves it `undefined` (a call with too few arguments, as WebIDL's callback invocation does) and `state.key(state, a, b)` from a template fills it. A `$src` entry is the imported function itself: an event binding calls it with `(state, event)` (§4.3), and a template, a `call` node or a lifecycle hook calls it with the arguments that call site passes. Its declared `parameters` describe the export, as a Custom Elements Manifest function does; they do not reorder its arguments. This holds in the interpreter and in every compiled target alike.

**Classifying an external Function.** Because `body` and `$src` are mutually exclusive, a `$src` entry has no body for the framework to inspect, so its role follows its declaration and how the document uses it, never the imported function's arity or source. An entry that declares `parameters` or `arguments` is a callable wherever it is used. So is an entry referenced as a **callable** — bound to an `on*` event (a definition's root-level handlers included, §16.1), invoked by an `$expression` `call` node (§19.4c), called as `state.key(…)` from a template or another body, or named as a lifecycle hook (§16.4). Otherwise its return value is read reactively and the entry is a computed value, matching the inline-body rule in 4b. The document is the one the entry is built in, after the project-state merge (§19.4c), so a project-global entry one page calls and another only reads is a function on the first page and a computed value on the second. Reading an undeclared `$src` entry that resolves to a function (rather than its result) is therefore not a supported way to obtain the imported function itself; declare its `parameters` instead.

**Compiled-site delivery.** In compiled sites, bundleable `$src` specifiers — `npm:<pkg>[/subpath]` and project-relative `./…` files (TypeScript included) — are bundled per the entry's `timing`. Client-timing functions compile to self-contained ESM bundles under `/assets/` with deterministic, hash-free names (relative specifiers key on their project-relative path); emitted page and element modules import the bundle URL instead of the raw specifier, so external libraries work on purely static hosts with no `node_modules/` at runtime. `timing: "compiler"` functions are never bundled — they execute in the build host. Absolute URL specifiers (`/lib/x.js`, `https://…`) are emitted verbatim and served as-is.

**`$lazy`.** A Function def may set `"$lazy": true` alongside `$src`, which replaces the static import with a memoized dynamic `import()` taken on first call. A static import is a download, a parse and an evaluate on every page that renders the component, whether or not anything calls the function; `$lazy` moves all three to the moment somebody does. The local binding keeps its name, so call sites are unchanged — but the function now **returns a promise**, and so may only be called, never bound as a value. Declaring `$lazy` on an entry the document uses as a computed is a build error rather than a promise rendered into the DOM. Both compiled targets emit the same loader. The interpreter does the same: it imports a `$lazy` entry on its first call rather than when it builds the scope, returns that call's promise, and refuses a `$lazy` entry the document uses as a computed when it builds the scope. Server-timing functions are imported only by the generated site worker, so a document declaring one needs `build.adapter` (compiler.md §6.3). The bundler backend is `Bun.build` under Bun and esbuild under Node (see compiler.md).

##### 4e — Data Source (External Class)

> **Status: Partial.** The `Request` example's `urlParams` field is read by nothing (§11.1): the runtime's `Request` case, `ExternalClassDef` and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) all ignore it, so the entry fetches `/api/users/` once and never re-fetches when `userId` changes.

```json
{
  "state": {
    "userData": {
      "$prototype": "Request",
      "url": "/api/users/",
      "urlParams": { "$ref": "#/state/userId" },
      "method": "GET"
    },
    "posts": {
      "$prototype": "MarkdownCollection",
      "src": "./content/posts/*.md",
      "timing": "compiler"
    }
  }
}
```

External class entries are always resolved reactively — the framework wraps their resolved values in `ref()` automatically.

### 5.4 Naming Convention

State entries use plain `camelCase` names (e.g. `count`, `items`, `firstName`). Function entries also use `camelCase` (e.g. `increment`, `handleInput`). Type definitions in `$defs` use `PascalCase` (e.g. `TodoItem`, `Count`).

### 5.5 Signal Access in JavaScript

Within function `body` strings and external `.js` files, state is read and written directly on the `state` reactive proxy — no `.get()` or `.set()` calls:

```js
// Read
const current = state.count;

// Write
state.count = current + 1;

// Mutate array in place (Vue tracks array mutations)
state.items.push(newItem);
state.items.splice(0, 1);

// Mutate nested object (Vue tracks nested reads and writes)
state.user.name = "Alice";
```

> **Status: Implemented.** All examples and the runtime use direct property access on the `state` reactive proxy.

### 5.6 Private State (`#` prefix)

State entries prefixed with `#` are private. They are never exposed to the studio property panel, never included in CEM extraction, and never settable via `$props`:

```json
{
  "state": {
    "count": 0,
    "#cache": {},
    "#lastFetchTime": null
  }
}
```

> **Status: Implemented.** All three clauses hold. The studio excludes `#` entries from the editable prop list (`componentPropEntries`) and from CEM extraction (`cem-export`), and both tiers now refuse a `$props` write against one: the interpreter at each of its four absorption paths (`runtime.ts`) and the compiled element target in the `connectedCallback` it emits. The predicate is `isPrivateStateKey` in `@jxsuite/schema/guards`, in one place because the rule has to hold identically in code that is compiled and code that is interpreted.
>
> Two details are part of the contract rather than of the implementation. A private entry gets **no property accessor** on the custom element — the property-first interface _is_ the props mechanism, so defining one would leave `el["#cache"] = x` writing through every other guard. And a refused write is **ignored and named**, not thrown: a `$props` block mentioning a private key is an authoring mistake, not a broken document, and failing the render would turn a typo into a blank page. The warning fires once per key.

### 5.7 Shape Detection Algorithm

> **Status: Partial.** The interpreter follows the steps below (`buildScope` in `packages/runtime/src/runtime.ts`), but an object with no `default`, `$prototype` or `$expression` is sorted by two different predicates, and the algorithm names neither. The interpreter treats it as a pure type definition, holding no value, when any key is one of its own schema keywords (`hasSchemaKeywords`); the compiled targets do so only when every key is one of a different set (`isSchemaOnlyDef` in `packages/schema/src/guards.ts`). So `{}` and `{ "description": "x" }` hold a value in the interpreter and none in built output, and `{ "type": "string", "label": "x" }` the reverse.

```
For each entry in state:

1. Value is a string containing "${"?
   → Shape 3: Computed (computed())

2. Value is a string, number, boolean, null, or array?
   → Shape 1: Naked value (reactive property)

3. Value is an object with "$expression"?
   → Shape 5: Expression (declarative operation; mutating → handler, pure → computed)

4. Value is an object with "$prototype"?
   → Shape 4: Prototype (function, data source, or external class)

5. Value is an object with "default" (no "$prototype")?
   → Shape 2: Typed value (reactive property with type metadata)

6. Value is a plain object (no reserved keys)?
   → Shape 1: Object value (reactive property)
```

> **Status: Implemented.** Runtime `buildScope` follows this exact algorithm.

---

## 6. Universal Reactivity

Template literal syntax `${}` is valid **anywhere a string value appears in the document tree** — not only in `state`.

### 6.1 Reactive element properties

```json
{
  "tagName": "div",
  "textContent": "${state.count} items remaining",
  "className": "${state.active ? 'card active' : 'card'}",
  "hidden": "${state.items.length === 0}"
}
```

**A binding writes when its SOURCE moves, not when its target differs.** The effect behind `"value": "${state.query}"` re-runs only when something it read changed, and it then skips a write equal to what the element already holds — the second half is deliberate, because re-setting `value` on a focused control moves the caret and collapses the selection. Together they mean a document cannot RE-ASSERT a value it has already written. After the reader has typed over a bound control, writing the scope value the scope already held is not a change, so the effect never re-runs and the field keeps what the reader typed; the write that would have emptied it is exactly the one that is skipped. There is no write-only spelling that fires on every pass, and reaching for the element and assigning `value` is not the alternative — that is the host writing into a tree the document owns. The host makes the correction visible instead: it announces the raw value the control now holds, and the value it settled on is then a real move rather than an equal write. `packages/studio/src/ui/form-controls.ts` carries that bounce so a refused rename snaps back, and `packages/studio/src/settings/project-sections.ts` so that a build adapter `project.json` refused puts the picker back on the one on disk.

**A binding whose expression throws renders nothing and keeps listening.** State that resolves asynchronously reads `null` before it reads its value, so `${state.posts.length}` throws on its first evaluation in any live render. The throw is caught inside the binding's own effect: a text binding renders empty and an attribute or property binding writes nothing, every dependency the expression read before it threw stays tracked, and the binding re-runs, and renders, when the change that makes it valid arrives. The error is reported once per template source as a console warning, or, to a host that asked, delivered every time (`setTemplateErrorHandler`, embedding.md §5.2). The console warning waits while a lookup the runtime started is in flight (a dev-proxy class resolve, a `timing: "server"` call, or a `Request` whose fetch has begun) and is written, when the last of them settles, only for a binding still throwing: a template that merely read data before it arrived is never reported, and one the data did not fix, or whose lookup failed, still is. A host's handler is not held. Uncaught, it stopped the effect for good and unwound the whole render above it, so one early read left the page blank.

### 6.2 Reactive style properties

```json
{
  "tagName": "div",
  "style": {
    "color": "${state.score > 90 ? 'gold' : 'inherit'}",
    "opacity": "${state.loading ? '0.5' : '1'}"
  }
}
```

### 6.3 Reactive attributes

```json
{
  "tagName": "button",
  "attributes": {
    "aria-label": "${state.count} unread messages",
    "data-state": "${state.status}"
  }
}
```

### 6.4 Compilation

When the compiler encounters `${}` in any string-valued property, it wraps the binding in a reactive effect:

```js
watchEffect(() => {
  el.textContent = `${state.count} items remaining`;
});
```

### 6.5 Relationship to `$ref`

| Pattern                       | Use when                                                  |
| ----------------------------- | --------------------------------------------------------- |
| `{ "$ref": "#/state/label" }` | Binding to a named signal — referenced in multiple places |
| `"${state.count} items"`      | Inline computed binding used in exactly one place         |

Prefer `${}` for single-use reactive bindings. Prefer `$ref` for reused or named signals.

### 6.6 Scope

Template strings resolve `state.propertyName` against the current component's reactive proxy, plus the iteration bindings (`$map`, `item`, `index`) where an Array map provides them.

> **Status: Implemented.** The interpreting runtime compiles each `${…}` with `new Function` and wraps it in an `effect()`. **Honesty note:** this is full JavaScript, not a sandbox — `state` is in scope, but so is the entire global environment, and a template _can_ assign or call side effects (`"${state.count = 1}"` runs). The "access only to `state`" wording is therefore an authoring convention, not an enforced boundary. The compiler emits no `new Function` (templates are spliced verbatim into generated modules — §21); the eval requirement applies only to the interpreting runtime (dev server, Studio canvas, `@jxsuite/runtime` as a library), which consequently needs CSP `'unsafe-eval'`.

> **Status: Future.** A restricted template evaluator (reusing the `$expression` operator allowlist, §19) would make the `state`-only scope a real boundary and remove the interpreter's `unsafe-eval` requirement. Not yet built.

---

## 7. Reference System

### 7.1 `$ref` Syntax

Jx uses `$ref` to bind a property to declared state. The path **is JSON Pointer syntax** (RFC 6901 — a `#`-fragment of `/`-separated tokens):

```json
{ "$ref": "#/state/count" }
```

**`/` is the only separator.** A reference token runs to the next `/`, so `#/state/user/name` walks `state` → `user` → `name`. RFC 6901 §4 escapes are implemented — `~1` is a literal `/` and `~0` a literal `~`, applied in that order — so `#/state/a~1b` reaches the key `a/b` and no member name is unreachable.

RFC 6901 §3 excludes exactly two characters from a reference token, `/` and `~`. Every other character is ordinary, which is why `#/state/user.name` denotes one member named `user.name` rather than a path. Jx neither encourages nor forbids such a key: forbidding it would mean adding a restriction the standard does not have. No document in this repository uses one.

> **Note:** Before 0.5.0 the dot was a second separator inside nested segments, so `#/state/a/b.c` walked three levels. That rule was not in RFC 6901 and was never applied consistently: the interpreter dot-split every segment but the first, the assignment path never dot-split at all, and the compiler lowered a ref by replacing `/` with `.` — which emitted `s.items.0` for `#/state/items/0`, a syntax error from a build that reported success. `packages/runtime/src/pointer.ts` is now the only tokenizer, and every read, write and lowering path calls it.

The **semantics are Jx-specific**, not JSON Reference: a Jx `$ref` reads a live value off the reactive scope, it does not substitute a schema, and a token that matches nothing yields `undefined` rather than failing evaluation as RFC 6901 §4 requires. The schemes below (`window#/`, `parent#/`, `$map/`, `event#/`, …) are Jx extensions, not the URI fragment representation of RFC 6901 §6.

### 7.2 Reference Schemes

| Scheme           | Example                 | Resolves to                                                                                                                                       |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal `state` | `"#/state/count"`       | Signal or handler in current component's `state`                                                                                                  |
| Window global    | `"window#/currentUser"` | `window.currentUser`                                                                                                                              |
| Document global  | `"document#/appConfig"` | `document.appConfig`                                                                                                                              |
| Parent scope     | `"parent#/sharedState"` | Named signal passed via `$props`                                                                                                                  |
| Map context      | `"$map/item"`           | Current item in an Array map iteration                                                                                                            |
| Map index        | `"$map/index"`          | Current index in an Array map iteration                                                                                                           |
| External file    | `"./other.json"`        | A component document — resolved for `$switch` cases and `$elements` registration (§14, §16), **not** as a node-level component instance (see §13) |

Every scheme takes a path, not just a name: `"parent#/user/name"` reads `name` off the `user` prop and `"window#/location/href"` reads `location.href`, under the §7.1 rule that `/` is the only separator. Before 0.5.0 `parent#/` was the exception — it read the whole path as a single prop name, so a nested one resolved to `undefined` at runtime while the compiler emitted a walk.

### 7.3 Reactive Bindings

When a `$ref` resolves to a reactive state property or computed, the binding is reactive — the DOM property updates automatically whenever the value changes:

```json
{
  "tagName": "p",
  "textContent": { "$ref": "#/state/count" }
}
```

### 7.4 `$ref` Resolution

Resolution is **scheme dispatch**, not a cascading fallback: the leading token selects exactly one source. A `#/state/…` ref that misses yields no value and does **not** fall through to `window`/`document` (an explicit-scheme miss reads as `undefined`; only a bare, schemeless ref falls back to `null`). Those globals are reachable only via an explicit `window#/` or `document#/` ref. Context schemes are only valid in the position that provides them:

- `$map/`, `$reduce/acc` — iteration / fold context (mapped-array and reduce expressions)
- `$args/` — named-formula parameters (callable body only, §19.4c)
- `event#/` — handler event context (handler position only)
- `#/state/` — the current component's scope (which already includes `$props`, merged in place — see §15.4)
- `parent#/` — resolves against the same merged scope as a bare state read
- `window#/` / `document#/` — the corresponding global object

> **Status: Implemented.** Scheme dispatch follows the rules above: `resolveRef` (`packages/runtime/src/runtime.ts`) handles `$map/`, `#/state/`, `parent#/`, `window#/` and `document#/`, and `resolveExprRef` (`packages/runtime/src/expression.ts`) handles `$reduce/`, `$args/` and `event#/`. External-file refs resolve where §7.2 says they do, in `$switch` cases and `$elements` entries (§14, §16), in the interpreter; a compiled target does not render an external `$switch` case (§14.1). A bare `{ "$ref": "./x.json" }` child is not a resolution position, and is removed (§13.1).

---

## 8. Element Definitions

### 8.1 DOM Property Mapping

> **Status: Partial.** The runtime writes any non-reserved key as a DOM property, and the lit element target binds it. The static emitter does not: `buildAttrs` (`packages/compiler/src/shared.ts`), which `compile-static`, the client prerender and the component prerender share, writes only `id`, `className`, `hidden`, `tabIndex`, `title`, `lang` and `dir`, so `href`, `src`, `alt`, `value`, `placeholder`, `type`, `checked`, `disabled`, `name` and `selected`, all declared on `ElementDef`, are dropped from prerendered HTML.

Any valid DOM element property may be set directly on an element definition object:

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

### 8.2 Protected Properties

`id` and `tagName` are protected — they may not be set via `$ref` bindings.

### 8.3 Custom Attributes

Non-standard attributes are set via the `attributes` object:

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

**A boolean value is written the way the attribute is read.** HTML spells a boolean two incompatible ways, so an attribute whose value is `true` or `false` — declared directly, or resolved from a `${...}` template or `$ref` — is emitted according to the family its NAME puts it in:

| Family                                                                                                     | `true`    | `false`          |
| ---------------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| **Presence** — `open`, `disabled`, `checked`, `hidden`, `required`, and every other HTML boolean attribute | bare name | attribute absent |
| **Enumerated** — every `aria-*`, plus `contenteditable`, `draggable`, `spellcheck`                         | `="true"` | `="false"`       |

Neither form is a stylistic choice. A presence attribute counts _any_ value as true, so `<details open="false">` is an open `<details>`; an enumerated attribute reads an empty value as unset, so a bare `aria-hidden` is not hidden and an absent `contenteditable` means "inherit" rather than `false`. Writing either as the other inverts it in silence.

A **string** is never reinterpreted in either family: `"aria-current": "false"` is emitted verbatim, because an enumerated attribute carries its value in its text.

**Nothing is an attribute the element does not have.** A value that resolves to `null` or `undefined` — a `$ref` to a missing entry, a `${…}` template whose single expression yields one — removes the attribute rather than writing an empty string. An `aria-checked=""` or a `title=""` is not absence: the first is an invalid token on a menu item and the second is an empty tooltip. This is what lets one template carry an attribute that exists only in some states, `"aria-haspopup": "${state.haspopup ? 'menu' : null}"`, without a second binding to take it away.

Every renderer applies this identically — the static compiler writing HTML source and the runtime writing live elements — so an element does not change meaning when a prerendered page hydrates.

**`popover` is enumerated, and is deliberately emitted through the presence branch.** Its keywords are `auto`, `manual` and `hint`; its MISSING-value default is `auto`, so a bare `popover` and `popover=""` are both auto popovers — which is what the presence branch produces for `true`. Its INVALID-value default is `manual`, so emitting `popover="true"` would silently give up light dismiss and Escape. The house spelling is therefore the keyword itself, `"popover": "auto"`, and a boolean `popover` is a defect a document report names rather than an emission a renderer corrects. It is the one attribute for which the paragraph above needs a caveat: a presence attribute counts any value as true, but `popover="false"` is a _manual_ popover rather than a true-ish one.

> **Status: Implemented.** `booleanAttrValue()` in `@jxsuite/runtime` is the single decision, and all FOUR writers defer to it: the compiler's `buildAttrs()`, its custom-element and client targets, and the runtime's `applyAttributes()`. The runtime removes the attribute rather than writing `"false"` when a binding flips, and the two generated-module targets do the same through an inlined copy of the rule whose enumerated-name list is serialized from `enumeratedAttrNames()` — those modules load without `@jxsuite/runtime`, and a test asserts the emitted literal still equals that export.
>
> The element and client targets did NOT defer to it until they were made to: they stringified booleans, so a component's `open: true` compiled to `open="true"` and a bound `open` that flipped false wrote `open="false"` — an OPEN element the author had closed. Only the static emitter was ever correct, which is why this note used to name two writers.

### 8.4 Child Arrays

> **Status: Partial.** Element and text-node children, and computed children resolved at build time and by the interpreter, ship. Content a computed-children template splices in is not kept literal: the template pass (`resolveDocTemplates` in `packages/compiler/src/site/site-build.ts`) recurses into the resolved nodes and evaluates every `${…}` in their text and attributes, so a content entry's prose or inline code that contains `${` renders its evaluation (`Clicked ${state.count} times` in `docs/start/first-component.md` renders as "Clicked undefined times"), and one left for the client can make the page's module a syntax error.

Children are expressed as a JSON array of element definitions and/or bare text nodes:

```json
{
  "tagName": "div",
  "children": [
    { "tagName": "h1", "textContent": "Title" },
    { "tagName": "p", "textContent": "Content" }
  ]
}
```

#### Text Node Children

Bare strings and numbers are valid `children` items. They produce DOM `Text` nodes directly, without wrapper elements:

```json
{
  "tagName": "p",
  "children": ["Hello ", { "tagName": "strong", "textContent": "world" }, "!"]
}
```

This is equivalent to the HTML `<p>Hello <strong>world</strong>!</p>`.

Template strings in text node children are reactive:

```json
{ "children": ["Welcome, ${state.name}!"] }
```

When all children are bare strings with no element siblings, prefer the simpler `textContent` representation instead.

#### Computed Children (Build Time)

The entire `children` value may be a `${…}` template string that resolves **at site-build time** to an array of child definitions. This is the mechanism for injecting parsed content (e.g. a content entry's `$children` from `@jxsuite/parser`) into a wrapper element:

```json
{ "tagName": "bl-prose", "children": "${state.entry.$children}" }
```

Inside a repeater the template reads the row, which is how a card draws its own entry's body:

```json
{ "tagName": "div", "children": "${item.$children ?? []}" }
```

The compiler's template pass replaces `children` with the resolved array and recurses into it. Scope of the feature: for a built page the template must resolve to an array during the site build (e.g. from `$paths`-bound state or a compiler-timing prototype). The compiled targets do not evaluate one left unresolved, so runtime-reactive content swapping is not available to a built page through this form. The interpreter (`renderNode` in `packages/runtime/src/runtime.ts`), which renders the source document rather than the build's output, does evaluate it, and redraws the children when the value changes: that is what Studio's Preview draws. A result that is not an array draws nothing, and a plain non-template string is not a valid `children` value at all (text children must be array items, per above).

A format with no way to spell this as its body keeps it as an attribute: Markdown writes `::div{children="${item.$children ?? []}"}` (`parser.md` §3).

### 8.5 Slot Support

Custom elements support the standard HTML `slot` mechanism for content composition:

```json
{
  "tagName": "card-component",
  "children": [
    {
      "tagName": "header",
      "children": [{ "tagName": "slot", "attributes": { "name": "header" } }]
    },
    {
      "tagName": "main",
      "children": [{ "tagName": "slot" }]
    }
  ]
}
```

Distribution is one rule, applied in four steps.

**Capture.** The host's children are taken before the template renders. Text that is only HTML whitespace (space, tab, line feed, form feed, carriage return) is discarded; a non-breaking space is content, and an empty text node, where a binding will write, is kept.

**Group.** An element whose `slot` attribute is non-empty joins that name's group, and every other child joins the unnamed group.

**Place.** After the render, each `<slot>` in tree order is replaced by its group. The first `<slot>` of a name takes it, and the first without a `name` (or with an empty one) takes the unnamed group; a later `<slot>` of the same name gets nothing, which is the DOM's own "find a slot". The slot's own children follow when its group holds no element and no non-empty text, a group no `<slot>` takes is not rendered, and no `<slot>` element survives (§16.6). A `<slot>` inside a fallback that is not shown still takes its name.

**Forward.** A `<slot>` written directly among a nested instance's children is that instance's child, grouped by its own `slot` attribute, and the enclosing group stands where it lands, whichever element renders first.

Distribution runs once, when the element connects: a `<slot>` that a `$switch` case or a list row draws later stays literal and receives nothing. A prerendered instance that upgrades recovers the children the prerender placed, in the slots it placed them in, rather than capturing its own markup (compiler.md §8.1).

> **Status: Implemented.** One rule in three places. The interpreter's `captureSlotted` and `distributeSlots` (`packages/runtime/src/runtime.ts`) are exported; the component module calls inlined copies (`slotHelperSource()` in `packages/compiler/src/shared.ts`); and the prerender groups the instance's children as definitions (`createSlotFill`) before `renderStaticNode` places them. One fixture table holds all three to the same output (`packages/compiler/tests/slot-distribution-agreement.test.ts`).

### 8.6 Annotations

Any element may carry `$title` and `$description` as developer-facing metadata annotations, inspired by JSON Schema's annotation keywords:

```json
{
  "tagName": "section",
  "$title": "Hero Section",
  "$description": "Primary landing area with headline and call-to-action buttons",
  "children": [...]
}
```

**Rules:**

- Both are plain strings (not reactive, not `$ref`-resolvable)
- Neither is applied to the DOM or compiled to HTML output
- `$title` provides a human-friendly label for tooling (e.g., Jx Studio layers panel)
- `$description` provides extended documentation for the element's purpose
- In markdown remark directives, these map to `--title` and `--description` attributes

> **Status: Implemented.** Runtime `RESERVED_KEYS` includes both and the compiler's `buildAttrs` never emits them; the parser maps them to and from `--title`/`--description` (`JX_ANNOTATION_KEYS` in `extensions/parser/src/transpile.ts`). `ElementDef` declares neither key, so the schema admits them through its `additionalProperties` rather than validating them as strings.

### 8.7 Overlays: popover, dialog, invoker commands

A document's overlays are the platform's: a **popover** (`popover="auto|manual|hint"` on any element, opened by a `<button>` or `<input>` carrying `popovertarget`), a **dialog** (`<dialog>`, opened modally with `showModal()` and closed by Escape or a close command, its dismissal governed by `closedby="any|closerequest|none"`), and the **invoker commands** that drive either without script: a `<button>` carrying `command` and `commandfor`. Jx adds no overlay mechanism of its own; what it adds is the checking, because each of these is a set of facts that is easy to get wrong and hard to see on the page:

- `command` and `commandfor` belong to `HTMLButtonElement` and to no other interface — not `<input>`, which `popovertarget` does allow. On any other element they parse and do nothing.
- `command` is enumerated: `toggle-popover`, `show-popover`, `hide-popover` act on a popover; `show-modal`, `close`, `request-close` act on a dialog; a value starting with `--` is a custom command the target answers through `oncommand`. Anything else is the invalid-value state, and a button in that state does nothing.
- A command aimed at the other kind of target is silently ignored, and so is a custom command whose target handles no command.
- `closedby` is enumerated too, and a modal dialog with `closedby="none"` and no close control inside it traps the reader, because a modal makes the rest of the page inert.
- A closed dialog is hidden by the browser's own `dialog:not([open]) { display: none }`, a UA-origin rule any author `display` beats; the same is true of a closed popover. So `display` belongs in the open rule — `&[open]`, `:popover-open` — and nowhere else.

`popover` is deliberately not in the enumerated-attribute family (§8.3); `command` and `closedby` are kept out for the same reason, so a boolean or an unknown keyword is a reported defect rather than a silently corrected one.

> **Status: Implemented.** `@jxsuite/schema/overlays` (`findPopoverDefects`) judges popovers and `@jxsuite/schema/dialogs` (`findDialogDefects`) judges dialogs and invoker commands, over one walker, with one defect shape and one repair contract (`popoverDisplayRepair`, `dialogDisplayRepair`); Studio files both under one Problems source (`services/popover-report.ts`). `docs/framework/concepts/overlays.md` is the author-facing statement of the same rules.

### 8.8 Accessibility rules

> **Status: Implemented.** `@jxsuite/schema/a11y` (`findA11yDefects`), over the same walker and defect shape as §8.7; surfaced by Studio's Accessibility problems (`services/a11y-report.ts`, which keeps the page-level checks of its own), by `jx validate` (advisory, fatal with `--strict`), and by the conformance tests of the UI kit, the Studio surfaces and every starter.

A Jx document is judged for the accessibility facts that can be read off its tree, by rules that each stand on one WCAG 2.2 success criterion and that stay silent whenever the fact they need is BOUND rather than written — a `${…}` template or a `{ $ref }` in a name, a role or an id is a value the document decides at run time, and a rule that accused an author of a defect it could not see would teach them to ignore it.

| Rule                             | What it judges                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Criterion |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `interactive-unnamed`            | A button, a linked `<a>`, a linked `<area>`, a `<summary>`, a form control, or an element with an interactive role, with no accessible name: no content (for roles named from content), `aria-label`, `aria-labelledby`, `title`, and for form controls no `<label for>`, enclosing `<label>`, `placeholder`, `value` (button types) or `alt` (image type). A `<slot>` counts as content. An `<area>` with an `href` is named by its `alt`, and an empty one does not excuse it the way it does an `<img>`: the area IS the link text, so there is nothing else to hear. An `<area>` with no `href` is not a link and is not judged. | 4.1.2     |
| `img-alt-missing`                | An `<img>` with no `alt` at all. An empty `alt` is a decision; a `presentation` role is one too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1.1.1     |
| `aria-target-missing`            | An `aria-labelledby`, `-describedby`, `-controls`, `-owns`, `-activedescendant`, `-details`, `-errormessage` or `-flowto` token naming an id nothing in the document has. Asleep while any id in the document is bound.                                                                                                                                                                                                                                                                                                                                                                                                              | 1.3.1     |
| `tab-outside-tablist`            | A `tab` with no `tablist` ancestor, and no `tablist` owning it through `aria-owns`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 1.3.1     |
| `menuitem-outside-menu`          | A `menuitem`, `menuitemcheckbox` or `menuitemradio` with no `menu` or `menubar` ancestor, and none owning it through `aria-owns`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 1.3.1     |
| `option-outside-listbox`         | An `option` with no `listbox`, `<select>` or `<datalist>` ancestor, and no `listbox` owning it through `aria-owns`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 1.3.1     |
| `tablist-none-selected`          | A `tablist` whose tabs carry literal `aria-selected` values and none is `true`. A warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 4.1.2     |
| `dialog-unnamed`                 | A `<dialog>`, or a `dialog` or `alertdialog` role, with no `aria-label` or `aria-labelledby`; a dialog's content does not name it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 4.1.2     |
| `activedescendant-not-focusable` | `aria-activedescendant` on an element that is not natively focusable and has no `tabindex`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 2.1.1     |
| `custom-element-in-select`       | A custom element anywhere inside a `<select>`, or inside a definition that IS one. A `<select>` builds its own rows, so an element it does not know is not in `select.options`: it cannot be picked, cannot be reached with the arrow keys and fires no `change` — while `role="option"` on it still makes the accessibility tree read as though it could. Native `option`, `optgroup`, `hr` and `slot` are untouched, which is the whole legal vocabulary of a `<select>`.                                                                                                                                                          | 4.1.2     |

The three container rules are silent for the document root and under any custom-element ancestor, because a definition supplies its own container roles at its usage site — a `role="tab"` row slotted into a `jx-tabs` is judged inside `jx-tabs`'s definition, not against the page. They are silent under a bound ancestor role for the same reason.

**`custom-element-in-select` is the one rule that does the opposite**, and the asymmetry is the point: it is keyed on the ANCESTOR being a custom element rather than silenced by it, because `jx-select` is a `<select>` and a row put inside one is exactly the case it exists to refuse. It replaced a structural defence rather than adding to a set of them. A custom element inside a `<select>` survives insertion, draws, and with `role="option"` reads convincingly in the accessibility tree while the control does nothing at all — measured in Chrome as `select.options.length` 0, ArrowDown then Enter giving `value ""` and `selectedIndex -1`, and no `change` event. A test asserting the TREE passes while the control is inert, so as long as the UI kit shipped no `jx-option` the absence of the element was the only defence that held (ui.md §5.1). The element exists now, as a `jx-listbox` row, so this rule is what stands in its place.

They are also silent for an element a container of the right role claims through `aria-owns`. ARIA states containment where the DOM tree cannot: an element a `tablist` names in `aria-owns` is that tablist's child in the accessibility tree wherever it sits in the markup, and the attribute exists for exactly the arrangements a subtree cannot express. The owner's role is what decides, so this is a silence rather than a hole: a `role="group"` that names a tab in `aria-owns` owns nothing a tab may belong to, and the tab is still reported. A bound `aria-owns`, or a bound id on the element itself, silences the family for the same reason a bound ancestor role does.

Deliberately not judged: colour and contrast, target size, focus order and reading order. Those are properties of built output in a browser, and a document tree cannot answer them; Studio's report names each one it could not check rather than passing it.

---

## 9. Styling

### 9.1 Style Objects

> **Status: Partial.** The runtime conforms (§9.6). The static compiler does not: a `${…}` base declaration it can resolve against a build-time scope, and a component definition's resolved host style, are written into an inline `style` attribute (`inlineStyleDeclarations` and the `hostStyle` argument of `buildAttrs` in `packages/compiler/src/shared.ts`), so in prerendered HTML a `:hover` or `@media` block cannot override those declarations.

The `style` property accepts an object with camelCase CSS property names:

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

Every declaration in that object becomes a **CSS rule**, not an inline style attribute — see §9.6 for the runtime and §9.3 for the compiler. That is what makes the nested blocks of §9.2 work: an inline declaration beats any non-`!important` rule, so a base property written inline could never be overridden by the `:hover` or `@media` block beside it. A custom property (`--name`) is a declaration like any other and keeps its exact spelling, because custom property names are case-sensitive.

**A declaration value may be reactive**: a `"${…}"` template, or a `{ "$ref": … }`. Both mean the same thing — a value the runtime resolves against the live scope and keeps current — and both are how a component renders in a value it cannot know until it runs, such as a row drawn in the typeface it names. The mechanism is §9.6.

A **reactive value on a custom property, in a rule targeting the element itself**, is written inline under the author's own name and contributes no declaration to the rule. That is deliberate and it is what makes a repeater affordable: the indirection §9.6 describes puts a per-element variable name INTO the rule text, and rules are interned by their text, so a hundred rows each carrying their own value would be a hundred rules. Writing the author's own name inline leaves the rule text identical across rows, so they share one. The declaration that READS the variable — `font-family: var(--row-face, inherit)` — belongs to the element that owns the layout, and interns once. A rule targeting a DESCENDANT keeps the indirection, because a `var()` resolves from the nearest ancestor that set it and a shared descendant rule would otherwise read the wrong element's value.

**A number the host MEASURED is such a value**, and that is worth stating because its absence has twice been read as an exception. A floating panel's placement in viewport pixels reaches the scope as data like any other number — the measurement is the host's and belongs to the moment it was taken, but what the document does with it is an ordinary binding — so the declaration that positions the panel reads it there, and a document never has to assemble a `style` ATTRIBUTE to carry one. Two Studio surfaces did, on the belief that this paragraph did not cover them; `packages/studio/src/surfaces/block-action-bar.json` and `formula-palette.json` now bind the declaration, and each says so in its own `$description`.

An author's own `attributes: { "style": "…" }` is untouched by any of this; it remains a literal attribute, at inline precedence, and overrides the object.

### 9.2 Nested CSS Selectors

> **Status: Partial.** Flattening, selector-list distribution, recursion, the declaration-body at-rules and their array form, and `@keyframes` ship in `buildStyleRules` (`packages/runtime/src/css.ts`). Two parts do not: no static build renders a block's `$description` as a comment (the compiler's `pushStyleRules` and `packages/site/src/site-style.ts` emit the rule text only), and the compiler's handle is the author's FIRST class whenever `className` is set (`collectStyles` in `packages/compiler/src/shared.ts`), so an element's rules also style every other element carrying that class; the generated class is `jx-<n>` on pages rather than `.<tagName>-<n>`.

CSS nesting is supported via special keys. Keys beginning with `:`, `.`, `&`, or `[` are treated as nested selectors:

```json
{
  "style": {
    "backgroundColor": "blue",
    ":hover": { "backgroundColor": "darkblue", "cursor": "pointer" },
    ".child": { "color": "white" },
    "&.active": { "outline": "2px solid white" }
  }
}
```

Base and nested declarations alike become rules in one stylesheet, keyed on a handle the emitter chooses: the compiler prefers the element's own `#id`, then a **generated class** `.<tagName>-<n>` assigned in the compiled HTML; the runtime uses `data-jx` (§9.6). Base rules are emitted before nested ones, so an equal-specificity override wins by source order. (`data-jx-static` and `data-jx-prerendered` exist on emitted elements but are hydration markers, never CSS selectors.)

Nesting is **flattened by the emitter**, never handed to the browser as CSS Nesting: `&` is resolved before anything is written, and no `&` reaches the output. This is deliberate rather than incidental. A key like `.child` COMPOUNDS onto its scope here (`#box.child`), where CSS Nesting resolves the same key as a descendant, so a style object handed to a nesting parser would silently mean something else.

A **selector list** on either side distributes, member by member, as CSS Nesting's implicit `:is()` would: a key `"& .a, & .b"` holding a `":hover"` block yields `#box .a:hover, #box .b:hover`, and every `&` in a member is the scope. A comma inside `:is()`, `:where()`, `:not()`, an attribute value or a quoted string is not a separator. A member that holds an `&` anywhere is resolved by substitution alone, wherever the `&` stands: `".wrap &"` is the element inside a `.wrap` (`.wrap #box`) and `":root &:hover"` is `:root #box:hover`, never a compound. A leading `:`, `.` or `[` compounds only in a member with no `&`, and an `&` inside an attribute selector or a quoted string is text, not the scope.

Nesting is **recursive**: selector groups and at-rule groups (`@`-prefixed keys — named breakpoints per §9.4, or standard at-rules like `@starting-style`) may nest to arbitrary depth, e.g. breakpoint → selector → pseudo-class:

```json
{
  "style": {
    "& .nav-link": { "color": "gray", ":hover": { "color": "white" } },
    "@--sm": {
      "& li:nth-of-type(2n)": { ":hover": { "opacity": "0.8" } }
    }
  }
}
```

Both the compiler and the runtime resolve nesting recursively; the component and project style schemas model the same recursive contract. Selector groups and at-rule groups compose in **either order and to any depth** — `@media → selector → pseudo` and `selector → @media` are the same tree read two ways, and one emitter answers for both (§9.6).

**Some at-rules take a DECLARATION body rather than a selector body**, and both emitters recognise them by name: `@position-try`, `@property`, `@font-face` and `@counter-style`. Their block is emitted verbatim with no selector inside it and is not scoped to the element whose `style` object declares it, because the name such a rule declares is document-global — the same way an author writes one in a plain stylesheet, near the rule that uses it:

```json
{
  "style": {
    "position-anchor": "--menu-button",
    "position-try-fallbacks": "--flip-up",
    "@position-try --flip-up": { "inset-block-start": "auto" }
  }
}
```

The name is part of the key, so the test is a prefix match.

**A declaration at-rule may be written more than once, as an ARRAY of blocks**, emitted in the order given. An object's keys are unique, so a key names a rule once — and `@font-face` is the one at-rule of the four whose identity is NOT in its key, so a family with three weights had no spelling at all:

```json
{
  "style": {
    "@font-face": [
      { "font-family": "JetBrains Mono", "font-weight": "400", "src": "url(\"mono-400.woff2\")" },
      { "font-family": "JetBrains Mono", "font-weight": "700", "src": "url(\"mono-700.woff2\")" }
    ]
  }
}
```

**A block may document itself.** A `$description` in a style block is prose — why the rule exists, in the author's words — and is never a declaration. It is carried on the emitted rule rather than inside its text, because the text is what a sheet inserts and what the runtime interns rules by: prose there would make two otherwise identical rules two rules, and would put a paragraph into every adopted sheet. A static build renders it as a comment above the rule; every other consumer ignores it. **Every `$`-prefixed key in a style block is metadata** for the same reason it is everywhere else in a document, and no CSS property begins with `$` — a custom property begins with `--` — so the prefix can be refused whole. Writing one used to emit `$description: why this exists;`, an invalid declaration the parser drops in silence.

**Only these four keys take the form**, and the narrowness is deliberate. They are leaves — their bodies are declarations and nothing recurses into them — so a list there teaches no other reader anything new. Under a selector key an array would say what one block already says, while every style walker outside the emitter assumes a block key holds ONE block; admitting it there would leave those readers stepping past it in silence. A validator refuses the array under any other key, so the schema and the emitters agree about what a document means rather than one of them dropping what the other accepted.

**`@keyframes` is the third body shape**, and the only one: its children are neither declarations nor element selectors but **keyframe selectors** — `from`, `to`, `50%`, `"0%, 100%"` — each naming a point on an animation's timeline. Three rules follow, and each of them is a correctness requirement rather than a formatting preference:

1. A keyframe selector is taken **verbatim**. It is never resolved against the enclosing scope, never distributed as a selector list (`"0%, 100%"` is already one valid keyframe selector), and never passed to a host's selector transposition. A scoped stop — `@keyframes toast-in { #box from { … } }` — is parsed into a keyframes rule holding NO keyframes, so the `animation` declaration beside it names a live animation that animates nothing.
2. The block is emitted **once**, whole. Where two `@keyframes` rules share a name the last in document order wins and every earlier one is ignored, so a block split into one rule per stop is valid CSS that animates only its final stop.
3. The block is **unscoped** and hoisted like a declaration-body at-rule (§9.6), because the name it declares is document-global. Two elements that declare different bodies under one name therefore collide, and the later insertion wins; that is CSS, not an emitter choice.

A stop is **not a declaration on the element**, and nothing that scans a style object for what the author declared may count one. `display` is the case that bites: a custom element is `inline` until the runtime supplies `display: block`, and it withholds that default when the author declares a `display` of their own. Animating `display` is the ordinary shape of an `allow-discrete` reveal, so a scan that counted a stop left the element `inline` whenever it was still.

A **reactive value inside a stop is dropped** rather than indirected through a custom property. The indirection of §9.6 writes the variable inline on the one element that declared the style, while this rule belongs to the whole document, so the `var()` would be read where nothing set it. A stop's values are still passed through a host's value transposition, so the canvas keeps rewriting viewport units inside an animation.

A keyframes block nested inside `@media` or `@supports` keeps that wrapper. Inside a **scheme query** (§9.5) it is emitted once, under the media-guarded copy only: the forced-scheme twin re-points a selector, and a keyframes name has none to re-point, so a second copy would be a second definition of one name.

```json
{
  "style": {
    "animation": "toast-in 180ms ease-out",
    "@keyframes toast-in": {
      "from": { "opacity": "0", "translate": "0 1rem" },
      "to": { "opacity": "1", "translate": "0 0" }
    }
  }
}
```

> **Status: Implemented.** Wrapping a declaration-body at-rule in a selector produced a block the parser discards without a word, which is why an anchor-positioned panel could declare no custom fallback at all. Scoping a keyframe stop produced the same silence one layer down: no parse error, no warning, and a live `Animation` object with no keyframes in it.

### 9.3 Static Style Extraction

> **Status: Partial.** Extraction into one head `<style>` block ships (`compileStyles`, `pushStyleRules` in `packages/compiler/src/shared.ts`). The report does not: `takeDroppedReactiveStyles` has no production caller, so no build prints what it dropped, and where a build-time scope exists the compiler inlines the resolved template instead of dropping it (§9.1). And the project schema's `StyleObject` (`staticStyleObjectSchema` in `packages/schema/src/schema.ts`) accepts any string value, so it still admits a `${…}` template the paragraph below says it cannot carry.

The compiler extracts all static `style` definitions into a single `<style>` block in the document `<head>`.

**A reactive declaration is a runtime declaration, and a static emitter drops it.** It resolves against a live scope, which a built page has only where the runtime is present, so there is nothing for the compiler to write. That is correct, and it was silent — a document was right in the editor and simply unstyled in the built page. The compiler now reports each dropped declaration by property, source and selector. A project's own `style` block cannot carry one at all: it becomes the site stylesheet at build time, with no scope to resolve against, so the project schema does not admit a reactive value where the document schema does.

### 9.4 Named Media Breakpoints (`$media`)

Named breakpoints are declared at root level using `$media`, following the CSS `@custom-media` convention:

```json
{
  "$media": {
    "--sm": "(min-width: 640px)",
    "--md": "(min-width: 768px)",
    "--lg": "(min-width: 1024px)",
    "--dark": "(prefers-color-scheme: dark)"
  }
}
```

Within any `style` object, `@--name` keys reference named breakpoints. `@(condition)` keys are literal media queries, where the parentheses belong to the query itself — a feature query keeps them (`@(min-width: 1280px)`), while a bare media type does not, so `@(print)` emits `@media print`:

```json
{
  "style": {
    "fontSize": "14px",
    "@--md": { "fontSize": "16px" },
    "@--dark": { "color": "#ccc" },
    "@(min-width: 1280px)": { "fontSize": "18px" }
  }
}
```

`$media` declarations propagate through the component scope.

A `$media` entry whose value is a _pure_ `prefers-color-scheme` query — exactly `(prefers-color-scheme: light)` or `(prefers-color-scheme: dark)`, no other conditions — is a **scheme query**. Scheme queries participate in the forced-scheme contract defined in §9.5.

> **Status: Implemented.** Runtime `applyStyle` handles nested selectors, media breakpoints, and scoped style generation.

### 9.5 Color-Scheme Variants and Forced Schemes

Declaring a scheme query in `$media` opts a document (or site) into the color-scheme contract. Two normative constants define the visitor-facing override mechanism:

- **`data-color-scheme`** — attribute on the root element (`<html>`). Value `"light"` or `"dark"` forces that scheme; an absent attribute means _auto_ (follow the OS `prefers-color-scheme`).

`color-scheme` declared in a project's `style` block lands on `:root`, not on `body`. The site builder otherwise routes a custom property to `:root` and every other declaration to `body`, and this is the one property that must not follow that rule: `light-dark()` resolves against the element carrying `color-scheme`, so a scheme on `body` leaves every token declared on `:root` resolving against the wrong element. It is also what made the site builder and the runtime's own theme installer, which puts the same authored block on `:root`, disagree about one project.

- **`jx-color-scheme`** — `localStorage` key a site switcher persists the visitor's forced scheme under. Values `"light"` or `"dark"`; absent means auto.

**Dual emission.** Every style block keyed by a scheme query (`@--dark { … }` or a literal `@(prefers-color-scheme: …) { … }`) is emitted twice:

1. a media-guarded copy that applies only while no scheme is forced — root-level rules are guarded as `:root:where(:not([data-color-scheme]))`, scoped rules as `:where(:root:not([data-color-scheme])) <selector>`;
2. an unconditional forced copy under the attribute — `:root:where([data-color-scheme="dark"])` for root-level rules, `:where(:root[data-color-scheme="dark"]) <selector>` for scoped rules.

All guards are wrapped in `:where()` so specificity matches the unguarded selector and source order decides the cascade: base rules are always emitted **before** conditional blocks. At the project level, custom properties inside a scheme block land on `:root` and direct properties on `body`, mirroring the base emission.

**Compound-query limitation.** A query that combines `prefers-color-scheme` with any other condition (e.g. `(prefers-color-scheme: dark) and (min-width: 768px)`) is _not_ a scheme query: it keeps plain `@media` emission and does not respond to the forced attribute.

**`color-scheme` declaration.** When a scheme query is declared, the compiler emits `:root { color-scheme: light dark }` plus per-attribute overrides (`:root:where([data-color-scheme="light"]) { color-scheme: light }` and the dark equivalent) so native widgets, scrollbars, and form controls follow the forced scheme. Authors who set `colorScheme` in the project `style` suppress this emission.

**Pre-paint script.** Site and standalone compilation targets inject a small synchronous inline `<script>` into `<head>` — ahead of all style blocks — that reads `jx-color-scheme` from `localStorage` and sets `data-color-scheme` on the root element, eliminating any flash of the wrong scheme on load. Declaring a scheme query is the sole opt-in; no other configuration exists.

> **Status: Implemented.** `pureSchemeOf`/`schemeSelectors` (runtime, re-exported by the compiler) define the shared selector contract; `applyStyle`, `compileStyles`, and the site pipeline all dual-emit through them.

### 9.6 The Runtime Stylesheet Engine

The runtime delivers an element's styles as **CSS rules in a constructable stylesheet adopted by the document**, reached through `document.adoptedStyleSheets`. Nothing an author writes in a `style` object is written as an inline declaration.

**The handle is `data-jx`, and its value is a content hash.** A rule is scoped by `[data-jx="jx-<hash>"]`, specificity (0,1,0), stamped on the element by the runtime. It is not a generated class, because a class handle would be destroyed by a static `attributes: { "class": … }` applied after the style; and it is not random, because the hash is what lets two elements that style alike SHARE one rule set and what makes the handle stable across a server render and the client render that follows it. Everything that can vary per call site is an input to that hash: the authored object, the resolved `$media` map, and any host-specific value or selector transposition.

**A custom element carries TWO style objects, and they merge.** Its definition's, and the one written at the usage site — and the usage site wins where the two collide, at equal specificity by source order, the same promise this section already makes for a base block before a nested one. The merge is deep: a call site declaring `&:hover` replaces only the declarations it repeats inside it, never the definition's whole block. This has to be a merge rather than two applications, because each application releases what the last one interned; before it was one, the call site's rules were written while the element was detached and deleted the moment it connected, so a document could not style an element instance at all.

**A custom element with no `display` in its BASE block gets `display: block` in its own rule.** Not inline: an inline declaration is beaten only by `!important`, and a default is meant to be the weakest thing in the cascade rather than the strongest. At (0,1,0) a consumer's rule, a cascade layer or a parent's descendant rule all override it normally. Only the base block is consulted — a `display` appearing solely inside `&:hover` or a breakpoint is not the author supplying one, and reading it as such left the element `inline` at rest and a block on hover, which is wrong whenever it is still. An author who wants the platform's own value writes `display: revert-layer` in the base block, which this sees and which rolls the cascade back one layer rather than beating anything — the spelling that lets an element whose visibility the UA owns, such as a `popover`, keep it. Plain `revert` is weaker and is a trap: it rolls back to the user-agent ORIGIN, so it works on a shipped page and fails wherever a host has re-supplied the UA rule in a cascade layer of its own, which is exactly what an editing canvas does when it de-links an overlay (studio.md §4.2.2). `revert-layer` holds in both.

**Reactive declarations are indirected through a custom property.** A value carrying a `${…}` template or a `{ "$ref": … }` is emitted as `property: var(--jx-…)`, and the element sets that variable inline as its source changes. The declaration therefore stays in the rule, where a `:hover` or `@media` block can override it, while only the variable moves. In a rule that targets the element itself (its base declarations, its own states, its `@media` blocks) the variable is named by position alone, `--jx-s<m>`: the element reads the value it sets, which no ancestor can shadow, so elements styled alike keep sharing one rule set however their values differ. A rule that targets a descendant uses `--jx-r<n>-<m>`, with a per-element serial, and is never shared: a `var()` resolves from the nearest ancestor that set it, so a shared descendant rule would read the wrong element's value.

**Unscoped at-rules are hoisted.** The four declaration-body at-rules of §9.2, and `@keyframes` alongside them, declare a document-global NAME, so they are written once for the document and released when the last element that declares one lets go, rather than emitted per element.

Two cascade premises hold this together, and neither is Jx's to change:

1. **Adopted sheets cascade after the document's own `<style>` and `<link>`.** An adopted rule therefore wins an equal-specificity tie against a page stylesheet.
2. **Jx emits no cascade layer of its own.** An unlayered rule beats a layered one at any specificity, and third-party CSS arrives through `$head` unlayered; layering Jx's rules would hand every page's `$head` a win over the document's own styles. An authored `"@layer name"` key is passed through verbatim, as any other at-rule is.

A host that cannot construct a stylesheet falls back to a `<style>` element carrying the same rules, in the same order.

> **Status: Implemented.** `buildStyleRules` (`@jxsuite/runtime/css`) is the single definition of what a style object means as CSS, shared by `applyStyle`, the static compiler and the site-style builder, so a preview and the shipped page resolve the same nesting.

---

## 10. Dynamic Mapped Arrays

### 10.1 Array Namespace Syntax

A dynamic list is an array **pseudo-element** — an object with `$prototype: "Array"` that sits as a **member of a `children` array**, nestled among sibling elements or as the sole child. It renders **wrapper-less**: its mapped items become direct children of the array's parent (no intervening container).

```json
{
  "tagName": "ul",
  "children": [
    { "tagName": "li", "textContent": "Header" },
    {
      "$prototype": "Array",
      "items": { "$ref": "#/state/todoList" },
      "map": {
        "tagName": "li",
        "textContent": { "$ref": "$map/item" }
      }
    }
  ]
}
```

> **Backward compatibility.** The legacy form where `children` is _itself_ the Array object (`"children": { "$prototype": "Array", … }`) is still accepted: the runtime and compiler render its items directly into the parent element, and the studio normalizes it to a single array member on load.

### 10.2 Iteration Context

| Reference                  | Resolves to                          |
| -------------------------- | ------------------------------------ |
| `{ "$ref": "$map/item" }`  | The current array item object        |
| `{ "$ref": "$map/index" }` | The current zero-based integer index |

Template strings inside the map read the same context as `${$map.item…}` and `${$map.index}` (§6.6).

**From a handler.** An event handler bound anywhere inside a map — on the map body or on any of its descendants — reads its iteration off state as `state.$map`, carrying `item` and `index`. The iteration is published before the handler body runs, so a handler shared by every row can tell which row invoked it. A nested map shadows the outer context for handlers within it.

### 10.3 Filtering and Sorting

> **Status: Partial.** The interpreter filters and sorts (`renderMappedArrayInto` in `packages/runtime/src/runtime.ts`). No compiled path reads either key: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts`, both mapped-array emitters in `compile-client.ts` and the site build's build-time `expandMappedArrayStatic` (`packages/compiler/src/site/site-build.ts`) map `items` as given, so a built list shows every item in source order.

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/allItems" },
  "filter": { "$ref": "#/state/isVisible" },
  "sort": { "$ref": "#/state/sortByDate" },
  "map": { "tagName": "list-item", "item": { "$ref": "$map/item" } }
}
```

> **Status: Implemented.** The runtime renders array members inline (wrapper-less) via `renderMappedArrayInto()`, handling items, filter, sort, `$map/item`, and `$map/index`.

### 10.4 Keys

> **Status: Partial.** The interpreter reconciles by key as described below. The compiled targets do not: `emitMappedArray` in `packages/compiler/src/targets/compile-element.ts` and the client target lower a mapped array to an unkeyed `.map()` with no lit `repeat()`, so compiled rows are rebuilt rather than moved. And a `key` spelled `#/$map/item/…` is refused by the schema (`ArrayNamespace.key`) and falls back to the index at runtime (`mappedRowKey`).

A mapped array MAY declare a `key`: a `$map/item` pointer evaluated once per item that names the row's identity.

Both spellings of a `$map` pointer resolve: the bare `$map/item/x` and the `#/$map/item/x` form that matches how every other pointer in the schema is written. Only the bare one used to, and the other returned null — so a mapped array over it rendered no rows and reported nothing.

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/rows" },
  "key": { "$ref": "$map/item/id" },
  "map": { "tagName": "li", "textContent": "${$map.item.title}" }
}
```

Rows are reconciled by key. A row whose key survives a change keeps its DOM node and its effects: a reorder moves the node, an insertion creates only the new rows, a removal tears down only the removed ones, and `$map/index` updates in place on a row that moved. Focus, scroll position, an open `<details>` and a half-typed value therefore survive a change to the list, which is what makes a mapped array usable for a tree, a menu or a table the author is interacting with. Without `key`, rows are keyed by their index: the same reconciliation applies, so identity is preserved by position, and an insertion in the middle rewrites every row after it.

`{ "$ref": "$map/item" }` keys by the item itself — identity for an object, value for a primitive. A key that evaluates to nothing falls back to the index; a duplicate key is reported once, and every occurrence after the first is rebuilt on each change. `$map/index` is not a key, and the schema rejects it: an index names a position rather than a row.

Each row's bindings live in an effect scope of their own, stopped when the row is removed, and reads made while a row is constructed do not subscribe the list: a change to one row's data re-runs that row's bindings, never the list. A host may observe a move through `JxRenderOptions.onNodeMoved`, which reports the reused node and its new document path.

The first render of a list is synchronous; every later reconciliation is coalesced into one microtask. An array mutated in place — `reverse()`, `sort()`, an index write — notifies once per element it touches, and a reconciliation run between two of those writes would see an array that is half of each state, tearing down a row that is only transiently absent. A row's own bindings stay synchronous.

> **Status: Implemented.** Runtime `renderMappedArrayInto()` reconciles by key in one forward pass, moving only the rows that are out of place.

---

## 11. Web API Namespaces

### 11.1 Prototype Namespace Syntax

> **Status: Partial.** `$prototype` dispatch ships (`resolvePrototype` in `packages/runtime/src/runtime.ts`). The example's `urlParams` field is read by nothing: the runtime's `Request` case reads only `url`, `method`, `headers`, `body`, `debounce` and `manual`, `ExternalClassDef` does not declare it, and the compiled `emitRequestFetch` (`packages/compiler/src/shared.ts`) ignores it, so a `Request` re-fetches reactively only through a `${…}` template in `url`.

Web APIs are accessed via `$prototype` in a `state` entry:

```json
{
  "state": {
    "userData": {
      "$prototype": "Request",
      "url": "/api/users/",
      "urlParams": { "$ref": "#/state/userId" },
      "method": "GET"
    }
  }
}
```

### 11.2 Supported Prototypes

> **Status: Partial.** The interpreter's `resolvePrototype` handles every Web API row but `ReadableStream`, whose case returns `null`; the `Array` row is the §10 children node, not a state prototype. The client target (`compile-client.ts`) lowers `LocalStorage`, `SessionStorage`, `Request` and `Cookie`; the element target (`compile-element.ts`), which compiles every site component, lowers only `Request` and turns a storage or cookie entry into a plain initial value (its `default`), with no read and no persistence. `URLSearchParams`, `FormData`, `IndexedDB`, `Set`, `Map` and `Blob` reach a built page as the literal definition object in both targets, and the compiled `Request` (`emitRequestFetch` in `packages/compiler/src/shared.ts`) has no debounce or abort. Each cell below that reads Partial names its compiled gap.

| `$prototype`      | Web API      | Status                                                                                              |
| ----------------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `Request`         | Fetch API    | **Partial** — reactive URL, debounce, manual mode, abort controller; compiled: no debounce or abort |
| `URLSearchParams` | URL API      | **Partial** — computed `.toString()`; compiled: not lowered                                         |
| `FormData`        | FormData API | **Partial** — basic field population; compiled: not lowered                                         |
| `LocalStorage`    | Storage API  | **Partial** — reactive read/write with persistence; element target: `default` only                  |
| `SessionStorage`  | Storage API  | **Partial** — session-scoped reactive storage; element target: `default` only                       |
| `Cookie`          | Cookie API   | **Partial** — maxAge, path, domain, secure, sameSite (see §11.2a); element target: `default` only   |
| `IndexedDB`       | IDB API      | **Partial** — store creation, indexes, CRUD helper; compiled: not lowered                           |
| `Array`           | —            | **Implemented** — dynamic mapped list (see §10)                                                     |
| `Set`             | —            | **Partial** — `new Set(default)`; compiled: not lowered                                             |
| `Map`             | —            | **Partial** — `new Map(Object.entries(default))`; compiled: not lowered                             |
| `Blob`            | Blob API     | **Partial** — parts and type; compiled: not lowered                                                 |
| `ReadableStream`  | Streams API  | **Pending** — stub returns `null`                                                                   |

#### 11.2a The `Cookie` prototype's attribute rules

> **Status: Partial.** The runtime conforms (`serializeCookie` and `readCookie` in `packages/runtime/src/cookie.ts`). The compiled client target does not: `emitCookieInit` in `compile-client.ts` reads the cookie with a regular expression built from the author's name, and never writes the cookie back, so a compiled page neither persists a change nor applies any of the derived attributes.

Three attributes are **derived rather than taken as declared**, because a browser that disagrees with a cookie's attributes drops it silently — the write appears to succeed and the value is simply never there again ([RFC 6265bis](https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis) §4.1.3, §5.4.7):

- A **`__Host-`** name forces `Secure`, forces `Path=/`, and drops any declared `Domain`. Honoring a declared path or domain would produce a cookie no browser stores.
- A **`__Secure-`** name forces `Secure`, and leaves path and domain alone.
- **`SameSite=None`** forces `Secure`.

Two attributes are absent on purpose, and neither is a missing feature:

- **`HttpOnly`** cannot be set from script and would make the value unreadable to the binding that wrote it. Its absence is the correct behavior for a script-written cookie.
- **`Expires`** is not supported. `Max-Age` covers the same ground, §5.5 makes `Max-Age` win wherever both appear, and `Expires` takes an HTTP-date whose mis-spelling fails silently in the direction of a cookie that never expires.

The cookie **name is data, never pattern syntax**: the reader splits the cookie header rather than building a regular expression from an author-supplied name.

### 11.3 Timing Values

> **Status: Partial.** The compiler row ships only for an external class that names an `$implementation`: a self-contained class is refused with a console warning (§12.4), and a `$prototype: "Request"` is never fetched at build time, because `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) finds no class mapping for it and skips it, yet the site build strips both as resolved compiler entries, so nothing is baked and the page gets no fetch either. The client row holds in the interpreter, but in compiled output only for the built-ins a target lowers (§11.2) and for a registry class with a `lower` capability: an external class with `timing: "client"` reaches a built page as its literal definition object (compiler.md §3), and one with no `timing` is resolved at build time (`resolvePrototypes`), so the two tiers disagree about the default. The server row does not hold in a built site: the route is generated, but no compiled page calls it (§11.4).

| Value        | When                                                   | Status                                                                                                            |
| ------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `"client"`   | Resolved at runtime in the browser (default)           | **Partial** — a built page does not instantiate an external class (compiler.md §3)                                |
| `"server"`   | Resolved at runtime on the server via RPC              | **Partial** — the route ships, no compiled caller (§11.4)                                                         |
| `"compiler"` | Resolved at build time; result baked into emitted HTML | **Partial** — an external class with an `$implementation` only; not a `Request` or a self-contained class (§12.4) |

> **Status: Implemented.** The site build resolves a `timing: "compiler"` external class that names an `$implementation` at build time (`prototype-resolver`) and bakes the resolved data into the compiled tree; the resolved entries are then stripped from emitted output. The compiler's `isDynamic` check skips them, so a component whose only state is compiler-timed compiles as fully static HTML.

### 11.4 Server Timing — RPC Function Boundary

> **Status: Implemented.** A built page's module calls each entry at `<base>/_jx/server/<export>` (compiler.md §6.1); the site worker serves every entry a page, its layouts, `project.json` or a component declares (compiler.md §6.3); `jx dev` answers the same route on a site project (server.md §2); and an interpreting host calls only the `/__jx_server__` proxy (server.md §3.3), unless the host registered the module itself (embedding.md §6).

`timing: "server"` designates a cross-process function call. The entry points to a named export in a server-side module via `$src` and `$export`. No `$prototype` is used:

```json
{
  "state": {
    "metrics": {
      "$src": "./dashboard.server.js",
      "$export": "fetchMetrics",
      "timing": "server"
    }
  }
}
```

The referenced function must be an async export in the `$src` module. The function receives `(args, env)` — `args` is the arguments object from the caller, and `env` is the platform's environment bindings (Cloudflare Workers `env`, Node `process.env` wrapper, etc.):

```js
export async function fetchMetrics(args, env) {
  const db = env.DB; // e.g., Cloudflare D1 binding
  const { data } = await db.prepare("SELECT * FROM metrics").all();
  return data;
}
```

Functions that don't need platform bindings can ignore the second parameter:

```js
export async function fetchMetrics({ userId }) {
  const { data } = await supabase.from("metrics").select("*").eq("user_id", userId);
  return data;
}
```

`$src: "#server"` names the document's own server module, the text in its `$script.server` (§23.2). Everything else about the entry is as above: the export is async, takes `(args, env)`, and is served under its export name. In an interpreting host the proxy runs it from the document (server.md §3.3), which it finds by the address the entry was qualified with; a document handed to the runtime as an object has none, so its server entry stays `null`.

#### Arguments

An optional `arguments` field passes named parameters. Values may be static or reactive `$ref` references:

```json
"metrics": {
  "$src": "./dashboard.server.js",
  "$export": "fetchMetrics",
  "timing": "server",
  "arguments": {
    "userId": { "$ref": "#/state/userId" },
    "filter": "active"
  }
}
```

When any `arguments` value is a signal `$ref`, the call becomes reactive. The entry is `null` until a call answers. A call that fails leaves the entry's last value and is reported to the console, and the answer to a call whose arguments have since changed is dropped. The compiled call and the interpreter's proxy call both behave this way.

#### Security Boundary

**In a compiled deployment**, private environment variables and server-only credentials remain in the server process: the compiler emits the function into a route in the generated server output that the browser can only call over HTTP, and the browser receives only the serialized return value. That route is in the generated site worker (`dist/worker.js`, or `dist/_worker.js` under the Cloudflare Pages adapter), so a server entry requires `build.adapter`, and a build without one fails (compiler.md §6.3). The `env` parameter gives server functions access to platform bindings (KV namespaces, D1 databases, email workers, secrets) without exposing them to the client.

**In an interpreting host** (Studio's live preview and canvas, `jx dev` on a root without a `project.json`, or a page that calls `mount()`), the runtime never imports a `timing: "server"` module. Every call is a `POST` to the host's `/__jx_server__` proxy (server.md §3.3), which runs the function server-side with `env`, so the runtime never requests the module's source. A host may still serve the file at its URL (the development servers serve the project's files), so keep secrets out of the module body and read them from `env` inside the function. A host that answers no proxy leaves the entry `null` and reports the failed call. The one exception is the host's own act: a module it registered with `preloadModule` (embedding.md §6) is called in process.

> **Status: Future.** An interpreting host resolves a relative `$src` declared by a layout or by `project.json`'s `state` against the page it renders, because it composes the page before the runtime sees the entry; the site worker and `jx dev` on a site project resolve it against the file that declares it (compiler.md §6.3). A bare specifier, and a relative one on the page itself, resolve the same in every host.

#### Site-Wide Bundling

When `build.adapter` is set in `project.json`, all `timing: "server"` entries across the entire site (pages, their layouts, `project.json`'s `state` and components) are collected, one route per export name (two modules exporting one name fail the build), and bundled into a single worker entry point — `dist/worker.js`, or `dist/_worker.js` for `"cloudflare-pages"`. That same worker also carries the extension server mounts (extensions.md §11): authentication at `/_jx/auth`, connector data CRUD at `/_jx/data`. See compiler spec §6.3 for details.

---

## 12. External Class Integration

### 12.1 Built-in Prototypes

> **Status: Partial.** `Function`, `LocalStorage`, `SessionStorage` and `Request` resolve in the interpreter, except `Request`'s URL params (§11.1); their compiled lowering is §11.2's. The compile-time rows do not match the code: there is no `MarkdownFile` (the parser's manifest, `extensions/parser/jx-extension.json`, names it `Markdown`); `MarkdownCollection`, `ContentCollection` and `ContentEntry` resolve only through the extension registry, once `@jxsuite/parser` is listed in `project.json` `extensions` (`registryClassPath` in `packages/compiler/src/site/prototype-resolver.ts`); `Array` is a children-level node (§10), not a state prototype; and the runtime built-ins `URLSearchParams`, `Cookie`, `IndexedDB`, `Set`, `Map`, `FormData`, `Blob` and `ReadableStream` (§11.2) are missing from the table.

Jx provides several `$prototype` types that resolve automatically without any `imports` or `$src` configuration:

| Prototype            | Timing   | Description                                        |
| -------------------- | -------- | -------------------------------------------------- |
| `Function`           | client   | Inline handlers with `body`/`arguments`            |
| `Array`              | client   | Reactive array wrapper                             |
| `LocalStorage`       | client   | Persistent key-value storage                       |
| `SessionStorage`     | client   | Session-scoped key-value storage                   |
| `Request`            | client   | HTTP fetch with reactive URL params                |
| `MarkdownFile`       | compiler | Parses a single `.md` file into frontmatter + tree |
| `MarkdownCollection` | compiler | Globs and parses multiple `.md` files              |
| `ContentCollection`  | compiler | Schema-validated multi-format content source       |
| `ContentEntry`       | compiler | Single entry within a content collection           |

`MarkdownFile` and `MarkdownCollection` are first-class prototypes — they resolve at compile time with zero configuration:

```json
{
  "state": {
    "page": {
      "$prototype": "MarkdownFile",
      "src": "./content/about.md",
      "timing": "compiler"
    },
    "posts": {
      "$prototype": "MarkdownCollection",
      "src": "./content/posts/*.md",
      "timing": "compiler"
    }
  }
}
```

The compiler maps these names to their `.class.json` implementations internally (`@jxsuite/parser/MarkdownFile.class.json`, `@jxsuite/parser/MarkdownCollection.class.json`). No `imports` entry is needed.

### 12.2 The `$src` Property

For **third-party or project-local** classes, `$src` on any `state` entry with a non-Function `$prototype` **must** point to a `.class.json` file. The `.class.json` schema is the canonical entrypoint — it can optionally reference a JS implementation via `$implementation`. Direct JS `$src` for non-Function prototypes is not allowed.

```json
{
  "state": {
    "forecast": {
      "$prototype": "WeatherForecast",
      "$src": "./lib/WeatherForecast.class.json",
      "location": "Lancaster, PA",
      "days": 5
    }
  }
}
```

| Specifier form                      | Example                                      | Resolution                        |
| ----------------------------------- | -------------------------------------------- | --------------------------------- |
| Relative `.class.json` path         | `"./lib/WeatherForecast.class.json"`         | Relative to the `.json` file      |
| npm package specifier               | `"@acme/weather/WeatherForecast.class.json"` | Resolved via `node_modules`       |
| `$prototype: "Function"` with `.js` | `"./lib/helpers.js"`                         | Direct JS import (Functions only) |

### 12.3 External Class Contract

> **Status: Partial.** The constructor config, the `resolve()`/`.value`/instance order and `subscribe(callback)` ship in the interpreter (`importAndInstantiate` and `resolveClassJson` in `packages/runtime/src/runtime.ts`). A built page never instantiates an external class: a `timing: "client"` class reaches it as its literal definition (compiler.md §3), and the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) skips `.value`, going from `resolve()` straight to the instance. `unsubscribe()` is never called, so a subscription outlives its component, and no tool reads `returnType`: the Studio repeater check (`packages/studio/src/editor/convert-to-repeater.ts`) reads a `returns` key that `packages/server/src/studio-api.ts` copies from `methods.resolve.returns`, which only `ContentCollection.class.json` declares.

**Constructor:** Receives a single configuration object containing all `state` properties except reserved keywords (`$prototype`, `$src`, `$export`, `timing`, `default`, `description`).

**Value resolution:** Checked in order:

1. `instance.resolve()` — async method, awaited
2. `instance.value` — synchronous getter or property
3. `instance` itself — fallback

**Return type declaration:** Methods in a `.class.json` definition may declare a `returnType` field containing a JSON Schema type descriptor. This allows tooling (visual builders, type checkers, autocomplete) to reason about a method's output without executing it:

```json
"resolve": {
  "role": "method",
  "$prototype": "Function",
  "returnType": { "type": "array", "items": { "$ref": "#/$defs/ContentLoaderEntry" } }
}
```

The `returnType` value is a standard JSON Schema object (`type`, `items`, `properties`, `$ref`, etc.). It may reference local `$defs` within the same `.class.json` file; named return types conventionally live under the `returnTypes` `$defs` category (compiler spec §5.3) and are referenced as `{ "$ref": "#/$defs/returnTypes/<Name>" }`. For classes whose `resolve()` returns an array, this signals to tooling that instances are valid sources for mapped iteration (§10).

**Reactivity (optional):**

```js
instance.subscribe(callback);
instance.unsubscribe();
```

### 12.4 `.class.json` Schema-Defined Classes

> **Status: Partial.** The `.class.json` entrypoint, `$implementation` and runtime self-contained mode (`classFromSchema`) ship. "Tooling uses this metadata" does not hold: nothing reads `returnType` except `packages/compiler/src/targets/compile-class.ts`, which only sniffs it for an async prefix (§12.3). And the build-time resolver (`packages/compiler/src/site/prototype-resolver.ts`) refuses a class with no `$implementation` with a console warning, after which the site build strips the entry and reports no error, so self-contained mode is runtime-only (compiler.md §5.4).

All non-Function external classes **must** use a `.class.json` file as their `$src` entrypoint. These are JSON Schema 2020-12 documents describing a class structure with an optional `$implementation` key:

```json
{
  "$schema": "https://jxsuite.com/schema/v1/class",
  "$id": "WeatherForecast",
  "title": "WeatherForecast",
  "description": "Fetches weather data for a location",
  "$defs": {
    "parameters": {
      "location": { "type": "string", "description": "City and state" },
      "days": { "type": "integer", "default": 3 }
    },
    "fields": {
      "forecasts": { "type": "array" }
    },
    "methods": {
      "resolve": {
        "role": "method",
        "$prototype": "Function",
        "returnType": {
          "type": "array",
          "items": { "$ref": "#/$defs/returnTypes/ForecastDay" }
        }
      }
    },
    "returnTypes": {
      "ForecastDay": {
        "type": "object",
        "properties": {
          "date": { "type": "string" },
          "high": { "type": "number" },
          "low": { "type": "number" }
        }
      }
    }
  },
  "$implementation": "./weather.js"
}
```

When `$src` points to a `.class.json` file, the runtime reads the schema and follows `$implementation` to instantiate the class from the JS module. If no `$implementation` is present, the runtime dynamically constructs a class from the schema definition (self-contained mode).

The `returnType` field on a method uses standard JSON Schema to describe the output type. It may use `$ref` to reference `$defs` entries within the same class definition — by convention named schemas under the `returnTypes` category. Tooling uses this metadata to determine capabilities — for example, a method whose `returnType` declares `"type": "array"` indicates the class is a valid data source for mapped iteration (§10).

> **Status: Implemented.** Runtime enforces `.class.json` entrypoint for all non-Function external prototypes. `$implementation` in the schema optionally redirects to a JS module. Dev server handles resolution via proxy. Compiler emits `.class.json` → ES class.

### 12.5 Import Maps

> **Status: Partial.** The import-map rules ship. Two statements do not match the code: imports cascade from `project.json` (`packages/site/src/context.ts`), not `site.json`, and the last step before the unknown-prototype warning is the extension registry's manifest classes, present only for extensions listed in `project.json` `extensions`, not built-in mappings (§12.1).

To avoid repeating `$src` paths across every state entry, a document may declare a top-level `imports` key that maps `$prototype` names to `.class.json` paths:

```json
{
  "imports": {
    "WeatherForecast": "@acme/weather/WeatherForecast.class.json",
    "GeoLocation": "./lib/GeoLocation.class.json"
  },
  "state": {
    "forecast": {
      "$prototype": "WeatherForecast",
      "location": "Lancaster, PA",
      "days": 5
    },
    "coords": { "$prototype": "GeoLocation", "address": "123 Main St" }
  }
}
```

**Rules:**

| Rule                              | Description                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Values must end in `.class.json`  | Non-`.class.json` values emit a console warning and are skipped                    |
| Explicit `$src` wins              | If a state entry already has `$src`, the import map is not consulted               |
| `$prototype: "Function"` excluded | Function prototypes are never resolved via import map                              |
| Built-in prototypes unchanged     | `Request`, `Set`, `Map`, `LocalStorage`, etc. are unaffected                       |
| Import overrides built-ins        | An explicit `imports` entry takes precedence over built-in prototype mappings      |
| Site-level cascading              | `imports` in `site.json` cascade to all pages; page-level entries win on collision |

**Resolution order:** explicit `$src` → page `imports` → site `imports` → built-in prototype mappings → unknown prototype warning.

At runtime, `buildScope` injects the mapped `$src` into each bare `$prototype` entry before any resolution pass executes, so all downstream resolution (`resolvePrototype` → `resolveExternalPrototype` → `resolveClassJson`) works unchanged.

> **Status: Implemented.** Runtime pre-processes `doc.imports` in `buildScope`. Compiler merges project-level imports into page documents via `injectContext`. Site-loader defaults include `imports: {}`.

---

## 13. Component Encapsulation

### 13.1 Component Instances

> **Status: Partial.** Registration and instantiation by tag ship. The example below is wrong: `$elements` is an ARRAY of `{ "$ref" }` objects or package names (the schema's `type: "array"`, `registerElements` in `packages/runtime/src/runtime.ts`, `compileElement`), and the tag comes from the referenced document's own `tagName`, not a key; the keyed map shown throws at runtime and fails validation.

A component instance is created by **registering** the component document in the top-level `$elements` map (§16) and then placing an element node with its **custom-element `tagName`**, passing data through `$props`:

```json
{
  "$elements": {
    "my-card": { "$ref": "./components/card.json" }
  },
  "children": [
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

> **Status: Removed.** A node-level external `$ref` child — `{ "$ref": "./card.json", "$props": {…} }` placed directly in `children` — is **not** a component instance. The runtime does not fetch or render it (it produces an empty `<div>`, and `renderNode` emits a one-time console warning). Register the document in `$elements` and instantiate it by its custom-element tag, as above. `$switch` cases (§14) and `$elements` entries (§16) are the resolved external-`$ref` positions.

**There is no document-local element fragment either, and that is the more common cost.** A `$ref` in `children` renders an empty `<div>` and warns whatever it points at — an intra-document pointer as much as an external URL — and `#/$defs` could not be the place for one anyway: `$defs` holds JSON Schema type definitions and nothing else (§5.2), so a subtree parked there would be neither a schema nor reachable. The two positions that DO resolve a `$ref` to a document, an `$elements` entry (§16) and a `$switch` case (§14), both resolve an EXTERNAL one into an isolated scope — which is the property that makes them component boundaries and also the reason neither answers this. A fragment drawn inside a `$map` row reads that row, and neither position can see it without a props contract, a tag name and a definition of its own; that is the price of a component, and a row is not one. So a subtree drawn in two places is authored twice, and two shapes pay for it today. Where the two lists differ only by data, the host folds them into ONE projection carrying a discriminant and the document draws a single keyed `$map` over it — `packages/studio/src/surfaces/seo.json` says exactly that of its two groups, whose headings are data so the row template below them stays single. Where they do not, the fragment is repeated: `packages/studio/src/surfaces/panel-signals.json` writes its `[part="error-slot"]` subtree eight times, once inside each inline case of the `$switch` that picks a field's control.

### 13.2 Explicit Props

> **Status: Partial.** The interpreter implements the rule below (`instanceSupplies` in `packages/runtime/src/runtime.ts`). The compiled element does not: the `connectedCallback` that `compile-element.ts` emits merges a property only when `this.hasOwnProperty(key)`, so a compiled parent's `.title=` binding, which goes through the reflected accessor and creates no own property, is dropped and the component renders its default.

Props are passed via `$props` on the instance node. This is the only mechanism for passing state across component boundaries:

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

**An instance supplies a prop, or it does not.** The runtime takes a value from the instance only where the instance genuinely carries one — an own JS property, or an attribute of that name. Probing the element for the key alone is not enough, because a state key that collides with a **reflected** DOM property (`title`, `role`, `id`, `lang`, `dir`, `slot`, `hidden`) always answers: the accessor lives on the prototype and reports `""` when nothing is set, which would otherwise beat the component's declared default and render blank. Testing for an own property alone is equally wrong in the other direction — assigning a reflected name goes through that same accessor and creates no own property, so a real `$props.title` would be discarded. The attribute the accessor writes is what distinguishes the two.

### 13.3 Signal Forwarding

> **Status: Partial.** Forwarding is one way, parent to child, and fully so only in the interpreter, which writes the resolved value onto the child as a property and re-writes it from an effect when the parent changes (`renderCustomElementWithProps` in `packages/runtime/src/runtime.ts`). A compiled parent binds `.prop=`, but the compiled element defines no property accessors and reads a property once, in `connectedCallback` (§16.2), so it takes the parent's value at connection and loses every later change. In both tiers a child's write to a primitive prop updates only the child, and only a shared object or array proxy is seen by both scopes.

When a `$props` value is a `$ref` to a signal, the child receives the same reactive reference — writes in either scope trigger effects in both.

### 13.4 Scope Isolation

Signal scope is bounded at the component (custom element) level. Child components receive external state only via explicit `$props`.

> **Status: Implemented.**

---

## 14. Dynamic Component Switching

### 14.1 `$switch` Syntax

> **Status: Partial.** The interpreter implements the section (below). No compiled target renders an external `$ref` case: `compile-client.ts`, `compile-element.ts` and the static prerender in `packages/compiler/src/shared.ts` filter them out, so a built page renders an empty container for the example that follows, with no diagnostic.

```json
{
  "tagName": "main",
  "children": [
    {
      "$switch": { "$ref": "#/state/currentRoute" },
      "cases": {
        "home": { "$ref": "./views/home.json" },
        "about": { "$ref": "./views/about.json" },
        "profile": { "$ref": "./views/profile.json" }
      }
    }
  ]
}
```

**Container element.** A `$switch` node always renders a container element — its `tagName` if declared, else `div`. Properties, `style` (including `$media` breakpoints, §9.4), and `attributes` declared on the switch node apply to this container, exactly as on any element definition (§8). The active case renders as the container's children; when the discriminant changes, the container is emptied and the new case rendered in its place.

**Case forms.** Each `cases` value is one of:

- **An external component `$ref`** (`"./views/home.json"`) — the referenced document is fetched and rendered asynchronously; a stale load (the discriminant changed again before it resolved) is discarded.
- **An inline element definition** — any element object (§8), rendered synchronously.

**Scope.** The two forms differ in scope, mirroring §13/§15: an inline case renders in the parent component's scope, so parent `state` is directly visible to its bindings. An external case builds an isolated scope from the referenced document — a component boundary with no `$props` pass-through, so parent state is not visible inside it.

**Discriminant.** `$switch` holds a `$ref` to a state entry — or, inside a mapped array's template, to the row's `$map/item` or `$map/index` — so a per-row conditional is a switch on the row: a divider above the row that starts a group, a chord only where one is bound. The container carries the `slot` a slotted child needs, because the case content renders inside it.

**An unchanged key keeps its case.** A discriminant that re-resolves to the same key — a mapped row whose item was replaced by an equal one, a state entry rewritten with the value it had — leaves the rendered case in place: its subtree, its effects and its state survive. Only a different key empties the container.

**Matching.** The resolved discriminant is matched against `cases` keys by its string form (JSON object keys are strings — the same normalization the expression-level `switch` operator applies, §19.4b). No matching case leaves the container empty.

> **Status: Implemented.** Runtime `renderSwitch()` creates the container, applies properties/style/attributes to it, and reactively re-renders the active case — inline definitions in the parent scope, external `$ref` cases in an isolated scope resolved against the mount's base. Each case renders in an effect scope of its own, stopped before the next case renders, so a switch never accumulates the effects of the cases it has left; a stale external load — one that resolves after the discriminant moved on, to an inline case included — is discarded.

---

## 15. Scope Rules

### 15.1 Scope Levels

| Level      | Scope                   | Mirrors                   |
| ---------- | ----------------------- | ------------------------- |
| `window`   | Application-wide        | `window` global           |
| `document` | Document-wide           | `document` object         |
| Component  | Custom element boundary | CSS Custom Property scope |

### 15.2 Within-Component Scope

> **Status: Partial.** The interpreter renders the children written inside a component instance in the scope of the document that wrote them, before the instance distributes them. Built output does not for an instance written on a page or a layout: `expandComponents` (`packages/compiler/src/site/site-build.ts`) serialises those children with an empty scope before the page compiles, so a binding among them renders empty and is never hydrated, and a bound `$props` on an instance among them is lost the same way.

All `state` entries are available to all descendant elements within that component without explicit passing.

### 15.3 Cross-Component Scope

Signals do not cross component boundaries implicitly. `$props` is required.

### 15.4 Scope Resolution Order

A bare identifier or `#/state/` ref resolves in this order:

1. `$map/` iteration context, where present
2. The component scope — `state` entries and `$props`, which are **merged into the same scope** (a `$prop` overwrites a same-named `state` entry in place; there is no separate props namespace)

`window` and `document` globals are **not** part of this fallback chain: an explicit-scheme miss yields no value (a bare, schemeless ref is the only form that falls back to `null`). Reach globals with an explicit `window#/` / `document#/` ref (§7.4).

A template reads the page context bare: `${$page.locale}` and `${$site.name}` are the `$page` and `$site` entries of the scope (`site-architecture.md` §10), bound as names of the template the way `item` and `index` are, in the interpreter as in the compiler's static evaluation. Where a scope has neither, both read `undefined`.

> **Status: Implemented.**

---

## 16. Custom Element Definitions

### 16.1 Definition

> **Status: Partial.** The interpreter binds root-level `on*` handlers on the host (`bindDefinitionHandlers` in `packages/runtime/src/runtime.ts`). The compiled element module every site build ships (`compileElement`) does not: its `template()` renders only the definition's children and no host listener is emitted, so a root `onclick`, `onkeydown` or `ontoggle` is dropped in production.

A Jx component whose root `tagName` contains a hyphen is a custom element definition:

```json
{
  "tagName": "user-card",
  "state": {
    "username": "Guest",
    "status": "offline",
    "displayName": "${state.username} (${state.status})"
  },
  "children": [{ "tagName": "h3", "textContent": "${state.displayName}" }]
}
```

**A definition's root-level event handlers listen on the host element.** `onclick`, `onkeydown`, `ontoggle` and the rest, written beside `tagName` and `state`, attach to the element itself exactly as they would to an element inside a document, with the definition's own scope as `state` and the host as `event.currentTarget`. That is where an element's contract lives: a menu row's activation, a panel's keyboard handling and the `toggle` a popover fires all arrive at the host, and a definition that had to render an inner wrapper to hear them would be one element that looks like two. The other root-level keys — `observedAttributes`, `emits`, `description` — describe the element and are never written onto an instance.

### 16.2 Property-First Interface

> **Status: Partial.** The interpreter defines a property accessor forwarding into state for every non-private state key (`packages/runtime/src/runtime.ts`); for a key the platform already owns (`title`, `lang`, `hidden`) the accessor calls the native setter first, so the attribute still reflects and a value delivered after connection still reaches the render. The compiled element module (`compile-element.ts`) defines none: it reads a property only in `connectedCallback`, so `el.key = v` after connection, including the `.key=` binding a compiled parent re-commits when its own state changes, writes an inert own property and the element never re-renders.

Custom elements use JavaScript properties as their primary data interface. `$props` can include signal references, functions, objects, and scalars. HTML observed attributes are a secondary mechanism.

A prop the definition declares under the name of an `HTMLElement` property (`title`, `lang`) gets no forwarding accessor, so `el.title = v` writes the element's own property. A parent's `$props` binding addresses the definition's prop rather than the element's, and so in the interpreter it writes the instance's state as well once the instance has connected: a list row whose data arrives after it connected draws its title.

### 16.3 Dependency Registration (`$elements`)

```json
{
  "tagName": "variant-item-list",
  "$elements": [{ "$ref": "./components/variant-card.json" }]
}
```

Dependencies are registered depth-first before the parent.

> **Status: Implemented.**

### 16.4 Lifecycle Hooks

> **Status: Partial.** The interpreter implements all four rows and `mount()`'s two hooks. The compiled element (`packages/compiler/src/targets/compile-element.ts`) calls `onMount(this.state)` without the host, and emits no `adoptedCallback` and no `attributeChangedCallback`, so `onAdopted` never runs in a built site.

| Callback                   | `state` Entry | Called When                            |
| -------------------------- | ------------- | -------------------------------------- |
| `connectedCallback`        | `onMount`     | Element inserted into DOM and rendered |
| `disconnectedCallback`     | `onUnmount`   | Element removed from DOM               |
| `adoptedCallback`          | `onAdopted`   | Element moved to new document          |
| `attributeChangedCallback` | (automatic)   | Observed attribute changes             |

**A render that throws is reported, not thrown onward.** The interpreter renders an instance inside its async `connectedCallback`, so a definition whose render throws with the values it was given (a `date` defaulting to `""` passed to `Intl/formatDate`, whose `RangeError` is the standard's own, §19.4c) would otherwise surface as an unhandled rejection that names no element. A `${…}` template binding is not such a throw: it survives its expression throwing and draws nothing until it can (§6.1), so this is a throw elsewhere in the render, such as a `$ref` binding to a computed entry. It is reported on the same two surfaces as a refused instance (§16.9): the console line `Jx: <tag> was not rendered:` with the error, and a bubbling, composed `jx-error` `ErrorEvent` from the element. What rendered before the throw stays, slot content is still distributed into the slots that were drawn, the rest of the page renders, and `onMount` does not run for that instance. A host already out of the document reports nothing.

**And it is drawn again when what it was given changes.** A prop bound to data that arrives after the instance connected (a collection the page resolves after its first render, a row a list fills in) reaches the instance late, so the render that threw was a render of the empty values. The interpreter watches the definition's authored entries, the ones a prop can write, and when one changes it clears the instance and renders it again; a render that succeeds runs `onMount` then and stops the watch. Writes are coalesced into one microtask, the same error is reported once rather than per attempt, and a host removed from the document stops waiting.

`onMount` receives `(state, host)` — the element's scope and the element itself — and is called with the host as `this`, as the compiled element calls it, where a state function is an arrow inside the element class. A behaviour sidecar that has to reach the element it belongs to gets it as an argument; before it did not, and elements dispatched an event at themselves purely so a root handler could read `currentTarget`, which was a round trip standing in for a missing parameter. The other three hooks take `(state)`.

A document mounted by a host through `mount()` ([embedding.md](./embedding.md) §2) runs the same two hooks at its own boundary: `onMount` once its root is attached, `onUnmount` from `dispose()`. The names are shared on purpose, so a component and a mounted document read alike.

### 16.5 Observed Attributes

> **Status: Partial.** The interpreter implements the section (`absorbAttribute` and `declaredDefaults` in `packages/runtime/src/runtime.ts`). The compiled element module ignores `observedAttributes`: it emits no `static get observedAttributes`, no connect-time attribute read and no `attributeChangedCallback`, so in a built site `<user-card username="Ada">` renders the default, and later changes and removals do nothing.

```json
{
  "tagName": "user-card",
  "observedAttributes": ["username", "status"],
  "state": { "username": "Guest", "status": "offline" }
}
```

Type coercion: `string` → no conversion, `number` → `Number()`, `boolean` → presence check.

An observed attribute already on the element when it connects is read into state before `$props` are merged, so `<user-card username="Ada">` renders with `Ada` and a property a parent set before connection still wins (§16.2). The same coercion applies at connection and on every later change.

REMOVING an observed attribute restores the state entry's declared default. The removal is reported as a null value, and writing that through gave a `string` entry the value `null` and a `number` entry `Number(null)`, which is `0` — so a numeric prop could never express "unset", and clearing one wrote a zero where the author meant to delete a key. The default is the value the entry held before anyone set the attribute, which is what the removal asks to go back to. An entry declared in the shorthand form (`"username": "Guest"`) has that literal as its default; an entry that is computed (`$expression`, `$prototype`, `$ref`, `$src`) has none and a removal leaves it alone. A `boolean` is unaffected, because presence already IS its value. An entry with no declared default falls back by type: `0` for a number, the empty string otherwise, never null.

### 16.6 Light DOM Rendering

> **Status: Partial.** The compiler ships the light default, `$shadow` and `defaults.shadow`, the declarative-root prerender and its adoption, and `:host` translation (`packages/compiler/src/shadow.ts`). Two parts do not: the interpreter has no shadow support (no `$shadow`, `attachShadow` or `:host` handling in `runtime.ts`); and `site-build.ts` calls `compileElement` without `defaults`, so a project-level `defaults.shadow` reaches the prerender but not the component module.

Custom elements render to the light DOM by default. No shadow root is attached there, and none of the shadow-scoped styling primitives apply: no `attachShadow`, no `shadowrootmode`, no `::part`.

**A `<slot>` leaves no node.** Distribution replaces the literal `<slot>` with its matched children, or, when nothing matches it, with its own fallback children. The slot element itself is gone from the rendered tree. It used to survive and hold its matches, which looked right — a slot is `display: contents`, so the box tree was unaffected — and was wrong in the SELECTOR tree: a definition's `& > x` rule addressed a grandchild and silently stopped matching, so a component could not style what a consumer gave it. A consequence worth stating on its own: **a `part` written on a `<slot>` names nothing**, and a rule asking whether a slot received anything asks it of the containing part, whose `:empty` is now true exactly when nothing was slotted.

Scoping is therefore selector-based, in two parts: a component's own rules are prefixed with its **tag name** (`sty-card { … }`, `sty-card .inner { … }`), and a nested element carrying its own `style` gets a **generated class**, `.<tagName>-<n>`. `data-jx-static`, `data-jx-prerendered` and `data-jx-slots` appear on emitted elements but mark hydration state and are never used as selectors.

`adoptedStyleSheets` IS used, on the DOCUMENT rather than on a shadow root: it is where the runtime delivers an element's rules (§9.6). That is a delivery mechanism, not a scoping one — an adopted sheet is document-wide, so the selector handle above is still what confines a rule to its element.

What that buys and what it costs is the same fact stated twice: a page's own CSS can reach into a component and restyle it, and so can a stylesheet the author never wrote.

**A component may opt into a shadow root.** `$shadow: "open" | "closed" | false` on the component, `defaults.shadow` for the project, `false` if neither says otherwise. A component's own value wins in both directions, so `$shadow: false` opts one component out of a project that opted in.

Light DOM remains the default and is not a placeholder for this. The two modes differ in ways an author has to mean:

|                     | Light DOM                                                                  | Shadow DOM                                          |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Render target       | the element                                                                | its shadow root                                     |
| `<slot>`            | **emulated** — children saved, spliced back where the literal `<slot>` sat | real slot distribution                              |
| Style scope         | `<tag>` prefix, `.<tag>-<n>` classes                                       | `:host`, with `::slotted()` reaching assigned nodes |
| Stylesheet          | `<link>` in the document head                                              | `<link>` inside the shadow root                     |
| Page CSS reaches in | yes                                                                        | no                                                  |

Slot distribution is the difference that cannot be papered over, and the reason shadow cannot become the default: the emulation _moves_ children into the rendered tree, while a real `<slot>` leaves them in the light tree and projects them.

**Server rendering is a declarative shadow root.** A prerendered shadow component emits `<template shadowrootmode="open|closed">` containing its markup and its stylesheet link, with the slotted light children as **siblings outside** the template — where the slot projects them from. The parser materializes that root before any script runs, so the component paints correctly with JavaScript disabled or still loading.

**The element adopts that root rather than replacing it.** Calling `attachShadow` over an existing declarative root throws, and even where it did not, replacing it would discard the markup the feature exists to ship. An `open` root is found on the element; a `closed` one is not — by definition — and `ElementInternals` is the standard's only way back to it, which is why the two modes emit different lookups rather than one call with a mode string.

What the client render then does is **replace**, not hydrate: lit renders its own tree, so the declarative markup is cleared first, exactly as the light path clears `innerHTML`. The stylesheet link is the one child kept, because it styles that root and the document's head cannot reach in. Jx does not use lit-ssr's `hydrate`, so a declarative shadow root is a first paint rather than a hydration target — the same contract the light path has always had.

**A style object means the same thing in both modes.** `:host` and `:host(.sel)` are translated rather than passed through: inside a root they stand alone, and outside they become the tag name and `<tag>.sel`, which is what "the host, matching this" means when there is no root. Moving a component between modes therefore does not silently break its styles.

**Content-Security-Policy is unaffected.** The component stylesheet stays an external `<link>`, merely relocated, so no hash changes (site-architecture.md §14.3.1).

> **Status: Implemented.** In compiled output, light DOM is the default, and a component's own `$shadow` emits and adopts a declarative shadow root, verified in a browser for both modes.

### 16.7 Development vs. Production

> **Status: Partial.** Both renderers exist as tabled. The Development column describes Studio's live preview and canvas (`packages/server/src/live-preview.ts`) and roots without a `project.json`, not `jx dev` on a site project, which builds with `buildSite` and serves the compiled pages (`startDev` in `packages/server/src/dev.ts`); and the "~10 kB deps" figure has no committed measurement.

|          | Development           | Production                       |
| -------- | --------------------- | -------------------------------- |
| Renderer | `@jxsuite/runtime`    | `lit-html`                       |
| State    | `@vue/reactivity`     | `@vue/reactivity`                |
| Source   | JSON interpreted live | JSON compiled away               |
| Bundle   | `.json` + runtime     | `.js` classes only (~10 kB deps) |

### 16.8 CEM-Compatible Annotations

Custom elements may carry annotations compatible with the Custom Elements Manifest specification:

- `observedAttributes` — attribute declarations
- `parameters` on functions — CEM `Parameter` objects
- `emits` on functions — CEM `Event` objects
- `attribute` and `reflects` on typed `state` entries

> **Status: Partial.** The schema fields ship, and Studio edits `parameters`, `emits` and a typed entry's `attribute` and `reflects` (`packages/studio/src/panels/signals-panel.ts`), but nothing in `packages/studio/src` reads or writes the root `observedAttributes` array (studio.md §6.5). A per-document CEM 2.1.0 generator exists (`exportCemManifest` in `packages/studio/src/services/cem-export.ts`), but nothing calls it, no build emits a project `custom-elements.json`, and the generator maps only typed state entries carrying `attribute` into CEM `attributes`, not `observedAttributes`.

### 16.9 Instantiation Limits

**A definition that renders itself with the same props is an error, not a hang.** A definition's `children` may instantiate other definitions, and those may instantiate others, to any depth the page needs; each instance is one frame on an **instantiation chain** — its tag and the props it was given — that runs from the page-level instance down through every definition rendering inside it. Slot content is not on the chain of the instance it is slotted into: those nodes belong to whoever wrote them, so `<x-box><x-box/></x-box>` on a page is two instances of one tag, not a definition rendering itself. Two rules bind the chain, and they are the same two on both sides of the build:

1. **An instance whose frame is already on its chain is refused.** Same tag, same props, means the same render, forever — the one shape that can never terminate. The diagnostic names the chain: `Component <user-card> renders itself: user-card → user-card. A component cannot appear inside its own definition with the same props — the expansion would never end.`
2. **A chain of 32 frames is the cap.** A self-reference whose props change at every level — a tree node drawing its children until a `$switch` on its depth says stop — is data-driven recursion and is allowed, because the seen-set cannot tell a stop case that will come from one that was forgotten. The cap is what turns the second into a diagnostic: `Component nesting exceeds 32 levels: tree-node → … A component that renders itself with changing props needs a case that stops.` Thirty-two is beyond any component library's real depth and well inside the call stack's.

A prop's identity on the chain is the value the instance supplied that its definition's state reads, by whichever route it arrived — a JS property set before connection (§16.2), an observed attribute (§16.5), a `props.*` attribute, or the `data-jx-props` payload a prerendered instance upgrades with. Values compare by reference first and by JSON structure second, so a `$ref` forwarding the parent's own value and a payload parsed twice are each one value; a value that cannot be serialised is different from everything, and a page that forwards one is bounded by the cap alone rather than refused on a guess.

The **compiler** enforces both rules along the expansion path of every route it builds ([compiler.md](./compiler.md) §8.1): the route fails with the diagnostic and the other routes still build. The **interpreter** enforces them at connection: an instance that would never finish is refused before it has a state, a style or a child, so it stands as an empty host, and the rest of the page — the refused instance's siblings, and every other instance of the same tag, each on its own chain — renders as it would have. The refusal is reported two ways: the diagnostic goes to the runtime's console surface (`Jx: <user-card> was not rendered:` followed by the error), and the refused element dispatches a bubbling, composed `ErrorEvent` named **`jx-error`**, its `error` and `message` set to the diagnostic, so a page or a host wrapping one (the studio canvas around an iframe) can collect it where a console line reaches nobody. A refused host that is no longer in the document by the time the verdict is in — one an enclosing prerendered upgrade discarded as slot content while it awaited its scope — reports nothing, since the instance drawn in its place reports for it. A definition that builds is a definition that renders, and one that never settled the interpreter now names itself instead.

One boundary separates the two sides. The interpreter asks rule 1 only within a single **expansion**: the synchronous pass in which a definition's `children` render, instances connect and their definitions render in turn. A subtree an effect renders later — a `$switch` case that flips after the first paint, a `$map` row that arrives with new data — connects under the chain of the definition that drew the switch or the list, so rule 2 counts every frame above it, but the frames above the re-run are not searched for a repeat. The compiler searches its whole path because a build is one deterministic expansion; the interpreter cannot tell an `onMount` that flips a node into the same tag every time from a click that opens one more level of a node that starts closed, and the second is a page asking for one more, not a definition rendering itself. So the shape that repeats only across re-runs is ended by the cap rather than by the cycle check: thirty-three hosts and the nesting diagnostic, not a page that never settles.

> **Status: Implemented.** The compiler's check in `renderComponentInstance`; the interpreter's in the element's `connectedCallback`, carried from an enclosing render to the instances it creates across the asynchronous scope build. Verified in `packages/runtime/tests/self-instantiation.test.ts`.

---

## 17. Reserved Keywords

| Keyword              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `$schema`            | Dialect identifier                                                |
| `$id`                | Component identifier                                              |
| `$defs`              | Pure JSON Schema type definitions                                 |
| `state`              | Reactive state, computed values, functions, and data sources      |
| `$ref`               | Reference pointer (JSON Pointer, RFC 6901)                        |
| `$props`             | Explicit prop passing at component boundary                       |
| `$prototype`         | Constructor name — Web API class, `"Function"`, or external class |
| `$src`               | External module specifier                                         |
| `$export`            | Named export within `$src` module                                 |
| `$script`            | The document's own client and server modules (§23.2)              |
| `$switch`            | Dynamic component switching                                       |
| `$map`               | Iteration context namespace                                       |
| `$media`             | Named media breakpoint declarations                               |
| `$elements`          | Custom element dependency declarations                            |
| `timing`             | Execution timing: `"compiler"`, `"server"`, or `"client"`         |
| `default`            | Initial value for typed state entries                             |
| `body`               | Inline function body                                              |
| `arguments`          | Function parameter names (string array)                           |
| `parameters`         | Function parameter entries — bare names or CEM-compatible objects |
| `returnType`         | JSON Schema describing a `.class.json` method's return type       |
| `name`               | Inline function explicit name                                     |
| `description`        | Documentation string                                              |
| `observedAttributes` | HTML attributes the custom element watches                        |
| `$expression`        | Declarative operation, mutating or pure (Shape 5)                 |
| `operator`           | Operator token within an expression node                          |
| `target`             | Operand the operator acts on                                      |
| `value`              | Right-hand operand, or per-item expression for aggregates         |
| `initial`            | Seed accumulator for the reduce aggregate operator                |
| `onMount`            | Lifecycle: connected and rendered                                 |
| `onUnmount`          | Lifecycle: disconnected                                           |
| `onAdopted`          | Lifecycle: adopted into new document                              |

---

## 18. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). Two things once listed here are **not** standards and are therefore prose rather than rows: reactivity is `@vue/reactivity`, a library; and the `$media` breakpoint syntax borrows the shape of CSS `@custom-media`, a Media Queries Level 5 feature no browser ships, which Jx resolves itself at build and run time. The Custom Elements Manifest (§16.8) is a community format with no standards body.

| Standard                                                                                  | Class         | Binds          | Evidence                                                                                                                                     | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ECMA-404](https://ecma-international.org/publications-and-standards/standards/ecma-404/) | **Adopted**   | §3             | packages/schema/src/parse.ts                                                                                                                 | A Jx document is JSON. Nothing in the format extends the syntax.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/schema)                       | **Divergent** | §3.2, §5       | packages/schema/src/schema.ts, packages/schema/tests/schema.test.ts                                                                          | `$defs` holds genuine 2020-12 type definitions and a document validates as an _instance_ against a conformant meta-schema. Three deviations: Jx declares no `$vocabulary`, so it is not a dialect; `$id` is a display name and establishes no base URI for relative `$ref`; and `$schema` is an editor "schema for this instance" pointer, not a dialect declaration.                                                                                                                                                                                                                                  |
| [ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/) | **Subset**    | §5.3, §19, §20 | packages/runtime/src/expression.ts, packages/runtime/tests/expression.test.ts, packages/schema/tests/function-role.test.ts                   | Operator punctuators and their arity are ECMAScript's, and aggregate operations follow `Array.prototype` semantics — but only an allow-listed subset is evaluable, and `if`/`then`/`else` statements are imperative control flow over a statement list rather than anything from JSON Schema.                                                                                                                                                                                                                                                                                                          |
| [WHATWG DOM](https://dom.spec.whatwg.org/)                                                | **Subset**    | §16, §20       | packages/compiler/src/targets/compile-element.ts                                                                                             | Custom elements are defined and `dispatchEvent` emits a real `CustomEvent`. Shadow trees are not used at all (§16.6).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [WHATWG HTML](https://html.spec.whatwg.org/)                                              | **Subset**    | §8.7, §16.6    | packages/compiler/src/shadow.ts, packages/compiler/src/targets/compile-element.ts, packages/compiler/tests/shadow-dom.test.ts                | Custom elements are defined and upgraded as the standard describes and render into the **light DOM by default**. A component may opt into a shadow root with `$shadow` (a project into all of them with `defaults.shadow`), which emits a declarative `<template shadowrootmode>` the element then adopts — `open` through `element.shadowRoot`, `closed` through `ElementInternals`. Not offered: `ElementInternals` for form association, and `::part` addressed from outside a component.                                                                                                           |
| [WAI-ARIA](https://www.w3.org/TR/wai-aria-1.2/)                                           | **Subset**    | §8.8           | packages/schema/src/a11y.ts, packages/schema/tests/a11y.test.ts                                                                              | The role vocabulary the rules read (tab/tablist, menuitem/menu, option/listbox, dialog/alertdialog, the interactive roles) and the required-context and required-state relationships they enforce; the id-reference attributes as ARIA defines them. No conformance claimed for the runtime's own widgets.                                                                                                                                                                                                                                                                                             |
| [Accessible Name and Description Computation](https://www.w3.org/TR/accname-1.2/)         | **Subset**    | §8.8           | packages/schema/src/a11y.ts, packages/schema/tests/a11y.test.ts                                                                              | The name sources `interactive-unnamed` and `dialog-unnamed` honour, in accname's order of precedence — `aria-labelledby`, `aria-label`, native labelling (`<label>`, `alt`, `value`, `placeholder`), name from content for the roles that allow it, `title` — judged statically, so a bound source is taken as present.                                                                                                                                                                                                                                                                                |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/)                                                 | **Subset**    | §8.8           | packages/schema/src/a11y.ts, packages/schema/tests/a11y.test.ts, packages/studio/src/services/a11y-report.ts                                 | Success criteria 1.1.1, 1.3.1, 2.1.1 and 4.1.2, as the criteria the rules cite; each finding names its criterion. No level is claimed: the static rules are a subset of what a criterion asks, and the report says what it could not check.                                                                                                                                                                                                                                                                                                                                                            |
| [CSS Scoping](https://www.w3.org/TR/css-scoping-1/)                                       | **Subset**    | §16.6          | packages/compiler/src/shared.ts, packages/compiler/tests/shadow-dom.test.ts                                                                  | `:host`, `:host()` and `::slotted()` are emitted for a shadow component, and `:host`/`:host()` are translated to the tag name in light DOM so one style object serves both modes. `:host-context()` is not offered — it never reached a second engine.                                                                                                                                                                                                                                                                                                                                                 |
| [CSSOM](https://www.w3.org/TR/cssom-1/)                                                   | **Adopted**   | §9.1, §9.6     | packages/runtime/src/runtime.ts, packages/runtime/tests/stylesheet-engine.test.ts                                                            | `style` keys are the CSSOM camelCase IDL attribute names, so a property name needs no translation table. The runtime also builds a constructable `CSSStyleSheet` and delivers an element's rules through `document.adoptedStyleSheets`, using `insertRule`/`deleteRule`/`replaceSync` as specified; a host that cannot construct one falls back to a `<style>` element carrying the same rules.                                                                                                                                                                                                        |
| [CSS Nesting](https://www.w3.org/TR/css-nesting-1/)                                       | **Borrowed**  | §9.2           | packages/runtime/src/css.ts, packages/runtime/tests/css.test.ts                                                                              | The shape of a nested style block is taken; conformance is not claimed and `&` is never handed to a parser. Jx flattens nesting itself, and it has to: a `.child` key COMPOUNDS onto its scope here where CSS Nesting resolves it as a descendant, so the same source would mean two different things.                                                                                                                                                                                                                                                                                                 |
| [CSS Animations](https://www.w3.org/TR/css-animations-1/)                                 | **Subset**    | §9.2           | packages/runtime/src/css.ts, packages/runtime/tests/css.test.ts                                                                              | The `@keyframes` at-rule and its keyframe-selector grammar — `from`, `to`, a percentage, and a comma-separated list of those — are bound as authored: a stop key is copied verbatim, the block is emitted once and unscoped, and the last-definition-wins rule for a repeated name is why. None of the animation engine is implemented, and the standard's rule that `animation-*` properties and `!important` are ignored inside a keyframe block is not enforced.                                                                                                                                    |
| [CSS Color 4](https://www.w3.org/TR/css-color-4/)                                         | **Adopted**   | §9.5           | packages/compiler/src/shared.ts, packages/compiler/tests/shared.test.ts                                                                      | `color-scheme: light dark` is emitted with per-attribute overrides, so native controls follow a forced scheme rather than only the author's own rules.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)                                        | **Divergent** | §7             | packages/runtime/src/pointer.ts                                                                                                              | Pointer syntax is implemented as written, `~0`/`~1` escapes included, with `/` as the only separator. Four enumerated deviations: a `$ref` binds a live value off the reactive scope rather than resolving a node of a JSON document; a token matching nothing yields `undefined` instead of failing evaluation (§4); the `-` array token (§4) is not special and reads a member named `-`; and the `#`-fragment schemes (`window#/`, `parent#/`, `event#/`) are Jx extensions, not the URI fragment representation of §6 — they are not percent-decoded.                                              |
| [CSP Level 3](https://www.w3.org/TR/CSP3/)                                                | **Divergent** | §21            | packages/compiler/tests/no-eval.test.ts                                                                                                      | Compiled output contains no `new Function` and no `eval`, proven by a committed test, so it runs under a policy without `'unsafe-eval'`. The **interpreting** runtime compiles templates and function bodies at load time and therefore requires `'unsafe-eval'` permanently — §21.3 states this as a property, not a defect.                                                                                                                                                                                                                                                                          |
| [Trusted Types](https://www.w3.org/TR/trusted-types/)                                     | **Subset**    | §21.5          | packages/studio/src/services/trusted-types.ts, packages/studio/tests/trusted-types.test.ts, packages/compiler/src/targets/compile-element.ts | The injection-sink half only. No `innerHTML` write remains in code Jx ships — the runtime's four and the one the compiler emitted became `replaceChildren()` — and the shell's markdown goes through a policy that asserts and throws naming what it found, with `createScript`/`createScriptURL` refusing. **Enforcement is declined, not deferred**: `require-trusted-types-for 'script'` gates `eval` and `new Function`, which the interpreter is made of (§21.3), and the shell's remaining sinks belong to its dependencies. A report-only run established this and was removed with its header. |
| [KDL 2.0.0](https://kdl.dev/spec/)                                                        | **Subset**    | §22            | packages/schema/src/jxn/parse.ts, packages/schema/tests/jxn.test.ts                                                                          | Parsed by a conforming library, then narrowed: what JSON cannot hold, an annotation the grammar does not define, and a raw control character are refused (§22.2).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [JSON-in-KDL](https://github.com/kdl-org/kdl/blob/main/JSON-IN-KDL.md)                    | **Borrowed**  | §22            | packages/schema/src/jxn/parse.ts                                                                                                             | The `-` item and `(array)`/`(object)` shapes are taken. The reader is a superset that also understands `(ref)` and `(fn)`, and a list of one needs no annotation.                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## 19. Declarative Expressions (`$expression`)

### 19.1 Motivation

The Rule of Least Power (§2.2) defines a ladder of escalating power:

> `$ref` bindings → template expressions → handler functions

A gap exists between the third and fourth rungs. The moment an interaction must _write_ state — `state.count++`, `state.items.push(x)` — the only available tool is a Shape 4 `$prototype: "Function"` with a `body` string. A `body` string is opaque JavaScript: it cannot be validated by JSON Schema tooling, inspected by the visual builder, or analyzed by the compiler without parsing embedded source.

`$expression` introduces the missing rung: a **declarative operation** that mutates state through structure rather than through an interpreted string. It covers the common case of simple event-driven state changes — toggling a boolean, incrementing a counter, adding or removing array items — while `body` remains the escape hatch for logic that cannot be expressed declaratively.

This mirrors the relationship between `${}` and `$ref` established in §6.5: prefer the least powerful form; escalate only when necessary.

| Rung                     | Power   | Static-analyzable  | Use when                                    |
| ------------------------ | ------- | ------------------ | ------------------------------------------- |
| `$ref` binding           | Lowest  | Yes                | Reading a signal                            |
| `${}` template           | Low     | Yes                | Single-use computed read                    |
| **`$expression`**        | **Mid** | **Yes**            | **Simple declarative state mutation**       |
| `$prototype: "Function"` | Highest | No (`body` opaque) | Logic not expressible as a single operation |

### 19.2 Form

An `$expression` entry is an object containing a single `$expression` key whose value is an **expression node**. An expression node applies an `operator` to a `target`, optionally with a `value`:

```json
{
  "$expression": {
    "operator": "=",
    "target": { "$ref": "#/state/darkMode" },
    "value": { "operator": "!", "target": { "$ref": "#/state/darkMode" } }
  }
}
```

| Field      | Required          | Description                                                             |
| ---------- | ----------------- | ----------------------------------------------------------------------- |
| `operator` | Yes               | An operator token from the blessed set (§19.4)                          |
| `target`   | Yes               | The operand the operator acts on. A `$ref`, a literal, or a nested node |
| `value`    | By operator arity | The right-hand operand. A `$ref`, a literal, an array, or a nested node |

**Operand resolution.** `target` and `value` are resolved with the same rules as any `$ref` (§7.4). Consistent with §2.3, all references to state use explicit JSON Pointer `$ref` — never a raw `state.x` string. A `target` of `{ "$ref": "$map/item/qty" }` therefore resolves through map context exactly as elsewhere in the document.

**Operand literals.** A literal operand is a scalar (a string not containing `${`, a number, a boolean, `null`), an array of operands, or a **plain object**. An object carrying neither a `$ref` nor an `operator` key is a literal value passed through as-is — the form an `Intl` options bag takes as a `call` argument (§19.4c). Objects with those keys remain pointers and nested nodes respectively, never literals.

**Recursion.** A `value` or `target` may itself be an expression node (no `$expression` wrapper required on nested nodes — the wrapper appears only at the `state` entry or handler boundary). This permits compound expressions such as `counter = counter + 1`:

```json
{
  "$expression": {
    "operator": "=",
    "target": { "$ref": "#/state/counter" },
    "value": {
      "operator": "+",
      "target": { "$ref": "#/state/counter" },
      "value": 1
    }
  }
}
```

### 19.3 Operator Arity

> **Status: Partial.** Arity and mode routing ship (`isMutating` in `packages/runtime/src/expression.ts`; `buildScope` and the compiled targets route a mutating node to a handler and a pure node to a computed). Nothing enforces that a mutating node never appears as an operand: the schema's `ExpressionOperand` (`packages/schema/defs/expression-node.schema.ts`) admits the assignment and array-mutation branches, and the interpreter performs such a mutation as a side effect of evaluating the operand.

An expression node is one of two **modes**, determined entirely by its operator:

- **Mutating** — the node writes to its `target` and returns nothing. Used as an event handler. (`=`, the compound assigns, and the array-mutation methods.)
- **Pure** — the node computes and returns a value, mutating nothing. Used as a computed `state` value or as a nested operand. (Unary, binary, and the aggregate operators.)

The mode is not declared; it follows from the blessed operator set (§19.4). The compiler routes a mutating node to a handler and a pure node to a `computed()` (§19.8). A pure node may nest inside either mode; a mutating node may only appear at a handler boundary, never as an operand.

| Arity       | Mode     | Uses `target`      | Uses `value`         | Operators                                      |
| ----------- | -------- | ------------------ | -------------------- | ---------------------------------------------- |
| Unary       | Pure     | Yes                | No                   | `!`, `-` (negation)                            |
| Binary      | Pure     | Yes (left)         | Yes (right)          | `+ - * / %`, `=== !== < <= > >=`, `&& \|\| ??` |
| Conditional | Pure     | Yes (test / disc.) | Branches (see below) | `?:`, `switch` (see §19.4b)                    |
| Assignment  | Mutating | Yes (LHS)          | Yes (RHS)            | `=`, `+= -= *= /=`                             |
| Method      | Mutating | Yes (receiver)     | Args (see below)     | `push`, `pop`, `shift`, `unshift`, `splice`    |
| Aggregate   | Pure     | Yes (source)       | Per-item expression  | `reduce`, `map`, `filter` (see §19.4a)         |

For **binary** operators, `target` is the left operand and `value` the right; the result is a value (it does not mutate). For **assignment** operators, `target` is the assignable location (a writable `$ref`) and the operation mutates it. For **method** operators, `target` is the array receiver and `value` carries the arguments: a single value for `push`/`unshift`, an array of arguments for `splice` (`[start, deleteCount, ...items]`), and omitted for `pop`/`shift`. **Aggregate** operators are defined in §19.4a.

```json
{ "operator": "push",   "target": { "$ref": "#/state/cart" }, "value": { "$ref": "$map/item" } }
{ "operator": "splice", "target": { "$ref": "#/state/cart" }, "value": [{ "$ref": "$map/index" }, 1] }
{ "operator": "pop",    "target": { "$ref": "#/state/cart" } }
{ "operator": "+=",     "target": { "$ref": "$map/item/qty" }, "value": 1 }
```

### 19.4 Blessed Operator Set

> **Status: Partial.** The set is closed in the schema, so `jx validate` rejects an unknown operator, and in the interpreter, which throws on one. The compiler does not refuse it: `compileExpression` (`packages/runtime/src/expression.ts`) falls through to `"undefined"`, a test pins that, and `jx build` runs no schema validation, so a document with an unknown operator builds. The table also omits `call` (§19.4c) and the §19.4d methods, which the closed set includes.

The operator set is **closed**. An operator outside this list is a compile-time error; logic requiring it must use a `body` string. The set is chosen to cover the mutation patterns already present in `body` strings across the existing examples (e.g. Appendix A's `push`, `splice`, and `!`-toggle handlers).

| Category               | Tokens                                  |
| ---------------------- | --------------------------------------- |
| Assignment             | `=` `+=` `-=` `*=` `/=`                 |
| Unary                  | `!` `-`                                 |
| Arithmetic (binary)    | `+` `-` `*` `/` `%`                     |
| Comparison             | `===` `!==` `<` `<=` `>` `>=`           |
| Logical (binary)       | `&&` `\|\|` `??`                        |
| Conditional (pure)     | `?:` `switch` (see §19.4b)              |
| Array mutation methods | `push` `pop` `shift` `unshift` `splice` |
| Aggregate (pure)       | `reduce` `map` `filter`                 |

All tokens except the methods and `switch` are genuine ECMAScript operator punctuators (`?:` names the conditional operator's two punctuators as one token; `??` is nullish coalescing). `switch` is the ECMAScript selection keyword, mirroring the element-level `$switch` (§14). The array and aggregate methods are genuine `Array.prototype` methods. No token in this table is invented.

### 19.4a Aggregate Operators

Aggregate operators are **pure** (§19.1): they read an array `target` and return a derived value, mutating nothing. They are the declarative replacement for the callback-in-a-string pattern a Shape 3 template would otherwise require (`"${state.cart.reduce(...)}"`), keeping the per-item computation as an inspectable expression tree rather than opaque source.

Their `value` is a single **per-item expression node** evaluated once per element of `target`, in a scope where the existing `$map/` context (§7.2) is bound to the current element:

| Reference                   | Bound during aggregation             |
| --------------------------- | ------------------------------------ |
| `{ "$ref": "$map/item" }`   | The current array element            |
| `{ "$ref": "$map/index" }`  | The current zero-based integer index |
| `{ "$ref": "$reduce/acc" }` | The accumulator (`reduce` only)      |

This is the same `$map/` binding §10.2 establishes for mapped-array templates; an aggregate's per-item expression is conceptually identical to a `map`'s per-item template, so no new iteration concept is introduced. `$reduce/acc` is the sole new pointer — the fold accumulator, resolvable only inside a `reduce` per-item expression.

| Operator | `value` (per-item expression)              | `initial`  | Returns                            |
| -------- | ------------------------------------------ | ---------- | ---------------------------------- |
| `reduce` | step: combines `$reduce/acc` with the item | Required   | The final accumulator value        |
| `map`    | the value to produce per item              | Disallowed | A new array of the produced values |
| `filter` | a predicate (truthy = keep)                | Disallowed | A new array of the kept elements   |

`reduce` requires an `initial` field — the seed accumulator. `map` and `filter` must not declare `initial`.

**Cart total** — `cart.reduce((acc, item) => acc + item.price * item.qty, 0)`:

```json
{
  "total": {
    "$expression": {
      "operator": "reduce",
      "target": { "$ref": "#/state/cart" },
      "initial": 0,
      "value": {
        "operator": "+",
        "target": { "$ref": "$reduce/acc" },
        "value": {
          "operator": "*",
          "target": { "$ref": "$map/item/price" },
          "value": { "$ref": "$map/item/qty" }
        }
      }
    }
  }
}
```

**Filter then count** composes by nesting an aggregate as the `target` of another — `cart.filter(i => i.qty > 0)`:

```json
{
  "operator": "filter",
  "target": { "$ref": "#/state/cart" },
  "value": {
    "operator": ">",
    "target": { "$ref": "$map/item/qty" },
    "value": 0
  }
}
```

Aggregate `map`/`filter` are the inline, declarative form of the `filter`/`sort` hooks gestured at in §10.3 — those hooks accept a `$ref` to a function today; an aggregate expression expresses the same predicate structurally.

### 19.4b Conditional Operators

Conditional operators are **pure** (§19.1): they select among operands and return the selected value, mutating nothing. They are the declarative replacement for conditional logic that would otherwise require a template string or a `body` string.

**`?:`** is the ECMAScript conditional operator. Its fields map onto the existing node shape following ESTree's `ConditionalExpression` (test / consequent / alternate): `target` is the test, `value` the consequent, and `initial` the alternate (the same field-repurposing precedent as `reduce`'s seed). All three are required.

```json
{
  "operator": "?:",
  "target": { "operator": ">", "target": { "$ref": "#/state/cart/length" }, "value": 10 },
  "value": "Cart full",
  "initial": "Keep shopping"
}
```

Else-if chains nest another `?:` in `initial`, exactly as in ECMAScript. A visual editor renders the chain as a flat If / Else-if / Else list; the AST needs no dedicated chain node.

**`switch`** is value-keyed multiway selection, mirroring the element-level `$switch`/`cases` (§14) at expression level: `target` is the discriminant, `cases` maps the discriminant's **string form** to result operands, and the optional `default` is the result when no key matches (`undefined` without it). `value` and `initial` are not used.

```json
{
  "operator": "switch",
  "target": { "$ref": "#/state/status" },
  "cases": { "loading": "Please wait…", "error": { "$ref": "#/state/errorMessage" } },
  "default": { "$ref": "#/state/data/title" }
}
```

Matching is on the string form (`String(discriminant)`) because JSON object keys are strings — the same normalization the element-level `$switch` applies. Arbitrary-condition branching composes from `?:` chains; `switch` is reserved for discriminant matching, as in ECMAScript.

**`??`** (nullish coalescing) joins the binary table: `target ?? value`, returning `value` only when `target` is `null` or `undefined`. Prefer it over `\|\|` when `0`, `""`, or `false` are legitimate values.

In production evaluation `?:` and `switch` evaluate only the taken branch. Under the editor trace (§19.9) every branch is evaluated so each carries a live value.

### 19.4c Named Formulas and the `call` Operator

> **Status: Partial.** Named formulas, `$args/`, `call`, `BLESSED_GLOBALS` and `BLESSED_HELPERS` ship (`packages/runtime/src/expression.ts`). Recursion is not bounded as stated: no compiler check rejects a call cycle, the callable `buildScope` builds does not carry `callDepth`, so `MAX_CALL_DEPTH` bounds only the raw-definition path, and compiled formulas (`emitFormulaFn` in `packages/compiler/src/shared.ts`) have no bound. The helper table is stale: eight helpers ship (`packages/schema/src/intl.ts`, site-architecture.md §13.7), not three.

A **named formula** is a Shape 5 expression entry with `parameters` (the same convention as Function entries, §5.3 4d — bare names or CEM parameter objects): a pure, reusable computation. Parameterless pure entries remain computed values exactly as before; the presence of `parameters` makes the entry **callable** instead.

```json
{
  "state": {
    "lineTotal": {
      "parameters": [
        { "name": "price", "type": { "text": "number" } },
        { "name": "qty", "type": { "text": "number" }, "default": 1 }
      ],
      "$expression": {
        "operator": "*",
        "target": { "$ref": "$args/price" },
        "value": { "$ref": "$args/qty" }
      }
    }
  }
}
```

Inside a formula body, parameters resolve via the **`$args/` scheme** — a context binding like `$map/` and `$reduce/acc`, inserted into the §7.4 resolution order above `event#/`. Deep paths (`$args/user/name`) navigate the argument value.

**`call`** (a genuine `Function.prototype` name) invokes a callable: `target` is the callee pointer and `value` is the positional argument list — the `splice` args-in-value precedent. Argument order follows the callee's declared `parameters`; omitted arguments take their CEM `default`.

```json
{
  "operator": "call",
  "target": { "$ref": "#/state/lineTotal" },
  "value": [{ "$ref": "$map/item/price" }, { "$ref": "$map/item/qty" }]
}
```

**Blessed globals.** A callee may also be a pure standard-library function through the existing `window#/` scheme, gated by the closed `BLESSED_GLOBALS` allowlist (`Math.*`, `JSON.*`, `Object.keys/values/entries/fromEntries`, `Number.*`, `Array.from/isArray/of`, `String.fromCharCode/fromCodePoint`, the `Intl` helpers below, …). Every entry is a genuine ECMAScript or WHATWG function with no side effects; anything off the list is an error at compile time and evaluation time alike. Impure platform functions (`fetch`, `alert`, `Math.random`, `Date.now`) are deliberately absent — side effects belong to Function entries.

```json
{
  "operator": "call",
  "target": { "$ref": "window#/Math/max" },
  "value": [{ "$ref": "#/state/a" }, { "$ref": "#/state/b" }, 0]
}
```

**Intl helpers.** The `Intl` formatters are constructors, not plain functions, so they cannot join the allowlist directly. Three **synthetic helpers** wrap construct-then-format as pure calls:

| Helper                    | Signature                          | Wraps                                                              |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `Intl/formatNumber`       | `(value, locale?, options?)`       | `new Intl.NumberFormat(locale, options).format(value)`             |
| `Intl/formatDate`         | `(value, locale?, options?)`       | `new Intl.DateTimeFormat(locale, options).format(new Date(value))` |
| `Intl/formatRelativeTime` | `(value, unit, locale?, options?)` | `new Intl.RelativeTimeFormat(locale, options).format(value, unit)` |

The interpreter dispatches these through a helpers table (`BLESSED_HELPERS`); the compiler emits the equivalent inline construct-then-format expression. An `options` argument is a plain-object literal operand (§19.2):

```json
{
  "operator": "call",
  "target": { "$ref": "window#/Intl/formatNumber" },
  "value": [{ "$ref": "#/state/price" }, "en-US", { "style": "currency", "currency": "USD" }]
}
```

**Semantics and lowering.** Project-global formulas live in `project.json` `state` and reach every page through the standard project-state merge — there is no separate formulas section. `buildScope` lowers a named formula to a scope callable that maps positional arguments onto parameter names; call sites therefore compile to plain positional calls (`state.lineTotal(3, 4)`), identical in the interpreter and every compiled target. `call` chains are bounded by `MAX_CALL_DEPTH` (64) against unbounded recursion; the compiler must additionally reject statically detectable call cycles. Reads inside a formula body are tracked reactively as usual — a computed that calls a formula recomputes when the formula's inputs change.

### 19.4d Pure Standard-Library Method Operators

The method-operator table extends to genuine **pure** `String.prototype`, `Array.prototype`, and `Number.prototype` methods — the receiver in `target` (any operand, including a derived value), the argument in `value` (bare scalar) or argument list (array, the `splice` precedent). Where the standard library's original method mutates, the ES2023 change-by-copy name stands in — `toSorted` not `sort`, `toReversed` not `reverse`, `toSpliced`/`with` not `splice`/index assignment — so every operator in this table remains pure. No token is invented.

| Prototype | Operators                                                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Array     | `includes` `indexOf` `lastIndexOf` `join` `slice` `concat` `at` `flat` `toSorted` `toReversed` `toSpliced` `with`                                                                                                         |
| String    | `toUpperCase` `toLowerCase` `trim` `trimStart` `trimEnd` `split` `startsWith` `endsWith` `padStart` `padEnd` `replaceAll` `repeat` `charAt` `normalize` `toLocaleUpperCase` `toLocaleLowerCase` (plus the Array homonyms) |
| Number    | `toFixed` `toPrecision` `toLocaleString`                                                                                                                                                                                  |

```json
{ "operator": "toUpperCase", "target": { "$ref": "#/state/name" } }
{ "operator": "includes",    "target": { "$ref": "#/state/tags" }, "value": "featured" }
{ "operator": "toSorted",    "target": { "$ref": "#/state/scores" } }
{ "operator": "padStart",    "target": { "$ref": "#/state/code" }, "value": [6, "0"] }
```

Evaluation is null-safe, matching path reads: a missing receiver or a method absent from the receiver's type yields `undefined` rather than throwing (compiled form: `(receiver)?.method?.(args)`). Aggregates (§19.4a) likewise accept a derived array as `target` — `join(map(split(name, " "), …), "")` composes without intermediate state entries.

### 19.5 The `event#` Reference Scheme

> **Status: Partial.** The scheme resolves in the interpreter and compiles to the handler's event parameter (`packages/runtime/src/expression.ts`). The compile-time error is not implemented: no compiler, schema or `jx validate` check restricts `event#/` to handler position, so a pure computed that reads it resolves against a null event.

Handlers receive `(state, event)` (§4.3). To allow `$expression` handlers to read event data without escalating to a `body` string, the reference system (§7.2) is extended with one scheme:

| Scheme        | Example                 | Resolves to                          |
| ------------- | ----------------------- | ------------------------------------ |
| Event context | `"event#/target/value"` | A property path on the handler event |

`event#` is resolvable only within an expression node used as an event handler. Referencing it from a `state`-entry expression that is not invoked as a handler is a compile-time error. It is inserted into the §7.4 resolution order immediately below `$map/`:

```
1. $map/       — iteration context
2. $reduce/acc — fold accumulator (reduce per-item expression only)
3. $args/      — named-formula parameters (callable body only, §19.4c)
4. event#/     — handler event context (handler position only)
5. #/state/    — current component scope
6. parent#/    — explicitly passed props
7. window#/    — global window properties
8. document#/  — global document properties
```

Example — an input handler with no `body` string:

```json
{
  "tagName": "input",
  "attributes": { "placeholder": "Item name" },
  "oninput": {
    "$expression": {
      "operator": "=",
      "target": { "$ref": "#/state/name" },
      "value": { "$ref": "event#/target/value" }
    }
  }
}
```

### 19.6 Placement

> **Status: Partial.** All three positions ship in the interpreter, the element target and the static target. Two parts do not: `jx validate` has no lint for a tag discriminant that is also an assignment target (`packages/compiler/src/site/validate-command.ts` runs only the popover, dialog and accessibility lints), and `compile-client.ts` refuses a tag expression on a dynamic page ("A tag chosen at creation is not supported on a dynamic page yet").

`$expression` is valid in three positions:

1. **As a `state` entry** (a named, reusable operation — Shape 5, §19.7):

   ```json
   {
     "state": {
       "toggleTheme": {
         "$expression": {
           "operator": "=",
           "target": { "$ref": "#/state/darkMode" },
           "value": {
             "operator": "!",
             "target": { "$ref": "#/state/darkMode" }
           }
         }
       }
     }
   }
   ```

2. **Inline as an event handler value** on any element, in place of a `$ref` to a function:

   ```json
   {
     "tagName": "button",
     "textContent": "Toggle",
     "onclick": {
       "$expression": {
         "operator": "=",
         "target": { "$ref": "#/state/darkMode" },
         "value": { "operator": "!", "target": { "$ref": "#/state/darkMode" } }
       }
     }
   }
   ```

A named `state` expression may be bound to multiple elements via `$ref` (`"onclick": { "$ref": "#/state/toggleTheme" }`), exactly as a Function entry is. Prefer the named form when reused; prefer the inline form for single-use handlers (cf. §6.5).

A **pure** expression (§19.1) used as a `state` entry is a computed value — it is read via `$ref` or `${}` like any Shape 3 computed (`"textContent": { "$ref": "#/state/total" }`). A **mutating** expression used as a `state` entry is a handler, bound to events. The mode follows from the operator; it is not declared.

3. **As an element's `tagName`** — a tag chosen when the element is created, narrowed to the `TagExpression` shape: `?:` or `switch`, whose every result is a literal `TagName`. This is the one position where an `$expression` is **not live** — the tag is resolved once, at creation, and never re-read.

   ```json
   {
     "tagName": {
       "$expression": {
         "operator": "?:",
         "target": { "$ref": "#/state/href" },
         "value": "a",
         "initial": "div"
       }
     },
     "attributes": { "href": "${state.href}" },
     "children": ["…written once, whichever tag it turns out to be…"]
   }
   ```

   **Why the results are tag names and not operands.** The candidate set has to be readable without evaluating anything: the compiler emits one template per candidate (lit cannot bind a tag name), `jx validate` refuses an illegal name at authoring time, and the void-element, preformatted and slot analyses that read a tag structurally keep a finite set to reason about. A `${…}` template here would surrender all of it — and did: nothing in the pipeline evaluated one, so each consumer failed differently and silently.

   **Why once and not live.** A tag that changed after mount means replacing the element, and the subtree's listeners, focus, typed input values and component instances go with it. `jx validate` warns when a tag discriminant is also an assignment target, so the case where the rule bites is caught before it ships. The document ROOT's `tagName` and a `$head` entry's stay literal — they are a custom element's name and a head tag.

### 19.7 Shape Detection (amends §5.7)

A new branch is inserted **before** the `$prototype` check, since the entry is identified by its own reserved key:

```
For each entry in state:

1. Value is a string containing "${"?
   → Shape 3: Computed (computed())

2. Value is a string, number, boolean, null, or array?
   → Shape 1: Naked value (reactive property)

3. Value is an object with "$expression"?
   → Shape 5: Expression (declarative operation; mutating → handler, pure → computed)

4. Value is an object with "$prototype"?
   → Shape 4: Prototype (function, data source, or external class)

5. Value is an object with "default" (no "$prototype")?
   → Shape 2: Typed value (reactive property with type metadata)

6. Value is a plain object (no reserved keys)?
   → Shape 1: Object value (reactive property)
```

### 19.8 Compilation

An `$expression` lowers to the **same target** as the equivalent `body` string (§4.3, §5.5): a function over the `state` reactive proxy. The difference is that the function is _constructed from structure_ rather than parsed from a source string, so it is fully analyzable before emission and never requires `eval`/`new Function`.

The toggle expression:

```json
{
  "operator": "=",
  "target": { "$ref": "#/state/darkMode" },
  "value": { "operator": "!", "target": { "$ref": "#/state/darkMode" } }
}
```

compiles to the equivalent of:

```js
(state, event) => {
  state.darkMode = !state.darkMode;
};
```

Reactivity is identical to a hand-written handler — Vue tracks the reads and writes on the `state` proxy. Array-mutation operators compile to in-place mutations (`state.cart.push(...)`), which Vue tracks per §5.5.

A **pure** expression (§19.1) lowers instead to a `computed()` (the same target as a Shape 3 template, §5.3), since it returns a value and mutates nothing. The cart-total `reduce` compiles to the equivalent of:

```js
computed(() => state.cart.reduce((acc, item) => acc + item.price * item.qty, 0));
```

The per-item expression node becomes the callback body, with `$reduce/acc` bound to the accumulator parameter and `$map/item` / `$map/index` to the element and index. Because the source array is read inside the `computed`, Vue tracks it — the total recomputes whenever the cart or any line's `price`/`qty` changes. As with handlers, the callback is _constructed from the node tree_, never parsed from a string, so it stays analyzable and the visual builder can render each node as an editable form control.

Conditional nodes compile to their ECMAScript equivalents: `?:` to a parenthesized ternary, `??` to a parenthesized binary, and `switch` to a strict-equality chain over the discriminant's string form, bound once (`((_d) => _d === "loading" ? … : _default)(String(…))`).

### 19.9 Editor Evaluation Trace

The interpreter accepts an optional **trace** — a `report(path, value)` callback — so a visual editor can badge every node of an expression with its live value against real component state.

- Every node and `$ref`/nested operand reports its evaluated value, keyed by its path within the expression tree (`["value", "target"]` etc.).
- Branch-selecting operators (`?:`, `switch`) evaluate **all** branches under trace — the untaken branches' values are reported, then the semantically correct result is returned. (`&&`/`\|\|`/`??` already evaluate both operands eagerly; purity makes this observationally equivalent.)
- Aggregates report a **first-iteration sample** of their per-item expression rather than one report per element.
- Because branch-forcing removes natural exit conditions, reporting stops beyond `MAX_REPORT_DEPTH` (64); evaluation itself continues untraced.
- The trace is interpreter-only. Compiled output (§19.8) is never affected, and evaluation without a trace takes the untouched production path — including branch short-circuiting.

---

## 20. Structured Function Bodies (Statements)

### 20.1 Motivation

§19 removed the `body`-string escape hatch for single operations; multi-step side effects (mutate, branch, notify) still required opaque JavaScript. A Function entry's `body` may now be a **JSON array of statements** instead of a source string — explicit structured function declaration, analyzable by tooling and editable visually. This mirrors ESTree exactly: a function body is `Statement[]`. No new keyword, no new entry kind — the escalation ladder _within_ Shape 4 becomes structured statements → JS string.

```json
{
  "state": {
    "addToCart": {
      "$prototype": "Function",
      "parameters": ["item"],
      "emits": [{ "name": "cart-changed" }],
      "body": [
        {
          "operator": "push",
          "target": { "$ref": "#/state/cart" },
          "value": { "$ref": "$args/item" }
        },
        {
          "if": { "operator": ">", "target": { "$ref": "#/state/cart/length" }, "value": 10 },
          "then": [{ "dispatchEvent": "cart-full" }],
          "else": [{ "operator": "call", "target": { "$ref": "#/state/refreshTotals" } }]
        },
        {
          "dispatchEvent": "cart-changed",
          "detail": { "$ref": "#/state/cart" },
          "bubbles": true,
          "composed": true
        }
      ]
    }
  }
}
```

### 20.2 Statement Kinds

> **Status: Partial.** All six kinds ship in both halves (`packages/runtime/src/statements.ts`). Awaiting a thenable holds only in the interpreter's `runStatements`: `compileStatements` emits plain statements with no `await`, and the compiled handlers are synchronous arrows, so a compiled body runs its next statement before an async call settles.

Every statement kind reuses a web-platform name — §19.4's law extended to statement position:

| Kind       | Shape                                                | Source of the name                           |
| ---------- | ---------------------------------------------------- | -------------------------------------------- |
| Expression | a bare §19 expression node (mutation or `call`)      | ECMAScript ExpressionStatement               |
| Branch     | `{ if, then, else? }` — statement lists in then/else | JSON Schema 2020-12 conditional keywords     |
| Multiway   | `{ $switch, cases, default? }` — statement lists     | Element-level `$switch` (§14), ECMA switch   |
| Dispatch   | `{ dispatchEvent, detail?, bubbles?, composed? }`    | WHATWG DOM `dispatchEvent`/`CustomEventInit` |
| Stop       | `{ stopPropagation: true }`                          | WHATWG DOM `Event.stopPropagation()`         |
| Cancel     | `{ preventDefault: true }`                           | WHATWG DOM `Event.preventDefault()`          |

- The branch `if` and the `$switch` discriminant hold **pure** operands; `$switch` matches by string form, exactly like §19.4b.
- `stopPropagation` and `preventDefault` act on the handler's own event — the one the body is running for — and are no-ops in a body run without one (a parameterised callable, a lifecycle hook). Each is spelled as the member set to `true`, so the statement reads as the call it lowers to. They exist because bubbling composes badly with nesting: a click inside a menu row that owns a submenu is also a click on the row that owns it, and without `stopPropagation` both activate.
- **Result capture** composes — an assignment statement whose `value` is a `call` node — so no dedicated capture field exists.
- `dispatchEvent` dispatches from the handler's `event.currentTarget` (interpreter and client islands) or the component instance (compiled custom elements); the entry's `emits` (CEM) remains the declaration the editor autocompletes from.
- Statements execute sequentially; a statement whose value is a thenable is awaited before the next (ECMA async/await semantics).

### 20.3 Lowering

> **Status: Partial.** The interpreter and `compile-client.ts` lower both forms. The element target does not: a structured body with `parameters` always lowers to a `(s, e)` handler in `packages/compiler/src/targets/compile-element.ts`, not a positional callable, and its `$args/` refs compile to `_args.x` with no `_args` in scope.

`body: Statement[]` follows the named-formula pattern (§19.4c): without `parameters` the entry lowers to an event handler `(state, event)`; with `parameters` it lowers to a positional callable whose arguments bind to `$args/` names. The engine is `runStatements` (interpreter) + `compileStatements` (JS emitter) — one module, both halves, mirroring §19.8: `if`/`else` and `switch` emit their genuine ECMAScript statement forms, dispatch emits `dispatchEvent(new CustomEvent(type, init))`, and the two event verbs emit `event?.stopPropagation()` and `event?.preventDefault()`. Inline event bindings accept structured bodies through the existing Function binding form — `JxEventBinding` is unchanged.

---

## 21. Evaluation Surface

> **Status: Implemented.** The surface is stated accurately, which is what this section is for; a Trusted Types policy guards the shell's own injection sink; enforcement is declined (§21.5).

Jx documents contain executable code — `${}` templates and `body`/`$src` functions. Where and how that code runs differs by mode, and the security posture differs with it. This section states the surface honestly so hosts can make an informed decision.

### 21.1 Compiled Output — No Runtime Eval

The compiler produces plain HTML/CSS plus per-island ES modules. It does **not** emit `new Function` or `eval`: a `${}` template is **spliced verbatim** into an emitted module as a real template literal (`compile-client.ts`), and statements/`$expression` lower to genuine JS. A compiled static or island page therefore runs under a strict CSP with **no `'unsafe-eval'`**.

> **Status: Implemented.** No emitter in `packages/compiler/src/targets` writes `new Function` or `eval`; the compiler's own `new Function` sites in `packages/compiler/src/shared.ts` run in the build host (§21.2). A test (`packages/compiler/tests/no-eval.test.ts`) locks the client target: it compiles a template, a computed body and a handler, and asserts the emitted JS contains neither.

The corollary is a **build-time** concern, not a runtime one: because template text becomes code in the bundle, any document string that reaches a template position becomes executable at build time. A pipeline that compiles **untrusted** documents (e.g. user-submitted content merged into the tree) must sanitize or escape `${` sequences first — treat compiling a document as running it.

### 21.2 Build Host — Trusted-Input Evaluation

During a build the compiler evaluates project code (resolving `timing: "compiler"` prototypes, importing `$src` modules). This is the same trust class as running the project's own `npm`/`bun` scripts: build inputs are trusted by definition.

### 21.3 Interpreting Runtime — Requires `'unsafe-eval'`

The interpreting runtime — the dev server, the Studio canvas, and `@jxsuite/runtime` used directly as a library — compiles `${}` templates and inline `body` functions with `new Function` on the fly (§6.6). Any page hosting the interpreter must allow `'unsafe-eval'` in its CSP. This is why the compiled path exists: ship compiled output to production and the eval requirement disappears. A future restricted evaluator (§6.6) would remove this requirement from the interpreter as well.

Jx Studio's own shell is such a page: its chrome mounts documents through the interpreter ([embedding.md](./embedding.md) §8), so the shell requires `'unsafe-eval'` for as long as it does. That is a property of the shell, stated, rather than a defect of the canvas it hosts.

### 21.4 Trust Model for Documents

A Jx document is **executable input**. Loading and rendering an untrusted document in the interpreting runtime runs its code; compiling an untrusted document runs its code at build time. Jx does not sandbox document code — treat a `.json` document with the same trust you would treat a `.js` file from the same source. The desktop application asks before a folder's code first runs (`desktop.md` §4.7), which is consent and not a sandbox.

> **Status: Implemented** (as a stated property, not a sandbox). See also `@jxsuite/server` §4.2 for the dev-server network controls and `docs/framework/concepts/security.md` for the user-facing summary.

### 21.5 Two CSP Profiles, Permanently

> **Status: Implemented** as a decision. Enforcement is **declined**, not pending — see below.

There are **two** profiles here, not one profile with an outstanding TODO, and saying so is the point of this section: "remove `eval` from the runtime" has been living as an implied task, and it is not one. The interpreter **is** those `new Function` sites — an interpreter that does not compile expressions at runtime is a compiler.

| Profile                     | `'unsafe-eval'` | Why                                                                        |
| --------------------------- | --------------- | -------------------------------------------------------------------------- |
| **Compiled output**         | never           | §21.1, with a committed test asserting the emitted JS contains neither     |
| **The interpreting canvas** | permanently     | §21.3 — it evaluates `${}` templates and `body` functions as they are read |

**What Trusted Types actually gates, verified rather than assumed.** The tempting reading is that `require-trusted-types-for 'script'` covers DOM injection sinks and leaves `eval` to `script-src`. It does not: under Trusted Types, `eval()` and `new Function()` are gated as well, and throw when no default policy exists. The escape hatch is a **default policy whose `createScript` passes its input through**, which re-permits evaluation and makes the script half of Trusted Types a rubber stamp.

That settles the staging question by removing it. The shell is not a deployment target: it is the development environment, and it is powered by the interpreter it exists to drive. Enforcing Trusted Types on it would mean a default policy whose `createScript` passes its input through — which re-permits evaluation for the whole shell and buys a type-level ceremony in place of a control.

**What Jx adopts, and what it declines.** The injection-sink half is worth having on its own terms and is taken; the script half cannot apply to either profile, and is declined rather than left as an implied task.

- **No `innerHTML` write remains in code Jx ships.** The four in `@jxsuite/runtime` and the one the compiler emitted into every light-DOM element module became `replaceChildren()` — identical semantics for clearing an element, and not an injection sink. That is a real reduction in a shipped site's surface, independent of any policy. The claim is about writes Jx makes on its own account. A document that authors an `innerHTML` key is a write the author asked for: the interpreter assigns it as it assigns any property and the compiled targets emit it as markup, unsanitized in both, so a value bound from data a visitor supplied is markup that visitor wrote. `textContent` is the key for text.
- **The shell's markdown goes through a policy that asserts.** `createHTML` throws naming what it found (`packages/studio/src/services/trusted-types.ts`); `createScript` and `createScriptURL` refuse outright. A `createHTML` returning its input unchanged would satisfy the API and defend nothing.
- **Enforcement is not planned, on either profile.** The canvas evaluates permanently (§21.3). The shell evaluates too — Ajv's codegen in `jx-validate.ts`, Monaco's worker URL, and the interpreter itself running in the shell document for Library preview, render-check and component preview — and its remaining DOM sinks belong to its dependencies: Tabulator and Monaco each carry their own. None is reachable from `jx-studio`, and the only lever over them is a `trusted-types` allow-list, which admits the pass-through this section rejects. The list was one longer while Adobe Spectrum was registered — `<sp-theme>` wrote `templateElement.innerHTML` before any author had clicked anything — and that one left with the library rather than being solved, which is the only kind of progress an allow-list cannot make.

**The observation stage ran, and has been removed.** Both servers briefly sent the shell `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` and filed each `SecurityPolicyViolationEvent` as a Problem. It answered its question — every violation belongs to a dependency or to the interpreter, and no Jx-owned sink remained — so it was deleted along with the header that fed it. Keeping it would have put a permanent warning in §16's Problems panel about a decision already taken, and a panel that reports what its reader cannot act on teaches its reader to stop looking. Four properties of the standard were established during that run and are recorded here because they would otherwise have to be rediscovered:

| Established                                                                                | Consequence                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A report-only policy in `<meta>` is ignored entirely (CSP3 §3.3)                           | Report-only disposition is a response-header-only mechanism                                                                              |
| `require-trusted-types-for 'script'` reports `eval` and `new Function`, not only DOM sinks | The script half cannot apply to an interpreter                                                                                           |
| With no `trusted-types` allow-list, policy creation raises no violation                    | An allow-list is the only lever over a dependency's sink, and naming a pass-through blesses it                                           |
| An `http` child frame does not inherit its parent's policy; a `srcdoc` child does          | The two profiles are separable **because** the canvas is a real document. Moving it to `srcdoc`, `blob:` or `about:blank` would end that |

---

## 22. Jx Notation (`.jxn`)

> **Status: Implemented.** Every host reads and writes `.jxn`, and Studio opens, edits, saves and converts it (`studio.md` §8.5).

A Jx document may be written in Jx Notation, as a `.jxn` file. Jx Notation is KDL 2 with Jx's own rules for what each node means. `.jxn` and `.json` are two spellings of one data model: both parse to the same `JxDocument`, and the schema, the runtime, the compiler and Studio's document model all work on that object. `.jxn` is a native format, so no extension has to be enabled to use it. A project's configuration may be written the same way, as `project.jxn` (`site-architecture.md` §2.3). `*.class.json`, `jx-extension.json`, JSON Schemas and data files stay JSON.

### 22.1 Grammar

```kdl
/- kdl-version 2
$schema "https://jxsuite.com/schema/v1"
$id Counter

// Comments stay in the file.
my-counter {
    state {
        count 0
        label ""
        max type=number default=10 attribute=max
        (fn)reset #"""
            state.count = 0
            """#
        (fn)rename event #"""
            state.label = event.target.value
            """#
    }

    style display=inline-flex gap="6px" {
        "&:hover" color="var(--color-action)"
        #"&[data-kind="urgent"]"# backgroundColor="var(--chip-urgent-bg)"
    }

    span part=value aria-live=polite "${state.count}"
    button type=button onclick=(ref)"#/state/reset" "Reset"
    input .value="${state.label}" oninput=(ref)"#/state/rename"
    p {
        - "Hello "
        strong "world"
        - "!"
    }
    ul {
        $array items=(ref)"#/state/rows" key=(ref)"$map/item/id" {
            li (ref)"$map/item/name"
        }
    }
    slot
}
```

| Written                                       | Means                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Top-level `$x` nodes                          | Document metadata. `$head`'s rows are elements                                                                          |
| The one other top-level node                  | The root element                                                                                                        |
| Node name                                     | `tagName`                                                                                                               |
| One positional value                          | `textContent`                                                                                                           |
| `name=value`                                  | `attributes.name`                                                                                                       |
| `.name=value`, or a `.name` child             | The member `name`: a DOM property, `map`, `cases`, or a value that has no plainer form                                  |
| `on*=(ref)"pointer"`                          | Event handler. A non-ref value is refused on a real handler name, and is an attribute on any other `on*` name           |
| `(fn)on* [params] body`, `(on)on* { … }`      | Event handler in block form. Without the annotation, a node named `on…` is an element                                   |
| `$x=value`, or a `$x` child                   | Jx member                                                                                                               |
| `state`, `style`, `attributes` child nodes    | Those members                                                                                                           |
| Any other child node                          | Child element                                                                                                           |
| `- value`                                     | Text or `$ref` child, or a list item in a JSON block                                                                    |
| `(ref)"pointer"`                              | `{ "$ref": "pointer" }`, in any value position, JSON blocks included                                                    |
| `(fn)name [params] body`                      | `$prototype: "Function"`. A last string is always the body; a child block of `-` items is a structured body (§20)       |
| `(export)name [$x=value]`                     | A Function the document's client module exports (§23.2): `$prototype: "Function"`, `$src: "#client"`, `$export: name`   |
| `(server)name [k=v…]`                         | A function of the document's server module (§23.2): `timing: "server"`, `$src: "#server"`, `$export: name`, `arguments` |
| `script "module"`, in the root element        | `$script.client`, the document's client module (§23.2)                                                                  |
| `script timing=server "module"`               | `$script.server`, its server module                                                                                     |
| `$array items= key= [filter=] [sort=] { el }` | `$prototype: "Array"`, with `el` as `map`                                                                               |
| `$element [tag] [text]`                       | Escape for a tagless node, or a reserved tag: `state`, `style`, `attributes`, `script`, `project`, `-`, or one with `$` |
| `(object)name`, `(array)name`                 | A JSON block that is an object or a list, where its contents would not say which                                        |
| Everything else                               | A JSON block: JSON-in-KDL plus `(ref)`, `(fn)`, `(export)` and `(server)`                                               |

Some forms follow from that table and are worth stating:

- A lone `$array` child is a list of one, which is the common case. When the whole of `children` is one mapped array or one `$switch`, the object form is spelled `.children { $array … }`.
- A top-level `project` is reserved, and `script` is the document's module, so `$element "project"` and `$element "script"` are those tags as elements. A `script` node is read in the root element only: anywhere deeper it is refused, naming `$element "script"`, and a `<script>` row of `$head` is an element as every row there is.
- A `script` node holds one string and at most `timing=server`. A document has one of each at most, and a second, or a `$script` written beside one, is a key written twice (§22.2). A `$script` that holds anything but those two strings, and one on a document with no root element, is written as the plain `$script` block.
- `(export)name` exports under the node's name unless `$export` names another, and takes no body: a Function with `parameters` or a `body` is a `(fn)` row whatever its `$src`. `(server)name` exports under the node's name and its named values are the whole of `arguments`, so an entry whose export differs from its name, or that holds any other member, an empty `arguments`, or an argument that is itself a block, is a plain JSON block. None of this changes what a document is: each row reads to the entry the table names, and the writer uses a row only where the row reads back to the same entry.
- Inside `.map` and each value of `.cases`, the element grammar applies, and each holds exactly one element.
- A `style` value may be a list, which is what `@font-face` needs. A style key that needs quoting has to be quoted: `> li` is a node `>` with the value `li`, and the reader refuses it rather than misreading it.
- `div {}` equals `div`. `state {}` is `{}`. Empty `children` is `(array).children`. Parameters without a body have no sugar and use a JSON block.

### 22.2 What a reader refuses

A `.jxn` file reads to the object its `.json` spelling reads to, or it does not read. An error carries a line and column where the file has one. These are refused because they would otherwise lose or change data silently:

- **A key written twice, after NFC.** This covers `div a=1 a=2`, which KDL allows with the rightmost winning, and `div a=1 { attributes { a 2 } }`, two `style` blocks, and `$id A` with `div $id=B`.
- **A `__proto__` key,** which would not be data.
- **What JSON cannot hold:** `#inf`, `#nan`, a number that overflows, and an integer outside the safe range.
- **An annotation the grammar does not define,** and `(ref)` on anything but a string.
- **A raw control character,** other than the whitespace KDL treats as such.
- **More than one positional value** on an element, and **more than one root.**
- **A non-ref value on a real event-handler name.** `button onclick="state.x++"` would otherwise reach the prerender as a live inline handler with no `state` in scope. `attributes { onclick "…" }` is the explicit escape. Any other `on*` name with a non-ref value is an attribute, so `once="x"` stays one.
- **A file whose first node is `project`,** which is a project file. `classifyJxn` answers `project`, `document` or `unreadable` from a lexical prescan of the first node that is not `$` metadata, and it tolerates syntax errors after that node, so a broken file still has an identity.

### 22.3 What a writer guarantees

`parseJxn(serializeJxn(doc))` deep-equals `doc` for every valid document, and source order within `style`, nested blocks included, is unchanged. Order is significant nowhere else, so the writer is free to hoist leading scalars.

A string is written raw when it holds a backslash and read back before it is kept: a whitespace-only line, CRLF, U+2028, a control character or a bidirectional control can change or fail to parse in a raw multi-line string, and a string that does not survive falls back to an escaped one. A lone surrogate has no KDL spelling, so the writer refuses the document and names the pointer.

KDL's `\s` is a space and its `\b` a backspace, so `span "${state.x.replace(/\s+/g, '')}"` reads cleanly as `/ +/g`. Hosts report `lintJxn`'s warning for `\s` or `\b` in any non-raw string. The parsed value has lost the evidence, so the warning reads the source text.

### 22.4 Saving

`serializeJxn(document, previous)` keeps what did not change. It merges the previous file with the writer's canonical text as KDL trees, so a node that means the same in both keeps its exact text, comments and blank lines included. The tests hold this property over every tracked document: a single `doc-ops` operation changes only the lines of the node it touched.

- **What a node continues.** Children are matched by a longest common subsequence over nodes that did not change, then by name and declared `$id` or `key` in the gaps. A node with an exact twin elsewhere has moved, and takes its comments with it.
- **What a comment belongs to.** A comment before a node goes with that node, so deleting the node deletes it. What follows an opening brace on its line belongs to the brace.
- **Spelling.** The writer folds `state { count 0 }` into `state count=0` where it can. A key the author kept in a block stays there, because the two have one JSON Pointer.
- **The guarantee.** A merged file that does not read back to the writer's meaning, with `style` order compared, is discarded for the writer's text. A merge can cost comments and never data. The merge knows no Jx rule and takes its reader as a parameter, so a project file can use it (`site-architecture.md` §2.3).

The rename refactor and Studio's save both pass the previous file, so repairing a reference in a `.jxn` file changes that reference and nothing else.

### 22.5 Project files

A project file (`site-architecture.md` §2.3) is this grammar with a different top level. There is no root element, and every node is a member of the configuration:

```kdl
/- kdl-version 2
$schema "./project.schema.json"
project "Bistro & Café"

// The base layout every page inherits unless it names another.
defaults layout="./layouts/base.json" lang=en

extensions "@jxsuite/parser" "@jxsuite/connector"

$media {
    --md "(max-width: 768px)"
}

style {
    --color-primary "#9a2f1a"
}
```

| Written                                     | Means                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `project [name]`                            | The file's kind, and `name`. Required, once, first after `$` metadata. |
| Top-level `$x` nodes                        | Those members, as in §22.1, before or after `project`                  |
| `$head { … }`                               | Element rows, as in §22.1. `- (ref)"…"` is a `$ref` entry              |
| `style`, `$media`                           | Style rows, as in §22.1, with source order significant                 |
| `key value`                                 | A scalar member                                                        |
| `key a b c`, `key { - a }`, `(array)key`    | A list of many, of one, and empty                                      |
| `key a=1 b=2`, `key { a 1; b 2 }`, `key {}` | An object. Both forms are the same data                                |

Everything else is §22.1's JSON block, so `(ref)`, the refusals of §22.2 and the guarantees of §22.3 apply unchanged, and `project` written twice or holding anything but one value is refused. The canonical form favours reading: short `$` metadata, then `project`, then one section per member with a blank line between them; `$media` and `style` take one declaration per line; and a list of one is always `key { - a }`, never a bare value, because `extensions "@jxsuite/parser"` reads as a string. A save goes through §22.4's merge with this grammar as its reader, so a setting changed in Studio changes its own line and keeps every comment.

---

## 23. TypeScript in Documents

Code in a document is TypeScript, whichever format holds the document. This section states what that means for a function body, for a document's own modules, and for reporting type errors.

### 23.1 Function Bodies

> **Status: Implemented.** `jx build`, `jx validate`, the server's class resolution, the interpreter, Studio's canvas and Live Preview erase types (`packages/erase`, `packages/compiler/src/erased.ts`, `packages/runtime/src/body-eraser.ts`), and Studio's code editor edits a body as TypeScript (`packages/studio/src/panels/editors.ts`, `packages/server/src/code-api.ts`).

A string `body` in any document format is TypeScript, limited to syntax that can be erased without emitting code. Types are removed before anything analyses or runs the body, so each tier only ever sees JavaScript. A `${}` template stays a JavaScript expression. A structured body (§20) has no text to erase and is unaffected.

**Erased once, as a document is read.** A host erases every function entry's string body: a `$prototype: "Function"` entry, or a class member, which a `.class.json` names by its `role` (or array of lines, as a class member may hold) wherever it sits, including an accessor's `getter` and `setter`, and leaves every other `body` alone, because a `Request`'s body is a payload. Types become spaces, so a line and column in a stack trace match the body as written, and erasing twice changes nothing. The stored document keeps the authored text; only the copy that runs is erased.

**What cannot be erased is an error.** `enum`, a value `namespace`, a parameter property, and a module `import` or `export` need code generated for them, so a body using one stops the build, named by its file, its JSON Pointer and its line and column. A body that needs imports belongs in a module of its own (§23.2).

**In the browser, the host hands the runtime its eraser.** The runtime compiles every body through one seam and carries no stripper. A host installs one with `setBodyEraser(eraseBody)`, `eraseBody` from `@jxsuite/erase/browser`, or names how to fetch it with `setBodyEraserLoader`; the runtime then fetches it only when a document or class it resolves has a body that does not compile as JavaScript or holds a generic call, before anything in it compiles. Studio's canvas sets the loader too, and waits for it before rendering a document that needs it; a live edit that brings in the first typed body fails to compile, and the host answers with that full render. Live Preview's shell sets the loader, so a site with no typed body downloads nothing more. With no eraser, a body compiles as written, `a < b > (c)` keeps its JavaScript meaning, and a typed body fails with an error naming the body and the call that fixes it.

**Edited as written.** Studio opens a body in a TypeScript editor, formats it as TypeScript and lints it as TypeScript, and stores what the author wrote: nothing minifies a body on its way back into the document, because minifying deletes types. Nothing reports type errors yet.

**One change of meaning.** `a < b > (c)` is a generic call in TypeScript and two comparisons in JavaScript. A body that was already JavaScript and reads differently as TypeScript is built as TypeScript, and `jx build` and `jx validate` warn with its place.

**Analysis reads code, not comments.** Whether a body returns a value, and which state entries it writes, is read from the body with its comments and string contents blanked (`maskCode`), so `// return early` does not make a handler a computed. Every target ends a spliced body with a newline, so a last-line comment cannot swallow the brace that closes it, and rewrites only a standalone `state`, so `prevstate.n` stays itself.

### 23.2 Document Scripts

> **Status: Implemented.** `jx build` bundles each document's client module, serves its server module from the site worker, and resolves an import of a `.jxn` document (compiler.md §12, §6.3), and `@jxsuite/compiler/bun-plugin` lets a Bun test import one. Every interpreting host imports a document's client module in the browser (embedding.md §6.3), `jx dev` and the `/__jx_server__` proxy answer its server module (server.md §3.3), and Live Preview sends a reader no server module (server.md §3.4). `.jxn` writes a script as a `script` node and its entries as `(export)` and `(server)` rows (§22.1). Studio edits a script on its code surface and draws a document with one on the canvas (studio.md §4.1, §16.7), `jx validate` and Studio give the advice below (`findScriptAdvice` in `packages/schema/src/document-scripts.ts`), and a shared session merges two authors' edits to one script (collab.md §3.1).

A document may carry its own client and server modules, so a component does not need a separate file for its own code. `$src` keeps working, and stays the only spelling for `npm:` packages and for modules shared between documents.

**`$script` holds the text.** At a document's root, `$script` is an object with up to two members, `client` and `server`, each the TypeScript source of one ECMAScript module. It is a reserved key (§17): never an element property and never a `$`-local binding.

```json
{
  "tagName": "my-counter",
  "$script": {
    "client": "import { clamp } from \"./math.ts\";\n\nexport function bump(state: State): void {\n  state.count = clamp(state.count + 1, 0, 10);\n}\n",
    "server": "export async function history(args: { limit: number }, env: Env) {\n  return env.DB.prepare(\"SELECT * FROM counts LIMIT ?\").bind(args.limit).all();\n}\n"
  },
  "state": {
    "count": 0,
    "bump": { "$prototype": "Function", "$src": "#client", "$export": "bump" },
    "history": {
      "$src": "#server",
      "$export": "history",
      "timing": "server",
      "arguments": { "limit": 20 }
    }
  },
  "children": [{ "tagName": "button", "onclick": { "$ref": "#/state/bump" }, "textContent": "Add" }]
}
```

**An entry names its own document's module.** `$src: "#client"` on a `$prototype: "Function"` entry is an external Function (§5.3 4c) whose module is `$script.client`; `$src: "#server"` on a `timing: "server"` entry is a server function (§11.4) whose module is `$script.server`. Nothing else about either entry changes: the calling convention is §5.3 4d's, a server export takes `(args, env)`, and `$lazy` means what it means for any module. A client Function naming `#server` is an error, because a server module is called and never imported by a page. Only a document has a script. `project.json` has none, so `#client` or `#server` in its `state` is an error naming the entry.

**Qualified as the document is read.** `#client` says nothing about which document, and a page is merged with its layout and with the project's state before anything runs. So a host rewrites the two authored forms once, as it reads a document and before any merge, to `jx-script:<address>#client` and `jx-script:<address>#server`. The address is how the reader knew the document: its project-relative path with `/` separators when a build, or a host composing a page, read it from the project, and its absolute URL when the runtime fetched it. After that a page's module and its layout's are different specifiers, and module caching, bundling and the worker's one function per export name apply to them as to any two modules. The qualified form is never authored and never saved: the document on disk keeps `#client`. Qualifying an already qualified document changes nothing.

**A document handed over as an object stands at its base.** A document given to `mount()` or `buildScope()` as an object was read from nowhere, so the runtime addresses it at its base URL with a fragment no other document on the page has (`<base>#jx-inline-<n>`): two such documents are two modules, and one mounted twice is one. Its client module is the text it carries and its relative imports resolve from the base. No host can find its server module, because there is no file to read one from, so the proxy refuses the call and the entry stays `null` (§11.4).

**A module stands where its document stands.** A relative import in a script resolves from the document's directory, as it would from a file beside the document, and a script may import `.ts`. Importing a `.jxn` document (`import { clamp } from "../lib/shared.jxn"`) imports that document's client module. A document's server module is imported by nothing: an import that reaches one from code a browser runs fails the build.

**An interpreting host imports the module in the browser.** No host route serves a script. The runtime hands a client specifier, and a `$src` naming a `.ts` file it can fetch, to a module loader the host installs, or lets the runtime fetch with the eraser of §23.1 when a document first needs it (embedding.md §6.3). The loader takes the module's text, which is the document's own script where the runtime already read that document and is otherwise fetched from the document's address, erases its types, and imports what is left. Each relative import of a `.ts` file, and of a `.jxn` document's client module, is loaded the same way from the importing module's address, once however many modules import it. A page given no loader stops with an error naming the document and the call that installs one. A document read again with its script edited is a new module, so an editing host that re-reads a document runs what it now says.

**Two things a bundle can do and the loader cannot.** Each is an error naming the modules, and neither binds `jx build`. Modules that import each other in a cycle cannot load, because each is imported from a URL made of its finished text. A package import needs the host to say where packages are served (`setNpmModuleResolver`, §5.3 4c), and a host with nothing to serve one from has no answer.

**A script holds only types that can be removed.** The loader erases and never compiles, so a script is held to §23.1's rule for a body in every tier, with `import` and `export` allowed because a script is a module. `jx build` refuses `enum`, a value `namespace` and a parameter property in a client script and in a server script alike, naming the document, `/$script/client` or `/$script/server`, and the line and column, so a script that builds is one an interpreting host runs. A name imported only for its type is written `import type`, or with `type` on the name: an erased module keeps every other import as written, and the module it names is then asked for an export it does not have.

**One module for each side of a document.** Every entry naming `#client` in one document shares one module, evaluated once on a page however many entries name it and however many instances of the component there are. An entry with `$lazy` shares it too, so it defers nothing when another entry of the same document loads eagerly; a function worth loading late belongs in a `$src` module of its own.

**A body is not inside the module.** A string `body` (§23.1) sees `state` and its declared parameters and none of the names a script declares. A body reaches a script's function through the state entry that exports it, as `state.clamp(…)`.

**Server names are site-wide.** A document's server exports are served under their export names with every other server function of the site (§11.4), so two documents exporting one server name fail the build, naming both.

**A host that edits a document draws its script as saved.** A host drawing a document while it is being edited composes a page from documents it holds as objects, so it qualifies each with the URL the document would be fetched from, before any merge, and a page and its layout stay two modules there as in a build. It hands its renderer no `$script`: a client module's text travels beside the document under the specifier that names it, and a server module's text goes nowhere, because a server function is called over the network and answered from the saved file. The client text it uses for the document being edited is the text that document was last saved with. A string `body` is one expression of an entry and may be drawn as it is typed; a module that is half typed does not load, and one loaded again on every pause would run its top level each time.

**Tools advise, and advice is never a defect.** Two things about a document that is right as written are worth saying to its author, and `findScriptAdvice` (`@jxsuite/schema/document-scripts`) is the one statement of both. `relative-src`: an entry whose `$src` is a relative path (`./` or `../`) to a script file names a module the document could carry itself. A class schema (`.json`), an `npm:` specifier, a kit module (`jx-ui:`) and an entry with `$lazy` are not advised, the last because a lazy entry is better off outside a shared script. `lazy-shares-script`: an entry with `$lazy` names the document's client module while another entry of the same document names it without, so the module loads with the page and `$lazy` defers nothing. `jx validate` reports each as `module/<rule>` at severity `info`, and no option, `--strict` included, makes advice fail a tree; Studio files each in Problems when the document is saved (studio.md §16.6).

**Two authors in one script both keep their edits.** A shared session stores each side of `$script` as its own text and merges it per character (collab.md §3.1).

### 23.3 Type Checking

> **Status: Partial.** Studio's function editor reports type errors in a body (`studio.md` §16.7), and `tsc` and a TypeScript language server report them in a `.jxn` document's bodies, scripts, templates, references and the props it gives a component through `@jxsuite/content-mapper`. Not yet: Studio checks no script, which it edits on the same surface (§23.2), no template and no reference, and marks nothing in a `.jxn` file's Code view; nothing outside Studio checks a `.json` document; the mapper reads no class method and no `$defs` but the document's own, and holds a prop against a component only where that component is a `.jxn` document; no editor extension registers the mapper; and no scaffolded project is set up to run it.

Type errors in a document's bodies, modules, templates and references are reported at their real positions, in the terminal and in an editor, and a scaffolded project is set up to report them.

A body is checked as the function it is the inside of, with `State` declared from its document's `state` and the names the runtime binds as its parameters. `@jxsuite/schema/virtual-types` writes that file and maps a position in it back to the body, with no dependency on a compiler, so every surface that checks types reads the same file. What `State` says is what the document proves: `state.nope` is an error, a value the document does not determine is `any`.

**A whole document.** `@jxsuite/schema/virtual-document` writes the TypeScript a checker reads for a `.jxn` file from its text, as modules, and says for each stretch of them where in the file it was written. It is as free of a compiler as the body's file is, and declares `State` by the same rules.

- **The main module** is the document's client script, line for line, followed by an exported `State`. An `(export)` entry has the type of the export it names, so an entry naming no export is an error at the entry, and a `.ts` module that imports the document reads its exports and its `State`. An entry written under its export's own name alone is one word for two names, so `State` takes that member from the module itself: the entry and the export are one name to an editor, a rename started at the function, at the entry or at any place that reads it rewrites all of them, and the definition of the entry is the function. An entry naming no export is still one error at the entry, and is `any` where it is read. It ends with an exported `$elements`, which says what the document defines: its `State` under its root's tag where that tag is a custom element's name (§16.1), and nothing otherwise.
- **The server module** is the server script, followed by what it adds to `State`: each `(server)` entry is what its function resolves to, or `null` before it has answered. The server module cannot name itself as the main module can, so a `(server)` entry under its function's own name is joined to both names at its one word: a rename started there is whole, one started at the function leaves the places that read the entry, and one started at such a place leaves the function.
- **One module for each body**, which imports `State` and nothing else. A body therefore cannot name what a script declares and does not export (§23.2), and one that does is an error at the name. A body inside an element with `state` of its own reads that scope's `State`, which extends the one around it. Where the element declares a name the state around it also has, its `State` extends that one less the name: the element's entry is a member of its own, typed as the element declares it, and every other member is still the one the scope around it declares, so a rename started in either scope rewrites both and leaves the other entry of that name alone. The main module declares an interface for each such scope beside the document's, so an entry of an inner scope is joined to its place as the document's are, and a rename reaches it. Those interfaces are numbered in the order the document writes them (`State$1`, `State$2`), which is what a hover shows and is no part of the contract: adding a scope above one renumbers it, and a module that imports the document names its `State` and never an inner one.
- **One module for each template** (§6), which is JavaScript and is checked as JavaScript: the string is the template literal it runs as, returned from a function whose parameters are the names the runtime binds (§6.6), `state` being the `State` of the scope the string stands in and `item` and `index` those of its row. A template is read where the runtime reads one: a string an element holds as a property, an attribute, a style value, a prop it passes or its text, and a string a `state` entry is or configures a prototype with. A `${` in any other string is data. TypeScript syntax in a template is an error, since nothing erases it there.
- **One module for every reference** (§7) into `state` or into a row, each written as the path it names read off the `State` of the scope it stands in: `#/state/user/name` reads `user`, then `name`. The first name must be declared, as `state.nope` must in a body. Each name after it is read as optional, because a token that matches nothing yields `undefined` (§7.1) and a reference through a value that is `null` at first is no mistake, and it is still an error where the value before it has no such member. A reference written on an `on*` member of an element that names one state entry is checked as the handler it binds (§4.3): the entry must be a function that takes the event of that binding on that element. A reference that names anything else (a file, or another scheme of §7.2) is not read here, and one into `$defs` is read where it declares a type, as below.
- **What a document gives a component** (§13) is written in that same module, one prop to a line: the prop under its name, held against the `State` of the document that defines the instance's tag, every entry of it optional. A name the component does not declare is an error at the name, and so is a value its entry cannot hold. A reference is the type of the path it names, and a string, a number or a boolean is itself. Anything else (a template, a list, an object, `null`, a reference this module does not read) is held against no type, and its name is still checked. A prop may always be `null` or `undefined`, because a reference that finds nothing passes nothing (§7.1). The name is joined to the component's entry, so renaming either rewrites both files, and the definition of a prop is the entry. The documents read for a tag are the document itself, each `.jxn` file its `$elements` names by a relative path (§16.3), and each component its project keeps (`imports.md` §1.4), which only a reader that knows the project can name. A file `$elements` names that is not there is an error at the entry that names it, and until it is there no prop of the document is held against anything. A tag none of them defines takes any prop, and so does a document whose `State` is open. A package, a `.json` document and a member written on the instance outside `$props` are not read, and a private entry (§5.6) is not refused here, though the runtime refuses it.

A name or a line the author wrote is joined to its place in the file: the name of a state entry, the name an entry exports, a parameter, each line of a script, each line of a body, each stretch of a template, each name in a reference's path, the name of a prop and a value it is given in place, the name of a definition, of a property a schema declares and the one a reference to a definition ends in, and the path `$elements` names a document by. Where the file spells text differently from the code it stands for (an escape in a quoted string, a quoted name) the stretch is joined as a whole. So an error is reported at the line and column the author wrote it, counted in UTF-16 code units as TypeScript counts, whatever the file's line endings, indentation and string form, and a rename rewrites the file. A file that is not Jx Notation is one error at the place it stops being one, and a project file (§22.5) is a module that defines nothing.

`State` is closed where the document can prove it is alone: reading a key it does not declare is an error, except a key beginning `$`, which the runtime supplies. It is open, an undeclared key being `any`, where state reaches the document from outside it: a page of a project that has `state` of its own, or a document a layout wraps, by the project's default or by its own `$layout`. A component is a scope of its own and is always closed. Only a reader that knows the document's project can say which, and a reader that does not treats the document as alone.

**The types a document declares.** A typed entry (§5.3) is the type its schema says, and the document's `$defs` (§5.2) are the types its schemas name. An entry's schema is its `type` where that is an object, and the entry itself otherwise, so `type` beside `enum` is one schema. Each keyword says what JSON Schema has it say and no more:

- `string`, `number`, `integer`, `boolean` and `null` are the types of those values, and a list of them is any one of them.
- `enum` and `const` are their values, where each is a string, a number, a boolean or `null`.
- `array` is a list of what `items` says, and of anything where `items` is not one schema.
- `object` names each of its `properties`, optional unless `required` names it. One that names none holds what `additionalProperties` says under any key. One that names some holds anything under another key only where `additionalProperties` is `true` or a schema: left unsaid it adds nothing, so that reading a property the schema does not name is an error, which a misspelling is.
- `anyOf` and `oneOf` are any one of their members, and `allOf` is all of them.
- `$ref` is the definition it names, and is read before anything written beside it.

A schema that names no type constrains nothing, as JSON Schema has it, and is `any`: `properties` alone makes no object. So is a keyword not listed here, and a keyword that validates a value (`minimum`, `pattern`, `format`) says nothing of its type. Where the type says nothing of what the value holds (no type at all, `array` with no `items`, `object` with no `properties`) and the entry's `default` is not `null`, the entry is the type of that value, as a naked value's is. Anywhere else the declared type stands, whatever the `default`.

`$defs` is written in the main module as an exported namespace of that name, each definition a type under its own, and `#/$defs/TodoItem` is `$defs.TodoItem`. An error therefore names a definition as the document does, and a module that imports the document can name its types. Renaming a definition rewrites every reference to it, the definition of a reference is the entry in `$defs`, and renaming a property of a schema rewrites the code that reads it. A reference to a definition the document does not hold is an error at the name. A definition whose name is not an identifier is not written, and a reference to one is `any`, as is a reference to another file, to a member inside a definition, and every reference in a document with no `$defs`. `required` holds strings and is joined to nothing, so renaming a property leaves it for the author. The file a body is checked in alone declares the same namespace before `State`.

**The event a handler is given** is the one its binding names, on the element it is bound to: `onkeydown` on a `button` is a `KeyboardEvent` whose `currentTarget` is an `HTMLButtonElement`. Both are read from the platform's own maps of events and of elements (the SVG elements' inside `svg`, and HTML's again inside a `foreignObject`), so an event or an element the platform does not name is `any`, as is every event in a project whose `lib` has no DOM. `target` is the element as well where the event can only have started on it: the element holds no element and no `innerHTML`, or the event does not bubble, or the element is a `select` reporting a choice. Anywhere else `target` stays the platform's `EventTarget | null`, because a child could have raised the event, and reading `event.target.value` there is the error TypeScript makes of it. The type is the same whether the body names the event as a parameter or reads the `event` the runtime leaves in scope.

A state function that elements bind by `$ref` is given the events of its bindings, as a union when they differ. One whose name appears anywhere else in the document (a body, a template, another `$ref`) is given `any`, since a function called by name is called with whatever its caller passes. A name is looked for as a whole word in every string the document holds, so a false match costs a type and never raises an error.

**A row.** A body drawn by a mapped array reads its row as `state.$map` (§10.2). `item` is typed where the document proves what the array maps (a list written in place, a state entry, or a member of the row of the map around it) and is `any` where it does not, and `index` is a number. So `state.$map.item.nope` is an error at its place. A scope that declares `$map` of its own keeps its own.

**In the terminal and in an editor.** TypeScript reads a `.jxn` file through a content mapper, `@jxsuite/content-mapper`, which a `tsconfig` names for the extension:

```json
{
  "compilerOptions": { "allowArbitraryExtensions": true, "noEmit": true, "strict": true },
  "contentMappers": [{ "extensions": [".jxn"], "package": "@jxsuite/content-mapper" }],
  "include": ["**/*.jxn"]
}
```

The mapper answers each file with the modules above and reads the file's project for what it gives the document: the nearest project file at or above the document, looking no higher than the `tsconfig`'s folder, and the `.jxn` components that project keeps, each named for its tag. Opening a `tsconfig`, it looks for a project file in that folder and in every folder under it, entering neither `node_modules` nor a folder whose name begins with a dot and following no link. It asks for both names a project file can take to be watched, beside the `tsconfig` and in each folder that holds one, and gives as the configuration's identity what each project found gives its documents. So an editor that reports a change to one of those files has the project's documents read again when what the project gives has changed, and not when the file was only saved. Its own errors carry the source `jx`: `jx1` is a file that is not Jx Notation, and a run that reports one reports nothing else, as with any syntax error.

A mapper is a program the compiler starts, so it starts none unless told it may: `tsc` requires `--runExternalCode` and reports `TS18068` without it, and a language server requires the same permission from its editor and says nothing about a `.jxn` file until it has it. **The permission is not given to one mapper.** It lets the compiler start every mapper the `tsconfig` names that has a file to read. A project therefore names this mapper in a `tsconfig` of its own, `tsconfig.jxn.json`, which names no other, and gives the flag to that run alone:

```sh
tsc -p tsconfig.jxn.json --runExternalCode
```

The file is separate for a second reason: a tool that reads `tsconfig.json` and does not know `contentMappers` refuses the whole file.

---

## Appendix A — Minimal Complete Example

```json
{
  "$schema": "https://jxsuite.com/schema/v1",
  "$id": "TodoApp",

  "$defs": {
    "TodoItem": {
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
    "items": {
      "type": { "type": "array", "items": { "$ref": "#/$defs/TodoItem" } },
      "default": [{ "id": 1, "text": "Learn Jx", "done": false }]
    },
    "remaining": "${state.items.filter(i => !i.done).length}",
    "total": "${state.items.length}",
    "summary": "${state.remaining} of ${state.total} remaining",
    "addItem": {
      "$prototype": "Function",
      "body": "state.items.push({ id: Date.now(), text: 'New item', done: false })"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "const item = state.items.find(i => i.id === id); if (item) item.done = !item.done"
    },
    "clearDone": {
      "$prototype": "Function",
      "body": "state.items.splice(0, state.items.length, ...state.items.filter(i => !i.done))"
    }
  },

  "tagName": "todo-app",
  "style": {
    "fontFamily": "system-ui",
    "maxWidth": "480px",
    "margin": "2rem auto"
  },

  "children": [
    { "tagName": "h1", "textContent": "${state.summary}" },
    {
      "tagName": "div",
      "style": { "display": "flex", "gap": "0.5rem", "marginBottom": "1rem" },
      "children": [
        {
          "tagName": "button",
          "textContent": "Add item",
          "onclick": { "$ref": "#/state/addItem" }
        },
        {
          "tagName": "button",
          "textContent": "Clear done",
          "onclick": { "$ref": "#/state/clearDone" }
        }
      ]
    },
    {
      "tagName": "ul",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/state/items" },
        "map": {
          "tagName": "li",
          "style": {
            "textDecoration": "${$map.item.done ? 'line-through' : 'none'}",
            "opacity": "${$map.item.done ? '0.5' : '1'}"
          },
          "textContent": "${$map.item.text}",
          "onclick": { "$ref": "#/state/toggleItem" }
        }
      }
    }
  ]
}
```

---

## Appendix B — Dependency Stack

| Package           | Version | Purpose                                                |
| ----------------- | ------- | ------------------------------------------------------ |
| `@vue/reactivity` | `^3.5`  | Reactive primitives (`reactive`, `computed`, `effect`) |

---

## Appendix C — Cart Example (Declarative Handlers)

This rewrites the mutating handlers of Appendix A's idiom using `$expression`, leaving only genuinely complex logic as `body`.

```json
{
  "$schema": "https://jxsuite.com/schema/v1",
  "$id": "Cart",

  "$defs": {
    "CartLine": {
      "type": "object",
      "properties": {
        "id": { "type": "integer" },
        "name": { "type": "string" },
        "price": { "type": "number", "minimum": 0 },
        "qty": { "type": "integer", "minimum": 1 }
      },
      "required": ["id", "name", "price", "qty"]
    }
  },

  "state": {
    "cart": {
      "type": { "type": "array", "items": { "$ref": "#/$defs/CartLine" } },
      "default": []
    },
    "draftName": "",
    "count": "${state.cart.length}",

    "total": {
      "$expression": {
        "operator": "reduce",
        "target": { "$ref": "#/state/cart" },
        "initial": 0,
        "value": {
          "operator": "+",
          "target": { "$ref": "$reduce/acc" },
          "value": {
            "operator": "*",
            "target": { "$ref": "$map/item/price" },
            "value": { "$ref": "$map/item/qty" }
          }
        }
      }
    },

    "setDraft": {
      "$expression": {
        "operator": "=",
        "target": { "$ref": "#/state/draftName" },
        "value": { "$ref": "event#/target/value" }
      }
    },

    "clearCart": {
      "$expression": {
        "operator": "splice",
        "target": { "$ref": "#/state/cart" },
        "value": [0, { "$ref": "#/state/count" }]
      }
    }
  },

  "tagName": "shopping-cart",

  "children": [
    {
      "tagName": "h2",
      "textContent": "${state.count} items — $${state.total}"
    },
    {
      "tagName": "input",
      "attributes": { "placeholder": "Item name" },
      "oninput": { "$ref": "#/state/setDraft" }
    },
    {
      "tagName": "button",
      "textContent": "Clear",
      "onclick": { "$ref": "#/state/clearCart" }
    },
    {
      "tagName": "ul",
      "children": {
        "$prototype": "Array",
        "items": { "$ref": "#/state/cart" },
        "map": {
          "tagName": "li",
          "children": [
            "${$map.item.name} ×${$map.item.qty} ",
            {
              "tagName": "button",
              "textContent": "+",
              "onclick": {
                "$expression": {
                  "operator": "+=",
                  "target": { "$ref": "$map/item/qty" },
                  "value": 1
                }
              }
            },
            {
              "tagName": "button",
              "textContent": "remove",
              "onclick": {
                "$expression": {
                  "operator": "splice",
                  "target": { "$ref": "#/state/cart" },
                  "value": [{ "$ref": "$map/index" }, 1]
                }
              }
            }
          ]
        }
      }
    }
  ]
}
```

## Changelog

- **0.9.9-draft** (2026-11-11) — §4.2 and §5.3 4d: every tier builds a string body with state first and its other declared names after it, binding by position, and calls a $src export with (state, event) from an event binding whatever it declares.
- **0.9.8-draft** (2026-11-11) — §5.3 4d: declaring both body and $src is refused in every tier and by the schema, for state entries and inline handlers alike.
- **0.9.7-draft** (2026-11-11) — §23.3: a body is checked as the function it is the inside of, with State declared from its document, and Studio reports the errors; Partial until the terminal and other editors do.
- **0.9.6-draft** (2026-11-11) — §5.3 4b and 4d: every tier classifies Function entries through one shared classifier; a Function that declares parameters is never a computed, an external Function's role follows its declaration and the document's use rather than the imported function's arity, and a definition's root-level handlers count as a callable use.
- **0.9.5-draft** (2026-11-11) — §23.1: Studio's code editor edits a function body as TypeScript and stores it as written; the section is Implemented.
- **0.9.4-draft** (2026-11-11) — §23.1: the interpreter, Studio's canvas and Live Preview erase TypeScript function bodies through a runtime seam, and a class member named by its role is a function entry.
- **0.9.3-draft** (2026-11-08) — §23.1: jx build, jx validate and the server erase TypeScript from function bodies as each document is read; analysis reads code without comments; spliced bodies end with a newline.
- **0.9.2-draft** (2026-11-08) — Project files have a grammar: §22.5 reads and writes a project.jxn, with the project node, style rows and a comment-keeping save.
- **0.9.1-draft** (2026-11-07) — §22 is Implemented. §22.4: saving a .jxn file keeps what did not change, and a merge can cost comments and never data.
- **0.9.0-draft** (2026-11-07) — §2.3: the JSON data model is authoritative, and .json and .jxn are two spellings of it. §22: every host reads .jxn.
- **0.8.7-draft** (2026-11-07) — §22: the Jx Notation grammar, what a reader refuses and what a writer guarantees, read and written by @jxsuite/schema/jxn. No host dispatches to it yet.
- **0.8.6-draft** (2026-11-07) — Name the desktop prompt in the trust model for documents.
- **0.8.5-draft** (2026-11-06) — Say that a project's configuration may be written as project.jxn.
- **0.8.4-draft** (2026-11-06) — Name the format Jx Notation, with the extension .jxn.
- **0.8.3-draft** (2026-11-06) — §8.4: the interpreter evaluates a computed-children template and redraws when its value changes, a repeater row can read its item's $children, and Markdown holds the template as a directive attribute.
- **0.8.2-draft** (2026-11-06) — §6.1: a throwing template's console warning waits for lookups in flight, so a read that only came too early is never reported.
- **0.8.1-draft** (2026-11-06) — Reserve sections for the .jxn document format and for TypeScript in documents, both pending.
- **0.8.0-draft** (2026-10-27) — §5.3 and §11.4: a server-timed entry is served only by the site worker and so requires build.adapter; the per-page handler is gone.
- **0.7.9-draft** (2026-10-27) — §11.4: a built page calls its server entries over HTTP at the site worker route, and jx dev on a site project answers the same route.
- **0.7.8-draft** (2026-10-27) — §11.4: the site worker collects server entries from pages, their layouts and project.json state as well as components, and two modules exporting one name fail the build; the no-adapter per-page handler and interpreting hosts resolving a layout or project.json $src against the page remain open.
- **0.7.7-draft** (2026-10-27) — §9.2: a nested key with an & after a context (.wrap &) substitutes the scope for the & instead of compounding onto it.
- **0.7.6-draft** (2026-10-21) — The binding-bounce example names the build adapter picker, since the branch picker it cited was removed.
- **0.7.5-draft** (2026-10-21) — §16.4: a throwing ${…} template binding is not a failed render, since it survives its expression throwing (§6.1); the report covers throws elsewhere in the render.
- **0.7.4-draft** (2026-10-21) — §5.3 4c: the interpreter imports an npm: specifier through the host's resolver; §15.4: templates read $page and $site bare; §16.2: a $props binding of an HTMLElement-named prop reaches state after connection; §16.4: a render that threw is drawn again when its inputs change, and onMount runs with the host as this.
- **0.7.3-draft** (2026-10-21) — §16.4: a render that throws at connection is reported on the console and as a jx-error event instead of escaping as an unhandled rejection; onMount does not run for that instance.
- **0.7.2-draft** (2026-10-17) — §8.5 states one slot distribution rule (capture, group, place, forward) and the interpreter, the compiled component module and the static prerender all apply it: whitespace-only text is discarded, the first slot of a name takes its group, fallback follows a group with no content, a forwarded slot is grouped by its own slot attribute, and a prerendered instance recovers its bracketed children on upgrade; §16.6 names data-jx-slots among the hydration markers.
- **0.7.1-draft** (2026-10-17) — A throwing template binding renders nothing and re-runs when its data arrives (§6.1); self-target reactive declarations use positional --jx-s<m> variables and share one rule set (§9.6); native-named props forward into state (§16.2).
- **0.7.0-draft** (2026-10-17) — §5.3 Shape 3: a single-expression template keeps its own type in every tier (was a string in the runtime and the compiled targets).
- **0.6.28-draft** (2026-10-16) — §16.8 status note: drop the stale remark that studio.ts imports exportCemManifest as _exportCemManifest; the unused import is gone and the generator still has no caller.
- **0.6.27-draft** (2026-10-11) — §11.3, §11.4: an interpreting host calls a server entry only through the dev proxy and never imports its module in the browser, so §11.3's marker drops the clause saying the function can run there.
- **0.6.26-draft** (2026-09-29) — §5.7 is marked Partial: the interpreter and the compiled targets use different predicates to decide that a state object is a pure type definition, so the same entry can hold a value in one tier and none in the other.
- **0.6.25-draft** (2026-09-29) — Census against the code: thirty-seven sections now lead with Partial where the interpreter, a compiled target or the text diverges, the stale Implemented cells of the §11.2 prototype table and the §11.3 timing table now read Partial and name their compiled gap, the §7.4, §8.6, §16.8 and §21.1 markers say what ships, and §21 closes as Implemented.
- **0.6.24-draft** (2026-09-29) — §8.4 is marked Partial: content spliced in by a computed-children template is evaluated as templates instead of kept literal.
- **0.6.23-draft** (2026-09-29) — §15.2 is marked Partial: built output renders the children written inside a page-level component instance with an empty scope, so their bindings and bound props are lost.
- **0.6.22-draft** (2026-09-14) — §16.9 Instantiation Limits: a definition that instantiates its own tag with the same props is refused and a 32-frame chain is the cap, with the same diagnostics on both sides of the build; the interpreter reports a refusal with a jx-error ErrorEvent.
- **0.6.21-draft** (2026-09-10) — a style declaration may bind a value the host measured, which two surfaces had worked around as impossible.
- **0.6.20-draft** (2026-09-10) — 8.8 gains custom-element-in-select: a select builds its own rows, so a custom element among them draws, reads convincingly and cannot be picked.
- **0.6.19-draft** (2026-09-10) — the shell's Trusted Types sink list is one shorter: sp-theme left with Adobe Spectrum rather than being allow-listed.
- **0.6.18-draft** (2026-09-10) — §4.3 listener options are not part of the on* grammar; §6.1 a binding writes when its source moves, so a document cannot re-assert or empty a bound control; §13.1 there is no document-local element fragment.
- **0.6.17-draft** (2026-09-09) — a style block may document itself: $description is prose carried on the rule, and every $-prefixed key is metadata rather than a declaration.
- **0.6.16-draft** (2026-09-09) — a declaration at-rule may be written more than once, as an array of blocks — the only spelling @font-face has for a family's second weight.
- **0.6.15-draft** (2026-09-03) — a style declaration value may be a ref; a reactive custom property on a self-target rule is written inline so rows share one rule; a static build reports what it drops; color-scheme lands on :root.
- **0.6.14-draft** (2026-09-03) — a custom element's call-site style merges with its definition's; a slot leaves no node; the display default is a rule decided by the base block, with display revert as the opt-out; onMount receives the host; #/$map resolves.
- **0.6.13-draft** (2026-09-02) — Removing an observed attribute restores the state entry's declared default (§16.5).
- **0.6.12-draft** (2026-09-02) — a linked `area` owes an accessible name, which its `alt` supplies (§8.8).
- **0.6.11-draft** (2026-09-02) — the container rules honour aria-owns.
- **0.6.10-draft** (2026-09-02) — @keyframes emits as one unscoped block, with keyframe selectors taken verbatim.
- **0.6.9-draft** (2026-09-02) — Accessibility rules (§8.8): nine static rules over the overlay walker, each citing its WCAG criterion, with WAI-ARIA, accname and WCAG alignment rows.
- **0.6.8-draft** (2026-09-02) — A nested style key or its scope may be a selector list; nested blocks distribute over every member (§9.2).
- **0.6.7-draft** (2026-09-02) — Overlays: popover, dialog and invoker commands (§8.7) — the dialog and command rules a document is held to, beside the popover ones; the WHATWG HTML row binds it.
- **0.6.6-draft** (2026-09-02) — A $switch whose discriminant re-resolves to the same key keeps its rendered case (§14.1).
- **0.6.5-draft** (2026-09-02) — A $switch may discriminate on the row's $map/item or $map/index inside a mapped array's template, and its container carries the slot its content needs (§14.1).
- **0.6.4-draft** (2026-09-02) — Statements gain stopPropagation and preventDefault (§20.2); a definition's root-level event handlers listen on the host (§16.1); an attribute value that resolves to null or undefined removes the attribute (§8.3).
- **0.6.3-draft** (2026-09-02) — §16.5: observed attributes present at connection are read into state before $props.
- **0.6.2-draft** (2026-09-02) — §10.4 Keys: mapped arrays reconcile by key, rows keep their nodes and effects, reconciliation is batched per microtask; §14.1 each switch case owns a scope.
- **0.6.1-draft** (2026-09-02) — Lifecycle hooks at the mount boundary (§16.4) and the Studio shell as an interpreter host (§21.3).
- **0.6.0-draft** (2026-09-01) — Styling: every declaration in a style object becomes a CSS rule; the runtime delivers them through document.adoptedStyleSheets (new 9.6). Nesting composes in either order to any depth, so 9.2's compiler limitation is gone.
- **0.5.9-draft** (2026-08-31) — popover is enumerated and emitted through the presence branch; declaration-body at-rules (@position-try, @property) emit verbatim; all four boolean-attribute writers now defer to booleanAttrValue.
- **0.5.8-draft** (2026-08-26) — §5.3: $lazy on a $src Function defers the module to first call.
- **0.5.7-draft** (2026-08-26) — §8.3: a boolean attribute value is emitted by family — presence for HTML boolean attributes, the written word for aria-* and the enumerated three.
- **0.5.6-draft** (2026-08-25) — Clarify that the parentheses in an @(condition) style key belong to the query, so a bare media type emits without them (§9).
- **0.5.5-draft** (2026-08-24) — 13.2 states that the runtime takes a prop from an instance only where the instance genuinely carries one — an own property or an attribute — because a state key colliding with a reflected DOM property otherwise reports an empty string and beats the component's declared default.
- **0.5.4-draft** (2026-08-18) — §21.5: Trusted Types enforcement is declined rather than deferred — the observation run answered its question and was removed with its header; no innerHTML write remains in code Jx ships.
- **0.5.3-draft** (2026-08-18) — §5.6: both tiers refuse a $props write against a private key, and a private entry gets no property accessor.
- **0.5.2-draft** (2026-08-18) — §21.5: ship the Trusted Types observation stage, and correct two claims its first boot disproved.
- **0.5.1-draft** (2026-08-18) — §7.1: state the one-separator rule without showcasing a dotted key; note that forbidding one would itself depart from RFC 6901.
- **0.5.0-draft** (2026-08-17) — $ref is JSON Pointer: `/` is the only separator and `~0`/`~1` are implemented; one shared tokenizer replaces five disagreeing ones.
- **0.4.33-draft** (2026-08-16) — §21.5 two CSP profiles, permanently: compiled output never needs 'unsafe-eval' and the interpreting canvas always will. A Trusted Types policy guards the shell's one injection sink and refuses to build scripts; the runtime's four innerHTML writes became replaceChildren().
- **0.4.32-draft** (2026-08-16) — §11.2a the Cookie prototype derives Secure/Path/Domain from a name prefix and from SameSite=None; HttpOnly and Expires are absent on purpose; a cookie name is data, never pattern syntax.
- **0.4.31-draft** (2026-08-16) — Shadow DOM opt-in: $shadow and defaults.shadow emit a declarative shadow root the element adopts; :host translation keeps one style object valid in both modes (§16.6).
- **0.4.30-draft** (2026-08-16) — §9.1 and §16.6: style scoping is a tag-name prefix and generated classes, not data-jx attribute selectors; cite the light-DOM divergence.
- **0.4.29-draft** (2026-08-15) — §18 becomes the machine-checked standards table; §2.5 renamed Platform Precedents to free the reserved title; §21 marked Partial — no Trusted Types policy is installed.
- **0.4.28-draft** (2026-08-10) — §19.6 $expression gains a third position — an element's tagName, narrowed to a TagExpression whose every branch is a literal TagName so the candidate set is enumerable without evaluating; it is the one $expression position that is not live, resolved once at element creation, and the document root's and $head entries' tagNames stay literal.
- **0.4.27-draft** (2026-07-30) — Clarify that a bare `return;` is an early-exit guard, not a value return, when classifying a Function body as a computed (§5.3 4b).
- **0.4.26-draft** (2026-07-30) — Define the handler-side iteration context: an event handler bound inside a map reads its row via state.$map (§10.2).
- **0.4.25-draft** (2026-07-30) — Define parameter binding by name at event call sites, and how a bodyless $src Function is classified as a computed or a callable (§5.3 4d).
- **0.4.24-draft** (2026-07-24) — §5.3 and §11.4: a timing: "server" route lands in the generated site worker only when build.adapter is set; without an adapter the compiler emits a per-page _server.js handler instead.
- **0.4.23-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.4.22-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`79daba23`).
- **0.4.21-draft** (2026-07-22) — Reconcile spec with shipped behavior; document the eval surface (`c8d1d580`).
- **0.4.20-draft** (2026-07-22) — Align specs and docs with the bundled-schema validation contract (`ae861ff6`).
- **0.4.19-draft** (2026-07-17) — Forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script (`e629684d`).
- **0.4.18-draft** (2026-07-17) — Sidecar bundling, extension emit capability, heading anchors (`07e28bc3`).
- **0.4.17-draft** (2026-07-17) — Align spec.md, site-architecture, desktop, server, extensions with reality (`c61ba567`).
- **0.4.16-draft** (2026-07-17) — Clean up spec (`897e8c1e`).
- **0.4.15-draft** (2026-07-15) — Pure method operators and the composite formula catalog (spec §19.4d) (`58be3b1a`).
- **0.4.14-draft** (2026-07-15) — Conditional operators and editor evaluation trace (spec §19.4b, §19.9) (`79926245`).
- **0.4.13-draft** (2026-06-15) — Arrays as pseudo-element (`0b8b3070`).
- **0.4.12-draft** (2026-06-10) — Consolidate markdown and csv handling to the parser package (`8b1ba6da`).
- **0.4.11-draft** (2026-06-02) — Returns type in the class definition (`32e4737a`).
- **0.4.10-draft** (2026-06-01) — Declarative expressions (`472aeb15`).
- **0.4.9-draft** (2026-05-25) — Element annotations (title/description) (`c9137e50`).
- **0.4.8-draft** (2026-05-20) — "format" on fields for image fields (`02f87d29`).
- **0.4.7-draft** (2026-05-20) — Release 0.11.0 (`4a0e17ed`).
- **0.4.6-draft** (2026-05-20) — Run formatter (`8ba47930`).
- **0.4.5-draft** (2026-05-18) — Always emit worker.js for cloudflare (`3dd37c2d`).
- **0.4.4-draft** (2026-05-15) — Add markdown prototypes at top-level (`24020906`).
- **0.4.3-draft** (2026-05-15) — Provider-sepcific Site-Wide Bundling (`51cb5cf6`).
- **0.4.2-draft** (2026-04-23) — Oxfmt (`af32c08c`).
- **0.4.1-draft** (2026-04-23) — Rebrand to jxsuite (`2897a4e8`).
- **0.4.0-draft** (2026-04-22) — Consolidate project config schema and rename as such (`e3523dbf`).
- **0.3.7-draft** (2026-04-22) — External web component support (`a9d0fbe4`).
- **0.3.6-draft** (2026-04-22) — Init new site (`f33d319b`).
- **0.3.5-draft** (2026-04-20) — Text nodes support (`4d45eeb7`).
- **0.3.4-draft** (2026-04-16) — Landing site + working exports + release-it + linting (`a8409b5f`).
- **0.3.3-draft** (2026-04-15) — Rebrand to Jx / Jx Platform (`abc63f2d`).
- **0.3.2-draft** (2026-04-15) — Importmap support (`c1b329d4`).
- **0.3.1-draft** (2026-04-15) — Require json based entrypoints for external class integration (`86dc4383`).
- **0.3.0-draft** (2026-04-10) — Consolidate specs (`80ca313f`).
- **0.2.3-draft** (2026-04-07) — Custom element spec (`4f377be3`).
- **0.2.2-draft** (2026-04-06) — Server-side timing (scaffolding) (`23932590`).
- **0.2.1-draft** (2026-04-06) — Transition to vue reactivity (`70cb8445`).
- **0.2.0-draft** (2026-04-06) — Pure js in defs and strings (`6494999d`).
- **0.1.3-draft** (2026-04-06) — External/md parser (`5161ec0e`).
- **0.1.2-draft** (2026-04-04) — Declarative media breakpoints (`3142b64e`).
- **0.1.1-draft** (2026-04-04) — Rebrand as JSONsx (`0daa94f7`).
- **0.1.0-draft** (2026-04-04) — Init (`a93852ac`).

---

_Jx Specification v0.9.9-draft — subject to revision_
