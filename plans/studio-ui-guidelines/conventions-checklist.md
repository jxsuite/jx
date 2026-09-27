---
status: drafted
disposition: reconcile
claims:
  - studio-ui-guidelines.md#10
requires:
  - _shared/studio-state-contract
  - studio-ui-guidelines/conventions-checklist-controls
  - studio-ui-guidelines/debounce-draft-layer
  - studio-ui-guidelines/empty-state-copy
  - studio-ui-guidelines/form-row-part-vocabulary
  - studio-ui-guidelines/git-panel-action-list
  - studio-ui-guidelines/label-abbreviations
  - studio-ui-guidelines/name-and-chord-gaps
  - studio-ui-guidelines/unrendered-placements
size: S
---

# The conventions checklist holds item for item, once each section it summarises does

## Context

`specs/studio-ui-guidelines.md` §10, line 669:

> **Status: Partial.** Most items hold, many behind a gate (`check-surface-purity.ts`, `check-styles.ts`, `check-lit-conventions.ts`). Five inherit a section's open item. "State mutations are immutable (produce new objects)" inherits §9.1's divergence: `transactDoc` and the `mutate*` helpers mutate in place and replace only the root reference. "Text inputs are debounced (400ms standard)" inherits §4.4's. The two command-rendering items, a surface's actions arriving as a projection that prints title, chord and `requires`, and a control rendered from its command record rather than a hand-maintained list, inherit §12.3's and §12.5's: the rail prints no chord, the tab-strip and Files-tree menus carry none, and the Source Control panel draws from its own `ACTIONS`. The empty-region item inherits §11's: some empty regions still print a noun phrase.

(`plan:studio-ui-guidelines/name-and-chord-gaps` trims the rail and menu clause when it lands; this plan replaces the whole marker.)

§10 is twenty-five checklist items. Most restate a rule a numbered section owns, so an item can only be true when its section is; three state a rule nothing but §10 does. The census verified the gated items and the five above. Detailing read every item against the tree of 2026-09-27 (paths under `packages/studio/`) and found seven more false items (the inspector row, the label's placement, Title Case, one accessible name, the disabled reason, the popup's state, the emitted-class rule) and three worded wider or older than what ships (input size, the picker event, the focus ring).

**Hold, behind a gate.** "A new surface is a Jx document" (`scripts/check-surface-purity.ts`); "Colors reference CSS custom properties" (`scripts/check-styles.ts`'s raw-hex rule, with `ALLOWED_HEX`); "A new ELEMENT belongs in the kit" (no `customElements.define` in `src`; `scripts/check-icons.ts` refuses an undefined `jx-*` tag); the four §9.4 binding items (`scripts/check-lit-conventions.ts`).

**Hold, checked by hand.** Collapsible sections use `jx-accordion` (§5.1, verified by the audit). No Studio wrapper re-emits an inner control's event: the wrappers are kit elements now, and their behaviours own re-emission (`packages/ui/src/behaviors/textfield.ts`). No `prompt(`, `confirm(` or `alert(` in `src` (`new-project/new-project-modal.ts`'s `confirm` is a local function). A dialog's answers are `dialog.json`'s `confirmLabel`, `cancelLabel` and `secondaryLabel` (§8.7).

**False until a section owner lands** (the edges in `requires`):

- "A surface's actions arrive as a projection … prints title, chord and `requires`" and "A control that invokes an action renders it from its command record": §12.3 (`plan:studio-ui-guidelines/name-and-chord-gaps`) and §12.5's `ACTIONS` (`plan:studio-ui-guidelines/git-panel-action-list`).
- "An inspector row is a `jx-field` inside the tab's own document" is false for the Style and Content tabs, the Page panel and the Document Header card, whose rows are `div[part="row"]` > `div[part="row-label"]` plus a kit field with its own `label` (`style-panel.json`, `properties-panel.json`, `panel-page.json`, `doc-header.json`); only the Logic tab (`logic-panel.json`), `schema-form.json` and some settings forms use `jx-field`. "Labels … are the field element's own label rather than a sibling of the control" contradicts §4.1's own rule, which allows the row's label part. §4.1 is `plan:studio-ui-guidelines/form-row-part-vocabulary`'s, which names `row`, `row-label` and `row-name` and asks for this edge.
- "Labels are Title Case": `ui/schema-form.ts` labels every schema-driven row with its raw key (`label: prop`), and twelve literal field labels in `src/surfaces/*.json` are sentence case ("Repository name", "Production branch", …). §2.3 (`plan:studio-ui-guidelines/label-abbreviations`) routes every generated label through one helper and holds the literal ones to Title Case with a test, and asks for this edge.
- "Text inputs are debounced (400ms standard)": §4.4 (`plan:studio-ui-guidelines/debounce-draft-layer`).
- "State mutations are immutable (produce new objects)": §9.1 (`plan:_shared/studio-state-contract`, whose integration contract names this rewrite).
- "An empty region says its piece through `EmptyStateSpec`" and, for the empty-state action, "renders disabled with the reason in its tooltip": §11 (`plan:studio-ui-guidelines/empty-state-copy`).
- "A control that opens a MENU … draws its rows from a placement": the pane context bar's preset menu builds its rows by id (§12.1, `plan:studio-ui-guidelines/unrendered-placements`, which moves it onto `context/pane`), and Source Control's commit menu is hand-built (§12.5). `plan:studio-ui-guidelines/git-panel-action-list` draws that menu's one row from the `git.commit` record by id, not from a placement, and asks this plan to word the item to admit it, so the item is reworded to rows drawn from records rather than from a placement alone.

**False, and stated only by §10** (moved to `plan:studio-ui-guidelines/conventions-checklist-controls`, which has the evidence): "A control carries ONE accessible name" (eight surface nodes give `title` and `aria-label` one value); "A control that cannot act renders disabled with the reason in its tooltip" (43 disabled buttons give no reason, and six disabled fields have no tooltip to give one in); "a live `aria-expanded`" (twenty-two popup openers bind none, and a kit opener then reports closed while open); "Every class emitted from TypeScript has a rule in `styles/*.css`" (six `ALLOWED_ORPHANS` in `check-styles.ts` draw from inline `cssText`, which the gate tolerates as a backlog). "`outline: none` is scoped to `:focus:not(:focus-visible)`" holds in effect but not in shape: what ships and what `check-styles.ts` enforces is a suppression paired with a `:focus-visible` restore (`FOCUS_RING_ALLOWANCES`), and the gate stops at stylesheets.

**Holds, worded wider than the rule.** "Inputs use `size="sm"`": 196 of 208 kit inputs in the documents do; the twelve that do not are dialog and modal fields at the kit's default (`dialog.json`, `publish.json`, `github-publish.json`, `ai-model-picker.json`), and §4.1 states the rule for the form row. "Pickers commit on `@change`" spells the event with lit's binding sigil.

**Found here, now claimed by §12.3's owner.** §12.3 applies "wherever a command is rendered", and about a dozen controls run a command by id under words of their own ("Search appearance…" twice, "Manage contexts…", "Content types…", "Preferences › Accounts", "Edit Global Styles", "Open Layout →", the SEO modal's provenance chips, the Languages panel's "Open project settings…", the derivation notice's `pane.pin` action). `plan:studio-ui-guidelines/name-and-chord-gaps` tables them and takes them in NAC1.3 (the last two through `plan:studio-ui-guidelines/empty-state-copy`), and holds the Open on how each is named. "A control that invokes an action renders it from its command record" is false until it lands; see Decisions.

The audit record's "Spec-wide decisions" says this plan requires five plans. Detailing makes it nine: the five, §2.3's, §4.1's and §12.1's owners, and the enabling plan.

Disposition `reconcile`: every code change lives with a plan this one requires, so what is left is §10's text. Twelve items are reworded to the sections as they will read, and the marker goes.

## Outcome

- `studio-ui-guidelines.md` §10 → Implemented: every item true, each citing its section and naming its gate where one exists.
- §14's Accessible Name row cites the sweep that holds §10's one-name item.

## Decisions

- **Decided:** split. The four rules only §10 states, and the focus-ring gate's hole, go to `plan:studio-ui-guidelines/conventions-checklist-controls`, an enabling plan with no prerequisites, so those fixes land now rather than behind eight section owners. This plan keeps the claim and does only the rewrite.
- **Decided:** `requires` names every plan whose section an item restates in its open part: §2.3 (Title Case, which schema-driven forms and twelve literal labels break), §4.1 (the inspector-row, label and input-size items), §4.4 (debounce), §9.1 (state writes), §11 (empty regions, the empty-state action's reason), §12.1 (menu rows from a placement), §12.3 and §12.5 (command rendering), plus the enabling plan. Not §9.3 (`plan:studio-ui-guidelines/retire-renderer-registry`): the surface item restates the document-and-adapter shape, which ships, and §9.3's open part is the renderer registry. No item restates §12.2's label stripping or §12.4's bare runs.
- **Decided:** a reworded item quotes its section as that section reads when this lands. The targets in **Specs & docs** come from the prerequisites' integration contracts; where a landed text differs, the landed text wins, and the reviewer reads each item against its section.
- **Decided:** the input-size item is scoped to the form row rather than widened. §4.1 is where the rule lives, the dialog layer's fields draw at the kit's default in all four flows that have them, and moving them to `sm` is a visual change no section asks for.
- **Decided:** the one-name item says what it covers, Studio's own markup. The kit's `label` and `hint` are a name and a description (`ui.md` §5.1), so the 73 action buttons whose tooltip repeats their name are not two names.
- **Open:** how the controls that run a record under words of their own are named. This is one sign-off with `plan:studio-ui-guidelines/name-and-chord-gaps`'s Open of the same name, which now owns them (NAC1.3). Recommendation: as that plan recommends (the record's title, the Settings path for a fixed argument, a link's own words with the record's tooltip), and §10's command-record item then stays word for word. If that plan's rule keeps a link's words, or is declined, the item quotes the scope §12.3's new bullet states instead.

## Implementation

The work is the §10 rewrite in **Specs & docs**, made in place in `specs/studio-ui-guidelines.md` once every prerequisite has landed. Before editing, the landing pull request re-checks what each prerequisite promised:

| Prerequisite                                               | What must hold                                                                                                                                                            | Items it makes true                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `plan:_shared/studio-state-contract`                       | §9.1 Implemented, headed "Transactions", stating that a tab's document is written only by mutators running inside a transaction                                           | state writes                                             |
| `plan:studio-ui-guidelines/debounce-draft-layer`           | §4.4 Implemented; every text commit takes its delay from `src/ui/timing.ts`                                                                                               | debounce, pickers                                        |
| `plan:studio-ui-guidelines/form-row-part-vocabulary`       | §4.1 and §4.2 Implemented, naming `row`, `row-label`, `row-name`, `chip-slot` and `chip`                                                                                  | inspector row, labels, input size                        |
| `plan:studio-ui-guidelines/label-abbreviations`            | §2.3 Implemented; every generated label goes through `utils/labels.ts` and a test holds literal field labels to Title Case                                                | labels                                                   |
| `plan:studio-ui-guidelines/empty-state-copy`               | §11 Implemented; no allowance left in `DISABLED_ALLOWANCES`                                                                                                               | empty regions, disabled reason                           |
| `plan:studio-ui-guidelines/name-and-chord-gaps`            | §12.3 Implemented, including NAC1.3 and the Open decision above                                                                                                           | projection prints, command record                        |
| `plan:studio-ui-guidelines/git-panel-action-list`          | §12.5 Implemented; no Source Control control is drawn from a list that duplicates a record, and the commit menu's row is the `git.commit` record                          | command record, menu rows                                |
| `plan:studio-ui-guidelines/unrendered-placements`          | §12.1 Implemented; the pane menu projects `context/pane`                                                                                                                  | menu rows                                                |
| `plan:studio-ui-guidelines/conventions-checklist-controls` | `tests/control-semantics.test.ts` with its three allowance maps empty; `checkJsonFocusRings` in `scripts/check-styles.ts`, called by `collect()`; `ALLOWED_ORPHANS` empty | one name, disabled reason, focus, popup, emitted classes |

Then re-run the hand checks for the ungated items with the greps in **Acceptance**.

**Integration contract.** Nothing requires this plan. Once it lands, §10 is Implemented and every item cites the section it restates, so a later change that reopens one of those sections re-marks §10 only if the item it restates becomes false again.

## Tests

A paper plan; no suite changes. The gates that prove it: `bun run docs:status` (the marker's form, and no open item under an Implemented header if the spec graduates), `bun run plans:check` (the claim is closed and no dependent is left dangling), `bun run docs:spec-release` (the fragment, or the in-place bump), `bun run docs:standards` (§14's new evidence path exists), `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown`.

## Specs & docs

All edits in `specs/studio-ui-guidelines.md` §10, in place; the heading, the lead sentence and the checklist form stay.

**Marker.** Replace the Partial marker with:

```markdown
> **Status: Implemented.** Each item restates the section it cites or is this section's own rule, and gates hold most of them: `packages/studio/scripts/check-surface-purity.ts` (the substrate), `packages/studio/scripts/check-styles.ts` (colours, emitted classes, and focus rings in stylesheets and documents), `packages/studio/scripts/check-lit-conventions.ts` (§9.4's bindings) and `packages/studio/tests/control-semantics.test.ts` (one accessible name, a popup's live `aria-expanded`, a disabled control's reason).
```

**Items.** Thirteen stay word for word. The twelve below are replaced, each at its current position:

- "A surface's actions arrive …": the citation "(§12)" becomes "(§12.1, §12.3)"; the text is unchanged.
- "An inspector row is a `jx-field` …" becomes: "An inspector row is markup in the tab's own document: §4.1's `[part="row"]`, whose `[part="row-label"]` holds the provenance chip and the `[part="row-name"]`, or the kit's `jx-field` where a label sits beside its control. `.style-row`, `.field-row` and `renderProvenanceChip` are gone with `ui/field-row.ts`; the chip is each document's `[part="chip"]` (§4.2), in `panels/provenance.ts`'s words".
- "Labels are Title Case, and are the field element's own label …" becomes: "Labels are Title Case (§2.3). A row's visible name is its `[part="row-name"]` and the control's accessible name is the kit field's own `label`, never a bare `<label>` element (§4.1)".
- "Inputs use `size="sm"` and take full container width" becomes: "An input in a form row uses `size="sm"` and takes the row's full width (§4.1)".
- "Text inputs are debounced (400ms standard)" becomes: "A text input commits through one of §4.4's intents and takes its delay from `src/ui/timing.ts`, never from a constant of its own".
- "Pickers commit on `@change` without debounce" becomes: "Pickers commit on `change`, without a debounce (§4.5)".
- "State mutations are immutable (produce new objects)" becomes: "A tab's document is written only by mutators running inside a transaction (§9.1), never by assignment".
- "A control carries ONE accessible name. …" keeps its two sentences and gains: "No `aria-label` goes on an element that has no role. The kit's `label` and `hint` are a name and a description (`ui.md` §5.1), not two names (`tests/control-semantics.test.ts`)".
- "A control that cannot act renders **disabled with the reason in its tooltip**, never absent" gains: ": a command's `requires` (§12.3), an empty state's reason (§11.2), or the surface's own sentence; a field, which has no tooltip, says it in its help line. A control waiting on its own activation shows the kit's `loading` instead (`tests/control-semantics.test.ts`)". If the enabling plan's Open decision exempts busy and boundary states, the item says so instead of the last sentence.
- "`outline: none` is scoped to `:focus:not(:focus-visible)` …" becomes: "`outline: none` is paired with a `:focus-visible` rule that restores a ring on the same selector: in a stylesheet through `check-styles.ts`'s `FOCUS_RING_ALLOWANCES`, in a document's `style` as a `:focus-visible` key beside it. Suppressing the ring for keyboard focus makes the control untraversable".
- "Every class emitted from TypeScript has a rule in `styles/*.css` …" becomes: "Every class emitted from TypeScript has a rule, in `styles/*.css` or in the CSS template that draws it into the canvas frame — no `style=` attribute doing a stylesheet's job; an inline style carries only a per-instance value (`scripts/check-styles.ts` fails on an orphan, and `ALLOWED_ORPHANS` is empty)".
- "A control that opens a MENU carries `aria-haspopup="menu"` and a live `aria-expanded` …" becomes: "A control that opens a popup carries `aria-haspopup` and a live `aria-expanded` (`haspopup` and `expanded` on a kit control) and prints no chord of its own; a menu of commands draws its rows from command records, a placement's members or the records it names, never from a list of its own (§8.4, §12.1, §12.5) (`tests/control-semantics.test.ts`)".

**§14.** The Accessible Name and Description Computation row's Evidence cell gains `packages/studio/tests/control-semantics.test.ts` after `packages/studio/src/panels/problems-panel.ts`; its Note is unchanged.

**Release.** `bun run spec:change studio-ui-guidelines.md minor -m "§10's checklist restates its sections as they ship: document writes are transactions, text commits take the timing module's intents, inspector rows use the row part vocabulary, and gates hold one accessible name, a popup's live expanded state, a disabled control's reason, a paired focus ring and a rule for every emitted class"`. If §10 is the spec's last open item when this lands (`graduation-ready` fires), the pull request graduates the spec instead: header `**Status:**` to Implemented, `bun run spec:bump studio-ui-guidelines.md minor -m "…"` (the sentence above) in place with no fragment, and `plans/studio-ui-guidelines/` deleted.

**Docs.** No page cites `studio-ui-guidelines.md#10` in its `spec:`, and this plan changes no code, so no page changes. The code comments that cite §10 (`src/panels/tab-strip.ts`, `src/settings/extensions-section.ts`, `src/surfaces/settings-extensions.ts`) stay true.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists §10.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:standards`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- The ungated items, re-checked: `git grep -nE '(^|[^.[:alnum:]_])(window\.)?(prompt|confirm|alert)\(' packages/studio/src -- '*.ts'` shows only local functions; `git grep -n 'customElements.define' packages/studio/src` is empty; every kit input inside a `[part="row"]` in `packages/studio/src/surfaces/*.json` has `size` `"sm"`.
- Read against its section, every item holds: the reviewer walks the twelve reworded items with the prerequisite table above.
