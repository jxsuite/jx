---
status: drafted
disposition: implement
claims:
  - studio.md#4.2
  - studio.md#4.5
  - studio.md#6.9
requires: []
workspaces:
  - packages/schema
  - packages/formulas
  - packages/compiler
  - packages/runtime
  - packages/studio
  - packages/server
  - extensions/parser
  - scripts
  - specs
  - docs
size: L
---

# Edit and Design draw the page's real data with every binding a named, structured tag, and Preview is removed

## Context

Three markers in `specs/studio.md`:

- §4.5, new with this plan, Partial since `LDC1.4`: "> **Status: Partial.** Bound values, bound text as chips, the three commit guards, a `$switch`'s live case, computed lists drawn as nodes, and the capability list on `ready` ship … A repeater still draws ONE row …".
- §6.9, new with this plan, Partial since `LDC1.4`: "> **Status: Partial.** The splitter, the chip on the canvas with its name and kind, and `canvas.setBindingDisplay` ship … no tag popover, `canvas.setTagPopover` or Bound pill exists.".
- §4.2, taken over from `canvas-modes-table`, which this plan replaces: "> **Status: Partial.** The Content row and the paragraph on editable modes describe a mode the code does not have: the editable modes are `edit` and `design` … Preview as a toggle, its scrolling and link handling, Source settling on exit, and the Media and Diff modes ship."

**What the editing canvas does today** (read from the code; paths under `packages/studio/src/` unless they name another workspace):

- Edit, Design and Preview already share one iframe and one `@jxsuite/runtime`. The only fork is `resolveCanvasDocument` (`canvas/canvas-live-render.ts`): Preview gets the raw document, the others get `prepareForEditMode(stripEventHandlers(doc))` (`utils/edit-display.ts`). That transform produces every symptom below.
- Bound text prints as `❪ $map.item.data.title ?? '' ❫`. Until `LDC1.1`, `templateToEditDisplay` (`utils/edit-display.ts`) split on `[^}]+`, so a lambda or an object literal containing `}` was cut at its first brace and spilled out mangled; it now reads `templateExpressions` (`packages/schema/src/guards.ts`), as the runtime's whole-template test and `editor/inline-format.ts` do, so the label is whole but is still a label.
- A repeater draws one row, and a row-bound image is a grey box (`rowBoundDisplay`, `PLACEHOLDER_IMG`, `TRANSPARENT_PX`). Until `LDC1.1` a row-bound `hidden`, `inert` or `disabled` was written as its binding text, which turned the boolean attribute on; the transform now leaves those three off (`ROW_BOUND_OMITTED`), a stopgap that goes when rows resolve for real.
- The machinery to resolve a row binding exists (`sampleRowOf`, `liveEditProp`, `bakeRepeaterSources` in `canvas/repeater-sources.ts`), but only component `$props` use it.
- Selection, patching, the caret and drop all assume one DOM element per document path, and that editable text is source text. This is the central risk of the whole plan.
- **A data-loss hole shipped until `LDC1.1`.** A `"${…}"` string inside a `children` array already renders resolved in Edit, and leaving the caret in that block committed the resolved text over the template (`editor/inline-edit.ts`, `editor/inline-edit-apply.ts`). `LDC1.1` refuses that write: `dropsMemberBinding` (`editor/inline-edit-apply.ts`) is asked by `applyInlineCommit`, `applyInlineSplit`, `applyInlineInsert` and `applyRangeReplace`, and `onCommitRefused` (`canvas/iframe-host.ts`) redraws the block from the document and tells the author. It is recorded in studio.md §8.2.7. It counts only bindings held by string members of `children`; `applyBlockMerge` joins stored content and is not checked. The full third guard (any binding the stored value held, with the chip-deletion exemption) needs chips and arrives in `LDC1.4`.
- A string child that resolves to an array is spliced by the build (`packages/compiler/src/site/site-build.ts`) and rendered as text by the runtime (`packages/runtime/src/runtime.ts`), so a converted site's computed lists cannot draw in Studio in any mode.
- A `$switch` in Edit rendered an empty container until `LDC1.4`: the transform moved the first case to `children` and dropped `cases`, and `renderSwitch` (`packages/runtime/src/runtime.ts`) reads `cases` alone, so it found no case for any key. Verified by reading both; `LDC1.4` passes `$switch` and `cases` through, and the live case is stamped at `[…, "cases", key]`. `renderSwitch` only reads a `{ "$ref" }` discriminant, so a `$switch` written as a template draws an empty container in every mode, the build aside; that is the runtime's and is not changed here.

The comparison that set the bar is Cwicly, which renders the queried data on the editing canvas and shows an inline tag as a named chip with a parameter popover only while its block is being edited.

**What §4.2 says against the code** (carried from `canvas-modes-table`, re-verified 2026-11-11):

- §4.2's table has eight rows: Design, Content, Stylebook, Preview, Source, Diff, Media, Image. The paragraph after the Diff paragraph says "Design and Content are both **editable modes** … Content mode opens a format-backed document …, Design mode a native `.json` one." The section's later paragraphs already describe the real model ("a two-value radio (`Edit │ Design`) with a pressed toggle beside it"), as do §4.3 and §6.2.
- A tab's mode is one string, `session.ui.canvasMode`, drawn from `tab.capabilities.modes`. `inferModes` (`tabs/tab.ts`) gives a native `.json` `ALL_MODES` (`edit`, `design`, `preview`, `source`, `stylebook`, `git-diff`), and a format document its `$studio.modes` (Markdown: `edit`, `design`, `preview`, `source`, in `extensions/parser/src/Markdown.class.json`). Files that are not documents get their list from their opener: `grid` and `source` for a CSV and `grid` alone for a collection, the pages, a connector table or the redirects (`grid/grid-open.ts`, `grid/redirects-grid.ts`), `media` (plus `source` for an `.svg`, `media/media-open.ts`), and `git-diff` alone for an unrenderable changed file (`panels/git-diff-open.ts`). `openEntryEditor` (`content/entry-editor.ts`) adds `entry` to the tab that already holds the file. Re-check each against the tree in `LDC1.9`; they were last verified for the plan this one replaced.
- `EDITOR_KIND_BY_MODE` (`commands/context.ts`) maps fifteen mode strings onto the Editor axis: `design`, `edit` and `preview` to `canvas`; `source` to `code`; `grid`; `git-diff` to `diff`; `media`; `image`; `entry`; `content-home`, `media-home`, `publish-home` and `settings-home` to `home`; `stylebook` to `config` (labelled "Elements"); `tokens` (labelled "Variables"). `CANVAS_VIEW_BY_MODE` maps the three canvas ones onto the View axis, and `EDITOR_KIND_LABELS` names each kind once. `CANVAS_VIEWS` in `canvas/canvas-utils.ts` is the View axis's value list; its `CANVAS_MODES` is `canvas.setMode`'s enum and not the full set.
- Edit and Design differ in stage only: Edit draws one column at the chosen breakpoint's width or a dragged one, with no pan and a reflowing content zoom; Design draws the pan/zoom artboard. Both carry the caret (`canvas/iframe-editable-root.ts` accepts either).
- `documentMode` (`content` / `component`, from §8.1's `$studio.documentMode`) is a separate axis stored as `tab.doc.mode`. It decides the frontmatter split and whether the Outline draws a root row; it chooses no mode.

**Found while verifying §4.2, carried from `canvas-modes-table`:**

- The Media paragraph's "Every other mode above draws a document tree" and the Diff paragraph's "Every other mode above draws a single tree" stop being true once the table lists Grid, the homes and the forms.
- `canvas/editable-actions.ts` line 54 cites "studio.md §8.2.5" for prop-bound text, which is §8.2.6. `commands/context.ts` line 79 calls the View axis "one control, three values", which the split radio retired and Preview's removal retires again.
- §8's heading is "Content / Format Mode", and `site-architecture.md` §7.3 says Markdown files "open in **content mode** — a centered column WYSIWYG canvas". Both restate the mode that does not exist.
- `docs/studio/interface/modes.md` ("Those nine names come from one list"), `docs/studio/interface/tabs.md` and `docs/studio/interface.md` list the editors; re-read all three against the final table.
- The Project Settings defect `canvas-modes-table` found (the `settings` mode sharing the `config` kind with Project Styles, so the status bar named the wrong editor) no longer reproduces as written: there is no `settings` or `manage` mode at the current tree, Settings is the `settings-home` workspace home, and `config` is labelled "Elements". See the Open decision.

**Editorial ride-along** (assigned to the owner of §4.2 by `plans/studio/README.md`):

- §4.1's colour-scheme paragraph says "the tab bar shows an Auto/Light/Dark control (one per tab; available in edit, design, and stylebook modes)"; `#tab-bar` is gone and the group is in the pane context bar's Context popover (`contextAxis` in `panels/pane-context.ts`), as `docs/studio/design/breakpoints.md` already says.
- §4.4's Drag handle row cites §8.2.4 for dragging, which is §8.2.5.
- §8.2's intro cites §8.2.5 for prop-bound text (§8.2.6).
- §8.2.1's table cites §8.2.2 and §8.2.3 for split, merge and range collapse (all §8.2.4) and §8.2.5 for a prop-bound host (§8.2.6). The 0.3.0 changelog entry renumbered them believing nothing referenced them.
- §13.4's `editor.kind` row, should the Open decision add a kind.

Owned elsewhere and left alone: `studio-ui-guidelines.md` §2.1's "content mode only" face (`plan:studio-ui-guidelines/font-stacks`) and §2.2's content-mode line height (`plan:studio-ui-guidelines/chrome-type-scale`); `site-architecture.md` §7.3's last bullet (`plan:site-architecture/entry-editor-widgets`); §4.3's "tab bar's −/+/100%/Fit controls" (`plan:studio/space-drag-pan`); §4.1's marker and its page-context paragraphs (`plan:studio/canvas-injects-context`).

## Outcome

- studio.md §4.5 → Implemented, at `LDC1.8`: Edit and Design resolve every binding; bound text is segments and chips; a repeater draws real rows with one active row; no commit can write a resolved value; remote data is fetched once and cached; a state value can be set for the session; Open in Browser runs pages, components and layouts.
- studio.md §6.9 → Implemented, at `LDC1.7`: the tag grammar with lossless parse and print, the Custom expression fallback, the tag popover, Bound pills, the insert control, the binding-display setter and the packaged format formulas.
- studio.md §4.2 → Implemented (marker removed), at `LDC1.9`: Preview is gone from the code and from the spec; the table lists every mode string on the Editor and View axes; "Content is not a mode".
- §4.1's binding paragraphs become pointers to §4.5 while its Partial marker stays with `plan:studio/canvas-injects-context`. §4.4, §8, §8.2 and §8.2.1's editorial drift and `site-architecture.md` §7.3's "content mode" are corrected.
- An empty mapped list builds static (`LDC1.10`), and the wp2jx converter emits tags the popover can open (`LDC1.11`, in its own repository).
- studio.md stays draft; nothing graduates.

## Decisions

Taken with the user before any code:

| Question                            | Decision                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Preview                             | **Removed entirely.**                                                                         |
| Repeaters                           | All rows render; any row is editable; edits apply to the template.                            |
| Request and `timing: "server"` data | Fetch once per document open, cache for the session, Data panel Refresh re-fetches.           |
| Scope                               | Canvas, the structured tag model and wp2jx, then re-convert the Anabaptist Perspectives site. |
| Running a component without Preview | Both: Open in Browser accepts components and layouts, and a canvas state-value setter.        |

- **Decided:** the transform stays, and emits bindings instead of labels. `prepareForEditMode` remains the single parent-side seam (handlers stay stripped, de-linking stays), and the iframe runtime resolves everything against real scope, because a second resolver in the parent realm is how the canvas and the build would come to differ.
- **Decided:** a chip is a `<data>` element, not a `<span>`, because `span` is in `FORMAT_TAGS` and `normalizeInlineContent` would merge adjacent chips (`editor/inline-format.ts`).
- **Decided:** exactly one row per repeater carries `data-jx-path`; the others carry an echo attribute. Stamping every row would break every first-match lookup in selection, patching, the caret and drop, and rewriting all of them to be row-aware is a larger and riskier change than keeping paths unique.
- **Decided:** three independent commit guards rather than one, each with a named test, because the failure they prevent is silent data loss in the author's source.
- **Decided:** templates stay JavaScript (the binding owner decision in `plan:spec/jx-typechecking`), so the tag model is a recognised subset with a Custom fallback, not a template language. `||` and `!` are in the grammar because about 80 of the converted site's 267 bindings use them.
- **Decided:** the tag splitter is `templateExpressions` (`packages/schema/src/guards.ts`), built on the scanner `maskCode` uses, the only quote-aware one; the three brace-only scanners (the runtime's whole-template test, `findTemplateExpressions` in `editor/inline-format.ts`, and the one in `utils/edit-display.ts`) are replaced by it. Done in `LDC1.1`.
- **Decided:** new frame messages ride a capability list on `ready`, because unknown message kinds are dropped silently and the prebuilt frame bundle can skew from the host.
- **Decided:** every new control is a setter (`canvas.setTagPopover`, `canvas.setBindingDisplay`, `canvas.setActiveRow`, `canvas.setRepeaterRows`, `canvas.setSwitchCase`, `canvas.setStateValue`), never a `toggle*`, per studio.md §13.5 and the screenshot contract.
- **Decided:** live data ships before Preview goes. `LDC1.9` lands only after `LDC1.4` to `LDC1.8` make Edit sufficient.
- **Decided:** no storage migration for Preview's removal. `inferModes` filters a declared `"preview"` rather than failing, so a third-party format class that still lists it keeps loading.
- **Decided:** `requires` is empty. `plan:studio/canvas-injects-context` owns §4.1's marker and edits the same function (`resolveCanvasDocument`), but neither needs the other's code; whichever lands second rebases. The plans listed under Specs & docs are amended, not waited for.
- **Decided** (carried from `canvas-modes-table`): §4.2 gets one table whose rows are editors and whose columns are the `editor.kind` value, the mode strings and what the editor shows, covering every key of `EDITOR_KIND_BY_MODE`, rather than a table of document canvases that points elsewhere. The map is the one list the pane context bar, the status bar and the key scopes read, and printing it whole is what keeps a new mode from going unlisted again. Each row cites the section that specifies the editor in depth.
- **Decided** (carried): no gate holding the table to `EDITOR_KIND_BY_MODE`. A test reading `specs/studio.md` from the studio suite needs an `EXTRA_EDGES` entry that reruns Studio on every spec edit, and modes are added rarely. The map's comment names §4.2 as its printed form instead.
- **Decided** (carried): rename §8 to "Document Editing and Formats", number unchanged. §8.2 applies to every editable document, and a heading reading "Content / Format Mode" contradicts §4.2's "Content is not a mode". Docs cite `studio.md#8.x` by number, and nothing links the heading's slug; re-check with grep at landing.
- **Decided** (carried): leave §8.2.8's position (between §8.2.1 and §8.2.2) alone. That section is claimed by `plan:studio/canvas-block-keyboard-access`, whose rewrite is the natural moment to move it.
- **Decided** (carried, changed): `canvas-modes-table` was a `reconcile` with a minor fragment. Under this plan §4.2's closing change removes a documented mode, so its studio.md fragment is major; `site-architecture.md` §7.3's sentence stays a patch.
- **Open** (carried from `canvas-modes-table`): give Project Settings its own editor kind? That plan recommended adding `settings` to `EditorKind` so the status bar stopped calling Project Settings "Project Styles". At the current tree the `settings` and `manage` modes no longer exist, Settings is the `settings-home` home, and `config` is labelled "Elements", so the defect as written is gone. Recommendation: close as overtaken, add no kind, and have `LDC1.9` verify in Studio that the status bar's DOCUMENT field names each editor as the pane context bar does. If a mismatch is found, it is fixed in `LDC1.9` with the §13.4 `editor.kind` row and the test list that plan carried (`tests/settings-key-scope.test.ts`, `tests/commands-live-context.test.ts`, `tests/shell-misc-diff-gaps.test.ts`, `tests/statusbar.test.ts`, `tests/settings-document.test.ts`, `tests/commands-defaults.test.ts`).
- **Open:** the plan is deleted by the change that closes its last claim, which is `LDC1.9`, yet `LDC1.11` is in another repository and waits on a published release. Recommendation: `LDC1.10` lands before `LDC1.9`, and `LDC1.11`'s checklist is copied into a wp2jx issue before this file is deleted, so nothing here outlives its last claim.
- **Decided** (was open; settled in the browser pass of `LDC1.4`, Chromium, on the converted site's `pages/dev-episodes.json`, whose episode heading is one chip and nothing else): no guard node. With the selection set to the block element at offset 0 or 1 (before or after its only chip), Chromium draws the caret at that edge, typed text lands on that side as a new text node, and the idle commit keeps the caret where it was. So a chip at a block's edge needs no zero-width node, and the serializer has nothing to drop. What Chromium does not do is put the caret there from a click, because a press on the chip itself lands on content closed to the caret; the editing host therefore moves the caret across a chip itself on Left and Right (`canvas/iframe-editable-root.ts`), and Backspace or Delete beside a chip removes it there too, so neither depends on the engine. Not checked: Firefox and WebKit, where the same positions may draw differently; the guard node stays the fallback if a host engine needs it.

- **Decided** (review of `LDC1.4`): where a chip stands is part of what it stands for. A string member of `children` that is one whole `${…}` is the only string whose value may be nodes, so its chip is marked a member (`data-jx-tag-member`), the serializer writes it as a member of its own, and stored content is joined only where the join changes nothing a string means (`normalizeContent` in `editor/content-slice.ts`). Every other chip interpolates, as the string it came from does. The third guard counts a binding where it stands (text, a property of an inline child, a `{ "$ref" }`, a whole member), and is asked of the blocks a merge or a range writes, not of the content read from them. Neither direction is tolerated (second review of `LDC1.4`): a printed whole `${…}` (a `textContent`, or one cut out of a longer string) is carried through a slice and a join marked `Printed`, joins to the text beside it, and is refused where it would have to stand as a member (`storePieces` in `editor/content-slice.ts`, the `alone` reason of `bindingRefusal`). A member is allowed only for a copy of a binding the write adds.
- **Decided** (review of `LDC1.4`): text typed into a template is escaped (a backslash, a backtick), a whole `${…}` typed as text stays a binding and is drawn as a chip at its next commit, and an open `${` is left alone as a binding still being typed. A block stored differently from how it is shown is committed out of place so the frame draws it again.
- **Decided** (review of `LDC1.4`): an element closed to the caret is one unit ONE position long on the canvas and in stored content alike (`isAtom` in `canvas/iframe-position.ts`, `isAtomicInline` in `editor/content-slice.ts`). It was first counted as nothing, which made the position before it and the one after it the same offset, so a cross-block delete that began after a `{ "$ref" }` inline deleted it; the second review of `LDC1.4` made it one. A structural patch under a parent whose own text is bound throws and escalates, the same shape as `LDC1.5`'s `structure-beside-repeater`, but frame-side.
- **Decided** (second review of `LDC1.4`): the canvas cannot be read back for anything an inline element holds but its content, so the frame stamps the rest of its node on it (`data-jx-keep`, `editor/kept-node.ts`) after a render and after a patch, and the serializer writes that back; an element closed to the caret carries its whole node. A literal run of a template is written as the text it shows once its string holds no `${` (`unescapeTemplateText`). A link is a block to the caret and part of its paragraph to a merge and a range (`isInlineOfBlock`), and neither removes a block that is no member of a `children` array. A whole render releases a session that holds nothing new instead of committing it, and undo flushes the caret first.
- **Open** (review of `LDC1.4`): the bound-block label is the block's own `::before`, so an author's `::before` (an icon, a quote mark) is replaced while the block is hovered or holds the caret, and an image gets no label. Recommendation: `LDC1.7` draws the label in the host's overlay beside the Bound pills and the canvas keeps the outline alone.
- **Open** (review of `LDC1.4`): `canvas.setBindingDisplay` takes `pane` and `display`, and the command palette prompts only for a command with one argument (`paletteArgs` in `panels/quick-search.ts`), so the names display has no surface until `LDC1.7` gives it one; the docs do not name it until then. Recommendation: `LDC1.7` adds the control to the pane context bar's Context popover, where `canvas.setColorScheme` already has one.
- **Open** (review of `LDC1.4`): a template in which one expression throws draws nothing on the page (the whole template fails) and on the canvas draws its literal runs with that chip empty and named. Recommendation: keep, since the alternative is a block with nothing to select or edit; `LDC1.6`'s `bindingStatus` is where the failure is reported.

## Implementation

Eleven slices, each one pull request, green alone, tests in the same change. Paths are under `packages/studio/src/` unless they name another workspace.

### Design

**1. Rendering: the transform emits bindings instead of labels.**

- **Text becomes segments.** A template `textContent` renders as literal text nodes plus one chip per `${…}`. A chip is a `data` element carrying `data-jx-tag` (the verbatim `${…}`), `data-jx-tag-label`, `data-jx-tag-kind` (`field`, `format`, `custom` or `ref`) and `contenteditable="false"`, whose child is the live template. A `{ "$ref" }` text is one chip of kind `ref`. A templated string member of a `children` array becomes exactly one node so sibling indices hold.
- **Chips are never stamped** with `data-jx-path` (the existing `drawn` rule in `makeStamper`, `canvas/iframe-render.ts`).
- **Row-bound attributes, `src`, `innerHTML` and styles resolve live.** `rowBoundDisplay`, `PLACEHOLDER_IMG` and `TRANSPARENT_PX` go; an image placeholder draws only for a missing or failed `src`. A failing attribute binding yields `null`, so `hidden` is removed, not stuck.
- **`$switch` and `cases` pass through**; the live case renders at `[...P, "cases", key]`.
- **Computed children and array-valued string children** render live, closed to the caret, unstamped, badged "Computed list"; a click selects the host.
- Deleted: `templateToEditDisplay`, `restoreTemplateExpressions`, `textDisplayValue`, `arrayToPerimeter`, `sampleRowOf` and `sampleRowAt`, `liveEditProp`, the first-case stand-in.

**2. Repeaters: real rows, one active row.** The Array node passes through to `renderMappedArrayInto`, which renders rows at `[...P, "map", i, …]` and hands each node its row scope as `onNodeCreated`'s fourth argument.

- `classifyRenderNode` (`canvas/path-mapping.ts`) strips row indices: document path `[...P, "map", …]` plus `rows: number[]`. `arrayPaths` and the `children, 0 → map` collapse are removed.
- Exactly one row per repeater, the active row (default 0), carries `data-jx-path`. Other rows carry `data-jx-echo-path` and `contenteditable="false"`. Every existing first-match lookup therefore stays unique.
- A pointerdown in an echo row ends any edit session, promotes that row by renaming attributes on the two subtrees, then posts the ordinary `hit`. Active rows live in frame state keyed by array path and survive renders.
- The stamper keeps a `WeakMap` from element to `JxScope`. `replaceSubtree` and `patchStyle` iterate `instancesOf(path)` and render each with its own row scope, fixing two verified defects (page scope used for rows; only the first match patched).
- Required companions, each verified as necessary: the runtime's `canvasStamped` (`packages/runtime/src/runtime.ts`) also honours the echo attribute, or echo rows keep live popovers and dialogs; `remapChildPaths` and `rewriteSubtreePathPrefix` rewrite echo attributes too; `onNodeMoved` is wired so moved rows restamp; the repeater node has no element, so `measureHits` answers its path with the union rect of its row roots; `containerVerdict` gains `structure-beside-repeater` (any structural op whose parent has an Array or array-valued string child escalates to a full render), because `domChildReference` indexes DOM children and would otherwise insert at the wrong position silently; drop and insert zones retarget a row root to the repeater's parent slot.
- **Empty or unresolvable list:** one template row from a schema-derived sample item, badged "No items: showing the template". Row cap 24 with a rows control.

**3. A commit can never write a resolved value.** Three independent guards:

1. Resolved values exist only inside `contenteditable="false"` elements.
2. `domNodeToJx` (`editor/inline-edit.ts`) gets a first branch: an element with `data-jx-tag` serializes to that attribute verbatim, never its text. Chips are exempt from `mergeAdjacentSiblings`, `collapseRedundantNesting` and `removeEmptyInlines`.
3. `applyInlineCommit`, `applyRangeReplace` and `applyBlockMerge` (`editor/inline-edit-apply.ts`) refuse a commit that drops a binding the stored value had, unless the session reported a chip deletion.

**4. Affordances.**

- **At rest:** plain resolved text, no decoration.
- **Caret in the block:** each tag shows as a chip named by a human label ("Post date"), atomic to arrows, Backspace and cut.
- **Bound block on hover or selection:** dotted outline and label; the always-on purple entry badge becomes hover and selection only. The block action bar gains one **Bound** pill per bound property ("Image: Featured image").
- **Tag popover:** a new surface `surfaces/dynamic-tag.json` and its adapter, `@jxsuite/ui` elements only, opened by a setter command. Fields: Source (the existing From data picker: `repeaterItemFields`, `buildMergeTags`, the value-source ladder), Format presets rendered with the real value, Fallback, a "Now:" line with the value or the error, and Advanced holding the raw expression.
- **The insert control** in the format bar inserts a chip, replacing `insertTemplateToken`'s raw text.
- **Inspector:** the "Mixed text" rung shows the same chip strip with resolved values.
- **Unparseable JavaScript** is a "Custom expression" chip; raw code never draws on the canvas.
- **Setters:** `canvas.setTagPopover`, `canvas.setBindingDisplay` (`values` or `names`), `canvas.setActiveRow`, `canvas.setRepeaterRows`, `canvas.setSwitchCase`, `canvas.setStateValue`.
- **Frame messages:** `tagClick`, `rowActivated`, `bindingStatus`, `evalTemplate` and `templateResult`, announced in a capability list on `ready`.

**5. Structured tag model**, in a new `packages/schema/src/dynamic-tag.ts`:

```text
tag   := "!"{0,2} pipe ( ("??" | "||") literal )?
pipe  := "state." ident "(" pipe ("," json)* ")" | path
path  := root ( "." ident | "?." ident | "[" json "]" )*
```

- `parseDynamicTag` and `printDynamicTag`; reading never normalises; anything else is Custom.
- As built (`LDC1.2`), the grammar is wider than the three lines above in three ways and narrower in none: `root` is `state`, `item`, `index`, `$map`, `$page` or `$site` (the runtime's `TEMPLATE_PARAMS`); a bracket step may be optional (`?.[key]`) and its key is a string or a number; a literal is a JSON value or a single-quoted string with JSON's escapes, because the converted site writes `''` for every fallback. White space is accepted around the tag, around the fallback operator, around argument commas and inside the parentheses, and the printer writes one canonical form, so a tag with other spacing parses and would be respaced if printed: a writer keeps `templateSegments`' verbatim `source` for a tag it did not edit. A literal carries the text it was written as (`raw`) and prints from it. Also exported: `templateSegments`, `dynamicTagLabel`, `dynamicTagKind`, `dynamicTagPath`, `dynamicTagLiteral`, `humanizeIdentifier`.
- Measured on the Anabaptist Perspectives site as committed: 105 of 240 bindings in `pages/` and `layouts/` are structured tags (31 of 90 distinct expressions), all round-tripping byte for byte. The rest are `||` chains of paths, parenthesised fallbacks, lambdas and ternaries, which `LDC1.11` is what reduces.
- `relativeTime(value, unit)` takes a signed count of units, not a date: a formula is pure, and the distance from now is not a function of its arguments.
- New packaged formulas in `packages/formulas/formulas/`: `formatDate` (guards empty input; `Intl/formatDate` with a null locale so the page locale applies), `formatNumber`, `relativeTime`, `notEmpty`, `orBlank`, `escapeHtml`. `formula.json` parameters gain JSON Schema `type` objects so the popover derives widgets; `toParameterInfo` reads them; fix `namedFormulaEntries` reading `description` instead of `$description`.
- **Compiler:** a pure named formula in page state must not make the page dynamic (`isDynamic` in `packages/compiler/src/shared.ts`, and the strip pass in `packages/compiler/src/site/site-build.ts`), or one date tag turns a static page into a client page. As built: the formula is dropped in the strip pass's existing fixpoint when no surviving reader names it, page-declared or inherited, and kept while a `$src` module survives; `isDynamic` skips a pure formula unless the node still reads it. `referencesStateKey` moved to `shared.ts` and now ends a key with a lookahead, since a key ending in `$` was missed before a call's parenthesis.

**6. Remote data.** The first render of a document and Data panel Refresh run `GET` `Request` entries and `timing: "server"` functions once (`stripEventHandlers` stops dropping server entries; `setSkipServerFunctions` gains the same arming as `allowAutoRequests`). Results are cached per session keyed by the entry definition and substituted on later renders. A non-`GET` request never auto-fires and reads "Runs on the live page". `repeaterSourceKeys` widens to collections read by computed children. A host without `resolveClass` (cloud) shows template rows and one notice.

**7. Running things without Preview.** `view.openInBrowser` accepts components and layouts: `packages/server/src/live-preview.ts` renders the document alone on a harness route with the tab's test props (the target resolution in `surfaces/commandbar.ts` is extended). `canvas.setStateValue` (`{ key, value }`, `null` to clear) plus a Data panel control overrides a state value on the canvas for the session.

**8. Preview removal.** Delete `ui.preview`, the toggle, `"preview"` from both `CANVAS_MODES` lists, `PREVIEW_BLOCKED`, `setHostPreview`, `syncPreviewShell`, the preview stage, `previewNavigate` and the `GLOBAL_STACK` branch. Keep `preview-navigate.ts`'s `openUrlExternally` and `setPreviewNavigateHandler`, which `packages/desktop` imports. `inferModes` filters a declared `"preview"`; `extensions/parser/src/Markdown.class.json` drops it. Unrelated "preview" names (`previewParams`, the entry-preview bar, italic preview tabs, the publish environment) are untouched.

**9. The modes table** (carried from `canvas-modes-table`, in `LDC1.9`). In `commands/context.ts`: the block comment above `EDITOR_KIND_BY_MODE` gains "This map is studio.md §4.2's table, row for row; a new mode adds a row there."; the comment "The Canvas view axis — one control, three values (§4.2)." becomes "The Canvas view axis: an Edit │ Design radio (§4.2)."; the `["preview", "canvas"]` and `CANVAS_VIEW_BY_MODE` preview entries go. In `canvas/editable-actions.ts` line 54, "(studio.md §8.2.5)" becomes "(studio.md §8.2.6)".

### Slice by slice

| Slice   | Main files                                                                                                                                                                                                                                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LDC1.1  | `packages/schema/src/guards.ts`, `packages/runtime/src/runtime.ts`, `utils/edit-display.ts`, `editor/inline-format.ts`, `editor/inline-edit-apply.ts`, `canvas/iframe-host.ts`                                                                                                                                 |
| LDC1.2  | `packages/schema/src/dynamic-tag.ts`, `packages/formulas`, `packages/compiler/src/shared.ts`, `packages/compiler/src/site/site-build.ts`, `ui/formula-catalog.ts`                                                                                                                                              |
| LDC1.3  | `packages/runtime/src/runtime.ts`, `packages/runtime/src/types.ts`                                                                                                                                                                                                                                             |
| LDC1.4  | `utils/edit-display.ts`, `canvas/iframe-render.ts`, `canvas/iframe-patch.ts`, `canvas/iframe-inline-edit.ts`, `editor/inline-edit.ts`, `editor/inline-format.ts`                                                                                                                                               |
| LDC1.5  | `canvas/path-mapping.ts`, `canvas/iframe-render.ts`, `canvas/iframe-patch.ts`, `canvas/iframe-subtree.ts`, `canvas/iframe-interaction.ts`, `canvas/iframe-drop.ts`, `canvas/iframe-insert.ts`, `canvas/canvas-patcher.ts`, `canvas/canvas-live-render.ts`, `editor/repeater-scope.ts`, `canvas/iframe-eval.ts` |
| LDC1.6  | `canvas/iframe-render.ts`, `canvas/iframe-entry.ts`, `utils/strip-events.ts`, `canvas/repeater-sources.ts`                                                                                                                                                                                                     |
| LDC1.7  | `surfaces/dynamic-tag.json` and its adapter, `panels/block-action-bar.ts`, `panels/properties-panel.ts`, `editor/inline-link.ts`, `canvas/iframe-protocol.ts`                                                                                                                                                  |
| LDC1.8  | `packages/server/src/live-preview.ts`, `surfaces/commandbar.ts`, `panels/signals-panel.ts`, `canvas/canvas-utils.ts`                                                                                                                                                                                           |
| LDC1.9  | `tabs/tab.ts`, `canvas/canvas-utils.ts`, `canvas/canvas-surface.ts`, `canvas/iframe-host.ts`, `canvas/iframe-interaction.ts`, `panels/pane-context.ts`, `surfaces/pane-context.json`, `commands/context.ts`, `extensions/parser/src/Markdown.class.json`, `scripts/screenshots/manifest.json`                  |
| LDC1.10 | `packages/compiler/src/site/site-build.ts`, `specs/spec.md` §10                                                                                                                                                                                                                                                |
| LDC1.11 | In the wp2jx repository: `src/cwicly/tokens.ts`, `src/cwicly/blocks/data.ts`, `src/emit/project.ts`                                                                                                                                                                                                            |

`LDC1.9` is wide but mechanical: about 60 test blocks deleted and 35 rewritten across 35 files, 22 shots migrated (16 `open.view` to `edit`, 6 `setMode` steps to `edit` or `design`), and the tutorials rewritten.

`LDC1.11` is outside this repository. wp2jx is a separate repository and cannot be a `workspaces` entry; it can only use published `@jxsuite/*`, so it waits for a release that carries `LDC1.2` and `LDC1.10`. It emits `state.formatDate(…)` through its existing `INTL_FORMATS` table, `notEmpty`, `orBlank` and `escapeHtml` calls, native Arrays where `LDC1.10` allows, and excerpts and other per-entry values precomputed at conversion; it updates its `docs/bindings.md` and pinned tests, and re-converts the Anabaptist Perspectives site from HEAD (the committed output predates the slider and multi-type collections). Still opaque afterwards, by design: route-dependent and entry-dependent lists, regular-expression lists, term-link HTML, ternaries, and PHP date formats `Intl` cannot write. They show as Custom expression chips with live values.

**Integration contract.** Once `LDC1.5` lands, a document path under a repeater names every row's instance and `data-jx-path` is unique in the frame; a plan that adds a path lookup may keep taking the first match, and one that patches under `map` iterates `instancesOf(path)`. Once `LDC1.4` lands, no code may read a canvas element's text as source without going through `domNodeToJx`. Once `LDC1.9` lands, `canvas.view` has two values, `CANVAS_VIEWS` is `["edit", "design"]`, and no `when` predicate may name `preview`; studio.md §4.2's table is the printed form of `EDITOR_KIND_BY_MODE`, and a pull request that adds a mode string adds a row. Plans editing neighbouring text (`plan:studio/canvas-injects-context` in §4.1, `plan:studio/space-drag-pan` in §4.3, `plan:studio/canvas-block-keyboard-access` in §8.2.8, `plan:studio/file-tree-command-records` in §13.4's `capability` row) touch different lines and rebase on this text without depending on it.

## Tests

Per slice: `bun test --isolate --coverage` from each touched workspace, against that workspace's per-file `coverageThreshold`, then `bun scripts/check-coverage-manifest.ts <workspace>` for every workspace that gains a source file (`packages/schema` for `dynamic-tag.ts`, `packages/formulas`, `packages/studio` for the tag popover adapter). Raise a threshold only if the run shows the workspace's worst file rose.

- **`LDC1.1`:** the splitter keeps an object-literal argument and a string containing `}` whole (`packages/schema/tests`); `applyInlineCommit`, `applyInlineSplit`, `applyInlineInsert` and `applyRangeReplace` each refuse a write that loses a binding a string member of `children` holds, leave the document untouched and call `onRefused`, and a write that keeps every such binding goes through (`packages/studio/tests/inline-edit-apply.test.ts`); the refused block is redrawn once and not in a loop (`needsRefusalRedraw`, `packages/studio/tests/iframe-host.test.ts`); a row-bound `hidden`, `inert` or `disabled` is left off, as an attribute and as a property (`packages/studio/tests/edit-display-gaps.test.ts`).
- **`LDC1.2`:** round-trip property test, `printDynamicTag(parseDynamicTag(s)) === s` for every accepted `s`, and Custom for everything else; one test per formula including `formatDate` on empty input; a page whose state holds only a pure named formula is not dynamic (`packages/compiler/tests`).
- **`LDC1.3`:** a parity fixture in `packages/runtime/tests/spliced-children.test.ts`: the source document through `renderNode` yields the same markup as a hand-written copy of what the build's template pass leaves, for array-valued string children (elements, mixed members, an empty array, a value that is not an array). It is hand-written because `resolveDocTemplates` is private to `packages/compiler` and the compiler depends on the runtime, not the reverse; a fixture that runs both sides belongs in `packages/compiler/tests`. Empty lists are `LDC1.10`'s, which changes the build. `canvasStamped` honours the echo attribute (`runtime-canvas.test.ts`); the row cap, the empty row and `onListReconciled` are in `list-authoring-hooks.test.ts`. A spliced element is reported to `onNodeCreated` at `[…, "children", i, j]`: the string's index, then its place in the array. Only a string that is one whole `${…}` can splice; the anchor is the string's own Text node, left empty while the nodes stand before it.
- **`LDC1.4`:** the named test for each guard, the third now refusing any dropped binding (a templated `textContent` and a block merge included) unless the session reported the chip's deletion; the property test `serialize(render(prepare(t))) === t` for arbitrary templates with scope values that differ from the source; chips are unstamped; a `$switch` renders its live case at its `cases` path.
- **`LDC1.5`:** a fixture from the converted site's `pages/dev-episodes.json` repeater: three rows resolve, one path element per document path, a `set-key` on a `map` path updates every row, a commit to a bound node is refused, the date tag with an object-literal argument renders intact. No duplicate `data-jx-path` after render, after a patch and after a promotion. `structure-beside-repeater` escalates.
- **`LDC1.6`:** a `GET` request fires once across two full renders and again on Refresh; a non-`GET` never fires; a host without `resolveClass` posts one notice.
- **`LDC1.7`:** the popover surface against a mocked implementation (double the lazily imported adapter with `mock.module()`); Bound pills per bound property; the insert control writes a chip; each setter is idempotent.
- **`LDC1.8`:** `live-preview.ts` serves a component and a layout on the harness route with test props; `canvas.setStateValue` sets and clears.
- **`LDC1.9`:** the Preview test blocks deleted or rewritten; `inferModes` filters a declared `"preview"`; `bun scripts/check-shot-contract.ts` passes on the migrated manifest; the carried `canvas-modes-table` cases only if the Open decision finds a mismatch.
- **`LDC1.10`:** `packages/compiler/tests/site-build-empty-list.test.ts`: a mapped Array resolving to `[]` at build renders nothing and the page stays static when the build resolved its source (a class-resolved entry with `timing: "compiler"` or none, `$site`/`$page`, a `$map/` pointer in an expanded row, a literal), and keeps its client binding over client state (`{ "default": [] }`, a bare `[]`), a `Request`, and a build-resolved entry a handler writes. The rule it narrows was commit `def35f6e`'s fix for a client list that could never populate, still pinned by `site-build-component-loading.test.ts`. The empty slice of a paged route collapses and its page is static: the reference scan skips `$paths`, whose `paginate` pointer had kept every page of a paged list dynamic, full or empty (`site-build-pagination.test.ts` pins the full one). The spec text is a new `spec.md` §10.5.
- **`LDC1.11`:** wp2jx's own pinned tests.

In a real browser, with the `packages/studio:verify` skill on the converted site: the home page and `dev-episodes` show titles, dates, authors, excerpts and images with no expression text; click a third row and edit its heading, and confirm every row and the saved JSON keep the template; open a date chip and change its format; confirm Open in Browser runs a component; after `LDC1.9` confirm no Preview control remains. After `LDC1.11`, re-convert the site and confirm its date and fallback tags open with structured popovers.

## Specs & docs

**Written with this plan and `LDC1.1`, in one change set:** §4.5 and §6.9 as Pending sections, whose markers already name what `LDC1.1` ships (the splitter in §6.9's, the member-string refusal in §4.5's); one forward pointer each in §4.1 and §4.2; §4.1's sentence on a row-bound `hidden`, `inert` or `disabled`; §8.2.7's paragraph on the refusal that ships; one minor studio.md fragment covering all of it; and the matching sentence in `docs/studio/interface/modes.md`.

**`specs/studio.md`, in place, no renumbering:**

- **§4.5 and §6.9:** each slice trims its own clause from the marker as it ships; `LDC1.8` and `LDC1.7` flip them to Implemented with evidence paths.
- **§4.1** (marker stays with `plan:studio/canvas-injects-context`): in `LDC1.4`, "Bindings render live in every mode, except the author's own text", "Text a content entry draws is not the author's own, so it renders live" and "A component draws its props, not their bindings, inside a repeater too" are rewritten as pointers to §4.5; in `LDC1.6`, "Live data belongs to preview"; in `LDC1.4`, the "MUST NOT be a walk" paragraph's sentence about the transparent placeholder. In `LDC1.9`, the colour-scheme paragraph's first sentence becomes: "**Color-scheme preview.** When the effective `$media` declares a pure `prefers-color-scheme` query, the pane context bar's Context popover offers an Auto/Light/Dark group (§6.2, "The breakpoint and scheme axes"); the choice is the tab's, written by `canvas.setColorScheme`, and applies to every canvas frame the tab renders, Project Styles' specimens included."
- **§4.2**, in `LDC1.9`: delete the marker. Replace the table with a lead paragraph and a new table.
  - Lead: "A tab shows its document in one **mode**, the `canvasMode` string on its session, and offers only the modes its document declares (`capabilities.modes`): a format's `$studio.modes` (§8.1), a fixed list for a native `.json` (`inferModes` in `packages/studio/src/tabs/tab.ts`), or its opener's list for a tab that holds no Jx document, such as a CSV or a media file. The pane context bar reads the one string as two axes (§13.4): the **editor** (`editor.kind`), whose control lists only the editors the tab offers, and for the Canvas editor alone the **view** (`canvas.view`). The mode-to-editor map (`EDITOR_KIND_BY_MODE` in `packages/studio/src/commands/context.ts`) and the editors' names (`EDITOR_KIND_LABELS`) are one list each, so the pane context bar and the status bar (§16.2) cannot name an editor two ways."
  - Table with the columns Editor, `editor.kind`, Mode, Shows, re-detailed against `EDITOR_KIND_BY_MODE` at landing. At the current tree, less Preview, it is ten rows: Canvas (`canvas`; `edit`, `design`; the document rendered by the runtime with its data resolved, §4.1 and §4.5, both views carrying the live caret, §8.2). Code (`code`; `source`; the file's text, validated against the project's schemas, §4.2.1). Grid (`grid`; `grid`; rows as a table). Diff (`diff`; `git-diff`; the document beside its committed version, §21). Media (`media`; `media`; a file shown rather than edited). Image (`image`; `image`; an image edited where it is opened, §9.5). Entry (`entry`; `entry`; a form over one content entry's fields, `site-architecture.md` §7.4). Home (`home`; `content-home`, `media-home`, `publish-home`, `settings-home`; a workspace's home, §22). Elements (`config`; `stylebook`; element defaults over the specimen canvas, §7). Variables (`tokens`; `tokens`; `project.json`'s custom properties, §7.1).
  - After the table: a paragraph saying Entry is a mode of the tab that holds its file, not a tab of its own (`openEntryEditor`), so a form and the body it describes share one history and one dirty flag.
  - Media paragraph: "Every other mode above draws a document tree; there is no tree behind a PNG" becomes "The canvas views draw a document tree; there is no tree behind a PNG". Diff paragraph: "Every other mode above draws a single tree" becomes "The canvas views draw a single tree".
  - The "Design and Content are both **editable modes**" paragraph is replaced by: "**Edit and Design are the two editable views, and they differ in stage, not in document.** Both are offered to a native `.json` and a format-backed document alike, and both carry the live caret with the same text behaviour (§8.2). Edit renders one centred column as wide as the chosen breakpoint, or as it has been dragged (§6.2), with no pan and a content zoom that reflows (§4.3); Design renders the pan/zoom artboard, one board per declared size breakpoint side by side. A tab opens in the first mode it declares, which is `edit` for a native `.json` and for Markdown. **Content is not a mode.** Whether a format document is content or a component is its `documentMode` (§8.1): it decides how the document splits into frontmatter and body and whether the Outline draws a root row, and it chooses no mode and no view."
  - Every Preview paragraph is deleted ("Preview does not edit, and it scrolls for real", the surface and scroll paragraphs, "Preview is a TOGGLE", "Preview honours the chosen breakpoint", "Following a link in Preview leaves the canvas" and its two followers), with one paragraph in their place saying that the editing canvas shows resolved data (§4.5) and a real browser is where handlers, navigation and server functions run (§10.1). The forward pointer added with this plan goes with them. "Edit draws the page and nothing above it" and "Source is batched" stay.
- **§4.2.2, §4.2.3:** "every mode but Preview" becomes every canvas view; the "Preview renders all of it natively" sentences go (`LDC1.9`).
- **§4.3:** the wheel, page-zoom and zoom-control paragraphs drop Preview from their lists (`LDC1.9`).
- **§4.4:** "The ONLY canvas drag source (§8.2.4)" becomes "(§8.2.5)" (`LDC1.9`); a Bound pill row joins the table (`LDC1.7`).
- **§2, §5.6, §6.2, §13.4, §14.8, §22.4:** each loses its Preview clause (`LDC1.9`); §5.6 gains the state-value control and Refresh's wider meaning (`LDC1.6`, `LDC1.8`); §13.4's `canvas.view` row lists two values.
- **§6.6 to §6.8:** the Mixed text rung's chip strip (§6.6, `LDC1.7`); §6.8's "The canvas draws the binding as a label, `❪ item.$children ❫`, closed to the caret … Preview draws the nodes" becomes a pointer to §4.5's computed-list rule (`LDC1.4`).
- **§8:** "## 8. Content / Format Mode" becomes "## 8. Document Editing and Formats" (`LDC1.9`).
- **§8.2:** "Prop-bound text inside a component (§8.2.5)" becomes "(§8.2.6)". **§8.2.1** table: "block split (§8.2.2)", "block merge (§8.2.3)" and "range collapse (§8.2.3)" each cite §8.2.4; "a prop-bound host (§8.2.5)" cites §8.2.6 (`LDC1.9`). **§8.2.7:** the refusal sentence widens to the full third guard, and chips join the serialization rules (`LDC1.4`).
- **§10.1** (marker owned by `plan:studio/open-in-browser-blocked-state`): body gains components and layouts (`LDC1.8`); the "same seam Preview link clicks use" clause is reworded (`LDC1.9`).
- Realign edited tables with oxfmt.

**Other specs, bodies only:**

- `studio-ui-guidelines.md` §1 ("`CANVAS_MODES` … do not change"), §8.1 (owned by `plan:studio-ui-guidelines/canvas-highlight-facts`), §8.6 (`LDC1.9`).
- `ui.md` §10 (`LDC1.9`).
- `spec.md` §8.4 (owned by `plan:spec/spliced-content-stays-literal`; array-valued string children in the runtime, `LDC1.3`), §10 (owned by `plan:spec/compiled-keyed-lists`; empty lists build static, `LDC1.10`), §19.4c (owned by `plan:spec/named-formula-recursion`; the packaged formulas, `LDC1.2`).
- `compiler.md` §3: a pure named formula does not make a page dynamic (`LDC1.2`).
- `ai.md` and `desktop.md`: one Preview sentence each (`desktop.md` §3's preview-navigation override keeps its handler and loses "in Preview mode") (`LDC1.9`).
- `site-architecture.md` §7.3: "Markdown files (`.md`) open in **content mode** — a centered column WYSIWYG canvas where" becomes "Markdown files (`.md`) open in the **Edit** view (`studio.md` §4.2), a centred-column WYSIWYG canvas where". The last bullet stays for its owner (`LDC1.9`).

**Fragments** (no plan id, no slice id, no raw angle brackets in the sentence):

- `LDC1.1`: written, the minor studio.md fragment above. Each of `LDC1.2` to `LDC1.8`: `bun run spec:change studio.md minor -m "…"` naming what shipped.
- `LDC1.9`: `bun run spec:change studio.md major -m "…"` (a documented mode is removed and the `❪ expr ❫` contract redefined), `studio-ui-guidelines.md major`, `site-architecture.md patch`, `ui.md patch`, `ai.md patch`, `desktop.md patch`.
- `LDC1.2`, `LDC1.3`, `LDC1.10`: `spec.md minor`; `LDC1.2`: `compiler.md minor`.

**Other plans to amend when Preview is removed** (`LDC1.9`, each re-read against its integration contract): `plan:studio/keyboard-shortcut-tables`, `plan:studio/canvas-block-keyboard-access`, `plan:studio/space-drag-pan`, `plan:studio-ui-guidelines/canvas-highlight-facts`, `plan:studio-ui-guidelines/caret-escape`, `plan:spec/shadow-dom-parity`, `plan:imports/canvas-project-context`, `plan:studio/site-state-in-data-panel`, `plan:studio/data-picker-pointer-paths`, `plan:site-architecture/head-and-layout-shape-root-title`, and `plan:studio/open-in-browser-blocked-state` (in `LDC1.8`, because a component and a layout stop being blocked targets).

**`plan:studio/canvas-injects-context`, lines left for the slice that makes them wrong** (its citation of this plan's predecessor is already re-pointed):

- Context, "Edit and Design render bindings live except a bound `textContent` and anything reading a repeater row … so the artboard differs from Preview only there": `LDC1.4`, `LDC1.9`.
- Finding 5, "in Edit and Design that array is the tab's (`stripEventHandlers` and `prepareForEditMode` pass `$elements` by reference)": re-verify in `LDC1.4`.
- The decision naming "the same Edit/Design gates as the page's own (`setSkipServerFunctions`, `setSkipAutoRequests`)": `LDC1.6`.
- Both Open items, which argue from what Preview shows ("leaves every `$page` binding empty in Preview", "is empty in Preview"): `LDC1.9`.
- Implementation step 6's wrap, "`merged` in Preview, `prepareForEditMode(stripEventHandlers(merged))` otherwise": `LDC1.9`.
- The parity test's "the Preview-mode `renderDoc.state.$page`": `LDC1.9`.
- Acceptance, "in Preview a text node bound to `${state.$page.locale}` reads `ar`" and "in Preview, as the built docs page does": `LDC1.9`.
- Its §4.1 body paragraph and docs text saying "once route parameters are chosen for preview" stay: `previewParams` is not the Preview mode.

**Docs, in the same pull requests** (no em dashes; `bun run docs:sync` names the rest): `docs/studio/interface/modes.md` (retitled, and its list of editors; `LDC1.9`), `docs/studio/interface/tabs.md` and `docs/studio/interface.md` (the same list; `docs:sync` names `tabs.md`, whose `code:` lists `context.ts`, but not `interface.md`, whose `spec:` and `code:` miss every changed file), `docs/studio/interface/canvas.md`, `docs/studio/design/repeaters.md`, `docs/studio/design/components.md`, `docs/start/first-component.md`, `docs/start/first-collection.md`, `docs/framework/concepts/switching.md`, `docs/studio/logic/data.md`, and the roughly twelve other pages that mention Preview; `packages/studio/README.md` and `scripts/screenshots/README.md`, one Preview mention each. Tag new behaviour with `@docs` and list the files in `code:` frontmatter. The packaged formulas reach the generated formula catalog with no hand edit.

**Screenshots:** the lane re-captures. New shots for the tag popover, the Bound pills and binding names are driven by the setters. The `hero` shot gains a selection box in Edit and needs a look.

studio.md does not graduate here: other items stay open, so `plans/studio/` stays.

## Acceptance

- `bun run plans:status --who-claims studio.md#4.5`, `studio.md#6.9` and `studio.md#4.2` each name no plan once their closing slice lands, and `bun run plans:check` passes after each slice.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:markdown`, `bun run docs:prose`, `bun run docs:standards`, `bun run docs:section-refs`, `bun run schema:verify` and `bun run all-the-things` pass after each slice.
- After `LDC1.4`: `git grep -n 'templateToEditDisplay\|restoreTemplateExpressions\|PLACEHOLDER_IMG\|TRANSPARENT_PX' packages/studio/src` prints nothing, and no `❪` reaches the canvas for a parseable or an unparseable expression.
- After `LDC1.5`: in a rendered frame, `document.querySelectorAll("[data-jx-path]")` holds no two elements with one path, after render, patch and row promotion.
- After `LDC1.9`: `git grep -n '"preview"' packages/studio/src/canvas/canvas-utils.ts packages/studio/src/commands/context.ts extensions/parser/src/Markdown.class.json` prints nothing; `sed -n '/^### 4.2 Modes/,/^#### 4.2.1/p' specs/studio.md | grep -c "Status: Partial\|^| Content\|Design and Content\|Preview"` prints 0; `grep -n "tab bar shows\|Content / Format Mode\|drag source (§8.2.4)\|(§8.2.5) is the exception\|split (§8.2.2)\|(§8.2.3)" specs/studio.md` and `grep -n "content mode" specs/site-architecture.md` print nothing; `grep -n "§8.2.5" packages/studio/src/canvas/editable-actions.ts` prints nothing; `bun scripts/check-shot-contract.ts` passes.
- In Studio on the converted site: the checks under Tests' browser paragraph hold, and the status bar's DOCUMENT field and the pane context bar name every editor alike.
- `ls specs/changes/` includes a fragment for every spec a slice edited, and `bun run spec:release --dry` mints them at the levels above.

## Slices

| Slice   | Scope                                                                                                                                                                                                      | Claims        | State                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- |
| LDC1.1  | Stop the bleeding: a quote-aware splitter beside `maskCode`; a commit can no longer overwrite a templated string member of `children`; a row-bound `hidden` is no longer stuck                             | —             | in pull request #638                           |
| LDC1.2  | Tag model and formulas: `dynamic-tag.ts`, six formulas, typed parameters, the `$description` fix, pure formulas not dynamic                                                                                | —             | in pull request #640                           |
| LDC1.3  | Runtime parity and hooks: array-valued string children splice as the build does; `evaluateTemplateValue` exported; row cap and empty-row hook; `canvasStamped` honours echo                                | —             | in pull request #640                           |
| LDC1.4  | Live text and chips, still one row: segments, the chip serializer, the `patchText` rule, the bound-block affordance, `$switch` pass-through, `canvas.setBindingDisplay`                                    | —             | in the working tree, not yet in a pull request |
| LDC1.5  | Real rows: active and echo rows, row scopes in patches, promotion, union rects, `structure-beside-repeater`, drop and insert retargeting, the template row and the row cap                                 | —             | open                                           |
| LDC1.6  | Remote data and unresolved states: fetch once, the session cache, Refresh, `bindingStatus`, the cloud notice                                                                                               | —             | open                                           |
| LDC1.7  | The tag popover, Bound pills, the insert control, Inspector chips, the switch-case and row controls                                                                                                        | studio.md#6.9 | open                                           |
| LDC1.8  | Run without Preview: Open in Browser for components and layouts; `canvas.setStateValue` and its Data panel control                                                                                         | studio.md#4.5 | browser half in working tree; state value open |
| LDC1.9  | Remove Preview from code, shots, tutorials and specs; the modes table and the editorial ride-alongs carried from the plan this one replaced                                                                | studio.md#4.2 | open                                           |
| LDC1.10 | Empty lists build static: a mapped Array that resolves to `[]` at build renders nothing instead of forcing a client render. Lands before `LDC1.9`                                                          | —             | in pull request #640                           |
| LDC1.11 | wp2jx, in its own repository, after a release carrying `LDC1.2` and `LDC1.10`: structured date and fallback tags, native Arrays, precomputed per-entry values; re-convert the Anabaptist Perspectives site | —             | open                                           |

## Risks

1. **A lookup that takes the first match edits the wrong row.** The active and echo split keeps paths unique; a test asserts no duplicate `data-jx-path` after render, patch and promotion.
2. **Runtime effects racing the patcher.** One writer per property: bound nodes are re-rendered, never text-written; the patcher's header comment is rewritten to that rule.
3. **The caret beside non-editable inline chips in Chromium** at block edges. Covered by a browser pass; the fallback is a zero-width guard node.
4. **Author code now runs on the canvas once** (server functions, `GET` requests). Once per open, cached, and Refresh is the verb.
5. **`LDC1.9` is wide** (35 test files, 22 shots, about 20 docs pages). It is mechanical and lands only after `LDC1.4` to `LDC1.8` make Edit sufficient.
6. **wp2jx can only use published jx.** `LDC1.11` waits on a release.
7. **§4.2 is stale in two directions until `LDC1.9`.** Its marker and table predate the workspace homes, and its Preview text describes a mode this plan removes. The forward pointers in §4.1 and §4.2 are what say so in the meantime.
