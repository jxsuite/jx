---
title: "Embedding the runtime in your app"
description: "Mount a Jx document inside your own TypeScript application: pass host state in as scope, call host functions from handlers, and dispose it cleanly."
spec:
  - embedding.md#2 # the mount contract
  - embedding.md#3 # the host scope
  - embedding.md#4 # host functions and events
  - embedding.md#5 # per-mount context
  - embedding.md#6 # preloading bundled documents and modules
  - embedding.md#6.2 # TypeScript function bodies
  - embedding.md#6.3 # TypeScript modules and document scripts
  - embedding.md#7 # redefining an element
code:
  - packages/runtime/src/runtime.ts
  - packages/runtime/src/body-eraser.ts
  - packages/erase/src/module-loader.ts
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

## Bundle documents and modules

A bundled document still names the things it depends on by URL and by `$src`. Register them before you mount, and nothing is fetched.

```ts
import { preloadDocument, preloadModule } from "@jxsuite/runtime";
import button from "./components/jx-button.json" with { type: "json" };
import * as behaviors from "./behaviors/menu.ts";

preloadDocument("jx-ui:/components/jx-button.json", button);
preloadModule("jx-ui:/behaviors/menu.ts", behaviors);
```

A document that lists `{ "$ref": "jx-ui:/components/jx-button.json" }` in `$elements`, or `"$src": "jx-ui:/behaviors/menu.ts"` on a function, now resolves from those registrations.

A module you would rather not load until something needs it takes a function instead of a namespace. The loader runs once, the first time a document names the specifier, and the bundler splits the import into its own chunk:

```ts
preloadModule("jx-ui:/behaviors/menu.ts", () => import("./behaviors/menu.ts"));
```

The kit ships this table ready-made as `KIT_LOADERS` from `@jxsuite/ui/loaders`, the same specifiers as `KIT_MODULES` with every entry a thunk.

`preloadModule` is also the only way a `timing: "server"` entry runs in your process. For any specifier you have not registered, the runtime posts the call to your host's `/__jx_server__` proxy and never imports the module. A host that answers no proxy leaves such an entry `null` and logs the failed call, and `skipServerFunctions` (below) skips the entries without a request.

## Run TypeScript function bodies

A function body may be TypeScript. The runtime carries no stripper, so your host hands it one. Build `@jxsuite/erase/browser` as its own file beside the runtime, then either install it now:

```ts
import { setBodyEraser } from "@jxsuite/runtime";
import { eraseBody } from "@jxsuite/erase/browser";

setBodyEraser(eraseBody);
```

or let the runtime fetch it the first time a document needs it:

```ts
import { setBodyEraserLoader } from "@jxsuite/runtime";

setBodyEraserLoader(() => import("/assets/eraser.js"));
```

With a loader, a page whose bodies are all JavaScript downloads nothing more. If you render a document you built yourself rather than one the runtime resolved, call `await prepareBodies(doc)` before rendering it, so the loader runs first. Install the eraser eagerly instead when you bind handlers from documents you edit live with no step in which to fetch it.

## Load TypeScript modules and document scripts

A `$src` may name a `.ts` file, and a document may carry its own client module as text in `$script.client`. A browser imports neither as it is, so the runtime asks your host for a module loader. The same `@jxsuite/erase/browser` file exports it. If you set `setBodyEraserLoader`, you are done: the runtime fetches that file the first time a document needs a module loaded and installs the loader with the eraser. To install it now instead:

```ts
import { setModuleLoader } from "@jxsuite/runtime";
import { loadModule } from "@jxsuite/erase/browser";

setModuleLoader(loadModule);
```

The loader fetches a module's text, erases its types and imports the result from a `blob:` URL, loading each relative `.ts` import the same way. It reports four things as errors that name the module: an import cycle, a package import when you gave no `setNpmModuleResolver`, TypeScript that has to be compiled rather than erased, and a document with no client script. A page whose Content-Security-Policy refuses `blob:` in `script-src` cannot use it.

A document you pass to `mount()` as an object runs its client script too, and its relative imports resolve from the mount's `base`. Its server script cannot run, because your backend has no file to read it from. A document with a server script is one to read with `resolve(url)`, or to hand to `Jx(url)`, so the runtime knows where it came from.

To bundle a document's client module yourself, register it under the specifier the runtime gives it, which is the document's absolute URL between `jx-script:` and `#client`:

```ts
preloadModule("jx-script:https://app.example/components/counter.json#client", counterModule);
```

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

One setting is page-wide because the custom element registry is: `setProjectFormulas(projectState)`. A host that renders a Jx project calls it once with the project file's `state`, before it renders, and every component defined on the page can then call the project's pure [formulas](/docs/framework/concepts/props-and-scope#project-formulas). Only the formulas are taken, never the project's data. Pass `null` to clear it. A host that mounts documents belonging to no project has no reason to call it.

A template binding that throws, such as `${state.posts.length}` before the posts load, renders nothing and fills in once its data arrives. To check whether a document renders at all, await `lookupsSettled()` after `buildScope` so templates read real data (put your own time limit on it, because a lookup can hang), then install `setTemplateErrorHandler((error, source) => …)` around the render to receive every such error, and pass `null` afterwards. Without a handler, a failing template logs one console warning, held until any class lookup, `timing: "server"` call or `Request` in flight has settled, so a template that only read its data too early logs nothing. A handler is not held: it hears those early reads too.

To decide lookup by lookup instead of all or nothing, install `setRemoteLookupHandler(handler)`. The runtime asks it each time an automatic `Request` or a `timing: "server"` call would start, and tells it the lookup's `kind`, the state `key`, the `scope` it belongs to and its `request` (a request's `method`, `url`, `headers` and `body`, or a server function's `$src`, `$export` and `arguments`, with every binding resolved). The handler also receives `run`, which starts the lookup and returns its promise. Return `{ value }` to answer at once with nothing fetched, a promise (for example `run()`) to stand for the lookup, or `null` to start nothing and leave the entry as it is. A host that redraws one document many times uses it to fetch once and reuse the answer:

```ts
const answers = new Map<string, JsonValue>();
setRemoteLookupHandler((lookup, run) => {
  if (lookup.kind === "request" && lookup.request.method !== "GET") {
    return null;
  }
  const key = JSON.stringify(lookup.request);
  if (answers.has(key)) {
    return { value: answers.get(key)! };
  }
  return run().then((value) => (answers.set(key, value), value));
});
```

The handler is page-wide, like the two skip settings it refines, and is not asked about an entry they suppress or about a `manual` request. Pass `null` to remove it. A lookup started through `run` is yours: it carries no abort signal, so it finishes even when the binding that asked for it is gone, and you can keep its answer. To give up a promise you returned without reporting a failure, reject it with an error named `AbortError`: the entry is left as it is and nothing is logged.

## Hooks for an editor

A host that draws a document so people can edit it, rather than use it, can ask a few more things of a mount. Each is off unless you name it, and a mount without them renders exactly as before.

| Option             | What it does                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| `onNodeCreated`    | Called with each element as it is created, its document path, its definition and its scope.                 |
| `onNodeMoved`      | Called when a keyed repeater row is reused at a new index, with the row's root node and its new path.       |
| `rowLimit`         | The most rows any one repeater draws. Items past it are not rendered at all.                                |
| `emptyRow`         | Called for a repeater with no items. Return a sample item to draw one row from it, or `undefined` for none. |
| `onListReconciled` | Called each time a repeater settles, with its path and `{ count, rendered, empty, nodes }`.                 |

```ts
const handle = await mount(doc, target, {
  rowLimit: 20,
  emptyRow: (arrayDef, path) => ({ data: { title: "Sample title" } }),
  onListReconciled: (path, { count, rendered, empty, nodes }) => {
    // count: the items the list resolved to, after filter and sort
    // rendered: the rows on the page, the sample row included
    // empty: true when the list resolved to no items
    // nodes: the root node of each row on the page, in order
  },
});
```

`onNodeMoved` reports the row's root only. The elements inside the row moved with it and are not reported, so a host that keeps a path on each of them rewrites the row's part of those paths itself. A row is at `[…repeater, "map", index]`.

`rowLimit` reaches nested repeaters too, and each one is capped for itself. It applies after `emptyRow`, so a limit of `0` draws no rows at all. The sample row from `emptyRow` is replaced by real rows as soon as the list has any, and returns when the list empties again.

Elements that a template adds are reported to `onNodeCreated` at the template's own position followed by their index in the array it resolved to: `[…, "children", 2, 0]` for the first node of a templated string at `children[2]`. That path names no node in the document, because the document holds a string there.

To draw one row again from a changed template, render the new root yourself with the scope `onNodeCreated` reported for the old one, then hand it to the list with `replaceListRow`:

```ts
import { replaceListRow, runScoped, renderNode } from "@jxsuite/runtime";

const { result: next, stop } = runScoped(() => renderNode(template, rowScope));
if (!replaceListRow(current, next, stop)) {
  // `current` is not a row's root. Replace it in the DOM yourself.
}
```

The list holds each row by its root node. It moves that node when a keyed row is reused at another index and removes it when the item goes. A root you swap in without telling the list is left behind at the next redraw, and the old one comes back. After `replaceListRow` the list holds `next` for the row. The row keeps its key, its item and its index, and no other row is touched. The effects of the old node are stopped, and `stop` is called once when the row is removed.

To read the value a template would have without rendering it, call `evaluateTemplateValue(template, scope)`:

```ts
import { evaluateTemplateValue } from "@jxsuite/runtime";

evaluateTemplateValue("${state.posts.length}", handle.scope); // 3
evaluateTemplateValue("${state.posts.length} posts", handle.scope); // "3 posts"
```

A template that is one whole `${…}` answers the expression's own value, and anything else answers a string, which is the same line the renderer draws. The expression sees `state`, `$site` and `$page`, and inside a repeater row `$map`, `item` and `index`: pass the scope `onNodeCreated` handed you for a node in that row. It throws whatever the expression throws.

## Redefine an element

A host that lets people edit a component while it is in use can replace its definition without reloading the page:

```ts
import { redefineElement, elementDefinition } from "@jxsuite/runtime";

await redefineElement(updatedDoc, "jx-ui:/components/");
elementDefinition("jx-button"); // { doc: updatedDoc, base: "jx-ui:/components/" }
```

An instance created after the call renders the new definition. One already on the page keeps what it rendered, with its bindings still live, until you re-mount it. Use `mount()`'s `elements` to find the roots that used the tag and dispose and mount them again. A tag that was never defined is defined by the same call.

One thing does not change: `observedAttributes`. The browser fixes that list when a custom element is first defined, so a changed list is reported on the console and only takes effect after a page load.

## Change an instance's props in place

A host that edits a document can write a changed `$props` block into an instance that is already on the page, instead of rendering the instance again:

```ts
import { updateInstanceProps } from "@jxsuite/runtime";

if (!updateInstanceProps(el, { heading: "Before" }, { heading: "After" })) {
  // Render the instance again from the document.
}
```

Pass the block the instance was drawn with and the block it should show now. When the call answers `true`, the props that changed were written and the component's own bindings redrew what reads them. The element, its slotted children and the components nested in it are the same nodes as before.

The call is deliberately narrow. It answers `false` whenever a write could show something a fresh render would not. Render the instance again in that case. The cases are:

- The element is not a connected component, or the block did not change.
- A changed prop is not a plain string, number or boolean in both blocks. That rules out objects, arrays, `null`, a `$ref` and a `${…}` template.
- A changed prop has a name every element has, such as `hidden` or `textContent`. A declared `title`, `lang`, `id`, `slot` or `role` given a string is written.
- A removed prop has no plain declared default, or its observed attribute is on the element.
- The component, or one it draws, declares `onMount`. That hook ran once with the old values.
- The component was redefined after this instance connected. The instance still draws the old definition.
- The component, or one it draws, reads something only once, when it renders: a tag chosen by an expression, a prop copied into a `$` local or bound to an `id` by `$ref`, a slot inside a `$switch` case or a mapped list, a slot with bound fallback text, or children drawn from a binding.
- The component, or one it draws, keeps state in a store, a request or an external class.
- The component passes a bound value to a nested component as text, as slotted content or as an attribute the nested component does not observe.
- The component can draw itself.
- A binding throws on the new value, or the change reaches a mapped list. The props are already written by then, and your render replaces the instance.

State the component changed itself, such as a counter its own button moved, is kept.

## Dispose

Call `handle.dispose()` when the host removes the surface. It removes the root first, then stops every effect the render created and releases the styles the mount adopted, then runs the document's `onUnmount` if it declares one. Removing the root first means the release writes to elements that have already left the page, so the browser does not re-style them on the way out; it also means `onUnmount` sees a detached root, as a component's own `onUnmount` does. Calling it twice is safe. Passing a `signal` does the same when the signal aborts.
