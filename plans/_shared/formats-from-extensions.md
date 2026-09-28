---
status: drafted
disposition: reconcile
claims:
  - imports.md#1.2
  - site-architecture.md#6.5
  - studio.md#8.1
requires: []
workspaces:
  - packages/schema
  - packages/studio
  - packages/compiler
  - packages/server
  - packages/desktop
  - examples
  - packages/starters
  - packages/ui
  - scripts
  - sites/jxsuite.com
  - sites/test-blank
size: M
---

# Every spec, message and schema example says format classes come from the extensions a project enables, and `imports` keeps only its `$prototype` job

## Context

Three specs still carry one retired sentence: that a host builds its format registry by scanning the project-level `imports` map for `.class.json` files with a `format` block. No host has done that since extensions.md §3 moved format registration to the project.json `extensions` array. The census stubbed imports.md §1.2 and site-architecture.md §6.5 separately; the cross-spec review found the same sentence, unmarked, in studio.md §8.1, and the three are one rewrite in one vocabulary. Re-verified on 2026-09-26.

`specs/imports.md` §1.2, line 33:

> **Status: Partial.** No host reads the project `imports` map for format classes: the compiler, the dev server and the desktop session build the format registry from the project.json `extensions` array through each package's `jx-extension.json` manifest (`buildExtensionRegistry` in `packages/schema/src/extension-registry.ts`, `buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`), and the studio reads theirs, which is the model extensions.md §3 specifies. The imports-scanning `buildFormatRegistry` in `packages/schema/src/format-registry.ts` is still exported but only tests call it; what still holds below is that a project with no extension enabled handles only `.json`, with no implicit format defaults, and that page-level imports take no part in dispatch.

`specs/site-architecture.md` §6.5, line 750:

> **Status: Partial.** The key rules ship except the source of format classes: `format` resolves only through the extension registry built from project `extensions` (`registry.byName` in `extensions/parser/src/content-loader.ts`, `buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`), never the `imports` map, so a class declared only in `imports` is refused as "not a registered format class". §6.2 already states the shipped rule.

`specs/studio.md` §8.1, line 794:

> **Status: Partial.** Dispatch ships as described except the registry's source: no host reads the project-level `imports` map for format classes. The dev server and the desktop session (`getFormatRegistry` in `packages/server/src/studio-api.ts` and `packages/desktop/src/project-session.ts`) build the registry from the project.json `extensions` array (`buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`) and serve it through `listFormats`, the model `extensions.md` §3 specifies, as `imports.md` §1.2 records.

All three sections were unmarked before the census, and none of their parents (imports.md §1, site-architecture.md §6, studio.md §8) carries a marker. The code is right and the text is stale: extensions.md §3 (line 79) already says `imports` "no longer registers formats or extensions; imports-based auto-discovery is gone", site-architecture.md §6.2 says `format` values are "provided by enabled extensions", and site-architecture.md §3.1's `imports` and `extensions` rows describe the split. imports.md §1.2's example (`"Markdown": "@jxsuite/parser/Markdown.class.json"` under `imports`) registers nothing today.

**What ships**

- `buildExtensionRegistry` (`packages/schema/src/extension-registry.ts`) reads `extensions` and each package's `jx-extension.json`; its `formats` getter is a `FormatRegistry` over the classes with a `format` block. `buildProjectExtensionRegistry` (`packages/compiler/src/site/format-host.ts`) passes it `projectConfig.extensions` and nothing else. Its callers: the build (`site-build.ts`, `schema-command.ts`, `validate-command.ts`, `db-push.ts` under `packages/compiler/src/site/`), the dev server (`studio-api.ts`, `resolve.ts`, `jx-mounts.ts`, `data-api.ts` under `packages/server/src/`) and the desktop session (`packages/desktop/src/project-session.ts`).
- Studio's registry, per host: the dev server's `getFormatRegistry` (`packages/server/src/studio-api.ts`, cached against `project.json`'s mtime) serves `GET /__studio/formats`, which the devserver platform's `listFormats` fetches (`packages/studio/src/platforms/devserver.ts`); the desktop session's `getFormatRegistry` feeds its `listFormats`; the cloud platform fetches its host's `/formats` (`packages/studio/src/platforms/cloud.ts`). Nothing on any path reads `imports` for formats.
- Collections: `loadContentType` (`extensions/parser/src/content-loader.ts`) resolves an explicit `format` through `registry.byName` and refuses an unknown name with `format "<name>" is not a registered format class. Enable an extension providing it in project.json "extensions", e.g. "@jxsuite/parser".`; with no `format` it derives one from the source extension (`byExtension(ext, "load")`), and a directory source with none fails through `unknownFormatError`. The compiler's `unknownFormatError` (`packages/compiler/src/site/format-host.ts`) and `pages-discovery.ts` already name the working fix in the same words.
- The user docs state the shipped rule: `docs/framework/site/content-collections.md` (line 23 and the `format` bullet), `docs/framework/site/project-json.md` ("Extensions and imports"), `docs/studio/interface.md` (the Format picker lists "every format your project's extensions provide"), `docs/extending/extensions/formats.md` ("How the pipeline dispatches"). No docs page anchors `imports.md#1.2`, `site-architecture.md#6.5` or `studio.md#8.1`.

**What still carries the retired model** (the census found the first three; the rest were found in detailing and review)

- `noFormatError` (`packages/studio/src/format/format-host.ts`, thrown from `files/files.ts` and `files/file-ops.ts` when a non-JSON file matches no format): `No format class imported for "<path>" — add one to project.json imports (e.g. "Markdown": "@jxsuite/parser/Markdown.class.json") and make sure the project's dependencies are installed`. Following it changes nothing. Pinned by `packages/studio/tests/files-diff-gaps.test.ts:267` (`toContain("No format class imported")`) and `packages/studio/tests/file-ops.test.ts:59` (`/No format class imported/`); present-tense comments name it in `src/studio.ts:1347`, `tests/format-host-gaps.test.ts:34` and `tests/studio-shell.test.ts:1116`. Past-tense comments quote it as history in `src/media/media-pane.ts:5-7`, `src/files/files.ts:2310-2312` and `tests/media-pane.test.ts:4-6`, as studio.md §4.2 does.
- Studio's format-host file comment ("auto-discovered server-side from the project imports map", line 4) and two doc comments (`formatByName`, "by its import name", line 238; `noFormatError`, "no imported format class", line 246). The `listFormats` doc comments in `packages/studio/src/types.ts:404`, `packages/studio/src/platforms/devserver.ts:751` and `packages/desktop/src/project-session.ts:592` say "(auto-discovered from imports)", and `project-session.ts:594` says "no imported formats".
- The `formatAction` refusals: `Format "<name>" is not an imported format class` in `packages/server/src/studio-api.ts:1487` (404, asserted only by status in `packages/server/tests/studio-api.test.ts`, "POST /__studio/format rejects unknown formats") and `packages/desktop/src/project-session.ts:705` (pinned by `packages/desktop/tests/handlers-gaps.test.ts:413`).
- `packages/schema/src/format-registry.ts`: the module header ("auto-discovery of format-extension classes from a project imports map"; "Hosts … build a registry from the project-level imports map") and `buildFormatRegistry(imports, io, base?)` (line 345), published through the `@jxsuite/schema/format-registry` subpath (`@jxsuite/schema` is at 2.2.0). Its only callers are `packages/schema/tests/format-registry.test.ts` (which also uses it to build fixtures for the `FormatRegistry` lookup and `FormatEntry.call` cases) and the `workspaceRegistry` helper in `packages/server/tests/refactor-apply.test.ts`, which names the workspace's own `Csv.class.json` and `Markdown.class.json` by absolute path so that a bare `@jxsuite/parser` cannot resolve to the published package. The module's other exports are live.
- The class schema's `format` block description (`formatDefSchema` in `packages/schema/defs/class-def.schema.ts:153-155`): "A class carrying this block is auto-discovered from the project imports map and used for file-extension dispatch by the compiler, server, and studio." Editors show it on hover to every extension author. It is regenerated into 30 committed schemas: `packages/schema/class-schema.json`, `packages/schema/schema.json`, and the 28 project roots' `document.schema.json` (under `examples/`, `packages/starters/sites/*`, `packages/studio`, `packages/ui`, `scripts/screenshots/fixtures/*`, `sites/jxsuite.com`, `sites/test-blank`). A 31st copy, `packages/schema/--cwd`, is a stray tracked snapshot of `schema.json` added by an unrelated commit (288fb73a); nothing reads it, and `schema:sync` never rewrites it because it is not a `*schema.json`.
- The project schema's `imports` example (`packages/schema/defs/project-config.schema.ts:460-465`): `{ "Markdown": "@jxsuite/parser/Markdown.class.json", "MarkdownCollection": "@jxsuite/parser/MarkdownCollection.class.json" }`, regenerated into 30 committed schemas (`packages/schema/project-schema.json`, `packages/schema/schemas/project.core.schema.json`, and the same 28 roots' `project.schema.json`).
- `docs/framework/agents/authoring-rules.md` (its `code:` lists `packages/schema/project-schema.json` and `.claude/commands/jx.md`): the project.json example pairs `"extensions": ["@jxsuite/parser"]` with `"imports": { "MarkdownCollection": "@jxsuite/parser/MarkdownCollection.class.json" }`, and its `content.blog` directory source has no `format`, which site-architecture.md §6.5 and `loadContentType` refuse. `.claude/commands/jx.md` (the `jx` authoring skill agents work from) carries the same `imports` line. `docs/extending/embedding/dev-server.md` line 39 says the registry is "built by scanning the project's dependencies".
- imports.md §1.1's example maps `MyLayout` to `./layouts/main.json`, which Pass 0 in `packages/runtime/src/runtime.ts` refuses (`import "<name>" must map to a .class.json path`), so it contradicts the `$prototype` job this rewrite leaves `imports`. §1.1 is claimed by `plan:imports/canvas-project-context` for the canvas's rebasing.
- `buildProjectFormatRegistry` (`packages/compiler/src/site/format-host.ts:146`) is the formats view of the extensions registry, not the retired mechanism, but its `@deprecated` note says "the desktop app still imports this": its only `src` caller is `packages/server/src/live-preview.ts`, and desktop names it only in a test mock (`packages/desktop/tests/handlers-gaps.test.ts:74`).

## Outcome

- imports.md §1.2 → Implemented: marker deleted, heading retitled under the same number, body rewritten to the extensions model; `imports` described only as a `$prototype` map.
- site-architecture.md §6.5 → Implemented: marker deleted, the `format` key rule rewritten; the rest of the list stands.
- studio.md §8.1 → Implemented: marker deleted, the registry-source clause rewritten; §8.3's two sentences follow as an unclaimed ride-along.
- Every message, doc comment, schema description and schema example under `packages/` that sends a user to `imports` for a format names `extensions` instead, and so do the two agent-facing project.json examples. No behaviour changes.
- No spec graduates unless one of imports.md, site-architecture.md and studio.md has no other open item when this lands (Specs & docs). Nothing requires this plan, so it can be the last.

## Decisions

- **Open:** delete `buildFormatRegistry` or keep it. Recommendation: keep it, signature unchanged apart from renaming its first parameter `imports` to `classes`, with its doc comment and the module header rewritten (Implementation step 6), because deleting a `@jxsuite/schema/format-registry` export is a breaking change to a 2.x package, whose major would move every dependent's range for a function that registers nothing on its own, and it serves a need the extension registry does not: a registry over named descriptor files with no manifest and no package resolution, which `refactor-apply.test.ts` relies on.
- **Open:** replace the project schema's `imports` example. Recommendation: yes, with `{ "GeoLocation": "./lib/GeoLocation.class.json" }` (the class `docs/framework/concepts/data-prototypes.md` imports), because the example names the parser's format class under `imports`, and JSON editors, Studio's source mode included (studio.md §4.2.1), offer a schema's `examples` as completions, so it teaches the retired registration exactly where a user types `imports`. The cost is a generated diff over the 30 `project.schema.json`-family files, written by `bun run schema:sync` and reviewed as one pointer. The `workspaces` list does not depend on this: the `format` description (Implementation step 7) regenerates a `document.schema.json` in the same 28 roots either way.
- **Decided:** `reconcile`, with code limited to messages, comments, one schema description and one schema example, because every host already builds its registry from `extensions`; nothing here changes which classes are registered.
- **Decided:** the fragments are `minor`, not `major`. The behaviour the old text promised stopped working when extensions.md §3 shipped and that section already announced it; these edits make three more sections say what authors already get, and redefine nothing that currently works.
- **Decided:** the `format` block's schema description is rewritten, because editors show it to every extension author as the contract, exactly as a refusal message is shown to a user; it is the same stale sentence in a fourth place.
- **Decided:** the three markers are deleted rather than rewritten as `Implemented`, because the sections were unmarked before the census and no parent carries a marker, so each reads as closed exactly as it did.
- **Decided:** imports.md §1.2 keeps its number and becomes "### 1.2 Format Classes Come From Extensions", a short section that points to extensions.md §3 and §4 rather than restating the manifest model, because anchors are numeric (docs `spec:` and the generated status page key on `imports.md#1.2`), "Auto-Discovery" names the mechanism extensions.md §3 says is gone, and a second statement of the manifest model would be a second source.
- **Decided:** every refusal names the working fix in the words the compiler and the content loader already use ("not a registered format class", "Enable an extension providing it in project.json "extensions", e.g. "@jxsuite/parser""), written inline at each site rather than through a shared helper, because Studio cannot import `@jxsuite/compiler` (not a dependency; browser bundle) and each message is one sentence pinned by its own workspace's test. Past-tense quotations of the old Studio message stay, because they record what it was and remain true.
- **Decided:** the imports.md §1.1 example rides here although `plan:imports/canvas-project-context` claims §1.1, because the defect is the `$prototype`-only job this plan states, not the canvas's rebasing, and the edit touches only the code block, not the marker line that plan flips, so either can land first.
- **Decided:** no `requires` edge. The §1.2 text does not restate how an `imports` entry and a manifest class of the same name resolve (extensions.md §3, `plan:extensions/local-imports-precedence`), and the §8.1 edit is confined to the registry-source clause, leaving the `formatAction` sentence that `plan:extensions/capability-timing-dispatch` may rewrite.

## Implementation

Spec and docs text is under Specs & docs. Code, one pull request:

1. **`packages/studio/src/format/format-host.ts`**
   - File comment, lines 3 to 7: "The host builds the registry from the extensions the project enables in project.json (extensions.md §3, studio.md §8.1); the studio introspects it via the PAL (`listFormats`) and invokes parse/serialize capabilities via `formatAction` (POST /__studio/format in the dev server, RPC on desktop). The studio itself holds zero format knowledge; `.json` is the single native built-in."
   - `formatByName` doc: "Look up a format by its class name (the key its extension's manifest lists it under)."
   - `noFormatError` doc: "Error for opening a non-JSON file when no registered format class claims its extension." Message: `` `No format class registered for "${path}". Enable an extension that provides one in project.json "extensions" (e.g. "@jxsuite/parser") and make sure the project's dependencies are installed.` `` Signature unchanged, so `files/files.ts` and `files/file-ops.ts` are untouched.
2. **`packages/studio/src/studio.ts:1345-1347`**: the comment's quoted error becomes "No format class registered".
3. **`packages/studio/src/types.ts:404`** and **`packages/studio/src/platforms/devserver.ts:751`**: "(auto-discovered from imports)" becomes "(built by the host from the extensions project.json enables)".
4. **`packages/desktop/src/project-session.ts`**: line 592 as step 3; line 594 "there are no imported formats to list" becomes "there are no formats to list"; line 705's message becomes `` `Format "${params.format}" is not a registered format class. Enable an extension providing it in project.json "extensions", e.g. "@jxsuite/parser".` ``.
5. **`packages/server/src/studio-api.ts:1487`**: the same message with `${format}`, still `problem("notFound", …)`.
6. **`packages/schema/src/format-registry.ts`** (per the first Open decision):
   - Module header: "Format registry: the format-dispatch view of a set of class descriptors. A class participates in format dispatch iff its .class.json carries a top-level `format` block. Hosts build theirs from the extensions a project enables (`buildExtensionRegistry` in ./extension-registry.ts, whose `formats` is a FormatRegistry; extensions.md §3) and dispatch file-extension work (parse, serialize, discover, load) through it. `.json` is the single native built-in and never appears in a registry." The I/O paragraph stays.
   - `buildFormatRegistry`: rename the first parameter to `classes`; doc comment: "Build a registry from an explicit map of class names to class-descriptor paths. No host builds its registry this way, and a project's `imports` map registers no format (imports.md §1.2); this entry point is for tests and tools that name descriptor files directly. Values that are not `.class.json` paths are skipped, as are class files that fail to load or carry no `format` block." Behaviour unchanged.
7. **Schema definitions**, then `bun run schema:sync`, which rewrites the committed schemas listed in Context (the `schemas.yml` lane would push the same bytes):
   - `packages/schema/defs/class-def.schema.ts:153-155`, `formatDefSchema.description`: "Format participation marker. A class carrying this block is a format class: once an extension the project enables in project.json \"extensions\" lists it in its manifest, the compiler, server and studio dispatch file-extension work to it. Declaring the class in \"imports\" registers no format." Regenerates `class-schema.json`, `schema.json` and the 28 `document.schema.json`.
   - `packages/schema/defs/project-config.schema.ts:460-465` (per the second Open decision): `examples: [{ GeoLocation: "./lib/GeoLocation.class.json" }]`; the description stays. Regenerates `project-schema.json`, `schemas/project.core.schema.json` and the 28 `project.schema.json`.
   - Delete `packages/schema/--cwd` (`git rm`), the stray snapshot no generator owns.
8. **`packages/compiler/src/site/format-host.ts:146-147`**: `@deprecated` note becomes "`packages/server/src/live-preview.ts` still imports this; use `buildProjectExtensionRegistry(...).then((r) => r.formats)` instead." (drop "Part-3 cleanup").

**Integration contract.** Once this lands: imports.md §1.2, site-architecture.md §6.5 and studio.md §8.1 state that format classes come only from the extensions `project.json` enables, and that an `imports` entry is a `$prototype` mapping that registers no format; a plan editing any of them builds on that text. Every host's refusal of an unknown format begins `No format class registered for` (by extension or path) or reads `is not a registered format class` (by name), and names `project.json "extensions"`. `buildFormatRegistry` keeps its export and behaviour, documented as an explicit-map builder that no host calls. The class schema's `format` description names enabled extensions as the only source. studio.md §8.1's `formatAction` sentence is unchanged.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`, `packages/schema`, `packages/server`, `packages/desktop` and `packages/compiler`.

- **`packages/studio/tests/format-host-gaps.test.ts`**: add `noFormatError` to the `await import("../src/format/format-host")` list and a `describe("noFormatError")` case, `names the extensions fix, not imports`: for `noFormatError("notes/a.toml").message`, contains `No format class registered for "notes/a.toml"`, `project.json "extensions"` and `@jxsuite/parser`, and does not contain `imports`. Update the line-34 comment's quoted error.
- **`packages/studio/tests/files-diff-gaps.test.ts:267`**: `toContain("No format class registered")`. **`packages/studio/tests/file-ops.test.ts:59`**: `/No format class registered/`. **`packages/studio/tests/studio-shell.test.ts:1116`**: comment only.
- **`packages/server/tests/studio-api.test.ts`**, "POST /__studio/format rejects unknown formats": also assert `(await res.json()).detail` (the RFC 9457 member; `error` is its deprecated duplicate, `problemDetails` in `packages/protocol/src/problems.ts`) contains `Format "Toml" is not a registered format class` and `project.json "extensions"`.
- **`packages/desktop/tests/handlers-gaps.test.ts:413`**: expect `'Format "Nope" is not a registered format class'`.
- **`packages/schema/tests/format-registry.test.ts:78`**: retitle `discovers format classes from imports map` to `builds a registry from an explicit name-to-class map`; the cases are unchanged.
- `packages/compiler`: a comment only; its suite must stay green.

Coverage: no source file and no function is added or removed, and every changed line is a string or a comment, so each workspace's per-file figures are unchanged (studio lines 0.958 / functions 0.941, schema 0.99 / 0.99, server 0.96 / 0.95, desktop 0.96 / 0.90, compiler 0.982 / 0.98); no ratchet. The schema definitions are data, checked by `bun run schema:verify` rather than a test. The manifest check (`bun scripts/check-coverage-manifest.ts <workspace>`) is unaffected.

## Specs & docs

**imports.md**, in place:

- §1.2: delete the line-33 marker. Retitle the heading `### 1.2 Format Classes Come From Extensions`. Replace the body (the "Imports are also the registration mechanism…" paragraph, the `imports` example and the paragraph after it) with:

  > Format-extension classes (a `.class.json` carrying a top-level `format` block, `extensions.md` §7) are registered by the extensions a project enables, never by `imports`. Hosts build the format registry from the `project.json` `extensions` array (`extensions.md` §3), each package contributing the classes its `jx-extension.json` manifest lists (`extensions.md` §4), and the studio reads its host's (`studio.md` §8.1):
  >
  > `{ "extensions": ["@jxsuite/parser"] }` (as a fenced `json` block)
  >
  > With `@jxsuite/parser` enabled, `.md` files are discoverable as pages and components, content types can use `"format": "Markdown"` / `"format": "Csv"`, and the studio offers the formats' editing surfaces. A project that enables no format extension handles only `.json`; there are no implicit format defaults. An `imports` entry that names a format class is a `$prototype` mapping like any other (§1.1) and registers no format, and page-level imports take no part in file-extension dispatch.

- §1.1, example only (heading, marker and prose untouched): replace `"MyLayout": "./layouts/main.json",` with `"GeoLocation": "./lib/GeoLocation.class.json",`.
- Fragment: `bun run spec:change imports.md minor -m "§1.2: format classes come from the extensions a project enables, and an imports entry registers no format; the §1.1 example maps only .class.json paths."`

**site-architecture.md**, in place:

- §6.5: delete the line-750 marker. Replace the second key rule (line 771) with: "`format` names a **format class** provided by an extension the project enables in `extensions` (e.g. `"Markdown"`, `"Csv"` from `@jxsuite/parser`; see `extensions.md` §3 and §4). A name no enabled extension provides is refused as not a registered format class; declaring the class in `imports` does not register it. `"json"` is the only built-in. When omitted, the format is derived from the source file extension via the format registry; directory sources require an explicit `format`."
- Fragment: `bun run spec:change site-architecture.md minor -m "§6.5: a collection format names a format class provided by an enabled extension, never one declared only in imports."`

**studio.md**, in place:

- §8.1: delete the line-794 marker. In the first paragraph replace "built from the project-level `imports` map and fetched via the PAL (`listFormats`)" with "which the host builds from the extensions the project enables in `project.json` (`extensions.md` §3) and the studio fetches via the PAL (`listFormats`)". The `formatAction` sentence after it is unchanged.
- §8.3 (unmarked, not claimed): "(e.g. `.md` with the `Markdown` class imported)" becomes "(e.g. `.md` when `@jxsuite/parser` is enabled)", and "Projects without format imports handle only `.json`." becomes "A project that enables no format extension handles only `.json`."
- §4.2's past-tense quotation of the old error stays.
- Fragment: `bun run spec:change studio.md minor -m "§8.1 and §8.3: the format registry comes from the extensions a project enables, not from the project imports map."`

**Docs** (no em dashes in prose):

- `docs/extending/embedding/dev-server.md` (`code:` lists `studio-api.ts`), line 39: "built by scanning the project's dependencies and cached against `project.json`'s mtime. Edit the manifest and the next request rebuilds the registry." becomes "built from the extensions `project.json` enables and cached against that file's mtime. Edit `project.json` and the next request rebuilds the registry."
- `docs/framework/agents/authoring-rules.md` (`code:` lists `project-schema.json`, `class-schema.json` and `.claude/commands/jx.md`), the `## project.json` example: the `imports` line becomes `"imports": { "GeoLocation": "./lib/GeoLocation.class.json" },` and `content.blog` gains `"format": "Markdown",` after `source`, since a directory source requires one.
- `.claude/commands/jx.md`, "project.json" (not a docs page, but agents author from it and `authoring-rules.md` lists it): the same `imports` line change (line 266). The rest of that example (`contentTypes`, no `extensions`) predates the extensions model and is left to whoever refreshes it; this plan only stops it teaching `imports` as format registration.
- Named by `bun run docs:sync`, already correct, no change: `docs/studio/interface.md` (`format-host.ts`), `docs/studio/interface/tabs.md` (`studio.ts`), `docs/extending/embedding/platform-adapter.md` (`types.ts`, `devserver.ts`), `docs/extending/extensions/formats.md` (`format-registry.ts`), `docs/framework/site/project-json.md` (`project.core.schema.json`), `docs/framework/agents/machine-readable.md` and `docs/framework/agents.md` (`schema.json`).
- No docs page anchors the three claimed sections; `docs/framework/site/content-collections.md` (`site-architecture.md#6`) already states the rule.

**Graduation.** A reconcile's graduation rides on its execution, so it is `minor`. Before landing, run `bun run plans:status --spec imports`, `--spec site-architecture` and `--spec studio`. For each spec whose only open item left is this plan's (imports.md §1.2, site-architecture.md §6.5, studio.md §8.1), set its header to `**Status:** Implemented`, run `bun run spec:bump <spec>.md minor -m "<that spec's fragment sentence above>"` in place of its fragment, and delete `plans/<stem>/`. Otherwise no spec graduates.

Landing deletes this file and rewords every `plan:_shared/formats-from-extensions` citation left in a plan that still exists, or `plans:check` reports `citation-unknown`: today `plans/extensions/capability-timing-dispatch.md` (lines 71 and 154), `plans/extensions/declared-media-type-responses.md` (line 91) and `plans/imports/canvas-project-context.md` (line 154). No audit record cites it.

## Acceptance

- `bun test --isolate --coverage` passes in `packages/studio`, `packages/schema`, `packages/server`, `packages/desktop` and `packages/compiler`.
- `git grep -n -e "imported format class" -e "auto-discovered from imports" -e "project imports map" -e "project-level imports map" -e "No format class imported" -- . ':!specs' ':!plans'` prints nothing (the past-tense quotations are split across lines). The scope is the whole tree because the regenerated `document.schema.json` files live under `examples/`, `sites/` and `scripts/` as well as `packages/`.
- `bun run schema:verify` is green, and (with the second Open decision as recommended) `git grep -n "MarkdownCollection.class.json" -- '*schema.json'` prints nothing.
- `git grep -n -e "MarkdownCollection.class.json" -- docs/framework/agents/authoring-rules.md .claude/commands/jx.md` prints nothing.
- `grep -n -e "format imports" -e "class imported" -e "project-level .imports. map" specs/imports.md specs/site-architecture.md specs/studio.md` prints only two lines, neither about format registration: imports.md line 212 (the Standards Alignment row on the `imports` map's import-map shape) and studio.md line 196 (§4.2's past-tense quotation).
- `bun run plans:status --spec imports`, `--spec site-architecture` and `--spec studio` no longer list `imports.md#1.2`, `site-architecture.md#6.5` or `studio.md#8.1`.
- `bun run docs:status`, `bun run plans:check`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose`, `bun run docs:spec-release` and `bun run docs:section-refs` are green.
- In the dev-server Studio, a project whose `extensions` omits `@jxsuite/parser`: opening a `.md` file reports `No format class registered for "…". Enable an extension that provides one in project.json "extensions"…`; adding `"@jxsuite/parser"` to `extensions` through the project.json settings tab (whose save rebuilds the studio's registry, `refreshExtensionSurfaces` in `packages/studio/src/tabs/project-config.ts`; a hand edit needs a project reload, since `loadFormats` memoises) and reopening the file opens it in the Markdown editor.
