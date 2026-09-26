---
status: stub
disposition: implement
claims:
  - extensions.md#9.1
size: M
workspaces:
  - packages/studio
---

# The settings vocabulary an extension declares is the one the studio draws

## Context

`specs/extensions.md` §9.1, line 450:

> **Status: Partial.** `label`, `order`, both layouts, `entry.ui`, `entry.newEntry`, the `schema-builder` and `secret` controls and `#/$context/` enum pointers ship (`packages/studio/src/settings/extension-sections.ts`, `packages/studio/src/settings/contributed-section.ts`, `packages/studio/src/ui/form-controls.ts`). `icon` is carried but not drawn (`section-registry.ts` reserves it), no `renderer` escape hatch exists, and the built-in controls differ from the list: `"binding"` was replaced by the value-source ladder and a `"reference"` control ships unlisted.

The section was unmarked before the census. It holds three gaps under one anchor, so one plan owns them, with mixed dispositions that the detail phase should record per part: drawing `icon` is an `implement` (the kit names are already held to the glyph manifest by `settings-document.test.ts` precisely so they are right when the nav draws them); the controls list is a `reconcile` (the code's own header in `form-controls.ts` says "Three, not the four the spec still lists"); `renderer` is a choice between building a named-renderer registry and removing the key, since no extension declares it and the table itself says first-party extensions use the generic path.

**What exists**

- `extension-sections.ts` turns each enabled extension's `$studio.settings` block into a `SettingsSection` (label defaulting to `project.title`, order, icon); `contributed-section.ts` renders `map` and `form` layouts with slugified add and rename, `entry.ui` overrides and the `${key}` template.
- `SettingsSection.icon` in `packages/studio/src/settings/section-registry.ts`, documented as "reserved for future nav treatments"; the built-in sections in `settings-document.ts` carry kit glyph names that "nothing here draws today".
- Three registered controls in `packages/studio/src/ui/form-controls.ts`: `schema-builder`, `secret`, `reference`. The value-source ladder that replaced `binding` is studio.md §6.6 (`ui/dynamic-slot.ts`, `ui/value-source.ts`).
- `#/$context/` enum resolution with `{@param}` substitution and the `$formats` virtual root.

**What is missing**

- The inner nav (and the rail foot's Settings submenu, which studio.md §17.1 says is the same projection) drawing each section's `icon` through `jx-icon`. The rule for an extension-declared glyph name (a key into the kit's glyph manifest, and what is drawn when the key is unknown) is shared with `plan:extensions/format-icon-hint`, which draws the §10 format `icon`; whichever reaches detail first decides it, and the other requires it.
- The built-in controls sentence rewritten to `schema-builder`, `secret` and `reference`, with the value-source ladder named as what took over `binding`.
- `renderer`: either a studio-side registry an extension can name, with a stated way for extension code to reach the browser (see `plan:extensions/capability-timing-dispatch`), or the row removed.

**Related**

- studio.md §6.6 (the value-source ladder), studio.md §13.5 (glyph keys versus tags), studio.md §17.1 (Project Settings).
- extensions.md §13 (the `secret` control's storage rule).
