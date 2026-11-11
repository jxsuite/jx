# @jxsuite/content-mapper

A TypeScript content mapper for [Jx Notation](https://jxsuite.com/docs/framework/concepts/jxn-files). It lets `tsc` and TypeScript's language server check the code inside a `.jxn` document: its script, the body of each function, each `${}` template, each `$ref` into `state` and each prop it gives a component. Errors are printed at the line and column where you wrote them, and an editor's hover, completion and rename land on your own text.

Content mappers arrive in TypeScript 7.1, which is a beta today.

## Use

```sh
bun add -d typescript@7.1.0-beta @jxsuite/content-mapper
```

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

Then run the compiler over it:

```sh
tsc -p tsconfig.jxn.json --runExternalCode
```

```text
pages/counter.jxn(15,24): error TS2339: Property 'total' does not exist on type 'State'.
```

TypeScript starts the mapper with `node`, so Node 22.18 or newer has to be on your path.

## What `--runExternalCode` permits

The flag is not given to one mapper. It lets `tsc` start every content mapper the `tsconfig` names that has a file to read, each as a program with your own access to the machine. Keep the mapper in a `tsconfig` of its own, as above, so the flag covers one short file. Without the flag `tsc` starts nothing and prints `TS18068`.

A language server runs a mapper only when the editor tells it the project may run external code. Until then a `.jxn` file gets no errors and no hover.

## What is checked

- A document's client script and server script.
- Every string `body`: a function in `state`, an event handler, at the root or in a nested section.
- `State`, the type of the document's `state`, which a script names without importing and a `.ts` file can import from the document.
- The event each handler is given, typed by its binding and its element, and `state.$map`, the row of a repeated element.
- Every `${}` template an element or a `state` entry holds, checked as the JavaScript the page runs.
- Every `$ref` into `state` or a row, name by name. One on an `on` member is checked as the handler it binds.
- Every prop in an instance's `$props`, against the `state` of the `.jxn` component its tag names: one the document lists in `$elements`, or one in the project's `components` folder.

A state entry that declares a `type` is checked as that type, and a document's `$defs` are types its entries name: `#/$defs/TodoItem` is `$defs.TodoItem`, in an error and in a module that imports the document. A `.json` document, a `$defs` entry of another file and a class's methods are not read. The [Type checking](https://jxsuite.com/docs/framework/concepts/type-checking) page has the full account, with the limits of rename.

## As a library

The package's one export is the mapper's definition, for a host that wants to run it itself:

```ts
import { createMapper } from "@jxsuite/content-mapper";
import { runContentMapper } from "ts-content-mapper";

runContentMapper(createMapper());
```

What a document's types are is not decided here. `@jxsuite/schema/virtual-document` writes the modules, and this package hands them to the compiler in the form its protocol takes.

## Versioning

The package follows the monorepo's release train and depends on `@jxsuite/schema`. TypeScript is a peer dependency, `>=7.1.0-beta`.
