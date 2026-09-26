---
status: stub
disposition: implement
claims:
  - studio.md#20.2
size: S
workspaces:
  - packages/studio
---

# A freshly mounted artboard renders in its pane's chosen language

## Context

`specs/studio.md` §20.2, line 1788 (the census moved the marker from the section's foot to directly under its heading, and moved the Partial off §20, whose own text ships):

> **Status: Partial.** `i18n.switchLocale`, the persisted `previewLocale`, the context-bar segment and the frame's `lang` and `dir` write ship (`packages/studio/src/canvas/canvas-utils.ts`, `panels/pane-context.ts`, `canvas/iframe-entry.ts`). A host that mounts after the value was set does not receive it: the locale is posted only to hosts already live (`postLocaleToLiveHosts` in `canvas/iframe-host.ts`) and the `render` message in `canvas/iframe-protocol.ts` carries none, so a restored `previewLocale` does not reach the artboard until the author touches the control.

Disposition `implement`. The fix the old marker named is the obvious one: carry the locale and direction on `render`, as `colorScheme`, `popoverOpen` and `dialogOpen` already are, for the reason the protocol's own comments give (a render replaces the DOM, and a host holds one pending message while it boots).

**What exists**

- `i18n.switchLocale` in `packages/studio/src/canvas/canvas-utils.ts`; `previewLocale` persisted in `src/workspace/session.ts`; the segment in `src/panels/pane-context.ts`.
- The `setLocale` message (`{ locale, dir }`) in `src/canvas/iframe-protocol.ts`, handled in `src/canvas/iframe-entry.ts`; `postLocaleToLiveHosts` in `src/canvas/iframe-host.ts`, called from `src/studio.ts`.
- The `render` payload's `colorScheme` field, the precedent.

**What is missing**

- `locale` and `dir` on the `render` message, filled from the pane's tab, and the frame applying them after each render.
- A test that a host mounted after `previewLocale` was set (a restored session, a second pane, a reload) renders with `lang` and `dir` applied.

**Related**

- studio.md §14.8 (session restore), studio.md §18.2 (per-pane canvas state), studio.md §19 (the UAX #9 row, whose evidence is this path), site-architecture.md §13 (the `i18n` block).
