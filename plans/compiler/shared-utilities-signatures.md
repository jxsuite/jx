---
status: stub
disposition: reconcile
claims:
  - compiler.md#11
size: S
---

# The shared-utilities list names the functions and signatures the compiler exports

## Context

`specs/compiler.md` §11, line 704 (the section's only marker before the census was the trailing `Implemented` one at the end of the section, which stays):

> **Status: Partial.** Three entries do not match the code: `transformImageNodes` is `(doc, config, projectRoot, cache, metaCache?, mounts?)` and returns `{ imageRefs }` (`packages/compiler/src/site/image-transform.ts`); `processImage` is `(srcPath, cacheImgDir, config)` and writes to the image cache, not an `outDir` (`image-optimizer.ts`); and `buildRoute` is a private helper of `packages/compiler/src/targets/compile-server.ts`, not a shared utility. The others ship as listed, in `packages/compiler/src/shared.ts`.

Disposition `reconcile`: the signatures changed for reasons the rest of the spec already records (variants go to a persistent cache and are copied into `dist/`, §7.5; asset mounts resolve image sources, §7.3), and nothing needs `buildRoute` outside the server target.

**What exists**

- `isDynamic`, `buildInitialScope`, `attrHelperSource`, `compileStyles`, `collectServerEntries` exported from `packages/compiler/src/shared.ts`, and `isSchemaOnly` re-exported there; `packages/compiler/tests/shared.test.ts` (including the `enumeratedAttrNames` equality test).
- `transformImageNodes` in `packages/compiler/src/site/image-transform.ts`, `processImage` in `packages/compiler/src/site/image-optimizer.ts`, the unexported `buildRoute` in `packages/compiler/src/targets/compile-server.ts`.

**What is missing**

- The two image headings rewritten to their real parameters and results, or moved under §7 where their callers are described.
- `buildRoute` dropped from the list, or described where §6.2 and §6.3 already show the route it emits.

**Related**

- `compiler.md` §6.2, §6.3, §7.2, §7.5.
- `plan:_shared/image-pipeline-text`, which reconciles the §7 prose the two image signatures belong to; the two may land in one pull request.
