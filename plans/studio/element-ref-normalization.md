---
status: drafted
disposition: implement
claims:
  - studio.md#9.1.3
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: S
---

# Studio recognises an imported component however its `$ref` is spelled, and every writer of `$elements` goes through the one service

## Context

`specs/studio.md` §9.1.3 (heading line 1028, marker line 1030):

> **Status: Partial.** The one service ships and every surface goes through it (`hasElement`, `enableElement` and `disableElement` in `packages/studio/src/files/elements.ts`), with the package-subpath and uninstall rules below. Paths are not quite compared resolved: the wanted side is computed relative to the document, but an authored `$ref` only has leading `./` segments stripped (`normalizeRef`), so a ref with an interior `.` or `..` segment (`./x/../card.json`) does not match the component it names.

The section's first bullet (line 1034) ends "Paths are compared resolved", and its service paragraph (line 1032) says "every surface that changes it goes through them". Neither holds yet.

**What exists** (verified against the tree on 2026-09-27)

- `packages/studio/src/files/elements.ts`: `hasElement` and `disableElement` compare `normalizeRef(computeRelativePath(fromPath, comp.path))` with `normalizeRef(entry.$ref)`. `normalizeRef` is `ref.replace(/^(?:\.\/)+/, "")`. `removeElementRef(elements, ref)` compares `normalizeRef` of both refs and has no `fromPath`. `enableElement` appends `elementsEntryFor(comp, fromPath)` unless `hasElement` says the component is already there.
- `computeRelativePath` in `packages/studio/src/files/components.ts` is the writer's spelling: `./` or a run of `../`, then the remaining segments, with backslashes folded.
- Callers: the canvas drop (`enableElement` in `packages/studio/src/panels/dnd.ts`), the Packages panel (`hasElement`, `enableElement`, `disableElement` and `removeElementRef` in `packages/studio/src/panels/imports-panel.ts`; `onRemoveRef` passes only the row's ref).
- Tests: `packages/studio/tests/elements-service.test.ts`, the auto-import cases in `packages/studio/tests/dnd-gaps.test.ts`, the "document-level imports" cases in `packages/studio/tests/imports-panel.test.ts`, and one `disableElement` case in `packages/studio/tests/files-diff-gaps.test.ts`.

A hand- or tool-written ref therefore escapes the comparison. `./x/../../components/card.json` in `pages/index.json` names `components/card.json`, but `hasElement` says "not imported", a drop appends `../components/card.json` beside it, and `disableElement` leaves it behind. Normalising the ref lexically, as the stub proposed, is not enough. From `pages/index.json`, `../pages/card.json` and `./card.json` name one file but stay different strings, because the `..` cancels a directory the ref never spelled.

**Found while detailing**

- **A fifth writer bypasses the service.** `convertToComponent` in `packages/studio/src/editor/convert-to-component.ts` builds the ref with `computeRelativePath` and adds it unless an entry's `$ref === refPath`. That is its own rule. Convert to Component already refuses a name the registry holds, so a doubled entry needs a dangling ref that is spelled differently. Even so, the marker's "every surface goes through it" is untrue while this rule exists.
- **The picker's option list has its own rule too.** `documentView` in `imports-panel.ts` drops a component only when a ref equals `./${comp.path}` or `comp.path`, so a page outside the root is offered what it already imports. `plan:imports/packages-panel-section` owns that fix (a `hasElement` filter, and rewriting the `imports-panel.test.ts` fixture that hides the bug). This plan does not repeat it.
- Two render-time composers answer a similar question by exact string: `getEffectiveElements` in `packages/studio/src/site-context.ts` and the component auto-discovery in `packages/studio/src/canvas/canvas-live-render.ts`. Neither writes a document, and the runtime registers a tag only once (`customElements.get` in `registerElements`, `packages/runtime/src/runtime.ts`). A duplicate there costs a fetch and nothing else.

## Outcome

studio.md §9.1.3 → Implemented. Every local `$elements` comparison resolves both sides to the project path they name. A differently spelled import of the same file is recognised, never duplicated, and removed along with the others. All five writers (the drop, the checkboxes, the picker, the ×, Convert to Component) go through `packages/studio/src/files/elements.ts`.

## Decisions

- **Decided:** compare project paths, not normalised refs. The component side is its own registry `path`. The entry side is its `$ref` joined to the importing document's directory, with `.`, `..`, empty segments and backslashes resolved. This is the only form in which `../pages/card.json` and `./card.json` from `pages/` agree. `computeRelativePath` stays the writer's spelling (`elementsEntryFor`) and leaves the comparison.
- **Decided:** a ref that names no file in the project resolves to nothing. That covers a ref that climbs above the project root, starts with `/`, or carries a URL scheme. Such a ref never matches a component, and `removeElementRef` removes it only by its exact spelling. This is today's behaviour for all three. The host decides what `/` means (the dev server, the desktop asset space and a deployed site each differ), and a URL clamp such as `new URL` applies would claim an outside file as a project file. Percent escapes, queries and fragments are compared as spelled, because Studio never writes any of them and the comparison should not guess.
- **Decided:** an existing spelling is never rewritten. `enableElement` leaves the list unchanged when any spelling already imports the component, and `disableElement` and `removeElementRef` remove every spelling. The list is the author's, so a silent respelling would be a diff nobody asked for. Removing one spelling while another survives would leave the component imported, and the × would seem to do nothing.
- **Decided:** `removeElementRef` takes the importing document's path, as the other three functions do. Two spellings of one file can be told apart only against the directory both are read from. Its one caller passes `ctx.documentPath`.
- **Decided:** Convert to Component writes through `enableElement` with the entry `{ path: componentFile, tagName: name }`, because §9.1.3 says every surface that changes the list goes through the service. The entry satisfies `ComponentEntry` without a cast.
- **Decided:** the picker's option list stays with `plan:imports/packages-panel-section`, and the render-time composers stay unchanged. Neither plan requires the other: each is correct alone, and once both land the picker reads this comparison through `hasElement`.

## Implementation

1. `packages/studio/src/files/elements.ts`
   - Replace `normalizeRef` with a private `projectPathOf(ref: string, fromPath: string | null): string | null`. Its docblock: the project path a `$ref` names when read from the document at `fromPath` (project-relative, `null` meaning the project root), or `null` when it names no file in the project.
     - Fold `\` to `/`.
     - Return `null` for a leading `/` or a match of `/^[a-z][a-z\d+.-]*:/i`.
     - Start from `fromPath`'s directory: `(fromPath ?? "").replaceAll("\\", "/").split("/").slice(0, -1)`.
     - Walk the ref's segments after it. Skip `""` and `"."`. Pop on `".."`, and return `null` when there is nothing to pop. Push anything else.
     - Return the joined path, or `null` when it is empty.
   - `hasElement`: `const wanted = projectPathOf(comp.path, null)`. The result is true when `wanted` is non-null and some entry's `refOf` is non-null with `projectPathOf(ref, fromPath) === wanted`. Rewrite the docblock's local-component bullet to say that both sides are resolved to a project path.
   - `disableElement`: return `[...elements]` when `wanted` is `null`. Otherwise filter out every entry that resolves to `wanted`.
   - `removeElementRef(elements, ref, fromPath: string | null)`: `const wanted = projectPathOf(ref, fromPath)`. Keep every non-ref entry. Drop a ref entry when `wanted === null ? found === ref : projectPathOf(found, fromPath) === wanted`. The docblock says it removes every entry naming the same file.
   - `enableElement` and `elementsEntryFor` are unchanged. The `computeRelativePath` import stays, for `elementsEntryFor`.
2. `packages/studio/src/panels/imports-panel.ts`, `onRemoveRef`: pass `ctx.documentPath` as the third argument. Nothing else in this file changes: `documentView` is `plan:imports/packages-panel-section`'s.
3. `packages/studio/src/editor/convert-to-component.ts`, `convertToComponent`:
   - Delete `refPath` and the `alreadyReferenced` / `push` block.
   - Inside the same `transact` callback, write `doc.$elements = enableElement((doc.$elements ?? []) as ElementsEntry[], { path: componentFile, tagName: name }, tab.documentPath ?? null) as (string | JxElement)[]`.
   - Drop `computeRelativePath` from the `../files/components` import. Add `enableElement` and `type ElementsEntry` from `../files/elements`, and `type JxElement` from `@jxsuite/schema/types`.
   - Update the "Single atomic mutation" comment to say that the reference goes through the one `$elements` service (studio.md §9.1.3).
4. Unchanged: `components.ts`, `dnd.ts`, `site-context.ts`, `canvas-live-render.ts`, and the runtime.

**Integration contract.** `hasElement(elements, comp, fromPath)`, `enableElement` and `disableElement` keep their signatures. `removeElementRef` gains a required third parameter, `fromPath: string | null`. A local component matches every entry whose `$ref`, read from `fromPath`'s directory, names its registry `path`. A ref outside the project matches no component. No entry is ever respelled. `plan:desktop/component-scope-sections` (Active sections through `hasElement`) and `plan:imports/packages-panel-section` (picker options through `hasElement`) get these spellings without any change, and neither requires this plan. `plan:spec/cem-manifest-export` also edits `convert-to-component.ts`'s import block, so whichever lands second rebases that block. No plan requires this one.

## Tests

Run `bun test --isolate --coverage` from `packages/studio`.

- `tests/elements-service.test.ts`
  - `describe("already imported?")`:
    - A new `test.each` "a ref spelled %s from pages/index.md names components/card.json", with the rows `../components/./card.json`, `./../components/card.json`, `../x/../components/card.json`, `..//components/card.json`, `..\\components\\card.json` and `./x/../../components/card.json`. Each asserts that `hasElement` is true for `local("components/card.json")`.
    - A new "a ref that leaves the document's directory and returns names the same file": `../pages/card.json` from `pages/index.md` matches `local("pages/card.json")`. This is the case lexical normalisation misses.
    - A new `test.each` "a ref outside the project, %s, names no component": `../../components/card.json` from `pages/index.md`, `../components/card.json` from `null`, `/components/card.json`, and `https://cdn.example/components/card.json`. Each asserts that `hasElement` is false for `local("components/card.json")`.
  - `describe("enableElement")`: a new "a component imported under another spelling is not added again, and that spelling is kept": the list `[{ $ref: "./x/../../components/card.json" }]` from `pages/index.md` comes back equal to itself.
  - `describe("disableElement")`: a new "removes every spelling of the file, and nothing else": from `pages/index.md`, four spellings of `components/card.json` plus `../vendor/card.json` and `"@acme/ui"` leave the last two.
  - `describe("removeElementRef")`:
    - Pass `null` in the existing case.
    - A new "takes every entry naming the same file from the document's directory": `./card.json`, `../pages/card.json` and `../components/card.json` from `pages/index.md`. Removing `../pages/card.json` leaves only `../components/card.json`.
    - A new "a ref outside the project is removed by its own spelling only", from `pages/index.md`: removing `/components/card.json` from `[{ $ref: "/components/card.json" }, { $ref: "../components/card.json" }]` keeps the second. Removing `../../x.json` keeps `../../y/../x.json`.
- `tests/dnd-gaps.test.ts`: a new "a local component imported under another spelling is not imported again", beside "a local component already imported by the same ref is not duplicated". `pages/index.json` holds `[{ $ref: "./parts/../../components/card.json" }]`, and after dropping `<my-card>` the list is unchanged.
- `tests/imports-panel.test.ts`, `describe("document-level imports")`: a new "the × removes every spelling of the file it names". The test sets its own `$elements`, `[{ $ref: "../components/hero.json" }, { $ref: "../pages/../components/hero.json" }, "@acme/kit/button.js"]`, so it is independent of the fixture rewrite in `plan:imports/packages-panel-section`. Clicking the first row's remove leaves `["@acme/kit/button.js"]`.
- `tests/convert-to-component.test.ts`, `describe("conversion")`: a new "a differently spelled reference to the new component is not doubled", next to "converting a second time does not duplicate the $ref". The seed is `[{ $ref: "./../components/hero-block.json" }]`, and after conversion the list equals the seed.

Coverage: the per-file thresholds in `packages/studio/bunfig.toml` (`lines = 0.958`, `functions = 0.941`) hold. `projectPathOf` replaces `normalizeRef`, so the function count is unchanged, and the cases above reach every branch. None of `elements.ts`, `imports-panel.ts` or `convert-to-component.ts` is the workspace's worst file, so there is no ratchet. No source file is added, so the manifest check needs nothing.

## Specs & docs

- **studio.md §9.1.3 marker** (line 1030): replace it with

  > **Status: Implemented.** One service writes every `$elements` list (`hasElement`, `enableElement`, `disableElement` and `removeElementRef` in `packages/studio/src/files/elements.ts`), and each surface that changes one goes through it: the canvas drop (`packages/studio/src/panels/dnd.ts`), the Packages panel (`packages/studio/src/panels/imports-panel.ts`) and Convert to Component (`packages/studio/src/editor/convert-to-component.ts`). A local import is compared by the project path its `$ref` names.

- **The service paragraph** (line 1032): "`enableElement` and `disableElement` return the new list" becomes "`enableElement`, `disableElement` and `removeElementRef` (the × on one import) return the new list".
- **The first bullet** (line 1034): "Paths are compared resolved." becomes "Paths are compared resolved: a `$ref` is read from the importing document's directory to the project path it names, so `./x/../card.json`, `.\card.json` and `./card.json` are one file, and a ref that names no file in the project (one that climbs above the project root, starts with `/`, or is a URL) is never taken for a component and is removed only by its own spelling."
- **The closing paragraph** (line 1039) gains a last sentence: "Nor do they respell an entry: enabling a component the list already imports under another spelling leaves the list as it is, and disabling or removing it takes every spelling."
- **Fragment:** `bun run spec:change studio.md minor -m "§9.1.3 an authored component reference is compared by the project path it resolves to from the importing document, removing an import takes every spelling of it, and Convert to Component writes through the one service."`
- **`docs/studio/projects/dependencies.md`** (its `code:` lists `imports-panel.ts`):
  - Line 30: "The × beside an entry removes the import." becomes "The × beside an entry removes the import, along with any other entry that names the same file."
  - Line 32: "Importing the same component twice never adds a second entry, and two components …" becomes "Importing the same component twice never adds a second entry, even when the first one writes the path differently, and two components …".
  - `plan:imports/packages-panel-section` rewrites the first sentence of line 32, so whichever plan lands second rebases that line. Keep both edits free of em dashes.
- **`docs/studio/design/components.md`** (its `code:` lists `convert-to-component.ts`): no change. Its line 59 ("converting also records a reference to it in the page's `$elements` list") stays true.
- No docs page's `spec:` cites `studio.md#9.1.3`. imports.md §5.1's "deduplicated by resolved `$ref`" becomes true without an edit, and `plan:imports/packages-panel-section` owns that section.
- The spec does not graduate, because studio.md keeps other open items with their own plans. The landing pull request deletes this file.

## Acceptance

- `cd packages/studio && bun test --isolate --coverage` is green with the new cases, and no file falls below its threshold. `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `bun run typecheck` and `bun run lint` are clean. `grep -rn "normalizeRef\|alreadyReferenced" packages/studio/src` finds nothing.
- `bun run plans:status --spec studio` no longer lists §9.1.3. `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:prose` and `bun run docs:links` pass. `bun run docs:sync` names `dependencies.md` and `components.md`: the first is in the diff, and the second is stated above as needing no update.
- By hand, under `bun run dev`, in a project with `components/card.json` (tag `my-card`):
  1. Open `pages/index.json` and set its `$elements` in source mode to `[{ "$ref": "./x/../../components/card.json" }]`.
  2. Drag `<my-card>` from the Insert panel onto the canvas. `$elements` is unchanged.
  3. In the Packages panel, the × on that row empties the list.
