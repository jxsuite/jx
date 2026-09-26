---
status: stub
disposition: implement
claims:
  - site-architecture.md#7.4
size: M
workspaces:
  - packages/studio
---

# The entry editor draws the widget §7.4's table names for every schema type

## Context

`specs/site-architecture.md` §7.4, line 865 (the Frontmatter Form marker, which leads the section):

> **Status: Partial.** A content entry belonging to a collection with a schema opens the **entry editor**, a schema-driven form over the same widget mapping the inspector uses (`packages/studio/src/content/entry-editor.ts` over `mountSchemaForm` in `packages/studio/src/ui/schema-form.ts`). Five rows of the table below do not ship there: `format: "date"` and `format: "uri-reference"` are plain text fields, a `boolean` is a checkbox rather than a toggle, and an `array` of `string` and an `object` are raw JSON text.

Before the census this marker read `Implemented`. The two later markers in the section (JSON Data Entry Editing, CSV Editing) are accurate and stay.

**What exists**

- `entry-editor.ts` and `entry-fields.ts` (`packages/studio/src/content/`): one editor over both storage shapes, with `packages/studio/tests/entry-editor.test.ts` and `entry-fields.test.ts`.
- The control dispatch in `packages/studio/src/ui/schema-form.ts` (enum to select, boolean to checkbox, number to number field, array of objects to rows, other arrays and objects to JSON text, default to text) and `referenceControl` in `packages/studio/src/ui/form-controls.ts` (the `$ref` entry picker).
- A media picker (`packages/studio/src/ui/media-picker.ts`) already used for `uri-reference` fields in the Document Header and Page panel (`packages/studio/src/panels/frontmatter-fields.ts`), but not in the entry editor.

**What is missing**

- A date control for `format: "date"` (and `date-time`, which the parser also normalizes).
- The media picker for `format: "uri-reference"`, writing references per site-architecture.md §9.3.
- A toggle for `boolean`, a chip editor for an `array` of `string`, and a nested field group for an `object`.
- A decision on where the mapping lives: `schema-form.ts` is shared with extension settings (extensions.md §9.1), so a change there reaches both surfaces, which is either the point or needs a per-host option.
- Editorial ride-along: §7.3's "Currently stored but not editable via a UI form (see §7.4)" is stale.

**Related**

- site-architecture.md §6.3 (schema validation in the editor) and site-architecture.md §9.4 (the media picker).
- relationships.md (the entry picker for a reference field) and extensions.md §9.1 (the controls a settings section declares).
