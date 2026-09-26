---
status: stub
disposition: implement
claims: []
size: M
workspaces:
  - packages/compiler
---

# Every statically styled element gets a style handle that selects it alone, assigned in one place

## Context

This plan claims nothing. It enables the two plans that change the handle `collectStyles` assigns, and both require it, so the handle is decided once:

- `plan:_shared/static-style-handle-and-descriptions` owns `spec.md` §9.2 and `compiler.md` §8.2. The handle is one of §9.2's two open parts and the whole of §8.2's. That plan keeps the other §9.2 part (the `$description` comments), the spec text for whatever handle this plan ships, and both marker flips.
- `plan:spec/static-style-rules-only` owns `spec.md` §9.1. Moving a resolved declaration off the inline `style` attribute and into a rule is sound only when the rule's selector matches the element the declaration was written on and nothing else. This plan gives it that guarantee and one function to ask for an element's handle.

Both census stubs proposed this split on their own ("detailing lifts the handle assignment into an enabling plan that claims nothing and that both require"), and the cross-spec review asked for it. It stays separate from the owner of §9.2 instead of merging with it because `plan:spec/static-style-rules-only` needs only the handle. The `$description` comments share no decision with the handle and touch `packages/site`, which the handle does not, so a merge would make §9.1 wait on unrelated work (`plans/README.md`: split when a dependent needs only part of a plan).

The markers it serves. `specs/spec.md` §9.2, line 903 (the handle half):

> the compiler's handle is the author's FIRST class whenever `className` is set (`collectStyles` in `packages/compiler/src/shared.ts`), so an element's rules also style every other element carrying that class; the generated class is `jx-<n>` on pages rather than `.<tagName>-<n>`.

`specs/compiler.md` §8.2, line 650:

> **Status: Partial.** Extraction, the shared `buildStyleRules` nesting and the component-sheet inlining ship (see the marker closing this section). The handle preference does not: `collectStyles` in `packages/compiler/src/shared.ts` prefers `#id`, but assigns a generated `.jx-N` class only when an element has neither `id` nor `className`, and otherwise keys its rules on the author's first class, so an element's rules also style every other element carrying that class; this is the drift `spec.md` §9.2 marks.

`specs/spec.md` §9.1, line 875, which needs the handle before it can move a declaration into a rule:

> **Status: Partial.** The runtime conforms (§9.6). The static compiler does not: a `${…}` base declaration it can resolve against a build-time scope, and a component definition's resolved host style, are written into an inline `style` attribute (`inlineStyleDeclarations` and the `hostStyle` argument of `buildAttrs` in `packages/compiler/src/shared.ts`), so in prerendered HTML a `:hover` or `@media` block cannot override those declarations.

**What exists**

- `collectStyles` in `packages/compiler/src/shared.ts` picks one selector per styled node: `#${def.id}` when `id` is set, else `.${def.className.split(" ")[0]}` when `className` is set, else it writes `${prefix}-${n}` into `def.className` and selects that. Writing into `def.className` is how the generated class reaches the markup: `buildAttrs` and the client and element targets' templates (`compile-client.ts`, `compile-element.ts`) read `className` after the style pass.
- The prefix is `jx` on pages (`compileStyles`), the tag name inside a component definition (the definition stylesheet in `shared.ts`, and `compile-element.ts`), and `jxs` for a component instance's slotted children, which `expandComponents` in `packages/compiler/src/site/site-build.ts` serializes before the page's style pass and collects into a separate `slotCss` rule sink.
- A page-level component instance's resolved host style is merged into `node.style` by `expandComponents` (the `resolvedStyle` merge) and gets a rule on whatever handle `collectStyles` picks. A nested instance's is written inline by `renderComponentInstance` (`shared.ts`), which has no stylesheet to append to.
- The runtime's handle is a different mechanism (`spec.md` §9.6): `data-jx="jx-<hash>"`, a content hash, chosen over a class because a static `attributes: { "class": … }` applied after the style would destroy a class handle, and because a hash is stable across a server render and the client render that follows it.

**Verified** (scratch `buildSite` projects and a direct `collectStyles` call, 2026-09-26; `errors: []` in both builds):

- `.card { color: red }` from one element's style also colours a second, unstyled `.card`.
- Two page-level instances of one component, each with `className: "icon"` and a different `$props.name` feeding a `maskImage` template host style, built to `.icon { mask-image: url(one.svg) }` followed by `.icon { mask-image: url(two.svg) }`, so both instances render `two.svg`. A third instance with no `className` got `.jx-0` and its own value.
- A bound `className: "${state.cls}"` and a bound `id: "${state.pid}"` built to the selectors `.${state.cls}` and `#${state.pid}`, which a browser discards, so both elements are unstyled while the HTML carries the resolved `class="hot"` and `id="box"`: the style pass reads the unresolved value that `buildAttrs` resolves for the markup.

**What is missing**

1. A handle that selects the element and nothing else: `#id` only for a literal `id`, otherwise a generated handle added beside the author's classes, never an author's class and never a value the author binds.
2. The spelling, one answer for pages, component definitions and slotted children: `.<tagName>-<n>` as `spec.md` §9.2 and §16.6 state, `jx-<n>` as pages ship and `compiler.md` §8.2 restates, or the runtime's `data-jx` hash, which a class binding cannot destroy and which would make the server and client handles one value. This plan decides it; `plan:_shared/static-style-handle-and-descriptions` writes the spec text.
3. The same handle in every emitter that writes the element: the prerendered HTML and the client and element targets' templates, so hydration and an upgrade keep it. `data-jx-static` and `data-jx-prerendered` stay hydration markers, never selectors.
4. An integration contract for `plan:spec/static-style-rules-only`: one function that yields an element's handle, callable from the page style pass and from the prerender path, plus the rule sink that path writes to (`slotCss` is the precedent). Whether this plan also mints a per-instance handle for a component definition rendered more than once, or that plan uses §9.6's custom-property indirection so the definition's handle suffices, is decided when the two are detailed together.

**Related**

- `spec.md` §9.6 (the runtime's `data-jx` handle), §16.6 (the light-DOM generated-class sentence, and the Style scope row of its table, line 1725).
- `plan:spec/report-dropped-reactive-styles` (§9.3): the dropped-declaration report is keyed by selector, which this plan changes.
- `compiler.md` §4.5 (nested CSS), §8.1 (where a page-level instance's host style lands).
