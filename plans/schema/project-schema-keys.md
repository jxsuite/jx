---
status: drafted
disposition: reconcile
claims:
  - schema.md#3.2
requires:
  - schema/build-schema-agreement
workspaces:
  - packages/schema
  - scripts
  - specs
  - docs
size: S
---

# schema.md §3.2 lists exactly the keys the core project schema declares

## Context

`specs/schema.md` §3.2, line 115:

> **Status: Partial.** The top-level keys of `projectConfigSchema` (`packages/schema/defs/project-config.schema.ts`) are described and the three language-tag keys carry `LANGUAGE_TAG_PATTERN`, but the list below names a `collections` key the core schema does not declare (content collections are the parser extension's `content` section, `extensions/parser/schemas/project.fragment.schema.json`) and omits the declared `$defs`, `$schema`, `extensions`, `manifest`, `serviceWorker`, `securityTxt`, `images` and `copy`. The pattern does not accept every tag the build accepts: `canonicalizeLocale` (`packages/schema/src/locale.ts`) trims a tag before `Intl.Locale` parses it, so a padded `"en "` builds as `en` and fails `jx validate`. The compiler checks redirect statuses against its own `REDIRECT_HTML_POLICY` (`packages/compiler/src/site/site-build.ts`) rather than importing `REDIRECT_STATUSES`, as §7's RFC 9110 row says it does.

Before the census it read `> **Status: Implemented.** Every declared key is described, and the language-tag keys carry a pattern…`. That held for the pattern, not for the key list below it. The marker's last two sentences are code and close in `plan:schema/build-schema-agreement` (drafted), whose pull request deletes them from the marker; this plan requires it, so by the time it executes the marker is its first sentence alone. Verified at the working tree on 2026-09-27:

- **Declared.** `projectConfigSchema.properties` has twenty keys: `$defs`, `$elements`, `$head`, `$media`, `$schema`, `build`, `copy`, `defaults`, `extensions`, `i18n`, `images`, `imports`, `manifest`, `name`, `redirects`, `securityTxt`, `serviceWorker`, `state`, `style`, `url`. `generateProjectSchema` (`project-schema.json`, `$id` `…/project/v1`) and `generateProjectCoreSchema` (`schemas/project.core.schema.json`, extensions.md §5.1) both use that object verbatim (`packages/schema/src/schema.ts`), and neither sets `additionalProperties` at the top level.
- **Listed.** §3.2 names thirteen: twelve of those plus `collections`. Its sub-lists lag too: `defaults` names `layout`, `lang`, `charset` of five (`dir`, `shadow` missing); `build` names `outDir`, `format`, `trailingSlash`, `adapter` of seven (`sitemap`, `headers`, `deploy` missing) and does not say `format` is reserved and unused, which the schema's own description and site-architecture.md §14.1.1 both do. `i18n`'s three are complete.
- **`collections` is right to be absent.** Content collections are the `content` section of `extensions/parser/schemas/project.fragment.schema.json`, owned by the `Content` class (parser.md §9), composed into the per-project entry document (extensions.md §3.1, §5.2). `packages/schema/tests/validate-project.test.ts` validates a `content` block through exactly that composition, and `schema.test.ts` "is open — extension sections are opaque top-level keys" pins the core's openness. No `project.json` in the repository uses a top-level `collections` (`sites/jxsuite.com`'s is `search.collections`).
- **`$schema` is an editor binding.** `validateProjectFile` (`packages/schema/src/validate-project.ts`) reads `<root>/project.schema.json` whatever the key says; the key is what VS Code and Studio's Monaco follow.
- **Descriptions.** Every top-level key carries a `description` except `images`, which is a bare `$ref` to `ImageConfig`, whose definition carries one. Below the top level 41 property keys carry none (measured by walking `projectConfigSchema` through `items`, `additionalProperties` and `oneOf` branches, not counting `ImageConfig`'s): `$elements[]`'s `$ref`; the `destination` of both `redirects` object forms and the rewrite form's `rewrite`; `$head[].attributes` and `tagName`; eleven under `build.headers` (`enabled`, `security` and its members `contentTypeOptions`, `frameOptions`, `permissionsPolicy`, `referrerPolicy`, `csp.mode`, `csp.reportUri`, `hsts.includeSubDomains`, `hsts.maxAge`, `hsts.preload`); sixteen under `manifest`; `serviceWorker.enabled` and `scope`; seven under `securityTxt`. Nearly all are an external standard's member names (Web App Manifest, RFC 9116, the HTTP header each security key emits) under a parent whose description names the standard, and the rest sit under a parent or `oneOf` branch whose description says what the object is.
- **Nothing holds the list to the schema.** `schema.test.ts` "includes required top-level properties" checks fifteen names with `toContain`, so a key added or removed passes. No docs page cites `schema.md#3.2`, so `bun run docs:sync` never names the section. The advisory path already failed once: `docs/framework/site/project-json.md` lists the generated `packages/schema/schemas/project.core.schema.json` in `code:` and its "Key reference" still omits `$schema`, `$elements`, `i18n`, `manifest`, `securityTxt` and `serviceWorker`, puts the parser's `content` in the core table, and gives incomplete `defaults` and `build` rows, while its description promises "Every key in a Jx site's project.json".

**Related.** site-architecture.md §3.1's property table omits the same `i18n`, `manifest`, `securityTxt`, `serviceWorker` and `$schema`; its marker is about `$defs` and `charset`, and it is owned by `plan:site-architecture/project-defs-and-charset`, which this plan does not touch. That plan changes the `defaults.charset` default and what `$defs` means, `plan:_shared/page-server-entries` adds `build.deploy` to site-architecture.md §14.1.1, and `plan:desktop/single-file-mode` rewrites `build.format`'s description; the list below states none of what they change.

## Outcome

- schema.md §3.2 → Implemented: the list names every top-level key `projectConfigSchema` declares and no other, with complete `defaults`, `build` and `i18n` sub-key lists; content collections are pointed at the parser extension's `content` section; the section says the core schema is open and every top-level key is described.
- A `packages/schema` test fails when the list and the declared keys disagree in either direction (Open below).
- `docs/framework/site/project-json.md`'s key reference names every core key, and its extension table every first-party section, `content` and `feed` included.
- schema.md §7's BCP 47 and RFC 9110 rows, which bind §3.2, take their tier from an `Implemented` marker; their notes are already true once the required plan lands.

## Decisions

- **Decided:** reconcile the list; the core schema does not grow a `collections` (or `content`) key, because a content collection is an extension-contributed section by design (extensions.md §3.1), the schema's own description says extension sections are opaque top-level keys closed by the entry document (extensions.md §5.2), and a core key would make validation depend on the core rather than on the enabled extension.
- **Decided:** `$schema` is listed, not excluded as meta, because it is a declared property with a documented meaning (the editor binding to `project.schema.json`), and a guard that compares against every declared key needs no exception list.
- **Decided:** the list names keys and sub-keys and cites the section that owns each key's meaning; it states no default and no semantics beyond one clause, because site-architecture.md owns both, and three open plans change them (see Related). That is also why this plan requires none of them.
- **Decided:** the marker becomes `> **Status: Implemented.**` with one sentence rather than being deleted, because it read that way before the census. §7's BCP 47 and RFC 9110 rows lose their `Near` tier either way (an Implemented or absent marker yields no tier), so the choice is only about restoring what the census changed.
- **Decided:** `docs/framework/site/project-json.md` is corrected in the same pull request and its `spec:` gains `schema.md#3.2`, because it is the user-facing copy of the same list, lags in the same way, and the association makes `docs:sync` name it when §3.2 moves.
- **Open:** how deep does §3.2 promise descriptions? Recommendation: the top level only, stated as "every top-level key carries a `description`", because that is what ships, the 41 undescribed nested keys are almost all an external standard's own member names under a parent that names the standard, and site-architecture.md §11.3, §14.3, §14.5 and §14.6 already define them. The alternative (every depth) adds 41 descriptions to `project-config.schema.ts`, regenerates the 30 committed project schemas with `bun run schema:sync`, and makes this plan an S `implement` with the description test walking every depth.
- **Open:** does a test hold §3.2's list to the schema? Recommendation: yes, a `packages/schema` test that reads `specs/schema.md`, with a `scripts/ci/affected.ts` `EXTRA_EDGES` entry (`specs/schema.md` → `packages/schema`), because the list fell eight keys and one stale name behind while `project-config.schema.ts` changed in more than a dozen commits since June, and the advisory association let the docs page drift just the same. Costs a maintainer signs: it is the first workspace suite that reads a spec, every later `schema.md` edit retests `packages/schema`, and the landing pull request runs the whole matrix because `scripts/ci/**` is in `GLOBAL`. A test under `scripts/` would need no edge but would put a schema contract outside the schema package. Declining makes this a paper plan (steps 1, 5 and 6 only) that can land as soon as the required plan has, and the spec's last sentence drops its clause about the test.

## Implementation

1. **`specs/schema.md` §3.2**, rewritten as quoted under Specs & docs. Bullets keep the section's ``- `key` — text`` form, because the test below reads it: the keys of a bullet are the backticked names before its first em dash, and its sub-key list is the first parenthesised group made only of backticked names separated by `, `. A bullet with a sub-key list names one key. No other parenthesised group in a bullet may consist solely of backticked names.
2. **New `packages/schema/tests/project-schema-spec.test.ts`.** Header comment: schema.md §3.2 lists the keys `projectConfigSchema` declares; this is the join between the two, since a spec cannot import the schema. Module-private helpers:
   - `section32(markdown: string): string`: the lines after the one starting `### 3.2 ` up to the next line starting `### ` or `## `; throws when the heading is missing, so a renamed heading cannot make the suite vacuous.
   - `readList(section: string): { keys: string[]; subKeys: string[] | null }[]`: one entry per line matching ``/^- ((?:`[^`]+`)(?:, `[^`]+`)*) — (.*)$/``; `keys` from group 1, `subKeys` from the first ``/\(((?:`[^`]+`)(?:, `[^`]+`)*)\)/`` in group 2, else `null`.
   - The spec is read once with `readFileSync(resolve(import.meta.dir, "../../../specs/schema.md"), "utf8")`.
3. **`packages/schema/tests/schema.test.ts`**, "is open — extension sections are opaque top-level keys": add `expect("content" in schema.properties).toBe(false)` and `expect("collections" in schema.properties).toBe(false)`.
4. **`scripts/ci/affected.ts`**, `EXTRA_EDGES`, a new entry: `patterns: ["specs/schema.md"]`, `seeds: ["packages/schema"]`, `evidence: ["packages/schema/tests/project-schema-spec.test.ts"]`, `why`: "packages/schema's project-schema-spec test reads specs/schema.md §3.2 and holds its key list to projectConfigSchema in both directions, so an edit to that spec must retest schema. The spec is read by a test, not by schema's output, so schema's dependents are not retested." `specs/**` stays in `NO_TESTS`; `decide` consults `EXTRA_EDGES` first, so every other spec still retests nothing.
5. **`docs/framework/site/project-json.md`**, as listed under Specs & docs.
6. In the landing pull request: delete this file. If `plan:schema/generator-inventory` and `plan:schema/parse-boundary-readers` have both landed, this closes schema.md's last open item and the pull request graduates the spec (Specs & docs).

**Integration contract.** Once this lands, schema.md §3.2 is the complete inventory of core `project.json` keys, and (with the test) a pull request that adds, renames or removes a key in `projectConfigSchema.properties`, or a key of `defaults`, `build` or `i18n`, fails `packages/schema`'s suite until §3.2 names it, which also makes it a `schema.md` release. A plan that adds a core key edits §3.2's list in the same pull request, in the bullet form above, and records a `minor` fragment. Extension sections stay out of §3.2; they belong to the owning extension's spec.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`), in `tests/project-schema-spec.test.ts`, `describe("schema.md §3.2 and projectConfigSchema")`:

- "the section lists every top-level key the schema declares, and no other": the flattened `keys` of `readList(section32(spec))`, sorted, equal `Object.keys(projectConfigSchema.properties)` sorted, and no key is listed twice. On failure the message names the keys missing from the spec and the keys the schema does not declare.
- "a sub-key list, where the section gives one, is complete": for each entry with `subKeys`, `keys` has length 1 and the sorted `subKeys` equal the sorted `Object.keys(projectConfigSchema.properties[key].properties)`. It also asserts that `defaults`, `build` and `i18n` each have a list, so a sub-list cannot be dropped to pass.
- "every top-level key carries a description, directly or on the definition it references": over `generateProjectSchema().properties`, a property with a `$ref` of the form `#/$defs/<Name>` is resolved against the schema's `$defs`; each resolved node has a non-empty string `description`.
- "the list reader splits a bullet into its keys and its sub-key list": an inline fixture of three bullets, ``- `name`, `url` — metadata``, ``- `build` — output (`outDir`, `format`); see (site-architecture.md §14.1.1)`` and ``- `images` — the `ImageConfig` definition``, reads as `[name, url]` with no sub-keys, `[build]` with `[outDir, format]`, and `[images]` with none; `section32` of a string with no `### 3.2 ` heading throws.

`tests/schema.test.ts`: the "is open" case gains the two absent keys (step 3).

**`scripts`** (`bun test --isolate scripts`, run by the `changes` job): `scripts/ci/affected.test.ts`, in the describe holding the edge cases, "a schema.md edit retests schema alone, and another spec retests nothing": `flagsFor("specs/schema.md")` equals `["schema"]` and `flagsFor("specs/compiler.md")` equals `[]`.

**Coverage.** No source file is added or changed, so neither the manifest check nor `packages/schema/bunfig.toml`'s thresholds (`lines = 0.99, functions = 0.99`) move, and no ratchet applies. The paper half is proven by `docs:status`, `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose`, `docs:standards` and `plans:check`.

## Specs & docs

**`specs/schema.md` §3.2**, in place. The marker becomes:

```markdown
> **Status: Implemented.** Every top-level key the core project schema declares is listed below, and the three language-tag keys carry `LANGUAGE_TAG_PATTERN`.
```

The `**$id:**` line stays. "Validates `project.json` files with:" and the thirteen bullets below it become:

```markdown
Validates `project.json` files. Its properties are `projectConfigSchema.properties` (`packages/schema/defs/project-config.schema.ts`), which the core fragment `schemas/project.core.schema.json` shares (extensions.md §5.1):

- `$schema` — the editor binding to the generated per-project entry document, conventionally `./project.schema.json`; `jx validate` reads that file from the project root whatever this says (extensions.md §5.2, §5.4)
- `name`, `url` — project metadata
- `defaults` — default page settings (`layout`, `lang`, `charset`, `dir`, `shadow`)
- `$head` — global `<head>` entries
- `$elements` — global custom element dependencies
- `$defs` — project-wide JSON Schema type definitions (site-architecture.md §3.1)
- `imports` — global prototype-to-path import map
- `extensions` — the extension packages the project enables (extensions.md §3)
- `$media` — named media breakpoints
- `style` — global CSS styles
- `state` — site-wide reactive state
- `redirects` — static redirect and rewrite rules; a redirect's status is one of `REDIRECT_STATUSES` (site-architecture.md §11.3)
- `i18n` — internationalization (`defaultLocale`, `locales`, `routing`), site-architecture.md §13.2
- `images` — image optimization, the `ImageConfig` definition (site-architecture.md §9.2)
- `copy` — declarative file copy map, project-relative source to `outDir`-relative destination
- `build` — build configuration (`outDir`, `trailingSlash`, `adapter`, `sitemap`, `headers`, `deploy`, `format`); `format` is reserved and unused (site-architecture.md §14.1.1), and `headers` is site-architecture.md §14.3
- `manifest` — the Web App Manifest; absent means none (site-architecture.md §14.5)
- `securityTxt` — the RFC 9116 `security.txt` (site-architecture.md §14.5)
- `serviceWorker` — the service worker, where `false` emits the tombstone that removes one (site-architecture.md §14.6)

**Extension sections are not core keys.** The schema declares no top-level `additionalProperties`, so a section an extension contributes (extensions.md §3.1) is an opaque key here: content collections are the parser extension's `content` section (parser.md §9, `extensions/parser/schemas/project.fragment.schema.json`), and every other first-party section (the connector's `connections` and `data`, `auth`, `search`, `feed`) arrives the same way. The generated entry document closes the composition with `unevaluatedProperties: false` (extensions.md §5.2), which is where an unknown key fails `jx validate`.

Every top-level key carries a `description` (for `images`, on the `ImageConfig` definition it references), and a test holds the list above to the declared keys in both directions, sub-key lists included.
```

The two language-tag paragraphs after it are unchanged (the required plan adds one sentence to the second). **§7**: no edit. **No other spec** changes: extensions.md §3.1 and §5 and parser.md §9 already say what the new paragraph cites.

**Fragment:** `bun run spec:change schema.md minor -m "§3.2 lists every top-level key the core project schema declares with complete defaults, build and i18n sub-keys, points content collections at the parser extension's content section, and states that the core schema is open, every top-level key is described, and a test holds the list to the schema."` Minor: a `reconcile` that redefines nothing an author relies on, since `collections` never validated as a core key. If the second Open is declined, the sentence ends at "described".

**Docs.** No page's `spec:` cites `schema.md#3.2`, and this plan changes no file any page lists in `code:`, so `bun run docs:sync` names none. One page is corrected by decision (no em dashes):

- `docs/framework/site/project-json.md`: `spec:` gains `schema.md#3.2`. In "Key reference", the `content` row moves to the extension table as ``| `content` | `object` | `@jxsuite/parser` | Content collections; see [Content collections](/docs/framework/site/content-collections) |``, and the table gains the one first-party section it lacks, ``| `feed` | `object` | `@jxsuite/feed` | Atom and JSON Feed from a collection; see [Feeds](/docs/framework/site/feeds) |``. The `defaults` row reads "`layout`, `lang`, `charset`, `dir`, and `shadow` applied to every page"; the `build` row reads "`outDir`, `trailingSlash`, `adapter`, `sitemap`, `headers`, `deploy`; see [Deployment](/docs/framework/site/deployment)". Six rows join the core table: `$schema` (`string`, "Path to the generated `project.schema.json` that editors validate against; `jx schema` writes it"), `$elements` (`array`, "Custom elements available to every page: `$ref` objects or npm specifiers"), `i18n` (`object`, "`defaultLocale`, `locales`, `routing`; see [Locales and languages](/docs/framework/site/i18n)"), `manifest` (`object`, "Web App Manifest; see [Manifest and security.txt](/docs/framework/site/deployment#manifest-and-securitytxt)"), `securityTxt` (`object`, "`.well-known/security.txt`; same link"), `serviceWorker` (`boolean` or `object`, "Optional service worker; see [Service worker](/docs/framework/site/deployment#service-worker)").
- `docs/framework/site/deployment.md`, `docs/framework/site/i18n.md`: no change; the links above target headings they already have.

**Graduation.** Only if this is the last schema.md plan to land (none of `plan:schema/generator-inventory` and `plan:schema/parse-boundary-readers` remains): set the header's `**Status:**` to `Implemented`, record the §3.2 change and the graduation as one in-place `bun run spec:bump schema.md minor -m "…"` (the fragment's sentence plus "; every section is implemented, so schema.md graduates") instead of the fragment, because the release table makes a graduation minor when it rides on the last execution and a fragment would leave `-draft` on an Implemented header, and delete `plans/schema/`. Otherwise no graduation and `plans/schema/` stays.

## Acceptance

- `bun run docs:status` shows schema.md §3.2 as `Implemented`; `bun run plans:status --spec schema` no longer lists §3.2, and `bun run plans:check` is green with this file deleted.
- `git grep -n "collections" specs/schema.md` finds nothing in §3.2, and `git grep -n "schema.md#3.2" docs/framework/site/project-json.md` finds the new `spec:` entry.
- From `packages/schema`, `bun test --isolate --coverage` is green, and `bun scripts/check-coverage-manifest.ts packages/schema` passes from the root.
- Throwaway checks, reverted afterwards: deleting the `copy` bullet from §3.2 fails "the section lists every top-level key…" naming `copy`; adding a `collections` bullet fails it naming `collections`; deleting `dir` from the `defaults` sub-list fails "a sub-key list…"; adding a key to `projectConfigSchema.properties` fails the first case until §3.2 names it.
- `bun test --isolate scripts/ci` is green, including the new edge case.
- `bun run docs:spec-release` finds the fragment; `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:standards` are green.
