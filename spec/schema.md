# `@jxplatform/schema` Specification
## JSON Schema 2020-12 Meta-Schema Generator

**Version:** 2.0.0-draft
**Status:** In Progress
**License:** MIT

---

## 1. Overview

`@jxplatform/schema` generates the Jx meta-schema — a JSON Schema 2020-12 document that validates Jx component files. The schema is derived at generation time from web standards data (`@webref/css`, `@webref/elements`, `@webref/idl`), ensuring it stays current with browser capabilities.

---

## 2. Exports

| Export | Description |
|---|---|
| `generateSchema()` | Returns the full Jx meta-schema as a JavaScript object |
| `generateSchemaString()` | Returns the schema as a formatted JSON string |
| `validateDocument(doc)` | Validates a Jx document against the generated schema |

---

## 3. Schema Coverage

### 3.1 Document Structure

- Root-level fields: `$schema`, `$id`, `$defs`, `state`, `tagName`, `children`, `$media`, `$elements`, `observedAttributes`
- `tagName` enumeration: all standard HTML elements derived from `@webref/elements`
- `children`: array of element definitions or Array namespace (`$prototype: "Array"`)

### 3.2 `state` Entry Shapes

| Shape | Schema Definition | Status |
|---|---|---|
| Naked value (scalar, array, object) | `StateEntry.oneOf` | **Implemented** |
| Typed value (`TypedStateDef` with `default`) | `TypedStateDef` with `attribute`, `reflects`, `deprecated` CEM fields | **Implemented** |
| Computed (template string containing `${}`) | String pattern match | **Implemented** |
| Function (`$prototype: "Function"`) | `FunctionDef` with `body`, `parameters`, `$src`, `$export`, `signal`, `emits` | **Implemented** |
| External class (`$prototype: <ClassName>`) | `ExternalClassDef` with all built-in prototypes | **Implemented** |

### 3.3 `$defs` Pure Type Definitions

`PureTypeDef` — requires `type`, forbids `default` and `$prototype`.

> **Status: Implemented.**

### 3.4 Built-in Prototypes

All 12 built-in prototypes are enumerated with their specific configuration properties:

- `Request` — url, method, headers, body, debounce, manual, urlParams, signal, timing
- `URLSearchParams` — default params
- `FormData` — default fields
- `LocalStorage` / `SessionStorage` — key, default value
- `Cookie` — name, maxAge, path, domain, secure, sameSite
- `IndexedDB` — database, version, store, indexes, keyPath
- `Array` — items, map, filter, sort
- `Set` / `Map` — default values
- `Blob` — parts, type
- `ReadableStream` — (stub)

> **Status: Implemented.**

### 3.5 `.class.json` Schema

`ClassDef` — fields, constructor, methods, accessors, `$implementation`.

> **Status: Implemented.**

### 3.6 Element Properties

- All standard HTML DOM properties derived from `@webref/idl`
- CSSOM camelCase style properties derived from `@webref/css`
- All `EventHandler` names (onclick, oninput, etc.) derived from IDL

> **Status: Implemented.**

### 3.7 CEM Annotations

| Annotation | On | Purpose |
|---|---|---|
| `attribute` | `TypedStateDef` | Maps state entry to an HTML attribute |
| `reflects` | `TypedStateDef` | Attribute reflects property changes |
| `deprecated` | `TypedStateDef` | Marks entry as deprecated |
| `parameters` | `FunctionDef` | CEM `Parameter` objects |
| `emits` | `FunctionDef` | CEM `Event` objects |

> **Status: Implemented.**

---

## 4. Generation Pipeline

1. Load web standards data from `@webref/css`, `@webref/elements`, `@webref/idl`
2. Extract HTML tag names and their valid properties
3. Extract CSS properties and convert to CSSOM camelCase
4. Extract DOM event handler names
5. Compose the meta-schema with all Jx vocabulary
6. Write to `schema.json`

The schema is regenerated when web standards packages are updated.

---

## 5. Output

The generated `schema.json` is a single JSON Schema 2020-12 document (~970 lines of generator code, large output). It can be referenced via the `$schema` field in any Jx document:

```json
{
  "$schema": "https://jxplatform.net/schema/v1"
}
```

---

## 6. Dependencies

| Package | Purpose |
|---|---|
| `@webref/css` | CSS property definitions |
| `@webref/elements` | HTML element definitions |
| `@webref/idl` | Web IDL interface definitions |

---

*`@jxplatform/schema` Specification v2.0.0-draft*
