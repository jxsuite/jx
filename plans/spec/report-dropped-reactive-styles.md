---
status: stub
disposition: implement
claims:
  - spec.md#9.3
size: S
workspaces:
  - packages/compiler
  - packages/site
  - packages/schema
---

# A static build reports each reactive declaration it drops, and the project schema refuses one

## Context

`specs/spec.md` §9.3, line 998:

> **Status: Partial.** Extraction into one head `<style>` block ships (`compileStyles`, `pushStyleRules` in `packages/compiler/src/shared.ts`). The report does not: `takeDroppedReactiveStyles` has no production caller, so no build prints what it dropped, and where a build-time scope exists the compiler inlines the resolved template instead of dropping it (§9.1). And the project schema's `StyleObject` (`staticStyleObjectSchema` in `packages/schema/src/schema.ts`) accepts any string value, so it still admits a `${…}` template the paragraph below says it cannot carry.

**What exists**

- `recordDroppedReactive` and `takeDroppedReactiveStyles` in `packages/compiler/src/shared.ts`, unit-tested in `packages/compiler/tests/shared.test.ts` and `project-style-delegation.test.ts`.
- `packages/site/src/site-style.ts` names the report in a comment only.
- `staticStyleObjectSchema` admits `{ type: "string" }` for every declaration.

**What is missing**

- A caller: `buildSite` (and the single-page compile CLI) drains `takeDroppedReactiveStyles` and prints each dropped declaration by property, source and selector.
- The project schema refuses a `${…}` value (a string `not` pattern on declarations), so `jx validate` catches it before a build does.
- Agreement with §9.1: once resolved declarations become rules, the recorder's "only the stylesheet path" limitation is what remains to state or fix.

**Related**

- §9.1 (`plan:spec/static-style-rules-only`), §9.5 (the project `style` block), `site-architecture.md` (the site stylesheet).
