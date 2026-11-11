---
title: "Type checking"
description: "Check the TypeScript in a .jxn document with tsc and in your editor: scripts and function bodies, read through @jxsuite/content-mapper."
spec:
  - spec.md#23.3
code:
  - packages/schema/src/jxn/virtual-document.ts
  - packages/schema/src/jxn/state-types.ts
  - packages/content-mapper/src/mapper.ts
  - packages/content-mapper/src/server.ts
---

# Type checking

A `.jxn` document holds TypeScript in two places: its [script](/docs/framework/concepts/functions#a-module-inside-the-document) and the `body` of each function. `tsc` checks both, and prints each error at the line and column where you wrote it. An editor that runs TypeScript's language server shows the same errors, with hover, completion, rename and go to definition.

The work is done by `@jxsuite/content-mapper`, a program TypeScript starts to read a kind of file it cannot read itself. Content mappers arrive in TypeScript 7.1, which is a beta today.

:::doc-note
Studio checks a function body as you type, with nothing to install ([Code editing](/docs/studio/logic/code#the-function-editor)). This page is about the terminal, CI and your own editor. Only `.jxn` documents are read here. A `.json` document's bodies are checked in Studio and nowhere else.
:::

## Set it up

Install the compiler and the mapper:

```sh
bun add -d typescript@7.1.0-beta @jxsuite/content-mapper
```

TypeScript starts the mapper with `node`, so Node has to be on your path even in a project that otherwise runs on Bun. The mapper needs Node 22.18 or newer on the 22 line, or 24.11 or newer.

Add a `tsconfig.jxn.json` beside your project file:

```json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "module": "esnext",
    "moduleResolution": "bundler"
  },
  "contentMappers": [{ "extensions": [".jxn"], "package": "@jxsuite/content-mapper" }],
  "include": ["pages", "layouts", "components", "src"]
}
```

Then give it a script in `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc -p tsconfig.jxn.json --runExternalCode"
  }
}
```

:::doc-warning
`--runExternalCode` is not permission for one mapper. It lets `tsc` start every content mapper the `tsconfig` names that has a file to read, each as a program with your own access to the machine. That is why the mapper gets a `tsconfig` of its own here: the flag covers one short file you can read in full. Read the `contentMappers` list of a `tsconfig` you did not write before you run it with this flag.
:::

Without the flag `tsc` starts no mapper, reads no document, and says why:

```text
tsconfig.jxn.json(8,3): error TS18068: Content mappers require the '--runExternalCode' command line flag to be enabled.
```

That is the second reason for the separate file. A `tsconfig.json` with no `contentMappers` in it keeps working for every tool that runs `tsc` without the flag. A `.ts` file that imports a document is reported there as importing a module that cannot be found (`TS2307`), so check such a file under `tsconfig.jxn.json`.

## Reading the errors

Here is a page with three mistakes in it, `pages/counter.jxn`:

```kdl
div {
  script #"""
    const STEP = 1;
    export function increment(state: State) {
      state.count += STEP;
    }
    """#
  state {
    count 0
    (export)increment
    (export)decrement
    (fn)reset "state.count = STEP - 1"
  }
  button {
    (fn)onclick "state.total += 1"
  }
}
```

And a module that imports it, `src/use.ts`:

```ts
import type { State } from "../pages/counter.jxn";
import { increment } from "../pages/counter.jxn";

export function twice(state: State): void {
  increment(state);
  increment(state);
}
export const label: State["count"] = "three";
```

`bun run typecheck` prints four errors:

```text
pages/counter.jxn(11,13): error TS2694: Namespace '"/home/you/site/pages/counter.jxn"' has no exported member 'decrement'.
pages/counter.jxn(12,30): error TS2304: Cannot find name 'STEP'.
pages/counter.jxn(15,24): error TS2339: Property 'total' does not exist on type 'State'.
src/use.ts(8,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

- **`(export)decrement`** names an export the script does not have. The error is on the entry, at the name.
- **`STEP`** belongs to the script. A body is not inside the script, so it reaches a script's function through the state entry that exports it and reaches nothing else.
- **`state.total`** is not an entry of this page's `state`.
- **`State["count"]`** is `number`, because `count 0` is. A `.ts` file that imports a document gets its client script's exports and its `State`.

A column counts UTF-16 code units from one, as it does in a `.ts` file. It is the column in the `.jxn` file whichever way the string is spelled: a quoted string with escapes, a multi-line string or a raw string.

A file that is not valid Jx Notation gets one error of the mapper's own, with the code `jx1`:

```text
pages/broken.jxn(4,1): error jx1: A document has one root element, and this is a second
```

While any file has one, `tsc` prints those and no type errors, as it does for a syntax error in a `.ts` file.

## What `State` says

Inside a script, `State` is the type of the document's `state`, in scope without an import. Inside a body, `state` has that type. It says what the document can prove and no more:

| Entry                                                      | Type                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A string, number or boolean                                | `string`, `number`, `boolean`                                                                          |
| An object or an array                                      | Its shape, or the types of its items                                                                   |
| `(export)name`                                             | The type of the export it names, or of its return value when the document reads it as a computed value |
| `(server)name`                                             | What the server function resolves to, or `null` before it has answered                                 |
| `(fn)name` with a body                                     | A function, or any type when the document reads it as a computed value                                 |
| A `$prototype` instance, an expression, a template, `null` | Any type                                                                                               |

An entry the document cannot give a type to is any type, not an error. The event a handler receives is any type too, and so is a declared parameter.

A handler on an element inside a section with its own `state` sees that state and its parents'.

**Whether an unknown name is an error depends on what surrounds the document.** A page with a layout, or in a project whose project file has `state` of its own, reads entries the page never declares. There `state.anything` is allowed, and only the names the page does declare are typed. A page with neither, and every component, is exact: `state.total` above is an error because nothing else could have declared it. A name that begins with `$`, such as `state.$media`, is always allowed.

The mapper learns this from the nearest project file at or above the document, and looks no higher than the folder `tsconfig.jxn.json` is in. That is why the file goes beside your project file.

## In an editor

TypeScript 7.1's language server reads the same `tsconfig.jxn.json`, and through the mapper it answers for a `.jxn` file what it answers for a `.ts` file:

- **Errors** at the same positions `tsc` prints.
- **Hover** on `state.count` in a body shows `(property) State.count: number`.
- **Completion** after `state.` lists the document's entries.
- **Go to definition** from `state.hello` in a body offers the entry and the function in the script that it exports.
- **Rename** of an entry rewrites the entry, the script and every body that reads it. Renaming a script's function rewrites the `$export` that names it.

The language server runs a mapper only when the editor tells it the project may run external code, which is the editor's form of `--runExternalCode`. Until it does, a `.jxn` file gets no errors, no hover and no completion, and nothing says why.

There is no Jx editor extension yet. Your editor has to be told by hand that a `.jxn` file goes to the TypeScript language server.

## Limits

- **`.json` documents** are not read. Studio checks their bodies.
- **Studio does not use the mapper.** Its code editor checks a body on its own, and does not check a script yet. `tsc` is what checks a script today.
- **`jx build` does not run it.** A build still accepts a document with a type error, so run the script in CI.
- **`${}` templates, `$defs` and a class's methods** are not checked.
- **Renaming an `(export)name` entry is half a rename.** The one word stands for two names, the state entry and the export. Renaming the function in the script rewrites the function and the entry, and leaves `state.name` in bodies. Renaming `state.name` from a body rewrites the bodies and the entry, and leaves the function. Either way the next check reports what was left behind. An entry written `(export)hello $export=greet` has two words and renames cleanly.
- **A nested section's entry is not renamed from a body.** Renaming `state.local`, where `local` is declared in an inner `state`, rewrites the body and not the declaration.

## Related

- [Functions and modules](/docs/framework/concepts/functions): bodies, scripts and how an export is called
- [Jx Notation](/docs/framework/concepts/jxn-files): the `.jxn` format
- [Code editing in Studio](/docs/studio/logic/code): the checking Studio does as you type
