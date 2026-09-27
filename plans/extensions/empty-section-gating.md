---
status: drafted
disposition: implement
claims:
  - extensions.md#8.4
  - extensions.md#8.6
requires: []
workspaces:
  - packages/compiler
  - packages/server
  - packages/desktop
  - specs
  - docs
size: S
---

# One non-empty-section predicate decides every contribution a section owner makes, in every host

## Context

`specs/extensions.md` §8.4, line 351:

> **Status: Partial.** Contribution, host-written files, error collection, ordering and the non-empty gate on `emit` itself ship (`packages/compiler/src/site/site-build.ts`). The gating bullet's comparison does not hold: section loading (`loadProjectSections`, `packages/compiler/src/site/project-sections.ts`, which the dev server also uses) runs whenever the key is present, and the dev server activates every mount whatever its section holds (`buildRuntime`, `packages/server/src/jx-mounts.ts`); only the site build's mount activation matches `emit`.

`specs/extensions.md` §8.6, line 405:

> **Status: Partial.** Contribution, placement below the project's `$head` and warning on failure ship (`collectExtensionHead`, `packages/compiler/src/site/site-build.ts`). Gating does not match `emit` and `assets`: `collectExtensionHead` skips only an absent or `null` section, so an empty object still contributes where those two skip it.

§8.4's gating bullet (line 361) says `emit` runs only for a non-empty section, "the same gating as section loading and server mounts"; §8.5 (line 387) and §8.6 (line 414) say their gating matches it. Verified at 1127bfbe, the census undercounted: **six** sites decide whether a section owner acts, with **five** different tests.

| Site                                                                                  | Test today                                   | Empty `{}`  | `null`        |
| ------------------------------------------------------------------------------------- | -------------------------------------------- | ----------- | ------------- |
| `emit` loop, step 6e of `buildSite` (`site-build.ts` ~1015)                           | skip `== null` or an object with no keys     | skipped     | skipped       |
| `loadAssetMounts` (`packages/compiler/src/site/asset-mounts.ts` ~47)                  | the same, copied                             | skipped     | skipped       |
| `activeMounts`, step 1c of `buildSite` (`site-build.ts` ~319)                         | `!== undefined && typeof object && keys > 0` | inactive    | **TypeError** |
| `collectExtensionHead` (`site-build.ts` ~1654)                                        | skip `undefined` or `null`                   | contributes | skipped       |
| section-owner push loop in `pushDataSchema` (`packages/server/src/data-api.ts` ~482)  | skip `undefined` or `null`                   | pushes      | skipped       |
| `buildRuntime` (`packages/server/src/jx-mounts.ts` ~107), the dev and desktop servers | none: `registry.serverMounts()` ungated      | mounted     | mounted       |

`loadProjectSections` is a seventh reader but not a contribution: it calls `projectData` when `key in projectConfig`, and both hosts reach it (`site-build.ts` step 3b, `packages/server/src/resolve.ts`). The mount `options.sections` manifest is built by key presence in both hosts too (`buildMountSpecs` in `site-build.ts`, `buildRuntime`).

Three facts shape the design:

- **Studio writes `{}` for sections nobody configured.** `sectionValue` in `packages/studio/src/settings/contributed-section.ts` (line 338) assigns a fresh `{}` into the live project config the first time a contributed settings section renders, form or map layout, and `commitProjectConfig` serializes the live config on the next settings write. An empty section is therefore not evidence of intent.
- **`{ "auth": {} }` is the one first-party case the rule decides.** Every key of the auth fragment is optional (`extensions/auth/schemas/project.fragment.schema.json`), and `docs/studio/data/auth-and-secrets.md` says "every field is optional". The site build does not mount auth for `{}` (step 1c), while the dev server mounts it ungated, and `packages/server/tests/jx-mounts.test.ts` (line 255) uses `auth: {}` as its working auth fixture. Dev and deploy disagree today. The other first-party owners cannot hit the difference: `feed` and `search` reject `{}` by schema (`minProperties` / `required`; `extensions/feed/tests/extension-manifest.test.ts` line 116), and `content`, `data` and `connections` are maps whose empty value does nothing.
- **Loaded data is read unguarded.** `Content.resolvePaths` (`extensions/parser/src/content-loader.ts` ~847) calls `ctx.data.get(...)` with no guard, and `resolvePathEntries` (`packages/compiler/src/site/pages-discovery.ts` ~449) calls it outside any `try`. Gating `projectData` on non-empty would turn `{ "content": {} }` plus a `contentType` page from a "has no entries" warning into a TypeError that aborts the build.

## Outcome

- extensions.md §8.4 → Implemented. Every contribution a section owner makes (`emit`, `assets`, `head`, server-mount activation in the site worker, dev server and desktop server, and section-owner push steps) passes one exported predicate. The gating bullet defines "empty" and states that section loading keys on presence.
- extensions.md §8.6 → Implemented. `collectExtensionHead` skips an empty section.
- extensions.md stays Partial (§3, §5.4, §6.1, §7, §8, §8.1, §9, §9.1, §9.2, §10, §11, §11.1 and §12 remain open), so nothing graduates.

## Decisions

- **Open:** does an empty `auth` section stay off in the dev server too? Recommendation: yes, an empty section switches nothing on in any host, because the site build already treats `{ "auth": {} }` as off, so this aligns `jx dev` with what deploys, and because Studio plants `{}` on display, so `{}` cannot mean "on with defaults". The alternative, a per-class opt-in such as `project.activeWhenEmpty`, adds manifest vocabulary to keep a dev-only behaviour. Adding `minProperties: 1` to the auth fragment is rejected for the same planting reason: Studio would flag its own write. An author turns auth on by setting any field; in Studio, storing the signing secret does it, since the secret control writes `secretEnv` (`packages/studio/src/ui/form-controls.ts`, `mountSecret`).
- **Open:** is section loading gated like contributions (implement §8.4's sentence as written) or kept on key presence (reconcile the sentence)? Recommendation: reconcile. Loading writes no file, serves no route and adds no `<head>` entry, so an empty section's load is inert; `_project[<key>]` then holds the normalized value of any section the author wrote (the search extension's defaults, an empty content map); and gating it would crash `resolvePaths` on `{ "content": {} }` as shown above.
- **Open:** do section-owner `deploySchema` push steps pass the same predicate? Recommendation: yes, because today a Studio push for a project holding a planted `auth: {}` creates Better Auth's four system tables for a section the build never mounts, and once this lands no host mounts it either. §11.1 is `plan:_shared/db-push-section-owners`'s item, so this plan changes only the skip condition, wherever that loop lives when this lands.
- **Decided:** the predicate reproduces the `emit`/`assets` test exactly. A class with no `project` block is active. A section owner is inactive when its value is absent, `null`, or an object or array with no own keys, and active for any other value, a scalar included. Those two sites are the ones the spec names as the reference and the census verified, so neither changes behaviour. Scalars are schema violations for every first-party section.
- **Decided:** it lives in `packages/compiler/src/site/project-sections.ts` as `sectionOwnerActive`, exported through the existing `@jxsuite/compiler/project-sections` entry, because that module is the host's generic section orchestration (its header cites extensions.md §8 and §9), `packages/server` already imports that entry (`resolve.ts`), and a `packages/schema` home would add a workspace whose change reruns the whole matrix for a host-side rule. No suite mocks `@jxsuite/compiler/project-sections`, so a new export breaks no double. The reverse edge does break one: `project-sections.ts` imports `createNodeFormatIO` from `./format-host.ts`, so a suite that replaces `@jxsuite/compiler/format-host` wholesale and then loads the real `jx-mounts.ts` or `data-api.ts` stops linking. That is `packages/desktop/tests/handlers-gaps.test.ts`, whose mock omits `createNodeFormatIO` and which loads `@jxsuite/server/data` through `project-session.ts` (Tests). `live-preview-gaps.test.ts` also mocks format-host but mocks `jx-mounts.ts` and `resolve.ts` too, so it never loads the module.
- **Decided:** the mount `options.sections` manifest keeps key presence in both hosts. It is data a mount reads (the data mount reads `connections`, whose owner has no mount), it mirrors loading, and changing it is outside both claims.

## Implementation

1. **`packages/compiler/src/site/project-sections.ts`**:
   - Add `export function sectionOwnerActive(entry: Pick<FormatEntry, "project">, projectConfig: ProjectConfig | undefined): boolean`. `entry.project == null` returns `true`. Otherwise read `projectConfig?.[entry.project.key]`; `undefined` or `null` returns `false`; an object (arrays included) returns `Object.keys(value).length > 0`; anything else returns `true`. Doc comment: the §8.4 gate, the definition of empty, and that loading is deliberately not gated.
   - `loadProjectSections`: behaviour unchanged. Extend its doc comment with the reason (loading contributes nothing, and `resolvePaths` reads the loaded value unguarded), citing extensions.md §8.4.
   - Add `@docs extending/extensions/project-sections` to the module header.
2. **`packages/compiler/src/site/site-build.ts`**, importing `sectionOwnerActive` beside `loadProjectSections`:
   - Step 1c: `const activeMounts = registry.serverMounts().filter((entry) => sectionOwnerActive(entry, projectConfig));`. This also removes the `Object.keys(null)` TypeError. Keep the comment's first sentence and cite §8.4.
   - Step 6e: replace the inline condition with `if (!sectionOwnerActive(entry, projectConfig)) { continue; }`. Keep reading `sectionValue` for the call. The trailing comment "same gating as sections/mounts" becomes "the §8.4 gate, shared with assets, head and mount activation".
   - `collectExtensionHead`: replace the `undefined`/`null` test with the predicate; the call still passes `sectionValue ?? null`. This closes §8.6.
3. **`packages/compiler/src/site/asset-mounts.ts`**, `loadAssetMounts`: replace the copied condition with the predicate (import from `./project-sections.ts`).
4. **`packages/server/src/jx-mounts.ts`**, `buildRuntime`: `const mounts = registry.serverMounts().filter((entry) => sectionOwnerActive(entry, config));` before the existing `mounts.length === 0` return, importing from `@jxsuite/compiler/project-sections`. The `sections` manifest loop stays. Add one sentence to the module header: mounts are activated by the site build's section gate (specs/extensions.md §8.4), so `jx dev` serves the set the worker would. The desktop's project server dispatches through `handleJxMounts` (`packages/server/src/project-server.ts`) and inherits the change.
5. **Section-owner push loop.** If `plan:_shared/db-push-section-owners` has not landed: in `pushDataSchema` (`packages/server/src/data-api.ts`), replace `if (section === undefined || section === null)` with `if (!sectionOwnerActive(entry, project.config))`, keeping the `section` read for the call, and in that plan change "same `undefined`/`null` skip" to "the `sectionOwnerActive` skip" (and its absent-or-null test case to absent, `null` or empty), so the loop it moves keeps the gate. If it has landed: make the same one-line change in `pushSectionOwners` (`packages/compiler/src/site/section-push.ts`).
6. Tests, spec and docs as below. Delete this file in the landing pull request, and remove every `plan:extensions/empty-section-gating` citation from a plan that has not landed (`grep -rn 'plan:extensions/empty-section-gating' plans/`), or `plans:check` reports `citation-unknown`: today the merge-adjacency note in `plan:extensions/server-module-required`.

**Integration contract.** Once this lands, `@jxsuite/compiler/project-sections` exports `sectionOwnerActive(entry, projectConfig)`, and any host code that asks whether a section owner contributes calls it rather than re-deriving the test. `loadProjectSections` and both mount manifests keep key presence. extensions.md §8.4 defines empty (absent, `null`, or an object or array with no entries) and lists every gated contribution, so a plan adding a section-owner capability extends that list and calls the predicate. A project whose `auth` or `data` section is empty activates no mount in any host, which is the reading `plan:_shared/no-adapter-server-tier`'s "non-empty `data` or `auth` section" text already assumes.

## Tests

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/project-sections.test.ts`, new describe `sectionOwnerActive`, with bare entries (`{ project: null }`, `{ project: { key: "k" } }`):
  - `a class owning no section is always active`: `true` for an undefined config and for `{}`.
  - `an absent, null, empty-object or empty-array section is inactive`: `false` for configs `{}`, `{ k: null }`, `{ k: {} }`, `{ k: [] }` and `undefined`.
  - `a non-empty object or array, or any scalar, is active`: `true` for `{ k: { a: 1 } }`, `{ k: [1] }`, `{ k: "x" }`, `{ k: 0 }`, `{ k: false }`.
  - In `loadProjectSections`, `loads a present but empty section`: with `{ ...projectConfig, stuff: {} }`, `sections.stuff.section` equals `{}`. It pins the reconciled loading rule.
- `tests/site-build-reporting.test.ts`, new describe `buildSite — a head contributor with an empty section`, in the pattern of the existing head-throws fixture: a local `HeadProvider` owning `myhead` whose `head` returns `[{ tagName: "link", attributes: { rel: "alternate", href: "/from-head.xml" } }]`. `an empty section contributes no head entries`: with `myhead: {}`, `dist/index.html` does not contain `/from-head.xml`. `a non-empty section does`: rewrite `project.json` with `myhead: { on: true }`, rebuild, and it does.
- `tests/connector-mounts.test.ts`, new case `a null or empty data section activates no mount, so a static build succeeds`: the `-static` fixture pattern with `data: null`, then with `data: {}`; `buildSite` resolves, and `dist/worker.js` does not exist. With `null` this fails today on `Object.keys(null)`.
- `tests/asset-mounts.test.ts` already asserts that absent and `{}` sections contribute nothing, and stays green unchanged.

**`packages/server`** (`bun test --isolate --coverage` from `packages/server`):

- `tests/jx-mounts.test.ts`:
  - The `auth mount dispatch` fixture's `auth: {}` becomes `auth: { connection: "main" }`; its assertions stay.
  - New describe `section gating`, in its own fixture directory beside the file's (`${TMP}-gating`, so `@jxsuite/*` resolve from the repository), extensions `["@jxsuite/connector", "@jxsuite/auth"]`, `connections: { main: { provider: "sqlite" } }`, `auth: {}`, and a `notes` table with `permissions: { insert: "authenticated", read: "public" }`. `an empty auth section mounts no auth`: `GET /_jx/auth/get-session` returns `null`, and `POST /_jx/data/notes` is 401 with an `error` containing `no auth mount configured`, the production fail-closed path. `an empty data section mounts nothing`: rewrite with `data: {}` (no other mount-owning section), call `resetJxMounts()`, and `GET /_jx/data/notes` returns `null`.
- `tests/data-api.test.ts`, in `push with the auth extension`, `an empty auth section contributes no push steps` (only if the loop is still in `data-api.ts`): a fixture with `auth: {}` and one sqlite connection; a dry-run plan holds no `kind: "auth"` step. If `pushSectionOwners` exists instead, the same case goes into `packages/compiler/tests/section-push.test.ts` beside its absent-or-null case.

**`packages/desktop`** (`bun test --isolate --coverage` from `packages/desktop`): `tests/handlers-gaps.test.ts`'s `mock.module("@jxsuite/compiler/format-host", …)` gains `createNodeFormatIO: () => ({})`, beside the `buildProjectFormatRegistry` entry it already carries for the same reason (a module mock replaces the whole module, so every named import must be present to link). No assertion changes.

**Coverage.** No source file is added, so the manifest check is unaffected. `sectionOwnerActive` is measured under `packages/compiler` (the server's bunfig ignores `../compiler/**`), and every branch has a case. The edited call sites lose lines rather than gain branches. Thresholds are `lines = 0.982, functions = 0.98` in `packages/compiler/bunfig.toml` and `lines = 0.96, functions = 0.95` in `packages/server/bunfig.toml`; nothing is expected to raise a worst file, so no ratchet unless the run shows one.

## Specs & docs

**`specs/extensions.md` §8.4**, in place:

- The marker becomes `> **Status: Implemented.**`, the bare form §8.5 uses.
- The gating bullet becomes: "**Gating**: when the class owns a project section (`project.key`), `emit` runs only if the project declares a non-empty value for that key. A value is empty when the key is absent, when it is `null`, or when it is an object or array with no entries; any other value is declared. The same test decides every other contribution a section owner makes: its `assets` mounts (§8.5), its `head` entries (§8.6), its server mount in the site worker, the dev server and the desktop server (§11), and its `deploySchema` steps in a schema push (§11.1). An empty section therefore switches nothing on, and a section whose every key is optional, such as the auth extension's, is turned on by declaring at least one of them. Section loading is deliberately not gated this way: `projectData` runs whenever the key is present, so `_project[<key>]` holds the normalized value of any section the author wrote, and a mount's section manifest carries every present key. Classes without a `project` block always run." If the push decision goes the other way, drop the `deploySchema` clause.

**`specs/extensions.md` §11**, in place, its first sentence only (the marker and the `module` row belong to `plan:extensions/server-module-required`): "A class contributes routes to the deployed-site worker (and the dev server) iff it has a top-level `server` object plus a `mount` capability" gains ", and, when it owns a project section, the project declares a non-empty value for it (§8.4)". Without it the "iff" stops being true.

**`specs/extensions.md` §8.6**, in place: the marker becomes `> **Status: Implemented.**`, and the gating bullet ends "...a non-empty value for its key (§8.4 defines empty)."

**Fragment:** `bun run spec:change extensions.md minor -m "§8.4 and §8.6: one test decides whether a section owner contributes: emit, assets, head, server-mount activation in every host and section-owner push steps all skip an absent, null or empty section, while projectData still loads any section whose key is present."` Minor: an implement, whose one author-visible change aligns the dev server with the build.

**Docs** (no em dashes). `bun run docs:sync` names `docs/extending/extensions/search.md` and `docs/framework/site/search.md` (`spec:` cites `extensions.md#8.4`), `docs/framework/site/feeds.md` (`#8.6`), `docs/extending/extensions/capabilities.md` (`code:` lists `asset-mounts.ts`) and `docs/extending/embedding/dev-server.md` (`code:` lists `jx-mounts.ts`).

- `docs/extending/extensions/search.md`, line 88: "...and skips the emitter entirely when the project declares no `search` section, the same gating as section loading and server mounts." becomes "...and skips the emitter entirely unless the project declares a non-empty `search` section: the same test that decides whether a section's `assets`, `head` entries and server mount contribute."
- `docs/extending/embedding/dev-server.md`, "Extension server mounts": after the first sentence add "It mounts the same set, too: a class that owns a project section is mounted only when that section is non-empty, exactly as in the built worker."
- `docs/extending/extensions/project-sections.md` (not named by the sync, but where `projectData` is documented): after the `projectData` paragraph add "`projectData` runs whenever the section's key is present, even when its value is empty, so `_project[<key>]` always holds the normalized value of a section the author wrote. What a section contributes is gated more strictly: its `emit` files, `assets` mounts, `head` entries, server mount and schema-push steps appear only when the section is non-empty. A missing key, `null`, `{}` and `[]` all count as empty, so a section whose every field is optional, such as `auth`, is turned on by setting at least one of them." Add `packages/compiler/src/site/project-sections.ts` to its `code:` frontmatter, matching the new `@docs` tag.
- `docs/extending/extensions/server.md`, line 105: after "...including `ctx` ordering and the fail-closed behavior." add "It activates the same mounts as well: a class owning a project section only when that section is non-empty, a class without one always."
- `docs/studio/data/auth-and-secrets.md`, "The Authentication settings section": after "The section is a single form, and every field is optional." add "Auth is on once at least one field is set, and storing the signing secret is enough. With every field blank the section turns nothing on, in `jx dev` and in the build alike."
- `docs/framework/site/search.md`, `docs/framework/site/feeds.md` and `docs/extending/extensions/capabilities.md`: no change. None states a gating rule; the feed and search schemas already reject an empty section.
- Also named by the sync through `code:` entries for `site-build.ts` (`docs/framework/build.md`, `docs/framework/site/deployment.md`, `seo.md`, `redirects.md`, `docs/framework/concepts/color-schemes.md`), `asset-mounts.ts` (`docs/framework/site/images.md`) and `data-api.ts` (`docs/studio/data/grid.md`, `connections.md`): no change. `deployment.md` line 272 already says a "non-empty" `data` or `auth` section needs a server adapter, and the others state no gating rule.

No spec graduates.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#8.4` or `extensions.md#8.6`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `git grep -n sectionOwnerActive -- packages` lists the definition in `project-sections.ts` and uses in `site-build.ts` (three), `asset-mounts.ts`, `jx-mounts.ts` and the push loop, plus the tests.
- `git grep -nE 'Object\.keys\((value|sectionValue)\)\.length' -- packages/compiler/src/site packages/server/src` prints nothing outside `project-sections.ts`.
- In both sections, `sed -n '/^### 8\.4 /,/^### 8\.5 /p' specs/extensions.md` and the §8.6 equivalent show `> **Status: Implemented.**` as the first blockquote.
- By hand: a project listing `@jxsuite/connector` and `@jxsuite/auth` with `"auth": {}` under `jx dev` no longer answers `/_jx/auth/get-session` from Better Auth; with `"auth": { "connection": "main" }` and `BETTER_AUTH_SECRET` in `.dev.vars` it answers `null` with status 200.
- `bun test --isolate --coverage` passes from `packages/compiler`, `packages/server` and `packages/desktop` with the cases above and no per-file threshold failure.
