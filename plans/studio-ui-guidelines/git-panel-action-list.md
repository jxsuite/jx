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

- `ACTIONS: GitPanelActions` in `packages/studio/src/panels/git-panel.ts` has nineteen entries. Three have a record in `sourceControlCommands()` (same file): `initRepository` (`git.init`), `createRepository` (`git.createGithubRepository`: `enablement: (ctx) => ctx.project.isRepo`, `requires: "a project tracked by git"`) and `push` (`git.push`). `createRepository` calls `createGithubRepository({ projectName })` (`src/github/github-publish.ts`) with no gate.
- `src/surfaces/git-panel.json` draws that button twice as the literal "Create GitHub repository": in `view-slot` case `no-repo` (the bypass) and in `remote-slot` case `local` (where the gate holds). Every control's `disabled` is `#/state/busy` alone.
- `createGithubRepository` creates the repository (`auto_init: false`), then runs `platform.gitAddRemote`, which fails outside a repository: "The repository was created, but the remote could not be added." `git-panel-gaps.test.ts`'s "publish in the non-repo state calls createGithubRepository with the project name" pins the bypass.
- The other sixteen entries have no record. Capabilities: `clone` (the injected `cloneRepository`, which the welcome screen also calls), `commit`, `commitAndSync`, `fetch`, `pull`, `refresh`, `stageAll`, `unstageAll`, and the row verbs `stage`, `unstage`, `discard`. Row activation: `openFile`. Input handlers: `editMessage`, `chooseBranch`, `selectTab`, `openCommitMenu`. The commit menu's one row carries the id `git.commitWithoutSync`, which names no record.

**Found by this pass (census corrections)**

- **The same failure gets past the gate.** The New Project wizard runs `git init` on a new project and makes no commit (`initProjectRepo`, `src/files/files.ts`). On such a project the local sync bar's Create button is enabled. It creates the repository and adds the remote, then fails at the push, because `gitPush({ setUpstream: true })` runs `git rev-parse --abbrev-ref HEAD` and that fails on an unborn branch (`packages/desktop/src/git.ts`, the push route in `packages/server/src/studio-api.ts`). The deploy checklist's remote step runs the same record, bare (`runNextStep`, `src/publish/deploy-checklist.ts`).
- **The census missed a second list.** The welcome screen's Start list (`project()` in `src/surfaces/welcome.ts`: `StartAction { id, title, icon }` plus a `run` switch over injected callbacks) duplicates `project.new` and `project.open`, and it disagrees with `project.new`. The tile opens the project the wizard created (`openNewProject` in `src/studio.ts`). `project.new`'s `run` throws the wizard's result away (`newProjectCommands`, `src/new-project/new-project-modal.ts`), so New Project… from the palette or the Studio menu creates a project and opens nothing, although `docs/studio/projects/create.md` says it opens. The list's other two tiles, Clone Git Repository… and Add Existing Repository…, have no record. `studio.md` §13's marker leaves out clone, refresh and add-repository.
- **Checked, and not second lists.**
  - The canvas's derivation notice takes its one action from the `pane.pin` record (`src/canvas/canvas-render.ts`).
  - `openPageAction()` (`src/panels/empty-state.ts`) is one shared empty-state verb. It runs `openQuickSearch("files")`, the same call `palette.openFiles` makes, and §11.1 rule 2 governs its "Open a page…" label, so the label is a question for §11 and §12.3, not a second list.
  - The Cloudflare connect flow is written twice (`src/publish/publish-panel.ts`, `src/settings/preferences-accounts.ts`), but neither copy is a record, so it belongs to `studio.md` §13's residue.

**Related**

- `studio.md` §5.5 (the panel) and §13 (the registry). `plan:studio/file-tree-command-records` owns §13 and waits on this plan's git records.
- `studio-ui-guidelines.md` §12.3: `plan:studio-ui-guidelines/name-and-chord-gaps` requires this plan for the renamed Create button.
- `studio-ui-guidelines.md` §12.4: `plan:studio-ui-guidelines/run-reported-sweep`, whose ratchet this plan shrinks by one.
- `studio-ui-guidelines.md` §10: `plan:studio-ui-guidelines/conventions-checklist`.
- `plan:desktop/github-token-stays-in-launcher` rewrites the inside of `createGithubRepository` and depends only on its signature, which this plan keeps.

## Outcome

- `studio-ui-guidelines.md` §12.5 → Implemented, at GPA1.3.
- The riders stay in the owners' sections and leave their markers open:
  - §12.3's and §12.4's markers drop their git clauses (GPA1.1).
  - §12.4's rule 3 (GPA1.2) and rule 2 (GPA1.3) are rewritten.
  - §10's marker stops citing §12.5 (GPA1.3).
  - `studio.md` §5.5 names the records and §13's marker drops the panel's verbs (GPA1.2); §13.4 gains `addRepository` (GPA1.3).
- Both specs stay Partial. Nothing graduates.

## Decisions

- **Open:** What the no-repository state offers. Recommendation: Initialize Repository, enabled, beside Create GitHub Repository drawn from its record: disabled, with `requires` as its tooltip. §12.3 and §10 require a control that cannot act to render disabled with its reason, and the pair teaches the order. Hiding the button loses that. A create verb that initialises first cannot succeed either: an unborn branch cannot be pushed, so the verb would also have to commit every file under a message the author never wrote.
- **Open:** Whether `git.createGithubRepository` refuses a repository with no commit. Recommendation: yes, as the first thing its `run` does. `platform.gitLog(1)` rejecting or answering `[]` throws a `RangeError`, before any sign-in or request. Without this, Initialize then Create (the path above) and every wizard-made project still leave an empty repository on the person's account. §12.4's corollary allows a `run` refusal for what `enablement` cannot see. Making it a context key instead would need a new `GitStatus` field on three backends.
- **Open:** Which of the sixteen entries become records. Recommendation: every capability (the table under GPA1.2), `clone` included. `openFile` stays the row's own activation, the way an outline row's click is, and keeps its refusals in the panel's banner (`studio.md` §5.5, File Rows). `editMessage`, `selectTab`, `openCommitMenu`, and `chooseBranch` (which dispatches to `git.checkout` or `git.createBranch`) stay input handlers. Reason: `studio.md` §13 says every capability is a record, and its owner is waiting on this answer.
- **Open:** Whether `git.commit` projects to the assistant, which §12.4 rule 3 defers until "`git.commit` becomes a record". Recommendation: no, and rule 3 is rewritten to say so. The model has no read of the working tree's status or of the remote, and a commit, push or discard carries whatever is on disk.
- **Open:** Whether this plan also takes the welcome screen's Start list. Recommendation: yes, in GPA1.3. §12.5 cannot be Implemented while that list stands, and its New Project divergence is exactly the symptom the section names. `openPageAction` stays out, for the reason given in Context.
- **Decided:** A control runs its record through `runActiveReported(id, args, "Source Control")`. The panel is mounted by the Navigator with no registry injected, which is the Command Bar's and the status bar's situation too, and §12.4 routes a surface's refusal to Problems through that one helper.
- **Decided:** A new module, `src/commands/command-control.ts`, projects one record into a control, and `commandTooltip` moves into it. `commands/app-commands.ts` imports `git-panel.ts`, so the panel must stay loadable in a bare Bun process. `surfaces/commandbar.ts` is not, so the panel cannot import from it. `commandMenuRow` joins the module in GPA1.2.
- **Decided:** The projection folds `busy` into each control's `disabled`, because a document cannot compute `a || b`. The hint stays the record's.
- **Decided:** Every new record that writes the repository declares the family precondition (§12.4): `when: (ctx) => ctx.project.open`, `enablement: (ctx) => ctx.project.isRepo`, `requires: "a project tracked by git"`. `git.refresh` has `when` only, because reading status is how a project learns it is a repository. `git.clone` is `application`-level with `when: (ctx) => ctx.capability.gitClone`. Every new record is `menus: ["palette"]`, and the Studio menu is unchanged.
- **Decided:** Labels are record titles in Title Case (§10, §12.3): "Create GitHub Repository", "Commit and Sync", "Stage All", "Unstage All", "Create Branch…". The commit menu's row is the `git.commit` record, "Commit". A count is state, so the projection appends it to the title ("Push (1 ahead)"), as "Local Changes (6)" already does. A row button is named `<title>: <path>`.
- **Decided:** The panel keeps its error contract. A git command that fails lands in the panel's banner (`shell.git.error`); a refusal lands in Problems. Each event is reported once (§13.3).
- **Decided:** `git.commit` and `git.commitAndSync` take an optional `message`. Without one they read the field and clear it; an empty message is a `RangeError` saying "<title> requires a commit message.". The panel draws both buttons disabled while the field is empty, with the same noun phrase in the hint. Ctrl+Enter runs the record only when the field has text.
- **Decided:** A row verb takes `path` as a `derivedEnumProperty` over the last status read: unstaged paths for `git.stage`, staged paths for `git.unstage`, and unstaged tracked paths for `git.discard`. So `coerceArgs` refuses a path that is not there, and `git.discard` refuses an untracked one. `git.discard` is `destructive: true` and keeps its confirmation.
- **Decided:** `runNextStep` in the deploy checklist moves to `runActiveReported(…, "Publish")` in GPA1.1, and its `NOT_YET_CONVERTED` entry goes. The new refusal is asynchronous, and a bare `void activeRegistry()?.run()` would leave it as an unhandled rejection.
- **Decided:** A record that needs the bootstrap takes its dependencies with a no-op default, so `appCommandSet()`'s calls stay argument-free. That covers `sourceControlCommands({ openRecentProject })`, `newProjectCommands({ openCreated })` and `addRepositoryCommands({ onAdded })`.

## Implementation

**GPA1.1: the three records the panel already has, and the bypass**

1. `packages/studio/src/commands/command-control.ts` (new):
   - `export interface CommandControlView { id: string; title: string; label: string; hint: string; disabled: boolean; visible: boolean }`.
   - `export function commandControl(registry: CommandRegistry | null, id: string, suffix = ""): CommandControlView`.
     - With no registry, or no record under `id`, it returns `{ id, title: "", label: "", hint: "", disabled: true, visible: false }`.
     - Otherwise `label = title + suffix`, `visible = registry.isVisible(id)` and `disabled = !visible || !registry.isEnabled(id)`.
     - `hint` is `` `${label} — requires ${reason}` `` when `registry.disabledReason(id)` gives a reason, else `` `${label} (${chord})` `` when `keymap.formatBinding(id)` gives a chord, else `label`.
   - `export function commandTooltip(registry, id)` moves here from `surfaces/commandbar.ts`: `""` for an unknown id, otherwise `commandControl(registry, id).hint`. `commandbar.ts` re-exports it, so `tests/commandbar.test.ts` and the four `mock.module` stand-ins that stub it (`studio-shell.test.ts`, `studio-shell-fixture.ts`, `studio-shell-boot-gaps.test.ts`, `shell-misc-diff-gaps.test.ts`) still hold.
   - The module imports only types from `./registry`.
2. `src/surfaces/git-panel.ts`:
   - `GitPanelValues` gains `controls: GitPanelControls` (`init`, `createRepository`, `push`, each a `CommandControlView`) and loses `pushLabel`.
   - `project()` assigns `scope.controls`, and `emptyValues()` seeds three skeleton views.
3. `src/panels/git-panel.ts`:
   - `gitPanelValues()` reads `activeRegistry()` and builds `controls` through `commandControl`, with `disabled: true` while `loading`. Push's suffix is `` ` (${ahead})` `` when ahead. The mount's `effect` already tracks the registry holder and, through `createLiveContext`, `shell.git.status`, so nothing else needs wiring.
   - `ACTIONS.initRepository`, `.createRepository` and `.push` each become `void runActiveReported(<id>, undefined, SOURCE)`, with `const SOURCE = "Source Control"`.
   - `git.createGithubRepository`'s `run` calls a new private `refuseWithoutCommit()` first. It awaits `getPlatform().gitLog(1).catch(() => [])`, and an empty answer throws `new RangeError(NO_COMMIT_TO_PUSH)` with the sentence "Create GitHub Repository needs a commit to push: commit your changes first." Rewrite the record's comment to state both refusals.
4. `src/surfaces/git-panel.json`:
   - `init`: `textContent` becomes `${state.controls.init.label}`, and `hint` and `disabled` come from `#/state/controls/init/…`.
   - Both `create-repository` buttons do the same from `controls.createRepository`, and the literal goes.
   - `push`: `label`, `hint` and `disabled` come from `controls.push`.
   - Update the document's `$description`.
5. `src/publish/deploy-checklist.ts`, `runNextStep`: `void runActiveReported(next.command, undefined, "Publish")`.

**GPA1.2: the panel's other capabilities as records**

1. `command-control.ts` adds `commandMenuRow(registry, id, dividerAbove = false): MenuRowProjection | null`. It returns `null` for an absent or hidden record. Otherwise it returns the `overflowRows` shape from `commandbar.ts`: `id`, `title`, `disabled`, `destructive` from the record, `dividerAbove`, and `chord` and `requires` when present.
2. `git-panel.ts`: add `SourceControlDeps { openRecentProject(root: string): Promise<void> }`, then `sourceControlCommands(deps = NO_SOURCE_CONTROL_DEPS)` and `registerSourceControlCommands(registry, deps?)`. Add these records (category "Source Control", group `"7_scm"`, no `aiTool`), reusing the existing helpers:

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
   - `openCommitMenu` builds its one row with `commandMenuRow(registry, "git.commit")` and a `run` that calls `runActiveReported`.
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

1. `src/commands/context.ts`: add `"addRepository"` to `CAPABILITIES` and `addRepository: false` to `emptyContext()`. `src/commands/live-context.ts` sets `addRepository: has("listRepos") && has("importProject")`.
2. `src/new-project/add-repo-modal.ts`: add `addRepositoryCommands(deps = {})` and `registerAddRepositoryCommands`. The record is `project.addRepository`, "Add Existing Repository…": category "Project", `application` level, `icon: "cube"`, `menus: ["palette"]`, group `"1_file"`, `when: (ctx) => ctx.capability.addRepository`. Its `run` is `void openAddRepoModal().then((r) => r && deps.onAdded?.(r.root))`, without awaiting, for `project.new`'s reason. Spread it in `appCommandSet()` (`tests/app-commands-composition.test.ts` enforces that). `studio.ts` registers it with the welcome context's old `addExistingRepo` body as `onAdded`.
3. `src/new-project/new-project-modal.ts`: `newProjectCommands(deps = {})` and `registerNewProjectCommands(registry, deps?)`. The `run` becomes `void openNewProjectModal(opts).then((r) => { if (r) deps.openCreated?.(r.root); })`. `studio.ts` passes `openCreated: (root) => void openRecentProject(root)`.
4. The Start records gain icon keys: `project.new` "plus", `project.open` "folder-open" (`src/commands/defaults.ts`), `git.clone` "download-simple".
5. `src/surfaces/welcome.ts`:
   - `project()` builds `actions` from `START_COMMANDS = ["project.new", "project.open", "git.clone", "project.addRepository"]` through `activeRegistry()`. Each visible record becomes `{ id, title: command.title, icon: command.icon ?? "" }`.
   - `run(id)` is `void runActiveReported(id, undefined, "Welcome")`.
   - `WelcomeCtx` keeps only `openRecentProject`, and `studio.ts`'s `initWelcome` call shrinks to match.
   - The bootstrap publishes the registry in `initShortcuts` before the first frame, so the list is complete from the first paint.
6. Delete `platformSupportsClone` from `git-panel.ts`, which has no caller left, and its tests.

**Integration contract.**

- After GPA1.1:
  - `src/commands/command-control.ts` exports `CommandControlView`, `commandControl` and `commandTooltip`, and `commandbar.ts` still re-exports `commandTooltip`. `plan:studio-ui-guidelines/name-and-chord-gaps` can project the rail and the dock's close button with it.
  - Both Create buttons print the record's title.
  - `git.createGithubRepository` refuses a repository with no commit before signing in.
  - `createGithubRepository({ projectName })`, `REPO_STEPS` and the activity's messages are unchanged.
- After GPA1.2:
  - `commandMenuRow` exists for the tab-strip and Files-tree menus.
  - The thirteen records above exist, with the ids, arguments and gates the table gives.
  - `sourceControlCommands(deps?)` and `registerSourceControlCommands(registry, deps?)` take optional dependencies.
  - Every write the panel makes goes through a record's `run`. Only reads bypass the registry: the status poll, the History log and `openFile`'s comparison.
  - `studio.md` §13's marker no longer names the Source Control panel.
- After GPA1.3:
  - `project.new` opens what it creates from every surface.
  - `project.addRepository` and `ctx.capability.addRepository` exist.
  - §12.5 reads Implemented.

## Tests

The suite is `packages/studio`, run as `bun test --isolate --coverage` from that directory. Its per-file thresholds are `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`; ratchet them if a slice raises the worst file. The new `src/commands/command-control.ts` ships with `tests/command-control.test.ts` in GPA1.1, or `bun scripts/check-coverage-manifest.ts packages/studio` fails. A DOM test imports `./with-dom.js` first, as today.

Two suites share a harness for the git panel:

- `git-panel-gaps.test.ts` and `git-panel-states.test.ts` create a registry with `createCommandRegistry` and a `getContext` read from `projectState` and `shell.git`, register `registerSourceControlCommands`, and call `setActiveRegistry` in `beforeEach` and `setActiveRegistry(null)` in `afterEach`.
- Their platform stub's `gitLog` answers one entry unless a case says otherwise.

**GPA1.1**

- `command-control.test.ts`:
  - "a null registry or an unknown id draws a disabled, unnamed skeleton"
  - "an enabled record's hint is its title with its chord"
  - "a refused record is disabled and its hint names the requires sentence"
  - "a suffix composes into the label and the hint, never the title"
  - "a hidden record is invisible and disabled"
  - "commandTooltip keeps its old answers"
- `git-panel-gaps.test.ts`:
  - The bypass case is rewritten as "the no-repo state draws Create GitHub Repository from its record, disabled, the reason in its title". It asserts `[part="control"]` is `disabled`, its `title` is "Create GitHub Repository — requires a project tracked by git", and `publishCalls` is empty.
  - New: "a click that reaches the refused record files the refusal under Source Control and creates nothing". The click lands on the host, which fires `onclick` even while the inner control is disabled.
  - "the no-remote sync bar's create runs the record" keeps its `my-project` fallback assertion.
  - "initialize repository runs the record" (gitInit, refresh, both notices).
- `git-panel-states.test.ts`:
  - "a project git is not tracking offers both ways to start" asserts the record titles and Create's disabled state.
  - "ahead and behind counts reach …" reads `controls.push.label`.
  - New: "with no registry published, the command-backed controls draw disabled rather than guessing".
- `source-control-commands.test.ts`:
  - "Create GitHub Repository refuses a repository with no commit, before anything is created". Covers `gitLog` answering `[]` and rejecting: a `RangeError`, and `repoCalls` empty.
  - "…and proceeds once HEAD has a commit".
- `deploy-checklist.test.ts`: "a refused step is filed in Problems under Publish".
- `run-reported.test.ts`: the ratchet entry goes, and "the ratchet names only files that still spell it bare" proves it.

**GPA1.2**

- `source-control-commands.test.ts`:
  - "the family": ids, category, one `requires` across every writer, and no `aiTool`.
  - "Clone is application-level and gated on the gitClone capability".
  - One run case per record: fetch and pull refresh after; commit reads and clears the field; commit with `message` leaves the field; an empty message is a `RangeError`; commit and sync pushes after committing; stage and unstage one path; a path not in the status is refused by `coerceArgs`; discard confirms and refuses `U`; checkout is a no-op on the current branch; create branch prompts only without `name`; clone passes `openRecentProject`.
- `command-control.test.ts`: "commandMenuRow carries chord, requires and destructive from the record", and "an absent record is no row".
- `git-panel-gaps.test.ts`:
  - The sync bar, commit form, branch picker and file-row cases keep their platform assertions, now through the records.
  - The commit-menu case asserts one row, `id: "git.commit"`, title "Commit".
  - New: "every control the document draws runs its record". It swaps each `git.*` record for a spy with the same id, clicks every control, and asserts each spy ran and no platform method was called.
  - New: "the commit buttons are disabled while the message is empty, and say why".
- `app-commands.test.ts` lists the new ids. `left-panel.test.ts`, `rail.test.ts` and `studio-shell*.test.ts` drop the `cloneRepository` dependency.

**GPA1.3**

- `welcome-screen.test.ts`:
  - "the Start list is the four records, titled and iconed by the registry"
  - "a record whose `when` fails is not listed"
  - "a tile runs its record, and a refusal is filed under Welcome"
  - "no registry, no tiles and no throw"
  - Its context mock shrinks to `openRecentProject`.
- `project-gap-commands.test.ts`: "project.new opens the project the wizard created" and "…and nothing when it is dismissed".
- `add-repo-modal.test.ts`: "project.addRepository is gated on the capability and hands the added root on".
- `commands-live-context.test.ts`: `addRepository` from `listRepos` and `importProject`.
- `ai-command-tools.test.ts`: `WAITS_ON_A_PERSON` gains `project.addRepository`.

## Specs & docs

**GPA1.1**

`specs/studio-ui-guidelines.md`, edited in place:

- §12.3's marker: delete the last clause, "and the Source Control panel's "Create GitHub repository" renames `git.createGithubRepository` (`src/surfaces/git-panel.json`)". The Bottom dock clause becomes the list's last item, so it takes the "and".
- §12.4's marker: "Thirteen modules" becomes "Twelve modules". Delete ", and the `git.*` row's failure returns through the Source Control panel, which is §12.5's".
- §12.5's marker becomes: "**Status: Partial.** The tab strip, the outline, the block bar and the Command Bar draw from placements, and the Source Control panel draws Initialize Repository, Create GitHub Repository and Push from their records. The panel's other verbs are still defined by `ACTIONS` in `packages/studio/src/panels/git-panel.ts` rather than by records, and the welcome screen's Start list (`src/surfaces/welcome.ts`) duplicates `project.new` and `project.open`, whose `run` opens nothing after the wizard creates a project while the tile opens it."
- Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "The Source Control panel draws Initialize Repository, Create GitHub Repository and Push from their records, so §12.3 and §12.4 no longer name it, and §12.5 names what remains: the panel's other verbs and the welcome screen's Start list"`.

Docs (`bun run docs:sync` names the first page, through `code:`):

- `docs/studio/publish/source-control.md`: the no-repository paragraph says Create GitHub Repository waits until the project is tracked and has a commit, and that hovering it says why. The no-remote sentence uses the record's title.
- `docs/studio/publish/github.md`, "Put the project on GitHub": the same two facts; commit first. The label becomes "Create GitHub Repository" in all three places.
- `docs/start/first-project.md`: the label.

The screenshots lane re-captures `git-panel.png`.

**GPA1.2**

`specs/studio.md`:

- §5.5 gains a paragraph after "Layout": every control in the panel is a rendering of a `Source Control:` record (`git.init`, `git.createGithubRepository`, `git.push`, `git.fetch`, `git.pull`, `git.refresh`, `git.commit`, `git.commitAndSync`, `git.stage`, `git.stageAll`, `git.unstage`, `git.unstageAll`, `git.discard`, `git.checkout`, `git.createBranch`, `git.clone`). A row's click opens its comparison, and the branch picker dispatches to `git.checkout` or `git.createBranch`. Under Branch Management, `"+ New branch..."` becomes "Create Branch…".
- §13's marker: delete the Source Control clause, and give the Library clause the list's "and".
- Fragment: `bun run spec:change studio.md minor -m "§5.5: every Source Control control is a git command record, so the panel's verbs are in the palette and scriptable, and §13 no longer lists them"`.

`specs/studio-ui-guidelines.md`:

- §12.4 rule 3 becomes: "**Outside the tree, irreversible, and the model has no read to judge by.** The `git.*` family, `git.commit` included, and `publish.deploy`: the model cannot read the working tree's status or the remote, so it cannot judge what a commit, a push or a discard would carry." This assumes the recommendation holds.
- §12.5's marker keeps only its welcome-screen sentence.
- Fragment: `bun run spec:change studio-ui-guidelines.md patch -m "§12.4 keeps the git family, commit included, out of the assistant's tools, and §12.5 names only the welcome screen's Start list"`.

Docs (none carries an em dash, so `bun run docs:prose` stays green):

- `docs/studio/publish/source-control.md`:
  - "Commit and sync" becomes "Commit and Sync".
  - "Commit (don't sync)" becomes "Commit".
  - "+ New branch…" becomes "Create Branch…".
  - "Without the panel" says every verb is a Source Control command in Quick Access, keeps the table to the four that change setup, and links `docs/studio/interface/commands.md` for the rest.
- "Commit and Sync" in `docs/studio/publish.md`, `docs/studio/publish/github.md`, `docs/studio/publish/other-hosts.md`, `docs/studio/publish/cloudflare.md`, `docs/start/first-project.md`, `docs/start/coming-from-wordpress.md`, `docs/start/coming-from-webflow.md` and `docs/start/coming-from-wix.md`.
- The generated `docs/studio/interface/commands.md` picks the records up with no edit.
- The screenshots lane re-captures `git-panel.png` and `git-commit.png`.

**GPA1.3**

`specs/studio-ui-guidelines.md`:

- §12.5's marker becomes: "**Status: Implemented.** The tab strip, the outline, the block bar, the Command Bar, the Source Control panel and the welcome screen draw their controls from command records and run them through the registry (`packages/studio/src/panels/git-panel.ts`, `src/surfaces/welcome.ts`)."
- §12.4 rule 2's set gains `project.addRepository`.
- §10's marker: "inherit §12.3's and §12.5's: the rail prints no chord, the tab-strip and Files-tree menus carry none, and the Source Control panel draws from its own `ACTIONS`" becomes "inherit §12.3's: the rail prints no chord, and the tab-strip and Files-tree menus carry none". The count of five stands, because both items still wait on §12.3.
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
- `ACTIONS` in `packages/studio/src/panels/git-panel.ts` contains no `gitAction(`, `getPlatform(` or `createGithubRepository(` call. Read the object; the mechanical proof is the spy case in `git-panel-gaps.test.ts`.
- By hand in Studio: open a folder git does not track. Create GitHub Repository is disabled, and hovering it says why. Initialize it: Create is enabled, and clicking it files "…needs a commit to push" under Source Control with nothing created on GitHub. From the palette, New Project… opens the project it creates.

## Slices

| Slice  | Scope                                                                                                                                                                                                                                                           | Claims                       | State |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----- |
| GPA1.1 | `commands/command-control.ts`; Initialize, Create and Push drawn from and run through their records; Create disabled with its reason when there is no repository; the no-commit refusal; the deploy checklist runs reported; the §12.3, §12.4 and §12.5 markers | —                            | open  |
| GPA1.2 | The panel's other capabilities as `git.*` records, with `git.clone`; every control drawn from and run through a record; `commandMenuRow`; `studio.md` §5.5 and §13; §12.4 rule 3                                                                                | —                            | open  |
| GPA1.3 | The welcome Start list from records; `project.new` opens what it creates; `project.addRepository` with its capability; §12.4 rule 2 and §10 riders                                                                                                              | studio-ui-guidelines.md#12.5 | open  |
