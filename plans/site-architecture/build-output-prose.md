---
status: drafted
disposition: reconcile
claims:
  - site-architecture.md#10.7
  - site-architecture.md#14.1
  - site-architecture.md#14.2
requires: []
workspaces:
  - specs
  - packages/compiler
size: S
---

# The build-output sections describe the inlined component CSS and the adapter-independent `_redirects` the build writes

## Context

`specs/site-architecture.md` §10.7, line 1448:

> **Status: Partial.** The order ships (`packages/site/src/site-style.ts`, `packages/compiler/src/shared.ts`, and `injectComponentScripts` in `packages/compiler/src/site/site-build.ts`, which emits component CSS last in `<head>`). Item 6 does not hold as written: components render into light DOM by default, but a component may opt into a shadow root (`$shadow`, or `defaults.shadow` for a project; `packages/compiler/src/shadow.ts`, `spec.md` §16.6), and a shadow component's stylesheet is linked inside its declarative shadow root rather than joining this cascade.

§14.1, line 1888:

> **Status: Partial.** The four adapters and their worker output ship as §14.1.1 records. The table's `_redirects` entries do not match: the build writes `dist/_redirects` whenever `redirects` is non-empty, under every adapter and with none (`generateRedirects` in `packages/compiler/src/site/site-build.ts`), not only for the two Cloudflare adapters.

§14.2, line 1938:

> **Status: Partial.** The artifacts in the tree ship (`buildSite` in `packages/compiler/src/site/site-build.ts`). Two statements do not match: `_redirects` is written under every adapter whenever `redirects` is non-empty rather than being platform-specific (§14.1), and pages do not link component stylesheets: light-DOM component CSS is inlined into one `<style>` block at the end of `<head>` (`injectComponentScripts`), and `/components/<tag>.css` is linked only from inside a shadow component's declarative shadow root (§10.7).

All three were unmarked before the census. They are one plan because §14.2 carries both halves: the component-CSS delivery that §10.7 describes and the `_redirects` placement that §14.1's table describes. Verified at the audited tree:

- **Component CSS is inlined, on purpose.** Step 5 of `buildSite` builds each component's sheet with `buildComponentCSS` (`packages/compiler/src/shared.ts`), writes it to `dist/components/<tag>.css` when it is non-empty, and adds it to the page-level `componentCSS` map only when `resolveShadowMode` returns `null`. `injectComponentScripts` concatenates the sheets of the tags a page or its islands use into one `<style>` block and appends it last in `<head>`, after the modulepreload hints. Its comment records the measured reason: 11 render-blocking links on jxsuite.com's home page. compiler.md §8.2 (whose trailing marker names this inlining as implemented) and site-architecture.md §12.4 (verified) already state it. Pinned by `site-build-component-loading.test.ts` ("inlines the component stylesheet too", and the `not.toContain('rel="stylesheet"')` assertions).
- **A shadow component links its own sheet.** `expandComponents` (site-build.ts) and `renderComponentInstance` (shared.ts) emit `<template shadowrootmode="…"><link rel="stylesheet" href="/components/<tag>.css">…</template>`. `styleScopePrefix` (`packages/compiler/src/shadow.ts`) writes its rules against `:host`. Pinned by `site-build-reporting.test.ts` ("emits the template the parser adopts, with the stylesheet inside it") and `prerender-nested-components.test.ts`.
- **The order of a page's own CSS.** `compileStyles` (shared.ts) writes one `<style>` block: `buildSiteStyleCSS` (`packages/site/src/site-style.ts`, items 1 to 3), then `collectStyles` over the page merged into its layout. `resolveLayout` (`packages/site/src/layout.ts`) spreads the page root's `style` over the layout root's, and every other element's rules follow in document order. Content passed into a component's slots is styled by a second block (`slotCss`, handle prefix `jxs`) that site-build.ts appends before `injectHead` keeps both blocks in order. So items 4 and 5 ("Layout-level styles", "Page-level styles") hold for the root and read loosely for nested elements, and "The global stylesheet" misnames a per-page `<head>`: §14.2 itself says there is no site-wide stylesheet.
- **`_redirects` does not depend on the adapter.** Step 7 of `buildSite` calls `generateRedirects` whenever `projectConfig.redirects` has a key. The condition has no adapter term. The function writes the file when at least one rule is accepted and writes the §11.3 HTML fallbacks beside it. §11.1 and §11.3 (both verified) already describe it this way: every rule goes to `_redirects`, "for platforms that process it", and the fallbacks exist for hosts that ignore it. The no-adapter case is pinned by `site-build.test.ts` ("builds the full site" asserts `dist/_redirects` with no `adapter`). No test builds `_redirects` under an adapter.
- **The §14.2 tree understates `robots.txt`.** `ensureRobotsSitemap` (site-build.ts) runs only when the sitemap is written, and creates `User-agent: *` / `Allow: /` when `public/` supplied no `robots.txt`. The tree says only "From public/, with a Sitemap: line appended".

Related, not claimed here (both are `spec.md` §16.6's, owned by `plan:spec/shadow-dom-parity`):

- The Stylesheet row of `spec.md` §16.6's table (line 1726) still gives light DOM "`<link>` in the document head", which the inlining contradicts.
- A shadow component whose sheet is empty gets no `dist/components/<tag>.css`, because the write is guarded by `if (css)`. Both prerender paths emit the in-template `<link>` unconditionally, so the browser requests a file that does not exist.

## Outcome

- site-architecture.md §10.7 → Implemented (marker deleted, unmarked as before the census). The section describes a page's `<head>` CSS in the order the build writes it: light-DOM component sheets are inlined last, and a `$shadow` component stands outside the order.
- site-architecture.md §14.1 → Implemented (marker deleted, under §14's `Implemented`). The table lists only adapter output, and a note says `_redirects` is written whatever the adapter.
- site-architecture.md §14.2 → Implemented (marker deleted, under §14's `Implemented`). The tree annotates `_redirects` and `robots.txt` as they are written, and the closing paragraph says that no page links a component sheet outside a shadow root.
- A test pins `_redirects` under an adapter. No source file changes. site-architecture.md keeps other open items, so it does not graduate.

## Decisions

- **Decided:** reconcile the prose to the code, not the reverse. Linking every component sheet again would restore the render-blocking chain that `injectComponentScripts` removed on measured evidence. Gating `_redirects` on a Cloudflare adapter would remove the file a Netlify site with no adapter reads today. The specs already disagree with themselves here. The sections that agree with the code are the ones checked against it: compiler.md §8.2, whose inlining half its trailing marker calls implemented, and site-architecture.md §11.1, §11.3 and §12.4, which the census verified.
- **Decided:** §10.7 names the scoping mechanism, a tag-name prefix and a per-element handle, but does not spell the handle. It cites `spec.md` §9.2 and §16.6 for the spelling. `plan:spec/style-handle-assignment` is choosing between `.<tagName>-<n>`, `jx-<n>` and a `data-jx` hash. Spelling it here would give that plan a third section to edit, or this plan a `requires` edge on a decision that does not change what §10.7 is about.
- **Decided:** cite compiler.md §8.2 for why the sheets are inlined instead of restating the measurement. compiler.md §8.2 and site-architecture.md §12.4 already carry that text, and a third copy would be one more place to drift.
- **Decided:** delete the three markers rather than write `Implemented`. Each section was unmarked before the census. §14.1 and §14.2 sit under §14's `> **Status: Implemented.**`, which already speaks for them, and `plan:_shared/page-server-entries` closes §14.1.1 the same way.
- **Decided:** add one test for `_redirects` under an adapter. The rewritten §14.1 turns "under every adapter and with none" into a contract. Only the no-adapter half is pinned today, and a later change that gated the call on `adapter` would pass every existing test.
- **Open:** should the build warn when `_redirects` goes to an adapter whose worker serves no static assets (`node`, `bun`), as it already warns for `_headers` (§14.3)? Recommendation: no, not in this plan. `_headers` warns because a security and caching policy disappears silently. For `_redirects`, the §11.3 HTML fallbacks still serve every literal 301, 302 and 303 rule. The rules they cannot serve (patterns, 307, 308, rewrites) are already listed for plain hosts in §11.3 and `docs/framework/site/redirects.md`. A warning would also turn this paper plan into a code change. If maintainers want the warning, it is a separate implement item beside the `_headers` warning in step 7e, and §14.1's note gains one sentence.

## Implementation

This plan changes spec text and one test, not source code.

1. **`specs/site-architecture.md` §10.7**, as given in Specs & docs.
2. **`specs/site-architecture.md` §14.1**: the marker, the two table rows and the new note, as given in Specs & docs. Re-pad the table with `bunx oxfmt specs/site-architecture.md` (the nano-staged pre-commit pass runs the same formatter).
3. **`specs/site-architecture.md` §14.2**: the marker, two tree comments and the closing paragraph, as given in Specs & docs.
4. **`packages/compiler/tests/site-build-reporting.test.ts`**. In the describe `buildSite — _headers under an adapter that serves no static assets`, add `redirects: { "/blog/:slug": "/posts/:slug", "/old": "/new" }` to the `scaffold` project, and rename the describe to `buildSite — host files under an adapter that serves no static assets`. The existing `_headers` case is unaffected: `_redirects` feeds no header rule. Add the case listed in Tests.
5. **The fragment**, as given in Specs & docs.
6. **Landing**: delete this file. No plan requires this one, so no `requires` edge needs editing. Review may land it in the pull request that details the site-architecture plans, since the only non-spec edit is the one test case. If the test case is left out, it lands as its own S pull request.

**Integration contract.** No plan requires this one. Once it lands:

- §10.7 is the one statement of a built page's CSS order. Items 1 to 3 are the project sheet, item 4 is the layout and page styles, item 5 is slotted content and item 6 is the inlined light-DOM component sheets, last in `<head>`. A `$shadow` component is outside that order. A plan that changes how component CSS is delivered (for example, content-hashed component sheets, which §14.3 names as the prerequisite for caching them) must edit §10.7 item 6, §12.4, §14.2 and compiler.md §8.2 together.
- §10.7 does not spell the style handle, so `plan:spec/style-handle-assignment` and `plan:_shared/static-style-handle-and-descriptions` do not need to edit this section.
- §14.1's table lists only output that depends on `build.adapter`. `_redirects`, `_headers` and `.nojekyll` are described as adapter-independent. `plan:_shared/page-server-entries` and `plan:_shared/no-adapter-server-tier` edit §14, §14.1.1 and §12.1, none of the lines changed here, so either may land before or after this plan.
- Two plans edit lines this plan edits, with no ordering between them; whichever lands second rebases. `plan:site-architecture/locale-negotiation-gaps` rewrites the condition in §14.1's `"cloudflare-pages"` cell, whose `_redirects` tail this plan removes. `plan:spec/cem-manifest-export` adds a `custom-elements.json` line to §14.2's tree; if this plan lands first, that plan's "§14.2 stays Partial" no longer holds, and its tree line is its only §14.2 edit.

## Tests

- **`packages/compiler`** (`bun test --isolate --coverage` from `packages/compiler`), `tests/site-build-reporting.test.ts`, in the renamed describe:
  - New `it("writes _redirects and its HTML fallback whatever the adapter (site-architecture.md §14.1)")`. After `buildSite(DIR)`, `dist/_redirects` contains `/old /new 301` and `/blog/:slug /posts/:slug 301`, and `dist/old/index.html` contains `http-equiv="refresh"`. Together with `site-build.test.ts`'s no-adapter "builds the full site", this pins both halves of §14.1's note. It passes on today's code, as a reconcile's pin should; it fails the day step 7 of `buildSite` gains an adapter condition.
  - The inlining and the in-shadow-root link are already pinned (the `site-build-component-loading.test.ts` and `site-build-reporting.test.ts` cases in Context). No new case is needed for §10.7 or §14.2.
- **Coverage.** No source file changes, so the per-file thresholds in `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`) do not move, nothing ratchets, and the manifest check sees no new file.
- **Gates for the spec half**: `bun run docs:status` (no open marker left in the three sections, and header forms valid), `bun run docs:spec-release` (the body change carries its fragment), `bun run plans:check` (the three anchors are no longer claimed, and they are not open), `bun run docs:check` and `bun run docs:links` (the `site-architecture.md#10` and `#14` anchors in docs frontmatter still resolve, because every heading stays), and `bun run docs:markdown` (no escaped headings).

## Specs & docs

**`specs/site-architecture.md` §10.7**, in place:

- Delete the marker (line 1448) and the blank line after it.
- "The global stylesheet is emitted in this order:" becomes "A built page carries its CSS in its `<head>`, in this order, after any stylesheet its merged `$head` links or embeds (§8.3); there is no site-wide stylesheet file (§14.2):". `injectHead` (site-build.ts) writes the rendered `$head` entries first and the compiled `<style>` blocks after them.
- Items 1 to 3 are unchanged.
- Items 4 to 6 become:
  - "4. Layout and page styles, from the page merged into its layout (§5.1): the root element's `style`, where a key the page sets overrides the layout's, then every other element's rules in document order. Items 1 to 4 are one `<style>` block."
  - "5. The styles of content a page or layout passes into a component's slots, in a second block."
  - "6. Component styles: the sheet of every light-DOM component the page or one of its islands uses, inlined into one `<style>` block that is the last element of `<head>` (compiler.md §8.2). Components render into light DOM by default, so these rules are scoped by selector: the component's tag name prefixes its own rules, and a nested element with its own `style` is selected by a per-element handle (`spec.md` §9.2, §16.6)."
- A new paragraph after the list: "A component that opts into a shadow root (`$shadow`, or `defaults.shadow` for the project; `spec.md` §16.6) takes no part in this order. Its rules are written against `:host`, its sheet `/components/<tag>.css` is linked from inside its declarative shadow root, and no page or project selector matches inside that root. Inherited properties and the custom properties of item 1 still cross the boundary, so `var(--color-primary)` works in either mode."
- The two closing paragraphs ("This follows the natural CSS cascade…" and the pre-paint `<script>` sentence) are unchanged.

**§14.1**, in place:

- Delete the marker (line 1888) and the blank line after it.
- In the table, the `"cloudflare-workers"` cell becomes "`dist/worker.js` (Hono server with asset fallback)", and the `"cloudflare-pages"` cell becomes "`dist/_worker.js` (advanced-mode Hono server) + `dist/_routes.json`, unless the site has neither server entries nor active extension mounts". The other rows are unchanged.
- A new paragraph between the table and "Configured in `project.json`:": "`_redirects` is not adapter output. The build writes `dist/_redirects` whenever `redirects` has a rule, under every adapter and with none, beside the HTML fallbacks that §11.3 writes for hosts that ignore the file (§11.1). `_headers` (§14.3) and `.nojekyll` (§14.4) are likewise written whatever the adapter."

**§14.2**, in place:

- Delete the marker (line 1938) and the blank line after it.
- Tree, line 1963: `# From public/, with a Sitemap: line appended` becomes `# From public/, or a permissive default when the sitemap needs one; Sitemap: line appended`.
- Tree, line 1966: `# Platform-specific` becomes `# From redirects, whatever the adapter (§11.1, §14.1)`.
- The closing paragraph (line 1973) becomes: "A page carries its own CSS. Page and layout styles, and the sheet of every light-DOM component the page uses, are inlined into its `<head>` in the order §10.7 gives (compiler.md §8.2). There is no site-wide bundled stylesheet and no hashed `_assets/` directory, and the document never links a component sheet: `dist/components/<tag>.css` is still written for every component that has styles, and is linked only from inside a shadow component's declarative shadow root (`spec.md` §16.6). A component with a non-static instance on the page, or one an island renders, is loaded with `<script type="module" src="/components/<tag>.js">` and hinted with `<link rel="modulepreload">` (§12.4). A component whose every instance is prerendered, and which no island renders, ships no script."

**Fragment:** `bun run spec:change site-architecture.md minor -m "§10.7, §14.1 and §14.2 describe the build output that ships: a page inlines the CSS of every light-DOM component it uses after its own styles, a shadow component links its sheet from inside its declarative shadow root and stands outside the page cascade, and _redirects is written whenever redirects has a rule, under every adapter and with none."` The level is minor: this is a reconcile, and it redefines nothing an author relied on, because the build has shipped this output all along.

**Docs.** No page changes. These pages were checked against the new text:

- `docs/framework/site/deployment.md` (`spec:` `site-architecture.md#14`). Its `dist/` tree already says "`_redirects` From the redirects map", and its adapter table already lists no `_redirects`.
- `docs/studio/publish/other-hosts.md` (`spec:` `#14`) makes no per-adapter `_redirects` claim.
- `docs/framework/site/project-json.md` (`spec:` `#10`) states no CSS order.
- `docs/framework/build.md` ("Component CSS is inlined into that block too", and the shadow-root sidecar sentence) already matches.
- `docs/framework/concepts/components.md` (light DOM "Stylesheet lives in the page `<head>`") already matches.
- `docs/framework/site/redirects.md` ("a `_redirects` file for hosts that do server-side redirects") already matches.

`bun run docs:sync` names nothing, because no `code:`-listed source file changes.

No spec graduates: site-architecture.md keeps §4, §4.3, §5.4, §5.5, §7.2 and other items open.

## Acceptance

- `bun run plans:status --spec site-architecture` lists none of `site-architecture.md#10.7`, `#14.1` or `#14.2`. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- `sed -n '/^### 10.7 /,/^## 11\./p' specs/site-architecture.md | grep -n 'global stylesheet\|no shadow DOM\|Status:'` prints nothing. (The changelog's 0.5.3 entry still says "there is no shadow DOM"; history is not rewritten.)
- `grep -n 'Platform-specific' specs/site-architecture.md` prints nothing, and ``grep -n 'href="/components/<tag>.css">` and' specs/site-architecture.md`` prints nothing: the old §14.2 sentence is gone.
- `sed -n '/^### 14.1 /,/^#### 14.1.1/p' specs/site-architecture.md | grep -c '_redirects'` prints `1`: the new note is the only line that names it, and no table row does.
- `bun test --isolate --coverage` passes from `packages/compiler`, and the new `site-build-reporting.test.ts` case is listed.
