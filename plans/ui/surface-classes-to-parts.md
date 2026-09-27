---
status: drafted
disposition: implement
claims:
  - ui.md#3.1
requires: []
workspaces:
  - packages/studio
  - specs
size: M
---

# Studio's surfaces address their own boxes by part and their state by attribute, and a gate refuses any other class

## Context

`specs/ui.md` §3.1, line 37:

> **Status: Partial.** The kit's side holds: no element writes a class and the only sheet the kit emits is the token block (`packages/ui/tests/conformance.test.ts`, `theme.test.ts`). The surface side does not: `packages/studio/src/surfaces/shell.json` writes `resize-handle` on its `jx-split` handles to reach the rules in `styles/shell-frame.json`, and `surfaces/panel-elements.json` writes `components-section` and `element-card*`, which `styles/panels.css` styles and `src/panels/dnd.ts` queries as runtime handles where this section says a handle is `part`; no gate refuses a class in a surface document outside the platform and third-party contract.

The rule is line 55: "A `class` attribute in a document is legal for one reason: a platform or third-party contract the schema does not own … A runtime handle is `part` … A class written to reach a rule is a defect." Re-verified against the tree on 2026-09-27. All paths below are under `packages/studio/`.

**The dock handles (verified).** `src/surfaces/shell.json` lines 42, 55 and 72 write `resize-handle`, and on `#resize-bottom` `resize-handle resize-handle-row`. They are styled by three rules in `styles/shell-frame.json` (lines 185 to 201): `.resize-handle`, `#app > .resize-handle` and its `:hover`/`[data-dragging]` restatement. `.resize-handle-row` is the whole of `styles/shell.css` (lines 1 to 9), which is linked after the frame (`index.html` lines 10 and 11). Half of the class rules' declarations are inert today. `jx-split`'s own rule is `[data-jx="…"]` at (0,1,0), adopted after every linked sheet, so it wins every tie. That makes `.resize-handle`'s `width: 5px`, `z-index: 10` and `position: relative` dead, and `.resize-handle-row`'s `width`, `height` and `cursor` restate the element's `[orientation="horizontal"]` rule (0,2,0). The live declarations are the grid placement and the negative margins.

**The palette cards (verified, and the stub's premise corrected).** `src/surfaces/panel-elements.json` writes `components-section` (line 207) and `element-card`, `element-card-preview` and `element-card-label` (lines 221 to 354). `styles/panels.css` lines 111 to 163 style them, and `src/panels/dnd.ts` queries `.components-section` (line 262) and `.element-card-preview` (lines 280 and 312). The document's own `$description` says the three card classes survive because "a card is a shared object with three readers" and moving its look "would fork it". That was already false: `panels.css` is linked into Studio's document only. The stylebook's cards (`src/panels/stylebook-doc.ts` line 214) are drawn in the canvas iframe and styled solely by `STYLEBOOK_CSS` in `src/canvas/iframe-render.ts` (lines 592 to 671), a copy that already differs: it has no `pointer-events: none` and uses hex-free fallbacks. The palette's rules have one reader.

**Two class writes the census missed.** Both are Studio code writing a class onto a node a surface document draws, to reach a rule:

- `applyDockLayout()` in `src/shell.ts` (lines 438 and 1020) toggles `left-collapsed`, `right-collapsed` and `bottom-collapsed` on `#app`, `shell.json`'s root, through the computed `DOCK_CLASS[id]`. The rules are `#app.left-collapsed …` in `styles/shell-frame.json` (lines 153 to 171).
- `applyEditWidth` and `settle` in `src/canvas/edit-width-drag.ts` (lines 67 and 124) add and remove `is-resizing` on `canvas-stage.json`'s `[part="edit-column"]`. The rule is `& [part="edit-column"].is-resizing::after` (line 147) in that document's own style, which its `$description` labels "FOREIGN CLASS". A dead copy remains: `.content-edit-column.is-resizing::after` in `styles/canvas.css` (lines 80 to 95), and no source emits `.content-edit-column`.

**One dead class selector.** `canvas-stage.json` line 113, `& [part="doc-header"][data-placement="pinned"] .doc-header`, calls `.doc-header` "the frontmatter card's own root". Nothing writes that class any more. The card is a Jx document, `src/surfaces/doc-header.json`, whose root is `section[part="card"]`, and it draws the pinned band itself: its `&[data-placement="pinned"]` (lines 21 to 25) sets the same `borderWidth: 0 0 1px` and `borderRadius: 0`. `tests/frontmatter-panel.test.ts` (lines 359 to 362) records that move.

**What legitimately stays.** Classes appear in 4 of the 89 surface documents. The two not named above are `electrobun-webkit-app-region-drag` in `boot-failure.json` (1) and `-no-drag` in `commandbar.json` (13), plus the one adapter write, `src/surfaces/commandbar.ts` line 815. Those are the platform contract. One live surface style selects classes, on markup no document draws: `grid-panel.json` (lines 132 to 151) selects Tabulator's own `.tabulator*` names and the `jx-grid-row--*` and `jx-grid-cell--*` state that `grid/grid-view.ts` (lines 127 to 137) toggles on the rows and cells Tabulator hands its formatters.

**The gates.** Neither covers the rule:

- `scripts/check-surface-purity.ts` has two rules: no lit in an adapter, and no kit tag in a lit template.
- `scripts/check-styles.ts`'s `surfaceClasses` feeds only the orphan rule, which asks that a class have CSS, not that it be a contract. studio-ui-guidelines.md §9.4 (line 646) nonetheless credits that orphan rule with keeping §3.1 "enforced rather than remembered". The same file already owns the third-party list, `VENDOR_CLASS_PREFIXES` (`tabulator`, `monaco-`, `mtk`, `codicon`), read through the private `isVendorClass`.

**Related.** ui.md §5.5 (line 318) states the weight rule and already names the frame: "A surface that overrides the rest look restates the lit look one attribute heavier, as the frame does for the docks." `plan:ui/principles-text`'s integration contract asks this plan to re-key the dock handles "to a part selector heavier than `jx-split`'s hover (0,2,0)". studio-ui-guidelines.md §1.1: a converted surface keeps its rules in its own `style`, keyed on `part`.

## Outcome

- ui.md §3.1 → Implemented:
  - Every box a Studio surface draws is addressed by `part` or by its adopted id.
  - Every state Studio writes onto a surface's node is a `data-*` attribute.
  - `check-surface-purity.ts` refuses any other class a surface document or adapter writes, a computed one, and a class a surface's `style` selects on anything but third-party or island markup.
- Riding along: one sentence of studio-ui-guidelines.md §9.4 names the gate that actually enforces §3.1.
- ui.md's header stays Partial, because §2, §3.2, §3.3, §4.1, §5.1, §5.2, §5.4, §5.5, §6 and §7 stay open under other plans. Nothing graduates.

## Decisions

- **Open:** does §3.1 reach the classes `grid/grid-view.ts` writes on Tabulator's rows and cells, which `grid-panel.json` selects? Recommendation: no.
  - §3.1 speaks of "a `class` attribute in a document", and a Tabulator row belongs to no document. It is Tabulator's element, handed to a formatter, so a `data-*` state there would be just as foreign.
  - Under this reading the gate names `jx-grid-` as island markup with its owner, and §3.1 gains a sentence saying a surface's `style` selects a class only on markup no document draws.
  - The stricter reading converts the six `classList.toggle` calls in `paintRow` and `paintCell` to a `data-row-state` and a `data-cell-state` attribute and re-keys the six rules in `grid-panel.json`. That is small enough to ride along if a maintainer prefers it, and the island list is then empty.
- **Decided:** the two writes the census missed are in scope (`#app`'s collapse classes and the Edit column's `is-resizing`). §3.1 cannot read Implemented while Studio writes a class onto a surface's own node to reach a rule, and the gate's style rule would refuse `.is-resizing` on its first run.
- **Decided:** canvas-stage.json's `.doc-header` rule is deleted, not listed as foreign. It matches nothing, and `doc-header.json` already carries its two declarations on its own root.
- **Decided:** the stylebook specimen document stays as it is. That covers `panels/stylebook-doc.ts` (its `element-card*` and `sb-*` classes and its `& .element-card-preview` specimen scope) and `STYLEBOOK_CSS`. Three reasons:
  - ui.md's header applies it to `packages/ui/` and `packages/studio/src/surfaces/`. That document is a project-shaped document the canvas iframe renders, where a class is author vocabulary.
  - Its scope string is a runtime contract with the live `styleUpdate` path (`transposeStylebookStyle`).
  - After this plan the stylebook shares no rule with the palette, which was already the case.
- **Decided:** a state Studio writes onto a surface's node is a boolean attribute. `#app` gets `data-left-collapsed`, `data-right-collapsed` and `data-bottom-collapsed`, and the Edit column gets `data-resizing`. That is the kit's own idiom (`jx-split` mirrors its gesture as `data-dragging`), and every rule keeps its weight: `#app.left-collapsed` and `#app[data-left-collapsed]` are both (1,1,0), and `.is-resizing` and `[data-resizing]` add the same (0,1,0).
- **Decided:** the frame keys the handles' shared look on a part and each handle's layout on its id. All three get `part="dock-handle"`. `#resize-left, #resize-right` carry the column placement, and `#resize-bottom` carries the row placement moved from `shell.css`. The reasons:
  - The ids are already the frame's contract: `ui/panel-resize.ts` adopts them, and `#resize-left { grid-column: pane }` exists.
  - The look and the layout touch disjoint properties, so no rule has to out-weigh another.
  - The name `dock-handle` says what the region is, beside the pane grid's `splitter` and the stage's `edit-handle`. `resize-handle` would restate what a `jx-split` already is.
- **Decided:** the rest look is `#app > [part="dock-handle"]` (1,1,0), and the lit look is restated on `:hover` and `[data-dragging]` at (1,2,0). The frame is a linked sheet and `jx-split`'s rules are adopted after it, so a rest override has to out-weigh the element's own hover (0,2,0). This is the §5.5 rule the frame is already named for.
- **Decided:** only live declarations move. The dead `width`, `z-index: 10`, `position`, `height` and `cursor` are dropped. On an id selector they would start winning, and `z-index: 10` would undo the `3` that `jx-split.json`'s `$description` argues for.
- **Decided:** `styles/shell.css` is left empty rather than deleted. `.resize-handle-row` is its last rule, and `tests/build-styles.test.ts`'s own comment says an empty `shell.css` is then the correct state and its non-empty assertion is to be retired. Deleting the file is a hosting change (`STUDIO_STYLESHEETS` in `src/hosting/layout.ts`, `index.html`, `check-studio-package.ts`, `tests/hosting-stage.test.ts`) with the 2.1.0 dead-link outage behind it, and it belongs to whoever next edits that list.
- **Decided:** the palette's card rules move from `panels.css` into `panel-elements.json`'s own `style`. They are keyed on parts named as the classes were: `components-section`, `element-card`, `element-card-preview` and `element-card-label`. studio-ui-guidelines.md §1.1 says a converted surface takes its rules with it, the rules have one reader, and none of the four names collides with a kit part in the subtree. `preview` and `label` would: `jx-accordion-item` has a `label` part.
- **Decided:** specimen normalisation keeps today's precedence where it can. The move lifts each rule from (0,1,0) in a linked sheet to (0,2,0) or more in the adopted sheet. A plain `& [part="element-card-preview"] > *` carrying everything would then beat a live component's own `[data-jx]` rules and tie the palette's own `[part="component-tag"]` colour, both of which win today. So:
  - the text colour moves onto the preview box, where it reaches every child by inheritance;
  - `maxWidth: 100%` stays on every child (`> *`), because a live component without it would overflow and be clipped instead of fitting the card. The one precedence this changes is a component's own `max-width`, which the card now caps, as a thumbnail should;
  - `margin`, `padding` and an explicit colour apply to `> :not([data-jx], [part])` only, which is what the specimens `dnd.ts` creates are. A custom element has no UA margin or padding, so excluding live components changes nothing they draw.
- **Decided:** the gate is a third rule in `check-surface-purity.ts`, built on the scanners in `check-styles.ts`:
  - ui.md §2's marker already credits that script with "a surface is a document", and it runs in `checks` (`.github/workflows/test.yml` line 311).
  - `check-styles.ts` already owns the parsers (`surfaceClasses`, `extractEmittedClasses`, `jsonStyleBlocks`, `stripComments`) and the third-party list (`VENDOR_CLASS_PREFIXES`). The gate reuses the list through an exported `isVendorClass` rather than keeping a second `tabulator` entry.
  - The platform allow-list holds only the two Electrobun names. Tabulator's names are admitted by §3.1 but written by no surface, and an allow-list here names only what is written.
- **Decided:** the gate reads surface documents and adapters, not `styles/shell-frame.json`. The frame's sheet also selects `src/resize-edges.ts`'s imperative `.resize-edge.top` (nine names, eight of them bare edge words) and `shell/tree.ts`'s lit `.jx-layer--*` (five), all markup no document draws, so a frame branch would carry a fourteen-name allow-list to guard one attribute rename. The frame's attribute selectors are pinned by `tests/build-styles.test.ts` instead.

## Implementation

One pull request. Paths are under `packages/studio/`.

**The frame**

1. `src/surfaces/shell.json`: on `#resize-left`, `#resize-bottom` and `#resize-right`, replace the `class` attribute with `"part": "dock-handle"`. In the root `$description`, after "the ids are a contract rather than styling", add: "the three handles also share `part="dock-handle"`, the one hook their look is keyed on".
2. `styles/shell-frame.json`:
   - Delete `.resize-handle`, `#app > .resize-handle` and `#app > .resize-handle:hover, #app > .resize-handle[data-dragging]`.
   - Add `"#resize-left, #resize-right"`: `grid-row: 2 / 4`, `margin-left: -3px`, `margin-right: -2px`. Keep the old `.resize-handle` `$description` and add: "Thickness, stacking and position are `jx-split`'s own (ui.md §5.5); a declaration here would out-weigh them".
   - Add `"#resize-bottom"`: `grid-row: 3`, `grid-column: pane`, `align-self: start`, `margin: -3px 0 -2px`. Its `$description`: "The Bottom dock's handle, on the row axis. Its thickness and cursor are the element's `[orientation="horizontal"]` rule."
   - Add `"#app > [part=\"dock-handle\"]"` with `background: transparent`. Carry the old `$description` up to "the runtime adopts it (`adoptedStyleSheets` cascade after every linked sheet)", and end it: "so a bare `[part]` override would tie it and lose on order. One id and one attribute, (1,1,0), is what holds." No `.resize-handle` survives in the text, since the generated CSS carries it as a comment.
   - Add `"#app > [part=\"dock-handle\"]:hover, #app > [part=\"dock-handle\"][data-dragging]"` with the old accent and `opacity: 0.5`. Its `$description` keeps its argument with the weights corrected: the lit rule is (1,2,0), restated because the rest rule's (1,1,0) outranks the element's own `:hover`/`[data-dragging]` (0,2,0).
   - Collapse variants: `#app.left-collapsed` becomes `#app[data-left-collapsed]` in all six keys (three tracks, three `display: none` pairs), and likewise for `right` and `bottom`. The first rule's `$description` becomes "Collapsed docks: `src/shell.ts`'s applyDockLayout() writes one boolean attribute per dock".
   - Run `bun run styles:sync` from `packages/studio` to regenerate `styles/shell-frame.css`, and commit both files.
3. `styles/shell.css`: delete the `.resize-handle-row` block (lines 1 to 9). The file is left empty and stays linked.
4. `src/shell.ts`: rename `DOCK_CLASS` to `DOCK_ATTR`, with values `data-bottom-collapsed`, `data-left-collapsed` and `data-right-collapsed`. `applyDockLayout()` calls `app.toggleAttribute(DOCK_ATTR[id], shell.docks[id].collapsed)`, and its doc comment says "collapse attributes on #app".

**The canvas stage**

5. `src/canvas/edit-width-drag.ts`: `applyEditWidth` calls `column.toggleAttribute("data-resizing", true)` where it added the class, and `editWidthTarget`'s `settle` calls `column.removeAttribute("data-resizing")`.
6. `src/surfaces/canvas-stage.json`:
   - Re-key `& [part="edit-column"].is-resizing::after` to `& [part="edit-column"][data-resizing]::after`. Its `$description` becomes "STATE: `canvas/edit-width-drag.ts` writes `data-resizing` and `data-edit-width` on the column with the same bare style pass that moves it, so the live readout costs no element and no render."
   - Delete `& [part="doc-header"][data-placement="pinned"] .doc-header` (lines 113 to 117).
   - In the root style `$description`, delete the sentence "Two selectors reach FOREIGN DOM and say so where they stand: …", through its `grid-panel.json` clause. The style then selects no class.
7. `styles/canvas.css`: delete the dead `.content-edit-column.is-resizing::after` block and its comment (lines 80 to 95).

**The Insert palette**

8. `src/surfaces/panel-elements.json`:
   - Replace the seven `class` attributes with `part` of the same name.
   - Add to the root `style`, with camel-cased properties as the file uses:
     - `& [part="components-section"]`: `padding: 0 0 2px`.
     - `& [part="element-card"]`: `cursor: grab`, `display: flex`, `flexDirection: column`, `width: 100%`, `border: 1px solid var(--border)`, `borderRadius: var(--radius)`, `overflow: hidden`, `marginBottom: 6px`.
     - `& [part="element-card"]:hover`: `borderColor: var(--accent)`.
     - `& [part="element-card-preview"]`: `background: white`, `padding: 6px 8px`, `minHeight: 32px`, `maxHeight: 120px`, `display: flex`, `alignItems: center`, `overflow: hidden`, `pointerEvents: none`, `color: var(--canvas-fg-2)`.
     - `& [part="element-card-preview"] > *`: `maxWidth: 100%`.
     - `& [part="element-card-preview"] > :not([data-jx], [part])`: `color: var(--canvas-fg-2)`, `margin: 0`, `padding: 0`. Its `$description` gives the precedence reason from Decisions.
     - `& [part="element-card-preview"] > hr`: `width: 100%`, `border: none`, `borderTop: 1px solid var(--canvas-muted)`.
     - `& [part="element-card-preview"] > :is(input, textarea, select, button, progress, meter)`: `fontSize: var(--jx-text-xs)`.
     - `& [part="element-card-label"]`: `padding: 2px 6px`, `fontSize: var(--jx-text-xs)`, `color: var(--fg-dim)`, `background: var(--bg-input)`, `textAlign: center`, `fontFamily: var(--font-mono)`.
   - `--jx-text-xs` is the 10px the sheet wrote; `check-styles.ts` warns on the literal (`TOKENIZABLE_FONT_PX`). The runtime splits a selector list only at depth 0 (`splitSelectorList` in `packages/runtime/src/css.ts`), so the commas inside `:not()` and `:is()` are safe.
   - Rewrite both `$description`s: the root's "that seam is why three class names survive" and the style block's `.element-card…` paragraph go. The sentence about the preview being drawn EMPTY for `dnd.ts` to fill stays.
9. `styles/panels.css`: delete lines 111 to 163, from `.components-section` through `.element-card-label`.
10. `src/panels/dnd.ts`: `registerComponentsDnD` queries `'[part="components-section"]'` (line 262), and both preview lookups use `'[part="element-card-preview"]'` (lines 280 and 312).
11. `src/canvas/iframe-render.ts`: in the `STYLEBOOK_CSS` doc comment (line 589), "the parent's `.element-card-preview { pointer-events: none }`" becomes "the Insert palette's `pointer-events: none` on `[part="element-card-preview"]` (`surfaces/panel-elements.json`)". The CSS is unchanged.

**The gate**

12. `scripts/check-styles.ts`:
    - Add `export function surfaceSelectedClasses(source: string): [string, number][]`. It walks `jsonStyleBlocks(source)` exactly as `surfaceDefinedClasses` does and pairs each class with the line of its key: `block.line` plus the newlines in `block.text` before the match.
    - `surfaceDefinedClasses` becomes `surfaceSelectedClasses(source).map(([name]) => name)`.
    - Export `isVendorClass`.
    - In `surfaceClasses`'s doc comment, "this exists to make an exception VISIBLE" gains "and `check-surface-purity.ts` refuses one outside a platform contract".
13. `scripts/check-surface-purity.ts`:
    - Import `extractEmittedClasses`, `isVendorClass`, `stripComments`, `surfaceClasses` and `surfaceSelectedClasses` from `./check-styles`.
    - `export const CLASS_CONTRACTS: ReadonlySet<string>` holds `electrobun-webkit-app-region-drag` and `electrobun-webkit-app-region-no-drag`. Its comment cites ui.md §3.1 and the writers (`surfaces/commandbar.json`, `boot-failure.json`, `commandbar.ts`).
    - `export const ISLAND_CLASS_PREFIXES: readonly string[]` holds `["jx-grid-"]`, with an owner comment: `grid/grid-view.ts`'s row and cell state on the rows Tabulator hands its formatters, styled by `surfaces/grid-panel.json`. If the Open decision goes the strict way, the list is empty and stays exported for the next island.
    - `const SURFACE_JSON = /^src\/surfaces\/[^/]+\.json$/`, `const COMPUTED_CLASS = /"class(?:Name)?"\s*:\s*(?:[{[]|"[^"]*\$\{)/g` for documents, and `const COMPUTED_CLASS_WRITE` for adapters: a `classList.add|remove|toggle|replace(`, a `.className =` or `+=` (not a `==` comparison), or a `setAttribute("class", …)` whose first class argument is not a plain quoted literal (`extractEmittedClasses` drops a computed name silently, which is the shape `DOCK_CLASS[id]` had).
    - `surfacePurityFindings` gains a branch for `SURFACE_JSON` paths ahead of the `STUDIO_TS` guard, ending in `continue`. It finds three things:
      - every `surfaceClasses(text)` name outside `CLASS_CONTRACTS`: "a surface document writes the class `x`; name the box with `part` and style it from the document's own `style` (ui.md §3.1)";
      - every `COMPUTED_CLASS` match, at its line: "a surface document computes a class; no platform contract is computed, so write the state as an attribute (ui.md §3.1)";
      - every `surfaceSelectedClasses(text)` name that is not a contract, not `isVendorClass`, and not under an `ISLAND_CLASS_PREFIXES` prefix: "a surface's style selects `.x`, which only third-party or island markup may carry; key the rule on `part` or an attribute (ui.md §3.1)".
    - The adapter branch adds, over `stripComments(text)` (which blanks, so the lines hold):
      - every `extractEmittedClasses` name outside `CLASS_CONTRACTS`: "an adapter writes the class `x` onto its document; write the state as an attribute (ui.md §3.1)";
      - every `COMPUTED_CLASS_WRITE` match: "an adapter computes a class; write the state as an attribute (ui.md §3.1)".
    - The header gains rule 3, and `report()`'s green line gains ", no class outside a platform contract".

**Tests** as listed under Tests: the fixtures and assertions that named the old classes, plus the new cases.

**Integration contract.** Once this lands, a plan may rely on the following:

- The Insert palette's parts are `components-section`, `element-card`, `element-card-preview` and `element-card-label`. `dnd.ts` finds cards only through them, and their look lives in `panel-elements.json`.
  - `plan:desktop/component-scope-sections` writes `part="components-section"` on each section's container and iterates `querySelectorAll('[part="components-section"]')`, where its step 3 says `div.components-section` and its step 5 says `.components-section`.
  - `plan:studio/insert-palette-categories`'s count test reads `[part="element-card"]`.
- The dock handles are `#app > [part="dock-handle"]`, rest at (1,1,0) and lit at (1,2,0). `plan:ui/principles-text` may cite that rule as the frame's instance of §5.5's weight rule.
- `#app` carries `data-left-collapsed`, `data-right-collapsed` and `data-bottom-collapsed`, written only by `applyDockLayout()`. The Edit column carries `data-resizing` during a gesture.
- `check-surface-purity.ts` exports `CLASS_CONTRACTS` and `ISLAND_CLASS_PREFIXES`, and `check-styles.ts` exports `surfaceSelectedClasses` and `isVendorClass`. The gate refuses a class a surface document or adapter writes outside the contracts, a computed one, and a class selector in a surface's `style` that is neither a contract, a vendor class nor an island's. A plan that puts a surface over a new third-party widget adds its prefix to `VENDOR_CLASS_PREFIXES` in `check-styles.ts`, which the orphan rule reads too. `plan:ui/jx-table` and `plan:ui/studio-toast-host` convert surfaces and must add no class.

## Tests

`packages/studio`: `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio` from the root.

New cases:

- `tests/check-surface-purity.test.ts`:
  - "a class in a surface document is a finding, and a platform contract is not": `"class": "resize-handle"` yields one finding with its file and line. `electrobun-webkit-app-region-no-drag` yields none.
  - "a computed class in a surface document is a finding": `"class": "tab-${state.kind}"` and `"class": { "$ref": "#/state/c" }` yield one finding each.
  - "an adapter that writes a class onto its document is a finding, and a platform contract or a comment is not":
    - `src/surfaces/x.ts` with `el.classList.add("is-open")` yields a finding;
    - `el.classList.toggle(DOCK_CLASS[id], on)` yields one "computes a class" finding;
    - `rootEl.classList.add("electrobun-webkit-app-region-drag")` yields none;
    - `// classList.add("is-open")` yields none;
    - the same writes in `src/panels/x.ts` yield none.
  - "a surface style that selects a class is a finding unless the markup is third-party or an island's": `"& [part=\"edit-column\"].is-resizing::after"` and `"& [part=\"doc-header\"] .doc-header"` yield a finding each. `"& .tabulator .tabulator-row"` and `"& .tabulator-cell.jx-grid-cell--dirty"` yield none, and so does a `$description` that mentions `.is-resizing`.
  - "the CLI returns 1 over a surface document that writes a class": a temporary tree holding `src/surfaces/bad.json`, with a log line containing "writes the class".
  - The existing "the package is clean today" now runs every document and adapter rule over the real tree. It is red on today's tree and green after steps 1 to 11.
- `tests/check-styles-orphans.test.ts`, `describe("surfaceSelectedClasses")`, "pairs each selected class with its key's line": a three-line style block whose class key sits on line 3. The existing `surfaceDefinedClasses` cases stay green through the delegation.
- `tests/build-styles.test.ts`:
  - "each collapse variant zeroes its track and hides its handle" expects `#app[data-${side}-collapsed] {`, `#app[data-${side}-collapsed] #resize-${side}` and `#app[data-bottom-collapsed] {` in place of the three class spellings.
  - "nothing that moved was left behind, and nothing else came with it" swaps `.resize-handle {` for `#app > [part="dock-handle"] {` and `#resize-bottom {`, and retires its "shell.css STILL HAS RULES" pair of assertions, as its own comment instructs once the last non-frame rule leaves.
  - New case, "the dock handles are dressed through their part, one id above the element's hover": the frame has `#app > [part="dock-handle"]` with `background: transparent`, the `:hover` restatement with `var(--accent`, and a `#resize-left, #resize-right` rule with `grid-row: 2 / 4;` and no `z-index`. Neither the frame nor `shell.css` contains `resize-handle`.
- `tests/shell-tree.test.ts`, "the frame's handles are parts and the frame writes no class": after `mountShellTree()`, all three handles have `part="dock-handle"`, and `#app[class], #app [class]` matches nothing.
- `tests/elements-panel.test.ts`:
  - The header's "Three class names survive" paragraph (lines 8 to 12) is replaced by one saying `dnd.ts` addresses the card parts.
  - Selectors move to parts (lines 166 to 331).
  - New case, "the palette writes no class, and its cards are styled by the document": `host.querySelectorAll("[class]")` is empty, and `styles/panels.css` contains neither `element-card` nor `components-section`.

Changed assertions:

- `tests/shell.test.ts` (lines 55 to 100), `tests/rail.test.ts` (lines 138, 279 and 291) and `tests/panel-resize.test.ts` (lines 102 and 103) read `hasAttribute("data-left-collapsed")` and its siblings, and `rail.test.ts`'s reset removes the attributes. Test names saying "#app classes" or "no #app to classify" say attributes.
- `tests/edit-width.test.ts` lines 226, 324, 326 and 389 read `hasAttribute("data-resizing")`.
- `tests/dnd-gaps.test.ts` (lines 484 to 567) and `tests/panels-coverage-gaps.test.ts` (lines 428 and 429): the fixtures write `part="components-section"` and `part="element-card-preview"`, and "no .components-section is a no-op" becomes "no components-section part is a no-op".
- For fidelity only, the frame fixtures in `tests/studio-shell.test.ts` (lines 71 and 72), `tests/studio-shell-boot-gaps.test.ts` (lines 51 to 53) and `tests/shell-misc-diff-gaps.test.ts` (lines 367 to 369) write `part="dock-handle"` for `class="resize-handle"`. `panel-resize.ts` finds the handles by id either way.
- Unchanged on purpose: `tests/stylebook-doc.test.ts`, `iframe-render.test.ts`, `iframe-entry.test.ts` and `iframe-host.test.ts` name the stylebook's `element-card*` scope, which stays.

Coverage:

- No source file is added, so the manifest check sees nothing new.
- `packages/studio/bunfig.toml` holds `coverageThreshold = { lines = 0.958, functions = 0.941 }`, and `check-surface-purity.ts` sits at 98.57% lines. Every new branch in steps 12 and 13 has a case above, so neither script falls.
- The line counts of `shell.ts` and `edit-width-drag.ts` are unchanged. No ratchet is expected. Raise the threshold only if the worst file's figure rises.

The screenshots lane runs, since `src/**` changes. The computed look of the handles, the cards and the readout should be unchanged. A changed palette image of the HTML element cards means the precedence decision was not followed.

## Specs & docs

**ui.md §3.1 marker (line 37)**, replaced whole:

> **Status: Implemented.** The kit's side: no element writes a class, and the only sheet the kit emits is the token block (`packages/ui/tests/conformance.test.ts`, `theme.test.ts`). The surface side: a box a Studio surface draws is addressed by `part` or by the id a host adopts it by, and a state a host writes onto one is an attribute. The dock handles in `packages/studio/src/surfaces/shell.json` are `[part="dock-handle"]`, the Insert palette's cards in `surfaces/panel-elements.json` are parts that document styles and `src/panels/dnd.ts` finds, and `#app`'s collapsed docks and the Edit column's width readout are `data-*` attributes. `packages/studio/scripts/check-surface-purity.ts` refuses a class a surface document or adapter writes outside the platform contracts it lists, a class either computes, and a class a surface's `style` selects outside the third-party and island markup it lists.

**ui.md §3.1 body (line 55).** After "A class written to reach a rule is a defect." append:

> A state a host writes onto a node a document draws is an attribute, as `jx-split` mirrors its own gesture as `data-dragging`. A surface's `style` selects a class only on markup no document draws, a third-party component's or an island's, such as the rows Tabulator hands Studio's grid.

If the Open decision goes the strict way, the example becomes "such as Tabulator's own", and the grid's state classes become attributes too.

**§3's marker (line 33)** keeps its "(§3.1, §3.2, §3.3)". `plan:ui/behaviour-list-text` removes that parenthetical whole, so this plan does not touch it.

**studio-ui-guidelines.md §9.4 (line 646), ride-along.** Replace "`surfaceClasses` holds a class a document names to the same orphan rule, which is how the rule that a document styles through `part` rather than through a class (`ui.md` §3.1) stays enforced rather than remembered." with:

> `surfaceClasses` holds a class a document names to the same orphan rule, and `scripts/check-surface-purity.ts` refuses one outside the platform contracts `ui.md` §3.1 allows, which is how the rule that a document styles through `part` rather than through a class stays enforced rather than remembered.

The orphan rule only asks that a class have CSS, so the old sentence credited it with a check it never made. §9.4's marker stays Implemented.

**Fragments:**

- `bun run spec:change ui.md minor -m "§3.1 is implemented on the surface side: Studio's dock handles and Insert palette cards are addressed by part, a state a host writes onto a surface node is an attribute, a surface style selects a class only on third-party or island markup, and check-surface-purity refuses any other class in a surface"`
- `bun run spec:change studio-ui-guidelines.md patch -m "§9.4 names check-surface-purity as the gate that refuses a class in a surface document outside a platform contract"`

**Docs.** None change:

- `docs/extending/ui-kit.md` cites `ui.md#3.1`. It describes the kit's side ("The kit ships no CSS class"), which does not move.
- `docs/studio/design/elements.md` lists `panel-elements.json` and `dnd.ts`, and `docs/studio/design/layers.md` lists `dnd.ts`. `docs/studio/interface/canvas.md` and `docs/studio/design/breakpoints.md` list `edit-width-drag.ts` (and `canvas.md` is the `@docs` page of `iframe-render.ts`). Each describes behaviour a reader sees (cards, dragging, the width handles), and none of it changes.
- `bun run docs:sync` will name those five pages, and the pull request states that no update is needed.

**Graduation:** none. ui.md keeps ten open sections owned by other plans. Delete `plans/ui/surface-classes-to-parts.md` in the landing pull request. No plan requires it.

## Acceptance

- `grep -rhoE '"class(Name)?": *"[^"]*"' packages/studio/src/surfaces/*.json | sort -u` prints only the two Electrobun names.
- These print nothing:
  - `grep -rnE 'resize-handle|is-resizing|[^-](left|right|bottom)-collapsed' packages/studio/src packages/studio/styles` (the `[^-]` lets `data-left-collapsed` through);
  - `grep -nE 'element-card|components-section' packages/studio/styles/*.css`.
- `bun --cwd packages/studio scripts/check-surface-purity.ts` passes and prints "no class outside a platform contract", which also shows canvas-stage.json's style selects no class. Three mutations turn it red with the file and line, and each is then reverted:
  - add `"class": "x"` to any surface node;
  - re-key canvas-stage.json's readout rule to `.is-resizing`;
  - add `rootEl.classList.toggle(name, true)` to `src/surfaces/commandbar.ts`.
- `bun --cwd packages/studio run lint:styles` and `bun --cwd packages/studio run styles:check` pass, which shows `shell-frame.css` was regenerated and no orphan appeared.
- `bun test --isolate --coverage` from `packages/studio` passes with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- In a running Studio:
  - A dock edge is invisible at rest, lights on hover and through a drag, and still sits above the pane toolbar band.
  - Collapsing and restoring each dock hides and shows its handle.
  - The Edit column's width badge shows during a handle drag and closes on release.
  - In Design, the pinned Document Header card is still a band with only its bottom edge.
  - Insert cards look as before, including a live component preview's own colours.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check` and `bun run docs:links` pass. `bun run plans:status --who-claims ui.md#3.1` reports no open item.
