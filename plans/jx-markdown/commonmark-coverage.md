---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#9
requires: []
size: L
workspaces:
  - extensions/parser
  - specs
  - docs
---

# Every construct the Markdown parser produces reaches Jx, and the one thing that cannot is named as dropped

## Context

`specs/jx-markdown.md` §9, line 361:

> **Status: Partial.** The table and build-time highlighting ship (`JX_TAG_MAP` and `mdastNodeToJx` in `extensions/parser/src/transpile.ts`, `extensions/parser/src/highlight.ts`), but a reference-style link or image (`[text][label]`, `![alt][label]` with a `[label]: url` definition) is dropped together with its text, and a GFM footnote with its definition. Two constructs the table does not list are mapped rather than dropped: raw HTML goes through `htmlToJx` and a hard line break becomes `br`. §13's CommonMark note says §10 names the unmapped constructs and that each is dropped; §10 names none of them.

The marker holds at 84735a9f (no file under `extensions/parser` or `packages/markup` changed since the census commit b900b326). Measured by running `transpileJxMarkdown`, `processMarkdown` and `serializeJxMarkdown` on small inputs, and by parsing all 301 `.md` files under `docs/`, `sites/`, `packages/starters/` and `examples/` with the same remark stack. No test suite was run.

**What the marker says, verified**

- `mdastNodeToJx` returns `null` for any type without a `JX_TAG_MAP` entry, so `linkReference`, `imageReference`, `definition`, `footnoteReference` and `footnoteDefinition` vanish. `'a ![pic][i] b [full][r] c [r] d'` with both definitions gives one `p` with children `"a "`, `" b "`, `" c "`, `" d"`, and `'x[^1]'` with a definition gives `p "x"`.
- It ships. `docs/extending/extensions/formats.md` lines 73 and 74 cite `[RFC 7763][7763]` and `[RFC 9512][9512]`, so the published table cell reads "doesn't say _which_ markdown ()". It is the corpus's only reference link; no corpus file uses a footnote.
- One correction to the stub: an undefined label is not a case to handle. micromark builds a reference node only when a definition matches, so `[text][nope]` and `[^zz]` already stay literal text.

**What the census missed**

- **Task lists.** `listItem.checked` is ignored: `- [x] done` gives `li > p "done"`, and the checkbox state is gone.
- **Column alignment.** `table.align` is ignored: `|:--|--:|` gives the same cells as `|---|---|`.
- **Raw HTML split across nodes.** micromark emits every inline tag as its own `html` node, and `htmlToJx("</kbd>")` is `[]`. So `a <kbd>K</kbd> b` gives `"a "`, an empty `kbd`, `"K"`, `" b"`. A block `<details>` line, a Markdown paragraph and a `</details>` line give an empty `details` followed by the `p`. Comments give nothing, which is right, but nothing says so.
- **Tight lists.** Every `li` wraps its text in `p`. CommonMark renders a tight list's items without the paragraph, and 147 of the 301 corpus files contain a tight list (7 contain a loose one). The wrap also breaks round trips: Studio inserts `{ tagName: "li", textContent: "Item" }` (`packages/studio/src/panels/shared.ts` line 91), roundtrip mode writes `- Item`, and that re-parses as `li > p "Item"`. This is a jx-markdown.md §12.8 loss that this plan closes as a side effect. Both serializer modes also write every list tight (`spread: false` in `convertJxNode`'s and `nodeToMdast`'s `list` cases), so `- a\n\n- b` saves as `- a\n- b`. That is harmless only while both forms parse to `li > p`. Roundtrip's `listItem` case also splits an inline run: `li ["a ", sup "2"]` writes `- a` and then a `:::sup` container, because `block()` converts each child as a block.
- **Two root walks.** `transpileJxMarkdown` flattens `htmlToJx`'s arrays. `processMarkdown` (`extensions/parser/src/md.ts`) runs `.map(mdastNodeToJx).filter(Boolean)`, which nests them and keeps the `[]` a comment yields: `<div class="x">hi</div>`, a comment and a paragraph give `[[div], [], p]` to a content entry and `[div, p]` to a page.

**Tests today.** `extensions/parser/tests/transpile.test.ts` pins `html` → `htmlToJx` and `break` → `br` at the node level. It uses `definition` and `footnoteDefinition` as its examples of unknown types ("returns null for unknown node types", two container cases, and the `convertChildren` case "filters nulls and flattens arrays"). No test parses a reference, a footnote, a task item, an aligned table or a list's looseness.

**Related, no edge.** No plan below is a prerequisite of this one, or this one of it, but each overlaps it, and whichever lands second adapts to the first:

- `plan:jx-markdown/roundtrip-lossless` (§12.8) also edits `serialize.ts`. Every shape this plan adds ships with its own serializer inverse, and that plan's string-level corpus can include them. That plan also groups `block()`'s inline runs into one paragraph. Its §12.8 bullet, its `NORMALIZED` row and its docs sentence all say that text in a list item comes back inside a `p`, and it leaves "whether a tight list item should parse without its `p`" to this plan. Its Open decision would make `mdastToJx` a wrapper over the transpiler. If that plan lands first, CC1.1 routes the wrapper through `mdastRootToJx` and CC1.3 reconciles the rest (Implementation, Tests, Specs & docs). Two more things are then true: `hasJxProps` has become that plan's `needsDirective`, which `plainGfm` runs before exactly as it would have run before `hasJxProps`; and its `roundtrip-corpus.test.ts` (every tracked Jx Markdown document and every `markdown` fence in jx-markdown.md as a fixed point) must stay green through each slice, so a slice that changes how a corpus file parses also keeps it writable. That plan owns `mdastToJx`'s fate and this plan owns the list-item `p` question (`plans/jx-markdown/README.md`, spec-wide decisions).
- `plan:jx-markdown/repeater-map-template-roundtrip` (§6.5) adds `isInlineOnly` and `holdsNatively` to `serialize.ts`. `holdsNatively` sends a list or table with any decorated child to directives. CC1.2's decoration stripping must run before it, and CC1.3's phrasing test is the same predicate as `isInlineOnly`.

`plan:_shared/collection-directive-elements` changes how `processMarkdown` builds its processor, and this plan changes what happens after the parse, so the two conflict only textually. `plan:standards/citable-community-specifications` leaves jx-markdown.md untouched under its recommended Open, and in parser.md §10 rewrites only the paragraph above the table, not the notes this plan edits. If that Open instead retires community formats to prose, §13's CommonMark row goes, and CC1.3's class and note move into the sentence that replaces it.

## Outcome

- jx-markdown.md §9 → Implemented (CC1.3). Its table lists every node type the parser produces outside frontmatter and directives, and each maps to a Jx node.
- jx-markdown.md §10 gains one item: raw HTML's comments and declarations are dropped. §13's CommonMark row stays **Subset**, and its note names that as the only absence. If the tight-list decision below goes the other way, the row becomes **Divergent** instead and names the paragraph wrap.
- parser.md §10: the CommonMark and GFM notes stop citing "the constructs §8 maps" and point at jx-markdown.md §9 (an editorial fix).
- Side effects: a content entry and a page parse the same source to the same tree, and Studio's `li` shape round-trips.

## Decisions

- **Open:** remark-gfm already parses three constructs that the mapping drops: footnotes, task-list state and column alignment. Map them, or name them in §10? Recommendation: map all three, in the shapes decided below, and have each serialize back to its GFM syntax. Dropping a footnote deletes the author's prose. A Studio open-and-save currently erases footnotes, checkboxes and alignment from the file, and naming that in §10 would document data loss as a feature. Footnotes are not in CommonMark or the GFM spec, so their shape is Jx's own to choose.
- **Open:** Should a tight list's items drop their paragraph, as CommonMark renders them? Recommendation: yes. It is what every CommonMark renderer and GitHub produce, so a **Subset** claim is only true with it. It is the shape Studio already creates. It closes the `li` round-trip loss above. The cost is visible: lists in 147 corpus files render without `li > p`, and no CSS in `sites/` or `packages/` targets `li > p` or `li p`. Pre-1.0, that is acceptable. If declined, §9 states the wrap, and §13's row becomes **Divergent** with the wrap as its deviation.
- **Decided:** references resolve in one pre-pass over the tree before conversion. `definition` nodes are collected by `identifier` (mdast has already normalized its case and whitespace), and the first definition wins as CommonMark specifies. Each `linkReference` or `imageReference` is rewritten in place to the `link` or `image` it denotes. This is done because `mdastNodeToJx` and `convertChildren` are exported, recursive and context-free, and every caller walks a tree the pre-pass sees first. The pre-pass is about 30 lines, which is not worth adding `mdast-util-definitions` as a dependency.
- **Decided:** one root walk, `mdastRootToJx`, serves `transpileJxMarkdown` and `processMarkdown`, because two walks already differ (Context), and references and footnotes need the whole tree.
- **Decided:** raw HTML nests by re-parsing. When a sibling run contains an `html` node, the run is joined into one HTML string: each `html` value verbatim, every other node as a placeholder element. That string is parsed once with `htmlToJx`, and each placeholder is replaced by its converted nodes. The HTML parser (parse5, through `hast-util-from-html`, which `htmlToJx` already uses) then decides nesting and implicit closing by the HTML standard, instead of a hand-written tag matcher. Prototyped on the cases above: `a <kbd>K</kbd> b`, `<span class="y">**b** c</span>` and the `<details>` block all nest correctly. If a placeholder does not come back (swallowed as raw text inside an inline `<textarea>` or a `<title>`, or into an unfinished tag), the run falls back to converting each node alone, so no Markdown content can be lost. One consequence is deliberate: a start tag that is never closed now wraps the rest of its run instead of standing empty. Examples are a self-closing `<my-icon />`, whose slash the HTML parser ignores on a non-void element, and the unescaped `<picture>` or `<lastmod>` in the generated spec changelog's prose. A browser does the same with CommonMark's HTML output, and the text still renders.
- **Decided:** footnote shape. Ids use `encodeURIComponent(identifier)`, so the serializer can recover the label. A reference becomes `sup > a#fnref-<id>[href="#fn-<id>"][data-footnote-ref][role=doc-noteref]` with the ordinal as text. Ordinals are numbered by first reference, and the k-th repeat reference gets id `fnref-<id>-<k>`. Definitions become one trailing `section.footnotes[data-footnotes][role=doc-endnotes] > ol > li#fn-<id>`. Each `li` gets one `a[href="#<refId>"][data-footnote-backref][role=doc-backlink]` "↩" per reference. As in `mdast-util-to-hast`, the backlinks are separated by `" "` and appended inside the last paragraph after a space, which is added to its trailing string or pushed as `" "`. A note that does not end in a paragraph gets them after its content. Referenced notes come first in ordinal order, then unreferenced ones in source order with no backlink. This mirrors the class and `data-footnote-*` hooks of `mdast-util-to-hast`, which GitHub and every remark-rehype site emit. There are two deliberate departures, made because Jx output carries no English strings and `assignHeadingIds` would put a heading into every page's `$toc`: no `user-content-` prefix (a sanitizer clobber guard for untrusted content) and no English "Footnotes" heading or "Back to reference" label. Unreferenced notes are kept, unlike GitHub, so a save cannot delete them.
- **Decided:** task items and alignment. A task item gets `className: "task-list-item"` and a checkbox, `{ tagName: "input", attributes: { type: "checkbox", disabled: "" } }` plus `checked: ""` when marked, which is the shape `htmlToJx` gives the same HTML. The checkbox becomes the first inline child of the item's first paragraph, or its first child when it has none. After the tight-list unwrap, that places the checkbox first in the `li`. The list gets `className: "contains-task-list"`. Alignment becomes `style.textAlign` on every cell of the column, rather than the `align` attribute `mdast-util-to-hast` writes, because `align` on `th`/`td` is obsolete in HTML and a style is what Studio's style panel edits.
- **Decided:** two normalizations change only the source. A reference resolves at parse time, so a roundtrip save writes `[text](url)` inline and drops the definition, because Jx has no node to hold a definition. A footnote label comes back lowercased, because it is recovered from `identifier`. In both cases the Jx tree round-trips.
- **Decided:** one normalization changes the tree. Looseness belongs to the whole list, so both serializer modes write a list loose when any of its items holds a `p`. The parser only produces `li > p` in a loose list, so a list whose items mix `li "x"` and `li > p` re-parses with `li > p "x"`. §9 states all three.

## Implementation

**CC1.1: one root walk, references, raw HTML** (`extensions/parser/src/transpile.ts`, `md.ts`, `types.ts`)

- `types.ts` `MdastNode`: add `identifier?: string`, `label?: string | null`, `referenceType?: string` and `checked?: boolean | null`.
- `transpile.ts`:
  - `resolveReferences(tree)`: the pre-pass (Decisions). It returns nothing yet; CC1.2 widens it.
  - `mdastNodeToJx`: a `linkReference` or `imageReference` that reaches it unresolved (a hand-built tree, or a single-node call) returns its converted children or its `alt` string, never `null`. `definition` and `footnoteDefinition` stay `null`.
  - `convertChildren(children)`: when a child is `html`, it takes the placeholder path (Decisions). The placeholder is `<jx-md-slot data-i="n"></jx-md-slot>`, a valid custom-element name, so parse5 treats it as an ordinary element. After replacement, an element whose only child is a string collapses it to `textContent`, as `mdastNodeToJx` does. Without an `html` child, behaviour is unchanged.
  - `directiveToJx`: its two child loops become one `convertChildren` call. For a `PHRASING_ELEMENTS` parent, each `paragraph` child is first spliced into its inline children, so a start tag and its end tag in one directive pair up.
  - `export function mdastRootToJx(tree: MdastNode): (JxElement | string)[]`: drop `yaml`/`toml`, run `resolveReferences(tree)`, then `convertChildren(body)`. It rewrites the tree it is given, and both callers parse a fresh one. `transpileJxMarkdown` replaces its body loop with it.
- `md.ts` `processMarkdown`: `const $children = mdastRootToJx(tree)` replaces the `.map(...).filter(Boolean)` line. `extractExcerpt` and `mdastToString` read the tree and are unaffected, because a rewritten reference keeps its children.
- `serialize.ts` `mdastToJx`: untouched while it keeps its private converter. If `plan:jx-markdown/roundtrip-lossless` has made it a wrapper over the transpiler, its root branch calls `mdastRootToJx`, not `convertChildren`.

**CC1.2: footnotes, task lists, alignment** (`transpile.ts`, `serialize.ts`)

- `transpile.ts`:
  - `resolveReferences` also collects `footnoteDefinition`s (first wins). It walks `footnoteReference`s in document order and sets `data.jxFootnote = { ordinal, refId }` on each, then returns the ordered notes, each with its reference ids.
  - `mdastNodeToJx` `footnoteReference`: when annotated, the `sup > a` above; when unannotated, the literal `[^label]` string.
  - `mdastRootToJx` appends the footnote `section` when any definition exists. Each definition's children go through `convertChildren`, and the backlinks are appended as decided.
  - `listItem` with a boolean `checked`: the class and checkbox as decided. The `list` case adds `contains-task-list` when any item is a task item.
  - `table`: `node.align[i]` sets `style.textAlign` on column `i`'s cells, before the header row is retagged to `th`.
- `serialize.ts`: five helpers shared by both modes.
  - `footnoteRefId(el)` returns the decoded identifier when `el` is a `sup` whose only child is an `a[data-footnote-ref]` with an `#fn-` href.
  - `footnoteDefinitions(section, convert)` builds a `footnoteDefinition` (`identifier` and `label` both the decoded id) from each `li#fn-…`. It drops every `a[data-footnote-backref]` and the `" "` strings between them, and trims the one trailing space the transpiler added before the first backlink.
  - `taskState(li)` returns `true`, `false` or `null` from a leading checkbox `input`, whether it is the `li`'s first child or its first paragraph's.
  - `cellAlign(cell)` returns `left`, `center` or `right` from `style.textAlign`.
  - `plainGfm(el)` runs on a `ul`, `ol` or `table` before anything else looks at it. It returns shallow copies with the decoration removed, so the caller's document is never mutated. For a list, it removes a `className` that is exactly `contains-task-list`. From each `li` whose `className` is exactly `task-list-item` and that has a leading checkbox, it removes the class and the `input` and records the `taskState`. For a table, a column's alignment is its header cell's `cellAlign`, and `textAlign` is removed from every cell of the column whose value equals it, along with `style` when that empties. Any other class or style stays and is written as today. Only after this does the copy meet the allowlist, `hasJxProps` and, once `plan:jx-markdown/repeater-map-template-roundtrip` has added it, `holdsNatively`. So it stays a `list`, `listItem` or `tableCell` rather than becoming a directive.
  - Roundtrip: `jxToMdast` maps a root `section[data-footnotes]` to its definitions. At its top, `convertJxNode` tries `footnoteRefId` (a hit becomes a `footnoteReference`), then applies `plainGfm`. The `list` case sets each `listItem.checked`, and the `table` case sets `align`.
  - Export: `nodeToMdast` does the same, before the custom-element and `WRAPPER_TAGS` branches (the latter would otherwise flatten the `section`) and before `sup` falls into the children fallback.
  - `remark-gfm` is already in both stringify chains and writes `[^id]`, `[^id]: …`, `- [x]` and `| :- | -: |` (verified).

**CC1.3: tight lists** (`transpile.ts`, `serialize.ts`)

- `transpile.ts` gets `listItemLoose(item)`, which is `item.spread ?? item.children.length > 1`, and `listLoose(list)`, which is `list.spread === true || items.some(listItemLoose)`. That is `mdast-util-to-hast`'s rule. `mdastNodeToJx` is context-free, so looseness is passed down. The `list` case converts its items through `listItemToJx(item, listLoose(node))`, and the `listItem` case calls `listItemToJx(node, listItemLoose(node))`. In a tight item, each `paragraph` child is spliced into its inline children at the mdast level before `convertChildren` runs, as `directiveToJx` does for a phrasing parent. Raw-HTML pairs in the item's text therefore still meet, and a lone string becomes `textContent`.
- `serialize.ts`:
  - `listIsLoose(list)`: some `li` child has a `p` element among its array children. Roundtrip's `convertJxNode` and export's `nodeToMdast` set `spread` from it on the `list` and on each `listItem`, replacing today's hard-coded `false`. A loose list then writes blank lines between its items, and re-parses loose.
  - Roundtrip `listItem`: `block(el)` gains an inline-run pass, used by the `listItem` case only. A block quote's paragraph is never unwrapped, so `blockquote` keeps today's `block()`. A child is phrasing when it is a string, a number, or an element whose tag is not an allowlisted `MD_BLOCK` tag and whose array children, if any, are all phrasing. That is the predicate `plan:jx-markdown/repeater-map-template-roundtrip` adds as `isInlineOnly`, and whichever plan lands second reuses the other's. Each maximal run of phrasing children becomes one `paragraph`, converted with `isBlock` false as `inline()` converts a `p`'s children, so a non-native tag is written as a text directive. Every other child converts as today. `li "Item"` still writes `- Item`, `li ["a ", strong]` writes `- a **b**`, and `li ["a ", sup "2"]` writes `- a :sup[2]`. `plan:jx-markdown/roundtrip-lossless` groups the same runs in `block()`, so the second of the two to land keeps one grouping pass.
  - Export `listItem`: each maximal run of inline mdast children (`text` or `isInlineType`) becomes one `paragraph`. Today it groups only an item whose children are all inline.

**Integration contract.** After CC1.3:

- `mdastRootToJx` (from `@jxsuite/parser/transpile`) is the only body conversion, so `Markdown.parse`, `Markdown.load`, `MarkdownCollection` and `Markdown#resolve` give the same tree for the same source. Content-relative remapping (parser.md §9.2) sees reference-style images as ordinary `img`s.
- `mdastNodeToJx` returns `null` only for frontmatter, a definition, a footnote definition (rendered by `mdastRootToJx` in the trailing section), a text or `html` node without a value, and a type the parser never produces.
- The Jx shapes are those of §9's table. The footnote, task-list and alignment shapes are recognized by `data-footnote-*`, a leading checkbox `input` and `style.textAlign`.
- Both serializer modes write those shapes back as GFM syntax. A list is written loose exactly when one of its items holds a `p`.
- Serializing and re-parsing any §9 construct gives an equal tree, except for a list whose items mix both shapes, which re-parses loose (Decisions). A §12.8 corpus may assert exactly that.

## Tests

Run `bun test --isolate --coverage` from `extensions/parser`, then `bun scripts/check-coverage-manifest.ts extensions/parser`. Per-file thresholds (`extensions/parser/bunfig.toml`) are lines 0.987 and functions 0.975. `transpile.ts` and `serialize.ts` must stay above them, so every defensive branch below has a node-level case. Ratchet when a slice raises the workspace's worst file. No source file is added. CI's derived matrix also runs the suites that load the parser (compiler, server, studio, desktop, create and others). CC1.3 can break an assertion there only if it expects `li > p` from Markdown. A grep for `<li>` assertions in those suites finds only JSON-authored lists (`packages/compiler/tests/compiler.test.ts` line 297, `site-build-state-retention.test.ts` line 121), which the change does not reach, so CI is the remaining check.

A new `extensions/parser/tests/standard-markdown.test.ts` holds the pipeline cases (through `transpileJxMarkdown` unless stated) and two helpers. `roundTrip(md)` asserts that `transpileJxMarkdown(serializeJxMarkdown(transpileJxMarkdown(md)))` deep-equals `transpileJxMarkdown(md)`. `roundTripDoc(doc)` asserts that `transpileJxMarkdown(serializeJxMarkdown(doc)).children` deep-equals `doc.children`. They are the string-level evidence the audit record requires.

- **CC1.1**
  - "full, collapsed and shortcut reference links resolve to a with href and title"
  - "a reference image resolves to img with src, alt and title"
  - "labels match regardless of case and spacing, and the first definition wins"
  - "an undefined label stays literal text" (pins micromark's rule)
  - "a definition inside a container directive or blockquote serves references anywhere"
  - "inline raw HTML nests the Markdown between its tags" (`<kbd>`, and a `span` holding `**b**`)
  - "a block start tag and its end tag wrap the paragraphs between them" (`<details>`)
  - "a stray end tag and an HTML comment produce nothing"
  - "a placeholder swallowed as raw text falls back to per-node conversion" (`a <textarea>b</textarea> c`, and a `<title>` block split by blank lines). A block `<textarea>` will not do: CommonMark ends that HTML block only at its closing tag, so blank lines stay inside one `html` node.
  - "an unclosed start tag wraps the rest of its run" (`a <my-icon /> b`)
  - "the formats page keeps its RFC link text" (a two-row fixture copied from `formats.md`, through `processMarkdown`)
  - `roundTrip` over references, `kbd` and `details`
  - `md-units.test.ts`: "processMarkdown flattens raw HTML like transpileJxMarkdown", which asserts the two entry points give equal children for the `div`, comment and paragraph input.
  - `transpile.test.ts`: "returns null for unknown node types" switches to a made-up type. It gains "unresolved reference nodes keep their text" and "definition nodes render nothing". The three cases that use `{ type: "definition" }` as a null child keep passing unchanged, including "filters nulls and flattens arrays", which now takes the placeholder path.
- **CC1.2**
  - "task items get a disabled checkbox, checked when marked, and the list gets contains-task-list"
  - "column alignment sets text-align on every cell of the column"
  - "footnote references are numbered in first-reference order"
  - "a repeated reference gets its own id and its own backlink"
  - "definitions become a trailing section; unreferenced ones come last with no backlink"
  - "an undefined footnote label stays literal text"
  - For each mode: "roundtrip writes footnotes, task items and the alignment row as GFM" and "export writes footnotes, task items and the alignment row as GFM" (`toContain("[^note]")`, `"[^note]: two"`, `"- [x] done"`, `"| :- |"`). Add `roundTrip` over all three, including a note referenced twice.
  - "serializing leaves the document's decoration in place" (the input is deep-equal before and after), and "a cell whose text-align differs from its column's keeps its style"
  - `transpile.test.ts`: "an unannotated footnote reference renders its label as text".
- **CC1.3**
  - "a tight list's items hold their text directly"
  - "a loose list keeps its paragraphs"
  - "a tight item with a nested list keeps its text before the list"
  - "a task item in a tight list starts with its checkbox"
  - "both modes write a loose list with blank lines between its items" (fails today: `- a\n\n- b` saves as `- a\n- b`)
  - "a list mixing text items and paragraph items re-parses loose"
  - `roundTrip` over tight, loose and nested lists. `roundTripDoc` over Studio's `{ tagName: "li", textContent: "Item" }`, `li ["a ", strong]` and `li ["a ", sup "2"]`. The last two fail today.
  - If `plan:jx-markdown/roundtrip-lossless` landed first, its `NORMALIZED` row "`li` text gains a `p`" becomes a case where the text stays in a tight list's `li`.
  - `transpile.test.ts` "unordered list with items" now expects `{ tagName: "li", textContent: "one" }`, because its hand-built list has no `spread` and one child, so it is tight. A new "a hand-built item with two children is loose" case covers the other arm of `listItemLoose`.

## Specs & docs

Each slice updates §9 to what it ships and releases a fragment. Only CC1.3 removes the marker.

**CC1.1.** In §9's table:

- The link row becomes "`[link](url)`, `<https://…>`, `[text][label]`" → `a`.
- The image row becomes "`![alt](url)`, `![alt][label]`" → `img`.
- Three rows are added:
  - "`[label]: url` definition" → "nothing; its references resolve to it"
  - "Hard line break" → `br`
  - "Raw HTML" → "the elements the HTML parser builds (`htmlToJx`), with the Markdown between a start tag and its end tag nested inside; a start tag with no end tag wraps what follows it in its paragraph or container, as in a browser"

Below the table, add: "A reference resolves when the document is parsed, so a roundtrip save (§12.8) writes the link inline and the definition is not kept." The marker becomes:

> **Status: Partial.** The table and build-time highlighting ship (`JX_TAG_MAP`, `mdastNodeToJx` and `mdastRootToJx` in `extensions/parser/src/transpile.ts`, `extensions/parser/src/highlight.ts`), but a GFM footnote is dropped with its definition, a task item's checkbox and a table's column alignment are dropped, and a tight list's items keep the paragraph CommonMark renders them without. §13's CommonMark note says §10 names the unmapped constructs; §10 names none.

Fragment: `bun run spec:change jx-markdown.md minor -m "§9: reference-style links and images resolve against their definitions, and the Markdown between a raw-HTML start tag and its end tag nests inside that element."`

**CC1.2.**

- Rows are added:
  - "`- [x] task`" → "`li.task-list-item` starting with a disabled checkbox `input`, in a `contains-task-list` list"
  - "`[^id]` footnote" → "`sup` > `a` numbered by first reference; the definitions form one trailing `section.footnotes` > `ol` > `li`, each with a backlink per reference"
- The Table row gains "; column alignment → `style.textAlign`".
- Add a sentence saying that a footnote label is recovered lowercased on save.
- The marker drops its footnote, checkbox and alignment clause.

Fragment: `bun run spec:change jx-markdown.md minor -m "§9: GFM footnotes, task-list checkboxes and table column alignment map to Jx elements, and both serializer modes write them back as GFM."`

**CC1.3.**

- §9:
  - The list row becomes "`ul` / `ol` + `li`; in a tight list an item's paragraph is unwrapped into the `li`".
  - Add after the table: "Looseness belongs to the whole list. A list is written loose when any of its items holds a `p`, so a list whose items mix both shapes re-parses with every item's text in a `p`. Apart from frontmatter (§3) and directives (§4), every node the parser produces is in this table; §10 names what has no Jx node."
  - Remove the marker. §9 is then Implemented.
- §12.8, only if `plan:jx-markdown/roundtrip-lossless` landed first: its normalization bullet "text written directly in the document root, a list item or a block quote … comes back inside a `p`" narrows "a list item" to "a list item of a loose list (§9)".
- §10 gains item 5: "**HTML comments and declarations are dropped**: a comment, `<!DOCTYPE>`, CDATA section or processing instruction in raw HTML has no Jx node, so it does not survive a parse or a save."
- §13, the CommonMark row:
  - Evidence: `extensions/parser/src/transpile.ts, extensions/parser/tests/standard-markdown.test.ts`
  - Note: "Every construct CommonMark defines maps to a Jx node (§9), a tight list's items unwrapped as CommonMark renders them. What is absent is raw HTML's non-element content (comments, declarations, CDATA sections, processing instructions), which has no Jx node and is dropped (§10)."
  - If the tight-list decision is declined, the class becomes **Divergent** and the note names the paragraph wrap.
- parser.md §10:
  - The CommonMark note becomes "Parsing is CommonMark via `remark`, and jx-markdown.md §9 maps every construct to a Jx node; raw HTML's comments and declarations are the only content dropped (jx-markdown.md §10)."
  - The GFM note becomes "Tables (with column alignment), strikethrough, task lists and autolinks are parsed and mapped (jx-markdown.md §9)."
- Fragments:
  - `bun run spec:change jx-markdown.md minor -m "§9: a tight list's items hold their text directly and a loose list is written loose, the table covers every construct the parser produces, and §10 names the raw-HTML content with no Jx node."`
  - When the §12.8 edit above applies, the jx-markdown sentence gains "; §12.8 returns a list item's text inside a p only for a loose list", so `docs:spec-release` sees that body change released too.
  - `bun run spec:change parser.md patch -m "§10: the CommonMark and GFM notes cite the mapping in jx-markdown.md and say that task lists and column alignment reach Jx."`

**Docs.** `docs/framework/site/jx-markdown.md` (its `code:` lists `transpile.ts` and `serialize.ts`): the "Standard Markdown" paragraph gains one sentence per slice. The final text runs after "tables to `table` structures":

> Reference-style links and images (`[text][label]` with a `[label]: url` line) resolve to the same `a` and `img`. Task lists get a disabled checkbox, table column alignment becomes `text-align` on the cells, and footnotes become numbered links to a list of notes at the end of the page. Raw HTML becomes the elements it describes, with any Markdown between a start tag and its end tag nested inside; HTML comments are dropped. In a tight list (no blank lines between items) an item's text sits directly in the `li`, as it does on GitHub.

The docs:prose rules apply, so the text has no em dash. If `plan:jx-markdown/roundtrip-lossless` landed first, CC1.3 also changes that plan's "Markdown or JSON?" sentence, "text typed straight into a list item returns inside a paragraph", to "text typed straight into a list item returns inside a paragraph when the list has blank lines between its items".

`docs/framework/site/content-collections.md` (its `code:` lists `md.ts`) needs no change: its image-remapping claims still hold, and reference-style images now take part in the remapping. `docs/extending/reference/standards.md` is generated. No other page cites §9, §10 or §13.

**Graduation.** This plan does not graduate jx-markdown.md while its other five plans are open. If CC1.3 closes the spec's last open item (`bun run plans:status --spec jx-markdown`), that pull request sets `**Status:** Implemented`, runs `bun run spec:bump jx-markdown.md minor -m "…"` in place with the CC1.3 fragment's sentence instead of that fragment (minor, because graduation rides on an execution), and deletes `plans/jx-markdown/`. The parser.md fragment stays a fragment.

## Acceptance

- In `extensions/parser`, `bun test --isolate --coverage` is green, and so is `bun scripts/check-coverage-manifest.ts extensions/parser`.
- `bun -e 'import {processMarkdown} from "./extensions/parser/src/md.ts"; import {readFileSync} from "node:fs"; const p="docs/extending/extensions/formats.md"; console.log(JSON.stringify(processMarkdown(readFileSync(p,"utf8"),p,{directives:true}).$children).includes("\"textContent\":\"RFC 7763\""))'` prints `true` after CC1.1.
- `transpileJxMarkdown("x[^a]\n\n- [x] done\n\n| a |\n|:-|\n| 1 |\n\n[^a]: note\n")` shows the `sup`, the checkbox, `textAlign: "left"` and the trailing `section`, and `serializeJxMarkdown` of it contains `[^a]`, `- [x] done` and `| :- |` (after CC1.2).
- After CC1.3, `jx build` in `sites/jxsuite.com` renders `/docs/start/` lists as `<li>text</li>`. The nightly screenshots run recaptures any docs image that shows a rendered list; review the pages its comment names.
- After CC1.3, `bun run plans:check` passes with §9 closed, and this file is deleted. `bun run docs:status`, `docs:standards`, `docs:check`, `docs:links`, `docs:prose` and `docs:spec-release` are green.

## Slices

| Slice | Scope                                                                                                                                  | Claims           | State |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----- |
| CC1.1 | `mdastRootToJx` for both entry points, reference resolution, raw-HTML nesting; §9 rows for references, definitions, `br`, raw HTML     | —                | open  |
| CC1.2 | Footnotes, task-list state and column alignment, with their inverses in both serializer modes                                          | —                | open  |
| CC1.3 | Tight-list unwrap, loose lists written loose, the serializer's inline grouping; §9, §10, §13 and parser.md §10 rewrite; marker removed | jx-markdown.md#9 | open  |
