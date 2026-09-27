---
status: drafted
disposition: implement
claims:
  - parser.md#9.3
requires: []
workspaces:
  - extensions/parser
  - packages/compiler
  - specs
  - docs
size: S
---

# Every content entry gets its declared dates coerced and a modification time, whichever branch loaded it

## Context

`specs/parser.md` §9.3, line 200:

> **Status: Partial.** `coerceEntryDates` (`extensions/parser/src/dates.ts`) runs in `loadContentType` between a format class's `load` and `validateEntries`, but only on the local format-class branch: native JSON collections and remote http(s) sources reach `validateEntries` uncoerced, so a declared date there is left as authored. An offset, fractional-second or zone-less date-time passes silently and is never normalized to UTC, because `isCoercedDate` accepts every RFC 3339 form; only a value that is not RFC 3339 at all draws the "was not coerced" warning. `_meta.mtime` is stamped by `Markdown.load` alone; `Csv.load` and `loadJSONEntries` set no `_meta`, so CSV and JSON entries carry no modification time.

Before the census the section led with `Implemented`. Both gaps have one cause, `loadContentType` running its post-load pass on one of its three branches, and both close by making that pass common. Disposition `implement`: §4 already relies on "handled once for every format by the content loader", and §9.3's own "Why UTC" paragraph is the mis-sort the JSON branch still ships.

**What exists** (verified at b900b326 with a `bun` probe through `loadContentSection`)

- `loadContentType` in `extensions/parser/src/content-loader.ts` (~494) has three branches. Remote (~531): a `remote: true` class's `load(source)`, then `validateEntries`. Native JSON (~562): `discoverJSONFiles`, `loadJSONEntries(filePath)` per file, `rewriteEntryAssets`, then `validateEntries`. Format class (~578): `discover` (or the resolved source), `load(filePath)` per file, `rewriteEntryAssets`, then `coerceEntryDates` (warnings to `console.warn`) and `validateEntries` (~614–623). The comment there already names the loader as "the one point in the pipeline that holds both the entries and the schema".
- Probe: a JSON array entry with `published: "2025-03-04T01:00:00+02:00"` under a `date-time` schema comes back exactly as authored with no `_meta` and no warning; the same value in a local CSV row is normalized to `2025-03-03T23:00:00Z` with `_meta.rawDates`, and still no `_meta.mtime`.
- `validateEntries` (~651) warns "was not coerced" only when `isCoercedDate` (`dates.ts`) rejects the value; that test is `DATE_ONLY || RFC_3339`, which accepts offsets, fractional seconds, a space separator and a missing offset (`2025-03-04T01:00:00+02:00`, `2025-03-04 10:00`, `2025-03-04T00:00:00.123Z` all pass; `03/04/2025` does not). `isCoercedDate` has no caller besides this and `dates.test.ts`; `dates.ts` is not a package export.
- `Markdown.load` (`extensions/parser/src/markdown.ts`, ~94–106) stamps `_meta.mtime` from `statSync(path)` as `toISOString()` minus milliseconds, inside a `try` that tolerates a path not on disk. `Csv.load` (`csv.ts` ~368) and `loadJSONEntries` (~84) stamp nothing. `dates.ts` has a private `toInstant(d)` producing the same `YYYY-MM-DDTHH:MM:SSZ` form.
- Consumers of `_meta.mtime`, which need no change: `Content.resolvePaths` passes `_meta` beside the route parameters (pinned by "carries the entry's own _meta alongside the route parameter" in `extensions/parser/tests/content-loader.test.ts`); `entryMtime` in `packages/compiler/src/site/pages-discovery.ts` lifts it to `sourceMtime`, which `site-build.ts` prefers for `<lastmod>` (end to end in `packages/compiler/tests/sitemap-lastmod.test.ts`, markdown only); `entryToItem` in `extensions/feed/src/shared.ts` falls back to it for `published`.
- Tests: `extensions/parser/tests/dates.test.ts` (parse, coerce, refusals, `isCoercedDate`); `content-loader.test.ts` covers the remote and JSON branches without schemas that declare dates, and the format branch's refusal through the real `Markdown` class ("warns on an ambiguous date field instead of guessing").

**Found while detailing**

- **A refusal is reported twice on the branch that does coerce.** For `03/04/2025` the probe prints the `Content dates:` refusal from `coerceEntryDates` and then `Content validation: … was not coerced — it will sort and filter as plain text.` for the same field.
- **§9.3's sitemap sentence is stale.** It says `_meta.mtime` "is what would let the sitemap stop giving every page generated from one template that template's `<lastmod>`"; site-architecture.md §8.4.1 has shipped exactly that (0.5.7), so today only markdown-backed routes get it and a JSON- or CSV-backed route still takes its template's time.
- **Runtime instances bypass the loader.** `{ "$prototype": "Csv", … }` or `"Markdown"` resolved at runtime (§3.1, §4's `resolve`) reads its source directly, so its dates are as authored and it has no `_meta.mtime`. §9.3's scope is the content loader; the section says so only for §6's `MarkdownCollection`.

## Outcome

- parser.md §9.3 → Implemented: on all three branches declared dates are coerced once and each refusal is reported once; every entry loaded from a local file carries `_meta.mtime`; a remote entry's lack of one, and the runtime instances' exclusion, are stated.
- parser.md does not graduate here unless this is the last of its plans to land (§3, §7 and §9.1 are owned by `plan:parser/heading-slug-combining-marks`, `plan:_shared/collection-directive-elements` and `plan:parser/localized-mount-name-warning`).

## Decisions

- **Decided:** one post-load helper ends every branch of `loadContentType` (coerce, then validate), because the loader is the only place holding entries and schema, as its own comment and §4 say, and three copies of the pass is how two branches lost it.
- **Decided:** the loader stamps `_meta.mtime` from the path it read (JSON) or handed to `load` (format class), only when that path is a regular file and the entry has none yet; `Markdown.load` stops stamping. Because the loader is the one thing that knows which file an entry came from, a third-party format class then gets the time with no code; a class that knows better (a commit time) keeps its own value; and §3's `load` row already lists `_meta` as excerpt, toc, readingTime and wordCount, never mtime. The regular-file test keeps a class without `discover` that is handed a directory from dating its entries by that directory.
- **Decided:** a file holding many entries (a CSV, a JSON array) gives each entry that file's time, because the file is the unit a filesystem dates. The consequence is written into §9.3: editing one row re-dates every row in the sitemap and in a date-less feed.
- **Decided:** retire the "was not coerced" branch of `validateEntries` and delete `isCoercedDate`, rather than narrow it to the two stored forms. Once every branch coerces first, every declared date reaching validation is either normalized or a refusal `coerceEntryDates` has already reported, so a narrowed check could only repeat that report (it does today; see above). The `type` checks that follow are untouched.
- **Decided:** the stamp uses `toInstant` from `dates.ts`, exported, because it is the formatter coercion already emits, so `_meta.mtime` and a coerced `date-time` share one form by construction.
- **Decided:** runtime `$prototype` instances stay outside §9.3, stated in its closing paragraph beside `MarkdownCollection`, because `Markdown.resolve` has no content-type schema to read and coercing in `Csv.resolve` alone would give the two runtime classes different contracts.
- **Open:** does an entry from a remote source get a `_meta.mtime`? Recommendation: no, and §9.3 says so. `Last-Modified` is optional (RFC 9110 §8.8.2) and a generated export (a published spreadsheet's CSV) commonly omits it or sends the time of the request. A request-time value would re-date every entry on every build, and as the feed's fallback it would produce the "feed stamped with the build time" that site-architecture.md §6.7 forbids. Without one, the existing fallbacks already apply: the sitemap dates the route by its template file, and the feed lists the entry last, undated. If accepted instead: `Csv.load` stamps each row from a parseable `Last-Modified`, the loader's stamp is unchanged, and §9.3 says a remote entry carries the header's time when the server sends one.

## Implementation

1. **`extensions/parser/src/dates.ts`**: `export function toInstant(d: Date)` (unchanged body); delete `isCoercedDate`. `DATE_ONLY` and `RFC_3339` stay (`parseDateValue`, `parseComparable`).
2. **`extensions/parser/src/content-loader.ts`**
   - Import `coerceEntryDates, toInstant` from `./dates.ts` (drop `isCoercedDate`, `isDateFormat`).
   - Add `stampSourceMtime(entries: ContentLoaderEntry[], filePath: string): void`: in a `try`, `const stat = statSync(filePath)`; return on a throw or `!stat.isFile()`; `const mtime = toInstant(stat.mtime)`; for each entry with `entry._meta?.mtime === undefined`, `entry._meta = { ...entry._meta, mtime }` (a fresh object per entry, since `coerceEntryDates` later writes `rawDates` into it). Its doc comment carries the "only date a file always has" rationale moved from `Markdown.load`, citing parser.md §9.3.
   - Add `finishEntries(entries, schema, name): ContentLoaderEntry[]`: when `schema` is set, `console.warn` each `coerceEntryDates(entries, schema, name)` message, then `validateEntries(entries, schema, name)`; return `entries`. Move the existing "one point in the pipeline" comment onto it and widen it to all three branches.
   - Remote branch: `return finishEntries(entries, schema, name)` inside the existing `try`; no stamp.
   - JSON branch: `stampSourceMtime(fileEntries, filePath)` after `loadJSONEntries`; end with `return finishEntries(entries, schema, name)`.
   - Format branch: `stampSourceMtime(fileEntries, filePath)` after `load`; replace the tail (~614–625) with `return finishEntries(entries, schema, name)`.
   - `validateEntries`: delete the `isDateFormat(def.format) && … !isCoercedDate(value)` branch; the `else if` chain starts at the `string` type check.
3. **`extensions/parser/src/markdown.ts`**, `Markdown.load`: drop `statSync` from the method's dynamic `node:fs` import and delete the comment and `try` block (~95–106); `_meta` still starts as `{}` and gets excerpt, toc, readingTime and wordCount.

**Neighbours in the same code.** None is a prerequisite either way, and whichever lands second rebases; `plans/parser/README.md` (Spec-wide decisions) records that this plan owns the loader's tail.

- `plan:_shared/collection-directive-elements` changes the load calls in CDE1.1 (a trailing `ctx` parameter on `loadContentType`, `{ allowedNames, onDisallowed }` on each `load`, a warning per finding after it) and in CDE1.2 stamps every entry of all three branches with its type's `$elements`. That stamp is a step every branch shares, so it goes in `finishEntries`, which gains the `ContentTypeDef` as a parameter; if CDE1.2 lands first, this plan folds its per-branch stamps into `finishEntries`. Both plans edit `Markdown.load`: CDE1.1 its `directives` default, this plan its `statSync` block.
- `plan:relationships/reference-validation` adds reference checks to `validateEntries`, placed "before the date branch" this plan deletes: they go first in the per-field loop, after the `value == null` skip, in either order of landing.
- `plan:site-architecture/entry-editor-widgets` widens `rewriteEntryAssets` (called unchanged here by the JSON and format branches), copies `DATE_ONLY` and `RFC_3339` into Studio (both stay) and writes a `date-time` in the `toInstant` form (exported here, body unchanged).
- `plan:site-architecture/build-excludes-drafts` filters in `Content.projectData` and does not touch `loadContentType`.
- `plan:site-architecture/collection-pagination` dates a paged route by the newest item's `_meta.mtime`; once this lands JSON and CSV items contribute too, which its rule already covers.

**Integration contract.** Every entry `loadContentSection` (so `Content.projectData`) returns has each schema-declared `date` field as `YYYY-MM-DD` and each `date-time` field as `YYYY-MM-DDTHH:MM:SSZ`, or unchanged with exactly one `Content dates:` warning; the authored text of a rewritten value is at `_meta.rawDates[field]`. Every entry loaded from a local regular file has `_meta.mtime` in the `YYYY-MM-DDTHH:MM:SSZ` form, the format class's own value winning; a remote entry has none. `finishEntries` is the one tail of every `loadContentType` branch: a per-entry step every branch shares goes there, never into the branches, and `validateEntries` no longer has a date branch. `dates.ts` exports `toInstant`; `isCoercedDate` no longer exists. parser.md §9.3 states all of this.

## Tests

`bun test --isolate --coverage` from `extensions/parser`.

- **`tests/content-loader.test.ts`**. Add `Csv: resolve(import.meta.dir, "../src/Csv.class.json")` to the fixture manifest in the top `beforeAll`. New `describe("entry dates and modification times on every branch")`, whose `beforeAll` writes `content/dated-json/list.json` (`early`: `2025-03-04T01:00:00+02:00`; `late`: `2025-03-04T00:30:00Z`; `bad`: `03/04/2025`), `content/dated-json/solo.json` (an object), `content/dated-csv/rows.csv` (two rows) and `content/dated-md/post.md`, and backdates each with `utimesSync` to a distinct past instant (the `sitemap-lastmod.test.ts` idiom), so each expected `mtime` is an exact string. The schema declares `published` as `date-time`.
  - `normalizes a JSON collection's declared dates and keeps the authored text`: `early` is `2025-03-03T23:00:00Z` with `_meta.rawDates.published` the authored value; `late` is unchanged with no `rawDates`; `early` now sorts before `late` as text.
  - `reports a date it cannot read once`: exactly one captured warning names `dated-json/bad` and `03/04/2025`, and none contains `was not coerced`.
  - `coerces a remote source's declared dates`: a `remote: true` fake returning `early`'s value is normalized with `rawDates` kept, and has no `_meta.mtime`.
  - `stamps a JSON entry with its file's modification time`: both array entries carry `list.json`'s time and `solo` its own.
  - `stamps a CSV row with its file's modification time`: through `Content.projectData` and the real `Csv` class, both rows carry `rows.csv`'s time and their `published` is normalized.
  - `still stamps a markdown entry, from the loader`: the real `Markdown` class, `post.md`'s time.
  - `stamps a third-party format class's entries from the file it loaded`: a fake with `discoverResult` naming a real fixture file.
  - `keeps a modification time the format class set`: a fake whose entry carries `_meta.mtime: "2020-01-01T00:00:00Z"`.
  - `dates nothing that is not a file`: a fake with no `discover` on a directory source, and the existing `/virtual/*.fake` discover case, both leave `_meta` undefined.
  - "validates registry-loaded entries against the schema" and "warns on an ambiguous date field instead of guessing" pass unchanged.
- **`tests/dates.test.ts`**: replace "isCoercedDate recognizes both normalized forms" with `toInstant drops fractional seconds and reads in UTC` (`new Date("2024-03-04T05:06:07.890Z")` → `2024-03-04T05:06:07Z`), and drop `isCoercedDate` from the import.
- **`packages/compiler/tests/sitemap-lastmod.test.ts`** (end to end, since no `extensions/parser` test reaches a sitemap): add a native JSON type `items` (`format: "json"`, `source: "./content/items/"`) to the fixture's `content`, a `pages/items/[slug].json` with `$paths: { contentType: "items" }`, and `content/items/list.json` holding `[{ "id": "a" }, { "id": "b" }]`, backdated with `utimesSync` to a third instant before the build. New case `dates a route generated from a JSON entry by that entry's file`: `/items/a` and `/items/b` both have that instant as `<lastmod>`. It fails today, where both take the template's time.

Coverage: `extensions/parser/bunfig.toml` gates every file at lines 0.987, functions 0.975. Both new functions have a case per branch (not a file, not on disk, format-set value, stamped); the deleted `validateEntries` branch and `Markdown.load` block remove lines rather than add them. No source file is added, so `bun scripts/check-coverage-manifest.ts extensions/parser` is unaffected. Ratchet only if the run shows the workspace's worst file rose. `packages/compiler` gains a test case only, so its thresholds are untouched; run `bun test --isolate --coverage` there too, because `content-types.test.ts` and `sitemap-lastmod.test.ts` load real JSON and CSV collections.

## Specs & docs

**parser.md §9.3**, in place:

- Line 200's marker becomes `> **Status: Implemented.**`
- The opening sentence becomes: "A field the content-type schema declares as `format: "date"` or `format: "date-time"` is normalized to RFC 3339 by the content loader, once, after a format class's `load` and before validation, whichever source produced the entry: a format class's local files, a native JSON collection or a remote `http(s)` source:"
- "**Everything else is refused**, left exactly as authored, and reported naming …" becomes "… and reported once, naming …".
- The `_meta.mtime` paragraph becomes: "**`_meta.mtime`.** Every entry loaded from a local file carries that file's modification time as a UTC RFC 3339 timestamp without fractional seconds. The loader stamps it after `load`, so every format class's entries carry it, and keeps a value the class set itself. A file holding many entries (a CSV, a JSON array) gives each the file's time, so editing one row re-dates them all. An entry from a remote source has no file and carries none: `Last-Modified` is optional, and a generated export's is often the time of the request, which would re-date every entry on every build. The modification time is the only date a file always has, so it is the fallback a feed uses when the frontmatter carries none (`site-architecture.md` §6.7), and it dates a route generated from an entry by that entry rather than by its template (`site-architecture.md` §8.4.1); a route whose entry carries none is dated by its template." (If the remote Open is declined, the remote sentence says the entry carries the server's `Last-Modified` when one is sent.)
- The closing paragraph gains: "Nor is a format class resolved at runtime through `$prototype` (§3.1, §4's `resolve`): it reads its source without the loader, so its dates are as authored."
- §10's RFC 3339 row: Evidence gains `extensions/parser/tests/content-loader.test.ts`; class stays `**Subset**`. Re-pad the table with `bun run format`.
- Fragment: `bun run spec:change parser.md minor -m "§9.3 declared dates are coerced on every loading branch, native JSON and remote sources included, a refused date is reported once, and every entry loaded from a local file carries its file's modification time while a remote entry carries none."`

No other spec changes: §4's "handled once for every format by the content loader" becomes true as written. site-architecture.md §6.7 and §8.4.1 and extensions.md §8 read `_meta.mtime` as parser.md §9.3 defines it and fall back when it is absent, so the remote case is stated once, in §9.3, rather than released in a second spec.

**Docs** (no em dashes). `bun run docs:sync` names the pages whose `code:` lists `content-loader.ts`:

- `docs/framework/site/content-collections.md`: add `parser.md#9.3` to `spec:` and `extensions/parser/src/dates.ts` to `code:` (it already carries `@docs framework/site/content-collections`). In "Dates", the first sentence becomes "Declare a date field with `format`, and the loader normalizes it, whichever format or source the entry came from, so sorting and filtering work:". After the `:::doc-note`, add: "Every entry loaded from a file also carries `_meta.mtime`, the file's last modification time (`2025-03-04T16:00:00Z`). Each row of a CSV file, or item of a JSON array, shares its file's time. Feeds use it when an entry has no date, and the sitemap dates a page generated from the entry by it. An entry from a remote `https://` source has no file, so it has no `_meta.mtime`."
- `docs/framework/site/relationships.md`: named by `docs:sync` through `content-loader.ts`; no change, since references are unaffected.
- `docs/framework/site/feeds.md` line 59 (not named by `docs:sync`, but it states the fallback): "An entry with no date falls back to the source file's modification time." becomes "An entry with no date falls back to the modification time of the file it came from; an entry from a remote source has none, so it is listed last, undated."
- `docs/framework/site/seo.md` line 172's last sentence becomes "A route with no entry behind it (an authored page, or a `$paths` listing plain values), or whose entry came from a remote source, is still dated by its own file."

On landing: delete this file, and in `plans/parser/README.md` drop the §4 bullet's remote-CSV caveat. If §3, §7 and §9.1 have already closed, this pull request also graduates parser.md: header `**Status:** Implemented`, `bun run spec:bump parser.md minor` in place, with the fragment's sentence as its `-m`, instead of the fragment (graduation rides on this execution), and delete `plans/parser/`.

## Acceptance

- `bun test --isolate --coverage` passes in `extensions/parser`, and `bun scripts/check-coverage-manifest.ts extensions/parser` is green.
- `grep -rn "isCoercedDate\|was not coerced" extensions/parser/src` and `grep -n statSync extensions/parser/src/markdown.ts` find nothing.
- `bun test --isolate --coverage` passes in `packages/compiler`, including the new `sitemap-lastmod.test.ts` case (a JSON-backed route's `<lastmod>` is its entry file's time, not the template's).
- `bun run docs:status`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:standards`, `bun run docs:spec-release` and `bun run plans:check` are green; `bun run plans:status --spec parser` no longer lists `parser.md#9.3`.
