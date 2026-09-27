---
status: drafted
disposition: reconcile
claims:
  - spec.md#12.1
  - spec.md#12.5
requires:
  - spec/request-url-params
  - extensions/local-imports-precedence
workspaces:
  - packages/schema
  - packages/runtime
  - packages/compiler
  - specs
  - docs
size: M
---

# The built-in prototype list and the import-map resolution order describe the names every tier reserves and the extension registry that ships

## Context

Both sections describe how a `$prototype` name resolves with no `$src`, and both describe it as it was before content classes moved into `@jxsuite/parser`'s extension manifest, so one plan covers both.

`specs/spec.md` §12.1, line 1311:

> **Status: Partial.** `Function`, `LocalStorage`, `SessionStorage` and `Request` resolve in the interpreter, except `Request`'s URL params (§11.1); their compiled lowering is §11.2's. The compile-time rows do not match the code: there is no `MarkdownFile` (the parser's manifest, `extensions/parser/jx-extension.json`, names it `Markdown`); `MarkdownCollection`, `ContentCollection` and `ContentEntry` resolve only through the extension registry, once `@jxsuite/parser` is listed in `project.json` `extensions` (`registryClassPath` in `packages/compiler/src/site/prototype-resolver.ts`); `Array` is a children-level node (§10), not a state prototype; and the runtime built-ins `URLSearchParams`, `Cookie`, `IndexedDB`, `Set`, `Map`, `FormData`, `Blob` and `ReadableStream` (§11.2) are missing from the table.

`specs/spec.md` §12.5, line 1455:

> **Status: Partial.** The import-map rules ship. Two statements do not match the code: imports cascade from `project.json` (`packages/site/src/context.ts`), not `site.json`, and the last step before the unknown-prototype warning is the extension registry's manifest classes, present only for extensions listed in `project.json` `extensions`, not built-in mappings (§12.1).

Re-verified against the working tree on 2026-09-27. Everything both markers say holds:

- **Built-in names.** `BUILT_IN_PROTOTYPES` (`packages/schema/defs/external-class-def.schema.ts`) lists 13 names, `Function` and `Array` among them, and nothing reads it. The interpreter's `resolvePrototype` (`packages/runtime/src/runtime.ts`) has a case for each Web API name (`ReadableStream` returns `null`), no `Array` case, and a `default` that warns `unknown $prototype` and returns `ref(null)`. `Function` goes through `resolveFunction`.
- **Content classes.** `extensions/parser/jx-extension.json` lists `Markdown`, `Csv`, `MarkdownCollection`, `ContentCollection`, `ContentEntry` and `Content`. `Markdown` is the format class whose instance `resolve()` parses one file into a `MarkdownFileResult` (parser.md §3), and `@jxsuite/parser/Markdown.class.json` is an exported path. No `MarkdownFile` class or descriptor exists.
- **The site build.** `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) skips `SKIP_PROTOTYPES` (`Function`, `LocalStorage`, `SessionStorage`, `Array`), lowers a non-compiler-timed entry through `registry.byName`, and otherwise maps `imports[name] ?? registryClassPath(...)`. A name nothing maps is left in place with no warning; what the page then gets is compiler.md §3's.
- **Cascading.** `injectContext` (`packages/site/src/context.ts`) merges `project.json` `imports` under the page's, the page winning. No source reads a `site.json`.

The census missed two things, and both change what the rewrite can say.

1. **The two built-in rows hold in no tier consistently.** "Built-in prototypes unchanged" says `Request`, `Set`, `Map` and `LocalStorage` are unaffected by the map; "Import overrides built-ins" meant the old `MarkdownFile` mappings. In code:
   - The interpreter's `buildScope` pass 0 maps an `imports` entry for every non-`Function` name, built-ins included, and `resolvePrototype` dispatches on `$src` before its switch. So `imports: { Set: … }`, or a `$src` on a `Request`, makes the entry an external class.
   - Both compiled targets lower `Request`, and the client target `LocalStorage`, `SessionStorage` and `Cookie`, by name whatever `$src` or `imports` say (`compile-client.ts`, `compile-element.ts`).
   - `resolvePrototypes` resolves an import named `Request` at build time when `timing` is unset, but skips one named `LocalStorage`.
   - `plan:compiler/client-external-class-hydration` defines `isExternalClassDef` as "not in `BUILT_IN_PROTOTYPES`", so the compiled tier is about to make "a built-in name is the built-in" its rule.

   No tracked document maps a built-in name in `imports` or gives one a `$src` (checked over every tracked `*.json` and `*.md`).

2. **Only the site build resolves an extension class by bare name.** `buildScope` pass 0 reads `doc.imports` alone. `handleResolve` (`packages/server/src/resolve.ts`) refuses a body with no `$src`. Studio's canvas feeds the runtime `getEffectiveImports` (`packages/studio/src/canvas/canvas-live-render.ts`), which merges project and page `imports` only. So a bare `MarkdownCollection` warns `unknown $prototype` in the canvas. Every starter names its parser class with `$src` (`packages/starters/sites/blog/pages/[slug].json`), and `examples/pages/advanced/markdown-blog.json` maps it in `imports`. Studio's add-state picker writes bare `ext:` names (`addSignalOfType` in `packages/studio/src/panels/signals-panel.ts`).

**Tests and docs.** `packages/compiler/tests/prototype-resolver.test.ts` has "explicit imports override built-in prototype mappings", which maps `MarkdownFile`, a name nothing else defines, so it asserts no override. No test resolves a parser class by bare name through a registry; `connector-mounts.test.ts` pins that path for `TableQuery`. `docs/framework/concepts/data-prototypes.md` repeats `MarkdownFile`, "built in too", "shipped with Jx", `site.json` and "may even override a built-in". `docs/framework/concepts/timing.md` line 82 names `MarkdownFile`. `examples/content/posts/building-a-blog.md` and two comments in `extensions/parser/src` name it as well. They are example content and code comments, not the contract, and are left alone.

**Prerequisites.**

- `plan:spec/request-url-params` owns the `Request` row's phrase "HTTP fetch with reactive URL params" and removes "except `Request`'s URL params (§11.1)" from §12.1's marker. This plan keeps that row's description exactly as that plan leaves it.
- `plan:extensions/local-imports-precedence` makes `$src`, then `imports`, then the manifest class hold at every `timing`, lowering included. Until it lands, the order §12.5 states is false on `resolvePrototypes`' lowering branch.

## Outcome

- spec.md §12.1 → Implemented. It lists the built-in names, which are `BUILT_IN_PROTOTYPES`, and hands each one's behaviour and status to §11.2. It says a built-in name always means the built-in, and it describes the parser's content classes as extension classes.
- spec.md §12.5 → Implemented. The rules table and the resolution order name `project.json` cascading, the reserved built-in names and the extension-class step, and say which host takes that step.
- spec.md §12.2 gains one sentence and §5.3 4e one sentence. Neither marker changes: §12.2 is unmarked, and §5.3 4e is closed by `plan:spec/request-url-params` before this lands.
- Every tier treats a built-in name as the built-in: one predicate, `isBuiltInPrototype`, used by the interpreter's import-map pass, its `$src` dispatch and the site build's resolver.
- No spec graduates.

## Decisions

- **Decided:** §12.1 lists names and points at §11.2 for behaviour and status. It has no timing or status column of its own, because §11.2's table is the one the census had to correct cell by cell, and a second copy would drift the same way. `Array` is named as reserved but is not a `state` prototype (§10). This matches `BUILT_IN_PROTOTYPES`, which `plan:schema/generator-inventory` makes schema.md §3.1's list.
- **Decided:** the content classes are described as `@jxsuite/parser` extension classes (`reconcile`), and the example uses `Markdown` with `$src` next to a bare `MarkdownCollection`. The audit's spec-wide decisions keep the extension architecture (extensions.md §6), and naming the descriptor is the form every starter already uses.
- **Open:** does a built-in name always mean the built-in, so that `imports`, an extension class and `$src` never replace one? Recommendation: yes, enforced by one predicate in the three places that look a name up:
  - Context item 1 shows no reading of today's two rows that the code meets.
  - The compiled targets and `plan:compiler/client-external-class-hydration`'s `isExternalClassDef` already treat the name as the built-in.
  - A project-level `imports` entry named `Map` silently re-typing every page's `Map` is the failure a reserved name prevents.
  - No tracked document relies on shadowing.
  - The interpreter warns on an ignored `imports` entry or `$src`. The build skips silently, as it already does for `LocalStorage`.

  The alternative, where an import or `$src` wins everywhere, needs both compiled targets to consult `imports` and `$src` before lowering a built-in, and needs `isExternalClassDef` reversed. If review prefers it, Implementation steps 1 to 3 and their tests leave this plan, the rows say so, and that work needs its own plan, because §12.5 cannot be Implemented without it.

- **Open:** does §12.5 promise the extension-class step in an interpreting host? Recommendation: no. The text names the site build as the one host that consults extension classes by name, and tells authors to name the descriptor with `$src` for an entry that must also resolve in Studio's canvas, which is what every starter does.
  - The canvas half is extensions.md §3's name-visibility rule applied to Studio, not a spec.md reconcile. A later plan would give the canvas each enabled extension's class path (`getExtensions()`, `packages/studio/src/format/format-host.ts`) under the effective `imports` in `canvas-live-render.ts`, the way `contentCollectionSrc` in `packages/studio/src/page-params.ts` already does for `ContentCollection`.
  - If review wants that path, it becomes an extensions.md open item with its own plan, and §12.5's host sentence gains Studio's canvas when that lands.
- **Decided:** disposition `reconcile`, although three small guards change code. Both claims close by rewriting the sections to the architecture that ships, and the guards enforce what §12.5 already says of the Web API built-ins ("unaffected"). They live here because the rows cannot be written true without them.
- **Decided:** one pull request after both prerequisites land, with no early slice. Both prerequisites are `S`. An early slice would release §12.1 and §12.5 twice, each time with an interim marker that the next release rewrites.
- **Decided:** fragment level `minor`, not `major`. `MarkdownFile` never resolved and `site.json` was never read. Shadowing a built-in was documented only in `data-prototypes.md`, and it never worked for the compiled `Request`, storage or `Cookie` at client timing. No tracked document uses it.

## Implementation

One pull request, after `plan:spec/request-url-params` and `plan:extensions/local-imports-precedence` have landed.

1. **`packages/schema/src/guards.ts`.** Move `BUILT_IN_PROTOTYPES` here from `defs/external-class-def.schema.ts`, unchanged (13 names, `as const`), next to `isPrototypeDef`. Add `export function isBuiltInPrototype(name: unknown): boolean` returning `typeof name === "string" && (BUILT_IN_PROTOTYPES as readonly string[]).includes(name)`. Its doc comment says the list is spec.md §12.1's, and that `Array` is reserved although it names the §10 children node. In `defs/external-class-def.schema.ts`, replace the declaration with `export { BUILT_IN_PROTOTYPES } from "../src/guards.ts";`, following `defs/expression-node.schema.ts`, which imports from `../src/intl.ts`. `defs/index.ts` is unchanged. The constant moves because `guards.ts` is what the runtime already imports, and the defs module would bring a schema object into the browser runtime for one array.
2. **`packages/runtime/src/runtime.ts`.** Import `isBuiltInPrototype` from `@jxsuite/schema/guards`, beside the guards already imported.
   - `buildScope`, pass 0: inside `if (mapped)`, before the `.class.json` check, add ``if (isBuiltInPrototype(def.$prototype)) { console.warn(`Jx: import "${def.$prototype}" is ignored: "${def.$prototype}" is a built-in $prototype`); continue; }``. The comment above the pass says built-in names are never mapped (spec §12.5).
   - `resolvePrototype`: `if (def.$src)` becomes `if (def.$src && !isBuiltInPrototype(def.$prototype))`. When `def.$src` is set on a built-in name, warn `Jx: $src on "${key}" is ignored: "${def.$prototype}" is a built-in $prototype` and fall through to the switch. `Function` never reaches here, because `isPrototypeDef` excludes it.
3. **`packages/compiler/src/site/prototype-resolver.ts`.** Delete `SKIP_PROTOTYPES`. Its test in the loop becomes `if (isBuiltInPrototype(def.$prototype)) continue;`, imported from `@jxsuite/schema/guards` beside `isPrototypeDef`. This covers both branches, so neither the lowering lookup nor `imports ?? registryClassPath` ever sees a built-in name. The module header, which still says "Any state entry with a $prototype that maps to a .class.json via doc.imports", and the `resolvePrototypes` doc comment, which says "builtins + legacy content system", both become: a non-built-in entry resolves through its `$src`, the merged `imports`, then an enabled extension's class (spec.md §12.5).
4. **Spec and docs.** Make the edits under Specs & docs, then run `bunx oxfmt specs/spec.md` to re-pad the tables.
5. **Landing.** Delete this file. No plan requires it. Where they still exist, reword the citations `plans:check` would report as `citation-unknown` to "spec.md §12.1": in `plans/spec/web-api-prototype-parity.md` (Related) and `plans/schema/generator-inventory.md` (What closes by code, elsewhere).

**Integration contract.**

- `@jxsuite/schema/guards` exports `BUILT_IN_PROTOTYPES` and `isBuiltInPrototype(name)`, and `@jxsuite/schema/defs` still re-exports the constant.
- A built-in name is the built-in in every tier. The interpreter maps no `imports` entry to one and ignores its `$src`, with a warning. `resolvePrototypes` never resolves or lowers one. The compiled targets lower what §11.2 says.
- spec.md §12.1 is the list of built-in names. §12.5 is the resolution order for every other name: `$src`, page `imports`, project `imports`, then the enabled extension's class in the site build.
- Consequences for other plans:
  - `plan:compiler/client-external-class-hydration` may define `isExternalClassDef` through `isBuiltInPrototype` and cite §12.1.
  - `plan:spec/timing-values-in-built-sites` adds a build-time `Request` branch ahead of the built-in skip in `resolvePrototypes`.
  - A plan that adds or removes a Web API prototype, such as `plan:spec/web-api-prototype-parity` for `ReadableStream`, changes `BUILT_IN_PROTOTYPES`, `resolvePrototype`'s case and §12.1's row together. The drift test below catches the first two disagreeing.

## Tests

Run `bun test --isolate --coverage` from `packages/schema`, `packages/runtime` and `packages/compiler`.

**`packages/schema/tests/guards.test.ts`**

- `isBuiltInPrototype is true for exactly the BUILT_IN_PROTOTYPES names`: every listed name is `true`. `"Markdown"`, `"WeatherForecast"`, `""`, `undefined` and `42` are `false`. The constant imported from `../defs` is the same array as the one from `../src/guards`.

**`packages/runtime/tests/class-json.test.ts`** (beside "non-.class.json import value warns and skips")

- `an imports entry naming a built-in is not consulted`: `imports: { Set: "./Adder.class.json" }` and `state: { s: { $prototype: "Set", default: [1, 2] } }`, with `setupFetchMock` serving `Adder.class.json`. `scope.s` is a `Set` of size 2, and `console.warn` was called with a string containing `is a built-in $prototype`.

**`packages/runtime/tests/runtime.test.ts`** (describe `resolvePrototype`)

- `a $src on a built-in name is ignored with a warning`: `{ $prototype: "Map", $src: "./x.class.json", default: { a: 1 } }` resolves to a `Map` whose `get("a")` is `1`. The warning names the entry's key and contains `is a built-in $prototype`, and `fetch` is never called.
- `every built-in but Function and Array has a resolvePrototype case`: for each other `BUILT_IN_PROTOTYPES` name, call `resolvePrototype` with a minimal config, spying on `console.warn`. `Request` gets `{ url: "/x", manual: true }`. `IndexedDB` gets `{ database: "d", store: "s" }` with the file's fake `global.indexedDB`. `LocalStorage`, `SessionStorage` and `Cookie` get `{ key: "k" }` or `{ name: "k" }`. No warning contains `unknown $prototype`.

**`packages/compiler/tests/prototype-resolver.test.ts`**

- Replace `explicit imports override built-in prototype mappings`, whose `MarkdownFile` names nothing, with `an imports entry or an extension class named like a built-in is not consulted`:
  - `imports: { Set: "./Multiplier.class.json" }`, and `state: { s: { $prototype: "Set", a: 4, b: 9 }, r: { $prototype: "Request", url: "/x", timing: "client" } }`.
  - `projectContext.registry` is a stub whose `byName` returns `{ classPath: <Multiplier>, capabilities: { lower: true }, call: mock() }` for any name.
  - After the call, both entries equal their pre-call copies, and `call` was not invoked.
- `a bare MarkdownCollection resolves through the enabled @jxsuite/parser extension`: reuse the two-post fixture of "resolves MarkdownCollection via explicit imports", with no `imports`.
  - With `registry: await buildProjectExtensionRegistry(dir, { extensions: ["@jxsuite/parser"] })` (from `../src/site/format-host`), `posts` becomes an array of 2.
  - With a registry built from `{ extensions: [] }`, `posts` still has `$prototype: "MarkdownCollection"`.
  - This pins §12.1's example and §5.3 4e's sentence.
- `skips builtin prototypes (Function, Array, etc.)` stays as it is, and still passes through the new predicate.

**Coverage.** No source file is added, so the manifest checks are unaffected. `guards.ts` gains one function, and the guards test covers it. The runtime's two new branches and the compiler's replaced test are each covered by a case above. The per-file thresholds are `lines = 0.99, functions = 0.99` (`packages/schema/bunfig.toml`), `lines = 0.963, functions = 0.98` (`packages/runtime/bunfig.toml`) and `lines = 0.982, functions = 0.98` (`packages/compiler/bunfig.toml`). Ratchet a workspace only if its worst file rises.

**Paper gates** (all in `checks`): `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown`.

## Specs & docs

**`specs/spec.md` §12.1**, in place. The heading stays.

1. Replace the Partial marker with:

   > **Status: Implemented.** The built-in names are `BUILT_IN_PROTOTYPES`, and `isBuiltInPrototype` (`packages/schema/src/guards.ts`) is the one test every tier applies. The interpreter's `resolvePrototype` (`packages/runtime/src/runtime.ts`) has a case for each Web API name, and neither `buildScope`'s import-map pass nor the site build's `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) maps a built-in name to a class. What each prototype does in each tier, and its status there, is §11.2's. The content classes resolve through the extension registry (`registryClassPath` in `prototype-resolver.ts`).

2. Replace the lead sentence and the table with the following lead sentence and table:

   "Jx provides these `$prototype` names as built-ins. Each resolves by name with no `imports` entry or `$src`, and a built-in name always means the built-in. An `imports` entry or an extension class with the same name is not consulted (§12.5), and a `$src` on any built-in but `Function` is ignored (§12.2)."

   The new table, whose `Request` description is whatever `plan:spec/request-url-params` leaves, verbatim (today "HTTP fetch with reactive URL params"):

   | Prototype         | Description                                                | Specified in       |
   | ----------------- | ---------------------------------------------------------- | ------------------ |
   | `Function`        | Inline or external function: handler, computed or callable | §5.3 4b to 4d, §20 |
   | `Request`         | HTTP fetch with reactive URL params                        | §11.1, §11.2       |
   | `URLSearchParams` | Query string built from the entry's keys                   | §11.2              |
   | `FormData`        | Form fields for submission                                 | §11.2              |
   | `LocalStorage`    | Persistent key-value storage                               | §11.2              |
   | `SessionStorage`  | Session-scoped key-value storage                           | §11.2              |
   | `Cookie`          | A cookie with derived attributes                           | §11.2, §11.2a      |
   | `IndexedDB`       | A database store with indexes                              | §11.2              |
   | `Set`             | A `Set` of `default`'s items                               | §11.2              |
   | `Map`             | A `Map` of `default`'s entries                             | §11.2              |
   | `Blob`            | Binary data from parts and a type                          | §11.2              |
   | `ReadableStream`  | A stream                                                   | §11.2              |

3. After the table: "`Array` is reserved too, but it is not a `state` prototype: `$prototype: "Array"` marks the mapped-array node a `children` array holds (§10). Where each prototype resolves is its `timing` (§11.3)."

4. Replace the paragraph "`MarkdownFile` and `MarkdownCollection` are first-class prototypes …" with a bold-led paragraph:

   "**Content classes come from an extension.** `Markdown`, `MarkdownCollection`, `ContentCollection` and `ContentEntry` are not built-ins. They are classes of the `@jxsuite/parser` extension (parser.md §3 and §6, extensions.md §6), and they resolve like any external class (§12.5): through `$src`, through an `imports` entry, or by name alone in the site build of a project whose `project.json` lists `@jxsuite/parser` in `extensions` (extensions.md §3). An interpreting host (Studio's canvas and live preview, or `jx dev` on a root without a `project.json`) does not look extension classes up by name. An entry that must resolve there as well names its descriptor:"

5. Rewrite the example: `page` becomes `{ "$prototype": "Markdown", "$src": "@jxsuite/parser/Markdown.class.json", "src": "./content/about.md", "timing": "compiler" }`. `posts` is unchanged.

6. Replace the closing paragraph ("The compiler maps these names … No `imports` entry is needed.") with: "`page` names its class, so it resolves wherever `@jxsuite/parser` is installed. `posts` resolves by name only in the site build, and only once the extension is enabled. Anywhere else the name is unknown (§12.5)."

**`specs/spec.md` §12.5**, in place:

1. Replace the leading Partial marker with:

   > **Status: Implemented.** The interpreter maps `doc.imports` in `buildScope`'s first pass (`packages/runtime/src/runtime.ts`). The site build merges `project.json` `imports` under each page's in `injectContext` (`packages/site/src/context.ts`). `resolvePrototypes` (`packages/compiler/src/site/prototype-resolver.ts`) then reads an entry's `$src`, the merged `imports`, and the enabled extensions' classes, in that order, at every `timing`. Both skip the built-in names (`isBuiltInPrototype`, `packages/schema/src/guards.ts`).

2. In the rules table, the first three rows are unchanged. The last three become:
   - "Built-in names are reserved": "An `imports` entry named like a built-in (§12.1) is not consulted; the interpreter warns"
   - "Imports override extension classes": "A page or project `imports` entry takes precedence over an enabled extension's class of the same name (extensions.md §3)"
   - "Project-level cascading": "`imports` in `project.json` cascade to every page; page-level entries win on collision (imports.md §1.1)"
3. Replace the resolution-order line with: "**Resolution order:** a built-in name (§12.1) is the built-in. Any other name resolves through the first of: explicit `$src` → page `imports` → project `imports` → the class of that name in an extension `project.json` lists in `extensions` (site build only) → unknown prototype. The interpreter warns about an unknown prototype and resolves it to `null`; what a site build does with one is compiler.md §3's."
4. The `buildScope` paragraph becomes "At runtime, `buildScope` injects the mapped `$src` into each bare `$prototype` entry that does not name a built-in, before any resolution pass executes, so all downstream resolution (`resolvePrototype` → `resolveExternalPrototype` → `resolveClassJson`) works unchanged."
5. Delete the trailing `> **Status: Implemented.** Runtime pre-processes …` marker. Its content is in the leading one.

**`specs/spec.md` §12.2**, in place: after the first paragraph, add "A built-in name (§12.1) is always the built-in. `Function`'s `$src` is a JavaScript module (§5.3 4c), and a `$src` on any other built-in is ignored; the interpreter warns."

**`specs/spec.md` §5.3 4e**, in place: after the example, before "External class entries are always resolved reactively", add "`MarkdownCollection` is a class of the `@jxsuite/parser` extension, not a built-in: the site build resolves the bare name only when `project.json` lists `@jxsuite/parser` in `extensions`, and an entry that must also resolve in an interpreting host names its `$src` (§12.1)."

**Fragment** (single quotes keep the shell off `$src`): `bun run spec:change spec.md minor -m '§12.1, §12.2 and §12.5: the built-in prototypes are Function and the Web API prototypes of §11.2, and a built-in name always means the built-in, so no imports entry, extension class or $src replaces one; Markdown, MarkdownCollection, ContentCollection and ContentEntry are classes of the @jxsuite/parser extension, which a site build resolves by name once project.json enables it; imports cascade from project.json; and the resolution order ends with the classes of the enabled extensions, not built-in mappings. Both sections are Implemented.'`

**Docs** (no em dashes; `docs:sync` names these through the changed spec anchors and `code:` lists):

- **`docs/framework/concepts/data-prototypes.md`** (`spec:` `spec.md#11`, `spec.md#12`):
  - Add `code:` with `packages/schema/src/guards.ts` and `packages/compiler/src/site/prototype-resolver.ts`.
  - "Built-in Web-API prototypes": after "each maps to a genuine Web API:" add "A built-in name always means the built-in: an import or an extension class with the same name is ignored." Delete the `Array` bullet. After the list, add "`Array` is not a data source: `$prototype: "Array"` marks a [mapped list](/docs/framework/concepts/lists) inside `children`."
  - Rename "Content prototypes" to "Content classes". No page links to the old anchor. Its lead becomes "Content loaders come from the `@jxsuite/parser` extension and resolve at build time (`timing: "compiler"`; see [Timing](/docs/framework/concepts/timing)):". The bullet `MarkdownFile` becomes `Markdown`.
  - Replace "These names map internally to `.class.json` implementations shipped with Jx, with no configuration needed." with "List `@jxsuite/parser` in your project's `extensions` and a build resolves these names with no `imports` entry. Studio's canvas does not look extension classes up by name, so give an entry that should also preview there its class file: `"$src": "@jxsuite/parser/MarkdownCollection.class.json"`."
  - "Import maps": the last paragraph becomes "`imports` in `project.json` cascade to every page, and page-level entries win on collision. An import also wins over an extension's class of the same name, but never over a built-in."
  - "How it works": the resolution-order sentence becomes "A built-in name is always the built-in. Any other name resolves through its own `$src`, then the page's `imports`, then the project's, then (in a build) an enabled extension's class, and otherwise gets an unknown-prototype warning." The `urlParams` sentence stays as `plan:spec/request-url-params` leaves it.
  - "Rules": the last bullet becomes "Built-in prototypes need no `imports` entry, and neither an import nor a `$src` replaces one."
- **`docs/framework/concepts/timing.md`** (`spec:` `spec.md#11.3`), line 82: "and the content prototypes (`MarkdownFile`, `MarkdownCollection`, `ContentCollection`) use it by design:" becomes "and the content classes of the `@jxsuite/parser` extension (`Markdown`, `MarkdownCollection`, `ContentCollection`) are built for it. With that extension in your project's `extensions`, a build resolves them by name:".
- **No change** to the nine pages whose `code:` lists `runtime.ts` (`runtime-host.md`, `docs.md`, `overlays.md`, `props-and-scope.md`, `reactivity.md`, `styling.md`, `components.md`, `color-schemes.md`, `elements.md`). None of them describes prototype resolution, and the pull request says so. `docs/framework/concepts/functions.md` (`spec.md#5.3`) documents `Function` only, and `docs/extending/extensions/first-party.md` already lists the parser's classes as extension classes.

**Graduation:** not here. spec.md keeps many open items, so its header stays `Partial` and `plans/spec/` stays.

## Acceptance

- `sed -n '/^### 12.1 /,/^### 12.2 /p;/^### 12.5 /,/^## 13\. /p' specs/spec.md | grep -c 'Status: Partial'` prints `0`, and the first `Status:` line of each range is the Implemented marker.
- `git grep -n 'MarkdownFile\b' -- specs docs` and `git grep -n 'site\.json' -- specs/spec.md docs/framework` print nothing.
- `git grep -n SKIP_PROTOTYPES -- packages` prints nothing, and `git grep -n isBuiltInPrototype -- packages/runtime/src packages/compiler/src` shows the two runtime call sites and the resolver's.
- From `packages/schema`, `packages/runtime` and `packages/compiler`, `bun test --isolate --coverage` passes with the new cases, and `bun scripts/check-coverage-manifest.ts <workspace>` passes for each.
- `bun run plans:status --who-claims spec.md#12.1` and `--who-claims spec.md#12.5` name no plan, and `ls specs/changes/spec-*.md` includes the new fragment.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
