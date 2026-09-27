---
status: drafted
disposition: reconcile
claims:
  - ui.md#3.3
  - ui.md#7
requires: []
size: S
---

# §3.3 and §7 say what a behaviour sidecar is for, and §3.3 lists the jobs the kit's sidecars actually do

## Context

`specs/ui.md` §3.3, line 78:

> **Status: Partial.** The mechanism ships: `(state, event)` exports under `packages/ui/src/behaviors/`, preloaded under their `jx-ui:` specifiers by `KIT_MODULES` in `src/index.ts`, with `onMount` receiving `(state, host)`. The list of what the kit ships is stale in three places: no behaviour does label scrubbing (§5.5's `jx-dimension-field` row says it is promised nowhere), overflow measurement is the host's (§5.5, `jx-toolbar`), and tree drag and drop is a host island (§5.5, `jx-tree`).

`specs/ui.md` §7, line 380 (excerpt):

> **Status: Partial.** … Every keyboard pattern in this section now has an element behind it. One sentence says something the code does not: "Focus moves are the one thing a behaviour sidecar is for". Several sidecars also own keys that write a value or activate a control, arithmetic the closed operator set cannot express: `onSplitKeydown` in `src/behaviors/split.ts` (Home, End, Enter and the arrows), `number-field.ts` (Shift with an arrow steps by ten), `color-area.ts` (the cross-axis arrows), `tabs.ts` (Delete activates the close button) and `combobox.ts` (the list and commit keys).

Both are one statement made twice, what a sidecar is for, and in both the code is right. §5.5 gave away the three stale list items deliberately and says why. §3.2's "Declarative first" bullet already says a sidecar is "only for what the closed operator set cannot express", which covers clamped value arithmetic and activating another part from a key. So the disposition is `reconcile`.

**Verified at the audited tree, beyond the stub**

- The mechanism holds. The twenty modules in `packages/ui/src/behaviors/` and two outside it (`src/color.ts`, `src/icons.ts`) are preloaded by `KIT_MODULES` (`packages/ui/src/index.ts`), and the canvas answers the same specifiers lazily through `KIT_LOADERS` (`src/loaders.ts`). `tests/loaders.test.ts` holds the two tables to one key set. `onMount` is called with `(state, this)` at `packages/runtime/src/runtime.ts:4446`.
- The paragraph under the marker is stale in more places than the list:
  - **"pure".** Modules keep per-element state keyed by the host or scope: `drags` in `split.ts:149`, `clocks` in `toast.ts:75`, a `MutationObserver` per host in `tabs.ts`, `tree.ts`, `swatch-group.ts`, `toolbar.ts`, `action-group.ts`, `select.ts`, `listbox.ts`, `color-field.ts` and `toast.ts`, timers in `toast.ts` and `tooltip.ts`, and id counters (`let minted`) in `textfield.ts`, `combobox.ts`, `select.ts` and `color-field.ts`, plus `mintedHints` in `tooltip.ts` and `namedRows` in `textfield.ts`.
  - **"(state, event), except onMount".** There are three shapes. Event handlers bound to `on*` keys take `(state, event)`. Lifecycle hooks follow spec.md §16.4: `onMount` takes `(state, host)` and `onUnmount` (`jx-toast`, `jx-toast-host`, `jx-tooltip`) takes `(state)`. Callables with declared `parameters` are invoked positionally: `applySelection(scope)` on `jx-tabs`, `applySwatchSelection(scope)` on `jx-swatch-group`, `applyCurrent(scope)` on `jx-tree`, `eyeDropperAvailable(offered)` on `jx-color-field`, `inkOn(color)` from `src/color.ts` on `jx-swatch`, and `iconPath(name, weight)` from `src/icons.ts` on `jx-icon`. `tests/conformance.test.ts` ("no event handler declares parameters") is what keeps the third shape off an `on*` key.
  - **The list omits whole jobs.** It leaves out activation by `click()` (`menu.ts:259`, `tabs.ts:294`, `:304` and `:314`, `action-group.ts:236`, `swatch-group.ts:296`) and the overlay calls (`dialog.ts`, `popover.ts`, and the tooltip fallback in `tooltip.ts`). It also leaves out the toast clocks, the id stems (`mintFieldId`, `mintHintId`), the single writers of slotted children's declared props (`tabs.ts`, `listbox.ts`, `swatch-group.ts`, `tree.ts`, and `nameFieldControl` in `textfield.ts`, which writes `labelledby` and `describedby` on the control slotted into a `jx-field`), `jx-select`'s re-asserted `value`, native stepping (`number-field.ts:96`, `:98`), `jx-textfield`'s focus and selection on its own control (`selectValue`, `focusField`, and `clearField`, which empties the value, returns focus and dispatches `input` and `change` from the host), and the `input`/`change` every value-writing sidecar re-dispatches from the host because the platform fires neither for a script write.
  - **"Each is named in the catalogue entry of the element that uses it"** does not hold row by row. The `jx-action-group` row does not name its roving caret, and the `jx-color-slider` row does not name its `Shift` step. A catalogue row describes an element, and which module that element uses is the `$src` in its own document.
- Nothing in `packages/ui` or `packages/studio` scrubs a label. `toolbar.ts:19` says the toolbar "owns no overflow menu, and §5.5 says why", and `tree.ts` has no drag code. The §5.5 texts the list should defer to are the `jx-dimension-field` row ("Label scrubbing and arrow-stepping a unit value are promised nowhere") and the paragraphs "**Overflow is the host's, and Studio already has one answer to it.**" and "**Drag and drop is an island, and cut and paste are the element's actual obligation.**"
- §7's key owners are as the stub says: `split.ts:460`, `number-field.ts:118`, `color-area.ts:185`, `tabs.ts:297` and `combobox.ts:389`. Two more fit the same description:
  - `tree.ts:702` and `:711` report `activate` and `select` from the handler that owns the tree's caret.
  - `jx-textfield.json`'s Escape is the declarative form the sentence describes, a `$switch` on `event#/key` (tested in `tests/textfield.test.ts`, "Escape empties a clearable field and is cancelled; otherwise the key is nobody's").
- The rest of §7 holds. The swatch group roves too, but its roving list names only five widgets. The tree clause ("Every move a drag performs is also reachable without one…") is the element's half. The host's commands are studio-ui-guidelines.md §8.2, owned by `plan:studio-ui-guidelines/moves-without-dragging`.
- §2 principle 5 (line 29) states the same contract a third time, and it is also narrower than the code. Its allowed set has no `click()` and no write of a child's declared prop, although §5.1 sanctions the second ("a roving container … writes a declared prop"). It also has no selection call on the element's own inner control (`textfield.ts:38`, `:41`), no `blur()` (`toast-host.ts`), and no event dispatch, although sidecars dispatch from the host, on the element's own inner `<dialog>` (`dialog.ts:47`, the synthetic `toggle`) and on the kit children they coordinate (`toast-host.ts:138`, each `jx-toast`'s pause and resume). The census recorded principle 5 as holding. `plan:ui/principles-text` leaves line 29 to this plan and requires it for that reason.
- The one code citation of ui.md §7 is a comment in `packages/ui/tests/dialog.test.ts:205` about the overlay slot, and that slot is §6's. No text it quotes changes here; `plan:ui/overlay-transitions-and-slot` corrects it to §6.

## Outcome

- ui.md §3.3 → Implemented. It describes the three shapes a behaviour takes and the six kinds of work the kit's sidecars do, naming the elements that do each. It names label scrubbing, overflow measurement and tree drag and drop as not the kit's, each pointing to its §5.5 decision.
- ui.md §7 → Implemented. It states when a sidecar owns a key: a focus move, an activation, or a value write the operator set cannot compute. Everything else is a `$switch` on `event#/key`.
- Ride-along, which carries no claim: §2 principle 5's allowed set names `blur()`, `click()` on a designated control, a child kit element's declared props, the inner control's selection API, and event dispatch. §2's marker and claim stay with `plan:ui/principles-text`, which requires this plan for this edit.
- ui.md stays Partial (§2, §3.1, §3.2, §4.1, §5.1, §5.2, §5.4, §5.5 and §6 remain open), so nothing graduates.

## Decisions

- **Open:** does this plan amend §2 principle 5's allowed set, which is outside its claims? Recommendation: yes, as a ride-along. The new §3.3 and §7 text says sidecars `click()` a control, write a child's declared props and dispatch from the host, and principle 5 is the third statement of that contract. Leaving it would put two Implemented sections against a principle the census recorded as holding. The edit is one sentence on line 29, which `plan:ui/principles-text` does not touch (it edits principles 1 and 2 and the marker), and that plan already requires this one because its new marker credits principle 5 whole. The alternative moves step 6 unchanged into `plan:ui/principles-text`; that plan keeps its edge on this one either way, because the moved wording cites the §3.3 and §7 text written here.
- **Decided:** drop "pure". Sidecars keep per-element drags, clocks, observers and id counters. What keeps them safe is principle 5's write rule, which `conformance.test.ts` enforces by scanning each module for a markup write, not purity.
- **Decided:** §3.3 names the three shapes (handler, lifecycle hook, parameterised callable), because the conformance test already distinguishes them and a sidecar author has to know which one a binding gets.
- **Decided:** the list is organised by kind of work and names elements, not modules. §5 catalogues elements, and each document's `$src` already maps an element to its module, so a module list would be a third copy of the same mapping. "Each is named in the catalogue entry of the element that uses it" becomes a sentence that points to `$src` for the module and to §5 for what the element does. It does not ask every row to name its sidecar, and those rows live in sections other plans claim. §5's own preamble (line 146, an entry records "what lives in a sidecar") holds as written, because an entry is its row plus its section's prose, which is where both examples are named (the `jx-action-group` paragraph's roving `tabindex`, the `jx-color-slider` paragraph's `Shift`+Arrow).
- **Decided:** the three dropped jobs are named once as not the kit's, each with a pointer to its §5.5 decision, rather than removed silently. The old list promised them, so a reader looking for one should find the decision.
- **Decided:** §7 keeps its tree clause and gains a pointer to studio-ui-guidelines.md §8.2 for the host's half. §7 does not wait for `plan:studio-ui-guidelines/moves-without-dragging`. The clause states the element's obligation (every key it does not own reaches the host), and that obligation ships and is tested (`jx-tree.test.ts`).
- **Decided:** §3's own marker drops its enumeration "(§3.1, §3.2, §3.3)" and keeps "its own marker says so". This plan, `plan:ui/element-contract-text` and `plan:ui/surface-classes-to-parts` would otherwise each edit the same parenthetical.
- **Decided:** no test holds the list to the code. A test that parses spec prose would be a new gate for one paragraph. The module table it would check is held by `loaders.test.ts` (one key set with `KIT_LOADERS`) and, element by element, by each suite that registers the kit and drives its sidecar through the preloaded specifier. The plan stays paper and can land in its detailing pull request once signed off.

## Implementation

All edits are to `specs/ui.md`, in place. No numbered heading moves. Each new paragraph and bullet is one source line (the repository's unwrapped-Markdown rule). The executor may tighten the wording but must keep every fact and every element name.

1. **§3 marker (line 33).** Replace "Where a subsection's text and the code disagree, its own marker says so (§3.1, §3.2, §3.3)." with "Where a subsection's text and the code disagree, its own marker says so."
2. **§3.3 marker (line 78)** becomes:

   > **Status: Implemented.** `registerUi()` preloads every module in `KIT_MODULES` (`src/index.ts`) under its `jx-ui:` specifier, and each element's suite registers the kit and drives its sidecar through that specifier; the canvas answers the same specifiers lazily from `KIT_LOADERS` in `src/loaders.ts` (`tests/loaders.test.ts` holds the two tables to one key set). `onMount` receives `(state, host)` from `packages/runtime/src/runtime.ts`. `tests/conformance.test.ts` refuses a parameterised function bound to an `on*` key and scans every module under `src/behaviors/` for a markup write.

3. **§3.3 body (line 80)** is replaced by:

   > A behaviour is a function a kit document names with `$prototype: "Function"`, `$src` and `$export`. It is exported from a module under `packages/ui/src/behaviors/` and registered through `preloadModule` under the `$src` specifier the documents use (embedding.md §6). The canvas registers the same specifiers as loaders (§10). The binding decides which of three shapes a behaviour takes. Bound to an `on*` key, it is an event handler and receives `(state, event)`. As a lifecycle hook it receives what spec.md §16.4 gives: `onMount` gets `(state, host)`, because the element itself is what a sidecar most often needs, and `onUnmount` gets `(state)`. Declared with `parameters`, it is a callable that an expression or a `call` invokes with positional arguments, as `jx-tabs` invokes `applySelection(scope)`. That shape is never bound to an `on*` key. Two modules outside `behaviors/` are preloaded the same way for a callable of that shape: `src/color.ts` (`jx-swatch`'s ink) and `src/icons.ts` (`jx-icon`'s path data). A module may keep state per element, such as a drag, a clock or an observer, keyed by the element or its scope. It may not write the element's markup (§2 principle 5).
   >
   > A sidecar exists only for what the closed operator set cannot express (§3.2, "Declarative first"). The kit's sidecars do six kinds of work:
   >
   > - **Focus.** The roving caret (`jx-menu`, `jx-toolbar`, `jx-tabs`, `jx-tree`, `jx-action-group`, `jx-swatch-group`), typeahead (`jx-menu`, `jx-tree`), the active row a field's keys move through a list it does not contain (`jx-combobox` over `jx-listbox`), the key into a toast stack and back out (`jx-toast-host`), and focus and selection on `jx-textfield`'s own control, which its clear button returns focus to and a host reaches through `selectValue` and `focusField` (§5.1).
   > - **Activation.** A key that designates a control is answered by that control's own `click()`, so keyboard and pointer take one path. This covers a menu row or a tab on Enter or Space and a closable tab's close button on Delete. Where selection follows focus, it covers the tab, segment or swatch an arrow lands on (`jx-tabs` with automatic activation, `jx-action-group` with `selects="single"`, `jx-swatch-group`).
   > - **The platform's own calls.** An element's own `showModal()`, `close()`, `showPopover()` and `hidePopover()`, with the platform's `toggle` mirrored back into state (`jx-dialog`, `jx-popover`, `jx-menu`'s submenu stack, and the panels of `jx-combobox` and `jx-color-field`). The measured placement that is anchor positioning's fallback and the family's one clamp (§5.2, §6). The tooltip's binding on an engine without interest invokers, with its show delay and hide grace (`jx-tooltip`). The screen eyedropper (`jx-color-field`).
   > - **Value arithmetic and pointer maths.** `jx-split`'s drag, steps, ends and collapse toggle, against a track it measures. `jx-color-area`'s two axes and its cross-axis arrows. The `Shift` ten-step of `jx-number-field` (through its inner control's own `stepUp()` and `stepDown()`), `jx-color-slider` and `jx-color-area`. The colour maths of `src/color.ts`, which `jx-color-field`, `jx-color-area`, `jx-color-slider` and `jx-swatch` read.
   > - **Single writers.** The one place a slotted child's declared props are written: `selected` on each `jx-tab` (`jx-tabs`) and each `jx-option` (`jx-listbox`), `checked` on each `jx-swatch` (`jx-swatch-group`), `caret` on each `jx-tree-item` (`jx-tree`), `labelledby` and `describedby` on the control slotted into a `jx-field`, and the property-only `tabindex` a roving container writes on its members (§5.1). The same holds for `value` on `jx-select`'s own native control, re-asserted whenever its options change (§5.1).
   > - **Clocks and identity.** `jx-toast`'s timer and its named holds, `jx-toast-host`'s suspension of every clock in its stack (§5.2), and the id stems that wire a control to its label, help line, list or tooltip. A document cannot mint those because the operator set has no counter. They belong to `jx-textfield`, `jx-field`, `jx-combobox`, `jx-select`, `jx-color-field`, and to `jx-button`, `jx-action-button` and `jx-switch` through the tooltip module's `mintHintId`.
   >
   > Whichever kind, a sidecar that writes its element's value, as `jx-split`, `jx-number-field`'s steppers, the colour family, `jx-combobox`'s pick and `jx-textfield`'s clear button do, reports `input` and `change` from the host itself, because the platform fires neither for a script write (§3.2, Events).
   >
   > The `$src` in an element's own document says which module it uses. Its catalogue entry and section (§5) say what the element does with it.
   >
   > Three jobs this list once gave the kit are not the kit's, each by a decision §5.5 records. Label scrubbing is promised nowhere (the `jx-dimension-field` row). Overflow is the host's to measure ("Overflow is the host's"). Tree drag and drop is a host island ("Drag and drop is an island").

4. **§7 marker (line 380)** becomes:

   > **Status: Implemented.** Every pattern below has an element behind it. The menu, toolbar, tablist, tree, action group and swatch group each have a roving `tabindex`. The menu has typeahead and submenu keys, the tree has typeahead, and the splitter has keys. The listbox has its `aria-activedescendant`, the combobox its field keyboard (§5.3), and the toast stack its key (§5.2). The code is in `packages/ui/src/behaviors/`, with `menu.test.ts`, `toolbar.test.ts`, `tabs.test.ts`, `jx-tree.test.ts`, `action-group.test.ts`, `swatch-group.test.ts`, `split.test.ts`, `listbox.test.ts`, `combobox.test.ts` and `jx-toast-host.test.ts`. The keys a sidecar owns beyond focus are held by `tabs.test.ts` (Delete through the close button), `number-field.test.ts` (the `Shift` step is the control's own `stepUp`), `color-area.test.ts` (the cross-axis arrow), `split.test.ts` (Home, End and Enter) and `combobox.test.ts` (Enter commits the highlighted row). `textfield.test.ts` holds the declarative form (Escape).

5. **§7 body (line 382).**
   - "Composite widgets use a roving `tabindex` (menu, toolbar, tabs, tree, action group)" gains "swatch group".
   - The sentence "Focus moves are the one thing a behaviour sidecar is for; everything else about a key is a `$switch` on `event#/key`." is replaced by:

     > A behaviour sidecar owns a key only when answering it needs what the closed operator set cannot express (§3.3). That is one of three things. It may be a focus move. It may be an activation, answered through the designated control's own `click()` so the keyboard takes the pointer's path (a menu row on Enter, a closable tab's close button on Delete). Or it may be a value the document cannot compute: `jx-split`'s steps, ends and collapse toggle, the `Shift` step of `jx-number-field` and `jx-color-slider`, `jx-color-area`'s cross axis, or `jx-combobox`'s commit of the highlighted row. A composite whose keyboard is a sidecar for one of those reasons answers the rest of its keys in the same handler rather than splitting one key map across two, as `jx-tree`'s Enter and Space report `activate` and `select`. Everything else about a key is a `$switch` on `event#/key` in the document, as `jx-textfield`'s Escape is.

   - At the end of the tree clause "…reach the host untouched (§5.5)", append "; the commands themselves are the host's (studio-ui-guidelines.md §8.2)".
6. **§2 principle 5 (line 29), the ride-along (subject to the Open decision).** Replace the sentence "A behaviour sidecar may call `focus()`, measure, … and call a native form control's own value-stepping API on the element's own inner control." with:

   > A behaviour sidecar may call `focus()` and `blur()`, measure, call an element's own `showPopover()`, `hidePopover()`, `showModal()`, `close()`, `scrollIntoView()` and `setPointerCapture()`, call a native form control's own value-stepping and selection APIs on the element's own inner control, call `click()` on the control a key designates so the keyboard takes the pointer's path (§7), write a child kit element's declared props through the accessors it installs (§5.1), and dispatch an event on its own element, on a node inside it, or on a kit element it contains (`jx-toast-host` pausing its toasts' clocks, §5.2).

   The sentences after it ("A sidecar that writes attributes on another element is a defect." and the stepping rationale, which still reads as "the stepping clause") stay as written. §2's marker is not touched.

7. **Fragment**, as in Specs & docs.
8. **Plan housekeeping.** Delete this file in the landing pull request, and remove `ui/behaviour-list-text` from `plan:ui/principles-text`'s `requires`.

**Integration contract.** `plan:ui/principles-text` requires this plan. Once it lands:

- ui.md §3.3 defines a behaviour by its binding (handler, lifecycle hook, parameterised callable) and lists six kinds of sidecar work by element. A plan that adds a sidecar doing a new kind of work, or adds a kit element that uses an existing kind, adds it to the matching bullet in the same pull request. `plan:ui/menu-radio-rows` (a radio row is still activated by `click()`) and `plan:ui/jx-table` need no edit unless they add a sidecar.
- ui.md §7 says when a sidecar owns a key. `plan:ui/element-contract-text` can rely on §3.2's "Declarative first" bullet being consistent with it as written, so it need not edit that bullet for this reason.
- If the Open decision is taken, principle 5 names `blur()`, `click()`, declared-prop writes, the selection API and event dispatch, and `plan:ui/principles-text`'s marker rewrite may credit principle 5 whole to the conformance scan, which is what that plan's edge on this one waits for. If it is not, step 6 moves into that plan unchanged and the edge stays.

## Tests

No code changes, so no workspace suite runs for this plan, and no coverage threshold or manifest entry moves. The contract the new text cites is already under test in `packages/ui` (`bun test --isolate --coverage` from `packages/ui`, whose `bunfig.toml` thresholds are untouched):

- `tests/conformance.test.ts`: "no event handler declares parameters" (the third shape), and "behaviors/<name> writes no attribute, class, style or markup" (principle 5).
- `tests/loaders.test.ts` holds `KIT_LOADERS` to `KIT_MODULES`' key set, `tests/register.test.ts` holds `registerUi()`'s preloading, and the 36 suites that call `registerUi()` exercise each sidecar through its preloaded specifier.
- The key-ownership cases the §7 marker cites: `tabs.test.ts` "Delete closes a closable focused tab, through the pointer's own path", `number-field.test.ts` "a Shift-step is the control's own stepUp, never arithmetic of ours", `color-area.test.ts` "the CROSS-axis arrow is the kit's, because a range knows only one dimension", `split.test.ts` "Home and End go to the ends of the LEGAL range, gap included" and "Enter collapses to the floor and the next one restores where it was", `combobox.test.ts` "Enter on a highlighted row takes it, once", `menu.test.ts` "Enter, Space and a click select the row; a disabled row selects nothing", `action-group.test.ts` "in selects=single an arrow CLICKS the child it lands on, so the host hears the key", and `textfield.test.ts` "Escape empties a clearable field and is cancelled; otherwise the key is nobody's".

The proof is the paper gates in `checks`: `docs:status` (marker forms), `docs:spec-release` (the fragment), `plans:check` (both claims closed, plan deleted), `docs:check`, `docs:links` (every `§` and spec link resolves), `docs:standards` (the WAI-ARIA and WCAG 2.2 rows bind §7, and their tiers are re-derived) and `docs:markdown`.

## Specs & docs

- **Spec edits:** steps 1 to 6 above, all in `specs/ui.md`. The §3.3 and §7 markers change from `Partial` to `Implemented` with the evidence quoted there. The whole-spec header stays `**Status:** Partial`.
- **Fragment:** `bun run spec:change ui.md minor -m "§3.3 describes the three shapes a behaviour takes and the six kinds of work the kit's sidecars do, naming label scrubbing, overflow measurement and tree drag and drop as the host's or promised nowhere per §5.5; §7 says a sidecar also owns a key that activates a control through its own click or writes a value the operator set cannot compute; §2 principle 5's allowed set adds blur, click, child prop writes, the inner control's selection and event dispatch"`. The level is minor: a reconcile that changes no behaviour and adds to the allowed set. If the Open decision goes the other way, drop the clause after the last semicolon, and the plan that carries step 6 names it in its own fragment.
- **Docs:** none change. No page's `spec:` cites `ui.md#2`, `#3`, `#3.3` or `#7` (the only page into ui.md, `docs/extending/ui-kit.md`, cites §1, §3.1, §4, §5 to §5.6, §8 and §9). Its `code:` lists the behaviour modules, but no module changes. The page describes each element's keyboard, which is unchanged, and never mentions label scrubbing, a sidecar, or an overflow measurement the kit owns. Its toolbar section already says "There is no overflow menu, by decision". `bun run docs:sync` should report nothing, and the pull request says so. `plan:ui/principles-text` requires this plan, so it cannot land first; when it lands it adds `ui.md#2` to the page's `spec:`, and since the page says nothing about the sidecar allowed set, that plan needs no edit there for principle 5 either.
- **Graduation:** none. ui.md keeps nine open sections owned by other plans.

## Acceptance

- `bun run plans:status --spec ui` lists neither `ui.md#3.3` nor `ui.md#7`, and `plans/ui/behaviour-list-text.md` is gone.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:standards` and `bun run docs:markdown` pass.
- `grep -c "Focus moves are the one thing" specs/ui.md` prints `0`. `grep -c "behaviour is a pure" specs/ui.md` prints `0`. `grep -c "label scrubbing" specs/ui.md` prints `0` (case-sensitive: the old list and the old marker are gone), and `grep -c "Label scrubbing" specs/ui.md` prints `2`, the §5.5 `jx-dimension-field` row and §3.3's disclaimer.
- `awk '/^### 3.3/,/^### 3.4/' specs/ui.md | grep -m1 Status` and `awk '/^## 7\./,/^## 8\./' specs/ui.md | grep -m1 Status` both print a line starting `> **Status: Implemented.**`.
- `ls specs/changes/` shows one new `ui` fragment at level minor.
- Review by reading: every element named in §3.3's six bullets has a document whose `$src` names a module that does that work (`grep -l '"\$src"' packages/ui/components/*.json`), and no exported function bound by a kit document does work outside the six bullets and the value-reporting sentence under them.
