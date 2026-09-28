---
status: drafted
disposition: implement
claims:
  - studio.md#7.3
requires:
  - studio/stylebook-editing-text
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# The Project Styles outline and canvas select one tag path per part, mark the rules Stylebook writes, and highlight the part selected

## Context

`specs/studio.md` §7.3 (heading line 766, marker line 768; the section was unmarked before the census):

> **Status: Partial.** The nested tree, selection from its rows and from the canvas, pan-to-card and the Style tab ship (`packages/studio/src/panels/stylebook-layers-panel.ts`, `panels/stylebook-panel.ts`). The mechanics differ from the text: `selectStylebookTag` sets `activeSelector` to the bare tag path (`ul li`), canvas hits decode through the specimen document's path map, and `stylebookElToTag` no longer exists. The row's customised marker reads `& <tag>` keys through the layers panel's own `hasTagStyle`, not the exported one in `panels/stylebook-doc.ts` that reads bare nested keys, while Stylebook edits write bare tag keys (§7.4), so it never lights for Stylebook's own edits.

The body (lines 770 to 776) still says a child row sets `activeSelector` to `& childTag`, "scrolls the canvas to the parent card and highlights the child element", and that canvas hits go through `stylebookElToTag`.

**Verified** (paths under `packages/studio/`)

- The marker defect holds. `hasTagStyle(rootStyle, tag)` in `src/panels/stylebook-layers-panel.ts` (line 53) reads ``rootStyle[`& ${tag}`]``, and `elementRows` passes it the row's bare `tag` rather than its path. `mutateUpdateNestedStylePath` (`src/tabs/transact.ts`, reached from `contextMutate` in `src/panels/style-panel.ts`) writes `{ "ul": { "li": {…} } }`. The exported `hasTagStyle(rootStyle, tagPath)` in `src/panels/stylebook-doc.ts` (line 130) reads that shape, directly and under every `@` block. `tests/stylebook-layers-panel.test.ts` seeds `& h1`.
- Component rows are always `customized: false`. The canvas's Customized filter (`buildStylebookDoc`) does count a rule at a component's tag.

**Corrections to the marker**

- **"Pan-to-card" ships for element and component rows only.** `cardNode` in `buildStylebookDoc` registers a card only under its element's tag, so `tagToCardPath` has no `ul li`. `panToStylebookTag("ul li")` (`src/canvas/iframe-host.ts` line 3318) finds no card and returns. `requestStylebookSelection` (line 1621) clears the selection box. A part row therefore neither pans nor highlights, and a canvas click on an `<li>` draws no box either. The parent-side canvas did both before the iframe port (`findStylebookEl`, removed in 5943b822).
- **A deep part has two spellings.** The rows spell the specimen's chain: `elementRows` builds `table thead tr th`. The canvas spells the element and the part: `registerSpecimenPaths` maps a `<th>` to `table th`. So one header cell selects two different nested rules, depending on where it was clicked. The two agree for every depth-one entry in `data/stylebook-meta.json` (`ul li`, `ol li`, `blockquote p`, `pre code`, `select option`, `details summary`, `details p`). Only `table` differs.
- **The current row is marked by leaf.** `selectedLeaf` plus `tag === leaf` marks every row whose tag is the path's last segment. So selecting `p` also marks `blockquote p` and `details p`, `code` marks `pre code`, `ul li` marks `ol li`, and a Relative Styling path `ul li a` marks the top-level `a`. The test "the selected row announces itself, and it is the only one" passes only because its fixture holds one list.

**Found while detailing, not §7.3's**

- For a part, the Target Line's scope chip names the path's first segment (`stylebookTagOf` in `style-panel.ts`), so `ul li` reads "all <ul> in this document", and `projectScope` counts `<ul>`s. §6.2 says the chip "states the blast radius", so this is §6.2's defect; §6.2 is claimed by `plan:studio/style-sections-table`.
- The Customized toggle filters against the effective (site-merged) style (`customizedOnly` over `effectiveStyle` in `buildStylebookDoc`), while its hint (`customizedHint` in `panels/stylebook-panel.ts`) says "the elements this file has already styled". No spec section describes the toggle, so this is a code-and-copy defect with no open item.
- `docs/studio/design/stylebook.md`'s two stray `code:` entries under "Next" are moved into its frontmatter by `plan:studio/stylebook-editing-text`, which lands first.

## Outcome

studio.md §7.3 → Implemented, its census marker deleted. §7.4's readers paragraph (as `plan:studio/stylebook-editing-text` lands it) names the Outline's dot. A part has one tag path, the element's tag and then its own (`table td`), whether it is chosen from an Outline row or on the canvas. The Outline lists each part once, one level under its element. It marks only the row equal to the selection, and dots a row by the bare nested key a Stylebook edit writes. Selecting a part pans to its element's card and highlights the part.

## Decisions

- **Open:** is a part of a deeper specimen spelled `table td` (the element's tag, then the part's) or `table tbody tr td` (the specimen's chain)? Recommendation: `table td`, with the Outline listing each part once, one level under its element, because of the three reasons below.
  - It is what the canvas already decodes a click to (`registerSpecimenPaths`), and what the canvas did before the iframe port. The canvas side does not change.
  - The rule it writes, `table td`, styles every cell in a table. `table tbody tr td` misses a cell in `thead` or `tfoot`, and every row the runtime builds without a `tbody`. The runtime creates elements; only the HTML parser inserts a `tbody`.
  - §7.4's own example is "`table` then `th`".
  - The cost: the table's rows flatten from four levels to two (`thead`, `tr`, `th`, `tbody`, `td`, one step in). A `table thead tr th` rule already written from the Outline keeps rendering but has no row of its own. The `table thead` row carries its dot, and Relative Styling under that row reaches it.
  - If declined: `specimenCompound` takes the chain (`registerSpecimenPaths` threads its parent's path), the Outline keeps its recursive walk keyed by that chain, and §7.3 says a part is styled where the specimen puts it.
- **Decided:** the dot is the exported `hasTagStyle` in `stylebook-doc.ts`, called with the row's key over the open file's own style (`tab.doc.document.style`), not the effective style. The row's label says "Styled in this file", and the editor writes into this file.
- **Decided:** an `& tag` key lights nothing. The editor never writes one, and clicking a row whose dot came from `& h1` would open the empty bare `h1` rule. The shape is `plan:studio/stylebook-editing-text`'s, and this plan requires it.
- **Decided:** an element's dot also lights when only one of its parts is styled (`hasTagStyle` counts any non-empty object at the key). That is the rule the Customized filter already applies to the element's card, so over the file's own rules the dot and the filter agree. They still differ on rules only the site style contributes, which the filter counts and the dot does not (Context).
- **Decided:** a component row carries the dot for a rule at its tag, for the same reason.
- **Decided:** a row is current when its key equals `shell.stylebook.selection`, and a path that is no row (`h1 :hover`, `ul li a` from Relative Styling) marks none. The rows and the canvas now produce the same set of paths, and the leaf rule marks wrong rows.
- **Decided:** a part's selection box outlines its first specimen node, and only an Outline click pans. The stylebook geometry branch draws one box, and the old `findStylebookEl` returned the first match. A canvas click lands on something already on screen, so `studio.ts`'s hit handler keeps calling `selectStylebookTag` without `panCanvas`.
- **Decided:** the scope chip and the Customized filter's style source (Context, "Found while detailing") stay out of scope, because neither is §7.3's, and fixing the chip needs its own design (how a part is named, and what the project band counts when `findReferences` can only match one `tagName`). The chip goes to §6.2's owner: the finding is recorded in `plan:studio/style-sections-table`'s Context, with an Open decision on it there, and this plan neither waits for nor edits that answer. The chip reads the selection's tag path, which this plan changes only for `table`'s parts, so either landing order holds. The filter's style source has no spec item, so the landing pull request's description records it.
- **Decided:** §7.3's census marker is deleted, not rewritten as `Implemented`, matching `plan:studio/stylebook-editing-text`'s treatment of §7.4: §7.3 was unmarked before the census and §7.1 and §7.2 read as closed the same way. The code pointers move into the body.

## Implementation

1. `packages/studio/src/panels/stylebook-doc.ts`
   - Export `specimenCompound(elementTag: string, tag: string): string`, which returns ``tag === elementTag ? elementTag : `${elementTag} ${tag}` ``. Docblock: the tag path naming `tag` inside the catalogue entry `elementTag`, however deep the specimen nests it; the nested key a Stylebook edit writes (studio.md §7.3, §7.4); one spelling for the canvas's hit map and the Outline's rows. `registerSpecimenPaths` calls it in place of its inline expression (line 173).
   - Export `specimenParts(entry: StylebookEntry): StylebookEntry[]`. It walks `entry.children` depth first, keeps the first entry for each tag, and skips any entry whose tag is `entry.tag`. For the table this gives `thead`, `tr`, `th`, `tbody`, `td`.
   - `StylebookDocResult` gains `partToNodePath: Map<string, JxPath>`. Docblock: a part's path to the first specimen node it names, which is what the selection box outlines; element and component tags are absent, because their box is the card.
   - `registerSpecimenPaths(entry, path, rootTag, cardPath)`: when the compound is not `rootTag`, set `tagToCardPath` to `cardPath` and `partToNodePath` to `path` for it, each only if the map has no entry yet. `cardNode` passes its `cardPath`. `tagToCardPath`'s docblock already says "Tag/compound → the FIRST matching card", and this makes it true.
   - Return `{ doc, partToNodePath, pathToTag, tagToCardPath }`. `hasTagStyle` is unchanged, and its docblock names both readers (the Customized filter, the Outline's dot).
2. `packages/studio/src/panels/stylebook-layers-panel.ts`
   - Delete the private `hasTagStyle` and `selectedLeaf`. Import `hasTagStyle`, `specimenCompound` and `specimenParts` from `./stylebook-doc`.
   - `elementRows(entry, rootStyle, selection, out)`, with no recursion (drop `depth` and `parentPath`):
     - Push the element row: key `entry.tag`, indent `INDENT_BASE`, `customized: hasTagStyle(rootStyle, entry.tag)`, `selected: entry.tag === selection`.
     - Then, for each `part` of `specimenParts(entry)`, push a row with key `specimenCompound(entry.tag, part.tag)`, indent `INDENT_BASE + INDENT_STEP`, label ``part.text || `<${part.tag}>` ``, tag `part.tag`, `customized: hasTagStyle(rootStyle, key)` and `selected: key === selection`.
   - Component rows: `customized: hasTagStyle(rootStyle, comp.tagName)`.
   - `stylebookLayersValues` passes `selection` where it passed `leaf`.
   - Module docblock: the path's spelling and the dedupe move to `stylebook-doc.ts`, and this module decides row order, indent and the current row. `elementRows`' "there is only one `& li` to write" becomes "there is one `ul li` rule to write".
3. `packages/studio/src/canvas/iframe-host.ts`
   - The `stylebook` record on the host state (line 236) and `mountStylebookCanvas`'s `generated` parameter (line 3108) gain `partToNodePath: ReadonlyMap<string, (string | number)[]>`. The assignment at line 3116 copies it.
   - `requestStylebookSelection`: measure `host.stylebook?.partToNodePath.get(tag) ?? host.stylebook?.tagToCardPath.get(tag)`. Its docblock: a part outlines its first specimen node, an element or component its card.
   - `panToStylebookTag`: code unchanged. Its docblock adds that a part pans to its element's card.
4. `packages/studio/src/surfaces/panel-stylebook-layers.json` `$description`: "or knows what a `& tag` style key is" becomes "or knows how a tag's style key is spelled". In `surfaces/panel-stylebook-layers.ts`, `StylebookRowView.key`'s docblock example becomes "for a part its tag path (`"ul li"`, `"table td"`)".
5. Unchanged: `selectStylebookTag` (`src/panels/stylebook-panel.ts`), the hit handler in `src/studio.ts`, `src/panels/style-panel.ts`.
6. Plan housekeeping: delete this file, and delete the "Spec-wide decisions" bullet of `plans/studio/README.md` on the Stylebook tag-rule shape, which `plan:studio/stylebook-editing-text` left citing this plan.

**Integration contract.** `stylebook-doc.ts` exports `specimenCompound`, `specimenParts` and `hasTagStyle`. `StylebookDocResult` carries `partToNodePath`, and `tagToCardPath` answers for a part with its element's card. `shell.stylebook.selection` is a tag path that the Outline compares by equality. §7.3 states all of it. No plan requires this one. `plan:studio-ui-guidelines/canvas-highlight-facts` says the stylebook box is labelled with its tag, and after this plan the label can be a path (`<table td>`), so whichever lands second checks that sentence. `plan:studio-ui-guidelines/empty-state-copy` edits `tests/stylebook-layers-panel.test.ts` (the variables case), so the second to land rebases.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `tests/stylebook-doc.test.ts`
  - Add a `TABLE` entry mirroring the catalogue's table, passed to `build({ meta })`, so the existing section indices hold.
  - New `describe("tag paths")`:
    - "a part is its element's tag and its own, however deep": `specimenCompound("table", "td")` is `"table td"`, and `specimenCompound("ul", "ul")` is `"ul"`.
    - "specimenParts lists each tag inside an entry once, in first-use order, without the entry's own": `TABLE` gives `["thead", "tr", "th", "tbody", "td"]`, and a `ul > li > ul` entry gives `["li"]`.
  - Extend "pathToTag maps card/preview/specimen paths…": `tagToCardPath.get("ul li")` equals the `ul` card path, `partToNodePath.get("ul li")` equals the first `<li>`'s path, and `partToNodePath.has("ul")` is false.
  - New "a deep part maps to its element's card and its first node": with `TABLE`, the second `<tr>` (under `tbody`) decodes to `table tr`, `tagToCardPath.get("table td")` is the table's card, and `partToNodePath.get("table td")` is the first `<td>`.
  - The `hasTagStyle` case is unchanged.
- `tests/stylebook-layers-panel.test.ts`
  - "a '& tag' key with something in it…" becomes "a bare tag key with something in it customizes the row; an empty one does not": `{ h1: { color: "red" }, ul: {} }` gives `[true, false, false]`.
  - New "a part reads its nested key, the way Stylebook writes it": `{ ul: { li: { color: "red" } } }` gives `[false, true, true]`.
  - New "a rule inside a breakpoint or scheme block counts": `{ "@md": { h1: {…} }, "@--dark": { ul: { li: {…} } } }` gives `[true, true, true]`.
  - New "an `& tag` key lights nothing": `{ "& h1": { color: "red" } }` gives `[false, false, false]`.
  - New "a deep specimen lists each part once, one level in, keyed by element and part", with a local ctx holding the table entry. Keys are `["table", "table thead", "table tr", "table th", "table tbody", "table td"]`, and indents are `["8px", "24px", "24px", "24px", "24px", "24px"]`.
  - "marks the selected LEAF…" becomes "marks exactly the row whose path is the selection", with a ctx holding `p` and `blockquote > p`. Selecting `p` marks only `p`, `blockquote p` marks only itself, and `h1 :hover` marks none.
  - New "a component row carries the dot when the file styles its tag": `x-card` registered, and `{ "x-card": { display: "block" } }` sets `customized` to true.
  - The surface cases "a styled tag carries the dot…" and "emits no class of its own" reseed `{ h1: { color: "red" } }`.
- `tests/iframe-host.test.ts`, `describe("stylebook host capability")`
  - `makeGenerated` gains `["p b", CARD_PATH]` in `tagToCardPath` and `partToNodePath: new Map([["p b", NESTED_PATH]])`.
  - New "a part's selection measures its first specimen node, labelled with its path": selection `p b` posts `paths: [NESTED_PATH]`, and the geometry reply labels the box `<p b>`.
  - New "panToStylebookTag pans a part to its element's card": `panToStylebookTag("p b")` measures `CARD_PATH` on the pan request id.
- Add `partToNodePath: new Map()` to the hand-built `generated` fixtures in `tests/iframe-host.test.ts` (lines 474, 3350), `tests/iframe-host-gaps.test.ts` (line 90), `tests/iframe-host-diff-gaps.test.ts` (line 111) and `tests/canvas-idle.test.ts` (line 243). Add the field to the mounted-doc type in `tests/stylebook-panel.test.ts` (line 31).

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. `stylebook-doc.ts` gains two exported functions, both reached by the cases above. `stylebook-layers-panel.ts` loses two. Neither file is the workspace's worst, so there is no ratchet. No source file is added.

## Specs & docs

- **studio.md §7.3** (lines 768 to 776), in place, heading unchanged.
  - Delete the line-768 marker.
  - The body becomes:

    > While the pane shows Project Styles, the Outline lists the element catalogue and then the project's components. An element whose specimen has children (e.g. `ul > li`, `table > thead > tr > td`) lists each tag inside it once, one level in, in the order the specimen first uses it: a table's parts are `thead`, `tr`, `th`, `tbody` and `td`. A row selects a **tag path**. For an element or a component, that is its own tag. For a part, it is the element's tag and then the part's (`ul li`, `table td`), which is the bare nested key a Stylebook edit writes (§7.4). A part is therefore styled wherever it sits inside its element, and not only where the specimen puts it.
    >
    > Selecting a row, or the element itself on the canvas:
    >
    > - Sets `activeSelector` to the tag path, so the Style tab edits that nested rule
    > - Outlines the part's first specimen, or the element's card, labelled with its path; a row click also pans the canvas to the element's card, and a canvas click also chooses the breakpoint of the panel it landed in
    > - Opens the Style tab
    >
    > The specimen document records the tag path of every node it generates (`pathToTag` in `buildStylebookDoc`), so a canvas hit decodes to the path its row selects, and a hit on an unmapped node resolves to its nearest mapped ancestor. The row whose path equals the selection is marked current. A path that is no row, such as a rule Relative Styling nests under one (`h1 :hover`), marks none.
    >
    > A row carries a dot when the open file's own style has a non-empty rule at its tag path, either directly or inside any `@` block (a breakpoint or a colour scheme). An element's dot also lights when only one of its parts is styled, as the canvas's Customized filter counts it. The rows are drawn by `packages/studio/src/panels/stylebook-layers-panel.ts`; every path is spelled, and every dot decided, in `panels/stylebook-doc.ts` (`specimenCompound`, `specimenParts`, `hasTagStyle`).

  - If the Open decision is declined, the first paragraph instead says the Outline follows the specimen's nesting and a part's path is its chain (`table tbody tr td`), styled only where that structure occurs.
- **studio.md §7.4**, second paragraph (as `plan:studio/stylebook-editing-text` lands it), in place:
  - The bold lead becomes "**The specimen canvas, its Customized filter, the Outline's dot and the site stylesheet read that shape.**"
  - "and the Customized filter asks whether a tag's path resolves to a non-empty block" becomes "and the Customized filter and the Outline's dot (§7.3) ask whether a tag's path resolves to a non-empty block". The rest of the paragraph is unchanged.
- **Fragment:** `bun run spec:change studio.md minor -m "§7.3 a Project Styles part has one tag path, its element's tag then its own (table td), from the Outline and the canvas alike; the Outline lists each part once one level in, marks only the row equal to the selection and dots a row by the bare nested key Stylebook writes; a part's selection pans to its element's card and outlines the part; §7.4 names the Outline's dot among the readers of that key."`
- **`docs/studio/design/stylebook.md`** (its `spec:` cites `studio.md#7.4`; its `code:` lists `stylebook-layers-panel.ts`, `stylebook-doc.ts` and, once the prerequisite has moved it there, `surfaces/panel-stylebook-layers.ts`). No em dashes.
  - `spec:` gains `studio.md#7.3`.
  - "Read the catalog", last sentence: "The **Outline** panel mirrors the catalog as a tree and marks customized entries with a dot: elements with their nested parts (a table with its rows and cells), then your components." becomes "The **Outline** panel lists the catalog: each element, with the parts inside it one step in (a table's header, rows and cells), then your components. A dot marks every entry this file has styled."
  - "Style an element type", the sentence "Nested parts style as compound selections, like the header cells inside tables." becomes "A part styles as a compound selection. Clicking a table's header cell, on the canvas or in the Outline, selects `table th`, which styles every header cell inside a table whatever sits between them. The canvas outlines the first one and the Outline marks its row."
- No other page cites `studio.md#7.3` or lists a changed file. `docs/studio/design/layers.md` only links to this page. `iframe-host.ts` is in no page's `code:`.
- No graduation: studio.md keeps other open items. The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with the new cases, and no file is below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck` and `bun run lint` are clean. `grep -n 'selectedLeaf\|& \${tag}' packages/studio/src/panels/stylebook-layers-panel.ts` finds nothing.
- `sed -n '/^### 7.3 /,/^### 7.4 /p' specs/studio.md` shows no `> **Status:` line, and `grep -c "the Outline's dot and the site stylesheet read that shape" specs/studio.md` prints `1` (§7.4's readers paragraph). `grep -n "stylebook-layers-tag-keys" plans/studio/README.md` prints nothing.
- `bun run plans:status --spec studio` no longer lists §7.3. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:markdown` pass. `bun run docs:sync` names `stylebook.md`, which is in the diff.
- By hand, under `bun run dev`, open Project Styles on a project's `project.json`:
  1. Click the `li` row under `ul`. The canvas pans to the list card and outlines the first `<li>`, labelled `<ul li>`. Only that row is current.
  2. Set a colour. `project.json` holds `"ul": { "li": { "color": … } }`, and the `ul li` and `ul` rows gain dots.
  3. Click a `<td>` on the canvas. The Outline marks the `table td` row.
  4. Click the `p` row. `blockquote p` and `details p` are not marked.
- The screenshots lane re-captures `docs/images/stylebook.png` if the Outline is in frame. Re-read `stylebook.md` beside it.
