---
status: stub
disposition: implement
claims:
  - studio.md#7.3
size: S
workspaces:
  - packages/studio
---

# The Stylebook layers tree marks the tags Stylebook has styled, and §7.3 describes how it selects them

## Context

`specs/studio.md` §7.3, line 762 (the section was unmarked before the census):

> **Status: Partial.** The nested tree, selection from its rows and from the canvas, pan-to-card and the Style tab ship (`packages/studio/src/panels/stylebook-layers-panel.ts`, `panels/stylebook-panel.ts`). The mechanics differ from the text: `selectStylebookTag` sets `activeSelector` to the bare tag path (`ul li`), canvas hits decode through the specimen document's path map, and `stylebookElToTag` no longer exists. The row's customised marker reads `& <tag>` keys through the layers panel's own `hasTagStyle`, not the exported one in `panels/stylebook-doc.ts` that reads bare nested keys, while Stylebook edits write bare tag keys (§7.4), so it never lights for Stylebook's own edits.

Disposition `implement`, for the defect: the customised marker follows the spec's `& tag` shape while the editor writes the bare shape §7.4's code uses, so the marker is dark for exactly the edits it exists to show. The mechanics sentences are a reconcile riding with it. The key shape is decided once, in `plan:studio/stylebook-editing-text`, and this plan follows it.

**What exists**

- A private `hasTagStyle(rootStyle, tag)` in `packages/studio/src/panels/stylebook-layers-panel.ts`, reading ``rootStyle[`& ${tag}`]`` and called with the row's bare `tag` rather than its `fullPath`; its tests seed `& h1` fixtures (`packages/studio/tests/stylebook-layers-panel.test.ts`).
- The reader this needs already exists: `hasTagStyle(rootStyle, tagPath)` exported from `packages/studio/src/panels/stylebook-doc.ts` resolves a nested tag path through `resolveNestedStyle`, directly and under every `@` block (`packages/studio/tests/stylebook-doc.test.ts`).
- `selectStylebookTag` and `panToStylebookTag` in `packages/studio/src/panels/stylebook-panel.ts`; `resolveStylebookTag` and the specimen document's `pathToTag` map (`panels/stylebook-doc.ts`, `canvas/iframe-host.ts`).
- The editor's write path: `mutateUpdateNestedStylePath` for a tag-path `activeSelector` (`packages/studio/src/panels/style-panel.ts`).

**What is missing**

- The layers panel's local helper deleted and `stylebook-doc.ts`'s `hasTagStyle` called with the row's full path (`ul li`), so the marker reads the bare, nested key the editor writes; the layers tests reseeded the way Stylebook writes.
- §7.3's three mechanics bullets and its canvas-selection sentence rewritten to the bare tag path and the specimen path map.

**Related**

- studio.md §7.4 (what a Stylebook edit writes), studio.md §6.2 (the Target Line's selector segment), spec.md §9.2 (nested CSS selectors).
