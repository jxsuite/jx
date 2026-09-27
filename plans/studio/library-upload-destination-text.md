---
status: drafted
disposition: reconcile
claims:
  - studio.md#9.3
workspaces:
  - packages/studio
  - specs
size: S
---

# The Media Upload surfaces table names the Library, and what its All view asks, as Studio ships them

## Context

`specs/studio.md` §9.3, line 1069 (before the census the marker read Implemented and stopped after its second sentence; the census changed the status word and appended the last two sentences):

> **Status: Partial.** Adding media to a project is a direct gesture from wherever the author already is. Every surface funnels through one upload core (`packages/studio/src/files/media-upload.ts`); they differ only in how the destination directory is chosen. The core, collision suffixes, canvas drop semantics, transport and declared limits ship (`editor/file-drop-action.ts`). The Surfaces table's fourth row names a Manage view that no longer exists: the Library (`browse/library-pane.ts`) replaced it, and its All category asks for a folder, defaulting to `public`, rather than falling back to the context-aware destination (`resolveUploadDir`).

The Surfaces table (lines 1075 to 1080) has four rows. Re-verified against the working tree on 2026-09-27; paths under `packages/studio/src/`:

- **Media field** (row 1). Every caller of `uploadAssets` without a `dir` is context-aware: `ui/media-picker.ts` (`uploadAndAssign`), mounted by the properties panel for a prop whose `isMediaFormat` holds (`format: "image"` or `"uri-reference"`, `utils/studio-utils.ts`) and an attribute with `$input: "media"`, and by the frontmatter, head, state-default and grid-cell editors. The census missed a fifth caller: Search appearance's Icon and social Image rows upload through their own `uploadInto` (`panels/seo-modal.ts`), also context-aware and also writing the returned `ref` into the field. The row names only the first two triggers.
- **Canvas** (row 2): `editor/file-drop-action.ts` calls `uploadAssets(files)`. Holds.
- **Files tree** (row 3): `registerFileDropTarget` in `files/files.ts` targets the row for a folder, the parent for a file and `.` for the background; `uploadFilesToDir` and `pickAndUploadTo` pass that `dir`. **Upload Files…** is offered only in a folder's menu (`fileMenuRows`, `isDir`), not "its menu" on every row.
- **Manage view** (row 4) is stale. `browse/library-pane.ts` replaced it (its header says so); `uploadIntoLibrary` serves both the drop zone and the **Upload** control, and `resolveUploadDir` returns `uploadDirForCategory(libraryView.category)` (`browse/library-model.ts`, `LIBRARY_CATEGORIES`: Pages `pages`, Layouts `layouts`, Components `components`, Content `content`, Media `public`). All has no `dir`, so it opens `showPromptDialog("Upload files", …)` with the message "The All view has no folder of its own. Choose where these files land.", the value `public` pre-filled, and a refusal of an empty answer; cancelling returns `null` and uploads nothing. The control's tooltip names the destination before the drop (`uploadHint`: "Upload into public/" or "Upload — asks for a folder"). The Library tab has `documentPath: null` (`openLibraryTab` in `grid/grid-open.ts`), so the row's "falls back to context-aware" would always mean a silent `public`.

Everything else in §9.3 holds as the census recorded: the open path and Media mode paragraph (`media/media-open.ts`, `media/media-pane.ts`), destination and references (`uploadDirFor`, `assetRef`), never-overwrite (`uniqueName`), canvas drop semantics, transport (`packages/desktop/src/rpc-schema.ts` takes base64) and declared limits (`uploadAccept`, `maxUploadBytes` in `uploadAssets`).

**Stale code comments** in `files/media-upload.ts`: the header names "the Manage view's drop zone / Upload button (browse/browse)" among "Four surfaces"; `IMAGE_EXTENSIONS` says "Manage cards" (the Library's tiles call `isImage`, `browse/library-layouts.ts`); the invalidation note says "media-picker / Manage / file-tree caches" (`src/studio.ts` registers `invalidateMediaCache`, `invalidateLibrary` and `loadDirectory`); `uploadAssets` says "the Manage view's active category".

**Editorial ride-along** (assigned here by `plans/studio/README.md`): §9.4 line 1124 cites "the live-preview overlay (§9.2)"; the overlay is specified in §10.1 ("Unsaved documents travel as an overlay").

**Tests today**: `tests/library-pane.test.ts` ("the upload destination": the Media tooltip and `public`, All asks and returns the typed folder, a cancel uploads nothing, a drop under Media uploads into `public`) and `tests/library-model.test.ts` ("only All has no upload destination", asserting `all`, `media` and an unknown key). No test asserts All's pre-filled `public`, a drop under All, or the other four categories' folders.

## Outcome

- studio.md §9.3 → Implemented. The marker returns to its two opening sentences under `Implemented`; the Surfaces table names the Library in place of the Manage view, every media field that offers **Upload**, and the folder-only **Upload Files…** item.
- §9.4's overlay citation reads §10.1 (unmarked, editorial).
- `files/media-upload.ts`'s comments describe the five callers it has. No behaviour changes.

## Decisions

- **Decided:** reconcile the row to the Library's prompt rather than make All fall back to the context-aware destination, because the Library tab has no document path, so the fallback would always land in `public` without the author choosing it. `resolveUploadDir`'s own comment rejects exactly that as the surprise studio.md §16 refuses, and `docs/studio/projects/media.md` and `docs/studio/projects/browse.md` already document the prompt.
- **Open:** what the All prompt pre-fills. It ships as `public`; the alternative is the context-aware folder of the document last active in another pane (a Library beside a blog post would offer `content/posts/images`). Recommendation: keep `public`, because the Library is a project-wide surface and a pre-fill that changes with whichever pane was focused last is a destination the author cannot predict from the Library itself; the prompt already accepts any folder, and `public` is where §9.3's Destination paragraph sends everything that is not a collection entry.
- **Decided:** the Library row names each category's folder (`pages/`, `layouts/`, `components/`, `content/`, and `public/` for Media), because `LIBRARY_CATEGORIES` is the whole rule and a new `library-model.test.ts` case holds the list. Content means the `content/` root, not a collection's folder; choosing a collection is `plan:site-architecture/library-collection-views`'s change and extends this row.
- **Decided:** Search appearance's Icon and Image rows join row 1 rather than getting a row of their own, because the gesture (Upload beside the field), the destination (context-aware) and the result (the field takes the returned ref) are row 1's; only the drawing code differs. The row also gains `format: "uri-reference"`, which `isMediaFormat` treats as media.
- **Decided:** the marker loses the census's two appended sentences instead of keeping an evidence clause, because both describe the drift this plan removes and the section led with the two opening sentences alone before the census.
- **Decided:** fragment level `minor`, the program's level for a `reconcile`, not `major`: what an author sees does not change, and the published docs already describe it.

## Implementation

One pull request. Paths under `packages/studio/` unless they start with `specs/`.

1. `src/files/media-upload.ts`, comments only:
   - Header, first paragraph: "Five callers feed it: a media field's Upload button (`ui/media-picker`, and Search appearance's `panels/seo-modal`), a file dropped on the canvas (`editor/file-drop-action`), a file dropped on or uploaded into a Files tree folder (`files/files`), and the Library's drop zone and Upload control (`browse/library-pane`, whose `resolveUploadDir` asks when the All view names no folder)." The rest of the paragraph and the Destination paragraph stay.
   - `IMAGE_EXTENSIONS`: "(media picker, Library tiles, file-tree icons)".
   - `mediaChangedHandler`: "the media-picker / Library / file-tree caches".
   - `uploadAssets`: "(the file tree's target folder, the Library's category folder or the one its All view asked for)".
2. `tests/library-pane.test.ts`, in `describe("the upload destination")`, one case (below); import `topDialog` from `./harness` beside `answerPromptDialog`.
3. `tests/library-model.test.ts`, one case (below).
4. `specs/studio.md` §9.3 and §9.4, the fragment, and the deletion of this file, as under Specs & docs.

No other plan's code is touched. `browse/library-pane.ts` and `browse/library-model.ts` do not change.

**Integration contract.** Once this lands, `plan:site-architecture/library-collection-views` (which requires this plan) finds studio.md §9.3's Library row reading exactly as quoted under Specs & docs, a category-to-folder list it extends with a chosen collection's folder and a localized collection's prompt, and `media-upload.ts`'s header naming `resolveUploadDir` as the Library's destination chooser; a change that renames or moves that function updates the header in the same pull request. The All prompt's pre-fill is `public`, pinned by the new pane case.

## Tests

`bun test --isolate --coverage` from `packages/studio`; the DOM file already imports `./harness` first and the upload core is already a `mock.module()` double (`uploads`).

- `tests/library-pane.test.ts`, "a drop under All waits for a folder, offering public, and lands where the author confirms": `setLibraryCategory("all")`, mount, `dragEvent(body(), "drop", [testFile("shot.png")])`, flush; `uploads` is still `[]`; `topDialog()`'s `jx-textfield [part="input"]` reads `public`; dispatching `confirm` on the dialog without typing yields `uploads` equal to `[{ count: 1, dir: "public" }]`.
- `tests/library-model.test.ts`, "each category uploads into the folder studio.md §9.3 names": `LIBRARY_CATEGORIES.map((c) => [c.key, uploadDirForCategory(c.key)])` equals `[["all", undefined], ["pages", "pages"], ["layouts", "layouts"], ["components", "components"], ["content", "content"], ["media", "public"]]`.

No source file is added and none gains or loses a statement (the `media-upload.ts` edit is comments), so no per-file coverage figure moves and `coverageThreshold` in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) stays; the manifest check is unaffected.

## Specs & docs

`specs/studio.md`, in place:

- **§9.3 marker** becomes: `> **Status: Implemented.** Adding media to a project is a direct gesture from wherever the author already is. Every surface funnels through one upload core (`packages/studio/src/files/media-upload.ts`); they differ only in how the destination directory is chosen.`
- **Surfaces table**, three rows rewritten (the Canvas row is unchanged; reformat the table with `bun run format:md` or oxfmt so the columns align):
  - Row 1: Surface "A media field: an image prop (`format: "image"` or `"uri-reference"`), a `$input: "media"` attribute, and Search appearance's Icon and Image"; Gesture "**Upload** button beside the field"; Destination "Context-aware (below); the field takes the new ref".
  - Row 3: Gesture "Drop on a row, or **Upload Files…** in a folder's menu"; Surface and Destination unchanged.
  - Row 4: Surface "Library (§9.1.2)"; Gesture "Drop anywhere on it, or its **Upload** control"; Destination "The active category's folder (`pages/`, `layouts/`, `components/`, `content/`, and `public/` for Media), named on the **Upload** control before the drop. All has none, so it asks, with `public` pre-filled; cancelling uploads nothing".
- **§9.4**, "One serialization, every reader.": "the live-preview overlay (§9.2)" becomes "the live-preview overlay (§10.1)".
- No heading is renumbered or retitled; §9.3's Destination, Canvas drop, Transport and Declared limits subsections are unchanged.

**Fragment:** `bun run spec:change studio.md minor -m "§9.3 names the Library in place of the retired Manage view: an upload lands in the active category's folder, and All asks for one with public pre-filled; the media-field row names every field that offers Upload, Upload Files is a folder's menu item, and §9.4 cites §10.1 for the live-preview overlay."`

**Docs:** none changes, and the pull request says so. `docs/studio/projects/media.md` cites `studio.md#9.3` and lists `media-upload.ts`, `library-model.ts` and `library-pane.ts` in `code:`; its "Upload from an image field", "Drag into the Files panel" and "Drag into the Library" sections already describe every rewritten row (Search appearance's Icon and social image, **Upload Files…** on a folder, the category folders, All's dialog "with `public` filled in"). `docs/studio/projects/browse.md` ("Upload media") lists `library-model.ts` and `library-pane.ts` and already says All asks. No page's `spec:` cites §9.4 differently because of the citation fix (`settings.md` and `interface/tabs.md` cite `studio.md#9.4` as a whole).

studio.md does not graduate here: other studio.md items stay open, so `plans/studio/` stays.

## Acceptance

- `sed -n '/^### 9.3 /,/^### 9.4 /p' specs/studio.md | grep -c "Status: Partial\|Manage view"` prints 0, and `grep -n "overlay (§9.2)" specs/studio.md` prints nothing.
- `grep -n "Manage" packages/studio/src/files/media-upload.ts` prints nothing.
- `bun run plans:status --who-claims studio.md#9.3` names no plan; `bun run plans:check --audit studio` reports nothing for studio.md §9.3.
- `ls specs/changes/studio-*.md` includes the new fragment, and `bun run spec:release --dry` mints a studio.md minor.
- `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links` and `bun run docs:markdown` pass.
- From `packages/studio`: `bun test --isolate --coverage tests/library-pane.test.ts tests/library-model.test.ts` passes, and the full `bun test --isolate --coverage` keeps every file above `coverageThreshold`.
- In Studio: ⌘⇧E, choose All, drop an image on the Library; a dialog titled "Upload files" opens with `public` in its field and nothing uploads until **Upload** is pressed.
