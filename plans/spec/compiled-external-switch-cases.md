---
status: drafted
disposition: implement
claims:
  - spec.md#14.1
requires:
  - _shared/component-discovery
workspaces:
  - packages/compiler
  - packages/runtime
size: L
---

# A built site renders every `$switch` case the interpreter renders, an external `$ref` case included, instead of an empty container

## Context

`specs/spec.md` §14.1, line 1561 (the trailing `Implemented` marker, line 1594, describes the interpreter and stays):

> **Status: Partial.** The interpreter implements the section (below). No compiled target renders an external `$ref` case: `compile-client.ts`, `compile-element.ts` and the static prerender in `packages/compiler/src/shared.ts` filter them out, so a built page renders an empty container for the example that follows, with no diagnostic.

**Verified.**

- Interpreter: `renderSwitch` in `packages/runtime/src/runtime.ts` (line 2695) resolves an external case against the mount's base, builds its scope with `buildScope(doc, {}, href, ctx)` (line 2764) and renders it with `renderNode` inside the case's own effect scope; a generation counter discards a stale load, and an unchanged key keeps its case. Pinned by `packages/runtime/tests/switch-scope.test.ts`.
- Client target: the `$switch` branch of `buildClientNode` (`packages/compiler/src/targets/compile-client.ts`, line 528) filters external cases out ("cannot be fetched at compile time"). Pinned as intended by `client-switch.test.ts` ("skips an external $ref case it cannot fetch at compile time").
- Element target: `emitNodeInner` (`compile-element.ts`, line 1203) `continue`s past them. `compile-element-coverage.test.ts` feeds one and asserts nothing about it.
- Static prerender: `renderStaticNode` (`shared.ts`, line 1713) renders the empty container for a matched external case (`shared-coverage.test.ts`, line 207).
- `compiler.md` §9.2 (line 682) states the skip as shipped: "An external `$ref` case cannot be fetched at compile time and is skipped, exactly as in the static renderer." `spec.md` §7.4's marker (line 671) points at this gap.

**Census corrections.**

1. **The client target also drops every `$switch` inside a lit-rendered region.** `emitLitMapTemplate` (`compile-client.ts`, line 639) has no `$switch` branch, so a switch in a mapped row's template (the per-row shape §14.1's _Discriminant_ paragraph specifies) or nested inside another switch's case compiles to an empty element on a dynamic page. Probe: `compileClient` on a page with both shapes emits neither case's text into the module. The element target renders both (`emitNodeInner` recurses through `emitLitNode`). §14.1 cannot become Implemented while a dynamic page drops them, so this plan owns it.
2. **The interpreter's external case is only half a component boundary.** `mount()` registers a document's `$elements` (line 201) and runs `onMount`/`onUnmount` (lines 236, 248); `renderSwitch` does neither for a case document. A case that uses a component therefore renders an un-upgraded tag unless something else registered it. A compiled element does both, so the tiers have to be made to agree (Open 2).
3. **The build does not know which file declared a reference.** `resolveLayout` merges page and layout into one tree, and `compileElement` compiles a component from its own path. A relative case reference has to be resolved against its declaring document before the merge. `plan:_shared/component-discovery` builds that pre-pass for `$elements` (`collectSiteComponents`, `layoutChain`).
4. **Nothing tracked uses an external case.** A scan of every tracked `.json` outside `node_modules`, `dist` and `vendor` finds no `$switch` with a `$ref` case, so new build errors turn no project red.
5. **The docs promise laziness.** `docs/framework/concepts/switching.md` says an external case "is fetched only when its key first becomes active, so unvisited views cost nothing up front". That is the interpreter's behaviour, and the compiled design has to keep it or the page has to change.

**Related, no edge.** `plan:_shared/compiled-element-lifecycle` adds the host argument to every compiled `onMount`; a case host is a compiled element (see the integration contract). `plan:site-architecture/build-output-prose` rewrites site-architecture.md's closing build-output paragraph about component scripts; this plan adds the case-module sentence to §12.4, which that paragraph cites.

## Outcome

- spec.md §14.1 → Implemented: the leading Partial marker is deleted, the section gains a _Compiled output_ paragraph and an external case's `$elements`/lifecycle sentence, and the trailing marker names both tiers.
- Ride-alongs, in place: spec.md §7.4's and §21.1's markers; compiler.md §4.8, §9.2 and a §11 entry; site-architecture.md §12.4.
- spec.md does not graduate (other open items remain, e.g. §13.1–§13.3, §16.4, §16.5).

## Decisions

- **Decided:** the client target's missing `$switch` in lit regions (correction 1) is fixed here, as its own slice, because §14.1 specifies the per-row switch, the element target already renders it, and the fix needs none of the external-case machinery.
- **Decided:** an external case compiles through the element target, as one generated custom element per case file, because every property §14.1 gives an external case already holds for a compiled element: its own reactive state built from the document (isolated scope, no `$props` pass-through), effects stopped in `disconnectedCallback` (the case's scope stopped when the switch leaves it), and a template lit keeps while the same template renders (an unchanged key keeps its case). A stale load needs no generation counter: lit removes the host when the key moves on, and `customElements.define` does not upgrade a disconnected element.
- **Decided:** a case module is imported the first time its key is active, never by a page `<script>`, through one helper both targets inline (`caseLoaderSource()` in `shared.ts`), because the switching page promises that unvisited views cost nothing and §14.1's stale-load rule presumes a load in flight. The specifier is relative to the importing module (`./<tag>.js` between element modules, `../components/<tag>.js`-style from a page module), because `base-path.ts` re-roots HTML only and a relative specifier survives a base-path deployment. Case sheets are inlined on every page that can reach the case, like component sheets, because a lazily loaded module cannot add a `<style>` a strict CSP would admit.
- **Decided:** the generated tag is `jx-case-<slug>-<hash>`: the file's basename lowercased with runs outside `[a-z0-9]` collapsed to `-` (`doc` when empty), and the first 8 hex digits of the SHA-256 of its `/`-separated project-relative path, because it must be a valid custom-element name, stable across builds, distinct for two `home.json` in different directories, and readable in a diagnostic.
- **Decided:** references are resolved per declaring document in the component-discovery pre-pass, and each document is **lowered** in memory before any merge or compile: an external case becomes `{ "tagName": "<generated tag>" }`. A lowered case is an ordinary registered tag that every existing path already handles: the static prerender expands it (`renderStaticNode` → `renderComponentInstance`), both targets emit it, and `injectComponentScripts` finds it in a page module. This is why the plan requires `plan:_shared/component-discovery`: it extends that plan's walk and `layoutChain`, and a case document's own `$elements`, typically co-located, compile only through it.
- **Decided:** outside a site build (`compile()`, `compileClient`, `compileElement` called directly) an external case is still skipped, now with a `console.warn` naming the key and the reference, because there is no output tree to place a case module in, and `site-build.ts` and `compiler.ts` are the only callers. In a site build a refused case is deleted during lowering, so it is reported once, as an error (Open 3).
- **Decided:** each target keeps its per-call case state (`caseModules`, and whether the loader is needed) in a module-level variable set on entry and cleared in `finally`, because both emitters are synchronous and the construct is reached through helpers that take no options today (`emitChildLit`, `emitLitMapTemplate` and `emitArrayHole` in the client target; `emitLitChildren`, `emitLitNode` and `emitMappedArray` in the element target).
- **Open:** what DOM does a compiled external case render? Recommendation: the generated host element, styled `display: contents` and forced to light DOM (`$shadow: false`), holding the case document's root as its one child, stated in §14.1 and on the switching page, because it reuses the element target whole and leaves layout unchanged. The one observable difference from the interpreter is a structural selector written across the container (`main > section`, `:first-child`). The alternatives cost more for that difference: a hostless fragment module is a second emitter for state, effects, fetches, handlers and lifecycle with no element to own them; wrapping in the interpreter too would put an element no document node owns into Studio's canvas, which maps rendered elements back to document paths through `onNodeCreated`.
- **Open:** does an external case register its own `$elements` and run its lifecycle hooks? Recommendation: yes, in both tiers: `$elements` registered depth-first before it renders (§16.3), `onMount(state)` once it is in the container and `onUnmount(state)` when the switch leaves it or is disposed, the pair a mounted document runs (§16.4), because §13.1 and §14.1 call an external case a component boundary and correction 2 is a defect in its own right. The other answer, stripping `$elements` and the hooks from the compiled host, matches an interpreter that is broken for any case using a component. If it is chosen, slice CES1.2 is dropped and `wrapCaseDocument` removes `$elements`, `onMount`, `onUnmount` and `onAdopted` instead.
- **Open:** what does `jx build` do with an external case it cannot compile: a reference with a URL scheme, a path outside the project root, no file there, or a document that does not read? Recommendation: an entry in `errors`, so `jx build` exits 1, naming the declaring document, the case key, the reference and the resolved path; the page still builds without that case. A built page ships no runtime to fetch a JSON document, so each is an empty container on a green build today, and correction 4 means nothing turns red.

## Implementation

### CES1.1: the client target renders a `$switch` in every lit region

- `compile-client.ts`: extract the lookup from `buildClientNode`'s `$switch` branch into `emitSwitchLookup(node, discriminant, preformatted): string`: an object of lit templates keyed by case, each case through `emitChildLit`, indexed by `String(<discriminant>)`, with the empty template as the fallback (the expression the branch emits today). `buildClientNode` keeps its container binding (`bindings.set(swKey, () => <lookup>)`).
- `emitLitMapTemplate` gains a `$switch` branch ahead of its inner-content chain: `inner = "${" + lookup + "}"`, the discriminant `mapRefToClientExpr(ref)` for a pointer (it already maps `$map/item/…` to `item…` and `#/state/x` to `state.x`) or the template string through `mapRefsToLit`. A switch nested in a case is covered because case templates go through `emitChildLit` → `emitLitMapTemplate`.

### CES1.2: the interpreter treats an external case as a component boundary (per Open 2)

- `renderSwitch` (`runtime.ts`), external branch: after the first generation check, `if (doc.$elements) await registerElements(doc.$elements, href, options?._ctx)`, then re-check the generation before `buildScope`. After the append, remember the case scope (`liveCase = childScope`) and call `childScope.onMount(childScope)` when it is a function.
- `retire()` calls `liveCase.onUnmount(liveCase)` (when a function) after stopping the effect scope and before `replaceChildren()`, the order `mount()`'s `dispose` uses; `onScopeDispose(retire, true)` already covers disposal. A stale load never sets `liveCase`, so it runs neither hook.

### CES1.3: a site build compiles external cases

1. New `packages/compiler/src/switch-cases.ts` (`@docs framework/concepts/switching` in its header), beside `shadow.ts` because both targets and the site build import it:
   - `caseTagName(projectRoot: string, casePath: string): string` (Decided above; `node:crypto`, as `service-worker.ts` does).
   - `forEachExternalCase(doc, visit: (key: string, ref: string) => void): void`: walks `children` (array items, and a mapped array's `map`) and every `$switch` node's `cases`, visiting a `{ $ref }` case and recursing into an inline one. It does not enter `state`, `$defs` or `$props`.
   - `lowerExternalCases(doc, docDir, tagFor: (absPath: string) => string | undefined): JxDocument`: returns a copy, never mutating its input (one parsed document feeds `componentDefs`, CSS and compile), in which a case whose `resolve(docDir, ref)` has a tag becomes `{ tagName }` and any other external case is deleted from `cases`.
   - `wrapCaseDocument(doc, tagName): JxDocument`: `{ tagName, $shadow: false, style: { display: "contents" }, state, $defs, imports, $elements, $media, $id, children: [root] }`, where the document-level keys move to the host and `root` is the document minus those keys and `$schema`, `$head` and `$layout`.
2. `shared.ts`: `export function caseLoaderSource(): string`, the text of

   ```js
   const _jxCaseLoads = new Set();
   function _jxSwitch(templates, modules, key) {
     const spec = modules[key];
     if (spec !== undefined && !_jxCaseLoads.has(spec)) {
       _jxCaseLoads.add(spec);
       import(spec).catch((e) => {
         _jxCaseLoads.delete(spec);
         console.error("Jx $switch: failed to load external case", spec, e);
       });
     }
     return templates[key];
   }
   ```

   (the interpreter's error text). Update `renderStaticNode`'s `$switch` comment: a lowered case is a registered tag and is expanded, and an unlowered one only exists outside a site build.

3. `compile-client.ts`: option `caseModules?: ReadonlyMap<string, string>` (generated tag → specifier). In `emitSwitchLookup`, when a case is `{ tagName }` with a tag in `caseModules`, the lookup becomes `_jxSwitch(<templates>, { "<key>": "<specifier>", … }, String(<discriminant>))` with the same empty-template fallback, and the module gains `caseLoaderSource()` after its lit import. An external case still present is skipped and warned about once per compile: `Jx $switch: case "<key>" (<ref>) is an external document, which only a site build compiles; it renders an empty container.`
4. `compile-element.ts`:
   - `CompileElementOptions` gains `caseTag?: string` (compile the root document as that case's host), `transformDocument?: (doc: JxDocument, filePath: string) => JxDocument` (applied in `processElement` to every document read from disk, root and `$elements` dependencies alike) and `caseModules?`. `processElement` applies `transformDocument`, then, for the root call only, `wrapCaseDocument(doc, caseTag)` before its hyphen check.
   - `emitElementModule` gains a trailing `caseModules?` parameter. `emitNodeInner`'s `$switch` branch emits `${_jxSwitch({ … }, { … }, <switchExpr>)}` when a case is a lowered tag, adds `caseLoaderSource()` to the module, and imports no case module statically. It skips and warns on an unlowered case as the client target does.
5. `compiler.ts`: `CompileOptions.caseModules`, passed to `compileClient` (route 3) and `emitElementModule` (route 2).
6. `layout-resolver.ts`: `nodeLayoutLoader(projectRoot, transform?)` applies `transform(doc, layoutPath)` after parsing; `resolveLayout(pageDoc, projectConfig, projectRoot, transform?)` forwards it.
7. `component-set.ts` (created by `plan:_shared/component-discovery`): `collectSiteComponents` also returns `cases: { path: string; tagName: string; doc: JxDocument }[]` and `caseTagsByOwner: Map<string, string[]>`. A `visitCases(declarerPath, doc, ownerTag | null)` runs `forEachExternalCase`, resolves each reference against `dirname(declarerPath)`, refuses it (Open 3) with a message naming the project-relative declarer, key, reference and resolved path (e.g. `pages/index.json: $switch case "about" names ./views/about.json, which is not a file (pages/views/about.json)`), accepts each path once, and records `ownerTag → tag`. It then visits the case's `{ $ref }` `$elements` through the component walk (the case as declarer), and its own cases through `visitCases(casePath, caseDoc, caseTag)`. It is called for every page source and `layoutChain` entry (owner `null`: a page module is scanned instead) and every accepted component (owner = its tag).
8. `site-build.ts`:
   - After collection: `lower = (doc, filePath) => lowerExternalCases(doc, dirname(filePath), (p) => casePathToTag.get(p))` and `elementCaseModules`, each case tag mapped to `./<tag>.js`.
   - Step 5: every component compiles with `transformDocument: lower, caseModules: elementCaseModules`, and `componentDefs` holds `lower(c.doc, c.path)`. Then every case compiles with the same options plus `caseTag`. Its `wrapCaseDocument(lower(doc, path), tag)` enters `componentDefs` and `componentPathByTag`, and its `buildComponentCSS` sheet enters `componentCSS` and `dist/components/<tag>.css`, under the existing write-once guard and `errors` handling. A case's `timing: "server"` entries then reach step 5b the way a component's do, resolved through `componentPathByTag`.
   - `compilePage` takes the lowering and a page-relative module map. It lowers `pageDoc` against `route.sourcePath` right after `readPageDocument`, passes `lower` to `resolveLayout`, and passes `caseModules` to `compile()`. `buildSite` computes the map per route from `dirname(routeToOutputPath(route.urlPattern, outDir, trailingSlash))`, moved above the call, as `./`-prefixed `/`-separated `relative(pageDir, <outDir>/components/<tag>.js)`.
   - `injectComponentScripts` gains `cases: { tags: ReadonlySet<string>; byOwner: ReadonlyMap<string, readonly string[]> }`. `usedTags` is closed over `byOwner` in first-seen order, so a component's cases (and theirs) count as used. Sheets are inlined for every used tag. `jsTags` excludes every case tag, and a case tag present in the page HTML (a component's prerendered initial case) gets a `modulepreload` hint.

**Integration contract.** Once this lands:

- `packages/compiler/src/switch-cases.ts` exports `caseTagName`, `forEachExternalCase`, `lowerExternalCases` and `wrapCaseDocument`, and `shared.ts` exports `caseLoaderSource()`. A generated module never names an external case's source document; `_jxSwitch` is its only loader.
- `collectSiteComponents` returns `cases` and `caseTagsByOwner`. Every accepted external case is a compiled element under its generated tag in `componentDefs`, `componentPathByTag`, `componentCSS` and `compiledComponentTags`, and every document the build compiles has been lowered.
- `CompileElementOptions` has `caseTag`, `transformDocument` and `caseModules`; `compileClient` and `compile()` take `caseModules`; `nodeLayoutLoader` and `resolveLayout` take a transform. With none of them passed, output is unchanged except for the warning.
- The client target renders a `$switch` in a mapped row and inside another case, as the element target does.
- In the interpreter, an external case registers its `$elements` and runs `onMount(state)`/`onUnmount(state)` (if Open 2 resolves as recommended). `plan:_shared/compiled-element-lifecycle` passes a host to a compiled `onMount`. For a case host that is the `display: contents` wrapper, so that plan either passes no host when the element was built with `caseTag`, or amends §14.1's sentence to name the wrapper.

## Tests

All from the workspace directory with `bun test --isolate --coverage`. Thresholds are per file: `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`) and `packages/runtime/bunfig.toml` (`lines = 0.963, functions = 0.98`). The new `src/switch-cases.ts` ships with its tests, or `bun scripts/check-coverage-manifest.ts packages/compiler` fails. Ratchet a threshold only if a slice raises that workspace's worst file.

**CES1.1** (`packages/compiler`):

- `client-switch.test.ts`, new describe `compileClient — $switch inside a lit region`: "renders a switch in a mapped row's template, keyed on the row" (both cases' text in the module, and the lookup keyed on the `item` expression); "renders a switch nested in another switch's case" (the inner case's text in the module); "a row's switch with no matching key renders nothing" (the empty-template fallback inside the map template).
- New `client-switch-render.test.ts`, following `compile-element-render.test.ts` (happy-dom `Window` globals installed before the module is imported): it writes the compiled `app.js` to a temp directory, loads the page body, and imports the module. Cases: "each row renders the case its item selects"; "replacing a row's item with a different key swaps that row's case"; "a nested switch follows its own discriminant".

**CES1.2** (`packages/runtime`), in `switch-scope.test.ts`, using its resolver-injection pattern:

- "an external case registers its own $elements before it renders": the case declares a component served by the resolver; the tag is defined and its content is in the container.
- "an external case runs onMount once rendered and onUnmount when the key moves on": function bodies count calls on a `window` global; the counts are 1/0 after render and 1/1 after the flip.
- "dispose runs the live case's onUnmount".
- "a stale external load registers nothing and runs no onMount": the existing pending-resolver shape.

**CES1.3** (`packages/compiler`):

- New `switch-cases.test.ts`:
  - `caseTagName`: a valid custom-element name; deterministic; different for two `home.json` in two directories; `doc` slug fallback.
  - `forEachExternalCase`: finds references in children, map templates, inline cases and nested switches, and ignores `state` and `$props`.
  - `lowerExternalCases`: replaces accepted cases, deletes refused ones, leaves inline cases alone, and leaves its input unmutated.
  - `wrapCaseDocument`: document keys move to the host; the child keeps the root's element keys; `$shadow: false` and `display: contents`.
- New `site-build-external-switch.test.ts`, a `buildSite` fixture in the style of `site-build-component-loading.test.ts`. The page is §14.1's example; the layout declares a case beside it; a component's initial case is external and declares a co-located `$elements` component and a nested external case. Cases:
  - "writes one module and sheet per external case under its generated tag".
  - "the page module loads each case through a specifier that resolves to the written file": each `_jxSwitch` specifier in `dist/app.js` is resolved and checked with `existsSync`.
  - "a layout's case resolves against the layout's directory".
  - "the page inlines every reachable case sheet and loads none with a script".
  - "a component's initial external case is prerendered inside it".
  - "a case's co-located $elements component is compiled".
  - "a nested case is imported lazily by its owner, never statically".
- Same file, a second fixture: "a missing file, a path outside the project and a URL each fail the build naming the document, key and reference". The page is still written with the empty container, and no warning is printed.
- New `switch-case-render.test.ts` (DOM) over the built fixture:
  - "the section's example renders the active view in its own scope": the case's state value appears under `main > div > jx-case-home-…`.
  - "a different key replaces the case and disconnects the old host".
  - "the same key keeps the host element".
  - "a case left before its module loaded never paints": uses a case no earlier test loaded.
- `client-switch.test.ts`: the skip test becomes "an external case outside a site build is skipped and warned about" (spy on `console.warn`), plus "a lowered case loads its module through _jxSwitch" (the specifier, the host tag, and the helper emitted once).
- `compile-element.test.ts`: "caseTag compiles a document as its case host"; "transformDocument applies to the root and to each $elements dependency"; "a lowered case loads lazily and is never imported statically". The comment and assertions in `compile-element-coverage.test.ts` follow the warning.
- `layout-resolver.test.ts`: "nodeLayoutLoader applies its transform with the layout's path".
- `site-build-component-loading.test.ts`: "a component's case sheet is inlined and its module is never script-loaded"; "a prerendered initial case is preloaded".
- `no-eval.test.ts`: "an external case module and the loader that imports it emit no new Function or eval". It uses `compileElement` with `caseTag`, and `compileClient` with `caseModules`.
- `shared-coverage.test.ts`: keep the unlowered case (empty container) and add "a lowered case prerenders as its registered element".

## Specs & docs

**CES1.1.** compiler.md §9.2 gains, after its first paragraph: "Inside a lit-rendered region (a mapped row's template, or another switch's case) the same lookup is emitted as a template hole in place of the container's content, and its discriminant may be a `$map/item` or `$map/index` pointer (spec.md §14.1)." Fragment: `bun run spec:change compiler.md minor -m 'A dynamic page compiles a $switch inside a mapped row or inside another switch case, as the element target already did.'` No docs page changes: switching.md already presents the per-row switch as working.

**CES1.2.** spec.md §14.1's _Scope_ paragraph gains: "An external case registers the `$elements` its document declares before it renders (§16.3), and runs the two hooks a mounted document runs (§16.4): `onMount(state)` once it is in the container, and `onUnmount(state)` when the switch leaves it or is itself disposed. A stale load runs neither." The trailing marker gains "It registers an external case's `$elements` before rendering it and runs its `onMount` and `onUnmount`." The Partial marker stays. Fragment: `bun run spec:change spec.md minor -m 'An external $switch case registers its own $elements before it renders and runs onMount and onUnmount as a mounted document does.'` `docs/framework/concepts/switching.md`, Rules: add "An external case registers the components its own `$elements` names, and runs its `onMount` and `onUnmount` hooks when it is shown and when it is left."

**CES1.3.**

- spec.md §14.1:
  - Delete the leading Partial marker.
  - After _Scope_, add: "**Compiled output.** A site build (`jx build`, and `jx dev` on a site project, §16.7) compiles every external case a page, layout, component or other external case reaches to a module of its own: a custom element named `jx-case-` followed by the file's name and a hash of its project path, whose host is `display: contents` and whose one child is the case document's root, rendered in the case's own scope. The switch renders that element as the case and imports its module the first time the key is active, so a case that never activates is never fetched. The container therefore holds the host, with the case's root one level below it: layout is unchanged, but a child combinator written across the container (`main > section`) does not match in a built page. Inside a component's prerendered markup the matched external case is prerendered like a nested instance (compiler.md §8.1). A reference a site build cannot compile (a URL, a path outside the project, a missing file, a document that does not read) fails the build, naming the declaring document, the case key and the reference. Compiling one document outside a site build (the compiler's `compile()`) compiles no external case: the case renders the empty container and the compiler warns, naming it."
  - The trailing marker gains: "A site build lowers each external case to an instance of its compiled element (`packages/compiler/src/switch-cases.ts`); `compile-client.ts` and `compile-element.ts` render it and import its module through `caseLoaderSource()` (`packages/compiler/src/shared.ts`), and the static prerender expands it as a registered component."
- spec.md §7.4's marker: "in the interpreter; a compiled target does not render an external `$switch` case (§14.1)" → "in the interpreter; a site build compiles an external `$switch` case to an element module (§14.1)".
- spec.md §21.1's marker: its last sentence becomes "A test (`packages/compiler/tests/no-eval.test.ts`) locks the client target and the external-case path: it compiles a template, a computed body and a handler, and an external `$switch` case's element module with the page module that loads it, and asserts the emitted JS contains neither."
- Fragment: `bun run spec:change spec.md minor -m 'A site build compiles each external $switch case to an element module that its switch loads the first time the key is active, and fails on a case it cannot compile.'`
- compiler.md §4.8, new paragraph: "**An external case is its compiled element, loaded on first use.** In a site build an external `$ref` case arrives lowered to an instance of the element the build compiled it to (spec.md §14.1), and the lookup renders it like any case. A lookup holding one is called through `_jxSwitch` (§11, `caseLoaderSource()`), which imports the case's module the first time its key is active; element modules name each other as `./<tag>.js`, and nothing imports a case module statically. Outside a site build an external case is skipped with a warning."
- compiler.md §9.2: "An external `$ref` case cannot be fetched at compile time and is skipped, exactly as in the static renderer." → "An external `$ref` case renders as the element the site build compiled it to, and the binding imports its module the first time its key is active (§4.8), through a specifier relative to the page module so a base-path deployment resolves it."
- compiler.md §11: a new `caseLoaderSource()` heading in the shape of the `attrHelperSource()` entry, saying what `_jxSwitch` does. The section's marker stays with `plan:compiler/shared-utilities-signatures`.
- Fragment: `bun run spec:change compiler.md minor -m 'The element and client targets render an external $switch case as its compiled element, loaded on first activation, instead of skipping it.'`
- site-architecture.md §12.4:
  - JS bullet gains: "An external `$switch` case (spec.md §14.1) ships as `dist/components/<tag>.js` too, but no page loads it with a `<script>`: the switch that renders it imports it the first time the case is active. Its sheet is inlined on every page that can reach it, through the page's own module or a component the page uses."
  - Preload bullet gains: "A case module is hinted only when the page's prerendered markup already holds it."
  - Fragment: `bun run spec:change site-architecture.md minor -m 'An external $switch case ships as its own module under dist/components, imported by its switch on first activation, with its sheet inlined on every page that can reach it.'`
- `docs/framework/concepts/switching.md` (`spec: spec.md#14`):
  - Frontmatter gains `code:` with `packages/compiler/src/switch-cases.ts` and `packages/runtime/src/runtime.ts`.
  - _External cases_ gains a paragraph: "In a built site each external case is compiled into a small module of its own, loaded the first time its key is active. The case renders inside a wrapper element that takes no space in the layout (`display: contents`), so a selector such as `main > section` written across the switch does not match in the built page. The file must live inside the project: `jx build` fails on a case it cannot find, naming the document, the key and the path."
  - _How it works_ gains a sentence that a built page does the same with compiled modules.
  - Repair the doubled "so" in the section's existing sentence.
  - No em dashes.
- `docs/framework/build.md` (`code:` lists `site-build.ts`, `compile-client.ts`, `shared.ts`): step 5's "compiled component modules and CSS under `dist/components/`" gains ", including one module for each external `$switch` case, loaded the first time the case is shown".
- No change, checked for `docs:sync`:
  - `components.md` and `lists.md` (list `compile-element.ts`).
  - `layouts.md` (lists `layout-resolver.ts`; the transform is internal).
  - `security.md` (cites spec.md §21; the no-eval property it states still holds).
  - The pages listing `runtime.ts`: `runtime-host.md`, `functions.md`, `overlays.md`, `props-and-scope.md`, `reactivity.md`, `styling.md`, `color-schemes.md`, `elements.md`. None describes an external case.
- CES1.3 deletes this plan. spec.md keeps other open items, so there is no graduation and `plans/spec/` stays.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts packages/compiler`: green, no file under its threshold. The same for `packages/runtime` after CES1.2.
- A scratch project holding §14.1's example (`pages/index.json`, `views/home.json`, `views/about.json`, `views/profile.json`), built with `bun packages/compiler/src/cli.ts build <dir>`:
  - `dist/components/` holds one `jx-case-*.js` and `.css` per view.
  - `dist/index.html` has no `<script>` for any of them.
  - Served and opened, the page shows the active view and swaps views on a state change.
  - Deleting `views/about.json` makes the build exit 1 with a message naming `pages/index.json`, `about` and `./views/about.json`.
- `rg -n "cannot be fetched at compile time" packages/compiler/src specs` finds nothing.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run plans:check`: green. `bun run plans:status --who-claims spec.md#14.1` reports no claimant once the plan is deleted.

## Slices

| Slice  | Scope                                                                                                                                                                                                                                                     | Claims       | State |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| CES1.1 | The client target renders a `$switch` in a mapped row and inside another case (`compile-client.ts`); compiler.md §9.2 sentence and fragment                                                                                                               | —            | open  |
| CES1.2 | An external case registers its `$elements` and runs `onMount`/`onUnmount` in the interpreter (`renderSwitch`); spec.md §14.1 _Scope_ sentence and fragment; switching.md rule. Dropped if Open 2 resolves the other way                                   | —            | open  |
| CES1.3 | A site build compiles external cases: `switch-cases.ts`, the collector, lowering, `compileElement` options, the `_jxSwitch` loader in both targets, delivery, prerender, errors; spec.md, compiler.md and site-architecture.md edits, docs, plan deletion | spec.md#14.1 | open  |
