---
status: stub
disposition: implement
claims:
  - collab.md#3.1
size: M
workspaces:
  - packages/collab
  - packages/studio
---

# Every write to the shared document keeps §3.1's granularity, so concurrent edits merge wherever the table says they do

## Context

`specs/collab.md` §3.1, line 63:

> **Status: Partial.** Every node below the root is converted as tabled (`toYNode` and `toYChildren` in `packages/collab/src/schema.ts`, covered by `packages/collab/tests/granular-merge.test.ts`), but three write paths lose the table's outcomes. The root: `seedStructure` (`schema.ts`) and `replaceYStructure` (`packages/collab/src/diff.ts`) write each root key other than `children` as a whole-JSON value, so the root's `textContent`, `style`, `attributes` and `$props` last-writer-win until the op bridge's `setNodeKey` first replaces them, and again after every `replaceYStructure`. `children`: `setNodeKey` (`packages/collab/src/op-bridge.ts`) replaces the `Y.Array` and every `Y.Text` in it on a `set-key` of `children`, the op each inline rich-text commit records (`packages/studio/src/editor/inline-edit-apply.ts`), so bare-string children and elements merge per character and per element only through `set-child`, `insert-child` and `remove-child`. The fallback: `publishDiff` (`packages/studio/src/collab/collab-session.ts`) calls `replaceYStructure`, which rebuilds the whole tree and orphans every concurrent edit, whenever `diffDocs` exceeds its 500-op limit or an op fails to apply.

§3's third bullet states the same rule as an invariant ("never replacing a live container when the type is unchanged, because replacement orphans a peer's concurrent edit"), and §3's marker defers to this one for it. The three paths share one missing piece: a way to write a whole value onto an existing container by diffing it, which `setNodeKey` already has for text and granular objects and lacks for `children` and for the root.

**What exists**

- `TEXT_KEYS` and `GRANULAR_OBJECT_KEYS` in `packages/collab/src/schema.ts`, and `toYNode`, which applies them to every node object it converts.
- `seedStructure` (`schema.ts`) and `replaceYStructure` (`diff.ts`): both special-case `children` through `toYChildren` and write every other root key with a JSON clone into `structureMap(doc)`, which is itself the root node's `Y.Map`. `replaceYStructure` also bumps `meta.canonicalRev`.
- `setNodeKey` in `packages/collab/src/op-bridge.ts`: `applyTextEdit` for text keys, `mergeYObject` for granular objects, and `node.set(key, toYChildren(value))` for `children`, which is why the root self-heals per key and `children` never does.
- `applyInlineCommit` and its siblings in `packages/studio/src/editor/inline-edit-apply.ts` call `mutateUpdateProperty(t, path, "children", …)`, and `publishRecord` in `collab-session.ts` forwards that `set-key` unchanged to `applyDocOpsToY`.
- `publishDiff` in `collab-session.ts`: `diffDocs` (`packages/collab/src/diff-core.ts`, `DEFAULT_MAX_OPS = 500`) returns `null` past its limit, and both that and a throw from `applyDocOpsToY` fall back to `replaceYStructure` with `LOCAL_ORIGIN`. The source mirror's call (`sourceParseNow`, `MIRROR_ORIGIN`) runs while structure edits are frozen by the source-canonical lock, so it orphans nothing but still resets the root to whole values.
- `granular-merge.test.ts` exercises child nodes only, and bare-string merge only through `set-child`. A census reviewer reported that two concurrent `set-key children` commits to a paragraph holding `"Hello "`, a `strong` element and `" end"` lost one author's edit, where the same edits as `set-child` ops both survived.

**What is missing**

- One helper that writes a whole node value onto an existing `Y.Map` key by key with `toYNode`'s rule, used by `seedStructure`, `replaceYStructure` and `setNodeKey`, so the root cannot drift from the rest of the tree again.
- A `children` write that diffs onto the existing `Y.Array` (align as `diffDocs` does, then `applyTextEdit` on surviving strings) instead of replacing it.
- A `publishDiff` fallback that does not orphan concurrent edits, or a stated bound on when it may and what the author is told.
- Concurrent tests: first edits to the root's `style` and `textContent` both survive; granularity survives a `replaceYStructure`; two rich-paragraph inline commits both survive.
- Whether any of this is a `COLLAB_SCHEMA_VERSION` bump. A room seeded before the fix still reads correctly and self-heals per key, which argues no; `plan:collab/room-schema-skew` decides what a bump means.

**Related**

- collab.md §3 (the invariant this section tables; `plan:collab/epoch-continuity` closes §3 after this lands), collab.md §5 (layout versioning).
