---
status: drafted
disposition: implement
claims:
  - collab.md#3.1
requires: []
workspaces:
  - packages/collab
  - packages/studio
size: M
---

# Every write to the shared document keeps §3.1's granularity, so concurrent edits merge wherever the table says they do

## Context

`specs/collab.md` §3.1, line 63:

> **Status: Partial.** Every node below the root is converted as tabled (`toYNode` and `toYChildren` in `packages/collab/src/schema.ts`, covered by `packages/collab/tests/granular-merge.test.ts`), but three write paths lose the table's outcomes. The root: `seedStructure` (`schema.ts`) and `replaceYStructure` (`packages/collab/src/diff.ts`) write each root key other than `children` as a whole-JSON value, so the root's `textContent`, `style`, `attributes` and `$props` last-writer-win until the op bridge's `setNodeKey` first replaces them, and again after every `replaceYStructure`. `children`: `setNodeKey` (`packages/collab/src/op-bridge.ts`) replaces the `Y.Array` and every `Y.Text` in it on a `set-key` of `children`, the op each inline rich-text commit records (`packages/studio/src/editor/inline-edit-apply.ts`), so bare-string children and elements merge per character and per element only through `set-child`, `insert-child` and `remove-child`. The fallback: `publishDiff` (`packages/studio/src/collab/collab-session.ts`) calls `replaceYStructure`, which rebuilds the whole tree and orphans every concurrent edit, whenever `diffDocs` exceeds its 500-op limit or an op fails to apply.

Re-read against the tree on 2026-09-27; every claim holds.

- **One rule, three copies.** `toYNode` (`schema.ts`) applies the table per key: `children` array to `toYChildren`, a `TEXT_KEYS` string to `Y.Text`, a `GRANULAR_OBJECT_KEYS` object to `toYObject`, anything else `cloneJson`. `seedStructure` and `replaceYStructure` each re-implement only the `children` branch and `cloneJson` the rest into `structureMap(doc)`, which is the root node's `Y.Map`. `setNodeKey` diffs text (`applyTextEdit`) and granular objects (`mergeYObject`) onto an existing container, and writes `children` with `node.set(key, toYChildren(value))`, so the root self-heals per key on its first `set-key` and `children` never does.
- **Rich commits replace.** `applyInlineCommit`, `applyBlockMerge`, `applyInlineSplit`, `applyInlineInsert` and `applyRangeReplace` record `mutateUpdateProperty(t, path, "children", …)`, a whole-value `set-key`; `publishRecord` forwards it to `applyDocOpsToY`. Two concurrent commits to one paragraph set two fresh `Y.Array`s under one key and Yjs keeps one, which is the census reviewer's repro (`"Hello "`, a `strong`, `" end"`: one author's edit lost, the same edits as `set-child` both kept).
- **The fallback.** `publishDiff` falls back to `replaceYStructure(…, LOCAL_ORIGIN)` when `diffDocs` (`diff-core.ts`, `DEFAULT_MAX_OPS = 500`) returns `null` or `applyDocOpsToY` throws; `onBatchEnd` reaches it too. `sourceParseNow` makes the same two calls under `MIRROR_ORIGIN` while structure edits are frozen by the source-canonical lock, so it orphans nothing but still resets the root to whole values.
- **Tests.** `granular-merge.test.ts` roots every fixture at a `div` and edits `children/0`, and merges bare strings only through `set-child`. `diff.test.ts` "hard-replaces the tree and bumps canonicalRev" pins the replacement. `collab-session-gaps.test.ts` drives both fallbacks through a pass-through mock of `@jxsuite/collab` (`diffDocsImpl`, `applyDocOpsImpl`), and the mock hub in `collab-mock.ts` syncs synchronously, so no studio test has ever held two edits concurrent.

Found while detailing, and part of the same change:

- **Inbound shape.** Once `children` merges, a rich commit reaches peers as an array delta plus `Y.Text` events inside the same array. `yEventsToDocOps` returns `null` for that (its overlap guard and its one-array-event guard), and `collab-session.ts` answers `null` with `reconcileTabFromY`, a full reconcile of the peer's tab where today a replaced `children` key arrives as one `set-key`.
- **Moves.** `move-child` in `applyOneOp` re-inserts a moved node's JSON, and its comment calls the lost concurrent edit inside it a "documented v1 limitation". `mutateWrapNode` (`packages/studio/src/tabs/transact.ts`) records a wrap as a `set-child` of a new wrapper, which `set-child` answers by delete and insert, so a wrapped element is moved the same way. The spec does not document it, and §3's third bullet says the bridge never replaces a live container whose type is unchanged. `yjs` is pinned at 13.6.33, whose `Y.Array` has no move.
- **Stale descriptions.** `packages/collab/README.md` still describes schema version 1 ("Only `children` nests", "The CRDT granularity deliberately equals Studio's op-log granularity") and says `replaceYStructure` "hard-replaces". `docs/studio/publish/collaboration.md` says simultaneous edits to different parts of a file both land, which the three paths above make untrue.

**Related.** collab.md §3 (its third bullet is judged here, per the audit record; `plan:collab/epoch-continuity` requires this plan and deletes §3's marker after it), collab.md §5 (`COLLAB_SCHEMA_VERSION`, `plan:collab/room-schema-skew`).

## Outcome

- collab.md §3.1 → Implemented: the root, `children` and whole-document writes keep the table's granularity, with moved (including wrapped and unwrapped) and unpaired elements as the stated case where an element is still removed and reinserted. No Future remainder under the recommended answer to the Open decision.
- collab.md §3 stays Partial (the epoch invariant); the last sentence of its marker, which defers to §3.1, is deleted.

## Decisions

- **Decided:** one conversion rule and one diffing write, both in `schema.ts`: `toYNodeValue(key, value)` is `toYNode`'s per-key body, and `writeNodeKey` / `mergeYNode` / `mergeYChildren` write a value onto existing containers, falling back to `toYNodeValue` on a type change. `seedStructure` keeps whole-key sets of fresh containers (`toYNodeValue`, never `mergeYNode`), because the seeding bullet of §3 depends on never inserting into an array, and a fresh container per key under per-key last-writer-wins converges exactly as `children` already does.
- **Decided:** `children` aligns with `matchChildren` from `diff-core.ts`, with no cell budget, because a merge must reach the state `diffDocs` would have replayed, and `publishDiff`'s diff attempt already allocates the same table for the same arrays; a budget would bring replacement back on exactly the large pages the fallback exists for.
- **Decided:** `replaceYStructure` keeps its name, signature and `canonicalRev` bump and becomes `mergeYNode` on the root; `publishDiff`, `onBatchEnd` and `sourceParseNow` keep their shape (diff first, the whole-document write past 500 ops or on a throw), because once that write merges, the fallback orphans nothing and there is nothing to tell the author. The export is published (`index.ts`, pinned by `index.test.ts`), and keeping the bump leaves its only reader, `sourceParseNow`'s stale-parse check, behaving exactly as today.
- **Decided:** `writeNodeKey` skips a plain value equal to the stored one (`deepEqualJson`, as `mergeYObject` does), because a whole-document write re-setting an unchanged `tagName` or `state` would race a peer's concurrent change to that key and could restore the stale value. The skip requires the key to be present (`node.has(key)`), and `mergeYObject`'s skip gains the same guard, because `deepEqualJson` reads a missing key as `null` (`a ?? null`), so a new key whose value is `null` would otherwise never be written and the tree would silently lack a key the tab has.
- **Decided:** inbound events that all lie inside one node's `children` collapse to one `set-key children` for that node, and only where `yEventsToDocOps` returns `null` today, because §3 promises that granular events collapse back to one whole-value op for the owning key, and without it every rich commit that both splices the array and edits a surviving member (wrapping a word, bolding part of a run) becomes a full reconcile on every peer.
- **Decided:** no `COLLAB_SCHEMA_VERSION` bump and no subprotocol change, because what each key is stored as does not change (the §3.1 table already says it for the root): only write paths change, and every value either build writes is one the other reads through `yValueToJson`. A pre-fix client in the same room keeps today's last-writer-wins for its own writes, and its `yEventsToDocOps` answers a post-fix peer's merged rich commit with `null`, so it reconciles its whole tab where it would have patched one paragraph: a render cost, never a lost edit, and gone on reload. `plan:collab/room-schema-skew` is therefore not a prerequisite.
- **Open:** how §3.1 treats the case where a live element is still replaced: an element that moves (reordered, moved to another parent, wrapped or unwrapped, which `mutateWrapNode` records as a `set-child`) and an element the alignment cannot pair (its `tagName`, `attributes.id` or `$props.key` changed). Recommendation: state it as the contract in §3.1, point §3's third bullet at it, and say it in the user docs, because `Y.Array` in yjs 13.6.33 has no move, `weakKey` in `diff-core.ts` is the differ's own definition of the same element, and a "never" that moves break is the overclaim this census exists to remove. The alternative is a `> **Status: Future.**` remainder in §3.1 for keeping an element across a move (the `spec.md` §6.6 shape), which needs a move primitive `Y.Array` lacks or a different stored layout for `children`, and a layout change is a `COLLAB_SCHEMA_VERSION` question, not this plan's. The code and tests are the same under either answer; only the §3.1 paragraph, the §3 parenthetical and the docs sentence differ.

## Implementation

1. **`packages/collab/src/schema.ts`**
   - `import { matchChildren } from "./diff-core.ts"` (type-only imports there, so no cycle and `diff-core.ts` stays yjs-free).
   - `export function toYNodeValue(key: string, value: unknown): unknown`: the body of `toYNode`'s loop. `toYNode` calls it for each defined entry.
   - `export function writeNodeKey(node: Y.Map<unknown>, key: string, value: unknown): void`: `setNodeKey` moved here with its doc comment, plus two changes. A `children` array onto an existing `Y.Array` calls `mergeYChildren`; any other value equal to the stored one is skipped when `node.has(key) && deepEqualJson(node.get(key), value)`. Every replacement goes through `node.set(key, toYNodeValue(key, value))`.
   - `mergeYObject`: its skip becomes `map.has(key) && deepEqualJson(existing, entry)`, for the `null` reason in Decisions.
   - `export function mergeYNode(node: Y.Map<unknown>, value: Record<string, unknown>): void`: delete every key `value` lacks or holds as `undefined` (detached key list, as `mergeYObject` does), then `writeNodeKey` each defined entry.
   - `export function mergeYChildren(array: Y.Array<unknown>, next: readonly unknown[]): void`: `current = array.toArray().map(yValueToJson)`, `matches = matchChildren(current, next)`; delete unmatched indices in descending order; then walk `next` ascending, as `Differ.diffChildren` does: unmatched inserts `toYChild(next[i])` at `i`, an identical match is skipped, a `Y.Text` paired with a string takes `applyTextEdit`, a `Y.Map` paired with a plain object takes `mergeYNode`, and any other pairing (a plain item an older writer left in the array) is deleted and reinserted at `i`.
   - `seedStructure`: `structure.set(key, toYNodeValue(key, value))` for every defined key, dropping its private `children` branch. Its doc comment and the file header say that seed, bridge and whole-document write share `toYNodeValue`, and that every write but the seed diffs onto existing containers.
2. **`packages/collab/src/op-bridge.ts`**
   - Delete `setNodeKey` and its local `cloneJson` / `isPlainObject`; `applyOneOp`'s `set-key` calls `writeNodeKey`. Drop the imports that become unused (`mergeYObject`, `toYChildren`, `toYObject`); `set-child` keeps `applyTextEdit`, and its comment names `writeNodeKey`.
   - `function childrenOwner(paths: readonly JxPath[]): JxPath | null`: the deepest node path `P` such that every path starts with `[...P, "children"]`, or `null` when none does. From the longest common prefix `L`: walk `("children", number)` pairs from the start; if `L` continues with `"children"` after the last whole pair, `P` is the walked prefix; otherwise `P` is the walked prefix minus its last pair; `null` when no pair was walked and `L` does not start with `"children"`. So `["children", 1, "children"]` and `["children", 1, "children", 0, "textContent"]` give `["children", 1]`, `L = ["children", 0, "style"]` gives `[]`, and `L = []` or `["style"]` gives `null`.
   - `function collapseToChildren(events, paths): JxDocOp[] | null`: with `P = childrenOwner(paths)`, the doc from `events[0].target.doc` and `resolveYPath(doc, [...P, "children"])` a `Y.Array`, return `[{ key: "children", op: "set-key", path: P, value: yValueToJson(array) }]`; otherwise `null`.
   - `yEventsToDocOps`: the overlap guard and the one-array-event guard return `collapseToChildren(events, paths)` instead of `null`. Every shape converted today converts exactly as before. The function's doc comment and the file header say so.
   - `move-child`'s comment: the lost concurrent edit is the case collab.md §3.1 states, not a "documented v1 limitation".
3. **`packages/collab/src/diff.ts`**: `replaceYStructure` becomes `mergeYNode(structureMap(doc), document as Record<string, unknown>)` followed by the `canonicalRev` bump, inside the same `doc.transact(…, origin)`. Imports become `metaMap`, `mergeYNode`, `structureMap`. Its doc comment and the file header describe a whole-document write that keeps every container whose type is unchanged, used past `diffDocs`' limit. **`diff-core.ts`**, comments only: `DiffOptions.maxOps` and `diffDocs` say the caller writes the whole document by merge instead of hard-replacing, and the header names `schema.ts`'s `mergeYChildren` beside the studio caller as a user of `matchChildren`.
4. **`packages/collab/README.md`** (in the `docs:prose` corpus, so no em dashes): the `structure: Y.Map` row says prose is `Y.Text`, `style`/`attributes`/`$props` are nested `Y.Map`s and `children` is a `Y.Array`, with everything else merged whole; the paragraph claiming granularity equals the op log's is replaced by one saying the bridge diffs whole-value ops onto finer containers and collapses inbound events back; the `diffDocs` bullet says `replaceYStructure()` writes the whole document by merge and bumps `meta.canonicalRev`.
5. **`packages/studio/src/collab/collab-session.ts`**: comments only. `publishDiff`'s doc reads "diff when possible, whole-document merge beyond", and the `sourceParseNow` fallback is described the same way. Any section a comment cites is written `collab.md §3.1`, since a bare `§` in `packages/studio` means `specs/studio.md` (`docs:section-refs`). No behaviour change, and `inline-edit-apply.ts` is untouched: the bridge absorbs its `set-key children`, as it absorbs a whole `textContent`.

**Integration contract.** Once this lands: `seedStructure`, `applyDocOpsToY` and `replaceYStructure` store every key by `toYNodeValue` and never replace a container whose type is unchanged, the root included, except a child element that moves (`move-child`, or the `set-child` of a wrap or unwrap) or that the alignment cannot pair; `replaceYStructure(doc, document, origin)` keeps its signature, its single transaction and its `canonicalRev` bump; `yEventsToDocOps` returns one `set-key children` for events confined to one node's children and `null` only for shapes it still cannot express; `toYNodeValue`, `writeNodeKey`, `mergeYNode` and `mergeYChildren` are exported from `@jxsuite/collab/schema` and not from the package index; `COLLAB_SCHEMA_VERSION` stays 2 and the frame layout is unchanged. §3.1 is Implemented and states the exception, so `plan:collab/epoch-continuity` can delete §3's marker, and `plan:collab/room-schema-skew` versions a layout this plan did not change.

## Tests

`bun test --isolate --coverage` from `packages/collab` and from `packages/studio`.

**`packages/collab/tests/granular-merge.test.ts`** (the §3.1 capability file; `pair()` is reused):

- `describe("the root merges like every node below it")`:
  - `concurrent first edits to the root's style both survive`: root `{ style: { color: "red" }, tagName: "main" }`; A sets `style` `{ color: "blue" }`, B sets `{ color: "red", padding: "4px" }` at path `[]`; after `sync()` both replicas read `color: "blue"` and `padding: "4px"`.
  - `concurrent first edits to the root's textContent both survive`: root `textContent` `"Hello world"`; A `"Hello dear world"`, B `"Hello world!"`; converged text contains `dear` and ends with `!`.
- `describe("rich paragraphs merge per element and per character")`, on a paragraph whose children are `"Hello "`, `{ tagName: "strong", textContent: "bold" }`, `" end"`:
  - `two concurrent children commits to one paragraph both survive`: A sets `children` to `["Hello there ", strong, " end"]`, B to `["Hello ", strong, " end!"]`; converged children are `["Hello there ", strong, " end!"]`.
  - `a children commit keeps the Y.Array and every surviving member`: after one commit the paragraph's `Y.Array`, its first `Y.Text` and the `strong`'s `Y.Map` are the same instances.
  - `a peer's edit inside an inline element survives a children commit that keeps it`: B sets the `strong`'s `textContent` to `"bolder"` while A's commit appends `!` to the last string; both survive.
  - `wrapping a word and a concurrent keystroke both survive`: from `["Hello world"]`, A commits `["Hello ", { tagName: "strong", textContent: "world" }]` while B `set-child`s `"Hello world!"`; converged children are exactly `["Hello !", { tagName: "strong", textContent: "world" }]`: A's edit deletes `world` from the `Y.Text` B typed into, so B's `!` stays in that text after the surviving `"Hello "`.
  - `a moved element loses a concurrent edit inside it`: A `move-child`s the `strong` while B edits its `textContent`; converged, the `strong` is moved and B's text is gone. It pins the case §3.1 states, and stands under either answer to the Open decision.
- `describe("whole-document writes keep granularity")`:
  - `replaceYStructure keeps every container whose type is unchanged`: root `style` `Y.Map`, root `children` `Y.Array`, a child's `Y.Map` and its `textContent` `Y.Text` are the same instances after a write that changes a value inside each.
  - `a peer's concurrent edit survives a whole-document write`: A writes a document retitling child 0 through `replaceYStructure`, B concurrently sets child 1's `textContent` and adds a root `style` property; both survive on both replicas.
  - `a type change still replaces the container`: a write turning the root's `textContent` into `{ $ref: "#/state/title" }` leaves no `Y.Text` under the key.

**`packages/collab/tests/schema.test.ts`**, `describe("the shared write rule")`:

- `seedStructure stores root keys by the same rule as every node`: root `textContent` is a `Y.Text`, `style` a `Y.Map`, `children` a `Y.Array`, `state` plain.
- `mergeYChildren removes, inserts, edits in place and replaces a legacy item`: one call over an array holding a node, a `Y.Text` and a plain string inserted directly (what an older writer could leave) exercises every branch; the next value changes the plain string, because an identical match is skipped and would leave it plain. Asserts the JSON, the kept instances, and that the changed string is now a `Y.Text`.
- `writeNodeKey skips a plain value equal to the stored one`: no `update` event fires.
- `writeNodeKey and mergeYObject write a new null-valued key`: `state: null` onto a node without `state`, and `{ color: null }` onto a style `Y.Map` without `color`; both keys exist afterwards. Fails before the `has` guard.
- `mergeYNode deletes the keys the value no longer has`.
- The `applyTextEdit` comment's `setNodeKey` becomes `writeNodeKey`.

**`packages/collab/tests/op-bridge.test.ts`** (`captureRemote` and `assertFaithful` reused):

- `overlapping multi-target transactions bail to null (diff fallback)` becomes `events inside one children array collapse to one children set-key`: same mutation; `assertFaithful`, and the ops are one `set-key` of `children` at `[]`.
- `two array events in one transaction bail to null` becomes `two children arrays under one node collapse to that node's children`: same mutation; the ops are one `set-key children` at `[]` and replay faithfully.
- New `overlapping events that share no children array still bail to null`: one transaction changing the root `tagName` and inserting a root child.
- New `a merged children commit converts faithfully`: a `set-key children` on `["children", 1]` that inserts one node and edits another; `assertFaithful`.
- New `a collapse whose container is gone bails to null`: two fake events at `["children"]` and `["children", 0]`, once with `target.doc` `null` and once with a seeded doc whose root has no `children`, alongside the existing defensive granular cases.

**`packages/collab/tests/diff.test.ts`**: `hard-replaces the tree and bumps canonicalRev` becomes `writes the whole tree, drops stale keys and bumps canonicalRev`, assertions unchanged.

**`packages/collab/tests/convergence.fuzz.test.ts`**: `randomOp` gains a kind returning a `set-key children` whose value is the target's current children with one bare string extended or one node inserted (the inline-commit shape), and `runFuzz` turns one local op in eight into a whole-document write: apply the op to a clone of the mirror, adopt the clone, and call `replaceYStructure(replica.ydoc, clone, LOCAL_ORIGIN)`. Its mirror-equals-tree and convergence assertions are unchanged, so it proves the merge and the inbound collapse under random interleavings.

**`packages/studio/tests/collab-transact.test.ts`**, `describe("inbound application")`:

- `a rich inline commit and a peer's concurrent edit to the same paragraph both survive`: `openAttached` gains an optional document (default `DOC`); open on a document whose paragraph holds `"Hello "`, a `strong` and `" end"`; fork a peer `Y.Doc` from `hub.serverDoc(PATH)` without connecting it and set the paragraph's `children` there to end in `" end!"`; commit `["Hello there ", strong, " end"]` through `applyInlineCommit` (`../src/editor/inline-edit-apply`); deliver the peer's update to the server doc; after `settleCollab()` the tab and the server both read `["Hello there ", strong, " end!"]`.

**`packages/studio/tests/collab-session-gaps.test.ts`**:

- `publish fallbacks` › `an un-diffable document is hard-replaced into the Y structure` becomes `an un-diffable document merges into the Y structure and keeps a peer's concurrent edit`: with `diffDocsImpl = () => null`, a forked peer retitles `children/0` while the tab sets `tagName` to `article`; after delivery both survive on the server and in the tab, and the server's root `children` `Y.Array` is the instance it was.
- `inbound structure edge cases` › new `a peer's rich commit reaches the tab as one children write`: `openCollabTab(hub, { children: [{ children: ["Hello world"], tagName: "p" }], tagName: "div" })` (the file's `DOC` paragraph has `textContent`, whose commit would arrive as two plain `set-key`s); `yEventsImpl` records what `realYEventsToDocOps` returns; a hub-connected peer commits `["Hello ", { tagName: "strong", textContent: "world" }]` at `["children", 0]`; the recorded ops are one `set-key children` at `["children", 0]`, the tab equals the server, and the server's `["children", 0, "children"]` `Y.Array` is the instance captured before the commit. The instance assertion is what fails today: a replaced `children` key also arrives as one `set-key`.
- Rename `an op-apply failure publishes by diff (and hard-replaces when that fails too)`, `a batch whose op replay fails falls back to the structure replace`, `an un-diffable parse hard-replaces the structure (MIRROR origin)` and `a parse whose op replay fails also hard-replaces the structure` to say "merges", and the file header's "structure replace" likewise; their assertions stand. `a second client hard-reconciles…` is the tab-side reconcile and keeps its name.

Coverage: `packages/collab/bunfig.toml` gates every file at lines 0.98 and functions 0.96, so each new function in `schema.ts` and `op-bridge.ts` is exercised by the cases above, the legacy-item and no-doc branches included. `packages/studio/bunfig.toml` (0.958 / 0.941) is untouched: `collab-session.ts` changes only in comments. No source file is added, so `bun scripts/check-coverage-manifest.ts` has nothing new to find; ratchet a threshold only if a touched file becomes a workspace's new minimum above its bar.

## Specs & docs

**collab.md §3.1**, in place:

- Marker: replace the Partial blockquote with

  ```markdown
  > **Status: Implemented.** `toYNodeValue`, `writeNodeKey`, `mergeYNode` and `mergeYChildren` in `packages/collab/src/schema.ts`, used by `seedStructure`, the op bridge (`packages/collab/src/op-bridge.ts`) and `replaceYStructure` (`packages/collab/src/diff.ts`); `packages/collab/tests/granular-merge.test.ts`, `packages/studio/tests/collab-transact.test.ts`.
  ```

- The table is unchanged. Before the "A **type change**" paragraph, add:

  "The table holds for the root as for every node below it, and for every write that reaches the shared document: the first client's seed, each op the bridge replays, and the whole-document write that stands in when a local edit or the source reconciler's parse cannot be replayed op by op (its diff is too large, or its replay fails). A whole value written onto a key whose stored type is unchanged is diffed onto the container already there: text by a minimal character edit, a granular object property by property, and `children` element by element, aligned as the structural differ aligns children, so an unchanged element is kept, an element with the same `tagName` and the same `attributes.id` or `$props.key` is merged in place, and a bare string is edited per character. A whole-JSON value equal to the one stored is not rewritten, so a whole-document write never restores a key a peer changed at the same moment. An element that moves (reordered, moved to another parent, wrapped or unwrapped) and an element the alignment cannot pair are removed and inserted, because `Y.Array` has no move: an edit a peer makes inside that element at the same moment is lost. Inbound, events confined to one node's `children` collapse back to one `children` write for that node, as §3 describes for the other granular keys."

  (If the Open decision is answered with a Future remainder instead, the sentence about moved and unpaired elements moves under a `> **Status: Future.**` marker at the end of §3.1, and the §3 parenthetical below points at that remainder.)

**collab.md §3**, in place: delete the marker's last sentence ("The op-bridge bullet holds only as far as §3.1's marker records."); the marker stays Partial for the epoch invariant. In the third bullet, after "because replacement orphans a peer's concurrent edit", add "(§3.1 states the one case the bridge cannot avoid, an element that moves or cannot be paired)".

**Fragment**: `bun run spec:change collab.md minor -m "§3.1: every write to the shared document keeps the table's granularity, the root and whole-document writes included, children merge element by element and per character instead of being replaced, a moved, wrapped or unpaired element is the stated exception, and §3.1 is Implemented."`

This plan does not graduate collab.md: the whole-spec marker, §1, §2, §3, §4 and §5 stay open.

**Docs** (no em dashes). No page cites `collab.md#3.1` or `collab.md#3` in `spec:`. `bun run docs:sync` names `docs/studio/publish/collaboration.md` through `collab-session.ts`, and it changes:

- `code:` gains `packages/collab/src/schema.ts`, where the merge rule now lives, and a `spec:` list is added with `collab.md#3.1` (the page has none today; `plan:collab/spec-coverage` adds its own anchors to the same list, a textual rebase).
- "How co-editing behaves", the **Edits merge.** bullet becomes: "**Edits merge.** Everyone edits the same live document, and changes apply as they arrive. Two people typing in the same paragraph both keep what they typed, around bold text and links too, and two people changing different style properties of one element both keep theirs. When two people change the same thing at once, such as one element's tag or the same style property, only one of the two changes is kept, and moving or wrapping an element while someone types inside it keeps the move and loses their typing. No locking, no taking turns." (Yjs picks the surviving write by client, not by arrival, so the page does not say which one.)

`docs/studio/editing/slash-commands.md` lists `inline-edit-apply.ts`, which this plan does not change. `packages/collab/README.md` is step 4 above.

## Acceptance

- `cd packages/collab && bun test --isolate --coverage`: green, every file at or above lines 0.98 and functions 0.96, and the new `granular-merge.test.ts` cases pass.
- `cd packages/studio && bun test --isolate --coverage`: green at 0.958 / 0.941.
- `bun scripts/check-coverage-manifest.ts packages/collab` and `bun scripts/check-coverage-manifest.ts packages/studio`: green.
- `bun run typecheck`, `bun run lint:typecheck` and `bun run lint`: green.
- `grep -n "toYChildren(value)\|JSON.parse(JSON.stringify(value))" packages/collab/src/op-bridge.ts packages/collab/src/diff.ts` prints nothing; `grep -n "toYNodeValue" packages/collab/src/schema.ts` shows `toYNode`, `seedStructure` and `writeNodeKey` using it.
- `bun run plans:status --spec collab`: §3.1 is no longer listed as open, and `plan:collab/epoch-continuity`'s only remaining prerequisite is gone once this file is deleted and the edge removed from it.
- `bun run docs:status`, `bun run docs:spec-release` (the fragment is present), `bun run plans:check`, `bun run docs:check`, `bun run docs:prose`, `bun run docs:links`, `bun run docs:section-refs`: green.
- By hand (the `packages/studio:verify` recipe): two browser windows on one dev server, one paragraph with a bold word; both type into it at once, one before the bold word and one after it, and both windows end with both edits.
