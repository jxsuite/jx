---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#12.3
requires:
  - studio-ui-guidelines/empty-state-copy
  - studio-ui-guidelines/git-panel-action-list
workspaces:
  - packages/studio
  - specs
  - docs
size: L
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

The two that fail are copies of each other (the same facts bag, required-argument skip and argument fill) that each left something out. Today the tab menu loses ⌘W (Close Document), ⌘⇧T (Reopen Closed Document) and ⌘\ (Split Right); the file menu loses ⌘⇧E (Open Library). `placedFileRows` drops the record's `destructive` on both branches: the enabled one through `treeMenuRow`'s default, the disabled one written out. No `context/tab` or `context/file` record is destructive yet, so that half is latent until the Files verbs become records. The block bar's ⋮ menu (`showCommandOverflow` in `panels/block-action-bar.ts`) takes a command list rather than a placement (a slice of `forPlacement("blockbar")`, or the outline row's overflow), already prints chord and destructive, and keeps its own divider rule.

**The rail.** `project()` in `surfaces/rail.ts` hands `rail.json` each panel's `title`, which `rail.json` binds to `label`, `hint` and the visible span alike; it reads `activeRegistry()` after the groups, for the foot. `panelFocusCommands` (`commands/defaults.ts`) binds `mod+1`…`mod+8` in `panelFocusRoster()` order, and the chord is **not** the button's position: Search is on the rail with `when: NOT_YET_BUILT`, so it holds ⌘2 invisibly and Source Control is ⌘3 (as `docs/studio/interface.md` says). A rail click runs `toggleRailPanel` → `toggleActivityTab` (toggle-visible, `aria-pressed`); the chord runs `focusPanel` in `editor/shortcuts.ts` (toggle-focus). The chord's record is titled "Show " plus the panel's title.

**The Bottom dock's close button.** `jx-action-button[part="close"]` in `surfaces/bottom-dock.json` has the literal `label` and `hint` "Close the Bottom dock" and calls the host's `closeDock`, which `panels/bottom-dock.ts` implements as `setDockCollapsed("bottom", true)`. The records are `view.setBottomDock` ("Show Bottom Dock", `{ open }`, no chord) and `view.toggleBottomDock` ("Toggle Bottom Dock", `mod+j`, on `commandbar/overflow`, no `when`) in `shellViewCommands` (`shell.ts`). The Command Bar's dock button already renders the toggle through `commandTooltip`. `renderBottomDock` disposes the chrome when the dock collapses, so the × exists only while the dock is open. `tests/bottom-dock.test.ts` clicks the × in three cases with no registry published: "the close button collapses the dock" and two Logic cases ("closing the dock over an open formula keeps it closed", "re-asking for the SAME target reopens a dock the user closed").

**The tooltip string.** "Title (chord)" or "Title — requires reason" is built by `commandTooltip(registry, id)` in `surfaces/commandbar.ts`, by a second exported `commandTooltip(registry, command)` in `panels/block-action-bar.ts` (also imported by `panels/layers-panel.ts`, asserted in `tests/blockbar-registry.test.ts`), and by hand in `surfaces/statusbar.ts`, `panels/jump-bar.ts` and `panels/ai-chat/chat-view.ts`. Each goes through `formatBinding`, so none breaks §12.3. The four `mock.module` stand-ins that stub `commandTooltip` (`studio-shell.test.ts`, `studio-shell-fixture.ts`, `studio-shell-boot-gaps.test.ts`, `shell-misc-diff-gaps.test.ts`) stub block-action-bar's copy; their Command Bar mocks carry only `mount`, `render` and `unmount`.

**What the prerequisite leaves.** Once `plan:studio-ui-guidelines/git-panel-action-list` lands, `commands/projection.ts` exists with `CommandControlView`, `commandControl(registry, id, suffix?)`, `commandTooltip(registry, id)` (moved, and re-exported by `commandbar.ts`) and `commandRow(registry, command, { dividerAbove?, args?, source? })`, which carries the stutter rule and, with a `source`, a `runReported` row; `tests/command-projection.test.ts` covers all four. The marker's Source Control clause is gone, and §10's command-rendering sentence reads "inherit §12.3's: the rail prints no chord, and the tab-strip and Files-tree menus carry none".

**Controls that run a record under words of their own.** §12.3 covers "wherever a command is rendered", and the marker names none of these (found by `plan:studio-ui-guidelines/conventions-checklist`, verified here):

| Control (document)                               | Adapter                                      | Record                                    | Record title          |
| ------------------------------------------------ | -------------------------------------------- | ----------------------------------------- | --------------------- |
| "Search appearance…" (`doc-header.json`)         | `panels/frontmatter-panel.ts`, `openSeo`     | `document.openSeo`                        | Search Appearance     |
| "Search appearance…" (`panel-page.json`)         | `panels/head-panel.ts`, `openSeo`            | `document.openSeo`                        | Search Appearance     |
| "Edit Global Styles" (`settings-overview.json`)  | `settings/general-settings.ts`, `openStyles` | `styles.open`                             | Open Project Styles   |
| "Manage contexts…" (`pane-context.json`)         | `panels/pane-context.ts`, `manageContexts`   | `settings.open { section: "contexts" }`   | Open Project Settings |
| "Content types…" (`entry-editor.json`)           | `content/entry-editor.ts`                    | `settings.open { section: "content" }`    | Open Project Settings |
| "Preferences › Accounts", twice (`publish.json`) | `publish/publish-panel.ts`, `openAccounts`   | `app.preferences { section: "accounts" }` | Preferences…          |
| "Open Layout →" (`properties-panel.json`)        | `panels/properties-panel.ts`, `openLayout`   | `pane.derive { preset: "layout" }`        | Show Beside This…     |
| the SEO modal's provenance chips                 | `panels/seo-modal.ts`, `seoProvenance`       | `settings.open { section }`               | Open Project Settings |

None takes its disabled state or its tooltip from the record. Two more doors are `plan:studio-ui-guidelines/empty-state-copy`'s, drawn through its `commandEmptyAction`: the Languages panel's "Open project settings…" (`panel-i18n.json`, disabled only when `settings.open` is unregistered) and the canvas derivation notice's `pane.pin` action (`canvas/canvas-render.ts`, built by hand, ignoring the record's `enablement`). The Content tab's bound chip (`revealSignal`) is a provenance readout whose click reveals the entry through two records; its words are the binding's, so it is not a rendering of either. `settings-css-vars.json`'s "Manage contexts…" runs no command (it switches the settings section in place).

## Outcome

`studio-ui-guidelines.md` §12.3 → Implemented at NAC1.3. Each clause of the marker:

- The tab-strip and Files-tree menus' chord and `destructive`: every placement menu takes its rows from `placementRows` (NAC1.1).
- Rail buttons' chord: the tooltip carries `panel.focus.<id>`'s chord (NAC1.2).
- The Bottom dock's close button: drawn from `view.toggleBottomDock` and run through it (NAC1.2). The marker names `view.setBottomDock` as the record the × should call, but also asks for ⌘J, which only the toggle carries; the Open decision below settles which, and §12.3 then states it.
- The Source Control rename: closed by the prerequisite.
- Not in the marker, but required by the section: the controls tabled above (NAC1.3, as the Open decision below resolves), and the two empty-state doors (the prerequisite `plan:studio-ui-guidelines/empty-state-copy`).

§10 stays Partial (its owner is `plan:studio-ui-guidelines/conventions-checklist`); its command-rendering sentence goes when §12.3 flips.

## Decisions

- **Decided:** this plan adds `placementRows` to `commands/projection.ts`, the module the prerequisite creates, and moves every placement menu onto it. Its `commandRow` is the one row; `placementRows` is the one walk (facts, required-argument skip, argument fill, group dividers) that the tab and file menus each copied and each got wrong. `plan:studio/file-tree-command-records` then draws the Files tree and the Library's per-file menu with one call each rather than a sixth projector.
- **Decided:** the projector applies, for every adopting menu, the two rules the element menu already has: a chord that restates the row's title is not printed (`commandRow`'s), and a divider falls where the record's `group` changes (studio-ui-guidelines.md §8.4). The settings menu keeps its level ordering and level dividers. No record today has a chord equal to its title, so the first rule changes no shipped row; the second gives the Files tree's placed rows the dividers §8.4 already requires.
- **Decided:** a row runs through `runReported` only when the caller names a `source` (`commandRow`'s rule). The element and ⬢ overflow menus keep their menu-wide `run`, because the element menu's bare `contextMenuRegistry().run` is on `NOT_YET_CONVERTED` in `tests/run-reported.test.ts` and converting it is `plan:studio-ui-guidelines/run-reported-sweep`'s; `activateRow` also reads the menu target before dismissal, which a row closure would not improve.
- **Decided:** `panels/block-action-bar.ts`'s `commandTooltip(registry, command)` goes, and its two callers call `projection.ts`'s `commandTooltip(registry, command.id)`, which gives the same answers for a record the registry holds. The prerequisite hands this over; two exported functions of one name and one purpose are the drift §12.3 exists to stop. The status bar's, jump bar's and chat view's inline copies stay: each composes more than the tooltip (the jump bar prefixes its segment's context, the other two also decide visibility).
- **Decided:** a rail button stays a rendering of its **panel** record: label, visible text and accessible name remain the panel's `title`, and the click stays `toggleRailPanel`. Only the tooltip changes, to `` `${title} (${chord})` `` with ``chord = keymap.formatBinding(`panel.focus.${id}`)``, or the bare title when there is none. The rail is a panel placement (studio-ui-guidelines.md §12.1, `PANEL_PLACEMENT_MATRIX`), the focus command's title is derived from the panel's, and routing the click through `panel.focus.*` would break the button's `aria-pressed` toggle (a click moves focus to the rail, so toggle-focus never sees "already there"). The chord is read by id because Search holds ⌘2 while hidden.
- **Open:** which record the Bottom dock's × renders. Recommendation: `view.toggleBottomDock`, printed like the Command Bar's dock button (accessible name "Toggle Bottom Dock", tooltip "Toggle Bottom Dock (⌘J)") and run through `runActiveReported` under "Bottom Dock", because the × exists only while the dock is open so the toggle can only close, ⌘J is that record's chord, and one record then backs both dock controls. The alternative, `view.setBottomDock { open: false }`, is idempotent but titled "Show Bottom Dock" and chordless: printing its title names a close control "Show", and printing the toggle's name over the setter's `run` is the renaming §12.3 forbids. Either way the × is drawn from the record or not at all: with no registry published the strip draws no ×, as `projectDocks` draws no dock buttons, and a disabled record draws it disabled with its `requires`.
- **Open:** how a control that runs a record under words of its own is named (the table in Context). This is the same question `plan:studio-ui-guidelines/conventions-checklist` leaves Open; the two are one sign-off. Recommendation, by what the words are:
  - A button that runs a record with no argument prints the record's title, from `commandControl`: both "Search appearance…" buttons become "Search Appearance", and "Edit Global Styles" becomes "Open Project Styles".
  - A button that runs a record with a fixed argument is named by the path the Settings menu draws to the same place: the title without its trailing ellipsis, " › ", and the argument's label from the same source the submenu reads (`menuSectionsFor` in `panels/settings-menu.ts`). "Manage contexts…" becomes "Open Project Settings › Contexts", "Content types…" becomes "Open Project Settings › Content Types", and "Preferences › Accounts" already reads so. The docs already write these paths ("Open Project Settings › Content Types" in `docs/start/first-collection.md`).
  - A link whose words name its target rather than a verb ("Open Layout →", the SEO modal's provenance chips) keeps them, and its tooltip ends with the record's: its own sentence, " · ", then `commandTooltip`, the jump bar's composition (`segmentTitle`, `panels/jump-bar.ts`).
  - In every case the tooltip carries the record's title with its chord, or its `requires` while refused, the disabled state is the record's wherever the control has one, and §12.3 gains the rule.

  If declined for the argument and link cases, §12.3's new bullet states that such a control keeps its words and takes only its tooltip and state from the record; if declined outright, the bullet scopes "rendered" to a control whose words are a command's name, and NAC1.3 is the spec edit alone.

- **Decided:** chords are read at projection time, with no keymap-change subscription, as the Command Bar, block bar and status bar read them. The rail re-projects on every shell change and on the registry being published, so a rebinding reaches its tooltip on the next re-projection; making every persistent surface follow `keymap.onChange` is one change for all of them and not §12.3's.
- **Decided:** the edges. `studio-ui-guidelines/git-panel-action-list` because it closes the marker's rename clause and creates `projection.ts` with `commandControl`, `commandTooltip` and `commandRow`, which every slice here builds on. `studio-ui-guidelines/empty-state-copy` because §12.3 cannot read Implemented while the Languages panel's door renames `settings.open` and the derivation notice ignores `pane.pin`'s `enablement`, and that plan draws both from their records. Not `studio/file-tree-command-records`: it requires this plan, and the tree's own hand rows (Open, New File…, Rename…, Delete) are not records and keep their hand flags until it lands. Not `ui/menu-radio-rows`: its radio kind is for the hidden-tabs and Value source menus, none of which this plan projects. Not `studio-ui-guidelines/run-reported-sweep` or `studio-ui-guidelines/unrendered-placements`: they touch the same files (the doors' `run`s; the pane menu, which reads `paneRows` rather than any export here), and whichever lands second rebases.
- **Decided:** the §10 marker's command sentence stops enumerating gaps at NAC1.1 and goes at NAC1.3, so no slice leaves §10 stating something false about code this plan changed; closing §10 stays with its owner.

## Implementation

Paths under `packages/studio/`. New code comments cite `studio-ui-guidelines.md §…` qualified: a bare `§` here means `studio.md` (`bun run docs:section-refs`).

**NAC1.1: one placement walk, five menus**

1. **`src/commands/projection.ts`** gains `interface PlacementRowOptions { facts?: Record<string, unknown>; source?: string; checked?: (args: Record<string, unknown>) => "true" | "false" | undefined }` and `placementRows(registry, placement: Placement, options = {}): MenuRowProjection[]`. It walks `registry.forPlacement(placement)`; when `facts` is given, it skips a record whose `args.required` the facts cannot answer and fills `args` from the facts by the schema's property names (lifted from `placedTabItems`); `dividerAbove` when a row follows an emitted row of another `group`; `commandRow(registry, command, { args, dividerAbove, source })`; then `checked` when the hook returns a value. The header gains studio-ui-guidelines.md §8.4 and `@docs studio/interface` if absent.
2. **`src/panels/tab-strip.ts`**: `placedTabItems(tab)` becomes `registry ? placementRows(registry, "context/tab", { checked: statedChecked, facts: tabRowFacts(tab), source: "Tabs" }) : []`. `tabRowFacts`, `statedChecked` and their doc comments stay; the doc comment on `placedTabItems` gains "its chord" among what a row prints.
3. **`src/files/files.ts`**: `placedFileRows(entry)` becomes `placementRows(registry, "context/file", { facts: fileRowFacts(entry), source: "Files" })` behind the existing no-registry guard. `treeMenuRow` stays for the tree's own rows; its doc comment says so.
4. **`src/editor/context-menu.ts`**: `buildRows(placement)` becomes `placementRows(contextMenuRegistry(), placement)`; its stutter comment goes (the rule is `commandRow`'s). `activateRow` is untouched. **`src/surfaces/commandbar.ts`**: `overflowRows(registry)` becomes `placementRows(registry, "commandbar/overflow")`; the menu-wide `run` stays. **`src/panels/settings-menu.ts`**: `buildSettingsMenuRows` keeps its level sort, level divider, `children`, `submenuLabel` and unconditional `run`, and takes the rest from `{ ...commandRow(registry, command, { dividerAbove }), children, run, submenuLabel }`.
5. **`src/panels/block-action-bar.ts`**: delete `commandTooltip(registry, command)`; `toolOf` calls `commandTooltip(registry, command.id)` from `../commands/projection`. **`src/panels/layers-panel.ts`** imports it from there too. The four shell stand-ins drop their now-dead `commandTooltip` stub from the block-action-bar mock.

**NAC1.2: the rail and the dock's close button**

6. **Rail.** `src/surfaces/rail.ts`: `RailButton` gains `hint: string`; `project()` moves its `activeRegistry()` read above the groups and sets `hint` per the rail decision. `src/surfaces/rail.json`: the button's `hint` prop binds `{ "$ref": "$map/item/hint" }`; `label` and the span keep `title`. The module header's accessibility paragraph adds that the tooltip carries the panel's focus chord.
7. **Bottom dock** (as the Open decision is recommended):
   - `src/surfaces/bottom-dock.ts`: `BottomDockValues` gains `close: CommandControlView` (type import from `../commands/projection`); `project()` copies it; `BottomDockActions.closeDock`'s comment becomes "the ×, which runs the dock's toggle record".
   - `src/surfaces/bottom-dock.json`: the × moves under a wrapper whose `$switch` on `#/state/close/visible` draws the button for `"true"` and nothing otherwise (the shape `rail.json`'s foot uses); `label` binds `#/state/close/label`, `hint` `#/state/close/hint`, `disabled` `#/state/close/disabled`. The literals go; `part="close"`, `data-action="close"` and the `[part="close"]` style stay.
   - `src/panels/bottom-dock.ts`: `const DOCK_CLOSE_COMMAND = "view.toggleBottomDock"`. `bottomDockValues()` sets `close: commandControl(activeRegistry(), DOCK_CLOSE_COMMAND)`; it is called inside `renderBottomDock`, so the mount effect tracks the registry holder and the × appears when the registry is published. `closeDock` becomes `void runActiveReported(DOCK_CLOSE_COMMAND, undefined, "Bottom Dock")`. The `setDockCollapsed` import goes if nothing else uses it.

**NAC1.3: the doors, and the flip** (as the second Open decision is recommended)

8. Each adapter in the Context table builds a `CommandControlView` inside the projection its surface already tracks, and its document binds the label text, `hint` and `disabled` from it in place of the literal:
   - `frontmatter-panel.ts` and `head-panel.ts` (`document.openSeo`) and `general-settings.ts` (`styles.open`): `commandControl(activeRegistry(), id)`.
   - `pane-context.ts` and `entry-editor.ts` (`settings.open`), `publish-panel.ts` (`app.preferences`, both buttons): `doorControl(activeRegistry(), id, sectionLabel)`, new in `projection.ts`, returns `commandControl`'s view with `label` = `` `${title.replace(/…$/, "")} › ${sectionLabel}` `` and `hint` rebuilt from that label in `commandControl`'s shapes (`commandControl`'s `suffix` cannot drop the ellipsis). The section's label is read through `menuSectionsFor`, which `panels/settings-menu.ts` now exports.
   - `properties-panel.ts` ("Open Layout →", which keeps its `layoutCanOpen` gate) and `seo-modal.ts` (provenance chips): the words stay; the tooltip is `commandTooltip(registry, id)`, after the chip's own sentence and " · " where it has one.
   - Their `run`s are untouched here: converting them to `runActiveReported` is `plan:studio-ui-guidelines/run-reported-sweep`'s.
9. At landing, confirm `git grep -n "Create GitHub repository" packages/studio/src` is empty and that `panel-i18n.json` no longer spells "Open project settings…" (the prerequisites' work); if either is not, this slice does not flip the marker.

**Integration contract.** After NAC1.1, `commands/projection.ts` also exports `placementRows(registry, placement, { facts?, source?, checked? })`: a menu that renders a placement calls it, and its rows carry title, the taught chord, `requires`, record-derived `destructive` and group dividers with no further code; passing `source` makes each enabled row run through `runReported`. `plan:studio/file-tree-command-records` draws the Files tree and the Library's per-file menu from `placementRows(registry, "context/file", { facts, source })` (adding its `omit`), and a record it declares `destructive: true` (Delete) is drawn as such. `panels/block-action-bar.ts` no longer exports `commandTooltip`. After NAC1.2, `BottomDockValues.close` is a `CommandControlView`. After NAC1.3, §12.3 states the rail, dock-close and door rules in **Specs & docs**, and `doorControl` and `menuSectionsFor` are exported.

## Tests

`packages/studio`, `bun test --isolate --coverage` from the workspace directory. DOM suites keep `./harness` as their first import.

**NAC1.1**

- **`tests/command-projection.test.ts`** (the prerequisite's file, which already covers `commandRow`; a registry built with `createCommandRegistry({ getContext, mac: true })`):
  - `placementRows skips a record whose required argument the facts cannot answer, and fills args by name`.
  - `placementRows with no facts projects every record in the placement`.
  - `placementRows divides where the group changes, and never above the first row`.
  - `with a source, a placed row runs through runReported with the filled args` (a `run` throwing `RangeError`; `problems` holds `[source, message]`).
  - `checked is read back from the args the row would run with`.
- **`tests/tab-strip.test.ts`**, "tab context menu": `labelOf` also subtracts the `[slot=value]` text, since rows now print a chord. New: `a row prints its record's chord: Close Document, Reopen Closed Document and Split Right` (each `kbd` equals `registry.keymap.formatBinding(id)`, and Keep Document Open has none); `a destructive context/tab record draws its row destructive` (a fixture record in `publishRegistry`'s set; it passes today and guards the move).
- **`tests/files-tree.test.ts`**, "file context menu": `a declared row prints its record's chord and takes destructive from the record` (fixture `context/file` record requiring `file`, with a keybinding and `destructive: true`; fails today on both); `declared rows divide where the group changes` (two fixtures, `1_file` and `5_data`; one more `hr` in the menu).
- **`tests/blockbar-registry.test.ts`**: the three tooltip assertions import `commandTooltip` from `../src/commands/projection` and pass `id`.
- Unchanged and must stay green: `context-menu.test.ts`, `commandbar.test.ts`, `settings-menu.test.ts`, `surfaces-menu.test.ts`, `layers-panel-*.test.ts`, `run-reported.test.ts` (`projection.ts` calls `runReported`, never a bare `run`).

**NAC1.2**

- **`tests/rail.test.ts`**: `a rail button's tooltip carries its panel's focus chord, read by id` (a registry holding `panelFocusCommands({ ...noopCommandDeps(), panelRoster: panelFocusRoster() })` and the Preferences row, `mac: true`: Files hints "Files (⌘1)", Source Control "Source Control (⌘3)", and its `aria-label` is still "Source Control"); `a rebinding reaches the tooltip on the next projection` (`keymap.setOverrides`, then `render()`). The existing bare-title hint case stays, as the no-record branch.
- **`tests/bottom-dock.test.ts`**: the file-level `beforeEach` publishes a registry of `shellViewCommands({ inspectorTab: () => "properties", setInspectorTab: () => {} })` with `mac: true`, and `afterEach` clears it, so the two Logic cases that click the × keep working. "the close button collapses the dock" becomes `the close button is the Toggle Bottom Dock record: its name, its chord, and its run` (aria-label "Toggle Bottom Dock", `hintOf` "Toggle Bottom Dock (⌘J)", a click collapses the dock). New: `a refusal from the close button is filed under Bottom Dock` (a fixture record of that id whose `run` throws `RangeError`); `with no registry the strip draws no close button, and publishing one draws it`. "the projection, without a host" asserts `close` too.

**NAC1.3**

- The door cases in `tests/frontmatter-panel.test.ts`, `tests/head-panel.test.ts`, `tests/general-settings.test.ts`, `tests/pane-context.test.ts`, `tests/entry-editor.test.ts`, `tests/publish-panel.test.ts`, `tests/properties-panel.test.ts` and `tests/seo-modal.test.ts` assert the new label (or the kept words), a tooltip that ends with `commandTooltip(registry, id)`, and, for a button, the control disabled with its `requires` when the record's `enablement` refuses. Each fails today on the tooltip.
- `tests/command-projection.test.ts`: `doorControl drops the title's ellipsis, joins the argument's label, and builds the hint from that label`. `tests/settings-menu.test.ts`: `menuSectionsFor` lists `settings.open`'s sections as the submenu does.

**Coverage.** Per-file thresholds `lines = 0.958, functions = 0.941` (`packages/studio/bunfig.toml`). `projection.ts` is the prerequisite's new file, already in the manifest; its new functions ship with the cases above, so it stays at 100%. No new source file. No workspace's worst file moves, so no ratchet.

## Specs & docs

`specs/studio-ui-guidelines.md`, in place.

**NAC1.1.** §12.3's marker: delete "the tab-strip and Files-tree menus build their rows with no `chord`, and `src/files/files.ts` hard-codes `destructive: false`;" and add, as its last clause, that controls opening a place by command (`document.openSeo`, `styles.open`, `settings.open`, `app.preferences`, `pane.derive`) print words of their own and take neither tooltip nor state from the record. §10's command-rendering sentence ends "inherit §12.3's open part." instead of listing gaps. Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "§12.3: the tab-strip and Files-tree menus print their records' chords and destructive flags, and the marker names the controls that open a place by command under words of their own"`.

**NAC1.2.** §12.3's marker: delete the rail and Bottom dock clauses. Two bullets join "Consequences", after "No surface renames a command": **"A rail entry is a panel, and its chord is its focus command's."** The button's label and accessible name are the panel's `title`, its tooltip carries `panel.focus.<id>`'s binding beside it, and the chord is read by id, never counted from the button's position. **"A dock's close control is the dock's toggle."** The Bottom dock's × prints `view.toggleBottomDock`'s title and chord and runs it, as the Command Bar's dock button does; the × exists only while the dock is open, so the toggle can only close. (Reworded if the Open decision lands the other way.) Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§12.3: rail buttons carry their panel's focus chord, and the Bottom dock's close button is the Toggle Bottom Dock record"`.

**NAC1.3.**

- §12.3's marker becomes: `> **Status: Implemented.** Every surface that renders a command prints its title, chord and requires from the record through formatBinding: the Command Bar and the palette (packages/studio/src/surfaces/commandbar.ts, src/panels/quick-search.ts); every menu that renders a placement, whose rows src/commands/projection.ts builds (the element, tab-strip, Files-tree, ⬢ and Settings menus); the block bar and the outline's row verbs (src/panels/block-action-bar.ts, src/panels/layers-panel.ts); the rail (src/surfaces/rail.ts); the Bottom dock's × (src/panels/bottom-dock.ts); and every control that opens a place by command.` (paths in backticks as the other markers write them).
- One bullet joins "Consequences", after the dock bullet: **"A door is named by where it goes."** A control that runs a record with no argument prints its title. One that runs it with a fixed argument is named by the Settings menu's path to the same place: the title without its trailing ellipsis, then "›", then the argument's label ("Open Project Settings › Contexts"). A link whose words name its target keeps them, and its tooltip ends with the record's. Each takes its disabled state from the record. (Reworded to the scope the Open decision settles.)
- §10: delete the sentence "The two command-rendering items, … inherit §12.3's open part." and lower the count before it by two ("Five inherit" reads "Three inherit" if no other owner has landed); the marker stays Partial.
- Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§12.3: every control that opens a place by command is named from its record, by the title or the Settings menu's path to the same place, and takes its tooltip and state from it, so every invoking surface prints the name and the chord"`.

**Docs** (no em dashes; `bun run docs:sync` names these through `code:`):

- NAC1.2, `docs/studio/interface.md`: under "Navigator rail", after "Clicking the button of the panel that's already open collapses the Navigator…", add "Hover a button, or move focus to it, and its tooltip shows the panel's shortcut beside its name." Under "Bottom dock", "or close it with the **×** in its tab strip" becomes "or close it with the **×** in its tab strip, which is **Toggle Bottom Dock** (:kbd[⌘J]), the same command as the Command Bar's dock button." `code:` gains `packages/studio/src/commands/projection.ts` if the prerequisite has not added it.
- NAC1.3: `docs/studio/editing/frontmatter.md` ("a **Search appearance…** button" becomes "a **Search Appearance** button"; the section heading keeps its anchor); `docs/studio/projects/settings.md` ("**Edit Global Styles**" becomes "**Open Project Styles**", "**Manage contexts…** footer" becomes "**Open Project Settings › Contexts** footer"). Re-run `bun run docs:sync` for the pages the other door files name, and `grep -rn` `docs/` for each old label.
- Checked, no change: `docs/studio/interface/tabs.md` and `docs/studio/interface/canvas.md` (they describe what the menus offer, not how a row prints; "Open Layout →" keeps its words), `docs/start/studio-tour.md`, `docs/studio/interface/modes.md`, `docs/studio/interface/problems-and-progress.md`, `docs/studio/logic/formula-workspace.md` and `docs/studio/interface/preferences.md`.

studio-ui-guidelines.md keeps other open items, so it does not graduate.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#12.3`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass after every slice.
- `git grep -n "formatBinding(command.id)" packages/studio/src/editor/context-menu.ts packages/studio/src/panels/settings-menu.ts packages/studio/src/panels/tab-strip.ts packages/studio/src/files/files.ts packages/studio/src/surfaces/commandbar.ts` prints nothing, and `git grep -n "export function commandTooltip" packages/studio/src` prints only `commands/projection.ts` (NAC1.1).
- `git grep -n "Close the Bottom dock" packages/studio/src` prints nothing (NAC1.2); `git grep -n -e "Search appearance…" -e "Edit Global Styles" -e "Content types…" packages/studio/src/surfaces` and `git grep -n "Manage contexts…" packages/studio/src/surfaces/pane-context.json` print nothing (NAC1.3).
- From `packages/studio`: `bun test --isolate --coverage` passes with no per-file threshold failure, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- In Studio (the `packages/studio:verify` recipe, on macOS glyphs): the Files rail button's tooltip reads "Files (⌘1)" and Source Control's "Source Control (⌘3)"; right-clicking a tab shows ⌘W, ⌘⇧T and ⌘\ beside their rows; right-clicking a file shows ⌘⇧E beside Open Library; the Bottom dock's × tooltip reads "Toggle Bottom Dock (⌘J)" and clicking it closes the dock; the Page panel's door reads "Search Appearance" and its tooltip names the command. The screenshots lane re-captures any shot showing these surfaces; review the changed images and the pages it lists.

## Slices

| Slice  | Scope                                                                                                                                                      | Claims                       | State |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----- |
| NAC1.1 | `placementRows`; the element, tab-strip, Files-tree, ⬢ and Settings menus on it; block-action-bar's `commandTooltip` folded in; §12.3 and §10 marker trims | —                            | open  |
| NAC1.2 | The rail's focus-chord tooltip; the Bottom dock's × drawn from and run through `view.toggleBottomDock`; §12.3's rail and dock bullets                      | —                            | open  |
| NAC1.3 | The doors drawn from their records; §12.3's door bullet and the flip; §10's sentence goes                                                                  | studio-ui-guidelines.md#12.3 | open  |
