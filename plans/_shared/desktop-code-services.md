---
status: drafted
disposition: implement
claims:
  - desktop.md#5.3
  - studio.md#6.4
size: M
workspaces:
  - packages/server
  - packages/desktop
  - packages/protocol
  - .github/workflows
  - scripts
  - docs
---

# The desktop app formats, lints and minifies function bodies in its own Bun process, and the code editor's text names the one host that has none

## Context

`specs/desktop.md` §5.3, line 471:

> **Status: Partial.** The dev server runs all three (`handleCodeApi` in `packages/server/src/code-api.ts`), and the null-stub contract below holds on every platform. Neither desktop launcher runs any: `codeService` in `packages/desktop/src/project-session.ts` resolves `null` for both, so the Bun process §7.1 draws with code services has none, and the function editor (`packages/studio/src/panels/editors.ts`) formats, lints and minifies nothing on the desktop.

`specs/studio.md` §6.4, line 663:

> **Status: Partial.** The editor and its Format, Minify and Lint calls ship (`codeService` in `packages/studio/src/services/code-services.ts`, called from `panels/editors.ts`), and the dev server serves them (`/__studio/code/*` in `packages/server/src/code-api.ts`). The desktop app, the end-user path, does not: its `codeService` returns `null` (`packages/desktop/src/project-session.ts`), as does the cloud host's (`packages/studio/src/platforms/cloud.ts`), so format, minify and lint silently do nothing there.

§5.3 was the retired §11 roadmap's row "Port code services (format, lint, minify) to run in Bun process directly (currently stubbed)". §6.4 ("Integrated with server code services") was opened by the markers stage (critic finding M5) and joined this plan because its desktop half is the same missing code. The cloud half is not a second implementation. desktop.md §5.3 already makes `codeService` null-returning "for platforms without server-side code tooling", the three routes are `optional` in `STUDIO_ROUTES`, and the cloud adapter lists code services among its declared omissions. Its backend is outside this repository and composes per-project schemas in a Worker (studio.md §3.4's platform list), where `Bun.Transpiler` and a spawned CLI do not exist. So §6.4 is closed by the desktop implementation plus a sentence naming the cloud as the host that degrades.

**What exists** (verified 2026-09-26)

- `handleCodeApi(req, url)` in `packages/server/src/code-api.ts`: `format` from `oxfmt`'s Node API, `minify` from a module-level `Bun.Transpiler`, `lint` by spawning the path `resolveOxlintBin()` returns. server.md §5 is Implemented. `@jxsuite/server` has no `./code-api` export.
- `codeService` in `project-session.ts` (`async function codeService(_request?: …) { return null; }`). It is registered by `hub/handlers.ts` (the Electron application's per-window map, `wire(session.codeService)`) and by `chromium/index.ts` (the development launcher's default session via `handlers.ts`), declared in `rpc-schema.ts`, and forwarded by `chromium/platform.ts`, the one adapter. `jxResolve` in the same file is the precedent for answering an RPC from a server module.
- The editor (`panels/editors.ts`) formats on open, lints on open and on a 750 ms debounce, and minifies in `closeFunctionEditor`. Each treats `null` as a no-op. There is no control to disable.
- `devserver.ts:679` POSTs to `/__studio/code/<action>` and maps a non-OK response to `null`. `cloud.ts:835` returns `null`.
- `STUDIO_ROUTES` (`packages/protocol/src/routes.ts:249`): `codeFormat`, `codeMinify`, `codeLint`. Two of their texts are wrong. The request bodies are `{code, args?}`, not `{code, path?}`, and `codeMinify`'s degradation ("Compiled-output minification is skipped.") describes nothing that exists, because minify runs when the function editor closes.

**Corrections to the stub's evidence**

- **oxlint is not a binary.** `node_modules/oxlint/bin/oxlint` (1.85.0) is `#!/usr/bin/env node` plus `import "../dist/cli.js"`, over the napi binding `@oxlint/binding-<triple>`. "Stage an oxlint binary" is impossible. The dev server works because a `node` (or Bun's shim) is on its PATH. The Nix wrapper provides Bun and no `node`, so lint through `.bin/oxlint` on the chromium launcher would depend on whatever the user's PATH holds.
- **oxfmt's JS is already in the packaged bundle.** The backend entry (`hub/main.ts`) imports `@jxsuite/server/project-server`, which imports `server.ts` (for `resolveNpmPath`), which imports `code-api.ts`, which imports `oxfmt`, so the JS is inlined into `resources/backend/index.js`. That chain is why `BACKEND_EXTERNALS` (`scripts/lib/backend-bundle.ts`) lists the optional prettier plugins oxfmt probes for. oxfmt loads its native binding lazily on the first `format()` call. Only the binding is missing from the package.
- **`@jxsuite/server` imports `oxfmt` and runs `oxlint` without declaring either.** Both are root devDependencies. The release lanes install them only because `bun install` installs the root's dev tools; the Nix package runs from source with a full production `node_modules`, so it has both packages whole.
- **Bun auto-installs at run time, unless a `node_modules` is in reach.** A spike on linux-x64 bundled an entry calling oxfmt's `format` with `Bun.build({ target: "bun" })` into a directory with no `node_modules` above it. Without the binding, `bun --no-install` threw "Cannot find native binding". Plain `bun` downloaded the binding from npm and formatted. With `oxfmt.linux-x64-gnu.node` beside the output, both formatted. oxlint's CLI, copied as `oxlint/{bin,dist,package.json}` with `oxlint.linux-x64-gnu.node` in `dist/`, linted under `bun --no-install`. The packaged backend already has a `node_modules` beside its bundle (`BACKEND_MODULES`), so Bun never auto-installs there and a missing binding fails instead of downloading; the smoke check below is what turns that failure into a red build.
- **Lint depends on the host's working directory.** oxlint uses the nearest `.oxlintrc.json` at or above its cwd. The same wrapped body linted from the monorepo root, or from `packages/server` (the server tests' cwd), ran 393 rules and reported `import(unambiguous)`, `eslint(no-implicit-globals)`, `eslint(no-var)` and `eslint(no-debugger)`. Linted from outside the repository it ran 95 rules and reported only `no-debugger`. The dev server's diagnostics are the repository's lint policy applied to a synthetic wrapper. Passing a config with `-c` suppresses discovery entirely: an empty one gave the 95-rule result from `packages/server`, and a `.oxlintrc.json` in the cwd or beside the linted file was ignored (both checked 2026-09-27).
- **Minify depends on format.** The editor stores what `minify` returns on close and shows what `format` returns on open. A host that answered minify but not format would store bodies on one line and then show them on one line.
- `plans/studio/README.md` lists §6.4 under Verified from before the markers stage. The line becomes true again when this plan lands, so the record needs no edit.

## Outcome

- desktop.md §5.3 → Implemented: both Bun-side entries (the Electron application's hub and the development chromium launcher) answer format, lint and minify from the dev server's implementation, in their own Bun process, packaged and Nix alike.
- studio.md §6.4 → Implemented: the editor's services come from the host. A host without code tooling (the cloud) resolves `null`, and the editor degrades silently as described. That is a stated contract, not an open item.
- server.md §5 stays Implemented, rewritten in place: oxlint runs under the host's Bun with default rules, and format and minify answer 501 together when the formatter cannot load. §4.3 (the code services' 200) and §7 (the two dependencies) follow.

## Decisions

- **Decided:** one implementation, called without HTTP. `code-api.ts` gains `runCodeService(action, payload)`, which returns the three results or `null`. `handleCodeApi` becomes its HTTP adapter, and the desktop session calls it directly rather than building a synthetic `Request` as `jxResolve` does. The RPC has no path, method or auth to preserve, so a Request round trip would only serialise the JSON twice.
- **Decided:** lint runs oxlint's CLI script as `[process.execPath, <oxlint>/bin/oxlint]`, so no host needs `node`. Each call works in a private `mkdtemp` directory holding the wrapped body and an empty `.oxlintrc.json`, passed with `-c`, and that directory is the cwd. The explicit config makes every host lint with oxlint's defaults (plus the existing `-A no-unused-vars`). Pinning cwd alone would not: oxlint walks up from it, and on Linux `tmpdir()` is a world-writable `/tmp` where another user could plant a config whose `jsPlugins` run code in the linter. The project's own `.oxlintrc.json` is not used either. `codeService` carries no project path, a welcome window has none, and module rules misfire on the synthetic wrapper (`import(unambiguous)`, `no-implicit-globals`). `JX_OXLINT_BIN` and the PATH fallback are still spawned directly, with the same arguments.
- **Decided:** format and minify stand or fall together. A module-level probe (`format("probe.js", "0", {})`) decides whether the formatter loads. It memoises the promise, because format and lint are requested together when the editor opens. When the formatter does not load, `format` and `minify` resolve `null`, and over HTTP both answer `problem("capabilityUnavailable")` (501), which `devserver.ts` already reads as `null`. Lint degrades on its own to `{ diagnostics: [] }`, as today.
- **Decided:** the packaged app stages the tools beside its bundled backend module, in `resources/backend/`, and not under a `node_modules` directory. The layout is `backend/oxfmt.<triple>.node` and `backend/oxlint/{package.json,bin,dist}`, with `oxlint.<triple>.node` in `dist/`. These are the first paths each package's napi loader probes (`./<name>.<triple>.node` beside its own module), and the spike proved both. The paths come from one list in `packages/desktop/scripts/lib/backend-bundle.ts` (`BACKEND_CODE_TOOLS`, beside `BACKEND_DATA` and `BACKEND_MODULES`, with the same rule: nothing else lists them), read by `stage-app.ts` to copy and by `smoke-backend.ts` to verify. The tools are per platform and architecture, so the list is a function of the target (`napiTriple(platform, arch)`), and staging for a target other than the host reads that target's binding package, which `bun install` has only if the host installed it; `stage-app.ts` fails by name when it cannot find it, never staging a mismatched binding.
- **Decided:** `packages/server/package.json` declares `oxfmt` and `oxlint` as dependencies, at the root's ranges. `code-api.ts` imports the one and runs the other, and an undeclared import crashes any consumer without the monorepo's dev tools. The root keeps its devDependencies, so hoisting still yields one copy.
- **Decided:** the three `STUDIO_ROUTES` entries are corrected to the real body (`{code, args?}`) and the real degradations. This is text only, so `STUDIO_PROTOCOL_VERSION` does not move.
- **Open:** does the packaged app ship lint? It costs +16 MB (oxlint's binding) and +1.7 MB (its CLI) per platform, uncompressed (linux-x64 sizes), plus one child process per 750 ms debounce. Format costs +8.8 MB. Recommendation: ship it. desktop.md §7.1, studio.md §6.4 and `docs/studio/logic/code.md` all promise live linting. Lint is the one of the three that finds bugs, and an Electron application already weighs far more. Without it, the Tests and Implementation lose the oxlint rows, and §5.3 states lint's degradation on the desktop.
- **Open:** how is macOS signing of the staged `.node` files proven before a release depends on it? Notarization rejects an unsigned Mach-O anywhere in the bundle, and a hardened-runtime Bun refuses to load a library its validation rejects. The entitlements file (`build-resources/entitlements.mac.plist`) grants `disable-library-validation` to the application and to every nested executable, which covers loading a `.node` signed by its publisher or ad hoc; what is unproven is whether electron-builder also signs Mach-O files under `Resources/backend`, and `bundle-desktop-macos.yml` runs only at release (desktop.md §7.6 is Partial for exactly this reason). Recommendation: require one green run of that lane dispatched against the pull request's branch (give it a blank-tag `workflow_dispatch` entry that attaches only when a tag is given, if it lacks one) with the signing and notarization secrets, then `codesign --verify --deep --strict` and `spctl` on the unpacked app, and a manual install of that run's DMG that formats and lints a body. If either fails on the bindings, electron-builder's `mac.binaries` lists them (see Implementation step 9).
- **Open:** should the null degradation be said in the editor, or stay silent? Recommendation: silent, stated in §6.4. The only host that degrades is the cloud, which `docs/start/install.md` says is in development. Nothing is lost, since the body is written back as typed. A notice would need a new editor surface, and a way to tell "no service" from "nothing to report".
- **Open:** should `cloud.ts`'s `codeService` forward to its backend's `studio/code/*` route, returning `null` on a non-OK response as `devserver.ts` does? Recommendation: no. It is not needed to close §6.4, the backend is outside this repository and cannot run the implementation as it stands, and it would add `packages/studio` for a speculative opt-in. A backend that gains code services can be given the forward in the same change.

## Implementation

**`packages/server`**

1. `src/code-api.ts`:
   - Export `CODE_SERVICE_ACTIONS = ["format", "lint", "minify"] as const`.
   - Export `runCodeService(action: string, payload: unknown): Promise<CodeServiceResult | null>`, with `CodeServiceResult` from `@jxsuite/protocol`. It narrows `payload` with `isJsonObject` (`@jxsuite/schema/guards`), keeps `code` when it is a string and `args` when it is a string array, and drops anything else (a payload that is not an object is an empty body). It dispatches to `formatBody`, `minifyBody` and `lintBody`, the three branches moved out of `handleCodeApi` with their results unchanged, and returns `null` for any other action. Dropping a non-array `args` means `wrapBody` can no longer throw, so `formatBody`'s `catch` is reached only when `format` itself rejects.
   - Add `formatterLoads(): Promise<boolean>`, a module-level probe that memoises its promise. `formatBody` and `minifyBody` return `null` when it resolves `false`, before touching the body.
   - `handleCodeApi` keeps its path, method and JSON guards, and still returns `null` for an action outside `CODE_SERVICE_ACTIONS`. When `runCodeService` resolves `null` it returns `problem("capabilityUnavailable", "The formatter did not load, so format and minify are unavailable")`; otherwise it returns `Response.json(result)`.
   - Replace `resolveOxlintBin` with `resolveOxlintCommand(startDir = import.meta.dir): string[] | null`, which probes in order:
     - `JX_OXLINT_BIN` (empty means disabled) → `[override]`.
     - `join(startDir, "oxlint", "bin", "oxlint")`, the packaged layout that desktop.md §7.4's packaged-static-data rule stages beside the bundled module → `[process.execPath, path]`.
     - A walk up from `startDir` for `node_modules/oxlint/bin/oxlint` → `[process.execPath, path]`.
     - `Bun.which("oxlint")` → `[path]`.
     - Otherwise `null`.
   - Delete `OXLINT_NAME`, because the package path is the same file on every OS.
   - `lintBody` makes `dir = await mkdtemp(join(tmpdir(), "jx-lint-"))` (`node:fs/promises`, mode 0700), writes the wrapped body to `dir/fn.js` and `{}` to `dir/.oxlintrc.json`, spawns `[...command, "-c", <dir>/.oxlintrc.json, "--format=json", "-A", "no-unused-vars", <dir>/fn.js]` with `cwd: dir`, and removes `dir` recursively in `finally`. This replaces the loose `__jx_lint_*.js` file in `tmpdir()`.
   - Rewrite the header and `resolveOxlintCommand` comments. The packaged app no longer "quietly returns no diagnostics".
2. `package.json`: add `"./code-api": "./src/code-api.ts"` to `exports`, and add `"oxfmt": "^0.70.0"` and `"oxlint": "^1.85.0"` to `dependencies`. Then run `bun install`. `bun.lock` must stay at `lockfileVersion: 1`, and `bun.nix` catches up on the release pull request as usual. `README.md`'s Dependencies table gains `oxfmt` ("Formats function bodies for the code services") and `oxlint` ("Lints function bodies, run as a CLI under Bun").

**`packages/protocol`**

3. `src/routes.ts`:
   - `codeFormat` becomes "Format a function body {code, args?} → {code, errors}", degradation "The function editor opens a body as stored (codeService returns null)."
   - `codeMinify` becomes "Minify a function body {code} → {code}", degradation "The function editor writes a body back unminified. A backend that cannot format must not serve this route."
   - `codeLint` becomes "Lint a function body {code, args?} → {diagnostics}", with its degradation unchanged.

**`packages/desktop`**

4. `src/project-session.ts`: import `runCodeService` from `@jxsuite/server/code-api`. Replace the stub with `async function codeService(params: { action: string; payload: unknown }) { return runCodeService(params.action, params.payload); }`. Add a JSDoc saying it needs no project root, so it answers in a welcome window too.
5. `src/chromium/index.ts`: `codeService: (params) => codeService(params as { action: string; payload: unknown })`. `hub/handlers.ts` already forwards `wire(session.codeService)`; `handlers.ts`, `rpc-schema.ts` and `chromium/platform.ts` do not change.
6. `scripts/lib/backend-bundle.ts`: export `napiTriple(platform, arch)` (`darwin-<arch>`, `linux-<arch>-gnu`, `win32-<arch>-msvc`, else `<platform>-<arch>`) and `BACKEND_CODE_TOOLS(triple)`, a function returning in this order, as `BackendData` rows (sources relative to `packages/desktop`, destinations relative to the directory `index.js` is in):
   - `../../node_modules/@oxfmt/binding-<t>/oxfmt.<t>.node` → `oxfmt.<t>.node`
   - `../../node_modules/oxlint/package.json` → `oxlint/package.json`
   - `../../node_modules/oxlint/bin/oxlint` → `oxlint/bin/oxlint`
   - `../../node_modules/oxlint/dist` → `oxlint/dist`
   - `../../node_modules/@oxlint/binding-<t>/oxlint.<t>.node` → `oxlint/dist/oxlint.<t>.node`
     The file's header gains the third kind of staged thing (native addons) and why they are neither data nor `BACKEND_MODULES`.
7. `scripts/stage-app.ts`: stage the rows of `BACKEND_CODE_TOOLS(napiTriple(targetPlatform, targetArch))` beside `index.js` after the data rows, failing by name when a source is missing. `electron-builder.yml` needs no change: `extraResources` already copies `build/resources/backend` whole.
8. `scripts/smoke-backend.ts`: a new check, "the code tools load from the staged layout", that calls `codeService` through the backend's IPC for `format` (a tab-indented body comes back), `lint` (`debugger;` yields `eslint(no-debugger)`) and `minify`, and fails the build when `format` answers `null` or lint answers no diagnostics. This is the packaged-layout witness and the only place a missing binding becomes a red build: the backend degrades to `null` by design. It runs in the `desktop-bundle` job of test.yml and in every release lane, on the Bun that ships beside the bundle.
9. Only if the dispatched macOS run shows notarization rejecting the bindings, or its installed app failing to load them: sign them in the packaging step (`electron-builder.yml` `mac.binaries` listing the staged `.node` paths and `oxlint/bin/oxlint`, which electron-builder signs with the same identity and `entitlements.mac.plist`), not in a bespoke hook. The Windows and Linux packages need nothing: unsigned `.node` files load, and the AppImage carries them as files.

**`.github/workflows`**

10. `bundle-desktop-macos.yml` (per the second Open decision): add `workflow_dispatch` with an optional `tag_name` defaulting to `""`, if the lane lacks one. Guard "Attach to release" with `if: ${{ !cancelled() && inputs.tag_name != '' }}`.

**Integration contract.** Once this lands, a plan that requires it may rely on four things:

- `@jxsuite/server/code-api` exports `runCodeService`, `CODE_SERVICE_ACTIONS`, `resolveOxlintCommand` and `handleCodeApi`.
- Every Bun-side entry's `codeService` (the hub's and the development launcher's) answers all three actions. It resolves `null` only for an unknown action, or for format and minify when the formatter cannot load.
- `packages/desktop/scripts/lib/backend-bundle.ts` (`BACKEND_CODE_TOOLS`) is the one list of staged code-tool paths, and `bun run smoke` proves the staged layout loads.
- desktop.md §5.3 names the packaged layout.

desktop.md §7.4's trees name no `code-services.js`: the services live in `@jxsuite/server` and are answered by `project-session.ts`. The packaged tree gains `oxfmt.<triple>.node` and `oxlint/` under `backend/`, so the landing pull request adds them to §7.4's packaged tree. `plan:desktop/packaged-window-boot-ci` may add a format round trip to its boot check.

## Tests

`packages/server` (`cd packages/server && bun test --isolate --coverage`; `bunfig.toml` gates lines 0.96, functions 0.95 per file):

- `tests/code-api.test.ts`: the `resolveOxlintBin` block becomes `resolveOxlintCommand`, with four cases:
  - The override yields `["/custom/bin/oxlint"]`.
  - The walk-up yields `[process.execPath, <root>/node_modules/oxlint/bin/oxlint]`, which exists.
  - "a staged copy beside the module wins": a temp `startDir` holding `oxlint/bin/oxlint` yields that path.
  - `"/"` with an empty PATH yields `null`.
- A new `runCodeService` block in the same file:
  - `format` returns what the HTTP route returns for the same body.
  - `minify` returns `{ code }`.
  - `lint` of `debugger;` returns a diagnostic on line 1 (unwrapped).
  - An unknown action returns `null`.
  - A non-object payload behaves as an empty body.
- `tests/code-api-gaps.test.ts`:
  - "format error path" (`args: 123`) breaks, because a non-array `args` is now dropped. It becomes "a non-array args is ignored": the body formats under the default `(state, event)` wrapper with `errors: []`. The `catch` it used to reach moves to the mocked file below.
  - Add "lint uses oxlint's defaults, not a discovered config": lint `var x = 1;` and assert no `eslint(no-var)`. The repository's config enables that rule and oxlint discovers it from this suite's cwd (`packages/server`), so the case fails today.
  - Add "a config planted in the temp directory is ignored": set `TMPDIR` to a fresh directory holding `.oxlintrc.json` with `"no-var": "error"`, lint `var x = 1;`, assert no `eslint(no-var)`, assert the directory holds no `jx-lint-*` entry afterwards, then restore `TMPDIR`.
  - Update the header comment about the walk-up.
- New `tests/code-api-formatter-unavailable.test.ts`: `mock.module("oxfmt", …)` with a `format` that throws, then `await import("../src/code-api")`. Asserts:
  - `format` and `minify` resolve `null`.
  - `handleCodeApi` answers both with 501 `application/problem+json`, `type` ending `capability-unavailable`.
  - Lint still returns diagnostics.
  - The mock is called once across repeated calls (memoised probe).
- New `tests/code-api-format-rejects.test.ts`: `mock.module("oxfmt", …)` with a `format` that resolves for `probe.js` and rejects for anything else. `format` of `return 1;` returns `{ code: "return 1;", errors: [{ message }] }`, which covers `formatBody`'s `catch`. A mock is per file under `--isolate`, and the probe is memoised, so this cannot share a file with the one above.
- `tests/code-api-unavailable.test.ts`: rename to `resolveOxlintCommand`, and rewrite its header, which says the packaged app ships no oxlint. The empty-override branch still yields `{ diagnostics: [] }`.

`packages/desktop` (`cd packages/desktop && bun test --isolate --coverage`; lines 0.96, functions 0.90):

- `tests/handlers.test.ts`: the `codeService` block drops "returns null (not yet implemented)" and gains four cases:
  - `minify` of `const  a  =  1;` returns shorter code containing `a=1`.
  - `format` returns a tab-indented body.
  - `lint` of `debugger;` returns `eslint(no-debugger)`.
  - An unknown action resolves `null`, with `setProjectRoot(null)`.
- `tests/backend-bundle.test.ts` (existing): add the code-tool cases:
  - The `napiTriple` matrix: darwin/arm64, linux/x64, linux/arm64, win32/x64, and freebsd/x64, which returns `freebsd-x64` without throwing.
  - The exact `BACKEND_CODE_TOOLS("linux-x64-gnu")` map.
  - "no destination sits under node_modules", which witnesses the staging decision.
  - Every source for the host's triple exists on disk.
- New `tests/code-tools-bundle.test.ts`, the packaged-layout witness:
  - `Bun.build({ target: "bun", external: BACKEND_EXTERNALS })` bundles a temp entry into `<tmp>/backend/index.js`. The entry imports `runCodeService` and `resolveOxlintCommand` by absolute path to `packages/server/src/code-api.ts` and prints `{ format, lint, command }` as JSON.
  - The test stages `BACKEND_CODE_TOOLS()` into `<tmp>/backend/`, then runs `[process.execPath, "--no-install", index.js]` with an empty PATH and no `JX_OXLINT_BIN`.
  - It asserts formatted output, an `eslint(no-debugger)` diagnostic, and `command[1]` under `<tmp>/backend/oxlint/`.
  - A second case stages without the oxfmt row and asserts `format` is `null`. This holds because `--no-install` is set and the OS temp directory has no `node_modules` above it on CI.
  - Allow 30 s. It bundles oxfmt (about 10 MB of JS).
- `scripts/smoke-backend.ts` (`bun run smoke`) is the end-to-end witness on the real staged tree and has no unit test of its own beyond the existing `desktop-bundle` job; step 8's check is what fails a release lane that stages no binding.
- `hub-handlers.test.ts`, `chromium-index.test.ts`, `chromium-platform.test.ts` and `_rpc-parity.ts` stay as they are. They mock the session or the reply, and `codeService` was already registered and declared.

`packages/protocol` (`cd packages/protocol && bun test --isolate --coverage`): `routes.test.ts`'s invariants keep passing. There are no new cases, because the change is text.

`scripts` (`bun test --isolate scripts`), per the second Open decision: `scripts/desktop-build-lanes.test.ts` gains "a dispatchable lane attaches only with a tag". `bundle-desktop-macos.yml` declares `workflow_dispatch` (the half that fails today), and any workflow with `workflow_dispatch` and a `softprops/action-gh-release` step guards that step on `inputs.tag_name != ''`.

Coverage: no new `src/**` file, so `bun scripts/check-coverage-manifest.ts` sees nothing new in either workspace. `scripts/lib/backend-bundle.ts` loads in desktop's run and is held to its per-file gate, so both new functions must be covered. Ratchet `packages/server/bunfig.toml` only if this raises the workspace's worst file. The `bun.lock` change is in `affected.ts`'s GLOBAL list, so this pull request runs the whole matrix.

## Specs & docs

**`desktop.md` §5.3**, edited in place.

- Marker becomes:

  > **Status: Implemented.** One implementation, `runCodeService` in `packages/server/src/code-api.ts`: the dev server serves it over HTTP (`handleCodeApi`), and both desktop launchers answer the `codeService` request with it from the window's session (`packages/desktop/src/project-session.ts`), in their own Bun process (§7.1).

- Keep the table.
- In the paragraph after it, replace "(editors skip format-on-open/save and show no lint markers)" with ": the function editor opens a body as stored, shows no lint markers and writes the body back unminified (`studio.md` §6.4)".
- Append two paragraphs:
  - "**Format and minify stand or fall together.** The function editor formats a body when it opens and minifies it when it closes, so a host that minified without formatting would store bodies on one line and then show them on one line. A host whose formatter cannot load resolves `null` for both; over HTTP both answer `501` `capability-unavailable`, which the dev-server adapter reads as `null`. Lint degrades on its own, to no diagnostics."
  - "**The tools.** `oxfmt`'s native binding loads in-process. `oxlint` is a CLI script over a native binding, so it runs as a child of the host's own Bun (`process.execPath`) and no host needs `node`. It is given an empty configuration explicitly, in a private temporary directory, so every host lints with oxlint's default rules: without one, oxlint uses the nearest `.oxlintrc.json` above its working directory. The packaged app stages the platform's two bindings and oxlint's CLI beside its bundled backend (`backend/oxfmt.<triple>.node`, `backend/oxlint/`) from the one list in `packages/desktop/scripts/lib/backend-bundle.ts`, and the staged-backend smoke check (`bun run smoke`) fails a build that cannot format or lint with them (§7.4). The Nix build carries both packages in its `node_modules` (§9.3)."

**`desktop.md` §10.1**, a rider: in "It deliberately omits `pickDirectory`, the package install family, `gitClone`, `resolveClass` and `codeService`", replace the list's end with "… `gitClone` and `resolveClass`, and answers `codeService` with `null` (§5.3)". The adapter implements the required member as the stub.

**`studio.md` §6.4**, edited in place:

- Marker becomes:

  > **Status: Implemented.** `packages/studio/src/panels/editors.ts`, through `codeService` in `packages/studio/src/services/code-services.ts`. The dev server and both desktop launchers answer it from one implementation, `runCodeService` in `packages/server/src/code-api.ts` (`desktop.md` §5.3).

- Replace "Integrated with server code services:" with "Its code services come from the host (`desktop.md` §5.3):".
- The bullets become:
  - "**Format** — via `oxfmt`, when the editor opens a body"
  - "**Lint** — via `oxlint`, on open and as the author types, with diagnostic display"
  - "**Minify** — via `Bun.Transpiler`, when the editor closes and writes the body back"
- Append: "A host without server-side code tooling resolves `codeService` to `null`, and the editor degrades silently: it opens the body as stored, shows no lint markers, and writes the body back unminified. The cloud host (`packages/studio/src/platforms/cloud.ts`) is that host today (`desktop.md` §10.1)." Adjust this if the third Open decision goes the other way.

**`server.md` §5**, edited in place (the spec stays Implemented):

- After the remapping paragraph add: "A formatter whose native binding cannot load makes `format` and `minify` answer `501` `capability-unavailable` together, because the editor that minifies a body on close relies on formatting it on open (`desktop.md` §5.3). Without oxlint, `lint` answers `{ diagnostics: [] }`. `runCodeService` is the same dispatch without HTTP, and is what the desktop launchers call."
- The trailing marker becomes:

  > **Status: Implemented.** `src/code-api.ts`: oxfmt via its Node API, oxlint's CLI run under the server's own Bun with an explicit empty configuration (oxlint's default rules), minification via `Bun.Transpiler`.

**`server.md` riders**, in place:

- §4.3, the first of "Three places where a problem document would be wrong": after "not a failure of the request that asked for one." add "The one exception is a formatter that cannot load: `format` and `minify` then answer `501` `capability-unavailable`, because the backend lacks the capability (§5)."
- §7: "`oxfmt` and `oxlint` are resolved from the workspace for the code services." becomes "`oxfmt` and `oxlint` are dependencies, for the code services (§5): `oxfmt` is imported, and `oxlint`'s CLI runs under the server's own Bun."

**Fragments**:

- `bun run spec:change desktop.md minor -m "Both desktop launchers run format, lint and minify in their own Bun process from the dev server's implementation, and a host that cannot format withholds minify too"`
- `bun run spec:change studio.md minor -m "The code editor takes format, lint and minify from its host, and states how it degrades on a host without code services"`
- `bun run spec:change server.md minor -m "Code services declare oxfmt and oxlint, run oxlint under the server's own Bun with oxlint's default rules, and answer format and minify with 501 capability-unavailable when the formatter cannot load"`

**Docs** (no em dashes):

- `docs/extending/embedding/backend-protocol.md` (`spec: desktop.md#5`): under "Behaviors implementers must match", add a bullet. "**`code/format` and `code/minify`** stand or fall together. Studio formats a function body when its editor opens and minifies it when the editor closes, so a backend that minifies without formatting stores bodies that its authors then read on one line. A backend that cannot format answers both with `501` (`capability-unavailable`), which Studio reads as no service. `code/lint` may degrade on its own, to `{ "diagnostics": [] }`."
- `docs/extending/embedding/dev-server.md` (`spec: server.md#5`): extend the `code-api.ts` paragraph. "The same dispatch, `runCodeService`, answers the desktop launchers' `codeService` request in their own Bun process. oxlint runs under that Bun with an explicit empty configuration, so every host lints with oxlint's default rules rather than whichever `.oxlintrc.json` sits above its working directory." Add `packages/server/src/code-api.ts` to `code:`.
- `docs/studio/logic/code.md`: no prose change. Its "Formatting on open", "Live linting" and minified Close become true on the desktop. Add `spec: - studio.md#6.4` and `packages/server/src/code-api.ts` under `code:`, so the next change to either names the page.
- `docs/extending/embedding/platform-adapter.md` (`spec: desktop.md#5`): no change. Its "`codeService` resolves `null` on platforms without code tooling" still holds.
- `docs/extending/embedding.md`: no change. `docs:sync` names it (and `backend-protocol.md`, above) for `routes.ts`, whose route texts it does not quote.
- `docs/extending/reference/studio-routes.md` is generated and picks up step 3.
- `packages/server/README.md`: the two Dependencies rows (Implementation step 2).

**§7.4's trees**: if §7.4 has been redrawn by then (its marker Implemented), add `oxfmt.<triple>.node` and `oxlint/` under the packaged tree's `backend/`.

No spec graduates. desktop.md and studio.md both keep other open items. Landing deletes this file. No plan lists it in `requires`.

## Acceptance

- `cd packages/server && bun test --isolate --coverage`, `cd packages/desktop && bun test --isolate --coverage` and `cd packages/protocol && bun test --isolate --coverage` pass at their thresholds, and `bun scripts/check-coverage-manifest.ts` passes for each. `bun test --isolate scripts` passes.
- These gates pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose`. `bun run plans:status --spec desktop` does not list §5.3, and `--spec studio` does not list §6.4.
- `grep -n -A2 "function codeService" packages/desktop/src/project-session.ts` shows the `runCodeService` call, and `grep -rn "resolveOxlintBin\|__jx_lint_" packages` finds nothing.
- Packaged, on a developer machine: `bun run --cwd packages/desktop stage && bun run --cwd packages/desktop smoke` passes the code-tools check, and `build/resources/backend/oxfmt.<triple>.node` and `build/resources/backend/oxlint/dist/cli.js` exist. In the app (`bun run desktop:build -- --dir`, then the unpacked tree), open a function body holding `debugger;  let  x=1`:
  - It opens formatted.
  - `debugger` carries an oxlint marker.
  - On Close, the document's `body` is written minified.
- Nix: the package runs the backend from source with a full production `node_modules`, so there is nothing to stage: in `nix build`'s output, `result/lib/jx-studio/node_modules/oxlint/bin/oxlint` exists, and `./result/bin/jx-studio <project>` shows the same three behaviours. The `-gnu` bindings are prebuilt ELF that `package.nix` does not patch (they need `libgcc_s.so.1` besides glibc), so this check is the proof they load under the Nix Bun. If one does not, the derivation gains `autoPatchelfHook` over `node_modules/**/*.node`, and the same pull request adds one sentence to `desktop.md` §9.3's build-phase bullet: the derivation patches the native bindings it installs (§9.3 is Implemented, so no marker is left to flag a stale bullet).
- macOS (the second Open decision): one green `workflow_dispatch` run of `bundle-desktop-macos.yml` on the branch. It must sign, notarize, pass `bun run smoke` (including the code-tools check), and `codesign --verify --deep --strict` on the unpacked app, and its installed DMG shows the three behaviours above.
