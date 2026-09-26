---
status: stub
disposition: reconcile
claims:
  - spec.md#16.7
size: S
---

# The development/production table names the hosts that interpret JSON and drops the unmeasured bundle figure

## Context

`specs/spec.md` §16.7, line 1745:

> **Status: Partial.** Both renderers exist as tabled. The Development column describes Studio's live preview and canvas (`packages/server/src/live-preview.ts`) and roots without a `project.json`, not `jx dev` on a site project, which builds with `buildSite` and serves the compiled pages (`startDev` in `packages/server/src/dev.ts`); and the "~10 kB deps" figure has no committed measurement.

**What exists**

- `startDev` in `packages/server/src/dev.ts`: a root with `project.json` is built with `buildSite` and served from `dist/`, rebuilt before each live-reload broadcast.
- `packages/server/src/live-preview.ts` bundles `@jxsuite/runtime` for Studio's live preview; the canvas interprets documents.
- `packages/compiler/src/site/client-runtime.ts` ships `@vue/reactivity` and `lit-html` to built sites.

**What is missing**

- The table's columns renamed for what they are (interpreted: Studio canvas, live preview, `mount()`, non-site roots; compiled: `jx build` and `jx dev` on a site project), and the "~10 kB deps" cell replaced by the dependency names or backed by a committed measurement. Disposition `reconcile`: building site projects in `jx dev` is deliberate (the dev server previews what ships).

**Related**

- §21.3 (the interpreting runtime and its hosts), `server.md` (dev server), `compiler.md` Appendix A (production dependency stack).
