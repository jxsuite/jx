---
status: drafted
disposition: implement
claims: []
requires:
  - desktop/open-from-os
workspaces:
  - packages/schema
  - packages/compiler
  - packages/server
  - packages/desktop
  - packages/site
  - packages/studio
  - packages/create
  - packages/import
  - scripts
  - specs
size: M
---

# Every host finds, reads and writes the project file through one module, so changing what a project file is takes one change

## Context

This plan has no spec marker, and it is the prerequisite that decides whether `plan:site-architecture/project-jxn` is a change to one module or to sixty sites. A census of production code on 2026-11-06, read by hand:

| Fact                                                                                                                       | Evidence                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 61 lines spell `project.json` outside a constant, in 34 files, not counting message strings                                | 44 lines in 23 non-Studio files, 17 lines in 11 Studio files                                                                                             |
| 21 of 23 read sites bypass both helpers, and only 1 reaches `parseProjectConfig`                                           | `compiler/site/site-loader.ts:82` is that one. `site/compose.ts:98` has its own `JSON.parse`                                                             |
| 8 production writers, of which 4 rewrite the whole file from an object                                                     | `tabs/project-config.ts:448`, `files/file-ops.ts:409`, `refactor/apply.ts:180`, `create/generate.ts:294`                                                 |
| 6 mtime caches key on the name, and a project without that file silently gets no output directory, mounts, or data console | `server/src/` `jx-mounts.ts:88`, `resolve.ts:257`, `data-api.ts:161`, `studio-api.ts:118`, `site-output.ts:57`, and `compiler/site/schema-command.ts:98` |
| `projectRootsIn` is copied three times                                                                                     | `scripts/generate-schemas.ts:25`, `check-shadowed-core.ts:67`, `validate-schemas.ts:26`                                                                  |

No shared helper covers the name. `PROJECT_CONFIG_PATH` (`studio/tabs/tab.ts:23`) serves Studio only, and half of Studio bypasses it.

**Defects this fixes on the way:**

- `pages/project.json` is a legal page at `/project` (`compiler/site/pages-discovery.ts:243`, `site/routes.ts:55`), and both walkers believe it. `server/studio-api.ts:559` answers with that folder and the page as `projectConfig`, and `desktop/backend/project-session.ts:1120` answers from `existsSync` alone. Studio then sets the project root to `pages/` (`studio.ts:1096`, `:1101`). `plan:desktop/open-from-os` fixes the desktop walker, and this plan fixes the rest.
- `panels/imports-panel.ts:207`, `:298` and `main/app.ts:363` use an unbounded `endsWith("project.json")`, which also matches `new-project.json`.
- A rename reformats every JSON file it touches: `server/refactor/scan.ts:83` writes `JSON.stringify(doc, null, 2)`, which discards the layout record Studio preserves (`schema/json-layout.ts`), and a tab-indented scaffold becomes a whole-file diff.

## Outcome

- One module answers what a project file is. Afterwards no production file outside it spells the name, except a message string.
- `plan:site-architecture/project-jxn` changes the module and adds a format, and no caller.
- No observable change for a well-formed project except the defects above.

## Decisions

- **Decided:** `packages/schema/src/project-file.ts` (created by `plan:desktop/open-from-os`) is pure, working from a path and text, with no Node import, because Studio, the cloud host's Worker and `@jxsuite/site` all need it. Walking is two thin layers over it: an async one over a new `{ readText, exists }` IO for Studio and the Worker, since `FormatHostIO` (`format-registry.ts:525`) has neither, and a synchronous one at `@jxsuite/schema/project-file/node`. The synchronous one is needed: `compiler/site-loader.ts:73` is a published export, `server/site-output.ts:53` is synchronous, and `project-session.ts:283` is called by `assertReachable` (`:317`) on 10 RPC paths, where an accidentally unawaited call would turn a security guard into a no-op.
- **Decided:** the API is `isProjectConfigPath(path)` (exact, at the root), `findProjectFile(io, root)`, `findEnclosingProject(io, path)`, `readProjectFile(io, root)` returning `{ path, text, config }` or `{ path, text, error }`, and `serializeProjectFile(config, previous)`.
- **Decided:** `PROJECT_CONFIG_PATH` becomes `projectConfigPath()`, read from the open project's state, because Studio's tab id is that path and it will stop being constant. It still returns `project.json` when this lands.
- **Decided:** a malformed file is data that each caller sees and decides about, never a silent `undefined`. `project-session.ts:620`, `studio-api.ts:118` and `format-host` swallow a parse failure and build with no extensions, which then reports every Markdown page as unknown rather than naming the file, and that has to become a Problem. A live preview stays lenient on purpose: `site/compose.ts:107` says refusing "would hide the one error", and `resolve.ts` never rejects. So the module reports, and it does not throw on a host's behalf. Hand-written KDL will fail to parse more often than generated JSON, so this has to be right before that lands.
- **Decided:** the rename pass's `serialize` keeps layout, for every JSON document and not just this one. A general fix is the same size, and the special case would be stranger.
- **Decided:** `packages/ui/project.json` stays, and is not read through the module: `ui/src/theme.ts:15` imports it statically at build, and it is in `ui/package.json:17`'s publish list. The kit is excluded from `.jxn` by the owner's earlier decision, so this constraint costs nothing.
- **Decided:** a test holds the line. `scripts/project-file-literals.test.ts` scans `packages/*/src`, `packages/create/*.ts` (which keeps its source at the package root) and `extensions/*/src` for the literal in code, with a budget that only goes down, because 61 sites came from nothing stopping a 62nd.

## Implementation

In census order. Discovery: `server/src/` `studio-api.ts:214`, `:559`, `:589`, `:942`, `:974`, `dev.ts:190`, `site-output.ts:54`, `jx-mounts.ts:84`, `resolve.ts:256`, `data-api.ts:138`; `desktop/src/backend/project-session.ts:218`, `:689`; `desktop/src/main/app.ts:128`, `:362`, `:474`; `compiler/site/site-loader.ts:74`; `schema/validate-project.ts:65`.

Reads: the sites above, plus `studio-api.ts:125`, `:514`, `:563`, `:600`, `:697`; `import-api.ts:303`; `project-session.ts:226`, `:286`, `:620`, `:960`; `webview/platform.ts:378`; `studio.ts:1192`, `:1446`; `create/generate.ts:277`; `site/compose.ts:107`.

Writes: `tabs/project-config.ts:448`, `files/file-ops.ts:409`, `refactor/scan.ts:83`, `create/generate.ts:202`, `:294`, `import/emit.ts:253`, `import/run.ts:237`.

Identity: every `PROJECT_CONFIG_PATH` use and the Studio literals at `studio.ts:1155`, `:1171`, `:1208`, `panels/site-panel.ts:216`, `panels/style-panel.ts:377`, `services/ai-project-tools.ts:302`, `:348`, `services/monaco-setup.ts:208`, `browse/preview-style.ts:96`, `services/ai-command-tools.ts:331`, `create/add-new-flow.ts:388`, `settings/contributed-section.ts:261`, `settings/extension-commands.ts:171`. Outside Studio: `compiler/site/format-host.ts:136`, `:179`, `site-build.ts:602`, `validate-command.ts:178`, `server/extension-catalog.ts:94`, `desktop/src/main/app.ts:363`.

Gates: one `projectRootsIn` in `scripts/lib/workspaces.ts`.

`site/paths.ts` keeps its allowlist, and `NEVER_SERVABLE` reads the module's name list.

**Related, no edge.** `plan:schema/parse-boundary-readers` changes the same read sites and shares `parse.ts`. Whichever lands second merges.

**Integration contract.** Once this lands, `plan:site-architecture/project-jxn` may rely on: the literal budget at its floor, every read returning the source text and the path, every write passing through `serializeProjectFile` with the previous text, and `isProjectConfigPath` answering every identity question.

## Tests

- `packages/schema`: the module against a fake IO, including a malformed file, an Nx file, a page named `project.json`, and a `new-project.json`.
- Each converted caller keeps its suite. `packages/server`: the walker cases and a rename leaving a tab-indented file's layout alone. `packages/studio`: `imports-panel` no longer treats `new-project.json` as config; a malformed project file shows a Problem naming it.
- `scripts/project-file-literals.test.ts`, run by `bun test --isolate scripts`. Coverage thresholds ratchet. `packages/schema` gets a manifest entry through its new file's test.

## Specs & docs

- `desktop.md` §4.1 and `site-architecture.md` §2 stop implying that any file by that name is a project, and state the content rule. `bun run spec:change site-architecture.md patch -m "A file named project.json is a project only if its content is a project configuration"`.
- `docs/framework/concepts/` page on projects, if `bun run docs:sync` names one, and an explicit note in the pull request if it does not.

## Acceptance

- A project with `pages/project.json` opens, builds and previews at its real root on the dev server and desktop, and the page routes to `/project`.
- A rename in a tab-indented project changes only the references it repairs.
- The literal test's budget contains message strings only.
- `bun run all-the-things`, `plans:check` and `docs:check` are green, and `jx build` output is byte-identical across starters.
