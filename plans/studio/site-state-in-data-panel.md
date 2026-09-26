---
status: stub
disposition: implement
claims:
  - studio.md#3.6
requires:
  - studio/canvas-injects-context
  - site-architecture/site-state-scope
size: M
workspaces:
  - packages/studio
---

# The Data panel shows a site project's own state entries beside the document's

## Context

`specs/studio.md` §3.6, line 142. The section was unmarked before the census. After the cross-spec review, the markers stage appended the marker's last sentence, about the canvas:

> **Status: Partial.** The `$media`, `style` and `$head` rows ship, and so does the component row's `$elements` merge (`getEffectiveMedia`, `getEffectiveStyle`, `getEffectiveHead` and `getEffectiveElements` in `packages/studio/src/site-context.ts`); the component row's `components/` limit is §5.4's rule, which is not what ships. The `state` row does not: nothing in `packages/studio/src` reads `project.json`'s `state`, so the Data panel (`panels/data-explorer.ts`, `panels/signals-panel.ts`) lists only the open document's entries, although the build merges them (`injectContext` in `packages/site/src/context.ts`). Nor does the canvas show a file in the context of the full site, as the closing sentence promises: it never merges project `state` and never supplies `$site` (no `$site` token in `packages/studio/src`), and `$page` exists only for a page with route params, where `substitutePreviewParams` (`packages/studio/src/page-params.ts`) injects `params`, `title` and `url` alone (§4.1).

Disposition `implement`. The build already makes project `state` visible to every page, so a page that reads a site entry renders it in the built site, and the state explorer shows nothing for it.

The marker has three parts, and this plan owns only the `state` row:

- **The canvas sentence** is closed by `plan:studio/canvas-injects-context`, which makes the canvas compose through `injectContext` and drops the sentence from this marker. This plan requires that one. That plan also answers the decision this stub first held (does the canvas render resolve against project `state`?): yes, through `injectContext`, as the build does. After it lands, the iframe's `dataScope` snapshot (`tab.session.canvas.scope`) carries the project's entries and `$site`, so the Data panel has live values for them. What it does not have is rows for them.
- **The component clause** came from forwards by the site-architecture and desktop censuses. The "Component definitions" row restates §5.4's `components/` rule, and every host discovers components anywhere in the project tree. `plan:_shared/component-discovery` rewrites that row with §5.4, not this plan.
- §3.6 flips to Implemented only once all three have landed. This plan lands after `plan:studio/canvas-injects-context`. Between this plan and `plan:_shared/component-discovery`, whichever lands second removes the marker.

**What exists**

- `packages/studio/src/site-context.ts`: `getEffectiveMedia`, `getEffectiveStyle`, `getEffectiveElements`, `getEffectiveHead`, each merging the file on top of `project.json`.
- The canvas (`packages/studio/src/canvas/canvas-live-render.ts`) merges the project's `$media`, `$head`, `imports`, `$elements` and `style`, but never its `state`. `$page` exists only for a page with chosen route params (`substitutePreviewParams` in `packages/studio/src/page-params.ts`), and nothing injects `$site`. That is `plan:studio/canvas-injects-context`'s evidence and fix.
- `injectContext` in `packages/site/src/context.ts`: project `state` spread onto `$site` and merged into the page's own `state` as bare keys, the page winning.
- The Data panel: `packages/studio/src/panels/data-explorer.ts` and `panels/signals-panel.ts`. Their rows are the open document's own `state` entries: `signalsView` in `signals-panel.ts` iterates `S.document.state`, and `definedDataNames` in `data-explorer.ts`, the names the row verb accepts, reads the same object. Each row's value is looked up in the canvas's `dataScope` snapshot (`S.canvas.scope`, adopted in `packages/studio/src/canvas/iframe-host.ts`).

**What is missing**

- A `getEffectiveState()` (or equivalent) beside the other effective-value helpers, answering the project's entries under the document's own.
- The Data panel listing those entries read-only and marked as coming from the project, with the page's own entry winning on a name collision, as the build does. Their values come from the scope snapshot once `plan:studio/canvas-injects-context` has landed.
- The addressing the listing shows (`$site.<key>`, a bare key, or both) follows whatever `plan:site-architecture/site-state-scope` decides for site-architecture.md §10.4, so this plan requires that one.

**Related**

- site-architecture.md §3.2 (project-level `state` inheritance) and site-architecture.md §10.4 (how site state is addressed), whose wording the census found divergent in the other direction.
- studio.md §5.6 (the Data panel), studio.md §4.1 (the canvas renders in its true site context; `plan:studio/canvas-injects-context`, required).
- studio.md §5.4 (the rule §3.6's component row restates; `plan:_shared/component-discovery`).
