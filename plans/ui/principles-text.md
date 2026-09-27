---
status: drafted
disposition: reconcile
claims:
  - ui.md#2
workspaces:
  - packages/ui
  - specs
  - docs
size: S
---

# The principles say what a surface draws, what the cascade does and which id references the kit writes, and a test holds the anchoring claim

## Context

`specs/ui.md` §2, line 23 (excerpt):

> **Status: Partial.** What holds: principle 1 up to its last clause, … principle 4 on the kit's side, … while Studio's side of it is studio-ui-guidelines.md §12's own open items; … What is short is text the code contradicts in three places. Principle 1's last clause, "a surface carries no markup of its own beyond the kit's", does not hold, and no gate looks at it: … Principle 2's cascade: only the THEME sheet is layered, while an element's own rules are emitted unlayered as `[data-jx="…"]` at (0,1,0) by `packages/runtime/src/runtime.ts` and adopted after every linked sheet, so a host rule wins by being heavier or adopted later and never by layer (…). And principle 2's id references: the kit writes no `anchor-name` anywhere, because every panel is placed against its implicit anchor (§6).

Disposition `reconcile`. In all three places the code already does what the rest of the spec describes. Re-verified against `ffe45081` on 2026-09-27.

**Principle 1** (line 25): "a surface carries no markup of its own beyond the kit's".

- 86 of the 89 documents in `packages/studio/src/surfaces/*.json` write a native `div`, 77 a `span`, 29 a `button`, 15 a `ul`, 6 an `input` and 2 a `table`. Each native `button` carries a `part` and draws a surface-specific box (`part="recent"` in `welcome.json`, `part="file-path"` in `panel-problems.json`, `part="pin"` in `tab-strip.json`). §3.1 already decides kind "by how many definitions draw the box", which makes these parts of the surface that draws them.
- A class written to reach a rule is §3.1's defect (`shell.json`, `panel-elements.json`), owned by `plan:ui/surface-classes-to-parts`. A surface redrawing an element the kit ships is §5.2's toast stack (`surfaces/toasts.json`), owned by `plan:ui/studio-toast-host`.
- What holds: `packages/studio/scripts/check-surface-purity.ts` refuses lit in an adapter and a kit tag in a lit template. `packages/ui/package.json` depends only on `@jxsuite/runtime` and `@jxsuite/schema`.

**Principle 2's cascade** (line 26): "the kit's own sheet lives in a cascade layer so a host's rule always wins (§9)".

- The first half is literally true. §3.1 makes the theme the only sheet the kit emits, and it is the `"@layer jx-ui"` key in `packages/ui/project.json`, emitted by `themeCSS()` in `packages/ui/src/theme.ts` and held by `tests/theme.test.ts` ("is one layered sheet of tokens on :root").
- The second half is false for anything but a token. An element's rules come from its definition's `style` and are written by the runtime's stylesheet engine (`packages/runtime/src/runtime.ts`: `data-jx` handle, `[data-jx="${uid}"]` at line 2281, appended to `adoptedStyleSheets` at line 1818). They are unlayered, at (0,1,0) plus whatever they key on (`jx-button`'s `& > [part="control"]` is (0,2,0), its variants (0,3,0)), and adopted after the document's own sheets. spec.md §9.6 (Implemented) makes that deliberate ("Jx emits no cascade layer of its own"). `packages/runtime/tests/stylesheet-engine.test.ts`'s "the cascade premises the design rests on" block guards both premises.
- §9 already says the same ("win over a kit token by cascade order … Jx's own style emitter stays unlayered"). §5.5 (line 318) records the weight rule, with the Edit column's handles as the worked example: `packages/studio/src/surfaces/canvas-stage.json`, `& [part="edit-handle"]` at (0,2,0) and the lit look restated at (0,3,0). The dock handles' `#app > .resize-handle` in `styles/shell-frame.json` is class-keyed, so it is not cited until `plan:ui/surface-classes-to-parts` re-keys it.

**Principle 2's id references**: "`aria-activedescendant`, `aria-controls`, `aria-labelledby`, `popovertarget`, `commandfor`, `anchor-name`".

- `anchor-name` is a dashed ident, not an id reference. No kit document or behaviour writes it. It appears only in `$description`/`description` prose in `jx-popover.json`, `jx-menu.json`, `jx-tooltip.json` and a comment in `src/behaviors/popover.ts`, each saying the implicit anchor needs none. §5.2 (line 187), §6 (line 372) and §11's CSS Anchor Positioning row say the same.
- **Correction to the stub:** no test holds that negative. `grep anchor-name packages/ui/tests` finds nothing, and the Anchor Positioning row's evidence tests assert placement, not absence.
- **Correction:** the list also omits two id references the kit does write: `interestfor` (`jx-button.json`, `jx-action-button.json`) and `aria-describedby` (8 documents).

**Principles 3 to 5** hold as the marker says. Principle 4's Studio half is studio-ui-guidelines.md §12.1 to §12.5, owned there. Principle 5's allowed set is widened by `plan:ui/behaviour-list-text` as a ride-along, on line 29, which this plan does not touch.

**Ride-along, carried here by the audit record** (plans/ui/README.md, spec-wide decisions): §11's CSS Scoping row (line 425) says "the only piece of the module the kit meets is `:host`, which the runtime translates to the tag (spec.md §16.6)", with `packages/runtime/src/runtime.ts` as evidence. It is wrong twice, and the census found only the first:

- No kit component document writes `:host`.
- The interpreter has no `:host` handling at all. spec.md §16.6's own marker says so. `resolveOneNestedSelector` in `packages/runtime/src/css.ts` would emit `[data-jx="…"]:host`, which matches nothing in light DOM.
- The translation to the tag is the compiler's: `resolveSelectorMember` in `packages/compiler/src/shared.ts`, tested by `packages/compiler/tests/shadow-dom.test.ts` (":host translates to the tag name in light DOM").
- `plan:spec/shadow-dom-parity` moves that translation into the runtime as `resolveHostKey` in `packages/runtime/src/css.ts`. Its integration contract says whichever of the two plans lands second names that function.

**Docs.** `docs/extending/ui-kit.md` "Style a part" says "A rule on an ancestor works the same way" as a usage-site `style`. It does not work the same way: an ancestor's `& jx-button > [part="control"]` is (0,2,1), which beats the button's rest rule (0,2,0) but not a variant (0,3,0), and a linked stylesheet's `jx-button > [part="control"]` (0,1,1) beats neither. No page cites `ui.md#2`.

## Outcome

- ui.md §2 → Implemented. Principle 1 says a box only a surface draws is its part and that a surface never redraws a kit element. Principle 2 lists the id references the kit writes, puts a panel's anchor on its invoker, and says an element's rules are unlayered, so a host overrides them by weight or order. The marker is reduced to its evidence.
- Riding along, with no claim: §11's CSS Scoping row (note and evidence) and the CSS Anchor Positioning row's evidence.
- `packages/ui/tests/conformance.test.ts`: the principles block refuses `anchor-name`, `position-anchor`, `anchor()` and `:host` in a component document.
- `docs/extending/ui-kit.md` states the weight rule for a site author.
- ui.md's header stays Partial (§3.1, §3.2, §3.3, §4.1, §5.1, §5.2, §5.4, §5.5, §6 and §7 stay open under other plans). Nothing graduates.

## Decisions

- **Open:** where principle 1 draws the line between a surface's own part and a redrawn kit element. Recommendation: by the box and its contract, not by the tag, as §3.1 decides kind. A native `button` that draws a recent-project row is a part. A `role="status"` stack of toast cards with its own timers is a redrawn `jx-toast-host`. A tag rule ("a native control the kit has an element for is drawn with that element") would make 29 button-drawing surfaces defects that no plan owns. §2 would then need a new Partial marker and an `implement` plan behind it.
- **Open:** does §2 flip to Implemented while the rules principle 1 now cites (§3.1's classes, §5.2's toast stack) and principle 4's Studio half (studio-ui-guidelines.md §12) are still open where they are specified? Recommendation: yes. Each of those is marked and owned in its own section. Holding §2 would give each item a second marker. It would also put this paper fix behind `plan:ui/surface-classes-to-parts` and `plan:ui/studio-toast-host`, both M. The census already took that call for principle 4.
- **Decided:** principle 2 is rewritten to the cascade that ships rather than moving element rules into `jx-ui`, because spec.md §9.6 (Implemented) rejects a Jx layer on purpose. An unlayered `$head` stylesheet would then beat every element, and the canvas's `@layer jx-canvas-ua` emulation depends on author rules staying unlayered.
- **Decided:** the id list drops `anchor-name` and gains `interestfor` and `aria-describedby`, because the list should name what the kit's documents write. A new sentence says a panel's anchor is its invoker (`popovertarget`, `interestfor` or `showPopover({ source })`), so §6 and principle 2 cannot drift apart again.
- **Decided:** two conformance cases hold the negatives: no own anchor and no `:host`. The marker's complaint was text that no gate looked at, and §11's Anchor Positioning row makes the same negative claims with no test behind them. A `:host` key in a kit document silently matches nothing under today's interpreter. No source changes, so the plan stays `reconcile`.
- **Decided:** the CSS Scoping row is written in two variants, keyed on whether `plan:spec/shadow-dom-parity` has landed. Neither plan requires the other, and that plan's integration contract assigns the rename to whichever lands second.
- **Decided:** `docs/extending/ui-kit.md` gains the weight rule and `ui.md#2` in its `spec:`. It is the only page that tells a site author how to restyle a kit element, and its "works the same way" sentence overstates an ancestor rule.
- **Decided:** fragment level `minor`, because no behaviour changes. The old sentence never described what shipped, so authors had nothing to rely on that the rewrite takes away.

## Implementation

One pull request. It may ride the detailing pull request once the Open decisions are signed off, since its only code is test cases.

1. **`packages/ui/tests/conformance.test.ts`**, inside `describe("the kit keeps its principles (ui.md §2)")`, after the `$shadow` loop:
   - Add `function* styleEntries(node: unknown, path = "root"): Generator<[string, string, unknown]>`. It walks arrays and objects exactly as `shadowKeys` does. At every `style` key whose value is a plain object, it descends through that object and yields `[path, key, value]` for every key not starting with `$`, recursing into object values (nested selectors and at-rules). `$description` and other `$` keys are skipped, so prose cannot trip it.
   - `const OWN_ANCHOR_KEYS = new Set(["anchorName", "anchor-name", "positionAnchor", "position-anchor"])` and `const ANCHOR_FN = /(?<![\w-])anchor\(/`, which leaves `anchor-size()` alone.
   - `test("the style scan reaches nested selectors, at-rules and internal nodes")`: a synthetic document `{ tagName: "jx-probe", style: { '& [part="a"]': { "@media (width > 1px)": { anchorName: "--a" } } }, children: [{ tagName: "span", attributes: { part: "b" }, style: { ":host": { color: "red" } } }] }` yields both the `anchorName` and the `:host` entry. Without this, the two cases below could pass on an empty scan.
   - Per document: ``test(`${tag} leaves anchoring to the platform's implicit anchor`)`` expects no key in `OWN_ANCHOR_KEYS` and no string value matching `ANCHOR_FN`.
   - Per document: ``test(`${tag} writes no :host`)`` expects no key containing `:host`.
   - Extend the block's opening comment: principle 2's anchoring and the light-DOM host are statements about the kit's own sources, which is why they live here.
2. **`specs/ui.md`** §2 and §11, in place, as quoted under Specs & docs.
3. **`docs/extending/ui-kit.md`**, as under Specs & docs.
4. `bun run spec:change ui.md minor -m "…"` with the sentence under Specs & docs.
5. Delete `plans/ui/principles-text.md`. No plan requires it.

**Integration contract.** No plan requires this one. Once it lands:

- ui.md §2 principle 2 is the normative cascade rule. An element's rules are unlayered `[data-jx]` rules adopted after linked sheets, and a host overrides one by weight or order. `plan:ui/surface-classes-to-parts` must re-key the dock handles to a part selector heavier than `jx-split`'s hover (0,2,0). It may add that rule to §5.5 as a second example, but it need not edit §2.
- The principles block refuses an own anchor (`anchor-name`, `position-anchor`, `anchor()`) and `:host` in every component document. `plan:ui/overlay-transitions-and-slot`, `plan:ui/menu-radio-rows`, `plan:ui/jx-table` and any new component must keep to it.
- `plan:spec/shadow-dom-parity`: if it lands after this plan, its ui.md §11 edit swaps variant A of the CSS Scoping row for variant B (both quoted below). If it wants kit documents to use `:host`, it deletes the `:host` case and the note's "the conformance test refuses one" clause together.
- `plan:ui/behaviour-list-text` owns the principle 5 ride-along (line 29). If its Open is decided against the ride-along, that plan's step 6 edit moves here unchanged. The new marker's principle 5 sentence is true under either wording.
- `plan:ui/studio-toast-host` need not edit §2. Principle 1's "never redraws" clause points at §5.2, whose marker carries the toast stack until that plan lands.

## Tests

`packages/ui`: `bun test --isolate --coverage` from `packages/ui`, then `bun scripts/check-coverage-manifest.ts packages/ui` from the root.

- The new cases are the scan self-test and the two per-document cases from Implementation step 1: 38 documents × 2, plus 1.
- Every one passes on today's tree. `grep` finds no `anchorName`, `positionAnchor`, `position-anchor` key, `anchor(` call or `:host` key in `packages/ui/components/*.json`, and the only anchor function is `anchor-size(` in `jx-popover.json`.
- Mutation check for the reviewer: add `"anchorName": "--x"` under any nested block of `jx-popover.json`'s `style`, or a `":host"` key to `jx-kbd.json`'s. The matching case fails. Revert.
- Coverage: only a test file changes, and `coverageSkipTestFiles = true`. No source file is added, so the manifest check sees nothing new, and `coverageThreshold = { lines = 0.99, functions = 1.0 }` in `packages/ui/bunfig.toml` does not move.

Paper gates, all in `checks`:

- `bun run docs:status`: §2's marker form, and the header stays Partial.
- `bun run plans:check`: `ui.md#2` is no longer open, and this file is deleted.
- `bun run docs:spec-release`: the fragment covers the body change.
- `bun run docs:standards`: both §11 rows keep their class, their evidence paths exist, and neither note contains `|`.
- `bun run docs:check` and `bun run docs:links`: the new `spec:` entry and every `§` resolve.
- `bun run docs:prose`: the ui-kit.md edit has no em dash.
- `bun run docs:markdown`.

## Specs & docs

All spec edits are in `specs/ui.md`, in place. No heading changes.

**§2 marker (line 23)**, replaced whole:

> **Status: Implemented.** Principle 1: a surface is a document (`packages/studio/scripts/check-surface-purity.ts` refuses lit in an adapter and a kit tag in a lit template), and nothing in `packages/ui` depends on Studio (`packages/ui/package.json`); the rules it states for a surface's own boxes are §3.1's and §5.2's, and each of those sections' markers says what a surface still owes. Principle 2: light DOM and no anchor of the kit's own, by `packages/ui/tests/conformance.test.ts` (no `$shadow`, no `:host`, and no `anchor-name`, `position-anchor` or `anchor()` in any component document); the layered theme, by `packages/ui/tests/theme.test.ts`; the unlayered element rules and the adoption order, by `packages/runtime/tests/stylesheet-engine.test.ts`; and the Edit column's handles in `packages/studio/src/surfaces/canvas-stage.json` are the worked example of the weight rule (§5.5). Principle 3 is the platform's, anchoring included (§6). Principle 4, on the kit's side: its elements print the title, chord and `requires` reason they are given and format none; Studio's side is studio-ui-guidelines.md §12. Principle 5, by the conformance test's scan of every behaviour sidecar for an attribute, class, style or markup write.

**Principle 1 (line 25)**, per the first Open decision:

> 1. **The element is the unit of reuse; the document is the unit of composition.** A Studio surface is a document that projects host state into kit elements, and the kit carries no knowledge of Studio's state. A surface is a definition like any other, so a box only it draws, a native `div`, `span` or `button` among them, is one of its parts: named by `part` and styled from the surface's own `style`, never through a class (§3.1). What a surface never does is redraw an element the kit ships: where the box it needs already has a tag, a role and a contract in §5, it draws that element.

**Principle 2 (line 26)**:

> 2. **Light DOM, one cascade.** Every relationship the kit's documents declare is an id reference — `aria-activedescendant`, `aria-controls`, `aria-labelledby`, `aria-describedby`, `popovertarget`, `commandfor`, `interestfor` — and id references do not cross a shadow boundary. A panel's anchor is not among them: it is the platform's implicit anchor, the invoker that `popovertarget`, `interestfor` or `showPopover({ source })` names, so no element writes `anchor-name` (§6). No element declares `$shadow` in this version; `part` attributes are the only sanctioned style hooks (§3.2). The kit's one sheet is its theme, tokens only, in the `jx-ui` cascade layer, so a host's own token declaration wins by order (§9). An element's rules are not in that layer: the runtime emits them unlayered, keyed `[data-jx="…"]` at (0,1,0) plus what they select, into the sheet it adopts after every linked one (spec.md §9.6). A host overrides an element's look by weight or by order, never by layer, and a rule that overrides a rest look restates the lit look one attribute heavier (§5.5).

**§11, CSS Scoping row (line 425).** In the Note, replace "and the only piece of the module the kit meets is `:host`, which the runtime translates to the tag (spec.md §16.6)." with one of two variants. The rest of the note, from "`gap:ui-scoping` is retired", is unchanged.

- **Variant A**, if `plan:spec/shadow-dom-parity` has not landed: "and no kit document writes `:host` either, because an element's top-level `style` already addresses its host; the conformance test refuses one, which matters while the interpreter the kit registers through has no `:host` handling and the key would match nothing. The light-DOM translation of `:host` to the tag is the compiler's (`resolveSelectorMember` in `packages/compiler/src/shared.ts`, spec.md §16.6)." Evidence becomes `packages/ui/tests/conformance.test.ts, packages/compiler/tests/shadow-dom.test.ts`.
- **Variant B**, if it has landed: "and no kit document writes `:host` either, because an element's top-level `style` already addresses its host, and the conformance test refuses one. The light-DOM translation of `:host` to the host's own selector is `resolveHostKey` in `packages/runtime/src/css.ts`, which the interpreter and the compiler both call (spec.md §16.6)." Evidence becomes `packages/ui/tests/conformance.test.ts, packages/runtime/tests/css.test.ts`.

**§11, CSS Anchor Positioning row (line 424).** Evidence gains `packages/ui/tests/conformance.test.ts`. The note is unchanged.

**Fragment:**

`bun run spec:change ui.md minor -m "§2 principle 1 makes a box only a surface draws one of its parts and forbids redrawing a kit element, and principle 2 lists the id references the kit writes, anchors a panel to its invoker with no anchor-name, and says an element's own rules are unlayered so a host overrides them by weight or order, never by layer; §11's CSS Scoping row says no kit document writes :host and names where the host translation lives"`

**Docs:**

- `docs/extending/ui-kit.md`:
  - Add `  - ui.md#2 # principles: light DOM, one cascade` to `spec:` after the `ui.md#1` line.
  - In "Style a part", replace "A rule on an ancestor works the same way: `"& jx-button > [part=\"control\"]"`." with "A rule on an ancestor, such as `"& jx-button > [part=\"control\"]"`, reaches the part as well, but as an ordinary rule rather than a merge."
  - After that paragraph, add: "There is no cascade layer between your rules and an element's. The element's rules are keyed on its `data-jx` attribute, which makes each one an attribute heavier than what it selects, and they are adopted after your page's stylesheets. A rule of yours therefore wins by being heavier. In a linked stylesheet, `jx-button > [part=\"control\"]` loses to the button's own rule, and a rule that changes the look in a variant or a state the element styles, such as `[data-variant=\"accent\"]` or `:hover`, has to outweigh that rule as well. Only the theme sits in a layer, which is why a token you set always wins."
- No other page cites `ui.md#2`. `docs/framework/concepts/overlays.md` recommends `anchor-name` to authors for their own overlays, which is correct and not the kit's, so it is unchanged. `docs/extending/reference/standards.md` is generated.
- **Graduation:** none. ui.md keeps ten open sections owned by other plans.

## Acceptance

- `bun run plans:status --who-claims ui.md#2` reports no open item, and `plans/ui/principles-text.md` is gone.
- `sed -n 23p specs/ui.md` starts `> **Status: Implemented.**`. `grep -n "anchor-name" specs/ui.md` no longer hits line 26's id list, and every remaining hit is a negative (§2's "no element writes", §5.2 line 187, §6, §11). `grep -n "which the runtime translates" specs/ui.md` finds nothing.
- `bun test --isolate --coverage` from `packages/ui` is green and lists `jx-popover leaves anchoring to the platform's implicit anchor` and `jx-popover writes no :host` among the principles cases. The reviewer's mutation check under Tests turns each red.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:standards`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` all pass.
- `bun run docs:sync` names `docs/extending/ui-kit.md` for the ui.md change, and that page's diff is the one above.
