---
status: stub
disposition: reconcile
claims:
  - jx-markdown.md#3.1
size: S
---

# The detection section describes the content-document root Studio actually builds

## Context

`specs/jx-markdown.md` §3.1, line 75:

> **Status: Partial.** Detection ships: `isJxMarkdown` (`extensions/parser/src/transpile.ts`) performs the check and does not gate `transpileJxMarkdown`, and Studio applies the same rule through the `$studio.documentMode.componentWhen` hint in `extensions/parser/src/Markdown.class.json`. The `{ tagName: "div", $id: "content" }` wrapper does not exist: `splitFormatDocument` (`packages/studio/src/format/format-host.ts`) gives a content document a tagName-less root holding `children` plus any `state` and `imports`, and moves every other frontmatter key into a separate frontmatter object.

The section was unmarked before the census. Disposition `reconcile`: the tagName-less root is a deliberate design, carried by the declarative `$studio.documentMode` hints that extensions.md, parser.md and studio.md all describe, and no code anywhere in `packages/` or `extensions/` builds the `div#content` wrapper, so the sentence describing it is the stale part.

**What exists**

- `isJxMarkdown` in `extensions/parser/src/transpile.ts`: a regex over the raw frontmatter for a hyphenated `tagName`; pinned by `extensions/parser/tests/jx-markdown.test.ts`. It is exported from `@jxsuite/parser` (`extensions/parser/src/md.ts`) and called nowhere outside the parser package and its tests.
- `transpileJxMarkdown` runs on every `.md` source whatever its frontmatter, so detection does not gate the pipeline, as the section says.
- `Markdown.class.json` declares `$studio.documentMode: { default: "content", componentWhen: { frontmatterKey: "tagName", matches: ".+-.+" } }`, the same rule as `isJxMarkdown`, expressed as data.
- `splitFormatDocument` in `packages/studio/src/format/format-host.ts` keeps a component document whole; for a content document it builds `{ children }`, keeps `state` and `imports` on it, moves every other key into a frontmatter object, and seeds an empty `p` when the body has no children.

**What is missing**

- The §3.1 sentence rewritten to what ships: Studio decides component versus content from the format class's `documentMode` hint, and a content document is edited as a tagName-less `children` root with its other frontmatter keys held apart, not wrapped in a `div` with `$id: "content"`.
- A decision on whether `isJxMarkdown` stays a named public utility (§12.2) now that no host calls it, or whether §3.1 should name the `documentMode` hint as the mechanism and keep `isJxMarkdown` as the standalone equivalent.
- The marker removed, with a `minor` fragment for the reconciled text.

**Related**

- jx-markdown.md §12.2 (`isJxMarkdown`, the utility this section names).
- parser.md §3 (the `$studio.documentMode` hint on the `Markdown` class), extensions.md §10 (Studio format hints), studio.md §8.1 (format-class dispatch, where Studio reads the `documentMode` hint).
- docs/framework/site/jx-markdown.md already describes content documents as producing a plain element tree, so it needs no change.
