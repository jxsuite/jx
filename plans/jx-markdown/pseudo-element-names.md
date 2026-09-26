---
status: stub
disposition: implement
claims:
  - jx-markdown.md#7.3
size: S
workspaces:
  - extensions/parser
---

# `placeholder` and `selection` style keys emit the two-colon selectors CSS accepts

## Context

`specs/jx-markdown.md` §7.3, line 301:

> **Status: Partial.** The mapping ships as listed (`CSS_PSEUDO_NAMES`, `CSS_PSEUDO_ELEMENTS` and `applyStyleKeyMapping` in `extensions/parser/src/transpile.ts`), but `placeholder` and `selection` are CSS pseudo-elements that have never had a one-colon form, and the transpiler gives them one colon: `style.placeholder.color` becomes `:placeholder`, `buildStyleRules` (`packages/runtime/src/css.ts`, which the compiler shares) emits `#id:placeholder`, and the browser discards the rule.

The section was unmarked before the census, and the census first listed it as verified, because the spec and the code agree: both put `placeholder` and `selection` in the one-colon set. The behaviour the section exists for does not hold for those two names. Its own closing paragraph gives the reason the list exists, a rule that silently matches nothing, and a one-colon `placeholder` is that failure. CSS 2 gave one-colon forms only to `before`, `after`, `first-line` and `first-letter`; `::placeholder` and `::selection` have none. Disposition `implement`: the fix is in code, and the §7.3 lists change with it.

**What exists**

- `CSS_PSEUDO_NAMES` in `extensions/parser/src/transpile.ts` includes `placeholder` and `selection`; its doc comment says `CSS_PSEUDO_ELEMENTS` is "for names that have never had a one-colon form" and excuses only `before` and `after` from it. `CSS_PSEUDO_ELEMENTS` is `["backdrop"]`.
- `applyStyleKeyMapping` checks the pseudo-element set first, so moving a name there is enough for the transpiler; `collapseStylePaths` already strips `::` before `:`.
- `resolveOneNestedSelector` in `packages/runtime/src/css.ts` appends a `:`-led key straight onto the scope; nothing in `packages/` rewrites `:placeholder`. Measured at b900b326: `transpileJxMarkdown('::input{style.placeholder.color="gray" style.selection.color="red"}')` gives `style: { ":placeholder": …, ":selection": … }`, and `buildStyleRules` turns those into `#x:placeholder { color: gray }` and `#x:selection { color: red }`.
- Studio already writes the correct spelling: `COMMON_SELECTORS` in `packages/studio/src/store.ts` offers `::placeholder`.
- No test and no tracked `.md` file uses either name, so the change rewrites nothing in the repository.
- The serializer keeps its own copy of the pseudo-class set (`collapsePropsToAttrMap` in `extensions/parser/src/serialize.ts`); jx-markdown.md §12.8's plan replaces it with `collapseStylePaths`. Until then a `::placeholder` key is written `style.::placeholder.…`, which re-parses unchanged.

**What is missing**

- `placeholder` and `selection` moved from `CSS_PSEUDO_NAMES` to `CSS_PSEUDO_ELEMENTS`, with a transpile test for each and a `collapseStylePaths` inverse test.
- A decision on compatibility: whether a JSON document that already carries `:placeholder` or `:selection` (written by an older transpile) is normalized to `::` by the runtime and compiler's selector resolution, or left as the author's literal selector.
- §7.3's two lists corrected, and the doc comment on `CSS_PSEUDO_NAMES` made true.
- docs/framework/site/jx-markdown.md ("Style attributes") names `backdrop` as the pseudo-element example; it gains the two names.

**Related**

- jx-markdown.md §12.4, §12.5 and §12.7 (`expandStylePaths`, `applyStyleKeyMapping`, `collapseStylePaths`), jx-markdown.md §12.8 (the serializer's own copy of the set).
- spec.md §9.2 (nested CSS selectors, the keys this mapping produces).
