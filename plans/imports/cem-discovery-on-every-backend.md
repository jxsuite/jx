---
status: drafted
disposition: implement
claims:
  - imports.md#2
requires: []
workspaces:
  - packages/schema
  - packages/server
  - packages/desktop
  - packages/protocol
  - packages/studio
  - specs
  - docs
size: M
---

# The dev server and the desktop app discover a project's Custom Elements Manifest components through one shared scan, and the cloud adapter's omission is stated

## Context

`specs/imports.md` §2 (heading line 81), marker at line 83:

> **Status: Partial.** Only the dev server discovers CEM components: its `GET /__studio/components` handler (`packages/server/src/studio-api.ts`) reads each installed dependency's `customElements` manifest and lists its elements as `source: "npm"` entries. The desktop session's `discoverComponents` (`packages/desktop/src/project-session.ts`) and the cloud adapter's (`packages/studio/src/platforms/cloud.ts`) list only JSON project components, so in the desktop app no npm element reaches the property inspector, the Packages panel's cherry-pick or the Insert panel.

The marker holds at this commit. The audit record judges §2 on every Studio backend, because the desktop app is the end-user path (desktop.md §5.1: a transport-mapped backend preserves the dev server's response shapes).

**What exists**

- The scan, inline in the `/__studio/components` handler of `packages/server/src/studio-api.ts` (the "Discover CEM-bearing npm packages" block): `dependencies` and `devDependencies` of `<scanRoot>/package.json`; each resolved at `<scanRoot>/node_modules/<name>/package.json`, else `<root>/node_modules/…` (the server root, for a hoisted install); its `customElements` manifest read relative to the package; every declaration with `customElement` and `tagName` pushed as `{ $id: null, cssProperties, description, events, hasElements: false, members (kind "field", not private), modulePath: mod.path, package, path: null, props (from attributes: default, description, name, type.text), slots, source: "npm", tagName }`. Every failure is swallowed per package. Local `CemDeclaration`, `CemModule` and `Cem` interfaces type it. Cases: "discovers CEM components from node_modules" (`packages/server/tests/studio-api.test.ts`) and "discovers CEM components via root node_modules fallback" (`packages/server/tests/studio-api-gaps.test.ts`, whose `sub` fixture has no `node_modules` of its own).
- `componentMetaFrom` in `packages/schema/src/component-meta.ts`, the JSON-component extractor all three backends share. `@jxsuite/schema` already ships a Node-only subpath (`./validate-project`, static `node:fs`).
- The desktop session's `discoverComponents` (`packages/desktop/src/project-session.ts`), reached from both launchers (`window-manager.ts` and `chromium/index.ts`) and from the `handlers.ts` shim the tests drive: a `**/*.json` glob that skips `node_modules`, no `package.json` read. Its window's `createProjectServer` (`packages/server/src/project-server.ts`) already serves bare specifiers through `resolveNpmPath(root, …)`, so an enabled npm element renders in the desktop canvas today; only its discovery is missing. Cases in `packages/desktop/tests/handlers.test.ts` (`describe("discoverComponents")`).
- The cloud adapter's `discoverComponents`: a bounded `.json` walk over `listDirectory`. A cloud session is a git repository whose dependencies are never installed (`addPackage`/`removePackage` edit `package.json` only, "resolution happens in Pages CI"), and its canvas rewrites a bare specifier to `/node_modules/…`, which the session does not serve. The file's header comment still lists "component discovery" among the omissions, which desktop.md §10.1 contradicts.
- The wire type: `ComponentMeta` in `packages/protocol/src/types.ts` has no `source`, `package` or `modulePath`, and types `path` as `string`. The dev server's npm entries (`path: null`) only type-check because `devserver.ts` returns `res.json()` untyped; the desktop RPC response is typed `ComponentMeta[]`. The studio widens it locally (`ComponentEntry` in `packages/studio/src/files/components.ts`: `path?: string`, `source?: string`, `package?`, `modulePath?`).
- The consumers, all keyed on `source === "npm"` and unchanged by this plan: `groupByPackage` (`panels/imports-panel.ts`, which also reloads the registry after `addPackage`/`removePackage`), `enabledNpmTags`/`componentViews` (`panels/elements-panel.ts`), the npm branch of `componentPropRows` (`panels/properties-panel.ts`), `npmSpecifier` (`files/elements.ts`), `renderComponentPreview` (`panels/component-preview.ts`).

**What is missing:** the scan as a function any Bun backend can call; the desktop session calling it; a wire type that admits the entries; and the cloud adapter's omission stated where §2 and desktop.md §10.1 can be read.

Unchanged and owned elsewhere: extension-format component discovery in the desktop session (the dev server scans `documentExtensions("component")`, the desktop `.json` only; `plan:_shared/component-discovery` states the discovery rule); the `/__studio/packages` and `/__studio/cem` handlers, which repeat the same package resolution (`plan:imports/packages-route-payload`, `plan:imports/cem-route-payload`).

## Outcome

- imports.md §2 → Implemented (marker removed). The dev server and the desktop app return the same `source: "npm"` entries for the same project, from one scan in `@jxsuite/schema`; §2 states the scan and that a cloud session, having no installed dependencies, lists project components only.
- desktop.md §10.1 states that omission beside its `discoverComponents` paragraph (a release of an Implemented section; not a claim).
- Three markers owned elsewhere lose their "only the dev server" clause and stay Partial: imports.md §5 (`plan:imports/packages-panel-section`), desktop.md §6.2 (`plan:desktop/component-scope-sections`) and studio.md §5.4 (`plan:_shared/component-discovery`).

## Decisions

- **Decided:** the scan moves into `@jxsuite/schema` in two halves: the pure manifest-to-entries mapping joins `componentMetaFrom` in `component-meta.ts`, and the filesystem walk is a new Node-only subpath `./npm-components`. Because `@jxsuite/schema` is the one package the server, the desktop session and `extensions/parser` can all import (`plan:_shared/collection-directive-elements` reads this scan from the content loader and records that the parser can reach nothing else), `component-meta.ts` is the precedent for a shared extractor, and keeping `node:fs` out of `component-meta.ts` keeps the file the studio and the cloud adapter already bundle browser-safe.
- **Decided:** the walk takes an explicit, ordered `roots` list (directories whose `node_modules` are searched; default `[projectDir]`), and both Studio hosts pass `[scanRoot, root]`: the dev server its server root, the desktop session its project root. Because that reproduces the dev server's hoisted-install fallback exactly, and it keeps discovery to directories a host serves `/node_modules/…` from: the canvas rewrites a bare specifier to `/node_modules/<pkg>`, the dev server resolves that at its root (`resolveNpmPath(absRoot, …)`) and statically under the active project, and the desktop window's `createProjectServer` at the session root. In the desktop app the studio passes `projectRoot` `"."` (`files/files.ts`), so `scanRoot` is the session root and the two roots collapse to one. Node's ancestor walk would list, in the desktop app, packages hoisted above the project that the canvas then fails to load.
- **Decided:** entries stay byte-compatible with what the route sends today (same keys, `$id: null`, `path: null`, `hasElements: false`, `members` filtered to non-private fields, `modulePath` and `type` absent when the manifest omits them), with one narrowing: an attribute without a string `name` is skipped, since the inspector cannot write it. Because four studio consumers and the two server cases already read this shape.
- **Decided:** `ComponentMeta` in `@jxsuite/protocol` gains the optional npm members and `path: string | null`, with no `STUDIO_PROTOCOL_VERSION` bump. The dev server has always sent this shape, so the type catches up with the wire rather than changing it, and a reader that ignores the new members is unaffected. The commit is a `feat`, not a breaking change: a TypeScript reader that assumed `path: string` was already wrong for every npm entry the dev server sends. `ComponentEntry` stops redeclaring what it now inherits.
- **Open:** does the cloud adapter discover npm components? Recommendation: no, as a stated permanent shape (§2 and desktop.md §10.1), not a `Future` remainder. A cloud session has no installed dependency to read a manifest from, and its canvas cannot load a dependency's module either, so discovered entries would put checkboxes, cards and inspector rows in front of elements that render as empty boxes. That is the failure desktop.md §10.1 calls an omission that does not degrade gracefully. The alternative is to fetch `package.json` and the manifest from a public npm CDN at the declared range and serve modules the same way. That is a new network dependency and a CSP change for the cloud host, and if a maintainer wants it, the cloud sentence in §2 becomes a `> **Status: Future.**` block and the fragment level for imports.md stays minor.

## Implementation

1. `packages/schema/src/component-meta.ts`
   - Export the manifest subset types, moved from `studio-api.ts`: `CemAttribute`, `CemMember`, `CemDeclaration`, `CemModule`, `CemManifest`.
   - Export `NpmComponentMetaOut`: `{ source: "npm"; tagName: string; package: string; modulePath?: string; $id: null; path: null; hasElements: false; description: string | null; props: { name: string; type?: string; default?: unknown; description: string | null }[]; slots: unknown[]; events: unknown[]; members: CemMember[]; cssProperties: unknown[] }`.
   - Export `npmComponentsFromManifest(manifest: unknown, packageName: string): NpmComponentMetaOut[]`: the loop body of today's route (`modules[].declarations[]`, `customElement && tagName`), tolerant of a non-object manifest or missing arrays (`[]`). Set `modulePath` only when `mod.path` is a string and `type` only when `type.text` is.
   - Rewrite the header comment: the file holds both discovery extractors, one per source of components.
2. `packages/schema/src/npm-components.ts` (new; JSDoc `@docs studio/projects/dependencies` and `@docs extending/embedding/backend-protocol`):
   - `export interface NpmDiscoveryOptions { roots?: readonly string[] }`.
   - `export async function discoverNpmComponents(projectDir: string, options: NpmDiscoveryOptions = {}): Promise<NpmComponentMetaOut[]>`. Read `<projectDir>/package.json`; missing or unparseable gives `[]`. Take the names of `{ ...dependencies, ...devDependencies }`. Roots are `options.roots ?? [projectDir]`, resolved and deduplicated. For each name, the first `<root>/node_modules/<…name.split("/")>/package.json` that exists; unparseable, no string `customElements`, a missing manifest or an unparseable manifest each skip that package. Otherwise append `npmComponentsFromManifest(manifest, name)`. Never throws on project content.
   - `packages/schema/package.json` `exports`: `"./npm-components": "./src/npm-components.ts"`.
3. `packages/server/src/studio-api.ts`, `/__studio/components`: replace the "Discover CEM-bearing npm packages" block with `components.push(...(await discoverNpmComponents(scanRoot, { roots: [scanRoot, root] })));`. Delete the local `CemDeclaration`, `CemModule` and `Cem`. If the `/__studio/cem` handler still exists (`plan:imports/cem-route-payload` deletes it, and its step 1 keeps these interfaces only for the scan this step removes), its cast becomes `as CemManifest` (type import from `@jxsuite/schema/component-meta`); whichever of the two lands second drops the interfaces. The `/packages` and `/cem` resolution code is otherwise untouched.
4. `packages/desktop/src/project-session.ts`, `discoverComponents`: after the JSON loop, `components.push(...((await discoverNpmComponents(scanRoot, { roots: [scanRoot, root] })) as ComponentMeta[]));`. Comment it as the dev server's scan, with `roots` mirroring that host's hoisted-install fallback; the existing cast comment (schema sits under protocol) covers the `as`.
5. `packages/protocol/src/types.ts`, `ComponentMeta`: `path: string | null` (null for a dependency's element); add optional `source?: "jx" | "npm"` (documented as `"npm"` for a dependency's element, `"jx"` or absent for a project component, since the desktop and cloud backends send none), `package?: string`, `modulePath?: string`, `description?: string | null`, `events?: unknown[]`, `members?: unknown[]`, `cssProperties?: unknown[]`, each with a one-line doc citing imports.md §2 / §4.1. `packages/protocol/src/routes.ts`: the `components` summary becomes "Discover components (ComponentMeta[]): the project's component documents, plus one `source: \"npm\"` entry per custom element an installed dependency's Custom Elements Manifest declares".
6. `packages/studio/src/files/components.ts`: `ComponentEntry` drops `source`, `package` and `modulePath` (inherited; a `source?: string` redeclaration no longer type-checks against the union) and types `path?: string | null`. Every reader already tests `comp.path` for truthiness or compares it. Two test fixtures stop type-checking against the union and change their literal to `"jx"` (no code compares `source` to anything but `"npm"`, so behaviour is unchanged): `REGISTRY` in `packages/studio/tests/imports-panel.test.ts` (typed `ComponentEntry[]`, two `source: "project"` rows) and the three uncast `source: "local"` arguments to `renderComponentPreview` in `packages/studio/tests/component-preview.test.ts`. The `"local"`/`"project"` fixtures in `properties-panel.test.ts` and `stylebook-doc.test.ts` are cast `as never` and stay as they are.
7. `packages/studio/src/platforms/cloud.ts`: in the header comment, "component discovery" becomes "npm component discovery (imports.md §2)"; the `discoverComponents` JSDoc gains a paragraph saying dependency components are not discovered, because the session's repository has no installed dependencies and its canvas cannot load their modules. No behaviour change.

**Integration contract.** Once this lands:

- `@jxsuite/schema/npm-components` exports `discoverNpmComponents(projectDir, { roots? })` and `NpmDiscoveryOptions`. It resolves to `NpmComponentMetaOut[]`, `[]` when nothing is readable, and never throws on project content. Each entry has `source: "npm"`, `tagName`, `package`, and `modulePath` whenever the manifest names the declaring module. Order is dependency key order, then module, then declaration. It imports `node:fs` at module scope, so a caller that must also load in a Worker imports it lazily.
- `@jxsuite/schema/component-meta` exports `npmComponentsFromManifest`, `NpmComponentMetaOut` and the `Cem*` subset types, browser-safe.
- Every Bun Studio backend's `discoverComponents` / `GET /__studio/components` lists these entries after the project's own; the cloud adapter lists none.
- `ComponentMeta` (protocol) carries the npm members, so a PAL can return them without a cast of its own.

## Tests

Run `bun test --isolate --coverage` from each touched workspace, then `bun scripts/check-coverage-manifest.ts <workspace>`. Per-file thresholds (bunfig.toml): `packages/schema` 0.99/0.99, `packages/server` 0.96/0.95, `packages/desktop` 0.96/0.90, `packages/protocol` 0.99/0.99, `packages/studio` 0.958/0.941. Ratchet a workspace's threshold if its worst file rises. The new `npm-components.ts` ships with its test and is imported statically, so Bun's dropped-record defect for overlapping dynamic imports cannot hide it.

- `packages/schema/tests/npm-components.test.ts` (new). Fixtures are written under a temp directory in `beforeAll` and removed in `afterAll`.
  - "npmComponentsFromManifest maps a custom-element declaration to an npm entry": full `toEqual` on a declaration with attributes, slots, events, cssProperties and members (a public field, a private field, a method), giving props `{ name, type, default, description }` and the public field only.
  - "npmComponentsFromManifest skips a declaration without customElement or tagName, and an attribute without a name"
  - "npmComponentsFromManifest defaults absent arrays and description, and omits modulePath and type the manifest omits"
  - "npmComponentsFromManifest returns [] for a non-object manifest or one without modules"
  - "discoverNpmComponents lists the elements of dependencies and devDependencies", including a scoped package.
  - "discoverNpmComponents searches roots in order": a package in both roots yields the first root's tags; one only in the second is found.
  - "discoverNpmComponents defaults roots to the project directory": a package installed only elsewhere is not found.
  - "discoverNpmComponents skips an uninstalled dependency, one without customElements, a missing manifest and an unparseable manifest or package.json"
  - "discoverNpmComponents returns [] without a readable project package.json"
- `packages/server`: the two existing CEM cases stay unchanged and green; they pin the route through the refactor. New in `studio-api-gaps.test.ts`: "the components route answers the shared scan's npm entries", in which the `source: "npm"` entries for `?dir=sub` `toEqual` `discoverNpmComponents(join(ROOT, "sub"), { roots: [join(ROOT, "sub"), ROOT] })`.
- `packages/desktop/tests/handlers.test.ts`, `describe("discoverComponents")`:
  - "lists a dependency's Custom Elements Manifest elements as npm entries": the fixture `package.json` depends on `fake-els`, whose `node_modules/fake-els/package.json` names `custom-elements.json` declaring `fake-alert` in `dist/alert.js` with a `variant` attribute. It asserts `source`, `package`, `modulePath`, `tagName` and `props[0].name`, and that a JSON component in the same fixture is still listed first.
  - "finds a dependency hoisted to the session root when scanning a subdirectory": `dir: "site"` with `site/package.json`, and the package installed only in the root's `node_modules`.
- `packages/protocol/tests/routes.test.ts`: "components summary names the Custom Elements Manifest entries" (`toContain("Custom Elements Manifest")`, the pattern the file uses for other summaries).
- `packages/studio`: types, comments and the two fixture literals in step 6; the existing npm-entry cases (`imports-panel`, `elements-panel`, `properties-panel`, `elements-service`, `component-preview`) stay green.
- Both typechecks: `bun run typecheck` and `bun run --cwd packages/desktop typecheck` (after `bun scripts/check-electrobun-vendor.ts --init`).

## Specs & docs

**imports.md §2.** Delete the marker (the section was unmarked before the census). Replace the paragraph's second sentence ("The server scans `package.json` dependencies …") with:

> A Studio backend reads the project's `package.json` `dependencies` and `devDependencies`, looks each one up in the project's `node_modules` and then in the host's own root when the project is a subdirectory of it (where a workspace install hoists packages), and reads the manifest named by the installed package's `customElements` field, relative to that package. Each declaration with `customElement: true` and a `tagName` becomes one `source: "npm"` entry of the component registry (§4.1), naming its `package` and the declaring module's path as `modulePath`. A dependency that is not installed, declares no `customElements`, or names a missing or malformed manifest contributes nothing. The dev server and the desktop app run the same scan, so they list the same entries for the same project.

Map the bullet list onto the entry: tag names → `tagName`; attributes and their types → `props` (`name`, `type` from `type.text`, `default`, `description`); slots, events, CSS custom properties → `slots`, `events`, `cssProperties`; member properties → `members`, public fields only. Keep "This metadata powers …". Then append:

> A cloud session discovers no npm components. Its project is a repository whose dependencies are not installed (a package change there edits `package.json`, and the site's build resolves it), so there is no manifest to read and no module its canvas could load. Its registry lists the project's own components (desktop.md §10.1).

**imports.md §5** (marker only, stays Partial): "so they appear only under the dev server" becomes "so they appear under the dev server and in the desktop app, and not in a cloud session (§2)".

**desktop.md §6.2** (marker only, stays Partial): "only the dev server discovers npm components" becomes "a cloud session discovers none, imports.md §2".

**studio.md §5.4** (marker only, stays Partial): "which only the dev server discovers (`enabledNpmTags`)" becomes "which the dev server and the desktop app discover and a cloud session does not (`enabledNpmTags`; imports.md §2)".

**desktop.md §10.1.** At the end of the "**`discoverComponents` is NOT among them …**" paragraph, add: "What it discovers is the project's own JSON components. The npm half of discovery (imports.md §2) reads a manifest out of an installed dependency, and a cloud session's repository has none installed, nor could its canvas load a dependency's module, so the Packages panel's per-element checkboxes and the Insert panel's npm cards do not appear there."

**Fragments:**

- `bun run spec:change imports.md minor -m "The dev server and the desktop app discover Custom Elements Manifest components through one shared scan, and a cloud session lists project components only."`
- `bun run spec:change desktop.md patch -m "The cloud adapter's component discovery lists project components only, since a cloud session has no installed dependencies to read a manifest from, and the site project list no longer says only the dev server discovers npm components."`
- `bun run spec:change studio.md patch -m "The Components panel's status note says the desktop app discovers npm components as the dev server does."`

**Docs** (no em dashes on either page):

- `docs/extending/embedding/backend-protocol.md` (`code:` lists `packages/protocol/src/types.ts`): add `packages/schema/src/npm-components.ts` to `code:`, and a bullet under "Behaviors implementers must match": "**`components`** lists the project's component documents and, when the project's dependencies are installed, one `source: \"npm\"` entry per custom element a dependency's Custom Elements Manifest declares, carrying `package`, `modulePath`, `props` from its attributes, and its `slots`, `events`, `cssProperties` and public field `members`. `discoverNpmComponents` from `@jxsuite/schema/npm-components` is that scan for a backend running under Bun (the package ships TypeScript source). A backend whose project has no installed dependencies, like the cloud adapter, answers project components only."
- `docs/studio/projects/dependencies.md`: its text ("a new section appears for it, listing every component inside") becomes true in the desktop app and stays as written. Add `packages/schema/src/npm-components.ts` to `code:`. Move the three stray `code:` paths that trail the page body (`surfaces/panel-imports.json`, `surfaces/panel-imports.ts`, `surfaces/jxsuite-update.ts`) into the frontmatter, where they belong.
- `docs/extending/embedding/dev-server.md` (`code:` lists `studio-api.ts`) says nothing about component discovery, and `docs/extending/embedding.md` (`code:` lists `routes.ts`) names component discovery only as a backend concern, which stays true: no change to either. The generated studio-routes reference picks up the new `components` summary on its own.

**Graduation.** imports.md keeps other open items (`bun run plans:status --spec imports`). If this pull request closes the last one, it sets the header to `Implemented`, runs `bun run spec:bump imports.md minor` in place instead of the imports.md fragment (minor, because graduation rides on this implement), and deletes `plans/imports/`. It also deletes this file.

## Acceptance

- `bun run plans:check --audit imports` reports nothing for `imports.md#2`, and this file is gone.
- `git grep -n "Discover CEM-bearing npm packages" packages/server/src` finds nothing; `git grep -n "discoverNpmComponents" packages/server/src packages/desktop/src` finds the import and one call in each.
- The tests above green in `packages/schema`, `packages/server`, `packages/desktop`, `packages/protocol` and `packages/studio`, each followed by its coverage-manifest check; both typechecks green.
- In a scratch project (`project.json`, `bun add @shoelace-style/shoelace`), with `JX` set to the repository root, `bun -e 'const m = await import(process.env.JX + "/packages/schema/src/npm-components.ts"); console.log((await m.discoverNpmComponents(process.cwd())).length)'` prints a positive count. Open that project in the desktop app (`bun run --cwd packages/desktop dev`). With `project.json` focused, the Packages panel shows an `@shoelace-style/shoelace` section with a checkbox per element. Tick `sl-button`, open a page, and the Insert panel offers `@shoelace-style/shoelace: <sl-button>`. Drop it, and the canvas renders a button while the inspector lists its attributes (`variant`, `size`, …).
- `bun run docs:status`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown`, `docs:spec-release` and `plans:check` are green.
