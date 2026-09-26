---
status: stub
disposition: reconcile
claims:
  - schema.md#3.2
requires:
  - schema/build-schema-agreement
size: S
---

# §3.2 lists the keys the core project schema declares

## Context

`specs/schema.md` §3.2, line 115:

> **Status: Partial.** The top-level keys of `projectConfigSchema` (`packages/schema/defs/project-config.schema.ts`) are described and the three language-tag keys carry `LANGUAGE_TAG_PATTERN`, but the list below names a `collections` key the core schema does not declare (content collections are the parser extension's `content` section, `extensions/parser/schemas/project.fragment.schema.json`) and omits the declared `$defs`, `$schema`, `extensions`, `manifest`, `serviceWorker`, `securityTxt`, `images` and `copy`. The pattern does not accept every tag the build accepts: `canonicalizeLocale` (`packages/schema/src/locale.ts`) trims a tag before `Intl.Locale` parses it, so a padded `"en "` builds as `en` and fails `jx validate`. The compiler checks redirect statuses against its own `REDIRECT_HTML_POLICY` (`packages/compiler/src/site/site-build.ts`) rather than importing `REDIRECT_STATUSES`, as §7's RFC 9110 row says it does.

The marker read Implemented before the census ("Every declared key is described"). That held for the language-tag pattern it was written for, not for the key list below it, and not for the pattern's own inequality once a tag is padded. Disposition `reconcile` for the key list: the code is right. Content collections became an extension-contributed section, closed only in the generated per-project entry document, which is the composition extensions.md specifies, so the core schema should not grow a `collections` key; the list is what lags.

The marker's last two sentences close by code, not by this plan's text: `plan:schema/build-schema-agreement` makes the build refuse what the pattern refuses and keys the compiler's redirect table off `REDIRECT_STATUSES`, and this plan requires it. Once it lands, the marker drops those sentences and §3.2 closes on the list rewrite.

**What exists**

- `packages/schema/defs/project-config.schema.ts`: top-level `$defs` ("Global type definitions available to all pages"), `$elements`, `$head`, `$media`, `$schema` (the path to the generated per-project schema), `build`, `copy`, `defaults`, `extensions`, `i18n`, `images`, `imports`, `manifest`, `name`, `redirects`, `securityTxt`, `serviceWorker`, `state`, `style`, `url`; `LANGUAGE_TAG_PATTERN` on `i18n.defaultLocale`, `i18n.locales[]` and `securityTxt.preferredLanguages[]`; the exported `REDIRECT_STATUSES`.
- `packages/schema/src/locale.ts`, `packages/schema/tests/locale.test.ts`, `packages/schema/tests/validate-project.test.ts`.
- `extensions/parser/schemas/project.fragment.schema.json`, which contributes the `content` section.

**What is missing**

- The §3.2 list, which names thirteen keys against the twenty the schema declares: `collections` replaced by a pointer to the parser extension's `content` section; `$defs`, `extensions`, `manifest`, `serviceWorker`, `securityTxt`, `images` and `copy` added; `$schema` added or stated as excluded because it is meta, as the detail phase prefers. The `defaults` sub-list gains `dir` and `shadow`, and the `build` sub-list gains `headers`, `deploy` and `sitemap`, with `format` noted as reserved and unused, as the schema's own description says.
- Some forty nested keys (`manifest.*`, `securityTxt.*`, `serviceWorker.*`, `build.headers.security.*`) carry no `description`. The `reconcile` answer is that the rewritten §3.2 promises descriptions at the top level, which is what ships. If the detail phase wants them at every depth instead, adding them is schema code in the other direction and goes to a claim-less `implement` plan this one requires, as the two code facets above already do.
- The marker's padded-tag and redirect sentences removed once the required plan lands.

**Related**

- extensions.md §3.1 (section keys) and extensions.md §5 (schema composition and the generated entry documents).
- parser.md §9 (`Content`, the class that owns the `content` section).
- site-architecture.md §11.3 (redirect statuses and rewrites) and site-architecture.md §13.2 (i18n configuration).
