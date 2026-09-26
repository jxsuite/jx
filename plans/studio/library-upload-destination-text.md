---
status: stub
disposition: reconcile
claims:
  - studio.md#9.3
size: S
---

# The Media Upload surfaces table names the Library and what its All view asks

## Context

`specs/studio.md` §9.3, line 1061 (before the census the section led with Implemented; the census changed that marker's status word to Partial and appended what ships and what is stale, leaving its two opening sentences as they were):

> **Status: Partial.** Adding media to a project is a direct gesture from wherever the author already is. Every surface funnels through one upload core (`packages/studio/src/files/media-upload.ts`); they differ only in how the destination directory is chosen. The core, collision suffixes, canvas drop semantics, transport and declared limits ship (`editor/file-drop-action.ts`). The Surfaces table's fourth row names a Manage view that no longer exists: the Library (`browse/library-pane.ts`) replaced it, and its All category asks for a folder, defaulting to `public`, rather than falling back to the context-aware destination (`resolveUploadDir`).

Disposition `reconcile`. The Library has no active document to be context-aware about, so its All view has no folder of its own, and asking with `public` pre-filled is the honest answer; the code comment on `resolveUploadDir` says so. The spec row predates the Library.

**What exists**

- `resolveUploadDir` and `uploadIntoLibrary` in `packages/studio/src/browse/library-pane.ts`: a category's own directory, else a prompt ("The All view has no folder of its own") defaulting to `public`.
- One upload core, `packages/studio/src/files/media-upload.ts`, whose header still names "browse/browse" and "the Manage view".
- Tests: `packages/studio/tests/media-upload.test.ts`, `tests/file-drop-action.test.ts`, `tests/media-pane.test.ts`.

**What is missing**

- The fourth Surfaces row rewritten for the Library: drop anywhere or the Upload button, the active category's directory, and for All a folder prompt defaulting to `public`.
- The stale header comment in `media-upload.ts` corrected in the same change.
- Editorial ride-along: §9.4's "the live-preview overlay (§9.2)" should cite §10.1, where the overlay is specified.

**Related**

- studio.md §9.1.2 (the Library), studio.md §4.2 (the Media mode), site-architecture.md §9.3 (where media lands and how it is referenced), site-architecture.md §9.4 (the media browser).
