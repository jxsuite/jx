---
status: drafted
disposition: implement
claims:
  - studio.md#6.5
requires:
  - spec/cem-manifest-export
  - spec/shadow-dom-parity
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

- The runtime reads only the root list: `defineElement` freezes `observedAttributes` as `static get observedAttributes()` (`packages/runtime/src/runtime.ts`, line 4225), and `absorbAttribute` (line 3614) writes an attribute into `state[camelCase(name)]`, coerced by the entry's current value (boolean presence, `Number()`, else the string). A per-entry `attribute` is read by no tier. `grep -rn observedAttributes packages/studio/src` is empty.
- The Logic tab's contract sections (`panels/events-panel.ts`, the `isCustomElement && isRoot` block at line 530; markup in `surfaces/logic-panel.json`, whose `$description` calls them "Three read-only lists — this is a report, not a form"):
  - Observed Attributes lists the state entries carrying `attribute`, not the root list. Its empty state says "Name an \"attribute\" on a data entry to expose it here", which produces an attribute nothing observes.
  - CSS Properties lists the root style's `--*` keys, and is hidden when there are none.
  - CSS Parts lists `collectCssParts(doc)` (`panels/signals-panel.ts`, line 348): the root's own `part` included, `part="a b"` one name, shown whatever the render mode.
- The Data panel (`stateFields` in `panels/signals-panel.ts`, line 687) gives a custom element's value entries a free-text **Attribute** field, a **Reflects** checkbox and **Deprecated**, all written through `mutateUpdateDef`.
- Where the declarations already have writers: the Style tab's **Custom** section (`customSection` in `panels/style-panel.ts`, line 1852) adds, renames, edits and removes any `--*` key at the current coordinate; the Content tab's custom attributes (`panels/properties-panel.ts`, "+ Add attribute", line 1884) set `part` on any element.
- `packages/ui/components/*.json`, the kit Studio is built from, pairs the two by hand: all 269 entries carrying `attribute` in 38 components name an attribute that is in the root `observedAttributes` and camel-cases to the entry's key.
- Studio does not know `$shadow`: the verdict is `resolveShadowMode(doc, defaults)` in `packages/compiler/src/shadow.ts`, which Studio does not depend on. `plan:spec/shadow-dom-parity` moves it to `@jxsuite/runtime/css`.
- Tests: `tests/events-panel.test.ts` ("the custom element's outward contract", line 859), `tests/signals-panel-template.test.ts` ("a custom element gets the CEM fields", line 507), `tests/signals-panel.test.ts` (`collectCssParts`, line 167), `tests/transact.test.ts` ("state definitions", line 320).

**What is missing**: a writer for the root `observedAttributes`, a rule tying it to the per-entry `attribute`, and, for the two CSS rows, a route from the list to the control that declares each, with parts shown only where `::part()` applies.

## Outcome

studio.md §6.5 → Implemented, every row of its table Implemented:

- Observed attributes: the Logic tab edits the root `observedAttributes` (add from a menu or by name, remove, repair), keeping each typed entry's `attribute` in step, and the Data panel shows the same fact as a checkbox.
- CSS custom properties: the section is on every component root, and each row opens the Style tab's Custom section, the one writer.
- CSS parts: the section is on a component that renders into a shadow root, lists each name of each element's `part`, and each row selects that element on the Content tab, the one writer.

studio.md does not graduate: other items stay open with their own plans.

## Decisions

- **Open:** does declaring an attribute on an entry observe it? Recommendation: yes, one fact written in two places by one gesture. Adding `user-name` appends it to the root `observedAttributes` and, on a typed entry (an object), writes `attribute: "user-name"` on `userName`; removing it clears both and the entry's `reflects`. The Data panel's free-text **Attribute** field becomes a checkbox, because the only attribute that can reach an entry is its key's kebab spelling (spec.md §16.5 derives the key from the name), so a free-text name is either that spelling or dead. Because the runtime reads only the root list, the build's manifest links an entry's `attribute` only when an observed name writes it (spec.md §16.8, as `plan:spec/cem-manifest-export` specifies it), and the kit already keeps the two paired by hand in every one of its 269 entries. The alternative, writing only the root list and leaving `attribute` to hand authors, leaves the annotation spec.md §16.8 lists unwritten by Studio and a kit whose convention Studio does not follow.
- **Open:** CSS parts: offered only to a component that renders into a shadow root, or the row removed? Recommendation: offered only when `resolveShadowMode(doc, projectConfig.defaults)` is not `null`, because spec.md §16.6 supports `$shadow` as an opt-in and the build's manifest exports `cssParts` for exactly those components, so the Logic tab lists what the manifest publishes. Removing the row would drop the `plan:spec/shadow-dom-parity` edge and leave shadow authors no read-back.
- **Open:** should custom properties and parts gain CEM `description` (and, for properties, `syntax`) through a new root annotation? Recommendation: no, and no `Future` remainder. The declaration is the root style key (name and default) and the `part` attribute (name). Nothing in Jx reads a description of either, a root key would have to be taught to the schema, the interpreter's reserved keys and both compiled targets so none writes it onto an instance, and no spec text promised it. A later spec change can add a root `cssProperties` annotation that `cemModule` merges.
- **Decided:** the two CSS rows are declared where they already live. The Style tab's Custom section is the one writer of a root `--*` key and the Content tab's attributes the one writer of `part`, and the Logic tab's rows route there instead of drawing a second form, because two writers of one fact is the defect `studio-ui-guidelines.md` §12.5 names. A property row switches to the Style tab with the nested selector cleared and the Custom section open; it leaves the breakpoint and scheme axes alone, since they belong to the pane (§6.2). A part row selects the carrying element and switches to the Content tab.
- **Decided:** the rules live beside the rules they invert. `isObservedAttributeName(name)` and `observedAttributeFor(key)` go in `@jxsuite/schema/guards` beside `attributeStateKey`, so the round trip is tested in one file. `cssPartCarriers(doc)` goes in `@jxsuite/schema/cem-manifest` and `cssPartNames` becomes its deduplicated names, so the Logic tab lists exactly what the manifest exports. The carriers skip the definition root itself, whose `part` names the host in the tree around it, not a part of its own shadow tree, and split a `part` list on whitespace.
- **Decided:** an attribute name is lowercase letters and digits in hyphen-separated runs, starting with a letter (`/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`). The HTML parser lowercases attribute names, so an uppercase list entry never matches, and a double or trailing hyphen does not camel-case back. On that set `attributeStateKey` and `observedAttributeFor` are inverse, so a key whose kebab spelling falls outside it (`URL`, `$open`) cannot be set from markup and is offered no control.
- **Decided:** the menu offers the public entries an attribute can set: a Shape 1 string (not a template), number or boolean, or a Shape 2 entry whose `type`, else whose `default`, is a string, number, integer or boolean. §16.5 coerces an attribute to those three only. Shape 1 entries stay Shape 1: only the root list is written for them, because `mutateUpdateDef` would expand one into `{ default }`.
- **Decided:** every writer lives in `src/tabs/transact.ts`, and renaming or removing a state entry retargets the observed names that write it inside `mutateRenameDef` and `mutateRemoveDef`. Those two are called by the Data panel and by the assistant's tools (`services/ai-tools.ts`), so no caller can leave a list naming a key that is gone. `observedAttributes` joins `DOC_META_KEYS`, so an undo patches as the `state` and `$media` edits do.
- **Decided:** the canvas frame is not reloaded when the list changes. The platform freezes `observedAttributes` at first definition, and `redefineElement` already reports a changed list (embedding.md §7). Studio sets instance values through `$props`, the primary interface (spec.md §16.2), so the frozen list costs nothing on the canvas.
- **Decided:** requires `plan:spec/cem-manifest-export`, which adds `attributeStateKey` to `@jxsuite/schema/guards` and `packages/schema/src/cem-manifest.ts` (this plan extends both), deletes `services/cem-export.ts`, the uncalled generator built around a `collectCssParts` helper, and rewrites the two CSS cells this plan replaces. Requires `plan:spec/shadow-dom-parity`, whose `@jxsuite/runtime/css` export of `resolveShadowMode` is the one verdict the CSS Parts section reads; a local copy of the rule would be a third place it can drift.

## Implementation

1. `packages/schema/src/guards.ts`, beside `attributeStateKey`:
   - `isObservedAttributeName(name: string): boolean`, the pattern in Decisions.
   - `observedAttributeFor(key: string): string | null`: `key.replaceAll(/[A-Z]/g, (c) => "-" + c.toLowerCase())`, returned only when it passes `isObservedAttributeName` and `attributeStateKey` gives `key` back.
   - JSDoc on both cites spec.md §16.5 and the parser's lowercasing.
2. `packages/schema/src/cem-manifest.ts`:
   - `export interface CssPartCarrier { name: string; tagName: string; path: (string | number)[] }`.
   - `export function cssPartCarriers(doc: unknown): CssPartCarrier[]`: walk the root's static `children` (as `collectSlotDefs` does, but not the root node), `path` as `["children", i, "children", j, …]`, one carrier per whitespace-separated name per element in first-seen order, `tagName` from `displayTagName` (`"div"` when empty).
   - `cssPartNames(node)` returns the unique names of `cssPartCarriers(node)`, so a `part` on the definition's root stops counting; re-read the prerequisite's `cssPartNames` case for a root `part`.
3. `packages/studio/src/services/component-contract.ts` (new, `@docs studio/logic/events`), pure reads over a document, importing only `@jxsuite/schema/guards` and types:
   - `attributeCoercion(entry): "string" | "number" | "boolean" | null`, the menu rule in Decisions.
   - `observedRows(doc)`: one row per root `observedAttributes` string, in order: `{ name, key: attributeStateKey(name), coercion, reflects, problem }`. `problem` is `"not-lowercase"` when the name fails `isObservedAttributeName`, `"undeclared"` when `key` is not in `state` or is private, `"unsettable"` when `attributeCoercion` is `null`, else `""`.
   - `unlinkedEntries(doc)`: every object entry whose string `attribute` is not in the list or does not camel-case to its key: `{ key, attribute, fix: observedAttributeFor(key) }` (`null` fix means clear).
   - `attributeCandidates(doc)`: `{ key, name, coercion }` for each public, settable entry with a spelling that the list does not hold, in `state` order.
4. `packages/studio/src/tabs/transact.ts`:
   - `DOC_META_KEYS` gains `"observedAttributes"`.
   - `mutateSetObservedAttributes(tab, names)`: the `mutateUpdateMedia` shape; deletes the key when `names` is empty; records `setKeyPair([], "observedAttributes", …)` and a `doc-meta` patch.
   - `mutateObserveAttribute(tab, name)`: append when absent. When `state[attributeStateKey(name)]` is a plain object, `mutateUpdateDef(t, key, { attribute: name })`.
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
   - `hasCssProps` is true on every component root and `cssPropsEmpty` when there are no keys. `openCssProp` and `openStyle` set `session.ui.activeSelector = null` and `session.ui.styleSections.other = true`, then `setInspectorTab("style")` through the lazy `import("./right-panel")` that properties-panel's `showLogicTab` uses.
   - `hasCssParts` is `resolveShadowMode(doc, projectState?.projectConfig?.defaults) !== null` (from `@jxsuite/runtime/css`), and rows come from `cssPartCarriers(doc)`, keyed `<name>@<path>`, detail `<tag>`. `openCssPart` sets `session.selection = [path]` and switches to `"properties"`.
   - The `collectCssParts` import goes, and the file header's contract bullet is updated.
8. `packages/studio/src/panels/signals-panel.ts`:
   - In `stateFields`, for a custom element, the **Attribute** text field is replaced by a checkbox (`key`/`prop` `observed`) labelled `Observed as <name>` when `observedAttributeFor(name)` is not `null`, checked when the list holds it; checking calls `mutateObserveAttribute`, unchecking `mutateUnobserveAttribute`. **Reflects** shows while observed or already set. An entry with no spelling gets neither.
   - Delete `collectCssParts`.

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
  - "attributeCoercion follows the declared value": Shape 1 string, number, boolean; typed `integer`; typed without `type`; template, `$expression`, `Function`, array, object and `null` give `null`.
  - "observedRows keeps the list's order and reports each problem": one fixture covers `user-name`, `count`, `open`, `missing`, `label` (a template) and `userName`.
  - "unlinkedEntries finds each attribute no observed name writes, with its fix": unobserved matching, mismatched, and a key with no spelling.
  - "attributeCandidates offers settable public entries not yet observed": private, computed, function, array and spelling-less keys excluded.
- `packages/studio/tests/transact.test.ts`, "state definitions":
  - "observing appends the name and writes a typed entry's attribute, and leaves a value entry a value".
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
  - The existing parts cases gain `$shadow: "open"`; "CSS Properties is omitted without custom properties" is deleted.
- `packages/studio/tests/signals-panel-template.test.ts`: the CEM-fields case becomes "a typed entry is observed through a checkbox, and Reflects follows it" (entry `open`), plus "an entry whose name has no attribute spelling gets no Observed control" (`$open`).
- `packages/studio/tests/signals-panel.test.ts`: delete the `collectCssParts` describe; the carriers' cases above replace it.

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

> **Declaring an attribute is observing it.** An observed attribute writes the state entry its camel-cased name spells (`spec.md` §16.5), so the one attribute that can set an entry is its key in kebab case: `user-name` for `userName`. A key with no such spelling (`URL`, `$open`) cannot be set from markup. An attribute name is lowercase letters and digits in hyphen-separated runs, because the HTML parser lowercases what it reads and a list entry that is not lowercase never matches. Adding an attribute, from the section's menu of settable entries or by name, appends it to `observedAttributes` and, on a typed entry, writes the same name as its `attribute` (`spec.md` §16.8), so the list the runtime reads and the annotation the manifest reads cannot disagree. Removing it clears both and the entry's `reflects`. The Data panel shows the same fact as a checkbox on a typed entry, and renaming or deleting an entry carries or drops its attribute in the same step. An observed name that sets nothing settable, and an entry whose `attribute` no observed name writes into, are listed with a warning; the second has one fix, which observes it under its own spelling or, when there is none, clears it.
>
> **Custom properties and parts are declared where they already live.** A custom property is a `--` key in the component root's style, added, renamed and removed in the Style tab's Custom section (§6.2), and each row here opens it there. A part is a name in an element's `part` attribute, set on the Content tab (§6.1), and each row here selects that element. The CSS Parts section appears only when the component's own `$shadow`, or else the project's `defaults.shadow`, renders it into a shadow root, since light DOM has no `::part` (`spec.md` §16.6). A name on the definition's root is not listed: it names the host in the tree around it.

**Fragment:** `bun run spec:change studio.md minor -m "§6.5 the Logic tab edits a component's observed attributes and keeps each typed entry's attribute annotation in step, the Data panel observes an entry through a checkbox, and the custom property and shadow-root part lists open the control that declares each."`

No other spec changes. Once `plan:spec/cem-manifest-export` lands, spec.md §16.8's marker hands Studio's editors to §6.5, and its table row for `cssParts` ("`part` names in `children`") already describes what `cssPartCarriers` gives, root excluded.

**Docs** (no em dashes):

- `docs/studio/logic/events.md` (`code:` lists `events-panel.ts` and `logic-panel.ts`; add `packages/studio/src/services/component-contract.ts`). Replace "A component's outward contract" from "On the root of a component file" to the end of its "All three are declared elsewhere" paragraph with:
  - A lead: "On the root of a component file, three sections state what a page may reach from outside:"
  - **Observed Attributes**: "the attributes a page can set this component with in HTML. Each row names the attribute, the value it sets, and how its text is read: as text, as a number, or as a switch that is on while the attribute is present. **Add attribute** lists the values an attribute can set, under the name each answers to (`userName` answers to `user-name`), and **Other name…** takes any lowercase name. The trash button stops observing one. A row with a warning is an attribute that sets nothing this component declares, or a value that names an attribute the component does not observe; its button fixes it."
  - **CSS Properties**: "the `--custom-properties` on the component's root style, which a page may override. Add, rename and remove them in the Style tab's **Custom** section; each row opens it there."
  - **CSS Parts**: "the `part` names a page may style with `::part()`. Parts exist only inside a shadow root, so the section appears only for a component that renders into one, by its own **$shadow** setting or the project default. Give an element a part with its `part` attribute on the Content tab; each row selects the element that carries it."
- `docs/studio/logic/data.md` (`code:` lists `signals-panel.ts`), "Components: props, attributes, and events", first bullet becomes: "On plain values: **Observed as** (a checkbox that lets a page set this value from an HTML attribute, named after the value, so `userName` answers to `user-name`), **Reflects** (once it is observed), and **Deprecated**. The Logic tab's **Observed Attributes** section on the component's root edits the same list. A value whose name has no attribute spelling, such as one starting with `$`, has no checkbox."
- No change: `docs/studio/logic.md`, `docs/studio/design/repeaters.md` and `docs/studio/logic/data-sources.md`, which `docs:sync` names for `events-panel.ts` and `signals-panel.ts` but which describe neither section; `docs/framework/build.md`, named for `cem-manifest.ts`, which says what the manifest holds and not how part names are walked; `docs/framework/concepts/props-and-scope.md` (spec.md §16.5), whose `observedAttributes` example is unchanged.

The landing pull request deletes this file.

## Acceptance

- `bun run plans:status --spec studio` no longer lists §6.5; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links` and `bun run docs:section-refs` pass.
- The suites above pass in `packages/schema` and `packages/studio` with their coverage-manifest checks; `bun run typecheck` and `bun run lint` are clean.
- `grep -rn "collectCssParts" packages/studio/src` finds nothing, and `grep -rn "observedAttributes" packages/studio/src` finds the new writers and readers.
- By hand, under `bun run dev`, open `examples/components/user-card.json` and select its root:
  1. Logic tab, Observed Attributes, **Add attribute**: the menu offers `first-name → firstName`; pick it. The source shows `"observedAttributes": ["first-name"]` and `"attribute": "first-name"` on `firstName`; one undo removes both.
  2. Data panel, `firstName`: **Observed as first-name** is checked; uncheck it, and both keys go, with any `reflects`.
  3. Rename `firstName` to `givenName` in the Data panel: the list reads `given-name`.
  4. CSS Properties: **Open in Style** lands on the Style tab with **Custom** open.
  5. Set the root's `$shadow` to `"open"` and add `part="label"` to a child: CSS Parts appears, and its row selects the child on the Content tab.
