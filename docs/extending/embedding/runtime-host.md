---
title: "Embedding the runtime in your app"
description: "Mount a Jx document inside your own TypeScript application: pass host state in as scope, call host functions from handlers, and dispose it cleanly."
spec:
  - embedding.md#2 # the mount contract
  - embedding.md#3 # the host scope
  - embedding.md#4 # host functions and events
  - embedding.md#5 # per-mount context
  - embedding.md#6 # preloading bundled documents and modules
  - embedding.md#7 # redefining an element
code:
  - packages/runtime/src/runtime.ts
---

# Embedding the runtime in your app

`@jxsuite/runtime` renders a Jx document into any node your application owns. The `mount()` function is the entry point for a host that keeps its own state in TypeScript and wants a document to render and react to it. This is how Jx Studio draws its own chrome.

## Mount a document

```ts
import { mount } from "@jxsuite/runtime";
import menu from "./surfaces/menu.json" with { type: "json" };

const handle = await mount(menu, document.getElementById("menu-host")!, {
  scope: { rows, run, formatBinding },
});
```

`mount()` appends the rendered root to the target and returns a handle. The handle carries the live `scope`, the `root` node, the set of custom-element tags the render used as `elements`, and a `dispose()` function.

The document is an object. Import it as JSON when it ships in your bundle, or call `resolve(url)` first when it lives on a server.

## Pass state in

Everything you put in `scope` is visible to the document as `state.<name>`. Reactive records, refs and computed values stay live, so a change on the host side updates the render.

```ts
import { reactive } from "@vue/reactivity";

const model = reactive({ label: "Untitled" });
await mount(doc, host, { scope: { model } });
model.label = "Home"; // the document's `${state.model.label}` updates
```

Two rules apply. A `state` entry declared by the document wins over a host member of the same name. Keys that begin with `$` or `#` belong to the runtime and are refused.

:::doc-note
The host and the runtime need one copy of `@vue/reactivity`. Pin the same exact version the runtime uses and bundle once. A second copy renders fine but never tracks.
:::

## Call host functions

A handler can name a host function directly. It receives the scope and the event, like any function in `state`.

```json
{ "tagName": "button", "onclick": { "$ref": "#/state/onPress" } }
```

To pass arguments, use a `call` expression. The values arrive positionally, and a method keeps the object it belongs to as `this`.

```json
{
  "tagName": "button",
  "onclick": {
    "$expression": {
      "operator": "call",
      "target": { "$ref": "#/state/commands/run" },
      "value": ["file.save", { "mode": "preview" }]
    }
  }
}
```

## Listen for events

A document reports back with a `dispatchEvent` statement. When the body runs from a DOM event, the event dispatches from the element that handled it. When it runs without one, for example a function called with arguments, the event dispatches from the mounted root. Listen on the node you passed as the target and set `bubbles` in the document.

```json
{
  "notify": {
    "$prototype": "Function",
    "parameters": ["what"],
    "body": [{ "dispatchEvent": "jx-notify", "detail": { "$ref": "$args/what" }, "bubbles": true }]
  }
}
```

```ts
host.addEventListener("jx-notify", (event) => {
  console.log((event as CustomEvent).detail);
});
```

## Bundle documents and sidecars

A bundled document still names the things it depends on by URL and by `$src`. Register them before you mount, and nothing is fetched.

```ts
import { preloadDocument, preloadModule } from "@jxsuite/runtime";
import button from "./components/jx-button.json" with { type: "json" };
import * as behaviors from "./behaviors/menu.ts";

preloadDocument("jx-ui:/components/jx-button.json", button);
preloadModule("jx-ui:/behaviors/menu.ts", behaviors);
```

A document that lists `{ "$ref": "jx-ui:/components/jx-button.json" }` in `$elements`, or `"$src": "jx-ui:/behaviors/menu.ts"` on a function, now resolves from those registrations.

## Configure each mount

Options that used to be page-wide settings are read per mount:

| Option                | What it controls                                                        |
| --------------------- | ----------------------------------------------------------------------- |
| `base`                | The URL that relative references in the document resolve against.       |
| `media`               | Named breakpoints for `@--name` style blocks.                           |
| `resolver`            | A function that answers a document URL for this mount, before fetching. |
| `skipServerFunctions` | Suppress `timing: "server"` entries.                                    |
| `skipAutoRequests`    | Suppress automatic `Request` fetches.                                   |
| `signal`              | An `AbortSignal`; aborting disposes the mount.                          |

A resolver answer is private to its mount. It never enters the shared cache, so two mounts can answer the same URL differently.

## Redefine an element

A host that lets people edit a component while it is in use can replace its definition without reloading the page:

```ts
import { redefineElement, elementDefinition } from "@jxsuite/runtime";

await redefineElement(updatedDoc, "jx-ui:/components/");
elementDefinition("jx-button"); // { doc: updatedDoc, base: "jx-ui:/components/" }
```

An instance created after the call renders the new definition. One already on the page keeps what it rendered, with its bindings still live, until you re-mount it. Use `mount()`'s `elements` to find the roots that used the tag and dispose and mount them again. A tag that was never defined is defined by the same call.

One thing does not change: `observedAttributes`. The browser fixes that list when a custom element is first defined, so a changed list is reported on the console and only takes effect after a page load.

## Dispose

Call `handle.dispose()` when the host removes the surface. It stops every effect the render created, runs the document's `onUnmount` if it declares one, removes the root, and releases the styles the mount adopted. Calling it twice is safe. Passing a `signal` does the same when the signal aborts.
