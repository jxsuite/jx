---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#12.3
requires:
  - studio-ui-guidelines/git-panel-action-list
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# The rail, the Bottom dock's close button and every command menu print each record's name and chord, and no surface renames or restyles a command

## Context

`specs/studio-ui-guidelines.md` §12.3, line 801:

> **Status: Partial.** The Command Bar, the palette, the element menu and the block bar print title, chord and `requires` through `formatBinding` (`packages/studio/src/surfaces/commandbar.ts`, `src/panels/quick-search.ts`, `src/surfaces/menu.ts`). Rail buttons print no chord although `panel.focus.*` binds one (`src/surfaces/rail.ts`); the tab-strip and Files-tree menus build their rows with no `chord`, and `src/files/files.ts` hard-codes `destructive: false`; the Bottom dock's close button carries its own label, prints no ⌘J, and calls the dock setter rather than `view.setBottomDock` (`src/surfaces/bottom-dock.json`, `src/panels/bottom-dock.ts`); and the Source Control panel's "Create GitHub repository" renames `git.createGithubRepository` (`src/surfaces/git-panel.json`).

Verified against the tree; paths below are under `packages/studio/src/`.

**The menus.** Five functions turn `forPlacement` records into `MenuRowProjection`s (`surfaces/menu.ts`), each written out by hand:

| Function                | Module                    | chord  | destructive from record | group divider |
| ----------------------- | ------------------------- | ------ | ----------------------- | ------------- |
| `buildRows`             | `editor/context-menu.ts`  | yes    | yes                     | yes           |
| `overflowRows`          | `surfaces/commandbar.ts`  | yes    | yes                     | yes           |
| `buildSettingsMenuRows` | `panels/settings-menu.ts` | yes    | yes                     | by level      |
| `placedTabItems`        | `panels/tab-strip.ts`     | **no** | yes                     | yes           |
| `placedFileRows`        | `files/files.ts`          | **no** | **no**                  | **no**        |

The two that fail are copies of each other (the same facts bag, required-argument skip and argument fill) that each left something out. Today the tab menu loses ⌘W (Close Document), ⌘⇧T (Reopen Closed Document) and ⌘\ (Split Right); the file menu loses ⌘⇧E (Open Library). `placedFileRows` drops the record's `destructive` on both branches: the enabled one through `treeMenuRow`'s default, the disabled one written out. No `context/tab` or `context/file` record is destructive yet, so that half is latent until the Files verbs become records. The block bar's ⋮ menu (`showCommandOverflow` in `panels/block-action-bar.ts`) already prints chord and destructive and is not a `forPlacement` menu.

**The rail.** `project()` in `surfaces/rail.ts` hands `rail.json` each panel's `title`, which `rail.json` binds to `label`, `hint` and the visible span alike. `panelFocusCommands` (`commands/defaults.ts`) binds `mod+1`…`mod+8` in `panelFocusRoster()` order, and the chord is **not** the button's position: Search is on the rail with `when: NOT_YET_BUILT`, so it holds ⌘2 invisibly and Source Control is ⌘3 (as `docs/studio/interface.md` says). A rail click runs `toggleActivityTab` (toggle-visible, `aria-pressed`); the chord runs `focusPanel` in `editor/shortcuts.ts` (toggle-focus). The chord's record is titled "Show " plus the panel's title.

**The Bottom dock's close button.** `jx-action-button[part="close"]` in `surfaces/bottom-dock.json` has the literal `label` and `hint` "Close the Bottom dock" and calls the host's `closeDock`, which `panels/bottom-dock.ts` implements as `setDockCollapsed("bottom", true)`. The records are `view.setBottomDock` ("Show Bottom Dock", `{ open }`, no chord) and `view.toggleBottomDock` ("Toggle Bottom Dock", `mod+j`, on `commandbar/overflow`) in `shellViewCommands` (`shell.ts`). The Command Bar's dock button already renders the toggle through `commandTooltip`. `renderBottomDock` disposes the chrome when the dock collapses, so the × exists only while the dock is open.

**Source Control.** `surfaces/git-panel.json` spells "Create GitHub repository" as literal `textContent` twice (the no-repository empty state and the local-only sync bar); the record's title is "Create GitHub Repository". `plan:studio-ui-guidelines/git-panel-action-list` draws both buttons from that record for §12.5.

**The tooltip string.** "Title (chord)" or "Title — requires reason" is built by `commandTooltip` in `surfaces/commandbar.ts` and again, by hand, in `panels/block-action-bar.ts`, `surfaces/statusbar.ts`, `panels/jump-bar.ts` and `panels/ai-chat/chat-view.ts`. Each goes through `formatBinding`, so none breaks §12.3; they are noted because the rail and the dock need the same string.

## Outcome

- `studio-ui-guidelines.md` §12.3 → Implemented.
- `studio-ui-guidelines.md` §10 stays Partial (its owner is `plan:studio-ui-guidelines/conventions-checklist`), with the §12.3 evidence removed from its marker.

## Decisions

- **Decided:** one module, `commands/projection.ts`, owns what a command prints: `commandTooltip` (moved), `commandRow` (one record to one row) and `placementRows` (a placement to rows, with the facts-and-arguments walk the tab and file menus share). All five `forPlacement` menus call it, because the two broken menus are copies that each forgot a field, and a sixth copy (the Library's per-file menu, the pane menu) is already queued behind other plans. `formatBinding` is the one chord formatter; this makes the row the one row.
- **Decided:** the projector applies, for every adopting menu, the two rules the element menu already has: a chord that restates the row's title is not printed, and a divider falls where the record's `group` changes (studio-ui-guidelines.md §8.4). The settings menu keeps its level ordering and level dividers. No record today has a chord equal to its title, so the first rule changes no shipped row; the second gives the Files tree's placed rows the dividers §8.4 already requires.
- **Decided:** a row carries a `run` of its own (through `runReported`, under a surface name) only when the caller names a `source`. The element and ⬢ overflow menus keep their menu-wide `run`, because the element menu's bare `contextMenuRegistry().run` is on `NOT_YET_CONVERTED` in `tests/run-reported.test.ts` and converting it belongs to `plan:studio-ui-guidelines/run-reported-sweep`; `activateRow` also reads the menu target before dismissal, which a row closure would not change for the better.
- **Decided:** a rail button stays a rendering of its **panel** record: label, visible text and accessible name remain the panel's `title`, and the click stays `toggleActivityTab`. Only the tooltip changes, to `` `${title} (${chord})` `` with ``chord = keymap.formatBinding(`panel.focus.${id}`)``, or the bare title when there is none. The rail is a panel placement (studio-ui-guidelines.md §12.1, `PANEL_PLACEMENT_MATRIX`), the focus command's title is derived from the panel's, and routing the click through `panel.focus.*` would break the button's `aria-pressed` toggle (a click moves focus to the rail, so toggle-focus never sees "already there"). The chord is read by id because Search holds ⌘2 while hidden.
- **Open:** which record the Bottom dock's × renders. Recommendation: `view.toggleBottomDock`, printed like the Command Bar's dock button (accessible name "Toggle Bottom Dock", tooltip "Toggle Bottom Dock (⌘J)") and run through `runReported` under "Bottom Dock", because the × exists only while the dock is open so the toggle can only close, ⌘J is that record's chord, and one record then backs both dock controls. The alternative, `view.setBottomDock { open: false }`, is idempotent but titled "Show Bottom Dock" and chordless: printing its title names a close control "Show", and printing the toggle's name over the setter's `run` is the renaming §12.3 forbids. Either way the × is drawn from the record or not at all: with no registry published the strip draws no ×, as `projectDocks` draws no dock buttons, and a disabled record draws it disabled with its `requires`.
- **Decided:** chords are read at projection time, with no keymap-change subscription, as the Command Bar, block bar and status bar read them. The rail re-projects on every shell change and on the registry being published, so a rebinding reaches its tooltip on the next re-projection; making every persistent surface follow `keymap.onChange` is one change for all of them and not §12.3's.
- **Decided:** the edges. `requires: studio-ui-guidelines/git-panel-action-list` stays, because the marker names the renamed label and a literal fix here would be a third copy of the record's title. Not `studio/file-tree-command-records` (the cross-spec critic's suggestion): the projector needs no Files record, a fixture record proves `destructive` from the record, and landing this first lets that plan reduce `fileMenuRows` to one `placementRows` call and draw the Library's per-file menu with the same call instead of writing a sixth projector; the tree's own hand rows (Open, New File…, Rename…, Delete) are not records and keep their hand flags until it lands. Not `ui/menu-radio-rows`: its radio kind is for the hidden-tabs and Value source menus, none of which this plan projects, and the tab menu's stated-checkbox rows keep `checked`.
- **Decided:** this plan also trims §10's marker, dropping the clause that the rail prints no chord and the tab-strip and Files-tree menus carry none, and leaves the marker Partial, because it would otherwise state something false about code this plan changes; closing §10 stays with its owner.

## Implementation

Paths under `packages/studio/`. New code comments cite `studio-ui-guidelines.md §…` qualified: a bare `§` here means `studio.md` (`bun run docs:section-refs`).

1. **New `src/commands/projection.ts`** (header: what a command prints, citing studio-ui-guidelines.md §12.3 and §8.4; `@docs studio/interface`):
   - `commandTooltip(registry, id): string`, moved verbatim from `surfaces/commandbar.ts`. `commandbar.ts` keeps `export { commandTooltip } from "../commands/projection";`, so `commandbar.test.ts` and the four test files that `mock.module` the Command Bar with a `commandTooltip` stub need no edit.
   - `interface CommandRowOptions { dividerAbove?: boolean; args?: CommandArgs; source?: string }` and `commandRow(registry, command: AnyCommand, options = {}): MenuRowProjection`: `id` and `title` from the record; `chord` from `registry.keymap.formatBinding(command.id)`, omitted when absent or equal to the title ignoring case; `reason = registry.disabledReason(command.id)` gives `disabled` and `requires`; `destructive: command.destructive === true`; `dividerAbove`; and, when `source` is given and the row is enabled, `run: () => void runReported(registry, command.id, options.args, options.source)`.
   - `interface PlacementRowOptions { facts?: Record<string, unknown>; source?: string; checked?: (args: Record<string, unknown>) => "true" | "false" | undefined }` and `placementRows(registry, placement: Placement, options = {}): MenuRowProjection[]`: walk `registry.forPlacement(placement)`; when `facts` is given, skip a record whose `args.required` the facts cannot answer and fill `args` from the facts by the schema's property names (lifted from `placedTabItems`/`placedFileRows`); `dividerAbove` when a row follows an emitted row of another `group`; `commandRow(…, { args, dividerAbove, source })`; then `checked` when the hook returns a value.
   - Imports: `import type { MenuRowProjection } from "../surfaces/menu"` (type only, so no runtime edge into the surface), `runReported`, and the `AnyCommand`, `CommandArgs`, `CommandRegistry` and `Placement` types.
2. **`src/panels/tab-strip.ts`**: `placedTabItems(tab)` becomes `registry ? placementRows(registry, "context/tab", { checked: statedChecked, facts: tabRowFacts(tab), source: "Tabs" }) : []`. `tabRowFacts`, `statedChecked` and their doc comments stay; the doc comment on `placedTabItems` gains "its chord" among what a row prints.
3. **`src/files/files.ts`**: `placedFileRows(entry)` becomes `placementRows(registry, "context/file", { facts: fileRowFacts(entry), source: "Files" })` behind the existing no-registry guard. `treeMenuRow` stays for the tree's own rows only; its doc comment says so.
4. **`src/editor/context-menu.ts`**: `buildRows(placement)` becomes `placementRows(contextMenuRegistry(), placement)`; the stutter comment moves to `commandRow`. `activateRow` is untouched. **`src/surfaces/commandbar.ts`**: `overflowRows(registry)` becomes `placementRows(registry, "commandbar/overflow")`; the menu-wide `run` stays. **`src/panels/settings-menu.ts`**: `buildSettingsMenuRows` keeps its level sort, level divider, `children`, `submenuLabel` and its unconditional `run`, and takes the rest from `{ ...commandRow(registry, command, { dividerAbove }), children, run, submenuLabel }`.
5. **Rail.** `src/surfaces/rail.ts`: `RailButton` gains `hint: string`; `project()` reads `activeRegistry()` once at the top (it already does, for the foot) and sets `hint` per the rail decision. `src/surfaces/rail.json`: the button's `hint` prop binds `{ "$ref": "$map/item/hint" }`; `label` and the span keep `title`. The module header's accessibility paragraph adds that the tooltip carries the panel's focus chord.
6. **Bottom dock** (as the Open decision is recommended):
   - `src/surfaces/bottom-dock.ts`: `BottomDockValues` gains `close: string` (the record id, empty for none), `closeTitle`, `closeHint` and `closeDisabled`; `project()` copies them; `BottomDockActions.closeDock`'s comment becomes "the ×, which runs the dock's toggle record".
   - `src/surfaces/bottom-dock.json`: the × moves under a wrapper whose `$switch` on `#/state/close` draws nothing for `""` and the button otherwise (the shape `rail.json`'s foot uses); `label` binds `#/state/closeTitle`, `hint` `#/state/closeHint`, `disabled` `#/state/closeDisabled`. The literals go; `part="close"`, `data-action="close"` and the `[part="close"]` style stay.
   - `src/panels/bottom-dock.ts`: `const DOCK_CLOSE_COMMAND = "view.toggleBottomDock"`. `bottomDockValues()` reads `activeRegistry()` (inside `renderBottomDock`, so the mount effect tracks the holder and the × appears when the registry is published) and fills `close`, `closeTitle` (`registry.get(id).title`), `closeHint` (`commandTooltip(registry, id)`) and `closeDisabled` (`registry.disabledReason(id) !== undefined`), or `close: ""` when the registry or record is absent. `closeDock` becomes `const registry = activeRegistry(); if (registry) void runReported(registry, DOCK_CLOSE_COMMAND, undefined, "Bottom Dock");`. Drop the `setDockCollapsed` import if nothing else uses it.
7. **Source Control**: nothing here. At landing, confirm `git grep -n "Create GitHub repository" packages/studio/src` is empty (the prerequisite's work); if it is not, the prerequisite has not closed that clause and this plan does not flip the marker.

**Integration contract.** Once this lands, `commands/projection.ts` exports `commandTooltip(registry, id)`, `commandRow(registry, command, { dividerAbove?, args?, source? })` and `placementRows(registry, placement, { facts?, source?, checked? })`. A menu that renders a placement calls `placementRows`, and its rows carry title, the taught chord, `requires`, record-derived `destructive` and group dividers with no further code; passing `source` makes each enabled row run through `runReported`. `plan:studio/file-tree-command-records` can draw both the Files tree and the Library's per-file menu from `placementRows(registry, "context/file", { facts, source })`, and a record it declares `destructive: true` (Delete) is drawn as such. `plan:studio-ui-guidelines/unrendered-placements` can render `context/pane` and `context/layer` the same way and give the status bar's items their tooltip through `commandTooltip`. §12.3's text states the rail and dock-close rules below.

## Tests

`packages/studio`, `bun test --isolate --coverage` from the workspace directory.

- **New `tests/command-projection.test.ts`** (first import `./harness`; a registry built with `createCommandRegistry({ getContext, mac: true })`):
  - `commandRow prints the title, the chord through formatBinding, and destructive from the record` (`mod+\\` → `⌘\`).
  - `a chord that restates the title is not printed`.
  - `a disabled record's row carries its requires sentence and no run`.
  - `with a source, an enabled row runs through runReported and a refusal is filed under that source` (a `run` throwing `RangeError`; `problems` holds `[source, message]`).
  - `without a source a row carries no run of its own`.
  - `placementRows skips a record whose required argument the facts cannot answer, and fills args by name`.
  - `placementRows with no facts projects every record in the placement`.
  - `placementRows divides where the group changes, and never above the first row`.
  - `checked is read back from the args the row would run with`.
- **`tests/tab-strip.test.ts`**, "tab context menu": `labelOf` also subtracts the `[slot=value]` text, since rows now print a chord. New: `a row prints its record's chord: Close Document, Reopen Closed Document and Split Right` (each `kbd` equals `registry.keymap.formatBinding(id)`, and Keep Document Open has none); `a destructive context/tab record draws its row destructive` (a fixture record added to `publishRegistry`'s set).
- **`tests/files-tree.test.ts`**, "file context menu": `a declared row prints its record's chord and takes destructive from the record` (fixture `context/file` record requiring `file`, with a keybinding and `destructive: true`); `declared rows divide where the group changes` (two fixtures, `1_file` and `5_data`; one more `hr` in the menu).
- **`tests/rail.test.ts`**: `a rail button's tooltip carries its panel's focus chord, read by id` (registry from `panelFocusCommands({ ...noopCommandDeps(), panelRoster: panelFocusRoster() })` plus the settings row: Files hints "Files (⌘1)", Source Control "Source Control (⌘3)", and its `aria-label` is still "Source Control"); `a rebinding reaches the tooltip on the next projection` (`keymap.setOverrides` then `renderActivityBar()`). The existing case asserting a bare-title hint stays, as the no-record branch.
- **`tests/bottom-dock.test.ts`**: "the close button collapses the dock" becomes `the close button is the Toggle Bottom Dock record: its name, its chord, and its run` (registry from `shellViewCommands` with stub deps, `mac: true`; aria-label "Toggle Bottom Dock", `hintOf` "Toggle Bottom Dock (⌘J)", a click collapses the dock). New: `a refusal from the close button is filed under Bottom Dock` (fixture record of that id whose `run` throws); `with no registry the strip draws no close button, and publishing one draws it`. Update "the projection, without a host" for the new fields.
- Unchanged and must stay green: `context-menu.test.ts`, `commandbar.test.ts`, `settings-menu.test.ts`, `surfaces-menu.test.ts`, `run-reported.test.ts` (the new module calls `runReported`, never a bare `run`).
- Coverage: per-file thresholds `lines = 0.958, functions = 0.941` (`packages/studio/bunfig.toml`). `commands/projection.ts` is a new source file and ships with its test in the same pull request, reaching 100%, so `bun scripts/check-coverage-manifest.ts packages/studio` finds it. No workspace's worst file moves, so no ratchet.

## Specs & docs

**`specs/studio-ui-guidelines.md` §12.3**, in place:

- The marker becomes: `> **Status: Implemented.** Every surface that renders a command prints its title, chord and requires from the record. The Command Bar and the palette (packages/studio/src/surfaces/commandbar.ts, src/panels/quick-search.ts); every menu that renders a placement, through one projection (src/commands/projection.ts: the element, tab-strip, Files-tree, ⬢ and Settings menus), so chord, destructive and the disabled sentence are decided once; the block bar (src/panels/block-action-bar.ts); the rail, whose tooltip carries each panel's focus chord (src/surfaces/rail.ts); and the Bottom dock's ×, which is view.toggleBottomDock (src/panels/bottom-dock.ts).` (paths in backticks as the other markers write them).
- Two bullets join "Consequences", after "No surface renames a command": **"A rail entry is a panel, and its chord is its focus command's."** The button's label and accessible name are the panel's `title`, its tooltip carries `panel.focus.<id>`'s binding beside it, and the chord is read by id, never counted from the button's position. **"A dock's close control is the dock's toggle."** The Bottom dock's × prints `view.toggleBottomDock`'s title and chord and runs it, as the Command Bar's dock button does; the × exists only while the dock is open, so the toggle can only close. (Reworded if the Open decision lands the other way.)

**§10**: in the marker, drop "the rail prints no chord, the tab-strip and Files-tree menus carry none" and the "§12.3's" attribution from the command-rendering sentence (whatever of it the prerequisite left), adjusting the count of inherited items; the marker stays `Partial`.

Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§12.3: every menu that renders a placement takes its rows from one projection that prints the chord and the destructive flag from the record, rail buttons carry their panel's focus chord, and the Bottom dock's close button is the Toggle Bottom Dock record"`.

**Docs** (no em dashes; `bun run docs:sync` names the pages below):

- `docs/studio/interface.md`: under "Navigator rail", after "Clicking the button of the panel that's already open collapses the Navigator…", add "Hover a button, or move focus to it, and its tooltip shows the panel's shortcut beside its name." Under "Bottom dock", "or close it with the **×** in its tab strip" becomes "or close it with the **×** in its tab strip, which is **Toggle Bottom Dock** (:kbd[⌘J]), the same command as the Command Bar's dock button." `code:` gains `packages/studio/src/commands/projection.ts`.
- Checked, no change: `docs/studio/interface/tabs.md` and `docs/studio/interface/canvas.md` (they describe what the menus offer, not how a row prints), `docs/start/studio-tour.md`, `docs/studio/interface/modes.md`, `docs/studio/interface/problems-and-progress.md`, `docs/studio/logic/formula-workspace.md`, `docs/studio/projects/settings.md` and `docs/studio/interface/preferences.md`.

studio-ui-guidelines.md keeps other open items, so it does not graduate.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#12.3`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `git grep -n -e "Close the Bottom dock" -e "Create GitHub repository" packages/studio/src` prints nothing.
- `git grep -n "formatBinding(command.id)" packages/studio/src/editor/context-menu.ts packages/studio/src/panels/settings-menu.ts packages/studio/src/panels/tab-strip.ts packages/studio/src/files/files.ts packages/studio/src/surfaces/commandbar.ts` prints nothing: menu rows format their chord in `commands/projection.ts` alone.
- From `packages/studio`: `bun test --isolate --coverage` passes with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- In Studio (the `packages/studio:verify` recipe, on macOS glyphs): the Files rail button's tooltip reads "Files (⌘1)" and Source Control's "Source Control (⌘3)"; right-clicking a tab shows ⌘W, ⌘⇧T and ⌘\ beside their rows; right-clicking a file shows ⌘⇧E beside Open Library; the Bottom dock's × tooltip reads "Toggle Bottom Dock (⌘J)" and clicking it closes the dock. The screenshots lane re-captures any shot showing these menus; review the changed images and the pages it lists.
