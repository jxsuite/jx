---
status: drafted
disposition: implement
claims:
  - ui.md#5.4
requires: []
workspaces:
  - packages/ui
  - packages/studio
  - specs
  - docs
size: M
---

# `jx-table` ships as §3.5's CSS-table shape, and Studio's three tables are drawn with it

## Context

`specs/ui.md` §5.4, line 255:

> **Status: Partial.** `jx-tabs`, `jx-tab`, `jx-tab-panel`, `jx-accordion-item` and `jx-action-group` are built, … `jx-accordion` is an element too (below). `jx-table` is not built, and §3.5 records the shape it must take, along with the shape it must never take. Three Studio surfaces draw a table of their own in its absence: `packages/studio/src/surfaces/panel-i18n.json` and `surfaces/settings-packages.json` as a native `<table>` and `surfaces/library-pane.json` as a `role="table"` grid of divs.

**The contract** is ui.md §3.5's first shape: `jx-table` is `display: table` with `role="table"`, `jx-tr` is `display: table-row` with `role="row"`, and `jx-th`/`jx-td` are `display: table-cell` with `role="columnheader"`/`role="cell"`. Wrapping a native `<table>` is forbidden. §3.1 decides a box's kind by how many definitions draw it, and three surfaces draw this one.

**The three tables** (verified; none writes a class):

- `surfaces/settings-packages.json` line 317: `table part="table"` > `thead` > `tr` of four `th scope="col" part="column"` (the last holds a visually hidden "Actions"), then `tbody part="rows"` of a mapped `tr part="row" data-package` with `td` parts `name-cell`, `current`, `latest` and `row-actions`. The section's style `$description` says the native table replaced `sp-table` because a table "is the one thing on this surface the kit has no element for". The header is weight 500 with `4px 8px` padding.
- `surfaces/panel-i18n.json` line 378: `table part="parity"`, styled `display: block; overflowX: auto` so it scrolls sideways in the Navigator. The head row maps a `th scope="col" part="locale-head"` per locale. Each body row is headed by a **row header** (`th scope="row" part="key"`), which §3.5's shape has no role for. The body is capped at `PARITY_ROW_LIMIT` (200, `panels/i18n-panel.ts:115`) rows, with a `truncated` line. The header is weight 700, uppercase, `2px 6px`.
- `surfaces/library-pane.json` lines 1099 to 1230 (the `table` case of `view`): a flex-column `div part="table" role="table"`. Its children are a sticky head `div part="table-head" role="row"` of `role="columnheader"` cells, a `pad` spacer (`${state.padTop}`), the mapped `div part="table-row" role="row"` (with `onclick` and `oncontextmenu`) of `role="cell"` cells, and a second spacer. Column widths are flex values keyed on `data-field`. The window comes from `computeWindow` (`src/ui/virtual-window.ts`) at `LAYOUT_METRICS.table.rowHeight` 32 (`browse/library-layouts.ts`). The table exposes only its slice: it has no `aria-rowcount` or `aria-rowindex`, so a 2,000-file project reads as a table of about 26 rows. Its style `$description` gives the reason it is not a component: "the rows have to be sliceable, and every table widget wants the whole set".

**What makes the shape work in this runtime.** A `<slot>` unwraps and leaves no node (`distributeSlots` in `packages/runtime/src/runtime.ts`). A mapped array leaves only a comment anchor (`renderMappedArrayInto`, `document.createComment("jx-array")`). So rows written or mapped inside a `jx-table` are its direct children, and a slice of rows is still a table.

**Tests address the tables by `part`, not by tag**: `tests/dependencies-editor.test.ts` (`row()`, `cell()`, `listed()`), `tests/i18n-panel.test.ts` (`parts(host, "row")`, `part(host, "parity")` identity at lines 711 to 728) and `tests/library-perf.test.ts` (`[part="table-row"]` counts). `mountSurface` (`src/ui/surface.ts`) awaits `kitReady()`, so surface tests render real kit elements. `packages/schema/src/a11y.ts` has no rule about table roles.

## Outcome

- ui.md §5.4 → Implemented. `jx-table`, `jx-tr`, `jx-th` and `jx-td` ship under `packages/ui/components/`, each with a stylebook page, under the conformance test and a new `tests/table.test.ts`. They share one catalogue row, and Studio's three tables are drawn with them (two if the Open decision's guard keeps the Languages panel native, which the marker then says).
- Ride-alongs in ui.md: the §3.5 bullet names `rowheader`; the §5 and §10 markers stop listing §5.4; the §11 WAI-ARIA row lists **table** as built. `gap:ui-aria` stays open for the select-only combobox, so this plan closes no gap.

## Decisions

- **Decided:** exactly the four elements §3.5 names. Each has one default `slot`, and none has parts, named slots, events or a behaviour sidecar. The unwrapping slot is what makes a row its table's direct child. No consumer needs a row-group element (`jx-thead`/`jx-tbody`): the head row is the first `jx-tr`, and ARIA's `table` owns `row` directly.
- **Decided:** `jx-th` takes `scope`, `"col"` by default or `"row"`, and writes `columnheader` or `rowheader`. The Languages panel heads each row with its key, and dropping that would lose the header a screen reader announces when moving along a row. The name is the native `th` attribute's, and it is an observed attribute as well as a prop, so `scope="row"` written as an attribute works too (the runtime reads an attribute into state only when the definition observes it).
- **Decided:** a windowed table states the set it slices. `jx-table` takes `rowcount` and `jx-tr` takes `rowindex`, both numbers where 0 writes nothing, and they become `aria-rowcount` and `aria-rowindex`. WAI-ARIA answers a partly rendered table with exactly these two, as the tree answers a partly rendered tree with `aria-posinset`/`aria-setsize` (ui.md §5.5). The element prints what it is given (§2 principle 4), and the host does the counting, header row included. Only the Library sets them. The Languages panel caps its rows and says so in its `truncated` line; it does not window them.
- **Decided:** `jx-table` takes `label` and writes it as `aria-label`, writing nothing when the label is empty. Each Studio table is given a name.
- **Decided:** no spanning and no keyboard. A CSS table cell cannot span, so a table that needs `colspan` or `rowspan` takes §3.5's second shape: a native `<table>` with kit elements inside its cells. `jx-table` is the static table pattern, not the APG grid, so it has no tab stop and no sidecar. A row a host makes clickable (the Library's) keeps its handlers at the usage site, as it does today.
- **Decided:** each element owns the look of its own box (§3.1):
  - `jx-table`: `border-collapse: separate` with `border-spacing: 0`, `width: 100%`, and the sans font, `--jx-text-md` and `--jx-fg`. Separate rather than collapsed because every cell draws only its block-end hairline, so nothing is doubled and the two models look the same, while a collapsed border is painted as part of the table's grid and is not guaranteed to travel with a sticky cell (WebKit and Gecko), which the Library's pinned header needs.
  - `jx-th` and `jx-td`: padding `var(--jx-space-2) var(--jx-space-3)` (4px 8px), `vertical-align: middle`, and a `1px solid var(--jx-border)` hairline on the block end.
  - `jx-th` also: `text-align: start`, weight 600, `--jx-fg-dim`, `nowrap`.
  - Consumers keep row hover, cursor, stickiness and column widths. Only the consumer knows whether a row responds, and widths belong to columns, not to the kit.
- **Open:** do the two native tables adopt the kit too, or only the Library? Recommendation: all three, taking the kit's header and cell look. Packages loses its weight-500 header. Languages loses its uppercase `2px 6px` header, and its body cells go from `2px 6px` with no rule between rows to the kit's `4px 8px` and hairline, so the Navigator's grid grows by about 5px a row. §3.1 decides the kind by how many definitions draw the box, and a panel that kept its own header would bring back the three-way drift the element exists to end. The screenshots lane records the visible change. One guard, because the Languages panel draws up to 200 rows times every locale as cells, about a thousand element instances where a native table drew none: the pull request logs the panel's first render at `PARITY_ROW_LIMIT` rows and four locales, before and after (Tests says how). If the kit table is more than twice as slow, that panel keeps its native `<table>`, which §3.5 does not forbid (it forbids only a kit element wrapping one), and the §5.4 marker names it as the one consumer that does and says why.

## Implementation

**`packages/ui`**

1. `components/jx-table.json` (`$id` `JxTable`):
   - `observedAttributes`: `["label", "rowcount"]`.
   - State `label`: string, default `""`, `attribute: "label"`.
   - State `rowcount`: number, default `0`, `attribute: "rowcount"`. Its description says it counts the whole set including the header row, and that 0 writes nothing.
   - Attributes: `"role": "table"`, `"aria-label": "${state.label || null}"` (the kit's label idiom), `"aria-rowcount": "${state.rowcount > 0 ? state.rowcount : null}"` (the form `jx-tree-item.json` writes `aria-posinset` in).
   - Style: `display: table`, `"&[hidden]": { "display": "none" }`, `boxSizing: border-box`, `width: 100%`, `borderCollapse: separate`, `borderSpacing: 0`, `fontFamily: var(--jx-font-sans)`, `fontSize: var(--jx-text-md)`, `lineHeight: var(--jx-leading-md)`, `color: var(--jx-fg)`.
   - Children: `[{ "tagName": "slot" }]`.
2. `components/jx-tr.json` (`JxTr`):
   - `observedAttributes`: `["rowindex"]`. State `rowindex`: number, default `0`, `attribute: "rowindex"`.
   - Attributes: `role: "row"` and `aria-rowindex`, written in the same null-writing form.
   - Style: `display: table-row` and the hidden rule. One slot.
3. `components/jx-th.json` (`JxTh`):
   - `observedAttributes`: `["scope"]`. State `scope`: string, default `"col"`, `attribute: "scope"`.
   - Attributes: `"role": "${state.scope === 'row' ? 'rowheader' : 'columnheader'}"`.
   - Style: `display: table-cell`, the hidden rule, and the cell and header declarations in Decisions. One slot.
4. `components/jx-td.json` (`JxTd`): `role: "cell"`; `display: table-cell`, the hidden rule, and the cell declarations. One slot.
5. Every state entry's `description` gives its reason. The conformance case "documents every prop" requires one.
6. `src/documents.ts`: import the four and add them to `documents` after `jx-accordion`. They have no `$elements` between them, so the order only groups them. `KIT_TAGS` picks them up, and so do `check-surface-purity.ts` and `check-icons.ts`.
7. `stylebook/jx-table.json`, `jx-tr.json`, `jx-th.json` and `jx-td.json`, in the shape of `stylebook/jx-divider.json`: a `main` page with `$elements` refs to the four elements, one sentence on what that element owns, and a small packages-style table whose first column is a `scope="row"` header. The `jx-table` page adds a three-row slice of a 40-row set carrying `rowcount` and `rowindex`.

**`packages/studio/src`**

8. `surfaces/settings-packages.json`:
   - The `listed` case becomes `jx-table part="table"` with `$props.label` `"Packages"`.
   - `thead` and `tbody` go; their rows move up into the table: the head `jx-tr` first, then the mapped array. Nothing reads `part="rows"`.
   - `tr` becomes `jx-tr` and keeps `part="row"` and `data-package`. Each `th` becomes `jx-th part="column"`; `scope` is dropped, because `col` is the default. Each `td` becomes `jx-td` and keeps its part.
   - Delete the `& [part="table"]` and `& [part="column"]` rules and the four-cell rule, whose declarations are now the kit's. Keep `name-cell`'s `overflowWrap`, the monospace `current`/`latest` rule, `actions` and `hidden-label`.
   - Rewrite the style `$description`'s table sentence: the table is the kit's `jx-table`, so columns are announced as columns and a row as a row.
9. `surfaces/panel-i18n.json`:
   - The grid's `true` case becomes `div part="parity-scroll"` around `jx-table part="parity"`, with `$props.label` `"Translations by page"`. The `& [part="parity"]` rule becomes `& [part="parity-scroll"] { overflowX: auto }` and keeps its `$description`.
   - The rows move out of `thead`/`tbody`. The locale and key column heads become `jx-th`. The key cell becomes `jx-th part="key"` with `$props.scope` `"row"`, keeping its `title`. Each `td part="cell"` becomes `jx-td part="cell"`.
   - Style: delete the `key-head`/`locale-head` rule. Drop the `textTransform` and `letterSpacing` resets from `default-mark`, because they undid an uppercase that is gone. `key` keeps its width, ellipsis and monospace, keeps `fontWeight: 400` and `color: var(--fg)` (a row header drawn as data), and drops its padding and `textAlign`. `cell` keeps `textAlign: center` and drops its padding. `row:hover` stays.
10. `surfaces/library-pane.json`, the `table` case:
    - Structure:
      - `div part="table-window"` with `"style": "${state.pad}"`, the inline padding the Cards and Media grids already use, holding `jx-table part="table"`. The table's `$props` are `label: "Files"` and `rowcount: { "$ref": "#/state/rowCount" }`.
      - The head row is `jx-tr part="table-head"` with `rowindex: 1`, holding mapped `jx-th part="cell" data-field` cells.
      - The body is the mapped `jx-tr part="table-row"`, with `rowindex: { "$ref": "$map/item/rowIndex" }` and its `data-path`, `onclick` and `oncontextmenu` unchanged, holding `jx-td part="cell" data-field` cells.
      - Both `pad` divs go, so nothing stands between the table and its rows.
    - Style, the table and its rows:
      - `& [part="table-window"]` takes the old gutter as `padding-inline: var(--jx-space-5)` and `marginBlockEnd: var(--jx-space-5)`, because the inline pad owns the block padding.
      - `& [part="table"]` becomes `tableLayout: fixed`. Its `$description` becomes: the rows are the window, a `jx-table`'s rows are its own children so a slice of them is still a table, and `rowcount`/`rowindex` tell a reader where the slice sits.
      - The row rule keeps only `height: 32px`, which must match `LAYOUT_METRICS`. It must lose `display: flex`, `alignItems` and `gap`: a surface rule outranks the kit's `display: table-row`, so a leftover `display` breaks the table. The row border goes to the kit's cells.
      - The head row's sticky `position`, `top`, `zIndex` and `background` move to `& [part="table-head"] > [part="cell"]`. A sticky table cell works in every engine Electrobun can use, and a sticky table row cannot be assumed to.
    - Style, the cells:
      - `cell` drops `flex` and `minWidth` and keeps the ellipsis.
      - Widths go on `data-field`: `name` and `path` 26%, `size` and `modified` 10%, `locale` 9%. `category` and `type` share the remaining 19%. These percentages give today's pixel widths at a 968px table and, like flex, never overflow. The `locale` `$description` is reworded to match.
    - If `plan:site-architecture/library-collection-views` has landed first, the head and body cells already carry its bound `style` width. Keep the binding on the head cells, drop it from the body cells (fixed layout reads only the first row), and let the `data-field` percentages stand as the rule the binding overrides.
11. `surfaces/library-pane.ts`: `LibraryView` drops `padTop` and `padBottom` and gains `rowCount: number`. `LibraryRow` gains `rowIndex: number`, and its doc comment's "Every field already a string" makes that one exception. The scope patch and the defaults (`rowCount: 0`) follow.
12. `browse/library-layouts.ts`: `libraryRow(file, columns, live, rowIndex = 0)` writes `rowIndex`, and `nameRow` writes `rowIndex: 0`.
13. `browse/library-pane.ts`, the projection at about line 900:
    - `rowCount: kind === "table" ? files.length + 1 : 0`.
    - Table rows are `slice.map((file, n) => libraryRow(file, libraryColumns(), false, range.start + n + 2))`; Cards and Media keep calling it without an index. Index 1 is the head row, and `range.start` is an index into the filtered list, so a row keeps its index while the window scrolls. If the collection-scoped Table of `plan:site-architecture/library-collection-views` exists by then, its rows take the same index.
    - Delete `padTop` and `padBottom`.

**Integration contract.** Once this lands, a plan may rely on the following:

- `@jxsuite/ui` defines `jx-table` (`label`, `rowcount`), `jx-tr` (`rowindex`), `jx-th` (`scope`) and `jx-td`, all in `KIT_TAGS`, with no parts, events or named slots. Each prop is also an observed attribute. The table draws separate borders at zero spacing, so a consumer may make head cells sticky and their hairline moves with them.
- A surface draws a table by writing `jx-tr` rows directly inside `jx-table`. Anything it puts between them must be `display: contents` with `role="none"`.
- The Library's Table is `div part="table-window"` > `jx-table part="table"`, whose first row is `jx-tr part="table-head"` of `jx-th part="cell" data-field` and whose other rows are `jx-tr part="table-row"` of `jx-td part="cell" data-field`, under `table-layout: fixed`, with `LibraryView.rowCount` and `LibraryRow.rowIndex`.
- A width `style` bound on the head cells overrides the part rule, and under fixed layout only the head row's widths count. This is where `plan:site-architecture/library-collection-views` binds its per-column widths.

## Tests

**`packages/ui`**: `bun test --isolate --coverage` from `packages/ui`, then `bun scripts/check-coverage-manifest.ts packages/ui`. The thresholds are `lines = 0.99, functions = 1.0`. The plan adds no `.ts` source; `src/documents.ts` gains imports only. `tests/conformance.test.ts` needs no edit: its "components/\*.json and documents name the same tags" and "exist for every element" cases fail until all four documents and pages are in place, and then hold them to every contract clause.

New `tests/table.test.ts`. It imports `./with-dom.ts` first, runs `registerUi()` in `beforeAll`, and reads declaration text for token-valued declarations with its own copy of the `rulesOf` helper that `divider.test.ts` and five other suites each define (happy-dom leaves a `var()` value empty in `getComputedStyle`):

- "jx-table is a CSS table with the table role, named by its label": `role="table"`; computed `display` is `table`; `aria-label="Files"` is written for that label, and no `aria-label` is written for an empty one.
- "rows, header cells and cells take their roles and table displays": `jx-tr` is `row` and `table-row`, `jx-td` is `cell` and `table-cell`, and `jx-th` is `columnheader` and `table-cell`.
- "a jx-th with scope=row is a row header, and changing scope moves the role": once through the `scope` attribute set before connection, once through the prop after it.
- "rowcount and rowindex are written only when given": 0 writes no attribute; `41` writes `aria-rowcount="41"`; `rowindex` 3 writes `aria-rowindex="3"`, as a prop and as an attribute.
- "a mapped list of rows leaves nothing but rows between the table and them": it `mount`s a document with a `jx-table` holding the head row and a `$prototype: "Array"` of three `jx-tr`/`jx-td` rows. Every element child of the table is `JX-TR` and every element child of a row is `JX-TD` or `JX-TH`, with no slot and no wrapper. This is §3.5's hazard, held.
- "the cells draw the kit's hairline and padding, and the header its tone": declaration text of each element's own rule.

**`packages/studio`**: `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio`. The thresholds are `lines = 0.958, functions = 0.941`, per file. There is no new source file. Ratchet if `library-pane.ts` or `library-layouts.ts` becomes the workspace minimum and rises. The existing part-addressed cases pass unchanged, which proves the adoption kept every hook.

- `tests/dependencies-editor.test.ts`: "the package list is the kit's table: four column headers and a row per package". The `[part="table"]` is `JX-TABLE` with `role="table"` and `aria-label="Packages"`; it has four `[role="columnheader"]`; every `[part="row"]` has `role="row"`. The file header's "A row is a `<tr>`" becomes "a `jx-tr`".
- `tests/i18n-panel.test.ts`: "each page's row is headed by its key as a row header". Every `[part="key"]` is `rowheader`, every `locale-head` is `columnheader`, and `parity` is a `JX-TABLE` inside `parity-scroll`. The repaint-identity case at lines 709 to 716 also holds `parity-scroll` to the same node, because its comment's reason, the reader's scroll position, now lives there.
- The timing the Open decision asks for is a case in the same file: 200 rows at four locales, first paint timed and printed with `console.error`, asserting only the rendered cell count, the way `library-perf.test.ts` prints timings and asserts counts and never a wall-clock figure. The case is written and run before the conversion, against the native table, then again after it; both figures go in the pull request description.
- `tests/library-pane.test.ts`: "the Table is a jx-table that states the whole set it windows". With N files, `[part="table"]` has `aria-rowcount` N+1, `table-head` has `aria-rowindex="1"`, and the first `table-row` has `aria-rowindex="2"`.
- `tests/library-perf.test.ts`, "the Table layout windows too, at its own row height": after `layOutPane()` and a scroll past row 100, the table's `aria-rowcount` is `PAGE_COUNT + 1`, and every rendered `table-row`'s `aria-rowindex` is its file's number plus 2 (the fixture's `pages/page-NNN.json` files sort by path, so `data-path` gives each row's place in the list), the first of them past 2. The 26-row count is unchanged.

## Specs & docs

**specs/ui.md**, in place. Each paragraph and table row stays one source line. Run `bunx oxfmt specs/ui.md` after editing the §5.4 table.

- **§3.5, the first bullet (line 92):** after "`role="columnheader"` and `role="cell"`", add "(`role="rowheader"` for a `jx-th` with `scope="row"`)".
- **§5 marker (line 144):**
  - "Thirty-eight elements" becomes "Forty-two elements".
  - Drop "`jx-table` (§5.4)" from what remains. If another plan has already removed its own clause, keep the grammar of whatever list is left, and if nothing is left, delete the "What remains" sentence.
- **§5.4 marker (line 255)** becomes:

  > **Status: Implemented.** `jx-tabs`, `jx-tab`, `jx-tab-panel`, `jx-accordion`, `jx-accordion-item`, `jx-action-group` and the four table elements `jx-table`, `jx-tr`, `jx-th` and `jx-td` are built, with the tab keyboard in `src/behaviors/tabs.ts` and the group's roving caret in `src/behaviors/action-group.ts`. The table elements take §3.5's first shape and are held by `packages/ui/tests/table.test.ts`; Studio's three tables are drawn with them (`packages/studio/src/surfaces/panel-i18n.json`, `settings-packages.json`, and `library-pane.json`, whose windowed rows state their place in the whole set).

  If the Open decision's guard keeps the Languages panel native, the marker names that panel and gives the measured reason instead.

- **§5.4, a new paragraph** before the catalogue table:
  > **`jx-table` IS the table (§3.5), and it is the static table pattern rather than the grid.** Each of `jx-table`, `jx-tr`, `jx-th` and `jx-td` declares the CSS table display and the ARIA role of the box it is, and each has one default slot, which leaves no node, so a row is its table's own child and a cell its row's. Anything a surface puts between them must be `display: contents` with `role="none"`, or CSS wraps it in an anonymous row. `jx-th` is a `columnheader`, or a `rowheader` under `scope="row"`, the word a native `<th>` uses. A windowed table states the set it slices: `rowcount` on the table writes `aria-rowcount`, counting the header row, and `rowindex` on each row writes its 1-based `aria-rowindex`, the answer §5.5's tree gives with `aria-posinset` and `aria-setsize`. There is no row-group element, because no consumer needs one, and no spanning, because a CSS table cell cannot span: a table that needs `colspan` or `rowspan` is §3.5's second shape, a native `<table>` with kit elements in its cells. The table takes no focus and has no keyboard contract; a row a host makes clickable owns that choice.
- **§5.4 catalogue table**, a new last row:
  - Element: `jx-table`, `jx-tr`, `jx-th`, `jx-td`.
  - Owns: "§3.5's first shape: `table`/`table-row`/`table-cell` displays with the `table`, `row`, `columnheader` or `rowheader` (`scope`) and `cell` roles; `label`; `rowcount` and `rowindex` for a windowed table; no spanning, no row groups, no keyboard".
  - Replaces: "`sp-table`, and the three tables Studio drew for itself".
- **§10 marker (line 410):** "(§5.1, §5.2, §5.4, §6)" loses "§5.4", keeping whatever entries are still open; if none is, the sentence goes.
- **§11, the WAI-ARIA row:**
  - The evidence gains `packages/ui/tests/table.test.ts`.
  - "Built and exercised" gains "**table** (`jx-table`, `jx-tr`, `jx-th` and `jx-td`: `columnheader` and `rowheader` cells, and `aria-rowcount` and `aria-rowindex` describing the whole set while a windowed table draws a slice of it)".
  - The `gap:ui-aria` note is otherwise unchanged.
- **Fragment:** `bun run spec:change ui.md minor -m "jx-table, jx-tr, jx-th and jx-td ship in the CSS table shape with table, row, header and cell roles, a row-header scope and row counts for a windowed table, and Studio's three tables are drawn with them."`. If the Open decision's guard keeps the Languages panel native, the last clause becomes "and Studio's Library and Packages tables are drawn with them".
- **Graduation:** the spec graduates only if this closes ui.md's last open item. At landing, run `bun run plans:status --spec ui`. If §5.4 is the last, set the header to `**Status:** Implemented`, run `bun run spec:bump ui.md patch -m "…"` in place, and delete `plans/ui/`. Otherwise delete only this file.

**Docs** (no em dashes):

- `docs/extending/ui-kit.md` (its `spec:` cites `ui.md#5.4`): add a `## Tables` section between "Button groups" and "Toolbars". It gets a JSON example of a two-column table with a `scope="row"` first cell, and paragraphs on:
  - What each of the four elements is, and `label`.
  - Writing or mapping rows directly inside the table, with a wrapper allowed only as `display: contents` and `role="none"`.
  - `rowcount` and `rowindex` for a table that draws only the rows in view, with the header row counted and indices starting at 1.
  - No spanning: write a native `<table>` with kit elements in its cells, and never wrap a native table in a kit element.
  - No focus or keyboard. Hover, cursor, sticky headers and column widths are yours, through `part`. The elements have no parts.
- `docs/studio/projects/browse.md` (its `code:` lists `browse/library-pane.ts` and `surfaces/library-pane.ts`): the "renders what fits the window" paragraph gains a sentence saying that a screen reader hears the Table's full row count and each row's place in it, so a windowed table still reads as the whole list.
- `docs:sync` will not name the pages for the other two tables. No page's `code:` lists `panel-i18n.json` or `settings-packages.json`: `docs/studio/interface/languages.md` and `docs/studio/projects/settings.md` carry those paths in a stray list at the end of the page body (left by 829c6957, which did the same to three other pages), a defect outside this claim. So the reviewer reads them by hand: `languages.md` ("It is a grid: one row per page, one column per language"), and `settings.md` and `docs/studio/projects/dependencies.md` (line 60, the Packages section's columns). None changes, because the words describe what the reader sees and that holds. The pull request says so. The screenshots lane recaptures any image of the two panels, and the reviewer re-reads the paragraphs beside a changed one.

## Acceptance

- `bun run plans:check --audit ui` and `bun run docs:status` pass, and §5.4 carries no Partial marker.
- `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:standards` (the new evidence path exists), `bun run docs:spec-release` and `bun run docs:section-refs` pass.
- `bun test --isolate --coverage` passes in `packages/ui` and `packages/studio` at their per-file thresholds, and `bun scripts/check-coverage-manifest.ts` passes for both.
- `bun --cwd packages/studio scripts/check-surface-purity.ts`, `bun --cwd packages/studio run lint:styles` and `bun --cwd packages/studio scripts/check-icons.ts` pass, and `bun scripts/check-shot-contract.ts` passes with the manifest unchanged.
- `bun run typecheck` passes over the `LibraryView` and `LibraryRow` changes.
- `grep -nE '"tagName": "(table|thead|tbody|tr|th|td)"' packages/studio/src/surfaces/panel-i18n.json packages/studio/src/surfaces/settings-packages.json` and `grep -n '"role": "table"' packages/studio/src/surfaces/library-pane.json` find nothing.
- In Studio, in the accessibility tree (Web Inspector, Node, Accessibility):
  - Project Settings › Packages is a table named "Packages" with four column headers.
  - In Languages, each page's key is a row header.
  - Library › Table in a project of 2,000 files is a table of 2,001 rows. A row scrolled into view reports its index in the whole list, and the header stays pinned while scrolling.

## Slices

| Slice | Scope                                                                                      | Claims    | State |
| ----- | ------------------------------------------------------------------------------------------ | --------- | ----- |
| JT1.1 | The four elements, their pages and tests; the three Studio tables; ui.md edits; docs pages | ui.md#5.4 | open  |
