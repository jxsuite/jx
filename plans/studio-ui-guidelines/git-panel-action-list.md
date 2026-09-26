---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#12.5
size: S
workspaces:
  - packages/studio
---

# The Source Control panel runs its capabilities through their command records, so a refused precondition cannot be bypassed

## Context

`specs/studio-ui-guidelines.md` §12.5, line 867:

> **Status: Partial.** The tab strip, the outline, the block bar and the Command Bar draw from placements. `ACTIONS` in `packages/studio/src/panels/git-panel.ts` is a second list: its `createRepository` calls `createGithubRepository()` directly from the no-repository state, where `git.createGithubRepository`'s `enablement` refuses, so the repository is created on GitHub and adding the remote then fails (asserted as behaviour in `tests/git-panel-gaps.test.ts`).

This is the failure §12.4's table records for the `git.*` family ("Created a repository on GitHub, then failed to add the remote"). The family's records were fixed; the panel reaches the same function through a second door.

**What exists**

- `ACTIONS: GitPanelActions` in `packages/studio/src/panels/git-panel.ts` ("Everything a control can ask for, defined once"): `createRepository` calls `createGithubRepository({ projectName })` directly.
- The record, in the same file: `git.createGithubRepository` with `enablement: (ctx) => ctx.project.isRepo` and `requires: "a project tracked by git"`.
- `createGithubRepository` in `packages/studio/src/github/github-publish.ts` creates the repository with `auto_init: false`, then calls `platform.gitAddRemote`, which fails in a folder that is not a repository; the activity reports "The repository was created, but the remote could not be added."
- `packages/studio/src/surfaces/git-panel.json` draws the "Create GitHub repository" button twice, each time as a literal: once in the no-repository empty state (`view-slot` case `no-repo`, `empty-actions > create-repository`), which is the bypass, and once in the local-only sync bar of a repository with no remote (`view-slot` case `repo`, `remote-slot` case `local`, `sync-bar > create-repository`), where the record's `enablement` holds and the create succeeds.
- The Source Control records are four, all in `sourceControlCommands()` in `git-panel.ts`: `git.init`, `git.createGithubRepository`, `git.push` and `git.signInToGithub`. `git.commitWithoutSync` is a menu row's id in the commit menu, not a registered record, and `git.clone` is only a `notify` key.
- `packages/studio/tests/git-panel-gaps.test.ts`: "publish in the non-repo state calls createGithubRepository with the project name" pins the bypass as behaviour.

**What is missing**

- Every `ACTIONS` entry that has a command twin runs it through `runReported(registry, id, args, "Source Control")`, and the document draws those controls from the record (title, disabled state, `requires`), so the panel cannot offer what the record refuses. Three entries have a twin: `initRepository` (`git.init`), `createRepository` (`git.createGithubRepository`) and `push` (`git.push`). Both create buttons are drawn from the record, which also closes §12.3's renamed label; `plan:studio-ui-guidelines/name-and-chord-gaps` requires this plan for that reason.
- The no-repository state offers what does work there: `git.init` first, or a create verb whose own `run` initialises the repository before adding the remote. Which of the two is a detail-phase decision; either way one record owns it.
- `git-panel-gaps.test.ts`'s case rewritten to assert the refusal (or the init-then-create path), not the bypass.
- The sixteen entries with no command twin are either given records or recorded as input handlers rather than actions, so the list stops being a second definition site: the capabilities `clone`, `commit`, `commitAndSync`, `fetch`, `pull`, `refresh`, `stageAll` and `unstageAll`; the per-row `stage`, `unstage`, `discard` and `openFile`; and the input and navigation handlers `editMessage`, `chooseBranch`, `selectTab` and `openCommitMenu`. Which of them become records is a detail-phase decision.

**Related**

- `studio.md` §5.5 (Source Control panel) and §13 (command registry).
- `studio-ui-guidelines.md` §12.4 (the `git.*` row) and §12.3, whose "Create GitHub repository" label is the same button; `plan:studio-ui-guidelines/name-and-chord-gaps` owns that claim and requires this plan.
