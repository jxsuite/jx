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
- **Correction to the stub:** the spec text does not disagree with itself the way the stub said. `spec.md` §16.6 (line 1711, and the Style scope row at line 1725) describes component definitions, where the class really is `.<tagName>-<n>`. Only §9.2 is wrong as written, because it states that spelling for every element; `compiler.md` §8.2's `.jx-N` is right for pages. §16.6 is wrong only in not saying that an author's `id` or class displaces the generated class.
- `compiler.md` §8.2 also cites "the `:host` translation of §16.6" bare (a `spec.md` section), and its closing marker names `compile-static.js`, which is `compile-static.ts`.

**Related:** `spec.md` §9.1 (`plan:spec/static-style-rules-only`), §9.3 (`plan:spec/report-dropped-reactive-styles`), §9.6 (the runtime's `data-jx` handle), §16.6 (owned by `plan:spec/shadow-dom-parity`, which this plan edits one sentence of, with no marker change).

## Outcome

- `spec.md` §9.2 → Implemented. Every static stylesheet writes each described rule's comment, a `@keyframes` block included, and the text states the handle the compiler ships.
- `compiler.md` §8.2 → Implemented. The leading marker is deleted, the closing `Implemented` marker leads, and the section refers to `spec.md` §9.2 for the handle instead of restating it.
- Neither spec graduates. `spec.md` keeps §9.1, §9.3, §16.6 and others open; `compiler.md` keeps §3 and others.

## Decisions

- **Open:** which handle the §9.2 text states. Recommendation: a literal `#id`, otherwise a generated class added beside the author's own and named for where the element was written (`jx-<n>` on a page, `jxs-<n>` in slotted content, `<tagName>-<n>` in a definition). This is what `plan:spec/style-handle-assignment` should ship, because it is the spelling that already ships, it leaves §16.6's sentence and table row true, and it adds no new attribute to the markup. The decision belongs to that plan: this one closes to whatever it ships. If it ships a `data-jx`-style attribute hash instead, the three edits under Specs & docs keep their structure and take that spelling, and §16.6's table row changes with them.
- **Open:** whether a production build keeps the comments. Recommendation: yes, always, with no flag. §9.2 states it unconditionally, the pipeline has no CSS minifier (whitespace already ships), and the bytes are prose an author chose to write. The cost is that a described component rule repeats on every page that inlines the component's sheet. A size switch would be the build's first CSS optimisation and belongs in a spec change of its own.
- **Decided:** one formatter, `commentedRuleText(rule)`, exported from `packages/runtime/src/css.ts` beside `cssRuleText`, because the compiler and the site builder both need it and both already depend on the runtime's CSS module, and `CssRule.description`'s own doc comment already promises the static rendering.
- **Decided:** the comment is `/* <description> */` on the line above the rule, with every `*/` in the prose written `* /`. CSS comments have no escape, so breaking the sequence is the only way to keep the comment from ending early. The text is otherwise verbatim, newlines included. `</style` needs nothing new, because `escapeStyleText` already runs over the whole inlined block.
- **Decided:** `buildSiteStyleCSS` renders comments only when asked (`{ comments: true }`), and only `compileStyles` asks. The canvas and the live preview keep emitting the rule text alone, because §9.2 says every consumer but a static build ignores the description. The byte-for-byte parity test keeps comparing like with like by passing the option.
- **Decided:** every emitted rule carries its block's comment, including both copies of a scheme-query block (§9.5's media-guarded and forced copies), because each copy is a rule a reader may land on. A block that emits no rule (only metadata, or only nested blocks) writes no comment.
- **Decided:** a `@keyframes` block's own `$description` is carried on its rule, and a stop's is ignored because a stop is not a rule. Without this, the third body shape §9.2 names would stay uncommented after the emitters change.
- **Decided:** a top-level `$description` in the project block (and in each conditional block the site builder splits) describes the first rule the split writes: `:root` when the block has a custom property or `colorScheme`, otherwise `body`. Today it always goes to `body`, and it is lost when `body` has no declarations.
- **Decided:** `compiler.md` §8.2 points at `spec.md` §9.2 for the handle instead of restating it, per the compiler audit's rule for restated contracts. The two restatements drifted from each other and from the code.
- **Decided:** this plan may ride in the same pull request as `plan:spec/style-handle-assignment`. If it does not, it lands next, because until it does both markers describe the old handle.

## Implementation

1. **`packages/runtime/src/css.ts`**
   - Factor the guard in `emit` (`typeof description === "string" && description !== ""`) into a local `describedBy(value: unknown)` that returns `{ description }` or `{}`. Use it in `emit` and in `emitKeyframes`, which spreads `describedBy(block["$description"])` into the rule it pushes.
   - Add `export function commentedRuleText(rule: Pick<CssRule, "text" | "description">): string` after `cssRuleText`. It returns `rule.text` when `description` is undefined, and otherwise `` `/* ${rule.description.replaceAll("*/", "* /")} */\n${rule.text}` ``. Doc comment cites `spec.md` §9.2 and carries `@docs framework/concepts/styling`. Point `CssRule.description`'s doc comment at it.
   - **`packages/runtime/src/runtime.ts`**: add `commentedRuleText` to the `./css.ts` re-export block (the compiler imports its CSS helpers from `@jxsuite/runtime`).
2. **`packages/compiler/src/shared.ts`**
   - Import `commentedRuleText` with `buildStyleRules`. `pushStyleRules` pushes `commentedRuleText(rule)`; update its doc comment ("the rule text, and a static build's comment above it").
   - `compileStyles` passes `{ comments: true }` as the fifth argument of `buildSiteStyleCSS`.
   - Nothing changes in `buildComponentCSS`, `collectStyles` or `site-build.ts`: the component sheet and the `slotCss` sink both reach `pushStyleRules`.
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
  - New describe `compileStyles — $description comments`, with five cases. `a described base rule is preceded by its comment`: `#box` with `{ $description: "why", color: "red" }` gives `/* why */\n#box { color: red }`. `a nested block's comment sits above its own rule only`. `each @font-face block in an array carries its own comment`. `both copies of a scheme-query block carry the comment`: a `--dark` scheme query, and the comment appears twice, above the guarded rule and above the forced rule. `</style in a description is escaped with the block`.
  - In `buildComponentCSS`: `a component sheet carries its rules' comments`, covering the host rule, a nested key (`:host(.wide)`) and a styled child.
- **`packages/compiler/tests/project-style-delegation.test.ts`**: `a project block's description reaches the page as a comment`.
- **`packages/compiler/tests/site-build-component-loading.test.ts`**: `a component rule's description ships in the inlined sheet and the sidecar`. One `buildSite` over a component with a described host style asserts the comment in the page's head `<style>` and in `dist/components/<tag>.css`.
- **`packages/site/tests/site-style.test.ts`**
  - `a host sheet carries no comment`: described blocks with no option give no `/*`.
  - `with comments, each described rule is preceded by its comment`.
  - `a top-level description comments the first rule the split writes`: `:root` when a custom property exists, `body` otherwise.
  - Extend `the sheet is byte-for-byte what the build writes for the same block`: add `$description` to the top level, to `"h1, h2"` and to `@font-face` in the fixture, and compare `buildSiteStyleCSS(style, media, id, undefined, { comments: true })` with the page sheet.

Coverage: the per-file bars are runtime lines 0.963 / functions 0.98, compiler 0.982 / 0.98, and site 0.99 / 1.0 (each workspace's `bunfig.toml`). Site's functions bar is 1.0, so every branch of the new option and routing needs a case, and the list above has one. Ratchet a workspace's threshold only if its worst-file minimum rises.

## Specs & docs

**`spec.md` §9.2**, in place:

- Replace the line-903 Partial marker with: "> **Status: Implemented.** Flattening, selector-list distribution, recursion, the declaration-body at-rules and their array form, and `@keyframes` ship in `buildStyleRules` (`packages/runtime/src/css.ts`). A static build writes each rule's `$description` through `commentedRuleText`: the compiler's `pushStyleRules`, and `buildSiteStyleCSS` in `packages/site/src/site-style.ts` for the project block. The compiler assigns the handle in `collectStyles` (`packages/compiler/src/shared.ts`)." Use whichever function name `plan:spec/style-handle-assignment`'s integration contract gives, if it moved. Keep the closing `Implemented` marker.
- Line 918: replace "keyed on a handle the emitter chooses: the compiler prefers the element's own `#id`, then a **generated class** `.<tagName>-<n>` assigned in the compiled HTML; the runtime uses `data-jx` (§9.6)." with: "keyed on a **handle** that selects the element and nothing else. The compiler uses the element's own `#id` when its `id` is a literal, and otherwise adds a **generated class** beside any class the author wrote, named for where the element was written: `.jx-<n>` on a page, `.jxs-<n>` in a component instance's slotted content, and `.<tagName>-<n>` inside a component definition (§16.6). An author's class is never the handle, because a class is shared by design and every element carrying it would take the rules. Nor is a bound `id` or `className`, whose value the build does not have when it writes the selector. The runtime uses `data-jx` (§9.6)." The rest of the paragraph is unchanged.
- Line 966: replace "A static build renders it as a comment above the rule; every other consumer ignores it." with: "A static build renders it as a comment on the line above the rule, in every stylesheet it writes, with any `*/` in the prose written `* /` so the comment cannot end early; every other consumer ignores it. A `@keyframes` block documents itself the same way, and a `$description` inside one of its stops is ignored, because a stop is not a rule."

**`spec.md` §16.6**, line 1711, with no marker change (the section's marker belongs to `plan:spec/shadow-dom-parity`): after "gets a **generated class**, `.<tagName>-<n>`" add ", beside any class of its own, unless it carries a literal `id`, which is its handle instead (§9.2)". The Style scope row (line 1725) stays under the recommended handle.

Fragment: `bun run spec:change spec.md minor -m "§9.2: a static build writes each style block's description as a comment above its rule, keyframes blocks included, and the compiler's style handle is a literal id or a generated class beside the author's own, never an author's class."`

**`compiler.md` §8.2**, in place:

- Delete the line-650 Partial marker and the blank line after it. In the closing marker (line 664), correct `compile-static.js` to `compile-static.ts`.
- Line 656: replace "The compiler keeps what is its own: the `#id` / `.jx-N` handle preference, the `:host` translation of §16.6, and the `</style` escaping below." with: "The compiler keeps what is its own: the element's handle, which `spec.md` §9.2 specifies; the comment it writes above each rule whose block carries a `$description` (`spec.md` §9.2); the `:host` translation of `spec.md` §16.6; and the `</style` escaping below."

Fragment: `bun run spec:change compiler.md minor -m "§8.2: CSS extraction writes each rule's description as a comment above it and takes its style handle from spec.md §9.2."`

**Docs** (no em dashes in prose):

- `docs/framework/concepts/styling.md` (`spec: spec.md#9`; `code:` lists `css.ts` and `shared.ts`, and gains `packages/site/src/site-style.ts`):
  - Line 54: replace "The build scopes them with a **generated class**, `.<tagName>-<n>`, which it also puts on the element:" with "The build scopes them to the element they were written on: its `id`, when you wrote one as plain text, and otherwise a **generated class** it adds beside your own classes. On a page the class is `jx-<n>`; inside a component it is named for the component, `<tagName>-<n>`. Your own classes are never used, because every other element carrying one would pick up the rules too. Inside a `sty-card` component:". The example stays.
  - "Explaining a rule": after "A build that writes a stylesheet puts it in a comment above the rule; everywhere else it is ignored.", add a CSS block showing `/* The panel fills its column so a short list still shows the border under it. */` above `.jx-0 { height: 100%; }`. Then add: "A `@keyframes` block can carry one too. A note inside a single stop is ignored, because a stop is not a rule."
- No change: `docs/framework/build.md` (cites `compiler.md#8.2`, but its CSS-extraction section says where CSS goes, not how it is scoped or annotated), `docs/studio/interface/canvas.md` (lists `site-style.ts`; the canvas output is unchanged), and `overlays.md`, `color-schemes.md` and `elements.md` under `docs/framework/concepts/` (they list `css.ts` or `shared.ts` but describe nothing that changes).

Landing deletes this file, and rewrites any line still naming it (today `plans/spec/static-style-rules-only.md`'s Related list and `plans/standards/citable-community-specifications.md`) to cite `spec.md` §9.2 instead.

## Acceptance

- `bun run plans:check --audit spec` and `bun run plans:check --audit compiler` report nothing for either anchor. `bun run plans:status --who-claims spec.md#9.2` and `--who-claims compiler.md#8.2` show neither open.
- `bun run docs:status`, `bun run docs:spec-release` (both fragments present), `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:markdown` and `bun run docs:section-refs` are green.
- The three workspace suites and their manifest checks pass at their thresholds.
- In a scratch `buildSite` project, a page element with `style: { "$description": "why */ now", "color": "red" }` gives a head `<style>` containing `/* why * / now */` on the line directly above that element's rule. A component with a described host style carries the comment in the page's inlined sheet and in `dist/components/<tag>.css`. The Studio canvas for the same project shows no comment in `#jx-site-style`.
- Re-run the prerequisite's scratch check: one element's `.card { color: red }` no longer colours a second, unstyled `.card`.
- `grep -n "jx-N\|keyed on a handle the emitter chooses" specs/spec.md specs/compiler.md` finds nothing.
