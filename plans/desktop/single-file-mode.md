---
status: stub
disposition: implement
claims:
  - desktop.md#4.3
  - desktop.md#6.1
size: L
workspaces:
  - packages/studio
  - packages/desktop
  - packages/server
---

# Studio opens and edits a single component file with no project, listing only the components that file uses

## Context

`specs/desktop.md` §4.3, line 335:

> **Status: Pending.** Current builds have no user-facing entry point into standalone single-file editing — Studio always opens a project (`project.json`), and documents open inside that project context. The `build.format: "single"` project option is reserved for this workflow but currently unused. The behavior below is the design target.

`specs/desktop.md` §6.1, line 507:

> **Status: Pending.** There is no project-less Components list: with no project, the dev server's `discoverComponents` answers `[]` (`packages/studio/src/platforms/devserver.ts`) and the desktop session's throws, and nothing derives a Components list from the open document. The canvas does match the document's `tagName`s against the registry (`collectTags` in `packages/studio/src/canvas/canvas-live-render.ts`), but only to register elements for rendering. It waits on §4.3, which has no entry point either.

§4.3 was Pending before the census; §6.1 was unmarked. One stub because they are one piece of work: §4.3's third bullet is §6.1 ("Components sidebar shows only components declared or imported by this file"), and §6.1 cannot be exercised until the mode exists. Disposition `implement`, because the marker calls the text the design target and nothing records a decision to drop it. The detail phase should still weigh `defer`: every surface built since the text was written assumes a window holds one project (§3.4, §4.2a).

**What exists**

- The `?file=` boot branch in `packages/studio/src/studio.ts`, which opens a named document only inside a probed project.
- The welcome state for a window with no project (§3.4 step 2), and `activate`, which binds a backend session to a project root.
- `discoverComponents` with no project root differs by platform. The dev server returns `[]` (`packages/studio/src/platforms/devserver.ts`). The desktop session throws "No project open" through `requireRoot` (`packages/desktop/src/project-session.ts`), which is the guard every one of its file handlers starts with. The cloud walks the session's repository tree. `loadComponentRegistry` (`packages/studio/src/files/components.ts`) swallows the throw and leaves the project-wide registry empty.
- `build.format: "single"` in `packages/schema/project-schema.json`, described as reserved and unused.

**What is missing**

- An **Open File** entry point: a command, and a PAL member that picks one `.json` file without re-rooting a project. The desktop's native dialog can return a file path; the dev server cannot (§8.2 is why it uses `showDirectoryPicker`), so the dev-server path is a design question.
- A project-less editing state: the canvas loads the document standalone, no project tree, and save writes back to that one file through a backend bound to it rather than to a project root.
- The desktop session bound to one file. `createProjectSession` holds a project root, and `readFile`, `writeFile`, `discoverComponents` and the other handlers resolve against it through `requireRoot`, so the mode needs a session state bound to a single file (its directory as the resolution base for `$ref`s, writes confined to that file) rather than to a project root. The chromium launcher answers from the same handlers, re-exported by `packages/desktop/src/handlers.ts`.
- §6.1's flat Components list, built from the Active-set extraction `plan:desktop/component-scope-sections` introduces.
- A reconciliation of §3.4 step 2 (no project shows the welcome state) with §4.3's "single file mode is the default when no project is loaded".
- A decision on `build.format: "single"`: it is a build output (site-architecture.md §14.1.1) rather than an editing mode, so it either gets its own home or leaves this item.

**Related**

- desktop.md §3.4 (the welcome state), desktop.md §4.1 (the pointer to §4.3), desktop.md §6.4 (the non-project branch of the resolution logic), desktop.md §8.2 (why the dev server cannot pick a file).
- site-architecture.md §14.1.1 (`build.format`), studio.md §5.4 (the Components panel).
