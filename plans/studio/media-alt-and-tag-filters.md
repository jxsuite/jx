---
status: stub
disposition: implement
claims:
  - studio.md#22.6
size: M
---

# Media filters files by missing alt text and by tag, over a per-file record that holds both

## Context

studio.md §22.6's second marker (split out of the workspace redesign, whose other Media items shipped):

> **Status: Pending.** Two filters are not part of the first build, because each needs a store that does not exist: **Missing alt text** (alt text is written per use, on the element, and no per-file alt record exists to filter by), and **tags** (no per-file tag store). Neither is drawn until its store exists; a filter that cannot be answered is not shipped as one that always answers nothing.

What ships: `MEDIA_FILTERS` in `packages/studio/src/media/media-library-model.ts` lists All media, the five kinds and Unused; Unused is answered lazily through the usage index (`media-usage`), and the module's header states the rule this plan must keep: a filter whose question cannot be answered is not drawn.

What is missing is the store, and both filters need the same one: a per-file media record (alt text as the file's default, tags) that survives rename and Replace (§9.3 overwrites the same path) and is readable on every backend. Where it lives is the first decision for detailing: a sidecar per file, one project-level index under `public/media/`, or a `project.json` section, each with different answers for collaboration, git diffs and a file moved outside Studio. "Missing alt text" then also has to say whether a per-use `alt` on every element that shows the file satisfies it when the file has no default.
