---
status: stub
disposition: reconcile
claims:
  - compiler.md#7.1
  - compiler.md#7.2
  - compiler.md#7.3
  - compiler.md#7.5
  - compiler.md#7.7
  - site-architecture.md#9.2.2
  - site-architecture.md#9.2.3
  - site-architecture.md#9.2.5
requires:
  - compiler/image-sizes-and-encode-limit
size: M
---

# compiler.md §7 and site-architecture.md §9.2 describe the image pipeline that ships, with one spec holding the text and the other citing it

## Context

Two specs restate one build-time image pipeline, and eight of their sections have drifted from the code and, for several, from each other. The compiler census and the site-architecture census each stubbed its own half (one claiming compiler.md §7.1, §7.2, §7.3, §7.5 and §7.7, the other site-architecture.md §9.2.2, §9.2.3 and §9.2.5), and each already expected to cite rather than restate the other. They are one plan because the halves share three decisions, set out below, and a rewrite of either half that took them alone would leave the two specs disagreeing again.

`specs/compiler.md` §7.1, line 488:

> **Status: Partial.** The table omits `picture` (default `true`: `DEFAULTS.images` in `packages/compiler/src/site/site-loader.ts`, `packages/schema/defs/image-config.schema.ts`). And `optimize` is not a master switch: `site-build` calls `transformImageNodes` whatever it says, and the loading pass applies `lazyLoad` on its own, yielding to `fetchpriority="high"` (`imgLoadingAttrs` in `packages/compiler/src/site/img-loading.ts`), as `site-architecture.md` §9.2.1 and §9.2.7 state.

`specs/compiler.md` §7.2, line 518:

> **Status: Partial.** With two or more formats (the default `webp` and `avif`) and `picture` not `false`, `wrapInPicture` in `packages/compiler/src/site/image-transform.ts` rewrites the node into a `<picture>` with one `<source type>` per format, best compression first, carrying the `srcset` and `sizes`, while the `<img>` keeps `src`, dimensions and loading attributes; only a single-format config gets the bare `<img srcset>` described below (`site-architecture.md` §9.2.2 states the shipped form). Variants are written to the image cache's `_optimized/` directory (`processImage` in `image-optimizer.ts`) and copied to `dist/images/_optimized/` after the routes build, not written to `dist/` directly. And the concurrency sentence does not hold: `processImage` starts every encode as it builds the width × format list, and its `CONCURRENCY = 4` loop only awaits the already-running promises four at a time.

`specs/compiler.md` §7.3, line 552:

> **Status: Partial.** There is no raster allowlist and no animation check: `shouldSkip` in `packages/compiler/src/site/image-transform.ts` skips template, external and empty sources and the `.svg` and `.gif` extensions (`SKIP_EXTENSIONS`), so every GIF is skipped, animated or not, and any other local file goes to Sharp whatever its extension.

`specs/compiler.md` §7.5, line 589:

> **Status: Partial.** The cache is not at `.cache/images/` by default: `getImageCacheDir` in `packages/compiler/src/site/image-cache.ts` prefers the npm cache (`npm config get cache`, then `jxsuite-images/<project basename>/`) and falls back to `.cache/images` in the project only when npm is unavailable, and invalidation looks for the variant files in that directory's `_optimized/`, not in `dist/`. The config hash also folds in `PIPELINE_VERSION` (`image-optimizer.ts`); the key format, persistence and pruning ship as described.

`specs/compiler.md` §7.7, line 608 (its trailing `Implemented` marker at line 616, corrected by the census to name the three modules that exist instead of a `compile-image-endpoint.js` that exists nowhere, stays):

> **Status: Partial.** Step 2's argument list is stale: `transformImageNodes` (`packages/compiler/src/site/image-transform.ts`) receives the config, the project root, the cache (or `null`), the dimension memo and the extension asset mounts, not an output directory; variants reach `dist/` through the copy after the routes build (§7.2).

`specs/site-architecture.md` §9.2.2, line 1167:

> **Status: Partial.** The pipeline ships (`processImage` in `packages/compiler/src/site/image-optimizer.ts`, `transformImgNode` in `packages/compiler/src/site/image-transform.ts`), and the one-format and `<picture>` shapes match. Six statements do not: the native width is added only below the top configured rung, the `<img>` `src` becomes the largest jpeg or png variant when one is emitted, a container-derived `sizes` outranks the config, `width` and `height` are injected only when `optimize` is on, variants are encoded into the image cache and copied to `dist/images/_optimized/` afterwards, and nothing limits concurrency to 4, since every variant's Sharp encode starts as its task is created and the later batches of 4 only await work already running. `compiler.md` §7.2 states the shipped behaviour.

`specs/site-architecture.md` §9.2.3, line 1183:

> **Status: Partial.** The static, local, template-free and `data-no-optimize` rules ship (`shouldSkip` and `transformImgNode` in `packages/compiler/src/site/image-transform.ts`). The format rules do not: there is no raster allowlist, so any local file other than `.svg` or `.gif` goes to Sharp, and every `.gif` is skipped, not only animated ones (`SKIP_EXTENSIONS` in the same file).

`specs/site-architecture.md` §9.2.5, line 1222:

> **Status: Partial.** The key, persistence and error-free pruning match (`packages/compiler/src/site/image-cache.ts`). The location does not: `getImageCacheDir` uses `<npm cache>/jxsuite-images/<project directory name>/manifest.json` whenever `npm config get cache` answers, and `.cache/images` only as a fallback, so the `.gitignore` advice below has no effect on a normal machine; and invalidation checks the variant files in that cache directory, not in `dist/`.

History of the markers. The five compiler.md sections were unmarked before the census, or (§7.7) marked only by a trailing `Implemented`; the census led each with Partial, §7.3 included, so compiler.md §7.3 is claimed here and is no longer the unmarked, unclaimed section the site-architecture census recorded. The three site-architecture.md sections were unmarked before the census. §9.2.3 was first recorded as verified with its format rules as a ride-along, and a review gave it its own marker; the same review found §9.2.2's concurrency clause, which the first marker counted as matching.

**Disposition: reconcile.** The shipped behaviour is deliberate, recorded in code comments and in compiler.md, and tested: `<picture>` exists because `srcset` alone carries no format information (the comment in `resolveVariants` at `image-transform.ts` line 439, the `ImageConfig` comment in `image-optimizer.ts`, the `picture` description in `image-config.schema.ts`, and §9.2.2's own step 4); the cache lives in the npm cache so CI hosts that persist `~/.npm`, Cloudflare Pages among them, keep variants between builds (the header comments of `image-cache.ts` and `getImageCacheDir`); the top-rung cap, the decodable `src` fallback and container-derived `sizes` were changed on purpose and written into compiler.md §7.2 and §7.2.1 (`PIPELINE_VERSION`'s comment in `image-optimizer.ts` cites §7.2 for the cap). site-architecture.md §9.2's prose predates those changes. Three parts are exceptions, and each is either handled elsewhere or a detail-phase decision whose `implement` answer would add `packages/compiler` to this plan's workspaces:

- **The concurrency cap** (§7.2 and §9.2.2 state the same "up to 4 variants" sentence). It is a code defect, not a stale sentence: `processImage` (`packages/compiler/src/site/image-optimizer.ts`, lines 207 to 233) calls `sharp(...).toFile(...)` inside the width-by-format loop, so every encode has started before the `CONCURRENCY = 4` loop awaits them four at a time. `plan:compiler/image-sizes-and-encode-limit` builds a limiter that creates the tasks lazily; this plan requires it, so both sentences stand unchanged once it lands and the two markers flip in one step.
- **`width` and `height` with `optimize: false`** (§9.2.2 step 5). The spec's "layout shift is not conditional on optimization" argues they should be injected anyway, the reasoning §9.2.7 applies to loading attributes. The code does not: `transformImgNode` resolves variants only when `config.optimize` is set (`image-transform.ts` line 570) and injects dimensions only from them (line 603), and `transformInnerHtmlImages` does the same (lines 694 and 711). Building it means a Sharp metadata read in projects that turned `optimize` off, and `getImageMetadata` throws when Sharp cannot load (`packages/compiler/tests/image-optimizer-nosharp.test.ts`), so an `implement` answer also has to degrade without Sharp. compiler.md is silent here: its §7.2 steps are the `optimize: true` path.
- **The format rules** (§7.3 and §9.2.3). See the second shared decision.

**The three shared decisions**

1. **Which spec holds the text and which points to it.** The compiler census recorded, as a spec-wide decision, that the image pipeline belongs to site-architecture.md §9.2 and that §7 either corrects its restatement or becomes a pointer. The current markers point both ways: compiler.md §7.2's says site-architecture.md §9.2.2 "states the shipped form" (of the `<picture>` shape), and §9.2.2's says compiler.md §7.2 "states the shipped behaviour". The evidence is split. compiler.md §7.2 and §7.2.1 already carry the deliberate changes (the top-rung cap, the decodable `src`, the `sizes` precedence) and are the text the code cites; site-architecture.md §9.2.1 already lists `picture` and states `lazyLoad` is independent of `optimize`, and §9.2.7 owns the loading attributes. The overlap is wider than the claimed sections: §7.4 and §9.2.4 (per-image overrides) and §7.6 and §9.2.6 (the Cloudflare service) also restate each other, all four verified by their censuses, so the choice moves those too as ride-alongs. Whichever spec keeps the text, the other's claimed sections become pointers that cite it by section.
2. **Allowlist or denylist** (compiler.md §7.3 and site-architecture.md §9.2.3, which state the gap in the same terms). The code has a denylist: `SKIP_EXTENSIONS = new Set([".svg", ".gif"])` (`image-transform.ts` line 32), checked by `shouldSkip` (lines 147 to 165) for local sources and by `isAllowedRemote` (line 192) for remote ones in Cloudflare mode, so every `.gif` is skipped, animated or not, and any other local extension reaches Sharp. Reconcile is the default (both texts describe the denylist and say "every GIF"); the alternative is to build the spec's raster allowlist, refusing other extensions before Sharp sees them, or an animation check that lets still GIFs through. Either alternative is an `implement` for both sections.
3. **The cache-location wording** (compiler.md §7.5 and site-architecture.md §9.2.5). `getImageCacheDir` (`packages/compiler/src/site/image-cache.ts`, lines 58 to 75) returns `<npm cache>/jxsuite-images/<basename of the project root>` whenever `npm config get cache` answers and `.cache/images` in the project only otherwise; invalidation looks in that directory's `_optimized/`; `site-build.ts` copies `_optimized/` into `dist/images/_optimized/` after the routes build (step 6b, around line 828). Both texts name `.cache/images/manifest.json` as the location and `dist/` for invalidation, and §9.2.5's `.gitignore` advice ("can optionally be committed for CI build speed") has no effect when the npm cache answers. One wording serves both: the npm cache first, for the CI reason, the in-project fallback second, and the `.gitignore` advice either scoped to the fallback or dropped.

**What exists**

- `packages/compiler/src/site/image-transform.ts`: `transformImageNodes` (the entry point, `(doc, config, projectRoot, cache, metaCache?, mounts?)`), `transformImgNode` (the node-tree half), `transformInnerHtmlImages` and `renderPictureTag` (the pre-rendered `innerHTML` half), `shouldSkip`, `SKIP_EXTENSIONS`, `isAllowedRemote`, `fallbackVariant`, `containerWidthOf`, `sizesForContainer`, `wrapInPicture`.
- `packages/compiler/src/site/image-optimizer.ts`: `processImage`, `variantFilename`, `configHash` (folds in `PIPELINE_VERSION = 2`), `contentHash`, `getImageMetadata`.
- `packages/compiler/src/site/image-cache.ts`: `getImageCacheDir`, `cacheKey`, `loadCache`, `saveCache` and its pruning.
- `packages/compiler/src/site/img-loading.ts`: `imgLoadingAttrs`.
- `packages/compiler/src/site/site-build.ts`: the cache is loaded only when `images.optimize` is on and the service is `"build"` (around line 533); `transformImageNodes` is called whether or not `optimize` is on (around line 1446, whose comment says so); the save and the copy of `_optimized/` into `dist/images/_optimized/` in step 6b.
- `picture: true` in `DEFAULTS.images` (`packages/compiler/src/site/site-loader.ts`) and in `packages/schema/defs/image-config.schema.ts`.
- Tests: `packages/compiler/tests/image-transform.test.ts`, `image-optimizer.test.ts`, `image-optimizer-nosharp.test.ts`, `image-optimizer-sharp-fallback.test.ts`, `image-cache.test.ts`, `img-loading.test.ts`.

**What is missing**

- compiler.md §7.1: the table gains `picture`, and `optimize` is described as the variant switch, with `lazyLoad` independent of it.
- compiler.md §7.2: the steps describe the `<picture>` rewrite for multi-format configs and the cache-then-copy path for variants; the concurrency sentence stands once the prerequisite lands.
- compiler.md §7.3 and site-architecture.md §9.2.3: the format rules state what `shouldSkip` decides (no raster allowlist, every `.gif` skipped, "animated GIFs" corrected to every GIF), unless the second decision builds an allowlist or an animation check.
- compiler.md §7.5 and site-architecture.md §9.2.5: the location `getImageCacheDir` resolves and its fallback, invalidation against the cache's `_optimized/`, `PIPELINE_VERSION` in the config hash (compiler.md §7.5 names the hashed fields), and §9.2.5's `.gitignore` advice rewritten to match.
- compiler.md §7.7: step 2 names the arguments `transformImageNodes` takes, and variants reach `dist/` through the step-6b copy.
- site-architecture.md §9.2.2: steps 1, 3, 4 and 5 rewritten to what ships (the native width only below the top rung, variants into the cache then copied, the decodable `src` fallback, container-derived `sizes` before the config, dimensions only with `optimize` unless that decision goes the other way), citing compiler.md §7.2 and §7.2.1 rather than restating them if the first decision puts the text there. Its concurrency sentence is made true by the prerequisite rather than edited.
- Whichever spec keeps the text states that the two halves of `image-transform.ts` differ, or the detail phase brings them together. Images in a pre-rendered `innerHTML` string (Markdown content) get the dimensions, the `<picture>` wrap and the loading attributes, but not the decodable `src` fallback (only `transformImgNode` applies `fallbackSrc`) and not the `sizes` precedence: `transformInnerHtmlImages` writes `config.sizes` whatever the tag or its container says, and only its `<picture>` branch (`renderPictureTag`) keeps a `sizes` the tag already had. Neither spec's text distinguishes the two halves today.
- Ride-alongs that follow the three decisions: §7.4 and §9.2.4, §7.6 and §9.2.6 reduced to one text and a pointer if the first decision moves them; site-architecture.md §9.2.6's "`.cache/images/` / `dist/images/_optimized/` are not used" named by the cache in general rather than by its fallback path; site-architecture.md §9.2.1's `optimize` row ("Master switch, set to `false` to disable all image processing"), which the loading pass qualifies, worded as the variant switch the same way as compiler.md §7.1; and the stale `transformImageNodes` doc comment in `image-transform.ts`, which says variants are written to `.cache/images/_optimized/`.

**Related**

- `plan:compiler/shared-utilities-signatures` corrects the `transformImageNodes` and `processImage` signatures compiler.md §11 lists. It should land in the same pull request as this plan but stays a separate plan.
- `plan:compiler/image-sizes-and-encode-limit`, required here, also owns compiler.md §7.2.1 (the within-node narrowest-length defect in `containerWidthOf`); the `sizes` text this plan writes cites §7.2.1 as it stands once that lands.
- site-architecture.md §9.2.7 (loading attributes, independent of `optimize`), whose `Implemented` marker stays, and site-architecture.md §14.2 (build artifacts), which lists `dist/images/_optimized/`.
