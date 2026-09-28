---
status: drafted
disposition: implement
claims:
  - imports.md#5
  - imports.md#5.1
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# imports.md §5 specifies the Packages panel that ships, and placing a component from the Insert panel imports it whether the card is dropped or clicked

## Context

`specs/imports.md` §5 (heading line 162, marker line 164):

> **Status: Partial.** There is no "Imports" tab with three sections. The Packages panel (`registerPackagesPanel` in `packages/studio/src/panels/imports-panel.ts`, markup `packages/studio/src/surfaces/panel-imports.json`) shows the imported modules, dependency add and remove and a cherry-pick checkbox per package element over `project.json`, and the document's `$ref` imports, a component picker and the same checkboxes over any other document. The checkboxes need the `source: "npm"` entries §2 describes, so they appear only under the dev server. Component cards with live preview and drag-drop are the Insert panel's (`registerInsertPanel` in `packages/studio/src/panels/elements-panel.ts`), as studio.md §5.1 and §5.3 describe.

`specs/imports.md` §5.1 (heading line 172, marker line 174):

> **Status: Partial.** A dropped hyphenated tag gains its `$elements` entry through the one service studio.md §9.1.3 names (`enableElement` in `packages/studio/src/files/elements.ts`, called from `packages/studio/src/panels/dnd.ts`), deduplicated by resolved `$ref`. It differs from this section in two ways: the drag source is the Insert panel's component cards, and an npm component is written as its cherry-picked `package/modulePath` specifier (`npmSpecifier`) rather than the bare package name.

The census filed both as one `reconcile`. Reading the code corrects that in four places, and two of them are code:

- **Remove is conditional.** The Packages panel's uninstall control sits on a package's section, and `groupByPackage` (`imports-panel.ts`) draws a section only for a package whose registry entries are `source: "npm"` with a `package` and a `modulePath`. A dependency with no discovered element has no section and cannot be removed here; the project's general dependency list is Project Settings' Packages section (`settings/dependencies-editor.ts`).
- **A click does not import.** The Insert panel's card click (`ACTIONS.insertComponent` → `insertAtSelection` in `elements-panel.ts`) inserts `buildComponentInstance(comp)` and writes no `$elements`. Only the drop (`applyDropInstruction` in `dnd.ts`, used by canvas, Outline and file drops) imports. A project component directly in `components/` needs no declaration (imports.md §1.4), but one anywhere else reaches a build only when a document declares it (imports.md §1.3, which `plan:_shared/component-discovery` implements), so the same card clicked or dragged ends as a working component or an empty tag.
- **The picker's options ignore the service.** `documentView` filters `componentRegistry` by a raw string compare of each `$ref` against the component's path with and without a leading `./`, so a page in `pages/` that imports `../components/card.json` is still offered `<my-card>`. Choosing it is a no-op, because the write goes through `enableElement`. The test fixture hides this: `tests/imports-panel.test.ts` gives a document at `pages/index.json` the ref `./components/hero.json`, which resolves to `pages/components/hero.json`.
- **A drop is two undo steps.** The drop inserts in one `transactDoc` and writes `$elements` in a second `transact`, so the first ⌘Z after dropping a component removes only the import and the canvas shows no change. `convertToComponent` (`editor/convert-to-component.ts`) already writes its node and its `$ref` in one transaction.

What holds: the two moods (`view()` switches on `documentPath?.endsWith("project.json")`); imported modules with write-back through `updateSiteConfig`; install through `platform.addPackage` followed by `loadComponentRegistry`; uninstall behind `showConfirmDialog`, then `removePackageElements`; per-element checkboxes that write the project's list through `updateSiteConfig` (not undoable) or the document's through `transact`; `enableElement`'s rules, including that a whole-package entry satisfies a subpath one, so a drop onto a page holding `@acme/ui` writes nothing (the drop writes only when the list grows). studio.md has no Packages panel section: studio.md §5.1 lists the panel in the rail table, and studio.md §12 names imports.md §5 as the home of component library management.

Docs defects on the two pages that describe these surfaces: `docs/studio/projects/dependencies.md` gives the panel's chord as ⌘8, but it is ⌘7 (`panelFocusCommands` in `commands/defaults.ts` numbers rail panels in registration order, and the generated `docs/studio/interface/shortcuts.md` already prints `⌘7`); that page and `docs/studio/design/elements.md` each end in stray `code:` list items appended below their `## Next` list.

## Outcome

- imports.md §5 → Implemented (marker deleted): the Packages panel's two moods as they ship; package sections drawn from the npm components §2 discovers; cards belong to the Insert panel.
- imports.md §5.1 → Implemented (marker deleted): placing a component from the Insert panel, by drop or by click, imports it into the open document's own `$elements` in the same undo step, under studio.md §9.1.3's comparison.

## Decisions

- **Open:** does clicking a component card import the component, as dropping it does? Recommendation: yes, through one placement function both paths call, because a click and a drop of one card are the same request to the user, and once `plan:_shared/component-discovery` lands the build compiles a component outside `components/` only when a document declares it, so the click path ships an empty tag. If declined: Implementation step 2 is dropped (the one-transaction drop and the picker fix keep this an `implement`), §5.1 says a click places the tag without an import, and `plan:imports/canvas-project-context` drops its `requires` edge to this plan and states the click cost instead (its undeclared-registration decision).
- **Open:** does "already imported" count entries in `project.json`'s `$elements`? Recommendation: no, keep the code's rule (the document's own list), because a placed component then keeps working when the project-wide pick is cleared, and `plan:desktop/component-scope-sections` defines desktop.md §6.3's Active set by the document's own JSON in the same way. The cost is a redundant entry on a page that places a component the project already imports.
- **Decided (dependency graph, recorded in the imports audit record's spec-wide decisions):** §5 may be Implemented before the desktop app discovers npm components, and this plan does not require `plan:imports/cem-discovery-on-every-backend`, although the cross-spec review proposed that edge. §5 describes package sections as drawn from what §2 discovers, which is true on every backend in either landing order, and §2's own marker already names the Packages panel's cherry-pick as what the desktop app lacks, so the backend gap keeps one marker and one owner. The audit record's dev-server qualification of §5 moves into §2, where it is already written. If `plan:imports/cem-discovery-on-every-backend` lands first, it edits §5's marker clause and this plan then deletes the marker as below.
- **Decided:** a placement is one transaction, because one gesture should be one undo step and `convertToComponent` already sets that precedent. The import is computed before the insert and written inside the same `transactDoc` callback through a recording mutator, `mutateUpdateProperty(t, [], "$elements", …)`, never a bare assignment. Patch-based history (`pushHistoryEntry` in `tabs/transact.ts`) stores the recorded ops and no snapshot when a transaction recorded any, so an unrecorded `$elements` write beside the recorded insert would leave an entry whose inverse removes the node and keeps the import, and the canvas would patch the insert surgically without registering the new element. The recorded root-level `set-prop` makes undo revert both, and the canvas patcher refuses it (`replace-root`) and takes the full render a changed `$elements` needs, as today's second transaction does.
- **Decided:** the picker's options are filtered with `hasElement`, because the raw compare misses every ref a document outside the project root writes.
- **Decided:** no edge to `plan:_shared/component-discovery` (proposed by the cross-spec review) or `plan:studio/element-ref-normalization`. §5 and §5.1 cite studio.md §5.3, §5.4 and §9.1.3 without restating their rules, so the text is true in either landing order, and `hasElement` improvements reach the picker and the placement with no change here. The one sentence the two plans share, studio.md §5.4's "A dropped project component is recorded…", which `plan:_shared/component-discovery` adds, is handled in either order: landing second, that plan writes "placed"; landing first, this plan changes it (Specs & docs).
- **Decided:** imports.md §5 stays the Packages panel's specification, and both headings are retitled in place ("5. Studio Packages Panel", "5.1 Auto-Import on Insert"), because anchors are numeric (`imports.md#5`), the only other copy of the titles is the generated status page, and "Imports tab" and "Drag-Drop" no longer name the surface or the gesture.

## Implementation

1. `packages/studio/src/panels/dnd.ts`:
   - Add `export function placeBlock(tab: Tab, parentPath: JxPath, index: number, fragment: JxMutableNode): boolean`. Before the transaction, compute `imports`: when `displayTagName(fragment.tagName)` contains a hyphen and `componentRegistry` has an entry with that `tagName`, `enableElement(before, comp, tab.documentPath ?? null)` over `before = tab.doc.document.$elements ?? []`, kept only when it is longer than `before` (today's rule; move its comment with it). Return `transactDoc(tab, (t) => { mutateInsertNode(t, parentPath, index, structuredClone(fragment)); if (imports) mutateUpdateProperty(t, [], "$elements", imports as JxNodeValue); })`, importing `mutateUpdateProperty` and the `JxNodeValue` type from `../tabs/transact` beside the existing imports. The `transact` value import and the `JxElement` type import leave: the deleted auto-import block is their only use.
   - In `applyDropInstruction`'s `block` branch, each of the three instruction cases calls `placeBlock(tab, <parent>, <index>, srcData.fragment as JxMutableNode)` with the parent and index it passes to `mutateInsertNode` today. Delete the trailing auto-import block, so an unknown instruction also imports nothing.
   - Module header: one sentence saying a block placed from a palette, by drop or by the Insert panel's click, lands through `placeBlock`.
2. `packages/studio/src/panels/elements-panel.ts`: `insertAtSelection` keeps its parent and index computation and calls `placeBlock(tab, parentPath, index, def)` (import from `./dnd`). Drop the now-unused `mutateInsertNode` and `transactDoc` imports. Element cards are unaffected: a plain tag computes no import.
3. `packages/studio/src/panels/imports-panel.ts`, `documentView`: `available` filters `comp.source !== "npm" && comp.path != null && !hasElement(documentElements, comp, documentPath)`; delete the `imported` set.
4. Unchanged: `files/elements.ts`, `enabledNpmTags`, `convert-to-component.ts`, both surface documents and every `discoverComponents`.

**Integration contract.** Once this lands, `placeBlock` (`packages/studio/src/panels/dnd.ts`) is the one path by which a palette block enters a document: canvas, Outline and file drops through `applyDropInstruction`, and the Insert panel's click. It inserts a clone and, for a registry component the document does not already import, writes the `$elements` entry as a recorded op in the same transaction, returning whether the gate applied it. The Packages panel's picker offers exactly the project components `hasElement` reports as not imported. imports.md §5 is the Packages panel's specification and §5.1 the placement import. `plan:desktop/component-scope-sections` needs no change (a clicked card is Active by its tag either way). `plan:_shared/component-discovery`'s new studio.md §5.4 sentence about a "dropped" component says "placed" in either landing order (the Decided item above). `plan:imports/cem-discovery-on-every-backend` needs no §5 edit when it lands after this. `plan:imports/canvas-project-context` requires this plan: it stops the canvas registering an undeclared component outside `components/<tag>.json`, and relies on every Insert-panel placement, click included, writing the declaration.

## Tests

From `packages/studio`: `bun test --isolate --coverage`. The bunfig gates every file at `coverageThreshold = { lines = 0.958, functions = 0.941 }`. No source file is added, and `dnd.ts`, `elements-panel.ts` and `imports-panel.ts` are not the workspace's worst files, so no ratchet is expected; raise it only if the worst file rises.

`tests/dnd-gaps.test.ts` (its pragmatic-drag-and-drop mocks stay). The existing auto-import cases stay green unchanged. New:

- "a component drop and its import are one undo step": drop `my-card` into a page at `pages/index.json`, `undo(tab)` once, and the children and an absent `$elements` are both restored.
- "a drop onto a page whose whole-package entry imports the component writes nothing": `$elements: ["@acme/ui"]`, drop `x-button` (`modulePath: "button.js"`), and the list is still `["@acme/ui"]`. This one passes today too; it pins the grow-only rule across the move into `placeBlock`.
- "an unknown instruction neither places nor imports a component": the `mystery` instruction with a registered hyphenated tag leaves the document byte-identical.

`tests/elements-panel.test.ts`, describe "Insert panel — components":

- "clicking a component card imports it into the open document": `resetWorkspaceWithTab(doc, { documentPath: "pages/index.json" })`, click `my-card`, and `$elements` is `[{ $ref: "../components/my-card.json" }]` beside the instance.
- "clicking a card the document already imports adds no second entry".
- "one undo removes a clicked component and its import".
- In describe "Insert panel — element insertion", extend "clicking a card inserts the default def at the selection" to assert `$elements` stays absent for an element card.

`tests/imports-panel.test.ts`, describe "document-level imports": rewrite every fixture ref to the spelling a document at `pages/index.json` writes (`../components/hero.json`, `../components/card.json`) in `beforeEach`, the `data-ref` selectors and the expected lists; every existing assertion then holds. New:

- "a page in a subdirectory is not offered a component it already imports": `$elements: [{ $ref: "../components/card.json" }]`, and the picker lists `<my-hero>` only.
- "a same-named ref that resolves elsewhere does not hide the component": `$elements: [{ $ref: "./components/card.json" }]` at `pages/index.json`, and `<my-card>` is offered.

Then `bun scripts/check-coverage-manifest.ts packages/studio`. No `mock.module("../src/panels/dnd")` reaches `elements-panel.ts` today (only `file-drop-action.test.ts` mocks it); a future one that does must export `placeBlock`.

## Specs & docs

`specs/imports.md`, in place:

- §5: heading becomes `## 5. Studio Packages Panel`; delete the marker; replace the "left sidebar Imports tab" paragraph and its three-item list with:

  > The Packages panel (`packages`, in the Activity Bar's Document group, studio.md §5.1) manages what the project and the open document import. It follows the focused document and has two moods; with no document open it says it needs one.
  >
  > When the focused document is `project.json`, it manages the project:
  >
  > 1. **Imported Modules**: the name-to-path mappings in `project.json` `imports`, each removable, with a name and path form that adds one. Written back to `project.json`.
  > 2. **One section per installed package** whose components §2 discovers, headed by the package name and a control that uninstalls the package (§4.5) after a confirmation and removes the package's entries from the project's `$elements`. Beneath it, one checkbox per element, ticked when the project's `$elements` imports that element.
  > 3. **Add Dependency**: a package-name field that installs the package (§4.4) and rediscovers components, so a package that ships a manifest gains its section.
  >
  > For any other document, it manages that document's own `$elements`:
  >
  > 1. **Components**: the document's `{ "$ref" }` entries, each removable, and a picker offering the project components the document does not already import. A pick adds the component's `{ "$ref" }`, relative to the document.
  > 2. **The same package sections**, without the uninstall control: a checkbox imports an element into this document, or removes it.
  >
  > A checkbox writes an element's cherry-picked `package/modulePath` specifier rather than the bare package name, and every write goes through the one service studio.md §9.1.3 specifies, so the checkboxes, the picker and §5.1 agree on what is already imported. The project's list is written through the project configuration and is not undoable; a document's is an undoable edit. Component cards, with their live previews, are the Insert panel's (studio.md §5.3 and §5.4); this panel draws none.

- §5.1: heading becomes `### 5.1 Auto-Import on Insert`; delete the marker; replace the body with:

  > Placing a component from the Insert panel (studio.md §5.3 and §5.4), by dropping its card on the canvas or the Outline or by clicking it, also imports the component into the open document's `$elements` unless that list already imports it:
  >
  > - **JX component**: a `{ "$ref" }` relative to the document is added.
  > - **npm component**: its cherry-picked `package/modulePath` specifier is added, or the package name when the component has no module path.
  >
  > "Already imported" is studio.md §9.1.3's comparison over the document's own list, so a whole-package entry satisfies an element's specifier; an entry in `project.json`'s `$elements` does not count, and the document records what it places. The element and its import are one edit, undone together. A tag the component registry does not name is placed without an import.

  (If the first Open is declined, the first sentence says "by dropping its card on the canvas or the Outline", adds "A click places the tag without an import.", and the heading keeps "Drag-Drop". If the second Open is declined, the "does not count" clause becomes "an entry in `project.json`'s `$elements` counts as well".)

- Fragment: `bun run spec:change imports.md minor -m "§5 and §5.1: the Packages panel is specified in its project and document moods, and placing a component from the Insert panel, by drop or by click, imports it in the same undo step."` The spec does not graduate while another item is open: today §1.1–§1.4, §2, §4.2, §4.3 and §6 are, and `plan:imports/canvas-project-context` (§1.1, §1.4) requires this plan, so it always lands later.
- `specs/studio.md` §5.4, only if `plan:_shared/component-discovery` has landed first and the first Open is accepted: in its sentence "A dropped project component is recorded in the open document's `$elements` as a `{ "$ref" }` relative to that document (§9.1.3), which is what a build compiles it from.", "dropped" becomes "placed" (by drop or by click, this section's §5.1). Fragment: `bun run spec:change studio.md patch -m "§5.4 says a placed project component is recorded in the open document's element list, since a card click now imports as a drop does."` Landing second, that plan writes "placed" itself and this bullet is void.

Docs (no page cites `imports.md#5` or `#5.1` in `spec:`; these two list files this plan changes in `code:`):

- `docs/studio/projects/dependencies.md`: `:kbd[⌘8]` becomes `:kbd[⌘7]`. "Dragging a component onto the canvas imports it for you, so the picker, the checkboxes and the drag all end at the same list." becomes "Placing a component from the Insert palette, by clicking its card or dragging it onto the page, imports it for you, so the picker, the checkboxes and the palette all end at the same list." Move the three stray list items at the end of the file into `code:` (unless `plan:imports/cem-discovery-on-every-backend`, which moves the same three, has landed first), and add `packages/studio/src/files/elements.ts`. `plan:studio/element-ref-normalization` edits line 32 too; whichever lands second keeps both edits.
- `docs/studio/design/elements.md`: in "What's in the palette", "once they're enabled for the project" becomes "once the project or the open page enables them". The closing note gains "Placing a component card also imports that component into the page, unless the page already does, and one undo removes both." Move the two stray list items at the end of the file into `code:`. `plan:desktop/component-scope-sections` rewrites the same **Components** bullet and moves the same stray items; whichever lands second keeps the other's wording.
- `docs/studio/design/layers.md` lists `dnd.ts` but describes no import: unchanged. No screenshot changes: neither surface's markup moves.
- Both pages are in the `docs:prose` corpus: no em dash in any added sentence.

## Acceptance

- `bun run plans:status --spec imports` lists neither §5 nor §5.1.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- From `packages/studio`: `bun test --isolate --coverage` passes at the unchanged threshold, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `grep -n '"Imports" tab' specs/imports.md` finds nothing, and neither docs page ends in a stray list item.
- By hand, under `bun run dev` in a project with a component outside `components/` (for example `pages/blog/_blog-card.json`): open a page in that subdirectory, click the component's Insert card, and `$elements` gains its `{ "$ref" }`; one ⌘Z removes both the element and the entry; the Packages panel's picker then no longer offers that component.
