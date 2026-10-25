---
status: stub
disposition: implement
claims:
  - studio.md#22.5
size: M
---

# A collection entry is written inside its template page's bound body, not only inside the layout

## Context

studio.md §22.5's second marker (split out of the workspace redesign, whose other Content items shipped):

> **Status: Pending.** Not part of the first build: an entry is wrapped in its template's **layout**, not spliced into the template **page**'s bound body. A template page that binds the entry into a wrapper of its own (a hero over `${entry.body}`) shows that wrapper only in Preview; writing mode shows the entry inside the layout alone. Splicing needs the canvas to map the edited entry's paths through the page's bound node, which the edit transforms do not do.

What ships: `entryLayout` in `packages/studio/src/canvas/canvas-live-render.ts` resolves the layout an entry is written in (entry `$layout`, else its template page's, else `defaults.layout`, through `entryLayoutPath` in `content/collection-pages.ts`), and `resolveCanvasDocument` wraps the entry document in it. The template page itself is found by `collectionPage` (the `$paths.contentType` / `$paths.values` scan, §5.7), so the page is already known at render time; only its body is dropped.

What is missing: rendering the template page's body with the entry bound in its place, and mapping a canvas edit made inside that bound subtree back to a path in the entry document rather than the page. The edit transforms (`tabs/transact.ts` and the doc-op paths they record) address one document; nothing today translates a path through a node whose content comes from a binding. The first decision for detailing is whether the page's chrome around the entry is drawn read-only (like the layout, locked) or not drawn in writing mode at all.
