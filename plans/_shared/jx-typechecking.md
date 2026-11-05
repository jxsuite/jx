---
status: drafted
disposition: implement
claims:
  - spec.md#23.3
  - studio.md#16.7
requires:
  - spec/typescript-function-bodies
  - spec/document-scripts
  - _shared/jx-document-format
workspaces:
  - packages/schema
  - packages/studio
  - packages/create
  - packages/starters
  - packages/ai
  - examples
  - scripts
  - specs
  - docs
size: L
---

# Type errors in document code show up in the terminal, Studio and VS Code, and `.jx` becomes the recommended format

## Context

`specs/spec.md` §23.3 and `specs/studio.md` §16.7 are both Pending: nothing checks the code inside a document. TypeScript is the default language (`plan:spec/typescript-function-bodies`), so this plan is what makes that default worth having.

**TypeScript 7.1 content mappers** (`7.1.0-beta` on npm on 2026-11-05, `latest` is 7.0.2, and the repository pins `^7.0.2`). A mapper is a process speaking JSON-RPC over stdio (`initialize`, `openProject`, `transform`, `closeProject`), declared under `contentMappers` in a tsconfig. `tsc` refuses it without `--runExternalCode`, and VS Code requires workspace trust. Rename, completion and formatting edits write back only through `Verbatim` spans. Design source: microsoft/typescript-go#4712.

**Measured so far.**

| Result                                                                                                                     | Run with                                |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Exact `file(line,col)` inside bodies and scripts, including after multibyte text                                           | `tsc` 7.1 beta, spike mapper            |
| A `.ts` file importing a typed export from a `.jx` file                                                                    | Same                                    |
| 300 files with 2,400 small functions in 0.58 s, finding the one seeded error (synthetic)                                   | Same                                    |
| LSP hover, completion and local rename work                                                                                | Same                                    |
| A body using a script's `helper` passes `tsc` and throws at run time, because both shared one virtual file                 | Same                                    |
| Moving bodies to a `supplemental` file with `import type` gives TS2304 at the real position                                | Same                                    |
| Renaming an export leaves `(export)bump`, and `tsc` errors at a virtual location. Mapping KDL names as `Verbatim` fixes it | Same                                    |
| 42 real bodies: 47 errors in 9 of 13 documents, 40 of them with event types derived. `tasks: []` becomes `never[]`         | Generated `.ts`, not through the mapper |
| `Request`, `ContentEntry`, `$expression` and layout state cannot be derived from the document alone                        | Same                                    |
| `Unknown compiler option 'contentMappers'`, exit 1, and rule findings gone                                                 | `oxlint` with tsgolint 7.0.2005         |

**Not tested:** VS Code, `node` on the desktop app's PATH (it appears not to be there), whether `--runExternalCode` trusts all mappers in a project, and Monaco's worker on generated text.

**The gaps this leaves for users.** No scaffold has a `tsconfig` or `typescript` dependency (`packages/create/generate.ts`), and no starter manifest has a `typecheck` script. Desktop is the only end-user path to Studio, and it has no `tsc`. `.json` gets completion from `$schema` with no tooling, in Studio (`services/monaco-setup.ts:155`) and in VS Code, and `.jx` would have none.

## Outcome

- spec.md §23.3 → Implemented. studio.md §16.7 → Implemented.
- Studio marks type errors in bodies and scripts without `tsc` or Node.
- `tsc --runExternalCode` reports them at real positions, and scaffolded projects are set up for it.
- VS Code gives squiggles, hover, rename, and schema-driven completion.
- `.jx` is what starters, scaffolds and docs teach. `.json` remains fully supported.

## Decisions

- **Decided (owner):** Studio type errors are part of v1, or TypeScript by default goes unchecked in the only end-user path to the visual editor.
- **Decided (owner):** a `(fn)` body cannot reach a script's private scope, and the checker enforces it, by giving bodies their own virtual file that sees only `State` and globals.
- **Decided (owner):** a `${}` template stays JavaScript, and the checker reports TypeScript syntax inside one, since it would render `""`.
- **Decided (owner):** the stated goal is readability and making hand-written and agent-written code practical, and removing sidecars is a result of that. JTC.5 says so where the old premise is written down.
- **Decided:** one generator, two consumers. `generateVirtualTypes(source)` is pure and returns virtual text plus a span map, with no Node dependency. The mapper and Monaco both call it, so the two surfaces cannot disagree about a document's types.
- **Decided:** Studio diagnostics do not wait for TypeScript 7.1. Monaco's TypeScript worker carries its own compiler, so JTC.1 can ship on its own. It also reaches the cloud host with no change there, since `ts.worker.js` is already staged with its Studio tree. That host runs no `tsc`, so Studio is its only checker until a project's own CI runs one. JTC.2 onward cannot merge until 7.1 is stable, since the mapper protocol is still being tested with partner tools, and they pin an exact stable version then.
- **Decided:** virtual layout. The main file holds `$script.client` line by line as `Verbatim` spans, because dedent breaks a single span, and an exported `State` interface. A `supplemental` file holds each body, with `import type { State }`. Another holds `$script.server`, so its imports stay apart. KDL names in `(export)` and `(server)` are `Verbatim` too, so rename reaches them.
- **Decided:** what `State` says. `(export)` entries are `typeof import` of the script's export. Server entries are `Awaited<ReturnType<…>> | null`. An empty array is `any[]`, not `never[]`. Anything the document cannot determine (`Request`, `ContentEntry`, `$expression`, inherited layout state) is `any`, not an error. A false error in code the author can't fix would teach people to ignore the checker.
- **Decided:** event types come from the `on*` binding, including `event.target` typed from the element carrying the handler where that is unambiguous.
- **Decided:** the mapper config is never in the root `tsconfig.json`. tsgolint fails on the unknown option, and `lint:typecheck` would go red. It goes in a separate `tsconfig.jx.json`, here and in scaffolds, and the root `include` is unchanged. Inline code stays outside the lint gates until tsgolint supports mappers, and docs say so.
- **Decided:** Studio's limits are stated, not hidden. It checks one document's bodies and client script against its own state. An import it cannot resolve in the worker is `any` and suppresses TS2307. Whole-project checking is `tsc`'s job. This is a real limit, and §16.7 says so.
- **Decided:** two new workspaces, created by their slices: `packages/content-mapper` (`@jxsuite/content-mapper`, run with `node`, `dynamicConfig: true` so it watches `project.json`) and `packages/vscode`. Each needs a `bunfig.toml`. The mapper needs a release-config entry (`scripts/release-config.test.ts:67`), a npm trusted publisher and template version pins. VS Code needs a marketplace lane. The publisher and marketplace accounts are owner actions.
- **Decided:** the recommendation flips last, and only after a release that contains all of this. A starter pins published `@jxsuite/*` versions (`AGENTS.md` "Starter Roots"), so it cannot use `.jx` before those are out.
- **Open:** how an author types what the checker cannot derive. Recommendation: a `$type` key on a state entry holding a TypeScript type, such as `"Task[]"`, resolved against the client script and globals, and ignored by every tier but the checker. Parameters would use a `name: Type` string in `(fn)` nodes, read the same way. The 47 measured errors include real cases that need this.
- **Open:** whether `tsc` checks bodies in `.json` documents. A mapper claims files by extension, and claiming `.json` would capture every data file and has not been tried. Recommendation: not in this plan. Studio checks both formats through the generator, and `jx convert` moves a file into `tsc`'s reach. A `jx typecheck` that writes the generator's output to temporary `.ts` files could cover `.json` later, with no design change.
- **Open:** whether `--runExternalCode` trusts every mapper in a project or only the named one. If every one, a scaffold's `typecheck` script makes that trust decision for the user, and docs must state it. Answer it in JTC.2 by test.

## Implementation

1. **Generator.** `packages/schema/src/jx/virtual-types.ts`: virtual text and span map, from `.jx` text or from a `JxDocument` when the source is `.json`, so bodies in either format are checked in Studio.
2. **Studio.** `panels/editors.ts` turns semantic validation on with the generated prelude. Positions map through the span map. Findings go to Problems as §16.6 does. The `.jx` Code view gets the same.
3. **Mapper.** `ts-content-mapper` 0.1.1 as a thin layer; a syntax error is reported as `error jx1` at its position, and `tsc` then reports only syntax errors for that run. TS bump to 7.1 stable in the same slice.
4. **Mapper depth.** Event types, `${}` template expressions, `$ref` checks, `$map` scope, `$props` from imported `.jx` components, `$defs`.
5. **Editors and format.** The VS Code extension: TextMate grammar, TypeScript injection, `registerContentMappers`, and completion from the schema through the span map. Studio's `.jx` Code view gets the same completion provider. `jx format` wraps `serializeJx` and runs `oxfmt` on code strings. `oxfmt` and `oxlint` do not see `.jx` otherwise.
6. **Scaffolds and the flip.**
   - `packages/create/generate.ts`: `.jx` pages, `tsconfig.jx.json`, `typescript`, the mapper and a `typecheck` script. `studio/src/create/add-new.ts:700`, `:717` create `.jx`.
   - `packages/starters` and `examples` convert with `jx convert`. `starters/tests/validate-projects.test.ts:51` globs `.jx`, or it would pass with nothing to check.
   - `packages/ai` prompts and `.claude/commands/jx.md` read and write `.jx`.
   - The premise changes where it is written: `AGENTS.md` line 3, the "JSON Edition" subtitle in `specs/spec.md`, `README.md` line 6, and §2.3's framing.
   - Marketing copy goes through `docs:claims`.

## Tests

- `packages/content-mapper`: `tsc` fixtures asserting exact `file(line,col)` for CRLF, tabs, multibyte, `#`-count variants, escapes, a syntax error, no `state`, no root. A body calling a script helper reports TS2304. Rename reaches `(export)` names. Language-service fixtures for hover, rename and completion.
- `packages/schema`: generator goldens, span round trips, and the corpus check: every body in starters and examples produces no false error once annotated, with the remaining `any`s listed in the test.
- `packages/studio`: a seeded error shows at its position and in Problems, with no Node. A TS2307 is suppressed. Chrome MCP pass.
- `packages/create`, `packages/starters`: a scaffold's `typecheck` passes and fails as seeded. `validate-projects.test.ts` fails if it finds no `.jx`.
- Coverage thresholds ratchet. `bun test --isolate` throughout.

## Specs & docs

- `spec.md` §23.3: state the rules, including `$type` once settled; delete the marker. `bun run spec:change spec.md minor -m "Report type errors in document code"`. `studio.md` §16.7: delete the marker, with a `minor` fragment.
- `compiler.md`: `jx format` and `tsconfig.jx.json`. `standards.md` or `spec.md` §18: TypeScript's erasable subset. Each with a fragment. A new spec for the mapper only if §23.3 can't hold it.
- Docs per slice: `docs/studio/logic/code.md` in JTC.1; a new `docs/framework/concepts/type-checking.md` with a `docs/nav.json` entry in JTC.2; `docs/start/install.md` and `jx-files.md` in JTC.5. `@docs` tags on new sources.
- `README.md` and marketing copy in JTC.5, with `docs:claims`. The starter size figures above need committed evidence before any is quoted.

## Acceptance

- In the desktop app, with no Node on PATH, `state.nope = 1` in a body shows a marker and a Problem at the exact position.
- In a scaffolded project, the same line fails `bun run typecheck` at its exact position. In VS Code it shows a squiggle and a hover, and renaming a `script` export updates its `(export)` node.
- A body that calls a private script helper fails the check.
- A new project from the desktop app or `create-jxsuite` is `.jx`, typechecks clean and builds.
- `bun run all-the-things`, `plans:check`, `docs:check`, `docs:claims` and `lint:typecheck` are green.

## Slices

Order: JTC.1, then JTC.2 once TypeScript 7.1 is stable, then JTC.3 and JTC.4, and JTC.5 last and after a release.

| Slice | Scope                                                                                     | Claims         | State |
| ----- | ----------------------------------------------------------------------------------------- | -------------- | ----- |
| JTC.1 | Generator, Studio diagnostics, Problems; closes §16.7                                     | studio.md#16.7 | open  |
| JTC.2 | `@jxsuite/content-mapper`, TypeScript 7.1, `tsconfig.jx.json`, `--runExternalCode` answer | spec.md#23.3   | open  |
| JTC.3 | Mapper depth: events, templates, `$ref`, `$map`, `$props`, `$type`                        | spec.md#23.3   | open  |
| JTC.4 | VS Code extension, completions in both editors, `jx format`                               | spec.md#23.3   | open  |
| JTC.5 | Scaffolds, starters, examples, AI, the premise and recommendation; closes §23.3           | spec.md#23.3   | open  |
