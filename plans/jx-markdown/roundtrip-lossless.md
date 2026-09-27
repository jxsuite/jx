---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#12.8
requires:
  - jx-markdown/directive-attribute-routing
  - jx-markdown/pseudo-element-names
  - jx-markdown/repeater-map-template-roundtrip
workspaces:
  - extensions/parser
  - scripts/ci
  - specs
  - docs
size: M
---

# Roundtrip serialization re-parses to the document it was given, names what it normalizes, and refuses what no directive can carry

## Context

`specs/jx-markdown.md` §12.8, line 431:

> **Status: Partial.** Both modes ship (`serializeRoundtrip` and `serializeExport` in `extensions/parser/src/serialize.ts`; Studio saves through roundtrip mode in `packages/studio/src/files/serialize-document.ts`), and a `tagName` chosen at render time throws as stated. Roundtrip mode is not the inverse of `transpileJxMarkdown` for several ordinary shapes, and no test feeds its output back through `transpileJxMarkdown`. `textContent` or inline children of a directive outside the transpiler's phrasing set (`div`, `section`, any custom element) are written as bare block content and come back wrapped in `p`, one paragraph per inline child, with edge whitespace lost. A custom element's `className` and `on*`, and a standard element's `href`, `title` or `value`, come back under `attributes` (§6.6). An `li` or table-part `map` template, or a repeater among a list's items, does not come back as written (§6.5). The `popover-open`, `open`, `modal` and `backdrop` style keys are written with their colons (`style.:popover-open.opacity`), because the serializer keeps its own pseudo-class set instead of using `collapseStylePaths` (§12.7); they re-parse, but not in the §7.3 spelling.

Three writers depend on this being the inverse of the parser, and each already turns a thrown error into a named, non-destructive failure: a Studio save (`packages/studio/src/files/file-ops.ts`: `notify.error`, the tab stays dirty, nothing is written), a Studio format conversion (`buildPlan` in `packages/studio/src/format/convert-file.ts`: the error becomes the dialog's `blocker`), and a rename refactor (`packages/server/src/refactor/apply.ts`: an entry in the report's `errors`). The refactor re-serializes every `.md` file that references a renamed file, so a loss here reaches documents the author never opened.

**Measured at 84735a9f** (the parser is unchanged since the audit's b900b326) by feeding `serializeJxMarkdown` output back through `transpileJxMarkdown`; no test suite was run. The census list was right but short. Every tracked Jx Markdown document (the 136 under `examples/`, `packages/create/template*` and `packages/starters/sites`) is a fixed point except one, because hand-written files use the shapes the serializer handles. The losses are in what Studio, `htmlToJx` and the spec's own examples produce:

| Shape                                                                                                    | Written                                                                          | Comes back                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `div`, `section`, `option` or a custom element with `textContent: "hi"`                                  | `:::div` / `hi` / `:::`                                                          | `div > p "hi"` (a leading or trailing space survives only because it is written `&#x20;`)                                                     |
| `div > ["plain ", strong, " tail"]`                                                                      | three blocks                                                                     | three `p`s, the edge spaces gone                                                                                                              |
| `button > ["Go ", strong]`; a styled `td > ["a ", em]`                                                   | `INLINE_CONTENT_TAGS` (serializer) and `PHRASING_ELEMENTS` (transpiler) disagree | `button > ["Go", strong]`; `td > p`                                                                                                           |
| a card link `a { className, href } > [h3 "T", p "B"]`                                                    | `:::a{…}` / `### TB` / `:::`                                                     | `a > h3 "TB"`: the heading and paragraph are written as one inline run                                                                        |
| §5's example: `:::a{href="/"}` / `Home` / `:::` inside `nav`                                             | `[Home](/)`                                                                      | `nav > p > a`                                                                                                                                 |
| §4.2's example (root `hr`, `input`, `img`)                                                               | `***::input{type="text" placeholder="Enter name"}![A photo](/photo.jpg)`         | one `p`: the first two as literal text, then the `img`                                                                                        |
| root `[p "a", "loose", p "b"]`                                                                           | `alooseb`                                                                        | one `p`                                                                                                                                       |
| `section { $shadow: "open" } > h2`, then a `p`; Studio's Element ID row (`$id`)                          | `:::section{$shadow="open"}` …; `::div{$id="hero"}`                              | the fence is a literal `p`, the `h2` escapes to the root, a stray `:::` `p` follows                                                           |
| `div { style: { ".title" \| "& .x" \| "@media (min-width: 600px)": {…} } }`                              | `::div{style..title.color="blue"}` and so on                                     | `style[""].title`, a rule under an empty selector; the other two a `p` holding the directive's source                                         |
| `$props: { ref: "x" }`; `attributes: { "x.y": "1" }`; `$props: {}`                                       | `props.ref="x"`; `x.y="1"`; nothing                                              | `$props.$ref`, a binding; `attributes.x.y`; the key is gone                                                                                   |
| `p { attributes: { "data-x": "1" } }`; `h2 { attributes: { "aria-label": "x" } }`                        | `hi`; `## T`                                                                     | attributes dropped. `examples/components/todo-app.md`'s `::p{textContent=… color=…}` is the one tracked document that does not survive a save |
| `a` with no `href`; `img` with no `alt`                                                                  | `[go]()`; `![](/a.png)`                                                          | `href: ""`; `alt: ""`                                                                                                                         |
| an empty `p`, `ul` or `table`; an empty `strong` in a `p`                                                | nothing; `x ****`                                                                | the element is gone; literal `****`                                                                                                           |
| `pre > code` with `className: "x"`, with `attributes`, or with a second `code`                           | a fence                                                                          | `className: "language-x"`; the attributes and the second `code` gone                                                                          |
| `div { innerHTML }`; `p { innerHTML }`                                                                   | `::div`; nothing                                                                 | `innerHTML` dropped; the `p` is gone                                                                                                          |
| `p` or `h1` whose `children` is the §8 descriptor                                                        | throws `TypeError: (e.children ?? []).map is not a function`                     | (nothing is saved)                                                                                                                            |
| `className: ["a", "b"]`; a `null` value                                                                  | `"a,b"`; `"null"`                                                                | strings                                                                                                                                       |
| `hidden: false`; `$props: { start: 5, open: false }`                                                     | `"false"`; `"5"`, `"false"`                                                      | a hidden element; a string prop and a truthy `open`                                                                                           |
| `style: { "@--dark": { ":hover": {…} } }`                                                                | `style.--dark.hover.color`                                                       | a `hover` type selector, which matches nothing                                                                                                |
| `style: { "--brand": "red" }`                                                                            | `style.--brand="red"`                                                            | `"@--brand": "red"`, and a hand-written `style.--brand` parses the same way                                                                   |
| `style: { ":popover-open": {…}, "::backdrop": {…} }`                                                     | `style.:popover-open.opacity`, `style.::backdrop.background`                     | as given (the census's clause)                                                                                                                |
| `$switch` with `cases`                                                                                   | `::div{switch.ref=… cases.a.tagName="p" …}`                                      | `cases` under `attributes`: the switch renders nothing                                                                                        |
| a GFM table with no `thead`, a body row shorter than the header, or a cell holding a `br` or edge spaces | a GFM table                                                                      | the first row becomes the header; the short row gains an empty `td`; the `br` becomes a space and the edge spaces go                          |

Three library facts decide the fix, each measured:

- mdast-util-to-markdown serializes a `root` that holds any phrasing child as phrasing, so one string or `img` among the root's children joins every sibling onto one line. A directive's body is always written as flow.
- micromark-extension-directive 4.0.0 (`dev/lib/factory-attributes.js`, `factory-name.js`, with micromark-util-character's `\p{P}|\p{S}` punctuation test) accepts an attribute name that starts with `-`, `_` or any character that is neither whitespace nor punctuation, and continues with those plus `.` and `:`, and a directive name that starts with neither and continues with `-` and `_`, not ending in either. Every other character (`$`, `@`, `&`, `[`, `(`, a space) ends the attribute list, so the directive line stops being a directive. `:` mid-name is fine: `style.--dark.:hover.color` parses as written. An empty segment (`style..title`) parses but expands to an empty key.
- In a directive label, a hard break is written as a space, and a code span holding `]` or a line ending ends the label early. A line ending in plain text is written `&#xA;` and survives. Inline HTML `<br>` and a `:code[x\]y]` text directive both survive, and `convertChildren` maps them back to `br` and `code`.

**What the three prerequisites land**, from their drafted plans:

- `plan:jx-markdown/repeater-map-template-roundtrip` (§6.5): the transpiler reads a leaf directive's label as its inline content (§4.2); `serialize.ts` gains `partToDirective` (a labelled leaf for static text or phrasing content, a bare leaf when empty, a container otherwise), `isInlineOnly`, `holdsNatively` (a list or table holding anything its markdown form cannot hold is written as directives throughout; whitespace-only strings do not count), `blockChild`, `boundText` and `LABEL_UNSAFE`; a bound `textContent` on any element `convertJxNode` visits is written `textContent.ref`. It leaves GFM's structural limits, a native list item's `li > p`, array values, `mdastToJx`, two label limits (a `br`, and a code span holding `]`) and a bound `textContent` on a `pre`'s `code` child (written as an empty fence) to this plan, and moves those last two into §12.8's marker.
- `plan:jx-markdown/directive-attribute-routing` (§6.6): one routing set for every element (`ELEMENT_LEVEL_KEYS`, `isElementLevelKey`), and a bare `hidden` is `true`. It names two placement normalizations for this plan to state (an element-level key outside the set comes back under `attributes`; an `attributes` key inside it comes back on the element) and leaves scalar typing here. Its §12.8 marker rewrite leaves "a bound `value`, `checked` or `selected` becomes the control's default" for this plan to name or refuse. Its set omits `cases` and `innerText`, both `ElementDef` keys (`packages/schema/schema.json`); `cases` is spec.md §14.1's.
- `plan:jx-markdown/pseudo-element-names` (§7.3): `applyStyleKeyMapping` and `collapseStylePaths` act at every depth on keys holding a block (a plain object that is not a `$ref`), so a `--` key holding a value is a custom property in both directions, and §7.4, §12.4, §12.5 and §12.7 say so. Its integration contract asks this plan to require it and to write styles through `collapseStylePaths`, which is what closes the census's style clause.

**What else exists**

- `serializeRoundtrip`: frontmatter from every non-`children` key through `yaml`, then `jxToMdast` and remark-stringify. Frontmatter round-trips exactly, YAML-1.1-looking strings (`yes`, `on`, `2024-01-01`) and `null` included. No caller passes the `allowlist` option.
- `collapsePropsToAttrMap` keeps its own `CSS_PSEUDO_NAMES` (it stops at `after`), `JX_DOLLAR_KEYS` and `JX_ANNOTATION_KEYS`; strips `:` and `@` at every depth; flattens a bare `@` style key into the base (nothing in the repository writes that key); and writes every leaf as `String(value)`. `expandDotPaths` applies `jxKey` to every segment, so any segment spelled `ref`, `props`, `switch` (and the rest of §6.2's table) or `--title` comes back `$`-prefixed.
- `hasJxProps` ignores `attributes`, `textContent` and `innerHTML`, so any markdown-native tag carrying them is written natively, and nothing checks that a native tag's content fits its markdown form.
- Studio's Element section writes the "ID" row as `$id` on any element (`packages/studio/src/panels/properties-panel.ts`); the runtime reserves `$id` as it does `$title` (`RESERVED_KEYS`, `packages/runtime/src/runtime.ts`), and the Outline labels a node by it.
- `mdastToJx` (with `MDAST_TAG_MAP`, `convertMdastNode`, `convertDirective` and `prototypeDirectiveToJx`) is exported and listed in parser.md §2 and §5, has no caller outside tests, and has drifted from `directiveToJx` (raw attributes, text children as `span`s). `serialize.test.ts` (`mdToJx`, `round-trip`), `serialize-coverage.test.ts` (`mdToJx — …`) and one `serialize-export.test.ts` case run through it.
- `serialize-tagname-expression.test.ts` pins the render-time `tagName` refusal, whose message shape (`Markdown cannot express … Keep this element in a JSON component.`) the new refusals copy.
- `scripts/ci/affected.ts` resolves a changed path with `EXTRA_EDGES.find`, so only the first matching edge fires. `examples/**` (→ `packages/compiler`) and `packages/starters/sites/portfolio/**` (→ `packages/server`) are already edges.

**Related.** jx-markdown.md §4.2, §6.1–§6.3, §6.6, §7.3, §7.4, §8, §9, §12.5–§12.7; parser.md §5; spec.md §8.3 (boolean attributes), §9.2 (nesting in either order), §14.1 (`cases`, the `div` container); studio.md §8.1 (the save path). `plan:jx-markdown/commonmark-coverage` (§9) edits `serialize.ts` too and is written for either landing order.

## Outcome

- jx-markdown.md §12.8 → Implemented. The marker is removed; the roundtrip bullet states the inverse, the normalizations it makes and the refusals, and `extensions/parser/tests/roundtrip-corpus.test.ts` proves all three at the string level.
- jx-markdown.md §6.6's element-level set gains `cases` and `innerText`; §12.6 says each keyword segment is written unprefixed; §6.3 gains `--id` if the refusal Open resolves as recommended. parser.md §5 defers to §12.8.
- If §3.1 and §9 are already Implemented when this lands (§6.5, §6.6 and §7.3 are, as prerequisites), this pull request graduates jx-markdown.md.

## Decisions

- **Decided:** one plan that requires the §6.5, §6.6 and §7.3 plans, not an enabling split for the corruption fixes. None of the three has `requires` of its own, so this waits one wave at most, and the §6.5 plan's writer (`partToDirective`, `holdsNatively`, labels) is the mechanism most fixes here extend. The §7.3 edge is a real prerequisite, not a relation: that plan makes the style mapping recursive and value-aware, and this plan's serializer writes styles through the result instead of repeating it. No edge to `plan:spec/static-dom-property-emission`: nothing here reads a property table, and the §6.6 plan already declined that edge. No edge to `plan:jx-markdown/commonmark-coverage`: it names what it does in either order.
- **Open:** how a directive outside `PHRASING_ELEMENTS` writes static text or inline-only content. Recommendation: the §6.5 plan's labelled leaf (`::div[plain **b** tail]`), signed together with that plan's own label Open, which asks for exactly this. A transpiler rule unwrapping a lone paragraph would re-read every hand-written `:::section` / text / `:::` and every docs callout as `textContent`, while leaf labels are new syntax; the container-and-paragraph form stays for phrasing tags, so no saved file churns. The cost, which the §6.5 plan's lists do not carry: a project that builds with a published `@jxsuite/parser` older than the §6.5 change drops a label, so a `div`, `dd`, `option` or custom element whose text is written this way renders empty there, where today's form shows the text inside a `p`. The alternative, keeping today's form and naming the `p` wrap as a normalization, leaves the edge-whitespace and one-paragraph-per-child loss the marker names.
- **Decided:** a phrasing directive (a tag in `PHRASING_ELEMENTS`) with inline-only content keeps today's container-and-paragraph form, and `INLINE_CONTENT_TAGS` is deleted in favour of the transpiler's set, since the two disagreeing is itself a loss. A phrasing directive holding a block (the card link `a > [h3, p]`) is a container whose body is flow, with each `p` child written as a directive, because the transpiler unwraps a phrasing element's paragraphs: text beside the blocks then comes back as bare text, exactly, and the `p` survives.
- **Decided:** in a flow position (the document root, a directive body holding blocks), a run of inline siblings that contains text is written as one paragraph, an inline element with no text beside it is written as a block directive (`::img{src="…" alt="…"}`, `::a[Home]{href="/"}`) that re-parses as itself, and a whitespace-only string is skipped (a paragraph of it is written as blank lines). The root must never hold a phrasing node, and a lone `img` or `a` is what §4.2, §5 and an HTML `<img>` line produce.
- **Decided:** styles are written through `collapseStylePaths` as the §7.3 plan leaves it, and `collapseDotPaths` writes every `$`-keyword segment through `mdKey`, so its output is always writable. The serializer's own pseudo-class and keyword sets and its bare-`@` branch go.
- **Open:** what roundtrip does with a key or value no directive can carry. Recommendation: throw before anything is written, naming the element and the key, as the render-time `tagName` refusal does. Every caller already reports a throw without writing, and today's output does not parse, so the next save escapes it into literal text and the loss is permanent. The cases:
  - a tag or attribute name outside the grammar above: a style block keyed by a selector (`.child`, `& li`, `[open]`, `:nth-child(2n)`), an at-rule other than a named media query, a `$` key §6.2 and §6.3 do not map (`$shadow` on a nested element, `$expression` inside a bound value);
  - a key the dot-path form cannot spell back: one holding a `.`, and a plain key that `jxKey` would read as a keyword (a `ref` or `props` prop, a `--title` custom property);
  - two keys that write the same attribute with different values (`id` and `attributes.id`);
  - an array value;
  - an element-level `value`, `checked` or `selected` holding a binding (a `$ref` or a `${…}` template), which §6.6 would bring back as the control's default. If §6.6's Open resolves the other way this case disappears.

  Studio's Element section writes `$id` on any element, so refusing it would block an ordinary Studio edit. Recommendation: add `id` to §6.3's annotation keys (`--id` ↔ `$id`), which fits §6.3's stated reason (the HTML attribute of the same name) and the runtime's treatment of `$id` as reserved metadata like `$title`. No tracked `.md` writes an element-level `--` key other than `--title` and `--description`. The alternatives each add format surface: a JSON-valued attribute, or hoisting a style block into frontmatter `style` under a generated selector. A Studio style panel that offers a Markdown document only what it can hold is a studio.md follow-up, not this plan's.

- **Open:** a directive attribute value is a string, so what becomes of a number or a boolean? Recommendation: keep it where its string reads back the same, name it where only its type changes, and refuse it where the meaning flips.
  - `hidden: true` is written with an empty value (`hidden=""`), which §6.6 reads back as `true`; a `hidden` that is `false` or `""`, neither of which hides, is omitted.
  - A number, or `true` anywhere else, is written as its string and named in §12.8. `setAttribute`, CSS and a truthiness test read the string as the value, but a component receives a numeric `$props` value as a string.
  - Any other `false` is refused, except in an `aria-*` attribute, whose `"false"` spec.md §8.3 emits anyway, because `"false"` is truthy and a presence attribute written `"false"` is present.

  Studio's property, attribute and component-prop rows write `true`, `""` or delete the key and never write `false` (`packages/studio/src/panels/properties-panel.ts`), so the refusal cannot fire on a Studio edit. A typed attribute syntax is the alternative, and it is new format surface for a case Studio does not produce.

- **Open:** text or inline elements directly in a native list item or block quote. Recommendation: a named normalization, written as today (`- a`, `> q`) and coming back inside a `p`, the block markdown gives both. The exact form would write every list Studio types into as `:::ul` / `::li[a]`, which defeats the format for the content it exists for. Whether a tight list item should parse without its `p`, as CommonMark renders it, is §9's question (`plan:jx-markdown/commonmark-coverage`), and that plan narrows this bullet if it lands second.
- **Open:** keep or delete `mdastToJx`. Recommendation: keep the export and make it a wrapper over the transpiler's converter, deleting its private one. parser.md §5 documents it, and deleting a documented export of `@jxsuite/parser` 1.x is a major release for no user gain; the wrapper turns every mdast-level test into a test of the production converter. Its output changes (text children become strings, directive attributes are routed), which is the fix, and nothing in the repository calls it.

## Implementation

Written for the recommended answer to every Open.

1. **`extensions/parser/src/transpile.ts`**
   - Export `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES`.
   - `JX_ANNOTATION_KEYS` gains `id`, so `jxKey("--id")` is `$id` and `mdKey("$id")` is `--id`.
   - `collapseDotPaths(obj)`: pass each path segment through `mdKey`. JSDoc cites jx-markdown.md §12.6.
   - After §6.6 lands: its `ELEMENT_LEVEL_KEYS` gains `cases` and `innerText`.
   - `applyStyleKeyMapping`, `collapseStylePaths`: nothing beyond the §7.3 plan.
2. **`extensions/parser/src/serialize.ts`**, roundtrip half (export mode's `nodeToMdast` is untouched):
   - Import `collapseDotPaths`, `collapseStylePaths`, `jxKey`, `mdKey`, `convertChildren`, `mdastNodeToJx`, `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES` from `./transpile.ts`. Delete `INLINE_CONTENT_TAGS`, `CSS_PSEUDO_NAMES`, `JX_DOLLAR_KEYS`, `JX_ANNOTATION_KEYS`, the local `PROTOTYPE_DIRECTIVE_NAMES` and `collapsePropsToAttrMap`.
   - `refuse(tag, what, why): never` throws `` `Markdown cannot express ${what} on ${tag} (${why}). Keep this element in a JSON component.` ``, the shape `serializableTag` uses.
   - `ATTRIBUTE_NAME = /^(?:[-_]|[^\s\p{P}\p{S}])(?:[-_:]|[^\s\p{P}\p{S}])*(?:\.(?:[-_:]|[^\s\p{P}\p{S}])+)*$/u` and `DIRECTIVE_NAME = /^[^\s\p{P}\p{S}](?:[-_]|[^\s\p{P}\p{S}])*(?<![-_])$/u`, with a comment naming the two micromark files they mirror. Every directive name written (`convertToDirective`, `partToDirective`, `prototypeToDirective`) is checked against `DIRECTIVE_NAME`.
   - `directiveAttributes(tag, props, attributes)` replaces `collapsePropsToAttrMap` and the tail of `collectDirectiveAttrs`; `prototypeToDirective` calls it too. Element keys first, then `attributes`. Per entry:
     - a `null` or `undefined` value, or an empty object, is skipped;
     - `hidden` is written `""` when `true` and skipped when `false` or `""`;
     - any other `false` is refused unless the name starts with `aria-`;
     - an array is refused, anywhere in the value;
     - an element-level `value`, `checked` or `selected` holding a `$ref` or a string containing `${` is refused;
     - `style` goes through `collapseStylePaths`, any other object through `collapseDotPaths`, each result key prefixed with its path;
     - a number or `true` becomes its string;
     - every original key segment must be spellable: non-empty, free of `.`, and read back by `jxKey` as itself once written through `mdKey` (checked after the style mapping, whose `:`/`::`/`@` prefixes are the §7.3 plan's to restore);
     - every final name must match `ATTRIBUTE_NAME`;
     - a final name produced twice with different values is refused.

     Each refusal names the original key (`style[".title"]`, `$props.ref`, `$shadow`).

   - `needsDirective(el, tag)` replaces `hasJxProps` and keeps the §6.5 plan's `boundText` test. It is also `true` when:
     - `innerHTML` is set;
     - `children` is present and not an array;
     - `attributes` holds anything the tag's markdown form does not write back. `NATIVE_ATTRIBUTES` allows `a`: `href` (a string, required) and a non-empty string `title`; `img`: `src` and `alt` (strings, both required) and a non-empty string `title`; `ol`: `start`, `String(n)` for a whole `n` other than 1, at most nine digits; every other native tag: none;
     - the tag's markdown form holds inline content only (`p`, `h1`–`h6`, `em`, `strong`, `del`, `a`, `th`, `td`) and its children are not `isInlineOnly`;
     - the tag is `code` and its content is anything but a non-empty string `textContent` (the native writer reads only that);
     - the tag is `p`, `em`, `strong`, `del`, `ul`, `ol` or `table` and it has no content (no non-empty `textContent`, no children), since each of those vanishes or turns into literal text when empty;
     - the tag is `pre` and it holds neither a string `textContent` nor exactly one `code` child whose only keys are `tagName`, a string `textContent` and a `className` of the form `language-<name>` with no whitespace in the name. This closes the bound-`code` case the §6.5 plan hands over.

     `convertJxNode`'s directive test and the §6.5 plan's `holdsNatively` both call it.

   - `isInlineOnly` (the §6.5 plan's): an `MD_INLINE` element counts as phrasing only when its own array children are phrasing too, so `a > h3` is a block.
   - `convertToDirective`, block form: a tag outside `PHRASING_ELEMENTS` whose content is static text or `isInlineOnly` goes through `partToDirective`'s labelled-leaf path (generalized from parts to any tag); otherwise a container whose body is `flowChildren(children, tag)`. A phrasing tag with inline-only content keeps today's single-paragraph body; with any other content it is a container whose body is `flowChildren(children, tag)`.
   - `flowChildren(children, parentTag)`, used by `jxToMdast` for the root (`parentTag` empty) and by every directive container body (`convertToDirective`, `partToDirective`, `prototypeToDirective` through `blockChild`). A whitespace-only string is skipped. A string, a number and an element `isInlineOnly` counts as phrasing are inline; one that needs a directive is written in the run as a text directive. A maximal run of inline siblings containing a string or number becomes one `paragraph`. An inline element in a run with no text is written through `partToDirective` as a block directive. When `parentTag` is in `PHRASING_ELEMENTS`, a `p` child is written through `partToDirective`, because a native paragraph there would be unwrapped. Every other child goes through `blockChild`. The native `blockquote` and `listItem` writers (`block()` in `convertJxNode`) group their inline runs into one paragraph with the same pass, per the list-item Open. If `plan:jx-markdown/commonmark-coverage` lands first, its `listItem` inline-run pass is this one: extend it rather than add a second.
   - `labelSafe(nodes)`, applied to every label the leaf path writes and to every GFM cell: a `break` becomes `{ type: "html", value: "<br>" }`, and an `inlineCode` whose value contains `[`, `]` or a line ending becomes a `textDirective` named `code` holding that text.
   - `holdsNatively` (the §6.5 plan's), for `table`: also `false` unless the table is GFM's shape: a `thead` holding one `tr` of at least one `th` first, then at most one non-empty `tbody` of `tr`s of `td` cells, every row with the header's cell count, and every cell's content inline-only, with no text run starting or ending in whitespace.
   - `mdastToJx(node)`: a `root` returns `{ children: convertChildren(node.children ?? []) }` (or §9's root converter, `mdastRootToJx`, if `plan:jx-markdown/commonmark-coverage` has landed); any other node returns `mdastNodeToJx(node)`, whose return type the export takes. Delete `MDAST_TAG_MAP`, `convertMdastNode`, `convertDirective` and the local `prototypeDirectiveToJx`. The JSDoc says it is the transpiler's own tree walk.
   - The module header and `jxToMdast`'s comment describe the inverse, the normalizations and the refusals, citing jx-markdown.md §12.8.
3. **`scripts/ci/affected.ts`**:
   - `decide` collects the seeds of every edge whose patterns match (`EXTRA_EDGES.filter`), not the first (`find`). Without it, the new edge never fires for `examples/**` or the two starters the refactor edge names, whichever order the entries take.
   - A new `EXTRA_EDGES` entry: `patterns` `examples/**/*.md`, `packages/create/template/**/*.md`, `packages/create/templates/**/*.md`, `packages/starters/sites/**/*.md` and `specs/jx-markdown.md`; `seeds: ["extensions/parser"]`; `evidence: ["extensions/parser/tests/roundtrip-corpus.test.ts"]`; and a `why` saying the corpus reads those documents and the spec's examples while those workspaces depend on the parser, never the reverse.
4. On landing, delete this file. If this pull request graduates the spec, delete `plans/jx-markdown/` with it.

**Integration contract.** Once this lands:

- With the default options, `transpileJxMarkdown(serializeJxMarkdown(doc))` equals `doc` up to the normalizations §12.8 lists, or `serializeJxMarkdown` throws an `Error` whose message begins `Markdown cannot express` and names the element and the key (or, for a chosen `tagName`, the candidates).
- `@jxsuite/parser/transpile` exports `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES`; `collapseDotPaths` writes keyword segments unprefixed; `--id` is `$id`.
- `mdastToJx` is the transpiler's converter.
- A path matching several `EXTRA_EDGES` entries seeds all of them.
- `extensions/parser/tests/roundtrip-corpus.test.ts` holds the shape tables and the fixed-point corpus that any later change to the format extends.

## Tests

From `extensions/parser`: `bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts extensions/parser` from the root. No source file is added. `extensions/parser/bunfig.toml` holds `lines = 0.987, functions = 0.975` per file. Deleting `mdastToJx`'s private converter removes code only the mdast-level tests reached, and every new function and refusal branch is reached by the cases below. If `serialize.ts` or `transpile.ts` ends above the workspace's current worst file, ratchet the threshold to just below the new minimum. The scripts suite (`bun test --isolate scripts`) covers `affected.ts`.

New `extensions/parser/tests/roundtrip-corpus.test.ts`, with `roundTrip = (doc) => transpileJxMarkdown(serializeJxMarkdown(doc))`:

- `describe("tracked documents are fixed points")`: one test per file under the four `.md` globs of step 3, skipping any path with a `node_modules` segment (Studio's starter iteration installs one). Each asserts `roundTrip(parsed)` `toEqual` `parsed`. A guard test asserts each of `examples/`, `packages/create` and `packages/starters` contributed files, so a moved directory cannot empty the corpus. `examples/components/todo-app.md` fails today.
- `describe("the spec's examples are fixed points")`: every `markdown` fence in `specs/jx-markdown.md`, the same assertion. §4.2's and §5's examples fail today (§6.5's throws, and its plan rewrites it).
- `describe("shapes come back as written")`, an `EXACT` table asserting `roundTrip(doc)` `toEqual(doc)`:
  - static text on `div`, `section`, `option` and `my-card`, including edge spaces, a line break, brackets and markdown punctuation;
  - inline-only children with a `br`, a code span holding `]`, a code span holding a line ending, and a classed `span`;
  - `button > ["Go ", strong]` and a styled `td > ["a ", em]` in a directive table;
  - `a { className, href } > [h3, p]`, `a > [h3, "text"]` and `p > a > h3`;
  - `nav > a`; a root `[hr, input, img]`; a root `img` beside a `p`;
  - native `p` and `h2` carrying `data-*` and `aria-*` attributes; `a` without `href`; `img` without `alt`; `a` with an empty `title`;
  - an empty `p`, `ul`, `table` and `strong`;
  - `pre > code` with a plain class, with `attributes`, with two `code`s, and with a bound `textContent`;
  - `innerHTML` on `div` and `p`; a `p` with the §8 descriptor;
  - a styled `td` table cell holding a `br`, and one with edge spaces (both written as directives);
  - every §7.3 name, `::backdrop`, `"@--dark": { ":hover" }`, `":hover": { "@--sm" }`, a `--brand` custom property and a bound style value, written through `collapseStylePaths`;
  - `$switch` with `cases` and a `tagName`; `hidden: true`; `$id: "hero"` (written `--id`);
  - `$props` string, `$ref` and nested values; `--title` and `--description`;
  - a table without `thead` and one with a short row (both written as directives);
  - frontmatter holding `yes`, `on`, `2024-01-01` and `null`.
- `describe("normalizations come back in the form §12.8 names")`, a `NORMALIZED` table of `[input, expected]` pairs written out literally, one per §12.8 bullet:
  - `children: ["x"]` gives `textContent: "x"`, and `["Score: ", 42]` merges into one string;
  - `children: []`, `title: null` and `$props: {}` are dropped, and so is a `"\n"` between two root blocks;
  - root text and `li` text gain a `p`, and so does a text run beside a block in a `section`;
  - a `$switch` without `tagName` gains `div`;
  - an element-level `href` moves under `attributes`, and `attributes.id` moves to the element;
  - `tabIndex: 0` and `$props.n: 5` become strings;
  - `hidden: false` and `hidden: ""` are dropped;
  - `pre` text becomes `pre > code`.
- `describe("refusals")`: each `toThrow(/Markdown cannot express .* on /)` and names the key. The cases are `$shadow`, `style[".title"]`, `style["& .x"]`, `style["@media (min-width: 600px)"]`, `style["@font-face"]` as an array, `style["--title"]`, `className: ["a"]`, `$props: { ref: "x" }`, `attributes: { "x.y": "1" }`, `id: "a"` with `attributes.id: "b"`, a `$ref`-bound element-level `value` on an `input`, `$props.open: false`, `attributes.disabled: false` and a `svg:rect` tag. `attributes["aria-hidden"]: false` and `id: "a"` with `attributes.id: "a"` do not throw.
- `describe("no written attribute is unreadable")`: about forty candidate names (ASCII and non-ASCII letters, digits, `-x`, `_x`, `a:b`, `a.b`, `a..b`, `$x`, `@x`, `&x`, `x y`, `x(1)`, `.x`, `:x`, `#x`, `x-`, `ref`, `--title`) set as an attribute on a `div`. Each either throws or round-trips, which pins the checks to the parser rather than to a copy of it.

Extended:

- `extensions/parser/tests/jx-markdown.test.ts`, by the helper tests: "collapseDotPaths writes keyword segments unprefixed" (a nested `$ref` under `items` flattens to `items.ref`) and "--id is the $id annotation" (`jxKey` and `mdKey` both ways, and `expandDotPaths({ "--id": "x" })`).
- The §6.6 plan's `attribute-routing.test.ts`: "cases and innerText stay on the element".
- `serialize.test.ts`: the `mdToJx` and `round-trip` describes assert the transpiler's output (text children are strings, attributes routed); a case that only covered the deleted converter is deleted. "container directive inline content" keeps its phrasing cases and changes "non-inline-content tag keeps block children" only if its fixture is inline-only.
- `serialize-coverage.test.ts`:
  - `mdToJx — uncovered node types` and `mdToJx — directives` are deleted, apart from one delegation case per branch (root, non-root);
  - "directive attribute key normalization" keeps `$title` becoming `--title`, and its element-level `@`, `@--breakpoint` and `:hover` keys, which are not Jx, move to the refusal table.
- `serialize-export.test.ts`: "jxToMdast → mdastToJx preserves an Array member among siblings" stays and runs through the delegated converter.
- `scripts/ci/affected.test.ts`, in "edges package.json cannot see": "a starter page retests the parser, whose round-trip corpus reads it", "a jx-markdown spec edit retests the parser", and "a path matching two edges seeds both" (`examples/components/todo-app.md` gives `["compiler", "parser"]`, and a `packages/starters/sites/portfolio/pages/*.md` page includes `server` and `parser`). "examples retests the compiler" keeps its `.json` path and still gives `["compiler"]`.

## Specs & docs

**jx-markdown.md §12.8** (in place). Delete the marker (whatever the prerequisites left of it). The roundtrip bullet becomes:

> `mode: "roundtrip"` (default): the inverse of `transpileJxMarkdown()`. YAML frontmatter from non-children doc keys; non-markdown elements, and markdown elements carrying what their markdown form cannot, emitted as directives with collapsed dot-path attributes; the inline content of a directive outside the transpiler's phrasing set written as its label (§4.2). With the default options, `transpileJxMarkdown(serializeJxMarkdown(doc))` is `doc` except for these normalizations:
>
> - a lone text child and `textContent` are one form, adjacent text children merge, a number in text becomes a string, and an empty `children` array, `textContent` or object, a `null` value, and whitespace-only text between blocks are dropped;
> - a run of text and inline elements written directly in the document root, a list item or a block quote, or beside a block in a directive outside the phrasing set, comes back inside a `p`, the block markdown gives it;
> - a node without a `tagName`, other than a repeater, comes back as a `div`, the container every renderer gives it (spec.md §14.1);
> - a key §6.6 routes elsewhere comes back where §6.6 puts it: an element-level property as the attribute of the same name, which renders the same when the property reflects that attribute (`href`, `title`, `src`), and an `attributes` entry §6.6 keeps on the element as that property;
> - a number, or `true`, written as a directive attribute comes back as its string, so a component receives a numeric `$props` value as a string; a `hidden` that is `false` or empty, neither of which hides, is omitted;
> - a `pre` holding text comes back as `pre > code`.
>
> It is not TOTAL. What a directive cannot carry throws an error naming the element and the key, and nothing is written: a `tagName` chosen at render time (naming the candidates it saw); a tag or attribute name the directive syntax cannot spell, which includes a style block keyed by a selector (`.child`, `& li`, `[open]`, `:nth-child(2n)`) or by an at-rule other than a named media query, and a `$` key §6.2 and §6.3 do not map; a key the dot-path form cannot spell back (one holding a `.`, or a plain key §6.2 would read as a keyword, such as a `ref` prop); two keys that write the same attribute with different values; an array value; a `false` outside `hidden` and an `aria-*` attribute; and an element-level `value`, `checked` or `selected` holding a binding, which would come back as the control's default (§6.6).

The export bullet and the closing sentence are unchanged. If an Open resolves differently, the matching bullet or refusal changes with it.

**§6.3**: the table gains `--id` → `$id`, and after it: "`$id` is the identifier Studio's Element section sets; like the other two it is metadata, never an HTML attribute." **§6.6**: the element-level set the §6.6 plan writes gains `cases` (spec.md §14.1) and `innerText`. **§12.6** gains "Each `$`-keyword segment is written unprefixed (§6.2, §6.3), so the result is writable as directive attributes." §7.4, §12.4, §12.5 and §12.7 are the §7.3 plan's and do not change here.

**parser.md §5**: the roundtrip bullet becomes "**roundtrip** — YAML frontmatter (via the `yaml` package) from non-children doc keys; elements outside the allowlist (or carrying what their markdown form cannot) emit as remark directives with collapsed dot-path attributes. The inverse of `transpileJxMarkdown()`; jx-markdown.md §12.8 states what it normalizes and what it refuses." It drops "lossless for everything it can express", which the named normalizations contradict.

**Fragments** (no graduation):

- `bun run spec:change jx-markdown.md minor -m "§12.8: roundtrip serialization re-parses to the document it was given up to the normalizations it names, and refuses what no directive can carry; --id carries an element's ID annotation, cases and innerText stay on the element, and collapseDotPaths writes keyword segments unprefixed."`
- `bun run spec:change parser.md patch -m "§5 defers to jx-markdown.md §12.8 for what roundtrip serialization normalizes and refuses."`

**Graduation.** If §3.1 and §9 are already Implemented when this lands, this pull request closes jx-markdown.md's last open item. The header `**Status:**` becomes `Implemented`, and `bun run spec:bump jx-markdown.md minor -m "…"`, with the jx-markdown fragment's sentence, runs in place instead of that fragment. `plans/jx-markdown/` is deleted.

**Docs.** `docs/framework/site/jx-markdown.md` is the only page whose `spec:` cites jx-markdown.md or whose `code:` lists `transpile.ts` or `serialize.ts` (the generated reference pages aside); no page cites parser.md §5. `bun run docs:sync` also names `docs/extending/contributing/monorepo.md` for `affected.ts`: its paragraph on edges stays true when a path can match two, so it does not change. With no em dashes:

- "Attributes": the table gains a row, "`--id`" → "`$id`, the element ID Studio's Element section sets".
- "Markdown or JSON?", before "Two hard limits": "Studio saves a Markdown file so that it reopens as the same document. A few shapes come back in Markdown's own form: text typed straight into a list item returns inside a paragraph, and a number returns as text. Others have no Markdown spelling at all: a style rule keyed by a selector such as `.child` or `& li`, an at-rule such as `@media (min-width: 40em)` or `@font-face`, a list value, or a property set to `false`. Studio will not save an element carrying one, and it names the key, so keep that element in a JSON component."

## Acceptance

- `cd extensions/parser && bun test --isolate --coverage` is green with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts extensions/parser` and `bun test --isolate scripts` pass.
- From `extensions/parser`, this prints `true` and then the refusal message naming `style[".child"]`:
  `bun -e 'import { serializeJxMarkdown as s } from "./src/serialize.ts"; import { transpileJxMarkdown as t } from "./src/transpile.ts"; const d = { children: [{ tagName: "hr" }, { tagName: "img", attributes: { src: "/a.png", alt: "A" } }, { tagName: "div", children: ["plain ", { tagName: "strong", textContent: "b" }, " tail"] }] }; console.log(Bun.deepEquals(t(s(d)), d)); try { s({ children: [{ tagName: "div", style: { ".child": { color: "red" } } }] }); } catch (e) { console.log(e.message); }'`
- `grep -n "EXTRA_EDGES.find" scripts/ci/affected.ts` finds nothing, and `echo examples/components/todo-app.md | bun scripts/ci/affected.ts --stdin` names both `packages/compiler` and `extensions/parser`.
- `bun run plans:status --spec jx-markdown` no longer lists §12.8; `bun run plans:check` reports nothing for jx-markdown.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` are green.
- In Studio (the `packages/studio:verify` recipe), on a starter `.md` page:
  1. Add a `div`, type text into it and set its ID; add a list and give its item a class. Save, close and reopen: the Outline is unchanged.
  2. Add a `.child` style rule to an element and save: the save is refused with a notification naming `style[".child"]`, and the tab stays dirty.
