---
title: "Jx Notation (.jxn)"
description: "Write a Jx document as a .jxn file: shorter than JSON, with comments and multi-line code, and read to exactly the same document."
spec:
  - spec.md#22
  - site-architecture.md#2.3
code:
  - packages/schema/src/jxn/parse.ts
  - packages/schema/src/jxn/project.ts
  - packages/schema/src/jxn/index.ts
  - packages/studio/src/files/project-file-name.ts
  - packages/schema/src/jxn/serialize.ts
  - packages/schema/src/jxn/reconcile.ts
  - packages/schema/src/jxn/document.ts
  - packages/schema/src/jxn/lint.ts
  - packages/schema/src/jxn/complete.ts
  - packages/server/src/convert.ts
  - packages/server/src/format.ts
  - packages/site/src/serve.ts
  - packages/studio/src/services/jxn-language.ts
  - packages/studio/src/format/format-host.ts
  - packages/vscode/src/extension.ts
  - packages/vscode/src/completion.ts
  - packages/vscode/src/schemas.ts
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

| You write                                | It means                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| A top-level `$x` node                    | Document metadata, such as `$id` or `$schema`              |
| The other top-level node                 | The root element, with its name as `tagName`               |
| One value after the name                 | `textContent`                                              |
| `name=value`                             | The attribute `name`                                       |
| `.name=value`                            | The member `name`, such as a DOM property                  |
| `$x=value`                               | A Jx member                                                |
| `state`, `style` and `attributes` blocks | Those members                                              |
| Any other child node                     | A child element                                            |
| `- "text"`                               | A text child, or a list item in a data block               |
| `(ref)"#/state/x"`                       | A `$ref`, anywhere a value goes                            |
| `(fn)name params "body"`                 | A function                                                 |
| `script "module"`, in the root element   | The document's own client module                           |
| `script timing=server "module"`          | The document's own server module                           |
| `(export)name`                           | A function the client module exports                       |
| `(server)name k=v`                       | A server function of the server module, with its arguments |
| `on*=(ref)"#/state/x"`                   | An event handler                                           |
| `$array items=(ref)"…" { li }`           | A repeater, with its one element as `map`                  |
| `$element "style" "a{}"`                 | An element whose tag is reserved here                      |

The [specification](https://github.com/jxsuite/jx/blob/main/specs/spec.md#22-jx-notation-jxn) has the whole grammar.

## A document's script

A document that carries [its own module](/docs/framework/concepts/functions#a-module-inside-the-document) writes it as a `script` node in the root element, and each entry that uses it as one short row:

```kdl
my-counter {
    script #"""
        import { clamp } from "./math.ts";

        export function bump(state: { count: number }): void {
          state.count = clamp(state.count + 1, 0, 10);
        }
        """#
    script timing=server #"""
        export async function history(args: { limit: number }, env: Env) {
          return env.DB.prepare("SELECT * FROM bumps LIMIT ?").bind(args.limit).all();
        }
        """#
    state {
        count 0
        (export)bump
        (server)history limit=10
    }
    button onclick=(ref)"#/state/bump" Add
}
```

`(export)bump` is the Function entry `bump` with `$src: "#client"`, and `(server)history limit=10` is the server function `history` with `$src: "#server"` and `arguments: { limit: 10 }`. An export under another name is `(export)bump $export=increment`.

`script` means the module in the root element only. A `<script>` element is written `$element "script"`, and a `script` node anywhere deeper is refused with that spelling in the message.

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

## A project file

A project is declared by `project.jxn`, or by `project.json` in a project created before that was the default. It is the same grammar with a different top level: there is no root element, and every node is a setting. The file says what it is with a `project` node, which holds the project's name:

```kdl
/- kdl-version 2
$schema "./project.schema.json"
project "Bistro & Café"

// The base layout every page inherits unless it names another.
defaults layout="./layouts/base.json" lang=en

extensions {
    - "@jxsuite/parser"
}

$media {
    --md "(max-width: 768px)"
}

style {
    --color-primary "#9a2f1a"
}
```

`$head` holds elements, `style` and `$media` hold one declaration per line, and every other setting is written the way a value is anywhere in Jx Notation. A list of one item needs its block, `extensions { - "@jxsuite/parser" }`, because `extensions "@jxsuite/parser"` is a single string. `jx validate` says so when it finds one.

Every host reads it: `jx build`, `jx validate`, the dev server, the desktop application and a site's own origin. Saving a setting in Studio, or the assistant writing the file, keeps your comments.

A `project.jxn` that does not read is reported at its line and column and is never overwritten. Studio still opens the project, and shows the file as text in the Code view so you can fix it.

A file named `project.jxn` without the `project` node is an ordinary document, so `pages/project.jxn` is still a page with the route `/project`. A folder holding both `project.jxn` and `project.json` is refused everywhere, naming both, until you delete one.

New projects start with `project.jxn`. To move an older project to it, run `jx convert project.json --to jxn` in its folder.

## Moving a file between formats

`jx convert` moves documents and the project file either way, and repairs every reference to a document:

```bash
jx convert project.json pages layouts components --to jxn
jx convert pages/about.jxn --to json
```

See [`jx convert`](/docs/framework/build/cli#jx-convert) for what it refuses. Data is the same in both directions. Comments are not, because `.json` has nowhere to keep them, so converting a commented file to `.json` needs `--drop-comments`.

## On a site

A build never ships Jx Notation: components become modules and pages become HTML. If a browser asks a Jx site for a `.jxn` file directly, the site answers JSON, so pages never load a KDL parser.

## Saving keeps your comments

Saving a `.jxn` file changes only what you changed. A node that still means the same keeps its exact text, including its comments and blank lines, whether the save came from Studio or from a rename repairing a reference. A comment directly above a node belongs to that node, so deleting the node deletes it.

## Formatting

`oxfmt` does not read `.jxn` files, so the code inside one is formatted by its own command:

```bash
jx format
jx format pages/index.jxn --check
```

It formats every function body and both sides of a document's script as TypeScript, the same way Studio's code editor does, and it keeps the comments of a file that has any. See [`jx format`](/docs/framework/build/cli#jx-format) for what it leaves alone.

## In Studio

Studio treats a `.jxn` page, layout or component the same as a `.json` one. It lists them in the Site panel, offers them as layouts, draws them on the canvas and as component cards, and finds them in Quick Open. Saving changes only what you changed and keeps every comment. That holds in a shared session too: a comment someone else adds in the Code view survives your edit on the canvas.

The Code view completes a `.jxn` file from your project's schemas as you type: tag names, an element's members, the values a member allows, and pointers into the file's `state`. It also marks type errors in the code the file holds. See [Code editing](/docs/studio/logic/code#completion-in-a-jxn-file).

**Convert to another format** offers Jx Notation for any page or component, and JSON for a `.jxn` one. A layout converts only between `.json` and `.jxn`, because those are the two spellings a layout is read in.

:::doc-note
New pages, templates and components are `.jxn`, from **Add new**, from converting a selection to a component, and from New File in `pages/`, `layouts/` and `components/`. The starters and `create-jxsuite` ship their documents as `.jxn` too. A `.json` document you already have stays `.json` until you convert it. Studio's own surfaces and the kit stay `.json`, and so do `*.class.json`, `jx-extension.json`, schemas and data files.
:::

## In VS Code

The Jx Suite extension for VS Code knows a `.jxn` file as the language `jxn`. It is not published yet, and is built and run from a checkout of the repository ([The VS Code extension](/docs/extending/contributing/monorepo#the-vs-code-extension)).

- **Highlighting.** Nodes, members, strings, numbers and comments are coloured, and so are the annotations Jx Notation gives meaning to, such as `(fn)` and `(ref)`. Any other annotation is marked as a mistake. A multi-line raw string is coloured as TypeScript, because that is where a function body and a script are written.
- **Completion.** It offers what Studio's Code view offers, from the same reader: tag names, an element's members, the values a member allows, and pointers into the file's `state`. The schemas are the `document.schema.json` and `project.schema.json` in your project's folder, read again whenever they are written again. A file outside any project, and a project that has no schema files yet, are completed from the core schema, which knows no extension's part.
- **Type checking** of the code the file holds, through TypeScript's language server. See [Type checking](/docs/framework/concepts/type-checking#in-vs-code) for what that needs.

## Related

- [Documents](/docs/framework/concepts/documents)
- [Type checking](/docs/framework/concepts/type-checking)
- [CLI commands](/docs/framework/build/cli)
