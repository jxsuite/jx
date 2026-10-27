---
status: drafted
disposition: implement
claims: []
workspaces:
  - packages/desktop
  - packages/server
  - packages/compiler
  - packages/import
  - packages/schema
  - scripts
  - .github
size: L
---

# The packaged backend runs on Electron's Node, and Studio installs packages with Arborist

## Context

App Review rejected the Mac App Store build `6.1.0 (443)` with two automated findings:

1. **Non-public API use, 129 symbols** (`_ubrk_*`, `_ucal_*`, `_ucol_*`, `_udat_*`, `_unum*`, `_ures_*` and others). Every one is an undefined import of the pinned Bun binary (`resources/bun/bun`) from `/usr/lib/libicucore.A.dylib`: `nm -u` finds them there and in no other Mach-O in the package. JavaScriptCore links the system ICU on Apple platforms, so every macOS Bun build imports it. A version bump cannot fix this; only removing Bun from the package can.
2. **`com.apple.security.network.server` without matching functionality.** The entitlement is needed: each window's backend server listens on loopback (desktop.md §9.7). This is a reply to App Review, not a code change, and the same reply goes in the App Review Information notes.

`specs/desktop.md` §7.1 states why the backend is Bun ("The backend's module graph is Bun-native throughout") and §7.4 ships the binary in `resources/bun`. The graph is less Bun-native than that sentence says. The metafile of a `Bun.build` of `src/hub/main.ts` with `BACKEND_EXTERNALS` reaches 28 first-party files that use Bun: 12 APIs and about 100 call sites, measured on 2026-10-27 against `a410caf4`:

| API                       | Uses | Where                                                                                                                                                                         |
| ------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Bun.serve` + WebSocket   | 17   | `server/src/project-server.ts`, `collab.ts`, `site-preview.ts`, `live-preview.ts`, `oauth-loopback.ts`, `desktop/src/github-signin.ts`, `import/src/{verify,pipeline,run}.ts` |
| `Bun.Glob`                | 16   | `server/src/studio-api.ts`, `refactor/scan.ts`, `live-preview.ts`, `desktop/src/project-session.ts`                                                                           |
| `Bun.build`               | 14   | `compiler/src/site/bundler.ts` (already has an esbuild branch), `server/src/build.ts`, `project-server.ts`, `live-preview.ts`                                                 |
| `Bun.file` / `Bun.write`  | 17   | `studio-api.ts`, `net-guard.ts`, `project-session.ts`, `code-api.ts`, `import/src/{io,run,verify}.ts`                                                                         |
| `Bun.spawn` / `Bun.which` | 15   | `studio-api.ts` (git, `bun add`/`remove`), `server/src/packages.ts`, `desktop/src/git.ts`, `chromium/shell-command.ts`, `import/browser-local.ts`                             |
| the rest                  | 11   | `import.meta.dir` ×5, `Bun.resolveSync` ×3, `Bun.Transpiler` ×2 (`code-api.ts` minify), `Bun.hash` ×1 (`site-build.ts`)                                                       |

The server surface those `Bun.serve` calls rely on is small: a Fetch-API `fetch(req, server)` handler, `port`, `url`, `stop()`, `idleTimeout`, `upgrade(req, { data })`, and a socket's `send`, `close` and `data`. No `publish`/`subscribe`, no `routes`.

Bun also does a second job in the shipped application: it is the **package manager**. `server/src/packages.ts` runs `bun install`, `bun add [-d]` and `bun remove` as children (`process.execPath`), and `studio-api.ts` does the same for the dev server's `/__studio/packages*` routes. The registry lookups (`fetchLatestVersion`) are plain `fetch` already.

Electron 43.7.7, the pinned `electronVersion`, embeds Node 24.21.0 with its own ICU (78.2, symbols internal to Electron Framework), and has `fs.promises.glob`, `import.meta.dirname` and the Fetch globals. Bun implements the same `node:` APIs, so most of the port is a move to APIs both runtimes share.

## Outcome

- The packaged application, in every channel (DMG, Mac App Store, NSIS, appx, AppImage, snap, Nix), runs its backend on the Node inside Electron. `resources/bun` and `bun-runtime.json` are gone.
- Studio's package operations (install, add, remove, set versions) run `@npmcli/arborist` in-process, with `pacote` answering registry metadata. No package manager binary ships.
- Bun stays the monorepo's tool: `bun install`, `bun test --isolate`, the build scripts, `jx dev`'s dev server (`createDevServer`, server.md §2) and the per-window development launcher (`bun run chromium`).
- A Mac App Store build passes the automated review and `plan:desktop/mac-app-store` can close desktop.md §7.7.

This plan claims nothing. It is the enabling plan for `plan:desktop/mac-app-store`, which owns §7.7 and requires it. It rewrites what §7.1, §7.4, §7.6, §9.3 and §9.7 say about the runtime, and server.md's statements about `project-server.ts`, `code-api.ts` and `packages.ts`.

## Decisions

- **Decided:** every channel moves, not only the Mac App Store. A Node backend in one channel and a Bun backend in the others would be two programs from one source, each needing its own smoke test, and the other channels gain from it too (27 MB less per installer, one runtime to patch, one less binary to sign).
- **Decided:** the backend is started with Electron's `utilityProcess.fork()`, not `child_process.spawn` of a Bun. It runs as an Electron helper, so it is signed with `entitlements.mas.inherit.plist` and inherits the sandbox and the folder grants exactly as the Bun child does now, and the restart-after-grant logic of §7.7 is unchanged. The protocol of §9.7 is unchanged; only its transport changes, from `process.send` to `process.parentPort` on the backend side, and `hub/main.ts` keeps both so the development launcher still runs it under Bun.
- **Decided:** runtime-specific code is selected at **resolution time** through package `exports` conditions (`"bun"` then `"default"`), not by `typeof Bun` at run time. The Node bundle then contains no Bun code at all, which is what makes the gate below a plain text check rather than a judgement. This follows Node's conditional exports and the WinterCG runtime keys.
- **Decided:** primitives move to APIs both runtimes implement, and only the server needs two implementations. `Bun.Glob` → `fs.promises.glob`; `Bun.file`/`Bun.write` → `node:fs/promises` with the media type from `@jxsuite/schema/media-type`; `Bun.spawn` → `node:child_process`; `Bun.which` → a small `which()` in `@jxsuite/schema` (or the `which` package); `Bun.hash` → `node:crypto`; `import.meta.dir` → `import.meta.dirname`; `Bun.resolveSync` → `createRequire(...).resolve` (the compiler's fallback already); `Bun.Transpiler` minify → `esbuild.transform` (esbuild is already a compiler dependency). Each replacement lands with a parity test that runs under `bun test` and compares the new answer to Bun's own on the same input (glob results, media types), because "Bun gave the same answer" is the property being preserved.
- **Decided:** all bundling in the backend goes through the compiler's existing bundler abstraction (`compiler/src/site/bundler.ts`), whose esbuild branch is already the Node path (compiler.md's "Backends"). `server/src/build.ts`, `project-server.ts` and `live-preview.ts` stop calling `Bun.build` directly.
- **Decided:** Arborist runs with `ignoreScripts: true`. Lifecycle scripts would run arbitrary code from the registry inside the sandbox with the user's folder grants, and neither `esbuild` nor `sharp` (the native packages a Jx project pulls in through `@jxsuite/compiler`) needs one: both ship their binary in a platform `optionalDependencies` package. Its cache is the user-data directory (`npm-cache`), which the sandbox maps into the container.
- **Decided:** the `jx dev` dev server stays Bun-only. It is contributor and CLI tooling (server.md §2, "spawns it under Bun"), so `createDevServer` keeps returning the `Bun.serve` object and server.md's contract for it does not change. Only the modules the desktop backend reaches become neutral.
- **Decided:** the Node server is our own `serve()` over `node:http` and the `ws` package, exposing exactly the surface listed in Context, with `Bun.serve` behind the `"bun"` condition. `srvx` with `crossws` was the alternative: maintained and good at streaming bodies, but its WebSocket hooks are a different shape from `upgrade(req, { data })`, so every call site would change instead of one module. Owning the Node side means owning the request conversion and response streaming, which the tests below hold.
- **Decided:** Studio's projects move to `package-lock.json`. Arborist reads and writes it, and on the first install in a project that has a `bun.lock` and no `package-lock.json`, Studio writes `package-lock.json` and deletes `bun.lock`, saying so in the operation's log. One lockfile is the only state in which Studio and a command-line install cannot disagree. Keeping both was refused because they drift; installing without a lockfile was refused because it is not reproducible. No starter or template commits a lockfile, so this reaches only projects an earlier Studio installed with Bun, and a user who runs `bun install` afterwards gets Bun's own migration from `package-lock.json`.
- **Decided:** the dev server's `/__studio/packages*` routes move to Arborist as well, because `server/src/packages.ts` exists so that both backends behave identically and one implementation is one thing to test. The cost is that a contributor iterating a starter in browser Studio gets Arborist's installs there, so the slice re-checks the shadowed-core cleanup (root AGENTS.md, "Starter Roots and the Shadowed Core"), which removes `node_modules/@jxsuite/*` and the stray lockfile from starter roots and must now treat `package-lock.json` as that lockfile.

## Implementation

**NB1.1 Neutral primitives.** Replace the Bun primitives listed in Decisions across `server/src`, `import/src`, `compiler/src/site`, `desktop/src` (not `chromium/index.ts`, the development launcher) with the shared `node:` APIs. `Bun.file`'s type inference is replaced by `@jxsuite/schema/media-type`'s table, extended until a parity test over every extension the routes serve agrees with `Bun.file(...).type`. Nothing changes behaviour under Bun, so this slice is safe to land alone.

**NB1.2 The server seam.** Add `serve()` (and the socket type replacing `ServerWebSocket`) to `@jxsuite/server` behind an `exports` entry with a `"bun"` condition (`serve.bun.ts`, a pass-through to `Bun.serve`) and a default (`serve.node.ts`). Move `project-server.ts`, `collab.ts`, `site-preview.ts`, `live-preview.ts`, `oauth-loopback.ts`, `github-signin.ts` and the import package's three servers onto it. The Node implementation must stream response bodies (SSE heartbeats and AI streams depend on it, which is why `idleTimeout: 120` exists) and honour `idleTimeout` on the socket. Route `Bun.build` calls in `server/src` through `@jxsuite/compiler`'s bundler.

**NB1.3 Packages through Arborist.** Reimplement `installDependencies`, `addPackage`, `removePackage` and `setPackageVersions` in `server/src/packages.ts` over `@npmcli/arborist` (`reify()`, `reify({ add, saveType })`, `reify({ rm })`), and `fetchLatestVersion` over `pacote.manifest("<name>@latest")` so a project `.npmrc` registry applies. `PackageOpResult.log` carries Arborist's log output. The first install in a project with `bun.lock` and no `package-lock.json` deletes `bun.lock` after a successful reify, never before. `studio-api.ts`'s `/__studio/packages*` routes call the same functions instead of spawning `bun`, and `scripts/check-shadowed-core.ts` treats a starter root's `package-lock.json` as the stray lockfile it removes. `bunExecutable()` is deleted. Add both packages as `@jxsuite/server` dependencies.

**NB1.4 The application.** `scripts/stage-app.ts` bundles `hub/main.ts` for `target: "node"` with the default conditions. Native packages the backend reaches by `import()` (`esbuild`'s platform binary, `sharp` and its `@img/*` libvips, `oxfmt`'s binding) are staged as real files beside the bundle, like `BACKEND_MODULES`, because the packaged app of `6.1.0` carries no `.node` file at all and what that means for formatting and image optimization today is unmeasured: measure it first, with the smoke test. `electron-shell/backend-process.ts` forks with `utilityProcess`; `layout.ts` loses `bun`; `bun-runtime.json`, its test and the download step of the release lanes are deleted. `package.nix` and the snap stop carrying a Bun for the backend. `bun run smoke` starts the staged backend under Node 24 (the major of Electron's Node, from `setup-node` in the pull-request job) and, in each release lane, under the packaged Electron with `ELECTRON_RUN_AS_NODE=1`.

**NB1.5 The gates.** A desktop test bundles `hub/main.ts` exactly as staging does and fails if the output contains `Bun.` or an import of `bun`/`bun:*`. It derives the file set from the metafile, so a new Bun call anywhere the backend reaches fails in the pull request that adds it. `mas-publish.yml` gains a step before the upload: `nm -u` over every Mach-O in the `.app`, failing on any symbol imported from `libicucore` and printing the binary that imports it. This is the check App Review ran, run first.

**NB1.6 Resubmit.** Reply to the network.server finding (the backend's per-window servers listen on loopback for the Studio window and its canvas iframe), add the same text to App Review Information, upload through the lane, test from TestFlight (pick, edit, save, relaunch, Recent, add a package), and submit. This slice belongs to `plan:desktop/mac-app-store` and is listed so the order is visible.

Integration contract for `plan:desktop/mac-app-store`: once this lands, nothing in `Resources/` imports `libicucore`, the backend is an Electron utility process that inherits the main process's sandbox and grants, and package operations need only `network.client`.

## Tests

- **Parity tests, under `bun test --isolate`:** glob, media type and minify against Bun's answers (NB1.1); the Node `serve()` driven by `fetch` and a WebSocket client, imported directly from `serve.node.ts` so `bun test` covers it (`node:http` runs under Bun), including a streamed SSE body and an upgrade carrying `data` (NB1.2).
- **Arborist against a local registry fixture:** `tests/packages.test.ts` gains cases over a temporary project with a tarball registry served from a fixture, so nothing reaches npm: add, add `-d`, remove, set versions, the `bun.lock` switch (deleted only after a successful install, kept when the install fails), and that `ignoreScripts` holds (a fixture package whose `postinstall` writes a marker file must not write it).
- **The smoke test under Node** is the proof that the bundle is a Node program. Extend it to add and remove a package through the RPC, since that is new code reached only in the bundle.
- **The Bun-free bundle test** and the Mach-O scan of NB1.5.
- Coverage: `packages/server`, `packages/desktop` and `packages/import` keep their thresholds; new files ship with tests, and the manifest check holds them. `serve.bun.ts` is a pass-through tested through the routes that already use it.

## Specs & docs

- desktop.md §7.1: replace "Why the backend is still Bun" with the Node runtime and the reason (the system ICU import, App Review). §7.4: drop `bun/bun` from the tree, add the staged natives. §7.6: the entitlements paragraph stops naming Bun's JavaScriptCore. §9.7: the backend is a utility process. §9.3: the Nix package's runtime. Fragment: `bun run spec:change specs/desktop.md minor -m "The packaged backend runs on Electron's Node; Studio installs packages with Arborist"`.
- server.md: the module list and §5's `/__studio/code/minify` row (esbuild, not `Bun.Transpiler`), §1's "Bun-native" narrowed to `createDevServer`, and the package routes. Fragment: `bun run spec:change specs/server.md minor -m "Backend modules run on Node and Bun; package operations use Arborist"`.
- `packages/desktop/AGENTS.md`: the Bun-backend bullets, and "Bun folds module-identity globals" (the bundler is still Bun's, so it still applies). `docs/studio/desktop.md` and any docs page `bun run docs:sync` names for these files.

## Acceptance

- `nm -u` over every Mach-O in a Mac App Store build finds no `libicucore` import, and the lane's step proves it on every upload.
- `bun run smoke` passes under Node 24 on all three lanes, including a package add and remove.
- The Bun-free bundle test passes, and fails when a `Bun.` call is added to any file the backend reaches.
- A TestFlight build opens a picked project, edits and saves it, adds a package, and reopens from Recent after a relaunch.
- App Review accepts the build past the automated stage.

## Slices

| Slice | Scope                                                              | Claims | State |
| ----- | ------------------------------------------------------------------ | ------ | ----- |
| NB1.1 | Neutral primitives with parity tests                               | none   | open  |
| NB1.2 | `serve()` seam, Node implementation, bundling through the compiler | none   | open  |
| NB1.3 | Package operations on Arborist and pacote                          | none   | open  |
| NB1.4 | Utility-process backend, staging, smoke under Node, Bun removed    | none   | open  |
| NB1.5 | Bun-free bundle test and the Mach-O scan                           | none   | open  |
| NB1.6 | Reply, resubmit, TestFlight check (owned by the store plan)        | none   | open  |
