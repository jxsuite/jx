---
status: drafted
disposition: implement
claims:
  - desktop.md#4.6
  - desktop.md#4.7
requires: []
workspaces:
  - packages/schema
  - packages/desktop
  - packages/studio
  - specs
  - docs
size: M
---

# What the operating system hands Jx Studio opens the right thing, only after the user has agreed to run that folder's code, and Studio stops taking over `.json`

## Context

`specs/desktop.md` §4.6 and §4.7 are both Pending. This plan has no dependency on `.jx` and fixes three defects in shipped builds. `plan:desktop/jx-file-association` adds `.jx` on top of it.

**Installing Jx Studio takes over `.json` on Windows.** `packages/desktop/electron-builder.yml:58` declares `ext: json`. electron-builder 26.18 expands that to `APP_ASSOCIATE`, whose first line is `WriteRegStr SHELL_CONTEXT "Software\Classes\.json" "" "Jx Project"` (`templates/nsis/include/FileAssociation.nsh:66`). `oneClick: false` with `perMachine: false` shows a per-user or per-machine page, and either way this writes the class of `.json`, which takes the default unless the user has set one in Windows Settings. `APP_UNASSOCIATE` removes the class and leaves that value behind, so uninstalling does not restore anything. macOS gets the same claim at rank `Default`.

**Most of what the association hands over is mishandled.** `projectDirOf` (`packages/desktop/src/main/app.ts:165`) returns any path not named `project.json` unchanged, and `post` sends it as a root. So a double-clicked `card.json`, or a `.md` on Linux, is posted as a project root that is a file. `projectRootFrom` reads one bare argument, though `jx-studio.desktop` passes `%F`. The only `open-file` test uses a `project.json` (`tests/electron-app.test.ts:487`).

**A cold double-click on macOS should open two windows.** `startApp` posts `{ root: args.root }` before `await app.whenReady()`, and `args.root` is `null` on a double-click. `open-file` then queues the project behind it, and the queue flushes both, one of them a welcome window (`app.ts:334`-`:353`, `backend/window-hub.ts:194`). Run on 2026-11-06 with the shell's real messages through the real hub: two messages, `[{ root: null }, { root: site }]`, and two windows. Whether `open-file` always precedes `whenReady` on a real Mac has not been observed.

**The Mac App Store build cannot open what it is handed.** `open-file` posts straight through, past the folder grants every other open goes through (`main/folder-grants.ts`). The sandbox grants what the user picked, and the backend is a child started earlier. So a double-click there reaches a backend that cannot read the folder. How much a Finder open grants has not been measured, and OOS.2 starts by measuring it.

**Nothing asks before a project's code runs.** The repository already calls these routes what they are: "Privileged HTTP routes (RCE-capable: dynamic import())" (`packages/server/src/project-server.ts:297`). They are gated by a token, and `backend/window-hub.ts:11` records that the canvas "carries that token in its URL" so that it "can drive its own project". `spec.md` §21.4 says a document is executable input and is not sandboxed. Format extensions also import a project's own modules (`packages/compiler/src/site/format-host.ts:57`). The loader is lazy: registry construction reads only JSON (`schema/extension-registry.ts:224`), so the first format action on a Markdown page is what imports it. Combined, opening an unknown folder is running its code, and today an association lets one click do that with no prompt.

`plan:desktop/single-file-mode` makes this sharper by binding a loose file's whole directory as the session root, and `plan:spec/document-scripts` makes it sharper still, because a single `.jx` file can then carry its own server module with no sidecar.

## Outcome

- desktop.md §4.6 → Implemented for projects. A document in no project is refused with a sentence until `plan:desktop/single-file-mode` makes it a window.
- desktop.md §4.7 → Implemented.
- Installing Jx Studio changes no default for `.json` on any channel, and upgrading removes the claim an earlier install made.

## Decisions

- **Decided:** the first slice is config and an installer script, needs nothing else, and is worth landing on its own, because the takeover hurts people today.
- **Decided:** `.json` is an **Open With** entry and never a default. macOS: `LSHandlerRank: Alternate`, through `mac.extendInfo`, because `fileAssociations` cannot express a content type. Windows: `OpenWithProgids` only, written by `nsis.include`, because the `fileAssociations` path always writes the extension's class. Microsoft Store: `appx.customExtensionsPath`, because removing `fileAssociations` removes it from the manifest too, and a package association does not take the default. Linux: `MimeType` stays, since a desktop entry is a candidate and not a claim.
- **Decided:** the installer removes the old claim from both `HKCU` and `HKLM`, since an install may have changed mode, and only when the value is exactly `Jx Project`, so a class the user or another application set stays. Nothing else repairs existing machines. On upgrade the old uninstaller runs first (`installSection.nsh:52`) and `customInstall` last (`:81`), so the value is still there to find. `FileAssociation.nsh` is included only when `fileAssociations` is non-empty (`NsisTarget.js:740`), so the script calls `SHChangeNotify` itself rather than through its macros.
- **Decided:** `resolveOpenTarget`, the `open-path` message and raising a window with a document move here from `plan:desktop/single-file-mode`, which then builds on them. They are what make a file inside a project open correctly, and they do not need project-less editing, so they should not wait for that plan's own prerequisites.
- **Decided:** the walker checks content and answers three ways: `project`, `other` or `unreadable`. A `project.json` is `other` if it holds any of `tagName`, `children`, `$layout`, `$paths`, `textContent`, `innerHTML`, `$ref` or `title`, which mark a page (`tagName` alone would not do, since it is optional, and `pages/project.json` is a legal page at `/project`, `pages-discovery.ts:243`), or any of `targets`, `sourceRoot` or `projectType`, which mark Nx's file (`platforms/cloud.ts:1828`). None of the 30 tracked project files holds one, and no tracked page passes. An unreadable candidate is **believed and reported**, not skipped: a typo in a project file must not make its folder stop being a project, or a page's double-click would walk past it to an ancestor. A data file that happens to look like `{ name, url }` under that name still passes, and that is accepted. `packages/schema/src/project-file.ts` is created here, and `plan:_shared/project-file-access` moves every other caller onto it.
- **Decided:** the gate is structural, not a list of callers. `reroot` becomes unreachable except through a hub `bind(window, root)` that awaits trust. An earlier draft named `openWindow` and `setWindowProject` as "the one gate", and adversarial review disproved it by running it: Cmd-O goes `files/files.ts:315` → `session.openProject` → `reroot` directly (`project-session.ts:851`), and a `POST /__jx_server__` then imported the project's module with no prompt. `createProject` reroots directly too (`:963`), which is fine because `generateProject` refuses a non-empty folder, but it goes through `bind` so that the rule has no exceptions.
- **Decided:** a decline is an answer every caller can see. `setWindowProject` answers `{ deduped, config }` and `studio.ts:1421` proceeds on anything not deduped, moving `platform.projectRoot`, and `openProjectInNewWindow` answers `{ focused: false }`, which Studio reports as "Opened in another window" (`studio.ts:1397`). Both gain a `declined` outcome, handled there and at `:1337`. `openProject` already has `null` for cancel.
- **Decided:** trust is asked in a native dialog from the main process, before anything from the folder runs and before a window binds. A window is not an adequate place to ask, because a Studio window is already a page on that project's server. Before the answer, the application reads at most the project file, as data, to know it is one. It imports and executes nothing.
- **Decided:** a pending prompt is registered in the hub's `opening` map with its files, so a second double-click joins it rather than prompting twice, and several files in one launch all open once the window registers. Today `window-hub.ts:201` answers `{ focused: true }` while a root is binding, which would drop all but the first.
- **Decided:** a cold launch that ends with no window quits. `window-all-closed` fires only when a window closes (`app.ts:344`), so a declined or refused cold open otherwise leaves a process holding the instance lock, with no interface. The hub sends the existing `quit` when it holds no window, none opening and no prompt pending. A refusal reaches the user through a new `notice` message and `dialog.showErrorBox`, because no window exists to show it.
- **Decided:** the dialog names the path and not the project's `name`. The `name` is the attacker's to choose, and a prompt reading "Open Acme Corp's site?" is worse than none.
- **Decided:** Cancel is the default button, and declining opens nothing. There is no restricted mode in this version. VS Code's Workspace Trust has one, and it took that project a long time to make coherent. It can be added later without changing the store.
- **Decided:** the store is `trusted-projects.json` under `configFile` (`backend/user-config.ts:18`), beside `recent-store`, written through the lock in `backend/user-store.ts`, keyed by `normalizeRoot` (`backend/roots.ts:19`), which resolves real paths, with NFC added there so that a symlink or a macOS decomposed name is one folder. `normalizeForCompare` is private and does neither, and the backend has no `app.getPath`. No subfolder inherits. On first run it is seeded from `recent-store.ts`, so nobody is asked about a project they have been working in. `createProject` adds its result.
- **Decided:** no bypass switch. `scripts/smoke-backend.ts` and tests seed the store file. A switch that disables a security prompt is something a shortcut file can carry. By the same reasoning, `app.ts:150` stops honouring `--jx-backend=` and `--jx-preload=` in a packaged build, where today they run any script as the backend.
- **Decided:** what trust does not cover is stated, in the prompt's detail text and `docs/framework/concepts/security.md`. It is by path and not by content: a `git pull`, a re-extracted archive at the same path, or a file saved into a trusted tree runs with no prompt, and a trusted project's code can edit the store. That is consent, not a sandbox, and treating it as more would be misleading.
- **Decided:** a path may arrive as a URL. `AppImageTarget.js:29` writes `%U` into the bundled entry, which integrators use, and `projectRootFrom(["file:///home/u/a%20b/project.json"], …)` returned `/home/u/file:/home/u/a%20b` when run. `open-path` decodes `file:` arguments.
- **Decided:** the Mac App Store build asks for the folder when `open-file` names a file its grants do not cover, with `defaultPath` set to the file's folder, and goes through the existing `restartBackend`. It cannot walk up to find the project first, because it cannot read there yet. A cold `open-file` fires before ready, so its grant request queues until the backend has started; otherwise `restartBackend` runs early and `app.ts:541` starts a second backend.
- **Decided:** the backend reports the roots it actually holds, through a `window-root` message, and `openRoots` goes. It is fed only by `open-project` (`app.ts:323`), so once windows open through `open-path`, `restartBackend` sees none, skips "save your work" (`:503`), then destroys them all (`:525`), losing unsaved work and not reopening them. Declined roots would also enter it.
- **Decided (owner):** every first open gets the prompt, through the one gate, whether it came from outside the application or from Open Project. A picked folder may be just as unknown, one gate is simpler to keep correct than several, and it costs one click per folder, once.
- **Decided (owner):** `jx-studio ./site` from a terminal asks by the same rule. A shell user can answer it once, and anything else makes the argument a bypass that a shortcut file can use.

## Implementation

Slice OOS.1, installer claims:

- `packages/desktop/electron-builder.yml`: delete the top-level `fileAssociations`. Add `mac.extendInfo.CFBundleDocumentTypes` for `public.json` at `Alternate`; `.md` joins it in OOS.2, once a Markdown file can open correctly; `mas` gets it because `macPackager.js:433` reads the mac block's `extendInfo`, so a `mas.extendInfo` would be ignored. Add `nsis.include` and `appx.customExtensionsPath`. electron-builder resolves the latter against `appDir`, which is the generated `build/app`, so the test pins the relative path.
- `packages/desktop/build-resources/installer.nsh`: `customInstall` removes the old value and registers `OpenWithProgids`, and `customUnInstall` removes its own.
- Keep the `jx-studio.desktop` and `snap/gui/jx-studio.desktop` `MimeType` lines as they are. `docs/studio/desktop.md:65` and `:92` change.

Slice OOS.2, one resolver, moved from `plan:desktop/single-file-mode`:

- `packages/schema/src/project-file.ts` with `findEnclosingProject`.
- `packages/desktop/src/backend/project-session.ts`: `resolveOpenTarget(path)` answering `{ kind: "project", root, file }` or a refusal with a sentence. `plan:desktop/single-file-mode` later adds `kind: "file"`. The existing walker at `:1120` uses `findEnclosingProject`.
- `shared/protocol.ts`, `main/app.ts`, `backend/window-hub.ts`: `open-path` carries the raw path from `open-file`, `second-instance` and every bare argument, and `isShellMessage` guards it. `notice` and `window-root` join the protocol. The launch posts its own `open-project` only after `whenReady` has let `open-file` arrive, and only when no path did. On macOS, `open-file` checks `grants.covers`.
- `raise(entry, path)`, the `openDocument` push, and `subscribeOpenDocument?` in `packages/studio/src/types.ts`, answered by `openFileInTab`. `getProjectRoot` gains `file`.

Slice OOS.3, trust:

- `backend/trust-store.ts`, and a `confirm-trust` shell message answered like `dialog-result`.
- `backend/project-session.ts`: `reroot` is no longer reachable from `openProject`, `createProject` or `setWindowProject` except through `bind`. `backend/window-hub.ts`: `bind(window, root)`, the `opening` record with files and pending prompt. `backend/handlers.ts:182`, `shared/rpc-schema.ts:482`: the `declined` outcome. `packages/studio/src/studio.ts:1337`, `:1397`, `:1423`: what Studio does with it.
- `main/app.ts`: `dialog.showMessageBox`, `defaultId` and `cancelId` on Cancel.

**Related, no edge.** `plan:desktop/packaged-window-boot-ci` is why none of this can be proved in CI end to end today, so Acceptance names a manual pass. `plan:desktop/mac-app-store` owns the rest of the sandbox work.

**Integration contract.** Once this lands: every path reaches `resolveOpenTarget` through `open-path`, `reroot` has one caller and it answers trust, and `project-file.ts` exists in `@jxsuite/schema`.

## Tests

- `packages/desktop/tests`, using `_fake-electron.ts`: a new `file-association-config.test.ts` holds the builder config to the rules above (no top-level `json`, `Alternate` ranks, the NSIS script's exact-match guard). `electron-app.test.ts`: `open-file` before ready opens one window; several arguments each post; a raw path reaches `open-path`; a `file:` URL is decoded; a packaged build ignores `--jx-backend`; `restartBackend` prompts for a window opened through `open-path`. `hub-protocol.test.ts`: the new messages and their guards.
- `backend/trust-store`: seeded from Recent, symlink and NFC equality, no inheritance, an unreadable store asks rather than trusting, and concurrent writes through the lock. The hub: no import and no bind before an answer on any of `openProject`, `setWindowProject`, `openProjectInNewWindow`, `createProject` and `open-path`, written as one table so that a new binder has to join it; a real `POST /__jx_server__` refused for an unanswered root; a declined root opens nothing and Studio reports nothing; a declined cold launch quits; two double-clicks while a prompt is up give one prompt and two tabs.
- `packages/schema`: `findEnclosingProject` past `pages/project.json` and past an Nx `project.json`, with `apps/web/project.json` under a real project; stops at the filesystem root.
- `packages/desktop/scripts/smoke-backend.ts` seeds the store and still opens its project. Coverage thresholds ratchet in each workspace. `bun test --isolate` throughout.

## Specs & docs

- `desktop.md` §4.6 and §4.7: delete the markers and state what shipped, with §4.3 still Pending for the loose-file row. §9.7's shell-to-backend list gains `open-path` and `confirm-trust`. `bun run spec:change desktop.md minor -m "What the operating system opens resolves by one rule, and a folder is trusted once before its code runs"`.
- `spec.md` §21.4 and `server.md` §4.2 name the desktop prompt, each with a `patch` fragment.
- `docs/studio/desktop.md` and `docs/framework/concepts/security.md`: what the prompt means, and that it is not a sandbox.

## Acceptance

- On Windows: with `.json` opening in another editor, install, upgrade from a build carrying the old claim, and uninstall. The default never moves, and the old value is gone.
- On each desktop OS: double-clicking a page inside a project opens that project with that page, and raises the window if it is already open. `pages/project.json` opens its real project. A cold open shows one window.
- An untrusted folder shows the prompt before any project code can run, from Open Project as from a double-click. Cancel leaves nothing open and, on a cold launch, no process.
- A Mac App Store build, built as `packages/desktop/AGENTS.md` describes, reads a double-clicked project after granting its folder.
- `bun run all-the-things`, `plans:check` and `docs:check` are green.

## Slices

| Slice | Scope                                                    | Claims         | State |
| ----- | -------------------------------------------------------- | -------------- | ----- |
| OOS.1 | Stop claiming `.json`, repair installed machines         |                | open  |
| OOS.2 | The resolver, `open-path`, raise with a document, grants | desktop.md#4.6 | open  |
| OOS.3 | The trust prompt and store; closes both markers          | desktop.md#4.7 | open  |
