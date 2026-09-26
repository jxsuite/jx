---
status: stub
disposition: implement
claims:
  - studio-ui-guidelines.md#2.3
size: S
workspaces:
  - packages/studio
---

# Generated labels keep abbreviations uppercase and name framework keys as the guidelines do

## Context

`specs/studio-ui-guidelines.md` §2.3, line 105:

> **Status: Partial.** Title Case through `camelToLabel()` ships (`packages/studio/src/utils/studio-utils.ts`). The helpers do not keep abbreviations uppercase (`camelToLabel("url")` gives "Url"), and `$prototype` is labelled "Kind", not "Prototype" (`src/panels/signals-panel.ts`).

**What exists**

- `camelToLabel()` in `packages/studio/src/utils/studio-utils.ts` (a regex that splits on capitals and uppercases the first letter), tested in `tests/studio-utils.test.ts`. `imageURL` becomes "Image U R L", and the attribute-label helper turns `aria-label` into "Aria Label".
- Hand-written labels where uppercase matters, e.g. "URL" in `src/panels/signals-panel.ts`.
- `$src` and `$export` labelled "Source" and "Export"; `$prototype` labelled "Kind" (`signals-panel.ts`, the `textField(name, "kind", "Kind", …)` row).

**What is missing**

- An abbreviation-aware label helper (a runs-of-capitals rule plus a small known-abbreviation set: URL, CSS, ID, ARIA, and so on) used by every generated label, with tests for the cases above.
- A decision on `$prototype`: relabel it "Prototype" as the section says, or keep "Kind" (arguably the clearer word for an author) and reconcile that one bullet. Detailing records which.
- The helper's path in the section corrected (`studio-utils.ts`, not `studio-utils.js`).

**Related**

- `studio.md` §6.1 (Property Panel), whose rows these labels title.
