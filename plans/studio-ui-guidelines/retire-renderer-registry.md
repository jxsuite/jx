---
status: drafted
disposition: implement
claims:
  - studio-ui-guidelines.md#9.3
size: L
workspaces:
  - packages/studio
---

# Retire the renderer registry: surfaces follow reactive state, and nothing repaints by name

## Context

`specs/studio-ui-guidelines.md` §9.3 is Partial:

> **Status: Partial.** The surface shape below ships. What does not is the retirement of `store.ts`'s name-to-callback renderer registry, described under "There is no root render": seven renderers the bootstrap registers, and the callers that still repaint them by name after writing state no effect tracks.

This plan is what remains of the Studio legacy-state migration, a session plan written in May 2026 ("Migration Plan: Jx Studio Legacy State to @vue/reactivity", once `.claude/plans/peaceful-pondering-pie-agent-aacd3139a49b23983.md`, readable with `git show c82b4e7f^:.claude/plans/peaceful-pondering-pie-agent-aacd3139a49b23983.md`). Its goal was that all state is read from `activeTab.value` and all rendering is driven by `effect()` auto-tracking. Checked against the tree at `c82b4e7f`:

| Old phase                                                 | State today                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–3: canvas, helpers, panels and editors off `getState()` | Done. `getState` has no definition and no caller.                                                                                                                                                                                                                                                                                     |
| 4: middleware becomes effects                             | Done. `addUpdateMiddleware`, `addPostRenderHook` and their runners are gone.                                                                                                                                                                                                                                                          |
| 5: remove the flat-state bridge                           | Done. `setGetStateFn`, `setUpdateFn`, `setGetDocFn`, `setGetSessionFn`, `toFlat`, `fromFlat` and `createState` are gone.                                                                                                                                                                                                              |
| 6: clean up `store.ts`                                    | **Half done.** The session dispatchers `updateSession`, `updateUi` and `updateCanvas` survive, but not as legacy: they were reshaped to take the tab they write explicitly, and that shape is what `scripts/check-pane-singletons.ts` gates (see Decisions). What is genuinely left is `registerRenderer`, `render` and `renderOnly`. |
| 7: `canvasMode` into reactive state                       | Done differently: per pane and per tab (`canvasModeOfPane`, `canvasModeOfTab` in `workspace/`).                                                                                                                                                                                                                                       |

What remains, counted in `packages/studio/src`:

- **The registry** (`src/store.ts`, "Render orchestration"): `registerRenderer`, `render()`, `renderOnly(...names)`, and `rendersInFlight()`, which `services/idle.ts` reads as condition 1 of `probeIdle()`.
- **Seven registrations** in `src/studio.ts`, under a comment that calls them "compat during migration": `leftPanel`, `canvas`, `rightPanel`, `frontmatterPanel`, `seoModal`, `chatPanel` and `overlays`. `panels/chat-panel.ts` keeps an exported `render()` only because the registry names it.
- **Seventeen full `render()` calls.** Fourteen are in `studio.ts` and three in `services/automation.ts`. All but the boot ones follow an async write to a store that is a plain module variable, so no effect can see it: `recent-projects.ts`, `project-list.ts` and `account-status.ts` each hold a `let cache`, and settings changes arrive through the `onSettingsChanged` callback in `services/settings/kernel.ts`.
- **Thirteen `renderOnly(...)` calls**, with four causes:
  - **Async module caches:** `panels/head-panel.ts` (`layoutEntries`, `_layoutHead`) and `ui/media-picker.ts` (`mediaCache`).
  - **Canvas messages that write state no panel effect reads:** `canvas/iframe-host.ts`, three calls.
  - **Geometry re-anchoring after zoom and pan:** `canvas/canvas-utils.ts`, two calls, both `renderOnly("overlays")`.
  - **Callbacks:** live-preview results in `panels/events-panel.ts` and `panels/signals-panel.ts`, the drop handler in `panels/dnd.ts`, and the buffered commit in `panels/editors.ts`.

`render()` coalesces nothing (§9.3: "two calls in one tick paint twice"), and a caller has to know which named renderer happens to read the state it just wrote. That knowledge is what this plan removes.

## Outcome

- `studio-ui-guidelines.md` §9.3 → Implemented. `store.ts` has no renderer registry, and the §9.3 paragraph describing it becomes the rule that replaces it.
- Every surface repaints because a value its own effect read has changed. Nothing repaints by name.
- A module that loads data asynchronously owns a reactive value that its surface reads. The loader writes that value, and the loader's callers do nothing further.
- `probeIdle()` still answers "has the shell caught up?", without a counter kept by a registry that no longer exists.

## Decisions

- **Decided:** `updateSession`, `updateUi` and `updateCanvas` stay. The old plan listed them for removal because they then read `activeTab.value` themselves. Today each takes the tab it writes and has no zero-argument form, which is the fix for four "writes through focus" defects (`store.ts`, "Session dispatch"). Removing them would scatter that rule back across call sites.
- **Decided:** stores become reactive at their owner, not repainted by their callers. `recent-projects.ts`, `project-list.ts` and `account-status.ts` hold their cache in a `shallowRef` from `@vue/reactivity`, so a surface's effect tracks it. The settings kernel exposes a reactive revision alongside `onSettingsChanged` (which stays, for non-render listeners). Head-panel's layout entries, the media cache and live-preview results follow the same rule.
- **Decided:** an overlay that follows geometry, not state, subscribes to the geometry. The two `renderOnly("overlays")` calls in `canvas-utils.ts` become writes to a reactive per-surface transform (pan, zoom, edit width) that the overlays effect reads. Nothing measures the DOM on a timer.
- **Open:** what replaces condition 1 of `probeIdle()`. Once every surface paints synchronously inside its own effect, "renderers mid-paint" has nothing left to count, and the async part of the canvas is already counted by condition 2 (`iframe-host.canvasIdleBlockers()`). The recommendation is to delete the `render` idle source once RR1.4 lands. That is only right if no remaining surface paints from an `async` function. RR1.4 must show that either way, by searching for `async` renderers and by the screenshot lane settling. If one remains, it gets its own idle source, named for what it waits on.

## Implementation

Each slice deletes call sites by making the state they chased visible to an effect. The registry itself goes last, once it has no callers.

- **RR1.1, hydrated stores.**
  - Convert `recent-projects.ts`, `project-list.ts` and `account-status.ts` to a `shallowRef` cache with the same exported read functions. Add a reactive settings revision to `services/settings/kernel.ts`.
  - Delete the full `render()` calls in `studio.ts` that follow `hydrateRecentProjects`, `hydrateProjectList`, `hydrateAccountStatus`, `hydrateSettings` and `onSettingsChanged`, and the three in `services/automation.ts`. The `seed.*` handlers there write the same stores, and `shell.git` is already reactive.
  - The boot-path `render()` calls (after activation, the `?project=` branch, `openLastSessionOrHome`) stay until RR1.4. The surfaces they paint are still registered renderers.
- **RR1.2, module caches.**
  - `head-panel.ts`: `layoutEntries` and `_layoutHead` become reactive, and its `renderOnly("leftPanel")` and both `renderOnly("frontmatterPanel", "seoModal")` calls go.
  - `media-picker.ts`: `mediaCache` and `mediaCacheLoaded` become reactive, and its three-panel `renderOnly` goes.
  - The live-preview helper (`livePreviewExpression`) returns a reactive result instead of taking an `onUpdate` callback, and the callbacks in `events-panel.ts` and `signals-panel.ts` go.
- **RR1.3, canvas and editor callers.**
  - `iframe-host.ts`: `session.canvas.refreshing` and `session.canvas.scope` are already reactive. The two `renderOnly("leftPanel")` calls go once the left panel's effect reads them inside its tracked scope. The layout-hit `renderOnly("rightPanel")` needs the overlay selection it records (`state.overlay`, `state.lastSelectionRect`) to be reactive, or the inspector to read the selection it already tracks.
  - `canvas-utils.ts`: the per-surface transform becomes reactive (see Decisions), and both `renderOnly("overlays")` calls go.
  - `dnd.ts` and `editors.ts`: each repaints the Navigator after a write. Find what that write is, make the Navigator's effect read it, and delete the call.
- **RR1.4, delete the registry.**
  - Remove `registerRenderer`, `render`, `renderOnly`, `runRenderer` and `rendersInFlight` from `store.ts`, and the seven registrations and their "compat during migration" comment from `studio.ts`.
  - The boot-path calls become effects or disappear. `renderCanvas()` is already driven per pane, and the left panel, right panel, frontmatter panel, SEO modal and overlays already own effects (`left-panel.ts`, `right-panel.ts`, `frontmatter-panel.ts`, `overlays.ts`).
  - Remove `chat-panel.ts`'s compat `render` export, and the `render` idle source per the Open decision.

**Integration contract for dependents:** after RR1.4, `store.ts` exports no render function and no name-keyed registry. A module needing a repaint exposes reactive state. Any plan that adds a surface can rely on this.

## Tests

`packages/studio`, `bun test --isolate --coverage`, per-file thresholds unchanged or ratcheted.

- **RR1.1:** for each store, one test showing that a surface reading it updates when hydration lands, with no `render()` call. Include a settings-gated surface (the assistant's setup notice) repainting on `hydrateSettings()`.
- **RR1.2:** the Document Header shows the layout layer's head once `loadLayoutEntries()` resolves. The media browse panel lists entries once `collectMedia` resolves. A live-preview result lands in the Signals panel with no callback.
- **RR1.3:** a Refresh that fails stops spinning (`iframe-host`'s failure branch). The block action bar re-anchors after a zoom, asserted on the transform the overlays effect reads.
- **RR1.4:**
  - `tests/store.test.ts` loses its `rendersInFlight` block and gains an assertion that `store.ts` exports none of `registerRenderer`, `render`, `renderOnly` or `rendersInFlight`.
  - `tests/idle.test.ts` reflects the decided idle sources.
  - `scripts/check-pane-singletons.ts` and `scripts/check-lit-conventions.ts` stay green.

## Specs & docs

- **Now** (the pull request that wrote this plan): §9.3's marker is Partial, released as a `patch` fragment.
- **RR1.4:**
  - §9.3 → Implemented.
  - The paragraph beginning "`store.ts` additionally keeps a name-to-callback registry" is replaced by the rule it becomes: a surface repaints only because a value its own effect read has changed, and a module that loads data asynchronously owns a reactive value its surface reads. There is no name-keyed repaint.
  - The idle-source list in `services/idle.ts`'s header comment is updated.
  - Release: `bun run spec:change studio-ui-guidelines.md minor -m "§9.3 …"`.
- No user-visible behaviour changes, so no docs page changes. State that in each slice's pull request after running `bun run docs:sync`.

## Acceptance

- `git grep -nE '\b(registerRenderer|renderOnly|rendersInFlight)\b' -- packages/studio/src` finds nothing, and `store.ts` exports no `render`.
- `bun run plans:check` reports `studio-ui-guidelines.md#9.3` closed. The RR1.4 pull request deletes this file.
- The studio suite is green with coverage, and so are `check-pane-singletons`, `check-lit-conventions` and `check-shot-contract`.
- The screenshots lane captures with no image change, and `probeIdle()` settles on every shot.

## Slices

| Slice | Scope                                                                             | Claims                        | State |
| ----- | --------------------------------------------------------------------------------- | ----------------------------- | ----- |
| RR1.1 | Hydrated stores become reactive; their full `render()` calls go                   | —                             | open  |
| RR1.2 | Head-panel, media and live-preview caches become reactive; their `renderOnly` go  | —                             | open  |
| RR1.3 | Canvas messages, overlay geometry, drag-and-drop and buffered commits             | —                             | open  |
| RR1.4 | Delete the registry, `rendersInFlight` and the compat exports; §9.3 → Implemented | `studio-ui-guidelines.md#9.3` | open  |
