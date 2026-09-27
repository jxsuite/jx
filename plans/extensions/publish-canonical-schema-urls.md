---
status: drafted
disposition: implement
claims:
  - extensions.md#5.4
requires: []
workspaces:
  - sites/jxsuite.com
  - scripts
  - specs
  - docs
size: S
---

# Every core schema artifact is served from jxsuite.com at its $id, and a test keeps it that way

## Context

`specs/extensions.md` §5.4, line 194:

> **Status: Partial.** Offline resolution of the committed entry documents, host-first resolution of first-party refs and whole-tree `jx validate` ship (`packages/compiler/src/site/schema-command.ts`, `packages/compiler/src/site/validate-command.ts`). The canonical URLs are not all served: the `copy` map in `sites/jxsuite.com/project.json` publishes `schema/v1`, `schema/project/v1`, `schema/class/v1` and `schema/document/paths/v2`, but not `https://jxsuite.com/schema/project/core/v2` or the `https://jxsuite.com/schema/project/fields/v2` default union, so a client fetching either gets a 404 rather than the shipped default.

The section was unmarked before the census. Its last bullet (line 211) says a client fetching the canonical URLs "(they are served from jxsuite.com)" gets the shipped defaults, which is what makes the §5.3 degradation (under-suggestion, never false errors) hold for a client with no entry document. Re-verified on 2026-09-27:

- **What is served.** `copy` in `sites/jxsuite.com/project.json` has four entries, each writing a `packages/schema` artifact to `schema/<path>/index.json`. The site build copies them verbatim (`cpSync`, step 8 of `buildSite` in `packages/compiler/src/site/site-build.ts`), and GitHub Pages serves a directory's `index.json`. Live, `https://jxsuite.com/schema/v1/`, `schema/project/v1/` and `schema/document/paths/v2/` answer `200 application/json; charset=utf-8`, and the unslashed forms answer a 301 to them. The served `paths/v2` is identical (`jq -S`) to `packages/schema/schemas/document.paths.schema.json`.
- **What 404s.** `https://jxsuite.com/schema/project/fields/v2/` and `schema/project/core/v2/` both return 404. The references that need them:
  - The parser and connector project fragments write `{ "$ref": "https://jxsuite.com/schema/project/fields/v2" }` at field positions: `extensions/parser/schemas/project.fragment.schema.json` line 41 and `extensions/connector/schemas/project.fragment.schema.json` line 66.
  - `project.core.schema.json` does the same twice, at lines 77 and 81.
  - The fields default itself points into core (`https://jxsuite.com/schema/project/core/v2#/$defs/JxFieldSchema` and `#/$defs/RelationshipRef`).

  So serving the field union alone would not be enough: a client resolving it must also reach core.

- **One more unserved `$id`, which the census missed.** `packages/schema/extension-manifest.schema.json` declares `https://jxsuite.com/schema/extension-manifest/v1`, and that URL also 404s. Nothing references it today. It is the seventh core artifact `runSchemaCli` writes and `schema:verify` regenerates.
- **Fragment `$id`s.** The six extension fragments declare `https://jxsuite.com/schema/ext/<extension>/<kind>/v1`, and no tracked JSON references any of them. §5.1 says nothing resolves by these `$id`s. The composer embeds fragments by slug and drops their `$id`s.
- **The shipped defaults already compile standalone.** `validateProjectTree` step 5 (`packages/compiler/src/site/validate-command.ts`) registers `SHIPPED_RESOURCE_SPECIFIERS` (the core, fields and paths defaults) by `$id` and compiles every enabled fragment against them. `bun run schema:validate-all` runs that over every project root. The only missing piece is that the URLs are not served.
- **Nothing guards the map.** No test reads `copy`. The site build proves that each source path exists, but nothing proves that each referenced or declared `$id` has an entry.

Two editorial riders from the census belong to this plan:

- **§4.** The key table's `schemas` row lists `project` and `document` but not `fields`. `fields` is accepted by `extensionManifestSchema` (`packages/schema/defs/extension-manifest.schema.ts`), by `loadExtension` (`packages/schema/src/extension-registry.ts`) and by `composeProjectSchemas` (`packages/schema/src/project-schemas.ts`). The tests "schemas.fields fragments resolve like the other kinds" (`extension-registry.test.ts`) and "a fields fragment contributes its $defs to the field union" (`project-schemas.test.ts`) cover it.
- **§5.3.** The fields row says the entry "adds extension field extras (e.g. connector column shapes)". No `extensions/*/jx-extension.json` declares `schemas.fields`, and a connector project's union (`scripts/screenshots/fixtures/data/project.schema.json`, `$defs.Fields.anyOf`) holds only `JxFieldSchema` and `RelationshipRef`.

## Outcome

- extensions.md §5.4 → Implemented. Every core schema artifact is served from jxsuite.com at its `$id`: the two union defaults, the project core they point into and the extension-manifest schema are added to the four already served. A test fails when a core artifact's `$id`, or a canonical `$ref` in a core artifact or extension fragment, names a path the site does not publish.
- extensions.md §4 and §5.3 (unmarked) state the `schemas.fields` mechanism as shipped, with no marker change.
- extensions.md stays Partial, because other plans own its remaining open items, so nothing graduates.

## Decisions

- **Open:** should `extension-manifest.schema.json` also be published at `https://jxsuite.com/schema/extension-manifest/v1`, so that the rule becomes "every core artifact is served at its `$id`"? Recommendation: yes.
  - The rule is then derived from the tracked artifacts, like `schema:verify`'s file set, so an eighth artifact is held to it on the day it is committed.
  - A third-party author who points a manifest's `$schema` at the declared `$id` currently gets a 404.
  - The cost is one copy entry and one public URL whose contents `schema:verify` already keeps current.
  - If declined, the core-artifact test case exempts that one `$id` by name, citing this reason, and the reference case is unchanged.
- **Decided:** extension fragment `$id`s under `https://jxsuite.com/schema/ext/` are not served, and the check exempts them from the declared-`$id` half. §5.1 makes them a naming convention that nothing resolves, and serving them would put extension-release bytes on a site that deploys on desktop releases. The reference half still covers them: if any shipped schema ever references one by URL, the test fails, which is the right answer.
- **Decided:** publish at `schema/<path>/index.json`, the form the four existing entries use, because GitHub Pages serves a directory's `index.json` as `application/json` (measured above). No redirect or header configuration is needed.
- **Decided:** the check is a static walk over `$ref` strings, not an ajv compile of the served set. Whether the three defaults resolve by `$id` is already proven by `validateProjectTree` step 5 on every project root. What nothing proves is the map from `$id` to served path, and a string walk states exactly that without making a root-level script depend on a hoisted `ajv`.
- **Decided:** the test lives at `scripts/docs/schema-publication.test.ts`.
  - `bun test --isolate scripts` in test.yml's `changes` job picks it up on every pull request, whatever paths changed. This matters because `sites/**` is in `affected.ts`'s `NO_TESTS`, so a copy-map edit reaches no workspace suite that could judge it.
  - Under `scripts/docs/**` (also `NO_TESTS`), adding or editing it costs no matrix run. An unclassified top-level `scripts/*.ts` fails open into the full matrix (`scripts/README.md`, "Surprises").
  - It guards what the jxsuite.com site serves, beside the site's other build-time helpers in `scripts/docs/`.
- **Decided:** no change to when the URLs go live. jxsuite.com publishes the released tree (`.github/workflows/deploy-site.yml`), so the new URLs are served from the next release that deploys the site, as the four existing ones were.

## Implementation

1. **`sites/jxsuite.com/project.json`, `copy`.** Append three entries after the existing four, keeping the file two-space JSON with a trailing newline (`packages/studio/tests/project-config.test.ts` round-trips it as a formatting fixture):

   ```json
   "../../packages/schema/extension-manifest.schema.json": "schema/extension-manifest/v1/index.json",
   "../../packages/schema/schemas/project.core.schema.json": "schema/project/core/v2/index.json",
   "../../packages/schema/schemas/project.fields.schema.json": "schema/project/fields/v2/index.json"
   ```

   Drop the first line if the Open decision is declined. `buildSite` needs no change: step 8 already `mkdirSync`s and `cpSync`s each entry.

2. **New `scripts/docs/schema-publication.test.ts`.** The header comment cites `specs/extensions.md` §5.4 and explains why the file sits in `scripts/docs/`, following the header of `scripts/dependabot-config.test.ts`. Reuse:
   - `candidatePaths()` and `classifySchema()` from `scripts/check-schema-freshness.ts`, which is importable because `main()` sits behind `import.meta.main`. They give every tracked `*schema.json` and its kind (`core` = under `packages/schema/`, `fragment` = `extensions/*/schemas/*`; `entry` documents are skipped because they carry no canonical refs, and `jx validate`'s self-containment check already covers them).
   - Paths relative to the repository root, as the neighbouring script tests use, since the step runs from the root.

   Helpers defined in the file, exported for the unit case:
   - `const CANONICAL = "https://jxsuite.com/schema/"`. The trailing slash keeps the class-descriptor `$id`s (`https://jxsuite.com/schemas/...`) out.
   - `publishedSchemas(copy: Record<string, string>): Map<string, string>` maps each canonical URL to its repo-relative source. It covers every `copy` entry whose destination matches `/^schema\/(.+)\/index\.json$/` and joins the source with `sites/jxsuite.com` through `node:path`'s `join`.
   - `canonicalRefs(node: unknown): string[]` is a recursive walk over objects and arrays. It collects every `$ref` string value starting with `CANONICAL`, strips anything from `#` on, and returns the sorted unique set.

3. **Housekeeping in the landing pull request.** Delete this plan. In `plans/extensions/README.md`, delete two sentences:
   - In the §4 "Verified" bullet: "The key table omits `schemas.fields`, … rides with `plan:extensions/publish-canonical-schema-urls`."
   - In the §5.1–§5.3 bullet: "§5.3's fields row example … beside the §4 `schemas.fields` row."

   Both are closed by the edits below, and `plans:check` would otherwise report dangling citations. No plan requires this one.

**Integration contract.** No plan requires this one. Once it lands:

- Every `packages/schema` artifact's `$id` is served at `https://jxsuite.com/schema/<path>/`, from the released tree.
- A plan that adds a core artifact, or a first-party fragment that references a canonical URL, has to add the copy entry in the same pull request, or `scripts/docs/schema-publication.test.ts` fails. This applies to `plan:extensions/connector-table-paths`'s `TablePathsSource` document fragment, which the walk picks up automatically.
- §4 lists `schemas.fields`. §5.3's fields row says no first-party extension ships a fields fragment, so a plan that ships the first one updates that clause.
- `plan:extensions/connector-table-paths` rewrites the adjacent paths row of the same §5.3 table. Whichever lands second resolves that one-table adjacency, and oxfmt re-pads the table.

## Tests

- **`scripts/docs/schema-publication.test.ts`** runs through `bun test --isolate scripts`, the unconditional step in the `changes` job. It has four cases:
  - `canonicalRefs collects nested canonical refs without their fragments and ignores every other ref`. It uses an inline fixture with a canonical `$ref` carrying `#/$defs/X` at the root, one nested under `anyOf[].items`, a local `#/$defs/y`, an `https://example.com/...` ref, and a `$id` of `https://jxsuite.com/schemas/Foo.class.json`. It asserts exactly the two canonical URLs come back, without fragments, which proves the walk is neither vacuous nor over-eager.
  - `every schema path the copy map publishes serves the document whose $id names it`. For each `publishedSchemas` entry, the source exists and parses, and its `$id` equals the URL. This catches an entry that points a file at the wrong URL.
  - `every core schema artifact is published at its $id`. For each `core` path from `candidatePaths()`, it asserts three things: the `$id` starts with `CANONICAL`, `publishedSchemas` maps that `$id` to this path, and the set is non-empty. The failure message names the file and the copy entry to add. If the Open decision is declined, `extension-manifest/v1` is skipped by name here.
  - `every canonical $ref in a core artifact or an extension fragment names a published schema`. For each `core` and `fragment` path, every `canonicalRefs` URL is a key of `publishedSchemas`, and the failure names the referencing file and the URL. As a regression anchor, the union of all refs contains `https://jxsuite.com/schema/project/fields/v2` and `https://jxsuite.com/schema/project/core/v2`.
- **Workspace suites.** No coverage-workspace source changes, so no `bunfig.toml` threshold moves and the manifest check sees no new file. `scripts/` has no coverage workspace. Editing `sites/jxsuite.com/project.json` seeds `packages/studio` through `affected.ts`'s `sites/*/project.json` edge, so the studio suite (`project-config.test.ts`) runs on the pull request and must pass unchanged.
- **Site build.** `deploy-site.yml`'s `build` job runs on the pull request, because `sites/jxsuite.com/**`, `docs/**` and `specs/**` are in its paths. Its `cpSync` fails if a new source path is wrong.
- **Gates.** `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose`, `docs:markdown` and `plans:check`, all in `checks`.

## Specs & docs

**`specs/extensions.md`**, in place:

- **§5.4.** Replace the Partial blockquote with `> **Status: Implemented.**`, the bare form §8.5 and §13.1 use. In the last bullet (line 211), replace "Where a client fetches the canonical URLs instead (they are served from jxsuite.com), it gets the shipped defaults — degradation is _under-suggestion_ of extension field extras, never false errors." with:

  > Where a client fetches the canonical URLs instead, it gets the shipped defaults — degradation is _under-suggestion_ of extension field extras, never false errors. Every core schema artifact is served from jxsuite.com at its `$id`: the site's `copy` map publishes each one at its `$id`'s path as `index.json`, so `https://jxsuite.com/schema/project/fields/v2`, and the `project/core/v2` resource its members point into, resolve for a client holding no entry document. `scripts/docs/schema-publication.test.ts` fails when a core artifact's `$id`, or a canonical `$ref` in a core artifact or an extension fragment, names a path the map does not publish. First-party fragment `$id`s (`https://jxsuite.com/schema/ext/...`) are not served, because nothing resolves them (§5.1). The site publishes the released tree, so the served copies are the last release's.

  If the Open decision is declined, "Every core schema artifact" becomes "Every core schema artifact but the extension-manifest schema".

- **§4.** In the key table's `schemas` cell, replace "`project` (project.json sections), `document` (document positions)." with "`project` (project.json sections), `document` (document positions), `fields` (a fragment whose `$defs` members join the project's field union, §5.3)." oxfmt re-pads the table.
- **§5.3.** In the fields row's third cell, replace "Entry adds extension field extras (e.g. connector column shapes)." with "Entry adds the `$defs` members of each enabled extension's `schemas.fields` fragment (§4); no first-party extension ships one yet."

**Fragment** (minor, an implement; the §4 and §5.3 riders are editorial and ride along):

```sh
bun run spec:change extensions.md minor -m '§5.4 serves every core schema artifact from jxsuite.com at its $id, the project core and the default field union included, and a test holds each canonical reference a shipped schema makes to a served path; §4 lists the manifest schemas.fields key and §5.3 names it as the source of field extras'
```

The single quotes keep the shell from expanding `$id`.

**Docs** (docs pages ban em dashes). `bun run docs:sync` names `machine-readable.md`, whose `code:` lists `sites/jxsuite.com/project.json`. The pages whose `spec:` cites a touched anchor are `schema-composition.md` (§5.3, §5.4), `anatomy.md` (§4) and `cli.md` (§5.4).

- **`docs/framework/agents/machine-readable.md`**, "The schemas". The table gains three rows after `document/paths/v2`, each linked like the existing rows (drop the manifest row if the Open decision is declined):

  | URL                                                | Validates                                                                                                                    |
  | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `https://jxsuite.com/schema/project/core/v2`       | "The core `project.json` properties, and the `JxFieldSchema` and `RelationshipRef` definitions extension fragments build on" |
  | `https://jxsuite.com/schema/project/fields/v2`     | "A field schema (content frontmatter fields, table columns), referenced by extension fragments and overridden per project"   |
  | `https://jxsuite.com/schema/extension-manifest/v1` | "`jx-extension.json` extension manifests"                                                                                    |

  After "The hosted `$paths` union accepts any extension source shape it cannot see, where your project's generated copy checks the exact set your extensions provide.", add: "The hosted field union likewise holds only the core field shapes and relationship references."

- **`docs/extending/extensions/schema-composition.md`**:
  - In the union table's fields row, "the entry adds extension field extras." becomes "the entry adds the `$defs` of each enabled extension's `schemas.fields` fragment."
  - The validation bullet "Where a client fetches the canonical URLs instead (they are served from jxsuite.com), it gets the shipped defaults." becomes "Where a client fetches the canonical URLs instead, it gets the shipped defaults; [Machine-readable docs](/docs/framework/agents/machine-readable#the-schemas) lists every schema jxsuite.com serves."
- **`docs/extending/extensions/anatomy.md`**: the `schemas` row (line 120) gains ", `fields` (a fragment whose `$defs` join the project's field union)".
- **`docs/framework/build/cli.md`**: no change, because it describes `jx schema` and `jx validate`, not the served URLs.

No spec graduates: extensions.md keeps other open items.

## Acceptance

- `bun test --isolate scripts` passes, and its output lists the four `schema-publication` cases.
- Remove the `project.fields.schema.json` entry from `copy` locally. `bun test --isolate scripts/docs/schema-publication` then fails, naming `https://jxsuite.com/schema/project/fields/v2` and each file that references it (the core artifact, the parser and connector fragments). Put the entry back afterwards.
- `jq -r '.copy[]' sites/jxsuite.com/project.json` prints seven `schema/.../index.json` destinations (six if the Open decision is declined).
- Run `bun run generate:schema && bun run build:parser && bun run build:compiler && bun run --cwd sites/jxsuite.com build`, then `cmp sites/jxsuite.com/dist/schema/project/fields/v2/index.json packages/schema/schemas/project.fields.schema.json`. It exits 0, and likewise for `project/core/v2` and `extension-manifest/v1`.
- After the next release deploys the site, `curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://jxsuite.com/schema/project/fields/v2/` prints `200 application/json; charset=utf-8`. The same holds for `project/core/v2/` and `extension-manifest/v1/`. All three print 404 today.
- `bun run plans:status --spec extensions` no longer lists `extensions.md#5.4`, and `sed -n '/^### 5.4/,/^### 5.5/p' specs/extensions.md | head -3` shows `> **Status: Implemented.**`.
- `bun run plans:check`, `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose` and `docs:markdown` pass.
