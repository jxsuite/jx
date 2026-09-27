---
status: drafted
disposition: implement
claims:
  - desktop.md#6.2
  - desktop.md#6.3
  - desktop.md#6.4
  - desktop.md#6.5
requires:
  - _shared/component-discovery
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# The Insert palette splits its components into the ones the focused document uses and the rest of the project, says what each list is scoped to, and follows the active tab

## Context

`specs/desktop.md` §6.2, line 522:

> **Status: Partial.** The whole-project list ships: every component `discoverComponents` finds in the tree, loaded by `loadComponentRegistry` (`packages/studio/src/files/components.ts`) into the Insert palette's one Components section (`componentViews` in `packages/studio/src/panels/elements-panel.ts`). There is no scope label and no Active/Global split: the project's own components show as one flat list at every level, and only the npm cards vary, by what the open document's `$elements` enable (`enabledNpmTags` in the same file; only the dev server discovers npm components).

`specs/desktop.md` §6.3, line 531:

> **Status: Pending.** There are no Active and Global sections: the Insert palette draws one Components section (`componentViews` in `packages/studio/src/panels/elements-panel.ts`), and nothing splits the project's components by whether the current document references them.

`specs/desktop.md` §6.4, line 544:

> **Status: Pending.** No `extractReferences` and no active/global partition exist. `packages/studio/src/files/components.ts` holds only the project-wide registry that `loadComponentRegistry` fills from `platform.discoverComponents`.

`specs/desktop.md` §6.5, line 565:

> **Status: Pending.** There is no Active set to update, and the trigger named here is gone: Studio holds one document per tab and opens a sub-component in a tab of its own (`packages/studio/src/panels/jump-bar.ts` records the removed `session.documentStack`), so there is no `pushDocument()` or `popDocument()` in the state model.

All four were unmarked before the census; the retired §11 roadmap carried them as one row. They are one feature: the list's scope label (§6.2), its two sections (§6.3), the rule that fills them (§6.4) and when that rule reruns (§6.5). Every marker was re-read against the tree of 2026-09-26 and holds; the only server that discovers npm components is `/__studio/components` in `packages/server/src/studio-api.ts`.

**What ships** (paths under `packages/studio/`)

- `componentRegistry` / `loadComponentRegistry` in `src/files/components.ts`. Every project-open path loads it for a site project only (`src/files/files.ts`, `src/studio.ts`), and the two refreshes (`src/editor/convert-to-component.ts`, `src/panels/imports-panel.ts`) run from inside an open document, so a non-empty registry implies an open site project. `noteComponentSaved` keeps it current on save.
- `componentViews` in `src/panels/elements-panel.ts`: the registry, npm entries gated by `enabledNpmTags` (the effective `$elements` of `activeTab.value`, project level included), filtered by `view.elementsFilter`, projected as `components` / `componentsOpen` / `hasComponents` into `src/surfaces/panel-elements.{ts,json}`. The JSON draws one `jx-accordion-item` (`data-section="components"`, label "Components") inside a `hidden` `components-slot`, whose cards sit in a `div.components-section`. Collapse state is `view.elementsCollapsed`, keyed by the label.
- `registerComponentsDnD` in `src/panels/dnd.ts` finds its rows with `leftPanel.querySelector(".components-section")`: the first section only.
- The panel is `level: "document"` with no `requiresDocument`, so it renders with no tab open. The Navigator's effect in `src/panels/left-panel.ts` repaints on `activeTab.value` and on `tab.doc.document` (the root reference `transactDoc` replaces on every applied transaction), and Insert's `afterRender` recomputes its projection on every repaint. So §6.5's trigger is already wired; nothing is computed from it.
- `hasElement` in `src/files/elements.ts`: the one comparison of an `$elements` entry against a registry entry, `$ref`s resolved from the document's path, npm specifiers by subpath or package (studio.md §9.1.3).
- The usage query already answers "does document D use component C" across the project: `walkDocRefs` and `countTagUses` in `packages/server/src/refactor/refs.ts` behind `findReferences` (the inspector's "Used on N pages"). It counts a `$ref` or `$elements` entry that resolves to the component's file, or any node whose `tagName` is its tag. It is an asynchronous project sweep in a package Studio does not depend on.
- `collectTags` in `src/canvas/canvas-live-render.ts` walks only `children` arrays, to inject `$elements` for rendering. The canvas's discovery walk (its gate, transitivity, candidates, and whether it descends into `$switch` cases and mapped templates) is `plan:imports/canvas-project-context`'s, which claims imports.md §1.4.

**Corrections to the stub**

- §6.1 and §6.4 name `$defs` as a source of sub-components. spec.md §5.2 makes `$defs` JSON Schema type definitions only, and spec.md §13.1 ("`#/$defs` could not be the place for one") rules out a document-local fragment there. The positions that name a component document by `$ref` are an `$elements` entry (spec.md §16.3) and an external `$switch` case (spec.md §14.1).
- Lifting `collectTags` out of the canvas is not this plan's to do: the canvas walk's scope is imports.md §1.4's open item. This plan writes the palette's walk and offers it.
- The studio.md §5.4 ownership question is `plan:_shared/component-discovery`'s second Open, which recommends that §5.4 own discovery and defer sectioning to desktop.md §6.2–§6.5. That plan claims `studio.md#5.4`, rewrites it and site-architecture.md §10.3 (the discovery rule §6.2 cites), which is why this plan requires it.

## Outcome

- desktop.md §6.2 → Implemented: with no document open, one section headed "All Components" lists every component the palette offers.
- desktop.md §6.3 → Implemented: with a document open, an Active and a Global section.
- desktop.md §6.4 → Implemented: the pseudo-code is replaced by the shipped rule (`extractReferences`, `partitionComponents`), with `$defs` dropped.
- desktop.md §6.5 → Implemented: the trigger restated for tabs and panes, citing studio.md §14.2 and §14.3.
- Ride-along: §6.1 stays Pending (`plan:desktop/single-file-mode`), with its derivation list pointing at §6.4 and its marker's "nothing derives" clause corrected; the §6 overview names the Insert palette.

## Decisions

- **Decided:** the sectioning rule lives in desktop.md §6 and studio.md §5.4 defers to it, as `plan:_shared/component-discovery` recommends. If that Open resolves the other way, this plan is redrafted (moved to `plans/_shared/`) before it can be `ready`.
- **Decided:** a document references a component when it names the component's file by a `$ref` anywhere in it (its `$elements` entries included), when a node below its root carries the component's tag (every candidate of a tag expression, `tagNameCandidates` in `@jxsuite/schema/guards`), or, for an npm component, when its own `$elements` names the component's subpath or package. That is `findReferences`' rule for one document in memory, so "Used on N pages" and the Active section never disagree about what a use is. It is written again in Studio because the query is an asynchronous sweep in `packages/server`, and the palette needs a synchronous answer per repaint. The comparison is `hasElement`'s, so any spelling studio.md §9.1.3 matches is matched here with no further change.
- **Decided:** the root's own `tagName` is not a use (a component's definition does not reference itself), but an instance of it below the root is, because spec.md §16.9 allows self-nesting with changing props. "Directly referenced" (§6.3) means the document's own JSON: what its layout or `project.json` declares does not make a component Active. That is the only reading under which the Active set can differ between two pages of one project.
- **Decided:** document level means the focused pane has an active tab, and project level means it has none; there is no `isSiteProject` branch, because the registry is only ever loaded for a site project. The no-project branch (§6.4's flat list) is §6.1's and is built by `plan:desktop/single-file-mode`, not left here as a branch nothing reaches (studio.md §14.3's rule).
- **Decided:** recomputation rides on the Navigator's existing effect; no new subscription is added. `extractReferences` walks `toRaw(doc)` (`src/reactivity`), so the walk does not subscribe the Navigator's effect to every node of a deeply reactive document; the root reference that effect already reads is what changes on every applied transaction. No memo: one walk per repaint while Insert is showing costs less than the repaint.
- **Decided:** the listed set is today's (project components plus npm components the effective `$elements` enables), partitioned after the gate. A section with no cards, after the filter, is not drawn, as an empty category is not. Sections are one mapped array in the surface, each keyed `components`, `components-active` or `components-global`, and every section's disclosure goes through the one `setSectionOpen(key, open)`; `setComponentsOpen` and the `components-slot` go.
- **Decided:** the canvas's `collectTags` is left as it is. Its walk renders elements and is `plan:imports/canvas-project-context`'s to widen or replace; that plan may adopt `extractReferences(doc).tags`.
- **Open:** what do the three section headers read? Recommendation: "All Components" at project level (the spec's first option), "In This Document" for Active and "Other Components" for Global; §6.3's table keeps Active and Global as the names of the two sets and gains a Header column. "Global" as a header reads as the "global scope" that site-architecture.md §10.3 says never reaches the palette, "Active" reads as an on/off state, and the site name is already in the window title and says nothing about what the list holds. Title Case per studio-ui-guidelines.md §2.3.

## Implementation

1. New `packages/studio/src/files/component-scope.ts` (header `@docs studio/design/elements`):
   - `export interface DocumentReferences { entries: ElementsEntry[]; tags: ReadonlySet<string> }` (`ElementsEntry` from `./elements`).
   - `export function extractReferences(doc: unknown): DocumentReferences`. Walk `toRaw(doc)` over every array and object value. `entries`: the root's `$elements` members (strings and `{ $ref }`) as written, then `{ $ref: value }` for every other string `$ref` met anywhere (state pointers and `#/$defs` refs ride along harmlessly: they never resolve to a component path). `tags`: every `tagNameCandidates(node.tagName)` value containing a hyphen, for every object except the root.
   - `export function referencesComponent(refs: DocumentReferences, comp: ComponentEntry, documentPath: string | null): boolean` returns `refs.tags.has(comp.tagName) || hasElement(refs.entries, comp, documentPath)`.
   - `export function partitionComponents(components: readonly ComponentEntry[], doc: unknown, documentPath: string | null): { active: ComponentEntry[]; global: ComponentEntry[] }`: one `extractReferences`, input order kept in both halves, every component in exactly one.
2. `src/surfaces/panel-elements.ts`: add `export interface ComponentSectionView { key: string; label: string; open: boolean; cards: ComponentCardView[] }`. In `ElementsValues`, `componentSections: ComponentSectionView[]` replaces `components`, `componentsOpen` and `hasComponents`; `ElementsActions` loses `setComponentsOpen`; `project()` and the scope defaults follow.
3. `src/surfaces/panel-elements.json`: replace the `components-slot` `$switch` with a `$prototype: "Array"` over `#/state/componentSections`, keyed by `$map/item/key`, placed before the categories array. Each item is a `jx-accordion-item` (`label` and `open` from the item, `data-section: "${$map.item.key}"`, `ontoggle` calling `setSectionOpen` with the key and `event#/detail`) holding a `div.components-section` whose mapped cards are today's card template over `$map/item/cards`. Rewrite the root and slot `$description`s: an empty array draws nothing, so the `hidden` separator workaround is gone.
4. `src/panels/elements-panel.ts`:
   - `listedComponents()`: the registry filtered by the npm gate (today's first `filter` in `componentViews`).
   - `componentSections(filter)`: with no `activeTab.value`, one section `{ key: "components", label: ALL }` over the listed set; otherwise `partitionComponents(listed, tab.doc.document, tab.documentPath)` as `components-active` then `components-global`. Cards are built as `componentViews` builds them today, the filter applies per section, empty sections are dropped, `open` reads `view.elementsCollapsed.has(key)`. Remove `componentViews` and the `COMPONENTS` constant; the labels are three constants.
   - `panelValues`: `bare` is `categories.length === 0 && componentSections.length === 0`.
   - `ACTIONS`: drop `setComponentsOpen`. Update the module header (what the palette decides now includes the scope).
5. `src/panels/dnd.ts`, `registerComponentsDnD`: iterate `leftPanel.querySelectorAll(".components-section")` and the rows of each; the body per row is unchanged.
6. Unchanged: `components.ts`, `elements.ts`, `left-panel.ts`, `canvas-live-render.ts`, the drop's `enableElement` call, and every host's `discoverComponents`.

**Integration contract.** Once this lands:

- `extractReferences`, `referencesComponent` and `partitionComponents` (`packages/studio/src/files/component-scope.ts`) are the one definition of what a document references, synchronous and pure over `toRaw`. `plan:desktop/single-file-mode` builds §6.1's flat list from `partitionComponents(...).active` over whatever registry its file-bound session yields (or from `extractReferences(doc).entries` when it has none), and adds its section as one more `componentSections` entry with no surface change.
- desktop.md §6.4 is the one statement of that rule; §6.1 and §6.3 cite it.
- `registerComponentsDnD` covers every `.components-section`.
- `plan:imports/canvas-project-context` may replace `collectTags` with `extractReferences(doc).tags`. `plan:studio/insert-palette-categories` words studio.md §5.3's "Components section" as the Components sections of §5.4. When `plan:studio/element-ref-normalization` lands, the Active set matches its spellings through `hasElement` with no change here.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`. Its bunfig gates every file at `coverageThreshold = { lines = 0.958, functions = 0.941 }`. `component-scope.ts` is a new source file and ships with its test file, or `bun scripts/check-coverage-manifest.ts packages/studio` fails; aim for 100% on it, and ratchet the threshold only if the worst file rises.

New `packages/studio/tests/component-scope.test.ts` (first import `./with-dom.js`, as `components.test.ts` does):

- "a tag used below the root is a reference, wherever the node sits": `children`, an inline `$switch` case, a `$prototype: "Array"` `map`, slot content.
- "the root's own tagName is not a reference, and an instance of it below the root is".
- "every tag a tagName expression can take is a reference".
- "the document's own $elements entries are references, in both forms".
- "a $switch case naming a file is a reference, and a state pointer is not".
- "a $ref is compared from the document's own directory" (`pages/blog/index.json` naming `../../components/card.json` matches `components/card.json`; with a `null` path, `./components/card.json` does).
- "an npm component is referenced by its subpath, by its package, or by its tag".
- "partitionComponents keeps input order in both halves and places every component once".
- "walking a reactive document subscribes an effect to nothing below the root" (`reactive` + `effect` from `src/reactivity`; mutating a nested `tagName` through the proxy does not re-run it).

`packages/studio/tests/elements-panel.test.ts`:

- Updated: the existing component cases open a document that uses nothing, so their sections are `components-global`: "npm components stay hidden unless the document enables them" asserts `sectionNames()[0]` is `components-global`; "no components section when the registry is empty" asserts no `[data-section^="components"]` and no `.components-section`; "toggling the components section records the disclosure" uses the `components-global` key.
- New describe "Insert panel — component scope": "with no document open, one All Components section lists every listed component"; "a document's components are listed first under In This Document, the rest under Other Components"; "a component the document only imports through $elements is In This Document"; "a component only project.json's $elements names stays under Other Components"; "an empty section is not drawn"; "the filter applies to both sections and drops the one it empties"; "inserting an Other Components card moves it to In This Document on the next repaint" (click, then `mountElementsPanel` again as the Navigator would); "each section remembers its own disclosure". Headers follow the Open.

`packages/studio/tests/left-panel.test.ts`: "switching the active tab re-sections the Insert palette" (two tabs through `openTab`, `shell.leftTab = "insert"`, `activateTab`, flush; a card moves between sections with no explicit repaint call).

`packages/studio/tests/dnd-gaps.test.ts`, `describe("registerComponentsDnD")`: "rows in every .components-section become drag sources" (two sections, both rows registered).

## Specs & docs

**desktop.md** (one fragment for all of it):

- §6 overview: "The Components sidebar adapts its contents based on context: what is currently open and whether a site project is loaded." becomes "The Components sections of the Insert palette (studio.md §5.4) adapt to context: whether a project is loaded, and which document the focused pane shows."
- §6.2: delete the marker. The lead becomes "When a project is loaded and no document is open in the focused pane:"; **Shown** becomes "every component the project's discovery finds (site-architecture.md §10.3), plus the npm components the project's `$elements` enables (imports.md §2), as one list"; **Scope label** becomes "the list is one section headed **All Components**".
- §6.3: delete the marker. The lead becomes "When a project is loaded and the focused pane shows a document:". The table gains a Header column (In This Document, Other Components, per the Open), Active's contents become "Components the document references (§6.4)" and Global's "Every other component §6.2 lists". After the paragraph: "Active is drawn first. A section with nothing in it, or nothing the palette's filter matches, is not drawn. Both are click and drag sources (studio.md §5.4), and a component inserted from Global is Active from the next repaint (§6.5)."
- §6.4: delete the marker and replace the pseudo-code block with the rule in the second and third Decided items, stated as prose (the three ways a document references a component, the root exclusion, "directly" meaning the document's own JSON, `$defs` contributing nothing per spec.md §5.2, `$ref`s compared as studio.md §9.1.3 compares them), then a shorter block: no document open gives one All Components section over the listed set; otherwise `refs = extractReferences(document)`, `active = listed.filter(referenced)`, `global = the rest`. Close with "Implemented by `extractReferences` and `partitionComponents` in `packages/studio/src/files/component-scope.ts`, drawn by `componentSections` in `packages/studio/src/panels/elements-panel.ts`. With no project loaded there is no registry to partition, and §6.1 lists the Active set alone."
- §6.5: delete the marker; the heading stays. The body becomes: "The Active and Global sets belong to the document in the focused pane and are recomputed whenever it changes: when another tab becomes active (drilling into a component opens it in a tab of its own, studio.md §14.2), when focus moves to the other pane, and when an edit, an undo or a collaborator's change alters what the document references. Returning to a tab recomputes its sets from its document; nothing is restored from a saved frame, because there is no document stack (studio.md §14.3)."
- §6.1 (ride-along; its marker stays Pending): in the marker, "and nothing derives a Components list from the open document. The canvas does match the document's `tagName`s against the registry (`collectTags` in `packages/studio/src/canvas/canvas-live-render.ts`), but only to register elements for rendering." becomes "so there is no registry for the Active set (§6.4) to be drawn from." In the body, **Shown** becomes "The components the file references (§6.4)", and the paragraph "The component list is derived by walking…" with its three-item list becomes "The list is the file's Active set, by §6.4's rule."
- Fragment: `bun run spec:change desktop.md minor -m "The Insert palette lists the components the focused document references apart from the rest of the project, under one All Components section when no document is open, and follows the active tab and pane"`.

No other spec changes: studio.md §5.4's deferral to desktop.md §6.2–§6.5 and site-architecture.md §10.3's discovery rule are `plan:_shared/component-discovery`'s, already landed.

**Docs** (no em dashes):

- `docs/studio/design/elements.md`: the **Components** bullet under "What's in the palette" becomes: "**Components** are at the top. With a file open they come in two sections: **In This Document** lists the components that file already uses or imports, and **Other Components** lists the rest of your project's, plus components from installed packages once they're enabled (see **[Dependencies](/docs/studio/projects/dependencies)**). With no file open, one **All Components** section lists them all. Switch tabs and the sections follow the file in front of you; place a component and it moves up to **In This Document**. Project components render a live preview on their card, so you see the real thing before you place it." The filter sentence gains "and a component section it empties". The image alt text says "component sections". Frontmatter gains `spec: [desktop.md#6.3]` and `packages/studio/src/files/component-scope.ts` in `code:`.
- No change: `docs/studio/design/layers.md` (lists `dnd.ts`; the Outline's drag is untouched), `docs/start/first-component.md` ("your components appear at the top" holds), `docs/studio/design/components.md`, `docs/studio/interface/canvas.md`. No docs page cites a `desktop.md#6.*` anchor today.
- The screenshots lane re-captures `elements-panel` and `counter-elements`; re-read `docs/studio/design/elements.md` and `docs/start/first-component.md` against the new pictures.

No graduation: desktop.md keeps §3.1, §3.3, §3.6, §4.3, §5.3, §6.1, §7.4, §9.3 and §10.2 open.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` passes at its thresholds; `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun scripts/check-shot-contract.ts` pass.
- `bun run plans:status --spec desktop` no longer lists §6.2, §6.3, §6.4 or §6.5.
- In the browser Studio (`packages/studio:verify` recipe) on `packages/starters/sites/real-estate`: with every tab closed, Insert shows one All Components section; open `pages/index.md` and the components it places sit under In This Document; open a component in a second tab and the sections change with the tab; drag an Other Components card onto the page and it moves up.
