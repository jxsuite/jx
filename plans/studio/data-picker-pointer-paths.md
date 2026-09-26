---
status: stub
disposition: implement
claims:
  - studio.md#6.8
size: M
workspaces:
  - packages/studio
---

# The From data picker writes every pointer it offers correctly, and can reach into a signal's value

## Context

`specs/studio.md` §6.8, line 726 (the census kept the section Partial and made the marker specific):

> **Status: Partial.** The picker lists the document's top-level state signals and writes `#/state/<name>` verbatim (`packages/studio/src/panels/properties-panel.ts`, `panels/events-panel.ts`, `ui/schema-form.ts`, `ui/dynamic-slot.ts`, `ui/expression-editor.ts`), so it cannot address a path into a signal's value. Nothing in Studio calls `escapeToken`, so a signal named `a/b` is listed and written as `#/state/a/b`, which reads back as `a` then `b` and breaks rule 1 below rather than being merely unreachable; a dotted name already round-trips, so that row's ❌ is stale.

The marker used to say an unconstructible pointer is "simply unreachable". The census found one that is constructed wrong: renaming accepts any non-empty unique name, so a slash in a signal name is reachable, and the picker writes a pointer that resolves to a different place. That is the defect rule 1 forbids, and it is the first thing this plan fixes.

**What exists**

- The writers of an unescaped `` `#/state/${name}` ``, as `grep -rn '#/state/\${' packages/studio/src` lists them at the census (fifteen sites in eight files); the detail phase re-runs that grep rather than trusting this list:
  - the From data rung's offers: `packages/studio/src/panels/properties-panel.ts` (the Content tab), `src/panels/events-panel.ts` (`refOptions`, the Logic tab's value sources, plus its function refs), `src/ui/schema-form.ts`, `src/ui/dynamic-slot.ts`, `src/ui/expression-editor.ts`;
  - refs Studio writes on the author's behalf: `src/panels/signals-panel.ts` (a computed signal's `$deps`, built from `$identifier` matches, so it cannot meet a `/` today but should go through the same helper), `src/editor/convert-to-repeater.ts`, `src/ui/formula-catalog.ts`.
- `escapeToken`, `refSegments` and `readPath` in `packages/runtime/src/pointer.ts`; the runtime resolves a `#/state/` ref through `readPath`, which splits on `/` and unescapes each token, so `#/state/a~1b` already reads the signal `a/b`.
- The Content tab reads a ref back with `slice(8)`, and a deep ref's root with `slice(8).split("/")[0]` (`packages/studio/src/panels/properties-panel.ts`, around lines 215 and 233), so neither decodes an escaped token.

**What is missing**

- Every writer building its segments with `escapeToken`, and every reader decoding with the runtime's parser, so a name containing `/` or `~` round-trips; one shared helper rather than a template string per site.
- A path-aware picker that walks into a signal's resolved value (the Data panel already renders it as a tree) and writes `#/state/<signal>/<key>/…`, and a chip that reads such a ref back as that path.
- §6.8's table corrected in the same change: the dotted-name row is already ✅, and the other two flip when this lands.

**Related**

- spec.md §7.1 (JSON Pointer refs), studio.md §6.6 (the value-source ladder, rule 2), studio.md §5.6 (the Data panel's resolved-value tree).
