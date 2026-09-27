---
status: drafted
disposition: reconcile
claims:
  - extensions.md#11
requires: []
workspaces:
  - packages/compiler
  - packages/schema
  - examples
  - packages/starters
  - packages/studio
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
  - specs
  - docs
size: S
---

# A deployable build requires the server block's `module`, the spec says so with no fallback, and the build refuses before it touches `dist/`

## Context

`specs/extensions.md` §11, line 527 (unmarked before the census):

> **Status: Partial.** The block ships as specified except `module`'s fallback: the site build throws when `server.module` is absent (`buildMountSpecs`, `packages/compiler/src/site/site-build.ts`) rather than falling back to `$implementation`, which only the dev server dispatches through.

The row at line 539 reads "Bare specifier the generated worker imports (robust under bundlers); falls back to `$implementation`." Re-verified against 84735a9f:

- **The fallback never shipped.** `buildMountSpecs` has thrown `Extension class "<name>": server.module (a bare import specifier) is required to generate a deployable worker` since mounts were first generated (3085ab4d). The worker emits `import { <title> } from '<module>'` (`buildMountBlock`, `packages/compiler/src/targets/compile-server.ts`), so the module must export the class under its `title`.
- **The dev server's mount runtime never reads `module`.** `buildRuntime` (`packages/server/src/jx-mounts.ts`) calls `entry.call("mount", …)`, which imports `$implementation` relative to the `.class.json` (`FormatEntry.implementation`, `packages/schema/src/format-registry.ts`; extensions.md §6.1 step 4). The `Echo` fixture in `packages/server/tests/jx-mounts.test.ts` declares no `module` and dispatches.
- **But `jx dev` runs the site build first.** `jx dev` spawns `@jxsuite/server/dev`, whose `startDev` (`packages/server/src/dev.ts`) awaits `buildSite` before it serves a site project, and a throw rejects `startDev`. So a project with an active mount that lacks `module` fails `jx dev` at startup today, on the same error `jx build` gives (with `build.adapter` unset, the static-adapter error at step 1c fires first on both). A missing `module` has never been a dev-only success.
- **The census's reason is stale.** The stub leaned on §12's "Workers cannot import filesystem paths". The worker no longer imports anything at runtime: the site build bundles it self-contained (`bundleWorkerSource`, `packages/compiler/src/site/bundler.ts`; compiler.md §12) with `resolveDir: projectRoot`, so a fallback path could be inlined. Keeping the requirement is a choice, argued in Decisions.
- **"Bare" is not enforced.** Any non-empty string passes, and it resolves from the project root. A local extension (§3 allows `"./my-local-ext"`) has no package name, so a project-relative path is its only way to deploy a mount.
- **The error arrives late.** The call sits in step 6c, outside that step's `try`, after `dist/` has been cleaned (step 2) and every page and image written. The build rejects and leaves a `dist/` with pages and no worker. The static-adapter error for the same mounts already fires at step 1c, before the clean.
- **The class schema makes no fallback claim.** `serverBlockDefSchema.properties.module.description` (`packages/schema/defs/class-def.schema.ts`) reads "Module specifier exporting the mount handler." It names the wrong export (the module exports the mount class, whose static `mount` returns the handler) and does not say a deployable build needs it. The generator copies it into `packages/schema/class-schema.json`, `schema.json` and 28 tracked `document.schema.json` files.
- **The docs repeat the fallback, and the tutorial hits it.** `docs/extending/extensions/server.md` line 32 says `module` "falls back to `$implementation`". `docs/extending/extensions/tutorial-guestbook.md` line 60 declares `"server": { "basePath": "/_jx/guestbook", "order": 30 }` with no `module`, then promises "You should now see `jx dev` answering under `/_jx/guestbook`", and that extension's `jx dev` and `jx build` both throw. extensions.md §15 step 3 describes the same block without the key.
- Everything else in §11 holds, as the census found: `basePath` under `/_jx/` with conflicts as registry errors (`packages/schema/src/extension-registry.ts`), ascending `order` defaulting to 100, one shared `ctx`, the `app.all('<basePath>/*')` wrappers, static `mount` on `Auth` and `Data`, fail-closed without `ctx.auth` (`extensions/connector/src/worker.ts`), and the `/_jx/data` wire contract.

## Outcome

- extensions.md §11 → Implemented. The `module` row says what ships: an import specifier, resolved from the project root, that the site build requires, with no fallback. The dev server's mount runtime's use of `$implementation` is stated, and so is the fact that `jx dev` runs the same build first. The build checks it before it writes anything.
- Not a paper plan: the disposition is `reconcile` because the requirement stays, but the preflight move and the error text are code, so it lands with tests rather than in the detailing pull request.
- extensions.md stays Partial (§3, §5.4, §6.1, §7, §8, §8.1, §8.4, §8.6, §9, §9.1, §9.2, §10, §11.1 and §12 remain open), so nothing graduates.

## Decisions

- **Open:** keep `module` required (reconcile), or build the `$implementation` fallback the row promises (implement)? Recommendation: keep it required, because:
  - `module` resolves through the package's `exports` map under the adapter's resolution conditions (`workerBundleOptions`), which is how a package says what a Worker runs. `$implementation` names the file the dev server's Bun process imports, relative to the descriptor. A silent fallback would ship that file into a Worker without the author saying it can run there, and a Bun-only import would surface as a bundler error far from its cause.
  - §12's `connector.module`, the worker's other import key, is required with no fallback, and one rule for both keys keeps §11 and §12 aligned.
  - Every shipped mount declares it (`Auth.class.json`, `Data.class.json`), and the failure is loud and names the class.

  The cost of the recommendation: because `jx dev` runs the site build before it serves, the choice also decides whether `jx dev` starts for a local extension whose mount has no `module`. Today it does not, and under the recommendation it still does not, now with an error that says what to add.

  If maintainers choose the fallback, the disposition becomes `implement`. `buildMountSpecs` would substitute `resolve(dirname(entry.classPath), classDef.$implementation)` when `module` is absent, the no-module test would flip to assert a bundled worker, and the row would keep its fallback with the resolution base stated.

- **Decided:** the registry does not check `module`, because `buildExtensionRegistry` serves every host (the dev server, the desktop session, `jx schema`, the studio's format routes) and none of them reads the key. The dev server's mount runtime runs such a mount correctly. A registry throw there becomes "no mounts at all": `getRuntime` in `jx-mounts.ts` turns it into a warning and a null runtime. And a mount whose section is empty never reaches the worker, so the registry cannot know whether the key will be needed.
- **Decided:** the site build checks at preflight. `buildMountSpecs` moves from step 6c to step 1c, directly after the static-adapter error, and step 6c reuses its result. This follows the step 1c precedent and leaves a previous `dist/` intact. `buildMountSpecs` is pure over the registry and `projectConfig`, and nothing between the two steps writes to `projectConfig`, so the specs are identical. The `connector.module` check in the same function moves with it. That changes when §12's error fires, not its contract.
- **Decided:** the row and the error name the resolution base instead of requiring "bare", because the build resolves `module` from the project root and a local extension has no package name to give. The example stays a package export. §12's "Bare import specifier" wording and the connector error's text are left to that row's owner (`plan:extensions/connector-serve-key` leaves them as written).
- **Decided:** rewrite the class schema's `module` description, because the schema is where an author meets the key while writing a descriptor. The regenerated artifacts are mechanical (`bun run schema:sync`), and `schemas.yml` would push the same bytes.

## Implementation

1. **`packages/compiler/src/site/site-build.ts`, step 1c.** After the static-adapter `throw` and before `// ── 2. Clean output directory`, add:

   ```ts
   // The worker's imports, resolved here rather than at step 6c so a mount or connector with no
   // import specifier (specs/extensions.md §11, §12) fails before dist/ is cleaned. Mount options
   // inline the project's section manifest: identifiers only, never secrets (§13).
   const workerImports = buildMountSpecs(activeMounts, registry, projectConfig);
   ```

2. **Step 6c.** Replace the "Extension server mounts: static imports…" comment and the call (lines 856 to 858) with `const { mounts, connectors } = workerImports;`. Nothing else in 6c changes.
3. **`buildMountSpecs`.**
   - Compute `const className = (entry.classDef.title as string | undefined) ?? entry.name;` before the check, and use it in the returned spec.
   - The server error becomes: `` `Extension class "${entry.name}" mounts ${server.basePath} but declares no server.module, the import specifier (resolved from the project root) a deployable worker imports "${className}" from. The dev server's $implementation is not used for a build.` ``.
   - The JSDoc gains: "Runs at step 1c of `buildSite`, before `dist/` is cleaned, so a missing import specifier leaves the previous build in place. Specifiers resolve from the project root when the worker is bundled (`bundleWorkerSource`)." It drops "(bare specifier — Workers cannot import filesystem paths)".
   - The connector branch is unchanged.
4. **`packages/schema/defs/class-def.schema.ts`, `serverBlockDefSchema.properties.module.description`.** New text: `"Import specifier the generated site worker imports this class from, by its title, resolved from the project root (e.g. @jxsuite/auth/worker). Required for a deployable build; the dev server imports $implementation instead."`. Then run `bun run schema:sync`. It moves one pointer per file: `/$defs/ServerBlockDef/properties/module/description` in `packages/schema/class-schema.json` and `schema.json`, and `/$defs/v1/$defs/ServerBlockDef/properties/module/description` in the 28 `document.schema.json` files under `examples/`, `packages/starters/sites/*`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures/*`, `sites/jxsuite.com` and `sites/test-blank`.
5. **`packages/schema/src/format-registry.ts`, `ServerBlock.module`.** Add the doc comment `/** Import specifier the generated site worker imports the class from (extensions.md §11). The dev server never reads it. */`.
6. **Tests, spec and docs** as below.

**Integration contract.** No plan requires this one. Once it lands:

- `buildSite` calls `buildMountSpecs` at step 1c. Any refusal added inside it fires before `dist/` is cleaned. That includes the `mount` timing check `plan:extensions/capability-timing-dispatch` inserts after the `server.module` check.
- extensions.md §11's `module` row states the requirement, the resolution base and the dev server's `$implementation` path. A plan that changes how the worker imports a mount edits that row.
- Merge adjacency only, with no ordering: `plan:extensions/empty-section-gating` rewrites the `activeMounts` filter and `plan:_shared/no-adapter-server-tier` rewords the static-adapter error, both just above the new call. `plan:extensions/connector-serve-key` regenerates the same schema artifacts at a different pointer. Whichever lands second rebases.

## Tests

`packages/compiler` (`bun test --isolate --coverage` from `packages/compiler`), `tests/connector-mounts.test.ts`, in `describe("buildSite with the connector extension")`:

- `a server-mount class declaring no server.module is a clear build error` is renamed `a server-mount class declaring no server.module fails the build before dist/ is touched`. Before the build, write `dist/keep.txt`. Then `await expect(buildSite(dir, {})).rejects.toThrow(/Extension class "NoModule" mounts \/_jx\/x but declares no server\.module/)`. `existsSync(resolve(dir, "dist/keep.txt"))` is `true`, and `dist/index.html` does not exist. The `await` is new: without it, the `finally` removes the fixture while the build is still running.
- `a connector class declaring no connector.module is a clear build error` gains the same `dist/keep.txt` survival check, and its assertion is `await`ed.
- New `a local extension's project-relative server.module is bundled into the worker`. The fixture is `ext/jx-extension.json` (`classes: { Hello: "./Hello.class.json" }`). `ext/Hello.class.json` has `title: "Hello"`, `$implementation: "./hello.js"`, `server: { basePath: "/_jx/hello", module: "./ext/hello.js" }`, and a static `mount` method with `role: "mount"` and `timing: ["server"]`. `ext/hello.js` exports `Hello = { mount() { return async () => new Response("jx-hello-marker"); } }`. `project.json` sets `build: { adapter: "cloudflare-workers", outDir: "./dist" }` and `extensions: ["./ext"]`, and `pages/index.json` is `{ tagName: "main" }` (`discoverPages` throws without a `pages/` directory). The build resolves with `errors` equal to `[]`, and `dist/worker.js` contains `/_jx/hello/*` and `jx-hello-marker`. This is the evidence for the row's "project-relative path for a local one". The timeout is `30_000`, like the neighbouring bundling test.

`packages/server` does not change. The `Echo` fixture in `tests/jx-mounts.test.ts` already proves the dev server needs no `module`. `packages/schema` gains no case: the edit is a `const` literal and a doc comment, and `schema:verify` pins the regenerated artifacts.

**Coverage.** No source file is added, so the manifest check (`bun scripts/check-coverage-manifest.ts packages/compiler`) is unaffected. `site-build.ts` moves one call and rewords one string, and both of its branches stay covered by the tests above. The per-file thresholds hold: `lines = 0.982, functions = 0.98` in `packages/compiler/bunfig.toml`, and `0.99`/`0.99` in `packages/schema/bunfig.toml`. Ratchet only if the worst file rises. Because `packages/schema` reaches most workspaces in `scripts/ci/affected.ts`, the pull request runs the full matrix, and the regenerated `document.schema.json` files change one description no suite reads.

## Specs & docs

**`specs/extensions.md`**, in place:

- **§11 marker (line 527).** It becomes `> **Status: Implemented.**`, the bare form §8.5 and §13.1 use.
- **§11 `module` row (line 539).** It becomes: "Import specifier the generated worker imports the mount class from, by its `title` (`import { Auth } from "@jxsuite/auth/worker"`). It resolves from the project root, as the project's own imports do: a package export for a published extension, a project-relative path for a local one (§3). A deployable build requires it and has no fallback, because the worker's imports are the package's to declare. The site build, which `jx build` runs and `jx dev` runs before it serves, fails before it writes any output when a mount it activates has none. The dev server's mount runtime does not read it: it invokes `mount` through `$implementation`, as it invokes every capability (§6.1)." The formatter re-pads the table.
- **§15 step 3 (line 754).** "a `server` block (`/_jx/guestbook`, order 30)" becomes "a `server` block (`/_jx/guestbook`, order 30, module `@acme/jx-guestbook/worker`)".
- **Fragment.** Single quotes are required, because `$implementation` must not expand: `bun run spec:change extensions.md minor -m '§11: a deployable build requires server.module, the import specifier the site worker imports the mount class from, resolved from the project root; nothing falls back to $implementation, which only the dev server's mount runtime reads, and the site build fails before writing any output when an active mount omits it'`. The level is minor, a reconcile that no author could have relied on, since no build ever honoured the fallback.

**Docs** (no em dashes). `bun run docs:sync` names the pages whose `code:` lists `site-build.ts`, `format-registry.ts` (`docs/extending/extensions/formats.md`) or the regenerated core artifacts (`docs/framework/agents.md`, `agents/machine-readable.md`, `agents/authoring-rules.md`), and the pages whose `spec:` cites `extensions.md#11`. Those needing an edit are below.

- **`docs/extending/extensions/server.md`, the `module` row (line 32).** It becomes: "The import specifier the generated worker imports your class from, by its `title`, resolved from the project root: a package export such as `@jxsuite/auth/worker`, or a project-relative path for a local extension. The site build requires it and stops before writing `dist/` without it, and `jx dev` runs that build before it serves, so a missing one stops `jx dev` too, even though the dev server itself runs your class through `$implementation`." Its `code:` does not gain `site-build.ts`, because that file changes in most build pull requests and would flag the page every time.
- **`docs/extending/extensions/tutorial-guestbook.md`, step 3.**
  - The block (line 60) becomes `"server": { "basePath": "/_jx/guestbook", "order": 30, "module": "@acme/jx-guestbook/worker" }`.
  - A paragraph goes directly after it: "`module` is the package export the deployed worker imports `Guestbook` from, so list `./worker` in your `package.json` `exports`, pointing at the same file as the class's `$implementation`. The dev server runs the class through `$implementation`, but `jx dev` builds the site before it serves, and that build stops without `module`, as `jx build` does."
- **No change.**
  - `docs/extending/extensions/security.md` and `docs/framework/concepts/security.md` cite §11 for secrets and the fail-closed rule, which are untouched.
  - `docs/framework/site/deployment.md`, `build.md`, `site/seo.md`, `site/redirects.md` and `concepts/color-schemes.md` list `site-build.ts` but describe nothing about when a mount's import is checked. The error names the class for a site author.
  - `formats.md` covers the format block, not `ServerBlock`; the three agents pages list the core artifacts, whose one moved description they do not quote.

No spec graduates. extensions.md keeps its `Partial` header.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#11`. `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose` and `docs:markdown` pass.
- `sed -n '/^## 11\./,/^### 11\.1/p' specs/extensions.md` shows `> **Status: Implemented.**` as the first blockquote. `git grep -n "falls back to" -- specs/extensions.md docs/extending/extensions/server.md` prints only the unrelated `_meta` sentence of §8.2.
- `bun run schema:verify` is green, and `git grep -n "Module specifier exporting the mount handler" -- '*.json' '*.ts'` prints nothing. The pathspec skips `packages/schema/--cwd`, a stray copy of `schema.json` committed in 288fb73a that no generator writes and no gate reads; it keeps the old text, and removing it is not this plan's job.
- `bun test --isolate --coverage` from `packages/compiler` passes with the three cases above and no per-file threshold failure.
- By hand: in a project whose local extension declares a `server` block with no `module`, and with a previous `dist/` present, `jx build` exits non-zero. The message names the class and its `basePath`, and `dist/` is unchanged.
