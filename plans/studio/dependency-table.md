---
status: drafted
disposition: reconcile
claims:
  - studio.md#11
requires: []
workspaces:
  - packages/studio
size: S
---

# The Dependencies table lists what Studio is built from, and a check keeps it that way

## Context

`specs/studio.md` §11, line 1255 (the section was unmarked before the census):

> **Status: Partial.** The table is stale. `yaml` is declared in `packages/studio/package.json` but imported by nothing in `src`, `unified` and `remark-*` reach Studio only through `@jxsuite/markup`, and format parsing runs behind the PAL (`src/format/format-host.ts`); runtime dependencies such as `tabulator-tables`, `@vue/reactivity`, `ajv`, `@jxsuite/collab`, `@jxsuite/ai`, `@jxsuite/schema` and `@jxsuite/site` are missing from it.

The table has seven rows. Two of them (`yaml`, `unified` / `remark-*`) describe nothing Studio declares or imports, and eleven declared packages have no row. Disposition `reconcile`: the code is right, because Studio holding no format knowledge is studio.md §8.1's rule.

**What exists** (verified against the tree on 2026-09-27; paths under `packages/studio/`)

- `package.json` `dependencies`, 19 keys: `@atlaskit/pragmatic-drag-and-drop`, `@atlaskit/pragmatic-drag-and-drop-hitbox`, `@jxsuite/ai`, `collab`, `create`, `formulas`, `markup`, `protocol`, `runtime`, `schema`, `site`, `ui`, `@vue/reactivity` (exact pin, with a `//vue-reactivity` note), `ajv`, `ajv-formats`, `lit-html`, `monaco-editor`, `tabulator-tables`, `yaml`. There are no peer or optional dependencies.
- `yaml` is imported by nothing in `src`, `tests`, `scripts` or `evals`. The string appears only as a Monaco language id (`src/services/model-uri.ts`, lines 98 to 100). YAML and Markdown parsing belong to `@jxsuite/parser` (`extensions/parser/package.json` declares `yaml`, `unified` and `remark-*`), and Studio's own `unified` use is inside `@jxsuite/markup`.
- What each package is for, from its import sites:
  - `@jxsuite/markup`: `htmlToJx` for paste (`src/editor/context-menu.ts`) and `markdownToHtml` for the assistant's replies (`src/panels/ai-chat/chat-markdown.ts`).
  - `@jxsuite/create`: only `updateWranglerConfig` from `@jxsuite/create/scaffold` (`src/publish/pages-service.ts`).
  - `@jxsuite/formulas`: the packaged catalogue (`src/ui/formula-catalog.ts`).
  - `@jxsuite/site`: `buildSiteStyleCSS` (`src/canvas/iframe-render.ts`) and the route patterns (`src/page-params.ts`).
  - `@jxsuite/protocol`: the wire types, `LOCATION_ID_FILE`, and the Problem Details readers (`src/platform-errors.ts`, `src/platforms/*.ts`).
  - `@jxsuite/collab`: negotiation and the WebSocket client (`src/platforms/*.ts`), the provider loaded on demand (`src/collab/collab-session.ts`), the Monaco binding, and `diff-core` for change review (`src/canvas/diff-marks.ts`).
  - `ajv` and `ajv-formats`: loaded on demand by `src/services/jx-validate.ts` for the assistant's writes, format conversion and Settings edits to `project.json`.
  - `tabulator-tables`: `src/grid/grid-view.ts` only, reached through `src/grid/grid-lazy.ts`.
- **Found while detailing:**
  - Two surviving rows understate. `@atlaskit/pragmatic-drag-and-drop` is not only "Layer tree drag-and-drop": eight modules use it (`src/panels/dnd.ts`, `tab-strip.ts`, `tab-drop.ts`, `pane-grid.ts`, `block-action-bar.ts`, `statement-editor.ts`, `canvas-dnd-bridge.ts`, `src/files/files.ts`). `lit-html`'s set of render roots is bounded by `LIT_TEMPLATE_AUTHORS` in `scripts/check-lit-conventions.ts`, not by a list in prose (`studio-ui-guidelines.md` §9.3).
  - studio.md §11.2 (line 1310) says a dependency on `@jxsuite/server` "would put the compiler, the scaffolder and the starters into every studio install". Studio already installs the scaffolder and the starters: `@jxsuite/create` depends on `@jxsuite/starters`, whose published `sites/` is about 30 MB. What the server would add is `@jxsuite/compiler`, `@jxsuite/import`, `@jxsuite/catalog` and its own libraries. The header of `scripts/check-studio-package.ts` (rule 3, line 21) repeats the claim.
  - `yjs` is imported type-only (`src/collab/monaco-binding.ts`, `src/canvas/canvas-render.ts`) and is not declared. The import erases at build, and the runtime copy arrives through `@jxsuite/collab`.
- The editorial ride-along the audit record assigns here: studio.md §1 (line 14) says Adobe Spectrum Web Components remain "for the surfaces that have not yet migrated". None remain. `studio-ui-guidelines.md` §1 and §6.1 record the removal and the ban, and `package.json` carries no Spectrum package.
- The precedent for a gate: `guidelineTokenFindings` in `scripts/check-styles.ts` holds `studio-ui-guidelines.md` §1.1's token table to `tokens.css`. Its docblock says why: "Correcting them without a gate only resets the clock, which is why the correction and the check land together."

## Outcome

- studio.md §11 → Implemented (reconciled). The table has one entry for each `dependencies` key, each saying what Studio uses the package for. `scripts/check-studio-package.ts` fails when the table and `package.json` disagree.
- `yaml` is no longer declared.
- Ride-alongs: §1 no longer says Spectrum draws anything, and §11.2 no longer counts the scaffolder and the starters among what a server dependency would add.

## Decisions

- **Decided:** keep the section as a table, with one row per `dependencies` key. Closely related packages may share a row (the two `@atlaskit` packages, `ajv` with `ajv-formats`). The table leaves out `devDependencies` and type-only imports of undeclared transitive packages (`yjs`). The reason is that `package.json` already lists the names, and the purpose column is the part only the spec can say. A devDependency ships nothing, and a type-only import erases at build.
- **Decided:** drop `yaml` from `dependencies`. Nothing in the package imports it, and a row for it could only say "unused". The cost is a `bun.lock` edit, which is in `affected.ts`'s GLOBAL list, so the landing pull request runs the full matrix once. `yaml` stays in the lockfile through `@jxsuite/parser`, so the package set and `bun.nix` do not change.
- **Decided:** the check reads the live spec only from the script's CLI entry point, which the ungated `checks` job runs on every pull request (`.github/workflows/test.yml`, line 316). The studio suite drives the rule with fixture strings. `specs/**` is `NO_TESTS` in `scripts/ci/affected.ts`, so a pull request that edits only §11 never runs the studio suite, but it does run `checks`. A suite that read `specs/studio.md` would also need an `EXTRA_EDGES` entry that reruns all of Studio for every edit to the spec.
- **Open:** does the rewrite land with the gate? Recommendation: yes, as a fifth rule in `scripts/check-studio-package.ts`, because this table went stale without anyone noticing, which is the failure the `check-styles.ts` precedent was built for. The cost: adding or removing a Studio dependency also edits §11, which is a body change and so needs a spec fragment. Dependabot bumps change only versions, never keys, so the dependency autopilot never trips the rule. If this is declined, drop Implementation step 3 and its tests, and the marker loses its last clause.
- **Open:** should §11.2 be corrected, or should Studio stop installing `@jxsuite/starters`? Recommendation: correct §11.2's sentence (and the matching comment in the script) and keep the `@jxsuite/create` dependency. The reasoning:
  - The layering reason §11.2 gives (the abstraction must not depend on an implementation) is unaffected.
  - Moving `scaffold.ts`'s wrangler helpers out of `@jxsuite/create` is a package-boundary change with a second consumer, `packages/compiler/src/site/db-push.ts`, which imports `applyBindingFragments` from the same module. That is not a reconcile.
  - The corrected sentence names the footprint, so the cost is written down rather than denied.

## Implementation

1. **`packages/studio/package.json`**: remove `"yaml": "^2.9.1"` from `dependencies`, then run `bun install`.
   - The only `bun.lock` change is the `yaml` line under the `packages/studio` workspace entry (line 358).
   - Confirm that `head -2 bun.lock` still reads `"lockfileVersion": 1` (`scripts/dependabot-config.test.ts` asserts it).
   - Confirm that `bun run nix:check` reports no drift.
2. **The spec rewrite** (text under Specs & docs): §11's marker and table, §1's sentence, and §11.2's sentence.
3. **`packages/studio/scripts/check-studio-package.ts`** (subject to the first Open decision):
   - Export `STUDIO_SPEC = resolve(PKG_DIR, "..", "..", "specs", "studio.md")`.
   - Export `dependencyTable(specMd: string): string[] | null`. It finds the line matching `/^## 11\. /m`, stops at the next line matching `/^#{1,3} /`, and returns every backtick span in the first cell of each `|` row in between. It returns `null` when the heading is missing. Header and separator rows have no backtick span, so they contribute nothing. Backticks in the purpose column are never read.
   - Export `dependencyTableDrift(specMd: string, dependencies: Record<string, string>): Problem[]` with `rule: "dependencies"`:
     - A heading that is missing, or a section that parses to zero names, gives one problem: "studio.md §11's table parsed to no packages; the table moved, and this rule stopped checking anything". This is the zero-row guard `guidelineTokenFindings` uses.
     - A declared key the table lacks gives "package.json declares X, which studio.md §11 does not list; add a row saying what Studio uses it for".
     - A listed name that is not declared gives "studio.md §11 lists X, which package.json does not declare".
   - `analyze(root = PKG_DIR, specMd?: string)` appends `dependencyTableDrift(specMd, pkg.dependencies ?? {})` when `specMd` is given. With no argument its behaviour is unchanged, so `tests/check-studio-package.test.ts`'s real-tree assertion reads nothing outside the workspace.
   - The `import.meta.main` block calls `analyze(PKG_DIR, readFileSync(STUDIO_SPEC, "utf8"))`. A missing spec throws, and the job goes red. The block stays three statements.
   - `report([])`'s clean line gains "studio.md §11 lists every dependency".
   - The header comment says "Five rules" and adds rule 5, "The dependency table is the dependencies", which cites studio.md §11 and the `check-styles.ts` precedent. It also explains why the rule reads the spec only from the CLI.
4. **The same file's header, rule 3** (subject to the second Open decision): "would put compiler, create, import and starters into every studio install" becomes "would put the compiler, the importer and the extension catalogue into every studio install". `BACKEND_PACKAGES` and the rule itself do not change.

No other workspace changes. The desktop and the cloud stage the built bundle, and nothing imports `yaml` through Studio.

**Integration contract.** Once this lands, studio.md §11 is the list of Studio's runtime dependencies. Any pull request that adds or removes a key in `packages/studio/package.json` `dependencies` must edit §11's table in the same pull request and record a spec fragment, or `checks` fails. `dependencyTable`, `dependencyTableDrift` and `STUDIO_SPEC` are exported from `packages/studio/scripts/check-studio-package.ts`, and `analyze(root, specMd?)` keeps its one-argument behaviour. No plan in the index changes Studio's dependency set, and no plan requires this one.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`. The `bun.lock` edit runs every workspace, and none of them has a new case.

- `packages/studio/tests/hosting-stage.test.ts`, `describe("check-studio-package rules")`:
  - "the dependency table must name every dependency, and nothing else": a fixture spec with `## 11. Dependencies`, a header row, a separator, a row ``| `a` | x |`` and a row ``| `b`, `c` | y |``, then `### 11.1 Bundle Layout` followed by a row naming `` `d` ``.
    - With `{ a, b, c }` it returns `[]`, so the row after the next heading is ignored.
    - With `{ a, b, c, e }` it returns one problem naming `e` with "does not list".
    - With `{ a, b }` it returns one problem naming `c` with "does not declare".
  - "a package named in the purpose column is not a row's package": the row ``| `a` | loaded by `b` |`` with `{ a }` returns `[]`.
  - "a table that moved is a finding, not a silent pass": a spec with no `## 11.` heading, and a spec whose §11 has no rows, each return exactly one problem containing "stopped checking anything".
- `packages/studio/tests/check-studio-package.test.ts`:
  - Extend "a clean tree says what it checked, not just that it passed": the clean line contains "studio.md §11 lists every dependency".
  - New in `describe("analyze")`, "a spec handed in is held to the committed manifest":
    - Build a fixture §11 from the real `package.json`'s `dependencies` keys (read from `join(import.meta.dir, "..", "package.json")`, inside the workspace). `analyze(undefined, fixture)` is `[]`.
    - The same fixture without its `monaco-editor` row gives one `dependencies` problem naming `monaco-editor`.
  - "the committed package keeps its own promises" stays `analyze()` with no spec. Update its comment: the spec half is the CI job's, for the reason given in the script's header.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) apply to `scripts/check-studio-package.ts` because the tests import it. Every new function and branch is covered, and the uncovered `import.meta.main` block does not grow, so the file's ratio rises and there is no ratchet to take. No `src/` file is added, so the manifest check needs nothing.

## Specs & docs

- **studio.md §11** (lines 1253 to 1265): the marker and the table are replaced. §11.1 and everything after it are untouched.

  > **Status: Implemented.** The table is the `dependencies` of `packages/studio/package.json`, name for name, and `packages/studio/scripts/check-studio-package.ts` fails when the two disagree.

  Then this paragraph: "What Studio is built from, and what for. Only runtime dependencies are listed: `devDependencies` (the test DOM, the `@webref/*` data `gen:webdata` reads) ship nothing. No format library is here, because Studio holds no format knowledge (§8.1). A Markdown or YAML file opens through the PAL, and its parser belongs to the extension that owns the format."

  Then the table, `| Package | What Studio uses it for |`, in `package.json` order:

  | Package                                                                         | What Studio uses it for                                                                                                                                                           |
  | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `@atlaskit/pragmatic-drag-and-drop`, `@atlaskit/pragmatic-drag-and-drop-hitbox` | Drag and drop: the Outline, the Components and Elements palettes, the Files tree, tabs and panes, the block action bar's handle, and the statement editor                         |
  | `@jxsuite/ai`                                                                   | The assistant: chat state, the streaming client, and the tool registry and write ledger Studio's tools are defined against (`ai.md`)                                              |
  | `@jxsuite/collab`                                                               | Collaboration (the transport negotiation, and the WebSocket client and Yjs provider loaded on demand), the Monaco binding, and the structural diff change review marks with (§21) |
  | `@jxsuite/create`                                                               | The pure scaffolding helpers (`@jxsuite/create/scaffold`): the Pages publish flow patches the project's `wrangler.jsonc` through the PAL                                          |
  | `@jxsuite/formulas`                                                             | The packaged formula catalogue behind the formula palette, chip labels and completions (`spec.md` §19)                                                                            |
  | `@jxsuite/markup`                                                               | HTML-to-Jx conversion for paste, and Markdown rendering for the assistant's replies. Not format parsing (§8.1)                                                                    |
  | `@jxsuite/protocol`                                                             | The PAL's wire types, its route constants, and the Problem Details readers every platform error goes through (§16)                                                                |
  | `@jxsuite/runtime`                                                              | Canvas rendering (§4.1), the chrome's surface documents (`embedding.md`), and the expression vocabulary the formula tools read                                                    |
  | `@jxsuite/schema`                                                               | The document model: types, guards, parsing, layout-preserving JSON (§9.4), document operations, the locale reader (§20.1) and the core JSON Schemas                               |
  | `@jxsuite/site`                                                                 | The site stylesheet the canvas injects (§4.1), and the route patterns that give a page its URL and parameters                                                                     |
  | `@jxsuite/ui`                                                                   | The UI kit: every chrome element, the theme tokens, the icons, and the behaviour loaders the canvas frame registers (`ui.md`)                                                     |
  | `@vue/reactivity`                                                               | Studio's state and every surface's effects. Pinned exactly to `@jxsuite/runtime`'s version, because a proxy one copy made is not tracked by the other                             |
  | `ajv`, `ajv-formats`                                                            | JSON Schema validation of the assistant's writes, format conversion and Settings edits against the project's entry schemas (loaded on demand)                                     |
  | `lit-html`                                                                      | The render roots that still draw with templates, which `scripts/check-lit-conventions.ts` names and only lets shrink (`studio-ui-guidelines.md` §9.3)                             |
  | `monaco-editor`                                                                 | The code editor (loaded on demand, §11.1)                                                                                                                                         |
  | `tabulator-tables`                                                              | The data grid (loaded on demand): collections, connector tables, CSV files and redirects                                                                                          |

- **studio.md §1** (line 14): "…with Adobe Spectrum Web Components remaining for the surfaces that have not yet migrated (`studio-ui-guidelines.md` §1, §9.3)." becomes "…and nothing else: Adobe Spectrum Web Components, which drew it before the kit, are removed and banned (`studio-ui-guidelines.md` §1, §6.1)."
- **studio.md §11.2** (line 1310, subject to the second Open decision): "and would put the compiler, the scaffolder and the starters into every studio install, the cloud's included." becomes "and would put the compiler, the importer and the extension catalogue into every studio install, the cloud's included. (The scaffolder's pure helpers are already a dependency, for the publish flow, and bring `@jxsuite/starters` with them: see §11.)"
- **Fragment:** `bun run spec:change studio.md minor -m "§11 lists every package Studio declares with what it is used for, and check-studio-package fails when the table and package.json disagree; §1 no longer says Spectrum draws any surface, and §11.2 no longer counts the scaffolder among what a server dependency would add."`
- **Docs:** none change.
  - No page's `spec:` cites `studio.md#11` or `studio.md#1`.
  - `docs/extending/embedding/hosting.md` cites `studio.md#11.1` and `#11.2`, but it does not repeat §11.2's install-footprint claim.
  - No page's `code:` lists `packages/studio/package.json`, `scripts/check-studio-package.ts` or either test file, and none of them carries an `@docs` tag.
  - `bun run docs:sync` should name nothing. Record that in the pull request.
- studio.md does not graduate: most of its open items stay open. The landing pull request deletes this file.

## Acceptance

- `bun --cwd packages/studio scripts/check-studio-package.ts` exits 0, and its line includes "studio.md §11 lists every dependency".
- By hand, and then reverted: delete the `tabulator-tables` row from §11 and rerun. The script exits 1 with `[dependencies] package.json declares tabulator-tables…`. Add a row `` `yaml` `` and it names `yaml` as undeclared.
- From `packages/studio`, `bun test --isolate --coverage` is green, with no file below its threshold.
- These pass: `bun scripts/check-coverage-manifest.ts packages/studio`, `bun run typecheck` and `bun run lint`.
- `grep -n '"yaml"' packages/studio/package.json` finds nothing. `head -2 bun.lock` still shows `"lockfileVersion": 1`, and `bun run nix:check` is clean.
- `bun run plans:status --spec studio` no longer lists §11. These pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown`.
- `grep -n "not yet migrated" specs/studio.md` finds nothing.
