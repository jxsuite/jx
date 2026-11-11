---
title: "Functions and modules"
description: "Function prototype entries in Jx: inline handlers, computed bodies, a document's own script, $src modules, and how JavaScript reads and writes state."
spec:
  - spec.md#4.2
  - spec.md#4.3
  - spec.md#5.5
  - spec.md#5.3 # Function properties, parameter binding, $src classification
  - spec.md#23.1 # TypeScript in a body, erased as a document is read
  - spec.md#23.2 # A document's own modules
code:
  - packages/schema/src/function-role.ts
  - packages/schema/defs/function-def.schema.ts
  - packages/schema/src/jxn/virtual-types.ts
  - packages/erase/src/core.ts
  - packages/erase/src/index.ts
  - packages/compiler/src/erased.ts
  - packages/runtime/src/body-eraser.ts
  - packages/compiler/src/targets/compile-element.ts
  - packages/compiler/src/targets/compile-client.ts
  - packages/runtime/src/runtime.ts
  - packages/schema/src/document-scripts.ts
  - packages/compiler/src/site/document-scripts.ts
  - packages/compiler/src/site/bun-plugin.ts
  - packages/erase/src/module-loader.ts
  - packages/server/src/server-script.ts
  - packages/studio/src/canvas/canvas-scripts.ts
  - packages/studio/src/canvas/iframe-scripts.ts
---

# Functions and modules

> **Studio writes this format for you.** The Monaco editor behind every function body ([Code editing](/docs/studio/logic/code)) reads and writes these entries, and this page documents the JSON and the JavaScript contract around it.

A Function entry is a `state` entry with `$prototype: "Function"`, the top rung of the escalation ladder, where logic becomes JavaScript. Its code lives inline in a `body`, or in a **module** named by `$src`: the document's own script, a file, or an npm package. Prefer [expressions](/docs/framework/concepts/expressions) and [statements](/docs/framework/concepts/statements) first; reach for a function when structure runs out.

The smallest complete function is an inline handler:

```json
{
  "state": {
    "count": 0,
    "increment": { "$prototype": "Function", "body": "state.count++" }
  }
}
```

Bind it to an event like any handler: `"onclick": { "$ref": "#/state/increment" }`.

## Inline handlers

A `body` string is a raw function body. `state` is always in scope; `arguments` names any additional parameters, so an event handler names `event`:

```json
{
  "handleInput": {
    "$prototype": "Function",
    "arguments": ["event"],
    "body": "state.value = event.target.value"
  }
}
```

An event binding always calls the handler with the state and the event. The body is built with `state` first and your other declared names after it, so `state` binds **by name, not by position**, and the first other name receives the event. So `["event"]`, `["state", "event"]`, `["event", "state"]` and `["state"]` each bind exactly what they read, and a body may reference `state` whether or not it declared it. A later name is an ordinary argument: an event leaves it `undefined`, and `state.key(state, a, b)` from a template fills it. The same holds for a handler written inline on an `on*` property.

## Inline computed values

A function with only a `body` (no `arguments`) that returns a value acts as a computed, and the framework wraps it in `computed()` when it detects the entry is referenced reactively:

```json
{
  "titleClass": {
    "$prototype": "Function",
    "body": "return state.score >= 90 ? 'gold' : 'silver'"
  }
}
```

Only a `return` with a value on the same line makes an entry a computed. A bare `return;` is an early exit, so a handler that starts with a guard clause stays a handler:

```json
{
  "toggle": {
    "$prototype": "Function",
    "body": "if (state.locked) return; state.open = !state.open"
  }
}
```

## Modules

When a function outgrows a string, move it into a module and point `$src` at it. A module only one document uses is written in that document, as [its own script](#a-module-inside-the-document). A module several documents share is a `.js` or `.ts` file, and an installed package is an `npm:` specifier. Each entry resolves to the named export matching its key (override with `$export`):

```json
{
  "state": {
    "increment": { "$prototype": "Function", "$src": "../lib/counter.js" },
    "decrement": { "$prototype": "Function", "$src": "../lib/counter.js" },
    "validateEmail": {
      "$prototype": "Function",
      "$src": "npm:@myorg/validators",
      "$export": "validateEmail"
    }
  }
}
```

```js
export function increment(state) {
  state.count++;
}
export function decrement(state) {
  state.count = Math.max(0, state.count - 1);
}
```

A module's export is called exactly as its call site calls it: an event binding passes `(state, event)`, and `state.helper(a, b)` in a template passes `a` and `b`. Declared `parameters` document the export; they do not reorder its arguments.

When several entries share a `$src`, the module is imported once and its named exports extracted; module caching is automatic.

An `npm:` specifier names an export of an installed package. `jx build` bundles it into the site. A page rendered live (on the Studio canvas, or by an app embedding the runtime) imports it from wherever that host serves packages: the Studio dev server bundles it from your project's `node_modules`, and an app can answer with an import map.

An entry with a `$src` has no `body` to read, so its role follows its declaration and how the document uses it. Declare `parameters` and it stays a function wherever it is used. Otherwise, bind it to an event (on a child, or at a component's root beside `tagName`), invoke it as `state.helper(state)`, or name it a lifecycle hook, and it stays a function. Read it anywhere else, in a list's `items`, a `${}` interpolation or a property binding, and it becomes a computed value: what you get is the export's **return value**, recomputed when its inputs change, not the function itself. The export's own parameter count is never consulted, so a helper that only other JavaScript calls needs its `parameters` declared.

```json
{
  "state": {
    "leads": { "$prototype": "Request", "url": "/api/leads" },
    "openLeads": { "$prototype": "Function", "$src": "./leads.js" }
  },
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/state/openLeads" },
    "map": { "tagName": "li", "textContent": "${$map.item.name}" }
  }
}
```

```js
export function openLeads(state) {
  return (state.leads ?? []).filter((l) => l.open);
}
```

`items` reads `openLeads`, so it resolves to the filtered array and re-filters whenever `leads` arrives.

## Loading a module on first call

Add `"$lazy": true` to an entry with a `$src` and its module loads the first time the function is called, not with the page. The entry keeps its name, so call sites do not change, but the function now returns a promise. Use it for a module most visitors never reach, such as a search client, and only on an entry you call from a handler or a lifecycle hook: an entry read as a value would render a promise, so the build and Studio both refuse it.

```json
{
  "state": {
    "searchInit": {
      "$prototype": "Function",
      "$src": "npm:@jxsuite/search/client",
      "$lazy": true,
      "parameters": ["state"]
    }
  }
}
```

## A module inside the document

A function that needs imports or helpers does not have to live in a file of its own. A document can carry the module as text in `$script.client`, and an entry names it with `$src: "#client"`:

```json
{
  "tagName": "my-counter",
  "$script": {
    "client": "import { clamp } from \"./math.ts\";\n\nexport function bump(state: { count: number }): void {\n  state.count = clamp(state.count + 1, 0, 10);\n}\n"
  },
  "state": {
    "count": 0,
    "bump": { "$prototype": "Function", "$src": "#client", "$export": "bump" }
  },
  "children": [{ "tagName": "button", "onclick": { "$ref": "#/state/bump" }, "textContent": "Add" }]
}
```

Everything said above about a module's export holds for a script's export: how it is called, how its role is decided, and what `$lazy` does. What differs is where the module comes from.

- **It is TypeScript.** The text is an ordinary module with `import` and `export`.
- **It stands where the document stands.** A relative import resolves from the document's own folder, so `./math.ts` is the file beside the document.
- **It belongs to its document.** A page and its layout can each export a `bump` from their own script and each keeps its own. `jx build` writes one bundle per document.
- **Another module can import it.** `import { clamp } from "../lib/shared.jxn"` imports that document's client script.
- **A body cannot see into it.** An inline `body` reaches a script's function through the state entry that exports it, as `state.bump(…)`, and through nothing else.
- **`$lazy` rarely helps.** Every `#client` entry of a document shares one module, so a lazy entry defers nothing while another entry of the same document loads with the page. Give a function you want loaded late a `$src` file of its own.

`$script.server` is the same for server functions, named with `$src: "#server"`. See [Timing](/docs/framework/concepts/timing#server-the-rpc-function-boundary).

Keep using `$src` for an `npm:` package and for a module several documents share. The project file has no script, so an entry in its `state` cannot use `#client`.

In a `.jxn` document the script is a `script` node holding the module as plain multi-line text, and the entry is the one row `(export)bump`. See [Jx Notation](/docs/framework/concepts/jxn-files#a-documents-script).

`jx validate` and Studio's [Problems](/docs/studio/interface/problems-and-progress#checks-over-your-own-content) point out an entry whose `$src` is a relative path to a script file, because that module could be the document's own script. This is advice. Nothing is wrong with the document, `jx validate` still passes, and a module several documents share is right as a file. They point out a `$lazy` entry of a script that another entry loads with the page, for the reason in the list above.

### Where a script runs

`jx build` bundles a script. Studio's canvas, Live Preview and a page that calls `mount()` import it in the browser instead: the types are erased and what is left is imported, and each relative `.ts` import is loaded the same way. Three rules follow from that, and they hold for a `$src` that names a `.ts` file too.

- **Only types that can be removed.** `enum`, a value `namespace` and a parameter property need a compiler, so `jx build` refuses them in a script and names the document and the line.
- **Mark an import that is only a type.** Write `import type { Row } from "./row.ts"`, or `import { type Row, load } from "./row.ts"`. A name imported without `type` is kept, and the browser then asks `row.ts` for an export it does not have.
- **No import cycles.** Two `.ts` files that import each other build, and fail in the canvas and in Live Preview with an error that names both.

:::doc-note
In Studio, **Edit Script** opens a document's script in the Logic tab ([Code editing](/docs/studio/logic/code#a-documents-script)). The canvas runs a client script as its document was last saved, so save to see a change to one there. A function `body` is different: the canvas draws it as you type. A server function called from the canvas or Live Preview runs from the saved file as well.
:::

### Testing a script

A script's exports can be unit tested from the document. Add the plugin to your project's `bunfig.toml`:

```toml
[test]
preload = ["@jxsuite/compiler/bun-plugin"]
```

Then import the document in a Bun test. The plain path is its client script, and `?server` is its server script:

```ts
import { expect, test } from "bun:test";
import { bump } from "./components/my-counter.jxn";
import { history } from "./pages/index.jxn?server";

test("bump stops at ten", () => {
  const state = { count: 10 };
  bump(state);
  expect(state.count).toBe(10);
});
```

The plugin reads `.jxn` documents. The `?server` spelling exists for tests only: the build refuses a server script imported by code a browser runs.

## Structured bodies

A `body` may also be a JSON array of statements instead of a source string, which is multi-step logic that stays inspectable and visually editable. That form has its own page: [Statements](/docs/framework/concepts/statements).

## State access from JavaScript

Inside a `body` and a module's exports, `state` is the component's reactive scope, a proxy over every declared state entry and function. Read and write it directly; there are no `.get()`/`.set()` calls:

```js
// Read
const current = state.count;

// Write
state.count = current + 1;

// Mutate arrays in place — mutations are tracked
state.items.push(newItem);
state.items.splice(0, 1);

// Nested objects are tracked too
state.user.name = "Alice";
```

Every write triggers the bindings that read that value. See [Reactivity](/docs/framework/concepts/reactivity). `this` is never used in Jx-managed code; all component access goes through `state`.

## Declaring the interface

Optional metadata makes a function legible to tooling:

| Property      | Description                                                           |
| ------------- | --------------------------------------------------------------------- |
| `arguments`   | Parameter names as plain strings, after the implicit `state`          |
| `parameters`  | CEM-compatible parameter objects, a richer alternative to `arguments` |
| `type`        | The return value, as a JSON Schema or CEM `{ text }`                  |
| `emits`       | CEM `Event` objects this function dispatches                          |
| `description` | Documentation string, surfaced in Studio's completions                |

A parameter object can carry a `type`, and a body is checked against it ([A parameter's type](/docs/framework/concepts/type-checking#a-parameters-type)). The function's own `type` is for tooling and is not checked.

## How it works

At runtime, the scope builder recognizes the `$prototype: "Function"` shape and turns each entry into a callable on the reactive scope. Exports and bodies are invoked with `state` as their first argument; event bindings pass the DOM event second, as `(state, event)`. A body-only function referenced from a reactive position is wrapped in `computed()` instead, so it re-evaluates when the state it reads changes.

Functions marked `timing: "server"` are a separate mechanism: a plain `$src`/`$export` entry with no `$prototype`, executed across the RPC boundary. See [Timing](/docs/framework/concepts/timing).

## Rules

- `body` and `$src` are mutually exclusive. Declaring both fails the build, fails in Studio's canvas, and is reported by `jx validate`.
- A `body` may use TypeScript that can be removed without generating code: annotations, `as`, `!`, generics and type aliases. `jx build`, `jx validate`, Studio's canvas, its code editor and Live Preview accept it in any document format, and the editor saves it as you wrote it. `enum`, a value `namespace` and a module `import` are refused with the place they are written.
- Studio's code editor checks the types in a body against the page's `state` and lists the errors in Problems. Outside Studio, `tsc` checks the bodies and scripts of a `.jxn` document ([Type checking](/docs/framework/concepts/type-checking)). `jx build` runs neither, so a build still accepts a body with a type error.
- `state` is always reachable from a body, and a declared `state` receives it wherever it sits in the list. The first other declared name receives the event.
- `this` is never used. All component state goes through the `state` proxy.
- `$export` defaults to the entry's key name; a module's exports must be named exports.
- `$src: "#client"` names the document's own `$script.client`. A Function entry that names `#server` fails the build.
- Function entries use `camelCase` names, like all state entries.
- Only `$prototype: "Function"` may point `$src` at a `.js` file. Other prototypes require a `.class.json` (see [Data prototypes](/docs/framework/concepts/data-prototypes)).

## Related

- [Expressions](/docs/framework/concepts/expressions): the declarative rung below functions
- [Statements](/docs/framework/concepts/statements): structured bodies without JavaScript
- [Timing](/docs/framework/concepts/timing): server functions and the RPC boundary
- [Type checking](/docs/framework/concepts/type-checking): `tsc` and your editor over a document's scripts and bodies
- [Components](/docs/framework/concepts/components): where state and functions are declared
- [Code editing in Studio](/docs/studio/logic/code): the editor for bodies and scripts
