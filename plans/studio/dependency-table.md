---
status: stub
disposition: reconcile
claims:
  - studio.md#11
size: S
---

# The Dependencies table lists what Studio is actually built from

## Context

`specs/studio.md` §11, line 1247 (the section was unmarked before the census):

> **Status: Partial.** The table is stale. `yaml` is declared in `packages/studio/package.json` but imported by nothing in `src`, `unified` and `remark-*` reach Studio only through `@jxsuite/markup`, and format parsing runs behind the PAL (`src/format/format-host.ts`); runtime dependencies such as `tabulator-tables`, `@vue/reactivity`, `ajv`, `@jxsuite/collab`, `@jxsuite/ai`, `@jxsuite/schema` and `@jxsuite/site` are missing from it.

Disposition `reconcile`. Studio holding no format knowledge is §8.1's rule, so the Markdown pipeline correctly left the table; what remains is to list what is there. Whether the unused `yaml` declaration is dropped from `package.json` is a one-line code change that can ride along.

**What exists**

- `packages/studio/package.json` `dependencies`: `@atlaskit/pragmatic-drag-and-drop` (and `-hitbox`), `@jxsuite/ai`, `collab`, `create`, `formulas`, `markup`, `protocol`, `runtime`, `schema`, `site`, `ui`, `@vue/reactivity`, `ajv`, `ajv-formats`, `lit-html`, `monaco-editor`, `tabulator-tables`, `yaml`.
- `yaml` appears in `src` only as a Monaco language id (`packages/studio/src/services/model-uri.ts`).
- `@jxsuite/markup` renders the assistant's Markdown (`src/panels/ai-chat/chat-markdown.ts`) and converts paste.

**What is missing**

- The table rewritten against `package.json`, each row naming what Studio uses the package for; `yaml`, `unified` and `remark-*` removed or explained.
- A decision on dropping `yaml` from `package.json`.
- Editorial ride-along: §1 says Adobe Spectrum Web Components remain "for the surfaces that have not yet migrated", and none remain (§6.2's colour picker names the last Spectrum surface, since replaced, and `packages/studio/package.json` carries no Spectrum package).

**Related**

- studio.md §8.1 (format dispatch through the PAL), studio.md §11.1 (bundle layout), studio.md §11.2 (the package names no backend), studio-ui-guidelines.md §1 (the kit replaces Spectrum).
