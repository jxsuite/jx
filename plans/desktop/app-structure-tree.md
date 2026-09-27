---
status: drafted
disposition: reconcile
claims:
  - desktop.md#7.4
requires: []
workspaces:
  - specs
  - docs
  - packages/desktop
size: S
---

# desktop.md §7.4 draws the desktop package and the packaged app as they are laid out, and the spec's stale paths, counts and samples are corrected with it

## Context

`specs/desktop.md` §7.4, line 705:

> **Status: Partial.** The prose below ships: distribution names in `packages/desktop/release-assets.json`, `build.copy` in `packages/desktop/electrobun.config.ts`, and the `postBuild` check in `packages/desktop/scripts/verify-bundle.ts`. The tree does not match the package: the entry is `packages/desktop/src/index.ts`, the PAL handlers are `project-session.ts` (re-exported by `handlers.ts`) beside `window-manager.ts`, the webview init is `src/init.ts` bundled by `scripts/pre-build.ts` and staged to `views/studio/dist/init.js`, and no code-services module exists (§5.3).

The section was unmarked before the census. The tree (lines 707 to 725) draws `jx-studio-app/` with `src/bun/main.js`, `studio-handlers.js`, `code-services.js`, `src/views/studio/{index.html, init.js}` and a package-local `node_modules/@jxsuite/*`. None of it exists. Verified against the package:

- `electrobun.config.ts` names `build.bun.entrypoint: "src/index.ts"`, stages `@jxsuite/create` and `@jxsuite/starters` data under `bun/`, spreads `STUDIO_ASSETS` (`packages/studio/src/hosting/layout.ts`) from `assets/studio/` to `views/studio/`, and adds `assets/studio/dist/init.js`, the one file that manifest does not know.
- `src/index.ts` runs the shared services server (desktop.md §7.3a), the menu, update checks and the first window. `src/window-manager.ts` gives each window its own `createProjectSession(root)`, loopback project server and RPC. `src/handlers.ts` keeps one process-wide default session, which `src/chromium/index.ts`, `git.ts` and `packages.ts` import.
- `scripts/pre-build.ts` builds Studio, runs `check-electrobun-vendor.ts --init`, bundles `src/init.ts` to `assets/studio/dist/init.js` and judges it (`init-bundle.ts`), then calls `stage-studio-assets.ts`, which copies the manifest and writes `index.html` from `studioShellHtml({ boot })`. `pre-build-rpc.ts` does the same for `src/chromium/init.ts`. `post-build.ts` runs `verify-bundle.ts` against the packaged `app/`.
- There is no `packages/desktop/node_modules`; the workspace hoists to the root. `.hutch/` is in `packages/desktop/.gitignore`, and `vendor/electrobun` holds as the section says.
- Tests that pin the layout: `packages/desktop/tests/electrobun-config.test.ts`, `stage-studio-assets.test.ts`, `verify-bundle.test.ts`, `init-bundle.test.ts`, `index.test.ts`.

Disposition `reconcile`: the package is the working layout and the tree is a sketch from before it existed.

**Editorial riders.** The audit record (plans/desktop/README.md, "Spec-wide decisions") gives this plan the spec's drift in sections whose status holds. Each was re-verified:

- §1: "three deployment targets" introduces a four-row table. The NixOS row's Storage cell says "Filesystem via dev server", but §9.1 says that launcher's backend "is **not** the dev server": it is `createProjectServer()` (`packages/desktop/src/chromium/index.ts`).
- §3.1: "roughly 70 members today", but `StudioPlatform` in `packages/studio/src/types.ts` declares 101. The extras paragraph calls `updater` and `windowControls` "the two today" and cites `resize-edges.ts` and `panels/toolbar.ts`. `panels/toolbar.ts` does not exist; `windowControls` is read in `packages/studio/src/resize-edges.ts` and `surfaces/commandbar.ts`; `githubAuth` is a third extra, on both adapters (`packages/desktop/src/platform.ts`, `src/chromium/platform.ts`), read in `packages/studio/src/github/github-auth.ts`; nothing in `packages/studio/src` reads `updater`. The header comment of `createDesktopPlatform` repeats the stale `toolbar.ts`.
- §3.5: "`Utils.openExternal` comes from `electrobun/bun`". `packages/desktop/src/utils.ts` imports `electrobun/main`, and §7.1 calls `electrobun/bun` a deprecated alias.
- §5.1: "roughly 60 routes"; `STUDIO_ROUTES` holds 71. The generated reference it names as `docs/extending/embedding/backend-protocol.md` is `docs/extending/reference/studio-routes.md`, written by `scripts/docs/generators/studio-routes.ts`; `backend-protocol.md` links to it.
- §7.2, §7.3, §8.1: the samples are headed `packages/studio-desktop/platform.js`, `src/bun/studio-handlers.js` and `packages/studio/platforms/devserver.js`. The bodies drift too. §7.2 calls `rpc.openProject()` where the adapter calls `rpc.request.openProject()` on an `Electroview`. §7.3 keeps one module-level `projectRoot` and returns `readdir` order with `relative()` paths, against the per-window session (§9.4 calls the window manager "a `Map`"), §5.1's stable path order and §3.1's forward-slash project-relative paths (`relPosix`, `byPathOrder` in `project-session.ts`). §8.1 throws on a cancel where `openProject` returns `null` on `AbortError`, throws "not under the dev server root" where it falls back to `GET /__studio/find-project`, never calls `activate()`, and reads `GET /__studio/file` as text where the route answers `{ content }`. §8.2's step 3 omits the fallback.

**Not this plan's**, for routing: §7.1's "Code services" box is desktop.md §5.3's open item (`plan:_shared/desktop-code-services`); §9.3's `pre-build.ts` statement is `plan:desktop/nix-package-text`'s; `packages/desktop/README.md` ("the one cloud APIs will use in the future") is stale but is not a spec, and stays.

## Outcome

- `desktop.md` §7.4 → Implemented. Two trees: the package as the ElectroBun build reads it, and the packaged `app/` the `postBuild` check verifies, with a paragraph on the one route the webview init takes into the bundle.
- Editorial, no status change: §1, §3.1, §3.5, §5.1, §7.2, §7.3, §8.1 and §8.2 say what ships; the adapter's header comment and two docs pages match.
- `desktop.md` stays Partial (§3.1, §3.3, §3.6, §4.3, §5.3, §6.1 to §6.5, §9.3 and §10.2 remain open), so nothing graduates.

## Decisions

- **Decided:** `reconcile`, because the layout is the one `electrobun.config.ts`, both pre-builds and `verify-bundle.ts` agree on, and five test files pin it. Nothing in the old tree names a behaviour the package lacks except `code-services.js`, which desktop.md §5.3 already tracks.
- **Decided:** the tree names roles, not files. It lists only the files whose role desktop.md states elsewhere (entry, window manager, session, default-session shim, RPC schema, boot, init, adapter, the build scripts, `release-assets.json`) and collapses `src/chromium/` to one line, because `src/` holds 27 modules (stores, git, packages, menu) the spec never describes, and an exhaustive list is what drifts. The Nix files stay in §9.3; `pre-build-rpc.ts` and `chromium/` appear because they share `src/` and `assets/studio/`.
- **Decided:** add a second tree for the packaged `app/`, limited to what `REQUIRED` in `verify-bundle.ts` names, because the marker's own evidence (`views/studio/dist/init.js`) and the "Packaged static data" paragraph are about that layout, and a failed build reports paths in it.
- **Decided:** no code-services entry, and no `requires` edge to `plan:_shared/desktop-code-services` in either direction. The tree is right before that plan lands (nothing exists) and after it (the services live in `@jxsuite/server`, answered by `project-session.ts`). If it has landed when this one does, the source tree also lists `scripts/code-tools.ts` and the packaged tree lists `oxfmt.<triple>.node` and `oxlint/` under `bun/`.
- **Decided:** the three samples become abridged excerpts of the files their headers name, not just renamed, because a sample headed with a real path is read as that file, and three bodies contradict contract text (§5.1's path order, §3.1's path space, §4.2's "`{ config, handle }` or null", the `{ content }` read shape). They stay abridged, so they carry no line a later plan would have to maintain.
- **Decided:** drop the counts in §3.1 and §5.1 rather than correct them, because each sentence names the canonical source beside the count, so the count is a second writer that every new member or route makes stale.
- **Decided:** §3.1 documents `updater` as carried and unread. Deleting it from `createDesktopPlatform` would be a code change (and a `platform.test.ts` mapping test) with no spec item behind it; §3.1's rule, extras stay off the interface, is unaffected either way.
- **Decided:** no test pins the tree. A `packages/desktop` test reading `specs/desktop.md` needs an `EXTRA_EDGES` entry in `scripts/ci/affected.ts`, which would run the desktop matrix on every desktop.md edit, to guard a section whose drift came from a pre-package sketch rather than churn.

## Implementation

1. **`specs/desktop.md` §7.4.** Replace the marker, the first tree and the paragraph after it as given in Specs & docs. Keep the vendor paragraph and tree, "Distribution names" (with one added sentence), and "Packaged static data" (with its last sentence replaced).
2. **`specs/desktop.md` riders**, each in place as given in Specs & docs: §1 (first sentence and the NixOS row), §3.1 (the count sentence and the extras paragraph; the marker and the patch paragraph are `plan:desktop/settings-patch-cross-process-lock`'s and stay untouched), §3.5 (one module name), §5.1 (the first paragraph), §7.2 and §7.3 (samples and the §7.3 lead-in), §8.1 (sample), §8.2 (step 3).
3. Run `bunx oxfmt specs/desktop.md docs/extending/embedding.md docs/extending/embedding/platform-adapter.md`: the §1 table, the embedding table and the fences are formatter-owned.
4. **`packages/desktop/src/platform.ts`**, the comment above `createDesktopPlatform` (lines 27 to 31): "The desktop adds `updater` and `windowControls`" becomes "The desktop adds `updater`, `windowControls` and `githubAuth`", and "(see resize-edges.ts, toolbar.ts)" becomes "(see resize-edges.ts, surfaces/commandbar.ts, github/github-auth.ts)". No code changes.
5. **Docs**, as given in Specs & docs: `docs/extending/embedding/platform-adapter.md` and `docs/extending/embedding.md`.
6. **Fragment**: `bun run spec:change desktop.md minor -m "…"` (Specs & docs).
7. **Plan housekeeping in the landing pull request.** Delete this file. Remove every remaining citation of it, or `plans:check` reports `citation-unknown`: in `plans/desktop/README.md`, the four clauses that name it as the riders' owner (the §1, §3.5, §5 and §7.1 bullets) become "corrected with §7.4's reconcile", and the last "Spec-wide decisions" bullet is deleted; in `plans/desktop/settings-patch-cross-process-lock.md`, the last Related bullet is deleted; in `plans/_shared/desktop-code-services.md` (if it has not landed), the sentence opening "`plan:desktop/app-structure-tree` draws §7.4's tree" becomes "§7.4's tree names no `code-services.js`; when this lands, add `scripts/code-tools.ts` to it and `oxfmt.<triple>.node` and `oxlint/` under the packaged tree's `bun/`."

**Integration contract.** No plan requires this one. Once it lands: §7.4's source tree lists only files whose role the spec states, so a plan that adds such a file (a staged list, a build hook, a new launcher module §7 or §9 describes) adds its line, and a plan that stages a new path into the packaged `app/` adds it to the second tree when `verify-bundle.ts` requires it. The §7.2, §7.3 and §8.1 samples are abridged excerpts: a plan that changes the shape they show (the RPC call form, the per-window session, `openProject`'s cancel or fallback, a read's response shape) updates the sample in the same change. §3.1 names three launcher-only extras; `plan:desktop/github-token-stays-in-launcher` keeps `githubAuth` launcher-only, so its count holds.

## Tests

No test changes. The one code edit is a comment in `packages/desktop/src/platform.ts`, so CI runs the `packages/desktop` leg (`bun test --isolate --coverage` from `packages/desktop`, then `bun scripts/check-coverage-manifest.ts packages/desktop`) with per-file coverage unchanged against `coverageThreshold = { lines = 0.96, functions = 0.90 }` in `packages/desktop/bunfig.toml`; no ratchet.

The paper half is proved by the gates in `checks`: `bun run docs:status` (the §7.4 marker form), `bun run plans:check` (no `claim-not-open`, no dangling citation of this plan), `bun run docs:spec-release` (the body change carries its fragment), `bun run docs:check` and `bun run docs:links` (the two docs pages), `bun run docs:prose` (no em dash in the docs edits), `bun run docs:markdown`.

## Specs & docs

**`desktop.md` §7.4.** The marker becomes:

> **Status: Implemented.** `packages/desktop/electrobun.config.ts` (the entry and `build.copy`), `packages/desktop/scripts/pre-build.ts` and `stage-studio-assets.ts` (the staged Studio tree), `packages/desktop/scripts/verify-bundle.ts` (the `postBuild` check), `packages/desktop/release-assets.json` (the distribution names).

Then "The package, as the ElectroBun build reads it:" and:

```
packages/desktop/
├── hutch.config.ts              # Project task names only (the npm dep selects the toolchain)
├── electrobun.config.ts         # App identity, main process (bun, src/index.ts), build.copy, signing, release
├── release-assets.json          # Installer file names and whether each is signed
├── src/
│   ├── index.ts                 # Main-process entry: shared services server (§7.3a), menu, update checks, first window
│   ├── window-manager.ts        # Per window: a BrowserWindow, its ProjectSession, its loopback project server, its RPC
│   ├── project-session.ts       # The PAL handlers, bound to one window's project root (§7.3)
│   ├── handlers.ts              # One process-wide default session, which the chromium launcher answers with
│   ├── rpc-schema.ts            # The requests and messages both launchers answer (§9.1)
│   ├── boot.ts                  # The launcher signal; the first import of both init shims (§3.3)
│   ├── init.ts                  # Webview init: bootLauncher() announces, then registers createDesktopPlatform() or records why not (§3.3)
│   ├── platform.ts              # The desktop adapter, running in the webview (§7.2)
│   └── chromium/                # The NixOS launcher, its adapter and its init shim (§9)
├── scripts/
│   ├── pre-build.ts             # preBuild: builds Studio, bundles src/init.ts to assets/studio/dist/init.js, stages the rest
│   ├── init-bundle.ts           # How an init bundle is built, and what its content must show (§3.3)
│   ├── stage-studio-assets.ts   # Copies Studio's asset manifest to assets/studio/ and writes index.html and canvas.html
│   ├── pre-build-rpc.ts         # The chromium launcher's pre-build: chromium/init.ts, the same staging (§9.3)
│   ├── post-build.ts            # postBuild: runs verify-bundle.ts against the packaged app/
│   └── verify-bundle.ts         # The paths the packaged app/ must hold
├── assets/studio/               # Generated by the pre-build and gitignored
└── .hutch/devkit/               # Generated: the pinned release's SDK, where a BUILD resolves electrobun/*
```

and "The packaged app, as the `postBuild` check reads it:" with:

```
app/                             # macOS: <App>.app/Contents/Resources/app/; Linux and Windows: <bundle>/app/
├── bun/
│   ├── index.js                 # The whole main-process graph, inlined
│   ├── template/  templates/    # @jxsuite/create's static data
│   └── registry.json  sites/    # @jxsuite/starters' static data
└── views/studio/                # assets/studio/, entry by entry
    ├── index.html               # The shell document, loaded over views://
    ├── canvas.html              # Served by the window's loopback project server, never over views://
    └── dist/
        ├── init.js              # src/init.ts, bundled by pre-build.ts
        └── studio.js …          # The rest of @jxsuite/studio's asset manifest
```

The paragraph after the first tree keeps its sentences, with "The `electrobun` package under `node_modules`" becoming "The `electrobun` package in the workspace root's `node_modules`". After the vendor tree, insert:

> **The webview init reaches the bundle by one route.** `pre-build.ts` bundles `src/init.ts` through `packages/desktop/tsconfig.json`, so `electrobun/view` resolves into the vendored submodule (§3.3), and writes `assets/studio/dist/init.js`. `stage-studio-assets.ts` copies Studio's asset manifest (`STUDIO_ASSETS`) beside it and writes `index.html` from `studioShellHtml()` (studio.md §11.2) with that bundle in its boot slot. `build.copy` then stages each manifest entry, and `dist/init.js`, which the manifest does not know, under `views/studio/`. The chromium launcher takes the same route through `pre-build-rpc.ts`, with `src/chromium/init.ts`, into the same `assets/studio/`.

"Distribution names" gains, at its end: "`release-assets.json` is the one list of installer names and whether each is signed; the release workflow's asset check (`.github/workflows/release-please.yml`) and the site's download-link check (`bun run docs:claims`) read it." "Packaged static data" keeps its first three sentences; its last becomes: "The `postBuild` hook checks the packaged `app/` against `REQUIRED` in `scripts/verify-bundle.ts`, whose Studio half is derived from the same manifest, judges `dist/init.js`'s content as `pre-build.ts` did (§3.3), and fails the build on any omission."

**Riders, in place:**

- **§1.** "three deployment targets" → "four deployment targets". The NixOS row's Backend cell becomes "`createProjectServer()` from `@jxsuite/server` (loopback)" and its Storage cell "Filesystem".
- **§3.1.** "The canonical `StudioPlatform` interface is `packages/studio/src/types.ts` — roughly 70 members today. This spec" → "The canonical `StudioPlatform` interface is `packages/studio/src/types.ts`. This spec". In the extras paragraph, "A platform may carry capabilities that only one shell can have — the desktop's `updater` and `windowControls` are the two today." → "A platform may carry capabilities that only one shell can have. The desktop adapters carry three today: `githubAuth` on both launchers, and `windowControls` and `updater` on the ElectroBun build." and "(see `resize-edges.ts`, `panels/toolbar.ts`)" → "(`windowControls` in `packages/studio/src/resize-edges.ts` and `surfaces/commandbar.ts`, `githubAuth` in `github/github-auth.ts`; nothing in Studio reads `updater` today)". The rest of the paragraph stays.
- **§3.5.** "comes from `electrobun/bun`" → "comes from `electrobun/main`".
- **§5.1.** The first paragraph becomes: "The canonical, complete list of backend operations is the `STUDIO_ROUTES` table in `packages/protocol/src/routes.ts`. Each route carries its method, literal dev-server path, core-vs-optional flag, one-line contract summary, and (for optional routes) a `degradation` note. The docs' protocol route reference (`docs/extending/reference/studio-routes.md`) is generated from it by `scripts/docs/generators/studio-routes.ts`, and `docs/extending/embedding/backend-protocol.md` explains the contract around it. This spec no longer duplicates the table."
- **§7.2.** The fence becomes `typescript`, headed `// packages/desktop/src/platform.ts (runs in the webview; abridged)`. Before the members: `const rpc = Electroview.defineRPC<StudioRPC>({ handlers: { messages: { /* onFileEvents, settingsChanged, updateReady */ }, requests: {} } });`, then `new Electroview({ rpc }); // needs the preload's window.__electrobun (below)`, then `const platform = {` in place of `return {`. `openProject` becomes `return rpc.request.openProject(); // { config, handle }, or null on a cancel`; the three calls become `rpc.request.listDirectory({ dir })`, `rpc.request.readFile({ path })`, `rpc.request.writeFile({ path, content })`. It ends `return platform satisfies StudioPlatform; // inferred, so the launcher-only extras survive (§3.1)`.
- **§7.3.** The lead-in becomes "The Bun process implements the actual operations, one session per window. `window-manager.ts` creates a session for each window it opens, so two windows hold two project roots; `handlers.ts` keeps one process-wide default session, which the chromium launcher (a window per process, §9.4) answers with:". The sample becomes:

  ```typescript
  // packages/desktop/src/project-session.ts (runs in the Bun process; abridged)
  export function createProjectSession(initialRoot: string | null) {
    let projectRoot = initialRoot;

    function requireRoot() {
      if (!projectRoot) throw new Error("No project open");
      return projectRoot;
    }

    async function openProject() {
      const picked = await pickProjectFile(); // Utils.openFileDialog, validated; binds nothing (§4.2a)
      if (!picked) return null; // a cancel
      reroot(picked.root); // binds THIS window's session and re-arms its watcher
      return {
        config: picked.config,
        handle: { root: picked.root, name: picked.name, projectConfig: picked.config },
      };
    }

    async function listDirectory({ dir }: { dir: string }) {
      const root = requireRoot();
      const absDir = resolve(root, dir);
      assertUnderRoot(absDir, root);
      const result: DirEntry[] = [];
      for (const entry of await readdir(absDir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const absPath = join(absDir, entry.name);
        const s = await stat(absPath);
        result.push({
          name: entry.name,
          path: relPosix(root, absPath), // project-relative, forward slashes (§3.1)
          type: entry.isDirectory() ? "directory" : "file",
          size: s.size,
          modified: s.mtime.toISOString(),
        });
      }
      return byPathOrder(result); // stable path order (§5.1)
    }

    // ... readFile, writeFile, deleteFile, renameFile, discoverComponents, jxResolve, …
    return { openProject, listDirectory /* , … */ };
  }
  ```

- **§8.1.** Headed `// packages/studio/src/platforms/devserver.ts (abridged)`, the factory opens with `let _projectRoot = "";`. The picker call is wrapped so an `AbortError` returns `null` ("a cancel is not a failure") and anything else rethrows. The `if (!match) throw` becomes the fallback: `GET /__studio/find-project?name=${encodeURIComponent(dirHandle.name)}`, throwing only when that lookup fails or answers no `path`, and setting `_projectRoot` from the match or the lookup. `await this.activate();` precedes the return, whose handle uses `_projectRoot`. `projectPath` and `stripProjectRoot` become `serverPath` and `stripRoot`, and `readFile` returns `(await res.json()).content`.
- **§8.2.** Step 3 gains ", or, for a folder outside the server root, asking `/__studio/find-project` for it by name".

**Fragment:** `bun run spec:change desktop.md minor -m "§7.4 draws the desktop package and the packaged app as they are laid out, the adapter and session samples are abridged from the files they name, and §1, §3.1, §3.5 and §5.1 drop stale paths and counts"`

**Docs** (no em dashes). No page cites `desktop.md#7`. The two that change cite §1 and §3, whose riders they mirror; `docs:sync` names `platform-adapter.md` and `docs/studio/desktop.md` for the `platform.ts` comment.

- `docs/extending/embedding/platform-adapter.md` (`spec: desktop.md#3`): in "Capabilities beyond the interface", "That is how the desktop's `updater` and window controls work" → "That is how the desktop's window controls and GitHub sign-in work".
- `docs/extending/embedding.md` (`spec: desktop.md#1`): the "Desktop (ElectroBun / Chromium app-mode)" row's adapter cell becomes "`packages/desktop/src/platform.ts` (ElectroBun), `packages/desktop/src/chromium/platform.ts` (Chromium app-mode)".
- `docs/studio/desktop.md` and `docs/extending/embedding/backend-protocol.md`: no change. The first describes no layout; the second already links the generated route reference.

No spec graduates. Landing deletes this file.

## Acceptance

- `bun run plans:status --spec desktop` no longer lists `desktop.md#7.4`, and `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `grep -nE "jx-studio-app|studio-handlers|studio-desktop|platforms/devserver\.js|panels/toolbar|code-services\.js|roughly (60|70)|three deployment" specs/desktop.md` prints nothing, and `grep -c "Filesystem via dev server" specs/desktop.md` prints `1` (the Dev mode row).
- `grep -n "electrobun/bun" specs/desktop.md` prints only §7.1's "deprecated alias" sentence.
- Every path the source tree names exists: `cd packages/desktop && for p in hutch.config.ts electrobun.config.ts release-assets.json src/index.ts src/window-manager.ts src/project-session.ts src/handlers.ts src/rpc-schema.ts src/boot.ts src/init.ts src/platform.ts src/chromium scripts/pre-build.ts scripts/init-bundle.ts scripts/stage-studio-assets.ts scripts/pre-build-rpc.ts scripts/post-build.ts scripts/verify-bundle.ts; do test -e "$p" || echo "missing $p"; done` prints nothing.
- Every packaged file the second tree names is in `REQUIRED`: `bun -e 'import { REQUIRED } from "./packages/desktop/scripts/verify-bundle.ts"; for (const p of ["bun/index.js","bun/registry.json","views/studio/index.html","views/studio/canvas.html","views/studio/dist/init.js","views/studio/dist/studio.js"]) if (!REQUIRED.includes(p)) console.log("absent", p)'` prints nothing.
- `grep -n "toolbar.ts" packages/desktop/src/platform.ts` prints nothing.
