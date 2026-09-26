---
status: stub
disposition: implement
claims:
  - parser.md#9.1
size: S
workspaces:
  - extensions/parser
---

# A localized content type whose name is not URL-safe is reported, not skipped silently

## Context

`specs/parser.md` §9.1, line 183:

> **Status: Partial.** Mounts ship for plain and `{locale}` directory sources (`contentAssetMounts` in `extensions/parser/src/content-loader.ts`), and a plain source whose content type name is not URL-safe is skipped with the warning. A `{locale}` source is not: its branch tests the name inside the mount condition and moves on, so such a type gets no mounts and no warning, and its entries' content-relative references (§9.2) stay unrewritten without a word.

The section was unmarked before the census. Disposition `implement`: the warning is what tells an author why their collection's media does not resolve, and the plain branch already emits it.

**What exists**

- `contentAssetMounts` in `extensions/parser/src/content-loader.ts`. The `{locale}` branch loops over `localesForExpansion`, skips a locale that fails `SAFE_TYPE_NAME`, and pushes a mount only when `SAFE_TYPE_NAME.test(name) && existsSync(dir) && statSync(dir).isDirectory()`, then `continue`s. The plain branch warns "name is not URL-safe" before its `continue`.
- `loadContentSection` in the same file looks up `mounts.get(`${name}/${locale}`)` for each locale, which is `undefined` for such a type, so `rewriteEntryAssets` never runs on its entries.
- `extensions/parser/tests/content-loader.test.ts`: "warns and skips a content type name that is not URL-safe" (plain source only), and the `{locale}` suites (`localesForExpansion`, "a locale directory's spelling"), none of which uses an unsafe name.

**What is missing**

- The same warning on the `{locale}` branch, emitted once per content type rather than once per locale.
- A test beside the existing one for a `{locale}` source with an unsafe name.
- The unsafe-locale skip in the same loop is silent too. It is practically unreachable, because `localesForExpansion` canonicalizes BCP 47 tags, which never fail `SAFE_TYPE_NAME`; the detail phase decides whether it warns as well or is left as a guard.

**Related**

- parser.md §9.2 (the references a mount makes resolvable).
- site-architecture.md §13.3 (`{locale}` sources and their per-locale mounts), extensions.md §9 (the `content` section).
