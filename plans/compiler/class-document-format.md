---
status: drafted
disposition: reconcile
claims:
  - compiler.md#2
  - compiler.md#5.2
  - compiler.md#5.3
  - compiler.md#5.6
requires: []
workspaces:
  - packages/compiler
size: S
---

# The class-document sections describe the format, the route and the module that ship

## Context

Three sections describe one contract, the class document route 0 compiles, and all three describe a shape that never shipped; §2's route table repeats §5.6's detection rule. Route 0 has keyed on `$prototype === "Class"` since the compiler's code-tree reorganisation (d5ee04c4, April 2026), so nothing an author could have relied on differs from what ships.

`specs/compiler.md` §2, line 24 (the route-0 status cell stays `**Implemented**`):

> **Status: Partial.** Route 0's condition is not the file extension: `compile()` in `packages/compiler/src/compiler.ts` takes route 0 on `isClassDef(raw)`, which is exactly `$prototype === "Class"` (`packages/schema/src/guards.ts`), whatever the file is called (§5.6).

§5.2, line 298:

> **Status: Partial.** The example below would neither validate nor compile. The class schema (`classDefSchema` in `packages/schema/defs/class-def.schema.ts`, published as `https://jxsuite.com/schema/class/v1`) requires `$prototype: "Class"` and `title`, and `compileClassJson` takes the class name from `title` and throws without it; a method carries `role`, `access`, `scope`, `identifier` and a `parameters` array, and is async when its `returnType` names a `Promise` or its body awaits, not through an `async` key (`extensions/connector/src/D1.class.json` is a shipped document).

§5.3, line 339:

> **Status: Partial.** The table does not match `class-def.schema.ts` or `compile-class.ts`: a field is private through `access: "private"`, not a `#`-prefixed key; an accessor is `role: "accessor"` with `getter`/`setter` objects, not a `get`/`set` prefix or `accessor: true`; `parameters` holds reusable typed parameter schemas that a method's parameters reference by `$ref` (`resolveParams`), not constructor config fields; and `constructor` takes `superCall.arguments` beside `body`.

§5.6, line 374 (its trailing `Implemented` marker, which describes the compilation, stays):

> **Status: Partial.** Neither condition below routes a document: route 0 is taken on `isClassDef(raw)` in `packages/compiler/src/compiler.ts`, which is exactly `$prototype === "Class"` (`packages/schema/src/guards.ts`). A `.class.json` file without that key, or a root whose `$defs` has `constructor`, `methods` or `fields` and no `tagName`, falls through to the static, element or client route; §2's route-0 condition has the same drift.

Re-read against the tree on 2026-09-27. Corrections to the census:

- **`parameters` was half right.** The old row ("constructor parameter properties (config object fields)") is what tooling reads: Studio's class form (`extractStudioSchema` in `packages/server/src/studio-api.ts`, mirrored in `packages/desktop/src/project-session.ts`) offers **every** `$defs.parameters` entry as a key of the constructor's `config`, with its `type` spread in (so `type.default` is the default), and marks required each one the constructor's `parameters` name by `$ref` that has no default. What is wrong is only what route 0 does with them: `compileClassJson` always emits `constructor(config = {})` and never reads the constructor's `parameters`, and a method's `$ref` parameter is named by the reference's last segment (`resolveParams`).
- **Async is narrower than "names a `Promise`":** `returnType.$ref` contains `Promise`, or the body contains `await ` (`isMethodAsync`).
- **"Constructor body and super args"** was right; the constructor row is imprecise, not drift.
- **Shipped documents:** 22 extension classes (auth 3, connector 10, feed 1, parser 6, search 2), every one validated by "every shipped extension class validates against the class schema" in `packages/schema/tests/class-schema-drift.test.ts`. 21 set `$schema` to the JSON Schema meta-schema and `Feed.class.json` to `https://jxsuite.com/schema/class/v1`, the URL `schema.md` §5 and the agent docs give; the §5.2 example's `https://jxsuite.com/schema/v1/class` exists nowhere.

Confirmed by scratch runs of `compile()`: a `Plain.class.json` without `$prototype` compiled to a static page (HTML, no module), as did an in-memory root with `$defs.constructor` and no `tagName`.

Found while detailing: three ways the module route 0 writes is wrong, each in code §5.5 (verified at census) summarises:

- A setter with no `parameters` compiles to `set val() {`, a SyntaxError ("setter functions must have one parameter"). The test titled "setter with no parameters defaults to 'v'" asserts exactly that output.
- `compile("…/Widget.json")` holding `$prototype: "Class"` returns `files[0].path` `…/Widget.json`: the output path replaces only a `.class.json` suffix, so the module is named as its source, and `runCli` (`compile-cli.ts`) writes it under that name, over the source itself when the output directory is the source's. The same holds for a class parsed from any other extension by a format plugin.
- `extends: { "$ref": "./Parent.class.json" }` emits `class Child extends Parent` with no import, so the module throws a ReferenceError on load unless `Parent` happens to be a global.

Also found, outside this plan's claims: `jx build` never compiles a class document (`compileClassJson`'s only caller is route 0, and the site build calls `compile()` only for pages), so `docs/framework/build.md`'s "`.class.json` documents compile to ES class modules" overstates; the runtime's `classFromSchema` ignores `extends` altogether; and `spec.md` §12.4's example repeats both of §5.2's defects (the wrong `$schema`, no `$prototype`).

**Related.** `schema.md` §3.3 (the class schema; its role list omits `rewrite`, `head` and `assets`, which `plan:schema/generator-inventory` carries); `spec.md` §12.2 and §12.4 (the `.class.json` entrypoint; `plan:spec/external-class-contract` owns §12.4); `extensions.md` §4, §5.4 and §6 (manifests, `jx validate`, admission blocks); `plan:compiler/client-external-class-hydration`, which will call `compileClassJson` for the browser and owns §5.4. `plan:_shared/no-adapter-server-tier` deletes §2's route-4 row under its second Open; the §2 sentence below is written for either order (Specs & docs).

## Outcome

- compiler.md §2 → Implemented: route 0's condition is `$prototype: "Class"`, and the table says the routes are tried in order.
- compiler.md §5.2 → Implemented: the format is `schema.md` §3.3's, and one worked example validates and runs, held by a test.
- compiler.md §5.3 → Implemented: a per-category table of what the schema holds and what route 0 emits.
- compiler.md §5.6 → Implemented: detection is the key alone, the `.class.json` name is the convention other hosts find a class by, and the output path is stated.
- With the Open fix decision signed as recommended, every module route 0 writes parses and loads; §5.5 gains one clause.

## Decisions

- **Decided:** route 0 stays keyed on `$prototype: "Class"`, so the disposition is `reconcile`, because the key is what the class schema requires, it works for a document passed in memory, which has no file name, and the `$defs` heuristic would misroute components: a component's `$defs` holds type definitions under any name (`schema.md` §3.1), `fields` included. A `*.class.json` file without the key is already reported by `jx validate`, which checks every such file against the class schema (`extensions.md` §5.4).
- **Open:** how much of the format §5.2 and §5.3 restate. Recommendation: point for validity, restate only compilation. §5.2 names the class schema and `schema.md` §3.3 as the contract and keeps one worked example; §5.3 becomes a table of what each `$defs` category holds and what route 0 emits for it. Because the drift came from restating the schema, and a bare pointer would drop the one thing only this spec says, how a category becomes class syntax.
- **Decided:** the example is a self-contained class (no `$implementation`, since route 0 ignores it and §5.4 covers it) using every category, with `$schema` set to `https://jxsuite.com/schema/class/v1` and a parameter's default inside its `type` (where `extractStudioSchema` reads it, as the shipped documents do). A test carries a verbatim copy, validates it and runs its output, rather than reading `specs/compiler.md`, because a workspace suite reading a spec needs an `EXTRA_EDGES` entry in `scripts/ci/affected.ts` that would rerun the whole compiler suite on every compiler.md edit.
- **Open:** whether the three output defects are fixed here. Recommendation: fix all three, because each is a few lines in the two files this plan already tests, no other plan owns them, and without them the rewritten §5.3 and §5.6 would describe modules that do not parse or load: a setter with no declared parameter takes `v` (the name the existing test's title and `packages/server/src/resolve.ts`'s fallback already use), a class document from any file compiles to a `.js` module beside it, and an `extends` `$ref` to another class document imports that document's route-0 module by its default export (every route-0 module has one, so a `title` that differs from the file name still links). The disposition stays `reconcile`, since the claimed contracts are what ships and the fixes make their edges hold. If declined, drop Implementation steps 1–2 and their tests, and §5.3 and §5.6 state the limits instead: a setter must declare its parameter, the output of a document not named `*.class.json` keeps its source name, and an `extends` names a global class.
- **Decided:** `spec.md` §12.4's example is not edited here, because §12.4 is `plan:spec/external-class-contract`'s claim; that plan can copy §5.2's example keys (`$schema`, `$prototype`, `title`).

## Implementation

1. **`packages/compiler/src/targets/compile-class.ts`** (the Open fix decision):
   - `compileClassJson`, accessor branch: `const setterParams = resolveParams(m.setter.parameters ?? []) || "v";`.
   - Beside `resolveBaseClass`, `function baseClassImport(ext: JxClassDef["extends"]): string | null`: for an object `ext` whose `$ref` matches the pattern `resolveBaseClass` already uses (`/([A-Za-z0-9_]+)\.class\.json/`), return `import <Name> from "<spec>";` (the default export, which every route-0 module has), where `<spec>` is the `$ref` without its `#` fragment and with `.class.json` replaced by `.js`; otherwise `null`. `compileClassJson` pushes it, and a blank line, after the header comments and before the class declaration. Update the file header to say the module imports a `$ref` base.
2. **`packages/compiler/src/compiler.ts`** (the Open fix decision): route 0's `outputPath` becomes `sourcePath.replace(/(\.class)?\.[^./\\]+$/, ".js")`, so a class parsed from any file (every string path reaching route 0 has an extension: `.json`, or one a format plugin claimed) is written beside it rather than over it. The file header's route list and `compile()`'s JSDoc "Routing:" list gain route 0 (`$prototype: "Class"` → ES class module, compiler.md §5.6).
3. **`packages/compiler/bunfig.toml`**: `coveragePathIgnorePatterns` gains `"**/jx-class-module-*/**"` beside the other transient `/tmp` patterns, and the comment above them names compiled class modules, which the new tests import and which are output, not source. If `plan:compiler/client-external-class-hydration` has landed, its `"**/jx-class-*/**"` already covers these directories: add nothing, and extend that pattern's comment instead.

The spec and docs text is under Specs & docs.

**Integration contract.** Once this lands: compiler.md §5.2 names `schema.md` §3.3 as the class document's contract and carries a worked example that validates and runs; §5.3 is the authority for what route 0 emits per `$defs` category; §5.6 states detection by `$prototype: "Class"` alone. `compileClassJson(classDef)` keeps its signature and output shape (`constructor(config = {})`, `export { Name }` and a default export), which is what `plan:compiler/client-external-class-hydration` compiles and imports. With the fixes: every module it writes parses, a `$ref` base adds one leading `import Base from "./Base.js";` of the sibling module route 0 writes for it (so a host that writes the module anywhere else must refuse a `$ref` base, as that plan already does), and `compile(path)` names the module after its source with the extension replaced by `.js`, `<title>.js` in memory. That plan's §5.4 sentence "A generated class imports nothing" becomes "A generated class imports only a `$ref` base, from a sibling module a site build does not write" in whichever of the two pull requests lands second.

## Tests

`bun test --isolate --coverage` from `packages/compiler`.

**`packages/compiler/tests/compile-class.test.ts`**

- New `describe("compileClassJson — the compiler.md §5.2 example")`, with the example as a `const PAGER` copied verbatim (a comment names the spec section):
  - `validates against the class schema`: `await validateClass(PAGER)` (from `@jxsuite/schema`) is `{ valid: true }`.
  - `compiles to a class meeting the external class contract`: write `compileClassJson(PAGER)` to `Pager.js` under `mkdtempSync(join(tmpdir(), "jx-class-module-"))`, import it, and assert: `new Pager({ items: [1, 2, 3, 4, 5, 6, 7], pageSize: 3 })` resolves to `[1, 2, 3]` with `pageCount` 3; setting `page = 5` reads back 2 and resolves to `[7]`; `new Pager()` has `pageSize` 10 and resolves to `[]`; `Pager.created` is 2. `rmSync` in `finally`.
- New cases pinning §5.3's rows: `a protected member compiles as public` (a `protected` field and method, no `#`); `a capability-role method compiles like any method` (`role: "parse"`, `scope: "static"`, inline parameter `source` → `static parse(source) {`); `constructor parameters are not emitted` (constructor `parameters: [{ $ref: "#/$defs/parameters/src" }]` → `constructor(config = {}) {`).
- With the fixes: `setter with no parameters defaults to 'v'` asserts `set val(v) {` and that the module, written to a `jx-class-module-` directory, imports; `$ref extends extracts class name from filename` also asserts `import Parent from "./Parent.js";`; new `a $ref base class is imported and extended`: compile a `Parent` (with `title: "Base"`, so the default import is what links it) and a `Child` (`extends: { $ref: "./Parent.class.json" }`) into `Parent.js` and `Child.js` in one `jx-class-module-` directory, import both, and `new Child() instanceof` the imported `Base` holds; `$ref with unrecognized pattern falls back to Object` also asserts no `import` line.

**`packages/compiler/tests/compiler.test.ts`**, `describe("compile — Class route ($prototype: 'Class')")`:

Fixtures are written to the `_fixtures_class` directory the existing string-path case uses, and removed in `finally`.

- `a .class.json file without $prototype Class is not route 0`: fixture `Plain.class.json` holding `{ "title": "Plain", "$defs": { "methods": { "go": { "body": "return 1;" } } } }`; `files` is empty and `html` is non-empty.
- `$defs categories do not route a document to route 0`: in memory, `{ $defs: { constructor: { body: "x" }, fields: {}, methods: {} } }`, with no `tagName`, which is the heuristic's own condition (a scratch run compiles it static); `files` is empty.
- With the fixes: `a class document named .json compiles to a .js module`: fixture `Widget.json` with `$prototype: "Class"`; `files[0].path` is `join(fixDir, "Widget.js")`. The existing "Class route uses source path for output when given string path" tightens `toContain("Widget.js")` to `toBe(join(fixDir, "Widget.js"))`.

Coverage: `packages/compiler/bunfig.toml` gates every file at lines 0.982 and functions 0.98; `baseClassImport` is exercised by both branches above, and the imported temp modules are excluded by step 3. No source file is added, so `bun scripts/check-coverage-manifest.ts packages/compiler` finds nothing new; ratchet only if a touched file becomes the workspace's new minimum above the bar.

## Specs & docs

**compiler.md §2**, in place: delete the Partial blockquote. Append to "The compiler inspects each input document and routes to the appropriate compilation target:" the sentence "Routes 0 to 3 are tried in that order and the first match wins; route 4's server output is compiled beside whichever of them the document takes (§6)." If `plan:_shared/no-adapter-server-tier` has already deleted the route-4 row, the sentence ends at "the first match wins." Route 0's Condition cell becomes ``Root `$prototype` is `"Class"` (§5.6)``; re-pad the table.

**compiler.md §5.2**, in place: replace the Partial blockquote, the lead-in and the example with:

> **Status: Implemented.** The example validates against the class schema and runs once compiled (`packages/compiler/tests/compile-class.test.ts`).

"A class document is validated by the class schema, `https://jxsuite.com/schema/class/v1`, and `schema.md` §3.3 is its contract: `$prototype: "Class"` and `title` are required, beside `extends`, `$implementation`, the `$defs` categories, the admission blocks of `extensions.md` §6 and `$studio`. Route 0 reads `title` (the class name, required by `compileClassJson`), `extends` (a class name, or a `$ref` to another class document, whose module it imports by its default export), `$id` (written as a source comment) and the `$defs` categories (§5.3). It ignores `$implementation` (§5.4), the admission blocks and `$studio`, which hosts read (`extensions.md` §6.1). A self-contained class using every category:"

```json
{
  "$schema": "https://jxsuite.com/schema/class/v1",
  "$prototype": "Class",
  "title": "Pager",
  "description": "Pages through an array of items",
  "$defs": {
    "parameters": {
      "items": { "identifier": "items", "type": { "type": "array" } },
      "pageSize": {
        "identifier": "pageSize",
        "type": { "type": "integer", "minimum": 1, "default": 10 }
      },
      "page": { "identifier": "page", "type": { "type": "integer", "minimum": 0 } }
    },
    "returnTypes": {
      "Page": { "type": "array", "description": "The items on the current page" }
    },
    "fields": {
      "created": { "role": "field", "scope": "static", "initializer": 0 },
      "items": { "role": "field", "access": "private", "default": [] },
      "page": { "role": "field", "access": "private", "default": 0 },
      "pageSize": { "role": "field", "default": 10 }
    },
    "constructor": {
      "role": "constructor",
      "parameters": [
        { "$ref": "#/$defs/parameters/items" },
        { "$ref": "#/$defs/parameters/pageSize" }
      ],
      "body": "Pager.created++;"
    },
    "methods": {
      "page": {
        "role": "accessor",
        "getter": { "body": "return this.#page;" },
        "setter": {
          "parameters": [{ "$ref": "#/$defs/parameters/page" }],
          "body": "this.#page = Math.min(Math.max(page, 0), this.pageCount - 1);"
        }
      },
      "pageCount": {
        "role": "accessor",
        "getter": { "body": "return Math.max(1, Math.ceil(this.#items.length / this.pageSize));" }
      },
      "resolve": {
        "role": "method",
        "returnType": { "$ref": "#/$defs/returnTypes/Page" },
        "body": [
          "const start = this.#page * this.pageSize;",
          "return this.#items.slice(start, start + this.pageSize);"
        ]
      }
    }
  }
}
```

"Compiled, `new Pager({ items, pageSize: 3 })` resolves to the first three items, the `page` setter clamps to the last page, and `Pager.created` counts instances: the external class contract (`spec.md` §12.3) with no `$implementation`."

(Verified while detailing: this document passes `validateClass`, and its compiled module ran with exactly the assertions the Tests section lists.)

**compiler.md §5.3**, in place: replace the Partial blockquote and the table with an `Implemented` marker naming `class-def.schema.ts`, `compileClassJson` and `compile-class.test.ts`, the lead-in "What each category holds is the class schema's (`schema.md` §3.3); what route 0 emits for it:", and:

| Category      | Holds                                                                                                                                                                               | Route 0 emits                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `parameters`  | Named parameter schemas: `identifier` (required), `type` (holding the `default` tooling reads), `description`, `examples`, `format`                                                 | Nothing. Tooling offers each as a key of the constructor's `config` argument, required when the constructor's `parameters` reference it and it has no default; a method's `parameters` reference them to name its own                                                                                                                                                                |
| `fields`      | Fields by key: `identifier` (default: the key), `access` (`public` by default, `private`, `protected`), `scope` (`instance` by default, `static`), `initializer`, `default`, `type` | A static field `static name = value`; an instance field assigned in the constructor from `config[identifier]`. The value falls back to `initializer`, then `default`, then `null`. `private` names the member `#name`; `protected` compiles as public                                                                                                                                |
| `constructor` | `body` (a string or an array of lines), `superCall.arguments` (source expressions), `parameters`                                                                                    | `constructor(config = {})`: `super(…)` with `superCall.arguments` when `superCall` is present or `extends` names a base class, then the field assignments, then `body`                                                                                                                                                                                                               |
| `methods`     | Methods by key: `identifier` (default: the key), `role`, `access`, `scope`, `parameters`, `body`, `returnType`, `getter` and `setter`, `timing`                                     | `role: "accessor"`: `get name()` from `getter.body` and `set name(p)` from `setter.body`, `p` named by `setter.parameters` (`v` when it names none). Any other role, the capability roles of `extensions.md` §8 included: a method, `static` and `#`-prefixed by `scope` and `access`, and `async` when its body contains `await` or its `returnType` is a `$ref` naming a `Promise` |
| `returnTypes` | Named output schemas that a `returnType` references by `$ref`                                                                                                                       | Nothing                                                                                                                                                                                                                                                                                                                                                                              |

Followed by: "A parameter referenced by `$ref` is named by the reference's last segment, and an inline one by its `identifier`. `type`, `description`, `examples` and `timing` are read by hosts and tooling (`extensions.md` §6.1 and §8.1) and never emitted."

**compiler.md §5.5**, in place (with the fixes): "`extends` clause from `$ref` or string" becomes "`extends` clause from a string, or from a `$ref` to another class document, whose module's default export is imported".

**compiler.md §5.6**, in place: delete the Partial blockquote and replace the lead-in and both bullets with:

"A document is a class document when its root's `$prototype` is `"Class"` (`isClassDef` in `packages/schema/src/guards.ts`). `compile()` tests this before any other route (§2), whatever the file is called and for a document passed in memory. Nothing else makes a document a class: a component's `$defs` holds type definitions under any name (`schema.md` §3.1), so `constructor`, `methods` or `fields` among them do not route it here, and a `*.class.json` file without the key compiles as the component it then is; `jx validate` reports that file, because it checks every `*.class.json` against the class schema, which requires the key (`extensions.md` §5.4).

A class document's file is named `*.class.json` by convention, the name other hosts find it by: a `$src` entrypoint (`spec.md` §12.2) and an extension manifest's classes (`extensions.md` §4). Route 0 writes one module exporting the class by name and as its default, beside its source, named after it with the extension (and a `.class` before it) replaced by `.js`, or, for a document passed in memory, at the `title` plus `.js`."

The trailing marker stays, naming `packages/compiler/src/targets/compile-class.ts` for `compile-class.js`.

**Fragment** (single quotes, because the sentence holds `$`):

`bun run spec:change compiler.md minor -m '§2, §5.2, §5.3 and §5.6 describe the class document that ships: route 0 is taken on a root whose $prototype is "Class" whatever the file is called, the §5.2 example validates against the class schema and runs once compiled, §5.3 states what route 0 emits for each $defs category, and every module route 0 writes loads, a parameterless setter taking v, a source not named .class.json compiling to .js beside it, and an extends $ref importing its base.'`

(Without the fixes, the sentence ends after "each $defs category.") This plan does not graduate compiler.md.

**Docs** (no em dashes). `docs/extending/extensions/classes.md` cites `compiler.md#5`, and `docs/framework/build.md` cites `compiler.md#2`; no page lists `compile-class.ts` or `compiler.ts` in `code:`.

- `docs/extending/extensions/classes.md`: `code:` gains `packages/schema/defs/class-def.schema.ts` and `packages/compiler/src/targets/compile-class.ts`. The categories table becomes: `parameters` "Named, typed parameter schemas. Studio offers each as a key of the constructor's `config`, required when the constructor's `parameters` reference it and its `type` has no `default`; a method's `parameters` reference them to name its own"; `fields` "Fields: private through `access: "private"`, static through `scope: "static"`; an instance field takes the `config` key of the same name"; `constructor` "The constructor `body` and `superCall.arguments`"; `methods` "Methods, accessors (`role: "accessor"` with `getter` and `setter`), and static capability methods by `role`"; `returnTypes` "Named return-type schemas a method's `returnType` references". The `$implementation` paragraph is `plan:compiler/client-external-class-hydration`'s and is untouched.
- `docs/framework/build.md`: "`.class.json` documents compile to ES class modules" becomes "a class document (`"$prototype": "Class"`, conventionally a `.class.json` file) handed to the compiler directly compiles to an ES class module"; the rest of that sentence (server handlers) is untouched.

## Acceptance

- `cd packages/compiler && bun test --isolate --coverage`: green, every file at or above lines 0.982 and functions 0.98.
- `bun scripts/check-coverage-manifest.ts packages/compiler`, `bun run typecheck`, `bun run lint`: green.
- `grep -n 'schema/v1/class\|accessor: true\|private if `#`-prefixed' specs/compiler.md docs/extending/extensions/classes.md` prints nothing (the new §5.3 methods row says "`#`-prefixed by `scope` and `access`", which a bare `#`-prefixed pattern would match).
- `bun run plans:status --spec compiler`: §2, §5.2, §5.3 and §5.6 are no longer open.
- `bun run docs:status`, `bun run docs:spec-release` (the fragment is present), `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`: green.
- By hand: save §5.2's example as `Pager.class.json`, run `mkdir -p out && bun packages/compiler/src/compile-cli.ts Pager.class.json out/index.html`, and `bun -e 'const { Pager } = await import("./out/Pager.js"); console.log(new Pager({ items: [1, 2, 3, 4], pageSize: 3 }).resolve())'` prints `[ 1, 2, 3 ]`.
