---
status: stub
disposition: reconcile
claims:
  - studio-ui-guidelines.md#3.1
  - studio-ui-guidelines.md#3.2
size: S
workspaces:
  - packages/studio
---

# Layout draws the shell frame as it ships: four rows, three docks, and the Assistant inside the Inspector

## Context

`specs/studio-ui-guidelines.md` §3.1, line 118:

> **Status: Partial.** The dock defaults (240/280px, `DOCK_DEFAULTS`), the status bar's `role="status"` live region, and a collapsed dock zeroing its variable and hiding its region and handle with a `localStorage` round trip ship (`packages/studio/styles/shell-frame.json`, `src/shell.ts`, `src/surfaces/shell.json`). The diagram does not: the `#app` rows are toolbar, panes, a 220px Bottom dock and the status bar; the rail is 56px; the tab strip lives in each pane's cell; and there is no Assistant column or `--panel-w-chat`, because the Assistant is a tab of the Inspector dock.

§3.2, line 142:

> **Status: Partial.** The docks do not share one anatomy; there are three. The Inspector dock is a header naming the tab and its target over a `jx-tabs` strip and a body (`packages/studio/src/surfaces/inspector-dock.json`). The Bottom dock has no header: a strip holding its `jx-tabs` and a close button sits over one tab panel (`src/surfaces/bottom-dock.json`). The Navigator dock has no tab strip: one body per panel, each under a header naming the panel and its containment level when the panel declares one, with the panel chosen from the activity rail (`src/surfaces/navigator-dock.json`).

One stub for both because they are one rewrite: both describe the shell frame, from the same files, and §3.2's "both panels" is the diagram's two side columns.

Disposition `reconcile`: the differences are later designs the code carries deliberately, and the sibling spec already states them. `studio.md` §3.1 says outright "There is no assistant column"; the Bottom dock is `studio.md` §16.3, and `DOCK_DEFAULTS` records why it starts closed; each pane owns its tab strip (`studio.md` §18). Whether the rail's 56px is itself a decision or drift is for detailing to confirm against `surfaces/rail.json`.

**What exists**

- `packages/studio/styles/shell-frame.json`: `grid-template-rows: 36px minmax(0, 1fr) var(--dock-h-bottom) 24px` and named columns `[rail] 56px [nav] var(--panel-w-left) [pane] 1fr [insp] var(--panel-w-right)`; `--dock-h-bottom` 220px, and `0px` when collapsed.
- `packages/studio/src/shell.ts`: `DOCK_DEFAULTS`, `DOCK_STORAGE_KEY`.
- `packages/studio/src/surfaces/shell.json`: the status bar's `role="status"` and `aria-live="polite"`.
- `packages/studio/src/panels/right-panel.ts` (`case "assistant"`), `src/panels/ai-panel.ts` (`setInspectorTab("assistant")`).
- The three dock documents: `packages/studio/src/surfaces/inspector-dock.json` (`header[part="header"]` with `header-title` and `header-target`, then `jx-tabs[part="tabs"]`), `bottom-dock.json` (`[part="strip"]` holding `jx-tabs[part="tabs"]` and `jx-action-button[part="close"]`, then `jx-tab-panel[part="panel"]`; no header), and `navigator-dock.json` (one `[part="panel-body"]` per panel, each with a `header` behind `hasHeader` and a `[part="content"]` island; no tab strip).

**What is missing**

- The diagram redrawn: four rows including the Bottom dock, the rail at 56px, no Assistant column, the tab strip inside the pane cell.
- The width bullets corrected (no `--panel-w-chat`; the Bottom dock's height variable added) and the "assistant column starts collapsed" sentence moved to the Bottom dock, which is the region that starts collapsed.
- §3.2 rewritten as the three dock anatomies: Inspector (header, tabs, body), Bottom (a tab strip with a close button over one panel, no header), Navigator (one body per panel under an optional header, no tabs).

**Related**

- `studio.md` §3.1 (layout), §5.1 (activity bar), §16.3 (the Bottom dock), §18.3 (the pane grid).
