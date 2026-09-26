---
status: stub
disposition: implement
claims:
  - site-architecture.md#12.3
size: L
workspaces:
  - packages/compiler
  - packages/server
---

# A rebuild recompiles only the pages an edit can reach

## Context

`specs/site-architecture.md` §12.3, line 1632:

> **Status: Pending.** No dependency graph exists. `jx build` and the dev server's pre-reload rebuild are both FULL builds, so the paragraph below describes an intended design rather than shipped behaviour. It is fast enough that nothing has forced the issue yet; the cost is that it scales with the project rather than with the edit.

The marker predates the census and is accurate; the retired roadmap's "Incremental builds" row agreed. Disposition `implement` by default. The marker's own "fast enough that nothing has forced the issue yet" is the case for `defer` (§12.3 would then read Future), and the detail phase should settle it with a measurement on the largest project in the repository (`sites/jxsuite.com`) before designing anything.

**What exists**

- `buildSite` in `packages/compiler/src/site/site-build.ts`, which rediscovers pages, reloads content and recompiles every route on each call.
- `packages/server/src/dev.ts`, which calls `buildSite(root, { verbose: false })` before each live-reload broadcast.
- One per-file cache already: the image cache (`packages/compiler/src/site/image-cache.ts`), keyed on source content and config, which is asset reuse rather than page-level incremental compilation.

**What is missing**

- A dependency graph from each route to what it read: its page file, its layout chain, the components it uses, the content collections and entries its state queries, data files reached through `$ref`, and `project.json` (which invalidates everything).
- Selective recompilation driven by that graph for the dev server, and a decision on whether `jx build` uses it too (a persisted graph) or stays a full build.
- Correctness guards: site-wide outputs (sitemap, `_headers`, the CSP scan, the worker, feeds and search indexes) are functions of every page, so an incremental rebuild must still regenerate them.

**Related**

- site-architecture.md §12.1 (the build pipeline) and site-architecture.md §12.2 (`jx dev`).
- server.md (the dev server's rebuild-before-reload loop) and compiler.md.
