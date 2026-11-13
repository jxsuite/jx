---
status: drafted
disposition: implement
claims:
  - compiler.md#7.2.1
requires: []
workspaces:
  - packages/compiler
size: S
---

# A derived `sizes` takes each element's narrowest literal width

## Context

One small defect in the image pipeline where the spec states the intended behaviour and the code falls short of it.

`specs/compiler.md` §7.2.1 (unmarked before the census):

> **Status: Partial.** Within one node the derivation does not take the narrowest length: `containerWidthOf` in `packages/compiler/src/site/image-transform.ts` takes a literal `max-width` and ignores `width` whenever both are declared, so `{ "width": "320px", "maxWidth": "960px" }` derives `(max-width: 960px) 100vw, 960px`. The minimum is taken only across ancestors.

This plan used to carry a second half, a cap of four concurrent encodes per image, because `processImage` started every Sharp encode at once and only awaited them in batches of four. That half is closed by other means and is no longer this plan's: `processImage` (`packages/compiler/src/site/image-optimizer.ts`) now hands one request per image to the compiler's native addon (`@jxsuite/compiler-binding`, `packages/compiler-binding/crates/jx_media`), which encodes a source's variants in parallel on a thread pool sized to the machine, so the pool is the limit and there is no JavaScript-side encode loop left to bound. The pull request that made that change removed the concurrency clause from the `compiler.md` §7.2 and `site-architecture.md` §9.2.2 markers and rewrote the "Up to 4 variants" sentence in each.

Verified against the tree:

- `containerWidthOf` (`image-transform.ts`) computes `pxLength(style.maxWidth) ?? pxLength(style.width)`, then `Math.min` against the inherited bound. It is called twice: by `walkAndTransform` for the bound passed to children, and by `transformImgNode` for the image's own style. The existing test "the image's own literal width constrains it too" covers `width` alone; no test declares both. No node in `sites/`, `packages/starters/sites/` or `examples/` declares a literal `width` narrower than a literal `maxWidth`, so no committed site's output changes.
- Out of scope: the `innerHTML` half (`transformInnerHtmlImages`) derives no `sizes` from its container at all and writes `config.sizes` unconditionally. That is correction 5 of `plan:_shared/image-pipeline-text`, decided there. `compiler.md` §7.2 and §7.2.1 describe `<img>` nodes, which is what this plan makes true.

Tests: `packages/compiler/tests/image-transform.test.ts` (`describe("image-transform — sizes derived from the container")`; the optimizer module is mocked).

## Outcome

- `compiler.md` §7.2.1 → Implemented: the leading Partial marker is removed (the section was unmarked before the census, like its siblings §7.4 and §7.6), and its body states the within-element rule and what is not read.

## Decisions

- **Decided:** each element contributes the smallest of its literal `style.maxWidth`, its literal `style.width` and the inherited bound, because §7.2.1 already says "the narrowest literal `max-width`/`width` … declared on the image or any ancestor" and a declared `width` narrower than its `max-width` is the width the element renders at. Only those two `style` keys are read, as today: not `minWidth`, and not the `width` attribute, which is where the pass itself writes the intrinsic size.
- **Open:** does a `maxWidth` or `width` inside a nested style block (`@media`, a named breakpoint such as `@--md`, `:hover`, or an ancestor's `& img` selector) count? Recommendation: no, and §7.2.1 and the docs page say so, directing the author to write `sizes` on the tag. Because which block applies depends on a viewport the build does not have: a block that narrows the element makes the base value err large (wasted bytes, which is acceptable), but one that widens it at a breakpoint makes it err small (a blurry image), and resolving that needs media-query evaluation against the project's `$media`, far beyond this defect. Stated, it is a documented limit with an escape hatch; unstated, the "narrowest declared" wording promises more than any implementation of it keeps. Building it instead means a node with any nested redeclaration contributing the widest of its per-block bounds, or none when a block's value is not literal.

## Implementation

Written for the Open's recommendation; answered the other way, `containerWidthOf` gains the per-block reading described there, and the nested-block test and spec and docs sentences change to assert it.

1. `packages/compiler/src/site/image-transform.ts`
   - `containerWidthOf(node, inherited)`: after the `style` guard, start from `inherited` and lower it by each of `pxLength(style.maxWidth)` and `pxLength(style.width)` that is non-null; return the result (`null` only when all three are null). Rewrite its doc comment: "The narrowest literal `max-width` or `width` this element declares in its base `style`, or the inherited bound when that is narrower. Nested blocks are not read (compiler.md §7.2.1)", keeping the existing paragraph on why only literals count.
   - `walkAndTransform`: the comment says "max-width or width".
   - Delete the orphaned JSDoc block above `const CSS_LENGTH`, which repeats `walkAndTransform`'s parameters and documents nothing.

No signature changes, and no other file changes.

**Integration contract.** Once this lands, `plan:_shared/image-pipeline-text` may rely on: `containerWidthOf(node, inherited)` returns the minimum of the inherited bound and the node's literal base `maxWidth` and `width`, and is the function the `innerHTML` half should call for its container. `compiler.md` §7.2.1 is unmarked and reads as Specs & docs below, which is the text that plan moves into `site-architecture.md` §9.2.2 step 4.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`. No new source file, so the manifest check sees nothing new. The per-file threshold in `packages/compiler/bunfig.toml` must hold for the changed file. Ratchet only if the workspace's worst file rises. The native addon is never loaded: this suite mocks the optimizer module.

- `image-transform.test.ts`, `describe("image-transform — sizes derived from the container")`, using the existing `imgIn` and `sourcesOf` helpers:
  - "a node declaring both width and max-width is bounded by the narrower": `imgIn({ maxWidth: "960px", width: "320px" })` gives `(max-width: 320px) 100vw, 320px` (fails today with 960), and `imgIn({ maxWidth: "20rem", width: "960px" })` gives the same.
  - "the image's own width and max-width both count": an `img` node with `style: { maxWidth: "40rem", width: "300px" }` gives `(max-width: 300px) 100vw, 300px`.
  - "an ancestor narrower than both of a node's lengths still wins": a `div` with `maxWidth: "240px"` around `imgIn({ maxWidth: "960px", width: "320px" })` gives `(max-width: 240px) 100vw, 240px`.
  - "a length inside a nested block is not read": `imgIn({ maxWidth: "960px", "@media (min-width: 1200px)": { maxWidth: "1200px" } })` gives `(max-width: 960px) 100vw, 960px`.

## Specs & docs

`specs/compiler.md`:

- §7.2.1: delete the Partial marker. After resolution-order item 2's sentence, add: "Both properties count on every element, the image included, so `{ "width": "320px", "maxWidth": "960px" }` derives `(max-width: 320px) 100vw, 320px`." Extend the closing paragraph ("Only literal lengths derive. …") with: "Only an element's base `style` is read: a length inside a nested block (a media query, a named breakpoint, a pseudo-class, or an ancestor's descendant selector) is not, because which block applies depends on the viewport, so a container that widens at a breakpoint needs `sizes` written on the tag."

Fragment:

- `bun run spec:change compiler.md minor -m "A derived sizes takes the narrower of each element's literal width and max-width as well as the narrowest across its ancestors, and reads no nested style block."`

Docs: `docs/framework/site/images.md` (`spec:` cites `compiler.md#7` and `site-architecture.md#9`; `code:` lists the changed file). "How `sizes` is chosen", item 2 already states the within-element rule and stays. The paragraph beginning "Only literal lengths count." gains: "Only the element's own `style` counts, not a length set inside a media query, a named breakpoint, a pseudo-class or an ancestor's selector block such as `& img`, so a container that widens at a breakpoint needs a `sizes` on the tag too." (no em dash). No other docs page cites `compiler.md#7`, `site-architecture.md#9.2` or the changed file (`docs/studio/projects/media.md` and `content-collections.md` cite §9 and §9.3 on other subjects).

Plans: the landing pull request deletes this file and removes `compiler/image-container-sizes` from `plan:_shared/image-pipeline-text`'s `requires`, and updates that plan's Context where it quotes the §7.2.1 rule. It also rewords the `plans/site-architecture/README.md` spec-wide decision that names this plan (the `image-pipeline-text` edge), which `plans:check` does not scan but which would otherwise cite a deleted file. `compiler.md` does not graduate: §7.1, §7.2 and other sections remain open.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- "a node declaring both width and max-width is bounded by the narrower" fails against the old `??`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec compiler` no longer lists §7.2.1.
- On a scratch site, a `div` with `style: { "width": "320px", "maxWidth": "960px" }` around `<img src="/images/hero.png">` builds with `sizes="(max-width: 320px) 100vw, 320px"` on each `<source>`.
