---
title: "Jx Notation (.jxn)"
description: "Write a Jx document as a .jxn file: shorter than JSON, with comments and multi-line code, and read to exactly the same document."
spec:
  - spec.md#22
code:
  - packages/schema/src/jxn/parse.ts
  - packages/schema/src/jxn/serialize.ts
  - packages/schema/src/jxn/document.ts
  - packages/schema/src/jxn/lint.ts
  - packages/server/src/convert.ts
  - packages/site/src/serve.ts
---

# Jx Notation (`.jxn`)

A Jx document can be written in Jx Notation, as a `.jxn` file. It is [KDL 2](https://kdl.dev/) with Jx's rules for what each node means. A `.jxn` file and a `.json` file are two spellings of one data model: they read to the same document, and a site built from either has the same output, so nothing else in Jx needs to know which one you used.

Choose `.jxn` for what you write by hand. It is shorter, it keeps comments, and multi-line code in a function needs no escaping. No extension has to be enabled to use it.

```kdl
$id Counter

// Comments stay in the file.
my-counter {
    state {
        count 0
        (fn)reset #"""
            state.count = 0
            """#
    }

    style display=inline-flex gap="6px" {
        "&:hover" color="var(--color-action)"
    }

    span part=value "${state.count}"
    button type=button onclick=(ref)"#/state/reset" "Reset"
}
```

## How it reads

| You write                                | It means                                      |
| ---------------------------------------- | --------------------------------------------- |
| A top-level `$x` node                    | Document metadata, such as `$id` or `$schema` |
| The other top-level node                 | The root element, with its name as `tagName`  |
| One value after the name                 | `textContent`                                 |
| `name=value`                             | The attribute `name`                          |
| `.name=value`                            | The member `name`, such as a DOM property     |
| `$x=value`                               | A Jx member                                   |
| `state`, `style` and `attributes` blocks | Those members                                 |
| Any other child node                     | A child element                               |
| `- "text"`                               | A text child, or a list item in a data block  |
| `(ref)"#/state/x"`                       | A `$ref`, anywhere a value goes               |
| `(fn)name params "body"`                 | A function                                    |
| `on*=(ref)"#/state/x"`                   | An event handler                              |
| `$array items=(ref)"…" { li }`           | A repeater, with its one element as `map`     |
| `$element "style" "a{}"`                 | An element whose tag is reserved here         |

The [specification](https://github.com/jxsuite/jx/blob/main/specs/spec.md#22-jx-notation-jxn) has the whole grammar.

## What a reader refuses

A `.jxn` file either reads to the document its `.json` spelling would, or it does not read. Each of these would otherwise lose or change something without saying so:

- A key written twice, including across forms, such as `div a=1 { attributes { a 2 } }`.
- `button onclick="state.x++"`. A handler is a `(ref)` or a function, because a string here would reach the page as a live inline handler with no `state` in scope. `once="x"` is still an attribute, because `once` is not an event handler.
- `#inf`, `#nan`, and numbers JSON cannot hold exactly.
- An annotation Jx does not define.

`jx validate` reports each with its line and column.

:::doc-warning
In a quoted KDL string, `\s` is a space and `\b` a backspace, so `"${x.replace(/\s+/g, '')}"` reads without complaint and matches the wrong thing. Use a raw string for a pattern: `#"${x.replace(/\s+/g, '')}"#`. `jx validate` warns about both, and the writer always uses a raw string for a value with a backslash in it.
:::

## Moving a file between formats

`jx convert` moves documents either way and repairs every reference to them:

```bash
jx convert pages layouts components --to jxn
jx convert pages/about.jxn --to json
```

See [`jx convert`](/docs/framework/build/cli#jx-convert) for what it refuses. Data is the same in both directions. Comments are not, because `.json` has nowhere to keep them, so converting a commented file to `.json` needs `--drop-comments`.

## On a site

A build never ships Jx Notation: components become modules and pages become HTML. If a browser asks a Jx site for a `.jxn` file directly, the site answers JSON, so pages never load a KDL parser.

:::doc-note
Studio does not open `.jxn` files yet. Edit them in your own editor, and `jx dev` and `jx build` will read them. Studio's own surfaces and the kit stay `.json`, and so do `*.class.json`, `jx-extension.json`, schemas and data files.
:::

## Related

- [Documents](/docs/framework/concepts/documents)
- [CLI commands](/docs/framework/build/cli)
