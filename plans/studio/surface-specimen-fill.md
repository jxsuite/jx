---
status: drafted
disposition: implement
claims:
  - studio.md#4.6
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: L
---

# Every Studio surface opens on the canvas as a realistic instance, drawn with its own specimen

## Context

`specs/studio.md` §4.6, the leading marker:

> **Status: Partial.** The mechanism ships (`packages/studio/src/surfaces/specimen.ts`, `surfaces/specimens.ts`, `canvas/iframe-specimen.ts`, `prepareResolvedDocument` in `canvas/iframe-render.ts`, `canvas.setSpecimenVariant` in `canvas/canvas-utils.ts`), with a specimen for seven surfaces: `statusbar`, `menu`, `style-panel`, `progress-modal`, `ai-model-picker`, `settings-deploy` and `panel-data`. Every other surface under `src/surfaces/` has none yet and still draws on the canvas with no scope, as a skeleton: `SPECIMEN_BACKLOG` in `packages/studio/tests/surface-specimens.test.ts` is the list, and it only shrinks.

Verified against the tree on 2026-11-14; paths are under `packages/studio/` unless another root is named.

**What exists**

- The contract: `src/surfaces/specimen.ts` (`defineSpecimen`, `SurfaceSpecimen`, `SpecimenInstance`). A specimen's `scope()` is typed against the scope interface its adapter exports, so each adapter with a specimen exports that interface (`StatusbarScope`, `MenuScope`, `StylePanelScope`, `ProgressScope`, `ModelPickerScope`, `DeployScope`, `DataTreeScope`).
- The table both realms read: `src/surfaces/specimens.ts` (`SPECIMENS`, `specimenOf`, `specimenVariants`, `specimenWidth`). An entry is the variant names, an optional width, and an `import()` thunk.
- The frame's half: `src/canvas/iframe-specimen.ts` (`prepareSpecimen`, `defineKitFor`, `chromeTheme`, `showRootOverlay`), imported on demand by `prepareResolvedDocument`.
- The gates: `scripts/check-surface-purity.ts` refuses a value import from anywhere but `../reactivity` and `./specimen` in a `*.specimen.ts`; `scripts/check-styles.ts` reads a `*.specimen.ts` as data.
- The suite: `tests/surface-specimens.test.ts` holds every specimen to its document (state members both ways, row fields both ways, a mount per variant, every function reached by `drive`) and the table to the directory. `SPECIMEN_BACKLOG` there holds 95 names and `BACKLOG_CEILING` is 95.

**What is missing**

95 of the 102 surfaces have no specimen. Each opens on the canvas with no scope: a `$switch` on a state member draws no case, a list draws its template row, and bound text draws empty chips.

**Found while building the first seven**

- The specimen suite's `UNREAD` and `UNREAD_ROW_FIELDS` lists are where an adapter's dead projection shows: `ProjectedRow.noDivider` (`src/surfaces/menu.ts`) is derived and never read by `menu.json`. Each fill batch will surface more; an entry there is a finding about the adapter, not about the specimen.
- A surface that spans the window needs `width` in its table entry or it lays out to nothing in the default column (the status bar). Candidates in the backlog: `commandbar`, `tab-strip`, `shell`, `pane-context`, `bottom-dock`, `diff-toolbar`.
- 35 adapters attach an island through `onNodeCreated`. Their hosts stay empty on the canvas by decision (§4.6), so their specimens are the cheapest to write and the least to look at.

## Outcome

- studio.md §4.6 → Implemented: every surface under `src/surfaces/` has a specimen, `SPECIMEN_BACKLOG` is empty and deleted with `BACKLOG_CEILING`, and the parity test reads "the table is the directory".

## Decisions

- **Decided:** every surface gets a specimen, the pure layout hosts (`shell`, `canvas-stage`, `pane-grid`) included. The gate covers the directory, and a second tier of optional surfaces would be a second list to keep.
- **Decided:** island hosts stay empty. A specimen paints no stand-in into a host an adapter fills through `onNodeCreated`.
- **Decided:** specimens are written in the PROJECTED shape, the scope the document reads, as the first seven are. The stated direction after the fill is to split each adapter's projector into a pure module (`project()` in `src/surfaces/menu.ts`, `projectItem` in `src/surfaces/statusbar.ts`), so a specimen supplies the projector's INPUT and the real projector runs in both realms; projection drift then cannot happen and the adapters' test stubs and the specimens become one fixture. That is a refactor across every adapter and is not part of this plan: it is recorded here so the fill does not foreclose it. A specimen that keeps its row factories small (as `menu.specimen.ts` does with `row()`) is the one that converts cheaply.
- **Decided:** the kit is defined in the frame from the bundle for a specimen render, the stated exception in `ui.md` §10. The fill adds no second mechanism.
- **Decided:** a new surface ships with its specimen. `BACKLOG_CEILING` only moves down, in the pull request that shrinks the list.

## Implementation

Per surface: export the adapter's scope interface (one keyword), write `src/surfaces/<name>.specimen.ts` with `defineSpecimen<Scope>`, add the entry to `SPECIMENS` with its variant names (and a `width` for a window-spanning surface), remove the name from `SPECIMEN_BACKLOG` and lower `BACKLOG_CEILING`. The suite then says what is wrong: a state member the document reads and the scope lacks, a member supplied and never read, a row field missing, a control with no name, a function no `drive` reaches. An adapter whose scope is built inline with no named interface gains one first.

A specimen value-imports `../reactivity` and `./specimen` only. Its functions write back into its own reactive scope, so they are observable to `drive` and carry no shell.

Integration contract for dependents: none. Nothing reads a specimen but the canvas frame and the suite.

## Tests

`tests/surface-specimens.test.ts` covers each new specimen with no new test code: adding the entry is what enrols it. A slice adds cases only where a specimen needs a new `UNREAD` or `UNREAD_ROW_FIELDS` entry, each with the reason the adapter carries the member. Each `*.specimen.ts` is a source file under the workspace's per-file `coverageThreshold` (`bunfig.toml`), which `drive` reaching every function is what meets.

## Specs & docs

- studio.md §4.6: the marker's list of surfaces grows with each slice; the last slice replaces the marker with `> **Status: Implemented.**` and removes the sentence about the backlog. Fragment per slice: `bun run spec:change specs/studio.md patch -m "§4.6: specimens for the <family> surfaces."`; the last is `minor`.
- `docs/extending/ui-kit.md` ("Open a surface on the canvas"): the sentence naming which surfaces have a specimen is removed by the last slice.
- `bun run docs:sync` names `docs/studio/interface/canvas.md` for any adapter it lists in `code:`; exporting a type changes no behaviour, so no page changes.

## Acceptance

- `bun test --isolate ./tests/surface-specimens.test.ts` in `packages/studio` passes with `SPECIMEN_BACKLOG` gone.
- `ls src/surfaces/*.json | wc -l` equals `ls src/surfaces/*.specimen.ts | wc -l`.
- `bun scripts/check-surface-purity.ts` and `bun scripts/check-styles.ts` pass.
- In Studio, with `packages/studio/project.json` open, each surface file opens in Edit showing text and controls, and the resolving-with popover lists its variants.
- `bun run plans:check` reports `graduation-ready` or nothing for `studio.md#4.6`.

## Slices

| Slice  | Scope                                                                                                                                                                                                                                                                                                                                                                                                        | Claims        | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----- |
| SSF1.1 | Dialogs: the 14 remaining `jx-dialog` roots (`about`, `add-new`, `add-repo`, `cf-account-picker`, `convert-repeater`, `dialog`, `github-auth`, `github-publish`, `jxsuite-update`, `media-pick-dialog`, `new-project`, `preferences`, `publish`, `seo`)                                                                                                                                                      |               | open  |
| SSF1.2 | Pickers and popovers: the 6 `jx-popover` roots, and `ai-credentials-form`, `ai-managed-connect`, `dynamic-tag`, `expression-editor`, `formula-palette`, `media-field`, `reference-field`, `secret-field`, `schema-form`, `schema-builder`                                                                                                                                                                    |               | open  |
| SSF1.3 | `settings-*`: the 10 remaining sections and `settings-pane`, `styles-variables`                                                                                                                                                                                                                                                                                                                              |               | open  |
| SSF1.4 | `panel-*`: the 10 remaining panels, and `properties-panel`, `collections-panel`, `files-panel`, `site-panel`, `styles-panel`, `logic-panel`, `statements`                                                                                                                                                                                                                                                    |               | open  |
| SSF1.5 | What SSF1.1 and SSF1.2 leave of `grid-*`, `media-*`, `entry-*` and `publish-*`, and `push-plan`, `image-editor`, `library-pane`, `logic-workspace`                                                                                                                                                                                                                                                           |               | open  |
| SSF1.6 | The shell's own chrome: `shell`, `rail`, `commandbar`, `tab-strip`, `tag-strip`, `jump-bar`, `pane-context`, `pane-grid`, `canvas-stage`, `bottom-dock`, `inspector-dock`, `navigator-dock`, `block-action-bar`, `diff-toolbar`, `stylebook-chrome`, `target-line`, `data-actions`, `ai-chat`, `empty-state`, `welcome`, `boot-failure`, `palette`, `toasts`, `writing-banner`, `entry-preview`; closes §4.6 | studio.md#4.6 | open  |
