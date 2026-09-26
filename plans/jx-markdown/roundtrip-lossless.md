---
status: stub
disposition: implement
claims:
  - jx-markdown.md#12.8
requires:
  - jx-markdown/directive-attribute-routing
  - jx-markdown/repeater-map-template-roundtrip
size: M
workspaces:
  - extensions/parser
---

# Roundtrip serialization re-parses to the document it was given

## Context

`specs/jx-markdown.md` §12.8, line 431:

> **Status: Partial.** Both modes ship (`serializeRoundtrip` and `serializeExport` in `extensions/parser/src/serialize.ts`; Studio saves through roundtrip mode in `packages/studio/src/files/serialize-document.ts`), and a `tagName` chosen at render time throws as stated. Roundtrip mode is not the inverse of `transpileJxMarkdown` for several ordinary shapes, and no test feeds its output back through `transpileJxMarkdown`. `textContent` or inline children of a directive outside the transpiler's phrasing set (`div`, `section`, any custom element) are written as bare block content and come back wrapped in `p`, one paragraph per inline child, with edge whitespace lost. A custom element's `className` and `on*`, and a standard element's `href`, `title` or `value`, come back under `attributes` (§6.6). An `li` or table-part `map` template, or a repeater among a list's items, does not come back as written (§6.5). The `popover-open`, `open`, `modal` and `backdrop` style keys are written with their colons (`style.:popover-open.opacity`), because the serializer keeps its own pseudo-class set instead of using `collapseStylePaths` (§12.7); they re-parse, but not in the §7.3 spelling.

The section was unmarked before the census, and the census first listed it as verified: the API, both modes and the render-time `tagName` refusal all hold. The losses surfaced only when serializer output was fed back through the parser as a string, which is the path a Studio save and reopen takes and which no test takes. Disposition `implement`: "lossless for everything it can express" is the right contract, because Studio's save path depends on it.

This plan owns the item, and two of its losses are other items' fixes: the attribute routing is jx-markdown.md §6.6's, and the repeater shapes are §6.5's. Hence `requires`: the marker can only go once both have landed.

**What exists**

- `serializeRoundtrip` in `extensions/parser/src/serialize.ts`: frontmatter from every non-`children` key, then `jxToMdast` and remark-stringify.
- `convertToDirective` in the same file: a block directive's `textContent` is emitted as a `paragraph` child, and inline children of a tag outside `INLINE_CONTENT_TAGS` are emitted one block each. `directiveToJx` in `extensions/parser/src/transpile.ts` unwraps a paragraph only for a parent in `PHRASING_ELEMENTS`, so `div`, `section` and every custom element keep the `p`.
- `collapsePropsToAttrMap` in `serialize.ts` keeps its own `CSS_PSEUDO_NAMES`, which stops at `after` and has no pseudo-element branch, instead of calling `collapseStylePaths` (`transpile.ts`), the §12.7 inverse that knows both sets.
- `mdastToJx`, with its own `convertDirective` and `prototypeDirectiveToJx`, is exported from `@jxsuite/parser/serialize` and listed in parser.md §5, but nothing outside tests calls it, and its directive mapping has drifted from `directiveToJx`: attributes are copied raw into `attributes`, with no routing, dot-path expansion or `$` restoration, and a text child becomes a `span`. The serializer's round-trip tests (`extensions/parser/tests/serialize.test.ts`, `extensions/parser/tests/serialize-export.test.ts`) run through it at the mdast level, so they cannot see a string-level loss.
- `extensions/parser/tests/serialize-tagname-expression.test.ts` pins the render-time `tagName` refusal.
- Measured at b900b326, `serializeJxMarkdown` then `transpileJxMarkdown`: `{ tagName: "div", textContent: "hi" }` becomes `:::div` / `hi` / `:::` and comes back as `div > p "hi"` (`doc-note` the same); `{ tagName: "div", children: ["plain ", { tagName: "strong", … }] }` comes back as two sibling `p` elements with the trailing space gone; `{ tagName: "a", href: "/x", title: "t" }` and `{ tagName: "input", value: "v" }` come back with those keys under `attributes`; `style: { ":popover-open": { opacity: "1" }, "::backdrop": { … } }` is written `style.:popover-open.opacity="1" style.::backdrop.background="black"` and survives because `applyStyleKeyMapping` leaves an already-prefixed key alone.

**What is missing**

- A block directive's `textContent` and inline children written so they re-parse as themselves: for example a text directive or label for a single run, or the transpiler unwrapping a lone paragraph in any container directive the serializer wrote one into. Which side changes is this plan's first decision.
- `collapsePropsToAttrMap` built on `collapseStylePaths` (or the transpiler's two sets exported and shared), so every name §7.3 lists is written in the §7.3 spelling and a name added there reaches the serializer by construction.
- A decision on `mdastToJx`: delete it (and its README and parser.md §5 mentions) or rebuild it on `directiveToJx`. Either way it stops being the only thing the round-trip tests exercise.
- String-level round-trip tests, `serializeJxMarkdown` → `transpileJxMarkdown`, over a corpus of the shapes Studio saves (every example document in this spec, the starters' `.md` pages, and the shapes above), asserting deep equality; any shape that stays normalized (for example a standard element's attribute-routed property, if §6.6 keeps that routing) is named in §12.8.
- The marker removed once this and both required plans have landed.

**Related**

- jx-markdown.md §6.5 and §6.6 (the repeater and attribute losses this plan's marker lists), jx-markdown.md §7.3 (the spelling the serializer should write; the `placeholder` and `selection` fix there changes which names are pseudo-elements), jx-markdown.md §12.7 (`collapseStylePaths`).
- parser.md §5 (`serializeJxMarkdown`, and the `jxToMdast` / `mdastToJx` exports).
- studio.md §8.1 (format-class dispatch, the save path).
