---
status: drafted
disposition: implement
claims:
  - imports.md#4.2
requires: []
workspaces:
  - packages/server
  - packages/protocol
  - packages/studio
  - specs
  - docs
size: S
---

# `GET /__studio/packages` lists the dependencies `package.json` declares, on every backend, and §4.2 says so

## Context

`specs/imports.md` §4.2 (heading line 142, marker line 144):

> **Status: Partial.** The route in `packages/server/src/studio-api.ts` lists every installed dependency and devDependency, CEM-bearing or not, as `{ name, version, dev, hasCem, customElementsPath }`, and the studio reads it as its general dependency list (`listPackages` in `packages/studio/src/platforms/devserver.ts`, typed `PackageInfo[]` in `packages/protocol/src/types.ts`). No client reads `hasCem`.

The body under it still says the route "Lists CEM-bearing npm dependencies from `package.json`." Neither the body nor the dev server matches what the studio treats this route as, and the three backends disagree with each other.

**What exists** (verified 2026-09-26)

- The dev server: the `/__studio/packages` handler in `packages/server/src/studio-api.ts` (lines 998–1041, commented "List CEM-bearing npm packages"). It reads `package.json` under `dir` (default: the active project, then the server root) and merges `dependencies` and `devDependencies` into one object, so a name declared in both appears once, with the devDependency's range and `dev: false`. It resolves each name in the project's `node_modules`, then the root's, and **skips a dependency that is not installed**. It answers `{ name, version, dev, hasCem, customElementsPath }`, where `dev` is `false` rather than absent for a dependency. A missing `package.json` answers `[]`; one that does not parse answers an `internalError` problem. `dir` is **not contained**: unlike `/__studio/components`, none of the seven `/__studio/packages*` handlers passes it through `assertAccessible`, so `?dir=/any/path` reads that directory's `package.json`, and `packages/add`, `remove`, `install` and `set-versions` run `bun` there. server.md §4.2 routes every filesystem operation through that guard. No client sends `dir` to these routes (`packages/studio/src/platforms/devserver.ts` omits it everywhere), so the default, the active project or the server root, is all Studio uses.
- The desktop: `listPackages` in `packages/server/src/packages.ts`, reached through `createPackageOps` in `packages/desktop/src/packages.ts`. It lists **every declared** dependency, installed or not, as `PackageInfo` (`{ name, version }`, plus `dev: true` for a devDependency), and answers `[]` for a missing or unparseable manifest. The module's header says it is "Shared by the desktop app … and the dev server's `/__studio/packages*` endpoints so both backends behave identically", but the list route does not call it. The install, needs-install, versions and set-versions routes do.
- The cloud adapter: `listPackages` in `packages/studio/src/platforms/cloud.ts` reads the manifest the same way the desktop does.
- The contract: `PackageInfo` in `packages/protocol/src/types.ts` (`name`, `version`, optional `dev`), and `packages: route("GET", "/__studio/packages", "List dependencies (PackageInfo[])")` in `packages/protocol/src/routes.ts`. Neither has `hasCem` or `customElementsPath`, and nothing outside `packages/server` reads either field (the only hits are the handler and two tests).
- The consumers, all through `platform.listPackages()`:
  - the Dependencies table: `load` in `packages/studio/src/settings/dependencies-editor.ts`, which reads `Boolean(p.dev)`;
  - the Extensions section: `reload` in `packages/studio/src/settings/extensions-section.ts`, feeding `buildRows` in `packages/studio/src/settings/extension-rows.ts`;
  - the About dialog: `loadDetails` in `packages/studio/src/about/about-modal.ts`.

  On a dev server, a declared dependency that is not installed is missing from the Dependencies table, so it can be neither seen nor removed there.

- The divergence is written down as a reason in three places. `ExtensionCatalogEntry.installed` in `packages/protocol/src/types.ts` (line 302) and the header of `packages/server/src/extension-catalog.ts` (line 16) both say "the dev server drops a declared dependency it cannot resolve, while the desktop reads the manifest and keeps it". The `listExtensionCatalog` JSDoc in `packages/studio/src/types.ts` (line 423) says "`listPackages` does not mean one thing across backends".
- `buildRows` reads install state from the package list in one place. For a row `project.json` enables that the catalogue does not describe (a "configured" row, line 99), it sets `broken: !installed.has(specifier) && info === undefined`, where `installed` is the set of listed names. Catalogue rows use the backend's probed `entry.installed` and fall back to the list only when a host omits it (the cloud, which derives it from declarations anyway).
- Tests:
  - `packages/server/tests/studio-api-gaps.test.ts`, `describe("packages — gaps")`: "lists packages resolved through the root fallback", asserting `hasCem`, and "returns 500 for an unparseable package.json".
  - `packages/server/tests/studio-api.test.ts`, `describe("packages endpoint")`: "lists packages with CEM info", asserting `hasCem`, and "returns empty when no package.json".
  - `packages/server/tests/packages-ops.test.ts`, `describe("listPackages")`.
  - `packages/server/tests/studio-api-mocked-gaps.test.ts` mocks `../src/packages.ts` with an explicit export list.

**What is missing**

- One answer on every backend, which the dev server does not give.
- §4.2 describing that answer: the payload, `dir`, the empty and failure cases, and where CEM metadata comes from instead.

## Outcome

- imports.md §4.2 → Implemented. The dev server answers the declared list through the same mapping the desktop uses, and the section documents it.
- The three comments that justify the old divergence give the reason that still holds: the list is declarations, not resolution.
- Every `/__studio/packages*` route on the dev server contains `dir` as server.md §4.2 requires.
- imports.md stays Partial overall. §1.1, §1.2, §1.3, §1.4, §2, §4.3, §5, §5.1 and §6 stay open under their own plans.

## Decisions

- **Open:** should the dev server change to match the desktop and cloud backends, or should §4.2 document the dev server's payload as it stands? Aligning means listing a declared dependency that is not installed, and dropping `hasCem` and `customElementsPath`. Recommendation: align, because:
  - the desktop is the end-user path to Studio and already answers the declared list, and so does the cloud adapter;
  - `PackageInfo` and the route table already declare that shape, and `packages.ts` already claims to be the shared implementation;
  - no client reads either extra field. CEM metadata reaches the studio as §4.1's `source: "npm"` entries, and neither `plan:imports/cem-discovery-on-every-backend` nor `plan:imports/cem-route-payload` reads it from this route;
  - the installed-only filter hides a declared dependency from the Dependencies table exactly when the reader needs to see it: before an install, or after a pull that added it.

  Declining turns this plan into a `reconcile`. That version writes §4.2 as the dev server's installed-only payload with two dev-server-only fields, changes no code, and leaves the three comments true.

- **Open:** should `buildRows` stop reading install state from the package list for a configured row? Recommendation: yes. Change `broken` to `info === undefined`, meaning the backend's extensions payload did not resolve the specifier. Reasons:
  - Once the lists agree, `installed.has(specifier)` means "declared" on every backend. The dev server would then stop warning about a configured extension that is declared but not installed, as the desktop already never warns.
  - An enabled extension that the backend could not resolve fails the next build, whatever `package.json` says. The payload is the backend's own answer to that question.

  `installed` on the row keeps reading the list, because a declared package can still be removed. The cost is a warning on every configured row while the extensions payload has failed to load, which is already a degraded state. Declining drops step 5 below and its test, and the warning disappears from the dev server too.

- **Decided:** the route and `listPackages` share one pure mapping, `declaredPackages(manifest)` in `packages/server/src/packages.ts`. A second copy of the mapping is how the two backends drifted in the first place. The cloud adapter's own two loops (`listPackages` in `packages/studio/src/platforms/cloud.ts`) stay: `packages.ts` imports `node:fs` and the adapter ships in the browser bundle, and `cloud-platform.test.ts` already pins the same shape.
- **Decided:** the route keeps reading and parsing `package.json` itself, so an unparseable manifest still answers an `internalError` problem. server.md §4.3 says every failure is a problem document and lists the three surfaces that may stay 200; a swallowed parse error is not one of them. `listPackages` stays tolerant (`[]`) for the desktop, whose RPC path has no problem document to return, and the studio's dev-server adapter already maps a non-OK response to `[]`, so a reader sees the same thing on both.
- **Decided:** the entries are the manifest as written. `dependencies` come first, then `devDependencies`; a name declared in both is listed twice; and `dev` is absent rather than `false` for a dependency. This is `listPackages`'s existing behaviour, and every consumer reads `dev` through `Boolean(p.dev)`.
- **Decided:** every `/__studio/packages*` route contains `dir` the way `/__studio/components` does: `assertAccessible(dir, root, activeProjectRoot)`, and a refusal answers an `invalidRequest` problem, because server.md §4.2 already requires the guard of every filesystem operation and imports.md §4.2 now documents `dir` (`plan:imports/cem-route-payload` left this gap for this plan to judge). The six sibling routes share the same resolution line, and four of them spawn `bun` in the directory, so fixing only the list would leave the worse half open. No Studio flow changes, because no client sends `dir`.
- **Decided:** `STUDIO_PROTOCOL_VERSION` does not move. The declared response shape (`PackageInfo[]`) is unchanged; the dev server stops sending fields outside it.

## Implementation

1. `packages/server/src/packages.ts`:
   - Export `declaredPackages(manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): PackageInfo[]`, holding the two loops now inside `listPackages`.
   - `listPackages(root)` becomes `readPackageJson(root)`, then `declaredPackages(pkg)`, or `[]` when there is no manifest. Its behaviour is unchanged.
   - Its JSDoc says the list is what the manifest declares, installed or not (imports.md §4.2).
2. `packages/server/src/studio-api.ts`, containment: add a module-level `packageDir(dir: string | null | undefined, root: string, activeProjectRoot: string | null): string` beside `assertAccessible`. It resolves `dir || activeProjectRoot || root` against `root` (absolute stays absolute), calls `assertAccessible` on the result and returns it. All seven `/__studio/packages*` handlers (list, `add`, `remove`, `install`, `needs-install`, `versions`, `set-versions`) replace their two `dir`/`scanRoot`/`cwd` lines with it, called before any spawn, and map its throw to `problem("invalidRequest", errorMessage(error))`, as the components route does. `add` and `remove` keep their `Missing name` check first; `needs-install`, which has no `try` today, gains one around the call.
3. `packages/server/src/studio-api.ts`, the `/__studio/packages` GET handler:
   - Keep the `existsSync` → `[]` branch, and the `JSON.parse` inside the `try` whose `catch` returns `problem("internalError", …)`.
   - Replace everything after the parse (the merged `deps` object, the typed `packages` array, the per-dependency `node_modules` resolution and its inner `catch {}`) with `return Response.json(declaredPackages(pkg))`.
   - Add `declaredPackages` to the existing `./packages.ts` import.
   - The comment above the handler becomes "The dependencies package.json declares, installed or not (imports.md §4.2)".
   - `PackageJson.customElements` stays while the components scan or the cem route reads it. If `plan:imports/cem-discovery-on-every-backend` and `plan:imports/cem-route-payload` have both landed, this handler was its last reader and this plan deletes the field (the imports audit record's spec-wide decisions).
4. Comments that state the old divergence:
   - `packages/server/src/extension-catalog.ts` header: the `installed` paragraph becomes "**`installed` is answered here rather than by the client**, because `listPackages` reports what `package.json` declares, not what resolves under `node_modules` (imports.md §4.2). A surface deciding "do I need to install this first?" from a declaration would call a declared but uninstalled package installed."
   - `packages/protocol/src/types.ts`, `ExtensionCatalogEntry.installed`: "Answered here rather than derived from `listPackages`, because that member lists what `package.json` declares, installed or not (imports.md §4.2)." Keep the paragraph's last sentence, about a host with no module resolution, in whatever form it stands: `plan:extensions/catalogue-host-answers` rewrites that sentence ("A host whose project is built elsewhere reports the package.json declaration…") and keeps the paragraph around it, so the two edits compose in either landing order.
   - `packages/studio/src/types.ts`: in the `listExtensionCatalog` JSDoc, "the latter because `listPackages` does not mean one thing across backends" becomes "the latter because `listPackages` lists declarations, not what resolves (imports.md §4.2)". Give the `listPackages` member a one-line JSDoc: "The dependencies and devDependencies `package.json` declares, installed or not (imports.md §4.2)."
   - `packages/protocol/src/routes.ts`: the `packages` summary becomes `"List declared dependencies, installed or not (PackageInfo[])"`.
5. If the second Open is accepted, in `packages/studio/src/settings/extension-rows.ts`, `buildRows`'s configured-row loop:
   - Set `broken: info === undefined`.
   - Keep `installed: installed.has(specifier)`.
   - Rename the local `installed` set to `declared`, and update the `@param` line to "The project's declared dependencies, when they have been read", so the name says what it holds.
   - `plan:extensions/catalogue-host-answers` edits the same function: the catalogue loop's `specifier`, and the configured loop's `info` lookup (a `bySpecifier` map in place of `resolved.get(specifier)`). The edits compose in either order: `broken: info === undefined` reads whichever lookup is there, and the rename reaches the catalogue loop's `installed.has(entry.name)` too. Whichever plan lands second rebases over the other.

**Integration contract.** Once this lands:

- `declaredPackages` is exported from `@jxsuite/server/packages`.
- Every `/__studio/packages*` route resolves `dir` through `packageDir` and refuses one outside the server root and the active project with an `invalidRequest` problem.
- Every backend's `listPackages` means the same thing: one `PackageInfo` per declared dependency and devDependency, with no install check and no manifest fields.
- A consumer that needs to know whether something is installed asks `dependenciesNeedInstall` or a catalogue entry's `installed`, never the package list.
- imports.md §4.2 states this. No plan in the index requires this one.

## Tests

Run `bun test --isolate --coverage` from each workspace, with `bun scripts/check-coverage-manifest.ts <workspace>` for each:

- `packages/server`: `lines = 0.96, functions = 0.95`.
- `packages/protocol`: `0.99`, `0.99`. It gets a comment and a string change only.
- `packages/studio`: `0.958`, `0.941`.

No source file is added. The handler loses lines and gains none; ratchet `packages/server` only if its worst file rises.

`packages/server/tests/packages-ops.test.ts`, `describe("listPackages")`:

- New "declaredPackages maps a manifest without touching the disk". `{}` maps to `[]`. A name in both sections yields two entries, the second with `dev: true`. A dependency's entry has no `dev` key (`toEqual`, not `toMatchObject`).
- The two existing cases pass unchanged.

`packages/server/tests/studio-api-gaps.test.ts`, `describe("packages — gaps")`:

- Replace "lists packages resolved through the root fallback" with "lists every declared dependency, installed or not". Add a fixture `decl-proj` whose `package.json` declares `dependencies: { "cem-dep": "1.0.0", "never-installed": "^2.0.0" }` and `devDependencies: { "dev-only": "~1.0.0" }`, with no `node_modules` of its own. `cem-dep` resolves through the root fallback, and the other two resolve nowhere. Assert that the response `toEqual`s `[{ name: "cem-dep", version: "1.0.0" }, { name: "never-installed", version: "^2.0.0" }, { dev: true, name: "dev-only", version: "~1.0.0" }]`, which also proves no `hasCem` or `customElementsPath` field is sent.
- "returns 500 for an unparseable package.json" passes unchanged.
- New "every packages route refuses a dir outside the server root and the active project (server.md §4.2)": for each of the seven routes, with `dir` (query or body) set to `resolve(ROOT, "..", "outside-root")`, which does not exist and lies outside `ROOT`, and a `name` or an empty `updates` where the route needs one, the status is 400. Today each answers 200 or 500 without refusing, and the missing directory keeps a failing run from spawning `bun` anywhere real.
- "remove reports a non-zero bun exit with its stderr" passes its `mkdtemp` directory, which lies outside `ROOT`, so it would now be refused. Call `callApi(req, url, ROOT, emptyDir)`, making that directory the active project, and keep its assertions. It must not move under `ROOT`: `bun remove` would then walk up to `packages/server/package.json`.

`packages/server/tests/studio-api.test.ts`, `describe("packages endpoint")`:

- "lists packages with CEM info" becomes "lists packages as PackageInfo", asserting `toEqual([{ name: "test-elements", version: "^1.0.0" }])`.
- "returns empty when no package.json" passes unchanged.

`packages/server/tests/studio-api-mocked-gaps.test.ts`:

- Add `declaredPackages: () => []` to the `mock.module("../src/packages.ts", …)` factory. The handler now imports it, and a mocked module without the export fails the import.

`packages/studio/tests/extensions-section.test.ts`, if the second Open is accepted:

- New "a configured extension package.json declares but the backend did not resolve still renders as broken". Call `mount({ extensions: ["@acme/mystery"] }, [], {}, [{ name: "@acme/mystery", version: "^1.0.0" }])`. Assert `rowFor("@acme/mystery")?.dataset.broken` is `""` and that the `note-warn` part contains "the next build will fail".
- "a configured-only extension the backend resolved is described too" gains an assertion that the row is not broken once `setExtensions` resolves it.
- "an extension project.json names but nothing describes still gets a row" passes unchanged.

## Specs & docs

`imports.md` §4.2, in place (the heading stays `### 4.2 \`GET /__studio/packages\``):

- Delete the Partial marker on line 144. The section then reads as Implemented, like §4.1, §4.4 and §4.5, which carry no marker.
- Replace "Lists CEM-bearing npm dependencies from `package.json`." with three blocks:
  1. "Lists the dependencies the project's `package.json` declares, as `PackageInfo[]` (`packages/protocol/src/types.ts`): `{ name, version }` for each `dependencies` member, then `{ name, version, dev: true }` for each `devDependencies` member, where `version` is the range as written. A name declared in both sections is listed twice."
  2. A `json` example: `[{ "name": "@shoelace-style/shoelace", "version": "^2.15.0" }, { "name": "@jxsuite/compiler", "version": "^0.19.0", "dev": true }]`, one entry per line.
  3. "The list is the manifest's, not the install's. A declared dependency that is not installed is listed, and nothing is read from `node_modules`. Whether the tree needs installing is `GET /__studio/packages/needs-install`, and Custom Elements Manifest metadata reaches the studio as §4.1's `source: "npm"` entries, not through this route. The optional `dir` names the project, resolved against the server root (server.md §4.1), and defaults to the active project, then the server root; a `dir` outside both answers an `invalidRequest` problem (server.md §4.2). A project with no `package.json` answers `[]`; one whose `package.json` does not parse answers an `internalError` problem (server.md §4.3). The desktop and cloud backends answer the studio's `listPackages` with the same list (desktop.md §5.1)."

Fragment:

```sh
bun run spec:change imports.md minor -m "§4.2: GET /__studio/packages lists every dependency and devDependency package.json declares, installed or not, as name, version and dev, with no manifest fields, as the desktop and cloud backends already do, and refuses a dir outside the server root and the active project"
```

If the first Open is declined, the fragment is `minor` with the reconcile sentence instead: "§4.2 describes the dev server's installed-dependency payload, including its two manifest fields, and a dir outside the server root and the active project is refused". The containment ships either way.

Docs pages (`bun run docs:sync` names them through `code:`; none cites `imports.md#4.2` in `spec:`):

- `docs/extending/embedding/platform-adapter.md` (`code:` lists `packages/studio/src/types.ts`). After the interface-surface table, add: "`listPackages` answers what the project's `package.json` declares, installed or not: one entry per dependency, and one with `dev: true` per devDependency. Studio learns whether something is installed elsewhere (`dependenciesNeedInstall`, and `installed` on catalogue entries), so do not filter the list by what resolves." No em dash.
- `docs/extending/embedding/backend-protocol.md` (`code:` lists `packages/protocol/src/types.ts` and `routes.ts`): no prose change. The generated `docs/extending/reference/studio-routes.md` picks up the new summary.
- `docs/extending/embedding.md` (`code:` lists `routes.ts`): no change. It does not describe the packages route.
- `docs/extending/embedding/dev-server.md` (`code:` lists `studio-api.ts`): no change. It does not describe the packages route, and its **File containment** bullet already says `assertAccessible` guards the filesystem API, which these routes now honour.
- `docs/studio/projects/settings.md` (`code:` lists `extension-rows.ts`, touched only if the second Open is accepted): no change. Line 127 ("If a row warns that an extension is named but not installed, turning it off and on again installs it") stays true, now on every backend.
- `docs/extending/extensions/first-party.md` (the `@docs` target of `extension-catalog.ts`): no change. It does not mention the package list.

imports.md keeps its Partial header while another item is open, and today nine are. If this pull request closes the last one (`bun run plans:status --spec imports` lists only §4.2), it sets the header's `**Status:**` to `Implemented`, runs `bun run spec:bump imports.md minor -m "<the fragment's sentence>"` in place instead of the fragment, and deletes `plans/imports/`.

## Acceptance

- The `packages/server`, `packages/protocol` and `packages/studio` suites pass at their thresholds, and the manifest check passes for each.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass. `bun run plans:status --spec imports` no longer lists §4.2.
- `grep -rn "hasCem\|customElementsPath" packages/ --include=*.ts` finds nothing outside `dist/`.
- `grep -rn "does not mean one thing\|drops a declared dependency" packages/*/src` finds nothing.
- `grep -n "packageDir(" packages/server/src/studio-api.ts` shows one call in each of the seven `/__studio/packages*` handlers.
- Observable: start `jx dev` in a project, add `"left-pad": "^1.3.0"` to its `package.json` without installing it, and run `curl -s localhost:<port>/__studio/packages`. The response lists `{"name":"left-pad","version":"^1.3.0"}` with no `hasCem` key, and Studio's Settings → Packages table shows the row with a Remove button, as the desktop app does. The same request with `?dir=/etc` answers 400.
