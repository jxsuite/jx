---
status: stub
disposition: implement
claims: []
size: S
workspaces:
  - packages/schema
  - packages/compiler
---

# The build admits no language tag or redirect status the project schema refuses, by construction

## Context

This plan claims nothing: it enables `plan:schema/project-schema-keys`, which owns §3.2 and requires it. It was split out of that plan because both of its facets are code, where the rest of §3.2's closure is a `reconcile` of the key list.

`specs/schema.md` §3.2, line 115, names both facets in its marker:

> The pattern does not accept every tag the build accepts: `canonicalizeLocale` (`packages/schema/src/locale.ts`) trims a tag before `Intl.Locale` parses it, so a padded `"en "` builds as `en` and fails `jx validate`. The compiler checks redirect statuses against its own `REDIRECT_HTML_POLICY` (`packages/compiler/src/site/site-build.ts`) rather than importing `REDIRECT_STATUSES`, as §7's RFC 9110 row says it does.

§3.2's contract is an inequality: "the pattern accepts every tag the build accepts, so a project that compiles can never fail `jx validate`". §7's RFC 9110 note states the redirect half as a single source: "the compiler and the Studio grid both import it rather than declaring their own". Both are the better contract, so the code moves; the alternative for the redirect facet, reconciling §7's note to a second table over the same five statuses, is the fallback if detailing finds the typing awkward.

**What exists**

- `packages/schema/src/locale.ts`: `LANGUAGE_TAG_PATTERN` (`^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$`, line 93) and `canonicalizeLocale`, which returns `new Intl.Locale(tag.trim()).toString()` (lines 105 to 110). Its callers are `resolveI18n` (same file) and `packages/compiler/src/site/well-known.ts` (line 171, `securityTxt.preferredLanguages`). The build never schema-validates `project.json`, so nothing else catches the padding: `resolveI18n({ i18n: { defaultLocale: "en ", locales: ["en ", " fr"] } })` returns no errors and the locales `en` and `fr`.
- `packages/schema/tests/locale.test.ts`: the corpus test that pins the inequality (around line 412) tests `pattern.test(tag.trim())`, so it trims away exactly the case that breaks it, and its corpus has no padded tag.
- `REDIRECT_STATUSES` in `packages/schema/defs/project-config.schema.ts` (line 10), imported by the schema's `redirects` enum and by `packages/studio/src/grid/redirects.ts`. `packages/compiler/src/site/site-build.ts` declares `REDIRECT_HTML_POLICY` as a `Record<number, …>` over the same five statuses (line 2384) and validates a rule's status against its keys (line 2438).

**What is missing**

- One direction for padded tags: the build refuses a tag that is not already trimmed (`canonicalizeLocale` stops trimming, or `resolveI18n` and `well-known.ts` reject it with an error naming the key), or the pattern admits surrounding whitespace. Refusing is the smaller contract and keeps a URL prefix and an `hreflang` from depending on invisible characters; the detail phase decides.
- The corpus test drops its `.trim()` and gains padded tags, so it pins what §3.2 and §7's BCP 47 row say it pins.
- `REDIRECT_HTML_POLICY` keyed by `REDIRECT_STATUSES` (a `satisfies Record<(typeof REDIRECT_STATUSES)[number], …>` or a table built from it), so a sixth status added to the schema fails to compile in the build until it has a policy, with the compiler's redirect tests unchanged.

**Related**

- site-architecture.md §13.2 (i18n configuration and the build's locale check) and site-architecture.md §11.3 (redirect statuses and rewrites).
- schema.md §7 (the BCP 47 and RFC 9110 rows).
