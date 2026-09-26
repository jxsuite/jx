---
status: stub
disposition: implement
claims:
  - jx-markdown.md#9
size: S
workspaces:
  - extensions/parser
---

# Every CommonMark construct the transpiler meets is mapped or named as dropped

## Context

`specs/jx-markdown.md` §9, line 361:

> **Status: Partial.** The table and build-time highlighting ship (`JX_TAG_MAP` and `mdastNodeToJx` in `extensions/parser/src/transpile.ts`, `extensions/parser/src/highlight.ts`), but a reference-style link or image (`[text][label]`, `![alt][label]` with a `[label]: url` definition) is dropped together with its text, and a GFM footnote with its definition. Two constructs the table does not list are mapped rather than dropped: raw HTML goes through `htmlToJx` and a hard line break becomes `br`. §13's CommonMark note says §10 names the unmapped constructs and that each is dropped; §10 names none of them.

The section was unmarked before the census, and the census first listed it as verified and §13's row as informative. The table is accurate for what it lists; the gaps are what it leaves out, and the Standards Alignment row that binds this section states a rule about those gaps that the code does not follow. Disposition `implement`: a reference link is an ordinary CommonMark link, and losing its visible text silently is a transpiler defect, not a limitation to document. The table rows for HTML and hard breaks and the §13 note are rewritten in the same change, so the row's `**Subset**` names what the subset is.

**What exists**

- `JX_TAG_MAP` and `mdastNodeToJx` in `extensions/parser/src/transpile.ts`: the table's rows, plus `break` → `br` (not in the table) and `html` → `htmlToJx` (`extensions/parser/src/html-to-jx.ts`, not in the table). Any mdast type without an entry returns `null`, which is how `linkReference`, `imageReference`, `definition`, `footnoteReference` and `footnoteDefinition` disappear. The parse runs `remark-gfm`, so the footnote nodes exist to be dropped.
- Measured at b900b326: `'a ![pic][i] b [full][r] c [r] d'` with both definitions transpiles to one `p` whose children are `"a "`, `" b "`, `" c "`, `" d"`; the image, the three link texts and the definitions are gone. `'x[^1]'` with a footnote definition gives `p "x"`. A raw `<div class="x">` block gives a `div` with `attributes.class`, and a two-space hard break gives `br` between the two text runs.
- `extensions/parser/tests/transpile.test.ts`, the row's evidence, pins `html` → `htmlToJx` and `break` → `br` at the node level, and pins that `definition` and `footnoteDefinition` return `null` ("returns null for unknown node types"). No test parses a reference link or image, so the text loss is pinned nowhere.
- §10 (Limitations) lists four authoring limits and no unmapped construct.

**What is missing**

- `linkReference` and `imageReference` resolved against the document's `definition` nodes to `a` and `img` (mdast-util-definitions, or a pre-pass), with the text kept even when the label has no definition, and tests for full, collapsed and shortcut references.
- A decision on footnotes: map them (to what Jx shape) or keep dropping them, and if dropped, say so.
- §9's table gains the rows that ship (HTML → `htmlToJx`, hard break → `br`, and whatever the reference and footnote decisions produce); §10 or §9 names whatever is still dropped; §13's CommonMark note rewritten to match, with its evidence column pointing at the new tests.
- docs/framework/site/jx-markdown.md says "Standard Markdown maps headings, paragraphs, lists, and links"; it gains a sentence if footnotes stay unmapped.

**Related**

- jx-markdown.md §10 (Limitations), jx-markdown.md §13 (the CommonMark row, class `**Subset**`, binding this section).
- parser.md §10 (its own CommonMark row).
- specs/standards.md (the row grammar and how a bound section's marker sets the row's tier).
