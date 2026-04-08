# JSONsx Studio — Next Steps Proposal
## From Proof-of-Concept to Content Authoring Platform

**Version:** 0.3.0-draft
**Status:** Proposal (partially implemented)
**Depends on:** JSONsx Specification v1.0.0+, JSONsx Builder Specification v0.1.0+
**License:** MIT

---

## Table of Contents

1. [Context](#1-context)
2. [Assessment: Current Studio](#2-assessment-current-studio)
3. [Assessment: DDOME Vision](#3-assessment-ddome-vision)
4. [Strategic Direction](#4-strategic-direction)
5. [Priority 1: Runtime Integration](#5-priority-1-runtime-integration)
6. [Priority 2: Markdown Canvas Mode](#6-priority-2-markdown-canvas-mode)
7. [Priority 3: Content File Management](#7-priority-3-content-file-management)
8. [Priority 4: Stylebook System](#8-priority-4-stylebook-system)
9. [Priority 5: Component Management](#9-priority-5-component-management)
10. [Deferred DDOME Concepts](#10-deferred-ddome-concepts)
11. [Architecture](#11-architecture)
12. [Implementation Phases](#12-implementation-phases)

---

## 1. Context

### 1.1 Lineage

The JSONsx project has three relevant predecessors and current assets:

- **DDOM / DDOME spec** — A comprehensive vision for a fully declarative visual application builder. Never built, but defined a rich set of concepts: Stylebook, scoped editing, metadata-driven panels, responsive canvas, component-first architecture, and self-composability.
- **JSONsx Builder spec** — A focused spec for a developer-tool visual editor for `.json` component files. Defines the layer panel, canvas, inspector, drag-and-drop, undo/redo, and file operations that now form the current studio.
- **JSONsx Studio (`@jsonsx/studio`)** — The current implementation. A working visual editor (~5300+ lines of vanilla JS) that delivers file I/O, a WYSIWYG canvas powered by `@jsonsx/runtime` with live reactivity and edit/preview toggle, a layer tree with drag-and-drop, a full inspector, signal/definition management, a block library, markdown content mode with inline rich text editing, component inline text editing, repeater/`$map` template editing, custom element rendering with `defineElement` integration, breadcrumb-based context navigation, and a Monaco-based function code editor.

### 1.2 Markdown Integration

The `@jsonsx/parser` package has delivered a working markdown integration:

- `MarkdownFile` and `MarkdownCollection` classes for parsing `.md` files as `$prototype` data sources
- `MarkdownDirective` — a remark plugin that maps markdown directive syntax (`:::component-name{attrs}`) to custom element HTML tags
- Frontmatter extraction, TOC generation, reading time, word count, and excerpt computation
- A working blog example demonstrating content-driven JSONsx applications

### 1.3 Product Vision

The studio's greatest value proposition is enabling **WordPress-like content authoring with an Astro-like compilation pipeline**. JSONsx already has the compilation model (static HTML with hydration islands). The markdown parser gives it content management primitives. What's missing is a visual authoring experience that unifies component editing and content editing into a single tool.

Markdown is the future of internet content. The studio should treat it as a first-class citizen — not a secondary text-editor mode, but a native canvas experience with the same WYSIWYG, drag-and-drop editing that JSONsx components enjoy.

---

## 2. Assessment: Current Studio

### What works well

| Feature | Status | Quality |
|---|---|---|
| File open/save (File System Access API) | Complete | Solid; autosave, dirty indicator, fallback for Firefox/Safari |
| Immutable state + undo/redo | Complete | Clean; 100-snapshot history, structuredClone-based |
| Layer tree with drag-and-drop | Complete | Functional; Atlassian pragmatic-drag-and-drop |
| Multi-breakpoint canvas preview | Complete | Good; per-`$media` panels with feature toggles |
| Inspector (element, style, attributes, events, media) | Complete | Comprehensive; CSS autocomplete from webdata.json |
| Signal/definition management | Complete | Full CRUD for all five $defs shapes |
| Block library | Complete | Categorized HTML elements with sensible defaults |
| Context menu, keyboard shortcuts | Complete | Standard set |
| Runtime integration (Priority 1) | Complete | Live reactive preview using `@jsonsx/runtime`. `onNodeCreated` callback populates `WeakMap<Element, Path>`. Edit/preview toggle strips/restores `on*` handlers. Fallback to structural `renderCanvasNode()` on error. |
| Content mode — markdown canvas (Priority 2) | Complete | `.md` files rendered as WYSIWYG canvas via `mdToJsonsx()`/`jsonsxToMd()` with remark pipeline. Allowlist-based nesting constraints, content-mode block library, adapted inspector. Inline rich text editing with paragraph splitting and slash command palette. |
| Dev server integration | Complete | `@jsonsx/server` with `createDevServer()`: `/__jsonsx_resolve__` proxy, `/__jsonsx_server__` proxy, `/__studio/*` REST API, SSE live reload, build pipeline with file watcher. |
| Breadcrumb navigation | Complete | Unified toolbar breadcrumb for document stack navigation and function editor context (`ƒ defName` / `ƒ eventKey`). |
| Function editor | Complete | Monaco-based code editor for `$prototype: "Function"` bodies. Integrated via breadcrumb context switching with async save/minify on close. |
| `$switch`/`cases` management | Complete | Visual case management in inspector: add/remove/rename cases, first-case preview on canvas, cross-file `$ref` case navigation. |
| Repeater (`$map`) integration | Complete | `$prototype: "Array"` children displayed as "Repeater" in layers with `↻` badge. Edit mode renders single configurable template instance inside a `repeater-perimeter` wrapper. Path remapping maps runtime paths back to document `children/map` paths. |
| Custom component rendering | Complete | `defineElement` called for `$elements` entries before canvas render. Custom components render their full internal template on canvas. Layer tree treats component instances as atomic (no recursion into internals). `$map` placeholder scope (`$map/item`, `$map/index`) injected for components inside repeaters. |
| Inline text editing (component mode) | Complete | Single-click on text-leaf elements enters `contenteditable="plaintext-only"` mode. Raw `${...}` expressions editable as literal text. `mousedown` preventDefault suppresses blur for in-bounds cursor repositioning. Enter commits, Escape cancels, blur commits. Custom elements and container elements excluded. |
| `$map` signals in inspector | Complete | `$map/item` and `$map/index` available in signal dropdowns when selected node is inside a repeater template. Applies to component props, textContent, hidden, and $switch bindings. |

### What needs work

| Gap | Impact | Notes |
|---|---|---|
| No component file management | Medium | Studio operates on a single `.json` file at a time (though dev server provides REST API for file listing/CRUD). No tabbed multi-file editing. |
| No companion .js editing | Low | Handler source is displayed read-only in Monaco. No stub generation UX. |
| No stylebook / design tokens | Medium | No centralized CSS custom property editor or visual breakpoint manager. |
| Content file management | Medium | Dev server provides file listing and CRUD, but no project-level tree panel or frontmatter editor in the UI. |

---

## 3. Assessment: DDOME Vision

The DDOME spec (~3100 lines) envisions a full-scale visual application builder. Many of its concepts are forward-looking but not immediately relevant to the content-management priority. Here is a triage:

### Adopt now

| DDOME Concept | JSONsx Studio Adaptation |
|---|---|
| **Stylebook** — centralized visual style management | Style token editor for `$media` variables, `:root`-level CSS custom properties. Small but high-value for content sites. |
| **Metadata-driven panels** — inserter/inspector driven by JSON data, not hardcoded element lists | Already partially realized: `webdata.json` drives the block library and CSS autocomplete. Formalize and extend. |
| **Responsive canvas** — resizable viewports matching breakpoints | Already implemented as multi-panel breakpoint previews. Extend with inline width handles. |
| **Explorer/scope navigation** — tree-based application structure browser | Adapt to a project-level sidebar: content files, components, pages, config. |

### Adopt later

| DDOME Concept | Rationale for deferral |
|---|---|
| **Dynamic tiling/panel relayout** — CSS Grid-based panel system | Current fixed layout is adequate; tiling is a UX polish item. |
| **Component editor modes** (Customize vs Modify) | Requires runtime-integrated component editing, which depends on Priority 1. |
| **Request builder** — visual HTTP request composition | Useful but not needed for content management. |
| **Module editor** — code editing for JS modules | The studio's companion `.js` display is sufficient for now. |
| **Self-composability** — editing the studio inside itself | Aspirational; depends on near-complete runtime feature coverage. |

### Do not adopt

| DDOME Concept | Rationale |
|---|---|
| **NPM package-per-entity file structure** | JSONsx uses flat `.json` files with `$ref` for composition, not a nested `package.json` hierarchy. DDOME's file conventions reflect DDOM, not JSONsx. |
| **DDOM-specific data models** (Application, Page as `window`/`document`) | JSONsx has its own document/component model. DDOM's `window`-level nesting doesn't apply. |
| **Plugin architecture** | Premature; JSONsx's `$prototype` + `$src` extensibility pattern provides the same benefit declaratively. |

---

## 4. Strategic Direction

The studio evolves from a single-file JSON component editor into a **content authoring platform** in five priorities:

```
Priority 1: Runtime Integration          ← foundation: live preview for everything
Priority 2: Markdown Canvas Mode         ← the key insight: markdown IS a canvas
Priority 3: Content File Management      ← project directory, content tree, frontmatter
Priority 4: Stylebook / Design Tokens    ← CSS custom properties editor
Priority 5: Component Management         ← tabs, cross-file navigation
```

Each priority is self-contained and delivers value independently. Priority 1 is the enabling foundation — it must land first so that both component editing and markdown editing benefit from live reactivity.

### The Key Insight: Markdown as a Canvas Mode

The studio already has a full WYSIWYG editing experience: canvas rendering, layer tree with DnD, inspector, block library, selection/hover overlays, undo/redo. Markdown content is simply a **constrained element tree**. Rather than building a separate text editor for markdown (split-pane, CodeMirror, scroll sync), we reuse the entire existing studio infrastructure.

The only new machinery is a **bidirectional conversion layer** between markdown and JSONsx element trees:

```
Import:  .md file → remark-parse → mdast → JSONsx element tree → studio canvas
Export:  studio canvas → JSONsx element tree → mdast → remark-stringify → .md file
```

Elements within a defined "markdown element allowlist" round-trip cleanly to markdown. Elements outside the allowlist (JSONsx custom components) are serialized as markdown directive syntax. This approach requires:

- ~200-300 lines of conversion code (two recursive tree walkers + a mapping table)
- A markdown element allowlist with nesting constraints
- Content-mode behavior switches in the block library and inspector

No new UI panels. No new editor framework. The canvas, layer tree, DnD, inspector, overlays, and undo/redo all work unchanged.

---

## 5. Priority 1: Runtime Integration ✅ Complete

### 5.1 Goal

Replace the studio's custom `renderCanvasNode()` with the actual `@jsonsx/runtime`, enabling live reactivity, computed expression evaluation, and event handler execution in the canvas preview. This is the foundation upon which all subsequent priorities build.

> **Status: COMPLETE.** The runtime integration is fully implemented. `renderCanvasLive()` calls `buildScope()` + `runtimeRenderNode()` with an `onNodeCreated` callback that populates a `WeakMap<Element, Path>`. Edit mode strips `on*` handlers and sets `pointer-events: none`. Preview mode renders the full document with live interactivity. `renderCanvasNode()` is retained as an error fallback. Custom elements are registered via `defineElement()` for `$elements` entries. The `$switch`/`cases` pattern, `$map`/repeater templates, and `$props` custom component instances all render correctly on the canvas.

### 5.2 Current Gap

The studio's canvas renderer (`renderCanvasNode()` in `studio.js`, ~50 lines) builds DOM elements from the JSON tree but:
- Does not process `$defs` into reactive signals
- Does not evaluate `${}` template strings
- Does not execute `$prototype: "Function"` handlers
- Does not resolve `$prototype: "Request"` or other data sources
- Shows `$ref` bindings as italic placeholder text with default values

This means the canvas is a structural preview only. Signal-driven text, computed styles, and interactive behavior are invisible.

### 5.3 Integration Approach

**Sandboxed runtime mount:**

```js
import { JSONsx } from '@jsonsx/runtime'

async function renderCanvasLive(doc, canvasEl) {
  canvasEl.innerHTML = ''
  await JSONsx(doc, canvasEl)
}
```

The challenge is that the runtime's rendered output has no path metadata — the studio needs to map click targets back to JSON paths.

**Approach: `onNodeCreated` callback.** Extend the runtime's `renderNode()` to accept an optional `onNodeCreated(element, path)` callback. The studio registers this callback to stamp each element with a `data-jsonsx-path` attribute and populate its `WeakMap<Element, Path>`. This requires a minor runtime API addition:

```js
// In @jsonsx/runtime renderNode():
if (options?.onNodeCreated) options.onNodeCreated(el, currentPath)
```

This keeps the studio's existing overlay system working unchanged. A single render pass, a single DOM tree, direct `getBoundingClientRect()` for overlays.

### 5.4 Canvas Isolation

- The runtime-rendered canvas keeps `pointer-events: none` on all children (existing pattern) so the overlay system intercepts clicks.
- Runtime event handlers (e.g., `onclick`) are suppressed during editing mode. The studio strips all `on*` properties from a document clone before passing it to the runtime. This is cleaner than gating inside the runtime itself.

### 5.5 Edit / Preview Toggle

A "Play" button in the toolbar toggles between:

| Mode | pointer-events | Overlays | Event handlers | Use case |
|---|---|---|---|---|
| **Edit** (default) | `none` on canvas children | Active | Stripped | Visual editing |
| **Preview** | Restored | Hidden | Active | Test interactivity |

The toggle switches between two renders of the same document — one with `on*` stripped, one with the full document. State persists between toggles.

### 5.6 Build Integration

The studio currently bundles as a standalone browser build. To import `@jsonsx/runtime`:

```json
{
  "build": "bun build ./studio.js --outdir dist --target browser --sourcemap=linked"
}
```

The runtime is bundled inline (~56KB). Alternatively it can be loaded as a separate `<script type="module">` for caching.

### 5.7 Fallback Rendering

During the transition, the studio retains `renderCanvasNode()` as a fast fallback for when the runtime fails to render (malformed JSON, unresolvable `$ref`, etc.). The canvas attempts runtime rendering first; on error, it falls back to the structural preview with a status bar warning.

---

## 6. Priority 2: Markdown Canvas Mode ✅ Complete

### 6.1 Goal

Enable authoring and editing `.md` content files using the studio's existing WYSIWYG canvas, layer tree, DnD, inspector, and block library — with no new editor UI.

> **Status: COMPLETE.** Markdown canvas mode is fully implemented. `.md` files are opened via `mdToJsonsx()` and saved via `jsonsxToMd()` + `remark-stringify`. The conversion layer, markdown allowlist, nesting constraints, content-mode block library, content-mode inspector, content typography stylesheet, and inline rich text editing (with paragraph splitting, slash command palette, and Enter to create new blocks) are all working. Content mode is auto-detected from file extension.

### 6.2 The Bidirectional Conversion Layer

Two functions form the bridge between markdown and the studio's JSONsx element tree:

```
mdToJsonsx(mdast)    → JSONsx element tree (for loading into the canvas)
jsonsxToMd(jsonsx)   → mdast              (for saving back to markdown)
```

Both are pure tree transformations, ~100-150 lines each. The remark ecosystem handles all actual parsing and serialization.

#### 6.2.1 Import: Markdown → JSONsx

```
.md file → remark-parse → mdast → mdToJsonsx() → JSONsx element tree → studio state
```

The `mdToJsonsx()` function walks the mdast tree and produces a JSONsx element tree. The mapping is direct:

| mdast node type | JSONsx element |
|---|---|
| `root` | Container `div` with `$id: "content"` |
| `heading` (depth 1-6) | `{ tagName: "h1"…"h6", textContent: "…" }` |
| `paragraph` | `{ tagName: "p", children: [...] }` |
| `text` | `{ tagName: "span", textContent: "…" }` (or merged into parent's `textContent` for simple paragraphs) |
| `emphasis` | `{ tagName: "em", children: [...] }` |
| `strong` | `{ tagName: "strong", children: [...] }` |
| `delete` | `{ tagName: "del", children: [...] }` |
| `inlineCode` | `{ tagName: "code", textContent: "…" }` |
| `link` | `{ tagName: "a", attributes: { href: "…" }, children: [...] }` |
| `image` | `{ tagName: "img", attributes: { src: "…", alt: "…" } }` |
| `blockquote` | `{ tagName: "blockquote", children: [...] }` |
| `list` (ordered) | `{ tagName: "ol", children: [...] }` |
| `list` (unordered) | `{ tagName: "ul", children: [...] }` |
| `listItem` | `{ tagName: "li", children: [...] }` |
| `code` (fenced) | `{ tagName: "pre", children: [{ tagName: "code", textContent: "…", attributes: { class: "language-…" } }] }` |
| `thematicBreak` | `{ tagName: "hr" }` |
| `table` | `{ tagName: "table", children: [thead, tbody] }` |
| `tableRow` | `{ tagName: "tr", children: [...] }` |
| `tableCell` | `{ tagName: "td" or "th", textContent: "…" }` |
| `html` (raw) | `{ tagName: "div", innerHTML: "…" }` |
| `leafDirective` | `{ tagName: "directive-name", attributes: { ...directive-attrs } }` |
| `containerDirective` | `{ tagName: "directive-name", attributes: { ...directive-attrs }, children: [...] }` |
| `textDirective` | `{ tagName: "directive-name", attributes: { ...directive-attrs }, textContent: "label" }` |

**Frontmatter** is extracted separately via `remark-frontmatter` + `remark-parse-frontmatter` and stored in the state model as metadata — not as part of the element tree.

**Inline content simplification:** When a paragraph contains only text (no emphasis, links, etc.), the converter flattens it to a single `p` with `textContent` rather than creating nested spans. This produces a cleaner layer tree.

#### 6.2.2 Export: JSONsx → Markdown

```
studio state → jsonsxToMd() → mdast → remark-stringify → .md file
```

The `jsonsxToMd()` function walks the JSONsx element tree and produces an mdast tree. It is the inverse of the import mapping above.

**Critical rule:** elements in the **markdown allowlist** (see §6.3) become mdast content nodes. Elements not in the allowlist are custom components — they become **directive nodes**:

| JSONsx element | mdast directive |
|---|---|
| Block element with children | `containerDirective` → `:::tag-name{attrs}\nchildren\n:::` |
| Block element without children (void) | `leafDirective` → `::tag-name{attrs}` |
| Inline element | `textDirective` → `:tag-name[textContent]{attrs}` |

Whether a non-allowlist element is block or inline is determined by its position in the tree: if it is a direct child of the content root or a block container, it is block; if it appears inside a paragraph or inline context, it is inline.

**Frontmatter** is prepended as a YAML block using the metadata stored in the state model.

#### 6.2.3 Round-Trip Fidelity

The conversion must be lossless for the markdown subset. Opening a `.md` file and saving it without edits must produce semantically equivalent markdown (whitespace normalization is acceptable; structural changes are not). Remark's own `remark-stringify` handles formatting consistency.

### 6.3 Markdown Element Allowlist

The allowlist defines which HTML elements are "native markdown" — they round-trip to pure markdown syntax. Everything else is a JSONsx component directive.

```js
const MARKDOWN_ELEMENTS = {
  // Block elements
  block: new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',  // headings
    'p',                                     // paragraph
    'blockquote',                            // blockquote
    'ul', 'ol', 'li',                       // lists
    'pre',                                   // fenced code block (wraps <code>)
    'hr',                                    // thematic break
    'table', 'thead', 'tbody', 'tr', 'th', 'td',  // GFM tables
  ]),

  // Inline elements (only valid inside block elements)
  inline: new Set([
    'em',                // emphasis (*text*)
    'strong',            // strong (**text**)
    'del',               // strikethrough (~~text~~)
    'code',              // inline code (`text`)
    'a',                 // link [text](url)
    'img',               // image ![alt](src)
    'br',                // hard line break
  ]),
}
```

### 6.4 Nesting Constraints

In content mode, the studio enforces markdown-legal nesting. The same `instruction-blocked` mechanism used by the existing DnD system applies:

| Parent | Allowed children |
|---|---|
| Content root | Block elements, directive components |
| `h1`–`h6` | Inline elements only |
| `p` | Inline elements, inline directive components |
| `blockquote` | Block elements |
| `ul`, `ol` | `li` only |
| `li` | Block elements (including nested `ul`/`ol`), inline elements |
| `pre` | `code` only |
| `table` | `thead`, `tbody` |
| `thead`, `tbody` | `tr` only |
| `tr` | `th`, `td` only |
| `th`, `td` | Inline elements |
| `a` | Inline elements (no nested `a`) |
| `em`, `strong`, `del` | Inline elements |
| `code`, `img`, `hr`, `br` | None (void / text-only) |
| Directive components | Block elements, inline elements (follows container rules) |

These constraints are enforced in two places:
1. **DnD drop validation** — `instruction-blocked` when the drop would violate nesting rules
2. **Block library filtering** — content mode only shows blocks valid for the current selection context (e.g., inside a `p`, only inline elements and inline components are offered)

### 6.5 Content-Mode Block Library

When the studio is in content mode, the Blocks panel shows a different set of elements:

**Markdown Blocks:**
- Heading (H1–H6)
- Paragraph
- Link
- Image
- Bulleted List
- Numbered List
- Blockquote
- Code Block
- Horizontal Rule
- Table

**Project Components:**
- All JSONsx component `.json` files discovered in the project directory
- Each shown with its `$id` and tag name
- Inserting a project component into the content tree creates a directive placeholder that exports as `:::component-name{attrs}` or `::component-name{attrs}`

The standard HTML element categories (Structure, Form, Media, Interactive, etc.) are hidden in content mode — they are not markdown-representable.

### 6.6 Content-Mode Inspector

When in content mode, the inspector adapts:

**Element section:**
- `tagName` is a dropdown restricted to the markdown allowlist (or shows the directive component name as read-only for components)
- `textContent` is editable for text-bearing elements
- `className` is hidden (markdown elements don't carry classes)
- Element-specific fields appear contextually:
  - Link (`a`): `href` input, `title` input
  - Image (`img`): `src` input, `alt` input
  - Code block (`pre > code`): language selector
  - Heading: depth selector (1-6, changes `tagName`)

**Style section:**
- Hidden in content mode. Markdown content does not carry inline styles. (Styling is the responsibility of the site's component/layout layer, not the content.)

**Attributes section:**
- Shows directive attributes for component elements (these become the `{key="value"}` pairs in directive syntax)
- Hidden for markdown-native elements (their attributes are handled by the element-specific fields above)

### 6.7 Content-Mode Canvas Rendering

In content mode, the canvas renders the JSONsx element tree the same way it does in component mode — using the `@jsonsx/runtime` (Priority 1). The only differences:

- **Typography styles:** The canvas applies a default content stylesheet (readable font, appropriate heading sizes, paragraph spacing) so content looks like a rendered blog post, not unstyled HTML.
- **Directive placeholders:** Components that don't have a corresponding `.json` file available render as styled placeholder cards showing the component name and attributes. Components with available `.json` files render live (via the runtime).
- **Inline editing:** In content mode, clicking a text element enters rich inline editing (paragraph splitting on Enter, `/` slash command palette). In component mode, single-clicking a text-leaf element enters plain-text `contenteditable="plaintext-only"` editing where raw `${...}` template expressions can be typed directly. Custom element instances and container elements are excluded from inline editing.

### 6.8 File Open/Save in Content Mode

**Opening a `.md` file:**

```js
// 1. Read the file
const source = await fileHandle.getFile().then(f => f.text())

// 2. Parse to mdast
const mdast = unified().use(remarkParse).use(remarkFrontmatter, ['yaml'])
  .use(remarkParseFrontmatter).use(remarkGfm).use(remarkDirective).parse(source)

// 3. Extract frontmatter
const frontmatter = mdast.data?.frontmatter ?? {}

// 4. Convert to JSONsx element tree
const jsonsxTree = mdToJsonsx(mdast)

// 5. Load into studio state
state = loadDocument(jsonsxTree, fileHandle)
state.mode = 'content'
state.content.frontmatter = frontmatter
```

**Saving a `.md` file:**

```js
// 1. Convert JSONsx element tree back to mdast
const mdast = jsonsxToMd(state.document)

// 2. Prepend frontmatter
const yamlBlock = stringifyYaml(state.content.frontmatter)

// 3. Serialize to markdown
const md = unified().use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*' }).stringify(mdast)

// 4. Write
const output = `---\n${yamlBlock}---\n\n${md}`
await writeFile(fileHandle, output)
```

The studio detects whether to use content mode or component mode based on the file extension: `.md` files open in content mode, `.json` files open in component mode.

### 6.9 Parser Package Extension

The following change to `@jsonsx/parser` (`md.js`) supports the studio:

**`source` constructor option** — accept raw markdown string as alternative to file path:

```js
class MarkdownFile {
  constructor(config) {
    this.src = config.src       // file path (existing)
    this.source = config.source // raw string (new)
  }
  async resolve() {
    const raw = this.source ?? readFileSync(this.src, 'utf-8')
    return processMarkdown(raw, this.src ?? 'untitled.md', this.config)
  }
}
```

This is a small, backwards-compatible change.

### 6.10 Novel Code Budget

| Module | Est. lines | Notes |
|---|---|---|
| `mdToJsonsx()` — mdast → JSONsx | ~150 | Recursive walker + mapping table |
| `jsonsxToMd()` — JSONsx → mdast | ~150 | Inverse walker + directive detection |
| Markdown allowlist + nesting constraints | ~60 | Data tables + validation function |
| Content-mode block library filter | ~40 | Filter existing block list by allowlist |
| Content-mode inspector adaptations | ~80 | Contextual field switching |
| Content-mode canvas stylesheet | ~30 | Typography defaults |
| File open/save for `.md` | ~60 | Extension detection + conversion wiring |
| **Total** | **~570** | |

This is remarkably small because the conversion layer piggybacks on the existing studio infrastructure. No new panels, no new editor, no new DnD system.

---

## 7. Priority 3: Content File Management

### 7.1 Goal

Enable the studio to operate on a project directory rather than a single file, providing a content tree for browsing and managing `.md` and `.json` files.

### 7.2 Directory Access

On first use, the user opens a project directory via `showDirectoryPicker()`. The studio scans for files:

- `.md` files in content-convention paths (`content/`, `posts/`, `pages/`, or root)
- `.json` files (JSONsx components)

The directory handle is persisted in IndexedDB across sessions. On reload, the studio re-requests permission.

### 7.3 Content Tree Panel

A new "Files" tab in the left panel:

```
Files
├── content/
│   ├── posts/
│   │   ├── Getting Started        (2025-03-15)
│   │   ├── Building a Blog        (2025-04-01)
│   │   └── Advanced Patterns      (2025-04-10)
│   └── pages/
│       ├── About
│       └── Contact
├── components/
│   ├── info-box.json
│   ├── user-card.json
│   └── nav-header.json
└── blog.json
```

- Content files (`.md`) display their frontmatter `title`, with the date in parentheses
- Component files (`.json`) display their `$id` or filename
- Clicking a file opens it in the appropriate mode (content or component)
- Context menu: New File, Rename, Delete
- "New Post" button at the top — creates a `.md` file with a frontmatter template

### 7.4 Frontmatter Inspector

When in content mode with the document root selected, the right panel's Properties tab shows frontmatter fields:

| Field | Control | Source |
|---|---|---|
| `title` | Text input | `frontmatter.title` |
| `date` | Date input | `frontmatter.date` |
| `tags` | Tag chip input (comma-separated) | `frontmatter.tags` |
| `published` | Toggle switch | `frontmatter.published` |
| `author` | Text input | `frontmatter.author` |
| *custom fields* | Text input (auto-detected) | Any other YAML key |
| *+ Add field* | Button | Adds a new key-value pair |

Below the frontmatter fields, a **Components Used** section lists all directive components found in the current document:
- Directive name and type (container/leaf/inline)
- Attributes used
- Click-through to open the component's `.json` file

### 7.5 State Model Extension

```js
{
  // Existing (unchanged)
  document, selection, hover, history, historyIndex,
  dirty, fileHandle, handlersSource,
  ui: { leftTab, rightTab, zoom, activeMedia, featureToggles },

  // New: editing mode
  mode: 'component' | 'content',

  // New: content metadata (content mode only)
  content: {
    frontmatter: object | null,   // parsed YAML frontmatter
  },

  // New: project directory
  project: {
    directoryHandle: FileSystemDirectoryHandle | null,
    files: Array<{ path, name, type, handle, frontmatter? }>,
  },
}
```

---

## 8. Priority 4: Stylebook System

### 8.1 DDOME Precedent

DDOME's Stylebook was a centerpiece: a dedicated panel for visualizing and managing CSS variables, element default styles, and component variants. The JSONsx equivalent is simpler because JSONsx's style system is already well-defined (inline `style` objects with nested selectors, `$media` breakpoints), but a dedicated design token editor is high-value for content sites.

### 8.2 Scope

A new "Design" tab in the right panel that provides:

**CSS Custom Properties editor:**
- Reads and writes `:root`-level CSS variables from the document's root `style` object.
- Groups variables by naming convention prefix: `--color-*`, `--font-*`, `--spacing-*`, `--border-*`.
- Type-aware inputs:
  - Color variables → color picker input
  - Size variables → number input with unit selector (px, rem, em, %)
  - Font variables → text input with system font suggestions
  - Arbitrary → text input

**`$media` breakpoint editor:**
- Reads and writes the document's `$media` object (already supported in the Inspector's Media section).
- Visual breakpoint bar: a horizontal ruler showing breakpoint positions, draggable to resize.
- Linked to the canvas panels: adjusting a breakpoint value updates the corresponding canvas panel width.

**Token preview:**
- A small swatch/preview row for each token group: color palette strip, typography scale, spacing scale.
- Click a token to jump to any style property in the document that references it.

### 8.3 Relationship to DDOME Stylebook

This is a pragmatic subset of DDOME's Stylebook. The DDOME vision included per-component variant management and element default overrides — those depend on full component editing capabilities and are deferred.

---

## 9. Priority 5: Component Management

### 9.1 Goal

Extend the studio from a single-file editor to a project-aware tool that can navigate between JSONsx component files, follow `$ref` links, and manage a component library.

### 9.2 Tab System

Multiple files can be open simultaneously:

- Tab bar appears below the toolbar when more than one file is open
- Each tab shows the file's `$id` / filename / frontmatter title, with a dirty indicator and close button
- Switching tabs swaps the state model's `document`, `selection`, `history`, `filePath`, and `mode`
- Tab state is kept in memory; closing a tab with unsaved changes prompts to save
- `.md` tabs open in content mode; `.json` tabs open in component mode

### 9.3 Cross-File Navigation

When the inspector shows a `$ref` pointing to an external `.json` file:
- The `$ref` value is rendered as a clickable link
- Clicking it opens the referenced file in a new tab
- Breadcrumb trail shows the navigation path

When a directive component is selected in the content canvas:
- The inspector shows the component's attributes
- An "Open Component" button navigates to the directive's corresponding `.json` file

### 9.4 Relationship to DDOME Explorer

DDOME's Explorer envisioned a scope-aware navigation system with application/page/component nesting. JSONsx's flat `$ref` composition model is simpler — there is no implicit scope inheritance. The project sidebar (Priority 3) is a straightforward directory tree. If JSONsx later adopts a project manifest, the sidebar can evolve to show a structured project view.

---

## 10. Deferred DDOME Concepts

The following DDOME features are recognized as valuable but deferred beyond the five priorities above.

| Concept | Value | Dependency |
|---|---|---|
| **Dynamic tiling layout** | Users rearrange studio panels | UX polish; no functionality dependency |
| **Component editor modes** (Customize vs Modify) | Instance editing vs definition editing | Requires Priority 1 + 5 |
| **Request builder** | Visual HTTP request composition | Nice-to-have for data-driven apps |
| **Code editor integration** | Inline editing of `.js` handler functions | Priority 1 enables preview; editing needs CodeMirror or Monaco |
| **Self-composability** | Studio editable inside itself | Long-term aspirational; depends on near-100% JSONsx self-hosting |
| **Plugin system** | Third-party studio extensions | Premature until studio API stabilizes |
| **Variant management** | Visual creation/management of CSS class variants | Depends on Stylebook (Priority 4) |
| **Inline text editing (rich)** | Full rich-text cursor-based editing in canvas | Phase 2 delivers basic inline `textContent` editing; full rich-text (cursor positioning, selection ranges, IME) is a separate effort |

---

## 11. Architecture

### 11.1 Package Changes

```
packages/
  studio/
    index.html                ← unchanged (content mode uses same layout)
    studio.js                 ← add content mode switching, runtime integration
    state.js                  ← extend state model with mode, content, project
    md-convert.js             ← NEW: mdToJsonsx() + jsonsxToMd() conversion layer
    md-allowlist.js           ← NEW: markdown element allowlist + nesting constraints
    content-tree.js           ← NEW: project directory tree panel
    stylebook.js              ← NEW: design token editor
    webdata.json              ← unchanged
    gen-webdata.js            ← unchanged
    package.json              ← add @jsonsx/parser and @jsonsx/runtime as dependencies

  parser/
    md.js                     ← extend: `source` constructor option

  runtime/
    runtime.js                ← extend: `onNodeCreated` callback option in renderNode
```

### 11.2 New Module: `md-convert.js`

The conversion module is the heart of the markdown canvas mode. It exports:

```js
/**
 * Convert an mdast tree to a JSONsx element tree.
 * @param {object} mdast - mdast root node (from remark-parse)
 * @returns {object} JSONsx element tree (studio document format)
 */
export function mdToJsonsx(mdast) { /* ... */ }

/**
 * Convert a JSONsx element tree back to an mdast tree.
 * Uses the markdown allowlist to determine which elements become
 * native markdown and which become directive syntax.
 * @param {object} jsonsx - JSONsx element tree
 * @returns {object} mdast root node (for remark-stringify)
 */
export function jsonsxToMd(jsonsx) { /* ... */ }
```

The allowlist is imported from `md-allowlist.js` which exports:

```js
/**
 * Sets of element tag names that round-trip to pure markdown.
 */
export const MARKDOWN_BLOCK_ELEMENTS = new Set([...])
export const MARKDOWN_INLINE_ELEMENTS = new Set([...])

/**
 * Returns whether a drop target accepts the given child in content mode.
 * @param {string} parentTag - tagName of the drop target
 * @param {string} childTag  - tagName of the dragged element
 * @returns {boolean}
 */
export function isValidMarkdownNesting(parentTag, childTag) { /* ... */ }
```

### 11.3 Dependency Changes

| New Dependency | Package | Purpose |
|---|---|---|
| `@jsonsx/runtime` | studio | Live canvas preview (Priority 1) |
| `unified`, `remark-parse`, `remark-stringify`, `remark-frontmatter`, `remark-gfm`, `remark-directive` | studio | Markdown parsing/serialization for content mode (Priority 2) |

The `@jsonsx/parser` package already depends on the remark stack, but the studio needs the parsing primitives directly for the bidirectional conversion layer. The parser's `MarkdownFile` class is not used in the studio — the studio handles the pipeline itself because it needs access to the intermediate mdast tree.

### 11.4 Data Flow: Content Mode

```
┌─────────────────────────────────────────────────────────────┐
│                    Content Mode Data Flow                     │
│                                                             │
│  .md file                                                   │
│    │                                                        │
│    ▼                                                        │
│  remark-parse → mdast                                       │
│    │              │                                         │
│    │              ▼                                         │
│    │         mdToJsonsx() → JSONsx element tree              │
│    │                            │                           │
│    │                            ▼                           │
│    │              ┌─── Studio State (document) ───┐         │
│    │              │                               │         │
│    │              ├─── Canvas (runtime render)     │         │
│    │              ├─── Layer Tree (flatten tree)   │         │
│    │              ├─── Inspector (selection)       │         │
│    │              └─── Block Library (allowlist)   │         │
│    │                            │                           │
│    │                            ▼                           │
│    │         jsonsxToMd() ← JSONsx element tree              │
│    │              │                                         │
│    │              ▼                                         │
│    │         remark-stringify → markdown string              │
│    │              │                                         │
│    ▼              ▼                                         │
│  .md file (with frontmatter prepended)                      │
└─────────────────────────────────────────────────────────────┘
```

This is the same data flow as component mode — the document is a JSONsx element tree, all panels derive from it, mutations produce new trees via `applyMutation()`. The only difference is the I/O layer: `.md` files go through the conversion layer on open and save.

---

## 12. Implementation Phases

### Phase 1 — Runtime Integration ✅ Complete

**Goal:** Live reactive preview in the component canvas.

- ✅ Added `onNodeCreated` callback to `@jsonsx/runtime`'s `renderNode()`
- ✅ Replaced studio's `renderCanvasNode()` with runtime mount (`renderCanvasLive()` using `buildScope` + `runtimeRenderNode`)
- ✅ Built element-to-path `WeakMap` via the callback
- ✅ Maintained `pointer-events: none` suppression for edit mode (with `requestAnimationFrame` deferred sweep for async custom element children)
- ✅ Implemented edit/preview mode toggle ("Play" button) — strips `on*` handlers in edit mode
- ✅ Ensured overlay system (selection, hover, DnD indicators) works with runtime-rendered DOM
- ✅ Retained `renderCanvasNode()` as error fallback
- ✅ Registered custom elements via `defineElement()` for `$elements` entries
- ✅ Implemented `$switch`/`cases` visual management (add/remove/rename, first-case preview)
- ✅ Implemented `$map`/repeater template editing (repeater perimeter wrapper, path remapping, `$map` placeholder scope)
- ✅ Implemented custom component rendering inside repeaters (`$props` preserved, `$map/item`/`$map/index` scope injection)
- ✅ Implemented component-mode inline text editing (single-click, `contenteditable="plaintext-only"`, raw `${...}` expressions)
- ✅ Implemented `$map` signals in inspector dropdowns for nodes inside repeater templates
- ✅ Unified breadcrumb navigation for document stack and function editor context
- ✅ Layer tree: repeaters shown as "Repeater → ref" with `↻` badge; custom component instances are atomic (no child recursion)

### Phase 2 — Markdown Canvas Mode (weeks 4-7)

**Goal:** Author and edit markdown content files using the studio's existing WYSIWYG canvas.

- Implement `md-convert.js`: `mdToJsonsx()` and `jsonsxToMd()`
- Implement `md-allowlist.js`: element allowlist + nesting constraint validation
- Wire `.md` file open to: parse → convert → load into studio state as content mode
- Wire `.md` file save to: convert → serialize → write with frontmatter
- Adapt block library: content mode shows markdown blocks + project components
- Adapt inspector: content mode shows contextual fields (href for links, src/alt for images, language for code blocks)
- Adapt DnD: enforce markdown nesting constraints via `instruction-blocked`
- Apply default content typography stylesheet to canvas in content mode
- Implement directive component placeholder rendering (name + attributes badge)
- Implement basic inline text editing: double-click to edit `textContent` in the canvas

**Exit criterion:** Can open `interactive-post.md`, see it rendered as a visual canvas with headings/paragraphs/directives, drag a heading above a paragraph, add an image block from the library, edit text inline, and save back to a valid `.md` file.

### Phase 3 — Content File Management (weeks 8-10)

**Goal:** Manage a project directory of content and component files.

- Implement directory picker via `showDirectoryPicker()`
- Implement Files panel (left panel tab): directory tree of `.md` and `.json` files
- Implement file creation, rename, delete operations
- Implement directory handle persistence (IndexedDB)
- Implement frontmatter inspector (Properties tab, root selection in content mode)
- Implement "Components Used" section showing directives in current document
- Implement "New Post" button with frontmatter template

**Exit criterion:** Can open a project directory, browse content files and components, create a new post, edit content in the canvas, edit frontmatter in the properties panel, and save.

### Phase 4 — Stylebook (weeks 11-13)

**Goal:** Design token editor for CSS custom properties and `$media` breakpoints.

- New "Design" tab in right panel
- CSS custom property editor with type-aware inputs (color picker, size input, font input)
- Token grouping by naming convention prefix (`--color-*`, `--font-*`, `--spacing-*`)
- Breakpoint editor with visual ruler
- Token preview swatches (color palette strip, typography scale)
- Link breakpoint editor to canvas panel widths

**Exit criterion:** Can define a color palette and spacing scale as CSS custom properties, see them previewed as swatches, and reference them in component styles via `var(--color-primary)`.

### Phase 5 — Component Management (weeks 14-17)

**Goal:** Multi-file project navigation with tabs.

- Tab bar below toolbar for multiple open files
- Tab state management (per-tab document, selection, history, mode)
- `.md` tabs open in content mode; `.json` tabs open in component mode
- Cross-file `$ref` navigation: click a `$ref` to open the referenced file in a new tab
- Directive click-through: click "Open Component" on a directive to open its `.json` file
- Component `$props` editing on external references in the inspector

**Exit criterion:** Can open a project, edit a blog layout component in one tab and a blog post in another, navigate between them via directive click-through, and save both.

---

*JSONsx Studio Next Steps Proposal v0.3.0-draft — subject to revision*
