---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#5.3
requires: []
workspaces:
  - packages/studio
  - docs
size: M
---

# Every Studio section is driven by a setter the kit's toggle feeds, and keeps its state on the tab it describes

## Context

`specs/studio-ui-guidelines.md` §5.3, line 345:

> **Status: Partial.** Neither pattern ships as written. Every section is driven by an explicit setter fed from the kit's toggle detail, `(key, open)`: `toggleSection` in `packages/studio/src/panels/style-panel.ts`, `setSectionOpen` in `panels/elements-panel.ts` (over `view.elementsCollapsed`), `toggleCategory` in `panels/signals-panel.ts`, and `setInspectorSection` behind `inspector.setSection`, which retired the flip-style toggle. The Inspector's state lives per tab in two maps, `session.ui.styleSections` for the Style tab and `session.ui.inspectorSections` for the Properties tab (`src/panels/properties-panel.ts`), not in the document.

The body under the marker gives two JavaScript patterns: a "Module-local Set" whose `onToggle(key)` flips membership and calls `rerender()`, and a "State object" with `isSectionOpen(key)` defaulting to true and a `toggleSection(key)` that flips. Neither exists. There is no `isSectionOpen`; `inspector.toggleSection` is a retired id (`packages/studio/tests/automation.test.ts`); and the Style tab's sections default to closed (`?? false` in `panels/style-panel.ts`), opened only by `autoOpenSections` (`panels/style-utils.ts`), which tells "never decided" from "closed" by `undefined` against `false`. The kit side is settled: `jx-accordion-item` re-announces its `toggle` with `detail` set to the new open state and stops it at the element (`packages/ui/components/jx-accordion-item.json`, `ui.md` §5.4).

**What exists** (verified 2026-09-27; 13 `jx-accordion-item`s in six surface documents)

| Surface (`packages/studio/src/surfaces/`) | Sections                                                                                     | `ontoggle` target                                                                                 | Where the state lives                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `style-panel.json`                        | Style tab, one per css-meta section                                                          | `toggleSection(key, open)` (`ACTIONS` in `panels/style-panel.ts`)                                 | `tab.session.ui.styleSections`                                                    |
| `properties-panel.json`, `content` case   | Content tab                                                                                  | `setSection(key, open)` → `setInspectorSection`                                                   | `tab.session.ui.inspectorSections`                                                |
| `properties-panel.json`, `layout` case    | the Layout Element card                                                                      | **none**; `$props.open` is the literal `true`                                                     | the `<details>` alone                                                             |
| `logic-panel.json`                        | Logic tab: Repeating list, Condition, Events, Observed Attributes, CSS Properties, CSS Parts | `setSection(id, open)` → `setInspectorSection(SECTION_KEYS[id], open)` (`panels/events-panel.ts`) | `tab.session.ui.inspectorSections` (`__repeater`, …)                              |
| `panel-elements.json`                     | Insert: Components and each palette category                                                 | `setComponentsOpen(open)`, `setSectionOpen(name, open)` (`panels/elements-panel.ts`)              | `view.elementsCollapsed` (`src/view.ts`), one Set per window                      |
| `panel-signals.json`                      | Data: State, Computed, Data, Expressions, Functions                                          | `toggleCategory(key, open)` (`ACTIONS` in `panels/signals-panel.ts`)                              | `_collapsedSignalCats` on the `SignalsPanelState` object: **lost at every paint** |
| `doc-header.json`                         | the document header's Raw head tags                                                          | `setRawOpen(open)` (`makeActions` in `panels/frontmatter-panel.ts`)                               | `_rawOpen`, a module-level `Set<string>` of tab ids                               |

The marker is right about the setter shape and wrong in four places:

- **The Data panel forgets a collapse.** `signalsView` keeps the record as `S._collapsedSignalCats ||= new Set()` on the object it is handed. That object is `NavigatorPanelContext.doc`, which `navigatorDocument()` in `panels/left-panel.ts` builds as a fresh literal on every Navigator paint, and `toggleCategory` itself ends in `repaint()`, which is such a paint. So the category projects `open: true` again from an empty Set, and a panel switch and back reopens every category. No test sees it because `tests/signals-panel-fixture.ts` reuses one `S` across repaints, and "a section collapses and re-expands, and the panel remembers which" (`tests/signals-panel-template.test.ts`) reads only the `<details>` the test itself set.
- **The document header keeps a module Set.** `_rawOpen` is keyed by tab id, so it behaves per tab, but it outlives the tab (only `unmount()`, which only tests call, clears it) and is exactly the module-local store the marker's rewrite would forbid. `data-explorer.ts` already moved the Data panel's row expansion off a module Set into `ui.dataRows` for this reason.
- **The Layout Element card has no setter,** so the "every section" in the marker is false.
- **The Logic tab writes `inspectorSections` too,** not only the Content ("Properties") tab. Yet `INSPECTOR_SECTION_KEYS` omits `__repeater`, `__condition` and `__events`, so `inspector.setSection` refuses them until the reader has clicked each once, although the constant's own comment says "the key space is the INSPECTOR's, not one tab's, so `inspector.setSection` keeps addressing all of them".

**Related**

- `ui.md` §5.4 (`jx-accordion-item` re-announces `toggle` and stops it at the element).
- `studio.md` §3.3 (state model). The rewrite does not cite it: §3.3 says nothing about `session.ui`, and `plan:_shared/studio-state-contract` rewrites it around the document transaction.

## Outcome

studio-ui-guidelines.md §5.3 → Implemented. §5.3 specifies one binding (projected `open`, and the `toggle` detail handed to a setter that writes the new state) and a table of where each surface's state lives. Every section in Studio matches it: the Data panel's categories and the Raw head tags live in the tab's session, the Layout Element card has a setter, `inspector.setSection` addresses every fixed section the Content and Logic tabs draw, and no section setter is named `toggle…`. A test walks every surface document and holds the binding.

## Decisions

- **Decided:** disposition `implement`, not the stub's `reconcile`, because the rewrite states a rule three surfaces break today (the Data panel loses its record every paint, the header keeps a module Set, the Layout card has no setter). Each fix is a few lines, and without them the spec would have to describe a defect as the design.
- **Decided:** a per-document section store is a `Record<string, boolean>` on `tab.session.ui`, one record per surface: the two new ones are `dataCategories` and `headerSections`. A missing key is the surface's default and a write is a new object, as `setInspectorSection` does. Neither goes into `inspectorSections`, because `inspectorSectionKeys()` accepts every recorded key, so a Data category or `raw` written there would become something `inspector.setSection` accepts.
- **Open:** do the Data panel's categories remember per tab or per window? Recommendation: per tab. The categories group the open document's own entries, `docs/studio/logic/data.md` already says the rows are "remembered per tab", and `ui.dataRows` and `ui.dataLimits` are per tab for the same reason. Only the Insert palette is per window, because it lists the project's elements rather than a document's.
- **Decided:** rename the two setters still called `toggle…`: the Style tab's `toggleSection` to `setSection` and the Data panel's `toggleCategory` to `setCategory`. The structural test then refuses a `toggle…` target, because the name is all that still reads as the retired flip. The shot contract refuses `toggle*` command ids for the same reason (`scripts/screenshots/README.md`, rule 1).
- **Decided:** the Layout Element card goes through `setSection("__layout", …)` over `isInspectorSectionOpen("__layout", true)`. `INSPECTOR_SECTION_KEYS` gains `__layout`, `__repeater`, `__condition` and `__events`, so the rule has no exception and `inspector.setSection` addresses every fixed section before it has been touched. `__props` and attribute-schema sections stay recorded-only, as the constant's comment decides today.
- **Decided:** §5.3 tabulates the stores and does not list setter names or section keys. Those names are adapter detail, and the test holds the binding. So `plan:desktop/component-scope-sections`, which replaces Insert's `setComponentsOpen` with keyed `setSectionOpen` sections in the same store, needs no §5.3 edit and no edge either way.
- **Decided:** §5.1 is not edited. `plan:studio-ui-guidelines/accordion-styling-facts` owns §5.1's corrections, and its placeholder `"open": "${$scope/isOpen}"` stays a structural sketch whose real binding §5.3 now gives. The two plans edit different sections, so neither requires the other.

## Implementation

1. `packages/studio/src/tabs/tab.ts`: `TabUi` gains `dataCategories: Record<string, boolean>` (the Data panel's category disclosures by `CATEGORY_LABELS` key; missing means open; per tab for the reason `dataRows` is) and `headerSections: Record<string, boolean>` (the document header's disclosures by key, `raw` today; missing means closed). `createDefaultUi()` initialises both to `{}`.
2. `packages/studio/src/panels/signals-panel.ts`:
   - Delete `_collapsedSignalCats` from `SignalsPanelState`, and the `S._collapsedSignalCats ||= new Set()` pair from `signalsView`.
   - Add `function categoryOpen(key: string): boolean`, returning `activeTab.value?.session.ui.dataCategories[key] ?? true`. The category loop in `signalsView` projects `open: categoryOpen(key)`.
   - In `ACTIONS`, replace `toggleCategory` with `setCategory: (key, open)`. It returns when there is no active tab; otherwise it writes `tab.session.ui.dataCategories = { ...tab.session.ui.dataCategories, [key]: open }` and calls `repaint()`.
   - In the doc comment, cite `studio-ui-guidelines.md §5.3` (qualified, because a bare `§` in `packages/studio` means `studio.md`).
3. `packages/studio/src/surfaces/panel-signals.ts`: rename `SignalsActions.toggleCategory` to `setCategory` (the adapter spreads `actions` into the scope, so nothing else moves). `packages/studio/src/surfaces/panel-signals.json`: the category item's `ontoggle` target `#/state/toggleCategory` becomes `#/state/setCategory`.
4. `packages/studio/src/panels/frontmatter-panel.ts`:
   - Delete `_rawOpen` and its `_rawOpen.clear()` in `unmount()`.
   - `viewFor` projects `rawOpen: tab.session.ui.headerSections.raw ?? false`.
   - `makeActions`' `setRawOpen` writes `tab.session.ui.headerSections = { ...tab.session.ui.headerSections, raw: open }`. Keep its "Per DOCUMENT rather than per pane" comment, now true by construction.
   - In `mount()`'s effect, add `void tab.session.ui.headerSections;` inside the per-tab loop, so a second stage showing the same tab re-projects the disclosure rather than disagreeing with the first.
5. `packages/studio/src/panels/style-panel.ts`: rename `ACTIONS.toggleSection` to `setSection` (body unchanged). `packages/studio/src/surfaces/style-panel.ts`: rename `StylePanelActions.toggleSection` to `setSection`. `packages/studio/src/surfaces/style-panel.json`: the section item's `#/state/toggleSection` becomes `#/state/setSection`.
6. `packages/studio/src/panels/properties-panel.ts`:
   - `INSPECTOR_SECTION_KEYS` gains `"__layout"`, `"__repeater"`, `"__condition"` and `"__events"`. Its doc comment names every Logic-drawn key, and the `inspector.setSection` `section` argument description lists the same fixed keys.
   - `layoutView()` projects `layoutOpen: isInspectorSectionOpen("__layout", true)`.
   - The right panel's effect already tracks `tab.session.ui.inspectorSections`, so a command write re-projects the card.
7. `packages/studio/src/surfaces/properties-panel.ts`: `ContentPanelView` gains `layoutOpen: boolean`, `emptyContentView()` sets `layoutOpen: true`, and `project()` assigns `scope.layoutOpen`. `packages/studio/src/surfaces/properties-panel.json`, `cases.layout`: the item's `$props.open` becomes `{ "$ref": "#/state/layoutOpen" }`, and it gains an `ontoggle` whose body is one `call` of `#/state/setSection` with `["__layout", { "$ref": "event#/detail" }]`, the shape `logic-panel.json` uses.
8. `packages/studio/tests/signals-panel-fixture.ts`: `drawSignals`' `renderLeftPanel` builds a fresh `S` on every call, the way `navigatorDocument()` does, instead of mutating one record. Write this and the extended Data-panel test first: they fail against today's code, which proves the defect before the fix.

**Integration contract.** Once this lands:

- Every `jx-accordion-item` in `packages/studio/src/surfaces/*.json` binds `$props.open` by `$ref`, and its `ontoggle` is one `call` of a `#/state/…` setter that is not named `toggle…` and takes `event#/detail` as its last argument. `tests/section-open-state.test.ts` fails a surface that does otherwise, so a plan that adds sections (as `plan:desktop/component-scope-sections` does) must take that shape; as drafted, it does.
- `TabUi.dataCategories` and `TabUi.headerSections` exist and start `{}`.
- `INSPECTOR_SECTION_KEYS` includes `__layout`, `__repeater`, `__condition` and `__events`.
- §5.3 carries the store table. A plan that adds a surface with its own store adds a row in the same pull request.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- **New `packages/studio/tests/section-open-state.test.ts`**, "every section a surface draws is driven by a setter the toggle feeds". It walks every `src/surfaces/*.json` with Bun's `Glob` and `readFileSync`, the pattern in `tests/pane-grid-surface.test.ts`. For each node whose `tagName` is `jx-accordion-item`, it asserts:
  - there is no top-level `open`, and `$props.open` is an object with a string `$ref`;
  - `ontoggle` is `{ $prototype: "Function", body: [call] }`, where the one `call` has `operator: "call"`, and `target.$ref` starts with `#/state/` and names no `toggle…`;
  - the last element of `value` is `{ $ref: "event#/detail" }`.

  Offenders are collected as `file: JSON path` and compared with `[]`. A second case asserts that the walker found at least one item in each of `style-panel.json`, `properties-panel.json`, `logic-panel.json`, `panel-elements.json`, `panel-signals.json` and `doc-header.json`, so a broken walker cannot pass vacuously. The file needs no DOM, so it does not import the harness.

- **`packages/studio/tests/signals-panel-template.test.ts`:**
  - Extend "a section collapses and re-expands, and the panel remembers which". After `openSection(category(panel, "state"), false)`, call the mount's `repaint()` and `settle()`, then assert that `isOpen(category(panel, "state"))` is still `false` and that `activeTab.value!.session.ui.dataCategories.state` is `false`. Reopen it and assert `true` after a second repaint.
  - Add "a category's disclosure belongs to the tab". Draw, set `activeTab.value!.session.ui.dataCategories = { state: false }`, repaint: State is closed. Draw again, which opens a fresh tab: State is open.
- **`packages/studio/tests/frontmatter-panel.test.ts`**, `describe("route and disclosures")`: add "Raw head tags keeps its disclosure in the tab's session". Open `[part="raw"]`'s details through its `toggle`, then assert `tab.session.ui.headerSections.raw === true`. After `render()` the details are still open. After `unmount()` and `mount()` they are open again, because the store outlives the module's hosts. The existing "closed by default" case keeps passing.
- **`packages/studio/tests/properties-panel.test.ts`**, `describe("layout selection panel")`: add "the Layout Element card's disclosure is an Inspector section like the rest". Toggling `section(c, "__layout")` closed records `inspectorSections.__layout === false` and survives a re-render. Running `inspector.setSection { section: "__layout", open: true }` reopens it.
- **`packages/studio/tests/panel-gap-commands.test.ts`**, the `inspector.setSection` describe: add "every fixed section the Logic tab draws is addressable before it is touched". On a fresh tab, `inspector.setSection { section: "__events", open: false }` does not throw and records `false`, and the same holds for `__repeater` and `__condition`. The existing refusal and "no tab open" cases derive from `INSPECTOR_SECTION_KEYS` and follow the new list.
- **`packages/studio/tests/style-panel.test.ts`**: the `NOTHING` actions object's `toggleSection` becomes `setSection`. "toggling an open section persists the open state" covers the renamed action unchanged.
- **Coverage.** No source file is added, so the manifest check is unaffected. The new test file is under `tests/`, which coverage ignores. `signals-panel.ts`, `frontmatter-panel.ts`, `properties-panel.ts`, `style-panel.ts`, `tab.ts` and the three adapters lose or gain a few lines, each covered by the cases above. They stay above the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`). None of them is the floor file, so there is no ratchet.
- The change touches `packages/studio/src/**`, so the screenshot lane re-captures. Every default open state is unchanged (Data categories open, Raw head tags closed, Layout card open), so no image should move. A moved image is a finding to explain, not to accept.

## Specs & docs

- **studio-ui-guidelines.md §5.3** (lines 343–366). Keep the heading. Delete the Partial marker, the "Accordion open/closed state uses one of two patterns" paragraph and both JavaScript blocks with their bold labels, and write the text below (one paragraph per line). The section carries no marker afterwards, like the built §5.1.

  > A section's open state belongs to Studio's session: never to the document, never to the element. Every `jx-accordion-item` a surface draws binds `open` to a value its projection supplies. It hands the element's re-announced `toggle` (`ui.md` §5.4), whose `detail` is the new open state, to a host setter. The setter takes that state, with the section's key where the surface draws more than one:
  >
  > ```json
  > {
  >   "tagName": "jx-accordion-item",
  >   "attributes": { "part": "section", "data-section": "${$map.item.key}" },
  >   "$props": { "label": { "$ref": "$map/item/label" }, "open": { "$ref": "$map/item/open" } },
  >   "ontoggle": {
  >     "$prototype": "Function",
  >     "body": [
  >       {
  >         "operator": "call",
  >         "target": { "$ref": "#/state/setSection" },
  >         "value": [{ "$ref": "$map/item/key" }, { "$ref": "event#/detail" }]
  >       }
  >     ]
  >   }
  > }
  > ```
  >
  > **The setter writes a state; it never flips one.** A flip means something only against whatever state the section happened to be in. A section that opens itself when it has something in it (a Style tab section with a value set, an attribute section with an attribute set) makes the same flip an open on one document and a close on the next. That is why `inspector.setSection` takes `{ section, open }` and replaced `inspector.toggleSection`, and why no surface names a section setter `toggle…`. A command that opens or closes a section calls the setter the accordion calls, so the two cannot disagree about what open means.
  >
  > The setter writes to the store for what the section describes:
  >
  > | Sections                                                       | Store                                                                              | Scope                                                                                 |
  > | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  > | Inspector, Style tab                                           | `tab.session.ui.styleSections`                                                     | per tab                                                                               |
  > | Inspector, Content and Logic tabs, and the Layout Element card | `tab.session.ui.inspectorSections`, the key space `inspector.setSection` addresses | per tab                                                                               |
  > | Navigator, Data panel categories                               | `tab.session.ui.dataCategories`                                                    | per tab                                                                               |
  > | Document header, Raw head tags                                 | `tab.session.ui.headerSections`                                                    | per tab                                                                               |
  > | Navigator, Insert palette                                      | `view.elementsCollapsed` (`src/view.ts`)                                           | per window, because the palette lists the project's elements rather than a document's |
  >
  > A section over a document keeps its state on that document's tab: a document gets its own sections back when it is focused again, and closing the tab discards them. Opening a section is not an edit. So the state is never written to the document, never dirties the tab, never enters its history and never reaches a collaborator. Nor is it held in a module-level variable, which outlives the tab it describes and is shared by every document, or on the object a projection is built from, which the next paint replaces. A missing key is the surface's own default, and only the surface knows it. The Style tab opens a section that has a value until the reader closes it (`autoOpenSections` tells "never decided" from "closed" by `undefined` against `false`). The Content tab opens an attribute section whose attribute is set, and Usage never opens itself.
  >
  > `inspector.setSection` addresses the fixed sections the Content and Logic tabs draw (`INSPECTOR_SECTION_KEYS`) and any section already recorded for the tab. `packages/studio/tests/section-open-state.test.ts` holds every `jx-accordion-item` in `src/surfaces/*.json` to the binding above.

  (The quote marks show the replacement text; the spec text itself is not a blockquote.)

- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§5.3 specifies section open state as one binding, the accordion's toggle detail handed to a setter that writes the new state, and names where each surface keeps it: per tab in the tab's session, per window for the Insert palette, never in the document or a module variable."`
- **Docs.** No page's `spec:` cites `studio-ui-guidelines.md#5.3` (grep `docs/` for `studio-ui-guidelines.md#5`: none).
  - `docs/studio/logic/data.md` (its `code:` lists `panels/signals-panel.ts` and `surfaces/panel-signals.ts`): append to the "Entries are grouped into collapsible sections" paragraph: "A section you collapse stays collapsed, and each open document remembers its own." No em dash.
  - No change to the other pages `bun run docs:sync` names, because each still describes what ships:
    - `docs/studio/design/style-inspector.md` already says "a section you close stays closed while you work".
    - `docs/studio/design/properties.md` calls the Layout Element card "a read-only section", which it still is.
    - `docs/studio/editing/frontmatter.md` says Raw head tags is "one disclosure", which it still is.
    - `docs/studio/logic.md`, `docs/studio/logic/data-sources.md`, `docs/studio/design/components.md`, `docs/studio/interface/tabs.md` and `docs/studio/interface/modes.md` describe nothing about section state.
- **Graduation:** no. The spec keeps open items owned by other plans. The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green, including the new cases, and no file falls below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- The extended Data-panel case and the fixture change, run against the pre-fix `signals-panel.ts`, fail: the category is open again after the repaint. That shows the test proves the defect.
- `grep -rn "_collapsedSignalCats\|_rawOpen" packages/studio/src` and `grep -rn '"#/state/toggle' packages/studio/src/surfaces` print nothing.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists §5.3.
- These gates pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown`, `bun run docs:section-refs` and `bun scripts/check-shot-contract.ts`.
- By hand, run `bun run dev` from the repository root (the `packages/studio:verify` recipe) and open a page with state:
  - In the Data panel, collapse State, switch the Navigator to Files and back: State is still collapsed. Focus another open document: its State is open. Focus the first one again: State is collapsed.
  - Open Raw head tags in the document header, switch tabs and back: it is still open.
  - Click a layout element, collapse the Layout Element card, click another layout element: the card stays collapsed. Run Show Inspector Section with `__layout` and `open: true` from the palette: it opens.
