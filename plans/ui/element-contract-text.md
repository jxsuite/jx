---
status: drafted
disposition: reconcile
claims:
  - ui.md#3.2
requires: []
workspaces:
  - packages/ui
  - specs
  - docs
size: S
---

# §3.2 states the element contract the kit actually holds, and the conformance test holds every clause of it

## Context

`specs/ui.md` §3.2, line 63:

> **Status: Partial.** Most clauses ship and are gated by `packages/ui/tests/conformance.test.ts` (typed, documented `state`; `part` on every internal node; a base `display`, with the `base-display` lint in `@jxsuite/schema/overlays`; no raw colour). Three differ from the code: no control observes an `aria-*` attribute, since controls observe `label`, `labelledby` and `describedby` and forward those (the §5 entries document that form); most custom events are dispatched with `bubbles` alone, not `composed` (`src/behaviors/dialog.ts`, `tabs.ts`, `tree.ts`, `toast.ts`, `swatch-group.ts`; only `split.ts` and `jx-option` set both); and the slot list names `prefix` and `suffix`, which no element has, while omitting `actions`, `status`, `heading`, `help`, `action` and `tokens`, which elements use. A fourth disagrees with the spec rather than the code: the ARIA-forwarding clause says forwarding names a control "until form association exists", as though form association were pending, where §11's WHATWG HTML row records it as a decision rather than a gap.

The clauses at fault are the Slots bullet (line 69), ARIA forwarding (line 71) and Events (line 72).

**Verified at the audited tree.** The stub's counts hold: 29 of the 38 documents in `packages/ui/components/` declare `label`, 12 `labelledby`, 8 `describedby`, and none declares a state key or `attribute` starting `aria-`. The named slots in use are exactly `icon`, `value`, `description`, `submenu`, `end`, `actions`, `status`, `heading`, `help`, `action` and `tokens`, and nothing in `components/`, `stylebook/`, `src/` or `tests/` names `prefix` or `suffix`. The 20 declarative `dispatchEvent` nodes all carry `bubbles: true` and only `jx-option.json`'s `select` carries `composed: true`. Beyond the stub:

- **The name lands in two places, not one.** Controls that wrap a native control write `aria-label`/`aria-labelledby`/`aria-describedby` on it (`jx-button`, `jx-textfield`, `jx-checkbox`, `jx-switch`, `jx-select`, `jx-number-field`, `jx-combobox`, `jx-color-slider`). Elements whose host carries the role write them on the host (`jx-listbox`, `jx-tab-panel`, `jx-toolbar`, `jx-tree`, `jx-tabs`, `jx-tab`, `jx-menu`, `jx-split`, among others). `jx-color-field` hands `label` and `labelledby` to its inner `jx-textfield` as props. `label` is also visible text on `jx-field` and a row's own words on `jx-option`.
- **More bubbles-only sites than the stub lists.** The helpers that re-dispatch `input`/`change` for a value the element wrote are bubbles-only too: `color-area.ts:116`, `color-field.ts:141`, `color-slider.ts:69`, `combobox.ts:119`, `number-field.ts:76`–`77`, `textfield.ts:73`–`74`. Two dispatches are internal and deliberately do not bubble: `toast-host.ts:138` (`jx-toast-pause`/`jx-toast-resume` on each child toast) and `dialog.ts:47` (the synthetic `toggle` shim on the inner `<dialog>`). No test asserts `composed`, and no Studio code puts a kit element in a shadow root. The interpreter has no shadow support at all (spec.md §16.6's marker).
- **Not every dispatch leaves the host.** `jx-tab`'s `close` is dispatched from `button[part="close"]`, `jx-tree-item`'s `toggle` from `[part="twisty"]`, and `jx-accordion-item`'s `toggle` from its `<details>`. `jx-accordion-item` then stops its `toggle` at the host (`onHostToggle`), and `jx-tabs` and `jx-swatch-group` stop their rows' `select` and dispatch `change`. So "bubbles" is what gets an event to the element, and "from the host" cannot be the rule.
- **`emits` has fourteen gaps, not six.** `onMount` dispatches `jx-ready` in ten documents. Four declare it (`jx-action-group`, `jx-color-field`, `jx-swatch-group`, `jx-toolbar`), and six do not (`jx-dialog`, `jx-menu`, `jx-popover`, `jx-tabs`, `jx-tooltip`, `jx-tree`). Studio listens for it (`packages/studio/src/ui/popover-surface.ts:130`, `src/surfaces/block-action-bar.ts:357`, `src/surfaces/slash-menu.ts:234`, and `src/surfaces/dialog.ts`'s own wait). Eight sidecar-bound functions also dispatch a public event they do not declare, while their siblings on the same element do: `jx-color-area`'s `onKeydown` (`input`, `change`), `onPointerDown` and `onPointerMove` (`input`) and `onPointerUp` (`change`); `jx-color-slider`'s `onKeydown` (`input`, `change`); `jx-color-field`'s `onDropper` (`input`, `change`, `color-field.ts:426`); `jx-combobox`'s `onKeydown` (`input`, `change`, through `commitRow`); and `jx-dialog`'s `onCancelClick` (`cancel`). `jx-toast`'s `onRelease` restarts the clock whose `close` its `onMount` already declares, and `jx-toast-host`'s `onHold`/`onRelease` send only the internal pause and resume, so neither is a gap.
- **§5 omits three slots.** The `jx-field` row (§5.3, line 251) does not name `help`, and the `jx-accordion-item` row (§5.4, line 278) does not name `heading` or `actions`. `docs/extending/ui-kit.md` documents all three.
- **The pending reading of form association is wider than §3.2.** The §5.1 marker (line 150) says "restoring a default is a host write of `value` until form association (§3.2) exists". The `value` description in `jx-textfield.json` ("until form association lands") and the `checked` description in `jx-switch.json` say the same, as do comments in `tests/switch.test.ts:158`, `tests/checkbox.test.ts:126` and `tests/number-field.test.ts:196`. So does the doc note at `docs/extending/ui-kit.md:199` ("not form-associated yet"). §11's WHATWG HTML row and spec.md's own WHATWG HTML row ("Not offered: `ElementInternals` for form association") treat it as settled.
- One consumer writes `aria-label` on a kit element: `packages/studio/src/surfaces/panel-stylebook-layers.json` gives a `jx-dot` `role="img"` and names it. `jx-dot` has no role or name of its own, so that is the consumer's own ARIA on the host and is legitimate. The contract must not forbid it.

## Outcome

- ui.md §3.2 → Implemented. Its ARIA-forwarding, Slots and Events clauses state what the kit does, and a new Form association clause records the decision §11 already cites. Every clause is held by `packages/ui/tests/conformance.test.ts`.
- Code conforms to the reconciled text at sixteen sites. `split.ts` and `jx-option.json` drop `composed`, six `onMount` functions declare the `jx-ready` they dispatch, and eight sidecar-bound functions declare the `input`, `change` or `cancel` they dispatch. No behaviour changes for a consumer outside a shadow root.
- Ride-alongs, which carry no claim: §5.1's marker drops "until form association exists". The §5.3 `jx-field` row and the §5.4 `jx-accordion-item` row name their slots. Two component descriptions and three test comments stop reading form association as pending.
- ui.md stays Partial: §2, §3.1, §3.3, §4.1, §5.1, §5.2, §5.4, §5.5, §6 and §7 are owned by other plans, so nothing graduates.

## Decisions

- **Open:** is `composed` part of the events contract? Recommendation: no. A custom event is dispatched with `bubbles: true` and without `composed`, and `split.ts:165` and `jx-option.json`'s `onClick` drop it. The kit is light DOM with no `$shadow` (§2, gated), so `composed` changes nothing a light-DOM consumer can observe. It only matters to a consumer that puts a kit element in a shadow root of its own. That consumer's own handlers inside the root hear the event either way. Composing it would push the kit's platform-named events (`change`, `close`, `toggle`, `select`) out through that consumer's host, retargeted as if the host had sent them, which is exactly why the platform's own `change` is not composed. 32 of the 34 public dispatch sites already behave this way, so the recommendation changes two. The alternative, `composed: true` everywhere, touches the other 32 sites and makes this plan `implement`. Either way the level stays minor, because the promise was never kept by most sites and no consumer in the repository crosses a shadow boundary.
- **Decided:** the ARIA-forwarding clause states the props as they ship (`label`, `labelledby`, `describedby`) and says where they land: the inner native control, the host when the host carries the role, or an inner kit element's own prop. It does not forbid a consumer's own `aria-*` on a host. `panel-stylebook-layers.json`'s named `role="img"` on `jx-dot` is correct, and ARIA 1.2 already makes an `aria-label` on a role-less host inert.
- **Decided:** form association is recorded in §3.2 as a decision, not a Future remainder. §11's WHATWG HTML row already says "§3.2 records it as a decision", spec.md's WHATWG HTML row says "Not offered", and the census recorded it the same way (plans/ui/README.md). The clause gives the reason: in light DOM the inner native control is itself a descendant of the form, so submission and validation already work. It also states the cost: a reset never reaches the element, so value-holding elements mirror their value into the control's default.
- **Decided:** the slot list becomes a closed vocabulary with one meaning per name, in a table §3.2 owns, and a conformance test holds every named slot to it. Deferring to each §5 entry would drop the one thing a shared list gives: `actions` means "a control whose click stops there" on `jx-tab`, `jx-tree-item` and `jx-accordion-item` alike. It would also leave no gate, and §5 already omits three slots. A new name costs a line in the table and in the test's set, in the pull request that adds the element. No slot is renamed. `value` on `jx-menu-item` and `end` on `jx-option` overlap, but renaming a public slot breaks every consumer for no gain.
- **Decided:** `jx-ready` is named in the events clause and declared in `emits` on the six `onMount` functions missing it, with the wording the other four use, and the eight sidecar-bound functions above declare what they dispatch as their siblings already do. Studio listens for `jx-ready`, and the emits rule needs one statement with no exception list.
- **Decided:** the gates test documents, not prose. The per-document checks read the component JSON. The sidecar check scans module source with the existing `codeOnly` helper. No test parses `specs/ui.md`. The sidecar half of `emits` stays under review rather than a gate, because matching a module's dispatch names to the function a document binds needs a call graph through each module's helpers (`announce`, `emit`, `commitRow`). This pass found eight undeclared that way, and step 10 closes them; a reviewer adding a sidecar handler checks its helpers the same way.
- **Decided:** not a paper plan. It carries a small `packages/ui` change and new gates, so it lands in its own execute pull request and not in the detailing one.

## Implementation

All spec edits are in `specs/ui.md`, in place. Every paragraph and bullet is one source line. The executor may tighten wording but must keep every fact and element name.

1. **§3.2 marker (line 63)** becomes:

   > **Status: Implemented.** `packages/ui/tests/conformance.test.ts` holds the contract over every component document: typed, documented `state` with no `aria-*` prop and no name prop left unread; `part` on every internal node; named slots only from the table below; a base `display`, with the `base-display` lint in `@jxsuite/schema/overlays`; every event a document's own body dispatches bubbling, uncomposed and declared in `emits`, with no behaviour module setting `composed`; no handler parameters; and no raw colour. Form association is a decision (§11, WHATWG HTML).

2. **Slots bullet (line 69).** Replace "by the names the catalogue lists: `icon`, `value`, `description`, `submenu`, `prefix`, `suffix`, `end`." with "by a name from the slot table below, each meaning the same on every element that uses it. A new element reuses a name before it mints one, and a new name joins the table in the same change. An element whose words are its `label` has no default slot (`jx-tab`, `jx-option`, `jx-tree-item`), so unnamed content cannot join its name." Keep the rest of the bullet (the §16.6 unwrapping and the `:empty` rule) unchanged.
3. **ARIA-forwarding bullet (line 71)** becomes:

   > **ARIA forwarding.** An element takes its accessible name as props and observes no `aria-*` attribute. `label` is the name as a string, and `labelledby` and `describedby` are id references. The element writes them as `aria-label`, `aria-labelledby` and `aria-describedby` on the node that carries its role. That node is the inner native control of an element that wraps one (`jx-button`, `jx-textfield`, `jx-checkbox`, `jx-select`) or the host where the host carries the role (`jx-listbox`, `jx-toolbar`, `jx-tree`, `jx-tab-panel`). A composed element hands them to the kit element inside it that owns the node (`jx-color-field` gives its `label` and `labelledby` to its `jx-textfield`). An element with sentences of its own (an error, a help line, a `hint`) names them in `aria-describedby` ahead of the consumer's `describedby`. The props are unprefixed so the name lands only where it belongs: an `aria-*` attribute on a host whose role lives inside it is ARIA on a generic element, which ARIA 1.2 does not name. A consumer that gives a role-less element a role of its own names it the same way it would any node (`role="img"` and `aria-label` on a `jx-dot`). Each §5 entry says which props an element takes, and where `label` is also visible text (`jx-field`) or a row's own words (`jx-option`).

4. **New bullet after ARIA forwarding:**

   > **Form association.** No element is form-associated: none uses `ElementInternals`, and that is a decision rather than a gap (§11, WHATWG HTML). In light DOM the inner native control is itself a descendant of the form, so it submits under the `name` the element forwards and validates as itself. What association would add is the element hearing a form reset. Instead, an element that holds its value in a native control also writes it as that control's default (§5.1, §5.3, §5.6), so a reset moves nothing; `jx-select` is the exception, writing `value` as a property only for the reason §5.1 gives. Either way the element's `value` is the truth, and a host restoring a default writes it.

5. **Events bullet (line 72)** becomes:

   > **Events.** Native events bubble from the inner native control, so `event.target` is that control, except where an element stops them and re-says them from its host because the control alone would mislead a listener (the colour family, §5.6). An event the element dispatches itself is dispatched with `bubbles: true`, so it reaches a listener on the element whichever of its nodes sent it. That covers a custom name, `input` and `change` for a value the element wrote (the platform fires neither for a programmatic write), and `jx-ready`, which `onMount` dispatches so the element's own handlers and a host can find the rendered host. It is declared with `emits` on the function whose body or sidecar dispatches it. It is not `composed`: the kit has no shadow root for an event to leave, and a consumer that puts an element inside a shadow root of its own hears the event there and decides what its own host says, as it would for the platform's `change`. An element may stop an event at its own boundary where an ancestor would misread it, and its entry says so (`jx-accordion-item`'s `toggle`, `jx-tabs` over its tabs' `select`). Two dispatches are not the element's events and neither bubble nor are declared: the `toggle` `jx-dialog` synthesises on its own `<dialog>` where the engine fires none, and the pause and resume `jx-toast-host` sends each toast in its stack (§5.2).

6. **Slot table**, placed after the bullet list and before §3.3, headed by the sentence "The slot names, and what each one takes:":

   | Name          | What goes in it                                                | Elements                                                           |
   | ------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
   | `icon`        | a glyph drawn before the element's words                       | `jx-button`, `jx-menu-item`, `jx-option`, `jx-tab`, `jx-tree-item` |
   | `status`      | a mark about the item; a click on it is a click on the item    | `jx-tab`, `jx-tree-item`                                           |
   | `actions`     | a control; its click stops there and never selects or toggles  | `jx-tab`, `jx-tree-item`, `jx-accordion-item`                      |
   | `heading`     | an inert mark beside a section's label                         | `jx-accordion-item`                                                |
   | `description` | one secondary line                                             | `jx-menu-item`                                                     |
   | `value`       | a chord at the end of a row                                    | `jx-menu-item`                                                     |
   | `end`         | one mark or chord at the end of a row                          | `jx-option`                                                        |
   | `submenu`     | a child `jx-menu`                                              | `jx-menu-item`                                                     |
   | `help`        | guidance richer than the `description` prop, which it replaces | `jx-field`                                                         |
   | `action`      | the one recovery control                                       | `jx-toast`                                                         |
   | `tokens`      | the picker's token swatches                                    | `jx-color-field`                                                   |

7. **Ride-along spec edits.**
   - §5.1 marker (line 150): "so restoring a default is a host write of `value` until form association (§3.2) exists" becomes "so restoring a default is a host write of `value`, because no element is form-associated (§3.2)". `plan:ui/menu-radio-rows` rewrites other clauses of the same marker, so whichever lands second rebases one sentence.
   - §5.3 `jx-field` row (line 251): after "the label-to-control naming contract the four classes it replaces could not hold", add "; a `help` slot that replaces the `description` sentence when filled". `plan:studio-ui-guidelines/inline-error-role` rewrites another clause of the same cell (`invalid` takes the label from `warning`); the clauses are independent, and whichever plan lands second keeps the other's.
   - §5.4 `jx-accordion-item` row (line 278): after "a re-announced `toggle` that stops at the element", add "; slots `heading` (an inert mark beside the label) and `actions` (a control whose click neither toggles nor is cancelled)". `plan:ui/jx-table` adds rows to the same table, and the edits do not overlap.
   - §3's own marker is not touched. `plan:ui/behaviour-list-text` removes its "(§3.1, §3.2, §3.3)" enumeration. The "Declarative first" bullet is not touched either, and that plan relies on it as written.
8. **`packages/ui/src/behaviors/split.ts`**, `announce()` (line 162): `new CustomEvent(name, { bubbles: true, detail: modifiers })`. Update its doc comment to say it bubbles and is not composed (ui.md §3.2).
9. **`packages/ui/components/jx-option.json`**, `state.onClick`: delete `"composed": true` from the `select` dispatch.
10. **`emits` where a dispatch is undeclared.**
    - Add `"emits": [{ "name": "jx-ready", "description": "…" }]` to `state.onMount` in `jx-dialog.json`, `jx-menu.json`, `jx-popover.json`, `jx-tabs.json`, `jx-tooltip.json` and `jx-tree.json`. Each description is one sentence in the four existing declarations' form ("The element has rendered, so …"), saying what a listener may now do: for `jx-dialog`, open it, as its `onMount` description already says; for `jx-popover` and `jx-menu`, show it, which is what `popover-surface.ts` waits for.
    - Add `emits` to the eight sidecar-bound functions listed under Context, copying the entry the same element's sibling already carries for that name (`jx-color-area`'s `onInput`/`onChange`, `jx-color-slider`'s, `jx-color-field`'s, `jx-combobox`'s `onPick`, `jx-dialog`'s `onNativeCancel`): `jx-color-area` `onKeydown` `input`+`change`, `onPointerDown` and `onPointerMove` `input`, `onPointerUp` `change`; `jx-color-slider` `onKeydown` `input`+`change`; `jx-color-field` `onDropper` `input`+`change`; `jx-combobox` `onKeydown` `input`+`change`; `jx-dialog` `onCancelClick` `cancel`.
11. **Form association wording in `packages/ui`.**
    - `components/jx-textfield.json`, `state.value.description`: "reset() is a no-op on this field until form association lands" becomes "reset() is a no-op on this field, because the element is not form-associated".
    - `components/jx-switch.json`, `state.checked.description`: "so until the element is form-associated (specs/ui.md §3.2) form.reset() moves this switch nowhere" becomes "so, because the element is not form-associated (specs/ui.md §3.2), form.reset() moves this switch nowhere".
    - In the test comments, `tests/switch.test.ts:158` "until the element is form-associated" becomes "because the element is not form-associated", `tests/checkbox.test.ts:126` drops "yet", and `tests/number-field.test.ts:196` drops ", and it changes the day the element is form-associated".
12. **`packages/ui/tests/conformance.test.ts`**, the new gates in Tests below. Reuse `documents`, `internalNodes`, `codeOnly` and the `behaviorsDir` loop that are already there. `codeOnly` and `behaviorsDir` are local to the `describe("the kit keeps its principles (ui.md §2)")` block, so the module check goes inside that block's existing `behaviorsDir` loop, or both are hoisted to module scope for a sibling `describe`. Add `SLOT_NAMES` as a module constant with a comment citing ui.md §3.2's slot table. Extend the file header's list of what is held to name the three new clauses.
13. **Docs**, as in Specs & docs.
14. **Plan housekeeping.** Delete this file in the landing pull request. No plan requires it.

**Integration contract.** No plan requires this one. Once it lands:

- ui.md §3.2 is Implemented, and `conformance.test.ts` refuses five things in any kit document: a state key or `attribute` starting `aria-`; a declared `label`, `labelledby` or `describedby` that the document never references; a `<slot>` whose name is not in `SLOT_NAMES`; a `dispatchEvent` in a document's own function body without `bubbles: true`, with `composed`, or missing from its function's `emits`; and `composed:` in any behaviour module.
- A plan that adds an element must pass all five. One that adds a named slot adds the name to §3.2's table and to `SLOT_NAMES` in the same pull request. That covers `plan:ui/jx-table` (its elements should need only default slots), `plan:ui/menu-radio-rows` (`jx-menu-group`, if built, may want `heading`, which already means an inert mark beside a label) and `plan:ui/studio-toast-host`, which uses `jx-toast`'s existing `action` slot.
- `plan:ui/overlay-transitions-and-slot`'s `[part="overlay-slot"]` is a part, not a slot name, and is unaffected.

## Tests

The suite is `packages/ui`: `bun test --isolate --coverage` from `packages/ui`, then `bun scripts/check-coverage-manifest.ts packages/ui`.

New cases in `tests/conformance.test.ts`:

- In the per-tag `describe` under "kit documents":
  - **"takes its name as props, never as `aria-*` attributes, and reads every one it declares"**: no key of `doc.state` and no entry's `attribute` starts with `aria-`. For each of `label`, `labelledby` and `describedby` the document declares, the document with that state entry removed still contains a word-bounded `state.<key>` or `#/state/<key>`. `\bstate\.label\b` does not match `state.labelledby`.
  - **"names its slots only from ui.md §3.2's table"**: every node from `internalNodes(doc)` with `tagName === "slot"` either has no `attributes.name` or has a name in `SLOT_NAMES`, and the failure message names the tag and the slot.
  - **"dispatches every event bubbling, uncomposed and declared"**: for each `doc.state` entry with `$prototype: "Function"`, every node in its `body` with a string `dispatchEvent` has `bubbles === true` and `composed === undefined`, and its name is in that function's `emits[].name`.
- In "the kit keeps its principles (ui.md §2)" (or a sibling `describe` named for §3.2), per module in `src/behaviors/`: **"behaviors/<name> dispatches nothing composed"**, meaning `/\bcomposed\s*:/` does not match `codeOnly(source)`. Comments that say "composed control" are stripped by `codeOnly`.
- **"the slot table and the kit agree"** (once, not per tag): the set of named slots across all documents equals `SLOT_NAMES`, so a retired name cannot linger in the list.

Behavioural assertions:

- `tests/split.test.ts`: a new case under the modifiers `describe`, **"input and change bubble to a parent and are not composed"**. A pointer drag on a split inside a wrapper `div`: the wrapper's listener hears `input` and `change`, and each has `bubbles === true` and `composed === false`.
- `tests/listbox.test.ts`, `describe("jx-option")`: extend "a click picks the row and a disabled row picks nothing" to assert that the heard `select` has `bubbles === true` and `composed === false`.

The eight sidecar `emits` additions are held by review rather than a case (see Decisions): each entry matches the one its sibling on the same element already carries for that event name.

Coverage: no source file is added. `split.ts` loses one property and keeps every line and function it had, so the per-file bars in `packages/ui/bunfig.toml` (`lines = 0.99`, `functions = 1.0`) are unaffected and nothing ratchets. The manifest check is unaffected.

## Specs & docs

- **Spec edits:** steps 1 to 7, all in `specs/ui.md`. §3.2's marker goes from `Partial` to `Implemented`. The whole-spec header stays `**Status:** Partial`.
- **Fragment:** `bun run spec:change ui.md minor -m "§3.2 states the element contract the kit holds: an element takes its name as label, labelledby and describedby props and writes them on the node that carries its role; named slots come from one vocabulary with one meaning each; the events it dispatches bubble, are not composed and are declared in emits, jx-ready included; and no element is form-associated, by decision"`. The level is minor, for a reconcile. The only behaviour that changes is two events losing `composed`, which is observable only across a shadow root that no kit consumer has, and most sites never kept the promise. If the Open decision goes to `composed: true`, replace "are not composed" with "are composed" and keep minor.
- **Docs:** `docs/extending/ui-kit.md` is the only page into ui.md. Its `spec:` does not cite `ui.md#3.2`, but its `code:` lists `packages/ui/src/behaviors/split.ts`, so `docs:sync` names it.
  - Frontmatter: add `- ui.md#3.2 # the element contract` to `spec:`, after `ui.md#3.1`. The page teaches the consumer's half of the contract, and future §3.2 edits should flag it.
  - New section `## Names, events and slots` after `## Style a part`, three short paragraphs with no em dash. (1) Name an element with its `label`, `labelledby` and `describedby` props rather than `aria-label` and its siblings. The element writes the name onto the node that carries its role, which for most controls is the native control inside it, so an `aria-label` on the element itself names a box a screen reader does not announce. (2) An event an element sends bubbles, so one listener on a container hears every element inside it. It is not composed: inside a shadow root of your own, listen inside the root and send your own event from your host. (3) A slot name means the same thing wherever it appears: `icon` is a glyph before the words, `status` a mark that a click passes through to the item, `actions` a control whose click stops there. Each section below lists its element's slots. If the Open decision goes to `composed: true`, paragraph (2) says instead that the event crosses a shadow root of yours and is retargeted to its host.
  - The `:::doc-note` at line 199: "They are not form-associated yet, so a reset never reaches them" becomes "They are not form-associated, so a reset never reaches them".
  - The splitter section needs no edit, since it never mentions `composed`. `bun run docs:prose` covers the new paragraphs.
- **Graduation:** none. ui.md keeps open sections owned by other plans.

## Acceptance

- `bun run plans:status --spec ui` no longer lists `ui.md#3.2`, and `plans/ui/element-contract-text.md` is gone.
- `awk '/^### 3.2/,/^### 3.3/' specs/ui.md | grep -m1 Status` prints a line starting `> **Status: Implemented.**`.
- `grep -nE 'prefix`, `suffix|until form association|composed: true' specs/ui.md` prints nothing.
- `grep -n '"composed"' packages/ui/components/*.json` and `grep -nE '\bcomposed\s*:' packages/ui/src/behaviors/*.ts` print nothing.
- `grep -rn -iE 'form association lands|until the element is form-associated|form-associated yet' packages/ui docs/extending/ui-kit.md` prints nothing.
- From `packages/ui`: `bun test --isolate --coverage` passes, including the five new conformance cases, and so does `bun scripts/check-coverage-manifest.ts packages/ui` from the root.
- Mutation spot-check, by hand and reverted: add `"composed": true` back to `jx-option.json`, rename `jx-tab`'s `status` slot to `prefix`, or delete `jx-dialog`'s new `emits`. Each makes a named conformance case fail.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:standards`, `bun run docs:prose` and `bun run docs:markdown` pass. `ls specs/changes/` shows one new `ui` fragment at level minor.
