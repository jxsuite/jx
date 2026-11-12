# Jx Suite for VS Code

[Jx Notation](https://jxsuite.com/docs/framework/concepts/jxn-files) in VS Code: a `.jxn` file is highlighted, completed from its project's schemas, and type checked by TypeScript's language server.

This extension is not published yet. Build it and run it from a checkout of [the repository](https://github.com/jxsuite/jx):

```sh
bun install
bun run --cwd packages/vscode build
code --extensionDevelopmentPath="$PWD/packages/vscode" path/to/a/project
```

## What it does

- **Highlighting.** Nodes, members, strings, numbers and comments, and the annotations Jx Notation gives meaning to, such as `(fn)` and `(ref)`. Any other annotation is marked as a mistake. A multi-line raw string is highlighted as TypeScript, because that is where a function body and a script are written.
- **Completion.** Tag names, an element's members, the values a member allows, and pointers into the file's `state`. The schemas are the `document.schema.json` and `project.schema.json` in the file's project folder, read again whenever they are written again. A file outside any project is completed from the core schema.
- **Type checking.** It tells the TypeScript extension that a `.jxn` file is the language server's to read, and supplies [`@jxsuite/content-mapper`](https://jxsuite.com/docs/framework/concepts/type-checking) for a file no `tsconfig` reads. Errors, hover, completion, rename and go to definition then work inside a function body, a script, a template and a `$ref`.

## What type checking needs

- The TypeScript 7 extension (`TypeScriptTeam.native-preview`), with its language server enabled. This extension starts it when you open a `.jxn` file.
- TypeScript 7.1, where content mappers arrive. The TypeScript 7 extension carries 7.0 today, so install `typescript@7.1.0-beta` in your project and choose it with **TypeScript: Select TypeScript Version...**.
- A trusted workspace. The TypeScript extension does not run in one you have not trusted.

Without them a `.jxn` file is still highlighted and completed, and the **Jx Suite** output channel says why it is not type checked.

A language server looks for `tsconfig.json`. To have it read the `tsconfig.jxn.json` that `tsc -p` is given, set `js/ts.customConfigFileName` to that name. A `.jxn` file that a `tsconfig` the server found includes is checked with the mapper that `tsconfig` names. Every other `.jxn` file is checked with the one this extension carries, which is started with VS Code's own runtime and needs no Node on your machine.

## Tests

```sh
bun test --isolate
```

The `vscode` module exists only inside the editor, so the tests run against the fake in `tests/_fake-vscode.ts`. The grammar is tested by tokenizing with `vscode-textmate`.
