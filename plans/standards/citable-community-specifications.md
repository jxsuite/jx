---
status: drafted
disposition: reconcile
claims:
  - standards.md#2.1
  - standards.md#2.2
requires:
  - standards/one-canonical-url-per-catalog-entry
workspaces:
  - scripts/docs
  - packages/runtime
  - specs
  - docs
size: M
---

# standards.md admits community specifications beside the eight bodies, every spec's rows and prose follow that one rule, and the spec graduates

## Context

`specs/standards.md` §2.1, line 29, as the census left it (`plan:standards/one-canonical-url-per-catalog-entry` rewrites its facts when it lands; this plan replaces whichever text is there):

> **Status: Partial.** The catalog admits issuing bodies outside these eight: the `Org` union in `scripts/docs/lib/standards.ts` ends in `Other`, and `scripts/docs/standards.json` files CommonMark, GFM, JSON Feed 1.1 and Sitemaps 0.9 under `Other` and Gitignore under `Git`, which is not in the union at all. Nothing in `scripts/docs/check-standards.ts` compares a catalog entry's `org` with this list, so those five standards are cited as rows across four specs.

`specs/standards.md` §2.2, line 35:

> **Status: Partial.** The three resolutions below hold, but the rule is not applied to the rest of the corpus: CommonMark (`parser.md` §10, `jx-markdown.md` §13), GFM (`parser.md` §10), Gitignore (`studio.md` §19), and JSON Feed 1.1 and Sitemaps 0.9 (`site-architecture.md` §16) are de-facto or community formats cited as rows, while `spec.md` §18 and `imports.md` §7 keep the Custom Elements Manifest in prose for having no standards body.

One plan owns both because they are one decision: §2.1 says which bodies may be cited, §2.2 what falls outside them. The text lists eight bodies and excludes "a library, a framework convention, or a de-facto vendor format"; it never names the class the corpus actually cites. Disposition `reconcile`: `Other` has been in the `Org` union since the registry's first commit (879e01ad), and this spec's 0.1.4 release graduated JSON Feed 1.1 off the §11 backlog into a bound row under `Other`, so admitting that class is settled practice the text never caught up with.

**What exists** (verified 2026-09-27)

- The rows citing those five, each a cited class with committed evidence: `parser.md` §10 (CommonMark and GFM, **Subset** of §3), `jx-markdown.md` §13 (CommonMark, **Subset** of §9), `studio.md` §19 (Gitignore, **Subset** of §9.1.4, with `packages/studio/tests/gitignore-conformance.test.ts`), `site-architecture.md` §16 (JSON Feed 1.1, **Subset** of §6.7; Sitemaps 0.9, **Subset** of §8.4.1 and §13.5). That is six rows citing five standards, and every row but GFM's names a test; retiring them to prose would drop six gated claims.
- The gate half is drafted in the prerequisite: `ORGS` (the eight bodies plus `Other`) as a runtime list, `catalog-org-unknown` for any other `org`, `catalog-org-mismatch` for an `Other` URL on a listed body's domain, an `Other` URL form in §5.2 (`https://<host>/<path>`, no port, query or fragment), and Gitignore refiled under `Other`. Once it lands, the only distance between §2.1/§2.2 and the catalog is that the text does not name the class.
- The Custom Elements Manifest (CEM) is kept out of the tables for "no standards body": `spec.md` §18 ("The Custom Elements Manifest (§16.8) is a community format with no standards body.") and `imports.md` §7 ("…so it is described there rather than cited here."). It is a published, semver-versioned JSON Schema (`schemaVersion`, current 2.1.0) at `https://github.com/webcomponents/custom-elements-manifest`, which also defines the `customElements` field of `package.json` that `imports.md` §2 reads. `imports.md` §2 links `https://custom-elements-manifest.open-wc.org/`, the documentation site of an analyzer, which is a tool rather than the format.
  - Read today: the `/__studio/components` handler in `packages/server/src/studio-api.ts` follows each dependency's `customElements` field and, for a declaration with `customElement` and a `tagName`, takes `attributes`, non-private `field` members, `events`, `slots`, `cssProperties`, `description` and the module `path`. It never checks `schemaVersion`. Covered by `describe("components — CEM npm discovery")` in `packages/server/tests/studio-api.test.ts` (fixture `_studio_fixtures/cem-project`).
  - Written today: nothing. `exportCemManifest` is uncalled and `spec.md` §16.8 is Partial. The annotation shapes (`packages/schema/defs/cem.schema.ts`) follow CEM's `Parameter` and `Event`, except that a parameter's `type` may be a JSON Schema where CEM has `{ text }`.
  - Two drafted plans change those facts and add no row: `plan:imports/cem-discovery-on-every-backend` moves the read into `@jxsuite/schema` (§2 → Implemented) and `plan:spec/cem-manifest-export` makes `jx build` write a 2.1.0 manifest (§16.8 → Implemented).
- Every other non-body format the corpus names, swept against the rule below (every spec's Standards Alignment prose, plus a grep of `specs/` for the formats a build or host emits). Libraries and tools stay prose: `@vue/reactivity` (`spec.md` §18, `compiler.md` §13, `embedding.md` §9), `lit-html` (`compiler.md` §13), Yjs and `y-protocols` (`collab.md` §6), `remark-directive` (`jx-markdown.md` §13), `@webref/*` (`schema.md` §7), ElectroBun and Chromium (`desktop.md` §12), the Jx UI kit (`studio-ui-guidelines.md` §14). So do conventions and vendor formats: `@custom-media` (`spec.md` §18), OpenAI chat-completions (`ai.md` §5), the `_headers` host convention (`site-architecture.md` §14.3), `twitter:card` (an example in §8.1). So do the never-accepted CommonMark directive proposal (`jx-markdown.md` §13), a W3C note and a research page (the ARIA Authoring Practices Guide and Open UI's customizable select, `ui.md` §11), and RSS 2.0 (declined in `site-architecture.md` §6.7's prose). Four sentences or omissions do not fit it:
  - `parser.md` §10 calls "the MDAST node model" a library, but mdast is a published, versioned specification (syntax-tree/mdast). It is still not a row, because no Jx document, output or host is bound to it: it is the tree `remark` hands the transpiler, and only the parser's own modules exchange it (`jxToMdast`, `mdastToJx`, `mdastNodeToJx` have no importer outside `extensions/parser/src`). The same sentence says remark and unified "are described in §2"; §1 is where they are ("Built on the `unified` / `remark` pipeline").
  - `ui.md` §11 files the Design Tokens Community Group format among things that "are not standards". It is a community specification the tokens "may be exported to later": citable, not bound, so prose for the second reason, not the first.
  - The Open Graph protocol (`https://ogp.me/`) is bound and uncited: `site-architecture.md` §8.4's table has the build emit `og:url` (with the canonical) and `og:site_name` (from `$site.name`) unless the author supplied them (`mergeHead` in `packages/site/src/head-merger.ts`, tested by "auto-adds og:url and og:site_name" in `packages/site/tests/head-merger.test.ts`). No spec names it, as a row or as prose.
  - Schema.org is not bound yet: authors write the vocabulary into JSON-LD (whose syntax §16 cites), and the form editor `site-architecture.md` §8.6 specifies, which would model its types, is unbuilt (`plan:site-architecture/seo-structured-data-editor`).
- CSS Containment 3 (not an open item; forwarded by both censuses). `standards.md` §11, line 248, keeps it on the backlog with a stale reason: "`$media` is viewport-only. Container queries would need a named-container model in the style object." `resolveAtQuery` in `packages/runtime/src/css.ts` resolves only `@--name` and `@(…)` and returns `null` for any other `@` key, and `walkAt` then emits that key verbatim (`const atRule = query === null ? atKey : …`, line 841), which is `spec.md` §9.2's "standard at-rules" as nested keys. The runtime, the compiler (`pushStyleRules`) and `packages/site/src/site-style.ts` all reach it through `buildStyleRules`. Studio ships one: `"@container toolbar (max-width: 1140px)"` in `packages/studio/src/surfaces/commandbar.json` (line 226) against `container-type: inline-size; container-name: toolbar` in `packages/studio/styles/shell-frame.css` (lines 51 and 52). Evaluated directly, `buildStyleRules({ containerType: "inline-size", containerName: "toolbar", "@container toolbar (max-width: 1140px)": { "& .label": { display: "none" } } }, { scope: ".s" })` yields `.s { container-type: inline-size; container-name: toolbar }` and `@container toolbar (max-width: 1140px) { .s .label { display: none } }`. What is absent is a `$media`-style alias for a container condition. One host differs in evaluation, not emission: Studio's canvas renders the document inside `#jx-canvas-viewport` (`packages/studio/canvas.html`), a `container-type: size` container named `jx-canvas`, so an unnamed query with no container of the author's above it is answered by the design viewport there and by nothing on a built page. No test names an `@container` key. The catalog already has the entry (`scripts/docs/standards.json`, line 66). `backlog-already-cited` fails while §11 lists a standard a row binds, so the row and the removal go in one pull request.
- Editorial debts recorded only in `plans/standards/README.md`, which this plan deletes at graduation: §3.6 says "a short or evasive reason fails the gate", but only length is mechanical (`MIN_REJECTION_CHARS = 24`, `rejection-missing`); §4.1 says the status parser "resets its current section only at `## Changelog`", but `parseSpecSource` (`scripts/docs/lib/spec-status.ts`) ends every numbered section at an unnumbered heading of its depth or shallower and reports a marker left under none as a bad form, and the `section-unnumbered` message in `check-standards.ts` repeats the old reason; and `checkStructure` calls `v("section-missing", "heading-escaped", spec.file, "no …")`, so the violation prints `heading-escaped` as its file and the spec name as its message.

## Outcome

- standards.md §2.1 → Implemented: the eight bodies, plus community specifications filed under `Other`, and the gate refuses any other body.
- standards.md §2.2 → Implemented: a community specification is defined by its document, citable is distinguished from cited, and the three exclusions stand.
- The Custom Elements Manifest is cited: a **Subset** row in `imports.md` §7 bound to §2, and a row in `spec.md` §18 bound to §16.8 (**Pending** with `gap:cem-manifest` while §16.8 is Partial; a cited row if §16.8 is Implemented when this lands).
- The Open Graph protocol is cited: a **Subset** row in `site-architecture.md` §16 bound to §8.4.
- `ui.md` §11 and `parser.md` §10 give the rule's reasons for their prose; Schema.org is handed to the plan whose editor would bind §8.6 to it.
- CSS Containment 3 leaves `standards.md` §11 for a **Subset** row in `spec.md` §18 bound to §9.2, backed by a new runtime test.
- standards.md graduates: header `Implemented`, an in-place `spec:bump`, `plans/standards/` deleted.

## Decisions

- **Open:** admit community specifications as a class, or retire the six rows citing the five to prose? Recommendation: admit, because the six rows are gated conformance claims with evidence (five with tests) that prose would ungate, JSON Feed 1.1's graduation in 0.1.4 already made the call, and the prerequisite's gate gives the class a checked URL form and a closed body list. Retiring would flip this plan to `implement` across `parser.md`, `jx-markdown.md`, `studio.md` and `site-architecture.md`, and remove `Other` from `ORGS` instead (the prerequisite's own Open decision, to be signed together with this one).
- **Open:** do the two community specifications the corpus binds itself to without citing get rows: the Custom Elements Manifest (`imports.md` §7, `spec.md` §18) and the Open Graph protocol (`site-architecture.md` §16)? Recommendation: yes to both. The CEM meets the test below as fully as the five (a published, semver-versioned schema written for any tool to follow), both specs bind themselves to it (§2 reads third-party manifests; §16.8 promises compatible annotations), and "no standards body" is exactly the reason the new §2.2 stops accepting. Open Graph is one document at one maintained address, written for any site and any consumer, and the build emits two of its properties with the meaning it gives them, under a test. The weaker case is Open Graph's edition: `ogp.me` has no version, only its current text, so a reviewer who reads "names the edition" strictly would keep it in §8.4's prose, where it already is. Declining either drops its row, its catalog entry and its name from §2.2's marker.
- **Decided:** the class is defined by the document, not by who maintains it: a document at a stable address that defines a format or protocol precisely enough for an independent implementation to be checked against it, naming the edition a claim is made against (a version, or a "current" address the document maintains). Because that is what separates GFM (GitHub's, but a versioned specification with conformance examples) and Gitignore (git's manual page, precise enough that Studio reimplements it and checks the result against git) from the chat-completions API (one service's interface, changing when the service does), and it is the property a conformance claim needs.
- **Decided:** citable is not cited. A spec cites what it binds itself to; a specification only a library's own modules exchange, or one Jx may adopt later, stays prose. Because otherwise the rule would demand an mdast row for a tree no Jx document, output or host carries, and a Design Tokens row for an export nobody has built. `parser.md` §10 and `ui.md` §11 are corrected to give that reason rather than "a library" and "not standards". Schema.org is the case that moves: the §8.6 form editor would bind Studio to its types, so the landing asks `plan:site-architecture/seo-structured-data-editor` to cite it in the pull request that builds the editor.
- **Decided:** §2.2's OpenAI bullet stops giving "no standards body" as the reason, because under the new test that is no reason; it says what the rule does: the format is one service's interface.
- **Decided:** the catalog key stays `Other` (the prerequisite's `ORGS`), the CEM entry is filed under it, and its URL is the schema repository, never the analyzer's site. Because the class's name lives in the spec text, renaming the key is churn in the prerequisite's code, and §2.2 now says the canonical URL is the defining document's, never that of a tool that merely implements it.
- **Decided:** the CEM rows follow the state of their sections when this lands, and the landing hands the rest to whichever CEM plan is still open. Because neither CEM plan is a prerequisite (each row is true today with today's evidence), and the gate already forces the follow-up: a Pending row bound only to an Implemented §16.8 fails `pending-needs-marked-section`.
- **Decided:** CSS Containment 3 becomes a **Subset** row bound to `spec.md` §9.2, with no gap id, and the §11 entry is deleted in the same pull request. Because §11 is for standards whose owning section does not exist, §9.2 exists and carries the feature, the absent alias map is a deliberate omission nobody plans, and keeping the entry with a new reason would contradict §11's own rule. A new test, not the source file alone, is its evidence (standards.md §6.1).
- **Decided:** the §3.6 and §4.1 text, the `section-unnumbered` message and the `section-missing` argument slip are fixed here. Because this pull request graduates the spec and deletes the audit record that is their only record; a spec should not graduate asserting what its gate does not do.
- **Decided:** RSS 2.0 stays declined in `site-architecture.md` §6.7's prose with no `Rejected` row. Because the new §2.2 makes a declined community specification rejectable, not obliged to be, the prose already reads as a decision, and "no standards body" remains accurate in §2.1's sense.

## Implementation

Lands after `plan:standards/one-canonical-url-per-catalog-entry`, in one pull request.

1. **`specs/standards.md`**
   - §2.1 becomes:

     ```markdown
     > **Status: Implemented.** `ORGS` in `scripts/docs/lib/standards.ts` is these eight bodies and `Other`, and `bun run docs:standards` refuses a catalog entry filed under anything else (`catalog-org-unknown`) or an `Other` entry whose URL is on a listed body's domain (`catalog-org-mismatch`).

     A row may cite a published standard from IETF, W3C, WHATWG, the Unicode Consortium, Ecma International, IANA (its registries), ISO, or JSON Schema, or a **community specification** (§2.2), which the catalog files under `Other`. The issuing body is not a column: it is a property of the standard rather than of the binding, so it is recorded once in the catalog (§5.1) and rendered on the generated page.
     ```

   - §2.2 keeps its heading and its first two bullets; the marker and the paragraphs around the bullets become:

     ```markdown
     > **Status: Implemented.** The community specifications the corpus cites (CommonMark, GFM, Gitignore, JSON Feed 1.1, Sitemaps 0.9, the Custom Elements Manifest and the Open Graph protocol) are catalog entries under `Other`, and the exclusions below are prose in the specs that make them.

     A **community specification** is citable. It is a document published at a stable address that defines a format or protocol precisely enough for an independent implementation to be checked against it; it names the edition a claim is made against, by a version number or by a "current" address the document itself maintains; and it is maintained outside the bodies in §2.1. The test is the document, not its maintainer: GFM is GitHub's, and it is a versioned specification written for other implementations. Its canonical URL is the address of the document that defines it (§5.2), not the site of a tool that merely implements it.

     A library, a framework convention, or a de-facto vendor format is **not** citable, however widely adopted. Those belong in ordinary spec prose. None has a document of that kind: a library's behaviour is its code, a convention has no text of its own, and a vendor's wire format is documented as its own service's interface and changes when the service does, so nothing fixes what a conformance claim would be checked against.

     Citable is not cited. A spec cites what it binds itself to: a standard whose text decides what a Jx document, a Jx output or a Jx host does. A specification only a library's own modules exchange, such as the mdast tree `remark` hands the parser, or one Jx may adopt later, is described in prose.
     ```

     (the three-bullet block, with its first two bullets unchanged and the third becoming:)

     ```markdown
     - **The OpenAI chat-completions wire format** (`ai.md` §2) is a vendor de-facto format: one service's interface, documented by that service and changed when it changes. It is described in that spec's prose and appears in no row at all.
     ```

     ```markdown
     `Rejected` is **not** the class for these. It is for a real standard, from a recognized body or a community specification, that was considered and declined, so that a deliberate decision reads as a decision rather than as an oversight. A thing that was never citable cannot be rejected.
     ```

   - §3.6, last two sentences become: "The note opens with `because:` and states either the alternative Jx uses instead or the constraint that makes adoption wrong here. A reason shorter than 24 characters fails the gate (`rejection-missing`); whether a longer one is evasive is for review to judge by §8."
   - §4.1, second paragraph becomes: "It must never be an appendix. Unnumbered headings are invisible to `scripts/docs/check-doc-refs.ts` and `scripts/docs/lib/spec-status.ts` alike: an unnumbered section is not an anchor, so no docs page can reference it, and it never reaches the implementation-status page. A `> **Status:**` marker under an unnumbered heading at the level of the numbered sections is credited to none of them, which `bun run docs:status` reports as a bad form. The gate reports the unnumbered heading by name (`section-unnumbered`)."
   - §11: delete the CSS Containment 3 row. Append to the paragraph after the table: "CSS Containment 3 left for a row in `spec.md` §18 bound to §9.2: a container query, named or not, is a standard at-rule the style object already carries."
   - Header: `**Status:** Implemented`, then the in-place bump (Specs & docs).
2. **`scripts/docs/standards.json`**: add, between `CommonMark` and `ECMA-262` (codepoint order), `{ "id": "Custom Elements Manifest", "org": "Other", "title": "Custom Elements Manifest schema", "url": "https://github.com/webcomponents/custom-elements-manifest" }`, and between `Media Queries 5` and `Permissions Policy`, `{ "id": "Open Graph", "org": "Other", "title": "The Open Graph protocol", "url": "https://ogp.me/" }`. Both pass `STANDARD_ID`, the prerequisite's `Other` form, `orgOfUrl` (neither host is a body's domain) and the duplicate-URL key.
3. **`specs/spec.md` §18**: delete the sentence "The Custom Elements Manifest (§16.8) is a community format with no standards body." Add, after the CSS Animations row:

   ```markdown
   | [CSS Containment 3](https://www.w3.org/TR/css-contain-3/) | **Subset** | §9.2 | packages/runtime/src/css.ts, packages/runtime/tests/css.test.ts | Container queries, named ones included: an `@container` key is a standard at-rule group, emitted verbatim around the rules nested in it, and `containerType` and `containerName` are ordinary style keys (§9.1). Containment and query evaluation are the browser's: nothing checks that a queried container exists, and no `$media`-style alias names a container condition (§9.4 names media conditions only). |
   ```

   and, after the WHATWG HTML row, while §16.8 is Partial:

   ```markdown
   | [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) | **Pending** | §16.8 | — | `gap:cem-manifest` No build writes a manifest for the elements it compiles. The annotations §16.8 lists take the manifest's `Parameter` and `Event` shapes, except that a parameter's `type` may be a JSON Schema where the manifest has `{ text }`. |
   ```

   If `plan:spec/cem-manifest-export` has landed, the row is instead **Subset** of §16.8 with evidence `packages/schema/src/cem-manifest.ts, packages/schema/tests/cem-manifest.test.ts, packages/compiler/tests/site-build-cem-manifest.test.ts` and a note restating what §16.8 then says the manifest leaves out; no gap id. Re-pad each edited table with `bunx oxfmt <file>` (what `spec:bump` itself runs), not the repository-wide `bun run format`.

4. **`specs/imports.md`**: in §7, delete "The Custom Elements Manifest (§2) is a community format with no standards body, so it is described there rather than cited here." and add:

   ```markdown
   | [Custom Elements Manifest](https://github.com/webcomponents/custom-elements-manifest) | **Subset** | §2 | packages/server/src/studio-api.ts, packages/server/tests/studio-api.test.ts | Read, never written: a dependency's `customElements` field locates its manifest, and a declaration carrying `customElement` and a `tagName` contributes its `attributes`, non-private `field` members, `events`, `slots`, `cssProperties`, `description` and module `path`. `schemaVersion` is not checked, and `cssParts`, methods, `exports` and inheritance (`superclass`, `mixins`) are not read. |
   ```

   If `plan:imports/cem-discovery-on-every-backend` has landed, the evidence names the shared scan and its tests instead (`packages/schema/src/component-meta.ts`, `packages/schema/src/npm-components.ts`, `packages/schema/tests/npm-components.test.ts`), and the note is re-read against the mapping that ships. In §2, the link `https://custom-elements-manifest.open-wc.org/` becomes `https://github.com/webcomponents/custom-elements-manifest`.

5. **`specs/parser.md` §10**: "`remark`, `unified` and the MDAST node model are libraries rather than published standards, so they are described in §2 rather than cited here." becomes "`remark` and `unified` are libraries, and the mdast tree they hand the transpiler is a specification only this package's modules exchange rather than one a Jx document or output is bound to (`standards.md` §2.2), so all three are described in §1 and §2 rather than cited here."
6. **`specs/site-architecture.md` §16**: add, after the JSON-LD 1.1 row:

   ```markdown
   | [Open Graph](https://ogp.me/) | **Subset** | §8.4 | packages/site/src/head-merger.ts, packages/site/tests/head-merger.test.ts | `og:url` (the canonical) and `og:site_name` (`$site.name`) are emitted with the meanings the protocol gives them, unless the author supplied either. Every other property, three of the four the protocol requires among them, is whatever the page's `$head` declares (§8.1). |
   ```

7. **`specs/ui.md` §11**: "Three things it draws on are not standards and are prose rather than rows: the ARIA Authoring Practices Guide (a W3C note the keyboard contracts follow, with the deviations §5.1 and §5.5 name), Open UI's customizable select research (which `jx-select` follows), and the Design Tokens Community Group format (a community deliverable the tokens may be exported to later)." becomes "Three things it draws on are prose rather than rows: the ARIA Authoring Practices Guide (a W3C note, not a standard, which the keyboard contracts follow with the deviations §5.1 and §5.5 name), Open UI's customizable select research (research rather than a specification, which `jx-select` follows), and the Design Tokens Community Group format (a community specification, `standards.md` §2.2, that the tokens may be exported to later but are not bound to today)."
8. **`scripts/docs/check-standards.ts`**, `checkStructure`: the `section-unnumbered` message's clause "a '> **Status:**' under it is credited to the last numbered section above it" becomes "a '> **Status:**' under it belongs to no numbered section" (keep "check-doc-refs.ts"; a test pins it); the `section-missing` call drops its stray `"heading-escaped"` argument, becoming `v("section-missing", spec.file, "no `## N. Standards Alignment` section …")`.
9. **`packages/runtime/tests/css.test.ts`**: the new case under Tests. No source change.
10. **`docs/framework/concepts/styling.md`**, "At-rules that hold declarations": "Most `@` keys wrap selectors: a breakpoint, `@supports`, `@starting-style`." becomes "Most `@` keys wrap selectors: a breakpoint, `@supports`, `@starting-style`, or a container query such as `@container toolbar (max-width: 1140px)`, which is emitted as written and applies once an ancestor declares `containerType` (and `containerName`, for a named one)." (keeping the breakpoint link), followed by "Name the container you mean: Studio's canvas is itself a container, so an unnamed query with no container of yours above it matches against the canvas in Studio and against nothing on the built page."
11. **`plans/`**: delete `plans/standards/` (this file and the audit record). For each plan below that is still open when this lands:
    - `plan:spec/cem-manifest-export`: its Specs & docs already says to reclassify the Pending row as a cited one; add `cem-manifest` to its `gaps` (the gate's `gap-unknown` refuses it until the row exists).
    - `plan:imports/cem-discovery-on-every-backend`: add to its Specs & docs "re-point `imports.md` §7's Custom Elements Manifest row's evidence to the shared scan and its tests, and re-read the row's note against the mapping that ships".
    - `plan:site-architecture/seo-structured-data-editor`: add to its Specs & docs "the editor binds §8.6 to Schema.org's types, a community specification (`standards.md` §2.2): add a catalog entry under `Other` and a `site-architecture.md` §16 row bound to §8.6".
    - `plans/spec/README.md`, while it exists: delete the "§18 and CSS Containment 3" bullet, since the forward it records is closed.

**Integration contract.** Once this lands: standards.md is Implemented and §2.2 is the rule for any new non-body citation (a published document defining a format precisely enough to check an implementation against, naming its edition, catalogued under `Other` at its own URL, cited only where the spec binds itself to it); `Custom Elements Manifest` and `Open Graph` are catalog ids under `Other` at `https://github.com/webcomponents/custom-elements-manifest` and `https://ogp.me/`; `gap:cem-manifest` exists on `spec.md` §18 (while §16.8 is Partial) for `plan:spec/cem-manifest-export` to close; the Open Graph row binds `site-architecture.md` §8.4, so a plan that changes what `mergeHead` injects keeps its note true; CSS Containment 3 is a `spec.md` §18 row that any plan changing `resolveAtQuery` or `walkAt` must keep true, and the backlog holds WebAuthn Level 3 alone. No plan requires this one.

## Tests

- **scripts** (`bun test --isolate scripts`, as the `changes` job runs it; locally `bun test --isolate scripts/docs/check-standards.test.ts`):
  - New `section-missing names the spec it is about` in `describe("structure")`: over the existing section-missing fixture, the violation equals `{ code: "section-missing", file: "f.md", message: expect.stringContaining("Standards Alignment") }` and has no `line`.
  - Extend `section-unnumbered: the appendix trap, named in the message`: the message also contains "belongs to no numbered section" and not "last numbered section above".
  - The golden `the gate is green on what is committed` proves the two new catalog entries, the four new rows, the `gap:cem-manifest` join with §16.8's marker and the backlog removal. No new violation code, so the `afterAll` meta-test is unaffected. `scripts/**` has no coverage threshold or manifest check.
- **packages/runtime** (`bun test --isolate --coverage` from `packages/runtime`): new `a container query is a standard at-rule, emitted as written` in `describe("buildStyleRules composes nesting and at-rules in both orders")`. With `{ scope: ".s", mediaQueries: { "--md": "(min-width: 40rem)" } }` over `{ containerType: "inline-size", containerName: "toolbar", "@container toolbar (max-width: 1140px)": { "& .label": { display: "none" } } }`, `textsOf(rules)` equals `[".s { container-type: inline-size; container-name: toolbar }", "@container toolbar (max-width: 1140px) { .s .label { display: none } }"]` (both strings verified against the current code), and `css.resolveAtQuery("@container toolbar (max-width: 1140px)", { "--md": "(min-width: 40rem)" })` is `null`. It passes on today's code, as a reconcile's evidence should: it is the row's proof, and it fails the day a change to `resolveAtQuery` or `walkAt` stops passing the key through. Test-only: `packages/runtime/bunfig.toml`'s `coverageThreshold` (lines 0.963, functions 0.98) is unaffected and no ratchet applies.
- **Paper gates**: `bun run docs:standards`, `docs:status` (no open item under the Implemented header), `docs:spec-release`, `docs:check`, `docs:links`, `docs:prose` (the styling page), `docs:markdown`, `plans:check`.

## Specs & docs

- **standards.md** graduates in this pull request: it closes the spec's last open items, since its prerequisite closes §5.2 and §5.3. §2.1 and §2.2 take the Implemented markers in Implementation step 1, §3.6, §4.1 and §11 change as described, the header becomes `**Status:** Implemented`, and the release is one in-place bump, not a fragment: `bun run spec:bump standards.md minor -m "§2.1 and §2.2 admit community specifications, catalogued under Other and cited only where a spec binds itself to one; CSS Containment 3 leaves the adoption backlog for a spec.md §18 row; §3.6 and §4.1 say what the gates check; every section is implemented."` (minor: a reconcile, with the graduation riding on it).
- **spec.md**: §18 as in step 3; no marker changes (§9.2 and §16.8 stay Partial, owned elsewhere; standards.md §7.3 lets a Partial section take a cited row, and a Pending row needs a bound section that is not Implemented). `bun run spec:change spec.md minor -m "§18 cites CSS Containment 3 as a Subset bound to §9.2, since an @container key passes through a style object verbatim, and cites the Custom Elements Manifest against §16.8 as a community specification."`
- **imports.md**: §7 and §2's link as in step 4; no marker changes (§2 stays Partial, owned by `plan:imports/cem-discovery-on-every-backend`). `bun run spec:change imports.md minor -m "§7 cites the Custom Elements Manifest as a Subset bound to §2, and §2 links the manifest's schema rather than an analyzer's documentation."`
- **parser.md**: §10's prose as in step 5. `bun run spec:change parser.md patch -m "§10 describes mdast as a specification only the parser's own modules exchange, not a library, which is why it is not cited, and points at §1 for remark and unified."`
- **site-architecture.md**: §16 as in step 6; no marker changes (§8.4 is unmarked). `bun run spec:change site-architecture.md minor -m "§16 cites the Open Graph protocol as a Subset bound to §8.4: the build emits og:url and og:site_name as the protocol defines them."`
- **ui.md**: §11's prose as in step 7. `bun run spec:change ui.md patch -m "§11 says why the Design Tokens Community Group format is prose: a community specification the tokens are not bound to yet, not a non-standard."`
- **Pending fragments.** If `specs/changes/` still holds a standards.md fragment when this lands (the census's `standards-f3fcb204.md`, the prerequisite's), the release mints it above the graduation entry and without `-draft`. No gate objects; land after that release instead if the changelog's order matters to the reviewer.
- **Docs**: `docs/framework/concepts/styling.md` gains the container-query clause and the naming advice (step 10; no em dash). No page's `spec:` cites `standards.md#2.1`, `#2.2`, `#11`, `spec.md#18`, `imports.md#7`, `parser.md#10`, `site-architecture.md#16` or `ui.md#11`, and no page's `code:` lists `scripts/docs/check-standards.ts` or `scripts/docs/standards.json`; `docs/framework/site/seo.md` lists `head-merger.ts`, which does not change. `docs/extending/reference/standards.md` is generated and gitignored: at the next `bun run docs:generate` it lists the CEM, Open Graph and CSS Containment 3 rows, one gap more, and a backlog of one.

## Acceptance

- `bun run plans:status --spec standards` reports standards.md Implemented with no open item, and `plans/standards/` does not exist.
- `bun run docs:standards` exits 0; `bun test --isolate scripts/docs/check-standards.test.ts` passes.
- `bun test --isolate --coverage` from `packages/runtime` passes with the new container-query case and no threshold failure.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run plans:check` are green.
- `grep -n "no standards body" specs/spec.md specs/imports.md specs/standards.md` prints nothing (`site-architecture.md` §6.7's RSS sentence keeps it, by the RSS decision); `grep -rn "custom-elements-manifest.open-wc" specs/` and `grep -n "are not standards" specs/ui.md` print nothing; `grep -c "CSS Containment 3" specs/standards.md` counts only prose (the §11 paragraph and the changelog), not a table row.
- `bun run docs:generate`, then `grep -n "Custom Elements Manifest\|CSS Containment 3\|Open Graph" docs/extending/reference/standards.md` shows the CEM under the gaps (or the implemented table, per §16.8), CSS Containment 3 and Open Graph under "Standards Jx implements", and the catalog's two new entries with body `Other`.
