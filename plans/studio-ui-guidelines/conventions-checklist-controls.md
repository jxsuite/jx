---
status: drafted
disposition: implement
claims: []
workspaces:
  - packages/studio
  - docs
size: L
---

# Every Studio control has one accessible name, says whether its popup is open and why it is disabled, and every emitted class has a rule

## Context

`specs/studio-ui-guidelines.md` §10 (line 669) is Partial for five items that inherit other sections' open items. Detailing `plan:studio-ui-guidelines/conventions-checklist` verified the other twenty against the code and found four more false. Each is a rule that no numbered section except §10 states, so no section owner will fix it; §14's Accessible Name row (**Adopted**, binding §10) rests on the first. This plan fixes the four, closes one hole in the focus-ring gate, and holds them mechanically. It claims nothing: §10 keeps one owner, which requires this plan.

Paths are under `packages/studio/`. Counts come from a walk of every `src/surfaces/*.json` at the tree of 2026-09-27.

**One accessible name.** §10: "A control carries ONE accessible name. `title` and `aria-label` with the same string make screen readers announce it twice". Eight nodes set both to one expression:

- chip `button`s: `doc-header.json` and `panel-page.json` (`clearLabel`), `properties-panel.json` and `style-panel.json` (`chipTitle`; the Style tab's also prints `chipText`);
- in `style-panel.json`, the section clear `button[part="dot"]` (`clearTitle`) and `span[part="dots"]` (`tally`), whose `aria-label` also sits on a role-less `span`, a name ARIA 1.2 prohibits on the generic role;
- `jump-bar.json`'s `button[part="alternatives"]` (`altsLabel`), which prints the glyph ⌄ as its text;
- `panel-i18n.json`'s `button[part="cell-button"]`, whose one string comes from `cellTitle` in `panels/i18n-panel.ts` and ends "— requires …" when refused, so the name carries the refusal too.

No lit template or imperative write in `src/**/*.ts` does it. The kit's `label` and `hint` on `jx-action-button` (73 controls where they match) are a name and a `jx-tooltip` description by `ui.md` §5.1's contract, not two names. `plan:studio-ui-guidelines/form-row-part-vocabulary` (step 5) copies the Style tab's `[part="dots"]`, duplicate included, into `properties-panel.json`.

**A live `aria-expanded`.** §10: a control that opens a menu "carries `aria-haspopup="menu"` and a live `aria-expanded`". Of 27 openers with `haspopup` or `aria-haspopup` (any value), five bind their state: the Command Bar's ⬢ (`menuOpen`), the rail's gear (`settingsOpen`) and the block bar's ⋮ (`overflowOpen`), each set by hand beside `openMenu` and cleared in `onClosed`, and the pane context bar's two dialog triggers (`resolvingOpen`, `contextOpen`). Twenty-two, in sixteen documents, do not: `ai-chat.json` composer-attach; `block-action-bar.json` insert-data and tag (both open the slash menu, not `openMenu`); `expression-editor.json` catalog (`"dialog"`); `git-panel.json` commit-menu; `grid-panel.json` views (`"dialog"`, the grid's own view popover); `jump-bar.json` alternatives (native); `library-pane.json` new; `logic-panel.json` source ×2, event-name and event-source; `logic-workspace.json` catalog; `pane-context.json` preset; `panel-outline.json` overflow; `schema-form.json` source; `seo.json` browse; `statements.json` add-statement; `style-panel.json` source and group-open ×2; `target-line.json` segment (native). A kit opener without `expanded` is worse than none: `jx-action-button` writes `aria-expanded="false"` whenever `haspopup` is set, so it reports closed while its menu is open, and that explicit attribute outranks anything `showPopover({ source })` in `openMenu` could imply. The logic workspace's catalog opens `openFormulaPalette` (`surfaces/formula-palette.ts`), a searchable panel rather than a menu, so its `haspopup: "menu"` is wrong as well; the expression editor opens the same palette and already says `"dialog"`, though the palette's `[part="panel"]` carries no role to match. `menu.json`'s `jx-menu-item` also declares `haspopup` (a submenu), and needs nothing: the kit's menu behaviour writes its `expanded` (`packages/ui/src/behaviors/menu.ts`).

**The reason on a disabled control.** §10: "A control that cannot act renders **disabled with the reason in its tooltip**, never absent". 68 controls bind `disabled`. 28 carry no hint or title at all and 13 carry a hint equal to their label; with the Source Control discard button's "Discard changes" (the name again), 43 give no reason:

- a precondition: `diff-toolbar.json` previous and next; `grid-panel.json` save, previous and next page, refresh; `data-actions.json` test; `logic-panel.json` source ×2 and set ×2, icon buttons with no hint even while enabled; `properties-panel.json` source; `ai-chat.json` composer-send; `git-panel.json` discard ×2; `panel-i18n.json` settings;
- an operation running (`busy`, `modelsLoading`, `browsing`): `publish.json` ×7, `git-panel.json` ×9, `settings-packages.json` ×5, `cf-account-picker.json`, `ai-managed-connect.json`, `ai-credentials-form.json`, `new-project.json`, `add-repo.json`;
- `panel-signals.json`'s refresh, a literal `disabled: true` beside `loading: true`;
- `empty-state.json`'s `[part="empty-action"]`, which is §11.2's reason field and `plan:studio-ui-guidelines/empty-state-copy`'s.

Seven more disabled controls have no tooltip channel at all, because the kit's fields take no `hint`: four `jx-select`s (`grid-views.json` sort-dir, `reference-field.json` picker, `settings-locales.json` default and routing) and two `jx-textfield`s (`secret-field.json` field, `settings-packages.json` add-field) carry a `help` line instead, and the palette's `jx-option` prints `registry.disabledReason` as its `description` (`panels/quick-search.ts`), which already holds.

Surfaces that already do it show the shape: `settings-extensions.json` (`removeHint`, `blockedReason`), `block-action-bar.json` (`parentHint`, `tagHint`), and every command surface (`requires`).

**A rule for every emitted class.** §10: "Every class emitted from TypeScript has a rule in `styles/*.css` — no `style=` attribute doing a stylesheet's job". Six classes are `ALLOWED_ORPHANS` in `scripts/check-styles.ts`, whose header calls the list "a shrinking backlog" and the fix "real CSS": `jx-canvas-iframe` (`canvas/iframe-host.ts`), `jx-canvas-iframe-overlay`, `overlay-presence-group`, `overlay-presence` and `overlay-presence-tag` (`canvas/iframe-overlay.ts`), and `jx-drag-ghost` (`panels/drag-ghost.ts`). Each draws its static look from an inline `cssText`.

**The focus ring in documents.** `scripts/check-styles.ts`'s `checkFocusRings` pairs every `outline: none` in a stylesheet with its `:focus-visible` restore (`FOCUS_RING_ALLOWANCES`), and its scope stops at stylesheets. Three documents suppress the ring (`slash-menu.json`'s filter, `palette.json`'s and `formula-palette.json`'s input). Each restores it in a nested `:focus-visible` today, and nothing would notice a fourth that did not, while every new surface is a document (§9.3).

## Outcome

- Every surface document meets §10's one-name, live-`aria-expanded` and disabled-reason items, and `tests/control-semantics.test.ts` fails on a regression of each, both ways: a new finding, or an allowance whose site is fixed.
- `ALLOWED_ORPHANS` is empty, so §10's emitted-class item holds without a backlog.
- `check-styles.ts` holds a document's `outline: none` to a `:focus-visible` restore beside it.
- No spec text changes here. `plan:studio-ui-guidelines/conventions-checklist` rewrites §10 to cite the sweep and removes its marker.

## Decisions

- **Decided:** one sweep, `tests/control-semantics.test.ts`, walks `src/surfaces/*.json` with one rule per item and a both-ways allowance map per rule, in the shape of `NOT_YET_CONVERTED` in `tests/run-reported.test.ts`. A test needs no CI wiring, and a document is where every new control goes (§9.3). Lit templates are out of its reach and bounded by `LIT_TEMPLATE_AUTHORS` in `scripts/check-lit-conventions.ts`; each slice's landing greps them.
- **Decided:** for one name, keep `title` and drop the `aria-label` that repeats it. Accessible-name computation names a control with no text content from its `title` (the tooltip step) in every engine, and `title` is the only pointer tooltip a native button has; keeping `aria-label` instead would strip the tooltip from a 6px chip. A glyph the control prints moves into an `aria-hidden` span so the title stays the name, as the tab strip's overflow button already does (`trailingTitle`, `panels/tab-strip.ts`). A chip that prints words (`chipText`) is named by them, which is what WCAG 2.5.3 asks. Where the tooltip must say more than the name (the i18n cell's refusal), `aria-label` carries the name and `title` the longer sentence, so the two differ. The tally `span` becomes `role="img"` named by its `title`.
- **Decided:** a popup's open state reaches its opener through the function that opens it. `OpenMenuOptions` gains `expanded?: (open: boolean) => void`, called with `true` once the popover is shown and with `false` from `finish()` however the menu closed; `FormulaPaletteOpts` gains the same. Each opener binds `expanded` (kit) or `aria-expanded` (native, `"true"`/`"false"`) to a boolean its adapter projects, a row field for an opener inside a `$map`. A surface may not write another surface's DOM (`ui.md` §2 rule 5), and the three openers that already track the state each pair a hand-set flag with `onClosed`; the callback makes that one line, and the three move onto it.
- **Decided:** the popup rule reads every `haspopup` value, not only `"menu"`, because `aria-expanded` belongs to every popup kind. It skips `jx-menu-item`, whose `expanded` the kit writes. Both catalog openers declare `"dialog"`, and the formula palette's `[part="panel"]` gains `role="dialog"` and an `aria-label`, so the value names what opens.
- **Open:** does every disabled control carry a reason, busy and boundary states included? Recommendation: yes, uniformly, and a control waiting on its own activation uses the kit's `loading` (which swallows the click and says `aria-busy`) instead of `disabled`. Exempting "an operation is running" and "at the first or last item" needs a judgement per control that the sweep cannot make, so it would become an allowance list reviewed by eye. The cost is one sentence per surface: the other controls read "Wait for … to finish" from one `busyReason` field the adapter writes where it sets `busy`, and an end-of-list control says "This is the first change" or "This is the last page". If declined, `plan:studio-ui-guidelines/conventions-checklist` scopes §10's item to preconditions, the busy and boundary controls enter `DISABLED_ALLOWANCES` with that reason, and CCO2.3 shrinks to the precondition group.
- **Decided:** a kit control's reason is its `hint`, bound to the reason while disabled and to the label (or nothing, for a button that prints its label) while enabled, because the kit draws `hint` as the control's `title` exactly while it is disabled (`ui.md` §5.1). A native `button` carries it in `title`; `jx-menu-item`'s is `requires`; a `jx-option`'s is its `description`. A kit field (`jx-select`, `jx-textfield`) has no tooltip, so its reason is its `help` line while disabled, the one channel the kit gives it (`describedby`).
- **Decided:** the six orphans get rules in `styles/canvas.css`, beside `.overlay-box` and `.overlay-coselection-group`, and only per-instance values stay inline (the iframe's `min-height`, which the host rewrites; a presence box's geometry and colour; the ghost's `left`, `top` and `display`). That is the fix `check-styles.ts`'s own header prescribes, and §10 cannot read Implemented over a backlog any more than §12.4 can over `NOT_YET_CONVERTED`.
- **Decided:** the allowance maps start empty except `empty-state.json#empty-action` in `DISABLED_ALLOWANCES`, reason "§11.2: EmptyStateAction has no reason field", which `plan:studio-ui-guidelines/empty-state-copy` deletes when it adds one (or which is never written, if that plan lands first). The i18n panel's settings button gets a reason here only if `plan:studio-ui-guidelines/empty-state-copy` has not landed: that plan draws it from `settings.open`'s record (`commandEmptyAction`), absent while the record is unregistered and disabled with the record's `requires` otherwise, which is the answer §12.3 wants.
- **Decided:** the document focus-ring rule has no allowance list. A document can always carry its restore beside the suppression, as all three that suppress already do.

## Implementation

Paths under `packages/studio/`. New comments cite `studio-ui-guidelines.md §10` qualified, because a bare § in this package means `studio.md` (`bun run docs:section-refs`).

**CCO2.1: one name, and focus rings in documents**

1. Chips: delete `aria-label` from the chip `button` in `src/surfaces/doc-header.json`, `panel-page.json`, `properties-panel.json` and `style-panel.json`, keeping `title`. In `style-panel.json`, delete it from `button[part="dot"]` (the section clear) too, and on `span[part="dots"]` replace it with `"role": "img"`.
2. `src/surfaces/jump-bar.json`: `button[part="alternatives"]` drops `aria-label` and `textContent`, and gains a child `span` with `"aria-hidden": "true"` printing ⌄.
3. `src/panels/i18n-panel.ts`: split `cellTitle` into `cellName(cell, locale)` (today's `said`) and `cellTitle`, which appends "— requires …" to it when refused. The cell projection gains `name`; `src/surfaces/panel-i18n.ts`'s row type gains `name: string`; `panel-i18n.json`'s `cell-button` binds `aria-label` to `${$map.item.name}`.
4. New `tests/control-semantics.test.ts` (no DOM). A walker yields every node of each document with its path, skipping `$description` values. Rule `oneName`: no node whose `attributes.title` and `attributes["aria-label"]` are the same JSON value, and no `aria-label` on a `div` or `span` without a `role`. A finding is `<file>#<part>` (`<file>#<tagName>` when the node has no part). `NAME_ALLOWANCES` is empty. The file's header states the three rules and cites `studio-ui-guidelines.md §10` and the accname row of §14.
5. `scripts/check-styles.ts`: add `export function checkJsonFocusRings(rel: string, source: string): Finding[]`. Parse the document and walk every object under its `style` keys, recursively. An object that declares `outline` as `none` or `0` must own a `:focus-visible` key (or `&:focus-visible`) whose object declares an `outline` that is neither. The finding carries the line of the suppressing key, found in `source` the way `jsonStyleBlocks` finds a block. In `collect()`, call it beside `scanJsonStyle` in the `src/surfaces/**/*.json` loop and report its findings as errors. The header's focus-ring paragraph gains one sentence: a document is held too, and needs no allowance because its restore sits beside the suppression.

**CCO2.2: a popup says whether it is open**

1. `src/surfaces/menu.ts`: `OpenMenuOptions.expanded?: (open: boolean) => void`, documented as the opener's `aria-expanded`. `openMenu` calls `options.expanded?.(true)` after `menu.showPopover(...)` and `options.expanded?.(false)` in `finish()` before `onClosed`. A menu closed before it was shown reports only `false`.
2. `src/surfaces/formula-palette.ts`: `FormulaPaletteOpts.expanded?`, called with `true` when the panel shows and `false` on every close path (`closeFormulaPalette`, a pick, light dismissal).
3. The three existing openers move onto the callback: `src/surfaces/commandbar.ts` (`menuOpen`), `src/panels/settings-menu.ts` with `src/surfaces/rail.ts` (`settingsOpen`), `src/panels/block-action-bar.ts` (`overflowOpen`). Their `onClosed` keeps whatever else it does.
4. The twenty-two. Each adapter passes `expanded` and projects the flag, and the document binds it. Adapter, then document and part:
   - `src/panels/ai-chat/composer.ts`: `ai-chat.json` composer-attach.
   - `src/panels/block-action-bar.ts`: `block-action-bar.json` insert-data (`openMergeTagMenu`) and tag (`openConvertMenu`). Both call `showSlashMenu` (`src/editor/slash-menu.ts`), not `openMenu`, so the adapter sets its flag when it calls it and clears it in the `onDismiss` callback, which already fires on every close.
   - `src/ui/expression-editor.ts` (`browse`, through `openFormulaPalette`): `expression-editor.json` catalog (row field).
   - `src/panels/git-panel.ts`: `git-panel.json` commit-menu.
   - `src/grid/grid-panel.ts` (`openViewPopover`): `grid-panel.json` views, projected from the panel's own `views` handle (`isOpen()`), set where the popover opens and cleared on every close path it already has.
   - `src/panels/jump-bar.ts`: `jump-bar.json` alternatives (native `aria-expanded`, row field).
   - `src/browse/library-pane.ts`: `library-pane.json` new.
   - `src/panels/events-panel.ts`: `logic-panel.json` source ×2, event-name, event-source (row fields).
   - `src/panels/formula-workspace.ts` (`browseCatalog`): `logic-workspace.json` catalog, whose `haspopup` becomes the palette root's role.
   - `src/panels/pane-context.ts`: `pane-context.json` preset.
   - `src/panels/layers-panel.ts` (`overflowRow`): `panel-outline.json` overflow (row field). It opens through `showCommandOverflow` in `src/panels/block-action-bar.ts`, which gains an `expanded` parameter forwarded to `openMenu`; the block bar passes its own `overflowOpen` setter (step 3), so the Outline's menu no longer touches the block bar's flag.
   - `src/ui/schema-form.ts`: `schema-form.json` source (row field).
   - `src/panels/seo-modal.ts`: `seo.json` browse.
   - `src/panels/statement-editor.ts`: `statements.json` add-statement.
   - `src/panels/style-panel.ts`: `style-panel.json` source (row field) and group-open ×2.
   - `src/surfaces/target-line.ts`: `target-line.json` segment (native `aria-expanded`, row field).
5. `src/surfaces/logic-workspace.json` catalog: `haspopup` becomes `"dialog"`. `src/surfaces/formula-palette.json` `[part="panel"]`: `"role": "dialog"` and an `aria-label` bound to the palette's title.
6. `tests/control-semantics.test.ts`, rule `livePopup`: a node other than `jx-menu-item` with `$props.haspopup` binds `$props.expanded`, and one with `attributes["aria-haspopup"]` binds `attributes["aria-expanded"]`; an absent or literal value is a finding. `POPUP_ALLOWANCES` is empty.

**CCO2.3: a disabled control says why** (as the Open recommends)

1. `tests/control-semantics.test.ts`, rule `disabledReason`: a `jx-button`, `jx-action-button` or `jx-switch` whose `disabled` is present and not literal `false` binds a `hint` whose JSON value differs from its `label`'s; a `jx-menu-item` binds `requires`; a `jx-option` binds `description`; a `jx-select`, `jx-textfield` or `jx-combobox` binds `help`; a native `button` binds `title`. `DISABLED_ALLOWANCES` is `{ "empty-state.json#empty-action": "§11.2: EmptyStateAction has no reason field" }` unless `plan:studio-ui-guidelines/empty-state-copy` has landed.
2. Busy surfaces: `publish.json` (`publish/publish-panel.ts`), `git-panel.json` (`panels/git-panel.ts`), `settings-packages.json` (`settings/dependencies-editor.ts`), `cf-account-picker.json`, `ai-managed-connect.json`, `ai-credentials-form.json`, `new-project.json` (`new-project/new-project-modal.ts`) and `add-repo.json`. Where an adapter sets its busy flag it also writes `busyReason`, "Wait for … to finish", naming the running operation (in `gitPanelValues()`, reuse the field if `plan:studio-ui-guidelines/empty-state-copy` has added it). `settings-packages.json`'s add-field binds `help` to it. The control that started the operation binds `loading` instead of `disabled`; every other control binds `hint` to `busyReason` while disabled. An action button whose hint is its label today (Source Control's refresh, fetch, pull and push; the package row's update and remove) binds `busy ? busyReason : label`. A Source Control control that `plan:studio-ui-guidelines/git-panel-action-list` has already drawn from its record keeps the record's `requires` for a refusal and takes `busyReason` only while busy.
3. Precondition controls, each sentence computed where its flag is:
   - `src/surfaces/diff-toolbar.ts`: "This is the first change" / "This is the last change".
   - `src/grid/grid-panel.ts`: save "No edits to save", and `loading` while saving; previous and next page "This is the first page" / "This is the last page"; refresh, the cause `refreshDisabled` records.
   - `src/panels/data-grid.ts`: test "Select a connection to test it", and `loading` while its own test runs.
   - `src/panels/events-panel.ts`: source "Only … can supply this field", naming the one offered mode; set "Nothing is set here to clear". Both icon buttons also gain their label as `hint` while enabled.
   - `src/panels/properties-panel.ts` (a row's `sourceLocked`): the source sentence above.
   - The composer (`src/panels/ai-chat/composer.ts`): the cause `sendDisabled` has (nothing typed, no provider connected, a reply still running).
   - `src/panels/git-panel.ts` discard: "An untracked file has no committed version to go back to".
   - `src/panels/i18n-panel.ts` settings: the sentence for why `settings.open` is not registered in this window. Skipped once `plan:studio-ui-guidelines/empty-state-copy` has landed (Decisions).
   - `src/surfaces/panel-signals.json` refresh: drop `disabled: true`; `loading` already swallows the click.
   - Fields, through `help` while disabled: the grid view's sort direction (`sortDirDisabled` in `src/grid/grid-panel.ts`: "Choose a column to sort by"), `settings-locales.json`'s two pickers ("Add a language first", from the empty case `src/surfaces/settings-locales.ts` already names), and the reference and secret fields, each with the sentence its adapter's `disabled` stands for (`src/surfaces/reference-field.ts`, `src/surfaces/secret-field.ts`).

**CCO2.4: every emitted class has a rule**

1. `styles/canvas.css`: `.jx-canvas-iframe` (`width: 100%; height: 100%; border: 0; display: block; background: #fff`), `.jx-canvas-iframe-overlay` (`position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 2`), `.overlay-presence-group { display: contents }` with the comment `.overlay-coselection-group` carries, `.overlay-presence` (`display: block; outline-offset: 1px; outline-width: 1.5px; outline-style: solid`), `.overlay-presence-tag` (its position, padding, radius, font, colour and `white-space`, moved verbatim), and `.jx-drag-ghost` (every declaration but `left`, `top` and `display`). `#fff` is already in `ALLOWED_HEX`.
2. `src/canvas/iframe-host.ts`, `src/canvas/iframe-overlay.ts` and `src/panels/drag-ghost.ts`: delete the moved declarations from each `cssText`. The iframe keeps its `min-height` writes, a presence box its `left`/`top`/`width`/`height` and `outline-color`, a tag its `background`, the ghost its `left`/`top`/`display`.
3. `scripts/check-styles.ts`: `ALLOWED_ORPHANS` becomes an empty set, keeping its doc comment and the both-ways check.

**Integration contract.** Once CCO2.1 lands, no surface document carries a `title` and an `aria-label` with one value, no role-less `div` or `span` carries an `aria-label`, and `tests/control-semantics.test.ts` refuses both, so `plan:studio-ui-guidelines/form-row-part-vocabulary` gives the Content tab's `[part="dots"]` the Style tab's fixed shape (`role="img"`, `title` only); `check-styles.ts` exports `checkJsonFocusRings`, and `collect()` fails a document's unpaired `outline: none`. Once CCO2.2 lands, `openMenu` and `openFormulaPalette` take `expanded`, and an opener that does not bind it fails the sweep; `plan:studio-ui-guidelines/unrendered-placements` and `plan:studio-ui-guidelines/git-panel-action-list` keep the binding when they redraw the pane and commit menus. Once CCO2.3 lands, every disabled control in a document names its reason, the only allowance left is §11.2's (which `plan:studio-ui-guidelines/empty-state-copy` deletes), and `plan:studio-ui-guidelines/conventions-checklist` may cite `packages/studio/tests/control-semantics.test.ts` for §10's items on one name, a popup's state and a disabled control's reason. Once CCO2.4 lands, `ALLOWED_ORPHANS` is empty and the presence tag's face lives in `styles/canvas.css`, where `plan:studio-ui-guidelines/font-stacks` edits it if it lands second.

## Tests

`cd packages/studio && bun test --isolate --coverage`. `bunfig.toml` gates `lines = 0.958, functions = 0.941` per file. No `src` file is added (the sweep is a test), so `bun scripts/check-coverage-manifest.ts packages/studio` sees nothing new; `checkJsonFocusRings`, the two `expanded` options and every new reason branch are covered below. Ratchet `coverageThreshold` only if the workspace's worst file rises.

- CCO2.1
  - `tests/control-semantics.test.ts`: "every document gives a control one accessible name" (the sweep); "the name allowances list only live findings"; two cases over inline fixture documents: a duplicate `title`/`aria-label` is reported as `<file>#<part>`, and a labelled role-less `span` is reported.
  - `tests/style-panel.test.ts`: line 335's chip assertion (`aria-label` containing "clear display") reads `title`; new "the section tally is an image named by its sentence".
  - `tests/i18n-panel.test.ts`: new "a refused cell is named by its action and titled with the refusal" (`aria-label` "Create …", `title` ending "— requires …").
  - `tests/jump-bar.test.ts`: new "the alternatives button is named by its title and hides its glyph".
  - `tests/check-styles-orphans.test.ts`, `checkJsonFocusRings`: a suppression with a nested `:focus-visible` outline passes; one without fails at the suppression's line; a restore that itself says `none` fails; `outline: 0` counts as a suppression; the three live documents pass.
- CCO2.2
  - `tests/surfaces-menu.test.ts`: "expanded hears true once the menu shows and false however it closes" (a select, Escape, `close()`, and a second menu opened over the same region); "a menu closed before it showed reports only false"; "no callback, no error".
  - `tests/formula-palette.test.ts` (the file that exercises `openFormulaPalette`): "expanded hears true when the panel shows and false on every close path". `tests/formula-workspace.test.ts`: "the catalog opener reports the palette open, then closed after a pick".
  - `tests/block-action-bar.test.ts`: "the insert-data button reports the merge-tag menu open, then closed on dismiss" (the slash-menu shape).
  - `tests/control-semantics.test.ts`: "every popup opener binds its open state".
  - Behaviour, one per shape: `tests/style-panel.test.ts` "a row's source button reports its menu open and then closed" (kit, mapped row); `tests/jump-bar.test.ts` "the alternatives button's aria-expanded follows its menu" (native). `tests/commandbar.test.ts`, `tests/settings-menu.test.ts` and `tests/block-action-bar.test.ts` keep their open-state assertions green through the callback.
- CCO2.3
  - `tests/control-semantics.test.ts`: "every disabled control says why"; "the disabled allowances list only live findings".
  - One case per adapter that computes a sentence, asserting the disabled control's `hint` (or `title`) is the sentence and, for a busy surface, that the control which started the operation is `loading` and not `disabled`: `tests/diff-toolbar.test.ts`, `tests/grid-panel.test.ts`, `tests/data-grid.test.ts`, `tests/events-panel.test.ts`, `tests/properties-panel.test.ts`, `tests/ai-chat-composer.test.ts`, `tests/git-panel-states.test.ts` (busy and discard), `tests/publish-panel.test.ts`, `tests/dependencies-editor.test.ts`, `tests/cf-account-picker.test.ts`, `tests/ai-managed-connect.test.ts`, `tests/ai-credentials-form.test.ts`, `tests/new-project-modal.test.ts`, `tests/add-repo-modal.test.ts`, `tests/i18n-panel.test.ts`, and for the fields' `help`, `tests/locales-section.test.ts`, `tests/reference-control.test.ts` and `tests/form-controls.test.ts` (the secret field).
  - `tests/signals-panel.test.ts`: the refreshing button is `loading` and not `disabled`.
- CCO2.4
  - `tests/drag-ghost.test.ts` (line 25 and 26) and `tests/iframe-overlay.test.ts` (lines 79 and 89) stop reading `position` and `pointer-events` off the inline style, and read the `.jx-drag-ghost` and `.jx-canvas-iframe-overlay` rules from `styles/canvas.css` instead; the inline `left`/`top`/`display` and `min-height` assertions stand.
  - `tests/check-styles-orphans.test.ts`: `collect()` over the package reports no orphan with `ALLOWED_ORPHANS` empty.
- Every slice touches `src/surfaces/**`, so the screenshot lane re-captures. Nothing should move visibly except a hidden-glyph wrapper and a spinner where a busy button used to grey out.

## Specs & docs

No spec edit and no fragment: the three rules are §10's text already, and `plan:studio-ui-guidelines/conventions-checklist` rewrites that section and its marker.

Docs (no em dashes). `bun run docs:sync` names the pages whose `code:` lists a changed adapter, among them `docs/studio/publish/source-control.md`, `docs/studio/editing/grid.md`, `docs/studio/design/style-inspector.md`, `docs/studio/interface/languages.md` and `docs/studio/publish.md`. One states something this plan changes:

- `docs/studio/publish/source-control.md`, line 35: "An untracked file has nothing to go back to, so its undo icon is disabled rather than offering to throw the file away." gains ", and its tooltip says so" before the full stop.

The rest describe no name, popup state or disabled reason these slices change.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun --cwd packages/studio scripts/check-styles.ts`, `scripts/check-surface-purity.ts` and `scripts/check-lit-conventions.ts` pass.
- `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass.
- The three allowance maps in `tests/control-semantics.test.ts` are empty, apart from §11.2's entry while `plan:studio-ui-guidelines/empty-state-copy` is open, and `ALLOWED_ORPHANS` in `scripts/check-styles.ts` is empty.
- `git grep -nE 'aria-label=|title=' packages/studio/src -- '*.ts'` shows no lit template giving one control both with one value.
- In a dev Studio (`packages/studio:verify`): open a Style row's source menu and read `aria-expanded="true"` on its button in the Accessibility pane, press Escape and read `false`; hover the diff toolbar's Previous at the first change and read "This is the first change"; start a fetch in Source Control and hover Push to read its wait sentence; the Style tab's section tally reads as one image named by its sentence.

## Slices

| Slice  | Scope                                                                                                                  | Claims | State |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | ------ | ----- |
| CCO2.1 | One name in six documents and the i18n cell; the sweep and its `oneName` rule; `checkJsonFocusRings`                   | —      | open  |
| CCO2.2 | `expanded` on `openMenu` and `openFormulaPalette`; the three existing openers and the twenty-two; the `livePopup` rule | —      | open  |
| CCO2.3 | A reason on every disabled control, as the Open decides; the `disabledReason` rule                                     | —      | open  |
| CCO2.4 | A stylesheet rule for the six `ALLOWED_ORPHANS`; the list emptied                                                      | —      | open  |
