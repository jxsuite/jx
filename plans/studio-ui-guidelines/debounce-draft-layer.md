---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#4.4
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: L
---

# Every text field in a Studio form writes when typing pauses and again on change, at a delay the timing module names

## Context

`specs/studio-ui-guidelines.md` §4.4, line 271:

> **Status: Partial.** `INPUT_DEBOUNCE` (400) and `CODE_DEBOUNCE` (500) are in `packages/studio/src/ui/timing.ts`, and `debouncedStyleCommit()` is in `store.ts`. Much text entry commits through a provisional preview instead, `LIVE_PREVIEW` at 350ms and then again on blur or Enter: the draft layer (`src/ui/field-input.ts`) in the properties panel, and the same semantics on their own `LIVE_PREVIEW` timers in `panels/head-panel.ts` and `panels/frontmatter-panel.ts`. `panels/seo-modal.ts` and `surfaces/settings-head.ts` keep a local 300ms `EDIT_DEBOUNCE_MS`, and the lit `@input` examples predate the document surfaces.

The body says every text handler debounces at 400ms (500 for code) and shows two lit `@input` bindings. §4.5 restates it as `@input` debounced, `@change` immediate.

**The census was right about the drift and wrong about its shape.** It read `LIVE_PREVIEW` as a second, deliberate semantic ("provisional preview"). It is not one. Every live field in Studio already does the same two things: a keystroke re-arms a per-field timer that writes a transaction when typing pauses, and `change` cancels the timer and writes at once. The draft layer changes where the Content tab holds half-typed text (keyed to the node, `studio.md` §6.1), not when it is written. The style panel does the identical pause-then-change at 400 (`editText` / `commitText`), so the `timing.ts` sentence that calls `LIVE_PREVIEW` "deliberately below `INPUT_DEBOUNCE`" because "blur/Enter commits again" distinguishes nothing. The 350 predates the module: `field-input.ts` had `DEFAULT_DEBOUNCE_MS = 350`, and e078d466, which created `timing.ts`, says "No timing value changed". The Content tab itself mixes both: `LIVE_PREVIEW` for element, text, template and component-prop rows, `INPUT_DEBOUNCE` for attribute, link and custom-attribute rows (`properties-panel.ts`, `debounceMs`). `CODE_DEBOUNCE` has no reader at all.

**Every text field that writes a document or a project file, by site** (paths under `packages/studio/src/`):

| Site                                                                            | Keystroke                                                                                          | `change`                                                                    | Delay today                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `panels/properties-panel.ts` (draft layer)                                      | pause write                                                                                        | at once (`commitField`)                                                     | `LIVE_PREVIEW` ×4, `INPUT_DEBOUNCE` ×3               |
| `panels/head-panel.ts`, `panels/frontmatter-panel.ts`                           | pause write                                                                                        | at once (`commitText`)                                                      | `LIVE_PREVIEW`                                       |
| `panels/style-panel.ts`                                                         | pause write (`debouncedStyleCommit`)                                                               | at once, except the custom property's value cell, which binds no `onchange` | literal `400` (line 2022)                            |
| `ui/media-picker.ts` + `surfaces/media-field.json`                              | pause write                                                                                        | none bound                                                                  | local `FIELD_DEBOUNCE_MS = 400`                      |
| `panels/seo-modal.ts`                                                           | pause write                                                                                        | at once                                                                     | local `EDIT_DEBOUNCE_MS = 300`                       |
| `surfaces/settings-head.ts`                                                     | script and style bodies: pause write                                                               | attribute fields: a timer 300ms **after** `change`; bodies: none bound      | local `EDIT_DEBOUNCE_MS = 300`                       |
| `ui/schema-form.ts`                                                             | pause write                                                                                        | at once; the JSON text binds none                                           | local `TEXT_COMMIT_MS = 400`, `JSON_COMMIT_MS = 500` |
| `panels/signals-panel.ts`                                                       | JSON and expression rows: pause write; function Body (`live: "commit"`): **a write per keystroke** | at once (`commitField`)                                                     | local `DEBOUNCE_MS = 500`                            |
| `panels/events-panel.ts` (Logic tab: repeater and condition text, handler body) | **a write per keystroke** (`setField`, `setCode`)                                                  | none bound                                                                  | none                                                 |
| `panels/statement-editor.ts` (Dispatch event name)                              | **a write per keystroke** (`setField`)                                                             | none bound                                                                  | none                                                 |
| `ui/expression-editor.ts` (literal text operand)                                | **a write per keystroke** (`setText`)                                                              | none bound                                                                  | none                                                 |

The last four rows are what the census missed, and they are the worst of it: each keystroke is a `transactDoc` with no `coalesceKey`, so a canvas patch and an undo entry per character. `events-panel.test.ts` ("typing in the inline body updates the function def"), `statement-editor.test.ts` and `expression-editor.test.ts` ("string literal … commits typed input") assert the write synchronously on `input`.

Change-only fields are already common and correct: renames and keys (`statements.json` lane key, `settings-defs.json` field names), Project Settings rows (`settings-overview.json`, `settings-contexts.json`), `reference-field.json`, `secret-field.json`. Fields whose `oninput` only feeds a local draft (filters, add forms, dialog answers, the commit message, the composer) write nothing and are outside the rule. The Content tab's custom-attribute pair binds `onchange` to the same pause as `oninput` (`editName` / `editValue`), deliberately: both cells land in one write.

Delays that are not a form field's write, and stay out: the canvas caret's `COMMIT_IDLE_MS` (`canvas/iframe-editable-root.ts`, §8.3), the Monaco buffers' `BUFFER_COMMIT` arms (500 in `panels/editors.ts`, 600 in `canvas/canvas-render.ts`, `studio.md` §4.2 and §16.3), `LIVE_PREVIEW_DEBOUNCE_MS` (`services/live-preview.ts`, a read), `PUBLISH_DEBOUNCE_MS` (`preview/preview-overlay.ts`) and `MIRROR_DEBOUNCE_MS` (`collab/collab-session.ts`).

**Found and not claimed.** A `change` after a pause write repeats the value already written, and `transactDoc` pushes an entry for a transaction that changed nothing, so after type, pause, leave, the first ⌘Z undoes nothing visible. One identity check in the history path answers it for every writer at once; per site it would be a fix in every row of the table above. It belongs to §9.2 and `plan:_shared/studio-state-contract`, whose `applyContentMutation` decision already takes the same stance for one caller. §4.4 as rewritten here promises nothing about undo granularity beyond "no entry per keystroke".

## Outcome

- `studio-ui-guidelines.md` §4.4 → Implemented: a live text field writes when typing pauses and at once on `change`; a field whose half-typed value means nothing writes on `change` alone; the two delays are `INPUT_DEBOUNCE` and `CODE_DEBOUNCE`; the draft layer and the custom-attribute pair are named; the delays that are not form writes are named as other intents.
- §4.5 (unmarked) restated in the document idiom, in the same release.
- In code: `timing.ts` holds two form delays and `LIVE_PREVIEW` is gone; no module declares its own form delay, and a sweep test holds that; every live field binds `onchange`; no text field writes per keystroke; `field-input.ts` exports `fieldCommits()`.
- The spec stays Partial; nothing graduates.

## Decisions

- **Open:** one text delay or two? Recommendation: fold `LIVE_PREVIEW` into `INPUT_DEBOUNCE` at 400, because 400 is the documented number, the 350 has no rationale older than its own migration, the "provisional" argument applies equally to fields already at 400, the Content tab would otherwise keep two delays for identical rows, and the name collides with `LIVE_PREVIEW_DEBOUNCE_MS`, a different intent. The cost is 50ms more before the canvas follows typing in the Content tab, the header card and the Page panel. The alternative: keep `LIVE_PREVIEW` as the draft layer's delay, move the Content tab's attribute, link and custom-attribute rows onto it, and name three delays in §4.4 with the distinction the code does not otherwise draw.
- **Decided:** §4.4 specifies behaviour and delays, not one mechanism. The head, frontmatter, SEO, schema-form, signals and style maps keep their shape and change only their constant, because each already keeps the pattern and carries teardown rules its tests pin (drop on a document change, per pane card, on close, per controller). Folding them is a refactor this section does not need.
- **Decided:** add `fieldCommits()` to `src/ui/field-input.ts` for the sites that gain a timer here (settings-head, the Logic tab, the expression editor), because they would otherwise hand-roll the keyed timer map a fourth to sixth time, which is the drift `timing.ts` exists to stop, and because `field-input.ts` is the text-field module, so no new file needs a manifest entry.
- **Decided:** the per-keystroke writers become live fields, except the statement editor's event name, which becomes change-only: a half-typed event name names nothing and nothing on the canvas follows it.
- **Decided:** "code" is text that is parsed or is source (JSON, a `$compute` expression, a function or handler body, a script or style body), and takes `CODE_DEBOUNCE`. A `${…}` template, prose and a media path are text.
- **Decided:** settings-head's attribute fields write at once on `change`, because a timer after `change` is what §4.5 says `change` is not.
- **Decided:** a rewired site resolves its write at keystroke time and drops pending writes when what it would write into changes; settings-head, whose one target is `project.json`, flushes instead. A drop loses nothing on screen: each keystroke carries the field's whole text, and the `change` write follows on blur. This is the rule `head-panel.ts` and `frontmatter-panel.ts` learned (e.g. "a keystroke still waiting when the card goes away is cancelled, not committed").
- **Decided:** guard the one-source claim with a name sweep, not a behaviour sweep: `tests/timing.test.ts` refuses a `*DEBOUNCE*_MS` or `*COMMIT*_MS` constant outside four named non-form intents, and a numeric literal passed to `debouncedStyleCommit` or `scheduleDraftCommit`. The drift arrived as local constants each time; a name is mechanical where "is this a form field" is judgement.

## Implementation

Paths under `packages/studio/`. Comments cite `studio-ui-guidelines.md §4.4` qualified; a bare `§` here means `studio.md` (`bun run docs:section-refs`).

**DDL1.1: one delay per intent, and every live field writes on change.**

1. `src/ui/timing.ts`: delete `LIVE_PREVIEW` and its doc. The header says §4.4 names the two form delays. `INPUT_DEBOUNCE`'s doc: every live text field, the draft layer's included. `CODE_DEBOUNCE`'s doc: text that is parsed or is source.
2. `src/ui/field-input.ts`:
   - Header: the draft layer is the Content tab's store for half-typed text keyed to a node (`studio.md` §6.1); the pattern and its delays are `studio-ui-guidelines.md` §4.4. Drop "every Studio text field" and "consistent across all panels".
   - Add, importing `INPUT_DEBOUNCE` from `./timing`:

     ```ts
     export interface FieldCommits {
       /** A keystroke: re-arm `key`'s timer and write `value` once typing pauses. */
       edit(key: string, value: string, write: (value: string) => void, ms?: number): void;
       /** A change: cancel `key`'s timer and write `value` now. */
       commit(key: string, value: string, write: (value: string) => void): void;
       /** Write every pending edit now, in the order the keys were first typed. */
       flush(): void;
       /** Cancel every pending edit without writing. */
       drop(): void;
     }
     export function fieldCommits(): FieldCommits;
     ```

     One `Map<string, { timer, value, write }>`; `ms` defaults to `INPUT_DEBOUNCE`; the timer deletes its entry before calling `write`.
3. `src/panels/properties-panel.ts`: the four `LIVE_PREVIEW` sites (template rung in `applyLadder`, `textRow`, `textContent`, component props) take `INPUT_DEBOUNCE`; fix the import.
4. `src/panels/head-panel.ts`, `src/panels/frontmatter-panel.ts`: `LIVE_PREVIEW` → `INPUT_DEBOUNCE` in the `setTimeout` and the three comments that name it (`_pending`, the `renderPagePanel` note, `HeaderCard.pending`).
5. `src/panels/seo-modal.ts`: delete `EDIT_DEBOUNCE_MS`, keep its reason as the `onEdit` comment, use `INPUT_DEBOUNCE`.
6. `src/panels/style-panel.ts`: `debouncedStyleCommit(actions.debounceId, INPUT_DEBOUNCE, actions.edit)`. The custom row (`otherProps` loop) gains `commit: (value) => ctx.commit(prop, value)`. `src/surfaces/style-panel.json`, `[part="kv-value"]`: add an `onchange` calling `#/state/commitText` with the same two arguments as its `oninput`.
7. `src/ui/media-picker.ts`: delete `FIELD_DEBOUNCE_MS`, pass `INPUT_DEBOUNCE`, and wire ``commit: (next) => { cancelStyleDebounce(`media:${entry.prop}`); entry.commit(next); }``. `src/surfaces/media-field.ts`: `MediaFieldActions.commit(value)`, handed to the scope. `src/surfaces/media-field.json`, `[part="value"]`: `onchange` → `#/state/commit`.
8. `src/ui/schema-form.ts`: delete `TEXT_COMMIT_MS` and `JSON_COMMIT_MS`, use `INPUT_DEBOUNCE` and `CODE_DEBOUNCE`. `src/surfaces/schema-form.json`, `[part="json-text"]`: `onchange` → `#/state/commit` (the existing `commit` action already cancels and writes a `json` plan).
9. `src/panels/signals-panel.ts`: `DEBOUNCE_MS` → `CODE_DEBOUNCE`.
10. `src/surfaces/settings-head.ts` and `.json`: replace `_pending` and `flushEdits` with `const typing = fieldCommits()`. Scope `edit(id, key, value)` becomes ``typing.edit(`${id}:${key}`, value, (v) => write(id, key, v), CODE_DEBOUNCE)``, called only by the two body fields' `oninput`. New scope `commit(id, key, value)` calls `typing.commit` with the same token. The six attribute fields' `onchange` target `#/state/commit`; the two body fields gain `onchange` → `commit`. `add`, `addFont`, `remove`, `removeFont` call `typing.flush()`, and so does `dispose()`. `HeadScope` gains `commit`.
11. `tests/timing.test.ts` gains the sweep (see Tests).

**DDL1.2: no field writes per keystroke, and the spec.**

12. `src/panels/events-panel.ts`, `src/surfaces/logic-panel.ts`, `.json`: `LogicActions` gains `editField(key, value)` and `editCode(key, value)`. The two `[part="text"]` fields' `oninput` → `editField` and a new `onchange` → `setField`; `[part="body-field"]`'s `oninput` → `editCode` and a new `onchange` → `setCode`. In `events-panel.ts`, a module `typing = fieldCommits()`. `editField` captures `plans.fields.get(key)` at the keystroke and arms `typing.edit(key, value, write)`, where `write` is what `setField` does with that plan; `editCode` captures `plans.selection` and the binding plan and arms at `CODE_DEBOUNCE`. `setField` and `setCode` go through `typing.commit`. `projectLogicPanel()` records the tab and primary selection the pending edits were typed against and calls `typing.drop()` when either differs (`pathsEqual` from `src/state.ts`); `bindLogicPanelHost` drops on unbind. The `onChange` closures resolve `activeTab.value` when they run, which is why the drop is needed.
13. `src/surfaces/statements.json`, `[part="text"]`: `oninput` becomes `onchange`, same target, with a `$description` giving the reason in the shape the `$switch` lane key's own `$description` uses. `statement-editor.ts` is unchanged.
14. `src/ui/expression-editor.ts`, `src/surfaces/expression-editor.ts`, `.json`: `ExpressionActions` gains `editText(key, value)`; `[part="literal-text"]`'s `oninput` → `editText` and a new `onchange` → `setText`. In `ui/expression-editor.ts`, a `WeakMap<HTMLElement, FieldCommits>` per host. `editText` captures `plan(key)?.setText` at the keystroke and arms it; `setText` goes through `commit`. `paint()` drops the host's pending edits before it repaints, because the host panels' `onChange` closures resolve `activeTab.value` when they run and a repaint is how a re-targeted host arrives; a repaint while typing only postpones the canvas until the next keystroke or the `change` write. The detached-host sweep drops a removed host's.
15. `src/panels/signals-panel.ts`: the function Body's `live: "commit"` becomes `"debounce"`; remove `"commit"` from `FieldPlan.live` and its branch in `inputField`.
16. Spec, fragment and docs as in Specs & docs. Delete this file and remove its id from `plan:studio-ui-guidelines/conventions-checklist`'s `requires`.

`plan:studio-ui-guidelines/multiline-text-field` rewrites one clause of §4.5 ("For `jx-textfield` and `textarea` …"). Whichever lands second keeps the other's intent: this plan's §4.5 already names the kit field "single-line or `multiline`".

**Integration contract.** Once this lands:

- `src/ui/timing.ts` exports `INPUT_DEBOUNCE` (400) and `CODE_DEBOUNCE` (500) as the form delays; `LIVE_PREVIEW` does not exist.
- `src/ui/field-input.ts` exports `fieldCommits()` and `FieldCommits` as above.
- `tests/timing.test.ts` fails on a new local form-delay constant or a literal delay.
- §4.4 is Implemented with the text in Specs & docs. `plan:studio-ui-guidelines/conventions-checklist` may rewrite §10's "Text inputs are debounced (400ms standard)" to "A text field that writes as it is typed waits out `INPUT_DEBOUNCE` (`CODE_DEBOUNCE` for code) and writes at once on `onchange`; a name or key writes on `onchange` alone (§4.4)", "Pickers commit on `@change`" to `onchange`, and drop §4.4's clause from §10's marker.
- A plan that adds a form field (`plan:site-architecture/seo-structured-data-editor`, `plan:site-architecture/entry-editor-widgets`) takes its delay from `timing.ts` and binds `onchange`.

## Tests

`bun test --isolate --coverage` from `packages/studio`. `affected.ts` also derives the `packages/desktop` leg and `lens-mutants`. Per-file thresholds are `lines = 0.958, functions = 0.941` in `packages/studio/bunfig.toml`: every new function (`fieldCommits` and its four methods, `editField`, `editCode`, `editText`, the settings-head `commit`, the media-field `commit`) needs a caller in a test, or its file's functions ratio drops. No new source file, so the manifest check is unaffected. Ratchet the threshold only if the run's worst file rises.

**DDL1.1**

- `tests/field-input.test.ts`, new describe "fieldCommits": "edit writes the latest value once typing pauses"; "edit defaults to INPUT_DEBOUNCE" (record the delay by swapping `setTimeout`, as `timing.test.ts`'s `recordDelays` does); "commit cancels the pending edit and writes at once"; "keys are independent"; "flush writes every pending edit now, in first-typed order"; "drop cancels every pending edit".
- `tests/timing.test.ts`: "the remaining constants" keeps `POLL_GIT` only; the ordering invariant becomes `INPUT_DEBOUNCE < CODE_DEBOUNCE < POLL_GIT`. New describe "one source for every form delay", reading `src/**/*.ts`:
  - "no module declares its own debounce or commit delay": the matches of `/^\s*(export\s+)?const\s+([A-Z_]*(DEBOUNCE|COMMIT)[A-Z_]*_MS)\s*=/m` are exactly `COMMIT_IDLE_MS` (`canvas/iframe-editable-root.ts`), `MIRROR_DEBOUNCE_MS` (`collab/collab-session.ts`), `PUBLISH_DEBOUNCE_MS` (`preview/preview-overlay.ts`), `LIVE_PREVIEW_DEBOUNCE_MS` (`services/live-preview.ts`).
  - "every allowance still matches", so a stale entry goes red, as `tests/run-reported.test.ts` does.
  - "no delay is passed as a number": no match of `/(debouncedStyleCommit|scheduleDraftCommit)\([^,)]+,\s*\d/`.
- `tests/head-editor.test.ts`: "an edit still in flight …" types a style body with `input` (the attribute fields have no pending state any more); "link field change debounces …" becomes "an attribute field's change writes at once" with no timer stub; new "a body keystroke waits out CODE_DEBOUNCE", "a body's change writes at once and cancels the keystroke", "re-rendering into a new container writes a body edit still in flight".
- `tests/media-picker.test.ts`: "a change writes the typed path at once and cancels the keystroke".
- `tests/style-panel.test.ts`: "a custom property's value writes at once on change".
- `tests/schema-form.test.ts`: "the JSON text writes at once on change".
- Real-timer waits follow the constant: `tests/frontmatter-panel.test.ts` (three `setTimeout(r, 400)`), `tests/seo-modal-media.test.ts` (400) and `tests/seo-modal.test.ts` (450) wait `INPUT_DEBOUNCE + 60`. `tests/head-panel.test.ts`'s comments that name `LIVE_PREVIEW` say "the pause".

**DDL1.2**

- `tests/events-panel.test.ts`: "typing in the inline body updates the function def" becomes "a body keystroke writes once typing pauses" (nothing written synchronously; written after `CODE_DEBOUNCE + 60`); new "leaving the body writes it at once", "a repeater field's keystroke waits out INPUT_DEBOUNCE and its change writes at once", "a burst of typing is one undo entry" (history length rises by one across three keystrokes and a pause), "a keystroke pending when the tab changes is dropped".
- `tests/statement-editor.test.ts`: the two `type(…[part="text"], …)` calls become `commit(…)`; new "the event name writes on change only".
- `tests/expression-editor.test.ts`: "string literal … commits typed input" splits into "a literal keystroke writes once typing pauses" and "a literal's change writes at once"; new "a pending literal edit is dropped when the host is re-targeted".
- `tests/signals-panel-template.test.ts` ("description and body commit …"): the Body assertion waits `CODE_DEBOUNCE + 60` after `typeText`, and a sibling case asserts nothing is written synchronously.

## Specs & docs

**§4.4, in place** (heading kept). Marker:

> **Status: Implemented.** `packages/studio/src/ui/timing.ts` (`INPUT_DEBOUNCE`, `CODE_DEBOUNCE`), `src/ui/field-input.ts` (the draft layer, `fieldCommits`), `src/store.ts` (`debouncedStyleCommit`); `packages/studio/tests/timing.test.ts`, `tests/field-input.test.ts`.

The body, replacing everything from "All text input handlers" to the end of the section:

> **A text field that writes as it is typed writes twice.** Each keystroke re-arms that field's timer, and the value is written when typing pauses, so the canvas follows the typing. `change` (leaving the field, Enter, its clear button) cancels the pending write and writes at once, so nothing waits on a timer the reader has left. A write per keystroke is the defect this prevents: each one is a transaction, a canvas patch and an undo entry (§9.1, §9.2).
>
> **The delay is an intent, named once in `packages/studio/src/ui/timing.ts`.** No surface declares its own number, and `packages/studio/tests/timing.test.ts` refuses one.
>
> | Intent | Constant         | Delay | For                                                                                                                 |
> | ------ | ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
> | Text   | `INPUT_DEBOUNCE` | 400ms | prose, names, attribute and style values, a `${…}` template, a media path                                           |
> | Code   | `CODE_DEBOUNCE`  | 500ms | text that is parsed or is source: JSON, a `$compute` expression, a function or handler body, a script or style body |
>
> Code waits longer because half-typed code is usually invalid, and writing it spends a parse on a state the reader is about to leave.
>
> **A field whose half-typed value means nothing writes on `change` alone**, with no timer: a rename, a key, an event name, a Project Settings row.
>
> **Where the text lives meanwhile.** A kit field holds its own text, and a binding skips a write equal to what the element holds, so a pause write never resets the field. The Content tab also keeps half-typed text in the draft layer (`src/ui/field-input.ts`), keyed to the node (`studio.md` §6.1), and clears it on the `change` write; it changes where the text is held, not when it is written. A custom attribute's name and value cells are one write, so `change` in either re-arms the pause and the pair lands together.
>
> **A pending write belongs to what it was typed into.** A surface drops its pending writes when the document, tab or selection they were typed against goes away. Project Settings, whose one target is `project.json`, writes them instead.

Then the two examples, replacing the lit ones: a `jx-textfield` document node with `oninput` → `#/state/edit` and `onchange` → `#/state/commit` (each passing `$map/item/key` and `event#/target/value`), and the module side:

```ts
const typing = fieldCommits();
const actions = {
  edit: (key: string, value: string) => typing.edit(key, value, (v) => write(key, v)),
  commit: (key: string, value: string) => typing.commit(key, value, (v) => write(key, v)),
};
```

and a closing paragraph:

> **Not form writes.** Other delays pace other things and keep their own names beside the code they pace: the canvas caret's typing-pause commit (§8.3), a Monaco buffer's commit (`studio.md` §4.2, §16.3), an expression's live value on the canvas, a preview publish, and the collaboration mirror.

**§4.5, in place** (unmarked). The table becomes `oninput` ("The text is changing (a keystroke)"; "The pause of §4.4, or no write when the field only feeds a local draft: a filter, an add form, a dialog's answer") and `onchange` ("The value is settled: blur, Enter, a pick, the clear button"; "Immediate; cancels a pending `oninput` write"). The paragraph becomes: "A picker (`jx-select`, a menu) binds `onchange` only. A text field (`jx-textfield`, single-line or `multiline`) binds both, or `onchange` alone when its half-typed value means nothing (§4.4)."

**Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§4.4 states the form text-field pattern as it ships: a write when typing pauses and an immediate write on change, the text and code delays named once in the timing module, change-only fields and the draft layer; §4.5 states the two events as a document binds them"`. Minor: an `implement`.

**Docs.** No page's `spec:` cites `studio-ui-guidelines.md#4.4`. `bun run docs:sync` names the pages whose `code:` lists a changed file:

- `docs/studio/logic/events.md` (`events-panel.ts`, `logic-panel.ts`): the "Inline function" paragraph gains "What you type in the text field is saved when you pause and again when you leave the field, so one undo step takes back a burst of typing, not one character."
- Unchanged, and the pull request says so: `docs/studio/design/properties.md`, `components.md`, `style-inspector.md`, `states-and-selectors.md`, `stylebook.md`, `docs/studio/editing/frontmatter.md` ("Every field commits as you type" still holds), `docs/studio/editing.md`, `docs/studio/projects/media.md`, `docs/studio/logic.md`, `logic/data.md`, `logic/data-sources.md`, `logic/statements.md`, `logic/formulas.md`, `docs/studio/design/repeaters.md`, `docs/studio/interface/problems-and-progress.md`, `docs/README.md`. None states a delay or a per-keystroke write.

No spec graduates.

## Acceptance

- `bun run plans:status --spec studio-ui-guidelines` no longer lists `studio-ui-guidelines.md#4.4`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
- `grep -rnE 'LIVE_PREVIEW\b|EDIT_DEBOUNCE_MS|FIELD_DEBOUNCE_MS|TEXT_COMMIT_MS|JSON_COMMIT_MS|\bDEBOUNCE_MS\b' packages/studio/src packages/studio/tests` prints nothing.
- Adding `const X_DEBOUNCE_MS = 1;` to any file under `packages/studio/src` turns `tests/timing.test.ts` red.
- Review walks the Context table against the surfaces: `logic-panel.json` (`text`, `body-field`), `expression-editor.json` (`literal-text`), `media-field.json` (`value`), `schema-form.json` (`json-text`), `style-panel.json` (`kv-value`) and `settings-head.json` (`body-field`) each bind `onchange`; `statements.json`'s `text` binds `onchange` and no `oninput`.
- In Studio (`packages/studio:verify`): a burst typed into an element's handler body adds one history entry once typing pauses, not one per character (compare the tab's `history.index` before and after).
- The `packages/studio` and `packages/desktop` legs and `lens-mutants` are green; the screenshots lane pushes no commit.

## Slices

| Slice  | Scope                                                                                                                                                                     | Claims                        | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----- |
| DDL1.1 | `timing.ts` holds two form delays; every live field takes its delay from it and binds `onchange`; settings-head writes `change` at once; `fieldCommits()`; the sweep test | —                             | open  |
| DDL1.2 | The Logic tab, statement editor, expression editor and function Body stop writing per keystroke; §4.4 and §4.5 rewritten, marker, fragment, docs; plan deleted            | `studio-ui-guidelines.md#4.4` | open  |
