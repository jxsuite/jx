---
status: drafted
disposition: implement
claims:
  - extensions.md#10
requires: []
workspaces:
  - packages/studio
  - packages/ui
  - extensions/parser
  - scripts
size: M
---

# The file tree and the palette draw the kit glyph a format class declares

## Context

`specs/extensions.md` §10, line 517:

> **Status: Partial.** `modes`, `documentMode`, `newFileTemplate`, `elements` and `stateDefaults` ship (`packages/studio/src/tabs/tab.ts`, `packages/studio/src/files/files.ts`, `packages/studio/src/format/constraints.ts`, `packages/studio/src/panels/signals-panel.ts`). `icon` is carried to the studio (`StudioFormatHints`, `packages/studio/src/format/format-host.ts`) and drawn nowhere: the file tree (`fileIconName`, `packages/studio/src/files/files.ts`) and quick search (`fileIcon`, `packages/studio/src/panels/quick-search.ts`) choose glyphs by extension, so the `markdown` and `table` icons `Markdown` and `Csv` declare never appear.

Verified on 2026-09-27, with one correction that changes the design: **neither declared name is a glyph the kit ships.**

- Delivery works. `FormatEntry.studio` (`packages/schema/src/format-registry.ts`) carries `$studio`, both hosts serve it as `studio` (`packages/server/src/studio-api.ts`, `packages/desktop/src/project-session.ts`), and `StudioFormatHints.icon` types it.
- `fileIconName` (`packages/studio/src/files/files.ts`, module-private) maps `css`/`js`/`json`/`ts` to `file-code`, `md` to `file-text`, images to `image`, else `file`. `fileIcon` (`packages/studio/src/panels/quick-search.ts`) returns `file-code` for `.json`, `file-text` for any extension `formatByExtension` claims, else `file`. Both hand the key to `jx-icon` through `surfaces/files-panel.json` and `surfaces/palette.json`.
- The kit's manifest (`packages/ui/icons/list.json`, 104 Phosphor names, read through `ICON_NAMES`/`hasIcon` in `packages/ui/src/icons.ts`) has neither `markdown` nor `table`. `table` is a Phosphor asset and could be listed; `markdown` is not a Phosphor name at all (`markdown-logo`, `file-md` and `file-csv` are). Drawing the hint as declared today would draw nothing and warn once, which is worse than the extension glyph.
- The extension-contributed **settings** icons (`lock-simple`, `database`, `rows`, `grid-four`, `magnifying-glass`) all resolve. Nothing holds any extension-declared name to the manifest: `packages/studio/scripts/check-icons.ts` gates rail panel keys only, and `settings-document.test.ts` gates built-in settings sections only.
- `loadProject` starts `loadFormats()` without awaiting it and then awaits `loadDirectory(".")`, so the tree's first paint can beat the registry.
- `docs/extending/extensions/formats.md` already promises "`icon`: file icon in the Files panel", and quotes `"icon": "markdown"`.

extensions.md §9.1's settings `icon` shares the open rule (what a declared name must be, what draws when it names nothing). The census left it to whichever plan was detailed first; this one decides it, and `plan:extensions/settings-section-vocabulary` may rely on it.

## Outcome

- extensions.md §10 → Implemented: the file tree and the palette's file rows draw the claiming format's `$studio.icon`, first-party classes declare names the kit ships, and the rule for any extension-declared glyph name is stated.

## Decisions

- **Decided:** an extension-declared icon is a key into the kit's glyph manifest (`@jxsuite/ui/icons`), resolved with `hasIcon`, never an element tag, because it is the key space studio.md §13.5 describes and extensions.md §9.1's row already states for settings sections.
- **Decided:** a name the kit does not ship is treated as undeclared (a file row keeps the glyph it draws today; the settings nav draws nothing, as §9.1 already says), with one console warning per name, because a file row must never lose its glyph and a third-party author has no other signal. The registry build does not check names: `@jxsuite/schema` cannot see the kit (`@jxsuite/ui` depends on `@jxsuite/schema`), and no host other than the studio draws a glyph.
- **Decided:** first-party declarations are gated by `check-icons.ts` walking `extensions/*/src/**/*.class.json` for `$studio.icon` and `$studio.settings.icon`, because the fallback makes a miss look deliberate (exactly how `markdown` went unnoticed), and that script's own criterion is that a silent miss is the one enforced.
- **Open:** which glyphs the parser's classes declare. Recommendation: `file-md` for `Markdown` and `file-csv` for `Csv`, both added to the kit's list, because the hint is documented as a file icon and these sit in one family with the tree's `file-code`, `file-text` and `file`. The alternative is `markdown-logo` and `table` (Csv's value unchanged); either needs the kit's list edited, since `markdown` names nothing.
- **Decided:** the lookup lives in `format-host.ts` (`declaredGlyph`, `formatIcon`) and each picker consults it first, keeping its own extension map as the fallback, because `quick-search.test.ts` mocks `files/files.js` down to `openFileInTab`, and `format-host.ts` already serves the §9 extensions payload the settings nav reads.
- **Decided:** where two classes claim one extension, the first in registry order whose declared name resolves is drawn, because §7 lets two classes share an extension with disjoint capabilities and registry order is the order every other lookup uses.
- **Decided:** `loadDirectory` fetches the registry with the listing, for the reason it already fetches the ignore rules with it: a first paint that beats the registry would draw `file-text` and nothing repaints the row when the registry lands.
- **Decided:** `affected.ts` applies every `EXTRA_EDGES` entry a path matches, not the first, because `extensions/*/src/*.class.json` already matches the catalogue edge: under today's `EXTRA_EDGES.find` a Studio edge for the same files never fires, and for the same reason a descriptor edit already skips the schema edge's class-drift test. The accepted costs: this pull request edits `scripts/ci/**` (`GLOBAL`), so it runs the full matrix once, and every later descriptor edit adds Studio's suite and the `lens-mutants` job (`edgeTargets.has("packages/studio")`).
- **Decided:** `packages/schema/defs/class-def.schema.ts` keeps `icon: { type: "string" }` without a description, because a description regenerates the core schemas and re-runs every workspace downstream of `packages/schema` for a hover string; §10 and the formats docs page carry the rule.

## Implementation

1. **`packages/ui/icons/list.json`** (as the Open decision lands): add `"file-csv": ["regular"]` and `"file-md": ["regular"]` in sorted position, then `bun run --cwd packages/ui build:icons` to rewrite `icons/manifest.json`. Nothing else in the kit changes.
2. **`extensions/parser/src/Markdown.class.json`**: `$studio.icon` `"markdown"` → `"file-md"`. **`extensions/parser/src/Csv.class.json`**: `"table"` → `"file-csv"`. **`packages/studio/tests/format-fixture.ts`**: `CSV_FORMAT.studio.icon` follows (`"file-csv"`); `MARKDOWN_FORMAT` reads the class and needs nothing.
3. **`packages/studio/src/format/format-host.ts`**:
   - `import { hasIcon } from "@jxsuite/ui/icons";` (the manifest is already in the bundle through `jx-icon`).
   - `export function declaredGlyph(name: unknown, owner: string): string | undefined`: undefined, silently, for a non-string or empty value; the name when `hasIcon(name)`; otherwise one `console.warn` per name (module-level `Set`), `` `${owner} declares icon "${name}", which the Jx UI kit does not ship; drawing the default glyph (extensions.md §10)` ``, and undefined. Doc comment cites extensions.md §10 and §9.1.
   - `export function formatIcon(path: string): string | undefined`: take the extension after the last `.` of the last path segment (the tree passes `row.path`, so `pages.v2/readme` has none; lower-cased, as `formatByExtension` does; undefined with no dot), then walk `_formats` in order and return the first ``declaredGlyph(f.studio?.icon, `Format "${f.name}"`)`` among the classes whose `extensions` include it. Never answers `.json`, which no registry claims. Tag its doc comment `@docs extending/extensions/formats`.
   - `StudioFormatHints.icon` gains a doc comment: a kit glyph name, drawn by `formatIcon`.
4. **`packages/studio/src/files/files.ts`**:
   - `fileIconName`: after the directory branch, `const declared = formatIcon(name); if (declared) return declared;`, then the existing switch unchanged. Its doc comment adds that a claimed file draws its format's declared glyph first.
   - `loadDirectory`: `Promise.all([platform.listDirectory(dirPath), ensureIgnoreLayers(dirPath), loadFormats()])`, and the comment above it names both reasons. `loadFormats` is memoised and never rejects.
5. **`packages/studio/src/panels/quick-search.ts`**, `fileIcon`: after the `.json` branch, `const declared = formatIcon(name); if (declared) return declared;`; import `formatIcon`; the doc comment becomes "The kit glyph a file row draws: its format's declared glyph, then by extension."
6. **`packages/studio/scripts/check-icons.ts`**:
   - `export function extensionIconKeys(root: string): Map<string, string>`: for every `*/src/**/*.class.json` under `root`, `JSON.parse` it and record `$studio.icon` and `$studio.settings.icon` when they are strings, keyed by where (`parser/src/Markdown.class.json $studio.icon`) with the name as value, since two classes may declare one name.
   - `iconProblems` input gains `declared: Map<string, string>` (where → name); each name absent from `rows` yields `` `${where} declares icon "${name}" and the kit's icon manifest has no glyph of that name — the studio draws its default glyph instead (add it to packages/ui/icons/list.json and run build:icons, or name a glyph the manifest has)` ``, sorted by where.
   - `checkIcons` reads `extensionIconKeys(join(STUDIO, "..", "..", "extensions"))` and returns `extensionKeyCount`; `report(problems, tagCount, keyCount, extensionKeyCount)` prints `N extension key(s) resolved` on success.
   - The file docstring and `iconKeysDeclared`'s ("a settings section's is documented as reserved and read by nobody") say that extension-declared keys are now enforced by their own walk, because their miss is silent behind a fallback; built-in settings sections stay with `settings-document.test.ts`.
7. **`scripts/ci/affected.ts`**:
   - `decide`: `const edge = EXTRA_EDGES.find(...)` becomes `const hits = EXTRA_EDGES.filter((e) => matches(path, e.patterns))`; the seed loop runs over every hit, and the later `if (edge || matches(path, NO_TESTS))` reads `hits.length > 0`. The comment above it says a path may trigger several edges (a class descriptor is read by the catalogue, schema's drift test and Studio).
   - `EXTRA_EDGES` gains `{ patterns: ["extensions/*/src/**/*.class.json"], seeds: ["packages/studio"], evidence: ["packages/studio/tests/icons.test.ts", "packages/studio/tests/format-fixture.ts"], why: "Studio's icon check walks every extension class for the glyph names it declares, and its format fixture reads the parser's Markdown class, so editing a class descriptor has to re-run Studio's suite. Scoped to descriptors: an extension's code is not read." }`. Nothing depends on the order of the list any more.

8. **Plan housekeeping in the landing pull request.** Delete this file, remove `extensions/format-icon-hint` from `plan:extensions/settings-section-vocabulary`'s `requires` (re-reading its steps 2 and 9 against the landed wording), and reword every remaining `plan:extensions/format-icon-hint` citation in a plan that has not landed to cite extensions.md §10 (`grep -rn 'plan:extensions/format-icon-hint' plans/`; `plans:check` reports each as `citation-unknown`).

**Integration contract.** Once this lands: a change to any `extensions/*/src/**/*.class.json` re-runs Studio's suite, and `format-host.ts` exports `declaredGlyph(name, owner)`, which returns a name the kit ships and otherwise undefined with one warning per name, and `formatIcon(path)`. A §9.1 settings nav may draw ``declaredGlyph(section.icon, `Section "${label}"`)`` and needs no new gate: `check-icons.ts` already holds every first-party `$studio.settings.icon` to the manifest. extensions.md §10 states the rule (a kit glyph name; an unknown name is treated as undeclared; the registry does not check it) for §9.1's row to cite.

## Tests

- **`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`):
  - New `tests/format-icon.test.ts` (`setFormats` fixtures, `console.warn` spied; each case uses its own unknown name, since the warn-once set is module state): `declaredGlyph answers a name the kit ships` (`file-md`); `declaredGlyph treats a name the kit lacks as undeclared and warns once` (two calls, one warning naming owner and name); `declaredGlyph ignores a missing, empty or non-string value silently`; `formatIcon answers the first claiming format whose glyph resolves` (two classes on `.md`, the first declaring an unknown name); `formatIcon matches the extension case-insensitively` (`README.MD`); `formatIcon is undefined for .json, an unclaimed extension and a name with no dot`.
  - `tests/files-tree.test.ts`: "file-type icons match extensions" becomes `a claimed file draws its format's glyph; others match extensions; folders track expansion`, with `beta.md` → `file-md` (the fixture reads the real class). New: `a declared name the kit does not ship draws the extension glyph` (`studio.icon: "markdown"` → `file-text`); `the registry is fetched with the listing` (`refreshFormats()`, `installFsPlatform` whose `listFormats` returns `CSV_FORMAT`, a seeded `data.csv`, then one `loadDirectory` and mount: the row draws `file-csv`).
  - `tests/quick-search.test.ts`: `file icons follow the extension` keeps its three rows (its `MARKDOWN_FORMAT` has `studio: null`). New: `a file row draws the glyph its format declares` (`studio: { icon: "file-md" }`, `hello` → `file-md`) and `an unknown declared glyph keeps the claimed-file glyph` (`file-text`).
  - `tests/icons.test.ts`: `extension keys are read from $studio.icon and $studio.settings.icon` (temp dir, one class with both, one with neither, one non-class JSON); `THE §10 REGRESSION: an extension key the manifest lacks names the class and the fallback` (`declared: new Map([["parser/src/Markdown.class.json $studio.icon", "markdown"]])`); `base` gains `declared`; "it actually read the tree" also expects `extensionKeyCount` above 5; the `report` case passes and asserts the fourth count.
  - Three suites double `format-host.js` with `mock.module` (`entry-seed`, `project-config`, `grid-open`); each already supplies `loadFormats` and none draws a file row, so none needs `formatIcon`. A suite that doubles it and mounts the tree must add it.
  - Coverage: thresholds are `lines = 0.958, functions = 0.941` per file (`packages/studio/bunfig.toml`); every new function is reached, and `scripts/check-icons.ts` stays fully exercised through the fixture cases. One new test file and no new source file, so the manifest check is unaffected.
- **`packages/ui`**: no new case; `tests/icons-build.test.ts` ("carries every name and weight the list asks for") and `tests/icons.test.ts` prove the regenerated manifest. **`extensions/parser`**: `capability-introspection.test.ts` asserts `$studio.elements` only, nothing asserts `$studio.icon`; its suite re-runs unchanged.
- **`scripts`** (`bun test --isolate scripts`), `ci/affected.test.ts`: new `a class descriptor retests every suite that reads it, each through its own edge`: `flagsFor("extensions/search/src/SearchIndex.class.json")` contains `catalog`, `schema`, `search` and `studio` (fails today: only the catalogue edge fires), and `decide([...]).lensMutants` is true for it. The existing extension cases (`extensions/search/src/index.ts` → `["schema", "search"]`) stay green unchanged. The evidence anchors are `existsSync`-checked in the `changes` job.

## Specs & docs

**`specs/extensions.md` §10**, in place:

- The marker becomes `> **Status: Implemented.**`.
- After the "Unchanged from v1" paragraph, a new paragraph: "**`icon` names a glyph, and every file row draws it.** The value is a glyph name from the Jx UI kit's icon set (`@jxsuite/ui/icons`), the key space §9.1's settings `icon` uses, never an element tag. The studio's file tree and its palette's file rows draw it for a file whose extension the class claims; where two classes claim the extension, the first in registry order whose name the kit ships is drawn. A name the kit does not ship is treated as undeclared: the row keeps the glyph the studio draws for a file with no hint, and the studio warns once per name. The registry build does not check the name, since the registry is host-agnostic and the kit is the studio's; first-party classes are held to the kit's manifest by the studio's icon check (`packages/studio/scripts/check-icons.ts`)."

Fragment: `bun run spec:change extensions.md minor -m "§10: the studio's file tree and palette draw the icon a format class declares; icon is a glyph name from the Jx UI kit, and a name the kit does not ship is treated as undeclared"`.

**Docs** (no em dashes). `bun run docs:sync` names these pages; what changes in each:

- `docs/extending/extensions/formats.md` (`spec:` extensions.md#10): the `$studio` example's `"icon": "markdown"` becomes `"icon": "file-md"`, matching the class it quotes. The `icon` bullet becomes "`icon`: the glyph Studio draws for your files in the Files panel and in Quick Access. It names a glyph the [Jx UI kit](/docs/extending/ui-kit#draw-an-icon) ships, not an element. A name the kit doesn't ship is ignored, and your files keep the default file glyph." `code:` gains `packages/studio/src/format/format-host.ts`.
- `docs/extending/extensions/tutorial-toml-format.md` (`code:` both class files): "(add a `$studio` block to the descriptor to refine its icon and editing modes)" becomes "(add a `$studio` block to the descriptor to give its files a glyph from the Jx UI kit and choose its editing modes)".
- Checked, no change: `docs/studio/interface.md`, `docs/studio/interface/quick-access.md` and `docs/studio/interface/tabs.md` (they list `files.ts`, `quick-search.ts` or `format-host.ts` but describe no row glyph), `docs/extending/extensions/classes.md` (already says only that Studio shows format icons from the descriptor), `docs/extending/extensions/capabilities.md` (lists `Markdown.class.json` and says nothing about icons), `docs/extending/ui-kit.md` (its `icons/list.json` paragraph stays true), `docs/extending/contributing/monorepo.md` (describes edges generically). `specs/studio.md` §13.5 describes the key rule generally ("the resolver that is enforced is the one whose miss is SILENT") and stays true of the new walk; its table row is `plan:studio/panel-scheduler-text`'s.

No spec graduates: extensions.md keeps other open items.

## Acceptance

- `bun run plans:status --spec extensions` no longer lists `extensions.md#10`; `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
- `bun --cwd packages/studio scripts/check-icons.ts` exits 0 and reports seven extension keys; with `Markdown.class.json`'s icon set back to `"markdown"` it exits 1 naming `parser/src/Markdown.class.json $studio.icon`.
- `git grep -n -e '"icon": "markdown"' -e '"icon": "table"' -- extensions docs packages` prints nothing.
- `bun test --isolate --coverage` passes from `packages/studio`, `packages/ui` and `extensions/parser` with no per-file threshold failure, `bun scripts/check-coverage-manifest.ts packages/studio` passes, and `bun test --isolate scripts` passes.
- `echo extensions/parser/src/Csv.class.json | bun scripts/ci/affected.ts --stdin` names `packages/catalog`, `packages/schema` and `packages/studio` among the edge reasons.
- By hand, in Studio on a project that enables `@jxsuite/parser`: `.md` rows draw `file-md` and `.csv` rows `file-csv` on the first paint after opening the project, and the palette's file rows (⌘P) match. The screenshots lane re-captures the shots that show the Files tree; review the changed images and the pages it lists.
