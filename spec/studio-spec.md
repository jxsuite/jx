# JSONsx Studio Specification
## Visual Builder for the Declarative Document Object Model

**Version:** 0.1.0-draft  
**Status:** In Progress  
**Depends on:** JSONsx Specification v0.8.0+  
**License:** MIT

---

## Table of Contents

1. [Overview](#1-overview)
2. [Design Principles](#2-design-principles)
3. [Architecture](#3-architecture)
4. [State Model](#4-state-model)
5. [Layout](#5-layout)
6. [Canvas](#6-canvas)
7. [Layer Panel](#7-layer-panel)
8. [Inspector Panel](#8-inspector-panel)
9. [Block Library](#9-block-library)
10. [Toolbar](#10-toolbar)
11. [Drag and Drop](#11-drag-and-drop)
12. [Selection Model](#12-selection-model)
13. [Overlay System](#13-overlay-system)
14. [Undo / Redo](#14-undo--redo)
15. [File Operations](#15-file-operations)
16. [Keyboard Shortcuts](#16-keyboard-shortcuts)
17. [Dependency Stack](#17-dependency-stack)
18. [Novel Code Budget](#18-novel-code-budget)
19. [Implementation Phases](#19-implementation-phases)

---

## 1. Overview

The JSONsx Studio is a browser-based visual editor for authoring JSONsx JSON component files. It is a developer tool — not an end-user product — intended to accelerate the authoring of `.json` app and components providing a live WYSIWYG canvas, a layer tree, and a property inspector, all driven by a single immutable JSONsx JSON document as the source of truth.

The builder is itself a web application. Its UI panels are written as JSONsx components where possible, consuming their own runtime. The canvas renders live JSONsx output directly — there is no simulation layer or shadow representation. What the user sees in the canvas is the JSONsx runtime rendering the document, not a builder-specific preview.

### What the builder produces

For each editing session, the builder reads and writes a pair of files:

```
component.json    ← edited by the builder
component.js      ← displayed read-only; handler stubs can be generated
```

The builder's persistent output is always valid JSONsx JSON. It never writes proprietary builder metadata into the JSON — the output file is indistinguishable from hand-authored JSONsx.

---

## 2. Design Principles

### 2.1 JSON is the source of truth

The builder operates on a JSONsx JSON document tree. All user interactions — drag, drop, property edits, style changes — produce mutations to that JSON tree. The canvas, layer panel, and inspector are all derived views of the same underlying JSON state. There is no secondary component model, no internal representation that diverges from the spec.

### 2.2 The canvas is the runtime

The canvas area renders the JSONsx document using the JSONsx runtime library directly. There is no builder-specific renderer. This means the builder is always showing real output, not a simulation. It also means every JSONsx runtime feature works in the builder automatically, including signals, computed values, and Web API namespaces (where data is available).

### 2.3 Zero proprietary lock-in

The JSON files produced by the builder are identical to files a developer would write by hand. Opening a hand-authored JSONsx file in the builder and saving it without changes must produce an identical file. The builder adds no annotations, IDs, or metadata to the JSON.

### 2.4 Self-hosting by design

The builder's chrome — toolbar, layer panel, inspector, block library — is progressively migrated to JSONsx components over time. The long-term goal is a builder that is itself a JSONsx application editing JSONsx applications. Early versions may use plain HTML for chrome while the runtime matures; this spec tracks the intended final state.

### 2.5 Developer-first UX

The builder is a developer tool. It surfaces the underlying JSON structure clearly rather than hiding it. A JSON source view is always one click away. Property names use the JSONsx spec vocabulary (`tagName`, `className`, `$defs`, `$ref`) rather than invented friendly names.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Builder Application                   │
│                                                         │
│  ┌──────────┐  ┌───────────────────────┐  ┌──────────┐ │
│  │  Layer   │  │        Canvas         │  │Inspector │ │
│  │  Panel   │  │  (JSONsx runtime live)  │  │  Panel   │ │
│  │          │  │                       │  │          │ │
│  │  drag-   │  │  ┌─────────────────┐  │  │  reads   │ │
│  │  drop    │  │  │  Overlay System  │  │  │  $defs   │ │
│  │  tree    │  │  │ (selection/hover)│  │  │  schema  │ │
│  └────┬─────┘  │  └─────────────────┘  │  └────┬─────┘ │
│       │        └───────────┬───────────┘       │       │
│       └────────────────────┼───────────────────┘       │
│                            │                           │
│              ┌─────────────▼─────────────┐             │
│              │       Builder State        │             │
│              │  (immutable JSON tree +   │             │
│              │   selection + history)    │             │
│              └─────────────┬─────────────┘             │
│                            │                           │
│              ┌─────────────▼─────────────┐             │
│              │      JSONsx JSON Document    │             │
│              │    component.json (disk)   │             │
│              └───────────────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### Data flow

All data flows in one direction:

1. **User action** (click, drag, type) in any panel
2. **Mutation function** produces a new immutable JSON tree
3. **State update** pushes new tree to history stack, updates selection
4. **All panels re-render** from new state — canvas, layers, inspector simultaneously
5. **Autosave** writes JSON to disk/storage on debounce

No panel directly modifies another panel's state. All communication is through the central builder state.

---

## 4. State Model

The builder maintains a single state object:

```js
{
  // The current JSONsx JSON document — immutable, replaced on every edit
  document: { /* JSONsx JSON */ },

  // The path to the selected node within the document tree
  // e.g. ['children', 2, 'children', 0]
  // null when nothing is selected
  selection: null | Array<string | number>,

  // The path to the hovered node (for overlay rendering)
  hover: null | Array<string | number>,

  // Undo history — array of past document states
  // Current document is always history[historyIndex]
  history: Array<{ document, selection }>,
  historyIndex: number,

  // Whether unsaved changes exist
  dirty: boolean,

  // The path to the currently open .json file
  filePath: string | null,

  // Companion .js file contents (read-only display)
  handlersSource: string | null,

  // Builder UI state (not persisted to JSON)
  ui: {
    activePanel: 'layers' | 'inspector' | 'source',
    blockLibraryOpen: boolean,
    zoom: number,           // canvas zoom 0.25–4.0
    canvasMode: 'canvas' | 'tree',  // see §6
  }
}
```

### Mutation API

All state changes go through named mutation functions. No code writes to state directly.

```js
// Document mutations
applyMutation(state, mutationFn)   // produce new state with updated document
selectNode(state, path)            // update selection
hoverNode(state, path)             // update hover
undo(state)                        // walk history back
redo(state)                        // walk history forward

// Convenience mutations (all call applyMutation internally)
insertNode(state, parentPath, index, nodeDef)
removeNode(state, path)
moveNode(state, fromPath, toPath, index)
updateProperty(state, path, key, value)
updateStyle(state, path, styleKey, value)
addSignal(state, componentPath, name, def)
removeSignal(state, componentPath, name)
addHandler(state, componentPath, name)
```

### Immutability

`applyMutation` uses `structuredClone` to produce a new document on every edit. The history stack stores snapshots. This is the enabling mechanism for undo/redo and for the overlay system's ability to diff previous and current states.

```js
function applyMutation(state, mutationFn) {
  const newDoc = structuredClone(state.document);
  mutationFn(newDoc);                              // mutate the clone
  const newHistory = state.history
    .slice(0, state.historyIndex + 1)              // truncate redo branch
    .concat({ document: newDoc, selection: state.selection });
  return {
    ...state,
    document: newDoc,
    history: newHistory,
    historyIndex: newHistory.length - 1,
    dirty: true,
  };
}
```

---

## 5. Layout

The builder occupies the full browser viewport. Layout is three columns:

```
┌──────────────┬─────────────────────────┬──────────────┐
│              │        Toolbar           │              │
│  Left Panel  ├─────────────────────────┤  Right Panel │
│              │                         │              │
│  Block       │        Canvas           │  Inspector   │
│  Library     │                         │              │
│  (collapsed) │  (JSONsx runtime output)  │  (selected   │
│              │                         │   node props)│
│  Layer Tree  │                         │              │
│              │                         │              │
│              ├─────────────────────────┤              │
│              │     Status Bar          │              │
└──────────────┴─────────────────────────┴──────────────┘
```

### Column sizing

Left panel: 240px fixed, resizable.  
Right panel: 280px fixed, resizable.  
Canvas: fills remaining width.  
All three panels scroll independently.

### Panel tabs

**Left panel tabs:**
- Layers (default) — the drag-drop component tree
- Blocks — component library for dragging onto canvas

**Right panel tabs:**
- Properties (default) — inspector for selected node
- Source — read-only JSON view of selected node
- Handlers — read-only view of companion `.js` file

---

## 6. Canvas

### 6.1 Rendering

The canvas renders the JSONsx document using the JSONsx runtime:

```js
import { JSONsx } from '@jsonsx/runtime';

// On every state.document change:
canvasEl.innerHTML = '';
await JSONsx(state.document, canvasEl);
```

The canvas element is a plain `<div>` inside the builder layout, not an iframe. This means the rendered JSONsx output shares the builder's DOM context, which enables the overlay system to use standard `getBoundingClientRect()` without cross-frame complications.

The canvas has `pointer-events: none` applied to its JSONsx-rendered children during editing mode, so clicks are intercepted by the overlay system rather than triggering the components' own event handlers.

### 6.2 Zoom and scroll

The canvas div is wrapped in a scroll container. Zoom is implemented via CSS `transform: scale(zoom)` on the canvas element with `transform-origin: top left`. The overlay system accounts for zoom when positioning overlays.

### 6.3 Canvas modes

**Canvas mode** (default): The standard WYSIWYG view. Components render at full fidelity. The overlay system shows selection and hover highlights. Drag handles appear on selected nodes.

**Tree mode**: An alternative view where the layer tree expands to fill the canvas area, and each node row renders its JSONsx output inline as a compact preview. This is useful for deeply nested structures. Toggle via toolbar button or keyboard shortcut `T`.

### 6.4 Responsive preview

The toolbar provides device width presets:

| Label | Width |
|---|---|
| Desktop | Full canvas width |
| Tablet | 768px |
| Mobile | 375px |

Selecting a preset constrains the canvas to that width and centers it. The JSONsx runtime re-renders at the new width, enabling responsive design verification.

---

## 7. Layer Panel

### 7.1 Structure

The layer panel displays the JSONsx document as a nested, drag-and-drop sortable tree. Each row represents one element definition object in the JSONsx JSON tree.

### 7.2 Row anatomy

Each row displays from left to right:

- **Indent** — visual nesting depth, 16px per level
- **Collapse toggle** — `▶` / `▼` for nodes with children; blank for leaves
- **Type badge** — small colored tag showing `tagName` value
- **Label** — component `$id` if set, else `tagName`, else first text content truncated to 24 chars
- **Signal indicator** — `⚡` dot if node has any `$defs` entries with `signal: true`
- **Handler indicator** — `ƒ` dot if node has any `$handler: true` entries
- **Visibility toggle** — eye icon, sets `hidden: true` on the node (non-destructive)
- **Delete button** — appears on hover only

### 7.3 Selection sync

Clicking a row in the layer panel selects that node (updates `state.selection`). Clicking a node in the canvas selects the same row in the layer panel and scrolls it into view. Selection is always the same path in both views — they are two presentations of one selection state, not two separate selections that are kept in sync.

### 7.4 Drag and drop

Tree drag-and-drop is implemented using `@atlaskit/pragmatic-drag-and-drop` core with the `@atlaskit/pragmatic-drag-and-drop-hitbox` tree hitbox package.

Each row element is registered as both a draggable and a drop target:

```js
import { draggable, dropTargetForElements, monitorForElements }
  from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachInstruction, extractInstruction }
  from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item';

// Per row element:
const cleanup = combine(
  draggable({
    element: rowEl,
    dragHandle: handleEl,      // drag only from ⠿ handle
    getInitialData: () => ({ path: nodePath }),
  }),
  dropTargetForElements({
    element: rowEl,
    getData: ({ input, element }) => attachInstruction(
      { path: nodePath },
      {
        input,
        element,
        currentLevel: depth,
        indentPerLevel: 16,
        // Disable make-child for leaf-only nodes (e.g. text nodes)
        block: isLeafOnly(nodeDef) ? ['make-child'] : [],
      }
    ),
    onDrop: ({ self, source }) => {
      const instruction = extractInstruction(self.data);
      applyDropInstruction(instruction, source.data.path, nodePath);
    },
  })
);
```

### 7.5 Drop instructions

The hitbox tree package produces one of four instructions on drop:

| Instruction | Action |
|---|---|
| `reorder-above` | Insert dragged node before target in parent's children |
| `reorder-below` | Insert dragged node after target in parent's children |
| `make-child` | Append dragged node as last child of target |
| `instruction-blocked` | No-op — drop not permitted here |

`applyDropInstruction` translates the instruction into a `moveNode` state mutation.

### 7.6 Drop indicator

A thin horizontal line (2px, accent color) is rendered between rows to indicate the pending drop position. For `make-child` instructions, the target row gets a border highlight instead. The indicator is a positioned `<div>` in the layer panel, not part of the individual row elements, to avoid layout shifts.

---

## 8. Inspector Panel

### 8.1 Overview

The inspector displays editable controls for the currently selected node's properties. It reads the node definition from `state.document` at `state.selection` and renders appropriate inputs based on property type and the node's `$defs` schema.

The inspector is organized into collapsible sections.

### 8.2 Sections

**Element** — core DOM properties:
- `tagName` (text input, validated against HTML element names)
- `id` (text input)
- `className` (tag input — space-separated tokens shown as removable chips)
- `textContent` (text area, shown only when node has no children)
- `hidden` (toggle)
- `tabIndex` (number input)

**Attributes** — the `attributes` object, rendered as a key-value list with add/remove controls.

**Style** — the `style` object. Rendered as grouped CSS property inputs organized by category (layout, typography, color, spacing, border). Nested selectors (`:hover`, `.child`) are shown in a sub-section per selector.

**Signals** — the `$defs` entries that produce state or computed values (shape-detected via the five-shape grammar). Each signal shows:
- Name (read-only)
- Type badge (string / integer / boolean / array / object)
- Default value editor (type-appropriate input)
- Template expression editor (shown when signal is a template string)
- Delete button

**Handlers** — the `$defs` entries with `$prototype: "Function"`. Each handler shows:
- Name (read-only)
- Description (editable text, stored as `"description"` in the `$defs` entry)
- "Jump to implementation" link (opens companion `.js` file at that export, if file path is known)
- Delete button

**Props** — shown only on reference nodes (`$ref` to external component). Displays the `$props` object as a key-value editor where values can be static or `$ref` bindings.

**Bindings** — for non-signal, non-handler properties, shows any `$ref` binding attached to that property. Allows switching between a static value and a `$ref` to a declared signal.

### 8.3 Auto-generated controls

Because `$defs` entries carry JSON Schema `type` declarations, the inspector generates controls automatically:

| JSON Schema type | Control rendered |
|---|---|
| `"string"` | Text input |
| `"string"` with `"enum"` | Select dropdown |
| `"integer"` or `"number"` | Number input with optional min/max |
| `"boolean"` | Toggle switch |
| `"array"` | Array item list with add/remove |
| `"object"` | Nested key-value editor |

This means adding a new signal type to the JSONsx spec automatically produces the correct inspector control without modifying builder code — the schema drives the UI.

### 8.4 Template expression editor

When editing a template string `${}` signal, the inspector shows a single-line code input with:
- Inline evaluation preview: the expression is evaluated against the current `$defs` state values and the result is shown below the input
- Auto-complete hints for `$defs.*` property names declared in the component

### 8.5 Property binding

Each property row in the **Element** section has a binding toggle button. Clicking it switches the property value between:

1. **Static** — a direct JSON value edited in the inspector
2. **Bound** — a `{ "$ref": "..." }` object, with a dropdown listing all available signals from the component's `$defs` and from parent components' `$defs` (within the same custom element scope)

---

## 9. Block Library

### 9.1 Overview

The block library is a panel of draggable component templates that can be dropped onto the canvas or into the layer tree. Blocks are pre-authored JSONsx JSON fragments.

### 9.2 Built-in blocks

**Primitives:**
- `div`, `section`, `article`, `main`, `header`, `footer`, `nav`, `aside`
- `h1` through `h6`
- `p`, `span`, `strong`, `em`, `code`, `pre`
- `ul`, `ol`, `li`
- `a`, `button`, `input`, `textarea`, `select`, `form`, `label`
- `img`, `video`, `audio`, `canvas`, `svg`
- `table`, `thead`, `tbody`, `tr`, `th`, `td`

**JSONsx patterns:**
- Signal counter (element with `$count` signal and increment handler)
- Reactive list (element with `$prototype: 'Array'` children)
- Conditional switch (`$switch` node with two cases)
- Fetch data block (`$prototype: 'Request'` signal with mapped output)
- Custom element shell (empty `customElements` definition with `$defs` stub)

**External components:**
- Component files in the same project directory appear as blocks automatically
- npm-published JSONsx packages appear if a `JSONsx.json` project manifest is present

### 9.3 Adding a block

Dragging a block from the library onto the canvas inserts the block's JSON fragment at the drop position. The drop is handled by the same drag-and-drop infrastructure as layer tree reordering — a block drag registers the fragment as the drag data, and the canvas/tree drop targets accept it using the same `applyDropInstruction` path.

### 9.4 Saving as block

Right-clicking any node in the canvas or layer tree presents a context menu with **Save as block**. This serializes the node's subtree to a JSON fragment and saves it to a local block library stored in the browser's `localStorage` (or a project-local `blocks/` directory if the builder has file system access).

---

## 10. Toolbar

The toolbar is a single horizontal bar at the top of the builder.

### 10.1 Controls (left to right)

**File group:**
- Open file (`⌘O`)
- Save (`⌘S`)
- File name display (current open file, clickable to show full path)
- Dirty indicator (`●` dot when unsaved changes exist)

**Edit group:**
- Undo (`⌘Z`)
- Redo (`⌘⇧Z`)

**View group:**
- Canvas / Tree mode toggle (`T`)
- Zoom controls: `-`, zoom percentage display, `+`, reset to 100% (`⌘0`)
- Device width presets: Desktop / Tablet / Mobile

**Insert group:**
- Block library toggle (`B`)

**Export group:**
- Compile to HTML (runs the JSONsx compiler on the current document, downloads output)
- Copy JSON (copies current document JSON to clipboard)

**Source group:**
- View source (`⌘U`) — opens a floating JSON editor panel showing the full document

---

## 11. Drag and Drop

### 11.1 Drag sources

There are two drag source types:

**Tree node drag** — initiated from the drag handle (`⠿`) on a layer panel row. Carries `{ type: 'tree-node', path: [...] }` as drag data.

**Block drag** — initiated from the block library. Carries `{ type: 'block', fragment: { /* JSONsx JSON */ } }` as drag data.

Both drag types are compatible with all drop targets. The drop handler checks `source.data.type` to determine whether to call `moveNode` (tree node) or `insertNode` (block).

### 11.2 Drop targets

Drop targets exist in two places:

**Layer panel rows** — registered via `dropTargetForElements` with the tree hitbox. Accept both drag source types. Produce `reorder-above`, `reorder-below`, or `make-child` instructions.

**Canvas elements** — registered via `dropTargetForElements` directly on the live JSONsx-rendered DOM elements. Accept both drag source types. Drop position is calculated from pointer coordinates relative to the element's bounding rect, producing the same three instruction types.

### 11.3 Constraint rules

Not all drops are valid. The following constraints are enforced:

- A node cannot be dropped inside itself or any of its descendants
- Nodes with `tagName` values that are void elements (`img`, `input`, `br`, etc.) cannot accept children (`make-child` is blocked)
- A node cannot be the only child of a parent that requires at least one child (`table` requires `tbody`, etc.)
- `$prototype: 'Array'` nodes cannot be reparented — they are always the `children` property of their parent

Violations produce an `instruction-blocked` result and the drop indicator is not shown.

---

## 12. Selection Model

### 12.1 Selection via canvas click

When the user clicks on the canvas:

1. The click event bubbles up through the JSONsx-rendered DOM
2. The overlay system intercepts the event before it reaches any JSONsx event handlers (canvas children have `pointer-events: none`)
3. The clicked DOM element is matched to a JSONsx JSON node using a `WeakMap` maintained by the canvas renderer that maps each rendered `HTMLElement` to its JSON path
4. `selectNode(state, path)` is called with that path

### 12.2 Selection via layer panel click

Clicking a row in the layer panel calls `selectNode(state, rowPath)` directly.

### 12.3 Multi-select

Holding `⇧` while clicking adds nodes to the selection. Multi-selection supports:
- Group delete
- Group move (drag all selected nodes together)

Multi-selection is represented as `state.selection` being an array of paths rather than a single path.

### 12.4 Keyboard navigation

When the canvas or layer panel has focus:
- `↑` / `↓` — move selection to previous/next sibling
- `←` — select parent node
- `→` — select first child
- `⌫` / `Delete` — delete selected node (with confirmation if it has children)
- `⌘D` — duplicate selected node (inserts clone after it)
- `Escape` — deselect

---

## 13. Overlay System

The overlay system renders non-destructive visual overlays on top of the canvas to communicate selection, hover state, and drag position. It is implemented as a `<div>` with `position: absolute; inset: 0; pointer-events: none` layered over the canvas.

### 13.1 Overlay types

**Hover overlay** — a thin border (1px, semi-transparent accent color) that outlines the element under the pointer. Shows the element's `tagName` in a small label above the top-left corner. Updates on `mousemove`.

**Selection overlay** — a solid border (2px, accent color) on the selected element. Persists until deselection. Shows:
- A label above the top-left corner: `tagName` and `$id` if set
- Four resize handles (corners) — reserved for future resize support
- A drag handle (`⠿`) at the top-left — activates canvas drag

**Parent breadcrumb** — a row of ancestor labels (in muted style) above the selection overlay, showing the path from root to selected node. Clicking a breadcrumb selects that ancestor.

**Drop indicator** — a 2px horizontal line rendered between elements during drag operations over the canvas. Mirrors the drop indicator in the layer panel.

**Spacing overlay** — shown on hover, renders translucent tinted boxes over the selected element's padding and margin regions, sized using computed styles. Matches how browser devtools render the box model.

### 13.2 Positioning

All overlays are positioned using `getBoundingClientRect()` on the rendered DOM element, adjusted for scroll and canvas zoom:

```js
function getOverlayRect(el, canvasEl, zoom) {
  const elRect     = el.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  return {
    top:    (elRect.top  - canvasRect.top)  / zoom,
    left:   (elRect.left - canvasRect.left) / zoom,
    width:  elRect.width  / zoom,
    height: elRect.height / zoom,
  };
}
```

A `ResizeObserver` on the canvas container and a `MutationObserver` on the rendered JSONsx output trigger overlay repositioning when layout changes.

---

## 14. Undo / Redo

### 14.1 History model

Every call to `applyMutation` appends a snapshot to `state.history`. The history array stores `{ document, selection }` pairs. `state.historyIndex` points to the current position.

```
history: [snap0, snap1, snap2, snap3]
                              ↑
                        historyIndex = 3 (current)
```

Undo moves `historyIndex` back one step. Redo moves it forward. Any new mutation truncates the array at the current index before appending, discarding the redo branch.

### 14.2 History limits

The history stack is capped at 100 entries. When the cap is reached, the oldest entry is removed. This is sufficient for all practical editing sessions without excessive memory use.

### 14.3 Granularity

Single-keystroke property edits (typing in the inspector) are debounced — a new history entry is created only after 400ms of inactivity, not on every keystroke. This prevents the history from filling with single-character edits.

All structural mutations (insert, delete, move) create a history entry immediately.

---

## 15. File Operations

### 15.1 File System Access API

The builder uses the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) where available (Chrome, Edge) for native file open/save dialogs with direct file handles. This enables true round-trip editing of files on disk without any server.

```js
// Open
const [fileHandle] = await window.showOpenFilePicker({
  types: [{ description: 'JSONsx Component', accept: { 'application/json': ['.json'] } }]
});
const file = await fileHandle.getFile();
const text = await file.text();
state = loadDocument(JSON.parse(text), fileHandle);

// Save
const writable = await fileHandle.createWritable();
await writable.write(JSON.stringify(state.document, null, 2));
await writable.close();
```

### 15.2 Companion file detection

When a `.json` file is opened, the builder checks for a same-stem `.js` file in the same directory:

```js
const dirHandle = await fileHandle.getParent?.();
if (dirHandle) {
  try {
    const jsHandle = await dirHandle.getFileHandle(stem + '.js');
    const jsFile   = await jsHandle.getFile();
    state.handlersSource = await jsFile.text();
  } catch { /* no companion file */ }
}
```

If found, the `.js` file is displayed read-only in the Handlers panel tab.

### 15.3 Handler stub generation

When a `$prototype: "Function"` entry with `$src` is added to `$defs` in the inspector, and no companion `.js` file exists, the builder offers to generate a stub:

```js
// Generated stub for todo-app.js
export function increment($defs) {
  // TODO: implement
}

export function decrement($defs) {
  // TODO: implement
}
```

### 15.4 Autosave

When a file handle is open, the builder autosaves the JSON document to disk 2 seconds after the last mutation, via the same `createWritable()` path. A save indicator in the toolbar shows the last save time.

### 15.5 Fallback (no File System Access API)

In browsers without File System Access API (Firefox, Safari), the builder falls back to:
- **Open**: `<input type="file">` for loading
- **Save**: `<a download>` triggered programmatically for downloading

---

## 16. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘O` | Open file |
| `⌘S` | Save |
| `⌘⇧S` | Save as |
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |
| `⌘D` | Duplicate selected node |
| `⌫` / `Delete` | Delete selected node |
| `Escape` | Deselect |
| `⌘U` | Toggle source view |
| `T` | Toggle canvas / tree mode |
| `B` | Toggle block library |
| `⌘0` | Reset zoom to 100% |
| `⌘+` | Zoom in |
| `⌘-` | Zoom out |
| `↑↓←→` | Navigate selection |
| `⌘↑` | Select parent |
| `⌘↓` | Select first child |
| `⌘C` | Copy selected node JSON |
| `⌘V` | Paste JSON as sibling after selection |
| `⌘X` | Cut selected node |

---

## 17. Dependency Stack

### Runtime dependencies

| Package | Purpose |
|---|---|
| `@jsonsx/runtime` | JSONsx runtime — renders JSON to DOM |
| `@atlaskit/pragmatic-drag-and-drop` | Drag-and-drop core (vanilla JS, ~4.7kB) |
| `@atlaskit/pragmatic-drag-and-drop-hitbox` | Tree hitbox: before/after/inside instructions |

### Optional / progressive

| Package | Purpose | Required? |
|---|---|---|
| `@atlaskit/pragmatic-drag-and-drop-flourish` | Drop animations | No — can use CSS transitions |
| `jsonata` | `$compute` expression preview in inspector | No — can skip preview initially |

### Zero dependencies

The following are implemented without libraries:

- Immutable state model — `structuredClone` + plain array history
- Overlay system — `getBoundingClientRect` + `ResizeObserver` + `MutationObserver`
- Canvas zoom — CSS `transform: scale()`
- File operations — File System Access API (native browser)
- JSON source view — `<textarea>` with `JSON.stringify(doc, null, 2)`
- Keyboard shortcuts — `addEventListener('keydown')` on `document`

---

## 18. Novel Code Budget

The following is an honest estimate of novel implementation work, organized by module:

| Module | Est. lines | Notes |
|---|---|---|
| State model + mutation API | ~200 | `applyMutation`, history, selection |
| Tree flatten + path utilities | ~150 | Flatten nested JSON for layer panel rendering |
| Drop instruction → tree mutation | ~200 | `applyDropInstruction`, move/insert/remove |
| Canvas renderer integration | ~100 | Wire JSONsx runtime to canvas div, re-render on state change |
| Element → JSON path map | ~80 | `WeakMap` built during render, used by click-to-select |
| Overlay positioning | ~150 | `getBoundingClientRect` + observers + zoom correction |
| Layer panel row rendering | ~200 | Row anatomy, collapse toggle, indicators |
| Inspector — element section | ~200 | DOM property inputs, binding toggle |
| Inspector — style section | ~300 | CSS property groups, nested selector UI |
| Inspector — signals section | ~200 | Signal CRUD, type detection, JSONata input |
| Inspector — handlers section | ~100 | Handler CRUD, description edit |
| Block library | ~150 | Block list, drag source registration |
| Toolbar | ~100 | Button wiring, zoom, device presets |
| File operations | ~150 | File System Access API, autosave |
| Keyboard shortcuts | ~80 | Event handler dispatch table |
| **Total** | **~2,360** | |

This is a realistic single-developer scope for a functional v1 builder. It is a larger but bounded and well-understood implementation. The novel code is almost entirely UI wiring and data manipulation — there are no algorithmic unknowns.

---

## 19. Implementation Phases

### Phase 1 — Functional skeleton (weeks 1–3)

Goal: A working builder that can open a JSONsx JSON file, display it in the canvas, and save changes.

- State model and mutation API
- Canvas rendering (JSONsx runtime integration)
- Basic layer panel (flat list, no drag-drop yet)
- Click-to-select via overlay system
- Inspector: element section only (tagName, className, textContent, style)
- File open/save via File System Access API
- Undo/redo

**Exit criterion:** Can open `todo-app.json`, change `textContent` of an element, see the change live in the canvas, and save the modified JSON.

### Phase 2 — Tree editing (weeks 4–6)

Goal: Full layer tree with drag-and-drop reordering and insertion.

- Layer panel with collapse/expand
- Drag-and-drop in layer panel (pragmatic-drag-and-drop + hitbox)
- Canvas drag-and-drop (same infrastructure, canvas drop targets)
- Block library (primitives only)
- Delete and duplicate node
- Keyboard navigation

**Exit criterion:** Can drag a node from one parent to another, drop a `div` block from the library, and delete a node — all with undo/redo working.

### Phase 3 — Signals and handlers (weeks 7–9)

Goal: Full inspector including JSONsx-specific vocabulary.

- Inspector: signals section (add/edit/remove signals)
- Inspector: handlers section (add/remove handler declarations)
- Inspector: property bindings ($ref toggle)
- Handler stub generation
- Companion `.js` file display
- JSONata expression editor (basic — no syntax highlighting yet)

**Exit criterion:** Can add a `count` signal to a component, bind a `textContent` to `"${$defs.count}"`, add an `increment` handler, and the generated JSON is valid JSONsx.

### Phase 4 — Polish and completeness (weeks 10–12)

Goal: Production-ready builder for developer use.

- Style inspector with CSS property groups
- Spacing overlay (padding/margin visualization)
- Device preview presets
- External component references (`$ref` to other JSON files)
- Block library: JSONsx patterns (signal counter, reactive list, etc.)
- JSONata syntax highlighting
- Source view (full JSON editor with live validation)
- Toolbar: compile to HTML export

**Exit criterion:** The builder can be used to author the reference todo-app example from scratch, producing output identical to the hand-authored version.

### Phase 5 — Self-hosting (ongoing)

Goal: Progressively migrate builder chrome to JSONsx components.

The inspector, layer panel rows, toolbar, and block library are incrementally rewritten as JSONsx components. As each panel is migrated, the builder is used to edit itself — validating the spec against real authoring complexity.

No target date. Completed when the builder can be opened inside itself with full editing capability.

---

## Appendix A — Key Invariants

These invariants must hold at all times and should be verified by the implementation's test suite:

1. `state.document` is always valid JSONsx JSON (validates against the JSONsx schema)
2. `state.selection` is always a valid path into `state.document`, or `null`
3. `state.history[state.historyIndex].document === state.document` (current state is always in history)
4. Opening a file and immediately saving it produces byte-identical output (no reformatting, no added keys)
5. Any sequence of mutations followed by the same number of undos returns to the original document
6. The canvas renders deterministically — the same document always produces the same DOM output

---

## Appendix B — File Format Compatibility

The builder must correctly handle all features of the JSONsx spec v1.0.0+:

- `$defs` with naked values, expanded signals, template strings — displayed in signals section
- `$defs` with `$prototype: "Function"` — displayed in handlers section
- `$defs` with external `$prototype` and `$src` — displayed with prototype badge, not editable structurally
- `children` as array — rendered as layer tree children
- `children` as `$prototype: 'Array'` object — rendered as a special Array node, not expandable
- `$ref` to external file — rendered as collapsed component reference node
- `$switch` node — rendered as switch node with cases listed as children
- `style` with nested selectors — displayed with nested selector groups in style inspector
- Companion `.js` sidecar — loaded and displayed in Handlers panel tab

---

*JSONsx Studio Specification v0.1.0-draft — subject to revision*
