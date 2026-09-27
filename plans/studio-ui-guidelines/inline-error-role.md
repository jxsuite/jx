---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#13.2
requires: []
workspaces:
  - packages/studio
  - packages/ui
  - specs
  - docs
size: M
---

# An inline refusal is announced politely, from a region that exists before it, wherever Studio draws one

## Context

`specs/studio-ui-guidelines.md` §13.2, line 901:

> **Status: Partial.** The toast stack, the rest times, the recovery button and the Problem rows ship (`packages/studio/src/services/notify.ts`, `src/panels/problems-panel.ts`). The inline-error rule does not hold for the kit field: a refusal drawn through `jx-textfield`'s `error` lands in its `[part="error"]` region, which is `role="status"` with `aria-live="polite"` (`packages/ui/components/jx-textfield.json`), and that is how the prompt dialog, Repeat… and the Locales settings refuse a value (`packages/studio/src/surfaces/dialog.json`, `convert-repeater.json`, `settings-locales.json`). Only hand-drawn messages carry `role="alert"`.

The bullet it qualifies, line 908:

> **An inline error renders after the control, with `role="alert"`, and takes precedence over a warning state on the same row.** Where a row can carry several, it counts them from two up.

The first five bullets (four toasts, rest times, one line and one glyph, the recovery title, the Problem row) were verified by the census and are untouched. Verified while detailing (2026-09-27):

- **The kit is polite, and says why.** `jx-textfield`, `jx-select` and `jx-combobox` each draw `p[part="error"]`, `role="status"`, `aria-live="polite"`, permanent, after the control, named in its `aria-describedby` (`packages/ui/components/*.json`; `packages/ui/tests/textfield.test.ts`, "the error region predates its text"). `ui.md` §5.1 gives the reason: the region exists before the first refusal so that refusal is announced. Studio's kit-field refusals: the prompt dialog (`showPromptDialog` in `src/ui/layers.ts` re-validates on every keystroke whose verdict changes), Repeat…, the Locales tag field (`pendingRefusal` in `src/settings/locales-section.ts`, "stated while the author is typing") and Overview's name, description and URL (`settings-overview.json`).
- **The hand-drawn refusals are more than the stub listed, and none predates its text.** Each is a `p` with `role="alert"` mounted by a `$switch` case when the error appears, and none is named by a control's `aria-describedby`:
  - `schema-form.json` `field-error`: every schema form (entry editor, contributed settings sections, signal config).
  - `panel-signals.json` `field-error`, one per `field-slot` case (`text`, `multiline`, `select`, `checkbox`, `note`, `slot-field`, `chips`, `rows`). `studio.md` §5.6 (line 475) states the rename refusal's role: "prints the reason under the field (`role="alert"`)".
  - `new-project.json` `name-failure` and `destination-failure`. The destination line also carries a failed Browse… (`pickDirectory` throwing, `location-fields.ts`), whose sentence tells the reader to type the path into Location beside it, so it stays a line at that control; `new-project-modal.test.ts` line 564 is that case.
  - `settings-contexts.json` `row-error`, twice (the base width and each context row).
  - `preferences.json` `refusal-reason`: the Keyboard sheet's refused chord, one line between the search row and the command list.
- **The rest of the `role="alert"` lines report a failed operation, not a refused value** (`studio-ui-guidelines.md` §13.1's inline row is "typed a value the app cannot accept"). They are: `section-error`/`error` under a section title in `settings-contexts`, `-css-vars`, `-deploy`, `-extensions`, `-locales` and `-overview.json`; `favicon-error` (an upload or write that failed); `new-project.json` `import-failure` and `failure`; `git-panel.json` `error`; `grid-panel.json` `load-error`; `ai-chat.json` `error`; `push-plan.json` `error`; `boot-failure.json` `screen`; and the evaluation preview `expression-editor.json` `preview-error`, "a named line above the form". The repository-taken line in `new-project.json` (`taken-slot`, part `destination-failure`, no role) is a warning: `collectDestination` in `src/new-project/location-fields.ts` never reads `repoExists`, so it does not block Create.
- **"Takes precedence over a warning state" holds only because nothing sets both.** The Style tab's `data-warning` rows (`style-panel.json`) draw no inline error, and no surface sets `jx-field`'s `warning`. The kit row would get it wrong: `jx-field.json` declares `[data-invalid] > [part="label"]` before `[data-warning] > [part="label"]` at equal specificity, so a row carrying both draws its label in the warning colour, and `packages/ui/tests/field.test.ts` ("emits these rules and no others, in this order") pins that order.
- **"Counts them from two up" is drawn by nobody.** `RenderFormOptions.errorCounts` in `src/ui/schema-form.ts` draws `×N` through `field-error-count`, but no host passes it (`content/entry-editor.ts`, `settings/contributed-section.ts`, `panels/signals-panel.ts`); only `tests/schema-form.test.ts` does. `docs/studio/interface/problems-and-progress.md` ("Errors at the field") promises the count, and also says a field "waits until you leave it or press Enter before it objects", which the prompt dialog and the Locales field contradict.

**Found while detailing, not this plan's claim.** A failed `project.json` write is announced twice. `commitProjectConfig` (`src/tabs/project-config.ts`) files an error Problem, which `services/announce.ts` speaks assertively, and the Locales, CSS Variables, Deploy, Extensions and Overview sections draw the same failure again as a `role="alert"` line (the `$description` in `settings-extensions.json` calls it "not a second announcement"; a screen reader hears it twice). Overview parks the failure in a field's `error` too. That contradicts `studio-ui-guidelines.md` §13.3 rule 3 ("Nothing is announced twice"), which the audit verified. Review should mark `studio-ui-guidelines.md` §13.3 and give it an owner in this detailing pull request; this plan leaves those lines as they are and pins them by name.

## Outcome

- `studio-ui-guidelines.md` §13.2 → Implemented. Its last bullet says an inline refusal renders after its control from a polite live region that exists before the refusal: the kit field's own, or a line the surface keeps mounted. An error wins a row's label over a warning. The repeat counter is gone.
- Every hand-drawn refusal line listed above is a permanent `role="status"` line. `role="alert"` survives only on the operation-failure lines, which a new gate names one by one.
- `jx-field` gives `invalid` the label when a row carries both states, and `ui.md` §5.3's row says so.
- `studio-ui-guidelines.md` §8.7's prompt bullet names the region the refusal really lands in, and `studio.md` §5.6 stops calling the rename refusal an alert. The spec stays Partial as a whole; nothing graduates.

## Decisions

- **Open:** how loud is an inline refusal? Recommendation: polite everywhere, from a region that exists before the refusal. The reader is already at the control the refusal is about. A verdict that changes while they type (the prompt dialog, the Locales tag) must not cut off the echo of what they typed. `studio-ui-guidelines.md` §13.1a keeps `assertive` for records, which arrive wherever the reader is not, and says politeness is not a style choice, so one event gets one politeness. There are two alternatives. Making the kit's region an alert is a `ui.md` §5.1 change to three elements and interrupts every changed verdict mid-word. A paper reconcile could state two shapes (the kit polite, a hand-drawn line an alert because it is mounted with its text), but then how a line was mounted decides its politeness, and the Signals panel keeps drawing an alert beside a `jx-textfield` whose own polite region stays empty.
- **Open:** keep the repeat counter? Recommendation: remove it: `errorCounts`, the `field-error-count` span and its rule, its test, and the docs bullet. No host has ever passed a count, so no reader has seen one. Making it real means the form tallies its own refusals on the standing mount, and that races the report-policy host: `saveProjectConfig` in `contributed-section.ts` re-renders before its validation returns, so the stale verdict would be counted as a repeat.
- **Decided:** a surface-drawn line stays a line; this plan does not move refusals into the kit fields beside them. A kit field's `error` carries `ui.md` §5.1's host duty to clear and re-set a repeated sentence. Only the prompt dialog and Repeat… meet that duty today (`surfaces/dialog.ts`, `surfaces/convert-repeater.ts`), and moving the refusals that sit beside a kit field under it is a separate change. The cost is that a reader returning to one of these controls does not hear the line through `aria-describedby`, and they did not before either.
- **Decided:** the line takes the kit's shape. It is a `p` that is always mounted, `role="status"` and `aria-live="polite"` as the kit's region spells it, with its text bound. While `:empty` it is out of flow by `jx-textfield.json`'s `[part="error"]:empty` rule (absolute, 0×0, `overflow: hidden`), plus `margin: 0; padding: 0; border: 0` because `field-error` draws a border. It is never `display: none`. A node inserted with its text is reliably announced only as an alert, and `display: none` would drop the region from the accessibility tree.
- **Decided:** the Keyboard sheet keeps its one line above the list. The refusal belongs to whichever row was being changed, and a region per row would mean one per command for one sentence. Its `refusal` box stays mounted with a `data-shown` flag and goes out of flow the same way while there is no refusal, because the reason's region lives inside it. The Show button stays behind its own `$switch`.
- **Decided:** a repeated identical sentence at the converted lines is said again no more often than today, when the old alert stayed mounted while the value stayed bad.
- **Decided:** `invalid` wins over `warning` in `jx-field` itself, by declaring the warning label rule before the invalid one. Every Studio form row is a `jx-field`, and a rule that holds only while nobody sets both is one binding away from false.

## Implementation

1. **The line shape, per surface document** (`packages/studio/src/surfaces/`). Replace each `$switch` slot that mounts a refusal with the permanent line (`role="status"`, `aria-live="polite"`; the entries below write only the role for brevity). Add the `:empty` rule to the document's own `style` block, next to the part's existing rule. Rewrite any `$description` that justified `role="alert"` so it says why the line is permanent and polite, citing `studio-ui-guidelines.md` §13.2 (qualified, since a bare `§` in `packages/studio` means `studio.md`, and `bun run docs:section-refs` checks it):
   - `schema-form.json`: `span[part="error-slot"]` becomes `p[part="field-error"][role="status"]`, `textContent: "${$map.item.error}"`, still the `jx-field`'s last child. Delete `field-error-text`, `field-error-count` and the `& [part="field-error-count"]` rule.
   - `panel-signals.json`: the eight `span[part="error-slot"]` the same way. Each stays after its control.
   - `new-project.json`: `name-failure-slot` becomes `p[part="name-failure"][role="status"]` and `destination-failure-slot` becomes `p[part="destination-failure"][role="status"]`. Leave `taken-slot` alone: it is a warning.
   - `settings-contexts.json`: `base-error-slot` becomes `p[part="row-error"][role="status"]` bound to `state.baseError`, and `row-error-slot` the same bound to `$map.item.error`.
   - `preferences.json`: `refusal-slot`'s case becomes the always-mounted `div[part="refusal"][data-shown="${state.hasRefusal ? 'true' : null}"]`, with `refusal-reason` as `role="status"` and `conflict-slot` unchanged. Add `& [part="refusal"]:not([data-shown])` with the out-of-flow declarations.
2. **The adapters.** Delete a flag only where the refusal slot was its last reader:
   - `src/surfaces/schema-form.ts`: `hasError`, `errorCount` and `hasCount` leave `SchemaFormFieldView` (the row's `invalid` is its own field).
   - `src/surfaces/new-project.ts`: `hasDestinationError` leaves the scope type and its derivation. `hasNameError` stays, because it drives the name field's `invalid` and `data-invalid`.
   - Nothing else is deleted. `panel-signals.json` binds `hasError` to every row's `invalid` (the view type in `surfaces/panel-signals.ts`, derived in `panels/signals-panel.ts`); `settings-contexts.json` binds `baseInvalid` and each row's `invalid` to its fields; `preferences.json` still reads `hasRefusal` for `data-shown`. Reword the doc comment on `ContextRowView.invalid` in `src/surfaces/settings-contexts.ts`, which says the message line "exists exactly when the refusal is this row's".
3. **`src/ui/schema-form.ts`.** Remove `errorCounts` from `RenderFormOptions`, and remove `count`, `errorCount`, `hasCount` and `hasError` from `deriveField`. `validateFieldValue` and the host-wins rule are unchanged.
4. **`packages/ui/components/jx-field.json`.** In `style`, move `&[data-warning] > [part="label"]` above `&[data-invalid] > [part="label"]`, and add a `$description` on the invalid rule saying it is declared last so it wins the label.
5. **The gate**, `packages/studio/tests/inline-refusal-regions.test.ts`, reading `src/surfaces/*.json` with no DOM:
   - `REFUSAL_LINES`: `{ document, part, anchor, count }` for the fourteen lines above, where `anchor` is the part of the line's nearest ancestor that also holds what it refuses and `count` is how many such lines the document draws: `schema-form.json` `field-error` under `field` (the `jx-field`), 1; `panel-signals.json` `field-error` under `field`, 8; `new-project.json` `name-failure` and `destination-failure` under `params`, 1 each; `settings-contexts.json` `row-error` under `field` (the base width) and under `row-block` (the mapped context row), 1 each; `preferences.json` `refusal-reason` under `keys`, 1. Only nodes that carry the part AND a `role` are counted, so the role-less repository-taken line that shares `destination-failure` is not. Each counted node is `role="status"` with `aria-live="polite"`, and no `$switch` case lies between it and its nearest anchor, which is what "exists before the refusal" means in a document. "Never itself a case value" is not enough: the Keyboard sheet's old line was a child of the `refusal` box that was.
   - `ALERT_PARTS`: `{ document, part }` for the fifteen operation-failure lines. Every `role="alert"` node in a surface is on that list, so a new alert is a reviewed addition. The file's header comment says `studio-ui-guidelines.md` §13.2 governs refused values and these lines report failed operations.

**Integration contract.** Once this lands:

- `studio-ui-guidelines.md` §13.2 is the rule: a refusal renders after its control, from a polite region that exists before it.
- A schema-form row draws its refusal with no extra code, so a kind added later (the widgets `plan:site-architecture/entry-editor-widgets` adds) inherits the line.
- A new surface-drawn refusal joins `REFUSAL_LINES`, and a new alert joins `ALERT_PARTS` or the gate fails.
- `RenderFormOptions` has no `errorCounts`.
- `jx-field`'s `invalid` wins the label over `warning`.
- Whoever takes the `studio-ui-guidelines.md` §13.3 double announcement edits `ALERT_PARTS` rather than working around it.

## Tests

Run `bun test --isolate --coverage` from `packages/studio` and from `packages/ui`.

`packages/studio`:

- `tests/schema-form.test.ts`, `describe("inline errors")`:
  - `mountForm`'s `repaint(next)` rebuilds with the first mount's options, so it gains an optional second argument that overrides them for that paint.
  - Replace "a host message is announced at the control, with a repeat counter from two up" with "a refusal is a polite line that was there before it". Mount with no `errors` and keep `part(m, "url", "field-error")`: it exists, has `role` `status` and has empty text. `repaint` with `errors: { url: "Not a URL." }`. It is the same node, its text is the sentence, and `port`'s line is still empty.
  - "required-but-empty is silent until the host asks for it" and "a host message wins over the intrinsic check" read the line's text rather than its presence.
- `tests/signals-panel-template.test.ts`: the three rename tests query `[part="field-error"]` rather than `[role="alert"]`, and read an empty text where they read `null` (line 403 checks every line in the `$c` editor). The collision test asserts `role` `status` and that the Name row's line queried before the commit is the node carrying the sentence after it. `tests/search-signals-seo-diff-gaps.test.ts`: `alertText` queries `[part="field-error"]`, and lines 176, 178 and 192 expect `""` where they expect `undefined` or `null`.
- `tests/new-project-modal.test.ts`:
  - `destinationError()` and `nameError()` end in `|| null` instead of `?? null`, so the six assertions that a refusal is absent (lines 392, 428, 538, 572, 589, 606) read an empty line as none.
  - Line 564 expects `status`.
  - New "the name refusal's line exists before Create": `npPart("name-failure")` is empty before Create, and the same node carries "Project name is required" after.
- `tests/new-project-location-fields.test.ts`: lines 417 and 422 scope the repository-taken reads to `[part="taken-slot"]`, and line 465 reads empty text where it read `null`.
- `tests/contexts-section.test.ts`: `errorTexts` (line 148) drops empty lines. `tests/settings-services-diff-gaps.test.ts` line 116 passes unchanged, because the base width's line is the first `row-error` in document order.
- `tests/preferences-dialog.test.ts`: line 552 reads an empty `refusal-reason` and a `refusal` box without `data-shown`, and line 542's case adds `role` `status`.
- The new gate, `tests/inline-refusal-regions.test.ts`:
  - "every refusal line is a polite region that predates its text"
  - "every alert in a surface is a named operation failure"
  - A synthetic case for each, proving each check can fail: a status line whose `$switch` case sits below its anchor (the old `refusal` box shape), and an unlisted alert.

`packages/ui`:

- `tests/field.test.ts`:
  - The order list in "emits these rules and no others, in this order" swaps the two label rules.
  - New "invalid takes the label from warning when a row carries both": the warning label rule's index is below the invalid one's, and both colours are unchanged.

Coverage: no new source file, so the manifest check is unaffected. `schema-form.ts` loses lines rather than gaining untested ones. The per-file thresholds (`packages/studio/bunfig.toml` `lines = 0.958, functions = 0.941`; `packages/ui/bunfig.toml` `lines = 0.99, functions = 1.0`) stay; ratchet only if the worst file rises.

## Specs & docs

`specs/studio-ui-guidelines.md`, in place, no heading renumbered:

- **§13.2 marker** (line 901): replace the Partial paragraph with `> **Status: Implemented.**`.
- **§13.2 last bullet** (line 908): replace it with two bullets:

  > - **An inline error is said after its control, politely, from a region that was there before it.** It is the sentence refusing a value the reader entered (§13.1). A kit field draws its own: `jx-textfield`, `jx-select` and `jx-combobox` keep a permanent polite `[part="error"]` that the control names in `aria-describedby` (`ui.md` §5.1 and §5.3). A line a surface draws is the same kind of region: always mounted, `role="status"`, and taken out of flow while it is empty, never `display: none`, which would take the region out of the accessibility tree. It must exist before the refusal because a live region announces a change to itself, and a node inserted with its text already in it is announced reliably only as an alert. It is polite because the reader is already at the control: a verdict that changes while they type must not cut off the echo of what they typed, and `assertive` belongs to §13.1a's records, which arrive wherever the reader is not. A list whose rows share one refusal states it once: the Keyboard sheet's refused chord is one line above its commands, not a region in every row.
  > - **An error takes precedence over a warning on the same row.** `jx-field` gives `invalid` the label when a row carries both (`ui.md` §5.3).

- **§8.7** (line 543): "renders as the field's own error text (`jx-textfield`'s `[part="help"]`)" becomes "renders as the field's own error text (`jx-textfield`'s `[part="error"]`, §13.2)". This is the editorial drift the audit record assigns to whichever plan next edits that fact.
- **§8.7's other editorial drift** rides here too, because this is the one plan that edits §8.7 (the audit record's rule for drift; take each as the record states it and re-verify it at landing): the layer paragraph's "three fixed, full-viewport hosts declared in `packages/studio/index.html`" becomes the four hosts `overlayLayers()` declares in `src/shell/tree.ts`, `#layer-toast` included; the sentence naming `editor/shortcuts.ts` among the app-level keydown handlers that stand down while a modal is up says the stand-down is the command context's `modal.open` stack (`src/commands/context.ts`); and the bullet "Auto-hides when no selection" that ends §8.7 moves into §8.6's list.
- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§13.2 an inline error is said from a polite live region that exists before the refusal, the kit field's own or a line the surface keeps mounted, an error wins a row's label over a warning, and the repeat counter is gone; §8.7 names the prompt's error region, its four layer hosts and the modal keyboard stand-down."`

`specs/studio.md` §5.6 (line 475, no marker): "prints the reason under the field (`role="alert"`)" becomes "prints the reason under the field, in a polite line that is there before the refusal (`studio-ui-guidelines.md` §13.2)". **Fragment:** `bun run spec:change studio.md minor -m "§5.6 a refused rename prints its reason in a polite line that exists before the refusal."`

`specs/ui.md` §5.3, the `jx-field` row (line 251): "`invalid` recolouring the help line as a STATE rather than a second class" becomes "`invalid` recolouring the label and the help line as a STATE rather than a second class, and taking the label from `warning` when a row carries both". **Fragment:** `bun run spec:change ui.md minor -m "§5.3 jx-field's invalid takes the label from warning when a row carries both."` `plan:ui/element-contract-text` edits the same row (it names the `help` slot); the two clauses are independent, and whichever plan lands second keeps the other's.

Docs (no page's `spec:` cites `studio-ui-guidelines.md#13.2`; these are the pages that describe the behaviour or list a changed file):

- `docs/studio/interface/problems-and-progress.md`, "Errors at the field":
  - Replace the first bullet with "**It doesn't talk over your typing.** Some fields check a value as you type it and others once you commit it. Either way a screen reader reads the message at your next pause, not over the letters you are typing."
  - Delete the "A repeat is counted" bullet.
  - Add `packages/studio/src/ui/schema-form.ts` to `code:`.
  - Leave the "New changes" tip to `plan:studio/panel-scheduler-text`, which owns `studio.md` §16.5.
- `docs/extending/ui-kit.md`, the `jx-field` paragraph (line 344): after "leaves the sentence alone.", add "When a row carries both, `invalid` wins the label."
- No change: `docs/studio/projects/create.md` (the name refusal is still "directly under that field"), `docs/studio/projects/settings.md`, `docs/studio/design/breakpoints.md`, `docs/studio/interface/preferences.md` and `docs/studio/logic/data.md` describe where a refusal appears, and none of them moves. Docs pages ban em dashes; the text above has none.

## Acceptance

- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass.
- `sed -n '/^### 13.2 /,/^### 13.3 /p' specs/studio-ui-guidelines.md | grep -c -e 'Status: Partial' -e 'role="alert"'` prints `0`, `grep -n 'role="alert"' specs/studio.md` shows only the `studio.md` §19 WAI-ARIA row's `announce.ts` regions, and `bun run plans:status --who-claims studio-ui-guidelines.md#13.2` names no plan.
- `git grep -c '"role": "alert"' packages/studio/src/surfaces` totals 15, every one a part in `ALERT_PARTS`. `git grep -n errorCounts packages/studio` is empty.
- `bun test --isolate tests/inline-refusal-regions.test.ts` from `packages/studio` passes, and fails if `role="alert"` is put back on `panel-signals.json`'s text-row line.
- By hand, with a screen reader on the dev server: rename a signal onto an existing name and the refusal is read after the field's echo, not over it. Refuse a chord in the Keyboard sheet and the reason is read once.
