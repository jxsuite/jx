# JSONsx Studio — CEM Annotation Support

> Spec for declaring and consuming Custom Elements Manifest (CEM) annotations
> within the JSONsx Studio visual builder.

## 1. Background

The JSONsx schema already defines CEM-compatible types on state entries — `attribute`,
`reflects`, `deprecated` on `TypedStateDef`; `emits` and CEM-compatible `parameters`
on `FunctionDef`; `CemParameter` and `CemEvent` sub-schemas. The runtime
(`resolveParamNames()`) handles CEM parameter objects natively.

The studio currently has zero CEM UI. This spec describes the full surface for
declaring and consuming CEM annotations within the studio interface.

No backward compatibility with string-array parameters — CEM objects only.

---

## 2. Custom Element Detection

A document is a custom element when its root `tagName` contains a hyphen (per the
HTML spec requirement for autonomous custom elements).

```js
function isCustomElementDoc() {
  return (S.document.tagName || "").includes("-");
}
```

All CEM-specific UI surfaces described below are gated behind this check and hidden
for non-custom-element documents.

---

## 3. State Entry CEM Fields

When editing a **state** category entry (primitive value with `type` + `default`) in
a custom element document, three additional fields appear below the existing
type/default/description fields:

| Field | Control | Schema type | Write-back |
|---|---|---|---|
| `attribute` | text input (placeholder: `max-count`) | `string` | `updateDef(S, name, { attribute: v \|\| undefined })` |
| `reflects` | checkbox | `boolean` | `updateDef(S, name, { reflects: checked \|\| undefined })` |
| `deprecated` | text input (reason string) | `boolean \| string` | `updateDef(S, name, { deprecated: v \|\| undefined })` |

- `attribute` links this state property to an HTML attribute (kebab-case by convention).
- `reflects` means the property value reflects back to the attribute on the DOM element.
- `deprecated` is a free-text deprecation reason; empty means not deprecated.

### Hint enhancement

The signal row hint (`defHint()`) for state entries with `attribute` set displays
`[attr-name] type` instead of just `type`, providing at-a-glance visibility.

---

## 4. Function Parameter Editor

The comma-separated string parameter input is replaced with a CEM-native parameter
editor. Parameters are always stored as CEM objects:

```json
{
  "parameters": [
    { "name": "state" },
    { "name": "event", "type": { "text": "PointerEvent" }, "description": "The click event" }
  ]
}
```

### Basic mode (default)

Compact inline display showing parameter names as chips/tags. Each chip is removable
(× button). An inline text input at the end allows typing a name and pressing Enter
to append `{ name: "..." }`.

A toggle link **▸ Advanced** expands to full mode.

### Advanced mode

Full list of parameter rows. Each row contains:

| Column | Control | Required |
|---|---|---|
| `name` | text input | yes |
| `type` | text input (placeholder: `Event`) | no |
| `description` | text input | no |
| `optional` | checkbox | no |

Each row has a delete (×) button. A **+ Add parameter** link appends a new empty row.
A toggle link **▾ Basic** collapses back to chip view.

### Auto-migration

Any bare strings encountered in `def.parameters` are silently converted to
`{ name: str }` on first edit. No legacy string-array mode exists in the UI.

---

## 5. Function Emits Editor

Functions in custom element documents gain an **Emits** section for declaring the
custom events they dispatch. Each entry is a `CemEvent`:

```json
{
  "emits": [
    { "name": "task-toggled", "type": { "text": "CustomEvent" }, "description": "Fired when a task's done state changes" }
  ]
}
```

### UI

A section header "Emits" followed by event declaration rows:

| Column | Control | Required |
|---|---|---|
| `name` | text input (placeholder: `item-selected`) | yes |
| `type` | text input (placeholder: `CustomEvent`) | no |
| `description` | text input | no |

Each row has a delete (×) button. A **+ Add event** link appends a new empty row.

Only shown when `isCustomElementDoc()`.

---

## 6. Observed Attributes Panel

A read-only inspector section on the **right panel** (properties tab) when the root
node is selected in a custom element document.

**Title**: "Observed Attributes"
**Default**: collapsed

Content is auto-derived by scanning `S.document.state` for entries where `attribute`
is set:

| Column | Source |
|---|---|
| Attribute name | `def.attribute` |
| State key | the property name in `state` |
| Type | `def.type` |
| Reflects | badge if `def.reflects` is truthy |

This provides an at-a-glance overview of the element's attribute API without
navigating to individual state entries.

---

## 7. CSS Custom Properties Panel

A read-only inspector section shown for custom element documents.

**Title**: "CSS Properties"
**Default**: collapsed

Scans the root `style` object for keys matching `--*` (CSS custom properties).
Displays each with its name and default value.

---

## 8. CSS Parts Panel

A read-only inspector section shown for custom element documents.

**Title**: "CSS Parts"
**Default**: collapsed

Recursively scans the document tree for nodes with `attributes.part` set. Displays
each part name alongside the element's tag name.

```js
function collectCssParts(node, parts = []) {
  if (node?.attributes?.part)
    parts.push({ name: node.attributes.part, tag: node.tagName || "div" });
  if (Array.isArray(node?.children))
    node.children.forEach(c => collectCssParts(c, parts));
  return parts;
}
```

---

## 9. Declared Events in Events Panel

The existing Events panel (right panel, events tab) shows DOM event bindings
(`onclick`, `oninput`, etc.). For custom element documents, a **Declared Events**
section appears at the top, before the DOM bindings.

This section aggregates all `emits` entries from all functions in `state`:

| Column | Source |
|---|---|
| Event name | `emit.name` |
| Source function | the state key of the function |
| Type | `emit.type.text` |
| Description | `emit.description` |

Read-only — editing happens in the function's emits editor (Section 5).

---

## 10. CEM Export

A toolbar button **"CEM"** appears for custom element documents (after the zoom
controls). Clicking it generates a CEM 2.1.0 manifest from the current document:

| CEM field | Source |
|---|---|
| `members` | state entries → fields (state category) + methods (function category) |
| `attributes` | state entries with `attribute` set |
| `events` | all function `emits` arrays, deduplicated by name |
| `slots` | scan children for `<slot>` elements |
| `cssProperties` | scan root `style` for `--*` keys |
| `cssParts` | scan tree for `attributes.part` |

Output is downloaded as `<tagName>.cem.json`.

---

## 11. Cleanup

- **Remove stale `signal` checkbox**: The function editor still renders a `signal`
  checkbox — leftover from before the `signal: true` removal. Delete it.

- **`STUDIO_RESERVED_KEYS`**: Add CEM annotation keys to prevent them from being
  rendered redundantly by the schema-driven form fallback:

```js
const STUDIO_RESERVED_KEYS = new Set([
  "$prototype", "$src", "$export", "signal", "timing", "default",
  "description", "body", "parameters", "name",
  "attribute", "reflects", "deprecated", "emits",
]);
```

---

## 12. Non-goals

- **CEM import**: Reading an external `.cem.json` and populating a document from it.
  Out of scope for this iteration.
- **observedAttributes array editing**: The `observedAttributes` array on the document
  root is derived from state entries with `attribute` set; no separate editor needed.
- **Parameter drag reordering**: Future enhancement; add/remove is sufficient for now.
