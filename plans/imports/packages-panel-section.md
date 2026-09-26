---
status: stub
disposition: reconcile
claims:
  - imports.md#5
  - imports.md#5.1
size: S
---

# §5 and §5.1 describe the Packages panel, the Insert panel and the drop that imports through the one `$elements` service

## Context

`specs/imports.md` §5, line 162:

> **Status: Partial.** There is no "Imports" tab with three sections. The Packages panel (`registerPackagesPanel` in `packages/studio/src/panels/imports-panel.ts`, markup `packages/studio/src/surfaces/panel-imports.json`) shows the imported modules, dependency add and remove and a cherry-pick checkbox per package element over `project.json`, and the document's `$ref` imports, a component picker and the same checkboxes over any other document. The checkboxes need the `source: "npm"` entries §2 describes, so they appear only under the dev server. Component cards with live preview and drag-drop are the Insert panel's (`registerInsertPanel` in `packages/studio/src/panels/elements-panel.ts`), as studio.md §5.1 and §5.3 describe.

`specs/imports.md` §5.1, line 172:

> **Status: Partial.** A dropped hyphenated tag gains its `$elements` entry through the one service studio.md §9.1.3 names (`enableElement` in `packages/studio/src/files/elements.ts`, called from `packages/studio/src/panels/dnd.ts`), deduplicated by resolved `$ref`. It differs from this section in two ways: the drag source is the Insert panel's component cards, and an npm component is written as its cherry-picked `package/modulePath` specifier (`npmSpecifier`) rather than the bare package name.

Both sections were unmarked before the census. One stub owns both because they are one rewrite: §5.1's drag source is whatever §5 says the panels are, and both end by pointing at the studio sections that own the surfaces. Disposition `reconcile`: the code is right. studio.md §5.1 lists the Packages panel (`packages`, Document group), studio.md §5.3 and §5.4 make the element palette and the component library one Insert panel, and studio.md §9.1.3 is the contract the cherry-pick, the picker and the drop all share, including the cherry-picked specifier and the rule that a whole-package entry satisfies a subpath one.

**What exists**

- `packages/studio/src/panels/imports-panel.ts` and its adapter `packages/studio/src/surfaces/panel-imports.ts` (the two moods; imported modules with write-back through `updateSiteConfig`; dependency add and remove through `platform.addPackage` and `removePackage`; the cherry-pick checkboxes); `packages/studio/tests/imports-panel.test.ts`.
- `packages/studio/src/panels/elements-panel.ts` (project components plus the npm components the document has enabled, as drag sources with `packages/studio/src/panels/component-preview.ts`); `packages/studio/tests/elements-panel.test.ts`.
- `packages/studio/src/files/elements.ts` (`npmSpecifier`, `hasElement`, `enableElement`, `disableElement`); `packages/studio/tests/elements-service.test.ts`.
- The drop in `packages/studio/src/panels/dnd.ts`, which writes `$elements` only when `enableElement` grows the list. An npm card appears only once the document has enabled it, so a drop rarely adds an npm entry, and a drop onto a page holding only the whole-package entry leaves that entry in place.

**What is missing**

- §5 rewritten to the Packages panel's two moods and to the Insert panel as the home of component cards, or reduced to a pointer at studio.md §5.1, studio.md §5.4 and studio.md §9.1.3. The heading's title stays either way.
- §5.1 rewritten to the Insert panel as the drag source and the cherry-picked specifier as the npm entry, deferring the dedup rule to studio.md §9.1.3.
- The detail phase decides how much of the panel this spec keeps describing. A paper plan: no code changes are expected.

**Related**

- studio.md §5.1 (Activity Bar), studio.md §5.3 and studio.md §5.4 (the Insert panel), studio.md §9.1.3 (importing a component).
- imports.md §2 (the CEM metadata that names each element the checkboxes offer; only the dev server discovers it today, which `plan:imports/cem-discovery-on-every-backend` owns, so this rewrite describes the panels as they behave once npm entries are present).
