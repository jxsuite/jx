---
status: stub
disposition: reconcile
claims:
  - studio.md#4.2
size: S
---

# The Modes table names the canvas modes Studio has: Edit and Design, not Content

## Context

`specs/studio.md` §4.2, line 182 (the section was unmarked before the census):

> **Status: Partial.** The Content row and the paragraph on editable modes describe a mode the code does not have: the editable modes are `edit` and `design` (`CANVAS_VIEWS` in `packages/studio/src/canvas/canvas-utils.ts`), both offered to a native `.json` and a format-backed document alike and differing in stage (a centred column against the pan/zoom artboard), while `content` survives only as a `documentMode`. The table also omits Edit, Grid, Entry (`entry`, the content-entry form), Project Settings (`settings`) and the Library (`manage`), and names Diff where the mode is `git-diff`; Preview as a toggle, its scrolling and link handling, Source settling on exit, and the Media and Diff modes ship.

Disposition `reconcile`. The section's own later paragraphs already say `Edit │ Design` (line 206 onward), §4.3 and §6.2 describe Edit's centred column, and the code's split by stage rather than by document type is what those sections build on. Only the table and the paragraph after the Diff paragraph are stale.

**What exists**

- `CANVAS_MODES` (`edit`, `design`, `preview`, `source`, `stylebook`, `grid`, `git-diff`) and `CANVAS_VIEWS` (`edit`, `design`, `preview`) in `packages/studio/src/canvas/canvas-utils.ts`; `ALL_MODES` and format-derived modes in `packages/studio/src/tabs/tab.ts`; `EDITOR_KIND_BY_MODE` in `packages/studio/src/commands/context.ts`, which adds `entry`, `settings`, `manage` and `media`.
- `documentMode` (`content` / `component`) from a format's `$studio` block (§8.1), a separate axis.
- The Media mode (`packages/studio/src/media/media-open.ts`, `media-pane.ts`) and the Diff mode (§21).

**What is missing**

- The table rewritten to the real modes: Edit and Design as the two editable bases with Preview a toggle over them, Stylebook, Source, Grid, Diff (`git-diff`), Media, and the three form-and-browser editors that are modes of a tab rather than tabs of their own: Entry (`entry`, `ENTRY_MODE` in `packages/studio/src/content/entry-editor.ts`), Project Settings (`settings`, `SETTINGS_MODE` in `src/settings/settings-document.ts`) and the Library (`manage`, `src/grid/grid-open.ts`). `EDITOR_KIND_BY_MODE` in `src/commands/context.ts` is the full list. Alternatively the table says it covers document canvases only and points at where those three are specified (site-architecture.md §7.4, studio.md §17, studio.md §9.1.2).
- The "Design and Content are both editable modes" paragraph rewritten to say what distinguishes Edit from Design (stage, not document type), and where `documentMode` fits.
- Editorial ride-along, since this change touches the canvas sections: §4.1's colour-scheme paragraph places the Auto/Light/Dark control on "the tab bar", which `#tab-bar` no longer is; it is drawn on the pane context bar (`packages/studio/src/panels/pane-context.ts`). §4.4's "The ONLY canvas drag source (§8.2.4)" should cite §8.2.5, and §8.2's intro and §8.2.1's table cite §8.2.2, §8.2.3 and §8.2.5 one heading low since "Which tags hold a caret" was inserted as §8.2.2 (split and merge are §8.2.4, prop-bound text §8.2.6).

**Related**

- studio.md §4.3 (the modes that mount no pan/zoom surface), studio.md §6.2 (Edit's column width), studio.md §8.1 (`documentMode`), studio.md §13.4 (`canvas.view`).
