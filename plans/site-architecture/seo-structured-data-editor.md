---
status: stub
disposition: implement
claims:
  - site-architecture.md#8.6
size: M
workspaces:
  - packages/studio
---

# The Search appearance modal edits a page's structured data as a form

## Context

`specs/site-architecture.md` §8.6, line 1069:

> **Status: Partial.** The `Search appearance` modal ships the merged-`$head` previews with provenance, the counters, the warnings and the grouped live fields (`packages/studio/src/panels/seo-modal.ts`, `packages/studio/src/panels/head-panel.ts`). The Schema.org editor does not exist anywhere in `packages/studio`, and `document.openSeo` deliberately declares no `aiTool` (`studio-ui-guidelines.md` §12.4), where this section says it has one.

Before the census the section led with `Implemented`; its rationale paragraph about the modal is kept below the new marker. The retired roadmap's "SEO panel" row was unchecked for the same missing editor.

Two parts with different natures share the anchor, so one plan holds both: the Schema.org editor is an `implement`; the `aiTool` sentence is a reconcile, because the command omits the projection on purpose (the comment in `seoCommands` cites studio-ui-guidelines.md §12.4's rule that a command which only opens a modal for a person has no tool projection). The description counter's limit is also 160 (`SEO_LIMITS` in `head-panel.ts`) where the list says about 155; the detail phase picks one.

**What exists**

- `openSeoModal` and `seoCommands` in `packages/studio/src/panels/seo-modal.ts`, the surfaces `packages/studio/src/surfaces/seo.json`, `doc-header.json` and `panel-page.json`, and `packages/studio/tests/seo-modal.test.ts`.
- `seoWarnings`, `SEO_LIMITS` and the merged-head preview in `packages/studio/src/panels/head-panel.ts`.
- The build side of JSON-LD, which ships: an object `textContent` on a head entry with `attributes: { "type": "application/ld+json" }` is serialized with templates resolved. §8.5's example puts `type` at the top level, which the build drops; that example is the head-shape reconcile's, not this plan's.

**What is missing**

- A form-based JSON-LD editor in the modal: pick a Schema.org type, fill its common properties (bindable to state, as §8.5 allows), and write one head entry in the `attributes` shape `docs/framework/site/seo.md` documents and the build reads. Which types it offers, and how it shows an authored block it cannot model, are decisions.
- Warnings for structured data (a missing required property for the chosen type), if the detail phase wants them.
- §8.6's command sentence reconciled to "no `aiTool` projection", and the ~155 figure made to agree with `SEO_LIMITS`.

**Related**

- site-architecture.md §8.5 (structured data) and site-architecture.md §8.3 (the merged head the previews show).
- studio-ui-guidelines.md §12.4 (tool projections).
