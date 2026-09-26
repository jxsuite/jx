---
status: stub
disposition: implement
claims:
  - compiler.md#7.2.1
size: S
workspaces:
  - packages/compiler
---

# A derived `sizes` takes a node's narrowest literal width, and at most four variants encode at once

## Context

Two small defects in the image pipeline where the spec states the intended behaviour and the code falls short of it. Both are `implement`, in two neighbouring files of one workspace, so one stub carries both.

`specs/compiler.md` §7.2.1, line 537 (unmarked before the census, and listed as verified in its first pass):

> **Status: Partial.** Within one node the derivation does not take the narrowest length: `containerWidthOf` in `packages/compiler/src/site/image-transform.ts` takes a literal `max-width` and ignores `width` whenever both are declared, so `{ "width": "320px", "maxWidth": "960px" }` derives `(max-width: 960px) 100vw, 960px`. The minimum is taken only across ancestors.

The concurrency cap is a sentence of §7.2 ("Up to 4 variants are processed concurrently per image"), whose marker, owned by `plan:_shared/image-pipeline-text`, ends at line 518:

> And the concurrency sentence does not hold: `processImage` starts every encode as it builds the width × format list, and its `CONCURRENCY = 4` loop only awaits the already-running promises four at a time.

This plan builds that half of §7.2 and claims nothing there; `plan:_shared/image-pipeline-text` owns §7.2 and requires this plan, so the section's marker goes in one step.

**What exists**

- `containerWidthOf` in `packages/compiler/src/site/image-transform.ts`: `pxLength(style.maxWidth) ?? pxLength(style.width)` per node, `Math.min` against the inherited value.
- `processImage` in `packages/compiler/src/site/image-optimizer.ts`: `sharp(srcPath).resize(width).toFormat(...).toFile(...)` is called inside the width × format loop, so every encode starts at once; the later `for (i += CONCURRENCY) await Promise.all(tasks.slice(...))` only paces the awaiting.
- Tests: `packages/compiler/tests/image-transform.test.ts` (container-derived `sizes`), `image-optimizer.test.ts`.

**What is missing**

- `containerWidthOf` takes the minimum of both literal lengths on a node, with a test for a node declaring both.
- `processImage` queues thunks and runs at most four encodes at a time, with a test that observes the cap (a mocked `sharp` counting concurrent `toFile` calls; sharp is always mocked in this repository's tests).

**Related**

- `compiler.md` §7.2 (`plan:_shared/image-pipeline-text`), §7.2.1.
- `site-architecture.md` §9.2.2, whose census marker says the concurrency of 4 matches; it does not, and a forward carries that to its owner, `plan:_shared/image-pipeline-text`.
