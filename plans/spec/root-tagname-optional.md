---
status: stub
disposition: reconcile
claims:
  - spec.md#3.1
size: S
---

# The root field table says what the code does: a document's root `tagName` is optional and defaults to `div`

## Context

`specs/spec.md` §3.1, line 107:

> **Status: Partial.** Every field matches the code except `tagName`, which the table marks Required at the root. Neither the generated root schema (`packages/schema/schema.json`) nor any per-project `document.schema.json` requires it, the runtime's `resolveTagName` renders a missing tag as `div`, and page documents omit it (`sites/test-blank/pages/contact.json`); only an element node requires `tagName` (`packages/schema/defs/element-def.schema.ts`).

**What exists**

- `packages/schema/src/schema.ts` `generateSchema` emits the root document schema with no `required` list; `examples/document.schema.json` and every other composed `document.schema.json` inherit that.
- `packages/runtime/src/runtime.ts` `resolveTagName` returns `div` for a missing or non-expression tag.
- `packages/schema/defs/element-def.schema.ts` has `required: ["tagName"]` for element nodes only.
- Real pages omit a root tag: `sites/test-blank/pages/contact.json`, `projects.json`. A layout supplies the page's outer element.

**What is missing**

- The field table's `Required` for `tagName`. The code is right: a page document is rendered into a layout and has no tag of its own to name, and making the field required would invalidate every such page. The table should say `Optional` for a page and state that a custom-element definition (§16.1) needs a hyphenated `tagName` to be one. Disposition is `reconcile`.

**Related**

- §16.1 (a definition is a document whose root `tagName` contains a hyphen), §19.6 (the root `tagName` stays literal).
- `schema.md` §3 (schema coverage of the root document).
