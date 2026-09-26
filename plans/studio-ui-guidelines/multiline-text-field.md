---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#4.3
size: S
---

# The input table answers multi-line text with the kit's multiline text field

## Context

`specs/studio-ui-guidelines.md` §4.3, line 251:

> **Status: Partial.** Every kit row ships and is drawn by the surfaces, the colour field and the field-plus-menu hybrid included (`packages/studio/src/surfaces/style-panel.json`, `properties-panel.json`). The multi-line row does not: multi-line text is `jx-textfield multiline`, and no surface emits a `textarea` with `[part="field-input"]`.

Disposition `reconcile`: every multi-line field in Studio already uses the kit's `multiline` text field, which is what §4.3's own premise ("every row was a Spectrum element and is a kit one") asks for. The one raw `textarea`, the assistant's composer, is a documented exception with its own reason.

**What exists**

- `jx-textfield` with `multiline` in `packages/studio/src/surfaces/properties-panel.json`, `logic-panel.json`, `git-panel.json`, `dialog.json` (the prompt's paste box), `panel-signals.json` and the schema form.
- The assistant composer, `packages/studio/src/surfaces/ai-chat.json` (`part="composer-input"`), whose `$description` says why it is a raw `textarea`: it needs a height ceiling the kit field has no token for.
- No `[part="field-input"]` anywhere under `packages/studio/src/surfaces/`.

**What is missing**

- The table's last row rewritten to `jx-textfield` with `multiline` for code, JSON and expressions, with the composer named as the exception or left to its document.
- §4.1's CSS example (`.style-row > textarea`) and §4.5's "for `jx-textfield` and `textarea`" follow the same rename; §4.1 is owned by `plan:studio-ui-guidelines/form-row-part-vocabulary`.

**Related**

- `ui.md` §5.1 (Primitives), which catalogues `jx-textfield` and its `multiline` branch.
