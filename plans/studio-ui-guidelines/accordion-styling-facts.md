---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#5.2
requires: []
workspaces:
  - packages/studio
size: S
---

# Accordion styling states what the kit's accordion draws, and the Data panel's category headers draw the way it says

## Context

`specs/studio-ui-guidelines.md` §5.2, line 339:

> **Status: Partial.** The part-keyed style block ships. Both facts beside it are stale: `jx-accordion` draws a 1px `--jx-border` rule between items (`packages/ui/components/jx-accordion.json`), and `jx-accordion-item`'s header text is `--jx-text-md`, which is why `packages/studio/src/surfaces/panel-signals.json` sets `border: none` and re-declares `--jx-text-md` to reach 11px.

The body under it (line 341) says the kit element "carries no border of its own to remove, and its header text is `--jx-text-sm`", then contrasts the Spectrum-era `sp-accordion { border: none }` rule.

**What exists** (verified 2026-09-27)

- `packages/ui/components/jx-accordion.json` observes only `multiple` and draws the seam as `& > :not([hidden]) ~ *` → `borderBlockStart: 1px solid var(--jx-border)`. The seam sits on each later visible section, never on the container, and the rule is (0,2,0). `packages/ui/tests/accordion.test.ts` pins it ("the seam falls BETWEEN sections, and never above the first VISIBLE one"). `ui.md` §5.4 already states it: "one hairline between sections and never above the first".
- `packages/ui/components/jx-accordion-item.json` draws its host, header and body alike, at `fontSize: var(--jx-text-md)`. Its internal parts are `heading`, `details`, `summary`, `marker`, `marker-icon`, `label`, `actions` and `body`. Its summary rule sets box and interaction properties, but not `font-size`, `max-width` or `color`.
- `packages/studio/src/surfaces/panel-signals.json` (root `style`):
  - `& [part="categories"] { border: none }` targets the `jx-accordion` host, which draws no border. **The rule does nothing**, and the seam draws between categories. It is a verbatim port of `.signals-panel sp-accordion { border: none }` from `styles/inspector.css` (074fcc6c). The Style panel's identical `.style-sidebar sp-accordion` rule was deleted rather than ported (e24e0e8b).
  - `& [part="category"] { --jx-text-md: var(--jx-text-sm) }` re-declares the item's size to 11px, as its own `$description` intends.
  - **Census miss: the header never reaches 11px.** The entry row's one-line summary span is `part="summary"`, and its rule `& [part="summary"]` sets `maxWidth: 64px`, `fontSize: var(--jx-text-xs)`, `color: var(--fg-dim)`, `overflow: hidden` and `whiteSpace: nowrap`. The runtime scopes a surface rule as a plain descendant selector, `[data-jx="…"] [part="summary"]` (`packages/runtime/src/runtime.ts`, the `SCOPE_TOKEN` replacement). So the rule also matches the `<summary part="summary">` of every category the panel draws, and each category header is drawn clipped to 64px, at 10px, dimmed. `docs/images/data-explorer.png` shows it: the headers read "Stat…" and "Expr…" where the labels are "State (3)" and "Expressions (N)" (`CATEGORY_LABELS` in `packages/studio/src/panels/signals-panel.ts`). The collision landed with the port too (074fcc6c).
- `packages/studio/src/surfaces/doc-header.json` reaches the item's parts on purpose: `& [part="raw"] [part="summary"]` sets the Raw head tags' header to `--jx-text-sm`.
- The other four accordion surfaces (`style-panel.json`, `properties-panel.json`, `logic-panel.json`, `panel-elements.json`) set nothing on their sections, so they draw the kit's 12px headers and the seam. `style-panel.json` has its own `[part="label"]` span. Its rule `& [part="label"]` therefore also reaches every section label, but it declares only the ellipsis triple the kit's label already declares, so it draws nothing different.
- §5.1 (built, unmarked) gives `jx-accordion` a `"size": "sm"` it does not observe, and cites `ui.md` §5.3 (Forms) for it where the container elements are §5.4. The audit record assigns this editorial nit to this plan.

The stub expected a paper reconcile. The Signals collision makes the Data panel draw something neither the old text nor the corrected one says, so the pull request changes code.

## Outcome

studio-ui-guidelines.md §5.2 → Implemented. §5.2 states what the kit draws and how a surface adjusts it: the container's hairline (pointing at `ui.md` §5.4), the item's `--jx-text-md`, and the two surfaces that re-size their headers from their own part-keyed block. It also states that a surface rule reaches the item's parts. The Data panel's category headers draw their full label at 11px in `--jx-fg`. Its dead `border: none` is gone. §5.1's example and citation are corrected.

## Decisions

- **Decided:** disposition `implement`, not the stub's `reconcile`, because the Signals headers are drawn wrong today (Context). The fix is a part rename in one surface document, and the spec text is only true once it lands.
- **Decided:** fix the collision by renaming the entry's span to `part="entry-summary"` rather than anchoring the selectors under `[part="entry"]`. An anchored rule leaves two meanings of `summary` in one panel, so the next bare `& [part="summary"]` or `querySelector('[part="summary"]')` gets it wrong again. The panel's own `$description` already names that rule for `entry`/`row` ("two documents sharing a container may not share a part name"). `entry-summary` follows `entry-group`.
- **Decided:** §5.2 corrects the restatement and points at `ui.md` §5.4 for the hairline, the spec-wide choice between correcting and pointing. It names the text token itself, because `ui.md` §5.4 does not state the item's size and §2.2 tabulates it by token.
- **Decided:** §5.2 gives no recipe for removing the hairline. No surface removes it. A surface rule keyed on a section ties the kit's seam rule at (0,2,0), so which one wins is sheet order (`ui.md` §2's cascade note), and a spec recipe that holds only by adoption order is not a contract.
- **Decided:** the Spectrum history paragraph goes. Its contrast rests on the stale fact (a component border to delete against none), and the new text states what a surface reaches directly.
- **Decided:** no `requires` edge on `plan:studio-ui-guidelines/chrome-type-scale`. The critic suggested one, but it runs the other way. Under that plan's recommendation the item stays at `--jx-text-md`, so §5.2's token is right before and after it lands. Its §2.2 text ("as the Signals panel's categories … do at 11px") and its acceptance check ("A Signals category header computes 11px") are false until this plan's rename lands. So `plan:studio-ui-guidelines/chrome-type-scale` should require this plan. If review takes that plan's kit route instead, the kit change lands second and edits §5.2's token sentence in place in the same pull request (§5.2 is Implemented by then). That avoids the cycle its current text would create.
- **Open:** does §5.2 make "a surface names its own parts apart from the kit element's" a rule? Recommendation: no. State the reach as a fact and fix the one instance that draws wrong. A general rule and its gate belong to the part contract in `ui.md` §3.1 and §3.2, not to one element's section. A survey of `packages/studio/src/surfaces/*.json` finds 24 surfaces that give one of their own nodes a part name an element they render also uses internally. Most are harmless: anchored rules, a kit part drawn only on a condition (`jx-action-button`'s `badge`), or identical declarations (`style-panel.json`'s `label`). A normative sentence here would be contradicted by `style-panel.json` on day one, and so could not be marked Implemented.

## Implementation

1. `packages/studio/src/surfaces/panel-signals.json`:
   - In the entry row's disclosure button, change the third span's `"part": "summary"` (the node carrying `data-tone` and `title: ${$map.item.summaryTitle}`) to `"part": "entry-summary"`.
   - In the root `style`, rename the selector keys:
     - `& [part="summary"]` becomes `& [part="entry-summary"]`.
     - `& [part="summary"][data-tone="pending"]` becomes `& [part="entry-summary"][data-tone="pending"]`.
     - `&[data-refreshing] [part="summary"][data-tone="pending"]` gets the same rename, both at the top level and inside `@(prefers-reduced-motion: reduce)`.
     - Leave the `$description`s on those rules as they are, since they describe the entry summary.
   - Delete `& [part="categories"]` (`border: none`). Keep `& [part="category"]` and its `--jx-text-md` re-declaration unchanged.
   - Append to the root `style`'s `$description`: "The entry's one-line summary is `part=\"entry-summary\"` for the same reason: every category is a `jx-accordion-item`, whose header is its own `[part=\"summary\"]`, and a rule keyed on the bare name clipped every header in the panel to the entry summary's 64px (studio-ui-guidelines.md §5.2). The categories stack keeps the kit's hairline; the `border: none` that stood here struck a border the container never draws." The citation is qualified, because a bare `§` in `packages/studio` means `studio.md`.
2. `packages/studio/tests/signals-panel-fixture.ts`: `summaryTone` and `summaryText` query `[part="entry-summary"]`.
3. `packages/studio/tests/studio-shell-automation.test.ts` (line 183) and `packages/studio/tests/left-panel.test.ts` (line 268): the row's `querySelector('[part="summary"]')` becomes `[part="entry-summary"]`.
4. No TypeScript source changes. `packages/studio/src/panels/signals-panel.ts` projects `summary`, `summaryTone` and `summaryTitle` as data fields and never names the part, and no screenshot manifest entry, region or docs page names it.
5. The spec edits in **Specs & docs** land in the same pull request.

**Integration contract.** Once this lands:

- The Data panel's category headers draw the kit's summary unaltered: full label, `--jx-fg`, at 11px through the `--jx-text-md` re-declaration on `[part="category"]`, with the kit's hairline between visible categories.
- The entry's one-line summary is `[part="entry-summary"]`, and the test helpers `summaryText`/`summaryTone` read it.
- `studio-ui-guidelines.md` §5.2 names `--jx-text-md` as the item's size and the Signals and document-header overrides as the pattern. `plan:studio-ui-guidelines/chrome-type-scale` may cite them from §2.2, and its "Signals category header computes 11px" check holds.
- `plan:studio-ui-guidelines/section-open-state` finds §5.1's example unchanged apart from the dropped `size` and the corrected citation.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `packages/studio/tests/signals-panel-template.test.ts`: add "an entry's summary is named apart from the section header the kit draws" under `describe("the entry list")`.
  - It draws `{ $count: { default: 0, type: "integer" }, save: { $prototype: "Function", body: "" } }`, which gives two categories, so the second header is seamed.
  - It asserts that every `panel.querySelectorAll('[part="summary"]')` match has a parent whose `part` is `details`, which makes it a kit header, and that there are exactly two.
  - It asserts `entryRow(panel, "$count").querySelector('[part="entry-summary"]')` is non-null.
  - It reads `src/surfaces/panel-signals.json` with `readFileSync` and walks the root `style` object recursively. It asserts no key contains `[part="summary"]` and that `& [part="categories"]` is absent. A stale selector would reach the kit headers again, and that is the regression this case exists for.
  - Add the `node:fs`/`node:path` imports after the file's existing first import, which must stay first because it pulls in the DOM harness.
- The existing cases that read `summaryText`/`summaryTone`, "the Data panel the commands drive" in `studio-shell-automation.test.ts` and the Data-panel case in `left-panel.test.ts` keep passing against the renamed part. `categoryLabels` in the template test already reads the kit's `[part="category"] [part="summary"] > [part="label"]` and needs no change.
- Coverage: no TypeScript source changes and no file is added. The per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) and the manifest check are unaffected, and there is no ratchet.
- The change touches `packages/studio/src/**`, so the screenshot lane re-captures `data-explorer.png` and `counter-data-explorer.png`, and the category headers change from "Stat…" to the full label. That is the fix showing, not a regression.

## Specs & docs

- **studio-ui-guidelines.md §5.1** (lines 319–335): change "(`ui.md` §5.3)" to "(`ui.md` §5.4)", and delete the `"size": "sm",` line from the example. Nothing else in §5.1 changes.
- **studio-ui-guidelines.md §5.2** (lines 339–341): delete the Partial marker and the body paragraph, and replace them with the text below. The heading stays. The section carries no marker afterwards, like the built §4.5 and §4.6.

  > A section's look is the kit's, and a surface adjusts it from its own `style` block, keyed on `part`. `jx-accordion` draws one 1px `--jx-border` hairline between visible sections and none above the first (`ui.md` §5.4), as the `border-block-start` of each later section, and no Studio panel removes it. `jx-accordion-item` draws its header and its body at `--jx-text-md`. A panel whose own text runs a step smaller re-sizes its headers from its own block: the Signals panel re-declares `--jx-text-md` as `--jx-text-sm` on its `[part="category"]` sections, and the document header sets its Raw head tags' `[part="summary"]` to `--jx-text-sm`.
  >
  > A surface's rule is a descendant selector under the surface's own scope, so a rule keyed on one of the item's part names (`heading`, `details`, `summary`, `marker`, `label`, `actions`, `body`) reaches that part of every section the surface draws. The document header's rule means to. A surface part that shares one of those names restyles the headers beside it whether it means to or not, which is why the Signals panel's entry summary is `[part="entry-summary"]`.

  (The quote marks show the replacement text; the spec text itself is not a blockquote.)

- **Fragment:** `bun run spec:change studio-ui-guidelines.md minor -m "§5.2 states the accordion look the kit draws, a hairline between visible sections and header text at the medium type step, and that a surface's part-keyed rule reaches the item's own parts; §5.1's example drops a size the container does not observe."`
- **Docs:** no page's `spec:` cites `studio-ui-guidelines.md#5.1` or `#5.2`, and no page's `code:` lists `surfaces/panel-signals.json` (`docs/studio/logic/data.md` lists the adapter, `surfaces/panel-signals.ts`, which does not change). No prose changes. Re-read `docs/studio/logic/data.md` ("collapsible sections with counts", now visible in its image) and `docs/start/first-component.md` §9 against the images the screenshot lane re-captures. `docs/extending/ui-kit.md`'s accordion paragraph describes the kit and stays true.
- **Graduation:** no. The spec keeps open items owned by other plans. The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green, including the new case, and no file falls below its threshold.
- `bun run --cwd packages/studio lint:styles` passes.
- In `packages/studio/src/surfaces/panel-signals.json`, `grep -c 'part=\\"summary\\"'` (selectors) and `grep -c '"part": "summary"'` (nodes) both print `0`, and `grep -c 'entry-summary'` prints at least `6`.
- In `specs/studio-ui-guidelines.md`, `grep -n '"size": "sm"'` no longer matches inside §5.1, and §5.1's opening sentence cites `ui.md` §5.4.
- `bun run plans:status --spec studio-ui-guidelines` no longer lists §5.2.
- These gates pass: `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:section-refs` and `bun run docs:markdown`.
- By hand, run `bun run dev` from the repository root (the `packages/studio:verify` recipe), open `packages/starters/sites/real-estate` › `components/re-listings-filter.json` (the `data-explorer-shot` fixture), and press ⌘6:
  - The category headers read "State (3)" and "Expressions (…)" in full, and each header's `<summary>` computes `font-size: 11px` and no `max-width`.
  - The second header's `jx-accordion-item` computes `border-block-start: 1px solid`.
  - An entry's `[part="entry-summary"]` still clips at 64px.
