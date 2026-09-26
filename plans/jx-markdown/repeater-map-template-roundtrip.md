---
status: stub
disposition: implement
claims:
  - jx-markdown.md#6.5
size: M
workspaces:
  - extensions/parser
---

# A `:::Array` repeater round-trips whatever element its map template is, wherever it sits

## Context

`specs/jx-markdown.md` §6.5, line 211:

> **Status: Partial.** The directive ships: `prototypeDirectiveToJx` (`extensions/parser/src/transpile.ts`) restores `$prototype`, expands the attributes and takes the first element child as `map`, `prototypeToDirective` (`extensions/parser/src/serialize.ts`) writes it back, and the older dot-path form still parses. The worked example does not produce the JSON shown: the `:li{…}` line parses as a `p` wrapping the `li`, and `children.0` expands to an object keyed `"0"`. The round trip is not lossless for a template markdown can only write inside a parent: an `li` map serializes as a bare `- …` list item and re-parses as `ul > li > p`. A repeater among a list's items, the shape Studio's Convert to Repeater leaves when it converts a list item, fares worse: it is written between the `- …` items and re-parses outside the list, as its sibling.

The section was unmarked before the census. Disposition `implement`: the contract the section states ("the canonical, round-trippable encoding", with the nested block as the `map` template) is the right one, and §12.8 promises roundtrip mode is lossless for everything it can express; an `li` template and a list holding a repeater are both expressible as directives, so losing them is a serializer gap, not a spec error. The worked example is wrong as well and is corrected in the same change, which is why both halves are one item.

**What exists**

- `prototypeDirectiveToJx` in `extensions/parser/src/transpile.ts`: `$prototype` from the directive name, attributes through `expandDotPaths`, and `map` = the first object among `convertChildren(node.children)`.
- `prototypeToDirective` in `extensions/parser/src/serialize.ts`: collapses every key but `$prototype`, `map` and `tagName` to attributes, and emits `map` through `convertJxNode` as the single child. A markdown-native tag (`li`, `p`, `h1`, …) is therefore written as markdown, not as a directive. `convertJxNode` writes a `ul` or `ol` as a markdown list whatever its children, so a repeater child is emitted between the list items, where no list can hold it.
- `packages/studio/src/editor/convert-to-repeater.ts` replaces the selected element in place (its header comment), so converting a list item yields `ul > [li…, { $prototype: "Array", map: li }]`. The `Markdown` class's Studio nesting rules (`extensions/parser/src/Markdown.class.json`) allow only `li` in a `ul` or `ol`, and only row groups and rows inside a table, so those are the templates a repeater inside a list or table naturally has.
- Tests: `extensions/parser/tests/serialize-export.test.ts`, "jxToMdast → mdastToJx preserves an Array member among siblings", asserts exactly the in-list `ul > [li, Array { map: li }]` shape and passes, because it round-trips at the mdast level through `mdastToJx(jxToMdast(…))` and never stringifies. That is what hid the loss. `extensions/parser/tests/transpile.test.ts` parses a `:li{}` template but asserts nothing about `map`.
- `mdastToJx` and its `convertDirective` / `prototypeDirectiveToJx` copies in `extensions/parser/src/serialize.ts` are an exported md-to-Jx path with no production caller: `serializeRoundtrip` calls only `jxToMdast` and remark-stringify. Their directive mapping already differs from `directiveToJx` (raw attributes copied into `attributes` with no routing or dot-path expansion; a text child becomes a `span`), so a test through them says nothing about what a saved file re-opens as. Whether to delete or align that path is the §12.8 plan's decision.
- Measured at b900b326, with `transpileJxMarkdown` and `serializeJxMarkdown`: the §6.5 example transpiles to `map: { tagName: "p", children: [{ tagName: "li", children: { "0": "${$map/item/title}" } }] }`. Serializing the section's own JSON emits `- ${$map/item/title}` inside `:::Array`, which re-parses as `map: { tagName: "ul", children: [{ tagName: "li", children: [{ tagName: "p", … }] }] }`. `{ tagName: "ul", children: [{ tagName: "li", textContent: "header" }, { $prototype: "Array", items: { $ref: "#/state/rows" }, map: { tagName: "li", textContent: "row" } }] }` serializes to `- header` then `:::Array{items.ref="#/state/rows"}` / `- row` / `:::`, and re-parses as a root-level `ul > li > p` followed by the repeater, its `map` now a `ul`. A `p` template round-trips (its `children` array comes back as `textContent`).

**What is missing**

- Serializer, template: inside a prototype directive, a `map` template that markdown cannot write standalone (`li`, and the table parts `tr`, `td`, `th`, `thead`, `tbody`) is emitted as a directive, so it re-parses as itself.
- Serializer, parent: a `ul`, `ol` or table part that holds a prototype child is itself written as a directive (with its other children as directives too), or some equivalent, so the repeater stays inside it.
- Parser: a decision on whether a paragraph whose only content is one text directive, directly inside a prototype directive, unwraps to that directive (which would make the section's `:li{…}` form parse as written), or whether the example changes to a block form such as `::li{textContent="${$map/item/title}"}`.
- Whether `children.0` (a numeric dot-path segment) should expand to an array index; today `expandDotPaths` makes an object key. If not, the example stops using it.
- The worked example and its expansion made true, and the claim scoped if some template shapes stay unsupported.
- String-level round-trip tests, `serializeJxMarkdown` → `transpileJxMarkdown`, for a root `li` template, a table-row template, a custom-element template and the in-list `ul > [li, Array { map: li }]` shape; the mdast-level test above stays only if `mdastToJx` does.
- docs/framework/site/jx-markdown.md ("Repeaters") carries the same example and changes with it.

**Related**

- jx-markdown.md §12.8 (roundtrip losslessness; its marker lists these losses, and the plan that owns it requires this one).
- jx-markdown.md §6.4 (dot-path expansion, which decides `children.0`), jx-markdown.md §8 (the older `children.*` array form), jx-markdown.md §12.3 (`expandDotPaths`).
- parser.md §5 (`serializeJxMarkdown`), parser.md §7 (the directive mapping).
- spec.md §10.1 (the `Array` pseudo-element and its `map` template).
