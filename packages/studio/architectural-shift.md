# Architectural Analysis: Jx Studio

I've read through your code carefully. You've built something substantial here — a visual editor with multi-breakpoint canvases, live runtime rendering, inline editing, drag-and-drop, Monaco integration, and a metadata-driven inspector. The architecture is more coherent than you might think from inside it. But you're right that something is off, and the "canvas error destroys the sidebars" symptom is diagnostic of a deeper issue.

Let me start with that specific symptom and work outward, because it points directly at the core architectural problem.

## The Core Problem: Implicit Global Coupling Through a Mutable Singleton

Your `update()` function in `store.js` runs renderers in sequence:

```js
renderToolbar();
renderCanvas();   // <-- if this throws...
renderLeftPanel(); // <-- this never runs
renderRightPanel();
```

There's no `try/catch` around individual renderers, so one renderer's failure cascades. That's the immediate fix (wrap each renderer call), but it's a symptom, not the disease. The disease is that **`renderCanvas`, `renderLeftPanel`, and `renderRightPanel` aren't really independent** — they all reach into the same mutable `S` and the same DOM globals (`canvasPanels`, `elToPath`, `panzoomWrap`, `componentInlineEdit`, `blockActionBarEl`, `linkPopoverHost`, `pendingInlineEdit`, `monacoEditor`, `functionEditor`, etc.).

When canvas rendering fails partway through, it can leave `canvasPanels` half-populated, `elToPath` referring to detached nodes, `panzoomWrap` pointing at a removed element, or `componentInlineEdit` pointing at an element that's no longer in the DOM. The next renderer reads that corrupted state and either crashes or produces wrong output. The renderers *look* independent (they're registered separately with `registerRenderer`) but they share a giant implicit substrate.

This is the single biggest architectural issue, and almost every other papercut traces back to it. Let me enumerate the specific manifestations before suggesting fixes.

### Manifestation 1: `S` is a "moving target" mutated from many places

You have a state module (`state.js`) with clean immutable mutators (`applyMutation`, `selectNode`, `updateProperty`, etc.) that produce new state objects. Good. But then `studio.js` does this constantly:

```js
S = { ...S, ui: { ...S.ui, activeMedia: newMedia } };
updateActivePanelHeaders();
renderRightPanel();
```

These ad-hoc mutations bypass `update()`, which means:
- Middleware (autosave) doesn't run
- Post-render hooks don't run
- Only the renderers you remembered to call get called
- History snapshots don't get pushed (but `dirty` doesn't get set either, which is sometimes intentional and sometimes a bug)

Search the file for `S = { ...S` and you'll find dozens of these. Each one is a place where the state machine got bypassed because going through `update()` would have triggered too much (or the wrong) work. That's a signal that `update()` is doing too much — it's not a state transition, it's a state transition *plus* a full UI repaint.

### Manifestation 2: The renderers are not pure functions of state

`renderCanvas` reads `S.document`, but it also reads `canvasMode`, `prevCanvasMode`, `panX`, `panY`, `panzoomWrap`, `centerObserver`, `monacoEditor`, `functionEditor`, `componentInlineEdit`, `pendingInlineEdit`, `blockActionBarEl`, `linkPopoverHost`, and `canvasPanels`. It writes to most of those too. Plus async — `renderCanvasLive` returns a promise, and during that promise window the user can click, type, switch modes, or trigger another render.

When a renderer is impure and async, "render again" doesn't return you to a known state — it returns you to *whatever state the async operations happen to leave behind*. That's why you have all the `requestAnimationFrame(...)` calls and `pendingInlineEdit` flags trying to coordinate between renders.

### Manifestation 3: Lit-html state lives outside the framework

You have ad-hoc render hosts created at module scope:

```js
const datalistHost = document.createElement("div");
let zoomIndicatorHost = document.createElement("div");
linkPopoverHost = document.createElement("div");
blockActionBarEl = ... // createFloatingContainer()
```

And then defensive code for when lit-html's markers get corrupted:

```js
try {
  litRender(html`...`, zoomIndicatorHost);
} catch {
  const newHost = document.createElement("div");
  newHost.style.display = "contents";
  zoomIndicatorHost.replaceWith(newHost);
  zoomIndicatorHost = newHost;
  litRender(...) // retry
}
```

The fact that you needed to write this `try/catch/replaceWith` pattern is a tell: something else in your code is reaching into the DOM that lit-html owns and modifying it, which destroys lit-html's internal comment markers. The forced-pseudo `<style>` tag injection, the inline edit `contentEditable` toggling, and the runtime's `onNodeCreated` callback all touch DOM that overlaps with lit-rendered regions.

### Manifestation 4: Cleanup is manual and bug-prone

You have parallel arrays of cleanup functions: `dndCleanups`, `canvasDndCleanups`, `canvasEventCleanups`, `_inlineEditCleanup`, `selDragCleanup`, `_forcedStyleTag`, `_forcedAttrEl`, `_outsideHandler`. Each is registered in one place, cleared in another, sometimes leaked, sometimes double-cleared. Missing one cleanup means stale closures with stale state — exactly the kind of bug that's hard to reproduce and gets worse over time.

## What I'd Actually Change

I want to be careful here: I am **not** suggesting you rewrite this in React or Vue or Solid. You've written a lit-html-based vanilla app and the structure mostly works. The fixes should be incremental, target specific failure modes, and preserve what's working. Here's my prioritized recommendation.

### 1. Error boundaries around each renderer

This is the smallest possible change that addresses your stated symptom. In `store.js`:

```js
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

And in `update()`, wrap each individual renderer call. This won't fix the *cause* but it stops one bad render from nuking the whole UI. Do it today.

### 2. Make state transitions explicit and routed

Stop doing `S = { ...S, ui: { ...S.ui, ... } }; renderXxx()` scattered throughout `studio.js`. Every state change should go through `update()`. To make this tolerable, `update()` needs to be smarter about what it re-renders — and that's actually the easier fix.

Track *what changed*, not just *that something changed*. A simple approach:

```js
function update(newState, options = {}) {
  const prev = S;
  S = newState;
  
  const changed = {
    document: prev.document !== S.document,
    selection: !pathsEqual(prev.selection, S.selection),
    hover: !pathsEqual(prev.hover, S.hover),
    ui: prev.ui !== S.ui,
    mode: prev.mode !== S.mode,
    // ...
  };
  
  if (changed.document || changed.mode) safeRender("canvas");
  if (changed.document || changed.selection) safeRender("leftPanel");
  if (changed.selection || changed.ui) safeRender("rightPanel");
  // etc.
}
```

This is what your `_update` function is trying to do already, but the "what changed" inference is ad-hoc and the renderers themselves still re-read everything anyway. Making it explicit means a `setActiveMedia(name)` call can do `update({ ...S, ui: { ...S.ui, activeMedia: name } })` and the system figures out that only the right panel and the overlays need to repaint — no need for ad-hoc bypasses.

### 3. Lift impure side-state out of "globals" into a typed context

Right now `panzoomWrap`, `componentInlineEdit`, `monacoEditor`, `functionEditor`, etc. are module-scoped `let`s in `studio.js`. The `ctx` object in `store.js` was clearly meant to be where they'd live eventually — finish that migration. But more importantly, **separate transient view state from persistent app state**.

Persistent app state (in `S`):
- `document`, `selection`, `hover`, `history`, `ui.zoom`, `ui.activeMedia`, `ui.leftTab`, etc.

Transient view state (in a `view` object or per-component refs):
- `panzoomWrap` ref, `canvasPanels` array, `elToPath` WeakMap
- `componentInlineEdit` session, `monacoEditor` instance
- Cleanup functions

The reason to separate them: persistent state should be the input to renderers; transient view state is the *output* of renderers (the DOM and its associated bookkeeping). When you mix them, renderers become non-deterministic functions of themselves.

### 4. Component-ize the panels

This is the biggest structural change and I'd save it for after the above. Right now `renderRightPanel`, `renderLeftPanel`, `renderCanvas`, and `renderToolbar` are 200-1000-line procedural functions in one file. They each have their own state, their own cleanup, their own event registration. They are components in everything but name.

The lit-html way to do this is to define them as web components (Lit elements) or as encapsulated render functions with their own context object. Each owns:
- Its DOM root
- Its event listeners (set up in `connectedCallback` or registration, torn down once)
- Its derived state (memoized from `S`)
- Its cleanup

The benefit isn't "code organization" — it's that each component becomes an isolation boundary for failures. The right panel can't crash the canvas because they don't share execution context, they only share state, and state reads are pure.

This is also where you'd address the lit-marker corruption. Each persistent floating UI (zoom indicator, link popover, block action bar) becomes its own Lit element with its own shadow DOM (or at least its own well-isolated container), and nothing else in the app reaches into those containers.

### 5. Move async coordination out of renderers

`renderCanvasLive` is async and the rest of the code dances around that with `pendingInlineEdit`, `requestAnimationFrame` chains, and post-render hooks. The pattern I'd reach for: render synchronously to a placeholder/loading state, kick off the async work, and on completion `update()` the state again with the result. So the renderer is always synchronous and pure; "the canvas is currently loading" is a state, not a procedure.

Concretely: instead of `renderCanvasLive(doc, canvas).then(scope => { liveScope = scope; ... })`, you'd have `S.canvas.status: 'loading' | 'ready' | 'error'` and the renderer just renders whatever the current status is. The async work mutates state when done. This eliminates a whole class of "what if the user clicked something while the runtime was registering custom elements" race conditions.

## What I Would Not Change

- **The state.js mutator API.** `applyMutation`, `insertNode`, `moveNode`, etc. are clean, immutable, and well-factored. This is the strongest part of the codebase.
- **Lit-html itself.** It's the right tool. The problems aren't lit-html's fault; they're caused by code reaching around it.
- **The Platform Abstraction Layer.** Clean boundary, exactly right.
- **The file/panel split into separate modules.** The trajectory is good; just finish it.
- **The metadata-driven inspector** (`css-meta`, `html-meta`, `stylebook-meta`). This is sophisticated and probably the right call given the breadth of properties.

## A Concrete Ordering

If I were sitting at this codebase, my next five commits would be:

1. **Error boundaries around renderers in `store.js`.** Stops the immediate "canvas crash takes down sidebars" symptom. ~30 lines of code.
2. **A `setUiField(field, value)` helper** that funnels every `S = { ...S, ui: { ...S.ui, [x]: y } }` through `update()` with a flag indicating it's a UI-only change so renderers can skip canvas work. Audit and replace all the ad-hoc spreads in `studio.js`. This makes state changes traceable.
3. **Move `panzoomWrap`, `componentInlineEdit`, `monacoEditor`, `functionEditor`, `pendingInlineEdit`, the cleanup arrays, and `canvasPanels` from `studio.js` locals into a `view` object** owned by the canvas module. Pass it explicitly to functions that need it. This breaks the "everything reaches into everything" pattern.
4. **Extract the right panel into its own module** (or web component) with its own render function, its own event handlers, and a single subscription to `S`. Repeat for left panel, toolbar, statusbar. After this step the renderers really are isolated.
5. **Convert `renderCanvasLive` to synchronous-render-then-state-update.** Introduce `S.canvas.status` and remove `pendingInlineEdit` and most of the `requestAnimationFrame` choreography.

After those five, you'd have an app where one panel can't kill another, state changes are auditable, async doesn't race with sync, and adding a new panel or canvas mode is mechanical rather than perilous. None of those steps requires a framework change or a rewrite.

The two questions I'd want to verify before committing to this order: how often does the canvas crash actually happen in practice (i.e. is step 1 enough on its own for a long while), and is there anything in your roadmap — collaborative editing, undo across files, multi-window — that would push you toward a different state model entirely (like a CRDT or an event-sourced store)? If you're staying single-user-single-document, the path above is right-sized. If you're heading toward multiplayer, the state layer needs more thought before the view layer does.