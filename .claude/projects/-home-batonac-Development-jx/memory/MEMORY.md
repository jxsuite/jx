# Jx Project Memory

## Project Overview

- Monorepo at `/home/batonac/Development/jx/` using Bun + npm workspaces
- JSON-native reactive web component system — structure and state are plain JSON, reactivity via `@vue/reactivity`
- DDOM was the precursor project; DDOME was the unbuilt visual editor spec for DDOM

## Packages

- `@jxsuite/runtime` — core renderer (851 lines), sole dep: `@vue/reactivity`
- `@jxsuite/compiler` — static HTML compiler with hydration islands
- `@jxsuite/parser` — markdown integration (`MarkdownFile`, `MarkdownCollection`, `MarkdownDirective` remark plugin) in `md.js`
- `@jxsuite/schema` — JSON Schema 2020-12 meta-schema generator from `@webref/*` data
- `@jxsuite/studio` — visual builder (~2850 lines vanilla JS), uses Atlassian pragmatic-drag-and-drop

## Key Specs

- `spec/spec.md` — main Jx spec (five `$defs` shapes, `$ref`, `$prototype`, `$media`, etc.)
- `spec/builder-spec.md` — studio builder spec
- `spec/ddome.md` — DDOME vision doc (never built, precursor concepts)
- `spec/studio-next-spec.md` — v0.3.0 next steps proposal: runtime-first, then markdown-as-canvas-mode

## Studio Status

- Working: file I/O, layer tree DnD, multi-breakpoint canvas, inspector, signal management, block library
- Gap: uses own preview renderer, not `@jxsuite/runtime`; no markdown editing; single-file scope

## Studio Next Steps (v0.3.0 spec)

- Priority 1: Runtime integration (onNodeCreated callback, edit/preview toggle)
- Priority 2: Markdown as canvas mode — NOT a text editor. Bidirectional mdast↔Jx conversion
  - mdToJx() and jxToMd() — two tree walkers + mapping table, ~300 lines total
  - Markdown element allowlist defines what round-trips to pure markdown
  - Non-allowlist elements become directive syntax on export
  - Existing canvas, layer tree, DnD, inspector all reused — no new UI panels
- Priority 3: Content file management (directory picker, files panel, frontmatter inspector)
- Priority 4: Stylebook (CSS custom properties editor, breakpoint editor)
- Priority 5: Component management (tabs, cross-file $ref navigation)

## Architecture Notes

- Studio state is immutable (structuredClone + history stack), all mutations via `applyMutation()`
- Markdown directives (`:::name{attrs}`) map to custom element HTML tags
- `MarkdownFile` uses `readFileSync` — needs `source` option for browser use
- Product vision: WordPress-like authoring + Astro-like compilation pipeline
