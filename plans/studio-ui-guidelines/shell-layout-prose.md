---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#3.1
  - studio-ui-guidelines.md#3.2
requires: []
workspaces:
  - specs
  - docs
  - packages/studio
size: S
---

# Layout draws the shell frame as it ships: four rows, three docks, and the Assistant inside the Inspector

## Context

`specs/studio-ui-guidelines.md` §3.1, line 118:

> **Status: Partial.** The dock defaults (240/280px, `DOCK_DEFAULTS`), the status bar's `role="status"` live region, and a collapsed dock zeroing its variable and hiding its region and handle with a `localStorage` round trip ship (`packages/studio/styles/shell-frame.json`, `src/shell.ts`, `src/surfaces/shell.json`). The diagram does not: the `#app` rows are toolbar, panes, a 220px Bottom dock and the status bar; the rail is 56px; the tab strip lives in each pane's cell; and there is no Assistant column or `--panel-w-chat`, because the Assistant is a tab of the Inspector dock.

§3.2, line 142:

> **Status: Partial.** The docks do not share one anatomy; there are three. The Inspector dock is a header naming the tab and its target over a `jx-tabs` strip and a body (`packages/studio/src/surfaces/inspector-dock.json`). The Bottom dock has no header: a strip holding its `jx-tabs` and a close button sits over one tab panel (`src/surfaces/bottom-dock.json`). The Navigator dock has no tab strip: one body per panel, each under a header naming the panel and its containment level when the panel declares one, with the panel chosen from the activity rail (`src/surfaces/navigator-dock.json`).

The spec still draws the five-column, six-row shell that predates the labelled rail and the pane grid: a full-width "Tab strip / context bar / frontmatter" row, a 48px activity bar of 48x48 icon tabs, an Assistant column with `--panel-w-chat: 320px`, and "the assistant column starts collapsed". §3.2 says "Both left and right panels follow the same anatomy" (tabs, scrolling body, sections). Re-verified on 2026-09-27:

- **The grid.** `#app` in `packages/studio/styles/shell-frame.json` is `grid-template-rows: 36px minmax(0, 1fr) var(--dock-h-bottom) 24px` and `grid-template-columns: [rail] 56px [nav] var(--panel-w-left) [pane] 1fr [insp] var(--panel-w-right)`. The rail, `#left-panel` and `#right-panel` span rows 2 and 3; `#pane-grid` is row 2 and `#bottom-dock` row 3 of the `pane` column; the toolbar and `#statusbar` span the full width. `--dock-h-bottom` is declared (220px) on `:root` in `shell-frame.json`; `--panel-w-left`/`--panel-w-right` (240px/280px) in `styles/tokens.json`.
- **The docks' record.** `DOCK_DEFAULTS` in `packages/studio/src/shell.ts` (bottom collapsed at 220, left and right open at 240 and 280, with a comment saying why the Bottom dock starts closed); `DOCK_DEFAULT_SIZES` is the double-click reset; `applyDockLayout()` writes the three variables inline on `document.documentElement` and toggles `left-collapsed`/`right-collapsed`/`bottom-collapsed` on `#app`, whose rules zero the variable and hide the region and its handle; `persistDocks()` is the one writer of the one `localStorage` record, read in both directions by `createShellState()`. `resetProjectShell()` keeps the record across a project switch, because the docks describe the workspace.
- **The cells.** `packages/studio/src/surfaces/shell.json`: `#toolbar` (region `commandbar`), `#pane-grid`, `#activity-bar` (region `rail`), `#left-panel`, three `jx-split` handles (`ui.md` §5.5), `#bottom-dock`, `#right-panel` (region `inspector`, "Four tabs … all inside this one host") and `#statusbar` with `role="status"` and `aria-live="polite"`.
- **The pane cell.** `packages/studio/src/surfaces/pane-grid.json`: each `[part="pane"]` is a two-row grid, the strip in row 1 and the jump bar, context bar (`[part="chrome"]`) and stage stacked in row 2. The frontmatter the old row named is the Document Header card, drawn in the stage (`surfaces/doc-header.json`).
- **The rail's 56px is a decision, not drift.** It arrived with the labelled rail (commit 13d027e2: "The rail is 56px with an 11px label under every icon"); every button is a `stacked` `jx-action-button` (`surfaces/rail.json`), which `ui.md` §5.1 calls "the rail's shape".
- **The Assistant.** `studio.md` §3.1: "There is no assistant column." `panels/right-panel.ts` mounts it under `case "assistant"`; `panels/ai-panel.ts` reveals it with `setInspectorTab("assistant")`.
- **The three docks.** `inspector-dock.json`: `header[part="header"]` (`header-title`, `header-target`), `jx-tabs[part="tabs"]`, four keyed `jx-tab-panel[part="panel"]`, each with an empty `[part="panel-body"]` island; header and tabs are fixed, the panel scrolls, the Assistant's panel does not (its chat scrolls itself). `bottom-dock.json`: `[part="strip"]` holding `jx-tabs[part="tabs"]` and `jx-action-button[part="close"]`, over one `jx-tab-panel[part="panel"]` with an empty `[part="dock-body"]`; no header. `navigator-dock.json`: no tab strip.
- **Correction to the §3.2 marker.** The Navigator dock draws **one** body, not one per panel: a keyed `$map` of exactly one row whose key is the panel showing, so switching panels destroys and rebuilds it. Its header is present whenever the panel resolves; `panelView()` in `panels/left-panel.ts` sets `hasHeader: false` only when `shell.leftTab` names no panel the context admits. `#left-panel` (`overflow-y: auto`) is the scroller, and the Files tree fills it and scrolls itself (`surfaces/files-panel.json`).
- **The status bar is not "the app's one status channel".** `services/announce.ts` owns two more live regions (polite `status`, assertive `alert`), which §13.1a specifies, and `studio.md` §16.2 limits the bar to ambient state.

Nothing cites §3.1 or §3.2: no docs page's `spec:` names either anchor, no Standards Alignment row binds §3, and no code comment cites them. The nearest docs page, `docs/studio/interface.md` (`spec: studio.md#3.1`), matches the new text except one note: "dock widths and which docks are collapsed carry over to your next session, per project" (line 197), where the dock record is workspace-wide.

## Outcome

- `studio-ui-guidelines.md` §3.1 → Implemented: the diagram and its bullets draw the four-row, four-column frame, the pane cell, the Bottom dock and the status bar as `shell-frame.json`, `shell.json` and `src/shell.ts` ship them.
- `studio-ui-guidelines.md` §3.2 → Implemented: three dock anatomies, each named by its document.
- If the Open decision below is accepted, `lint:styles` fails when §3.1's two quoted track lists stop matching `#app`.
- `docs/studio/interface.md` stops saying the docks are remembered per project.
- The spec stays Partial (twenty-odd other items), so nothing graduates.

## Decisions

- **Decided:** `reconcile`, because every difference is a later design the code carries on purpose and a sibling spec already states: the Assistant as a tab (`studio.md` §3.1, §6), the Bottom dock under the panes and starting closed (`studio.md` §16.3, the `DOCK_DEFAULTS` comment), the strip inside the pane cell (`studio.md` §18.3, `#app`'s `$description`), and the 56px labelled rail (`studio.md` §5.1, `ui.md` §5.1).
- **Decided:** §3.1 keeps a diagram and the geometry, and points at `studio.md` for each reason in one clause, because `studio.md` §3.1 is a four-row table with no sizes, so this is the one place a contributor reads the frame's geometry, while the reasons already have a home.
- **Decided:** §3.1 quotes `#app`'s two track lists verbatim, gives the three first-run sizes once (attributed to `DOCK_DEFAULTS`), and names no class, part or storage key, because the named track lists are the frame's own statement, while the handles' `resize-handle` class is due to become a part (`plan:ui/surface-classes-to-parts`) and the record's shape is `studio.md` §3.1's. The bullets stay bullets: `guidelineTokenFindings()` in `packages/studio/scripts/check-styles.ts` reads every table row in the file whose first cell is a backticked `--` token and whose third is backticked as a §1.1 token row.
- **Decided:** the status-bar bullet drops "the app's one status channel" and says the bar carries ambient state only, with outcomes announced through §13.1a's regions, because two more live regions exist and the phrase read as though outcomes belonged in the bar, which `studio.md` §16.2 forbids.
- **Decided:** §3.2 keeps its heading and describes each dock by how it switches its contents (tabs with a header, tabs with a close button, the rail), naming the document for each and no parts, because the part names are each document's own style hooks and the anatomy is what a new dock's author needs.
- **Decided:** fix `docs/studio/interface.md`'s "per project" note in the same pull request, because the new §3.1 bullet says the dock record survives a project switch and the note says the opposite; named layouts, which are per project, are already documented at line 46 of that page.
- **Open:** does §3.1's geometry get a gate, as §1.1's token table has? Recommendation: yes, a `guidelineFrameFindings()` check in `packages/studio/scripts/check-styles.ts` that holds the two quoted track lists to `#app` in `styles/shell-frame.json`, because §1.1 states the principle ("A correction without a gate only resets the clock"), the frame changed twice without the diagram following, `check-styles.ts` already reads this spec for §1.1, and `lint:styles` runs in `checks` on every pull request. The cost is a `packages/studio` leg on an otherwise paper plan. If declined, drop Implementation step 3 and `packages/studio` from `workspaces`, and the plan is paper.

## Implementation

1. **`specs/studio-ui-guidelines.md` §3.1.** Replace the marker, the diagram and the five bullets with the text in Specs & docs. The heading stays.
2. **`specs/studio-ui-guidelines.md` §3.2.** Replace the marker and everything under it (the "Both left and right panels" sentence and the three-item list) with the text in Specs & docs. The heading stays.
3. **The gate** (only if the Open decision is accepted), `packages/studio/scripts/check-styles.ts`:
   - Beside `guidelineTokenFindings`, add and export `guidelineFrameFindings(specMd: string, frameJson: string): Finding[]`. It slices §3.1 out of `specMd` (from the line opening `### 3.1 ` to the next line opening `### `), matches ``/`grid-template-(rows|columns):\s*([^`]+)`/g`` inside that slice, and compares each quoted list, whitespace-squashed (the `squash` idiom `guidelineTokenFindings` uses), with the same property of `JSON.parse(frameJson).style["#app"]`. Findings, all with `file: "specs/studio-ui-guidelines.md"`, `line: 0`: a mismatch names the axis and both values; a missing §3.1, or a slice with no quote for an axis, is itself a finding ("§3.1 quotes no grid-template-rows track list: the bullet moved, and this rule stopped checking anything"), after the "parsed to zero rows" precedent; an absent `#app` rule is a finding naming `styles/shell-frame.json`.
   - `StyleCheckResult` gains `guidelineFrame: Finding[]`, documented as "The track lists `studio-ui-guidelines.md` §3.1 quotes that disagree with `#app` in `shell-frame.json`."
   - `collect()` reads `join(root, "styles", "shell-frame.json")` with `.catch(() => "")` beside the `tokens.css` read, and returns `guidelineFrame: frameJson === "" || guidelinesMd === "" ? [] : guidelineFrameFindings(guidelinesMd, frameJson)`, the shape `guidelineTokens` has.
   - `report()` destructures `guidelineFrame`, prints `❌ N track list(s) in studio-ui-guidelines.md §3.1 disagree with styles/shell-frame.json:` and each finding's text, and adds `guidelineFrame.length > 0` to the failing condition.
   - While in the package: `DOCK_CSS_VAR`'s comment in `packages/studio/src/shell.ts` says both variables carry a fallback "in `styles/tokens.css`"; `--dock-h-bottom`'s is in `styles/shell-frame.json`. Correct the clause. Comment only.
4. **`docs/studio/interface.md`**, the `:::doc-note` under "Inspector" (line 197), as given in Specs & docs.
5. **Fragment** (Specs & docs). Delete this file in the same pull request; no other plan cites it.

**Integration contract.** No plan requires this one. Once it lands, §3.1 is the geometry of `#app` and §3.2 the anatomy of each dock. A plan that adds, removes or resizes a grid track edits §3.1's Tracks bullet and diagram in the same change (with the gate, `lint:styles` fails until it does). A plan that changes a dock's chrome keeps its §3.2 item true: `plan:studio-ui-guidelines/name-and-chord-gaps` makes the Bottom dock's × a command record drawn only while a registry exists, which "the button that closes the dock" already covers; `plan:ui/surface-classes-to-parts` renames the handles' class, which §3.1 does not name. With the gate, `guidelineFrameFindings` is exported and `StyleCheckResult` carries `guidelineFrame`.

## Tests

With the gate: `bun test --isolate --coverage` from `packages/studio`, then `bun scripts/check-coverage-manifest.ts packages/studio`. No new source file. In `packages/studio/tests/check-styles-orphans.test.ts`:

- `describe("guidelineFrameFindings")`:
  - `accepts §3.1 when both track lists match #app`: a two-bullet §3.1 fixture against a `shell-frame.json` fixture yields `[]`, including when the quote's whitespace differs.
  - `catches the rail width the spec kept drawing`: a §3.1 quoting `[rail] 48px` against a frame declaring `56px` yields one finding naming `grid-template-columns` and both values.
  - `a list quoted outside §3.1 does not count`: the same quote under `### 3.2` yields the "quotes no … track list" finding for that axis.
  - `a §3.1 with no quoted list is itself the finding` and `a missing §3.1 is itself the finding`.
  - `a frame with no #app rule is a finding`.
- `describe("report")`: `a §3.1 track list that disagrees fails the run`: `report({ ...empty, guidelineFrame: [finding] })` is `1` and the output names §3.1. The `empty` fixture gains `guidelineFrame: []`, as does the `StyleCheckResult` literal in `tests/gate-scripts-diff-gaps.test.ts` (line 136), or tsc refuses both.

Coverage: `check-styles.ts` is held per file to `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`; every new branch has a case above, and the `collect()` line mirrors `guidelineTokens`', which the existing `collect` fixture already runs. No ratchet unless the worst file moves. `bun --cwd packages/studio run lint:styles` passes against the real spec and frame.

The paper half is proved in `checks`: `bun run docs:status` (the two `Implemented` markers), `bun run plans:check` (no `claim-not-open`, no dangling citation), `bun run docs:spec-release` (the body change carries its fragment), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` (the `interface.md` note), `bun run docs:markdown`.

## Specs & docs

**`studio-ui-guidelines.md` §3.1**, under the unchanged heading:

````markdown
> **Status: Implemented.** The grid is `#app` in `packages/studio/styles/shell-frame.json` (generated into `shell-frame.css`), its cells are `src/surfaces/shell.json`, and the dock record, its first-run sizes and its projection onto the grid are `src/shell.ts` (`DOCK_DEFAULTS`, `applyDockLayout()`, `persistDocks()`).

```
┌────────────────────────────────────────────────────────────────┐
│ Command Bar                                                    │  36px
├──────┬───────────┬───────────────────────────────┬─────────────┤
│ Rail │ Navigator │ Pane grid, a cell per pane    │ Inspector   │
│      │ dock      │ ┌───────────────────────────┐ │ dock        │
│      │           │ │ Tab strip                 │ │             │
│      │           │ │ Jump bar                  │ │ Content ·   │  1fr
│      │           │ │ Context bar               │ │ Style ·     │
│      │           │ │ Stage (the canvas)        │ │ Logic ·     │
│      │           │ └───────────────────────────┘ │ Assistant   │
│      │           ├───────────────────────────────┤             │
│      │           │ Bottom dock (starts closed)   │             │  220px
├──────┴───────────┴───────────────────────────────┴─────────────┤
│ Status bar                                                     │  24px
└────────────────────────────────────────────────────────────────┘
  56px     240px                  1fr                   280px
```

- **Tracks.** `#app` is `grid-template-rows: 36px minmax(0, 1fr) var(--dock-h-bottom) 24px` by `grid-template-columns: [rail] 56px [nav] var(--panel-w-left) [pane] 1fr [insp] var(--panel-w-right)`. The columns are named, so a dock or a pane cell is placed by name (`grid-column: pane`) rather than by counting.
- **Command Bar:** 36px, the full width.
- **Rail:** 56px, rows 2 and 3. Every button is a `stacked` `jx-action-button` (`ui.md` §5.1) printing its title under its icon, and 56px is the width that label needs (`studio.md` §5.1).
- **Navigator and Inspector docks:** rows 2 and 3, `--panel-w-left` and `--panel-w-right`.
- **Pane grid:** row 2 of the pane column, one cell per pane, at most two (`studio.md` §18.1). Each cell holds its own pane's tab strip, jump bar, context bar and stage (`studio.md` §18.3); no strip is an application row.
- **Bottom dock:** row 3 of the pane column only, `--dock-h-bottom`. It sits under the panes, so opening it never narrows a side dock (`studio.md` §16.3).
- **No Assistant column.** The Assistant is the Inspector dock's fourth tab (`studio.md` §3.1, §6): showing it costs no width, and there is no `--panel-w-chat`.
- **Status bar:** 24px, the full width, `role="status"` + `aria-live="polite"`. It carries ambient state only (`studio.md` §16.2); an outcome is announced through §13.1a's regions and never written here.
- **Sizes.** First-run sizes are 240px, 280px and 220px (`DOCK_DEFAULTS`), and a double-click on a dock's handle restores its own. `applyDockLayout()` writes each size as an inline custom property on `document.documentElement`, and each variable also carries a declared fallback (`styles/tokens.json` for the widths, `styles/shell-frame.json` for the height), because an unset variable inside a `grid-template-*` track list voids the whole declaration and the first frame would paint with no grid.
- **Handles.** Each dock's resize handle is a `jx-split` (`ui.md` §5.5), a separator the keyboard can move. The side handles span rows 2 and 3; the Bottom dock's lies along its top edge.
- **Collapse.** A collapsed dock sets its size variable to `0px` and `display: none`s its region and its handle. The side docks start open and the Bottom dock starts collapsed. Each dock's size and collapsed flag round-trip through one `localStorage` record in both directions (a remembered "open" must reopen a default-closed dock), and the record describes the workspace, so it survives a project switch.
````

**`studio-ui-guidelines.md` §3.2**, under the unchanged heading:

```markdown
> **Status: Implemented.** `packages/studio/src/surfaces/inspector-dock.json`, `bottom-dock.json` and `navigator-dock.json`, with their adapters `src/panels/right-panel.ts`, `bottom-dock.ts` and `left-panel.ts`.

The three docks have three anatomies, because each switches its contents a different way. Each document draws the dock's chrome and leaves the body an empty island its adapter fills (§9.4).

1. **Inspector dock:** a header naming the tab and what it is pointed at (`studio.md` §6), a `jx-tabs` strip of its four tabs, and one `jx-tab-panel` per tab. The header and the strip stay put and only the selected panel scrolls, except the Assistant's, whose chat owns its scrolling.
2. **Bottom dock:** no header. One strip holds the dock's `jx-tabs` (`studio.md` §16.3) and the button that closes the dock, over one `jx-tab-panel` that draws the selected tab's body. The strip stays put and the panel scrolls.
3. **Navigator dock:** no tab strip, because the rail chooses its panel (`studio.md` §5.1). It draws one body, for the panel showing, under a header naming the panel and its containment level (`studio.md` §13.2); the header is left out only when the remembered panel names nothing the current context admits. The body is keyed on the panel, so switching panels replaces it rather than reusing it. The dock's cell is the scroller, and a panel that windows its rows (the Files tree) fills the cell and scrolls itself.

The two headers draw alike: the name in small uppercase, then a dimmed second field after a `·`. Inside a body, content is accordion sections (§5) or a flat list, depending on what the panel shows.
```

Run `bunx oxfmt specs/studio-ui-guidelines.md` afterwards; the fence is formatter-owned.

**Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§3.1 draws the shell grid as it ships, four rows with the Bottom dock under the panes, a 56px labelled rail and no Assistant column, and §3.2 gives each of the three docks its own anatomy"`. With the gate, append ", and lint:styles holds §3.1's track lists to the frame" before the closing quote.

**Docs** (no em dashes). No page's `spec:` cites `studio-ui-guidelines.md#3.1` or `#3.2`, and no page's `code:` lists `check-styles.ts` or `src/shell.ts`, so `docs:sync` names nothing. One page changes on the merits:

- `docs/studio/interface.md`, the `:::doc-note` under "Inspector": "Studio remembers your layout: dock widths and which docks are collapsed carry over to your next session, per project." becomes "Studio remembers your docks: their widths and which ones are collapsed carry over to your next session, whichever project you open. Named layouts are remembered per project."
- `docs/start/studio-tour.md`: no change; it names regions and tabs and states no geometry.

No spec graduates. Landing deletes this file.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` lists neither `studio-ui-guidelines.md#3.1` nor `#3.2`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `awk '/^### 3\.1 /,/^## 4\./' specs/studio-ui-guidelines.md | grep -niE "panel-w-chat: 320|48px|activity bar|column starts collapsed|same anatomy"` prints nothing.
- The quoted tracks are the shipped ones: `bun -e 'const a = (await Bun.file("packages/studio/styles/shell-frame.json").json()).style["#app"]; const s = await Bun.file("specs/studio-ui-guidelines.md").text(); const q = String.fromCharCode(96); for (const k of ["grid-template-rows", "grid-template-columns"]) if (!s.includes(q + k + ": " + a[k] + q)) console.log("drift", k)'` prints nothing.
- With the gate: `bun --cwd packages/studio run lint:styles` passes; changing `[rail] 56px` to `[rail] 48px` in §3.1 locally makes it exit 1 naming §3.1 and both values.
- `grep -n "per project" docs/studio/interface.md` prints only the layouts sentence and the new note's last sentence.
