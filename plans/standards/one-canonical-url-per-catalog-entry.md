---
status: stub
disposition: implement
claims:
  - standards.md#5.2
  - standards.md#5.3
size: S
workspaces:
  - scripts/docs
---

# Every catalog entry names a declared body, one canonical URL and one identifier, and the gate enforces all three rather than the catalog's current contents

## Context

`specs/standards.md` §5.2, line 152:

> **Status: Partial.** `CANONICAL` in `scripts/docs/lib/standards.ts` enforces the forms below through `canonicalUrlProblem`, but three patterns admit a second spelling of the same document: the WHATWG pattern accepts a trailing `#fragment`, the IANA pattern an optional trailing `/`, and the JSON Schema pattern any path, a trailing `/` included, which the table's `https://json-schema.org/…` form does not pin either. An entry whose org is `Other`, or is outside the `Org` union, is never checked, so §10's RFC 3986 claim of no query and no fragment holds today only because no catalog URL carries one.

`specs/standards.md` §5.3, line 169:

> **Status: Partial.** `STANDARD_ID` in `scripts/docs/lib/standards.ts` accepts every form below, and `catalog-org-mismatch` in `scripts/docs/check-standards.ts` rejects a numbered identifier filed under the wrong body, but the converse is unchecked: `orgOfId` infers no body from a title-cased name, so a document of a body that numbers its documents may be catalogued under one (`HTTP Semantics` filed under IETF passes), and nothing stops two catalog entries from sharing a URL. Every current entry complies, so the identifier is stable across specs because of the catalog's contents rather than the gate.

Both sections were unmarked before the census. Disposition `implement`: the spec's rules are right and the gate is lax. §5.2's own reasoning ("one canonical form per body is deliberate: two would mean the same RFC gets two spellings") is what the optional fragment and slashes break, §10's `**Subset**` row for RFC 3986 states the stricter rule as a fact about the code, and §5.3's stable identifier is what two entries for one document would break. One plan owns both because they are one property, one spelling per standard, enforced in the same function (`checkCatalog`) over the same file.

**What exists**

- `CANONICAL` and `canonicalUrlProblem` in `scripts/docs/lib/standards.ts`: a pattern per body, `Other: null`, and an early `return null` when `CANONICAL[org]` is falsy, which also covers an `org` string outside the union. The JSON Schema pattern is `^https:\/\/json-schema\.org\/[A-Za-z0-9/-]+$`, so `https://json-schema.org/draft/2020-12/schema/` and `https://json-schema.org/draft/2020-12` both pass beside the catalog's `https://json-schema.org/draft/2020-12/schema`.
- `orgOfId` (numbered identifier to body, `null` for a title-cased name) and `STANDARD_ID`, whose last branch accepts any title-cased name.
- `checkCatalog` in `scripts/docs/check-standards.ts`: `catalog-org-mismatch` only when `orgOfId` infers a body, `catalog-url-noncanonical` from `canonicalUrlProblem`, `catalog-duplicate-id`, and no comparison of URLs across entries.
- `scripts/docs/lib/standards.test.ts` ("canonicalUrlProblem accepts the canonical form and rejects the rest"), which pins `canonicalUrlProblem("Other", "https://anything/")` as `null`.
- The catalog (`scripts/docs/standards.json`): every WHATWG entry (DOM, Fetch, HTML, URLPattern) is already the bare `https://<spec>.spec.whatwg.org/`, both IANA entries (`iana-ipv4-special-registry`, `iana-ipv6-special-registry`) carry no trailing slash, no title-cased entry belongs to IETF, Unicode, Ecma or ISO, and no two entries share a URL, so tightening moves no citation. `Gitignore` is filed under `Git`, outside the union, and is the one entry the tightened gate would refuse.
- The §10 row: `[RFC 3986]` `**Subset**` binding §5.2, evidence `scripts/docs/lib/standards.ts`.

**What is missing**

- The `(#[A-Za-z0-9-]+)?` group removed from the WHATWG pattern and the `\/?` from the IANA one, with a rejecting case for each in the unit test.
- A single JSON Schema form, for example `https://json-schema.org/draft/<version>/schema` with no trailing slash, pinned in both the pattern and the §5.2 table row, with a rejecting case.
- A rule for every admitted body, so `CANONICAL` has no `null` entry: at minimum an absolute `https` URL with no query and no fragment for the non-body class §2.1 admits, and a matching row in §5.2's table.
- An `org` outside the declared set treated as a failure rather than a pass (one violation, in `checkCatalog`), and `Gitignore`'s entry moved into the declared set, so no catalog entry names an undeclared body.
- For §5.3: an entry whose `org` numbers its documents (IETF, Unicode, Ecma, ISO) must carry a numbered identifier (`orgOfId(id) === org`), and two catalog entries may not share a URL; each with a violation code in `check-standards.ts` and a case in `scripts/docs/check-standards.test.ts`.

**Related**

- standards.md §2.1 and §2.2 (which non-body class exists to need a form; `plan:standards/citable-community-specifications`, which requires this plan), standards.md §10 (the RFC 3986 row this makes true), standards.md §4.3 (a row's URL must equal the catalog's), standards.md §5.1 (the catalog as a lexicon).
- RFC 3986 generic syntax, as bound by the §10 row.
