# Jx Markdown Specification

**Version:** 0.1.11-draft\
**Status:** Partial\
**Updated:** 2026-09-29\
**License:** MIT

---

Jx Markdown is a first-class authoring format for Jx components and content pages. It uses standard Markdown syntax enhanced with YAML frontmatter and [remark-directive](https://github.com/remarkjs/remark-directive) syntax to represent the full Jx component model.

Jx Markdown is primarily intended for content-heavy components. JSON remains the preferred format for technically complex components. The studio visual editor works transparently on both formats.

## 1. Relationship to JSON

Markdown is a transpilation source — `.md` files compile to the same JSON document structure the runtime and compiler already consume. The transpiler (`transpileJxMarkdown`, exposed as the `Markdown` format class's `parse` capability) produces a standard Jx JSON document from markdown source. Round-tripping is supported via `serializeJxMarkdown` (`@jxsuite/parser/serialize`, the `Markdown` class's `serialize` capability). Markdown support is opt-in: a project must import the `Markdown` format class (see specs/extensions.md) — there is no implicit `.md` handling in any host.

```
author.md → transpileJxMarkdown() → Jx JSON → compiler/runtime
                                        ↑
                            serializeJxMarkdown() ← studio editor / site export
```

## 2. Format Overview

A Jx Markdown file consists of:

1. **YAML frontmatter** — top-level document properties (`tagName`, `state`, `$media`, etc.)
2. **Directive body** — element tree using remark-directive syntax
3. **Standard markdown** — headings, paragraphs, lists, etc. (mapped to HTML elements)

### 2.1 Minimal Example

```markdown
---
tagName: my-greeting
state:
  name:
    type: string
    default: World
---

:::div

# Hello, ${state.name}!

:::
```

## 3. YAML Frontmatter

All top-level Jx document properties are declared in YAML frontmatter. The `$` prefix is preserved in YAML (unlike directive attributes — see below).

Supported frontmatter keys:

| Key                  | Description                                     |
| -------------------- | ----------------------------------------------- |
| `tagName`            | Custom element tag name (must contain a hyphen) |
| `$schema`            | JSON Schema reference                           |
| `$id`                | Document identifier                             |
| `state`              | Reactive state definitions                      |
| `$media`             | Media query responsive styles                   |
| `$defs`              | Reusable definitions                            |
| `$elements`          | Child element dependencies                      |
| `$layout`            | Layout template reference                       |
| `$paths`             | Dynamic route parameters (for pages)            |
| `$handlers`          | Companion JS file reference                     |
| `imports`            | Module imports                                  |
| `observedAttributes` | Custom element observed attributes              |

Any additional frontmatter keys are passed through to the document.

### 3.1 Detection

A `.md` file is a Jx component, rather than content markdown, when its frontmatter `tagName` is a string with at least one character on each side of a hyphen (the pattern `.+-.+`), the Markdown form of the hyphenated root that makes a document a custom element definition (`spec.md` §16.1). The rule reads the parsed frontmatter, so a quoted or block-scalar `tagName`, or one written in flow-mapping frontmatter, counts, and a hyphen in a YAML comment does not. The `Markdown` format class declares it as data, `$studio.documentMode: { "default": "content", "componentWhen": { "frontmatterKey": "tagName", "matches": ".+-.+" } }` (`parser.md` §3), and Studio classifies each file it opens by that hint (`studio.md` §8.1). `isJxMarkdown(source)` (§12.2) applies the same rule to a source string, for a caller outside the format registry.

Detection does **not** gate the pipeline: every `.md` file goes through `transpileJxMarkdown()`, which returns the same shape either way, frontmatter keys at the top level and the body as `children`, so a content document's root carries a `tagName` only when its frontmatter writes one. Studio edits every content document as a root with no `tagName`: `children`, `state` and `imports` stay on the document, every other frontmatter key (a `tagName` without a hyphen included) is held apart as the document's frontmatter, and the two are merged back when the file is saved (`studio.md` §8.3). A body with no blocks is given one empty paragraph to type into, which serializes to nothing. This enables gradual enhancement: any `.md` file can add Jx schema at any point without changing how it is processed.

## 4. Directive Syntax

Jx Markdown uses the three directive types defined by the [directive proposal](https://talk.commonmark.org/t/generic-directives-plugins-syntax/444):

### 4.1 Container Directives

Container directives wrap children. Outer containers use **more** colons, inner containers use **fewer**. Closing fences must match the opening colon count.

```markdown
::::section{className="hero"}
:::h1
Welcome
:::

:::p
Get started today.
:::
::::
```

### 4.2 Leaf Directives

Leaf directives are self-closing (no children).

```markdown
::hr

::input{type="text" placeholder="Enter name"}

::img{src="/photo.jpg" alt="A photo"}
```

### 4.3 Text Directives

Inline directives within text.

```markdown
Click :a[here]{href="/about"} for details.
```

## 5. Nesting Convention

Outer containers use **more** colons than inner ones. This is the standard remark-directive convention.

```markdown
::::::app
:::::header
::::nav
:::a{href="/"}
Home
:::
::::
:::::
::::::
```

The minimum is 3 colons for a container directive. Each nesting level reduces by one, with a floor of 2 (which becomes a leaf directive).

## 6. Attribute Conventions

### 6.1 Standard Attributes

Directive attributes use the standard HTML-like syntax:

```markdown
::div{className="card" id="main-card"}
```

### 6.2 `$`-Prefix Keywords

The `$` character cannot appear at the start of remark-directive attribute keys. The following Jx keywords are written **without** the `$` prefix in directive attributes, and the transpiler re-adds it:

| Markdown attribute | Jx property  |
| ------------------ | ------------ |
| `prototype`        | `$prototype` |
| `ref`              | `$ref`       |
| `component`        | `$component` |
| `props`            | `$props`     |
| `switch`           | `$switch`    |
| `elements`         | `$elements`  |

DOM properties like `src`, `id`, and `export` are **not** mapped — they pass through as-is.

```markdown
::children{prototype="Array" items.ref="#/state/items"}
```

### 6.3 `--` Annotation Keys

Element annotations use the `--` prefix in markdown directives to avoid collision with the HTML `title` attribute:

| Markdown attribute | Jx property    |
| ------------------ | -------------- |
| `--title`          | `$title`       |
| `--description`    | `$description` |

These are developer-facing metadata annotations, dropped during HTML compilation. `$title` is displayed as the element label in Jx Studio's layers panel.

```markdown
:::section{--title="Hero Section" --description="Primary landing area with CTA"}

# Welcome

:::
```

### 6.4 Dot-Path Attributes

Nested objects are encoded as dot-separated attribute keys:

```markdown
::::::todo-list{children.prototype="Array" children.items.ref="#/state/items" children.map.component="todo-item" children.map.props.item.ref="$map/item"}
::::::
```

This expands to:

```json
{
  "tagName": "todo-list",
  "children": {
    "$prototype": "Array",
    "items": { "$ref": "#/state/items" },
    "map": {
      "$component": "todo-item",
      "$props": { "item": { "$ref": "$map/item" } }
    }
  }
}
```

### 6.5 Prototype Directives (`:::Array`)

> **Status: Partial.** The directive ships: `prototypeDirectiveToJx` (`extensions/parser/src/transpile.ts`) restores `$prototype`, expands the attributes and takes the first element child as `map`, `prototypeToDirective` (`extensions/parser/src/serialize.ts`) writes it back, and the older dot-path form still parses. The worked example does not produce the JSON shown: the `:li{…}` line parses as a `p` wrapping the `li`, and `children.0` expands to an object keyed `"0"`. The round trip is not lossless for a template markdown can only write inside a parent: an `li` map serializes as a bare `- …` list item and re-parses as `ul > li > p`. A repeater among a list's items, the shape Studio's Convert to Repeater leaves when it converts a list item, fares worse: it is written between the `- …` items and re-parses outside the list, as its sibling.

An array pseudo-element (repeater) has no `tagName`, so it serializes as a directive **named after its `$prototype`** — e.g. `:::Array`. The directive's attributes carry `items`/`filter`/`sort` (dot-path encoded), and its nested block content is the `map` template. On parse, the synthetic tagName is dropped and `$prototype` is restored. Because it is an ordinary block directive, a repeater can sit among sibling blocks:

```markdown
# Recent posts

:::Array{items.ref="#/state/posts"}
:li{children.0="${$map/item/title}"}
:::
```

Expands to:

```json
{
  "$prototype": "Array",
  "items": { "$ref": "#/state/posts" },
  "map": { "tagName": "li", "children": ["${$map/item/title}"] }
}
```

This is the canonical, round-trippable encoding. The older dot-path form (`children.prototype="Array" …` on the parent directive) is still accepted on parse for backward compatibility.

### 6.6 HTML Attributes

A directive attribute is an HTML attribute unless Jx gives its name a meaning of its own. After the key mapping and dot-path expansion of §6.2–§6.4, `routeAttributes` (`extensions/parser/src/transpile.ts`) sends each key to one of two places, by the same rule on every element, standard or custom:

- **The element definition** (spec.md §8.1): the structural keys `style`, `children`, `cases` (the companion of `switch`, spec.md §14.1), `textContent`, `innerText` and `innerHTML`; every `$`-key (§6.2, §6.3); every key beginning `on`, which both renderers bind as an event handler (spec.md §4.3); and the element properties `id`, `className`, `hidden`, `tabIndex`, `lang` and `dir`.
- **The `attributes` object** (spec.md §8.3): every other key. That includes `aria-*`, `data-*` and `slot`, the attributes a property reflects (`href`, `src`, `alt`, `title`, `type`, `name`, `placeholder`, `disabled`), and any attribute a custom element reads (`variant`). A value meant for a component's state is written `props.*` instead (§6.4).

A name is written as HTML spells it (`for`, `colspan`, `readonly`) and reaches the page as written: the runtime sets it with `setAttribute`, and the static emitter writes it into the tag. remark-directive's shorthands follow the same rule, so `#main` gives the element-level `id` and `.card` gives `attributes.class`. A bare `hidden`, written without a value, is `true`, as the attribute is in HTML; every other value is the string written (§6.1).

`value`, `checked` and `selected` are attributes too, so on a form control they set its default, as they do in HTML. A bound `value` stops updating a text field once the user has typed in it, and a `select` has no `value` attribute at all (§10).

```markdown
::div{className="card" data-testid="main" aria-label="Main card"}
```

Produces:

```json
{
  "tagName": "div",
  "className": "card",
  "attributes": {
    "data-testid": "main",
    "aria-label": "Main card"
  }
}
```

A custom element routes the same way:

```markdown
::my-card{#featured className="card" onclick.ref="#/state/open" variant="compact"}
```

Produces:

```json
{
  "tagName": "my-card",
  "id": "featured",
  "className": "card",
  "onclick": { "$ref": "#/state/open" },
  "attributes": { "variant": "compact" }
}
```

The flat attribute list does not record which of the two places a key came from. An element definition that sets a reflected property at element level (`"href": "/about"`) therefore comes back from a markdown round trip under `attributes`, where it renders the same, except for `value`, `checked` and `selected` (above; §12.8).

## 7. Style Attributes

Element styles are expressed as `style.*` dot-path attributes on the element directive. Root-level styles go in YAML frontmatter.

### 7.1 Element Styles

```markdown
::button{className="primary" style.backgroundColor="blue" style.color="white" style.padding="8px 16px"}
Click me
```

Produces:

```json
{
  "tagName": "button",
  "className": "primary",
  "style": {
    "backgroundColor": "blue",
    "color": "white",
    "padding": "8px 16px"
  }
}
```

### 7.2 Root Styles (YAML Frontmatter)

Root-level styles are declared in YAML frontmatter under the `style` key. YAML has no attribute-key restrictions, so `:hover`, `@--dark`, etc. are written directly:

```yaml
---
tagName: my-comp
style:
  fontFamily: "system-ui, sans-serif"
  maxWidth: 560px
  "@--dark":
    backgroundColor: "#1a1a1a"
    color: "#f0f0f0"
---
```

### 7.3 Pseudo-Classes in Style Attributes

The `:` character cannot start a remark-directive attribute key. CSS pseudo-class and pseudo-element names are written **without** their colons inside `style.*` attributes, and the transpiler restores them:

```markdown
::button{style.backgroundColor="white" style.hover.backgroundColor="blue" style.hover.cursor="pointer" style.focus.outline="2px solid blue"}
```

Produces:

```json
{
  "tagName": "button",
  "style": {
    "backgroundColor": "white",
    ":hover": { "backgroundColor": "blue", "cursor": "pointer" },
    ":focus": { "outline": "2px solid blue" }
  }
}
```

Recognized pseudo-CLASS names, which take one colon: `hover`, `focus`, `active`, `visited`, `disabled`, `checked`, `valid`, `invalid`, `required`, `empty`, `first-child`, `last-child`, `focus-within`, `focus-visible`, `popover-open`, `open`, `modal`.

Recognized pseudo-ELEMENT names, which take **two** colons: `backdrop`, `placeholder`, `selection`, `before`, `after`. A separate set because the prefix differs, not because the concept does. `backdrop`, `placeholder` and `selection` have never had a one-colon form, so a one-colon rule for them is discarded by the browser; `before` and `after` have a legacy one-colon form CSS still accepts, and take two so a `.md` component and Studio's Style tab name the same key.

A name is restored at every depth of the style path, wherever it names a block: `style.--dark.hover.color` is a `:hover` block inside the `@--dark` block (§7.4), and `style.hover.placeholder.color` is a `::placeholder` block inside `:hover`. A key that holds a value rather than a block is a declaration and keeps its name.

An unrecognized name is left unprefixed and is then read as a descendant TYPE selector — `style.popover-open.opacity=1` emitted `#panel popover-open { opacity: 1 }`, a rule matching nothing with nothing to say so. That is why the overlay states had to be named here: without them a popover authored in a `.md` component could not be styled open at all.

Only the first character of an attribute key is restricted, so a selector outside both lists is written with its own colons after `style.`: `style.::marker.color`, `style.:user-invalid.outline`, `style.:popover-open::backdrop.opacity`. Such a key is kept exactly as written.

### 7.4 Media Queries in Style Attributes

The `@` character cannot start an attribute key. Media query keys starting with `--` are written without the `@` prefix:

```markdown
::div{style.backgroundColor="white" style.--dark.backgroundColor="#1a1a1a" style.--dark.color="#e0e0e0"}
```

Produces:

```json
{
  "tagName": "div",
  "style": {
    "backgroundColor": "white",
    "@--dark": { "backgroundColor": "#1a1a1a", "color": "#e0e0e0" }
  }
}
```

The `@` is restored at every depth, so a breakpoint may sit inside a state (`style.hover.--md.gap`) as well as around one (§7.3). Only a `--` key that holds a block is a breakpoint: a `--` key given a value (`style.--accent="teal"`, or a binding written `style.--accent.ref="#/state/accent"`) is a CSS custom property, a declaration under spec.md §9.1, and keeps its name. The exception is a name in §6.3's table, which is read as that annotation at every segment of a dot path, so a custom property of that name cannot be written in a `.md` file.

## 8. Array Children

Arrays (mapped lists) are encoded using `children.*` dot-path attributes on the parent container element:

```markdown
::::::todo-list{children.prototype="Array" children.items.ref="#/state/todos" children.map.component="todo-item" children.map.props.item.ref="$map/item" children.map.props.index.ref="$map/index"}
::::::
```

The `children.*` attributes expand to a `children` descriptor object (not an array). The transpiler detects this and preserves the object form, skipping the normal content-children array.

## 9. Standard Markdown Mapping

> **Status: Partial.** The table and build-time highlighting ship (`JX_TAG_MAP` and `mdastNodeToJx` in `extensions/parser/src/transpile.ts`, `extensions/parser/src/highlight.ts`), but a reference-style link or image (`[text][label]`, `![alt][label]` with a `[label]: url` definition) is dropped together with its text, and a GFM footnote with its definition. Two constructs the table does not list are mapped rather than dropped: raw HTML goes through `htmlToJx` and a hard line break becomes `br`. §13's CommonMark note says §10 names the unmapped constructs and that each is dropped; §10 names none of them.

Standard markdown nodes map to Jx elements:

| Markdown       | Jx tagName                                   |
| -------------- | -------------------------------------------- |
| `# Heading`    | `h1`–`h6`                                    |
| Paragraph      | `p`                                          |
| `*emphasis*`   | `em`                                         |
| `**strong**`   | `strong`                                     |
| `~~delete~~`   | `del`                                        |
| `` `code` ``   | `code`                                       |
| `[link](url)`  | `a`                                          |
| `![alt](url)`  | `img`                                        |
| `> blockquote` | `blockquote`                                 |
| `- list`       | `ul` / `ol` + `li`                           |
| Fenced code    | `pre` > `code`                               |
| `---`          | `hr`                                         |
| Table          | `table` > `thead`/`tbody` > `tr` > `th`/`td` |

Fenced code with a known language tag is syntax-highlighted at compile time in the node-side markdown path (`processMarkdown`): the `code` element's text is replaced by token `span` children, each carrying its light and dark colors as `--shiki-light` / `--shiki-dark` CSS custom properties, and the `code` element gains a `shiki` class alongside `language-<lang>`. The page stylesheet chooses which variable paints (typically via the color-scheme contract, spec.md §9.5). Grammars: json, typescript, javascript, markdown, html, shellscript, css, yaml (plus their registered aliases — `ts`, `js`, `bash`, `sh`, `md`, `yml`, …). Unknown languages and bare fences keep plain `textContent`. The browser-safe transpile module (`@jxsuite/parser/transpile`) never highlights — Studio and other browser callers see plain fences.

## 10. Limitations

1. **No runtime format** — `.md` always transpiles to JSON before compilation or rendering
2. **Attribute key restrictions** — `:`, `@`, and `$` cannot start directive attribute keys (use the conventions above)
3. **Complex state logic** — components with intricate `$prototype: Function` bodies or deeply nested state may be clearer in JSON
4. **No inline JavaScript** — event handler bodies and computed expressions live in YAML frontmatter `state` definitions, not in the directive body
5. **Form-control state** — a directive's `value`, `checked` and `selected` are the control's default (§6.6); a field that must keep following a binding after the user edits it belongs in a JSON component (§11)

## 11. When to Use JSON vs Markdown

| Use Markdown                           | Use JSON                                   |
| -------------------------------------- | ------------------------------------------ |
| Content-heavy pages (blog posts, docs) | Complex interactive components             |
| Components with significant prose      | Components with many state functions       |
| Landing pages, marketing content       | Deeply nested element hierarchies          |
| Quick prototyping                      | Components with complex `$prototype` usage |

## 12. Transpiler API

### 12.1 `transpileJxMarkdown(source: string): object`

Converts a Jx Markdown string to a Jx JSON document. Available from both `@jxsuite/parser` (Node.js) and `@jxsuite/parser/transpile` (browser-safe).

### 12.2 `isJxMarkdown(source: string): boolean`

Returns `true` when the source is a Jx component by §3.1's rule, applied to the frontmatter `transpileJxMarkdown` parses, and `false` otherwise, including for a source that does not transpile.

### 12.3 `expandDotPaths(attrs: Record<string, string>): Record<string, any>`

Expands flat dot-path attribute keys into nested objects with Jx `$`-prefix restoration.

### 12.4 `expandStylePaths(attrs: Record<string, string>): Record<string, any>`

Like `expandDotPaths`, then applies `applyStyleKeyMapping` (§12.5). Used for style attribute expansion.

### 12.5 `applyStyleKeyMapping(styleObj: Record<string, any>): Record<string, any>`

Maps the keys of a style object that hold a block, at every depth: pseudo-class names get `:` and pseudo-element names get `::` (§7.3), `--` keys get `@` (§7.4). A block is a plain object that is not a `{ "$ref": … }` binding; any other key is a declaration and is left as written. Used internally by `routeAttributes()` to transform `style.*` dot-path attributes after generic expansion.

### 12.6 `collapseDotPaths(obj: Record<string, any>): Record<string, string>`

Inverse of `expandDotPaths` — flattens a nested object to dot-path attributes.

### 12.7 `collapseStylePaths(styleObj: Record<string, any>): Record<string, string>`

Inverse of `expandStylePaths`: strips the `:`, `::` and `@` prefixes §12.5 adds, at every depth, before flattening. A key §12.5 would not have produced, such as `:placeholder` or `::marker`, is kept as written and re-expands to itself.

### 12.8 `serializeJxMarkdown(doc: object, options?): string`

> **Status: Partial.** Both modes ship (`serializeRoundtrip` and `serializeExport` in `extensions/parser/src/serialize.ts`; Studio saves through roundtrip mode in `packages/studio/src/files/serialize-document.ts`), and a `tagName` chosen at render time throws as stated. Roundtrip mode is not the inverse of `transpileJxMarkdown` for several ordinary shapes, and no test feeds its output back through `transpileJxMarkdown`. `textContent` or inline children of a directive outside the transpiler's phrasing set (`div`, `section`, any custom element) are written as bare block content and come back wrapped in `p`, one paragraph per inline child, with edge whitespace lost. An element-level `href`, `title` or `value` comes back under `attributes` (§6.6). The first two render the same, but a bound `value`, `checked` or `selected` becomes the control's default. An `li` or table-part `map` template, or a repeater among a list's items, does not come back as written (§6.5). The `popover-open`, `open` and `modal` pseudo-class keys and every pseudo-element key (`backdrop`, `placeholder`, `selection`, `before`, `after`) are written with their colons (`style.:popover-open.opacity`, `style.::placeholder.color`), because the serializer keeps its own pseudo-class set instead of using `collapseStylePaths` (§12.7); they re-parse, but not in the §7.3 spelling.

Converts a Jx JSON document back to markdown source (`@jxsuite/parser/serialize`). Two modes:

- `mode: "roundtrip"` (default) — lossless for everything it can express: YAML frontmatter from non-children doc keys, non-markdown elements emitted as directives with collapsed dot-path attributes. Inverse of `transpileJxMarkdown()`. It is not TOTAL: a `tagName` chosen at render time cannot be expressed at all and throws, naming the candidates it saw.
- `mode: "export"` — lossy clean GFM: Jx decoration stripped, wrapper tags unwrapped, custom elements inlined via injected `componentDefs`, template strings evaluated via injected hooks. Used by site builds for `.md` export sidecars.

This is the single Jx→markdown serializer — the studio and the compiler both dispatch to it through the `Markdown` format class.

## 13. Standards Alignment

External standards this specification binds itself to. Vocabulary and cell grammar: [`standards.md`](./standards.md). `remark-directive` is a library rather than a standard; the directive syntax it implements is a CommonMark _proposal_ that was never accepted, which is why §4 is described rather than cited. The frontmatter media type is tracked against `parser.md` §3, where the format class that reads it lives.

| Standard                                           | Class      | Binds | Evidence                                                                      | Note                                                                                                                                                                                    |
| -------------------------------------------------- | ---------- | ----- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CommonMark](https://spec.commonmark.org/current/) | **Subset** | §9    | extensions/parser/src/transpile.ts, extensions/parser/tests/transpile.test.ts | The block and inline constructs §9 tabulates map to Jx nodes. §10 names what does not: a construct outside that table has no Jx representation and is dropped rather than approximated. |

## Changelog

- **0.1.11-draft** (2026-09-29) — Census against the code: §3.1, §6.5, §6.6, §7.3, §9 and §12.8 gain Partial markers. They record where the content-document root, the repeater example and its round trip, the HTML-attribute routing, the placeholder and selection pseudo-elements, reference links and the CommonMark note, and roundtrip serialization differ from the text.
- **0.1.10-draft** (2026-08-31) — popover-open, open and modal are recognized pseudo-classes; backdrop is a pseudo-element taking two colons.
- **0.1.9-draft** (2026-08-27) — 12.8: roundtrip serialization is lossless where expressible, not total.
- **0.1.8-draft** (2026-08-15) — Number the sections so they are addressable, and add §13 Standards Alignment.
- **0.1.7-draft** (2026-07-22) — Proper spec versioning (`05c12d47`).
- **0.1.6-draft** (2026-07-22) — Machine-readable spec status vocabulary + generated status page (`dd415a70`).
- **0.1.5-draft** (2026-07-17) — Build-time syntax highlighting for markdown code fences (`b9298f5b`).
- **0.1.4-draft** (2026-06-15) — Arrays as pseudo-element (`32aad304`).
- **0.1.3-draft** (2026-06-10) — Consolidate markdown and csv handling to the parser package (`66ea8c35`).
- **0.1.2-draft** (2026-05-25) — Element annotations (title/description) (`a189b13e`).
- **0.1.1-draft** (2026-05-20) — Run formatter (`bfb5b932`).
- **0.1.0-draft** (2026-05-11) — Jx markdown (`9412a905`).
