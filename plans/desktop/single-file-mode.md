---
status: drafted
disposition: implement
claims:
  - desktop.md#4.3
  - desktop.md#6.1
requires:
  - desktop/component-scope-sections
workspaces:
  - packages/desktop
  - packages/studio
  - packages/schema
  - packages/starters
  - packages/ui
  - examples
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: L
---

# The desktop app opens any `.json` file: into its project when one encloses it, otherwise alone, in a window that writes only that file and lists only the components it imports

## Context

`specs/desktop.md` §4.3, line 335:

> **Status: Pending.** Current builds have no user-facing entry point into standalone single-file editing — Studio always opens a project (`project.json`), and documents open inside that project context. The `build.format: "single"` project option is reserved for this workflow but currently unused. The behavior below is the design target.

`specs/desktop.md` §6.1, line 507:

> **Status: Pending.** There is no project-less Components list: with no project, the dev server's `discoverComponents` answers `[]` (`packages/studio/src/platforms/devserver.ts`) and the desktop session's throws, and nothing derives a Components list from the open document. The canvas does match the document's `tagName`s against the registry (`collectTags` in `packages/studio/src/canvas/canvas-live-render.ts`), but only to register elements for rendering. It waits on §4.3, which has no entry point either.

`plan:desktop/component-scope-sections` rewrites desktop.md §6.1's marker and body as a ride-along (its **Shown** becomes "the components the file references (§6.4)"); this plan closes it. Every quoted fact was re-read against the tree of 2026-09-26.

**The entry point exists at the OS and drops the file.** `packages/desktop/electrobun.config.ts` registers the app as the `Editor` for every `.json` (`fileAssociations: [{ ext: ["json"] }]`), and `parseProjectDirFromUrl` in `packages/desktop/src/window-manager.ts` returns `null` for anything not named `project.json`, so double-clicking a component in Finder launches or raises Jx Studio and nothing opens. The chromium launcher takes `argv[2]` as a project root (`packages/desktop/src/chromium/index.ts`), so `jx-studio card.json` roots a session at a file.

**What exists and is reused**

- Pick and bind are already separable for projects (desktop.md §4.2a): `pickProjectFile` (session-free), `setWindowProject` and `openProjectInNewWindow` in both launchers, `getProjectRoot` for the boot probe. Single-file windows need the same three shapes for a file.
- A desktop session is a directory, not a project: `createProjectSession` (`packages/desktop/src/project-session.ts`) resolves every handler against `projectRoot` through `requireRoot`, and a root with no `project.json` already works for reads (`startWatching` and `listFormats` skip it). The per-window loopback (`createProjectServer`, `packages/server/src/project-server.ts`) serves whatever `session.projectRoot` names, so the canvas can fetch a file and its siblings with no server change.
- Studio already runs "a tab with no project": the `?project=` boot branch in `packages/studio/src/studio.ts` reads an absolute path with `projectState` null when `/__studio/resolve-site` finds no project (the stub said it opens only inside a project; it does not). With `projectState === null`, `ctx.project.open` is false (`commands/live-context.ts`), so every project-gated command hides; the Files panel draws nothing (`filesPanelValues`, `view: "none"`); Quick Access falls back from files to projects (`resolvePaletteMode` in `panels/quick-search.ts`); and `persistProjectShell` writes no session.
- A dormant browser Open File: `openFile()` in `packages/studio/src/files/file-ops.ts` (File System Access picker, save through `tab.fileHandle`). No command, surface or bootstrap reaches it; only `file-ops.test.ts` and `file-ops-gaps.test.ts` call it, and it is the only writer of `fileHandle`.
- `componentMetaFrom` (`@jxsuite/schema/component-meta`) is the one rule every backend uses to describe a component document.

**What a file-bound session must not do, found while reading**

- `fetchProjectSchemas` calls `readBundledProjectSchemas(projectRoot)` (`packages/compiler/src/site/schema-command.ts`), which WRITES `project.schema.json` and `document.schema.json` into the root when they are missing, so a session rooted at `~/Downloads` would write two files there on the first document open.
- The chromium profile of a project window is `<root>/.jx/chromium-profile` (`projectProfile` in `packages/desktop/src/chromium/window-registry.ts`): a directory created inside the root.
- `buildSite`, `previewSite`, the data handlers and the git and package ops (`packages/desktop/src/git.ts`, `packages/desktop/src/packages.ts`) run against whatever root the session holds.

**`build.format: "single"`** is a build-output option (site-architecture.md §14.1.1: "Reserved; currently unused. Accepted for forward compatibility with single-file output"). Only desktop.md §4.3's marker and the schema's description (`packages/schema/defs/project-config.schema.ts`: "(desktop single-file mode)") tie it to editing.

## Outcome

- desktop.md §4.3 → Implemented: Open File and the OS association open a `.json` into its enclosing project with the file in a tab, or, when no `project.json` encloses it, in a window bound to that file. The "within a project" paragraph is reconciled: inside a project a component is a tab of that project, not a mode.
- desktop.md §6.1 → Implemented: a single-file window's Insert palette lists the components the file imports, as desktop.md §6.3's Active section alone.
- Ride-along: desktop.md §3.1, desktop.md §3.4 step 2, desktop.md §4.4 and desktop.md §5.2 name the new members and state; `build.format` leaves desktop.md, and its schema description drops "(desktop single-file mode)".

## Decisions

- **Open:** implement project-less editing, or defer it? Recommendation: implement, on the two desktop launchers, because the app already claims every `.json` at the OS and silently drops all but one name, and most of the machinery exists (a session is a directory, Studio already runs a tab with no project, and pick/bind/new-window is a settled shape). Deferring would still owe the association a fix: land `resolveOpenTarget` and the entry points so a file inside a project opens its project, write desktop.md §4.3 as Implemented for that and project-less editing as `> **Status: Future.**`, and mark desktop.md §6.1 Future; `requires` would then be empty.
- **Open:** a file inside a project: single file mode, or its project? Recommendation: its project, with the file in a tab, because a document renders as the site builds it only with its project's `$elements`, imports, layouts and styles (site-architecture.md §3, imports.md §1), and a component edited alone would render, validate and list components against a context it does not have. This rewrites desktop.md §4.3's "It is also active within a project" paragraph: inside a project there is no separate mode, and the palette is desktop.md §6.3's.
- **Open:** where does Open File open when the window already holds something? Recommendation: here when the window holds nothing (no site project, no bound file) or holds the file's own project (as a tab); otherwise in a window of its own, raising the window that already holds it, with no This Window / New Window question, because Open File's job is to show a file and replacing a project to do so is Open Project's decision (desktop.md §4.2a), which asks.
- **Open:** do the dev server and cloud get it? Recommendation: no. The members are optional and the command hides without them: a browser picker yields no path the dev server can serve (desktop.md §8.2), browser Studio is a contributor workflow (`docs/start/install.md`), and a cloud session is a repository by construction.
- **Decided:** one resolver, `resolveOpenTarget(path)` in `packages/desktop/src/project-session.ts`, decides project or file for every way a path arrives (Open File, the File menu, `open-url`, `argv`, `openFileInNewWindow`), because four entry points with four rules is how the association came to drop files. It walks up to the nearest `project.json` as `/__studio/resolve-site` does.
- **Decided:** a file-bound session's root is the file's directory, and it writes only the file, because the user chose a file, not a folder. Reads resolve across the directory (siblings and subfolders, which `$ref`s and the canvas need); a `$ref` that climbs out of it does not resolve. Save, upload, create, rename and delete refuse any other path; project schemas are not generated; build, preview, data, git and package operations see no project; the chromium window takes a welcome profile rather than `<root>/.jx/chromium-profile`.
- **Decided:** Studio holds no `ProjectState` in single file mode. `projectState` stays `null` and a new `singleFileState` names `{ root, path, name }`, because every project-level gate already reads `projectState === null` correctly (see Context), where a non-site `ProjectState` would re-open the Files tree and every `ctx.project.open` command. Three URL builders read the root through a new `documentRoot()`.
- **Decided:** a single-file window holds one document. `openFileInTab` hands any other path to `openFileInNewWindow`, because the session writes only its file and Edit Component, layout links and the jump bar all open through that one function. A single-file window is deduped by the file's absolute path, enters no Recent list (`openRecentProject` reads `project.json`), and persists no session.
- **Decided:** desktop.md §6.1's list comes from filling `componentRegistry` from the file itself in single file mode: each `.json` `$ref` in `extractReferences(doc).entries`, read through `readFile` and kept when `componentMetaFrom` says it is a component. `partitionComponents` then puts every candidate in Active and the empty Global is not drawn, so the palette needs no change. A tag used without an import is not listed because it does not render either (spec.md §16.3).
- **Decided:** the dormant `openFile()` in `file-ops.ts` is deleted with the `fileHandle` save target only it feeds, because Open File is now one command with one rule, and a second, unreachable one that opens a file with no path is the ambiguity desktop.md §4.3 closes.

## Implementation

### SFM1.1: the launchers (nothing user-visible)

1. `packages/desktop/src/project-session.ts`:
   - `export type OpenTarget = { kind: "project"; root: string; file: string | null } | { kind: "file"; root: string; file: string }` and `export function resolveOpenTarget(path: string): OpenTarget | null`: `resolve` first; a directory → `project` with `file: null`; `project.json` → `project` at its directory; another `.json` → the nearest ancestor holding `project.json` (stop at the filesystem root) as `project` with `file: relPosix(root, abs)`, else `file` with `root: dirname`, `file: basename`; anything else or missing → `null`.
   - `fileDialogFn` takes `(purpose: "project" | "file")`; `pickProjectFile` passes `"project"`.
   - `export async function pickFile(): Promise<PickedFile | null>`, `PickedFile = { file: string; project: { root: string; name: string; path: string } | null }` (`file` absolute, `path` project-relative): the dialog with `"file"`, then `resolveOpenTarget`; a non-`.json` pick rejects with a sentence. Session-free, like `pickProjectFile`.
   - In `createProjectSession`: `let boundFile: string | null`; `reroot()` clears it; `bindFile(abs)` is `reroot(dirname(abs))` then sets it. `assertWritable(abs)` (compared with `normalizeForCompare`) opens `writeFileHandler`, `uploadFile`, `createDirectory`, `deleteFile` and both ends of `renameFile`, refusing with "This window edits <name> only; <rel> is outside it." `requireSiteRoot()` is `requireRoot()` that throws "No project open" while bound, used by `buildSite`, `previewSite`, `setPreviewOverlay`, `clearPreviewOverlay` and the data and secret handlers. `fetchProjectSchemas` and `listExtensionCatalog` return their empty answers while bound. The returned object gains `bindFile` and getters `boundFile` and `siteRoot` (`null` while bound).
2. `packages/desktop/src/handlers.ts`: re-export `pickFile` and `resolveOpenTarget`; export `bindFile`, `getBoundFile` and `getSiteRoot` over the default session. The legacy `_legacy` bindings in `git.ts` and `packages.ts` read `getSiteRoot()`.
3. `packages/desktop/src/rpc-schema.ts`: requests `pickFile` (`void` → `PickedFile | null`), `setWindowFile` (`{ file }` → `{ deduped: boolean; root: string | null; path: string | null }`), `openFileInNewWindow` (`{ file }` → `{ focused: boolean }`); `getProjectRoot`'s response gains `file: string | null` (the document the window was opened on, relative to its root).
4. `packages/desktop/src/window-manager.ts`: `WindowEntry` gains `file`; `projectRoot` holds the window's identity (its project root, or its bound file's absolute path), so `findWindowByRoot` dedupes both kinds unchanged. Add `export function openPathWindow(path: string)`: `resolveOpenTarget`, then a project window (existing `openProjectWindow` body, with `entry.file`) or a file window (`session.bindFile`, identity the absolute file, `titleFor` the file). `createGitOps` and `createPackageOps` get `{ get projectRoot() { return session.siteRoot; } }`. RPC: `pickFile`, `setWindowFile` (dedupe, `bindFile`, retitle, `entry.file = basename`), `openFileInNewWindow` (identity found → `activate`, `{ focused: true }`; else `openPathWindow`), `getProjectRoot` with `file`; `setWindowProject` clears `entry.file`.
5. `packages/desktop/src/chromium/index.ts`: the same three handlers and `getProjectRoot`'s `file` (module state `initialFile`); `setWindowFile` dedupes with `findWindowByRoot(abs, process.pid)`, binds, and `updateWindow(pid, { name, root: abs })`; `openFileInNewWindow` resolves the identity, then `requestFocus` or `spawnWindow(file)`. `chromium/utils.ts`: `openFileDialog(purpose = "project", timeoutMs?)` titles the portal "Open project.json" or "Open a file".
6. `packages/desktop/src/platform.ts` and `packages/desktop/src/chromium/platform.ts`: forward the three members; `probeRootProject` adds `info.file` when `getProjectRoot` names one, and when `project.json` does not read but `file` is set answers `{ meta: { root, name: file }, info: { isSiteProject: false, projectConfig: null, file } }`.
7. `packages/studio/src/types.ts`: `pickFile?`, `setWindowFile?`, `openFileInNewWindow?` beside `pickProject?` (doc comments say desktop only, and why picking is separate from binding); `PickedFile`; `getProjectRoot?` gains `file?: string | null`; `probeRootProject`'s `info` gains `file?: string`.

### SFM1.2: single file mode in Studio, and the entry points

8. `packages/studio/src/state.ts` (re-exported through `store.ts`): `SingleFileState`, `singleFileState`, `setSingleFileState`, and `documentRoot()` returning `projectState?.projectRoot ?? singleFileState?.root`. Use it in `canvas/canvas-live-render.ts` (`documentBase(...)` at the `fileBase` line), `canvas/asset-refs.ts` (`fileBaseUrl`) and `panels/component-preview.ts` (the card preview URL).
9. New `packages/studio/src/files/single-file.ts` (`@docs studio/desktop`):
   - `enterSingleFileMode({ root, path }, deps)`: the teardown `openProject` in `files.ts` does (`disarmPreviewOverlay`, `closeAllTabs`, `refreshFormats`, `resetProjectShell`), then `setProjectState(null)`, `setWorkspaceProject(null)`, `setSingleFileState`, `openFileInTab(path)`, `loadComponentRegistry()`, and a repaint.
   - `runOpenFile(deps): Promise<"cancelled" | "tab" | "here" | "newWindow" | "focused">` over `pickFile`: the file's project is this window's (roots compared with trailing separators stripped) → `openFileInTab(project.path)`; the window holds nothing → `deps.openProjectHere(project.root)` (the bootstrap's `openRecentProject`, changed to return whether it switched) then the tab, or `setWindowFile` then `enterSingleFileMode`; otherwise `openFileInNewWindow`. `newWindow` and `focused` are reported with `notify.info` (key `file.openFile`); a cancel says nothing.
   - `openOutsideSingleFile(path)`: `openFileInNewWindow` of the bound root joined with `path`.
10. `packages/studio/src/files/components.ts`: in single file mode `loadComponentRegistry` builds the registry from `activeTab.value`'s document instead of calling `discoverComponents`: `extractReferences(doc).entries` (`./component-scope`), `$ref`s ending `.json` with `./` stripped, skipping `#…`, `../…`, absolute and URL refs and the file itself; each read through `readFile`, parsed with `parseJsonDocument`, kept when `componentMetaFrom` answers; one failed read skips one entry.
11. `packages/studio/src/files/files.ts`: `loadProject` enters single file mode when the probe answers `!info.isSiteProject && info.file`, before `setProjectState`; for a site project with `info.file` it opens that document instead of `openLastSessionOrHome` and then `markSessionRestored(workspace.projectRoot)` (the `?file=` precedent in `studio.ts`). `openFileInTab` starts with the one-document rule.
12. `packages/studio/src/studio.ts`: wire `openFile: () => runOpenFile(...)` into the command deps and the welcome ctx; the save listener rebuilds the registry (`loadComponentRegistry`, then `renderLeftPanel`) in single file mode instead of `noteComponentSaved`, which would list the file as its own candidate.
13. Commands: `commands/context.ts` adds `"openFile"` to `CAPABILITIES` and `emptyContext`; `commands/live-context.ts` sets it to `has("pickFile") && has("setWindowFile") && has("openFileInNewWindow")`; `commands/defaults.ts` adds `CommandDeps.openFile` and, after `project.open`, `{ id: "file.openFile", title: "Open File…", category: "File", level: "application", menus: ["commandbar/overflow", "palette"], group: "1_file", when: (ctx) => ctx.capability.openFile, requires: "the desktop app", run: () => deps.openFile() }`. No default chord (⌘O is Open Project, ⌘⇧O Open in Browser), and not the id `file.open`, which `collab/collab-commands.ts` already names as a notification action. `panels/block-action-bar.ts`: `selection.convertToComponent`'s `when` gains `ctx.project.open` (its comment already calls it a project-level flow).
14. `surfaces/welcome.ts`: `StartAction["id"]` gains `"file"`, `WelcomeCtx.openFile`, and `{ icon: "file", id: "file", title: "Open File…" }` after Open Project when the platform has the three members.
15. `files/file-ops.ts`: delete `openFile()` and `saveFile`'s `fileHandle` branch; drop `fileHandle` from `Tab` (`tabs/tab.ts`) and `openTab`'s options (`workspace/workspace.ts`).
16. Launcher entry points: `packages/desktop/src/menu.ts` adds "Open File…" (`action: "open-file"`, no accelerator) → `openFileDialog("file")` → `openPathWindow`; `packages/desktop/src/index.ts` sends `argv`/`JSONSX_PROJECT_ROOT` and `open-url` through `openPathWindow` (`parseProjectDirFromUrl` becomes `parseOpenPathFromUrl`, any `file:` URL; a path `resolveOpenTarget` refuses opens a welcome window from `argv` and nothing from `open-url`); `chromium/index.ts` resolves `argv[2]` with `resolveOpenTarget`, raises by identity, binds a file target, and uses `nextWelcomeProfile()` for it.

### SFM1.3: `build.format`'s description

17. `packages/schema/defs/project-config.schema.ts`: `build.format`'s description drops "(desktop single-file mode)"; `bun run schema:sync` regenerates the core artifacts and the project roots' `project.schema.json` (30 files; `schemas.yml` backfills them otherwise). Independent of the other slices.

**Integration contract.** Once this lands: `resolveOpenTarget`, `pickFile` and a session's `bindFile` / `boundFile` / `siteRoot` (`packages/desktop/src/project-session.ts`) are the one rule for opening a path on the desktop and for what a file-bound session may write. `pickFile?`, `setWindowFile?` and `openFileInNewWindow?` are optional `StudioPlatform` members; `getProjectRoot` and `probeRootProject` may name a `file`. In Studio, single file mode is `singleFileState !== null` with `projectState === null`; `documentRoot()` is the base for project URLs; `loadComponentRegistry` answers for either mode. desktop.md §4.3 is the statement of the mode and §6.1 of its palette.

## Tests

Run `bun test --isolate --coverage` from `packages/desktop` (`coverageThreshold = { lines = 0.96, functions = 0.90 }`) and `packages/studio` (`{ lines = 0.958, functions = 0.941 }`), then `bun scripts/check-coverage-manifest.ts` for each. `single-file.ts` is a new source file and ships with its test. Ratchet a threshold only if the worst file rises. Every desktop suite mocks `electrobun/main`.

`packages/desktop` (SFM1.1 unless noted):

- New `tests/single-file-session.test.ts` (a temp tree): "resolveOpenTarget answers a project for a directory, a project.json and a document under one, and a file otherwise"; "a bound session reads siblings and refuses a path above its directory"; "a bound session writes its file and refuses every other write" (write, upload, create, delete, rename, each naming the file); "a bound session generates no project schemas" (`fetchProjectSchemas` is `{}` and the directory gains no `project.schema.json`); "build, preview and data see no project while bound"; "setProjectRoot clears the binding".
- `tests/window-manager.test.ts`: "pickFile answers the file and its enclosing project without binding"; "setWindowFile binds and titles the window after the file"; "setWindowFile dedupes to the window holding the file"; "openFileInNewWindow opens the enclosing project for a file inside one and a file window otherwise"; "getProjectRoot names the file a window was opened on"; "git and package ops see no project in a file window".
- `tests/chromium-index.test.ts`: the three handlers; "a file window registers under its file's path"; (SFM1.2) "argv naming a file binds the launcher and takes a welcome profile". `tests/chromium-utils-gaps.test.ts`: the dialog title per purpose. `tests/platform.test.ts`, `tests/chromium-platform.test.ts`: forwarding, and "probeRootProject reports a bound file with no project". `_rpc-parity.ts` covers the new requests on both launchers unchanged.
- SFM1.2: `tests/menu.test.ts` "Open File… opens the picked path by the open-target rule"; `tests/index.test.ts` "an open-url for a component opens its project, and one with no project opens a file window".

`packages/studio` (SFM1.2):

- New `tests/single-file.test.ts` (first import `./harness`, a mock platform with the three members): "entering single file mode leaves projectState null and opens the file"; "Open File opens a file of this window's project as a tab"; "binds an empty window to a file no project encloses"; "opens the enclosing project in an empty window, then the file"; "sends a file to a new window when this window holds a project, and reports a raised window"; "a cancelled pick does nothing and says nothing"; "another document opened from a single-file window goes to a new window"; "documentRoot is the bound directory".
- `tests/components.test.ts`: "in single file mode the registry is the file's imported components" (fixture: `$elements` naming `./card.json`, a `$switch` case naming `./panel.json`, `../outside.json` whose read rejects, `./notes.json` with no hyphen, and an npm specifier → card and panel).
- `tests/elements-panel.test.ts`: "a single-file window lists its components in the Active section and draws no other".
- `tests/files.test.ts`: "loadProject enters single file mode for a probe naming a file with no project"; "a site probe naming a file opens it instead of the last session".
- `tests/commands-defaults.test.ts` and `tests/commands-live-context.test.ts`: "file.openFile is offered only when the platform can pick, bind and open a file"; `tests/block-action-bar.test.ts`: "Convert to Component is not offered with no project"; `tests/welcome-screen.test.ts`: "Open File… appears only with the three members"; `tests/component-preview.test.ts` and `tests/canvas-live-render.test.ts`: the base follows `documentRoot()`.
- `tests/file-ops.test.ts`, `tests/file-ops-gaps.test.ts`: the `openFile` and `fileHandle` cases go with the code.

SFM1.3: no suite; `bun run schema:verify` proves the regeneration.

## Specs & docs

**desktop.md** (SFM1.2; one fragment):

- §3.1 table: **Session / project** gains `pickFile?`, `setWindowFile?`; **Multi-window / shell** gains `openFileInNewWindow?`.
- §3.4 step 2 becomes three bullets: reopen the project the backend is bound to, opening the document it names in place of the last session when it names one; "If the backend is bound to a single file, open it in single file mode (§4.3)"; otherwise the welcome state.
- §4.3: the marker becomes:

  > **Status: Implemented.** On both desktop launchers: `resolveOpenTarget`, `pickFile` and the file-bound session in `packages/desktop/src/project-session.ts`, and Studio's side in `packages/studio/src/files/single-file.ts`. The dev-server and cloud adapters omit the members, as the last paragraph says.

  The body is rewritten to: the one rule (a table: `project.json` or a document under a folder holding one → its project with the document in a tab; no `project.json` above it → single file mode), with the reason a file inside a project never opens alone; where it opens (the third Open); then single file mode as bullets: the directory is the resolution base and a `$ref` outside it does not resolve; only the file is written, and build, preview, data, git and packages see no project; no project tree, Library or Source Control, and no project state (§4.4); one document per window, others opening in windows of their own; the palette per §6.1; no Recent entry and no session (studio.md §14.8), identity by the file's path. It closes with the dev server and cloud omitting `pickFile` (§8.2). The `build.format` sentence and the "It is also active within a project" paragraph go.

- §4.4: after the block, "In single file mode `projectState` is `null`, and `singleFileState` is `{ root, path, name }`: the file's directory, the file relative to it, and its name."
- §5.2: a row whose Operation is "Open a file", endpoint "N/A (native dialog)", and PAL method "`pickFile?()`, then `setWindowFile?()` or `openFileInNewWindow?()` (§4.3)".
- §6.1, as `plan:desktop/component-scope-sections` leaves it: the marker becomes:

  > **Status: Implemented.** In single file mode `loadComponentRegistry` (`packages/studio/src/files/components.ts`) builds the candidates from the file.

  Append: "With no project there is no scan, so the candidates come from the file: every `$ref` it makes to a `.json` document, its `$elements` entries included, is read through the window's backend and listed when it is a component (a hyphenated `tagName`, the rule `componentMetaFrom` in `@jxsuite/schema/component-meta` applies for every backend). A tag the file uses without importing it is not listed, because it does not render either (spec.md §16.3), and a reference outside the file's directory is not listed, because it does not resolve (§4.3). Every candidate is therefore Active, and the palette draws §6.3's Active section alone. The list is rebuilt when the file opens, when it is saved and when its `$elements` change."

- Fragment: `bun run spec:change desktop.md minor -m "Single file mode ships on the desktop launchers: Open File and the file association open a document with no enclosing project in a window bound to that file, a document inside a project opens its project, and the Insert palette lists the components the file imports"`.
- Graduation: not expected, since desktop.md holds seven other open items today. Check `bun run plans:status --spec desktop` in the landing pull request; if desktop.md §4.3 and §6.1 are its last, that pull request graduates the spec instead of writing the fragment: header `**Status:** Implemented`, `bun run spec:bump desktop.md minor -m "…"` in place (the release rides on the last execution), and `plans/desktop/` deleted.

No other spec changes: site-architecture.md §14.1.1 already describes `build.format` without naming the mode.

**Docs** (SFM1.2; no em dashes):

- `docs/studio/desktop.md`: a section **Open a single file** after **Open a project**: choose _File > Open File…_, **Open File…** on the welcome screen, or run it from the command list, and pick a `.json` file. A file inside a project (a folder above it holds `project.json`) opens that project with the file in a tab. Any other file opens on its own: no file tree, **Insert** lists only the components the file imports, Save writes only that file, and a reference to a file outside its folder doesn't load. The file-manager sentence becomes "double-clicking a `project.json` opens that project, and double-clicking any other `.json` file opens it the same way **Open File…** does", and the differences bullet reads "`.json` files opening from the file manager". Frontmatter: `spec:` gains `desktop.md#4.3`; `code:` gains `packages/desktop/src/project-session.ts` and `packages/studio/src/files/single-file.ts`.
- `docs/studio/interface/welcome-screen.md`: **Open a single file** after **Open an existing project** ("This entry appears in the desktop app."), linking to the desktop page; `code:` gains `packages/studio/src/files/single-file.ts`.
- `docs/extending/embedding/platform-adapter.md`: the **Desktop shell** row gains `pickFile`, `setWindowFile`, `openFileInNewWindow`, and its "When absent" cell adds "**Open File…** is not offered"; the project-open flow gains a paragraph on the file trio, `getProjectRoot`'s `file` and `probeRootProject`'s `info.file`.
- `docs/studio/design/elements.md` (as `plan:desktop/component-scope-sections` leaves it): one sentence: a file opened on its own lists only the components it imports; `spec:` gains `desktop.md#6.1`.
- No change: `docs/studio/interface/tabs.md` (lists `file-ops.ts`, `files.ts` and `studio.ts`; tabs and saving behave as documented), `docs/studio/projects.md`, `docs/studio/projects/pages-layouts-components.md`. No screenshot changes: the shots run on the dev server, which omits the members.

## Acceptance

- `cd packages/desktop && bun test --isolate --coverage` and `cd packages/studio && bun test --isolate --coverage` pass at their thresholds; `bun scripts/check-coverage-manifest.ts packages/desktop` and `… packages/studio` pass.
- `bun run schema:verify`, `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown`, `bun run docs:section-refs` and `bun run electrobun:verify` pass; `bun run plans:status --spec desktop` no longer lists desktop.md §4.3 or §6.1.
- Chromium build: a temp folder holding `card.json` (`$elements: [{ "$ref": "./badge.json" }]`) and `badge.json` (a component). `bun run desktop:chromium <abs>/card.json` opens a window titled after `card.json` with no file tree; Insert lists `badge`; an edit saved with ⌘S lands in `card.json`; a media upload is refused naming the file; the folder gains no `project.schema.json` and no `.jx/`. Running it again raises that window.
- `bun run desktop:chromium <abs>/packages/starters/sites/real-estate/components/re-agent-card.json` opens the real-estate project with that component in a tab. From it, **Open File…** on the temp `card.json` opens a second window; from an empty window it binds that window.

## Slices

| Slice  | Scope                                                                                                                                                                                                                                                   | Claims                         | State |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----- |
| SFM1.1 | Launchers: `resolveOpenTarget`, `pickFile`, the file-bound session and its write confinement, `setWindowFile` / `openFileInNewWindow` / `getProjectRoot().file` on both launchers, identity by file, the adapters and the PAL types; no entry point yet | —                              | open  |
| SFM1.2 | Studio's single file mode, `file.openFile`, the Start action, the boot branch, the file-mode registry, the dormant `openFile()` removed; the menu, `open-url` and `argv` entry points; desktop.md and the docs                                          | desktop.md#4.3, desktop.md#6.1 | open  |
| SFM1.3 | `build.format`'s schema description, regenerated                                                                                                                                                                                                        | —                              | open  |
