---
status: drafted
disposition: reconcile
claims:
  - studio.md#7.4
requires: []
workspaces:
  - packages/studio
size: S
---

# Style Editing says a Stylebook edit writes bare nested tag keys at the pane's breakpoint and scheme, and that the token editor overrides any token in any declared context

## Context

`specs/studio.md` §7.4, line 780 (the section was unmarked before the census, which added the marker only to carry this item):

> **Status: Partial.** Scheme routing into `@--name`, the link to Project Settings › Contexts and the in-place site-style push ship (`packages/studio/src/panels/style-panel.ts`, `settings/css-vars-editor.ts`). Stylebook edits write bare nested tag keys (`h1`, `table` then `th`) through `mutateUpdateNestedStylePath`, not `& tag` rules; there are no media breakpoint tabs, the breakpoint being chosen on the pane context bar (§6.2); and the token editor overrides every token group in any declared context, breakpoints included, not only colour tokens per scheme.

The stale body is line 782 ("writes nested CSS rules (`& tag`) to the document's root `$style` object. Media breakpoint tabs allow responsive token editing.") and line 784 ("The site-settings design-token editor is scheme-aware for color tokens: each color row carries a per-scheme override field…"). Line 786 (the Target Line's scope chip) is true and stays: the selector segment shows the whole tag path and the chip says the edit is tag-wide. For a part the chip names the element's tag (`all <ul>` while editing `ul li`, `stylebookTagOf` in `style-panel.ts`); that is §6.2's chip, not this section's, and `plan:studio/stylebook-layers-tag-keys` hands it to §6.2's owner. Every claim in the marker was re-verified on 2026-09-27:

**The write is a bare key per path segment.** `selectStylebookTag` (`packages/studio/src/panels/stylebook-panel.ts`) parks the selection on the root (`[[]]`) and sets `activeSelector` to the tag path. `contextMutate` in `panels/style-panel.ts` sends a tag path (`isTagPath`: starts with a letter) to `mutateUpdateNestedStylePath`, or `mutateUpdateMediaNestedStylePath` when there is an edit context. Both are in `packages/studio/src/tabs/transact.ts`: they split the path on spaces, `ensureNestedStyle` (`@jxsuite/schema/guards`) one level per segment, and `pruneEmptyStylePath` on a clear. `resolveContextStyle` reads the same shape back through `resolveNestedTagStyle`.

**Every reader uses the bare shape.**

- `transposeStylebookStyle` (`panels/stylebook-doc.ts`) re-keys each bare tag key, top level and inside each `@` block, to `& .element-card-preview <tag>`, so the rule reaches only the specimens. A `&`-prefixed key fails its `isTagPath` and is copied to the specimen root unconfined, so `& div` would restyle the catalogue's own card divs.
- `hasTagStyle` in the same module resolves a bare path directly and under every `@` block. `buildStylebookDoc`'s Customized filter uses it.
- In `project.json`, `buildSiteStyleCSS` (`packages/site/src/site-style.ts`) emits a bare key as the unscoped rule `h1 { … }` that `jx build` writes into every page (studio.md §4.1). It splices a `&` key onto `:root`, so `& h1` becomes `:root h1`.
- On an ordinary document, `buildStyleRules` (`packages/runtime/src/css.ts`) resolves both spellings to `<scope> h1` (`resolveOneNestedSelector`).
- The layers tree is the one reader left on `& <tag>`, and it belongs to `plan:studio/stylebook-layers-tag-keys` (§7.3). So §7.4 names the readers that use the bare shape today rather than claiming every reader does, and that plan adds the Outline's dot when it lands.

**No breakpoint tabs.** Neither the chrome bar (`surfaces/stylebook-chrome.json`: a filter and the Customized toggle) nor the Style tab draws one. `buildEditor` in `style-panel.ts` reads the pane's `session.ui.activeMedia`. That field is written by the pane context bar's size segment (`sizeRows` in `panels/pane-context.ts`) and by a click in a breakpoint's canvas panel (the `panelMediaToActiveMedia` branch of the hit handler in `canvas/iframe-host.ts`, which then calls `selectStylebookTag(tag, media)` through `studio.ts`). At Base, `previewColorScheme` routes to the declared scheme query's `@--name` block (`schemeLayer`). At a breakpoint it does not, exactly as studio.md §6.2 states. A Stylebook edit reaches the specimen canvas in place: `canvas-render.ts` posts `transposeStylebookStyle(getEffectiveStyle(…))` through `postStyleUpdateToStylebookHosts`.

**The token editor is wider than the text.** It is Project Settings › CSS Variables (`registerSettingsSection` key `cssVars` in `settings/settings-document.ts`, `settings/css-vars-editor.ts`, model in `style/project-styles.ts`).

- It lists every custom property in `project.json`'s root `style`, in four `TOKEN_GROUPS` (colour, font, size, other).
- `listTokenContexts` offers every declared `$media` entry as a context: schemes, then size breakpoints, then other feature queries. `writeTokenOverride` writes `"@--name": { "--token": … }` and drops an emptied block.
- A colour token shows its scheme rows unprompted. Any token with a value gets the other contexts from `addableContexts` ("Add override…").
- With no scheme declared, the Colours group says so and its "Manage contexts…" button routes to Contexts (`noticeState` in `css-vars-editor.ts`). That notice is the section's only link to Contexts.
- `commit` calls `pushProjectStylesToCanvas` (`style/live-preview.ts`), which posts `siteStyleUpdate` to page canvases and `styleUpdate` to Project Styles canvases.
- `packages/studio/tests/css-vars-editor.test.ts` covers all of it, including "a size token overridden in a SCHEME shows that row too" and "the picker offers every declared context the token has no value in, schemes first".

**What tests hold today.** `packages/studio/tests/transact-gaps.test.ts` covers both path mutators on `["table", "th"]`. `packages/studio/tests/style-panel.test.ts` resolves and clears tag paths in element mode ("tag path selector resolves nested tag styles", "multi-segment tag path…", "tag path within a media tab"). No test commits a value through the Style tab in Stylebook mode and asserts the key it writes, and that is the sentence this plan makes a contract.

**Found while verifying, outside this claim.** The Outline and the canvas name different paths for the same `table` part:

- An Outline row's key is its full catalogue chain: `elementRows` in `panels/stylebook-layers-panel.ts` gives `table thead tr th`.
- A canvas hit decodes through `pathToTag`, which records root tag plus leaf (`registerSpecimenPaths` in `stylebook-doc.ts`): `table th`.

So the same `<th>` can get two rules. `table` is the only catalogue entry nested three deep (`data/stylebook-meta.json`), so it is the only one affected. `requestStylebookSelection` and `panToStylebookTag` (`canvas/iframe-host.ts`) look up `tagToCardPath`, which is keyed by root tag only. As a result, a compound selection such as `ul li` neither highlights nor pans. Both are §7.3's selection mechanics and are handed on under the Integration contract.

**Riders in the same section.** §7.2 (line 764) says "Root document styles (`$style`)", but the document key is `style`, and no `$style` key exists in `packages/schema` or `packages/runtime`. `docs/studio/design/stylebook.md` (its `spec:` is `studio.md#7.4`) ends with two `code:` entries (`packages/studio/src/surfaces/panel-stylebook-layers.ts`, `packages/studio/src/surfaces/stylebook-chrome.ts`) that 1ef67907 appended after the "Next" list instead of into the frontmatter. They render as a nested list of file paths, and `docs:sync` never associates those two files with the page.

## Outcome

- studio.md §7.4 → Implemented. The census marker is deleted, so §7.4 reads unmarked like §7.1 and §7.2. Lines 782 and 784 become four paragraphs: the key shape, its readers, the context axes and the token editor. Line 786 is unchanged.
- studio.md §7.2: `$style` → `style` (editorial, same fragment).
- Two Stylebook-mode cases in `packages/studio/tests/style-panel.test.ts` pin the written key shape at Base, at a breakpoint and under a forced scheme, and the prune on a clear.
- `docs/studio/design/stylebook.md`: the two stray `code:` entries go into the frontmatter, and the closing note shows the key shape.
- studio.md does not graduate: §3.3, §3.6, §4.1, §6.2, §7.3 and the rest stay open.

## Decisions

- **Open:** which spelling §7.4 makes the contract for a Stylebook tag rule: the bare key the code writes (`h1`, and `table` then `th`), or the `& h1` rule the text promised. Recommendation: the bare key, reconciling the text, because every reader already uses it:
  - Only a bare key is confined to the specimen cards; `& div` would restyle the catalogue's chrome.
  - The Customized filter resolves bare paths.
  - In `project.json` a bare key is byte-for-byte the unscoped rule `jx build` ships. `& h1` would be `:root h1`, a specificity bump nobody asked for.
  - Moving the code to `&` would mean migrating every project whose tag rules are already bare: `sites/jxsuite.com/project.json` and the saas, event, fitness-studio and home-services starters.
  - If declined, this plan cannot land as written: it becomes `implement` (size M), changes the two path mutators, `transposeStylebookStyle`, `hasTagStyle` and `resolveContextStyle` to the `&` spelling, migrates those five projects, and `plan:studio/stylebook-layers-tag-keys` is redesigned around `& tag` keys.
- **Open:** whether Stylebook should also read a hand-written `& tag` block as that tag's rule. Recommendation: no, and §7.4 says so in one sentence, because they are different rules. In `project.json`, `:root a` outranks `a`, so showing one's values under the other would misreport which wins, and a write would have to pick one of the two blocks. The one such block in a tracked project root style (`packages/starters/sites/restaurant/project.json`'s `& a`) keeps rendering on every page and in the specimen canvas. It just is not listed as the `a` default.
- **Decided:** §7.4 states the write for any tag path ("one key per segment of the path the selection names, §7.3") and gives `table th` as its example. It does not say which path an Outline row names, because that is §7.3's selection mechanics and today the two entry points disagree for `table`'s parts. Worded this way, §7.4 is true before and after `plan:studio/stylebook-layers-tag-keys` settles §7.3.
- **Decided:** the breakpoint and scheme paragraph cites §6.2 rather than restating its rules. It names the two ways the pane's size is chosen here (the context bar, a click in a breakpoint's panel) and the Base-only scheme routing, because §6.2's "The breakpoint and scheme axes" is where that contract lives.
- **Decided:** the token paragraph is rewritten to what ships (every group, every declared context kind, colour scheme rows unprompted, the Contexts link, the push to both canvas kinds), because `docs/studio/design/tokens.md` already documents exactly this and the code is the superset.
- **Decided:** add two pinning test cases even though the disposition is `reconcile`, because §7.4 becomes a contract that another plan reads. Today only the mutators are tested on the nested shape, and nothing drives a Stylebook-mode commit through `contextMutate`. The cost is one `packages/studio` run on this pull request.
- **Decided:** the marker is deleted, not rewritten as `Implemented`, because §7.4 was unmarked before the census and its siblings read as closed the same way.
- **Decided:** no `requires`. The rewrite is true against today's tree. `plan:studio/stylebook-layers-tag-keys` depends on this plan, not the reverse, and that edge is written in its own `requires`.
- **Decided:** the release is `minor`, the program's level for a `reconcile`, and not `major`. The behaviour authors meet has always been the bare key, so nothing they rely on is redefined; only the text that described it wrongly changes.

## Implementation

One pull request.

1. **`specs/studio.md` §7.4.** Delete the line-780 marker. Replace the line-782 and line-784 paragraphs with the four paragraphs under Specs & docs. Leave the heading and the line-786 paragraph as they are.
2. **`specs/studio.md` §7.2**, line 764. Change "Root document styles (`$style`) applied to all elements" to "Root document styles (`style`) applied to all elements". §3.6's `$style` (line 154) belongs to that section's plan and is not touched.
3. **Fragment.** Run the `bun run spec:change studio.md minor -m "…"` command under Specs & docs.
4. **`packages/studio/tests/style-panel.test.ts`**, in `describe("stylebook mode")`. Add the two cases under Tests. Reuse the file's existing `renderPanel("stylebook")`, `row`, `input`, `chip`, `fire` and `settle`. Seed each case with `resetStudioState()`, then `resetWorkspaceWithTab` on a root-only document (`{ tagName: "div" }`, `$media` where needed), `tab.session.selection = [[]]` (the way `selectStylebookTag` parks it, and what makes the commit's target the root rather than the `setupTab` child the existing cases select), and `tab.session.ui.styleSections = { typography: true }`. `selectStylebookTag` is mocked in this file, so set `tab.session.ui.activeSelector` and `shell.stylebook.selection` directly, to the same path, in every case: `buildView` takes the Stylebook branch only while `shell.stylebook.selection` is set, and no hook in this file resets it, so a case that leaves it to the previous one is order-dependent. No source file changes.
5. **`docs/studio/design/stylebook.md`.** Make the two edits under Specs & docs.
6. **Plan housekeeping.**
   - Delete this file.
   - In `plans/studio/README.md`, the "Spec-wide decisions" bullet on the shape of a Stylebook tag rule cites this plan, so rewrite it to: "The shape of a Stylebook tag rule is stated in studio.md §7.4 (bare nested tag keys, one per path segment), and `plan:studio/stylebook-layers-tag-keys` makes the layers tree read it." That plan requires this one, so it is still open here; it deletes the bullet when it lands.
   - Remove `studio/stylebook-editing-text` from `plan:studio/stylebook-layers-tag-keys`'s `requires`, leaving `requires: []`, and re-read that plan's Specs & docs against the §7.4 text as landed.

**Integration contract.** Once this lands, studio.md §7.4 states that:

- A Stylebook edit writes into the open document's root `style`, one bare key per segment of the tag path the selection names, never an `&` key or a spliced multi-tag key.
- At a breakpoint it writes under that breakpoint's `@` block. At Base with a forced, declared scheme it writes under the scheme's `@--name` block.
- The specimen canvas and the Customized filter read that shape through `transposeStylebookStyle` and `hasTagStyle` (`packages/studio/src/panels/stylebook-doc.ts`, unchanged here).
- A hand-written `& tag` block is a different rule that Stylebook does not read.

`plan:studio/stylebook-layers-tag-keys` may rely on that. When it lands:

- It adds the Outline's dot to the readers §7.4's second paragraph names, in its bold lead and beside the Customized filter.
- §7.3 must name one path per part, since the Outline row keys (`table thead tr th`, `table thead tr`, `table tbody tr td`, `table tbody tr`) disagree with what a canvas hit names (`table th`, `table tr`, `table td`). Recommendation: root tag plus the part's own tag, because that is what `pathToTag` records, what a canvas hit already writes, and the selector an author writes by hand.
- §7.3's highlight and pan-to-card claim holds only for root tags today, because `tagToCardPath` has no compound keys.

A later change to the token editor edits §7.4's fourth paragraph only. A change to how the breakpoint or scheme is chosen edits §6.2, and §7.4's third paragraph stays true because it cites §6.2.

## Tests

Suite: `bun test --isolate --coverage` from `packages/studio`. New cases in `packages/studio/tests/style-panel.test.ts`, `describe("stylebook mode")`:

- **"a Stylebook edit writes one bare key per tag-path segment, and a clear prunes the path"**
  - Setup (step 4's seed): root `style` `{ table: { th: { textTransform: "capitalize" } } }`, `activeSelector` and `shell.stylebook.selection` both `"table th"`.
  - Fire `change` on `input(row(c, "textTransform"))` with `"uppercase"`. Assert the root style `toEqual({ table: { th: { textTransform: "uppercase" } } })`, so there is no `"table th"` key and no `"& th"` key.
  - Click the property's chip. Assert the root document has no `style` at all (both levels pruned).
- **"at Base a forced scheme routes the tag key into the scheme's block, and a breakpoint does not"**
  - Setup (step 4's seed): `$media` `{ "--dark": "(prefers-color-scheme: dark)", sm: "(min-width: 640px)" }`, root `style` `{ h1: { textTransform: "capitalize" } }`, `activeSelector` and `shell.stylebook.selection` both `"h1"`, `previewColorScheme` `"dark"`.
  - Commit `"uppercase"`. Assert `style["@--dark"]` `toEqual({ h1: { textTransform: "uppercase" } })` and that `style.h1` is unchanged.
  - Then set `activeMedia` to `"sm"`, re-render and commit `"lowercase"`. Assert `style["@sm"]` `toEqual({ h1: { textTransform: "lowercase" } })` and that `style["@--dark"]` is unchanged.

Coverage: the plan adds no source file, so the manifest check (`bun scripts/check-coverage-manifest.ts packages/studio`) is unaffected. The cases exercise already-covered branches of `contextMutate` and the two mutators, so no per-file figure falls and `packages/studio/bunfig.toml`'s `coverageThreshold = { lines = 0.958, functions = 0.941 }` stays as it is. Ratchet only if the run shows the workspace's worst file rose, which this change is not expected to do.

Gates in `checks`:

- `bun run docs:status`: §7.4 has no marker, and the studio.md header stays Partial.
- `bun run plans:check`: no `claim-not-open`, no dangling citation of this plan.
- `bun run docs:spec-release`: the fragment covers the §7.2 and §7.4 body edits.
- `bun run docs:check` and `bun run docs:links`: the stylebook page's `code:` paths exist, and no anchor moves.
- `bun run docs:prose`: no em dash in the docs edit.
- `bun run docs:markdown`: one paragraph per line, no escaped heading.
- `bun run docs:section-refs`: any `§` the new test's comments cite resolves in studio.md.

## Specs & docs

**studio.md §7.4**, in place. Delete the line-780 marker. Replace lines 782 and 784 with these four paragraphs, one line each:

> **A Stylebook edit writes a bare tag key into the open document's root `style`.** The key is the tag path the selection names (§7.3), one key per segment: styling `h1` writes `{ "h1": { … } }`, and styling the path `table th` writes `{ "table": { "th": { … } } }`. It is never a `& h1` rule and never a spliced `"table th"` key. The commit walks the path, creating each level on demand and pruning every level a cleared value leaves empty, so clearing a rule's last property leaves no empty block behind (`mutateUpdateNestedStylePath` in `packages/studio/src/tabs/transact.ts`).
>
> **The specimen canvas, its Customized filter and the site stylesheet read that shape.** The specimen canvas (§7.2) re-keys each bare tag key under the card preview's scope, so a rule for `div` styles the specimens and not the catalogue's own cards, and the Customized filter asks whether a tag's path resolves to a non-empty block, directly or inside any `@` block (`transposeStylebookStyle` and `hasTagStyle` in `packages/studio/src/panels/stylebook-doc.ts`). In `project.json`, the document Project Styles opens by default, the site stylesheet emits a bare tag key as the same unscoped element rule `jx build` writes into every page (§4.1). A hand-written `& h1` block is still an ordinary nested rule (`spec.md` §9.2) and still renders, but it is a different key, and in `project.json` a different rule (`:root h1`, which outranks `h1`), so Stylebook neither shows its values under `h1` nor writes to it.
>
> **The breakpoint and the scheme are the pane's (§6.2).** Project Styles has no breakpoint tabs: the size is the one chosen on the pane context bar, or by clicking in that breakpoint's panel of the canvas, and an edit at a breakpoint writes the same path inside that breakpoint's `@` block. At Base, a forced colour scheme with a declared scheme query routes the edit into that scheme's `@--name` block instead; scheme × breakpoint compound blocks are not supported, so at a breakpoint it does not. Either way the live `styleUpdate` re-applies the specimen canvas's style in place, through the runtime's dual emission for a scheme block (`spec.md` §9.5).
>
> **Design tokens are edited in Project Settings › CSS Variables (§17.1)**, over the same `project.json` tab Project Styles opens. It lists every custom property in the project's root `style`, grouped as colours, fonts, sizes and other, and any token can carry a different value in any context the project declares, breakpoints, colour schemes and other feature queries alike. An override is written beside the base value as `"@--name": { "--token": … }`, and clearing the last one in a block removes the block (`packages/studio/src/settings/css-vars-editor.ts`, `packages/studio/src/style/project-styles.ts`). A colour token shows a row per declared scheme whether or not it carries a value there; any other context is added from the token's own override picker, which offers only the declared contexts it has no row for yet, and a token with no value is offered none. A context is never declared here. Project Settings › Contexts (§17.1) is the single definition site for breakpoints and colour schemes, and while the project declares no colour scheme the Colours group says so and links there (**Manage contexts…**). A token edit reaches every live canvas in place, page canvases through the site-style sheet replace (§4.1) and the Project Styles canvas through the same `styleUpdate` a Stylebook edit uses, with no re-render (`pushProjectStylesToCanvas` in `packages/studio/src/style/live-preview.ts`).

The line-786 paragraph ("Stylebook's own compound target is stated by the Target Line (§6.2)…") stays as the section's last paragraph.

**studio.md §7.2**, line 764: "Root document styles (`$style`)" becomes "Root document styles (`style`)".

**Fragment:** `bun run spec:change studio.md minor -m "§7.4: a Stylebook edit writes one bare tag key per path segment into the open document's root style, at the pane's breakpoint or forced scheme, and a hand-written & tag block is a separate rule it does not read; the token editor overrides any token in any declared context; §7.2 names the root style key."`

**Docs.** `docs/studio/design/stylebook.md` is the only page whose `spec:` cites `studio.md#7.4`, and it changes in two places:

- Move `  - packages/studio/src/surfaces/panel-stylebook-layers.ts` and `  - packages/studio/src/surfaces/stylebook-chrome.ts` from the end of the file into the frontmatter `code:` list, after `packages/studio/src/style/project-styles.ts`. The page then ends with the "Modes and views" bullet.
- Replace the first sentence of the closing `:::doc-note` with: "Element defaults are saved as rules named for the tag in the open file's top-level `style`, such as `"h1": { … }`, and a nested part sits inside its element's rule, as in `"table": { "th": { … } }`." The rest of the note stays. No em dash.

Checked, no change: `docs/studio/design/tokens.md` already describes every group, the per-scheme rows, **Add override…**, **Manage contexts…** and the in-place push. `docs/studio/design/style-inspector.md` and `docs/studio/design/states-and-selectors.md` list `style-panel.ts`, which this plan does not change. `docs/studio/design/breakpoints.md` already puts the breakpoint on the context bar.

The spec does not graduate (see Outcome), so there is no `spec:bump`, and `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 7.4 Style Editing/,/^## 8\./p' specs/studio.md` shows the heading, no `> **Status:` line, the four paragraphs above and the Target Line paragraph.
- `grep -nF -e "Media breakpoint tabs" -e "nested CSS rules" -e "scheme-aware for color tokens" specs/studio.md` prints nothing, and `sed -n '/^## 7\./,/^## 8\./p' specs/studio.md | grep -c "[$]style"` prints `0` (it prints `2` today; §3.6's `$style` belongs to another plan).
- `bun run plans:status --who-claims studio.md#7.4` names no plan, and `bun run plans:status --spec studio` no longer lists §7.4.
- `ls specs/changes/studio-*.md` includes the new fragment, and `bun run spec:release --dry` shows it minting a studio.md minor.
- From `packages/studio`, `bun test --isolate tests/style-panel.test.ts` passes, including the two "stylebook mode" cases above. `bun test --isolate --coverage` stays at or above `bunfig.toml`'s thresholds, and `bun scripts/check-coverage-manifest.ts packages/studio` (from the root) passes.
- `tail -3 docs/studio/design/stylebook.md` ends with the "Modes and views" bullet, and `sed -n '1,16p' docs/studio/design/stylebook.md` lists both surfaces under `code:`.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` pass.
