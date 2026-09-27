---
status: drafted
disposition: implement
claims:
  - jx-markdown.md#12.8
requires:
  - jx-markdown/directive-attribute-routing
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

Three writers depend on this being the inverse of the parser, and each already turns a thrown error into a named, non-destructive failure: a Studio save (`packages/studio/src/files/file-ops.ts`: `notify.error`, the tab stays dirty, nothing is written), a Studio format conversion (`buildPlan` in `packages/studio/src/format/convert-file.ts`: the error becomes the dialog's `blocker`), and a rename refactor (`packages/server/src/refactor/apply.ts`: an entry in the report). The refactor re-serializes every `.md` file that references a renamed file, so a loss here reaches documents the author never opened.

**Measured at 84735a9f** (the parser is unchanged since the audit's b900b326) by feeding `serializeJxMarkdown` output back through `transpileJxMarkdown`; no test suite was run. The census list was right but short. Every tracked Jx Markdown document (142 under `examples/`, `packages/create`, `packages/starters` and two test-fixture folders) is a fixed point except one, because hand-written files use the shapes the serializer handles. The losses are in what Studio, `htmlToJx` and the spec's own examples produce:

| Shape                                                                             | Written                                                                          | Comes back                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `div`, `section`, `option` or a custom element with `textContent: "hi"`           | `:::div` / `hi` / `:::`                                                          | `div > p "hi"` (a leading or trailing space survives only because it is written `&#x20;`)                                                     |
| `div > ["plain ", strong, " tail"]`                                               | three blocks                                                                     | three `p`s, the edge spaces gone                                                                                                              |
| `button > ["Go ", strong]`; a styled `td > ["a ", em]`                            | `INLINE_CONTENT_TAGS` (serializer) and `PHRASING_ELEMENTS` (transpiler) disagree | `button > ["Go", strong]`; `td > p`                                                                                                           |
| §5's example: `:::a{href="/"}` / `Home` / `:::` inside `nav`                      | `[Home](/)`                                                                      | `nav > p > a`                                                                                                                                 |
| §4.2's example (root `hr`, `input`, `img`)                                        | `***::input{type="text" placeholder="Enter name"}![A photo](/photo.jpg)`         | one `p` of literal text                                                                                                                       |
| root `[p "a", "loose", p "b"]`                                                    | `alooseb`                                                                        | one `p`                                                                                                                                       |
| `section { $shadow: "open" } > h2`, then a `p`                                    | `:::section{$shadow="open"}` …                                                   | the fence is a literal `p`, the `h2` escapes to the root, a stray `:::` `p` follows                                                           |
| `div { style: { ".title" \| "& .x" \| "@media (min-width: 600px)": {…} } }`       | `::div{style..title.color="blue"}` and so on                                     | a `p` holding the directive's source                                                                                                          |
| `p { attributes: { "data-x": "1" } }`; `h2 { attributes: { "aria-label": "x" } }` | `hi`; `## T`                                                                     | attributes dropped. `examples/components/todo-app.md`'s `::p{textContent=… color=…}` is the one tracked document that does not survive a save |
| `a` with no `href`; `img` with no `alt`                                           | `[go]()`; `![](/a.png)`                                                          | `href: ""`; `alt: ""`                                                                                                                         |
| `div { innerHTML }`; `p { innerHTML }`                                            | `::div`; nothing                                                                 | `innerHTML` dropped; the `p` is gone                                                                                                          |
| `p` or `h1` whose `children` is the §8 descriptor                                 | throws `TypeError: (e.children ?? []).map is not a function`                     | (nothing is saved)                                                                                                                            |
| `className: ["a", "b"]`; a `null` value                                           | `"a,b"`; `"null"`                                                                | strings                                                                                                                                       |
| `hidden: false`; `$props: { start: 5, open: false }`                              | `"false"`; `"5"`, `"false"`                                                      | a hidden element; a string prop and a truthy `open`                                                                                           |
| `style: { "@--dark": { ":hover": {…} } }`                                         | `style.--dark.hover.color`                                                       | a `hover` type selector, which matches nothing                                                                                                |
| `style: { "--brand": "red" }`                                                     | `style.--brand="red"`                                                            | `"@--brand": "red"`, and a hand-written `style.--brand` parses the same way                                                                   |
| `style: { ":popover-open": {…}, "::backdrop": {…} }`                              | `style.:popover-open.opacity`, `style.::backdrop.background`                     | as given (the census's clause)                                                                                                                |
| `$switch` with `cases`                                                            | `::div{switch.ref=… cases.a.tagName="p" …}`                                      | `cases` under `attributes`: the switch renders nothing                                                                                        |
| a GFM table with no `thead`, or a body row shorter than the header                | a GFM table                                                                      | the first row becomes the header; the short row gains an empty `td`                                                                           |

Three library facts decide the fix, each measured:

- mdast-util-to-markdown serializes a `root` that holds any phrasing child as phrasing, so one string or `img` among the root's children joins every sibling onto one line. A directive's body is always written as flow.
- micromark-extension-directive (`dev/lib/factory-attributes.js`, `factory-name.js`) accepts an attribute name that starts with `-`, `_` or any character that is neither whitespace nor punctuation, and continues with those plus `.` and `:`, and a directive name without `.` or `:` that does not end in `-` or `_`. Every other character (`$`, `@`, `&`, `[`, `(`, a space) ends the attribute list, so the directive line stops being a directive. `:` mid-name is fine: `style.--dark.:hover.color` parses as written.
- In a directive label, a hard break is written as a space and a code span holding `]` ends the label early. Inline HTML `<br>` and a `:code[x\]y]` text directive both survive, and `convertChildren` maps them back to `br` and `code`.

**What the two prerequisites land**, from their drafted plans:

- `plan:jx-markdown/repeater-map-template-roundtrip` (§6.5): the transpiler reads a leaf directive's label as its inline content (§4.2); `serialize.ts` gains `partToDirective` (a labelled leaf for static text or phrasing content, a bare leaf when empty, a container otherwise), `isInlineOnly`, `holdsNatively` (a list or table holding anything its markdown form cannot hold is written as directives throughout), `blockChild` and `LABEL_UNSAFE`; a bound `textContent` on any element is written `textContent.ref`. It leaves GFM's structural limits, a native list item's `li > p`, array values and `mdastToJx` to this plan.
- `plan:jx-markdown/directive-attribute-routing` (§6.6): one routing set for every element (`isElementLevelKey`), and a bare `hidden` is `true`. It names two placement normalizations for this plan to state (an element-level key outside the set comes back under `attributes`; an `attributes` key inside it comes back on the element) and leaves scalar typing here. Its set omits `cases` and `innerText`, both `ElementDef` keys (`packages/schema/schema.json`); `cases` is spec.md §14.1's.

**What else exists**

- `serializeRoundtrip`: frontmatter from every non-`children` key through `yaml`, then `jxToMdast` and remark-stringify. Frontmatter round-trips exactly, YAML-1.1-looking strings (`yes`, `on`, `2024-01-01`) included.
- `collapsePropsToAttrMap` keeps its own `CSS_PSEUDO_NAMES` (it stops at `after`), `JX_DOLLAR_KEYS` and `JX_ANNOTATION_KEYS`; strips `:` and `@` at every depth while `applyStyleKeyMapping` maps only the top level; flattens a bare `@` style key into the base (nothing in the repository writes that key); and writes every leaf as `String(value)`.
- `hasJxProps` ignores `attributes`, `textContent` and `innerHTML`, so any markdown-native tag carrying them is written natively.
- `mdastToJx` (with `MDAST_TAG_MAP`, `convertMdastNode`, `convertDirective` and `prototypeDirectiveToJx`) is exported and listed in parser.md §5, has no caller outside tests, and has drifted from `directiveToJx` (raw attributes, text children as `span`s). `serialize.test.ts` (`mdToJx`, `round-trip`), `serialize-coverage.test.ts` (`mdToJx — …`) and one `serialize-export.test.ts` case run through it.
- `serialize-tagname-expression.test.ts` pins the render-time `tagName` refusal, whose message shape (`Markdown cannot express … Keep this element in a JSON component.`) the new refusals copy.

**Related.** jx-markdown.md §4.2, §6.1, §6.6, §7.3, §7.4, §8, §12.5–§12.7; parser.md §5; spec.md §8.3 (boolean attributes), §9.2 (nesting in either order), §14.1 (`cases`, the `div` container); studio.md §8.1 (the save path).

## Outcome

- jx-markdown.md §12.8 → Implemented. The marker is removed; the roundtrip bullet states the inverse, the normalizations it makes (each rendering the same) and the refusals, and `extensions/parser/tests/roundtrip-corpus.test.ts` proves all three at the string level.
- jx-markdown.md §7.4 and §12.5–§12.7 describe style-key mapping at every depth and a `--` key holding a value as a custom property; §6.6's element-level set gains `cases` and `innerText`. parser.md §5 defers to §12.8.
- If §3.1, §7.3 and §9 are already Implemented when this lands, this pull request graduates jx-markdown.md.

## Decisions

- **Decided:** one plan that requires the §6.5 and §6.6 plans, not an enabling split for the corruption fixes, because both prerequisites have no `requires` of their own, so this waits one wave at most, and the §6.5 plan's writer (`partToDirective`, `holdsNatively`, labels) is the mechanism most fixes here extend. No edge to `plan:jx-markdown/pseudo-element-names`: the serializer reads the transpiler's name sets through `collapseStylePaths`, so `:placeholder` and `::placeholder` each round-trip before and after that plan moves the names. No edge to `plan:spec/static-dom-property-emission`: nothing here reads a property table, and the §6.6 plan already declined that edge.
- **Decided:** a directive outside `PHRASING_ELEMENTS` whose content is static text or inline-only is written as the §6.5 plan's labelled leaf (`::div[plain **b** tail]`), and a phrasing directive keeps today's container-and-paragraph form. A transpiler rule unwrapping a lone paragraph would re-read every hand-written `:::section` / text / `:::` and every docs callout as `textContent`, while leaf labels are new syntax; keeping the phrasing form means no saved file churns. The serializer imports `PHRASING_ELEMENTS` and `INLINE_CONTENT_TAGS` is deleted, since the two sets disagreeing is itself a loss.
- **Decided:** in a flow position (the document root, a directive body holding blocks), a run of inline siblings that contains text is written as one paragraph, and an inline element with no text beside it is written as a block directive (`::img{src="…" alt="…"}`, `::a[Home]{href="/"}`) that re-parses as itself. The root must never hold a phrasing node, and a lone `img` or `a` is what §4.2, §5 and an HTML `<img>` line produce.
- **Decided:** style keys are mapped and collapsed at every depth, for keys holding a block: a recognized pseudo name gains `:` or `::`, and a `--` name gains `@`. A `--` key holding a value is a custom property and keeps its name, in both directions. spec.md §9.2 nests media and selectors in either order, and today `style.--dark.hover` yields a type selector that matches nothing, which is the failure §7.3 exists to prevent. The serializer's own sets and its bare-`@` branch go; `collapseDotPaths` writes every `$`-keyword segment through `mdKey`, so its output is always writable.
- **Open:** what roundtrip does with a name or value no directive can carry. Recommendation: throw before anything is written, naming the element and the key, as the render-time `tagName` refusal does. The cases are a tag or attribute name outside the grammar above (a style block keyed by a selector such as `.child`, `& li`, `[open]` or `:nth-child(2n)`, an at-rule other than a named media query, a `$` key §6.2 does not map) and an array. Every caller already reports a throw without writing, and today's output does not parse, so the next save escapes it into literal text and the loss is permanent. The alternatives each add format surface: a JSON-valued attribute, or hoisting the block into frontmatter `style` under a generated selector. A Studio style panel that offers a Markdown document only what it can hold is a studio.md follow-up, not this plan's.
- **Open:** a directive attribute value is a string, so what becomes of a number or a boolean? Recommendation: keep it where its string reads back the same, and refuse it where it does not.
  - `hidden: true` is written with an empty value (`hidden=""`), which §6.6 reads back as `true`; `hidden: false`, the DOM default, is omitted.
  - A number, or `true` anywhere else, is written as its string and named in §12.8 as a normalization. `setAttribute`, CSS and a truthiness test read the string as the value; a numeric `$props` value does arrive as a string.
  - Any other `false` is refused, except in an `aria-*` attribute, whose `"false"` spec.md §8.3 emits anyway, because `"false"` is truthy and a presence attribute written `"false"` is present.

  Studio's property and attribute rows write `true`, `""` or delete the key and never write `false` (`packages/studio/src/panels/properties-panel.ts`), so the refusal cannot fire on a Studio edit. A typed attribute syntax is the alternative, and it is new format surface for a case Studio does not produce.

- **Open:** text or inline elements directly in a native list item or block quote. Recommendation: a named normalization, written as today (`- a`, `> q`) and coming back inside a `p`, the block markdown gives both. The exact form would write every list Studio types into as `:::ul` / `::li[a]`, which defeats the format for the content it exists for. Whether a tight list item should parse without its `p`, as CommonMark renders it, is §9's mapping question (`plan:jx-markdown/commonmark-coverage`), not this plan's.
- **Open:** keep or delete `mdastToJx`. Recommendation: keep the export and make it a wrapper over the transpiler's `convertChildren` and `mdastNodeToJx`, deleting its private converter. parser.md §5 documents it, and deleting a documented export of `@jxsuite/parser` 1.x is a major release for no user gain; the wrapper turns every mdast-level test into a test of the production converter. Its output changes (text children become strings, directive attributes are routed), which is the fix, and nothing in the repository calls it.

## Implementation

1. **`extensions/parser/src/transpile.ts`**
   - Export `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES`.
   - `applyStyleKeyMapping(styleObj)`: recurse into every value that is a plain object. At each level a key holding an object is renamed (a `CSS_PSEUDO_ELEMENTS` name to `::name`, a `CSS_PSEUDO_NAMES` name to `:name`, a `--name` to `@--name`); a key holding anything else keeps its name, so `--brand: "red"` stays a custom property.
   - `collapseStylePaths(styleObj)`: the same walk inverted (`::` checked before `:`, as today), then `collapseDotPaths`.
   - `collapseDotPaths(obj)`: pass each path segment through `mdKey`.
   - After §6.6 lands: its `ELEMENT_LEVEL_KEYS` gains `cases` and `innerText`.
   - Doc comments cite jx-markdown.md §7.4 and §12.5–§12.7.
2. **`extensions/parser/src/serialize.ts`**, roundtrip half (export mode's `nodeToMdast` is untouched):
   - Import `collapseDotPaths`, `collapseStylePaths`, `mdKey`, `convertChildren`, `mdastNodeToJx`, `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES` from `./transpile.ts`. Delete `INLINE_CONTENT_TAGS`, `CSS_PSEUDO_NAMES`, `JX_DOLLAR_KEYS`, `JX_ANNOTATION_KEYS`, the local `PROTOTYPE_DIRECTIVE_NAMES` and `collapsePropsToAttrMap`.
   - `refuse(tag, what, why): never` throws `` `Markdown cannot express ${what} on ${tag} (${why}). Keep this element in a JSON component.` ``, the shape `serializableTag` uses.
   - `ATTRIBUTE_NAME = /^(?:[-_]|[^\s\p{P}\p{S}])(?:[-_:]|[^\s\p{P}\p{S}])*(?:\.(?:[-_:]|[^\s\p{P}\p{S}])+)*$/u` and `DIRECTIVE_NAME = /^[^\s\p{P}\p{S}](?:[-_]|[^\s\p{P}\p{S}])*(?<![-_])$/u`, with a comment naming the two micromark files they mirror. Every directive name written (`convertToDirective`, `partToDirective`, `prototypeToDirective`) is checked against `DIRECTIVE_NAME`.
   - `directiveAttributes(tag, props, attributes)` replaces `collapsePropsToAttrMap` and the tail of `collectDirectiveAttrs`; `prototypeToDirective` calls it too. Element keys first, then `attributes`, as today. Per entry:
     - a `null` or `undefined` value is skipped;
     - `hidden` is written `""` when `true` and skipped when `false`;
     - any other `false` is refused unless the name starts with `aria-`;
     - an array is refused, anywhere in the value;
     - `style` goes through `collapseStylePaths`, any other object through `collapseDotPaths`, each result key prefixed with its path;
     - a number or `true` becomes its string;
     - every final name failing `ATTRIBUTE_NAME` is refused, naming the original key (`style[".title"]`, `$shadow`).
   - `needsDirective(el, tag)` replaces `hasJxProps` and keeps the §6.5 plan's bound-`textContent` test. It is also `true` when:
     - `innerHTML` is set;
     - `children` is present and not an array;
     - `attributes` holds anything the tag's markdown form does not write back as a string. `NATIVE_ATTRIBUTES` allows `a`: `href` (required) and `title`; `img`: `src` and `alt` (both required) and `title`; `ol`: `start`, an integer string other than `"1"`; every other native tag: none.

     `convertJxNode`'s directive test and the §6.5 plan's `holdsNatively` both call it.

   - `convertToDirective`, block form, tag outside `PHRASING_ELEMENTS`: static text or `isInlineOnly` children go through `partToDirective`'s labelled-leaf path (generalized from parts to any tag); otherwise a container whose body is `flowChildren(children, true)`. A phrasing tag keeps today's branch.
   - `flowChildren(children, directiveBody)`, used by `jxToMdast` for the root and by every directive container body (`convertToDirective`, `partToDirective`, `prototypeToDirective` through `blockChild`). A string, a number and a natively written `MD_INLINE` element are inline. A maximal run of inline siblings containing a string or number becomes one `paragraph`. An inline element in a run with no text is written through `partToDirective` as a block directive. Every other child goes through `blockChild`. The native `blockquote` and `listItem` helpers (`block()` in `convertJxNode`) group their inline runs into one paragraph whatever they hold, per the list-item Open.
   - `labelSafe(nodes)`, applied to every label the leaf path writes: a `break` becomes `{ type: "html", value: "<br>" }`, and an `inlineCode` whose value contains `[` or `]` becomes a `textDirective` named `code` holding that text.
   - `holdsNatively` (the §6.5 plan's), for `table`: also `false` unless the table is GFM's shape: a `thead` holding one `tr` of `th` cells first, then at most one `tbody` of `tr`s of `td` cells, every row with the header's cell count, and every cell's content inline-only.
   - `mdastToJx(node)`: a `root` returns `{ children: convertChildren(node.children ?? []) }`; any other node returns `mdastNodeToJx(node)`. Delete `MDAST_TAG_MAP`, `convertMdastNode`, `convertDirective` and the local `prototypeDirectiveToJx`. The JSDoc says it is the transpiler's own tree walk.
   - The module header and `jxToMdast`'s comment describe the inverse, the normalizations and the refusals, citing jx-markdown.md §12.8.
3. **`scripts/ci/affected.ts`**: an `EXTRA_EDGES` entry with patterns `examples/**/*.md`, `packages/create/template/**/*.md`, `packages/create/templates/**/*.md`, `packages/starters/sites/**/*.md` and `specs/jx-markdown.md`, seed `extensions/parser`, evidence `extensions/parser/tests/roundtrip-corpus.test.ts`, and a `why` saying the corpus reads those documents and the spec's examples while those workspaces depend on the parser, never the reverse.
4. On landing, delete this file. If this pull request graduates the spec, delete `plans/jx-markdown/` with it.

**Integration contract.** Once this lands:

- `transpileJxMarkdown(serializeJxMarkdown(doc))` equals `doc` up to the normalizations §12.8 lists, or `serializeJxMarkdown` throws an `Error` whose message begins `Markdown cannot express` and names the element and the key.
- `@jxsuite/parser/transpile` exports `PHRASING_ELEMENTS` and `PROTOTYPE_DIRECTIVE_NAMES`. `applyStyleKeyMapping` and `collapseStylePaths` work at every depth, and `collapseDotPaths` output is always writable as directive attributes.
- `mdastToJx` is the transpiler's converter.
- `extensions/parser/tests/roundtrip-corpus.test.ts` holds the shape tables and the fixed-point corpus that any later change to the format extends.

## Tests

From `extensions/parser`: `bun test --isolate --coverage`, then `bun scripts/check-coverage-manifest.ts extensions/parser` from the root. No source file is added. `extensions/parser/bunfig.toml` holds `lines = 0.987, functions = 0.975` per file. Deleting `mdastToJx`'s private converter removes code only the mdast-level tests reached, and every new function is reached by the cases below. If `serialize.ts` or `transpile.ts` ends above the workspace's current worst file, ratchet the threshold to just below the new minimum. The scripts suite (`bun test --isolate scripts`) covers the edge.

New `extensions/parser/tests/roundtrip-corpus.test.ts`, with `roundTrip = (doc) => transpileJxMarkdown(serializeJxMarkdown(doc))`:

- `describe("tracked documents are fixed points")`: one test per file under the four globs of step 3, skipping any path with a `node_modules` segment. Each asserts `transpileJxMarkdown(serializeJxMarkdown(parsed))` `toEqual` `parsed`. A guard test asserts each of `examples/`, `packages/create` and `packages/starters` contributed files, so a moved directory cannot empty the corpus.
- `describe("the spec's examples are fixed points")`: every `markdown` fence in `specs/jx-markdown.md`, the same assertion. §4.2's and §5's examples fail today.
- `describe("shapes come back as written")`, an `EXACT` table asserting `roundTrip(doc)` `toEqual(doc)`:
  - static text on `div`, `section`, `option` and `my-card`, including edge spaces, a line break, brackets and markdown punctuation;
  - inline-only children with a `br`, a code span holding `]`, and a classed `span`;
  - `button > ["Go ", strong]` and a styled `td > ["a ", em]` in a directive table;
  - `nav > a`; a root `[hr, input, img]`; a root `img` beside a `p`;
  - native `p` and `h2` carrying `data-*` and `aria-*` attributes; `a` without `href`; `img` without `alt`;
  - `innerHTML` on `div` and `p`; a `p` with the §8 descriptor;
  - every §7.3 name, `::backdrop`, `"@--dark": { ":hover" }`, `":hover": { "@--sm" }`, a `--brand` custom property and a bound style value;
  - `$switch` with `cases` and a `tagName`; `hidden: true`;
  - `$props` string, `$ref` and nested values; `--title` and `--description`;
  - a table without `thead` and one with a short row (both written as directives);
  - frontmatter holding `yes`, `on`, `2024-01-01` and `null`.
- `describe("normalizations come back in the form §12.8 names")`, a `NORMALIZED` table of `[input, expected]` pairs written out literally, one per §12.8 bullet:
  - `children: ["x"]` gives `textContent: "x"`, and `["Score: ", 42]` merges into one string;
  - `children: []` is dropped;
  - root text and `li` text gain a `p`, and so does a text run beside a block in a `section`;
  - a `$switch` without `tagName` gains `div`;
  - an element-level `href` moves under `attributes`, and `attributes.id` moves to the element;
  - `tabIndex: 0` and `$props.n: 5` become strings;
  - `hidden: false` is dropped;
  - `pre` text becomes `pre > code`.
- `describe("refusals")`: each `toThrow(/Markdown cannot express .* on /)` naming the key. The cases are `$shadow`, `style[".title"]`, `style["& .x"]`, `style["@media (min-width: 600px)"]`, `style["@font-face"]` as an array, `className: ["a"]`, `$props.open: false`, `attributes.disabled: false` and a `svg:rect` tag. `attributes["aria-hidden"]: false` does not throw.
- `describe("no written attribute is unreadable")`: about forty candidate names (ASCII and non-ASCII letters, digits, `-x`, `_x`, `a:b`, `a.b`, `a..b`, `$x`, `@x`, `&x`, `x y`, `x(1)`, `.x`, `:x`, `#x`, `x-`) set as an attribute on a `div`. Each either throws or round-trips, which pins `ATTRIBUTE_NAME` to the parser rather than to a copy of it.

Extended:

- `extensions/parser/tests/jx-markdown.test.ts`, by the helper tests: "applyStyleKeyMapping maps pseudo and media names at every depth", "a -- key holding a value is a custom property", "collapseStylePaths inverts at every depth", and "collapseDotPaths writes keyword segments unprefixed" (a nested `$ref` under `items` flattens to `items.ref`).
- The §6.6 plan's `attribute-routing.test.ts`: "cases and innerText stay on the element".
- `serialize.test.ts`: the `mdToJx` and `round-trip` describes assert the transpiler's output (text children are strings, attributes routed); a case that only covered the deleted converter is deleted.
- `serialize-coverage.test.ts`:
  - `mdToJx — uncovered node types` and `mdToJx — directives` are deleted, apart from one delegation case per branch (root, non-root);
  - "directive attribute key normalization" keeps `$title` becoming `--title`, and its element-level `@`, `@--breakpoint` and `:hover` keys, which are not Jx, move to the refusal table.
- `serialize-export.test.ts`: "jxToMdast → mdastToJx preserves an Array member among siblings" stays and runs through the delegated converter.
- `scripts/ci/affected.test.ts`: "a starter page retests the parser, whose round-trip corpus reads it" and "a jx-markdown spec edit retests the parser".

## Specs & docs

**jx-markdown.md §12.8** (in place). Delete the marker (whatever the prerequisites left of it). The roundtrip bullet becomes:

> `mode: "roundtrip"` (default): the inverse of `transpileJxMarkdown()`. YAML frontmatter from non-children doc keys; non-markdown elements emitted as directives with collapsed dot-path attributes; the inline content of a directive outside the transpiler's phrasing set written as its label (§4.2). `transpileJxMarkdown(serializeJxMarkdown(doc))` is `doc` except for these normalizations, each of which renders the same:
>
> - a lone text child and `textContent` are one form, adjacent text children merge, a number in text becomes a string, and an empty `children` array or `textContent` is dropped;
> - text written directly in the document root, a list item or a block quote, or beside a block in a directive, comes back inside a `p`, the block markdown gives it;
> - a node without a `tagName`, other than a repeater, comes back as a `div`, the container every renderer gives it (spec.md §14.1);
> - a key §6.6 routes elsewhere comes back where §6.6 puts it;
> - a number, or `true`, written as a directive attribute comes back as its string, a `$props` value included; `hidden: false`, the default, is omitted;
> - a `pre` holding text comes back as `pre > code`.
>
> It is not TOTAL. What a directive cannot carry throws an error naming the element and the key, and nothing is written: a `tagName` chosen at render time (naming the candidates it saw); a tag or attribute name the directive syntax cannot spell, which includes a style block keyed by a selector (`.child`, `& li`, `[open]`, `:nth-child(2n)`) or by an at-rule other than a named media query, and a `$` key §6.2 does not map; an array value; and a `false` outside `hidden` and an `aria-*` attribute.

The export bullet and the closing sentence are unchanged. If the list-item or scalar Open resolves differently, the matching bullet changes with it.

**jx-markdown.md §7.4** gains: "A `--` key holding a nested block is a media query; one holding a value is a CSS custom property and keeps its name (`style.--brand="#0af"`). Pseudo-class, pseudo-element and media names are mapped at every depth, so `style.--dark.hover.color` is `:hover` inside the dark-scheme query and `style.hover.--dark.color` the query inside the hover rule, the two orders spec.md §9.2 allows." The example gains `style.--brand="#0af"`.

**§12.5** becomes "Maps the keys of a style object that hold a nested block, at every depth: pseudo-class names get the `:` prefix, pseudo-element names `::`, and `--` names `@`. A `--` key holding a value is a custom property and is left alone (§7.4)." **§12.6** gains "Each `$`-keyword segment is written unprefixed (§6.2), so the result is writable as directive attributes." **§12.7** gains "at every depth" after "strips". **§6.6**: the element-level set the §6.6 plan writes gains `cases` (spec.md §14.1) and `innerText`.

**parser.md §5**: the roundtrip bullet's last two sentences ("Inverse of … naming the candidates it saw.") become "The inverse of `transpileJxMarkdown()`; jx-markdown.md §12.8 states what it normalizes and what it refuses."

**Fragments** (no graduation):

- `bun run spec:change jx-markdown.md minor -m "§12.8: roundtrip serialization re-parses to the document it was given up to the normalizations it names, and refuses what no directive can carry; style keys map at every depth and a -- key holding a value is a custom property; cases and innerText stay on the element."`
- `bun run spec:change parser.md patch -m "§5 defers to jx-markdown.md §12.8 for what roundtrip serialization normalizes and refuses."`

**Graduation.** If §3.1, §7.3 and §9 are already Implemented when this lands, this pull request closes jx-markdown.md's last open item. The header `**Status:**` becomes `Implemented`, and `bun run spec:bump jx-markdown.md minor -m "…"`, with the jx-markdown fragment's sentence, runs in place instead of that fragment. `plans/jx-markdown/` is deleted.

**Docs.** `docs/framework/site/jx-markdown.md` is the only page whose `spec:` cites jx-markdown.md or whose `code:` lists `transpile.ts` or `serialize.ts` (the generated reference pages aside). No other page changes. With no em dashes:

- "Style attributes", after the paragraph on recognised names: "A `--` key holding a value is a CSS custom property rather than a media query, so `style.--brand="#0af"` sets `--brand`. Both prefixes are restored at any depth: `style.--dark.hover.color` styles hover inside the dark scheme."
- "Markdown or JSON?", before "Two hard limits": "Studio saves a Markdown file so that it reopens as the same document. A few shapes come back in Markdown's own form: text typed straight into a list item returns inside a paragraph, and a number returns as text. Others have no Markdown spelling at all: a style rule keyed by a selector such as `.child` or `& li`, an at-rule such as `@media (min-width: 40em)` or `@font-face`, a list value, or a property set to `false`. Studio will not save an element carrying one, and it names the key, so keep that element in a JSON component."

## Acceptance

- `cd extensions/parser && bun test --isolate --coverage` is green with no per-file threshold failure; `bun scripts/check-coverage-manifest.ts extensions/parser` and `bun test --isolate scripts` pass.
- From `extensions/parser`, this prints `true` and then the refusal message naming `$shadow`:
  `bun -e 'import { serializeJxMarkdown as s } from "./src/serialize.ts"; import { transpileJxMarkdown as t } from "./src/transpile.ts"; const d = { children: [{ tagName: "hr" }, { tagName: "img", attributes: { src: "/a.png", alt: "A" } }, { tagName: "div", children: ["plain ", { tagName: "strong", textContent: "b" }, " tail"] }] }; console.log(Bun.deepEquals(t(s(d)), d)); try { s({ children: [{ tagName: "section", $shadow: "open" }] }); } catch (e) { console.log(e.message); }'`
- `bun run plans:status --spec jx-markdown` no longer lists §12.8; `bun run plans:check` reports nothing for jx-markdown.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` are green.
- In Studio (the `packages/studio:verify` recipe), on a starter `.md` page:
  1. Add a `div`, type text into it, and give a list item a class. Save, close and reopen: the Outline is unchanged.
  2. Add a `.child` style rule to an element and save: the save is refused with a notification naming `style[".child"]`, and the tab stays dirty.
