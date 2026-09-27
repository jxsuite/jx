---
status: drafted
disposition: implement
claims: []
workspaces:
  - packages/compiler
size: M
---

# Every statically styled element gets a style handle that selects it alone, assigned once and written by every emitter

## Context

This plan claims nothing. It enables the two plans that need the handle `collectStyles` assigns to change, and both require it, so the handle is decided once:

- `plan:_shared/static-style-handle-and-descriptions` owns `spec.md` §9.2 and `compiler.md` §8.2. The handle is one of §9.2's two open parts and the whole of §8.2's. That plan writes the spec and docs text for the handle this plan ships, and flips both markers.
- `plan:spec/static-style-rules-only` owns `spec.md` §9.1. Moving a resolved declaration off the inline `style` attribute and into a rule is sound only when the rule's selector matches the element the declaration was written on and nothing else.

It stays separate from the owner of §9.2 because `plan:spec/static-style-rules-only` needs only the handle, and the `$description` comments share no decision with it (`plans/README.md`: split when a dependent needs only part of a plan).

The markers it serves. `specs/spec.md` §9.2, line 903 (the handle half):

> the compiler's handle is the author's FIRST class whenever `className` is set (`collectStyles` in `packages/compiler/src/shared.ts`), so an element's rules also style every other element carrying that class; the generated class is `jx-<n>` on pages rather than `.<tagName>-<n>`.

`specs/compiler.md` §8.2, line 650:

> **Status: Partial.** Extraction, the shared `buildStyleRules` nesting and the component-sheet inlining ship (see the marker closing this section). The handle preference does not: `collectStyles` in `packages/compiler/src/shared.ts` prefers `#id`, but assigns a generated `.jx-N` class only when an element has neither `id` nor `className`, and otherwise keys its rules on the author's first class, so an element's rules also style every other element carrying that class; this is the drift `spec.md` §9.2 marks.

`specs/spec.md` §9.1, line 875, which needs the handle before it can move a declaration into a rule:

> **Status: Partial.** The runtime conforms (§9.6). The static compiler does not: a `${…}` base declaration it can resolve against a build-time scope, and a component definition's resolved host style, are written into an inline `style` attribute (`inlineStyleDeclarations` and the `hostStyle` argument of `buildAttrs` in `packages/compiler/src/shared.ts`), so in prerendered HTML a `:hover` or `@media` block cannot override those declarations.

**What exists** (re-verified 2026-09-27 with scratch `compileStyles`, `buildComponentCSS` and `compileElement` calls)

- `collectStyles` (`packages/compiler/src/shared.ts`) picks one selector per styled node: `#${def.id}` when `id` is set, else `.${def.className.split(" ")[0]}`, else it writes `${prefix}-${n}` into `def.className` and selects that. Writing into `className` is the only channel by which the generated class reaches markup: `buildAttrs` and the lit emitters (`compile-element.ts` lines 1079 and 1268, `compile-client.ts` line 660) read `className` after the style pass. Its tag-selector fallback is unreachable, because a styled node always ends with an id or a class.
- The prefix is `jx` for a page's sheet (`compileStyles`), the tag name for a component's sheet (`buildComponentCSS`), and `jxs` for the block `expandComponents` (`packages/compiler/src/site/site-build.ts`) collects from a page-level instance's slotted children before the page pass runs.
- A definition is walked twice, from two separate parses: `buildComponentCSS` writes its sheet, and `emitElementModule` runs `collectStyles` again only to stamp classes on its lit template (its `cssRules` array is discarded). The two agree because both walk the same tree in the same order. `compile()`'s custom-element route and `compileStaticPage`'s islands also walk one node twice, and agree because the second pass reads back the class the first wrote.
- A page-level instance's resolved host style is merged into `node.style` by `expandComponents` and gets a rule on whatever handle the page pass picks. A nested instance's is written inline by `renderComponentInstance`.
- The runtime's handle is `data-jx="jx-<hash>"` at specificity (0,1,0) for every element, id or not (`applyStyleInto` in `packages/runtime/src/runtime.ts`, `spec.md` §9.6).

**Verified defects**

- An author's class is shared: two elements with `className: "card"`, one styled red and one blue, build to `.card { color: red }` then `.card { color: blue }`, so both are blue. Two page-level instances with `className: "icon"` and different `maskImage` props both render the second mask (census, `buildSite`).
- A bound value reaches the selector: `className: "${state.cls}"` and `id: "${state.pid}"` build to `.${state.cls}` and `#${state.pid}`, which a browser discards.
- **Not in the stub:** a `$ref` `className` (the schema's `StringOrRef`) on a styled element aborts the build: `def.className.split is not a function`.
- **Not in the stub:** a literal id is not always a selector. `id: "1st"` builds to `#1st`, which is invalid CSS.
- **Not in the stub:** an `id` makes the built page cascade differently from its preview. A section styled `"& p": { color: "blue" }` with two red-styled `<p>` children, one carrying `id: "intro"`, builds to `.jx-0 p { color: blue }`, `#intro { color: red }` and `.jx-1 { color: red }`. On the page the first paragraph is red and the second blue; in Studio, where every handle is (0,1,0), both are blue.
- **Not in the stub:** a styled element with `attributes.class` gets two `class` attributes. `buildAttrs` writes `className` first, so static HTML keeps the handle and drops the author's class (`<p class="jx-0" class="b">`). The element target writes `attributes` first, so its template keeps the author's class and drops the handle. The runtime applies `attributes` after `className`, so the author's `attributes.class` is what it leaves.
- **Not in the stub:** a repeater's item template gets no handle, because `collectStyles` walks only an array `children` and `cases`. Its literal declarations and nested blocks are dropped by the element target (`{ map: { tagName: "li", className: "row", style: { color: "red", ":hover": {…} } } }` compiles to `<li class="row">` and an empty component sheet). The client target writes the literal ones inline (`emitLitMapTemplate`) and drops the nested blocks.

**Related, no edge**

- `plan:spec/report-dropped-reactive-styles` (§9.3): its report names the selector a declaration was dropped from, which becomes a generated class here. The element target's second walk also records every dropped declaration a second time; the walk below stops doing that.
- `plan:spec/static-dom-property-emission` (§8.1) leaves `id` and `class` emission to this plan and pins today's two `class` attributes in a test.
- `plan:spec/shadow-dom-parity` (§16.6) adds a trailing parameter to `collectStyles`. This plan keeps the signature, so the two merge textually.

## Outcome

No marker changes here. Once it lands:

- every node with a `style` object, a repeater's item template included, carries one generated class that no other element carries, and its rules are keyed on it;
- every emitter writes that class into the element's single `class` attribute, so the prerendered HTML, the component module and the client module stamp the same handle;
- `spec.md` §9.2's handle half and `compiler.md` §8.2 close in the same pull request, through `plan:_shared/static-style-handle-and-descriptions`'s text.

## Decisions

- **Open:** does a literal `id` stay the handle? Recommendation: no; every styled element gets a generated class, id or not. An id rule sits at (1,0,0) where the runtime's handle sits at (0,1,0), so today the built page and the Studio preview resolve a competing rule differently (the `#intro` case above). An id also fails "selects it alone" in a component definition, where it repeats per instance and a page element with the same id takes the rule, and some literal ids are not selectors at all. The cost is a changed specificity for eight id-styled elements in the repository's own sites (`main-content`, `docs-mobile-nav`, `site-mobile-menu`, `site-search-modal`, `site-search-listbox` in `sites/jxsuite.com`, `main` in the museum starter, `new-todo` in `examples/`), which breaks nothing that the preview does not already show. If the id is kept instead, it is the handle only for a page element whose `id` is a literal CSS identifier, never inside a definition; everything else below is unchanged.
- **Open:** the spelling. Recommendation: the class spellings that ship, with the prefix naming the sheet that holds the rules: `jx-<n>` for the page sheet, `jxs-<n>` for the page's slotted-content block, `<tagName>-<n>` for a component's sheet. Class tokens compose, so one element can carry handles from two sheets (a nested instance carries its outer definition's `<outer>-<n>` and is also matched by its own sheet's tag rule), where a single-valued `data-jx` attribute cannot. `spec.md` §16.6 and its Style scope row stay true, and markup does not grow. §9.6's reason for `data-jx` (a later `attributes.class` write wiping a class handle) does not hold for a string emitter that writes the class attribute once, which the next decision guarantees. A content hash's sharing pays off in the runtime's interned sheet; a static sheet is written once.
- **Open:** per-instance values for §9.1. Recommendation: this plan mints no per-render handle and no page-level rule sink for `renderComponentInstance`. `plan:spec/static-style-rules-only` writes a definition's resolved per-instance declarations as `property: var(--…)` in the definition's own sheet, keyed on the definition's handle or tag, and sets the variables inline on the instance, as §9.6 does in the runtime. A per-render handle would need a second handle on the element, a page-scoped counter, and a sink threaded through the prerender, all to key rules the indirection writes once per definition. A page-level instance is already a page node with its own `jx-<n>` after this plan, so its merged host style is correct without either.
- **Decided:** the handle is kept under a module-private `Symbol` on the node, and `className` is never written, because `className` is author data that may be a `$ref` object or a template. A symbol-keyed property survives the object spreads the prerender makes (`renderComponentInstance`'s instance copy, `compileStaticPage`'s island definition) and stays out of `JSON.stringify` (`data-jx-props`, emitted documents).
- **Decided:** assignment is idempotent: a node keeps the first handle any pass gives it, because the same node is walked by more than one pass (the custom-element route of `compile()`, the islands of `compileStaticPage`, `buildComponentCSS` then the prerender), and each of those already relies on the second pass reusing the first pass's class.
- **Decided:** any node with a `style` object gets a handle, whether or not a static rule results (today's predicate), and numbering is pre-order: the node, its `children` in order with a repeater's `map` template at its position, then its `$switch` cases. That keeps every existing number for documents without repeaters, and gives `plan:spec/static-style-rules-only` a handle for a node whose only declarations are reactive.
- **Decided:** an element writes one `class` attribute: the author's classes, then the handle. The author's classes are `attributes.class` when the element writes one and `className` otherwise, because that is what the runtime leaves in effect (`attributes` apply after properties) and the two compiled emitters disagree with each other today. Every `attributes` loop skips `class`.
- **Decided:** a repeater's item template gets one handle shared by every row, and its non-reactive rules go to the sheet the template belongs to, because a row's literal declarations are identical per row. The client target stops writing a row's literal declarations inline, or the new `:hover` rules could never apply; its templated declarations stay inline for `plan:spec/static-style-rules-only`.
- **Decided:** the element target assigns handles without building rules (`assignStyleHandles`), because its rules are thrown away and building them records each dropped reactive declaration a second time.
- **Decided:** this plan lands in the same pull request as `plan:_shared/static-style-handle-and-descriptions`, because it changes behaviour `spec.md` §9.2 line 918 and `docs/framework/concepts/styling.md` describe, and that plan owns their text.

## Implementation

1. **`packages/compiler/src/shared.ts`**
   - Add `const STYLE_HANDLE = Symbol("jx.styleHandle")` and a local `type Handled = { [STYLE_HANDLE]?: string }`.
   - `export function styleHandleOf(node: unknown): string | undefined`: the class a style pass gave `node`, or `undefined`. Doc comment cites `spec.md` §9.2 and carries `@docs framework/concepts/styling`.
   - `function handleFor(def, counter, prefix): string`: returns the existing handle, or writes `${prefix}-${counter.n}`, increments the counter and returns it.
   - `function walkStyleScopes(def, visit)`: the one traversal. Pre-order over an object node; a node that `isMappedArray` recurses into its `map` only; otherwise `visit(def)`, then each member of an array `children`, then the `map` of a whole-children repeater (`isMappedArray(def.children)`), then each value of `cases`.
   - `export function assignStyleHandles(def, counter, prefix): void`: `walkStyleScopes` calling `handleFor` on every node with a `style`.
   - `collectStyles`: keep the signature. Body is `walkStyleScopes` with a visitor that, for a node with a `style`, calls `pushStyleRules` with the selector `.` + `handleFor(node, counter, prefix)`. Delete the `className` write, the `#id` and first-class branches, and the tag-selector fallback.
   - `export function authorClassValue(def): unknown`: `def.attributes.class` when `attributes` owns a `class` key, else `def.className`.
   - `buildAttrs`: replace the `className` read with `resolveStaticValue(authorClassValue(def), scope)`, keep it only when it is a non-empty string or a number, append `styleHandleOf(def)`, and write one `class` when the result is non-empty. Skip `class` in the `attributes` loop.
   - Correct the doc comments that say `.jx-N` (`buildComponentCSS`) or that the handle lives in `className`.
2. **`packages/compiler/src/targets/compile-element.ts`**
   - Add `function litClassAttr(def, templ: (s: string) => string, ref: (r: string) => string): string | null`. The author part is `${${ref(v.$ref)} ?? ""}` for a `$ref`, `templ(v)` for a string, nothing otherwise; the handle follows after a space. It returns `class="…"` or `null`.
   - `emitLitNode`: skip `class` in the `attributes` loop, and replace the `className` push with `litClassAttr(def, toLitExpr, refToExpr)`. This also fixes a `$ref` `className`, which is emitted as `[object Object]` today.
   - `emitMappedArray`: the same for `mapDef`, with `mapRefToExpr`.
   - `emitElementModule`: replace the discarded `collectStyles` loop with `assignStyleHandles(child, counter, doc.tagName)` per child.
3. **`packages/compiler/src/targets/compile-client.ts`**
   - `emitLitMapTemplate`: skip `class` in the `attributes` loop; write `class` from `authorClassValue(def)` through `mapRefsToLit` or `mapRefToClientExpr`, then the handle. In its inline-style block, drop the literal branch and keep the template branch.
   - `buildClientNode`, dynamic `attributes`: when the key is `class` and the node has a handle, register a fresh `_t<n>` binding whose body joins the bound value and the handle, ignoring a null or empty value. Do not reuse `addRefBinding`'s shared key.
4. No change to `site-build.ts`, `compile-static.ts` or `compiler.ts`: they reach the handle through `collectStyles` and `buildAttrs`.

**Integration contract.** Once this lands, `packages/compiler/src/shared.ts` exports `styleHandleOf(node)`, `assignStyleHandles(def, counter, prefix)` and `authorClassValue(def)`, and `collectStyles` keeps its signature. Every node with a `style` object, a repeater's item template included, has a handle no other element carries, minted once and kept by every later pass and by object spreads. Its static rules are keyed `.<handle>`, and no author class, id or bound value reaches a selector. A definition's handles are the same in `buildComponentCSS` and in `emitElementModule`'s template. Every emitter writes exactly one `class` attribute, author classes then the handle, in static HTML, the component module's templates and the client module's row templates and `class` bindings. There is no per-render handle and no page-level rule sink in `renderComponentInstance` (the per-instance Open). `recordDroppedReactive` receives `.jx-<n>`-style selectors. For `plan:_shared/static-style-handle-and-descriptions`'s text under the recommended Opens: its `spec.md` §9.2 line-918 sentence drops "the element's own `#id` when its `id` is a literal, and otherwise" and gains a clause that an author's `id` is not the handle because an id rule outranks the runtime's (§9.6), plus one that the author's classes are `attributes.class` when written, else `className`; its §16.6 addition drops "unless it carries a literal `id`, which is its handle instead"; its `styling.md` sentence drops "its `id`, when you wrote one as plain text".

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`, then `bun scripts/check-coverage-manifest.ts packages/compiler`.

- **`packages/compiler/tests/shared.test.ts`**, new describe `style handles (spec.md §9.2)`:
  - `an author's class is never the handle`: two `className: "card"` siblings, one styled; the sheet has `.jx-0 { color: red }` and no `.card`, and `renderStaticNode` gives `class="card jx-0"` and `class="card"`.
  - `a bound className or id never reaches a selector`: `"${state.cls}"` and `"${state.pid}"`; the sheet has no `${`, and the HTML carries `class="hot jx-0"` and `id="box"` beside `class="jx-1"`.
  - `a $ref className composes instead of aborting the build`: `{ $ref: "#/state/cls" }` gives `class="hot jx-0"`.
  - `an id is not the handle`: `id: "1st"` gives `.jx-0` and keeps `id="1st"` (inverted if the id Open goes the other way).
  - `attributes.class replaces className and keeps the handle`: `className: "a"`, `attributes: { class: "b" }` gives exactly one `class="b jx-0"`.
  - `assignment is idempotent`: two `compileStyles` passes over one document give the same `styleHandleOf` and one handle token.
  - `the handle survives a spread and stays out of JSON`.
  - `a repeater's item template gets one handle, in walk order`: a styled sibling, a whole-children repeater and a member repeater number `jx-0`, `jx-1`, `jx-2`, with the template's `:hover` rule present.
  - Rewrite the fifteen `#…` selector assertions (lines 961 to 1623) to the generated class.
- **`packages/compiler/tests/shared-coverage.test.ts`**: rewrite the six `#box.child…` assertions.
- **`packages/compiler/tests/compiler.test.ts`**: rewrite `#btn:hover`, `#root.active`, `#inp[disabled]`, `#para:hover`, `#box:hover` and `.card.inner` to the generated class, and assert `class="card hero jx-0"`.
- **`packages/compiler/tests/compile-element.test.ts`**, new describe `compileElement — style handles`:
  - `a row template carries the definition's handle and its rules reach the sheet`: `class="row x-list-0"` in the module, and `.x-list-0 { color: red }` and `.x-list-0:hover` from `buildComponentCSS`.
  - `the module stamps exactly the handles the component sheet selects`: a definition with styled children, a `$switch` case and a repeater; the `x-el-<n>` tokens in the module equal those in the sheet.
  - `one class attribute with attributes.class, literal and bound`, and `a $ref className binds instead of printing [object Object]`.
- **`packages/compiler/tests/compile-client.test.ts`**, new describe `compileClient — style handles`:
  - `a row's literal declarations are rules, not inline`: the page `<style>` has `.jx-0 { color: red }` and `.jx-0:hover`; the row template has `class="jx-0"` and no `color: red`; a templated declaration stays inline.
  - `a bound attributes.class keeps the handle`: the binding body contains `"jx-0"`.
- **`packages/compiler/tests/site-build-nested-components.test.ts`**: `two page-level instances sharing a class keep their own values`: two `lcb-icon`s with `className: "icon"` and different props give `class="icon jx-0"` and `class="icon jx-1"`, a rule for each, and no `.icon {`.
- Any other exact-markup assertion on a styled element with an `id` gains its `class`; the suite run names them.

Coverage: the per-file bar in `packages/compiler/bunfig.toml` is lines 0.982, functions 0.98. Every new function has a direct case above, so `shared.ts`, `compile-element.ts` and `compile-client.ts` hold it. No new source file. Ratchet only if the worst-file minimum rises.

## Specs & docs

No spec edit and no fragment here. `spec.md` §9.2, §16.6 and `compiler.md` §8.2 are `plan:_shared/static-style-handle-and-descriptions`'s, and it lands in the same pull request with the adjustments listed at the end of the integration contract. This plan graduates nothing.

Docs pages `bun run docs:sync` names for `shared.ts`, `compile-element.ts` and `compile-client.ts`:

- `docs/framework/concepts/styling.md`: edited by the co-landing plan. Under the recommended id Open, its "Different handle, same cascade" sentence (line 72) becomes true for elements with an id and needs no qualification.
- `docs/framework/concepts/lists.md`: no change. Its claim that `style` works in a `map` template becomes true in both compiled targets.
- `docs/framework/concepts/components.md` (line 139, the generated `.<tagName>-<n>` class): no change; still true.
- `docs/framework/concepts/elements.md`, `color-schemes.md`, `functions.md` and `docs/framework/build.md`: no change; none describes the handle or class emission.

## Acceptance

- `bun run plans:check --audit spec` and `bun run plans:check --audit compiler` report nothing for this file.
- The `packages/compiler` suite and manifest check pass at their thresholds.
- `grep -n 'split(" ")\[0\]' packages/compiler/src/shared.ts` finds nothing.
- Scratch `compileStyles`: the two-`card` document gives two rules on two handles; the bound-class document's sheet contains no `${`; a `$ref` `className` builds; `id: "1st"` gives a class rule; the `#intro` document gives `.jx-1` and `.jx-2` rather than `#intro`.
- Scratch `compileElement` on the `x-list` definition above gives `<li class="row x-list-0"`, and `buildComponentCSS` for it is non-empty.
- `bun run build` in `sites/jxsuite.com`: no built `index.html` contains `class=` twice on one tag or a selector starting `.${` or `#${`, and the eight id-styled elements render as they do in the Studio canvas.
