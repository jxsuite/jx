---
status: drafted
disposition: implement
claims:
  - studio.md#8.5
requires:
  - spec/jx-document-format
workspaces:
  - packages/studio
  - packages/collab
  - packages/server
  - packages/ai
  - specs
  - docs
size: M
---

# Studio opens, edits, saves and collaborates on `.jx` documents without losing a comment

## Context

`specs/studio.md` §8.5 is Pending. `plan:spec/jx-document-format` provides the reader, reconcile, the built-in format entry and a Monarch grammar. This plan is the rest of Studio's path, and was split from that plan so that the collaboration question below does not hold up `plan:site-architecture/project-jx`, which needs neither (`collab/collab-session.ts:664` keeps the project file out of replication).

Corrected against the code on 2026-11-05:

- **Studio has no native path to reuse.** It knows a format class or JSON (`files/serialize-document.ts:73`, `canvas/canvas-render.ts:176`, `:186`, `:870`, `files/file-ops.ts:116`). Saving `x.jx` through that today writes JSON into it.
- **The CRDT does hold text.** `source: Y.Text` is "THE authoritative file content" (`packages/collab/src/schema.ts:7`), and the server persists it (`packages/server/src/collab.ts:112`, `:123`). A client saving against a stale copy erases another author's comment.
- **Collaboration cannot see reordering.** Running `packages/collab`: peers read different key orders, a reversed style gives `diffDocs` `[]`, and a set-key leaves Y unchanged, so a moved CSS declaration silently reverts. This affects `.json` today.

## Outcome

- studio.md §8.5 → Implemented: open, edit, save and collaborate, with comments and layout surviving.

## Decisions

- **Decided:** in collaboration, `.jx` reconciles against the current `Y.Text`, not the file on disk and not a tab's cached source.
- **Open:** how a `style` block keeps its order in the CRDT, given a `Y.Map` has none. Recommendation: a companion `Y.Array` of keys per style block, with `diffDocs` comparing order for style objects only, because that fixes the same defect for `.json`. The alternative is whole-value last-writer-wins on `style`, which undoes the per-property merge `GRANULAR_OBJECT_KEYS` exists for. Touches `plan:collab/granular-writes`.

## Implementation

- **Studio.** The built-in entry through `format/format-host.ts`, a Monarch grammar with TypeScript embedded in strings, and `format/convert-file.ts` gaining the pair through its existing derivation. `create/add-new.ts:700`, `:717` keep creating `.json` until the last slice of `plan:_shared/jx-typechecking`.
- **Collaboration.** `collab/collab-session.ts:399`, `:634` serialize against the current `Y.Text` and write a minimal text diff in one transaction. `:456` surfaces a Code view parse error as a Problem and keeps the text, instead of swallowing it and discarding the edit. `parseCollabSource` already refreshes `tab.doc.source` for a format path.

The named sites below are each a silent failure if missed. `plan:spec/jx-document-format` classifies the others:

- Layouts vanish: `panels/head-panel.ts:95`, `panels/site-model.ts:338`. Loud failure: `compiler/src/site/layout-resolver.ts:29`.
- No `$layout`: `content/page-summaries.ts:53`, `content/collection-pages.ts:149`.
- Components cannot draw: `panels/component-preview.ts:68`, `browse/library-preview.ts:276`, `style/stylebook-specimens.ts:45`.
- Not routes: `panels/properties-panel.ts:442`, `grid/redirects-grid.ts:77`.

**Related, no edge.** `plan:collab/room-schema-skew` sets the rule for changing the shared schema while a room has peers on two versions, which the `style` order change must follow. `plan:collab/granular-writes` is where the `style` order question lands. `plan:_shared/formats-from-extensions` owns studio.md §8.1.

**Integration contract.** Once this lands, `plan:spec/document-scripts` and `plan:_shared/jx-typechecking` may rely on a `.jx` document having a full Studio path.

## Tests

- `packages/collab`, `packages/studio`: B comments in Code view, A edits a style, B's comment survives, and only one text is ever persisted. A reversed style converges on both peers. Open, edit and save a commented file with a one-line diff, a rename keeping comments, and each named `.json` site. Chrome MCP pass.
- Coverage thresholds ratchet in every touched workspace. `bun test --isolate` throughout.

## Specs & docs

- `studio.md` §8.5: delete the marker; §8.4's derivation names `.jx`. `collab.md` §3.1: `style` order. Each with a fragment: `bun run spec:change studio.md minor -m "Studio opens, edits and saves .jx documents"`.
- `docs/studio/` pages as `bun run docs:sync` names them, and `docs/studio/logic/code.md`. No em dashes in docs pages.

## Acceptance

- Opening a commented `.jx` in Studio, editing one style value and saving produces a one-line diff, solo and in a collaborative session.
- A Chrome MCP pass covers open, edit and save.
- `bun run all-the-things`, `plans:check` and `docs:check` are green.
