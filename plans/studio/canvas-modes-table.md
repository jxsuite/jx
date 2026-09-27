---
status: drafted
disposition: reconcile
claims:
  - studio.md#4.2
requires: []
workspaces:
  - specs
  - docs
  - packages/studio
size: S
---

# The Modes section names every mode a tab can be in, on the Editor and View axes Studio draws: Edit and Design, not Content

## Context

`specs/studio.md` §4.2, line 184 (the section was unmarked before the census):

> **Status: Partial.** The Content row and the paragraph on editable modes describe a mode the code does not have: the editable modes are `edit` and `design` (`CANVAS_VIEWS` in `packages/studio/src/canvas/canvas-utils.ts`), both offered to a native `.json` and a format-backed document alike and differing in stage (a centred column against the pan/zoom artboard), while `content` survives only as a `documentMode`. The table also omits Edit, Grid, Entry (`entry`, the content-entry form), Project Settings (`settings`) and the Library (`manage`), and names Diff where the mode is `git-diff`; Preview as a toggle, its scrolling and link handling, Source settling on exit, and the Media and Diff modes ship.

Re-verified against the working tree on 2026-09-27; paths under `packages/studio/src/`.

**The table (lines 186 to 194)** has seven rows: Design, Content, Stylebook, Preview, Source, Diff, Media. The line after the Diff paragraph (line 200) says "Design and Content are both editable modes … Content mode opens a format-backed document …, Design mode a native `.json` one." The section's own later paragraphs already describe the real model (line 208: "a two-value radio (`Edit │ Design`) with a pressed toggle beside it"), as do §4.3 (Edit's centred column, line 283) and §6.2 (its width).

**What the code has.** A tab's mode is one string, `session.ui.canvasMode`, drawn from `tab.capabilities.modes`:

- `inferModes` (`tabs/tab.ts`) gives a native `.json` `ALL_MODES` (`edit`, `design`, `preview`, `source`, `stylebook`, `git-diff`) and a format document its `$studio.modes` (Markdown: `edit`, `design`, `preview`, `source`, `extensions/parser/src/Markdown.class.json`). Files that are not documents get their list from their opener: `grid`/`source` for a CSV and `grid` alone for a collection, the pages, a connector table or the redirects (`grid/grid-open.ts`, `grid/redirects-grid.ts`), `manage` for the Library (`openLibraryTab`), `media` (plus `source` for `.svg`, `media/media-open.ts`), `git-diff` alone for an unrenderable changed file (`panels/git-diff-open.ts`). `openEntryEditor` (`content/entry-editor.ts`) and `showSettingsDocument` (`settings/settings-document.ts`) add `entry` and `settings` to the tab that already holds the file.
- `EDITOR_KIND_BY_MODE` (`commands/context.ts`) maps all eleven mode strings onto the Editor axis (`editor.kind`, studio.md §13.4), `CANVAS_VIEW_BY_MODE` maps the three canvas ones onto the View axis (`canvas.view`), and `EDITOR_KIND_LABELS` names each kind once for the pane context bar and the status bar. `CANVAS_VIEWS` in `canvas/canvas-utils.ts` is the View axis's value list; its `CANVAS_MODES` is `canvas.setMode`'s enum and not the full set.
- Edit and Design differ in stage only: Edit draws one column at the chosen breakpoint's width or a dragged one, with no pan and a reflowing content zoom (`canvas/canvas-render.ts`, the `canvasMode === "edit"` branch; `isContentZoom` in `editor/shortcuts.ts`); Design draws the pan/zoom artboard, one board per declared size breakpoint. Both carry the caret (`iframe-editable-root.ts` accepts either).
- `documentMode` (`content` / `component`, `splitFormatDocument` in `format/format-host.ts`, from §8.1's `$studio.documentMode`) is a separate axis stored as `tab.doc.mode`. It decides the frontmatter split and whether the Outline draws a root row (`layers-panel.ts`); it chooses no mode.

**Found while verifying, not in the stub:**

- **Project Settings has no editor kind of its own.** `settings` and `stylebook` both map to `config`, labelled "Project Styles". So with Project Settings open the status bar's DOCUMENT field reads "Project Styles" (`viewLabel` in `surfaces/statusbar.ts`, pinned by `tests/statusbar.test.ts`), which is what §16.2 ("it cannot say one thing while the pane context bar says another") exists to prevent. And for a `project.json` tab that Project Settings has opened (modes `settings`, `stylebook`, `source`), choosing **Project Styles** in the Editor control from Code lands on Project Settings, because `modeForEditorKind(tab, "config")` returns the first `config` mode, `settings`.
- The Media paragraph's "Every other mode above draws a document tree" and the Diff paragraph's "Every other mode above draws a single tree" stop being true once the table lists Grid, the Library and the forms.
- `canvas/editable-actions.ts` line 54 cites "studio.md §8.2.5" for prop-bound text, which is §8.2.6. `commands/context.ts` line 64 calls the View axis "one control, three values", which the split radio retired.
- §8's heading is "Content / Format Mode" (line 790), and `site-architecture.md` §7.3 (line 856) says Markdown files "open in **content mode** — a centered column WYSIWYG canvas". Both restate the mode that does not exist.
- The docs list seven editors and omit Media: `docs/studio/interface/modes.md` ("Those seven names come from one list") and `docs/studio/interface/tabs.md` line 143. Tabs' next line links the modes page as "Modes and views"; its title is "Editors and views".

**Editorial ride-along** (assigned here by `plans/studio/README.md`): §4.1's colour-scheme paragraph (line 172) says "the tab bar shows an Auto/Light/Dark control (one per tab; available in edit, design, and stylebook modes)"; `#tab-bar` is gone and the group is in the pane context bar's Context popover (`contextAxis` in `panels/pane-context.ts`), as `docs/studio/design/breakpoints.md` already says. §4.4's Drag handle row (line 295) cites §8.2.4 for dragging, which is §8.2.5; §8.2's intro (line 813) cites §8.2.5 for prop-bound text (§8.2.6); §8.2.1's table (lines 827 to 831) cites §8.2.2 and §8.2.3 for split, merge and range collapse (all §8.2.4) and §8.2.5 for a prop-bound host (§8.2.6). The 0.3.0 changelog entry renumbered them believing nothing referenced them.

Owned elsewhere and left alone: `studio-ui-guidelines.md` §2.1's "content mode only" face (`plan:studio-ui-guidelines/font-stacks`) and §2.2's content-mode line height (`plan:studio-ui-guidelines/chrome-type-scale`); `site-architecture.md` §7.3's last bullet (`plan:site-architecture/entry-editor-widgets`); §4.3's "tab bar's −/+/100%/Fit controls" (`plan:studio/space-drag-pan`).

## Outcome

- studio.md §4.2 → Implemented (marker removed; the section is unmarked as it was before the census). Its table lists every mode string on the two axes, one row per editor, and the editable-modes paragraph says Edit and Design differ in stage and that `content` is a `documentMode`.
- Project Settings is its own editor kind, `settings`, labelled "Project Settings"; §13.4's `editor.kind` row lists it (subject to the Open decision).
- §4.1, §4.4, §8 and §8.2's editorial drift and `site-architecture.md` §7.3's "content mode" are corrected; the two docs pages name every editor.

## Decisions

- **Decided:** reconcile, not implement: the code's split by stage rather than by document type is what §4.3, §6.2 and the docs page already describe, and nothing asks for a separate Content mode.
- **Decided:** one table whose rows are editors and whose columns are the `editor.kind` value, the mode strings and what the editor shows, covering every key of `EDITOR_KIND_BY_MODE`, rather than a table of document canvases that points elsewhere for Entry, Project Settings and the Library. The map is the one list the pane context bar, the status bar and the key scopes read, and printing it whole is what keeps a new mode from going unlisted again. Each row cites the section that specifies the editor in depth.
- **Open:** give Project Settings its own editor kind in this plan? Recommendation: yes. Add `settings` to `EditorKind` and `EDITOR_KIND_LABELS` ("Project Settings") and map the `settings` mode to it; `stylebook` keeps `config`. The key scope is unchanged, because `keyScopeStack` sends every kind other than canvas, grid and code to the global stack, so the ⌘V-into-`project.json` regression `tests/settings-key-scope.test.ts` pins stays closed. It fixes both defects under Context in about six source lines, and the rewritten table must name each editor, so leaving `settings` on `config` would mean either specifying a status bar that names the wrong editor or leaving the defect unowned. If declined, the table gives Project Settings and Project Styles one `config` row with both modes, the implementation steps on `context.ts` and the tests drop out, the docs say "eight names" without Project Settings, and the pull request description records the two defects.
- **Decided:** no gate holding the table to `EDITOR_KIND_BY_MODE`. A test reading `specs/studio.md` from the studio suite needs an `EXTRA_EDGES` entry that reruns Studio on every spec edit, and modes are added rarely, each with its own spec section. The map's comment names §4.2 as its printed form instead.
- **Decided:** rename §8 to "Document Editing and Formats", number unchanged. §8.2 applies to every editable document, not only a format-backed one, and a heading reading "Content / Format Mode" contradicts §4.2's "Content is not a mode". Docs cite `studio.md#8.x` by number, and nothing links the heading's slug (checked with grep).
- **Decided:** leave §8.2.8's position (between §8.2.1 and §8.2.2) alone. That section is claimed by `plan:studio/canvas-block-keyboard-access`, whose rewrite is the natural moment to move it.
- **Decided:** fragment levels minor for studio.md (the program's `reconcile` level; the new `editor.kind` value is additive, and no in-tree `when` predicate names `config`) and patch for site-architecture.md (one editorial sentence).

## Implementation

One pull request. Paths under `packages/studio/` unless they start with `specs/` or `docs/`.

1. **`src/commands/context.ts`** (subject to the Open decision):
   - `EditorKind` gains `| "settings"` after `"config"`.
   - `EDITOR_KIND_BY_MODE`: `settings: "settings"`. Its comment becomes: "Project Settings — `settings/settings-document.ts`'s SETTINGS_MODE. A form over `project.json`, a configuration object and not a document tree, so its key scope is the global one like every kind but canvas, grid and code (`keyScopeStack`). It is its own kind, not `config`, because a kind is also a name: sharing Project Styles' made the status bar call this editor Project Styles, and made the Editor control's Project Styles entry land here." The `stylebook: "config"` line keeps `config`.
   - `EDITOR_KIND_LABELS`: `settings: "Project Settings"`.
   - The block comment above the map ("Modes → the two axes") gains one sentence: "This map is studio.md §4.2's table, row for row; a new mode adds a row there."
   - Line 64: "The Canvas view axis — one control, three values (§4.2)." becomes "The Canvas view axis: an Edit │ Design radio and the Preview toggle composed over it (§4.2)."
   - Nothing else changes: `editorKindsOf`, `modeForEditorKind` (`tabs/tab.ts`), `viewLabel` and the pane context bar read the map, so the Editor control of a tab with all three project modes lists Project Settings, Project Styles and Code, and `modeForEditorKind(tab, "config")` answers `stylebook`. `wantsContextBar` still hides the bar in `settings` mode.
2. **`src/canvas/editable-actions.ts`** line 54: "(studio.md §8.2.5)" becomes "(studio.md §8.2.6)". Comment only.
3. **Tests** (below): update the four assertions and fixtures that pin `settings → config`, and add the Editor-control case.
4. **`specs/studio.md`, `specs/site-architecture.md`, the two fragments and the two docs pages**, as under Specs & docs; then delete this file.

**Integration contract.** No plan requires this one. Once it lands, studio.md §4.2's table is the printed form of `EDITOR_KIND_BY_MODE`: a pull request that adds a mode string adds a row. `editor.kind` has the value `settings` for Project Settings, labelled "Project Settings" by `EDITOR_KIND_LABELS`, and `config` means Project Styles alone; a `when` predicate that means "any project editor" tests both. Plans editing neighbouring text (`plan:studio/canvas-injects-context` in §4.1, `plan:studio/space-drag-pan` in §4.3, `plan:studio/canvas-block-keyboard-access` in §8.2.8, `plan:studio/file-tree-command-records` in §13.4's `capability` row) touch different lines and rebase on this text without depending on it.

## Tests

`bun test --isolate --coverage` from `packages/studio`. No source file is added and no function gains a branch (a map entry, a label and comments), so no per-file figure moves: `coverageThreshold` in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) stays, and the manifest check is unaffected.

- `tests/settings-key-scope.test.ts`, `describe("mode → editor kind")`: "the settings editor is a config editor, not a canvas" becomes "the settings editor is its own editor kind, not a canvas", asserting `editorKindForMode(SETTINGS_MODE)` is `"settings"`; the `test.each` row becomes `["settings", "settings", "design"]`. The file's scope and paste assertions do not change and must still pass: they are the regression guard for the global stack.
- `tests/commands-live-context.test.ts`, "a settings document projects as a config editor on the global stack" becomes "…as the settings editor on the global stack": `ctx.editor.kind` is `"settings"`, `keyScopeStack(ctx)` is still `["global"]`.
- `tests/statusbar.test.ts`, "every other editor kind is named by its kind": add `expect(viewLabel("settings", "design")).toBe("Project Settings")`; the `config` line keeps "Project Styles".
- `tests/settings-document.test.ts`, `describe("the configuration tab")`, new case "the Editor control offers Project Settings, Project Styles and Code, and each lands on its own editor": `showSettingsDocument("source")`; `editorKindsOf(tab)` equals `["settings", "config", "code"]`; `modeForEditorKind(tab, "config")` is `"stylebook"` (it was `"settings"`, the mislanding) and `modeForEditorKind(tab, "settings")` is `SETTINGS_MODE`.
- `tests/commands-defaults.test.ts`, "selection verbs are unavailable over a config editor, and available on a canvas": `gateFor` accepts `"settings"` and the loop asserts the refusal for both `config` and `settings`.
- Fixtures named for Project Settings switch to the new kind, assertions unchanged: `tests/agent-trace.test.ts` (`editorKind`'s type and the two "Project Settings" states), `tests/ai-command-tools.test.ts` ("with Project Settings focused" and the `config` context in the next case, which becomes `settings`), and the comment in `tests/blockbar-registry.test.ts` line 629.

If the Open decision is declined, only the specs and docs steps remain and no suite runs beyond CI's own.

## Specs & docs

`specs/studio.md`, in place:

- **§4.1**, line 172, the paragraph's first sentence becomes: "**Color-scheme preview.** When the effective `$media` declares a pure `prefers-color-scheme` query, the pane context bar's Context popover offers an Auto/Light/Dark group (§6.2, "The breakpoint and scheme axes"); the choice is the tab's, written by `canvas.setColorScheme`, and applies to every canvas frame the tab renders, Project Styles' specimens included." The rest of the paragraph is unchanged. §4.1's marker is not touched.
- **§4.2**: delete the marker (line 184). Replace the table (lines 186 to 194) with a lead paragraph and a new table:
  - Lead: "A tab shows its document in one **mode**, the `canvasMode` string on its session, and offers only the modes its document declares (`capabilities.modes`): a format's `$studio.modes` (§8.1), a fixed list for a native `.json` (`inferModes` in `packages/studio/src/tabs/tab.ts`), or its opener's list for a file that is not a document, such as a CSV, a media file or the Library. The pane context bar reads the one string as two axes (§13.4): the **editor** (`editor.kind`), whose control lists only the editors the tab offers, and for the Canvas editor alone the **view** (`canvas.view`). The mode-to-editor map (`EDITOR_KIND_BY_MODE` in `packages/studio/src/commands/context.ts`) and the editors' names (`EDITOR_KIND_LABELS`) are one list each, so the pane context bar and the status bar (§16.2) cannot name an editor two ways."
  - Table `| Editor | editor.kind | Mode | Shows |` (backticked values), nine rows: Canvas, `canvas`, "`edit`, `design`; `preview` toggles over either", "The document rendered by the runtime (§4.1). Edit and Design carry the live caret (§8.2); Preview is the fidelity view (below)". Code, `code`, `source`, "The file's text, validated against the project's schemas (§4.2.1)". Grid, `grid`, `grid`, "Rows as a table: a CSV file, a content collection, the site's pages, the redirects or a connector's table". Diff, `diff`, `git-diff`, "The document beside its committed version (§21)". Media, `media`, `media`, "An image, video, audio file, font or PDF, shown rather than edited (below)". Entry, `entry`, `entry`, "A form over one content entry's fields, typed by its collection's schema (`site-architecture.md` §7.4)". Library, `library`, `manage`, "Every page, layout, component, entry and asset in one browsable tab (§9.1.2)". Project Settings, `settings`, `settings`, "`project.json` as sections of forms (§17)". Project Styles, `config`, `stylebook`, "`project.json`'s tokens and element defaults over a specimen canvas (§7)". (Declined Open decision: one row, Project Settings and Project Styles, `config`, "`settings`, `stylebook`", with both descriptions.)
  - After the table: "**Entry and Project Settings are modes of the tab that holds their file, not tabs of their own.** Opening either adds its mode to that tab's list and switches to it (`openEntryEditor`, `showSettingsDocument`), so a form and the body it describes, or Project Settings, Project Styles and Code over `project.json`, share one history and one dirty flag, and each stays in the tab's Editor control from then on. The Library is a tab of its own, whose only mode is `manage`."
  - Media paragraph (line 196): "Every other mode above draws a document tree; there is no tree behind a PNG" becomes "The canvas views draw a document tree; there is no tree behind a PNG". Diff paragraph (line 198): "Every other mode above draws a single tree" becomes "The canvas views draw a single tree".
  - Line 200 is replaced by: "**Edit and Design are the two editable views, and they differ in stage, not in document.** Both are offered to a native `.json` and a format-backed document alike, and both carry the live caret with the same text behaviour (§8.2). Edit renders one centred column as wide as the chosen breakpoint, or as it has been dragged (§6.2), with no pan and a content zoom that reflows (§4.3); Design renders the pan/zoom artboard, one board per declared size breakpoint side by side. A tab opens in the first mode it declares other than `preview`, which is `edit` for a native `.json` and for Markdown. **Content is not a mode.** Whether a format document is content or a component is its `documentMode` (§8.1): it decides how the document splits into frontmatter and body and whether the Outline draws a root row, and it chooses no mode and no view."
  - The paragraphs from "Preview does not edit" to the end of §4.2 are unchanged.
- **§4.4**, line 295: "The ONLY canvas drag source (§8.2.4)" becomes "(§8.2.5)".
- **§8**, line 790: "## 8. Content / Format Mode" becomes "## 8. Document Editing and Formats".
- **§8.2**, line 813: "Prop-bound text inside a component (§8.2.5)" becomes "(§8.2.6)". **§8.2.1** table: "block split (§8.2.2)", "block merge (§8.2.3)" and "range collapse (§8.2.3)" each cite §8.2.4; "a prop-bound host (§8.2.5)" cites §8.2.6.
- **§13.4**, line 1407, the `editor` row: `kind` lists `settings` after `config` (declined Open decision: unchanged).
- Realign the edited tables with oxfmt. No heading is renumbered or removed.

`specs/site-architecture.md` §7.3, line 856: "Markdown files (`.md`) open in **content mode** — a centered column WYSIWYG canvas where" becomes "Markdown files (`.md`) open in the **Edit** view (`studio.md` §4.2), a centred-column WYSIWYG canvas where". The last bullet stays for its owner.

**Fragments:**

- `bun run spec:change studio.md minor -m "§4.2 lists every mode on the Editor and View axes: Edit and Design are the two editable views and differ in stage, content is a documentMode rather than a mode, and Project Settings is an editor kind of its own (§13.4); §4.1 places the colour-scheme group in the pane context bar, §8 is renamed Document Editing and Formats, and §4.4 and §8.2 cite the renumbered §8.2 subsections."`
- `bun run spec:change site-architecture.md patch -m "§7.3: a Markdown file opens in Studio's Edit view; there is no content mode."`

**Docs** (`modes.md` cites `studio.md#4.2` and lists `context.ts`, `tab.ts` and `settings-document.ts` in `code:`; `tabs.md` lists `context.ts`; no em dashes):

- `docs/studio/interface/modes.md`: the first paragraph's list becomes "**Canvas**, **Grid**, **Code**, **Diff**, **Media**, **Entry**, **Library**, **Project Settings** or **Project Styles**", and "Those seven names" becomes "Those nine names". Under "Which files offer what", the `project.json` paragraph gains: "From then on its **Editor** control offers **Project Settings** beside **Project Styles** and **Code**." (Declined: add **Media** only, "eight names", no new sentence.)
- `docs/studio/interface/tabs.md` line 143: the same list; line 144: "See [Modes and views]" becomes "See [Editors and views]".
- `docs/studio/interface/canvas.md` (cites §4.1 and §4.4) and `docs/studio/editing/writing.md` (lists `editable-actions.ts`) do not change: neither places the scheme control nor cites a §8.2.x number, and the code edit is a comment. `docs/studio/design/breakpoints.md` already puts the group in the Context popover.

studio.md does not graduate here: other studio.md items stay open, so `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 4.2 Modes/,/^#### 4.2.1/p' specs/studio.md | grep -c "Status: Partial\|^| Content\|Design and Content"` prints 0, and the section's table has nine rows (Canvas carrying `edit`, `design` and `preview`), which with the three canvas strings covers all eleven keys of `EDITOR_KIND_BY_MODE`.
- `grep -n "tab bar shows\|Content / Format Mode\|drag source (§8.2.4)\|(§8.2.5) is the exception\|split (§8.2.2)\|(§8.2.3)" specs/studio.md` and `grep -n "content mode" specs/site-architecture.md` print nothing; `grep -n "§8.2.5" packages/studio/src/canvas/editable-actions.ts` prints nothing.
- `bun run plans:status --who-claims studio.md#4.2` names no plan; `bun run plans:check --audit studio` reports nothing for §4.2.
- `ls specs/changes/` includes both fragments; `bun run spec:release --dry` mints a studio.md minor and a site-architecture.md patch.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown`, `bun run docs:prose` and `bun run docs:section-refs` pass.
- From `packages/studio`: `bun test --isolate --coverage tests/settings-key-scope.test.ts tests/commands-live-context.test.ts tests/statusbar.test.ts tests/settings-document.test.ts tests/commands-defaults.test.ts tests/agent-trace.test.ts tests/ai-command-tools.test.ts tests/blockbar-registry.test.ts` passes, and the full `bun test --isolate --coverage` keeps every file above `coverageThreshold`.
- In Studio: **Open Project Settings**; the status bar's DOCUMENT field reads "Project Settings". **Edit Global Styles**, then Editor → **Code**, then Editor → **Project Styles**: the pane shows Project Styles with its context bar, not the settings form.
