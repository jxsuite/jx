---
status: drafted
disposition: implement
claims:
  - standards.md#5.2
  - standards.md#5.3
requires: []
workspaces:
  - scripts/docs
size: S
---

# Every catalog entry names a declared body, one canonical URL and one identifier, and the gate enforces all three rather than the catalog's current contents

## Context

`specs/standards.md` §5.2, line 152:

> **Status: Partial.** `CANONICAL` in `scripts/docs/lib/standards.ts` enforces the forms below through `canonicalUrlProblem`, but three patterns admit a second spelling of the same document: the WHATWG pattern accepts a trailing `#fragment`, the IANA pattern an optional trailing `/`, and the JSON Schema pattern any path, a trailing `/` included, which the table's `https://json-schema.org/…` form does not pin either. An entry whose org is `Other`, or is outside the `Org` union, is never checked, so §10's RFC 3986 claim of no query and no fragment holds today only because no catalog URL carries one.

`specs/standards.md` §5.3, line 169:

> **Status: Partial.** `STANDARD_ID` in `scripts/docs/lib/standards.ts` accepts every form below, and `catalog-org-mismatch` in `scripts/docs/check-standards.ts` rejects a numbered identifier filed under the wrong body, but the converse is unchecked: `orgOfId` infers no body from a title-cased name, so a document of a body that numbers its documents may be catalogued under one (`HTTP Semantics` filed under IETF passes), and nothing stops two catalog entries from sharing a URL. Every current entry complies, so the identifier is stable across specs because of the catalog's contents rather than the gate.

Both sections were unmarked before the census. The spec's rules are right and the gate is lax: §5.2's own reasoning ("two would mean the same RFC gets two spellings") is what the optional fragment and slash break, §10's `**Subset**` RFC 3986 row states the stricter rule as a fact about the code, and §5.3's stable identifier is what two entries for one document break. One plan owns both because they are one property (one spelling per standard) enforced in one function (`checkCatalog`) over one file.

**What exists** (verified against the working tree on 2026-09-27)

- `scripts/docs/lib/standards.ts`: `type Org` is a closed TypeScript union ending in `"Other"`, with no runtime list. `CANONICAL: Record<Org, { test; form } | null>` has `Other: null`, and `canonicalUrlProblem` returns `null` whenever `CANONICAL[org]` is falsy, which also covers an `org` string outside the union. WHATWG is `^https:\/\/[a-z]+\.spec\.whatwg\.org\/(#[A-Za-z0-9-]+)?$`, IANA ends `[A-Za-z0-9-]+\/?$`, JSON Schema is `^https:\/\/json-schema\.org\/[A-Za-z0-9/-]+$`. All three lax groups date from the registry's first commit (879e01ad) with no recorded reason. `orgOfId` maps `RFC`/`BCP`/`STD` to IETF, `UAX`/`UTS`/`UTR #` to Unicode, `ECMA-` to Ecma and `ISO` to ISO, and returns `null` otherwise.
- `readCatalog` is `JSON.parse(...) as Catalog`, and `scripts/` is outside the root `tsconfig.json` `include`, so nothing checks `org` against the union: `Gitignore` is filed under `"Git"` and passes.
- `checkCatalog` in `scripts/docs/check-standards.ts`: `catalog-duplicate-id`, `catalog-unsorted`, `catalog-org-mismatch` (only when `orgOfId` infers a body), `catalog-url-noncanonical`, `catalog-stale`. No URL is compared across entries, and nothing checks that the number in an identifier is the number its URL names (`RFC 9110` catalogued at `…/rfc9111` passes).
- Rows inherit the catalog's form: `url-mismatch` (a row) and `backlog-url-mismatch` (a §11 entry) require the cited URL to equal the catalog's, so tightening the catalog tightens every citation in every spec.
- Tests: `scripts/docs/lib/standards.test.ts` ("orgOfId infers the issuing body from the identifier", "canonicalUrlProblem accepts the canonical form and rejects the rest", which pins `canonicalUrlProblem("Other", "https://anything/")` as `null`). `scripts/docs/check-standards.test.ts` (one rule test per code in `describe("identity and citation")`, the golden "the gate is green on what is committed", and an `afterAll` meta-test that fails when any code in `VIOLATION_CODES` is never exercised).
- The catalog (`scripts/docs/standards.json`, 82 entries): 32 IETF, 29 W3C, 5 Unicode, 4 Ecma, 4 WHATWG, 2 IANA, 1 JSON Schema, 4 `Other` (CommonMark, GFM, JSON Feed 1.1, Sitemaps 0.9) and 1 `Git` (Gitignore). A probe of the rules below over the committed catalog, with Gitignore filed under `Other`, reports nothing: no WHATWG fragment, no IANA trailing slash, JSON Schema at `https://json-schema.org/draft/2020-12/schema` (the value `packages/schema/src` writes in `$schema`, and what rows in four specs cite), no title-cased entry under a numbering body, every number agreeing with its URL, no `Other` URL on a recognized body's domain, and no shared URL. No citation moves.
- Docs: no page's `spec:` cites `standards.md#5.2` or `#5.3`, and no page's `code:` lists these files. `docs/extending/reference/standards.md` is generated and gitignored; it renders the catalog's `org` as the body column.

## Outcome

- standards.md §5.2 → Implemented: every body in the table, `Other` included, has one exact form; none admits a port, query or fragment; an `org` outside the table fails; an `Other` URL on a recognized body's domain fails.
- standards.md §5.3 → Implemented: an entry under a body that numbers its documents carries a numbered identifier whose number its URL repeats, and no two entries share a URL.
- §10's RFC 3986 `**Subset**` row becomes true by construction and gains a test as evidence.
- standards.md does not graduate: §2.1 and §2.2 stay open under `plan:standards/citable-community-specifications`, which requires this plan.

## Decisions

- **Open:** does the catalog keep one `Other` body for specifications maintained outside the eight, with Gitignore moving into it, rather than retiring the five community rows to prose or recording each maintainer as a body of its own? Recommendation: keep `Other` and file Gitignore under it, because admitting that class is the corpus's settled practice (the 0.1.4 release graduated JSON Feed 1.1 to a bound row under `Other`), because only a closed set lets the gate refuse an unknown body at all, and because retiring five rows in four specs belongs to `plan:standards/citable-community-specifications`. This is the code half of the spec-wide decision in `plans/standards/README.md`, so sign it together with that plan's §2.1/§2.2 decision. If the answer is to retire the class, `Other` leaves `ORGS`, `CANONICAL` and the §5.2 table here instead of gaining a rule, and the edge between the two plans reverses (the rows must be retired before the gate refuses `Other`).
- **Decided:** the bodies become a runtime list, `ORGS`, with `type Org = (typeof ORGS)[number]` and `isOrg`, mirroring `CONFORMANCE_VOCAB`/`isConformance`, because the catalog is untyped JSON and `scripts/` is not typechecked, so only a runtime check can refuse `Git`. `CANONICAL` becomes `Record<Org, Rule>` with no `null`.
- **Decided:** the `Other` form is `^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s?#]*$` (a lower-case dotted host, no userinfo or port, a path beginning with `/`, no query, no fragment), because it cannot pin a host, so it pins what RFC 3986 lets it: the serialized form `new URL()` produces, which also rules out the `https://host` and `https://host/` pair. It is the one form under which a trailing-slash variant stays expressible, which the duplicate-URL key below covers.
- **Decided:** an `Other` URL on a recognized body's domain is a `catalog-org-mismatch`, through a new `orgOfUrl` that mirrors `orgOfId`, because otherwise `Other` bypasses both sections at once: `HTTP Semantics` at `https://www.rfc-editor.org/rfc/rfc9110` filed under `Other` passes every other rule. The domains are registrable suffixes (`rfc-editor.org` and `ietf.org` for IETF, `w3.org`, `whatwg.org`, `unicode.org`, `ecma-international.org`, `iana.org`, `iso.org`, `json-schema.org`), matched on a dot boundary. It runs for every entry; for the eight bodies it can only repeat a `catalog-url-noncanonical`, which names the body as a bonus.
- **Decided:** the JSON Schema form is `https://json-schema.org/draft/YYYY-MM/schema`, the draft's meta-schema URI, because that is what every citation and every `$schema` in `packages/schema` already uses. A future JSON Schema release published under another URI shape is a one-row spec edit with its pattern, made when it is first cited.
- **Decided:** the numbering bodies are one table, `NUMBERED_ID` (IETF, Unicode, Ecma, ISO), each with an identifier pattern and, where the URL repeats the number, a URL pattern; `orgOfId` iterates it and a new `numbersItsDocuments(org)` reads its keys, because two lists of which bodies number their documents would drift. ISO has no URL pattern: `www.iso.org/standard/NNNNN.html` carries a catalogue number, not the standard's.
- **Decided:** the number check (`catalog-url-number-mismatch`) is in scope although neither marker names it, because it is the remaining way one identifier names a different document than its URL, and §5.1's reason for the catalog (catching a typo'd RFC number offline) holds only if the catalog's own pair is right. It compares the kind and number (`RFC 9110` with `rfc9110`, `BCP 47` with `bcp47`, `UAX #15` with `tr15`, `ECMA-262` with `ecma-262`).
- **Decided:** two URLs are the same document when `new URL(url).href` agrees after one trailing `/` is dropped, because the eight body forms and `Other`'s lower-case host are already exact, so the one second spelling left (`Other`'s optional trailing slash) is exactly what that key folds.
- **Decided:** an unknown `org` is reported once, as `catalog-org-unknown`, and skips the org-dependent checks for that entry; `canonicalUrlProblem` stays total by returning a problem string for an undeclared body instead of `null`, because a checker that can throw on its own input is a checker that stops checking.

## Implementation

**`scripts/docs/lib/standards.ts`**

- Replace `type Org` with `export const ORGS = ["IETF", "W3C", "WHATWG", "Unicode", "Ecma", "IANA", "ISO", "JSON Schema", "Other"] as const;`, `export type Org = (typeof ORGS)[number];` and `export function isOrg(value: string): value is Org`. `CatalogEntry.org` stays `Org`.
- Add `NUMBERED_ID` (not exported):

  ```ts
  const NUMBERED_ID = {
    IETF: {
      id: /^(RFC|BCP|STD) (\d+)$/,
      url: /\/(rfc|bcp|std)(\d+)$/,
      form: "RFC NNNN, BCP NN or STD NN",
    },
    Unicode: {
      id: /^(?:UAX|UTS|UTR) #(\d+)$/,
      url: /\/tr(\d+)\/$/,
      form: "UAX #NN, UTS #NN or UTR #NN",
    },
    Ecma: { id: /^ECMA-(\d+)$/, url: /\/ecma-(\d+)\/$/, form: "ECMA-NNN" },
    ISO: { id: /^ISO(?:\/IEC)? \d+/, form: "ISO NNNN or ISO/IEC NNNN" },
  } as const satisfies Partial<Record<Org, { id: RegExp; url?: RegExp; form: string }>>;
  ```

  Rewrite `orgOfId` to return the first key whose `id` matches (same results as today; the existing test pins them). Add `export function numbersItsDocuments(org: Org): boolean` (`Object.hasOwn(NUMBERED_ID, org)`) and `export function urlNumberProblem(org: Org, id: string, url: string): string | null`, which returns `null` unless `org` has both patterns, the id matches and the URL's captured kind and number, lower-cased and joined, differ from the id's (for example `"RFC 9110" names rfc9110 but the URL names rfc9111`).

- Add `export function orgOfUrl(url: string): Org | null` over a `BODY_DOMAINS` list (the suffixes in Decisions), parsing with `new URL` in a `try` and returning `null` for an unparseable URL or an unlisted host.
- Add `export function urlKey(url: string): string`: `new URL(url).href` minus one trailing `/`, or `url` itself when it does not parse.
- `CANONICAL`: drop `(#[A-Za-z0-9-]+)?` from WHATWG and `\/?` from IANA; JSON Schema becomes `^https:\/\/json-schema\.org\/draft\/\d{4}-\d{2}\/schema$` with form `https://json-schema.org/draft/YYYY-MM/schema`; `Other` gets the pattern in Decisions with form `https://<host>/<path>, with no port, query or fragment`. Type it `Record<Org, { test: RegExp; form: string }>`. In `canonicalUrlProblem`, replace `if (!rule) return null` with a returned problem naming the undeclared body.

**`scripts/docs/check-standards.ts`**

- Add `"catalog-org-unknown"`, `"catalog-id-unnumbered"`, `"catalog-url-number-mismatch"` and `"catalog-duplicate-url"` to `VIOLATION_CODES` under "Identity and citation", beside the existing `catalog-*` codes. Import `isOrg`, `ORGS`, `orgOfUrl`, `numbersItsDocuments`, `urlNumberProblem`, `urlKey`.
- `checkCatalog`, inside the existing `for (const [id, entry] of reg.catalog)` loop, before `catalog-stale`:
  - `!isOrg(entry.org)`: push `catalog-org-unknown` (`"<id>" is filed under "<org>", which is not an issuing body standards.md §5.2 lists (<ORGS joined>)`) and skip the four checks below.
  - Otherwise keep the `orgOfId` mismatch; add a second `catalog-org-mismatch` when `orgOfUrl(entry.url)` is non-null and differs (`"<id>" is on a <body> domain but the catalog says <org>`); push `catalog-id-unnumbered` when `numbersItsDocuments(entry.org) && orgOfId(id) === null` (naming the body's `form`); push `catalog-url-number-mismatch` from `urlNumberProblem`; keep `catalog-url-noncanonical`.
  - Keep a `Map<string, string>` from `urlKey(entry.url)` to the first id; a second id with the same key pushes `catalog-duplicate-url` naming both ids and the URL.
- Correct the file's header comment only if it lists the catalog checks (it does not today).

**`scripts/docs/standards.json`**: the `Gitignore` entry's `"org": "Git"` becomes `"Other"`. Nothing else in the catalog changes, and no spec row changes.

**Integration contract.** Once this lands, `plan:standards/citable-community-specifications` may rely on: `ORGS` (exported, with `"Other"` its last member) as the one list of bodies the catalog admits, and `isOrg`; every catalog entry, Gitignore included, filed under a member of `ORGS`; `bun run docs:standards` refusing any other `org` as `catalog-org-unknown` and any `Other` URL on a recognized body's domain as `catalog-org-mismatch`; §5.2's table carrying an `Other` row, and §2.1's marker stating that the five standards are filed under `Other` and nothing else is admitted. A plan that names the `Other` class in prose changes no code; one that renames or removes it edits `ORGS`, `CANONICAL`, the test's per-body example table (which fails until it does) and the §5.2 row together.

## Tests

`bun test --isolate scripts` runs both suites (the `changes` job does the same); locally, `bun test --isolate scripts/docs/lib/standards.test.ts scripts/docs/check-standards.test.ts`.

- **`scripts/docs/lib/standards.test.ts`**, `describe("pure helpers")`:
  - Extend "canonicalUrlProblem accepts the canonical form and rejects the rest": `WHATWG` with `https://html.spec.whatwg.org/#the-template-element` is a problem; `IANA` with `https://www.iana.org/assignments/iana-ipv4-special-registry` is `null` and with a trailing `/` a problem; `JSON Schema` with `https://json-schema.org/draft/2020-12/schema` is `null`, and with `…/schema/`, `https://json-schema.org/draft/2020-12` or `https://json-schema.org/understanding-json-schema/` a problem; `Other` with `https://spec.commonmark.org/current/` and `https://git-scm.com/docs/gitignore` is `null`, and with `…/current/?v=1`, `…/current/#tabs`, `http://spec.commonmark.org/current/`, `https://spec.commonmark.org:8443/current/`, `https://spec.commonmark.org` and `https://anything/` a problem. The old `("Other", "https://anything/")` → `null` assertion is replaced, not kept. `canonicalUrlProblem("Git" as Org, …)` is a problem, not a throw.
  - New `every declared body has a canonical form, and none admits a query or a fragment`: a test-local `EXAMPLE: Record<Org, string>` with one canonical URL per body; assert `Object.keys(EXAMPLE)` equals `[...ORGS]` (a new body without an example fails), each example passes, and each example with `?q=1` or `#f` appended fails. This is the new evidence for §10's RFC 3986 row.
  - New `orgOfUrl infers the body from a recognized domain`: `https://www.rfc-editor.org/rfc/rfc9110` and `https://datatracker.ietf.org/doc/html/rfc9110` → IETF, `https://dom.spec.whatwg.org/` → WHATWG, `https://www.w3.org/TR/css-contain-3/` → W3C, `https://json-schema.org/draft/2020-12/schema` → JSON Schema; `https://spec.commonmark.org/current/`, `https://notw3.org/` (dot boundary) and `not a url` → `null`.
  - New `numbersItsDocuments and urlNumberProblem agree with orgOfId`: `true` for IETF, Unicode, Ecma, ISO and `false` for the other five; `urlNumberProblem` is `null` for `RFC 9110`/`rfc9110`, `BCP 47`/`info/bcp47`, `UAX #9`/`tr9/`, `ECMA-262`/`ecma-262/` and any ISO pair, and a problem for `RFC 9110`/`rfc9111`, `BCP 47`/`std47`, `UAX #15`/`tr29/`.
  - New `urlKey folds a trailing slash and host case only`: `https://Spec.CommonMark.org/current/` and `https://spec.commonmark.org/current` share a key; `…/current/` and `…/current/x` do not; `not a url` returns itself.
  - New `isOrg knows the bodies`: `"Other"` true, `"Git"` false.
- **`scripts/docs/check-standards.test.ts`**, `describe("identity and citation")`, each with a fixture whose rows cite exactly its catalog entries, so only the rule under test matters:
  - `catalog-org-unknown: a body outside the declared set`: `Gitignore` filed under `"Git" as Org`; also `expectNoViolation(…, "catalog-url-noncanonical")`, since an unknown body is reported once.
  - `an Other entry at its own canonical URL is clean`: `CommonMark` under `Other` at `https://spec.commonmark.org/current/` produces `[]`.
  - `catalog-org-mismatch: a recognized body's URL filed under Other`: `HTTP Semantics` under `Other` at `https://www.rfc-editor.org/rfc/rfc9110`.
  - `catalog-id-unnumbered: a title-cased name under a body that numbers its documents`: `HTTP Semantics` under `IETF` at the same URL; `expectNoViolation(…, "catalog-url-noncanonical")`.
  - `catalog-url-number-mismatch: the identifier and its URL name different documents`: `RFC 6901` at `https://www.rfc-editor.org/rfc/rfc6902`.
  - `catalog-duplicate-url: two identifiers for one document`: `CommonMark` at `https://spec.commonmark.org/current/` and `CommonMark Spec` at `https://spec.commonmark.org/current`, both under `Other`, both cited; the message names both ids.
  - The golden "the gate is green on what is committed" proves the moved Gitignore entry and the other 81 entries; the `afterAll` meta-test fails until all four new codes are exercised.

Coverage: `scripts/**` has no coverage workspace, `bunfig.toml` threshold or manifest check; the meta-test is this suite's coverage gate, and no source file is added.

## Specs & docs

**standards.md**, in place:

- §5.2, line 152: the Partial marker becomes

  ```markdown
  > **Status: Implemented.** `canonicalUrlProblem` in `scripts/docs/lib/standards.ts` holds every catalog entry to its body's form below, exactly: no form admits a port, a query, a fragment or an optional trailing `/`. `bun run docs:standards` refuses an `org` that is not a row of this table (`catalog-org-unknown`) and an `Other` entry whose URL is on a listed body's domain (`catalog-org-mismatch`).
  ```

- §5.2 table: the JSON Schema row's form becomes `https://json-schema.org/draft/YYYY-MM/schema` — the draft's meta-schema URI, the value a schema's `$schema` names; a last row is added, `Other` | `https://<host>/<path>` — the specification's own URL, with no port, query or fragment, on no domain of a body above. After the table, before the `tools.ietf.org` paragraph, add: "`Other` is the body for the specifications §2.1 admits outside the recognized bodies. It is the one form that cannot pin a host, so it pins what RFC 3986 lets it: an absolute `https` URI with no query and no fragment." Re-pad the table with `bun run format`.
- §5.3, line 169: the Partial marker becomes

  ```markdown
  > **Status: Implemented.** `STANDARD_ID` in `scripts/docs/lib/standards.ts` accepts the forms below, and `scripts/docs/check-standards.ts` rejects a numbered identifier filed under another body (`catalog-org-mismatch`), a title-cased name filed under a body that numbers its documents (`catalog-id-unnumbered`), a number its URL does not repeat (`catalog-url-number-mismatch`), and two entries sharing a URL (`catalog-duplicate-url`).
  ```

  After the paragraph at line 171, add: "IETF, the Unicode Consortium, Ecma International and ISO number their documents, so an entry filed under one of them is catalogued by its number, and its URL names the same number (ISO's URL carries a catalogue number instead, so an ISO entry is exempt from that half). One document has one identifier: no two catalog entries share a URL, compared after lower-casing the host and dropping a trailing `/`."

- §2.1, line 29: the marker stays `Partial` (it belongs to `plan:standards/citable-community-specifications`) but its facts are corrected, since this plan makes two of them false: "> **Status: Partial.** The catalog admits one issuing body outside these eight: the `Org` union in `scripts/docs/lib/standards.ts` ends in `Other`, under which `scripts/docs/standards.json` files CommonMark, GFM, Gitignore, JSON Feed 1.1 and Sitemaps 0.9, and `bun run docs:standards` refuses any other `org` (`catalog-org-unknown`). This section does not name that class, so five standards it does not admit are cited as rows across four specs."
- §10, the RFC 3986 row (line 236): Evidence becomes `scripts/docs/lib/standards.ts, scripts/docs/lib/standards.test.ts`; the note reads "…admit only absolute `https` URIs with no port, no query and no fragment — a subset of the generic syntax."
- Fragment: `bun run spec:change standards.md minor -m "§5.2 and §5.3 are enforced rather than true by accident: every body's URL form is exact (WHATWG with no fragment, IANA with no trailing slash, JSON Schema as its draft meta-schema URI), Other gets a form with no port, query or fragment, an unknown org fails, a body that numbers its documents is catalogued by the number its URL names, and no two entries share a URL; Gitignore is filed under Other."`

**Docs**: no page changes. No page's `spec:` cites `standards.md#5.2` or `#5.3` and no page's `code:` lists `scripts/docs/lib/standards.ts`, `scripts/docs/check-standards.ts` or `scripts/docs/standards.json`. The generated `docs/extending/reference/standards.md` shows Gitignore's body as `Other` (and sorts it there) at the next build; nothing is committed.

**On landing**: delete this file; remove `standards/one-canonical-url-per-catalog-entry` from the `requires` of `plan:standards/citable-community-specifications` and refresh the §2.1 marker it quotes in its Context; in `plans/standards/README.md`, drop "and its RFC 3986 `**Subset**` note overclaims, which §5.2's marker records" from Verified and record under Spec-wide decisions that the gate half has landed. The spec does not graduate here.

## Acceptance

- `bun run docs:standards` exits 0 and prints "catalog is clean".
- `bun test --isolate scripts/docs/lib/standards.test.ts scripts/docs/check-standards.test.ts` passes, including the `afterAll` meta-test.
- `bun -e 'import { canonicalUrlProblem as c } from "./scripts/docs/lib/standards.ts"; for (const [o, u] of [["WHATWG", "https://html.spec.whatwg.org/#x"], ["IANA", "https://www.iana.org/assignments/x/"], ["JSON Schema", "https://json-schema.org/draft/2020-12/schema/"], ["Other", "https://spec.commonmark.org/current/?x"], ["Git", "https://git-scm.com/docs/gitignore"]]) console.log(o, c(o, u) !== null)'` prints `true` five times.
- Temporarily setting Gitignore's `org` back to `"Git"` in `scripts/docs/standards.json` makes `bun run docs:standards` fail with `catalog-org-unknown` (revert it afterwards).
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run plans:check` are green; `bun run plans:status --spec standards` lists only `standards.md#2.1` and `standards.md#2.2`.
