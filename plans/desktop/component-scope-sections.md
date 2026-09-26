---
status: stub
disposition: implement
claims:
  - desktop.md#6.2
  - desktop.md#6.3
  - desktop.md#6.4
  - desktop.md#6.5
requires:
  - _shared/component-discovery
size: M
workspaces:
  - packages/studio
---

# The Components list splits into Active and Global for the document in view, and says what it is scoped to

## Context

`specs/desktop.md` §6.2, line 522:

> **Status: Partial.** The whole-project list ships: every component `discoverComponents` finds in the tree, loaded by `loadComponentRegistry` (`packages/studio/src/files/components.ts`) into the Insert palette's one Components section (`componentViews` in `packages/studio/src/panels/elements-panel.ts`). There is no scope label and no Active/Global split: the project's own components show as one flat list at every level, and only the npm cards vary, by what the open document's `$elements` enable (`enabledNpmTags` in the same file; only the dev server discovers npm components).

`specs/desktop.md` §6.3, line 531:

> **Status: Pending.** There are no Active and Global sections: the Insert palette draws one Components section (`componentViews` in `packages/studio/src/panels/elements-panel.ts`), and nothing splits the project's components by whether the current document references them.

`specs/desktop.md` §6.4, line 544:

> **Status: Pending.** No `extractReferences` and no active/global partition exist. `packages/studio/src/files/components.ts` holds only the project-wide registry that `loadComponentRegistry` fills from `platform.discoverComponents`.

`specs/desktop.md` §6.5, line 565:

> **Status: Pending.** There is no Active set to update, and the trigger named here is gone: Studio holds one document per tab and opens a sub-component in a tab of its own (`packages/studio/src/panels/jump-bar.ts` records the removed `session.documentStack`), so there is no `pushDocument()` or `popDocument()` in the state model.

All four were unmarked before the census, and the retired §11 roadmap carried them as "Update component sidebar to implement Active/Global scoping (§6)". One stub because they are one feature: the scope label (§6.2), the two sections (§6.3), the extraction and partition that fill them (§6.4), and the recomputation when the document in view changes (§6.5). Disposition `implement`. §6.5 names a document stack that no longer exists, but its intent (the Active set follows the document being edited) is right, and under the per-tab model it means recomputing on a tab switch; its prose is rewritten to that trigger in the same change, which is why it is not a separate `reconcile`.

**What exists**

- `componentRegistry` and `loadComponentRegistry` in `packages/studio/src/files/components.ts`, kept current on save by `noteComponentSaved`.
- `componentViews` in `packages/studio/src/panels/elements-panel.ts`: the project's components plus the npm components the open document enabled, drawn as one accordion section named `Components`, with `registerComponentsDnD` (`packages/studio/src/panels/dnd.ts`) making each card a drag source.
- `componentMetaFrom` in `packages/schema/src/component-meta.ts`, shared by all three discovery paths.
- `collectTags` in `packages/studio/src/canvas/canvas-live-render.ts`: a walk of the render document's `tagName`s and `children` that matches each tag against `componentRegistry` and adds a `$ref` to `$elements` for every project component it finds, so that the canvas registers it. It is the `tagName` half of `extractReferences`, written for rendering rather than for a list.
- The one-document-per-tab workspace (`packages/studio/src/workspace/workspace.ts`).

**What is missing**

- `extractReferences(doc)`: a walk collecting `$defs`, `$ref` paths to `.json` files, and custom-element `tagName`s that match registry entries (and the document's `$elements` imports, if studio.md §5.4's rule is kept). The `tagName` half lifts `collectTags` out of the canvas rather than writing a second walk.
- The partition, and the palette drawing an Active and a Global section at document level and one labelled list ("All Components" or the site name) at project level.
- Recomputation when the active tab changes and when the open document's references change under an edit.
- §6.5's prose restated in the per-tab model.
- A decision with studio.md §5.4, which scopes the same panel differently (`components/` plus `$elements` imports, no split): one spec owns the rule and the other defers to it. The studio census recorded §5.4 as verified with no marker, but its `components/` rule is not what ships: all three hosts discover components anywhere in the tree (site-architecture.md §10.3's census marker says the same). This census forwarded the correction to studio.md, and once §5.4 carries a marker its owner is either a studio stub that this plan requires or this plan, moved to `plans/_shared/` with `studio.md#5.4` added to its claims.

**Related**

- desktop.md §6.1 and desktop.md §4.3 (single-file mode renders the Active set as its flat list; `plan:desktop/single-file-mode`).
- studio.md §5.3 and studio.md §5.4 (the Insert panel), site-architecture.md §10.3 (where components are discovered).
