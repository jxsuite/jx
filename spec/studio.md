# `@jxplatform/studio` Specification
## Visual Builder for Jx Documents

**Version:** 2.0.0-draft
**Status:** In Progress
**License:** MIT

---

## 1. Overview

Jx Studio is a visual IDE for the development and management of local-first, statically compiled applications and websites which are composed and deployed via the Jx schema and pipeline. It renders a live canvas via the Jx runtime, provides a layer tree for structural editing, an inspector for property/style/state management, and a code editor for function bodies. The UI is built with Adobe Spectrum Web Components.

At the component level, Studio is a visual builder for individual Jx files. At the site level, it is a content management system — providing a project explorer, content collection browser, schema-driven entry editors, media management, SEO tooling, and redirect management. The full site-level architecture is specified in the companion [Site Architecture Specification](site-architecture.md).

---

## 2. Design Principles

1. **JSON is the source of truth** — Studio reads and writes `.json` files. No proprietary intermediate format.
2. **Canvas is the runtime** — The preview canvas renders via `@jxplatform/runtime`, showing exactly what users will see.
3. **Zero lock-in** — Studio edits produce standard Jx files. Any editor can open them.
4. **Self-hosting** — Studio is itself a Jx application served by `@jxplatform/server`.
5. **Developer-first** — Keyboard shortcuts, undo/redo, and code editing are first-class.

---

## 3. Architecture

### 3.1 Layout

Three-column layout:

| Column | Content |
|---|---|
| Left | Layer tree (document structure) |
| Center | Canvas (live preview) + Toolbar |
| Right | Inspector (properties, style, state, code) |

### 3.2 Data Flow

```
.json file → Studio state (immutable) → Canvas (runtime render)
                    ↓
            Inspector panels → mutation → new state → write .json
```

### 3.3 State Model

Immutable state with undo/redo history (100 entries). All mutations produce a new state object — no in-place edits.

**Key state operations** (from `state.js`):

| Operation | Description | Status |
|---|---|---|
| `createState(doc)` | Initialize from JSON document | **Implemented** |
| `selectNode(path)` | Select element by path | **Implemented** |
| `hoverNode(path)` | Hover highlight | **Implemented** |
| `undo()` / `redo()` | History navigation | **Implemented** |
| `insertNode(path, def)` | Add child element | **Implemented** |
| `removeNode(path)` | Delete element | **Implemented** |
| `duplicateNode(path)` | Clone element | **Implemented** |
| `moveNode(fromPath, toPath)` | Reorder/reparent | **Implemented** |
| `updateProperty(path, key, value)` | Set element property | **Implemented** |
| `updateStyle(path, prop, value)` | Set style property | **Implemented** |
| `updateAttribute(path, key, value)` | Set HTML attribute | **Implemented** |
| `addDef(key, value)` | Add state entry | **Implemented** |
| `removeDef(key)` | Remove state entry | **Implemented** |
| `updateDef(key, value)` | Update state entry | **Implemented** |
| `renameDef(oldKey, newKey)` | Rename state entry | **Implemented** |
| `updateMediaStyle(path, breakpoint, prop, value)` | Responsive style | **Implemented** |
| `updateNestedStyle(path, selector, prop, value)` | Nested CSS selector style | **Implemented** |
| `addSwitchCase(path, key)` | Add `$switch` case | **Implemented** |
| `removeSwitchCase(path, key)` | Remove `$switch` case | **Implemented** |
| `pushDocument(doc)` / `popDocument()` | Navigate into/out of sub-components | **Implemented** |
| `projectState` / `setProjectState` | File management state | **Implemented** |

---

## 4. Canvas

### 4.1 Rendering

The canvas renders the current document using `@jxplatform/runtime`. It shows exactly what the component looks like at runtime — no simulation or approximation.

### 4.2 Modes

| Mode | Description | Status |
|---|---|---|
| Edit | Interactive editing with selection overlays | **Implemented** |
| Preview | Clean preview without editing chrome | **Implemented** |
| Source | Raw JSON/code view | **Implemented** |
| Content | Markdown editing mode (inline text editing) | **Implemented** |

### 4.3 Responsive Preview

Canvas supports width presets matching `$media` breakpoints for responsive design testing.

> **Status: Implemented.**

---

## 5. Layer Tree

### 5.1 Structure

Flattened tree of all elements in the document with indentation representing nesting depth. Each row shows:
- Element tag name and label
- Visibility toggle
- Lock toggle (prevent accidental edits)

### 5.2 Drag and Drop

Reordering via [Atlassian Pragmatic Drag and Drop](https://atlassian.design/components/pragmatic-drag-and-drop):
- Reorder siblings
- Reparent to different container
- Drop indicators for insertion point

> **Status: Implemented.**

---

## 6. Inspector

### 6.1 Property Panel

Displays and edits element properties (`tagName`, `className`, `textContent`, etc.) with auto-generated controls based on property type.

### 6.2 Style Sidebar (Metadata-Driven)

The style sidebar replaces a flat key-value list with organized, metadata-driven sections. Metadata is loaded from `css-meta.json` which provides JSON Schema definitions for each CSS property.

#### Sections

| Section | Properties | Status |
|---|---|---|
| Layout | `display`, `flexDirection`, `flexWrap`, `alignItems`, `justifyContent`, `gap`, `gridTemplateColumns`, `gridTemplateRows` | **Implemented** |
| Spacing | `margin*`, `padding*` | **Implemented** |
| Positioning | `position`, `top`, `right`, `bottom`, `left`, `zIndex` | **Implemented** |
| Typography | `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `textAlign`, `color`, `textDecoration` | **Implemented** |
| Background | `backgroundColor`, `backgroundImage`, `backgroundSize`, `backgroundPosition` | **Implemented** |
| Border | `border*`, `borderRadius`, `outline` | **Implemented** |
| Effects | `opacity`, `boxShadow`, `transform`, `transition`, `cursor`, `overflow` | **Implemented** |
| Other | Unlisted properties | **Implemented** |

#### Input Types

Input controls are inferred from CSS metadata JSON Schema keywords:

| Schema pattern | Control |
|---|---|
| `"type": "string"` | Text field |
| `"enum": [...]` | Select dropdown |
| Number with unit | Number + unit picker |
| Color values | Color picker |
| Shorthand properties | Expandable group |

#### Conditional Display (`$show`)

Some properties conditionally appear based on other property values (e.g. flex properties appear when `display: flex`).

#### Media Breakpoint Tabs

The style sidebar shows tabs for each `$media` breakpoint, allowing responsive style editing per breakpoint.

#### Pseudo-Selector Context

Nested CSS selectors (`:hover`, `:focus`, `:active`) are editable as separate style contexts.

### 6.3 State Editor

Add, remove, rename, and edit `state` entries. All four shapes are supported:
- Naked values — inline editing
- Typed values — type constraints displayed
- Template strings — expression editing
- Functions — opens code editor

### 6.4 Code Editor

Monaco-powered editor for function `body` strings. Integrated with server code services:
- **Format** — via `oxfmt`
- **Minify** — via `Bun.Transpiler`
- **Lint** — via `oxlint` with diagnostic display

> **Status: Implemented.**

### 6.5 CEM Annotations Editor

For custom element definitions, the inspector includes CEM editing panels:

| Panel | Description | Status |
|---|---|---|
| Parameters editor | Edit CEM parameter objects on functions | **Implemented** |
| Emits editor | Declare events dispatched by functions | **Implemented** |
| Observed attributes | Manage `observedAttributes` array | **Implemented** |
| CSS custom properties | Declare `--custom-property` interfaces | **Pending** |
| CSS parts | Declare `::part()` styling hooks | **Pending** |

---

## 7. Content / Markdown Mode

### 7.1 Bidirectional Conversion

The `md-convert.js` module provides:
- `mdToJsonsx(markdown)` — Markdown string → Jx document tree
- `jxToMd(doc)` — Jx document tree → Markdown string

### 7.2 Inline Editing

In content mode, text elements (headings, paragraphs, list items) are directly editable in the canvas. Changes are synchronized back to the Jx document and can be exported as markdown.

### 7.3 Markdown Loading

The studio can load `.md` files, convert them to Jx for visual editing, and save back as markdown.

> **Status: Implemented.** `md-convert.js` with `startEditing`, `stopEditing`, `isEditableBlock` in studio.

---

## 8. File Management

### 8.1 Project State

The studio tracks:
- Project root directory
- Expanded directory tree state
- Selected file path
- Component discovery results

### 8.2 Server Integration

All file operations go through the `@jxplatform/server` Studio API:
- List directories with glob patterns
- Read/write/delete/rename files
- Discover custom element components
- Path traversal protection

> **Status: Implemented.** Full CRUD via `/__studio/*` endpoints.

---

## 9. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+Z` / `Ctrl+Z` | Undo |
| `Cmd+Shift+Z` / `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected node |
| `Cmd+D` / `Ctrl+D` | Duplicate selected node |
| `Escape` | Deselect |

---

## 10. Dependencies

| Package | Purpose |
|---|---|
| `@jxplatform/runtime` | Canvas rendering |
| `@atlaskit/pragmatic-drag-and-drop` | Layer tree drag-and-drop |
| `lit-html` | Studio UI template rendering |
| `monaco-editor` | Code editor |
| `yaml` | YAML frontmatter parsing |
| `unified` / `remark-*` | Markdown conversion pipeline |
| `@spectrum-web-components/*` (15+) | Adobe Spectrum UI components |

---

## 11. Pending Features

| Feature | Description | Status |
|---|---|---|
| CSS custom properties panel | Declare `--custom-property` interfaces for CEM | **Pending** |
| CSS parts panel | Declare `::part()` styling hooks for CEM | **Pending** |
| Full CEM document export | Generate complete Custom Elements Manifest JSON | **Pending** |
| Stylebook mode | Design token management and component gallery | **Pending** |
| Component library management | Browse, install, and manage component packages | **Pending** |
| Project explorer | File tree for site projects (pages, layouts, content, public) | **Pending** |
| Content collection browser | Table/card/calendar views for content entries | **Pending** |
| Content entry editor | Schema-driven forms for Markdown frontmatter, JSON, CSV | **Pending** |
| Media browser | Grid/list view of project media with upload and usage tracking | **Pending** |
| SEO panel | Title/description/OG preview with schema.org editor | **Pending** |
| Redirect editor | CRUD table for site redirect rules | **Pending** |

See the [Site Architecture Specification](site-architecture.md) §7 for full design details on content management UI.

---

*`@jxplatform/studio` Specification v2.0.0-draft*
