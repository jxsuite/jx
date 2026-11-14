# `@jxsuite/compiler` Specification

## Static HTML Compiler, Custom Element Emitter, and Island Detector

**Version:** 0.7.12\
**Status:** Implemented\
**Updated:** 2026-11-14\
**License:** MIT

---

## 1. Overview

The Jx compiler transforms `.json` component files into optimized production artifacts. It erases all Jx abstractions at build time — no JSON, no runtime, and no Jx code ships to production. The compiler auto-detects the appropriate output target based on document analysis.

Pages are always prerendered at build time — there is no per-request page rendering — and interactive regions compile to custom elements that hydrate in place. Server output is gated on `build.adapter`: when it is set, every `timing: "server"` entry and every enabled extension server mount (authentication, data) is bundled into a single generated Hono worker serving `/_jx/*` alongside the static output (§6.3). With no adapter no server output is emitted at all, so a project with a `timing: "server"` entry, or with a non-empty `data` or `auth` section, fails the build until an adapter is chosen (§6.3).

**Production dependencies:** `@vue/reactivity` (~7 kB gzip) + `lit-html` (~3 kB gzip).

---

## 2. Compilation Routes

The compiler inspects each input document and routes to the appropriate compilation target. Routes 0 to 3 are tried in that order and the first match wins:

| Route              | Condition                             | Output                                 | Status          |
| ------------------ | ------------------------------------- | -------------------------------------- | --------------- |
| 0 — Class          | Root `$prototype` is `"Class"` (§5.6) | ES class module                        | **Implemented** |
| 1 — Static         | `isDynamic()` returns false           | Plain HTML/CSS, zero JS                | **Implemented** |
| 2 — Custom Element | Root `tagName` contains hyphen        | `class extends HTMLElement` + lit-html | **Implemented** |
| 3 — Dynamic Page   | `isDynamic()` returns true, no hyphen | Pre-rendered HTML + reactive JS        | **Implemented** |

### 2.1 Static Detection (`isDynamic`)

A node is static if it and all descendants satisfy:

- No `state` entries that produce signals or functions. A pure named formula is not one unless something on the node still reads it (§3)
- No `${}` template strings in any property value
- No `${}` template string among its `children` (a template text child, §2.2)
- No `$prototype` namespaces
- No `$switch` nodes
- No `$prototype: "Array"` children
- No `$ref` bindings on element properties

Static detection is a single recursive tree walk — no code execution required.

> **Status: Implemented.** `isDynamic()` in `packages/compiler/src/shared.ts` performs complete recursive analysis.

### 2.2 Text Node Children

> **Status: Implemented.** `isDynamic` in `packages/compiler/src/shared.ts`; `resolveDocTemplates` and `expandMapTemplate` in `packages/compiler/src/site/site-build.ts`; `buildClientNode` and `emitClientModule` in `packages/compiler/src/targets/compile-client.ts`; `packages/compiler/tests/compile-client.test.ts`, `client-text-children.test.ts`, `site-build.test.ts`.

Bare strings and numbers in `children` arrays compile to text nodes in all three output tiers, with no wrapper element (`compile-element.ts`, `compile-static.ts` and `compile-client.ts` each handle a string child). A template string among them (`"Hello ${state.name}"`) is a template like any other (spec.md §6) and gets what a `textContent` template gets, since the two are one construct written two ways. The site build bakes it when it reads only build-time values, under §8.1's rules, and inside a repeater expanded at build time it resolves per item. One that survives makes its document dynamic (§2.1), so the static target never meets one. The client target emits it between two comments, `<!--jx-text:_tN-->…<!--/jx-text-->`, holding whatever prerender could resolve, and `hydrate()` keeps the text node after the opening comment current with an `effect()`; the comments are what bind a text node without a wrapper and without touching its element siblings. Inside a lit-rendered region (a mapped array, a `$switch` case, or children mixed with a repeater) and in the element target (§4.3) it is a hole in the lit template. The client target refuses one it would have to bind inside `script`, `style`, `textarea` or `title`, whose content HTML reads as text, so no comment can mark it there; `textContent` binds those elements. A whole-`children` template string is not a text child: spec.md §8.4 resolves it once, at build time.

---

### 2.3 Reading a Document

A document's format decides only how it is read. `.json` and `.jxn` need nothing enabled, and any other extension needs a format class that claims it (`extensions.md` §7, §8). This holds for a page, a layout, a component and an `$elements` dependency, and a component's emitted module is named `.js` whichever it was read from, so a build's output does not depend on the spelling. `jx validate` reports a `.jxn` file that does not read as an issue with a line and column, and a `\s` or `\b` in a quoted string as a `notation/escape` warning (`spec.md` §22.3).

A document's own modules are named as it is read (`spec.md` §23.2). Every `$src: "#client"` and `$src: "#server"` becomes `jx-script:<project-relative path>#client` or `#server` before the document is merged with a layout or with the project's state: a page, a layout, a component and an `$elements` dependency, in whichever format. `compile()` and `compileElement()` do it when given a `projectRoot`; without one there is no project to be relative to, and the entry is emitted as written.

A document's function bodies are erased from TypeScript to JavaScript as it is read, whichever format it is in, before the analysis that classifies a body and before any emitter (`spec.md` §23.1): a page, a layout, a component, an `$elements` dependency and a class definition. A body that cannot be erased stops the build, naming the file, the pointer and the place, and `jx validate` reports it as an issue; a body whose meaning reading it as TypeScript changes is a `function-body/typescript-reading` warning in both.

`jx convert <paths…> --to jxn|json [--dry-run] [--drop-comments]` moves documents under `pages/`, `layouts/` and `components/` from one to the other, and the project file between `project.json` and `project.jxn` (`site-architecture.md` §2.3). A path may be a directory, and a directory holding the project root's project file includes it. The project file is written in its canonical form, and since nothing names it by path no refactor runs; a folder already holding both names is refused before anything moves, as every host refuses it. The `/- kdl-version 2` line a `.jxn` file opens with is not counted as a comment. It writes the new text to the old path, renames the file, then runs the rename refactor, so every reference to the file follows it. It leaves alone a file already in the target format, a `*.class.json`, a file in a content collection, a file whose target name exists and a file that does not read, and it exits 1 naming each. Converting a `.jxn` file that has comments or a slashdash to `.json` is refused unless `--drop-comments` says otherwise, and the refusal gives the count, because `.json` has nowhere to keep them. Data is lossless in both directions, so rollback is the same command the other way. It runs under Bun, as `jx dev` does, because the refactor pass is the server's and the compiler cannot depend on it.

`jx format [paths…] [--check]` formats `.jxn` files, documents and the project file alike: the code a file holds, and the file around it. The code is every `Function` entry's string `body` and both sides of a document's `$script` (`spec.md` §23.1, §23.2), formatted as TypeScript by the one formatter Studio's code editor asks (`server.md` §5), so code either has formatted is code the other leaves alone. A `body` that is not a function's (a `Request`'s), a template string and a body of statements are not code this formats, and code that is only whitespace is left. A path may be a directory, which is walked for `.jxn` files past `node_modules`, `dist` and every folder whose name starts with a dot; with no path the project is what is formatted. A file with no comment and no slashdash is written in its canonical form, and a file with either is merged with what was on disk, so each node the formatter did not change keeps its text (`spec.md` §22.4). Code that does not parse is left as written and reported as `<path>#<pointer>: <message> (line N)`, the line counted in the code, while the rest of its file is still formatted. `--check` writes nothing and names each file that would change. The exit status is 1 when any code did not parse, a named path is missing or is not a `.jxn` file, a file does not read, or `--check` found a file to change; 2 for an option there is not; and 0 otherwise. A `.json` document is not formatted, since its code is a JSON string with nowhere to break a line: `jx convert` moves it first. `oxfmt` and `oxlint` do not read `.jxn`, so this is what formats the code in one. It runs under Bun, as `jx convert` does, because the formatter is the server's.

## 3. Output Tiers

> **Status: Implemented.** Both external-class rows hold in a site build, for pages and components (`packages/compiler/src/site/external-class.ts`, `prototype-resolver.ts`, `compile-client.ts`, `compile-element.ts`; `packages/compiler/tests/site-build-external-class.test.ts`, `external-class-hydration.test.ts`). The server-function row's client half is specified, and marked, on §6.1. With `build.headers.security.csp` set, the site build emits a Content-Security-Policy naming both constant inline blocks by hash (`packages/compiler/src/site/csp.ts`, `site-architecture.md` §14.3.1), and the page loads nothing from a third party (§12, `site-architecture.md` §8.7).

| Component surface                        | Compiler output                                 |
| ---------------------------------------- | ----------------------------------------------- |
| Fully static subtree                     | Plain HTML, zero JS                             |
| Naked value with `${}` in document       | HTML + `effect()` only                          |
| Template string signal                   | HTML + `computed()` + `effect()`                |
| `$prototype: "Function"`                 | HTML + function + handler wiring                |
| External class with `timing: "compiler"` | HTML with baked response data                   |
| External class with `timing: "client"`   | HTML + runtime hydration                        |
| Server function (`timing: "server"`)     | HTML + client fetch + generated server handler  |
| Custom element (hyphenated `tagName`)    | `class extends HTMLElement` + lit-html template |
| Pure type definition (`$defs`)           | No output                                       |
| Pure named formula, no client reader     | No output                                       |

**External classes.** A state entry whose `$prototype` is not a built-in (`spec.md` §12) names an external class, located through its `$src`, the document's `imports`, or an enabled extension's manifest class, in that order. At `timing: "compiler"`, and when `timing` is unset, a site build constructs it with the config `spec.md` §12.3 describes, takes `resolve()`, else `.value`, else the instance, and bakes the value into the page. In a component the value becomes the component's initial state, resolved once per component file, so the prerendered markup and the component's module start from the same value. At `timing: "client"` the build bundles a module for the class under `/assets/` (§12), and the compiled page or element constructs and resolves it the same way before its first render, then follows `subscribe` when the class offers one; a registry class with a `lower` capability is lowered instead (`extensions.md` §8.3). The browser's config is the entry's own keys and nothing of the build host: no `_project`, no `_document`, no `basePath`. A class whose descriptor reads `#/$context/` cannot run in a browser and is refused at `timing: "client"`. An entry the build cannot locate, load, resolve, lower or deliver fails the build with an error naming it and saying what to change; that includes a `timing: "compiler"` or `timing: "client"` entry whose name maps to no class. A built-in at `timing: "compiler"` is not this rule's (`spec.md` §11.3), and an entry with no `timing` whose name maps to no class is left as written.

**Waiting for a class.** A compiled page awaits every `timing: "client"` class before it hydrates, and a compiled element awaits its own before its first draw, as the interpreter awaits every class before it renders. A template that reads a class's value (`${state.forecast.days.length}`) therefore reads the value in every tier, and the prerendered markup is what is on screen meanwhile, so the cost is time to interactivity and never a blank page. A class that fails to construct, or whose `resolve()` rejects, is logged as `Jx: external class "<key>" failed` and its entry stays `null`; the rest of the page still hydrates. An element constructs its classes once per instance, on its first connection and after its props are merged; an instance removed before they settle does not draw, and one put back draws once. Compiling a `timing: "client"` external class outside a site build is an error, since nothing would bundle its module.

**A pure named formula is a function, not state.** A state entry that is an `$expression` with `parameters` and no mutating operator anywhere in its body (`spec.md` §19.4c) holds no value, cannot be written, and subscribes to nothing, so declaring one gives the browser nothing to do. It makes a node dynamic only when something on that node still reads it: a `${state.name(…)}` template, a `state.name` or `state["name"]` in a handler or computed body, or a `#/state/name` pointer, found by the scan §8.1 describes. One formula calling another is not such a read; the caller is judged by its own readers. `isDynamic` applies the rule to any node, and the site build applies it after it has resolved templates: a formula whose every call was resolved at build time has no reader left, so it is dropped from the page's state in the same fixpoint as an unread array (§8.1), and a page whose only state is a formula called from a build-time template builds as plain HTML. A formula a client template, handler or computed still reads ships as before, together with any formula it calls. While a `$src` Function survives on the page every formula is kept, because that module's reads cannot be seen. A callable whose body writes state is not pure and is kept as state.

---

## 4. Custom Element Compilation

### 4.1 Output Structure

For each custom element, the compiler emits a self-contained ES module:

1. Imports for `@vue/reactivity` and `lit-html`
2. Imports for `$elements` dependencies (sub-component registrations)
3. Imports for Function-def `$src` sidecars — in site builds, bundleable specifiers (`npm:…`, `./relative`) are rewritten to their `/assets/` bundle URL (spec.md §5.3 "Compiled-site delivery"). The local binding is always the `state` key, so an entry whose `$export` names a different export is imported under an alias (`import { filterLeads as filtered }`)
4. `class extends HTMLElement` with reactive state and lit-html template
5. Static CSS extracted to a `<style>` block
6. `customElements.define()` registration call

Lifecycle conformance (spec.md §16.4, §16.5): `connectedCallback` reads each observed attribute already present on the first connection, before the `$props`/property merge, and invokes `state.onMount(state, host)`, with the host as its receiver, on a microtask after the first render; `disconnectedCallback` invokes `state.onUnmount(state)` on every removal; `adoptedCallback`, emitted when `state` declares `onAdopted`, invokes `state.onAdopted(state)`; and a definition with `observedAttributes` gets `static get observedAttributes()` and an `attributeChangedCallback` that applies spec.md §16.5's coercion and default restoration through an inlined copy of the runtime's rule (§11). The same contract as the runtime's interpreted elements.

`$prototype: "Request"` entries initialize to `null` and fetch from `connectedCallback`, after the `$props`/property merge so a templated `url` interpolates the values the parent passed in. Each fetch runs inside its own `effect()`, so a reactive URL re-fetches when its inputs change; the runner joins the element's effect registry and is stopped on `disconnectedCallback` (§4.4). A `manual` entry emits no fetch. A `timing: "server"` entry is initialised the same way and calls its route from `connectedCallback` after the `Request` fetches, its effect joining the same registry (§6.1). Handler parameters bind by name per spec.md §5.3 4d, and a bodyless `$src` entry is emitted as a computed or a callable according to the same section's classification rule.

A definition with a `timing: "client"` external class (§3) compiles to a module that imports each class module and splits its connection in two. `connectedCallback` keeps what is read from the instance (the observed attributes, the `$props` and property merge, the forwarding accessors), then starts the instance's one class resolution and asks for a draw when it settles; everything else moves, unchanged, into a private `#jxRender()`: the `Request` and server-entry effects, dynamic host styles, slot capture, the clear, the render, slot distribution and `onMount`. There, "first" means the first draw, since an instance can connect twice before it draws once. The instances are kept in a private `#jxInstances` map by state key. A definition with no such class compiles to the module it always did.

The emitted module is named after the component's `tagName` — matching the loader `<script>` and the CSS sidecar (site-architecture.md §12.4) — and `$elements` import specifiers are derived from the dependency's tag for the same reason.

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
    {
      "tagName": "button",
      "textContent": "Set Away",
      "onclick": { "$ref": "#/state/setAway" }
    }
  ]
}
```

**Output** (`user-card.js`, formatted and abridged: the comments stand for code §4.1, §4.4 and §11 specify, and constants, helpers and class fields that code adds outside the callbacks are left out):

```js
import { reactive, computed, effect, stop } from "@vue/reactivity";
import { render, html, nothing } from "lit-html";
// __jxEnumAttrs and __jxAttrText: the boolean-attribute rule (§11)

class UserCard extends HTMLElement {
  #effects = [];
  #rendered = false;

  constructor() {
    super();
    this.state = reactive({
      username: "Guest",
      status: "online",
    });

    this.state.setAway = (state) => {
      state.status = "away";
    };

    this.state.displayStatus = computed(() =>
      this.state.status === "online" ? "Available" : "Away",
    );
  }

  template() {
    const s = this.state;
    return html`
      <h3>${s.username}</h3>
      <button @click="${(e) => s.setAway(s, e)}">Set Away</button>
    `;
  }

  connectedCallback() {
    const _first = !this.#rendered;
    this.#rendered = true;
    // Props: data-jx-props, then props.* attributes, then properties and their accessors (§4.4)
    if (this.hasAttribute("data-jx-prerendered")) {
      this.removeAttribute("data-jx-prerendered");
    }
    if (_first) this.replaceChildren();
    this.#effects.push(effect(() => render(this.template(), this)));
    // onMount, on a microtask after rendering (§4.1)
  }

  disconnectedCallback() {
    for (const _e of this.#effects) {
      stop(_e);
    }
    this.#effects.length = 0;
    // onUnmount (§4.1)
  }
}

customElements.define("user-card", UserCard);
```

The static `style` is not in the module: it goes to the component's stylesheet, which every page using the component inlines (§8.2). `setAway` declares no parameters and is still called with the event (§4.3). A function entry is assigned before a computed one, whatever order `state` declares them in, and the prerendered children are cleared on the first connection only.

### 4.3 lit-html Binding Syntax

| Jx                                                   | lit-html                                                              | What it does                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `"textContent": "${state.name}"`                     | `${s.name}`                                                           | Reactive text                                                             |
| `"onclick": { "$ref": "#/state/fn" }`                | `@click="${(e) => s.fn(s, e)}"`                                       | Event listener, called with `(state, event)` (spec.md §5.3 4d)            |
| `"$props": { "items": { "$ref": "..." } }`           | `.items="${s.items}"`                                                 | JS property (by reference)                                                |
| `"hidden": "${state.loading}"`                       | `.hidden="${s.loading}"`                                              | DOM property (spec.md §8.1), which the element reflects                   |
| `"className": "${state.cls}"`                        | `class="${s.cls}"`                                                    | Attribute binding                                                         |
| `"style": { "color": "${state.c}" }`                 | `style="color: ${s.c}"`                                               | Inline style                                                              |
| `"attributes": { "aria-expanded": "${state.open}" }` | `aria-expanded="${__jxAttrText('aria-expanded', s.open) ?? nothing}"` | Attribute; a boolean takes spec.md §8.3's spelling, and `null` removes it |

The `.property` syntax is the key enabler for the property-first interface.

**No `?name=` binding is emitted; a boolean is decided in one of three places.** A top-level key is a DOM property (spec.md §8.1), so `.hidden=` hands the value to the element's own setter, which adds or removes the reflected attribute exactly as the runtime's property write does. A whole `${…}` or a `$ref` under `attributes` goes through `__jxAttrText`, the boolean-attribute rule every generated module carries (`attrHelperSource()`, §11): it spells a boolean by the family spec.md §8.3 assigns the name and returns `null` for absence, which `?? nothing` turns into removal. A literal boolean under `attributes` is decided at build time by the same rule, so `"open": true` emits a bare `open`, `"aria-hidden": false` emits `aria-hidden="false"`, and `"hidden": false` emits nothing. A template with text around its expression (`"page ${state.n}"`) is a string by construction and binds without the helper. lit's `?name=` would apply the presence family to every name and write an empty `aria-expanded` for `true`, which spec.md §8.3 reads as unset.

**A handler receives the event.** Every `on*` call site passes `(state, event)`, and a string body is built with `state` first and its other declared names after it (spec.md §5.3 4d), so a `$ref` handler is called as `s.fn(s, e)`; inside a map body the call is preceded by `s.$map = $map;` (§4.7). An inline Function body or an `$expression` on `on*` is compiled into the arrow's body rather than called.

**Every row above lowers a `$ref` through the one tokenizer** (`@jxsuite/runtime/pointer`, spec.md §7.1), which decides each segment independently: a segment that is an ECMAScript identifier becomes `.name`, and any other segment becomes `["…"]`. So `#/state/user/name` is `s.user.name` while `#/state/items/0` is `s.items["0"]`. The same rule governs an emitted object-literal key, which is bare where it is an identifier and quoted where it is not.

The bracket branch is what makes the lowering total rather than a bet: a reference token may hold any character but `/` and `~` (RFC 6901 §3) and a state key is author data, so neither is guaranteed to be an identifier. This is a property of the emitted JavaScript only — `.` in generated member access says nothing about the pointer, where `/` is the sole separator.

Until 0.3.0 the compiler lowered a ref by replacing `/` with `.` and pasting the result, which emitted `s.items.0` — a syntax error — and `s.custom/path`, which parses as a division against an undeclared identifier. Neither failed the build: nothing between the string concatenation and the browser ever parsed the output. A target that emits JavaScript **must** produce source that parses for every ref the schema admits.

### 4.4 Property Bridge

`connectedCallback` takes props from three sources, in order: a `data-jx-props` payload, literal `props.*` attributes, then, on the first connection, JS properties the instance carries. Each is accepted only for a key the definition's `state` declares, a pure type definition included, and refused for a private one (spec.md §5.6). It then installs the property-first interface (spec.md §16.2) and registers the render effect:

```js
const __jxProps = ["count", "title", "label"]; // every declared state key that is not private
const __jxBridged = ["count", "title", "label"]; // __jxProps, less the members of the class
// __jxSupplies and __jxNativeSetter: the property bridge's two rules (§11)

connectedCallback() {
  const _first = !this.#rendered;
  this.#rendered = true;
  // …data-jx-props payload: if (__jxProps.includes(k)) this.state[k] = v;
  const _pn = this.getAttributeNames().filter(n => n.startsWith('props.') && n.length > 6);
  for (const _n of _pn) {
    const _k = _n.slice(6);
    if (_k.startsWith('#')) { this.removeAttribute(_n); continue; }
    if (__jxProps.includes(_k)) {
      this.state[_k] = this.getAttribute(_n);
      this.removeAttribute(_n);
    }
  }
  if (_first) {
    for (const _k of __jxBridged) {
      if (_k in this && this[_k] !== undefined && __jxSupplies(this, _k)) {
        this.state[_k] = this[_k];
      }
    }
    for (const _k of __jxBridged) {
      const _set = __jxNativeSetter(this, _k);
      Object.defineProperty(this, _k, {
        configurable: true,
        get: () => this.state[_k],
        set: (v) => { if (_set) _set.call(this, v); this.state[_k] = v; },
      });
    }
  }
  this.#effects.push(effect(() => render(this.template(), this)));
}
```

The key sets are the definition's, written into the module as literals. A membership test against `this.state` would refuse a pure type definition (`{ "type": "string" }`), which holds no value and so is not in the reactive object until a prop sets it. `__jxBridged`, the two helpers and the `if (_first)` block are emitted only when there is a key to bridge.

The third source takes what the instance genuinely carries (spec.md §13.2): an own property, or the attribute a reflected property writes. `key in this` alone would let `title` answer with its empty native value and beat the declared default, and an own-property test alone drops a parent's `.title=`, which creates no own property. The rule is `instanceSupplies` in `@jxsuite/runtime`, inlined by `propSupplyHelperSource()` (§11). Every bridged key then gets an accessor on the instance forwarding into `this.state`, so a later `el.key = v`, a compiled parent's re-committed `.key=` binding included, re-renders the element. For a key the platform already owns (`title`, `lang`, `hidden`) the accessor calls the platform's setter first, so the attribute still reflects (spec.md §16.2). The accessors go on the instance and after the merge because a write before connection has made an own property, which the merge reads and the accessor then replaces; on the prototype that early write would land in state at once, and the two attribute sources would then overwrite it, where a property is the source that wins.

A key that names a member of the emitted class (`state`, `template`, `constructor`, a lifecycle callback) is the one compiled-only exception: it arrives through the two attribute sources, but is neither merged from a property nor given an accessor, because either would replace the member. A project formula a component inherits (spec.md §13.4) is in its scope and not in its interface, so it is bridged only on an instance that was given a prop of that name.

The `props.*` attribute form is how a JSON-authored instance and an island-rendered map body both deliver props, and it mirrors the interpreted runtime; values are strings, and because HTML lowercases attribute names a matching state key must be lowercase. A `$props` entry whose value is a template string is emitted as a binding, not as quoted text.

**Effect teardown.** Every effect the element creates — render, dynamic host styles, Request auto-fetch — is registered in one list and `stop()`ed in `disconnectedCallback`. Calling an `@vue/reactivity` runner re-runs its effect rather than ending it, so teardown must use `stop()`.

**Reconnection.** `connectedCallback` runs again each time an instance is put back in a document: moved to another parent, or removed and inserted. The effects are started again, so the instance draws the state it left with and fetches again; what happens once per instance is not repeated: the read of its observed attributes, the property merge and its accessors, and `onMount` (§4.1). The container (the element, or its shadow root) is cleared of its prerender on the first connection only, and slotted children are captured and distributed on the first connection only (`spec.md` §8.5). Clearing a second time removed the tree lit had drawn while the part lit keeps for it on the container stayed, so the next render updated detached nodes and the element was left empty; a second capture would have taken the component's own render for slot content.

### 4.5 Nested CSS

```json
{ "style": { "display": "block", ":hover": { "backgroundColor": "#f0f0f0" } } }
```

Emits:

```css
user-card {
  display: block;
}
user-card:hover {
  background-color: #f0f0f0;
}
```

Both declarations are RULES, and the base one is emitted first, so the state block overrides it at equal specificity by source order (`spec.md` §9.1).

### 4.6 `$elements` Dependencies

```js
import "./variant-card.js";
import "./variant-attribute.js";
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

The callback binds `item` and `index`, and — when the map's templates reference it — `$map` as well, so the `${$map.item…}`/`${$map.index}` forms named in spec.md §6.6 resolve against the same object the interpreter passes to its template evaluator. Template rewriting applies throughout the map body, `id` and `className` on descendants included.

A handler bound inside the map assigns that object to `state.$map` before invoking, so bodies can read `state.$map.index`/`state.$map.item` per spec.md §10.2. Handlers outside a map are emitted unchanged.

### 4.8 `$switch` Compilation

A `$switch` compiles to a case-keyed lookup over lit templates, matched on the discriminant's string form (spec.md §14.1) with an empty template as the fallback:

```js
${{
  "home": html`<div>Home page</div>`,
  "about": html`<div>About page</div>`,
}[String(s.currentRoute)]}
```

**A shared subtree is hoisted, not repeated.** A branching construct — `$switch`, or a `tagName` chosen at creation (spec.md §8.6) — writes one template per branch, so a subtree the authored document names once was emitted once per branch into the bundle. Any subtree that would repeat is lifted into a `const _cN = html`…`` declared inside `template()`, above the `return`, and the branches reference it. The declaration is inside the method, not at module scope, so it is rebuilt per render and reads the same state alias the template does. A map body gets its own declarations inside its callback, because they close over that callback's `item`/`index`. Branches that emit distinct subtrees are left inline, and a chosen `tagName` whose candidates disagree about being preformatted is not hoisted, since `white-space` decides how the subtree itself is indented.

> **Status: Implemented.** `compile-element.ts` produces complete lit-html custom element modules.

---

## 5. `.class.json` Compilation

### 5.1 Overview

`.class.json` files are JSON Schema 2020-12 documents that define class structures. The compiler transforms them into standard ES class modules.

### 5.2 Document Format

> **Status: Implemented.** The example validates against the class schema and runs once compiled (`packages/compiler/tests/compile-class.test.ts`).

A class document is validated by the class schema, `https://jxsuite.com/schema/class/v1`, and `schema.md` §3.3 is its contract: `$prototype: "Class"` and `title` are required, beside `extends`, `$implementation`, the `$defs` categories, the admission blocks of `extensions.md` §6 and `$studio`. Route 0 reads `title` (the class name, required by `compileClassJson`), `extends` (a class name, or a `$ref` to another class document, whose module it imports by its default export), `$id` (written as a source comment) and the `$defs` categories (§5.3). It ignores `$implementation` (§5.4), the admission blocks and `$studio`, which hosts read (`extensions.md` §6.1). A self-contained class using every category:

```json
{
  "$schema": "https://jxsuite.com/schema/class/v1",
  "$prototype": "Class",
  "title": "Pager",
  "description": "Pages through an array of items",
  "$defs": {
    "parameters": {
      "items": { "identifier": "items", "type": { "type": "array" } },
      "pageSize": {
        "identifier": "pageSize",
        "type": { "type": "integer", "minimum": 1, "default": 10 }
      },
      "page": { "identifier": "page", "type": { "type": "integer", "minimum": 0 } }
    },
    "returnTypes": {
      "Page": { "type": "array", "description": "The items on the current page" }
    },
    "fields": {
      "created": { "role": "field", "scope": "static", "initializer": 0 },
      "items": { "role": "field", "access": "private", "default": [] },
      "page": { "role": "field", "access": "private", "default": 0 },
      "pageSize": { "role": "field", "default": 10 }
    },
    "constructor": {
      "role": "constructor",
      "parameters": [
        { "$ref": "#/$defs/parameters/items" },
        { "$ref": "#/$defs/parameters/pageSize" }
      ],
      "body": "Pager.created++;"
    },
    "methods": {
      "page": {
        "role": "accessor",
        "getter": { "body": "return this.#page;" },
        "setter": {
          "parameters": [{ "$ref": "#/$defs/parameters/page" }],
          "body": "this.#page = Math.min(Math.max(page, 0), this.pageCount - 1);"
        }
      },
      "pageCount": {
        "role": "accessor",
        "getter": { "body": "return Math.max(1, Math.ceil(this.#items.length / this.pageSize));" }
      },
      "resolve": {
        "role": "method",
        "returnType": { "$ref": "#/$defs/returnTypes/Page" },
        "body": [
          "const start = this.#page * this.pageSize;",
          "return this.#items.slice(start, start + this.pageSize);"
        ]
      }
    }
  }
}
```

Compiled, `new Pager({ items, pageSize: 3 })` resolves to the first three items, the `page` setter clamps to the last page, and `Pager.created` counts instances: the external class contract (`spec.md` §12.3) with no `$implementation`.

### 5.3 `$defs` Object Categories

> **Status: Implemented.** The categories are `classDefSchema`'s (`packages/schema/defs/class-def.schema.ts`), and what route 0 emits for each is `compileClassJson` (`packages/compiler/src/targets/compile-class.ts`, `packages/compiler/tests/compile-class.test.ts`).

What each category holds is the class schema's (`schema.md` §3.3); what route 0 emits for it:

| Category      | Holds                                                                                                                                                                               | Route 0 emits                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parameters`  | Named parameter schemas: `identifier` (required), `type` (holding the `default` tooling reads), `description`, `examples`, `format`                                                 | Nothing. Tooling offers each as a key of the constructor's `config` argument, required when the constructor's `parameters` reference it and it has no default; a method's `parameters` reference them to name its own                                                                                                                                                                |
| `fields`      | Fields by key: `identifier` (default: the key), `access` (`public` by default, `private`, `protected`), `scope` (`instance` by default, `static`), `initializer`, `default`, `type` | A static field `static name = value`; an instance field assigned in the constructor from `config[identifier]`. The value falls back to `initializer`, then `default`, then `null`. `private` names the member `#name`; `protected` compiles as public                                                                                                                                |
| `constructor` | `body` (a string or an array of lines), `superCall.arguments` (source expressions), `parameters`                                                                                    | `constructor(config = {})`: `super(…)` with `superCall.arguments` when `superCall` is present or `extends` names a base class, then the field assignments, then `body`                                                                                                                                                                                                               |
| `methods`     | Methods by key: `identifier` (default: the key), `role`, `access`, `scope`, `parameters`, `body`, `returnType`, `getter` and `setter`, `timing`                                     | `role: "accessor"`: `get name()` from `getter.body` and `set name(p)` from `setter.body`, `p` named by `setter.parameters` (`v` when it names none). Any other role, the capability roles of `extensions.md` §8 included: a method, `static` and `#`-prefixed by `scope` and `access`, and `async` when its body contains `await` or its `returnType` is a `$ref` naming a `Promise` |
| `returnTypes` | Named output schemas that a `returnType` references by `$ref`                                                                                                                       | Nothing                                                                                                                                                                                                                                                                                                                                                                              |

A parameter referenced by `$ref` is named by the reference's last segment, and an inline one by its `identifier`. `type`, `description`, `examples` and `timing` are read by hosts and tooling (`extensions.md` §6.1 and §8.1) and never emitted.

### 5.4 The `$implementation` Key

> **Status: Implemented.** A site build generates the class from the schema at either timing (`loadClass` and `classEntrySource` in `packages/compiler/src/site/external-class.ts`; `packages/compiler/tests/external-class.test.ts`, `site-build-external-class.test.ts`).

Links the schema to its JavaScript implementation:

```json
"$implementation": "./md.js"
```

When present, every host imports the class from that module: the interpreter and the dev server at runtime, and a site build during the build (`timing: "compiler"`, or unset) or through a bundled module (`timing: "client"`, §12). The class is the module's export of the class's name (the entry's `$export`, else the document's `title`, else the `$prototype`), or that member of its default export. When absent, the class is generated from the schema: the interpreter constructs it (`classFromSchema`), and a site build compiles it to the ES class module §5.5 describes, running it during the build or serving it under `/assets/`. A generated class imports only a `$ref` base, from the sibling module a direct compile of that document writes (§5.6) and a site build does not, so in a site build a self-contained class whose `extends` names another `.class.json` is a build error; give it an `$implementation`.

### 5.5 Compilation Output

The compiler emits:

- Private fields (`#name`)
- Static fields and methods
- Constructor with `super()` support
- Getters/setters (accessor methods)
- Async method detection
- `extends` clause from a string, or from a `$ref` to another class document, whose module's default export is imported

### 5.6 Detection and Routing

A document is a class document when its root's `$prototype` is `"Class"` (`isClassDef` in `packages/schema/src/guards.ts`). `compile()` tests this before any other route (§2), whatever the file is called and for a document passed in memory. Nothing else makes a document a class: a component's `$defs` holds type definitions under any name (`schema.md` §3.1), so `constructor`, `methods` or `fields` among them do not route it here, and a `*.class.json` file without the key compiles as the component it then is; `jx validate` reports that file, because it checks every project-local `*.class.json` against the class schema, which requires the key (`extensions.md` §5.4).

A class document's file is named `*.class.json` by convention, the name other hosts find it by: a `$src` entrypoint (`spec.md` §12.2) and an extension manifest's classes (`extensions.md` §4). Route 0 writes one module exporting the class by name and as its default, beside its source, named after it with the extension (and a `.class` before it) replaced by `.js`, or, for a document passed in memory, at the `title` plus `.js`.

> **Status: Implemented.** `packages/compiler/src/targets/compile-class.ts` handles full `.class.json` → ES class compilation.

---

## 6. Server Compilation

### 6.1 `timing: "server"` Entries

> **Status: Implemented.** Both targets emit the call (`emitServerCall` in `packages/compiler/src/shared.ts`), and the site worker serves it (§6.3).

For each `timing: "server"` entry, the compiler emits two artifacts:

1. **Client-side:** a `POST` to `<base>/_jx/server/$export`, `<base>` being the deployment base (site-architecture.md §14.7), whose JSON body is the entry's `arguments` with each top-level `$ref` resolved (`#/state/`, `parent#/`, `window#/`, `document#/`; any other scheme fails the compile). The entry is `null` until a call answers and then holds the parsed response. When an argument is a `$ref` the call runs in an effect, so a change calls again and the answer to a superseded call is dropped. A non-2xx answer is not stored: the entry keeps its last value and the error is logged to the console. A page calls when its module loads, and an element calls in `connectedCallback`, after its props are merged, and stops on disconnect.
2. **Server-side:** a route in the site worker (§6.3) that imports `$export` from `$src`, registered at `<base>/_jx/server/$export`, and answers the function's return value as JSON (`null` for `undefined`), or `{ ok: false, error: "Server error" }` with status 500 when it throws. The thrown value is written to the worker's log with `console.error` and is not sent: a message is written for whoever reads the log and quotes statements, env var names and upstream hosts. A function that wants its caller told something returns it.

### 6.2 Per-Route Server Handler (`compileServer`)

> **Status: Removed.** The site build no longer writes a per-page handler, and `compileServer` is no longer exported. Every such handler registered the same absolute `/_jx/server/` routes, so two pages with server entries emitted two apps claiming one URL space; nothing in the toolchain ran one, and a build with no adapter names no runtime to bundle it for. A site's server entries are served by the site worker (§6.3), which a `timing: "server"` entry requires as an active mount does.

### 6.3 Site-Wide Server Bundling (`compileSiteServer`)

When `build.adapter` is set in `project.json`, the site build collects every `timing: "server"` entry declared by a page, by each layout in that page's chain, by `project.json`'s `state` (which every page inherits, site-architecture.md §3.2) and by every component directly in `components/` (site-architecture.md §10.3). Each document is read as written, before layout merging, so a relative `$src` (`./`, `../`) resolves against the directory of the document that declares it; any other specifier is kept as written, and the worker bundle resolves both from the project root (§12). A `#server` entry names its document's own server module (`spec.md` §23.2): it is collected under its qualified specifier, which the worker bundle loads from the document (§12), so two documents exporting one name are two modules and the build error below names both. `project.json` has no script, and a `#server` entry in its `state` is a build error. Entries are deduplicated by export name, because each is served at `/_jx/server/<export>`: one module declared by several documents is one route, and two different modules exporting one name are a build error naming each module and a document declaring it. The build emits a single Hono worker via `compileSiteServer()` — `dist/worker.js`, or `dist/_worker.js` ([Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)) plus a `dist/_routes.json` for `"cloudflare-pages"` (site-architecture.md §14.1.1). A `"cloudflare-pages"` site with no server entries **and** no active extension mounts emits no worker at all.

The function signature for server entries is `(args, env)` — the second parameter receives the platform's environment bindings (e.g., Cloudflare `env` with KV, D1, email, etc.). Old functions that accept only `(args)` are unaffected since the extra parameter is ignored.

```js
compileSiteServer(entries, { adapter, base, baseUrl, connectors, i18n, mounts });
```

| Parameter    | Type                                                   | Default         | Description                                                                                                              |
| ------------ | ------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `entries`    | `Array<{exportName, src}>`                             | —               | Collected server entries, one per export name, each `src` resolvable from the project root                               |
| `adapter`    | `string \| null`                                       | `null`          | Deployment adapter; adds platform-specific output                                                                        |
| `base`       | `string`                                               | `""`            | Deployment base path (site-architecture.md §14.7); the server routes register under `base` + `baseUrl`                   |
| `baseUrl`    | `string`                                               | `"/_jx/server"` | Base path prefix for all server endpoints                                                                                |
| `i18n`       | `ResolvedI18n \| null`                                 | `null`          | Locale routing; with two or more locales the `/` negotiation middleware is registered first (site-architecture.md §13.6) |
| `mounts`     | `Array<{className, module, basePath, order, options}>` | `[]`            | Extension server mounts to register (extensions.md §11)                                                                  |
| `connectors` | `Array<{provider, className, module}>`                 | `[]`            | Connector provider classes the mounts receive via `options.connectors`                                                   |

**Extension server mounts.** Classes carrying a `server` block ([extensions.md §11](./extensions.md)) — `@jxsuite/auth` at `/_jx/auth`, the connector data mount at `/_jx/data` — are emitted into the same worker: a static import per mount module and per connector provider class, one shared `ctx` object, `mount()` awaited at module init in ascending `order`, and `app.all()` wrappers for both `<basePath>/*` and the bare `<basePath>` registered **before** the `/_jx/server` routes and the asset fallthrough. Mount options are inlined as JSON — the project's section manifest, identifiers and env-var names only, never secret values (extensions.md §13). A mount is active when its class owns no project section, or when the project declares a non-empty value for its section key.

**Dynamic sections and server functions require a server-capable adapter.** A project with active extension mounts and no `build.adapter` fails the build with an error naming the offending sections: a static-only output cannot serve `/_jx/data` or `/_jx/auth`. A project with a `timing: "server"` entry anywhere the worker would collect one (a page, a layout in its chain, a compiled component or `project.json`'s `state`) fails too, with one error naming each entry and the document declaring it, reported once the pages are compiled. Set `build.adapter` to `"cloudflare-workers"`, `"cloudflare-pages"`, `"node"`, or `"bun"`.

Adapter-specific behavior:

| Adapter                                      | Extra Output                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `"cloudflare-workers"`, `"cloudflare-pages"` | `app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw))` fallback for static assets |
| `"node"`, `"bun"`, `null`                    | No extra output                                                                 |

Example generated worker for a Cloudflare adapter:

```js
// Generated by @jxsuite/compiler — do not edit manually
import { Hono } from "hono";
import { sendContactEmail } from "./components/contact.server";

const app = new Hono();

app.use("/_jx/*", jxGate); // §6.4

app.post("/_jx/server/sendContactEmail", async (c) => {
  if (!isJson(c.req.header("content-type"))) {
    return c.json({ ok: false, error: "Expected an application/json body" }, 415);
  }
  const args = await c.req.json().catch(() => ({}));
  try {
    return c.json(await sendContactEmail(args, c.env));
  } catch (e) {
    console.error("jx: server function sendContactEmail threw:", e);
    return c.json({ ok: false, error: "Server error" }, 500);
  }
});

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
```

> **Status: Implemented.** `compile-server.js` exports `compileSiteServer` (site-wide). `site-build` collects the entries of every page, each layout in its chain, `project.json` and every component directly in `components/` (`packages/compiler/src/site/server-entries.ts`), and generates the worker when `build.adapter` is set (`packages/compiler/tests/site-build.test.ts`, `connector-mounts.test.ts`). The worker is bundled self-contained (§12); server sources are no longer copied into `dist/components/`.

### 6.4 Request Gate

> **Status: Implemented.** `buildRequestGate` in `packages/compiler/src/targets/compile-server.ts`, executed against Hono in `packages/compiler/tests/compile-server.test.ts`.

A worker that has a server function or an extension mount registers one middleware on `<base>/_jx/*` before any of them (and on `baseUrl` too when a custom one lies outside that subtree). It is the production counterpart of the dev server's gate (`packages/server/src/net-guard.ts`): the routes behind it act with the visitor's cookies, so a page on another site must not be able to call them.

**Refusal.** The gate reads [Fetch Metadata](https://www.w3.org/TR/fetch-metadata/). A request whose `Sec-Fetch-Site` is present and is neither `same-origin` nor `none` is answered `403` with `{ ok: false, error }` unless its `Sec-Fetch-Mode` is `navigate`. An absent header is accepted: the header is browser-supplied, so requiring it would refuse every server-side client (a webhook, `curl`, another worker) while stopping no page, and a page always sends it. `same-site` is refused with `cross-site`, because a sibling subdomain is not the site's own script.

**Navigations pass whatever their method.** A person following a link is a cross-site `GET` navigation, and an identity provider answering with `response_mode=form_post` is a cross-site `POST` navigation to the auth mount. A form a hostile page submits arrives the same way, so the gate is not the only layer: every route that reads a body requires it to be declared JSON. A server function answers `415` to a `Content-Type` that is not `application/json` or a `+json` type, and the data mount reads such a body as absent ([extensions.md §13](./extensions.md)). An HTML form cannot send that type, and a cross-origin script that sets it triggers a preflight the worker never answers.

**Response headers.** Every response from behind the gate carries `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`, and `Cache-Control: no-store` unless the handler set its own `Cache-Control`. The answers are a session's or a table's contents: no shared cache, back/forward cache entry or service worker (site-architecture.md §14.6) should keep one. The static output's headers are a separate concern (site-architecture.md §14.3).

---

## 7. Image Optimization

The compiler includes a build-time image optimization pipeline that generates responsive variants, converts formats, and injects performance attributes into `<img>` nodes. The pipeline is implemented across four modules in `packages/compiler/src/site/`:

- `image-optimizer.ts` — one request per source image to the compiler's native core (§14), which decodes, resizes and encodes every variant
- `image-transform.ts` — document tree mutation
- `image-cache.ts` — persistent cache for skipping redundant re-encoding
- `img-loading.ts` — the loading attributes

The pipeline's behaviour is specified once, in `site-architecture.md` §9.2; each subsection below names the code that implements the matching part.

### 7.1 Configuration

Image optimization is configured in `project.json` under the `images` key, as `site-architecture.md` §9.2.1 specifies. `DEFAULTS.images` (`site-loader.ts`) holds the defaults, `ImageConfig` (`image-optimizer.ts`) is what the pipeline reads, and `imageConfigSchema` (`@jxsuite/schema`) validates it.

### 7.2 Document Transformation (`transformImageNodes`)

`transformImageNodes(doc, config, projectRoot, cache, metaCache?, mounts?)` implements `site-architecture.md` §9.2.2 for one page and returns `{ imageRefs }`, the manifests of the images it resolved. It hands `<img>` nodes to `transformImgNode` and pre-rendered `innerHTML` to `transformInnerHtmlImages`; both resolve every image through `resolveVariants`, so the two halves apply one set of rules, and a rule added to one is added to the other. `wrapInPicture` and `renderPictureTag` write the `<picture>`, for a node and for an `innerHTML` tag respectively.

`processImage(srcPath, cacheImgDir, config)` encodes one image's variants into the image cache's `_optimized/` directory (§7.5) and returns its `ImageManifest`. It hands the native core (§14) one request per source: the width ladder, the formats, and one name hash per format (`variantHash`, a digest of the source's bytes, the pipeline version, the format and its quality), from which the core names each variant `{stem}-{width}-{hash}.{format}`. A PNG written in place of a JPEG takes the hash the JPEG was given.

A source's variants are encoded in parallel, bounded by the machine's parallelism. A variant whose file already exists is not encoded again, and when every variant exists the source is not decoded. A source that cannot be decoded, or an encoder that refuses a variant, rejects the whole image and fails the route that uses it.

**What the pixels go through.** The source is decoded once. Its EXIF orientation is applied, so a photo stored sideways is encoded upright and the `width` and `height` written to the tag are the ones a viewer sees. An embedded ICC colour profile is converted to sRGB, because the variants carry no profile; a profile that cannot be used (not RGB, or malformed) is ignored, as a browser ignores one. Downscaling is Lanczos3 with colour premultiplied by alpha.

**What each format is.**

| Format | Written as                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------- |
| `avif` | Lossy, at `quality.avif`.                                                                               |
| `jpeg` | Lossy and progressive, at `quality.jpeg`. A source with transparency is written as PNG instead (below). |
| `png`  | Lossless.                                                                                               |
| `webp` | **Lossless.** No lossy WebP encoder meets the native core's rule of linking no C library (§14).         |

JPEG has no alpha channel, so where `jpeg` is listed and the source has transparency, PNG is written in its place and offered as `image/png`: the universally decodable fallback of a logo is not a white rectangle. PNG is not written twice when both are listed. Because WebP is lossless, its files are several times the size of AVIF or JPEG, and a build whose `formats` lists `webp` prints one warning saying so.

#### 7.2.1 `sizes`

`containerWidthOf` and `sizesForContainer` (`image-transform.ts`) implement the resolution order of `site-architecture.md` §9.2.2 step 4. `containerWidthOf` lowers the bound inherited from an element's ancestors by that element's literal base `maxWidth` and `width`, and is called for every node on the way down, for an image's own style, and for the node holding an `innerHTML` image.

### 7.3 Eligibility

`shouldSkip` and `isAllowedRemote` (`image-transform.ts`) implement `site-architecture.md` §9.2.3: the first holds the allowlist of local raster extensions, the second the Cloudflare service's rule for remote sources. `resolveImagePath` resolves a local source through an extension asset mount first ([extensions.md §8.5](./extensions.md)), then as `site-architecture.md` §9.3 says.

### 7.4 Per-Image Overrides

`transformImgNode` and `transformInnerHtmlImages` read the per-image overrides of `site-architecture.md` §9.2.4 (`sizes`, `srcset`, `loading`, `fetchpriority`, `data-no-optimize`), the first from a node's `attributes` and the second from a tag's attribute string, where a name is matched whole (`data-src` is not `src`).

### 7.5 Caching (`image-cache.ts`)

`getImageCacheDir`, `loadCache`, `saveCache` with its pruning, and `usedVariantPaths` implement `site-architecture.md` §9.2.5. The key is `cacheKey`: `contentHash`, then `configHash` over `widths`, `formats`, `quality` and `PIPELINE_VERSION` (`image-optimizer.ts`), then the source's file name without its extension. `PIPELINE_VERSION` is bumped whenever the pipeline decides or encodes variants differently for the same settings, which changes both the key and, through `variantHash`, every variant's filename (§7.2). `getCached` marks a key as resolved by the build; whether an entry's variant files are still on disk is checked by `resolveManifest` (`image-transform.ts`).

### 7.6 Cloudflare Images Service

`resolveCfMeta` and `buildCloudflareSrcset` (`image-transform.ts`) implement `site-architecture.md` §9.2.6. When `images.service` is `"cloudflare"`, the variant pipeline is skipped entirely. Image optimization becomes pure markup — no code is generated or deployed:

- `transformImageNodes()` rewrites eligible `<img>` srcsets to Cloudflare [transform-via-URL](https://developers.cloudflare.com/images/transform-images/transform-via-url/) entries, one per configured width ≤ the original width: `/cdn-cgi/image/width=<w>,quality=<q>,fit=scale-down,format=auto/<src>?v=<contentHash8>` `format=auto` lets Cloudflare negotiate AVIF/WebP per browser; `quality` is the config's `quality.webp` value. Whitespace and commas in `<src>` are percent-encoded so the candidate cannot split, and nothing else is, because an authored `src` may already be encoded. The original `src` is preserved as fallback. The native core is used only for a header-only dimension read (memoized per build); when it cannot read one, the `srcset` is still written and only `width` and `height` are left off.
- Remote https sources from `images.remoteDomains` hostnames get the same treatment with the full URL as the transform source — every configured width is emitted (dimensions unknown; `fit=scale-down` prevents upscaling) and no `v` hash is appended.
- These URLs are served by Cloudflare's zone-level Image Transformations feature, which must be enabled in the dashboard; they do not resolve on `*.pages.dev` / `*.workers.dev` preview hosts. The build prints a reminder.

### 7.7 Build Integration

In `site-build`, the pipeline integrates at step 6 (per-route compilation):

1. Cache loaded if `projectConfig.images.optimize === true` and `images.service` is `"build"`; in `"cloudflare"` mode a per-build dimension memo is used instead
2. For each page, `transformImageNodes()` is called with the page document, the `images` config, the project root, the variant cache (`null` unless the build service is on), the dimension memo (Cloudflare service) and the extension asset mounts. It runs whatever `optimize` says, because the loading attributes and the focal point do not depend on it
3. Cache saved to disk after all routes are compiled (`"build"` mode only); stale entries are pruned first when every route compiled without errors, then the variants of every entry this build resolved are copied into `dist/images/_optimized/`

> **Status: Implemented.** `image-optimizer.ts`, `image-transform.ts` and `image-cache.ts` in `packages/compiler/src/site/` provide the pipeline, driven from `site-build`. Encoding is done by the compiler's native core (§14), which a project installs with the compiler and needs nothing else for.

---

## 8. Static Page Compilation

### 8.1 Fully Static Output

When `isDynamic()` returns false for an entire document, the compiler emits plain HTML/CSS with zero JavaScript.

**A boolean attribute is emitted by family, not stringified.** `buildAttrs()` defers to `booleanAttrValue()` in `@jxsuite/runtime` (spec.md §8.3): a presence attribute resolving to `false` is omitted and one resolving to `true` is emitted bare — `open`, never `open="true"` — while every `aria-*` and the three enumerated HTML attributes keep the written word in both directions.

Two things are specific to the static emitter. Absence has to be expressible HERE because it cannot be expressed before it: a template that resolves to nothing falls back to its own source text, which is what keeps an unresolvable binding alive for the client, so `false` is the only value that can mean "omit". And the emitter shares the rule with the runtime rather than restating it, because the same document is rendered both ways — a page whose `<details>` is closed when built and open when hydrated is the defect this prevents.

**An empty expansion collapses only when the build resolved the list.** When `items` resolves to an empty array at build time there is nothing to prerender, and what happens next depends on where the array came from (spec.md §10.5). Out of client state, an authored `{ "default": [] }` or a bare `[]`, the array is a starting value the browser may fill, so the repeater definition is kept for the client to bind: replacing it with the empty expansion would discard the binding and the list could never populate. Out of a source the build itself resolved, the empty array is the list's final answer, so the repeater is removed, nothing is emitted for it, and the page can still be zero-JS. A build-resolved source is one of:

- a state entry the build resolved through its class: `timing: "compiler"`, or no `timing` and a class mapping, which is how a content collection is written (`resolvePrototypes`);
- the entry a paged route replaced with its slice (site-architecture.md §4.3);
- the injected `$site` and `$page` context;
- a `$map/` pointer, because a row exists only while the build expands it and the client has no row to read the pointer against;
- a literal `items` array.

A build-resolved entry that a handler in the document writes is runtime-only on the terms below and keeps its repeater. An entry a `timing: "client"` or `timing: "server"` class lowered is not build-resolved. Both rules hold for a repeater in the whole-`children` position and for one among siblings, where a collapse removes the array member and leaves its siblings. A repeater whose `items` cannot be resolved at build time is left in place as before, and a non-empty expansion still prerenders with no JavaScript for the list, whatever its source. `expandMappedArrayStatic` in `packages/compiler/src/site/site-build.ts` decides it, from the set `buildResolvedStateKeys` computes.

**Runtime-only reads are left unresolved.** Prerender evaluates `${state.…}` templates against the build-time scope, but a state entry whose value only exists after hydration — a bodyless `$src` Function, a `$prototype: "Request"`, or a template entry reading either — has no build-time value to substitute. Resolving one anyway would replace the template in the emitted HTML with the placeholder's text, destroying the client-side binding rather than merely getting it wrong, so such a template is emitted unresolved for the client to populate. A read that _calls_ the entry is unaffected: invoking a build-time callable, such as a named formula (spec.md §19.4c), still evaluates during prerender.

**An entry a handler writes to is runtime-only.** A plain `{ "type": "string" }` entry holds a perfectly ordinary build-time value, so nothing else distinguishes it from a constant — but if any handler in the document assigns to it, baking `${state.x}` replaces the template and the element is dead for the life of the page, not merely stale. Before the main pass the scope builder scans every handler body in the document for writes to `state.x` — assignment (`=`, `+=`, `++`, …) and in-place array mutation (`push`, `splice`, `sort`, …) alike — and marks each target runtime-only. A mutating `$expression` contributes its `target` pointer the same way. The scan is narrow on purpose: an entry nothing ever writes stays bakeable, so prerendered content survives for SEO.

**The mark is transitive, and order-independent.** A `$prototype: "Function"` whose body returns is stored in the build scope as its already-evaluated _result_, so a template reading it sees an ordinary value and would bake it. A computed that reads a runtime-only entry is therefore runtime-only in turn, as is a template entry that reads one. The marks are propagated to a fixpoint after the main pass, so declaration order does not decide the answer, and a computed over constants alone still bakes.

> **Known limitation.** A `$src` handler's assignments live in a JS file the scope builder does not open, so an entry written only from there is still baked. Declaring the same entry's writer in the document, or reading the entry through a `Request`/`$src` value, restores the mark.

**An array is only stripped when nothing still reads it.** A build-time repeater expansion consumes its `items`, after which the array would be dead weight in client state. But a map expansion is one consumer, not the only one: the same array is routinely also read by a computed at runtime. An array state entry is therefore dropped only when no surviving state definition and no surviving node in the document still references it — as `${state.x}`, as a bare `state.x` in a handler or computed body, or as a `#/state/x` pointer — iterated to a fixpoint, since rescuing one array can reveal a read of another. An entry the author marked `timing: "compiler"` is exempt and is always stripped: that declaration is the author saying the data is build-time only.

**An inherited site entry is dropped on the same terms.** A project `state` entry that neither the page nor its layout declares reaches the page as its own entry (`site-architecture.md` §10.4), and, unread, it would make every page of the site dynamic. The build therefore drops it in the same fixpoint as an array, when no surviving state definition and no surviving node references it. A read through `$site` is not such a reference: `$site` is injected context. While a `$src` Function survives on the page, whether the page declares it or inherits and reads it, every inherited entry is kept, because that module's reads are invisible to the scan, and such a page is dynamic anyway. The scan covers the whole document except its `$head` and `title`, which are resolved into `<head>` during the build. It also skips `$paths`, which route discovery consumed before the page was compiled: its `paginate` pointer names the paged entry without reading it, so a page of a paged list whose rows the build wrote out is static. The scan reads `state.key`, `state?.key`, a literal-keyed `state["key"]` and a `#/state/key` pointer, and a body that hands `state` on whole (`const { key } = state`, `{ ...state }`) counts as reading every entry. An entry read in a form the scan cannot see (a computed key, `state[name]`), or wanted on every page only for its effect, is declared in the page's or the layout's own `state`, which exempts it.

**A pure named formula is dropped on the same terms, wherever it is declared** (§3). Declaring it in the page's or the layout's own `state` does not exempt it, because a formula has no effect to want: it is a function that either has a surviving caller or does not. A formula read only through a computed key (`state[name]`) is therefore dropped, and is read by its name (`state.key`, `state["key"]`) to be kept.

**A formula a component reads is the component's, not the page's.** A component inherits the project's closed pure named formulas (`spec.md` §13.4), and the build gives each component document the ones it reads before anything else sees it: `inheritProjectFormulas` (`packages/compiler/src/shared.ts`) merges them under the component's own `state`, for the definition every page prerenders from and for the module `compileElement` emits, its `$elements` dependencies included. A formula is read when the component names it in a form the scan above sees, or when another merged formula calls it; a component that declares a `$src` Function takes every inheritable formula, for the reason a page keeps them. So the page's strip pass is unaffected and needs no exemption: a page that reads `quadruple` nowhere drops its own copy as before, the component that calls it carries `quadruple` and the `double` it calls in its own module, written once per component that reads them, and a component that calls no project formula is byte-for-byte what it was. A static component stays static, so a page whose only formula call is inside one is still plain HTML with no script. Inheritance is from `project.json`, never from the page being built, which is what lets one emitted module serve every page.

**A component instance is expanded wherever it is written.** The site build expands a registered custom element it meets in the page tree: the instance's observed attributes (spec.md §16.5), coerced, then its `$props` (and any literal `props.*` attributes) over them, laid over the definition's `state`, the definition's template-string host styles resolved against that instance, the instance's own children, placed in its slots by name (spec.md §8.5), and a stamp — `data-jx-static` when the definition is fully static (a definition that declares `observedAttributes` never is), `data-jx-prerendered` with a `data-jx-props` payload (§4.4) when it is not. A light instance that is not static and whose definition has a `<slot>` also carries `data-jx-slots`, a number unique in the page, and each group it placed is bracketed by the comments `<!--jx-slot n name-->` and `<!--/jx-slot n-->`, the slot's name URI-encoded: the element discards its prerendered markup when it upgrades, and the brackets are how it finds the children it was given and the slot each went to. An instance written inside another component's own `children` gets exactly that expansion, recursively: the definition walk carries the same component registry, so a card that renders a button that renders an icon prerenders all three levels, each against its own props. A `$props` value that is a template resolves against the parent's scope; the instance's own children are rendered in the parent's scope, and a `<slot>` among them passes the grandparent's group of that name through; a shadow-mode instance gets its declarative root (spec.md §16.6). A template-string host style is resolved against every instance, whether or not it passes props — a static build drops a reactive declaration from the component stylesheet (it has no scope to resolve it against), so the value resolved at expansion is the only one a static page has, and an instance that takes the definition's defaults gets the defaults. The one difference is where the resolved value lands: a page-level instance's goes through the page's style pass as a class rule, a nested instance's is written on the element as an inline `style` (escaped like every attribute, so a prop carrying a quote cannot end it), with the same values in the same precedence (the definition's over the instance's own). Static-ness is decided per definition and never inherited — a live component nested inside a static one is a prerendered shell that loads its own module and upgrades in place, and the static parent still ships none.

Until 0.4.4 the definition walk had no registry. A nested instance went through the generic element path and came out as a bare tag — no content, no host style — under a parent still stamped static, so no module ever loaded to fill it and the content was simply gone (issue #286). Whether a component library rendered therefore depended on whether some unrelated part of the parent happened to need JavaScript.

**A definition that names itself is a build error, not a stack overflow.** The expansion path is tracked per instance — tag, resolved props and observed attributes (spec.md §16.9) — and meeting a frame already on the path is the instance rendering itself with the same props, the one shape that can never terminate. The route fails with a diagnostic naming the chain (`a-loop → b-loop → a-loop`) and the other routes still build. A self-reference whose props change at every level is data-driven recursion — a tree node rendering its children until a `$switch` on its depth says stop — and is allowed, bounded by a depth cap of 32 levels; exceeding it is the same kind of error, with the same chain.

### 8.2 CSS Extraction

All static `style` definitions are extracted into a single `<style>` block in `<head>`.

Nested selectors and at-rule groups are emitted per `spec.md` §9.2, including the popover states (`:popover-open`, `::backdrop`, `:popover-open::backdrop`) and the DECLARATION-body at-rules (`@position-try`, `@property`, `@font-face`, `@counter-style`), whose block carries no selector and is not scoped to the element whose `style` object declares it.

The nesting is resolved by `buildStyleRules` (`@jxsuite/runtime/css`), the same function the runtime (`spec.md` §9.6) and the site-style builder call, so a document previewed in Studio and the page this emits resolve the same tree. The compiler keeps what is its own: the element's handle, which `spec.md` §9.2 specifies; the comment it writes above each rule whose block carries a `$description` (`spec.md` §9.2); the `:host` translation of `spec.md` §16.6; and the `</style` escaping below.

Component stylesheets are extracted the same way. A page inlines the CSS of every light-DOM component it uses, appended after the page block so the cascade is unchanged, and emits no `<link rel="stylesheet">` for them — one render-blocking request per component was a page's entire critical request chain, for sheets averaging about 2 kB. The sheets are still written to `dist/components/<tag>.css` for anything that references them directly. A component in shadow mode is unaffected: its sheet is linked from inside the declarative shadow root.

The trade is deliberate. Inlined CSS repeats on every page instead of caching across navigations; it is small, it compresses against the markup around it, and a round trip on a phone costs more than the bytes do.

CSS inlined into a `<style>` element has `</style` escaped as `<\/style` — an HTML parser ends the element at that sequence wherever it appears, and style values are author data.

> **Status: Implemented.** `compile-static.ts` handles zero-JS output; `site-build`'s `injectComponentScripts` inlines the component sheets.

---

## 9. Dynamic Page Compilation

### 9.1 Pre-rendered HTML + Reactive JS

For dynamic documents that are not custom elements, the compiler emits:

- Pre-rendered HTML from static portions
- `@vue/reactivity` bootstrapper for dynamic state
- `effect()` bindings for reactive properties and template text children (§2.2)

> **Status: Implemented.** `compile-client.ts` handles dynamic page compilation.

### 9.2 `$switch` on a Dynamic Page

A `$switch` node compiles to a render binding on its container element, mirroring the mapped-array binding in the same target: the container carries `data-bind :render="_swN"`, and the module holds a case-keyed lookup over lit templates matched on `String(discriminant)`, with an empty template as the fallback. The discriminant may be a `#/state/…` pointer or a template string. A pointer reads the path it names, one member per `/` segment, and answers `undefined` (so the fallback template) while a parent member is still `null`, as the interpreter's read does: state that a server call or a fetch fills in starts as `null`. A repeater's `items` pointer is read the same way. An external `$ref` case cannot be fetched at compile time and is skipped, exactly as in the static renderer.

The container is emitted **empty**, with the matched case supplied at hydration. lit's `render` inserts into a container rather than replacing its existing children, so a prerendered branch would survive alongside the rendered one — the same reason the mapped-array binding prerenders nothing.

> **Status: Implemented.** Previously `buildClientNode` had no `$switch` branch at all: the node fell through to the generic element path, which emitted a container and then looked for `children` to recurse into. `cases` is not `children`, so the subtree was never visited and the page compiled to an empty `<div>` with the content missing and no error — while the same node through the element target (§4.8) emitted every branch correctly.

---

## 10. Pending Features

> **Status: Removed.** This was a status ledger, and it is retired: each feature it tracked is specified or declined on its own section. Compiler timing, a build-time fetch of a `Request` included, is `spec.md` §11.3's `"compiler"` row. A page's interactive regions reach the browser as prerendered HTML plus the page's own module (§9.1) and as prerendered component instances that upgrade from their `data-jx-props` payload (§4.4, §8.1), so no JSON hydration island is emitted. The browser modules a build ships are bundled per `$src` specifier as pages and components are emitted, and the runtime set is read back out of the finished HTML (§12), so no dependency manifest is written. The ledger's other rows are specified on §6.3, §7, and `site-architecture.md` §4.3, §5, §6.4, §8.3, §8.4.1, §11.1, §12.1 and §14.

---

## 11. Shared Utilities

Helpers that `packages/compiler/src/shared.ts` exports for the compilation targets and the site build. Each heading gives the parameters under the names the code declares, `?` marking an optional one. They are internal to `@jxsuite/compiler`: of them, the package root re-exports only `isDynamic`. The image pipeline's entry points, `transformImageNodes` and `processImage`, are specified with the pipeline (§7.2, §7.5), and the route each server entry becomes is shown in §6.3.

### `isDynamic(def)` — Recursive static detection

### `isSchemaOnly(value)` — Pure type definition detection (every key a JSON Schema keyword)

### `buildInitialScope(defs?, parentScope?)` — Static scope for compile-time pre-rendering

### `attrHelperSource()` — the boolean-attribute rule, inlined for a generated module

The element and client targets emit modules that load with `lit-html` and `@vue/reactivity` and nothing else, so they cannot call `booleanAttrValue` — they carry a copy whose enumerated-name list is serialized from `@jxsuite/runtime`'s `enumeratedAttrNames()`. A test asserts the emitted literal still equals that export, which is what keeps the four writers of the rule one decision (spec.md §8.3).

### `externalClassHelperSource()` — the external class contract, inlined for a generated module

A module holding a `timing: "client"` external class (§3) carries `__jxInstantiate`, for the reason `attrHelperSource()` gives: it constructs the class with its config and takes `resolve()`, else `value`, else the instance, the order `instantiateAndResolve` (`packages/compiler/src/site/external-class.ts`) applies during the build, and a test runs both over one matrix of class shapes. `emitExternalClassResolution(entries, opts)` writes the `Promise.all` that calls it once per entry, and `collectClientClasses(defs, resolveClass?)` finds the entries and the import each distinct class module needs.

### `propSupplyHelperSource()` — the prop-supply rule, inlined for a generated module

An element module with a property bridge (§4.4) carries two functions, for the reason `attrHelperSource()` gives. `__jxSupplies` restates `instanceSupplies` from `@jxsuite/runtime`, the rule of spec.md §13.2, and a test runs both over one matrix of key, own property and attribute, which is what keeps the copy from drifting. `__jxNativeSetter` finds the platform's own setter for a key on the prototype chain, which a forwarding accessor calls before it writes state (spec.md §16.2).

### `observedAttrHelperSource()` — the observed-attribute rule, inlined for a generated module

An element module whose definition declares `observedAttributes` (§4.1) carries `__jxAbsorbAttr`, for the reason `attrHelperSource()` gives: it restates `absorbAttribute` from `@jxsuite/runtime`, the rule of spec.md §16.5, and a test runs both over one matrix of held type, attribute value and default. The defaults the module passes it are not re-derived: `observedDefaultsSource(def)` serializes the runtime's `declaredDefaults(def)` for the observed keys as a `Map` built per use, and the same test evaluates that source against the runtime's answer.

### `observedAttributeProps(def, attributes, scope)` — an instance's observed attributes as build-time props

What the prerender lays beneath an instance's `$props` (§8.1): each observed attribute the instance writes with a statically resolvable value, as the text `buildAttrs` would emit for it, coerced by the runtime's own `absorbAttribute`. Null when the instance writes none.

### `compileStyles(doc, mediaQueries?, projectStyle?)` — CSS extraction from component tree

Project-level emission order is: base `:root` (custom properties) and `body` (direct properties) rules first, then conditional `@`-blocks, so equal-specificity overrides win by source order. Inside a project-level `@`-block, custom properties land on `:root`, direct properties on `body`, and selector-keyed sub-objects on their own selector. Blocks keyed by a pure `prefers-color-scheme` query dual-emit per the forced-scheme contract (spec §9.5): a media-guarded copy (`:where(:root:not([data-color-scheme]))`) plus an unconditional forced copy (`:root:where([data-color-scheme="…"])`), both specificity-neutral via `:where()`. When any `$media` value is a pure scheme query, `compileStyles` also emits the `color-scheme` declaration triplet on `:root` (suppressed when the author sets `colorScheme` in project style), and the compilation targets inject the pre-paint scheme-restore `<script>` (`colorSchemePrePaintScript()`) into `<head>` ahead of all style blocks — the site pipeline does this via the merged head (`prePaintScheme: false` disables the target-level copy).

### `collectServerEntries(doc)` — Find all `timing: "server"` entries

> **Status: Implemented.** Shared utilities in `packages/compiler/src/shared.ts`, where `isSchemaOnly` is re-exported from `@jxsuite/schema/guards`.

---

## 12. Sidecar Bundling

The site build bundles Function-def `$src` modules for the browser (`packages/compiler/src/site/bundler.ts`; behavior contract in spec.md §5.3 "Compiled-site delivery"):

- **Collection**: during page and component emission, every bundleable `$src` specifier (`npm:<pkg>[/subpath]`, `./relative` — `.ts` allowed) is rewritten to its deterministic `/assets/<slug>.js` URL and registered; lowered defs contribute additional specifiers via `$bundle` (extensions.md §8.3). Relative specifiers resolve against their declaring document's directory and key on the project-relative resolved path; two distinct entries colliding on one slug is a build error. Non-Function `$src` (`.class.json` descriptors) and absolute/URL specifiers are never touched.
- **Document scripts** (`spec.md` §23.2, `packages/compiler/src/site/document-scripts.ts`): a qualified `jx-script:<path>#client` specifier is one bundle per document, at the `/assets/` URL its project-relative path slugs to (`pages/index.json` is `/assets/pages-index.json.js`), so a page and its layout each keep their own module, and an eager entry and a `$lazy` one of the same document import the same file. The module is bundled from the document's text as though it stood beside the document, at `<document>.jx-client.ts`, a path no file is written to, so its relative imports resolve from the document's directory. One plugin, given to every browser bundle and to the worker's, resolves a `jx-script:` specifier and an import of a `.jxn` document (its client module) and loads either from the document, read once per build; in a browser bundle it refuses a server module however the import was spelled. A document with no script for the side an entry names, a client Function naming `#server`, and a `#client` entry in `project.json`'s `state` are build errors naming the document. So is a script, client or server, that uses TypeScript the eraser cannot remove (`enum`, a value `namespace`, a parameter property): the plugin reads each script through `eraseModule` before handing it to the bundler and fails with the document, `/$script/<side>`, and the line and column, because an interpreting host erases a script and would fail where the build had passed. `@jxsuite/compiler/document-scripts` exports the same reader and plugins, which is how a development server runs one document's server script without a build (`server.md` §3.3). `@jxsuite/compiler/bun-plugin` registers the same resolution with Bun's module loader, so a test imports a `.jxn` document's client module by its path, and its server module by its path with `?server`.
- **Class modules**: each `timing: "client"` external class (§3) gets an entry module that default-exports its class (from its `$implementation`, or generated per §5.4) at `/assets/class-<Name>.js`, `<Name>` being the export the class is read by. All of a build's class entries are bundled in one call with code splitting, so a module two classes import is one instance on the page, shipped once as `/assets/chunk-<hash>.js`. Two different class documents with one name are a build error. A Function sidecar keeps its one bundle per specifier, so a sidecar that imports a class's module gets its own copy of it.
- **Bundling** runs once after routes, components, and the worker are generated: one self-contained ESM bundle per unique specifier, with `@vue/reactivity` and `lit-html` left external (the page importmap provides them). `timing: "compiler"` code is never bundled.
- **The server target**: when `build.adapter` is set, the generated worker entry (§6) is bundled self-contained through the same backend — `workerBundleOptions(adapter)` maps cloudflare adapters to `workerd`/`worker` resolution conditions with `cloudflare:*`/`node:*` external and bare builtins (`tls`, `os`, ...) rewritten to external `node:` imports (nodejs_compat provides builtins; postgres 4 imports them unprefixed), and node/bun to platform-native bundling. Extension mounts, connectors, hono, and user server modules are inlined, so `dist/` deploys and runs without `node_modules` — verified by importing the bundled worker from an empty directory in tests. The former copy of server sources into `dist/components/` is gone.
- **The client runtime**: `@vue/reactivity` and `lit-html` are bundled from **this package's** dependencies into `/assets/vue-reactivity.js` and `/assets/lit-html.js`, and the emitted import map points there. They resolve from the compiler rather than the project because the compiler is what depends on those versions — a project that never installed them still gets the runtime its output was compiled against. If neither resolves, the map falls back to the CDN URLs with a warning, since a page with no runtime is worse than a page with a third-party one. Emitted once per build, and only when some page actually carries an import map.

  **Outside a site build the import map names a CDN.** `compile`, `compileClient` and `compileElementPage` write a page with no `/assets/` beside it, so their import map defaults to one pinned `https://esm.sh` URL per runtime module (`DEFAULT_REACTIVITY_SRC`, `DEFAULT_LIT_HTML_SRC` in `shared.ts`, the same pair for all three). No integrity metadata is emitted, and none would help: the URL answers a re-export stub whose own imports a hash on the stub does not cover. A page compiled this way trusts that CDN with script execution, so `reactivitySrc` and `litHtmlSrc` take self-hosted URLs for anything that is deployed.

  **The set is read back out of the finished HTML**, not recorded where a map is written. A page acquires a map by more than one route — the component injector adds one, and the page-template tiers (§3) each emit their own — and a set filled at one of those sites describes the build only when that site is the one that ran. Recording only the component injector's meant a project with interactivity but no components shipped a map naming `/assets/vue-reactivity.js` with no `dist/assets/` at all: 404 on both modules, a blank page, and a build reporting success with zero errors. What the shipped HTML names and what the build writes are therefore one set, derived from the artifact rather than from an intention. Prefix keys (`"lit-html/"`) and CDN fallbacks are excluded: neither names a file this build produces.

- **Backends**: `Bun.build` when the build runs under Bun; esbuild (dynamically imported, a `@jxsuite/compiler` dependency) under plain Node. Options are minimal and identical (`format: esm`, browser target). Browser bundles are **minified**; `build.minify: false` opts out, and non-browser targets stay readable because their output is read off a stack trace rather than parsed on a phone. Browser bundles define `process.env.NODE_ENV` as `"production"`: the substitution matters (a browser has no `process`) but the resolution matters more, because that value decides which `exports` condition a package offers. Bun reads it from the build's own `define` and assumes development without it, so the two backends were resolving different files — `lit-html`'s 31 kB development build under Bun against its 10 kB production build under esbuild. `JX_BUNDLER=esbuild` forces the fallback. Byte-level output may still differ between backends — the two minifiers agree on semantics, not on bytes — so a repo tracking `dist/` should build with one backend consistently.

  Component modules (`dist/components/<tag>.js`) are emitted source rather than bundles and are **not** minified; only what passes through the bundler is.

> **Status: Implemented** via `site-build` steps 6d (bundling) and 6e (extension `emit`, extensions.md §8.4).

---

## 13. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). `lit-html` and `@vue/reactivity` are libraries rather than standards; Appendix A records them as dependencies.

| Standard                                                                                  | Class         | Binds  | Evidence                                                                                                                      | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ECMA-262](https://ecma-international.org/publications-and-standards/standards/ecma-262/) | **Adopted**   | §4, §5 | packages/compiler/src/targets/compile-element.ts, packages/compiler/tests/no-eval.test.ts                                     | Emitted modules are plain ECMAScript modules containing no `new Function` and no `eval`, which is what lets compiled output run under a policy without `'unsafe-eval'` — asserted by a committed test.                                                                                                                                                                                                                                                                                                      |
| [WHATWG HTML](https://html.spec.whatwg.org/)                                              | **Subset**    | §3, §4 | packages/compiler/src/targets/compile-element.ts, packages/compiler/src/shadow.ts, packages/compiler/tests/shadow-dom.test.ts | Custom elements are defined and rendered into the **light** DOM by default, where `<slot>` is emulated by splicing saved children. A component may opt into a shadow root with `$shadow` (spec.md §16.6): the prerender emits a declarative `<template shadowrootmode>` and the element module adopts it, an `open` root through `element.shadowRoot` and a `closed` one through `ElementInternals`. Not offered: `ElementInternals` for form association, and `::part` addressed from outside a component. |
| [CSP Level 3](https://www.w3.org/TR/CSP3/)                                                | **Subset**    | §3     | packages/compiler/tests/no-eval.test.ts, packages/compiler/src/site/csp.ts                                                    | What the tiers owe the policy: no `eval`, no `new Function`, and no `onclick=` attribute — handlers are bound as listeners — plus two inline blocks that are byte-identical across a build, so one hash each names them site-wide. The policy itself is assembled and emitted by the site build (`site-architecture.md` §14.3.1).                                                                                                                                                                           |
| [Subresource Integrity](https://www.w3.org/TR/SRI/)                                       | **Divergent** | §12    | packages/compiler/src/site/client-runtime.ts, packages/compiler/tests/client-runtime.test.ts                                  | The gap this standard existed to close is closed by **removal** rather than by attestation: the runtime is served from the site, so there is no cross-origin subresource left to hash. SRI would apply again only if a project overrode the import map back to a URL, and the build cannot compute an integrity value for a file it never fetched.                                                                                                                                                          |
| [Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/)                   | **Divergent** | §6     | packages/compiler/src/targets/compile-server.ts, packages/compiler/tests/compile-server.test.ts                               | The generated worker reads `Sec-Fetch-Site` in front of every server function and extension mount. Two deviations from the Resource Isolation Policy: `same-site` is refused, because a sibling subdomain is not the site's own script, and a navigation passes whatever its method, because an identity provider's `form_post` answer is a cross-site POST navigation; the routes that read a body require a JSON `Content-Type` instead. An absent header is accepted, since only a browser sends it.     |

## 14. Native Core

> **Status: Implemented.** The Cargo workspace in `packages/compiler-binding/` (`crates/jx_media`, `crates/jx_napi`), its loader `packages/compiler-binding/src/index.ts`, and the image pipeline of §7 as its first consumer. Tested by the crates' own suites and, through the real addon, by `packages/compiler-binding/tests/binding.test.ts`.

Part of the compiler is written in Rust and loaded as a [Node-API](https://nodejs.org/api/n-api.html) addon, `@jxsuite/compiler-binding`. The rest of the compiler stays JavaScript and calls it: the addon does work that is pure computation over bytes, and everything that must run a project's own JavaScript (extension capabilities, `$prototype` resolution, build-time templates) stays where that JavaScript can run.

**It links no C library.** Every codec is compiled into the addon, which therefore needs nothing but the platform's C runtime and has nothing to install beside it. This is a rule, not an accident: the library it replaced loaded a prebuilt `libvips` that needed a `libstdc++` some systems keep in no standard place, and image optimization failed there until each such system was patched. The rule has a cost, stated in §7.2: there is no lossy WebP.

**One file per platform.** A triple names one build: `linux-x64-gnu`, `linux-x64-musl`, `linux-arm64-gnu`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64-msvc`, `win32-arm64-msvc`. The file is `jx-compiler.<triple>.node`, and npm carries each in a package of its own, `@jxsuite/compiler-binding-<triple>`, declaring the `os`, `cpu` and `libc` it runs on, so an install fetches only the host's.

**Loading.** Nothing is loaded until the first call, so a build that optimizes no image never needs the addon. The loader then tries, for each triple the host can run:

1. `jx-compiler.<triple>.node` in the package's own directory, where a checkout builds it (`bun run build:addon`), so a contributor runs the Rust they are editing.
2. The same file beside the module that holds the loader, which is where an application that bundles the loader stages it (the desktop backend, `desktop.md` §7.1).
3. The package `@jxsuite/compiler-binding-<triple>`.

On Linux both C libraries are tried, the detected one first. When nothing loads, the error names every attempt and its failure, because a file that exists and cannot load is a different problem from a file that is missing.

**Calls.** A call that does real work returns a promise and runs off the JavaScript thread. Inside it, work fans out across a thread pool whose size is the machine's parallelism, and that pool is the pipeline's one concurrency limit. A failure is a rejected promise whose message names the file and the reason.

| Function                | Does                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `imageMetadata(source)` | Reads a source image's oriented dimensions and format from its header               |
| `processImage(request)` | Writes every missing variant of one source image and describes the whole set (§7.2) |
| `coreVersion()`         | The version of `@jxsuite/compiler-binding` the addon was built for                  |

## Appendix A — Production Dependency Stack

Served from the site under `/assets/` (§12), not from a CDN. Sizes are the bundles this build actually emits — minified ESM — measured with `gzip -9`:

| Package           | Raw       | gzip        | Purpose                                |
| ----------------- | --------- | ----------- | -------------------------------------- |
| `@vue/reactivity` | 20.7 kB   | 7.8 kB      | `reactive()`, `computed()`, `effect()` |
| `lit-html`        | 7.3 kB    | 3.3 kB      | `html`, `render()`                     |
| **Total**         | **28 kB** | **11.1 kB** |                                        |

Un-minified the same two bundles were 48.7 kB and 10.6 kB raw (59 kB, 14.8 kB gzip). The raw column is the one that matters most: it is the source a low-end phone parses and compiles before anything can paint, and compression does nothing for that. Minified, `@vue/reactivity` lands within a kilobyte of the `reactivity.esm-browser.prod.js` build Vue ships itself, so no export-condition change is needed to reach it.

An earlier revision of this table claimed ~7 kB and ~3 kB (~10 kB total); those figures described neither file.

## Changelog

- **0.7.12** (2026-11-14) — Cloudflare worker bundles keep bare Node builtins (tls, os, ...) external as node: imports, so packages that import them unprefixed (postgres 4) bundle.
- **0.7.11** (2026-11-14) — §7 names the code behind each part of the image pipeline and cites site-architecture.md §9.2 for its behaviour; the native core's request takes one name hash per format, and the build copies only the variants it used.
- **0.7.10** (2026-11-14) — §2, §5.2, §5.3 and §5.6 describe the class document that ships: route 0 is taken on a root whose $prototype is "Class" whatever the file is called, the §5.2 example validates against the class schema and runs once compiled, §5.3 states what route 0 emits for each $defs category, and every module route 0 writes loads, a parameterless setter taking v, a source not named .class.json compiling to .js beside it, and an extends $ref importing its base.
- **0.7.9** (2026-11-14) — §10: the Pending Features ledger is retired and marked Removed. Compiler timing is specified by spec.md §11.3, a page hydrates through its own module and prerendered component instances rather than JSON islands, and no dependency manifest is written (§12); §12 no longer names island emission as a sidecar-collection site.
- **0.7.8** (2026-11-14) — The compiled element accepts a prop for every declared state key, takes a reflected-name prop by the runtime's supply rule, and forwards later property writes into state through accessors.
- **0.7.7** (2026-11-14) — §2.2: a template string written as a text child is baked by the site build when it reads only build-time values, makes its page dynamic otherwise (§2.1 now counts it), and is bound by the client target between two comment markers with no wrapper element, or refused where HTML reads an element's content as text; §2.2 is Implemented.
- **0.7.6** (2026-11-14) — §11 lists the helpers shared.ts exports under the parameters they take; buildRoute leaves the list, and the image pipeline's entry points are specified with the pipeline in §7.
- **0.7.5** (2026-11-14) — A compiled element passes the host to onMount on its first connection, runs onAdopted from adoptedCallback, and observes its declared attributes through an inlined copy of the runtime's rule; the site build reads an instance's observed attributes beneath its props, counts them in the expansion path, and never treats a definition that declares them as fully static.
- **0.7.4** (2026-11-14) — The element binding table shows the emitted forms: an event handler receives the event, a top-level key such as hidden binds as a DOM property, and a bound attribute goes through the inlined boolean-attribute rule rather than a lit boolean binding; the worked example and the WHATWG HTML note match compiled output.
- **0.7.3** (2026-11-14) — §8.2: CSS extraction writes each rule's description as a comment above it and takes its style handle from spec.md §9.2.
- **0.7.2** (2026-11-14) — A derived sizes takes the narrower of each element's literal width and max-width as well as the narrowest across its ancestors, and reads no nested style block.
- **0.7.1** (2026-11-14) — §8.2's status marker records that the compiler gives every styled element a generated class of its own, with no id preference.
- **0.7.0** (2026-11-14) — A site build constructs every external class a page or component names: at build time, with or without an $implementation, reading value after resolve, and in the browser from a bundled, code-split class module the compiled page or element awaits before its first render; an entry the build cannot locate, load, resolve, lower or deliver now fails the build.
- **0.6.1** (2026-11-14) — Every section is Implemented: the spec graduates out of draft.
- **0.6.0-draft** (2026-11-13) — §7: images are encoded by the compiler's own Rust core instead of sharp. The default formats become avif and jpeg, WebP is written losslessly with a build warning, a transparent source asked for as JPEG is written as PNG, EXIF orientation is applied, embedded colour profiles are converted to sRGB, an AVIF source is served as written, variants encode in parallel, and a variant's name covers the pipeline version. New §14 specifies the native core: one addon file per platform, how it is loaded, and that it links no C library.
- **0.5.16-draft** (2026-11-13) — §8.1: the build merges into each component the project formulas it reads, for the prerender and the emitted module, so a formula only a component reads is not lost to the page strip pass.
- **0.5.15-draft** (2026-11-13) — §8.1: an empty repeater expansion collapses when the build itself resolved the list's source, and is still kept for the client when the source is client state or a build-resolved entry a handler writes. The reference scan skips `$paths`, so a page of a paged list is static when nothing else on it is dynamic.
- **0.5.14-draft** (2026-11-13) — §2.1, §3, §8.1: a pure named formula is a function, not state. It makes a node dynamic only while something left for the client reads it, and the site build drops one whose every call it resolved, so a page whose only state is a formula builds static. The reference scan also reads `state?.key` and a literal-keyed `state["key"]`, and a body that hands `state` on whole keeps every entry.
- **0.5.13-draft** (2026-11-13) — §2.3: `jx format [paths…] [--check]` formats the function bodies and scripts a `.jxn` file holds, and the file around them, keeping the comments of a file that has any.
- **0.5.12-draft** (2026-11-13) — §12: a build refuses a client or server script that uses TypeScript the eraser cannot remove, and @jxsuite/compiler/document-scripts exports the reader and plugins.
- **0.5.11-draft** (2026-11-13) — §12: the site build bundles each document's client module from its $script, resolves an import of a .jxn document, and keeps a server module out of every browser bundle; §6.3 collects #server entries by document; §2.3 qualifies them as a document is read.
- **0.5.10-draft** (2026-11-13) — A server function that throws answers a fixed "Server error" and logs the cause instead of sending its message; the standalone targets share one pinned CDN default per runtime module (§6.1, §6.3, §12).
- **0.5.9-draft** (2026-11-13) — §6.4 request gate: the generated worker refuses cross-site and same-site requests that are not navigations in front of every server function and extension mount, server functions answer 415 to a body not declared JSON, and responses carry nosniff, Cross-Origin-Resource-Policy and a default no-store.
- **0.5.8-draft** (2026-11-13) — §4.4: a compiled element put back in a document keeps the tree it drew. The container is cleared, and slotted children captured and distributed, on the first connection only; a later connection restarts the effects.
- **0.5.7-draft** (2026-11-13) — §8.1: a project state entry a page inherits is dropped from the built page on the same terms as an array, unless a $src handler survives on the page, and the reference scan covers the whole document except its head and title.
- **0.5.6-draft** (2026-11-08) — §2.3: a document's function bodies are erased from TypeScript as it is read, and jx validate reports a body that cannot be.
- **0.5.5-draft** (2026-11-08) — §2.3: jx convert moves the project file between project.json and project.jxn.
- **0.5.4-draft** (2026-11-08) — §7.2 and §7.6: srcset candidate URLs are percent-encoded so a file name with a space or comma cannot split a candidate; §7.5: the image cache key includes the source's file name, so a renamed image gets variants under its new name.
- **0.5.3-draft** (2026-11-07) — §2.3: reading a document whichever native format it is in, and jx convert.
- **0.5.2-draft** (2026-10-29) — The image cache's npm lookup reads npm_config_cache first and gives npm config get cache 3 seconds.
- **0.5.1-draft** (2026-10-27) — §9.2: a compiled switch discriminant and a repeater's items read a nested pointer by its path and answer undefined through a null parent, as the interpreter does.
- **0.5.0-draft** (2026-10-27) — §6.2 removed: the site build writes no per-page server handler and compileServer is no longer exported; §1 and §6.3 require build.adapter for a server-timed entry, as for an active mount.
- **0.4.8-draft** (2026-10-27) — §6.3: the site worker serves every timing server entry a page, its layouts, project.json state or a compiled component declares, each relative $src resolved against its own document, and two modules exporting one name fail the build.
- **0.4.7-draft** (2026-10-27) — §6.1 and §4.1: both compile targets emit the server-function call, a POST to the based /_jx/server route carrying the resolved arguments, re-run from an effect when an argument is a reference.
- **0.4.6-draft** (2026-10-17) — §8.1 a prerendered component instance places its children by slot name, and a live one carries data-jx-slots with named comment brackets so its element recovers them on upgrade.
- **0.4.5-draft** (2026-09-29) — Census against the code: §2, §2.2, §4.1, §4.3, §4.4, §5.2, §5.3, §5.4, §5.6, §6.1, §6.2, §6.3, §7.1, §7.2, §7.2.1, §7.3, §7.5, §7.7 and §11 marked Partial, §3's marker restated now that the opt-in CSP ships and widened to self-contained compiler-timed classes, the stale §6.3 and §7.7 markers corrected, and the §10 Pending Features ledger retired onto its feature sections except the three rows no other section yet tracks as open. §8.2 now leads with Partial, since the style handle keys rules on the author's first class rather than a generated one.
- **0.4.4-draft** (2026-09-13) — §8.1: a component instance nested inside another component's definition is expanded — props, host style, stamping — recursively, with a cycle diagnostic and a depth cap; a template host style resolves for every instance, props or not.
- **0.4.3-draft** (2026-09-01) — CSS extraction delegates its nesting to buildStyleRules, the one definition the runtime and the site builder also use; 4.5's example shows the emitted rule form.
- **0.4.2-draft** (2026-08-31) — CSS extraction emits the popover states and the declaration-body at-rules; attrHelperSource inlines the boolean-attribute rule for the generated-module targets.
- **0.4.1-draft** (2026-08-27) — §12: the client-runtime asset set is derived from the emitted HTML, so every import map a build ships names files it wrote.
- **0.4.0-draft** (2026-08-26) — Browser bundles are minified (§12); component CSS is inlined rather than linked (§8.2); image sizes derives from the container and variants stop at the configured ceiling (§7.2, §7.2.1).
- **0.3.3-draft** (2026-08-26) — §8: the boolean-attribute rule is shared with the runtime rather than restated, and covers the enumerated family.
- **0.3.2-draft** (2026-08-26) — Static output omits a false boolean attribute and emits a true one bare.
- **0.3.1-draft** (2026-08-18) — §4.3: separate the emitted-JavaScript accessor form from the pointer grammar it lowers.
- **0.3.0-draft** (2026-08-17) — §4.3: ref lowering goes through the shared tokenizer — identifier segments dot, all others bracket, so every emitted ref parses.
- **0.2.1-draft** (2026-08-15) — §3 Implemented — the tiers' inline blocks are hash-nameable and the site build emits the policy.
- **0.2.0-draft** (2026-08-15) — Client runtime is served from /assets/ instead of esm.sh; browser bundles resolve production export conditions under both backends (§3, §12).
- **0.1.28-draft** (2026-08-15) — §3: node_modules URLs resolved — bare $head/$elements specifiers land in /assets/.
- **0.1.27-draft** (2026-08-15) — Add §13 Standards Alignment; §3 marked Partial — inline scripts block a strict CSP and node_modules URLs 404 in production.
- **0.1.26-draft** (2026-08-14) — $switch compiles on dynamic pages (§9.2); branch subtrees hoisted out of $switch and chosen-tagName constructs (§4.8); prerender treats handler-written entries and computeds reading them as runtime-only, and keeps an array any surviving reader still references (§8.1).
- **0.1.25-draft** (2026-07-30) — Element modules: props.* attribute intake and $props template bindings, one effect registry stopped on disconnect, state.$map published for map handlers; prerender keeps a repeater whose build-time expansion is empty (§4.1, §4.2, §4.4, §4.7, §8.1).
- **0.1.24-draft** (2026-07-30) — Element modules: $export aliasing, Request auto-fetch on connect with effect teardown, $map bound in map callbacks, tagName-based output naming; prerender leaves runtime-only reads unresolved (§4.1, §4.7, §8.1).
- **0.1.23-draft** (2026-07-24) — §1 Overview: condition the generated Hono worker on build.adapter (per-page _server.js without one) and scope the static-build failure to active data/auth mounts; §6.3 document compileSiteServer's mounts/connectors parameters and extension mount emission.
- **0.1.22-draft** (2026-07-23) — Image src resolution consults extension asset mounts before public/ (§7.3).
- **0.1.21-draft** (2026-07-22) — Proper spec versioning (`fb0f3ec7`).
- **0.1.20-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`79daba23`).
- **0.1.19-draft** (2026-07-17) — Forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script (`e629684d`).
- **0.1.18-draft** (2026-07-17) — Bundle the site worker self-contained per adapter (`4096ba12`).
- **0.1.17-draft** (2026-07-17) — Sidecar bundling, extension emit capability, heading anchors (`07e28bc3`).
- **0.1.16-draft** (2026-07-17) — Image pruning for persistent site build cache + github ci cache (`b45096ed`).
- **0.1.15-draft** (2026-06-10) — Update site architecture to reflect new changes (`c0bdba08`).
- **0.1.14-draft** (2026-06-10) — Consolidate markdown and csv handling to the parser package (`8b1ba6da`).
- **0.1.13-draft** (2026-06-03) — Use `.cache` isntead of `.jx-cache` to support cloudflare build cache (`1103d2d6`).
- **0.1.12-draft** (2026-06-01) — Stronger typing (`fcbb5b5d`).
- **0.1.11-draft** (2026-06-01) — Convert to typescript (`e352e265`).
- **0.1.10-draft** (2026-05-20) — Run formatter (`8ba47930`).
- **0.1.9-draft** (2026-05-18) — Always emit worker.js for cloudflare (`3dd37c2d`).
- **0.1.8-draft** (2026-05-15) — Image optimization specs (`7d2ee67f`).
- **0.1.7-draft** (2026-05-15) — Provider-sepcific Site-Wide Bundling (`51cb5cf6`).
- **0.1.6-draft** (2026-04-23) — Rebrand to jxsuite (`2897a4e8`).
- **0.1.5-draft** (2026-04-22) — Consolidate project config schema and rename as such (`e3523dbf`).
- **0.1.4-draft** (2026-04-20) — Text nodes support (`4d45eeb7`).
- **0.1.3-draft** (2026-04-16) — Landing site + working exports + release-it + linting (`a8409b5f`).
- **0.1.2-draft** (2026-04-15) — Rebrand to Jx / Jx Platform (`abc63f2d`).
- **0.1.1-draft** (2026-04-10) — Finalize vision for site architecture (`da594993`).
- **0.1.0-draft** (2026-04-10) — Consolidate specs (`80ca313f`).

---

_`@jxsuite/compiler` Specification v0.7.12_
