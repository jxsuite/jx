---
status: stub
disposition: implement
claims:
  - extensions.md#10
size: S
workspaces:
  - packages/studio
---

# The file tree and quick search draw the icon a format class declares

## Context

`specs/extensions.md` §10, line 517:

> **Status: Partial.** `modes`, `documentMode`, `newFileTemplate`, `elements` and `stateDefaults` ship (`packages/studio/src/tabs/tab.ts`, `packages/studio/src/files/files.ts`, `packages/studio/src/format/constraints.ts`, `packages/studio/src/panels/signals-panel.ts`). `icon` is carried to the studio (`StudioFormatHints`, `packages/studio/src/format/format-host.ts`) and drawn nowhere: the file tree (`fileIconName`, `packages/studio/src/files/files.ts`) and quick search (`fileIcon`, `packages/studio/src/panels/quick-search.ts`) choose glyphs by extension, so the `markdown` and `table` icons `Markdown` and `Csv` declare never appear.

The section was unmarked, and the census's first pass listed it as verified. It lists `icon` first in the hint vocabulary and says "The studio interprets this data generically", but the two surfaces that draw a glyph per file hard-code one by extension: `fileIconName` maps `md` to `file-text`, and `fileIcon` looks the format up with `formatByExtension` and still returns `file-text`. Disposition `implement`: the hint is declared, typed and delivered, and only the last step is missing.

**What exists**

- `"icon": "markdown"` in `extensions/parser/src/Markdown.class.json` and `"icon": "table"` in `extensions/parser/src/Csv.class.json`.
- `StudioFormatHints.icon` in `packages/studio/src/format/format-host.ts`, and `formatByExtension` beside it.
- The two hard-coded pickers: `fileIconName` in `packages/studio/src/files/files.ts` (a glyph key handed to `jx-icon` through `surfaces/files-panel.json`) and `fileIcon` in `packages/studio/src/panels/quick-search.ts`.
- `packages/studio/scripts/check-icons.ts` and `packages/studio/tests/icons.test.ts`, which hold the studio's own glyph keys to the kit manifest; an extension-declared key is outside what they walk.

**What is missing**

- Both pickers asking the format registry first and drawing its `$studio.icon`, falling back to today's extension map.
- A rule for an extension-declared key that the kit manifest does not name (a fallback glyph, and whether the registry build or the studio reports it), shared with `plan:extensions/settings-section-vocabulary`, which draws the §9.1 settings `icon`: whichever reaches detail first decides it, and the other requires it.
- Tests that a `.md` row in the file tree and in quick search draws `markdown`, and that an unknown key falls back.

**Related**

- extensions.md §9.1 (the settings section `icon`), extensions.md §7 (whose `mediaType` row wrongly names icons as a consumer).
- studio.md §13.5 (glyph keys versus tags).
