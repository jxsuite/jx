---
status: drafted
disposition: implement
claims:
  - spec.md#16.6
requires:
  - spec/compiled-slot-distribution
  - compiler/element-binding-table
workspaces:
  - packages/runtime
  - packages/compiler
  - packages/site
  - packages/studio
size: L
---

# `$shadow` means the same thing in the interpreter, the component module and the prerender, and light-DOM slots leave no node

## Context

`specs/spec.md` §16.6, line 1705 (the trailing `Implemented` marker at line 1741 speaks for compiled output and a component's own `$shadow`):

> **Status: Partial.** The compiler ships the light default, `$shadow` and `defaults.shadow`, the declarative-root prerender and its adoption, and `:host` translation (`packages/compiler/src/shadow.ts`). Three parts do not: the interpreter has no shadow support (no `$shadow`, `attachShadow` or `:host` handling in `runtime.ts`); `site-build.ts` calls `compileElement` without `defaults`, so a project-level `defaults.shadow` reaches the prerender but not the component module; and built output does not distribute slots by `name` (§8.5): the component module's light-DOM emulation replaces only the first `<slot>` and leaves the `<slot>` element in place when nothing is slotted, and the static prerender (`renderStaticNode` in `packages/compiler/src/shared.ts`) writes all slotted content into every `<slot>`.

Verified against the tree. Items 1 to 3 are the marker's three parts, with what it leaves out; items 4 to 6 are findings it does not list:

1. **The interpreter has no shadow mode and no `:host`.** `defineElement`'s `connectedCallback` (`packages/runtime/src/runtime.ts`) always captures `this.childNodes`, calls `replaceChildren()`, renders into the host and runs `distributeSlots`. `buildStyleRules` (`packages/runtime/src/css.ts`) has no `:host` case, so a definition's `":host": {…}` becomes `[data-jx="…"]:host`, which matches nothing, **even in light DOM**. The stylesheet engine keys everything on a `Document` (`sheetStateFor(doc)`, `openSink(doc)`), and an element is styled before it is inserted (`renderNode` calls `applyStyle` before `append`), so nothing today could put a rule inside a shadow root.
2. **`site-build.ts` drops `defaults`.** Line 441 calls `compileElement(componentPath, { $media, formats, resolveElementPath, rewriteSrc })`; the prerender (`expandComponents`, line 1349) and `buildComponentCSS` (line 484) both receive `projectConfig.defaults`. So under `defaults.shadow: "open"` the page ships a declarative root and a module that clears the light DOM and renders into the host beside it. `site-build-reporting.test.ts` ("a component prerendered into a declarative shadow root") builds exactly that project and checks only the HTML.
3. **Slots**: the component module's `_slotted` / `this.querySelector('slot')` emulation and `renderStaticNode`'s `if (tag === "slot" && slotContent != null) return slotContent;` are as the marker says. `plan:spec/compiled-slot-distribution` owns spec.md §8.5 and fixes both emitters; this plan requires it and re-checks §16.6's `& > x` and `:empty` claims against its output.
4. **A key compounding onto the host never matches inside a root.** `buildComponentCSS` resolves `":hover"` under the `:host` scope to `:host:hover` (`shadow-dom.test.ts` asserts that string), and `.wide`/`[open]` likewise. CSS Scoping 1 makes the host featureless inside its own shadow tree, so only the `:host` family matches it: the author's hover rule is dead. The spelling that matches is `:host(:hover)`.
5. **A shadow instance a client render creates is unstyled.** `#renderRoot` (`compile-element.ts`) adopts `this.shadowRoot` or attaches a fresh root, and the clear loop keeps a `LINK` it finds; but a root the module attaches itself (an instance a `$map`, a `$switch` case or a parent's template creates) gets no link, and a shadow component's sheet is deliberately kept out of the page's inlined `componentCSS`. Separately, `site-build.ts` writes `<tag>.css` only `if (css)`, while both prerender paths (`expandComponents`, `renderComponentInstance`) link it unconditionally, so a styleless shadow component requests a 404 (routed here by `plan:site-architecture/build-output-prose`).
6. **Color-scheme blocks are dead inside a root.** `walkAt` dual-emits a pure scheme block through `schemeSelectors`, whose guards are `:where(:root:not([data-color-scheme])) <sel>` and `:where(:root[data-color-scheme="dark"]) <sel>`. A selector in a shadow tree cannot see the document's root element, so for a shadow component neither copy ever matches, and `@--dark` does nothing in either scheme.

**Editorial, owned here unless it moves:** spec.md §18's WHATWG DOM row still says "Shadow trees are not used at all (§16.6)". `plan:compiler/element-binding-table` has an Open proposing to correct it there, beside compiler.md §13's counterpart note.

**What exists to reuse**: `resolveShadowMode` and `styleScopePrefix` (`packages/compiler/src/shadow.ts`); `resolveSelector`/`resolveSelectorMember` and `buildComponentCSS` (`packages/compiler/src/shared.ts`); `buildStyleRules`, `resolveNestedSelector`, `schemeSelectors` (`packages/runtime/src/css.ts`); `applyStyleInto`, `sheetStateFor`, `openSink`, `callSiteStyles`, `distributeSlots`, `setRootMedia` and the canvas switches (`runtime.ts`); `packages/compiler/tests/shadow-dom.test.ts`, `compile-element-render.test.ts` (runs an emitted module in happy-dom), `prerender-nested-components.test.ts`, `site-build-reporting.test.ts`; `packages/runtime/tests/custom-elements.test.ts`, `stylesheet-engine.test.ts`, `css.test.ts`.

## Outcome

- `spec.md` §16.6 → `Implemented`: the Partial marker is deleted and the trailing marker covers both tiers. The interpreter renders `$shadow` and `defaults.shadow` into a shadow root with the build's host translation and stylesheet placement; the component module follows `defaults.shadow` and links its sheet into a root it attaches; a compounding host key becomes `:host(…)`; and light-DOM slots leave no node in built output (through the prerequisite).
- If the color-scheme Open is taken as recommended: inside a root a scheme block follows the OS preference, and spec.md §9.5 and §16.6 state that a forced scheme does not cross the boundary. No `Future` remainder.
- `spec.md` does not graduate (§8.1, §9.1, §11.2 and others stay open).

## Decisions

- **Decided:** one `L` plan with four slices, not a split, because it has one claim, and the compiled fixes (item 2 and item 5) are a slice's worth of work that shares the marker. It requires `plan:spec/compiled-slot-distribution` because spec.md §16.6's "A `<slot>` leaves no node" cannot be true of built output before it, and because both plans rewrite the slot block of `connectedCallback` in `compile-element.ts` and `defineElement` in `runtime.ts`. It requires `plan:compiler/element-binding-table` because this plan adds `defaults.shadow` to the compiler.md §13 WHATWG HTML note that plan rewrites, and the spec.md §18 WHATWG DOM note goes to whichever plan that one's Open assigns it: there if accepted (recommended here too, so the two counterpart notes change in one pull request), otherwise in slice SDP1.4.
- **Decided:** the rules both tiers apply move into `packages/runtime/src/css.ts`: `resolveShadowMode` with its `ShadowMode`/`ShadowSetting` types, and a new `resolveHostKey(key, scope, host)` replacing the compiler's `resolveSelector`/`resolveSelectorMember`, reached through a `host?: "light" | "shadow"` option on `buildStyleRules`. That follows the audit record's spec-wide decision (a rule both tiers apply comes from one runtime export), and the compiler already imports `buildStyleRules` from there. `packages/compiler/src/shadow.ts` stays, re-exporting `resolveShadowMode` and keeping the compiler-only `styleScopePrefix`, so the imports and plan citations that name it stay valid.
- **Decided:** a key that compounds onto the host (`:hover`, `.wide`, `[open]`, and the same after `&`) folds into `:host()` whenever the scope member it resolves against ends in a `:host` or `:host(…)` compound: `:host(:hover)`, `:host(.wide:hover)`. The fold lives in `resolveOneNestedSelector`, so it holds at every depth and in both tiers, because the featureless host matches nothing else. A descendant key (`& .inner`) is unchanged.
- **Decided:** the interpreter resolves a component's mode when it connects, from the live definition (`_elementDefs`, so `redefineElement` applies to later instances) and a realm-wide default set by a new `setShadowDefault(setting)`, not by a `mount()` option. The custom-element registry is one per realm (embedding.md §5.2) and the class has no mount context at connection. Studio's chrome realm never sets it: kit elements declare no `$shadow` (`ui.md` §3.2) and must stay light, so only the canvas frame and the live-preview page set it.
- **Decided:** rules are written into the tree they select. `applyStyleInto` takes a style root (`Document | ShadowRoot`), sheet states are keyed on it, and `openSink` adopts a constructable sheet onto a `ShadowRoot` (or appends the `<style>` fallback inside it). The root travels as an internal `_styleRoot` render option that `renderNode`, `renderCustomElementWithProps`, `renderMappedArrayInto` and `renderSwitch` already spread into child options, because an element is styled before insertion, so `getRootNode()` cannot answer, and a scope-borne marker would not survive an external `$switch` case, whose scope is built fresh (spec.md §15). A light component reads `this.getRootNode()` at connection, so one nested inside a shadow root writes into that root too.
- **Decided:** in shadow mode the host carries two rule sets. The definition's style, with the `display: block` default, becomes `:host` rules in the root's sheet. The usage-site style stays an ordinary `data-jx` rule in the tree around the host, because an outer-context declaration beats an inner-context one, which is how a built page's class rule for the instance beats the component's `:host` rules. Declaration at-rules and `@keyframes` stay hoisted in the document's sheet (spec.md §9.6: their names are document-global, and a shadow tree resolves a tree-scoped name through its host's tree). The `--jx-r<serial>-<n>` serial becomes module-wide rather than per sheet, so a host with rules in two trees never reuses a variable name.
- **Decided:** the interpreter adopts a declarative root as the module does (`this.shadowRoot` for open, `this.attachInternals().shadowRoot` for closed, else `attachShadow`) and then clears all of it: it links no sheet, so there is no `<link>` to keep. A closed root is held in a local, never on the element.
- **Decided:** the compiled module links the component sheet into a root it attaches itself, through one `componentStylesheetHref(tag)` helper that the two prerender paths also use, and the site build writes `<tag>.css` for every shadow component, empty or not. A standalone `compileElement` call links nothing unless given `stylesheetHref`, because only the site build writes `/components/`.
- **Decided:** out of scope, and stated: `compile()`'s single-document routes (Route 2 in `packages/compiler/src/compiler.ts`, `compileElementPage`) stay as they are. Neither writes a component sheet in either mode (Route 2 inlines a document `<style>`, `compileElementPage` none), so neither is the build spec.md §16.6 describes. Studio's editor for a component's own document (`data-jx-definition-root`) stays a light tree, and its root's `:host` keys translate as light, because that tree is the document being edited.
- **Open:** do Studio's Edit and Design canvases render a shadow component into its root? Recommendation: no. A new canvas switch, `setCanvasLightComponents(on)`, is set by `renderResolvedDocument` with the de-link switches' predicate (`opts.mode !== "preview"`), and while it is on every component renders light. Inline prop editing (`instance.querySelector('[data-jx-bound-prop=…]')` in `iframe-inline-edit.ts`), the edit-mode stylesheet (`[data-jx-bound-prop]:hover` in `iframe-render.ts`) and path lookups all read an instance's subtree from the document, and a closed root is unreachable by definition. Preview, like the live preview and `mount()`, renders as the build does, which is the role the de-link switches already give it. The cost is that Edit and Design show page CSS reaching into a shadow component.
- **Open:** what does a pure color-scheme block (spec.md §9.5) do inside a root? Recommendation: a new `shadowTree` option on `buildStyleRules` writes only the media copy, with no root guard, so a shadow component follows the OS preference, and spec.md §9.5 and §16.6 state that a forced scheme, an attribute on the document's root element, does not cross the boundary, as page CSS does not. The alternatives are worse: `:host-context()` never reached a second engine (spec.md §18's CSS Scoping row), and mirroring `data-color-scheme` onto every shadow host needs an observer in each module and still flashes the wrong scheme on first paint, because a declarative root paints before any module runs. Today neither copy matches, so a shadow component ignores the dark scheme entirely.

## Implementation

### SDP1.1 The component module agrees with the prerender (`packages/compiler`)

1. `packages/compiler/src/shared.ts`: export `componentStylesheetHref(tag: string): string` returning `/components/${tag}.css`, and use it in `renderComponentInstance`'s declarative template.
2. `packages/compiler/src/site/site-build.ts`, step 5: pass `defaults: projectConfig.defaults` and `stylesheetHref: componentStylesheetHref` to `compileElement` (line 441). Use the helper in `expandComponents`' template (line 2115). In the sheet block (line 496), write `<tag>.css` when `css` is non-empty **or** `componentShadow !== null`, still keeping shadow sheets out of `componentCSS`.
3. `packages/compiler/src/targets/compile-element.ts`: add `stylesheetHref?: (tagName: string) => string | null` to `CompileElementOptions` and thread its result into `emitElementModule` as a new trailing parameter. In `#renderRoot`, read the adoptable root first (`const _a = this.shadowRoot;` for open; `const _a = this.attachInternals().shadowRoot;` for closed), set `this.#root = _a ?? this.attachShadow({ mode })`, and when `_a` was null and an href was given, append `Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '<href>' })` to the new root. The existing clear loop keeps it.
4. After the prerequisite lands, no emitter change is expected for spec.md §16.6's slot claims. The tests below pin them.

### SDP1.2 One set of host rules for both tiers (`packages/runtime`, `packages/compiler`)

1. `packages/runtime/src/css.ts`:
   - Move `resolveShadowMode`, `ShadowMode`, `ShadowSetting` and the private `asSetting` from `packages/compiler/src/shadow.ts`, unchanged, with its `@docs framework/concepts/components` tag.
   - Add `resolveHostKey(key, scope, host)`: member by member over `splitSelectorList(key)`, `:host` resolves to `scope`, `:host(x)` to `:host(x)` in shadow and `${scope}x` in light, and `::slotted(`/`::part(` stand alone in shadow (moved from `resolveSelectorMember`, `SHADOW_STANDALONE` with it); any other key falls through to `resolveOneNestedSelector`.
   - In `resolveOneNestedSelector`, when `compoundsOntoScope(key)` and the scope member ends in a `:host` or `:host(…)` compound, fold the key's compound (after any leading `&`) into the parentheses: `:host` + `:hover` → `:host(:hover)`, `:host(.wide)` + `:hover` → `:host(.wide:hover)`. A key with a combinator after its first compound (`&:hover > li`) folds the compound and keeps the rest (`:host(:hover) > li`).
   - `CssBuildOptions` gains `host?: "light" | "shadow"`: in `walk`, only at the top level, a nested key resolves through `resolveHostKey` instead of `resolveNestedSelector`. If the scheme Open is accepted, it also gains `shadowTree?: boolean`: `walkAt` skips the `schemeSelectors` dual emission and walks the block under the plain `@media` condition.
   - Re-export the new names from `runtime.ts`'s css block.
2. `packages/compiler/src/shadow.ts`: re-export `resolveShadowMode`, `ShadowMode`, `ShadowSetting` from `@jxsuite/runtime/css`; keep `styleScopePrefix`.
3. `packages/compiler/src/shared.ts`: delete `resolveSelector`, `resolveSelectorMember` and `SHADOW_STANDALONE`. `pushStyleRules` takes an options bag (`{ host?, shadowTree? }`) passed through to `buildStyleRules`. `buildComponentCSS` drops its own/blocks pre-walk and calls `pushStyleRules(rules, styleDef, scope, mediaQueries, { host: shadow ? "shadow" : "light", shadowTree: shadow !== null })`; the rule order is unchanged, since the builder also emits a scope's declarations before its blocks. A bare element key at the top level (`"div": {…}`) now emits a descendant rule, as it already does below the top level and in the runtime. `collectStyles` gains a trailing `shadowTree = false` parameter, which `buildComponentCSS` passes for the definition's children.
4. `packages/runtime/src/runtime.ts`, light-mode host translation: `applyStyleInto` gains an optional `host` argument passed to `buildStyleRules`. `defineElement`'s `connectedCallback` passes `"light"` for the merged host style. `renderNode` passes `"light"` when `el.dataset.jxDefinitionRoot !== undefined`, which `onNodeCreated` stamps before `applyStyle` runs. Add `"$shadow"` to `RESERVED_KEYS`, so a definition root rendered as a document never binds it as a scope local.

### SDP1.3 The interpreter renders shadow mode (`packages/runtime`)

1. `packages/runtime/src/types.ts`: `JxRenderOptions._styleRoot?: Document | ShadowRoot` (internal, like `_ctx`).
2. `runtime.ts`, the engine:
   - `sheetStates` becomes a `WeakMap<Document | ShadowRoot, SheetState>`. `sheetStateFor(root)` and `openSink(root)` take either: for a `ShadowRoot`, the constructor is `root.ownerDocument.defaultView.CSSStyleSheet`, adoption is `root.adoptedStyleSheets`, and the fallback `<style data-jx-sheet>` is appended to the root.
   - `ElementStyleEntry.doc` becomes `root`, and an entry also records the document state its hoisted at-rules went to. Unscoped rules always go to the element's document state.
   - `serial` moves from `SheetState` to a module-level counter.
   - `applyStyleInto(el, styleDef, media, state, live, root?, host?)`. The style root defaults to `el.ownerDocument ?? document`, and `buildStyleRules` gets `shadowTree: true` when it is a `ShadowRoot`. `reapplyStyle` reuses the root recorded on the element's entry.
   - A second map, `hostStyles: WeakMap<HTMLElement, ElementStyleEntry>`, holds a shadow host's `:host` rules. `releaseElementStyles(el)` releases both, and the host entry sets no `data-jx` (its rules are `:host`-rooted).
   - `documentStyleText(root: Document | ShadowRoot = document)`. `resetDocumentStyles(doc)` is unchanged: a root's state dies with its root.
3. `runtime.ts`, the setters: `setShadowDefault(setting: unknown)` stores `"open" | "closed" | false` (anything else is `false`, through `resolveShadowMode`'s own rule). `setCanvasLightComponents(on: boolean)` (per the first Open) is a module flag beside `setCanvasDelinkPopovers`.
4. `runtime.ts`, `defineElement`'s `connectedCallback`, after the spec.md §16.9 refusal check:
   - Compute `mode = _canvasLightComponents ? null : resolveShadowMode(def, { shadow: _shadowDefault })` and `treeRoot = this.getRootNode()`.
   - Light (unchanged path): capture and clear, `renderRoot = this`, `styleRoot = treeRoot`.
   - Shadow: `renderRoot = (mode === "open" ? this.shadowRoot : this.attachInternals().shadowRoot) ?? this.attachShadow({ mode })`, then `renderRoot.replaceChildren()`; `styleRoot = renderRoot`; no capture and no `distributeSlots`.
   - Host styles. Light: the existing merged `applyStyleInto(this, hostStyle, …, treeRoot, "light")`. Shadow: `applyStyleInto(this, callSiteStyles.get(this) ?? {}, …, treeRoot)` for the usage site, and the definition's `defStyle` into `hostStyles` with the scope `":host"`, `host: "shadow"`, root `renderRoot`.
   - Children: `renderRoot.append(renderNode(childDef, state, { _styleRoot: styleRoot }))`. Root `textContent` binds on `renderRoot`.
5. `runtime.ts`, `renderNode` and `renderCustomElementWithProps`: pass `options?._styleRoot` to their `applyStyle` calls, now `applyStyleInto(…, false, options?._styleRoot)`.

### SDP1.4 Hosts, spec and docs (`packages/site`, `packages/studio`)

1. `packages/site/src/compose.ts`: `ComposedPage.shadow: "open" | "closed" | false`, set to `resolveShadowMode(null, config.defaults) ?? false` so an invalid value reads as light, as it does in the build. `packages/site/src/shell.ts` `pageShell`: when `page.shadow` is not `false`, add `setShadowDefault` to the import and call `setShadowDefault(<json>)` before `await Jx(…)`, as `setResolveToken` is.
2. Studio: `resolveCanvasDocument` (`canvas/canvas-live-render.ts`) returns `shadowDefault` from `projectState?.projectConfig?.defaults?.shadow ?? false`. The render message in `canvas/iframe-protocol.ts` gains `shadowDefault?: "open" | "closed" | false`. `canvas/iframe-host.ts` posts it, both in the pass payload and in the stylebook message. `canvas/iframe-entry.ts` forwards it. `renderResolvedDocument` (`canvas/iframe-render.ts`) calls `setShadowDefault(opts.shadowDefault ?? false)` and `setCanvasLightComponents(opts.mode !== "preview")` beside `setRootMedia`, before `registerElements`. Never call either in the chrome realm (`panels/component-preview.ts` stays as it is).
3. The spec and docs edits under Specs & docs, the fragments, and the spec.md §16.6 marker.

**Integration contract.** Once this lands:

- `@jxsuite/runtime/css` (and `@jxsuite/runtime`) export `resolveShadowMode`, `ShadowMode`, `ShadowSetting` and `resolveHostKey`, and `buildStyleRules` takes `host` (and `shadowTree`, if that Open is accepted). `packages/compiler/src/shadow.ts` still exports `resolveShadowMode` and `styleScopePrefix`. `plan:spec/cem-manifest-export`, which gates `cssParts` on the mode, can import it from Studio without the compiler.
- `@jxsuite/runtime` exports `setShadowDefault` and (per the Open) `setCanvasLightComponents`, and `documentStyleText` accepts a `ShadowRoot`. A component defined by the runtime renders into an open or closed root when its definition or the realm default says so.
- `compileElement` accepts `defaults` and `stylesheetHref`, and the site build passes both. `componentStylesheetHref` is the one spelling of a component sheet's URL.
- The `:host` translation is `resolveHostKey` in `packages/runtime/src/css.ts`, applied by both tiers. `plan:ui/principles-text` (ui.md §11's CSS Scoping row) and `plan:_shared/static-style-handle-and-descriptions` (compiler.md §8.2's "what the compiler keeps" sentence) each name where it lives: whichever lands after this one names that function, and if either lands first, this plan's last slice corrects its sentence.

## Tests

Run `bun test --isolate --coverage` from each touched workspace, then `bun scripts/check-coverage-manifest.ts <workspace>`. No source file is added, so the manifest check sees nothing new. Per-file thresholds: `packages/runtime` `lines = 0.963, functions = 0.98`, `packages/compiler` `0.982 / 0.98`, `packages/site` `0.99 / 1.0` (every function in `compose.ts` and `shell.ts` stays covered), `packages/studio` `0.958 / 0.941`. Ratchet a workspace's threshold to just below its new minimum if a slice raises its worst file.

**SDP1.1**, `packages/compiler`:

- `site-build-reporting.test.ts`, the existing "a component prerendered into a declarative shadow root" describe (whose fixture already sets `defaults.shadow: "open"`): "the project default reaches the component module" (`dist/components/site-card.js` contains `this.attachShadow({ mode: 'open' })` and not `this.replaceChildren()`); "a shadow component's sheet is written even when it is empty" (`dist/components/site-card.css` exists; the fixture's `$style` gives an empty sheet).
- `shadow-dom.test.ts`: the two adoption tests assert the new form (`const _a = this.shadowRoot;` then `_a ?? this.attachShadow({ mode: 'open' })`; `const _a = this.attachInternals().shadowRoot;` for closed, still with no `this.shadowRoot`); new "a root the module attaches links the component sheet" (with `stylesheetHref`, the source contains the href inside `#renderRoot`, guarded by `!_a`), and "without an href, nothing is linked".
- `compile-element-render.test.ts`, new describe "shadow and slots, executed (spec.md §16.6)": an `open` module instantiated with no declarative root has `shadowRoot.querySelector('link[rel=stylesheet]')` with the given href; a declarative root created by `attachShadow` before the module loads, with a `<link>` and a stale `<p>`, is the same object afterwards, keeps the link and loses the `<p>`. The light module, after the prerequisite: a definition styled `"& > p": { color: "red" }` with one `<slot>`, given `<p>`, has that `p` as a direct child and no `slot` anywhere; a `<span class="label"><slot></slot></span>` given nothing is `:empty` (`matches(':empty')`).
- `prerender-nested-components.test.ts`: "an unfilled slot leaves its part empty in the prerender" (`<span class="label"></span>`).

**SDP1.2**, `packages/runtime` then `packages/compiler`:

- `css.test.ts`, new describe "host keys (spec.md §16.6)": `:host` and `:host(.wide)` under `host: "light"` with scope `x-a` give `x-a {` and `x-a.wide {`, and under `host: "shadow"` with scope `:host` give `:host {` and `:host(.wide) {`; compounding keys fold (`:hover`, `.wide`, `&[open]`, `&:hover > li` give `:host(:hover)`, `:host(.wide)`, `:host([open])`, `:host(:hover) > li`), a descendant does not (`& .inner` gives `:host .inner`), a nested fold composes (`{":host(.wide)": {":hover": …}}` gives `:host(.wide:hover)`), and `::slotted(p)` stands alone in shadow; `resolveShadowMode`'s four cases, moved from the compiler's test; and, per the Open, "a pure scheme block in a shadow tree writes one unguarded copy" (one rule, `@media (prefers-color-scheme: dark) { :host { … } }`, no `data-color-scheme`).
- `custom-elements.test.ts`: "a definition's `:host` keys style the element itself in light DOM" (`elementCSS` of the host contains `[data-jx="…"] { display: flex }` and no `:host`).
- `shadow-dom.test.ts` (compiler): `":hover"` under shadow now asserts `:host(:hover)` and `not.toContain(":host:hover")`; a `.wide` key added to the fixture asserts `:host(.wide)` in shadow and `sd-probe.wide` in light; a top-level `"@--dark"` block under shadow asserts no `data-color-scheme` (per the scheme Open); the `resolveShadowMode` describe imports through `../src/shadow` unchanged (the re-export).

**SDP1.3**, `packages/runtime`, a new `tests/shadow-dom.test.ts` (happy-dom, unique tags as in `custom-elements.test.ts`, `setShadowDefault(false)` and `setCanvasLightComponents(false)` in `afterEach`):

- "light by default: no root, slots unwrapped".
- "`$shadow: open` renders into an open root and leaves the light children for the slot": the host's `shadowRoot` holds `.inner` and a `slot`, and the host's own children are the authored `<span>`.
- "`closed` leaves nothing on the element": `shadowRoot` is null and the light children are untouched.
- "the realm default applies, and `$shadow: false` opts out".
- "an open root already on the element is adopted, not re-attached".
- "the definition's style is `:host` rules in the root, and the usage site's is a rule in the page": `documentStyleText(root)` contains `:host { display: block` and `:host(:hover)`; `documentStyleText(document)` contains the call site's `[data-jx=` rule and no `:host`.
- "a descendant, a mapped-array row and an external `$switch` case inside the root style into the root".
- "a light component inside a shadow root styles into that root".
- "a reactive declaration on each side of the boundary gets its own variable": the host's inline `--jx-r…` names are distinct.
- "`@keyframes` stays in the document sheet".
- "with `setCanvasLightComponents(true)` a `$shadow` component renders light" (per the Open).

`stylesheet-engine.test.ts`: "a shadow root gets its own adopted sheet" and "the `<style>` fallback lands inside the root".

**SDP1.4**:

- `packages/site/tests/shell.test.ts`: "a project shadow default is set before the render" (the import names `setShadowDefault` and the call precedes `await Jx(`), and "no default, no call". `compose.test.ts` (`composePage`): "carries `defaults.shadow`, and false when absent".
- `packages/studio/tests/canvas-live-render.test.ts` (`resolveCanvasDocument`): "carries the project's `defaults.shadow`". `iframe-render.test.ts`: in a new describe, "a `$shadow` component renders into its root in preview and light in edit" (two `renderResolvedDocument` calls, as the de-link test does), resetting both flags in `afterEach`.

## Specs & docs

**`spec.md` §16.6** (one `minor` fragment covers all spec.md edits):

- Delete the Partial marker (line 1705).
- Line 1713: "`adoptedStyleSheets` IS used, on the DOCUMENT rather than on a shadow root:" becomes "`adoptedStyleSheets` IS used, on the DOCUMENT for a light-DOM component:". The rest of the paragraph is unchanged.
- Table, Stylesheet row (line 1726): Light becomes "the page: inlined into its `<head>` by the build (compiler.md §8.2), adopted by the document in the runtime (§9.6)"; Shadow becomes "the root: a `<link>` inside it from the build, a sheet it adopts in the runtime". Per the scheme Open, add a last row: "Forced color scheme (§9.5) | followed | not seen: the OS preference applies". Leave the Style scope row and line 1711 to `plan:_shared/static-style-handle-and-descriptions`.
- Append to the paragraph at line 1733: "An element that finds no root to adopt, because a client render created it rather than the parser, attaches one and links the same stylesheet into it, so a component is styled alike however it was created."
- Insert after line 1735: "**The interpreter renders the same two modes.** A component resolves its mode when it connects, from its own `$shadow` and the project default a host sets for the page with `setShadowDefault` (embedding.md §5.2). In shadow mode it adopts a declarative root or attaches one, as the module does, renders its children into it, and leaves its light children where they are for the real `<slot>`s to project. Its rules go into a sheet that root adopts (§9.6): the definition's own style as `:host` rules, and the style written at the usage site as an ordinary rule in the tree around the host, so the usage site still wins, as a page's rule for a built instance does. A light component rendered inside a shadow root writes its rules into that root for the same reason. Studio's Edit and Design canvases render every component in the light DOM so that its content stays selectable and editable; Preview, the live preview and `mount()` render as the build does." (Its last sentence follows the first Open.)
- Line 1737 becomes: "**A style object means the same thing in both modes.** `:host` and `:host(.sel)` are translated rather than passed through: inside a root they stand alone, and outside they become the host's own selector and that selector with `.sel`, which is what "the host, matching this" means when there is no root. A key that compounds onto the host, such as `:hover`, `.wide` or `&[open]`, is folded into `:host()` inside a root, because there the host is featureless and only the `:host` family matches it: `:host(:hover)`, never `:host:hover`. One function makes these translations for both tiers (`@jxsuite/runtime/css`), so moving a component between modes, or from Studio to a build, does not silently break its styles." Per the scheme Open, add: "A block keyed by a pure color-scheme query follows the OS preference inside a root and not a forced scheme (§9.5): the forced scheme is an attribute on the document's root element, which no selector in a shadow tree can see."
- Trailing marker (line 1741): "> **Status: Implemented.** Light DOM is the default in the interpreter and in compiled output. `$shadow` and `defaults.shadow` render into a shadow root in both: the build emits and adopts a declarative root, verified in a browser for both modes, and the runtime renders the same modes into the same trees."

**`spec.md` §9.5** (per the scheme Open), after the two numbered copies: "Inside a shadow root (§16.6) only the first copy is written, and without its root guard, because a selector in a shadow tree cannot see the document's root element: a shadow component follows the OS preference and not a forced scheme."

**`spec.md` §9.6**, line 1065: "a constructable stylesheet adopted by the document**, reached through `document.adoptedStyleSheets`" becomes "a constructable stylesheet adopted by the document, or by the shadow root the element renders in (§16.6)**, reached through `adoptedStyleSheets`".

**`spec.md` §18**: the WHATWG HTML Note's "which emits a declarative `<template shadowrootmode>` the element then adopts — `open` through `element.shadowRoot`, `closed` through `ElementInternals`." becomes "which a build emits as a declarative `<template shadowrootmode>` the element then adopts (`open` through `element.shadowRoot`, `closed` through `ElementInternals`), and which the interpreter renders into the same root."; its Evidence gains `packages/runtime/src/runtime.ts, packages/runtime/tests/shadow-dom.test.ts`. The CSS Scoping Note becomes "`:host`, `:host()` and `::slotted()` are emitted for a shadow component, a key compounding onto the host is folded into `:host()`, and `:host`/`:host()` are translated to the host's own selector in light DOM, by one function both tiers call, so one style object serves both modes. `:host-context()` is not offered — it never reached a second engine."; Evidence becomes `packages/runtime/src/css.ts, packages/runtime/tests/css.test.ts, packages/compiler/tests/shadow-dom.test.ts`. The WHATWG DOM Note, only if it still reads "Shadow trees are not used at all (§16.6)": "Custom elements are defined and `dispatchEvent` emits a real `CustomEvent`. Shadow trees are used only by a component that opts in with `$shadow` (§16.6); light DOM is the default."

**`embedding.md` §5.2**: "Three things are per realm" becomes "Four things are per realm", adding after the registry: "the project's shadow default (`setShadowDefault`, spec.md §16.6), which every element the realm defines reads when it connects, and which is per realm for the registry's reason". Per the first Open, `setCanvasLightComponents` joins the list of canvas switches.

**`compiler.md`**: in §8.2's "The compiler keeps what is its own" sentence (line 656, in whichever wording is current), drop the `:host` translation from the list and add after the sentence "The `:host` translation of spec.md §16.6 is `resolveHostKey`, which the runtime applies too." In §13's WHATWG HTML Note (as `plan:compiler/element-binding-table` leaves it), after "A component may opt into a shadow root with `$shadow` (spec.md §16.6)" add "(a project into all of them with `defaults.shadow`)".

**`ui.md` §11**, only if `plan:ui/principles-text` landed first: its CSS Scoping row names `resolveHostKey` in `packages/runtime/src/css.ts` where it names `resolveSelectorMember`.

**Fragments**:

- `bun run spec:change spec.md minor -m "The interpreter renders a component into a shadow root when its own shadow setting or the project default asks, with the host translation and stylesheet placement a build uses; a compiled element links its stylesheet into a root it attaches, the project default reaches the component module, and a key compounding onto the host folds into the :host() pseudo-class"` (add ", and a color-scheme block inside a root follows the OS preference" if the scheme Open is accepted).
- `bun run spec:change embedding.md minor -m "The project shadow default is a per-realm setting, set with setShadowDefault"` (add "and the canvas switches gain one that renders every component in the light DOM" per the first Open).
- `bun run spec:change compiler.md patch -m "The component stylesheet section names the shared host translation, and the WHATWG HTML note names the project shadow default"`.
- `bun run spec:change ui.md patch -m "The CSS Scoping row names the shared host translation"`, only with the ui.md edit.

**Docs** (no em dashes; `docs:prose` bans them):

- `docs/framework/concepts/components.md` (`spec: spec.md#16.6`): add `packages/runtime/src/css.ts` to `code:`. After the declarative-root example: "Studio's Preview and the live preview render it into a shadow root too. The Edit and Design canvases keep every component in the light DOM, so you can select and edit inside it." In the tip: "In a shadow component it stays `:host`, and a state like `:hover` or `.wide` is written `:host(:hover)` for you; in a light one, the build and Studio turn `:host` into the component itself, and `:host(.wide)` into `sd-card.wide`." Per the scheme Open, add a "Forced light or dark scheme" row to "What changes": "followed" and "not seen: the visitor's OS setting applies".
- `docs/framework/concepts/color-schemes.md` (`spec: spec.md#9.5`), per the scheme Open, a bullet: "Inside a component that opts into a shadow root, a scheme block follows the visitor's OS setting only: a forced scheme is set on the page's `<html>`, which the component's own styles cannot see."
- `docs/framework/concepts/styling.md` line 72: "through the document's adopted stylesheets" becomes "through adopted stylesheets (the document's, or a shadow component's own root)".
- `docs/extending/embedding/runtime-host.md` (`spec: embedding.md#5`), after the "Configure each mount" table: "One setting is per page rather than per mount. `setShadowDefault("open")` is your project's `defaults.shadow`: every component defined in the page reads it when it connects, and a component's own `$shadow` still wins. It is page-wide because custom elements are."
- `docs/framework/build.md` line 143: after "linked from inside the declarative shadow root", add ", or from inside the root the element attaches when a client render creates it,".
- `docs/studio/interface/modes.md`, per the first Open, under Preview: "A component that renders into a shadow root does so in Preview; Edit and Design keep it in the light DOM so that its content stays editable."
- No other page changes. The pages `docs:sync` will name through `code:` (`overlays.md`, `props-and-scope.md`, `reactivity.md`, `elements.md`, `functions.md`, `lists.md`, `color-schemes.md` when the Open is declined, the `site/` pages listing `site-build.ts`, `extending/contributing/docs.md`) describe nothing this plan changes. The generated `docs/extending/reference/standards.md` picks up the spec.md §18 rows on generation.

`spec.md` keeps other open items, so nothing graduates, and `plans/spec/` stays.

## Acceptance

- `bun run plans:status --who-claims spec.md#16.6` reports no open item; `bun run plans:check` is clean for `spec`.
- `grep -n "Status: Partial.\*\* The compiler ships the light default" specs/spec.md` and `grep -rn "resolveSelectorMember\|:host:hover" packages/*/src` print nothing.
- `bun run docs:status`, `docs:spec-release`, `docs:standards`, `docs:check`, `docs:links`, `docs:prose` and `docs:markdown` pass.
- Each touched workspace passes `bun test --isolate --coverage` and its manifest check.
- `jx build` on a project with `"defaults": { "shadow": "open" }` and a styled component: `dist/components/<tag>.js` attaches a shadow root, and `dist/components/<tag>.css` exists even for a styleless component.
- In a browser: on that built page, an instance rendered by a `$map` is styled, and a `":hover"` key on the component applies. In the live preview and in Studio's Preview, DevTools shows the component's `#shadow-root` holding an adopted sheet with `:host` rules, while Edit shows the same component in the light DOM (per the first Open).

## Slices

| Slice  | Scope                                                                                                                                                                               | Claims       | State |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----- |
| SDP1.1 | Site build passes `defaults` and the sheet href; the module links its sheet into a root it attaches; shadow sheets always written; spec.md §16.6 slot claims pinned in built output | —            | open  |
| SDP1.2 | `resolveShadowMode`, `resolveHostKey`, the `:host()` fold and (per the Open) `shadowTree` in `@jxsuite/runtime/css`; the compiler uses them; interpreter light-mode `:host`         | —            | open  |
| SDP1.3 | Interpreter shadow mode: per-root sheets, `_styleRoot`, `setShadowDefault`, adoption, two host rule sets, (per the Open) `setCanvasLightComponents`                                 | —            | open  |
| SDP1.4 | Live preview and Studio canvas set the default; spec.md, embedding.md, compiler.md edits, fragments and docs; spec.md §16.6 marker                                                  | spec.md#16.6 | open  |
