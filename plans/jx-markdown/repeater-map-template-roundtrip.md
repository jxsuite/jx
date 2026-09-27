---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#6.5
requires: []
workspaces:
  - extensions/parser
  - specs
  - docs
size: M
---

# A `:::Array` repeater round-trips whatever element its map template is, wherever it sits

## Context

`specs/jx-markdown.md` §6.5, line 211:

> **Status: Partial.** The directive ships: `prototypeDirectiveToJx` (`extensions/parser/src/transpile.ts`) restores `$prototype`, expands the attributes and takes the first element child as `map`, `prototypeToDirective` (`extensions/parser/src/serialize.ts`) writes it back, and the older dot-path form still parses. The worked example does not produce the JSON shown: the `:li{…}` line parses as a `p` wrapping the `li`, and `children.0` expands to an object keyed `"0"`. The round trip is not lossless for a template markdown can only write inside a parent: an `li` map serializes as a bare `- …` list item and re-parses as `ul > li > p`. A repeater among a list's items, the shape Studio's Convert to Repeater leaves when it converts a list item, fares worse: it is written between the `- …` items and re-parses outside the list, as its sibling.

Disposition `implement`: "the canonical, round-trippable encoding" is the right contract, jx-markdown.md §12.8 promises roundtrip mode is lossless for everything it can express, and every shape below is expressible as directives. The worked example is wrong too and is corrected in the same change. Every clause of the marker was re-measured at HEAD (the parser is unchanged since b900b326) by feeding `serializeJxMarkdown` output back through `transpileJxMarkdown`.

**What exists**

- `prototypeDirectiveToJx` (`transpile.ts`): `$prototype` from the directive name, attributes through `expandDotPaths`, `map` = the first object in `convertChildren(node.children)`; anything after it is dropped.
- `directiveToJx` (`transpile.ts`): a `leafDirective` returns before its children are read, so a label (`::li[text]`) is dropped silently. A container's paragraph children are unwrapped only for tags in `PHRASING_ELEMENTS`, which holds neither `li` nor `td`/`th`, so `:::li` with a text body is `li > p`.
- `prototypeToDirective` (`serialize.ts`): collapses every key but `$prototype`, `map` and `tagName` to attributes and emits `map` through `convertJxNode`, which writes a markdown-native tag (`li`, `tr`, `td`, …) as markdown. `convertJxNode` writes `ul`/`ol` as a markdown list and `table` as GFM whatever their children, and routes a child with Jx props to `convertToDirective`, which drops it between the items. A list or table that itself carries Jx props goes to `convertToDirective` too, whose body writes each item through `convertJxNode` again: a native `- …` item inside `:::ul` re-parses as a nested list, and `thead`/`tbody` have no `convertJxNode` case, so a table's rows are dropped.
- `textOf` (`serialize.ts`) and every native writer read only a string `textContent`, and `collectDirectiveAttrs` skips `textContent`, so a bound one is written as `String(value)`.
- `packages/studio/src/editor/convert-to-repeater.ts` replaces the selected element in place, so converting a list item yields `ul > [li…, { $prototype: "Array", map: li }]`. `MD_ELEMENTS.nesting` (`serialize.ts`, mirrored in `Markdown.class.json`) lets a `ul`/`ol` hold only `li` and a table only its parts. Studio's default `li`, `th` and `td` carry `textContent` (`packages/studio/src/panels/shared.ts`).
- Tests: `serialize-export.test.ts` "jxToMdast → mdastToJx preserves an Array member among siblings" passes on the in-list shape because it never stringifies, and `mdastToJx` is on no production path (the audit record's spec-wide decision). `transpile.test.ts` ":::Array with filter and sort attributes" parses a `:li{}` template and asserts nothing about `map`.

**Measured** (`serializeJxMarkdown` then `transpileJxMarkdown`):

| Input                                                                         | Written                                                 | Comes back                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| §6.5's markdown example                                                       | (parsed)                                                | `map: p > li { children: { "0": … } }`                          |
| §6.5's JSON (`map: li` with one text child)                                   | `- ${$map/item/title}` in `:::Array`                    | `map: ul > li > p`                                              |
| `ul > [li "header", Array{ map: li "row" }]`                                  | `- header`, then `:::Array` / `- row` / `:::`           | root `ul > li > p`, then the repeater with `map: ul`            |
| `table > [thead, tbody > [Array{ map: tr > td }]]`                            | a two-row GFM table                                     | the repeater is gone; its template is an ordinary body row      |
| `Array{ map: tr }` or `Array{ map: td }` at root                              | `\| a \|` or `a` in `:::Array`                          | `map: p`                                                        |
| spec.md §10.1's example (`map: li`, `textContent: { $ref: "$map/item" }`)     | `- \[object Object]`                                    | the binding is destroyed                                        |
| `ul > [li { className }, li]`                                                 | `:::li{className="x"}` then `- b`                       | the classed item outside the list, the rest a separate list     |
| `li { className } "a"` at root                                                | `:::li{className="x"}` / `a` / `:::`                    | `li > p "a"`                                                    |
| `ul { className } > li > p`; `table { style } > thead > tr > th`              | `:::ul{…}` / `- a` / `:::`; `:::table{…}` / `:::`       | `ul > ul > li > p`; a table with no rows                        |
| `p > ["see ", a { href, textContent: { $ref } }]`                             | `see [\[object Object\]](/x)`                           | the binding is destroyed                                        |
| `ul` whose `children` is the Array object (spec.md §10.1's legacy form)       | throws `TypeError: (el.children ?? []).map …`           | (nothing is saved)                                              |
| `Array{ map: p }`, `Array{ map: div > h3 }`, `Array{ map: todo-item }`, `key` | `:::Array` with the template as markdown or a directive | as given (the starters' custom-element templates are this case) |

Two library facts the fix rests on, both measured: remark-directive parses `::li[label]` as a `leafDirective` whose children are the label's phrasing, keeping edge whitespace; and mdast-util-directive 3.1.0 enters no `phrasing` construct when it writes a leaf or container label, so `*b*`, `_g_`, a backtick span, `<b>`, `~~h~~` and `:d[e]` inside a label are written unescaped and re-parse as markup.

## Outcome

- jx-markdown.md §6.5 → Implemented: the worked example parses to the JSON shown; a repeater round-trips through `serializeJxMarkdown` → `transpileJxMarkdown` whatever element its template is (`li`, any table part, a markdown-native block, a custom element), with a bound `textContent`, and wherever it sits (at root, among a list's items, among a table body's rows or a row's cells, inside another template); the legacy `children`-object list serializes instead of throwing. The same writer fixes the shapes beside it in the Measured table: a classed item, a styled list or table, a part at the root, a bound `textContent` on any element the writer visits.
- jx-markdown.md §4.2 states that a leaf directive's label is its inline content.
- jx-markdown.md §12.8's marker trades its §6.5 sentence for the two label limits and the `pre` case this plan leaves (Decisions) and stays Partial (owned by `plan:jx-markdown/roundtrip-lossless`).

## Decisions

- **Open:** how an `li` or table part written as a directive carries inline content. Recommendation: a leaf directive's label, `::li[Buy *fresh* milk]`, which the transpiler starts reading as inline content (one text run → `textContent`, anything else → `children`), with §4.2 amended to say so. Because it is the only form that keeps `li "x"` and `li > p "x"` (the shape every markdown list item parses to) distinct while also holding inline elements: a `textContent="…"` attribute cannot hold an `a` or an `em`, and unwrapping a lone paragraph in `:::li` would collapse `li > p` into `li`. It reads like the text directive's `:a[here]` that §4.3 already uses, and no tracked `.md` file writes a leaf label today, so reading them changes no existing document. This is also the encoding jx-markdown.md §12.8's first loss (inline content of `div`, `section` and custom-element directives) needs; `plan:jx-markdown/roundtrip-lossless` should extend it to those tags rather than choose a second encoding, so the two plans' reviewers should sign this together.
- **Decided:** a `ul`, `ol`, `table`, `thead`, `tbody` or `tr` that holds anything its markdown form cannot (a repeater, any non-element other than a whitespace-only string, a part with Jx props or a bound `textContent`, a `children` object) is written whole as a container directive, with every item or part inside it a directive too, because markdown has no way to place a directive between list items or table rows, and a native `- …` item inside a `:::ul` re-parses as a nested `ul`. The same holds for a list or table that is a directive because it carries Jx props itself. An author whose list gains a repeater sees `:::ul` / `::li[…]` in the file after a save; that is the only lossless form. A list or table without such a child keeps its markdown form. A whitespace-only string does not count because both native writers already drop it (`htmlToJx` never produces one), so `serialize-coverage.test.ts`'s "table with thead/tbody, rows and header cells" keeps its GFM table.
- **Decided:** which parts count is read from `MD_ELEMENTS.nesting`'s `only` rules for those six tags, not from a second list, because Studio's nesting rules and the serializer then name the same parts by construction. GFM's structural limits (a header section with more than one row, a `th` in the body) are not part of the predicate: they lose data with or without a repeater, so they are §12.8's, and the predicate is the one place its owner extends.
- **Decided:** `children.0` stays an object key and the example stops using it, because §6.4 defines dot paths as nested objects, `collapseDotPaths` never writes an index path, and making numeric segments array indices would change the meaning of every existing directive attribute that has one.
- **Decided:** no paragraph unwrap for a text directive inside `:::Array`, because `p > :span[…]` and `p > a` are legitimate templates the unwrap would make unwritable; the leaf form is block-level by construction.
- **Decided:** a bound (object) `textContent` forces the directive form on any element and is written as a dot-path attribute (`::li{textContent.ref="$map/item"}`), because today it is stringified to `[object Object]`, destroying spec.md §10.1's canonical template on every save, and `directiveToJx` already keeps `textContent` at element level for both element kinds, so the parser needs nothing.
- **Decided:** label text is escaped by passing remark-stringify label-scoped copies of the phrasing escapes (`unsafe`), because the defect is upstream's missing `phrasing` construct, and patching the one option keeps every other writer untouched.
- **Decided:** out of scope, each left to `plan:jx-markdown/roundtrip-lossless`: a native list's `li "x"` coming back as `li > p "x"` (a list without a repeater keeps today's markdown form); an array-valued attribute such as a literal `items: [1, 2]`, written `items="1,2"` by `collapsePropsToAttrMap` (Studio's Convert to Repeater writes only `$ref` items); `mdastToJx`, whose round-trip test above keeps passing because the map `li`, now a leaf directive, is still named `li`; two label limits, measured on the prototype, which that plan's `labelSafe` already closes (a `br` in a label is written as a space, and a code span holding `]` ends the label early, so the whole line re-parses as a `p` of literal text); and a bound `textContent` on a `pre`'s `code` child, which the `pre` writer reads directly and writes as an empty fence. The label limits and the `pre` case go into §12.8's marker (Specs & docs), so §6.5 graduating hides none of them.
- **Decided:** a file written after this lands is read correctly only by a parser that has it: an older `@jxsuite/parser` (a starter pinning a published version) drops a leaf label's content. No shape that round-tripped before changes form: every shape that now gains a label or a directive list was already lost by the old writer (the Measured table), so there is nothing to gate.

## Implementation

1. `extensions/parser/src/transpile.ts`, `directiveToJx`: the `textDirective` branch becomes `node.type === "textDirective" || node.type === "leafDirective"`, so a label's children go through `convertChildren` (one string → `textContent`, else `children`), and a label-less leaf returns from the same branch. Delete the `leafDirective` early return below it: it becomes unreachable, and its lines would count against `transpile.ts`'s per-file line threshold. Update the function's doc comment. `processMarkdown` (`md.ts`) reaches this through `mdastNodeToJx`, so content documents read labels too.
2. `extensions/parser/src/serialize.ts`, roundtrip half only (export mode's `nodeToMdast` is untouched):
   - New `boundText(el)`: `el.textContent` is a non-null object. `hasJxProps` returns `true` first when it holds, and `collectDirectiveAttrs` keeps exactly that `textContent` in `propsObj` (it collapses to `textContent.ref`); any other `textContent` stays out, as today, so a `null` is never written as `"null"`. Update `textOf`'s comment, which says bound text has no serializable form.
   - New constants beside `PROTOTYPE_DIRECTIVE_NAMES`: `NATIVE_PARTS: Record<string, ReadonlySet<string>>` built from `MD_ELEMENTS.nesting[tag].only` for `ul`, `ol`, `table`, `thead`, `tbody`, `tr`; `PART_TAGS`, the union of those sets (`li`, `thead`, `tbody`, `tr`, `th`, `td`); `LABEL_UNSAFE`, `unsafe` patterns with `inConstruct: ["leafDirectiveLabel", "containerDirectiveLabel"]` for `*`, `_`, `` ` ``, `<`, `~`, `[`, `!` (after `\[`), `&` (after `[#A-Za-z]`) and `:` (after `[A-Za-z]`), with a comment naming the upstream gap.
   - New `holdsNatively(el, allowlist)`: `true` for a tag outside `NATIVE_PARTS` or with no `children`; `false` when `children` is not an array; otherwise every child is either a whitespace-only string (skipped, as the native `table` writer's `continue` and the list writer already drop it) or an object whose `tagName` the tag's set names, is in the allowlist, has no Jx props, and itself `holdsNatively`.
   - New `isInlineOnly(children, allowlist)`: every child is phrasing (a string, a number, a tag in `MD_INLINE`, or a tag that is not an allowlisted `MD_BLOCK` tag and whose own array children are phrasing), and at least one is a string, a number or an `MD_INLINE` tag, so an item holding only components stays a container.
   - New `partToDirective(el, allowlist)`: attributes from `collectDirectiveAttrs`; a static `textContent` → `leafDirective` whose children are one text node; `isInlineOnly` children → `leafDirective` with those children through `convertJxNode(c, false, …)`; no content → a bare `leafDirective`; otherwise a `containerDirective` whose children go through `blockChild`.
   - New `blockChild(child, allowlist)`: a `PART_TAGS` element → `partToDirective`; anything else → `convertJxNode(child, true, allowlist)`. It is how every directive writes its block children, because a part can never be native inside a directive.
   - `convertJxNode`: the directive test becomes `!allowlist.has(tag) || hasJxProps(el) || !holdsNatively(el, allowlist)`.
   - `convertToDirective`: first, `isBlock && PART_TAGS.has(tag)` returns `partToDirective` (a part reaches here outside a directive list only when it carries Jx props or a bound `textContent` at the root, in a `blockquote` or in a native `li`). Compute `staticText` (string or number `textContent`) and use it in place of `textContent != null` in the inline branch, the leaf test and the paragraph body, so a bound value lives only in the attributes. The block-children map uses `blockChild`, which is also what fixes a list or table carrying Jx props itself. A `children` object already goes to the attributes (`collectDirectiveAttrs`) and yields a leaf in jx-markdown.md §8's attribute encoding.
   - `prototypeToDirective`: a block template goes through `blockChild`; an inline one keeps `convertJxNode(map, false, …)`. Update its doc comment.
   - `serializeRoundtrip`: pass `unsafe: LABEL_UNSAFE` in the remark-stringify options.
3. `extensions/parser/src/serialize.ts` module header and the `jxToMdast` doc comment: say that lists and tables holding what markdown cannot are written as directives. Code comments cite jx-markdown.md §6.5 and §4.2, never this plan.

A prototype of steps 1 and 2 (about 140 lines in `serialize.ts`, one in `transpile.ts`) round-tripped every JSON shape in the Measured table and under Tests with `toEqual`, left a list or table without a repeater in its markdown form, and with the whitespace skip kept the existing `serialize-coverage.test.ts` table case a GFM table.

**Integration contract.** Once this lands: a leaf directive's label is its inline content in both parse paths; `serialize.ts` has `partToDirective` (any element as a labelled leaf when its content is phrasing, a bare leaf when empty, a container otherwise), `isInlineOnly` (the phrasing test it uses), `holdsNatively` (the one predicate deciding whether a list or table is written as markdown; whitespace-only strings do not count), `blockChild`, `boundText`, and `LABEL_UNSAFE` applied to every roundtrip stringify; a bound `textContent` on any element `convertJxNode` visits is written as `textContent.ref` (a `pre`'s `code` child is read by the `pre` writer and is not). Labels are written without `labelSafe`: a `br` or a `]` in a code span is still lost. `plan:jx-markdown/roundtrip-lossless` can close §12.8's inline-content loss by sending every non-phrasing directive's inline content through `partToDirective` and GFM's structural limits through `holdsNatively`, without choosing an encoding again. Unchanged: `mdastToJx`, a native list item's `li > p` normalization, array-valued attributes, and a bound `code` inside `pre`.

## Tests

From `extensions/parser`: `bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts extensions/parser` from the root. No source file is added. `extensions/parser/bunfig.toml` holds `lines = 0.987, functions = 0.975` per file; every new function and branch in `serialize.ts` is reached by the cases below (the whitespace skip by the existing `serialize-coverage.test.ts` table case), and the deleted early return leaves no dead line in `transpile.ts`. Ratchet `coverageThreshold` to just below the workspace's new worst file if it rises, which can happen only if one of these two files was that minimum.

New `extensions/parser/tests/repeater-roundtrip.test.ts`, every case `expect(transpileJxMarkdown(serializeJxMarkdown(doc, { frontmatter: false }))).toEqual(doc)` with fixtures written in the parser's normal form (`textContent` for a single text child):

- "§6.5's worked example parses to the JSON the section shows" (parse only, the new markdown and JSON verbatim).
- "an li template is a labelled leaf directive" (also asserts the output contains `::li[${$map/item/title}]`).
- "spec.md §10.1's list keeps its repeater inside the list" (`ul > [li "Header", Array{ map: li, textContent: { $ref: "$map/item" } }]`; asserts `textContent.ref="$map/item"`, no `[object Object]`, and a `:::ul` fence).
- "a converted markdown list item keeps its paragraph" (`ul > [li > p, Array{ map: li > p }]`).
- "an ordered list written as directives keeps its start" (`ol`, `attributes.start: "3"`).
- "an li template keeps inline elements" (`[a { attributes.href }, " by ", em]`) and "an li holding only components is a container" (`li > [span, button { onclick }]`, the Studio assistant's pattern).
- "label text that looks like markdown stays text" (``a *b* <c> :d[e] `f` _g_ ~~h~~ &amp;``) and "label text keeps its edge whitespace" (`" lead "`).
- "a row template keeps the repeater inside the table body", "a cell template sits among a row's cells" and "a root row template writes its cells as directives".
- "an li with block content is a container directive" (`li > [h3, p]`) and "an empty li template is a bare leaf" (asserts `::li` alone).
- "a repeater inside a template's list round-trips" (nested `Array{ map: section > ul > [Array{ map: li }] }`).
- "a classed list item keeps its list" (`ul > [li { className }, li]`) and "a classed list item at the root is a labelled leaf" (`li { className } "a"`; asserts `::li[a]{className="x"}`, the `convertToDirective` part branch).
- "a styled list and a styled table keep their items and rows" (`ul { className } > li > p`, `table { style } > [thead, tbody]`; asserts no nested `ul` comes back and every row does).
- "a list or table with no repeater keeps its markdown form" (asserts `- a` and a `| H |` GFM row in the output; no regression).
- "a legacy children-object list serializes to the §8 attributes instead of throwing".
- "a bound textContent is written as an attribute, on a block and inline" (`p { textContent: { $ref } }` and `p > ["see ", a { href, textContent: { $ref } }]`; asserts no `[object Object]`).
- "p, section and custom-element templates, and filter, sort and key, still round-trip" (regression, one case per shape).

Extended:

- `extensions/parser/tests/jx-markdown.test.ts`, next to "handles leaf directives as self-closing elements": "a leaf directive's label is its inline content" (`::li[Buy milk]` → `textContent`; `::li[Buy *fresh* milk]` → `children` with an `em`; `::hr` still has neither).
- `extensions/parser/tests/transpile.test.ts`, ":::Array with filter and sort attributes": the template becomes `::li[row]` and the test asserts `map` is `{ tagName: "li", textContent: "row" }`.

## Specs & docs

**jx-markdown.md §6.5** (in place):

- Marker: `> **Status: Implemented.** extensions/parser/src/transpile.ts (prototypeDirectiveToJx, directiveToJx), extensions/parser/src/serialize.ts (prototypeToDirective, partToDirective, holdsNatively), extensions/parser/tests/repeater-roundtrip.test.ts.`
- First paragraph: the attributes carry `items`, `filter`, `sort` and `key` (dot-path encoded); the body's first element is the `map` template and anything after it is ignored.
- The example becomes `:::Array{items.ref="#/state/posts"}` / `::li[${$map/item/title}]` / `:::` under `# Recent posts`, expanding to `{ "$prototype": "Array", "items": { "$ref": "#/state/posts" }, "map": { "tagName": "li", "textContent": "${$map/item/title}" } }`.
- New paragraph after it: "A template markdown can write only inside a parent (`li`, and the table parts `thead`, `tbody`, `tr`, `th` and `td`) is written as a directive: a leaf directive whose label (§4.2) holds its inline content, or a container directive when it holds blocks. A bound `textContent` is written as a dot-path attribute. A list or table that holds a repeater, or anything else its markdown form cannot hold, is written as a directive with each of its items or parts a directive too, so the repeater stays where it is; so is a list or table written as a directive for attributes of its own:", then spec.md §10.1's example exactly as the serializer writes it (`::::ul` / `::li[Header]` / a blank line / `:::Array{items.ref="#/state/todoList"}` / `::li{textContent.ref="$map/item"}` / `:::` / `::::`).
- Last paragraph keeps "This is the canonical, round-trippable encoding" and the dot-path sentence, adding that a list whose `children` is itself the Array object is written back in that form (§8).

**jx-markdown.md §4.2** (in place, unmarked): "Leaf directives are self-closing (no children)." becomes "Leaf directives take no block content. An optional label in square brackets is the element's inline content: a single run of text becomes `textContent`, anything else `children`." The example gains `::li[Buy *fresh* milk]`.

**jx-markdown.md §12.8**: replace the marker sentence "An `li` or table-part `map` template, or a repeater among a list's items, does not come back as written (§6.5)." with "In a leaf directive's label (§4.2), a hard break is written as a space and a code span holding `]` ends the label early, and a bound `textContent` on a `pre`'s `code` child is written as an empty fence." The marker stays Partial.

**Fragment**: `bun run spec:change jx-markdown.md minor -m "A repeater round-trips whatever its map template is and wherever it sits: list items and table parts are written as directives, a leaf directive's label is its inline content, a list or table holding a repeater is written as directives, a bound textContent is written as a dot-path attribute, and the worked example parses as shown."`

**Docs.** The only page citing `jx-markdown.md` in `spec:` or listing `transpile.ts`/`serialize.ts` in `code:` is `docs/framework/site/jx-markdown.md` (the generated reference pages aside). In it, with no em dashes:

- "Directives": "**Leaf directives** (two colons) are self-closing:" becomes "**Leaf directives** (two colons) take no block content. Text in square brackets is the element's inline content:", and the example gains `::li[Buy *fresh* milk]`.
- "Repeaters": the example becomes the §6.5 leaf form, followed by "A template that Markdown can only write inside a list or a table (a list item, a row or a cell) is written as a directive too, and a list or table that holds a repeater is saved as directives throughout, so the repeater stays where you put it:" and the `::::ul` example above.

This plan does not graduate jx-markdown.md: §3.1, §6.6, §7.3, §9 and §12.8 stay open.

**Landing.** The pull request deletes this file and removes `jx-markdown/repeater-map-template-roundtrip` from `plans/jx-markdown/roundtrip-lossless.md`'s `requires`, first re-checking that plan's "What the two prerequisites land" against what shipped and adding the §12.8 sentence above to its Context: its `labelSafe` closes the label limits, and deleting the marker makes the `pre` case its to fix.

## Acceptance

- `cd extensions/parser && bun test --isolate --coverage` is green with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts extensions/parser` passes.
- From `extensions/parser`, this prints a `::::ul` block holding `::li[Header]` and a `:::Array` whose template is `::li{textContent.ref="$map/item"}`, then `true`:
  `bun -e 'import { serializeJxMarkdown } from "./src/serialize.ts"; import { transpileJxMarkdown } from "./src/transpile.ts"; const d = { children: [{ tagName: "ul", children: [{ tagName: "li", textContent: "Header" }, { $prototype: "Array", items: { $ref: "#/state/todoList" }, map: { tagName: "li", textContent: { $ref: "$map/item" } } }] }] }; const md = serializeJxMarkdown(d, { frontmatter: false }); console.log(md + (JSON.stringify(transpileJxMarkdown(md)) === JSON.stringify(d)));'`
- `bun run plans:status --spec jx-markdown` no longer lists §6.5; `bun run plans:check` reports nothing for jx-markdown.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` are green.
- In Studio (the `packages/studio:verify` recipe): open a starter `.md` page, add a bulleted list and give it a second item, run Convert to Repeater on that item, save, close and reopen the tab. Outline shows the repeater (↻) inside the list, after the first item, and the saved file holds a `:::ul` block.
