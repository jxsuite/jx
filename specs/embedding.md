# Jx Embedding Specification

## Mounting Documents in an Imperative Host

**Version:** 0.1.1\
**Status:** Implemented\
**Updated:** 2026-09-02\
**License:** MIT

Companion to [spec.md](./spec.md) §4, §13 and §16. Defines how an application written in ordinary TypeScript hosts Jx documents: how it mounts one into a node it owns, how its own state and functions reach the document, how the document reaches back, and what a mount may configure for itself rather than for the page. Jx Studio's chrome is the first such host; a site that embeds a Jx component beside a foreign framework is the second.

---

## 1. Overview

> **Status: Implemented.** §2–§8 are implemented; `redefineElement` (§7) closed the last gap.

The interpreter's original entry point, `Jx(source, target)`, was written for a page that owns the whole document: it fetched, registered elements, seeded page-wide settings and appended. A host that renders many documents beside code of its own needs three things that entry point did not give:

1. **A disposer.** Every binding a render creates is a reactive effect. A host that removes a root without stopping them leaks every one.
2. **A way in and a way out.** The host's records and functions have to be readable and callable from a document, and a document has to be able to tell the host something happened, without either side importing the other.
3. **Configuration per mount, not per page.** `$media`, the reference base, where documents come from and which side effects to suppress are answers a shell gives differently for each root it hosts.

`mount()` is that entry point. `Jx()` is now defined in terms of it and keeps its contract.

## 2. The Mount Contract

> **Status: Implemented.**

### 2.1 `mount(doc, target, options)`

```ts
const handle = await mount(doc, target, {
  scope: { workspace, run, formatBinding }, // §3
  base: "jx-app:/surfaces/", // §5
  media: { "--md": "(min-width: 768px)" },
  resolver: (url) => bundled.get(url),
  signal: controller.signal,
  onNodeCreated: (el, path, def, state) => {},
});
handle.scope; // the live reactive scope
handle.root; // the rendered root, already appended to target
handle.elements; // ReadonlySet<string>: custom-element tags this render instantiated
handle.dispose(); // idempotent
```

`doc` is a document **object**. A host that holds a URL resolves it first with `resolve()`; a host that bundled its documents imports them as JSON and hands them over as they are (§6). `target` is any `ParentNode`; the root is appended, never replaced into it, so a host may mount several documents into one node.

The sequence is fixed: the host scope is validated (§3), the document's `$elements` are registered depth-first and its `$head` entries injected, the scope is built with the host's members merged in, the tree is rendered inside a detached effect scope, the root is appended, and `onMount` runs. `elements` is filled by the render itself, so a tag reached only through a `$switch` case or a mapped row that renders later is added when it renders.

### 2.2 Disposal

`dispose()` stops every effect the render created, calls `onUnmount` if the document declares one and the root was ever attached, and removes the root from its parent. Rules the mount adopted into the document's stylesheet (spec.md §9.6) are released by the same scope, so `documentStyleText()` no longer reports them. Calling it twice is a no-op.

`signal` ties disposal to an `AbortSignal`. Aborting after the mount disposes it; a signal that is already aborted when `mount()` runs renders and then disposes without attaching, and `onMount` never runs.

The disposer belongs to this module's reactivity instance. A host MUST NOT wrap the render in an effect scope of its own copy of `@vue/reactivity`: scope collection is per module instance, so such a scope collects nothing and its `stop()` leaks every binding (spec.md §16.4, `runScoped`).

### 2.3 `Jx()`

`Jx(source, target, options)` resolves a URL or accepts an object, seeds the page-wide `$media` fallback from the document when it declares one, and mounts. It returns the scope, as it always has, and honours `options.signal`. Nothing that ran before continues to run differently; a page that owns its whole document loses nothing by staying on it.

## 3. Host Scope

> **Status: Implemented.**

`options.scope` is an object whose members are merged into the raw scope **before** the document's own `state` passes run. Any value is admitted: a `reactive()` record, a `ref`, a `computed`, a plain object, a function, a scalar.

- **A document `state` entry of the same name wins.** The document is the authority on what its scope contains; the host fills in what the document did not declare.
- **Keys beginning with `$` or `#` are refused** with a `TypeError` before anything renders. `$media` and `$map` are runtime vocabulary, `$`-prefixed names are the render's own locals, and `#`-prefixed entries are private state (spec.md §5.6).
- **A ref unwraps on read**, as it does for a `state` entry: `${state.count}` reads a host `ref(1)` as `1` and tracks it.
- **Tracking is per reactivity instance.** A host record is live inside a document only if it was made by the same `@vue/reactivity` module the runtime imports. A host that pins the same exact version and bundles once satisfies this; a second copy of the package silently does not.

Members are read through the scope proxy, so a host record handed in raw is returned proxied and a document's writes to it reach the host's object.

## 4. Host Functions and Events

> **Status: Implemented.**

### 4.1 Handler position

A handler that names a host function directly — `"onclick": { "$ref": "#/state/onPress" }` — receives `(scope, event)`, the contract every scope function has (spec.md §4.3). The host function sees the same proxy `mount()` returned.

### 4.2 Through `call`

A `call` expression (spec.md §19.4c) invokes a host function with its `value` operands as positional arguments, and with **the object that owns the pointer's last segment as its receiver**: `{ "$ref": "#/state/commands/run" }` calls `commands.run(...)` with `this` bound to `commands`, `#/state/run` binds the scope itself, `$map/item/fn` binds the item. This is what the compiled tier's lowering (`s.commands.run(...)`) has always done, so a method that reads `this` behaves alike in both tiers.

```json
{
  "onclick": {
    "$expression": {
      "operator": "call",
      "target": { "$ref": "#/state/commands/run" },
      "value": ["file.save", { "mode": "preview" }]
    }
  }
}
```

A bare object operand is a literal (spec.md §19.2), so an options bag passes through as written.

### 4.3 Events out

A `dispatchEvent` statement (spec.md §20.2) run **from an event** dispatches from that event's `currentTarget`, as before. A body run **without one** — a parameterised function invoked through `call`, a lifecycle hook — dispatches from the mount's root, or from the host element when the body belongs to a custom element. The host listens on the node it passed as `target`; a document that means to be heard sets `bubbles: true`.

```json
{
  "notify": {
    "$prototype": "Function",
    "parameters": ["what"],
    "body": [{ "dispatchEvent": "jx-notify", "detail": { "$ref": "$args/what" }, "bubbles": true }]
  }
}
```

## 5. Per-Mount Context

> **Status: Implemented.**

### 5.1 What a context carries

Every mount builds a context from its options and threads it through scope construction and rendering, where the module-level setters used to be read. The setters remain as the defaults a context inherits when an option is absent, so the canvas iframe and every existing direct caller are unchanged.

| Option                | Replaces                   | Reach                                                                                                                  |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `base`                | `location.href`            | `$ref` cases of a `$switch`, `$elements`, `$head`, `$src`, asset paths                                                 |
| `media`               | `setRootMedia()`           | the `$media` fallback for a document, and the components it renders, that declare `@--name` blocks but no own `$media` |
| `resolver`            | the shared fetch cache     | every document resolved for this mount: a `$switch` case, an `$elements` ref                                           |
| `skipServerFunctions` | `setSkipServerFunctions()` | `timing: "server"` entries of this mount's scopes                                                                      |
| `skipAutoRequests`    | `setSkipAutoRequests()`    | automatic `$prototype: "Request"` fetches of this mount's scopes                                                       |

`media` defaults to the document's own `$media` when it declares one, so a document that carries its breakpoints needs no option. A resolver hit is served for this mount and **never enters the shared cache**: two mounts may answer the same URL differently, and a later `resolve()` with no context still fetches.

### 5.2 What stays module-global

Three things are per realm by nature and are not in a context: the custom-element registry (`customElements` is one per window, so `defineElement` is too), the `$src` module cache (an ES module namespace is one per specifier), and the canvas transposition switches (`setCanvasViewportTranspose`, `setCanvasDelinkAnchors`, `setCanvasDelinkPopovers`, `setCanvasAssetResolver`, `setStampPropBindings`), which exist for the Studio canvas iframe — a realm whose runtime instance serves exactly one document at a time.

## 6. Preloading Bundled Documents and Modules

> **Status: Implemented.**

A host that ships its documents inside its own bundle imports them as JSON. Two seams let such documents keep naming their dependencies by URL and by `$src` without a network:

- **`preloadDocument(url, doc)`** seeds the resolve cache under `url` and, when it parses as one, under its absolute form, so a `$elements` entry or a `$switch` case pointing at that URL resolves to the object the host already holds, and `defineElement("<url>")` dedupes on the same key it would have fetched. A custom scheme (`jx-ui:/components/jx-button.json`) is a valid base for relative references.
- **`preloadModule(specifier, namespace)`** seeds the `$src` module cache under the specifier as the document spells it. The host imports the sidecar itself — which is what lets a bundler see it — and registers the namespace; the document's `$src` then resolves exactly as it would have from the network.

Both are process-wide, like the caches they seed. A host that must serve one URL differently per mount uses `resolver` (§5) instead.

## 7. Redefinition

> **Status: Implemented.** `redefineElement(doc, base)` and `elementDefinition(tag)` in `@jxsuite/runtime`; the generated class reads its definition through the registry at connection. Exercised by `packages/runtime/tests/redefine.test.ts`.

A host that authors its own components live needs to replace an element definition after it was registered and re-mount the roots that used it. `customElements.define` is one-shot, so the runtime reads a definition through a registry at connection time rather than from the class's closure, and exposes `redefineElement(doc, base)`; `mount().elements` names which roots a redefinition touches, and `elementDefinition(tag)` answers what a tag renders from now.

The contract has three edges, each deliberate. An instance connected after the call renders the new definition; one already on the page keeps the definition it rendered — its bindings stay live against its own state — until it is re-mounted, because tearing a connected instance down underneath its host is the host's decision, not the runtime's. `observedAttributes` stays as first defined, because the platform freezes it with the class; a changed list is reported on the console and takes effect only in a fresh realm. A tag not yet defined is defined, so a host may use one call for both.

## 8. Security

> **Status: Implemented** as a stated property.

A mounted document runs with the host's privileges. Templates and inline bodies are compiled with `new Function` (spec.md §21.3), so a host page requires `'unsafe-eval'` in its Content Security Policy for as long as it hosts the interpreter, and a document is executable input to be trusted as a script would be (spec.md §21.4). Jx Studio's shell is such a host and states the requirement rather than working around it. Nothing in this specification adds a sink: the root is placed with `append()`, events are real `CustomEvent`s, and no host-supplied string is ever interpreted as markup.

## 9. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). `@vue/reactivity` is a library and is prose in §3, not a row.

| Standard                                                                                  | Class       | Binds  | Evidence                                                                      | Note                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ----------- | ------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [WHATWG DOM](https://dom.spec.whatwg.org/)                                                | **Subset**  | §2, §4 | packages/runtime/src/runtime.ts, packages/runtime/tests/mount.test.ts         | An `AbortSignal` drives disposal and `ParentNode.append()` places the root (§2); a body run without an event dispatches a real `CustomEvent` from that root (§4). Not offered: `AbortSignal.reason`, or teardown driven by a `MutationObserver` on removal. |
| [ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/) | **Subset**  | §4     | packages/runtime/src/expression.ts, packages/runtime/tests/call-owner.test.ts | A `call` invokes its callee as `Function.prototype.apply` does, with the receiver the pointer's parent path names. Nothing else of the language's call forms (spread, `new`, tagged templates) is offered; the operator set stays closed (spec.md §19.4).   |
| [CSSOM](https://www.w3.org/TR/cssom-1/)                                                   | **Adopted** | §2     | packages/runtime/src/runtime.ts, packages/runtime/tests/mount.test.ts         | The rules a mount delivered through `document.adoptedStyleSheets` are released with its effect scope (§2.2). The delivery mechanism itself is spec.md §9.6.                                                                                                 |

## Changelog

- **0.1.1** (2026-09-02) — redefineElement and elementDefinition: a definition is read through the registry at connection, so a host may replace it live (§7); every section is now implemented.
- **0.1.0-draft** (2026-09-02) — Initial release: mount() with dispose and AbortSignal, host scope, host functions through call, events out, per-mount context, preloadDocument and preloadModule.

---

_Jx Embedding Specification v0.1.1_
