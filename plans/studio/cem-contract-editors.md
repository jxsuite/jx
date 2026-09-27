---
status: drafted
disposition: implement
claims:
  - studio.md#6.5
requires:
  - spec/cem-manifest-export
  - spec/shadow-mode-verdict
workspaces:
  - packages/schema
  - packages/studio
  - specs
  - docs
size: M
---

# A component's observed attributes are edited from the Logic tab, and its custom properties and parts are listed with a way to the control that declares each

## Context

`specs/studio.md` §6.5 (heading line 671, marker line 673). Before the census the section had no marker, and its table said Observed attributes was Implemented and the two CSS rows Pending:

> **Status: Partial.** The Parameters and Emits editors ship in the Data panel (`packages/studio/src/panels/signals-panel.ts`). Nothing in `packages/studio/src` reads or writes the root `observedAttributes` array the runtime observes, and CSS custom properties and CSS parts are listed read-only in the Logic tab (`panels/events-panel.ts`) with no form to declare either.

The census corrected three cells: Observed attributes to `**Pending**`, CSS custom properties and CSS parts to `**Partial**`. This plan also owns the two rows of the retired §12 ledger ("CSS custom properties panel", "CSS parts panel"), which described the same lists. `plan:spec/cem-manifest-export` rewrites the two CSS cells to cite the build's manifest instead of `services/cem-export.ts`, which it deletes; both stay Partial there.

**What exists** (verified against the tree on 2026-09-27; paths under `packages/studio/src` unless named)

- The runtime reads only the root list: `defineElement` freezes `observedAttributes` as `static get observedAttributes()` (`packages/runtime/src/runtime.ts`, line 4225), and `absorbAttribute` (line 3614) writes an attribute into `state[camelCase(name)]`, coerced by the value the entry currently holds (boolean presence, `Number()`, else the string), never by its declared `type`. A per-entry `attribute` is read by no tier. `grep -rn observedAttributes packages/studio/src` is empty. spec.md §16.5 states the coercion but not the camel-casing: no spec says which entry an attribute writes.
- The Logic tab's contract sections (`panels/events-panel.ts`, the `isCustomElement && isRoot` block at line 530; markup in `surfaces/logic-panel.json`, whose `$description` calls them "Three read-only lists — this is a report, not a form"):
  - Observed Attributes lists the state entries carrying `attribute`, not the root list. Its empty state says "Name an \"attribute\" on a data entry to expose it here", which produces an attribute nothing observes.
  - CSS Properties lists the root style's `--*` keys, and is hidden when there are none.
  - CSS Parts lists `collectCssParts(doc)` (`panels/signals-panel.ts`, line 348): the root's own `part` included, `part="a b"` one name, shown whatever the render mode.
- The Data panel (`stateFields` in `panels/signals-panel.ts`, line 623; the fields near line 689) gives a custom element's value entries a free-text **Attribute** field, a **Reflects** checkbox and **Deprecated**, all written through `mutateUpdateDef`, which expands a Shape 1 value into `{ default }`. `stateFields` sees each entry through `asSignalDef`, which flattens a Shape 1 value to `{}`.
- Where the declarations already have writers: the Style tab's **Custom** section (`customSection` in `panels/style-panel.ts`, line 1853) adds, renames, edits and removes any `--*` key at the current coordinate; the Content tab's custom attributes (`panels/properties-panel.ts`, "+ Add attribute", line 1884) set `part` on any element.
- `packages/ui/components/*.json`, the kit Studio is built from, pairs the two by hand: all 269 entries carrying `attribute` in 37 components name an attribute that is in the root `observedAttributes` and camel-cases to the entry's key, and every observed name in the kit has such an entry.
- `attribute` is valid only on a typed entry: `packages/schema/defs/typed-state-def.schema.ts` requires `default`, and the Function schema (`function-def.schema.ts`) is `additionalProperties: false`.
- Studio does not know `$shadow`: the verdict is `resolveShadowMode(doc, defaults)` in `packages/compiler/src/shadow.ts`, which Studio does not depend on. `plan:spec/shadow-mode-verdict` moves it, verbatim, to `@jxsuite/runtime/css`, which Studio already imports (`panels/stylebook-doc.ts`).
- Tests: `tests/events-panel.test.ts` ("the custom element's outward contract", line 859), `tests/signals-panel-template.test.ts` ("a custom element gets the CEM fields", line 507), `tests/signals-panel.test.ts` (`collectCssParts`, line 167), `tests/transact.test.ts` ("state definitions", line 320), and `tests/logic-panel-surface.test.ts`, whose `actions` constant is typed `LogicActions`.

**What is missing**: a writer for the root `observedAttributes`, a rule tying it to the per-entry `attribute`, and, for the two CSS rows, a route from the list to the control that declares each, with parts shown only where `::part()` applies.

## Outcome

studio.md §6.5 → Implemented, every row of its table Implemented:

- Observed attributes: the Logic tab edits the root `observedAttributes` (add from a menu or by name, remove, repair), keeping each typed entry's `attribute` in step, and the Data panel shows the same fact as a checkbox.
- CSS custom properties: the section is on every component root, and each row opens the Style tab's Custom section, the one writer.
- CSS parts: the section is on a component that renders into a shadow root, lists each name of each element's `part`, and each row selects that element on the Content tab, the one writer.

Ride-along, not a claim: spec.md §16.5 gains the sentence saying which entry an observed attribute writes, the rule every control here rests on. Its marker stays `plan:_shared/compiled-element-lifecycle`'s.

studio.md does not graduate: other items stay open with their own plans.

## Decisions

- **Open:** does declaring an attribute on an entry observe it? Recommendation: yes, one fact written in two places by one gesture. Adding `user-name` appends it to the root `observedAttributes` and, on a typed entry (Shape 2, `isExpandedSignal`), writes `attribute: "user-name"` on `userName`; removing it clears both and the entry's `reflects`. The Data panel's free-text **Attribute** field becomes a checkbox, because the only attribute that can reach an entry is its key's kebab spelling (`absorbAttribute`'s rule, which this plan writes into spec.md §16.5), so a free-text name is either that spelling or dead. Because the runtime reads only the root list, the build's manifest links an entry's `attribute` only when an observed name writes it (spec.md §16.8, as `plan:spec/cem-manifest-export` specifies it), and the kit already keeps the two paired by hand in every one of its 269 entries. The alternative, writing only the root list and leaving `attribute` to hand authors, leaves the annotation spec.md §16.8 lists unwritten by Studio and a kit whose convention Studio does not follow.
- **Open:** CSS parts: offered only to a component that renders into a shadow root, or the row removed? Recommendation: offered only when `resolveShadowMode(doc, projectConfig.defaults)` is not `null`, because spec.md §16.6 supports `$shadow` as an opt-in and the build's manifest exports `cssParts` for exactly those components, so the Logic tab lists what the manifest publishes. Removing the row would drop the `plan:spec/shadow-mode-verdict` edge and leave shadow authors no read-back.
- **Open:** should custom properties and parts gain CEM `description` (and, for properties, `syntax`) through a new root annotation? Recommendation: no, and no `Future` remainder. The declaration is the root style key (name and default) and the `part` attribute (name). Nothing in Jx reads a description of either, a root key would have to be taught to the schema, the interpreter's reserved keys and both compiled targets so none writes it onto an instance, and no spec text promised it. A later spec change can add a root `cssProperties` annotation that `cemModule` merges.
- **Decided:** the two CSS rows are declared where they already live. The Style tab's Custom section is the one writer of a root `--*` key and the Content tab's attributes the one writer of `part`, and the Logic tab's rows route there instead of drawing a second form, because a second surface for a capability that already exists is the defect `studio-ui-guidelines.md` §12.5 names (two surfaces then disagree about one capability). A property row switches to the Style tab with the nested selector cleared and the Custom section open; it leaves the breakpoint and scheme axes alone, since they belong to the pane (§6.2). A part row selects the carrying element and switches to the Content tab.
- **Decided:** the rules live beside the rules they invert. `isObservedAttributeName(name)` and `observedAttributeFor(key)` go in `@jxsuite/schema/guards` beside `attributeStateKey`, so the round trip is tested in one file. `cssPartCarriers(doc)` goes in `@jxsuite/schema/cem-manifest` and `cssPartNames` becomes its deduplicated names, so the Logic tab lists exactly what the manifest exports. The carriers skip the definition root itself, whose `part` names the host in the tree around it, not a part of its own shadow tree, and split a `part` list on whitespace.
- **Decided:** an attribute name is lowercase letters and digits in hyphen-separated runs, starting with a letter (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`). The HTML parser lowercases attribute names, so an uppercase list entry never matches, and a double or trailing hyphen does not camel-case back. On that set `attributeStateKey` and `observedAttributeFor` are inverse, so a key whose kebab spelling falls outside it (`URL`, `$open`) cannot be set from markup and is offered no control.
- **Decided:** the menu offers the public entries an attribute can set, judged by the value the entry holds, because `absorbAttribute` coerces by that value and not by `type`: a Shape 1 value, or a Shape 2 entry's `default`, that is a number, a boolean, or a string that is not a template. §16.5 coerces an attribute to those three only. A pure type definition (Shape 2b, `{ "type": "number" }`) holds nothing, so an attribute would write its text as a string, and it cannot carry `attribute` (the typed schema requires `default`); it is not offered. Shape 1 entries stay Shape 1: only the root list is written for them, because `mutateUpdateDef` would expand one into `{ default }`.
- **Decided:** every writer lives in `src/tabs/transact.ts`, and renaming or removing a state entry retargets the observed names that write it inside `mutateRenameDef` and `mutateRemoveDef`. The Data panel calls both and the assistant's tools (`services/ai-tools.ts`) call `mutateRemoveDef`, so no caller can leave a list naming a key that is gone. `observedAttributes` joins `DOC_META_KEYS`, so an undo patches as the `state` and `$media` edits do.
- **Decided:** the canvas frame is not reloaded when the list changes. The platform freezes `observedAttributes` at first definition, and `redefineElement` already reports a changed list (embedding.md §7). Studio sets instance values through `$props`, the primary interface (spec.md §16.2), so the frozen list costs nothing on the canvas.
- **Decided:** requires `plan:spec/cem-manifest-export`, which adds `attributeStateKey` to `@jxsuite/schema/guards` and `packages/schema/src/cem-manifest.ts` (this plan extends both), deletes `services/cem-export.ts`, the uncalled generator built around a `collectCssParts` helper, and rewrites the two CSS cells this plan replaces. Requires `plan:spec/shadow-mode-verdict`, whose `@jxsuite/runtime/css` export of `resolveShadowMode` is the one verdict the CSS Parts section reads; a local copy of the rule would be a third place it can drift. Studio does not depend on `@jxsuite/compiler`, where the rule lives today. That `S` plan has no prerequisite and is the move split out of `plan:spec/shadow-dom-parity`, whose remaining slices this plan does not need; the second Open's alternative drops the edge.

## Implementation

1. `packages/schema/src/guards.ts`, beside `attributeStateKey`:
   - `isObservedAttributeName(name: string): boolean`, the pattern in Decisions.
   - `observedAttributeFor(key: string): string | null`: `key.replaceAll(/[A-Z]/g, (c) => "-" + c.toLowerCase())`, returned only when it passes `isObservedAttributeName` and `attributeStateKey` gives `key` back.
   - JSDoc on both cites spec.md §16.5 and the parser's lowercasing.
2. `packages/schema/src/cem-manifest.ts`:
   - `export interface CssPartCarrier { name: string; tagName: string; path: (string | number)[] }`.
   - `export function cssPartCarriers(doc: unknown): CssPartCarrier[]`: walk the root's static `children` (as `collectSlotDefs` does, but not the root node), `path` as `["children", i, "children", j, …]`, one carrier per whitespace-separated name per element in first-seen order, `tagName` from `displayTagName` (`"div"` when empty).
   - `cssPartNames(doc)` returns the unique names of `cssPartCarriers(doc)`. The prerequisite's walk already starts at the root's `children` and splits on whitespace, so its output and its test cases are unchanged; this removes the second walk, not a behaviour.
3. `packages/studio/src/services/component-contract.ts` (new, `@docs studio/logic/events`), pure reads over a document, importing only `@jxsuite/schema/guards` and types:
   - `attributeCoercion(entry): "string" | "number" | "boolean" | null`, the menu rule in Decisions: the held value is the entry itself unless `isExpandedSignal(entry)`, then its `default`; any other object (a pure type definition, `$prototype`, `$expression`, `$ref`, `$compute`) and any template string, array, object or `null` value gives `null`.
   - `observedRows(doc)`: one row per root `observedAttributes` string, in order: `{ name, key: attributeStateKey(name), coercion, reflects, problem }`. `problem` is `"not-lowercase"` when the name fails `isObservedAttributeName`, `"undeclared"` when `key` is not in `state` or is private, `"unsettable"` when `attributeCoercion` is `null`, else `""`.
   - `unlinkedEntries(doc)`: every object entry whose string `attribute` is not in the list or does not camel-case to its key: `{ key, attribute, fix: observedAttributeFor(key) }` (`null` fix means clear).
   - `attributeCandidates(doc)`: `{ key, name, coercion }` for each public, settable entry with a spelling that the list does not hold, in `state` order.
4. `packages/studio/src/tabs/transact.ts`:
   - `DOC_META_KEYS` gains `"observedAttributes"`.
   - `mutateSetObservedAttributes(tab, names)`: the `mutateUpdateMedia` shape; deletes the key when `names` is empty; records `setKeyPair([], "observedAttributes", …)` and a `doc-meta` patch.
   - `mutateObserveAttribute(tab, name)`: append when absent. When `state[attributeStateKey(name)]` is a Shape 2 entry (`isExpandedSignal`), `mutateUpdateDef(t, key, { attribute: name })`; any other entry (a Shape 1 value, a Function, a data source, an "Other name…" that names nothing) gets only the list write, so no write leaves a document the schema rejects.
   - `mutateUnobserveAttribute(tab, name)`: drop it. The linked object entry whose `attribute === name` loses `attribute` and `reflects`.
   - `mutateRepairAttribute(tab, key)`: with a spelling, set the entry's `attribute` to it and observe it; without one, clear `attribute` and `reflects`.
   - `mutateRenameDef` / `mutateRemoveDef`: after the state write, every listed name whose `attributeStateKey` is the old key is replaced in place by `observedAttributeFor(newKey)` (deduplicated) or dropped on removal or when there is none; the moved entry's `attribute` follows, or goes with its `reflects`. No list, no op.
5. `packages/studio/src/surfaces/logic-panel.ts`:
   - `LogicKvView` gains `tone`, `note`, `fixLabel`, `openTitle` and `removeTitle`; an empty string draws nothing.
   - `LogicView` gains `observedMenuOpen`, `cssPropsEmpty` and `cssPartsEmpty`.
   - `LogicActions` gains `addObserved(anchor)`, `removeObserved(key)`, `fixObserved(key)`, `openCssProp(key)`, `openCssPart(key)` and `openStyle()`.
   - `emptyLogicView()` fills the defaults.
6. `packages/studio/src/surfaces/logic-panel.json`:
   - The three `kv` templates gain `kv-note`, a `kv-fix` text button, `kv-open` (the `case-open` arrow button) and `kv-remove` (the `case-remove` trash button), each hidden when its field is empty, and `data-tone` on the row.
   - Observed Attributes gains an `add-observed` `jx-action-button` ("Add attribute", icon `plus`, `haspopup: "menu"`, `expanded` bound to `observedMenuOpen`, `studio-ui-guidelines.md` §10) calling `addObserved` with `event#/currentTarget`. Its empty message becomes "Attributes let a page set this component from markup. Add one to choose which values a page can write in HTML."
   - CSS Properties renders on every component root, with the empty message "No custom properties yet. A --name in this component's root style is one a page may override." and an "Open in Style" button (`openStyle`).
   - CSS Parts has the empty message "No parts yet. Give an element a part attribute on the Content tab to let a page style it with ::part()."
   - The outward-contract `$description` says the first section edits and the other two route to their writers.
7. `packages/studio/src/panels/events-panel.ts`, the contract block:
   - `view.observed` is `observedRows(doc)` then `unlinkedEntries(doc)`, keyed `attribute:<name>` and `unlinked:<key>`: detail `→ key`, value the coercion, tag `reflects`, `removeTitle` "Stop observing <name>" on list rows, and `tone: "warning"` with a note naming the problem ("Attribute names are lowercase in HTML, so this never matches", "Sets <key>, which this component does not declare", "Sets <key>, which an attribute cannot set", "Declared on <key>, but not observed, so a page cannot set it") and, on unlinked rows, `fixLabel` "Observe as <fix>" or "Clear".
   - `addObserved` opens `openMenu` (the `openEventNameMenu` shape) over `attributeCandidates(doc)` (id the name, title `user-name → userName`), then a divided "Other name…" row that opens `showPromptDialog("Attribute name", …)`. The prompt validates with `isObservedAttributeName` and refuses a name already listed, with the message "The attribute sets the value its camel-cased name spells: max-items sets maxItems." `observedMenuOpen` is set while open and cleared in `onClosed`.
   - Each pick, `removeObserved` and `fixObserved` is one `transactDoc` over the step-4 writers.
   - `hasCssProps` is true on every component root and `cssPropsEmpty` when there are no keys. `openCssProp` and `openStyle` set `session.ui.activeSelector = null` and assign `session.ui.styleSections = { ...styleSections, other: true }` (a fresh object, as the Style tab's own `toggleSection` does), then `setInspectorTab("style")` through the lazy `import("./right-panel")` that properties-panel's `showLogicTab` uses.
   - `hasCssParts` is `resolveShadowMode(doc, projectState?.projectConfig?.defaults) !== null` (from `@jxsuite/runtime/css`), and rows come from `cssPartCarriers(doc)`, keyed `<name>@<path>`, detail `<tag>`. `openCssPart` sets `session.selection = [path]` and switches to `"properties"`.
   - The `collectCssParts` import goes, and the file header's contract bullet is updated.
8. `packages/studio/src/panels/signals-panel.ts`:
   - In `stateFields`, for a custom element, the **Attribute** text field is replaced by a checkbox (`key`/`prop` `observed`) labelled `Observed as <name>`, checked when the list holds the name; checking calls `mutateObserveAttribute`, unchecking `mutateUnobserveAttribute`. It is drawn when `observedAttributeFor(key)` is not `null` and either `attributeCoercion` accepts the raw entry (`S.document.state[key]`, since `asSignalDef` flattens a Shape 1 value to `{}`) or the list already holds the name, so an array, object or template entry is never offered one but an existing observation can still be removed. **Reflects** shows while observed or already set; checking it on an observed entry writes `attribute` with `reflects` in one `mutateUpdateDef`, because that call makes a Shape 1 value typed and a typed observed entry carries its `attribute`. An entry with no spelling gets neither control.
   - Delete `collectCssParts`.
9. `spec.md` §16.5's sentence (Specs & docs) and its docs line, so the rule the controls rest on is specified.

**Integration contract.** Once this lands, `@jxsuite/schema/guards` exports `isObservedAttributeName` and `observedAttributeFor`, and `@jxsuite/schema/cem-manifest` exports `cssPartCarriers` (with `cssPartNames` derived from it, root excluded). Studio writes the root `observedAttributes` and a typed entry's `attribute` together, only through the `mutate*Attribute` writers and the rename and remove carry in `transact.ts`. No plan requires this one. `plan:studio-ui-guidelines/conventions-checklist-controls` (live `aria-expanded` on this document's openers) and `plan:studio-ui-guidelines/debounce-draft-layer` (`LogicActions`) edit the same files, so whichever lands second rebases; the new opener already binds `expanded`.

## Tests

Run `bun test --isolate --coverage` from `packages/schema` and `packages/studio`, then `bun scripts/check-coverage-manifest.ts` for each. Thresholds: `packages/schema` lines 0.99 / functions 0.99, `packages/studio` 0.958 / 0.941, per file. `services/component-contract.ts` is new, ships with its own test file that imports it statically, and must clear the studio bar alone. Ratchet either workspace whose worst file rises.

- `packages/schema/tests/guards.test.ts`:
  - "isObservedAttributeName accepts lowercase hyphenated names only": `user-name`, `a1`, `data-x` pass; `userName`, `-a`, `a-`, `a--b`, `1a`, `$open` and `""` fail.
  - "observedAttributeFor spells a key as the attribute that writes it": `userName`, `count`, `userID` (`user-i-d`), `item-2`; `URL`, `$open`, `a_b` give `null`.
  - "observedAttributeFor inverts attributeStateKey on every valid name", over a table.
- `packages/schema/tests/cem-manifest.test.ts`:
  - "cssPartCarriers splits part lists, records each element's tag and path, and skips the root".
  - "cssPartNames is the carriers' names, deduplicated".
- `packages/studio/tests/component-contract.test.ts` (new):
  - "attributeCoercion follows the value the entry holds": Shape 1 string, number, boolean; a typed `integer` with a numeric default is `"number"`; a typed entry declaring `type: "number"` over a string default is `"string"`; a pure type definition `{ "type": "number" }`, a template, `$expression`, `Function`, array, object and `null` give `null`.
  - "observedRows keeps the list's order and reports each problem": one fixture covers `user-name`, `count`, `open`, `missing`, `label` (a template) and `userName`.
  - "unlinkedEntries finds each attribute no observed name writes, with its fix": unobserved matching, mismatched, and a key with no spelling.
  - "attributeCandidates offers settable public entries not yet observed": private, computed, function, array and spelling-less keys excluded.
- `packages/studio/tests/transact.test.ts`, "state definitions":
  - "observing appends the name and writes a typed entry's attribute, and leaves a value entry a value" (and a Function entry untouched when "Other name…" spells its key).
  - "unobserving drops the name, the key when empty, and the entry's attribute and reflects".
  - "repairing observes under the entry's own spelling, or clears".
  - "renaming an observed entry carries its attribute to the new spelling, and drops it when there is none".
  - "removing an observed entry drops its attribute".
  - "one undo restores the list and the entry together".
- `packages/studio/tests/events-panel.test.ts`, "the custom element's outward contract" (`widgetDoc` gains `observedAttributes: ["label"]`):
  - Replace the first case with "observed attributes list the root array, each row naming the entry it writes".
  - "Add attribute offers unobserved entries by attribute name and writes both places".
  - "Other name… observes a name the prompt accepted and refuses an uppercase or listed one".
  - "the trash button stops observing".
  - "a name that sets nothing declared is flagged".
  - "an entry whose attribute is not observed is listed with its fix, and the fix observes it".
  - "CSS Properties is present without custom properties, and a row opens the Style tab's Custom section".
  - "CSS Parts appear for a component's own $shadow or the project default, and not for light or $shadow: false".
  - "a part list is split, the root's own part is not listed, and a row selects its element on the Content tab".
  - Existing cases: `widgetDoc` also gains `$shadow: "open"`, so the `test.each` over the three sections still finds `cssparts`, and the light case overrides it with `$shadow: undefined`. "no attribute entries → the empty-state hint" passes `observedAttributes: undefined` (else `label` is listed as undeclared); its text assertion holds, since the new message keeps the first sentence. "CSS Parts collects part attributes from the tree" stops expecting `root`. "CSS Parts is omitted when no parts exist" becomes "a shadow component with no parts shows the empty message". "CSS Properties is omitted without custom properties" is deleted.
- `packages/studio/tests/logic-panel-surface.test.ts`: the typed `actions` constant gains the six new `LogicActions` members (`noop`), or the file stops typechecking.
- `packages/studio/tests/signals-panel-template.test.ts`: the CEM-fields case becomes "a typed entry is observed through a checkbox, and Reflects follows it" (entry `open`), plus "an entry whose name has no attribute spelling gets no Observed control" (`$open`), "an array entry gets no Observed control", and "Reflects on an observed Shape 1 value writes attribute with it".
- `packages/studio/tests/signals-panel.test.ts`: delete the `collectCssParts` describe, its import and its mention in the file header; the carriers' cases above replace it.

## Specs & docs

**studio.md §6.5**, in place (heading unchanged). The marker becomes:

> **Status: Implemented.** The Parameters and Emits editors are the Data panel's (`packages/studio/src/panels/signals-panel.ts`). A component root's Observed Attributes, CSS Properties and CSS Parts sections are the Logic tab's (`panels/events-panel.ts`, over `services/component-contract.ts`).

The last three rows become:

| Panel                 | Description                                                                                                                                 | Status          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Observed attributes   | Manage the root `observedAttributes` array, the attributes the element reads (`spec.md` §16.5)                                              | **Implemented** |
| CSS custom properties | List the `--custom-property` interface the root style declares, which a page may override; the Style tab's Custom section declares them     | **Implemented** |
| CSS parts             | List the `::part()` styling hooks of a component rendered into a shadow root (`spec.md` §16.6); an element's `part` attribute declares them | **Implemented** |

After the table, two paragraphs:

> **Declaring an attribute is observing it.** An observed attribute writes the state entry its camel-cased name spells (`spec.md` §16.5), so the one attribute that can set an entry is its key in kebab case: `user-name` for `userName`. A key with no such spelling (`URL`, `$open`) cannot be set from markup. An attribute name is lowercase letters and digits in hyphen-separated runs, because the HTML parser lowercases what it reads and a list entry that is not lowercase never matches. Adding an attribute, from the section's menu of settable entries or by name, appends it to `observedAttributes` and, on a typed entry, writes the same name as its `attribute` (`spec.md` §16.8), so the list the runtime reads and the annotation the manifest reads cannot disagree. Removing it clears both and the entry's `reflects`. The Data panel shows the same fact as a checkbox on each value an attribute can set, and renaming or deleting an entry carries or drops its attribute in the same step. An observed name that sets nothing settable, and an entry whose `attribute` no observed name writes into, are listed with a warning; the second has one fix, which observes it under its own spelling or, when there is none, clears it.
>
> **Custom properties and parts are declared where they already live.** A custom property is a `--` key in the component root's style, added, renamed and removed in the Style tab's Custom section (§6.2), and each row here opens it there. A part is a name in an element's `part` attribute, set on the Content tab (§6.1), and each row here selects that element. The CSS Parts section appears only when the component's own `$shadow`, or else the project's `defaults.shadow`, renders it into a shadow root, since light DOM has no `::part` (`spec.md` §16.6). A name on the definition's root is not listed: it names the host in the tree around it.

**spec.md §16.5**, in place, body only (the marker is `plan:_shared/compiled-element-lifecycle`'s). After the example, unless the prerequisite already added an equivalent sentence:

> An observed attribute writes the state entry whose key is its name in camel case: each hyphen followed by a lowercase letter is dropped and the letter uppercased, so `user-name` writes `userName` (`attributeStateKey` in `@jxsuite/schema/guards`). An entry whose key has no such spelling, such as `URL` or `$open`, cannot be set from markup.

No other spec changes. Once `plan:spec/cem-manifest-export` lands, spec.md §16.8's marker hands Studio's editors to §6.5, and its table row for `cssParts` ("`part` names in `children`") already describes what `cssPartCarriers` gives, root excluded.

**Fragments** (neither spec graduates):

- `bun run spec:change studio.md minor -m "§6.5 the Logic tab edits a component's observed attributes and keeps each typed entry's attribute annotation in step, the Data panel observes an entry through a checkbox, and the custom property and shadow-root part lists open the control that declares each."`
- `bun run spec:change spec.md minor -m "§16.5 states which state entry an observed attribute writes: the one whose key is the attribute name in camel case."` (a reconcile of shipped interpreter behaviour; skipped with the sentence when the prerequisite already added it)

**Docs** (no em dashes):

- `docs/studio/logic/events.md` (`code:` lists `events-panel.ts` and `logic-panel.ts`; add `packages/studio/src/services/component-contract.ts`). The frontmatter `description`'s "and read a component's contract" becomes "and edit a component's contract". Replace "A component's outward contract" from "On the root of a component file" to the end of its "All three are declared elsewhere" paragraph with:
  - A lead: "On the root of a component file, three sections state what a page may reach from outside:"
  - **Observed Attributes**: "the attributes a page can set this component with in HTML. Each row names the attribute, the value it sets, and how its text is read: as text, as a number, or as a switch that is on while the attribute is present. **Add attribute** lists the values an attribute can set, under the name each answers to (`userName` answers to `user-name`), and **Other name…** takes any lowercase name. The trash button stops observing one. A row with a warning is either an attribute that sets nothing this component can take, which you remove with its trash button, or a value that names an attribute the component does not observe, whose button fixes it."
  - **CSS Properties**: "the `--custom-properties` on the component's root style, which a page may override. Add, rename and remove them in the Style tab's **Custom** section; each row opens it there."
  - **CSS Parts**: "the `part` names a page may style with `::part()`. Parts exist only inside a shadow root, so the section appears only for a component that renders into one, by its own **$shadow** setting or the project default. Give an element a part with its `part` attribute on the Content tab; each row selects the element that carries it."
- `docs/studio/logic/data.md` (`code:` lists `signals-panel.ts`), "Components: props, attributes, and events", first bullet becomes: "On plain values: **Observed as** (a checkbox that lets a page set this value from an HTML attribute, named after the value, so `userName` answers to `user-name`), **Reflects** (once it is observed), and **Deprecated**. The Logic tab's **Observed Attributes** section on the component's root edits the same list. A value whose name has no attribute spelling, such as one starting with `$`, has no checkbox."
- `docs/framework/concepts/props-and-scope.md` (`spec: spec.md#16.5`), "Attribute props": after the sentence introducing the example, add "The attribute's name is the entry's name in kebab case: `userName` is set by `user-name`, and an entry whose name has none, such as one starting with `$`, cannot be set from markup." The example is unchanged.
- No change: `docs/studio/logic.md`, `docs/studio/design/repeaters.md` and `docs/studio/logic/data-sources.md`, which `docs:sync` names for `events-panel.ts` and `signals-panel.ts` but which describe neither section; `docs/framework/build.md`, named for `cem-manifest.ts`, which says what the manifest holds and not how part names are walked.

The landing pull request deletes this file.

## Acceptance

- `bun run plans:status --spec studio` no longer lists §6.5; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:section-refs` pass.
- The suites above pass in `packages/schema` and `packages/studio` with their coverage-manifest checks; `bun run typecheck` and `bun run lint` are clean.
- `grep -rn "collectCssParts" packages/studio/src` finds nothing, and `grep -rn "observedAttributes" packages/studio/src` finds the new writers and readers.
- By hand, under `bun run dev`, open `examples/components/user-card.json` and select its root:
  1. Logic tab, Observed Attributes, **Add attribute**: the menu offers `first-name → firstName` and not `scoreLabel` (a template) or `fullName` (a Function); pick `first-name`. The source shows `"observedAttributes": ["first-name"]` and `"attribute": "first-name"` on `firstName`; one undo removes both, and a redo restores them.
  2. Rename `firstName` to `givenName` in the Data panel: the list reads `given-name`, and so does the entry's `attribute`.
  3. Data panel, `givenName`: **Observed as given-name** is checked; uncheck it, and the list key and the entry's `attribute` go, with any `reflects`.
  4. CSS Properties: **Open in Style** lands on the Style tab with **Custom** open.
  5. In the source view, set the root's `"$shadow": "open"`, and add `part="label"` to a child on the Content tab: CSS Parts appears, and its row selects the child on the Content tab.
