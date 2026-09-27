---
status: drafted
disposition: implement
claims: []
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - specs
  - docs
size: S
---

# The build admits no language tag or redirect status the project schema refuses, by construction

## Context

This plan claims nothing. It enables `plan:schema/project-schema-keys`, which owns schema.md §3.2 and requires it, and it holds the two facets of that section's marker that are code, so the owner can close §3.2 as a text `reconcile` of the key list.

`specs/schema.md` §3.2, line 115, ends its marker with both facets:

> The pattern does not accept every tag the build accepts: `canonicalizeLocale` (`packages/schema/src/locale.ts`) trims a tag before `Intl.Locale` parses it, so a padded `"en "` builds as `en` and fails `jx validate`. The compiler checks redirect statuses against its own `REDIRECT_HTML_POLICY` (`packages/compiler/src/site/site-build.ts`) rather than importing `REDIRECT_STATUSES`, as §7's RFC 9110 row says it does.

The contracts are schema.md §3.2's inequality ("the pattern accepts every tag the build accepts, so a project that compiles can never fail `jx validate`") and schema.md §7's RFC 9110 note ("the compiler and the Studio grid both import it rather than declaring their own"). Both are the better contract, so the code moves. Verified at the working tree on 2026-09-26:

**Language tags**

- `canonicalizeLocale` (`packages/schema/src/locale.ts`, lines 105 to 114) returns `new Intl.Locale(tag.trim()).toString()`. `Intl.Locale` itself throws a `RangeError` on every padded form tried (`"en "`, `" en"`, `"en\t"`, `"en\n"`, `" en"`, `"﻿en"`, `"en-US "`), and so does `LANGUAGE_TAG_PATTERN` (line 93). The `.trim()` is the only thing that breaks the inequality.
- The build's readers of the three patterned keys are `resolveI18n` (same file, `i18n.defaultLocale` and `i18n.locales`) and `buildSecurityTxt` (`packages/compiler/src/site/well-known.ts`, line 171, `securityTxt.preferredLanguages`). The build never schema-validates `project.json`. Measured: `resolveI18n({ i18n: { defaultLocale: "en ", locales: ["en ", " fr"] } })` returns `errors: []` and the locales `en` and `fr`.
- The stub undercounted the callers. `canonicalizeLocale` also backs `localeDirection`, `localeLabel`, `localeUrlPrefix`, `localeOfPath`, `translationPathFor`, `primaryLanguage` and `localeOfRoute` in the same file, three sites in `packages/compiler/src/site/i18n.ts`, `extensions/search/src/search-index.ts` and `extensions/feed/src/feed.ts` (each on an entry's `_meta.locale`), and Studio's `packages/studio/src/settings/locales-section.ts`, `packages/studio/src/i18n/i18n-commands.ts` and (via `isWellFormedLocale`) `packages/studio/src/workspace/session.ts`. `resolveI18n` itself is read by `packages/site/src/compose.ts`, `extensions/parser/src/content-loader.ts`, both extensions above and seven Studio modules. Decisions below say what each sees once the trim goes.
- `packages/schema/tests/locale.test.ts`: `canonicalizeLocale` "applies BCP 47 case conventions" pins the trim (`"  fr-ca  "` to `fr-CA`, line 255), and "accepts every tag canonicalizeLocale accepts" (line 385) tests `pattern.test(tag.trim())` over a corpus with no padded tag, so it trims away exactly the case that breaks the contract it states.

**Redirect statuses**

- `REDIRECT_STATUSES = [301, 302, 303, 307, 308] as const` (`packages/schema/defs/project-config.schema.ts`, line 10) feeds the schema's `redirects` status enum and `packages/studio/src/grid/redirects.ts` (through `@jxsuite/schema/defs`).
- `packages/compiler/src/site/site-build.ts` declares `REDIRECT_HTML_POLICY: Record<number, …>` over the same five statuses (line 2384). `generateRedirects` validates a rule against its keys (line 2438), lists them in the error, and later reads `REDIRECT_HTML_POLICY[status]!` (line 2474). A sixth status added to the schema would pass `jx validate` and fail the build as "not an RFC 9110 §15.4 redirection status". An orphaned JSDoc block ("Generate redirect files…", `@returns {number}`) sits above the policy's own comment.
- `packages/compiler/tests/site-build.test.ts` covers 301, 302, 303, 308, a rewrite and an off-enum 418 ("an off-enum status is a build error naming the rule"). No case builds a 307.

**Related.** `plan:site-architecture/locale-negotiation-gaps` also edits `resolveI18n` (the `defaultLocale` order), a textual neighbour with no ordering between the two. `plan:spec/expression-build-checks` owns the open question of whether `jx build` runs schema validation; see Decisions.

## Outcome

- The build refuses exactly what `LANGUAGE_TAG_PATTERN` refuses on surrounding whitespace, so schema.md §3.2's inequality holds with no trimming anywhere, and the corpus test pins it on padded input.
- The compiler's redirect policy is keyed by `REDIRECT_STATUSES`: a status the schema admits cannot lack a policy (typecheck fails), and the error lists the schema's statuses.
- schema.md §3.2's marker loses its two code sentences and stays `Partial` on the key list alone, for `plan:schema/project-schema-keys` to close. schema.md §7's BCP 47 and RFC 9110 notes become true unedited. No claim changes state here.

## Decisions

- **Open:** does the build refuse a padded tag, or does the pattern admit surrounding whitespace? Recommendation: refuse. A locale is a URL prefix, an `hreflang` and an `<html lang>` at once (`resolveI18n`'s own reasoning for making a malformed tag a build error), the RFC 5646 grammar has no whitespace, and a widened pattern would put invisible characters into the set `jx validate` blesses and every raw reader of `project.json` (Studio's Locales rows among them) displays. The cost a maintainer signs: a project whose `project.json` holds `"en "` stops building. It already fails `jx validate`.
- **Decided:** the refusal lives in `canonicalizeLocale` (the `.trim()` goes), not in `resolveI18n` and `well-known.ts`, because it is the one grammar every tag in the repository passes through (its module comment says so) and `LANGUAGE_TAG_PATTERN`'s contract is written against it; a check at two call sites is one the next caller forgets. What the other callers see: Studio's Locales form trims at its input edge (`add` and `pendingRefusal` both call `.pending.trim()`), so typing `"  FR-ca  "` still adds `fr-CA`; the `i18n.addLocale` command throws on a padded argument as it throws on `en_US`, and `addProjectLocale`'s notification already says "Underscores and spaces are not part of the grammar"; path and route segments carry no whitespace; every `resolveI18n` reader (`packages/site`'s dev composer, the parser's content loader, Studio's panels) drops a padded locale from the resolved list as it drops `en_US` today; search and feed canonicalize an entry's `_meta.locale`, which the content loader copies from that resolved list, so it is never padded; a stored Studio session's `previewLocale` is written by the canvas's locale control from the declared list, so only a hand-edited padded one changes, and it is now dropped on restore instead of kept verbatim. A padded `$lang` or `defaults.lang`, which no pattern covers, now derives `ltr` and `localeLabel` falls back to the raw tag. That is accepted: `pageLanguage` (`packages/compiler/src/site/i18n.ts`) writes the tag into `<html lang>` verbatim, so the direction is now derived from the tag the page carries rather than from a trimmed copy of it.
- **Decided:** a tag whose only defect is surrounding whitespace gets its own error sentence, from one helper shared by `resolveI18n` and `buildSecurityTxt`, because the defect is invisible in a quoted value (`JSON.stringify` does not escape U+00A0) and "is not a well-formed BCP 47 language tag" reads as wrong about `"en "`. Every other malformed tag keeps today's sentence, so the error `docs/framework/site/i18n.md` quotes is unchanged.
- **Decided:** the redirect facet is implemented, not reconciled. `satisfies Record<RedirectStatus, …>` rejects both a missing and an extra key at `bun run typecheck`, which the `checks` job runs, so the stub's fallback (rewording §7's note to admit a second table) is not needed. The membership guard stays module-private in `site-build.ts`: it is one line over the imported list, not a second list, and moving it into `@jxsuite/schema/defs` would pull Studio's `redirects.ts` into the diff for no behaviour change.
- **Decided:** no `requires` edge on `plan:spec/expression-build-checks`. This plan assumes the build keeps not schema-validating `project.json`, and is right under either answer: if the build later validates, the padded tag and the off-enum status are refused twice, and the shared grammar still governs Studio, the dev server and `security.txt`, which no build-time validation reaches.
- **Decided:** this PR removes the two sentences from schema.md §3.2's marker, because the PR that makes a sentence false is the one whose reviewer can confirm it, and leaving them would publish a stale marker until the owner lands. The marker itself stays, owned by `plan:schema/project-schema-keys`.

## Implementation

1. **`packages/schema/src/locale.ts`**
   - `canonicalizeLocale`: the body becomes `if (typeof tag !== "string") { return null; }` then `try { return new Intl.Locale(tag).toString(); } catch { return null; }`. The empty and all-blank cases still return null because `Intl.Locale` throws on both. Add to its doc comment: no trimming, because whitespace is outside the RFC 5646 grammar and `LANGUAGE_TAG_PATTERN`; a tag trimmed here would build and fail `jx validate` (schema.md §3.2); an input that takes typed text trims before calling.
   - Add `export function malformedLocaleError(key: string, tag: unknown): string`. When `typeof tag === "string" && tag.trim() !== tag && canonicalizeLocale(tag.trim()) !== null`, return `` `${key}: ${JSON.stringify(tag)} has whitespace around it, which is not part of a language tag. Write ${JSON.stringify(tag.trim())}.` ``. Otherwise return `` `${key}: "${String(tag)}" is not a well-formed BCP 47 language tag.` `` (today's `resolveI18n` wording, byte for byte). Doc comment: the build error for a tag `canonicalizeLocale` refused, naming the key; why whitespace gets its own sentence.
   - `resolveI18n`: the two `errors.push` calls for a refused tag become `errors.push(malformedLocaleError("i18n.locales", tag))` and `errors.push(malformedLocaleError("i18n.defaultLocale", raw.defaultLocale))`.
2. **`packages/compiler/src/site/well-known.ts`**: import `malformedLocaleError` beside `canonicalizeLocale` from `@jxsuite/schema/locale`; line 173 becomes `errors.push(malformedLocaleError("securityTxt.preferredLanguages", tag))`. (Its sentence gains "BCP 47"; the one test asserts only that the tag appears.)
3. **`packages/compiler/src/site/site-build.ts`**
   - `import { REDIRECT_STATUSES } from "@jxsuite/schema/defs";` with the other schema imports.
   - Delete the orphaned "Generate redirect files (HTML meta refresh and _redirects)" JSDoc block above the policy comment.
   - Beside the policy: `type RedirectStatus = (typeof REDIRECT_STATUSES)[number];`, `interface RedirectHtmlPolicy { html: boolean; canonical: boolean; why: string }`, and `function isRedirectStatus(status: number): status is RedirectStatus { return (REDIRECT_STATUSES as readonly number[]).includes(status); }`.
   - `const REDIRECT_HTML_POLICY = { …the five entries unchanged… } satisfies Record<RedirectStatus, RedirectHtmlPolicy>;` Its comment gains one sentence: keyed by the schema's `REDIRECT_STATUSES` (schema.md §7, RFC 9110 row), so a status added there fails typecheck here until it has a policy.
   - `generateRedirects`: after computing `status`, resolve the policy once: `const policy = isRewrite ? null : isRedirectStatus(status) ? REDIRECT_HTML_POLICY[status] : undefined;`. The refusal becomes `if (policy === undefined)`, with `` `Use one of ${REDIRECT_STATUSES.join(", ")}, or ` `` in the message (same text as today). Further down, `if (isRewrite) { continue; }` plus `const policy = REDIRECT_HTML_POLICY[status]!; if (!policy.html) { continue; }` become `if (policy === null || !policy.html) { continue; }`, keeping the rewrite comment above it. No `!` remains.
4. Spec and docs edits, as listed below.
5. In the landing PR: delete this file; in `plans/schema/project-schema-keys.md` remove `schema/build-schema-agreement` from `requires` (leaving `requires: []`) and reword its Context paragraph that cites this plan to say the marker's two code sentences are already gone (cite schema.md §3.2 and §7, not a plan).

**Integration contract.** Once this lands: `canonicalizeLocale` (and so `isWellFormedLocale`, `resolveI18n` and `buildSecurityTxt`) accepts a string exactly when `new Intl.Locale(string)` does, with no normalisation beyond BCP 47 case; `malformedLocaleError(key, tag)` from `@jxsuite/schema/locale` is the build's sentence for a refused tag. `generateRedirects` admits exactly `REDIRECT_STATUSES` plus the rewrite shape, and `REDIRECT_HTML_POLICY` cannot drift from it without a type error. schema.md §3.2's marker names only the key-list defect, and §7's BCP 47 and RFC 9110 notes are true as written, so `plan:schema/project-schema-keys` may remove the marker on its list rewrite alone and touch neither note.

## Tests

**`packages/schema`** (`bun test --isolate --coverage` from `packages/schema`):

- `tests/locale.test.ts`, `canonicalizeLocale`:
  - "applies BCP 47 case conventions" drops the `"  fr-ca  "` line.
  - New "refuses surrounding whitespace rather than trimming it": each of `"en "`, `" en"`, `"\tde"`, `"fr-CA\n"`, `" ar"`, `"﻿es-419"` is `null`.
- `tests/locale.test.ts`, new `describe("malformedLocaleError")`:
  - "names the whitespace when that is the only defect": `malformedLocaleError("i18n.locales", "en ")` contains `has whitespace around it` and `Write "en"`.
  - "keeps the grammar sentence for anything else": `"en_US"` gives exactly `i18n.locales: "en_US" is not a well-formed BCP 47 language tag.`; `" en_US"` (whitespace and a bad separator) and `42` give the grammar sentence too.
- `tests/locale.test.ts`, `resolveI18n`, new "a padded tag is a build error, not a silent trim": the census's own input, `project({ defaultLocale: "en ", locales: ["en ", " fr"] })`, returns `i18n: null` and errors that include one naming `i18n.defaultLocale` and one per padded locale, each saying `whitespace`. A second assertion: `project({ defaultLocale: "en", locales: ["en", " fr"] })` resolves `locales` to `["en"]` with one error.
- `tests/locale.test.ts`, `LANGUAGE_TAG_PATTERN`: "rejects the shape errors an author actually makes" gains `"en "` and `" en"`; the corpus test tests `pattern.test(tag)` (no `.trim()`) and its corpus gains `"en "`, `" fr-CA"`, `"\tde"`, `"es-419\n"` and `" ar"`. Before step 1 those entries fail it; after, `canonicalizeLocale` refuses them.
- `tests/validate-project.test.ts`, new beside the `en_US` case, "a padded locale tag is refused at author time and at build time": one config `i18n: { defaultLocale: "en", locales: ["en", "fr "] }`; `validateProjectFile` is invalid with `pattern` in its errors, and `resolveI18n` of the same config reports an error containing `"fr "`. This is the one test that holds both ends of the inequality side by side.

**`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`):

- `tests/well-known.test.ts`, new "a padded preferred language is a build error that names the whitespace": `preferredLanguages: ["en "]` yields `files: []` and `errors[0]` containing `securityTxt.preferredLanguages` and `whitespace`.
- `tests/site-build.test.ts`, "an off-enum status is a build error naming the rule" is widened and renamed "every status the schema admits builds, and any other is a build error naming the rule". Its temp project's `redirects` becomes one rule per `REDIRECT_STATUSES` member (`/s301` to `/s308`, destination `/x`) plus `/bad` at 418. Assert: `result.errors.filter((e) => e.startsWith("Redirect "))` has length 1 and contains `/bad`, `418` and `REDIRECT_STATUSES.join(", ")`; `dist/_redirects` has `/s<status> /x <status>` for every member and no `418`; `dist/s301/index.html` exists and `dist/s307/index.html` does not. `REDIRECT_STATUSES` is imported from `@jxsuite/schema/defs`, so a sixth status reaches this test the day it reaches the schema. This adds the first 307 build.

**Studio** is not changed, but `affected.ts` runs its suite because `packages/schema` moved. `tests/locales-section.test.ts` "Add appends the canonical tag…" types `"  FR-ca  "` and must stay green unchanged; that is the proof that trimming now lives at the input edge.

**Coverage.** No source file is added, so neither manifest check moves. `locale.ts` gains one function whose two branches each have a case; `site-build.ts` trades a `!` lookup for a typed one. Thresholds are `lines = 0.99, functions = 0.99` (`packages/schema/bunfig.toml`) and `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`); no ratchet is expected unless the run shows a worst file moved.

## Specs & docs

**`specs/schema.md` §3.2**, in place:

- The marker (line 115) keeps `> **Status: Partial.**` and its first sentence (the key list) and loses the last two: "The pattern does not accept every tag the build accepts: … fails `jx validate`." and "The compiler checks redirect statuses … as §7's RFC 9110 row says it does."
- The paragraph "The pattern is deliberately looser than the build's `Intl.Locale` parse…" gains, before its last sentence ("A test asserts the inequality…"): "Neither side trims: surrounding whitespace is outside the pattern and the grammar alike, so `"en "` fails `jx validate` and the build rather than building as `en`."

**`specs/schema.md` §7**: no edit. The BCP 47 note ("a test pins that the pattern accepts everything that parse accepts") and the RFC 9110 note ("the compiler and the Studio grid both import it") become true. Their tier still follows §3.2's marker until the owner closes it.

**Fragment:** `bun run spec:change schema.md minor -m "§3.2: the build refuses a language tag with surrounding whitespace instead of trimming it, so the pattern accepts every tag the build accepts, and the compiler keys its redirect policy by REDIRECT_STATUSES."` Minor, because this is an implement that changes what the build accepts.

**`specs/site-architecture.md`**: no edit. §13.2 already says a malformed tag is a build error under the RFC 5646 grammar, which a padded tag now is, and §11.3's five statuses and fallback table are unchanged.

**Docs** (no em dashes). `bun run docs:sync` names `docs/framework/site/i18n.md` (`code:` lists `locale.ts`), `docs/framework/site/redirects.md`, `docs/framework/site/seo.md`, `docs/framework/build.md`, `docs/framework/concepts/color-schemes.md` (`site-build.ts`) and `docs/framework/site/deployment.md` (`site-build.ts`, `well-known.ts`).

- `docs/framework/site/i18n.md`, "Tags are checked", after the paragraph that begins "Tags are also **canonicalized**": add "Canonicalizing fixes case and nothing else. A tag with a space before or after it, like `"en "`, fails the build and `jx validate` alike, and the build error says the whitespace is the problem."
- The other five: no change. The redirect statuses, fallbacks and error behaviour are identical, and deployment.md's `security.txt` section does not describe tag validation.

No graduation: schema.md keeps its other open items (§3.1, the §3.2 list, §3.4, §3.5, §4), and `plans/schema/` stays.

## Acceptance

- From `packages/schema` and from `packages/compiler`, `bun test --isolate --coverage` is green with the new cases, and `bun scripts/check-coverage-manifest.ts packages/schema` and `… packages/compiler` pass from the root.
- `bun -e 'import { resolveI18n } from "./packages/schema/src/locale.ts"; console.log(resolveI18n({ i18n: { defaultLocale: "en ", locales: ["en ", " fr"] } }))'` prints `i18n: null` and three whitespace errors plus the no-usable-locale error.
- `bun run typecheck` is green. As a throwaway check, appending `309` to `REDIRECT_STATUSES` makes it fail in `site-build.ts` on the `satisfies` clause (revert afterwards).
- `git grep -n "Record<number" packages/compiler/src/site/site-build.ts` finds no redirect table, and `git grep -n "trim()" packages/schema/src/locale.ts` finds none inside `canonicalizeLocale`.
- `bun run docs:status` shows schema.md §3.2 still `Partial` with a one-sentence marker; `bun run plans:status --who-claims schema.md#3.2` still names `schema/project-schema-keys`.
- `bun run docs:spec-release` finds the fragment; `bun run plans:check`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` are green.
