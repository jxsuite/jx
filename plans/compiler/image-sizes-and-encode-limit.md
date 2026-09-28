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

# A derived `sizes` takes each element's narrowest literal width, and at most four of an image's variants encode at once

## Context

Two small defects in the image pipeline where the spec states the intended behaviour and the code falls short of it. Both are `implement`, in two neighbouring files of one workspace, so one plan carries both.

`specs/compiler.md` §7.2.1, line 537 (unmarked before the census):

> **Status: Partial.** Within one node the derivation does not take the narrowest length: `containerWidthOf` in `packages/compiler/src/site/image-transform.ts` takes a literal `max-width` and ignores `width` whenever both are declared, so `{ "width": "320px", "maxWidth": "960px" }` derives `(max-width: 960px) 100vw, 960px`. The minimum is taken only across ancestors.

The concurrency cap is a sentence of §7.2 (line 533, "Up to 4 variants are processed concurrently per image."), repeated at the end of `site-architecture.md` §9.2.2 (line 1179). Both sections are claimed by `plan:_shared/image-pipeline-text`, which requires this plan; their markers each end with the defect: §7.2, line 518, "And the concurrency sentence does not hold: `processImage` starts every encode as it builds the width × format list, and its `CONCURRENCY = 4` loop only awaits the already-running promises four at a time."; §9.2.2, line 1167, "…and nothing limits concurrency to 4, since every variant's Sharp encode starts as its task is created and the later batches of 4 only await work already running." This plan builds the cap and claims nothing there.

Verified against the tree:

- `containerWidthOf` (`image-transform.ts` line 513) computes `pxLength(style.maxWidth) ?? pxLength(style.width)`, then `Math.min` against the inherited bound. It is called twice: by `walkAndTransform` (line 308) for the bound passed to children, and by `transformImgNode` (line 588) for the image's own style. The existing test "the image's own literal width constrains it too" covers `width` alone; no test declares both. No node in `sites/`, `packages/starters/sites/` or `examples/` declares a literal `width` narrower than a literal `maxWidth`, so no committed site's output changes.
- `processImage` (`image-optimizer.ts` line 172) calls `sharp(srcPath).resize(width).toFormat(…).toFile(absolutePath)` inside the width × format loop, so every encode starts at once; the loop at line 230 then awaits `tasks.slice(i, i + 4)` in turn. When an early batch rejects, the later batches are never awaited, so their encodes keep running and any rejection among them goes unhandled.
- `processImage` calls never overlap: `walkAndTransform` awaits each image and `buildSite`'s route loop (`site-build.ts` line 665) awaits each page, so four per image is also four per build.
- Out of scope: the `innerHTML` half (`transformInnerHtmlImages`) derives no `sizes` from its container at all and writes `config.sizes` unconditionally. That is correction 5 of `plan:_shared/image-pipeline-text`, decided there. `compiler.md` §7.2 and §7.2.1 describe `<img>` nodes, which is what this plan makes true.

Tests: `packages/compiler/tests/image-transform.test.ts` (`describe("image-transform — sizes derived from the container")`, line 987; the optimizer module is mocked), `image-optimizer.test.ts` (`describe("processImage")`, line 628; Sharp mocked through `mockToFile`, `mockToFormat`, `mockResize`).

## Outcome

- `compiler.md` §7.2.1 → Implemented: the leading Partial marker is removed (the section was unmarked before the census, like its siblings §7.4 and §7.6), and its body states the within-element rule and what is not read.
- `compiler.md` §7.2 and `site-architecture.md` §9.2.2 stay Partial and stay `plan:_shared/image-pipeline-text`'s; their markers lose the concurrency clause, and the "Up to 4 variants" sentence in each becomes true.

## Decisions

- **Decided:** each element contributes the smallest of its literal `style.maxWidth`, its literal `style.width` and the inherited bound, because §7.2.1 already says "the narrowest literal `max-width`/`width` … declared on the image or any ancestor" and a declared `width` narrower than its `max-width` is the width the element renders at. Only those two `style` keys are read, as today: not `minWidth`, and not the `width` attribute, which is where the pass itself writes the intrinsic size.
- **Open:** does a `maxWidth` or `width` inside a nested style block (`@media`, a named breakpoint such as `@--md`, `:hover`, or an ancestor's `& img` selector) count? Recommendation: no, and §7.2.1 and the docs page say so, directing the author to write `sizes` on the tag. Because which block applies depends on a viewport the build does not have: a block that narrows the element makes the base value err large (wasted bytes, which is acceptable), but one that widens it at a breakpoint makes it err small (a blurry image), and resolving that needs media-query evaluation against the project's `$media`, far beyond this defect. Stated, it is a documented limit with an escape hatch; unstated, the "narrowest declared" wording promises more than any implementation of it keeps. Building it instead means a node with any nested redeclaration contributing the widest of its per-block bounds, or none when a block's value is not literal.
- **Decided:** `processImage` queues encodes as thunks and a private `runLimited` runs at most `ENCODE_CONCURRENCY = 4` of them at once, each thunk constructing its Sharp pipeline only when started, because a promise is already running when it exists, so no batching of promises can bound anything. The pool is the shared-index worker loop of `mapLimit` in `packages/studio/src/grid/sources/content-source.ts` (which its one caller runs at 8), written privately here without the result array; the compiler cannot import from Studio, and a shared helper for two ten-line loops is not worth a new module and its coverage entry.
- **Decided:** after the first failed encode no further encode starts, and `processImage` rejects with that error, because the image's manifest is never cached after a failure, so the remaining encodes are wasted work, and because every worker is awaited under one `Promise.all`, no rejection is left unhandled. Encodes already running finish; Sharp offers no cancellation.
- **Decided:** the cap stays per `processImage` call, not a build-wide semaphore, because calls never overlap (Context), so per image is already per build, and a module-level counter would add shared state for no effect.
- **Decided:** this plan's pull request removes the concurrency clause from the `compiler.md` §7.2 and `site-architecture.md` §9.2.2 markers although it claims neither section, because a marker is the spec's statement of what ships, and leaving "does not hold" in place between this landing and `plan:_shared/image-pipeline-text`'s would be the stale marker the census exists to remove.

## Implementation

Written for the Open's recommendation; answered the other way, `containerWidthOf` gains the per-block reading described there, and the nested-block test and spec and docs sentences change to assert it.

1. `packages/compiler/src/site/image-transform.ts`
   - `containerWidthOf(node, inherited)`: after the `style` guard, start from `inherited` and lower it by each of `pxLength(style.maxWidth)` and `pxLength(style.width)` that is non-null; return the result (`null` only when all three are null). Rewrite its doc comment: "The narrowest literal `max-width` or `width` this element declares in its base `style`, or the inherited bound when that is narrower. Nested blocks are not read (compiler.md §7.2.1)", keeping the existing paragraph on why only literals count.
   - `walkAndTransform`, line 307: the comment says "max-width or width".
   - Delete the orphaned JSDoc block above `const CSS_LENGTH` (lines 482–490), which repeats `walkAndTransform`'s parameters and documents nothing.
2. `packages/compiler/src/site/image-optimizer.ts`
   - Module scope: `const ENCODE_CONCURRENCY = 4;` with a one-line comment citing compiler.md §7.2, and a private `async function runLimited(thunks: readonly (() => Promise<void>)[], limit: number): Promise<void>`: a shared `next` index and a `failed` flag; `Math.min(limit, thunks.length)` workers, each looping `while (!failed && next < thunks.length)` over `await thunks[next++]()`, setting `failed` and rethrowing in a `catch`; `await Promise.all(workers)`.
   - `processImage`: `tasks` becomes `encodes: (() => Promise<void>)[]`; the loop pushes `async () => { await sharp(srcPath).resize(width).toFormat(format as SharpFormat, { quality }).toFile(absolutePath); }` where it now pushes a started promise; the `existsSync` skip, the `variants.push` and the variant order are unchanged. Replace the `CONCURRENCY` loop with `await runLimited(encodes, ENCODE_CONCURRENCY)`. Fix the function comment's cache path example (`.cache/images/_optimized/` is only the fallback; say "the image cache's `_optimized/`").

No signature changes. `processImage(srcPath, cacheImgDir, config)` and `ImageManifest` are as before, so `image-transform.ts` and `site-build.ts` are untouched beyond step 1.

**Integration contract.** Once this lands, `plan:_shared/image-pipeline-text` may rely on: `processImage` computes each variant's filename and quality in its width × format loop and hands `runLimited` one thunk per missing variant, so a change to the filename (its `variantHash`) touches only that loop; at most four encodes run at once, and the first failure rejects `processImage` with Sharp's error and starts nothing further. `containerWidthOf(node, inherited)` returns the minimum of the inherited bound and the node's literal base `maxWidth` and `width`, and is the function the `innerHTML` half should call for its container. `compiler.md` §7.2.1 is unmarked and reads as Specs & docs below, which is the text that plan moves into `site-architecture.md` §9.2.2 step 4. The "Up to 4 variants are processed concurrently per image." sentences in `compiler.md` §7.2 and `site-architecture.md` §9.2.2 are true, and neither marker mentions concurrency.

## Tests

Run `bun test --isolate --coverage` from `packages/compiler`. No new source file, so the manifest check sees nothing new. The per-file threshold in `packages/compiler/bunfig.toml` (`lines = 0.982, functions = 0.98`) must hold for both changed files; `runLimited`, its worker and the encode thunks are all exercised below. Ratchet only if the workspace's worst file rises. Sharp stays mocked.

- `image-transform.test.ts`, `describe("image-transform — sizes derived from the container")`, using the existing `imgIn` and `sourcesOf` helpers:
  - "a node declaring both width and max-width is bounded by the narrower": `imgIn({ maxWidth: "960px", width: "320px" })` gives `(max-width: 320px) 100vw, 320px` (fails today with 960), and `imgIn({ maxWidth: "20rem", width: "960px" })` gives the same.
  - "the image's own width and max-width both count": an `img` node with `style: { maxWidth: "40rem", width: "300px" }` gives `(max-width: 300px) 100vw, 300px`.
  - "an ancestor narrower than both of a node's lengths still wins": a `div` with `maxWidth: "240px"` around `imgIn({ maxWidth: "960px", width: "320px" })` gives `(max-width: 240px) 100vw, 240px`.
  - "a length inside a nested block is not read": `imgIn({ maxWidth: "960px", "@media (min-width: 1200px)": { maxWidth: "1200px" } })` gives `(max-width: 960px) 100vw, 960px`.
- `image-optimizer.test.ts`, `describe("processImage")`:
  - `beforeEach` also resets `mockToFile.mockImplementation(() => Promise.resolve())`, so a test's implementation cannot leak.
  - "never runs more than four encodes at once": metadata width 2000, `widths: [320, 640, 960, 1280, 1920]`, `formats: ["webp", "avif"]` (ten encodes); `mockToFile` increments an in-flight counter, records the peak, waits `setTimeout(1)` and decrements. Asserts ten `toFile` calls, a peak of exactly 4 (the old loop peaks at 10), and ten variants in the manifest.
  - "a failed encode starts no further encodes and rejects": the same ten encodes, the first `toFile` rejecting with `new Error("encode failed")` and the rest resolving after `setTimeout(5)`. Asserts `processImage` rejects with "encode failed" and, after a 20 ms wait, `toFile` was called exactly 4 times.
  - The existing "skips variant generation if output file already exists" covers the empty queue (no workers).

## Specs & docs

`specs/compiler.md`:

- §7.2.1: delete the Partial marker (line 537). After resolution-order item 2's sentence, add: "Both properties count on every element, the image included, so `{ "width": "320px", "maxWidth": "960px" }` derives `(max-width: 320px) 100vw, 320px`." Extend the closing paragraph ("Only literal lengths derive. …") with: "Only an element's base `style` is read: a length inside a nested block (a media query, a named breakpoint, a pseudo-class, or an ancestor's descendant selector) is not, because which block applies depends on the viewport, so a container that widens at a breakpoint needs `sizes` written on the tag."
- §7.2: in the marker (line 518), delete its last sentence, "And the concurrency sentence does not hold: … four at a time." The marker stays Partial for its other statements; the body sentence at line 533 is unchanged.

`specs/site-architecture.md`:

- §9.2.2's marker (line 1167): "Six statements do not:" becomes "Five statements do not:", and the list ends "…`width` and `height` are injected only when `optimize` is on, and variants are encoded into the image cache and copied to `dist/images/_optimized/` afterwards." (the concurrency clause and its "since…" are deleted). The marker stays Partial; line 1179 is unchanged.

Fragments:

- `bun run spec:change compiler.md minor -m "A derived sizes takes the narrower of each element's literal width and max-width as well as the narrowest across its ancestors, reads no nested style block, and an image's variants encode at most four at a time."`
- `bun run spec:change site-architecture.md patch -m "The §9.2.2 status marker no longer lists the four-encode limit as unmet."`

Docs: `docs/framework/site/images.md` (`spec:` cites `compiler.md#7` and `site-architecture.md#9`; `code:` lists both changed files). "How `sizes` is chosen", item 2 already states the within-element rule and stays. The paragraph beginning "Only literal lengths count." gains: "Only the element's own `style` counts, not a length set inside a media query, a named breakpoint, a pseudo-class or an ancestor's selector block such as `& img`, so a container that widens at a breakpoint needs a `sizes` on the tag too." (no em dash). The page says nothing about encode concurrency, so nothing else changes. No other docs page cites `compiler.md#7`, `site-architecture.md#9.2` or either changed file (`docs/studio/projects/media.md` and `content-collections.md` cite §9 and §9.3 on other subjects).

Plans: the landing pull request deletes this file and removes `compiler/image-sizes-and-encode-limit` from `plan:_shared/image-pipeline-text`'s `requires`, and updates that plan's Context, whose quotes of the §7.2 and §9.2.2 markers and whose "The concurrency sentence is a code defect…" sentence this change makes stale. It also rewords the `plans/site-architecture/README.md` spec-wide decision that names this plan (the `image-pipeline-text` edge), which `plans:check` does not scan but which would otherwise cite a deleted file. `compiler.md` does not graduate: §7.1, §7.2 and other sections remain open.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage` passes at its thresholds, and `bun scripts/check-coverage-manifest.ts packages/compiler` passes.
- The two new `processImage` cases fail against the old batching loop (peak 10; 10 `toFile` calls after a failure), and "a node declaring both width and max-width is bounded by the narrower" fails against the old `??`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:prose` pass; `bun run plans:status --spec compiler` no longer lists §7.2.1.
- `grep -n "concurren" specs/compiler.md specs/site-architecture.md` prints only the two "Up to 4 variants are processed concurrently per image." lines.
- On a scratch site, a `div` with `style: { "width": "320px", "maxWidth": "960px" }` around `<img src="/images/hero.png">` builds with `sizes="(max-width: 320px) 100vw, 320px"` on each `<source>`.
