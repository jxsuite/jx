---
status: drafted
disposition: implement
claims:
  - parser.md#9.1
requires: []
workspaces:
  - extensions/parser
  - specs
  - docs
size: S
---

# A localized content type whose name is not URL-safe is reported, not skipped silently

## Context

`specs/parser.md` §9.1, line 183:

> **Status: Partial.** Mounts ship for plain and `{locale}` directory sources (`contentAssetMounts` in `extensions/parser/src/content-loader.ts`), and a plain source whose content type name is not URL-safe is skipped with the warning. A `{locale}` source is not: its branch tests the name inside the mount condition and moves on, so such a type gets no mounts and no warning, and its entries' content-relative references (§9.2) stay unrewritten without a word.

The section was unmarked before the census. Its body (line 185) still describes only the plain shape and the old signature, `Content.assets(sectionValue, { root })`; the per-locale mounts are stated only in site-architecture.md §13.3.

Verified at the current tree:

- `contentAssetMounts` (`extensions/parser/src/content-loader.ts`, ~214) skips a sourceless or remote type, then splits. The `{locale}` branch (~232) loops over `localesForExpansion(projectConfig)`, `continue`s on a locale failing `SAFE_TYPE_NAME` (`/^[\w.~-]+$/`, ~188), and pushes a mount only when `SAFE_TYPE_NAME.test(name) && existsSync(dir) && statSync(dir).isDirectory()`. The plain branch (~245) warns `Content type "<name>": name is not URL-safe …` and `continue`s before it looks at the disk, so a plain type warns even when its source is a file or missing. Reproduced with `bun -e`: `{ "my posts": { source: "./c/{locale}/" } }` with `en` and `fr` directories present returns `[]` and prints nothing; the plain `./c/en/` source prints the warning.
- Both callers go through that one function: `Content.assets` (~826) and `loadContentSection` (~404), which keys mounts by `<type>/<locale>` and passes `undefined` for such a type, so `loadContentType` skips `rewriteEntryAssets` on both of its `if (mount)` branches (~569, ~607). The entries still load.
- The unsafe-locale `continue` is unreachable. `localesForExpansion` returns `resolveI18n(...).i18n.locales`, and `resolveI18n` (`packages/schema/src/locale.ts`) keeps only tags `canonicalizeLocale` accepts, which are `new Intl.Locale(tag).toString()`: letters, digits and hyphens. Measured: `["en", "../evil", "a b", "zh-hant-tw", "en-u-ca-buddhist", "en_US", "x-private"]` expands to `["en", "zh-Hant-TW", "en-u-ca-buddhist"]`. The existing test "skips a locale with no directory, and a locale name that is not URL-safe" passes `../evil`, which is dropped before the loop, so it exercises only the missing-directory skip.
- Studio's browser-side mirror, `contentMountFor` (`packages/studio/src/canvas/asset-resolve.ts`), already refuses an unsafe name before either shape (line 132), pinned by `packages/studio/tests/asset-refs.test.ts` ("a type name that is not URL-safe is skipped, matching the loader's warning path"). Hosts agree on the outcome; only the report is missing.
- Tests: `extensions/parser/tests/content-loader.test.ts`, "warns and skips a content type name that is not URL-safe" (plain only), and the suites `localesForExpansion`, "a locale directory's spelling" and "localized content types", none of which uses an unsafe type name.

## Outcome

- parser.md §9.1 → Implemented: one name check covers both source shapes, and the body states the per-locale mount shape and what an unsafe name costs.
- parser.md graduates only if this lands last: §3 (`plan:parser/heading-slug-combining-marks`), §7 (`plan:_shared/collection-directive-elements`) and §9.3 (`plan:parser/uniform-entry-dates`) are owned elsewhere.

## Decisions

- **Decided:** the name is tested once per content type, above the plain/`{locale}` split and after the sourceless/remote skip, because the name is a path segment of every mount either shape would publish. One check yields one warning per type per call by construction (never one per locale), and the locale loop's condition shrinks to the directory test.
- **Decided:** the warning fires whether or not any locale directory exists and whether or not the project declares locales, because the plain branch already warns before it looks at the disk, and the name is a configuration defect independent of it. A `{locale}` type with an unsafe name in a project with no locales therefore prints two warnings (this one and `loadContentSection`'s "declares no i18n locales"), each naming its own defect.
- **Decided:** one message for both shapes, `Content type "<name>": name is not URL-safe — nothing is published under /content/<name>, so its entries' content-relative asset references stay unresolved.` "Under" is true of `/content/<type>` and `/content/<type>/<locale>` alike. The only matcher in the repository is the test substring `not URL-safe`, which is kept.
- **Decided:** the unsafe-locale guard is deleted rather than given a warning, because it cannot fire: every tag reaching the loop is canonical BCP 47. The invariant it stood for is pinned where the parser consumes it, in the `localesForExpansion` suite. `loadContentSection` reads each locale's directory with no such guard, so the guard was never a boundary either. The two plans that edit `canonicalizeLocale` or `resolveI18n` keep the invariant, so neither is an edge: `plan:schema/build-schema-agreement` drops the trim (strictly fewer tags pass) and `plan:site-architecture/locale-negotiation-gaps` only reorders the list. A later change that admits a tag which is not a URL-safe segment fails the new `localesForExpansion` case.
- **Decided:** the warning is not deduplicated across `Content.assets` and `projectData`, both of which call `contentAssetMounts` in a site build. The plain branch behaves the same today, the dev server caches mounts per `project.json` mtime (`projectAssetMounts`, `packages/server/src/resolve.ts`), and deduplicating would need module state in a function extensions.md §8.5 describes as a pure function of the section.
- **Open:** should the project schema also refuse such a name (a `propertyNames` pattern on the `content` fragment), so editors and `jx validate` flag it? Recommendation: no, because the name is valid everywhere else (entry loading, `$paths`' `contentType`, `#/content/<type>` pointers), the missing mount is its only cost, and a schema refusal would turn projects that build today into invalid ones for an item that asks only for the report.

## Implementation

1. **`extensions/parser/src/content-loader.ts`, `contentAssetMounts`**:
   - Directly after the `!source || http(s)` `continue`, insert the name check with the message above, with a comment: the name is a path segment of every mount the type would get, plain or per-locale, so it is judged before the two shapes part (parser.md §9.1).
   - In the `{locale}` loop, delete the `if (!SAFE_TYPE_NAME.test(locale)) { continue; }` block and change the push condition to `existsSync(dir) && statSync(dir).isDirectory()`. Extend the block comment with one sentence: every locale is a canonical BCP 47 tag from `localesForExpansion`, so it is already a URL-safe segment.
   - Delete the plain branch's own `if (!SAFE_TYPE_NAME.test(name)) { … }` block; the hoisted check replaces it.
   - Update the JSDoc: a `{locale}` source yields one mount per declared locale whose directory exists, at `/content/<type>/<locale>`; a type whose name is not URL-safe yields none and is reported. Add the missing `@param {ProjectConfig} [projectConfig]` line.
   - `Content.assets`' JSDoc (~817) says the same: its summary and `@returns` name the per-locale shape beside `/content/<type>`.
2. No other file changes in code. `SAFE_TYPE_NAME`, `SECTION_KEY` and `localesForExpansion` are reused as they are; Studio's mirror already matches.

**Integration contract.** `contentAssetMounts(section, root, projectConfig)` and `Content.assets` return the same mounts as today for every URL-safe name. A type whose name fails `/^[\w.~-]+$/` gets no mount of either shape and exactly one `not URL-safe` warning per call; its entries still load through `projectData`, with references as authored. Every mount `urlPrefix` is `/content/<safe name>` or `/content/<safe name>/<canonical tag>`. parser.md §9.1 states both shapes and the unsafe-name rule.

## Tests

**`extensions/parser`** (`bun test --isolate --coverage` from `extensions/parser`), all in `tests/content-loader.test.ts`:

- In `localized content types`, beside the existing fixtures (`content/i18n-posts/en` and `fr`, each with `hello.md` and `hero.png`), a section `{ "i18n posts": { format: "Markdown", source: "./content/i18n-posts/{locale}/" } }`:
  - `warns once and publishes nothing for a type whose name is not URL-safe`: `contentAssetMounts(unsafe, TMP, config)` is `[]`, and exactly one captured warning contains `not URL-safe` and `"i18n posts"`, although two locale directories exist. Again with `{}` as the project config (no locales): still `[]` and exactly one such warning.
  - `still loads that type's entries, leaving their references as authored`: `Content.projectData(unsafe, { projectConfig: config, registry, root: TMP })` yields two entries with `_meta.locale` `en` and `fr`, and `srcsOf` of each is `["./hero.png"]`.
  - Retitle `skips a locale with no directory, and a locale name that is not URL-safe` to `skips a locale with no directory, and a malformed tag never reaches the loop`; the body is unchanged and still passes, since `../evil` is dropped by `localesForExpansion`.
- In `localesForExpansion`, `drops a tag that is not well-formed, so every locale is a URL-safe path segment`: `{ i18n: { defaultLocale: "en", locales: ["en", "../evil", "a b", "zh-hant-tw", "en-u-ca-buddhist", "en_US"] } }` expands to `["en", "zh-Hant-TW", "en-u-ca-buddhist"]`, and every item matches `/^[\w.~-]+$/`.
- In `content asset mounts` › `Content.assets`, tighten `warns and skips a content type name that is not URL-safe` to assert exactly one matching warning.

**Coverage.** No source file is added, so `bun scripts/check-coverage-manifest.ts extensions/parser` is unaffected. The change deletes the only unreachable line in `contentAssetMounts` and adds none, so `content-loader.ts` can only rise against `coverageThreshold = { lines = 0.987, functions = 0.975 }` in `extensions/parser/bunfig.toml`. Ratchet only if the run shows the workspace's worst file moved.

## Specs & docs

**`specs/parser.md` §9.1**, in place:

- The marker becomes `> **Status: Implemented.**`.
- The body paragraph becomes: "`Content.assets(sectionValue, { root, projectConfig })` returns one mount per content type whose `source` is a local **directory**: `{ urlPrefix: "/content/<type>", dir: <resolved source> }`. A `{locale}` source (site-architecture.md §13.3) returns one mount per declared locale whose directory exists, at `/content/<type>/<locale>`, so two translations' co-located files cannot collide at one URL. Single-file, remote, and missing sources get no mount — a lone file's siblings are not its collection. A content type whose name is not URL-safe (anything beyond ASCII letters, digits, `_`, `.`, `~` and `-`) gets no mount of either shape and is reported with a warning naming it, never one per locale; its entries still load, and their content-relative references (§9.2) stay as authored."

**Fragment:** `bun run spec:change parser.md minor -m "§9.1: a content type whose name is not URL-safe is reported with a warning whether its source is plain or per-locale, and the section states the per-locale mount shape."`

**Docs** (no em dashes). `bun run docs:sync` names the pages whose `code:` lists `content-loader.ts`; none cites `parser.md#9.1`.

- `docs/framework/site/content-collections.md`: after the paragraph ending "…which is how these docs ship their screenshots from `docs/images/`." add: "The collection's name is part of that URL, so keep it to ASCII letters, digits, `-`, `_`, `.` and `~`. A collection named anything else (`my posts`, say) still loads, but its images get no URL: their references stay as written, and the build warns, naming the collection." (Not "once": a site build asks for mounts twice, through `assets` and `projectData`, per the Decided item above.)
- `docs/framework/site/relationships.md`: no change; it documents reference resolution, not mounts.
- `docs/framework/site/i18n.md` (line 300, per-locale images) and `docs/extending/extensions/capabilities.md` (the mount shape): no change; the naming rule is stated once, where collection images are introduced.

If §3, §7 and §9.3 have already closed when this lands, it also graduates parser.md: header `**Status:** Implemented`, `bun run spec:bump parser.md minor` in place with the fragment's sentence as its `-m` instead of the fragment, and delete `plans/parser/`. Otherwise nothing graduates: delete this file, and in `plans/parser/README.md` drop the §9 bullet's closing sentence about the `{locale}` skip.

## Acceptance

- `bun test --isolate --coverage` from `extensions/parser` passes with the cases above and no per-file threshold failure; `bun scripts/check-coverage-manifest.ts extensions/parser` passes.
- By hand, from `extensions/parser`, with a temp root holding `c/en/` and `c/fr/`: `contentAssetMounts({ "my posts": { source: "./c/{locale}/" } }, root, { i18n: { defaultLocale: "en", locales: ["en", "fr"] } })` returns `[]` and prints one `not URL-safe` warning (today it prints none).
- `git grep -n 'SAFE_TYPE_NAME' -- extensions/parser/src` lists the declaration and exactly one use.
- `sed -n '/^### 9\.1 /,/^### 9\.2 /p' specs/parser.md` shows `> **Status: Implemented.**` and the rewritten paragraph; `bun run plans:status --spec parser` no longer lists `parser.md#9.1`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
