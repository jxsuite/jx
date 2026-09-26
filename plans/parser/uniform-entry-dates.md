---
status: stub
disposition: implement
claims:
  - parser.md#9.3
size: S
workspaces:
  - extensions/parser
---

# Every content entry gets its declared dates coerced and a modification time, whichever branch loaded it

## Context

`specs/parser.md` §9.3, line 200:

> **Status: Partial.** `coerceEntryDates` (`extensions/parser/src/dates.ts`) runs in `loadContentType` between a format class's `load` and `validateEntries`, but only on the local format-class branch: native JSON collections and remote http(s) sources reach `validateEntries` uncoerced, so a declared date there is left as authored. An offset, fractional-second or zone-less date-time passes silently and is never normalized to UTC, because `isCoercedDate` accepts every RFC 3339 form; only a value that is not RFC 3339 at all draws the "was not coerced" warning. `_meta.mtime` is stamped by `Markdown.load` alone; `Csv.load` and `loadJSONEntries` set no `_meta`, so CSV and JSON entries carry no modification time.

Before the census the section led with `Implemented`. The two gaps are one piece of work and share one stub: both come from `loadContentType` running its post-load pass on one of its three branches, and both close by making that pass common to every branch. Disposition `implement`: the spec's "handled once for every format" is the right contract, and §4 already relies on it for CSV.

**What exists**

- `coerceEntryDates` and its tests in `extensions/parser/src/dates.ts` and `extensions/parser/tests/dates.test.ts`.
- `loadContentType` in `extensions/parser/src/content-loader.ts`: the remote branch (a `remote: true` format class's `load`, then `validateEntries`), the native JSON branch (`discoverJSONFiles`, `loadJSONEntries`, `rewriteEntryAssets`, then `validateEntries`), and the format-class branch, which alone runs `coerceEntryDates` before `validateEntries`.
- `validateEntries` in the same file, which warns that a declared date "was not coerced" only when `isCoercedDate` (`extensions/parser/src/dates.ts`) rejects it. That test is `DATE_ONLY || RFC_3339`, and `RFC_3339` accepts offsets, fractional seconds, a space separator, a missing offset and lowercase `t`/`z`, so it is wider than the two normalized forms its own comment says it recognises. Measured at b900b326: `2025-03-04T01:00:00+02:00`, `2025-03-04 10:00` and `2025-03-04T00:00:00.123Z` pass, `03/04/2025` does not. On the JSON and remote branches an offset date-time therefore sorts as text, which is the mis-sort §9.3's "Why UTC" paragraph exists to prevent, and nothing reports it.
- `Markdown.load` in `extensions/parser/src/markdown.ts` stamping `_meta.mtime` from `statSync`; `Csv.load` in `extensions/parser/src/csv.ts` and `loadJSONEntries` stamp nothing.
- The consumers of `_meta.mtime`: `Content.resolvePaths` carrying `_meta` beside route parameters (`extensions/parser/src/content-loader.ts`, pinned in `extensions/parser/tests/content-loader.test.ts`), the sitemap's per-entry `lastmod` and the feed's date fallback.

**What is missing**

- `coerceEntryDates` on the native JSON and remote branches, so a declared date in a JSON collection or a remote CSV is normalized, refused or kept at `_meta.rawDates` exactly as a local CSV or markdown one is.
- `isCoercedDate` narrowed to the two normalized forms (`YYYY-MM-DD`, and `YYYY-MM-DDTHH:MM:SSZ`), or the check retired once coercion runs on every branch; either way a date `validateEntries` passes must be one that sorts correctly.
- `_meta.mtime` for every entry loaded from a local file, including CSV rows and JSON entries. Stamping it in `loadContentType` for any entry the format class left without one would also cover third-party format classes, which the spec's "every loaded entry" implies.
- A decision for remote sources, which have no file: the response's `Last-Modified` header, or a stated absence in §9.3's `_meta.mtime` paragraph.
- Tests for both branches in `extensions/parser/tests/content-loader.test.ts`.

**Related**

- parser.md §4 (CSV defers date coercion to the loader), parser.md §6 (the schemaless collection §9.3 excludes).
- site-architecture.md §6.7 (feeds fall back to `_meta.mtime`), site-architecture.md §8.4.1 (a generated route's `lastmod` comes from its entry's `_meta`).
