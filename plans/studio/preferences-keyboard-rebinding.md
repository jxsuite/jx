---
status: stub
disposition: reconcile
claims:
  - studio.md#15
size: S
---

# Application Preferences specifies the Keyboard sheet's rebinding that ships

## Context

`specs/studio.md` §15, line 1548 (the census kept the section Partial and re-grounded it):

> **Status: Partial.** Everything the body specifies ships: the four sections, the Settings-menu deep links, account rows that never print a secret, the brokered Cloudflare row and the three value rules (`packages/studio/src/settings/preferences-dialog.ts`, `preferences-sections.ts`, `preferences-accounts.ts`). The table's Keyboard row says read-only, but the sheet rebinds: `preferences-keymap.ts` captures a chord, `rebindCommand` refuses a conflicting one, and the result is an override map laid over the registry and remembered across windows.

Line 1548 follows it:

> **Status: Future.** An Editor-behaviour pane and an Updates/About pane. Both were named in this section's status line from its first draft and never specified in its body, and `PREFERENCES_SECTIONS` is the four sections the table names.

Before the census the marker rested its Partial on those two panes. The body has never specified either, so they are not an open item; they are recorded as Future so the intent in `preferences-sections.ts` ("§15 lists six for the finished surface") is not lost. What is open is the Keyboard row, and disposition `reconcile`: rebinding shipped in 0.9.30 and the changelog says so, but the body still says read-only.

**What exists**

- `packages/studio/src/settings/preferences-keymap.ts`: chord capture, `rebindCommand` with conflict refusal, the persisted override layer.
- `shortcutReference()`, the projection rule 2 names, and roaming through the PAL's `subscribeSettings` (rule 5; `packages/studio/src/services/settings/kernel.ts`).
- Tests: `packages/studio/tests/preferences-dialog.test.ts`.

**What is missing**

- The Keyboard row and rule 2 rewritten: the sheet is still generated from the registry, and now also edits a per-user override layer; say what a conflict refusal names, how a binding is reset, and that the override layer roams like every other preference.
- The comment in `packages/studio/src/settings/preferences-sections.ts` ("§15 lists six") corrected to match the Future marker.

**Related**

- studio.md §13.3 (chords and user overrides "layer on top"), studio.md §10 (the shortcut tables), studio.md §5.1 (the Settings menu).
