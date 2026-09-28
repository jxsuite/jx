---
status: drafted
disposition: implement
claims:
  - extensions.md#6.1
  - extensions.md#8.1
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - packages/server
  - packages/desktop
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
size: M
---

# A build or server refuses a capability its declared timing omits, and the studio reaches every format capability through its backend

## Context

`specs/extensions.md` §6.1, line 243:

> **Status: Partial.** Steps 2 to 4 ship in `buildExtensionRegistry` (`packages/schema/src/extension-registry.ts`) and `FormatEntry` (`packages/schema/src/format-registry.ts`). Step 1 diverges: hosts resolve `<specifier>/jx-extension.json` through the package's exports map, the rule §9.2 states, and never locate a manifest through the `"jx"` field, which only the catalogue reads, as the §9.2 hint (`declaresJxField`, `packages/server/src/extension-catalog.ts`). Step 5 is not built: no host reads a capability's `timing` (§8.1).

`specs/extensions.md` §8.1, line 331:

> **Status: Partial.** `timing` is parsed with its default (`DEFAULT_TIMING`, `packages/schema/src/format-registry.ts`) and forwarded to the studio (`packages/server/src/studio-api.ts`), but no host acts on it: the compiler and server import the implementation whatever a capability declares, and the studio round-trips every call through `formatAction` (`packages/studio/src/format/format-host.ts`), including the `"client"` capabilities `Markdown` and `Csv` declare.

Both sections were unmarked before the census, and §6 carries no marker. §6.1 step 5 and §8.1 state one contract twice; step 1 shares the anchor. Re-verified on 2026-09-26.

**What ships**

- `CapabilityInfo.timing` (`packages/schema/src/format-registry.ts:106`), defaulted by `extractCapabilities` from the private `DEFAULT_TIMING = ["compiler", "server"]` (line 168), tested in `packages/schema/tests/format-registry.test.ts` ("capability timing defaults to compiler+server").
- One invocation point. Every node-side capability call goes through `FormatEntry.call` (line 234), which imports `$implementation` through the entry's injected `FormatHostIO` (line 139). The only production IO is `createNodeFormatIO` (`packages/compiler/src/site/format-host.ts:53`); `buildProjectExtensionRegistry` (line 132) wraps it for every registry a host builds: the build (`site-build.ts:305`, `schema-command.ts:42`, `validate-command.ts:220`, `db-push.ts:60` under `packages/compiler/src/site/`), the dev server (`studio-api.ts:128`, `resolve.ts:91`, `jx-mounts.ts:109`, `data-api.ts:127`, `live-preview.ts:206` through the deprecated `buildProjectFormatRegistry`, and `extension-catalog.ts:83` directly, under `packages/server/src/`), and the desktop session (`packages/desktop/src/project-session.ts:511`). `loadProjectSections` (`packages/compiler/src/site/project-sections.ts:31`) builds a second IO to hand `projectData` as `ctx.io`; no first-party extension reads it.
- The studio's path: `formatParse` / `formatSerialize` (`packages/studio/src/format/format-host.ts`) call the platform's `formatAction`: `POST /__studio/format` on the dev server (`packages/studio/src/platforms/devserver.ts`, route at `packages/server/src/studio-api.ts:1463`, which maps every failure to `internalError`), the cloud host's `/format` (`packages/studio/src/platforms/cloud.ts`), and RPC on desktop (`packages/desktop/src/platform.ts`, `packages/desktop/src/chromium/platform.ts`) to `formatAction` in `project-session.ts:694`. `listFormats` carries each capability's `timing` to the studio; nothing reads it there.
- Step 1 as built: `loadExtension` (`packages/schema/src/extension-registry.ts`) resolves `<specifier>/jx-extension.json` for a bare name and `<dir>/jx-extension.json` for a relative path. The `"jx"` field has two readers and locates nothing: `declaresJxField` (`packages/server/src/extension-catalog.ts:128`) turns a package that declares it without exporting the manifest into a catalogue `problem`, and `scripts/check-extension-catalog.ts:176` requires first-party packages to declare it (a packaging convention, not discovery; the census said it reads the field as a hint).

**What the census missed**

- Every first-party declaration already matches its callers, so enforcement changes no first-party behaviour: `mount` is `["server"]` (dev server only); `lower`, `emit` and `head` are `["compiler"]` (the site build, including one the dev server or desktop starts); everything else is `["compiler", "server"]`, and `Markdown.parse` / `serialize`, `Csv.parse` / `rewrite` add `"client"`.
- The environment is a role, not a process: `buildSite` runs inside the dev server (`packages/server/src/dev.ts:111`, `POST /__studio/build`) and the desktop (`project-session.ts:411`) and invokes compiler-only capabilities there.
- The generated site worker calls `mount` itself (`packages/compiler/src/targets/compile-server.ts:199`), outside `FormatEntry.call`; `buildMountSpecs` (`packages/compiler/src/site/site-build.ts:1568`) decides what it calls.
- §8.1 names `POST /__jx_resolve__` as a capability round trip. It is not: it proxies an instance `resolve()` under a state entry's `timing` (spec.md §11.3, server.md §3.2).
- Browser loading has no path. `$implementation` is a node-resolved source path (`./markdown.js` resolving to `extensions/parser/src/markdown.ts`), whose `discover` / `load` reach `node:fs` and `./md.ts` (static `node:fs` and `glob`) through dynamic imports. No host serves an implementation as a browser module, the desktop shell runs on `views://` while project files come from a loopback origin, and the cloud session loads configuration but not implementations (§5.5). `packages/schema/defs/class-def.schema.ts:141` describes `timing` as "Hosts outside the list round-trip through the dev server", regenerated into `packages/schema/class-schema.json`, `schema.json` and the 28 per-project `document.schema.json` files.
- Four docs pages assert behaviour that does not exist: `docs/extending/extensions/capabilities.md:83` ("which is why typing in Studio's Markdown editor never touches the network"), `tutorial-toml-format.md:120` ("lets Studio parse in-process"), `formats.md:124` (Studio round-trips only "when a capability's `timing` excludes the browser"), and `tutorial-toml-format.md:37` ("The `"jx"` field is how hosts find the manifest"). `classes.md:104-108` copies steps 1 and 5.

## Outcome

- extensions.md §6.1 → closed: marker deleted; step 1 rewritten to the exports-map rule (reconcile); step 5 rewritten to what hosts do, and built.
- extensions.md §8.1 → `Implemented` for node hosts (the environment each host names, refusal before import, the dev server's `capability-unavailable` answer, the site build's worker-mount check) and for the studio's delegation through its backend; the studio calling a `"client"` capability in-process → `Future` (first Open decision).
- extensions.md does not graduate: other plans hold its remaining items.

## Decisions

- **Open:** build the studio's in-process call for `"client"` capabilities now, or defer it. Recommendation: defer it to a `Future` remainder under §8.1, because nothing a user feels would change and the cost is high. The desktop app, the only end-user studio, reaches `parse` and `serialize` over IPC to its own Bun process, and the dev server over loopback, so there is no network cost to remove. Loading in the browser needs a browser build of each implementation that no host produces (see Context), a way to load it into the `views://` desktop shell, and it would run third-party extension code in the shell document that holds the platform (file writes, the AI proxy). The cloud, which serves no format route, cannot load implementations either. Signed the other way, §8.1 moves to a new L plan that requires this one (a browser-module route, a PAL member, desktop loading, a backend fallback), and this plan keeps §6.1.
- **Open:** what a build or server does when its environment is not listed: refuse or skip. Recommendation: refuse, by throwing before the import, because a skipped `parse` or `projectData` would silently drop a page or a section's data from a build, and the compiler has no dev server to delegate to. Each call site's existing failure policy then applies unchanged: a page error for `parse`, a collected build error for `emit` and `assets`, a warning for `head`, a failed build for `projectData`, `capability-unavailable` from the dev server's format route.
- **Decided:** the environment rides on `FormatHostIO` and `FormatEntry.call` checks it before `implementation()`, because every node invocation funnels through `call` and every registry already carries the IO it was built with, so one check covers every call site and extension code that calls another class through the registry in its context is held to the same rule.
- **Decided:** the environment names the role, not the process: `"compiler"` for the site build and the `jx` commands that build a registry (`build`, `validate`, `schema`, `db push`), wherever they run; `"server"` for the dev server, the desktop main process and the generated worker. Schema composition invokes no capability, so its registry names `"compiler"`, its module's own, inertly.
- **Decided:** `createNodeFormatIO`, `buildProjectExtensionRegistry` and `buildProjectFormatRegistry` take a required environment, because the typechecker then proves every host chose one; a default would let a forgotten server call site pass as the build. The price is about 30 mechanical test edits, and `undefined` for the optional config where a test passes none. The three are public exports of `@jxsuite/compiler/format-host` (4.0.1), so the commit carries a `BREAKING CHANGE:` footer and release-please majors the compiler. The refusal already requires that: a `jx build` that invoked a capability outside its `timing` now fails. A default parameter would therefore not avoid the major.
- **Decided:** the fragment is `major`, not the release table's `minor` for an implement, because §8.1 replaces "round-trips through the dev server" with a refusal. A third-party capability whose `timing` omits a build or server, which those hosts invoked until now, stops working. At 0.x that moves the minor.
- **Decided:** an IO that names no environment is not checked, because only test doubles construct one; `createNodeFormatIO` is the only production IO and requires it.
- **Decided:** the site build refuses to generate a worker mount whose `mount` capability declares a `timing` without `"server"`, as it refuses one without `server.module`, because the generated worker is the one host that calls a capability outside `FormatEntry.call`. The worker keeps calling `.mount` by name; that belongs to the §11 contract, not here.
- **Decided:** the studio does not filter formats or capabilities by `timing`, because its backend's refusal already names the class, the capability and the fix, and no descriptor declares a studio-used capability without `"server"`; filtering would touch every `capabilities.<role>` check in `packages/studio/src` for a case with no instance.
- **Decided:** §4 keeps "referenced by a `"jx"` field", because it describes what a package ships, which stays true, and §9.2 already says what reads the field; only §6.1 claimed the field locates the manifest.
- **Decided:** the `timing` description in `class-def.schema.ts` is rewritten, because editors show it to every extension author as the contract; the regenerated schemas are generator output (`bun run schema:sync`, one JSON Pointer), which is why seven workspaces appear above.
- **Decided:** no `requires` edge. `plan:_shared/formats-from-extensions` rewrites nearby lines in `studio-api.ts` (the unknown-format message), `project-session.ts` (messages and comments) and the same committed schemas, and leaves studio.md §8.1's `formatAction` sentence alone, which stays true here too; either can land first, and a schema conflict is resolved by re-running `bun run schema:sync`.

## Implementation

One pull request.

1. **`packages/schema/src/format-registry.ts`**
   - `FormatHostIO` gains `environment?: FormatTiming`, documented: "The environment this host invokes capabilities in (extensions.md §8.1). `FormatEntry.call` refuses a capability whose `timing` omits it. An IO naming none is not checked; only test doubles construct one."
   - New export `class CapabilityTimingError extends Error` with `readonly className: string`, `capability: ExtensionCapability`, `timing: readonly FormatTiming[]`, `environment: FormatTiming`, `name = "CapabilityTimingError"`, and the message `` `Format class "${className}": the "${capability}" capability declares timing [${timing.join(", ")}], so a ${environment} host cannot invoke it` ``.
   - `FormatEntry.call`: after the `cap` lookup and before `await this.implementation()`, `const env = this.#io.environment; if (env !== undefined && !cap.timing.includes(env)) throw new CapabilityTimingError(this.name, capability, cap.timing, env);`.
   - `CapabilityInfo.timing` doc: "Environments allowed to call directly (extensions.md §8.1); `FormatEntry.call` enforces it against the IO's environment."
2. **`packages/schema/src/extension-registry.ts`**: `ExtensionRegistry`'s constructor takes `(extensions, environment: FormatTiming | null = null)` and exposes `get environment()`; `buildExtensionRegistry` passes `io.environment ?? null`. Re-export `CapabilityTimingError` and the `FormatTiming` type beside the existing re-exports.
3. **`packages/schema/defs/class-def.schema.ts:141-146`**, `classMethodDefSchema.properties.timing.description`: "Execution environments allowed to call this capability directly: compiler (a build or jx command), server (the dev server, the desktop app, a site worker), client (a browser). A build or server outside the list refuses the call; Studio calls through its backend." Then `bun run schema:sync`, which moves `/$defs/ClassMethodDef/properties/timing/description` in `class-schema.json` and `schema.json` and `/$defs/v1/$defs/ClassMethodDef/properties/timing/description` in the 28 `document.schema.json` files.
4. **`packages/compiler/src/site/format-host.ts`**: `export type NodeHostEnvironment = Exclude<FormatTiming, "client">`; `createNodeFormatIO(projectRoot, environment: NodeHostEnvironment)` returns the IO with `environment`; `buildProjectExtensionRegistry(projectRoot, projectConfig: ProjectConfig | undefined, environment: NodeHostEnvironment)` and `buildProjectFormatRegistry` with the same third parameter, passed through. Module header: one sentence saying the IO names the host's environment.
5. **`packages/compiler/src/site/project-sections.ts:31`**: `createNodeFormatIO(projectRoot, registry.environment === "server" ? "server" : "compiler")`, so `ctx.io` names the registry's environment.
6. **Compiler callers pass `"compiler"`**: `site-build.ts:305`, `schema-command.ts:42`, `validate-command.ts:220`, `db-push.ts:60`. Plans that land first may have added builder calls of their own, and the typecheck finds each one: `plan:extensions/local-imports-precedence`'s `createNodeFormatIO` in `prototype-resolver.ts` and `plan:extensions/declared-media-type-responses`' `buildProjectExtensionRegistry` in `preview-server.ts` pass `"compiler"` (neither invokes a capability), and `plan:extensions/connector-table-paths`' `connector-mounts.test.ts` fixtures pass `"compiler"`.
7. **`buildMountSpecs`** (`site-build.ts`, inside the `activeMounts.map` at line 1586, after the `server.module` check): `const timing = entry.capabilities.mount?.timing; if (timing && !timing.includes("server")) throw new Error(`` `Extension class "${entry.name}": its mount capability declares timing [${timing.join(", ")}], but a site worker invokes mount as a server host` ``)`.
8. **Server callers pass `"server"`**: `studio-api.ts:128`, `resolve.ts:91`, `jx-mounts.ts:109`, `data-api.ts:127`, `live-preview.ts:206` (`buildProjectFormatRegistry(projectRoot, config, "server")`), `extension-catalog.ts:85` (`createNodeFormatIO(projectRoot, "server")`).
9. **`packages/server/src/studio-api.ts`, `POST /__studio/format`**: the route comment (lines 1461-1462) becomes "Format capability proxy: the studio's only path to a format capability, invoked here as a server host (extensions.md §8.1)." In the catch, ahead of `internalError`: `if (error instanceof CapabilityTimingError) return problem("capabilityUnavailable", error.message);` (501), importing `CapabilityTimingError` from `@jxsuite/schema/format-registry`.
10. **`packages/desktop/src/project-session.ts:511`**: `buildProjectExtensionRegistry(root, projectConfig, "server")`. `formatAction` already re-throws an `Error`, so the refusal reaches the studio with its message.

**Integration contract.** Once this lands: `@jxsuite/schema/format-registry` exports `CapabilityTimingError` (fields `className`, `capability`, `timing`, `environment`) and `FormatHostIO.environment`; `ExtensionRegistry.environment` is the environment it was built for, or `null`. `@jxsuite/compiler/format-host` exports `NodeHostEnvironment`, and its three builders require an environment. A registry refuses, before importing, any capability whose `timing` omits its environment; the build names `"compiler"`, the dev server and the desktop session `"server"`. The dev server's format route answers a refusal as `capability-unavailable` (501). The studio calls every format capability through `formatAction`. extensions.md §6.1 and §8.1 state these rules, and §8.1's `Future` remainder is where an in-process studio path would be specified.

## Tests

Run `bun test --isolate --coverage` from `packages/schema`, `packages/compiler`, `packages/server` and `packages/desktop`; `packages/studio`, `packages/ui`, `packages/starters` and `examples` must stay green over their regenerated schemas.

- **`packages/schema/tests/format-registry.test.ts`**, new `describe("FormatEntry.call timing")`, each with an in-memory IO:
  - `invokes a capability whose timing lists the IO's environment`: environment `"server"`, default timing, returns the implementation's value.
  - `refuses a capability whose timing omits the environment, before importing`: `timing: ["client"]`, environment `"compiler"`, `importModule` a `mock()`; rejects with a `CapabilityTimingError` whose four fields match and whose message contains `"parse"` and `[client]`; `importModule` was never called.
  - `the default timing refuses a client host`: no `timing`, environment `"client"`, rejects.
  - `an IO that names no environment is not checked`: `timing: ["client"]`, no environment, resolves.
- **`packages/schema/tests/extension-registry.test.ts`**: `a registry carries its IO's environment` (`"server"` in, `"server"` out; none in, `null` out).
- **`packages/compiler/tests/format-host.test.ts`**: `createNodeFormatIO names the host environment` and `buildProjectExtensionRegistry builds for the named environment` (`registry.environment`). Existing calls there and in `pages-discovery`, `project-sections`, `connector-mounts`, `compile-element`, `content-types` and `compiler` tests gain `"compiler"`.
- **`packages/compiler/tests/project-sections.test.ts`**, a second fixture directory with a local extension whose `projectData` declares `["server"]` and returns `ctx.io.environment`: `a compiler registry refuses a server-only projectData` (rejects with `CapabilityTimingError`) and `a server registry loads it with an io for the same environment` (the section is `"server"`). A separate directory, because a refusal aborts `loadProjectSections` and would break the existing cases.
- **`packages/compiler/tests/connector-mounts.test.ts`**, beside "a server-mount class declaring no server.module is a clear build error": `a server-mount class whose mount timing omits server is a clear build error` (a class with `server.module` and `mount` declaring `["compiler"]`; `await expect(buildSite(dir, {})).rejects.toThrow(/its mount capability declares timing \[compiler\]/)`, awaited, unlike its neighbour, so the `finally` cannot remove the fixture mid-build).
- **`packages/server/tests/studio-api.test.ts`**, a fixture project with a local extension: `ClientOnly` claims `.cli` with `parse` declaring `["client"]` and an `$implementation` that does not exist; `ServerOnly` claims `.srv` with `parse` declaring `["server"]`. `POST /__studio/format refuses a capability whose timing omits server` expects 501, a `capability-unavailable` type and a detail naming `"parse"` and `[client]` (501 rather than 500 proves the check ran before the import); `POST /__studio/format invokes a server-only capability` expects 200, proving the route's registry is a server host.
- **`packages/server/tests/resolve-gaps.test.ts`**: `a server-only assets capability contributes mounts`: a local extension owning a non-empty section whose `assets` declares `["server"]` and returns one mount; `projectAssetMounts(root)` includes it (under `"compiler"` the refusal would be swallowed and the list empty). `jx-mounts.test.ts` needs no case: its `mount-ext` fixture and the first-party `mount` both declare `["server"]`, so its existing cases already fail under the wrong environment. Every builder call in `refactor-apply.test.ts` (seven `buildProjectFormatRegistry`, one `createNodeFormatIO`), `refactor-find-refs.test.ts` (two) and `refactor-parity.test.ts` (one) gains `"server"` as its last argument, with `undefined` for a config it does not pass.
- **`packages/desktop/tests/handlers-gaps.test.ts`**: `formatAction builds its registry as a server host`: after a `formatAction` call, `mockBuildRegistry.mock.calls.at(-1)?.[2]` is `"server"`. `mockBuildRegistry`'s signature widens to `(_root: string, _config: unknown, _environment?: string)`, because the desktop typecheck includes `tests/**` and index `2` of a two-element parameter tuple does not compile.
- Not guarded by a case: the environment `data-api.ts`, `live-preview.ts` and `extension-catalog.ts` pass. Every first-party capability they invoke lists both node environments, and the catalogue invokes none, so a wrong choice there is caught by review of three one-line edits, not by a suite.

Coverage: no source file is added; every new line and function (`CapabilityTimingError`, the check, the `environment` getter, the ternary's two arms, the mount check, the 501 branch) is exercised by a case above, so per-file figures hold (schema 0.99 / 0.99, compiler 0.982 / 0.98, server 0.96 / 0.95, desktop 0.96 / 0.90). Ratchet a workspace's `coverageThreshold` only if its worst file rises. Both typechecks (`bun run typecheck`, `bun run --cwd packages/desktop typecheck`) prove every builder call names an environment.

## Specs & docs

**extensions.md §6.1**, in place: delete the line-243 marker (the section was unmarked before the census and §6 carries none). Replace step 1 with:

> 1. Resolve each `extensions` entry to its manifest: a bare package name resolves `<name>/jx-extension.json` through the package's `exports` map, project-first (§3); a relative path names the directory holding `jx-extension.json`. Read each `.class.json` the manifest lists. The `package.json` `"jx"` field locates nothing; the catalogue reads it only as the hint §9.2 describes.

Replace step 5 with:

> 5. Respect `timing` (§8.1) before step 4: invoke a capability directly only when the host's own environment is listed. The studio sends the call to its backend; a build or server refuses it, naming the class, the capability, the declared `timing` and its own environment.

Append to the paragraph after the list: "The injected I/O names the host's environment, and `FormatEntry.call` applies step 5 before importing anything."

**extensions.md §8.1**, in place, in the spec.md §6.6 shape (a leading `Implemented` marker, the body, then a `Future` marker):

- The line-331 marker becomes:

  > **Status: Implemented.** Node hosts check a capability's `timing` before importing its implementation (`FormatEntry.call`, `packages/schema/src/format-registry.ts`); the build names `"compiler"`, and the dev server and the desktop session name `"server"` (`createNodeFormatIO`, `packages/compiler/src/site/format-host.ts`).

- Keep the intro sentence and the "Values" bullet. Replace the other two bullets with:

  > - **Environments.** `"compiler"` is the site build and every `jx` command that builds a registry (`build`, `validate`, `schema`, `db push`), wherever it runs, a build the studio starts included. `"server"` is the dev server, the desktop app's main process and the generated site worker. `"client"` is a browser.
  > - A host invokes a capability directly only when its environment is listed. A build or server that is not listed refuses the call with an error naming the class, the capability, the declared `timing` and its own environment: it has no host to delegate to. The site build likewise refuses to generate a worker mount whose `mount` capability omits `"server"`.
  > - The studio invokes format capabilities through its backend (`formatAction`: `POST /__studio/format` on the dev server, RPC on desktop), which calls them as a `"server"` host, so a capability the studio uses lists `"server"`. The dev server answers a refusal as `capability-unavailable` (501).
  > - Browser-safe capabilities (no `fs`/`glob`/node imports on their code path) should declare `"client"`, which records that a browser host may call them in-process.

- After the list, a separate blockquote:

  > **Status: Future.** The studio calling a `"client"` capability in-process, loading the implementation in the browser with its backend as the fallback. No host serves an extension's implementation as a browser module (`$implementation` is a node-resolved source path), so the studio calls every format capability through `formatAction`.

`POST /__jx_resolve__` leaves the section: it proxies an instance `resolve()` under a state entry's `timing` (spec.md §11.3), not a capability. §4, studio.md §8.1 and server.md §3.2 and §4.1 are unchanged and stay true.

Fragment (`major`, see Decisions): `bun run spec:change extensions.md major -m "§6.1 and §8.1: a host finds a manifest through the exports map and checks a capability's timing before importing it; a build or server refuses a capability its environment is not listed for, the studio reaches every format capability through its backend, and an in-process client call is Future."`

**Docs** (no em dashes):

- `docs/extending/extensions/capabilities.md` (`spec:` `extensions.md#8.1`), `## timing`: keep the first bullet; replace the rest with: "`"compiler"` is a site build or a `jx` command such as `jx validate` or `jx db push`, including a build Studio starts. `"server"` is the dev server, the desktop app, and a deployed site worker. `"client"` is a browser." / "A host calls a capability only when its environment is listed. A build or server that is not listed refuses the call with an error naming the class, the capability and the declared `timing`; there is nothing for it to delegate to." / "Studio never imports extension code. It runs every format capability through its backend (the dev server's `POST /__studio/format`, or the desktop app over RPC), which calls it as a server, so a capability Studio uses keeps `"server"` in its list." / "Declare `"client"` on capabilities that are browser-safe (no `fs`, `glob`, or node imports anywhere on their code path): it records that a browser may run them. `Markdown.parse` declares all three; `Markdown.discover` reads the filesystem, so it stays `["compiler", "server"]`." The tip's last clause becomes "and keep the default on the ones that touch the filesystem."
- `docs/extending/extensions/classes.md` (`spec:` `extensions.md#6.1`), "How hosts introspect": step 1 becomes "Resolve each `extensions` entry to its manifest: a package name resolves `<name>/jx-extension.json` through the package's `exports` map, from the project's `node_modules` first; a relative path names the directory holding `jx-extension.json`. Read each `.class.json` the manifest lists." Step 5 becomes "Respect `timing` before step 4: call a capability only when the host's environment is listed. Studio sends the call to its backend; a build or server refuses it."
- `docs/extending/extensions/formats.md` (`code:` `format-registry.ts`), the "Studio editing" bullet's second sentence becomes "Studio runs both through its backend, the dev server's `POST /__studio/format` endpoint or the desktop app over RPC, which calls them as a server host, so a format whose `timing` leaves out `"server"` cannot be opened in Studio ([Studio routes](/docs/extending/reference/studio-routes))."
- `docs/extending/extensions/tutorial-toml-format.md`: line 37 becomes "Hosts find the manifest through the `./jx-extension.json` entry in `exports`, so that entry is required once the package is consumed from `node_modules`. The `"jx"` field is a hint: the extension catalogue reads it to report a package that declares `"jx"` but forgets the export." Line 120 becomes "`timing` includes `"client"` because TOML parsing needs no filesystem, which records that a browser may run it. Studio still parses through its backend, so `"server"` stays in the list."
- `docs/extending/extensions/anatomy.md` (`code:` `extension-registry.ts`), line 46's first clause becomes "`package.json` exports the manifest at `./jx-extension.json` (its `"jx"` field names it too, as a hint the extension catalogue reads)".
- `docs/extending/extensions/server.md`, line 38: after "with `timing: ["server"]`" add ", and the build refuses to generate a site worker mount whose `timing` leaves `"server"` out".
- Named by `bun run docs:sync`, checked, no change: `docs/extending/embedding/dev-server.md` (its line 39 belongs to `plan:_shared/formats-from-extensions`), `docs/framework/build/dev-server.md`, `docs/framework/build.md`, `docs/framework/build/cli.md`, `docs/framework/site/deployment.md`, `docs/framework/site/seo.md`, `docs/framework/site/redirects.md`, `docs/framework/concepts/color-schemes.md`, `docs/studio/data/grid.md`, `docs/studio/data/connections.md`, `docs/extending/extensions/schema-composition.md`, `docs/framework/agents.md`, `docs/framework/agents/authoring-rules.md`, `docs/framework/agents/machine-readable.md` (`schema.json`), `docs/framework/concepts/accessibility.md`, `docs/extending/extensions/first-party.md` (the `@docs` tag in `extension-catalog.ts`). `docs/extending/extensions/connectors.md:54` ("browser hosts round-trip through the dev server") stays true of the data grid.

No spec graduates. Landing deletes this file; no other plan requires it, but eight cite it, so the same pull request rewords every `plan:extensions/capability-timing-dispatch` citation left in a plan that still exists, or `plans:check` reports `citation-unknown`. Today those are `plans/_shared/formats-from-extensions.md`, `plans/_shared/db-push-section-owners.md`, `plans/extensions/connector-table-paths.md`, `plans/extensions/declared-media-type-responses.md`, `plans/extensions/local-imports-precedence.md`, `plans/extensions/server-module-required.md`, `plans/extensions/settings-section-vocabulary.md` and `plans/schema/parse-boundary-readers.md`, plus this directory's README. Their "if it lands first" notes become plain steps: pass `"compiler"` or `"server"` as each says.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/schema`, `packages/compiler`, `packages/server`, `packages/desktop`, `packages/studio`, `packages/ui`, `packages/starters` and `examples`, with `bun scripts/check-coverage-manifest.ts <workspace>` green for each.
- `bun run typecheck` and `bun run --cwd packages/desktop typecheck` are green.
- `bun run schema:verify` is green, and `git grep -n "round-trip through the dev server" -- '*.json' '*.ts'` prints nothing.
- `git grep -n -e "never touches the network" -e "parse in-process" -e "how hosts find the manifest" -e "delegate to the dev server" -- docs specs` prints nothing.
- In a scratch project enabling a local extension whose `.cli` format declares `documentKinds: ["page"]` and `parse` with `"timing": ["client"]`, and a `pages/a.cli`: `jx build` reports `Format class "…": the "parse" capability declares timing [client], so a compiler host cannot invoke it`; in the dev-server Studio, opening `a.cli` shows the same sentence with `server`. Changing the declaration to `["compiler", "server", "client"]` makes both work.
- `bun run plans:status --spec extensions` no longer lists `extensions.md#6.1` or `extensions.md#8.1`.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run docs:markdown` are green.
