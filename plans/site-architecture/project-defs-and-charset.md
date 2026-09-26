---
status: stub
disposition: implement
claims:
  - site-architecture.md#3.1
size: M
workspaces:
  - packages/schema
  - packages/site
  - packages/compiler
  - packages/studio
---

# Project `$defs` reach every page, and the default charset is `utf-8`

## Context

`specs/site-architecture.md` §3.1, line 214:

> **Status: Partial.** Every key is in the project schema (`packages/schema/defs/project-config.schema.ts`) except `content`, which the parser extension contributes (`extensions/parser/src/Content.class.json`), and all but `$defs` are read by the build or the page context (`packages/site/src/context.ts`, `packages/compiler/src/site/site-build.ts`). No build, runtime or context code reads project `$defs`, which only Studio's Data Shapes editor writes (`packages/studio/src/settings/defs-editor.ts`), and `defaults.charset` defaults to `"utf8"` (the schema source `packages/schema/defs/project-config.schema.ts`, `packages/compiler/src/site/site-loader.ts`, `compilePage` in `packages/compiler/src/site/site-build.ts`, `packages/site/src/head-merger.ts`) rather than `utf-8`.

The section was unmarked before the census. Two unrelated defects share this anchor, and an anchor has one owner, so one plan holds both; the charset half is a one-line change and could land first on its own.

**What exists**

- The `$defs` key in the project schema (source `packages/schema/defs/project-config.schema.ts`, generated into `packages/schema/project-schema.json`; "Global type definitions available to all pages") and Studio's Data Shapes editor, which writes `projectConfig.$defs` (`packages/studio/src/settings/defs-editor.ts`).
- `injectContext` (`packages/site/src/context.ts`), which already cascades project `state`, `$media` and `imports` into each page and is the natural place for a `$defs` merge (page wins, as for `$media`).
- The charset default `"utf8"` in four places: the schema's `defaults.charset.default` (`packages/schema/defs/project-config.schema.ts`), `DEFAULTS` (`packages/compiler/src/site/site-loader.ts`), the `projectConfig.defaults?.charset ?? "utf8"` fallback in `compilePage` (`packages/compiler/src/site/site-build.ts`) and the fallback in `mergeHead` (`packages/site/src/head-merger.ts`). `utf8` is an Encoding Standard label, but the HTML Standard requires the `charset` attribute to match `utf-8`.

**What is missing**

- A reader for project `$defs`. spec.md §5.2 makes `$defs` tooling-only, so "available to all pages" means that a page's `"type": { "$ref": "#/$defs/<name>" }` resolves against the project's definitions (page definitions winning), in `jx validate`, in Studio's type pickers and in the canvas. The detail phase decides which of those hosts need it and whether the merge is a copy into the page (as `$media` does) or a resolver fallback. `docs/framework/site/project-json.md` already tells authors that "any document in the project can reference" these definitions, so the docs overclaim today.
- `defaults.charset` defaulting to `utf-8` in all four: the schema source `packages/schema/defs/project-config.schema.ts` (then `bun run schema:sync` regenerates `packages/schema/project-schema.json` and the per-project schemas, which are build outputs and never hand-edited), the loader, `compilePage` and the head merger, with a test pinning the emitted `<meta charset="utf-8">`.

**Related**

- spec.md §5.2 (`$defs` is pure JSON Schema, no runtime artifacts).
- site-architecture.md §8.4 (`<meta charset>` from `defaults.charset`) and site-architecture.md §10.2 (what inherits automatically, which does not list `$defs`).
- studio.md §17.1 (Project Settings, whose Data Shapes section edits the key).
