---
status: stub
disposition: implement
claims:
  - spec.md#16.8
requires:
  - studio/cem-contract-editors
size: M
workspaces:
  - packages/studio
  - packages/compiler
---

# A project's custom elements export as one Custom Elements Manifest, from Studio and from the build

## Context

`specs/spec.md` §16.8, line 1763 (the census kept Partial and corrected the sentence: the generator exists, but nothing calls it; a forward from the `studio.md` census narrowed "Studio's CEM editors" to the ones that exist):

> **Status: Partial.** The schema fields ship, and Studio edits `parameters`, `emits` and a typed entry's `attribute` and `reflects` (`packages/studio/src/panels/signals-panel.ts`), but nothing in `packages/studio/src` reads or writes the root `observedAttributes` array (studio.md §6.5). A per-document CEM 2.1.0 generator exists (`exportCemManifest` in `packages/studio/src/services/cem-export.ts`), but nothing calls it (`studio.ts` imports it as `_exportCemManifest`), no build emits a project `custom-elements.json`, and the generator maps only typed state entries carrying `attribute` into CEM `attributes`, not `observedAttributes`.

**What exists**

- Schema fields: `attribute`, `reflects` (`packages/schema/defs/typed-state-def.schema.ts`), `parameters`, `emits` (`packages/schema/defs/function-def.schema.ts`), `observedAttributes`.
- Studio's Parameters and Emits editors, and the Data panel's per-entry `attribute` and `reflects` fields (`packages/studio/src/panels/signals-panel.ts`). There is no `observedAttributes` editor: `grep -rn observedAttributes packages/studio/src` finds nothing, which is `studio.md` §6.5's **Pending** "Observed attributes" cell.
- `exportCemManifest` in `packages/studio/src/services/cem-export.ts`, with a test; `#`-private entries are excluded (§5.6).

**What is missing**

- A project-level manifest: one `custom-elements.json` over every definition, written by `jx build` (and offered by a Studio command), with the generator moved where both can import it.
- `observedAttributes` mapped into CEM `attributes`, alongside typed entries carrying `attribute`. How the two relate (whether declaring `attribute` on an entry adds it to `observedAttributes`, and so which list the manifest dedupes against) is decided by `plan:studio/cem-contract-editors`, which owns the Studio editor for the root array; this plan consumes that decision and requires the plan.
- Deciding whether the manifest ships in `dist/` or the project root, and referencing it from `package.json` `customElements` for published component libraries.

**Related**

- §5.6 (private state is never extracted), §16.5, `studio.md` §6.5 (the CEM annotations editor, `plan:studio/cem-contract-editors`).
