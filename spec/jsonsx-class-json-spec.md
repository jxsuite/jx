# JSONsx Schema-Defined Classes Specification
## `.class.json` — JSON Schema 2020-12 Class Definitions

**Version:** 1.0.0-draft
**Status:** In Progress
**License:** MIT
**Extends:** [JSONsx Specification v1.0.0-draft, Section 12](./spec.md#12-external-class-integration)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Motivation](#2-motivation)
3. [Document Format](#3-document-format)
4. [Root-Level Properties](#4-root-level-properties)
5. [The `$defs` Object](#5-the-defs-object)
6. [Parameters](#6-parameters)
7. [Fields](#7-fields)
8. [Constructor](#8-constructor)
9. [Methods and Accessors](#9-methods-and-accessors)
10. [Return Types](#10-return-types)
11. [Type Parameters](#11-type-parameters)
12. [Extends (Behavioral Inheritance)](#12-extends-behavioral-inheritance)
13. [The `$implementation` Key](#13-the-implementation-key)
14. [Detection and Routing](#14-detection-and-routing)
15. [Compilation](#15-compilation)
16. [Runtime Resolution](#16-runtime-resolution)
17. [Server Resolution](#17-server-resolution)
18. [Studio Integration](#18-studio-integration)
19. [Private Fields](#19-private-fields)
20. [External Class Contract Alignment](#20-external-class-contract-alignment)

---

## 1. Overview

A `.class.json` file defines an entire class using JSON Schema 2020-12 conventions. It serves simultaneously as:

- **Documentation** — human-readable description of the class interface
- **Validation** — machine-checkable type constraints on parameters and return values
- **Studio UI surface** — the visual builder reads this to render config forms
- **Compilation target** — the compiler generates a proper ES module from it

A JSONsx document references a `.class.json` in its `$defs` the same way it references any external class — via `$prototype` and `$src`:

```json
{
  "$defs": {
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "../../packages/parser/MarkdownCollection.class.json",
      "src": "./content/posts/*.md",
      "sortBy": "frontmatter.date",
      "signal": true
    }
  }
}
```

---

## 2. Motivation

### 2.1 The Problem with `static schema`

Before `.class.json`, external classes exposed their configuration surface to the studio via a `static schema` property on the JS class:

```js
class MarkdownCollection {
  static schema = {
    description: "Load and parse a collection of Markdown files",
    properties: {
      src: { type: "string", description: "Glob pattern" },
      sortBy: { type: "string" }
    },
    required: ["src"]
  };
}
```

This approach has three problems:

1. **Duplication** — the schema lives inside the JS file, duplicating information that should be declarative
2. **Opacity** — the studio cannot read the schema without importing the JS module (which may have Node dependencies)
3. **Incompleteness** — `static schema` cannot express constructor behavior, method signatures, return types, or inheritance relationships

### 2.2 The `.class.json` Solution

A `.class.json` file is the single source of truth for a class's interface. The JS module (if any) is referenced via `$implementation` and exists purely for execution. The schema is the primary artifact.

For simple classes — those with no Node dependencies, no complex async behavior, no native APIs — the `.class.json` can be fully self-contained: all code is inline in `body` fields, and no JS file is needed at all.

---

## 3. Document Format

A `.class.json` file is a valid JSON document conforming to JSON Schema 2020-12. The root object has `"$prototype": "Class"` as a required discriminator:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/schemas/MyClass.class.json",
  "title": "MyClass",
  "description": "A self-describing class definition",
  "$prototype": "Class",
  "extends": "Object",
  "$implementation": "./my-class.js",
  "$defs": {
    "parameters": {},
    "returnTypes": {},
    "fields": {},
    "constructor": {},
    "methods": {}
  }
}
```

The file extension `.class.json` is conventional but not required. Detection is based on the `$prototype: "Class"` discriminator at parse time.

---

## 4. Root-Level Properties

| Property | Type | Required | Description |
|---|---|---|---|
| `$schema` | `string` | No | JSON Schema 2020-12 URI |
| `$id` | `string` | No | Unique identifier URI for the class |
| `title` | `string` | **Yes** | PascalCase class name, used as export name |
| `description` | `string` | No | Human-readable class description |
| `$prototype` | `"Class"` | **Yes** | Discriminator — must be the literal string `"Class"` |
| `extends` | `string` or `{ $ref }` | No | Base class (default: `"Object"`) |
| `$implementation` | `string` | No | Relative path to JS module for hybrid execution |
| `$defs` | `object` | No | Class members (parameters, returnTypes, fields, constructor, methods) |

---

## 5. The `$defs` Object

The `$defs` object organizes class members into five categories:

```json
{
  "$defs": {
    "parameters": { ... },
    "returnTypes": { ... },
    "fields": { ... },
    "constructor": { ... },
    "methods": { ... }
  }
}
```

Each category serves a distinct purpose:

| Category | Purpose | Schema surface | Runtime artifact |
|---|---|---|---|
| `parameters` | Reusable typed parameter schemas | Yes — studio forms | No |
| `returnTypes` | Output type schemas | Yes — data explorer | No |
| `fields` | Class fields (static, instance, private, public) | Partial — public only | Yes — compiled fields |
| `constructor` | Constructor definition | Indirectly — via parameters | Yes — compiled constructor |
| `methods` | Methods and accessors | No | Yes — compiled methods |

---

## 6. Parameters

Parameters define the constructor's configuration surface. Each parameter is keyed by name and has a type schema:

```json
{
  "$defs": {
    "parameters": {
      "src": {
        "identifier": "src",
        "type": { "type": "string" },
        "description": "Glob pattern for source files",
        "examples": ["./content/posts/*.md"]
      },
      "limit": {
        "identifier": "limit",
        "type": { "type": "integer", "default": 20 },
        "description": "Maximum results to return"
      }
    }
  }
}
```

### Parameter Properties

| Property | Type | Description |
|---|---|---|
| `identifier` | `string` | Parameter name (defaults to the object key) |
| `type` | `object` | JSON Schema type definition (`{ "type": "string" }`, etc.) |
| `description` | `string` | Human-readable description |
| `default` | any | Default value (reflected in `type.default` if present) |
| `examples` | `array` | Example values for documentation and studio hints |
| `format` | `string` | Special format annotation (see [Section 11: Type Parameters](#11-type-parameters)) |

Parameters are referenced from the constructor via `$ref`:

```json
{
  "constructor": {
    "parameters": [
      { "$ref": "#/$defs/parameters/src" },
      { "$ref": "#/$defs/parameters/limit" }
    ]
  }
}
```

---

## 7. Fields

Fields define class properties — both the runtime representation and the studio visibility:

```json
{
  "$defs": {
    "fields": {
      "cache": {
        "role": "field",
        "access": "private",
        "scope": "instance",
        "identifier": "cache",
        "type": { "type": "object" },
        "initializer": {}
      },
      "count": {
        "role": "field",
        "access": "public",
        "scope": "static",
        "identifier": "count",
        "default": 0
      }
    }
  }
}
```

### Field Properties

| Property | Type | Values | Description |
|---|---|---|---|
| `role` | `string` | `"field"` | Discriminator |
| `access` | `string` | `"public"`, `"private"`, `"protected"` | Visibility. Private fields compile to `#field` syntax |
| `scope` | `string` | `"instance"`, `"static"` | Instance or class-level |
| `identifier` | `string` | — | Field name (defaults to object key) |
| `type` | `object` | — | JSON Schema type definition |
| `$prototype` | `string` | — | Data source prototype (e.g., `"Request"`) |
| `initializer` | any | — | Compile-time initial value (takes precedence over `default`) |
| `default` | any | — | Default value for instances |
| `description` | `string` | — | Human-readable description |

### Access Control and Visibility

- **Public fields** are visible in the studio's schema form and appear directly as instance properties
- **Private fields** are hidden from the studio and compile to ES private fields (`#name`). At runtime in browser-side dynamic construction, private fields are mapped to `_`-prefixed public properties (see [Section 19](#19-private-fields))
- **Static fields** are class-level properties, not per-instance

---

## 8. Constructor

The constructor defines how instances are initialized:

```json
{
  "$defs": {
    "constructor": {
      "role": "constructor",
      "$prototype": "Function",
      "parameters": [
        { "$ref": "#/$defs/parameters/src" }
      ],
      "superCall": {
        "arguments": ["config.mode"]
      },
      "body": ["this._initialized = true;"]
    }
  }
}
```

### Constructor Properties

| Property | Type | Description |
|---|---|---|
| `role` | `"constructor"` | Discriminator |
| `$prototype` | `"Function"` | Required annotation |
| `parameters` | `array` | Parameter references or inline definitions |
| `superCall` | `object` | Super constructor call configuration |
| `superCall.arguments` | `string[]` | Arguments passed to `super()` |
| `body` | `string` or `string[]` | Constructor body statements (after field initialization) |

The compiled constructor always:
1. Calls `super()` if the class extends a non-Object base
2. Initializes all fields from `config` with fallback to `initializer` then `default` then `null`
3. Executes the `body` statements

At runtime, the constructor receives a single `config` object containing all non-reserved properties from the `$defs` entry (same contract as [Section 12.2 of the main spec](./spec.md#12-external-class-integration)).

---

## 9. Methods and Accessors

### 9.1 Methods

```json
{
  "$defs": {
    "methods": {
      "resolve": {
        "role": "method",
        "access": "public",
        "scope": "instance",
        "identifier": "resolve",
        "parameters": [],
        "returnType": { "$ref": "#/$defs/returnTypes/Result" },
        "body": "return this.data;"
      }
    }
  }
}
```

### 9.2 Accessors (Getters/Setters)

```json
{
  "$defs": {
    "methods": {
      "fullName": {
        "role": "accessor",
        "identifier": "fullName",
        "getter": {
          "body": "return this.first + ' ' + this.last;"
        },
        "setter": {
          "parameters": [{ "identifier": "v" }],
          "body": "const [f, l] = v.split(' '); this.first = f; this.last = l;"
        }
      }
    }
  }
}
```

### Method Properties

| Property | Type | Values | Description |
|---|---|---|---|
| `role` | `string` | `"method"`, `"accessor"` | Discriminator |
| `$prototype` | `string` | `"Function"` | Optional annotation |
| `access` | `string` | `"public"`, `"private"`, `"protected"` | Visibility |
| `scope` | `string` | `"instance"`, `"static"` | Instance or class-level |
| `identifier` | `string` | — | Method name (defaults to object key) |
| `parameters` | `array` | — | Parameter references or inline definitions |
| `returnType` | `object` | — | Return type schema (reference or inline) |
| `body` | `string` or `string[]` | — | Method body (for `role: "method"`) |
| `getter` | `object` | — | Getter definition (for `role: "accessor"`) |
| `getter.body` | `string` | — | Getter body |
| `setter` | `object` | — | Setter definition (for `role: "accessor"`) |
| `setter.parameters` | `array` | — | Setter parameters |
| `setter.body` | `string` | — | Setter body |
| `description` | `string` | — | Human-readable description |

### Async Detection

The compiler emits `async` on a method when either:
- The `returnType.$ref` contains "Promise"
- The `body` contains the string `"await "`

---

## 10. Return Types

Return types define output schemas for documentation and studio type awareness:

```json
{
  "$defs": {
    "returnTypes": {
      "MarkdownFileResult": {
        "type": "object",
        "properties": {
          "slug": { "type": "string" },
          "frontmatter": { "type": "object" },
          "$body": { "type": "string" },
          "$toc": { "type": "array" },
          "$readingTime": { "type": "integer" },
          "$wordCount": { "type": "integer" }
        }
      }
    }
  }
}
```

Return types are pure schema — they produce no runtime artifact. They are referenced by methods via `returnType: { "$ref": "#/$defs/returnTypes/..." }`. The studio's data explorer uses return type schemas to display property names, expected types, and validation status.

---

## 11. Type Parameters

A **type parameter** is a regular parameter whose value is itself a JSON Schema. This enables data shape narrowing per instance without creating a new class.

### Declaration

The class declares a parameter with `format: "json-schema"`:

```json
{
  "$defs": {
    "parameters": {
      "itemSchema": {
        "identifier": "itemSchema",
        "type": { "type": "object" },
        "format": "json-schema",
        "description": "JSON Schema describing frontmatter fields for items in this collection"
      }
    }
  }
}
```

### Usage in Documents

Inline schema:

```json
{
  "posts": {
    "$prototype": "MarkdownCollection",
    "$src": "./MarkdownCollection.class.json",
    "src": "./content/posts/*.md",
    "itemSchema": {
      "properties": {
        "title": { "type": "string" },
        "date": { "type": "string", "format": "date" },
        "tags": { "type": "array", "items": { "type": "string" } }
      },
      "required": ["title", "date"]
    }
  }
}
```

Via `$ref` to an external schema file:

```json
{
  "products": {
    "$prototype": "MarkdownCollection",
    "$src": "./MarkdownCollection.class.json",
    "src": "./content/products/*.md",
    "itemSchema": { "$ref": "./schemas/ProductFrontmatter.schema.json" }
  }
}
```

### Studio Behavior

When `renderSchemaFields()` encounters a parameter with `format: "json-schema"`:

1. **If the value is set and has `properties`**: Renders a preview of schema properties as chips showing `name: type` pairs, followed by a monospace JSON textarea for editing
2. **If the value has a `$ref`**: The server resolves the reference and passes the resolved schema to the studio
3. **If unset**: Shows a placeholder textarea prompting the user to define the schema

### Composition with Multiple Collections

The type parameter pattern enables a single site to use the same class for different content types, each with distinct frontmatter shapes:

```
blog.json
├── posts:  MarkdownCollection + itemSchema { title, date, author, tags }
├── pages:  MarkdownCollection + itemSchema { title, layout }
└── docs:   MarkdownCollection + itemSchema { title, section, order }
```

No new `.class.json` files needed — each instance carries its own type parameter.

---

## 12. Extends (Behavioral Inheritance)

The `extends` property declares a base class. It accepts either a string name or a `$ref` to another `.class.json`:

### String Extends

```json
{
  "title": "MyElement",
  "$prototype": "Class",
  "extends": "HTMLElement"
}
```

Built-in base classes include `"Object"` (default), `"HTMLElement"`, and any globally available constructor name.

### Schema Extends via `$ref`

```json
{
  "title": "PostCollection",
  "$prototype": "Class",
  "extends": { "$ref": "./MarkdownCollection.class.json" },
  "$implementation": "./md.js",
  "$export": "MarkdownCollection"
}
```

When `extends` is a `$ref`, the resolution system:

1. Reads the parent `.class.json`
2. Recursively resolves the parent's `extends` (if any)
3. Merges `$defs` — child entries override parent entries with the same key
4. The compiled output uses the parent's extracted class name as the `extends` clause

### Inheritance Rules

| Member | Inheritance behavior |
|---|---|
| `parameters` | Child inherits all parent parameters. Child can override by redeclaring with same key |
| `fields` | Child inherits all parent fields. Child can add new fields or override |
| `constructor` | Child's constructor replaces parent's. `super()` is emitted if base is non-Object |
| `methods` | Child inherits all parent methods. Child overrides by redeclaring with same identifier |
| `returnTypes` | Child inherits parent's return types. Child can narrow via `allOf` composition |

### Extends vs. Type Parameters

| Mechanism | When to use | Creates new file? | New behavior? |
|---|---|---|---|
| `extends` | Adding/overriding methods, fields, or defaults | Yes (new `.class.json`) | Yes |
| Type parameter (`itemSchema`) | Same behavior, different data shape | No | No |

---

## 13. The `$implementation` Key

The `$implementation` key bridges the gap between declarative schema and imperative execution. When present, it points to a JS module that contains the actual class implementation:

```json
{
  "title": "MarkdownCollection",
  "$prototype": "Class",
  "$implementation": "./md.js",
  "$defs": { ... }
}
```

### Resolution Flow

1. `.class.json` is the primary file — it provides the schema surface
2. `$implementation` is a relative path from the `.class.json` to the JS module
3. At execution time, the runtime and server import the JS module and look for an export matching `title` (or `$export`)
4. The JS class must satisfy the [External Class Contract (spec §12.2)](./spec.md#12-external-class-integration)

### When to Use `$implementation`

| Scenario | Self-contained | Hybrid (`$implementation`) |
|---|---|---|
| Fetch-based APIs | Yes | Not needed |
| Pure computation | Yes | Not needed |
| File system access | No | Required |
| Node.js dependencies | No | Required |
| Complex async workflows | Maybe | Recommended |
| Database access | No | Required |

### Two Modes

**Self-contained** (no `$implementation`):
- All code is inline in `body` fields
- The compiler generates a complete JS module
- The runtime dynamically constructs the class from the schema
- Best for simple, browser-safe classes

**Hybrid** (with `$implementation`):
- The schema describes the interface
- The JS module executes the behavior
- The studio reads the schema; the runtime executes the JS
- Best for classes with server-side dependencies

---

## 14. Detection and Routing

### File Detection

A `.class.json` file is detected by:

1. **File extension**: `*.class.json` (conventional)
2. **Content discriminator**: `"$prototype": "Class"` at root level (authoritative)

### Source Path Detection

The `isClassJsonSrc(src)` utility returns `true` when a `$src` string ends with `.class.json`:

```js
function isClassJsonSrc(src) {
  return typeof src === "string" && src.endsWith(".class.json");
}
```

### Compiler Routing

The compiler's `compile()` function checks `raw.$prototype === "Class"` before any other routing:

```
compile(source) →
  1. $prototype === "Class"  →  compileClassJson()  →  { html: "", files: [{ path, content }] }
  2. !isDynamic(raw)         →  compileStaticPage()
  3. tagName contains "-"    →  compileElement()
  4. otherwise               →  compileClient()
```

### Runtime Routing

The runtime's `resolveExternalPrototype()` checks if `$src` ends with `.class.json` before attempting `import()`:

```
resolveExternalPrototype(def) →
  1. $src ends ".class.json"  →  resolveClassJson()
  2. otherwise                →  import($src)
```

---

## 15. Compilation

The `compileClassJson()` function generates a proper ES module from a `.class.json` definition.

### Output Structure

```js
// Generated by @jsonsx/compiler from .class.json — do not edit manually
// Source: https://example.com/MyClass.class.json

class MyClass extends Base {
  static #count = 0;
  #data;

  constructor(config = {}) {
    super();
    this.name = config.name !== undefined ? config.name : "default";
    this.#data = config.data !== undefined ? config.data : null;
    MyClass.#count++;
  }

  async resolve() {
    const res = await fetch(this.url);
    return res.json();
  }

  get value() {
    return this.#data;
  }

  set value(v) {
    this.#data = v;
  }

  static create(opts) {
    return new MyClass(opts);
  }
}

export { MyClass };
export default MyClass;
```

### Field Compilation Rules

| Field Properties | Compiled Output |
|---|---|
| `access: "public"`, `scope: "instance"` | `this.name = config.name !== undefined ? config.name : default;` |
| `access: "private"`, `scope: "instance"` | `#name;` declaration + `this.#name = ...` in constructor |
| `access: "public"`, `scope: "static"` | `static name = value;` |
| `access: "private"`, `scope: "static"` | `static #name = value;` |

### Initialization Precedence

For both static and instance fields:
1. `initializer` — used if present
2. `default` — used if `initializer` is absent
3. `null` — fallback when neither is provided

For instance fields, the runtime value from `config` takes precedence over all defaults.

---

## 16. Runtime Resolution

When the browser runtime encounters a `$defs` entry with `$src` ending in `.class.json`:

### Self-Contained Path

```
1. fetch($src) → parse JSON → classDef
2. classFromSchema(classDef) → DynClass
3. new DynClass(config)
4. Resolve value: await instance.resolve() → instance.value → instance
5. Optionally wrap in ref() if signal: true
```

### Hybrid Path

```
1. fetch($src) → parse JSON → classDef
2. Detect $implementation key
3. Resolve $implementation URL relative to $src URL
4. Delegate to resolveExternalPrototype() with rewritten $src
5. import($implementation) → extract export → instantiate → resolve value
```

### Fallback Path

If `fetch($src)` fails (e.g., `.class.json` not served statically):

```
1. fetch($src) fails
2. Fall back to resolveViaDevProxy() — POST to /__jsonsx_resolve__
3. Server handles resolution using server-side classFromSchema or $implementation
```

---

## 17. Server Resolution

The dev server handles `.class.json` resolution at two endpoints.

### `POST /__jsonsx_resolve__`

When `$src` ends with `.class.json`:

1. Read the file from disk
2. Parse as JSON
3. If `$implementation` exists: resolve the path, `import()` the JS module, instantiate the class, resolve value
4. If self-contained: `classFromSchema()` to build a dynamic class, instantiate, resolve value
5. Return `Response.json(value)`

### `GET /__studio/plugin-schema`

Three resolution paths, in order:

1. **Direct `.class.json`**: If `$src` ends with `.class.json`, read and `extractStudioSchema()`
2. **Sibling discovery**: If `$src` is a `.js` file, check for `<prototype>.class.json` next to it
3. **Fallback**: Import the JS module and read `ExportedClass.schema` (backwards compatibility)

### `extractStudioSchema(classDef)`

Transforms a `.class.json`'s `$defs` into the flat `{ description, properties, required }` shape the studio consumes:

- **Parameters** → `properties` (with `type`, `description`, `examples`, `format`)
- **Public fields** → `properties` (with `type`, `description`, `default`)
- **Private fields** → excluded
- **Constructor parameters without defaults** → `required`
- **`extends.$ref`** → recursively merge parent schema (child overrides parent)

---

## 18. Studio Integration

The studio consumes `.class.json` schemas through the existing `renderSchemaFields()` function with minimal additions.

### Schema Form Rendering

When a `$defs` entry has `$prototype` + `$src`, the studio:

1. Calls `GET /__studio/plugin-schema?src=...&prototype=...` to fetch the schema
2. Renders form fields from `schema.properties`:
   - `enum` → `<select>` dropdown
   - `type: "boolean"` → checkbox
   - `type: "integer"` / `type: "number"` → number input with min/max
   - `type: "string"` → text input
   - `type: "array"` / `type: "object"` → JSON textarea
   - `format: "json-schema"` → schema editor (chips preview + monospace textarea)
3. Marks fields from `schema.required` with `*`

### Sibling Auto-Discovery

When a document uses `$src: "./md.js"` with `$prototype: "MarkdownCollection"`, the studio server:

1. Looks for `MarkdownCollection.class.json` in the same directory as `md.js`
2. If found, uses the `.class.json` schema instead of importing the JS module
3. This means existing documents continue to work without changes — the `.class.json` is discovered automatically

---

## 19. Private Fields

### Compiled Output

The compiler generates proper ES private fields:

```js
class MyClass {
  #secret;

  constructor(config = {}) {
    this.#secret = config.secret !== undefined ? config.secret : null;
  }
}
```

### Browser-Side Dynamic Construction

JavaScript's `new Function()` cannot create ES private class fields. When the runtime dynamically constructs a class from a `.class.json` schema (without compilation), `access: "private"` fields are mapped to `_`-prefixed public properties:

```js
// Schema: { access: "private", identifier: "data" }
// Dynamic: this._data = ...
// Compiled: this.#data = ...
```

This is a development-mode tradeoff. Production deployments should use compiled output with proper private fields.

### Server-Side Dynamic Construction

The server-side `classFromSchema()` (in `resolve.js`) has no private field limitations — it uses the same `_`-prefix convention for consistency, but since server-side code is not user-facing, this is purely an implementation detail.

---

## 20. External Class Contract Alignment

`.class.json` classes conform to the same external class contract defined in [spec §12.2](./spec.md#12-external-class-integration):

| Contract element | `.class.json` representation |
|---|---|
| Constructor receives `config` object | `$defs.constructor.parameters` define the config interface |
| `instance.resolve()` async | `$defs.methods.resolve` with `role: "method"` |
| `instance.value` | `$defs.methods.value` with `role: "accessor"`, `getter` |
| `instance.subscribe(callback)` | `$defs.methods.subscribe` (optional) |
| `instance.unsubscribe()` | `$defs.methods.unsubscribe` (optional) |

The runtime strips JSONsx-reserved keys (`$prototype`, `$src`, `$export`, `signal`, `timing`, etc.) from the `$defs` entry before passing the remaining properties as the `config` object to the constructor.

---

## Appendix A — Complete `.class.json` Example

### MarkdownCollection.class.json

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://jsonsx.dev/schemas/MarkdownCollection.class.json",
  "title": "MarkdownCollection",
  "description": "Load, parse, and sort a collection of Markdown files matching a glob pattern",
  "$prototype": "Class",
  "extends": "Object",
  "$implementation": "./md.js",
  "$defs": {
    "parameters": {
      "src": {
        "identifier": "src",
        "type": { "type": "string" },
        "description": "Glob pattern for markdown files",
        "examples": ["./content/posts/*.md"]
      },
      "sortBy": {
        "identifier": "sortBy",
        "type": { "type": "string" },
        "description": "Dot-path field to sort by"
      },
      "sortOrder": {
        "identifier": "sortOrder",
        "type": { "type": "string", "enum": ["asc", "desc"], "default": "desc" },
        "description": "Sort direction"
      },
      "limit": {
        "identifier": "limit",
        "type": { "type": "integer" },
        "description": "Maximum number of results"
      },
      "itemSchema": {
        "identifier": "itemSchema",
        "type": { "type": "object" },
        "format": "json-schema",
        "description": "JSON Schema describing frontmatter fields for items in this collection"
      }
    },
    "returnTypes": {
      "MarkdownFileResult": {
        "type": "object",
        "properties": {
          "slug": { "type": "string" },
          "path": { "type": "string" },
          "frontmatter": { "type": "object" },
          "$body": { "type": "string" },
          "$excerpt": { "type": "string" },
          "$toc": { "type": "array" },
          "$readingTime": { "type": "integer" },
          "$wordCount": { "type": "integer" }
        }
      },
      "MarkdownCollection": {
        "type": "array",
        "items": { "$ref": "#/$defs/returnTypes/MarkdownFileResult" }
      }
    },
    "constructor": {
      "role": "constructor",
      "$prototype": "Function",
      "parameters": [
        { "$ref": "#/$defs/parameters/src" }
      ],
      "body": ["this.config = config;"]
    },
    "methods": {
      "resolve": {
        "role": "method",
        "access": "public",
        "scope": "instance",
        "identifier": "resolve",
        "returnType": { "$ref": "#/$defs/returnTypes/MarkdownCollection" },
        "description": "Load and parse all matching markdown files"
      }
    }
  }
}
```

---

## Appendix B — Composition Patterns

### Pattern 1: Direct use with inline type parameter

```json
{
  "$defs": {
    "posts": {
      "$prototype": "MarkdownCollection",
      "$src": "./MarkdownCollection.class.json",
      "src": "./content/posts/*.md",
      "sortBy": "frontmatter.date",
      "itemSchema": {
        "properties": {
          "title": { "type": "string" },
          "date": { "type": "string", "format": "date" }
        },
        "required": ["title", "date"]
      }
    }
  }
}
```

### Pattern 2: Extends with baked-in defaults

`PostCollection.class.json`:
```json
{
  "$prototype": "Class",
  "title": "PostCollection",
  "extends": { "$ref": "./MarkdownCollection.class.json" },
  "$implementation": "./md.js",
  "$export": "MarkdownCollection",
  "$defs": {
    "parameters": {
      "sortBy": {
        "identifier": "sortBy",
        "type": { "type": "string", "default": "frontmatter.date" }
      },
      "sortOrder": {
        "identifier": "sortOrder",
        "type": { "type": "string", "default": "desc" }
      }
    }
  }
}
```

### Pattern 3: Behavioral subclass

`ProductCollection.class.json`:
```json
{
  "$prototype": "Class",
  "title": "ProductCollection",
  "extends": { "$ref": "./MarkdownCollection.class.json" },
  "$implementation": "./product-collection.js",
  "$defs": {
    "parameters": {
      "minPrice": {
        "identifier": "minPrice",
        "type": { "type": "number" },
        "description": "Minimum price filter"
      }
    },
    "methods": {
      "filterByPrice": {
        "role": "method",
        "identifier": "filterByPrice",
        "parameters": [{ "identifier": "min" }, { "identifier": "max" }],
        "body": "return this.items.filter(i => i.frontmatter.price >= min && i.frontmatter.price <= max);"
      }
    }
  }
}
```

---

## Appendix C — Checklist

When creating a new `.class.json`:

- [ ] Set `$prototype: "Class"` and `title` (PascalCase)
- [ ] Define all constructor parameters in `$defs.parameters` with `type`, `description`, and `examples`
- [ ] Mark config-only fields as parameters, not fields
- [ ] Mark internal state as `access: "private"` fields
- [ ] Define `resolve()` or `value` accessor if the class produces data
- [ ] Add `$implementation` if the class has Node.js or complex async dependencies
- [ ] Add `format: "json-schema"` to parameters whose values are themselves schemas
- [ ] Add `returnTypes` documenting the output shape for studio data explorer
- [ ] Test with both compiled output and runtime dynamic construction
