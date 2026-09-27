---
status: drafted
disposition: implement
claims:
  - studio.md#3.3
  - studio-ui-guidelines.md#9.1
  - studio-ui-guidelines.md#9.2
size: M
workspaces:
  - packages/studio
  - docs
---

# Both specs state one transaction contract for a tab's document, and every write and history entry in Studio keeps it

## Context

`specs/studio.md` §3.3, line 59 (unmarked before the census):

> **Status: Partial.** Only the 100-entry history limit and `projectState` / `setProjectState` hold. Documents belong to a tab and are edited in place inside `transactDoc()` (`packages/studio/src/tabs/transact.ts`), which records forward and inverse doc-op pairs with a checkpoint every 20 entries; the operations are `mutate*(tab, …)` with `undo(tab)` / `redo(tab)`, selection lives in `tab.session.selection`, and none of `createState`, `selectNode`, `hoverNode`, `pushDocument`, `popDocument` or a `state.js` exists (`packages/studio/src/state.ts` holds path utilities and `projectState` only).

It qualifies "Immutable state with undo/redo history (100 entries). All mutations produce a new state object — no in-place edits." and a 21-row "Key state operations (from `state.js`)" table. §3.2's diagram still reads "Studio state (immutable)" and "mutation → new state".

`specs/studio-ui-guidelines.md` §9.1, line 574:

> **Status: Partial.** Documents are mutated in place inside a transaction: `transactDoc` (`packages/studio/src/tabs/transact.ts`) runs the mutation against the live document, records forward and inverse ops and replaces only the root reference, and the `mutate*` helpers write nested keys directly. `store.ts` exports no `update()`, and there is no `updateStyle(S, …)`.

It qualifies "All mutations produce a new state object. Never modify state in place." and an example calling `update(updateStyle(S, path, prop, value))` from `../store`.

`specs/studio-ui-guidelines.md` §9.2, line 590:

> **Status: Partial.** The per-tab linear stack capped at 100, `project.json` as a tab, one entry per batch and the full rollback of a failed write ship (`packages/studio/src/tabs/transact.ts`, `tests/transact-history.test.ts`). Entries are not `{ document, selection }` snapshots: they carry forward and inverse ops with the selection before and after, plus a document checkpoint every 20th entry, and `undo(tab)` / `redo(tab)` live in `src/tabs/transact.ts`, not in `src/state.ts`.

It qualifies "Each entry snapshots `{ document, selection }`" and "`undo()` / `redo()` from `state.js`".

The census stubbed these as two `reconcile` plans; the cross-spec review merged them because both describe one module. The text half is a reconcile: the reactive-state migration removed `createState`, the flat-state bridge and the document stack (`studio.md` §14.3) on purpose, and in-place mutation under a recording transaction is the design. The root reference is still replaced on every applied transaction, which the reactive layer and the assistant's undo witness rely on (`studio-ui-guidelines.md` §12.4). But the sections cannot flip on text, because the code breaks the rule §9.1 and §9.2 would state in four places (below).

**What ships** (verified at the tree of 2026-09-26; paths under `packages/studio/`)

- `transactDoc(tab, fn, { skipHistory, origin, coalesceKey })` in `src/tabs/transact.ts`: records between `beginRecording()` / `endRecording()` (`src/tabs/patch-ops.ts`), replaces only the root (`{ ...raw }`), pushes an entry, marks dirty, calls the collab observer. Returns `false` for no tab or a `setTransactGate` refusal. A throwing mutation is rolled back (`rollbackFailedTransaction`: ops, frontmatter, selection, dirty flag) and rethrown. `transact(tab, fn)` passes the document; `applyExternalDocOps` applies a peer's ops with `origin: "remote"` and no entry.
- 26 exported `mutate*(tab, …)` helpers write in place and record op pairs. `recordDocOp`, `recordFmOp` and `recordPatch` are no-ops outside a recording, so a mutator outside `transactDoc` changes the tree unrecorded. "Written only inside `transactDoc` or a `mutate*` helper" is therefore one condition.
- Not every transaction writes through a mutator. `commitProjectConfig`'s patch keys and rival handover (`src/tabs/project-config.ts`), `panels/dnd.ts`'s `$elements` (until `plan:imports/packages-panel-section` makes a placement one recorded transaction, imports.md §5.1), `editor/convert-to-repeater.ts`, the JSON realm of the Page panel, SEO modal and header card (`transact(tab, fn)` in `head-panel.ts`, `seo-modal.ts`, `frontmatter-panel.ts`) and collab's `reconcileTabFromY` assign keys directly. They record no ops, so `pushHistoryEntry` stores their entry as a whole-document checkpoint, and undo restores it. A rule that says "only mutators" is false today, and making it true would convert every such site for no behaviour change.
- History: `HISTORY_LIMIT = 100`, `CHECKPOINT_INTERVAL = 20`. `pushHistoryEntry` stores `forwardOps`, `inverseOps`, `fmOps`, `selectionBefore`, `selection`, and a whole `document` when `truncated.length % 20 === 0` or when ops cannot be used (no ops recorded, or the `jx-legacy-history` flag). On overflow it promotes the new base with `materializeState` before `shift()`. `undo(tab)` / `redo(tab)` replay through `transactDoc` with `origin: "history"`, or restore a checkpoint; a refused replay leaves the index alone. `createTab` (`src/tabs/tab.ts`) seeds one checkpoint.
- Batches: a multi-node mutator (`mutateRemoveNodes`, `mutateDuplicateNodes`, over `structuralBatch` in `src/tabs/selection.ts`) is one transaction. `beginBatch(tab)` / `endBatch()` (callers: `services/tool-executor.ts`, `services/project-adoption.ts`) suspend per-transaction entries and push one `{ document, selection }` snapshot, the one place §9.2's snapshot bullet is literally true.
- Collab: `setHistoryDelegate` routes undo to the session's `Y.UndoManager` (`collab.md` §3); `endBatch` pushes nothing for a delegated tab; detach re-bases the stack inline (`src/collab/collab-session.ts`, after `setHistoryDelegate(tab, null)`); `project.json` never gets a delegate (`studio.md` §17.1).
- `src/state.ts`: `JxPath`, the tree utilities and `projectState` / `setProjectState` / `requireProjectState`; no `state.js`. Selection is `tab.session.selection` (a `JxPath[]`, `studio.md` §6.7), hover `tab.session.hover`. `src/store.ts` exports no `update()`; its header still says "Store.js — Shared state hub … state.js re-exports", and its re-export banner reads "Re-exports from state.js". `plan:studio-ui-guidelines/retire-renderer-registry` rewrites that module's render orchestration and does not touch either.
- The history type is `HistorySnapshot` in `tab.history.snapshots` (72 references in 21 files, `tests/harness/score.ts` among them); its `document` is null except on a checkpoint.

**Corrections to the stub's evidence**

- No production code coalesces. `applyInlineCommit` (`src/editor/inline-edit-apply.ts`) accepts `coalesceKey`, but its only caller (`src/canvas/iframe-host.ts`) passes none. Coalescing is a module capability exercised only by tests.
- `markNonInvertible` has no caller in `src`. A checkpoint by necessity comes from a transaction that recorded no ops, or from the legacy flag.
- An `endBatch` overflow test exists (`tests/transact-gaps.test.ts`, "endBatch at the history limit"), but it asserts only the length, so it blesses the unpromoted base.
- The docs already promise what the Code view breaks: `docs/studio/projects/settings.md`, `docs/studio/interface/modes.md` and `docs/studio/design/stylebook.md` say the settings form, Project Styles and Code share "one undo history" for `project.json`, and `docs/studio/logic/code.md` says "one undo stack".

**What is missing**

1. **The cap breaks on the batch path.** `endBatch` shifts on overflow without promoting the new base. A scratch run (99 edits, then one batch) left a base with no checkpoint; every later edit was applied, then threw `history-missing-checkpoint` out of `pushHistoryEntry` after the root replacement and before the dirty mark and the observer, and one undo went back past all of them and the batch.
2. **The batch holds every tab, and entries record nothing.** `transactDoc` tests `!_batchTab`, so while an assistant turn batches tab A, a person's edit to tab B gets no entry and B's log goes stale. For a co-edited B it is worse: collab's `publishRecord` (`src/collab/collab-session.ts`) buffers any tab's ops while `isBatching()`, and `onBatchEnd` flushes only the batch tab's session, so B's edits reach neither the peers nor B's delegated undo manager. `endBatch` pushes a snapshot even when nothing was written, so a read-only turn costs an undo step that does nothing. And a transaction whose ops write back the values they found (a debounced field's `change` after its pause commit) still pushes an entry; `plan:studio-ui-guidelines/debounce-draft-layer` hands that one to §9.2 and to this plan.
3. **Four writers leave the log describing a tree that is gone.**
   - `mountSourceEditor`'s buffer commit (`src/canvas/canvas-render.ts`, `BUFFER_COMMIT`, 600 ms, solo tabs only) assigns the reparsed document and frontmatter to the tab and marks it dirty.
   - `reloadFileInTab` (`src/files/files.ts`) does the same when the file changes under a clean tab (`reloadCleanTab`), after the assistant writes an open file (`ai-tools.ts`, `ai-project-tools.ts`), after a grid save (`grid/sources/content-source.ts`) and after a rename rewrites references (`reloadRewrittenTabs`).
   - `adoptProjectConfig` (`src/tabs/project-config.ts`) replaces `project.json`'s contents in a `skipHistory` transaction, on the one tab that never has a delegate.
   - `applyContentMutation` (`src/panels/head-panel.ts`) calls `mutateUpdateFrontmatter` outside any transaction for a Markdown page's Page panel, SEO modal and document header, so a title or `$head` change is recorded nowhere (collab watches the frontmatter map deeply for exactly this reason).

   A scratch run of the first shape, with the source edit deleting the first child, made the next undo write the old text into the node now at `children/0`.

4. The three sections rewritten in one vocabulary, §3.2's diagram with them.

Found and not claimed:

- `reloadRewrittenTabs` reloads an open tab whether or not it is dirty, so a rename that rewrites references in a document with unsaved edits discards them. That is a `studio.md` §9.1.1 defect.
- A reload of a co-edited tab (the assistant's `write_file` to a clean open file) swaps the root outside `transactDoc`, so collab's bypass-write net publishes it as a local edit and the session's undo manager can take it back. `reloadCleanTab` already skips co-edited paths; the other callers do not. That is `collab.md`'s to decide, so §9.1's reload bullet below is scoped to a tab with no session.

## Outcome

- `studio.md` §3.3 → Implemented: a tab owns its document, edits run in place inside a recording transaction, each tab keeps its own history. §3.2's diagram shows that flow (informative, no marker).
- `studio-ui-guidelines.md` §9.1 → Implemented, retitled "Transactions": every write to a tab's document is a transaction, or a reload that re-bases the history.
- `studio-ui-guidelines.md` §9.2 → Implemented: entries, checkpoints, coalescing, batches and the collab delegate as they ship, with the cap holding on every path.
- In code: the four writers above keep the rule; the batch path promotes on overflow, holds only its own tab (history and collab publish) and pushes nothing when it wrote nothing; a transaction that changed nothing pushes no entry; a sweep test keeps root and frontmatter assignment inside `src/tabs/transact.ts`. Neither spec graduates.

## Decisions

- **Decided:** one `implement` plan, not a text plan plus a code plan. The markers cannot flip until the code keeps the rule, and `plan:studio-ui-guidelines/conventions-checklist` needs §9.1 Implemented, not merely reworded.
- **Decided:** one vocabulary in both specs. A **transaction** is one `transactDoc` call. A **mutator** is a `mutate*` helper, valid only inside one. An **entry** is one element of a tab's history. A **checkpoint** is an entry that also holds the whole document. A **batch** is the `beginBatch` / `endBatch` bracket and nothing else; a structural command over a selection is "one transaction" (`studio.md` §6.7's words), never a batch. A **reload** replaces a document with what its file says. `structuralBatch` keeps its name: it is private to the selection helpers and names a set of paths.
- **Decided:** §9.1's rule is "a tab's document is written only inside a transaction", and mutators are how a transaction records what it wrote. A direct write inside a transaction is legal and costs a whole-document checkpoint (the sites under **What ships**). "Only by mutators" would be false the day it lands.
- **Decided:** `HistorySnapshot` and `tab.history.snapshots` keep their names; only the type's doc comment changes. A rename touches 72 sites in 21 files, among them the eval harness that `plan:ai/harness-phase-1#J1.13` is rewriting, for no behaviour. The specs name no type, only "entries".
- **Decided:** §3.3's table becomes a table of the state model's parts (document, transaction, mutators, history, reload, selection and hover, path utilities, project state), naming each entry point and module. It does not list the 26 mutators: the module's `mutate*` exports are the list, the rule `studio-ui-guidelines.md` §9.3 applies to surfaces. One sentence retires `state.js`'s names.
- **Decided:** §9.1's heading text becomes "Transactions"; the number stays. Nothing links the old slug (`implementation-status.md`, the only other mention, is generated).
- **Decided:** the Code view commits through a new mutator, `mutateReplaceDocument`, that records one root `set-key` pair per key, ordered so that both directions reproduce key order exactly. Two alternatives fail. `diffDocs` (`@jxsuite/collab/diff-core`) would give small entries, but its `deepEqual` ignores key order, and a key the author moved in the Code view must survive to the save (`studio.md` §9.4; `json-layout.ts` records no order). A checkpoint entry would keep order, but it drops `fmOps`, so undoing a Markdown source edit would revert the body and keep the edited title.
- **Decided:** one entry per Code-view commit, with no `coalesceKey`. The pairs carry whole root values, so a folded run would grow without bound. The canvas caret's commits are uncoalesced as well. A commit whose parse equals the tab's document and frontmatter opens no transaction.
- **Decided:** one push path, `appendEntry`, shared by `pushHistoryEntry` and `endBatch`, so "entry 0 is a checkpoint" holds by construction rather than by two copies of the trim.
- **Decided:** `applyContentMutation` writes only the keys that changed, in one transaction. Wrapping today's unconditional `$head` write would push no entry once `recordChanged` lands, but it would still mark the tab dirty and run the collab observer on every no-op commit.
- **Decided:** a sweep test (`tests/document-writers.test.ts`, in the shape of `tests/run-reported.test.ts`) refuses `.doc.document =` and `.doc.content.frontmatter =` outside `src/tabs/transact.ts`. A mutator called outside a transaction cannot be caught statically; its callers are fixed here and asserted by behaviour.
- **Open:** is a reload an undoable edit, or a new start? Recommendation: a new start. `reloadDocument` replaces the document and re-bases the history on it, as opening the file and collab detach already do. The assistant tells the model and the reader that its disk writes are "not undoable" (`ai-tools.ts`, `docs/studio/ai/chat.md`), and `adoptProjectConfig` already refuses an entry for that reason. An undoable reload would let ⌘Z then ⌘S silently write the pre-change file back over another program's or the assistant's write. The cost is that edits made before the reload can no longer be undone, and the docs say so.
- **Open:** should this plan fix missing item 2 (the batch's cross-tab hold in history and in collab's publish, its empty entry, and the no-op transaction's entry), or leave the batch half to `plan:ai/harness-phase-1#J1.13`, whose lanes replace the mechanism? Recommendation: fix all of it here. Each is a few lines in `transactDoc`, `endBatch` and `publishRecord`. §9.2 cannot honestly read Implemented while tab B's log goes stale or a co-edited B's edits never leave the client. J1.13's own tests ("tab B keeps its own history", "an empty lane adds no entry") then hold before it lands, and the no-op entry has no other owner. The cost is re-recording the agent-trace goldens once here rather than once in J1.13.

## Implementation

Paths under `packages/studio/`. Comments cite `studio-ui-guidelines.md §9.1` / `§9.2` qualified, because a bare § in this package means `studio.md` (`bun run docs:section-refs`).

1. `src/tabs/transact.ts`, history append. Extract `appendEntry(tab, truncated, entry)` from `pushHistoryEntry`'s tail. It pushes the entry; when `truncated.length > HISTORY_LIMIT`, it sets `truncated[1].document = materializeState(truncated, 1)` if that entry is not a checkpoint, then calls `shift()`; then it assigns `tab.history.snapshots` and `index`. `pushHistoryEntry` (the non-coalesced path) and `endBatch` both call it.
2. `src/tabs/transact.ts`, the batch and the no-op entry. Add `let _batchWrote = false`, reset by `beginBatch`.
   - Add a private `recordChanged(record)`: `true` when the record holds no op at all (an unrecorded write may have changed anything, so it keeps its checkpoint), otherwise `true` unless every doc pair is a `set-key` whose forward and inverse values serialize alike and every frontmatter op's `before` and `after` serialize alike. `JSON.stringify`, not `deepEqual`: a write that only reorders an object's keys is a change, because `materializeState` replays it and the save writes it.
   - In `transactDoc`, replace `if (!skipHistory && !_batchTab)`. When `!skipHistory && recordChanged(record)`, a transaction on `tab === _batchTab` sets `_batchWrote = true` and pushes nothing; a transaction on any other tab calls `pushHistoryEntry`. The dirty mark and the observer are unchanged.
   - `endBatch` pushes its `{ document, selection }` checkpoint through `appendEntry` only when `_batchWrote` is set and the tab has no delegate. It resets the flag and still calls the notifier.
   - `src/collab/collab-session.ts`, `publishRecord`: buffer only when `batchTab() === session.tab`, so a co-edited tab outside the batch publishes at once; the import swaps `isBatching` for `batchTab`, and `isBatching()` keeps its other caller (`project-adoption.ts`).
   - If J1.13 has landed first, skip the batch half (keep `recordChanged`) and add the assertions under Tests against its lanes.
3. `src/tabs/transact.ts`, `export function rebaseHistory(tab: Tab): void`. It sets `snapshots` to one checkpoint of `jsonClone(toRaw(tab.doc.document))` with `cloneSelection(tab.session.selection)`, and `index = 0`. When `_batchTab === tab` it clears `_batchWrote`, so the open batch pushes only what it writes after the reload.
4. `src/tabs/transact.ts`, `export function reloadDocument(tab: Tab, document: JxMutableNode, frontmatter?: Record<string, unknown>): void`. It assigns `tab.doc.document`, and `tab.doc.content.frontmatter` when given, sets `tab.doc.dirty = false`, then calls `rebaseHistory(tab)`. It is not a transaction (no gate, no entry, no observer), which matches what the reload callers do today.
5. `src/tabs/transact.ts`, `export function mutateReplaceDocument(tab: Tab, next: JxMutableNode, frontmatter?: Record<string, unknown>): void`.
   - For each current root key, in reverse order, it records `recordDocOp({ forward: { op: "set-key", path: [], key }, inverse: { op: "set-key", path: [], key, value: cloneValue(old) } })`. For each key of `next`, in order, it records forward "set to `cloneValue(new)`" and inverse "delete". Redo therefore rebuilds the new key order, and undo, which replays inverses in reverse, rebuilds the old one. The shape is `mutateDocumentField`'s in `src/content/entry-fields.ts`.
   - It applies the same change in place: delete every root key, then assign `next`'s keys in order, as `replaceContents` in `src/tabs/project-config.ts` does. Each pair is recorded right after the write it describes, as every mutator records (`rollbackFailedTransaction` relies on it). `applyDocOpToDoc` deletes only on an absent `value`, so `""`, `false` and `null` replay verbatim.
   - With `frontmatter` given, the same two passes run over `tab.doc.content.frontmatter` through `applyFmState` and `recordFmOp({ field, before, after })`. Values are written verbatim, not through `mutateUpdateFrontmatter`, which deletes `""` and `null`, because a source round trip can put them there.
   - It records no patch op, so the commit takes the full-render path the bare assignment takes today. Undo and redo replay its root `set-key` ops through `applyDocOp`, which records root-path patches; `classifyOps` (`src/canvas/canvas-patcher.ts`) rejects the batch at its first `tagName` or `children` op (`replace-root`), so a replay full-renders too, and that escalation count is expected.
6. `src/tabs/transact.ts`, doc comments. `transactDoc`'s JSDoc states the rule and its one exception (a reload). `mutateUpdateFrontmatter`'s "Does not push document history" becomes "Records a frontmatter op; call it inside a transaction".
7. `src/tabs/tab.ts`: `HistorySnapshot`'s comment says it is one history entry, and `document` is set only on a checkpoint.
8. `src/canvas/canvas-render.ts`, `mountSourceEditor`'s `BUFFER_COMMIT` callback. After the parse and the second `tabIsLive` check:
   - When `JSON.stringify` of the parsed document (and frontmatter) equals the tab's raw ones, open no transaction. That path keeps today's `tab.doc.dirty = true` and `markSettled()`, and the JSON branch still takes `parsed.layout`: a JSON buffer can differ in layout alone, and the save writes the layout.
   - Otherwise run `const applied = transactDoc(tab, (t) => mutateReplaceDocument(t, document, frontmatter))`; the JSON branch passes no frontmatter. Only when `applied` does the JSON branch set `tab.doc.layout = parsed.layout`, and only then do both branches call `writes.markSettled()`. A refused commit leaves the buffer ahead, which is the dock editor's rule. The gate refuses only a co-edited tab and this commit runs only for a solo one, so the check is defensive, but it is what makes the return value mean something here.
   - On the transaction path the `tab.doc.dirty = true` lines go, because the transaction marks the tab dirty.
9. `src/files/files.ts`, `reloadFileInTab`. The format branch calls `reloadDocument(tab, document, frontmatter)`. The JSON branch calls `reloadDocument(tab, parsed.document as JxMutableNode)`, then sets `tab.doc.layout`. The trailing `tab.doc.dirty = false` goes.
10. `src/tabs/project-config.ts`, `adoptProjectConfig`. After its `skipHistory` transaction, call `rebaseHistory(tab)`. The JSDoc's "`skipHistory`, because this is a RELOAD" paragraph gains the reason: a reload re-bases, so ⌘Z cannot replay an entry recorded against the previous configuration.
11. `src/panels/head-panel.ts`, `applyContentMutation`. After `fn(tmp)`, work out which keys changed: `title` by `!==`, `$head` by `deepEqual` from `@jxsuite/collab/diff-core` (`canvas/diff-marks.ts` already imports it) against the normalised `newHead`. When neither changed, only call `rerender()`. Otherwise run one `transactDoc(tab, (t) => …)` that writes the changed keys through `mutateUpdateFrontmatter`, then `rerender()`.
    - `tmp.$head` is a shallow copy, so the comparison holds only while the mutators replace an entry rather than edit it (`upsertMeta` and `upsertLink` assign a new entry; the add and remove rows push and splice). An in-place edit of a shared entry changes both sides and would be dropped; the JSDoc says so, as `plan:site-architecture/seo-structured-data-editor` already decided for its writes.
    - The write now passes the collab gate, as the Page panel's other frontmatter rows (`transactDoc(tab, (t) => mutateUpdateFrontmatter(…))` in the same file) already do.
12. `src/collab/collab-session.ts`, detach. Replace the inline re-base after `setHistoryDelegate(tab, null)` with `rebaseHistory(tab)`. The outbound-frontmatter comment ("mutateUpdateFrontmatter bypasses transactDoc, so watch the map deeply") becomes the reason that stays true: frontmatter ops are not doc ops and never reach `publishRecord`.
13. `src/store.ts`, comments only: the header names `store.ts` and `state.ts` instead of "Store.js" and "state.js re-exports", and the banner reads "Re-exports from state.ts". `plan:studio-ui-guidelines/retire-renderer-registry` edits the render-orchestration block of the same file; neither waits on the other.

**Integration contract.** Once this lands, a plan that requires it may rely on the following.

- `src/tabs/transact.ts` exports `rebaseHistory`, `reloadDocument` and `mutateReplaceDocument`.
- `tab.history.snapshots[0]` is always a checkpoint.
- Outside `src/tabs/transact.ts`, nothing assigns a tab's document root or frontmatter object, and `tests/document-writers.test.ts` holds that.
- A batch holds only its own tab, in history and in collab's publish, and pushes nothing when it wrote nothing. A transaction whose ops changed nothing pushes no entry.
- `studio-ui-guidelines.md` §9.1 is Implemented, headed "Transactions", and reads "A tab's document is written only inside a transaction". `plan:studio-ui-guidelines/conventions-checklist` rewrites §10's item "State mutations are immutable (produce new objects)" to that rule; this plan removes §9.1's clause from §10's marker itself (Specs & docs). Its prerequisite table and its §10 rewrite quote that sentence as written here; if review changes the §9.1 wording, the landed text wins and that plan follows it.
- `plan:ai/harness-phase-1#J1.13` is in an active plan, which cannot require this one and is not edited here, so its slice owner reads the coupling here. If this lands first, J1.13 (whose spec step names only `studio.md` §3.3) must also amend §9.2's batch bullet in place (to lanes, one segment per tab, entries tagged with the actor). Its segments must push through `appendEntry`, or the cap's promotion is lost again; its owner-only collab buffering replaces the `batchTab()` test in `publishRecord`; and it swaps `rebaseHistory`'s `_batchWrote` reset for its lane equivalent. `recordChanged` stays in front of every push, a segment's included. If J1.13 lands first, step 2 skips its batch half, and §9.2's batch bullet (Specs & docs) describes J1.13's lanes as they shipped rather than `beginBatch` / `endBatch`.
- `plan:desktop/component-scope-sections` finds no `pushDocument()` in `studio.md` §3.3, and cites §14.3 for its withdrawal.

## Tests

`packages/studio`: `cd packages/studio && bun test --isolate --coverage`. `bunfig.toml` gates `lines = 0.958, functions = 0.941` per file. No new `src` file, so `bun scripts/check-coverage-manifest.ts packages/studio` sees nothing new. Every new export and branch is exercised below, so `transact.ts` and the changed callers (`canvas-render.ts`, `files.ts`, `project-config.ts`, `head-panel.ts`, `collab-session.ts`) keep their figures. Ratchet `coverageThreshold` only if the workspace's worst file rises.

- `tests/transact-gaps.test.ts`, "endBatch at the history limit": keep the length case and add three.
  - "the base an overflowing batch leaves is a checkpoint": `snapshots[0].document` is not null.
  - "an edit after an overflowing batch is recorded and marks the tab dirty": clear `dirty`, edit, expect no throw, length still 100, `dirty` true.
  - "undo walks back through the batch and redo returns": record the document after each step, undo to index 0, redo to the end, compare.
- `tests/transact-seams.test.ts`, "batch end hook":
  - "an edit to another tab during a batch is that tab's own entry": B's length rises by one and `undo(B)` reverts it, while A still closes to one entry.
  - "a batch that wrote nothing pushes no entry and still notifies".
  - "a reload inside a batch leaves the batch only what it wrote afterwards". The existing "notifier fires … `toHaveLength(2)`" case stays green, because that batch wrote.
- `tests/collab-session-gaps.test.ts`, "batch publishing": "a co-edited tab outside the open batch publishes at once": `openCollabTab(hub)`, `beginBatch` on a plain `createTab` tab, edit the co-edited one, settle, and `serverJson(hub)` has the edit before `endBatch()`. Today it has not.
- `tests/transact-history.test.ts`, new describe "an entry that changes nothing":
  - "writing back the value a key holds pushes no entry": the same `textContent` twice gives one entry; the tab is still dirty.
  - "reordering an object's keys is a change": a `mutateReplaceStyle` with the same properties in another order pushes an entry.
  - "an unrecorded write still pushes a checkpoint": a direct assignment inside `transactDoc` gives an entry whose `document` is set.
  - Any existing case that counted an entry for a write of an unchanged value is updated in the same pull request, with the reason in its comment.
- `tests/transact-history.test.ts`, new describe "a reload re-bases the history":
  - "reloadDocument leaves one clean checkpoint": length 1, index 0, `canUndo` false, `dirty` false, frontmatter replaced.
  - "undo after a reload never writes into the reloaded tree": the census scenario (edit `children/0`, reload a document without that child). `canUndo` is false and `undo` changes nothing.
  - "an edit after a reload undoes to the reloaded document".
- `tests/transact-history.test.ts`, new describe "mutateReplaceDocument":
  - "one entry; undo and redo restore each side byte for byte": compared with `JSON.stringify`, so key order counts. The replacement reorders root keys and a nested object's keys.
  - "frontmatter rides the same entry, verbatim": `title` changes, `draft: false` is added, `summary: ""` is kept, and undo restores the old keys in the old order.
  - "the debug consistency check stays silent across a replacement": with `jx-canvas-debug` set, spy on `console.error` through undo and redo.
  - In "randomized undo/redo equivalence", `randomEdit` gains an eighth kind, a `mutateReplaceDocument` of a shuffled-key copy with one child changed, so every seed crosses checkpoints with it.
- `tests/canvas-render.test.ts`, "source mode":
  - "debounced edits sync valid JSON back into the document" also asserts one new entry, that `undo(tab)` restores `tagName` `"div"`, and that `redo` gives `"main"`.
  - "format documents serialize to source and parse edits back" also asserts that undo restores the document and the old frontmatter.
  - New: "a commit the gate refuses leaves the buffer typed and the document alone": `setTransactGate(() => "frozen")`, reset in `finally`.
  - New: "a commit that parses to the same document pushes no entry".
- `tests/files.test.ts`, "reloadFileInTab": "a reload re-bases the tab's history" (edit, reload, one entry, `canUndo` false).
- `tests/project-config.test.ts`, "adoptProjectConfig": "adoption re-bases the configuration tab's history".
- `tests/context-head-pane-diff-gaps.test.ts`, "applyContentMutation":
  - "the commit is one undo step": the title goes from Old to New, one new entry, and `undo` restores Old.
  - "a commit that changes nothing records nothing and leaves the tab clean".
- New `tests/document-writers.test.ts` (no DOM). It blanks comments as `withoutComments` in `tests/run-reported.test.ts` does, then scans `src/**/*.ts` for `/\.doc\.document\s*=(?!=)/` and `/\.doc\.content\.frontmatter\s*=(?!=)/`.
  - One case: the only permitted file is `tabs/transact.ts`.
  - A second case fails if that allowance stops matching.
- `tests/agent-trace.test.ts`: a turn that applied no write no longer adds an entry, and a reload during a turn now re-bases. Re-record with `JX_UPDATE_GOLDENS=1 bun test --isolate tests/agent-trace.test.ts`. Each golden records one `historyIndex` for the tab it settles, so the only permitted diffs are lower values there, each explained in the pull request by the empty batches and re-bases in that trace.
- Collab detach is already covered by `tests/collab-session.test.ts` and `tests/collab-undo.test.ts`, which must stay green through `rebaseHistory`.

## Specs & docs

**`studio.md` §3.2**: the diagram becomes

```
file ──parse──▶ tab.doc.document ──effects──▶ Canvas (runtime render), panels
                      ▲
                      │ transactDoc: mutators write in place, record ops,
                      │ push a history entry, replace the root reference
                      │
       Canvas · Outline · Inspector · assistant

tab.doc.document ──serialize (⌘S)──▶ file
```

**`studio.md` §3.3**, in place, heading kept.

- Marker: `> **Status: Implemented.** packages/studio/src/tabs/transact.ts (transactions, mutators, history), src/tabs/tab.ts (the tab and its seeded history), src/state.ts (path utilities and projectState); packages/studio/tests/transact-history.test.ts, tests/transact-batch.test.ts, tests/transact-gaps.test.ts.` (paths in backticks).
- The opening sentence becomes: "A document belongs to a tab (§14.1). Every surface reads the tab's one reactive tree, `tab.doc.document`. It is edited in place, inside a transaction (`studio-ui-guidelines.md` §9.1). Mutators write nested keys directly and record each change as a forward and inverse op pair, and the transaction then replaces only the root reference, so every effect that read the document re-runs while unchanged subtrees keep their identity. Each tab keeps its own history of at most 100 entries, with a whole-document checkpoint every 20th (`studio-ui-guidelines.md` §9.2)."
- The table becomes "Part | Entry points | Module" with eight rows:
  - Document: `tab.doc.document`, `tab.doc.content.frontmatter`, built by `createTab`, in `src/tabs/tab.ts`.
  - Transaction: `transactDoc(tab, fn, { skipHistory?, origin?, coalesceKey? })` → `boolean`, and `transact(tab, fn, opts?)`.
  - Mutators: `mutate*(tab, …)`, "the module's exports are the list".
  - History: `undo(tab)`, `redo(tab)`, `canUndo(tab)`, `canRedo(tab)`, `beginBatch(tab)` / `endBatch()`, `setHistoryDelegate(tab, delegate)`.
  - Reload: `reloadDocument(tab, document, frontmatter?)` and `rebaseHistory(tab)`.
  - Selection and hover: `tab.session.selection` (a `JxPath[]`, §6.7) and `tab.session.hover`, in `src/tabs/selection.ts`.
  - Path utilities: `getNodeAtPath`, `childList`, `flattenTree`, `pathsEqual`, `isAncestor`, in `src/state.ts`.
  - Project state: `projectState` / `setProjectState` / `requireProjectState`, in `src/state.ts`.

  The Transaction, Mutators, History and Reload rows are in `src/tabs/transact.ts`.

- Closing sentence: "`state.js`'s single-document store is gone, and with it `createState`, `selectNode`, `hoverNode`, `pushDocument` and `popDocument`. A tab is created by `createTab`, selection and hover are fields of its session, and the document stack was withdrawn (§14.3)."

**`studio-ui-guidelines.md` §9.1**, heading "### 9.1 Transactions".

- Marker: `> **Status: Implemented.** packages/studio/src/tabs/transact.ts; packages/studio/tests/transact.test.ts, tests/transact-batch.test.ts, tests/transact-history.test.ts, tests/document-writers.test.ts.`
- The rule paragraph: "**A tab's document is written only inside a transaction.** `transactDoc(tab, fn)` runs `fn` against the live document while a recorder listens. The `mutate*` helpers are how a transaction records what it writes: they write nested keys and splice children in place, and record a forward and inverse op pair for each change. A transaction may also assign keys directly; nothing is recorded then, so its history entry holds the whole document (§9.2). When `fn` returns, the transaction replaces the document's root reference, pushes one history entry unless nothing changed (§9.2), marks the tab dirty and tells the collaboration bridge. The nested objects stay shared, because the writes already changed them. The fresh root is what the canvas and the panels follow, and what the assistant's undo witness reads (§12.4)."
- Five bullets:
  - "**All of it or none of it.** A mutation that throws is rolled back from the inverses it recorded (document, frontmatter, selection, dirty flag), and the error is rethrown."
  - "**A transaction can be refused.** `transactDoc` returns `false` when there is no tab or a gate refuses it (the collaboration freeze, `collab.md` §4). The document is then exactly as it was, and a caller that settles a buffer or reports success checks the answer."
  - "**The Code view commits a transaction too.** Its debounced commit replaces the document's keys with the parsed text's, in the text's key order, through `mutateReplaceDocument`, so a hand edit is one entry like any other."
  - "**Writing outside a transaction is the defect.** A mutator called outside one changes the tree with nothing recorded and no new root, so undo, the collaboration bridge and every effect that follows the root miss it. `tests/document-writers.test.ts` refuses a root or frontmatter assignment anywhere but `src/tabs/transact.ts`."
  - "**A reload is not an edit.** When the file under a tab with no collaboration session changes (another program, the assistant's file write, a grid save, a rename's reference rewrite), `reloadDocument` replaces the document and re-bases the tab's history on it, as opening the file does. `project.json` adopted from the assistant's write is replaced in a transaction that pushes no entry and then re-based the same way (`rebaseHistory`). The entries before a reload describe a tree that is gone."
- The example becomes a `ts` block:

  ```ts
  import { mutateUpdateStyle, transactDoc } from "../tabs/transact";

  // Correct: one transaction; the mutator writes in place and records its inverse.
  const applied = transactDoc(tab, (t) => mutateUpdateStyle(t, path, prop, value));
  if (!applied) {
    // Refused: the document is exactly as it was.
  }

  // Wrong: no history entry, no dirty mark, and the canvas, which follows the root, never redraws.
  tab.doc.document.children[0].style.color = "red";
  ```

**`studio-ui-guidelines.md` §9.2**, in place.

- Marker: `> **Status: Implemented.** packages/studio/src/tabs/transact.ts; packages/studio/tests/transact-history.test.ts, tests/transact-batch.test.ts, tests/transact-gaps.test.ts, tests/transact-seams.test.ts, tests/collab-undo.test.ts, tests/collab-session-gaps.test.ts.`
- The three bullets become seven. The batch has its own bullet so that a later change can amend it in place.
  - "One linear stack per tab, at most 100 entries. Past the cap the oldest entry is dropped, and the entry that becomes the oldest is made a checkpoint first, so every state still in the stack can be rebuilt."
  - "An **entry** records one transaction: its forward and inverse ops, its frontmatter changes, and the selection before and after it. `undo(tab)` replays the inverses and restores the selection before; `redo(tab)` replays the forwards. A replay the gate refuses (§9.1) moves nothing. A transaction that changed nothing, because every op wrote back the value it found, pushes no entry."
  - "A **checkpoint** is an entry that also holds the whole document: the tab's first entry, every 20th, one whose transaction recorded no ops, and a batch's. A state between checkpoints is rebuilt from the nearest one before it and the forward ops after it."
  - "A structural command over a selection is one transaction, and so one entry (`studio.md` §6.7). Successive transactions that pass the same `coalesceKey` fold into one entry, whose inverse still restores the state before the first of them."
  - "A **batch**, `beginBatch(tab)` to `endBatch()` (an assistant turn, closed and reopened when the turn moves to another tab), is one entry on its tab. The transactions inside it push none of their own, and `endBatch` pushes one checkpoint of `{ document, selection }`, or nothing when the batch wrote nothing. Only the batch's tab is held: an edit to another tab meanwhile is that tab's own entry, and a co-edited one is published at once."
  - "A tab attached to a collaboration session hands undo and redo to the session's undo manager, which tracks only local-origin edits (`collab.md` §3). `project.json` never has one (`studio.md` §17.1)."
  - "`undo(tab)`, `redo(tab)`, `canUndo(tab)` and `canRedo(tab)` live in `src/tabs/transact.ts`."
- Both paragraphs after the bullets are unchanged.

**`studio-ui-guidelines.md` §10's marker**, in place (a rider; §10 stays Partial under `plan:studio-ui-guidelines/conventions-checklist`, per the audit record's rule that each owner removes its own clause): delete the sentence ""State mutations are immutable (produce new objects)" inherits §9.1's divergence: `transactDoc` and the `mutate*` helpers mutate in place and replace only the root reference." and lower the count in "Five inherit a section's open item." by one (recount: other owners delete their clauses as they land). The checklist item itself is that plan's.

**Fragments**

- `bun run spec:change studio.md minor -m "§3.3 states the state model that ships: a tab owns its document, edits run in place inside a recording transaction, and each tab keeps its own history; §3.2's data flow loses the immutable store"`
- `bun run spec:change studio-ui-guidelines.md minor -m "§9.1 and §9.2 state the transaction and history contract: a tab's document is written only inside transactDoc, mutators record forward and inverse ops with periodic checkpoints, the Code view commits as an entry, a reload re-bases the history, a write that changes nothing adds no entry, and a batch holds only its own tab and only when it wrote"`

**Docs** (no em dashes). No page cites `studio.md#3.3`, `studio-ui-guidelines.md#9.1` or `#9.2` in its `spec:`. The pages below are the ones `docs:sync` names through `code:` (`files.ts`, `tab.ts`, `project-config.ts`, `canvas-render.ts`, `head-panel.ts`, `collab-session.ts`, `store.ts`), plus the assistant page that describes reloads.

- `docs/studio/interface/tabs.md`: after "Undo and redo are per document as well: each keeps its own history, so :kbd[⌘Z] in one never unwinds work in another.", add: "A document you have not changed that changes on disk (edited by another program, rewritten by the assistant, or updated by a rename that moved its links) reloads in its tab, and its history starts again from what the file now says."
- `docs/studio/ai/chat.md`, "Review and undo edits": "the tab refreshes to show the new contents" gains ", and its undo history starts again from them".
- `docs/studio/projects/settings.md`: after "When the [assistant](/docs/studio/ai/chat) rewrites `project.json`, the layout it wrote is the one the next settings change keeps.", add: "Its rewrite is not an undo step: the tab's history starts again from what it wrote."
- `docs/studio/logic/code.md`: after "Edits parse back into the document as you type, so switching back to **Edit** or **Design** shows your changes.", add: "Each pause that changes the document is one step in its undo history, so :kbd[⌘Z] after you switch back steps back through what you typed, one pause at a time." Its "one undo stack" for `project.json` becomes true.
- `docs/studio/interface/modes.md`, `docs/studio/design/stylebook.md`, `docs/studio/projects/settings.md`'s two "one undo history" sentences: no change; they become true.
- `docs/studio/editing/frontmatter.md`, `docs/studio/editing.md`, `docs/studio/design.md`, `docs/studio/interface.md`, `docs/studio/publish/collaboration.md`, `docs/studio/design/states-and-selectors.md` (through `store.ts`): named by `docs:sync`; none makes a claim this plan changes.

Neither spec graduates, because both keep other open items. Landing deletes this file and removes `_shared/studio-state-contract` from `plan:studio-ui-guidelines/conventions-checklist`'s `requires`.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass.
- `bun run plans:status --spec studio` no longer lists §3.3, and `--spec studio-ui-guidelines` lists neither §9.1 nor §9.2.
- `git grep -nE '\.doc\.(document|content\.frontmatter)\s*=[^=]' packages/studio/src` lists only `src/tabs/transact.ts`.
- In a dev Studio (`packages/studio:verify`), four checks:
  - Make an Inspector edit, then change a key's text in Code view. Leave Code, press ⌘Z twice: the Code change goes, then the Inspector edit.
  - With the page clean, edit its file on disk: the tab reloads and Undo is disabled with "a change to undo".
  - On a Markdown page, change the title in the Page panel: ⌘Z restores it.
  - On a page with nothing to undo, ask the assistant a question that edits nothing: Undo stays disabled.
