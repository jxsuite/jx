---
title: "How compilation works"
description: "What jx build does (route discovery, static detection, the output tiers) and why most Jx pages ship zero JavaScript."
spec:
  - compiler.md#2 # compilation routes
  - compiler.md#2.1 # static detection (isDynamic)
  - compiler.md#3 # output tiers
  - compiler.md#8.2 # CSS extraction
  - compiler.md#8.1 # fully static output, runtime-only reads left unresolved, component instances expanded at every level
  - compiler.md#9.1 # pre-rendered HTML + reactive JS
  - compiler.md#4.1 # element module output structure
  - compiler.md#4.4 # property bridge: the data-jx-props payload
  - site-architecture.md#10.3 # which components a build compiles
  - spec.md#16.8 # the Custom Elements Manifest a build writes
  - compiler.md#4.9 # element packs
code:
  - packages/compiler/src/site/site-build.ts
  - packages/schema/src/cem-manifest.ts
  - packages/compiler/src/targets/compile-pack.ts
  - packages/compiler/src/site/component-set.ts
  - packages/compiler/src/site/client-runtime.ts
  - packages/compiler/src/site/bundler.ts
  - packages/compiler/src/site/pages-discovery.ts
  - packages/compiler/src/site/external-class.ts
  - packages/compiler/src/targets/compile-static.ts
  - packages/compiler/src/targets/compile-client.ts
  - packages/compiler/src/shared.ts
  - packages/compiler/src/child-separator.ts
---

# How compilation works

`jx build` turns a Jx project (JSON documents in `pages/`, `layouts/`, and `components/`) into a production site in `dist/`. The compiler erases the Jx abstractions at build time: no JSON documents, no interpreter, and no framework code ship to production. A page only gets JavaScript when the compiler can prove it needs some, and the proof runs in one direction: everything is static until something dynamic is found.

The only client-side dependencies a page can end up with are `@vue/reactivity` (7.8 kB gzip) and `lit-html` (3.3 kB gzip), loaded through an import map, and only on pages that need them. Both are served from your own site, under `/assets/`.

## What `jx build` does

Running `jx build` (see [CLI commands](/docs/framework/build/cli)) orchestrates one pipeline:

1. **Load the project file** and register the extensions it declares (`extensions`), which contribute file formats such as Markdown pages.
2. **Discover routes** by scanning `pages/`: `pages/index.json` → `/`, `pages/about.json` → `/about`, `pages/blog/[slug].json` → `/blog/:slug`, `pages/docs/[...path].json` → catch-all. Files starting with `_` are not routed. `.json` pages are native; other extensions (like `.md`) route through a format registered by an enabled extension. A file whose name breaks the [routing rules](/docs/framework/site/routing#dynamic-routes) is reported as a build error.
3. **Expand dynamic routes**: a `[param]` page's `$paths` definition produces one concrete route per entry, or one per page of a [paged list](/docs/framework/site/routing#paging-a-list). The page's own URL pattern is handed to the extension that owns the `$paths` shape, which is how a content type with a `route` produces exactly the parameters each page needs (see [Routing](/docs/framework/site/routing)).
4. **Compile components**: every component file directly in `components/`, plus every component a page, one of its layouts or `project.json` names in `$elements` with `{ "$ref" }`, wherever the file lives (a subfolder of `components/`, or a `_`-prefixed file next to a page), and the components those name in turn. A `$ref` is relative to the file that declares it. A `$ref` that names no file, a file outside the project or a file with no hyphenated `tagName`, and two files declaring the same `tagName`, are build errors.
5. **Compile each route**: resolve its layout, merge `$head` from site + layout + page, inject the read-only `$site`/`$page` context, resolve build-time data, transform images for responsive output, then hand the assembled document to the compiler.
6. **Emit `dist/`**: one `index.html` per route (with `build.trailingSlash: "always"`, the default), compiled component modules and CSS under `dist/components/`, `custom-elements.json` (when at least one component compiled), `public/` copied verbatim, plus `sitemap.xml` (when `url` is set in the project file), `_redirects`, and a bundled server worker when `build.adapter` is set (`worker.js`, or `_worker.js` + `_routes.json` for Cloudflare Pages).

A generated file with no date of its own to report, such as the `<updated>` of a feed with no entries, is stamped with the build time. Set `SOURCE_DATE_EPOCH` (seconds since the Unix epoch) and that time is the one you give, so rebuilding a commit writes the same bytes; leave it unset and it is the clock. A value that is not a non-negative integer fails the build.

The build finishes with a summary (`Done: 12 routes → 34 files`) and exits non-zero if any route or component failed.

## Static detection

The routing decision is a single recursive tree walk (`isDynamic()`) that never executes your code. A document compiles to plain HTML unless the walk finds one of:

- a `state` entry that exists at runtime (a plain value, a `$prototype` entry, or anything with a `default`)
- a `${…}` template string in a property, style, or attribute value, or written as a text child in `children`
- a `$ref` binding on an element property
- a `$switch` node
- a mapped array (`$prototype: "Array"`)
- any child that is itself dynamic

Five kinds of state are exempt because they are resolved during the build and then removed:

- the injected `$site` and `$page` context (read-only, never reactive)
- entries with `timing: "compiler"` (resolved at build time and baked into the HTML)
- schema-only definitions (pure type information produces no output)
- a `project.json` `state` entry the page inherits but nothing on it still reads as `state.<key>` once templates are filled in (dropped from that page)
- a pure [named formula](/docs/framework/concepts/expressions#named-formulas-and-call) that nothing left for the browser still calls, wherever it is declared (a formula is a function, not a value, so a page whose only state is a `formatDate` it calls from a template stays zero-JS)

A formula that a handler, a computed value or a template the build could not resolve still reads as `state.<name>` or `#/state/<name>` ships with the page, along with any formula it calls. A formula that writes state is not pure and always counts as state.

## What compiles away

Site and page context looks like state, but it is data the compiler already has. This heading:

```json
{
  "tagName": "h1",
  "textContent": "${state.$site.name} — ${state.$page.title}"
}
```

compiles to literal HTML with the template evaluated and gone:

```html
<h1>Acme Realty — About us</h1>
```

A template written as a text child compiles away the same way: `"children": ["Welcome to ${state.$site.name}"]` becomes plain text in the HTML.

The same applies to `timing: "compiler"` data and to content collections: template strings over build-time values are evaluated against the resolved data, mapped arrays over resolved content are unrolled into repeated markup, and the now-spent state entries are stripped. What reaches `isDynamic()` afterwards is a plain tree, so a blog index that lists every post can still be a zero-JS page.

In a component, a `timing: "compiler"` value becomes the component's starting state, resolved once per component file, so the prerendered HTML and the component's script agree. A class the build cannot find, load or resolve fails the build with an error naming the entry. That includes a `timing: "compiler"` entry whose `$prototype` matches no class (check the spelling, its `$src`, the document's `imports`, and that the extension providing it is enabled), and an entry with no `timing` whose class throws during the build. If that class needs the browser, give the entry `"timing": "client"`.

## The output tiers

### Fully static

When nothing dynamic survives the build-time resolution, the page is plain HTML with its CSS in the head: zero JavaScript, no import map, no module scripts. This is the default outcome, not an optimization you opt into.

### Components on a static page

A page whose own document is static stays static when it uses interactive components. Each instance is prerendered where it is written, and a component that needs JavaScript (a hyphenated `tagName`, say `site-counter`) loads `dist/components/site-counter.js` only on the pages that use it. The prerendered element already holds what the component first shows: its text, the rows of its lists, and the starting value of anything a handler changes. The module upgrades that element in place, taking the props it was rendered with from its `data-jx-props` attribute:

```html
<site-counter data-jx-props='{"start":3}' data-jx-prerendered>…</site-counter>
<script type="module" src="/components/site-counter.js"></script>
```

The import map added to those pages resolves `@vue/reactivity` and `lit-html` for the component modules, and a fully static component ships no module at all. Anything dynamic in the page document itself, at any depth, makes the whole page a [dynamic page](#dynamic-pages) instead: the compiler does not cut a dynamic subtree out of a static page. To keep a page static with one live part, make that part a component.

### Dynamic pages

When the page document itself is dynamic (it declares live `state`, binds `$ref`s, or uses runtime template strings), the compiler still pre-renders the full HTML, marks bound elements with `data-bind` attributes and each bound text child with a pair of HTML comments (text never gets a wrapper element), and emits one small module that wires reactivity onto the existing DOM: reactive state, `computed()` for derived values, `effect()` per binding, event handler hookup, and one `POST` to the site's worker for each `timing: "server"` entry. There is no client-side re-render of the initial view; the JS only maintains what changes.

An external class with `timing: "client"` ships as its own module under `/assets/`: the class's implementation, or the class generated from its `.class.json`. The page builds it, waits for its value, then hydrates, and keeps following it if the class offers `subscribe()`. A component does the same before its first draw. The prerendered HTML is what a visitor sees while a class is resolving, so a slow class delays interactivity and never blanks the page. If a class fails, the error is logged to the console, its entry stays `null`, and the rest of the page still hydrates. Two classes that import the same module share one copy of it in the browser, so a session class and the actions that change it see the same store. A class that reads the build's context (a content collection, a connector) cannot run in the browser: the build stops and says to use `timing: "compiler"`.

Two more outputs sit alongside these tiers: a class document (`"$prototype": "Class"`, conventionally a `.class.json` file) handed to the compiler directly compiles to an ES class module, and `timing: "server"` entries compile into the site-wide worker, which needs `build.adapter`: without one the build stops with an error naming each entry.

Across all three tiers the emitter indents nested children so the generated HTML stays readable, but only where the indent cannot be seen: between two block-level siblings (`<p>`, `<li>`, `<section>` and the rest of the display-block set, plus `<br>`). Between two inline-level siblings, or beside a text node, it writes nothing. A newline there is a space the page renders, so Markdown such as `[link](/x/).` or `` `code`, `` builds as `<a href="/x/">link</a>.` and `<code>code</code>,` and reads "link." and "code,", not "link ." and "code ,". The text you wrote is never changed. Two text children sit next to each other with nothing between them, as they do in the DOM, and a space between two inline siblings is one you write yourself, as a `" "` text child. A tag the compiler does not know, a custom element included, counts as inline.

Inside `pre`, `textarea`, and the rest of the tags browsers render with `white-space: pre`, and everywhere below them (`white-space` inherits), children are concatenated with no separator at all, because indentation between elements would be content rather than formatting. This is what keeps a syntax-highlighted code block, one `<span>` per token, rendering as the code you wrote.

## Where the runtime comes from

`@vue/reactivity` and `lit-html` are bundled into your `dist/` at build time and the import map points at them:

```html
<script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "/assets/vue-reactivity.js",
      "@vue/reactivity/": "/assets/@vue/reactivity/",
      "lit-html": "/assets/lit-html.js",
      "lit-html/": "/assets/lit-html/"
    }
  }
</script>
```

They come from `@jxsuite/compiler`'s own dependencies, not your project's, so you don't have to install anything. The runtime always matches the compiler that produced the page.

Which pages get a map is decided per page, and what the build writes is read back out of the pages it just wrote: every path any emitted map names is bundled into `dist/`, and a site whose pages are all static writes no `dist/assets/` at all. That direction matters, because the alternative is a build that promises a module it never produced: a page 404ing on its runtime and rendering blank while the build reports success, which passes every structural check there is.

The page also emits a `modulepreload` hint for each of them, and for each component module it loads:

```html
<link rel="modulepreload" href="/assets/vue-reactivity.js" />
<link rel="modulepreload" href="/components/site-counter.js" />
```

The import map is written into `<head>`, ahead of those hints and every module script. Browsers refuse an import map that arrives after a module load or preload has started, and Firefox enforces it strictly: a map placed later is dropped, and every component module fails on the bare `@vue/reactivity` specifier.

An import map says where a bare specifier lives; it does not ask for it. Without the hints the browser only discovers `/assets/vue-reactivity.js` after fetching **and parsing** a component module: three round trips deep on a slow connection, one after another. The hints name only what the page actually loads.

The trailing-slash entries cover package _subpaths_. A component or a `$src` module rarely imports only `lit-html`. It imports `lit-html/directives/class-map.js` too, and an import map with only exact keys cannot resolve that. The build scans every module it wrote for those imports (bundles, compiled component modules and page modules), bundles each one it finds to `/assets/lit-html/…`, and repeats until nothing new turns up; which subpaths exist is a property of the third-party code your pages use, so the set is discovered rather than listed. Each one shares the single copy of the package core the exact key already points at, because two copies of lit on one page break in ways a size budget would not notice. Every page that carries an import map carries these entries. A [keyed list](/docs/framework/concepts/lists#keeping-rows-across-changes) brings two of lit's own modules, `repeat` and `async-directive`, which are served the same way.

:::doc-note
They used to load from `https://esm.sh`. Self-hosting removes a third party from the load path of every interactive page, and it's what makes a `default-src 'self'` Content-Security-Policy possible at all. The old argument for a shared CDN was a shared browser cache, and that stopped being true when browsers began partitioning the HTTP cache by site.
:::

## CSS extraction

Style never ships as JavaScript. During compilation, every static `style` definition (the project-level `style` from the project file, the layout's, the page's, and each node's) is extracted into a single `<style>` block in the page `<head>`, with `$media` breakpoint names expanded to real media queries. Styles found in component slot content are collected into the same block. See [Styling](/docs/framework/concepts/styling) for the authoring model.

A rule whose style block carries a `$description` keeps it as a comment on the line above the rule, wherever the build writes that rule.

**Component CSS is inlined into that block too**, after the page's own rules so the cascade is unchanged, and no `<link rel="stylesheet">` is emitted for it. A stylesheet link per component is a render-blocking request per component. jxsuite.com's home page had eleven of them, 22 kB in total, for sheets averaging 2 kB each: the whole of its critical request chain, spent on round trips rather than bytes.

The sidecars are still written to `dist/components/<tag>.css` for anything that references them directly, and a component in [shadow mode](/docs/framework/concepts/components#opting-into-a-shadow-root) is unaffected: its sheet is linked from inside the declarative shadow root, where it belongs, or from inside the root the element attaches when a client render creates it, and it carries the styles of the light components inside it. An element pack's module links its own sheet the same way.

:::doc-note
The trade is deliberate. Inlined CSS repeats on every page instead of caching across navigations. It is small, it compresses against the markup around it, and on a phone a round trip costs more than the bytes do.
:::

## What prerendering will and won't bake

Every page is prerendered: the compiler evaluates `${state.…}` against the build-time scope and writes the result into the HTML. That is what makes a page's content visible to crawlers and to readers with no JavaScript. A value that can change later is written as the first thing the visitor sees, and the binding that changes it is kept beside it:

- **A constant bakes.** `{"tagline": {"type": "string", "default": "Ship JSON"}}` read as `${state.tagline}` becomes text in the HTML, with no JavaScript behind it.
- **An entry a handler writes to shows its initial value and stays bound.** If any handler in the document, declared in `state` or written inline on an element, assigns to `state.count` (`=`, `+=`, `++`, or an in-place `push`/`splice`/`sort`), a template reading it is prerendered with the value the entry starts with, and keeps its binding. In a component the component's module owns that binding. On a page the page's module does.
- **A computed over changing state does the same.** A computed `$prototype: "Function"` (a body that returns a value and declares no parameters) is evaluated at build time, so a computed that reads a written entry shows its initial result and stays bound, however many steps removed.
- **A value that exists only in the browser renders empty.** A `Request`, a `$src` function read as a value, and a `timing: "client"` class have nothing to show at build time, so a template that reads one is left for the browser to fill.
- **A list inside a component renders its rows.** A mapped array in a component is prerendered with one row per item it starts with, and a `$switch` with the case it starts on. A `filter` and a `sort` are applied, so the HTML holds the rows the component first shows and nothing the filter would hide.
- **A list on a page that reads changing state is left for the browser.** When a page's own list reads an entry a handler writes, through its `items`, its `filter` or its `sort`, the build writes no rows and the page's module renders the list. Rows written into the page could never change.
- **An empty list is static when the build resolved its data.** A list over a content collection, a `timing: "compiler"` entry, a paged slice, `$site` or `$page`, or a literal array that turns out empty renders nothing and leaves no JavaScript behind. A list over client state that starts empty (`{"rows": {"default": []}}`) keeps its binding, because the browser may still fill it.
- **An array a computed still reads stays in client state.** Expanding an array into a list at build time no longer drops it: if a computed or a template still reads `state.rows` at runtime, the array ships to the browser. Mark it `timing: "compiler"` to say the data really is build-time only.

:::doc-note
One case the compiler cannot see: a handler loaded through `$src` lives in a JavaScript file the build does not open, so a state entry written **only** from there is still treated as a constant and baked. Declare a writer for it in the document if a binding over it goes dead.
:::

### Components inside components

A component instance is expanded wherever it is written: on a page, slotted into another component, or inside another component's own `children`. Each level is prerendered against its own props, so a card that renders a button that renders an icon comes out as three levels of real markup, with no JavaScript when all three are static. Two details follow from that:

- **Props flow down at build time.** A `$props` value written as a template (`"icon": "${state.icon}"`) resolves against the parent component's state, and the child's host `style` templates (a mask image chosen from a prop, say) resolve against the child's own props (the definition's defaults when the instance passes none) and land on the element as an inline `style`. An observed attribute written on the instance counts as a prop too, beneath `$props`.
- **A component brings the project formulas it calls.** A formula declared in the project file reaches every component (see [Project formulas](/docs/framework/concepts/props-and-scope#project-formulas)). The build resolves a call inside a static component into the markup, and writes the formula into the module of a live component that still calls it, so a page does not have to keep a formula alive for a component on it.
- **Each component decides its own JavaScript, and a live one decides for what it renders.** A live component nested inside a static one is prerendered with its content, loads its own module and upgrades in place, and the static parent still ships none. The other direction is different: a live component draws its children from its module, so every component it renders loads a module too, on each page where the live component appears. A page that uses the rendered component on its own still ships no script for it.
- **Children land in the slot they name, at every level.** A live component finds the children it was given when it upgrades, so its first paint and its live render place them alike.

:::doc-warning
A component that renders itself with the same props can never finish expanding, so the build fails that route with a message naming the chain (`a-loop → b-loop → a-loop`) instead of overflowing. A component that renders itself with props that change at each level (a tree node) is allowed up to 32 levels deep, which is where a recursion that never bottoms out is reported the same way.
:::

## Why is my page shipping JavaScript?

Work the static-detection list backwards:

- **Live `state` on the page document**, even `{"count": 0}`, makes the page dynamic. If the data never changes after the build, move it to `timing: "compiler"` or reference `$site`/`$page` context instead. A `project.json` `state` entry counts only on the pages where something still reads it as `state.<key>` in the browser.
- **A `${…}` template string** whose inputs exist only at runtime keeps its binding alive. Templates over build-time data compile away.
- **`$switch`, `$ref` bindings, and mapped arrays** over runtime state need the client tier; mapped arrays over build-resolved content do not.
- **An external class with no `timing`**, such as a `ContentEntry`, is resolved during the build and its value also ships as page state. Write `timing: "compiler"` when only the HTML reads it.
- **Interactive components** cost their own module on the pages that use them. The rest of the page stays static. A component is interactive when it has an event handler, a function or request in its `state`, a `$ref` binding, a `$switch`, a tag chosen at creation, or a mapped array over anything but a literal array with no `filter`, `sort` or `key`.
- **A component that a live component renders** ships its module on the pages where that live component appears. On a page where it stands alone it stays static.
- **An external class with `timing: "client"`** loads its class module and the page's hydration script.
- **A component that declares `observedAttributes`** ships its module, because an attribute can change after the page loads.

## The Custom Elements Manifest

When a build compiles at least one component, it writes `dist/custom-elements.json`: a [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) that describes each compiled element for editors, documentation tools and other projects. Nothing on your pages loads it.

Each component is one module in the file. It lists:

- the attributes the element observes (its `observedAttributes`), each linked to the state entry it writes
- public state entries as fields, with their type, default and description
- public functions as methods, with their parameters
- the events its functions declare in `emits`
- its slots, the custom properties its root style declares, and, for a shadow-root component, its parts

Private state (a key that starts with `#`) never appears. Computed values, data sources and lifecycle hooks are not listed, because nothing outside the component sets or calls them.

An `attribute` written on a state entry is left out when the component does not observe it, and the build prints a warning that names the entry. Add the name to `observedAttributes`, or remove the annotation.

Module paths are relative to the project root, such as `dist/components/user-card.js`. To publish your components as a package, point `package.json` at the file. The build never edits `package.json` itself:

```json
{
  "customElements": "dist/custom-elements.json",
  "files": ["dist"]
}
```

## Compiling a component library

A site build compiles the components a site uses. To ship a set of components on their own, as a package other projects import, compile them as a pack. `compileElementPack` takes a directory of component documents and returns the files to publish:

```js
import { compileElementPack, writeElementPack } from "@jxsuite/compiler";

const pack = await compileElementPack({ components: "components/", packDir: "dist" });
await writeElementPack(pack, "dist");
```

The pack holds:

- `<tag>.js` for each component. A component that lists another in `$elements` imports it, so importing one element registers the ones it renders.
- `<tag>.css` for each component that has styles.
- `index.js`, which imports every module. Import it to register the whole set.
- `elements.css`, the styles of every light-DOM component in one file for a page to link.
- `custom-elements.json`, the [manifest](#the-custom-elements-manifest) for the set, with paths under `packDir`.

The modules import `lit-html` and `@vue/reactivity` by name, like every compiled component, so the page or the bundler that loads them has to resolve both.

A function entry's `$src` is imported as written. Pass `rewriteSrc` to point a specifier somewhere else, for example at a behaviour module that ships beside the pack. `pack.warnings` lists the manifest's warnings.

## Related

- [CLI commands](/docs/framework/build/cli): `jx build` flags and the rest of the CLI
- [The dev server](/docs/framework/build/dev-server): the development-time counterpart
- [Site architecture](/docs/framework/site): the directory layout the build consumes
- [Reactivity](/docs/framework/concepts/reactivity): what the dynamic tier compiles from
- [Components](/docs/framework/concepts/components): the component model behind interactive regions
