---
status: stub
disposition: reconcile
claims:
  - imports.md#1.2
  - site-architecture.md#6.5
  - studio.md#8.1
size: M
workspaces:
  - packages/schema
  - packages/studio
---

# Every spec says format classes come from the extensions a project enables, and `imports` keeps only its `$prototype` job

## Context

Three specs still carry one retired sentence: that a host builds its format registry by scanning the project-level `imports` map for `.class.json` files with a `format` block. No host has done that since extensions.md §3 moved format registration to the project.json `extensions` array. The census stubbed imports.md §1.2 and site-architecture.md §6.5 separately; the cross-spec review found the same sentence, unmarked, in studio.md §8.1, the markers stage opened it, and the three are merged here because they are one rewrite in one vocabulary, with one `buildFormatRegistry` decision and one Studio comment behind them.

`specs/imports.md` §1.2, line 33:

> **Status: Partial.** No host reads the project `imports` map for format classes: the compiler, the dev server and the desktop session build the format registry from the project.json `extensions` array through each package's `jx-extension.json` manifest (`buildExtensionRegistry` in `packages/schema/src/extension-registry.ts`, `buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`), and the studio reads theirs, which is the model extensions.md §3 specifies. The imports-scanning `buildFormatRegistry` in `packages/schema/src/format-registry.ts` is still exported but only tests call it; what still holds below is that a project with no extension enabled handles only `.json`, with no implicit format defaults, and that page-level imports take no part in dispatch.

`specs/site-architecture.md` §6.5, line 750:

> **Status: Partial.** The key rules ship except the source of format classes: `format` resolves only through the extension registry built from project `extensions` (`registry.byName` in `extensions/parser/src/content-loader.ts`, `buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`), never the `imports` map, so a class declared only in `imports` is refused as "not a registered format class". §6.2 already states the shipped rule.

`specs/studio.md` §8.1, line 794:

> **Status: Partial.** Dispatch ships as described except the registry's source: no host reads the project-level `imports` map for format classes. The dev server and the desktop session (`getFormatRegistry` in `packages/server/src/studio-api.ts` and `packages/desktop/src/project-session.ts`) build the registry from the project.json `extensions` array (`buildProjectExtensionRegistry` in `packages/compiler/src/site/format-host.ts`) and serve it through `listFormats`, the model `extensions.md` §3 specifies, as `imports.md` §1.2 records.

All three sections were unmarked before the census. studio.md §8.1 was listed as verified in the studio census's first pass (`plans/studio/README.md`, "§8.1–§8.2.7"); its dispatch half holds, and only the clause "built from the project-level `imports` map" is wrong.

**Disposition: reconcile.** The code is right and the text is stale. extensions.md §3 (line 79) already says `imports` "no longer registers formats or extensions; imports-based auto-discovery is gone", site-architecture.md §6.2 already says `format` values are "provided by enabled extensions", and site-architecture.md §3.1's `imports` and `extensions` rows already describe the split. The three claimed sentences are the only normative text still describing the old mechanism, and imports.md §1.2's example (`"Markdown": "@jxsuite/parser/Markdown.class.json"` under `imports`) would register nothing today. One piece of code carries the same retired advice to users: Studio's "no format" error (below). Correcting that message is a code ride-along of this reconcile, not a change of mechanism, so the disposition stays `reconcile`.

**What exists**

- `buildExtensionRegistry` (`packages/schema/src/extension-registry.ts`), which reads `extensions` and each package's `jx-extension.json`, and `buildProjectExtensionRegistry` (`packages/compiler/src/site/format-host.ts`), which passes it `projectConfig.extensions` and nothing else. Its callers: the build (`packages/compiler/src/site/site-build.ts`, `schema-command.ts`, `db-push.ts`), the dev server (`packages/server/src/studio-api.ts`, `resolve.ts`, `jx-mounts.ts`, `data-api.ts`), and the desktop session (`packages/desktop/src/project-session.ts`); `packages/server/src/extension-catalog.ts` beside them.
- Studio's registry, host by host. The dev server's `getFormatRegistry` (`packages/server/src/studio-api.ts`) is `getExtensionRegistry(...).formats`, served at `GET /__studio/formats`, which the devserver platform's `listFormats` fetches (`packages/studio/src/platforms/devserver.ts`). The desktop session's `getExtensionRegistry` calls `buildProjectExtensionRegistry`, and its `getFormatRegistry` feeds `listFormats` (`packages/desktop/src/project-session.ts`). The cloud platform's `listFormats` fetches its host's `/formats` route (`packages/studio/src/platforms/cloud.ts`). Nothing on any path reads `imports` for formats.
- Collections: `loadContentType` in `extensions/parser/src/content-loader.ts` resolves an explicit `format` through `registry.byName` (refusing an unknown name as "not a registered format class") and derives one from the source extension through the same registry; directory and remote sources require an explicit format, and remote needs `remote: true`. Recursive discovery goes through the format's `discover` capability (`extensions/parser/src/markdown.ts`).
- `buildFormatRegistry` (`packages/schema/src/format-registry.ts`, published through the `@jxsuite/schema/format-registry` subpath in `packages/schema/package.json`), which scans an imports map for `.class.json` values with a `format` block. Its only callers are `packages/schema/tests/format-registry.test.ts` and the `workspaceRegistry` helper in `packages/server/tests/refactor-apply.test.ts`. The module's other exports (`FormatEntry`, `FormatRegistry`, `EXTENSION_CAPABILITIES`, the capability and block types) are live and used by the extension registry, so only this one function is at stake.
- A different, still-live wrapper that is easy to confuse with it: `buildProjectFormatRegistry` in `packages/compiler/src/site/format-host.ts` is the formats view of the extensions-based registry, not the retired mechanism. Its `@deprecated` note says "the desktop app still imports this", which is stale: its only `src` caller is `packages/server/src/live-preview.ts`, and desktop names it only in a test mock (`packages/desktop/tests/handlers-gaps.test.ts`).
- Studio's file comment at the top of `packages/studio/src/format/format-host.ts`, which still says format classes "are auto-discovered server-side from the project imports map", and two doc comments beside it that say the same thing in passing (`formatByName`, "by its import name"; `noFormatError`, "no imported format class").
- Studio's user-facing error, `noFormatError` in `packages/studio/src/format/format-host.ts`, thrown from `files/files.ts` and `files/file-ops.ts` when a non-JSON file matches no format: `No format class imported for "<path>" — add one to project.json imports (e.g. "Markdown": "@jxsuite/parser/Markdown.class.json") …`. Following that advice changes nothing, because `buildProjectExtensionRegistry` never reads `imports`; the working fix is `"extensions": ["@jxsuite/parser"]`. Tests pin the text: `packages/studio/tests/files-diff-gaps.test.ts` (`toContain("No format class imported")`) and `packages/studio/tests/file-ops.test.ts` (`/No format class imported/`); comments quote it in `studio.ts`, `media/media-pane.ts`, `files/files.ts`, `tests/format-host-gaps.test.ts`, `tests/studio-shell.test.ts` and `tests/media-pane.test.ts`.
- The user docs already state the shipped rule: `docs/framework/site/content-collections.md` ("the name of a format class provided by an enabled extension", and `"extensions": ["@jxsuite/parser"]` for Markdown or CSV content) and `docs/framework/site/project-json.md` (`extensions` contributes format classes; `imports` maps a `$prototype` name). No docs page carries the retired sentence, and none anchors `imports.md#1.2`, `site-architecture.md#6.5` or `studio.md#8.1`.

**What is missing**

- imports.md §1.2 rewritten to what ships: format classes come from the extensions a project enables (extensions.md §3, extensions.md §4), not from `imports`; the example replaced with an `extensions` array; the three rules that still hold (only `.json` with no extension enabled, no implicit format defaults, page-level imports outside dispatch) restated in those terms. The heading stays, since docs `spec:` frontmatter and the implementation-status page name it; the detail phase decides whether the body reads better as a short pointer to extensions.md.
- site-architecture.md §6.5's second key rule rewritten to say `format` names a format class provided by an extension the project enables (extensions.md §3, extensions.md §4), with `"json"` still the only built-in; the rest of the list stands.
- studio.md §8.1's "built from the project-level `imports` map" replaced by the `extensions` source, and the same wording in §8.3 as an editorial ride-along: "`.md` with the `Markdown` class imported" and "Projects without format imports handle only `.json`" become the enabled-extension form. §8.3 carries no marker, so it is not claimed; it changes in the same edit so Studio's spec does not say both things.
- An editorial ride-along in imports.md §1.1, which `plan:imports/canvas-project-context` claims for the canvas's rebasing; only the example changes here. It maps `MyLayout` to `./layouts/main.json`, a path Pass 0 in `packages/runtime/src/runtime.ts` refuses with a warning (`import "<name>" must map to a .class.json path`), so the example contradicts the `$prototype` job this rewrite leaves `imports`.
- `noFormatError`'s message rewritten to name the working fix (enable an extension that provides the format in project.json `extensions`, for example `@jxsuite/parser`), and the two tests that match its text updated with it. The file comment and the two doc comments in `packages/studio/src/format/format-host.ts` corrected in the same change.
- One decision on `buildFormatRegistry`: delete it, which breaks a published subpath and so needs a `@jxsuite/schema` major or a deprecation release first, and moves `packages/server/tests/refactor-apply.test.ts`'s helper onto `buildProjectExtensionRegistry` or a hand-built `FormatRegistry` (adding `packages/server` to this plan's workspaces); or keep it and document it as a test utility that builds a registry from an explicit name-to-class map, with its doc comment no longer calling that map "an imports map". The `buildProjectFormatRegistry` note is corrected to name its real caller whichever way this goes, since the two are read together.

**Related**

- extensions.md §3 (the declaration model, and line 79's sentence that `imports` no longer registers formats), extensions.md §4 (the `jx-extension.json` manifest). §3's open item, whether a project-local `imports` entry wins on every resolution path, belongs to `plan:extensions/local-imports-precedence`; the §1.2 rewrite describes `imports`' `$prototype` job without restating that precedence, so the two cannot disagree.
- `plan:extensions/capability-timing-dispatch`, which may rewrite §8.1's next sentence (every `parse` and `serialize` round-tripped through `formatAction`) if Studio starts calling client capabilities in-process. This plan edits only the registry-source clause of §8.1, so either can land first.
- site-architecture.md §6.2 (collection shapes, already correct) and site-architecture.md §3.1 (the `imports` and `extensions` rows, already correct).
- parser.md §3 and parser.md §4 (the `Markdown` and `Csv` format classes the examples name).
- studio.md §4.2 ("Media is a mode because a media file is not a document"), which quotes the old `noFormatError` text as what a media file used to produce. It is past tense and stays true after the message changes, so it is not edited.
