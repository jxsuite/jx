# JSONsx `$defs` Unified Grammar
## Refactoring Spec: A Fully Self-Describing Schema

**Amends:** JSONsx Specification v0.8.0+ and External Class Integration Amendment v0.1.0  
**Status:** Draft  
**Version:** 0.2.0

---

## Changelog from v0.1.0

- **Naked value signals:** Scalar, array, and object values in `$defs` are implicitly `Signal.State` — no `signal: true`, `type`, or `default` wrapper required for simple cases
- **JSON Schema types:** The expanded signal form uses JSON Schema 2020-12 vocabulary for type annotation; `type`, `properties`, `items`, `enum`, `minimum`, `maximum`, etc. are first-class
- **Pure type definitions:** `$defs` objects with no `default` and no `$prototype` are tooling-only type declarations — no signal is emitted
- **Universal `${}` reactivity:** Template literal syntax is valid anywhere a string value appears in the document tree — `textContent`, `className`, `style` properties, `attributes`, and all other string-accepting fields become reactive when `${}` is present
- **`signal: true` retirement:** Now required only on `$prototype: "Function"` computed entries and external class entries; removed from all other shapes

---

## 1. Summary of Changes

This amendment consolidates the `$defs` system and extends reactivity throughout the document into a single, self-describing grammar. The **shape and value of each entry determines its type and behavior** — no additional flags required in the common case.

### What is removed

| Removed | Replaced by |
|---|---|
| `$handler: true` | `$prototype: "Function"` with `$src` or `body` |
| `$handlers` (document-level path) | `$src` on individual `Function` entries |
| `$compute` | Template literal string with `${}` syntax |
| `$deps` | Compiler-inferred from `this.$` references |
| `signal: true` on state signals | Implied by naked value or JSON Schema with `default` |
| `signal: true` on computed signals | Implied by `${}` string shape |
| JSONata runtime dependency | Eliminated entirely |

### What is added

| Added | Purpose |
|---|---|
| Naked value signals | Implicit `Signal.State` from scalar, array, or object value |
| JSON Schema type annotation | `type`, `properties`, `items`, `enum`, etc. on expanded signal form |
| Pure type definitions | `$defs` entries without `default` — tooling only, no signal emitted |
| Universal `${}` reactivity | Template literal syntax valid in any string-valued document property |
| `$prototype: "Function"` | Inline or external function declaration |
| `body` property | Inline function body string |
| `arguments` property | Parameter name list (mirrors `Function` constructor) |
| `name` property | Optional explicit function name |

### What is unchanged

- `$prototype` for all non-Function classes (`Request`, `Array`, `MarkdownFile`, etc.)
- `$src` and `$export` for external class and function resolution
- `signal: true` on external class entries (now its only remaining use outside Function computed)
- All `$ref` binding semantics
- All element, style, slot, and child array syntax
- Scope rules, component encapsulation, compilation model

---

## 2. The Unified `$defs` Grammar

Every entry in `$defs` falls into exactly one of five shapes, determinable by inspection alone.

---

### Shape 1 — Naked Value Signal

**Identified by:** a JSON scalar (number, string without `${}`, boolean, null), array, or plain object with no JSONsx reserved keys.

```json
{
  "$defs": {
    "$count":   0,
    "$price":   9.99,
    "$name":    "World",
    "$active":  false,
    "$data":    null,
    "$tags":    [],
    "$user":    { "id": null, "name": "", "role": "guest" },
    "$coords":  { "lat": 0, "lng": 0 }
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
- A plain object with no `$prototype`, no `type`, no `default`, and no `properties` is an object state signal initialized to that object
- The inferred type is used for LSP hints and TypeScript declaration generation — no runtime effect
- `signal: true` must not be declared — it is implied. Doing so is a compile error.

---

### Shape 2 — Expanded Signal (JSON Schema)

**Identified by:** an object with a `default` property and no `$prototype`.

```json
{
  "$defs": {
    "$count": {
      "type": "integer",
      "default": 0,
      "minimum": 0,
      "maximum": 100,
      "description": "Current counter value"
    },
    "$status": {
      "type": "string",
      "default": "idle",
      "enum": ["idle", "loading", "success", "error"]
    },
    "$user": {
      "type": "object",
      "default": { "id": null, "name": "", "role": "guest" },
      "properties": {
        "id":   { "type": ["integer", "null"] },
        "name": { "type": "string", "minLength": 1 },
        "role": { "type": "string", "enum": ["admin", "editor", "guest"] }
      },
      "required": ["id", "name", "role"]
    },
    "$items": {
      "type": "array",
      "default": [],
      "items": { "$ref": "#/$defs/TodoItem" }
    }
  }
}
```

**Emitted as:** `Signal.State(default)`

**Rules:**
- The `default` keyword is the required discriminator for this shape — its value is the signal's initial state
- All JSON Schema 2020-12 keywords are valid: `type`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `description`, `examples`, etc.
- Schema keywords are **tooling-only** — they power LSP validation, autocomplete, and TypeScript declaration generation. They are stripped by the compiler before runtime emission. Runtime validation is a future concern noted in the roadmap.
- `signal: true` must not be declared — it is implied by `default`. Doing so is a compile error.

**Use the expanded form when:**
- The value needs type constraints (`enum`, `minimum`, `required`, etc.)
- The value needs a description for documentation or builder UI
- The value's type is not unambiguously inferrable from the naked default alone
- The value references a shared type definition via `$ref`

**Use the naked form (Shape 1) when none of the above apply.** Prefer simplicity.

---

### Shape 2b — Pure Type Definition

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
    },
    "UserRole": {
      "type": "string",
      "enum": ["admin", "editor", "guest"]
    }
  }
}
```

**Emitted as:** nothing — no signal, no function, no runtime artifact.

Pure type definitions exist solely for tooling. They are reusable subschemas referenced by other `$defs` entries:

```json
"$items": {
  "type": "array",
  "default": [],
  "items": { "$ref": "#/$defs/TodoItem" }
}
```

**Naming convention:** pure type definitions use `PascalCase` without a `$` prefix to visually distinguish them from signal and function declarations at a glance.

---

### Shape 3 — Computed Signal (Template String)

**Identified by:** a JSON string value containing `${}` syntax.

```json
{
  "$defs": {
    "$fullName":     "${this.$firstName.get()} ${this.$lastName.get()}",
    "$displayTitle": "${this.$score.get() >= 90 ? 'Expert' : this.$score.get() >= 70 ? 'Advanced' : 'Beginner'}",
    "$scoreLabel":   "${this.$score.get()}%",
    "$greeting":     "Hello, ${this.$name.get()}!",
    "$isEmpty":      "${this.$items.get().length === 0}"
  }
}
```

**Emitted as:** `Signal.Computed(() => \`...template...\`)`

**Rules:**
- `signal: true` is implied — must not be declared
- `$deps` is never declared — the compiler scans `this.$identifier` references and builds the dependency set automatically
- The string must be a **pure expression** — no statements, no assignments, no semicolons. Violations are compile-time errors.
- `return` is never written — the expression value is the signal value by definition
- `this` refers exclusively to the current component's `$defs` scope. No parent scope leakage.

**What the compiler emits:**

```json
"$displayTitle": "${this.$score.get() >= 90 ? 'Expert' : 'Beginner'}"
```

Becomes:

```js
const $displayTitle = new Signal.Computed(() =>
  `${scope.$score.get() >= 90 ? 'Expert' : 'Beginner'}`
);
```

**Why no backticks in JSON:** The `${}` pattern inside a regular JSON string is the unambiguous marker. Backticks cannot be JSON string delimiters, so the two syntaxes are orthogonal. The JSON string boundary enforces read-only semantics — template strings are computed values, never mutable state. This is a design feature.

---

### Shape 4 — Function (Inline or External)

**Identified by:** object with `$prototype: "Function"`.

Functions serve two roles:
- **Handler** — void function called in response to events or lifecycle hooks
- **Computed with logic** — function returning a value, wrapped in `Signal.Computed` when `signal: true`

Use `$prototype: "Function"` when logic requires statements, assignments, multi-line conditionals, or side effects that cannot be expressed as a single template string expression.

#### 4a — Inline handler

```json
"increment": {
  "$prototype": "Function",
  "body": "this.$count.set(this.$count.get() + 1)"
},
"handleInput": {
  "$prototype": "Function",
  "arguments": ["event"],
  "body": "this.$value.set(event.target.value)"
},
"resetAll": {
  "$prototype": "Function",
  "body": "this.$count.set(0); this.$name.set(''); this.$active.set(false)"
}
```

#### 4b — Inline computed function

```json
"$titleClass": {
  "$prototype": "Function",
  "body": "return this.$score.get() >= 90 ? 'gold' : this.$score.get() >= 70 ? 'silver' : 'bronze'",
  "signal": true
}
```

`signal: true` here wraps the function in `Signal.Computed`. It is required when the function should produce a reactive derived value rather than act as a callable handler.

#### 4c — External function

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

#### 4d — Properties

| Property | Required | Description |
|---|---|---|
| `$prototype` | Yes | Must be `"Function"` |
| `body` | If no `$src` | Raw function body string — content between `{` and `}` |
| `arguments` | No | Array of parameter name strings. Default: `[]` |
| `name` | No | Explicit function name. Default: the `$defs` key name |
| `$src` | If no `body` | External module specifier |
| `$export` | No | Named export in `$src` module. Default: `$defs` key name |
| `signal` | No | When `true`, wraps in `Signal.Computed`. Default: `false` |
| `description` | No | Documentation string |

`body` and `$src` are mutually exclusive. Declaring both is a compile-time error.

#### 4e — The `body` contract

The `body` string is the raw content of the function body — exactly what would appear between the braces of a named function declaration. The compiler wraps it verbatim:

```json
"handleInput": {
  "$prototype": "Function",
  "arguments": ["event"],
  "body": "this.$value.set(event.target.value)"
}
```

Emits:

```js
function handleInput(event) {
  this.$value.set(event.target.value);
}
```

With `signal: true`:

```json
"$titleClass": {
  "$prototype": "Function",
  "body": "return this.$score.get() >= 90 ? 'gold' : 'silver'",
  "signal": true
}
```

Emits:

```js
const $titleClass = new Signal.Computed(function $titleClass() {
  return this.$score.get() >= 90 ? 'gold' : 'silver';
}.bind(scope));
```

#### 4f — `return` statement rules

| Context | `return` | Compiler behaviour |
|---|---|---|
| Handler (`signal` absent or `false`) | Never | Warn if non-void `return` detected |
| Computed (`signal: true`) | Required | Warn if no `return` detected |
| Template string (Shape 3) | Never written | Implied by expression syntax |

---

### Shape 5 — External Class (Data Source)

**Identified by:** object with `$prototype` set to any value **other than** `"Function"`.

```json
{
  "$defs": {
    "$userData": {
      "$prototype": "Request",
      "url": "/api/user",
      "signal": true
    },
    "$posts": {
      "$prototype": "MarkdownCollection",
      "$src": "@jsonsx/md",
      "src": "./content/posts/*.md",
      "timing": "compiler",
      "signal": true
    },
    "$catalog": {
      "$prototype": "ProductCatalogParser",
      "$src": "./parsers/catalog.js",
      "src": "./data/catalog.xml"
    }
  }
}
```

`signal: true` on external class entries is **meaningful and required** when the class instance should be wrapped in a reactive signal. Without it, the class is instantiated once and its resolved value is static. This is one of two remaining places where `signal: true` is an active, non-implied flag (the other being Shape 4 computed functions).

No changes to this shape. See External Class Integration Amendment for full specification.

---

## 3. Universal `${}` Reactivity

Template literal syntax is valid **anywhere a string value appears in the document tree** — not only in `$defs`.

### 3.1 Reactive element properties

```json
{
  "tagName": "div",
  "textContent": "${this.$count.get()} items remaining",
  "className":   "${this.$active.get() ? 'card active' : 'card'}",
  "hidden":      "${this.$items.get().length === 0}",
  "title":       "Score: ${this.$score.get()}%"
}
```

### 3.2 Reactive style properties

```json
{
  "tagName": "div",
  "style": {
    "color":   "${this.$score.get() > 90 ? 'gold' : 'inherit'}",
    "opacity": "${this.$loading.get() ? '0.5' : '1'}",
    "display": "${this.$visible.get() ? 'block' : 'none'}"
  }
}
```

### 3.3 Reactive attributes

```json
{
  "tagName": "button",
  "attributes": {
    "aria-label": "${this.$count.get()} unread messages",
    "data-state": "${this.$status.get()}",
    "data-index": "${this.$index.get()}"
  }
}
```

### 3.4 Compilation

When the compiler encounters `${}` in any string-valued document property, it wraps the binding in a reactive effect rather than a one-time assignment:

```js
// For: "textContent": "${this.$count.get()} items remaining"
effect(() => {
  el.textContent = `${scope.$count.get()} items remaining`;
});
```

### 3.5 Relationship to `$ref`

`$ref` and `${}` are complementary, not redundant:

| Pattern | Use when |
|---|---|
| `{ "$ref": "#/$defs/$label" }` | Binding to a named signal — referenced in multiple places, or complex enough to deserve a name |
| `"${this.$count.get()} items"` | Inline computed binding used in exactly one place |

Prefer `${}` for single-use reactive bindings. Prefer `$ref` for reused or named signals.

### 3.6 Scope

Template strings anywhere in a component's document tree have access only to that component's `$defs` signals via `this.$signalName`. Signals do not leak across component boundaries. The `this` scope is always and only the current component's `$defs` object.

---

## 4. Removal of `$handlers` (Document Level)

The document-level `$handlers` property is retired entirely.

**Before:**
```json
{
  "$handlers": "./my-counter.js",
  "$defs": {
    "increment": { "$handler": true },
    "decrement": { "$handler": true }
  }
}
```

**After:**
```json
{
  "$defs": {
    "increment": { "$prototype": "Function", "$src": "./my-counter.js" },
    "decrement": { "$prototype": "Function", "$src": "./my-counter.js" }
  }
}
```

When multiple `Function` entries share a `$src`, the compiler emits a single import and extracts named exports. Module caching is automatic.

---

## 5. Retirement of `$compute` and `$deps`

### Migration table

| Before | After |
|---|---|
| `"$compute": "$firstName & ' ' & $lastName"` | `"${this.$firstName.get()} ${this.$lastName.get()}"` |
| `"$compute": "$score >= 90 ? 'Expert' : 'Beginner'"` | `"${this.$score.get() >= 90 ? 'Expert' : 'Beginner'}"` |
| `"$compute": "$string($score) & '%'"` | `"${this.$score.get()}%"` |
| `"$compute": "count($items[done = false])"` | `"${this.$items.get().filter(i => !i.done).length}"` |

`$deps` is never written in the new system — dependency detection is always automatic.

### JSONata removal

JSONata is no longer a dependency of JSONsx core. The `jsonata` npm package is removed from the dependency stack. External class libraries such as `@jsonsx/md` may use JSONata internally for their own purposes — this is contained within the library, not a JSONsx core concern.

---

## 6. Updated `signal: true` Semantics

`signal: true` now has **two remaining uses**:

| Shape | `signal: true` | Behaviour |
|---|---|---|
| Naked value | Forbidden — compile error | Implied |
| Expanded JSON Schema with `default` | Forbidden — compile error | Implied |
| Template string | Forbidden — compile error | Implied |
| `$prototype: "Function"` (handler) | Forbidden — compile error | Not applicable |
| `$prototype: "Function"` (computed) | **Required to opt in** | Wraps in `Signal.Computed` |
| `$prototype: "ClassName"` | **Optional** | Wraps resolved value in `Signal.State`; enables `subscribe()` |

The flag is now unambiguous: it appears only where its presence changes behavior in a non-inferrable way.

---

## 7. Updated Reserved Keywords

### Retired

| Keyword | Reason |
|---|---|
| `$handlers` | Replaced by `$src` on individual `Function` entries |
| `$handler` | Replaced by `$prototype: "Function"` |
| `$compute` | Replaced by template string shape |
| `$deps` | Compiler-inferred |

### Added

| Keyword | Purpose |
|---|---|
| `body` | Inline function body on `$prototype: "Function"` entries |
| `arguments` | Parameter names on `$prototype: "Function"` entries |
| `name` | Optional explicit name on `$prototype: "Function"` entries |

### Complete current keyword table

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
| `signal` | Reactive wrapping: required on `$prototype: "Function"` computed and external class entries |
| `timing` | Execution timing: `"compiler"`, `"server"`, or `"client"` |
| `default` | Initial value — discriminator for expanded signal shape (Shape 2) |
| `body` | Inline function body |
| `arguments` | Inline function parameter names |
| `name` | Inline function explicit name |
| `description` | Documentation string on any `$defs` entry |

Standard JSON Schema 2020-12 keywords (`type`, `properties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `required`, `examples`, etc.) are inherited from the JSON Schema vocabulary and are valid on any `$defs` entry that is a signal or type definition.

---

## 8. Updated Dependency Stack

| Package | Version | Purpose | Change |
|---|---|---|---|
| `@apidevtools/json-schema-ref-parser` | `^15.0` | `$ref` resolution | Unchanged |
| `signal-polyfill` | `^0.2` | TC39 Signals polyfill | Unchanged |
| ~~`jsonata`~~ | ~~`^2.0`~~ | ~~JSONata expression evaluation~~ | **Removed** |

The compiled output of a JSONsx component requires **only the signals polyfill**. All other processing occurs at build time. The signals polyfill is expected to be retired when native TC39 Signals land in browsers.

---

## 9. Updated Compilation Model

### Shape detection algorithm

```
For each entry in $defs:

1. Value is a string?
   a. Contains "${" → Shape 3: Computed signal (Signal.Computed)
   b. No "${" → Shape 1: String state signal (Signal.State)

2. Value is a number, boolean, or null?
   → Shape 1: Naked state signal (Signal.State)

3. Value is an array?
   → Shape 1: Array state signal (Signal.State)

4. Value is an object?
   a. Has "$prototype: Function" → Shape 4: Function
   b. Has "$prototype: <other>" → Shape 5: External class
   c. Has "default" (no $prototype) → Shape 2: Expanded signal (Signal.State)
   d. Has JSON Schema keywords, no "default", no "$prototype"
      → Shape 2b: Pure type definition (tooling only, no emission)
   e. No reserved keys → Shape 1: Object state signal (Signal.State)
```

### Template string compilation (anywhere in document)

**Pass 1 — Dependency extraction:**
Scan all string values in the document tree. For any containing `${`, extract all `this.$identifier` references. Validate each against the current component's `$defs`. Warn on unknown references.

**Pass 2 — Emission:**
- In `$defs`: emit `Signal.Computed(() => \`...\`)`
- In element properties: emit `effect(() => { el.property = \`...\`; })`

### JSON Schema stripping

All JSON Schema keywords on `$defs` entries are stripped before runtime emission. Only the `default` value survives as the `Signal.State` initializer. Type information is used exclusively by the compiler for `.d.ts` generation and LSP schema annotations.

### Static vs dynamic classification

| Entry type | Client JS shipped |
|---|---|
| Naked value with no `${}` references in document | No |
| Naked value with `${}` references in document | Effect only |
| Template string signal | Yes |
| `$prototype: "Function"` | Yes |
| External class with `timing: "compiler"` | No |
| External class with `timing: "client"` | Yes |
| Pure type definition | No |

---

## 10. Complete Updated Example

### `todo-app.json` — fully inline, no sidecar required

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

    "$items": {
      "type": "array",
      "default": [{ "id": 1, "text": "Learn JSONsx", "done": false }],
      "items": { "$ref": "#/$defs/TodoItem" }
    },

    "$remaining": "${this.$items.get().filter(i => !i.done).length}",
    "$total":     "${this.$items.get().length}",
    "$summary":   "${this.$remaining.get()} of ${this.$total.get()} remaining",
    "$allDone":   "${this.$remaining.get() === 0}",

    "addItem": {
      "$prototype": "Function",
      "body": "this.$items.set([...this.$items.get(), { id: Date.now(), text: 'New item', done: false }])"
    },
    "toggleItem": {
      "$prototype": "Function",
      "arguments": ["id"],
      "body": "this.$items.set(this.$items.get().map(i => i.id === id ? { ...i, done: !i.done } : i))"
    },
    "clearDone": {
      "$prototype": "Function",
      "body": "this.$items.set(this.$items.get().filter(i => !i.done))"
    }
  },

  "tagName": "todo-app",
  "style": { "fontFamily": "system-ui", "maxWidth": "480px", "margin": "2rem auto" },

  "children": [
    {
      "tagName": "h1",
      "textContent": "${this.$summary.get()}"
    },
    {
      "tagName": "p",
      "textContent": "All done! 🎉",
      "hidden": "${!this.$allDone.get()}"
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
        "items": { "$ref": "#/$defs/$items" },
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

Note what is absent: no `$handler: true`, no `$handlers`, no `$compute`, no `$deps`, no `signal: true` on any state signal, no sidecar `.js` file. The document is fully self-describing. The compiled output is vanilla HTML + JS with no runtime dependency beyond the signals polyfill.

---

### The same component with an external sidecar

When handlers grow complex, they migrate to an external file. The JSON structure is unchanged — only `body` is replaced by `$src`:

```json
{
  "$defs": {
    "$items": {
      "type": "array",
      "default": [],
      "items": { "$ref": "#/$defs/TodoItem" }
    },

    "$remaining": "${this.$items.get().filter(i => !i.done).length}",
    "$summary":   "${this.$remaining.get()} of ${this.$items.get().length} remaining",

    "addItem":    { "$prototype": "Function", "$src": "./todo-handlers.js" },
    "toggleItem": { "$prototype": "Function", "$src": "./todo-handlers.js" },
    "clearDone":  { "$prototype": "Function", "$src": "./todo-handlers.js" }
  }
}
```

```js
// todo-handlers.js
export function addItem() {
  this.$items.set([
    ...this.$items.get(),
    { id: Date.now(), text: 'New item', done: false }
  ]);
}
export function toggleItem(id) {
  this.$items.set(
    this.$items.get().map(i => i.id === id ? { ...i, done: !i.done } : i)
  );
}
export function clearDone() {
  this.$items.set(this.$items.get().filter(i => !i.done));
}
```

The visual builder offers "Extract to external file" on any `$prototype: "Function"` entry with a `body`, and the inverse "Inline from file" when the external function is simple enough to bring back.

---

## 11. Updated Compiler Validation Rules

### Shape validation

| Condition | Severity | Message |
|---|---|---|
| `signal: true` on naked value | Error | `"'$key' is a naked value — signal: true is implied and must not be declared"` |
| `signal: true` on JSON Schema with `default` | Error | `"'$key' has a default — signal: true is implied and must not be declared"` |
| `signal: true` on template string | Error | `"'$key' is a template string — signal: true is implied and must not be declared"` |
| `body` and `$src` both declared | Error | `"'key' declares both body and $src — these are mutually exclusive"` |
| `$prototype: "Function"` with neither `body` nor `$src` | Error | `"'key' is a Function prototype with no body or $src"` |
| Plain string in `$defs` the author may have intended as computed | Hint | `"'$key' is a plain string signal. Add \${} to make it a computed signal."` |

### Template string validation (anywhere in document)

| Condition | Severity | Message |
|---|---|---|
| Contains `;` | Error | `"Template string '$key' contains a statement separator. Use $prototype: Function with body for multi-statement logic"` |
| Contains `=` outside comparison operators | Error | `"Template string '$key' contains an assignment. Use $prototype: Function with body"` |
| References `this.$x` where `$x` is not in `$defs` | Warning | `"Template string '$key' references undeclared signal '$x'"` |

### Function body validation

| Condition | Severity | Message |
|---|---|---|
| `body` is not valid JavaScript | Error | `"body of '$key' is not valid JavaScript: [parse error detail]"` |
| Handler body contains non-void `return` | Warning | `"Handler '$key' returns a value. Did you mean to add signal: true?"` |
| Computed body (`signal: true`) has no `return` | Warning | `"Computed '$key' has no return statement and will always return undefined"` |
| `body` contains `import` or `export` | Error | `"body of '$key' cannot contain import or export. Use $src for external modules"` |
| `body` contains `eval` or `new Function` | Error | `"body of '$key' cannot contain eval or new Function"` |

---

## 12. Updated File Checklist

When creating a new JSONsx component:

- [ ] `component.json` declares `$schema` and `$id`
- [ ] Simple mutable state uses naked values — no `signal: true`, no wrapper object needed
- [ ] State needing constraints or documentation uses expanded JSON Schema form with `default`
- [ ] Shared type shapes use `PascalCase` pure type definitions (no `default`, no `$prototype`)
- [ ] Derived values use template strings with `${}` — no `$compute`, no `$deps`
- [ ] Template strings used directly in element properties for single-use reactive bindings
- [ ] `$ref` used for signals referenced in multiple places or complex enough to deserve a name
- [ ] All functions declared with `$prototype: "Function"` and either `body` or `$src`
- [ ] Handler `body` strings do not include non-void `return`
- [ ] Computed `body` strings (`signal: true`) include `return`
- [ ] `signal: true` declared only on `$prototype: "Function"` computed entries and external class entries
- [ ] External `$src` paths are valid module specifiers resolvable from the `.json` file location
- [ ] Cross-component state is passed via `$props`, not assumed from the parent scope
- [ ] Server-timed external class entries use only statically resolvable configuration

---

## 13. Codebase Refactoring Targets

### `jsonsx.js` (runtime)

- **Remove:** `loadHandlers()` and all `$handlers` document-level processing
- **Remove:** `makeComputed()` using JSONata
- **Remove:** JSONata import
- **Update:** `buildScope()` — implement §9 shape detection:
  - Naked scalar/array/object → `Signal.State(value)`
  - JSON Schema with `default` → `Signal.State(default)`, schema keywords stripped
  - JSON Schema without `default` → no-op (pure type definition)
  - String with `${}` → `Signal.Computed` from template literal
  - `$prototype: "Function"` + `body` → named function, bound to scope
  - `$prototype: "Function"` + `$src` → dynamic import, named export, bound to scope
  - `$prototype: "Function"` + `signal: true` → `Signal.Computed` wrapping above
  - `$prototype: "ClassName"` → existing external class path (unchanged)
- **Update:** element tree rendering — detect `${}` in any string property; emit reactive effect instead of one-time assignment

### `compiler.js` (compiler)

- **Remove:** JSONata import and evaluation
- **Remove:** `$handlers` document-level processing
- **Add:** `detectShape(key, value)` — §9 shape detection algorithm
- **Add:** `compileTemplateString(str, location)` — validates expression, extracts `this.$` deps, emits `Signal.Computed` or `effect()`
- **Add:** `compileFunctionBody(entry, key)` — validates via acorn, emits named function declaration
- **Add:** `validateDefsShape(defs)` — full validation per §11
- **Add:** `stripSchemaKeywords(entry)` — removes tooling-only JSON Schema properties before emission
- **Add:** `emitTypeDeclarations(defs)` — generates `.d.ts` entries from JSON Schema annotations
- **Update:** document tree walk — apply `${}` detection to all string values in the entire document, not only `$defs`
- **Update:** `isDynamic()`:
  - String with `${}` anywhere → dynamic
  - `$prototype: "Function"` → dynamic
  - External class with `timing: "compiler"` → static
  - Naked value with no `${}` references in document → static
- **Update:** bundle manifest — collect unique `$src` values across all `Function` entries; emit one import per unique path

### `todo-app.json` (example)

- Rewrite per §10 inline version
- Remove all `$handler: true`, `$handlers`, `$compute`, `$deps`, `signal: true` on state
- Use naked `$items` array with JSON Schema expanded form for typing
- Use template strings for all derived values
- Inline all handlers using `body`

### `todo-app.js` (example sidecar)

- Delete — all logic is inlined in the updated example
- Replaced by the sidecar variant shown in §10 as the "external functions" reference

### `jsonsx-spec.md` (root spec)

| Section | Change |
|---|---|
| §3.1 Root Structure | Remove `$handlers` from field table |
| §3.2 JSON Schema Dialect | Add JSON Schema type vocabulary as first-class; update reserved keywords list |
| §4 Component Pair Model | Reframe as optional: sidecar driven by `$src` on Function entries, not a document-level declaration |
| §5 Signal Declarations | Replace entirely with five-shape grammar from §2 of this amendment |
| §9 Event Handlers | Remove `$handler: true`; replace with `$prototype: "Function"` |
| §13 Computed Expressions | Replace JSONata `$compute` section with template string convention and universal `${}` reactivity |
| §17 Runtime Pipeline | Remove JSONata from Step 2; update `buildScope()` to five-shape detection |
| §18 Reserved Keywords | Apply §7 of this amendment |
| §19.7 | Remove JSONata entry; add JSON Schema 2020-12 type vocabulary note |
| Appendix B | Remove `jsonata`; two-entry dependency table |
| Appendix C | Replace with §12 checklist of this amendment |

---

## 14. Future Considerations (Out of Scope)

The following capabilities are deliberately deferred:

**Runtime validation:** JSON Schema annotations on `$defs` entries are positioned for runtime validation but not implemented in this amendment. When added, the compiler will emit an opt-in validation wrapper around each `Signal.State` that calls a compiled JSON Schema validator on `set()`. Development mode will validate by default; production builds will strip validation.

**LSP extension:** A dedicated JSONsx language server can consume the JSON Schema annotations in `$defs` to provide cross-property type checking — e.g., verifying that a `$ref` binding to a `number` signal assigned to `textContent` (which expects a string) produces a warning. This is implementable on top of the existing JSON Schema LSP infrastructure with no spec changes.

---

*JSONsx `$defs` Unified Grammar Amendment v0.2.0-draft*
