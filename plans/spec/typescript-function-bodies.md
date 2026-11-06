---
status: drafted
disposition: implement
claims:
  - spec.md#23.1
requires: []
workspaces:
  - packages/schema
  - packages/compiler
  - packages/runtime
  - packages/server
  - packages/desktop
  - packages/site
  - packages/studio
  - packages/ui
  - examples
  - specs
  - docs
size: L
---

# A function body in any Jx document is TypeScript, erased once before anything analyses or runs it

## Context

`specs/spec.md` §23.1:

> **Status: Pending.** A string `body` is JavaScript today, and every tier passes it to `new Function` or splices it into an emitted module as written.

The owner's direction: TypeScript is the default scripting language from the first iteration, in `.json` as well as `.jx`. A `.json` document already needs tooling to run at all, so there is no tooling-free path to protect. This plan does not depend on KDL and can land first.

**What is there to convert** (measured 2026-11-05 at `d51e05cf`, 484 documents)

| Fact                                                                                                         | Evidence                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 42 string `Function` bodies, none multi-line; 820 structured bodies (§20), which have no text to erase       | Scripted walk including `cases`                          |
| Every string body in tracked JSON, and the 13 class-method strings, comes through `ts-blank-space` unchanged | Byte comparison; class bodies are `string` or `string[]` |
| `body` is not always code: 3 are data                                                                        | `packages/ui/stylebook/jx-tabs.json` `/state/sections/*` |

**Where a body runs.** Today each of these receives authored text directly.

| Tier                    | Site                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Interpreter             | `runtime.ts:1519` (`resolveFunction`), `:1934` (`bindHandler`), `:3760`-`:3804` (class members) |
| Server class resolution | `server/src/resolve.ts:622`-`:656`                                                              |
| Build-time scope        | `compiler/src/shared.ts:780` (`buildInitialScope`)                                              |
| Client target           | `compile-client.ts:1008` and the other `def.body` splices, `emitLitMapTemplate`                 |
| Element target          | `compile-element.ts:689`, `:1470` (`inlineHandlerBody`), `:1581`                                |

**An earlier design, erasing at each tier's boundary, cannot work.** Adversarial review on 2026-11-05 ran it:

- No bundler sits on that path. Modules are written directly (`site-build.ts:537`, `:907`), and `buildInitialScope`, `compileClient`, `emitElementModule` and `bindHandler` are synchronous.
- Analysis reads the authored text. `STATE_MUTATING_METHOD_RE` (`shared.ts:605`) does not see `state.items!.push(1)`, so prerender bakes the mutated value in. `state.helper!(state)` is classified as a computed.

**Multi-line bodies are newly reachable and break emission.** No tracked body has more than one line, so none of this has fired yet:

- `compile-client.ts:1008` emits `{ ${def.body} }` on one line. A last line of `// done` swallows the closing brace, and `app.js` is a `SyntaxError`.
- `bodyReturnsValue` (`packages/schema/src/guards.ts:244`) is a regex that reads comments, so `// return early` turns a handler into a computed.
- `compile-element.ts:689` uses `replaceAll("state.", "this.state.")`, so `prevstate.n` becomes `prevthis.state.n`.

**The code services reject TypeScript.** `packages/server/src/code-api.ts` formats as `fn.js` (line 151), and `Bun.Transpiler` (line 116) minifies. Lint reports false errors, and format and minify fail. `panels/editors.ts:463` opens bodies as `language: "javascript"`, and `:326` minifies on close, which would delete the types.

**Strippers compared** (native builds for esbuild and oxc; wasm builds were not run in a browser)

| Stripper              | Min / gz          | Browser, sync | Top-level `return` | `return` + `await` | `as`, newline, `[` | Existing bodies identical |
| --------------------- | ----------------- | ------------- | ------------------ | ------------------ | ------------------ | ------------------------- |
| `ts-blank-space` + TS | 3.63 MB / 1.03 MB | yes           | ok                 | ok                 | ok                 | all                       |
| `sucrase`             | 209 KB / 47 KB    | yes           | ok                 | ok                 | **TypeError**      | all                       |
| `esbuild-wasm`        | 14.0 MB / 3.74 MB | no            | ok                 | fails              | ok                 | none                      |
| `oxc` wasip1          | 3.49 MB / 1.17 MB | after init    | needs a wrapper    | needs a wrapper    | ok                 | not measured              |
| `amaro`               | 3.04 MB / 1.13 MB | unverified    | needs a wrapper    | needs a wrapper    | ok                 | not measured              |
| `Bun.Transpiler`      | Bun only          | n/a           | ok                 | fails              | ok                 | none                      |

`ts-blank-space` 0.9.0 declares `typescript: "5.1.6 - 6.0.x"`, while the repository pins `^7.0.2`. Installing it therefore nests a second, JavaScript TypeScript compiler. In a scratch project on 2026-11-06, with `typescript` 7.0.2 at the root: Bun nests 6.0.3 under `ts-blank-space`, it erases `event.target as HTMLInputElement` correctly, and `bun build --target=browser` produces 8.85 MB unminified with no error. This has not been tried inside this repository's workspace, and Dependabot's view of two TypeScript majors has not been looked at.

**The stripper does not run on the cloud host.** That host (a private repository) composes live previews with `@jxsuite/site` inside a Cloudflare Worker, with no bundler. Run on 2026-11-05 under `wrangler dev` with `nodejs_compat`, bundled by wrangler: the Worker fails at startup with `__filename is not defined`, in `getNodeSystem`, because `process` makes TypeScript take itself for Node. Size is not the problem: 3.5 MB minified against a 64 MiB limit. A workaround was not tried, because the design below does not need one.

## Outcome

- spec.md §23.1 → Implemented.
- A string `body`, including a class member's, may use erasable TypeScript in any document format. Every executing tier and every analysis sees JavaScript.
- Multi-line bodies emit correctly in every target. The code surface formats and lints them as TypeScript and stores them as written.
- Nothing reports type errors yet. That is `plan:_shared/jx-typechecking`.

## Decisions

- **Decided (owner):** one language in every format, so `.jx` and `.json` stay two spellings of one document and types survive conversion both ways.
- **Decided (owner):** a `${}` template stays a JavaScript expression. Templates compile separately in every tier, and `${state.x as number}` renders `""` today. `plan:_shared/jx-typechecking` flags TypeScript syntax there.
- **Decided (owner):** `ts-blank-space` is the stripper. It alone is correct on every test case and leaves existing bodies byte-identical, which is what lets `.json` output stay unchanged. It replaces types with spaces, so a line and column in a stack trace match the authored body. Its size is confined to build hosts, server class resolution, Studio, and the browser of a reader whose preview has typed bodies.
- **Decided:** erase once, at load, before analysis. The compiler calls `eraseDocument` as it reads a document, so analysis and every emitter see JavaScript and none of them changes signature or becomes asynchronous. Erasing twice changes nothing, so a document that crosses two hosts is safe.
- **Decided:** live previews erase in the browser, on every host, and `@jxsuite/site` never imports `@jxsuite/erase`. It analyses no body, so it has no need to, and importing it would stop a Worker booting. The dev server, desktop and the cloud host then share one path, and a server that handles credentials does not parse a compiler's worth of input it has no use for.
- **Decided:** the stored `body` stays as authored. Only the executable copy is erased, because Studio, the writers and the checker need the source.
- **Decided:** erasable syntax only. `enum`, value `namespace`, parameter properties and `import` inside a body are errors naming the document, the pointer and the position. It matches `erasableSyntaxOnly`, and it is the only form that needs no emit. A body that needs imports belongs in `spec.md` §23.2.
- **Decided:** the walker is shape-aware. It erases `Function` entries wherever they can sit (state, inline `on*`, `$map`, `cases`) and class constructors, methods, getters and setters, including `string[]` bodies. It never touches another `body`, because `jx-tabs.json` holds data there and a `Request` body is a payload.
- **Decided:** a new workspace, `packages/erase` (`@jxsuite/erase`), holds `eraseBody`, `eraseDocument` and `eraseClass`, and a `browser` entry exporting `eraseBody`. `@jxsuite/schema` and `@jxsuite/runtime` reach consumers who should not download a compiler, and Studio does not depend on `@jxsuite/compiler`. The stripper stays behind this package, so it can be replaced. The fixtures name behaviour, not the library.
- **Decided:** the browser uses a seam, as `setNpmModuleResolver` and `setCanvasAssetResolver` already do. `runtime.ts` gains `setBodyEraser(fn)` and one `compileBody(params, body)` that all its body-compiling `new Function` sites call. A host hands it the function, as `setBodyEraser(eraseBody)`. With an eraser installed, every body goes through it, cached by text. With none, the body compiles as written, and a `SyntaxError` is rethrown naming the entry and the call that fixes it. The core bundle gains the seam and not the compiler.
- **Decided:** `@jxsuite/erase` never imports `@jxsuite/runtime`. A host may build the eraser as its own file beside the runtime, and an entry that imported the runtime would carry a second copy and set the seam on that copy. The build would pass, and a typed page would still fail in the reader's browser. So the dependency runs one way: the eraser is a plain function, and the host or the loader hands it to the runtime.
- **Decided:** a preview loads the eraser only when it needs it, because it costs about 1 MB gzipped and each preview origin caches it separately. `setBodyEraserLoader(load)` takes a function returning a promise of `{ eraseBody }`, which is what importing `@jxsuite/erase/browser` gives, and the runtime installs what it receives. `resolve()`, and the fetch of a class definition, both already asynchronous, check each string body first: if one does not compile, or contains `<…>` followed by `(` or a backtick, they await the loader before anything compiles. `pageShell` emits `setBodyEraserLoader(() => import(eraserUrl))` when `ShellOptions.eraserUrl` is set. A site with no typed body downloads nothing new. The canvas installs the eraser eagerly instead, because a live edit reaches `bindHandler` with no asynchronous step.
- **Decided:** `a < b > (c)` is a generic call, because a body is TypeScript. In JavaScript it is a comparison, so this is the one known change of meaning. No tracked body is affected. `eraseBody` reports the exact case, where the text compiles as JavaScript and erasing still changed it, and `jx validate` and `jx build` print that as a warning. A runtime with no eraser keeps the JavaScript reading, which is a documented difference.
- **Decided:** analysis reads masked text. `maskCode(body)` in `@jxsuite/schema/guards` returns the body with comments and string contents blanked, same length, keeping `${}` contents. `bodyReturnsValue`, `STATE_ASSIGNMENT_RE`, `STATE_MUTATING_METHOD_RE` and every `state.` rewrite read it. It is a small scanner and not a parser, because the interpreter must give the same answer and cannot carry a parser. A regex literal containing a quote can still mislead it, and a test pins that as a known limit.
- **Decided:** every emitter ends a spliced body with a newline, and every `state.` rewrite matches `(?<![\w$.])state\b` through one helper.
- **Decided:** Studio stops minifying a string body when its editor closes, in every format, because the minifier deletes types. Compiled output is still minified. A body is stored as written, so a multi-line body in `.json` holds `\n` escapes. That cost is one reason `.jx` exists. Format parses as `fn.ts`, and lint receives `.ts`. The `minify` action goes with its last caller.
- **Decided:** `.class.json` bodies are erased but not type-checked, since those files stay JSON and no checker reads them.
- **Decided:** what the cloud host has to do is small, and lands in its own repository after the release carrying this: build the eraser into its preview assets beside the runtime bundle, serve it same-origin, pass `eraserUrl`, and raise its runtime version floor, because a runtime without the seam would otherwise fail on typed bodies with no sign why. Its Studio tree needs nothing, since the canvas chunk is staged with the rest of Studio, and `jx build` runs in the project's own CI.

## Implementation

1. **`packages/erase`.** `eraseBody(text, where)` returns `{ code, problems }`. `eraseDocument(doc, path)` returns an erased copy and throws on an unsupported construct. `eraseClass(def, path)` does the same for class members. `@jxsuite/erase/browser` exports `eraseBody` and bundles for a browser with nothing external. The manifest names no `@jxsuite/runtime`. Ships a `bunfig.toml`, tests and a release-config entry (`scripts/release-config.test.ts:67`). Publishing needs a npm trusted publisher, which is an owner action.
2. **Build and server load.** Erase beside each read: `compiler/src/compiler.ts:98`, `site/layout-resolver.ts:29`, `site/pages-discovery.ts:84`, `targets/compile-element.ts:136`, and the format-class load path so a `.md` page is covered. Classes in `server/src/resolve.ts` and `targets/compile-class.ts`.
3. **Runtime.** `setBodyEraser`, `setBodyEraserLoader`, `compileBody`, and every `new Function` site that takes a body: `runtime.ts:1519`, `:1934`, `:3760`, `:3785`, `:3793`, `:3802`, `:3804`. The template sites at `:1105` and `:1284` are unchanged.
4. **Studio and previews.** `canvas/iframe-entry.ts` installs the eraser at boot, so a live edit reaches `bindHandler` as JavaScript. It is loaded with the canvas, not with the runtime core. `ShellOptions` in `packages/site/src/shell.ts` gains `eraserUrl`, and the page and any component the preview fetches at run time are erased in the browser. The dev server and desktop serve that file and pass the option.
5. **Emission and analysis.** `maskCode`, the newline rule and the rewrite helper across `shared.ts`, `compile-client.ts`, `compile-element.ts` and `guards.ts`. Bodies are read after erasure, so classification sees JavaScript.
6. **Code services and editor.** `code-api.ts`, `panels/editors.ts` (`language: "typescript"`, semantic validation off until `plan:_shared/jx-typechecking`, no minify on close).
7. **Schema text.** The `body` descriptions in `packages/schema/defs`, then `bun run schema:sync`.

**Related, no edge.** `plan:spec/callable-classifier` and `plan:spec/computed-function-classification` also read `bodyReturnsValue`; `maskCode` sits below them, and whichever lands second adapts. `plan:spec/function-entry-tier-parity` rewrites parameter lists at the same `new Function` sites; `compileBody` keeps the list it is given. `plan:_shared/desktop-code-services` ports the code services this plan edits, and `plan:schema/parse-boundary-readers` edits the same read sites. In each case, whichever lands second merges.

**Integration contract.** Once this lands: every tier and analysis receives JavaScript. `@jxsuite/erase` exports the functions above, plus `@jxsuite/erase/browser`, and imports no runtime. `setBodyEraser` and `setBodyEraserLoader` are public runtime API. `maskCode` is the one way to read a body's code. The stored document is never erased, so anything that writes a document back gets the authored text.

## Tests

- `packages/erase`: stripper fixtures for every construct in the table above; idempotence; offsets preserved; refusal messages naming pointer and position; the `a < b > (c)` warning; a corpus test that the walker reaches every code body and leaves `jx-tabs.json`'s data alone, and that all of them come back byte-identical. Also a build of the browser entry and the runtime as two separate files, loaded together, rendering a typed body, because that is how a host ships them, and an assertion that the entry's bundle contains no runtime code.
- `packages/compiler`: a typed `state.items!.push(1)` is marked mutated; `state.helper!(state)` is callable; a body ending in `// done`, one with `// return early` and one with `prevstate.n` compile and run correctly in each target; a page with typed bodies matches its untyped twin byte for byte in every target and under both `JX_BUNDLER` backends.
- `packages/runtime`: `compileBody` with and without an eraser, the rethrown message, class members, the loader firing for a typed body and not for a plain one, the runtime installing what the loader returns, and a bundle assertion that no compiler enters core.
- `packages/site`: an import-graph assertion that no entry reaches `@jxsuite/erase` or `typescript`, so a Worker can still load the package; `pageShell` emitting the loader only with `eraserUrl`.
- `packages/studio`, `packages/server`, `packages/desktop`, `packages/site`: format and lint on typed bodies, no minify on close, the preview shell loading the eraser and rendering a fetched component with a typed body. Chrome MCP pass over the canvas and function editor.
- Coverage thresholds ratchet in every touched workspace. `packages/erase` ships its own. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §23.1: delete the marker and state the rules above. §5.3 4b and 4c stop calling a body JavaScript. §21 notes that the eraser adds no evaluation surface. `bun run spec:change spec.md minor -m "A function body in any document is TypeScript, erased before it is analysed or run"`.
- `embedding.md`: `setBodyEraser`, `setBodyEraserLoader` and `@jxsuite/erase/browser`, with a `minor` fragment. `compiler.md`: the load-time erasure step, with a `minor` fragment. `studio.md` §6.4: no minify on close, with a `minor` fragment, coordinated with `plan:_shared/desktop-code-services`, which owns that section's marker.
- Docs land per slice: `docs/framework/concepts/functions.md`, `docs/framework/agents/authoring-rules.md`, `docs/studio/logic/code.md`, `docs/extending/embedding/`, `.claude/commands/jx.md`. Add `@docs` tags to `packages/erase`. Then `bun run docs:sync` for the rest.

## Acceptance

- A `.json` page whose body reads `const input = event.target as HTMLInputElement; state.label = input.value` runs in `jx build` output, in the canvas and in Live Preview, including a preview from the cloud host once its side lands.
- A preview of a site with no typed body requests no eraser file.
- `grep` finds no type syntax in the compiled output, and the built page matches its untyped twin byte for byte.
- `bun run all-the-things`, `plans:check`, `docs:check` and `schema:verify` are green, and the runtime core bundle gains no more than the seam.

## Slices

| Slice | Scope                                                                              | Claims       | State |
| ----- | ---------------------------------------------------------------------------------- | ------------ | ----- |
| TSB.1 | `packages/erase`, build and server load, `maskCode`, the newline and rewrite fixes | spec.md#23.1 | open  |
| TSB.2 | Runtime seam and loader, canvas install, Live Preview                              | spec.md#23.1 | open  |
| TSB.3 | Code services, function editor, schema text; closes the marker                     | spec.md#23.1 | open  |
