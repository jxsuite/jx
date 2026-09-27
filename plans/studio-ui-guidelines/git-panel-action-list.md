---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#12.5
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: L
---

# The Source Control panel and the welcome screen draw every control from its command record, so no surface offers what a record refuses

## Context

`specs/studio-ui-guidelines.md` §12.5, line 867:

> **Status: Partial.** The tab strip, the outline, the block bar and the Command Bar draw from placements. `ACTIONS` in `packages/studio/src/panels/git-panel.ts` is a second list: its `createRepository` calls `createGithubRepository()` directly from the no-repository state, where `git.createGithubRepository`'s `enablement` refuses, so the repository is created on GitHub and adding the remote then fails (asserted as behaviour in `tests/git-panel-gaps.test.ts`).

This is the failure §12.4's table records for the `git.*` family ("Created a repository on GitHub, then failed to add the remote"). The records were fixed; the panel reaches the same function through a second door.

**Verified**

- `ACTIONS: GitPanelActions` in `packages/studio/src/panels/git-panel.ts` has nineteen entries. Three have a record in `sourceControlCommands()` (same file, which also holds `git.signInToGithub`): `initRepository` (`git.init`), `createRepository` (`git.createGithubRepository`: `enablement: (ctx) => ctx.project.isRepo`, `requires: "a project tracked by git"`) and `push` (`git.push`). `createRepository` calls `createGithubRepository({ projectName })` (`src/github/github-publish.ts`) with no gate.
- `src/surfaces/git-panel.json` draws that button twice as the literal "Create GitHub repository": in `view-slot` case `no-repo` (the bypass) and in `remote-slot` case `local` (where the gate holds). Every sync-bar and commit control binds `disabled` to `#/state/busy` alone; the row verbs, Stage all and Unstage all bind none (Discard binds `cannotDiscard`).
- `createGithubRepository` creates the repository (`auto_init: false`), then runs `platform.gitAddRemote`, which fails outside a repository: "The repository was created, but the remote could not be added." `git-panel-gaps.test.ts`'s "publish in the non-repo state calls createGithubRepository with the project name" pins the bypass.
- The other sixteen entries have no record. Capabilities: `clone` (the injected `cloneRepository`, which the welcome screen also calls), `commit`, `commitAndSync`, `fetch`, `pull`, `refresh`, `stageAll`, `unstageAll`, and the row verbs `stage`, `unstage`, `discard`. Row activation: `openFile`. Input handlers: `editMessage`, `chooseBranch`, `selectTab`, `openCommitMenu`. The commit menu's one row carries the id `git.commitWithoutSync`, which names no record.

**Found by this pass (census corrections)**

- **The same failure gets past the gate.** The New Project wizard runs `git init` on a new project and makes no commit (`initProjectRepo`, `src/files/files.ts`). On such a project the local sync bar's Create button is enabled. It creates the repository and adds the remote, then fails at the push, because `gitPush({ setUpstream: true })` runs `git rev-parse --abbrev-ref HEAD` and that fails on an unborn branch (`packages/desktop/src/git.ts`, the push route in `packages/server/src/studio-api.ts`). The deploy checklist's remote step runs the same record, bare (`runNextStep`, `src/publish/deploy-checklist.ts`).
- **And by the other door, on a repository that already has a remote.** `git.createGithubRepository` is enabled whenever git tracks the project, so the palette and the Studio menu offer it on a repository with `origin`: it creates the repository on GitHub, then `git remote add origin` fails. The panel hides Create, Fetch, Pull and Push by remote state (`remote-slot`) while the palette offers `git.push` either way, so two surfaces already disagree, and GPA1.2's new records would widen that to Fetch, Pull and Commit and Sync. Every backend reports `remotes` in `GitStatusResult` (`packages/protocol/src/types.ts`), and `remoteStep` in the deploy checklist already reads it.
- **A second door past a refusal outside the panel.** The Packages table's Remove (`onRemove`, `src/settings/dependencies-editor.ts`) calls `platform.removePackage` directly, where `packages.remove`'s `run` (`removeExtensionPackage`, `src/settings/extension-commands.ts`) refuses a package an enabled extension still needs, because the next build would fail. `plan:studio/file-tree-command-records` found it and notes that this plan did not list it. The Extensions rows are not a second door: `src/settings/extensions-section.ts` calls the same `enableExtension`, `disableExtension` and `removeExtensionPackage` the three records run.
- **The census missed a second list.** The welcome screen's Start list (`project()` in `src/surfaces/welcome.ts`: `StartAction { id, title, icon }` plus a `run` switch over injected callbacks) duplicates `project.new` and `project.open`, and it disagrees with `project.new`. The tile opens the project the wizard created (`openNewProject` in `src/studio.ts`). `project.new`'s `run` throws the wizard's result away (`newProjectCommands`, `src/new-project/new-project-modal.ts`), so New Project… from the palette or the Studio menu creates a project and opens nothing, although `docs/studio/projects/create.md` says it opens. The list's other two tiles, Clone Git Repository… and Add Existing Repository…, have no record. `studio.md` §13's marker leaves out clone, refresh and add-repository.
- **Checked, and not second lists.**
  - The canvas's derivation notice takes its one action from the `pane.pin` record (`src/canvas/canvas-render.ts`).
  - `openPageAction()` (`src/panels/empty-state.ts`) is one shared empty-state verb. It runs `openQuickSearch("files")`, the same call `palette.openFiles` makes, and §11.1 rule 2 governs its "Open a page…" label, so the label is a question for §11 and §12.3, not a second list.
  - The Cloudflare connect flow is written twice (`src/publish/publish-panel.ts`, `src/settings/preferences-accounts.ts`), but neither copy is a record, so it belongs to `studio.md` §13's residue.

**Related**

- `studio.md` §5.5 (the panel) and §13 (the registry). `plan:studio/file-tree-command-records` owns §13, waits on this plan's git records, and builds its Files controls with `commandControl`.
- `studio-ui-guidelines.md` §12.3: `plan:studio-ui-guidelines/name-and-chord-gaps` requires this plan for the renamed Create button, and adds `placementRows` to the module this plan creates.
- `studio-ui-guidelines.md` §12.4: `plan:studio-ui-guidelines/run-reported-sweep` converts `runNextStep` too. Whichever lands first converts it; the other drops that step.
- `studio-ui-guidelines.md` §10: `plan:studio-ui-guidelines/conventions-checklist`.
- `plan:desktop/github-token-stays-in-launcher` rewrites the inside of `createGithubRepository` and depends only on its signature, which this plan keeps.

## Outcome

- `studio-ui-guidelines.md` §12.5 → Implemented, at GPA1.3.
- No surface calls past a record's refusal: Create GitHub Repository refuses a repository with no commit, the remote verbs follow the remote (if that decision holds), and the Packages table's Remove refuses what `packages.remove` refuses (GPA1.1).
- The riders stay in the owners' sections and leave their markers open:
  - §12.3's and §12.4's markers drop their git clauses (GPA1.1).
  - §12.4's rule 3 (GPA1.2) and rule 2 (GPA1.3) are rewritten.
  - §10's marker stops citing the panel (GPA1.2) and §12.5 (GPA1.3).
  - `studio.md` §5.5 states Create's refusals and §13.4 gains `git.hasRemote` (GPA1.1); §5.5 names the records and §13's marker drops the panel's verbs (GPA1.2); §13.4 gains `addRepository` (GPA1.3).
- Both specs stay Partial. Nothing graduates.

## Decisions

- **Open:** What the no-repository state offers. Recommendation: Initialize Repository, enabled, beside Create GitHub Repository drawn from its record: disabled, with `requires` as its tooltip. §12.3 and §10 require a control that cannot act to render disabled with its reason, and the pair teaches the order. Hiding the button loses that. A create verb that initialises first cannot succeed either: an unborn branch cannot be pushed, so the verb would also have to commit every file under a message the author never wrote.
- **Open:** Whether `git.createGithubRepository` refuses a repository with no commit. Recommendation: yes, as the first thing its `run` does. `platform.gitLog(1)` rejecting or answering `[]` throws a `RangeError`, before any sign-in or request. Without this, Initialize then Create (the path above) and every wizard-made project still leave an empty repository on the person's account. §12.4's corollary allows a `run` refusal for what `enablement` cannot see. Making it a context key instead would need a new `GitStatusResult` field on three backends.
- **Open:** Whether the remote verbs gate on a remote. Recommendation: yes. `ctx.git.hasRemote` is `status.remotes` being non-empty. `git.createGithubRepository` becomes `isRepo && !hasRemote` ("a project tracked by git, with no remote yet"). `git.push`, `git.pull`, `git.fetch` and `git.commitAndSync` become `isRepo && hasRemote` ("a repository with a remote"). Without it the palette and the Studio menu keep an orphaned-repository path open and disagree with the panel's remote-state switch. The cost: on a local-only repository, Commit and Sync draws disabled with its reason, and Commit is reached through the split button's menu or Ctrl+Enter. The alternative, leaving Commit and Sync ungated, keeps a member that commits and then fails to push, which is the shape §12.4's table records.
- **Open:** Which of the sixteen entries become records. Recommendation: every capability (the table under GPA1.2), `clone` included. `openFile` stays the row's own activation, the way an outline row's click is, and keeps its refusals in the panel's banner (`studio.md` §5.5, File Rows). `editMessage`, `selectTab`, `openCommitMenu`, and `chooseBranch` (which dispatches to `git.checkout` or `git.createBranch`) stay input handlers. Reason: `studio.md` §13 says every capability is a record, and its owner is waiting on this answer.
- **Open:** Whether `git.commit` projects to the assistant, which §12.4 rule 3 defers until "`git.commit` becomes a record". Recommendation: no, and rule 3 is rewritten to say so. The model has no read of the working tree's status or of the remote, and a commit, push or discard carries whatever is on disk.
- **Open:** Whether this plan also takes the Packages table's Remove and the welcome screen's Start list. Recommendation: yes to both. Remove goes in GPA1.1: it is Create's failure class, and §12.5 cannot be Implemented while one surface removes what the record refuses. The Start list goes in GPA1.3: its New Project divergence is exactly the symptom the section names. `openPageAction` stays out, for the reason given in Context.
- **Decided:** A control runs its record through `runActiveReported(id, args, "Source Control")`. The panel is mounted by the Navigator with no registry injected, which is the Command Bar's and the status bar's situation too, and §12.4 routes a surface's refusal to Problems through that one helper.
- **Decided:** A new module, `src/commands/projection.ts`, owns what a command prints: `commandControl` (one record to one control), `commandTooltip` (moved from `surfaces/commandbar.ts`) and, in GPA1.2, `commandRow` (one record to one menu row). It is the module `plan:studio-ui-guidelines/name-and-chord-gaps` names and extends with `placementRows`, so the two plans build one projector rather than two. `commands/app-commands.ts` imports `git-panel.ts`, so the panel must stay loadable in a bare Bun process and cannot import `surfaces/commandbar.ts`, which reaches the canvas and preview stack.
- **Decided:** The panel draws its controls by id, not through a new placement. Each mood lays out its own controls, and the deploy checklist's `actionView` already renders a record by id with its title and `requires`.
- **Decided:** The projection folds `busy` into each control's `disabled`, because the adapter decides and the document binds values (the module header's rule). The hint stays the record's.
- **Decided:** Every new record that writes the repository declares the family precondition (§12.4): `when: (ctx) => ctx.project.open`, `enablement: (ctx) => ctx.project.isRepo`, `requires: "a project tracked by git"`, narrowed by `hasRemote` for the remote verbs if that decision holds. `git.refresh` has `when` only, because reading status is how a project learns it is a repository. `git.clone` is `application`-level with `when: (ctx) => ctx.capability.gitClone`. Every new record is `menus: ["palette"]`, and the Studio menu is unchanged.
- **Decided:** Labels are record titles in Title Case (§10, §12.3): "Create GitHub Repository", "Commit and Sync", "Stage All", "Unstage All", "Create Branch…". The commit menu's row is the `git.commit` record, "Commit". A count is state, so the projection appends it to the title ("Push (1 ahead)"), as "Local Changes (6)" already does. A row button is named `<title>: <path>`.
- **Decided:** The panel keeps its error contract. A git command that fails lands in the panel's banner (`shell.git.error`); a refusal lands in Problems. Each event is reported once (§13.3).
- **Decided:** `git.commit` and `git.commitAndSync` take an optional `message`. Without one they read the field and clear it; an empty message is a `RangeError` saying "<title> requires a commit message.". The panel draws both buttons disabled while the field is empty, with the same noun phrase in the hint. Ctrl+Enter runs the record only when the field has text.
- **Decided:** A row verb takes `path` as a `derivedEnumProperty` over the last status read: unstaged paths for `git.stage`, staged paths for `git.unstage`, and unstaged tracked paths for `git.discard`. So `coerceArgs` refuses a path that is not there, and `git.discard` refuses an untracked one. `git.discard` is `destructive: true` and keeps its confirmation.
- **Decided:** `runNextStep` in the deploy checklist moves to `runActiveReported` in GPA1.1 unless `plan:studio-ui-guidelines/run-reported-sweep` has already moved it. The new refusal is asynchronous, and a bare `void activeRegistry()?.run()` would leave it as an unhandled rejection. The source is the name that plan settles for this file (its recommendation is "Deploy Checklist"), so the two plans cannot file one surface under two names.
- **Decided:** The Packages row's Remove calls `removeExtensionPackage`, the function `packages.remove` runs, as the Extensions rows already do, rather than running the record. The table reports through its own progress modal, which shows a rejected operation as its failure, and `runActiveReported` never rejects, so the modal would report success over a refusal.
- **Decided:** A record that needs the bootstrap takes its dependencies with a no-op default, so `appCommandSet()`'s calls stay argument-free. That covers `sourceControlCommands({ openRecentProject })`, `newProjectCommands({ openCreated })` and `addRepositoryCommands({ onAdded })`.

## Implementation

**GPA1.1: the three records the panel already has, and the doors past a refusal**

1. `packages/studio/src/commands/projection.ts` (new; its header cites `studio-ui-guidelines.md` §12.3 and §12.5):
   - `export interface CommandControlView { id: string; title: string; label: string; hint: string; disabled: boolean; visible: boolean }`.
   - `export function commandControl(registry: CommandRegistry | null, id: string, suffix = ""): CommandControlView`.
     - With no registry, or no record under `id` (`registry.get(id)`, because the gate methods throw on an unknown id), it returns `{ id, title: "", label: "", hint: "", disabled: true, visible: false }`.
     - Otherwise `label = title + suffix`, `visible = registry.isVisible(id)` and `disabled = !visible || !registry.isEnabled(id)`.
     - `hint` is `` `${label} — requires ${reason}` `` when `registry.disabledReason(id)` gives a reason, else `` `${label} (${chord})` `` when `keymap.formatBinding(id)` gives a chord, else `label`.
   - `export function commandTooltip(registry, id)` moves here from `surfaces/commandbar.ts`: `""` for an unknown id, otherwise `commandControl(registry, id).hint`. `commandbar.ts` keeps `export { commandTooltip } from "../commands/projection";`, so `panels/layers-panel.ts`, `tests/commandbar.test.ts` and the four `mock.module` stand-ins that stub it (`studio-shell.test.ts`, `studio-shell-fixture.ts`, `studio-shell-boot-gaps.test.ts`, `shell-misc-diff-gaps.test.ts`) still hold. `panels/block-action-bar.ts`'s own `commandTooltip(registry, command)` is `plan:studio-ui-guidelines/name-and-chord-gaps`'s.
   - The module imports only types in this slice.
2. `src/commands/context.ts` and `src/commands/live-context.ts`, if the remote decision holds: the `git` group gains `hasRemote: boolean` (`false` in `emptyContext()`), and `createLiveContext` sets `ctx.git.hasRemote = (shell.git.status?.remotes?.length ?? 0) > 0` beside `ahead`. The `?? 0` is `remoteStep`'s guard for a host that reports no array.
3. `src/surfaces/git-panel.ts`:
   - `GitPanelValues` gains `controls: GitPanelControls` (`init`, `createRepository`, `push`, each a `CommandControlView`) and loses `pushLabel`.
   - `project()` assigns `scope.controls`, and `emptyValues()` seeds three skeleton views.
4. `src/panels/git-panel.ts`:
   - `gitPanelValues()` reads `activeRegistry()` and builds `controls` through `commandControl`, with `disabled: true` while `loading`. Push's suffix is `` ` (${ahead})` `` when ahead. The mount's effect tracks whatever the projection reads, so reading `activeRegistry()` (a `shallowRef`) and the gates (the registry's `createLiveContext` reads `shell.git.status`) is the whole wiring.
   - `ACTIONS.initRepository`, `.createRepository` and `.push` each become `void runActiveReported(<id>, undefined, SOURCE)`, with `const SOURCE = "Source Control"`.
   - `git.createGithubRepository`'s `run` calls a new private `refuseWithoutCommit()` first. It awaits `getPlatform().gitLog(1).catch(() => [])`, and an empty answer throws `new RangeError(NO_COMMIT_TO_PUSH)` with the sentence "Create GitHub Repository needs a commit to push: commit your changes first." If the remote decision holds, its `enablement` becomes `(ctx) => ctx.project.isRepo && !ctx.git.hasRemote` with `requires: "a project tracked by git, with no remote yet"`, and `git.push`'s becomes `(ctx) => ctx.project.isRepo && ctx.git.hasRemote` with `requires: "a repository with a remote"`. Rewrite Create's comment to state every refusal.
5. `src/surfaces/git-panel.json`:
   - `init`: `textContent` becomes `${state.controls.init.label}`, and `hint` and `disabled` come from `#/state/controls/init/…`.
   - Both `create-repository` buttons do the same from `controls.createRepository`, and the literal goes.
   - `push`: `label`, `hint` and `disabled` come from `controls.push`.
   - Update the document's `$description`.
6. `src/publish/deploy-checklist.ts`, `runNextStep`, unless the sweep has landed: `void runActiveReported(next.command, undefined, <the sweep's source>)`, and `publish/deploy-checklist.ts` leaves `NOT_YET_CONVERTED` in `tests/run-reported.test.ts`.
7. `src/settings/dependencies-editor.ts`, `onRemove(name)`: `await withBusy(() => removeExtensionPackage(name))`, importing it from `./extension-commands`. Its own `notify.success` goes, because the function reports "Removed name." itself, and a refusal reaches `progress.fail` with the function's sentence.

**GPA1.2: the panel's other capabilities as records**

1. `projection.ts` adds `commandRow(registry, command, { dividerAbove = false, args, source } = {}): MenuRowProjection`, with the signature `plan:studio-ui-guidelines/name-and-chord-gaps` specifies. It returns `id`, `title`, `disabled: !registry.isEnabled(command.id)`, `destructive` from the record, `dividerAbove`, `chord` when `formatBinding` gives one that does not restate the title (the rule `buildRows` in `editor/context-menu.ts` states), and `requires` when disabled. With a `source`, an enabled row's `run` is `() => void runReported(registry, command.id, args, source)`; without one the row has no `run`. The module gains its one value import, `runReported`.
2. `git-panel.ts`: add `SourceControlDeps { openRecentProject(root: string): Promise<void> }`, then `sourceControlCommands(deps = NO_SOURCE_CONTROL_DEPS)` and `registerSourceControlCommands(registry, deps?)`. Add these records (category "Source Control", group `"7_scm"`, no `aiTool`), reusing the existing helpers. `git.fetch`, `git.pull` and `git.commitAndSync` take `git.push`'s remote gate if that decision holds.

   | id                  | title                 | args                                     | run                                                                                    |
   | ------------------- | --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
   | `git.refresh`       | Refresh               | none                                     | `refreshGitStatus()`                                                                   |
   | `git.fetch`         | Fetch                 | none                                     | `gitAction("gitFetch")`                                                                |
   | `git.pull`          | Pull                  | none                                     | `doPull()`                                                                             |
   | `git.commit`        | Commit                | `message?` (`stringProperty`)            | `doCommit(message)`                                                                    |
   | `git.commitAndSync` | Commit and Sync       | `message?`                               | `doCommitAndSync(message)`                                                             |
   | `git.stage`         | Stage                 | `path` (derived: unstaged)               | `gitAction("gitStage", [path])`                                                        |
   | `git.stageAll`      | Stage All             | none                                     | today's `stageAll` body                                                                |
   | `git.unstage`       | Unstage               | `path` (derived: staged)                 | `gitAction("gitUnstage", [path])`                                                      |
   | `git.unstageAll`    | Unstage All           | none                                     | today's `unstageAll` body                                                              |
   | `git.discard`       | Discard Changes       | `path` (derived: unstaged, not `U`)      | `discardFile(path)`, `destructive: true`                                               |
   | `git.checkout`      | Switch Branch         | `branch` (derived: `shell.git.branches`) | no-op on the current branch, else `gitAction("gitCheckout", branch)`                   |
   | `git.createBranch`  | Create Branch…        | `name?`                                  | prompt ("New Branch", as today) when absent, then `gitAction("gitCreateBranch", name)` |
   | `git.clone`         | Clone Git Repository… | none                                     | `cloneRepository({ openRecentProject: deps.openRecentProject })`; `application` level  |

   `doCommit` and `doCommitAndSync` take the resolved message. A shared `commitMessage(title, args)` helper returns the trimmed `args.message`, else reads and clears the field, and throws the `RangeError` when both are empty.

3. `ACTIONS`: every capability entry runs its record through `runActiveReported`.
   - `chooseBranch` keeps the `_branchOverride` handling around `await runActiveReported("git.createBranch", …)`, and otherwise runs `git.checkout` with `{ branch }`.
   - `openCommitMenu` builds its one row with `commandRow(registry, registry.get("git.commit"), { source: SOURCE })`, and opens nothing when the registry or the record is absent.
   - `clone` runs `git.clone`. `openFile`, `editMessage` and `selectTab` are unchanged.
4. Projection:
   - `controls` gains `refresh`, `fetch`, `pull` (with the behind count as suffix), `commit`, `commitAndSync`, `stageAll`, `unstageAll` and `clone`.
   - `commit` and `commitAndSync` are disabled while the field is empty.
   - `canClone` becomes `controls.clone.visible`, and `pullLabel` goes.
   - `fileRowView(file, registry)` gains `stageName`, `unstageName` and `discardName` (`<title>: <path>`). It also gains `discardHint`: the record's hint, or `` `${title} — requires a file git already tracks` `` for `U`.
   - The picker's last option is labelled with `git.createBranch`'s title.
5. `git-panel.json`: bind every one of those controls, as in GPA1.1. The no-project `clone-slot` switches on `#/state/controls/clone/visible`.
6. Remove `cloneRepository` from `GitPanelDeps` and from `NavigatorPanelDeps` (`src/panels/panel-registry.ts`), and from `leftPanelMod.mount` in `src/studio.ts`. `studio.ts` calls `registerSourceControlCommands(commandRegistry, { openRecentProject })`. Update `git.init`'s rule-3 comment.

**GPA1.3: the welcome screen, and the flip**

1. `src/commands/context.ts`: add `"addRepository"` to `CAPABILITIES` and `addRepository: false` to `emptyContext()`. `src/commands/live-context.ts` sets `addRepository: has("listRepos") && has("importProject")`. `platformSupportsAddRepo` stays, for `platformUsesRepoPicker`.
2. `src/new-project/add-repo-modal.ts`: add `addRepositoryCommands(deps = {})` and `registerAddRepositoryCommands`. The record is `project.addRepository`, "Add Existing Repository…": category "Project", `application` level, `icon: "cube"`, `menus: ["palette"]`, group `"1_file"`, `when: (ctx) => ctx.capability.addRepository`. Its `run` is `void openAddRepoModal().then((r) => r && deps.onAdded?.(r.root))`, without awaiting, for `project.new`'s reason. Spread it in `appCommandSet()` (`tests/app-commands-composition.test.ts` enforces that). `studio.ts` registers it with the welcome context's old `addExistingRepo` body as `onAdded`.
3. `src/new-project/new-project-modal.ts`: `newProjectCommands(deps = {})` and `registerNewProjectCommands(registry, deps?)`. The `run` becomes `void openNewProjectModal(opts).then((r) => { if (r) deps.openCreated?.(r.root); })`. `studio.ts` passes `openCreated: (root) => void openRecentProject(root)`.
4. The Start records gain icon keys: `project.new` "plus", `project.open` "folder-open" (`src/commands/defaults.ts`), `git.clone` "download-simple".
5. `src/surfaces/welcome.ts`:
   - `startActions()` builds the list from `START_COMMANDS = ["project.new", "project.open", "git.clone", "project.addRepository"]` through `activeRegistry()`. Each visible record becomes `{ id, title: command.title, icon: command.icon ?? "" }`.
   - `state()` starts one `effect` with the scope that writes `actions = startActions()`, and `project()` stops returning `actions`. The effect is what makes the list complete: `studio.ts` calls `render()` in its normal-mode branch well before `initShortcuts` publishes the registry, and `renderWelcome` is not reactive, so a list read there would stay empty until an unrelated repaint.
   - `run(id)` is `void runActiveReported(id, undefined, "Welcome")`.
   - `WelcomeCtx` keeps only `openRecentProject`, and `studio.ts`'s `initWelcome` call shrinks to match.
6. Delete `platformSupportsClone` from `git-panel.ts`, which has no caller left, and its tests.

**Integration contract.**

- After GPA1.1:
  - `src/commands/projection.ts` exports `CommandControlView`, `commandControl` and `commandTooltip`, and `commandbar.ts` still re-exports `commandTooltip`. `plan:studio-ui-guidelines/name-and-chord-gaps` adds `placementRows` to this module instead of creating it, and may draw the dock's close button with `commandControl`. `plan:studio/file-tree-command-records` imports `commandControl` from `commands/projection.ts`, not the `commands/command-control.ts` its text names.
  - Both Create buttons print the record's title.
  - `git.createGithubRepository` refuses a repository with no commit before signing in, and, if the remote decision holds, `ctx.git.hasRemote` exists and gates Create and Push.
  - `createGithubRepository({ projectName })`, `REPO_STEPS` and the activity's messages are unchanged.
  - The Packages table cannot remove a package `packages.remove` refuses.
- After GPA1.2:
  - `commandRow(registry, command, { dividerAbove?, args?, source? })` exists, with the stutter rule and the `runReported` row, so `name-and-chord-gaps`'s `placementRows` and its five menus reuse it.
  - The commit menu draws its row from the `git.commit` record by id, not from a placement. `plan:studio-ui-guidelines/conventions-checklist` words §10's menu item to admit that, or gives the menu a placement.
  - The thirteen records above exist, with the ids, arguments and gates the table gives.
  - `sourceControlCommands(deps?)` and `registerSourceControlCommands(registry, deps?)` take optional dependencies.
  - Every repository write the panel makes goes through a record's `run`. Only reads bypass the registry: the status poll, the History log and `openFile`'s comparison.
  - `studio.md` §13's marker no longer names the Source Control panel.
- After GPA1.3:
  - `project.new` opens what it creates from every surface.
  - `project.addRepository` and `ctx.capability.addRepository` exist.
  - §12.5 reads Implemented.

## Tests

The suite is `packages/studio`, run as `bun test --isolate --coverage` from that directory. Its per-file thresholds are `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`; ratchet them if a slice raises the worst file. The new `src/commands/projection.ts` ships with `tests/command-projection.test.ts` in GPA1.1 (the file `plan:studio-ui-guidelines/name-and-chord-gaps` later extends), or `bun scripts/check-coverage-manifest.ts packages/studio` fails. A DOM test imports `./with-dom.js` or `./harness` first, as today.

Two suites share a harness for the git panel:

- `git-panel-gaps.test.ts` and `git-panel-states.test.ts` create a registry with `createCommandRegistry` and a `getContext` read from `projectState` and `shell.git` (`isRepo`, and `hasRemote` if it lands), register `registerSourceControlCommands`, and call `setActiveRegistry` in `beforeEach` and `setActiveRegistry(null)` in `afterEach`.
- Their platform stub's `gitLog` answers one entry unless a case says otherwise. `source-control-commands.test.ts`'s `mockPlatform` gains the same `gitLog`: it has none today, and `getPlatform().gitLog(1)` on an absent method throws a `TypeError` before `.catch` can see it, which would break both existing Create cases.

**GPA1.1**

- `command-projection.test.ts`:
  - "a null registry or an unknown id draws a disabled, unnamed skeleton"
  - "an enabled record's hint is its title with its chord"
  - "a refused record is disabled and its hint names the requires sentence"
  - "a suffix composes into the label and the hint, never the title"
  - "a hidden record is invisible and disabled"
  - "commandTooltip keeps its old answers"
- `git-panel-gaps.test.ts`:
  - The bypass case is rewritten as "the no-repo state draws Create GitHub Repository from its record, disabled, the reason in its title". It asserts `[part="control"]` is `disabled`, its `title` is the record's `requires` sentence after "Create GitHub Repository — requires ", and `publishCalls` is empty.
  - New: "a click that reaches the refused record files the refusal under Source Control and creates nothing". The click lands on the host, which fires `onclick` even while the inner control is disabled.
  - "the no-remote sync bar's publish falls back to a default project name" becomes "the no-remote sync bar's create runs the record", keeping its `my-project` assertion.
  - "initialize repository runs gitInit and refreshes" becomes "initialize repository runs the record" (gitInit, refresh, both notices).
- `git-panel-states.test.ts`:
  - "a project git is not tracking offers both ways to start" asserts the record titles and Create's disabled state.
  - "ahead and behind counts reach the label and both button names" reads `controls.push.label`.
  - New: "with no registry published, the command-backed controls draw disabled rather than guessing".
- `source-control-commands.test.ts`:
  - "Create GitHub Repository refuses a repository with no commit, before anything is created". Covers `gitLog` answering `[]` and rejecting: a `RangeError`, and `repoCalls` empty.
  - "…and proceeds once HEAD has a commit".
  - If the remote decision holds: "Create is refused on a repository that already has a remote" and "Push is refused without a remote", through `registry.isEnabled` and `disabledReason`.
- `commands-live-context.test.ts`, if it holds: `hasRemote` from `status.remotes`, and `false` with no status or no array.
- `dependencies-editor.test.ts`: "remove calls removePackage" stays green (no extension enables the package). New: "remove refuses a package an enabled extension still needs, and removes nothing" (`project.json` enabling it; `removePackage` not called; the progress modal fails with the function's sentence).
- `deploy-checklist.test.ts`, unless the sweep has landed: "a refused step is filed in Problems under" the sweep's source.
- `run-reported.test.ts`, unless the sweep has landed: the ratchet entry goes, and "the ratchet names only files that still spell it bare" proves it.

**GPA1.2**

- `source-control-commands.test.ts`:
  - "four verbs, one category, ids in the lowercase git namespace" becomes "the family": ids, category, one `requires` across every repository writer (two if the remote decision holds), and no `aiTool`.
  - "Clone is application-level and gated on the gitClone capability".
  - One run case per record: fetch and pull refresh after; commit reads and clears the field; commit with `message` leaves the field; an empty message is a `RangeError`; commit and sync pushes after committing; stage and unstage one path; a path not in the status is refused by `coerceArgs`; discard confirms and refuses `U`; checkout is a no-op on the current branch; create branch prompts only without `name`; clone passes `openRecentProject`.
- `command-projection.test.ts`, the `commandRow` cases `name-and-chord-gaps` lists, so it inherits them: "commandRow prints the title, the chord through formatBinding, and destructive from the record"; "a chord that restates the title is not printed"; "a disabled record's row carries its requires sentence and no run"; "with a source, an enabled row runs through runReported and a refusal is filed under that source"; "without a source a row carries no run of its own".
- `git-panel-gaps.test.ts`:
  - The sync bar, commit form, branch picker and file-row cases keep their platform assertions, now through the records.
  - The commit-menu case asserts one row, `id: "git.commit"`, title "Commit".
  - New: "every control the document draws runs its record". A fresh registry holds a spy record under each `git.*` id; the case clicks every control and asserts each spy ran and no platform method was called.
  - New: "the commit buttons are disabled while the message is empty, and say why".
- `left-panel.test.ts` and `rail.test.ts` drop the `cloneRepository` dependency. In `studio-shell.test.ts`, "clone-repository delegates report unsupported platforms" loses its left-panel half.

**GPA1.3**

- `welcome-screen.test.ts`:
  - The four "start commands" cases are rewritten against a published registry, and its context mock shrinks to `openRecentProject`.
  - "the Start list is the four records, titled and iconed by the registry"
  - "a record whose `when` fails is not listed"
  - "a tile runs its record, and a refusal is filed under Welcome"
  - "no registry, no tiles and no throw"
  - "the tiles appear when the registry is published after the pane mounted"
- `studio-shell.test.ts`: the `new-project-modal.ts` and `add-repo-modal.ts` mocks gain `registerAddRepositoryCommands` and capture the deps both register calls receive. The four welcome-callback cases and the welcome half of the clone case become "openCreated opens the created project" and "onAdded refreshes the catalogue and opens the added repository", so `studio.ts`'s new closures stay covered.
- `project-gap-commands.test.ts`: "project.new opens the project the wizard created" and "…and nothing when it is dismissed".
- `add-repo-modal.test.ts`: "project.addRepository is gated on the capability and hands the added root on".
- `commands-live-context.test.ts`: `addRepository` from `listRepos` and `importProject`.
- `ai-command-tools.test.ts`: `WAITS_ON_A_PERSON` gains `project.addRepository`.

## Specs & docs

**GPA1.1**

`specs/studio-ui-guidelines.md`, edited in place:

- §12.3's marker: delete the last clause, "and the Source Control panel's "Create GitHub repository" renames `git.createGithubRepository` (`src/surfaces/git-panel.json`)". The Bottom dock clause becomes the list's last item, so it takes the "and".
- §12.4's marker: delete ", and the `git.*` row's failure returns through the Source Control panel, which is §12.5's". Unless the sweep has landed, "Thirteen modules" also becomes "Twelve modules".
- §12.5's marker becomes: "**Status: Partial.** The tab strip, the outline, the block bar and the Command Bar draw from placements, and the Source Control panel draws Initialize Repository, Create GitHub Repository and Push from their records. The panel's other verbs are still defined by `ACTIONS` in `packages/studio/src/panels/git-panel.ts` rather than by records. The welcome screen's Start list (`src/surfaces/welcome.ts`) duplicates `project.new` and `project.open` and disagrees with the first: its tile opens the project the wizard creates, and the record's `run` opens nothing."
- Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "The Source Control panel draws Initialize Repository, Create GitHub Repository and Push from their records, so §12.3 and §12.4 no longer name it, and §12.5 names what remains: the panel's other verbs and the welcome screen's Start list"`.

`specs/studio.md`:

- §5.5 gains a paragraph before "Layout": with no repository the panel offers Initialize Repository and Create GitHub Repository, and a repository with no remote offers Create again in the sync bar; both are the `git.init` and `git.createGithubRepository` records. Create is refused on a project git does not track or that already has a remote, which its `requires` says, and its `run` refuses a repository with no commit before it signs in or creates anything, because an unborn branch cannot be pushed. Push requires a remote. (The remote clauses assume that decision holds.)
- §13.4's `git` row gains `hasRemote`, if it holds.
- Fragment: `bun run spec:change studio.md minor -m "§5.5: Create GitHub Repository refuses a project with no commit or with a remote already, and §13.4 gains git.hasRemote, the gate on the remote verbs"`.

Docs (`bun run docs:sync` names `docs/studio/publish/source-control.md` and `docs/studio/publish.md` through `git-panel.ts` and `deploy-checklist.ts`, `docs/studio/projects/settings.md` through `dependencies-editor.ts`, and four pages through `commandbar.ts`, which need nothing because `commandTooltip` moves without changing an answer). No sentence below may carry an em dash (`bun run docs:prose`):

- `docs/studio/publish/source-control.md`: the no-repository paragraph says Create GitHub Repository waits until the project is tracked and has a commit, and that hovering it says why. The "Local only (no remote)" sentence and the Create row of the "Without the panel" table use the record's title, and the row adds that it needs a commit.
- `docs/studio/publish/github.md`, "Put the project on GitHub": the same facts; commit first. The button's label becomes "Create GitHub Repository" in lines 40 and 42. Line 47 names the activity, whose title stays "Create GitHub repository", so it does not change.
- `docs/start/first-project.md`: the label, and commit before Create GitHub Repository.
- `docs/studio/publish.md`, under the checklist table: Create GitHub Repository needs a commit to push, and on a project without one it says so in Problems and creates nothing.
- `docs/studio/projects/settings.md`, Packages: a row's remove button refuses a package an enabled extension still needs, and says to turn the extension off first.

The screenshots lane re-captures `git-panel.png`.

**GPA1.2**

`specs/studio.md`:

- §5.5 gains a paragraph after "Layout": every control in the panel is a rendering of a `Source Control:` record (`git.init`, `git.createGithubRepository`, `git.push`, `git.fetch`, `git.pull`, `git.refresh`, `git.commit`, `git.commitAndSync`, `git.stage`, `git.stageAll`, `git.unstage`, `git.unstageAll`, `git.discard`, `git.checkout`, `git.createBranch`, `git.clone`). A row's click opens its comparison, and the branch picker dispatches to `git.checkout` or `git.createBranch`. Under Branch Management, `"+ New branch..."` becomes "Create Branch…".
- §13's marker: delete the Source Control clause, and give the Library clause the list's "and".
- Fragment: `bun run spec:change studio.md minor -m "§5.5: every Source Control control is a git command record, so the panel's verbs are in the palette and scriptable, and §13 no longer lists them"`.

`specs/studio-ui-guidelines.md`:

- §12.4 rule 3 becomes: "**Outside the tree, irreversible, and the model has no read to judge by.** The `git.*` family, `git.commit` included, and `publish.deploy`: the model cannot read the working tree's status or the remote, so it cannot judge what a commit, a push or a discard would carry." This assumes the recommendation holds.
- §12.5's marker keeps only its welcome-screen sentence.
- §10's marker: "and the Source Control panel draws from its own `ACTIONS`" becomes "and the welcome screen's Start list is a list of its own".
- Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "§12.4 keeps the git family, commit included, out of the assistant's tools, and §12.5 names only the welcome screen's Start list"`.

Docs:

- `docs/studio/publish/source-control.md`:
  - "Commit and sync" becomes "Commit and Sync".
  - "Commit (don't sync)" becomes "Commit".
  - "+ New branch…" becomes "Create Branch…".
  - If the remote decision holds, Commit and Sync needs a remote, and on a local-only project a commit is the button's menu or Ctrl+Enter.
  - "Without the panel" says every verb is a Source Control command in Quick Access, keeps the table to the four that change setup, and links `docs/studio/interface/commands.md` for the rest. Its claim that the AI assistant can run them is false today and goes: the assistant does not, because it cannot read the working tree.
- "Commit and Sync" in `docs/studio/publish.md`, `docs/studio/publish/github.md`, `docs/studio/publish/other-hosts.md`, `docs/studio/publish/cloudflare.md`, `docs/start/first-project.md`, `docs/start/coming-from-wordpress.md`, `docs/start/coming-from-webflow.md` and `docs/start/coming-from-wix.md`.
- The generated `docs/studio/interface/commands.md` picks the records up with no edit.
- The screenshots lane re-captures `git-panel.png` and `git-commit.png`.

**GPA1.3**

`specs/studio-ui-guidelines.md`:

- §12.5's marker becomes: "**Status: Implemented.** The tab strip, the outline, the block bar, the Command Bar, the Source Control panel and the welcome screen draw their controls from command records and run them through the registry (`packages/studio/src/panels/git-panel.ts`, `src/surfaces/welcome.ts`), and no surface calls past a record's refusal: the Packages table's Remove runs the function `packages.remove` runs (`src/settings/dependencies-editor.ts`)."
- §12.4 rule 2's set gains `project.addRepository`.
- §10's marker: "inherit §12.3's and §12.5's: the rail prints no chord, the tab-strip and Files-tree menus carry none, and the welcome screen's Start list is a list of its own" becomes "inherit §12.3's: the rail prints no chord, and the tab-strip and Files-tree menus carry none". The count of five stands, because both items still wait on §12.3.
- Fragment: `bun run spec:change studio-ui-guidelines.md minor -m "§12.5: the Source Control panel and the welcome screen draw every control from its command record, and New Project opens what it creates from every surface"`.

`specs/studio.md`:

- §13.4's `capability` row gains `addRepository`.
- Fragment: `bun run spec:change studio.md minor -m "§13.4: the capability keys gain addRepository, the gate on Add Existing Repository"`.

Docs:

- `docs/studio/interface/welcome-screen.md` gains one sentence: the four start actions are also commands in Quick Access.
- `docs/studio/projects/create.md` does not change. Its "and opens it" is now true from every entry point.
- `docs/studio/projects.md` lists `welcome.ts` in `code:`; re-read it, and expect no change.

This plan does not close `studio-ui-guidelines.md`'s last open item, so there is no graduation. The PR that lands GPA1.3 deletes this file and removes `studio-ui-guidelines/git-panel-action-list` from every dependent's `requires`.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage`: green, and no file under its threshold.
- `bun scripts/check-coverage-manifest.ts packages/studio`.
- `bun scripts/check-command-levels.ts`, `bun scripts/check-chrome-budget.ts`, `bun scripts/check-shot-contract.ts`, `bun run typecheck` and `bun run lint`.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:section-refs` and `bun run plans:check`.
- `rg -n "createGithubRepository\(" packages/studio/src/panels/git-panel.ts` shows one call, inside the record's `run`.
- `rg -n "removePackage" packages/studio/src/settings/dependencies-editor.ts` prints nothing.
- `ACTIONS` in `packages/studio/src/panels/git-panel.ts` contains no `gitAction(`, `getPlatform(` or `createGithubRepository(` call. Read the object; the mechanical proof is the spy case in `git-panel-gaps.test.ts`.
- By hand in Studio: open a folder git does not track. Create GitHub Repository is disabled, and hovering it says why. Initialize it: Create is enabled, and clicking it files "…needs a commit to push" under Source Control with nothing created on GitHub. On a repository with a remote, the palette shows Create GitHub Repository disabled with its reason. From the palette, New Project… opens the project it creates.

## Slices

| Slice  | Scope                                                                                                                                                                                                                                                                                                                                   | Claims                       | State |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----- |
| GPA1.1 | `commands/projection.ts`; Initialize, Create and Push drawn from and run through their records; Create disabled with its reason when there is no repository; the no-commit refusal and the remote gate; the Packages table's Remove; the deploy checklist runs reported; the §12.3, §12.4 and §12.5 markers; `studio.md` §5.5 and §13.4 | —                            | open  |
| GPA1.2 | The panel's other capabilities as `git.*` records, with `git.clone`; every control drawn from and run through a record; `commandRow`; `studio.md` §5.5 and §13; §12.4 rule 3; §10's marker                                                                                                                                              | —                            | open  |
| GPA1.3 | The welcome Start list from records; `project.new` opens what it creates; `project.addRepository` with its capability; §12.4 rule 2 and §10 riders                                                                                                                                                                                      | studio-ui-guidelines.md#12.5 | open  |
