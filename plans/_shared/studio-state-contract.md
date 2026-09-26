---
status: stub
disposition: implement
claims:
  - studio.md#3.3
  - studio-ui-guidelines.md#9.1
  - studio-ui-guidelines.md#9.2
size: M
workspaces:
  - packages/studio
---

# Both specs state one transaction contract for a tab's document, and every write and history entry in Studio keeps it

## Context

The census stubbed `studio.md` §3.3 and `studio-ui-guidelines.md` §9.1 and §9.2 as two plans. Both rewrite the contract of one module, `packages/studio/src/tabs/transact.ts`, and each named the other as a merge candidate. The cross-spec review merged them so that the two specs describe the module in one vocabulary. §9.1 and §9.2 travel together because §9.2's op-based entries exist only because §9.1's in-place mutation runs under a recorder, so the two sections change together to stay consistent.

`specs/studio.md` §3.3, line 59 (the section was unmarked before the census):

> **Status: Partial.** Only the 100-entry history limit and `projectState` / `setProjectState` hold. Documents belong to a tab and are edited in place inside `transactDoc()` (`packages/studio/src/tabs/transact.ts`), which records forward and inverse doc-op pairs with a checkpoint every 20 entries; the operations are `mutate*(tab, …)` with `undo(tab)` / `redo(tab)`, selection lives in `tab.session.selection`, and none of `createState`, `selectNode`, `hoverNode`, `pushDocument`, `popDocument` or a `state.js` exists (`packages/studio/src/state.ts` holds path utilities and `projectState` only).

It qualifies "Immutable state with undo/redo history (100 entries). All mutations produce a new state object — no in-place edits." and a 21-row "Key state operations (from `state.js`)" table.

`specs/studio-ui-guidelines.md` §9.1, line 574:

> **Status: Partial.** Documents are mutated in place inside a transaction: `transactDoc` (`packages/studio/src/tabs/transact.ts`) runs the mutation against the live document, records forward and inverse ops and replaces only the root reference, and the `mutate*` helpers write nested keys directly. `store.ts` exports no `update()`, and there is no `updateStyle(S, …)`.

It qualifies "All mutations produce a new state object. Never modify state in place." and an example calling `update(updateStyle(S, path, prop, value))` imported from `../store`.

`specs/studio-ui-guidelines.md` §9.2, line 590:

> **Status: Partial.** The per-tab linear stack capped at 100, `project.json` as a tab, one entry per batch and the full rollback of a failed write ship (`packages/studio/src/tabs/transact.ts`, `tests/transact-history.test.ts`). Entries are not `{ document, selection }` snapshots: they carry forward and inverse ops with the selection before and after, plus a document checkpoint every 20th entry, and `undo(tab)` / `redo(tab)` live in `src/tabs/transact.ts`, not in `src/state.ts`.

It qualifies the bullets "Each entry snapshots `{ document, selection }`" and "`undo()` / `redo()` from `state.js`".

Disposition `implement`, where both census stubs had `reconcile`. The text half is a reconcile, and the reasons for that hold. Studio moved from a flat, immutable store to per-tab documents on purpose: the reactive-state migration removed `createState`, the flat-state bridge and the document stack (`studio.md` §14.3 records the stack's withdrawal), so §3.3's API table is a fossil. In-place mutation under a recording transaction is the design, not a lapse. The root reference is still replaced on every applied transaction, which the reactive layer and the assistant's undo witness depend on (`studio-ui-guidelines.md` §12.4: "an unchanged reference after `run` answers 'changed nothing'"). Patch-based history is the default the module chose over "full-snapshot-per-edit legacy behavior", which it keeps only as an opt-out flag. But the three sections cannot flip on text alone. Re-checking the code for this merge found two places where the rule §9.1 and §9.2 state is not what the code does: the cap's batch path breaks history, and two writers replace the root outside any transaction (both under **What is missing**). Both need code in `packages/studio`. The contract allows splitting when parts have different dispositions. If detailing wants the text to land first (it is all `plan:studio-ui-guidelines/conventions-checklist` waits for), the code half can become its own plan that this one requires, and this plan goes back to `reconcile`.

**What exists**

- `transactDoc(tab, mutationFn, { skipHistory, origin, coalesceKey })` in `packages/studio/src/tabs/transact.ts`:
  - It runs the mutation against the live `tab.doc.document` between `beginRecording()` and `endRecording()` (`src/tabs/patch-ops.ts`).
  - It then replaces only the root (`const newRef = { ...raw }`, under the comment "Nested objects are shared — the mutation already modified them in place"), pushes a history entry, marks the tab dirty, and calls the transact observer (collab).
  - It returns `false` when there is no tab or when `setTransactGate`'s gate refuses (the collab source-canonical freeze).
  - A mutation that throws is rolled back from its recorded inverses (`rollbackFailedTransaction`), including frontmatter, selection and the dirty flag, and then the error is rethrown.
  - `transact(tab, fn)` does the same with the document as the argument. `applyExternalDocOps` applies a peer's ops with `origin: "remote"` and no history entry.
- The mutators: 26 exported `mutate*(tab, …)` helpers. They include `mutateInsertNode`, `mutateRemoveNode`, `mutateDuplicateNode`, `mutateRemoveNodes`, `mutateDuplicateNodes`, `mutateWrapNode`, `mutateMoveNode(tab, fromPath, toParentPath, toIndex)`, `mutateUpdateProperty`, `mutateUpdateStyle`, `mutateUpdateAttribute`, `mutateUpdateMediaStyle`, `mutateUpdateNestedStyle`, `mutateReplaceStyle`, `mutateAddDef`, `mutateRemoveDef`, `mutateUpdateDef`, `mutateRenameDef`, `mutateAddSwitchCase`, `mutateRemoveSwitchCase`, `mutateRenameSwitchCase` and `mutateUpdateFrontmatter`.
  - They write nested keys and splice children directly, and record forward and inverse doc-op pairs.
  - They open no transaction of their own. `recordDocOp` and `recordPatch` are no-ops outside one, so a mutator called outside `transactDoc` changes the tree with nothing recorded and no root replacement. The production callers checked all wrap it: `transactDoc(tab, (t) => mutateUpdateStyle(t, …))`.
  - One census stub's proposed rule, "written only inside `transactDoc` or a `mutate*` helper", is therefore one condition, not two.
- History: `HISTORY_LIMIT = 100` and `CHECKPOINT_INTERVAL = 20`.
  - `pushHistoryEntry` stores `forwardOps`, `inverseOps`, `fmOps`, `selectionBefore` and `selection`.
  - It stores a full `document` checkpoint when `truncated.length % 20 === 0`. It also stores one whenever ops cannot be used: the transaction was marked non-invertible (`markNonInvertible`), it recorded no ops (un-instrumented), or the `jx-legacy-history` localStorage flag forces the legacy behaviour.
  - Successive commits with the same `coalesceKey` fold into one entry. `src/editor/inline-edit-apply.ts` uses this so that a typing run is one undo step.
  - On overflow it promotes the new base to a checkpoint (`materializeState`) before dropping the old one.
  - `undo(tab)` and `redo(tab)` replay inverse or forward ops through `transactDoc` with `origin: "history"`, or restore a materialized checkpoint. A refused replay leaves the index where it is.
- Batches: two mechanisms share the word.
  - A multi-node mutator (`mutateRemoveNodes`, `mutateDuplicateNodes`, over `structuralBatch` in `src/tabs/selection.ts`) is one transaction and one op entry.
  - `beginBatch(tab)` and `endBatch()` are called by `services/tool-executor.ts` (the assistant's turn) and `services/project-adoption.ts`. They suspend per-transaction entries and push one entry that holds a full `{ document, selection }` snapshot. That is the only place where §9.2's "Each entry snapshots `{ document, selection }`" is still literally true.
- Under collab, `setHistoryDelegate` routes undo and redo to the session's `Y.UndoManager` and bypasses the per-tab stack (`collab.md` §3, "Undo is origin-scoped"). `endBatch` pushes nothing for a delegated tab, and `project.json` never gets a delegate (`studio.md` §17.1).
- Naming: the history lives in `tab.history.snapshots`, typed `HistorySnapshot` (`src/tabs/tab.ts`). Its `document` is null on every entry that is not a checkpoint, so the names still say "snapshot" for what is usually an op pair. `createTab` seeds the history with one checkpoint of the opened document.
- `src/tabs/patch-ops.ts` and `src/tabs/doc-op-apply.ts`: the doc-op pairs that history records, and how they are applied. `src/tabs/project-config.ts`: `project.json` as a tab, edited through the same transactions.
- `src/state.ts`: `JxPath` and the tree utilities (`getNodeAtPath`, `childList`, `flattenTree`, `pathsEqual`, `isAncestor`, …), plus `projectState` / `setProjectState` / `requireProjectState`. It has no `createState`, `selectNode`, `hoverNode`, `pushDocument` or `popDocument`, and there is no `state.js`. Selection is `tab.session.selection`, a `JxPath[]` (`studio.md` §6.7), and hover is `tab.session.hover`.
- `src/store.ts` exports no `update()`, and there is no `updateStyle(S, …)`. Its header still introduces it as "Store.js — Shared state hub" with "state.js re-exports", and it re-exports `state.ts`'s path utilities and `projectState`.
- Tests:
  - `tests/transact-history.test.ts`: coalescing, the refusing gate, op entries against snapshots, the legacy flag, randomized undo/redo equivalence, and truncation past the limit (through ordinary edits only).
  - `tests/transact-batch.test.ts`: one entry per multi-node batch, and the full rollback of a throwing mutation, including frontmatter and the dirty flag.
  - `transact.test.ts`, `transact-gaps.test.ts`, `transact-patch.test.ts`, `transact-seams.test.ts`, `collab-transact.test.ts` and `collab-undo.test.ts`.

**What is missing**

- `studio.md` §3.3 rewritten in place: documents are owned by a tab and mutated in place inside one transaction that records forward and inverse ops; checkpoints; the history limit; and the real operation names and signatures. The table maps each fossil row to what replaced it, or to its withdrawal (`pushDocument` / `popDocument`, §14.3).
- `studio.md` §3.2's data-flow diagram corrected in the same change. It still reads "Studio state (immutable)" and "mutation → new state".
- `studio-ui-guidelines.md` §9.1 rewritten from "never modify state in place" to the rule the code keeps: a tab's document is written only by mutators running inside `transactDoc`, which records the inverse and replaces the root reference. Writing outside a transaction is the defect, and a transaction can be refused (it returns `false`). The example uses the real API.
- §9.2's second and third bullets rewritten. Entries carry ops and both selections. A checkpoint is taken every 20th entry, and whenever ops cannot describe the transaction. A `beginBatch` / `endBatch` bracket stores a snapshot. A coalesced run is one entry. A collab tab delegates to its undo manager. `undo(tab)` and `redo(tab)` live in `src/tabs/transact.ts`.
- One vocabulary for both specs, decided once and used in both rewrites. It covers transaction, mutator, entry and checkpoint, and which of the two mechanisms "batch" names. Detailing also decides whether `HistorySnapshot` and `tab.history.snapshots` are renamed to match.
- **The cap breaks on the batch path.** `endBatch` drops the base entry on overflow without promoting the new base to a checkpoint, which `pushHistoryEntry` does. A scratch run (a fake tab against the real `transact.ts`) showed the sequence:
  - 99 ordinary edits fill the stack to 100.
  - One `beginBatch` / `endBatch` pushes the 101st entry and leaves a base with no checkpoint.
  - From then on, every ordinary edit is applied to the document and then throws `history-missing-checkpoint` out of `pushHistoryEntry`. The throw comes after the root is replaced and before the dirty mark and the observer run. Five further edits all threw, and a tab that was clean stayed clean.
  - One undo then went back past all five, and past the batch, to the state before the batch.

  §9.2's own paragraph rules this out: "A change the author can see but cannot undo or save is worse than a refused change." The assistant's turns are the batch's main caller, so a long session reaches it. No test covers overflow through `endBatch`.

- **Two writers replace the root outside any transaction:**
  - `mountSourceEditor`'s buffer commit in `src/canvas/canvas-render.ts` (`BUFFER_COMMIT`, 600ms, taken only when no collab session is attached) assigns the reparsed source to `tab.doc.document` and marks the tab dirty.
  - `reloadFileInTab` in `src/files/files.ts` does the same for a clean tab whose file changed on disk.

  Neither pushes an entry or touches `tab.history`, so the log goes on describing a tree that is gone. A scratch run performed the same assignment after one ordinary edit. When the source change deleted the first child, the next undo wrote the old text into the node that now sits at `children/0`. When the source edit kept the same shape, it was out of undo's reach. For each writer, detailing chooses between routing it through `transactDoc` as a checkpoint entry and resetting the history, and the §9.1 rewrite names the choice.

- Tests for both defects: overflow through `endBatch`, and undo after each out-of-transaction writer.

**Related**

- `studio.md` §6.7 (selection is a `JxPath[]`), §14.3 (the withdrawn document stack), and §17 and §17.1 (project documents are tabs under the same transaction log). `collab.md` §3 covers the undo delegate.
- `studio-ui-guidelines.md` §8.1 (a structural command over a selection is one transaction) and §12.4 (the undo witness that the root replacement serves).
- `studio-ui-guidelines.md` §10's "State mutations are immutable (produce new objects)" restates §9.1. §10's other four open items inherit from other sections, so `plan:studio-ui-guidelines/conventions-checklist` owns §10 and requires this plan. This plan does not edit §10.
- `plan:studio-ui-guidelines/retire-renderer-registry` rewrites the same `store.ts` / `transact.ts` neighbourhood:
  - It removes the renderer registry from `src/store.ts`, the module that §3.3's table and §9.1's example still present as the state hub.
  - Its RR1.3 deletes the Navigator repaints that `panels/dnd.ts` and `panels/editors.ts` make after writing through `transactDoc`.
  - It is the remainder of the legacy-state migration whose earlier phases removed `createState` and the flat-state bridge.
  - It edits §9.3, directly after the two sections this plan rewrites.

  Whichever lands second re-reads the other's text. Neither waits on the other.

- `plan:ai/harness-phase-1#J1.13` (per-actor lanes) replaces `beginBatch`, `endBatch` and `batchTab` with a `BatchLane`. Its segments push ops-based entries tagged `{ actor, turnId }`, it adds `TransactOptions.actor`, and it lists a `studio.md` §3.3 minor edit of its own. That changes the entry shape and the batch mechanism described in §9.2 and §3.3, and it would retire `endBatch`'s overflow branch. There is deliberately no `requires` edge: that plan is size L and active, and an edge would hold this one until the whole program lands. Word the batch sentences so that J1.13 can amend them in place, and fix the overflow here unless J1.13 has already landed.
