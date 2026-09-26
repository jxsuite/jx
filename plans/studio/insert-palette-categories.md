---
status: stub
disposition: reconcile
claims:
  - studio.md#5.3
size: S
---

# The Elements Panel lists the categories the element data declares

## Context

`specs/studio.md` §5.3, line 366 (the section was unmarked before the census):

> **Status: Partial.** The palette ships as the rail-less Insert panel over `jx-accordion`, with live-preview cards that drag or click to insert (`packages/studio/src/panels/elements-panel.ts`). Its categories are the ones `packages/studio/data/webdata.json` declares (Structure, Text, Media, Form, Interactive, List & Table, Other), drawn after the project's Components section, not the seven listed below.

Disposition `reconcile`: the categories are data, generated with the element metadata, so the spec should say where they come from rather than restate a list that has already drifted once.

**What exists**

- `packages/studio/data/webdata.json`, `elements`: Form, Interactive, List & Table, Media, Structure, Text, Other.
- `packages/studio/src/panels/elements-panel.ts` and `src/surfaces/panel-elements.json`: the Components section first, then one accordion item per category; cards filled by `panels/dnd.ts`.
- Tests: `packages/studio/tests/elements-panel.test.ts`.

**What is missing**

- The "Categories:" line rewritten to name the source (`webdata.json`'s `elements` groups), the current groups, and the Components section drawn first in the same accordion.
- "Elements are drag-and-drop sources" extended to click-to-insert, which ships.

**Related**

- studio.md §5.4 (the Components half of the same panel), studio.md §8.2.2 (the element metadata that also decides which tags hold a caret).
