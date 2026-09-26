---
status: stub
disposition: reconcile
claims:
  - standards.md#2.1
  - standards.md#2.2
requires:
  - standards/one-canonical-url-per-catalog-entry
size: S
---

# The spec names the community-maintained specifications the corpus already cites, so its list of issuing bodies matches the catalog

## Context

`specs/standards.md` §2.1, line 29:

> **Status: Partial.** The catalog admits issuing bodies outside these eight: the `Org` union in `scripts/docs/lib/standards.ts` ends in `Other`, and `scripts/docs/standards.json` files CommonMark, GFM, JSON Feed 1.1 and Sitemaps 0.9 under `Other` and Gitignore under `Git`, which is not in the union at all. Nothing in `scripts/docs/check-standards.ts` compares a catalog entry's `org` with this list, so those five standards are cited as rows across four specs.

`specs/standards.md` §2.2, line 35:

> **Status: Partial.** The three resolutions below hold, but the rule is not applied to the rest of the corpus: CommonMark (`parser.md` §10, `jx-markdown.md` §13), GFM (`parser.md` §10), Gitignore (`studio.md` §19), and JSON Feed 1.1 and Sitemaps 0.9 (`site-architecture.md` §16) are de-facto or community formats cited as rows, while `spec.md` §18 and `imports.md` §7 keep the Custom Elements Manifest in prose for having no standards body.

Both sections were unmarked before the census. One stub owns both because they are one decision: §2.1 says which bodies may be cited and §2.2 says what falls outside them, so whatever class of non-body specification is admitted (or refused) rewrites the two together.

This plan also owns one edit that is not an open item and that neither census could make alone: CSS Containment 3 leaves the adoption backlog for a row in `spec.md` §18. `specs/standards.md` §11, line 248, keeps it as a backlog entry:

> | [CSS Containment 3](https://www.w3.org/TR/css-contain-3/) | `spec.md` §9 | `$media` is viewport-only. Container queries would need a named-container model in the style object. |

The "Why not yet" is stale. Named container queries already pass through a style object (see **What exists**). §11 is for standards "whose **owning spec section does not exist yet**", and spec.md §9.2 exists and already carries the feature, so the entry no longer belongs in the backlog. The `standards.md` census forwarded the edit to spec.md (`plans/standards/README.md`, §11). The `spec.md` census confirmed the facts and put the likely end state at a **Subset** row in §18 binding §9.2 (`plans/spec/README.md`, "§18 and CSS Containment 3"). It declined to apply the row because the row cannot land from spec.md alone: `backlog-already-cited` in `scripts/docs/check-standards.ts` fails while §11 still lists a standard a real row binds. Neither census wrote a plan, because a classified row and a backlog entry are both closed states, not open items. It lands here because this plan already rewrites the corpus's line between rows and prose, including `spec.md` §18's own prose. It also releases a `standards.md` fragment that the §11 removal can join, and the removal and the row must go in one pull request that edits both specs.

Disposition `reconcile`, a paper plan: the spec text is rewritten to what ships. `Other` has been in the `Org` union since the registry's first commit (879e01ad), `canonicalUrlProblem("Other", …)` returning `null` is pinned by `scripts/docs/lib/standards.test.ts`, and this spec's own 0.1.4 release graduated JSON Feed 1.1 off the §11 backlog into a bound row, so admitting a class under `Other` is the corpus's settled practice. `Git` is not: it is outside the declared union and passes only because the catalog is never type-checked. Correcting that entry, and making the gate refuse an `org` outside the declared set, is code work and belongs to `plan:standards/one-canonical-url-per-catalog-entry`, which this plan requires, because §2.1 cannot be true of the catalog while an entry names an undeclared body. If the detail phase decides instead that these five are not citable, the disposition becomes `implement` and the work is retiring five rows to prose in four other specs.

**What exists**

- `Org` (a closed TypeScript union ending in `"Other"`), `CatalogEntry` and `orgOfId` in `scripts/docs/lib/standards.ts`. The catalog is read by `JSON.parse(...) as Catalog`, so the union is never checked at run time, and `scripts/` is outside the root `tsconfig.json` `include`.
- Catalog entries with no recognized body: `CommonMark`, `GFM`, `JSON Feed 1.1`, `Sitemaps 0.9` (`Other`) and `Gitignore` (`Git`) in `scripts/docs/standards.json`.
- The rows citing them: `parser.md` §10 (CommonMark, GFM), `jx-markdown.md` §13 (CommonMark), `studio.md` §19 (Gitignore), `site-architecture.md` §16 (JSON Feed 1.1, Sitemaps 0.9).
- The Custom Elements Manifest kept out of the tables as "a community format with no standards body": `spec.md` §18 (for §16.8) and `imports.md` §7 (for §2, where the server consumes it).
- The generated page renders the body column from the catalog `org` (`scripts/docs/generators/standards.ts`), so `Other` and `Git` reach readers as issuing bodies.
- Container queries in a style object: `resolveAtQuery` in `packages/runtime/src/css.ts` resolves only `@--name` (through `$media`) and `@(…)`, and returns `null` for any other `@` key. `walkAt` then emits that key verbatim as its own at-rule (`const atRule = query === null ? atKey : …`), which is spec.md §9.2's standard at-rules as nested keys and §9.6's "passed through verbatim". The runtime, the compiler (`pushStyleRules` in `packages/compiler/src/shared.ts`) and `packages/site/src/site-style.ts` all reach it through `buildStyleRules`. `containerType` and `containerName` are ordinary CSSOM style keys (§9.1).
- Studio ships a named container query this way: `"@container toolbar (max-width: 1140px)"` in `packages/studio/src/surfaces/commandbar.json` (line 226) matches `container-type: inline-size; container-name: toolbar` in `packages/studio/styles/shell-frame.css` (lines 51 and 52).
- What is actually absent is a `$media`-style alias map for container conditions. `resolveAtQuery` has no `@container` branch, and nothing aliases a container condition the way `$media` names a breakpoint.
- The catalog already has the entry (`"CSS Containment 3"`, `scripts/docs/standards.json`, line 66), so the row needs no catalog change.
- spec.md §9.2 is `Partial` (its marker is owned by `plan:_shared/static-style-handle-and-descriptions`). standards.md §7.3 lets a `Partial` section take a cited row, so the row does not wait on that plan.
- No test exercises an `@container` key: nothing under `packages/*/tests` names one. The source file is admissible evidence (standards.md §6.1). A test is the strongest form, and none exists yet.

**What is missing**

- §2.1 and §2.2 rewritten to what ships: the recognized eight plus a named class for published, versioned specifications maintained outside a standards body, with the property that separates them from a library or a vendor wire format (a stable public document a conformance claim can be checked against).
- A consistent line for the Custom Elements Manifest: `spec.md` §18 and `imports.md` §7 exclude it for the same property the five cited rows have. The rewrite either admits it under the new class (and those two specs gain a row) or states what distinguishes it.
- CSS Containment 3 moves out of the backlog in one pull request that edits both specs:
  - `spec.md` §18 gains the row. The default is **Subset** binding §9.2, with a note naming what is omitted (the alias map for container conditions).
  - The standards.md §11 entry is deleted in the same pull request. With the row alone, `backlog-already-cited` fails; with the deletion alone, the standard is recorded nowhere.
  - The alternative, which keeps the entry with a "Why not yet" that names what is actually absent, holds only if detailing decides verbatim pass-through is not a conformance claim Jx makes. The existence of §9.2 argues against that, because §11's own rule sends a standard with an existing owning section to a row.
  - The row's evidence cell can name `packages/runtime/src/css.ts`. Detail decides whether the row also gets a test: a new `packages/runtime/tests/css.test.ts` case pinning an `@container <name> (…)` key emitted verbatim. That adds `packages/runtime` to this plan's workspaces and makes the plan no longer purely a paper plan.
  - Two fragments: `spec.md` gets its own, at the level detailing gives an additive row, and the §11 removal joins this plan's `standards.md` fragment.

**Related**

- standards.md §5.2 (the URL rule an admitted class needs, and the gate that refuses an undeclared body; owned by `plan:standards/one-canonical-url-per-catalog-entry`), standards.md §5.3 (title-cased identifiers for bodies that do not number documents), standards.md §9.2 (the generated page's body column).
- spec.md §18, imports.md §7 (the Custom Elements Manifest exclusion), parser.md §10, jx-markdown.md §13, studio.md §19, site-architecture.md §16.
- standards.md §11 (the backlog and `backlog-already-cited`), standards.md §7.3 (a `Partial` section accepts a cited row), spec.md §9.1, §9.2 and §9.6 (the CSS Containment 3 row's binding and the pass-through it rests on). `plan:spec/shadow-dom-parity` corrects the note on another spec.md §18 row (WHATWG DOM's "Shadow trees are not used at all"). The two plans touch the same table and conflict only textually.
- Editorial, not claimed, and cheapest in the same prose pass: §3.6 says an evasive `because:` reason "fails the gate", but only the 24-character minimum is mechanical (`MIN_REJECTION_CHARS`) and evasiveness is §8's reviewer judgment. §4.1 justifies itself by the status parser resetting "only at `## Changelog`", which is stale for the `##`-level case: `parseSpecSource` (`scripts/docs/lib/spec-status.ts`) ends every numbered section at the unnumbered heading's depth or deeper, and reports a marker left under no numbered section as a bad form. An unnumbered heading nested deeper than its numbered section still credits the enclosing section. The `section-unnumbered` message in `check-standards.ts` repeats the old reason.
