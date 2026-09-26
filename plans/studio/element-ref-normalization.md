---
status: stub
disposition: implement
claims:
  - studio.md#9.1.3
size: S
workspaces:
  - packages/studio
---

# Importing a component matches an authored reference however its path is spelled

## Context

`specs/studio.md` §9.1.3, line 1022 (the section was unmarked before the census; the first audit pass recorded the gap in its Verified entry and left it open without a plan):

> **Status: Partial.** The one service ships and every surface goes through it (`hasElement`, `enableElement` and `disableElement` in `packages/studio/src/files/elements.ts`), with the package-subpath and uninstall rules below. Paths are not quite compared resolved: the wanted side is computed relative to the document, but an authored `$ref` only has leading `./` segments stripped (`normalizeRef`), so a ref with an interior `.` or `..` segment (`./x/../card.json`) does not match the component it names.

Disposition `implement`. The section's first bullet ends "Paths are compared resolved", and the code compares one resolved side against one merely trimmed side. Refs Studio writes are canonical (`computeRelativePath` emits `./` or a run of `../` and then the remaining segments), so the miss needs a hand-written or tool-written ref, but the consequence is the one the bullet was written to end: `hasElement` says "not imported", and `enableElement` appends a second entry for the same file, while `disableElement` and `removeElementRef` leave the non-canonical one behind.

**What exists**

- `normalizeRef` in `packages/studio/src/files/elements.ts` (`ref.replace(/^(?:\.\/)+/, "")`), used by `hasElement`, `disableElement` and `removeElementRef`.
- `computeRelativePath` in `packages/studio/src/files/components.ts`: the document-relative path to a component, with backslashes folded to `/`.
- `packages/studio/tests/elements-service.test.ts`.

**What is missing**

- `normalizeRef` resolving `.` and `..` segments (and folding backslashes, as `computeRelativePath` does) so both sides of every comparison are in one canonical form; a ref that climbs above the project root compares as written.
- Cases in `elements-service.test.ts` for an interior `..`, an interior `./`, and a backslash spelling, each matched by `hasElement` and removed by `disableElement`.

**Related**

- studio.md §9.1 (project state), spec.md §7.1 (`$ref` syntax), imports.md §5 (the Studio Imports panel, whose per-row removal uses `removeElementRef`).
