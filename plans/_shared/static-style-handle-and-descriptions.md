---
status: stub
disposition: implement
claims:
  - spec.md#9.2
  - compiler.md#8.2
requires:
  - spec/style-handle-assignment
size: S
workspaces:
  - packages/compiler
  - packages/site
---

# A static build comments each style rule with its `$description`, and the specs name the handle the compiler assigns

## Context

Two items in two specs, one owner. `spec.md` §9.2 has two open parts, the `$description` comments and the compiler's style handle. `compiler.md` §8.2 restates the handle half as its own contract ("the `#id` / `.jx-N` handle preference") and was marked Partial after the census for the same drift. The handle itself is built by `plan:spec/style-handle-assignment`, which this plan requires and which `plan:spec/static-style-rules-only` requires too; what stays here is the `$description` comments, the spec text for the handle that plan ships (§9.2, §16.6 and the `compiler.md` §8.2 restatement), and both marker flips. It moved from `plans/spec/` to `_shared/` when it took `compiler.md` §8.2.

`specs/spec.md` §9.2, line 903:

> **Status: Partial.** Flattening, selector-list distribution, recursion, the declaration-body at-rules and their array form, and `@keyframes` ship in `buildStyleRules` (`packages/runtime/src/css.ts`). Two parts do not: no static build renders a block's `$description` as a comment (the compiler's `pushStyleRules` and `packages/site/src/site-style.ts` emit the rule text only), and the compiler's handle is the author's FIRST class whenever `className` is set (`collectStyles` in `packages/compiler/src/shared.ts`), so an element's rules also style every other element carrying that class; the generated class is `jx-<n>` on pages rather than `.<tagName>-<n>`.

`specs/compiler.md` §8.2, line 650 (a new leading marker, added for the cross-spec review's missed item M3; the section's closing `> **Status: Implemented.**` marker, line 664, is kept for the parts that ship):

> **Status: Partial.** Extraction, the shared `buildStyleRules` nesting and the component-sheet inlining ship (see the marker closing this section). The handle preference does not: `collectStyles` in `packages/compiler/src/shared.ts` prefers `#id`, but assigns a generated `.jx-N` class only when an element has neither `id` nor `className`, and otherwise keys its rules on the author's first class, so an element's rules also style every other element carrying that class; this is the drift `spec.md` §9.2 marks.

**What exists**

- `buildStyleRules` in `packages/runtime/src/css.ts` carries a block's `$description` as `CssRule.description`, off the rule text so it never reaches `hashCss` or an adopted sheet; its doc comment already says a static emitter renders it as a comment. `packages/runtime/tests/css.test.ts` covers it.
- `pushStyleRules` in `packages/compiler/src/shared.ts` and `buildSiteStyleCSS` in `packages/site/src/site-style.ts` push `rule.text` only.
- `collectStyles` assigns `${prefix}-${n}` only when a styled node has neither `id` nor `className`, and otherwise selects `#id` or `.${className.split(" ")[0]}`. The prefix is `jx` on pages, the tag name inside component definitions, and `jxs` for a component instance's slotted children (`expandComponents` in `packages/compiler/src/site/site-build.ts`).
- Verified: `.card { color: red }` from one element's style also colours a second, unstyled `.card`. The §8.2 marker was confirmed against the same code: the `.jx-N` assignment is guarded on `def.style && !def.id && !def.className`, and the selector falls back to the first class. `plan:spec/style-handle-assignment` records two more scratch builds: two component instances sharing an author class share one host-style rule, and a bound `className` or `id` becomes an invalid selector.
- The spec text disagrees with itself as well as with the code: `spec.md` §9.2 and §16.6 (the sentence and the Style scope row, line 1725) say `.<tagName>-<n>`, while `compiler.md` §8.2 says `.jx-N`.

**What is missing**

1. A static build writes `/* description */` above each rule that carries one, in both emitters (`pushStyleRules` and `buildSiteStyleCSS`). A description containing `*/` must not end the comment early; `escapeStyleText` already covers `</style`.
2. The handle, from `plan:spec/style-handle-assignment`: `#id`, else a generated handle, never an author's shared class, as §9.2 states, and stable for hydration (`data-jx-static` and `data-jx-prerendered` are not selectors).
3. The spec text for the spelling that plan chooses: either pages move to `.<tagName>-<n>`, or §9.2 is reconciled to what ships, with §16.6 saying the same. `compiler.md` §8.2's restatement then says the same thing or, per the compiler audit's rule for restated contracts, shrinks to a pointer at `spec.md` §9.2.

**Related**

- §9.1 (`plan:spec/static-style-rules-only`), §9.6 (the runtime's `data-jx` handle), §16.6 (the light-DOM generated-class sentence).
- `compiler.md` §4.5 (nested CSS), §8.2 (CSS extraction).
