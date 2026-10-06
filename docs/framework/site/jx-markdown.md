---
title: "Jx Markdown"
description: "Author Jx components and pages in Markdown: YAML frontmatter, directive syntax, attribute conventions, and when to choose Markdown over JSON."
spec:
  - jx-markdown.md
  - parser.md#3.3
  - parser.md#3.4
  - parser.md#3.5
code:
  - extensions/parser/src/transpile.ts
  - extensions/parser/src/serialize.ts
  - extensions/parser/src/highlight.ts
  - extensions/parser/src/alerts.ts
  - extensions/parser/src/inert.ts
  - extensions/parser/src/grammars/caddyfile.ts
---

# Jx Markdown

> **Studio writes this format for you.** The [writing surface](/docs/studio/editing/writing) and [frontmatter panel](/docs/studio/editing/frontmatter) edit `.md` files visually, and this page documents the syntax for when you hand-edit one or read a diff.

A Jx Markdown file is a Markdown document that transpiles to the same JSON structure the compiler and runtime consume everywhere else. It combines three layers:

1. **YAML frontmatter** carries top-level document properties (`tagName`, `state`, `style`, …)
2. **Directives** are explicit elements using [remark-directive](https://github.com/remarkjs/remark-directive) syntax
3. **Standard Markdown** maps headings, paragraphs, lists, and links to HTML elements

Markdown support is opt-in: the project must enable the parser extension in `project.json` (`"extensions": ["@jxsuite/parser"]`). There is no implicit `.md` handling without it.

## A minimal component

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

The frontmatter declares the document schema; the body declares the element tree. A `.md` file whose frontmatter has a `tagName` containing a hyphen is a component; a file without one is a content document (a blog post, a docs page) that produces a plain element tree. Any content file can add component schema later without changing how it's processed.

## Frontmatter

All top-level Jx document keys go in the YAML frontmatter, `$` prefixes included: `tagName`, `$id`, `state`, `$media`, `$defs`, `$elements`, `$layout`, `$paths`, `$handlers`, `imports`, `observedAttributes`. Any other keys pass through to the document unchanged, which is how pages set `title` or `$head`.

## Directives

Three directive forms cover the element tree:

**Container directives** wrap children. Outer containers use _more_ colons than inner ones (minimum three), and the closing fence matches the opening count:

```markdown
::::section{className="hero"}
:::h1
Welcome
:::
::::
```

**Leaf directives** (two colons) are self-closing:

```markdown
::img{src="/photo.jpg" alt="A photo"}
```

**Text directives** (one colon) sit inline within prose:

```markdown
Click :a[here]{href="/about"} for details.
```

The directive name is the element's `tagName`: any HTML tag or any registered custom element.

## Attributes

Attributes use the HTML-like `{key="value"}` syntax. Three characters can't start a directive attribute key (`$`, `:`, and `@`), so Jx defines drop-the-prefix conventions that the transpiler reverses:

| You write                                                      | The document gets                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `prototype`, `ref`, `component`, `props`, `switch`, `elements` | `$prototype`, `$ref`, `$component`, `$props`, `$switch`, `$elements`     |
| `--title`, `--description`                                     | `$title`, `$description` (element annotations, dropped from HTML output) |
| `style.hover.color` (see below)                                | `style[":hover"].color`                                                  |

DOM properties like `src`, `id`, and `export` are not mapped; they pass through as-is. Attributes matching `aria-*`, `data-*`, or `slot` route into the element's `attributes` object; everything else becomes a top-level DOM property.

Nested objects are written as dot-separated keys. Props on a component instance use `props.*`:

```markdown
:::pricing-card{props.plan="Pro" props.price.ref="#/state/proPrice"}
:::
```

which expands to:

```json
{
  "tagName": "pricing-card",
  "$props": {
    "plan": "Pro",
    "price": { "$ref": "#/state/proPrice" }
  }
}
```

## Style attributes

Element styles are `style.*` dot-path attributes. CSS pseudo-classes drop their `:` prefix and named media queries drop their `@` prefix, and the transpiler restores both. Pseudo-_elements_ get two colons back: `backdrop` becomes `::backdrop`, while `before` and `after` keep the one-colon spelling CSS has always accepted.

Only recognised names are restored. An unrecognised one stays bare and is then read as a descendant type selector, which matches nothing and says nothing about it, so [popover](/docs/framework/concepts/overlays) states are on the list: `popover-open`, `open` and `modal` alongside `hover`, `focus` and the rest.

```markdown
::button{style.padding="8px 16px" style.hover.backgroundColor="blue" style.--dark.color="#f0f0f0"}
Click me
```

```json
{
  "tagName": "button",
  "style": {
    "padding": "8px 16px",
    ":hover": { "backgroundColor": "blue" },
    "@--dark": { "color": "#f0f0f0" }
  }
}
```

Root-level styles go in frontmatter under `style`, where YAML allows `:hover` and `@--dark` keys to be written directly.

## Repeaters

An [array repeater](/docs/studio/design/repeaters) has no `tagName`, so it serializes as a directive named after its `$prototype`, with the nested block as the `map` template:

```markdown
# Recent posts

:::Array{items.ref="#/state/posts"}
:li{children.0="${$map/item/title}"}
:::
```

## Heading anchors

Every heading gets an `id` built from its own text, so `## Getting started` becomes `#getting-started` and repeats get `-2`, `-3` in document order. Two things about that are worth knowing outside English: letters in any script are kept, so a Japanese or Cyrillic heading gets a real anchor rather than an empty one, and an accented heading produces one anchor whichever way the accent was typed, since `é` can be a single character or an `e` plus a combining mark, which look identical and used to produce two different links. Plain-ASCII headings are unaffected, so existing links keep working.

## Standard Markdown

Plain Markdown maps to the elements you'd expect: headings to `h1`–`h6`, paragraphs to `p`, emphasis to `em`/`strong`, links to `a`, images to `img`, lists to `ul`/`ol` + `li`, fenced code to `pre` > `code`, tables to `table` structures. Mixing prose and directives in one file is the normal case, not a special one.

Fenced code with a recognized language tag is syntax-highlighted at build time. The set is `json`, `jsonc`, `ts`, `js`, `bash`, `html`, `xml`, `css`, `yaml`, `toml`, `ini`, `md`, `sql`, `php`, `python`, `ruby`, `nix`, `nginx`, `caddyfile`, `diff` and `dockerfile`, with their usual aliases (`sh`, `py`, `rb`, `yml`): each token becomes a `span` carrying its light and dark colors as `--shiki-light`/`--shiki-dark` CSS variables, so highlighting follows the site's [color scheme](/docs/framework/concepts/color-schemes) automatically. Unknown languages fall back to plain text, and no fence ever breaks.

:::doc-note
These docs are themselves Jx Markdown: every aside like this one is a container directive (`:::doc-note`, `:::doc-tip`, `:::doc-warning`) rendered by a component the docs site registers via `$elements` on its content collection.
:::

## Code that looks like a template

Jx treats any string containing `${` as a template, which is right for documents you write and wrong for the content of a Markdown entry. A fence that shows a JavaScript template literal (`${name}`), a shell variable (`${HOME}`) or a GitHub Actions expression (`${{ secrets.TOKEN }}`) is showing text, and the content loader keeps it that way: the page prints exactly what you wrote, in fences, inline code, headings, paragraphs, lists and tables. Nothing in a Markdown body is evaluated by the build. The one exception is a `${` inside an attribute value, such as a link's `href`, which is still read as a template.

## Callouts

A blockquote that starts with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` is a callout, the notation GitHub and Obsidian share:

```markdown
> [!WARNING]
> Back up the site before you run this.

> [!TIP] Faster restores
> Restore into a scratch site first.
```

Text after the marker on the same line is the callout's title (Obsidian's form; GitHub shows it as plain text), and with none the title is the type's name. Callouts nest inside lists and inside each other, and the marker is matched without regard to case. A file saved with Windows line endings reads the same as one with Unix endings. An ordinary blockquote stays a blockquote, and so does one whose type nobody has enabled: the load prints a warning that names the file and the type, because the literal `[!info]` on the page is otherwise the only clue.

Without configuration a callout renders as a `div` with `role="note"` and the classes `jx-alert` and `jx-alert-note` (or `-tip`, and so on), whose first child is a visible `p.jx-alert-title`. It carries no styles, so your stylesheet decides what it looks like. The title is a paragraph rather than a heading, so a callout never appears in the table of contents or the search index's section list.

A content type's `alerts` option swaps in your own components, the same ones `:::doc-note` uses:

```json
{
  "content": {
    "docs": {
      "source": "./docs",
      "format": "Markdown",
      "alerts": { "NOTE": "doc-note", "TIP": "doc-tip", "WARNING": "doc-warning" }
    }
  }
}
```

A mapped type renders as that element with the alert type at `data-alert` and any author title at `data-title`; types you leave out keep the built-in markup. Map a type to `null` or `false` to leave it a plain blockquote, or to `true` to switch on a type beyond GitHub's five (`"INFO": true`) with the built-in markup, which is how Obsidian's extra types (`info`, `example`, `faq`) are enabled. `"alerts": false` turns callouts off for the whole content type. The element still has to be registered where the pages render, as it is for a directive.

The built-in titles are English (`Note`, `Warning`). A localized site gives a callout its own title (`> [!WARNING] Attention`) or maps the types onto components that translate them.

:::doc-note
Callouts are a content-loading feature. Studio's canvas opens a `.md` file through the component parser, which keeps the blockquote exactly as you wrote it, so the callout appears on the built site and in previews that build, not in the canvas. The file on disk is never changed.
:::

## Markdown or JSON?

Both formats produce the same document, and Studio edits both transparently, so choose by what the file mostly contains:

| Prefer Markdown                        | Prefer JSON                                |
| -------------------------------------- | ------------------------------------------ |
| Content-heavy pages (blog posts, docs) | Complex interactive components             |
| Components with significant prose      | Components with many state functions       |
| Landing pages, marketing content       | Deeply nested element hierarchies          |
| Quick prototyping                      | Components with complex `$prototype` usage |

Two hard limits to know: there is no runtime `.md` format (files always transpile to JSON first), and event-handler bodies or computed expressions live in frontmatter `state` definitions, never inline in the directive body.

## Related

- [Content collections](/docs/framework/site/content-collections): Markdown entries with validated frontmatter
- [Obsidian vault as content](/docs/framework/site/obsidian-vault): publishing notes with callouts and relative links as they are
- [Components](/docs/framework/concepts/components): the JSON document model both formats produce
- [Writing](/docs/studio/editing/writing): editing Markdown visually in Studio
