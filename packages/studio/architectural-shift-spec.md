# Jx Studio: Architecture Refactor Spec

**Status:** In Progress
**Scope:** `packages/studio/src/`
**Goal:** Eliminate cross-panel failure propagation, make state changes auditable, and isolate rendering side effects — without changing user-visible behavior or rewriting working subsystems.

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Error Boundaries | ✅ Complete | All renderers wrapped in try/catch with retry |
| 2. Doc/Session Split | ✅ Complete | updateSession/updateUi in use, no ad-hoc mutations |
| 3. Lift Transient State | ✅ Complete | All mutable view state in view.js |
| 4. Componentize Panels | 🔄 In Progress (~60%) | Container panels: toolbar, overlays, right-panel, statusbar, activity-bar, left-panel. Sub-panels: layers, stylebook-layers, elements, imports, signals, data-explorer, head, git, files |
| 5. Lit Host Hygiene | ⬜ Not Started | |
| 6. Async as State | ⬜ Not Started | |
| 7. Selective Subscriptions | ⬜ Not Started | |

---

## Background

The current architecture works for most cases but exhibits several recurring failure modes:

- An error in one renderer (most commonly the canvas) can destroy unrelated UI (left panel, right panel, toolbar).
- State changes happen through two parallel paths: the explicit `update()` dispatcher in `store.js`, and ad-hoc `S = { ...S, ui: { ... } }` mutations scattered across `studio.js`. The second path bypasses middleware, post-render hooks, and selective re-rendering.
- Renderers read and write a large shared substrate (module-scoped globals in `studio.js`, the `elToPath` WeakMap, the `canvasPanels` array, persistent floating Lit hosts) which makes them non-independent in practice even though they're registered independently.
- Async work inside renderers (custom element registration, runtime rendering, file I/O) races with synchronous UI updates, producing the need for `pendingInlineEdit` flags and `requestAnimationFrame` coordination.
- Manual cleanup arrays (`dndCleanups`, `canvasDndCleanups`, `canvasEventCleanups`, `_inlineEditCleanup`, `selDragCleanup`) are easy to miss; leaked listeners hold stale closures over stale state.
- Persistent Lit render hosts can have their internal markers corrupted by adjacent code that touches DOM Lit owns; the existing defensive `try/catch/replaceWith` pattern is a workaround, not a fix.

The state mutation API in `state.js` is well-factored and not the source of these problems. The PAL in `platform.js` is also fine. Most fixes target the dispatcher (`store.js`) and the renderers (`studio.js`).

## Non-Goals

- **No CRDT adoption.** Yjs/Automerge solve different problems than the ones we have. Revisit only if multiplayer becomes a concrete roadmap item.
- **No framework change.** Lit-html stays. Vanilla JS stays.
- **No rewrite of `state.js`.** Its immutable mutator API is the strongest part of the codebase and the foundation everything else builds on.
- **No change to file format, runtime, PAL, or metadata-driven inspector.** The bugs aren't there.
- **No user-visible behavior change** unless explicitly noted in a phase below.

## Guiding Principles

1. **Each step ships independently and is reversible.** No phase depends on a future phase landing.
2. **Persistent app state and ephemeral session state are different things and get different update paths.**
3. **Renderers are pure functions of state.** Side effects (DOM ownership, async work, event listeners) live in components, not in dispatch.
4. **Components are isolation boundaries.** A failure inside one component cannot corrupt another.
5. **Async is a state, not a procedure.** Renderers always run synchronously against current state; async work produces state updates on completion.

---

## Phase 1: Error Boundaries Around Renderers

**Effort:** ~1 hour
**Risk:** Negligible
**Addresses:** Cross-panel failure propagation (the immediate stated symptom).

### Change

In `store.js`, wrap each registered renderer call in `try/catch`. Same for the renderer calls inside `_updateFn` in `studio.js`.

```js
// store.js
export function render() {
  for (const [name, fn] of _renderers.entries()) {
    try { fn(); }
    catch (e) { console.error(`Renderer "${name}" failed:`, e); }
  }
}

export function renderOnly(...names) {
  for (const name of names) {
    const fn = _renderers.get(name);
    if (!fn) continue;
    try { fn(); }
    catch (e) { console.error(`Renderer "${name}" failed:`, e); }
  }
}
```

In `studio.js`, the inline calls inside `_update` (`renderToolbar()`, `renderCanvas()`, `renderLeftPanel()`, etc.) get the same treatment — either by routing them through `renderOnly()` or by wrapping each call directly.

### Acceptance

- Forcing a thrown error inside `renderCanvas` does not blank or corrupt the left panel, right panel, toolbar, or statusbar.
- The console shows a clear `Renderer "canvas" failed: ...` message.
- Subsequent state changes continue to update other panels.

### Out of Scope for This Phase

- Fixing the *causes* of canvas crashes. Those get fixed where they originate (later phases or as separate bugs).
- Recovering the failed renderer's own DOM. A failed canvas render may leave the canvas blank or stale until the next successful render; that's acceptable.

---

## Phase 2: Split `S` into `doc` and `session`

**Effort:** 1–2 days
**Risk:** Low–Medium (mechanical change, touches many call sites)
**Addresses:** The "I bypass `update()` because I don't want a history snapshot" anti-pattern. Eliminates the structural reason most `S = { ...S, ui: { ... } }` mutations exist.

### Change

Today's `S` (defined in `state.js` as `StudioState`) conflates three different kinds of state:

| Kind | Examples | Properties |
|---|---|---|
| Document | `document`, `content.frontmatter` | Goes in undo history. Persisted. Triggers autosave. |
| Document-adjacent | `fileHandle`, `documentPath`, `documentStack`, `mode`, `handlersSource`, `dirty`, `history`, `historyIndex` | Persisted with the document; not itself in history. |
| Session | `selection`, `hover`, `ui.*` | Never persisted. Never in history. Cheap to mutate. |

Restructure into two top-level slices:

```js
// New state shape
{
  doc: {
    document,
    content: { frontmatter },
    history,
    historyIndex,
    dirty,
    fileHandle,
    documentPath,
    documentStack,
    handlersSource,
    mode,
  },
  session: {
    selection,
    hover,
    ui: { /* leftTab, rightTab, zoom, activeMedia, ... all of it */ },
  },
}
```

Introduce two dispatchers:

```js
// store.js
export function updateDoc(newDoc) { /* triggers full render + middleware */ }
export function updateSession(patch) { /* shallow-merges into session, triggers selective render */ }
```

`updateSession` is the new home for everything currently written as `S = { ...S, ui: { ...S.ui, foo: bar } }; renderRightPanel();`. It accepts a partial patch (shallow at the top level, can include a nested `ui` patch), applies it, and triggers selective rendering based on what changed.

`updateDoc` replaces today's `update()` for document changes. It runs middleware (autosave), pushes history, and triggers a broader re-render.

### Renderer Wiring

Renderers stop reading `S` directly. They take the slice they care about as input:

- `renderCanvas(doc, session)` — needs both.
- `renderLeftPanel(doc, session)` — needs both (layers reflect doc structure, but selection is in session).
- `renderRightPanel(doc, session)` — same.
- `renderToolbar(doc, session)` — needs both (mode, dirty, breadcrumb come from doc; activeMedia from session).
- `renderStatusbar(session)` — mostly session, but needs `doc.dirty`.

This is a discipline change more than an API change. The registration call becomes:

```js
registerRenderer("canvas", () => renderCanvas(getDoc(), getSession()));
```

And inside `renderCanvas`, no closure over `S` — only over the parameters.

### Migration Strategy

1. Add `doc` and `session` as parallel state alongside `S`; have `S` continue to exist temporarily as a derived view.
2. Add `updateDoc` and `updateSession`; have the old `update()` route to them based on what changed.
3. Migrate one renderer at a time to take explicit `doc`/`session` parameters.
4. Migrate ad-hoc `S = { ...S, ui: ... }` sites to `updateSession({ ui: ... })`. Grep-driven; mechanical.
5. Delete the legacy `S` view and the legacy `update()` once nothing references them.

### Acceptance

- Every `S = { ...S` and `S = { ...S, ui: ...` mutation in `studio.js` is gone, replaced by `updateDoc` or `updateSession`.
- Setting `activeMedia` does not push a history snapshot and does not trigger autosave.
- Setting `textContent` on a node does push a history snapshot and triggers autosave.
- Undo/redo behavior is unchanged from the user's perspective.

### Risks and Mitigations

- **Risk:** Some site assumed it could mutate `S.ui` and then synchronously read it back before re-render. *Mitigation:* `updateSession` is synchronous; callers read from the new value, not from a captured stale reference.
- **Risk:** Middleware (autosave) needs to know whether a change affects the document. *Mitigation:* Run middleware only on `updateDoc`, not `updateSession`.

---

## Phase 3: Lift Transient View State out of Module Globals

**Effort:** 1–2 days
**Risk:** Low (refactor, no semantic change)
**Addresses:** The "everything reaches into everything" problem. Makes renderer dependencies explicit.

### Change

The following `let`s currently live at module scope in `studio.js`:

```
panzoomWrap, panX, panY, needsCenter, centerObserver,
canvasMode, prevCanvasMode,
componentInlineEdit, pendingInlineEdit, _inlineEditCleanup,
monacoEditor, functionEditor,
liveScope, blockActionBarEl, linkPopoverHost,
selDragCleanup, dndCleanups, canvasDndCleanups, canvasEventCleanups,
_forcedStyleTag, _forcedAttrEl, _currentDropTargetRow, layerDragSourceHeight,
_completionRegistered, autosaveTimer, lastDragInput,
showAddBreakpointForm, addBreakpointPreview,
elementsCollapsed, elementsFilter,
zoomIndicatorHost, datalistHost, // etc.
```

Plus the `ctx` object in `store.js` was clearly intended as a destination for these but only partially used.

Group them by owner and move them into per-component view objects:

```js
// canvas-view.js
const canvasView = {
  mode: "design",
  prevMode: null,
  panX: 0,
  panY: 0,
  panzoomWrap: null,
  panels: [],            // was canvasPanels
  elToPath: new WeakMap(), // was the module-scoped one
  needsCenter: true,
  centerObserver: null,
  monacoEditor: null,
  functionEditor: null,
  liveScope: null,
  inlineEdit: null,      // was componentInlineEdit
  pendingInlineEdit: null,
  cleanups: { dnd: [], events: [] },
  // ...
};
```

Similarly: `floatingView` (blockActionBarEl, linkPopoverHost, zoomIndicatorHost), `dragView` (cleanups, drop indicators), `editorView` (Monaco state).

Functions that need these take them as parameters (or close over them within the owning module), instead of reaching into module-global state.

### Why This Matters

Today, `renderCanvas` modifies `canvasPanels` and `elToPath`; then `registerPanelDnD` reads `canvasPanels`; then `renderOverlays` reads `canvasPanels` and `elToPath`; then `enterComponentInlineEdit` modifies `componentInlineEdit`; and on and on. The data flow is invisible because everything is a free-floating `let`.

Once the view objects are explicit, you can see at a glance which functions read which view object, and which view object belongs to which component. Components that don't share a view object can't break each other.

### Migration Strategy

Per component, in this order: canvas-view → floating-view → drag-view → editor-view. Each is a self-contained move; no phase blocks the next.

### Acceptance

- `studio.js` has zero module-scoped `let` variables for mutable view state.
- Every transient piece of view state has exactly one owning view object.
- Cross-module reads happen through exported accessor functions, not by direct import of mutable state.

---

## Phase 4: Componentize the Panels

**Effort:** 3–5 days
**Risk:** Medium (largest structural change)
**Addresses:** The remaining "renderer failure can corrupt neighbor" risk. Makes each panel testable in isolation. Sets up Phase 6.

### Change

Each of the major UI regions becomes a self-contained module with a stable public API:

- `panels/canvas/index.js` — owns the canvas, panzoom, overlays, inline editing, component navigation, source/edit/manage/settings modes.
- `panels/left/index.js` — owns the left panel and its tabs (layers, files, blocks, state, data, head, imports).
- `panels/right/index.js` — owns the right panel and its tabs (properties, events, style).
- `panels/toolbar/index.js` — owns the toolbar (already partially extracted).
- `panels/statusbar/index.js` — owns the statusbar (already extracted).

Each module exports:

```js
export function mount(rootEl, getState);  // attach to a DOM root; subscribe to state
export function unmount();                 // remove listeners, clean up view state
export function render();                  // re-render from current state
```

The module owns its own DOM root, its own event listeners (set up once in `mount`, torn down in `unmount`), its own view state (from Phase 3), and its own error boundary.

The render entry point in `studio.js` becomes:

```js
canvas.mount(document.querySelector("#canvas-wrap"), getState);
leftPanel.mount(document.querySelector("#left-panel"), getState);
// ...
```

State subscription: each panel subscribes to the state slices it cares about. When `updateDoc` or `updateSession` fires, the dispatcher notifies subscribers; each panel decides whether to re-render based on what changed.

### Subscription Model

```js
// store.js
const subscribers = new Set();

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notify(change) {
  for (const fn of subscribers) {
    try { fn(change); }
    catch (e) { console.error("Subscriber failed:", e); }
  }
}
```

`change` is a small object: `{ doc: boolean, selection: boolean, hover: boolean, ui: Set<string>, mode: boolean }`. Panels filter on it.

### Why This Matters

This is where "renderer isolation" becomes real isolation, not just a `try/catch` wrapper. After this phase:

- A bug in the canvas module cannot affect the left panel because the left panel is subscribed to state, not to the canvas.
- Cleanup is per-component, owned by `unmount`, not by a global array.
- Persistent floating UI (block action bar, link popover, zoom indicator) is owned by the canvas module — nothing else writes to those hosts, eliminating the Lit-marker corruption class of bug.

### Acceptance

- Each panel module can be `unmount`ed and `mount`ed independently without affecting any other panel.
- A unit test can `mount` a single panel with a synthetic state and assert on its DOM.
- The cross-panel side effects in current `studio.js` (e.g. `updateActivePanelHeaders()` called from `renderRightPanel`) are replaced with state changes that each affected panel reads.

### Risks and Mitigations

- **Risk:** Tightly-coupled cross-panel interactions (e.g. clicking a layer in the left panel both selects in the canvas and updates the right panel) might be harder to express. *Mitigation:* These already go through state today (`update(selectNode(...))`); the subscription model handles them naturally.
- **Risk:** Migration takes time and risks regressions. *Mitigation:* Do one panel at a time; keep the others on the old path until each is migrated.

---

## Phase 5: Lit-html Host Hygiene

**Effort:** Half a day after Phase 4
**Risk:** Low
**Addresses:** Marker corruption on persistent floating hosts. Eliminates the existing `try/catch/replaceWith` workaround.

### Change

After Phase 4, persistent floating UI (`blockActionBarEl`, `linkPopoverHost`, `zoomIndicatorHost`) is owned by the canvas module. The rules become:

1. **Each persistent Lit host has exactly one writer.** The canvas module renders to `blockActionBarEl`; nothing else does.
2. **Forced-pseudo `<style>` injection moves out of `document.head` into a dedicated container owned by the canvas module.** Today's `_forcedStyleTag` appended to `document.head` works but is sloppy; the same `<style>` element gets created and destroyed on every state change. Replace with a single persistent `<style>` whose `textContent` is updated in place.
3. **The `contentEditable` toggling for inline editing must not touch any DOM Lit owns.** Today the inline-edit code mutates `textContent` directly on Lit-rendered nodes during `enterComponentInlineEdit`. Either route those mutations through state (so the next render produces the right DOM), or move the inline-editable surface into a host Lit doesn't manage.

Delete the `try/catch/replaceWith` defensive code in `renderZoomIndicator`. If it's still needed after Phase 4, that's a bug to investigate, not paper over.

### Acceptance

- The `try/catch/replaceWith` defensive code in `renderZoomIndicator` is removed.
- No Lit host receives writes from more than one call site.
- Manual stress test: rapidly toggle modes, select, inline-edit, switch documents — no console errors, no broken Lit hydration.

---

## Phase 6: Async as State

**Effort:** 2–3 days
**Risk:** Medium
**Addresses:** Race conditions between async runtime rendering and synchronous user input. Eliminates `pendingInlineEdit` and most `requestAnimationFrame` choreography.

### Change

`renderCanvasLive` is currently `async` and returns a promise. The rest of the system dances around that — `pendingInlineEdit` exists because the user might select an element before the canvas has finished rendering it; `requestAnimationFrame` chains exist because we need to wait for the runtime's `connectedCallback`s to fire.

Replace this with a state machine:

```js
// session.canvas
{
  status: "idle" | "loading" | "ready" | "error",
  scope: null | LiveScope,
  error: null | Error,
  pendingInlineEdit: null | { path, mediaName },
}
```

The canvas renderer becomes synchronous and pure:

- `status: "loading"` → render the panel structure with a spinner or skeleton.
- `status: "ready"` → render the panel structure and call the runtime to populate it; the runtime call is async but is *kicked off* from a `useEffect`-equivalent (post-render hook), not from inside the render itself.
- `status: "error"` → render an error panel with the message and a retry button.

When the async work completes, it dispatches `updateSession({ canvas: { status: "ready", scope } })`, which triggers a re-render with the new state.

`pendingInlineEdit` moves into `session.canvas.pendingInlineEdit`. The canvas module's post-render hook checks: "is the canvas ready, and is there a pending inline edit, and does the target element now exist?" — if yes, enter inline edit and clear the pending field.

### Why This Matters

The current pattern is "render, then schedule a callback for after async work, then maybe do the thing." That callback closes over state that may have changed by the time it runs. When the state has changed underneath, you get the bugs you're seeing — clicks landing on the wrong elements, inline edits opening on the wrong node, overlays misaligned after a mode switch.

The state-machine pattern is "render whatever the current state says." If state changes, you render again. Callbacks don't carry stale state because there are no callbacks holding state.

### Acceptance

- `pendingInlineEdit` as a module-scoped `let` is gone; it lives in session state.
- `requestAnimationFrame` calls in `studio.js` are reduced to those that actually need a paint boundary (e.g. measuring layout), not those that exist for async coordination.
- Switching modes rapidly while canvas is mid-render does not produce errors or stuck UI.

### Risks and Mitigations

- **Risk:** Some async work has side effects beyond "produce a scope" (e.g. defining custom elements globally). *Mitigation:* Those side effects are idempotent — registering the same custom element twice is a no-op. Status tracking is for UI; the side effects can fire whenever.
- **Risk:** Loading states might flash for fast renders. *Mitigation:* If `status` transitions `idle → loading → ready` within a frame, skip the loading paint (debounce the spinner).

---

## Phase 7 (Optional): Selective Subscriptions

**Effort:** 1–2 days
**Risk:** Low
**Addresses:** Wasted re-renders. Becomes possible once Phases 2 and 4 are done.

### Change

Today every state change triggers consideration in every renderer. After Phase 4 each panel subscribes; after Phase 2 changes carry information about *what* changed. Phase 7 is fine-tuning: each panel declares its subscriptions explicitly.

```js
// panels/right/index.js
const subscriptions = ["doc.document", "session.selection", "session.ui.rightTab",
                       "session.ui.activeMedia", "session.ui.activeSelector"];
```

The dispatcher matches changes against subscriptions and only notifies panels with relevant changes.

This is a performance optimization, not a correctness fix. Do it only if measurement shows it's needed.

---

## What Each Phase Delivers (Summary)

| Phase | Lands | User-visible? | Reversible? |
|---|---|---|---|
| 1. Error boundaries | Crash isolation between renderers | No | Trivially |
| 2. Doc/session split | Routed state changes, no bypasses | No | With effort |
| 3. View state in objects | No module-global view state | No | With effort |
| 4. Componentize panels | True isolation between panels | No | Each panel independently |
| 5. Lit host hygiene | No marker corruption workarounds | No | Trivially |
| 6. Async as state | No race conditions on inline edit | No | With effort |
| 7. Selective subscriptions | Fewer wasted re-renders | Maybe (perf) | Trivially |

## Recommended Order

Phases 1, 2, 3 are independent and can land in any order. Phase 4 benefits from Phase 3 being done first (it has less to move) but doesn't require it. Phase 5 requires Phase 4. Phase 6 benefits from Phase 4 (the state machine lives somewhere clean) but doesn't strictly require it. Phase 7 requires Phases 2 and 4.

**Suggested sequence:** 1 → 2 → 3 → 4 → 5 → 6 → (7 if needed).

If time is short and only one phase ships, ship Phase 1. If two, ship 1 and 2. The marginal value drops gradually after that, but each phase remains useful in isolation.

## Out of Scope / Future Work

- **Multi-window / multi-tab editing.** Would motivate a real CRDT. Revisit then.
- **Plugin/extension API.** Would also motivate CRDT-like conflict resolution. Same.
- **Web component refactor of panels.** A natural next step after Phase 4; turns each panel module into a real Lit element with shadow DOM. Defer unless a concrete need (style isolation, embeddability) emerges.
- **Performance work on the document mutators.** `structuredClone` on every edit is fine for now; revisit if profiling shows it as a bottleneck on large documents.
- **State persistence in IndexedDB.** Currently goes through the PAL. If multi-tab editing happens, this becomes relevant.

## Open Questions

1. **Should `documentStack` (component navigation frames) live in `doc` or `session`?** Currently it's deeply intertwined with editing state. Argument for `doc`: it's persisted across reloads via the file handle. Argument for `session`: it's not meaningful without the open file. **Recommendation:** session. Reload restores the file, not the navigation stack.

2. **Should `dirty` live in `doc` or `session`?** It's about the doc, but it's session-scoped (other clients of the same file don't share it). **Recommendation:** doc, because autosave middleware needs it and middleware runs on `updateDoc`.

3. **Should `history` survive document close?** Today it doesn't. Worth keeping that behavior unless there's demand otherwise.

4. **Should panel components share a render scheduler (e.g. one `requestAnimationFrame` for all updates per frame)?** Probably yes after Phase 4, but only if measurement shows multiple renders per frame in practice. Phase 7 territory.