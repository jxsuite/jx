---
status: drafted
disposition: implement
claims:
  - extensions.md#9.2
requires: []
workspaces:
  - packages/protocol
  - packages/server
  - packages/studio
size: S
---

# The catalogue section states what each host can actually answer, and every host answers `bundled` and `installed` for the build that will load the package

## Context

`specs/extensions.md` §9.2, line 483 (unmarked before the census):

> **Status: Partial.** The dev server and desktop answer the full contract (`packages/server/src/extension-catalog.ts`, `probeExtension` in `packages/compiler/src/site/format-host.ts`). No host populates `specifier`, and the cloud host declares rather than probes: `listExtensionCatalog` in `packages/studio/src/platforms/cloud.ts` sets `bundled: true` on every gateway entry and derives `installed` from `package.json` declarations.

The census called this a `reconcile`. The detail found that the cloud half is not only a spec that failed to admit a degradation, and that the table and the dev-server builder disagree with themselves in two small places. Verified at the current tree:

- **The dev server and desktop** share `buildExtensionCatalog` (`packages/server/src/extension-catalog.ts`; `GET /__studio/catalog` in `packages/server/src/studio-api.ts`, `listExtensionCatalog` in `packages/desktop/src/project-session.ts`). `probeExtension` splits `createNodeFormatIO`'s two-branch resolution into `{ project, host }`, probing the manifest through the exports map; `declaresJxField` turns a `"jx"` package without the export into a `problem` row. Tested in `packages/server/tests/extension-catalog.test.ts` and `packages/compiler/tests/format-host.test.ts` (`describe("probeExtension")`). The "host capability", "exports map" and "no version" rules hold as written.
- **`bundled` means two things in one function.** The first-party branch (line 170) sets it when `found.host && !found.project`; the discovered branch (line 213) when `found.host`, whether or not the project resolves the package too. The studio reads it as "enabling needs no install": `canRemove: row.installed && !row.bundled` and the note "Ships with this backend, so it needs no install." (`packages/studio/src/settings/extensions-section.ts`). No test asserts `bundled` on either branch; the discovered branch's host test only fires for a non-catalogue package the host also ships, which no workspace is.
- **The cloud** (`listExtensionCatalog`, `cloud.ts` line 708) fetches the gateway's `/catalog`, then sets `entry.bundled = true` and `entry.installed = declared.has(entry.name)` over `dependencies` and `devDependencies`. Its doc comment gives the reason: nothing resolves a module in a Worker, and "`addPackage` is a manifest edit and resolution happens later in Pages CI". The `installed` half is sound and the protocol already documents it ("A host with no module resolution at all degrades this to 'declared in package.json'", `ExtensionCatalogEntry.installed`, `packages/protocol/src/types.ts` line 307). The `bundled` half is not: it makes `enableExtension` (`packages/studio/src/settings/extension-commands.ts`) skip `addPackage` and write only `project.json`, but the build that deploys a cloud project is Pages CI, which resolves from the repository's `package.json`, and no core package depends on an extension (§2). Enabling an extension the starter did not declare therefore leaves a repository whose deploy build cannot resolve it, which is the failure §9.2's first paragraph exists to prevent. Tested by `packages/studio/tests/cloud-platform.test.ts`, "listExtensionCatalog asks the gateway and marks everything bundled".
- **`specifier` has no case in the catalogue.** `loadExtension` (`packages/schema/src/extension-registry.ts` line 255) refuses a bare entry whose manifest `name` differs, so a linked, `file:` or workspace package enables under its package name. The only `extensions` entry that differs from `name` is a relative path (§3), which is the project's own code; the catalogue offers first-party packages and declared dependencies, never a path. The field is typed (`types.ts` line 278), set by no host, and read once: `buildRows` in `packages/studio/src/settings/extension-rows.ts` line 70, `entry.specifier ?? entry.name`.
- **The pairing that does exist is dropped.** The enabled half, `ExtensionsInfo`, carries both `specifier` and `name` (`buildExtensionsPayload`, `packages/compiler/src/site/format-host.ts` line 247). `buildRows` keys it by `name` (line 66) and looks a configured row up by its `specifier` (line 97), so an enabled relative-path extension that resolved finds nothing: it renders untitled, with no sections, and `broken` (line 99), warning that "the next build will fail". No test covers a relative path.
- **Editorial.** "Three rules make it correct" (line 503) introduces four bold rules. The table omits `docs`, which `ExtensionCatalogEntry` declares and `buildExtensionCatalog` sets on every first-party entry (asserted in "every shipped extension is offered, installed or not").

## Outcome

- `extensions.md` §9.2 → Implemented: the Partial marker is removed (the section was unmarked before the census) and the section states what each kind of host answers, the cloud named.
- The cloud declares a package before enabling it; every host reports `bundled` only when the project lacks the package; a relative-path extension renders as what it is.
- `ExtensionCatalogEntry.specifier` is deprecated in `@jxsuite/protocol` and read by nothing.

## Decisions

- **Open:** does the cloud stop reporting `bundled`, so that enabling an undeclared extension there declares its package first? Recommendation: yes. `listExtensionCatalog` in `cloud.ts` sets `bundled = false` on every gateway entry, and the studio's existing install-first path runs the cloud's `addPackage` (a `package.json` edit, no network) before the `project.json` write. Because the deploy build resolves from `package.json` (the adapter's own comment says so), the session bundling a package is no evidence that the build can load it, and the declaration costs one manifest edit; §3's "projects own their extension dependencies" then holds on every host. Side effects, all correct for a manifest-backed host: Remove appears on a declared, disabled row, and an enabled-but-undeclared row warns that the next build will fail. The alternative applies only if the platform's deploy build ships exactly the packages its Worker bundles: `cloud.ts` keeps `bundled = true`, and the rule paragraph states that as the cloud's build contract instead of "reports nothing bundled". That fact lives outside this repository, so a maintainer who can see the platform signs it.
- **Open:** is `specifier` dropped rather than populated? Recommendation: drop it from §9.2's table, stop reading it in the studio, and mark `ExtensionCatalogEntry.specifier` `@deprecated` rather than deleting it. Because every catalogue entry enables under its `name` (Context), populating it would mean discovering unenabled project-local extension directories, a feature nobody has asked for; and deleting an exported member of `@jxsuite/protocol` (2.3.1) is a semver-major for a field no host has ever set, where `@deprecated` has precedent in the same file (`types.ts` line 28, `problem.ts` line 54).
- **Decided:** a host whose project is built elsewhere reports `installed` as the `package.json` declaration, because that is what the build installs from, the Worker resolves nothing, and the protocol comment already says so. This is the reconciled half of the marker; `cloud.ts`'s `installed` line is unchanged.
- **Decided:** `bundled` is reported only when the host resolves the package and the project does not, in both branches of `buildExtensionCatalog`, because the studio reads it as "enabling needs no install" and a project with its own copy has already answered that. The discovered branch's `found.host` spread is deleted: a discovered entry always resolves from the project. `bundled` and `installed` become exclusive, which is what the row model's three notes already assume.
- **Decided:** `buildRows` looks a configured row up in the extensions payload by `specifier`, because that is the string `project.json` holds and the only place the specifier/name pairing lives once the catalogue stops claiming it. For a bare entry the two keys agree, so every existing row is unchanged.
- **Decided:** the configured group's blurb and the settings page's bullet stop saying the backend "does not describe" those rows, because after the lookup fix a resolved relative-path extension is described and still sits in that group (as a bare configured name the payload resolved already does, "a configured-only extension the backend resolved is described too").

## Implementation

Written for both Opens' recommendations; the alternatives change only the steps named in them.

1. `packages/protocol/src/types.ts`, `ExtensionCatalogEntry`:
   - `specifier?`: replace the JSDoc with "@deprecated No host sets it and Studio ignores it. Every catalogue entry enables under {@link name}: a bare `extensions` entry must equal its manifest name, and a relative-path extension is the project's own code, never an offer (specs/extensions.md §9.2). Removed at the next major."
   - `bundled?`: "THIS host resolves the package and the project does not, so enabling it is a config write alone. A host whose project is built elsewhere (the cloud, whose deploy build installs from package.json) never sets it."
   - `installed?`: keep the first two paragraphs; the last sentence becomes "A host whose project is built elsewhere reports the package.json declaration, which is what that build installs from (specs/extensions.md §9.2)."
2. `packages/server/src/extension-catalog.ts`, `buildExtensionCatalog`: delete `...(found.host ? { bundled: true } : {}),` from the discovered entry (line 213). The first-party comment (lines 168 to 169) becomes "Bundled means the host resolves it and the project does not: enabling it needs no install." Extend the module doc's "annotated with two facts" paragraph with "`bundled` only when the project lacks the package, so the two are exclusive."
3. `packages/studio/src/platforms/cloud.ts`, `listExtensionCatalog`: `entry.bundled = true` becomes `entry.bundled = false`. Rewrite the doc comment's second and third paragraphs: the gateway returns only what the Worker bundles, so the list is a host capability; but the site is built in Pages CI from `package.json`, so nothing here is `bundled`: enabling one declares it first through `addPackage`, and `installed` means DECLARED because that declaration is what the build installs. Keep the "Degrades to an EMPTY list" paragraph.
4. `packages/studio/src/settings/extension-rows.ts`, `buildRows`:
   - Catalogue loop: `const specifier = entry.specifier ?? entry.name;` becomes `const specifier = entry.name;`, with a one-line comment "A catalogue entry enables under its name (specs/extensions.md §9.2)."
   - Configured loop: build `const bySpecifier = new Map(getExtensions().map((e) => [e.specifier, e]));` beside `resolved` and read `bySpecifier.get(specifier)` at line 97. `resolved` (by `name`) stays for the catalogue loop. Update the loop comment: a relative-path extension is described by the payload entry its path produced.
   - `ExtensionRow.specifier`'s JSDoc gains "It differs from `name` only for a relative path, which only a configured row carries."
5. `packages/studio/src/settings/extensions-section.ts`, `GROUPS`: the `configured` blurb becomes "Named in project.json but not offered here, such as an extension in this project's own folders. You can still turn them off."

No signature changes. `packages/desktop` and the dev server's route pick up step 2 through the shared builder.

**Integration contract.** Once this lands: every `ExtensionCatalogEntry` a host in this repository returns enables under `name`; `bundled` is set only when `installed` is not; the cloud adapter returns `bundled: false` and `installed` as declared; `buildRows` resolves a configured row's description by its `project.json` string. `extensions.md` §9.2 is unmarked and states the host rules below.

## Tests

Run `bun test --isolate --coverage` from `packages/server` and from `packages/studio`; `packages/protocol` changes only comments, so its suite is unchanged and `bun run typecheck` covers it. No new source file, so the manifest check sees nothing new. Per-file thresholds hold: `packages/server/bunfig.toml` (`lines = 0.96, functions = 0.95`) and `packages/studio/bunfig.toml` (`lines = 0.958, functions = 0.941`); every changed line is exercised below, and no ratchet is expected from a deleted line.

- `packages/server/tests/extension-catalog.test.ts`:
  - `describe("the first-party half")`, new "an extension only this host resolves is bundled": in an empty project, the `@jxsuite/parser` entry has `bundled: true` and `installed: false` (the compiler's own graph resolves the workspace package, as the `probeExtension` host test relies on).
  - "a first-party package installed in the project is not duplicated" also asserts `rows[0]?.bundled` is undefined.
  - "a dependency exporting a manifest is offered with its own sections" also asserts `entry?.bundled` is undefined.
- `packages/studio/tests/cloud-platform.test.ts`, `describe("formats (session backend registry)")`: rename "listExtensionCatalog asks the gateway and marks everything bundled" to "listExtensionCatalog offers what the gateway bundles, installed as declared and nothing bundled"; give the feed entry `bundled: true` in the mocked gateway body; assert every entry's `bundled` is `false` (fails today) and keep the two `installed` assertions and the `/catalog` call.
- `packages/studio/tests/extensions-section.test.ts`:
  - `describe("turning one on")`, new "a catalogue entry enables under its name, whatever else the backend sends": `mount({ extensions: [] }, [{ ...PARSER, installed: true, specifier: "./vendor/parser" }])`, flip the `@jxsuite/parser` row, assert `written(state)?.extensions` equals `["@jxsuite/parser"]` (today it writes the path).
  - `describe("an enabled extension is described by what the backend resolved")`, new "a relative-path extension is described by its manifest and is not broken": `mount({ extensions: ["./extensions/guestbook"] }, [])`, `setExtensions([{ contributions: [{ className: "Guest", project: { key: "guestbook" } }], name: "@acme/guestbook", specifier: "./extensions/guestbook", title: "Guestbook" }])`, `redraw()`; the row for `./extensions/guestbook` has no `data-broken`, its title contains "Guestbook" and its section reads `guestbook` (today: broken, titled with the path, no section).
  - "an extension project.json names but nothing describes still gets a row" is unchanged and still passes (a missing payload entry keeps the old answer).
- The existing "a bundled entry says it needs no install" and "a bundled extension is enabled without installing" keep covering the dev-server and desktop path.

## Specs & docs

`specs/extensions.md` §9.2:

- Delete the Partial marker (line 483).
- Table: delete the `specifier` row. `bundled` reads "THIS host resolves it and the project does not, so enabling it needs no install." Add after `source`: ``| `docs` | `string` | Documentation link, for a first-party entry. |``.
- After the table, add: "Every entry enables under its `name`. A bare `extensions` entry must equal its manifest's `name`, so a linked or path-installed package enables under its package name too; the one entry that differs, a relative path (§3), is the project's own code rather than something a host offers."
- "Three rules make it correct rather than merely convenient." becomes "Four rules …".
- Replace the "**`bundled` and `installed` are probed, never declared.**" paragraph with:

  > **`bundled` and `installed` answer for the build that will load the package.** What a packaged application stages and what a Worker bundles are facts about a build, not about this repository, so no list can carry them. A host that builds the project where it runs answers both by resolving `<name>/jx-extension.json` the way §6.1 says a host resolves it: `installed` when the project resolves it, `bundled` when the host does and the project does not. A host whose project is built somewhere else cannot see that build's resolution, so it reports `installed` as the project's `package.json` declaration, which is what that build installs from, and reports nothing `bundled`, because a package only its own session can load would fail the build. The cloud session is such a host: its Worker bundles a fixed set of packages (§5.5) and resolves no modules, and the deployed site is built from the repository, so enabling an extension there declares its package before it writes `extensions`.

  Under the first Open's alternative, the last two sentences become: "The cloud session is such a host, and its deploy build ships the packages its Worker bundles (§5.5), so every entry it offers is `bundled` and `installed` is the declaration."

- Fragment: `bun run spec:change extensions.md minor -m "The extension catalogue drops the specifier key and lists docs, reports bundled only when the project lacks the package, and has a host whose project builds elsewhere report installed as the package.json declaration and nothing bundled."`

Docs (no em dashes):

- `docs/extending/embedding/platform-adapter.md` (describes the member; not named by `docs:sync`): line 94's "and mark each entry with `bundled` when your host resolves the package without a project install and `installed` when the project resolves it." becomes "and mark each entry with `bundled` when your host resolves the package and the project does not, and `installed` when the project resolves it. If your project is built somewhere else, as a Worker's is, report `installed` from the project's `package.json` and never report `bundled`: the build that loads the package installs it from there."
- `docs/studio/projects/settings.md` (`code:` lists `extension-rows.ts` and `extensions-section.ts`): the **Named in project.json** bullet (line 120) becomes "**Named in project.json** lists anything your configuration enables that is not offered above, such as an extension in a folder of your own project. You can still turn those off, which is what you usually want." The rest of the Extensions section still holds.
- Named by `docs:sync`, no change: `docs/extending/embedding/backend-protocol.md` (`types.ts`; says nothing about the catalogue) and `docs/extending/extensions/first-party.md` (the `@docs` tag in `extension-catalog.ts`; lists what each extension contributes). No page cites `extensions.md#9.2`.

`extensions.md` does not graduate: §3, §5.4, §6.1, §7 and others stay open.

## Acceptance

- `cd packages/server && bun test --isolate --coverage` and `cd packages/studio && bun test --isolate --coverage` pass at their thresholds; `bun scripts/check-coverage-manifest.ts packages/server` and `packages/studio` pass; `bun run typecheck` passes.
- The cloud test and both new `extensions-section` cases fail against the current tree.
- `grep -n "specifier" specs/extensions.md` finds nothing in §9.2; `grep -rn "entry.specifier" packages/studio/src` finds nothing.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec extensions` no longer lists §9.2.
- In a cloud session on a starter that declares only `@jxsuite/parser`, turning on Feed writes `@jxsuite/feed` to `package.json` and then to `project.json`; on the dev server, the same row in a project without the package says "Ships with this backend, so it needs no install." when the host resolves it.
