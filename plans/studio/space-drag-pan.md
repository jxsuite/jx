---
status: drafted
disposition: implement
claims:
  - studio.md#4.3
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# Holding Space and dragging pans a pan/zoom stage, and a middle-button drag pans from anywhere on it

## Context

`specs/studio.md` §4.3, marker on line 270 (the section was unmarked before the census):

> **Status: Partial.** Space+drag pan does not exist: `installStageGestures` in `packages/studio/src/editor/shortcuts.ts` pans only on a middle-button drag (`e.button === 1`), and neither the shell nor the canvas frame has a Space-hold handler. Ctrl+wheel zoom toward the cursor, wheel ownership, the page-zoom block, fit on entry and per-document zoom memory ship.

The body promises "**Pan**: Middle-click drag or Space+drag", and §10's viewport table lists "`Space` + drag | Pan canvas". A trackpad has no middle button, so on a laptop the design canvas pans only by the wheel.

Verified against the tree on 2026-09-27; paths are under `packages/studio/src/` unless another root is named.

**What exists**

- `installStageGestures` (`editor/shortcuts.ts`), installed per pane cell by `attachStage` (`panels/pane-grid.ts`): the wheel (Ctrl+wheel zoom toward the cursor, `SELF_SCROLLING_MODES`, `markExplicitZoom`), the middle-button drag on `surface.wrap` (the `[part="pane-stage"]` element), and the background-click deselect. It reads pan state through `_stageContext`, which `initShortcuts` publishes from `studio.ts`'s `stageContext` (its `setPan` also clears `needsCenter`). `initShortcuts` owns the one document `keydown` listener (`dispatchKey`) and the Ctrl+wheel block outside `STAGE_SELECTOR`.
- The pan/zoom stages are the modes that mount a panzoom part: Design, Stylebook and Diff (`surface.panzoomWrap`, set from the `panzoom` host in `canvas/canvas-render.ts` and nulled on every mode transition; `STAGE_ZOOM_MODES` in `panels/pane-context.ts` names the same three).
- The canvas frame is cross-origin. `canvas/iframe-entry.ts` forwards the wheel (`forwardWheel`, replayed on the stage by `redispatchWheel` in `canvas/iframe-host.ts`) and, through `startKeyForwarding` (`canvas/iframe-keys.ts`), exactly the keydowns the synced keymap claims (§13.3). It forwards no keyup and no pointer button.
- A parent `pointerdown` anywhere but the edit chrome commits the live caret session (the capture listener in `studio.ts` calling `commitActiveEditSession`), so clicking the stage margin ends a caret.
- Tests: `tests/shortcuts.test.ts` ("middle-mouse panning", "stage background click"), `tests/iframe-keys.test.ts`, `tests/iframe-entry.test.ts` (wheel forwarding), `tests/iframe-host.test.ts` (`forwardKey` replay), `tests/pane-grid-surface.test.ts`.

**Found while detailing**

- **A middle-button drag pans only from the stage's margins.** Over an artboard the press lands in the frame, which relays no pointer button, so nothing pans. Zoomed in, the artboard fills the stage and there is no margin to start from. The census credited middle-drag as shipping.
- **The middle-button gate is on mode names, not on the surface.** It refuses only `edit` and `preview`, so in Grid, Library, Settings, Entry, Media and Source a middle drag writes pan offsets no transform reads and clears `needsCenter`: the defect `SELF_SCROLLING_MODES` already fixed for the wheel.
- **Forwarding frame pointer positions cannot pan.** The artboard follows the pointer, so a pointer dragging it stays at the same frame-local position; only screen-space deltas move.
- **Editorial drift in §4.3** (the audit record's ride-along): the fit paragraph's "the tab bar's −/+/100%/Fit controls" and the Zoom bullet's "toolbar controls" are the floating zoom pod (`panels/pane-context.ts`, `podFor`).

## Outcome

- studio.md §4.3 → Implemented. Holding Space arms every pan/zoom stage with a hand cursor, and a primary-button drag on an armed stage pans as the middle button does. Space arms only while no caret, modal, focused shell control or bare-Space binding has the key, and the canvas frame reports the hold when it has focus. A middle-button drag pans from the margins and from over an artboard alike. Neither drag pans a stage without a pan/zoom surface.
- studio.md §10's marker no longer names Space+drag as missing, so its viewport row is true as written.

## Decisions

- **Open:** which keyboard states arm Space? Recommendation: focus-based. Space arms when the parent keydown's target is the body (nothing in the shell has focus), or when the canvas frame has focus with no caret session, and in both cases only while `caret.active` and `modal.open` are false and nothing has already prevented the key. A focused shell control keeps Space: the Outline tree, tabs and menus handle it and stop it (`packages/ui/src/behaviors/tree.ts`, `tabs.ts`, `menu.ts`), and a native button activates on it. Reasons: Space is those controls' activation key (WAI-ARIA APG), and the pointer's position over a cross-origin frame is not observable from the host. Arming on pointer position would steal Space from a keyboard user whose mouse happens to rest on the canvas. Cost: with focus in the chrome, the author clicks the stage margin once first, which also ends any caret. Alternative: arm while the pointer is over a stage, whatever has focus, which needs the frame to report pointer enter and leave and overrides focused controls.
- **Open:** does a middle-button drag pan when it starts over an artboard? Recommendation: yes. The frame relays the press as `forwardPan` (start, screen-space `dx`/`dy` per move, end), and the host runs the same pan as a margin drag. Reasons: §4.3 lists middle-drag without qualification; zoomed in there is no margin to start from; and the relay is one small message beside `forwardWheel`. If declined, the Pan bullet reads "a middle-button drag on the stage around the artboards", and the frame and host steps for `forwardPan` are dropped.
- **Decided:** Space+drag is a stage gesture, not a command record, because a hold needs its release and a record resolves one keydown. This matches `plan:studio/keyboard-shortcut-tables`, which files §10's viewport rows as the stage's rather than the keymap's. §13.3's rule stays exact: the frame still forwards only claimed chords. A rebinding that claims bare Space wins in both realms, because both pan listeners skip a prevented event and run after the chord dispatcher.
- **Decided:** while armed, the stage takes every pointer. `data-jx-pan-armed` on `surface.wrap` makes every descendant, the canvas iframe included, `pointer-events: none`, so the one `pointerdown` listener on the stage serves margins and artboards. The frame needs no pointer protocol for Space, the overlays' own handlers (the insertion "+") never see the press, and the cursor is one rule. The alternative, streaming a left drag out of the frame, would need the host to tell every frame whether Space is held.
- **Decided:** the frame reports Space as a new `panKey { held }` message, not through `forwardKey`. `forwardKey` carries only claimed chords (§13.3), it has no release, and a replayed keydown would be judged by the parent's focus instead of the frame's.
- **Decided:** one pan for every origin. `panStageBy(surface, dx, dy)` in the new module runs the published stage context's `setPan` and `applyTransform`. The margin drag (either button) and the host's `forwardPan` both call it, and both gate on `surface.panzoomWrap !== null`, the fact §4.3 already defines the stages by ("a mode that mounts no pan/zoom surface"). `data-jx-panning` on the stage shows `grabbing` for the length of any pan drag.
- **Decided:** lifecycle. Every qualifying keydown arms, repeats included (it is idempotent, and repeats re-arm the parent when a press on the stage moves focus out of the frame). Disarming happens on a Space keyup in either realm, on the parent window's `blur`, and on the frame window's `blur` (reported as a release). A drag in flight runs to its `pointerup` or `pointercancel` whatever happens to the key. The `click` that ends a Space pan is not a background click, so it deselects nothing.
- **Decided:** the arm state, the Space predicate and the stage-context reader move into a new leaf module, `canvas/stage-pan.ts`. `canvas/iframe-host.ts` must write the arm (`panKey`) and pan a surface (`forwardPan`), and it must not import `editor/shortcuts.ts`'s dependency graph.
- **Decided:** the editorial ride-alongs land here, as the audit record assigns: §4.3's "tab bar" and "toolbar controls" become the zoom pod, and §10's marker drops the Space+drag clause, as `plan:studio-ui-guidelines/caret-escape` does for its Escape clause.

## Implementation

Code comments cite `studio.md §4.3` (a bare `§4.3` also resolves in this package, `bun run docs:section-refs`).

1. **New `src/canvas/stage-pan.ts`** (docblock: the arm and the pan both origins share, `@docs studio/interface/canvas`). Imports only `allCanvasSurfaces` from `./surface-registry` and types.
   - Move `ShortcutPointerContext`, `StageContext` and `stageless()` here from `editor/shortcuts.ts` (nothing outside that file imports them). Add `publishStageContext(reader: StageContext): void` and `stageContextOf(surface): ShortcutPointerContext`, which falls back to `stageless()`.
   - `panStageBy(surface, dx, dy)`: read `stageContextOf(surface)`, `setPan(panX + dx, panY + dy)`, `applyTransform()`. It returns early when `surface.panzoomWrap` is null.
   - `PAN_ARMED_ATTR = "data-jx-pan-armed"`, `PANNING_ATTR = "data-jx-panning"`.
   - `isPanHeld()` and `setPanHeld(held: boolean)`. A change sets `PAN_ARMED_ATTR` on each surface's `wrap` whose `panzoomWrap` is non-null and removes it from every surface on release. A stage that changes mode mid-hold keeps the attribute until the release.
   - `spaceArmsPan(e: KeyboardEvent, ctx: CommandContext): boolean` is true iff `e.key === " "`, with no Ctrl, ⌘ or Alt, and neither `e.defaultPrevented` nor `e.isComposing`, while `!ctx.modal.open && !ctx.caret.active` and the target is the document, its `body` or its `documentElement`.
   - `setPanning(surface, on: boolean)` toggles `PANNING_ATTR` on `surface.wrap`.
2. **`src/editor/shortcuts.ts`**
   - `initShortcuts`: `_stageContext = stageContext` becomes `publishStageContext(stageContext)`. The existing document `keydown` listener runs `dispatchKey`, then `if (spaceArmsPan(e, registry.context())) { e.preventDefault(); setPanHeld(true); }`. Add a document `keyup` (`e.key === " "` → `setPanHeld(false)`) and `window` `blur` → `setPanHeld(false)`.
   - `installStageGestures`: `getContext` reads `stageContextOf(surface)`. The `pointerdown` handler is rewritten. First `panClick = false`. It returns unless `surface.panzoomWrap` is set and either `e.button === 1` or `e.button === 0 && isPanHeld()`. Then `panClick = e.button === 0`, `e.preventDefault()`, pointer capture as today, `setPanning(surface, true)`, and each move calls `panStageBy(surface, ev.clientX - lastX, ev.clientY - lastY)`. `pointerup` and `pointercancel` release the capture, the listeners and `setPanning(surface, false)`. The background `click` handler returns first when `panClick` is set.
   - The file docblock's first job becomes "Wheel, the middle-button and Space pans, and resize", and `installStageGestures`'s docblock lists the Space pan and cites studio.md §4.3.
3. **`src/canvas/iframe-protocol.ts`**
   - `export const PAN_MODES: ReadonlySet<string> = new Set(["design", "stylebook", "git-diff"])`, documented as the frame modes rendered on the pan/zoom surface (studio.md §4.3).
   - `IframeToParent` gains `| { kind: "panKey"; held: boolean }` ("Space was pressed or released for a pan with this frame focused") and `| { kind: "forwardPan"; phase: "start" | "move" | "end"; dx: number; dy: number }` ("a middle-button drag that started in this frame, in screen-space CSS px").
4. **`src/canvas/iframe-keys.ts`**
   - `shouldReportPanKey(e, sessionLive, mode): boolean` is true iff `e.key === " "`, with no Ctrl, ⌘ or Alt, and neither `e.defaultPrevented` nor `e.isComposing`, while `!isPageTextEntry(e.target) && !sessionLive && PAN_MODES.has(mode)`.
   - `startPanKeyReport(channel, doc = document, isSessionLive = () => false, getMode = () => "design"): () => void`. A capture `keydown` on `doc` runs, when `shouldReportPanKey`: `e.preventDefault()`, and unless already reported, `reported = true` and a post of `{ kind: "panKey", held: true }`. A capture `keyup` of Space, and `doc.defaultView`'s `blur`, post `held: false` when `reported`, and clear it. The teardown removes all three. The module docblock gains a paragraph: Space is not a chord, so the table never forwards it, and the pan is reported on its own terms (studio.md §4.3).
5. **`src/canvas/iframe-entry.ts`**
   - After `startKeyForwarding`, `const stopPanKeyReport = startPanKeyReport(channel, container.ownerDocument, isEditing, () => currentMode)`. The order matters: a rebinding on Space is forwarded and prevented first.
   - Beside the wheel forwarding, add a capture `pointerdown` on the document, registered before `startInteraction`. For `e.button === 1` while `PAN_MODES.has(currentMode)`, it calls `preventDefault()` and `stopImmediatePropagation()` (no caret, no grab drag, no X11 primary paste), captures the pointer on `documentElement`, sets `documentElement.style.cursor = "grabbing"`, and posts `forwardPan` `start`. Each `pointermove` posts `move` with the `screenX`/`screenY` delta. `pointerup` and `pointercancel` post `end` and restore the cursor. A matching `auxclick` is prevented. The teardown removes the listeners and calls `stopPanKeyReport()`.
6. **`src/canvas/iframe-host.ts`, `handleMessage`**
   - `case "panKey"`: `setPanHeld(msg.held)`.
   - `case "forwardPan"`: `const surface = stageContaining(state.canvasEl)`, and return when it is null or has no `panzoomWrap` (the host refuses too, since neither build may assume the other is current). `start` and `end` call `setPanning`, and `move` calls `panStageBy(surface, msg.dx, msg.dy)`.
7. **`src/surfaces/pane-grid.json`**: two rules beside the stage's own. First, `& > [part="row"] > [part="pane"] > [part="pane-stage"][data-jx-pan-armed]` sets `cursor: grab`, and the same selector with `[data-jx-panning]` sets `cursor: grabbing`. Second, `… > [part="pane-stage"][data-jx-pan-armed] *` sets `pointerEvents: none`. Its `$description` says this is the one rule that reaches into the island, deliberately: while Space is held nothing inside the stage takes the pointer, the canvas frame included, so a press lands on the stage (studio.md §4.3). It also says the attribute is written by `canvas/stage-pan.ts`.

**Integration contract.** Once this lands, studio.md §4.3 reads Implemented. §10's "`Space` + drag | Pan canvas" row is true with no rewording, and §10's marker no longer names it, so `plan:studio/keyboard-shortcut-tables` may keep the row verbatim, file it under the stage's gestures (no command id, not rebindable), and add a "Middle-button drag | Pan canvas" row that holds over an artboard too. Code may rely on `canvas/stage-pan.ts` exporting `isPanHeld`, `setPanHeld`, `spaceArmsPan`, `panStageBy`, `publishStageContext`, `stageContextOf`, `setPanning`, `PAN_ARMED_ATTR` and `PANNING_ATTR`; on `PAN_MODES` and the `panKey` and `forwardPan` messages in `canvas/iframe-protocol.ts`; and on `shouldReportPanKey` and `startPanKeyReport` in `canvas/iframe-keys.ts`.

## Tests

All in `packages/studio`, run with `bun test --isolate --coverage` from the workspace directory.

- **New `tests/stage-pan.test.ts`** (happy-dom via `./harness`; contexts from `makeContext` in `src/commands/context.ts`):
  - "Space with nothing focused arms": a Space keydown dispatched on `document.body` with `makeContext()` is true.
  - "a caret, a modal or a focused control keeps Space": `caret: { active: true }`, `modal: { open: true }` and a keydown targeted at a focused `<button>` are each false.
  - "a modified, composing or claimed Space is not the pan's": Ctrl, ⌘ and Alt variants, `isComposing`, a prevented event and `key: "a"` are each false.
  - "arming marks only pan/zoom stages, and releasing clears every stage": two registered surfaces, one with a `panzoomWrap`. `setPanHeld(true)` sets the attribute on that one only, `isPanHeld()` is true, and `setPanHeld(false)` clears both.
  - "panStageBy runs the published stage context, and refuses a stage without a pan surface": asserts `setPan(panX + dx, panY + dy)` and `applyTransform`, and no call when `panzoomWrap` is null. Also asserts the `stageless()` fallback before anything is published.
- **`tests/shortcuts.test.ts`**. The "middle-mouse panning" describe mounts a panzoom element on the primary surface in `beforeEach` and removes it after, as "stage background click" already does, because the gate is now the surface.
  - "Space with nothing focused arms every pan/zoom stage, and its release disarms": the keydown is prevented, the wrap carries `data-jx-pan-armed`, and the keyup clears it.
  - "a left-button drag pans while Space is held, as the middle button does": the same `setPan(5, 20)` assertion as the middle-button case.
  - "the click that ends a Space pan does not deselect".
  - "a live caret keeps Space for typing" (`caretActive = true`: not prevented, not armed), and "a focused button keeps Space".
  - "window blur disarms".
  - "a pan drag marks the stage as panning until pointerup, and pointercancel ends it too".
  - "neither button pans a stage with no pan/zoom surface" (the Grid case: no `panzoomWrap`, not prevented, no `setPan`).
- **`tests/iframe-keys.test.ts`**. New describe "shouldReportPanKey" with: reported in Design, Stylebook and Diff with no session; kept by a caret session, Edit and Preview; kept by a page `<input>`; not reported when modified or prevented. New describe "startPanKeyReport" with: "posts held once per press, prevents every repeat, and posts the release"; "the frame's blur releases a reported hold"; "an unreported release posts nothing"; "teardown removes the listeners".
- **`tests/iframe-entry.test.ts`**:
  - "Space with no caret session reports panKey, and a rebinding on Space is forwarded instead": a synced table claiming `space` yields `forwardKey` and no `panKey`.
  - "a middle-button drag in Design relays forwardPan in screen space, and Preview relays nothing".
- **`tests/iframe-host.test.ts`**:
  - "panKey arms and releases the stage pan", asserting `isPanHeld()`.
  - "forwardPan pans the frame's own stage, and is refused on a stage without a pan surface".
- **`tests/pane-grid-surface.test.ts`**: "an armed stage shows the hand and lets nothing inside it take the pointer". It reads the two rules out of `pane-grid.json` by selector and asserts `cursor` and `pointerEvents`.
- **Coverage.** `packages/studio/bunfig.toml` holds every file at `lines = 0.958, functions = 0.941`. `stage-pan.ts` is a new source file and ships with its test, so the manifest check (`bun scripts/check-coverage-manifest.ts packages/studio`) finds it. Every new branch above has a case. If `stage-pan.ts` or a touched file becomes the workspace's new worst file, ratchet to just below the new minimum; lowering is not expected.

## Specs & docs

- **studio.md §4.3 marker** (line 270) is replaced by:

  > **Status: Implemented.** `installStageGestures` in `packages/studio/src/editor/shortcuts.ts` (wheel ownership, the page-zoom block, Ctrl+wheel zoom toward the cursor, and the middle-button and Space drags), `src/canvas/stage-pan.ts` (the Space arm and the one pan every drag runs), the canvas frame's Space report and middle-button relay (`src/canvas/iframe-keys.ts`, `src/canvas/iframe-entry.ts`), and the fit and per-document zoom memory (`fitToScreen` and `markExplicitZoom` in `src/canvas/canvas-utils.ts`).

- **§4.3's Zoom bullet**: "or toolbar controls" becomes "or the zoom pod".
- **§4.3 gains a paragraph** after the "Ctrl/⌘+wheel is a different gesture" paragraph:

  > **A drag pans wherever it starts on a pan/zoom stage, and Space pans only when nothing else has the key.** A middle-button drag pans the stage it starts on, over the margins or over an artboard: the canvas frame owns the pointer there, so it relays the drag to the host (`forwardPan`) in screen space, because the artboard moves with the pointer and a position inside the frame never changes. Holding Space arms every pan/zoom stage: the pointer becomes a hand, nothing inside the stage takes the pointer (the canvas frame included), and a primary-button drag anywhere on an armed stage runs the same pan as the middle button, to its pointerup. Space arms only while the keyboard is otherwise idle: no caret in either realm (`caret.active`, §13.4), no modal, no focused shell control (which keeps Space as its own activation key), and no chord bound to bare Space, which wins over the gesture. With focus in the canvas frame, the frame judges the same facts it forwards keys by (§13.3: no caret session, a pan/zoom render, not an author's form field) and reports the hold and its release (`panKey`); Space is not a chord, so the keymap never forwards it. Releasing Space, or either realm losing focus, disarms. The click that ends a Space pan is not a background click and deselects nothing, and neither drag pans a stage that mounts no pan/zoom surface.

  If the first Open decision is declined, "no focused shell control (which keeps Space as its own activation key)" becomes "the pointer over the stage, whatever has focus". If the second is declined, the paragraph's second sentence becomes "A middle-button drag pans when it starts on the stage around the artboards; over an artboard the canvas frame owns the pointer and relays no button."

- **§4.3's fit paragraph**: "the tab bar's −/+/100%/Fit controls" becomes "the zoom pod's −/+/100%/Fit controls".
- **studio.md §10 marker** (line 1130): the sentence "Two rows describe gestures that do not exist yet: Escape with a caret does nothing (the caret stack does not forward it and the editing root has no handler), which is `studio-ui-guidelines.md` §8.3's gap, and Space+drag is §4.3's." becomes "One row describes a gesture that does not exist yet: Escape with a caret does nothing (the caret stack does not forward it and the editing root has no handler), which is `studio-ui-guidelines.md` §8.3's gap." If `plan:studio-ui-guidelines/caret-escape` has landed first, the remaining "One row describes … Space+drag, which is §4.3's." sentence is deleted instead. §10 stays Partial, and its tables are not touched.
- **Fragment:** `bun run spec:change studio.md minor -m "§4.3 Space+drag pans a pan/zoom stage while no caret, modal or focused control has the key, a middle-button drag pans from over an artboard too, and neither drag pans a stage with no pan/zoom surface; §10's marker no longer lists Space+drag as missing."`
- **`docs/studio/interface/canvas.md`**: `code:` lists `editor/shortcuts.ts`, which changes. Add `studio.md#4.3` to its `spec:` (the page's "Pan and zoom" section is that section) and `packages/studio/src/canvas/stage-pan.ts` to its `code:`. The Pan bullet becomes:

  > - **Pan** with the mouse wheel or trackpad, and hold :kbd[Shift] while scrolling to pan sideways. To drag the canvas, hold :kbd[Space] and drag with the main button (the pointer turns into a hand), or drag with the middle mouse button. Either drag works over the page as well as around it.

  Add after the list:

  > :kbd[Space] pans only while nothing else is using it. With the text cursor in the page or in a field it types a space, and a focused button, tab or Outline row keeps its own :kbd[Space]. Click an empty part of the canvas first and :kbd[Space] pans from anywhere on it.

  Neither passage has an em dash. If the Open decisions are declined, the passages follow the spec's alternative wording.

- No other page changes. `docs/studio/interface/modes.md` cites §4.2, and its Preview paragraph ("nothing to pan or zoom") stays true. `docs/studio/interface/tabs.md` lists `panels/pane-grid.ts`, which is unchanged. The generated shortcuts page projects records, and this gesture is not one.
- No graduation: studio.md keeps other open items (`bun run plans:status --spec studio`). The landing pull request deletes this file and removes `studio/space-drag-pan` from `plan:studio/keyboard-shortcut-tables`'s `requires`.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` passes, and no file falls below `lines = 0.958, functions = 0.941`. `bun scripts/check-coverage-manifest.ts packages/studio` passes with `src/canvas/stage-pan.ts` in the report.
- `bun run docs:status` reads studio.md §4.3 as Implemented, and studio.md still carries `-draft`. `bun run plans:check` passes with this file deleted and the edge removed. `bun run plans:status --who-claims studio.md#4.3` names no plan.
- `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:section-refs` pass.
- In Studio (the desktop app, or the contributor browser Studio), on a Design canvas:
  1. Click an empty margin, hold Space. The hand shows over the whole stage, artboards included. Drag with the main button over an artboard: the canvas pans, and nothing is selected, dragged or text-selected. Release Space: clicking selects again.
  2. Click into a paragraph and hold Space: a space is typed. Focus an Outline row and press Space: the tree behaves as before.
  3. Middle-drag starting over an artboard pans, and on Linux nothing is pasted.
  4. Space+click on a margin without moving keeps the selection.
  5. With two panes, Space shows the hand on both pan/zoom stages, and a drag pans only the stage under the pointer.
  6. Hold Space, switch to another window, release, and come back: the stage is not armed.
  7. In Grid, the Library, Edit and Preview, neither drag pans, and Space in Preview still scrolls the page.
