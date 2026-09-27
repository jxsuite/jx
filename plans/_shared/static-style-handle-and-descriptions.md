---
status: drafted
disposition: implement
claims:
  - spec.md#9.2
  - compiler.md#8.2
requires:
  - spec/style-handle-assignment
workspaces:
  - packages/compiler
  - packages/runtime
  - packages/site
size: S
---

# A static build comments each style rule with its `$description`, and the specs name the handle the compiler assigns

## Context

Two items in two specs, one owner. `spec.md` §9.2 has two open parts: the `$description` comments and the compiler's style handle. `compiler.md` §8.2 restates the handle half as its own contract. The handle itself is built by `plan:spec/style-handle-assignment`, an enabling plan this one requires (as does `plan:spec/static-style-rules-only`), so the handle is decided once. What stays here is the `$description` comments, the spec text for the handle that plan ships, and both marker flips.

`specs/spec.md` §9.2, line 903:

> **Status: Partial.** Flattening, selector-list distribution, recursion, the declaration-body at-rules and their array form, and `@keyframes` ship in `buildStyleRules` (`packages/runtime/src/css.ts`). Two parts do not: no static build renders a block's `$description` as a comment (the compiler's `pushStyleRules` and `packages/site/src/site-style.ts` emit the rule text only), and the compiler's handle is the author's FIRST class whenever `className` is set (`collectStyles` in `packages/compiler/src/shared.ts`), so an element's rules also style every other element carrying that class; the generated class is `jx-<n>` on pages rather than `.<tagName>-<n>`.

`specs/compiler.md` §8.2, line 650 (the section's closing `> **Status: Implemented.**` marker, line 664, stays for the parts that ship):

> **Status: Partial.** Extraction, the shared `buildStyleRules` nesting and the component-sheet inlining ship (see the marker closing this section). The handle preference does not: `collectStyles` in `packages/compiler/src/shared.ts` prefers `#id`, but assigns a generated `.jx-N` class only when an element has neither `id` nor `className`, and otherwise keys its rules on the author's first class, so an element's rules also style every other element carrying that class; this is the drift `spec.md` §9.2 marks.

**What exists** (re-verified 2026-09-26)

- `buildStyleRules` (`packages/runtime/src/css.ts`) carries a block's `$description` as `CssRule.description`, off `text`, so it never reaches `hashCss` or an adopted sheet. `emit` sets it for a selector rule and a declaration at-rule; `packages/runtime/tests/css.test.ts` ("buildStyleRules on a block that documents itself") covers both.
- **Not in the stub:** `emitKeyframes` pushes its rule with no `description`, so a `@keyframes` block's `$description` is lost before any emitter sees it. Stops' `$description` keys are skipped by `declarationsOf`, as every `$` key is.
- `pushStyleRules` (`packages/compiler/src/shared.ts`) pushes `rule.text` only. It is the one door for every compiler stylesheet: the page sheet (`compileStyles` → `collectStyles`), a component's sheet (`buildComponentCSS`, written to `dist/components/<tag>.css` and inlined into pages by `injectComponentScripts`), and slotted children's rules (`expandComponents`'s `slotCss` sink in `packages/compiler/src/site/site-build.ts`). All three inline paths run the text through `escapeStyleText`, so `</style` is covered.
- `buildSiteStyleCSS` (`packages/site/src/site-style.ts`) pushes `rule.text` only. `compileStyles` calls it for the project block, but so do two hosts that are not static builds: the Studio canvas (`packages/studio/src/canvas/iframe-render.ts`) and the live preview (`packages/server/src/live-preview.ts`). §9.2 says every consumer but a static build ignores the description, so the comment has to be the build's opt-in. A top-level project `$description` currently lands in `bodyProps` (it is neither `--` nor `colorScheme`), so it would describe only the `body` rule.
- The handle: `collectStyles` assigns `${prefix}-${n}` only under `def.style && !def.id && !def.className` and otherwise selects `#${def.id}` or `.${def.className.split(" ")[0]}`. The prefix is `jx` on a page, `jxs` for a page-level instance's slotted children, and the component's tag name inside its definition (`buildComponentCSS`, and `compile-element.ts`, which only uses the pass to stamp classes).
- **Correction to the stub:** the spec text does not disagree with itself the way the stub said. `spec.md` §16.6 (line 1711, and the Style scope row at line 1725) describes component definitions, where the class really is `.<tagName>-<n>`. Only §9.2 is wrong as written, because it states that spelling for every element; `compiler.md` §8.2's `.jx-N` is right for pages. §16.6 is wrong today only in not saying that an author's `id` or class displaces the generated class, which stops being true once the prerequisite lands.
- `compiler.md` §8.2 also cites "the `:host` translation of §16.6" bare (a `spec.md` section), and its closing marker names `compile-static.js`, which is `compile-static.ts`.
- §9.2's own examples use `#box` as the scope (lines 920, 922 and 972), and `CssBuildOptions.scope`'s doc comment in `css.ts` says the compiler passes "`#id` / `.jx-N` / a tag". Neither is true once no compiler handle is an id.

**Related:** `spec.md` §9.1 (`plan:spec/static-style-rules-only`), §9.3 (`plan:spec/report-dropped-reactive-styles`), §9.6 (the runtime's `data-jx` handle), §16.6 (owned by `plan:spec/shadow-dom-parity`, which this plan edits one sentence of, with no marker change).

## Outcome

- `spec.md` §9.2 → Implemented. Every static stylesheet writes each described rule's comment, a `@keyframes` block included, and the text states the handle the compiler ships.
- `compiler.md` §8.2 → Implemented. The leading marker is deleted, the closing `Implemented` marker leads, and the section refers to `spec.md` §9.2 for the handle instead of restating it.
- Neither spec graduates. `spec.md` keeps §9.1, §9.3, §16.6 and others open; `compiler.md` keeps §3 and others.

## Decisions

- **Decided:** the handle text states what `plan:spec/style-handle-assignment` ships, because the handle is that plan's decision and this one only writes it down. The text under Specs & docs is drafted for that plan's two recommendations: every styled element gets a generated class, whether or not it has an `id`, and the class keeps the spellings that ship (`jx-<n>`, `jxs-<n>`, `<tagName>-<n>`). Each edit names its variant if that plan keeps a literal `id` as a page element's handle. If it ships a `data-jx`-style attribute instead, the same edits take that spelling and §16.6's Style scope row changes with them.
- **Open:** whether a production build keeps the comments. Recommendation: yes, always, with no flag. §9.2 states it unconditionally, the pipeline has no CSS minifier (whitespace already ships), and the bytes are prose an author chose to write. The cost is that a described component rule repeats on every page that inlines the component's sheet. A size switch would be the build's first CSS optimisation and belongs in a spec change of its own.
- **Decided:** one formatter, `commentedRuleText(rule)`, exported from `packages/runtime/src/css.ts` beside `cssRuleText`, because the compiler and the site builder both need it and both already depend on the runtime's CSS module, and `CssRule.description`'s own doc comment already promises the static rendering.
- **Decided:** the comment is `/* <description> */` on the line above the rule, with every `*/` in the prose written `* /`. CSS comments have no escape, so breaking the sequence is the only way to keep the comment from ending early. The text is otherwise verbatim, newlines included. `</style` needs nothing new, because `escapeStyleText` already runs over the whole inlined block.
- **Decided:** `buildSiteStyleCSS` renders comments only when asked (`{ comments: true }`), and only `compileStyles` asks. The canvas and the live preview keep emitting the rule text alone, because §9.2 says every consumer but a static build ignores the description. The byte-for-byte parity test keeps comparing like with like by passing the option.
- **Decided:** every emitted rule carries its block's comment, including both copies of a scheme-query block (§9.5's media-guarded and forced copies), because each copy is a rule a reader may land on. A block that emits no rule (only metadata, or only nested blocks) writes no comment.
- **Decided:** a `@keyframes` block's own `$description` is carried on its rule, and a stop's is ignored because a stop is not a rule. Without this, the third body shape §9.2 names would stay uncommented after the emitters change.
- **Decided:** a top-level `$description` in the project block (and in each conditional block the site builder splits) describes the first rule the split writes: `:root` when the block has a custom property or `colorScheme`, otherwise `body`. Today it always goes to `body`, and it is lost when `body` has no declarations.
- **Decided:** `compiler.md` §8.2 points at `spec.md` §9.2 for the handle instead of restating it, per the compiler audit's rule for restated contracts. The two restatements drifted from each other and from the code.
- **Decided:** this plan lands in the same pull request as `plan:spec/style-handle-assignment`, as that plan decides, because line 918 and `styling.md` would describe the old handle in between. The `requires` edge stays, so the handle's reviewer re-reads this text before either lands.

## Implementation

1. **`packages/runtime/src/css.ts`**
   - Factor the guard in `emit` (`typeof description === "string" && description !== ""`) into a local `describedBy(value: unknown)` that returns `{ description }` or `{}`. Use it in `emit` and in `emitKeyframes`, which spreads `describedBy(block["$description"])` into the rule it pushes.
   - Add `export function commentedRuleText(rule: Pick<CssRule, "text" | "description">): string` after `cssRuleText`. It returns `rule.text` when `description` is undefined, and otherwise `` `/* ${rule.description.replaceAll("*/", "* /")} */\n${rule.text}` ``. Doc comment cites `spec.md` §9.2 and carries `@docs framework/concepts/styling`. Point `CssRule.description`'s doc comment at it.
   - Correct `CssBuildOptions.scope`'s doc comment: the compiler passes a generated class or a tag, not `#id` / `.jx-N`.
   - **`packages/runtime/src/runtime.ts`**: add `commentedRuleText` to the `./css.ts` re-export block (the compiler imports its CSS helpers from `@jxsuite/runtime`).
2. **`packages/compiler/src/shared.ts`**
   - Import `commentedRuleText` with `buildStyleRules`. `pushStyleRules` pushes `commentedRuleText(rule)`; update its doc comment ("the rule text, and a static build's comment above it").
   - `compileStyles` passes `{ comments: true }` as the fifth argument of `buildSiteStyleCSS`.
   - Nothing else changes for the comments in `buildComponentCSS`, `collectStyles` or `site-build.ts` (the prerequisite rewrites the first two for the handle): the component sheet and the `slotCss` sink both reach `pushStyleRules`. Whatever options bag another plan has given `pushStyleRules` by then, this plan's change is its one `push` line.
3. **`packages/site/src/site-style.ts`**
   - Export `interface SiteStyleOptions { comments?: boolean }`. `buildSiteStyleCSS` gains a fifth parameter, `options: SiteStyleOptions = {}`, documented as the static build's switch. `push` writes `options.comments === true ? commentedRuleText(rule) : rule.text`.
   - The top-level split loop skips `$`-prefixed keys. After the loop, a string `siteStyle.$description` goes to `rootProps` when that has a key, else to `bodyProps`. The conditional-block loop does the same with `condRoot` and `condBody`.
   - Import `commentedRuleText` from `@jxsuite/runtime/css`. Add a paragraph to the header comment saying the host path never renders descriptions.

**Integration contract.** Once this lands, `commentedRuleText` is exported from `@jxsuite/runtime/css` and `@jxsuite/runtime`, and a `@keyframes` rule carries its block's `description`. Every rule the compiler writes through `pushStyleRules`, and every project rule `compileStyles` writes, carries its comment. A later plan that emits more static rules through those paths (`plan:spec/static-style-rules-only`'s resolved declarations, for one) gets the comments without further work. `buildSiteStyleCSS(style, media, transpose, resolveValue?, { comments: true })` is the static form, and the 3- and 4-argument host calls are unchanged byte for byte. `spec.md` §9.2 is the only normative statement of the compiler's handle; `compiler.md` §8.2 and `spec.md` §16.6 point at it.

## Tests

Run `bun test --isolate --coverage` from `packages/runtime`, `packages/compiler` and `packages/site`, then `bun scripts/check-coverage-manifest.ts <workspace>` for each. No new source file.

- **`packages/runtime/tests/css.test.ts`**
  - In "buildStyleRules on a block that documents itself": `a @keyframes block carries its own description, and a stop's is ignored`. `{ "@keyframes pulse": { $description: "why", from: { $description: "x", opacity: "0" }, to: { opacity: "1" } } }` gives one rule with `description` `"why"` and a `text` that contains no `x`.
  - New describe `commentedRuleText`, with three cases. `a described rule is its comment line, then its text`: `/* why */\n:root { color: red }`. `an undescribed rule is its text, byte for byte`. `a */ in the prose cannot end the comment`: `"a */ b"` gives `/* a * / b */`, and the result has exactly one `*/`.
- **`packages/compiler/tests/shared.test.ts`**
  - New describe `compileStyles — $description comments`, with five cases. `a described base rule is preceded by its comment`: a `div` with `{ $description: "why", color: "red" }` gives `/* why */\n.jx-0 { color: red }` (the prerequisite's handle, since both land together). `a nested block's comment sits above its own rule only`. `each @font-face block in an array carries its own comment`. `both copies of a scheme-query block carry the comment`: a `--dark` scheme query, and the comment appears twice, above the guarded rule and above the forced rule. `</style in a description is escaped with the block`.
  - In `buildComponentCSS`: `a component sheet carries its rules' comments`, covering the host rule, a nested key (`:host(.wide)`) and a styled child.
- **`packages/compiler/tests/project-style-delegation.test.ts`**: `a project block's description reaches the page as a comment`.
- **`packages/compiler/tests/site-build-component-loading.test.ts`**: `a component rule's description ships in the inlined sheet and the sidecar`. One `buildSite` over a component with a described host style asserts the comment in the page's head `<style>` and in `dist/components/<tag>.css`.
- **`packages/site/tests/site-style.test.ts`**
  - `a host sheet carries no comment`: described blocks with no option give no `/*`.
  - `with comments, each described rule is preceded by its comment`.
  - `a top-level description comments the first rule the split writes`: `:root` when a custom property exists, `body` otherwise, and the same inside an `@--dark` block.
  - Extend `the sheet is byte-for-byte what the build writes for the same block`: add `$description` to the top level, to `"h1, h2"` and to `@font-face` in the fixture, and compare `buildSiteStyleCSS(style, media, id, undefined, { comments: true })` with the page sheet.

Coverage: the per-file bars are runtime lines 0.963 / functions 0.98, compiler 0.982 / 0.98, and site 0.99 / 1.0 (each workspace's `bunfig.toml`). Site's bars leave almost no uncovered line, so each new line of the option and the routing has a case above. CI also runs `packages/ui` for the `site-style.ts` change (the inverted edge in `scripts/ci/affected.ts`); its theme test calls the host form and is unaffected. Ratchet a workspace's threshold only if its worst-file minimum rises.

## Specs & docs

**`spec.md` §9.2**, in place:

- Replace the line-903 Partial marker with: "> **Status: Implemented.** Flattening, selector-list distribution, recursion, the declaration-body at-rules and their array form, and `@keyframes` ship in `buildStyleRules` (`packages/runtime/src/css.ts`). A static build writes each rule's `$description` through `commentedRuleText`: the compiler's `pushStyleRules`, and `buildSiteStyleCSS` in `packages/site/src/site-style.ts` for the project block. The compiler assigns the handle in `collectStyles` (`packages/compiler/src/shared.ts`)." Use whichever function name `plan:spec/style-handle-assignment`'s integration contract gives, if it moved. Keep the closing `Implemented` marker.
- Line 918: replace "keyed on a handle the emitter chooses: the compiler prefers the element's own `#id`, then a **generated class** `.<tagName>-<n>` assigned in the compiled HTML; the runtime uses `data-jx` (§9.6)." with: "keyed on a **handle** that selects the element and nothing else (for a repeater's item template, the rows it renders). The compiler gives every element with a `style` object a **generated class**, named for the sheet that holds its rules: `.jx-<n>` in a page's, `.jxs-<n>` in the block a page collects from a component instance's slotted content, and `.<tagName>-<n>` in a component definition's (§16.6). It writes the class into the element's one `class` attribute after the author's own classes, which are `attributes.class` when the element writes one and `className` otherwise. An author's class is never the handle, because a class is shared by design and every element carrying it would take the rules. Nor is an `id`: a rule keyed on one is more specific than the runtime's (§9.6), so a built page would resolve a competing rule differently from its preview. The runtime uses `data-jx` (§9.6)." The rest of the paragraph is unchanged. Variant, if the prerequisite keeps the id: "The compiler uses a page element's own `#id` when that `id` is a literal CSS identifier, and otherwise gives the element a **generated class** …", and the `id` sentence is dropped.
- Lines 920, 922 and 972: the example scope `#box` becomes `.jx-0` (`.jx-0.child`, `.jx-0 .a:hover, .jx-0 .b:hover`, `.jx-0 from`). Under the variant they stay.
- Line 966: replace "A static build renders it as a comment above the rule; every other consumer ignores it." with: "A static build renders it as a comment on the line above the rule, in every stylesheet it writes, with any `*/` in the prose written `* /` so the comment cannot end early; every other consumer ignores it. A `@keyframes` block documents itself the same way, and a `$description` inside one of its stops is ignored, because a stop is not a rule."

**`spec.md` §16.6**, line 1711, with no marker change (the section's marker belongs to `plan:spec/shadow-dom-parity`, which leaves this line and the Style scope row here): after "gets a **generated class**, `.<tagName>-<n>`" add ", beside any class of its own (§9.2)". The Style scope row (line 1725) stays true under both variants, since the id variant never uses an id inside a definition.

Fragment: `bun run spec:change spec.md minor -m "§9.2 and §16.6: a static build writes each style block's description as a comment above its rule, keyframes blocks included, and the compiler's style handle is a generated class beside the author's own, never an author's class or id."` Under the variant, the sentence ends "is a literal id on a page element or a generated class beside the author's own, never an author's class."

**`compiler.md` §8.2**, in place:

- Delete the line-650 Partial marker and the blank line after it. In the closing marker (line 664), correct `compile-static.js` to `compile-static.ts`.
- Line 656: replace "The compiler keeps what is its own: the `#id` / `.jx-N` handle preference, the `:host` translation of §16.6, and the `</style` escaping below." with: "The compiler keeps what is its own: the element's handle, which `spec.md` §9.2 specifies; the comment it writes above each rule whose block carries a `$description` (`spec.md` §9.2); the `:host` translation of `spec.md` §16.6; and the `</style` escaping below." If `plan:spec/shadow-dom-parity` landed first, the `:host` item is already gone from the list, replaced by that plan's sentence naming `resolveHostKey`; keep that sentence and leave the item out.

Fragment: `bun run spec:change compiler.md minor -m "§8.2: CSS extraction writes each rule's description as a comment above it and takes its style handle from spec.md §9.2."`

**Docs** (no em dashes in prose):

- `docs/framework/concepts/styling.md` (`spec: spec.md#9`; `code:` lists `css.ts` and `shared.ts`, and gains `packages/site/src/site-style.ts`):
  - Line 54: replace "The build scopes them with a **generated class**, `.<tagName>-<n>`, which it also puts on the element:" with "The build scopes them with a **generated class** that it adds to the element beside any classes of your own: `jx-<n>` on a page, and inside a component a class named for it, `<tagName>-<n>`. Your own classes and `id` are never the scope. A class is shared with every other element carrying it, and an `id` would give the rules more weight than they have in Studio's canvas, so the published page could disagree with the canvas. Inside a `sty-card` component:". The example stays. Variant: "…beside any classes of your own, unless it is a page element with an `id` written as plain text, which is used instead…", and the `id` clause of the next sentence goes.
  - "Explaining a rule": after the paragraph ending "can be mistaken for a note.", add "In a page's stylesheet it reads:" and a CSS block with `/* The panel fills its column so a short list still shows the border under it. */` on the line above `.jx-0 {`, `height: 100%;`, `}`, formatted like the page's other CSS blocks.
  - "Animations with `@keyframes`": after the paragraph ending "exactly as you would write it in a stylesheet." (line 157), add "A `$description` on the `@keyframes` block is written above it the same way. One inside a single stop is ignored, because a stop is not a rule."
- `docs/framework/build.md` (`spec:` cites `compiler.md#8.2`): in "CSS extraction", after the paragraph at line 139, add "A rule whose style block carries a `$description` keeps it as a comment on the line above the rule, wherever the build writes that rule."
- No change: `docs/studio/interface/canvas.md` (lists `site-style.ts`; the canvas output is unchanged), `overlays.md` (cites `spec.md#9.2` for the popover states), and `color-schemes.md` and `elements.md` under `docs/framework/concepts/` (they list `css.ts` or `shared.ts` but describe nothing that changes). The re-export added to `packages/runtime/src/runtime.ts` changes no documented behaviour.

Landing deletes this file, and rewrites every line still citing it to cite `spec.md` §9.2, or the gate's `citation-unknown` fails: today `plans/spec/static-style-rules-only.md`, `plans/spec/shadow-dom-parity.md`, `plans/spec/report-dropped-reactive-styles.md` and `plans/site-architecture/build-output-prose.md`, plus `plans/spec/style-handle-assignment.md` if it has not been deleted in the same pull request.

## Acceptance

- `bun run plans:check --audit spec` and `bun run plans:check --audit compiler` report nothing for either anchor. `bun run plans:status --who-claims spec.md#9.2` and `--who-claims compiler.md#8.2` show neither open.
- `bun run docs:status`, `bun run docs:spec-release` (both fragments present), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` are green.
- The three workspace suites and their manifest checks pass at their thresholds.
- In a scratch `buildSite` project, a page element with `style: { "$description": "why */ now", "color": "red" }` gives a head `<style>` containing `/* why * / now */` on the line directly above that element's rule. A component with a described host style carries the comment in the page's inlined sheet and in `dist/components/<tag>.css`. A described project `style` block is commented in the built page, and the Studio canvas for the same project shows no comment in `#jx-site-style`.
- Re-run the prerequisite's scratch check: one element's `.card { color: red }` no longer colours a second, unstyled `.card`.
- `grep -n "jx-N\|keyed on a handle the emitter chooses" specs/spec.md specs/compiler.md` finds nothing.
