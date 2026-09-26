---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#12.4
size: M
workspaces:
  - packages/studio
---

# Every surface runs a command through runReported, and the bare-run ratchet reaches zero

## Context

`specs/studio-ui-guidelines.md` §12.4, line 823:

> **Status: Partial.** The assistant projection and its undo witness, `coerceArgs` and `runReported` ship (`packages/studio/src/services/ai-command-tools.ts`, `src/commands/registry.ts`, `src/commands/run-reported.ts`), and the six family fixes recorded below hold. Thirteen modules still call `registry.run` bare, named in `NOT_YET_CONVERTED` in `tests/run-reported.test.ts`, and the `git.*` row's failure returns through the Source Control panel, which is §12.5's.

The section's argument corollary is the contract: a refusal out of `registry.run` is synchronous, so "a surface does not call it bare"; a click, chord or notice action runs through `runReported`, which files the sentence in Problems under the surface's name. The ratchet it names is what this plan drives to empty.

**What exists**

- `packages/studio/src/commands/run-reported.ts` (`runReported`, `runActiveReported`), tested in `tests/run-reported.test.ts`.
- The sweep in `tests/run-reported.test.ts`: `BARE_RUN` matches `registry.run(`, `registry?.run(`, `activeRegistry()?.run(` and `contextMenuRegistry().run(`; `OWNS_ITS_REFUSAL` exempts the three callers that read the refusal themselves (`run-reported.ts`, `services/ai-command-tools.ts`, `services/automation.ts`); `NOT_YET_CONVERTED` is asserted to still hold a bare call per entry.
- The thirteen entries: `canvas/canvas-render.ts`, `canvas/iframe-host.ts`, `content/entry-editor.ts`, `editor/context-menu.ts`, `panels/frontmatter-panel.ts`, `panels/head-panel.ts`, `panels/pane-context.ts`, `panels/properties-panel.ts`, `panels/seo-modal.ts`, `panels/style-panel.ts`, `publish/deploy-checklist.ts`, `publish/publish-panel.ts`, `settings/general-settings.ts`.
- The six family fixes spot-checked by the census: `git.createGithubRepository` enablement `isRepo`, `publish.*` sharing `platformSupportsPublish`, `SPLICEABLE_SELECTION`, `collab.showStatus` requiring `documentPath`, `panel.focus.*` composing the panel's `when`.

**What is missing**

- Each of the thirteen modules converted to `runReported` (or `runActiveReported`) with the surface's own source name, and its line removed from `NOT_YET_CONVERTED`, until the set is empty and can be deleted with its assertion.
- A per-module check that the conversion does not double-report: a caller that already `notify`s its own failure keeps one report, not two (§13.3 rule 3).
- The `git.*` row's return path is not this plan's: `plan:studio-ui-guidelines/git-panel-action-list` owns §12.5.

**Related**

- `studio.md` §13.5 (enforcement) and §16.1 (the three tiers: a refusal is a Problem).
- `studio-ui-guidelines.md` §13.3 (nothing is announced twice).
